# Concurrent account write protection

Verified September 15, 2026. The implementation is tested in isolated databases
and deployed to the converted local replica-set stack.

## Guarantees implemented

Application, event, Career Library, session, Calendar-connection, and attachment
commits share an account-scoped MongoDB transaction boundary that:

- Takes a write lock by updating only the authenticated user's document. Requests
  for different users do not share this lock.
- Rejects a mutation when the account is missing or has a `deleting_at` fence.
- Counts and inserts within one snapshot, so concurrent application, event, and
  Career Library creates cannot exceed their configured limits.
- Enforces one combined Career Library limit across skills and all experience
  record types.
- Inserts a CSV import as one batch. Validation, duplicate keys, cancellation,
  timeouts, and later transaction failures abort the complete batch.
- Recalculates attachment bytes inside the locked transaction before linking an
  already-uploaded object, so parallel uploads cannot overrun the account limit.
- Replaces browser-supplied ownership with the authenticated `user_id`.
- Uses majority write concern, snapshot reads, and primary read preference.

MongoDB can retry transaction callbacks. Each callback therefore contains only
database operations, receives its session explicitly, and performs no storage,
Google, logging, or messaging side effects. The transaction has a 30-second outer
bound and 10-second commit bound. An ambiguous timeout tells the user to refresh;
standalone MongoDB fails closed with a 503 instead of saving non-atomically.

Implementation: [atomic_writes.py](../backend/atomic_writes.py), routes in
[server.py](../backend/server.py), and the transaction-capable deployment in the
[MongoDB replica-set checkpoint](mongo-replica-upgrade.md).

## Deletion and object reconciliation

Account deletion first installs `deleting_at` through the same account lock. It
waits for every earlier cooperating write to commit, while every later durable
create, attachment commit, session, and integration-credential commit is rejected.
Deletion then removes every object beneath that account's exact upload prefix,
including crash-created orphans, before deleting all account database collections
in one transaction.

If storage is unavailable, the database remains intact and fenced so the
authenticated user can retry. If the database transaction fails, no partial set
of database deletions commits.

If an upload succeeds but its database commit and immediate object rollback both
fail, LaunchPad stores an idempotent cleanup job. The deployed worker retries jobs
every five minutes. Hourly it also compares database attachment references to
objects under `launchpad/uploads/` and removes only unreferenced objects older than
one hour. It never scans or deletes other storage prefixes.

## Verification

The isolated [test Compose stack](../compose.concurrency-test.yaml) creates a fresh
single-member replica set plus an unsupported standalone database. The repeatable
[test](../scripts/test-concurrent-applications.sh) exercises the real API through
ASGI.

**16 real transaction tests passed**, including:

- 12 simultaneous application creates stopped exactly at a limit of three.
- Parallel imports stayed whole; a manual create racing an import shared the limit.
- Duplicate, simulated later failure, and cancellation paths fully rolled back.
- 12 simultaneous event creates stopped exactly at the event limit.
- Simultaneous skills and experiences shared one combined Career Library limit.
- Six parallel attachment commits shared one byte limit and retained only the two
  files that fit.
- Separate users had separate quotas and ownership spoofing created no data.
- Missing, deletion-fenced, and standalone accounts all failed closed.
- Deletion blocked application, event, skill, experience, and session creation,
  then removed every account-scoped collection in one commit.
- Deletion waited for an already-running transaction, then rejected later writes
  and removed the earlier committed row.

The complete backend suite also passes: **74 tests**, with eight known FastAPI
lifespan deprecation warnings. It includes storage-outage deletion retry and
age/prefix-gated orphan selection.

The deployed API's self-cleaning
[live verifier](../scripts/test-live-replica-applications.py) filled application,
event, and combined Career Library quotas, confirmed exact concurrent outcomes,
exercised application CRUD, and deleted its test account plus both referenced and
orphaned objects. The separate
[cleanup verifier](../scripts/test-live-storage-reconciliation.py) confirmed that
a durable queue entry removes both its object and database job. All generated live
records and objects were removed.

A single-member replica set enables these transactions but is not database
redundancy or a substitute for off-server backups.
