const express = require("express");
const mongoose = require("mongoose");
const { env } = require("../config/env");
const { authRequired, adminRequired } = require("../middleware/auth");
const { asyncHandler } = require("../utils/asyncHandler");
const { InterviewSession, User } = require("../models");
const { exportUsersToGoogleSheet } = require("../services/googleSheetExport");

const router = express.Router();

function toDateKey(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "";
  }
  return date.toISOString().slice(0, 10);
}

function clampPercent(value) {
  return Math.max(0, Math.min(100, Math.round(Number(value || 0))));
}

function serializeCell(value) {
  if (value === null || value === undefined) return "";
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "object") {
    try {
      return JSON.stringify(value);
    } catch {
      return String(value);
    }
  }
  return value;
}

function serializeRow(document) {
  if (!document || typeof document !== "object") {
    return {};
  }

  const row = {};
  for (const [key, value] of Object.entries(document)) {
    row[key] = serializeCell(value);
  }
  return row;
}

function buildAdminAlerts({ totalSessions, completed, dropoffPercent, averageScore, staleRiskCount, aiSharePercent }) {
  const alerts = [];

  if (!totalSessions) {
    alerts.push({
      severity: "info",
      title: "No session data yet",
      detail: "Create or complete sessions to unlock admin analytics trends."
    });
    return alerts;
  }

  if (dropoffPercent >= 45) {
    alerts.push({
      severity: "high",
      title: "High drop-off trend",
      detail: `In-progress sessions are ${dropoffPercent}% of total. Investigate onboarding friction and reminder nudges.`
    });
  } else if (dropoffPercent >= 30) {
    alerts.push({
      severity: "medium",
      title: "Drop-off trend rising",
      detail: `Drop-off is ${dropoffPercent}%. Monitor stale sessions and improve completion guidance.`
    });
  }

  if (completed >= 5 && averageScore < 65) {
    alerts.push({
      severity: "medium",
      title: "Low average performance",
      detail: `Completed-session average is ${averageScore}/100. Consider stronger coaching prompts and STAR guidance.`
    });
  }

  if (staleRiskCount >= 5) {
    alerts.push({
      severity: "high",
      title: "Many stale in-progress sessions",
      detail: `${staleRiskCount} sessions are stale for 24h+ with low progress. Trigger re-engagement campaigns.`
    });
  } else if (staleRiskCount >= 2) {
    alerts.push({
      severity: "medium",
      title: "Stale sessions detected",
      detail: `${staleRiskCount} sessions are stale for 24h+ with low progress. Follow up with users.`
    });
  }

  if (aiSharePercent < 20) {
    alerts.push({
      severity: "info",
      title: "Low AI question usage",
      detail: `AI/resume sourced sessions are ${aiSharePercent}%. Encourage AI mode for varied practice quality.`
    });
  }

  if (!alerts.length) {
    alerts.push({
      severity: "info",
      title: "Platform signals are stable",
      detail: "No major risk spikes detected in current session performance trends."
    });
  }

  return alerts;
}

function normalizeAdminPlan(input) {
  const plan = String(input || "")
    .trim()
    .toLowerCase();
  if (["free", "pro", "elite"].includes(plan)) {
    return plan;
  }
  return "";
}

function normalizeAdminSubscriptionStatus(input) {
  const status = String(input || "")
    .trim()
    .toLowerCase();
  if (["active", "expired", "cancelled"].includes(status)) {
    return status;
  }
  return "";
}

function normalizeAdminStatusFilter(input) {
  const status = String(input || "")
    .trim()
    .toLowerCase();
  if (["active", "expired", "cancelled", "paid", "pending", "failed"].includes(status)) {
    return status;
  }
  return "";
}

function resolveEffectivePaymentStatus(payment = {}, nowMs = Date.now()) {
  const status = String(payment?.status || "")
    .trim()
    .toLowerCase();

  if (status !== "pending") {
    return status || "unknown";
  }

  const expiresAtMs = new Date(payment?.expiresAt || 0).getTime();
  if (!Number.isNaN(expiresAtMs) && expiresAtMs > 0 && nowMs > expiresAtMs) {
    return "expired";
  }

  return "pending";
}

function defaultSubscriptionDurationDays(plan) {
  if (plan === "elite") return 365;
  if (plan === "pro") return 30;
  return 0;
}

function toIsoCell(value) {
  const date = new Date(value || 0);
  if (Number.isNaN(date.getTime())) {
    return "";
  }
  return date.toISOString();
}

function normalizeAdminRole(input) {
  const role = String(input || "")
    .trim()
    .toLowerCase();
  if (["user", "admin"].includes(role)) {
    return role;
  }
  return "";
}

function normalizeAdminAccountStatus(input) {
  const status = String(input || "")
    .trim()
    .toLowerCase();
  if (["active", "suspended"].includes(status)) {
    return status;
  }
  return "";
}

function normalizeEmail(value) {
  return String(value || "")
    .trim()
    .toLowerCase();
}

function isPrimaryAdminEmail(email) {
  const primaryAdminEmail = normalizeEmail(env.primaryAdminEmail);
  if (!primaryAdminEmail) {
    return false;
  }
  return normalizeEmail(email) === primaryAdminEmail;
}

router.get(
  "/progress",
  authRequired,
  asyncHandler(async (req, res) => {
    const userId = req.auth.sub;

    const rawSessions = await InterviewSession.find({ user: userId, status: "completed" })
      .sort({ endedAt: 1, createdAt: 1 })
      .lean();

    const sessions = rawSessions
      .map((session) => {
        const completedAt = session.endedAt || session.createdAt;
        const dateKey = toDateKey(completedAt);
        const completedAtMs = new Date(completedAt).getTime();

        return {
          category: String(session.category || "Uncategorized"),
          score: clampPercent(session.overallScore),
          metrics: session.metrics || {},
          dateKey,
          completedAtMs
        };
      })
      .filter((session) => session.dateKey);

    const completedSessions = sessions.length;
    const averageScore = completedSessions
      ? Math.round(sessions.reduce((sum, session) => sum + session.score, 0) / completedSessions)
      : 0;

    const scoreTrend = sessions.slice(-12).map((session) => ({
      date: session.dateKey,
      score: session.score,
      category: session.category
    }));

    const categoryMap = {};
    for (const session of sessions) {
      if (!categoryMap[session.category]) {
        categoryMap[session.category] = { total: 0, count: 0 };
      }

      categoryMap[session.category].total += session.score;
      categoryMap[session.category].count += 1;
    }

    const categoryBreakdown = Object.entries(categoryMap).map(([category, stat]) => ({
      category,
      averageScore: Math.round(stat.total / stat.count),
      sessions: stat.count
    }));

    const metricKeys = [
      "confidence",
      "communication",
      "clarity",
      "grammar",
      "technicalAccuracy",
      "speakingSpeed",
      "facialExpression",
      "relevance"
    ];
    const metricTotals = {
      confidence: 0,
      communication: 0,
      clarity: 0,
      grammar: 0,
      technicalAccuracy: 0,
      speakingSpeed: 0,
      facialExpression: 0,
      relevance: 0
    };

    for (const session of sessions) {
      for (const key of metricKeys) {
        metricTotals[key] += clampPercent(session.metrics?.[key] || 0);
      }
    }

    const metricAverages = metricKeys.map((key) => ({
      metric: key,
      value: completedSessions ? Math.round(metricTotals[key] / completedSessions) : 0
    }));

    const weekStart = new Date();
    weekStart.setDate(weekStart.getDate() - 7);

    const weeklySessions = sessions.filter((session) => session.completedAtMs >= weekStart.getTime());

    const weeklyAverageScore = weeklySessions.length
      ? Math.round(weeklySessions.reduce((sum, session) => sum + session.score, 0) / weeklySessions.length)
      : 0;
    const weeklyClarity = weeklySessions.length
      ? Math.round(
          weeklySessions.reduce((sum, session) => sum + Number(session.metrics?.clarity || 0), 0) / weeklySessions.length
        )
      : 0;

    const missions = [
      {
        id: "weekly_sessions_3",
        label: "Complete 3 sessions this week",
        progress: weeklySessions.length,
        target: 3,
        completed: weeklySessions.length >= 3
      },
      {
        id: "weekly_avg_75",
        label: "Reach weekly average score of 75",
        progress: weeklyAverageScore,
        target: 75,
        completed: weeklyAverageScore >= 75
      },
      {
        id: "weekly_clarity_70",
        label: "Reach weekly clarity score of 70",
        progress: weeklyClarity,
        target: 70,
        completed: weeklyClarity >= 70
      }
    ];

    const user = await User.findById(userId).select("streak points badges").lean();

    return res.json({
      completedSessions,
      averageScore,
      scoreTrend,
      categoryBreakdown,
      metricAverages,
      goals: {
        weeklySessions: weeklySessions.length,
        weeklyAverageScore,
        weeklyClarity,
        missions,
        streak: Number(user?.streak || 0),
        points: Number(user?.points || 0),
        badges: Array.isArray(user?.badges) ? user.badges : []
      }
    });
  })
);

router.get(
  "/admin-overview",
  adminRequired,
  asyncHandler(async (req, res) => {
    const [sessions, totalUsers] = await Promise.all([
      InterviewSession.find({})
        .sort({ createdAt: -1 })
        .populate("user", "name email")
        .lean(),
      User.countDocuments({})
    ]);

    const totalSessions = sessions.length;
    const completedSessions = sessions.filter((session) => session.status === "completed");
    const inProgressSessions = sessions.filter((session) => session.status === "in_progress");
    const completed = completedSessions.length;
    const inProgress = inProgressSessions.length;
    const dropoffPercent = totalSessions ? clampPercent((inProgress / totalSessions) * 100) : 0;
    const averageScore = completed
      ? Math.round(completedSessions.reduce((sum, session) => sum + Number(session.overallScore || 0), 0) / completed)
      : 0;

    const sourceBreakdownMap = {
      predefined: 0,
      ai: 0,
      resume: 0
    };

    const categoryMap = {};
    const now = Date.now();
    const riskSessions = [];
    const securityEvents = [];

    const trendMap = {};
    const trendDays = 14;
    for (let dayOffset = trendDays - 1; dayOffset >= 0; dayOffset -= 1) {
      const day = new Date();
      day.setHours(0, 0, 0, 0);
      day.setDate(day.getDate() - dayOffset);
      const key = day.toISOString().slice(0, 10);
      trendMap[key] = {
        date: key,
        started: 0,
        completed: 0,
        completedScoreTotal: 0,
        completedScoreCount: 0
      };
    }

    for (const session of sessions) {
      const source = String(session.questionSource || "predefined").toLowerCase();
      if (Object.prototype.hasOwnProperty.call(sourceBreakdownMap, source)) {
        sourceBreakdownMap[source] += 1;
      } else {
        sourceBreakdownMap.predefined += 1;
      }

      const startKey = toDateKey(session.createdAt);
      if (startKey && trendMap[startKey]) {
        trendMap[startKey].started += 1;
      }

      if (session.status === "completed") {
        const category = String(session.category || "Unknown");
        if (!categoryMap[category]) {
          categoryMap[category] = { total: 0, count: 0 };
        }
        categoryMap[category].total += Number(session.overallScore || 0);
        categoryMap[category].count += 1;

        const completedKey = toDateKey(session.endedAt || session.createdAt);
        if (completedKey && trendMap[completedKey]) {
          trendMap[completedKey].completed += 1;
          trendMap[completedKey].completedScoreTotal += Number(session.overallScore || 0);
          trendMap[completedKey].completedScoreCount += 1;
        }
      }

      if (session.status === "in_progress") {
        const questionsCount = Array.isArray(session.questions) ? session.questions.length : 0;
        const answeredCount = Array.isArray(session.questions)
          ? session.questions.filter((question) => question.answer?.answeredAt).length
          : 0;
        const progressPercent = questionsCount ? clampPercent((answeredCount / questionsCount) * 100) : 0;
        const createdTime = new Date(session.createdAt).getTime();
        const ageHours = Number.isFinite(createdTime) ? Math.round((now - createdTime) / (1000 * 60 * 60)) : 0;
        const riskScore = Math.round(ageHours * 1.4 + (100 - progressPercent) * 1.1);

        riskSessions.push({
          sessionId: String(session._id),
          userName: session.user?.name || "Candidate",
          targetRole: session.targetRole || "General",
          companySimulation: session.companySimulation || "Startup",
          category: session.category,
          createdAt: session.createdAt,
          ageHours,
          questionsCount,
          answeredCount,
          progressPercent,
          riskScore
        });
      }

      const sessionEvents = Array.isArray(session.integrityEvents) ? session.integrityEvents : [];
      if (sessionEvents.length) {
        for (const event of sessionEvents) {
          securityEvents.push({
            sessionId: String(session._id),
            userName: String(session.user?.name || "Candidate"),
            userEmail: String(session.user?.email || ""),
            category: String(session.category || "Unknown"),
            targetRole: String(session.targetRole || "General"),
            sessionStatus: String(session.status || "in_progress"),
            type: String(event?.type || "policy"),
            reason: String(event?.reason || ""),
            meta: String(event?.meta || ""),
            createdAt: event?.createdAt || session.updatedAt || session.createdAt || null
          });
        }
      }
    }

    const sourceBreakdown = Object.entries(sourceBreakdownMap).map(([source, count]) => ({
      source,
      count,
      percent: totalSessions ? clampPercent((Number(count || 0) / totalSessions) * 100) : 0
    }));

    const categoryBreakdown = Object.entries(categoryMap).map(([category, stat]) => ({
      category,
      sessions: stat.count,
      averageScore: stat.count ? Math.round(stat.total / stat.count) : 0
    }));

    const trend = Object.values(trendMap).map((day) => ({
      date: day.date,
      started: day.started,
      completed: day.completed,
      averageScore: day.completedScoreCount ? Math.round(day.completedScoreTotal / day.completedScoreCount) : 0
    }));

    const topRiskSessions = riskSessions.sort((a, b) => b.riskScore - a.riskScore).slice(0, 8);
    const recentIntegrityEvents = securityEvents
      .sort((a, b) => new Date(b.createdAt || 0).getTime() - new Date(a.createdAt || 0).getTime())
      .slice(0, 80);
    const staleRiskCount = riskSessions.filter((session) => session.ageHours >= 24 && session.progressPercent <= 40).length;
    const aiSharePercent = sourceBreakdown
      .filter((item) => item.source === "ai" || item.source === "resume")
      .reduce((sum, item) => sum + Number(item.percent || 0), 0);

    return res.json({
      generatedAt: new Date().toISOString(),
      totals: {
        users: totalUsers,
        sessions: totalSessions,
        completed,
        inProgress,
        dropoffPercent,
        averageScore
      },
      sourceBreakdown,
      categoryBreakdown,
      trend,
      topRiskSessions,
      recentIntegrityEvents,
      alerts: buildAdminAlerts({
        totalSessions,
        completed,
        dropoffPercent,
        averageScore,
        staleRiskCount,
        aiSharePercent
      })
    });
  })
);

router.get(
  "/admin-db-report",
  adminRequired,
  asyncHandler(async (req, res) => {
    const db = mongoose.connection?.db;
    if (!db) {
      return res.status(503).json({ message: "Database is not connected." });
    }

    const limit = Math.max(10, Math.min(200, Number(req.query.limit || 50)));
    const collections = await db.listCollections({}, { nameOnly: true }).toArray();

    const collectionSummary = [];
    const tables = [];

    for (const item of collections) {
      const name = String(item?.name || "").trim();
      if (!name) continue;

      const nativeCollection = db.collection(name);
      const documentCount = await nativeCollection.estimatedDocumentCount();
      const docs = await nativeCollection.find({}).limit(limit).toArray();

      const rows = docs.map((doc) => serializeRow(doc));
      const columns = Array.from(
        new Set(rows.flatMap((row) => Object.keys(row)))
      );

      collectionSummary.push({
        name,
        documentCount: Number(documentCount || 0),
        rowsLoaded: rows.length
      });

      tables.push({
        collection: name,
        columns,
        rows
      });
    }

    return res.json({
      generatedAt: new Date().toISOString(),
      limitPerCollection: limit,
      collections: collectionSummary,
      tables
    });
  })
);

router.get(
  "/admin-billing",
  adminRequired,
  asyncHandler(async (req, res) => {
    const search = String(req.query.search || "")
      .trim()
      .toLowerCase();
    const planFilter = normalizeAdminPlan(req.query.plan);
    const statusFilter = normalizeAdminStatusFilter(req.query.status);
    const limit = Math.max(20, Math.min(500, Number(req.query.limit || 150)));
    const nowMs = Date.now();

    const users = await User.find({})
      .select("name email subscription paymentHistory createdAt")
      .lean();

    let activeProUsers = 0;
    let activeEliteUsers = 0;
    let activePaidUsers = 0;
    let totalPayments = 0;
    let paidPayments = 0;
    let pendingPayments = 0;
    let expiredPayments = 0;
    let revenueInrMonth = 0;

    const monthKey = new Date().toISOString().slice(0, 7);
    const paymentRows = [];
    const subscriberRows = [];

    for (const user of users) {
      const userId = String(user?._id || "");
      const name = String(user?.name || "").trim() || "Unknown";
      const email = String(user?.email || "").trim();
      const searchText = `${name} ${email}`.toLowerCase();
      const subscription = user?.subscription || {};
      const userPlan = normalizeAdminPlan(subscription?.plan) || "free";
      const userStatus = normalizeAdminSubscriptionStatus(subscription?.status) || "active";
      const currentPeriodEnd = subscription?.currentPeriodEnd || null;

      const periodEndMs = new Date(currentPeriodEnd || 0).getTime();
      const periodActive = !Number.isNaN(periodEndMs) && periodEndMs > nowMs;
      if (userStatus === "active" && periodActive && userPlan === "pro") {
        activeProUsers += 1;
      }
      if (userStatus === "active" && periodActive && userPlan === "elite") {
        activeEliteUsers += 1;
      }
      if (userStatus === "active" && periodActive && (userPlan === "pro" || userPlan === "elite")) {
        activePaidUsers += 1;
      }

      const subscriberMatchesFilter =
        (!search || searchText.includes(search)) &&
        (!planFilter || userPlan === planFilter) &&
        (!statusFilter || !["active", "expired", "cancelled"].includes(statusFilter) || userStatus === statusFilter);

      if (subscriberMatchesFilter) {
        subscriberRows.push({
          userId,
          name,
          email,
          plan: userPlan,
          status: userStatus,
          currency: String(subscription?.currency || "INR"),
          currentPeriodStart: subscription?.currentPeriodStart || null,
          currentPeriodEnd,
          lastPaymentAt: subscription?.lastPaymentAt || null,
          createdAt: user?.createdAt || null
        });
      }

      const history = Array.isArray(user?.paymentHistory) ? user.paymentHistory : [];
      for (const payment of history) {
        const effectiveStatus = resolveEffectivePaymentStatus(payment, nowMs);
        totalPayments += 1;
        if (effectiveStatus === "paid") paidPayments += 1;
        if (effectiveStatus === "pending") pendingPayments += 1;
        if (effectiveStatus === "expired") expiredPayments += 1;

        const paidAt = payment?.paidAt ? new Date(payment.paidAt) : null;
        const paidMonthKey = paidAt && !Number.isNaN(paidAt.getTime()) ? paidAt.toISOString().slice(0, 7) : "";
        if (effectiveStatus === "paid" && String(payment?.currency || "").toUpperCase() === "INR" && paidMonthKey === monthKey) {
          revenueInrMonth += Number(payment?.amount || 0);
        }

        const paymentMatchesFilter =
          (!search || searchText.includes(search) || String(payment?.paymentId || "").toLowerCase().includes(search)) &&
          (!planFilter || String(payment?.plan || "").toLowerCase() === planFilter) &&
          (!statusFilter || !["paid", "pending", "failed", "expired", "cancelled"].includes(statusFilter) || effectiveStatus === statusFilter);

        if (!paymentMatchesFilter) {
          continue;
        }

        paymentRows.push({
          paymentId: String(payment?.paymentId || ""),
          userId,
          name,
          email,
          plan: String(payment?.plan || ""),
          status: effectiveStatus,
          method: String(payment?.method || ""),
          currency: String(payment?.currency || ""),
          amount: Number(payment?.amount || 0),
          utr: String(payment?.utr || ""),
          createdAt: payment?.createdAt || null,
          paidAt: payment?.paidAt || null,
          expiresAt: payment?.expiresAt || null
        });
      }
    }

    subscriberRows.sort((a, b) => {
      const aStatus = a.status === "active" ? 0 : 1;
      const bStatus = b.status === "active" ? 0 : 1;
      if (aStatus !== bStatus) return aStatus - bStatus;
      return a.name.localeCompare(b.name);
    });

    paymentRows.sort((a, b) => {
      const aTime = new Date(a.createdAt || 0).getTime();
      const bTime = new Date(b.createdAt || 0).getTime();
      return bTime - aTime;
    });

    return res.json({
      generatedAt: new Date().toISOString(),
      filters: {
        search,
        plan: planFilter,
        status: statusFilter,
        limit
      },
      totals: {
        activePaidUsers,
        activeProUsers,
        activeEliteUsers,
        totalPayments,
        paidPayments,
        pendingPayments,
        expiredPayments,
        revenueInrMonth: Math.round(revenueInrMonth)
      },
      payments: paymentRows.slice(0, limit),
      subscribers: subscriberRows.slice(0, 300)
    });
  })
);

router.patch(
  "/admin-subscription/:userId",
  adminRequired,
  asyncHandler(async (req, res) => {
    const userId = String(req.params.userId || "").trim();
    if (!userId) {
      return res.status(400).json({ message: "User id is required." });
    }

    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({ message: "User not found." });
    }

    const plan = normalizeAdminPlan(req.body.plan);
    const status = normalizeAdminSubscriptionStatus(req.body.status);
    const currency = String(req.body.currency || user?.subscription?.currency || "INR")
      .trim()
      .toUpperCase();

    if (!plan) {
      return res.status(400).json({ message: "Valid plan is required (free/pro/elite)." });
    }
    if (!status) {
      return res.status(400).json({ message: "Valid status is required (active/expired/cancelled)." });
    }

    const now = new Date();
    const durationDays = Math.max(0, Math.min(730, Number(req.body.days || defaultSubscriptionDurationDays(plan))));
    const nextPeriodEnd = durationDays ? new Date(now.getTime() + durationDays * 24 * 60 * 60 * 1000) : null;

    const currentSubscription = user.subscription || {};
    const nextSubscription = {
      ...currentSubscription,
      plan,
      status,
      currency
    };

    if (status === "active" && plan !== "free") {
      nextSubscription.currentPeriodStart = now;
      nextSubscription.currentPeriodEnd = nextPeriodEnd;
      nextSubscription.lastPaymentAt = now;
    } else if (plan === "free") {
      nextSubscription.currentPeriodStart = null;
      nextSubscription.currentPeriodEnd = null;
    } else if (status !== "active") {
      nextSubscription.currentPeriodEnd = now;
    }

    user.subscription = nextSubscription;
    user.markModified("subscription");
    await user.save();

    return res.json({
      message: "Subscription updated successfully.",
      user: user.toSafeObject()
    });
  })
);

router.get(
  "/admin-users",
  adminRequired,
  asyncHandler(async (req, res) => {
    const search = String(req.query.search || "")
      .trim()
      .toLowerCase();
    const roleFilter = normalizeAdminRole(req.query.role);
    const accountStatusFilter = normalizeAdminAccountStatus(req.query.accountStatus);
    const limit = Math.max(20, Math.min(500, Number(req.query.limit || 200)));

    const users = await User.find({})
      .select(
        "name email role accountStatus createdAt lastPracticeDate points streak security subscription authProvider"
      )
      .sort({ createdAt: -1 })
      .lean();

    const rows = users
      .map((user) => {
        const safeName = String(user?.name || "").trim() || "Unknown";
        const safeEmail = String(user?.email || "").trim();
        const role = normalizeAdminRole(user?.role) || "user";
        const accountStatus = normalizeAdminAccountStatus(user?.accountStatus) || "active";
        const security = user?.security || {};
        const violationCount = Math.max(0, Number(security?.violationCount || 0));

        return {
          userId: String(user?._id || ""),
          name: safeName,
          email: safeEmail,
          role,
          accountStatus,
          authProvider: String(user?.authProvider || "local"),
          points: Number(user?.points || 0),
          streak: Number(user?.streak || 0),
          lastPracticeDate: user?.lastPracticeDate || null,
          createdAt: user?.createdAt || null,
          subscriptionPlan: String(user?.subscription?.plan || "free"),
          subscriptionStatus: String(user?.subscription?.status || "active"),
          violationCount,
          lastViolationAt: security?.lastViolationAt || null,
          lastViolationReason: String(security?.lastViolationReason || "")
        };
      })
      .filter((item) => {
        if (search) {
          const text = `${item.name} ${item.email}`.toLowerCase();
          if (!text.includes(search)) {
            return false;
          }
        }
        if (roleFilter && item.role !== roleFilter) {
          return false;
        }
        if (accountStatusFilter && item.accountStatus !== accountStatusFilter) {
          return false;
        }
        return true;
      });

    const totals = {
      users: rows.length,
      active: rows.filter((item) => item.accountStatus === "active").length,
      suspended: rows.filter((item) => item.accountStatus === "suspended").length,
      admins: rows.filter((item) => item.role === "admin").length,
      flagged: rows.filter((item) => item.violationCount > 0).length
    };

    return res.json({
      generatedAt: new Date().toISOString(),
      filters: {
        search,
        role: roleFilter,
        accountStatus: accountStatusFilter,
        limit
      },
      totals,
      users: rows.slice(0, limit)
    });
  })
);

router.post(
  "/admin-users/export-google-sheet",
  adminRequired,
  asyncHandler(async (req, res) => {
    const search = String(req.body?.search || req.query?.search || "")
      .trim()
      .toLowerCase();
    const roleFilter = normalizeAdminRole(req.body?.role || req.query?.role);
    const accountStatusFilter = normalizeAdminAccountStatus(req.body?.accountStatus || req.query?.accountStatus);

    const users = await User.find({})
      .select(
        "name email role accountStatus authProvider createdAt lastPracticeDate points streak security subscription"
      )
      .sort({ createdAt: -1 })
      .lean();

    const filteredUsers = users
      .map((user) => ({
        userId: String(user?._id || ""),
        name: String(user?.name || "").trim() || "Unknown",
        email: String(user?.email || "").trim(),
        role: normalizeAdminRole(user?.role) || "user",
        accountStatus: normalizeAdminAccountStatus(user?.accountStatus) || "active",
        authProvider: String(user?.authProvider || "local"),
        createdAt: user?.createdAt || null,
        lastPracticeDate: user?.lastPracticeDate || null,
        points: Number(user?.points || 0),
        streak: Number(user?.streak || 0),
        subscriptionPlan: String(user?.subscription?.plan || "free"),
        subscriptionStatus: String(user?.subscription?.status || "active"),
        subscriptionCurrency: String(user?.subscription?.currency || "INR"),
        subscriptionPeriodStart: user?.subscription?.currentPeriodStart || null,
        subscriptionPeriodEnd: user?.subscription?.currentPeriodEnd || null,
        violations: Number(user?.security?.violationCount || 0),
        lastViolationAt: user?.security?.lastViolationAt || null,
        lastViolationReason: String(user?.security?.lastViolationReason || "")
      }))
      .filter((item) => {
        if (search) {
          const text = `${item.name} ${item.email}`.toLowerCase();
          if (!text.includes(search)) {
            return false;
          }
        }
        if (roleFilter && item.role !== roleFilter) {
          return false;
        }
        if (accountStatusFilter && item.accountStatus !== accountStatusFilter) {
          return false;
        }
        return true;
      });

    const rows = [
      [
        "User ID",
        "Name",
        "Email",
        "Role",
        "Account Status",
        "Auth Provider",
        "Subscription Plan",
        "Subscription Status",
        "Subscription Currency",
        "Subscription Start (UTC)",
        "Subscription End (UTC)",
        "Points",
        "Streak",
        "Security Violations",
        "Last Violation At (UTC)",
        "Last Violation Reason",
        "Last Practice Date (UTC)",
        "Created At (UTC)"
      ],
      ...filteredUsers.map((item) => [
        item.userId,
        item.name,
        item.email,
        item.role,
        item.accountStatus,
        item.authProvider,
        item.subscriptionPlan,
        item.subscriptionStatus,
        item.subscriptionCurrency,
        toIsoCell(item.subscriptionPeriodStart),
        toIsoCell(item.subscriptionPeriodEnd),
        item.points,
        item.streak,
        item.violations,
        toIsoCell(item.lastViolationAt),
        item.lastViolationReason,
        toIsoCell(item.lastPracticeDate),
        toIsoCell(item.createdAt)
      ])
    ];

    try {
      const exportResult = await exportUsersToGoogleSheet(rows);
      return res.json({
        message: "Users exported to Google Sheet successfully.",
        exportedUsers: filteredUsers.length,
        ...exportResult
      });
    } catch (error) {
      const googleApiMessage = String(error?.response?.data?.error?.message || "").trim();
      const googleStatus = Number(error?.response?.status || 0);
      let resolvedMessage = error.message || "Google Sheet export failed.";

      if (googleStatus === 403) {
        const serviceAccount = String(env.googleServiceAccountEmail || "").trim();
        resolvedMessage = serviceAccount
          ? `Google Sheet access denied. Share sheet with service account editor access: ${serviceAccount}`
          : "Google Sheet access denied. Share sheet with configured service account editor access.";
      } else if (googleApiMessage) {
        resolvedMessage = `Google Sheet export failed: ${googleApiMessage}`;
      }

      const exportError = new Error(resolvedMessage);
      exportError.statusCode = 503;
      throw exportError;
    }
  })
);

router.patch(
  "/admin-users/:userId",
  adminRequired,
  asyncHandler(async (req, res) => {
    const userId = String(req.params.userId || "").trim();
    if (!userId) {
      return res.status(400).json({ message: "User id is required." });
    }

    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({ message: "User not found." });
    }

    const role = req.body.role !== undefined ? normalizeAdminRole(req.body.role) : "";
    const accountStatus =
      req.body.accountStatus !== undefined ? normalizeAdminAccountStatus(req.body.accountStatus) : "";
    const resetViolations = Boolean(req.body.resetViolations);
    const targetIsPrimaryAdmin = isPrimaryAdminEmail(user.email);

    if (req.body.role !== undefined && !role) {
      return res.status(400).json({ message: "Invalid role. Allowed: user/admin." });
    }
    if (req.body.accountStatus !== undefined && !accountStatus) {
      return res.status(400).json({ message: "Invalid account status. Allowed: active/suspended." });
    }
    if (req.body.role !== undefined && role === "admin" && !targetIsPrimaryAdmin) {
      return res.status(403).json({ message: "Only configured primary admin email can have admin role." });
    }
    if (req.body.role !== undefined && role === "user" && targetIsPrimaryAdmin) {
      return res.status(400).json({ message: "Primary admin role cannot be removed." });
    }

    if (String(req.auth.sub) === String(user._id)) {
      if (role && role !== user.role) {
        return res.status(400).json({ message: "You cannot change your own role." });
      }
      if (accountStatus === "suspended") {
        return res.status(400).json({ message: "You cannot suspend your own account." });
      }
    }

    if (role) {
      user.role = role;
    }
    if (!targetIsPrimaryAdmin && user.role === "admin") {
      user.role = "user";
    }
    if (targetIsPrimaryAdmin) {
      user.role = "admin";
    }
    if (accountStatus) {
      user.accountStatus = accountStatus;
    }
    if (resetViolations) {
      user.security = {
        ...(user.security || {}),
        violationCount: 0,
        lastViolationAt: null,
        lastViolationReason: ""
      };
      user.markModified("security");
    }

    await user.save();

    return res.json({
      message: "User updated successfully.",
      user: user.toSafeObject()
    });
  })
);

module.exports = router;
