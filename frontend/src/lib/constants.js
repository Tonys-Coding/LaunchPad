import { format, parseISO } from "date-fns";

export const STATUSES = ["Applied", "Screening", "Interviewing", "Offer", "Rejected"];

export const STATUS_COLORS_DARK = {
  Applied: "#525252", Screening: "#737373", Interviewing: "#a3a3a3", Offer: "#ffffff", Rejected: "#f87171",
};
export const STATUS_COLORS_LIGHT = {
  Applied: "#d4d4d4", Screening: "#a3a3a3", Interviewing: "#525252", Offer: "#0a0a0a", Rejected: "#dc2626",
};
export const CONF_COLORS_DARK = { Low: "#f87171", Medium: "#a3a3a3", High: "#ffffff" };
export const CONF_COLORS_LIGHT = { Low: "#dc2626", Medium: "#737373", High: "#0a0a0a" };

export const statusColors = (theme) => (theme === "light" ? STATUS_COLORS_LIGHT : STATUS_COLORS_DARK);
export const confColors = (theme) => (theme === "light" ? CONF_COLORS_LIGHT : CONF_COLORS_DARK);
export const followUpColor = (level, theme) => {
  const dark = { overdue: "#f87171", soon: "#ffffff", upcoming: "#737373" };
  const light = { overdue: "#dc2626", soon: "#0a0a0a", upcoming: "#a3a3a3" };
  return (theme === "light" ? light : dark)[level];
};

// Back-compat defaults (dark)
export const STATUS_COLORS = STATUS_COLORS_DARK;
export const CONF_COLORS = CONF_COLORS_DARK;

// Returns null, or { level: 'overdue'|'soon'|'upcoming', days } for open applications
export function followUpState(app) {
  if (!app?.follow_up_date) return null;
  if (!["Applied", "Screening", "Interviewing"].includes(app.status)) return null;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const due = new Date(app.follow_up_date + "T00:00:00");
  const diff = Math.round((due - today) / 86400000);
  if (diff < 0) return { level: "overdue", days: -diff };
  if (diff <= 3) return { level: "soon", days: diff };
  return { level: "upcoming", days: diff };
}

export function formatStartDate(app) {
  if (app.start_date_tbd) return "TBD";
  if (!app.expected_start_date) return "—";
  const d = parseISO(app.expected_start_date);
  return app.start_date_month_only ? format(d, "MMM yyyy") : format(d, "PP");
}

export function formatInterview(iso) {
  if (!iso) return null;
  try {
    return format(parseISO(iso), "EEE, MMM d 'at' p");
  } catch {
    return null;
  }
}
