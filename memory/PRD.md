# LaunchPad — Career Management Workspace (PRD)

## Original Problem Statement
Build an interactive job/internship tracker with an analytics dashboard as the landing page, styled per the provided dark-navy "CareerTrack" HTML/Tailwind design. Required fields: company name, job/internship title, day applied, expected start date (TBD option). Optional: description, pay rate, confidence level. Load real company logos where available. (User choices: dual login — Google + email/password; charts driven by real data; logos auto-fetched from domain with colored-initial fallback; add application status tracking; keep dark navy theme.)

## Architecture
- **Frontend**: React 19 (CRA/craco), TailwindCSS, recharts, lucide-react, sonner, shadcn/ui. React Router with AuthContext.
- **Backend**: FastAPI, Motor (async MongoDB). All routes under `/api`.
- **DB**: MongoDB with private, user-scoped collections for accounts, sessions, applications, events, goals, Career Library records, integrations, and operational controls.
- **Auth**: Unified opaque `session_token` HTTP-only cookie, operator-owned Google OpenID Connect, and bearer sessions for the Chrome extension. Production registration is limited to invited Google accounts.

## User Personas
- Student/job-seeker tracking multiple job & internship applications and monitoring progress via analytics.

## Core Requirements (static)
- Required: company name, job title, day applied, expected start date (or TBD).
- Optional: description, pay rate (+period), confidence level, company website.
- Status: Applied / Screening / Interviewing / Offer / Rejected.
- Real-data analytics: KPIs, volume-over-time, status distribution, compensation.
- Company logos via domain with initials fallback.
- Dark navy theme per provided design.

## Implemented (2026-06-07)
- Email/password auth with session cookies; optional demo-user seeding for local testing.
- Applications CRUD (create/list/edit/delete) scoped per user, with validation.
- Analytics endpoint computing KPIs, monthly volume, status donut, annualized compensation from real data.
- Dashboard landing page (KPI cards, area/donut/bar charts, recent applications) matching design.
- Applications page: cards, search, status filter chips, add/edit dialog, delete confirm.
- Company logos via DuckDuckGo icon service with colored-initials fallback.
- Seeded 10 sample applications for demo user.

## Implemented — Feature Round 2 (2026-06-07)
- **Kanban Board** (`/board`): drag-and-drop cards across 5 status columns; status persists via PUT. (17/17 backend, verified DnD persistence)
- **CSV Import/Export**: export all applications to CSV; bulk import via `POST /api/applications/bulk` with client-side row validation + "imported/skipped" summary toast.
- **Themed dark date picker**: react-day-picker Popover+Calendar replaces native date inputs for day applied, expected start date, and follow-up reminder.
- **Follow-up deadline reminders**: `follow_up_date` field; dashboard "Follow-ups due" section + overdue/soon badges on Applications cards and Board cards.

## Implemented — Feature Round 3 (2026-06-07)
- **Rebrand to Launchpad**: rocket logo mark (extracted from user logo → `/public/launchpad-mark.png`) + name across sidebar, mobile header, login, and page title.
- **Notes Timeline**: per-application activity log (auto `created` + `status` change events + user `note`s). `POST /api/applications/{id}/notes`; shown in a new Application Detail dialog (click any card on Applications or Board).
- **Interview Scheduler**: `interview_date` (date+time) per application; badges on cards + a dashboard "Upcoming Interviews" mini calendar (react-day-picker) with highlighted days and a list.
- **Full-width Board**: Layout `wide` prop lets the Kanban board's 5 status columns stretch across the viewport; cards clickable → detail; DnD status change auto-logs to timeline and refreshes.
- **Month-only start date**: create/edit form start-date has Exact / Month / TBD modes; Month uses a custom MonthPicker and displays as e.g. "Nov 2026".
- Verified: 22/22 backend tests; board full-width + all flows confirmed.

## Implemented — Feature Round 4 (2026-06-07)
- **Attachments (S3-compatible storage)**: upload resume & job-description files per application; stored in MinIO/S3 with metadata in Mongo (`attachments[]`). Endpoints: `POST/GET/DELETE /api/applications/{id}/attachments[/{att_id}]`. UI in the Application Detail dialog (upload / list / download / remove).
- **Simple/Advanced form modes**: Add-Application dialog has Simple (company, role, day applied, description) and Advanced (all fields grouped into Basics / Timeline / Interview / Compensation / Details) tabs at the bottom.
- **Google avatar**: reusable `Avatar` component shows the signed-in user's Google photo in top bar + Settings, with initials fallback (and onError fallback for dead photo URLs).
- **Account linking**: `POST /api/auth/session` matches by email, so an email-registered user signing in with Google (same address) reuses the same account (no duplicate).
- Verified: 30/30 backend tests; attachments upload/download/delete, Simple/Advanced tabs, avatar fallback all confirmed.

## Backlog / Remaining
- **P2**: Touch/pointer drag on board for mobile; interview reminders/notifications; weekly email digest; forced-download param for attachments; async (httpx) object-storage calls.

## Implemented — Independent Runtime & Authentication (2026-09-08)
- Removed the Emergent OAuth broker and added operator-owned Google OpenID Connect using the server-side authorization-code flow.
- Added state, PKCE, nonce, signed ID-token verification, single-use OAuth state, verified-email account linking, and environment-controlled provider availability.
- Added a self-hosted MongoDB/MinIO/Docker stack, production HTTPS overlay, secure production credentials, backups/restores, and independent Chrome-extension authentication.

## Current Release Direction
- Invite-only, self-hosted beta with the web application shipping before the Chrome Web Store release.
- Local development may enable email/password registration explicitly; production keeps new registration Google-only and allowlisted.
- Operational readiness includes encrypted off-server backups, restore drills, health monitoring, quotas, rate limiting, and documented security exceptions.
