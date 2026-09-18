from dotenv import load_dotenv
from pathlib import Path
import os

ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / '.env')

from fastapi import FastAPI, APIRouter, HTTPException, Request, Response, Depends, UploadFile, File, Form, Query
from fastapi.exceptions import RequestValidationError
from starlette.responses import JSONResponse
from starlette.middleware.cors import CORSMiddleware
from motor.motor_asyncio import AsyncIOMotorClient
import logging
import io
import zipfile
import tempfile
from pydantic import BaseModel, Field, EmailStr, model_validator
from typing import List, Optional, Literal
from datetime import date, datetime, timezone, timedelta
from collections import defaultdict
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError
import base64
import asyncio
import hashlib
import json
import uuid
import secrets
import bcrypt
import time
import re
from urllib.parse import quote, urlencode, urlparse

import boto3
import httpx
from google.auth.transport.requests import Request as GoogleAuthRequest
from google.oauth2 import id_token as google_id_token
from botocore.config import Config
from botocore.exceptions import ClientError, BotoCoreError
from starlette.background import BackgroundTask
from starlette.concurrency import run_in_threadpool
from starlette.responses import RedirectResponse
from cryptography.fernet import Fernet, InvalidToken
from flyer_extract import FlyerImageError, extract_event_fields, ocr_flyer_document
from pytesseract.pytesseract import TesseractNotFoundError
from pymongo import ReturnDocument
from pymongo.errors import DuplicateKeyError
from atomic_writes import (
    account_transaction,
    attach_application_file,
    begin_account_deletion,
    finalize_account_deletion,
    insert_applications,
    insert_event,
    insert_library_record,
)
from resume_studio import build_resume_router
from starlette.middleware.trustedhost import TrustedHostMiddleware
from starlette.responses import StreamingResponse

mongo_url = os.environ['MONGO_URL']
mongo_options = {}
if os.environ.get("MONGO_USERNAME"):
    mongo_options.update(
        username=os.environ["MONGO_USERNAME"],
        password=os.environ["MONGO_PASSWORD"],
        authSource=os.environ.get("MONGO_AUTH_SOURCE", "admin"),
    )
client = AsyncIOMotorClient(mongo_url, **mongo_options)
db = client[os.environ['DB_NAME']]

SESSION_DAYS = int(os.environ.get("SESSION_DAYS", "30"))
if not 1 <= SESSION_DAYS <= 365:
    raise RuntimeError("SESSION_DAYS must be between 1 and 365")


def env_bool(name: str, default: bool = False) -> bool:
    value = os.environ.get(name)
    if value is None:
        return default
    return value.strip().lower() in {"1", "true", "yes", "on"}


PRODUCTION_MODE = env_bool("PRODUCTION_MODE", False)
API_DOCS_ENABLED = env_bool("API_DOCS_ENABLED", not PRODUCTION_MODE)
RATE_LIMITING_ENABLED = env_bool("RATE_LIMITING_ENABLED", PRODUCTION_MODE)
SIGNUP_MODE = os.environ.get("SIGNUP_MODE", "google_invite_only" if PRODUCTION_MODE else "open").strip().lower()
if SIGNUP_MODE not in {"open", "google_invite_only", "closed"}:
    raise RuntimeError("SIGNUP_MODE must be open, google_invite_only, or closed")
BETA_ALLOWED_EMAILS = {
    email.strip().lower()
    for email in os.environ.get("BETA_ALLOWED_EMAILS", "").split(",")
    if email.strip()
}
TRUSTED_HOSTS = [host.strip() for host in os.environ.get("TRUSTED_HOSTS", "*").split(",") if host.strip()]
if PRODUCTION_MODE and (not TRUSTED_HOSTS or any("*" in host for host in TRUSTED_HOSTS)):
    raise RuntimeError("TRUSTED_HOSTS must list the production domain when PRODUCTION_MODE=true")

APPLICATION_LIMIT = int(os.environ.get("APPLICATION_LIMIT", "2000"))
EVENT_LIMIT = int(os.environ.get("EVENT_LIMIT", "2000"))
LIBRARY_RECORD_LIMIT = int(os.environ.get("LIBRARY_RECORD_LIMIT", "500"))
ATTACHMENT_TOTAL_BYTES_LIMIT = int(os.environ.get("ATTACHMENT_TOTAL_BYTES_LIMIT", str(100 * 1024 * 1024)))
BULK_IMPORT_LIMIT = int(os.environ.get("BULK_IMPORT_LIMIT", "500"))
LOCAL_OCR_HOURLY_LIMIT = int(os.environ.get("LOCAL_OCR_HOURLY_LIMIT", "20"))
RECENT_AUTH_SECONDS = int(os.environ.get("RECENT_AUTH_SECONDS", "900"))
for limit_name, limit_value in {
    "APPLICATION_LIMIT": APPLICATION_LIMIT,
    "EVENT_LIMIT": EVENT_LIMIT,
    "LIBRARY_RECORD_LIMIT": LIBRARY_RECORD_LIMIT,
    "ATTACHMENT_TOTAL_BYTES_LIMIT": ATTACHMENT_TOTAL_BYTES_LIMIT,
    "BULK_IMPORT_LIMIT": BULK_IMPORT_LIMIT,
    "LOCAL_OCR_HOURLY_LIMIT": LOCAL_OCR_HOURLY_LIMIT,
    "RECENT_AUTH_SECONDS": RECENT_AUTH_SECONDS,
}.items():
    if limit_value < 1:
        raise RuntimeError(f"{limit_name} must be positive")

app = FastAPI(
    docs_url="/docs" if API_DOCS_ENABLED else None,
    redoc_url="/redoc" if API_DOCS_ENABLED else None,
    openapi_url="/openapi.json" if API_DOCS_ENABLED else None,
)
api_router = APIRouter(prefix="/api")


@app.exception_handler(RequestValidationError)
async def safe_validation_error(request: Request, exc: RequestValidationError):
    # Pydantic's default error includes raw input, including rejected passwords.
    errors = [{"loc": error["loc"], "type": error["type"],
               "msg": "Invalid value" if error["type"] == "value_error" else error["msg"]}
              for error in exc.errors()]
    return JSONResponse(status_code=422, content={"detail": errors})


COOKIE_SECURE = env_bool("COOKIE_SECURE", True)
COOKIE_SAMESITE = os.environ.get("COOKIE_SAMESITE", "lax").lower()
if COOKIE_SAMESITE not in {"lax", "strict", "none"}:
    raise RuntimeError("COOKIE_SAMESITE must be lax, strict, or none")
COOKIE_DOMAIN = os.environ.get("COOKIE_DOMAIN") or None

# ---- S3-compatible object storage ----
S3_ENDPOINT_URL = os.environ.get("S3_ENDPOINT_URL") or None
S3_ACCESS_KEY = os.environ.get("S3_ACCESS_KEY") or None
S3_SECRET_KEY = os.environ.get("S3_SECRET_KEY") or None
S3_BUCKET = os.environ.get("S3_BUCKET", "launchpad")
S3_REGION = os.environ.get("S3_REGION", "us-east-1")
STORAGE_REQUIRED = env_bool("STORAGE_REQUIRED", False)
S3_CREATE_BUCKET_IF_MISSING = env_bool("S3_CREATE_BUCKET_IF_MISSING", not PRODUCTION_MODE)
MAX_UPLOAD_BYTES = int(os.environ.get("MAX_UPLOAD_BYTES", str(10 * 1024 * 1024)))
MAX_FLYER_BYTES = int(os.environ.get("MAX_FLYER_BYTES", str(8 * 1024 * 1024)))
GEMINI_API_KEY = os.environ.get("GEMINI_API_KEY", "").strip()
GEMINI_MODEL = os.environ.get("GEMINI_MODEL", "gemini-3.5-flash-lite").strip()
AI_FLYER_DAILY_LIMIT = int(os.environ.get("AI_FLYER_DAILY_LIMIT", "20"))
if not 1 <= AI_FLYER_DAILY_LIMIT <= 1000:
    raise RuntimeError("AI_FLYER_DAILY_LIMIT must be between 1 and 1000")
RESUME_STUDIO_ENABLED = env_bool("RESUME_STUDIO_ENABLED", True)
AI_RESUME_MONTHLY_LIMIT = int(os.environ.get("AI_RESUME_MONTHLY_LIMIT", "10"))
if not 1 <= AI_RESUME_MONTHLY_LIMIT <= 1000:
    raise RuntimeError("AI_RESUME_MONTHLY_LIMIT must be between 1 and 1000")
ALLOW_ALL_CHROME_EXTENSIONS = env_bool("ALLOW_ALL_CHROME_EXTENSIONS", False)
CHROME_EXTENSION_IDS = {
    extension_id.strip()
    for extension_id in os.environ.get("CHROME_EXTENSION_IDS", "").split(",")
    if extension_id.strip()
}
PUBLIC_BASE_URL = os.environ.get("PUBLIC_BASE_URL", "").rstrip("/")
GOOGLE_CLIENT_ID = os.environ.get("GOOGLE_CLIENT_ID", "")
GOOGLE_CLIENT_SECRET = os.environ.get("GOOGLE_CLIENT_SECRET", "")
if bool(GOOGLE_CLIENT_ID) != bool(GOOGLE_CLIENT_SECRET):
    raise RuntimeError("GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET must be configured together")
if GOOGLE_CLIENT_ID and not PUBLIC_BASE_URL:
    raise RuntimeError("PUBLIC_BASE_URL is required when Google OAuth is configured")
GOOGLE_OAUTH_ENABLED = bool(PUBLIC_BASE_URL and GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET)
GOOGLE_CALENDAR_TOKEN_KEY = os.environ.get("GOOGLE_CALENDAR_TOKEN_KEY", "")
try:
    GOOGLE_CALENDAR_CIPHER = Fernet(GOOGLE_CALENDAR_TOKEN_KEY.encode()) if GOOGLE_CALENDAR_TOKEN_KEY else None
except (ValueError, TypeError) as exc:
    raise RuntimeError("GOOGLE_CALENDAR_TOKEN_KEY must be a valid Fernet key") from exc
GOOGLE_CALENDAR_ENABLED = bool(GOOGLE_OAUTH_ENABLED and GOOGLE_CALENDAR_CIPHER)
GOOGLE_AUTHORIZE_URL = "https://accounts.google.com/o/oauth2/v2/auth"
GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token"
GOOGLE_CALENDAR_API = "https://www.googleapis.com/calendar/v3"
GOOGLE_CALENDAR_SCOPE = "https://www.googleapis.com/auth/calendar.app.created"
OAUTH_STATE_SECONDS = 10 * 60
APP_NAME = "launchpad"

s3 = boto3.client(
    "s3",
    endpoint_url=S3_ENDPOINT_URL,
    aws_access_key_id=S3_ACCESS_KEY,
    aws_secret_access_key=S3_SECRET_KEY,
    region_name=S3_REGION,
    config=Config(signature_version="s3v4"),
)

MIME_TYPES = {
    "pdf": "application/pdf", "doc": "application/msword",
    "docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "txt": "text/plain", "png": "image/png", "jpg": "image/jpeg", "jpeg": "image/jpeg",
    "csv": "text/csv", "rtf": "application/rtf",
}


def init_storage():
    """Wait for object storage and ensure the configured bucket exists."""
    last_error = None
    for attempt in range(15):
        try:
            s3.head_bucket(Bucket=S3_BUCKET)
            return
        except ClientError as exc:
            code = str(exc.response.get("Error", {}).get("Code", ""))
            if code in {"404", "NoSuchBucket", "NotFound"} and S3_CREATE_BUCKET_IF_MISSING:
                s3.create_bucket(Bucket=S3_BUCKET)
                return
            last_error = exc
        except Exception as exc:
            last_error = exc
        if attempt < 14:
            time.sleep(2)
    raise RuntimeError(f"Object storage is unavailable: {last_error}")


def put_object(path: str, data: bytes, content_type: str) -> dict:
    s3.put_object(Bucket=S3_BUCKET, Key=path, Body=data, ContentType=content_type)
    return {"path": path, "size": len(data)}


def get_object(path: str):
    response = s3.get_object(Bucket=S3_BUCKET, Key=path)
    return response["Body"].read(), response.get("ContentType", "application/octet-stream")


def delete_object(path: str):
    s3.delete_object(Bucket=S3_BUCKET, Key=path)


def user_upload_paths(user_id: str) -> list[str]:
    prefix = f"{APP_NAME}/uploads/{user_id}/"
    paginator = s3.get_paginator("list_objects_v2")
    return [
        item["Key"]
        for page in paginator.paginate(Bucket=S3_BUCKET, Prefix=prefix)
        for item in page.get("Contents", [])
        if item.get("Key", "").startswith(prefix)
    ]

class JsonLogFormatter(logging.Formatter):
    def format(self, record):
        payload = {
            "timestamp": datetime.now(timezone.utc).isoformat(),
            "level": record.levelname,
            "logger": record.name,
            "message": record.getMessage(),
        }
        if record.exc_info:
            payload["exception_type"] = record.exc_info[0].__name__
        return json.dumps(payload, ensure_ascii=False)


if os.environ.get("LOG_FORMAT", "text").lower() == "json":
    handler = logging.StreamHandler()
    handler.setFormatter(JsonLogFormatter())
    logging.basicConfig(level=logging.INFO, handlers=[handler], force=True)
else:
    logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(name)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)
# HTTP client INFO logs contain full URLs, which can include API keys.
logging.getLogger("httpx").setLevel(logging.WARNING)
logging.getLogger("httpcore").setLevel(logging.WARNING)

storage_reconciliation_task: asyncio.Task | None = None


async def queue_storage_cleanup(storage_path: str, user_id: str, reason: str) -> None:
    """Persist an idempotent cleanup request without storing file contents."""
    job_id = hashlib.sha256(storage_path.encode()).hexdigest()
    await db.storage_cleanup_jobs.update_one(
        {"_id": job_id},
        {
            "$setOnInsert": {
                "storage_path": storage_path,
                "user_id": user_id,
                "created_at": now_utc(),
                "attempts": 0,
            },
            "$set": {"reason": reason, "updated_at": now_utc()},
        },
        upsert=True,
    )


async def reconcile_storage_cleanup_jobs(limit: int = 100) -> int:
    removed = 0
    jobs = await db.storage_cleanup_jobs.find({}).sort("created_at", 1).to_list(limit)
    for job in jobs:
        try:
            await run_in_threadpool(delete_object, job["storage_path"])
            await db.storage_cleanup_jobs.delete_one({"_id": job["_id"]})
            removed += 1
        except Exception as exc:
            await db.storage_cleanup_jobs.update_one(
                {"_id": job["_id"]},
                {
                    "$inc": {"attempts": 1},
                    "$set": {
                        "last_attempt_at": now_utc(),
                        "last_error_type": type(exc).__name__,
                    },
                },
            )
    return removed


def stale_upload_objects(referenced: set[str], grace_seconds: int) -> list[str]:
    """List only old, unreferenced LaunchPad uploads; never scan unrelated prefixes."""
    cutoff = now_utc() - timedelta(seconds=grace_seconds)
    paginator = s3.get_paginator("list_objects_v2")
    stale = []
    for page in paginator.paginate(Bucket=S3_BUCKET, Prefix=f"{APP_NAME}/uploads/"):
        for item in page.get("Contents", []):
            modified = item.get("LastModified")
            if modified and modified.tzinfo is None:
                modified = modified.replace(tzinfo=timezone.utc)
            if (
                item.get("Key")
                and item["Key"] not in referenced
                and modified
                and modified <= cutoff
            ):
                stale.append(item["Key"])
    return stale


async def reconcile_unreferenced_uploads(grace_seconds: int = 3600) -> int:
    """Repair objects left by a process crash between upload and database commit."""
    referenced: set[str] = set()
    cursor = db.applications.find({}, {"attachments.storage_path": 1})
    async for application in cursor:
        for attachment in application.get("attachments") or []:
            if attachment.get("storage_path"):
                referenced.add(attachment["storage_path"])
    cursor = db.resumes.find({}, {"source_file.storage_path": 1})
    async for resume in cursor:
        storage_path = (resume.get("source_file") or {}).get("storage_path")
        if storage_path:
            referenced.add(storage_path)
    stale = await run_in_threadpool(stale_upload_objects, referenced, grace_seconds)
    removed = 0
    for storage_path in stale:
        try:
            await run_in_threadpool(delete_object, storage_path)
            await db.storage_cleanup_jobs.delete_one({
                "_id": hashlib.sha256(storage_path.encode()).hexdigest()
            })
            removed += 1
        except Exception as exc:
            await queue_storage_cleanup(
                storage_path, "reconciliation", f"inventory_{type(exc).__name__}"
            )
    return removed


async def storage_reconciliation_loop() -> None:
    inventory_counter = 0
    while True:
        try:
            removed = await reconcile_storage_cleanup_jobs()
            # The durable queue is retried every five minutes; the complete prefix
            # inventory runs hourly and ignores uploads younger than one hour.
            if inventory_counter % 12 == 0:
                removed += await reconcile_unreferenced_uploads()
            if removed:
                logger.info("Storage reconciliation removed %s unreferenced object(s)", removed)
        except asyncio.CancelledError:
            raise
        except Exception:
            logger.exception("Storage reconciliation pass failed")
        inventory_counter += 1
        await asyncio.sleep(300)


# ---------- Helpers ----------
def hash_password(password: str) -> str:
    # bcrypt truncates at 72 bytes. Version the SHA-256 preprocessing so all
    # 128 supported characters matter, while old bcrypt accounts still work.
    material = base64.b64encode(hashlib.sha256(password.encode("utf-8")).digest())
    return "sha256-bcrypt:" + bcrypt.hashpw(material, bcrypt.gensalt()).decode("utf-8")


def verify_password(plain: str, hashed: str) -> bool:
    try:
        if hashed.startswith("sha256-bcrypt:"):
            material = base64.b64encode(hashlib.sha256(plain.encode("utf-8")).digest())
            return bcrypt.checkpw(material, hashed.removeprefix("sha256-bcrypt:").encode("utf-8"))
        return bcrypt.checkpw(plain.encode("utf-8"), hashed.encode("utf-8"))
    except Exception:
        return False


def now_utc() -> datetime:
    return datetime.now(timezone.utc)


def request_ip(request: Request) -> str:
    # Uvicorn accepts forwarded addresses only from its trusted reverse proxy.
    return request.client.host if request.client else "unknown"


async def enforce_rate_limit(
    request: Request,
    bucket: str,
    identity: str,
    *,
    limit: int,
    window_seconds: int,
):
    """Fixed-window limiter persisted in MongoDB so restarts do not reset protection."""
    if not RATE_LIMITING_ENABLED:
        return
    now = now_utc()
    window = int(now.timestamp()) // window_seconds
    subject_hash = hashlib.sha256(identity.encode()).hexdigest()
    digest = hashlib.sha256(f"{bucket}:{identity}:{window}".encode()).hexdigest()
    expires_at = datetime.fromtimestamp((window + 1) * window_seconds, tz=timezone.utc) + timedelta(minutes=1)
    record = await db.rate_limits.find_one_and_update(
        {"_id": digest},
        {
            "$inc": {"count": 1},
            "$setOnInsert": {
                "bucket": bucket, "subject_hash": subject_hash,
                "expires_at": expires_at, "created_at": now.isoformat(),
            },
        },
        upsert=True,
        return_document=ReturnDocument.AFTER,
    )
    if record["count"] > limit:
        retry_after = max(1, int((window + 1) * window_seconds - now.timestamp()))
        raise HTTPException(
            status_code=429,
            detail="Too many attempts. Please wait and try again.",
            headers={"Retry-After": str(retry_after)},
        )


async def attachment_bytes_used(user_id: str) -> int:
    pipeline = [
        {"$match": {"user_id": user_id}},
        {"$unwind": {"path": "$attachments", "preserveNullAndEmptyArrays": False}},
        {"$group": {"_id": None, "total": {"$sum": {"$ifNull": ["$attachments.size", 0]}}}},
    ]
    rows = await db.applications.aggregate(pipeline).to_list(1)
    resume_rows = await db.resumes.aggregate([
        {"$match": {"user_id": user_id}},
        {"$group": {"_id": None, "total": {"$sum": {"$ifNull": ["$source_file.size", 0]}}}},
    ]).to_list(1)
    return (int(rows[0]["total"]) if rows else 0) + (int(resume_rows[0]["total"]) if resume_rows else 0)


def hash_session_token(token: str) -> str:
    """Store only a one-way digest so a database read cannot reveal live sessions."""
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


def request_session_token(request: Request) -> str | None:
    token = request.cookies.get("session_token")
    if token:
        return token
    auth = request.headers.get("Authorization", "")
    if auth.startswith("Bearer "):
        return auth[7:] or None
    return None


def set_session_cookie(response: Response, token: str):
    response.set_cookie(
        key="session_token", value=token, httponly=True, secure=COOKIE_SECURE,
        samesite=COOKIE_SAMESITE, max_age=SESSION_DAYS * 24 * 3600, path="/",
        domain=COOKIE_DOMAIN,
    )


def set_oauth_state_cookie(response: Response, state: str):
    response.set_cookie(
        key="oauth_state", value=state, httponly=True, secure=COOKIE_SECURE,
        samesite="lax", max_age=OAUTH_STATE_SECONDS, path="/api",
        domain=COOKIE_DOMAIN,
    )


def clear_oauth_state_cookie(response: Response):
    response.delete_cookie(
        "oauth_state", path="/api", domain=COOKIE_DOMAIN,
        secure=COOKIE_SECURE, httponly=True, samesite="lax",
    )
    response.delete_cookie(
        "oauth_state", path="/api/auth/google", domain=COOKIE_DOMAIN,
        secure=COOKIE_SECURE, httponly=True, samesite="lax",
    )


async def create_session(user_id: str) -> str:
    token = secrets.token_urlsafe(32)
    session_doc = {
        "user_id": user_id,
        "session_token_hash": hash_session_token(token),
        "expires_at": now_utc() + timedelta(days=SESSION_DAYS),
        "created_at": now_utc().isoformat(),
    }

    async def save(session):
        await db.user_sessions.insert_one(dict(session_doc), session=session)

    await account_transaction(db, user_id, save)
    return token


def public_user(doc: dict) -> dict:
    providers = doc.get("auth_providers")
    if not providers:
        providers = [doc.get("auth_provider", "email")]
    stored_preferences = doc.get("preferences") or {}
    theme = stored_preferences.get("theme")
    timezone_name = stored_preferences.get("timezone")
    if theme not in {"light", "dark", "system"}:
        theme = None
    try:
        if timezone_name and isinstance(timezone_name, str):
            ZoneInfo(timezone_name)
        elif timezone_name:
            timezone_name = None
    except (ZoneInfoNotFoundError, ValueError):
        timezone_name = None
    return {
        "user_id": doc["user_id"],
        "email": doc["email"],
        "name": doc.get("name", ""),
        "picture": doc.get("picture"),
        "auth_provider": doc.get("auth_provider", "email"),
        "auth_providers": providers,
        "can_change_password": bool(doc.get("password_hash")),
        "features": {
            "resume_studio": RESUME_STUDIO_ENABLED,
        },
        "preferences": {
            "theme": theme,
            "timezone": timezone_name,
            "updated_at": stored_preferences.get("updated_at"),
        },
    }


def safe_return_to(value: str) -> str:
    if value.startswith("/") and not value.startswith("//"):
        return value
    return "/dashboard"


def google_redirect_uri() -> str:
    return f"{PUBLIC_BASE_URL}/api/auth/google/callback"


def google_calendar_redirect_uri() -> str:
    return f"{PUBLIC_BASE_URL}/api/integrations/google-calendar/callback"


def verify_google_token(token: str) -> dict:
    return google_id_token.verify_oauth2_token(
        token,
        GoogleAuthRequest(),
        GOOGLE_CLIENT_ID,
        clock_skew_in_seconds=10,
    )


def login_redirect(error: str | None = None) -> RedirectResponse:
    location = "/dashboard" if error is None else f"/login?oauth_error={quote(error)}"
    response = RedirectResponse(location, status_code=303)
    clear_oauth_state_cookie(response)
    return response


def require_allowed_extension(request: Request):
    origin = request.headers.get("origin", "")
    prefix = "chrome-extension://"
    if not origin.startswith(prefix):
        raise HTTPException(status_code=403, detail="This sign-in endpoint is only available to the Chrome extension")
    extension_id = origin[len(prefix):]
    if not extension_id or "/" in extension_id:
        raise HTTPException(status_code=403, detail="Invalid Chrome extension origin")
    if not ALLOW_ALL_CHROME_EXTENSIONS and extension_id not in CHROME_EXTENSION_IDS:
        raise HTTPException(status_code=403, detail="Chrome extension is not authorized")


async def get_current_user(request: Request) -> dict:
    token = request_session_token(request)
    if not token:
        raise HTTPException(status_code=401, detail="Not authenticated")
    token_hash = hash_session_token(token)
    sess = await db.user_sessions.find_one({"session_token_hash": token_hash})
    if not sess:
        # Transparently migrate sessions issued before token hashing was enabled.
        sess = await db.user_sessions.find_one({"session_token": token})
        if sess:
            await db.user_sessions.update_one(
                {"_id": sess["_id"]},
                {"$set": {"session_token_hash": token_hash}, "$unset": {"session_token": ""}},
            )
    if not sess:
        raise HTTPException(status_code=401, detail="Invalid session")
    expires_at = sess["expires_at"]
    if isinstance(expires_at, str):
        expires_at = datetime.fromisoformat(expires_at)
    if expires_at.tzinfo is None:
        expires_at = expires_at.replace(tzinfo=timezone.utc)
    if expires_at < now_utc():
        raise HTTPException(status_code=401, detail="Session expired")
    user = await db.users.find_one({"user_id": sess["user_id"]}, {"_id": 0})
    if not user:
        raise HTTPException(status_code=401, detail="User not found")
    return user


# ---------- Models ----------
class RegisterInput(BaseModel):
    email: EmailStr
    password: str = Field(min_length=8, max_length=128)
    name: str = Field(min_length=1, max_length=100)


class LoginInput(BaseModel):
    email: EmailStr
    password: str = Field(min_length=1, max_length=128)


class SettingsProfileInput(BaseModel):
    name: str = Field(min_length=1, max_length=100)

    @model_validator(mode="after")
    def validate_name(self):
        self.name = self.name.strip()
        if not self.name:
            raise ValueError("Display name is required")
        return self


class SettingsPreferencesInput(BaseModel):
    theme: Literal["light", "dark", "system"]
    timezone: str = Field(min_length=1, max_length=64)

    @model_validator(mode="after")
    def validate_preferences(self):
        self.timezone = self.timezone.strip()
        try:
            ZoneInfo(self.timezone)
        except ZoneInfoNotFoundError as exc:
            raise ValueError("Invalid IANA timezone") from exc
        return self


class SettingsPasswordInput(BaseModel):
    current_password: str = Field(min_length=1, max_length=128)
    new_password: str = Field(min_length=8, max_length=128)
    confirm_password: str = Field(min_length=8, max_length=128)

    @model_validator(mode="after")
    def validate_passwords(self):
        if self.new_password != self.confirm_password:
            raise ValueError("New passwords do not match")
        if self.new_password == self.current_password:
            raise ValueError("Choose a new password that is different from your current password")
        return self


class DeleteAccountInput(BaseModel):
    confirmation_email: EmailStr


class ApplicationInput(BaseModel):
    company_name: str = Field(min_length=1)
    job_title: str = Field(min_length=1)
    day_applied: str
    expected_start_date: Optional[str] = None
    start_date_tbd: bool = False
    company_domain: Optional[str] = None
    description: Optional[str] = None
    pay_amount: Optional[float] = None
    pay_period: Optional[str] = None  # hourly | monthly | yearly
    confidence_level: Optional[str] = None  # Low | Medium | High
    follow_up_date: Optional[str] = None
    interview_date: Optional[str] = None
    start_date_month_only: bool = False
    status: str = "Applied"


class ApplicationPageCaptureInput(BaseModel):
    source_url: Optional[str] = Field(default=None, max_length=2048)
    page_text: str = Field(min_length=10, max_length=30000)
    structured_fields: dict = Field(default_factory=dict)
    timezone: str = Field(default="UTC", max_length=100)

    @model_validator(mode="after")
    def validate_page_capture(self):
        try:
            ZoneInfo(self.timezone)
        except ZoneInfoNotFoundError as exc:
            raise ValueError("Invalid IANA timezone") from exc
        if len(json.dumps(self.structured_fields, ensure_ascii=False)) > 10000:
            raise ValueError("Structured page data is too large")
        return self


class NoteInput(BaseModel):
    text: str = Field(min_length=1)


EVENT_CATEGORIES = {
    "Academic", "Work", "Job Search", "Interview",
    "Career Fair", "Deadline", "Personal", "Other",
}
EVENT_ICONS = {
    "book-open", "briefcase-business", "graduation-cap", "calendar-check",
    "video", "users", "map-pin", "clock", "target", "file-text",
    "presentation", "laptop", "building-2", "coffee", "star", "bell",
}
ICONIFY_IMAGE_PREFIXES = {"fluent-emoji-flat", "noto", "openmoji", "twemoji"}
ICONIFY_IMAGE_PATTERN = re.compile(r"^[a-z0-9-]+:[a-z0-9-]+$")
REMINDER_OPTIONS = {5, 10, 15, 30, 60, 1440}


class EventInput(BaseModel):
    title: str = Field(min_length=1, max_length=160)
    category: str = "Other"
    all_day: bool = False
    starts_at: Optional[datetime] = None
    ends_at: Optional[datetime] = None
    start_date: Optional[date] = None
    end_date: Optional[date] = None
    timezone: str = "UTC"
    organizer: Optional[str] = Field(default=None, max_length=160)
    location: Optional[str] = Field(default=None, max_length=300)
    description: Optional[str] = Field(default=None, max_length=5000)
    source_url: Optional[str] = Field(default=None, max_length=2048)
    icon: str = "calendar-check"
    image_icon: Optional[str] = Field(default=None, max_length=180)
    reminder_minutes: Optional[int] = None
    sync_to_google: bool = False

    @model_validator(mode="after")
    def validate_event(self):
        self.title = self.title.strip()
        if not self.title:
            raise ValueError("Event name is required")
        if self.category not in EVENT_CATEGORIES:
            raise ValueError("Invalid event category")
        if self.icon not in EVENT_ICONS:
            raise ValueError("Invalid event icon")
        if self.image_icon:
            self.image_icon = self.image_icon.strip().lower()
            prefix = self.image_icon.split(":", 1)[0]
            if prefix not in ICONIFY_IMAGE_PREFIXES or not ICONIFY_IMAGE_PATTERN.fullmatch(self.image_icon):
                raise ValueError("Invalid picture icon")
        if self.reminder_minutes is not None and self.reminder_minutes not in REMINDER_OPTIONS:
            raise ValueError("Invalid reminder")
        try:
            ZoneInfo(self.timezone)
        except ZoneInfoNotFoundError as exc:
            raise ValueError("Invalid IANA timezone") from exc
        if self.all_day:
            if self.start_date is None:
                raise ValueError("Start date is required for an all-day event")
            self.end_date = self.end_date or self.start_date
            if self.end_date < self.start_date:
                raise ValueError("End date must be on or after the start date")
            self.starts_at = None
            self.ends_at = None
        else:
            if self.starts_at is None:
                raise ValueError("Start time is required for a timed event")
            if self.starts_at.tzinfo is None:
                self.starts_at = self.starts_at.replace(tzinfo=ZoneInfo(self.timezone))
            self.ends_at = self.ends_at or (self.starts_at + timedelta(hours=1))
            if self.ends_at.tzinfo is None:
                self.ends_at = self.ends_at.replace(tzinfo=ZoneInfo(self.timezone))
            if self.ends_at <= self.starts_at:
                raise ValueError("End time must be after the start time")
            self.start_date = None
            self.end_date = None
        self.organizer = self.organizer.strip() if self.organizer else None
        self.location = self.location.strip() if self.location else None
        self.description = self.description.strip() if self.description else None
        self.source_url = self.source_url.strip() if self.source_url else None
        if self.source_url and not re.match(r"^https?://", self.source_url, re.I):
            raise ValueError("Source link must begin with http:// or https://")
        return self


class GoogleSyncInput(BaseModel):
    enabled: bool = True


class ApplicationGoogleSyncInput(BaseModel):
    kind: str
    enabled: bool = True

    @model_validator(mode="after")
    def validate_kind(self):
        if self.kind not in {"interview", "follow_up"}:
            raise ValueError("kind must be interview or follow_up")
        return self


class ApplicationGoalInput(BaseModel):
    cadence: Literal["daily", "weekly"]
    target: int = Field(ge=1, le=100)
    timezone: str = Field(min_length=1, max_length=64)

    @model_validator(mode="after")
    def validate_timezone(self):
        self.timezone = self.timezone.strip()
        try:
            ZoneInfo(self.timezone)
        except ZoneInfoNotFoundError as exc:
            raise ValueError("Invalid IANA timezone") from exc
        return self


LIBRARY_SKILL_CATEGORIES = {
    "Technical", "Tools", "Industry", "Communication", "Leadership", "Other",
}
LIBRARY_SKILL_LEVELS = {"Learning", "Working", "Strong", "Expert"}
LIBRARY_EXPERIENCE_TYPES = {
    "Work", "Project", "Accomplishment", "Education", "Leadership", "Volunteer", "Other",
}


class LibrarySkillInput(BaseModel):
    name: str = Field(min_length=1, max_length=80)
    category: str = "Other"
    level: str = "Working"
    notes: Optional[str] = Field(default=None, max_length=1000)

    @model_validator(mode="after")
    def validate_skill(self):
        self.name = self.name.strip()
        if not self.name:
            raise ValueError("Skill name is required")
        if self.category not in LIBRARY_SKILL_CATEGORIES:
            raise ValueError("Invalid skill category")
        if self.level not in LIBRARY_SKILL_LEVELS:
            raise ValueError("Invalid skill level")
        self.notes = self.notes.strip() if self.notes and self.notes.strip() else None
        return self


class LibraryExperienceInput(BaseModel):
    type: str = "Work"
    title: str = Field(min_length=1, max_length=160)
    organization: Optional[str] = Field(default=None, max_length=160)
    start_date: Optional[date] = None
    end_date: Optional[date] = None
    current: bool = False
    description: Optional[str] = Field(default=None, max_length=3000)
    resume_bullet: Optional[str] = Field(default=None, max_length=1200)
    outcome: Optional[str] = Field(default=None, max_length=500)
    star_situation: Optional[str] = Field(default=None, max_length=1500)
    star_task: Optional[str] = Field(default=None, max_length=1500)
    star_action: Optional[str] = Field(default=None, max_length=1500)
    star_result: Optional[str] = Field(default=None, max_length=1500)
    link: Optional[str] = Field(default=None, max_length=2048)
    skill_ids: List[str] = Field(default_factory=list, max_length=30)

    @model_validator(mode="after")
    def validate_experience(self):
        self.title = self.title.strip()
        if not self.title:
            raise ValueError("Experience title is required")
        if self.type not in LIBRARY_EXPERIENCE_TYPES:
            raise ValueError("Invalid experience type")
        for field_name in (
            "organization", "description", "resume_bullet", "outcome",
            "star_situation", "star_task", "star_action", "star_result", "link",
        ):
            value = getattr(self, field_name)
            setattr(self, field_name, value.strip() if value and value.strip() else None)
        if self.link and not re.match(r"^https?://", self.link, re.I):
            raise ValueError("Link must begin with http:// or https://")
        if self.current:
            self.end_date = None
        elif self.start_date and self.end_date and self.end_date < self.start_date:
            raise ValueError("End date must be on or after the start date")
        self.skill_ids = list(dict.fromkeys(skill_id.strip() for skill_id in self.skill_ids if skill_id.strip()))
        return self


class LibraryShowcaseInput(BaseModel):
    skill_ids: List[Optional[str]] = Field(default_factory=list, max_length=3)
    experience_ids: List[Optional[str]] = Field(default_factory=list, max_length=3)
    project_ids: List[Optional[str]] = Field(default_factory=list, max_length=3)

    @model_validator(mode="after")
    def validate_showcase(self):
        for field_name in ("skill_ids", "experience_ids", "project_ids"):
            values = [value.strip() if value else None for value in getattr(self, field_name)]
            chosen = [value for value in values if value]
            if len(chosen) != len(set(chosen)):
                raise ValueError("The same item cannot occupy more than one showcase position")
            setattr(self, field_name, values)
        return self


# ---------- Auth routes ----------
@api_router.post("/auth/register")
async def register(input: RegisterInput, request: Request, response: Response):
    if SIGNUP_MODE != "open":
        raise HTTPException(status_code=403, detail="New accounts are available by invitation through Google Sign-In.")
    email = input.email.lower()
    await enforce_rate_limit(request, "register", request_ip(request), limit=5, window_seconds=3600)
    if await db.users.find_one({"email": email}):
        raise HTTPException(status_code=400, detail="Email already registered")
    user_id = f"user_{uuid.uuid4().hex[:12]}"
    doc = {
        "user_id": user_id, "email": email, "name": input.name.strip(),
        "password_hash": hash_password(input.password), "picture": None,
        "auth_provider": "email", "auth_providers": ["email"],
        "created_at": now_utc().isoformat(),
    }
    await db.users.insert_one(doc)
    token = await create_session(user_id)
    set_session_cookie(response, token)
    return public_user(doc)


@api_router.post("/auth/login")
async def login(input: LoginInput, request: Request, response: Response):
    await enforce_rate_limit(request, "login_ip", request_ip(request), limit=40, window_seconds=15 * 60)
    email = input.email.lower()
    rate_identity = f"{request_ip(request)}:{hashlib.sha256(email.encode()).hexdigest()}"
    await enforce_rate_limit(request, "login", rate_identity, limit=8, window_seconds=15 * 60)
    user = await db.users.find_one({"email": email})
    if not user or not user.get("password_hash") or not verify_password(input.password, user["password_hash"]):
        raise HTTPException(status_code=401, detail="Invalid email or password")
    token = await create_session(user["user_id"])
    set_session_cookie(response, token)
    return public_user(user)


@api_router.post("/auth/extension-login")
async def extension_login(input: LoginInput, request: Request):
    """Create a bearer session without exposing the website's httpOnly cookie."""
    require_allowed_extension(request)
    await enforce_rate_limit(request, "login_ip", request_ip(request), limit=40, window_seconds=15 * 60)
    email = input.email.lower()
    rate_identity = f"{request_ip(request)}:{hashlib.sha256(email.encode()).hexdigest()}"
    await enforce_rate_limit(request, "extension_login", rate_identity, limit=8, window_seconds=15 * 60)
    user = await db.users.find_one({"email": email})
    if not user or not user.get("password_hash") or not verify_password(input.password, user["password_hash"]):
        raise HTTPException(status_code=401, detail="Invalid email or password")
    token = await create_session(user["user_id"])
    return {"user": public_user(user), "session_token": token}


@api_router.get("/auth/providers")
async def auth_providers():
    return {
        "google": GOOGLE_OAUTH_ENABLED,
        "email_registration": SIGNUP_MODE == "open",
        "invite_only": SIGNUP_MODE == "google_invite_only",
        "resume_studio": RESUME_STUDIO_ENABLED,
    }


@api_router.get("/auth/google/start")
async def google_start(request: Request, return_to: str = "/dashboard"):
    if not GOOGLE_OAUTH_ENABLED:
        raise HTTPException(status_code=404, detail="Google sign-in is not configured")
    await enforce_rate_limit(request, "google_oauth_start", request_ip(request), limit=20, window_seconds=3600)

    state = secrets.token_urlsafe(32)
    nonce = secrets.token_urlsafe(32)
    verifier = secrets.token_urlsafe(64)
    challenge = base64.urlsafe_b64encode(hashlib.sha256(verifier.encode()).digest()).rstrip(b"=").decode()
    await db.oauth_states.insert_one({
        "state": state,
        "purpose": "login",
        "nonce": nonce,
        "code_verifier": verifier,
        "return_to": safe_return_to(return_to),
        "expires_at": now_utc() + timedelta(seconds=OAUTH_STATE_SECONDS),
    })
    params = {
        "client_id": GOOGLE_CLIENT_ID,
        "redirect_uri": google_redirect_uri(),
        "response_type": "code",
        "scope": "openid email profile",
        "state": state,
        "nonce": nonce,
        "code_challenge": challenge,
        "code_challenge_method": "S256",
        "access_type": "online",
        "include_granted_scopes": "true",
        "prompt": "select_account",
    }
    response = RedirectResponse(f"{GOOGLE_AUTHORIZE_URL}?{urlencode(params)}", status_code=302)
    set_oauth_state_cookie(response, state)
    return response


@api_router.get("/auth/google/callback")
async def google_callback(
    request: Request,
    state: str | None = None,
    code: str | None = None,
    error: str | None = None,
):
    if not GOOGLE_OAUTH_ENABLED:
        return login_redirect("not_configured")
    cookie_state = request.cookies.get("oauth_state")
    if not state or not cookie_state or not secrets.compare_digest(state, cookie_state):
        return login_redirect("invalid_state")

    oauth_state = await db.oauth_states.find_one_and_delete({"state": state})
    if not oauth_state:
        return login_redirect("expired_state")
    if oauth_state.get("purpose", "login") != "login":
        return login_redirect("invalid_state")
    state_expires_at = oauth_state["expires_at"]
    if state_expires_at.tzinfo is None:
        state_expires_at = state_expires_at.replace(tzinfo=timezone.utc)
    if state_expires_at < now_utc():
        return login_redirect("expired_state")
    if error or not code:
        return login_redirect("access_denied" if error == "access_denied" else "google_error")

    try:
        async with httpx.AsyncClient(timeout=15) as http_client:
            token_response = await http_client.post(
                GOOGLE_TOKEN_URL,
                data={
                    "code": code,
                    "client_id": GOOGLE_CLIENT_ID,
                    "client_secret": GOOGLE_CLIENT_SECRET,
                    "redirect_uri": google_redirect_uri(),
                    "grant_type": "authorization_code",
                    "code_verifier": oauth_state["code_verifier"],
                },
            )
            token_response.raise_for_status()
            token_payload = token_response.json()
        claims = await run_in_threadpool(verify_google_token, token_payload["id_token"])
    except Exception as exc:
        logger.warning("Google OAuth callback failed (%s)", type(exc).__name__)
        return login_redirect("google_error")

    if claims.get("nonce") != oauth_state["nonce"]:
        return login_redirect("invalid_nonce")
    email = str(claims.get("email", "")).lower()
    if not email or claims.get("email_verified") is not True or not claims.get("sub"):
        return login_redirect("unverified_email")

    google_sub = str(claims["sub"])
    user = await db.users.find_one({"google_sub": google_sub})
    if not user:
        user = await db.users.find_one({"email": email})
    profile_updates = {
        "google_sub": google_sub,
        "picture": claims.get("picture"),
    }
    if user:
        if not user.get("name") and claims.get("name"):
            profile_updates["name"] = claims["name"]
        await db.users.update_one(
            {"user_id": user["user_id"]},
            {"$set": profile_updates, "$addToSet": {"auth_providers": "google"}},
        )
        user = await db.users.find_one({"user_id": user["user_id"]})
    else:
        if SIGNUP_MODE == "closed" or (
            SIGNUP_MODE == "google_invite_only" and email not in BETA_ALLOWED_EMAILS
        ):
            return login_redirect("invite_required")
        user = {
            "user_id": f"user_{uuid.uuid4().hex[:12]}",
            "email": email,
            "name": claims.get("name") or email.split("@", 1)[0],
            "picture": claims.get("picture"),
            "google_sub": google_sub,
            "auth_provider": "google",
            "auth_providers": ["google"],
            "created_at": now_utc().isoformat(),
        }
        await db.users.insert_one(user)

    token = await create_session(user["user_id"])
    response = RedirectResponse(oauth_state.get("return_to", "/dashboard"), status_code=303)
    clear_oauth_state_cookie(response)
    set_session_cookie(response, token)
    return response


@api_router.get("/auth/me")
async def me(user: dict = Depends(get_current_user)):
    return public_user(user)


@api_router.post("/auth/logout")
async def logout(request: Request, response: Response):
    token = request_session_token(request)
    if token:
        await db.user_sessions.delete_many({
            "$or": [
                {"session_token_hash": hash_session_token(token)},
                {"session_token": token},
            ]
        })
    response.delete_cookie(
        "session_token", path="/", domain=COOKIE_DOMAIN,
        secure=COOKIE_SECURE, httponly=True, samesite=COOKIE_SAMESITE,
    )
    return {"ok": True}


# ---------- User settings ----------
@api_router.put("/settings/profile")
async def update_settings_profile(
    input: SettingsProfileInput,
    user: dict = Depends(get_current_user),
):
    await db.users.update_one(
        {"user_id": user["user_id"]},
        {"$set": {"name": input.name, "updated_at": now_utc().isoformat()}},
    )
    updated = await db.users.find_one({"user_id": user["user_id"]})
    return public_user(updated)


@api_router.put("/settings/preferences")
async def update_settings_preferences(
    input: SettingsPreferencesInput,
    user: dict = Depends(get_current_user),
):
    preferences = {
        "theme": input.theme,
        "timezone": input.timezone,
        "updated_at": now_utc().isoformat(),
    }
    await db.users.update_one(
        {"user_id": user["user_id"]},
        {"$set": {"preferences": preferences}},
    )
    updated = await db.users.find_one({"user_id": user["user_id"]})
    return public_user(updated)


def current_session_scope(request: Request, user_id: str) -> dict:
    token = request_session_token(request)
    if not token:
        raise HTTPException(status_code=401, detail="Not authenticated")
    token_hash = hash_session_token(token)
    return {
        "user_id": user_id,
        "$nor": [
            {"session_token_hash": token_hash},
            {"session_token": token},
        ],
    }


async def require_recent_session(request: Request, user_id: str):
    token = request_session_token(request)
    if not token:
        raise HTTPException(status_code=401, detail="Not authenticated")
    session = await db.user_sessions.find_one({
        "user_id": user_id,
        "$or": [
            {"session_token_hash": hash_session_token(token)},
            {"session_token": token},
        ],
    })
    if not session:
        raise HTTPException(status_code=401, detail="Invalid session")
    created_at = session.get("created_at")
    try:
        authenticated_at = datetime.fromisoformat(created_at) if isinstance(created_at, str) else created_at
        if authenticated_at.tzinfo is None:
            authenticated_at = authenticated_at.replace(tzinfo=timezone.utc)
    except (TypeError, ValueError, AttributeError):
        authenticated_at = None
    if not authenticated_at or now_utc() - authenticated_at > timedelta(seconds=RECENT_AUTH_SECONDS):
        raise HTTPException(
            status_code=403,
            detail="For your security, sign out and sign back in before deleting your account.",
        )


@api_router.put("/settings/password")
async def update_settings_password(
    input: SettingsPasswordInput,
    request: Request,
    user: dict = Depends(get_current_user),
):
    await enforce_rate_limit(request, "password_change", user["user_id"], limit=8, window_seconds=900)
    password_hash = user.get("password_hash")
    if not password_hash:
        raise HTTPException(status_code=400, detail="Password management is handled by Google for this account")
    if not verify_password(input.current_password, password_hash):
        raise HTTPException(status_code=400, detail="Current password is incorrect")
    await db.users.update_one(
        {"user_id": user["user_id"]},
        {"$set": {"password_hash": hash_password(input.new_password), "updated_at": now_utc().isoformat()}},
    )
    revoked = await db.user_sessions.delete_many(current_session_scope(request, user["user_id"]))
    return {"ok": True, "revoked_sessions": revoked.deleted_count}


@api_router.post("/settings/sessions/revoke-others")
async def revoke_other_sessions(
    request: Request,
    user: dict = Depends(get_current_user),
):
    revoked = await db.user_sessions.delete_many(current_session_scope(request, user["user_id"]))
    return {"ok": True, "revoked_sessions": revoked.deleted_count}


def export_safe(value):
    private_keys = {
        "_id", "user_id", "password_hash", "google_sub", "refresh_token_ciphertext",
        "session_token", "session_token_hash", "storage_path", "google_event_id",
    }
    if isinstance(value, dict):
        return {key: export_safe(item) for key, item in value.items() if key not in private_keys}
    if isinstance(value, list):
        return [export_safe(item) for item in value]
    if isinstance(value, (datetime, date)):
        return value.isoformat()
    return value


def zip_json(archive: zipfile.ZipFile, name: str, value):
    archive.writestr(name, json.dumps(export_safe(value), indent=2, ensure_ascii=False, default=str) + "\n")


@api_router.get("/settings/export")
async def export_account_data(request: Request, user: dict = Depends(get_current_user)):
    await enforce_rate_limit(
        request, "account_export", user["user_id"], limit=2, window_seconds=3600,
    )
    user_id = user["user_id"]
    applications = await db.applications.find({"user_id": user_id}).sort("day_applied", -1).to_list(None)
    events = await db.events.find({"user_id": user_id}).sort("created_at", -1).to_list(None)
    skills = await db.library_skills.find({"user_id": user_id}).sort("updated_at", -1).to_list(None)
    experiences = await db.library_experiences.find({"user_id": user_id}).sort("updated_at", -1).to_list(None)
    resume_profile = await db.resume_profiles.find_one({"user_id": user_id})
    resumes = await db.resumes.find({"user_id": user_id}).sort("updated_at", -1).to_list(None)
    resume_versions = await db.resume_versions.find({"user_id": user_id}).sort("updated_at", -1).to_list(None)
    generated_at = now_utc()
    buffer = tempfile.SpooledTemporaryFile(max_size=2 * 1024 * 1024, mode="w+b")
    try:
        with zipfile.ZipFile(buffer, "w", compression=zipfile.ZIP_DEFLATED) as archive:
            zip_json(archive, "manifest.json", {
                "product": "LaunchPad",
                "generated_at": generated_at,
                "format_version": 2,
                "contents": [
                    "account.json", "applications.json", "events.json",
                    "career-library/skills.json", "career-library/experiences.json",
                    "resume-studio/profile.json", "resume-studio/masters.json",
                    "resume-studio/versions.json", "attachments/", "resume-sources/",
                ],
            })
            zip_json(archive, "account.json", {
                **public_user(user),
                "created_at": user.get("created_at"),
                "application_goal": user.get("application_goal"),
            })
            zip_json(archive, "applications.json", applications)
            zip_json(archive, "events.json", events)
            zip_json(archive, "career-library/skills.json", skills)
            zip_json(archive, "career-library/experiences.json", experiences)
            zip_json(archive, "resume-studio/profile.json", resume_profile or {})
            zip_json(archive, "resume-studio/masters.json", resumes)
            zip_json(archive, "resume-studio/versions.json", resume_versions)
            for application in applications:
                for attachment in application.get("attachments") or []:
                    storage_path = attachment.get("storage_path")
                    if not storage_path:
                        continue
                    data, _ = await run_in_threadpool(get_object, storage_path)
                    safe_name = re.sub(r"[^A-Za-z0-9._-]+", "_", attachment.get("name") or "attachment")[:180]
                    archive.writestr(
                        f"attachments/{application['app_id']}/{attachment.get('id', 'file')}-{safe_name}",
                        data,
                    )
            for resume in resumes:
                source = resume.get("source_file") or {}
                storage_path = source.get("storage_path")
                if not storage_path:
                    continue
                data, _ = await run_in_threadpool(get_object, storage_path)
                safe_name = re.sub(r"[^A-Za-z0-9._-]+", "_", source.get("name") or "resume")[:180]
                archive.writestr(
                    f"resume-sources/{resume['resume_id']}/{source.get('id', 'file')}-{safe_name}",
                    data,
                )
    except (ClientError, BotoCoreError) as exc:
        buffer.close()
        logger.error("Account export could not retrieve an attachment for user %s", user_id)
        raise HTTPException(status_code=503, detail="Your export could not be completed. Please try again.") from exc
    except BaseException:
        buffer.close()
        raise
    buffer.seek(0)
    filename = f"launchpad-account-export-{generated_at.date().isoformat()}.zip"
    def archive_chunks():
        try:
            while chunk := buffer.read(64 * 1024):
                yield chunk
        finally:
            buffer.close()

    return StreamingResponse(
        archive_chunks(),
        media_type="application/zip",
        headers={"Content-Disposition": f'attachment; filename="{filename}"', "Cache-Control": "no-store"},
        background=BackgroundTask(buffer.close),
    )


@api_router.delete("/settings/account")
async def delete_account(
    input: DeleteAccountInput,
    request: Request,
    response: Response,
    user: dict = Depends(get_current_user),
):
    if input.confirmation_email.lower() != user["email"].lower():
        raise HTTPException(status_code=422, detail="Enter your account email exactly to confirm deletion.")
    await require_recent_session(request, user["user_id"])
    user_id = user["user_id"]
    await begin_account_deletion(db, user_id, now_utc().isoformat())
    try:
        # The account-specific prefix also captures an upload abandoned by a
        # process crash before its application record could be committed.
        for storage_path in await run_in_threadpool(user_upload_paths, user_id):
            await run_in_threadpool(delete_object, storage_path)
    except Exception as exc:
        logger.error("Account deletion could not remove stored files for user %s", user_id)
        raise HTTPException(status_code=503, detail="Account deletion could not be completed. Please try again.") from exc

    await finalize_account_deletion(db, user_id)
    response.delete_cookie(
        "session_token", path="/", domain=COOKIE_DOMAIN,
        secure=COOKIE_SECURE, httponly=True, samesite=COOKIE_SAMESITE,
    )
    return {"ok": True}


# ---------- Calendar helpers ----------
class CalendarSyncError(Exception):
    pass


def utc_iso(value: datetime) -> str:
    return value.astimezone(timezone.utc).isoformat().replace("+00:00", "Z")


def event_scope(user: dict, event_id: str | None = None) -> dict:
    scope = {"user_id": user["user_id"]}
    if event_id is not None:
        scope["event_id"] = event_id
    return scope


async def get_owned_event(user: dict, event_id: str) -> dict:
    event = await db.events.find_one(event_scope(user, event_id))
    if not event:
        raise HTTPException(status_code=404, detail="Event not found")
    return event


def event_input_fields(input: EventInput) -> dict:
    return {
        "title": input.title,
        "category": input.category,
        "all_day": input.all_day,
        "starts_at": utc_iso(input.starts_at) if input.starts_at else None,
        "ends_at": utc_iso(input.ends_at) if input.ends_at else None,
        "start_date": input.start_date.isoformat() if input.start_date else None,
        "end_date": input.end_date.isoformat() if input.end_date else None,
        "timezone": input.timezone,
        "organizer": input.organizer,
        "location": input.location,
        "description": input.description,
        "source_url": input.source_url,
        "icon": input.icon,
        "image_icon": input.image_icon,
        "reminder_minutes": input.reminder_minutes,
        "sync_to_google": input.sync_to_google,
    }


def event_to_public(doc: dict) -> dict:
    result = dict(doc)
    result.pop("_id", None)
    result.pop("user_id", None)
    result.pop("google_event_id", None)
    return result


def parse_calendar_boundary(value: str, *, end: bool = False) -> datetime:
    try:
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        try:
            parsed_date = date.fromisoformat(value)
            parsed = datetime.combine(parsed_date, datetime.min.time(), tzinfo=timezone.utc)
        except ValueError as exc:
            raise HTTPException(status_code=422, detail="Calendar range must use ISO dates or datetimes") from exc
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=timezone.utc)
    return parsed.astimezone(timezone.utc)


def calendar_range(from_value: str, to_value: str) -> tuple[datetime, datetime]:
    start = parse_calendar_boundary(from_value)
    end = parse_calendar_boundary(to_value, end=True)
    if end <= start:
        raise HTTPException(status_code=422, detail="Calendar range end must be after its start")
    if end - start > timedelta(days=370):
        raise HTTPException(status_code=422, detail="Calendar range cannot exceed 370 days")
    return start, end


def event_range_scope(user: dict, start: datetime, end: datetime, category: str | None = None) -> dict:
    start_iso = utc_iso(start)
    end_iso = utc_iso(end)
    scope = {
        "user_id": user["user_id"],
        "$or": [
            {"all_day": False, "starts_at": {"$lt": end_iso}, "ends_at": {"$gt": start_iso}},
            {
                "all_day": True,
                "start_date": {"$lt": end.date().isoformat()},
                "end_date": {"$gte": start.date().isoformat()},
            },
        ],
    }
    if category:
        if category not in EVENT_CATEGORIES:
            raise HTTPException(status_code=422, detail="Invalid event category")
        scope["category"] = category
    return scope


def encrypt_refresh_token(token: str) -> str:
    if not GOOGLE_CALENDAR_CIPHER:
        raise CalendarSyncError("calendar_not_configured")
    return GOOGLE_CALENDAR_CIPHER.encrypt(token.encode()).decode()


def decrypt_refresh_token(ciphertext: str) -> str:
    if not GOOGLE_CALENDAR_CIPHER:
        raise CalendarSyncError("calendar_not_configured")
    try:
        return GOOGLE_CALENDAR_CIPHER.decrypt(ciphertext.encode()).decode()
    except (InvalidToken, ValueError) as exc:
        raise CalendarSyncError("stored_credential_invalid") from exc


async def google_access_token(connection: dict) -> str:
    refresh_token = decrypt_refresh_token(connection["refresh_token_ciphertext"])
    try:
        async with httpx.AsyncClient(timeout=15) as http_client:
            response = await http_client.post(GOOGLE_TOKEN_URL, data={
                "client_id": GOOGLE_CLIENT_ID,
                "client_secret": GOOGLE_CLIENT_SECRET,
                "refresh_token": refresh_token,
                "grant_type": "refresh_token",
            })
        if response.status_code >= 400:
            raise CalendarSyncError("google_reauthorization_required")
        token = response.json().get("access_token")
        if not token:
            raise CalendarSyncError("google_token_unavailable")
        return token
    except CalendarSyncError:
        raise
    except Exception as exc:
        raise CalendarSyncError("google_unavailable") from exc


async def google_api(
    connection: dict,
    method: str,
    path: str,
    *,
    body: dict | None = None,
    allowed: set[int] | None = None,
) -> tuple[int, dict]:
    token = await google_access_token(connection)
    try:
        async with httpx.AsyncClient(timeout=20) as http_client:
            response = await http_client.request(
                method,
                f"{GOOGLE_CALENDAR_API}{path}",
                headers={"Authorization": f"Bearer {token}"},
                json=body,
            )
    except Exception as exc:
        raise CalendarSyncError("google_unavailable") from exc
    accepted = allowed or {200, 201, 204}
    if response.status_code not in accepted:
        if response.status_code in {401, 403}:
            raise CalendarSyncError("google_reauthorization_required")
        raise CalendarSyncError(f"google_http_{response.status_code}")
    if response.status_code == 204 or not response.content:
        return response.status_code, {}
    return response.status_code, response.json()


def deterministic_google_event_id(user_id: str, source_id: str, kind: str = "event") -> str:
    digest = hashlib.sha256(f"launchpad:{user_id}:{kind}:{source_id}".encode()).digest()
    return "lp" + base64.b32hexencode(digest).decode().lower().rstrip("=")


def google_event_body(event: dict, google_event_id: str) -> dict:
    description = event.get("description") or ""
    if event.get("organizer"):
        description = f"Organized by: {event['organizer']}\n\n{description}".strip()
    if event.get("source_url"):
        description = f"{description}\n\nSource: {event['source_url']}".strip()
    body = {
        "id": google_event_id,
        "summary": event["title"],
        "description": description,
        "location": event.get("location") or "",
        "visibility": "private",
        "extendedProperties": {"private": {
            "launchpad_source": "event",
            "launchpad_event_id": event["event_id"],
        }},
        "reminders": {
            "useDefault": event.get("reminder_minutes") is None,
            "overrides": [] if event.get("reminder_minutes") is None else [
                {"method": "popup", "minutes": event["reminder_minutes"]}
            ],
        },
    }
    if event["all_day"]:
        body["start"] = {"date": event["start_date"]}
        exclusive_end = date.fromisoformat(event["end_date"]) + timedelta(days=1)
        body["end"] = {"date": exclusive_end.isoformat()}
    else:
        body["start"] = {"dateTime": event["starts_at"], "timeZone": event["timezone"]}
        body["end"] = {"dateTime": event["ends_at"], "timeZone": event["timezone"]}
    return body


async def sync_event_to_google(user: dict, event: dict) -> dict:
    connection = await db.google_calendar_connections.find_one({"user_id": user["user_id"]})
    if not connection:
        raise CalendarSyncError("google_calendar_not_connected")
    google_id = event.get("google_event_id") or deterministic_google_event_id(
        user["user_id"], event["event_id"]
    )
    calendar_id = quote(connection["calendar_id"], safe="")
    path = f"/calendars/{calendar_id}/events/{quote(google_id, safe='')}"
    body = google_event_body(event, google_id)
    status, payload = await google_api(connection, "PUT", path, body=body, allowed={200, 201, 404})
    if status == 404:
        status, payload = await google_api(
            connection,
            "POST",
            f"/calendars/{calendar_id}/events",
            body=body,
            allowed={200, 201, 409},
        )
        if status == 409:
            _, payload = await google_api(connection, "PUT", path, body=body)
    update = {
        "google_event_id": google_id,
        "google_html_link": payload.get("htmlLink"),
        "google_sync_status": "synced",
        "google_last_error": None,
        "google_last_synced_at": now_utc().isoformat(),
    }
    await db.events.update_one(event_scope(user, event["event_id"]), {"$set": update})
    return await get_owned_event(user, event["event_id"])


async def delete_google_event(user: dict, event: dict):
    if not event.get("google_event_id"):
        return
    connection = await db.google_calendar_connections.find_one({"user_id": user["user_id"]})
    if not connection:
        return
    calendar_id = quote(connection["calendar_id"], safe="")
    google_id = quote(event["google_event_id"], safe="")
    await google_api(
        connection, "DELETE", f"/calendars/{calendar_id}/events/{google_id}", allowed={204, 404}
    )


async def persist_event_sync_error(user: dict, event_id: str, code: str):
    await db.events.update_one(event_scope(user, event_id), {"$set": {
        "google_sync_status": "error",
        "google_last_error": code,
    }})


def integration_to_public(connection: dict | None) -> dict:
    return {
        "configured": GOOGLE_CALENDAR_ENABLED,
        "connected": bool(connection),
        "email": connection.get("email") if connection else None,
        "calendar_name": "LaunchPad" if connection else None,
        "calendar_timezone": connection.get("calendar_timezone") if connection else None,
        "connected_at": connection.get("connected_at") if connection else None,
    }


AI_FLYER_SCHEMA = {
    "type": "object",
    "additionalProperties": False,
    "properties": {
        "title": {"type": ["string", "null"], "description": "Exact visible event name, preserving punctuation and singular/plural wording."},
        "organizer": {"type": ["string", "null"], "description": "Club, school unit, company, organization, or person presenting the event."},
        "category": {"type": "string", "enum": sorted(EVENT_CATEGORIES)},
        "all_day": {"type": "boolean"},
        "start_date": {"type": ["string", "null"], "description": "YYYY-MM-DD."},
        "end_date": {"type": ["string", "null"], "description": "YYYY-MM-DD."},
        "start_time": {"type": ["string", "null"], "description": "24-hour HH:MM local time."},
        "end_time": {"type": ["string", "null"], "description": "24-hour HH:MM local time."},
        "location": {"type": ["string", "null"]},
        "description": {"type": ["string", "null"], "description": "Brief useful details not already represented in the other fields."},
    },
    "required": [
        "title", "organizer", "category", "all_day", "start_date", "end_date",
        "start_time", "end_time", "location", "description",
    ],
}

AI_APPLICATION_SCHEMA = {
    "type": "object",
    "additionalProperties": False,
    "properties": {
        "company_name": {"type": ["string", "null"], "description": "Exact employer or company name shown in the posting."},
        "job_title": {"type": ["string", "null"], "description": "Exact role or internship title shown in the posting."},
        "company_domain": {"type": ["string", "null"], "description": "Employer website hostname only, without a path or protocol."},
        "expected_start_date": {"type": ["string", "null"], "description": "YYYY-MM-DD only when an exact start date is visible."},
        "start_date_tbd": {"type": "boolean"},
        "pay_amount": {"type": ["number", "null"], "description": "A single explicit pay amount. Use null for ranges or ambiguous compensation."},
        "pay_period": {"type": ["string", "null"], "enum": ["hourly", "monthly", "yearly", None]},
        "description": {"type": ["string", "null"], "description": "Concise useful posting details, including visible location, qualifications, responsibilities, and compensation ranges."},
    },
    "required": [
        "company_name", "job_title", "company_domain", "expected_start_date",
        "start_date_tbd", "pay_amount", "pay_period", "description",
    ],
}


def _clean_ai_string(value, limit: int) -> str | None:
    if not isinstance(value, str):
        return None
    cleaned = re.sub(r"\s+", " ", value).strip()
    return cleaned[:limit] or None


def validate_ai_flyer_fields(payload: dict, timezone_name: str, source_url: str | None = None) -> dict:
    """Treat model output as untrusted and return only valid event draft fields."""
    fields: dict[str, object] = {
        "timezone": timezone_name,
        "category": payload.get("category") if payload.get("category") in EVENT_CATEGORIES else "Other",
    }
    for name, limit in (("title", 160), ("organizer", 160), ("location", 300), ("description", 2500)):
        cleaned = _clean_ai_string(payload.get(name), limit)
        if cleaned:
            fields[name] = cleaned

    dates = {}
    for name in ("start_date", "end_date"):
        value = payload.get(name)
        if isinstance(value, str):
            try:
                dates[name] = date.fromisoformat(value).isoformat()
            except ValueError:
                pass
    if "start_date" in dates:
        fields["start_date"] = dates["start_date"]
        fields["end_date"] = dates.get("end_date", dates["start_date"])

    times = {}
    for name in ("start_time", "end_time"):
        value = payload.get(name)
        if isinstance(value, str) and re.fullmatch(r"(?:[01]\d|2[0-3]):[0-5]\d", value):
            times[name] = value
    all_day = bool(payload.get("all_day")) or "start_time" not in times
    fields["all_day"] = all_day
    if not all_day:
        fields["start_time"] = times["start_time"]
        fields["end_time"] = times.get("end_time") or (
            datetime.strptime(times["start_time"], "%H:%M") + timedelta(hours=1)
        ).strftime("%H:%M")
    if source_url:
        fields["source_url"] = source_url
    return fields


APPLICATION_ROLE_HINT = re.compile(
    r"\b(?:intern(?:ship)?|engineer|developer|analyst|designer|manager|coordinator|assistant|"
    r"specialist|consultant|scientist|researcher|recruiter|associate|representative|technician|"
    r"architect|administrator|director|lead|product|marketing|sales|accountant|programmer)\b",
    re.I,
)
APPLICATION_NOISE_LINE = re.compile(
    r"^(?:sign in|log in|apply(?: now)?|save|share|search|jobs?|careers?|home|menu|notifications?|"
    r"promoted|sponsored|easy apply|about the job)$",
    re.I,
)
JOB_PLATFORM_HOSTS = {
    "linkedin.com", "indeed.com", "glassdoor.com", "ziprecruiter.com", "handshake.com",
    "instagram.com", "facebook.com", "x.com", "twitter.com", "google.com",
}


def _source_company_domain(source_url: str | None) -> str | None:
    if not source_url:
        return None
    try:
        host = (urlparse(source_url).hostname or "").lower().removeprefix("www.")
    except ValueError:
        return None
    if not host or any(host == item or host.endswith(f".{item}") for item in JOB_PLATFORM_HOSTS):
        return None
    return host[:253]


def extract_application_fields(text: str, source_url: str | None = None) -> dict:
    """Build a conservative application draft from local OCR before optional AI review."""
    lines = [re.sub(r"\s+", " ", line).strip(" |•") for line in text.splitlines()]
    lines = [line for line in lines if 2 <= len(line) <= 180 and not APPLICATION_NOISE_LINE.match(line)]
    title_index = next((index for index, line in enumerate(lines[:30]) if APPLICATION_ROLE_HINT.search(line)), None)
    job_title = lines[title_index] if title_index is not None else (lines[0] if lines else None)
    company_name = None
    if title_index is not None:
        preceding = [line for line in lines[max(0, title_index - 3):title_index] if len(line) <= 100]
        if preceding:
            company_name = preceding[-1]

    fields: dict[str, object] = {}
    if company_name and company_name != job_title:
        fields["company_name"] = company_name[:160]
    if job_title:
        fields["job_title"] = job_title[:160]
    domain = _source_company_domain(source_url)
    if domain:
        fields["company_domain"] = domain

    pay_match = re.search(
        r"\$\s*([\d,]+(?:\.\d{1,2})?)\s*(?:/|per\s+)(hour|hr|month|mo|year|yr)\b",
        text, re.I,
    )
    if pay_match:
        fields["pay_amount"] = float(pay_match.group(1).replace(",", ""))
        token = pay_match.group(2).lower()
        fields["pay_period"] = "hourly" if token in {"hour", "hr"} else "monthly" if token in {"month", "mo"} else "yearly"

    readable = "\n".join(lines)[:2500].strip()
    if readable:
        fields["description"] = readable
    missing = [label for key, label in (("company_name", "company"), ("job_title", "role")) if not fields.get(key)]
    warnings = [
        f"Local scanning could not confidently identify the {' and '.join(missing)}. Improve with AI or fill it in manually."
    ] if missing else ["Local scanning is a starting point. Review the company and role before saving."]
    return {
        "fields": fields,
        "warnings": warnings,
        "found_fields": [key for key in ("company_name", "job_title", "company_domain", "pay_amount", "description") if fields.get(key) is not None],
        "ocr_preview": text[:2500],
    }


def validate_ai_application_fields(payload: dict, source_url: str | None = None) -> dict:
    """Treat model output as untrusted and return only supported application draft fields."""
    fields: dict[str, object] = {}
    for name, limit in (("company_name", 160), ("job_title", 160), ("description", 5000)):
        cleaned = _clean_ai_string(payload.get(name), limit)
        if cleaned:
            fields[name] = cleaned

    domain = _clean_ai_string(payload.get("company_domain"), 253)
    if domain:
        domain = domain.lower().removeprefix("https://").removeprefix("http://").split("/")[0].removeprefix("www.")
        if re.fullmatch(r"(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}", domain):
            fields["company_domain"] = domain
    if "company_domain" not in fields:
        fallback_domain = _source_company_domain(source_url)
        if fallback_domain:
            fields["company_domain"] = fallback_domain

    start_date = payload.get("expected_start_date")
    if isinstance(start_date, str):
        try:
            fields["expected_start_date"] = date.fromisoformat(start_date).isoformat()
        except ValueError:
            pass
    fields["start_date_tbd"] = bool(payload.get("start_date_tbd")) and "expected_start_date" not in fields

    amount = payload.get("pay_amount")
    period = payload.get("pay_period")
    if isinstance(amount, (int, float)) and not isinstance(amount, bool) and 0 <= amount <= 100_000_000 and period in {"hourly", "monthly", "yearly"}:
        fields["pay_amount"] = float(amount)
        fields["pay_period"] = period
    return fields


async def reserve_ai_flyer_use(user: dict) -> int:
    """Atomically reserve one provider call and enforce a small per-user daily ceiling."""
    today = now_utc().date().isoformat()
    usage_id = f"{user['user_id']}:{today}"
    async def reserve(session):
        try:
            await db.ai_flyer_usage.update_one(
                {"_id": usage_id, "count": {"$lt": AI_FLYER_DAILY_LIMIT}},
                {
                    "$inc": {"count": 1},
                    "$setOnInsert": {
                        "user_id": user["user_id"],
                        "day": today,
                        "expires_at": now_utc() + timedelta(days=2),
                    },
                },
                upsert=True,
                session=session,
            )
        except DuplicateKeyError as exc:
            raise HTTPException(
                status_code=429,
                detail=f"Daily AI capture limit reached ({AI_FLYER_DAILY_LIMIT}). Local scanning still works.",
            ) from exc

    await account_transaction(db, user["user_id"], reserve)
    usage = await db.ai_flyer_usage.find_one({"_id": usage_id}, {"count": 1})
    return max(0, AI_FLYER_DAILY_LIMIT - int((usage or {}).get("count", AI_FLYER_DAILY_LIMIT)))


async def improve_flyer_with_gemini(
    data: bytes,
    content_type: str,
    timezone_name: str,
    ocr_text: str,
) -> tuple[dict, dict]:
    local_now = datetime.now(ZoneInfo(timezone_name))
    prompt = f"""Extract the single primary calendar event from this flyer image.
Return only the requested JSON fields. Copy visible names exactly, preserving punctuation, capitalization, and singular/plural wording. A small logo, acronym, club name, department, company, or 'presented by' line is usually the organizer, not the event title. Ignore decorative artwork and social-media interface text. Never invent missing information; use null.

Today is {local_now.date().isoformat()} in {timezone_name}. For a visible date without a year, use the current occurrence unless it is more than 30 days in the past, then use next year. Convert displayed times to 24-hour HH:MM but do not change their local timezone. If only a start time is visible, set end_time to one hour later. Use all_day=true only when no time is visible.

Choose exactly one category from: {', '.join(sorted(EVENT_CATEGORIES))}.
Optional local OCR, which may contain errors:
{ocr_text[:2500]}"""
    body = {
        "contents": [{"role": "user", "parts": [
            {"inlineData": {"mimeType": content_type, "data": base64.b64encode(data).decode("ascii")}},
            {"text": prompt},
        ]}],
        "generationConfig": {
            "temperature": 0,
            "maxOutputTokens": 700,
            "responseMimeType": "application/json",
            "responseJsonSchema": AI_FLYER_SCHEMA,
            "thinkingConfig": {"thinkingLevel": "MINIMAL"},
        },
    }
    try:
        async with httpx.AsyncClient(timeout=30) as http:
            response = await http.post(
                f"https://generativelanguage.googleapis.com/v1beta/models/{GEMINI_MODEL}:generateContent",
                headers={"x-goog-api-key": GEMINI_API_KEY, "Content-Type": "application/json"},
                json=body,
            )
    except httpx.HTTPError as exc:
        raise HTTPException(status_code=502, detail="AI improvement is temporarily unavailable. Your local draft was not changed.") from exc
    if response.status_code != 200:
        logger.warning("Gemini flyer request failed with status %s", response.status_code)
        if response.status_code == 404:
            detail = "The configured Gemini model is no longer available. Your local draft was not changed."
        elif response.status_code == 429:
            detail = "Gemini's request limit was reached. Try again later; your local draft was not changed."
        elif response.status_code == 503:
            detail = "Gemini is temporarily busy. Try again shortly; your local draft was not changed."
        else:
            detail = "AI improvement couldn't read this flyer. Your local draft was not changed."
        raise HTTPException(status_code=502, detail=detail)
    result = response.json()
    try:
        parts = result["candidates"][0]["content"]["parts"]
        raw = "".join(part.get("text", "") for part in parts if not part.get("thought"))
        parsed = json.loads(raw)
    except (KeyError, IndexError, TypeError, json.JSONDecodeError) as exc:
        raise HTTPException(status_code=502, detail="AI improvement returned an unreadable result. Your local draft was not changed.") from exc
    return parsed, result.get("usageMetadata", {})


async def improve_application_with_gemini(
    data: bytes,
    content_type: str,
    timezone_name: str,
    ocr_text: str,
    source_url: str | None,
) -> tuple[dict, dict]:
    local_now = datetime.now(ZoneInfo(timezone_name))
    prompt = f"""Extract the single primary job, internship, co-op, fellowship, or volunteer opportunity from this screenshot.
Return only the requested JSON fields. Copy the employer and role name exactly when visible. Ignore browser chrome, navigation, advertisements, recommendations, social-media interface text, and unrelated nearby listings. Never invent missing information; use null.

Today is {local_now.date().isoformat()} in {timezone_name}. Only return expected_start_date when a complete exact start date is shown. Set start_date_tbd=true only when the posting explicitly says the start date is TBD or to be determined. For compensation, return pay_amount only when one unambiguous amount and period are stated; keep ranges in description and return null for pay_amount. Keep description concise and include useful visible location, responsibilities, qualifications, compensation range, and application deadline details that do not fit another field.

Source page URL, which may be a job board rather than the employer: {source_url or 'not available'}
Optional local OCR, which may contain errors:
{ocr_text[:2500]}"""
    body = {
        "contents": [{"role": "user", "parts": [
            {"inlineData": {"mimeType": content_type, "data": base64.b64encode(data).decode("ascii")}},
            {"text": prompt},
        ]}],
        "generationConfig": {
            "temperature": 0,
            "maxOutputTokens": 900,
            "responseMimeType": "application/json",
            "responseJsonSchema": AI_APPLICATION_SCHEMA,
            "thinkingConfig": {"thinkingLevel": "MINIMAL"},
        },
    }
    try:
        async with httpx.AsyncClient(timeout=30) as http:
            response = await http.post(
                f"https://generativelanguage.googleapis.com/v1beta/models/{GEMINI_MODEL}:generateContent",
                headers={"x-goog-api-key": GEMINI_API_KEY, "Content-Type": "application/json"},
                json=body,
            )
    except httpx.HTTPError as exc:
        raise HTTPException(status_code=502, detail="AI improvement is temporarily unavailable. Your local draft was not changed.") from exc
    if response.status_code != 200:
        logger.warning("Gemini application capture failed with status %s", response.status_code)
        if response.status_code == 404:
            detail = "The configured Gemini model is no longer available. Your local draft was not changed."
        elif response.status_code == 429:
            detail = "Gemini's request limit was reached. Try again later; your local draft was not changed."
        elif response.status_code == 503:
            detail = "Gemini is temporarily busy. Try again shortly; your local draft was not changed."
        else:
            detail = "AI improvement couldn't read this job posting. Your local draft was not changed."
        raise HTTPException(status_code=502, detail=detail)
    result = response.json()
    try:
        parts = result["candidates"][0]["content"]["parts"]
        raw = "".join(part.get("text", "") for part in parts if not part.get("thought"))
        parsed = json.loads(raw)
    except (KeyError, IndexError, TypeError, json.JSONDecodeError) as exc:
        raise HTTPException(status_code=502, detail="AI improvement returned an unreadable result. Your local draft was not changed.") from exc
    return parsed, result.get("usageMetadata", {})


async def improve_application_page_with_gemini(
    page_text: str,
    structured_fields: dict,
    timezone_name: str,
    source_url: str | None,
) -> tuple[dict, dict]:
    local_now = datetime.now(ZoneInfo(timezone_name))
    structured_preview = json.dumps(structured_fields, ensure_ascii=False)[:5000]
    prompt = f"""Extract the single primary job, internship, co-op, fellowship, or volunteer opportunity from webpage content.
Return only the requested JSON fields. Prefer the structured browser data when it is present, copy the employer and role name exactly, and ignore navigation, advertisements, recommendations, cookie notices, and unrelated listings. Never invent missing information; use null.

Today is {local_now.date().isoformat()} in {timezone_name}. Only return expected_start_date when a complete exact start date is stated. Set start_date_tbd=true only when the page explicitly says the start date is TBD or to be determined. For compensation, return pay_amount only when one unambiguous amount and period are stated; keep ranges in description and return null for pay_amount. Keep description concise and include useful location, responsibilities, qualifications, compensation range, and application deadline details that do not fit another field.

Source URL: {source_url or 'not available'}
Structured browser data:
{structured_preview}

Relevant webpage text:
{page_text[:24000]}"""
    body = {
        "contents": [{"role": "user", "parts": [{"text": prompt}]}],
        "generationConfig": {
            "temperature": 0,
            "maxOutputTokens": 900,
            "responseMimeType": "application/json",
            "responseJsonSchema": AI_APPLICATION_SCHEMA,
            "thinkingConfig": {"thinkingLevel": "MINIMAL"},
        },
    }
    try:
        async with httpx.AsyncClient(timeout=30) as http:
            response = await http.post(
                f"https://generativelanguage.googleapis.com/v1beta/models/{GEMINI_MODEL}:generateContent",
                headers={"x-goog-api-key": GEMINI_API_KEY, "Content-Type": "application/json"},
                json=body,
            )
    except httpx.HTTPError as exc:
        raise HTTPException(status_code=502, detail="AI improvement is temporarily unavailable. Your local draft was not changed.") from exc
    if response.status_code != 200:
        logger.warning("Gemini application webpage capture failed with status %s", response.status_code)
        if response.status_code == 404:
            detail = "The configured Gemini model is no longer available. Your local draft was not changed."
        elif response.status_code == 429:
            detail = "Gemini's request limit was reached. Try again later; your local draft was not changed."
        elif response.status_code == 503:
            detail = "Gemini is temporarily busy. Try again shortly; your local draft was not changed."
        else:
            detail = "AI improvement couldn't read this job page. Your local draft was not changed."
        raise HTTPException(status_code=502, detail=detail)
    result = response.json()
    try:
        parts = result["candidates"][0]["content"]["parts"]
        raw = "".join(part.get("text", "") for part in parts if not part.get("thought"))
        parsed = json.loads(raw)
    except (KeyError, IndexError, TypeError, json.JSONDecodeError) as exc:
        raise HTTPException(status_code=502, detail="AI improvement returned an unreadable result. Your local draft was not changed.") from exc
    return parsed, result.get("usageMetadata", {})


def _application_capture_response(fields: dict, warnings: list[str], remaining: int, usage: dict) -> dict:
    return {
        "fields": fields,
        "warnings": warnings,
        "found_fields": [key for key in ("company_name", "job_title", "company_domain", "expected_start_date", "pay_amount", "description") if fields.get(key) is not None],
        "ai_available": True,
        "ai_enhanced": True,
        "ai_model": GEMINI_MODEL,
        "ai_remaining_today": remaining,
        "usage": {
            "input_tokens": usage.get("promptTokenCount"),
            "output_tokens": usage.get("candidatesTokenCount"),
        },
    }


@api_router.post("/applications/extract-page")
async def extract_application_page(
    input: ApplicationPageCaptureInput,
    request: Request,
    user: dict = Depends(get_current_user),
):
    await enforce_rate_limit(request, "page_extract", user["user_id"], limit=120, window_seconds=3600)
    source_url = input.source_url.strip() if input.source_url else None
    if source_url and not re.match(r"^https?://", source_url, re.I):
        source_url = None
    local_result = extract_application_fields(input.page_text, source_url)
    structured = validate_ai_application_fields(input.structured_fields, source_url)
    fields = {**local_result["fields"], **structured}
    missing = [label for key, label in (("company_name", "company"), ("job_title", "role")) if not fields.get(key)]
    warnings = [
        f"The page did not clearly identify the {' and '.join(missing)}. Improve with AI or fill it in manually."
    ] if missing else []
    return {
        "fields": fields,
        "warnings": warnings,
        "found_fields": [key for key in ("company_name", "job_title", "company_domain", "expected_start_date", "pay_amount", "description") if fields.get(key) is not None],
        "ai_available": bool(GEMINI_API_KEY),
        "ai_daily_limit": AI_FLYER_DAILY_LIMIT,
    }


@api_router.post("/applications/improve-page")
async def improve_application_page(
    input: ApplicationPageCaptureInput,
    request: Request,
    user: dict = Depends(get_current_user),
):
    await enforce_rate_limit(request, "ai_flyer", user["user_id"], limit=AI_FLYER_DAILY_LIMIT, window_seconds=86400)
    if not GEMINI_API_KEY:
        raise HTTPException(status_code=503, detail="AI application improvement is not configured")
    source_url = input.source_url.strip() if input.source_url else None
    if source_url and not re.match(r"^https?://", source_url, re.I):
        source_url = None
    try:
        ZoneInfo(input.timezone)
    except ZoneInfoNotFoundError as exc:
        raise HTTPException(status_code=422, detail="Invalid IANA timezone") from exc
    remaining = await reserve_ai_flyer_use(user)
    parsed, usage = await improve_application_page_with_gemini(
        input.page_text, input.structured_fields, input.timezone, source_url,
    )
    fields = validate_ai_application_fields(parsed, source_url)
    warnings = []
    if not fields.get("company_name"):
        warnings.append("AI couldn't confidently identify the company.")
    if not fields.get("job_title"):
        warnings.append("AI couldn't confidently identify the role.")
    return _application_capture_response(fields, warnings, remaining, usage)


@api_router.post("/applications/extract-posting")
async def extract_application_posting(
    request: Request,
    image: UploadFile = File(...),
    timezone_name: str = Form("UTC", alias="timezone"),
    source_url: str | None = Form(default=None),
    user: dict = Depends(get_current_user),
):
    await enforce_rate_limit(
        request, "local_ocr", user["user_id"], limit=LOCAL_OCR_HOURLY_LIMIT, window_seconds=3600,
    )
    if image.content_type not in {"image/png", "image/jpeg", "image/webp"}:
        raise HTTPException(status_code=400, detail="Upload a PNG, JPEG, or WebP screenshot")
    try:
        ZoneInfo(timezone_name)
    except ZoneInfoNotFoundError as exc:
        raise HTTPException(status_code=422, detail="Invalid IANA timezone") from exc
    if source_url:
        source_url = source_url.strip()[:2048]
        if not re.match(r"^https?://", source_url, re.I):
            source_url = None
    data = await image.read(MAX_FLYER_BYTES + 1)
    if len(data) > MAX_FLYER_BYTES:
        raise HTTPException(status_code=413, detail=f"Screenshot exceeds the {MAX_FLYER_BYTES // (1024 * 1024)} MB limit")
    if not data:
        raise HTTPException(status_code=400, detail="The screenshot is empty")
    try:
        document = await run_in_threadpool(ocr_flyer_document, data)
        text = document["text"]
    except FlyerImageError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except TesseractNotFoundError as exc:
        logger.error("Local application OCR is not installed")
        raise HTTPException(status_code=503, detail="Local application scanning is unavailable") from exc
    except Exception as exc:
        logger.exception("Local application scan failed")
        raise HTTPException(status_code=422, detail="We couldn't read that screenshot. Try a tighter crop with clearer text.") from exc
    if len(re.sub(r"\W", "", text)) < 10:
        raise HTTPException(status_code=422, detail="We couldn't find enough readable text. Try a tighter or higher-resolution screenshot.")
    result = extract_application_fields(text, source_url)
    result.update({"ai_available": bool(GEMINI_API_KEY), "ai_daily_limit": AI_FLYER_DAILY_LIMIT})
    return result


@api_router.post("/applications/improve-posting")
async def improve_application_posting(
    request: Request,
    image: UploadFile = File(...),
    timezone_name: str = Form("UTC", alias="timezone"),
    source_url: str | None = Form(default=None),
    ocr_text: str = Form(default=""),
    user: dict = Depends(get_current_user),
):
    await enforce_rate_limit(request, "ai_flyer", user["user_id"], limit=AI_FLYER_DAILY_LIMIT, window_seconds=86400)
    if not GEMINI_API_KEY:
        raise HTTPException(status_code=503, detail="AI application improvement is not configured")
    if image.content_type not in {"image/png", "image/jpeg", "image/webp"}:
        raise HTTPException(status_code=400, detail="Upload a PNG, JPEG, or WebP screenshot")
    try:
        ZoneInfo(timezone_name)
    except ZoneInfoNotFoundError as exc:
        raise HTTPException(status_code=422, detail="Invalid IANA timezone") from exc
    if source_url:
        source_url = source_url.strip()[:2048]
        if not re.match(r"^https?://", source_url, re.I):
            source_url = None
    data = await image.read(MAX_FLYER_BYTES + 1)
    if len(data) > MAX_FLYER_BYTES:
        raise HTTPException(status_code=413, detail=f"Screenshot exceeds the {MAX_FLYER_BYTES // (1024 * 1024)} MB limit")
    if not data:
        raise HTTPException(status_code=400, detail="The screenshot is empty")
    remaining = await reserve_ai_flyer_use(user)
    parsed, usage = await improve_application_with_gemini(
        data, image.content_type, timezone_name, ocr_text.strip()[:2500], source_url,
    )
    fields = validate_ai_application_fields(parsed, source_url)
    warnings = []
    if not fields.get("company_name"):
        warnings.append("AI couldn't confidently identify the company.")
    if not fields.get("job_title"):
        warnings.append("AI couldn't confidently identify the role.")
    return {
        "fields": fields,
        "warnings": warnings,
        "found_fields": [key for key in ("company_name", "job_title", "company_domain", "expected_start_date", "pay_amount", "description") if fields.get(key) is not None],
        "ai_available": True,
        "ai_enhanced": True,
        "ai_model": GEMINI_MODEL,
        "ai_remaining_today": remaining,
        "usage": {
            "input_tokens": usage.get("promptTokenCount"),
            "output_tokens": usage.get("candidatesTokenCount"),
        },
    }


# ---------- Calendar routes ----------
@api_router.post("/events/extract-flyer")
async def extract_flyer(
    request: Request,
    image: UploadFile = File(...),
    timezone_name: str = Form("UTC", alias="timezone"),
    source_url: str | None = Form(default=None),
    user: dict = Depends(get_current_user),
):
    await enforce_rate_limit(
        request, "local_ocr", user["user_id"], limit=LOCAL_OCR_HOURLY_LIMIT, window_seconds=3600,
    )
    if image.content_type not in {"image/png", "image/jpeg", "image/webp"}:
        raise HTTPException(status_code=400, detail="Upload a PNG, JPEG, or WebP screenshot")
    try:
        ZoneInfo(timezone_name)
    except ZoneInfoNotFoundError as exc:
        raise HTTPException(status_code=422, detail="Invalid IANA timezone") from exc
    if source_url:
        source_url = source_url.strip()[:2048]
        if not re.match(r"^https?://", source_url, re.I):
            source_url = None
    data = await image.read(MAX_FLYER_BYTES + 1)
    if len(data) > MAX_FLYER_BYTES:
        raise HTTPException(status_code=413, detail=f"Screenshot exceeds the {MAX_FLYER_BYTES // (1024 * 1024)} MB limit")
    if not data:
        raise HTTPException(status_code=400, detail="The screenshot is empty")
    try:
        document = await run_in_threadpool(ocr_flyer_document, data)
        text = document["text"]
    except FlyerImageError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except TesseractNotFoundError as exc:
        logger.error("Local flyer OCR is not installed")
        raise HTTPException(status_code=503, detail="Local flyer scanning is unavailable") from exc
    except Exception as exc:
        logger.exception("Local flyer scan failed")
        raise HTTPException(status_code=422, detail="We couldn't read that screenshot. Try a tighter crop with clearer text.") from exc
    if len(re.sub(r"\W", "", text)) < 10:
        raise HTTPException(status_code=422, detail="We couldn't find enough readable text. Try a tighter or higher-resolution screenshot.")
    result = extract_event_fields(
        text,
        timezone_name=timezone_name,
        source_url=source_url,
        line_hints=document.get("lines"),
        image_height=document.get("height"),
    )
    result.update({
        "ai_available": bool(GEMINI_API_KEY),
        "ai_daily_limit": AI_FLYER_DAILY_LIMIT,
    })
    return result


@api_router.post("/events/improve-flyer")
async def improve_flyer(
    request: Request,
    image: UploadFile = File(...),
    timezone_name: str = Form("UTC", alias="timezone"),
    source_url: str | None = Form(default=None),
    ocr_text: str = Form(default=""),
    user: dict = Depends(get_current_user),
):
    await enforce_rate_limit(request, "ai_flyer", user["user_id"], limit=AI_FLYER_DAILY_LIMIT, window_seconds=86400)
    if not GEMINI_API_KEY:
        raise HTTPException(status_code=503, detail="AI flyer improvement is not configured")
    if image.content_type not in {"image/png", "image/jpeg", "image/webp"}:
        raise HTTPException(status_code=400, detail="Upload a PNG, JPEG, or WebP screenshot")
    try:
        ZoneInfo(timezone_name)
    except ZoneInfoNotFoundError as exc:
        raise HTTPException(status_code=422, detail="Invalid IANA timezone") from exc
    if source_url:
        source_url = source_url.strip()[:2048]
        if not re.match(r"^https?://", source_url, re.I):
            source_url = None
    data = await image.read(MAX_FLYER_BYTES + 1)
    if len(data) > MAX_FLYER_BYTES:
        raise HTTPException(status_code=413, detail=f"Screenshot exceeds the {MAX_FLYER_BYTES // (1024 * 1024)} MB limit")
    if not data:
        raise HTTPException(status_code=400, detail="The screenshot is empty")
    remaining = await reserve_ai_flyer_use(user)
    parsed, usage = await improve_flyer_with_gemini(
        data, image.content_type, timezone_name, ocr_text.strip()[:2500]
    )
    fields = validate_ai_flyer_fields(parsed, timezone_name, source_url)
    warnings = []
    if not fields.get("title"):
        warnings.append("AI couldn't confidently identify the event name.")
    if not fields.get("start_date"):
        warnings.append("AI couldn't confidently identify a date.")
    return {
        "fields": fields,
        "warnings": warnings,
        "found_fields": [key for key in ("title", "organizer", "category", "start_date", "start_time", "location") if fields.get(key)],
        "ai_available": True,
        "ai_enhanced": True,
        "ai_model": GEMINI_MODEL,
        "ai_remaining_today": remaining,
        "usage": {
            "input_tokens": usage.get("promptTokenCount"),
            "output_tokens": usage.get("candidatesTokenCount"),
        },
    }


@api_router.get("/events")
async def list_events(
    from_: str | None = Query(default=None, alias="from"),
    to: str | None = None,
    category: str | None = None,
    user: dict = Depends(get_current_user),
):
    if from_ and to:
        start, end = calendar_range(from_, to)
        scope = event_range_scope(user, start, end, category)
    elif from_ or to:
        raise HTTPException(status_code=422, detail="Both from and to are required")
    else:
        scope = event_scope(user)
        if category:
            if category not in EVENT_CATEGORIES:
                raise HTTPException(status_code=422, detail="Invalid event category")
            scope["category"] = category
    docs = await db.events.find(scope).sort([("start_date", 1), ("starts_at", 1)]).to_list(2000)
    return [event_to_public(doc) for doc in docs]


@api_router.post("/events")
async def create_event(input: EventInput, user: dict = Depends(get_current_user)):
    timestamp = now_utc().isoformat()
    doc = {
        **event_input_fields(input),
        "event_id": f"evt_{uuid.uuid4().hex[:12]}",
        "user_id": user["user_id"],
        "google_sync_status": "pending" if input.sync_to_google else "not_requested",
        "google_event_id": None,
        "google_html_link": None,
        "google_last_error": None,
        "google_last_synced_at": None,
        "created_at": timestamp,
        "updated_at": timestamp,
    }
    await insert_event(db, user["user_id"], doc, EVENT_LIMIT)
    if input.sync_to_google:
        try:
            doc = await sync_event_to_google(user, doc)
        except CalendarSyncError as exc:
            await persist_event_sync_error(user, doc["event_id"], str(exc))
            doc = await get_owned_event(user, doc["event_id"])
    return event_to_public(doc)


@api_router.put("/events/{event_id}")
async def update_event(event_id: str, input: EventInput, user: dict = Depends(get_current_user)):
    existing = await get_owned_event(user, event_id)
    update = {**event_input_fields(input), "updated_at": now_utc().isoformat()}
    should_sync = input.sync_to_google
    update["google_sync_status"] = "pending" if should_sync else "not_requested"
    await db.events.update_one(event_scope(user, event_id), {"$set": update})
    current = await get_owned_event(user, event_id)
    if existing.get("google_event_id") and not input.sync_to_google:
        try:
            await delete_google_event(user, existing)
            await db.events.update_one(event_scope(user, event_id), {"$unset": {
                "google_event_id": "", "google_html_link": "", "google_last_synced_at": "",
            }})
            current = await get_owned_event(user, event_id)
        except CalendarSyncError as exc:
            await persist_event_sync_error(user, event_id, str(exc))
            return event_to_public(await get_owned_event(user, event_id))
    if should_sync:
        try:
            current = await sync_event_to_google(user, current)
        except CalendarSyncError as exc:
            await persist_event_sync_error(user, event_id, str(exc))
            current = await get_owned_event(user, event_id)
    return event_to_public(current)


@api_router.delete("/events/{event_id}")
async def delete_event(event_id: str, user: dict = Depends(get_current_user)):
    existing = await get_owned_event(user, event_id)
    cleanup_status = "not_linked"
    if existing.get("google_event_id"):
        try:
            await delete_google_event(user, existing)
            cleanup_status = "removed"
        except CalendarSyncError:
            cleanup_status = "google_cleanup_failed"
    await db.events.delete_one(event_scope(user, event_id))
    return {"ok": True, "google_cleanup_status": cleanup_status}


@api_router.post("/events/{event_id}/google-sync")
async def set_event_google_sync(
    event_id: str,
    input: GoogleSyncInput,
    user: dict = Depends(get_current_user),
):
    existing = await get_owned_event(user, event_id)
    if input.enabled:
        await db.events.update_one(event_scope(user, event_id), {"$set": {
            "sync_to_google": True, "google_sync_status": "pending", "updated_at": now_utc().isoformat(),
        }})
        try:
            existing = await sync_event_to_google(user, await get_owned_event(user, event_id))
        except CalendarSyncError as exc:
            await persist_event_sync_error(user, event_id, str(exc))
            existing = await get_owned_event(user, event_id)
    else:
        try:
            await delete_google_event(user, existing)
        except CalendarSyncError as exc:
            await persist_event_sync_error(user, event_id, str(exc))
            return event_to_public(await get_owned_event(user, event_id))
        await db.events.update_one(event_scope(user, event_id), {
            "$set": {
                "sync_to_google": False,
                "google_sync_status": "not_requested",
                "google_last_error": None,
                "updated_at": now_utc().isoformat(),
            },
            "$unset": {"google_event_id": "", "google_html_link": "", "google_last_synced_at": ""},
        })
        existing = await get_owned_event(user, event_id)
    return event_to_public(existing)


@api_router.get("/integrations/google-calendar")
async def google_calendar_status(user: dict = Depends(get_current_user)):
    connection = await db.google_calendar_connections.find_one({"user_id": user["user_id"]})
    return integration_to_public(connection)


@api_router.get("/integrations/google-calendar/connect")
async def connect_google_calendar(
    request: Request,
    response: Response,
    return_to: str = "/calendar",
    timezone_name: str = Query(default="UTC", alias="timezone"),
    user: dict = Depends(get_current_user),
):
    if not GOOGLE_CALENDAR_ENABLED:
        raise HTTPException(status_code=404, detail="Google Calendar is not configured")
    await enforce_rate_limit(request, "calendar_oauth_start", user["user_id"], limit=10, window_seconds=3600)
    try:
        ZoneInfo(timezone_name)
    except ZoneInfoNotFoundError as exc:
        raise HTTPException(status_code=422, detail="Invalid IANA timezone") from exc
    state = secrets.token_urlsafe(32)
    nonce = secrets.token_urlsafe(32)
    verifier = secrets.token_urlsafe(64)
    challenge = base64.urlsafe_b64encode(hashlib.sha256(verifier.encode()).digest()).rstrip(b"=").decode()
    oauth_state_doc = {
        "state": state,
        "purpose": "calendar",
        "user_id": user["user_id"],
        "nonce": nonce,
        "code_verifier": verifier,
        "return_to": safe_return_to(return_to),
        "timezone": timezone_name,
        "expires_at": now_utc() + timedelta(seconds=OAUTH_STATE_SECONDS),
    }

    async def save_oauth_state(session):
        await db.oauth_states.insert_one(dict(oauth_state_doc), session=session)

    await account_transaction(db, user["user_id"], save_oauth_state)
    params = {
        "client_id": GOOGLE_CLIENT_ID,
        "redirect_uri": google_calendar_redirect_uri(),
        "response_type": "code",
        "scope": f"openid email profile {GOOGLE_CALENDAR_SCOPE}",
        "state": state,
        "nonce": nonce,
        "code_challenge": challenge,
        "code_challenge_method": "S256",
        "access_type": "offline",
        "include_granted_scopes": "true",
        "prompt": "consent select_account",
    }
    redirect = RedirectResponse(f"{GOOGLE_AUTHORIZE_URL}?{urlencode(params)}", status_code=302)
    set_oauth_state_cookie(redirect, state)
    return redirect


def calendar_redirect(return_to: str, result: str) -> RedirectResponse:
    joiner = "&" if "?" in return_to else "?"
    response = RedirectResponse(f"{return_to}{joiner}{result}", status_code=303)
    clear_oauth_state_cookie(response)
    return response


@api_router.get("/integrations/google-calendar/callback")
async def google_calendar_callback(
    request: Request,
    state: str | None = None,
    code: str | None = None,
    error: str | None = None,
    user: dict = Depends(get_current_user),
):
    if not GOOGLE_CALENDAR_ENABLED:
        return calendar_redirect("/calendar", "calendar_error=not_configured")
    cookie_state = request.cookies.get("oauth_state")
    if not state or not cookie_state or not secrets.compare_digest(state, cookie_state):
        return calendar_redirect("/calendar", "calendar_error=invalid_state")
    oauth_state = await db.oauth_states.find_one_and_delete({"state": state})
    if not oauth_state or oauth_state.get("purpose") != "calendar":
        return calendar_redirect("/calendar", "calendar_error=expired_state")
    return_to = oauth_state.get("return_to", "/calendar")
    state_expiry = oauth_state["expires_at"]
    if state_expiry.tzinfo is None:
        state_expiry = state_expiry.replace(tzinfo=timezone.utc)
    if state_expiry < now_utc() or oauth_state.get("user_id") != user["user_id"]:
        return calendar_redirect(return_to, "calendar_error=invalid_state")
    if error or not code:
        return calendar_redirect(return_to, "calendar_error=access_denied")
    try:
        async with httpx.AsyncClient(timeout=20) as http_client:
            token_response = await http_client.post(GOOGLE_TOKEN_URL, data={
                "code": code,
                "client_id": GOOGLE_CLIENT_ID,
                "client_secret": GOOGLE_CLIENT_SECRET,
                "redirect_uri": google_calendar_redirect_uri(),
                "grant_type": "authorization_code",
                "code_verifier": oauth_state["code_verifier"],
            })
            token_response.raise_for_status()
            token_payload = token_response.json()
        claims = await run_in_threadpool(verify_google_token, token_payload["id_token"])
        if (
            claims.get("nonce") != oauth_state["nonce"]
            or not claims.get("sub")
            or claims.get("email_verified") is not True
        ):
            raise CalendarSyncError("invalid_nonce")
        refresh_token = token_payload.get("refresh_token")
        existing = await db.google_calendar_connections.find_one({"user_id": user["user_id"]})
        same_account = existing and existing.get("google_sub") == str(claims["sub"])
        if not refresh_token and same_account:
            encrypted_token = existing["refresh_token_ciphertext"]
        elif refresh_token:
            encrypted_token = encrypt_refresh_token(refresh_token)
        else:
            raise CalendarSyncError("refresh_token_missing")
        access_token = token_payload.get("access_token")
        calendar_id = existing.get("calendar_id") if same_account else None
        calendar_timezone = oauth_state.get("timezone", "UTC")
        if not calendar_id:
            if not access_token:
                raise CalendarSyncError("google_token_unavailable")
            async with httpx.AsyncClient(timeout=20) as http_client:
                calendar_response = await http_client.post(
                    f"{GOOGLE_CALENDAR_API}/calendars",
                    headers={"Authorization": f"Bearer {access_token}"},
                    json={
                        "summary": "LaunchPad",
                        "description": "Events created by LaunchPad",
                        "timeZone": calendar_timezone,
                    },
                )
            if calendar_response.status_code not in {200, 201}:
                raise CalendarSyncError(f"google_http_{calendar_response.status_code}")
            calendar_id = calendar_response.json()["id"]
        now = now_utc().isoformat()
        connection_fields = {
                "user_id": user["user_id"],
                "google_sub": str(claims["sub"]),
                "email": str(claims.get("email", "")).lower(),
                "refresh_token_ciphertext": encrypted_token,
                "calendar_id": calendar_id,
                "calendar_timezone": calendar_timezone,
                "updated_at": now,
                "connected_at": existing.get("connected_at", now) if same_account else now,
        }

        async def save_connection(session):
            await db.google_calendar_connections.update_one(
                {"user_id": user["user_id"]},
                {"$set": connection_fields},
                upsert=True,
                session=session,
            )

        await account_transaction(db, user["user_id"], save_connection)
    except Exception as exc:
        code_name = str(exc) if isinstance(exc, CalendarSyncError) else "google_error"
        logger.warning("Google Calendar connection failed (%s)", code_name)
        return calendar_redirect(return_to, f"calendar_error={quote(code_name)}")
    return calendar_redirect(return_to, "calendar_connected=1")


@api_router.delete("/integrations/google-calendar")
async def disconnect_google_calendar(user: dict = Depends(get_current_user)):
    result = await db.google_calendar_connections.delete_one({"user_id": user["user_id"]})
    if result.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Google Calendar connection not found")
    await db.events.update_many(
        event_scope(user),
        {"$set": {"google_sync_status": "disconnected", "sync_to_google": False}},
    )
    for kind in ("interview", "follow_up"):
        await db.applications.update_many(
            {**application_scope(user), f"calendar_sync.{kind}.enabled": True},
            {"$set": {
                f"calendar_sync.{kind}.enabled": False,
                f"calendar_sync.{kind}.status": "disconnected",
            }},
        )
    return {"ok": True}


def application_calendar_path(kind: str) -> str:
    return f"calendar_sync.{kind}"


def parse_application_interview(value: str, timezone_name: str) -> datetime:
    parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=ZoneInfo(timezone_name))
    return parsed.astimezone(timezone.utc)


def application_google_event_body(app_doc: dict, kind: str, google_id: str, timezone_name: str) -> dict:
    if kind == "interview":
        if not app_doc.get("interview_date"):
            raise CalendarSyncError("interview_date_missing")
        start = parse_application_interview(app_doc["interview_date"], timezone_name)
        end = start + timedelta(hours=1)
        summary = f"Interview: {app_doc['job_title']} at {app_doc['company_name']}"
        start_payload = {"dateTime": utc_iso(start), "timeZone": timezone_name}
        end_payload = {"dateTime": utc_iso(end), "timeZone": timezone_name}
    else:
        if not app_doc.get("follow_up_date"):
            raise CalendarSyncError("follow_up_date_missing")
        follow_date = date.fromisoformat(app_doc["follow_up_date"])
        summary = f"Follow up: {app_doc['job_title']} at {app_doc['company_name']}"
        start_payload = {"date": follow_date.isoformat()}
        end_payload = {"date": (follow_date + timedelta(days=1)).isoformat()}
    return {
        "id": google_id,
        "summary": summary,
        "description": app_doc.get("description") or "",
        "visibility": "private",
        "start": start_payload,
        "end": end_payload,
        "reminders": {"useDefault": True},
        "extendedProperties": {"private": {
            "launchpad_source": f"application_{kind}",
            "launchpad_application_id": app_doc["app_id"],
        }},
    }


async def sync_application_item(user: dict, app_doc: dict, kind: str) -> dict:
    connection = await db.google_calendar_connections.find_one({"user_id": user["user_id"]})
    if not connection:
        raise CalendarSyncError("google_calendar_not_connected")
    sync_data = app_doc.get("calendar_sync", {}).get(kind, {})
    google_id = sync_data.get("google_event_id") or deterministic_google_event_id(
        user["user_id"], app_doc["app_id"], kind
    )
    body = application_google_event_body(
        app_doc, kind, google_id, connection.get("calendar_timezone", "UTC")
    )
    calendar_id = quote(connection["calendar_id"], safe="")
    path = f"/calendars/{calendar_id}/events/{quote(google_id, safe='')}"
    status, payload = await google_api(connection, "PUT", path, body=body, allowed={200, 201, 404})
    if status == 404:
        status, payload = await google_api(
            connection,
            "POST",
            f"/calendars/{calendar_id}/events",
            body=body,
            allowed={200, 201, 409},
        )
        if status == 409:
            _, payload = await google_api(connection, "PUT", path, body=body)
    update = {
        f"{application_calendar_path(kind)}.enabled": True,
        f"{application_calendar_path(kind)}.status": "synced",
        f"{application_calendar_path(kind)}.google_event_id": google_id,
        f"{application_calendar_path(kind)}.google_html_link": payload.get("htmlLink"),
        f"{application_calendar_path(kind)}.last_error": None,
        f"{application_calendar_path(kind)}.last_synced_at": now_utc().isoformat(),
    }
    await db.applications.update_one(application_scope(user, app_doc["app_id"]), {"$set": update})
    return await get_owned_application(user, app_doc["app_id"])


async def remove_application_google_item(user: dict, app_doc: dict, kind: str):
    sync_data = app_doc.get("calendar_sync", {}).get(kind, {})
    google_id = sync_data.get("google_event_id")
    connection = await db.google_calendar_connections.find_one({"user_id": user["user_id"]})
    if google_id and connection:
        calendar_id = quote(connection["calendar_id"], safe="")
        await google_api(
            connection,
            "DELETE",
            f"/calendars/{calendar_id}/events/{quote(google_id, safe='')}",
            allowed={204, 404},
        )
    await db.applications.update_one(
        application_scope(user, app_doc["app_id"]),
        {"$set": {
            f"{application_calendar_path(kind)}.enabled": False,
            f"{application_calendar_path(kind)}.status": "not_requested",
            f"{application_calendar_path(kind)}.last_error": None,
        }, "$unset": {
            f"{application_calendar_path(kind)}.google_event_id": "",
            f"{application_calendar_path(kind)}.google_html_link": "",
            f"{application_calendar_path(kind)}.last_synced_at": "",
        }},
    )


def public_application_sync(sync_data: dict | None) -> dict:
    result = {}
    for kind, value in (sync_data or {}).items():
        if kind not in {"interview", "follow_up"}:
            continue
        result[kind] = {
            key: item for key, item in value.items() if key != "google_event_id"
        }
    return result


@api_router.get("/calendar/items")
async def calendar_items(
    from_: str = Query(alias="from"),
    to: str = Query(),
    user: dict = Depends(get_current_user),
):
    start, end = calendar_range(from_, to)
    events = await db.events.find(event_range_scope(user, start, end)).to_list(2000)
    items = [{
        **event_to_public(event),
        "id": event["event_id"],
        "source": "event",
    } for event in events]
    apps = await db.applications.find(application_scope(user), {"_id": 0}).to_list(2000)
    connection = await db.google_calendar_connections.find_one({"user_id": user["user_id"]})
    timezone_name = connection.get("calendar_timezone", "UTC") if connection else "UTC"
    for app_doc in apps:
        interview_value = app_doc.get("interview_date")
        if interview_value:
            try:
                interview_start = parse_application_interview(interview_value, timezone_name)
                interview_end = interview_start + timedelta(hours=1)
                if interview_start < end and interview_end > start:
                    sync = app_doc.get("calendar_sync", {}).get("interview", {})
                    items.append({
                        "id": f"{app_doc['app_id']}:interview",
                        "source": "application_interview",
                        "application_id": app_doc["app_id"],
                        "title": f"Interview: {app_doc['job_title']}",
                        "subtitle": app_doc["company_name"],
                        "category": "Interview",
                        "icon": "video",
                        "all_day": False,
                        "starts_at": utc_iso(interview_start),
                        "ends_at": utc_iso(interview_end),
                        "timezone": timezone_name,
                        "location": None,
                        "description": app_doc.get("description"),
                        "google_sync_status": sync.get("status", "not_requested"),
                        "google_html_link": sync.get("google_html_link"),
                    })
            except (ValueError, ZoneInfoNotFoundError):
                pass
        follow_value = app_doc.get("follow_up_date")
        if follow_value:
            try:
                follow_date = date.fromisoformat(follow_value)
                if start.date() <= follow_date < end.date():
                    sync = app_doc.get("calendar_sync", {}).get("follow_up", {})
                    items.append({
                        "id": f"{app_doc['app_id']}:follow_up",
                        "source": "application_follow_up",
                        "application_id": app_doc["app_id"],
                        "title": f"Follow up: {app_doc['job_title']}",
                        "subtitle": app_doc["company_name"],
                        "category": "Job Search",
                        "icon": "bell",
                        "all_day": True,
                        "start_date": follow_date.isoformat(),
                        "end_date": follow_date.isoformat(),
                        "timezone": timezone_name,
                        "location": None,
                        "description": app_doc.get("description"),
                        "google_sync_status": sync.get("status", "not_requested"),
                        "google_html_link": sync.get("google_html_link"),
                    })
            except ValueError:
                pass
    items.sort(key=lambda item: item.get("starts_at") or item.get("start_date") or "")
    return items


# ---------- Skills & experience library ----------
def library_skill_scope(user: dict, skill_id: str | None = None) -> dict:
    scope = {"user_id": user["user_id"]}
    if skill_id is not None:
        scope["skill_id"] = skill_id
    return scope


def library_experience_scope(user: dict, experience_id: str | None = None) -> dict:
    scope = {"user_id": user["user_id"]}
    if experience_id is not None:
        scope["experience_id"] = experience_id
    return scope


def library_public(doc: dict) -> dict:
    result = dict(doc)
    result.pop("_id", None)
    result.pop("user_id", None)
    result.pop("name_key", None)
    return result


async def get_owned_library_skill(user: dict, skill_id: str) -> dict:
    doc = await db.library_skills.find_one(library_skill_scope(user, skill_id))
    if not doc:
        raise HTTPException(status_code=404, detail="Skill not found")
    return doc


async def get_owned_library_experience(user: dict, experience_id: str) -> dict:
    doc = await db.library_experiences.find_one(library_experience_scope(user, experience_id))
    if not doc:
        raise HTTPException(status_code=404, detail="Experience not found")
    return doc


async def validate_owned_library_skills(user: dict, skill_ids: list[str]) -> None:
    if not skill_ids:
        return
    count = await db.library_skills.count_documents({
        "user_id": user["user_id"],
        "skill_id": {"$in": skill_ids},
    })
    if count != len(skill_ids):
        raise HTTPException(status_code=422, detail="One or more selected skills do not exist")


async def validate_showcase_items(user: dict, ids: list[str], kind: str) -> None:
    if not ids:
        return
    if kind == "skill":
        docs = await db.library_skills.find({
            "user_id": user["user_id"], "skill_id": {"$in": ids},
        }, {"skill_id": 1}).to_list(3)
    else:
        docs = await db.library_experiences.find({
            "user_id": user["user_id"], "experience_id": {"$in": ids},
        }, {"experience_id": 1, "type": 1}).to_list(3)
    if len(docs) != len(ids):
        raise HTTPException(status_code=404, detail="Showcase item not found")
    if kind == "experience" and any(doc.get("type") in {"Project", "Accomplishment"} for doc in docs):
        raise HTTPException(status_code=422, detail="Top experiences must use experience records")
    if kind == "project" and any(doc.get("type") != "Project" for doc in docs):
        raise HTTPException(status_code=422, detail="Top projects must use project records")


def library_experience_fields(input: LibraryExperienceInput) -> dict:
    values = input.model_dump()
    values["start_date"] = input.start_date.isoformat() if input.start_date else None
    values["end_date"] = input.end_date.isoformat() if input.end_date else None
    return values


@api_router.get("/library")
async def get_library(user: dict = Depends(get_current_user)):
    skills = await db.library_skills.find(
        library_skill_scope(user), {"_id": 0, "user_id": 0, "name_key": 0}
    ).sort("name", 1).to_list(500)
    experiences = await db.library_experiences.find(
        library_experience_scope(user), {"_id": 0, "user_id": 0}
    ).sort([("updated_at", -1), ("title", 1)]).to_list(500)
    evidence_counts: dict[str, int] = defaultdict(int)
    for experience in experiences:
        for skill_id in experience.get("skill_ids", []):
            evidence_counts[skill_id] += 1
    for skill in skills:
        skill["evidence_count"] = evidence_counts.get(skill["skill_id"], 0)
    return {
        "skills": skills,
        "experiences": experiences,
        "summary": {
            "skill_count": len(skills),
            "experience_count": len(experiences),
            "evidenced_skill_count": sum(1 for skill in skills if skill["evidence_count"] > 0),
        },
    }


@api_router.put("/library/showcase")
async def update_library_showcase(
    input: LibraryShowcaseInput, user: dict = Depends(get_current_user),
):
    skills = [item for item in input.skill_ids if item]
    experiences = [item for item in input.experience_ids if item]
    projects = [item for item in input.project_ids if item]
    await validate_showcase_items(user, skills, "skill")
    await validate_showcase_items(user, experiences, "experience")
    await validate_showcase_items(user, projects, "project")

    await db.library_skills.update_many(
        library_skill_scope(user), {"$unset": {"showcase_rank": ""}},
    )
    await db.library_experiences.update_many(
        library_experience_scope(user), {"$unset": {"showcase_rank": ""}},
    )
    now = now_utc().isoformat()
    for rank, skill_id in enumerate(input.skill_ids, 1):
        if skill_id:
            await db.library_skills.update_one(
                library_skill_scope(user, skill_id),
                {"$set": {"showcase_rank": rank, "updated_at": now}},
            )
    for selected in (input.experience_ids, input.project_ids):
        for rank, experience_id in enumerate(selected, 1):
            if experience_id:
                await db.library_experiences.update_one(
                    library_experience_scope(user, experience_id),
                    {"$set": {"showcase_rank": rank, "updated_at": now}},
                )
    return {"ok": True}


@api_router.post("/library/skills")
async def create_library_skill(input: LibrarySkillInput, user: dict = Depends(get_current_user)):
    now = now_utc().isoformat()
    doc = {
        **input.model_dump(),
        "skill_id": f"skill_{uuid.uuid4().hex[:12]}",
        "user_id": user["user_id"],
        "name_key": input.name.casefold(),
        "created_at": now,
        "updated_at": now,
    }
    try:
        await insert_library_record(
            db, user["user_id"], "library_skills", doc, LIBRARY_RECORD_LIMIT
        )
    except DuplicateKeyError as exc:
        raise HTTPException(status_code=409, detail="You already have a skill with this name") from exc
    result = library_public(doc)
    result["evidence_count"] = 0
    return result


@api_router.put("/library/skills/{skill_id}")
async def update_library_skill(
    skill_id: str, input: LibrarySkillInput, user: dict = Depends(get_current_user),
):
    await get_owned_library_skill(user, skill_id)
    updates = {
        **input.model_dump(),
        "name_key": input.name.casefold(),
        "updated_at": now_utc().isoformat(),
    }
    try:
        await db.library_skills.update_one(library_skill_scope(user, skill_id), {"$set": updates})
    except DuplicateKeyError as exc:
        raise HTTPException(status_code=409, detail="You already have a skill with this name") from exc
    doc = await get_owned_library_skill(user, skill_id)
    doc["evidence_count"] = await db.library_experiences.count_documents({
        "user_id": user["user_id"], "skill_ids": skill_id,
    })
    return library_public(doc)


@api_router.delete("/library/skills/{skill_id}")
async def delete_library_skill(skill_id: str, user: dict = Depends(get_current_user)):
    await get_owned_library_skill(user, skill_id)
    await db.library_skills.delete_one(library_skill_scope(user, skill_id))
    await db.library_experiences.update_many(
        {"user_id": user["user_id"], "skill_ids": skill_id},
        {"$pull": {"skill_ids": skill_id}, "$set": {"updated_at": now_utc().isoformat()}},
    )
    return {"ok": True}


@api_router.post("/library/experiences")
async def create_library_experience(
    input: LibraryExperienceInput, user: dict = Depends(get_current_user),
):
    await validate_owned_library_skills(user, input.skill_ids)
    now = now_utc().isoformat()
    doc = {
        **library_experience_fields(input),
        "experience_id": f"exp_{uuid.uuid4().hex[:12]}",
        "user_id": user["user_id"],
        "created_at": now,
        "updated_at": now,
    }
    await insert_library_record(
        db, user["user_id"], "library_experiences", doc, LIBRARY_RECORD_LIMIT
    )
    return library_public(doc)


@api_router.put("/library/experiences/{experience_id}")
async def update_library_experience(
    experience_id: str,
    input: LibraryExperienceInput,
    user: dict = Depends(get_current_user),
):
    existing = await get_owned_library_experience(user, experience_id)
    await validate_owned_library_skills(user, input.skill_ids)
    updates = {
        **library_experience_fields(input),
        "updated_at": now_utc().isoformat(),
    }
    await db.library_experiences.update_one(
        library_experience_scope(user, experience_id), {"$set": updates}
    )
    old_group = "project" if existing.get("type") == "Project" else "experience"
    new_group = "project" if input.type == "Project" else "experience"
    if input.type == "Accomplishment" or old_group != new_group:
        await db.library_experiences.update_one(
            library_experience_scope(user, experience_id), {"$unset": {"showcase_rank": ""}}
        )
    return library_public(await get_owned_library_experience(user, experience_id))


@api_router.delete("/library/experiences/{experience_id}")
async def delete_library_experience(
    experience_id: str, user: dict = Depends(get_current_user),
):
    await get_owned_library_experience(user, experience_id)
    await db.library_experiences.delete_one(library_experience_scope(user, experience_id))
    return {"ok": True}


# ---------- Application routes ----------
async def _app_to_public(doc: dict) -> dict:
    doc = dict(doc)
    doc.pop("_id", None)
    doc.pop("user_id", None)
    if "attachments" in doc:
        doc["attachments"] = [
            {key: value for key, value in attachment.items() if key != "storage_path"}
            for attachment in doc.get("attachments", [])
        ]
    if "calendar_sync" in doc:
        doc["calendar_sync"] = public_application_sync(doc.get("calendar_sync"))
    return doc


def application_scope(user: dict, app_id: str | None = None) -> dict:
    scope = {"user_id": user["user_id"]}
    if app_id is not None:
        scope["app_id"] = app_id
    return scope


async def get_owned_application(user: dict, app_id: str) -> dict:
    doc = await db.applications.find_one(application_scope(user, app_id))
    if not doc:
        # A uniform 404 does not reveal whether another user owns the identifier.
        raise HTTPException(status_code=404, detail="Application not found")
    return doc


@api_router.post("/applications")
async def create_application(input: ApplicationInput, user: dict = Depends(get_current_user)):
    doc = input.model_dump()
    doc["app_id"] = f"app_{uuid.uuid4().hex[:12]}"
    doc["user_id"] = user["user_id"]
    doc["created_at"] = now_utc().isoformat()
    doc["updated_at"] = now_utc().isoformat()
    doc["activity"] = [{"type": "created", "at": now_utc().isoformat()}]
    await insert_applications(db, user["user_id"], [doc], APPLICATION_LIMIT)
    return await _app_to_public(dict(doc))


@api_router.post("/applications/bulk")
async def bulk_create_applications(
    items: List[ApplicationInput], request: Request, user: dict = Depends(get_current_user),
):
    await enforce_rate_limit(request, "bulk_import", user["user_id"], limit=10, window_seconds=3600)
    if not items:
        raise HTTPException(status_code=422, detail="Import at least one application.")
    if len(items) > BULK_IMPORT_LIMIT:
        raise HTTPException(status_code=413, detail=f"A CSV import can contain up to {BULK_IMPORT_LIMIT:,} applications.")
    documents = []
    for item in items:
        doc = item.model_dump()
        doc["app_id"] = f"app_{uuid.uuid4().hex[:12]}"
        doc["user_id"] = user["user_id"]
        doc["created_at"] = now_utc().isoformat()
        doc["updated_at"] = now_utc().isoformat()
        doc["activity"] = [{"type": "created", "at": now_utc().isoformat()}]
        documents.append(doc)
    await insert_applications(db, user["user_id"], documents, APPLICATION_LIMIT)
    return {"created": len(documents)}


@api_router.get("/applications")
async def list_applications(user: dict = Depends(get_current_user)):
    docs = await db.applications.find(application_scope(user)).sort("day_applied", -1).to_list(APPLICATION_LIMIT)
    return [await _app_to_public(doc) for doc in docs]


@api_router.put("/applications/{app_id}")
async def update_application(app_id: str, input: ApplicationInput, user: dict = Depends(get_current_user)):
    scope = application_scope(user, app_id)
    existing = await get_owned_application(user, app_id)
    update = input.model_dump()
    update["updated_at"] = now_utc().isoformat()
    await db.applications.update_one(scope, {"$set": update})
    if update.get("status") != existing.get("status"):
        await db.applications.update_one(
            scope,
            {"$push": {"activity": {
                "type": "status", "from": existing.get("status"),
                "to": update.get("status"), "at": now_utc().isoformat(),
            }}},
        )
    current = await get_owned_application(user, app_id)
    for kind, field in (("interview", "interview_date"), ("follow_up", "follow_up_date")):
        sync_data = current.get("calendar_sync", {}).get(kind, {})
        if not sync_data.get("enabled"):
            continue
        if not current.get(field):
            try:
                await remove_application_google_item(user, current, kind)
            except CalendarSyncError:
                await db.applications.update_one(scope, {"$set": {
                    f"{application_calendar_path(kind)}.status": "error",
                    f"{application_calendar_path(kind)}.last_error": "google_cleanup_failed",
                }})
        else:
            try:
                await sync_application_item(user, current, kind)
            except CalendarSyncError as exc:
                await db.applications.update_one(scope, {"$set": {
                    f"{application_calendar_path(kind)}.status": "error",
                    f"{application_calendar_path(kind)}.last_error": str(exc),
                }})
    return await _app_to_public(await get_owned_application(user, app_id))


@api_router.post("/applications/{app_id}/google-calendar")
async def set_application_google_calendar(
    app_id: str,
    input: ApplicationGoogleSyncInput,
    user: dict = Depends(get_current_user),
):
    existing = await get_owned_application(user, app_id)
    date_field = "interview_date" if input.kind == "interview" else "follow_up_date"
    if input.enabled and not existing.get(date_field):
        raise HTTPException(status_code=422, detail=f"Application has no {input.kind.replace('_', '-')} date")
    if input.enabled:
        await db.applications.update_one(application_scope(user, app_id), {"$set": {
            f"{application_calendar_path(input.kind)}.enabled": True,
            f"{application_calendar_path(input.kind)}.status": "pending",
        }})
        try:
            await sync_application_item(user, await get_owned_application(user, app_id), input.kind)
        except CalendarSyncError as exc:
            await db.applications.update_one(application_scope(user, app_id), {"$set": {
                f"{application_calendar_path(input.kind)}.status": "error",
                f"{application_calendar_path(input.kind)}.last_error": str(exc),
            }})
    else:
        try:
            await remove_application_google_item(user, existing, input.kind)
        except CalendarSyncError as exc:
            await db.applications.update_one(application_scope(user, app_id), {"$set": {
                f"{application_calendar_path(input.kind)}.status": "error",
                f"{application_calendar_path(input.kind)}.last_error": str(exc),
            }})
    return await _app_to_public(await get_owned_application(user, app_id))


@api_router.post("/applications/{app_id}/notes")
async def add_note(app_id: str, input: NoteInput, user: dict = Depends(get_current_user)):
    scope = application_scope(user, app_id)
    await get_owned_application(user, app_id)
    await db.applications.update_one(
        scope,
        {"$push": {"activity": {"type": "note", "text": input.text.strip(), "at": now_utc().isoformat()}},
         "$set": {"updated_at": now_utc().isoformat()}},
    )
    return await _app_to_public(await get_owned_application(user, app_id))


@api_router.post("/applications/{app_id}/attachments")
async def upload_attachment(
    app_id: str,
    request: Request,
    kind: str = Form("other"),
    file: UploadFile = File(...),
    user: dict = Depends(get_current_user),
):
    await enforce_rate_limit(request, "attachment_upload", user["user_id"], limit=30, window_seconds=3600)
    scope = application_scope(user, app_id)
    await get_owned_application(user, app_id)
    if kind not in {"resume", "job_description", "other"}:
        raise HTTPException(status_code=400, detail="Invalid attachment type")
    filename = Path(file.filename or "upload").name
    ext = filename.rsplit(".", 1)[-1].lower() if "." in filename else ""
    if ext not in MIME_TYPES:
        raise HTTPException(status_code=400, detail="Unsupported file type")
    content_type = file.content_type or MIME_TYPES.get(ext, "application/octet-stream")
    att_id = uuid.uuid4().hex
    path = f"{APP_NAME}/uploads/{user['user_id']}/{att_id}.{ext}"
    data = await file.read(MAX_UPLOAD_BYTES + 1)
    if len(data) > MAX_UPLOAD_BYTES:
        raise HTTPException(status_code=413, detail=f"File exceeds the {MAX_UPLOAD_BYTES // (1024 * 1024)} MB limit")
    used_bytes = await attachment_bytes_used(user["user_id"])
    if used_bytes + len(data) > ATTACHMENT_TOTAL_BYTES_LIMIT:
        raise HTTPException(
            status_code=413,
            detail=f"Your free account can store up to {ATTACHMENT_TOTAL_BYTES_LIMIT // (1024 * 1024)} MB of attachments.",
        )
    try:
        result = await run_in_threadpool(put_object, path, data, content_type)
    except Exception as exc:
        logger.exception("Attachment upload failed")
        raise HTTPException(status_code=503, detail="File storage is unavailable") from exc
    att = {
        "id": att_id, "name": filename, "kind": kind,
        "content_type": content_type, "size": result.get("size", len(data)),
        "storage_path": result["path"], "created_at": now_utc().isoformat(),
    }
    try:
        await attach_application_file(
            db, user["user_id"], app_id, att, ATTACHMENT_TOTAL_BYTES_LIMIT
        )
    except Exception:
        # Never leave an unreferenced upload after a failed database write.
        try:
            await run_in_threadpool(delete_object, path)
        except Exception:
            logger.error("Attachment rollback failed; queued for storage reconciliation")
            try:
                await queue_storage_cleanup(path, user["user_id"], "upload_rollback_failed")
            except Exception:
                logger.exception("Attachment cleanup job could not be persisted")
        raise
    return await _app_to_public(await get_owned_application(user, app_id))


@api_router.get("/applications/{app_id}/attachments/{att_id}")
async def download_attachment(app_id: str, att_id: str, user: dict = Depends(get_current_user)):
    existing = await get_owned_application(user, app_id)
    att = next((a for a in existing.get("attachments", []) if a["id"] == att_id), None)
    if not att:
        raise HTTPException(status_code=404, detail="Attachment not found")
    try:
        data, content_type = await run_in_threadpool(get_object, att["storage_path"])
    except ClientError as exc:
        code = str(exc.response.get("Error", {}).get("Code", ""))
        if code in {"404", "NoSuchKey", "NotFound"}:
            raise HTTPException(status_code=404, detail="Stored file not found") from exc
        raise HTTPException(status_code=503, detail="File storage is unavailable") from exc
    return Response(
        content=data, media_type=att.get("content_type", content_type),
        headers={"Content-Disposition": f"inline; filename*=UTF-8''{quote(att['name'])}"},
    )


@api_router.delete("/applications/{app_id}/attachments/{att_id}")
async def delete_attachment(app_id: str, att_id: str, user: dict = Depends(get_current_user)):
    scope = application_scope(user, app_id)
    existing = await get_owned_application(user, app_id)
    att = next((a for a in existing.get("attachments", []) if a["id"] == att_id), None)
    if not att:
        raise HTTPException(status_code=404, detail="Attachment not found")
    try:
        await run_in_threadpool(delete_object, att["storage_path"])
    except Exception as exc:
        logger.exception("Attachment deletion failed")
        raise HTTPException(status_code=503, detail="File storage is unavailable") from exc
    await db.applications.update_one(
        scope,
        {"$pull": {"attachments": {"id": att_id}}, "$set": {"updated_at": now_utc().isoformat()}},
    )
    return await _app_to_public(await get_owned_application(user, app_id))


@api_router.delete("/applications/{app_id}")
async def delete_application(app_id: str, user: dict = Depends(get_current_user)):
    scope = application_scope(user, app_id)
    existing = await get_owned_application(user, app_id)
    try:
        for att in existing.get("attachments", []):
            await run_in_threadpool(delete_object, att["storage_path"])
    except Exception as exc:
        logger.exception("Application attachment cleanup failed")
        raise HTTPException(status_code=503, detail="File storage is unavailable") from exc
    for kind in ("interview", "follow_up"):
        if existing.get("calendar_sync", {}).get(kind, {}).get("google_event_id"):
            try:
                await remove_application_google_item(user, existing, kind)
            except CalendarSyncError:
                logger.warning("Could not remove a linked Google Calendar item while deleting application")
    await db.applications.delete_one(scope)
    return {"ok": True}


# ---------- Application goal ----------
def application_goal_period(
    cadence: str,
    timezone_name: str,
    current_time: datetime | None = None,
) -> tuple[date, date, date]:
    zone = ZoneInfo(timezone_name)
    reference = current_time or now_utc()
    if reference.tzinfo is None:
        reference = reference.replace(tzinfo=timezone.utc)
    today = reference.astimezone(zone).date()
    if cadence == "weekly":
        start = today - timedelta(days=today.weekday())
        end = start + timedelta(days=6)
    else:
        start = today
        end = today
    return today, start, end


async def application_goal_to_public(user: dict, goal: dict | None = None) -> dict:
    goal = goal if goal is not None else user.get("application_goal")
    if not goal:
        return {"configured": False}

    cadence = goal["cadence"]
    target = int(goal["target"])
    timezone_name = goal["timezone"]
    today, period_start, period_end = application_goal_period(cadence, timezone_name)
    count = await db.applications.count_documents({
        "user_id": user["user_id"],
        "day_applied": {
            "$gte": period_start.isoformat(),
            "$lt": (today + timedelta(days=1)).isoformat(),
        },
    })
    remaining = max(target - count, 0)
    return {
        "configured": True,
        "cadence": cadence,
        "target": target,
        "timezone": timezone_name,
        "period_start": period_start.isoformat(),
        "period_end": period_end.isoformat(),
        "count": count,
        "remaining": remaining,
        "complete": count >= target,
        "progress_percent": min(round((count / target) * 100), 100),
        "days_remaining": (period_end - today).days,
        "updated_at": goal.get("updated_at"),
    }


@api_router.get("/application-goal")
async def get_application_goal(user: dict = Depends(get_current_user)):
    return await application_goal_to_public(user)


@api_router.put("/application-goal")
async def set_application_goal(input: ApplicationGoalInput, user: dict = Depends(get_current_user)):
    goal = {
        "cadence": input.cadence,
        "target": input.target,
        "timezone": input.timezone,
        "updated_at": now_utc().isoformat(),
    }
    await db.users.update_one({"user_id": user["user_id"]}, {"$set": {"application_goal": goal}})
    return await application_goal_to_public(user, goal)


@api_router.delete("/application-goal")
async def delete_application_goal(user: dict = Depends(get_current_user)):
    await db.users.update_one({"user_id": user["user_id"]}, {"$unset": {"application_goal": ""}})
    return {"ok": True}


# ---------- Analytics ----------
def _annualize(amount, period):
    if amount is None:
        return None
    if period == "hourly":
        return amount * 2080
    if period == "monthly":
        return amount * 12
    return amount


@api_router.get("/analytics")
async def analytics(user: dict = Depends(get_current_user)):
    apps = await db.applications.find(application_scope(user), {"_id": 0}).to_list(2000)
    total = len(apps)
    statuses = ["Applied", "Screening", "Interviewing", "Offer", "Rejected"]
    status_counts = {s: 0 for s in statuses}
    for a in apps:
        st = a.get("status", "Applied")
        status_counts[st] = status_counts.get(st, 0) + 1

    interviews = status_counts.get("Screening", 0) + status_counts.get("Interviewing", 0)
    offers = status_counts.get("Offer", 0)
    responded = total - status_counts.get("Applied", 0)
    success_rate = round((offers / total * 100), 1) if total else 0.0

    # Volume by month based on day_applied
    monthly = defaultdict(int)
    for a in apps:
        d = a.get("day_applied")
        if d:
            try:
                dt = datetime.fromisoformat(d)
                key = dt.strftime("%Y-%m")
                monthly[key] += 1
            except Exception:
                pass
    volume = [{"month": k, "count": v} for k, v in sorted(monthly.items())][-8:]
    for item in volume:
        y, m = item["month"].split("-")
        item["label"] = datetime(int(y), int(m), 1).strftime("%b %Y")

    # Compensation: annualized pay by company (apps with pay)
    comp = []
    for a in apps:
        annual = _annualize(a.get("pay_amount"), a.get("pay_period"))
        if annual:
            comp.append({"company": a.get("company_name", ""), "pay": round(annual)})
    comp.sort(key=lambda x: x["pay"], reverse=True)
    comp = comp[:8]

    return {
        "kpis": {
            "total": total,
            "interviews": interviews,
            "offers": offers,
            "success_rate": success_rate,
            "responded": responded,
        },
        "status_distribution": [{"status": s, "count": status_counts.get(s, 0)} for s in statuses],
        "volume": volume,
        "compensation": comp,
    }


@api_router.get("/health")
async def health():
    try:
        await db.command("ping")
        await run_in_threadpool(s3.head_bucket, Bucket=S3_BUCKET)
    except Exception as exc:
        logger.error("Health check failed (%s)", type(exc).__name__)
        raise HTTPException(status_code=503, detail="A required service is unavailable") from exc
    return {"status": "ok"}


app.include_router(api_router)
app.include_router(build_resume_router(
    db=db,
    get_current_user=get_current_user,
    now_utc=now_utc,
    put_object=put_object,
    get_object=get_object,
    delete_object=delete_object,
    attach_application_file=attach_application_file,
    account_transaction=account_transaction,
    attachment_limit=ATTACHMENT_TOTAL_BYTES_LIMIT,
    app_name=APP_NAME,
    gemini_key=GEMINI_API_KEY,
    gemini_model=GEMINI_MODEL,
    enabled=RESUME_STUDIO_ENABLED,
    ai_monthly_limit=AI_RESUME_MONTHLY_LIMIT,
))

CORS_ORIGINS = [
    origin.strip()
    for origin in os.environ.get("CORS_ORIGINS", "http://localhost:3000,http://localhost:8080").split(",")
    if origin.strip()
]
CHROME_EXTENSION_ORIGINS = [f"chrome-extension://{extension_id}" for extension_id in CHROME_EXTENSION_IDS]

app.add_middleware(
    CORSMiddleware,
    allow_credentials=True,
    allow_origins=CORS_ORIGINS + CHROME_EXTENSION_ORIGINS,
    allow_origin_regex=r"chrome-extension://.*" if ALLOW_ALL_CHROME_EXTENSIONS else None,
    allow_methods=["*"],
    allow_headers=["*"],
)
if TRUSTED_HOSTS != ["*"]:
    app.add_middleware(TrustedHostMiddleware, allowed_hosts=TRUSTED_HOSTS)


# ---------- Seeding ----------
SAMPLE_APPS = [
    ("Google", "google.com", "Software Engineer Intern", "Interviewing", 45, "yearly", 95000, "High"),
    ("Microsoft", "microsoft.com", "Product Manager Intern", "Screening", 30, "yearly", 90000, "Medium"),
    ("Meta", "meta.com", "Frontend Engineer", "Applied", 12, "yearly", 110000, "Medium"),
    ("Amazon", "amazon.com", "SDE Intern", "Rejected", 60, "hourly", 45, "Low"),
    ("Netflix", "netflix.com", "Data Analyst Intern", "Offer", 75, "yearly", 105000, "High"),
    ("Stripe", "stripe.com", "Backend Engineer", "Interviewing", 20, "yearly", 120000, "High"),
    ("Airbnb", "airbnb.com", "UX Design Intern", "Applied", 8, "monthly", 6500, "Medium"),
    ("Spotify", "spotify.com", "Fullstack Intern", "Screening", 25, "hourly", 40, "Medium"),
    ("Uber", "uber.com", "Mobile Engineer", "Applied", 5, "yearly", 100000, "Low"),
    ("Nvidia", "nvidia.com", "ML Engineer Intern", "Interviewing", 40, "yearly", 115000, "High"),
]


async def seed():
    await db.users.create_index("email", unique=True)
    await db.users.create_index("user_id", unique=True)
    await db.users.create_index("google_sub", unique=True, sparse=True)
    await db.user_sessions.create_index("session_token")
    await db.user_sessions.create_index("session_token_hash", unique=True, sparse=True)
    await db.user_sessions.create_index("expires_at", expireAfterSeconds=0)
    await db.applications.create_index("app_id", unique=True)
    await db.applications.create_index("user_id")
    await db.applications.create_index([("user_id", 1), ("app_id", 1)], unique=True)
    await db.applications.create_index([("user_id", 1), ("day_applied", 1)])
    await db.events.create_index("event_id", unique=True)
    await db.events.create_index([("user_id", 1), ("event_id", 1)], unique=True)
    await db.events.create_index([("user_id", 1), ("starts_at", 1)])
    await db.events.create_index([("user_id", 1), ("start_date", 1)])
    await db.library_skills.create_index("skill_id", unique=True)
    await db.library_skills.create_index([("user_id", 1), ("skill_id", 1)], unique=True)
    await db.library_skills.create_index([("user_id", 1), ("name_key", 1)], unique=True)
    await db.library_experiences.create_index("experience_id", unique=True)
    await db.library_experiences.create_index([("user_id", 1), ("experience_id", 1)], unique=True)
    await db.library_experiences.create_index([("user_id", 1), ("updated_at", -1)])
    await db.google_calendar_connections.create_index("user_id", unique=True)
    await db.oauth_states.create_index("state", unique=True)
    await db.oauth_states.create_index("expires_at", expireAfterSeconds=0)
    await db.ai_flyer_usage.create_index("expires_at", expireAfterSeconds=0)
    await db.ai_resume_usage.create_index("expires_at", expireAfterSeconds=0)
    await db.resume_profiles.create_index("user_id", unique=True)
    await db.resumes.create_index("resume_id", unique=True)
    await db.resumes.create_index([("user_id", 1), ("resume_id", 1)], unique=True)
    await db.resumes.create_index(
        [("user_id", 1), ("is_default", 1)], unique=True,
        partialFilterExpression={"is_default": True},
    )
    await db.resume_versions.create_index("version_id", unique=True)
    await db.resume_versions.create_index([("user_id", 1), ("resume_id", 1), ("updated_at", -1)])
    await db.resume_versions.create_index([("user_id", 1), ("application_id", 1), ("updated_at", -1)])
    await db.rate_limits.create_index("expires_at", expireAfterSeconds=0)
    await db.storage_cleanup_jobs.create_index("created_at")

    if not env_bool("SEED_DEMO_DATA", False):
        return

    admin_email = os.environ.get("DEMO_EMAIL")
    admin_password = os.environ.get("DEMO_PASSWORD")
    if not admin_email or not admin_password:
        raise RuntimeError("DEMO_EMAIL and DEMO_PASSWORD are required when SEED_DEMO_DATA=true")
    admin_email = admin_email.lower()
    user = await db.users.find_one({"email": admin_email})
    if not user:
        user_id = f"user_{uuid.uuid4().hex[:12]}"
        user = {
            "user_id": user_id, "email": admin_email, "name": "Demo User",
            "password_hash": hash_password(admin_password), "picture": None,
            "auth_provider": "email", "auth_providers": ["email"],
            "created_at": now_utc().isoformat(),
        }
        await db.users.insert_one(user)
    elif not verify_password(admin_password, user.get("password_hash", "")):
        await db.users.update_one({"email": admin_email}, {"$set": {"password_hash": hash_password(admin_password)}})

    uid = (await db.users.find_one({"email": admin_email}))["user_id"]
    if await db.applications.count_documents({"user_id": uid}) == 0:
        for i, (name, domain, title, status, days_ago, period, amount, conf) in enumerate(SAMPLE_APPS):
            applied = (now_utc() - timedelta(days=days_ago)).date().isoformat()
            tbd = status in ("Applied", "Screening", "Rejected")
            start = None
            month_only = False
            if not tbd:
                start = (now_utc() + timedelta(days=95)).date().replace(day=1).isoformat()
                month_only = True
            follow = None
            if status in ("Applied", "Screening", "Interviewing"):
                follow = (now_utc() - timedelta(days=days_ago) + timedelta(days=14)).date().isoformat()
            interview = None
            if status == "Interviewing":
                interview = (now_utc() + timedelta(days=(i % 6) + 2)).replace(
                    hour=14, minute=0, second=0, microsecond=0).isoformat()
            await db.applications.insert_one({
                "app_id": f"app_{uuid.uuid4().hex[:12]}", "user_id": uid,
                "company_name": name, "company_domain": domain, "job_title": title,
                "day_applied": applied, "expected_start_date": start, "start_date_tbd": tbd,
                "start_date_month_only": month_only, "interview_date": interview,
                "description": f"{title} position at {name}.", "pay_amount": amount,
                "pay_period": period, "confidence_level": conf, "follow_up_date": follow,
                "status": status,
                "activity": [{"type": "created", "at": now_utc().isoformat()}],
                "created_at": now_utc().isoformat(), "updated_at": now_utc().isoformat(),
            })


@app.on_event("startup")
async def on_startup():
    global storage_reconciliation_task
    try:
        await run_in_threadpool(init_storage)
        logger.info("Object storage initialized")
    except Exception as e:
        logger.error("Storage init failed (%s)", type(e).__name__)
        if STORAGE_REQUIRED:
            raise
    await seed()
    storage_reconciliation_task = asyncio.create_task(storage_reconciliation_loop())


@app.on_event("shutdown")
async def shutdown_db_client():
    if storage_reconciliation_task:
        storage_reconciliation_task.cancel()
        try:
            await storage_reconciliation_task
        except asyncio.CancelledError:
            pass
    client.close()
