"""Real Mongo transaction tests; run only in compose.concurrency-test.yaml."""
import asyncio
import os
import unittest
import uuid

import httpx
from fastapi import HTTPException, Request
from motor.motor_asyncio import AsyncIOMotorClient

import server
from atomic_writes import (
    account_transaction,
    attach_application_file,
    begin_account_deletion,
    finalize_account_deletion,
    insert_applications,
)


class AtomicApplicationTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        assert os.environ["MONGO_URL"] == "mongodb://mongo:27017/?replicaSet=concurrency"
        assert server.__file__.startswith("/verification/backend/")
        self.client = AsyncIOMotorClient(os.environ["MONGO_URL"])
        self.db = self.client["launchpad_concurrency_test_" + uuid.uuid4().hex]
        await self.db.users.insert_many([{"user_id": "alice"}, {"user_id": "bob"}])
        await self.db.applications.create_index("app_id", unique=True)
        await self.db.events.create_index("event_id", unique=True)
        await self.db.library_skills.create_index("skill_id", unique=True)
        await self.db.library_skills.create_index(
            [("user_id", 1), ("name_key", 1)], unique=True
        )
        await self.db.library_experiences.create_index("experience_id", unique=True)
        server.db = self.db
        server.APPLICATION_LIMIT = 3
        server.EVENT_LIMIT = 3
        server.LIBRARY_RECORD_LIMIT = 3
        server.RATE_LIMITING_ENABLED = False

        async def authenticated(request: Request):
            user_id = request.headers.get("x-test-user")
            if user_id not in {"alice", "bob"}:
                raise HTTPException(status_code=401)
            return {"user_id": user_id}

        server.app.dependency_overrides[server.get_current_user] = authenticated
        self.http = httpx.AsyncClient(transport=httpx.ASGITransport(app=server.app), base_url="http://test")

    async def asyncTearDown(self):
        await self.http.aclose()
        server.app.dependency_overrides.clear()
        assert self.db.name.startswith("launchpad_concurrency_test_")
        await self.client.drop_database(self.db.name)
        self.client.close()

    def payload(self, n):
        return {"company_name": f"Test {n}", "job_title": "Role", "day_applied": "2026-09-15"}

    def event_payload(self, n):
        return {
            "title": f"Event {n}", "category": "Other", "all_day": True,
            "start_date": "2026-09-15", "timezone": "UTC",
        }

    def experience_payload(self, n):
        return {"type": "Work", "title": f"Experience {n}", "skill_ids": []}

    async def post(self, path, body, user="alice"):
        return await self.http.post(path, json=body, headers={"x-test-user": user})

    async def test_parallel_creates_cannot_exceed_limit(self):
        results = await asyncio.gather(*[self.post("/api/applications", self.payload(n)) for n in range(12)])
        self.assertEqual(sum(r.status_code == 200 for r in results), 3)
        self.assertEqual(sum(r.status_code == 409 for r in results), 9)
        self.assertEqual(await self.db.applications.count_documents({"user_id": "alice"}), 3)

    async def test_parallel_event_creates_cannot_exceed_limit(self):
        results = await asyncio.gather(*[
            self.post("/api/events", self.event_payload(n)) for n in range(12)
        ])
        self.assertEqual(sum(r.status_code == 200 for r in results), 3)
        self.assertEqual(sum(r.status_code == 409 for r in results), 9)
        self.assertEqual(await self.db.events.count_documents({"user_id": "alice"}), 3)

    async def test_skill_and_experience_creates_share_one_library_limit(self):
        requests = [
            self.post("/api/library/skills", {
                "name": f"Skill {n}", "category": "Other", "level": "Working",
            })
            for n in range(6)
        ] + [
            self.post("/api/library/experiences", self.experience_payload(n))
            for n in range(6)
        ]
        results = await asyncio.gather(*requests)
        self.assertEqual(sum(r.status_code == 200 for r in results), 3)
        self.assertEqual(sum(r.status_code == 409 for r in results), 9)
        total = (
            await self.db.library_skills.count_documents({"user_id": "alice"})
            + await self.db.library_experiences.count_documents({"user_id": "alice"})
        )
        self.assertEqual(total, 3)

    async def test_parallel_attachment_commits_share_byte_limit(self):
        await self.db.applications.insert_one({
            "app_id": "attachment-target", "user_id": "alice", "attachments": [],
        })
        now = "2026-09-15T00:00:00+00:00"
        results = await asyncio.gather(*[
            attach_application_file(
                self.db,
                "alice",
                "attachment-target",
                {
                    "id": f"attachment-{n}", "name": f"{n}.txt", "kind": "other",
                    "content_type": "text/plain", "size": 2,
                    "storage_path": f"test/{n}.txt", "created_at": now,
                },
                5,
            )
            for n in range(6)
        ], return_exceptions=True)
        self.assertEqual(sum(result is None for result in results), 2)
        quota_errors = [
            result for result in results
            if isinstance(result, HTTPException) and result.status_code == 413
        ]
        self.assertEqual(len(quota_errors), 4)
        saved = await self.db.applications.find_one({"app_id": "attachment-target"})
        self.assertEqual(sum(item["size"] for item in saved["attachments"]), 4)

    async def test_deletion_fence_blocks_creates_and_final_commit_removes_account(self):
        await self.db.applications.insert_one({"app_id": "existing", "user_id": "alice"})
        await self.db.events.insert_one({"event_id": "existing", "user_id": "alice"})
        await self.db.library_skills.insert_one({
            "skill_id": "existing", "name_key": "existing", "user_id": "alice",
        })
        await self.db.library_experiences.insert_one({
            "experience_id": "existing", "user_id": "alice",
        })
        await self.db.user_sessions.insert_one({"user_id": "alice", "session_token_hash": "test"})
        await self.db.google_calendar_connections.insert_one({"user_id": "alice"})

        await begin_account_deletion(self.db, "alice", "2026-09-15T00:00:00+00:00")
        results = await asyncio.gather(
            self.post("/api/applications", self.payload(1)),
            self.post("/api/events", self.event_payload(1)),
            self.post("/api/library/skills", {
                "name": "Blocked", "category": "Other", "level": "Working",
            }),
            self.post("/api/library/experiences", self.experience_payload(1)),
        )
        self.assertTrue(all(result.status_code == 409 for result in results))
        with self.assertRaises(HTTPException) as session_error:
            await server.create_session("alice")
        self.assertEqual(session_error.exception.status_code, 409)

        removed = await finalize_account_deletion(self.db, "alice")
        self.assertEqual(removed["users"], 1)
        self.assertIsNone(await self.db.users.find_one({"user_id": "alice"}))
        for name in (
            "applications", "events", "library_skills", "library_experiences",
            "user_sessions", "google_calendar_connections",
        ):
            self.assertEqual(await self.db[name].count_documents({"user_id": "alice"}), 0)

    async def test_deletion_waits_for_earlier_transaction_then_blocks_later_writes(self):
        entered, release = asyncio.Event(), asyncio.Event()

        async def earlier_write(session):
            await self.db.applications.insert_one(
                {"app_id": "before-fence", "user_id": "alice"}, session=session
            )
            entered.set()
            await release.wait()

        write_task = asyncio.create_task(account_transaction(self.db, "alice", earlier_write))
        await asyncio.wait_for(entered.wait(), 10)
        deletion_task = asyncio.create_task(
            begin_account_deletion(self.db, "alice", "2026-09-15T00:00:00+00:00")
        )
        await asyncio.sleep(0.1)
        self.assertFalse(deletion_task.done())
        release.set()
        await write_task
        await deletion_task
        self.assertIsNotNone(await self.db.applications.find_one({"app_id": "before-fence"}))

        blocked = await self.post("/api/events", self.event_payload(2))
        self.assertEqual(blocked.status_code, 409)
        await finalize_account_deletion(self.db, "alice")
        self.assertIsNone(await self.db.applications.find_one({"app_id": "before-fence"}))

    async def test_parallel_imports_are_whole_batches(self):
        results = await asyncio.gather(*[self.post("/api/applications/bulk", [self.payload(n), self.payload(n+10)]) for n in range(4)])
        self.assertEqual(sorted(r.status_code for r in results), [200, 409, 409, 409])
        self.assertEqual(await self.db.applications.count_documents({"user_id": "alice"}), 2)

    async def test_import_and_manual_create_share_quota(self):
        results = await asyncio.gather(
            self.post("/api/applications/bulk", [self.payload(n) for n in range(3)]),
            self.post("/api/applications", self.payload(4)),
        )
        self.assertEqual(sorted(r.status_code for r in results), [200, 409])
        count = await self.db.applications.count_documents({"user_id": "alice"})
        self.assertIn(count, (1, 3))

    async def test_failed_second_insert_rolls_back_first(self):
        await self.db.applications.insert_one({"app_id": "duplicate", "user_id": "alice"})
        from pymongo.errors import BulkWriteError
        with self.assertRaises(BulkWriteError):
            await insert_applications(self.db, "alice", [{"app_id": "first"}, {"app_id": "duplicate"}], 3)
        self.assertEqual(await self.db.applications.count_documents({}), 1)
        self.assertIsNone(await self.db.applications.find_one({"app_id": "first"}))

    async def test_readers_never_see_uncommitted_rows(self):
        entered, release = asyncio.Event(), asyncio.Event()
        async def write(session):
            await self.db.applications.insert_one({"user_id": "alice", "app_id": "hidden"}, session=session)
            entered.set()
            await release.wait()
            raise RuntimeError("simulated later failure")
        task = asyncio.create_task(account_transaction(self.db, "alice", write))
        await asyncio.wait_for(entered.wait(), 10)
        try:
            self.assertEqual(await self.db.applications.count_documents({}), 0)
        finally:
            release.set()
            with self.assertRaises(RuntimeError):
                await task
        self.assertEqual(await self.db.applications.count_documents({}), 0)

    async def test_cancelled_import_aborts_uncommitted_data(self):
        entered = asyncio.Event()
        async def write(session):
            await self.db.applications.insert_one({"user_id": "alice", "app_id": "cancelled"}, session=session)
            entered.set()
            await asyncio.Event().wait()
        task = asyncio.create_task(account_transaction(self.db, "alice", write))
        await asyncio.wait_for(entered.wait(), 10)
        task.cancel()
        with self.assertRaises(asyncio.CancelledError):
            await task
        self.assertEqual(await self.db.applications.count_documents({}), 0)

    async def test_users_have_separate_quotas_and_cannot_spoof_ownership(self):
        for user in ("alice", "bob"):
            body = [dict(self.payload(n), user_id="other-user") for n in range(3)]
            response = await self.post("/api/applications/bulk", body, user)
            self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(await self.db.applications.count_documents({"user_id": "alice"}), 3)
        self.assertEqual(await self.db.applications.count_documents({"user_id": "bob"}), 3)
        self.assertEqual(await self.db.applications.count_documents({"user_id": "other-user"}), 0)

    async def test_missing_or_fenced_account_cannot_write(self):
        await self.db.users.update_one({"user_id": "alice"}, {"$set": {"deleting_at": "test"}})
        response = await self.post("/api/applications", self.payload(1))
        self.assertEqual(response.status_code, 409)
        await self.db.users.delete_one({"user_id": "bob"})
        response = await self.post("/api/applications/bulk", [self.payload(2)], "bob")
        self.assertEqual(response.status_code, 409)
        self.assertEqual(await self.db.applications.count_documents({}), 0)

    async def test_removed_application_frees_capacity(self):
        response = await self.post("/api/applications/bulk", [self.payload(n) for n in range(3)])
        self.assertEqual(response.status_code, 200)
        await self.db.applications.delete_one({"user_id": "alice"})
        response = await self.post("/api/applications", self.payload(4))
        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(await self.db.applications.count_documents({}), 3)

    async def test_validation_and_authentication_reject_before_writes(self):
        response = await self.http.post("/api/applications", json=self.payload(1))
        self.assertEqual(response.status_code, 401)
        for body, status in (([], 422), ([self.payload(1), {"company_name": "invalid"}], 422),
                             ([self.payload(n) for n in range(501)], 413)):
            response = await self.post("/api/applications/bulk", body)
            self.assertEqual(response.status_code, status)
        self.assertEqual(await self.db.applications.count_documents({}), 0)

    async def test_standalone_database_fails_closed(self):
        client = AsyncIOMotorClient("mongodb://standalone:27017")
        database = client["launchpad_concurrency_test_" + uuid.uuid4().hex]
        try:
            await database.users.insert_one({"user_id": "alice"})
            with self.assertRaises(HTTPException) as caught:
                await insert_applications(database, "alice", [{"app_id": "unsafe"}], 3)
            self.assertEqual(caught.exception.status_code, 503)
            self.assertIn("transaction support", caught.exception.detail)
            self.assertEqual(await database.applications.count_documents({}), 0)
        finally:
            await client.drop_database(database.name)
            client.close()


if __name__ == "__main__":
    unittest.main(verbosity=2)
