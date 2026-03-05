import { useEffect, useMemo, useState } from "react";
import { Link, NavLink, useLocation } from "react-router-dom";
import {
  Brain,
  BriefcaseBusiness,
  CreditCard,
  FileText,
  Gauge,
  History,
  LibraryBig,
  LogOut,
  Menu,
  Medal,
  MessageCircle,
  Shield,
  User2,
  Video,
  X
} from "lucide-react";
import { ThemeToggle } from "./ThemeToggle";

const NAV_ITEMS = [
  { to: "/", label: "Dashboard", icon: Gauge },
  { to: "/profile", label: "Profile", icon: User2 },
  { to: "/interview", label: "Interview Practice", icon: Brain },
  { to: "/resume-builder", label: "AI Resume Builder", icon: FileText },
  { to: "/career-counselling", label: "Career Counselling", icon: MessageCircle },
  { to: "/jobs", label: "Jobs", icon: BriefcaseBusiness },
  { to: "/subscriptions", label: "Subscriptions", icon: CreditCard },
  { to: "/question-bank", label: "Question Bank", icon: LibraryBig },
  { to: "/replay-hub", label: "Replay Hub", icon: Video },
  { to: "/history", label: "History", icon: History },
  { to: "/leaderboard", label: "Leaderboard", icon: Medal },
  { to: "/admin", label: "Admin Panel", icon: Shield, adminOnly: true }
];

function navClass({ isActive }) {
  return [
    "inline-flex w-full items-center gap-2 rounded-xl px-3 py-2 text-sm font-semibold transition",
    isActive
      ? "bg-brand-500 text-white shadow-soft"
      : "text-slate-200 hover:bg-white/10 hover:text-white"
  ].join(" ");
}

export function AppLayout({ user, onLogout, children }) {
  const location = useLocation();
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [isOnline, setIsOnline] = useState(() =>
    typeof navigator === "undefined" ? true : navigator.onLine
  );
  const navItems = useMemo(() => {
    if (user?.role === "admin") {
      return NAV_ITEMS.filter((item) => item.adminOnly);
    }
    return NAV_ITEMS.filter((item) => !item.adminOnly);
  }, [user?.role]);

  const currentLabel =
    navItems.find(
      (item) =>
        location.pathname === item.to ||
        (item.to !== "/" && location.pathname.startsWith(`${item.to}/`))
    )?.label || "Dashboard";
  const userDisplayName = String(user?.name || "Candidate").trim() || "Candidate";
  const userFirstName = userDisplayName.split(/\s+/)[0] || userDisplayName;
  const userInitial = userFirstName.charAt(0).toUpperCase();
  const userEmail = String(user?.email || "Signed in user").trim() || "Signed in user";

  useEffect(() => {
    setMobileNavOpen(false);
  }, [location.pathname]);

  useEffect(() => {
    if (!mobileNavOpen) {
      return undefined;
    }

    const previousOverflow = document.body.style.overflow;
    const closeOnEscape = (event) => {
      if (event.key === "Escape") {
        setMobileNavOpen(false);
      }
    };

    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", closeOnEscape);

    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", closeOnEscape);
    };
  }, [mobileNavOpen]);

  useEffect(() => {
    const onOnline = () => setIsOnline(true);
    const onOffline = () => setIsOnline(false);
    window.addEventListener("online", onOnline);
    window.addEventListener("offline", onOffline);
    return () => {
      window.removeEventListener("online", onOnline);
      window.removeEventListener("offline", onOffline);
    };
  }, []);

  return (
    <div className="min-h-screen text-slate-900 dark:text-slate-100">
      <div className="sticky top-0 z-40 border-b border-slate-200 bg-white/95 px-4 py-3 backdrop-blur md:hidden dark:border-slate-800 dark:bg-slate-950/95">
        <div className="flex items-center justify-between gap-3">
          <button
            type="button"
            onClick={() => setMobileNavOpen(true)}
            className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-700 transition hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
            aria-label="Open navigation menu"
          >
            <Menu size={18} />
          </button>

          <div className="flex min-w-0 flex-1 items-center gap-2">
            <div className="min-w-0">
              <p className="truncate font-display text-sm font-bold">AI Interview Platform</p>
              <p className="truncate text-[11px] text-slate-500 dark:text-slate-400">{currentLabel}</p>
            </div>
          </div>

          <ThemeToggle />
        </div>
        <div className="mt-2 flex flex-wrap items-center gap-2 text-[11px] font-semibold text-slate-600 dark:text-slate-300">
          <span className="rounded-full bg-slate-100 px-2.5 py-1 dark:bg-slate-800">
            Points {Number(user?.points || 0)}
          </span>
          <span className="rounded-full bg-slate-100 px-2.5 py-1 dark:bg-slate-800">
            Streak {Number(user?.streak || 0)}
          </span>
          <span className={["rounded-full px-2.5 py-1", isOnline ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-200" : "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-200"].join(" ")}>
            {isOnline ? "Online" : "Offline Mode"}
          </span>
        </div>
      </div>

      <div className={["fixed inset-0 z-50 md:hidden", mobileNavOpen ? "" : "pointer-events-none"].join(" ")}>
        <div
          className={[
            "absolute inset-0 bg-slate-950/60 transition-opacity duration-200",
            mobileNavOpen ? "opacity-100" : "opacity-0"
          ].join(" ")}
          onClick={() => setMobileNavOpen(false)}
          aria-hidden="true"
        />

        <aside
          className={[
            "absolute left-0 top-0 flex h-full w-[min(88vw,320px)] flex-col overflow-y-auto border-r border-slate-700 bg-slate-950 text-slate-100 shadow-2xl transition-transform duration-200",
            mobileNavOpen ? "translate-x-0" : "-translate-x-full"
          ].join(" ")}
        >
          <div className="flex items-center justify-between border-b border-slate-800 px-4 py-4">
            <div className="flex min-w-0 items-center gap-2">
              <div className="min-w-0">
                <p className="truncate font-display text-base font-bold text-white">AI Interview Platform</p>
                <p className="truncate text-xs text-slate-400">AI Interview Platform</p>
              </div>
            </div>
            <button
              type="button"
              onClick={() => setMobileNavOpen(false)}
              className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-slate-700 bg-slate-900 text-slate-200 transition hover:bg-slate-800"
              aria-label="Close navigation menu"
            >
              <X size={16} />
            </button>
          </div>

          <nav className="space-y-1 p-3">
            {navItems.map((item) => {
              const Icon = item.icon;
              return (
                <NavLink key={item.to} to={item.to} className={navClass} end={item.to === "/"}>
                  <Icon size={15} />
                  {item.label}
                </NavLink>
              );
            })}
          </nav>

          <div className="border-t border-slate-800 p-3">
            <div className="rounded-lg border border-slate-700 bg-slate-900 p-3">
              <div className="flex items-center gap-2">
                <span className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-sky-500/20 text-xs font-bold text-sky-200 ring-1 ring-inset ring-sky-300/40">
                  {userInitial}
                </span>
                <p className="truncate text-sm font-semibold">{userDisplayName}</p>
              </div>
              <p className="mt-1 truncate text-xs text-slate-400">{userEmail}</p>
            </div>
            <button
              type="button"
              onClick={onLogout}
              className="mt-3 inline-flex w-full items-center justify-center gap-2 rounded-lg bg-rose-500 px-3 py-2 text-sm font-semibold text-white transition hover:bg-rose-600"
            >
              <LogOut size={15} />
              Sign Out
            </button>
          </div>
        </aside>
      </div>

      <div className="flex min-h-screen">
        <aside className="hidden w-72 shrink-0 flex-col overflow-y-auto border-r border-slate-800 bg-gradient-to-b from-slate-950 via-slate-900 to-slate-950 text-slate-100 md:flex">
          <div className="border-b border-slate-800 px-5 py-5">
            <p className="inline-flex items-center rounded-full border border-brand-300/40 bg-brand-500/15 px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.16em] text-brand-200">
              Interview OS
            </p>
            <div className="mt-2 flex items-center gap-2">
              <h1 className="truncate font-display text-xl font-extrabold text-white">AI Interview Platform</h1>
            </div>
            <p className="mt-1 text-xs text-slate-400">Practice. Score. Get Hired.</p>
          </div>

          <nav className="space-y-1 p-4">
            {navItems.map((item) => {
              const Icon = item.icon;
              return (
                <NavLink
                  key={item.to}
                  to={item.to}
                  className={navClass}
                  end={item.to === "/"}
                >
                  <Icon size={15} />
                  {item.label}
                </NavLink>
              );
            })}
          </nav>

          <div className="border-t border-slate-800 p-4">
            <div className="rounded-lg border border-slate-700 bg-slate-900 p-3">
              <div className="flex items-center gap-2">
                <span className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-sky-500/20 text-xs font-bold text-sky-200 ring-1 ring-inset ring-sky-300/40">
                  {userInitial}
                </span>
                <p className="truncate text-sm font-semibold">{userDisplayName}</p>
              </div>
              <p className="mt-1 truncate text-xs text-slate-400">{userEmail}</p>
            </div>
            <button
              type="button"
              onClick={onLogout}
              className="mt-3 inline-flex w-full items-center justify-center gap-2 rounded-lg bg-rose-500 px-3 py-2 text-sm font-semibold text-white transition hover:bg-rose-600"
            >
              <LogOut size={15} />
              Sign Out
            </button>
          </div>
        </aside>

        <div className="flex min-h-screen flex-1 flex-col">
          <header className="sticky top-0 z-10 hidden border-b border-slate-200 bg-white/90 px-4 py-3 backdrop-blur md:block md:px-6 dark:border-slate-800 dark:bg-slate-950/90">
            <div className="flex items-center justify-between gap-3">
              <div>
                <h2 className="font-display text-lg font-bold">{currentLabel}</h2>
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  Welcome, {userDisplayName} | Points {user?.points || 0} | Streak {user?.streak || 0} | {isOnline ? "Online" : "Offline Mode"}
                </p>
              </div>
              <div className="flex items-center gap-2">
                {user?.role !== "admin" ? (
                  <>
                    <Link
                      to="/interview"
                      className="rounded-lg bg-slate-900 px-3 py-2 text-xs font-semibold text-white transition hover:bg-slate-800 dark:bg-slate-100 dark:text-slate-900 dark:hover:bg-slate-200"
                    >
                      Start Interview
                    </Link>
                    <Link
                      to="/subscriptions"
                      className="rounded-lg bg-brand-500 px-3 py-2 text-xs font-semibold text-white transition hover:bg-brand-600"
                    >
                      Upgrade
                    </Link>
                  </>
                ) : null}
                <ThemeToggle />
              </div>
            </div>
          </header>

          <main className="mx-auto grid w-full max-w-[1440px] gap-4 p-4 md:p-6">{children}</main>
        </div>
      </div>
    </div>
  );
}
