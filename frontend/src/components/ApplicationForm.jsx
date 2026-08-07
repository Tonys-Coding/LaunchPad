import { useState, useEffect } from "react";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import { Loader2 } from "lucide-react";
import { CompanyLogo } from "@/components/CompanyLogo";

const STATUSES = ["Applied", "Screening", "Interviewing", "Offer", "Rejected"];
const CONFIDENCE = ["Low", "Medium", "High"];
const PERIODS = [
  { v: "hourly", l: "per hour" },
  { v: "monthly", l: "per month" },
  { v: "yearly", l: "per year" },
];

const empty = {
  company_name: "", job_title: "", day_applied: new Date().toISOString().slice(0, 10),
  expected_start_date: "", start_date_tbd: false, company_domain: "",
  description: "", pay_amount: "", pay_period: "yearly", confidence_level: "", status: "Applied",
};

export function ApplicationForm({ open, onOpenChange, onSubmit, initial }) {
  const [form, setForm] = useState(empty);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (open) {
      setError("");
      setForm(initial ? { ...empty, ...initial, pay_amount: initial.pay_amount ?? "", expected_start_date: initial.expected_start_date || "", confidence_level: initial.confidence_level || "", company_domain: initial.company_domain || "" } : empty);
    }
  }, [open, initial]);

  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));

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
        company_domain: form.company_domain.trim() || null,
        description: form.description.trim() || null,
        pay_amount: form.pay_amount === "" ? null : Number(form.pay_amount),
        pay_period: form.pay_amount === "" ? null : form.pay_period,
        confidence_level: form.confidence_level || null,
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

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="bg-surface-mid border-outline-variant text-on-surface max-w-2xl max-h-[90vh] overflow-y-auto" data-testid="application-form-dialog">
        <DialogHeader>
          <DialogTitle className="font-heading text-2xl flex items-center gap-3">
            <CompanyLogo name={form.company_name || "?"} domain={form.company_domain} size={36} />
            {initial ? "Edit Application" : "New Application"}
          </DialogTitle>
        </DialogHeader>

        {error && <div data-testid="form-error" className="text-sm text-danger bg-danger/10 border border-danger/30 rounded-lg px-3 py-2">{error}</div>}

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className={label}>Company name *</label>
            <input data-testid="form-company-name" className={field} value={form.company_name} onChange={(e) => set("company_name", e.target.value)} placeholder="e.g. Google" />
          </div>
          <div>
            <label className={label}>Job / Internship title *</label>
            <input data-testid="form-job-title" className={field} value={form.job_title} onChange={(e) => set("job_title", e.target.value)} placeholder="e.g. Software Engineer Intern" />
          </div>
          <div>
            <label className={label}>Day applied *</label>
            <input data-testid="form-day-applied" type="date" className={field} value={form.day_applied} onChange={(e) => set("day_applied", e.target.value)} />
          </div>
          <div>
            <label className={label}>Expected start date</label>
            <div className="flex items-center gap-2">
              <input data-testid="form-start-date" type="date" disabled={form.start_date_tbd} className={`${field} disabled:opacity-40`} value={form.expected_start_date} onChange={(e) => set("expected_start_date", e.target.value)} />
              <button type="button" data-testid="form-tbd-toggle" onClick={() => set("start_date_tbd", !form.start_date_tbd)} className={`whitespace-nowrap px-3 py-2.5 rounded-lg text-xs font-semibold border transition-colors ${form.start_date_tbd ? "bg-brand text-on-brand border-brand" : "border-outline-variant text-on-surface-variant"}`}>
                TBD
              </button>
            </div>
          </div>
          <div>
            <label className={label}>Status</label>
            <select data-testid="form-status" className={field} value={form.status} onChange={(e) => set("status", e.target.value)}>
              {STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </div>
          <div>
            <label className={label}>Company website (optional)</label>
            <input data-testid="form-company-domain" className={field} value={form.company_domain} onChange={(e) => set("company_domain", e.target.value)} placeholder="e.g. google.com (for logo)" />
          </div>
          <div>
            <label className={label}>Pay rate (optional)</label>
            <div className="flex gap-2">
              <input data-testid="form-pay-amount" type="number" min="0" className={field} value={form.pay_amount} onChange={(e) => set("pay_amount", e.target.value)} placeholder="Amount" />
              <select data-testid="form-pay-period" className={`${field} w-36`} value={form.pay_period} onChange={(e) => set("pay_period", e.target.value)}>
                {PERIODS.map((p) => <option key={p.v} value={p.v}>{p.l}</option>)}
              </select>
            </div>
          </div>
          <div>
            <label className={label}>Confidence level (optional)</label>
            <select data-testid="form-confidence" className={field} value={form.confidence_level} onChange={(e) => set("confidence_level", e.target.value)}>
              <option value="">—</option>
              {CONFIDENCE.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>
          <div className="sm:col-span-2">
            <label className={label}>Description (optional)</label>
            <textarea data-testid="form-description" rows={3} className={field} value={form.description} onChange={(e) => set("description", e.target.value)} placeholder="Notes, role details, links..." />
          </div>
        </div>

        <DialogFooter className="gap-2">
          <button onClick={() => onOpenChange(false)} className="px-4 py-2.5 rounded-lg text-sm border border-outline-variant text-on-surface-variant hover:bg-surface-low transition-colors" data-testid="form-cancel">
            Cancel
          </button>
          <button onClick={save} disabled={saving} data-testid="form-save" className="px-5 py-2.5 rounded-lg text-sm font-semibold bg-brand text-on-brand hover:brightness-110 active:scale-[0.98] transition-all flex items-center gap-2 disabled:opacity-60">
            {saving && <Loader2 className="animate-spin" size={16} />}
            {initial ? "Save changes" : "Add application"}
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
