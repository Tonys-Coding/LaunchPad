#!/usr/bin/env bash
# Exercises the real backup/restore scripts against disposable test data only.
set -euo pipefail
umask 077
project_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "${project_root}"
export COMPOSE_PROJECT_NAME=launchpad-test
export LAUNCHPAD_ENV_FILE="${project_root}/.env.production.example"
export LAUNCHPAD_PRODUCTION=true
export LAUNCHPAD_COMPOSE_OVERRIDE="${project_root}/compose.test.yaml"
export GOOGLE_CLIENT_ID=test-client GOOGLE_CLIENT_SECRET=test-secret
export GOOGLE_CALENDAR_TOKEN_KEY=MDEyMzQ1Njc4OWFiY2RlZjAxMjM0NTY3ODlhYmNkZWY=
compose=(docker compose -p launchpad-test --env-file "${LAUNCHPAD_ENV_FILE}" -f compose.yaml -f compose.production.yaml -f compose.test.yaml)
"${compose[@]}" up -d --no-build --wait --wait-timeout 60
"${compose[@]}" exec -T backend python - <<'PY'
import asyncio
import server
async def seed():
    await server.db.restore_probe.replace_one({"_id": "drill"}, {"_id": "drill", "value": "before"}, upsert=True)
    server.put_object("restore-drill/check.txt", b"before", "text/plain")
asyncio.run(seed())
PY
snapshot_root="$(mktemp -d)"
bash scripts/backup.sh "${snapshot_root}/snapshot"
"${compose[@]}" exec -T backend python - <<'PY'
import asyncio
import server
async def alter():
    await server.db.restore_probe.update_one({"_id": "drill"}, {"$set": {"value": "after"}})
    server.put_object("restore-drill/check.txt", b"after", "text/plain")
asyncio.run(alter())
PY
# Test encryption/decryption with a disposable key, then restore that copy.
export BACKUP_ENCRYPTION_KEY
BACKUP_ENCRYPTION_KEY="$(openssl rand -base64 48)"
tar -C "${snapshot_root}" -czf - snapshot | openssl enc -aes-256-cbc -salt -pbkdf2 -iter 250000 -pass env:BACKUP_ENCRYPTION_KEY -out "${snapshot_root}/snapshot.enc"
mkdir "${snapshot_root}/decrypted"
openssl enc -d -aes-256-cbc -pbkdf2 -iter 250000 -pass env:BACKUP_ENCRYPTION_KEY -in "${snapshot_root}/snapshot.enc" | tar -C "${snapshot_root}/decrypted" -xzf -
bash scripts/restore.sh --yes "${snapshot_root}/decrypted/snapshot"
"${compose[@]}" exec -T backend python - <<'PY'
import asyncio
import server
async def verify():
    record = await server.db.restore_probe.find_one({"_id": "drill"})
    assert record["value"] == "before", "Database restore failed"
    assert server.get_object("restore-drill/check.txt")[0] == b"before", "Attachment restore failed"
    await server.db.restore_probe.delete_one({"_id": "drill"})
    server.delete_object("restore-drill/check.txt")
asyncio.run(verify())
print("Encrypted backup, database restore, and attachment restore passed.")
PY
printf 'Disposable drill artifacts: %s\n' "${snapshot_root}"
