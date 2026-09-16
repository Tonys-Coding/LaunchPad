# MongoDB replica-set upgrade checkpoint

Verified September 15, 2026. The checked-in local and production Compose
configurations run MongoDB as a single-member replica set, which is required for
LaunchPad's atomic multi-document writes. The local stack has now been converted
in place and its backend is running the transaction-backed application routes.

## Configuration added

- The custom [MongoDB image](../docker/mongo/Dockerfile) installs a small entrypoint
  wrapper and replica-set health check while retaining the pinned MongoDB 7.0.30
  base image.
- [compose.yaml](../compose.yaml) advertises `mongo:27017` as the one replica-set
  member and gives the backend a `replicaSet=launchpad` connection string.
- [compose.production.yaml](../compose.production.yaml) additionally enables
  MongoDB authentication and internal member authentication with a Docker secret.
- The entrypoint copies that read-only secret to a MongoDB-owned file with mode
  `0400`; the key is neither embedded in the image nor stored in the repository.
- The health check initializes an uninitialized set idempotently and reports
  healthy only when the node is PRIMARY.

The verified custom MongoDB image is:

`sha256:0d69ea10ae2dadb7434dfe8a4877a9a9458ea9bd1f14c5d79eee610bd192191a`

Docker Scout indexed 210 packages from this exact `linux/arm64` image and reported
**0 critical, 0 high, 0 medium, and 0 low vulnerabilities**. The final production
target-platform build must still be scanned again because its digest may differ.

The tag is convenient for local builds, but a production release should record
and deploy the immutable digest from the final target-platform build.

## Destructive-boundary verification

The repeatable [upgrade drill](../scripts/test-mongo-replica-upgrade.sh) uses only
uniquely named containers, a private test network, disposable databases, and
disposable volumes. It never mounts `launchpad_mongo_data`.

The drill passed both paths:

1. A fresh production-style replica set initialized with root and application
   users plus a generated key file. Application-user CRUD, transaction commit,
   primary identity, replica-set identity, authenticated dump, mutation, and
   authenticated restore all passed.
2. A standalone database was seeded, stopped, and restarted over the exact same
   test data volume as a replica set. The original sentinel record survived the
   conversion, transaction commit, dump/restore, and a second container restart.

The LaunchPad web stack reported healthy after the isolated drill.

## Completed live-local conversion

The local database was treated as user data throughout the conversion:

1. Web and backend writers were stopped before the snapshot.
2. `backups/pre-replica-conversion-20260915T090500Z` contains the MongoDB archive,
   attachment archive, and passing SHA-256 manifest.
3. The database archive was restored into a separate namespace before conversion:
   all 302 documents and all indexes restored with zero failures, and every
   collection count matched the source. The verification namespace was then removed.
4. Only the MongoDB service was recreated. It retained `launchpad_mongo_data`,
   became PRIMARY in replica set `launchpad`, and advertised `mongo:27017`.
5. Post-conversion counts exactly matched the pre-conversion counts: 81 users,
   107 sessions, 100 applications, 11 events, one Calendar connection, one skill,
   one AI usage record, and zero records in the three originally empty collections.
6. The atomic-write backend was rebuilt and deployed. A self-cleaning live smoke
   account proved bearer authentication, application list/update/delete, and the
   concurrent quota boundary: six simultaneous creates with two remaining slots
   produced exactly two successful saves and four `409` limit responses. Its
   temporary 1,999 remaining records, account, and session were removed, after
   which all original collection counts still matched.
7. MongoDB, backend, storage, and web containers are healthy and `/api/health`
   returns `{"status":"ok"}`.

The reusable live verifier is
[test-live-replica-applications.py](../scripts/test-live-replica-applications.py).
It creates a uniquely named test account, scopes every seed row to that account,
and removes the account, session, and application rows in a `finally` block.

Retain the pre-conversion backup until the broader production-readiness work and
next ordinary local backup have both completed successfully.

## Production secret

Generate the replica-set member key outside the repository and make it readable
only by the deployment operator:

```bash
openssl rand -base64 756 > /secure/path/mongo-replica-set.key
chmod 0400 /secure/path/mongo-replica-set.key
```

Set `MONGO_REPLICA_SET_KEY_FILE` in `.env.production` to that exact file. Losing or
changing it without a coordinated rotation prevents authenticated replica members
from starting, so include the secret in the secure deployment-secret recovery
procedure—not in LaunchPad's application-data archive.

## Availability boundary

A single-member replica set enables transactions; it does **not** provide database
redundancy, automatic failover, or protection from server loss. The invite-only
single-server beta still requires encrypted off-server backups and a completed
restore drill. Higher availability would require an intentionally designed
multi-member deployment across independent failure domains.
