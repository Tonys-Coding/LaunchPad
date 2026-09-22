"""Regression tests for production account-data and abuse protection boundaries."""
import asyncio
import io
import json
import os
import sys
import zipfile
import logging
from datetime import datetime, timedelta, timezone
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import AsyncMock, Mock

import bcrypt
import pytest
from botocore.exceptions import EndpointConnectionError
from botocore.exceptions import ClientError
from fastapi import HTTPException, Request, Response

os.environ.setdefault("MONGO_URL", "mongodb://localhost:27017")
os.environ.setdefault("DB_NAME", "launchpad_unit")
os.environ.setdefault("GOOGLE_CALENDAR_TOKEN_KEY", "MDEyMzQ1Njc4OWFiY2RlZjAxMjM0NTY3ODlhYmNkZWY=")
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import server


def test_production_storage_does_not_create_a_missing_bucket(monkeypatch):
    missing = ClientError({"Error": {"Code": "NoSuchBucket"}}, "HeadBucket")
    storage = SimpleNamespace(
        head_bucket=Mock(side_effect=missing),
        create_bucket=Mock(),
    )
    monkeypatch.setattr(server, "s3", storage)
    monkeypatch.setattr(server, "S3_CREATE_BUCKET_IF_MISSING", False)
    monkeypatch.setattr(server.time, "sleep", lambda _seconds: None)
    with pytest.raises(RuntimeError, match="Object storage is unavailable"):
        server.init_storage()
    storage.create_bucket.assert_not_called()


def test_development_storage_can_create_a_missing_bucket(monkeypatch):
    missing = ClientError({"Error": {"Code": "NoSuchBucket"}}, "HeadBucket")
    storage = SimpleNamespace(
        head_bucket=Mock(side_effect=missing),
        create_bucket=Mock(),
    )
    monkeypatch.setattr(server, "s3", storage)
    monkeypatch.setattr(server, "S3_CREATE_BUCKET_IF_MISSING", True)
    server.init_storage()
    storage.create_bucket.assert_called_once_with(Bucket=server.S3_BUCKET)


def test_validation_errors_do_not_echo_submitted_secrets():
    from fastapi.exceptions import RequestValidationError
    error = RequestValidationError([{
        "loc": ("body", "password"), "type": "value_error",
        "msg": "Value error, secret-password", "input": "secret-password",
        "ctx": {"error": ValueError("secret-password")},
    }])
    response = asyncio.run(server.safe_validation_error(request(), error))
    assert response.status_code == 422
    assert b"secret-password" not in response.body
    assert json.loads(response.body)["detail"][0]["loc"] == ["body", "password"]


def test_structured_exception_logs_omit_exception_contents():
    try:
        raise ValueError("private-token-and-document-content")
    except ValueError:
        record = logging.LogRecord("test", logging.ERROR, __file__, 1,
                                   "Upload failed", (), sys.exc_info())
    rendered = server.JsonLogFormatter().format(record)
    assert "private-token" not in rendered
    assert json.loads(rendered)["exception_type"] == "ValueError"


@pytest.mark.parametrize("missing_application", [False, True])
def test_upload_rolls_back_object_when_database_write_fails(monkeypatch, missing_application):
    from starlette.datastructures import UploadFile
    write_error = HTTPException(status_code=404) if missing_application else RuntimeError("database unavailable")
    attach = AsyncMock(side_effect=write_error)
    monkeypatch.setattr(server, "attach_application_file", attach)
    monkeypatch.setattr(server, "get_owned_application", AsyncMock(return_value={}))
    monkeypatch.setattr(server, "enforce_rate_limit", AsyncMock())
    monkeypatch.setattr(server, "attachment_bytes_used", AsyncMock(return_value=0))
    uploaded, removed = [], []
    def put(path, data, content_type):
        uploaded.append(path)
        return {"path": path, "size": len(data)}
    monkeypatch.setattr(server, "put_object", put)
    monkeypatch.setattr(server, "delete_object", removed.append)
    async def run():
        with pytest.raises(HTTPException if missing_application else RuntimeError):
            await server.upload_attachment("app", request(), "resume",
                                           UploadFile(io.BytesIO(b"resume"), filename="resume.txt"),
                                           {"user_id": "owner"})
    asyncio.run(run())
    assert len(uploaded) == 1
    assert uploaded == removed
    attach.assert_awaited_once()


def request():
    return Request({"type": "http", "headers": [(b"cookie", b"session_token=test-session")],
                    "client": ("127.0.0.1", 5000), "method": "GET", "path": "/"})


def test_passwords_use_characters_after_bcrypt_byte_limit_and_keep_legacy_login():
    password = "a" * 100
    encoded = server.hash_password(password)
    assert server.verify_password(password, encoded)
    assert not server.verify_password("a" * 99 + "b", encoded)
    unicode_password = "🔒" * 100
    assert server.verify_password(unicode_password, server.hash_password(unicode_password))
    legacy = bcrypt.hashpw(b"old-password", bcrypt.gensalt()).decode()
    assert server.verify_password("old-password", legacy)
    assert not server.verify_password("wrong-password", legacy)


def test_rate_limit_counts_are_atomic_private_and_return_retry_after(monkeypatch):
    calls = []
    async def increment(scope, update, **kwargs):
        calls.append((scope, update, kwargs))
        return {"count": len(calls)}
    monkeypatch.setattr(server, "RATE_LIMITING_ENABLED", True)
    monkeypatch.setattr(server, "db", SimpleNamespace(rate_limits=SimpleNamespace(find_one_and_update=increment)))
    monkeypatch.setattr(server, "now_utc", lambda: datetime(2026, 9, 12, 10, 0, tzinfo=timezone.utc))
    async def run():
        await server.enforce_rate_limit(request(), "login", "private@example.com", limit=1, window_seconds=60)
        with pytest.raises(HTTPException) as caught:
            await server.enforce_rate_limit(request(), "login", "private@example.com", limit=1, window_seconds=60)
        assert caught.value.status_code == 429
        assert caught.value.headers["Retry-After"] == "60"
    asyncio.run(run())
    assert calls[0][0] == calls[1][0]
    assert calls[0][1]["$inc"] == {"count": 1}
    assert calls[0][2]["upsert"] is True
    assert "private@example.com" not in repr(calls)


def test_spoofed_forwarded_header_is_not_used_by_limiter():
    spoofed = Request({"type": "http", "headers": [(b"x-forwarded-for", b"attacker-value")],
                       "client": ("127.0.0.1", 1)})
    assert server.request_ip(spoofed) == "127.0.0.1"


class Collection:
    def __init__(self, records=()):
        self.records = list(records)
        self.scopes = []
        self.delete_many = AsyncMock()
    def find(self, scope, *args):
        self.scopes.append(scope)
        return self
    def sort(self, *args):
        return self
    async def to_list(self, limit):
        # Export and deletion must never truncate legacy accounts at a quota.
        assert limit is None
        return self.records


def data_store():
    store = SimpleNamespace(**{name: Collection() for name in (
        "applications", "events", "library_skills", "library_experiences",
        "resumes", "resume_versions", "google_calendar_connections", "oauth_states",
        "ai_flyer_usage", "ai_resume_usage", "user_sessions", "rate_limits",
    )})
    store.resume_profiles = SimpleNamespace(find_one=AsyncMock(return_value=None))
    store.users = SimpleNamespace(delete_one=AsyncMock())
    return store


def test_complete_export_redacts_credentials_and_stream_closes(monkeypatch):
    store = data_store()
    store.applications.records = [{"app_id": "one", "user_id": "owner", "notes": [{"text": "Private note"}],
                                   "attachments": [{"id": "file", "name": "resume.txt", "storage_path": "private/key"}]}]
    monkeypatch.setattr(server, "db", store)
    monkeypatch.setattr(server, "enforce_rate_limit", AsyncMock())
    monkeypatch.setattr(server, "get_object", lambda path: (b"resume-content", "text/plain"))
    async def run():
        response = await server.export_account_data(request(), {
            "user_id": "owner", "email": "owner@example.com", "password_hash": "secret-hash",
            "preferences": {"theme": "dark", "timezone": "UTC"}, "application_goal": {"target": 3},
        })
        assert response.headers["cache-control"] == "no-store"
        payload = b"".join([chunk async for chunk in response.body_iterator])
        await response.background()
        with zipfile.ZipFile(io.BytesIO(payload)) as archive:
            assert json.loads(archive.read("manifest.json"))["format_version"] == 2
            assert archive.read("attachments/one/file-resume.txt") == b"resume-content"
            account = json.loads(archive.read("account.json"))
            assert account["application_goal"]["target"] == 3
            assert account["preferences"]["theme"] == "dark"
            assert "secret-hash" not in archive.read("account.json").decode()
            applications = archive.read("applications.json").decode()
            assert "Private note" in applications
            assert "storage_path" not in applications
            assert "user_id" not in applications
    asyncio.run(run())
    assert all(collection.scopes == [{"user_id": "owner"}] for collection in (
        store.applications, store.events, store.library_skills, store.library_experiences,
        store.resumes, store.resume_versions,
    ))


def test_export_storage_failure_returns_clear_error(monkeypatch):
    store = data_store()
    store.applications.records = [{"app_id": "one", "attachments": [{"storage_path": "key"}]}]
    monkeypatch.setattr(server, "db", store)
    monkeypatch.setattr(server, "enforce_rate_limit", AsyncMock())
    def unavailable(path):
        raise EndpointConnectionError(endpoint_url="http://private-storage")
    monkeypatch.setattr(server, "get_object", unavailable)
    with pytest.raises(HTTPException) as caught:
        asyncio.run(server.export_account_data(request(), {"user_id": "owner", "email": "owner@example.com"}))
    assert caught.value.status_code == 503
    assert "private-storage" not in caught.value.detail


def test_deletion_keeps_account_retryable_after_storage_failure(monkeypatch):
    store = data_store()
    monkeypatch.setattr(server, "db", store)
    monkeypatch.setattr(server, "require_recent_session", AsyncMock())
    begin = AsyncMock()
    finish = AsyncMock(return_value={"users": 1})
    monkeypatch.setattr(server, "begin_account_deletion", begin)
    monkeypatch.setattr(server, "finalize_account_deletion", finish)
    monkeypatch.setattr(server, "user_upload_paths", lambda user_id: ["first", "second"])
    removed = []
    def remove(path):
        if path == "second":
            raise EndpointConnectionError(endpoint_url="http://storage")
        removed.append(path)
    monkeypatch.setattr(server, "delete_object", remove)
    user = {"user_id": "owner", "email": "owner@example.com"}
    with pytest.raises(HTTPException) as caught:
        asyncio.run(server.delete_account(server.DeleteAccountInput(confirmation_email=user["email"]), request(), Response(), user))
    assert caught.value.status_code == 503
    begin.assert_awaited_once()
    finish.assert_not_awaited()
    monkeypatch.setattr(server, "delete_object", lambda path: None)
    asyncio.run(server.delete_account(server.DeleteAccountInput(confirmation_email=user["email"]), request(), Response(), user))
    assert begin.await_count == 2
    finish.assert_awaited_once_with(store, "owner")


def test_orphan_inventory_is_prefix_and_age_gated(monkeypatch):
    now = datetime(2026, 9, 15, 12, 0, tzinfo=timezone.utc)
    pages = [{"Contents": [
        {"Key": "launchpad/uploads/owner/referenced.txt", "LastModified": now - timedelta(hours=2)},
        {"Key": "launchpad/uploads/owner/orphan.txt", "LastModified": now - timedelta(hours=2)},
        {"Key": "launchpad/uploads/owner/new.txt", "LastModified": now - timedelta(minutes=5)},
    ]}]
    paginator = SimpleNamespace(paginate=lambda **kwargs: pages)
    monkeypatch.setattr(server, "s3", SimpleNamespace(get_paginator=lambda name: paginator))
    monkeypatch.setattr(server, "now_utc", lambda: now)
    stale = server.stale_upload_objects(
        {"launchpad/uploads/owner/referenced.txt"}, grace_seconds=3600
    )
    assert stale == ["launchpad/uploads/owner/orphan.txt"]


def test_old_session_cannot_delete_account(monkeypatch):
    sessions = SimpleNamespace(find_one=AsyncMock(return_value={
        "created_at": (datetime.now(timezone.utc) - timedelta(hours=1)).isoformat(),
    }))
    monkeypatch.setattr(server, "db", SimpleNamespace(user_sessions=sessions))
    with pytest.raises(HTTPException) as caught:
        asyncio.run(server.require_recent_session(request(), "owner"))
    assert caught.value.status_code == 403
