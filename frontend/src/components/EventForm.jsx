import { useEffect, useState } from "react";
import { Info, Loader2, X } from "lucide-react";
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { FlyerCapture } from "@/components/FlyerCapture";
import { EVENT_CATEGORIES, EVENT_ICONS, REMINDERS, iconifyImageUrl } from "@/lib/calendar";
import { formatApiErrorDetail } from "@/lib/api";
import { useAuth } from "@/context/AuthContext";

const pad = (n) => String(n).padStart(2, "0");
const localDate = (value = new Date()) => `${value.getFullYear()}-${pad(value.getMonth() + 1)}-${pad(value.getDate())}`;
const PICTURE_THEMES = {
  Popular: ["spiral-calendar", "graduation-cap", "laptop", "briefcase", "alarm-clock", "books", "bullseye", "office-building"],
  Academic: ["graduation-cap", "school", "books", "open-book", "notebook", "memo", "student", "teacher"],
  Work: ["briefcase", "office-building", "laptop", "desktop-computer", "office-worker", "chart-increasing", "handshake", "telephone"],
  Interview: ["handshake", "office-worker", "briefcase", "left-speech-bubble", "identification-card", "microphone", "bullseye", "telephone"],
  Deadline: ["alarm-clock", "hourglass-not-done", "tear-off-calendar", "spiral-calendar", "memo", "warning", "check-mark-button", "hourglass-done"],
  Meeting: ["handshake", "left-speech-bubble", "telephone", "video-camera", "microphone", "office-building", "calendar", "memo"],
  Technology: ["laptop", "desktop-computer", "mobile-phone", "gear", "computer-mouse", "computer-disk", "video-camera", "rocket"],
  Personal: ["house", "heart-decoration", "sun", "bicycle", "books", "camera", "beach-with-umbrella", "sparkles"],
  Celebration: ["party-popper", "partying-face", "balloon", "trophy", "sports-medal", "sparkles", "glowing-star", "wrapped-gift"],
  Travel: ["airplane", "airplane-departure", "train", "high-speed-train", "compass", "beach-with-umbrella", "racing-car", "house"],
  Finance: ["money-bag", "dollar-banknote", "credit-card", "bank", "chart-increasing", "bar-chart", "money-with-wings", "briefcase"],
  Health: ["medical-symbol", "stethoscope", "hospital", "health-worker", "person-running", "bicycle", "anatomical-heart", "pill"],
};

const CATEGORY_PICTURE_THEME = {
  Academic: "Academic", Work: "Work", "Job Search": "Work", Interview: "Interview",
  "Career Fair": "Meeting", Deadline: "Deadline", Personal: "Personal", Other: "Popular",
};

const pictureIdentifier = (name) => `fluent-emoji-flat:${name}`;

const TIME_OPTIONS = Array.from({ length: 96 }, (_, index) => {
  const hour24 = Math.floor(index / 4);
  const minute = (index % 4) * 15;
  const value = `${pad(hour24)}:${pad(minute)}`;
  const hour12 = hour24 % 12 || 12;
  return [value, `${hour12}:${pad(minute)} ${hour24 < 12 ? "AM" : "PM"}`];
});

function zonedParts(iso, timezoneName) {
  if (!iso) return { date: "", time: "" };
  const values = Object.fromEntries(new Intl.DateTimeFormat("en-US", {
    timeZone: timezoneName, year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", hourCycle: "h23",
  }).formatToParts(new Date(iso)).filter((part) => part.type !== "literal").map((part) => [part.type, part.value]));
  return { date: `${values.year}-${values.month}-${values.day}`, time: `${values.hour}:${values.minute}` };
}

function initialForm(selectedDate, initial, googleConnected, preferredTimezone) {
  const chosen = selectedDate ? new Date(selectedDate) : new Date();
  chosen.setSeconds(0, 0);
  const timezoneName = initial?.timezone || preferredTimezone || Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  if (!initial) {
    const rounded = new Date(chosen);
    rounded.setMinutes(0, 0, 0);
    if (rounded <= new Date()) rounded.setHours(rounded.getHours() + 1);
    const end = new Date(rounded.getTime() + 3600000);
    return {
      title: "", category: "Other", all_day: false,
      timed_start_date: localDate(rounded), timed_end_date: localDate(end),
      start_time: `${pad(rounded.getHours())}:00`, end_time: `${pad(end.getHours())}:00`,
      start_date: localDate(chosen), end_date: localDate(chosen), timezone: timezoneName,
      organizer: "", location: "", description: "", source_url: "", icon: "calendar-check", image_icon: null,
      reminder_minutes: "", sync_to_google: googleConnected,
    };
  }
  const start = zonedParts(initial.starts_at, timezoneName);
  const end = zonedParts(initial.ends_at, timezoneName);
  return {
    title: initial.title || "", category: initial.category || "Other", all_day: !!initial.all_day,
    timed_start_date: start.date || localDate(chosen), timed_end_date: end.date || start.date || localDate(chosen),
    start_time: start.time || "09:00", end_time: end.time || "10:00",
    start_date: initial.start_date || localDate(chosen), end_date: initial.end_date || initial.start_date || localDate(chosen),
    timezone: timezoneName, organizer: initial.organizer || "", location: initial.location || "", description: initial.description || "", source_url: initial.source_url || "",
    icon: initial.icon || "calendar-check", image_icon: initial.image_icon || null,
    reminder_minutes: initial.reminder_minutes ?? "", sync_to_google: !!initial.sync_to_google,
  };
}

function TimeSelect({ value, onChange, className, testid }) {
  const hasValue = TIME_OPTIONS.some(([option]) => option === value);
  return <select data-testid={testid} className={className} value={value} onChange={(event) => onChange(event.target.value)}>{!hasValue && value && <option value={value}>{value}</option>}{TIME_OPTIONS.map(([option, label]) => <option key={option} value={option}>{label}</option>)}</select>;
}

export function EventForm({ open, onOpenChange, onSubmit, initial, selectedDate, googleConnected, captureOnOpen = false }) {
  const { user } = useAuth();
  const preferredTimezone = user?.preferences?.timezone;
  const [form, setForm] = useState(() => initialForm(selectedDate, initial, googleConnected, preferredTimezone));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [pictureTheme, setPictureTheme] = useState(CATEGORY_PICTURE_THEME[initial?.category] || "Popular");

  useEffect(() => {
    if (open) {
      setForm(initialForm(selectedDate, initial, googleConnected, preferredTimezone));
      setError("");
      setPictureTheme(CATEGORY_PICTURE_THEME[initial?.category] || "Popular");
    }
  }, [open, initial, selectedDate, googleConnected, preferredTimezone]);

  const themePictures = [...new Set([
    form.image_icon,
    ...PICTURE_THEMES[pictureTheme].map(pictureIdentifier),
  ].filter(Boolean))];
  const set = (key, value) => setForm((current) => ({ ...current, [key]: value }));
  const field = "w-full bg-surface-low border border-outline-variant rounded-lg px-3 py-2.5 text-sm text-on-surface focus:border-brand focus:ring-2 focus:ring-brand/30 outline-none";
  const label = "block text-xs font-label uppercase tracking-wider text-on-surface-variant mb-1.5";

  const applyFlyer = (fields) => {
    setForm((current) => {
      const next = { ...current };
      for (const key of ["title", "organizer", "category", "timezone", "location", "description", "source_url"]) {
        if (fields[key]) next[key] = fields[key];
      }
      if (typeof fields.all_day === "boolean") next.all_day = fields.all_day;
      if (fields.start_date) {
        next.start_date = fields.start_date;
        next.timed_start_date = fields.start_date;
      }
      if (fields.end_date) {
        next.end_date = fields.end_date;
        next.timed_end_date = fields.end_date;
      }
      if (fields.start_time) next.start_time = fields.start_time;
      if (fields.end_time) next.end_time = fields.end_time;
      return next;
    });
    if (fields.category) setPictureTheme(CATEGORY_PICTURE_THEME[fields.category] || "Popular");
  };

  const save = async () => {
    if (!form.title.trim()) return setError("Event name is required.");
    if (form.all_day && !form.start_date) return setError("Start date is required.");
    if (!form.all_day && !form.timed_start_date) return setError("Start date is required.");
    const startsAt = `${form.timed_start_date}T${form.start_time}:00`;
    const endsAt = `${form.timed_end_date || form.timed_start_date}T${form.end_time}:00`;
    if (!form.all_day && endsAt <= startsAt) return setError("End time must be after the start time.");
    setSaving(true);
    setError("");
    try {
      await onSubmit({
        title: form.title.trim(), category: form.category, all_day: form.all_day,
        starts_at: form.all_day ? null : startsAt, ends_at: form.all_day ? null : endsAt,
        start_date: form.all_day ? form.start_date : null, end_date: form.all_day ? (form.end_date || form.start_date) : null,
        timezone: form.timezone, organizer: form.organizer.trim() || null, location: form.location.trim() || null, description: form.description.trim() || null,
        source_url: form.source_url.trim() || null,
        icon: form.icon, image_icon: form.image_icon || null,
        reminder_minutes: form.reminder_minutes === "" ? null : Number(form.reminder_minutes),
        sync_to_google: googleConnected && form.sync_to_google,
      });
      onOpenChange(false);
    } catch (failure) {
      setError(formatApiErrorDetail(failure.response?.data?.detail));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="bg-surface-mid border-outline-variant text-on-surface max-w-2xl max-h-[90vh] overflow-y-auto" data-testid="event-form-dialog">
        <DialogHeader><DialogTitle className="font-heading text-2xl">{initial ? "Edit event" : "New event"}</DialogTitle></DialogHeader>
        {error && <div className="text-sm text-danger bg-danger/10 border border-danger/30 rounded-lg px-3 py-2">{error}</div>}
        {!initial && <FlyerCapture onExtract={applyFlyer} startOpen={captureOnOpen} />}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="sm:col-span-2"><label className={label}>Event name *</label><input autoFocus data-testid="event-title" className={field} value={form.title} onChange={(event) => set("title", event.target.value)} placeholder="What’s happening?" /></div>
          <div className="sm:col-span-2"><label className={label}>Organizer</label><input data-testid="event-organizer" className={field} value={form.organizer} onChange={(event) => set("organizer", event.target.value)} placeholder="Club, department, company, or person" /></div>
          <div><label className={label}>Category</label><select data-testid="event-category" className={field} value={form.category} onChange={(event) => { set("category", event.target.value); setPictureTheme(CATEGORY_PICTURE_THEME[event.target.value] || "Popular"); }}>{EVENT_CATEGORIES.map((category) => <option key={category}>{category}</option>)}</select></div>
          <div className="flex items-end pb-1"><label className="flex items-center gap-2 text-sm cursor-pointer"><input data-testid="event-all-day" type="checkbox" checked={form.all_day} onChange={(event) => set("all_day", event.target.checked)} />All-day event</label></div>
          <div className="sm:col-span-2 rounded-xl border border-outline-variant bg-surface-low p-3 space-y-3">
            <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-2">
              <div className="flex items-center justify-between gap-3">
                <label className={`${label} mb-0`}>Event picture or icon</label>
                {form.image_icon && <button type="button" onClick={() => set("image_icon", null)} className="sm:hidden text-xs text-on-surface-variant flex items-center gap-1"><X size={13} /> Clear picture</button>}
              </div>
              <div className="flex items-center gap-2">
                <span className="text-xs text-on-surface-variant">Show</span>
                <select data-testid="event-picture-theme" className="bg-surface-mid border border-outline-variant rounded-lg px-2.5 py-2 text-sm text-on-surface focus:border-brand focus:ring-2 focus:ring-brand/30 outline-none" value={pictureTheme} onChange={(event) => setPictureTheme(event.target.value)}>
                  {Object.keys(PICTURE_THEMES).map((theme) => <option key={theme} value={theme}>{theme}</option>)}
                </select>
                {form.image_icon && <button type="button" onClick={() => set("image_icon", null)} className="hidden sm:flex text-xs text-on-surface-variant items-center gap-1"><X size={13} /> Clear picture</button>}
              </div>
            </div>
            <div className="grid grid-cols-6 sm:grid-cols-8 gap-2">
              {themePictures.map((identifier) => {
                const pictureName = identifier.split(":")[1].replaceAll("-", " ");
                return <button key={identifier} type="button" title={pictureName} aria-label={`Use ${pictureName} picture`} onClick={() => set("image_icon", identifier)} className={`aspect-square rounded-lg border flex items-center justify-center p-1.5 ${form.image_icon === identifier ? "border-brand bg-brand/15 ring-2 ring-brand/30" : "border-transparent hover:bg-surface-high"}`}><img src={iconifyImageUrl(identifier)} alt="" className="w-full h-full object-contain" loading="lazy" referrerPolicy="no-referrer" /></button>;
              })}
            </div>
            <div className="border-t border-outline-variant pt-3">
              <span className="block text-xs text-on-surface-variant mb-2">Or choose a simple icon</span>
              <div className="flex flex-wrap gap-2">{Object.entries(EVENT_ICONS).map(([name, Icon]) => <button key={name} type="button" title={name} aria-label={`Use ${name} icon`} onClick={() => { set("icon", name); set("image_icon", null); }} className={`w-9 h-9 rounded-lg border flex items-center justify-center transition-colors ${!form.image_icon && form.icon === name ? "bg-brand text-on-brand border-brand" : "bg-surface-mid border-outline-variant text-on-surface-variant hover:text-on-surface"}`}><Icon size={17} /></button>)}</div>
            </div>
          </div>
          {form.all_day ? <>
            <div><label className={label}>Start date *</label><input type="date" className={field} value={form.start_date} onChange={(event) => set("start_date", event.target.value)} /></div>
            <div><label className={label}>End date</label><input type="date" className={field} min={form.start_date} value={form.end_date} onChange={(event) => set("end_date", event.target.value)} /></div>
          </> : <>
            <div><label className={label}>Start date *</label><input data-testid="event-start-date" type="date" className={field} value={form.timed_start_date} onChange={(event) => setForm((current) => ({ ...current, timed_start_date: event.target.value, timed_end_date: current.timed_end_date < event.target.value ? event.target.value : current.timed_end_date }))} /></div>
            <div><label className={label}>Start time</label><TimeSelect testid="event-start-time" className={field} value={form.start_time} onChange={(value) => set("start_time", value)} /></div>
            <div><label className={label}>End date</label><input type="date" className={field} min={form.timed_start_date} value={form.timed_end_date} onChange={(event) => set("timed_end_date", event.target.value)} /></div>
            <div><label className={label}>End time</label><TimeSelect className={field} value={form.end_time} onChange={(value) => set("end_time", value)} /></div>
          </>}
          <div><label className={label}>Timezone</label><input className={field} value={form.timezone} onChange={(event) => set("timezone", event.target.value)} placeholder="America/Chicago" /></div>
          <div><label className={label}>Reminder</label><select className={field} value={form.reminder_minutes} onChange={(event) => set("reminder_minutes", event.target.value)}>{REMINDERS.map(([value, text]) => <option key={String(value)} value={value}>{text}</option>)}</select></div>
          <div className="sm:col-span-2"><label className={label}>Location</label><input className={field} value={form.location} onChange={(event) => set("location", event.target.value)} placeholder="Room, address, or video link" /></div>
          <div className="sm:col-span-2"><label className={label}>Source link</label><input type="url" className={field} value={form.source_url} onChange={(event) => set("source_url", event.target.value)} placeholder="Where you found this event" /></div>
          <div className="sm:col-span-2"><label className={label}>Description</label><textarea rows={3} className={field} value={form.description} onChange={(event) => set("description", event.target.value)} placeholder="Notes and details" /></div>
          {googleConnected && <div className="sm:col-span-2 border border-outline-variant bg-surface-low rounded-lg px-3 py-2.5 flex items-center gap-2"><label className="flex items-center gap-2 text-sm cursor-pointer"><input type="checkbox" checked={form.sync_to_google} onChange={(event) => set("sync_to_google", event.target.checked)} /><span>Add this event to the dedicated LaunchPad Google calendar</span></label><TooltipProvider delayDuration={150}><Tooltip><TooltipTrigger asChild><button type="button" aria-label="What does Google Calendar sync do?" className="shrink-0 text-on-surface-variant hover:text-on-surface"><Info size={16} /></button></TooltipTrigger><TooltipContent className="max-w-xs text-center leading-relaxed">This copies the event to a separate calendar named “LaunchPad” in your connected Google account. Turn it off to keep the event only in LaunchPad.</TooltipContent></Tooltip></TooltipProvider></div>}
        </div>
        <DialogFooter className="border-t border-outline-variant pt-4"><button onClick={() => onOpenChange(false)} className="px-4 py-2.5 rounded-lg text-sm border border-outline-variant text-on-surface-variant">Cancel</button><button onClick={save} disabled={saving} data-testid="event-save" className="px-5 py-2.5 rounded-lg text-sm font-semibold bg-brand text-on-brand flex items-center gap-2 disabled:opacity-60">{saving && <Loader2 className="animate-spin" size={16} />}{initial ? "Save changes" : "Add event"}</button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
