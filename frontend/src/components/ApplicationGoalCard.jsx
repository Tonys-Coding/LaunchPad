import { useEffect, useState } from "react";
import { format, parseISO } from "date-fns";
import { CheckCircle2, Loader2, Pencil, Plus, Quote, RefreshCw, Sparkles, Target, Trash2 } from "lucide-react";
import { Progress } from "@/components/ui/progress";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { formatApiErrorDetail } from "@/lib/api";
import { useAuth } from "@/context/AuthContext";
import { dailyMotivationalQuote } from "@/lib/motivationalQuotes";

const GOAL_CONFETTI = Array.from({ length: 26 }, (_, index) => ({
  left: `${4 + ((index * 37) % 92)}%`,
  delay: `${(index * 47) % 420}ms`,
  duration: `${1900 + ((index * 83) % 900)}ms`,
  color: ["#67e8f9", "#a78bfa", "#facc15", "#4ade80", "#fb7185", "#f5f5f5"][index % 6],
  rotation: `${(index * 53) % 180}deg`,
}));

export function ApplicationGoalCard({ goal, loading, error, onRetry, onSave, onRemove, onAddApplication }) {
  const { user } = useAuth();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [removeOpen, setRemoveOpen] = useState(false);
  const [cadence, setCadence] = useState("weekly");
  const [target, setTarget] = useState("5");
  const [saving, setSaving] = useState(false);
  const [removing, setRemoving] = useState(false);
  const [formError, setFormError] = useState("");
  const [removeError, setRemoveError] = useState("");
  const [celebrating, setCelebrating] = useState(false);

  const configured = !!goal?.configured;
  const dailyQuote = configured ? dailyMotivationalQuote(goal.timezone) : null;

  useEffect(() => {
    if (!configured || !goal?.period_start) {
      setCelebrating(false);
      return undefined;
    }

    const storageKey = [
      "launchpad-goal-celebrated",
      user?.user_id || "current-user",
      goal.cadence,
      goal.period_start,
      goal.target,
    ].join(":");

    if (!goal.complete) {
      try { window.localStorage.removeItem(storageKey); } catch { /* Storage may be unavailable. */ }
      setCelebrating(false);
      return undefined;
    }

    let alreadyCelebrated = false;
    try { alreadyCelebrated = window.localStorage.getItem(storageKey) === "1"; } catch { /* Continue without persistence. */ }
    if (alreadyCelebrated) return undefined;

    try { window.localStorage.setItem(storageKey, "1"); } catch { /* The animation can still run. */ }
    setCelebrating(true);
    const timer = window.setTimeout(() => setCelebrating(false), 3600);
    return () => window.clearTimeout(timer);
  }, [configured, goal?.cadence, goal?.complete, goal?.period_start, goal?.target, user?.user_id]);

  const openEditor = () => {
    setCadence(configured ? goal.cadence : "weekly");
    setTarget(String(configured ? goal.target : 5));
    setFormError("");
    setDialogOpen(true);
  };

  const save = async () => {
    const numericTarget = Number(target);
    if (!Number.isInteger(numericTarget) || numericTarget < 1 || numericTarget > 100) {
      setFormError("Choose a whole number from 1 to 100.");
      return;
    }
    setSaving(true);
    setFormError("");
    try {
      await onSave({
        cadence,
        target: numericTarget,
        timezone: configured ? goal.timezone : user?.preferences?.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC",
      });
      setDialogOpen(false);
    } catch (failure) {
      setFormError(formatApiErrorDetail(failure.response?.data?.detail));
    } finally {
      setSaving(false);
    }
  };

  const remove = async (event) => {
    event.preventDefault();
    setRemoving(true);
    setRemoveError("");
    try {
      await onRemove();
      setRemoveOpen(false);
    } catch (failure) {
      setRemoveError(formatApiErrorDetail(failure.response?.data?.detail));
    } finally {
      setRemoving(false);
    }
  };

  if (loading) {
    return (
      <section className="lp-panel lp-chamfer-dual mb-6 min-h-36 animate-pulse p-5" aria-label="Loading application goal">
        <div className="h-5 w-40 rounded bg-surface-highest" />
        <div className="mt-6 h-3 rounded-full bg-surface-highest" />
        <div className="mt-4 h-4 w-56 rounded bg-surface-highest" />
      </section>
    );
  }

  if (error) {
    return (
      <section className="lp-panel lp-chamfer-dual mb-6 flex min-h-28 flex-col items-start justify-between gap-4 border-danger/30 p-5 sm:flex-row sm:items-center" data-testid="application-goal-error">
        <div>
          <h3 className="font-heading text-lg font-semibold">Application goal unavailable</h3>
          <p className="mt-1 text-sm text-on-surface-variant">Your other dashboard information is still up to date.</p>
        </div>
        <button type="button" onClick={onRetry} className="lp-chamfer-button flex items-center gap-2 border border-outline-variant px-4 py-2.5 text-sm font-semibold hover:bg-surface-mid">
          <RefreshCw size={16} /> Retry
        </button>
      </section>
    );
  }

  return (
    <>
      {celebrating && (
        <div className="lp-goal-celebration" role="status" aria-live="assertive" data-testid="application-goal-celebration">
          <div className="lp-goal-celebration-message lp-chamfer-dual">
            <span className="lp-goal-celebration-icon"><CheckCircle2 size={34} /></span>
            <div>
              <p className="flex items-center justify-center gap-2 text-xs font-label uppercase tracking-[0.16em] text-on-surface-variant"><Sparkles size={14} /> Goal complete</p>
              <p className="mt-1 font-heading text-2xl font-bold text-on-surface">You reached your {goal.cadence} application goal!</p>
            </div>
          </div>
          <div className="lp-goal-confetti-field" aria-hidden="true">
            {GOAL_CONFETTI.map((piece, index) => (
              <span
                key={index}
                className="lp-goal-confetti"
                style={{
                  "--lp-confetti-left": piece.left,
                  "--lp-confetti-delay": piece.delay,
                  "--lp-confetti-duration": piece.duration,
                  "--lp-confetti-color": piece.color,
                  "--lp-confetti-rotation": piece.rotation,
                }}
              />
            ))}
          </div>
        </div>
      )}
      {!configured ? (
        <section className="lp-panel lp-chamfer-dual lp-crosshair mb-6 flex min-h-32 flex-col justify-between gap-5 p-5 sm:flex-row sm:items-center" data-testid="application-goal-empty">
          <div className="flex items-center gap-4">
            <span className="lp-chamfer-button flex h-12 w-12 shrink-0 items-center justify-center bg-brand text-on-brand"><Target size={23} /></span>
            <div>
              <h3 className="font-heading text-xl font-semibold">Set an application goal</h3>
              <p className="mt-1 text-sm text-on-surface-variant">Choose a daily or weekly target.</p>
            </div>
          </div>
          <button type="button" onClick={openEditor} className="lp-chamfer-button bg-brand px-5 py-2.5 text-sm font-semibold text-on-brand hover:brightness-110" data-testid="application-goal-set">
            Set goal
          </button>
        </section>
      ) : (
        <section className="lp-panel lp-chamfer-dual lp-crosshair mb-6 overflow-hidden border-brand/30" data-testid="application-goal-card">
          <div className="grid gap-5 p-5 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-center lg:p-6">
            <div className="min-w-0">
              <div className="mb-4 flex flex-wrap items-center gap-3">
                <span className="lp-chamfer-button flex h-10 w-10 items-center justify-center bg-brand text-on-brand"><Target size={20} /></span>
                <div>
                  <p className="text-xs font-label uppercase tracking-wider text-on-surface-variant">{goal.cadence === "daily" ? "Daily goal" : "Weekly goal"}</p>
                  <div className="mt-0.5 flex flex-wrap items-center gap-2">
                    <h3 className="font-heading text-2xl font-bold">{goal.count} of {goal.target} applications</h3>
                    {goal.complete && <span className="flex items-center gap-1 rounded-full bg-brand px-2.5 py-1 text-xs font-semibold text-on-brand"><CheckCircle2 size={13} /> Goal met</span>}
                  </div>
                </div>
              </div>
              <Progress value={goal.progress_percent} aria-label={`${goal.progress_percent}% of application goal complete`} className="h-2.5 bg-surface-highest [&>div]:bg-brand" />
              <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-sm">
                <span className={goal.complete ? "font-semibold text-on-surface" : "text-on-surface-variant"}>
                  {goal.complete ? "Goal met" : `${goal.remaining} to go ${goal.cadence === "daily" ? "today" : "this week"}`}
                </span>
                <span className="text-on-surface-variant">
                  {goal.cadence === "daily"
                    ? "Resets tomorrow"
                    : `${goal.days_remaining === 0 ? "Resets tomorrow" : `${goal.days_remaining} day${goal.days_remaining === 1 ? "" : "s"} left`} · ${format(parseISO(goal.period_start), "MMM d")}–${format(parseISO(goal.period_end), "MMM d")}`}
                </span>
              </div>
              <div className="mt-4 flex items-start gap-2 border-t border-outline-variant pt-3 text-sm text-on-surface-variant" data-testid="application-goal-quote">
                <Quote size={15} className="mt-0.5 shrink-0 text-brand" aria-hidden="true" />
                <p>“{dailyQuote.text}”</p>
              </div>
            </div>
            <div className="flex flex-col gap-2 sm:flex-row lg:flex-col">
              <button type="button" onClick={onAddApplication} className="lp-chamfer-button flex items-center justify-center gap-2 bg-brand px-4 py-2.5 text-sm font-semibold text-on-brand hover:brightness-110" data-testid="application-goal-add">
                <Plus size={16} /> Add application
              </button>
              <button type="button" onClick={openEditor} className="lp-chamfer-button flex items-center justify-center gap-2 border border-outline-variant px-4 py-2.5 text-sm font-semibold text-on-surface hover:bg-surface-mid" data-testid="application-goal-edit">
                <Pencil size={15} /> Edit goal
              </button>
            </div>
          </div>
        </section>
      )}

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="border-outline-variant bg-surface-mid text-on-surface sm:max-w-md" data-testid="application-goal-dialog">
          <DialogHeader>
            <DialogTitle className="font-heading text-xl">{configured ? "Edit application goal" : "Set application goal"}</DialogTitle>
            <DialogDescription className="text-on-surface-variant">Choose how many applications you want to submit.</DialogDescription>
          </DialogHeader>
          <div className="space-y-5 py-2">
            <div>
              <label className="mb-2 block text-sm font-medium">Goal period</label>
              <div className="grid grid-cols-2 rounded-lg border border-outline-variant bg-surface-low p-1">
                {[['daily', 'Daily'], ['weekly', 'Weekly']].map(([value, label]) => (
                  <button key={value} type="button" aria-pressed={cadence === value} onClick={() => setCadence(value)} className={`rounded-md px-4 py-2 text-sm font-semibold transition-colors ${cadence === value ? "bg-brand text-on-brand" : "text-on-surface-variant hover:text-on-surface"}`} data-testid={`application-goal-${value}`}>
                    {label}
                  </button>
                ))}
              </div>
            </div>
            <div>
              <label htmlFor="application-goal-target" className="mb-2 block text-sm font-medium">Applications per {cadence === "daily" ? "day" : "week"}</label>
              <input id="application-goal-target" type="number" min="1" max="100" step="1" inputMode="numeric" value={target} onChange={(event) => setTarget(event.target.value)} className="w-full rounded-lg border border-outline-variant bg-surface-low px-3 py-2.5 text-sm text-on-surface outline-none focus:border-brand focus:ring-2 focus:ring-brand/30" data-testid="application-goal-target" />
            </div>
            {formError && <p className="rounded-lg border border-danger/30 bg-danger/10 px-3 py-2 text-sm text-danger" role="alert">{formError}</p>}
          </div>
          <DialogFooter className="gap-2 sm:justify-between sm:space-x-0">
            {configured ? (
              <button type="button" onClick={() => { setDialogOpen(false); setRemoveError(""); setRemoveOpen(true); }} className="flex items-center justify-center gap-2 rounded-lg px-3 py-2.5 text-sm font-semibold text-danger hover:bg-danger/10">
                <Trash2 size={15} /> Remove goal
              </button>
            ) : <span />}
            <div className="flex justify-end gap-2">
              <button type="button" onClick={() => setDialogOpen(false)} className="rounded-lg border border-outline-variant px-4 py-2.5 text-sm font-semibold text-on-surface-variant hover:bg-surface-low">Cancel</button>
              <button type="button" onClick={save} disabled={saving} className="flex items-center gap-2 rounded-lg bg-brand px-5 py-2.5 text-sm font-semibold text-on-brand hover:brightness-110 disabled:opacity-60" data-testid="application-goal-save">
                {saving && <Loader2 size={16} className="animate-spin" />} Save goal
              </button>
            </div>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={removeOpen} onOpenChange={setRemoveOpen}>
        <AlertDialogContent className="border-outline-variant bg-surface-mid text-on-surface">
          <AlertDialogHeader>
            <AlertDialogTitle className="font-heading">Remove application goal?</AlertDialogTitle>
            <AlertDialogDescription className="text-on-surface-variant">This removes the target only. Your applications stay unchanged.</AlertDialogDescription>
          </AlertDialogHeader>
          {removeError && <p className="rounded-lg border border-danger/30 bg-danger/10 px-3 py-2 text-sm text-danger" role="alert">{removeError}</p>}
          <AlertDialogFooter>
            <AlertDialogCancel disabled={removing} className="border-outline-variant bg-transparent text-on-surface hover:bg-surface-low">Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={remove} disabled={removing} className="flex items-center gap-2 bg-danger text-white hover:bg-danger/90" data-testid="application-goal-remove-confirm">
              {removing && <Loader2 size={16} className="animate-spin" />} Remove goal
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
