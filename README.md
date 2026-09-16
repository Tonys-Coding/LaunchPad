# Launchpad

Launchpad is a self-hosted job and internship application tracker with a private calendar and career evidence library. It includes an analytics dashboard, application list, Kanban board, unified events/interviews/follow-ups, reusable skills, experience and project records, notes, CSV import/export, file attachments, optional Google Calendar export, and a companion Chrome extension.

The local stack is independent of Emergent:

- React frontend served by Caddy
- FastAPI backend
- MongoDB for accounts, sessions, applications, events, skills, experience records, and encrypted integration records
- MinIO for resume and job-description attachments

## Start locally

Requirements: Docker Desktop or another Docker installation with Compose support.

```bash
docker compose up --build
```

Open [http://localhost:8080](http://localhost:8080), choose **Sign up**, and create an account. Data is stored in named Docker volumes and survives container restarts.

Stop the application without deleting data:

```bash
docker compose down
```

To change local defaults, copy `.env.example` to `.env` and edit the values before starting the stack. Do not commit `.env`.

## Optional demo data

The default database is empty. To seed the historical ten-record demo account, set these values in a root `.env` file:

```dotenv
SEED_DEMO_DATA=true
DEMO_EMAIL=local-demo@example.test
DEMO_PASSWORD=choose-a-local-password
```

Do not enable the demo account in a public deployment.

## Services

Only the web application is published to the host, at `127.0.0.1:8080`. MongoDB, MinIO, and the backend remain on the private Compose network. The browser uses one origin for the frontend and `/api`, which keeps authentication cookies and attachment downloads straightforward.

The backend health endpoint is available at [http://localhost:8080/api/health](http://localhost:8080/api/health).

Run the repeatable health check at any time:

```bash
./scripts/healthcheck.sh
```

## Backups and restores

Create a complete snapshot of MongoDB and all stored attachments:

```bash
./scripts/backup.sh
```

Backups are written beneath `backups/`, include checksums, and are ignored by Git. To choose a different destination, pass its path as the first argument.

A restore replaces the current database and attachment bucket. Stop using the app while it runs and pass the explicit confirmation flag:

```bash
./scripts/restore.sh --yes backups/20260908T120000Z
```

## Production deployment

The production overlay is configured for an invite-only web beta. It enables authenticated MongoDB access, a private externally provisioned S3-compatible attachment bucket, HTTPS, secure cookies, an exact host and CORS allowlist, Google-only new accounts, API rate limits, free-tier quotas, structured logs, and disabled API documentation. The Chrome extension remains local-only until its separate production release. Local development continues to use the private MinIO container; production does not start it.

On a Linux server with Docker Compose:

1. Point a domain's DNS record at the server.
2. Pre-provision a private S3-compatible bucket and an application credential limited to listing, reading, writing, and deleting objects in only that bucket. LaunchPad does not require storage-admin or bucket-creation permission.
3. Copy `.env.production.example` to `.env.production` and replace every placeholder, including the bucket endpoint, name, region, and scoped credential. Put every invited Google email in `BETA_ALLOWED_EMAILS`. Generate the MongoDB replica-set key file described in that example and keep it outside the repository with mode `0400`.
4. In Google Cloud, add the HTTPS login and Calendar callback URLs, keep the consent screen in testing mode, and add the same invited users as test users.
5. Allow inbound ports 80 and 443 in the server firewall.
6. Start the production stack:

```bash
docker compose \
  --env-file .env.production \
  -f compose.yaml \
  -f compose.production.yaml \
  up --build -d
```

Caddy obtains and renews the domain's TLS certificate automatically. New email/password registration is disabled in this mode, but existing email/password accounts can still sign in. Do not use local passwords or reuse secrets on a public server.

`LAUNCHPAD_RELEASE` gives all three application images a fixed beta tag rather
than the mutable `latest` tag. Change it for each release. Before starting the
stack, verify the scoped storage credential without exposing it:

```bash
./scripts/test-production-storage-config.sh
```

The production application refuses to render its Compose configuration when any
S3 setting is missing. The bucket must already exist. The health endpoint checks
both MongoDB and that bucket, and the encrypted backup/restore scripts use the same
S3-compatible interface. Keep provider-side public access disabled and enable the
provider's own retention or recovery controls if available; LaunchPad's off-server
encrypted backups remain required regardless.

MongoDB runs as a single-member replica set so application quota checks and writes can be transactional. This enables atomic writes but is not high availability or a substitute for off-server backups. See the [verified upgrade checkpoint](docs/mongo-replica-upgrade.md) before recreating a stack that already contains data.

### Production backups and monitoring

Install `rclone`, configure the remote named by `BACKUP_REMOTE`, then run the encrypted backup once and verify the uploaded `.enc` and checksum files:

```bash
./scripts/backup-production.sh
```

Daily backups are retained for seven days and Sunday snapshots for four weeks. Restore one into a clean environment before inviting users:

```bash
./scripts/restore-production.sh --yes backups/production/launchpad-TIMESTAMP.tar.gz.enc
```

The `ops/` directory contains systemd service and timer templates for daily backups and five-minute production checks. They assume the app is installed at `/opt/launchpad`; change that path if needed, copy the units to `/etc/systemd/system`, then enable both timers. `production-check.sh` verifies the public health endpoint, containers, disk usage, and recent off-server backups. Set `ALERT_WEBHOOK_URL` to deliver failures to a compatible webhook and also configure an independent uptime monitor for `https://YOUR_DOMAIN/api/health`.

Before each beta release, run the backend tests, frontend production build, dependency audit, and the bounded security review described in the release checklist. Do not invite users until the clean-server restore drill succeeds. Any temporary invite-beta security exception must be written down and removed before a public launch.

See [Production readiness and security findings](docs/production-readiness.md) for the current release blockers and verified checks. Container release scans must include vulnerabilities without published fixes; a fixable-only scan is not sufficient.

## Chrome extension

The unpacked extension in `extension/` is configured for the local site at `http://localhost:8080`. Load the directory from `chrome://extensions` with Developer mode enabled, then sign in directly in the popup. It can also reuse a website session when that session belongs to the same Chrome profile. Version 1.8.0 includes the unified Launchpad interface, a Settings shortcut, persistent event and application drafts, shared Simple/Advanced application data, no-AI tab grabbing, structured job-page reading, cropped event-flyer and job-posting capture, optional AI improvement, a compact weekly calendar with a legacy list view, and Google sync.

For a public deployment, replace the local URL in `extension/popup.js` and `extension/manifest.json`, restrict backend CORS to the installed extension ID, and rebuild `frontend/public/launchpad-extension.zip`.

Event-flyer and job-posting screenshots are read by the self-hosted OCR service and discarded immediately. Use **Scan flyer** on the Calendar page to paste, drop, or upload a screenshot, or use the extension capture buttons to draw a full-resolution crop around an event or job listing on the visible browser tab. Small embedded images can be zoomed before the final crop. Extracted details always open as an editable draft and are never saved automatically. Events may also record an optional organizer such as a club, department, company, or person.

For difficult flyers or postings, an optional **Improve with AI** button sends only the selected image with limited OCR text, or the limited job-page text extracted after **Read job page**, to Gemini Flash-Lite. It never runs automatically. Add `GEMINI_API_KEY` to `.env` and recreate the backend to enable it. New API accounts use `gemini-3.5-flash-lite` because Google no longer makes 2.5 Flash-Lite available to them; `GEMINI_MODEL` can override the model later. `AI_FLYER_DAILY_LIMIT` defaults to 20 successful or attempted provider calls per user per UTC day across all capture types, providing a hard cost guardrail. Local extraction remains available when Gemini is disabled, unavailable, or the daily limit is reached.

## Authentication status

Email/password registration and login are fully local. Direct Google sign-in uses an OAuth web client owned by the operator and links to an existing account only when Google supplies the same verified email address. Launchpad requests only the `openid`, `email`, and `profile` scopes and does not store Google access or refresh tokens.

### Enable Google sign-in locally

1. In Google Cloud Console, configure the OAuth consent screen and create an OAuth 2.0 client with application type **Web application**.
2. Add this exact authorized redirect URI:

```text
http://localhost:8080/api/auth/google/callback
```

3. Copy `.env.example` to `.env`, set `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET`, and keep `PUBLIC_BASE_URL=http://localhost:8080`.
4. Recreate the backend with `docker compose up --build -d backend`.

The Google button remains hidden when credentials are absent. If the consent screen is in testing mode, add the Google accounts that may sign in as test users.

For production, add `https://YOUR_DOMAIN/api/auth/google/callback` to the same web client and place the credentials in `.env.production`.

### Enable Google Calendar export

Launchpad always saves events locally first. Connecting Calendar is optional, requests access only when a user clicks **Connect Google Calendar**, and creates a separate Google calendar named **LaunchPad**. It never imports or reads unrelated personal calendars. Each Launchpad user owns a separate encrypted connection record and may connect a Google account different from the account used to sign in.

1. Enable the **Google Calendar API** in the same Google Cloud project.
2. Add this second exact URI to the existing OAuth web client:

```text
http://localhost:8080/api/integrations/google-calendar/callback
```

3. Keep the consent screen in testing mode if desired and add each permitted Google account as a test user. The app requests the narrow `calendar.app.created` scope in addition to identity scopes.
4. Generate a token-encryption key once and save it as `GOOGLE_CALENDAR_TOKEN_KEY` in `.env`:

```bash
openssl rand -base64 32 | tr '+/' '-_'
```

5. Recreate the backend with `docker compose up --build -d backend`.

Do not rotate or lose this key while connections exist; doing so makes stored Google refresh tokens unreadable. Disconnecting removes the encrypted credential but intentionally leaves the dedicated Google calendar and its events in the connected account. For production, add the HTTPS version of the Calendar callback URI and use a separately generated key in `.env.production`.

Cookie behavior is environment-controlled. Local Compose uses HTTP-compatible cookies. A public HTTPS deployment must set `COOKIE_SECURE=true` and should use an exact CORS allowlist.
Sessions use a persistent, HTTP-only cookie for 30 days by default (`SESSION_DAYS` can change this), and only a one-way hash of each session token is stored in MongoDB. Google sign-in always presents the account chooser so signing out does not silently sign the same Google account back in.

MongoDB does not provide PostgreSQL-style row-level security, so Launchpad applies the equivalent ownership boundary in the API: every application, event, skill, experience record, calendar feed, Google connection, note, attachment, analytics, and sync operation includes the authenticated user's `user_id`. Cross-user record requests receive the same `404` as an unknown record, and internal object-storage paths, Google event identifiers, access tokens, and refresh tokens are not returned to browsers.

## Development without Compose

Backend variables are documented in `backend/.env.example`; frontend variables are documented in `frontend/.env.example`. The production frontend always calls the API through same-origin `/api`.

## Persistent data

Compose creates two named volumes:

- `launchpad_mongo_data`
- `launchpad_minio_data`

Running `docker compose down` preserves them. Running `docker compose down --volumes` permanently deletes the local database and attachments.
