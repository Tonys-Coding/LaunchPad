import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@/context/AuthContext";
import api, { formatApiErrorDetail } from "@/lib/api";
import { Briefcase, Mail, Lock, User, ArrowRight, Loader2 } from "lucide-react";

export default function Login() {
  const { setUser } = useAuth();
  const navigate = useNavigate();
  const [mode, setMode] = useState("login");
  const [form, setForm] = useState({ email: "", password: "", name: "" });
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

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

  const googleLogin = () => {
    // REMINDER: DO NOT HARDCODE THE URL, OR ADD ANY FALLBACKS OR REDIRECT URLS, THIS BREAKS THE AUTH
    const redirectUrl = window.location.origin + "/dashboard";
    window.location.href = `https://auth.emergentagent.com/?redirect=${encodeURIComponent(redirectUrl)}`;
  };

  const useDemo = () => setForm({ email: "demo@careertrack.com", password: "demo1234", name: "" });

  return (
    <div className="min-h-screen flex bg-background text-on-surface">
      {/* Left brand panel */}
      <div className="hidden lg:flex flex-col justify-between w-[46%] p-12 bg-surface-lowest border-r border-outline-variant relative overflow-hidden">
        <div className="absolute -top-24 -right-24 w-96 h-96 rounded-full bg-brand-container/20 blur-3xl" />
        <div className="absolute bottom-0 -left-20 w-80 h-80 rounded-full bg-cyan-container/10 blur-3xl" />
        <div className="flex items-center gap-3 relative">
          <div className="w-10 h-10 rounded-full bg-brand flex items-center justify-center text-on-brand font-heading font-extrabold text-xl">C</div>
          <span className="font-heading text-2xl font-bold text-brand">CareerTrack</span>
        </div>
        <div className="relative">
          <h1 className="font-heading text-5xl font-extrabold leading-tight tracking-tight text-on-surface">
            Track every<br /><span className="text-brand">application.</span><br />Land the offer.
          </h1>
          <p className="mt-6 text-lg text-on-surface-variant max-w-md">
            Your personal job & internship command center. Log applications, monitor status, and watch your analytics come alive.
          </p>
        </div>
        <div className="relative flex gap-8 text-on-surface-variant">
          <div><p className="font-heading text-3xl font-bold text-cyan">124</p><p className="text-sm">Applications</p></div>
          <div><p className="font-heading text-3xl font-bold text-orange">18</p><p className="text-sm">Interviews</p></div>
          <div><p className="font-heading text-3xl font-bold text-brand">3</p><p className="text-sm">Offers</p></div>
        </div>
      </div>

      {/* Right form */}
      <div className="flex-1 flex items-center justify-center p-6">
        <div className="w-full max-w-md animate-fade-up">
          <div className="lg:hidden flex items-center gap-3 mb-8 justify-center">
            <div className="w-9 h-9 rounded-full bg-brand flex items-center justify-center text-on-brand font-heading font-extrabold">C</div>
            <span className="font-heading text-2xl font-bold text-brand">CareerTrack</span>
          </div>

          <div className="flex items-center gap-2 mb-2">
            <Briefcase className="text-brand" size={22} />
            <h2 className="font-heading text-3xl font-bold">{mode === "login" ? "Welcome back" : "Create account"}</h2>
          </div>
          <p className="text-on-surface-variant mb-8">
            {mode === "login" ? "Sign in to your tracker" : "Start tracking your applications"}
          </p>

          <button
            data-testid="google-login-button"
            onClick={googleLogin}
            className="w-full flex items-center justify-center gap-3 bg-surface-high hover:bg-surface-highest border border-outline-variant rounded-xl py-3 font-medium transition-colors mb-5"
          >
            <img src="https://www.svgrepo.com/show/475656/google-color.svg" alt="" className="w-5 h-5" />
            Continue with Google
          </button>

          <div className="flex items-center gap-4 mb-5">
            <div className="flex-1 h-px bg-outline-variant" />
            <span className="text-xs text-on-surface-variant uppercase tracking-wider">or</span>
            <div className="flex-1 h-px bg-outline-variant" />
          </div>

          {error && (
            <div data-testid="auth-error" className="mb-4 text-sm text-danger bg-danger/10 border border-danger/30 rounded-lg px-4 py-2.5">
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
              className="w-full bg-brand text-on-brand rounded-xl py-3 font-semibold flex items-center justify-center gap-2 hover:brightness-110 active:scale-[0.98] transition-all disabled:opacity-60"
            >
              {loading ? <Loader2 className="animate-spin" size={18} /> : <>{mode === "login" ? "Sign in" : "Create account"} <ArrowRight size={18} /></>}
            </button>
          </form>

          <button onClick={useDemo} data-testid="use-demo-credentials" className="mt-4 w-full text-sm text-cyan hover:underline">
            Use demo credentials
          </button>

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
        className="w-full bg-surface-low border border-outline-variant rounded-xl pl-11 pr-4 py-3 text-on-surface placeholder:text-on-surface-variant focus:border-brand focus:ring-2 focus:ring-brand/30 outline-none transition-all"
      />
    </div>
  );
}
