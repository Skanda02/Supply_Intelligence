import { useState } from "react";
import { Link, Navigate, NavLink, Route, Routes, useLocation } from "react-router-dom";
import {
  HeartPulse,
  Menu,
  X,
} from "lucide-react";
import { AuthProvider, useAuth } from "./context/AuthContext";
import Dashboard from "./pages/Dashboard";
import Expiry from "./pages/Expiry";
import Forecast from "./pages/Forecast";
import Helpdesk from "./pages/Helpdesk";
import Inventory from "./pages/Inventory";
import Login from "./pages/Login";
import SignUp from "./pages/SignUp";
import Priority from "./pages/Priority";
import Redistribution from "./pages/Redistribution";
import Requests from "./pages/Requests";
import Shortage from "./pages/Shortage";
import UserProfileMenu from "./components/UserProfileMenu";

interface NavLinkItem {
  to: string;
  label: string;
}

const NAV_LINKS: NavLinkItem[] = [
  { to: "/", label: "Dashboard" },
  { to: "/inventory", label: "Inventory" },
  { to: "/forecast", label: "Forecast" },
  { to: "/shortage-risk", label: "Shortages" },
  { to: "/expiry-risk", label: "Expiry" },
  { to: "/redistribution", label: "Transfers" },
  { to: "/priority", label: "Priority" },
  { to: "/requests", label: "Requests" },
  { to: "/helpdesk", label: "Helpdesk" },
];

function AuthenticatedApp() {
  const { user } = useAuth();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const location = useLocation();

  if (!user) {
    return location.pathname === "/signup" ? <SignUp /> : <Login />;
  }

  return (
    <div className="min-h-screen bg-slate-50 text-slate-800 flex flex-col selection:bg-indigo-500 selection:text-white">
      {/* Clean, Simple Top Menu Bar */}
      <header className="sticky top-0 z-40 border-b border-slate-200/80 bg-white/95 backdrop-blur-md">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
          <div className="flex h-14 items-center justify-between">
            {/* Clean Logo */}
            <Link to="/" className="flex items-center gap-2.5 group">
              <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-indigo-600 text-white shadow-xs transition-transform group-hover:scale-105">
                <HeartPulse className="h-4.5 w-4.5" />
              </div>
              <span className="text-base font-bold tracking-tight text-slate-900 group-hover:text-indigo-600 transition-colors">
                MediPulse
              </span>
            </Link>

            {/* Simple Clean Desktop Navigation Links */}
            <nav className="hidden md:flex items-center gap-1">
              {NAV_LINKS.map((item) => (
                <NavLink
                  key={item.to}
                  to={item.to}
                  end={item.to === "/"}
                  className={({ isActive }) =>
                    `rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors ${
                      isActive
                        ? "bg-slate-900 text-white"
                        : "text-slate-600 hover:bg-slate-100 hover:text-slate-900"
                    }`
                  }
                >
                  {item.label}
                </NavLink>
              ))}
            </nav>

            {/* Header Right: Clean Profile Menu & Mobile Toggle */}
            <div className="flex items-center gap-2">
              <UserProfileMenu />

              {/* Mobile Menu Button */}
              <button
                type="button"
                onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
                className="md:hidden rounded-lg p-1.5 text-slate-600 hover:bg-slate-100 hover:text-slate-900"
                aria-label="Toggle menu"
              >
                {mobileMenuOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
              </button>
            </div>
          </div>
        </div>

        {/* Mobile Navigation Dropdown */}
        {mobileMenuOpen && (
          <div className="md:hidden border-t border-slate-100 bg-white px-4 py-2 shadow-lg">
            <div className="space-y-1">
              {NAV_LINKS.map((item) => {
                const isActive =
                  item.to === "/"
                    ? location.pathname === "/"
                    : location.pathname.startsWith(item.to);

                return (
                  <Link
                    key={item.to}
                    to={item.to}
                    onClick={() => setMobileMenuOpen(false)}
                    className={`block rounded-lg px-3 py-2 text-xs font-semibold transition-colors ${
                      isActive
                        ? "bg-slate-900 text-white"
                        : "text-slate-700 hover:bg-slate-100"
                    }`}
                  >
                    {item.label}
                  </Link>
                );
              })}
            </div>
          </div>
        )}
      </header>

      {/* Main Content Area */}
      <main className="mx-auto max-w-7xl flex-1 px-4 sm:px-6 lg:px-8 py-6 w-full">
        <Routes>
          <Route path="/" element={<Dashboard />} />
          <Route path="/inventory" element={<Inventory />} />
          <Route path="/forecast" element={<Forecast />} />
          <Route path="/shortage-risk" element={<Shortage />} />
          <Route path="/expiry-risk" element={<Expiry />} />
          <Route path="/redistribution" element={<Redistribution />} />
          <Route path="/priority" element={<Priority />} />
          <Route path="/requests" element={<Requests />} />
          <Route path="/helpdesk" element={<Helpdesk />} />
          <Route path="/login" element={<Navigate to="/" replace />} />
          <Route path="/signup" element={<Navigate to="/" replace />} />
        </Routes>
      </main>

      {/* Clean, Simple Footer */}
      <footer className="mt-auto border-t border-slate-200 bg-white py-3 text-xs text-slate-500">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 flex flex-col sm:flex-row items-center justify-between gap-2">
          <p>
            <strong className="text-slate-700">{user.name}</strong> • Institutional Workspace
          </p>
          <p className="text-slate-400">MediPulse Supply Intelligence</p>
        </div>
      </footer>
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
