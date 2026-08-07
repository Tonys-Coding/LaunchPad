import { useEffect, useState, useCallback } from "react";
import { Layout } from "@/components/Layout";
import { ApplicationForm } from "@/components/ApplicationForm";
import { CompanyLogo } from "@/components/CompanyLogo";
import { STATUSES, STATUS_COLORS, followUpState } from "@/lib/constants";
import { DollarSign, Clock, AlertTriangle, GripVertical } from "lucide-react";
import { toast } from "sonner";
import api from "@/lib/api";

export default function Board() {
  const [apps, setApps] = useState([]);
  const [dragId, setDragId] = useState(null);
  const [overCol, setOverCol] = useState(null);
  const [formOpen, setFormOpen] = useState(false);

  const load = useCallback(async () => {
    const { data } = await api.get("/applications");
    setApps(data);
  }, []);

  useEffect(() => { load(); }, [load]);

  const createApp = async (payload) => { await api.post("/applications", payload); await load(); };

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
    } catch {
      toast.error("Failed to move application");
      load();
    }
  };

  return (
    <Layout title="Board" onAddApplication={() => setFormOpen(true)}>
      <p className="text-on-surface-variant mb-6 text-sm">Drag applications between columns to update their status.</p>

      <div className="flex gap-4 overflow-x-auto pb-4 -mx-1 px-1" data-testid="kanban-board">
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
              className={`flex-shrink-0 w-72 rounded-xl border transition-colors ${
                overCol === status ? "border-brand bg-surface-mid" : "border-surface-highest bg-surface-low"
              }`}
            >
              <div className="flex items-center justify-between px-4 py-3 border-b border-outline-variant">
                <div className="flex items-center gap-2">
                  <span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: color }} />
                  <h3 className="font-heading font-semibold text-on-surface">{status}</h3>
                </div>
                <span className="text-xs text-on-surface-variant bg-surface-highest rounded-full px-2 py-0.5">{items.length}</span>
              </div>

              <div className="p-3 space-y-3 min-h-[120px]">
                {items.length === 0 && (
                  <p className="text-xs text-on-surface-variant text-center py-6">Drop here</p>
                )}
                {items.map((app) => {
                  const fu = followUpState(app);
                  return (
                    <div
                      key={app.app_id}
                      draggable
                      onDragStart={() => setDragId(app.app_id)}
                      onDragEnd={() => { setDragId(null); setOverCol(null); }}
                      data-testid={`board-card-${app.app_id}`}
                      className={`group bg-surface-mid border border-surface-highest rounded-lg p-3 cursor-grab active:cursor-grabbing hover:border-brand/40 transition-all ${
                        dragId === app.app_id ? "opacity-50" : ""
                      }`}
                    >
                      <div className="flex items-start gap-2.5">
                        <CompanyLogo name={app.company_name} domain={app.company_domain} size={34} />
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium text-on-surface truncate">{app.job_title}</p>
                          <p className="text-xs text-on-surface-variant truncate">{app.company_name}</p>
                        </div>
                        <GripVertical size={15} className="text-outline opacity-0 group-hover:opacity-100 transition-opacity" />
                      </div>
                      <div className="flex flex-wrap items-center gap-2 mt-2.5 text-[11px] text-on-surface-variant">
                        {app.pay_amount ? (
                          <span className="flex items-center gap-0.5"><DollarSign size={11} />{Number(app.pay_amount).toLocaleString()}{app.pay_period === "hourly" ? "/hr" : app.pay_period === "monthly" ? "/mo" : "/yr"}</span>
                        ) : null}
                        {fu && (
                          <span
                            className="flex items-center gap-0.5 font-medium px-1.5 py-0.5 rounded"
                            style={{
                              color: fu.level === "overdue" ? "#ffb4ab" : fu.level === "soon" ? "#ffb596" : "#7bd0ff",
                              backgroundColor: (fu.level === "overdue" ? "#ffb4ab" : fu.level === "soon" ? "#ffb596" : "#7bd0ff") + "22",
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
      </div>

      <ApplicationForm open={formOpen} onOpenChange={setFormOpen} onSubmit={createApp} />
    </Layout>
  );
}
