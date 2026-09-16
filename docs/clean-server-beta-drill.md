# Clean-server beta drill

Use this once on the actual Linux server. Stop if any checked item fails; do not add
Google test users or send invitations until every item is complete.

## Inputs

- [ ] Linux server and SSH access
- [ ] Domain pointed at the server
- [ ] Private S3-compatible bucket and bucket-only read/write/list/delete credential
- [ ] Google OAuth client with both HTTPS callbacks and testing-mode test users
- [ ] Off-server rclone destination
- [ ] Alert webhook and independent uptime monitor

## Deploy

- [ ] Copy the project and `.env.production.example` to `.env.production`
- [ ] Set `LAUNCHPAD_RELEASE=beta-1` and replace every placeholder
- [ ] Create the MongoDB replica-set key outside the repository with mode `0400`
- [ ] Run `./scripts/test-production-storage-config.sh`
- [ ] Run the production Compose `up --build -d` command from `README.md`
- [ ] Run `./scripts/production-check.sh`
- [ ] Confirm HTTPS and `/api/health`; confirm `/docs` and `/redoc` are unavailable

## Product smoke test

- [ ] A non-invited Google account is rejected
- [ ] An invited Google account can sign in
- [ ] Create/edit/delete an application and event
- [ ] Upload and download one attachment
- [ ] Export account data and inspect the ZIP
- [ ] Delete a disposable invited account and confirm it cannot sign in as existing

## Recovery and monitoring

- [ ] Run `./scripts/backup-production.sh` and verify remote encrypted files/checksum
- [ ] Restore that backup into clean disposable volumes
- [ ] Verify the application, event, and attachment after restore
- [ ] Enable the supplied backup and production-check timers
- [ ] Trigger one intentional check failure and confirm the alert arrives
- [ ] Configure independent monitoring for `https://YOUR_DOMAIN/api/health`

Record the date, operator, release image registry digests, restore result, and alert
result below before sending invitations.

Drill date:

Operator:

Registry digests:

Restore result:

Alert result:
