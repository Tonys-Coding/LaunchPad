"""Database-only, retryable account writes. Requires MongoDB replica-set transactions."""
import asyncio
import hashlib

from fastapi import HTTPException
from pymongo import ReadPreference
from pymongo.errors import OperationFailure
from pymongo.read_concern import ReadConcern
from pymongo.write_concern import WriteConcern


async def account_transaction(database, user_id, operation):
    """Serialize cooperating writes per account, then commit all records together.

    operation(session) may run more than once: no storage/network side effects,
    external messages, or mutation of caller-owned state belongs in that callback.
    Every DB operation in the callback must receive the provided session.
    """
    async def guarded(session):
        # A real write (not $inc: 0) makes concurrent quota checks conflict and
        # retry with a fresh snapshot. No expiring lease or process-local lock.
        result = await database.users.update_one(
            {"user_id": user_id, "deleting_at": {"$exists": False}},
            {"$inc": {"account_write_revision": 1}}, session=session,
        )
        if not result.matched_count:
            raise HTTPException(status_code=409, detail="This account is unavailable for changes.")
        return await operation(session)

    try:
        async with asyncio.timeout(30):
            async with await database.client.start_session() as session:
                return await session.with_transaction(
                    guarded, read_concern=ReadConcern("snapshot"),
                    write_concern=WriteConcern("majority"),
                    read_preference=ReadPreference.PRIMARY,
                    max_commit_time_ms=10000,
                )
    except TimeoutError as exc:
        # A timed-out commit can be ambiguous. Never promise that nothing saved
        # or automatically submit a fresh import; the client should refresh first.
        raise HTTPException(status_code=503, detail=(
            "The save could not be confirmed. Refresh your applications before retrying."
        )) from exc
    except OperationFailure as exc:
        if exc.code in {20, 303}:
            raise HTTPException(status_code=503, detail=(
                "Saving requires database transaction support. Please contact the administrator."
            )) from exc
        raise


async def insert_applications(database, user_id, documents, limit):
    async def insert(session):
        count = await database.applications.count_documents({"user_id": user_id}, session=session)
        if count + len(documents) > limit:
            raise HTTPException(status_code=409, detail=f"Your free account can store up to {limit:,} applications.")
        # Fresh dictionaries keep driver-added _id values out of caller data on
        # both successful execution and transaction retries.
        await database.applications.insert_many([dict(doc, user_id=user_id) for doc in documents], session=session)

    if not documents:
        raise ValueError("At least one application is required")
    await account_transaction(database, user_id, insert)


async def insert_event(database, user_id, document, limit):
    async def insert(session):
        count = await database.events.count_documents({"user_id": user_id}, session=session)
        if count >= limit:
            raise HTTPException(
                status_code=409,
                detail=f"Your free account can store up to {limit:,} events.",
            )
        await database.events.insert_one(dict(document, user_id=user_id), session=session)

    await account_transaction(database, user_id, insert)


async def insert_library_record(database, user_id, collection_name, document, limit):
    if collection_name not in {"library_skills", "library_experiences"}:
        raise ValueError("Unsupported Career Library collection")

    async def insert(session):
        skill_count = await database.library_skills.count_documents(
            {"user_id": user_id}, session=session
        )
        experience_count = await database.library_experiences.count_documents(
            {"user_id": user_id}, session=session
        )
        if skill_count + experience_count >= limit:
            raise HTTPException(
                status_code=409,
                detail=f"Your free account can store up to {limit:,} Career Library records.",
            )
        await database[collection_name].insert_one(
            dict(document, user_id=user_id), session=session
        )

    await account_transaction(database, user_id, insert)


async def attach_application_file(database, user_id, app_id, attachment, byte_limit):
    """Atomically enforce the account byte quota and attach an already-stored object."""

    async def attach(session):
        rows = await database.applications.aggregate(
            [
                {"$match": {"user_id": user_id}},
                {"$unwind": {"path": "$attachments", "preserveNullAndEmptyArrays": False}},
                {"$group": {"_id": None, "total": {"$sum": {"$ifNull": ["$attachments.size", 0]}}}},
            ],
            session=session,
        ).to_list(1)
        used_bytes = int(rows[0]["total"]) if rows else 0
        resume_rows = await database.resumes.aggregate(
            [
                {"$match": {"user_id": user_id}},
                {"$group": {"_id": None, "total": {"$sum": {"$ifNull": ["$source_file.size", 0]}}}},
            ],
            session=session,
        ).to_list(1)
        used_bytes += int(resume_rows[0]["total"]) if resume_rows else 0
        if used_bytes + int(attachment["size"]) > byte_limit:
            raise HTTPException(
                status_code=413,
                detail=f"Your free account can store up to {byte_limit // (1024 * 1024)} MB of attachments.",
            )
        saved = await database.applications.update_one(
            {"user_id": user_id, "app_id": app_id},
            {
                "$push": {"attachments": dict(attachment)},
                "$set": {"updated_at": attachment["created_at"]},
            },
            session=session,
        )
        if not saved.matched_count:
            raise HTTPException(status_code=404, detail="Application not found")

    await account_transaction(database, user_id, attach)


async def begin_account_deletion(database, user_id, deleting_at):
    """Install a durable fence after every earlier cooperating mutation commits."""
    existing = await database.users.find_one({"user_id": user_id}, {"deleting_at": 1})
    if not existing:
        raise HTTPException(status_code=404, detail="Account not found")
    if existing.get("deleting_at"):
        return existing["deleting_at"]

    async def fence(session):
        result = await database.users.update_one(
            {"user_id": user_id, "deleting_at": {"$exists": False}},
            {"$set": {"deleting_at": deleting_at}},
            session=session,
        )
        if not result.matched_count:
            raise HTTPException(status_code=409, detail="Account deletion is already in progress.")
        return deleting_at

    try:
        return await account_transaction(database, user_id, fence)
    except HTTPException as exc:
        if exc.status_code != 409:
            raise
        existing = await database.users.find_one({"user_id": user_id}, {"deleting_at": 1})
        if existing and existing.get("deleting_at"):
            return existing["deleting_at"]
        raise


async def finalize_account_deletion(database, user_id):
    """Remove all database-owned account records in one all-or-nothing commit."""
    collection_names = (
        "applications",
        "events",
        "library_skills",
        "library_experiences",
        "resume_profiles",
        "resumes",
        "resume_versions",
        "google_calendar_connections",
        "oauth_states",
        "ai_flyer_usage",
        "ai_resume_usage",
        "user_sessions",
        "storage_cleanup_jobs",
    )

    async def remove(session):
        user = await database.users.find_one(
            {"user_id": user_id, "deleting_at": {"$exists": True}},
            {"_id": 1},
            session=session,
        )
        if not user:
            raise HTTPException(status_code=409, detail="Account deletion is not ready to finish.")
        removed = {}
        for name in collection_names:
            result = await database[name].delete_many({"user_id": user_id}, session=session)
            removed[name] = result.deleted_count
        rate_result = await database.rate_limits.delete_many(
            {"subject_hash": hashlib.sha256(user_id.encode()).hexdigest()}, session=session
        )
        removed["rate_limits"] = rate_result.deleted_count
        user_result = await database.users.delete_one(
            {"user_id": user_id, "deleting_at": {"$exists": True}}, session=session
        )
        if user_result.deleted_count != 1:
            raise RuntimeError("Deletion fence disappeared before commit")
        removed["users"] = 1
        return removed

    try:
        async with asyncio.timeout(30):
            async with await database.client.start_session() as session:
                return await session.with_transaction(
                    remove,
                    read_concern=ReadConcern("snapshot"),
                    write_concern=WriteConcern("majority"),
                    read_preference=ReadPreference.PRIMARY,
                    max_commit_time_ms=10000,
                )
    except TimeoutError as exc:
        raise HTTPException(
            status_code=503,
            detail="Account deletion could not be confirmed. Sign in again before retrying.",
        ) from exc
    except OperationFailure as exc:
        if exc.code in {20, 303}:
            raise HTTPException(
                status_code=503,
                detail="Account deletion requires database transaction support.",
            ) from exc
        raise
