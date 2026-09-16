# Invite-beta production readiness

Last checked: September 15, 2026. **Local release preparation is complete. The
application is ready for the clean-server deployment and restore drill, but invited
users should not be added until that drill passes.** This is approval for a small,
invite-only web beta, not a public launch or extension release.

## Consolidated release candidate

Release tag: `beta-1`.

| Image | Local immutable image ID |
| --- | --- |
| `launchpad-backend-production:beta-1` | `sha256:6b43e752cefac0b5bc4da3376db619f17494132ca5d423bafa7d564a935ee148` |
| `launchpad-web-production:beta-1` | `sha256:ce38bd26e3cb315ee086d5b265077357c6359327a102b494795b43a18ba22214` |
| `launchpad-mongo-production:beta-1` | `sha256:0d69ea10ae2dadb7434dfe8a4877a9a9458ea9bd1f14c5d79eee610bd192191a` |

All Dockerfile base images are digest-pinned. The production Compose overlay uses
`LAUNCHPAD_RELEASE` for application image names instead of `latest`. Registry
digests should be recorded after these images are pushed for the Linux server.

## Completed local gates

- Emergent services are not used. React/Caddy, FastAPI, MongoDB, and provider-neutral
  S3 comprise the production application.
- Production starts exactly `mongo`, `backend`, and `web`. Inherited MinIO is behind
  the explicit `local-storage` profile and is not a normal production service.
- The private S3 bucket must already exist. Production cannot create buckets, and
  missing S3 settings stop Compose configuration. A real read/write/list/delete
  probe passed without touching user objects.
- MongoDB authentication, the single-member transaction-capable replica set, atomic
  quota writes, account-deletion fencing, storage cleanup, and backup/restore tooling
  have passed their isolated drills.
- Backend suite: 76 passed. Frontend suite: 22 passed. The optimized frontend build
  and desktop/mobile/keyboard/error-recovery browser review passed.
- Python dependency inventory: 51 installed packages, 0 OSV matches.
- Frontend runtime audit: 0 critical, 0 high, 5 moderate, 1 low.
- Web and Mongo container manifests retain their prior 0 critical/high results.
  Three backend OCR-library high matches have narrow, documented, time-bounded
  invite-beta exceptions in `docs/invite-beta-security-exceptions.md`.
- Secure cookies, exact CORS/trusted hosts, CSP, HSTS, Permissions Policy, disabled
  production API docs, hashed sessions, encrypted Google credentials, quotas, rate
  limits, account export/deletion, privacy policy, and terms are implemented.
- Email/password registration is disabled in production; new accounts require Google
  sign-in and membership in `BETA_ALLOWED_EMAILS`.

## The only remaining launch gate

Complete one clean Linux-server drill using the real domain and provider accounts:

1. Fill `.env.production`, configure DNS/ports 80 and 443, Google callbacks/test
   users, the private S3 bucket-scoped credential, rclone backup destination, and
   alert webhook. Run `scripts/test-production-storage-config.sh`.
2. Build/start `beta-1`, verify `/api/health`, Google invitation enforcement, login,
   one application, one event, one attachment, account export, and account deletion.
3. Run one encrypted backup, restore it into clean volumes, verify database and
   attachment content, then enable the provided daily backup and five-minute health
   timers plus one independent uptime monitor.

If this single drill passes, invitations may begin. Keep the beta to roughly 10–20
known users, retain testing-mode Google OAuth, and leave the extension unpublished.

## Deferred deliberately

Medium/low dependency cleanup, multi-node availability, extension distribution,
billing, premium features, unrestricted signup, load testing, and a separate OCR
worker are post-beta work. This is the intentional shortcut: they are tracked, but
they do not block a small controlled beta.

Detailed evidence remains in the MongoDB, concurrency, frontend, storage, and Garage
checkpoint documents in this directory.
