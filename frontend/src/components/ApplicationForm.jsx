import { useState, useEffect, useRef } from "react";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from "@/components/ui/dialog";
import { Loader2 } from "lucide-react";
import { CompanyLogo } from "@/components/CompanyLogo";
import { DatePicker } from "@/components/DatePicker";
import { MonthPicker } from "@/components/MonthPicker";

const STATUSES = ["Applied", "Screening", "Interviewing", "Offer", "Rejected"];
const CONFIDENCE = ["Low", "Medium", "High"];
const PERIODS = [
  { v: "hourly", l: "per hour" },
  { v: "monthly", l: "per month" },
  { v: "yearly", l: "per year" },
];

const FormSection = ({ title, children }) => (
  <div className="space-y-3">
    <p className="text-xs font-label uppercase tracking-[0.12em] text-brand/80 border-b border-outline-variant pb-1.5">{title}</p>
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">{children}</div>
  </div>
);

const empty = {
  company_name: "", job_title: "", day_applied: new Date().toISOString().slice(0, 10),
  expected_start_date: "", start_date_tbd: false, start_date_month_only: false, company_domain: "",
  description: "", pay_amount: "", pay_period: "yearly", confidence_level: "",
  follow_up_date: "", interview_day: "", interview_time: "", status: "Applied",
};

export function ApplicationForm({ open, onOpenChange, onSubmit, initial }) {
  const [form, setForm] = useState(empty);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [mode, setMode] = useState("simple");
  const companyInputRef = useRef(null);

  useEffect(() => {
    if (open) {
      setError("");
      setMode(initial ? "advanced" : "simple");
      if (initial) {
        const iv = initial.interview_date || "";
        setForm({
          ...empty, ...initial,
          pay_amount: initial.pay_amount ?? "",
          expected_start_date: initial.expected_start_date || "",
          start_date_month_only: !!initial.start_date_month_only,
          follow_up_date: initial.follow_up_date || "",
          confidence_level: initial.confidence_level || "",
          company_domain: initial.company_domain || "",
          interview_day: iv ? iv.slice(0, 10) : "",
          interview_time: iv && iv.length >= 16 ? iv.slice(11, 16) : "",
        });
      } else {
        setForm(empty);
      }
    }
  }, [open, initial]);

  useEffect(() => {
    if (open) companyInputRef.current?.focus();
  }, [open, mode]);

  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));

  const changeMode = (nextMode) => {
    setMode(nextMode);
  };

  const startMode = form.start_date_tbd ? "tbd" : form.start_date_month_only ? "month" : "exact";
  const setStartMode = (m) =>
    setForm((f) => ({ ...f, start_date_tbd: m === "tbd", start_date_month_only: m === "month", expected_start_date: m === "tbd" ? "" : f.expected_start_date }));

  const save = async () => {
    setError("");
    if (!form.company_name.trim() || !form.job_title.trim() || !form.day_applied) {
      setError("Company name, job title and day applied are required.");
      return;
    }
    setSaving(true);
    try {
      const payload = {
        company_name: form.company_name.trim(),
        job_title: form.job_title.trim(),
        day_applied: form.day_applied,
        expected_start_date: form.start_date_tbd ? null : (form.expected_start_date || null),
        start_date_tbd: form.start_date_tbd,
        start_date_month_only: !form.start_date_tbd && form.start_date_month_only,
        company_domain: form.company_domain.trim() || null,
        description: form.description.trim() || null,
        pay_amount: form.pay_amount === "" ? null : Number(form.pay_amount),
        pay_period: form.pay_amount === "" ? null : form.pay_period,
        confidence_level: form.confidence_level || null,
        follow_up_date: form.follow_up_date || null,
        interview_date: form.interview_day ? `${form.interview_day}T${form.interview_time || "09:00"}:00` : null,
        status: form.status,
      };
      await onSubmit(payload);
      onOpenChange(false);
    } catch (e) {
      setError(e.response?.data?.detail ? String(e.response.data.detail) : "Failed to save. Please try again.");
    } finally {
      setSaving(false);
    }
  };

  const label = "block text-xs font-label uppercase tracking-wider text-on-surface-variant mb-1.5";
  const field = "w-full bg-surface-low border border-outline-variant rounded-lg px-3 py-2.5 text-sm text-on-surface placeholder:text-on-surface-variant focus:border-brand focus:ring-2 focus:ring-brand/30 outline-none transition-all";

  const companyField = (
    <div>
      <label htmlFor="application-company-name" className={label}>Company name *</label>
      <input ref={companyInputRef} id="application-company-name" data-testid="form-company-name" className={field} value={form.company_name} onChange={(e) => set("company_name", e.target.value)} placeholder="e.g. Google" />
    </div>
  );
  const roleField = (
    <div>
      <label htmlFor="application-job-title" className={label}>Job / Internship title *</label>
      <input id="application-job-title" data-testid="form-job-title" className={field} value={form.job_title} onChange={(e) => set("job_title", e.target.value)} placeholder="e.g. Software Engineer Intern" />
    </div>
  );
  const appliedField = (
    <div>
      <label htmlFor="application-day-applied" className={label}>Day applied *</label>
      <DatePicker id="application-day-applied" testid="form-day-applied" value={form.day_applied} onChange={(v) => set("day_applied", v)} placeholder="Select date" />
    </div>
  );
  const descriptionField = (
    <div className="sm:col-span-2">
      <label htmlFor="application-description" className={label}>Description (optional)</label>
      <textarea id="application-description" data-testid="form-description" rows={3} className={field} value={form.description} onChange={(e) => set("description", e.target.value)} placeholder="Notes, role details, links..." />
    </div>
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="!flex max-h-[90vh] max-w-2xl flex-col overflow-hidden border-outline-variant bg-surface-mid text-on-surface outline-none" data-testid="application-form-dialog">
        <DialogHeader className="shrink-0">
          <DialogTitle className="font-heading text-2xl flex items-center gap-3">
            <CompanyLogo name={form.company_name || "?"} domain={form.company_domain} size={36} />
            {initial ? "Edit Application" : "New Application"}
          </DialogTitle>
          <DialogDescription className="sr-only">Enter the company, role, timeline, and optional application details.</DialogDescription>
        </DialogHeader>

        {error && <div data-testid="form-error" className="shrink-0 text-sm text-danger bg-danger/10 border border-danger/30 rounded-lg px-3 py-2">{error}</div>}

        <div className="min-h-0 flex-1 overflow-y-auto pr-1">
          {mode === "simple" ? (
            <div className="space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                {companyField}
                {roleField}
                {appliedField}
              </div>
              {descriptionField}
            </div>
          ) : (
            <div className="space-y-6">
            <FormSection title="Basics">
              {companyField}
              {roleField}
              <div>
                <label htmlFor="application-company-domain" className={label}>Company website (optional)</label>
                <input id="application-company-domain" data-testid="form-company-domain" className={field} value={form.company_domain} onChange={(e) => set("company_domain", e.target.value)} placeholder="e.g. google.com (for logo)" />
              </div>
              <div>
                <label htmlFor="application-status" className={label}>Status</label>
                <select id="application-status" data-testid="form-status" className={field} value={form.status} onChange={(e) => set("status", e.target.value)}>
                  {STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
                </select>
              </div>
            </FormSection>

            <FormSection title="Timeline">
              {appliedField}
              <div>
                <label htmlFor="application-follow-up" className={label}>Follow-up reminder</label>
                <DatePicker id="application-follow-up" testid="form-follow-up" value={form.follow_up_date} onChange={(v) => set("follow_up_date", v)} placeholder="Remind me to follow up" clearable />
              </div>
              <div className="sm:col-span-2">
                <label className={label}>Expected start date</label>
                <div className="flex gap-1 mb-2 bg-surface-low border border-outline-variant rounded-lg p-1 max-w-xs">
                  {[["exact", "Exact"], ["month", "Month"], ["tbd", "TBD"]].map(([m, l]) => (
                    <button key={m} type="button" data-testid={`start-mode-${m}`} onClick={() => setStartMode(m)} className={`flex-1 text-xs font-medium py-1.5 rounded-md transition-colors ${startMode === m ? "bg-brand text-on-brand" : "text-on-surface-variant hover:text-on-surface"}`}>
                      {l}
                    </button>
                  ))}
                </div>
                {startMode === "exact" && <div className="max-w-xs"><DatePicker id="application-start-date" testid="form-start-date" value={form.expected_start_date} onChange={(v) => set("expected_start_date", v)} placeholder="Select date" clearable /></div>}
                {startMode === "month" && <div className="max-w-xs"><MonthPicker id="application-start-month" testid="form-start-month" value={form.expected_start_date} onChange={(v) => set("expected_start_date", v)} placeholder="Select month (e.g. Jun 2027)" clearable /></div>}
                {startMode === "tbd" && <p className="text-sm text-on-surface-variant px-1 py-2">To be determined</p>}
              </div>
            </FormSection>

            <FormSection title="Interview">
              <div>
                <label htmlFor="application-interview-date" className={label}>Interview date</label>
                <DatePicker id="application-interview-date" testid="form-interview-date" value={form.interview_day} onChange={(v) => set("interview_day", v)} placeholder="Interview day" clearable />
              </div>
              <div>
                <label htmlFor="application-interview-time" className={label}>Interview time</label>
                <input id="application-interview-time" data-testid="form-interview-time" type="time" className={field} value={form.interview_time} onChange={(e) => set("interview_time", e.target.value)} disabled={!form.interview_day} />
              </div>
            </FormSection>

            <FormSection title="Compensation & Confidence">
              <div>
                <label htmlFor="application-pay-amount" className={label}>Pay rate</label>
                <div className="flex gap-2">
                  <input id="application-pay-amount" data-testid="form-pay-amount" type="number" min="0" className={field} value={form.pay_amount} onChange={(e) => set("pay_amount", e.target.value)} placeholder="Amount" />
                  <select aria-label="Pay period" data-testid="form-pay-period" className={`${field} w-36`} value={form.pay_period} onChange={(e) => set("pay_period", e.target.value)}>
                    {PERIODS.map((p) => <option key={p.v} value={p.v}>{p.l}</option>)}
                  </select>
                </div>
              </div>
              <div>
                <label htmlFor="application-confidence" className={label}>Confidence level</label>
                <select id="application-confidence" data-testid="form-confidence" className={field} value={form.confidence_level} onChange={(e) => set("confidence_level", e.target.value)}>
                  <option value="">—</option>
                  {CONFIDENCE.map((c) => <option key={c} value={c}>{c}</option>)}
                </select>
              </div>
            </FormSection>

            <FormSection title="Details">
              {descriptionField}
            </FormSection>
            </div>
          )}
        </div>

        <DialogFooter className="shrink-0 flex-col sm:flex-row sm:items-center sm:justify-between gap-3 border-t border-outline-variant pt-4">
          <div className="flex bg-surface-low border border-outline-variant rounded-lg p-1" data-testid="form-mode-tabs">
            {[["simple", "Simple"], ["advanced", "Advanced"]].map(([m, l]) => (
              <button key={m} type="button" data-testid={`form-mode-${m}`} onClick={() => changeMode(m)} className={`px-4 py-1.5 text-xs font-semibold rounded-md transition-colors ${mode === m ? "bg-brand text-on-brand" : "text-on-surface-variant hover:text-on-surface"}`}>
                {l}
              </button>
            ))}
          </div>
          <div className="flex gap-2">
            <button onClick={() => onOpenChange(false)} className="px-4 py-2.5 rounded-lg text-sm border border-outline-variant text-on-surface-variant hover:bg-surface-low transition-colors" data-testid="form-cancel">
              Cancel
            </button>
            <button onClick={save} disabled={saving} data-testid="form-save" className="px-5 py-2.5 rounded-lg text-sm font-semibold bg-brand text-on-brand hover:brightness-110 active:scale-[0.98] transition-all flex items-center gap-2 disabled:opacity-60">
              {saving && <Loader2 className="animate-spin" size={16} />}
              {initial ? "Save changes" : "Add application"}
            </button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
