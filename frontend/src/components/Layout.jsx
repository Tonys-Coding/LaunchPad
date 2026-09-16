import { useEffect, useRef, useState } from "react";
import { NavLink, useNavigate } from "react-router-dom";
import { LayoutDashboard, Briefcase, Settings, Plus, LogOut, Menu, X, Home, List, Columns3, Sun, Moon, CalendarDays, LibraryBig } from "lucide-react";
import { useAuth } from "@/context/AuthContext";
import { useTheme } from "@/context/ThemeContext";
import { Avatar } from "@/components/Avatar";
import api from "@/lib/api";

const navItems = [
  { to: "/dashboard", label: "Dashboard", index: "01", icon: LayoutDashboard, testid: "nav-dashboard" },
  { to: "/applications", label: "Applications", index: "02", icon: Briefcase, testid: "nav-applications" },
  { to: "/board", label: "Board", index: "03", icon: Columns3, testid: "nav-board" },
  { to: "/calendar", label: "Calendar", index: "04", icon: CalendarDays, testid: "nav-calendar" },
  { to: "/library", label: "Career Library", index: "05", icon: LibraryBig, testid: "nav-library" },
  { to: "/settings", label: "Settings", index: "06", icon: Settings, testid: "nav-settings" },
];

const mobileNav = [
  { to: "/dashboard", label: "Home", icon: Home, testid: "mnav-dashboard" },
  { to: "/applications", label: "Apps", icon: List, testid: "mnav-applications" },
  { to: "/board", label: "Board", icon: Columns3, testid: "mnav-board" },
  { to: "/calendar", label: "Calendar", icon: CalendarDays, testid: "mnav-calendar" },
  { to: "/library", label: "Library", icon: LibraryBig, testid: "mnav-library" },
  { to: "/settings", label: "Profile", icon: Settings, testid: "mnav-settings" },
];

export function Layout({ children, title, onAddApplication, wide }) {
  const { user, setUser, logout } = useAuth();
  const { theme, toggle } = useTheme();
  const navigate = useNavigate();
  const [mobileOpen, setMobileOpen] = useState(false);
  const drawerCloseRef = useRef(null);
  const markFilter = theme === "light" ? "brightness(0)" : "brightness(0) invert(1)";

  const handleLogout = async () => {
    await logout();
    navigate("/login");
  };

  const handleThemeToggle = () => {
    const nextTheme = theme === "dark" ? "light" : "dark";
    toggle();
    api.put("/settings/preferences", {
      theme: nextTheme,
      timezone: user?.preferences?.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC",
    }).then(({ data }) => setUser(data)).catch(() => {});
  };

  useEffect(() => {
    if (!mobileOpen) return undefined;
    drawerCloseRef.current?.focus();
    const closeOnEscape = (event) => {
      if (event.key === "Escape") setMobileOpen(false);
    };
    document.addEventListener("keydown", closeOnEscape);
    return () => document.removeEventListener("keydown", closeOnEscape);
  }, [mobileOpen]);

  return (
    <div className="launchpad-shell min-h-screen flex bg-background text-on-surface">
      {/* Desktop Sidebar */}
      <aside className="fixed left-0 top-0 z-40 hidden h-screen w-72 flex-col border-r border-outline-variant bg-surface-lowest p-5 lg:flex">
        <div className="flex items-center gap-3 px-1 py-1">
          <div className="lp-chamfer-button flex h-11 w-11 items-center justify-center border border-outline bg-gradient-to-b from-on-surface/20 to-on-surface/5 p-px">
            <div className="lp-chamfer-button flex h-full w-full items-center justify-center bg-surface-low">
              <img src="/launchpad-mark.png" alt="Launchpad" className="h-7 w-7 object-contain" style={{ filter: markFilter }} />
            </div>
          </div>
          <div className="min-w-0">
            <h1 className="font-heading text-lg font-bold uppercase tracking-[0.12em] text-on-surface">Launchpad</h1>
            <p className="mt-0.5 text-[10px] font-label uppercase tracking-[0.13em] text-on-surface-variant">[ Career workspace ]</p>
          </div>
        </div>
        {onAddApplication && (
          <button
            data-testid="sidebar-add-application"
            onClick={onAddApplication}
            className="lp-chamfer-button mt-8 flex w-full items-center justify-center gap-2.5 border border-brand bg-brand px-4 py-3 text-sm font-bold uppercase tracking-wider text-on-brand shadow-[0_0_22px_rgb(var(--brand)/0.12)] transition-all hover:brightness-110 active:scale-[0.98]"
          >
            <Plus size={17} /> Add application
          </button>
        )}
        <nav className="mt-7 flex-1 space-y-1.5">
          {navItems.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              data-testid={item.testid}
              className={({ isActive }) =>
                `lp-chamfer-sm flex items-center justify-between border px-3.5 py-2.5 text-sm font-medium transition-all duration-200 ${
                  isActive
                    ? "border-brand bg-brand text-on-brand shadow-sm"
                    : "border-transparent text-on-surface-variant hover:border-outline-variant hover:bg-surface-mid hover:text-on-surface"
                }`
              }
            >
              <span className="flex items-center gap-3"><item.icon size={18} /><span className="font-heading text-sm font-medium tracking-normal">{item.index} // {item.label}</span></span>
              <span className="h-1.5 w-1.5 rotate-45 bg-current opacity-70" />
            </NavLink>
          ))}
        </nav>
        <div className="border-t border-outline-variant pt-4">
          <div className="lp-chamfer-sm flex items-center justify-between gap-2 border border-outline-variant bg-surface-low p-2.5">
            <div className="flex min-w-0 items-center gap-2.5">
              <Avatar src={user?.picture} name={user?.name || user?.email} size={34} />
              <div className="min-w-0">
                <p className="truncate text-xs font-semibold uppercase tracking-wide" data-testid="topbar-user-name">{user?.name || "User"}</p>
                <p className="truncate text-[10px] text-on-surface-variant">{user?.email}</p>
              </div>
            </div>
            <button data-testid="topbar-logout" aria-label="Log out" onClick={handleLogout} className="lp-chamfer-chip p-2 text-on-surface-variant transition-colors hover:bg-surface-high hover:text-danger" title="Log out"><LogOut size={16} /></button>
          </div>
        </div>
      </aside>

      {/* Main */}
      <main className="lp-grid flex min-h-screen min-w-0 flex-1 flex-col lg:ml-72">
        <header className="sticky top-0 z-30 border-b border-outline-variant bg-surface-lowest/90 backdrop-blur-md">
          <div className={`flex min-h-16 w-full items-center justify-between px-4 lg:px-8 ${wide ? "" : "max-w-[1280px] mx-auto"}`}>
            <div className="flex items-center gap-3">
              <button className="lp-chamfer-chip border border-outline-variant p-2 text-on-surface-variant lg:hidden" aria-label="Open navigation menu" aria-expanded={mobileOpen} aria-controls="mobile-navigation-drawer" onClick={() => setMobileOpen(true)} data-testid="mobile-menu-open">
                <Menu size={24} />
              </button>
              <div className="lg:hidden flex items-center gap-2">
                <img src="/launchpad-mark.png" alt="Launchpad" className="w-7 h-7 object-contain" style={{ filter: markFilter }} />
                <span className="font-heading text-base font-bold uppercase tracking-wider text-on-surface">Launchpad</span>
              </div>
              <div className="hidden items-center gap-2 lg:flex"><span className="text-xs text-outline">//</span><h2 className="font-heading text-base font-bold uppercase tracking-[0.12em] text-on-surface">{title}</h2></div>
            </div>
            <div className="flex items-center gap-3">
              <button
                data-testid="theme-toggle"
                onClick={handleThemeToggle}
                className="lp-chamfer-sm border border-outline-variant bg-surface-low p-2 text-on-surface-variant transition-colors hover:border-outline hover:text-on-surface"
                title={theme === "dark" ? "Switch to light mode" : "Switch to dark mode"}
                aria-label={theme === "dark" ? "Switch to light mode" : "Switch to dark mode"}
              >
                {theme === "dark" ? <Sun size={18} /> : <Moon size={18} />}
              </button>
              {onAddApplication && <button
                data-testid="topbar-add-application"
                onClick={onAddApplication}
                className="lp-chamfer-button hidden items-center gap-1.5 bg-brand px-3 py-2 text-sm font-semibold text-on-brand sm:flex lg:hidden"
              >
                <Plus size={16} /> Add
              </button>}
            </div>
          </div>
        </header>

        <div key={title} className={`lp-route-content min-w-0 flex-1 p-4 lg:p-8 w-full pb-24 lg:pb-8 ${wide ? "" : "max-w-[1280px] mx-auto"}`}>
          {children}
        </div>
      </main>

      {/* Mobile drawer */}
      {mobileOpen && (
        <div className="fixed inset-0 z-50 lg:hidden">
          <div className="absolute inset-0 bg-black/60" aria-hidden="true" onClick={() => setMobileOpen(false)} />
          <aside id="mobile-navigation-drawer" role="dialog" aria-modal="true" aria-label="Navigation menu" className="absolute left-0 top-0 flex h-full w-72 flex-col border-r border-outline-variant bg-surface-lowest p-5 animate-fade-up">
            <div className="flex items-center justify-between px-2 py-2">
              <div className="flex items-center gap-2">
                <img src="/launchpad-mark.png" alt="Launchpad" className="w-7 h-7 object-contain" style={{ filter: markFilter }} />
                <span className="font-heading text-lg font-bold uppercase tracking-wider text-on-surface">Launchpad</span>
              </div>
              <button ref={drawerCloseRef} aria-label="Close navigation menu" onClick={() => setMobileOpen(false)} className="text-on-surface-variant" data-testid="mobile-menu-close"><X size={22} /></button>
            </div>
            <nav className="mt-8 flex-1 space-y-1.5">
              {navItems.map((item) => (
                <NavLink
                  key={item.to}
                  to={item.to}
                  onClick={() => setMobileOpen(false)}
                  className={({ isActive }) =>
                    `lp-chamfer-sm flex items-center gap-3 border px-4 py-3 text-sm font-medium ${
                      isActive ? "border-brand bg-brand text-on-brand" : "border-transparent text-on-surface-variant hover:border-outline-variant hover:bg-surface-low hover:text-on-surface"
                    }`
                  }
                >
                  <item.icon size={20} /> <span className="font-heading tracking-normal">{item.index} // {item.label}</span>
                </NavLink>
              ))}
            </nav>
            {onAddApplication && <button onClick={() => { setMobileOpen(false); onAddApplication(); }} className="lp-chamfer-button mb-2 flex w-full items-center justify-center gap-2 bg-brand py-2.5 font-semibold text-on-brand">
              <Plus size={18} /> Add Application
            </button>}
          </aside>
        </div>
      )}

      {/* Mobile bottom nav */}
      <nav className="fixed bottom-0 left-0 z-40 flex h-16 w-full items-center justify-around border-t border-outline-variant bg-surface-lowest/95 backdrop-blur-md lg:hidden">
        {mobileNav.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            data-testid={item.testid}
            className={({ isActive }) =>
              `lp-chamfer-chip flex min-w-0 flex-1 flex-col items-center justify-center gap-0.5 py-1.5 ${isActive ? "bg-brand text-on-brand" : "text-on-surface-variant"}`
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
