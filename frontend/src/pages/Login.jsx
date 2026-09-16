import { useEffect, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { useAuth } from "@/context/AuthContext";
import { useTheme } from "@/context/ThemeContext";
import api, { formatApiErrorDetail } from "@/lib/api";
import { Briefcase, Mail, Lock, User, ArrowRight, Loader2 } from "lucide-react";

export default function Login() {
  const { setUser } = useAuth();
  const { theme } = useTheme();
  const markFilter = theme === "light" ? "brightness(0)" : "brightness(0) invert(1)";
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [mode, setMode] = useState("login");
  const [form, setForm] = useState({ email: "", password: "", name: "" });
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [googleEnabled, setGoogleEnabled] = useState(false);
  const [emailRegistrationEnabled, setEmailRegistrationEnabled] = useState(false);
  const [inviteOnly, setInviteOnly] = useState(false);

  useEffect(() => {
    api.get("/auth/providers")
      .then(({ data }) => {
        setGoogleEnabled(Boolean(data.google));
        setEmailRegistrationEnabled(data.email_registration !== false);
        setInviteOnly(Boolean(data.invite_only));
        if (data.email_registration === false) setMode("login");
      })
      .catch(() => setGoogleEnabled(false));
  }, []);

  useEffect(() => {
    const oauthError = searchParams.get("oauth_error");
    if (!oauthError) return;
    setError(
      oauthError === "access_denied"
        ? "Google sign-in was cancelled."
        : oauthError === "invite_required"
          ? "This Google account has not been invited to the LaunchPad beta."
          : "Google sign-in couldn't be completed. Please try again."
    );
  }, [searchParams]);

  const handle = (k) => (e) => setForm({ ...form, [k]: e.target.value });

  const submit = async (e) => {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      const path = mode === "login" ? "/auth/login" : "/auth/register";
      const payload =
        mode === "login"
          ? { email: form.email, password: form.password }
          : { email: form.email, password: form.password, name: form.name };
      const { data } = await api.post(path, payload);
      setUser(data);
      navigate("/dashboard");
    } catch (err) {
      setError(formatApiErrorDetail(err.response?.data?.detail) || err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="launchpad-shell lp-grid min-h-screen flex bg-background text-on-surface">
      {/* Left brand panel */}
      <div className="relative hidden w-[46%] flex-col justify-between overflow-hidden border-r border-outline-variant bg-surface-lowest p-12 lg:flex">
        <div className="absolute inset-0 opacity-40 [background-image:linear-gradient(rgb(var(--on-surface)/0.04)_1px,transparent_1px),linear-gradient(90deg,rgb(var(--on-surface)/0.04)_1px,transparent_1px)] [background-size:48px_48px]" />
        <div className="flex items-center gap-3 relative">
          <span className="lp-chamfer-button flex h-12 w-12 items-center justify-center border border-outline bg-surface-low"><img src="/launchpad-mark.png" alt="Launchpad" className="h-8 w-8 object-contain" style={{ filter: markFilter }} /></span>
          <div><span className="font-heading text-xl font-bold uppercase tracking-[0.13em] text-brand">Launchpad</span><p className="mt-0.5 text-[10px] uppercase tracking-[0.13em] text-on-surface-variant">[ Career workspace ]</p></div>
        </div>
        <div className="relative">
          <p className="lp-eyebrow mb-5 flex items-center gap-2"><span className="lp-status-dot" /> System ready</p>
          <h1 className="font-heading text-5xl font-extrabold uppercase leading-tight tracking-tight text-on-surface">
            Track every<br /><span className="text-brand">application.</span><br />Land the offer.
          </h1>
          <p className="mt-6 text-lg text-on-surface-variant max-w-md">
            Your personal job & internship command center. Log applications, monitor status, and watch your analytics come alive.
          </p>
        </div>
        <div className="relative grid grid-cols-3 border-y border-outline-variant py-4 text-on-surface-variant">
          <div><p className="font-heading text-3xl font-bold text-cyan">124</p><p className="text-xs uppercase tracking-wider">Applications</p></div>
          <div><p className="font-heading text-3xl font-bold text-orange">18</p><p className="text-xs uppercase tracking-wider">Interviews</p></div>
          <div><p className="font-heading text-3xl font-bold text-brand">3</p><p className="text-xs uppercase tracking-wider">Offers</p></div>
        </div>
      </div>

      {/* Right form */}
      <div className="flex-1 flex items-center justify-center p-6">
        <div className="lp-panel lp-chamfer-dual lp-crosshair w-full max-w-md p-7 animate-fade-up sm:p-9">
          <div className="lg:hidden flex items-center gap-3 mb-8 justify-center">
            <img src="/launchpad-mark.png" alt="Launchpad" className="w-9 h-9 object-contain" style={{ filter: markFilter }} />
            <span className="font-heading text-2xl font-bold text-brand">Launchpad</span>
          </div>

          <div className="flex items-center gap-2 mb-2">
            <Briefcase className="text-brand" size={22} />
            <h2 className="font-heading text-3xl font-bold">{mode === "login" ? "Welcome back" : "Create account"}</h2>
          </div>
          <p className="text-on-surface-variant mb-8">
            {mode === "login" ? "Sign in to your tracker" : "Start tracking your applications"}
          </p>

          {error && (
            <div data-testid="auth-error" className="lp-chamfer-sm mb-4 border border-danger/30 bg-danger/10 px-4 py-2.5 text-sm text-danger">
              {error}
            </div>
          )}

          <form onSubmit={submit} className="space-y-4">
            {mode === "register" && (
              <Field icon={User} placeholder="Full name" value={form.name} onChange={handle("name")} testid="auth-name" required />
            )}
            <Field icon={Mail} type="email" placeholder="Email address" value={form.email} onChange={handle("email")} testid="auth-email" required />
            <Field icon={Lock} type="password" placeholder="Password" value={form.password} onChange={handle("password")} testid="auth-password" required />

            <button
              data-testid="auth-submit"
              type="submit"
              disabled={loading}
              className="lp-chamfer-button flex w-full items-center justify-center gap-2 bg-brand py-3 font-semibold text-on-brand transition-all hover:brightness-110 active:scale-[0.98] disabled:opacity-60"
            >
              {loading ? <Loader2 className="animate-spin" size={18} /> : <>{mode === "login" ? "Sign in" : "Create account"} <ArrowRight size={18} /></>}
            </button>
          </form>

          {googleEnabled && (
            <>
              <div className="flex items-center gap-3 my-6 text-sm text-on-surface-variant" aria-hidden="true">
                <span className="h-px flex-1 bg-outline-variant" />
                <span>or</span>
                <span className="h-px flex-1 bg-outline-variant" />
              </div>
              <a
                href="/api/auth/google/start?return_to=/dashboard"
                className="lp-chamfer-button flex w-full items-center justify-center gap-3 border border-outline-variant bg-surface-low py-3 font-semibold text-on-surface transition-colors hover:bg-surface-high"
              >
                <span className="font-bold" aria-hidden="true">G</span>
                Continue with Google
              </a>
            </>
          )}

          {emailRegistrationEnabled ? (
            <p className="mt-6 text-center text-sm text-on-surface-variant">
              {mode === "login" ? "Don't have an account? " : "Already have an account? "}
              <button
                data-testid="toggle-auth-mode"
                onClick={() => { setMode(mode === "login" ? "register" : "login"); setError(""); }}
                className="text-brand font-medium hover:underline"
              >
                {mode === "login" ? "Sign up" : "Sign in"}
              </button>
            </p>
          ) : inviteOnly ? (
            <p className="mt-6 text-center text-sm text-on-surface-variant">New accounts require an invited Google account.</p>
          ) : null}
          <p className="mt-5 text-center text-xs text-on-surface-variant">
            By using LaunchPad, you agree to the <Link className="text-brand hover:underline" to="/terms">Terms</Link> and acknowledge the <Link className="text-brand hover:underline" to="/privacy">Privacy Policy</Link>.
          </p>
        </div>
      </div>
    </div>
  );
}

function Field({ icon: Icon, testid, ...props }) {
  return (
    <div className="relative">
      <Icon size={18} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-on-surface-variant" />
      <input
        {...props}
        data-testid={testid}
        className="lp-chamfer-button w-full border border-outline-variant bg-surface-low py-3 pl-11 pr-4 text-on-surface outline-none transition-all placeholder:text-on-surface-variant focus:border-brand focus:ring-2 focus:ring-brand/30"
      />
    </div>
  );
}
