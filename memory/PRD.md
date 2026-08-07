# CareerTrack — Job & Internship Tracker (PRD)

## Original Problem Statement
Build an interactive job/internship tracker with an analytics dashboard as the landing page, styled per the provided dark-navy "CareerTrack" HTML/Tailwind design. Required fields: company name, job/internship title, day applied, expected start date (TBD option). Optional: description, pay rate, confidence level. Load real company logos where available. (User choices: dual login — Google + email/password; charts driven by real data; logos auto-fetched from domain with colored-initial fallback; add application status tracking; keep dark navy theme.)

## Architecture
- **Frontend**: React 19 (CRA/craco), TailwindCSS, recharts, lucide-react, sonner, shadcn/ui. React Router with AuthContext.
- **Backend**: FastAPI, Motor (async MongoDB). All routes under `/api`.
- **DB**: MongoDB — collections: `users`, `user_sessions`, `applications`.
- **Auth**: Unified opaque `session_token` httpOnly cookie (samesite=none, secure, 7d) for BOTH email/password (bcrypt) and Emergent Google OAuth. Also accepts `Authorization: Bearer`.

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
- Dual auth (email/password + Emergent Google social login) with session cookies; demo user seeding.
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

## Backlog / Remaining
- **P1**: Custom themed date picker (replace native date input); always-visible edit/delete on touch devices.
- **P1**: Validate `pay_period` as an enum on backend; handle month gaps in volume chart.
- **P2**: Password reset flow; interview date reminders/notifications; CSV import/export; kanban board view; notes/attachments per application.

## Test Credentials
- demo@careertrack.com / demo1234 (seeded with 10 sample applications)
