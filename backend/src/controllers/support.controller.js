const express = require("express");
const { asyncHandler } = require("../utils/asyncHandler");
const { sendSupportIssueEmail } = require("../services/supportEmail");
const { User } = require("../models");

const router = express.Router();

function normalizeText(input = "", maxLen = 2000) {
  return String(input || "").replace(/\s+/g, " ").trim().slice(0, maxLen);
}

function isValidEmail(input = "") {
  const value = String(input || "").trim();
  if (!value) {
    return false;
  }
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

router.post(
  "/contact",
  asyncHandler(async (req, res) => {
    const message = normalizeText(req.body.message || req.body.issue, 2500);
    const userName = normalizeText(req.body.userName || req.body.name, 120);
    const userEmail = normalizeText(req.body.userEmail || req.body.email, 180).toLowerCase();
    const pageUrl = normalizeText(req.body.pageUrl, 500);
    const submittedAt = normalizeText(req.body.submittedAt, 80) || new Date().toISOString();

    if (!message || message.length < 5) {
      return res.status(400).json({ message: "Please write your issue in at least 5 characters." });
    }
    if (userEmail && !isValidEmail(userEmail)) {
      return res.status(400).json({ message: "Please provide a valid email address." });
    }

    const adminUsers = await User.find({ role: "admin", accountStatus: { $ne: "suspended" } })
      .select("email")
      .lean();
    const adminRecipientEmails = adminUsers
      .map((user) => String(user?.email || "").trim().toLowerCase())
      .filter(Boolean);

    const result = await sendSupportIssueEmail({
      message,
      userName,
      userEmail,
      toEmails: adminRecipientEmails,
      pageUrl,
      submittedAt,
      userAgent: req.get("user-agent") || "",
      ipAddress: req.ip || ""
    });

    if (!result.sent) {
      return res.status(503).json({
        message: result.error || "Unable to send your issue right now. Please try again."
      });
    }

    return res.status(201).json({
      message: result.fallbackRecipient
        ? `Your issue was sent to the configured Resend test inbox (${result.fallbackRecipient}). Verify a domain to deliver to all admin emails.`
        : "Your issue has been shared with admin support."
    });
  })
);

module.exports = router;
