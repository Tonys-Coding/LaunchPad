import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import {
  addMonths, eachDayOfInterval, endOfMonth, endOfWeek, format,
  isSameDay, isSameMonth, startOfMonth, startOfWeek, subMonths,
} from "date-fns";
import {
  ArrowLeft, ArrowRight, CalendarDays, CheckCircle2, CircleAlert,
  Building2, ExternalLink, Link2, Loader2, MapPin, Plus, ScanLine, Trash2,
} from "lucide-react";
import { toast } from "sonner";
import { Layout } from "@/components/Layout";
import { EventForm } from "@/components/EventForm";
import { ApplicationForm } from "@/components/ApplicationForm";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import api, { formatApiErrorDetail } from "@/lib/api";
import { CATEGORY_STYLES, EVENT_CATEGORIES, EventIcon, itemStart, itemTimeLabel } from "@/lib/calendar";

const dayKey = (date) => format(date, "yyyy-MM-dd");

function itemOnDay(item, day) {
  if (item.all_day) return dayKey(day) >= item.start_date && dayKey(day) <= (item.end_date || item.start_date);
  return isSameDay(itemStart(item), day);
}

function SyncBadge({ status }) {
  if (status === "synced") return <span className="inline-flex items-center gap-1 text-xs text-emerald-500"><CheckCircle2 size={13} /> Synced</span>;
  if (status === "error") return <span className="inline-flex items-center gap-1 text-xs text-danger"><CircleAlert size={13} /> Sync failed</span>;
  if (status === "pending") return <span className="inline-flex items-center gap-1 text-xs text-on-surface-variant"><Loader2 size={13} className="animate-spin" /> Syncing</span>;
  return null;
}

export default function CalendarPage() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const [month, setMonth] = useState(startOfMonth(new Date()));
  const [selectedDay, setSelectedDay] = useState(new Date());
  const [items, setItems] = useState([]);
  const [integration, setIntegration] = useState({ configured: false, connected: false });
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [formOpen, setFormOpen] = useState(false);
  const [captureOnOpen, setCaptureOnOpen] = useState(false);
  const [appFormOpen, setAppFormOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [detail, setDetail] = useState(null);
  const [filters, setFilters] = useState(new Set(EVENT_CATEGORIES));

  const gridStart = startOfWeek(startOfMonth(month), { weekStartsOn: 0 });
  const gridEnd = endOfWeek(endOfMonth(month), { weekStartsOn: 0 });
  const days = eachDayOfInterval({ start: gridStart, end: gridEnd });

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError("");
    try {
      const exclusiveEnd = new Date(gridEnd);
      exclusiveEnd.setDate(exclusiveEnd.getDate() + 1);
      const [feedResult, googleResult] = await Promise.allSettled([
        api.get("/calendar/items", { params: { from: gridStart.toISOString(), to: exclusiveEnd.toISOString() } }),
        api.get("/integrations/google-calendar"),
      ]);
      if (feedResult.status === "rejected") throw feedResult.reason;
      setItems(feedResult.value.data);
      if (googleResult.status === "fulfilled") setIntegration(googleResult.value.data);
      else setIntegration({ configured: false, connected: false });
    } catch (failure) {
      const message = formatApiErrorDetail(failure.response?.data?.detail || "Calendar could not be loaded.");
      setLoadError(message);
      toast.error(message);
    } finally {
      setLoading(false);
    }
  }, [gridStart.getTime(), gridEnd.getTime()]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    if (searchParams.get("calendar_connected")) toast.success("Google Calendar connected");
    if (searchParams.get("calendar_error")) toast.error("Google Calendar could not be connected. Please try again.");
    if (searchParams.has("calendar_connected") || searchParams.has("calendar_error")) setSearchParams({}, { replace: true });
  }, [searchParams, setSearchParams]);

  const visibleItems = useMemo(() => items.filter((item) => filters.has(item.category)), [items, filters]);
  const agenda = visibleItems.filter((item) => itemOnDay(item, selectedDay)).sort((a, b) => itemStart(a) - itemStart(b));

  const submitEvent = async (payload) => {
    if (editing) await api.put(`/events/${editing.event_id}`, payload);
    else await api.post("/events", payload);
    toast.success(editing ? "Event updated" : "Event added");
    setEditing(null);
    await load();
  };

  const removeEvent = async () => {
    await api.delete(`/events/${detail.event_id}`);
    toast.success("Event deleted");
    setDetail(null);
    await load();
  };

  const retrySync = async () => {
    await api.post(`/events/${detail.event_id}/google-sync`, { enabled: true });
    toast.success("Google sync retried");
    setDetail(null);
    await load();
  };

  const syncApplication = async (item, enabled = true) => {
    const kind = item.source === "application_interview" ? "interview" : "follow_up";
    await api.post(`/applications/${item.application_id}/google-calendar`, { kind, enabled });
    toast.success(enabled ? "Added to Google Calendar" : "Removed from Google Calendar");
    setDetail(null);
    await load();
  };

  const toggleFilter = (category) => setFilters((current) => {
    const next = new Set(current);
    if (next.has(category)) next.delete(category); else next.add(category);
    return next;
  });

  const openNew = (day = selectedDay, withFlyer = false) => {
    setSelectedDay(day);
    setEditing(null);
    setCaptureOnOpen(withFlyer);
    setFormOpen(true);
  };

  return (
    <Layout title="Calendar" onAddApplication={() => setAppFormOpen(true)} wide>
      <div className="flex flex-col xl:flex-row gap-5">
        <section className="lp-panel lp-chamfer-tr min-w-0 flex-1 overflow-hidden">
          <div className="p-4 sm:p-5 border-b border-outline-variant flex flex-col gap-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <button aria-label="Previous month" onClick={() => setMonth(subMonths(month, 1))} className="lp-chamfer-chip border border-outline-variant p-2 hover:bg-surface-mid"><ArrowLeft size={18} /></button>
                <button onClick={() => { setMonth(startOfMonth(new Date())); setSelectedDay(new Date()); }} className="lp-chamfer-chip border border-outline-variant px-3 py-2 text-sm hover:bg-surface-mid">Today</button>
                <button aria-label="Next month" onClick={() => setMonth(addMonths(month, 1))} className="lp-chamfer-chip border border-outline-variant p-2 hover:bg-surface-mid"><ArrowRight size={18} /></button>
                <h2 className="font-heading text-xl sm:text-2xl font-semibold ml-1">{format(month, "MMMM yyyy")}</h2>
              </div>
              <div className="flex items-center gap-2">
                <button aria-label="Scan an event flyer" onClick={() => openNew(selectedDay, true)} className="lp-chamfer-button flex items-center gap-2 border border-outline-variant px-3 py-2.5 text-sm font-semibold hover:bg-surface-mid"><ScanLine size={17} /> <span className="hidden sm:inline">Scan flyer</span></button>
                <button data-testid="calendar-add-event" onClick={() => openNew()} className="lp-chamfer-button flex items-center gap-2 bg-brand px-4 py-2.5 text-sm font-semibold text-on-brand"><Plus size={17} /> Add event</button>
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              {EVENT_CATEGORIES.map((category) => (
                <button key={category} aria-pressed={filters.has(category)} onClick={() => toggleFilter(category)} className={`lp-chamfer-chip border px-2.5 py-1.5 text-xs transition-opacity ${CATEGORY_STYLES[category]} ${filters.has(category) ? "opacity-100" : "opacity-35"}`}>{category}</button>
              ))}
            </div>
          </div>
          <div className="grid grid-cols-7 border-b border-outline-variant bg-surface-mid/50">
            {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((label) => <div key={label} className="text-[10px] sm:text-xs uppercase tracking-wider text-on-surface-variant text-center py-2">{label}</div>)}
          </div>
          {loading ? (
            <div className="flex h-[540px] items-center justify-center" role="status"><Loader2 className="animate-spin text-on-surface-variant" /><span className="sr-only">Loading calendar</span></div>
          ) : loadError ? (
            <div className="flex h-[540px] flex-col items-center justify-center px-5 text-center" role="alert" data-testid="calendar-load-error">
              <CircleAlert size={28} className="mb-3 text-danger" />
              <p className="max-w-md text-sm text-danger">{loadError}</p>
              <button type="button" onClick={load} className="lp-chamfer-button mt-4 border border-outline-variant px-4 py-2 text-sm font-semibold hover:bg-surface-high">Try again</button>
            </div>
          ) : (
            <div className="grid grid-cols-7" role="grid" aria-label={format(month, "MMMM yyyy")} data-testid="month-grid">
              {days.map((day) => {
                const dayItems = visibleItems.filter((item) => itemOnDay(item, day));
                const selected = isSameDay(day, selectedDay);
                const today = isSameDay(day, new Date());
                return (
                  <div
                    key={day.toISOString()}
                    role="gridcell"
                    tabIndex={0}
                    aria-label={`Select ${format(day, "MMMM d, yyyy")}`}
                    aria-selected={selected}
                    onClick={() => setSelectedDay(day)}
                    onKeyDown={(event) => {
                      if (event.target === event.currentTarget && (event.key === "Enter" || event.key === " ")) {
                        event.preventDefault();
                        setSelectedDay(day);
                      }
                    }}
                    className={`min-h-[92px] cursor-pointer border-b border-r border-outline-variant p-1.5 text-left transition-colors hover:bg-surface-mid/50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand focus-visible:outline-offset-[-2px] sm:min-h-[118px] sm:p-2 ${!isSameMonth(day, month) ? "opacity-35" : ""} ${selected ? "bg-surface-mid/70" : ""}`}
                  >
                    <span className={`lp-chamfer-chip inline-flex h-7 w-7 items-center justify-center text-xs sm:text-sm ${today ? "bg-brand font-bold text-on-brand shadow-[0_0_14px_rgb(var(--brand)/0.22)]" : ""}`}>{format(day, "d")}</span>
                    <div className="space-y-1 mt-1">
                      {dayItems.slice(0, 3).map((item) => {
                        return <button type="button" key={item.id} onClick={(event) => { event.stopPropagation(); setSelectedDay(day); setDetail(item); }} aria-label={`Open ${item.title}`} className={`flex w-full items-center gap-1 truncate rounded border px-1.5 py-1 text-left text-[10px] focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand sm:text-xs ${CATEGORY_STYLES[item.category] || CATEGORY_STYLES.Other}`}><EventIcon item={item} size={13} className="shrink-0" /><span className="truncate">{item.title}</span></button>;
                      })}
                      {dayItems.length > 3 && <span className="block text-[10px] text-on-surface-variant pl-1">+{dayItems.length - 3} more</span>}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </section>

        <aside className="xl:w-80 space-y-5">
          {integration.configured && (
            <div className="lp-panel lp-chamfer-tr lp-crosshair p-4">
              <div className="flex items-start justify-between gap-3">
                <div><p className="font-semibold flex items-center gap-2"><Link2 size={17} /> Google Calendar</p><p className={`mt-1 text-xs ${integration.requires_reauthorization ? "text-danger" : "text-on-surface-variant"}`}>{integration.requires_reauthorization ? "Reconnect required" : integration.connected ? `Connected as ${integration.email}` : "Not connected"}</p></div>
                <span className={`w-2.5 h-2.5 rounded-full mt-1.5 ${integration.connected ? "bg-emerald-500" : "bg-outline"}`} />
              </div>
              <Link to="/settings" className="lp-chamfer-button mt-3 flex w-full items-center justify-center gap-2 border border-outline-variant py-2 text-sm font-semibold hover:bg-surface-mid">Manage in Settings <ArrowRight size={14} /></Link>
            </div>
          )}
          <div className="lp-panel lp-chamfer-dual lp-crosshair p-4">
            <div className="flex items-start justify-between gap-3">
              <div><p className="text-xs uppercase tracking-wider text-on-surface-variant">{format(selectedDay, "EEEE")}</p><h3 className="font-heading text-2xl font-semibold mt-1">{format(selectedDay, "MMMM d")}</h3></div>
              <button type="button" data-testid="calendar-day-add-event" aria-label={`Add event on ${format(selectedDay, "MMMM d, yyyy")}`} onClick={() => openNew(selectedDay)} className="lp-chamfer-chip flex h-10 w-10 shrink-0 items-center justify-center border border-outline-variant bg-brand text-on-brand transition-transform hover:-translate-y-0.5 focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand"><Plus size={19} /></button>
            </div>
            <div className="mt-4 space-y-2">
              {agenda.length === 0 ? <div className="text-sm text-on-surface-variant py-8 text-center"><CalendarDays className="mx-auto mb-2 opacity-50" />Nothing scheduled for this day.</div> : agenda.map((item) => {
                return <button key={item.id} onClick={() => setDetail(item)} className="lp-surface-hover lp-chamfer-sm w-full border border-outline-variant bg-surface-mid p-3 text-left transition-colors hover:bg-surface-high"><div className="flex items-start gap-2"><span className={`lp-chamfer-chip border p-1.5 ${CATEGORY_STYLES[item.category] || CATEGORY_STYLES.Other}`}><EventIcon item={item} size={18} /></span><div className="min-w-0"><p className="truncate text-sm font-medium">{item.title}</p><p className="mt-0.5 text-xs text-on-surface-variant">{itemTimeLabel(item)}{item.subtitle ? ` · ${item.subtitle}` : ""}</p></div></div></button>;
              })}
            </div>
          </div>
        </aside>
      </div>

      <EventForm open={formOpen} onOpenChange={(open) => { setFormOpen(open); if (!open) { setEditing(null); setCaptureOnOpen(false); } }} onSubmit={submitEvent} initial={editing} selectedDate={selectedDay} googleConnected={integration.connected} captureOnOpen={captureOnOpen} />
      <ApplicationForm open={appFormOpen} onOpenChange={setAppFormOpen} onSubmit={async (payload) => { await api.post("/applications", payload); }} />

      <Dialog open={!!detail} onOpenChange={(open) => !open && setDetail(null)}>
        {detail && <DialogContent className="bg-surface-mid border-outline-variant text-on-surface max-w-lg">
          <DialogHeader><DialogTitle className="font-heading text-2xl flex items-center gap-3"><EventIcon item={detail} size={30} />{detail.title}</DialogTitle></DialogHeader>
          <div className="space-y-3 text-sm">
            <div className="flex items-center justify-between"><span className={`px-2.5 py-1 rounded-full border text-xs ${CATEGORY_STYLES[detail.category] || CATEGORY_STYLES.Other}`}>{detail.category}</span><SyncBadge status={detail.google_sync_status} /></div>
            <p>{detail.all_day ? `${detail.start_date}${detail.end_date !== detail.start_date ? ` – ${detail.end_date}` : ""} · All day` : `${itemStart(detail).toLocaleDateString([], { weekday: "long", month: "long", day: "numeric" })} · ${itemTimeLabel(detail)}`}</p>
            {detail.organizer && <p className="flex items-start gap-2 text-on-surface-variant"><Building2 size={16} className="mt-0.5" /> Organized by {detail.organizer}</p>}
            {detail.location && <p className="flex items-start gap-2 text-on-surface-variant"><MapPin size={16} className="mt-0.5" /> {detail.location}</p>}
            {detail.description && <p className="text-on-surface-variant whitespace-pre-wrap">{detail.description}</p>}
            {detail.source_url && <a href={detail.source_url} target="_blank" rel="noreferrer" className="text-sm underline flex items-center gap-1">Open original event page <ExternalLink size={13} /></a>}
            {detail.google_html_link && <a href={detail.google_html_link} target="_blank" rel="noreferrer" className="text-sm underline flex items-center gap-1">Open in Google Calendar <ExternalLink size={13} /></a>}
          </div>
          <div className="flex flex-wrap justify-end gap-2 border-t border-outline-variant pt-4">
            {detail.source === "event" ? <>
              {detail.google_sync_status === "error" && integration.connected && <button onClick={retrySync} className="px-3 py-2 rounded-lg border border-outline-variant text-sm">Retry sync</button>}
              <button onClick={removeEvent} className="px-3 py-2 rounded-lg border border-danger/30 text-danger text-sm flex items-center gap-1"><Trash2 size={14} /> Delete</button>
              <button onClick={() => { setEditing(detail); setDetail(null); setFormOpen(true); }} className="px-4 py-2 rounded-lg bg-brand text-on-brand text-sm font-semibold">Edit</button>
            </> : <>
              <button onClick={() => navigate(`/applications?open=${detail.application_id}`)} className="px-3 py-2 rounded-lg border border-outline-variant text-sm">Open application</button>
              {integration.connected && (detail.google_sync_status === "synced" ? <button onClick={() => syncApplication(detail, false)} className="px-3 py-2 rounded-lg border border-outline-variant text-sm">Remove from Google</button> : <button onClick={() => syncApplication(detail, true)} className="px-4 py-2 rounded-lg bg-brand text-on-brand text-sm font-semibold">Add to Google Calendar</button>)}
            </>}
          </div>
        </DialogContent>}
      </Dialog>
    </Layout>
  );
}
