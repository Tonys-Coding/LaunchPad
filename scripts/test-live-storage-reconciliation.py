"""Verify the deployed durable cleanup queue with one disposable object."""

import asyncio
import sys
import uuid

from botocore.exceptions import ClientError

sys.path.insert(0, "/app")
import server


async def main() -> None:
    suffix = uuid.uuid4().hex
    user_id = f"reconciliation-smoke-{suffix[:12]}"
    storage_path = f"launchpad/uploads/{user_id}/orphan.txt"
    try:
        await asyncio.to_thread(server.put_object, storage_path, b"temporary", "text/plain")
        await server.queue_storage_cleanup(storage_path, user_id, "live_smoke_test")
        queued = await server.db.storage_cleanup_jobs.find_one({"user_id": user_id})
        assert queued and queued["storage_path"] == storage_path
        removed = await server.reconcile_storage_cleanup_jobs()
        assert removed >= 1
        assert await server.db.storage_cleanup_jobs.find_one({"user_id": user_id}) is None
        try:
            await asyncio.to_thread(server.get_object, storage_path)
        except ClientError as exc:
            code = str(exc.response.get("Error", {}).get("Code", ""))
            assert code in {"404", "NoSuchKey", "NotFound"}, code
        else:
            raise AssertionError("Queued object still exists")
        print("PASS: durable cleanup queue removed its object and database job")
    finally:
        await asyncio.to_thread(server.delete_object, storage_path)
        await server.db.storage_cleanup_jobs.delete_many({"user_id": user_id})
        server.client.close()


asyncio.run(main())
