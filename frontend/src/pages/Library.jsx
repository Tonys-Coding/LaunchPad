import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  Archive, Award, BookOpenCheck, BriefcaseBusiness, Check, ChevronDown, ExternalLink,
  FileBadge2, FileText, FolderKanban, GraduationCap, LibraryBig, Loader2, Pencil, Plus, Search,
  Settings2, Sparkles, Trash2, Trophy, Users,
} from "lucide-react";
import { toast } from "sonner";
import { Layout } from "@/components/Layout";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import api, { formatApiErrorDetail } from "@/lib/api";

const SKILL_CATEGORIES = ["Technical", "Tools", "Industry", "Communication", "Leadership", "Other"];
const SKILL_LEVELS = ["Learning", "Working", "Strong", "Expert"];
const emptyLibrary = { skills: [], experiences: [], summary: { skill_count: 0, experience_count: 0, evidenced_skill_count: 0 } };
const fieldClass = "w-full border border-outline-variant bg-surface-low px-3 py-2.5 text-sm text-on-surface outline-none transition-colors placeholder:text-outline focus:border-brand";
const labelClass = "mb-1.5 block text-xs font-semibold uppercase tracking-wider text-on-surface-variant";

const typeIcons = {
  Work: BriefcaseBusiness,
  Project: FolderKanban,
  Accomplishment: Trophy,
  Education: GraduationCap,
  Leadership: Users,
  Volunteer: Sparkles,
  Other: FileBadge2,
};

function monthValue(value) {
  return value ? value.slice(0, 7) : "";
}

function monthPayload(value) {
  return value ? `${value}-01` : null;
}

function dateRange(record) {
  if (!record.start_date && !record.end_date) return "Date not set";
  const formatMonth = (value) => new Intl.DateTimeFormat(undefined, { month: "short", year: "numeric", timeZone: "UTC" }).format(new Date(`${value}T12:00:00Z`));
  if (record.type === "Accomplishment") return record.start_date ? formatMonth(record.start_date) : "Date not set";
  const start = record.start_date ? formatMonth(record.start_date) : "Earlier";
  const end = record.current ? "Present" : record.end_date ? formatMonth(record.end_date) : "Date not set";
  return `${start} — ${end}`;
}

function ShowcaseColumn({ icon: Icon, label, items, kind, onSelect }) {
  return (
    <div className="border border-outline-variant bg-surface-low p-3 sm:p-4">
      <div className="mb-3 flex items-center gap-2 border-b border-outline-variant pb-3">
        <span className="lp-icon-frame flex h-9 w-9 items-center justify-center border border-outline-variant bg-surface-mid text-brand"><Icon size={17} /></span>
        <p className="text-xs font-semibold uppercase tracking-[0.14em] text-on-surface-variant">{label}</p>
      </div>
      {items.length ? <div className="space-y-2">{items.map((item) => {
        const isSkill = kind === "skill";
        const secondary = isSkill
          ? `${item.level} · ${item.category}`
          : [item.organization, item.type].filter(Boolean).join(" · ");
        return <button key={item.skill_id || item.experience_id} onClick={() => onSelect(item)} className={`lp-panel-hover flex w-full items-center gap-3 border px-3 py-2.5 text-left transition-all ${item.showcase_rank === 1 ? "border-brand/50 bg-brand/5" : "border-outline-variant bg-surface-mid"}`}>
          <span className={`flex h-7 w-7 shrink-0 items-center justify-center border text-xs font-bold ${item.showcase_rank === 1 ? "border-brand bg-brand text-on-brand" : "border-outline bg-surface-high text-on-surface-variant"}`}>{item.showcase_rank}</span>
          <span className="min-w-0"><span className="block truncate text-sm font-semibold text-on-surface">{item.name || item.title}</span><span className="mt-0.5 block truncate text-xs text-on-surface-variant">{secondary || "Details not added"}</span></span>
        </button>;
      })}</div> : <div className="flex min-h-32 items-center justify-center border border-dashed border-outline-variant px-4 text-center text-sm text-on-surface-variant">Choose items with Customize.</div>}
    </div>
  );
}

function SkillForm({ open, onOpenChange, initial, onSaved }) {
  const [form, setForm] = useState({ name: "", category: "Technical", level: "Working", notes: "" });
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open) setForm(initial ? {
      name: initial.name, category: initial.category, level: initial.level, notes: initial.notes || "",
    } : { name: "", category: "Technical", level: "Working", notes: "" });
  }, [open, initial]);

  const submit = async (event) => {
    event.preventDefault();
    setSaving(true);
    try {
      const payload = { ...form, notes: form.notes || null };
      if (initial) await api.put(`/library/skills/${initial.skill_id}`, payload);
      else await api.post("/library/skills", payload);
      toast.success(initial ? "Skill updated" : "Skill added");
      onOpenChange(false);
      await onSaved();
    } catch (failure) {
      toast.error(formatApiErrorDetail(failure.response?.data?.detail));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="border-outline-variant bg-surface-mid text-on-surface sm:max-w-lg">
        <DialogHeader><DialogTitle className="font-heading text-xl">{initial ? "Edit skill" : "Add a skill"}</DialogTitle></DialogHeader>
        <form onSubmit={submit} className="grid gap-4" data-testid="skill-form">
          <label><span className={labelClass}>Skill name</span><input autoFocus required maxLength={80} className={fieldClass} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="e.g. Python, public speaking, market research" /></label>
          <div className="grid grid-cols-2 gap-3">
            <label><span className={labelClass}>Category</span><select className={fieldClass} value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })}>{SKILL_CATEGORIES.map((item) => <option key={item}>{item}</option>)}</select></label>
            <label><span className={labelClass}>Confidence</span><select className={fieldClass} value={form.level} onChange={(e) => setForm({ ...form, level: e.target.value })}>{SKILL_LEVELS.map((item) => <option key={item}>{item}</option>)}</select></label>
          </div>
          <label><span className={labelClass}>Notes <span className="normal-case tracking-normal text-outline">(optional)</span></span><textarea rows={3} maxLength={1000} className={fieldClass} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} placeholder="What you know, what you are learning, or where you use it" /></label>
          <div className="flex justify-end gap-2 pt-2">
            <button type="button" onClick={() => onOpenChange(false)} className="lp-chamfer-button border border-outline-variant px-4 py-2.5 text-sm font-semibold text-on-surface-variant hover:bg-surface-high">Cancel</button>
            <button disabled={saving} className="lp-chamfer-button flex items-center gap-2 bg-brand px-4 py-2.5 text-sm font-semibold text-on-brand disabled:opacity-60">{saving && <Loader2 size={15} className="animate-spin" />}{initial ? "Save changes" : "Add skill"}</button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function ExperienceForm({ open, onOpenChange, initial, defaultType, skills, onSaved }) {
  const blank = { type: "Work", title: "", organization: "", start_date: "", end_date: "", current: false, description: "", resume_bullet: "", outcome: "", link: "", skill_ids: [], star_situation: "", star_task: "", star_action: "", star_result: "" };
  const [form, setForm] = useState(blank);
  const [starOpen, setStarOpen] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setForm(initial ? { ...blank, ...initial, start_date: monthValue(initial.start_date), end_date: monthValue(initial.end_date) } : { ...blank, type: defaultType || "Work" });
    setStarOpen(Boolean(initial?.star_situation || initial?.star_task || initial?.star_action || initial?.star_result));
  }, [open, initial, defaultType]); // eslint-disable-line react-hooks/exhaustive-deps

  const isAccomplishment = form.type === "Accomplishment";
  const isProject = form.type === "Project";
  const isWork = form.type === "Work";
  const titleLabel = isWork ? "Job Title" : isProject ? "Project Name" : "Title";
  const organizationLabel = isWork ? "Company/Employer" : "Organization";

  const toggleSkill = (skillId) => setForm((current) => ({
    ...current,
    skill_ids: current.skill_ids.includes(skillId) ? current.skill_ids.filter((id) => id !== skillId) : [...current.skill_ids, skillId],
  }));

  const submit = async (event) => {
    event.preventDefault();
    setSaving(true);
    try {
      const payload = {
        ...form,
        start_date: monthPayload(form.start_date),
        current: isAccomplishment ? false : form.current,
        end_date: isAccomplishment || form.current ? null : monthPayload(form.end_date),
      };
      if (initial) await api.put(`/library/experiences/${initial.experience_id}`, payload);
      else await api.post("/library/experiences", payload);
      toast.success(initial ? `${initial.type} updated` : `${form.type} added`);
      onOpenChange(false);
      await onSaved();
    } catch (failure) {
      toast.error(formatApiErrorDetail(failure.response?.data?.detail));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto border-outline-variant bg-surface-mid text-on-surface sm:max-w-2xl">
        <DialogHeader><DialogTitle className="font-heading text-xl">{initial ? `Edit ${initial.type.toLowerCase()}` : `Add ${form.type.toLowerCase()}`}</DialogTitle></DialogHeader>
        <form onSubmit={submit} className="grid gap-5" data-testid="experience-form">
          <label className="block"><span className={labelClass}>{titleLabel}</span><input required maxLength={160} className={fieldClass} value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder={isAccomplishment ? "e.g. Dean's List, hackathon winner" : isProject ? "e.g. Campus events app" : "e.g. Marketing intern"} /></label>
          <label className="block"><span className={labelClass}>{organizationLabel} <span className="normal-case tracking-normal text-outline">(optional)</span></span><input maxLength={160} className={fieldClass} value={form.organization} onChange={(e) => setForm({ ...form, organization: e.target.value })} placeholder={isWork ? "Company or employer name" : "Company, club, school, or client"} /></label>
          <div className={`grid gap-3 ${isAccomplishment ? "sm:grid-cols-1" : "sm:grid-cols-2"}`}>
            <label className="block"><span className={labelClass}>{isAccomplishment ? "Date accomplished" : "Started"}</span><input type="month" className={fieldClass} value={form.start_date} onChange={(e) => setForm({ ...form, start_date: e.target.value })} /></label>
            {!isAccomplishment && <label className="block"><span className={labelClass}>Ended</span><input type="month" disabled={form.current} className={`${fieldClass} disabled:opacity-40`} value={form.end_date} onChange={(e) => setForm({ ...form, end_date: e.target.value })} /></label>}
          </div>
          {!isAccomplishment && <div><label className="flex cursor-pointer items-center gap-2 text-sm text-on-surface-variant"><input type="checkbox" checked={form.current} onChange={(e) => setForm({ ...form, current: e.target.checked, end_date: e.target.checked ? "" : form.end_date })} className="h-4 w-4 accent-[rgb(var(--brand))]" /> I am currently doing this</label></div>}
          <label className="block"><span className={labelClass}>Details</span><textarea rows={3} maxLength={3000} className={fieldClass} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} placeholder={isAccomplishment ? "Describe the accomplishment and what you contributed" : "Capture the scope, your role, and the work you owned"} /></label>
          <div className="grid gap-3 sm:grid-cols-2">
            <label><span className={labelClass}>{isAccomplishment ? "Why it matters" : "Strongest outcome"} <span className="normal-case tracking-normal text-outline">(optional)</span></span><textarea rows={3} maxLength={500} className={fieldClass} value={form.outcome} onChange={(e) => setForm({ ...form, outcome: e.target.value })} placeholder="Add a number, result, or visible impact" /></label>
            <label><span className={labelClass}>Resume-ready bullet <span className="normal-case tracking-normal text-outline">(optional)</span></span><textarea rows={3} maxLength={1200} className={fieldClass} value={form.resume_bullet} onChange={(e) => setForm({ ...form, resume_bullet: e.target.value })} placeholder="Action + work + measurable result" /></label>
          </div>
          <div>
            <span className={labelClass}>Skills demonstrated</span>
            {skills.length ? <div className="flex max-h-36 flex-wrap gap-2 overflow-y-auto border border-outline-variant bg-surface-low p-3">
              {skills.map((skill) => {
                const selected = form.skill_ids.includes(skill.skill_id);
                return <button key={skill.skill_id} type="button" onClick={() => toggleSkill(skill.skill_id)} className={`lp-chamfer-chip flex items-center gap-1.5 border px-2.5 py-1.5 text-xs transition-colors ${selected ? "border-brand bg-brand text-on-brand" : "border-outline-variant text-on-surface-variant hover:border-outline hover:text-on-surface"}`}>{selected && <Check size={12} />}{skill.name}</button>;
              })}
            </div> : <p className="border border-dashed border-outline-variant p-3 text-sm text-on-surface-variant">Add skills first, then connect them to this record.</p>}
          </div>
          <label className="block"><span className={labelClass}>Supporting link <span className="normal-case tracking-normal text-outline">(optional)</span></span><input type="url" maxLength={2048} className={fieldClass} value={form.link} onChange={(e) => setForm({ ...form, link: e.target.value })} placeholder="https://portfolio, repository, article, or project" /></label>
          <div className="border border-outline-variant bg-surface-low">
            <button type="button" onClick={() => setStarOpen(!starOpen)} className="flex w-full items-center justify-between px-3 py-3 text-left text-sm font-semibold"><span>Interview story notes <span className="font-normal text-on-surface-variant">(optional STAR format)</span></span><ChevronDown size={17} className={`transition-transform ${starOpen ? "rotate-180" : ""}`} /></button>
            {starOpen && <div className="grid gap-3 border-t border-outline-variant p-3 sm:grid-cols-2">
              {[['star_situation', 'Situation'], ['star_task', 'Task'], ['star_action', 'Action'], ['star_result', 'Result']].map(([key, label]) => <label key={key}><span className={labelClass}>{label}</span><textarea rows={3} maxLength={1500} className={fieldClass} value={form[key]} onChange={(e) => setForm({ ...form, [key]: e.target.value })} /></label>)}
            </div>}
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <button type="button" onClick={() => onOpenChange(false)} className="lp-chamfer-button border border-outline-variant px-4 py-2.5 text-sm font-semibold text-on-surface-variant hover:bg-surface-high">Cancel</button>
            <button disabled={saving} className="lp-chamfer-button flex items-center gap-2 bg-brand px-4 py-2.5 text-sm font-semibold text-on-brand disabled:opacity-60">{saving && <Loader2 size={15} className="animate-spin" />}{initial ? "Save changes" : `Add ${form.type.toLowerCase()}`}</button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function ShowcaseForm({ open, onOpenChange, library, onSaved }) {
  const blank = { skill_ids: ["", "", ""], experience_ids: ["", "", ""], project_ids: ["", "", ""] };
  const [selection, setSelection] = useState(blank);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    const ranked = (items, idKey) => {
      const slots = ["", "", ""];
      items.forEach((item) => {
        if (item.showcase_rank >= 1 && item.showcase_rank <= 3) slots[item.showcase_rank - 1] = item[idKey];
      });
      return slots;
    };
    setSelection({
      skill_ids: ranked(library.skills, "skill_id"),
      experience_ids: ranked(library.experiences.filter((item) => !["Project", "Accomplishment"].includes(item.type)), "experience_id"),
      project_ids: ranked(library.experiences.filter((item) => item.type === "Project"), "experience_id"),
    });
  }, [open, library]);

  const setSlot = (key, index, value) => setSelection((current) => {
    const next = [...current[key]];
    next[index] = value;
    return { ...current, [key]: next };
  });

  const submit = async (event) => {
    event.preventDefault();
    setSaving(true);
    try {
      await api.put("/library/showcase", selection);
      toast.success("Top strengths updated");
      onOpenChange(false);
      await onSaved();
    } catch (failure) {
      toast.error(formatApiErrorDetail(failure.response?.data?.detail));
    } finally {
      setSaving(false);
    }
  };

  const groups = [
    { key: "skill_ids", label: "Top skills", items: library.skills, idKey: "skill_id", nameKey: "name" },
    { key: "experience_ids", label: "Top experiences", items: library.experiences.filter((item) => !["Project", "Accomplishment"].includes(item.type)), idKey: "experience_id", nameKey: "title" },
    { key: "project_ids", label: "Top projects", items: library.experiences.filter((item) => item.type === "Project"), idKey: "experience_id", nameKey: "title" },
  ];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto border-outline-variant bg-surface-mid text-on-surface sm:max-w-2xl">
        <DialogHeader><DialogTitle className="font-heading text-xl">Customize My Top Strengths</DialogTitle></DialogHeader>
        <form onSubmit={submit} className="space-y-5">
          {groups.map((group) => <fieldset key={group.key} className="border border-outline-variant bg-surface-low p-4">
            <legend className="px-2 text-xs font-semibold uppercase tracking-wider text-on-surface-variant">{group.label}</legend>
            <div className="grid gap-3 sm:grid-cols-3">
              {[0, 1, 2].map((index) => <label key={index}><span className={labelClass}>Position {index + 1}</span><select className={fieldClass} value={selection[group.key][index]} onChange={(event) => setSlot(group.key, index, event.target.value)}><option value="">Not selected</option>{group.items.map((item) => {
                const id = item[group.idKey];
                const usedElsewhere = selection[group.key].some((value, slot) => slot !== index && value === id);
                return <option key={id} value={id} disabled={usedElsewhere}>{item[group.nameKey]}</option>;
              })}</select></label>)}
            </div>
          </fieldset>)}
          <div className="flex justify-end gap-2 pt-1">
            <button type="button" onClick={() => onOpenChange(false)} className="lp-chamfer-button border border-outline-variant px-4 py-2.5 text-sm font-semibold text-on-surface-variant hover:bg-surface-high">Cancel</button>
            <button disabled={saving} className="lp-chamfer-button flex items-center gap-2 bg-brand px-4 py-2.5 text-sm font-semibold text-on-brand disabled:opacity-60">{saving && <Loader2 size={15} className="animate-spin" />}Save showcase</button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export default function Library() {
  const navigate = useNavigate();
  const [library, setLibrary] = useState(emptyLibrary);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [tab, setTab] = useState("skills");
  const [query, setQuery] = useState("");
  const [skillOpen, setSkillOpen] = useState(false);
  const [experienceOpen, setExperienceOpen] = useState(false);
  const [showcaseOpen, setShowcaseOpen] = useState(false);
  const [editingSkill, setEditingSkill] = useState(null);
  const [editingExperience, setEditingExperience] = useState(null);
  const [experiencePreset, setExperiencePreset] = useState("Work");
  const [deleting, setDeleting] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const response = await api.get("/library");
      setLibrary(response.data);
    } catch (failure) {
      setError(formatApiErrorDetail(failure.response?.data?.detail));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const skillById = useMemo(() => Object.fromEntries(library.skills.map((skill) => [skill.skill_id, skill])), [library.skills]);
  const filteredSkills = useMemo(() => library.skills.filter((skill) => `${skill.name} ${skill.category} ${skill.level} ${skill.notes || ""}`.toLowerCase().includes(query.toLowerCase())), [library.skills, query]);
  const filteredExperiences = useMemo(() => library.experiences.filter((item) => {
    const matchesType = tab === "experience"
      ? !["Project", "Accomplishment"].includes(item.type)
      : tab === "projects" ? item.type === "Project" : item.type === "Accomplishment";
    return matchesType && `${item.title} ${item.organization || ""} ${item.type} ${item.description || ""} ${item.outcome || ""}`.toLowerCase().includes(query.toLowerCase());
  }), [library.experiences, query, tab]);

  const ranked = (items) => items.filter((item) => item.showcase_rank >= 1 && item.showcase_rank <= 3).sort((a, b) => a.showcase_rank - b.showcase_rank);
  const topSkills = useMemo(() => ranked(library.skills), [library.skills]); // eslint-disable-line react-hooks/exhaustive-deps
  const topExperiences = useMemo(() => ranked(library.experiences.filter((item) => !["Project", "Accomplishment"].includes(item.type))), [library.experiences]); // eslint-disable-line react-hooks/exhaustive-deps
  const topProjects = useMemo(() => ranked(library.experiences.filter((item) => item.type === "Project")), [library.experiences]); // eslint-disable-line react-hooks/exhaustive-deps

  const openSkill = (skill = null) => { setEditingSkill(skill); setSkillOpen(true); };
  const openExperience = (item = null, preset = "Work") => { setEditingExperience(item); setExperiencePreset(item?.type || preset); setExperienceOpen(true); };
  const subsectionItems = [
    { value: "skills", label: "Skills", count: library.skills.length, add: () => openSkill() },
    { value: "experience", label: "Experience", count: library.experiences.filter((item) => !["Project", "Accomplishment"].includes(item.type)).length, add: () => openExperience(null, "Work") },
    { value: "projects", label: "Projects", count: library.experiences.filter((item) => item.type === "Project").length, add: () => openExperience(null, "Project") },
    { value: "accomplishments", label: "Accomplishments", count: library.experiences.filter((item) => item.type === "Accomplishment").length, add: () => openExperience(null, "Accomplishment") },
  ];
  const remove = async () => {
    try {
      if (deleting.kind === "skill") await api.delete(`/library/skills/${deleting.item.skill_id}`);
      else await api.delete(`/library/experiences/${deleting.item.experience_id}`);
      toast.success(deleting.kind === "skill" ? "Skill removed" : "Experience removed");
      setDeleting(null);
      await load();
    } catch (failure) {
      toast.error(formatApiErrorDetail(failure.response?.data?.detail));
    }
  };

  return (
    <Layout title="Career Library">
      <section className="lp-panel lp-chamfer-tr mb-6 flex flex-col gap-3 p-3 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex items-center gap-3 px-1">
          <span className="lp-icon-frame flex h-10 w-10 items-center justify-center border border-outline-variant bg-surface-mid text-on-surface-variant"><Archive size={18} /></span>
          <h2 className="font-heading text-sm font-bold uppercase tracking-wider">Add to Library</h2>
        </div>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {subsectionItems.map((item) => <button key={item.value} onClick={item.add} className="lp-chamfer-button flex min-h-10 items-center justify-center gap-2 border border-outline-variant bg-surface-low px-3 py-2 text-sm font-semibold transition-colors hover:border-outline hover:bg-surface-high"><Plus size={14} />{item.label === "Accomplishments" ? "Accomplishment" : item.label}</button>)}
        </div>
      </section>

      <section className="lp-panel lp-chamfer-dual lp-crosshair mb-6 p-4 sm:p-5">
        <div className="mb-4 flex items-center justify-between gap-3">
          <div className="flex items-center gap-3"><span className="lp-icon-frame flex h-10 w-10 items-center justify-center border border-outline-variant bg-surface-mid text-on-surface-variant"><Trophy size={19} /></span><h2 className="font-heading text-lg font-bold">My Top Strengths</h2></div>
          <button onClick={() => setShowcaseOpen(true)} className="lp-chamfer-button flex items-center gap-2 border border-outline-variant bg-surface-low px-3 py-2 text-sm font-semibold text-on-surface-variant transition-colors hover:border-outline hover:bg-surface-high hover:text-on-surface"><Settings2 size={15} /> Customize</button>
        </div>
        <div className="grid gap-3 lg:grid-cols-3">
          <ShowcaseColumn icon={Award} label="Top skills" items={topSkills} kind="skill" onSelect={openSkill} />
          <ShowcaseColumn icon={BriefcaseBusiness} label="Top experiences" items={topExperiences} kind="record" onSelect={openExperience} />
          <ShowcaseColumn icon={FolderKanban} label="Top projects" items={topProjects} kind="record" onSelect={openExperience} />
        </div>
      </section>

      <section className="lp-panel lp-chamfer-dual lp-crosshair min-h-[420px] p-4 sm:p-5">
        <div className="mb-4 flex flex-col gap-3 border-b border-outline-variant pb-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-3">
            <span className="lp-icon-frame flex h-10 w-10 items-center justify-center border border-outline-variant bg-surface-mid text-on-surface-variant"><LibraryBig size={19} /></span>
            <h2 className="font-heading text-lg font-bold">Library</h2>
          </div>
          <label className="relative block sm:w-72"><span className="sr-only">Search the current library section</span><Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-on-surface-variant" /><input aria-label="Search the current library section" className={`${fieldClass} pl-9`} value={query} onChange={(e) => setQuery(e.target.value)} placeholder={`Search ${tab}`} /></label>
        </div>
        <div className="mb-5 grid grid-cols-2 gap-1 border border-outline-variant bg-surface-low p-1 sm:grid-cols-4">
          {subsectionItems.map((item) => <div key={item.value} className="relative min-w-0"><button aria-pressed={tab === item.value} onClick={() => setTab(item.value)} className={`lp-chamfer-chip w-full truncate px-3 py-2.5 text-left text-xs font-semibold uppercase tracking-wider transition-colors ${item.count > 0 ? "pr-10" : ""} ${tab === item.value ? "bg-brand text-on-brand" : "text-on-surface-variant hover:bg-surface-high hover:text-on-surface"}`}>{item.label} ({item.count})</button>{item.count > 0 && <button onClick={item.add} className={`absolute right-1.5 top-1/2 flex h-7 w-7 -translate-y-1/2 items-center justify-center border transition-colors ${tab === item.value ? "border-on-brand/40 text-on-brand hover:bg-on-brand/10" : "border-outline-variant text-on-surface-variant hover:border-outline hover:text-on-surface"}`} title={`Add ${item.label.toLowerCase()}`} aria-label={`Add ${item.label.toLowerCase()}`}><Plus size={13} /></button>}</div>)}
        </div>

        {loading ? <div className="flex min-h-64 items-center justify-center"><Loader2 size={30} className="animate-spin text-brand" /></div>
          : error ? <div className="flex min-h-64 flex-col items-center justify-center text-center"><p className="text-sm text-danger">{error}</p><button onClick={load} className="lp-chamfer-button mt-4 border border-outline-variant px-4 py-2 text-sm font-semibold hover:bg-surface-high">Try again</button></div>
          : tab === "skills" ? (
            filteredSkills.length ? <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
              {filteredSkills.map((skill) => {
                return <article key={skill.skill_id} className="lp-panel lp-panel-hover lp-chamfer-tr group flex min-h-48 flex-col p-4">
                  <div className="flex items-start justify-between gap-3"><div className="min-w-0"><p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-brand">{skill.category}</p><h2 className="mt-1 truncate font-heading text-xl font-bold">{skill.name}</h2></div><span className="lp-chamfer-chip border border-outline-variant px-2 py-1 text-[10px] font-semibold uppercase tracking-wider text-on-surface-variant">{skill.level}</span></div>
                  {skill.notes && <p className="mt-3 line-clamp-2 text-sm leading-5 text-on-surface-variant">{skill.notes}</p>}
                  <div className="mt-auto flex justify-end gap-1 border-t border-outline-variant pt-2 opacity-100 transition-opacity sm:opacity-0 sm:group-hover:opacity-100 sm:group-focus-within:opacity-100"><button onClick={() => navigate(`/resumes?libraryKind=skill&libraryId=${encodeURIComponent(skill.skill_id)}`)} className="flex items-center gap-1.5 px-2 py-1 text-xs font-semibold text-brand" title="Use in a resume"><FileText size={14} />Use in Resume</button><button onClick={() => openSkill(skill)} className="p-2 text-on-surface-variant hover:text-on-surface" title="Edit skill"><Pencil size={15} /></button><button onClick={() => setDeleting({ kind: "skill", item: skill })} className="p-2 text-on-surface-variant hover:text-danger" title="Delete skill"><Trash2 size={15} /></button></div>
                </article>;
              })}
            </div> : <EmptyState icon={Award} title={query ? "No matching skills" : "Build your skill set"} text={query ? "Try a different search." : "Add the abilities you want to reuse across applications, resumes, and interviews."} action={!query && <button onClick={() => openSkill()} className="lp-chamfer-button mt-4 bg-brand px-4 py-2.5 text-sm font-semibold text-on-brand"><Plus size={15} className="mr-2 inline" />Add your first skill</button>} />
          ) : filteredExperiences.length ? <div className="space-y-3">
            {filteredExperiences.map((item) => {
              const Icon = typeIcons[item.type] || FileBadge2;
              return <article key={item.experience_id} className="lp-panel lp-panel-hover lp-chamfer-tr group p-4 sm:p-5">
                <div className="flex items-start gap-3"><span className="lp-icon-frame flex h-11 w-11 shrink-0 items-center justify-center border border-outline-variant bg-surface-mid text-on-surface-variant"><Icon size={20} /></span><div className="min-w-0 flex-1"><div className="flex flex-col justify-between gap-2 sm:flex-row sm:items-start"><div><p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-brand">{item.type}</p><h2 className="mt-0.5 font-heading text-xl font-bold">{item.title}</h2><p className="mt-0.5 text-sm text-on-surface-variant">{[item.organization, dateRange(item)].filter(Boolean).join(" · ")}</p></div><div className="flex shrink-0 gap-1 opacity-100 transition-opacity sm:opacity-0 sm:group-hover:opacity-100 sm:group-focus-within:opacity-100"><button onClick={() => openExperience(item)} className="p-2 text-on-surface-variant hover:text-on-surface" title="Edit experience"><Pencil size={15} /></button><button onClick={() => setDeleting({ kind: "experience", item })} className="p-2 text-on-surface-variant hover:text-danger" title="Delete experience"><Trash2 size={15} /></button></div></div>
                  {item.description && <p className="mt-4 max-w-3xl text-sm leading-6 text-on-surface-variant">{item.description}</p>}
                  {item.outcome && <div className="mt-3 border-l-2 border-brand bg-brand/5 px-3 py-2 text-sm"><span className="font-semibold">Outcome:</span> {item.outcome}</div>}
                  {item.resume_bullet && <div className="mt-3 border border-outline-variant bg-surface-low px-3 py-2 text-sm"><span className="mr-2 text-xs font-semibold uppercase tracking-wider text-on-surface-variant">Resume bullet</span>{item.resume_bullet}</div>}
                  <button onClick={() => navigate(`/resumes?libraryKind=record&libraryId=${encodeURIComponent(item.experience_id)}`)} className="mt-3 flex items-center gap-1.5 text-xs font-semibold text-brand hover:underline"><FileText size={14} />Use in Resume</button>
                  <div className="mt-4 flex flex-wrap items-center gap-2">{item.skill_ids?.map((id) => skillById[id] && <span key={id} className="lp-chamfer-chip border border-outline-variant bg-surface-high px-2.5 py-1 text-xs">{skillById[id].name}</span>)}{item.link && <a href={item.link} target="_blank" rel="noreferrer" className="ml-auto inline-flex items-center gap-1 text-xs font-semibold text-brand hover:underline">Open link <ExternalLink size={12} /></a>}</div>
                </div></div>
              </article>;
            })}
          </div> : <EmptyState icon={BookOpenCheck} title={query ? `No matching ${tab}` : `No ${tab} yet`} text={query ? "Try a different search." : `Add your first ${tab === "projects" ? "project" : tab === "accomplishments" ? "accomplishment" : "experience"} to the Library.`} action={!query && <button onClick={() => openExperience(null, tab === "projects" ? "Project" : tab === "accomplishments" ? "Accomplishment" : "Work")} className="lp-chamfer-button mt-4 bg-brand px-4 py-2.5 text-sm font-semibold text-on-brand"><Plus size={15} className="mr-2 inline" />Add {tab === "projects" ? "project" : tab === "accomplishments" ? "accomplishment" : "experience"}</button>} />}
      </section>

      <SkillForm open={skillOpen} onOpenChange={setSkillOpen} initial={editingSkill} onSaved={load} />
      <ExperienceForm open={experienceOpen} onOpenChange={setExperienceOpen} initial={editingExperience} defaultType={experiencePreset} skills={library.skills} onSaved={load} />
      <ShowcaseForm open={showcaseOpen} onOpenChange={setShowcaseOpen} library={library} onSaved={load} />
      <AlertDialog open={!!deleting} onOpenChange={(open) => !open && setDeleting(null)}>
        <AlertDialogContent className="border-outline-variant bg-surface-mid text-on-surface">
          <AlertDialogHeader><AlertDialogTitle className="font-heading">Remove {deleting?.kind}?</AlertDialogTitle><AlertDialogDescription className="text-on-surface-variant">{deleting?.kind === "skill" ? "The skill will be unlinked from your experience records. Those records will remain intact." : "This record and its saved details will be permanently removed."}</AlertDialogDescription></AlertDialogHeader>
          <AlertDialogFooter><AlertDialogCancel className="border-outline-variant bg-surface-low text-on-surface hover:bg-surface-high">Cancel</AlertDialogCancel><AlertDialogAction onClick={remove} className="bg-danger text-background hover:brightness-110">Remove</AlertDialogAction></AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Layout>
  );
}

function EmptyState({ icon: Icon, title, text, action }) {
  return <div className="flex min-h-64 flex-col items-center justify-center px-4 text-center"><span className="lp-icon-frame mb-4 flex h-14 w-14 items-center justify-center border border-outline-variant bg-surface-low text-on-surface-variant"><Icon size={25} /></span><h2 className="font-heading text-xl font-bold">{title}</h2><p className="mt-2 max-w-md text-sm leading-6 text-on-surface-variant">{text}</p>{action}</div>;
}
