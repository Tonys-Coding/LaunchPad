export const STATUSES = ["Applied", "Screening", "Interviewing", "Offer", "Rejected"];

export const STATUS_COLORS = {
  Applied: "#8d90a0",
  Screening: "#7bd0ff",
  Interviewing: "#2563eb",
  Offer: "#ffb596",
  Rejected: "#ffb4ab",
};

export const CONF_COLORS = { Low: "#ffb4ab", Medium: "#ffb596", High: "#7bd0ff" };

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
