import { useEffect, useState, useCallback } from "react";
import {
  ResponsiveContainer, AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip,
  PieChart, Pie, Cell, BarChart, Bar,
} from "recharts";
import { Briefcase, MessagesSquare, Star, PieChart as PieIcon, TrendingUp, ArrowUpRight, Clock, AlertTriangle, BellRing, CalendarClock, RefreshCw } from "lucide-react";
import { Layout } from "@/components/Layout";
import { ApplicationForm } from "@/components/ApplicationForm";
import { ApplicationGoalCard } from "@/components/ApplicationGoalCard";
import { CompanyLogo } from "@/components/CompanyLogo";
import { Calendar } from "@/components/ui/calendar";
import { followUpState, statusColors, followUpColor } from "@/lib/constants";
import { useTheme } from "@/context/ThemeContext";
import { addDays, format } from "date-fns";
import api from "@/lib/api";
import { EventIcon, itemStart, itemTimeLabel } from "@/lib/calendar";

function money(n) {
  return "$" + (n >= 1000 ? (n / 1000).toFixed(0) + "k" : n);
}

function ChartTooltip({ active, payload, label, formatter }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="lp-chamfer-chip border border-outline-variant bg-surface-highest px-3 py-2 text-xs shadow-xl">
      {label && <p className="text-on-surface-variant mb-1">{label}</p>}
      {payload.map((p, i) => (
        <p key={i} className="text-on-surface font-semibold">
          {formatter ? formatter(p) : `${p.name}: ${p.value}`}
        </p>
      ))}
    </div>
  );
}

export default function Dashboard() {
  const { theme } = useTheme();
  const STATUS_COLORS = statusColors(theme);
  const isLight = theme === "light";
  const CHART = {
    line: isLight ? "#0a0a0a" : "#f5f5f5",
    grid: isLight ? "#e5e5e5" : "#262626",
    axis: "#737373",
    dot: isLight ? "#ffffff" : "#0a0a0a",
    barCursor: isLight ? "#f4f4f5" : "#1f1f1f",
  };
  const [data, setData] = useState(null);
  const [recent, setRecent] = useState([]);
  const [allApps, setAllApps] = useState([]);
  const [calendarItems, setCalendarItems] = useState([]);
  const [formOpen, setFormOpen] = useState(false);
  const [goal, setGoal] = useState(null);
  const [goalLoading, setGoalLoading] = useState(true);
  const [goalError, setGoalError] = useState(false);
  const [dashboardLoading, setDashboardLoading] = useState(true);
  const [dashboardError, setDashboardError] = useState(false);

  const loadGoal = useCallback(async () => {
    setGoalLoading(true);
    setGoalError(false);
    try {
      const { data: goalData } = await api.get("/application-goal");
      setGoal(goalData);
    } catch {
      setGoalError(true);
    } finally {
      setGoalLoading(false);
    }
  }, []);

  const load = useCallback(async () => {
    setDashboardLoading(true);
    setDashboardError(false);
    const [, workspaceResult] = await Promise.allSettled([loadGoal(), (async () => {
      const rangeStart = new Date();
      rangeStart.setHours(0, 0, 0, 0);
      const [a, apps, calendar] = await Promise.all([
        api.get("/analytics"), api.get("/applications"),
        api.get("/calendar/items", { params: { from: rangeStart.toISOString(), to: addDays(rangeStart, 90).toISOString() } }),
      ]);
      setData(a.data);
      setAllApps(apps.data);
      setRecent(apps.data.slice(0, 5));
      setCalendarItems(calendar.data);
    })()]);
    if (workspaceResult.status === "rejected") setDashboardError(true);
    setDashboardLoading(false);
  }, [loadGoal]);

  useEffect(() => { load(); }, [load]);

  const createApp = async (payload) => {
    await api.post("/applications", payload);
    await load();
  };

  const saveGoal = async (payload) => {
    const { data: savedGoal } = await api.put("/application-goal", payload);
    setGoal(savedGoal);
    setGoalError(false);
  };

  const removeGoal = async () => {
    await api.delete("/application-goal");
    setGoal({ configured: false });
    setGoalError(false);
  };

  const kpis = data?.kpis || { total: 0, interviews: 0, offers: 0, success_rate: 0 };
  const totalStatus = (data?.status_distribution || []).reduce((s, x) => s + x.count, 0);

  const dueFollowUps = allApps
    .map((a) => ({ app: a, fu: followUpState(a) }))
    .filter((x) => x.fu && (x.fu.level === "overdue" || x.fu.level === "soon"))
    .sort((a, b) => (a.fu.level === "overdue" ? -a.fu.days : a.fu.days) - (b.fu.level === "overdue" ? -b.fu.days : b.fu.days));

  const today0 = new Date();
  today0.setHours(0, 0, 0, 0);
  const upcoming = calendarItems.filter((item) => itemStart(item) >= today0).sort((a, b) => itemStart(a) - itemStart(b));
  const eventDays = upcoming.map(itemStart);

  const cards = [
    { label: "Total Applications", value: kpis.total, icon: Briefcase, note: `${kpis.responded ?? 0} responded` },
    { label: "In Interview", value: kpis.interviews, icon: MessagesSquare, note: "Screening + Interviewing" },
    { label: "Offers Received", value: kpis.offers, icon: Star, note: "Active" },
    { label: "Success Rate", value: `${kpis.success_rate}%`, icon: PieIcon, note: "Offers / Apps" },
  ];

  return (
    <Layout title="Analytics Overview" onAddApplication={() => setFormOpen(true)}>
      <ApplicationGoalCard
        goal={goal}
        loading={goalLoading}
        error={goalError}
        onRetry={loadGoal}
        onSave={saveGoal}
        onRemove={removeGoal}
        onAddApplication={() => setFormOpen(true)}
      />

      {dashboardError && (
        <div className="lp-panel lp-chamfer-tr mb-6 flex flex-col items-start justify-between gap-3 border-danger/40 p-4 sm:flex-row sm:items-center" role="alert" data-testid="dashboard-load-error">
          <p className="text-sm text-danger">Dashboard data could not be loaded. Your saved information was not changed.</p>
          <button type="button" onClick={load} className="lp-chamfer-button flex shrink-0 items-center gap-2 border border-outline-variant px-3 py-2 text-sm font-semibold hover:bg-surface-high"><RefreshCw size={14} />Try again</button>
        </div>
      )}

      {dashboardLoading && !data && <p className="sr-only" role="status">Loading dashboard</p>}

      {/* KPI cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        {cards.map((c, i) => (
          <div
            key={c.label}
            data-testid={`kpi-card-${i}`}
            className="lp-panel lp-panel-hover lp-chamfer-tr lp-crosshair group p-5 animate-fade-up"
            style={{ animationDelay: `${i * 60}ms` }}
          >
            <div className="flex justify-between items-start mb-3">
              <p className="flex items-center gap-2 text-sm font-semibold text-on-surface-variant"><span className="lp-status-dot" /> {c.label}</p>
              <span className="lp-icon-frame h-9 w-9 text-on-surface-variant transition-colors group-hover:bg-brand group-hover:text-on-brand"><c.icon size={18} /></span>
            </div>
            <div className="flex items-baseline gap-2">
              <h3 className="font-heading text-4xl font-bold text-on-surface">{c.value}</h3>
            </div>
            <div className="mt-4 border-t border-outline-variant pt-3"><p className="text-xs uppercase tracking-wider text-on-surface-variant">{c.note}</p></div>
          </div>
        ))}
      </div>

      {/* Follow-ups due */}
      {dueFollowUps.length > 0 && (
        <div className="lp-panel lp-chamfer-dual lp-crosshair mb-6 border-orange/30 p-5" data-testid="followups-due">
          <div className="flex items-center gap-2 mb-4">
            <BellRing size={18} className="text-orange" />
            <h3 className="font-heading text-lg font-semibold">Follow-ups due</h3>
            <span className="text-xs text-background bg-orange rounded-full px-2 py-0.5 font-semibold">{dueFollowUps.length}</span>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
            {dueFollowUps.map(({ app, fu }) => {
              const overdue = fu.level === "overdue";
              const c = overdue ? followUpColor("overdue", theme) : followUpColor("soon", theme);
              return (
                <div key={app.app_id} data-testid={`followup-due-${app.app_id}`} className="lp-surface-hover lp-chamfer-sm flex items-center gap-3 border border-outline-variant bg-surface-mid p-3">
                  <CompanyLogo name={app.company_name} domain={app.company_domain} size={36} />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium truncate">{app.job_title}</p>
                    <p className="text-xs text-on-surface-variant truncate">{app.company_name} · {app.status}</p>
                  </div>
                  <span className="flex items-center gap-1 text-xs font-semibold whitespace-nowrap" style={{ color: c }}>
                    {overdue ? <AlertTriangle size={13} /> : <Clock size={13} />}
                    {overdue ? `${fu.days}d overdue` : fu.days === 0 ? "Today" : `In ${fu.days}d`}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Upcoming calendar */}
      {upcoming.length > 0 && (
        <div className="mb-6 grid grid-cols-1 lg:grid-cols-3 gap-6" data-testid="upcoming-calendar">
          <div className="lp-panel lp-chamfer-bl lp-crosshair flex items-start justify-center p-3">
            <Calendar
              mode="single"
              defaultMonth={upcoming[0] ? itemStart(upcoming[0]) : new Date()}
              modifiers={{ scheduled: eventDays }}
              modifiersClassNames={{ scheduled: "bg-cyan/25 text-cyan font-bold rounded-md" }}
            />
          </div>
          <div className="lp-panel lp-chamfer-dual lp-crosshair p-5 lg:col-span-2">
            <div className="flex items-center gap-2 mb-4">
              <CalendarClock size={18} className="text-cyan" />
              <h3 className="font-heading text-lg font-semibold">Upcoming calendar</h3>
              <span className="text-xs text-background bg-cyan rounded-full px-2 py-0.5 font-semibold">{upcoming.length}</span>
            </div>
            {upcoming.length === 0 ? (
              <p className="text-sm text-on-surface-variant">No upcoming events scheduled.</p>
            ) : (
              <div className="space-y-2">
                {upcoming.slice(0, 6).map((item) => {
                  return (
                  <a href="/calendar" key={item.id} className="lp-surface-hover lp-chamfer-sm flex items-center gap-3 border border-outline-variant bg-surface-mid p-3 transition-colors hover:bg-surface-high">
                    <span className="lp-icon-frame h-9 w-9"><EventIcon item={item} size={20} /></span>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium truncate">{item.title}</p>
                      <p className="text-xs text-on-surface-variant truncate">{item.subtitle || item.category}</p>
                    </div>
                    <span className="text-xs font-semibold text-cyan whitespace-nowrap flex items-center gap-1">
                      <CalendarClock size={13} /> {format(itemStart(item), "MMM d")} · {itemTimeLabel(item)}
                    </span>
                  </a>
                );})}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Charts */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Volume */}
        <div className="lp-panel lp-chamfer-dual lp-crosshair p-6 lg:col-span-2">
          <div className="flex justify-between items-center mb-4">
            <div>
              <h3 className="font-heading text-xl font-semibold">Application Volume</h3>
              <p className="text-sm text-on-surface-variant">Applications submitted over time</p>
            </div>
            <span className="text-xs text-cyan flex items-center gap-1"><TrendingUp size={14} /> monthly</span>
          </div>
          <div className="h-72" data-testid="volume-chart">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={data?.volume || []} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                <defs>
                  <linearGradient id="volGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor={CHART.line} stopOpacity={0.28} />
                    <stop offset="100%" stopColor={CHART.line} stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="4 4" stroke={CHART.grid} vertical={false} />
                <XAxis dataKey="label" stroke={CHART.axis} fontSize={12} tickLine={false} axisLine={false} />
                <YAxis stroke={CHART.axis} fontSize={12} tickLine={false} axisLine={false} allowDecimals={false} />
                <Tooltip content={<ChartTooltip formatter={(p) => `${p.value} apps`} />} cursor={{ stroke: CHART.line, strokeWidth: 1 }} />
                <Area type="monotone" dataKey="count" stroke={CHART.line} strokeWidth={2.5} fill="url(#volGrad)" dot={{ fill: CHART.dot, stroke: CHART.line, strokeWidth: 2, r: 4 }} activeDot={{ r: 6 }} />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Status donut */}
        <div className="lp-panel lp-chamfer-tr lp-crosshair flex flex-col p-6">
          <h3 className="font-heading text-xl font-semibold mb-2">Application Status</h3>
          <div className="flex-1 relative min-h-[220px]" data-testid="status-chart">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie data={data?.status_distribution || []} dataKey="count" nameKey="status" innerRadius="62%" outerRadius="90%" paddingAngle={2} stroke="none">
                  {(data?.status_distribution || []).map((e) => <Cell key={e.status} fill={STATUS_COLORS[e.status]} />)}
                </Pie>
                <Tooltip content={<ChartTooltip formatter={(p) => `${p.name}: ${p.value}`} />} />
              </PieChart>
            </ResponsiveContainer>
            <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
              <span className="font-heading text-3xl font-bold">{totalStatus}</span>
              <span className="text-xs text-on-surface-variant">total</span>
            </div>
          </div>
          <div className="mt-4 flex flex-wrap gap-x-4 gap-y-2 justify-center">
            {(data?.status_distribution || []).map((e) => (
              <div key={e.status} className="flex items-center gap-1.5">
                <span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: STATUS_COLORS[e.status] }} />
                <span className="text-xs text-on-surface">{e.status} ({e.count})</span>
              </div>
            ))}
          </div>
        </div>

        {/* Compensation */}
        <div className="lp-panel lp-chamfer-bl lp-crosshair p-6 lg:col-span-3">
          <h3 className="font-heading text-xl font-semibold">Compensation Analysis</h3>
          <p className="text-sm text-on-surface-variant mb-4">Annualized pay across roles you've applied to</p>
          <div className="h-80" data-testid="compensation-chart">
            {(data?.compensation || []).length === 0 ? (
              <div className="h-full flex items-center justify-center text-on-surface-variant text-sm">Add pay rates to your applications to see this chart.</div>
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={data?.compensation || []} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="4 4" stroke={CHART.grid} vertical={false} />
                  <XAxis dataKey="company" stroke={CHART.axis} fontSize={12} tickLine={false} axisLine={false} />
                  <YAxis stroke={CHART.axis} fontSize={12} tickLine={false} axisLine={false} tickFormatter={money} />
                  <Tooltip content={<ChartTooltip formatter={(p) => `$${p.value.toLocaleString()}`} />} cursor={{ fill: CHART.barCursor }} />
                  <Bar dataKey="pay" fill={CHART.line} radius={[6, 6, 0, 0]} maxBarSize={60} />
                </BarChart>
              </ResponsiveContainer>
            )}
          </div>
        </div>
      </div>

      {/* Recent */}
      <div className="lp-panel lp-chamfer-dual lp-crosshair mt-6 p-6">
        <div className="flex justify-between items-center mb-4">
          <h3 className="font-heading text-xl font-semibold">Recent Applications</h3>
          <a href="/applications" className="text-sm text-cyan flex items-center gap-1 hover:underline">View all <ArrowUpRight size={14} /></a>
        </div>
        <div className="space-y-2" data-testid="recent-applications">
          {recent.length === 0 && <p className="text-on-surface-variant text-sm py-6 text-center">No applications yet. Add your first one!</p>}
          {recent.map((app) => (
            <div key={app.app_id} className="lp-surface-hover lp-chamfer-sm flex items-center gap-3 border border-transparent p-3 transition-colors hover:border-outline-variant hover:bg-surface-mid">
              <CompanyLogo name={app.company_name} domain={app.company_domain} size={40} />
              <div className="flex-1 min-w-0">
                <p className="font-medium text-on-surface truncate">{app.job_title}</p>
                <p className="text-sm text-on-surface-variant truncate">{app.company_name} · Applied {app.day_applied}</p>
              </div>
              <span className="text-xs font-semibold px-2.5 py-1 rounded-full" style={{ backgroundColor: `${STATUS_COLORS[app.status]}22`, color: STATUS_COLORS[app.status] }}>
                {app.status}
              </span>
            </div>
          ))}
        </div>
      </div>

      <ApplicationForm open={formOpen} onOpenChange={setFormOpen} onSubmit={createApp} />
    </Layout>
  );
}
