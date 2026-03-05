const { env } = require("../config/env");
const { logger } = require("../utils/logger");
function buildFromAddress() {
  const fromAddress = String(env.emailFromAddress || "").trim();
  const fromName = String(env.emailFromName || "").trim();
  if (!fromAddress) {
    return "";
  }
  if (!fromName) {
    return fromAddress;
  }
  return `${fromName} <${fromAddress}>`;
}
function buildOutcome(overallScore = 0) {
  const normalized = Math.max(0, Math.min(100, Number(overallScore || 0)));
  const threshold = Math.max(0, Math.min(100, Number(env.interviewSelectionThreshold || 70)));
  const selected = normalized >= threshold;
  return {
    selected,
    threshold,
    statusLabel: selected ? "Selected" : "Not Selected",
    subject: selected ? "Interview Result: Congratulations, You Are Selected" : "Interview Result: Keep Improving, You Are Not Selected Yet"
  };
}
function buildEmailBody({
  userName = "Candidate",
  overallScore = 0,
  certificateId = "",
  verificationUrl = ""
}) {
  const outcome = buildOutcome(overallScore);
  const platformName = String(env.emailFromName || "AI Interview Practice Platform").trim() || "AI Interview Practice Platform";
  const safeUserName = String(userName || "Candidate").trim() || "Candidate";
  const decisionLine = outcome.selected
    ? "We are pleased to inform you that based on your performance in the interview, you have been selected. Your responses demonstrated good understanding and problem-solving ability."
    : "Thank you for your effort in the interview. Based on this round's performance, you have not been selected at this stage. Please keep practicing and review your feedback to improve further.";
  const closingLine = outcome.selected
    ? "Congratulations once again, and we wish you continued success in your learning journey."
    : "We appreciate your effort and wish you continued success in your learning journey.";
  const textLines = [
  `Dear ${safeUserName},`,
  "",
  `Thank you for completing the interview on our ${platformName}.`,
  "",
  decisionLine,
  "",
  "You can log in to your dashboard to view detailed feedback and next steps.",
  "",
  closingLine
  ];
  textLines.push("");
  if (certificateId) {
    textLines.push(`Certificate ID: ${certificateId}`);
  }
  if (verificationUrl) {
    textLines.push(`Certificate Verification Link: ${verificationUrl}`);
  }
  if (certificateId || verificationUrl) {
    textLines.push("");
  }
  textLines.push("Best regards,");
  textLines.push(platformName);
  textLines.push("AI Interview Practice Team");
  const html = `
<div style="font-family:Arial,sans-serif;line-height:1.5;color:#0f172a">
  <p>Dear <strong>${safeUserName}</strong>,</p>
  <p>Thank you for completing the interview on our ${platformName}.</p>
  <p>${decisionLine}</p>
  <p>You can log in to your dashboard to view detailed feedback and next steps.</p>
  ${certificateId || verificationUrl ? `
  <p>
    ${certificateId ? `<strong>Certificate ID:</strong> ${certificateId}<br/>` : ""}
    ${verificationUrl ? `<strong>Certificate Verification Link:</strong> <a href="${verificationUrl}">${verificationUrl}</a>` : ""}
  </p>
  ` : ""}
  <p>${closingLine}</p>
  <p>Best regards,<br/>${platformName}<br/>AI Interview Practice Team</p>
</div>
  `.trim();
  return {
    outcome,
    text: textLines.join("\n"),
    html
  };
}
async function sendViaResend({ to, subject, text, html }) {
  const apiKey = String(env.resendApiKey || "").trim();
  const from = buildFromAddress();
  if (!apiKey) {
    return {
      sent: false,
      status: "skipped",
      error: "RESEND_API_KEY is missing."
    };
  }
  if (/^replace[_-]?with/i.test(apiKey) || /^replace_me$/i.test(apiKey)) {
    return {
      sent: false,
      status: "skipped",
      error: "RESEND_API_KEY is placeholder. Set a real Resend API key."
    };
  }
  if (!from) {
    return {
      sent: false,
      status: "skipped",
      error: "EMAIL_FROM_ADDRESS is missing."
    };
  }
  const baseUrl = String(env.resendApiUrl || "https://api.resend.com").replace(/\/+$/, "");
  const response = await fetch(`${baseUrl}/emails`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`
    },
    body: JSON.stringify({
      from,
      to: [to],
      subject,
      text,
      html
    })
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    return {
      sent: false,
      status: "failed",
      error: String(payload?.message || payload?.error || `Email API failed with ${response.status}`),
      providerMessageId: ""
    };
  }
  return {
    sent: true,
    status: "sent",
    error: "",
    providerMessageId: String(payload?.id || "")
  };
}
async function sendInterviewResultEmail(input = {}) {
  const to = String(input?.to || "").trim();
  if (!to) {
    return {
      sent: false,
      status: "skipped",
      error: "Recipient email is missing."
    };
  }
  if (!env.interviewResultEmailEnabled) {
    return {
      sent: false,
      status: "skipped",
      error: "INTERVIEW_RESULT_EMAIL_ENABLED is false."
    };
  }
  const body = buildEmailBody(input);
  const subject = body.outcome.subject;
  const provider = String(env.emailProvider || "resend").toLowerCase();
  if (provider !== "resend") {
    return {
      sent: false,
      status: "skipped",
      error: `Unsupported EMAIL_PROVIDER "${provider}".`
    };
  }
  return sendViaResend({
    to,
    subject,
    text: body.text,
    html: body.html
  });
}
function queueInterviewResultEmail({ delayMs, sendTask, trace = {} }) {
  const effectiveDelayMs = Math.max(0, Number(delayMs || env.interviewResultEmailDelayMs || 5e3));
  const timer = setTimeout(async () => {
    try {
      await sendTask();
    } catch (error) {
      logger.error("Interview result email task failed", {
        ...trace,
        message: error?.message || "unknown"
      });
    }
  }, effectiveDelayMs);
  if (typeof timer?.unref === "function") {
    timer.unref();
  }
}
module.exports = {
  buildOutcome,
  buildEmailBody,
  sendInterviewResultEmail,
  queueInterviewResultEmail
};
