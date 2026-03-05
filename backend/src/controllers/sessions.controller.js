const express = require("express");
const crypto = require("crypto");
const mongoose = require("mongoose");
const multer = require("multer");
const { authRequired } = require("../middleware/auth");
const { asyncHandler } = require("../utils/asyncHandler");
const { InterviewSession, Question, User } = require("../models");
const { transcribeMedia } = require("../services/speechToText");
const { evaluateAnswer } = require("../services/aiEvaluator");
const {
  generateAiQuestions,
  generateAiQuestionsWithGemini,
  generateFollowUpQuestion,
  generateFollowUpQuestionWithAi
} = require("../services/questionGenerator");
const { generateGeminiText } = require("../services/geminiClient");
const { generateOpenAiText } = require("../services/openAiClient");
const { env } = require("../config/env");
const { buildOutcome, sendInterviewResultEmail } = require("../services/interviewResultEmail");
const { applyGamification } = require("../services/badgeService");
const { logger } = require("../utils/logger");
const router = express.Router();
const ALLOWED_CATEGORIES = ["HR", "Technical", "Behavioral", "Coding"];
const ALLOWED_SOURCES = ["predefined", "ai", "resume"];
const ALLOWED_JUDGE_MODES = new Set(["judge", "live_interviewer"]);
const MAX_MEDIA_FILE_BYTES = 25 * 1024 * 1024;
const ALLOWED_AUDIO_MIME_TYPES = new Set([
"audio/webm",
"audio/wav",
"audio/x-wav",
"audio/mpeg",
"audio/mp3",
"audio/mp4",
"audio/aac",
"audio/ogg"]
);
const ALLOWED_VIDEO_MIME_TYPES = new Set(["video/webm", "video/mp4", "video/quicktime", "video/x-msvideo"]);
function createHttpError(message, statusCode = 400, extra = {}) {
  const error = new Error(message);
  error.statusCode = statusCode;
  Object.assign(error, extra);
  return error;
}
function normalizeFileMimeType(input = "") {
  return String(input || "").trim().toLowerCase();
}
function average(values) {
  if (!values.length) {
    return 0;
  }
  return Math.round(values.reduce((sum, value) => sum + value, 0) / values.length);
}
function normalizeWords(text) {
  return String(text || "").toLowerCase().replace(/[^a-z0-9\s]/g, " ").split(/\s+/).map((token) => token.trim()).filter((token) => token.length >= 4);
}
function normalizeFocusAreas(input) {
  if (!Array.isArray(input)) {
    return [];
  }
  return [...new Set(input.map((item) => String(item || "").trim()).filter(Boolean))].slice(0, 6);
}
function normalizeJudgeHistory(input) {
  if (!Array.isArray(input)) {
    return [];
  }
  return input.map((item) => ({
    role: String(item?.role || "").trim().toLowerCase(),
    text: String(item?.text || "").replace(/\s+/g, " ").trim()
  })).filter((item) => ["user", "judge", "assistant"].includes(item.role) && item.text).slice(-10);
}
function normalizeJudgeMode(input) {
  const mode = String(input || "").trim().toLowerCase();
  if (!mode || !ALLOWED_JUDGE_MODES.has(mode)) {
    return "judge";
  }
  return mode;
}
function normalizeIntegrityEventType(input) {
  const type = String(input || "").trim().toLowerCase();
  if (["network", "focus", "clipboard", "policy"].includes(type)) {
    return type;
  }
  return "policy";
}
function normalizeIntegrityReason(input) {
  return String(input || "").replace(/\s+/g, " ").trim().slice(0, 180);
}
function parseTimelineMarkersInput(input) {
  let parsed = input;
  if (typeof parsed === "string") {
    const trimmed = parsed.trim();
    if (!trimmed) {
      return [];
    }
    try {
      parsed = JSON.parse(trimmed);
    } catch (error) {
      return [];
    }
  }
  if (!Array.isArray(parsed)) {
    return [];
  }
  return parsed.map((item) => ({
    second: Math.max(0, Number(item?.second || 0)),
    label: String(item?.label || "").trim(),
    kind: String(item?.kind || "info").trim() || "info"
  })).filter((item) => item.label);
}
const answerUpload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: MAX_MEDIA_FILE_BYTES,
    files: 2
  },
  fileFilter: (req, file, callback) => {
    const fieldName = String(file?.fieldname || "").trim();
    const mimeType = normalizeFileMimeType(file?.mimetype);
    if (fieldName === "audioFile") {
      if (!ALLOWED_AUDIO_MIME_TYPES.has(mimeType) && !ALLOWED_VIDEO_MIME_TYPES.has(mimeType)) {
        return callback(createHttpError("Unsupported audio format. Use webm/wav/mp3/mp4/ogg."));
      }
      return callback(null, true);
    }
    if (fieldName === "videoFile") {
      if (!ALLOWED_VIDEO_MIME_TYPES.has(mimeType)) {
        return callback(createHttpError("Unsupported video format. Use webm/mp4/mov/avi."));
      }
      return callback(null, true);
    }
    return callback(createHttpError(`Unexpected upload field "${fieldName}".`));
  }
}).fields([
{ name: "audioFile", maxCount: 1 },
{ name: "videoFile", maxCount: 1 }]
);
function answerUploadMiddleware(req, res, next) {
  answerUpload(req, res, (error) => {
    if (!error) {
      return next();
    }
    if (error instanceof multer.MulterError) {
      if (error.code === "LIMIT_FILE_SIZE") {
        return res.status(400).json({ message: `Uploaded media is too large (max ${MAX_MEDIA_FILE_BYTES / (1024 * 1024)}MB).` });
      }
      return res.status(400).json({ message: error.message || "Invalid media upload." });
    }
    return next(error);
  });
}
function estimateDurationFromText(text) {
  const words = String(text || "").trim().split(/\s+/).filter(Boolean).length;
  if (!words) {
    return 0;
  }
  return Math.max(10, Math.round(words / 140 * 60));
}
function buildTimelineMarkers({ durationSec, rawText, improvements = [], relevanceNotes = "" }) {
  const effectiveDuration = durationSec > 0 ? durationSec : estimateDurationFromText(rawText);
  if (!effectiveDuration) {
    return [];
  }
  const markerAt = (ratio) => Math.max(1, Math.min(effectiveDuration, Math.round(effectiveDuration * ratio)));
  const markers = [
  {
    second: markerAt(0.2),
    label: "Start with stronger context and clearer framing.",
    kind: "clarity"
  },
  {
    second: markerAt(0.55),
    label: "Add a specific action with measurable result.",
    kind: "relevance"
  },
  {
    second: markerAt(0.85),
    label: "Close with impact and ownership.",
    kind: "confidence"
  }];

  const topImprovement = String(improvements?.[0] || "").trim();
  if (topImprovement) {
    markers[1].label = topImprovement;
  }
  const note = String(relevanceNotes || "").trim();
  if (note) {
    markers[2].label = note;
  }
  return markers;
}
function computeJobFitScore(session, answeredQuestions) {
  const jdTokens = new Set(normalizeWords(session.jobDescriptionText || ""));
  if (!jdTokens.size) {
    return 0;
  }
  const answerTokens = new Set(
    answeredQuestions.flatMap((item) => normalizeWords(item?.answer?.transcript || item?.answer?.rawText || ""))
  );
  if (!answerTokens.size) {
    return 0;
  }
  let matched = 0;
  for (const token of jdTokens) {
    if (answerTokens.has(token)) {
      matched += 1;
    }
  }
  return Math.max(0, Math.min(100, Math.round(matched / jdTokens.size * 100)));
}
function markInterviewResultEmailQueued(session) {
  const existing = session?.notifications?.interviewResultEmail || {};
  const status = String(existing?.lastStatus || "").toLowerCase();
  if (status === "sent") {
    return false;
  }
  const queuedAt = new Date();
  session.notifications = {
    ...(session.notifications || {}),
    interviewResultEmail: {
      ...existing,
      lastStatus: "queued",
      queuedAt,
      lastError: ""
    }
  };
  return true;
}
function buildSelectionResult(overallScore = 0) {
  const outcome = buildOutcome(overallScore);
  return {
    selected: Boolean(outcome.selected),
    statusLabel: String(outcome.statusLabel || ""),
    cutoffScore: Number(outcome.threshold || 0)
  };
}
function buildEmailNotificationResult(session, recipientEmail = "") {
  const state = session?.notifications?.interviewResultEmail || {};
  const rawStatus = String(state?.lastStatus || "").trim().toLowerCase();
  return {
    enabled: Boolean(env.interviewResultEmailEnabled),
    recipientEmail: String(recipientEmail || "").trim(),
    status: rawStatus || (env.interviewResultEmailEnabled ? "pending" : "disabled"),
    queuedAt: state?.queuedAt || null,
    sentAt: state?.sentAt || null,
    lastAttemptAt: state?.lastAttemptAt || null,
    attempts: Math.max(0, Number(state?.attempts || 0)),
    error: String(state?.lastError || "")
  };
}
async function syncLatestEmailNotificationState(session) {
  if (!session?._id) {
    return;
  }
  const latest = await InterviewSession.findById(session._id).select("notifications.interviewResultEmail").lean();
  if (!latest?.notifications?.interviewResultEmail) {
    return;
  }
  session.notifications = {
    ...(session.notifications || {}),
    interviewResultEmail: latest.notifications.interviewResultEmail
  };
}
async function scheduleInterviewResultEmail({ session, user, req, trigger = "complete" }) {
  const recipientEmail = String(user?.email || "").trim();
  if (!recipientEmail) {
    logger.warn("Interview result email skipped: missing recipient email", {
      sessionId: String(session?._id || ""),
      trigger
    });
    return false;
  }
  const sessionId = String(session?._id || "");
  const payload = {
    to: recipientEmail,
    userName: String(user?.name || "Candidate"),
    category: String(session?.category || "HR"),
    targetRole: String(session?.targetRole || "Generalist"),
    overallScore: Number(session?.overallScore || 0),
    sessionId,
    certificateId: String(session?.certificate?.id || ""),
    verificationUrl: buildCertificateVerificationUrl(req, session?.certificate?.id || ""),
    strengths: Array.isArray(session?.summary?.strengths) ? session.summary.strengths : [],
    improvements: Array.isArray(session?.summary?.improvements) ? session.summary.improvements : []
  };
  try {
    const attemptedAt = new Date();
    await InterviewSession.updateOne(
      { _id: session?._id },
      {
        $set: {
          "notifications.interviewResultEmail.lastAttemptAt": attemptedAt
        },
        $inc: {
          "notifications.interviewResultEmail.attempts": 1
        }
      }
    );
    const result = await sendInterviewResultEmail(payload);
    const update = {
      "notifications.interviewResultEmail.lastStatus": String(result?.status || "failed"),
      "notifications.interviewResultEmail.lastError": String(result?.error || ""),
      "notifications.interviewResultEmail.providerMessageId": String(result?.providerMessageId || "")
    };
    if (result?.sent) {
      update["notifications.interviewResultEmail.sentAt"] = new Date();
    }
    await InterviewSession.updateOne({ _id: session?._id }, { $set: update });
    if (result?.sent) {
      logger.info("Interview result email sent", {
        sessionId,
        to: recipientEmail,
        providerMessageId: String(result?.providerMessageId || "")
      });
    } else {
      logger.warn("Interview result email not sent", {
        sessionId,
        to: recipientEmail,
        status: String(result?.status || "failed"),
        error: String(result?.error || "")
      });
    }
    return Boolean(result?.sent);
  } catch (error) {
    logger.error("Interview result email task failed", {
      sessionId,
      userId: String(user?._id || ""),
      trigger,
      message: error?.message || "unknown"
    });
    await InterviewSession.updateOne(
      { _id: session?._id },
      {
        $set: {
          "notifications.interviewResultEmail.lastStatus": "failed",
          "notifications.interviewResultEmail.lastError": String(error?.message || "unknown")
        }
      }
    );
    return false;
  }
}
function createCertificateId(sessionId, userId) {
  const seed = `${sessionId}-${userId}-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  return `CERT-${crypto.createHash("sha1").update(seed).digest("hex").slice(0, 12).toUpperCase()}`;
}
function normalizeBaseUrl(input = "") {
  return String(input || "").trim().replace(/\/+$/, "");
}
function isLocalHostValue(value = "") {
  return /^(localhost|127\.0\.0\.1)(:\d+)?$/i.test(String(value || "").trim());
}
function buildCertificateVerificationUrl(req, certificateId) {
  if (!certificateId) {
    return "";
  }
  const configuredBaseUrl = normalizeBaseUrl(env.backendBaseUrl);
  if (configuredBaseUrl) {
    try {
      const parsed = new URL(configuredBaseUrl);
      if (!isLocalHostValue(parsed.host)) {
        return `${configuredBaseUrl}/api/sessions/certificates/${certificateId}`;
      }
    } catch {
    }
  }
  const forwardedProto = String(req?.headers?.["x-forwarded-proto"] || "").split(",")[0].trim();
  const forwardedHost = String(req?.headers?.["x-forwarded-host"] || "").split(",")[0].trim();
  const host = forwardedHost || String(req?.get("host") || "").trim();
  const protocol = forwardedProto || req?.protocol || "http";
  if (host && !isLocalHostValue(host)) {
    return `${protocol}://${host}/api/sessions/certificates/${certificateId}`;
  }
  if (configuredBaseUrl) {
    return `${configuredBaseUrl}/api/sessions/certificates/${certificateId}`;
  }
  return `${protocol}://${host || "localhost:5000"}/api/sessions/certificates/${certificateId}`;
}
function findWeakMetric(scores = {}) {
  const entries = Object.entries(scores || {}).filter(([key]) => key !== "overall").map(([key, value]) => [key, Number(value || 0)]);
  if (!entries.length) {
    return null;
  }
  return entries.sort((a, b) => a[1] - b[1])[0];
}
function sanitizeCandidateMessage(message = "") {
  return String(message || "").replace(/^candidate response:\s*/i, "").replace(/\s+/g, " ").trim();
}
function detectStarHints(text = "") {
  const normalized = String(text || "").toLowerCase();
  const hasSituation = /\b(team|project|client|context|challenge|issue|problem)\b/.test(normalized);
  const hasAction = /\b(i built|i led|i implemented|i designed|i optimized|i solved|i delivered|i created)\b/.test(
    normalized
  );
  const hasResult = /\b(%|percent|reduced|improved|increased|saved|faster|impact|outcome|result)\b/.test(normalized);
  return { hasSituation, hasAction, hasResult };
}
function isStuckMessage(text = "") {
  const normalized = String(text || "").toLowerCase();
  return /\b(i don't know|dont know|do not know|not sure|no idea|can't answer|cannot answer|skip|pass|help me|hint)\b/.test(
    normalized
  );
}
function isDirectUserQuestion(text = "") {
  const normalized = String(text || "").toLowerCase().trim();
  if (!normalized) {
    return false;
  }
  if (normalized.includes("?")) {
    return true;
  }
  return /^(what|why|how|can|could|would|should|do|does|did|is|are|please|tell|explain|define)\b/.test(normalized);
}
function looksLikeCandidateAnswerNarrative(text = "") {
  const normalized = String(text || "").toLowerCase();
  const words = normalized.split(/\s+/).filter(Boolean).length;
  const hasFirstPerson = /\b(i|my|we|our)\b/.test(normalized);
  const hasAction = /\b(built|led|implemented|designed|optimized|delivered|created|handled|managed|launched|improved|reduced)\b/.test(
    normalized
  );
  const hasOutcome = /\b(%|percent|improved|reduced|increased|impact|result|outcome|saved)\b/.test(normalized);
  return words >= 12 && hasFirstPerson && (hasAction || hasOutcome);
}
function detectQuestionRequestIntent(text = "") {
  const normalized = String(text || "").toLowerCase();
  const asksQuestion = /\b(question|questions|ques|interview question|problem|problems|scenario|case study|challenge)\b/.test(
    normalized
  );
  const asksToProvide = /\b(give|share|provide|ask|generate|send|need|want|kuch|some|practice)\b/.test(normalized);
  const asksPractice = /\b(practice|mock|round|interview)\b/.test(normalized);
  return asksQuestion && (asksToProvide || asksPractice);
}
function inferRequestedCategory(text = "", fallbackCategory = "HR") {
  const normalized = String(text || "").toLowerCase();
  if (/\b(hr|human resource|human resources)\b/.test(normalized)) {
    return "HR";
  }
  if (/\b(technical|system design|backend|frontend|devops)\b/.test(normalized)) {
    return "Technical";
  }
  if (/\b(behavioral|behavioural|leadership|culture)\b/.test(normalized)) {
    return "Behavioral";
  }
  if (/\b(coding|code|dsa|algorithm)\b/.test(normalized)) {
    return "Coding";
  }
  if (ALLOWED_CATEGORIES.includes(String(fallbackCategory || ""))) {
    return fallbackCategory;
  }
  return "HR";
}
function inferRequestedCategories(text = "", fallbackCategory = "HR") {
  const normalized = String(text || "").toLowerCase();
  const found = [];
  if (/\b(hr|human resource|human resources)\b/.test(normalized)) {
    found.push("HR");
  }
  if (/\b(technical|system design|backend|frontend|devops)\b/.test(normalized)) {
    found.push("Technical");
  }
  if (/\b(behavioral|behavioural|leadership|culture)\b/.test(normalized)) {
    found.push("Behavioral");
  }
  if (/\b(coding|code|dsa|algorithm)\b/.test(normalized)) {
    found.push("Coding");
  }
  if (found.length) {
    return [...new Set(found)];
  }
  return [inferRequestedCategory(text, fallbackCategory)];
}
function inferRequestedCount(text = "", fallbackCount = 3) {
  const normalized = String(text || "").toLowerCase();
  const match = normalized.match(/\b(\d{1,2})\s*(question|questions|ques)\b/) || normalized.match(/\b(\d{1,2})\b(?:\s+\w+){0,4}\s+(question|questions|ques)\b/);
  if (!match) {
    return fallbackCount;
  }
  return Math.max(1, Math.min(6, Number(match[1] || fallbackCount)));
}
const SAMPLE_ANSWER_STOP_WORDS = new Set([
"about",
"after",
"also",
"and",
"because",
"been",
"from",
"have",
"into",
"more",
"that",
"their",
"there",
"these",
"this",
"those",
"with",
"your",
"you",
"what",
"why",
"where",
"when",
"which",
"would",
"could",
"should",
"will",
"round",
"interview",
"question"]
);
function extractPromptKeywords(prompt = "", limit = 3) {
  const tokens = String(prompt || "").toLowerCase().replace(/[^a-z0-9\s]/g, " ").split(/\s+/).map((token) => token.trim()).filter((token) => token.length >= 4 && !SAMPLE_ANSWER_STOP_WORDS.has(token));
  const unique = [];
  for (const token of tokens) {
    if (unique.includes(token)) {
      continue;
    }
    unique.push(token);
    if (unique.length >= limit) {
      break;
    }
  }
  return unique;
}
function buildHrPromptSpecificAnswer({ prompt = "", targetRole = "Generalist" }) {
  const normalized = String(prompt || "").toLowerCase();
  if (/\btell me about yourself|introduce yourself\b/.test(normalized)) {
    return `I am a ${targetRole} with strong execution on end-to-end ownership. In my recent project, I led planning to delivery, improved release predictability by 25%, and reduced post-release defects by 18%. That mix of ownership and measurable impact is what I will bring here.`;
  }
  if (/\bmanager\b|\bteam environment\b|\bwork environment\b/.test(normalized)) {
    return `I work best with a manager who sets clear outcomes and gives autonomy on execution. In my last team, I aligned weekly goals, documented risks early, and improved sprint completion rate from 78% to 92%. That environment helped me deliver faster while keeping quality stable.`;
  }
  if (/\bconflict\b|\bdisagree\b/.test(normalized)) {
    return `In one release, design and engineering priorities conflicted on scope and timeline. I facilitated a decision meeting, split must-have vs nice-to-have, and created a phased rollout plan. We shipped on time and reduced rework by 30% compared with the previous release.`;
  }
  if (/\bgoogle\b|\bamazon\b|\bmicrosoft\b|\bmeta\b|\bwhy do you want to work\b|\bvalue would you bring\b/.test(normalized)) {
    return `I want to join because the role requires high ownership, cross-functional execution, and measurable customer impact. In my current team, I delivered a reliability initiative that cut production incidents by 35% and improved customer satisfaction by 11 points. I can bring the same outcome-focused execution here.`;
  }
  const keywords = extractPromptKeywords(prompt, 2).join(" and ");
  return `For this ${targetRole} question${keywords ? ` on ${keywords}` : ""}, I would answer in STAR format with clear ownership and one quantified outcome. A good example is leading a process improvement that reduced turnaround time by 22% while improving quality metrics.`;
}
function buildTechnicalPromptSpecificAnswer({ prompt = "", targetRole = "Generalist" }) {
  const keywords = extractPromptKeywords(prompt, 3);
  const subject = keywords.length ? keywords.join(", ") : "system design and implementation";
  return `For "${String(prompt || "").trim()}", I would frame requirements first, then explain architecture choices for ${subject}. I would cover trade-offs, reliability strategy, and observability, then share measurable impact such as reducing latency by 28% and improving uptime to 99.95%. Finally, I would mention one alternative design and why I rejected it.`;
}
function buildBehavioralPromptSpecificAnswer({ prompt = "", targetRole = "Generalist" }) {
  const keywords = extractPromptKeywords(prompt, 2).join(" and ");
  return `I would answer this using STAR with strong ownership as a ${targetRole}${keywords ? ` while handling ${keywords}` : ""}. I would describe the challenge, the key decision I made, and how I aligned stakeholders. I would close with a measurable result such as a 20% delivery speed improvement and stronger team trust.`;
}
function buildCodingPromptSpecificAnswer(prompt = "") {
  const keywords = extractPromptKeywords(prompt, 2).join(" and ");
  return `I would start by clarifying constraints and edge cases${keywords ? ` around ${keywords}` : ""}, then present a brute-force baseline and an optimized approach. I would write clean code, dry-run test cases, and explain time-space complexity with trade-offs. I would finish with how I validated correctness and production readiness.`;
}
function buildSampleAnswerFallback({ category = "HR", prompt = "", targetRole = "Generalist" }) {
  const normalizedPrompt = String(prompt || "").trim();
  if (category === "Coding") {
    return buildCodingPromptSpecificAnswer(normalizedPrompt);
  }
  if (category === "Technical") {
    return buildTechnicalPromptSpecificAnswer({ prompt: normalizedPrompt, targetRole });
  }
  if (category === "Behavioral") {
    return buildBehavioralPromptSpecificAnswer({ prompt: normalizedPrompt, targetRole });
  }
  return buildHrPromptSpecificAnswer({ prompt: normalizedPrompt, targetRole });
}
async function generateSampleAnswerForQuestion({
  category = "HR",
  targetRole = "Generalist",
  questionPrompt = ""
}) {
  const promptText = String(questionPrompt || "").trim();
  if (!promptText) {
    return buildSampleAnswerFallback({ category, prompt: promptText, targetRole });
  }
  const generationPrompt = `
Generate one concise and interview-ready sample answer for this question.
Rules:
- 4 to 6 lines max
- practical and realistic
- use STAR style implicitly
- include ownership and one measurable impact
- no markdown

Category: ${category}
Target role: ${targetRole}
Question: ${promptText}
  `.trim();
  const generated = (await generateOpenAiText({
    systemInstruction: "You are an expert interview coach. Generate direct, high-quality sample answers.",
    prompt: generationPrompt,
    temperature: 0.35,
    maxOutputTokens: 220
  })) || (await generateGeminiText({
    systemInstruction: "You are an expert interview coach. Generate direct, high-quality sample answers.",
    prompt: generationPrompt,
    temperature: 0.3,
    maxOutputTokens: 220
  }));
  const cleaned = String(generated || "").replace(/\s+/g, " ").trim();
  if (cleaned) {
    return cleaned;
  }
  return buildSampleAnswerFallback({ category, prompt: promptText, targetRole });
}
async function buildQuestionAnswerPackReply({ message, session, mode = "judge" }) {
  if (!detectQuestionRequestIntent(message)) {
    return null;
  }
  const requestedCategories = inferRequestedCategories(message, session?.category || "HR");
  const asksAnyCategory = /\b(any|koi bhi|random|mixed|all)\b/.test(String(message || "").toLowerCase());
  const categoryPool = asksAnyCategory || requestedCategories.length > 1 ? requestedCategories : [requestedCategories[0]];
  const primaryCategory = categoryPool[0] || "HR";
  const count = inferRequestedCount(message, 3);
  const targetRole = String(session?.targetRole || "Generalist").trim() || "Generalist";
  const pool = await Question.aggregate([
  {
    $match: {
      category: { $in: categoryPool },
      source: "predefined"
    }
  },
  { $sample: { size: count } }]
  );
  const fallbackPool = pool.length >= count ? [] : await Question.aggregate([
  { $match: { category: { $in: categoryPool } } },
  { $sample: { size: Math.max(1, count - pool.length) } }]
  );
  const selected = [...pool, ...fallbackPool].slice(0, count);
  if (!selected.length) {
    return `${mode === "live_interviewer" ? "Interviewer" : "Judge"}: I could not find question bank entries right now. Please retry with category HR, Technical, Behavioral, or Coding.`;
  }
  const answers = await Promise.all(
    selected.map(
      (item) => generateSampleAnswerForQuestion({
        category: item?.category || primaryCategory,
        targetRole,
        questionPrompt: item.prompt
      })
    )
  );
  const lines = selected.map((item, index) => {
    const qNo = index + 1;
    const questionText = String(item.prompt || "").replace(/\s+/g, " ").trim();
    const answerText = String(answers[index] || "").replace(/\s+/g, " ").trim();
    return `Q${qNo}: ${questionText}
A${qNo}: ${answerText}`;
  });
  const rolePrefix = mode === "live_interviewer" ? "Interviewer" : "Judge";
  const categoryLabel = categoryPool.length > 1 ? `${categoryPool.join("/")}` : `${primaryCategory}`;
  return `${rolePrefix}: Here are ${selected.length} ${categoryLabel} interview question-answer pairs for ${targetRole} practice.
${lines.join(
    "\n"
  )}`;
}
function buildQuestionExplanationReply({ question, category = "HR", targetRole = "Generalist" }) {
  const prompt = String(question?.prompt || "this question").replace(/\s+/g, " ").trim();
  const normalized = prompt.toLowerCase();
  if (/conflict|disagree|stakeholder|team/.test(normalized)) {
    return `Interviewer: Sure. This checks conflict handling and collaboration. Use STAR: short context, your exact action, and a measurable result. Starter line: "I aligned both sides by clarifying goals and shipping a phased plan."`;
  }
  if (/design|architecture|scalable|system|microservices|observability/.test(normalized)) {
    return `Interviewer: This tests system thinking for ${targetRole}. Start with requirements, then architecture choice, trade-offs, and one reliability metric. Keep it practical and role-specific.`;
  }
  if (category === "Coding" || /algorithm|complexity|edge case|code/.test(normalized)) {
    return `Interviewer: This checks coding depth. First confirm constraints, then explain approach, complexity, and edge cases. End with how you validated correctness.`;
  }
  return `Interviewer: This question checks role fit, communication, and ownership for ${targetRole}. Answer in STAR format and close with one measurable impact.`;
}
function buildStarterHintReply({ question, category = "HR", targetRole = "Generalist" }) {
  const prompt = String(question?.prompt || "this question").replace(/\s+/g, " ").trim();
  if (category === "Coding") {
    return `Interviewer: Starter line: "Let me confirm constraints first, then I will share baseline and optimized solutions." Then cover complexity and one edge case for "${prompt}".`;
  }
  return `Interviewer: Starter line: "In my previous ${targetRole} role, I handled a similar situation where..." Then cover Situation, your Action, and measurable Result for "${prompt}".`;
}
function detectRequestedReplyLanguage(text = "") {
  const normalized = String(text || "").toLowerCase();
  if (/\b(hindi|hinglish)\b/.test(normalized)) {
    return "Hindi/Hinglish";
  }
  if (/\benglish\b/.test(normalized)) {
    return "English";
  }
  return "";
}
function buildDirectQueryFallback(query = "") {
  const cleaned = String(query || "").replace(/\s+/g, " ").trim();
  const normalized = cleaned.toLowerCase();
  if (/\brest\b/.test(normalized) && /\bgraphql\b/.test(normalized)) {
    return "REST usually uses multiple fixed endpoints and often over-fetches or under-fetches data, while GraphQL uses a single endpoint where clients request exactly the fields they need. For fast-changing frontend requirements, GraphQL can reduce payload and iteration time, but it needs stronger schema governance and query cost controls.";
  }
  if (/\bjwt\b/.test(normalized) || /\bauth\b/.test(normalized)) {
    return "JWT is a signed token carrying claims, commonly used for stateless authentication. Keep token expiry short, store refresh tokens securely, and always validate signature, issuer, and audience on the server to prevent misuse.";
  }
  if (/\bmicroservices\b/.test(normalized)) {
    return "Microservices split a system into independently deployable services, improving team autonomy and scalability. The trade-off is higher operational complexity, so strong observability, clear service contracts, and resilient communication patterns are essential.";
  }
  return `In simple terms, this depends on the use case and constraints. A strong interview answer is to define the concept clearly, compare alternatives with one trade-off, and finish with a real project example where your choice improved reliability, speed, or developer productivity.`;
}
async function buildDirectKnowledgeReply({ query, question, session }) {
  const cleanedQuery = String(query || "").replace(/\s+/g, " ").trim();
  if (!cleanedQuery) {
    return "";
  }
  const prompt = `
Candidate asked a direct question during a live interview. Answer the query directly and accurately.

Rules:
- 2 to 4 short sentences
- first sentence should directly answer the query
- include one practical example
- include one quick interview tip
- no markdown, no bullet list, no label prefix

Candidate query: ${cleanedQuery}
Current interview question: ${String(question?.prompt || "N/A")}
Interview category: ${String(session?.category || "HR")}
Target role: ${String(session?.targetRole || "Generalist")}
  `.trim();
  const generated = (await generateOpenAiText({
    systemInstruction: "You are an expert technical interviewer and coach. Answer clearly and accurately.",
    prompt,
    temperature: 0.28,
    maxOutputTokens: 220
  })) || (await generateGeminiText({
    systemInstruction: "You are an expert technical interviewer and coach. Answer clearly and accurately.",
    prompt,
    temperature: 0.25,
    maxOutputTokens: 220
  }));
  const cleaned = String(generated || "").replace(/\s+/g, " ").trim();
  if (cleaned) {
    return cleaned;
  }
  return buildDirectQueryFallback(cleanedQuery);
}
async function buildLiveInterviewerCommandReply({ message, session, question }) {
  const raw = sanitizeCandidateMessage(message);
  const normalized = raw.toLowerCase();
  const prompt = String(question?.prompt || "this question").replace(/\s+/g, " ").trim();
  const category = session?.category || "HR";
  const targetRole = session?.targetRole || "Generalist";
  const currentAnswer = question?.answer || null;
  const language = detectRequestedReplyLanguage(raw);
  if (!raw) {
    return null;
  }
  if (/^(hi|hello|hey|hii|good\s(morning|afternoon|evening))\b/.test(normalized)) {
    return `Interviewer: Hi, welcome. Main ready hoon. Aap bolo: repeat question, explain question, give hint, sample answer, ya HR/Technical/Coding/Behavioral questions with answers.`;
  }
  const asksRepeatQuestion = /\b(repeat|again|once more|one more time|say (it )?again|dobara|fir se)\b/.test(normalized) && /\b(question|prompt|ask)\b/.test(normalized) || /^(repeat|again|dobara)\b/.test(normalized);
  if (asksRepeatQuestion) {
    return `Interviewer: Sure, here is the question again: "${prompt}"`;
  }
  const asksExplanation = /\b(explain|clarify|meaning|break down|matlab|samjha|samjhao)\b/.test(normalized) && /\b(question|prompt|this|it)\b/.test(normalized);
  if (asksExplanation) {
    return buildQuestionExplanationReply({ question, category, targetRole });
  }
  const asksHint = /\b(hint|starter|start line|how to start|help me start|tip)\b/.test(normalized);
  if (asksHint) {
    return buildStarterHintReply({ question, category, targetRole });
  }
  const asksSampleAnswer = /\b(sample answer|example answer|model answer|ideal answer|best answer|answer this|give answer|tell answer)\b/.test(
    normalized
  ) || /\bwhat should i answer\b/.test(normalized);
  if (asksSampleAnswer) {
    const sampleAnswer = await generateSampleAnswerForQuestion({
      category,
      targetRole,
      questionPrompt: prompt
    });
    return `Interviewer: Sure. A strong sample answer for this question is: ${sampleAnswer}`;
  }
  if (/\b(score|rating|mark|how am i doing)\b/.test(normalized)) {
    if (!currentAnswer?.aiScores?.overall) {
      return `Interviewer: I can score accurately after you submit one full answer. For now, focus on STAR plus one quantified outcome.`;
    }
    const weakMetric = findWeakMetric(currentAnswer.aiScores || {});
    return `Interviewer: Your current score is ${currentAnswer.aiScores.overall}/100. Improve ${weakMetric ? `${weakMetric[0]} (${weakMetric[1]})` : "structure and quantified impact"} in your next response.`;
  }
  if (language && /\b(answer|reply|speak|question|language|lang)\b/.test(normalized)) {
    return `Interviewer: Done. I will keep replies in ${language}. Ask me to repeat, explain, give hint, or sample answer anytime.`;
  }
  if (isDirectUserQuestion(raw) && !detectQuestionRequestIntent(raw) && !looksLikeCandidateAnswerNarrative(raw)) {
    const directAnswer = await buildDirectKnowledgeReply({
      query: raw,
      question,
      session
    });
    const cleanedDirect = String(directAnswer || "").replace(/^(interviewer|judge|assistant)\s*:\s*/i, "").trim();
    if (cleanedDirect) {
      return `Interviewer: ${cleanedDirect}`;
    }
  }
  return null;
}
function buildFriendlyStuckReply({ question, category, targetRole }) {
  const prompt = String(question?.prompt || "this question");
  const simpleFollowUp = generateFollowUpQuestion({
    prompt,
    answerText: `${targetRole || "candidate"} example`,
    category: category || "HR",
    targetRole: targetRole || "Generalist"
  }).replace(/^Follow-up:\s*/i, "");
  return `Judge: Koi issue nahi, yeh normal hai. Chalo easy steps me karte hain for "${prompt}".
Step 1: Situation bolo - context kya tha.
Step 2: Action bolo - tumne personally kya kiya.
Step 3: Result bolo - measurable impact kya aaya (%, time saved, quality).
Start line use karo: "In my previous role, I handled a similar case where...". Try 3-4 lines; then I will refine. ${simpleFollowUp}`;
}
function buildJudgeReply({ message, session, question }) {
  const raw = sanitizeCandidateMessage(message);
  const lower = raw.toLowerCase();
  const currentAnswer = question?.answer || null;
  const answerScores = currentAnswer?.aiScores || {};
  const weakMetric = findWeakMetric(answerScores);
  const baseline = `Judge: Keep this concise and evidence-based. Use STAR and quantify results.`;
  if (!raw) {
    return `${baseline} Start with your strongest example for: "${question?.prompt || "current question"}".`;
  }
  if (/hello|hi|hey|good\s(morning|afternoon|evening)/i.test(lower)) {
    return `Judge: We begin now. Answer directly, avoid filler, and support each claim with measurable impact.`;
  }
  if (isStuckMessage(raw)) {
    return buildFriendlyStuckReply({
      question,
      category: session?.category,
      targetRole: session?.targetRole
    });
  }
  if (/score|mark|rating|how am i/i.test(lower)) {
    if (!currentAnswer) {
      return `Judge: I cannot score without a submitted answer. Provide your response first, then ask for rating.`;
    }
    return `Judge: Your current score is ${answerScores.overall || 0}/100. Weakest area is ${weakMetric ? `${weakMetric[0]} (${weakMetric[1]})` : "not enough data"}. Improve that next.`;
  }
  if (/improve|better|tip|hint|feedback|where/i.test(lower)) {
    if (currentAnswer?.improvements?.length) {
      return `Judge: Priority improvement: ${currentAnswer.improvements[0]} Then give one quantified result.`;
    }
    if (session?.summary?.improvements?.length) {
      return `Judge: Priority improvement: ${session.summary.improvements[0]} Keep your next answer under 90 seconds.`;
    }
    return `Judge: Improve by structuring Situation, Task, Action, and Result, with one concrete metric in the Result.`;
  }
  if (/follow|next question|next/i.test(lower)) {
    return `Judge: ${generateFollowUpQuestion({
      prompt: question?.prompt || "",
      answerText: currentAnswer?.transcript || currentAnswer?.rawText || raw,
      category: session?.category,
      targetRole: session?.targetRole
    })}`;
  }
  if (/job description|jd|fit/i.test(lower)) {
    const score = Number(session?.summary?.jobFitScore || 0);
    if (score > 0) {
      return `Judge: Current job fit score is ${score}/100. Mirror JD keywords and tie examples to required outcomes.`;
    }
    return `Judge: Add the job description in setup, then answer with JD keywords and role-relevant impact.`;
  }
  const words = raw.split(/\s+/).filter(Boolean);
  const star = detectStarHints(raw);
  const followUp = generateFollowUpQuestion({
    prompt: question?.prompt || "",
    answerText: raw,
    category: session?.category,
    targetRole: session?.targetRole
  });
  if (words.length < 12) {
    return `Judge: Your answer is too short. Add context, your exact action, and a measurable result. ${followUp}`;
  }
  if (!star.hasAction) {
    return `Judge: Clarify what you personally did; ownership is not clear. ${followUp}`;
  }
  if (!star.hasResult) {
    return `Judge: Add one quantified outcome (percentage, time saved, revenue, or quality improvement). ${followUp}`;
  }
  return `Judge: Good direction. Make it tighter with STAR flow and concrete business impact. ${followUp}`;
}
function buildLiveInterviewerFallbackReply({ message, session, question }) {
  const raw = sanitizeCandidateMessage(message);
  const prompt = String(question?.prompt || "this question");
  const followUp = generateFollowUpQuestion({
    prompt,
    answerText: raw || `${session?.targetRole || "candidate"} example`,
    category: session?.category,
    targetRole: session?.targetRole
  }).replace(/^Follow-up:\s*/i, "");
  if (!raw) {
    return `Interviewer: No rush, take a moment. Start with one short real example for "${prompt}", then we will build it together.`;
  }
  if (isDirectUserQuestion(raw)) {
    return `Interviewer: Good question. I can repeat the prompt, explain it, give a starter hint, or provide a sample answer. Tell me which one you want for "${prompt}".`;
  }
  if (isStuckMessage(raw)) {
    return `Interviewer: Totally fine, this happens in real interviews too. Start with: "In my previous role, I handled a similar situation where...", then tell me your action and result. ${followUp}`;
  }
  const words = raw.split(/\s+/).filter(Boolean);
  if (words.length < 8) {
    return `Interviewer: Good start. Add what exactly you did and one measurable result, then answer this: ${followUp}`;
  }
  return `Interviewer: Nice direction. Can you make it more specific with impact? ${followUp}`;
}
async function buildJudgeReplyWithAi({ message, session, question, history = [], mode = "judge" }) {
  const normalizedMode = normalizeJudgeMode(mode);
  if (normalizedMode === "live_interviewer") {
    const commandReply = await buildLiveInterviewerCommandReply({
      message,
      session,
      question
    });
    if (commandReply) {
      return commandReply;
    }
  }
  const questionAnswerPack = await buildQuestionAnswerPackReply({
    message,
    session,
    mode: normalizedMode
  });
  if (questionAnswerPack) {
    return questionAnswerPack;
  }
  const fallback = normalizedMode === "live_interviewer" ? buildLiveInterviewerFallbackReply({ message, session, question }) : buildJudgeReply({ message, session, question });
  const currentAnswer = question?.answer || null;
  const answerSnapshot = currentAnswer ? {
    score: currentAnswer?.aiScores?.overall || 0,
    transcript: String(currentAnswer?.transcript || currentAnswer?.rawText || "").slice(0, 600),
    improvements: Array.isArray(currentAnswer?.improvements) ? currentAnswer.improvements.slice(0, 2) : []
  } : null;
  const historyBlock = history.length ? history.map((item) => {
    if (item.role === "user") {
      return `Candidate: ${item.text}`;
    }
    return `${normalizedMode === "live_interviewer" ? "Interviewer" : "Judge"}: ${item.text}`;
  }).join("\n") : "No previous turns.";
  const baseContext = `
Session category: ${session?.category || "HR"}
Target role: ${session?.targetRole || "Generalist"}
Company simulation: ${session?.companySimulation || "Startup"}
Current question: ${question?.prompt || "N/A"}
Current answer snapshot: ${answerSnapshot ? JSON.stringify(answerSnapshot) : "No scored answer yet."}
Recent conversation:
${historyBlock}

Latest candidate message: ${String(message || "").trim()}
  `.trim();
  const prompt = normalizedMode === "live_interviewer" ? `
You are a realistic and friendly human interviewer in a live mock interview.
Respond like natural spoken conversation in 1-3 short sentences.
Always:
- keep it practical and role-specific.
- if candidate asks a direct question or instruction, answer it directly and clearly first.
- ask one follow-up question only when candidate is answering interview content, not when they ask commands.
- support voice commands naturally: repeat question, explain question, give hint, provide sample answer, or score request.
- if candidate is stuck/not sure, reassure briefly and give one starter line.
- do not give a harsh score unless candidate explicitly asks for score.
- match candidate language style (English, Hindi, or mixed).
- vary phrasing naturally; avoid repetitive template lines.
- no markdown, no bullet list, no label prefix.

${baseContext}
      `.trim() : `
You are a strict but helpful interview judge for a live mock interview.
Respond in 2-4 short lines only.
Always:
- evaluate what candidate said
- give one concrete improvement
- ask one natural follow-up question when possible.
- keep it practical and role-specific.
- if candidate says they are stuck/not sure, switch to supportive mode: explain simply, give STAR mini-template, and one starter line.
- no markdown, no bullet list, no label prefix.

${baseContext}

If user asks score and answer exists, mention score hints.
Keep tone direct and practical.
      `.trim();
  const sharedInstruction = normalizedMode === "live_interviewer" ? "You are a natural interviewer. Sound human, concise, supportive, and conversational." : "You are an interviewer and live judge. Keep responses concise, specific, and conversation-like.";
  const aiReply = (await generateOpenAiText({
    systemInstruction: sharedInstruction,
    prompt,
    temperature: 0.42,
    maxOutputTokens: 240
  })) || (await generateGeminiText({
    systemInstruction: sharedInstruction,
    prompt,
    temperature: 0.38,
    maxOutputTokens: 220
  }));
  if (!aiReply) {
    return fallback;
  }
  const cleaned = aiReply.replace(/^(judge|interviewer|assistant)\s*:\s*/i, "").trim();
  if (!cleaned) {
    return fallback;
  }
  return `${normalizedMode === "live_interviewer" ? "Interviewer" : "Judge"}: ${cleaned}`;
}
function toSessionQuestion(question, index) {
  return {
    questionRef: question._id || null,
    prompt: question.prompt,
    tags: Array.isArray(question.tags) ? question.tags : [],
    order: index + 1
  };
}
async function fetchPredefinedQuestions({ category, targetRole, companySimulation, count }) {
  const primary = await Question.aggregate([
  {
    $match: {
      category,
      source: "predefined",
      roleFocus: { $in: ["General", targetRole] },
      companyContext: { $in: ["General", companySimulation] }
    }
  },
  { $sample: { size: count } }]
  );
  if (primary.length >= count) {
    return primary;
  }
  const fallback = await Question.aggregate([
  {
    $match: {
      category,
      source: "predefined"
    }
  },
  { $sample: { size: count - primary.length } }]
  );
  return [...primary, ...fallback];
}
router.post(
  "/",
  authRequired,
  asyncHandler(async (req, res) => {
    const userId = req.auth.sub;
    const category = String(req.body.category || "HR");
    const targetRole = String(req.body.targetRole || "Generalist").trim();
    const companySimulation = String(req.body.companySimulation || "Startup").trim();
    const source = String(req.body.source || "predefined").trim();
    const count = Math.max(3, Math.min(12, Number(req.body.count || 5)));
    const resumeText = String(req.body.resumeText || "").trim();
    const jobDescriptionText = String(req.body.jobDescriptionText || "").trim().slice(0, 12e3);
    const focusAreas = normalizeFocusAreas(req.body.focusAreas);
    if (!ALLOWED_CATEGORIES.includes(category)) {
      return res.status(400).json({ message: "Invalid category." });
    }
    if (!ALLOWED_SOURCES.includes(source)) {
      return res.status(400).json({ message: "Invalid question source." });
    }
    let questions = [];
    if (source === "predefined") {
      questions = await fetchPredefinedQuestions({
        category,
        targetRole,
        companySimulation,
        count
      });
      if (!questions.length) {
        return res.status(400).json({ message: "No predefined questions found for this setup." });
      }
    } else {
      const aiQuestions = await generateAiQuestionsWithGemini({
        category,
        targetRole,
        companySimulation,
        resumeText,
        jobDescriptionText,
        focusAreas,
        count
      });
      questions = aiQuestions.length ? aiQuestions : generateAiQuestions({
        category,
        targetRole,
        companySimulation,
        resumeText,
        jobDescriptionText,
        focusAreas,
        count
      });
    }
    const session = await InterviewSession.create({
      user: userId,
      category,
      targetRole,
      companySimulation,
      questionSource: source,
      focusAreas,
      jobDescriptionText,
      status: "in_progress",
      questions: questions.map((question, index) => toSessionQuestion(question, index))
    });
    return res.status(201).json({
      sessionId: session._id,
      status: session.status,
      category: session.category,
      questionSource: session.questionSource,
      focusAreas: session.focusAreas,
      questions: session.questions.map((q) => ({
        id: q._id,
        prompt: q.prompt,
        tags: q.tags,
        order: q.order
      }))
    });
  })
);
router.get(
  "/",
  authRequired,
  asyncHandler(async (req, res) => {
    const sessions = await InterviewSession.find({ user: req.auth.sub }).sort({ createdAt: -1 }).limit(40).lean();
    const normalized = sessions.map((session) => {
      const answeredCount = session.questions.filter((item) => item.answer && item.answer.answeredAt).length;
      return {
        id: session._id,
        category: session.category,
        targetRole: session.targetRole,
        companySimulation: session.companySimulation,
        status: session.status,
        questionSource: session.questionSource,
        focusAreas: session.focusAreas || [],
        questionsCount: session.questions.length,
        answeredCount,
        overallScore: session.overallScore,
        selection: buildSelectionResult(session.overallScore),
        emailNotification: buildEmailNotificationResult(session),
        jobFitScore: Number(session.summary?.jobFitScore || 0),
        certificateId: session.certificate?.id || "",
        startedAt: session.startedAt,
        endedAt: session.endedAt,
        createdAt: session.createdAt
      };
    });
    return res.json({ sessions: normalized });
  })
);
router.get(
  "/certificates/:certificateId",
  asyncHandler(async (req, res) => {
    const certificateId = String(req.params.certificateId || "").trim();
    if (!certificateId) {
      return res.status(400).json({ message: "certificateId is required." });
    }
    const session = await InterviewSession.findOne({ "certificate.id": certificateId }).select("category targetRole companySimulation overallScore endedAt summary certificate user").populate("user", "name").lean();
    if (!session) {
      return res.status(404).json({ message: "Certificate not found." });
    }
    return res.json({
      valid: true,
      certificate: {
        id: session.certificate?.id || certificateId,
        issuedAt: session.certificate?.issuedAt || session.endedAt || null,
        candidateName: session.user?.name || "Candidate",
        category: session.category,
        targetRole: session.targetRole,
        companySimulation: session.companySimulation,
        overallScore: session.overallScore || 0,
        jobFitScore: Number(session.summary?.jobFitScore || 0)
      }
    });
  })
);
router.get(
  "/:sessionId",
  authRequired,
  asyncHandler(async (req, res) => {
    const { sessionId } = req.params;
    if (!mongoose.Types.ObjectId.isValid(sessionId)) {
      return res.status(400).json({ message: "Invalid session id." });
    }
    const session = await InterviewSession.findOne({ _id: sessionId, user: req.auth.sub }).lean();
    if (!session) {
      return res.status(404).json({ message: "Session not found." });
    }
    return res.json({
      session: {
        id: session._id,
        category: session.category,
        targetRole: session.targetRole,
        companySimulation: session.companySimulation,
        status: session.status,
        questionSource: session.questionSource,
        focusAreas: session.focusAreas || [],
        jobDescriptionText: session.jobDescriptionText || "",
        overallScore: session.overallScore,
        selection: buildSelectionResult(session.overallScore),
        metrics: session.metrics,
        summary: session.summary,
        emailNotification: buildEmailNotificationResult(session),
        certificate: {
          id: session.certificate?.id || "",
          issuedAt: session.certificate?.issuedAt || null,
          verificationUrl: buildCertificateVerificationUrl(req, session.certificate?.id || "")
        },
        startedAt: session.startedAt,
        endedAt: session.endedAt
      },
      questions: session.questions.map((item) => ({
        id: item._id,
        prompt: item.prompt,
        tags: item.tags,
        order: item.order,
        answer: item.answer
      }))
    });
  })
);
router.post(
  "/:sessionId/answers/:questionId",
  authRequired,
  answerUploadMiddleware,
  asyncHandler(async (req, res) => {
    const { sessionId, questionId } = req.params;
    const traceId = crypto.randomUUID();
    if (!mongoose.Types.ObjectId.isValid(sessionId) || !mongoose.Types.ObjectId.isValid(questionId)) {
      return res.status(400).json({ message: "Invalid session or question id." });
    }
    const session = await InterviewSession.findOne({ _id: sessionId, user: req.auth.sub });
    if (!session) {
      return res.status(404).json({ message: "Session not found." });
    }
    if (session.status !== "in_progress") {
      return res.status(400).json({ message: "Session is already completed." });
    }
    const question = session.questions.id(questionId);
    if (!question) {
      return res.status(404).json({ message: "Question not found in this session." });
    }
    const requestedAnswerType = String(req.body.answerType || "text").trim().toLowerCase();
    const rawText = String(req.body.rawText || "").trim();
    const transcriptHint = String(req.body.transcript || "").trim();
    const bodyMediaReference = String(req.body.mediaReference || "").trim();
    const durationSec = Math.max(0, Number(req.body.durationSec || 0));
    const facialExpressionScore = Math.max(0, Math.min(100, Number(req.body.facialExpressionScore || 0)));
    const confidenceSelfRating = Math.max(0, Math.min(10, Number(req.body.confidenceSelfRating || 0)));
    const timelineMarkersInput = parseTimelineMarkersInput(req.body.timelineMarkers);
    const audioUpload = req.files?.audioFile?.[0] || null;
    const videoUpload = req.files?.videoFile?.[0] || null;
    const hasMediaUpload = Boolean(audioUpload || videoUpload);
    if (!["text", "voice", "video"].includes(requestedAnswerType)) {
      return res.status(400).json({ message: "answerType must be text, voice, or video." });
    }
    if (!hasMediaUpload && !rawText && !transcriptHint) {
      return res.status(400).json({ message: "Answer is empty. Provide text or upload recorded media." });
    }
    let answerType = requestedAnswerType;
    if (videoUpload) {
      answerType = "video";
    } else if (audioUpload && answerType === "text") {
      answerType = "voice";
    }
    const mediaReference = bodyMediaReference || (hasMediaUpload ? `upload://${sessionId}/${questionId}/${Date.now()}/${Math.random().toString(36).slice(2, 8)}` : "");
    const transcriptionFile = audioUpload || videoUpload || null;
    let transcript = transcriptHint;
    if (!transcript) {
      try {
        transcript = await transcribeMedia({
          transcriptHint,
          mediaReference,
          answerType,
          audioBuffer: transcriptionFile?.buffer || null,
          audioMimeType: transcriptionFile?.mimetype || "",
          audioFileName: transcriptionFile?.originalname || "",
          traceId
        });
      } catch (error) {
        logger.error("Answer transcription failed", {
          traceId,
          sessionId,
          questionId,
          answerType,
          statusCode: Number(error?.statusCode || 0),
          message: error?.message || "unknown"
        });
        throw createHttpError(error.message || "Transcription failed. Try uploading the recording again.", Number(error?.statusCode || 502));
      }
    }
    const effectiveAnswerText = String(transcript || rawText || "").trim();
    if (!effectiveAnswerText) {
      return res.status(422).json({
        message: "Could not detect speech from recording. Retry with clearer audio or type your answer."
      });
    }
    let evaluation;
    try {
      evaluation = await evaluateAnswer({
        category: session.category,
        prompt: question.prompt,
        tags: question.tags,
        answerType,
        transcript,
        rawText,
        durationSec,
        facialExpressionScore,
        confidenceSelfRating,
        traceId
      });
    } catch (error) {
      logger.error("Answer evaluation failed", {
        traceId,
        sessionId,
        questionId,
        answerType,
        message: error?.message || "unknown"
      });
      throw createHttpError("AI evaluation failed. Please retry once.", 502);
    }
    const timelineMarkers = timelineMarkersInput.length ? timelineMarkersInput : buildTimelineMarkers({
      durationSec,
      rawText,
      improvements: evaluation.improvements,
      relevanceNotes: evaluation.relevanceNotes
    });
    const fallbackFollowUp = generateFollowUpQuestion({
      prompt: question.prompt,
      answerText: evaluation.transcript || rawText,
      category: session.category,
      targetRole: session.targetRole
    });
    const followUpQuestion = (await generateFollowUpQuestionWithAi({
      prompt: question.prompt,
      answerText: evaluation.transcript || rawText,
      category: session.category,
      targetRole: session.targetRole
    })) || fallbackFollowUp;
    question.answer = {
      type: answerType,
      transcript: evaluation.transcript,
      rawText,
      mediaReference,
      durationSec,
      speakingSpeedWpm: evaluation.speakingSpeedWpm,
      facialExpressionScore,
      confidenceSelfRating,
      aiScores: evaluation.scores,
      feedbackTips: evaluation.feedbackTips,
      improvements: evaluation.improvements,
      relevanceNotes: evaluation.relevanceNotes,
      timelineMarkers,
      answeredAt: new Date()
    };
    await session.save();
    logger.info("Answer evaluated successfully", {
      traceId,
      sessionId,
      questionId,
      answerType,
      hasMediaUpload,
      transcriptChars: String(evaluation.transcript || "").length,
      overallScore: Number(evaluation?.scores?.overall || 0)
    });
    return res.json({
      questionId: question._id,
      answer: question.answer,
      followUpQuestion
    });
  })
);
router.post(
  "/:sessionId/answers/:questionId/follow-up",
  authRequired,
  asyncHandler(async (req, res) => {
    const { sessionId, questionId } = req.params;
    if (!mongoose.Types.ObjectId.isValid(sessionId) || !mongoose.Types.ObjectId.isValid(questionId)) {
      return res.status(400).json({ message: "Invalid session or question id." });
    }
    const session = await InterviewSession.findOne({ _id: sessionId, user: req.auth.sub });
    if (!session) {
      return res.status(404).json({ message: "Session not found." });
    }
    const question = session.questions.id(questionId);
    if (!question) {
      return res.status(404).json({ message: "Question not found in this session." });
    }
    const answerText = String(req.body.answerText || "").trim() || String(question.answer?.transcript || question.answer?.rawText || "").trim();
    const fallbackFollowUp = generateFollowUpQuestion({
      prompt: question.prompt,
      answerText,
      category: session.category,
      targetRole: session.targetRole
    });
    const followUpQuestion = (await generateFollowUpQuestionWithAi({
      prompt: question.prompt,
      answerText,
      category: session.category,
      targetRole: session.targetRole
    })) || fallbackFollowUp;
    return res.json({ followUpQuestion });
  })
);
router.post(
  "/:sessionId/judge-chat",
  authRequired,
  asyncHandler(async (req, res) => {
    const { sessionId } = req.params;
    if (!mongoose.Types.ObjectId.isValid(sessionId)) {
      return res.status(400).json({ message: "Invalid session id." });
    }
    const session = await InterviewSession.findOne({ _id: sessionId, user: req.auth.sub });
    if (!session) {
      return res.status(404).json({ message: "Session not found." });
    }
    const message = String(req.body.message || "").trim();
    const questionId = String(req.body.questionId || "").trim();
    const history = normalizeJudgeHistory(req.body.history);
    const mode = normalizeJudgeMode(req.body.mode);
    const question = questionId && mongoose.Types.ObjectId.isValid(questionId) ? session.questions.id(questionId) : null;
    const activeQuestion = question || session.questions.find((item) => !item.answer?.answeredAt) || session.questions[0];
    const reply = await buildJudgeReplyWithAi({
      message,
      session,
      question: activeQuestion,
      history,
      mode
    });
    return res.json({
      reply,
      role: mode === "live_interviewer" ? "interviewer" : "judge",
      canSpeak: true,
      timestamp: new Date().toISOString()
    });
  })
);
router.post(
  "/:sessionId/security-incident",
  authRequired,
  asyncHandler(async (req, res) => {
    const { sessionId } = req.params;
    if (!mongoose.Types.ObjectId.isValid(sessionId)) {
      return res.status(400).json({ message: "Invalid session id." });
    }
    const session = await InterviewSession.findOne({ _id: sessionId, user: req.auth.sub });
    if (!session) {
      return res.status(404).json({ message: "Session not found." });
    }
    const type = normalizeIntegrityEventType(req.body.type);
    const reason = normalizeIntegrityReason(req.body.reason);
    const meta = normalizeIntegrityReason(req.body.meta);
    const terminateSession = Boolean(req.body.terminateSession);
    if (!reason) {
      return res.status(400).json({ message: "Incident reason is required." });
    }
    const event = {
      type,
      reason,
      meta,
      createdAt: new Date()
    };
    session.integrityEvents = [...(session.integrityEvents || []).slice(-39), event];
    let terminated = false;
    if (terminateSession && session.status === "in_progress") {
      session.status = "completed";
      session.endedAt = new Date();
      session.summary = {
        ...(session.summary || {}),
        strengths: Array.isArray(session.summary?.strengths) ? session.summary.strengths : [],
        improvements: [
        ...(Array.isArray(session.summary?.improvements) ? session.summary.improvements : []),
        "Interview auto-closed due to policy violation during unstable network."].
        slice(-6),
        recommendation: "Session closed due to policy violation. Retry interview with stable network and keep tab focused."
      };
      terminated = true;
    }
    await session.save();
    const user = await User.findById(req.auth.sub).select("security");
    if (user) {
      const existingSecurity = user.security || {};
      user.security = {
        ...existingSecurity,
        violationCount: Math.max(0, Number(existingSecurity.violationCount || 0) + 1),
        lastViolationAt: new Date(),
        lastViolationReason: reason
      };
      user.markModified("security");
      await user.save();
    }
    return res.json({
      message: terminated ? "Security incident recorded and session closed." : "Security incident recorded.",
      incident: event,
      terminated,
      violationCount: Number(user?.security?.violationCount || 0)
    });
  })
);
router.post(
  "/:sessionId/complete",
  authRequired,
  asyncHandler(async (req, res) => {
    const { sessionId } = req.params;
    if (!mongoose.Types.ObjectId.isValid(sessionId)) {
      return res.status(400).json({ message: "Invalid session id." });
    }
    const session = await InterviewSession.findOne({ _id: sessionId, user: req.auth.sub });
    if (!session) {
      return res.status(404).json({ message: "Session not found." });
    }
    if (session.status === "completed") {
      const answered2 = session.questions.filter((item) => item.answer && item.answer.answeredAt);
      if (!session.summary?.jobFitScore && session.jobDescriptionText) {
        session.summary = {
          ...(session.summary || {}),
          jobFitScore: computeJobFitScore(session, answered2)
        };
      }
      if (!session.certificate?.id) {
        session.certificate = {
          id: createCertificateId(session._id, session.user),
          issuedAt: session.endedAt || new Date()
        };
      }
      const userForEmail = await User.findById(req.auth.sub).select("name email");
      const emailQueued = userForEmail ? markInterviewResultEmailQueued(session) : false;
      await session.save();
      if (emailQueued && userForEmail) {
        await scheduleInterviewResultEmail({
          session,
          user: userForEmail,
          req,
          trigger: "already_completed"
        });
        await syncLatestEmailNotificationState(session);
      }
      return res.json({
        message: "Session already completed.",
        session: {
          id: session._id,
          overallScore: session.overallScore,
          selection: buildSelectionResult(session.overallScore),
          metrics: session.metrics,
          summary: session.summary,
          emailNotification: buildEmailNotificationResult(session, userForEmail?.email || ""),
          status: session.status,
          endedAt: session.endedAt,
          certificate: {
            id: session.certificate?.id || "",
            issuedAt: session.certificate?.issuedAt || session.endedAt || null,
            verificationUrl: buildCertificateVerificationUrl(req, session.certificate?.id || "")
          }
        }
      });
    }
    const answered = session.questions.filter((item) => item.answer && item.answer.answeredAt);
    if (!answered.length) {
      return res.status(400).json({ message: "Answer at least one question before completing." });
    }
    const metrics = {
      confidence: average(answered.map((item) => item.answer.aiScores.confidence || 0)),
      communication: average(answered.map((item) => item.answer.aiScores.communication || item.answer.aiScores.clarity || 0)),
      clarity: average(answered.map((item) => item.answer.aiScores.clarity || 0)),
      grammar: average(answered.map((item) => item.answer.aiScores.grammar || 0)),
      technicalAccuracy: average(
        answered.map((item) => item.answer.aiScores.technicalAccuracy || item.answer.aiScores.relevance || 0)
      ),
      speakingSpeed: average(answered.map((item) => item.answer.aiScores.speakingSpeed || 0)),
      facialExpression: average(answered.map((item) => item.answer.aiScores.facialExpression || 0)),
      relevance: average(answered.map((item) => item.answer.aiScores.relevance || 0))
    };
    const overallScore = average(answered.map((item) => item.answer.aiScores.overall || 0));
    metrics.overall = overallScore;
    const strengths = [];
    const improvements = [];
    for (const [key, value] of Object.entries(metrics)) {
      if (key === "overall") {
        continue;
      }
      if (value >= 78) {
        strengths.push(`Strong ${key} (${value}).`);
      }
      if (value < 62) {
        improvements.push(`Work on ${key} with focused drills.`);
      }
    }
    if (!strengths.length) {
      strengths.push("Consistent baseline across all dimensions.");
    }
    if (!improvements.length) {
      improvements.push("Add tighter examples with measurable impact.");
    }
    const weakest = Object.entries(metrics).filter(([key]) => key !== "overall").sort((a, b) => a[1] - b[1])[0];
    const jobFitScore = computeJobFitScore(session, answered);
    if (jobFitScore > 0 && jobFitScore < 55) {
      improvements.push(`Job description fit is low (${jobFitScore}/100). Add examples with JD keywords and required outcomes.`);
    }
    const recommendationBase = weakest ? `Prioritize ${weakest[0]} in your next practice using STAR + quantified outcomes.` : "Continue with mixed category practice to maintain consistency.";
    const recommendation = jobFitScore > 0 ? `${recommendationBase} Current JD fit score is ${jobFitScore}/100.` : recommendationBase;
    session.status = "completed";
    session.metrics = metrics;
    session.overallScore = overallScore;
    session.summary = {
      strengths,
      improvements,
      recommendation,
      jobFitScore
    };
    session.endedAt = new Date();
    session.certificate = {
      id: createCertificateId(session._id, session.user),
      issuedAt: new Date()
    };
    await session.save();
    const user = await User.findById(req.auth.sub);
    let gamification = { pointsEarned: 0, badgesUnlocked: [], streak: 0 };
    if (user) {
      const completedSessions = await InterviewSession.countDocuments({
        user: req.auth.sub,
        status: "completed"
      });
      gamification = applyGamification({
        user,
        sessionScore: overallScore,
        completedSessions
      });
      await user.save();
      const emailQueued = markInterviewResultEmailQueued(session);
      if (emailQueued) {
        await session.save();
        await scheduleInterviewResultEmail({
          session,
          user,
          req,
          trigger: "session_completed"
        });
        await syncLatestEmailNotificationState(session);
      }
    } else {
      logger.warn("Session completion: user record missing for gamification/email", {
        sessionId: String(session._id || ""),
        userId: String(req.auth.sub || "")
      });
    }
    return res.json({
      session: {
        id: session._id,
        status: session.status,
        overallScore: session.overallScore,
        selection: buildSelectionResult(session.overallScore),
        metrics: session.metrics,
        summary: session.summary,
        emailNotification: buildEmailNotificationResult(session, user?.email || ""),
        endedAt: session.endedAt,
        certificate: {
          id: session.certificate?.id || "",
          issuedAt: session.certificate?.issuedAt || session.endedAt || null,
          verificationUrl: buildCertificateVerificationUrl(req, session.certificate?.id || "")
        }
      },
      gamification
    });
  })
);
module.exports = router;
