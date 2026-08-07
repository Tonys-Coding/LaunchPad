import { useNavigate } from "react-router-dom";
import { Layout } from "@/components/Layout";
import { useAuth } from "@/context/AuthContext";
import { LogOut, Mail, User, ShieldCheck } from "lucide-react";

export default function Settings() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();

  const handleLogout = async () => {
    await logout();
    navigate("/login");
  };

  const rows = [
    { icon: User, label: "Name", value: user?.name || "—" },
    { icon: Mail, label: "Email", value: user?.email || "—" },
    { icon: ShieldCheck, label: "Sign-in method", value: user?.auth_provider === "google" ? "Google" : "Email & password" },
  ];

  return (
    <Layout title="Settings">
      <div className="max-w-2xl">
        <div className="bg-surface-low border border-surface-highest rounded-xl p-6 mb-6">
          <div className="flex items-center gap-4 mb-6">
            {user?.picture ? (
              <img src={user.picture} alt="" className="w-16 h-16 rounded-full object-cover border border-outline-variant" />
            ) : (
              <div className="w-16 h-16 rounded-full bg-brand-container flex items-center justify-center text-white text-2xl font-heading font-bold">
                {(user?.name || user?.email || "U")[0].toUpperCase()}
              </div>
            )}
            <div>
              <h2 className="font-heading text-2xl font-bold">{user?.name || "User"}</h2>
              <p className="text-on-surface-variant">{user?.email}</p>
            </div>
          </div>

          <div className="divide-y divide-outline-variant">
            {rows.map((r) => (
              <div key={r.label} className="flex items-center gap-3 py-3">
                <r.icon size={18} className="text-on-surface-variant" />
                <span className="text-sm text-on-surface-variant w-40">{r.label}</span>
                <span className="text-sm font-medium">{r.value}</span>
              </div>
            ))}
          </div>
        </div>

        <button onClick={handleLogout} data-testid="settings-logout" className="flex items-center gap-2 px-5 py-2.5 rounded-xl bg-danger/10 border border-danger/30 text-danger font-semibold hover:bg-danger/20 transition-colors">
          <LogOut size={18} /> Log out
        </button>
      </div>
    </Layout>
  );
}
