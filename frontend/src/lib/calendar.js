import {
  Bell, BookOpen, BriefcaseBusiness, Building2, CalendarCheck, Clock,
  Coffee, FileText, GraduationCap, Laptop, MapPin, Presentation,
  Star, Target, Users, Video,
} from "lucide-react";
import { useState } from "react";

export const EVENT_CATEGORIES = [
  "Academic", "Work", "Job Search", "Interview",
  "Career Fair", "Deadline", "Personal", "Other",
];

export const EVENT_ICONS = {
  "calendar-check": CalendarCheck,
  "book-open": BookOpen,
  "briefcase-business": BriefcaseBusiness,
  "graduation-cap": GraduationCap,
  video: Video,
  users: Users,
  "map-pin": MapPin,
  clock: Clock,
  target: Target,
  "file-text": FileText,
  presentation: Presentation,
  laptop: Laptop,
  "building-2": Building2,
  coffee: Coffee,
  star: Star,
  bell: Bell,
};

export const CATEGORY_STYLES = {
  Academic: "bg-sky-500/15 text-sky-500 border-sky-500/30",
  Work: "bg-indigo-500/15 text-indigo-400 border-indigo-500/30",
  "Job Search": "bg-amber-500/15 text-amber-500 border-amber-500/30",
  Interview: "bg-emerald-500/15 text-emerald-500 border-emerald-500/30",
  "Career Fair": "bg-fuchsia-500/15 text-fuchsia-400 border-fuchsia-500/30",
  Deadline: "bg-red-500/15 text-red-500 border-red-500/30",
  Personal: "bg-violet-500/15 text-violet-400 border-violet-500/30",
  Other: "bg-surface-high text-on-surface-variant border-outline-variant",
};

export const REMINDERS = [
  ["", "None"], [5, "5 minutes before"], [10, "10 minutes before"],
  [15, "15 minutes before"], [30, "30 minutes before"],
  [60, "1 hour before"], [1440, "1 day before"],
];

export const ICONIFY_IMAGE_PREFIXES = ["fluent-emoji-flat", "noto", "openmoji", "twemoji"];

export function iconifyImageUrl(identifier) {
  if (!identifier || !identifier.includes(":")) return null;
  const [prefix, name] = identifier.split(":", 2);
  if (!ICONIFY_IMAGE_PREFIXES.includes(prefix) || !/^[a-z0-9-]+$/.test(name)) return null;
  return `https://api.iconify.design/${prefix}/${name}.svg`;
}

export function EventIcon({ item, size = 18, className = "" }) {
  const [failed, setFailed] = useState(false);
  const pictureUrl = failed ? null : iconifyImageUrl(item?.image_icon);
  if (pictureUrl) {
    return <img src={pictureUrl} alt="" width={size} height={size} className={`object-contain ${className}`} referrerPolicy="no-referrer" onError={() => setFailed(true)} />;
  }
  const Icon = EVENT_ICONS[item?.icon] || CalendarCheck;
  return <Icon size={size} className={className} />;
}

export function itemStart(item) {
  return item.all_day
    ? new Date(`${item.start_date}T00:00:00`)
    : new Date(item.starts_at);
}

export function itemEnd(item) {
  return item.all_day
    ? new Date(`${item.end_date || item.start_date}T23:59:59`)
    : new Date(item.ends_at);
}

export function itemTimeLabel(item) {
  if (item.all_day) return "All day";
  const start = itemStart(item);
  const end = itemEnd(item);
  return `${start.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}–${end.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}`;
}

export function localDateTimeValue(iso) {
  if (!iso) return "";
  const value = new Date(iso);
  const pad = (n) => String(n).padStart(2, "0");
  return `${value.getFullYear()}-${pad(value.getMonth() + 1)}-${pad(value.getDate())}T${pad(value.getHours())}:${pad(value.getMinutes())}`;
}
