"""Smoke-test the running API's transaction path with one self-cleaning test account."""

import asyncio
import hashlib
import os
import secrets
import uuid
from datetime import datetime, timedelta, timezone

import boto3
import httpx
from botocore.config import Config
from motor.motor_asyncio import AsyncIOMotorClient


APPLICATION_LIMIT = 2_000
EVENT_LIMIT = 2_000
LIBRARY_LIMIT = 500


def application_payload(index: int) -> dict:
    return {
        "company_name": "LaunchPad transaction test",
        "job_title": f"Temporary role {index}",
        "day_applied": "2026-09-15",
        "expected_start_date": None,
        "start_date_tbd": True,
        "company_domain": None,
        "description": "Removed automatically after the smoke test.",
        "pay_amount": None,
        "pay_period": None,
        "confidence_level": None,
        "follow_up_date": None,
        "interview_date": None,
        "start_date_month_only": False,
        "status": "Applied",
    }


def event_payload(index: int) -> dict:
    return {
        "title": f"Temporary event {index}",
        "category": "Other",
        "all_day": True,
        "start_date": "2026-09-15",
        "timezone": "UTC",
        "sync_to_google": False,
    }


def storage_client():
    return boto3.client(
        "s3",
        endpoint_url=os.environ["S3_ENDPOINT_URL"],
        aws_access_key_id=os.environ["S3_ACCESS_KEY"],
        aws_secret_access_key=os.environ["S3_SECRET_KEY"],
        region_name=os.environ.get("S3_REGION", "us-east-1"),
        config=Config(signature_version="s3v4"),
    )


async def main() -> None:
    suffix = uuid.uuid4().hex
    user_id = f"user_replica_smoke_{suffix[:12]}"
    email = f"replica-smoke-{suffix}@example.com"
    token = secrets.token_urlsafe(32)
    app_prefix = f"replica_smoke_{suffix[:10]}"
    database_name = os.environ.get("DB_NAME", "launchpad")
    mongo = AsyncIOMotorClient(
        os.environ["MONGO_URL"], serverSelectionTimeoutMS=5_000
    )
    database = mongo[database_name]
    storage = storage_client()
    bucket = os.environ.get("S3_BUCKET", "launchpad")
    upload_prefix = f"launchpad/uploads/{user_id}/"
    base_url = os.environ.get("LIVE_SMOKE_BASE_URL", "http://backend:8000/api")
    now = datetime.now(timezone.utc)

    try:
        await database.users.insert_one({
            "user_id": user_id,
            "email": email,
            "name": "Replica smoke test",
            "password_hash": None,
            "picture": None,
            "auth_provider": "email",
            "auth_providers": ["email"],
            "created_at": now.isoformat(),
        })
        await database.user_sessions.insert_one({
            "user_id": user_id,
            "session_token_hash": hashlib.sha256(token.encode()).hexdigest(),
            "expires_at": now + timedelta(minutes=15),
            "created_at": now.isoformat(),
        })
        application_seed = []
        for index in range(APPLICATION_LIMIT - 2):
            application_seed.append({
                **application_payload(index),
                "app_id": f"{app_prefix}_seed_{index:04d}",
                "user_id": user_id,
                "created_at": now.isoformat(),
                "updated_at": now.isoformat(),
                "activity": [{"type": "created", "at": now.isoformat()}],
            })
        await database.applications.insert_many(application_seed)
        await database.events.insert_many([
            {
                **event_payload(index),
                "event_id": f"{app_prefix}_event_{index:04d}",
                "user_id": user_id,
                "created_at": now.isoformat(),
                "updated_at": now.isoformat(),
            }
            for index in range(EVENT_LIMIT - 2)
        ])
        await database.library_skills.insert_many([
            {
                "skill_id": f"{app_prefix}_skill_{index:04d}",
                "user_id": user_id,
                "name": f"Temporary skill {suffix} {index}",
                "name_key": f"temporary skill {suffix} {index}",
                "category": "Other",
                "level": "Working",
                "created_at": now.isoformat(),
                "updated_at": now.isoformat(),
            }
            for index in range(LIBRARY_LIMIT - 2)
        ])

        headers = {"Authorization": f"Bearer {token}"}
        async with httpx.AsyncClient(base_url=base_url, headers=headers, timeout=30) as http:
            me = await http.get("/auth/me")
            assert me.status_code == 200 and me.json()["email"] == email, me.text

            responses = await asyncio.gather(*(
                http.post("/applications", json=application_payload(index))
                for index in range(6)
            ))
            successes = [response for response in responses if response.status_code == 200]
            limited = [response for response in responses if response.status_code == 409]
            assert len(successes) == 2, [response.status_code for response in responses]
            assert len(limited) == 4, [response.text for response in responses]

            event_responses = await asyncio.gather(*(
                http.post("/events", json=event_payload(index)) for index in range(6)
            ))
            assert sum(response.status_code == 200 for response in event_responses) == 2
            assert sum(response.status_code == 409 for response in event_responses) == 4
            assert await database.events.count_documents({"user_id": user_id}) == EVENT_LIMIT

            library_responses = await asyncio.gather(*([
                http.post("/library/skills", json={
                    "name": f"Live skill {suffix} {index}",
                    "category": "Other",
                    "level": "Working",
                })
                for index in range(3)
            ] + [
                http.post("/library/experiences", json={
                    "type": "Work", "title": f"Live experience {index}", "skill_ids": [],
                })
                for index in range(3)
            ]))
            assert sum(response.status_code == 200 for response in library_responses) == 2
            assert sum(response.status_code == 409 for response in library_responses) == 4
            library_count = (
                await database.library_skills.count_documents({"user_id": user_id})
                + await database.library_experiences.count_documents({"user_id": user_id})
            )
            assert library_count == LIBRARY_LIMIT

            listing = await http.get("/applications")
            assert listing.status_code == 200, listing.text
            assert len(listing.json()) == APPLICATION_LIMIT, len(listing.json())

            created = successes[0].json()
            updated_payload = application_payload(100)
            updated_payload["job_title"] = "Updated temporary role"
            updated = await http.put(
                f"/applications/{created['app_id']}", json=updated_payload
            )
            assert updated.status_code == 200, updated.text
            assert updated.json()["job_title"] == "Updated temporary role"

            deleted = await http.delete(f"/applications/{created['app_id']}")
            assert deleted.status_code == 200 and deleted.json() == {"ok": True}, deleted.text
            remaining = await database.applications.count_documents({"user_id": user_id})
            assert remaining == APPLICATION_LIMIT - 1, remaining

            referenced_path = f"{upload_prefix}referenced.txt"
            orphan_path = f"{upload_prefix}orphan.txt"
            await asyncio.to_thread(
                storage.put_object, Bucket=bucket, Key=referenced_path,
                Body=b"referenced", ContentType="text/plain",
            )
            await asyncio.to_thread(
                storage.put_object, Bucket=bucket, Key=orphan_path,
                Body=b"orphan", ContentType="text/plain",
            )
            await database.applications.update_one(
                {"user_id": user_id},
                {"$push": {"attachments": {
                    "id": "referenced", "name": "referenced.txt", "kind": "other",
                    "content_type": "text/plain", "size": 10,
                    "storage_path": referenced_path, "created_at": now.isoformat(),
                }}},
            )
            await database.storage_cleanup_jobs.insert_one({
                "_id": hashlib.sha256(orphan_path.encode()).hexdigest(),
                "user_id": user_id,
                "storage_path": orphan_path,
                "created_at": now,
            })

            account_deleted = await http.request(
                "DELETE", "/settings/account", json={"confirmation_email": email}
            )
            assert account_deleted.status_code == 200, account_deleted.text
            assert account_deleted.json() == {"ok": True}

            for collection_name in (
                "users", "user_sessions", "applications", "events", "library_skills",
                "library_experiences", "storage_cleanup_jobs",
            ):
                assert await database[collection_name].count_documents({"user_id": user_id}) == 0
            remaining_objects = await asyncio.to_thread(
                storage.list_objects_v2, Bucket=bucket, Prefix=upload_prefix
            )
            assert remaining_objects.get("KeyCount", 0) == 0

        hello = await database.command("hello")
        assert hello["isWritablePrimary"] is True
        assert hello["setName"] == "launchpad"
        print(
            "PASS: live authentication, concurrent quota serialization, "
            "application CRUD, fenced account deletion, complete attachment cleanup, "
            "and replica-set identity"
        )
    finally:
        for collection_name in (
            "applications", "events", "library_skills", "library_experiences",
            "google_calendar_connections", "oauth_states", "ai_flyer_usage",
            "user_sessions", "storage_cleanup_jobs", "users",
        ):
            await database[collection_name].delete_many({"user_id": user_id})
        objects = await asyncio.to_thread(
            storage.list_objects_v2, Bucket=bucket, Prefix=upload_prefix
        )
        for item in objects.get("Contents", []):
            await asyncio.to_thread(storage.delete_object, Bucket=bucket, Key=item["Key"])
        assert await database.applications.count_documents({"user_id": user_id}) == 0
        assert await database.user_sessions.count_documents({"user_id": user_id}) == 0
        assert await database.users.count_documents({"user_id": user_id}) == 0
        mongo.close()


asyncio.run(main())
