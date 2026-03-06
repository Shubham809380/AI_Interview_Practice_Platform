const express = require("express");
const crypto = require("crypto");
const { env } = require("../config/env");
const { authRequired } = require("../middleware/auth");
const { asyncHandler } = require("../utils/asyncHandler");
const { User } = require("../models");
const router = express.Router();
const PLAN_CONFIG = {
  pro: { durationDays: 30, priceByCurrency: { INR: 499, USD: 8, EUR: 7 } },
  elite: { durationDays: 365, priceByCurrency: { INR: 4499, USD: 79, EUR: 69 } }
};
const SUPPORTED_METHODS = new Set(["upi"]);
const SUPPORTED_CURRENCIES = new Set(["INR", "USD", "EUR"]);
const PAYMENT_EXPIRY_MS = 15 * 60 * 1e3;
const MAX_PAYMENT_HISTORY = 40;
const UTR_REGEX = /^\d{12}$/;
function normalizePlan(value) {
  const plan = String(value || "").trim().toLowerCase();
  return plan === "elite" ? "elite" : "pro";
}
function normalizeMethod(value) {
  const method = String(value || "").trim().toLowerCase();
  return method;
}
function normalizeCurrency(value) {
  const currency = String(value || "").trim().toUpperCase();
  return SUPPORTED_CURRENCIES.has(currency) ? currency : "INR";
}
function normalizeUtr(value) {
  return String(value || "").trim().replace(/\s+/g, "").slice(0, 12);
}
function isValidUtr(value) {
  const normalized = normalizeUtr(value);
  return UTR_REGEX.test(normalized);
}
function createPaymentId() {
  return `PAY-${Date.now()}-${crypto.randomBytes(4).toString("hex").toUpperCase()}`;
}
function buildUpiUri({ upiId, merchantName, amount, note, transactionRef }) {
  const params = new URLSearchParams({
    pa: upiId,
    pn: merchantName,
    am: String(amount),
    cu: "INR",
    tn: note,
    tr: transactionRef
  });
  return `upi://pay?${params.toString()}`;
}
function buildQrCodeUrl(upiUri) {
  const provider = String(env.paymentQrProvider || "https://api.qrserver.com/v1/create-qr-code/").trim();
  const separator = provider.includes("?") ? "&" : "?";
  return `${provider}${separator}size=260x260&data=${encodeURIComponent(upiUri)}`;
}
function findPaymentIndexById(user, paymentId) {
  return (user.paymentHistory || []).findIndex((item) => item.paymentId === paymentId);
}
function markExpiredIfNeeded(payment) {
  if (!payment || payment.status !== "pending") {
    return false;
  }
  const expiresAt = new Date(payment.expiresAt || 0);
  if (Number.isNaN(expiresAt.getTime())) {
    return false;
  }
  if (Date.now() <= expiresAt.getTime()) {
    return false;
  }
  payment.status = "expired";
  return true;
}
function summarizePayment(payment) {
  return {
    paymentId: payment.paymentId,
    plan: payment.plan,
    method: payment.method,
    status: payment.status,
    currency: payment.currency,
    amount: payment.amount,
    upiId: payment.upiId,
    upiUri: payment.upiUri,
    qrCodeUrl: payment.qrCodeUrl,
    utr: payment.utr,
    createdAt: payment.createdAt,
    expiresAt: payment.expiresAt,
    paidAt: payment.paidAt
  };
}
function activateSubscriptionFromPayment(user, payment) {
  const planConfig = PLAN_CONFIG[payment.plan];
  const durationDays = Number(planConfig?.durationDays || 30);
  const now = new Date();
  const currentEnd = new Date(user.subscription?.currentPeriodEnd || 0);
  const hasActivePeriod = !Number.isNaN(currentEnd.getTime()) && currentEnd > now;
  const base = hasActivePeriod ? currentEnd : now;
  const nextEnd = new Date(base.getTime() + durationDays * 24 * 60 * 60 * 1e3);
  user.subscription = {
    ...user.subscription,
    plan: payment.plan,
    status: "active",
    currency: payment.currency,
    currentPeriodStart: now,
    currentPeriodEnd: nextEnd,
    autoRenew: false,
    lastPaymentAt: now
  };
}
router.post(
  "/intent",
  authRequired,
  asyncHandler(async (req, res) => {
    const method = normalizeMethod(req.body.method || "upi");
    if (!SUPPORTED_METHODS.has(method)) {
      return res.status(400).json({ message: "Only UPI payments are supported right now." });
    }
    const plan = normalizePlan(req.body.plan);
    const currency = normalizeCurrency(req.body.currency || "INR");
    if (currency !== "INR") {
      return res.status(400).json({ message: "UPI supports INR in this flow. Please choose INR." });
    }
    const planConfig = PLAN_CONFIG[plan];
    const amount = Number(planConfig?.priceByCurrency?.[currency] || 0);
    if (!amount) {
      return res.status(400).json({ message: "Invalid plan or currency." });
    }
    const user = await User.findById(req.auth.sub);
    if (!user) {
      return res.status(404).json({ message: "User not found." });
    }
    const paymentId = createPaymentId();
    const createdAt = new Date();
    const expiresAt = new Date(createdAt.getTime() + PAYMENT_EXPIRY_MS);
    const merchantName = String(env.paymentMerchantName || "AI Interview Platform").trim().slice(0, 48);
    const upiId = String(env.paymentUpiId || "6372516197-2@ibl").trim();
    const note = `${plan.toUpperCase()} subscription`;
    const upiUri = buildUpiUri({
      upiId,
      merchantName,
      amount,
      note,
      transactionRef: paymentId
    });
    const qrCodeUrl = buildQrCodeUrl(upiUri);
    user.paymentHistory = (user.paymentHistory || []).filter((item) => item?.paymentId).slice(0, MAX_PAYMENT_HISTORY - 1);
    user.paymentHistory.unshift({
      paymentId,
      plan,
      method,
      status: "pending",
      currency,
      amount,
      upiId,
      upiUri,
      qrCodeUrl,
      createdAt,
      expiresAt
    });
    await user.save();
    return res.status(201).json({
      payment: summarizePayment(user.paymentHistory[0]),
      subscription: user.subscription,
      message: "QR generated. Complete UPI payment and confirm once done."
    });
  })
);
router.get(
  "/:paymentId",
  authRequired,
  asyncHandler(async (req, res) => {
    const paymentId = String(req.params.paymentId || "").trim();
    if (!paymentId) {
      return res.status(400).json({ message: "Payment id is required." });
    }
    const user = await User.findById(req.auth.sub);
    if (!user) {
      return res.status(404).json({ message: "User not found." });
    }
    const index = findPaymentIndexById(user, paymentId);
    if (index < 0) {
      return res.status(404).json({ message: "Payment not found." });
    }
    const payment = user.paymentHistory[index];
    const expired = markExpiredIfNeeded(payment);
    if (expired) {
      user.markModified("paymentHistory");
      await user.save();
    }
    return res.json({
      payment: summarizePayment(payment),
      subscription: user.subscription
    });
  })
);
router.post(
  "/:paymentId/confirm",
  authRequired,
  asyncHandler(async (req, res) => {
    const paymentId = String(req.params.paymentId || "").trim();
    if (!paymentId) {
      return res.status(400).json({ message: "Payment id is required." });
    }
    const user = await User.findById(req.auth.sub);
    if (!user) {
      return res.status(404).json({ message: "User not found." });
    }
    const index = findPaymentIndexById(user, paymentId);
    if (index < 0) {
      return res.status(404).json({ message: "Payment not found." });
    }
    const payment = user.paymentHistory[index];
    const utr = normalizeUtr(req.body.utr || "");
    if (!isValidUtr(utr)) {
      return res.status(400).json({
        message: "Valid UTR is required. Enter a 12-digit numeric UTR."
      });
    }
    if (payment.status === "paid") {
      return res.json({
        message: "Payment already marked as successful.",
        payment: summarizePayment(payment),
        subscription: user.subscription,
        user: user.toSafeObject()
      });
    }
    const expired = markExpiredIfNeeded(payment);
    if (expired || payment.status === "expired") {
      user.markModified("paymentHistory");
      await user.save();
      return res.status(409).json({ message: "Payment window expired. Generate a fresh QR and retry." });
    }
    if (payment.status !== "pending") {
      return res.status(409).json({ message: "This payment is no longer pending." });
    }
    const duplicateUtr = await User.exists({
      paymentHistory: {
        $elemMatch: {
          paymentId: { $ne: paymentId },
          status: "paid",
          utr
        }
      }
    });
    if (duplicateUtr) {
      return res.status(409).json({
        message: "This UTR is already used in another successful payment."
      });
    }
    payment.status = "paid";
    payment.paidAt = new Date();
    payment.utr = utr;
    activateSubscriptionFromPayment(user, payment);
    user.markModified("paymentHistory");
    user.markModified("subscription");
    await user.save();
    return res.json({
      message: "Timing Successful. Payment received and subscription activated.",
      payment: summarizePayment(payment),
      subscription: user.subscription,
      user: user.toSafeObject()
    });
  })
);
router.get(
  "/subscription/me",
  authRequired,
  asyncHandler(async (req, res) => {
    const user = await User.findById(req.auth.sub);
    if (!user) {
      return res.status(404).json({ message: "User not found." });
    }
    return res.json({
      subscription: user.subscription,
      latestPayments: (user.paymentHistory || []).slice(0, 10).map((item) => summarizePayment(item))
    });
  })
);
module.exports = router;
