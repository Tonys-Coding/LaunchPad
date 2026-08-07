from dotenv import load_dotenv
from pathlib import Path
import os

ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / '.env')

from fastapi import FastAPI, APIRouter, HTTPException, Request, Response, Depends
from starlette.middleware.cors import CORSMiddleware
from motor.motor_asyncio import AsyncIOMotorClient
import logging
from pydantic import BaseModel, Field, EmailStr
from typing import List, Optional
from datetime import datetime, timezone, timedelta
from collections import defaultdict
import uuid
import secrets
import bcrypt
import httpx

mongo_url = os.environ['MONGO_URL']
client = AsyncIOMotorClient(mongo_url)
db = client[os.environ['DB_NAME']]

app = FastAPI()
api_router = APIRouter(prefix="/api")

SESSION_DAYS = 7
EMERGENT_SESSION_URL = "https://demobackend.emergentagent.com/auth/v1/env/oauth/session-data"

logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(name)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)


# ---------- Helpers ----------
def hash_password(password: str) -> str:
    return bcrypt.hashpw(password.encode("utf-8"), bcrypt.gensalt()).decode("utf-8")


def verify_password(plain: str, hashed: str) -> bool:
    try:
        return bcrypt.checkpw(plain.encode("utf-8"), hashed.encode("utf-8"))
    except Exception:
        return False


def now_utc() -> datetime:
    return datetime.now(timezone.utc)


def set_session_cookie(response: Response, token: str):
    response.set_cookie(
        key="session_token", value=token, httponly=True, secure=True,
        samesite="none", max_age=SESSION_DAYS * 24 * 3600, path="/",
    )


async def create_session(user_id: str) -> str:
    token = secrets.token_urlsafe(32)
    await db.user_sessions.insert_one({
        "user_id": user_id,
        "session_token": token,
        "expires_at": (now_utc() + timedelta(days=SESSION_DAYS)).isoformat(),
        "created_at": now_utc().isoformat(),
    })
    return token


def public_user(doc: dict) -> dict:
    return {
        "user_id": doc["user_id"],
        "email": doc["email"],
        "name": doc.get("name", ""),
        "picture": doc.get("picture"),
        "auth_provider": doc.get("auth_provider", "email"),
    }


async def get_current_user(request: Request) -> dict:
    token = request.cookies.get("session_token")
    if not token:
        auth = request.headers.get("Authorization", "")
        if auth.startswith("Bearer "):
            token = auth[7:]
    if not token:
        raise HTTPException(status_code=401, detail="Not authenticated")
    sess = await db.user_sessions.find_one({"session_token": token}, {"_id": 0})
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
    password: str = Field(min_length=6)
    name: str = Field(min_length=1)


class LoginInput(BaseModel):
    email: EmailStr
    password: str


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
    status: str = "Applied"


# ---------- Auth routes ----------
@api_router.post("/auth/register")
async def register(input: RegisterInput, response: Response):
    email = input.email.lower()
    if await db.users.find_one({"email": email}):
        raise HTTPException(status_code=400, detail="Email already registered")
    user_id = f"user_{uuid.uuid4().hex[:12]}"
    doc = {
        "user_id": user_id, "email": email, "name": input.name,
        "password_hash": hash_password(input.password), "picture": None,
        "auth_provider": "email", "created_at": now_utc().isoformat(),
    }
    await db.users.insert_one(doc)
    token = await create_session(user_id)
    set_session_cookie(response, token)
    return public_user(doc)


@api_router.post("/auth/login")
async def login(input: LoginInput, response: Response):
    email = input.email.lower()
    user = await db.users.find_one({"email": email})
    if not user or not user.get("password_hash") or not verify_password(input.password, user["password_hash"]):
        raise HTTPException(status_code=401, detail="Invalid email or password")
    token = await create_session(user["user_id"])
    set_session_cookie(response, token)
    return public_user(user)


@api_router.post("/auth/session")
async def google_session(request: Request, response: Response):
    session_id = request.headers.get("X-Session-ID")
    if not session_id:
        raise HTTPException(status_code=400, detail="Missing session id")
    async with httpx.AsyncClient(timeout=15) as hc:
        r = await hc.get(EMERGENT_SESSION_URL, headers={"X-Session-ID": session_id})
    if r.status_code != 200:
        raise HTTPException(status_code=401, detail="Invalid session id")
    data = r.json()
    email = data["email"].lower()
    user = await db.users.find_one({"email": email})
    if not user:
        user_id = f"user_{uuid.uuid4().hex[:12]}"
        user = {
            "user_id": user_id, "email": email, "name": data.get("name", ""),
            "picture": data.get("picture"), "auth_provider": "google",
            "created_at": now_utc().isoformat(),
        }
        await db.users.insert_one(user)
    else:
        await db.users.update_one({"email": email}, {"$set": {
            "name": data.get("name", user.get("name", "")),
            "picture": data.get("picture", user.get("picture")),
        }})
        user = await db.users.find_one({"email": email})
    token = await create_session(user["user_id"])
    set_session_cookie(response, token)
    return public_user(user)


@api_router.get("/auth/me")
async def me(user: dict = Depends(get_current_user)):
    return public_user(user)


@api_router.post("/auth/logout")
async def logout(request: Request, response: Response):
    token = request.cookies.get("session_token")
    if token:
        await db.user_sessions.delete_many({"session_token": token})
    response.delete_cookie("session_token", path="/")
    return {"ok": True}


# ---------- Application routes ----------
async def _app_to_public(doc: dict) -> dict:
    doc.pop("_id", None)
    doc.pop("user_id", None)
    return doc


@api_router.post("/applications")
async def create_application(input: ApplicationInput, user: dict = Depends(get_current_user)):
    doc = input.model_dump()
    doc["app_id"] = f"app_{uuid.uuid4().hex[:12]}"
    doc["user_id"] = user["user_id"]
    doc["created_at"] = now_utc().isoformat()
    doc["updated_at"] = now_utc().isoformat()
    await db.applications.insert_one(dict(doc))
    return await _app_to_public(dict(doc))


@api_router.post("/applications/bulk")
async def bulk_create_applications(items: List[ApplicationInput], user: dict = Depends(get_current_user)):
    created = 0
    for item in items:
        doc = item.model_dump()
        doc["app_id"] = f"app_{uuid.uuid4().hex[:12]}"
        doc["user_id"] = user["user_id"]
        doc["created_at"] = now_utc().isoformat()
        doc["updated_at"] = now_utc().isoformat()
        await db.applications.insert_one(dict(doc))
        created += 1
    return {"created": created}


@api_router.get("/applications")
async def list_applications(user: dict = Depends(get_current_user)):
    docs = await db.applications.find({"user_id": user["user_id"]}, {"_id": 0}).sort("day_applied", -1).to_list(1000)
    for d in docs:
        d.pop("user_id", None)
    return docs


@api_router.put("/applications/{app_id}")
async def update_application(app_id: str, input: ApplicationInput, user: dict = Depends(get_current_user)):
    existing = await db.applications.find_one({"app_id": app_id, "user_id": user["user_id"]})
    if not existing:
        raise HTTPException(status_code=404, detail="Application not found")
    update = input.model_dump()
    update["updated_at"] = now_utc().isoformat()
    await db.applications.update_one({"app_id": app_id}, {"$set": update})
    doc = await db.applications.find_one({"app_id": app_id}, {"_id": 0})
    doc.pop("user_id", None)
    return doc


@api_router.delete("/applications/{app_id}")
async def delete_application(app_id: str, user: dict = Depends(get_current_user)):
    res = await db.applications.delete_one({"app_id": app_id, "user_id": user["user_id"]})
    if res.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Application not found")
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
    apps = await db.applications.find({"user_id": user["user_id"]}, {"_id": 0}).to_list(2000)
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


app.include_router(api_router)

app.add_middleware(
    CORSMiddleware,
    allow_credentials=True,
    allow_origins=os.environ.get('CORS_ORIGINS', '*').split(','),
    allow_methods=["*"],
    allow_headers=["*"],
)


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
    await db.user_sessions.create_index("session_token")
    await db.applications.create_index("app_id", unique=True)
    await db.applications.create_index("user_id")

    admin_email = os.environ.get("ADMIN_EMAIL", "demo@careertrack.com").lower()
    admin_password = os.environ.get("ADMIN_PASSWORD", "demo1234")
    user = await db.users.find_one({"email": admin_email})
    if not user:
        user_id = f"user_{uuid.uuid4().hex[:12]}"
        user = {
            "user_id": user_id, "email": admin_email, "name": "Demo User",
            "password_hash": hash_password(admin_password), "picture": None,
            "auth_provider": "email", "created_at": now_utc().isoformat(),
        }
        await db.users.insert_one(user)
    elif not verify_password(admin_password, user.get("password_hash", "")):
        await db.users.update_one({"email": admin_email}, {"$set": {"password_hash": hash_password(admin_password)}})

    uid = (await db.users.find_one({"email": admin_email}))["user_id"]
    if await db.applications.count_documents({"user_id": uid}) == 0:
        for name, domain, title, status, days_ago, period, amount, conf in SAMPLE_APPS:
            applied = (now_utc() - timedelta(days=days_ago)).date().isoformat()
            start = None
            tbd = status in ("Applied", "Screening", "Rejected")
            if not tbd:
                start = (now_utc() + timedelta(days=90)).date().isoformat()
            follow = None
            if status in ("Applied", "Screening", "Interviewing"):
                follow = (now_utc() - timedelta(days=days_ago) + timedelta(days=14)).date().isoformat()
            await db.applications.insert_one({
                "app_id": f"app_{uuid.uuid4().hex[:12]}", "user_id": uid,
                "company_name": name, "company_domain": domain, "job_title": title,
                "day_applied": applied, "expected_start_date": start, "start_date_tbd": tbd,
                "description": f"{title} position at {name}.", "pay_amount": amount,
                "pay_period": period, "confidence_level": conf, "follow_up_date": follow,
                "status": status,
                "created_at": now_utc().isoformat(), "updated_at": now_utc().isoformat(),
            })


@app.on_event("startup")
async def on_startup():
    await seed()


@app.on_event("shutdown")
async def shutdown_db_client():
    client.close()
