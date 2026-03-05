const { env } = require("../config/env");

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

function escapeHtml(input = "") {
  return String(input || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function parseRecipientList(input) {
  if (Array.isArray(input)) {
    return [...new Set(input.map((item) => String(item || "").trim().toLowerCase()).filter(Boolean))];
  }
  return [...new Set(String(input || "")
    .split(",")
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean))];
}

function extractResendSandboxEmail(errorMessage = "") {
  const match = String(errorMessage || "").match(/own email address\s*\(([^)]+)\)/i);
  return match?.[1] ? String(match[1]).trim().toLowerCase() : "";
}

async function sendViaResend({ to, subject, text, html, replyTo = "" }) {
  const recipients = parseRecipientList(to);
  const apiKey = String(env.resendApiKey || "").trim();
  const from = buildFromAddress();
  if (!recipients.length) {
    return {
      sent: false,
      status: "skipped",
      error: "Support recipient email is missing."
    };
  }
  if (!apiKey) {
    return {
      sent: false,
      status: "skipped",
      error: "RESEND_API_KEY is missing."
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
  const payload = {
    from,
    to: recipients,
    subject,
    text,
    html
  };
  if (replyTo) {
    payload.reply_to = replyTo;
  }

  const response = await fetch(`${baseUrl}/emails`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`
    },
    body: JSON.stringify(payload)
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    const providerError = String(body?.message || body?.error || `Email API failed with ${response.status}`);
    const sandboxFallbackEmail = extractResendSandboxEmail(providerError);
    const sandboxOnlyAlready =
      recipients.length === 1 && recipients[0] === sandboxFallbackEmail;
    if (sandboxFallbackEmail && !sandboxOnlyAlready) {
      const fallbackPayload = {
        ...payload,
        to: [sandboxFallbackEmail]
      };
      const fallbackResponse = await fetch(`${baseUrl}/emails`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`
        },
        body: JSON.stringify(fallbackPayload)
      });
      const fallbackBody = await fallbackResponse.json().catch(() => ({}));
      if (fallbackResponse.ok) {
        return {
          sent: true,
          status: "sent",
          error: "",
          providerMessageId: String(fallbackBody?.id || ""),
          fallbackRecipient: sandboxFallbackEmail
        };
      }
    }

    return {
      sent: false,
      status: "failed",
      error: providerError
    };
  }
  return {
    sent: true,
    status: "sent",
    error: "",
    providerMessageId: String(body?.id || "")
  };
}

function buildSupportEmailBody({
  message = "",
  userName = "",
  userEmail = "",
  pageUrl = "",
  submittedAt = "",
  userAgent = "",
  ipAddress = ""
}) {
  const safeMessage = String(message || "").trim();
  const safeUserName = String(userName || "").trim() || "Unknown";
  const safeUserEmail = String(userEmail || "").trim() || "Not provided";
  const safePageUrl = String(pageUrl || "").trim() || "Unknown";
  const safeSubmittedAt = String(submittedAt || "").trim() || new Date().toISOString();
  const safeUserAgent = String(userAgent || "").trim() || "Unknown";
  const safeIpAddress = String(ipAddress || "").trim() || "Unknown";

  const text = [
    "New support issue received from Contact Us chatbot.",
    "",
    `User: ${safeUserName}`,
    `Email: ${safeUserEmail}`,
    `Page: ${safePageUrl}`,
    `Submitted At: ${safeSubmittedAt}`,
    `IP: ${safeIpAddress}`,
    `User Agent: ${safeUserAgent}`,
    "",
    "Issue Message:",
    safeMessage
  ].join("\n");

  const html = `
<div style="font-family:Arial,sans-serif;line-height:1.5;color:#0f172a">
  <h3 style="margin:0 0 12px 0;">New Support Issue</h3>
  <p><strong>User:</strong> ${escapeHtml(safeUserName)}<br/>
  <strong>Email:</strong> ${escapeHtml(safeUserEmail)}<br/>
  <strong>Page:</strong> ${escapeHtml(safePageUrl)}<br/>
  <strong>Submitted At:</strong> ${escapeHtml(safeSubmittedAt)}<br/>
  <strong>IP:</strong> ${escapeHtml(safeIpAddress)}<br/>
  <strong>User Agent:</strong> ${escapeHtml(safeUserAgent)}</p>
  <p><strong>Issue Message:</strong></p>
  <div style="white-space:pre-wrap;border:1px solid #e2e8f0;border-radius:8px;padding:10px;background:#f8fafc;">
    ${escapeHtml(safeMessage)}
  </div>
</div>
  `.trim();

  return { text, html };
}

async function sendSupportIssueEmail({
  message = "",
  userName = "",
  userEmail = "",
  toEmails = [],
  pageUrl = "",
  submittedAt = "",
  userAgent = "",
  ipAddress = ""
} = {}) {
  const envRecipients = parseRecipientList(env.supportRequestToEmail || env.emailFromAddress);
  const providedRecipients = parseRecipientList(toEmails);
  const recipients = [...new Set([...providedRecipients, ...envRecipients])];
  if (!recipients.length) {
    return {
      sent: false,
      status: "skipped",
      error: "Support recipient email is missing."
    };
  }
  if (!env.supportRequestEmailEnabled) {
    return {
      sent: false,
      status: "skipped",
      error: "SUPPORT_REQUEST_EMAIL_ENABLED is false."
    };
  }

  const provider = String(env.emailProvider || "resend").trim().toLowerCase();
  if (provider !== "resend") {
    return {
      sent: false,
      status: "skipped",
      error: `Unsupported EMAIL_PROVIDER "${provider}".`
    };
  }

  const { text, html } = buildSupportEmailBody({
    message,
    userName,
    userEmail,
    pageUrl,
    submittedAt,
    userAgent,
    ipAddress
  });
  const subject = `Support Issue: ${String(userName || "Anonymous User").trim() || "Anonymous User"}`;

  return sendViaResend({
    to: recipients,
    subject,
    text,
    html,
    replyTo: String(userEmail || "").trim()
  });
}

module.exports = {
  sendSupportIssueEmail
};
