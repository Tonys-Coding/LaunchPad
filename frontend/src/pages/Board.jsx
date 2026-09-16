import { useEffect, useState, useCallback } from "react";
import { Layout } from "@/components/Layout";
import { ApplicationForm } from "@/components/ApplicationForm";
import { ApplicationDetail } from "@/components/ApplicationDetail";
import { CompanyLogo } from "@/components/CompanyLogo";
import { STATUSES, statusColors, followUpState, followUpColor } from "@/lib/constants";
import { useTheme } from "@/context/ThemeContext";
import { DollarSign, Clock, AlertTriangle, GripVertical, CalendarClock, Loader2, RefreshCw } from "lucide-react";
import {
  AlertDialog, AlertDialogContent, AlertDialogHeader, AlertDialogTitle,
  AlertDialogDescription, AlertDialogFooter, AlertDialogCancel, AlertDialogAction,
} from "@/components/ui/alert-dialog";
import { toast } from "sonner";
import api from "@/lib/api";

export default function Board() {
  const { theme } = useTheme();
  const STATUS_COLORS = statusColors(theme);
  const [apps, setApps] = useState([]);
  const [dragId, setDragId] = useState(null);
  const [overCol, setOverCol] = useState(null);
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [detailApp, setDetailApp] = useState(null);
  const [detailOpen, setDetailOpen] = useState(false);
  const [deleteId, setDeleteId] = useState(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError("");
    try {
      const { data } = await api.get("/applications");
      setApps(data);
      setDetailApp((d) => (d ? data.find((a) => a.app_id === d.app_id) || d : d));
    } catch {
      setLoadError("Board applications could not be loaded. Your saved data was not changed.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const submitApp = async (payload) => {
    if (editing) await api.put(`/applications/${editing.app_id}`, payload);
    else await api.post("/applications", payload);
    await load();
  };

  const openNew = () => { setEditing(null); setFormOpen(true); };
  const openDetail = (app) => { setDetailApp(app); setDetailOpen(true); };
  const doDelete = async () => { await api.delete(`/applications/${deleteId}`); setDeleteId(null); toast.success("Application deleted"); await load(); };

  const moveTo = async (status) => {
    const id = dragId;
    setDragId(null);
    setOverCol(null);
    if (!id) return;
    const app = apps.find((a) => a.app_id === id);
    if (!app || app.status === status) return;
    setApps((prev) => prev.map((a) => (a.app_id === id ? { ...a, status } : a)));
    try {
      await api.put(`/applications/${id}`, { ...app, status });
      toast.success(`${app.company_name} → ${status}`);
      await load();
    } catch {
      toast.error("Failed to move application");
      load();
    }
  };

  return (
    <Layout title="Board" onAddApplication={openNew} wide>
      <p className="lp-eyebrow mb-6">// Drag applications between columns to update their status</p>

      {loading ? <div className="flex min-h-72 items-center justify-center text-on-surface-variant" role="status"><Loader2 size={25} className="mr-2 animate-spin" />Loading board...</div>
      : loadError ? <div className="flex min-h-72 flex-col items-center justify-center text-center" role="alert" data-testid="board-load-error"><AlertTriangle size={27} className="mb-3 text-danger" /><p className="text-sm text-danger">{loadError}</p><button type="button" onClick={load} className="lp-chamfer-button mt-4 flex items-center gap-2 border border-outline-variant px-4 py-2 text-sm font-semibold hover:bg-surface-high"><RefreshCw size={14} />Try again</button></div>
      : <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4" data-testid="kanban-board">
        {STATUSES.map((status) => {
          const items = apps.filter((a) => a.status === status);
          const color = STATUS_COLORS[status];
          return (
            <div
              key={status}
              data-testid={`column-${status}`}
              onDragOver={(e) => { e.preventDefault(); setOverCol(status); }}
              onDragLeave={() => setOverCol((c) => (c === status ? null : c))}
              onDrop={() => moveTo(status)}
              className={`lp-panel lp-chamfer-tr flex flex-col border transition-colors ${
                overCol === status ? "border-brand bg-surface-mid" : "border-surface-highest bg-surface-low"
              }`}
            >
              <div className="flex items-center justify-between px-4 py-3 border-b border-outline-variant">
                <div className="flex items-center gap-2">
                  <span className="h-2 w-2" style={{ backgroundColor: color }} />
                  <h3 className="font-heading text-sm font-semibold uppercase tracking-wider text-on-surface">{status}</h3>
                </div>
                <span className="lp-chamfer-chip bg-surface-highest px-2 py-0.5 text-xs text-on-surface-variant">{items.length}</span>
              </div>

              <div className="p-3 space-y-3 min-h-[140px] flex-1">
                {items.length === 0 && (
                  <p className="text-xs text-on-surface-variant text-center py-8">Drop here</p>
                )}
                {items.map((app) => {
                  const fu = followUpState(app);
                  return (
                    <div
                      key={app.app_id}
                      draggable
                      onDragStart={() => setDragId(app.app_id)}
                      onDragEnd={() => { setDragId(null); setOverCol(null); }}
                      onClick={() => openDetail(app)}
                      onKeyDown={(event) => {
                        if (event.target !== event.currentTarget || !["Enter", " "].includes(event.key)) return;
                        event.preventDefault();
                        openDetail(app);
                      }}
                      role="button"
                      tabIndex={0}
                      aria-label={`Open ${app.job_title} at ${app.company_name}. Drag to change status.`}
                      data-testid={`board-card-${app.app_id}`}
                      className={`lp-surface-hover lp-chamfer-sm group cursor-grab border border-surface-highest bg-surface-mid p-3 transition-all hover:border-brand/40 active:cursor-grabbing ${
                        dragId === app.app_id ? "opacity-50" : ""
                      }`}
                    >
                      <div className="flex items-start gap-2.5">
                        <CompanyLogo name={app.company_name} domain={app.company_domain} size={34} />
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium text-on-surface truncate">{app.job_title}</p>
                          <p className="text-xs text-on-surface-variant truncate">{app.company_name}</p>
                        </div>
                        <GripVertical size={15} className="text-outline opacity-0 transition-opacity group-hover:opacity-100 group-focus:opacity-100" />
                      </div>
                      <div className="flex flex-wrap items-center gap-2 mt-2.5 text-[11px] text-on-surface-variant">
                        {app.pay_amount ? (
                          <span className="flex items-center gap-0.5"><DollarSign size={11} />{Number(app.pay_amount).toLocaleString()}{app.pay_period === "hourly" ? "/hr" : app.pay_period === "monthly" ? "/mo" : "/yr"}</span>
                        ) : null}
                        {app.interview_date && (
                          <span className="flex items-center gap-0.5 text-cyan"><CalendarClock size={11} /> interview</span>
                        )}
                        {fu && (
                          <span
                            className="flex items-center gap-0.5 font-medium px-1.5 py-0.5 rounded"
                            style={{
                              color: followUpColor(fu.level, theme),
                              backgroundColor: followUpColor(fu.level, theme) + "22",
                            }}
                          >
                            {fu.level === "overdue" ? <AlertTriangle size={11} /> : <Clock size={11} />}
                            {fu.level === "overdue" ? `${fu.days}d overdue` : fu.level === "soon" ? `follow up ${fu.days === 0 ? "today" : fu.days + "d"}` : `${fu.days}d`}
                          </span>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>}

      <ApplicationForm open={formOpen} onOpenChange={setFormOpen} onSubmit={submitApp} initial={editing} />
      <ApplicationDetail
        open={detailOpen}
        onOpenChange={setDetailOpen}
        app={detailApp}
        onChanged={load}
        onEdit={(app) => { setEditing(app); setFormOpen(true); }}
        onDelete={(app) => setDeleteId(app.app_id)}
      />
      <AlertDialog open={!!deleteId} onOpenChange={(o) => !o && setDeleteId(null)}>
        <AlertDialogContent className="bg-surface-mid border-outline-variant text-on-surface">
          <AlertDialogHeader>
            <AlertDialogTitle className="font-heading">Delete application?</AlertDialogTitle>
            <AlertDialogDescription className="text-on-surface-variant">This cannot be undone.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="bg-surface-low border-outline-variant text-on-surface hover:bg-surface-high">Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={doDelete} className="bg-danger text-background hover:brightness-110">Delete</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Layout>
  );
}
