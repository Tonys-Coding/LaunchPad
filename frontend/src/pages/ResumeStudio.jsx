import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import {
  AlertTriangle, ArrowRight, BookOpenCheck, Check, ChevronDown,
  Copy, Download, FileCheck2, FileText, Gauge, Import,
  LibraryBig, Loader2, Pencil, Plus, RefreshCw, Save,
  Paperclip, Sparkles, Trash2, UserRound, WandSparkles, X,
} from "lucide-react";
import { toast } from "sonner";
import { Layout } from "@/components/Layout";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import api, { formatApiErrorDetail } from "@/lib/api";

const fieldClass = "w-full border border-outline-variant bg-surface-low px-3 py-2.5 text-sm text-on-surface outline-none transition-colors placeholder:text-outline focus:border-brand";
const labelClass = "mb-1.5 block text-xs font-semibold uppercase tracking-wider text-on-surface-variant";
const emptyContent = { summary: "", skills: [], experience: [], projects: [], education: [], accomplishments: [], certifications: [] };
const sectionLabels = {
  experience: "Experience", projects: "Projects", education: "Education",
  accomplishments: "Accomplishments", certifications: "Certifications",
};

function uid(prefix) {
  return `${prefix}_${Math.random().toString(36).slice(2, 11)}`;
}

function cleanResume(resume) {
  return {
    name: resume?.name || "",
    template: resume?.template || "standard",
    is_default: resume?.is_default || false,
    content: { ...emptyContent, ...(resume?.content || {}) },
  };
}

function libraryEntry(record) {
  const bullet = record.resume_bullet || record.outcome || record.description || "";
  return {
    item_id: uid("ritem"), title: record.title, organization: record.organization || "",
    location: "", start_date: record.start_date || "", end_date: record.end_date || "",
    current: Boolean(record.current), bullets: bullet ? [bullet] : [], link: record.link || "",
    source_id: record.experience_id, source_updated_at: record.updated_at || null,
  };
}

function sectionForLibraryType(type) {
  if (type === "Project") return "projects";
  if (type === "Accomplishment") return "accomplishments";
  if (type === "Education") return "education";
  return "experience";
}

function ProgressBar({ value }) {
  return <div className="h-1.5 overflow-hidden bg-surface-high"><div className="h-full bg-brand transition-all" style={{ width: `${Math.min(100, Math.max(0, value))}%` }} /></div>;
}

function SetupCard({ icon: Icon, title, detail, complete, onClick }) {
  return <button onClick={onClick} className="lp-panel lp-panel-hover lp-chamfer-tr flex min-h-32 items-start gap-3 p-4 text-left">
    <span className={`lp-icon-frame flex h-10 w-10 shrink-0 items-center justify-center border ${complete ? "border-brand bg-brand text-on-brand" : "border-outline-variant bg-surface-mid text-on-surface-variant"}`}>{complete ? <Check size={18} /> : <Icon size={18} />}</span>
    <span><span className="font-heading text-base font-bold">{title}</span><span className="mt-1 block text-sm leading-5 text-on-surface-variant">{detail}</span></span>
  </button>;
}

function ProfileDialog({ open, onOpenChange, profile, onSaved }) {
  const [form, setForm] = useState(profile || {});
  const [saving, setSaving] = useState(false);
  useEffect(() => { if (open) setForm({ ...profile, education: profile?.education || [] }); }, [open, profile]);
  const update = (key, value) => setForm((current) => ({ ...current, [key]: value }));
  const addEducation = () => update("education", [...(form.education || []), { education_id: uid("edu"), school: "", degree: "", field: "", location: "", start_date: "", end_date: "", details: [] }]);
  const updateEducation = (index, key, value) => update("education", form.education.map((item, slot) => slot === index ? { ...item, [key]: value } : item));
  const submit = async (event) => {
    event.preventDefault(); setSaving(true);
    try {
      const payload = { ...form, education: (form.education || []).filter((item) => item.school.trim()) };
      await api.put("/resume-profile", payload);
      toast.success("Resume profile saved"); onOpenChange(false); await onSaved();
    } catch (failure) { toast.error(formatApiErrorDetail(failure.response?.data?.detail)); }
    finally { setSaving(false); }
  };
  return <Dialog open={open} onOpenChange={onOpenChange}><DialogContent className="max-h-[92vh] overflow-y-auto border-outline-variant bg-surface-mid text-on-surface sm:max-w-3xl">
    <DialogHeader><DialogTitle className="font-heading text-xl">Resume Profile</DialogTitle></DialogHeader>
    <form onSubmit={submit} className="grid gap-5">
      <p className="text-sm leading-6 text-on-surface-variant">These contact details are used only on resumes. They can differ from the account you use to sign in.</p>
      <div className="grid gap-4 sm:grid-cols-2">
        <label><span className={labelClass}>Full name</span><input required maxLength={120} className={fieldClass} value={form.full_name || ""} onChange={(e) => update("full_name", e.target.value)} /></label>
        <label><span className={labelClass}>Resume email</span><input type="email" className={fieldClass} value={form.preferred_email || ""} onChange={(e) => update("preferred_email", e.target.value)} /></label>
        <label><span className={labelClass}>Phone</span><input className={fieldClass} value={form.phone || ""} onChange={(e) => update("phone", e.target.value)} /></label>
        <label><span className={labelClass}>City</span><input className={fieldClass} value={form.city || ""} onChange={(e) => update("city", e.target.value)} /></label>
        <label><span className={labelClass}>State / region</span><input className={fieldClass} value={form.region || ""} onChange={(e) => update("region", e.target.value)} /></label>
        <label><span className={labelClass}>Country</span><input className={fieldClass} value={form.country || ""} onChange={(e) => update("country", e.target.value)} /></label>
        <label><span className={labelClass}>LinkedIn</span><input type="url" placeholder="https://linkedin.com/in/..." className={fieldClass} value={form.linkedin || ""} onChange={(e) => update("linkedin", e.target.value)} /></label>
        <label><span className={labelClass}>GitHub</span><input type="url" placeholder="https://github.com/..." className={fieldClass} value={form.github || ""} onChange={(e) => update("github", e.target.value)} /></label>
        <label className="sm:col-span-2"><span className={labelClass}>Portfolio</span><input type="url" placeholder="https://..." className={fieldClass} value={form.portfolio || ""} onChange={(e) => update("portfolio", e.target.value)} /></label>
      </div>
      <div className="border-t border-outline-variant pt-4">
        <div className="mb-3 flex items-center justify-between"><h3 className="font-heading font-bold">Education</h3><button type="button" onClick={addEducation} className="lp-chamfer-button flex items-center gap-1.5 border border-outline-variant px-3 py-2 text-sm hover:bg-surface-high"><Plus size={14} /> Add school</button></div>
        <div className="space-y-3">{(form.education || []).map((item, index) => <div key={item.education_id || index} className="grid gap-3 border border-outline-variant bg-surface-low p-3 sm:grid-cols-2">
          <label><span className={labelClass}>School</span><input required className={fieldClass} value={item.school} onChange={(e) => updateEducation(index, "school", e.target.value)} /></label>
          <label><span className={labelClass}>Degree</span><input className={fieldClass} value={item.degree || ""} onChange={(e) => updateEducation(index, "degree", e.target.value)} /></label>
          <label><span className={labelClass}>Field of study</span><input className={fieldClass} value={item.field || ""} onChange={(e) => updateEducation(index, "field", e.target.value)} /></label>
          <label><span className={labelClass}>Location</span><input className={fieldClass} value={item.location || ""} onChange={(e) => updateEducation(index, "location", e.target.value)} /></label>
          <label><span className={labelClass}>Started</span><input type="month" className={fieldClass} value={(item.start_date || "").slice(0, 7)} onChange={(e) => updateEducation(index, "start_date", e.target.value)} /></label>
          <label><span className={labelClass}>Graduated / expected</span><input type="month" className={fieldClass} value={(item.end_date || "").slice(0, 7)} onChange={(e) => updateEducation(index, "end_date", e.target.value)} /></label>
          <button type="button" onClick={() => update("education", form.education.filter((_, slot) => slot !== index))} className="justify-self-start text-xs font-semibold text-danger">Remove school</button>
        </div>)}</div>
      </div>
      <div className="flex justify-end gap-2"><button type="button" onClick={() => onOpenChange(false)} className="lp-chamfer-button border border-outline-variant px-4 py-2.5 text-sm font-semibold">Cancel</button><button disabled={saving} className="lp-chamfer-button flex items-center gap-2 bg-brand px-4 py-2.5 text-sm font-semibold text-on-brand disabled:opacity-50">{saving && <Loader2 size={15} className="animate-spin" />}Save profile</button></div>
    </form>
  </DialogContent></Dialog>;
}

function EntryEditor({ entry, onChange, onRemove, sourceRecord, sourceChanged, onRefresh }) {
  const update = (key, value) => onChange({ ...entry, [key]: value });
  return <div className="border border-outline-variant bg-surface-low p-3">
    {entry.source_id && <div className={`mb-3 flex flex-wrap items-center justify-between gap-2 border-l-2 px-3 py-2 text-xs ${sourceRecord ? sourceChanged ? "border-orange bg-orange/5 text-orange" : "border-brand bg-brand/5 text-on-surface-variant" : "border-outline bg-surface-mid text-on-surface-variant"}`}><span>{sourceRecord ? sourceChanged ? "The Career Library source has changed. Your resume copy has not been changed." : "Copied from Career Library. This resume keeps its own snapshot." : "The original Career Library record is no longer available. Your resume copy is unchanged."}</span>{sourceChanged && <button type="button" onClick={onRefresh} className="flex items-center gap-1 font-semibold text-on-surface hover:text-brand"><RefreshCw size={12} />Refresh copy</button>}</div>}
    <div className="mb-3 flex items-start justify-between gap-3"><div className="grid flex-1 gap-3 sm:grid-cols-2"><label><span className={labelClass}>Title</span><input required className={fieldClass} value={entry.title || ""} onChange={(e) => update("title", e.target.value)} /></label><label><span className={labelClass}>Organization</span><input className={fieldClass} value={entry.organization || ""} onChange={(e) => update("organization", e.target.value)} /></label></div><button type="button" onClick={onRemove} className="mt-6 p-2 text-on-surface-variant hover:text-danger" title="Remove"><Trash2 size={16} /></button></div>
    <div className="grid gap-3 sm:grid-cols-3"><label><span className={labelClass}>Location</span><input className={fieldClass} value={entry.location || ""} onChange={(e) => update("location", e.target.value)} /></label><label><span className={labelClass}>Started</span><input type="month" className={fieldClass} value={(entry.start_date || "").slice(0, 7)} onChange={(e) => update("start_date", e.target.value)} /></label><label><span className={labelClass}>Ended</span><input type="month" disabled={entry.current} className={`${fieldClass} disabled:opacity-40`} value={(entry.end_date || "").slice(0, 7)} onChange={(e) => update("end_date", e.target.value)} /></label></div>
    <label className="mt-2 flex items-center gap-2 text-sm text-on-surface-variant"><input type="checkbox" checked={entry.current || false} onChange={(e) => update("current", e.target.checked)} /> Current</label>
    <label className="mt-3 block"><span className={labelClass}>Resume bullets <span className="normal-case tracking-normal text-outline">(one per line)</span></span><textarea rows={4} className={fieldClass} value={(entry.bullets || []).join("\n")} onChange={(e) => update("bullets", e.target.value.split("\n"))} placeholder="Action + work + outcome" /></label>
  </div>;
}

function ResumeEditor({ open, onOpenChange, resume, library, profile, initialLibraryItem, onSaved }) {
  const [form, setForm] = useState(cleanResume(resume));
  const [saving, setSaving] = useState(false);
  const [openSections, setOpenSections] = useState({ experience: true });
  useEffect(() => {
    if (!open) return;
    const next = cleanResume(resume);
    if (!resume && profile?.education?.length) {
      next.content.education = profile.education.map((item) => ({
        item_id: uid("ritem"), title: [item.degree, item.field].filter(Boolean).join(" in ") || "Education",
        organization: item.school, location: item.location || "", start_date: item.start_date || "",
        end_date: item.end_date || "", current: false, bullets: item.details || [], link: "",
      }));
    }
    if (initialLibraryItem) {
      if (initialLibraryItem.kind === "skill") next.content.skills.push({ item_id: uid("rskill"), name: initialLibraryItem.item.name, category: initialLibraryItem.item.category, source_id: initialLibraryItem.item.skill_id, source_updated_at: initialLibraryItem.item.updated_at });
      else next.content[sectionForLibraryType(initialLibraryItem.item.type)].push(libraryEntry(initialLibraryItem.item));
    }
    setForm(next);
  }, [open, resume, initialLibraryItem]); // eslint-disable-line react-hooks/exhaustive-deps
  const updateContent = (key, value) => setForm((current) => ({ ...current, content: { ...current.content, [key]: value } }));
  const addEntry = (section, record) => updateContent(section, [...form.content[section], record ? libraryEntry(record) : { item_id: uid("ritem"), title: "", organization: "", location: "", start_date: "", end_date: "", current: false, bullets: [], link: "" }]);
  const addSkill = (skill) => {
    if (!skill || form.content.skills.some((item) => item.source_id === skill.skill_id || item.name.toLowerCase() === skill.name.toLowerCase())) return;
    updateContent("skills", [...form.content.skills, { item_id: uid("rskill"), name: skill.name, category: skill.category, source_id: skill.skill_id, source_updated_at: skill.updated_at }]);
  };
  const refreshSkill = (index, source) => updateContent("skills", form.content.skills.map((item, slot) => slot === index ? { ...item, name: source.name, category: source.category, source_updated_at: source.updated_at } : item));
  const refreshEntry = (section, index, source) => {
    const refreshed = libraryEntry(source);
    updateContent(section, form.content[section].map((item, slot) => slot === index ? { ...refreshed, item_id: item.item_id } : item));
  };
  const submit = async (event) => {
    event.preventDefault(); setSaving(true);
    try {
      if (resume?.resume_id) await api.put(`/resumes/${resume.resume_id}`, form);
      else await api.post("/resumes", form);
      toast.success(resume ? "Master resume updated" : "Master resume created"); onOpenChange(false); await onSaved();
    } catch (failure) { toast.error(formatApiErrorDetail(failure.response?.data?.detail)); }
    finally { setSaving(false); }
  };
  return <Dialog open={open} onOpenChange={onOpenChange}><DialogContent className="max-h-[94vh] overflow-y-auto border-outline-variant bg-surface-mid text-on-surface sm:max-w-4xl">
    <DialogHeader><DialogTitle className="font-heading text-xl">{resume ? "Edit master resume" : "Create master resume"}</DialogTitle></DialogHeader>
    <form onSubmit={submit} className="space-y-5">
      <div className="grid gap-3 sm:grid-cols-[1fr_180px]"><label><span className={labelClass}>Resume name</span><input required autoFocus maxLength={100} className={fieldClass} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="e.g. Software Engineering" /></label><label><span className={labelClass}>Template</span><select className={fieldClass} value={form.template} onChange={(e) => setForm({ ...form, template: e.target.value })}><option value="standard">Standard</option><option value="compact">Compact</option></select></label></div>
      <label className="flex items-center gap-2 text-sm text-on-surface-variant"><input type="checkbox" checked={form.is_default} onChange={(e) => setForm({ ...form, is_default: e.target.checked })} /> Use as my default master resume</label>
      <label className="block"><span className={labelClass}>Professional summary</span><textarea rows={5} maxLength={3000} className={fieldClass} value={form.content.summary} onChange={(e) => updateContent("summary", e.target.value)} placeholder="A concise, factual summary of your background and direction" /></label>
      <section className="border border-outline-variant bg-surface-low p-3">
        <div className="flex items-center justify-between"><h3 className="font-heading font-bold">Skills</h3><select aria-label="Add a Career Library skill" className={`${fieldClass} max-w-64`} value="" onChange={(e) => addSkill(library.skills.find((skill) => skill.skill_id === e.target.value))}><option value="">Add from Career Library…</option>{library.skills.map((skill) => <option key={skill.skill_id} value={skill.skill_id}>{skill.name}</option>)}</select></div>
        <div className="mt-3 flex flex-wrap gap-2">{form.content.skills.map((skill, index) => {
          const source = skill.source_id ? library.skills.find((item) => item.skill_id === skill.source_id) : null;
          const changed = Boolean(source && source.updated_at && source.updated_at !== skill.source_updated_at);
          return <span key={skill.item_id} className={`lp-chamfer-chip flex items-center gap-1.5 border bg-surface-mid px-2.5 py-1.5 text-sm ${changed ? "border-orange" : "border-outline-variant"}`}>{skill.name}{changed && <button type="button" onClick={() => refreshSkill(index, source)} className="flex items-center gap-1 text-xs font-semibold text-orange" title="Refresh from Career Library"><RefreshCw size={12} />Updated</button>}<button type="button" onClick={() => updateContent("skills", form.content.skills.filter((_, slot) => slot !== index))} aria-label={`Remove ${skill.name}`}><X size={13} /></button></span>;
        })}<button type="button" onClick={() => { const name = window.prompt("Skill name"); if (name?.trim()) updateContent("skills", [...form.content.skills, { item_id: uid("rskill"), name: name.trim() }]); }} className="lp-chamfer-chip border border-dashed border-outline px-2.5 py-1.5 text-sm text-on-surface-variant"><Plus size={13} className="mr-1 inline" />Custom skill</button></div>
      </section>
      {Object.entries(sectionLabels).map(([section, label]) => {
        const records = library.experiences.filter((item) => sectionForLibraryType(item.type) === section);
        const expanded = openSections[section] || form.content[section].length > 0;
        return <section key={section} className="border border-outline-variant bg-surface-low">
          <button type="button" onClick={() => setOpenSections((current) => ({ ...current, [section]: !expanded }))} className="flex w-full items-center justify-between px-3 py-3 text-left"><span className="font-heading font-bold">{label} <span className="text-sm font-normal text-on-surface-variant">({form.content[section].length})</span></span><ChevronDown size={17} className={expanded ? "rotate-180" : ""} /></button>
          {expanded && <div className="space-y-3 border-t border-outline-variant p-3">{form.content[section].map((entry, index) => {
            const source = entry.source_id ? library.experiences.find((item) => item.experience_id === entry.source_id) : null;
            return <EntryEditor key={entry.item_id} entry={entry} sourceRecord={source} sourceChanged={Boolean(source && source.updated_at && source.updated_at !== entry.source_updated_at)} onRefresh={() => refreshEntry(section, index, source)} onChange={(next) => updateContent(section, form.content[section].map((item, slot) => slot === index ? next : item))} onRemove={() => updateContent(section, form.content[section].filter((_, slot) => slot !== index))} />;
          })}<div className="flex flex-wrap gap-2"><button type="button" onClick={() => addEntry(section)} className="lp-chamfer-button flex items-center gap-1.5 border border-outline-variant px-3 py-2 text-sm"><Plus size={14} /> Add manually</button>{records.length > 0 && <select aria-label={`Add ${label} from Career Library`} className={`${fieldClass} max-w-72`} value="" onChange={(e) => addEntry(section, records.find((item) => item.experience_id === e.target.value))}><option value="">Add from Career Library…</option>{records.map((record) => <option key={record.experience_id} value={record.experience_id}>{record.title}</option>)}</select>}</div></div>}
        </section>;
      })}
      <div className="flex justify-end gap-2"><button type="button" onClick={() => onOpenChange(false)} className="lp-chamfer-button border border-outline-variant px-4 py-2.5 text-sm font-semibold">Cancel</button><button disabled={saving} className="lp-chamfer-button flex items-center gap-2 bg-brand px-4 py-2.5 text-sm font-semibold text-on-brand disabled:opacity-50">{saving ? <Loader2 size={15} className="animate-spin" /> : <Save size={15} />}{resume ? "Save changes" : "Create resume"}</button></div>
    </form>
  </DialogContent></Dialog>;
}

function ImportDialog({ open, onOpenChange, onSaved, aiAvailable }) {
  const [file, setFile] = useState(null); const [name, setName] = useState("Imported resume"); const [template, setTemplate] = useState("standard"); const [improve, setImprove] = useState(false); const [saving, setSaving] = useState(false);
  useEffect(() => { if (open) { setFile(null); setName("Imported resume"); setTemplate("standard"); setImprove(false); } }, [open]);
  const submit = async (event) => { event.preventDefault(); if (!file) return; setSaving(true); try { const body = new FormData(); body.append("file", file); body.append("name", name); body.append("template", template); body.append("improve_with_ai", String(improve)); const { data } = await api.post("/resumes/import", body, { headers: { "Content-Type": "multipart/form-data" } }); toast.success(data.ai_improved ? "Resume imported and organized with AI" : "Resume imported"); onOpenChange(false); await onSaved(); } catch (failure) { toast.error(formatApiErrorDetail(failure.response?.data?.detail)); } finally { setSaving(false); } };
  return <Dialog open={open} onOpenChange={onOpenChange}><DialogContent className="border-outline-variant bg-surface-mid text-on-surface sm:max-w-lg"><DialogHeader><DialogTitle className="font-heading text-xl">Import a resume</DialogTitle></DialogHeader><form onSubmit={submit} className="space-y-4"><p className="text-sm leading-6 text-on-surface-variant">Import a text-based PDF, DOCX, or TXT file up to 5 MB and 10 pages. You will review the structured result before using it.</p><label><span className={labelClass}>Source file</span><input required type="file" accept=".pdf,.docx,.txt" onChange={(e) => { const picked = e.target.files?.[0] || null; setFile(picked); if (picked) setName(picked.name.replace(/\.[^.]+$/, "")); }} className={fieldClass} /></label><label><span className={labelClass}>Master resume name</span><input required className={fieldClass} value={name} onChange={(e) => setName(e.target.value)} /></label><label><span className={labelClass}>Template</span><select className={fieldClass} value={template} onChange={(e) => setTemplate(e.target.value)}><option value="standard">Standard</option><option value="compact">Compact</option></select></label><label className={`flex items-start gap-2 border border-outline-variant bg-surface-low p-3 text-sm ${aiAvailable ? "" : "opacity-60"}`}><input type="checkbox" className="mt-1" disabled={!aiAvailable} checked={improve} onChange={(e) => setImprove(e.target.checked)} /><span><span className="font-semibold">Improve organization with AI</span><span className="mt-1 block text-on-surface-variant">{aiAvailable ? "Sends extracted text—not the original file—to Gemini and uses one monthly AI action." : "Unavailable because Gemini is not configured. Local resume parsing still works."}</span></span></label><div className="flex justify-end gap-2"><button type="button" onClick={() => onOpenChange(false)} className="lp-chamfer-button border border-outline-variant px-4 py-2.5 text-sm">Cancel</button><button disabled={!file || saving} className="lp-chamfer-button flex items-center gap-2 bg-brand px-4 py-2.5 text-sm font-semibold text-on-brand disabled:opacity-50">{saving ? <Loader2 size={15} className="animate-spin" /> : <Import size={15} />}Import</button></div></form></DialogContent></Dialog>;
}

function TailorDialog({ open, onOpenChange, resume, applications, initialApplicationId, onCreated }) {
  const [mode, setMode] = useState("application"); const [applicationId, setApplicationId] = useState(""); const [manual, setManual] = useState({ job_title: "", company: "", job_description: "" }); const [saving, setSaving] = useState(false);
  useEffect(() => { if (open) { setApplicationId(initialApplicationId || ""); setManual({ job_title: "", company: "", job_description: "" }); } }, [open, initialApplicationId]);
  const submit = async (event) => { event.preventDefault(); setSaving(true); try { const payload = mode === "application" ? { application_id: applicationId } : manual; const { data } = await api.post(`/resumes/${resume.resume_id}/tailor`, payload); toast.success("Tailoring suggestions are ready to review"); onOpenChange(false); onCreated(data); } catch (failure) { toast.error(formatApiErrorDetail(failure.response?.data?.detail)); } finally { setSaving(false); } };
  return <Dialog open={open} onOpenChange={onOpenChange}><DialogContent className="border-outline-variant bg-surface-mid text-on-surface sm:max-w-2xl"><DialogHeader><DialogTitle className="font-heading text-xl">Tailor {resume?.name}</DialogTitle></DialogHeader><form onSubmit={submit} className="space-y-4"><div className="grid grid-cols-2 border border-outline-variant bg-surface-low p-1"><button type="button" onClick={() => setMode("application")} className={`px-3 py-2 text-sm font-semibold ${mode === "application" ? "bg-brand text-on-brand" : "text-on-surface-variant"}`}>Existing application</button><button type="button" onClick={() => setMode("manual")} className={`px-3 py-2 text-sm font-semibold ${mode === "manual" ? "bg-brand text-on-brand" : "text-on-surface-variant"}`}>Paste a job description</button></div>{mode === "application" ? <label><span className={labelClass}>Application</span><select required className={fieldClass} value={applicationId} onChange={(e) => setApplicationId(e.target.value)}><option value="">Choose an application…</option>{applications.map((app) => <option key={app.app_id} value={app.app_id}>{app.job_title} — {app.company_name}{!app.description ? " (description needed)" : ""}</option>)}</select></label> : <div className="grid gap-3"><div className="grid gap-3 sm:grid-cols-2"><label><span className={labelClass}>Job title</span><input className={fieldClass} value={manual.job_title} onChange={(e) => setManual({ ...manual, job_title: e.target.value })} /></label><label><span className={labelClass}>Company</span><input className={fieldClass} value={manual.company} onChange={(e) => setManual({ ...manual, company: e.target.value })} /></label></div><label><span className={labelClass}>Job description</span><textarea required rows={10} maxLength={30000} className={fieldClass} value={manual.job_description} onChange={(e) => setManual({ ...manual, job_description: e.target.value })} /></label></div>}<div className="border-l-2 border-brand bg-brand/5 px-3 py-2 text-sm text-on-surface-variant">Gemini receives this job description and the verified resume information needed for comparison. It cannot change your master resume.</div><div className="flex justify-end gap-2"><button type="button" onClick={() => onOpenChange(false)} className="lp-chamfer-button border border-outline-variant px-4 py-2.5 text-sm">Cancel</button><button disabled={saving || (mode === "application" ? !applicationId : !manual.job_description.trim())} className="lp-chamfer-button flex items-center gap-2 bg-brand px-4 py-2.5 text-sm font-semibold text-on-brand disabled:opacity-50">{saving ? <Loader2 size={15} className="animate-spin" /> : <WandSparkles size={15} />}Analyze and tailor</button></div></form></DialogContent></Dialog>;
}

function ReviewDialog({ version, onOpenChange, onSaved }) {
  const [draft, setDraft] = useState(version); const [saving, setSaving] = useState(false);
  useEffect(() => { setDraft(version); }, [version]);
  if (!draft) return null;
  const updateSuggestion = (index, patch) => setDraft((current) => ({ ...current, suggestions: current.suggestions.map((item, slot) => slot === index ? { ...item, ...patch } : item) }));
  const save = async (finalize = false) => { setSaving(true); try { await api.put(`/resume-versions/${draft.version_id}`, { label: draft.label, template: draft.template, suggestions: draft.suggestions }); const { data } = finalize ? await api.post(`/resume-versions/${draft.version_id}/finalize`) : await api.get(`/resume-versions/${draft.version_id}`); setDraft(data); toast.success(finalize ? "Tailored resume finalized" : "Review saved"); await onSaved(); } catch (failure) { toast.error(formatApiErrorDetail(failure.response?.data?.detail)); } finally { setSaving(false); } };
  const attach = async () => { setSaving(true); try { await api.post(`/resume-versions/${draft.version_id}/attach`, { application_id: draft.application_id, format: "pdf" }); toast.success("PDF attached to the application"); } catch (failure) { toast.error(formatApiErrorDetail(failure.response?.data?.detail)); } finally { setSaving(false); } };
  const duplicate = async () => { setSaving(true); try { const { data } = await api.post(`/resume-versions/${draft.version_id}/duplicate`); setDraft(data); toast.success("A new review draft was created"); await onSaved(); } catch (failure) { toast.error(formatApiErrorDetail(failure.response?.data?.detail)); } finally { setSaving(false); } };
  const promote = async () => { setSaving(true); try { await api.post("/resumes", { name: `${draft.label || "Tailored resume"} master`, template: draft.template, is_default: false, content: draft.final_content }); toast.success("Tailored version saved as a new master resume"); await onSaved(); } catch (failure) { toast.error(formatApiErrorDetail(failure.response?.data?.detail)); } finally { setSaving(false); } };
  const analysis = draft.match_analysis || {};
  return <Dialog open={!!version} onOpenChange={(open) => !open && onOpenChange()}><DialogContent className="max-h-[95vh] overflow-y-auto border-outline-variant bg-surface-mid text-on-surface sm:max-w-5xl"><DialogHeader><DialogTitle className="font-heading text-xl">Review tailoring suggestions</DialogTitle></DialogHeader>
    <div className="grid gap-3 lg:grid-cols-3"><AnalysisGroup title="Covered" icon={Check} items={analysis.covered} tone="brand" /><AnalysisGroup title="Partially supported" icon={Gauge} items={analysis.partial} tone="orange" /><AnalysisGroup title="Not evidenced" icon={AlertTriangle} items={analysis.not_evidenced} tone="danger" /></div>
    {analysis.keywords?.length > 0 && <div className="flex flex-wrap gap-2 border border-outline-variant bg-surface-low p-3"><span className="mr-1 text-xs font-semibold uppercase tracking-wider text-on-surface-variant">Relevant phrases</span>{analysis.keywords.map((word) => <span key={word} className="lp-chamfer-chip border border-outline-variant bg-surface-mid px-2 py-1 text-xs">{word}</span>)}</div>}
    <div className="space-y-3"><div className="flex items-center justify-between"><h3 className="font-heading text-lg font-bold">Suggested changes</h3><p className="text-xs text-on-surface-variant">Accept, reject, or edit every change.</p></div>{draft.suggestions?.length ? draft.suggestions.map((suggestion, index) => <article key={suggestion.suggestion_id} className={`border p-4 ${suggestion.status === "accepted" ? "border-brand bg-brand/5" : suggestion.status === "rejected" ? "border-outline-variant bg-surface-low opacity-70" : "border-outline bg-surface-low"}`}><div className="mb-3 flex flex-wrap items-center justify-between gap-2"><span className="text-xs font-semibold uppercase tracking-wider text-brand">{suggestion.section}</span><div className="flex gap-1"><button onClick={() => updateSuggestion(index, { status: "accepted" })} className={`lp-chamfer-chip flex items-center gap-1 border px-2.5 py-1.5 text-xs ${suggestion.status === "accepted" ? "border-brand bg-brand text-on-brand" : "border-outline-variant"}`}><Check size={13} />Accept</button><button onClick={() => updateSuggestion(index, { status: "rejected" })} className={`lp-chamfer-chip flex items-center gap-1 border px-2.5 py-1.5 text-xs ${suggestion.status === "rejected" ? "border-danger bg-danger text-background" : "border-outline-variant"}`}><X size={13} />Reject</button></div></div><div className="grid gap-3 lg:grid-cols-2"><div><span className={labelClass}>Current</span><p className="min-h-24 border border-outline-variant bg-surface-mid p-3 text-sm leading-6 text-on-surface-variant">{suggestion.original || "No existing summary"}</p></div><label><span className={labelClass}>Suggested wording</span><textarea rows={4} className={fieldClass} value={suggestion.suggested} onChange={(e) => updateSuggestion(index, { suggested: e.target.value, confirmed: false })} /></label></div><div className="mt-3 grid gap-2 text-xs text-on-surface-variant sm:grid-cols-2"><p><strong className="text-on-surface">Why:</strong> {suggestion.rationale}</p><p><strong className="text-on-surface">Job need:</strong> {suggestion.job_requirement}</p></div>{suggestion.requires_confirmation && <label className="mt-3 flex items-start gap-2 border-l-2 border-danger bg-danger/5 px-3 py-2 text-xs text-danger"><input type="checkbox" className="mt-0.5" checked={suggestion.confirmed || false} onChange={(e) => updateSuggestion(index, { confirmed: e.target.checked })} /><span>This wording introduces a number LaunchPad could not verify. Check only if you personally confirm it is accurate, or edit/reject the suggestion.</span></label>}</article>) : <p className="border border-dashed border-outline-variant p-6 text-center text-sm text-on-surface-variant">The analysis found no grounded wording changes to suggest.</p>}</div>
    <div className="sticky bottom-0 flex flex-wrap justify-end gap-2 border-t border-outline-variant bg-surface-mid py-3"><button onClick={() => onOpenChange()} className="lp-chamfer-button border border-outline-variant px-4 py-2.5 text-sm">Close</button>{draft.status !== "final" && <button disabled={saving} onClick={() => save(false)} className="lp-chamfer-button flex items-center gap-2 border border-outline px-4 py-2.5 text-sm font-semibold"><Save size={15} />Save review</button>}{draft.status !== "final" && <button disabled={saving} onClick={() => save(true)} className="lp-chamfer-button flex items-center gap-2 bg-brand px-4 py-2.5 text-sm font-semibold text-on-brand"><FileCheck2 size={15} />Finalize version</button>}{draft.status === "final" && <>{draft.application_id && <button disabled={saving} onClick={attach} className="lp-chamfer-button flex items-center gap-2 border border-outline px-3 py-2.5 text-sm font-semibold"><Paperclip size={14} />Attach PDF</button>}<button disabled={saving} onClick={duplicate} className="lp-chamfer-button flex items-center gap-2 border border-outline px-3 py-2.5 text-sm font-semibold"><Copy size={14} />Duplicate draft</button><button disabled={saving} onClick={promote} className="lp-chamfer-button flex items-center gap-2 border border-outline px-3 py-2.5 text-sm font-semibold"><FileText size={14} />Save as master</button><ExportLinks version={draft} /></>}</div>
  </DialogContent></Dialog>;
}

function AnalysisGroup({ title, icon: Icon, items = [], tone }) {
  const toneClass = { brand: "text-brand", orange: "text-orange", danger: "text-danger" }[tone] || "text-on-surface";
  return <div className="border border-outline-variant bg-surface-low p-3"><h3 className={`flex items-center gap-2 text-sm font-bold ${toneClass}`}><Icon size={16} />{title}</h3><ul className="mt-2 space-y-1.5 text-xs leading-5 text-on-surface-variant">{items.length ? items.map((item, index) => <li key={index}>• {item}</li>) : <li>None identified</li>}</ul></div>;
}

function ExportLinks({ version }) {
  return <div className="flex gap-2"><a href={`/api/resume-versions/${version.version_id}/export?format=docx`} className="lp-chamfer-button flex items-center gap-1.5 border border-outline px-3 py-2.5 text-sm font-semibold"><Download size={14} />DOCX</a><a href={`/api/resume-versions/${version.version_id}/export?format=pdf`} className="lp-chamfer-button flex items-center gap-1.5 bg-brand px-3 py-2.5 text-sm font-semibold text-on-brand"><Download size={14} />PDF</a></div>;
}

export default function ResumeStudio() {
  const [searchParams, setSearchParams] = useSearchParams();
  const navigate = useNavigate();
  const [data, setData] = useState({ resumes: [], recent_versions: [], profile: {}, ai_usage: {}, library_summary: {}, limits: {} });
  const [library, setLibrary] = useState({ skills: [], experiences: [] });
  const [applications, setApplications] = useState([]);
  const [loading, setLoading] = useState(true); const [error, setError] = useState("");
  const [profileOpen, setProfileOpen] = useState(false); const [editorOpen, setEditorOpen] = useState(false); const [importOpen, setImportOpen] = useState(false); const [tailorOpen, setTailorOpen] = useState(false);
  const [initialApplicationId, setInitialApplicationId] = useState("");
  const [editingResume, setEditingResume] = useState(null); const [tailorResume, setTailorResume] = useState(null); const [reviewVersion, setReviewVersion] = useState(null); const [deleting, setDeleting] = useState(null); const [initialLibraryItem, setInitialLibraryItem] = useState(null);
  const handledQuery = useRef(false);
  const load = useCallback(async () => { setLoading(true); setError(""); try { const [resumeResponse, libraryResponse, applicationsResponse] = await Promise.all([api.get("/resumes"), api.get("/library"), api.get("/applications")]); setData(resumeResponse.data); setLibrary(libraryResponse.data); setApplications(applicationsResponse.data); } catch (failure) { setError(formatApiErrorDetail(failure.response?.data?.detail)); } finally { setLoading(false); } }, []);
  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    if (loading || handledQuery.current) return;
    const applicationId = searchParams.get("application");
    const kind = searchParams.get("libraryKind"); const id = searchParams.get("libraryId");
    if (applicationId && data.resumes.length) { const chosen = data.resumes.find((item) => item.is_default) || data.resumes[0]; setInitialApplicationId(applicationId); setTailorResume(chosen); setTailorOpen(true); }
    if (kind && id) { const item = kind === "skill" ? library.skills.find((value) => value.skill_id === id) : library.experiences.find((value) => value.experience_id === id); if (item) { setInitialLibraryItem({ kind, item }); setEditingResume(data.resumes.find((value) => value.is_default) || data.resumes[0] || null); setEditorOpen(true); } }
    handledQuery.current = true; if (applicationId || id) setSearchParams({}, { replace: true });
  }, [loading, data.resumes, library, searchParams, setSearchParams]);
  const profileComplete = Boolean(data.profile?.full_name && data.profile?.preferred_email);
  const libraryComplete = (data.library_summary?.skills || 0) + (data.library_summary?.records || 0) > 0;
  const resumeComplete = data.resumes.length > 0;
  const setupPercent = [profileComplete, libraryComplete, resumeComplete].filter(Boolean).length / 3 * 100;
  const openEditor = (resume = null) => { setInitialLibraryItem(null); setEditingResume(resume); setEditorOpen(true); };
  const openReview = async (version) => { try { const { data: loaded } = await api.get(`/resume-versions/${version.version_id}`); setReviewVersion(loaded); } catch (failure) { toast.error(formatApiErrorDetail(failure.response?.data?.detail)); } };
  const removeResume = async () => { try { await api.delete(`/resumes/${deleting.resume_id}`); toast.success("Master resume removed"); setDeleting(null); await load(); } catch (failure) { toast.error(formatApiErrorDetail(failure.response?.data?.detail)); } };
  if (loading) return <Layout title="Resume Studio"><div className="flex min-h-[60vh] items-center justify-center"><Loader2 size={34} className="animate-spin text-brand" /></div></Layout>;
  return <Layout title="Resume Studio">
    {error ? <div className="lp-panel flex min-h-64 flex-col items-center justify-center p-6 text-center"><AlertTriangle size={30} className="text-danger" /><p className="mt-3 text-danger">{error}</p><button onClick={load} className="lp-chamfer-button mt-4 border border-outline-variant px-4 py-2"><RefreshCw size={14} className="mr-2 inline" />Try again</button></div> : <>
      <section className="lp-panel lp-chamfer-dual lp-crosshair mb-6 p-4 sm:p-5">
        <div className="flex flex-col justify-between gap-5 lg:flex-row lg:items-center"><div><div className="flex items-center gap-3"><span className="lp-icon-frame flex h-11 w-11 items-center justify-center border border-outline-variant bg-surface-mid text-brand"><FileText size={20} /></span><div><h1 className="font-heading text-2xl font-bold">Resume Studio</h1><p className="mt-1 text-sm text-on-surface-variant">Build from verified experience, tailor carefully, and export an ATS-safe resume.</p></div></div></div><div className="flex flex-wrap gap-2"><button onClick={() => setProfileOpen(true)} className="lp-chamfer-button flex items-center gap-2 border border-outline-variant bg-surface-low px-3 py-2.5 text-sm font-semibold"><UserRound size={15} />Resume profile</button><button onClick={() => setImportOpen(true)} disabled={data.resumes.length >= data.limits.masters} className="lp-chamfer-button flex items-center gap-2 border border-outline-variant bg-surface-low px-3 py-2.5 text-sm font-semibold disabled:opacity-40"><Import size={15} />Import</button><button onClick={() => openEditor()} disabled={data.resumes.length >= data.limits.masters} className="lp-chamfer-button flex items-center gap-2 bg-brand px-3 py-2.5 text-sm font-semibold text-on-brand disabled:opacity-40"><Plus size={15} />New master resume</button></div></div>
      </section>
      <div className="mb-6 grid gap-4 lg:grid-cols-[1fr_320px]">
        <section className="lp-panel lp-chamfer-tr p-4 sm:p-5"><div className="mb-4 flex items-center justify-between"><h2 className="font-heading text-lg font-bold">Setup</h2><span className="text-xs font-semibold text-on-surface-variant">{Math.round(setupPercent)}% ready</span></div><ProgressBar value={setupPercent} /><div className="mt-4 grid gap-3 sm:grid-cols-3"><SetupCard icon={UserRound} title="Resume profile" detail={profileComplete ? "Contact details are ready." : "Add the contact details used on resumes."} complete={profileComplete} onClick={() => setProfileOpen(true)} /><SetupCard icon={LibraryBig} title="Career Library" detail={libraryComplete ? `${data.library_summary.skills} skills and ${data.library_summary.records} records available.` : "Add verified skills and experience to reuse."} complete={libraryComplete} onClick={() => navigate("/library")} /><SetupCard icon={FileText} title="Master resume" detail={resumeComplete ? `${data.resumes.length} of ${data.limits.masters} master resumes created.` : "Create a reusable base resume."} complete={resumeComplete} onClick={() => resumeComplete ? openEditor(data.resumes[0]) : openEditor()} /></div></section>
        <section className="lp-panel lp-chamfer-tr p-4 sm:p-5"><div className="flex items-center justify-between"><div><p className="text-xs font-semibold uppercase tracking-wider text-on-surface-variant">AI allowance</p><p className="mt-1 font-heading text-3xl font-bold">{data.ai_usage.remaining ?? 0}<span className="text-sm font-normal text-on-surface-variant"> / {data.ai_usage.limit ?? 10}</span></p></div><span className="lp-icon-frame flex h-11 w-11 items-center justify-center border border-outline-variant bg-surface-mid text-brand"><Sparkles size={20} /></span></div><p className="mt-3 text-sm leading-5 text-on-surface-variant">Successful AI imports and tailoring analyses this month. Manual editing and exports stay available.</p>{!data.ai_usage.available && <p className="mt-3 text-xs text-orange">Gemini is not configured on this server.</p>}</section>
      </div>
      <section className="lp-panel lp-chamfer-dual lp-crosshair mb-6 p-4 sm:p-5"><div className="mb-4 flex items-center justify-between"><div className="flex items-center gap-3"><span className="lp-icon-frame flex h-10 w-10 items-center justify-center border border-outline-variant bg-surface-mid text-on-surface-variant"><BookOpenCheck size={18} /></span><h2 className="font-heading text-lg font-bold">Master Resumes</h2></div><span className="text-xs text-on-surface-variant">{data.resumes.length} / {data.limits.masters}</span></div>{data.resumes.length ? <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">{data.resumes.map((resume) => <article key={resume.resume_id} className="lp-panel lp-panel-hover lp-chamfer-tr group flex min-h-56 flex-col p-4"><div className="flex items-start justify-between"><span className="lp-icon-frame flex h-10 w-10 items-center justify-center border border-outline-variant bg-surface-mid text-brand"><FileText size={18} /></span>{resume.is_default && <span className="lp-chamfer-chip bg-brand px-2 py-1 text-[10px] font-bold uppercase tracking-wider text-on-brand">Default</span>}</div><h3 className="mt-4 font-heading text-xl font-bold">{resume.name}</h3><p className="mt-1 text-xs uppercase tracking-wider text-on-surface-variant">{resume.template} template</p><p className="mt-3 text-sm text-on-surface-variant">{resume.content?.experience?.length || 0} experiences · {resume.content?.projects?.length || 0} projects · {resume.content?.skills?.length || 0} skills</p><div className="mt-auto flex flex-wrap gap-2 border-t border-outline-variant pt-3"><button onClick={() => { setTailorResume(resume); setTailorOpen(true); }} disabled={!data.ai_usage.available || data.ai_usage.remaining <= 0} className="lp-chamfer-button flex flex-1 items-center justify-center gap-1.5 bg-brand px-3 py-2 text-xs font-semibold text-on-brand disabled:opacity-40"><WandSparkles size={14} />Tailor</button><button onClick={() => openEditor(resume)} className="lp-chamfer-button border border-outline-variant p-2 text-on-surface-variant" title="Edit"><Pencil size={15} /></button><a href={`/api/resumes/${resume.resume_id}/export?format=docx`} className="lp-chamfer-button border border-outline-variant p-2 text-on-surface-variant" title="Download DOCX"><Download size={15} /></a><button onClick={() => setDeleting(resume)} className="lp-chamfer-button border border-outline-variant p-2 text-on-surface-variant hover:text-danger" title="Delete"><Trash2 size={15} /></button></div></article>)}</div> : <div className="flex min-h-56 flex-col items-center justify-center border border-dashed border-outline-variant px-4 text-center"><FileText size={28} className="text-on-surface-variant" /><h3 className="mt-3 font-heading text-lg font-bold">Create your first master resume</h3><p className="mt-2 max-w-md text-sm text-on-surface-variant">Start manually, import an existing resume, or build with information from your Career Library.</p><div className="mt-4 flex gap-2"><button onClick={() => openEditor()} className="lp-chamfer-button bg-brand px-4 py-2.5 text-sm font-semibold text-on-brand">Create resume</button><button onClick={() => setImportOpen(true)} className="lp-chamfer-button border border-outline-variant px-4 py-2.5 text-sm font-semibold">Import file</button></div></div>}</section>
      <section className="lp-panel lp-chamfer-dual lp-crosshair p-4 sm:p-5"><div className="mb-4 flex items-center gap-3"><span className="lp-icon-frame flex h-10 w-10 items-center justify-center border border-outline-variant bg-surface-mid text-on-surface-variant"><FileCheck2 size={18} /></span><h2 className="font-heading text-lg font-bold">Recent Tailored Versions</h2></div>{data.recent_versions.length ? <div className="space-y-3">{data.recent_versions.map((version) => <article key={version.version_id} className="lp-panel-hover flex flex-col justify-between gap-3 border border-outline-variant bg-surface-low p-3 sm:flex-row sm:items-center"><div className="min-w-0"><div className="flex items-center gap-2"><h3 className="truncate font-semibold">{version.label}</h3><span className={`lp-chamfer-chip px-2 py-0.5 text-[10px] font-bold uppercase ${version.status === "final" ? "bg-brand text-on-brand" : "border border-outline-variant text-on-surface-variant"}`}>{version.status}</span></div><p className="mt-1 truncate text-xs text-on-surface-variant">{version.job_snapshot?.job_title || "Job description"}{version.job_snapshot?.company ? ` · ${version.job_snapshot.company}` : ""}</p></div><div className="flex shrink-0 gap-2"><button onClick={() => openReview(version)} className="lp-chamfer-button flex items-center gap-1.5 border border-outline-variant px-3 py-2 text-xs font-semibold">{version.status === "final" ? "View" : "Continue review"}<ArrowRight size={13} /></button>{version.status === "final" && <ExportLinks version={version} />}</div></article>)}</div> : <div className="border border-dashed border-outline-variant p-8 text-center text-sm text-on-surface-variant">Tailored versions will appear here after you analyze a job description.</div>}</section>
    </>}
    <ProfileDialog open={profileOpen} onOpenChange={setProfileOpen} profile={data.profile} onSaved={load} />
    <ResumeEditor open={editorOpen} onOpenChange={(open) => { setEditorOpen(open); if (!open) setInitialLibraryItem(null); }} resume={editingResume} library={library} profile={data.profile} initialLibraryItem={initialLibraryItem} onSaved={load} />
    <ImportDialog open={importOpen} onOpenChange={setImportOpen} onSaved={load} aiAvailable={Boolean(data.ai_usage.available)} />
    {tailorResume && <TailorDialog open={tailorOpen} onOpenChange={(open) => { setTailorOpen(open); if (!open) setInitialApplicationId(""); }} resume={tailorResume} applications={applications} initialApplicationId={initialApplicationId} onCreated={(version) => { setReviewVersion(version); load(); }} />}
    <ReviewDialog version={reviewVersion} onOpenChange={() => setReviewVersion(null)} onSaved={load} />
    <AlertDialog open={!!deleting} onOpenChange={(open) => !open && setDeleting(null)}><AlertDialogContent className="border-outline-variant bg-surface-mid text-on-surface"><AlertDialogHeader><AlertDialogTitle className="font-heading">Delete this master resume?</AlertDialogTitle><AlertDialogDescription className="text-on-surface-variant">This also removes its tailored version history and imported source file. Application attachments remain intact.</AlertDialogDescription></AlertDialogHeader><AlertDialogFooter><AlertDialogCancel className="border-outline-variant bg-surface-low text-on-surface">Cancel</AlertDialogCancel><AlertDialogAction onClick={removeResume} className="bg-danger text-background">Delete resume</AlertDialogAction></AlertDialogFooter></AlertDialogContent></AlertDialog>
  </Layout>;
}
