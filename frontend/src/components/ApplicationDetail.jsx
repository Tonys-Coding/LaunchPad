import { useState, useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { format, parseISO } from "date-fns";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { CompanyLogo } from "@/components/CompanyLogo";
import { statusColors, confColors, formatStartDate, formatInterview } from "@/lib/constants";
import { useTheme } from "@/context/ThemeContext";
import { Calendar, DollarSign, Gauge, CalendarClock, Pencil, Trash2, Send, Sparkles, WandSparkles, ArrowRight, StickyNote, Loader2, Paperclip, FileText, Download, Upload } from "lucide-react";
import { toast } from "sonner";
import api from "@/lib/api";

const API_BASE = "/api";

function ActivityRow({ ev, sc }) {
  const at = ev.at ? format(parseISO(ev.at), "MMM d, p") : "";
  if (ev.type === "created") {
    return (
      <div className="flex gap-3">
        <span className="w-7 h-7 rounded-full bg-brand/20 text-brand flex items-center justify-center shrink-0"><Sparkles size={14} /></span>
        <div><p className="text-sm text-on-surface">Application created</p><p className="text-xs text-on-surface-variant">{at}</p></div>
      </div>
    );
  }
  if (ev.type === "status") {
    return (
      <div className="flex gap-3">
        <span className="w-7 h-7 rounded-full bg-cyan-container/20 text-cyan flex items-center justify-center shrink-0"><ArrowRight size={14} /></span>
        <div className="text-sm">
          <p className="flex items-center gap-1.5 flex-wrap">
            <span className="text-on-surface-variant">Status</span>
            <span className="font-medium px-1.5 py-0.5 rounded" style={{ color: sc[ev.from], backgroundColor: (sc[ev.from] || "#888") + "22" }}>{ev.from}</span>
            <ArrowRight size={12} className="text-on-surface-variant" />
            <span className="font-medium px-1.5 py-0.5 rounded" style={{ color: sc[ev.to], backgroundColor: (sc[ev.to] || "#888") + "22" }}>{ev.to}</span>
          </p>
          <p className="text-xs text-on-surface-variant mt-0.5">{at}</p>
        </div>
      </div>
    );
  }
  return (
    <div className="flex gap-3">
      <span className="w-7 h-7 rounded-full bg-orange/20 text-orange flex items-center justify-center shrink-0"><StickyNote size={14} /></span>
      <div><p className="text-sm text-on-surface whitespace-pre-wrap">{ev.text}</p><p className="text-xs text-on-surface-variant">{at}</p></div>
    </div>
  );
}

export function ApplicationDetail({ open, onOpenChange, app, onEdit, onDelete, onChanged }) {
  const navigate = useNavigate();
  const { theme } = useTheme();
  const STATUS_COLORS = statusColors(theme);
  const CONF_COLORS = confColors(theme);
  const [local, setLocal] = useState(app);
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);
  const [uploadingKind, setUploadingKind] = useState(null);
  const fileRef = useRef(null);
  const pendingKind = useRef("other");

  useEffect(() => { setLocal(app); setNote(""); }, [app, open]);
  if (!local) return null;

  const addNote = async () => {
    if (!note.trim()) return;
    setSaving(true);
    try {
      const { data } = await api.post(`/applications/${local.app_id}/notes`, { text: note.trim() });
      setLocal(data);
      setNote("");
      onChanged?.();
    } finally {
      setSaving(false);
    }
  };

  const pickFile = (kind) => { pendingKind.current = kind; fileRef.current?.click(); };

  const onFile = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setUploadingKind(pendingKind.current);
    try {
      const fd = new FormData();
      fd.append("kind", pendingKind.current);
      fd.append("file", file);
      const { data } = await api.post(`/applications/${local.app_id}/attachments`, fd, { headers: { "Content-Type": "multipart/form-data" } });
      setLocal(data);
      onChanged?.();
      toast.success("File attached");
    } catch {
      toast.error("Upload failed. Please try again.");
    } finally {
      setUploadingKind(null);
    }
  };

  const removeAttachment = async (attId) => {
    try {
      const { data } = await api.delete(`/applications/${local.app_id}/attachments/${attId}`);
      setLocal(data);
      onChanged?.();
      toast.success("Attachment removed");
    } catch {
      toast.error("Could not remove attachment");
    }
  };

  const KIND_LABEL = { resume: "Resume", job_description: "Job description", other: "File" };
  const attachments = local.attachments || [];

  const activity = [...(local.activity || [])].reverse();
  const interview = formatInterview(local.interview_date);
  const payLabel = local.pay_amount ? `$${Number(local.pay_amount).toLocaleString()}${local.pay_period === "hourly" ? "/hr" : local.pay_period === "monthly" ? "/mo" : "/yr"}` : null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="bg-surface-mid border-outline-variant text-on-surface max-w-2xl max-h-[90vh] overflow-y-auto" data-testid="application-detail">
        <DialogTitle className="sr-only">{local.job_title} at {local.company_name}</DialogTitle>
        <div className="flex items-start gap-4">
          <CompanyLogo name={local.company_name} domain={local.company_domain} size={52} />
          <div className="flex-1 min-w-0">
            <h2 className="font-heading text-2xl font-bold truncate">{local.job_title}</h2>
            <p className="text-on-surface-variant">{local.company_name}</p>
          </div>
          <span className="text-xs font-semibold px-2.5 py-1 rounded-full" style={{ backgroundColor: `${STATUS_COLORS[local.status]}22`, color: STATUS_COLORS[local.status] }}>
            {local.status}
          </span>
        </div>

        <div className="grid grid-cols-2 gap-3 mt-2">
          <Info icon={Calendar} label="Applied" value={local.day_applied} />
          <Info icon={Calendar} label="Expected start" value={formatStartDate(local)} />
          {payLabel && <Info icon={DollarSign} label="Pay" value={payLabel} />}
          {local.confidence_level && <Info icon={Gauge} label="Confidence" value={local.confidence_level} color={CONF_COLORS[local.confidence_level]} />}
          {interview && <Info icon={CalendarClock} label="Interview" value={interview} color={STATUS_COLORS.Interviewing} />}
        </div>

        {local.description && (
          <div className="bg-surface-low border border-outline-variant rounded-lg p-3 mt-1">
            <p className="text-sm text-on-surface-variant whitespace-pre-wrap">{local.description}</p>
          </div>
        )}

        <div className="flex gap-2">
          <button onClick={() => { onOpenChange(false); navigate(`/resumes?application=${encodeURIComponent(local.app_id)}`); }} className="flex items-center gap-1.5 text-sm px-3 py-2 rounded-lg bg-brand text-on-brand hover:brightness-110 transition-all">
            <WandSparkles size={14} /> Tailor Resume
          </button>
          <button data-testid="detail-edit" onClick={() => { onOpenChange(false); onEdit?.(local); }} className="flex items-center gap-1.5 text-sm px-3 py-2 rounded-lg border border-outline-variant text-cyan hover:bg-surface-low transition-colors">
            <Pencil size={14} /> Edit
          </button>
          <button data-testid="detail-delete" onClick={() => { onOpenChange(false); onDelete?.(local); }} className="flex items-center gap-1.5 text-sm px-3 py-2 rounded-lg border border-outline-variant text-danger hover:bg-danger/10 transition-colors">
            <Trash2 size={14} /> Delete
          </button>
        </div>

        <div className="border-t border-outline-variant pt-4">
          <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
            <h3 className="font-heading text-lg font-semibold flex items-center gap-2"><Paperclip size={18} className="text-brand" /> Attachments</h3>
            <div className="flex gap-2">
              <button data-testid="attach-resume" onClick={() => pickFile("resume")} disabled={!!uploadingKind} className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg border border-outline-variant text-cyan hover:bg-surface-low transition-colors disabled:opacity-50">
                {uploadingKind === "resume" ? <Loader2 className="animate-spin" size={13} /> : <Upload size={13} />} Resume
              </button>
              <button data-testid="attach-jd" onClick={() => pickFile("job_description")} disabled={!!uploadingKind} className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg border border-outline-variant text-cyan hover:bg-surface-low transition-colors disabled:opacity-50">
                {uploadingKind === "job_description" ? <Loader2 className="animate-spin" size={13} /> : <Upload size={13} />} Job description
              </button>
            </div>
          </div>
          <input ref={fileRef} type="file" accept=".pdf,.doc,.docx,.txt,.rtf,.png,.jpg,.jpeg" onChange={onFile} className="hidden" data-testid="attachment-input" />
          {attachments.length === 0 ? (
            <p className="text-sm text-on-surface-variant">No files attached yet. Add your resume or the job description.</p>
          ) : (
            <div className="space-y-2" data-testid="attachment-list">
              {attachments.map((att) => (
                <div key={att.id} data-testid={`attachment-${att.id}`} className="flex items-center gap-3 p-2.5 rounded-lg bg-surface-low border border-outline-variant">
                  <span className="w-8 h-8 rounded-lg bg-brand/15 text-brand flex items-center justify-center shrink-0"><FileText size={16} /></span>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium truncate">{att.name}</p>
                    <p className="text-[11px] text-on-surface-variant">{KIND_LABEL[att.kind] || "File"} · {Math.max(1, Math.round((att.size || 0) / 1024))} KB</p>
                  </div>
                  <a href={`${API_BASE}/applications/${local.app_id}/attachments/${att.id}`} target="_blank" rel="noopener noreferrer" data-testid={`attachment-download-${att.id}`} className="text-on-surface-variant hover:text-brand p-1.5" title="Open / download">
                    <Download size={16} />
                  </a>
                  <button onClick={() => removeAttachment(att.id)} data-testid={`attachment-delete-${att.id}`} className="text-on-surface-variant hover:text-danger p-1.5" title="Remove">
                    <Trash2 size={16} />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="border-t border-outline-variant pt-4">
          <h3 className="font-heading text-lg font-semibold mb-3">Notes &amp; Timeline</h3>
          <div className="flex gap-2 mb-4">
            <textarea
              data-testid="detail-note-input"
              rows={2}
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Add a note (e.g. recruiter call, next steps)..."
              className="flex-1 bg-surface-low border border-outline-variant rounded-lg px-3 py-2 text-sm text-on-surface placeholder:text-on-surface-variant focus:border-brand focus:ring-2 focus:ring-brand/30 outline-none resize-none"
            />
            <button data-testid="detail-note-save" onClick={addNote} disabled={saving || !note.trim()} className="self-end bg-brand text-on-brand rounded-lg px-3 py-2 font-semibold flex items-center gap-1.5 disabled:opacity-50 hover:brightness-110 transition-all">
              {saving ? <Loader2 className="animate-spin" size={16} /> : <Send size={16} />}
            </button>
          </div>
          <div className="space-y-4" data-testid="detail-timeline">
            {activity.length === 0 && <p className="text-sm text-on-surface-variant">No activity yet.</p>}
            {activity.map((ev, i) => <ActivityRow key={i} ev={ev} sc={STATUS_COLORS} />)}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function Info({ icon: Icon, label, value, color }) {
  return (
    <div className="bg-surface-low border border-outline-variant rounded-lg px-3 py-2">
      <p className="text-[10px] uppercase tracking-wider text-on-surface-variant flex items-center gap-1"><Icon size={12} /> {label}</p>
      <p className="text-sm font-medium mt-0.5" style={color ? { color } : undefined}>{value}</p>
    </div>
  );
}
