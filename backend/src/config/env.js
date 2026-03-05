const path = require("path");
const fs = require("fs");
const dotenv = require("dotenv");
const backendLocalEnvPath = path.join(__dirname, "..", "..", ".env.local");
const backendEnvPath = path.join(__dirname, "..", "..", ".env");
const rootLocalEnvPath = path.join(__dirname, "..", "..", "..", ".env.local");
const rootEnvPath = path.join(__dirname, "..", "..", "..", ".env");
dotenv.config({ path: backendLocalEnvPath });
dotenv.config({ path: backendEnvPath });
dotenv.config({ path: rootLocalEnvPath });
dotenv.config({ path: rootEnvPath });
function parseEnvFile(filePath) {
  try {
    if (!fs.existsSync(filePath)) {
      return {};
    }
    const raw = fs.readFileSync(filePath, "utf8");
    return dotenv.parse(raw);
  } catch {
    return {};
  }
}
const parsedBackendLocalEnv = parseEnvFile(backendLocalEnvPath);
const parsedBackendEnv = parseEnvFile(backendEnvPath);
const parsedRootLocalEnv = parseEnvFile(rootLocalEnvPath);
const parsedRootEnv = parseEnvFile(rootEnvPath);
function normalizeEnvValue(value) {
  return String(value || "").trim().replace(/^"(.*)"$/, "$1").replace(/^'(.*)'$/, "$1").trim();
}
function getFirstDefinedEnv(keys, fallback = "") {
  for (const key of keys) {
    const processValue = normalizeEnvValue(process.env[key]);
    if (processValue) {
      return processValue;
    }
    const backendLocalFileValue = normalizeEnvValue(parsedBackendLocalEnv[key]);
    if (backendLocalFileValue) {
      return backendLocalFileValue;
    }
    const backendFileValue = normalizeEnvValue(parsedBackendEnv[key]);
    if (backendFileValue) {
      return backendFileValue;
    }
    const rootLocalFileValue = normalizeEnvValue(parsedRootLocalEnv[key]);
    if (rootLocalFileValue) {
      return rootLocalFileValue;
    }
    const rootFileValue = normalizeEnvValue(parsedRootEnv[key]);
    if (rootFileValue) {
      return rootFileValue;
    }
  }
  return fallback;
}
function parseCsvList(value, fallbackList) {
  const parsed = normalizeEnvValue(value).split(",").map((item) => item.trim()).filter(Boolean);
  if (parsed.length > 0) {
    return parsed;
  }
  return fallbackList;
}
const env = {
  nodeEnv: getFirstDefinedEnv(["NODE_ENV"], "development"),
  port: Number(getFirstDefinedEnv(["PORT"], "5000")),
  mongoUri: getFirstDefinedEnv(["MONGODB_URI"], "mongodb://127.0.0.1:27017/ai_interview_platform"),
  mongoFallbackUri: getFirstDefinedEnv(["MONGODB_FALLBACK_URI"], "mongodb://127.0.0.1:27017/ai_interview_platform"),
  mongoAllowFallback: !/^false$/i.test(getFirstDefinedEnv(["MONGODB_ALLOW_FALLBACK"], "true")),
  mongoIpFamily: (() => {
    const parsed = Number(getFirstDefinedEnv(["MONGO_IP_FAMILY"], "4"));
    return parsed === 4 || parsed === 6 ? parsed : 4;
  })(),
  jwtSecret: getFirstDefinedEnv(["JWT_SECRET"], "dev-secret-change-me"),
  jwtExpiresIn: getFirstDefinedEnv(["JWT_EXPIRES_IN"], "7d"),
  sessionSecret: getFirstDefinedEnv(["SESSION_SECRET", "JWT_SECRET"], "dev-session-secret-change-me"),
  backendBaseUrl: getFirstDefinedEnv(["BACKEND_BASE_URL"], "http://localhost:5000"),
  frontendOrigin: getFirstDefinedEnv(["FRONTEND_ORIGIN"], "http://localhost:5173"),
  googleOAuthClientId: getFirstDefinedEnv([
  "GOOGLE_OAUTH_CLIENT_ID",
  "GOOGLE_CLIENT_ID",
  "GOOGLE_OAUTH_CLIENTID",
  "GOOGLE_CLIENTID"]
  ),
  googleOAuthClientSecret: getFirstDefinedEnv([
  "GOOGLE_OAUTH_CLIENT_SECRET",
  "GOOGLE_CLIENT_SECRET",
  "GOOGLE_OAUTH_CLIENTSECRET",
  "GOOGLE_CLIENTSECRET"]
  ),
  googleOAuthScopes: parseCsvList(getFirstDefinedEnv(["GOOGLE_OAUTH_SCOPES"]), ["profile", "email"]),
  linkedinOAuthClientId: getFirstDefinedEnv([
  "LINKEDIN_OAUTH_CLIENT_ID",
  "LINKEDIN_CLIENT_ID",
  "LINKEDIN_OAUTH_CLIENTID",
  "LINKEDIN_CLIENTID",
  "LINKEDIN_KEY"]
  ),
  linkedinOAuthClientSecret: getFirstDefinedEnv([
  "LINKEDIN_OAUTH_CLIENT_SECRET",
  "LINKEDIN_CLIENT_SECRET",
  "LINKEDIN_OAUTH_CLIENTSECRET",
  "LINKEDIN_CLIENTSECRET",
  "LINKEDIN_SECRET"]
  ),
  linkedinOAuthScopes: parseCsvList(getFirstDefinedEnv(["LINKEDIN_OAUTH_SCOPES"]), ["r_liteprofile", "r_emailaddress"]),
  googleAiApiKey: getFirstDefinedEnv(["GOOGLE_AI_API_KEY"]),
  googleAiModel: getFirstDefinedEnv(["GOOGLE_AI_MODEL"], "gemini-1.5-flash"),
  googleAiModels: normalizeEnvValue(getFirstDefinedEnv(["GOOGLE_AI_MODELS"])).split(",").map((item) => item.trim()).filter(Boolean),
  googleAiTimeoutMs: Number(getFirstDefinedEnv(["GOOGLE_AI_TIMEOUT_MS"], "12000")),
  openAiApiKey: getFirstDefinedEnv(["OPENAI_API_KEY"]),
  openAiBaseUrl: getFirstDefinedEnv(["OPENAI_BASE_URL"], "https://api.openai.com/v1"),
  openAiChatModel: getFirstDefinedEnv(["OPENAI_CHAT_MODEL", "OPENAI_EVALUATION_MODEL"], "gpt-4o-mini"),
  openAiWhisperModel: getFirstDefinedEnv(["OPENAI_WHISPER_MODEL"], "whisper-1"),
  openAiEvaluationModel: getFirstDefinedEnv(["OPENAI_EVALUATION_MODEL"], "gpt-4o-mini"),
  openAiTranscriptionLanguage: getFirstDefinedEnv(["OPENAI_TRANSCRIPTION_LANGUAGE"]),
  openAiTimeoutMs: Number(getFirstDefinedEnv(["OPENAI_TIMEOUT_MS"], "20000")),
  openAiMaxRetries: Math.max(1, Number(getFirstDefinedEnv(["OPENAI_MAX_RETRIES"], "3"))),
  interviewResultEmailEnabled: /^true$/i.test(getFirstDefinedEnv(["INTERVIEW_RESULT_EMAIL_ENABLED"], "true")),
  interviewResultEmailDelayMs: Math.max(0, Number(getFirstDefinedEnv(["INTERVIEW_RESULT_EMAIL_DELAY_MS"], "5000"))),
  interviewSelectionThreshold: Math.max(0, Math.min(100, Number(getFirstDefinedEnv(["INTERVIEW_SELECTION_THRESHOLD"], "70")))),
  emailProvider: getFirstDefinedEnv(["EMAIL_PROVIDER"], "resend"),
  emailFromName: getFirstDefinedEnv(["EMAIL_FROM_NAME"], "AI Interview Platform"),
  emailFromAddress: getFirstDefinedEnv(["EMAIL_FROM_ADDRESS"], ""),
  resendApiKey: getFirstDefinedEnv(["RESEND_API_KEY"], ""),
  resendApiUrl: getFirstDefinedEnv(["RESEND_API_URL"], "https://api.resend.com"),
  supportRequestEmailEnabled: !/^false$/i.test(getFirstDefinedEnv(["SUPPORT_REQUEST_EMAIL_ENABLED"], "true")),
  supportRequestToEmail: getFirstDefinedEnv(["SUPPORT_REQUEST_TO_EMAIL", "SUPPORT_ADMIN_EMAIL", "SUPPORT_EMAIL"], ""),
  speechToTextApiUrl: getFirstDefinedEnv(["SPEECH_TO_TEXT_API_URL"]),
  speechToTextApiKey: getFirstDefinedEnv(["SPEECH_TO_TEXT_API_KEY"]),
  nlpEvaluationApiUrl: getFirstDefinedEnv(["NLP_EVALUATION_API_URL"]),
  nlpEvaluationApiKey: getFirstDefinedEnv(["NLP_EVALUATION_API_KEY"]),
  paymentUpiId: getFirstDefinedEnv(["PAYMENT_UPI_ID"], "6372516197-2@ibl"),
  paymentMerchantName: getFirstDefinedEnv(["PAYMENT_MERCHANT_NAME"], "AI Interview Platform"),
  paymentQrProvider: getFirstDefinedEnv(["PAYMENT_QR_PROVIDER"], "https://api.qrserver.com/v1/create-qr-code/"),
  adminUsersGoogleSheetUrl: getFirstDefinedEnv(["ADMIN_USERS_GOOGLE_SHEET_URL"]),
  adminUsersGoogleSheetId: getFirstDefinedEnv(["ADMIN_USERS_GOOGLE_SHEET_ID"]),
  adminUsersGoogleSheetRange: getFirstDefinedEnv(["ADMIN_USERS_GOOGLE_SHEET_RANGE"], "Users!A1"),
  adminUsersGoogleSheetClearRange: getFirstDefinedEnv(["ADMIN_USERS_GOOGLE_SHEET_CLEAR_RANGE"], "Users!A1:ZZ"),
  googleServiceAccountEmail: getFirstDefinedEnv(["GOOGLE_SERVICE_ACCOUNT_EMAIL"]),
  googleServiceAccountPrivateKey: getFirstDefinedEnv(["GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY"]),
  googleServiceAccountTokenUri: getFirstDefinedEnv(["GOOGLE_SERVICE_ACCOUNT_TOKEN_URI"], "https://oauth2.googleapis.com/token")
};
module.exports = { env };
