import { useState } from "react";
import { NavLink, useNavigate } from "react-router-dom";
import { LayoutDashboard, Briefcase, Settings, Plus, LogOut, Menu, X, Home, List } from "lucide-react";
import { useAuth } from "@/context/AuthContext";

const navItems = [
  { to: "/dashboard", label: "Dashboard", icon: LayoutDashboard, testid: "nav-dashboard" },
  { to: "/applications", label: "Applications", icon: Briefcase, testid: "nav-applications" },
  { to: "/settings", label: "Settings", icon: Settings, testid: "nav-settings" },
];

const mobileNav = [
  { to: "/dashboard", label: "Home", icon: Home, testid: "mnav-dashboard" },
  { to: "/applications", label: "Apps", icon: List, testid: "mnav-applications" },
  { to: "/settings", label: "Profile", icon: Settings, testid: "mnav-settings" },
];

export function Layout({ children, title, onAddApplication }) {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const [mobileOpen, setMobileOpen] = useState(false);

  const handleLogout = async () => {
    await logout();
    navigate("/login");
  };

  return (
    <div className="min-h-screen flex bg-background text-on-surface">
      {/* Desktop Sidebar */}
      <aside className="fixed left-0 top-0 h-screen w-64 hidden lg:flex flex-col border-r border-outline-variant bg-surface-lowest p-4 z-40">
        <div className="flex items-center gap-3 px-2 py-4">
          <div className="w-9 h-9 rounded-full bg-brand flex items-center justify-center text-on-brand font-heading font-extrabold text-lg">C</div>
          <div>
            <h1 className="font-heading text-xl font-bold text-brand leading-tight">CareerTrack</h1>
            <p className="text-[10px] tracking-wide text-on-surface-variant font-label">Manage your future</p>
          </div>
        </div>
        <nav className="flex-1 space-y-1 mt-6">
          {navItems.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              data-testid={item.testid}
              className={({ isActive }) =>
                `flex items-center gap-3 px-4 py-2.5 rounded-xl text-sm font-medium font-label transition-all duration-200 ${
                  isActive
                    ? "bg-cyan-container text-background"
                    : "text-cyan hover:bg-surface-low"
                }`
              }
            >
              <item.icon size={20} />
              {item.label}
            </NavLink>
          ))}
        </nav>
        <button
          data-testid="sidebar-add-application"
          onClick={onAddApplication}
          className="w-full bg-brand text-on-brand py-2.5 px-4 rounded-lg text-sm font-semibold font-label hover:brightness-110 active:scale-[0.98] transition-all flex items-center justify-center gap-2"
        >
          <Plus size={18} /> Add Application
        </button>
      </aside>

      {/* Main */}
      <main className="flex-1 lg:ml-64 flex flex-col min-h-screen">
        <header className="sticky top-0 z-30 bg-surface-lowest/90 backdrop-blur-md border-b border-outline-variant">
          <div className="flex justify-between items-center px-4 lg:px-8 py-3 max-w-[1280px] mx-auto w-full">
            <div className="flex items-center gap-3">
              <button className="lg:hidden text-cyan" onClick={() => setMobileOpen(true)} data-testid="mobile-menu-open">
                <Menu size={24} />
              </button>
              <div className="lg:hidden flex items-center gap-2">
                <div className="w-7 h-7 rounded-full bg-brand flex items-center justify-center text-on-brand font-heading font-bold text-sm">C</div>
                <span className="font-heading text-lg font-bold text-brand">CareerTrack</span>
              </div>
              <h2 className="hidden lg:block font-heading text-2xl font-bold text-on-surface">{title}</h2>
            </div>
            <div className="flex items-center gap-3">
              <button
                data-testid="topbar-add-application"
                onClick={onAddApplication}
                className="hidden sm:flex lg:hidden items-center gap-1.5 bg-brand text-on-brand py-2 px-3 rounded-lg text-sm font-semibold"
              >
                <Plus size={16} /> Add
              </button>
              <div className="flex items-center gap-2">
                {user?.picture ? (
                  <img src={user.picture} alt={user.name} className="w-9 h-9 rounded-full object-cover border border-outline-variant" />
                ) : (
                  <div className="w-9 h-9 rounded-full bg-brand-container flex items-center justify-center text-white font-semibold text-sm">
                    {(user?.name || user?.email || "U")[0].toUpperCase()}
                  </div>
                )}
                <div className="hidden md:block leading-tight">
                  <p className="text-sm font-medium text-on-surface" data-testid="topbar-user-name">{user?.name || "User"}</p>
                  <p className="text-[11px] text-on-surface-variant">{user?.email}</p>
                </div>
                <button data-testid="topbar-logout" onClick={handleLogout} className="text-on-surface-variant hover:text-danger p-2 rounded-full hover:bg-surface-low transition-colors" title="Log out">
                  <LogOut size={18} />
                </button>
              </div>
            </div>
          </div>
        </header>

        <div className="flex-1 p-4 lg:p-8 max-w-[1280px] mx-auto w-full pb-24 lg:pb-8">
          {children}
        </div>
      </main>

      {/* Mobile drawer */}
      {mobileOpen && (
        <div className="fixed inset-0 z-50 lg:hidden">
          <div className="absolute inset-0 bg-black/60" onClick={() => setMobileOpen(false)} />
          <aside className="absolute left-0 top-0 h-full w-64 bg-surface-lowest border-r border-outline-variant p-4 flex flex-col animate-fade-up">
            <div className="flex items-center justify-between px-2 py-2">
              <span className="font-heading text-xl font-bold text-brand">CareerTrack</span>
              <button onClick={() => setMobileOpen(false)} className="text-on-surface-variant" data-testid="mobile-menu-close"><X size={22} /></button>
            </div>
            <nav className="flex-1 space-y-1 mt-6">
              {navItems.map((item) => (
                <NavLink
                  key={item.to}
                  to={item.to}
                  onClick={() => setMobileOpen(false)}
                  className={({ isActive }) =>
                    `flex items-center gap-3 px-4 py-3 rounded-xl text-sm font-medium ${
                      isActive ? "bg-cyan-container text-background" : "text-cyan hover:bg-surface-low"
                    }`
                  }
                >
                  <item.icon size={20} /> {item.label}
                </NavLink>
              ))}
            </nav>
            <button onClick={() => { setMobileOpen(false); onAddApplication?.(); }} className="w-full bg-brand text-on-brand py-2.5 rounded-lg font-semibold flex items-center justify-center gap-2 mb-2">
              <Plus size={18} /> Add Application
            </button>
          </aside>
        </div>
      )}

      {/* Mobile bottom nav */}
      <nav className="fixed bottom-0 left-0 w-full z-40 flex justify-around items-center h-16 bg-surface-lowest border-t border-outline-variant lg:hidden">
        {mobileNav.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            data-testid={item.testid}
            className={({ isActive }) =>
              `flex flex-col items-center justify-center gap-0.5 w-16 py-1 rounded-lg ${isActive ? "text-brand" : "text-on-surface-variant"}`
            }
          >
            <item.icon size={22} />
            <span className="text-[10px] font-label">{item.label}</span>
          </NavLink>
        ))}
      </nav>
    </div>
  );
}
