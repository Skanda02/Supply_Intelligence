import { useEffect, useState, type FormEvent } from "react";
import {
  Link,
  NavLink,
  Route,
  Routes,
  useLocation,
  useNavigate,
} from "react-router-dom";
import {
  ArrowLeftRight,
  Bell,
  Boxes,
  CalendarClock,
  ChevronsLeft,
  ClipboardList,
  Gauge,
  HeartPulse,
  LayoutDashboard,
  LifeBuoy,
  Menu,
  Scale,
  Search,
  Siren,
  TrendingUp,
  X,
} from "lucide-react";
import { AuthProvider, useAuth } from "./context/AuthContext";
import { getDashboardAlerts, type DashboardAlert } from "./api/forecast";
import Allocation from "./pages/Allocation";
import Dashboard from "./pages/Dashboard";
import Expiry from "./pages/Expiry";
import Forecast from "./pages/Forecast";
import Helpdesk from "./pages/Helpdesk";
import Inventory from "./pages/Inventory";
import Login from "./pages/Login";
import Priority from "./pages/Priority";
import Redistribution from "./pages/Redistribution";
import Requests from "./pages/Requests";
import Shortage from "./pages/Shortage";
import UserProfileMenu from "./components/UserProfileMenu";

interface NavItem {
  to: string;
  label: string;
  hint: string;
  icon: typeof LayoutDashboard;
}

// Only destinations that exist as routes in this project.
const NAV_ITEMS: NavItem[] = [
  { to: "/", label: "Overview", hint: "Command dashboard", icon: LayoutDashboard },
  { to: "/inventory", label: "Inventory", hint: "Stock management", icon: Boxes },
  { to: "/shortage-risk", label: "Stockout Prediction", hint: "Risk radar", icon: Siren },
  { to: "/forecast", label: "Demand Forecasting", hint: "AI projections", icon: TrendingUp },
  { to: "/expiry-risk", label: "Expiry & Wastage", hint: "Shelf-life tracking", icon: CalendarClock },
  { to: "/redistribution", label: "Transfers", hint: "Hospital to hospital", icon: ArrowLeftRight },
  { to: "/allocation", label: "Fair-Share", hint: "Need-based allocation", icon: Scale },
  { to: "/priority", label: "Priority", hint: "Network urgency", icon: Gauge },
  { to: "/requests", label: "Requests", hint: "Supply inbox", icon: ClipboardList },
  { to: "/helpdesk", label: "Helpdesk", hint: "AI support", icon: LifeBuoy },
];

function dayGreeting(): string {
  const h = new Date().getHours();
  if (h < 12) return "Good morning";
  if (h < 17) return "Good afternoon";
  return "Good evening";
}

function todayLabel(): string {
  return new Date().toLocaleDateString("en-IN", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  });
}

function AuthenticatedApp() {
  const { user } = useAuth();
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [alerts, setAlerts] = useState<DashboardAlert[]>([]);
  const [alertsOpen, setAlertsOpen] = useState(false);
  const location = useLocation();
  const navigate = useNavigate();

  // Close the mobile drawer + alerts panel on navigation.
  useEffect(() => {
    setMobileOpen(false);
    setAlertsOpen(false);
  }, [location.pathname]);

  // Live critical-alert count for the notification bell.
  useEffect(() => {
    if (!user?.id) return;
    let cancelled = false;
    getDashboardAlerts(user.id)
      .then((data) => {
        if (!cancelled) setAlerts(data);
      })
      .catch(() => {
        if (!cancelled) setAlerts([]);
      });
    return () => {
      cancelled = true;
    };
  }, [user?.id]);

  if (!user) {
    return <Login />;
  }

  function submitSearch(e: FormEvent) {
    e.preventDefault();
    const q = search.trim();
    navigate(q ? `/inventory?q=${encodeURIComponent(q)}` : "/inventory");
  }

  const sidebarWidth = collapsed ? "lg:pl-20" : "lg:pl-[264px]";

  const sidebarBody = (
    <div className="flex h-full flex-col">
      {/* Brand */}
      <Link to="/" className="flex items-center gap-3 px-5 pb-6 pt-6" aria-label="Supply Intelligence home">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-teal-400 to-emerald-500 text-slate-950 shadow-lg shadow-teal-500/30">
          <HeartPulse className="h-5 w-5" />
        </span>
        {!collapsed && (
          <span className="hidden min-w-0 lg:block">
            <span className="block truncate text-[15px] font-extrabold tracking-tight text-white">
              Supply Intelligence
            </span>
            <span className="block text-[11px] font-medium text-slate-400">
              Smart Hospital Inventory
            </span>
          </span>
        )}
        <span className="min-w-0 lg:hidden">
          <span className="block truncate text-[15px] font-extrabold tracking-tight text-white">
            Supply Intelligence
          </span>
          <span className="block text-[11px] font-medium text-slate-400">
            Smart Hospital Inventory
          </span>
        </span>
      </Link>

      {/* Facility chip */}
      <div className="px-4 pb-4">
        <div className="flex items-center gap-2.5 rounded-2xl border border-white/10 bg-white/[0.06] p-3 backdrop-blur-sm">
          <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br text-sm font-extrabold text-white ${user.avatarColor}`}>
            {user.name.charAt(0)}
          </span>
          {(!collapsed || typeof window === "undefined") && (
            <span className="hidden min-w-0 lg:block">
              <span className="block truncate text-xs font-bold text-white">{user.name}</span>
              <span className="block truncate text-[11px] text-teal-300/90">{user.code} · {user.region}</span>
            </span>
          )}
          <span className="min-w-0 lg:hidden">
            <span className="block truncate text-xs font-bold text-white">{user.name}</span>
            <span className="block truncate text-[11px] text-teal-300/90">{user.code} · {user.region}</span>
          </span>
        </div>
      </div>

      {/* Nav */}
      <nav className="flex-1 space-y-1 overflow-y-auto px-3 pb-4" aria-label="Primary">
        {!collapsed && (
          <p className="hidden px-3 pb-1 pt-1 text-[10px] font-bold uppercase tracking-[0.18em] text-slate-500 lg:block">
            Operations
          </p>
        )}
        {NAV_ITEMS.map((item) => {
          const Icon = item.icon;
          return (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.to === "/"}
              title={collapsed ? item.label : undefined}
              className={({ isActive }) =>
                `group relative flex items-center gap-3 rounded-xl px-3 py-2.5 text-[13px] font-semibold transition-all ${
                  isActive
                    ? "bg-gradient-to-r from-teal-500/20 to-emerald-500/10 text-white shadow-sm ring-1 ring-teal-400/30"
                    : "text-slate-400 hover:bg-white/[0.06] hover:text-white"
                } ${collapsed ? "justify-center lg:px-0" : ""}`
              }
            >
              {({ isActive }) => (
                <>
                  <span
                    className={`absolute left-0 top-1/2 h-6 w-1 -translate-y-1/2 rounded-full bg-gradient-to-b from-teal-300 to-emerald-400 transition-all ${
                      isActive ? "opacity-100" : "opacity-0 group-hover:opacity-40"
                    }`}
                    aria-hidden="true"
                  />
                  <Icon className={`h-[18px] w-[18px] shrink-0 ${isActive ? "text-teal-300" : "text-slate-500 group-hover:text-slate-200"}`} />
                  {!collapsed && (
                    <span className="hidden min-w-0 flex-1 lg:block">
                      <span className="block truncate">{item.label}</span>
                      <span className={`block truncate text-[11px] font-medium ${isActive ? "text-teal-200/70" : "text-slate-500"}`}>
                        {item.hint}
                      </span>
                    </span>
                  )}
                  <span className="min-w-0 flex-1 lg:hidden">
                    <span className="block truncate">{item.label}</span>
                    <span className="block truncate text-[11px] font-medium text-slate-500">
                      {item.hint}
                    </span>
                  </span>
                </>
              )}
            </NavLink>
          );
        })}
      </nav>

      {/* Collapse */}
      <div className="hidden border-t border-white/10 p-3 lg:block">
        <button
          type="button"
          onClick={() => setCollapsed((v) => !v)}
          className="flex w-full items-center justify-center gap-2 rounded-xl border border-white/10 bg-white/[0.04] px-3 py-2 text-xs font-bold text-slate-300 transition hover:bg-white/10 hover:text-white"
          aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
        >
          <ChevronsLeft className={`h-4 w-4 transition-transform duration-300 ${collapsed ? "rotate-180" : ""}`} />
          {!collapsed && <span>Collapse</span>}
        </button>
      </div>
    </div>
  );

  return (
    <div className="min-h-screen bg-[#eef3f6] text-slate-800 antialiased selection:bg-teal-500 selection:text-white">
      {/* Desktop sidebar */}
      <aside
        className={`fixed inset-y-0 left-0 z-40 hidden w-[264px] transition-all duration-300 lg:block ${
          collapsed ? "lg:w-20" : ""
        }`}
        aria-label="Sidebar"
      >
        <div className="h-full border-r border-slate-800 bg-gradient-to-b from-[#0a1a33] via-[#0b2140] to-[#0a1a33]">
          {sidebarBody}
        </div>
      </aside>

      {/* Mobile drawer */}
      {mobileOpen && (
        <div className="fixed inset-0 z-50 lg:hidden" role="dialog" aria-modal="true" aria-label="Navigation menu">
          <div className="absolute inset-0 bg-slate-950/60 backdrop-blur-sm" onClick={() => setMobileOpen(false)} />
          <aside className="absolute inset-y-0 left-0 w-[280px] max-w-[85vw] border-r border-slate-800 bg-gradient-to-b from-[#0a1a33] via-[#0b2140] to-[#0a1a33] shadow-2xl">
            <button
              type="button"
              onClick={() => setMobileOpen(false)}
              className="absolute right-3 top-5 rounded-lg p-1.5 text-slate-400 hover:bg-white/10 hover:text-white"
              aria-label="Close menu"
            >
              <X className="h-5 w-5" />
            </button>
            {sidebarBody}
          </aside>
        </div>
      )}

      {/* Content column */}
      <div className={`flex min-h-screen flex-col transition-all duration-300 ${sidebarWidth}`}>
        {/* Topbar */}
        <header className="sticky top-0 z-30 border-b border-slate-200/80 bg-white/90 backdrop-blur-md">
          <div className="mx-auto flex max-w-[1400px] flex-wrap items-center gap-x-4 gap-y-3 px-4 py-3 sm:px-6">
            <button
              type="button"
              onClick={() => setMobileOpen(true)}
              className="rounded-xl border border-slate-200 p-2 text-slate-600 hover:bg-slate-100 lg:hidden"
              aria-label="Open menu"
            >
              <Menu className="h-5 w-5" />
            </button>

            <div className="min-w-0 flex-1">
              <h1 className="truncate text-lg font-extrabold tracking-tight text-slate-900 sm:text-xl">
                {dayGreeting()}, Healthcare Team!
              </h1>
              <p className="truncate text-xs text-slate-500">
                Your real-time hospital supply intelligence overview · {todayLabel()}
              </p>
            </div>

            <form onSubmit={submitSearch} className="order-last w-full sm:order-none sm:w-auto sm:min-w-56 sm:flex-1 sm:max-w-xs" role="search">
              <label className="flex items-center gap-2 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 transition focus-within:border-teal-500 focus-within:bg-white focus-within:ring-2 focus-within:ring-teal-500/15">
                <Search className="h-4 w-4 shrink-0 text-slate-400" aria-hidden="true" />
                <span className="sr-only">Search inventory</span>
                <input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Search medicines, suppliers…"
                  className="w-full bg-transparent text-sm text-slate-800 outline-none placeholder:text-slate-400"
                />
              </label>
            </form>

            {/* Notifications */}
            <div className="relative">
              <button
                type="button"
                onClick={() => setAlertsOpen((v) => !v)}
                className="relative rounded-xl border border-slate-200 bg-white p-2.5 text-slate-600 transition hover:border-teal-300 hover:text-slate-900"
                aria-label={`Notifications, ${alerts.length} critical alerts`}
                aria-expanded={alertsOpen}
              >
                <Bell className="h-[18px] w-[18px]" />
                {alerts.length > 0 && (
                  <span className="absolute -right-1.5 -top-1.5 flex h-5 min-w-5 items-center justify-center rounded-full bg-rose-600 px-1 text-[10px] font-extrabold text-white ring-2 ring-white">
                    {alerts.length > 99 ? "99+" : alerts.length}
                  </span>
                )}
              </button>
              {alertsOpen && (
                <div className="absolute right-0 top-12 z-50 w-80 max-w-[calc(100vw-2rem)] overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl">
                  <div className="border-b border-slate-100 px-4 py-3">
                    <p className="text-sm font-extrabold text-slate-900">Critical alerts</p>
                    <p className="text-[11px] text-slate-500">Live stockout signals for {user.name}</p>
                  </div>
                  <div className="max-h-72 overflow-y-auto">
                    {alerts.length === 0 ? (
                      <p className="px-4 py-6 text-center text-xs text-slate-500">
                        No critical alerts — formulary looks healthy.
                      </p>
                    ) : (
                      alerts.slice(0, 5).map((a) => (
                        <Link
                          key={a.medicine_id}
                          to="/shortage-risk"
                          className="flex items-center gap-3 border-b border-slate-50 px-4 py-2.5 transition last:border-0 hover:bg-rose-50/60"
                        >
                          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-rose-100 text-rose-700">
                            <Siren className="h-4 w-4" />
                          </span>
                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-xs font-bold text-slate-900">{a.medicine_name}</span>
                            <span className="block text-[11px] text-slate-500">
                              {a.days_until_stockout != null ? `${a.days_until_stockout.toFixed(1)} days of cover` : "Below safety stock"} · {a.risk_level}
                            </span>
                          </span>
                        </Link>
                      ))
                    )}
                  </div>
                  <Link
                    to="/shortage-risk"
                    className="block bg-slate-50 px-4 py-2.5 text-center text-xs font-bold text-teal-700 transition hover:bg-teal-50"
                  >
                    Open stockout prediction
                  </Link>
                </div>
              )}
            </div>

            <UserProfileMenu />
          </div>
        </header>

        {/* Main */}
        <main className="mx-auto w-full max-w-[1400px] flex-1 px-4 py-6 sm:px-6">
          <Routes>
            <Route path="/" element={<Dashboard />} />
            <Route path="/inventory" element={<Inventory />} />
            <Route path="/forecast" element={<Forecast />} />
            <Route path="/shortage-risk" element={<Shortage />} />
            <Route path="/expiry-risk" element={<Expiry />} />
            <Route path="/redistribution" element={<Redistribution />} />
            <Route path="/allocation" element={<Allocation />} />
            <Route path="/priority" element={<Priority />} />
            <Route path="/requests" element={<Requests />} />
            <Route path="/helpdesk" element={<Helpdesk />} />
          </Routes>
        </main>

        <footer className="border-t border-slate-200 bg-white/70 py-3 text-xs text-slate-500">
          <div className="mx-auto flex max-w-[1400px] flex-col items-center justify-between gap-1 px-4 sm:flex-row sm:px-6">
            <p>
              <strong className="text-slate-700">{user.name}</strong> · {user.code} · Institutional Workspace
            </p>
            <p className="text-slate-400">MediPulse Supply Intelligence</p>
          </div>
        </footer>
      </div>
    </div>
  );
}

export default function App() {
  return (
    <AuthProvider>
      <AuthenticatedApp />
    </AuthProvider>
  );
}
