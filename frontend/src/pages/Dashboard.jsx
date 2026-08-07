import { useEffect, useState, useCallback } from "react";
import {
  ResponsiveContainer, AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip,
  PieChart, Pie, Cell, BarChart, Bar,
} from "recharts";
import { Briefcase, MessagesSquare, Star, PieChart as PieIcon, TrendingUp, ArrowUpRight } from "lucide-react";
import { Layout } from "@/components/Layout";
import { ApplicationForm } from "@/components/ApplicationForm";
import { CompanyLogo } from "@/components/CompanyLogo";
import api from "@/lib/api";

const STATUS_COLORS = {
  Applied: "#8d90a0", Screening: "#7bd0ff", Interviewing: "#2563eb", Offer: "#ffb596", Rejected: "#ffb4ab",
};

function money(n) {
  return "$" + (n >= 1000 ? (n / 1000).toFixed(0) + "k" : n);
}

function ChartTooltip({ active, payload, label, formatter }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-surface-highest border border-outline-variant rounded-lg px-3 py-2 text-xs shadow-xl">
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
  const [data, setData] = useState(null);
  const [recent, setRecent] = useState([]);
  const [formOpen, setFormOpen] = useState(false);

  const load = useCallback(async () => {
    const [a, apps] = await Promise.all([api.get("/analytics"), api.get("/applications")]);
    setData(a.data);
    setRecent(apps.data.slice(0, 5));
  }, []);

  useEffect(() => { load(); }, [load]);

  const createApp = async (payload) => {
    await api.post("/applications", payload);
    await load();
  };

  const kpis = data?.kpis || { total: 0, interviews: 0, offers: 0, success_rate: 0 };
  const totalStatus = (data?.status_distribution || []).reduce((s, x) => s + x.count, 0);

  const cards = [
    { label: "Total Applications", value: kpis.total, icon: Briefcase, tint: "bg-orange/20 text-orange", note: `${kpis.responded ?? 0} responded` },
    { label: "In Interview", value: kpis.interviews, icon: MessagesSquare, tint: "bg-cyan-container/20 text-cyan", note: "Screening + Interviewing" },
    { label: "Offers Received", value: kpis.offers, icon: Star, tint: "bg-brand-container/30 text-brand", note: "Active" },
    { label: "Success Rate", value: `${kpis.success_rate}%`, icon: PieIcon, tint: "bg-surface-highest text-on-surface-variant", note: "Offers / Apps" },
  ];

  return (
    <Layout title="Analytics Overview" onAddApplication={() => setFormOpen(true)}>
      {/* KPI cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        {cards.map((c, i) => (
          <div
            key={c.label}
            data-testid={`kpi-card-${i}`}
            className="bg-surface-low border border-surface-highest rounded-xl p-5 hover:border-brand/40 transition-all duration-200 animate-fade-up"
            style={{ animationDelay: `${i * 60}ms` }}
          >
            <div className="flex justify-between items-start mb-3">
              <p className="text-xs font-label uppercase tracking-wider text-on-surface-variant">{c.label}</p>
              <span className={`p-1.5 rounded-lg ${c.tint}`}><c.icon size={18} /></span>
            </div>
            <div className="flex items-baseline gap-2">
              <h3 className="font-heading text-4xl font-bold text-on-surface">{c.value}</h3>
            </div>
            <p className="text-xs text-on-surface-variant mt-1">{c.note}</p>
          </div>
        ))}
      </div>

      {/* Charts */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Volume */}
        <div className="lg:col-span-2 bg-surface-low border border-surface-highest rounded-xl p-6">
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
                    <stop offset="0%" stopColor="#b4c5ff" stopOpacity={0.35} />
                    <stop offset="100%" stopColor="#b4c5ff" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="4 4" stroke="#273647" vertical={false} />
                <XAxis dataKey="label" stroke="#c3c6d7" fontSize={12} tickLine={false} axisLine={false} />
                <YAxis stroke="#c3c6d7" fontSize={12} tickLine={false} axisLine={false} allowDecimals={false} />
                <Tooltip content={<ChartTooltip formatter={(p) => `${p.value} apps`} />} cursor={{ stroke: "#b4c5ff", strokeWidth: 1 }} />
                <Area type="monotone" dataKey="count" stroke="#b4c5ff" strokeWidth={2.5} fill="url(#volGrad)" dot={{ fill: "#010f1f", stroke: "#b4c5ff", strokeWidth: 2, r: 4 }} activeDot={{ r: 6 }} />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Status donut */}
        <div className="bg-surface-low border border-surface-highest rounded-xl p-6 flex flex-col">
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
        <div className="lg:col-span-3 bg-surface-low border border-surface-highest rounded-xl p-6">
          <h3 className="font-heading text-xl font-semibold">Compensation Analysis</h3>
          <p className="text-sm text-on-surface-variant mb-4">Annualized pay across roles you've applied to</p>
          <div className="h-80" data-testid="compensation-chart">
            {(data?.compensation || []).length === 0 ? (
              <div className="h-full flex items-center justify-center text-on-surface-variant text-sm">Add pay rates to your applications to see this chart.</div>
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={data?.compensation || []} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="4 4" stroke="#273647" vertical={false} />
                  <XAxis dataKey="company" stroke="#c3c6d7" fontSize={12} tickLine={false} axisLine={false} />
                  <YAxis stroke="#c3c6d7" fontSize={12} tickLine={false} axisLine={false} tickFormatter={money} />
                  <Tooltip content={<ChartTooltip formatter={(p) => `$${p.value.toLocaleString()}`} />} cursor={{ fill: "#1c2b3c" }} />
                  <Bar dataKey="pay" fill="#b4c5ff" radius={[6, 6, 0, 0]} maxBarSize={60} />
                </BarChart>
              </ResponsiveContainer>
            )}
          </div>
        </div>
      </div>

      {/* Recent */}
      <div className="mt-6 bg-surface-low border border-surface-highest rounded-xl p-6">
        <div className="flex justify-between items-center mb-4">
          <h3 className="font-heading text-xl font-semibold">Recent Applications</h3>
          <a href="/applications" className="text-sm text-cyan flex items-center gap-1 hover:underline">View all <ArrowUpRight size={14} /></a>
        </div>
        <div className="space-y-2" data-testid="recent-applications">
          {recent.length === 0 && <p className="text-on-surface-variant text-sm py-6 text-center">No applications yet. Add your first one!</p>}
          {recent.map((app) => (
            <div key={app.app_id} className="flex items-center gap-3 p-3 rounded-lg hover:bg-surface-mid transition-colors">
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
