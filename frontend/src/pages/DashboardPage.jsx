import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useNavigate } from "react-router-dom";
import { motion } from "framer-motion";
import { Activity, ArrowUpRight, Clock3, Medal, Target } from "lucide-react";
import { analyticsApi, profileApi, sessionApi } from "../lib/api";
import { useAuth } from "../context/AuthContext";
import { LoadingScreen } from "../components/LoadingScreen";
import { ProgressCharts } from "../components/charts/ProgressCharts";
import { getCompletedPracticeSessions } from "../lib/practiceStorage";
import { PracticeChatbotPanel } from "../components/PracticeChatbotPanel";

const MONTH_LABELS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const HEATMAP_LEVEL_CLASSES = ["bg-slate-100", "bg-emerald-100", "bg-emerald-200", "bg-emerald-400", "bg-emerald-500"];

function toDateKey(date) {
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  const day = String(date.getUTCDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function startOfUtcDay(date) {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

function getHeatLevel(count) {
  if (count <= 0) return 0;
  if (count === 1) return 1;
  if (count === 2) return 2;
  if (count === 3) return 3;
  return 4;
}

function getPracticeDate(session) {
  if (!session || session.status !== "completed") {
    return null;
  }

  const source = session.endedAt || session.updatedAt || session.createdAt;
  if (!source) {
    return null;
  }

  const date = new Date(source);
  if (Number.isNaN(date.getTime())) {
    return null;
  }

  return date;
}

function StatCard({ label, value, icon: Icon, tone }) {
  const toneClass =
    tone === "emerald"
      ? "from-emerald-500/15 to-emerald-100/70 text-emerald-700 dark:from-emerald-500/20 dark:to-emerald-500/5 dark:text-emerald-200"
      : tone === "amber"
        ? "from-amber-500/15 to-amber-100/70 text-amber-700 dark:from-amber-500/20 dark:to-amber-500/5 dark:text-amber-200"
        : tone === "cyan"
          ? "from-cyan-500/15 to-cyan-100/70 text-cyan-700 dark:from-cyan-500/20 dark:to-cyan-500/5 dark:text-cyan-200"
          : "from-brand-500/15 to-brand-100/70 text-brand-700 dark:from-brand-500/20 dark:to-brand-500/5 dark:text-brand-200";

  return (
    <div className="glass-panel panel-hover rounded-2xl p-4">
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">{label}</p>
        <span className={["inline-flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br", toneClass].join(" ")}>
          <Icon size={16} />
        </span>
      </div>
      <div className="mt-3 flex items-end justify-between">
        <p className="font-display text-3xl font-extrabold">{value}</p>
        <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-slate-500 dark:text-slate-300">
          Live
          <ArrowUpRight size={12} />
        </span>
      </div>
    </div>
  );
}

function MissionCard({ mission }) {
  const percent = mission.target ? Math.min(100, Math.round((Number(mission.progress || 0) / mission.target) * 100)) : 0;

  return (
    <div className="glass-panel rounded-xl p-3 panel-hover">
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm font-semibold">{mission.label}</p>
        <span
          className={[
            "rounded-full px-2 py-1 text-[11px] font-bold",
            mission.completed
              ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-500/20 dark:text-emerald-200"
              : "bg-slate-200 text-slate-700 dark:bg-slate-700 dark:text-slate-200"
          ].join(" ")}
        >
          {mission.completed ? "Done" : `${mission.progress}/${mission.target}`}
        </span>
      </div>
      <div className="mt-2 h-2 overflow-hidden rounded-full bg-slate-200/80 dark:bg-slate-700/60">
        <div className="h-full bg-brand-500" style={{ width: `${percent}%` }} />
      </div>
    </div>
  );
}

export function DashboardPage() {
  const navigate = useNavigate();
  const { token, user, logout } = useAuth();
  const [sessions, setSessions] = useState([]);
  const [analytics, setAnalytics] = useState(null);
  const [loading, setLoading] = useState(true);
  const [deletingAccount, setDeletingAccount] = useState(false);
  const [error, setError] = useState("");
  const currentYear = new Date().getFullYear();
  const [selectedYear, setSelectedYear] = useState(currentYear);

  useEffect(() => {
    let mounted = true;

    async function load() {
      setLoading(true);
      setError("");

      try {
        const [sessionPayload, analyticsPayload] = await Promise.all([
          sessionApi.list(token),
          analyticsApi.progress(token)
        ]);

        if (!mounted) {
          return;
        }

        setSessions(sessionPayload.sessions || []);
        setAnalytics(analyticsPayload);
      } catch (requestError) {
        if (mounted) {
          setError(requestError.message);
        }
      } finally {
        if (mounted) {
          setLoading(false);
        }
      }
    }

    load();

    return () => {
      mounted = false;
    };
  }, [token]);

  const stats = useMemo(() => {
    const completed = analytics?.completedSessions || 0;
    const average = analytics?.averageScore || 0;
    const inProgress = sessions.filter((session) => session.status === "in_progress").length;
    const best = sessions.reduce((top, session) => Math.max(top, Number(session.overallScore) || 0), 0);

    return [
      { label: "Completed Sessions", value: completed, icon: Medal, tone: "emerald" },
      { label: "Average Score", value: average, icon: Target, tone: "brand" },
      { label: "In Progress", value: inProgress, icon: Clock3, tone: "amber" },
      { label: "Best Score", value: best, icon: Activity, tone: "cyan" }
    ];
  }, [analytics, sessions]);

  const placementReadiness = useMemo(() => {
    const averageScore = Number(analytics?.averageScore || 0);
    const completed = Number(analytics?.completedSessions || 0);
    const momentumBonus = Math.min(12, completed * 2);
    return Math.max(0, Math.min(100, Math.round(averageScore * 0.85 + momentumBonus)));
  }, [analytics?.averageScore, analytics?.completedSessions]);

  const profileCompletion = useMemo(() => {
    const checks = [
      Boolean(user?.name),
      Boolean(user?.targetRole),
      Boolean(user?.experienceLevel),
      Boolean(user?.profileSummary),
      Boolean(user?.resumeText),
      Boolean(user?.preferredCompanies?.length)
    ];

    return Math.round((checks.filter(Boolean).length / checks.length) * 100);
  }, [user?.name, user?.targetRole, user?.experienceLevel, user?.profileSummary, user?.resumeText, user?.preferredCompanies]);

  const completedInterviews = useMemo(
    () => sessions.filter((session) => session.status === "completed").length,
    [sessions]
  );

  const questionsPracticed = useMemo(
    () => sessions.reduce((sum, session) => sum + Number(session?.answeredCount || 0), 0),
    [sessions]
  );

  const resumesCreated = user?.resumeText ? 1 : 0;

  const localPracticeSessions = useMemo(
    () => getCompletedPracticeSessions(user),
    [user?.id, user?.email]
  );

  const { practiceSessions, localOnlyPracticeCount } = useMemo(() => {
    if (!localPracticeSessions.length) {
      return { practiceSessions: sessions, localOnlyPracticeCount: 0 };
    }

    const existingIds = new Set(
      sessions
        .map((session) => String(session?.id || "").trim())
        .filter(Boolean)
    );

    const localOnly = localPracticeSessions.filter((entry) => {
      const id = String(entry.sessionId || "").trim();
      return id && !existingIds.has(id);
    });

    const normalizedLocal = localOnly.map((entry) => ({
      id: entry.sessionId,
      status: "completed",
      createdAt: entry.completedAt,
      updatedAt: entry.completedAt,
      endedAt: entry.completedAt
    }));

    return {
      practiceSessions: [...sessions, ...normalizedLocal],
      localOnlyPracticeCount: localOnly.length
    };
  }, [sessions, localPracticeSessions]);

  const contributionYears = useMemo(() => {
    const years = new Set([currentYear, currentYear - 1, currentYear - 2]);

    practiceSessions.forEach((session) => {
      const sessionDate = getPracticeDate(session);
      if (!sessionDate) return;
      years.add(sessionDate.getUTCFullYear());
    });

    return Array.from(years)
      .sort((a, b) => b - a)
      .slice(0, 4);
  }, [practiceSessions, currentYear]);

  useEffect(() => {
    if (!contributionYears.length) return;
    if (!contributionYears.includes(selectedYear)) {
      setSelectedYear(contributionYears[0]);
    }
  }, [contributionYears, selectedYear]);

  const contributionRange = useMemo(() => {
    if (selectedYear === currentYear) {
      const end = startOfUtcDay(new Date());
      const start = new Date(end);
      start.setUTCDate(start.getUTCDate() - 364);
      return { start, end };
    }

    return {
      start: new Date(Date.UTC(selectedYear, 0, 1)),
      end: new Date(Date.UTC(selectedYear, 11, 31))
    };
  }, [selectedYear, currentYear]);

  const contributionsByDay = useMemo(() => {
    const map = new Map();
    const startMs = contributionRange.start.getTime();
    const endMs = contributionRange.end.getTime();

    practiceSessions.forEach((session) => {
      const sessionDate = getPracticeDate(session);
      if (!sessionDate) return;
      const day = startOfUtcDay(sessionDate);
      const dayMs = day.getTime();
      if (dayMs < startMs || dayMs > endMs) return;
      const key = toDateKey(sessionDate);
      map.set(key, (map.get(key) || 0) + 1);
    });

    return map;
  }, [practiceSessions, contributionRange]);

  const contributionHeatmap = useMemo(() => {
    const rangeStart = contributionRange.start;
    const rangeEnd = contributionRange.end;

    const gridStart = new Date(rangeStart);
    gridStart.setUTCDate(gridStart.getUTCDate() - gridStart.getUTCDay());

    const gridEnd = new Date(rangeEnd);
    gridEnd.setUTCDate(gridEnd.getUTCDate() + (6 - gridEnd.getUTCDay()));

    const days = [];
    const rangeStartMs = rangeStart.getTime();
    const rangeEndMs = rangeEnd.getTime();

    for (let cursor = new Date(gridStart); cursor <= gridEnd; cursor.setUTCDate(cursor.getUTCDate() + 1)) {
      const date = new Date(cursor);
      const key = toDateKey(date);
      const time = date.getTime();
      days.push({
        date,
        key,
        count: contributionsByDay.get(key) || 0,
        inRange: time >= rangeStartMs && time <= rangeEndMs
      });
    }

    const weeks = [];
    for (let index = 0; index < days.length; index += 7) {
      weeks.push(days.slice(index, index + 7));
    }

    const monthMarks = [];
    let lastMonthKey = "";

    weeks.forEach((week, weekIndex) => {
      const dayInRange = week.find((day) => day.inRange && day.date.getUTCDate() <= 7) || week.find((day) => day.inRange);
      if (!dayInRange) return;
      const month = dayInRange.date.getUTCMonth();
      const year = dayInRange.date.getUTCFullYear();
      const monthKey = `${year}-${month}`;
      if (monthKey !== lastMonthKey) {
        monthMarks.push({
          label: MONTH_LABELS[month],
          column: weekIndex
        });
        lastMonthKey = monthKey;
      }
    });

    const totalSessions = days.reduce((sum, day) => (day.inRange ? sum + day.count : sum), 0);
    const totalPracticeDays = days.reduce((sum, day) => (day.inRange && day.count > 0 ? sum + 1 : sum), 0);

    return { weeks, monthMarks, totalSessions, totalPracticeDays };
  }, [contributionRange, contributionsByDay]);

  if (loading) {
    return <LoadingScreen label="Loading analytics dashboard..." />;
  }

  async function deleteAccountAndData() {
    const firstConfirm = window.confirm(
      "This will permanently delete your account and interview data from MongoDB. Continue?"
    );
    if (!firstConfirm) return;

    const typed = window.prompt("Type DELETE to permanently remove your account:");
    if (String(typed || "").trim().toUpperCase() !== "DELETE") {
      setError("Account deletion cancelled. Please type DELETE exactly.");
      return;
    }

    setDeletingAccount(true);
    setError("");
    try {
      await profileApi.deleteAccount(token, { confirmation: "DELETE" });
      await logout();
      navigate("/", { replace: true });
    } catch (requestError) {
      setError(requestError.message || "Unable to delete account.");
    } finally {
      setDeletingAccount(false);
    }
  }

  return (
    <div className="grid gap-4">
      {error ? <p className="rounded-xl bg-rose-100 px-3 py-2 text-sm font-semibold text-rose-700">{error}</p> : null}

      <motion.section
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.35 }}
        className="relative overflow-hidden rounded-2xl border border-white/40 bg-white/70 p-5 shadow-glass dark:border-white/10 dark:bg-slate-900/45"
      >
        <div className="pointer-events-none absolute right-0 top-0 h-36 w-36 rounded-full bg-brand-300/30 blur-3xl dark:bg-brand-500/20" />
        <div className="pointer-events-none absolute bottom-0 left-0 h-24 w-24 rounded-full bg-emerald-300/30 blur-3xl dark:bg-emerald-500/20" />
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <p className="inline-flex items-center rounded-full border border-brand-300/40 bg-brand-500/15 px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.16em] text-brand-700 dark:text-brand-200">
              Placement Readiness: {placementReadiness}/100
            </p>
            <h1 className="font-display text-3xl font-extrabold text-slate-900 dark:text-slate-100">
              Welcome, <span className="text-brand-600 dark:text-brand-300">{user?.name || "Candidate"}</span>
            </h1>
            <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">
              Complete your profile to unlock personalized recommendations and stronger interview outcomes.
            </p>
            <div className="mt-3 grid gap-1 text-xs font-semibold text-slate-700 dark:text-slate-200 sm:flex sm:flex-wrap sm:items-center sm:gap-4">
              <span>Resumes: {resumesCreated}</span>
              <span>Completed Interviews: {completedInterviews}</span>
              <span>Questions Practiced: {questionsPracticed}</span>
            </div>
          </div>
          <div className="grid w-full gap-2 sm:flex sm:w-auto sm:flex-wrap">
            <Link
              to="/interview"
              className="rounded-lg bg-slate-900 px-4 py-2 text-center text-sm font-semibold text-white transition hover:bg-slate-800 dark:bg-slate-100 dark:text-slate-900 dark:hover:bg-slate-200"
            >
              Start Interview
            </Link>
            <Link
              to="/profile"
              className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-center text-sm font-semibold text-slate-700 transition hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100 dark:hover:bg-slate-800"
            >
              Update Profile
            </Link>
            <button
              type="button"
              onClick={deleteAccountAndData}
              disabled={deletingAccount}
              className="rounded-lg border border-rose-300 bg-rose-50 px-4 py-2 text-center text-sm font-semibold text-rose-700 transition hover:bg-rose-100 disabled:opacity-60 dark:border-rose-700 dark:bg-rose-900/20 dark:text-rose-200 dark:hover:bg-rose-900/30"
            >
              {deletingAccount ? "Deleting..." : "Delete My Account Data"}
            </button>
          </div>
        </div>
        <div className="mt-4 grid gap-3 md:grid-cols-2">
          <div className="rounded-xl border border-slate-200 bg-white/80 p-3 dark:border-slate-700 dark:bg-slate-900/55">
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">Outcome Signal</p>
            <p className="mt-1 text-sm font-semibold text-slate-800 dark:text-slate-100">
              {placementReadiness >= 75 ? "Strong trajectory for interview conversion." : "Consistent practice can push conversion readiness higher."}
            </p>
          </div>
          <div className="rounded-xl border border-slate-200 bg-white/80 p-3 dark:border-slate-700 dark:bg-slate-900/55">
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">Next Milestone</p>
            <p className="mt-1 text-sm font-semibold text-slate-800 dark:text-slate-100">
              Reach {Math.max(80, Number(analytics?.averageScore || 0) + 5)}/100 average score and maintain a 7-day streak.
            </p>
          </div>
        </div>
        <div className="mt-4">
          <div className="mb-1 flex items-center justify-between text-xs font-semibold text-slate-600 dark:text-slate-300">
            <span>Profile completion</span>
            <span>{profileCompletion}%</span>
          </div>
          <div className="h-2 overflow-hidden rounded-full bg-slate-200 dark:bg-slate-700">
            <div className="h-full bg-gradient-to-r from-rose-500 to-brand-500" style={{ width: `${profileCompletion}%` }} />
          </div>
        </div>
      </motion.section>

      <motion.section
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.03, duration: 0.35 }}
        className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4"
      >
        {stats.map((item) => (
          <StatCard key={item.label} label={item.label} value={item.value} icon={item.icon} tone={item.tone} />
        ))}
      </motion.section>

      <motion.section
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.04, duration: 0.35 }}
      >
        <PracticeChatbotPanel targetRole={user?.targetRole || "Candidate"} />
      </motion.section>

      <motion.section
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.08, duration: 0.35 }}
        className="grid gap-4"
      >
        <ProgressCharts
          scoreTrend={analytics?.scoreTrend || []}
          categoryBreakdown={analytics?.categoryBreakdown || []}
          metricAverages={analytics?.metricAverages || []}
        />
      </motion.section>

      <motion.section
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.1, duration: 0.35 }}
        className="glass-panel rounded-2xl p-4"
      >
        <div className="flex flex-col gap-4 lg:flex-row">
          <div className="min-w-0 flex-1">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
              <h2 className="font-display text-lg font-semibold text-slate-900 dark:text-slate-100">
                {selectedYear === currentYear
                  ? `${contributionHeatmap.totalPracticeDays} practice day${contributionHeatmap.totalPracticeDays === 1 ? "" : "s"} in the last year`
                  : `${contributionHeatmap.totalPracticeDays} practice day${contributionHeatmap.totalPracticeDays === 1 ? "" : "s"} in ${selectedYear}`}
              </h2>
              <button
                type="button"
                className="inline-flex items-center gap-1 text-sm text-slate-500 transition hover:text-slate-700 dark:text-slate-300 dark:hover:text-slate-100"
              >
                Contribution settings
                <span className="text-[10px]">v</span>
              </button>
            </div>
            <p className="mb-3 text-xs text-slate-500 dark:text-slate-300">
              Completed interviews: {contributionHeatmap.totalSessions}
              {localOnlyPracticeCount ? ` (includes ${localOnlyPracticeCount} local entr${localOnlyPracticeCount === 1 ? "y" : "ies"})` : ""}
            </p>

            <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white p-3 dark:border-slate-700 dark:bg-slate-900">
              <div className="min-w-[780px]">
                <div
                  className="grid gap-[3px]"
                  style={{
                    gridTemplateColumns: `34px repeat(${contributionHeatmap.weeks.length}, 11px)`,
                    gridTemplateRows: "16px repeat(7, 11px)"
                  }}
                >
                  {contributionHeatmap.monthMarks.map((month) => (
                    <span
                      key={`${month.label}-${month.column}`}
                      className="text-[11px] leading-none text-slate-500 dark:text-slate-300"
                      style={{ gridColumn: month.column + 2, gridRow: 1 }}
                    >
                      {month.label}
                    </span>
                  ))}

                  <span className="text-[11px] leading-none text-slate-500 dark:text-slate-300" style={{ gridColumn: 1, gridRow: 3 }}>
                    Mon
                  </span>
                  <span className="text-[11px] leading-none text-slate-500 dark:text-slate-300" style={{ gridColumn: 1, gridRow: 5 }}>
                    Wed
                  </span>
                  <span className="text-[11px] leading-none text-slate-500 dark:text-slate-300" style={{ gridColumn: 1, gridRow: 7 }}>
                    Fri
                  </span>

                  {contributionHeatmap.weeks.map((week, weekIndex) =>
                    week.map((day, dayIndex) => {
                      const level = getHeatLevel(day.count);
                      const cellClass = day.inRange ? HEATMAP_LEVEL_CLASSES[level] : "bg-slate-50 dark:bg-slate-800";

                      return (
                        <span
                          key={day.key}
                          title={`${day.count} completed interview${day.count === 1 ? "" : "s"} on ${day.date.toLocaleDateString(undefined, {
                            year: "numeric",
                            month: "short",
                            day: "numeric",
                            timeZone: "UTC"
                          })}`}
                          style={{ gridColumn: weekIndex + 2, gridRow: dayIndex + 2 }}
                          className={`h-[11px] w-[11px] rounded-[2px] border border-slate-200 dark:border-slate-700 ${cellClass}`}
                        />
                      );
                    })
                  )}
                </div>
              </div>

              <div className="mt-3 flex items-center justify-between gap-2 text-xs text-slate-500 dark:text-slate-300">
                <p>Learn how we count contributions</p>
                <div className="flex items-center gap-1">
                  <span>Less</span>
                  {[0, 1, 2, 3, 4].map((level) => (
                    <span
                      key={`legend-${level}`}
                      className={`h-[11px] w-[11px] rounded-[2px] border border-slate-200 dark:border-slate-700 ${HEATMAP_LEVEL_CLASSES[level]}`}
                    />
                  ))}
                  <span>More</span>
                </div>
              </div>
            </div>
          </div>

          <div className="flex gap-2 lg:min-w-[96px] lg:flex-col">
            {contributionYears.map((year) => (
              <button
                key={year}
                type="button"
                onClick={() => setSelectedYear(year)}
                className={[
                  "rounded-xl px-3 py-2 text-sm font-semibold transition",
                  year === selectedYear
                    ? "bg-brand-500 text-white"
                    : "bg-white text-slate-600 hover:bg-slate-100 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800"
                ].join(" ")}
              >
                {year}
              </button>
            ))}
          </div>
        </div>
      </motion.section>

      <motion.section
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.12, duration: 0.35 }}
        className="glass-panel rounded-2xl p-4"
      >
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <h2 className="font-display text-lg font-bold">Weekly Goals & Missions</h2>
          <div className="flex items-center gap-2 text-xs font-semibold">
            <span className="rounded-full bg-white/70 px-2 py-1 dark:bg-slate-700/50">
              Streak: {analytics?.goals?.streak || 0}
            </span>
            <span className="rounded-full bg-white/70 px-2 py-1 dark:bg-slate-700/50">
              Points: {analytics?.goals?.points || 0}
            </span>
          </div>
        </div>
        <div className="grid gap-2 md:grid-cols-3">
          {(analytics?.goals?.missions || []).map((mission) => (
            <MissionCard key={mission.id} mission={mission} />
          ))}
          {!analytics?.goals?.missions?.length ? <p className="text-sm text-slate-600 dark:text-slate-300">No missions yet.</p> : null}
        </div>
      </motion.section>

      <motion.section
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.14, duration: 0.35 }}
        className="glass-panel rounded-2xl p-4"
      >
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <h2 className="font-display text-lg font-bold">Recent Sessions</h2>
          <Link
            to="/interview"
            className="rounded-xl bg-brand-500 px-3 py-2 text-xs font-semibold text-white transition hover:bg-brand-600"
          >
            Start New Interview
          </Link>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full min-w-[640px] text-left text-sm">
            <thead>
              <tr className="border-b border-white/30 text-slate-600 dark:border-white/10 dark:text-slate-300">
                <th className="py-2">Date</th>
                <th className="py-2">Category</th>
                <th className="py-2">Role</th>
                <th className="py-2">Company</th>
                <th className="py-2">Status</th>
                <th className="py-2">Score</th>
              </tr>
            </thead>
            <tbody>
              {sessions.slice(0, 8).map((session) => (
                <tr key={session.id} className="border-b border-white/20 transition hover:bg-white/50 last:border-0 dark:border-white/5 dark:hover:bg-slate-800/35">
                  <td className="py-2">{new Date(session.createdAt).toLocaleDateString()}</td>
                  <td className="py-2">{session.category}</td>
                  <td className="py-2">{session.targetRole}</td>
                  <td className="py-2">{session.companySimulation}</td>
                  <td className="py-2">{session.status.replace("_", " ")}</td>
                  <td className="py-2 font-semibold">{session.overallScore || "-"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </motion.section>
    </div>
  );
}
