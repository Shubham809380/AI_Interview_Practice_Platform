import { useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  BarChart3,
  BookText,
  CreditCard,
  Database,
  Download,
  Pencil,
  Plus,
  RefreshCw,
  Save,
  ShieldCheck,
  Trash2,
  Users2,
  X } from
"lucide-react";
import { adminQuestionApi, analyticsApi, leaderboardApi } from "../lib/api";
import { useAuth } from "../context/AuthContext";
const ADMIN_CATEGORIES = ["HR", "Technical", "Behavioral", "Coding"];
const ADMIN_SOURCES = ["predefined", "ai", "resume"];
const ADMIN_DIFFICULTIES = ["beginner", "intermediate", "advanced"];
const EMPTY_QUESTION_FORM = {
  prompt: "",
  category: "HR",
  source: "predefined",
  difficulty: "intermediate",
  roleFocus: "General",
  companyContext: "General",
  tags: ""
};
function Card({ title, value, subtitle }) {
  return <article className="glass-panel rounded-xl p-4"><p className="text-sm text-slate-500 dark:text-slate-400">{title}</p><p className="mt-1 font-display text-3xl font-extrabold text-slate-900 dark:text-slate-100">{value}</p><p className="text-xs text-slate-500 dark:text-slate-400">{subtitle}</p></article>;
}
function toTagsInput(tags = []) {
  if (!Array.isArray(tags)) {
    return "";
  }
  return tags.join(", ");
}
function formatAdminDateTime(value) {
  const date = new Date(value || "");
  if (Number.isNaN(date.getTime())) {
    return "-";
  }
  return date.toLocaleString();
}
export function AdminPanelPage({ adminToken = "" }) {
  const { token } = useAuth();
  const tokenToUse = adminToken || token;
  const [overview, setOverview] = useState(null);
  const [leaderboard, setLeaderboard] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [dbReport, setDbReport] = useState(null);
  const [dbLoading, setDbLoading] = useState(false);
  const [dbError, setDbError] = useState("");
  const [selectedCollection, setSelectedCollection] = useState("");
  const [questionFilters, setQuestionFilters] = useState({
    search: "",
    category: "",
    source: ""
  });
  const [questionLoading, setQuestionLoading] = useState(false);
  const [questionError, setQuestionError] = useState("");
  const [questionMessage, setQuestionMessage] = useState("");
  const [questions, setQuestions] = useState([]);
  const [editingQuestionId, setEditingQuestionId] = useState("");
  const [questionForm, setQuestionForm] = useState(EMPTY_QUESTION_FORM);
  const [billing, setBilling] = useState(null);
  const [billingLoading, setBillingLoading] = useState(false);
  const [billingError, setBillingError] = useState("");
  const [billingMessage, setBillingMessage] = useState("");
  const [billingFilters, setBillingFilters] = useState({
    search: "",
    plan: "",
    status: ""
  });
  const [userMgmt, setUserMgmt] = useState(null);
  const [userMgmtLoading, setUserMgmtLoading] = useState(false);
  const [userMgmtError, setUserMgmtError] = useState("");
  const [userMgmtMessage, setUserMgmtMessage] = useState("");
  const [userMgmtBusyId, setUserMgmtBusyId] = useState("");
  const [sheetExportLoading, setSheetExportLoading] = useState(false);
  const [sheetExportMessage, setSheetExportMessage] = useState("");
  const [sheetExportError, setSheetExportError] = useState("");
  const [userMgmtFilters, setUserMgmtFilters] = useState({
    search: "",
    role: "",
    accountStatus: ""
  });
  useEffect(() => {
    let mounted = true;
    async function loadOverviewData() {
      setLoading(true);
      setError("");
      try {
        const [overviewPayload, leaderboardPayload] = await Promise.all([
        analyticsApi.adminOverview(tokenToUse),
        leaderboardApi.list(tokenToUse)]
        );
        if (!mounted) return;
        setOverview(overviewPayload || null);
        setLeaderboard(leaderboardPayload.leaderboard || []);
      } catch (requestError) {
        if (mounted) setError(requestError.message || "Admin metrics could not be loaded.");
      } finally {
        if (mounted) {
          setLoading(false);
        }
      }
    }
    if (tokenToUse) {
      loadOverviewData();
    }
    return () => {
      mounted = false;
    };
  }, [tokenToUse]);
  const loadQuestionBank = async (nextFilters = questionFilters) => {
    setQuestionLoading(true);
    setQuestionError("");
    try {
      const payload = await adminQuestionApi.list(tokenToUse, {
        search: nextFilters.search,
        category: nextFilters.category,
        source: nextFilters.source,
        limit: 120
      });
      setQuestions(payload.questions || []);
    } catch (requestError) {
      setQuestionError(requestError.message || "Unable to load question bank.");
    } finally {
      setQuestionLoading(false);
    }
  };
  useEffect(() => {
    if (!tokenToUse) return;
    loadQuestionBank(questionFilters);
  }, [tokenToUse]);
  const metrics = overview?.totals || {
    users: 0,
    sessions: 0,
    completed: 0,
    inProgress: 0,
    dropoffPercent: 0,
    averageScore: 0
  };
  const topRiskSessions = useMemo(
    () => (overview?.topRiskSessions || []).slice(0, 6),
    [overview?.topRiskSessions]
  );
  const alerts = overview?.alerts || [];
  const sourceBreakdown = overview?.sourceBreakdown || [];
  const categoryBreakdown = overview?.categoryBreakdown || [];
  const selectedCollectionTable = useMemo(
    () => (dbReport?.tables || []).find((item) => item.collection === selectedCollection) || (dbReport?.tables || [])[0] || null,
    [dbReport?.tables, selectedCollection]
  );
  const billingTotals = billing?.totals || {
    activePaidUsers: 0,
    activeProUsers: 0,
    activeEliteUsers: 0,
    totalPayments: 0,
    paidPayments: 0,
    pendingPayments: 0,
    expiredPayments: 0,
    revenueInrMonth: 0
  };
  const billingPayments = billing?.payments || [];
  const billingSubscribers = billing?.subscribers || [];
  const userMgmtTotals = userMgmt?.totals || {
    users: 0,
    active: 0,
    suspended: 0,
    admins: 0,
    flagged: 0
  };
  const userMgmtRows = userMgmt?.users || [];
  const securityEvents = overview?.recentIntegrityEvents || [];
  function exportAdminSnapshot() {
    const rows = [];
    rows.push(["Type", "Key", "Value"]);
    rows.push(["Totals", "Generated At", overview?.generatedAt || new Date().toISOString()]);
    rows.push(["Totals", "Users", metrics.users]);
    rows.push(["Totals", "Sessions", metrics.sessions]);
    rows.push(["Totals", "Completed", metrics.completed]);
    rows.push(["Totals", "In Progress", metrics.inProgress]);
    rows.push(["Totals", "Drop-off %", metrics.dropoffPercent]);
    rows.push(["Totals", "Average Score", metrics.averageScore]);
    sourceBreakdown.forEach((item) => {
      rows.push(["Source", item.source, `${item.count} (${item.percent}%)`]);
    });
    categoryBreakdown.forEach((item) => {
      rows.push(["Category", item.category, `sessions=${item.sessions}; avg=${item.averageScore}`]);
    });
    topRiskSessions.forEach((item, index) => {
      rows.push([
      "Risk",
      `Session ${index + 1}`,
      `${item.userName} | ${item.targetRole} | ${item.companySimulation} | progress=${item.progressPercent}% | age=${item.ageHours}h`]
      );
    });
    const csv = rows.map(
      (row) => row.map((cell) => {
        const value = String(cell ?? "");
        return /[",\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
      }).join(",")
    ).join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `admin-snapshot-${new Date().toISOString().slice(0, 10)}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  }
  function updateQuestionForm(key, value) {
    setQuestionForm((previous) => ({
      ...previous,
      [key]: value
    }));
  }
  async function loadDbReport() {
    setDbLoading(true);
    setDbError("");
    try {
      const payload = await analyticsApi.adminDbReport(tokenToUse, { limit: 80 });
      setDbReport(payload || null);
      const firstCollection = payload?.collections?.[0]?.name || "";
      setSelectedCollection(firstCollection);
    } catch (requestError) {
      setDbError(requestError.message || "Unable to load DB collections report.");
    } finally {
      setDbLoading(false);
    }
  }
  async function loadBillingData(nextFilters = billingFilters) {
    setBillingLoading(true);
    setBillingError("");
    try {
      const payload = await analyticsApi.adminBilling(tokenToUse, {
        search: nextFilters.search,
        plan: nextFilters.plan,
        status: nextFilters.status,
        limit: 180
      });
      setBilling(payload || null);
    } catch (requestError) {
      setBillingError(requestError.message || "Unable to load billing data.");
    } finally {
      setBillingLoading(false);
    }
  }
  useEffect(() => {
    if (!tokenToUse) return;
    loadBillingData(billingFilters);
  }, [tokenToUse]);
  async function applyBillingFilters(event) {
    event.preventDefault();
    await loadBillingData(billingFilters);
  }
  async function updateUserSubscription(userId, nextPlan, nextStatus, days) {
    setBillingError("");
    setBillingMessage("");
    try {
      const payload = await analyticsApi.adminUpdateSubscription(tokenToUse, userId, {
        plan: nextPlan,
        status: nextStatus,
        days,
        currency: "INR"
      });
      setBillingMessage(payload.message || "Subscription updated.");
      await loadBillingData(billingFilters);
    } catch (requestError) {
      setBillingError(requestError.message || "Unable to update subscription.");
    }
  }
  async function loadUserManagement(nextFilters = userMgmtFilters) {
    setUserMgmtLoading(true);
    setUserMgmtError("");
    try {
      const payload = await analyticsApi.adminUsers(tokenToUse, {
        search: nextFilters.search,
        role: nextFilters.role,
        accountStatus: nextFilters.accountStatus,
        limit: 240
      });
      setUserMgmt(payload || null);
    } catch (requestError) {
      setUserMgmtError(requestError.message || "Unable to load users.");
    } finally {
      setUserMgmtLoading(false);
    }
  }
  useEffect(() => {
    if (!tokenToUse) return;
    loadUserManagement(userMgmtFilters);
  }, [tokenToUse]);
  async function applyUserMgmtFilters(event) {
    event.preventDefault();
    await loadUserManagement(userMgmtFilters);
  }
  async function updateManagedUser(userId, patch) {
    setUserMgmtBusyId(userId);
    setUserMgmtError("");
    setUserMgmtMessage("");
    try {
      const payload = await analyticsApi.adminUpdateUser(tokenToUse, userId, patch);
      setUserMgmtMessage(payload.message || "User updated.");
      await loadUserManagement(userMgmtFilters);
    } catch (requestError) {
      setUserMgmtError(requestError.message || "Unable to update user.");
    } finally {
      setUserMgmtBusyId("");
    }
  }
  async function exportUsersToGoogleSheet() {
    setSheetExportLoading(true);
    setSheetExportMessage("");
    setSheetExportError("");
    try {
      const payload = await analyticsApi.adminExportUsersToGoogleSheet(tokenToUse, {
        search: userMgmtFilters.search,
        role: userMgmtFilters.role,
        accountStatus: userMgmtFilters.accountStatus
      });
      const count = Number(payload?.exportedUsers || 0);
      const target = payload?.sheetUrl || "";
      setSheetExportMessage(
        target ? `Export complete: ${count} users synced to Google Sheet.` : `Export complete: ${count} users synced to configured sheet.`
      );
    } catch (requestError) {
      setSheetExportError(requestError.message || "Google Sheet export failed.");
    } finally {
      setSheetExportLoading(false);
    }
  }
  function resetQuestionForm() {
    setQuestionForm(EMPTY_QUESTION_FORM);
    setEditingQuestionId("");
    setQuestionError("");
  }
  async function submitQuestionForm(event) {
    event.preventDefault();
    setQuestionError("");
    setQuestionMessage("");
    const payload = {
      prompt: String(questionForm.prompt || "").trim(),
      category: String(questionForm.category || "HR").trim(),
      source: String(questionForm.source || "predefined").trim(),
      difficulty: String(questionForm.difficulty || "intermediate").trim(),
      roleFocus: String(questionForm.roleFocus || "General").trim(),
      companyContext: String(questionForm.companyContext || "General").trim(),
      tags: String(questionForm.tags || "")
    };
    if (!payload.prompt) {
      setQuestionError("Question prompt is required.");
      return;
    }
    try {
      if (editingQuestionId) {
        await adminQuestionApi.update(tokenToUse, editingQuestionId, payload);
        setQuestionMessage("Question updated successfully.");
      } else {
        await adminQuestionApi.create(tokenToUse, payload);
        setQuestionMessage("Question added to bank.");
      }
      resetQuestionForm();
      await loadQuestionBank(questionFilters);
    } catch (requestError) {
      setQuestionError(requestError.message || "Unable to save question.");
    }
  }
  function startEditQuestion(item) {
    setEditingQuestionId(String(item?._id || ""));
    setQuestionForm({
      prompt: String(item?.prompt || ""),
      category: String(item?.category || "HR"),
      source: String(item?.source || "predefined"),
      difficulty: String(item?.difficulty || "intermediate"),
      roleFocus: String(item?.roleFocus || "General"),
      companyContext: String(item?.companyContext || "General"),
      tags: toTagsInput(item?.tags)
    });
    setQuestionError("");
    setQuestionMessage("");
  }
  async function deleteQuestion(questionId) {
    const confirmed = window.confirm("Delete this question from question bank?");
    if (!confirmed) return;
    setQuestionError("");
    setQuestionMessage("");
    try {
      await adminQuestionApi.remove(tokenToUse, questionId);
      setQuestionMessage("Question deleted.");
      if (editingQuestionId === questionId) {
        resetQuestionForm();
      }
      await loadQuestionBank(questionFilters);
    } catch (requestError) {
      setQuestionError(requestError.message || "Unable to delete question.");
    }
  }
  async function applyQuestionFilters(event) {
    event.preventDefault();
    await loadQuestionBank(questionFilters);
  }
  return <div className="grid min-w-0 gap-4"><section className="glass-panel rounded-2xl p-5"><h1 className="inline-flex items-center gap-2 font-display text-3xl font-extrabold text-slate-900 dark:text-slate-100"><BarChart3 size={24} />
          Admin Panel
        </h1><p className="mt-1 text-sm text-slate-600 dark:text-slate-300">
          Track platform health and update Question Bank instantly from this panel.
        </p><div className="mt-3"><div className="flex flex-wrap gap-2"><button
            type="button"
            onClick={exportAdminSnapshot}
            disabled={!overview || loading}
            className="inline-flex items-center gap-2 rounded-lg bg-slate-900 px-3 py-2 text-xs font-semibold text-white transition hover:bg-slate-800 disabled:opacity-60 dark:bg-slate-100 dark:text-slate-900 dark:hover:bg-slate-200">
            <Download size={14} />
              Export Admin Snapshot CSV
            </button><button
            type="button"
            onClick={loadDbReport}
            disabled={dbLoading || !tokenToUse}
            className="inline-flex items-center gap-2 rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-semibold text-slate-700 transition hover:bg-slate-50 disabled:opacity-60 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100 dark:hover:bg-slate-800">
            <Database size={14} />{dbLoading ? "Loading DB Report..." : "Load DB Collections Report"}</button></div></div>{loading ? <p className="mt-3 text-sm text-slate-500 dark:text-slate-300">Loading admin overview...</p> : null}{error ? <p className="mt-3 rounded-lg bg-rose-100 px-3 py-2 text-sm text-rose-700">{error}</p> : null}</section><section className="glass-panel rounded-2xl p-5"><h2 className="inline-flex items-center gap-2 font-display text-2xl font-extrabold text-slate-900 dark:text-slate-100"><Database size={22} />
          MongoDB Collections Report
        </h2><p className="mt-1 text-sm text-slate-600 dark:text-slate-300">
          Two-table view: first table for collection summary, second table for selected collection data.
        </p>{dbError ? <p className="mt-3 rounded-lg bg-rose-100 px-3 py-2 text-sm text-rose-700">{dbError}</p> : null}{!dbReport && !dbLoading ? <p className="mt-3 text-sm text-slate-500 dark:text-slate-300">
            Click "Load DB Collections Report" to fetch all collections and data rows.
          </p> : null}{dbReport ? <div className="mt-4 grid gap-4"><article className="rounded-xl border border-slate-200 bg-white p-3 dark:border-slate-700 dark:bg-slate-900"><h3 className="mb-2 text-sm font-bold text-slate-900 dark:text-slate-100">Table 1: Collection Summary</h3><div className="overflow-x-auto"><table className="w-full min-w-[560px] text-left text-xs"><thead><tr className="border-b border-slate-200 dark:border-slate-700"><th className="py-2">Collection</th><th className="py-2">Documents</th><th className="py-2">Rows Loaded</th></tr></thead><tbody>{(dbReport.collections || []).map((item) => <tr key={item.name} className="border-b border-slate-100 last:border-0 dark:border-slate-800"><td className="py-2 font-semibold">{item.name}</td><td className="py-2">{item.documentCount}</td><td className="py-2">{item.rowsLoaded}</td></tr>)}</tbody></table></div></article><article className="rounded-xl border border-slate-200 bg-white p-3 dark:border-slate-700 dark:bg-slate-900"><div className="mb-2 flex flex-wrap items-center justify-between gap-2"><h3 className="text-sm font-bold text-slate-900 dark:text-slate-100">Table 2: Collection Data</h3><select
              value={selectedCollection}
              onChange={(event) => setSelectedCollection(event.target.value)}
              className="rounded-lg border border-slate-300 bg-white px-2 py-1 text-xs outline-none dark:border-slate-700 dark:bg-slate-900">
              {(dbReport.collections || []).map((item) => <option key={item.name} value={item.name}>{item.name}</option>)}</select></div><div className="overflow-x-auto"><table className="w-full min-w-[760px] text-left text-xs"><thead><tr className="border-b border-slate-200 dark:border-slate-700">{(selectedCollectionTable?.columns || []).map((column) => <th key={column} className="py-2 pr-3 font-semibold">{column}</th>)}</tr></thead><tbody>{(selectedCollectionTable?.rows || []).map((row, index) => <tr key={`${selectedCollectionTable?.collection || "collection"}-${index}`} className="border-b border-slate-100 last:border-0 dark:border-slate-800">{(selectedCollectionTable?.columns || []).map((column) => <td key={`${index}-${column}`} className="max-w-[260px] truncate py-2 pr-3 align-top">{String(row?.[column] ?? "")}</td>)}</tr>)}</tbody></table></div></article></div> : null}</section><section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-6"><Card title="Total Users" value={metrics.users} subtitle="Registered candidates" /><Card title="Total Sessions" value={metrics.sessions} subtitle="Platform-wide" /><Card title="Completed" value={metrics.completed} subtitle="Finished interviews" /><Card title="In Progress" value={metrics.inProgress} subtitle="Potential drop-off" /><Card title="Drop-off Rate" value={`${metrics.dropoffPercent}%`} subtitle="In-progress / total" /><Card title="Average Score" value={metrics.averageScore} subtitle="Completed sessions only" /></section><section className="grid gap-4 xl:grid-cols-2"><article className="glass-panel rounded-2xl p-4"><h2 className="inline-flex items-center gap-2 font-display text-xl font-bold text-slate-900 dark:text-slate-100"><AlertTriangle size={18} />
            Admin Action Center
          </h2><div className="mt-3 grid gap-2">{alerts.map((alert, index) => <div
            key={`${alert.title}-${index}`}
            className={[
            "rounded-lg border px-3 py-2 text-sm",
            alert.severity === "high" ? "border-rose-200 bg-rose-50 text-rose-800 dark:border-rose-500/30 dark:bg-rose-500/10 dark:text-rose-100" : alert.severity === "medium" ? "border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-100" : "border-sky-200 bg-sky-50 text-sky-800 dark:border-sky-500/30 dark:bg-sky-500/10 dark:text-sky-100"].
            join(" ")}>
            <p className="font-semibold">{alert.title}</p><p className="mt-1 text-xs">{alert.detail}</p></div>)}{!alerts.length ? <p className="text-sm text-slate-500 dark:text-slate-300">No alerts generated.</p> : null}</div></article><article className="glass-panel rounded-2xl p-4"><h2 className="inline-flex items-center gap-2 font-display text-xl font-bold text-slate-900 dark:text-slate-100"><BarChart3 size={18} />
            Source Mix & Category Quality
          </h2><div className="mt-3 grid gap-2">{sourceBreakdown.map((item) => <div key={item.source} className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-900"><p className="font-semibold capitalize">{item.source}</p><p className="text-xs text-slate-600 dark:text-slate-300">{item.count} sessions ({item.percent}%)
                </p></div>)}{!sourceBreakdown.length ? <p className="text-sm text-slate-500 dark:text-slate-300">No source data available.</p> : null}</div><div className="mt-3 grid gap-2">{categoryBreakdown.map((item) => <div key={item.category} className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-900"><p className="font-semibold">{item.category}</p><p className="text-xs text-slate-600 dark:text-slate-300">{item.sessions} sessions | avg score {item.averageScore}</p></div>)}{!categoryBreakdown.length ? <p className="text-sm text-slate-500 dark:text-slate-300">No category data available.</p> : null}</div></article></section><section className="grid gap-4 xl:grid-cols-2"><article className="glass-panel rounded-2xl p-4"><h2 className="inline-flex items-center gap-2 font-display text-xl font-bold text-slate-900 dark:text-slate-100"><AlertTriangle size={18} />
            High Risk Sessions
          </h2><div className="mt-3 grid gap-2">{topRiskSessions.map((session) => <div key={session.sessionId} className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm dark:border-amber-500/30 dark:bg-amber-500/10"><p className="font-semibold">{session.userName} | {session.targetRole} | {session.companySimulation}</p><p className="text-xs text-slate-600 dark:text-slate-300">
                  Age {session.ageHours}h | Progress {session.progressPercent}% ({session.answeredCount}/{session.questionsCount}) | Risk {session.riskScore}</p></div>)}{!topRiskSessions.length ? <p className="text-sm text-slate-500 dark:text-slate-300">No in-progress sessions right now.</p> : null}</div></article><article className="glass-panel rounded-2xl p-4"><h2 className="inline-flex items-center gap-2 font-display text-xl font-bold text-slate-900 dark:text-slate-100"><Users2 size={18} />
            Top Active Users
          </h2><div className="mt-3 grid gap-2">{leaderboard.slice(0, 8).map((entry, index) => <div key={`${entry.userId}-${index}`} className="flex items-center justify-between rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-900"><p className="font-semibold">{entry.name || `User ${index + 1}`}</p><span className="rounded-full bg-brand-100 px-2 py-1 text-xs font-semibold text-brand-700 dark:bg-brand-500/20 dark:text-brand-200">{entry.points || 0} pts
                </span></div>)}{!leaderboard.length ? <p className="text-sm text-slate-500 dark:text-slate-300">No leaderboard records available.</p> : null}</div></article></section><section className="glass-panel rounded-2xl p-5"><div className="flex flex-wrap items-center justify-between gap-2"><h2 className="inline-flex items-center gap-2 font-display text-2xl font-extrabold text-slate-900 dark:text-slate-100"><CreditCard size={22} />
            Billing & Subscription Control
          </h2><button
          type="button"
          onClick={() => loadBillingData(billingFilters)}
          disabled={billingLoading}
          className="inline-flex items-center gap-2 rounded-lg border border-slate-300 px-3 py-2 text-xs font-semibold text-slate-700 transition hover:bg-slate-50 disabled:opacity-60 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800">
          <RefreshCw size={14} />{billingLoading ? "Refreshing..." : "Refresh Billing"}</button></div><form onSubmit={applyBillingFilters} className="mt-4 grid gap-2 md:grid-cols-[minmax(0,1fr)_160px_170px_120px]"><input
          value={billingFilters.search}
          onChange={(event) => setBillingFilters((prev) => ({ ...prev, search: event.target.value }))}
          placeholder="Search user/email/payment id..."
          className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm outline-none transition focus:border-brand-400 dark:border-slate-700 dark:bg-slate-900" />
        <select
          value={billingFilters.plan}
          onChange={(event) => setBillingFilters((prev) => ({ ...prev, plan: event.target.value }))}
          className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm outline-none transition focus:border-brand-400 dark:border-slate-700 dark:bg-slate-900">
          <option value="">All Plans</option><option value="free">Free</option><option value="pro">Pro</option><option value="elite">Elite</option></select><select
          value={billingFilters.status}
          onChange={(event) => setBillingFilters((prev) => ({ ...prev, status: event.target.value }))}
          className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm outline-none transition focus:border-brand-400 dark:border-slate-700 dark:bg-slate-900">
          <option value="">All Status</option><option value="active">Active Subs</option><option value="expired">Expired</option><option value="cancelled">Cancelled</option><option value="paid">Paid Payments</option><option value="pending">Pending Payments</option><option value="failed">Failed Payments</option></select><button
          type="submit"
          disabled={billingLoading}
          className="rounded-xl bg-slate-900 px-3 py-2 text-xs font-semibold text-white transition hover:bg-slate-800 disabled:opacity-60 dark:bg-slate-100 dark:text-slate-900 dark:hover:bg-slate-200">
          
            Apply
          </button></form>{billingMessage ? <p className="mt-3 rounded-lg bg-emerald-100 px-3 py-2 text-sm text-emerald-700">{billingMessage}</p> : null}{billingError ? <p className="mt-3 rounded-lg bg-rose-100 px-3 py-2 text-sm text-rose-700">{billingError}</p> : null}<div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4"><Card title="Active Paid Users" value={billingTotals.activePaidUsers} subtitle={`Pro ${billingTotals.activeProUsers} | Elite ${billingTotals.activeEliteUsers}`} /><Card title="Paid Payments" value={billingTotals.paidPayments} subtitle={`Total payments ${billingTotals.totalPayments}`} /><Card title="Pending / Expired" value={`${billingTotals.pendingPayments}/${billingTotals.expiredPayments}`} subtitle="Pending and expired requests" /><Card title="INR Revenue (Month)" value={`Rs ${billingTotals.revenueInrMonth}`} subtitle="Paid transactions this month" /></div><div className="mt-4 grid gap-4 xl:grid-cols-2"><article className="rounded-xl border border-slate-200 bg-white p-3 dark:border-slate-700 dark:bg-slate-900"><h3 className="mb-2 text-sm font-bold text-slate-900 dark:text-slate-100">Recent Payments</h3><div className="overflow-x-auto"><table className="w-full min-w-[760px] text-left text-xs"><thead><tr className="border-b border-slate-200 dark:border-slate-700"><th className="py-2 pr-3">Payment ID</th><th className="py-2 pr-3">User</th><th className="py-2 pr-3">Plan</th><th className="py-2 pr-3">Amount</th><th className="py-2 pr-3">Status</th><th className="py-2 pr-3">UTR</th><th className="py-2 pr-3">Created</th></tr></thead><tbody>{billingPayments.map((item) => <tr key={`${item.paymentId}-${item.userId}`} className="border-b border-slate-100 last:border-0 dark:border-slate-800"><td className="py-2 pr-3 font-semibold">{item.paymentId || "-"}</td><td className="py-2 pr-3">{item.name} ({item.email})</td><td className="py-2 pr-3 uppercase">{item.plan || "-"}</td><td className="py-2 pr-3">{item.currency} {item.amount}</td><td className="py-2 pr-3 uppercase">{item.status || "-"}</td><td className="py-2 pr-3">{item.utr || "-"}</td><td className="py-2 pr-3">{formatAdminDateTime(item.createdAt)}</td></tr>)}</tbody></table>{!billingPayments.length ? <p className="py-3 text-xs text-slate-500 dark:text-slate-300">No payment rows for selected filters.</p> : null}</div></article><article className="rounded-xl border border-slate-200 bg-white p-3 dark:border-slate-700 dark:bg-slate-900"><h3 className="mb-2 inline-flex items-center gap-2 text-sm font-bold text-slate-900 dark:text-slate-100"><ShieldCheck size={15} />
              Subscriber Management
            </h3><div className="overflow-x-auto"><table className="w-full min-w-[780px] text-left text-xs"><thead><tr className="border-b border-slate-200 dark:border-slate-700"><th className="py-2 pr-3">User</th><th className="py-2 pr-3">Plan</th><th className="py-2 pr-3">Status</th><th className="py-2 pr-3">Valid Till</th><th className="py-2 pr-3">Actions</th></tr></thead><tbody>{billingSubscribers.map((item) => <tr key={item.userId} className="border-b border-slate-100 last:border-0 dark:border-slate-800"><td className="py-2 pr-3"><p className="font-semibold">{item.name}</p><p className="text-[11px] text-slate-500 dark:text-slate-300">{item.email}</p></td><td className="py-2 pr-3 uppercase">{item.plan || "-"}</td><td className="py-2 pr-3 uppercase">{item.status || "-"}</td><td className="py-2 pr-3">{formatAdminDateTime(item.currentPeriodEnd)}</td><td className="py-2 pr-3"><div className="flex flex-wrap gap-1"><button
                        type="button"
                        onClick={() => updateUserSubscription(item.userId, "pro", "active", 30)}
                        className="rounded bg-brand-500 px-2 py-1 text-[11px] font-semibold text-white">
                        
                            Pro 30d
                          </button><button
                        type="button"
                        onClick={() => updateUserSubscription(item.userId, "elite", "active", 365)}
                        className="rounded bg-violet-600 px-2 py-1 text-[11px] font-semibold text-white">
                        
                            Elite 365d
                          </button><button
                        type="button"
                        onClick={() => updateUserSubscription(item.userId, "free", "active", 0)}
                        className="rounded bg-slate-700 px-2 py-1 text-[11px] font-semibold text-white">
                        
                            Set Free
                          </button><button
                        type="button"
                        onClick={() => updateUserSubscription(item.userId, item.plan || "free", "cancelled", 0)}
                        className="rounded bg-rose-600 px-2 py-1 text-[11px] font-semibold text-white">
                        
                            Cancel
                          </button></div></td></tr>)}</tbody></table>{!billingSubscribers.length ? <p className="py-3 text-xs text-slate-500 dark:text-slate-300">No subscribers for selected filters.</p> : null}</div></article></div></section><section className="glass-panel rounded-2xl p-5"><div className="flex flex-wrap items-center justify-between gap-2"><h2 className="inline-flex items-center gap-2 font-display text-2xl font-extrabold text-slate-900 dark:text-slate-100"><ShieldCheck size={22} />
            Security Incidents
          </h2><button
            type="button"
            onClick={() => {
              if (tokenToUse) {
                setLoading(true);
                analyticsApi.adminOverview(tokenToUse).then((payload) => {
                  setOverview(payload || null);
                }).catch((requestError) => {
                  setError(requestError.message || "Admin metrics could not be loaded.");
                }).finally(() => {
                  setLoading(false);
                });
              }
            }}
            disabled={loading}
            className="inline-flex items-center gap-2 rounded-lg border border-slate-300 px-3 py-2 text-xs font-semibold text-slate-700 transition hover:bg-slate-50 disabled:opacity-60 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800">
            <RefreshCw size={14} />{loading ? "Refreshing..." : "Refresh Incidents"}</button></div><p className="mt-1 text-sm text-slate-600 dark:text-slate-300">
          Shows tab/window switch and other integrity violations from interview sessions.
        </p><div className="mt-4 overflow-x-auto"><table className="w-full min-w-[980px] text-left text-xs"><thead><tr className="border-b border-slate-200 dark:border-slate-700"><th className="py-2 pr-3">Time</th><th className="py-2 pr-3">User</th><th className="py-2 pr-3">Type</th><th className="py-2 pr-3">Reason</th><th className="py-2 pr-3">Session</th></tr></thead><tbody>{securityEvents.map((item, index) => <tr key={`${item.sessionId}-${item.createdAt}-${index}`} className="border-b border-slate-100 last:border-0 dark:border-slate-800"><td className="py-2 pr-3">{formatAdminDateTime(item.createdAt)}</td><td className="py-2 pr-3"><p className="font-semibold">{item.userName || "-"}</p><p className="text-[11px] text-slate-500 dark:text-slate-300">{item.userEmail || "-"}</p></td><td className="py-2 pr-3 uppercase">{item.type || "-"}</td><td className="max-w-[320px] py-2 pr-3 align-top text-[11px] text-slate-600 dark:text-slate-300">{item.reason || "-"}</td><td className="py-2 pr-3 text-[11px] text-slate-600 dark:text-slate-300">{item.category || "-"} | {item.targetRole || "-"} | {item.sessionStatus || "-"}</td></tr>)}</tbody></table>{!securityEvents.length ? <p className="py-3 text-xs text-slate-500 dark:text-slate-300">No security incidents recorded yet.</p> : null}</div></section><section className="glass-panel rounded-2xl p-5"><div className="flex flex-wrap items-center justify-between gap-2"><h2 className="inline-flex items-center gap-2 font-display text-2xl font-extrabold text-slate-900 dark:text-slate-100"><Users2 size={22} />
            User Management
          </h2><div className="flex flex-wrap items-center gap-2"><button
            type="button"
            onClick={exportUsersToGoogleSheet}
            disabled={sheetExportLoading}
            className="inline-flex items-center gap-2 rounded-lg bg-emerald-600 px-3 py-2 text-xs font-semibold text-white transition hover:bg-emerald-700 disabled:opacity-60">
            <Download size={14} />{sheetExportLoading ? "Syncing..." : "Sync Users To Google Sheet"}</button><button
            type="button"
            onClick={() => loadUserManagement(userMgmtFilters)}
            disabled={userMgmtLoading}
            className="inline-flex items-center gap-2 rounded-lg border border-slate-300 px-3 py-2 text-xs font-semibold text-slate-700 transition hover:bg-slate-50 disabled:opacity-60 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800">
            <RefreshCw size={14} />{userMgmtLoading ? "Refreshing..." : "Refresh Users"}</button></div></div><form onSubmit={applyUserMgmtFilters} className="mt-4 grid gap-2 md:grid-cols-[minmax(0,1fr)_140px_160px_120px]"><input
          value={userMgmtFilters.search}
          onChange={(event) => setUserMgmtFilters((prev) => ({ ...prev, search: event.target.value }))}
          placeholder="Search name/email..."
          className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm outline-none transition focus:border-brand-400 dark:border-slate-700 dark:bg-slate-900" />
        <select
          value={userMgmtFilters.role}
          onChange={(event) => setUserMgmtFilters((prev) => ({ ...prev, role: event.target.value }))}
          className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm outline-none transition focus:border-brand-400 dark:border-slate-700 dark:bg-slate-900">
          <option value="">All Roles</option><option value="user">User</option><option value="admin">Admin</option></select><select
          value={userMgmtFilters.accountStatus}
          onChange={(event) => setUserMgmtFilters((prev) => ({ ...prev, accountStatus: event.target.value }))}
          className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm outline-none transition focus:border-brand-400 dark:border-slate-700 dark:bg-slate-900">
          <option value="">All Status</option><option value="active">Active</option><option value="suspended">Suspended</option></select><button
          type="submit"
          disabled={userMgmtLoading}
          className="rounded-xl bg-slate-900 px-3 py-2 text-xs font-semibold text-white transition hover:bg-slate-800 disabled:opacity-60 dark:bg-slate-100 dark:text-slate-900 dark:hover:bg-slate-200">
          
            Apply
          </button></form>{userMgmtMessage ? <p className="mt-3 rounded-lg bg-emerald-100 px-3 py-2 text-sm text-emerald-700">{userMgmtMessage}</p> : null}{userMgmtError ? <p className="mt-3 rounded-lg bg-rose-100 px-3 py-2 text-sm text-rose-700">{userMgmtError}</p> : null}{sheetExportMessage ? <p className="mt-3 rounded-lg bg-emerald-100 px-3 py-2 text-sm text-emerald-700">{sheetExportMessage}</p> : null}{sheetExportError ? <p className="mt-3 rounded-lg bg-rose-100 px-3 py-2 text-sm text-rose-700">{sheetExportError}</p> : null}<div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-5"><Card title="Users" value={userMgmtTotals.users} subtitle="Filtered users" /><Card title="Active" value={userMgmtTotals.active} subtitle="Can access platform" /><Card title="Suspended" value={userMgmtTotals.suspended} subtitle="Blocked accounts" /><Card title="Admins" value={userMgmtTotals.admins} subtitle="Admin users" /><Card title="Flagged" value={userMgmtTotals.flagged} subtitle="Security violations > 0" /></div><article className="mt-4 rounded-xl border border-slate-200 bg-white p-3 dark:border-slate-700 dark:bg-slate-900"><h3 className="mb-2 text-sm font-bold text-slate-900 dark:text-slate-100">Users Table</h3><div className="overflow-x-auto"><table className="w-full min-w-[1220px] text-left text-xs"><thead><tr className="border-b border-slate-200 dark:border-slate-700"><th className="py-2 pr-3">User</th><th className="py-2 pr-3">Role</th><th className="py-2 pr-3">Status</th><th className="py-2 pr-3">Plan</th><th className="py-2 pr-3">Points</th><th className="py-2 pr-3">Violations</th><th className="py-2 pr-3">Last Violation</th><th className="py-2 pr-3">Last Violation Reason</th><th className="py-2 pr-3">Actions</th></tr></thead><tbody>{userMgmtRows.map((item) => <tr key={item.userId} className="border-b border-slate-100 last:border-0 dark:border-slate-800"><td className="py-2 pr-3"><p className="font-semibold">{item.name}</p><p className="text-[11px] text-slate-500 dark:text-slate-300">{item.email}</p></td><td className="py-2 pr-3 uppercase">{item.role}</td><td className="py-2 pr-3 uppercase">{item.accountStatus}</td><td className="py-2 pr-3 uppercase">{item.subscriptionPlan}</td><td className="py-2 pr-3">{item.points}</td><td className="py-2 pr-3">{item.violationCount}</td><td className="py-2 pr-3">{formatAdminDateTime(item.lastViolationAt)}</td><td className="max-w-[280px] py-2 pr-3 align-top text-[11px] text-slate-600 dark:text-slate-300">{item.lastViolationReason || "-"}</td><td className="py-2 pr-3"><div className="flex flex-wrap gap-1"><button
                      type="button"
                      disabled={userMgmtBusyId === item.userId}
                      onClick={() => updateManagedUser(item.userId, {
                        accountStatus: item.accountStatus === "suspended" ? "active" : "suspended"
                      })}
                      className="rounded bg-amber-600 px-2 py-1 text-[11px] font-semibold text-white disabled:opacity-60">
                      {item.accountStatus === "suspended" ? "Activate" : "Suspend"}</button><button
                      type="button"
                      disabled={userMgmtBusyId === item.userId}
                      onClick={() => updateManagedUser(item.userId, {
                        role: item.role === "admin" ? "user" : "admin"
                      })}
                      className="rounded bg-indigo-600 px-2 py-1 text-[11px] font-semibold text-white disabled:opacity-60">
                      {item.role === "admin" ? "Make User" : "Make Admin"}</button><button
                      type="button"
                      disabled={userMgmtBusyId === item.userId || !item.violationCount}
                      onClick={() => updateManagedUser(item.userId, { resetViolations: true })}
                      className="rounded bg-slate-700 px-2 py-1 text-[11px] font-semibold text-white disabled:opacity-60">
                      
                          Reset Flags
                        </button></div></td></tr>)}</tbody></table>{!userMgmtRows.length ? <p className="py-3 text-xs text-slate-500 dark:text-slate-300">No users found for selected filters.</p> : null}</div></article></section><section className="glass-panel rounded-2xl p-5"><div className="flex flex-wrap items-center justify-between gap-2"><h2 className="inline-flex items-center gap-2 font-display text-2xl font-extrabold text-slate-900 dark:text-slate-100"><BookText size={22} />
            Question Bank Manager
          </h2><button
          type="button"
          onClick={() => loadQuestionBank(questionFilters)}
          disabled={questionLoading}
          className="inline-flex items-center gap-2 rounded-lg border border-slate-300 px-3 py-2 text-xs font-semibold text-slate-700 transition hover:bg-slate-50 disabled:opacity-60 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800">
          <RefreshCw size={14} />
            Refresh
          </button></div><form onSubmit={applyQuestionFilters} className="mt-4 grid gap-2 md:grid-cols-[minmax(0,1fr)_170px_170px_120px]"><input
          value={questionFilters.search}
          onChange={(event) => setQuestionFilters((prev) => ({ ...prev, search: event.target.value }))}
          placeholder="Search by prompt..."
          className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm outline-none transition focus:border-brand-400 dark:border-slate-700 dark:bg-slate-900" />
        <select
          value={questionFilters.category}
          onChange={(event) => setQuestionFilters((prev) => ({ ...prev, category: event.target.value }))}
          className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm outline-none transition focus:border-brand-400 dark:border-slate-700 dark:bg-slate-900">
          <option value="">All Categories</option>{ADMIN_CATEGORIES.map((item) => <option key={item} value={item}>{item}</option>)}</select><select
          value={questionFilters.source}
          onChange={(event) => setQuestionFilters((prev) => ({ ...prev, source: event.target.value }))}
          className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm outline-none transition focus:border-brand-400 dark:border-slate-700 dark:bg-slate-900">
          <option value="">All Sources</option>{ADMIN_SOURCES.map((item) => <option key={item} value={item}>{item}</option>)}</select><button
          type="submit"
          disabled={questionLoading}
          className="rounded-xl bg-slate-900 px-3 py-2 text-xs font-semibold text-white transition hover:bg-slate-800 disabled:opacity-60 dark:bg-slate-100 dark:text-slate-900 dark:hover:bg-slate-200">
          
            Search
          </button></form><form onSubmit={submitQuestionForm} className="mt-4 grid gap-2 rounded-xl border border-slate-200 bg-white p-3 dark:border-slate-700 dark:bg-slate-900"><textarea
          rows={3}
          value={questionForm.prompt}
          onChange={(event) => updateQuestionForm("prompt", event.target.value)}
          placeholder="Question prompt"
          className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm outline-none transition focus:border-brand-400 dark:border-slate-700 dark:bg-slate-950" />
        <div className="grid gap-2 md:grid-cols-3"><select value={questionForm.category} onChange={(event) => updateQuestionForm("category", event.target.value)} className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm outline-none dark:border-slate-700 dark:bg-slate-950">{ADMIN_CATEGORIES.map((item) => <option key={item} value={item}>{item}</option>)}</select><select value={questionForm.source} onChange={(event) => updateQuestionForm("source", event.target.value)} className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm outline-none dark:border-slate-700 dark:bg-slate-950">{ADMIN_SOURCES.map((item) => <option key={item} value={item}>{item}</option>)}</select><select value={questionForm.difficulty} onChange={(event) => updateQuestionForm("difficulty", event.target.value)} className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm outline-none dark:border-slate-700 dark:bg-slate-950">{ADMIN_DIFFICULTIES.map((item) => <option key={item} value={item}>{item}</option>)}</select></div><div className="grid gap-2 md:grid-cols-2"><input
            value={questionForm.roleFocus}
            onChange={(event) => updateQuestionForm("roleFocus", event.target.value)}
            placeholder="Role focus"
            className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm outline-none dark:border-slate-700 dark:bg-slate-950" />
          <input
            value={questionForm.companyContext}
            onChange={(event) => updateQuestionForm("companyContext", event.target.value)}
            placeholder="Company context"
            className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm outline-none dark:border-slate-700 dark:bg-slate-950" />
        </div><input
          value={questionForm.tags}
          onChange={(event) => updateQuestionForm("tags", event.target.value)}
          placeholder="Tags (comma separated)"
          className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm outline-none dark:border-slate-700 dark:bg-slate-950" />
        <div className="flex flex-wrap items-center gap-2"><button
            type="submit"
            className="inline-flex items-center gap-2 rounded-lg bg-brand-600 px-3 py-2 text-xs font-semibold text-white transition hover:bg-brand-700">
            {editingQuestionId ? <Save size={14} /> : <Plus size={14} />}{editingQuestionId ? "Update Question" : "Add Question"}</button>{editingQuestionId ? <button
            type="button"
            onClick={resetQuestionForm}
            className="inline-flex items-center gap-2 rounded-lg border border-slate-300 px-3 py-2 text-xs font-semibold text-slate-700 transition hover:bg-slate-50 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800">
            <X size={14} />
                Cancel Edit
              </button> : null}</div></form>{questionMessage ? <p className="mt-3 rounded-lg bg-emerald-100 px-3 py-2 text-sm text-emerald-700">{questionMessage}</p> : null}{questionError ? <p className="mt-3 rounded-lg bg-rose-100 px-3 py-2 text-sm text-rose-700">{questionError}</p> : null}<div className="mt-4 grid gap-2">{questionLoading ? <p className="text-sm text-slate-500 dark:text-slate-300">Loading question bank...</p> : null}{!questionLoading && !questions.length ? <p className="text-sm text-slate-500 dark:text-slate-300">No questions found for selected filters.</p> : null}{questions.map((item) => <article key={item._id} className="rounded-xl border border-slate-200 bg-white p-3 dark:border-slate-700 dark:bg-slate-900"><p className="text-sm font-semibold text-slate-900 dark:text-slate-100">{item.prompt}</p><p className="mt-1 text-xs text-slate-500 dark:text-slate-300">{item.category} | {item.source} | {item.difficulty} | {item.roleFocus || "General"} | {item.companyContext || "General"}</p><p className="mt-1 text-xs text-slate-500 dark:text-slate-300">
                Tags: {Array.isArray(item.tags) && item.tags.length ? item.tags.join(", ") : "None"}</p><div className="mt-2 flex items-center gap-2"><button
              type="button"
              onClick={() => startEditQuestion(item)}
              className="inline-flex items-center gap-1 rounded-lg border border-blue-300 px-2 py-1 text-xs font-semibold text-blue-700 transition hover:bg-blue-50 dark:border-blue-600 dark:text-blue-300 dark:hover:bg-blue-900/20">
              <Pencil size={12} />
                  Edit
                </button><button
              type="button"
              onClick={() => deleteQuestion(item._id)}
              className="inline-flex items-center gap-1 rounded-lg border border-rose-300 px-2 py-1 text-xs font-semibold text-rose-700 transition hover:bg-rose-50 dark:border-rose-700 dark:text-rose-300 dark:hover:bg-rose-900/20">
              <Trash2 size={12} />
                  Delete
                </button></div></article>)}</div></section></div>;
}
