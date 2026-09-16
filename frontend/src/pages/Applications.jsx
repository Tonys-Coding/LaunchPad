import { useEffect, useState, useCallback, useMemo, useRef } from "react";
import { Plus, Search, Pencil, Trash2, DollarSign, Calendar, Gauge, Download, Upload, Clock, AlertTriangle, CalendarClock, CheckCircle2, FileSpreadsheet, Loader2 } from "lucide-react";
import { Layout } from "@/components/Layout";
import { ApplicationForm } from "@/components/ApplicationForm";
import { ApplicationDetail } from "@/components/ApplicationDetail";
import { CompanyLogo } from "@/components/CompanyLogo";
import { followUpState, formatStartDate, formatInterview, statusColors, confColors, followUpColor } from "@/lib/constants";
import { useTheme } from "@/context/ThemeContext";
import { toCSV, parseCSV, downloadCSV } from "@/lib/csv";
import {
  AlertDialog, AlertDialogContent, AlertDialogHeader, AlertDialogTitle,
  AlertDialogDescription, AlertDialogFooter, AlertDialogCancel, AlertDialogAction,
} from "@/components/ui/alert-dialog";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { toast } from "sonner";
import api from "@/lib/api";
import { useSearchParams } from "react-router-dom";

const CSV_HEADERS = [
  "company_name", "job_title", "day_applied", "expected_start_date", "start_date_tbd",
  "follow_up_date", "status", "pay_amount", "pay_period", "confidence_level", "company_domain", "description",
];

const REQUIRED_CSV_HEADERS = ["company_name", "job_title", "day_applied"];
const CSV_COLUMN_RULES = [
  ["company_name", "Required", "Company or employer name"],
  ["job_title", "Required", "Position or role title"],
  ["day_applied", "Required", "Date in YYYY-MM-DD format"],
  ["expected_start_date", "Optional", "Date in YYYY-MM-DD format"],
  ["start_date_tbd", "Optional", "true, false, 1, 0, yes, no, or tbd"],
  ["follow_up_date", "Optional", "Date in YYYY-MM-DD format"],
  ["status", "Optional", "Applied, Screening, Interviewing, Offer, or Rejected"],
  ["pay_amount", "Optional", "Number without a currency symbol"],
  ["pay_period", "Optional", "hourly, monthly, or yearly"],
  ["confidence_level", "Optional", "Low, Medium, or High"],
  ["company_domain", "Optional", "Company website, such as google.com"],
  ["description", "Optional", "Notes or application details"],
];

const VALID_STATUSES = new Set(["Applied", "Screening", "Interviewing", "Offer", "Rejected"]);
const VALID_PAY_PERIODS = new Set(["hourly", "monthly", "yearly"]);
const VALID_CONFIDENCE = new Set(["Low", "Medium", "High"]);
const VALID_BOOLEAN_VALUES = new Set(["", "true", "false", "1", "0", "yes", "no", "tbd"]);

function validIsoDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

export function applicationImportPreview(text) {
  const rows = parseCSV(text);
  if (rows.length < 2) throw new Error("This CSV does not contain any application rows.");
  const header = rows[0].map((value, index) => (index === 0 ? value.replace(/^\uFEFF/, "") : value).trim());
  const missingHeaders = REQUIRED_CSV_HEADERS.filter((name) => !header.includes(name));
  if (missingHeaders.length) throw new Error(`Missing required column${missingHeaders.length === 1 ? "" : "s"}: ${missingHeaders.join(", ")}`);
  const index = (name) => header.indexOf(name);
  const items = [];
  const skipped = [];

  for (let rowIndex = 1; rowIndex < rows.length; rowIndex++) {
    const row = rows[rowIndex];
    const get = (name) => {
      const columnIndex = index(name);
      return columnIndex >= 0 ? (row[columnIndex] ?? "").trim() : "";
    };
    const company = get("company_name");
    const title = get("job_title");
    const applied = get("day_applied");
    const expectedStart = get("expected_start_date");
    const followUp = get("follow_up_date");
    const status = get("status");
    const payRaw = get("pay_amount");
    const payPeriod = get("pay_period");
    const confidence = get("confidence_level");
    const tbdRaw = get("start_date_tbd").toLowerCase();
    const problems = [];
    if (!company) problems.push("company_name is missing");
    if (!title) problems.push("job_title is missing");
    if (!applied) problems.push("day_applied is missing");
    else if (!validIsoDate(applied)) problems.push("day_applied must use YYYY-MM-DD");
    if (expectedStart && !validIsoDate(expectedStart)) problems.push("expected_start_date must use YYYY-MM-DD");
    if (followUp && !validIsoDate(followUp)) problems.push("follow_up_date must use YYYY-MM-DD");
    if (status && !VALID_STATUSES.has(status)) problems.push("status is not supported");
    if (payRaw && (!Number.isFinite(Number(payRaw)) || Number(payRaw) < 0)) problems.push("pay_amount must be a positive number");
    if (payPeriod && !VALID_PAY_PERIODS.has(payPeriod)) problems.push("pay_period is not supported");
    if (confidence && !VALID_CONFIDENCE.has(confidence)) problems.push("confidence_level is not supported");
    if (!VALID_BOOLEAN_VALUES.has(tbdRaw)) problems.push("start_date_tbd is not supported");
    if (problems.length) {
      skipped.push({ row: rowIndex + 1, reason: problems.join("; ") });
      continue;
    }
    items.push({
      company_name: company,
      job_title: title,
      day_applied: applied,
      expected_start_date: expectedStart || null,
      start_date_tbd: /^(true|1|yes|tbd)$/i.test(tbdRaw),
      follow_up_date: followUp || null,
      status: status || "Applied",
      pay_amount: payRaw ? Number(payRaw) : null,
      pay_period: payPeriod || (payRaw ? "yearly" : null),
      confidence_level: confidence || null,
      company_domain: get("company_domain") || null,
      description: get("description") || null,
    });
  }
  return { items, skipped, totalRows: rows.length - 1 };
}

const FILTERS = ["All", "Applied", "Screening", "Interviewing", "Offer", "Rejected"];

function payLabel(app) {
  if (!app.pay_amount) return null;
  const suffix = app.pay_period === "hourly" ? "/hr" : app.pay_period === "monthly" ? "/mo" : "/yr";
  return `$${Number(app.pay_amount).toLocaleString()}${suffix}`;
}

export default function Applications() {
  const [searchParams, setSearchParams] = useSearchParams();
  const { theme } = useTheme();
  const STATUS_COLORS = statusColors(theme);
  const CONF_COLORS = confColors(theme);
  const [apps, setApps] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [deleteId, setDeleteId] = useState(null);
  const [detailApp, setDetailApp] = useState(null);
  const [detailOpen, setDetailOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState("All");
  const [importOpen, setImportOpen] = useState(false);
  const [importFile, setImportFile] = useState(null);
  const [importPreview, setImportPreview] = useState(null);
  const [importError, setImportError] = useState("");
  const [importing, setImporting] = useState(false);
  const fileRef = useRef(null);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError("");
    try {
      const { data } = await api.get("/applications");
      setApps(data);
      setDetailApp((d) => (d ? data.find((a) => a.app_id === d.app_id) || d : d));
    } catch {
      setLoadError("Applications could not be loaded. Your saved data was not changed.");
      toast.error("Failed to load applications");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    const requested = searchParams.get("open");
    if (!requested || apps.length === 0) return;
    const match = apps.find((item) => item.app_id === requested);
    if (match) {
      setDetailApp(match);
      setDetailOpen(true);
      setSearchParams({}, { replace: true });
    }
  }, [apps, searchParams, setSearchParams]);

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
  const openDetail = (app) => { setDetailApp(app); setDetailOpen(true); };

  const exportCsv = () => {
    if (apps.length === 0) { toast.error("Nothing to export"); return; }
    const csv = toCSV(CSV_HEADERS, apps);
    downloadCSV(`launchpad-applications-${new Date().toISOString().slice(0, 10)}.csv`, csv);
    toast.success(`Exported ${apps.length} applications`);
  };

  const openImporter = () => {
    setImportFile(null);
    setImportPreview(null);
    setImportError("");
    setImportOpen(true);
  };

  const selectImportCsv = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setImportFile(file);
    setImportPreview(null);
    setImportError("");
    if (!file.name.toLowerCase().endsWith(".csv")) {
      setImportError("Choose a CSV file.");
      return;
    }
    try {
      const text = await file.text();
      setImportPreview(applicationImportPreview(text));
    } catch (failure) {
      setImportError(failure.message || "This CSV could not be read.");
    }
  };

  const confirmImport = async () => {
    if (!importPreview?.items.length) return;
    setImporting(true);
    setImportError("");
    try {
      const { data } = await api.post("/applications/bulk", importPreview.items);
      toast.success(`Imported ${data.created} application${data.created === 1 ? "" : "s"}`);
      setImportOpen(false);
      await load();
    } catch {
      setImportError("The applications could not be imported. Please try again.");
    } finally {
      setImporting(false);
    }
  };

  const downloadImportTemplate = () => {
    const sample = {
      company_name: "Example Company", job_title: "Software Engineer Intern", day_applied: "2026-09-10",
      expected_start_date: "2027-05-20", start_date_tbd: false, follow_up_date: "2026-09-17",
      status: "Applied", pay_amount: 25, pay_period: "hourly", confidence_level: "High",
      company_domain: "example.com", description: "Applied through the company website",
    };
    downloadCSV("launchpad-application-import-template.csv", toCSV(CSV_HEADERS, [sample]));
  };

  return (
    <Layout title="Applications" onAddApplication={openNew}>
      {/* Controls */}
      <div className="flex flex-col sm:flex-row gap-3 mb-6">
        <div className="relative flex-1">
          <Search size={18} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-on-surface-variant" />
          <input
            data-testid="applications-search"
            aria-label="Search applications by company or role"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search company or role..."
            className="lp-chamfer-button w-full border border-outline-variant bg-surface-low py-2.5 pl-11 pr-4 text-on-surface outline-none placeholder:text-on-surface-variant focus:border-brand focus:ring-2 focus:ring-brand/30"
          />
        </div>
        <button onClick={openNew} data-testid="applications-add-button" className="lp-chamfer-button flex items-center justify-center gap-2 bg-brand px-5 py-2.5 font-semibold text-on-brand transition-all hover:brightness-110 active:scale-[0.98]">
          <Plus size={18} /> Add Application
        </button>
        <button onClick={exportCsv} title="Download all applications as a CSV file" data-testid="applications-export" className="lp-chamfer-button flex items-center justify-center gap-2 border border-outline-variant px-4 py-2.5 font-semibold text-on-surface transition-colors hover:bg-surface-mid">
          <Download size={18} /> Export CSV
        </button>
        <button onClick={openImporter} data-testid="applications-import" className="lp-chamfer-button flex items-center justify-center gap-2 border border-outline-variant px-4 py-2.5 font-semibold text-on-surface transition-colors hover:bg-surface-mid">
          <Upload size={18} /> Import
        </button>
      </div>

      {/* Filter chips */}
      <div className="flex flex-wrap gap-2 mb-6">
        {FILTERS.map((f) => (
          <button
            key={f}
            data-testid={`filter-${f.toLowerCase()}`}
            aria-pressed={filter === f}
            onClick={() => setFilter(f)}
            className={`lp-chamfer-chip border px-4 py-1.5 text-sm font-medium transition-colors ${
              filter === f ? "bg-brand text-on-brand" : "bg-surface-low text-on-surface-variant border border-outline-variant hover:border-brand/40"
            }`}
          >
            {f}
          </button>
        ))}
      </div>

      {/* List */}
      {loading ? (
        <div className="text-center py-20 text-on-surface-variant" role="status">Loading applications...</div>
      ) : loadError ? (
        <div className="flex flex-col items-center py-20 text-center" role="alert" data-testid="applications-load-error">
          <AlertTriangle size={26} className="mb-3 text-danger" />
          <p className="text-sm text-danger">{loadError}</p>
          <button type="button" onClick={load} className="lp-chamfer-button mt-4 border border-outline-variant px-4 py-2 text-sm font-semibold hover:bg-surface-high">Try again</button>
        </div>
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
              onClick={() => openDetail(app)}
              onKeyDown={(event) => {
                if (event.target !== event.currentTarget || !["Enter", " "].includes(event.key)) return;
                event.preventDefault();
                openDetail(app);
              }}
              role="button"
              tabIndex={0}
              aria-label={`Open ${app.job_title} at ${app.company_name}`}
              className="lp-panel lp-panel-hover lp-chamfer-tr lp-crosshair group cursor-pointer p-5 animate-fade-up"
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
                    <span className="lp-chamfer-chip shrink-0 px-2.5 py-1 text-xs font-semibold uppercase tracking-wide" style={{ backgroundColor: `${STATUS_COLORS[app.status]}22`, color: STATUS_COLORS[app.status] }}>
                      {app.status}
                    </span>
                  </div>

                  <div className="flex flex-wrap gap-x-4 gap-y-1.5 mt-3 text-xs text-on-surface-variant">
                    <span className="flex items-center gap-1"><Calendar size={13} /> Applied {app.day_applied}</span>
                    <span className="flex items-center gap-1"><Calendar size={13} /> Start {formatStartDate(app)}</span>
                    {app.interview_date && (
                      <span className="flex items-center gap-1 text-cyan"><CalendarClock size={13} /> {formatInterview(app.interview_date)}</span>
                    )}
                    {payLabel(app) && <span className="flex items-center gap-1"><DollarSign size={13} /> {payLabel(app)}</span>}
                    {app.confidence_level && (
                      <span className="flex items-center gap-1" style={{ color: CONF_COLORS[app.confidence_level] }}>
                        <Gauge size={13} /> {app.confidence_level}
                      </span>
                    )}
                    {(() => {
                      const fu = followUpState(app);
                      if (!fu) return null;
                      const c = followUpColor(fu.level, theme);
                      return (
                        <span data-testid={`followup-${app.app_id}`} className="flex items-center gap-1 font-medium px-1.5 py-0.5 rounded" style={{ color: c, backgroundColor: c + "22" }}>
                          {fu.level === "overdue" ? <AlertTriangle size={12} /> : <Clock size={12} />}
                          {fu.level === "overdue" ? `Follow up ${fu.days}d overdue` : fu.level === "soon" ? `Follow up ${fu.days === 0 ? "today" : "in " + fu.days + "d"}` : `Follow up in ${fu.days}d`}
                        </span>
                      );
                    })()}
                  </div>

                  {app.description && <p className="text-sm text-on-surface-variant mt-3 line-clamp-2">{app.description}</p>}

                  <div className="mt-4 flex gap-2 opacity-100 transition-opacity sm:opacity-0 sm:group-hover:opacity-100 sm:group-focus-within:opacity-100">
                    <button data-testid={`edit-${app.app_id}`} onClick={(e) => { e.stopPropagation(); openEdit(app); }} className="lp-chamfer-chip flex items-center gap-1 border border-outline-variant px-3 py-1.5 text-xs text-cyan transition-colors hover:bg-surface-mid">
                      <Pencil size={13} /> Edit
                    </button>
                    <button data-testid={`delete-${app.app_id}`} onClick={(e) => { e.stopPropagation(); setDeleteId(app.app_id); }} className="lp-chamfer-chip flex items-center gap-1 border border-outline-variant px-3 py-1.5 text-xs text-danger transition-colors hover:bg-danger/10">
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

      <ApplicationDetail
        open={detailOpen}
        onOpenChange={setDetailOpen}
        app={detailApp}
        onChanged={load}
        onEdit={(app) => openEdit(app)}
        onDelete={(app) => setDeleteId(app.app_id)}
      />

      <Dialog
        open={importOpen}
        onOpenChange={(open) => {
          if (importing) return;
          setImportOpen(open);
          if (!open) {
            setImportFile(null);
            setImportPreview(null);
            setImportError("");
          }
        }}
      >
        <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto border-outline-variant bg-surface-mid text-on-surface" data-testid="applications-import-dialog">
          <DialogHeader>
            <div className="mb-3 flex items-center gap-3">
              <div className="lp-chamfer-icon flex h-11 w-11 shrink-0 items-center justify-center border border-outline-variant bg-surface-low text-cyan">
                <FileSpreadsheet size={22} />
              </div>
              <div>
                <DialogTitle className="font-heading text-xl">Import applications</DialogTitle>
                <DialogDescription className="mt-1 text-on-surface-variant">
                  Upload a CSV with one application per row.
                </DialogDescription>
              </div>
            </div>
          </DialogHeader>

          <div className="space-y-4">
            <div className="lp-panel border border-outline-variant bg-surface-low p-4">
              <div className="flex flex-wrap items-center gap-2">
                <span className="lp-chamfer-chip bg-brand px-2.5 py-1 text-xs font-semibold uppercase tracking-wide text-on-brand">CSV files only</span>
                <span className="text-sm text-on-surface-variant">Required columns</span>
              </div>
              <div className="mt-3 flex flex-wrap gap-2">
                {REQUIRED_CSV_HEADERS.map((header) => (
                  <code key={header} className="lp-chamfer-chip border border-outline-variant bg-surface-mid px-2.5 py-1 text-xs text-on-surface">
                    {header}
                  </code>
                ))}
              </div>
            </div>

            <Accordion type="single" collapsible className="border-y border-outline-variant">
              <AccordionItem value="columns" className="border-0">
                <AccordionTrigger className="px-1 font-heading text-sm font-semibold hover:no-underline">View all supported columns</AccordionTrigger>
                <AccordionContent className="pb-4">
                  <div className="overflow-hidden border border-outline-variant">
                    {CSV_COLUMN_RULES.map(([name, requirement, details], index) => (
                      <div key={name} className={`grid gap-1 px-3 py-2.5 sm:grid-cols-[minmax(0,1fr)_85px_minmax(0,1.5fr)] ${index ? "border-t border-outline-variant" : ""}`}>
                        <code className="text-xs text-on-surface">{name}</code>
                        <span className={`text-xs font-semibold ${requirement === "Required" ? "text-cyan" : "text-on-surface-variant"}`}>{requirement}</span>
                        <span className="text-xs text-on-surface-variant">{details}</span>
                      </div>
                    ))}
                  </div>
                </AccordionContent>
              </AccordionItem>
            </Accordion>

            <div className="grid gap-3 sm:grid-cols-2">
              <button type="button" onClick={downloadImportTemplate} className="lp-chamfer-button flex items-center justify-center gap-2 border border-outline-variant px-4 py-3 font-semibold text-on-surface transition-colors hover:bg-surface-high">
                <Download size={17} /> Download CSV template
              </button>
              <button type="button" onClick={() => fileRef.current?.click()} className="lp-chamfer-button flex items-center justify-center gap-2 bg-brand px-4 py-3 font-semibold text-on-brand transition-all hover:brightness-110">
                <Upload size={17} /> {importFile ? "Choose another CSV" : "Choose CSV file"}
              </button>
              <input ref={fileRef} type="file" accept=".csv,text/csv" onChange={selectImportCsv} className="hidden" data-testid="applications-import-input" />
            </div>

            {importFile && (
              <div className="flex items-center gap-2 text-sm text-on-surface-variant">
                <FileSpreadsheet size={16} className="text-cyan" />
                <span className="truncate">{importFile.name}</span>
              </div>
            )}

            {importError && (
              <div role="alert" className="flex items-start gap-2 border border-danger/40 bg-danger/10 p-3 text-sm text-danger">
                <AlertTriangle size={17} className="mt-0.5 shrink-0" />
                <span>{importError}</span>
              </div>
            )}

            {importPreview && (
              <div className="space-y-3" data-testid="applications-import-preview">
                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="lp-panel flex items-center gap-3 border border-cyan/40 bg-cyan/10 p-4">
                    <CheckCircle2 size={21} className="shrink-0 text-cyan" />
                    <div>
                      <p className="font-heading text-lg font-semibold text-on-surface">{importPreview.items.length}</p>
                      <p className="text-xs text-on-surface-variant">Valid {importPreview.items.length === 1 ? "application" : "applications"}</p>
                    </div>
                  </div>
                  <div className="lp-panel flex items-center gap-3 border border-orange/40 bg-orange/10 p-4">
                    <AlertTriangle size={21} className="shrink-0 text-orange" />
                    <div>
                      <p className="font-heading text-lg font-semibold text-on-surface">{importPreview.skipped.length}</p>
                      <p className="text-xs text-on-surface-variant">Skipped {importPreview.skipped.length === 1 ? "row" : "rows"}</p>
                    </div>
                  </div>
                </div>

                {importPreview.skipped.length > 0 && (
                  <div className="border border-outline-variant bg-surface-low p-3">
                    <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-on-surface">Rows that will be skipped</p>
                    <div className="max-h-36 space-y-1.5 overflow-y-auto pr-1 text-xs text-on-surface-variant">
                      {importPreview.skipped.slice(0, 8).map((item) => (
                        <p key={`${item.row}-${item.reason}`}><span className="font-semibold text-orange">Row {item.row}</span> — {item.reason}</p>
                      ))}
                      {importPreview.skipped.length > 8 && <p>+ {importPreview.skipped.length - 8} more</p>}
                    </div>
                  </div>
                )}

                {importPreview.items.length === 0 && (
                  <p className="text-sm text-on-surface-variant">No applications are ready to import. Correct the skipped rows and choose the file again.</p>
                )}
              </div>
            )}
          </div>

          <DialogFooter className="mt-2 gap-2 sm:gap-0">
            <button type="button" disabled={importing} onClick={() => setImportOpen(false)} className="lp-chamfer-button border border-outline-variant px-4 py-2.5 font-semibold text-on-surface transition-colors hover:bg-surface-high disabled:opacity-50">
              Cancel
            </button>
            <button
              type="button"
              disabled={!importPreview?.items.length || importing}
              onClick={confirmImport}
              data-testid="applications-import-confirm"
              className="lp-chamfer-button flex items-center justify-center gap-2 bg-brand px-4 py-2.5 font-semibold text-on-brand transition-all hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-40"
            >
              {importing && <Loader2 size={17} className="animate-spin" />}
              {importing ? "Importing..." : `Import ${importPreview?.items.length || 0} application${importPreview?.items.length === 1 ? "" : "s"}`}
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

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
