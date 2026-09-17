const API_BASE = "http://localhost:8080";
const API = `${API_BASE}/api`;

const STATUS_COLORS = {
  Applied: "#737373", Screening: "#a3a3a3", Interviewing: "#e5e5e5",
  Offer: "#4ade80", Rejected: "#f87171",
};
let calendarConnected = false;
let capturedSourceUrl = null;
let captureImage = null;
let captureRect = null;
let captureStart = null;
let captureDragging = false;
let capturePageUrl = null;
let captureOriginalDataUrl = null;
let capturedFlyerBlob = null;
let capturedFlyerResult = null;
let capturedApplicationSourceUrl = null;
let capturedApplicationPageText = null;
let capturedApplicationStructuredFields = null;
let currentUserId = null;
let currentUserTimezone = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
let visibleWeekStart = startOfWeekMonday(new Date());
let restoringEventDraft = false;
let restoringApplicationDraft = false;

const EVENT_DRAFT_FIELDS = [
  "e-title", "e-organizer", "e-category", "e-date", "e-time", "e-end-date",
  "e-end-time", "e-timezone", "e-location", "e-description", "e-reminder",
  "e-icon", "e-picture", "e-all-day", "e-sync",
];

const APPLICATION_DRAFT_FIELDS = [
  "f-company", "f-title", "f-applied", "f-status", "f-domain", "f-start",
  "f-tbd", "f-pay", "f-period", "f-conf", "f-follow", "f-interview", "f-desc",
];

const $ = (id) => document.getElementById(id);

function getStoredToken() {
  return new Promise((resolve) => {
    chrome.storage.local.get(["sessionToken"], (result) => {
      if (chrome.runtime.lastError) resolve(null);
      else resolve(result.sessionToken || null);
    });
  });
}

function storeToken(token) {
  return new Promise((resolve, reject) => {
    chrome.storage.local.set({ sessionToken: token }, () => {
      if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message));
      else resolve();
    });
  });
}

function clearStoredToken() {
  return new Promise((resolve) => chrome.storage.local.remove("sessionToken", resolve));
}

function readLocalStorage(keys) {
  return new Promise((resolve) => {
    chrome.storage.local.get(keys, (result) => resolve(chrome.runtime.lastError ? {} : result));
  });
}

function writeLocalStorage(values) {
  return new Promise((resolve) => chrome.storage.local.set(values, resolve));
}

function removeLocalStorage(keys) {
  return new Promise((resolve) => chrome.storage.local.remove(keys, resolve));
}

// Read the Launchpad session cookie (httpOnly) via the extension cookies API.
function getCookieToken() {
  return new Promise((resolve) => {
    try {
      chrome.cookies.get({ url: `${API_BASE}/`, name: "session_token" }, (c) => {
        if (chrome.runtime.lastError) resolve(null);
        else resolve(c ? c.value : null);
      });
    } catch {
      resolve(null);
    }
  });
}

async function getToken() {
  const stored = await getStoredToken();
  if (stored) return stored;
  const cookie = await getCookieToken();
  if (cookie) await storeToken(cookie);
  return cookie;
}

async function api(path, opts = {}) {
  const token = await getToken();
  if (!token) { const e = new Error("no session"); e.status = 401; throw e; }
  const { headers: optionHeaders = {}, ...requestOptions } = opts;
  const isFormData = typeof FormData !== "undefined" && opts.body instanceof FormData;
  const res = await fetch(`${API}${path}`, {
    ...requestOptions,
    headers: {
      ...(!isFormData ? { "Content-Type": "application/json" } : {}),
      Authorization: `Bearer ${token}`,
      ...optionHeaders,
    },
  });
  if (!res.ok) {
    if (res.status === 401) await clearStoredToken();
    const payload = await res.json().catch(() => ({}));
    const err = new Error(typeof payload.detail === "string" ? payload.detail : `HTTP ${res.status}`);
    err.status = res.status;
    throw err;
  }
  return res.status === 204 ? null : res.json();
}

async function extensionLogin(event) {
  event.preventDefault();
  const email = $("auth-email").value.trim();
  const password = $("auth-password").value;
  const error = $("auth-error");
  const button = $("extension-login-btn");
  hide("auth-error");
  button.disabled = true;
  button.textContent = "Signing in…";

  try {
    const response = await fetch(`${API}/auth/extension-login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password }),
    });
    if (!response.ok) {
      const body = await response.json().catch(() => ({}));
      const failure = new Error(body.detail || `HTTP ${response.status}`);
      failure.status = response.status;
      throw failure;
    }
    const result = await response.json();
    await storeToken(result.session_token);
    $("auth-password").value = "";
    await init();
  } catch (failure) {
    error.textContent = failure.status === 401
      ? "Email or password is incorrect."
      : failure.status === 403
        ? "This extension isn't authorized by Launchpad. Reload the updated extension."
        : "Couldn't connect to Launchpad. Make sure the local app is running.";
    show("auth-error");
  } finally {
    button.disabled = false;
    button.textContent = "Sign in";
  }
}

function toast(msg, isErr = false) {
  const t = $("toast");
  t.textContent = msg;
  t.className = `toast ${isErr ? "err" : ""}`;
  setTimeout(() => t.classList.add("hidden"), 2200);
}

function show(id) { $(id).classList.remove("hidden"); }
function hide(id) { $(id).classList.add("hidden"); }

function logoUrl(app) {
  let d = app.company_domain;
  if (!d && app.company_name) d = app.company_name.replace(/[^a-z0-9]/gi, "").toLowerCase() + ".com";
  return d ? `https://icons.duckduckgo.com/ip3/${d}.ico` : "";
}

function initialAvatar(name) {
  const c = document.createElement("canvas");
  c.width = c.height = 52;
  const ctx = c.getContext("2d");
  ctx.fillStyle = "#2e2e2e";
  ctx.fillRect(0, 0, 52, 52);
  ctx.fillStyle = "#f5f5f5";
  ctx.font = "bold 26px sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText((name || "?")[0].toUpperCase(), 26, 28);
  return c.toDataURL();
}

// ---- Init / auth ----
async function init() {
  show("loading");
  hide("auth-gate");
  hide("main");
  try {
    const me = await api("/auth/me");
    currentUserId = me.user_id;
    currentUserTimezone = me.preferences?.timezone || currentUserTimezone;
    $("user-line").textContent = me.email || "Signed in";
    hide("loading");
    show("main");
    await Promise.all([loadStats(), loadList(), loadCalendarIntegration(), loadEvents()]);
    await Promise.all([restoreEventDraft(), restoreApplicationDraft()]);
    const savedUi = await readLocalStorage(["activeTopTab"]);
    setTopTab(savedUi.activeTopTab === "events" ? "events" : "applications", false);
  } catch (e) {
    hide("loading");
    if (e.status === 401) show("auth-gate");
    else { show("auth-gate"); $("auth-gate").querySelector("p").textContent = "Couldn't reach Launchpad. Make sure you're online and signed in."; }
  }
}

async function loadStats() {
  try {
    const a = await api("/analytics");
    $("s-total").textContent = a.kpis?.total ?? 0;
    $("s-int").textContent = a.kpis?.interviews ?? 0;
    $("s-off").textContent = a.kpis?.offers ?? 0;
  } catch { /* ignore */ }
}

async function loadList() {
  const list = $("list");
  list.innerHTML = "";
  try {
    const apps = await api("/applications");
    if (!apps.length) {
      list.innerHTML = `<div class="list-empty">No applications yet. Add your first above.</div>`;
      return;
    }
    apps.slice(0, 6).forEach((app) => {
      const row = document.createElement("div");
      row.className = "item";
      const color = STATUS_COLORS[app.status] || "#737373";
      const src = logoUrl(app) || initialAvatar(app.company_name);
      row.innerHTML = `
        <img src="${src}" alt="" />
        <div class="meta">
          <div class="t">${escapeHtml(app.job_title)}</div>
          <div class="c">${escapeHtml(app.company_name)}</div>
        </div>
        <span class="pill" style="color:${color};background:${color}22">${app.status}</span>`;
      row.querySelector("img").addEventListener("error", (ev) => { ev.target.src = initialAvatar(app.company_name); });
      row.addEventListener("click", () => chrome.tabs.create({ url: `${API_BASE}/applications` }));
      list.appendChild(row);
    });
  } catch {
    list.innerHTML = `<div class="list-empty">Couldn't load applications.</div>`;
  }
}

function escapeHtml(s) {
  return (s || "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
}

function localDate(value = new Date()) {
  const pad = (n) => String(n).padStart(2, "0");
  return `${value.getFullYear()}-${pad(value.getMonth() + 1)}-${pad(value.getDate())}`;
}

function startOfWeekMonday(value) {
  const start = new Date(value);
  start.setHours(0, 0, 0, 0);
  start.setDate(start.getDate() - ((start.getDay() + 6) % 7));
  return start;
}

function addCalendarDays(value, days) {
  const next = new Date(value);
  next.setDate(next.getDate() + days);
  return next;
}

function pictureUrl(identifier) {
  if (!identifier || !/^(fluent-emoji-flat|noto|openmoji|twemoji):[a-z0-9-]+$/.test(identifier)) return null;
  const [prefix, name] = identifier.split(":");
  return `https://api.iconify.design/${prefix}/${name}.svg`;
}

function setTopTab(tab, persist = true) {
  const applications = tab === "applications";
  $("applications-panel").classList.toggle("hidden", !applications);
  $("events-panel").classList.toggle("hidden", applications);
  $("tab-applications").classList.toggle("active", applications);
  $("tab-events").classList.toggle("active", !applications);
  $("tab-applications").setAttribute("aria-selected", String(applications));
  $("tab-events").setAttribute("aria-selected", String(!applications));
  if (persist) void writeLocalStorage({ activeTopTab: tab });
}

async function loadCalendarIntegration() {
  try {
    const status = await api("/integrations/google-calendar");
    calendarConnected = !!status.connected;
    $("calendar-status").textContent = calendarConnected ? "Google connected" : "Local only";
    $("calendar-status").classList.toggle("connected", calendarConnected);
    $("e-sync-row").classList.toggle("hidden", !calendarConnected);
    $("e-sync").checked = calendarConnected;
  } catch {
    calendarConnected = false;
  }
}

function eventDateKey(item) {
  return item.all_day ? item.start_date : localDate(new Date(item.starts_at));
}

function eventTimeShort(item) {
  return item.all_day
    ? "All day"
    : new Date(item.starts_at).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

function weekRangeLabel(start) {
  const end = addCalendarDays(start, 6);
  const startMonth = start.toLocaleDateString([], { month: "short" });
  const endMonth = end.toLocaleDateString([], { month: "short" });
  const year = end.getFullYear() !== new Date().getFullYear() ? `, ${end.getFullYear()}` : "";
  return start.getMonth() === end.getMonth()
    ? `${startMonth} ${start.getDate()}–${end.getDate()}${year}`
    : `${startMonth} ${start.getDate()}–${endMonth} ${end.getDate()}${year}`;
}

function eventColor(category) {
  return {
    Academic: "#93c5fd",
    Work: "#d4d4d8",
    "Job Search": "#c4b5fd",
    Interview: "#67e8f9",
    "Career Fair": "#f9a8d4",
    Deadline: "#fca5a5",
    Personal: "#86efac",
    Other: "#fcd34d",
  }[category] || "#a3a3a3";
}

function animateWeek(direction) {
  const calendar = $("week-calendar");
  calendar.classList.remove("week-enter-left", "week-enter-right");
  void calendar.offsetWidth;
  calendar.classList.add(direction === "previous" ? "week-enter-left" : "week-enter-right");
}

function renderWeek(items, direction) {
  $("week-today").textContent = weekRangeLabel(visibleWeekStart);
  const calendar = $("week-calendar");
  calendar.innerHTML = "";
  const todayKey = localDate(new Date());

  for (let offset = 0; offset < 7; offset++) {
    const day = addCalendarDays(visibleWeekStart, offset);
    const key = localDate(day);
    const dayItems = items.filter((item) => eventDateKey(item) === key);
    const column = document.createElement("div");
    column.className = `week-day${key === todayKey ? " today" : ""}`;
    column.innerHTML = `<div class="week-day-name">${day.toLocaleDateString([], { weekday: "short" }).slice(0, 2)}</div><div class="week-day-number">${day.getDate()}</div><div class="week-events"></div>`;
    const events = column.querySelector(".week-events");

    if (!dayItems.length) {
      events.innerHTML = `<span class="week-empty" aria-label="No events">—</span>`;
    } else {
      dayItems.slice(0, 2).forEach((item) => {
        const event = document.createElement("button");
        event.type = "button";
        event.className = "week-event";
        event.title = `${item.title} · ${eventTimeShort(item)}`;
        const color = eventColor(item.category);
        event.innerHTML = `<span class="week-event-dot" style="background:${color}"></span><span class="week-event-title">${escapeHtml(item.title)}</span><span class="week-event-time">${escapeHtml(eventTimeShort(item))}</span>`;
        event.addEventListener("click", () => chrome.tabs.create({ url: `${API_BASE}/calendar` }));
        events.appendChild(event);
      });
      if (dayItems.length > 2) {
        const more = document.createElement("button");
        more.type = "button";
        more.className = "week-more";
        more.textContent = `+${dayItems.length - 2}`;
        more.title = `${dayItems.length - 2} more event${dayItems.length - 2 === 1 ? "" : "s"}`;
        more.addEventListener("click", () => chrome.tabs.create({ url: `${API_BASE}/calendar` }));
        events.appendChild(more);
      }
    }
    calendar.appendChild(column);
  }
  animateWeek(direction);
}

async function loadWeekEvents(direction = "next") {
  const calendar = $("week-calendar");
  calendar.innerHTML = `<div class="week-loading">Loading week…</div>`;
  $("week-today").textContent = weekRangeLabel(visibleWeekStart);
  const end = addCalendarDays(visibleWeekStart, 7);
  try {
    const items = await api(`/calendar/items?from=${encodeURIComponent(visibleWeekStart.toISOString())}&to=${encodeURIComponent(end.toISOString())}`);
    renderWeek(items, direction);
  } catch {
    calendar.innerHTML = `<div class="week-loading">Couldn't load this week.</div>`;
  }
}

async function loadEventList() {
  const list = $("event-list");
  list.innerHTML = "";
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  const end = new Date(start);
  end.setDate(end.getDate() + 30);
  try {
    const items = await api(`/calendar/items?from=${encodeURIComponent(start.toISOString())}&to=${encodeURIComponent(end.toISOString())}`);
    if (!items.length) {
      list.innerHTML = `<div class="list-empty">Nothing scheduled in the next 30 days.</div>`;
      return;
    }
    items.slice(0, 6).forEach((item) => {
      const row = document.createElement("div");
      row.className = "item";
      const when = item.all_day
        ? `${item.start_date} · All day`
        : new Date(item.starts_at).toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
      const picture = pictureUrl(item.image_icon);
      row.innerHTML = `${picture ? `<img src="${picture}" alt="" />` : ""}<div class="meta"><div class="t">${escapeHtml(item.title)}</div><div class="c">${escapeHtml(item.category)}${item.subtitle ? ` · ${escapeHtml(item.subtitle)}` : ""}</div></div><span class="event-date">${escapeHtml(when)}</span>`;
      row.addEventListener("click", () => chrome.tabs.create({ url: `${API_BASE}/calendar` }));
      list.appendChild(row);
    });
  } catch {
    list.innerHTML = `<div class="list-empty">Couldn't load upcoming events.</div>`;
  }
}

async function loadEvents() {
  await Promise.all([loadWeekEvents(), loadEventList()]);
}

function setEventView(view) {
  const week = view === "week";
  $("event-week-view").classList.toggle("hidden", !week);
  $("event-list-view").classList.toggle("hidden", week);
  $("event-view-week").classList.toggle("active", week);
  $("event-view-list").classList.toggle("active", !week);
  $("event-view-week").setAttribute("aria-selected", String(week));
  $("event-view-list").setAttribute("aria-selected", String(!week));
}

function eventDraftStorageKey() {
  return currentUserId ? `eventDraft:${currentUserId}` : null;
}

function eventDraftData() {
  const values = {};
  EVENT_DRAFT_FIELDS.forEach((id) => {
    const field = $(id);
    values[id] = field.type === "checkbox" ? field.checked : field.value;
  });
  return {
    values,
    advanced: !$("event-advanced").classList.contains("hidden"),
    sourceUrl: capturedSourceUrl,
    updatedAt: new Date().toISOString(),
  };
}

async function saveEventDraft() {
  const key = eventDraftStorageKey();
  if (!key || restoringEventDraft) return;
  await writeLocalStorage({ [key]: eventDraftData() });
  $("event-draft-status").textContent = "Draft saved";
  show("event-draft-status");
}

async function clearEventDraft() {
  const key = eventDraftStorageKey();
  if (key) await removeLocalStorage(key);
  hide("event-draft-status");
}

async function restoreEventDraft() {
  const key = eventDraftStorageKey();
  if (!key) return;
  const stored = await readLocalStorage([key]);
  const draft = stored[key];
  if (!draft?.values) return;

  restoringEventDraft = true;
  EVENT_DRAFT_FIELDS.forEach((id) => {
    const field = $(id);
    if (!field || !(id in draft.values)) return;
    if (field.type === "checkbox") {
      field.checked = id === "e-sync" ? calendarConnected && !!draft.values[id] : !!draft.values[id];
    } else if ((id === "e-time" || id === "e-end-time") && draft.values[id]) {
      setTimeValue(id, draft.values[id]);
    } else {
      field.value = draft.values[id];
    }
  });
  capturedSourceUrl = draft.sourceUrl || null;
  $("e-time").disabled = $("e-all-day").checked;
  $("e-end-time").disabled = $("e-all-day").checked;
  $("event-advanced").classList.toggle("hidden", !draft.advanced);
  $("event-advanced-toggle").textContent = draft.advanced ? "Fewer details" : "More details";
  $("event-draft-status").textContent = "Draft restored";
  show("event-draft-status");
  restoringEventDraft = false;
}

function applicationDraftStorageKey() {
  return currentUserId ? `applicationDraft:${currentUserId}` : null;
}

function applicationDraftData() {
  const values = {};
  APPLICATION_DRAFT_FIELDS.forEach((id) => {
    const field = $(id);
    values[id] = field.type === "checkbox" ? field.checked : field.value;
  });
  return {
    values,
    mode: $("adv").classList.contains("hidden") ? "simple" : "advanced",
    sourceUrl: capturedApplicationSourceUrl,
    updatedAt: new Date().toISOString(),
  };
}

async function saveApplicationDraft() {
  const key = applicationDraftStorageKey();
  if (!key || restoringApplicationDraft) return;
  await writeLocalStorage({ [key]: applicationDraftData() });
}

async function clearApplicationDraft() {
  const key = applicationDraftStorageKey();
  if (key) await removeLocalStorage(key);
}

async function restoreApplicationDraft() {
  const key = applicationDraftStorageKey();
  if (!key) return;
  const stored = await readLocalStorage([key]);
  const draft = stored[key];
  if (!draft?.values) return;

  restoringApplicationDraft = true;
  APPLICATION_DRAFT_FIELDS.forEach((id) => {
    const field = $(id);
    if (!field || !(id in draft.values)) return;
    if (field.type === "checkbox") field.checked = !!draft.values[id];
    else field.value = draft.values[id];
  });
  capturedApplicationSourceUrl = draft.sourceUrl || null;
  $("f-start").disabled = $("f-tbd").checked;
  setMode(draft.mode === "advanced" ? "advanced" : "simple", false);
  restoringApplicationDraft = false;
}

function resetEventForm() {
  const now = new Date();
  const start = new Date(now);
  start.setMinutes(0, 0, 0);
  start.setHours(start.getHours() + 1);
  const end = new Date(start.getTime() + 3600000);
  const time = (value) => `${String(value.getHours()).padStart(2, "0")}:${String(value.getMinutes()).padStart(2, "0")}`;
  $("e-title").value = "";
  $("e-category").value = "Other";
  $("e-date").value = localDate(start);
  $("e-time").value = time(start);
  $("e-end-date").value = localDate(end);
  $("e-end-time").value = time(end);
  $("e-timezone").value = currentUserTimezone;
  $("e-organizer").value = "";
  $("e-location").value = "";
  $("e-description").value = "";
  $("e-reminder").value = "";
  $("e-icon").value = "calendar-check";
  $("e-picture").value = "";
  $("e-all-day").checked = false;
  $("e-sync").checked = calendarConnected;
  capturedSourceUrl = null;
  capturedFlyerBlob = null;
  capturedFlyerResult = null;
  hide("event-capture-result");
  hide("event-ai-actions");
}

async function saveEvent() {
  const title = $("e-title").value.trim();
  const startDate = $("e-date").value;
  const allDay = $("e-all-day").checked;
  if (!title || !startDate || (!allDay && !$("e-time").value)) {
    toast("Event name, date, and time are required", true);
    return;
  }
  const endDate = $("e-end-date").value || startDate;
  const startLocal = `${startDate}T${$("e-time").value}:00`;
  const endLocal = `${endDate}T${$("e-end-time").value || $("e-time").value}:00`;
  const payload = {
    title,
    category: $("e-category").value,
    all_day: allDay,
    starts_at: allDay ? null : new Date(startLocal).toISOString(),
    ends_at: allDay ? null : new Date(endLocal).toISOString(),
    start_date: allDay ? startDate : null,
    end_date: allDay ? endDate : null,
    timezone: $("e-timezone").value || "UTC",
    organizer: $("e-organizer").value.trim() || null,
    location: $("e-location").value.trim() || null,
    description: $("e-description").value.trim() || null,
    source_url: capturedSourceUrl,
    reminder_minutes: $("e-reminder").value ? Number($("e-reminder").value) : null,
    icon: $("e-icon").value,
    image_icon: $("e-picture").value || null,
    sync_to_google: calendarConnected && $("e-sync").checked,
  };
  const button = $("event-save-btn");
  button.disabled = true;
  button.textContent = "Adding…";
  try {
    const event = await api("/events", { method: "POST", body: JSON.stringify(payload) });
    toast(event.google_sync_status === "error" ? "Saved locally; Google sync needs a retry" : "Event added", event.google_sync_status === "error");
    await clearEventDraft();
    resetEventForm();
    await loadEvents();
  } catch (failure) {
    toast(failure.status === 401 ? "Please sign in again" : failure.message || "Failed to add event", true);
  } finally {
    button.disabled = false;
    button.textContent = "Add event";
  }
}

function setTimeValue(selectId, value) {
  if (!value) return;
  const select = $(selectId);
  if (![...select.options].some((option) => option.value === value)) {
    const [hourText, minuteText] = value.split(":");
    const hour = Number(hourText);
    const option = document.createElement("option");
    option.value = value;
    option.textContent = `${hour % 12 || 12}:${minuteText} ${hour < 12 ? "AM" : "PM"}`;
    select.appendChild(option);
  }
  select.value = value;
}

function fillEventFromFlyer(result, fallbackUrl) {
  const fields = result.fields || {};
  const pictureByCategory = {
    Academic: "fluent-emoji-flat:graduation-cap",
    Work: "fluent-emoji-flat:briefcase",
    "Job Search": "fluent-emoji-flat:laptop",
    Interview: "fluent-emoji-flat:handshake",
    "Career Fair": "fluent-emoji-flat:office-building",
    Deadline: "fluent-emoji-flat:alarm-clock",
    Personal: "fluent-emoji-flat:spiral-calendar",
  };
  if (fields.title) $("e-title").value = fields.title;
  if (fields.category) {
    $("e-category").value = fields.category;
    $("e-picture").value = pictureByCategory[fields.category] || "";
  }
  if (fields.start_date) $("e-date").value = fields.start_date;
  if (fields.end_date) $("e-end-date").value = fields.end_date;
  if (fields.start_time) setTimeValue("e-time", fields.start_time);
  if (fields.end_time) setTimeValue("e-end-time", fields.end_time);
  if (fields.timezone) $("e-timezone").value = fields.timezone;
  if (fields.organizer) $("e-organizer").value = fields.organizer;
  if (fields.location) $("e-location").value = fields.location;
  if (fields.description) $("e-description").value = fields.description;
  if (typeof fields.all_day === "boolean") {
    $("e-all-day").checked = fields.all_day;
    $("e-time").disabled = fields.all_day;
    $("e-end-time").disabled = fields.all_day;
  }
  capturedSourceUrl = fields.source_url || fallbackUrl || null;
  $("event-advanced").classList.remove("hidden");
  $("event-advanced-toggle").textContent = "Fewer details";
  const note = $("event-capture-result");
  const warnings = result.warnings || [];
  note.textContent = warnings.length
    ? `${result.ai_enhanced ? "AI-improved draft" : "Draft filled"}. Review it before saving. ${warnings[0]}`
    : result.ai_enhanced
      ? "Draft improved with AI. Review it before saving."
      : "Draft filled from the selected flyer. Review it before saving.";
  note.classList.toggle("warn", warnings.length > 0);
  show("event-capture-result");
  capturedFlyerResult = result;
  if (capturedFlyerBlob && !result.ai_enhanced) {
    const button = $("improve-event-ai");
    button.disabled = !result.ai_available;
    button.textContent = "✦ Improve with AI";
    $("event-ai-note").textContent = result.ai_available
      ? "Uses Gemini only when clicked"
      : "Add a Gemini API key to enable";
    show("event-ai-actions");
  } else {
    hide("event-ai-actions");
  }
  void saveEventDraft();
}

async function improveEventWithAi() {
  if (!capturedFlyerBlob || !capturedFlyerResult?.ai_available) return;
  const button = $("improve-event-ai");
  button.disabled = true;
  button.textContent = "Improving…";
  $("event-ai-note").textContent = "Gemini is re-reading the crop";
  try {
    const payload = new FormData();
    payload.append("image", capturedFlyerBlob, "flyer-selection.png");
    payload.append("timezone", currentUserTimezone);
    if (capturedSourceUrl && /^https?:\/\//i.test(capturedSourceUrl)) payload.append("source_url", capturedSourceUrl);
    if (capturedFlyerResult.ocr_preview) payload.append("ocr_text", capturedFlyerResult.ocr_preview);
    const result = await api("/events/improve-flyer", { method: "POST", body: payload });
    fillEventFromFlyer(result, capturedSourceUrl);
    toast("Draft improved with AI");
  } catch (failure) {
    button.disabled = false;
    button.textContent = "✦ Improve with AI";
    $("event-ai-note").textContent = failure.message || "AI improvement failed; local draft kept";
    toast(failure.message || "AI improvement failed", true);
  }
}

function fillApplicationFromPosting(result, fallbackUrl) {
  const fields = result.fields || {};
  if (fields.company_name) $("f-company").value = fields.company_name;
  if (fields.job_title) $("f-title").value = fields.job_title;
  if (fields.company_domain) $("f-domain").value = fields.company_domain;
  if (fields.expected_start_date) {
    $("f-start").value = fields.expected_start_date;
    $("f-tbd").checked = false;
  } else if (fields.start_date_tbd === true) {
    $("f-start").value = "";
    $("f-tbd").checked = true;
  }
  $("f-start").disabled = $("f-tbd").checked;
  if (fields.pay_amount !== undefined && fields.pay_amount !== null) $("f-pay").value = String(fields.pay_amount);
  if (["hourly", "monthly", "yearly"].includes(fields.pay_period)) $("f-period").value = fields.pay_period;
  if (fields.description) $("f-desc").value = fields.description;
  capturedApplicationSourceUrl = fallbackUrl || capturedApplicationSourceUrl;

  const note = $("application-capture-result");
  const warnings = result.warnings || [];
  note.textContent = warnings.length
    ? `${result.ai_enhanced ? "AI-improved draft" : "Draft filled"}. Review it before saving. ${warnings[0]}`
    : result.ai_enhanced
      ? "Application draft improved with AI. Review it before saving."
      : "Application draft filled from the selected posting. Review it before saving.";
  note.classList.toggle("warn", warnings.length > 0);
  show("application-capture-result");
  void saveApplicationDraft();
}

function captureLabels() {
  return {
    subject: "flyer",
    title: "Crop the event flyer",
    help: "Drag around the flyer. Zoom in if it appears small.",
    reading: "Reading title, date, time, and location…",
    ready: "Selection ready. Analyze it to fill the event draft.",
  };
}

function drawCaptureEditor() {
  const canvas = $("capture-canvas");
  if (!captureImage || !canvas.width || !canvas.height) return;
  const context = canvas.getContext("2d");
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = "high";
  context.clearRect(0, 0, canvas.width, canvas.height);
  context.drawImage(captureImage, 0, 0, canvas.width, canvas.height);
  if (!captureRect) return;
  const { x, y, width, height } = captureRect;
  context.save();
  context.fillStyle = "rgba(0, 0, 0, 0.58)";
  context.fillRect(0, 0, canvas.width, y);
  context.fillRect(0, y, x, height);
  context.fillRect(x + width, y, canvas.width - x - width, height);
  context.fillRect(0, y + height, canvas.width, canvas.height - y - height);
  context.strokeStyle = "#67e8f9";
  const bounds = canvas.getBoundingClientRect();
  const displayScale = bounds.width > 0 ? canvas.width / bounds.width : 1;
  const stroke = Math.max(3, 3 * displayScale);
  const handle = Math.max(4, 5 * displayScale);
  context.lineWidth = stroke;
  context.strokeRect(x + stroke / 2, y + stroke / 2, Math.max(0, width - stroke), Math.max(0, height - stroke));
  context.fillStyle = "#67e8f9";
  for (const [handleX, handleY] of [[x, y], [x + width, y], [x, y + height], [x + width, y + height]]) {
    context.fillRect(handleX - handle, handleY - handle, handle * 2, handle * 2);
  }
  context.restore();
}

function capturePoint(event) {
  const canvas = $("capture-canvas");
  const bounds = canvas.getBoundingClientRect();
  return {
    x: Math.max(0, Math.min(canvas.width, (event.clientX - bounds.left) * canvas.width / bounds.width)),
    y: Math.max(0, Math.min(canvas.height, (event.clientY - bounds.top) * canvas.height / bounds.height)),
  };
}

function startCaptureSelection(event) {
  captureStart = capturePoint(event);
  captureRect = { x: captureStart.x, y: captureStart.y, width: 0, height: 0 };
  captureDragging = true;
  event.currentTarget.setPointerCapture(event.pointerId);
  drawCaptureEditor();
}

function moveCaptureSelection(event) {
  if (!captureDragging || !captureStart) return;
  const current = capturePoint(event);
  captureRect = {
    x: Math.min(captureStart.x, current.x),
    y: Math.min(captureStart.y, current.y),
    width: Math.abs(current.x - captureStart.x),
    height: Math.abs(current.y - captureStart.y),
  };
  drawCaptureEditor();
}

function finishCaptureSelection() {
  if (!captureDragging) return;
  captureDragging = false;
  captureStart = null;
  if (!captureRect || captureRect.width < 24 || captureRect.height < 24) {
    $("capture-editor-status").textContent = `That selection is too small. Drag a larger box around the ${captureLabels().subject}.`;
    $("capture-editor-status").classList.add("err");
    return;
  }
  $("capture-editor-status").textContent = captureLabels().ready;
  $("capture-editor-status").classList.remove("err");
}

function closeCaptureEditor() {
  hide("capture-editor");
  captureImage = null;
  captureRect = null;
  captureStart = null;
  captureDragging = false;
  captureOriginalDataUrl = null;
}

function openCaptureEditor(dataUrl, pageUrl, { rememberOriginal = true, zoomed = false } = {}) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => {
      if (rememberOriginal) captureOriginalDataUrl = dataUrl;
      captureImage = image;
      capturePageUrl = pageUrl;
      const labels = captureLabels();
      $("capture-editor-title").textContent = labels.title;
      $("capture-editor-help").textContent = labels.help;
      const canvas = $("capture-canvas");
      const scale = Math.min(350 / image.naturalWidth, 398 / image.naturalHeight, 1);
      canvas.width = Math.max(1, image.naturalWidth);
      canvas.height = Math.max(1, image.naturalHeight);
      canvas.style.width = `${Math.max(1, Math.round(image.naturalWidth * scale))}px`;
      canvas.style.height = `${Math.max(1, Math.round(image.naturalHeight * scale))}px`;
      const landscape = canvas.width / canvas.height > 1.25;
      captureRect = landscape
        ? { x: canvas.width * 0.2, y: canvas.height * 0.04, width: canvas.width * 0.6, height: canvas.height * 0.92 }
        : { x: canvas.width * 0.04, y: canvas.height * 0.04, width: canvas.width * 0.92, height: canvas.height * 0.92 };
      $("capture-editor-status").textContent = zoomed
        ? "Zoomed in at full quality. Refine the box or analyze this selection."
        : "";
      $("capture-editor-status").classList.remove("err");
      $("capture-reset").classList.toggle("hidden", !zoomed);
      show("capture-editor");
      drawCaptureEditor();
      resolve();
    };
    image.onerror = () => reject(new Error("Couldn't prepare the screenshot"));
    image.src = dataUrl;
  });
}

function captureSourceRect() {
  const display = $("capture-canvas");
  return {
    x: Math.round(captureRect.x * captureImage.naturalWidth / display.width),
    y: Math.round(captureRect.y * captureImage.naturalHeight / display.height),
    width: Math.round(captureRect.width * captureImage.naturalWidth / display.width),
    height: Math.round(captureRect.height * captureImage.naturalHeight / display.height),
  };
}

async function zoomCaptureSelection() {
  if (!captureImage || !captureRect || captureRect.width < 24 || captureRect.height < 24) {
    $("capture-editor-status").textContent = `Drag a larger box around the ${captureLabels().subject} before zooming.`;
    $("capture-editor-status").classList.add("err");
    return;
  }
  const source = captureSourceRect();
  const zoomed = document.createElement("canvas");
  zoomed.width = source.width;
  zoomed.height = source.height;
  zoomed.getContext("2d").drawImage(
    captureImage, source.x, source.y, source.width, source.height,
    0, 0, source.width, source.height,
  );
  await openCaptureEditor(zoomed.toDataURL("image/png"), capturePageUrl, { rememberOriginal: false, zoomed: true });
}

async function resetCaptureZoom() {
  if (!captureOriginalDataUrl) return;
  await openCaptureEditor(captureOriginalDataUrl, capturePageUrl, { rememberOriginal: false, zoomed: false });
}

async function analyzeCapturedSelection() {
  if (!captureImage || !captureRect || captureRect.width < 24 || captureRect.height < 24) {
    $("capture-editor-status").textContent = `Drag a box around the ${captureLabels().subject} first.`;
    $("capture-editor-status").classList.add("err");
    return;
  }
  const button = $("capture-analyze");
  const labels = captureLabels();
  button.disabled = true;
  button.textContent = "Reading flyer…";
  $("capture-editor-status").textContent = labels.reading;
  $("capture-editor-status").classList.remove("err");
  try {
    const source = captureSourceRect();
    const sourceX = source.x;
    const sourceY = source.y;
    const sourceWidth = source.width;
    const sourceHeight = source.height;
    const resize = Math.min(1, 3200 / Math.max(sourceWidth, sourceHeight));
    const cropped = document.createElement("canvas");
    cropped.width = Math.max(1, Math.round(sourceWidth * resize));
    cropped.height = Math.max(1, Math.round(sourceHeight * resize));
    cropped.getContext("2d").drawImage(
      captureImage, sourceX, sourceY, sourceWidth, sourceHeight,
      0, 0, cropped.width, cropped.height,
    );
    const screenshot = await new Promise((resolve, reject) => cropped.toBlob(
      (blob) => blob ? resolve(blob) : reject(new Error("Couldn't crop the screenshot")), "image/png"
    ));
    const payload = new FormData();
    payload.append("image", screenshot, "flyer-selection.png");
    payload.append("timezone", currentUserTimezone);
    if (capturePageUrl && /^https?:\/\//i.test(capturePageUrl)) payload.append("source_url", capturePageUrl);
    capturedFlyerBlob = screenshot;
    const result = await api("/events/extract-flyer", { method: "POST", body: payload });
    const sourceUrl = capturePageUrl;
    closeCaptureEditor();
    setTopTab("events");
    fillEventFromFlyer(result, sourceUrl);
    toast("Event draft filled");
  } catch (failure) {
    $("capture-editor-status").textContent = failure.message || `Couldn't read that selection. Try a tighter box around the ${labels.subject}.`;
    $("capture-editor-status").classList.add("err");
  } finally {
    button.disabled = false;
    button.textContent = "Analyze selection";
  }
}

async function captureEventFromPage() {
  const button = $("capture-event-btn");
  button.disabled = true;
  button.textContent = "Preparing…";
  hide("event-capture-result");
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab) throw new Error("No active tab");
    const dataUrl = await chrome.tabs.captureVisibleTab(tab.windowId, { format: "png" });
    await openCaptureEditor(dataUrl, tab.url);
  } catch (failure) {
    const note = $("event-capture-result");
    note.textContent = failure.message || "Couldn't read this page. Try uploading a cropped screenshot in the calendar.";
    note.classList.add("warn");
    show("event-capture-result");
    toast("Couldn't read the flyer", true);
  } finally {
    button.disabled = false;
    button.textContent = "▣ Capture flyer";
  }
}

// ---- Add form ----
function resetForm() {
  $("f-company").value = "";
  $("f-title").value = "";
  $("f-applied").value = localDate();
  $("f-status").value = "Applied";
  $("f-domain").value = "";
  $("f-start").value = "";
  $("f-tbd").checked = false;
  $("f-pay").value = "";
  $("f-period").value = "yearly";
  $("f-conf").value = "";
  $("f-follow").value = "";
  $("f-interview").value = "";
  $("f-desc").value = "";
  capturedApplicationSourceUrl = null;
  capturedApplicationPageText = null;
  capturedApplicationStructuredFields = null;
  hide("application-capture-result");
}

function setMode(mode, persist = true) {
  const adv = mode === "advanced";
  $("adv").classList.toggle("hidden", !adv);
  $("mode-simple").classList.toggle("active", !adv);
  $("mode-advanced").classList.toggle("active", adv);
  if (persist) void saveApplicationDraft();
}

async function save() {
  const company = $("f-company").value.trim();
  const title = $("f-title").value.trim();
  const applied = $("f-applied").value;
  if (!company || !title || !applied) { toast("Company, role and date are required", true); return; }

  const tbd = $("f-tbd").checked;
  const pay = $("f-pay").value;
  const interview = $("f-interview").value; // yyyy-MM-ddTHH:mm

  const payload = {
    company_name: company,
    job_title: title,
    day_applied: applied,
    status: $("f-status").value,
    company_domain: $("f-domain").value.trim() || null,
    expected_start_date: (!tbd && $("f-start").value) || null,
    start_date_tbd: tbd,
    start_date_month_only: false,
    pay_amount: pay ? Number(pay) : null,
    pay_period: pay ? $("f-period").value : null,
    confidence_level: $("f-conf").value || null,
    follow_up_date: $("f-follow").value || null,
    interview_date: interview ? `${interview}:00` : null,
    description: $("f-desc").value.trim() || null,
  };

  const btn = $("save-btn");
  btn.disabled = true;
  btn.textContent = "Adding…";
  try {
    await api("/applications", { method: "POST", body: JSON.stringify(payload) });
    toast(`Added ${title} @ ${company}`);
    await clearApplicationDraft();
    resetForm();
    await Promise.all([loadStats(), loadList()]);
  } catch (e) {
    toast(e.status === 401 ? "Please sign in again" : "Failed to add application", true);
    if (e.status === 401) { hide("main"); show("auth-gate"); }
  } finally {
    btn.disabled = false;
    btn.textContent = "Add";
  }
}

function extractJobPostingFromPage() {
  const clean = (value, limit = 30000) => String(value || "").replace(/\s+/g, " ").trim().slice(0, limit);
  const textFromHtml = (value) => {
    const container = document.createElement("div");
    container.innerHTML = String(value || "");
    return clean(container.textContent || "", 12000);
  };
  const firstText = (selectors) => {
    for (const selector of selectors) {
      const element = document.querySelector(selector);
      const value = clean(element?.innerText || element?.textContent || "", 12000);
      if (value) return value;
    }
    return "";
  };
  const findPosting = (value) => {
    if (!value || typeof value !== "object") return null;
    if (Array.isArray(value)) {
      for (const item of value) {
        const found = findPosting(item);
        if (found) return found;
      }
      return null;
    }
    const types = Array.isArray(value["@type"]) ? value["@type"] : [value["@type"]];
    if (types.some((type) => String(type || "").toLowerCase() === "jobposting")) return value;
    if (value["@graph"]) return findPosting(value["@graph"]);
    return null;
  };

  let posting = null;
  for (const script of document.querySelectorAll('script[type="application/ld+json"]')) {
    try {
      posting = findPosting(JSON.parse(script.textContent || ""));
      if (posting) break;
    } catch { /* Ignore malformed publisher JSON-LD. */ }
  }

  const organization = posting?.hiringOrganization || {};
  const companyName = clean(
    organization.name || firstText([
      "[data-automation-id='jobPostingCompany']",
      ".job-details-jobs-unified-top-card__company-name",
      ".topcard__org-name-link",
      "[class*='companyName']",
      "[class*='company-name']",
    ]),
    160,
  );
  const jobTitle = clean(
    posting?.title || firstText([
      "[data-automation-id='jobPostingHeader']",
      ".job-details-jobs-unified-top-card__job-title",
      ".top-card-layout__title",
      "[class*='jobTitle']",
      "[class*='job-title']",
      "main h1",
      "h1",
    ]),
    160,
  );
  const structuredDescription = textFromHtml(posting?.description || "");
  const visibleDescription = firstText([
    "[data-automation-id='jobPostingDescription']",
    ".jobs-description__content",
    "#jobDescriptionText",
    "[class*='jobDescription']",
    "[class*='job-description']",
    "article",
    "main",
  ]);
  const description = clean(structuredDescription || visibleDescription, 5000);

  let companyDomain = "";
  const organizationUrl = Array.isArray(organization.sameAs)
    ? organization.sameAs[0]
    : organization.sameAs || organization.url;
  if (organizationUrl) {
    try { companyDomain = new URL(organizationUrl, location.href).hostname.replace(/^www\./, ""); } catch { /* ignore */ }
  }

  const salary = posting?.baseSalary || {};
  const salaryValue = salary.value ?? salary;
  const salaryDetails = salaryValue && typeof salaryValue === "object" ? salaryValue : {};
  const unit = clean(salary.unitText || salaryDetails.unitText || "", 20).toLowerCase();
  const minimum = Number(salaryDetails.minValue);
  const maximum = Number(salaryDetails.maxValue);
  const rawPayAmount = typeof salaryValue === "number" || typeof salaryValue === "string"
    ? salaryValue
    : salaryDetails.value;
  let payAmount = rawPayAmount === null || rawPayAmount === undefined || rawPayAmount === ""
    ? Number.NaN
    : Number(rawPayAmount);
  if (!Number.isFinite(payAmount) && Number.isFinite(minimum) && minimum === maximum) payAmount = minimum;
  const payPeriod = /hour|hr/.test(unit) ? "hourly" : /month|mo/.test(unit) ? "monthly" : /year|yr|annual/.test(unit) ? "yearly" : null;
  if (!Number.isFinite(payAmount) || !payPeriod) payAmount = null;

  const expectedStart = clean(posting?.jobStartDate || posting?.startDate || "", 20);
  const expectedStartDate = /^\d{4}-\d{2}-\d{2}$/.test(expectedStart) ? expectedStart : null;
  const mainText = firstText(["main", "article", "body"]);
  const pageText = [
    document.title,
    companyName,
    jobTitle,
    description,
    mainText,
  ].filter(Boolean).join("\n\n").slice(0, 30000);

  return {
    sourceUrl: location.href,
    pageText,
    structuredFields: {
      company_name: companyName || null,
      job_title: jobTitle || null,
      company_domain: companyDomain || null,
      expected_start_date: expectedStartDate,
      start_date_tbd: false,
      pay_amount: payAmount,
      pay_period: payAmount === null ? null : payPeriod,
      description: description || null,
    },
  };
}

async function captureApplicationPage(useAi = false) {
  const button = $(useAi ? "capture-job-ai-btn" : "capture-job-btn");
  const idleLabel = useAi ? "✦ Capture with AI" : "⌁ Capture job";
  button.disabled = true;
  button.textContent = useAi ? "Improving…" : "Reading…";
  hide("application-capture-result");
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id) throw new Error("No active webpage");
    const executions = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: extractJobPostingFromPage,
    });
    const extracted = executions?.[0]?.result;
    if (!extracted?.pageText || extracted.pageText.trim().length < 10) {
      throw new Error("This page did not expose enough readable job information");
    }
    capturedApplicationPageText = extracted.pageText;
    capturedApplicationStructuredFields = extracted.structuredFields || {};
    capturedApplicationSourceUrl = extracted.sourceUrl || tab.url || null;
    const result = await api(useAi ? "/applications/improve-page" : "/applications/extract-page", {
      method: "POST",
      body: JSON.stringify({
        source_url: capturedApplicationSourceUrl,
        page_text: capturedApplicationPageText,
        structured_fields: capturedApplicationStructuredFields,
        timezone: currentUserTimezone,
      }),
    });
    fillApplicationFromPosting(result, capturedApplicationSourceUrl);
    toast(useAi ? "Application draft filled with AI" : "Application draft filled from page");
  } catch (failure) {
    const note = $("application-capture-result");
    note.textContent = failure.message || "Couldn't read enough job information from this webpage.";
    note.classList.add("warn");
    show("application-capture-result");
    toast(useAi ? "AI couldn't read the job page" : "Couldn't read the job page", true);
  } finally {
    button.disabled = false;
    button.textContent = idleLabel;
  }
}

// ---- Wire up ----
document.addEventListener("DOMContentLoaded", () => {
  for (const selectId of ["e-time", "e-end-time"]) {
    const select = $(selectId);
    for (let index = 0; index < 96; index++) {
      const hour24 = Math.floor(index / 4);
      const minute = (index % 4) * 15;
      const value = `${String(hour24).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
      const option = document.createElement("option");
      option.value = value;
      option.textContent = `${hour24 % 12 || 12}:${String(minute).padStart(2, "0")} ${hour24 < 12 ? "AM" : "PM"}`;
      select.appendChild(option);
    }
  }
  resetForm();
  resetEventForm();
  $("open-settings").addEventListener("click", () => chrome.tabs.create({ url: `${API_BASE}/settings` }));
  $("open-dashboard").addEventListener("click", () => chrome.tabs.create({ url: `${API_BASE}/dashboard` }));
  $("view-all").addEventListener("click", () => chrome.tabs.create({ url: `${API_BASE}/applications` }));
  $("open-calendar").addEventListener("click", () => chrome.tabs.create({ url: `${API_BASE}/calendar` }));
  $("tab-applications").addEventListener("click", () => setTopTab("applications"));
  $("tab-events").addEventListener("click", () => setTopTab("events"));
  $("event-view-week").addEventListener("click", () => setEventView("week"));
  $("event-view-list").addEventListener("click", () => setEventView("list"));
  $("week-prev").addEventListener("click", () => {
    visibleWeekStart = addCalendarDays(visibleWeekStart, -7);
    void loadWeekEvents("previous");
  });
  $("week-next").addEventListener("click", () => {
    visibleWeekStart = addCalendarDays(visibleWeekStart, 7);
    void loadWeekEvents("next");
  });
  $("week-today").addEventListener("click", () => {
    const currentWeek = startOfWeekMonday(new Date());
    const direction = currentWeek < visibleWeekStart ? "previous" : "next";
    visibleWeekStart = currentWeek;
    void loadWeekEvents(direction);
  });
  $("event-advanced-toggle").addEventListener("click", () => {
    $("event-advanced").classList.toggle("hidden");
    $("event-advanced-toggle").textContent = $("event-advanced").classList.contains("hidden") ? "More details" : "Fewer details";
    void saveEventDraft();
  });
  $("e-all-day").addEventListener("change", (event) => {
    $("e-time").disabled = event.target.checked;
    $("e-end-time").disabled = event.target.checked;
  });
  EVENT_DRAFT_FIELDS.forEach((id) => {
    const field = $(id);
    const eventName = field.matches("input[type='text'], textarea") ? "input" : "change";
    field.addEventListener(eventName, () => void saveEventDraft());
  });
  $("event-save-btn").addEventListener("click", saveEvent);
  $("capture-event-btn").addEventListener("click", captureEventFromPage);
  $("capture-cancel").addEventListener("click", closeCaptureEditor);
  $("capture-cancel-x").addEventListener("click", closeCaptureEditor);
  $("capture-analyze").addEventListener("click", analyzeCapturedSelection);
  $("capture-zoom").addEventListener("click", zoomCaptureSelection);
  $("capture-reset").addEventListener("click", resetCaptureZoom);
  $("improve-event-ai").addEventListener("click", improveEventWithAi);
  $("capture-canvas").addEventListener("pointerdown", startCaptureSelection);
  $("capture-canvas").addEventListener("pointermove", moveCaptureSelection);
  $("capture-canvas").addEventListener("pointerup", finishCaptureSelection);
  $("capture-canvas").addEventListener("pointercancel", finishCaptureSelection);
  document.addEventListener("keydown", (event) => { if (event.key === "Escape" && !$("capture-editor").classList.contains("hidden")) closeCaptureEditor(); });
  $("signin-btn").addEventListener("click", () => chrome.tabs.create({ url: `${API_BASE}/login` }));
  $("retry-btn").addEventListener("click", init);
  $("extension-login-form").addEventListener("submit", extensionLogin);
  $("mode-simple").addEventListener("click", () => setMode("simple"));
  $("mode-advanced").addEventListener("click", () => setMode("advanced"));
  APPLICATION_DRAFT_FIELDS.forEach((id) => {
    const field = $(id);
    const eventName = field.matches("input[type='text'], input[type='number'], textarea") ? "input" : "change";
    field.addEventListener(eventName, () => void saveApplicationDraft());
  });
  $("save-btn").addEventListener("click", save);
  $("capture-job-btn").addEventListener("click", () => captureApplicationPage(false));
  $("capture-job-ai-btn").addEventListener("click", () => captureApplicationPage(true));
  $("f-tbd").addEventListener("change", (e) => {
    $("f-start").disabled = e.target.checked;
    void saveApplicationDraft();
  });
  init();
});
