import { useEffect, useMemo, useRef, useState } from "react";
import { motion } from "framer-motion";
import {
  Award,
  Camera,
  CameraOff,
  CheckCircle2,
  Code2,
  FileText,
  MessageSquare,
  Mic,
  MicOff,
  Send,
  Sparkles,
  Upload,
  Volume2,
  Wand2,
  X } from
"lucide-react";
import { useAuth } from "../context/AuthContext";
import { questionApi, sessionApi } from "../lib/api";
import { AvatarInterviewer } from "../components/AvatarInterviewer";
import { LoadingScreen } from "../components/LoadingScreen";
import { useSpeechSynthesis } from "../hooks/useSpeechSynthesis";
import { useVoiceActivity } from "../hooks/useVoiceActivity";
import { useLiveTranscription } from "../hooks/useLiveTranscription";
import { useRecorder } from "../hooks/useRecorder";
import {
  buildSpeechCoachingTips,
  detectStarCoverage,
  evaluateCodingAnswer,
  getStarMissingParts } from
"../lib/interviewCoach";
import { buildMetricImprovementFocus, saveInterviewCertificatePdf, saveInterviewReportPdf } from "../lib/pdfDocuments";
import { saveCompletedPracticeSession } from "../lib/practiceStorage";
const DEFAULT_SETUP = {
  category: "HR",
  targetRole: "Frontend Engineer",
  companySimulation: "Startup",
  source: "predefined",
  count: 5,
  resumeText: "",
  jobDescriptionText: ""
};
const EMPTY_DRAFT = {
  rawText: "",
  transcript: "",
  codeSolution: "",
  confidenceSelfRating: 7,
  facialExpressionScore: 0,
  durationSec: 0,
  mediaReference: ""
};
const AI_SPEAKING_VISUAL_SRC = "/whatsapp-speaking.mp4";
const API_BASE = import.meta.env.VITE_API_BASE || "/api";
const MAX_RESUME_FILE_BYTES = 4 * 1024 * 1024;
const MAX_RESUME_TEXT_LENGTH = 12e3;
const LIVE_RESPONSE_MIN_WORDS = 3;
const LIVE_SILENCE_COMMIT_MS = 450;
const LIVE_BARGE_IN_COOLDOWN_MS = 1200;
const LIVE_WEAK_ANSWER_RETRY_LIMIT = 2;
const LIVE_INTERVIEW_LANGUAGES = [
{ value: "en-US", label: "English (US)" },
{ value: "en-IN", label: "English (India)" },
{ value: "hi-IN", label: "Hindi + Hinglish" }];

const RESUME_STOP_WORDS = new Set([
"about",
"after",
"along",
"also",
"been",
"candidate",
"company",
"currently",
"data",
"deliver",
"development",
"email",
"engineering",
"experience",
"focus",
"from",
"have",
"highly",
"http",
"improved",
"into",
"javascript",
"level",
"linkedin",
"looking",
"managed",
"more",
"name",
"over",
"phone",
"platform",
"product",
"profile",
"project",
"projects",
"resume",
"responsible",
"results",
"role",
"skills",
"software",
"stack",
"strong",
"team",
"teams",
"that",
"their",
"through",
"using",
"with",
"year",
"years"]
);
function cloneDraft() {
  return { ...EMPTY_DRAFT };
}
function sanitizeResumeText(text) {
  return String(text || "").replace(/\0/g, " ").replace(/\s+/g, " ").trim();
}
function extractReadableText(blobText) {
  const matches = String(blobText || "").match(/[A-Za-z][A-Za-z0-9+#./-]{1,}/g) || [];
  return matches.join(" ");
}
async function parseResumeFile(file) {
  const extension = (file.name.split(".").pop() || "").toLowerCase();
  const rawText = await file.text();
  const isPlainTextFile = file.type.startsWith("text/") || ["txt", "md", "csv"].includes(extension);
  if (isPlainTextFile) {
    return sanitizeResumeText(rawText);
  }
  const recovered = sanitizeResumeText(extractReadableText(rawText));
  if (recovered.split(/\s+/).length < 80) {
    throw new Error("Unable to read resume text. Upload a TXT file or paste resume text manually.");
  }
  return recovered;
}
function detectResumeSkills(resumeText = "", limit = 10) {
  const words = String(resumeText || "").toLowerCase().replace(/[^a-z0-9+#./\s-]/g, " ").split(/\s+/).map((word) => word.trim()).filter((word) => word.length >= 3 && !RESUME_STOP_WORDS.has(word));
  const frequency = {};
  for (const word of words) {
    frequency[word] = (frequency[word] || 0) + 1;
  }
  return Object.entries(frequency).sort((a, b) => b[1] - a[1]).slice(0, limit).map(([word]) => word);
}
function formatBytes(bytes) {
  if (!bytes) {
    return "0 B";
  }
  if (bytes < 1024) {
    return `${bytes} B`;
  }
  if (bytes < 1024 * 1024) {
    return `${Math.round(bytes / 1024)} KB`;
  }
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
function mimeTypeToExtension(mimeType = "", fallback = "webm") {
  const normalized = String(mimeType || "").toLowerCase();
  if (normalized.includes("wav")) return "wav";
  if (normalized.includes("mpeg") || normalized.includes("mp3")) return "mp3";
  if (normalized.includes("mp4")) return "mp4";
  if (normalized.includes("ogg")) return "ogg";
  if (normalized.includes("quicktime")) return "mov";
  if (normalized.includes("avi")) return "avi";
  if (normalized.includes("webm")) return "webm";
  return fallback;
}
function stripSpeakerPrefix(text = "") {
  return String(text || "").replace(/^(interviewer|judge|assistant)\s*:\s*/i, "").trim();
}
function looksLikeVoiceCommand(text = "") {
  const normalized = String(text || "").toLowerCase().replace(/\s+/g, " ").trim();
  if (!normalized) {
    return false;
  }
  return /\b(repeat|again|hint|help|explain|clarify|sample answer|example answer|give answer|tell answer|score|rating|next question|question again|hindi|english|dobara|fir se|samjha|samjhao)\b/.test(
    normalized
  ) || /^(repeat|again|hint|help|explain|clarify|score|rating|hindi|english|dobara|samjha|samjhao)\b/.test(normalized);
}
function normalizeVoiceIntentText(text = "") {
  return String(text || "").toLowerCase().replace(/[^a-z0-9\s]/g, " ").replace(/\s+/g, " ").trim();
}
function isInterviewStartAffirmative(text = "") {
  const normalized = normalizeVoiceIntentText(text);
  if (!normalized) {
    return false;
  }
  return /\b(yes|yeah|yep|yup|sure|ok|okay|ready|start|begin|go ahead|lets start|let us start|haan|haanji|hanji|ha|ji haan|shuru|shuru karo|start karo|karo)\b/.test(
    normalized
  );
}
function isInterviewStartNegative(text = "") {
  const normalized = normalizeVoiceIntentText(text);
  if (!normalized) {
    return false;
  }
  return /\b(no|nope|nah|not now|later|wait|stop|ruko|nahi|mat karo)\b/.test(normalized);
}
function isNextQuestionIntent(text = "") {
  const normalized = normalizeVoiceIntentText(text);
  if (!normalized) {
    return false;
  }
  return /\b(next|next question|move next|skip|pass|change question|agla sawal|next sawal|skip karo|aage badho)\b/.test(
    normalized
  );
}
function isNoAnswerSignal(text = "") {
  const normalized = normalizeVoiceIntentText(text);
  if (!normalized) {
    return false;
  }
  return /\b(i dont know|dont know|do not know|not sure|no idea|cant answer|cannot answer|unable to answer|nahi pata|pata nahi|answer nahi)\b/.test(
    normalized
  );
}
function isStrongLiveAnswer({ text = "", category = "HR" }) {
  const raw = String(text || "").replace(/\s+/g, " ").trim();
  if (!raw) {
    return false;
  }
  const words = raw.split(/\s+/).filter(Boolean).length;
  const lowerCategory = String(category || "").toLowerCase();
  if (lowerCategory === "coding") {
    const codingSignal = /\b(approach|algorithm|time complexity|space complexity|edge case|test case|optimi[sz]e|trade[- ]?off)\b/i.test(
      raw
    ) || /o\([^)]+\)/i.test(raw);
    return words >= 12 && codingSignal;
  }
  const coverage = detectStarCoverage(raw);
  const measurableImpact = /\b\d+(\.\d+)?\s*(%|percent|x|times|hrs?|hours?|days?|weeks?|months?|years?)\b/i.test(raw) || /\b(increased|reduced|improved|saved|grew|boosted)\b/i.test(raw);
  return words >= 16 && coverage.parts.action && (coverage.parts.result || measurableImpact);
}
function sourceLabel(source = "") {
  const normalized = String(source || "").toLowerCase();
  if (normalized === "ai") return "AI Generated";
  if (normalized === "resume") return "Resume-Based";
  return "Predefined Database";
}
function formatEmailNotificationStatus(status = "") {
  const normalized = String(status || "").trim().toLowerCase();
  if (normalized === "sent") return "Sent";
  if (normalized === "queued") return "Queued";
  if (normalized === "failed") return "Failed";
  if (normalized === "skipped") return "Skipped";
  if (normalized === "disabled") return "Disabled";
  return "Pending";
}
function Badge({ children }) {
  return <span className="rounded-full border border-white/30 bg-white/50 px-2 py-1 text-xs font-semibold text-slate-700 dark:border-white/10 dark:bg-slate-800/45 dark:text-slate-200">{children}</span>;
}
function getProgress(session) {
  if (!session) {
    return { answered: 0, total: 0, percent: 0 };
  }
  const answered = session.questions.filter((item) => item.answer?.answeredAt).length;
  const total = session.questions.length;
  const percent = total ? Math.round(answered / total * 100) : 0;
  return { answered, total, percent };
}
function deriveWeakFocusAreas(metrics = {}) {
  return Object.entries(metrics || {}).filter(([key]) => key !== "overall").sort((a, b) => Number(a[1] || 0) - Number(b[1] || 0)).slice(0, 2).map(([key]) => key);
}
function getTopScoreQuestion(session) {
  if (!session?.questions?.length) {
    return null;
  }
  return session.questions.filter((question) => question.answer?.aiScores?.overall).sort((a, b) => Number(b.answer?.aiScores?.overall || 0) - Number(a.answer?.aiScores?.overall || 0))[0] || null;
}
function createJudgeMessage(role, text) {
  return {
    id: `${role}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    role,
    text: String(text || "").trim(),
    createdAt: Date.now()
  };
}
function buildUnableToAnswerSuggestion(questionPrompt = "", category = "HR") {
  const normalizedPrompt = String(questionPrompt || "").replace(/\s+/g, " ").trim();
  const promptPrefix = normalizedPrompt ? `For "${normalizedPrompt}", ` : "";
  if (String(category || "").toLowerCase() === "coding") {
    return `${promptPrefix}aise bolna chahiye: "Hindi ya English dono allowed hain. Let me confirm the constraints first, share a baseline solution, then optimize it and explain time-space complexity with edge cases."`;
  }
  return `${promptPrefix}aise bolna chahiye: "Hindi ya English dono allowed hain. Great question. Situation was [context], my task was [ownership], I took [actions], and result was [measurable impact]."`;
}
export function InterviewPage() {
  const { token, user } = useAuth();
  const [meta, setMeta] = useState({ categories: [], companies: [] });
  const [setup, setSetup] = useState(DEFAULT_SETUP);
  const [sessionList, setSessionList] = useState([]);
  const [activeSession, setActiveSession] = useState(null);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [drafts, setDrafts] = useState({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [completing, setCompleting] = useState(false);
  const [emailRetrying, setEmailRetrying] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [autoSpeak, setAutoSpeak] = useState(true);
  const [resumeDragActive, setResumeDragActive] = useState(false);
  const [resumeProcessing, setResumeProcessing] = useState(false);
  const [resumeFileMeta, setResumeFileMeta] = useState({ name: "", size: 0 });
  const [webcamOn, setWebcamOn] = useState(false);
  const [webcamLoading, setWebcamLoading] = useState(false);
  const [webcamError, setWebcamError] = useState("");
  const [speakingVisualActive, setSpeakingVisualActive] = useState(false);
  const [followUps, setFollowUps] = useState({});
  const [followUpLoading, setFollowUpLoading] = useState(false);
  const [codingFeedbackByQuestion, setCodingFeedbackByQuestion] = useState({});
  const [uploadedVideoByQuestion, setUploadedVideoByQuestion] = useState({});
  const [recordedMediaByQuestion, setRecordedMediaByQuestion] = useState({});
  const [recordingTargetQuestionId, setRecordingTargetQuestionId] = useState("");
  const [judgeThreads, setJudgeThreads] = useState({});
  const [judgeInput, setJudgeInput] = useState("");
  const [judgeLoading, setJudgeLoading] = useState(false);
  const [liveConversationOn, setLiveConversationOn] = useState(false);
  const [fullDuplexOn, setFullDuplexOn] = useState(true);
  const [liveLanguage, setLiveLanguage] = useState("en-US");
  const [liveConversationBusy, setLiveConversationBusy] = useState(false);
  const [liveConversationStatus, setLiveConversationStatus] = useState("Live interviewer is off.");
  const [liveInterviewPhase, setLiveInterviewPhase] = useState("idle");
  const [networkOffline, setNetworkOffline] = useState(
    typeof navigator !== "undefined" ? !navigator.onLine : false
  );
  const [securityLocked, setSecurityLocked] = useState(false);
  const [securityLockReason, setSecurityLockReason] = useState("");
  const [securityViolationCount, setSecurityViolationCount] = useState(0);
  const resumeFileInputRef = useRef(null);
  const webcamVideoRef = useRef(null);
  const webcamStreamRef = useRef(null);
  const speakingVisualTimeoutRef = useRef(null);
  const liveSilenceCommitTimerRef = useRef(null);
  const processedTranscriptRef = useRef("");
  const bargeInCooldownRef = useRef(0);
  const assistantSpeechGuardUntilRef = useRef(0);
  const liveUserStartedRef = useRef(false);
  const exitCompletionRef = useRef(false);
  const answerVideoRef = useRef(null);
  const uploadedVideoByQuestionRef = useRef({});
  const securityLockRef = useRef(false);
  const liveWeakAnswerAttemptsRef = useRef({});
  const { speaking, speak, cancel, enabled: speechEnabled, lastError: speechError } = useSpeechSynthesis();
  const { isSpeaking: userSpeaking, error: voiceActivityError } = useVoiceActivity(
    Boolean(activeSession && liveConversationOn && fullDuplexOn)
  );
  const liveSpeech = useLiveTranscription();
  const answerRecorder = useRecorder("video");
  const currentQuestion = activeSession?.questions?.[currentIndex] || null;
  const currentDraft = currentQuestion ? drafts[currentQuestion.id] || cloneDraft() : cloneDraft();
  const progress = useMemo(() => getProgress(activeSession), [activeSession]);
  const canCompleteSession = Boolean(activeSession && activeSession.status === "in_progress" && progress.answered >= 1);
  const resumeSkills = useMemo(() => detectResumeSkills(setup.resumeText), [setup.resumeText]);
  const starCoverage = useMemo(() => detectStarCoverage(currentDraft.rawText), [currentDraft.rawText]);
  const missingStarParts = useMemo(() => getStarMissingParts(starCoverage), [starCoverage]);
  const speechCoachingTips = useMemo(
    () => buildSpeechCoachingTips({
      fillerCount: liveSpeech.fillerCount,
      pauseCount: liveSpeech.pauseCount,
      wordsPerMinute: liveSpeech.wordsPerMinute
    }),
    [liveSpeech.fillerCount, liveSpeech.pauseCount, liveSpeech.wordsPerMinute]
  );
  const currentFollowUp = currentQuestion ? followUps[currentQuestion.id] || "" : "";
  const codingFeedback = currentQuestion ? codingFeedbackByQuestion[currentQuestion.id] || null : null;
  const uploadedAnswerVideoUrl = currentQuestion ? uploadedVideoByQuestion[currentQuestion.id] || "" : "";
  const recordedAnswerMedia = currentQuestion ? recordedMediaByQuestion[currentQuestion.id] || null : null;
  const liveLanguageLabel = useMemo(
    () => LIVE_INTERVIEW_LANGUAGES.find((item) => item.value === liveLanguage)?.label || liveLanguage,
    [liveLanguage]
  );
  const judgeThreadKey = activeSession && currentQuestion ? `${activeSession.id}:${currentQuestion.id}` : "";
  const currentJudgeMessages = judgeThreadKey ? judgeThreads[judgeThreadKey] || [] : [];
  const topAnsweredQuestion = useMemo(() => getTopScoreQuestion(activeSession), [activeSession]);
  const improvementPlan = useMemo(() => {
    if (!activeSession || activeSession.status !== "completed") {
      return [];
    }
    const summaryImprovements = activeSession.summary?.improvements || [];
    const metricImprovements = buildMetricImprovementFocus(activeSession.metrics || {});
    const merged = [...summaryImprovements, ...metricImprovements].map((item) => String(item || "").trim()).filter(Boolean);
    return [...new Set(merged)];
  }, [activeSession]);
  const sessionSelection = useMemo(() => {
    if (!activeSession) {
      return { selected: false, statusLabel: "Not Selected", cutoffScore: 70 };
    }
    const cutoffScore = Number(activeSession.selection?.cutoffScore ?? 70);
    const selected = typeof activeSession.selection?.selected === "boolean" ? activeSession.selection.selected : Number(activeSession.overallScore || 0) >= cutoffScore;
    return {
      selected,
      statusLabel: String(activeSession.selection?.statusLabel || (selected ? "Selected" : "Not Selected")),
      cutoffScore
    };
  }, [activeSession]);
  const emailNotificationMeta = useMemo(() => {
    const status = String(activeSession?.emailNotification?.status || "").trim().toLowerCase();
    return {
      recipientEmail: String(activeSession?.emailNotification?.recipientEmail || user?.email || "").trim(),
      statusLabel: formatEmailNotificationStatus(status),
      rawStatus: status,
      error: String(activeSession?.emailNotification?.error || "").trim()
    };
  }, [activeSession?.emailNotification, user?.email]);
  const interviewerActing = speaking || speakingVisualActive || userSpeaking;
  function markAssistantSpeechGuard(text = "") {
    const words = String(text || "").trim().split(/\s+/).filter(Boolean).length;
    const guardMs = Math.min(12e3, Math.max(2200, words * 320));
    assistantSpeechGuardUntilRef.current = Date.now() + guardMs;
  }
  function clearLiveCommitTimer() {
    if (liveSilenceCommitTimerRef.current) {
      window.clearTimeout(liveSilenceCommitTimerRef.current);
      liveSilenceCommitTimerRef.current = null;
    }
  }
  function resetLiveConversation({ keepListening = false } = {}) {
    clearLiveCommitTimer();
    setLiveConversationBusy(false);
    setLiveInterviewPhase("idle");
    liveWeakAnswerAttemptsRef.current = {};
    processedTranscriptRef.current = "";
    bargeInCooldownRef.current = 0;
    assistantSpeechGuardUntilRef.current = 0;
    liveUserStartedRef.current = false;
    setLiveConversationOn(false);
    setLiveConversationStatus("Live interviewer is off.");
    if (!keepListening) {
      liveSpeech.stop();
    }
  }
  function appendResponseToDraft(questionId, segmentText, durationSec = 0) {
    const normalized = String(segmentText || "").replace(/\s+/g, " ").trim();
    if (!questionId || !normalized) {
      return;
    }
    setDrafts((previous) => {
      const existing = previous[questionId] || cloneDraft();
      const combinedRawText = `${existing.rawText || ""} ${normalized}`.replace(/\s+/g, " ").trim();
      const combinedTranscript = `${existing.transcript || ""} ${normalized}`.replace(/\s+/g, " ").trim();
      return {
        ...previous,
        [questionId]: {
          ...existing,
          rawText: combinedRawText,
          transcript: combinedTranscript,
          durationSec: Math.max(Number(existing.durationSec) || 0, Number(durationSec || 0))
        }
      };
    });
  }
  function appendSpokenResponse(questionId, segmentText) {
    appendResponseToDraft(questionId, segmentText, liveSpeech.durationSec || 0);
  }
  function resetLiveWeakAnswerAttempts(questionId = "") {
    if (!questionId) {
      liveWeakAnswerAttemptsRef.current = {};
      return;
    }
    liveWeakAnswerAttemptsRef.current = {
      ...liveWeakAnswerAttemptsRef.current,
      [questionId]: 0
    };
  }
  function incrementLiveWeakAnswerAttempts(questionId = "") {
    if (!questionId) {
      return 0;
    }
    const next = Number(liveWeakAnswerAttemptsRef.current[questionId] || 0) + 1;
    liveWeakAnswerAttemptsRef.current = {
      ...liveWeakAnswerAttemptsRef.current,
      [questionId]: next
    };
    return next;
  }
  function speakInterviewerLine(line = "", nextStatus = "") {
    const text = stripSpeakerPrefix(line) || line;
    if (!text) {
      return;
    }
    markAssistantSpeechGuard(text);
    const started = speak({ text, rate: 0.95, pitch: 1, lang: liveLanguage });
    if (started) {
      triggerInterviewerAct();
    }
    if (nextStatus) {
      setLiveConversationStatus(nextStatus);
    }
  }
  function buildInterviewContextPrefix() {
    if (!activeSession) {
      return "";
    }
    const source = sourceLabel(activeSession.questionSource);
    return liveLanguage === "hi-IN" ? `Category ${activeSession.category}, Target Role ${activeSession.targetRole}, Company Simulation ${activeSession.companySimulation}, Question Source ${source}.` : `Category ${activeSession.category}, Target Role ${activeSession.targetRole}, Company Simulation ${activeSession.companySimulation}, Question Source ${source}.`;
  }
  function askNextQuestionPermission(reason = "") {
    const prompt = liveLanguage === "hi-IN" ? reason === "not_answered" ? "Interviewer: Lagta hai complete answer abhi clear nahi hai. Kya aap next question pe jana chahte hain? Please yes ya no boliye." : "Interviewer: Kya aap next question pe jana chahte hain? Please yes ya no boliye." : reason === "not_answered" ? "Interviewer: It seems this answer is not complete yet. Do you want to move to the next question? Please say yes or no." : "Interviewer: Do you want to move to the next question? Please say yes or no.";
    appendJudgeMessage("judge", prompt);
    speakInterviewerLine(prompt, "Waiting for yes/no to continue.");
    setLiveInterviewPhase("awaiting_next_question_confirmation");
  }
  function moveToNextQuestionViaLiveInterviewer() {
    if (!activeSession?.questions?.length) {
      return;
    }
    const nextIndex = Math.min(activeSession.questions.length - 1, currentIndex + 1);
    if (nextIndex === currentIndex) {
      const doneReply = liveLanguage === "hi-IN" ? "Interviewer: Yeh last question tha. Session complete karne ke liye aap complete button use kar sakte hain." : "Interviewer: That was the last question. You can complete the session now.";
      appendJudgeMessage("judge", doneReply);
      speakInterviewerLine(doneReply, "No more questions in this session.");
      setLiveInterviewPhase("active");
      return;
    }
    const nextQuestion = activeSession.questions[nextIndex];
    setCurrentIndex(nextIndex);
    processedTranscriptRef.current = "";
    liveSpeech.reset();
    setLiveInterviewPhase("active");
    resetLiveWeakAnswerAttempts(nextQuestion?.id);
    const context = buildInterviewContextPrefix();
    const questionLine = liveLanguage === "hi-IN" ? `Interviewer: Theek hai. ${context} Agla sawal: ${nextQuestion?.prompt || ""}` : `Interviewer: Sure. ${context} Next question: ${nextQuestion?.prompt || ""}`;
    appendJudgeMessage("judge", questionLine);
    speakInterviewerLine(questionLine, "Next question asked. Please answer.");
  }
  async function requestLiveAiReply(questionId, candidateMessage) {
    if (!activeSession?.id || !questionId) {
      return;
    }
    setLiveConversationBusy(true);
    setLiveConversationStatus("Interviewer is reviewing your response...");
    const history = buildJudgeHistoryPayload(candidateMessage);
    appendJudgeMessage("user", candidateMessage);
    setError("");
    try {
      const payload = await sessionApi.judgeChat(token, activeSession.id, {
        message: candidateMessage,
        questionId,
        history,
        mode: "live_interviewer"
      });
      const reply = String(payload?.reply || "").trim() || "Interviewer: Good start. Can you add one specific impact metric?";
      appendJudgeMessage("judge", reply);
      setFollowUps((previous) => ({
        ...previous,
        [questionId]: reply
      }));
      const speechText = stripSpeakerPrefix(reply) || reply;
      markAssistantSpeechGuard(speechText);
      const started = speak({ text: speechText, rate: 0.95, pitch: 1, lang: liveLanguage });
      if (started) {
        triggerInterviewerAct();
      }
      setLiveConversationStatus(
        fullDuplexOn ? "Interviewer replied. Keep talking naturally (full duplex)." : "Interviewer replied. Your turn now."
      );
    } catch (requestError) {
      const fallback = "Interviewer: I missed that. Please repeat briefly with what you did and what result you got.";
      appendJudgeMessage("judge", fallback);
      setError(requestError.message || "Live interviewer reply failed.");
      setLiveConversationStatus("Retry speaking. Interviewer response failed once.");
    } finally {
      setLiveConversationBusy(false);
    }
  }
  function toggleLiveConversation() {
    if (!currentQuestion || !activeSession) {
      return;
    }
    if (!liveSpeech.supported) {
      setError("Live conversation needs browser speech-to-text support.");
      return;
    }
    if (liveConversationOn) {
      resetLiveConversation();
      return;
    }
    setLiveConversationOn(true);
    setLiveInterviewPhase("awaiting_intro_reply");
    resetLiveWeakAnswerAttempts(currentQuestion.id);
    processedTranscriptRef.current = "";
    bargeInCooldownRef.current = 0;
    liveUserStartedRef.current = false;
    liveSpeech.reset();
    const greeting = liveLanguage === "hi-IN" ? "Interviewer: Hi, main aapka AI interviewer hoon. Pehle hello boliye." : "Interviewer: Hi, I am your AI interviewer. Please say hello first.";
    appendJudgeMessage("judge", greeting);
    speakInterviewerLine(greeting, "Interviewer greeted you. Reply hi/hello to continue.");
  }
  function updateSetup(key, value) {
    setSetup((previous) => {
      const next = { ...previous, [key]: value };
      if (key === "category" && value === "Coding" && next.source === "predefined") {
        next.source = "ai";
      }
      return next;
    });
  }
  function updateDraft(questionId, patch) {
    setDrafts((previous) => {
      const existing = previous[questionId] || cloneDraft();
      return {
        ...previous,
        [questionId]: {
          ...existing,
          ...patch
        }
      };
    });
  }
  async function completeSessionRequest(sessionId, { keepalive = false, silent = false } = {}) {
    const response = await fetch(`${API_BASE}/sessions/${sessionId}/complete`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {})
      },
      keepalive
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      if (silent) {
        return null;
      }
      throw new Error(payload.message || "Failed to complete session.");
    }
    return payload;
  }
  async function lockInterviewForIntegrity(reason, { type = "policy", meta: meta2 = "" } = {}) {
    if (securityLockRef.current) {
      return;
    }
    securityLockRef.current = true;
    setSecurityLocked(true);
    setSecurityLockReason(String(reason || "Policy violation detected."));
    setError("Interview closed due to integrity policy violation.");
    resetLiveConversation({ keepListening: false });
    if (answerRecorder.recording) {
      answerRecorder.stop();
    }
    stopWebcam();
    if (activeSession?.id) {
      try {
        const payload = await sessionApi.reportSecurityIncident(token, activeSession.id, {
          type,
          reason,
          meta: meta2,
          terminateSession: true
        });
        setSecurityViolationCount(Number(payload?.violationCount || 0));
        if (payload?.terminated) {
          setActiveSession(
            (previous) => previous?.id === activeSession.id ? {
              ...previous,
              status: "completed",
              endedAt: new Date().toISOString()
            } : previous
          );
        }
      } catch {
      }
    }
    window.setTimeout(() => {
      try {
        window.open("", "_self");
        window.close();
      } catch {
      }
      window.location.replace("/");
    }, 1400);
  }
  function triggerInterviewerAct(durationMs = 4500) {
    if (speakingVisualTimeoutRef.current) {
      window.clearTimeout(speakingVisualTimeoutRef.current);
      speakingVisualTimeoutRef.current = null;
    }
    setSpeakingVisualActive(true);
    speakingVisualTimeoutRef.current = window.setTimeout(() => {
      setSpeakingVisualActive(false);
      speakingVisualTimeoutRef.current = null;
    }, durationMs);
  }
  function stopWebcam() {
    if (webcamStreamRef.current) {
      webcamStreamRef.current.getTracks().forEach((track) => track.stop());
      webcamStreamRef.current = null;
    }
    if (webcamVideoRef.current) {
      webcamVideoRef.current.srcObject = null;
    }
    setWebcamOn(false);
    setWebcamLoading(false);
  }
  async function startWebcam() {
    if (webcamLoading || webcamOn) {
      return;
    }
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      setWebcamError("Camera is not supported in this browser.");
      return;
    }
    setWebcamLoading(true);
    setWebcamError("");
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: "user",
          width: { ideal: 1280 },
          height: { ideal: 720 }
        },
        audio: false
      });
      webcamStreamRef.current = stream;
      if (webcamVideoRef.current) {
        webcamVideoRef.current.srcObject = stream;
      }
      setWebcamOn(true);
    } catch (requestError) {
      setWebcamOn(false);
      setWebcamError(requestError?.message || "Unable to access webcam.");
    } finally {
      setWebcamLoading(false);
    }
  }
  function toggleWebcam() {
    if (webcamOn) {
      stopWebcam();
      return;
    }
    startWebcam();
  }
  async function applyResumeFile(file) {
    if (!file) {
      return;
    }
    if (file.size > MAX_RESUME_FILE_BYTES) {
      setError("Resume file is too large. Please upload a file up to 4 MB.");
      return;
    }
    setResumeProcessing(true);
    setError("");
    try {
      const parsedText = await parseResumeFile(file);
      if (!parsedText) {
        throw new Error("Resume file appears to be empty.");
      }
      const clipped = parsedText.slice(0, MAX_RESUME_TEXT_LENGTH);
      updateSetup("resumeText", clipped);
      updateSetup("source", "resume");
      setResumeFileMeta({ name: file.name, size: file.size });
      setMessage(`Resume uploaded: ${file.name}. AI will focus on extracted candidate skills.`);
    } catch (parseError) {
      setError(parseError.message || "Failed to process resume file.");
    } finally {
      setResumeProcessing(false);
      setResumeDragActive(false);
    }
  }
  function clearResumeUpload() {
    setResumeFileMeta({ name: "", size: 0 });
    updateSetup("resumeText", "");
  }
  function onResumeFileSelected(event) {
    const file = event.target.files?.[0];
    event.target.value = "";
    applyResumeFile(file);
  }
  function handleResumeDragOver(event) {
    event.preventDefault();
    if (!resumeProcessing) {
      setResumeDragActive(true);
    }
  }
  function handleResumeDragLeave(event) {
    event.preventDefault();
    setResumeDragActive(false);
  }
  function handleResumeDrop(event) {
    event.preventDefault();
    setResumeDragActive(false);
    const file = event.dataTransfer?.files?.[0];
    applyResumeFile(file);
  }
  function resetDraftsFromSession(sessionPayload) {
    const next = {};
    for (const question of sessionPayload.questions) {
      next[question.id] = question.answer ? {
        rawText: question.answer.rawText || "",
        transcript: question.answer.transcript || "",
        codeSolution: question.answer.codeSolution || "",
        confidenceSelfRating: question.answer.confidenceSelfRating || 7,
        facialExpressionScore: question.answer.facialExpressionScore || 0,
        durationSec: question.answer.durationSec || 0,
        mediaReference: question.answer.mediaReference || ""
      } : cloneDraft();
    }
    setDrafts(next);
  }
  async function loadMetaAndSessions() {
    setLoading(true);
    setError("");
    try {
      const [metaPayload, sessionsPayload] = await Promise.all([questionApi.meta(), sessionApi.list(token)]);
      setMeta(metaPayload);
      setSessionList(sessionsPayload.sessions || []);
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    loadMetaAndSessions();
  }, [token]);
  useEffect(() => {
    const handleOnline = () => setNetworkOffline(false);
    const handleOffline = () => setNetworkOffline(true);
    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);
    return () => {
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
    };
  }, []);
  useEffect(() => {
    if (!activeSession || activeSession.status !== "in_progress" || securityLocked) {
      return void 0;
    }
    const handleVisibilityChange = () => {
      if (document.visibilityState !== "hidden") {
        return;
      }
      lockInterviewForIntegrity("Tab switch detected during interview.", {
        type: "focus",
        meta: networkOffline ? "visibility_hidden_while_offline" : "visibility_hidden"
      });
    };
    const handleWindowBlur = () => {
      if (networkOffline) {
        lockInterviewForIntegrity("Offline + window blur detected during interview.", {
          type: "focus",
          meta: "window_blur_while_offline"
        });
      }
    };
    const handleClipboardAttempt = (event) => {
      if (!networkOffline) {
        return;
      }
      event.preventDefault();
      lockInterviewForIntegrity("Offline + clipboard action detected during interview.", {
        type: "clipboard",
        meta: event.type
      });
    };
    const handleDevtoolsShortcut = (event) => {
      if (!networkOffline) {
        return;
      }
      const key = String(event.key || "").toLowerCase();
      const triedShortcut = key === "f12" || (event.ctrlKey || event.metaKey) && event.shiftKey && ["i", "j", "c"].includes(key);
      if (!triedShortcut) {
        return;
      }
      event.preventDefault();
      lockInterviewForIntegrity("Offline + restricted shortcut detected during interview.", {
        type: "policy",
        meta: `shortcut:${key}`
      });
    };
    document.addEventListener("visibilitychange", handleVisibilityChange);
    window.addEventListener("blur", handleWindowBlur);
    document.addEventListener("copy", handleClipboardAttempt);
    document.addEventListener("cut", handleClipboardAttempt);
    document.addEventListener("paste", handleClipboardAttempt);
    document.addEventListener("keydown", handleDevtoolsShortcut);
    return () => {
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      window.removeEventListener("blur", handleWindowBlur);
      document.removeEventListener("copy", handleClipboardAttempt);
      document.removeEventListener("cut", handleClipboardAttempt);
      document.removeEventListener("paste", handleClipboardAttempt);
      document.removeEventListener("keydown", handleDevtoolsShortcut);
    };
  }, [activeSession?.id, activeSession?.status, networkOffline, securityLocked]);
  useEffect(() => {
    if (!currentQuestion || !autoSpeak || liveConversationOn) {
      return;
    }
    const timerId = window.setTimeout(() => {
      const started = speak({ text: currentQuestion.prompt, rate: 0.95, pitch: 1.02 });
      triggerInterviewerAct();
      if (!started && speechEnabled) {
        setError("Voice could not start automatically. Click 'Ask Question' to play manually.");
      }
    }, 120);
    return () => {
      window.clearTimeout(timerId);
    };
  }, [autoSpeak, currentQuestion?.id, liveConversationOn, speak, speechEnabled]);
  useEffect(() => {
    if (!liveConversationOn || !activeSession || !currentQuestion) {
      return;
    }
    liveSpeech.reset();
    processedTranscriptRef.current = "";
    clearLiveCommitTimer();
    liveUserStartedRef.current = false;
    if (liveInterviewPhase === "awaiting_start_confirmation") {
      setLiveConversationStatus("Listening... say yes to start the interview.");
      return;
    }
    if (liveInterviewPhase === "awaiting_next_question_confirmation") {
      setLiveConversationStatus("Listening... say yes or no for next question.");
      return;
    }
    if (liveInterviewPhase === "active") {
      setLiveConversationStatus("Listening to your answer...");
      return;
    }
    setLiveConversationStatus("Listening... reply hi/hello to continue.");
  }, [activeSession?.id, currentQuestion?.id, liveConversationOn, liveInterviewPhase, liveSpeech.reset]);
  useEffect(() => {
    if (!liveConversationOn || !fullDuplexOn) {
      return;
    }
    if (!speaking || !userSpeaking) {
      return;
    }
    if (Date.now() < assistantSpeechGuardUntilRef.current) {
      return;
    }
    const fullTranscript = String(liveSpeech.fullTranscript || "").replace(/\s+/g, " ").trim();
    const processed = processedTranscriptRef.current;
    const pending = fullTranscript.startsWith(processed) ? fullTranscript.slice(processed.length).replace(/\s+/g, " ").trim() : fullTranscript;
    const pendingWords = pending.split(/\s+/).filter(Boolean).length;
    const commandLike = looksLikeVoiceCommand(pending);
    if (!pending || pendingWords < 2 && !commandLike) {
      return;
    }
    const now = Date.now();
    if (now - bargeInCooldownRef.current < LIVE_BARGE_IN_COOLDOWN_MS) {
      return;
    }
    bargeInCooldownRef.current = now;
    cancel();
    assistantSpeechGuardUntilRef.current = 0;
    clearLiveCommitTimer();
    processedTranscriptRef.current = String(liveSpeech.fullTranscript || "").replace(/\s+/g, " ").trim();
    setLiveConversationStatus("You interrupted the interviewer. Listening to your response...");
  }, [cancel, fullDuplexOn, liveConversationOn, liveSpeech.fullTranscript, speaking, userSpeaking]);
  useEffect(() => {
    if (!liveConversationOn || !activeSession || !currentQuestion) {
      return;
    }
    if (!fullDuplexOn && speaking) {
      if (liveSpeech.listening) {
        liveSpeech.stop();
      }
      return;
    }
    if (!liveSpeech.listening) {
      const started = liveSpeech.start({ lang: liveLanguage });
      if (started) {
        if (liveInterviewPhase === "awaiting_start_confirmation") {
          setLiveConversationStatus("Listening... say yes to start the interview.");
        } else if (liveInterviewPhase === "awaiting_next_question_confirmation") {
          setLiveConversationStatus("Listening... say yes or no for next question.");
        } else if (liveInterviewPhase === "active") {
          setLiveConversationStatus("Listening to your answer...");
        } else {
          setLiveConversationStatus("Listening... reply hi/hello to continue.");
        }
      }
    }
  }, [
  activeSession?.id,
  currentQuestion?.id,
  fullDuplexOn,
  liveLanguage,
  liveConversationBusy,
  liveConversationOn,
  liveInterviewPhase,
  liveSpeech.listening,
  liveSpeech.start,
  liveSpeech.stop,
  speaking]
  );
  useEffect(() => {
    if (!liveConversationOn || !activeSession || !currentQuestion) {
      clearLiveCommitTimer();
      return;
    }
    const fullTranscript = String(liveSpeech.fullTranscript || "").replace(/\s+/g, " ").trim();
    if (liveConversationBusy) {
      clearLiveCommitTimer();
      return;
    }
    if (!fullDuplexOn && speaking) {
      clearLiveCommitTimer();
      return;
    }
    const guardActive = Date.now() < assistantSpeechGuardUntilRef.current;
    if (guardActive) {
      processedTranscriptRef.current = fullTranscript;
      clearLiveCommitTimer();
      return;
    }
    if (speaking && !userSpeaking) {
      processedTranscriptRef.current = fullTranscript;
      clearLiveCommitTimer();
      return;
    }
    if (!fullTranscript) {
      clearLiveCommitTimer();
      return;
    }
    const processed = processedTranscriptRef.current;
    const pendingSegment = fullTranscript.startsWith(processed) ? fullTranscript.slice(processed.length).replace(/\s+/g, " ").trim() : fullTranscript;
    if (!pendingSegment) {
      clearLiveCommitTimer();
      return;
    }
    clearLiveCommitTimer();
    liveSilenceCommitTimerRef.current = window.setTimeout(() => {
      const latestTranscript = String(liveSpeech.fullTranscript || "").replace(/\s+/g, " ").trim();
      const baseline = processedTranscriptRef.current;
      const delta = latestTranscript.startsWith(baseline) ? latestTranscript.slice(baseline.length).replace(/\s+/g, " ").trim() : latestTranscript;
      if (speaking && !userSpeaking) {
        processedTranscriptRef.current = latestTranscript;
        return;
      }
      const wordCount = delta.split(/\s+/).filter(Boolean).length;
      const commandLike = looksLikeVoiceCommand(delta);
      const inHandshakePhase = liveInterviewPhase !== "active";
      const requiredWords = inHandshakePhase ? 1 : commandLike ? 1 : fullDuplexOn ? 2 : LIVE_RESPONSE_MIN_WORDS;
      if (!delta || wordCount < requiredWords) {
        return;
      }
      if (liveSpeech.interimTranscript && !inHandshakePhase && !commandLike && wordCount < 5) {
        setLiveConversationStatus("Listening... please continue your response.");
        return;
      }
      processedTranscriptRef.current = latestTranscript;
      liveUserStartedRef.current = true;
      if (liveInterviewPhase === "awaiting_intro_reply") {
        appendJudgeMessage("user", delta);
        const confirmPrompt = liveLanguage === "hi-IN" ? "Interviewer: Great. Kya hum interview start karein? Please yes boliye." : "Interviewer: Great. Should we start the interview now? Please say yes.";
        appendJudgeMessage("judge", confirmPrompt);
        const speechText = stripSpeakerPrefix(confirmPrompt) || confirmPrompt;
        markAssistantSpeechGuard(speechText);
        const started = speak({ text: speechText, rate: 0.95, pitch: 1, lang: liveLanguage });
        if (started) {
          triggerInterviewerAct();
        }
        setLiveInterviewPhase("awaiting_start_confirmation");
        setLiveConversationStatus("Waiting for your yes to start.");
        return;
      }
      if (liveInterviewPhase === "awaiting_start_confirmation") {
        appendJudgeMessage("user", delta);
        if (isInterviewStartAffirmative(delta)) {
          setLiveInterviewPhase("active");
          resetLiveWeakAnswerAttempts(currentQuestion.id);
          const context = buildInterviewContextPrefix();
          const firstQuestion = liveLanguage === "hi-IN" ? `Interviewer: Perfect. Interview start karte hain. ${context} Pehla sawal: ${currentQuestion.prompt}` : `Interviewer: Perfect. Let's start. ${context} First question: ${currentQuestion.prompt}`;
          appendJudgeMessage("judge", firstQuestion);
          speakInterviewerLine(firstQuestion, "Interview started. Please answer the question.");
          return;
        }
        const response = isInterviewStartNegative(delta) ? liveLanguage === "hi-IN" ? "Interviewer: Theek hai. Jab ready ho tab yes boliyega." : "Interviewer: Sure. Say yes whenever you are ready." : liveLanguage === "hi-IN" ? "Interviewer: Interview start karne ke liye yes boliyega." : "Interviewer: Please say yes to start the interview.";
        appendJudgeMessage("judge", response);
        speakInterviewerLine(response, "Still waiting for your yes.");
        return;
      }
      if (liveInterviewPhase === "awaiting_next_question_confirmation") {
        appendJudgeMessage("user", delta);
        if (isInterviewStartAffirmative(delta)) {
          moveToNextQuestionViaLiveInterviewer();
          return;
        }
        if (isInterviewStartNegative(delta)) {
          setLiveInterviewPhase("active");
          const continuePrompt = liveLanguage === "hi-IN" ? "Interviewer: Theek hai, hum isi question par continue karte hain. Apna best structured answer dijiye." : "Interviewer: Sure, we will continue with the same question. Please give your best structured answer.";
          appendJudgeMessage("judge", continuePrompt);
          speakInterviewerLine(continuePrompt, "Continuing with current question.");
          return;
        }
        const clarifyPrompt = liveLanguage === "hi-IN" ? "Interviewer: Please yes ya no boliye. Kya aap next question pe jana chahte hain?" : "Interviewer: Please say yes or no. Do you want to move to the next question?";
        appendJudgeMessage("judge", clarifyPrompt);
        speakInterviewerLine(clarifyPrompt, "Waiting for yes/no to continue.");
        return;
      }
      if (liveInterviewPhase === "active") {
        if (isNextQuestionIntent(delta)) {
          appendJudgeMessage("user", delta);
          askNextQuestionPermission("requested");
          return;
        }
        if (!commandLike) {
          if (isNoAnswerSignal(delta)) {
            appendJudgeMessage("user", delta);
            askNextQuestionPermission("not_answered");
            return;
          }
          const strongAnswer = isStrongLiveAnswer({
            text: delta,
            category: activeSession?.category || "HR"
          });
          if (!strongAnswer) {
            appendJudgeMessage("user", delta);
            const weakAttempts = incrementLiveWeakAnswerAttempts(currentQuestion.id);
            if (weakAttempts >= LIVE_WEAK_ANSWER_RETRY_LIMIT) {
              askNextQuestionPermission("not_answered");
              return;
            }
            const retryPrompt = liveLanguage === "hi-IN" ? "Interviewer: Is question par thoda aur detail chahiye. Situation, aapka exact action, aur measurable result add karke answer complete kariye." : "Interviewer: I need a more complete answer for this question. Add situation, your exact action, and a measurable result.";
            appendJudgeMessage("judge", retryPrompt);
            speakInterviewerLine(retryPrompt, "Waiting for a stronger answer on this question.");
            return;
          }
          resetLiveWeakAnswerAttempts(currentQuestion.id);
          appendSpokenResponse(currentQuestion.id, delta);
        }
        requestLiveAiReply(currentQuestion.id, delta);
        return;
      }
      requestLiveAiReply(currentQuestion.id, delta);
    }, LIVE_SILENCE_COMMIT_MS);
    return () => {
      clearLiveCommitTimer();
    };
  }, [
  activeSession?.id,
  currentQuestion?.id,
  fullDuplexOn,
  liveConversationBusy,
  liveConversationOn,
  liveInterviewPhase,
  liveLanguage,
  liveSpeech.fullTranscript,
  liveSpeech.interimTranscript,
  speaking,
  userSpeaking]
  );
  useEffect(() => {
    if (!currentQuestion?.id) {
      return;
    }
    resetLiveWeakAnswerAttempts(currentQuestion.id);
  }, [currentQuestion?.id]);
  useEffect(() => {
    if (!judgeThreadKey || !currentQuestion) {
      return;
    }
    setJudgeThreads((previous) => {
      if (previous[judgeThreadKey]?.length) {
        return previous;
      }
      return {
        ...previous,
        [judgeThreadKey]: []
      };
    });
  }, [judgeThreadKey, currentQuestion?.id]);
  useEffect(() => {
    uploadedVideoByQuestionRef.current = uploadedVideoByQuestion;
  }, [uploadedVideoByQuestion]);
  useEffect(() => {
    if (!recordingTargetQuestionId || !answerRecorder.captureId) {
      return;
    }
    const capture = {
      videoBlob: answerRecorder.videoBlob,
      audioBlob: answerRecorder.audioBlob,
      previewUrl: answerRecorder.previewUrl,
      mediaReference: answerRecorder.mediaReference,
      durationSec: answerRecorder.durationSec,
      videoMimeType: answerRecorder.videoMimeType,
      audioMimeType: answerRecorder.audioMimeType
    };
    setRecordedMediaByQuestion((previous) => ({
      ...previous,
      [recordingTargetQuestionId]: capture
    }));
    if (capture.previewUrl) {
      setUploadedVideoByQuestion((previous) => {
        const previousUrl = previous[recordingTargetQuestionId];
        if (previousUrl?.startsWith("blob:") && previousUrl !== capture.previewUrl) {
          URL.revokeObjectURL(previousUrl);
        }
        return {
          ...previous,
          [recordingTargetQuestionId]: capture.previewUrl
        };
      });
    }
    updateDraft(recordingTargetQuestionId, {
      durationSec: capture.durationSec || 0,
      mediaReference: capture.mediaReference || ""
    });
    setRecordingTargetQuestionId("");
    setMessage("Recorded video answer captured. Submit for AI analysis.");
  }, [
  answerRecorder.audioBlob,
  answerRecorder.audioMimeType,
  answerRecorder.captureId,
  answerRecorder.durationSec,
  answerRecorder.mediaReference,
  answerRecorder.previewUrl,
  answerRecorder.videoBlob,
  answerRecorder.videoMimeType,
  recordingTargetQuestionId]
  );
  useEffect(() => {
    return () => {
      clearLiveCommitTimer();
      cancel();
      stopWebcam();
      liveSpeech.stop();
      if (speakingVisualTimeoutRef.current) {
        window.clearTimeout(speakingVisualTimeoutRef.current);
        speakingVisualTimeoutRef.current = null;
      }
      Object.values(uploadedVideoByQuestionRef.current).forEach((url) => {
        if (String(url || "").startsWith("blob:")) {
          URL.revokeObjectURL(url);
        }
      });
    };
  }, [cancel, liveSpeech.stop]);
  useEffect(() => {
    if (webcamOn && webcamVideoRef.current && webcamStreamRef.current && !webcamVideoRef.current.srcObject) {
      webcamVideoRef.current.srcObject = webcamStreamRef.current;
    }
  }, [webcamOn, activeSession?.id]);
  useEffect(() => {
    if (!activeSession || webcamOn || webcamLoading) {
      return;
    }
    startWebcam();
  }, [activeSession?.id]);
  useEffect(() => {
    if (!activeSession || activeSession.status !== "in_progress") {
      return;
    }
    exitCompletionRef.current = false;
    const handleExit = () => {
      if (exitCompletionRef.current) {
        return;
      }
      exitCompletionRef.current = true;
      completeSessionRequest(activeSession.id, { keepalive: true, silent: true }).then((payload) => {
        if (!payload?.session) {
          return;
        }
        saveCompletedPracticeSession({
          user,
          sessionId: activeSession.id,
          completedAt: payload.session.endedAt
        });
        setActiveSession(
          (previous) => previous?.id === activeSession.id ? {
            ...previous,
            status: "completed",
            metrics: payload.session.metrics,
            summary: payload.session.summary,
            overallScore: payload.session.overallScore,
            selection: payload.session.selection,
            emailNotification: payload.session.emailNotification,
            certificate: payload.session.certificate,
            endedAt: payload.session.endedAt
          } : previous
        );
      }).catch(() => {
      });
    };
    const handleVisibilityChange = () => {
      if (document.visibilityState === "hidden" && !securityLockRef.current) {
        handleExit();
      }
    };
    window.addEventListener("beforeunload", handleExit);
    window.addEventListener("pagehide", handleExit);
    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => {
      window.removeEventListener("beforeunload", handleExit);
      window.removeEventListener("pagehide", handleExit);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [activeSession?.id, activeSession?.status, token, user?.id, user?.email]);
  async function createSession(event) {
    event.preventDefault();
    if (setup.source === "resume" && !setup.resumeText.trim()) {
      setError("Paste resume text before starting resume-based questions.");
      return;
    }
    setSaving(true);
    setError("");
    setMessage("");
    try {
      const payload = await sessionApi.create(token, {
        category: setup.category,
        targetRole: setup.targetRole,
        companySimulation: setup.companySimulation,
        source: setup.source,
        count: Number(setup.count),
        resumeText: setup.resumeText,
        jobDescriptionText: setup.jobDescriptionText
      });
      const normalized = {
        id: payload.sessionId,
        category: payload.category,
        targetRole: setup.targetRole,
        companySimulation: setup.companySimulation,
        status: payload.status,
        questionSource: payload.questionSource,
        focusAreas: payload.focusAreas || [],
        jobDescriptionText: setup.jobDescriptionText,
        questions: (payload.questions || []).map((question) => ({
          id: question.id,
          prompt: question.prompt,
          tags: question.tags,
          order: question.order,
          answer: null
        }))
      };
      setActiveSession(normalized);
      setCurrentIndex(0);
      resetDraftsFromSession(normalized);
      setFollowUps({});
      setCodingFeedbackByQuestion({});
      setJudgeThreads({});
      setJudgeInput("");
      setJudgeLoading(false);
      resetLiveConversation({ keepListening: true });
      clearUploadedAnswerVideos();
      liveSpeech.reset();
      setMessage("Session started. The virtual interviewer is ready.");
      const sessionsPayload = await sessionApi.list(token);
      setSessionList(sessionsPayload.sessions || []);
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setSaving(false);
    }
  }
  async function openSession(sessionId) {
    setLoading(true);
    setError("");
    try {
      const payload = await sessionApi.details(token, sessionId);
      const normalized = {
        id: payload.session.id,
        category: payload.session.category,
        targetRole: payload.session.targetRole,
        companySimulation: payload.session.companySimulation,
        status: payload.session.status,
        questionSource: payload.session.questionSource,
        focusAreas: payload.session.focusAreas || [],
        jobDescriptionText: payload.session.jobDescriptionText || "",
        metrics: payload.session.metrics,
        summary: payload.session.summary,
        overallScore: payload.session.overallScore,
        selection: payload.session.selection,
        emailNotification: payload.session.emailNotification,
        certificate: payload.session.certificate,
        endedAt: payload.session.endedAt,
        questions: payload.questions
      };
      setActiveSession(normalized);
      setCurrentIndex(0);
      resetDraftsFromSession(normalized);
      setFollowUps({});
      setCodingFeedbackByQuestion({});
      setJudgeThreads({});
      setJudgeInput("");
      setJudgeLoading(false);
      resetLiveConversation({ keepListening: true });
      clearUploadedAnswerVideos();
      liveSpeech.reset();
      setMessage("Session loaded.");
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setLoading(false);
    }
  }
  async function submitAnswer({ silent = false } = {}) {
    if (!activeSession || !currentQuestion) {
      return false;
    }
    setSaving(true);
    setError("");
    if (!silent) {
      setMessage("");
    }
    try {
      const mediaCapture = recordedMediaByQuestion[currentQuestion.id] || null;
      const hasMediaCapture = Boolean(mediaCapture?.audioBlob || mediaCapture?.videoBlob);
      const transcriptText = (liveSpeech.fullTranscript || currentDraft.transcript || "").trim();
      const rawTextBase = String(currentDraft.rawText || "").trim();
      const codingSnippet = String(currentDraft.codeSolution || "").trim();
      const rawText = activeSession.category === "Coding" && codingSnippet ? `${rawTextBase}

Code Solution:
${codingSnippet}`.trim() : rawTextBase;
      const hasAnswer = Boolean(rawText || transcriptText || codingSnippet || hasMediaCapture);
      if (!hasAnswer) {
        if (!silent) {
          setMessage(buildUnableToAnswerSuggestion(currentQuestion.prompt, activeSession.category));
        }
        return false;
      }
      const timelineMarkers = [
      { second: 12, label: "Open with direct context and role fit.", kind: "clarity" },
      { second: 32, label: "Highlight strongest action and measurable result.", kind: "relevance" }];

      const resolvedDurationSec = Math.max(
        Number(liveSpeech.durationSec || 0),
        Number(currentDraft.durationSec || 0),
        Number(mediaCapture?.durationSec || 0)
      );
      const resolvedAnswerType = hasMediaCapture ? "video" : "text";
      const resolvedMediaReference = String(mediaCapture?.mediaReference || currentDraft.mediaReference || "");
      let payload;
      if (hasMediaCapture) {
        const formData = new FormData();
        formData.append("answerType", resolvedAnswerType);
        formData.append("rawText", rawText);
        formData.append("transcript", transcriptText || rawText);
        formData.append("mediaReference", resolvedMediaReference);
        formData.append("durationSec", String(resolvedDurationSec));
        formData.append("facialExpressionScore", String(Number(currentDraft.facialExpressionScore || 0)));
        formData.append("confidenceSelfRating", String(Number(currentDraft.confidenceSelfRating || 0)));
        formData.append("timelineMarkers", JSON.stringify(timelineMarkers));
        if (mediaCapture.audioBlob) {
          const audioExt = mimeTypeToExtension(mediaCapture.audioMimeType, "webm");
          formData.append("audioFile", mediaCapture.audioBlob, `answer-audio.${audioExt}`);
        }
        if (mediaCapture.videoBlob) {
          const videoExt = mimeTypeToExtension(mediaCapture.videoMimeType, "webm");
          formData.append("videoFile", mediaCapture.videoBlob, `answer-video.${videoExt}`);
        }
        payload = await sessionApi.answer(token, activeSession.id, currentQuestion.id, formData);
      } else {
        payload = await sessionApi.answer(token, activeSession.id, currentQuestion.id, {
          answerType: "text",
          rawText,
          transcript: transcriptText || rawText,
          mediaReference: resolvedMediaReference,
          durationSec: resolvedDurationSec,
          facialExpressionScore: Number(currentDraft.facialExpressionScore || 0),
          confidenceSelfRating: currentDraft.confidenceSelfRating,
          timelineMarkers
        });
      }
      setActiveSession((previous) => ({
        ...previous,
        questions: previous.questions.map(
          (question) => question.id === currentQuestion.id ? { ...question, answer: payload.answer } : question
        )
      }));
      updateDraft(currentQuestion.id, {
        transcript: payload.answer?.transcript || transcriptText || rawText,
        durationSec: Number(payload.answer?.durationSec || resolvedDurationSec || 0),
        mediaReference: payload.answer?.mediaReference || resolvedMediaReference
      });
      if (payload.followUpQuestion) {
        setFollowUps((previous) => ({
          ...previous,
          [currentQuestion.id]: payload.followUpQuestion
        }));
      }
      if (!silent) {
        setMessage(`Answer scored: ${payload.answer.aiScores.overall}/100`);
      }
      return true;
    } catch (requestError) {
      setError(requestError.message);
      return false;
    } finally {
      setSaving(false);
    }
  }
  async function requestFollowUpQuestion() {
    if (!activeSession || !currentQuestion) {
      return;
    }
    setFollowUpLoading(true);
    setError("");
    try {
      const payload = await sessionApi.followUp(token, activeSession.id, currentQuestion.id, {
        answerText: currentDraft.rawText
      });
      if (payload?.followUpQuestion) {
        setFollowUps((previous) => ({
          ...previous,
          [currentQuestion.id]: payload.followUpQuestion
        }));
      }
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setFollowUpLoading(false);
    }
  }
  function applyLiveTranscriptToDraft() {
    const fullTranscript = String(liveSpeech.fullTranscript || "").trim();
    if (!fullTranscript || !currentQuestion) {
      return;
    }
    updateDraft(currentQuestion.id, {
      rawText: fullTranscript,
      transcript: fullTranscript,
      durationSec: liveSpeech.durationSec || 0
    });
  }
  function evaluateCodingRound() {
    if (!currentQuestion) {
      return;
    }
    const feedback = evaluateCodingAnswer({
      prompt: currentQuestion.prompt,
      code: currentDraft.codeSolution
    });
    setCodingFeedbackByQuestion((previous) => ({
      ...previous,
      [currentQuestion.id]: feedback
    }));
  }
  async function startAnswerRecording() {
    if (!currentQuestion) {
      return;
    }
    setError("");
    setMessage("");
    setRecordingTargetQuestionId(currentQuestion.id);
    const started = await answerRecorder.start();
    if (!started) {
      setRecordingTargetQuestionId("");
      setError("Unable to start recording. Check microphone/camera permissions.");
    }
  }
  function stopAnswerRecording() {
    answerRecorder.stop();
  }
  function clearRecordedAnswerMedia(questionId = "") {
    const targetQuestionId = questionId || currentQuestion?.id;
    if (!targetQuestionId) {
      return;
    }
    setRecordedMediaByQuestion((previous) => {
      if (!previous[targetQuestionId]) {
        return previous;
      }
      const next = { ...previous };
      delete next[targetQuestionId];
      return next;
    });
    setUploadedVideoByQuestion((previous) => {
      const currentUrl = previous[targetQuestionId];
      if (currentUrl?.startsWith("blob:")) {
        URL.revokeObjectURL(currentUrl);
      }
      const next = { ...previous };
      delete next[targetQuestionId];
      return next;
    });
    updateDraft(targetQuestionId, {
      mediaReference: "",
      durationSec: 0
    });
  }
  function onAnswerVideoSelected(event) {
    if (!currentQuestion) {
      return;
    }
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) {
      return;
    }
    setRecordedMediaByQuestion((previous) => {
      if (!previous[currentQuestion.id]) {
        return previous;
      }
      const next = { ...previous };
      delete next[currentQuestion.id];
      return next;
    });
    setUploadedVideoByQuestion((previous) => {
      const previousUrl = previous[currentQuestion.id];
      if (previousUrl?.startsWith("blob:")) {
        URL.revokeObjectURL(previousUrl);
      }
      return {
        ...previous,
        [currentQuestion.id]: URL.createObjectURL(file)
      };
    });
  }
  function clearUploadedAnswerVideos() {
    setUploadedVideoByQuestion((previous) => {
      Object.values(previous).forEach((url) => {
        if (String(url || "").startsWith("blob:")) {
          URL.revokeObjectURL(url);
        }
      });
      return {};
    });
    setRecordedMediaByQuestion({});
    setRecordingTargetQuestionId("");
    answerRecorder.reset({ revokePreviewUrl: false });
  }
  function appendJudgeMessage(role, text) {
    const normalized = String(text || "").trim();
    if (!judgeThreadKey || !normalized) {
      return;
    }
    setJudgeThreads((previous) => ({
      ...previous,
      [judgeThreadKey]: [...(previous[judgeThreadKey] || []), createJudgeMessage(role, normalized)]
    }));
  }
  function buildJudgeHistoryPayload(nextUserText = "") {
    const history = (currentJudgeMessages || []).slice(-9).map((item) => ({
      role: item.role,
      text: String(item.text || "").trim()
    })).filter((item) => item.text);
    const normalizedNext = String(nextUserText || "").trim();
    if (normalizedNext) {
      history.push({ role: "user", text: normalizedNext });
    }
    return history.slice(-10);
  }
  async function sendJudgeMessage() {
    if (!activeSession) {
      return;
    }
    const messageText = String(judgeInput || "").trim();
    if (!messageText) {
      return;
    }
    const history = buildJudgeHistoryPayload(messageText);
    appendJudgeMessage("user", messageText);
    appendResponseToDraft(currentQuestion?.id, messageText, 0);
    setJudgeInput("");
    setJudgeLoading(true);
    setError("");
    try {
      const payload = await sessionApi.judgeChat(token, activeSession.id, {
        message: messageText,
        questionId: currentQuestion?.id,
        history,
        mode: "live_interviewer"
      });
      const reply = String(payload?.reply || "Interviewer: Give a direct answer with one quantified result.").trim();
      appendJudgeMessage("judge", reply);
      const speechText = stripSpeakerPrefix(reply) || reply;
      markAssistantSpeechGuard(speechText);
      const started = speak({ text: speechText, rate: 0.94, pitch: 0.96, lang: liveLanguage });
      if (started) {
        triggerInterviewerAct();
      }
    } catch (requestError) {
      const fallback = "Interviewer: I could not respond right now. Give a concise STAR answer with measurable impact.";
      appendJudgeMessage("judge", fallback);
      setError(requestError.message);
    } finally {
      setJudgeLoading(false);
    }
  }
  function seekAnswerVideo(second) {
    if (!answerVideoRef.current) {
      return;
    }
    answerVideoRef.current.currentTime = Math.max(0, Number(second || 0));
    answerVideoRef.current.play?.();
  }
  async function startWeakAreaDrill() {
    if (!activeSession) {
      return;
    }
    const focusAreas = deriveWeakFocusAreas(activeSession.metrics || {});
    if (!focusAreas.length) {
      setError("Not enough scored metrics yet to start a weak-area drill.");
      return;
    }
    setSaving(true);
    setError("");
    try {
      const payload = await sessionApi.create(token, {
        category: activeSession.category,
        targetRole: activeSession.targetRole || setup.targetRole || "Generalist",
        companySimulation: activeSession.companySimulation || setup.companySimulation || "Startup",
        source: "ai",
        count: 5,
        resumeText: setup.resumeText,
        jobDescriptionText: activeSession.jobDescriptionText || setup.jobDescriptionText,
        focusAreas
      });
      const normalized = {
        id: payload.sessionId,
        category: payload.category,
        targetRole: activeSession.targetRole || setup.targetRole || "Generalist",
        companySimulation: activeSession.companySimulation || setup.companySimulation || "Startup",
        status: payload.status,
        questionSource: payload.questionSource,
        focusAreas: payload.focusAreas || focusAreas,
        jobDescriptionText: activeSession.jobDescriptionText || setup.jobDescriptionText,
        questions: (payload.questions || []).map((question) => ({
          id: question.id,
          prompt: question.prompt,
          tags: question.tags,
          order: question.order,
          answer: null
        }))
      };
      setActiveSession(normalized);
      resetDraftsFromSession(normalized);
      setCurrentIndex(0);
      setFollowUps({});
      setCodingFeedbackByQuestion({});
      setJudgeThreads({});
      setJudgeInput("");
      setJudgeLoading(false);
      resetLiveConversation({ keepListening: true });
      clearUploadedAnswerVideos();
      liveSpeech.reset();
      setMessage(`Weak-area drill started on: ${focusAreas.join(", ")}.`);
      const sessionsPayload = await sessionApi.list(token);
      setSessionList(sessionsPayload.sessions || []);
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setSaving(false);
    }
  }
  async function completeSession() {
    if (!activeSession) {
      return;
    }
    setError("");
    if (!canCompleteSession) {
      const hasDraftAnswer = Boolean(
        String(currentDraft.rawText || currentDraft.transcript || currentDraft.codeSolution || "").trim()
      );
      if (!hasDraftAnswer) {
        setError("Complete session requires at least 1 submitted answer.");
        return;
      }
      const autoSubmitted = await submitAnswer({ silent: true });
      if (!autoSubmitted) {
        setError("Could not auto-submit chat answer. Please click 'Submit for AI Analysis' once.");
        return;
      }
    }
    setCompleting(true);
    exitCompletionRef.current = true;
    resetLiveConversation();
    try {
      const payload = await completeSessionRequest(activeSession.id);
      saveCompletedPracticeSession({
        user,
        sessionId: activeSession.id,
        completedAt: payload.session?.endedAt
      });
      setActiveSession((previous) => ({
        ...previous,
        status: "completed",
        metrics: payload.session.metrics,
        summary: payload.session.summary,
        overallScore: payload.session.overallScore,
        selection: payload.session.selection,
        emailNotification: payload.session.emailNotification,
        certificate: payload.session.certificate,
        endedAt: payload.session.endedAt
      }));
      const emailStatusText = formatEmailNotificationStatus(payload.session?.emailNotification?.status);
      setMessage(`Session complete: ${payload.session.overallScore}/100. Result email: ${emailStatusText}.`);
      const sessionsPayload = await sessionApi.list(token);
      setSessionList(sessionsPayload.sessions || []);
    } catch (requestError) {
      exitCompletionRef.current = false;
      setError(requestError.message);
    } finally {
      setCompleting(false);
    }
  }
  async function retryResultEmailDelivery() {
    if (!activeSession?.id) {
      return;
    }
    setEmailRetrying(true);
    setError("");
    try {
      const payload = await completeSessionRequest(activeSession.id);
      setActiveSession((previous) => previous ? {
        ...previous,
        status: payload.session?.status || previous.status,
        metrics: payload.session?.metrics || previous.metrics,
        summary: payload.session?.summary || previous.summary,
        overallScore: Number(payload.session?.overallScore ?? previous.overallScore ?? 0),
        selection: payload.session?.selection || previous.selection,
        emailNotification: payload.session?.emailNotification || previous.emailNotification,
        certificate: payload.session?.certificate || previous.certificate,
        endedAt: payload.session?.endedAt || previous.endedAt
      } : previous);
      const emailStatusText = formatEmailNotificationStatus(payload.session?.emailNotification?.status);
      setMessage(`Result email status: ${emailStatusText}.`);
    } catch (requestError) {
      setError(requestError.message || "Unable to retry result email.");
    } finally {
      setEmailRetrying(false);
    }
  }
  if (loading) {
    return <LoadingScreen label="Preparing interview room..." />;
  }
  if (securityLocked) {
    return <div className="grid min-h-[60vh] place-items-center"><section className="w-full max-w-2xl rounded-2xl border border-rose-300 bg-rose-50 p-6 text-center shadow-soft dark:border-rose-500/30 dark:bg-rose-900/20"><h2 className="font-display text-2xl font-bold text-rose-800 dark:text-rose-100">Interview Locked</h2><p className="mt-2 text-sm text-rose-700 dark:text-rose-200">{securityLockReason || "Policy violation detected during interview."}</p><p className="mt-2 text-xs text-rose-700 dark:text-rose-200">
            Session is being closed for integrity protection. Violations recorded: {securityViolationCount}.
          </p><p className="mt-3 text-xs text-slate-600 dark:text-slate-300">Redirecting to dashboard...</p></section></div>;
  }
  const inProgressSessions = sessionList.filter((session) => session.status === "in_progress");
  return <div className="grid gap-4 xl:grid-cols-[380px_minmax(0,1fr)]">{networkOffline && activeSession?.status === "in_progress" ? <div className="xl:col-span-2 rounded-xl border border-amber-300 bg-amber-50 px-4 py-2 text-sm font-semibold text-amber-800 dark:border-amber-500/30 dark:bg-amber-900/20 dark:text-amber-200">
          Network issue detected. During offline mode, clipboard/restricted shortcuts will auto-close interview. Tab switch will close interview in all modes.
        </div> : null}<motion.section initial={{ opacity: 0, x: -16 }} animate={{ opacity: 1, x: 0 }} className="rounded-2xl border border-white/30 bg-white/45 p-4 shadow-soft backdrop-blur-xl dark:border-white/10 dark:bg-slate-900/45"><h2 className="mb-3 font-display text-lg font-bold">Start Interview</h2><form onSubmit={createSession} className="grid gap-3"><label className="grid gap-1 text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
            Category
            <select value={setup.category} onChange={(event) => updateSetup("category", event.target.value)} className="rounded-xl border border-white/30 bg-white/70 px-3 py-2 text-sm dark:border-white/10 dark:bg-slate-800/70">{(meta.categories || []).map((category) => <option key={category} value={category}>{category}</option>)}</select></label><label className="grid gap-1 text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
            Target Role
            <input value={setup.targetRole} onChange={(event) => updateSetup("targetRole", event.target.value)} className="rounded-xl border border-white/30 bg-white/70 px-3 py-2 text-sm dark:border-white/10 dark:bg-slate-800/70" placeholder="Frontend Engineer" /></label><label className="grid gap-1 text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
            Company Simulation
            <select value={setup.companySimulation} onChange={(event) => updateSetup("companySimulation", event.target.value)} className="rounded-xl border border-white/30 bg-white/70 px-3 py-2 text-sm dark:border-white/10 dark:bg-slate-800/70">{(meta.companies || []).map((company) => <option key={company} value={company}>{company}</option>)}</select></label><label className="grid gap-1 text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
            Question Source
            <select value={setup.source} onChange={(event) => updateSetup("source", event.target.value)} className="rounded-xl border border-white/30 bg-white/70 px-3 py-2 text-sm dark:border-white/10 dark:bg-slate-800/70"><option value="predefined">Predefined Database</option><option value="ai">AI Generated</option><option value="resume">Resume-Based</option></select>{setup.category === "Coding" ? <span className="text-[11px] normal-case text-slate-500 dark:text-slate-300">
                Coding category works best with AI or Resume sources.
              </span> : null}</label><label className="grid gap-1 text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
            Job Description Match (Optional)
            <textarea
            rows={4}
            value={setup.jobDescriptionText}
            onChange={(event) => updateSetup("jobDescriptionText", event.target.value)}
            className="rounded-xl border border-white/30 bg-white/80 px-3 py-2 text-sm dark:border-white/10 dark:bg-slate-900/55"
            placeholder="Paste job description keywords to get fit-focused questions and scoring." />
        </label>{setup.source !== "predefined" ? <div className="grid gap-3 rounded-2xl border border-white/30 bg-white/45 p-3 dark:border-white/10 dark:bg-slate-800/40"><div><p className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                  Resume Intelligence
                </p><p className="text-xs text-slate-600 dark:text-slate-300">
                  Drop candidate resume to let AI identify skills and generate targeted questions.
                </p></div><div
            onDragOver={handleResumeDragOver}
            onDragEnter={handleResumeDragOver}
            onDragLeave={handleResumeDragLeave}
            onDrop={handleResumeDrop}
            className={[
            "rounded-xl border border-dashed p-3 text-center transition",
            resumeDragActive ? "border-brand-500 bg-brand-50/80 dark:bg-brand-900/20" : "border-white/40 bg-white/70 dark:border-white/15 dark:bg-slate-900/40"].
            join(" ")}>
            <input
              ref={resumeFileInputRef}
              type="file"
              accept=".txt,.md,.csv,.pdf,.doc,.docx,.rtf,text/plain,application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
              onChange={onResumeFileSelected}
              className="hidden" />
            <p className="text-xs font-semibold text-slate-700 dark:text-slate-100">{resumeProcessing ? "Reading resume..." : "Drag and drop resume file here"}</p><p className="mt-1 text-[11px] text-slate-500 dark:text-slate-400">
                  Recommended: TXT for best extraction quality.
                </p><button
              type="button"
              onClick={() => resumeFileInputRef.current?.click()}
              disabled={resumeProcessing}
              className="mt-3 inline-flex items-center gap-2 rounded-lg bg-brand-500 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-brand-600 disabled:opacity-60">
              <Upload size={13} />{resumeProcessing ? "Processing..." : "Choose Resume File"}</button></div>{resumeFileMeta.name ? <div className="flex items-center justify-between gap-2 rounded-xl border border-white/30 bg-white/70 px-3 py-2 dark:border-white/10 dark:bg-slate-900/45"><div className="min-w-0"><p className="truncate text-xs font-semibold text-slate-700 dark:text-slate-100"><FileText size={12} className="mr-1 inline-block align-middle" />{resumeFileMeta.name}</p><p className="text-[11px] text-slate-500 dark:text-slate-400">{formatBytes(resumeFileMeta.size)}</p></div><button
              type="button"
              onClick={clearResumeUpload}
              className="inline-flex items-center gap-1 rounded-lg bg-white/75 px-2 py-1 text-[11px] font-semibold text-slate-700 transition hover:bg-white dark:bg-slate-700/60 dark:text-slate-100">
              <X size={12} />
                    Clear
                  </button></div> : null}<label className="grid gap-1 text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                Resume Text (AI Input)
                <textarea
              rows={5}
              value={setup.resumeText}
              onChange={(event) => updateSetup("resumeText", event.target.value)}
              className="rounded-xl border border-white/30 bg-white/80 px-3 py-2 text-sm dark:border-white/10 dark:bg-slate-900/55"
              placeholder="Paste resume highlights, skills, project stack, and achievements." />
          </label><div className="grid gap-2"><p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                  Skills detected for AI questioning
                </p>{resumeSkills.length ? <div className="flex flex-wrap gap-2">{resumeSkills.map((skill) => <span
                key={skill}
                className="rounded-full border border-brand-200 bg-brand-50 px-2 py-1 text-[11px] font-semibold text-brand-700 dark:border-brand-500/40 dark:bg-brand-900/20 dark:text-brand-200">
                {skill}</span>)}</div> : <p className="text-xs text-slate-500 dark:text-slate-300">
                    Upload or paste resume text to preview what AI recognizes as candidate skills.
                  </p>}</div></div> : null}<button type="submit" disabled={saving || resumeProcessing} className="inline-flex items-center justify-center gap-2 rounded-xl bg-brand-500 px-4 py-2 text-sm font-semibold text-white transition hover:bg-brand-600 disabled:opacity-60"><Wand2 size={16} />{saving ? "Creating..." : resumeProcessing ? "Processing Resume..." : "Create Interview Session"}</button></form><div className="mt-5 border-t border-white/20 pt-4 dark:border-white/10"><h3 className="mb-2 text-sm font-bold">Continue In Progress</h3><div className="grid gap-2">{inProgressSessions.slice(0, 6).map((session) => <button key={session.id} type="button" onClick={() => openSession(session.id)} className="rounded-xl border border-white/25 bg-white/45 px-3 py-2 text-left text-xs transition hover:bg-white/70 dark:border-white/10 dark:bg-slate-800/45 dark:hover:bg-slate-700/60"><p className="font-semibold">{session.category} - {session.targetRole}</p><p className="text-slate-500 dark:text-slate-300">{session.answeredCount}/{session.questionsCount} answered</p></button>)}{!inProgressSessions.length ? <p className="text-xs text-slate-500 dark:text-slate-300">No active sessions yet.</p> : null}</div></div></motion.section><motion.section initial={{ opacity: 0, x: 16 }} animate={{ opacity: 1, x: 0 }} className="rounded-2xl border border-white/30 bg-white/45 p-4 shadow-soft backdrop-blur-xl dark:border-white/10 dark:bg-slate-900/45">{activeSession && currentQuestion ? <div className="grid gap-4"><div className="flex flex-wrap items-center justify-between gap-2"><div className="flex flex-wrap items-center gap-2"><Badge>{activeSession.category}</Badge><Badge>{activeSession.questionSource}</Badge><Badge>Question {currentIndex + 1}/{activeSession.questions.length}</Badge></div><div className="w-40 overflow-hidden rounded-full bg-white/50 dark:bg-slate-800/60"><div className="h-2 bg-brand-500 transition-all" style={{ width: `${progress.percent}%` }} /></div></div>{message ? <p className="rounded-xl bg-emerald-100 px-3 py-2 text-xs font-semibold text-emerald-700">{message}</p> : null}{error ? <p className="rounded-xl bg-rose-100 px-3 py-2 text-xs font-semibold text-rose-700">{error}</p> : null}{speechError ? <p className="rounded-xl bg-amber-100 px-3 py-2 text-xs font-semibold text-amber-800">{speechError}</p> : null}{voiceActivityError ? <p className="rounded-xl bg-amber-100 px-3 py-2 text-xs font-semibold text-amber-800">{voiceActivityError}</p> : null}{webcamError ? <p className="rounded-xl bg-amber-100 px-3 py-2 text-xs font-semibold text-amber-800">{webcamError}</p> : null}<div className="grid gap-3 lg:grid-cols-2"><div><AvatarInterviewer speaking={interviewerActing} speakingVisualSrc={AI_SPEAKING_VISUAL_SRC} /></div><div className="relative h-[220px] overflow-hidden rounded-[30px] border border-white/40 bg-gradient-to-br from-slate-100/75 via-white/70 to-cyan-100/70 shadow-glass sm:h-[300px] dark:border-white/15 dark:from-slate-900 dark:via-slate-900/90 dark:to-slate-950"><div className="absolute inset-x-0 top-0 z-10 flex items-center justify-between border-b border-white/30 bg-white/65 px-3 py-2 backdrop-blur-md dark:border-white/10 dark:bg-slate-900/45"><div><p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-slate-500 dark:text-slate-400">
                      Candidate Camera
                    </p><p className="font-display text-sm font-semibold text-slate-800 dark:text-slate-100">Face to Face</p></div><button
                type="button"
                onClick={toggleWebcam}
                disabled={webcamLoading}
                className="inline-flex items-center gap-1 rounded-full bg-brand-500 px-2.5 py-1 text-[11px] font-semibold text-white transition hover:bg-brand-600 disabled:opacity-60">
                {webcamOn ? <CameraOff size={12} /> : <Camera size={12} />}{webcamLoading ? "Starting..." : webcamOn ? "Stop Cam" : "Start Cam"}</button></div><div className="h-full w-full pt-12">{webcamOn ? <video
                ref={webcamVideoRef}
                autoPlay
                muted
                playsInline
                className="h-full w-full object-cover"
                style={{ transform: "scaleX(-1)" }} /> :
              <div className="grid h-full w-full place-items-center px-4 text-center"><div><p className="text-sm font-semibold text-slate-700 dark:text-slate-200">
                          Camera is {webcamLoading ? "starting..." : "off"}</p><p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                          Turn on webcam to practice face-to-face delivery.
                        </p></div></div>}</div></div></div><div className="rounded-2xl border border-white/30 bg-white/55 p-4 dark:border-white/10 dark:bg-slate-800/45"><div className="flex flex-wrap items-center justify-between gap-2"><h3 className="font-display text-lg font-bold">Virtual Interviewer Prompt</h3><div className="flex items-center gap-2"><button
                type="button"
                onClick={() => {
                  const promptSpeech = stripSpeakerPrefix(currentQuestion.prompt) || currentQuestion.prompt;
                  if (liveConversationOn) {
                    markAssistantSpeechGuard(promptSpeech);
                  }
                  const started = speak({
                    text: promptSpeech,
                    rate: 0.95,
                    pitch: 1.02,
                    lang: liveConversationOn ? liveLanguage : "en-US"
                  });
                  triggerInterviewerAct();
                  if (!started && !speechEnabled) {
                    setError("Speech is unavailable in this browser. The interviewer visual will still animate.");
                  }
                }}
                className="inline-flex items-center gap-2 rounded-xl bg-brand-500 px-3 py-2 text-xs font-semibold text-white">
                <Volume2 size={14} /> Ask Question
                  </button><button type="button" onClick={() => setAutoSpeak((previous) => !previous)} className="rounded-xl bg-white/65 px-3 py-2 text-xs font-semibold text-slate-700 dark:bg-slate-700/60 dark:text-slate-100">
                    Auto voice: {autoSpeak ? "On" : "Off"}</button><button
                type="button"
                onClick={toggleLiveConversation}
                disabled={!liveSpeech.supported || judgeLoading}
                className={[
                "rounded-xl px-3 py-2 text-xs font-semibold transition disabled:opacity-60",
                liveConversationOn ? "bg-emerald-500 text-white hover:bg-emerald-600" : "bg-slate-900 text-white hover:bg-slate-800 dark:bg-slate-100 dark:text-slate-900 dark:hover:bg-slate-200"].
                join(" ")}>
                {liveConversationOn ? "Live Interview: On" : "Start Live Interview"}</button><button
                type="button"
                onClick={() => setFullDuplexOn((previous) => !previous)}
                className={[
                "rounded-xl px-3 py-2 text-xs font-semibold transition",
                fullDuplexOn ? "bg-cyan-600 text-white hover:bg-cyan-700" : "bg-white/75 text-slate-700 hover:bg-white dark:bg-slate-700/60 dark:text-slate-100"].
                join(" ")}>
                
                    Full Duplex: {fullDuplexOn ? "On" : "Off"}</button><select
                value={liveLanguage}
                onChange={(event) => setLiveLanguage(event.target.value)}
                disabled={liveConversationOn}
                className="rounded-xl border border-white/30 bg-white/80 px-2 py-2 text-xs font-semibold text-slate-700 outline-none disabled:opacity-60 dark:border-white/10 dark:bg-slate-900/65 dark:text-slate-100">
                {LIVE_INTERVIEW_LANGUAGES.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}</select></div></div><p className="mt-3 text-sm leading-relaxed text-slate-700 dark:text-slate-100">{currentQuestion.prompt}</p><p className="mt-2 text-xs font-semibold text-slate-600 dark:text-slate-300">{liveConversationOn ? `${liveConversationStatus} Mode: ${fullDuplexOn ? "full duplex" : "turn-by-turn"} | Language: ${liveLanguageLabel}.` : "Enable live interviewer mode for automatic AI <-> user conversation."}</p></div><div className="rounded-2xl border border-white/30 bg-white/55 p-4 dark:border-white/10 dark:bg-slate-800/45"><div className="flex flex-wrap items-center justify-between gap-2"><h3 className="inline-flex items-center gap-2 font-display text-lg font-bold"><MessageSquare size={18} />
                  Live AI Interviewer
                </h3><span className="rounded-full bg-white/70 px-3 py-1 text-[11px] font-semibold text-slate-700 dark:bg-slate-700/60 dark:text-slate-100">{judgeLoading ? "Interviewer is thinking..." : "Interactive panel"}</span></div><div className="mt-3 max-h-44 space-y-2 overflow-y-auto rounded-xl border border-white/25 bg-white/70 p-3 dark:border-white/10 dark:bg-slate-900/35">{currentJudgeMessages.length ? currentJudgeMessages.map((item) => <div key={item.id} className={item.role === "user" ? "text-right" : "text-left"}><span
                className={[
                "inline-block max-w-[90%] whitespace-pre-wrap rounded-xl px-3 py-2 text-xs",
                item.role === "user" ? "bg-brand-500 text-white" : "bg-white text-slate-800 dark:bg-slate-700 dark:text-slate-100"].
                join(" ")}>
                {item.text}</span></div>) : <p className="text-xs text-slate-500 dark:text-slate-300">Ask the interviewer for realistic follow-ups, clarity, or coaching feedback.</p>}</div><div className="mt-3 flex gap-2"><input
              value={judgeInput}
              onChange={(event) => setJudgeInput(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter" && !event.shiftKey) {
                  event.preventDefault();
                  sendJudgeMessage();
                }
              }}
              placeholder="Ask the AI interviewer..."
              className="flex-1 rounded-xl border border-white/30 bg-white/80 px-3 py-2 text-sm dark:border-white/10 dark:bg-slate-900/60" />
            <button
              type="button"
              onClick={sendJudgeMessage}
              disabled={judgeLoading}
              className="inline-flex items-center gap-2 rounded-xl bg-slate-800 px-3 py-2 text-xs font-semibold text-white disabled:opacity-60 dark:bg-slate-200 dark:text-slate-900">
              <Send size={14} />
                  Send
                </button></div></div><div className="rounded-2xl border border-white/30 bg-white/55 p-4 dark:border-white/10 dark:bg-slate-800/45"><textarea
            rows={7}
            value={currentDraft.rawText}
            onChange={(event) => updateDraft(currentQuestion.id, { rawText: event.target.value })}
            className="w-full rounded-xl border border-white/30 bg-white/80 px-3 py-2 text-sm dark:border-white/10 dark:bg-slate-900/60"
            placeholder="Type your response... (Hindi/English both allowed)" />
          <div className="mt-3 rounded-xl border border-white/25 bg-white/70 p-3 dark:border-white/10 dark:bg-slate-900/35"><div className="flex flex-wrap items-center gap-2"><button
                type="button"
                onClick={() => liveSpeech.listening ? liveSpeech.stop() : liveSpeech.start({ lang: liveLanguage })}
                className="inline-flex items-center gap-2 rounded-lg bg-slate-800 px-3 py-1.5 text-xs font-semibold text-white dark:bg-slate-100 dark:text-slate-900"
                disabled={!liveSpeech.supported || liveConversationOn}>
                {liveSpeech.listening ? <MicOff size={13} /> : <Mic size={13} />}{liveConversationOn ? "Live Interview controls STT" : liveSpeech.listening ? "Stop Live STT" : "Start Live STT"}</button><button
                type="button"
                onClick={applyLiveTranscriptToDraft}
                className="rounded-lg bg-brand-500 px-3 py-1.5 text-xs font-semibold text-white">
                
                    Use Transcript in Answer
                  </button><button
                type="button"
                onClick={liveSpeech.reset}
                className="rounded-lg bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 dark:bg-slate-700 dark:text-slate-100">
                
                    Reset STT
                  </button></div><p className="mt-2 text-xs text-slate-600 dark:text-slate-300">
                  Live STT: {liveSpeech.listening ? "Listening..." : "Idle"} ({liveLanguageLabel}) | WPM {liveSpeech.wordsPerMinute || 0} | Fillers {liveSpeech.fillerCount} | Pauses {liveSpeech.pauseCount}</p>{liveSpeech.error ? <p className="mt-1 text-xs font-semibold text-rose-700">{liveSpeech.error}</p> : null}{liveSpeech.fullTranscript ? <p className="mt-2 rounded-lg bg-white/70 p-2 text-xs text-slate-700 dark:bg-slate-900/45 dark:text-slate-200">{liveSpeech.fullTranscript}</p> : null}<div className="mt-2 grid gap-1 text-xs text-slate-700 dark:text-slate-200">{speechCoachingTips.map((tip) => <p key={tip}>- {tip}</p>)}</div></div><div className="mt-3 rounded-xl border border-white/25 bg-white/70 p-3 dark:border-white/10 dark:bg-slate-900/35"><p className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-300">STAR Coach</p><p className="mt-1 text-sm">
                  STAR Completeness: <strong>{starCoverage.score}/100</strong></p><div className="mt-2 grid gap-1 text-xs">{missingStarParts.length ? missingStarParts.map((item) => <p key={item}>- {item}</p>) : <p>All STAR sections are present.</p>}</div></div>{["Technical", "Coding"].includes(activeSession.category) ? <div className="mt-3 rounded-xl border border-white/25 bg-white/70 p-3 dark:border-white/10 dark:bg-slate-900/35"><p className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-300">Coding Round (Beta)</p><textarea
              rows={6}
              value={currentDraft.codeSolution || ""}
              onChange={(event) => updateDraft(currentQuestion.id, { codeSolution: event.target.value })}
              className="mt-2 w-full rounded-xl border border-white/30 bg-white/80 px-3 py-2 font-mono text-xs dark:border-white/10 dark:bg-slate-900/60"
              placeholder="Paste your code solution here..." />
            <button
              type="button"
              onClick={evaluateCodingRound}
              className="mt-2 inline-flex items-center gap-2 rounded-lg bg-indigo-600 px-3 py-1.5 text-xs font-semibold text-white">
              <Code2 size={13} />
                    Evaluate Coding Solution
                  </button>{codingFeedback ? <div className="mt-2 rounded-lg bg-indigo-50 p-2 text-xs text-indigo-900 dark:bg-indigo-900/20 dark:text-indigo-100"><p className="font-semibold">Coding Score: {codingFeedback.overall}/100</p>{codingFeedback.tips.map((tip) => <p key={tip}>- {tip}</p>)}</div> : null}</div> : null}<div className="mt-4 flex flex-wrap items-center gap-2"><button type="button" onClick={submitAnswer} disabled={saving} className="inline-flex items-center gap-2 rounded-xl bg-emerald-500 px-4 py-2 text-sm font-semibold text-white transition hover:bg-emerald-600 disabled:opacity-60"><Sparkles size={14} /> {saving ? "Analyzing..." : "Submit for AI Analysis"}</button><button
              type="button"
              onClick={requestFollowUpQuestion}
              disabled={followUpLoading}
              className="rounded-xl bg-violet-600 px-3 py-2 text-xs font-semibold text-white">
              {followUpLoading ? "Generating..." : "Generate Follow-up"}</button><button type="button" onClick={() => setCurrentIndex((index) => Math.max(0, index - 1))} className="rounded-xl bg-white/70 px-3 py-2 text-xs font-semibold text-slate-700 dark:bg-slate-700/60 dark:text-slate-100">Previous</button><button type="button" onClick={() => setCurrentIndex((index) => Math.min(activeSession.questions.length - 1, index + 1))} className="rounded-xl bg-white/70 px-3 py-2 text-xs font-semibold text-slate-700 dark:bg-slate-700/60 dark:text-slate-100">Next</button><button type="button" onClick={completeSession} disabled={!canCompleteSession || completing} className="inline-flex items-center gap-2 rounded-xl bg-brand-500 px-4 py-2 text-sm font-semibold text-white transition hover:bg-brand-600 disabled:opacity-60"><CheckCircle2 size={14} /> {completing ? "Completing..." : canCompleteSession ? "Complete Session" : "Answer 1 First"}</button></div><p className="mt-2 text-xs text-slate-600 dark:text-slate-300">
              Completion unlock: at least 1 submitted answer required ({progress.answered}/{progress.total} done).
            </p>{currentFollowUp ? <div className="mt-3 rounded-xl border border-violet-200 bg-violet-50 p-3 text-sm text-violet-900 dark:border-violet-500/30 dark:bg-violet-900/20 dark:text-violet-100"><p className="font-semibold">Dynamic Follow-up Question</p><p className="mt-1">{currentFollowUp}</p></div> : null}<div className="mt-3 rounded-xl border border-white/25 bg-white/70 p-3 dark:border-white/10 dark:bg-slate-900/35"><p className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-300">Video Review Timeline</p><div className="mt-2 flex flex-wrap items-center gap-2"><button
                type="button"
                onClick={startAnswerRecording}
                disabled={answerRecorder.recording || saving}
                className="inline-flex items-center gap-2 rounded-lg bg-brand-500 px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-60">
                <Camera size={13} />{answerRecorder.recording ? "Recording..." : "Start Recording"}</button><button
                type="button"
                onClick={stopAnswerRecording}
                disabled={!answerRecorder.recording}
                className="inline-flex items-center gap-2 rounded-lg bg-rose-600 px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-60">
                <MicOff size={13} />
                    Stop
                  </button><button
                type="button"
                onClick={() => clearRecordedAnswerMedia()}
                disabled={!recordedAnswerMedia}
                className="inline-flex items-center gap-2 rounded-lg bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 disabled:opacity-60 dark:bg-slate-700 dark:text-slate-100">
                <X size={13} />
                    Clear Recorded
                  </button></div><p className="mt-2 text-xs text-slate-600 dark:text-slate-300">
                  Recorder: {answerRecorder.recording ? "Recording..." : recordedAnswerMedia ? "Ready" : "Idle"} | Duration{" "}{Math.max(0, Number(recordedAnswerMedia?.durationSec || answerRecorder.durationSec || 0))}s
                </p>{answerRecorder.error ? <p className="mt-1 text-xs font-semibold text-rose-700">{answerRecorder.error}</p> : null}<input type="file" accept="video/*" onChange={onAnswerVideoSelected} className="mt-2 text-xs" />{uploadedAnswerVideoUrl ? <div className="mt-2"><video ref={answerVideoRef} src={uploadedAnswerVideoUrl} controls className="h-52 w-full rounded-lg object-contain bg-slate-950" />{currentQuestion.answer?.timelineMarkers?.length ? <div className="mt-2 flex flex-wrap gap-2">{currentQuestion.answer.timelineMarkers.map((marker, index) => <button
                  key={`${marker.second}-${index}`}
                  type="button"
                  onClick={() => seekAnswerVideo(marker.second)}
                  className="rounded-full bg-slate-800 px-2 py-1 text-[11px] font-semibold text-white dark:bg-slate-200 dark:text-slate-900">
                  {marker.second}s
                          </button>)}</div> : null}</div> : null}</div>{currentQuestion.answer ? <div className="mt-4 rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-900 dark:border-emerald-700/30 dark:bg-emerald-900/20 dark:text-emerald-100"><p className="font-bold">AI Score: {currentQuestion.answer.aiScores.overall}/100</p><p>
                    Confidence {currentQuestion.answer.aiScores.confidence} - Communication{" "}{currentQuestion.answer.aiScores.communication ?? currentQuestion.answer.aiScores.clarity} - Grammar{" "}{currentQuestion.answer.aiScores.grammar ?? "-"} - Technical Accuracy{" "}{currentQuestion.answer.aiScores.technicalAccuracy ?? currentQuestion.answer.aiScores.relevance} - Speaking Speed{" "}{currentQuestion.answer.aiScores.speakingSpeed} - Facial Expression{" "}{currentQuestion.answer.aiScores.facialExpression}</p></div> : null}</div>{activeSession.status === "completed" ? <div className="rounded-2xl border border-brand-200 bg-brand-50/80 p-4 dark:border-brand-700/40 dark:bg-brand-900/30"><div className="flex flex-wrap items-center justify-between gap-2"><h4 className="font-display text-lg font-bold">Session Result: {activeSession.overallScore}/100</h4><div className="flex flex-wrap gap-2"><button
                type="button"
                onClick={() => saveInterviewReportPdf(
                  {
                    session: activeSession,
                    questions: activeSession.questions || []
                  },
                  user?.name
                )}
                className="inline-flex items-center gap-2 rounded-xl bg-slate-800 px-3 py-2 text-xs font-semibold text-white transition hover:bg-slate-700 dark:bg-slate-200 dark:text-slate-900 dark:hover:bg-slate-300">
                <FileText size={14} />
                      Download Feedback Report
                    </button><button
                type="button"
                onClick={startWeakAreaDrill}
                className="inline-flex items-center gap-2 rounded-xl bg-violet-600 px-3 py-2 text-xs font-semibold text-white">
                <Wand2 size={14} />
                      Start Weak-Area Drill
                    </button><button
                type="button"
                onClick={() => saveInterviewCertificatePdf({ name: user?.name, session: activeSession })}
                className="inline-flex items-center gap-2 rounded-xl bg-emerald-500 px-3 py-2 text-xs font-semibold text-white transition hover:bg-emerald-600">
                <Award size={14} />
                      Download Certificate
                    </button><button
                type="button"
                onClick={retryResultEmailDelivery}
                disabled={emailRetrying}
                className="inline-flex items-center gap-2 rounded-xl bg-cyan-600 px-3 py-2 text-xs font-semibold text-white transition hover:bg-cyan-700 disabled:opacity-60">
                <Send size={14} />
                      {emailRetrying ? "Retrying Email..." : "Send Result Email Again"}
                    </button></div></div><p className="mt-2 text-sm font-semibold">AI Recommendation</p><p className="mt-1 text-sm">{activeSession.summary?.recommendation || "Keep practicing to improve consistency."}</p><div className="mt-3 rounded-xl border border-slate-200/80 bg-white/70 p-3 text-sm dark:border-white/10 dark:bg-slate-900/35"><p className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-300">
                    Selection Result
                  </p><p className={`mt-1 font-semibold ${sessionSelection.selected ? "text-emerald-700 dark:text-emerald-300" : "text-rose-700 dark:text-rose-300"}`}>
                    {sessionSelection.statusLabel}
                  </p><p className="mt-1 text-xs text-slate-600 dark:text-slate-300">
                    Cutoff: {sessionSelection.cutoffScore}/100 | Score: {activeSession.overallScore || 0}/100
                  </p><p className="mt-2 text-xs text-slate-600 dark:text-slate-300">
                    Email ({emailNotificationMeta.statusLabel}): {emailNotificationMeta.recipientEmail || "No login email found"}
                  </p>{emailNotificationMeta.error ? <p className="mt-1 text-xs font-semibold text-rose-700 dark:text-rose-300">
                      Email issue: {emailNotificationMeta.error}
                    </p> : null}</div>{activeSession.summary?.jobFitScore ? <p className="mt-2 text-sm">
                    Job Description Fit: <strong>{activeSession.summary.jobFitScore}/100</strong></p> : null}{activeSession.certificate?.id ? <div className="mt-2 rounded-lg bg-white/70 p-2 text-xs text-slate-700 dark:bg-slate-900/35 dark:text-slate-200"><p>
                      Certificate ID: <strong>{activeSession.certificate.id}</strong></p>{activeSession.certificate.verificationUrl ? <><p className="truncate">Verify: {activeSession.certificate.verificationUrl}</p><img
                src={`https://api.qrserver.com/v1/create-qr-code/?size=120x120&data=${encodeURIComponent(
                  activeSession.certificate.verificationUrl
                )}`}
                alt="Certificate verification QR"
                className="mt-2 h-20 w-20 rounded border border-white/30 bg-white" />
            </> : null}</div> : null}<div className="mt-3 rounded-xl border border-brand-200/70 bg-white/70 p-3 text-sm dark:border-brand-500/30 dark:bg-slate-900/30"><p className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-300">
                    What to Improve
                  </p><div className="mt-2 grid gap-1">{(improvementPlan.length ? improvementPlan : ["Keep practicing consistently across categories."]).map((item) => <p key={item}>- {item}</p>)}</div></div>{topAnsweredQuestion ? <div className="mt-3 rounded-xl border border-emerald-200/70 bg-emerald-50/70 p-3 text-sm text-emerald-900 dark:border-emerald-700/40 dark:bg-emerald-900/20 dark:text-emerald-100"><p className="font-semibold">Best Answer This Session</p><p className="mt-1">Q{topAnsweredQuestion.order}: {topAnsweredQuestion.prompt}</p><p className="mt-1">Score: {topAnsweredQuestion.answer?.aiScores?.overall || 0}/100</p></div> : null}</div> : null}</div> : <div className="grid min-h-[300px] place-items-center rounded-2xl border border-dashed border-white/30 bg-white/45 p-6 text-center dark:border-white/10 dark:bg-slate-900/40"><div><h3 className="font-display text-lg font-bold">No active interview yet</h3><p className="mt-2 text-sm text-slate-600 dark:text-slate-300">Configure your interview on the left and create a session to start practicing.</p></div></div>}</motion.section></div>;
}
