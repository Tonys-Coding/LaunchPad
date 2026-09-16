import { useEffect, useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import {
  CalendarDays, Check, ChevronRight, Clock3, ExternalLink, KeyRound,
  DatabaseBackup, Download, Laptop, Link2, Loader2, LockKeyhole, LogOut, Mail,
  Moon, RefreshCw, ShieldCheck, Sun, Trash2, Unlink, UserRound, UsersRound,
} from "lucide-react";
import { toast } from "sonner";
import { Layout } from "@/components/Layout";
import { Avatar } from "@/components/Avatar";
import { useAuth } from "@/context/AuthContext";
import { useTheme } from "@/context/ThemeContext";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import api, { formatApiErrorDetail } from "@/lib/api";

const COMMON_TIMEZONES = [
  "UTC", "America/New_York", "America/Chicago", "America/Denver", "America/Los_Angeles",
  "America/Phoenix", "America/Anchorage", "Pacific/Honolulu", "America/Toronto",
  "America/Vancouver", "America/Mexico_City", "America/Sao_Paulo", "Europe/London",
  "Europe/Paris", "Europe/Berlin", "Europe/Madrid", "Europe/Rome", "Africa/Cairo",
  "Africa/Johannesburg", "Asia/Dubai", "Asia/Kolkata", "Asia/Singapore", "Asia/Shanghai",
  "Asia/Tokyo", "Asia/Seoul", "Australia/Sydney", "Pacific/Auckland",
];

const fieldClass = "w-full rounded-lg border border-outline-variant bg-surface-low px-3 py-2.5 text-sm text-on-surface outline-none transition-colors placeholder:text-on-surface-variant/60 focus:border-brand focus:ring-2 focus:ring-brand/30";
const labelClass = "mb-1.5 block text-xs font-label uppercase tracking-wider text-on-surface-variant";

function SectionHeading({ icon: Icon, title, description }) {
  return (
    <div className={`mb-4 flex gap-3 border-b border-outline-variant pb-3 ${description ? "items-start" : "items-center"}`}>
      <span className="lp-chamfer-chip flex h-10 w-10 shrink-0 items-center justify-center border border-outline-variant bg-surface-high text-brand"><Icon size={19} /></span>
      <div className={description ? "" : "translate-y-[2px]"}><h2 className="font-heading text-xl font-semibold leading-none">{title}</h2>{description && <p className="mt-0.5 text-sm text-on-surface-variant">{description}</p>}</div>
    </div>
  );
}

function StatusDot({ active }) {
  return <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${active ? "bg-emerald-500 shadow-[0_0_10px_rgb(16_185_129/0.45)]" : "bg-outline"}`} />;
}

export default function Settings() {
  const { user, setUser, logout } = useAuth();
  const { preference, setPreference } = useTheme();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const browserTimezone = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  const [name, setName] = useState(user?.name || "");
  const [themeChoice, setThemeChoice] = useState(user?.preferences?.theme || preference || "dark");
  const [timezone, setTimezone] = useState(user?.preferences?.timezone || browserTimezone);
  const [profileSaving, setProfileSaving] = useState(false);
  const [preferencesSaving, setPreferencesSaving] = useState(false);
  const [profileError, setProfileError] = useState("");
  const [preferencesError, setPreferencesError] = useState("");
  const [integration, setIntegration] = useState({ configured: false, connected: false });
  const [integrationLoading, setIntegrationLoading] = useState(true);
  const [integrationError, setIntegrationError] = useState("");
  const [password, setPassword] = useState({ current: "", next: "", confirm: "" });
  const [passwordSaving, setPasswordSaving] = useState(false);
  const [passwordError, setPasswordError] = useState("");
  const [confirmation, setConfirmation] = useState(null);
  const [confirming, setConfirming] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleteEmail, setDeleteEmail] = useState("");
  const [deleteError, setDeleteError] = useState("");
  const [deleting, setDeleting] = useState(false);
  const authProviders = user?.auth_providers || [user?.auth_provider || "email"];
  const signInMethod = authProviders.includes("google") && authProviders.includes("email") ? "Google + email and password" : authProviders.includes("google") ? "Google" : "Email and password";

  const timezones = useMemo(() => {
    const supported = typeof Intl.supportedValuesOf === "function" ? Intl.supportedValuesOf("timeZone") : [];
    return [...new Set([browserTimezone, timezone, ...COMMON_TIMEZONES, ...supported].filter(Boolean))].sort();
  }, [browserTimezone, timezone]);

  const loadIntegration = async () => {
    setIntegrationLoading(true);
    setIntegrationError("");
    try {
      const { data } = await api.get("/integrations/google-calendar");
      setIntegration(data);
    } catch (failure) {
      setIntegrationError(formatApiErrorDetail(failure.response?.data?.detail));
    } finally {
      setIntegrationLoading(false);
    }
  };

  useEffect(() => { loadIntegration(); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (searchParams.get("calendar_connected")) {
      toast.success("Google Calendar connected");
      loadIntegration();
    }
    if (searchParams.get("calendar_error")) toast.error("Google Calendar could not be connected. Please try again.");
    if (searchParams.has("calendar_connected") || searchParams.has("calendar_error")) setSearchParams({}, { replace: true });
  }, [searchParams, setSearchParams]); // eslint-disable-line react-hooks/exhaustive-deps

  const saveProfile = async (event) => {
    event.preventDefault();
    if (!name.trim()) return setProfileError("Enter a display name.");
    setProfileSaving(true);
    setProfileError("");
    try {
      const { data } = await api.put("/settings/profile", { name: name.trim() });
      setUser(data);
      setName(data.name);
      toast.success("Profile updated");
    } catch (failure) {
      setProfileError(formatApiErrorDetail(failure.response?.data?.detail));
    } finally {
      setProfileSaving(false);
    }
  };

  const savePreferences = async (event) => {
    event.preventDefault();
    setPreferencesSaving(true);
    setPreferencesError("");
    try {
      const { data } = await api.put("/settings/preferences", { theme: themeChoice, timezone: timezone.trim() });
      setUser(data);
      setPreference(data.preferences.theme);
      setTimezone(data.preferences.timezone);
      toast.success("Preferences saved");
    } catch (failure) {
      setPreferencesError(formatApiErrorDetail(failure.response?.data?.detail));
    } finally {
      setPreferencesSaving(false);
    }
  };

  const changePassword = async (event) => {
    event.preventDefault();
    if (password.next.length < 8 || password.next.length > 128) return setPasswordError("Your new password must be 8–128 characters.");
    if (password.next !== password.confirm) return setPasswordError("New passwords do not match.");
    setPasswordSaving(true);
    setPasswordError("");
    try {
      const { data } = await api.put("/settings/password", { current_password: password.current, new_password: password.next, confirm_password: password.confirm });
      setPassword({ current: "", next: "", confirm: "" });
      toast.success(data.revoked_sessions ? "Password changed and other devices signed out" : "Password changed");
    } catch (failure) {
      setPasswordError(formatApiErrorDetail(failure.response?.data?.detail));
    } finally {
      setPasswordSaving(false);
    }
  };

  const runConfirmedAction = async (event) => {
    event.preventDefault();
    setConfirming(true);
    try {
      if (confirmation === "calendar") {
        await api.delete("/integrations/google-calendar");
        setIntegration((current) => ({ ...current, connected: false, email: null }));
        toast.success("Google Calendar disconnected");
      } else {
        const { data } = await api.post("/settings/sessions/revoke-others");
        toast.success(data.revoked_sessions ? `${data.revoked_sessions} other session${data.revoked_sessions === 1 ? "" : "s"} signed out` : "No other signed-in devices found");
      }
      setConfirmation(null);
    } catch (failure) {
      toast.error(formatApiErrorDetail(failure.response?.data?.detail));
    } finally {
      setConfirming(false);
    }
  };

  const beginCalendarConnect = () => {
    const zone = user?.preferences?.timezone || browserTimezone;
    window.location.href = `/api/integrations/google-calendar/connect?return_to=/settings&timezone=${encodeURIComponent(zone)}`;
  };

  const handleLogout = async () => {
    await logout();
    navigate("/login");
  };

  const exportAccount = async () => {
    setExporting(true);
    try {
      const response = await api.get("/settings/export", { responseType: "blob" });
      const disposition = response.headers["content-disposition"] || "";
      const filename = disposition.match(/filename="?([^";]+)"?/i)?.[1] || "launchpad-account-export.zip";
      const url = URL.createObjectURL(response.data);
      const link = document.createElement("a");
      link.href = url;
      link.download = filename;
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
      toast.success("Account export downloaded");
    } catch {
      toast.error("Your account export could not be completed. Please try again.");
    } finally {
      setExporting(false);
    }
  };

  const deleteAccount = async (event) => {
    event.preventDefault();
    setDeleting(true);
    setDeleteError("");
    try {
      await api.delete("/settings/account", { data: { confirmation_email: deleteEmail.trim() } });
      setUser(false);
      navigate("/login", { replace: true });
      toast.success("Your LaunchPad account was deleted");
    } catch (failure) {
      setDeleteError(formatApiErrorDetail(failure.response?.data?.detail));
    } finally {
      setDeleting(false);
    }
  };

  return (
    <Layout title="Settings" wide>
      <div className="mx-auto max-w-6xl space-y-5">
        <div className="grid gap-5 lg:grid-cols-2">
          <section className="lp-panel lp-chamfer-dual lp-crosshair p-5 sm:p-6" data-testid="settings-profile">
            <SectionHeading icon={UserRound} title="Profile" />
            <div className="mb-5 flex items-center gap-4 rounded-lg border border-outline-variant bg-surface-low p-4">
              <Avatar src={user?.picture} name={user?.name || user?.email} size={58} />
              <div className="min-w-0"><p className="truncate font-semibold">{user?.name || "User"}</p><p className="truncate text-sm text-on-surface-variant">{user?.email}</p><p className="mt-1 text-xs text-on-surface-variant">Profile picture comes from your sign-in account.</p></div>
            </div>
            <form onSubmit={saveProfile} className="space-y-4">
              <div><label htmlFor="settings-name" className={labelClass}>Display name</label><input id="settings-name" className={fieldClass} value={name} maxLength={100} onChange={(event) => setName(event.target.value)} /></div>
              <div><label className={labelClass}>Email</label><div className="flex items-center gap-2 rounded-lg border border-outline-variant bg-surface-high/50 px-3 py-2.5 text-sm text-on-surface-variant"><Mail size={15} /><span className="truncate">{user?.email}</span><LockKeyhole size={13} className="ml-auto" /></div></div>
              <div><label className={labelClass}>Sign-in method</label><div className="flex items-center gap-2 text-sm"><ShieldCheck size={16} className="text-brand" />{signInMethod}</div></div>
              {profileError && <p className="rounded-lg border border-danger/30 bg-danger/10 px-3 py-2 text-sm text-danger" role="alert">{profileError}</p>}
              <div className="flex justify-end"><button type="submit" disabled={profileSaving || name.trim() === user?.name} className="lp-chamfer-button flex items-center gap-2 bg-brand px-5 py-2.5 text-sm font-semibold text-on-brand disabled:opacity-50">{profileSaving ? <Loader2 size={16} className="animate-spin" /> : <Check size={16} />}Save profile</button></div>
            </form>
          </section>

          <section className="lp-panel lp-chamfer-dual lp-crosshair p-5 sm:p-6" data-testid="settings-preferences">
            <SectionHeading icon={Sun} title="User Preferences" />
            <form onSubmit={savePreferences} className="space-y-5">
              <div><label className={labelClass}>Appearance</label><div className="grid grid-cols-3 gap-2 rounded-lg border border-outline-variant bg-surface-low p-1.5">{[["light", Sun, "Light"], ["dark", Moon, "Dark"], ["system", Laptop, "System"]].map(([value, Icon, text]) => <button key={value} type="button" aria-pressed={themeChoice === value} onClick={() => { setThemeChoice(value); setPreference(value); }} className={`flex items-center justify-center gap-2 rounded-md px-2 py-2.5 text-sm font-semibold transition-colors ${themeChoice === value ? "bg-brand text-on-brand" : "text-on-surface-variant hover:bg-surface-high hover:text-on-surface"}`}><Icon size={16} /><span className="hidden sm:inline">{text}</span></button>)}</div><p className="mt-2 text-xs text-on-surface-variant">System follows your device’s light or dark appearance.</p></div>
              <div><label htmlFor="settings-timezone" className={labelClass}>Timezone</label><div className="relative"><Clock3 size={16} className="pointer-events-none absolute left-3 top-3 text-on-surface-variant" /><input id="settings-timezone" list="settings-timezones" className={`${fieldClass} pl-9`} value={timezone} onChange={(event) => setTimezone(event.target.value)} placeholder="Search timezones" /><datalist id="settings-timezones">{timezones.map((zone) => <option key={zone} value={zone} />)}</datalist></div><p className="mt-2 text-xs text-on-surface-variant">Used as the default for new events, goals, and Calendar connections.</p></div>
              {preferencesError && <p className="rounded-lg border border-danger/30 bg-danger/10 px-3 py-2 text-sm text-danger" role="alert">{preferencesError}</p>}
              <div className="flex justify-end"><button type="submit" disabled={preferencesSaving} className="lp-chamfer-button flex items-center gap-2 bg-brand px-5 py-2.5 text-sm font-semibold text-on-brand disabled:opacity-50">{preferencesSaving ? <Loader2 size={16} className="animate-spin" /> : <Check size={16} />}Save preferences</button></div>
            </form>
          </section>
        </div>

        <section className="lp-panel lp-chamfer-tr lp-crosshair p-5 sm:p-6" data-testid="settings-connected-services">
          <SectionHeading icon={Link2} title="Connected Services" description="Manage services that work with your LaunchPad account." />
          <div className="flex flex-col gap-4 rounded-lg border border-outline-variant bg-surface-low p-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex min-w-0 items-start gap-3"><span className="lp-chamfer-chip flex h-11 w-11 shrink-0 items-center justify-center border border-outline-variant bg-surface-high"><CalendarDays size={21} /></span><div className="min-w-0"><div className="flex items-center gap-2"><p className="font-semibold">Google Calendar</p>{!integrationLoading && <StatusDot active={integration.connected} />}</div>{integrationLoading ? <p className="mt-1 flex items-center gap-2 text-sm text-on-surface-variant"><Loader2 size={14} className="animate-spin" />Checking connection</p> : integrationError ? <p className="mt-1 text-sm text-danger">Connection status unavailable.</p> : integration.connected ? <p className="mt-1 truncate text-sm text-on-surface-variant">Connected as {integration.email}</p> : <p className="mt-1 text-sm text-on-surface-variant">Send selected events to a dedicated LaunchPad calendar.</p>}</div></div>
            <div className="flex flex-wrap gap-2 sm:justify-end">{integrationError && <button type="button" onClick={loadIntegration} className="lp-chamfer-button flex items-center gap-2 border border-outline-variant px-3 py-2 text-sm font-semibold"><RefreshCw size={15} />Retry</button>}{!integrationLoading && integration.configured && <button type="button" onClick={beginCalendarConnect} className="lp-chamfer-button flex items-center gap-2 bg-brand px-4 py-2 text-sm font-semibold text-on-brand">{integration.connected ? "Change account" : "Connect"}<ExternalLink size={14} /></button>}{integration.connected && <button type="button" onClick={() => setConfirmation("calendar")} className="lp-chamfer-button flex items-center gap-2 border border-danger/30 px-3 py-2 text-sm font-semibold text-danger hover:bg-danger/10"><Unlink size={15} />Disconnect</button>}{!integrationLoading && !integration.configured && !integrationError && <span className="text-sm text-on-surface-variant">Not configured on this server</span>}</div>
          </div>
        </section>

        <section className="lp-panel lp-chamfer-dual lp-crosshair p-5 sm:p-6" data-testid="settings-security">
          <SectionHeading icon={ShieldCheck} title="Security" description="Manage your password and active sign-ins." />
          <div className="grid gap-6 lg:grid-cols-2 lg:divide-x lg:divide-outline-variant">
            <div className="lg:pr-6"><div className="mb-4 flex items-center gap-2"><KeyRound size={17} className="text-brand" /><h3 className="font-semibold">Change Password</h3></div>{user?.can_change_password ? <form onSubmit={changePassword} className="space-y-3"><div><label htmlFor="current-password" className={labelClass}>Current password</label><input id="current-password" type="password" autoComplete="current-password" className={fieldClass} value={password.current} onChange={(event) => setPassword((value) => ({ ...value, current: event.target.value }))} required /></div><div className="grid gap-3 sm:grid-cols-2"><div><label htmlFor="new-password" className={labelClass}>New password</label><input id="new-password" type="password" autoComplete="new-password" minLength={8} maxLength={128} className={fieldClass} value={password.next} onChange={(event) => setPassword((value) => ({ ...value, next: event.target.value }))} required /></div><div><label htmlFor="confirm-password" className={labelClass}>Confirm password</label><input id="confirm-password" type="password" autoComplete="new-password" minLength={8} maxLength={128} className={fieldClass} value={password.confirm} onChange={(event) => setPassword((value) => ({ ...value, confirm: event.target.value }))} required /></div></div><p className="text-xs text-on-surface-variant">Changing your password also signs out every other device.</p>{passwordError && <p className="rounded-lg border border-danger/30 bg-danger/10 px-3 py-2 text-sm text-danger" role="alert">{passwordError}</p>}<button type="submit" disabled={passwordSaving} className="lp-chamfer-button flex items-center gap-2 border border-outline-variant bg-surface-high px-4 py-2.5 text-sm font-semibold hover:bg-surface-highest disabled:opacity-50">{passwordSaving && <Loader2 size={16} className="animate-spin" />}Change password</button></form> : <div className="rounded-lg border border-outline-variant bg-surface-low p-4"><p className="font-medium">Managed by Google</p><p className="mt-1 text-sm text-on-surface-variant">This account signs in with Google, so password changes are handled in your Google Account.</p></div>}</div>
            <div className="space-y-3 lg:pl-6"><div className="mb-4 flex items-center gap-2"><UsersRound size={17} className="text-brand" /><h3 className="font-semibold">Sessions</h3></div><button type="button" onClick={() => setConfirmation("sessions")} className="lp-surface-hover flex w-full items-center gap-3 rounded-lg border border-outline-variant bg-surface-low p-4 text-left hover:bg-surface-high"><span className="lp-chamfer-chip flex h-10 w-10 shrink-0 items-center justify-center bg-surface-high"><LockKeyhole size={18} /></span><span><span className="block font-semibold">Sign out other devices</span><span className="mt-0.5 block text-sm text-on-surface-variant">Keep this device signed in.</span></span><ChevronRight size={17} className="ml-auto text-on-surface-variant" /></button><button type="button" onClick={handleLogout} data-testid="settings-logout" className="lp-surface-hover flex w-full items-center gap-3 rounded-lg border border-danger/30 bg-danger/5 p-4 text-left text-danger hover:bg-danger/10"><span className="lp-chamfer-chip flex h-10 w-10 shrink-0 items-center justify-center bg-danger/10"><LogOut size={18} /></span><span><span className="block font-semibold">Log out</span><span className="mt-0.5 block text-sm opacity-75">Sign out of LaunchPad on this device.</span></span><ChevronRight size={17} className="ml-auto opacity-75" /></button></div>
          </div>
        </section>

        <section className="lp-panel lp-chamfer-tr lp-crosshair p-5 sm:p-6" data-testid="settings-account-data">
          <SectionHeading icon={DatabaseBackup} title="Account Data" description="Download your information or permanently remove your account." />
          <div className="grid gap-4 lg:grid-cols-2">
            <div className="flex flex-col gap-4 rounded-lg border border-outline-variant bg-surface-low p-4 sm:flex-row sm:items-center">
              <span className="lp-chamfer-chip flex h-11 w-11 shrink-0 items-center justify-center border border-outline-variant bg-surface-high text-brand"><Download size={20} /></span>
              <div className="min-w-0 flex-1"><h3 className="font-semibold">Export my data</h3><p className="mt-1 text-sm text-on-surface-variant">Download a ZIP containing your LaunchPad records and attachments.</p></div>
              <button type="button" onClick={exportAccount} disabled={exporting} className="lp-chamfer-button flex shrink-0 items-center justify-center gap-2 border border-outline-variant px-4 py-2.5 text-sm font-semibold hover:bg-surface-high disabled:opacity-50">
                {exporting ? <Loader2 size={16} className="animate-spin" /> : <Download size={16} />} Download
              </button>
            </div>
            <div className="flex flex-col gap-4 rounded-lg border border-danger/30 bg-danger/5 p-4 sm:flex-row sm:items-center">
              <span className="lp-chamfer-chip flex h-11 w-11 shrink-0 items-center justify-center bg-danger/10 text-danger"><Trash2 size={20} /></span>
              <div className="min-w-0 flex-1"><h3 className="font-semibold text-danger">Delete account</h3><p className="mt-1 text-sm text-on-surface-variant">Permanently delete your records, sessions, connections, and files.</p></div>
              <button type="button" onClick={() => { setDeleteEmail(""); setDeleteError(""); setDeleteOpen(true); }} className="lp-chamfer-button shrink-0 border border-danger/40 px-4 py-2.5 text-sm font-semibold text-danger hover:bg-danger/10">
                Delete account
              </button>
            </div>
          </div>
          <p className="mt-4 text-xs text-on-surface-variant">See the <a href="/privacy" className="text-brand hover:underline">Privacy Policy</a> and <a href="/terms" className="text-brand hover:underline">Terms of Use</a>.</p>
        </section>
      </div>

      <AlertDialog open={!!confirmation} onOpenChange={(open) => !open && setConfirmation(null)}><AlertDialogContent className="border-outline-variant bg-surface-mid text-on-surface"><AlertDialogHeader><AlertDialogTitle className="font-heading">{confirmation === "calendar" ? "Disconnect Google Calendar?" : "Sign out other devices?"}</AlertDialogTitle><AlertDialogDescription className="text-on-surface-variant">{confirmation === "calendar" ? "LaunchPad will stop syncing events. Events already copied to Google Calendar will remain there." : "All other LaunchPad sessions will be signed out. This device will stay signed in."}</AlertDialogDescription></AlertDialogHeader><AlertDialogFooter><AlertDialogCancel disabled={confirming} className="border-outline-variant bg-transparent text-on-surface hover:bg-surface-low">Cancel</AlertDialogCancel><AlertDialogAction onClick={runConfirmedAction} disabled={confirming} className={`${confirmation === "calendar" ? "bg-danger hover:bg-danger/90" : "bg-brand text-on-brand hover:brightness-110"} flex items-center gap-2`}>{confirming && <Loader2 size={16} className="animate-spin" />}{confirmation === "calendar" ? "Disconnect" : "Sign out others"}</AlertDialogAction></AlertDialogFooter></AlertDialogContent></AlertDialog>

      <Dialog open={deleteOpen} onOpenChange={(open) => !deleting && setDeleteOpen(open)}>
        <DialogContent className="border-outline-variant bg-surface-mid text-on-surface">
          <DialogHeader>
            <DialogTitle className="font-heading text-xl">Permanently delete your account?</DialogTitle>
            <DialogDescription className="text-on-surface-variant">This removes your applications, events, Career Library, settings, sessions, integrations, and attachments. Events already sent to Google Calendar remain there.</DialogDescription>
          </DialogHeader>
          <form onSubmit={deleteAccount} className="space-y-4">
            <div className="border border-danger/30 bg-danger/10 p-3 text-sm text-danger">This cannot be undone. Download an export first if you want to keep a copy.</div>
            <div><label htmlFor="delete-account-email" className={labelClass}>Enter {user?.email} to confirm</label><input id="delete-account-email" type="email" autoComplete="email" className={fieldClass} value={deleteEmail} onChange={(event) => setDeleteEmail(event.target.value)} required /></div>
            {deleteError && <p className="rounded-lg border border-danger/30 bg-danger/10 px-3 py-2 text-sm text-danger" role="alert">{deleteError}</p>}
            <DialogFooter>
              <button type="button" disabled={deleting} onClick={() => setDeleteOpen(false)} className="lp-chamfer-button border border-outline-variant px-4 py-2.5 text-sm font-semibold hover:bg-surface-high disabled:opacity-50">Cancel</button>
              <button type="submit" disabled={deleting || deleteEmail.trim().toLowerCase() !== user?.email?.toLowerCase()} className="lp-chamfer-button flex items-center justify-center gap-2 bg-danger px-4 py-2.5 text-sm font-semibold text-background hover:brightness-110 disabled:opacity-40">{deleting && <Loader2 size={16} className="animate-spin" />}Delete permanently</button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </Layout>
  );
}
