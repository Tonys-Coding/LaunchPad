"""Destructive only within the disposable database named by the test script."""
import asyncio
import os

from motor.motor_asyncio import AsyncIOMotorClient


async def main():
    database_name = os.environ["VERIFY_DATABASE"]
    assert database_name.startswith("launchpad_replica_test_")
    client = AsyncIOMotorClient(os.environ["VERIFY_MONGO_URL"], serverSelectionTimeoutMS=5000)
    database = client[database_name]
    await database.probe.insert_one({"_id": "before", "value": "preserved"})

    async with await client.start_session() as session:
        async with session.start_transaction():
            await database.probe.insert_one({"_id": "transaction", "value": 1}, session=session)
            await database.probe.update_one({"_id": "before"}, {"$set": {"transaction_seen": True}}, session=session)

    assert await database.probe.count_documents({}) == 2
    assert (await database.probe.find_one({"_id": "before"}))["transaction_seen"] is True
    hello = await database.command("hello")
    assert hello["isWritablePrimary"] is True
    assert hello["setName"] == os.environ["VERIFY_REPLICA_SET"]
    print("PASS: authenticated CRUD, transaction commit, primary and replica-set identity")
    client.close()


asyncio.run(main())
