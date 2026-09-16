# Launchpad Chrome Extension

A companion popup for your **Launchpad** job/internship tracker. Add applications and private
calendar events from any tab — everything syncs instantly to your account.

## Features
- **Quick add** an application (Simple or Advanced mode) that appears immediately in your account.
- **Capture job** — reads structured `JobPosting` data and relevant visible listing text without AI.
- **Capture with AI** — sends those extracted job-page details to Gemini Flash-Lite for a stronger application draft when explicitly selected.
- **Shared application draft** — Simple and Advanced are two views of the same saved draft, so switching modes or closing the popup does not discard extracted fields.
- **Live stats** — total applications, interviews, and offers at a glance.
- **Recent applications** — a condensed list with company logos and status; click to open the full list.
- **Quick event add** — create local events with organizer, category, time, location, reminder, and a curated icon.
- **Account timezone** — new events and flyer scans use the timezone saved in Launchpad Settings.
- **Settings shortcut** — open account settings directly from the popup header.
- **Recoverable event drafts** — event fields and the active Events tab are restored if the popup closes before you save.
- **Capture flyer** — takes a full-resolution screenshot of the visible tab, lets you crop or zoom into small flyers, then locally prefills a reviewable event draft without storing the image.
- **Improve with AI** — optionally asks Gemini Flash-Lite to re-read a selected flyer; application AI capture also runs only when explicitly selected.
- **Upcoming events** — browse a compact Monday–Sunday calendar one week at a time, or switch to the original 30-day list.
- **Optional Google export** — when connected on the website, add an event to the dedicated LaunchPad Google calendar.
- Uses your existing Launchpad login (no separate password) — session is shared with the website.

## Install (Load Unpacked)
1. Open Chrome → `chrome://extensions`.
2. Toggle **Developer mode** (top-right) ON.
3. Click **Load unpacked** and select this `extension/` folder.
4. Pin the **Launchpad** icon to your toolbar.

## Sign in
- Sign in directly in the extension with the same email and password as Launchpad. The extension
  stores only an opaque persistent session token, never your password. The backend stores only a
  one-way hash of that token and applies the same per-user data boundary as the website.
- If you are already signed in to Launchpad in the same Chrome profile, click
  **Use my Chrome browser session**. Chrome profiles and other browsers do not share cookies.
- Google-only accounts should sign in with Google on the website in Chrome, then choose
  **Use my Chrome browser session** in the extension.

## How the sync works
- The popup calls the same backend API as the website (`/api/...`) with a bearer session.
- Adding an application `POST`s to `/api/applications`, so it shows up in your dashboard, board,
  and list right away.

## Notes / Config
- The backend URL defaults to `http://localhost:8080` in `popup.js` (`API_BASE`). If you deploy the site to a new domain,
  update `API_BASE` **and** the `host_permissions` entry in `manifest.json` to match.
- Browser-session reuse requires Launchpad to be signed in in the **same Chrome profile**; direct
  extension sign-in works independently of website cookies.
- For a public deployment, set `CHROME_EXTENSION_IDS` in `.env.production` to the ID shown on
  `chrome://extensions` and restart the backend.
