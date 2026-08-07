import { useEffect, useState, useCallback, useMemo } from "react";
import { Plus, Search, Pencil, Trash2, DollarSign, Calendar, Gauge } from "lucide-react";
import { Layout } from "@/components/Layout";
import { ApplicationForm } from "@/components/ApplicationForm";
import { CompanyLogo } from "@/components/CompanyLogo";
import {
  AlertDialog, AlertDialogContent, AlertDialogHeader, AlertDialogTitle,
  AlertDialogDescription, AlertDialogFooter, AlertDialogCancel, AlertDialogAction,
} from "@/components/ui/alert-dialog";
import { toast } from "sonner";
import api from "@/lib/api";

const STATUS_COLORS = {
  Applied: "#8d90a0", Screening: "#7bd0ff", Interviewing: "#2563eb", Offer: "#ffb596", Rejected: "#ffb4ab",
};
const CONF_COLORS = { Low: "#ffb4ab", Medium: "#ffb596", High: "#7bd0ff" };
const FILTERS = ["All", "Applied", "Screening", "Interviewing", "Offer", "Rejected"];

function payLabel(app) {
  if (!app.pay_amount) return null;
  const suffix = app.pay_period === "hourly" ? "/hr" : app.pay_period === "monthly" ? "/mo" : "/yr";
  return `$${Number(app.pay_amount).toLocaleString()}${suffix}`;
}

export default function Applications() {
  const [apps, setApps] = useState([]);
  const [loading, setLoading] = useState(true);
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [deleteId, setDeleteId] = useState(null);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState("All");

  const load = useCallback(async () => {
    setLoading(true);
    const { data } = await api.get("/applications");
    setApps(data);
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  const filtered = useMemo(() => {
    return apps.filter((a) => {
      const matchesFilter = filter === "All" || a.status === filter;
      const q = query.toLowerCase();
      const matchesQuery = !q || a.company_name.toLowerCase().includes(q) || a.job_title.toLowerCase().includes(q);
      return matchesFilter && matchesQuery;
    });
  }, [apps, filter, query]);

  const submit = async (payload) => {
    if (editing) {
      await api.put(`/applications/${editing.app_id}`, payload);
      toast.success("Application updated");
    } else {
      await api.post("/applications", payload);
      toast.success("Application added");
    }
    await load();
  };

  const confirmDelete = async () => {
    await api.delete(`/applications/${deleteId}`);
    setDeleteId(null);
    toast.success("Application deleted");
    await load();
  };

  const openNew = () => { setEditing(null); setFormOpen(true); };
  const openEdit = (app) => { setEditing(app); setFormOpen(true); };

  return (
    <Layout title="Applications" onAddApplication={openNew}>
      {/* Controls */}
      <div className="flex flex-col sm:flex-row gap-3 mb-6">
        <div className="relative flex-1">
          <Search size={18} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-on-surface-variant" />
          <input
            data-testid="applications-search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search company or role..."
            className="w-full bg-surface-low border border-outline-variant rounded-xl pl-11 pr-4 py-2.5 text-on-surface placeholder:text-on-surface-variant focus:border-brand focus:ring-2 focus:ring-brand/30 outline-none"
          />
        </div>
        <button onClick={openNew} data-testid="applications-add-button" className="bg-brand text-on-brand rounded-xl px-5 py-2.5 font-semibold flex items-center justify-center gap-2 hover:brightness-110 active:scale-[0.98] transition-all">
          <Plus size={18} /> Add Application
        </button>
      </div>

      {/* Filter chips */}
      <div className="flex flex-wrap gap-2 mb-6">
        {FILTERS.map((f) => (
          <button
            key={f}
            data-testid={`filter-${f.toLowerCase()}`}
            onClick={() => setFilter(f)}
            className={`px-4 py-1.5 rounded-full text-sm font-medium transition-colors ${
              filter === f ? "bg-brand text-on-brand" : "bg-surface-low text-on-surface-variant border border-outline-variant hover:border-brand/40"
            }`}
          >
            {f}
          </button>
        ))}
      </div>

      {/* List */}
      {loading ? (
        <div className="text-center py-20 text-on-surface-variant">Loading...</div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-20 text-on-surface-variant" data-testid="applications-empty">
          No applications found. Click "Add Application" to get started.
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4" data-testid="applications-list">
          {filtered.map((app, i) => (
            <div
              key={app.app_id}
              data-testid={`application-card-${app.app_id}`}
              className="group bg-surface-low border border-surface-highest rounded-xl p-5 hover:border-brand/40 transition-all animate-fade-up"
              style={{ animationDelay: `${i * 40}ms` }}
            >
              <div className="flex items-start gap-4">
                <CompanyLogo name={app.company_name} domain={app.company_domain} size={48} />
                <div className="flex-1 min-w-0">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <h3 className="font-heading text-lg font-semibold truncate">{app.job_title}</h3>
                      <p className="text-sm text-on-surface-variant truncate">{app.company_name}</p>
                    </div>
                    <span className="shrink-0 text-xs font-semibold px-2.5 py-1 rounded-full" style={{ backgroundColor: `${STATUS_COLORS[app.status]}22`, color: STATUS_COLORS[app.status] }}>
                      {app.status}
                    </span>
                  </div>

                  <div className="flex flex-wrap gap-x-4 gap-y-1.5 mt-3 text-xs text-on-surface-variant">
                    <span className="flex items-center gap-1"><Calendar size={13} /> Applied {app.day_applied}</span>
                    <span className="flex items-center gap-1"><Calendar size={13} /> Start {app.start_date_tbd ? "TBD" : (app.expected_start_date || "—")}</span>
                    {payLabel(app) && <span className="flex items-center gap-1"><DollarSign size={13} /> {payLabel(app)}</span>}
                    {app.confidence_level && (
                      <span className="flex items-center gap-1" style={{ color: CONF_COLORS[app.confidence_level] }}>
                        <Gauge size={13} /> {app.confidence_level}
                      </span>
                    )}
                  </div>

                  {app.description && <p className="text-sm text-on-surface-variant mt-3 line-clamp-2">{app.description}</p>}

                  <div className="flex gap-2 mt-4 opacity-0 group-hover:opacity-100 transition-opacity">
                    <button data-testid={`edit-${app.app_id}`} onClick={() => openEdit(app)} className="flex items-center gap-1 text-xs px-3 py-1.5 rounded-lg border border-outline-variant text-cyan hover:bg-surface-mid transition-colors">
                      <Pencil size={13} /> Edit
                    </button>
                    <button data-testid={`delete-${app.app_id}`} onClick={() => setDeleteId(app.app_id)} className="flex items-center gap-1 text-xs px-3 py-1.5 rounded-lg border border-outline-variant text-danger hover:bg-danger/10 transition-colors">
                      <Trash2 size={13} /> Delete
                    </button>
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      <ApplicationForm open={formOpen} onOpenChange={setFormOpen} onSubmit={submit} initial={editing} />

      <AlertDialog open={!!deleteId} onOpenChange={(o) => !o && setDeleteId(null)}>
        <AlertDialogContent className="bg-surface-mid border-outline-variant text-on-surface">
          <AlertDialogHeader>
            <AlertDialogTitle className="font-heading">Delete application?</AlertDialogTitle>
            <AlertDialogDescription className="text-on-surface-variant">This cannot be undone.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="bg-surface-low border-outline-variant text-on-surface hover:bg-surface-high">Cancel</AlertDialogCancel>
            <AlertDialogAction data-testid="confirm-delete" onClick={confirmDelete} className="bg-danger text-background hover:brightness-110">Delete</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Layout>
  );
}
