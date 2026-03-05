function isLocalHostname(hostname = "") {
  const normalized = String(hostname || "").trim().toLowerCase();
  return normalized === "localhost" || normalized === "127.0.0.1";
}

function normalizeApiBase(base = "") {
  return String(base || "").trim().replace(/\/+$/, "");
}

function shouldIgnoreConfiguredApiBase(configuredBase) {
  if (!configuredBase || typeof window === "undefined") {
    return false;
  }

  if (isLocalHostname(window.location.hostname)) {
    return false;
  }

  try {
    const parsed = new URL(configuredBase);
    return isLocalHostname(parsed.hostname);
  } catch {
    return /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?(\/|$)/i.test(String(configuredBase));
  }
}

function getApiBase() {
  const configured = normalizeApiBase(import.meta.env.VITE_API_BASE || "");
  if (configured && !shouldIgnoreConfiguredApiBase(configured)) {
    return configured;
  }
  if (typeof window !== "undefined") {
    const { protocol, hostname } = window.location;
    if (isLocalHostname(hostname)) {
      return `${protocol}//${hostname}:5000/api`;
    }
    return `${protocol}//${hostname}/api`;
  }
  return "/api";
}
const API_BASE = getApiBase();
const API_CACHE_PREFIX = "ai_interview_api_cache_v1";

function isGetMethod(method = "GET") {
  return String(method || "GET").toUpperCase() === "GET";
}

function makeApiCacheKey(path, token = "") {
  const tokenScope = token ? `auth-${String(token).slice(-12)}` : "anon";
  return `${API_CACHE_PREFIX}:${tokenScope}:${path}`;
}

function readApiCache(key) {
  if (typeof window === "undefined" || !key) {
    return null;
  }
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) {
      return null;
    }
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") {
      return null;
    }
    return parsed.payload ?? null;
  } catch {
    return null;
  }
}

function writeApiCache(key, payload) {
  if (typeof window === "undefined" || !key) {
    return;
  }
  try {
    window.localStorage.setItem(
      key,
      JSON.stringify({
        cachedAt: Date.now(),
        payload
      })
    );
  } catch {
    // Ignore localStorage quota or serialization errors.
  }
}

export function isConnectivityError(error) {
  const code = String(error?.code || "").trim().toUpperCase();
  if (code === "OFFLINE" || code === "NETWORK_UNREACHABLE") {
    return true;
  }
  const message = String(error?.message || "").toLowerCase();
  return (
    message.includes("offline") ||
    message.includes("backend unreachable") ||
    message.includes("network")
  );
}

async function request(path, { method = "GET", token = "", body } = {}) {
  const upperMethod = String(method || "GET").toUpperCase();
  const shouldCache = isGetMethod(upperMethod);
  const cacheKey = shouldCache ? makeApiCacheKey(path, token) : "";
  const cachedPayload = shouldCache ? readApiCache(cacheKey) : null;
  if (
    shouldCache &&
    cachedPayload &&
    typeof navigator !== "undefined" &&
    navigator.onLine === false
  ) {
    return cachedPayload;
  }
  const isFormData = typeof FormData !== "undefined" && body instanceof FormData;
  let response;
  try {
    response = await fetch(`${API_BASE}${path}`, {
      method: upperMethod,
      cache: "no-store",
      headers: {
        ...(isFormData ? {} : { "Content-Type": "application/json" }),
        ...(token ? { Authorization: `Bearer ${token}` } : {})
      },
      body: body ? isFormData ? body : JSON.stringify(body) : void 0
    });
  } catch {
    if (shouldCache && cachedPayload) {
      return cachedPayload;
    }
    const connectivityError = new Error(
      "You are offline or the backend is unreachable. Reconnect and try again."
    );
    connectivityError.code =
      typeof navigator !== "undefined" && navigator.onLine === false
        ? "OFFLINE"
        : "NETWORK_UNREACHABLE";
    throw connectivityError;
  }
  const contentType = response.headers.get("content-type") || "";
  const isJson = contentType.includes("application/json");
  const payload = isJson ? await response.json().catch(() => ({})) : {};
  const textBody = isJson ? "" : await response.text().catch(() => "");
  if (!response.ok && shouldCache && response.status === 503 && cachedPayload) {
    return cachedPayload;
  }
  if (!response.ok) {
    const fallbackByStatus = response.status === 502 || response.status === 503 || response.status === 504
      ? "Backend unreachable. Verify API server is running and VITE_API_BASE is configured correctly."
      : `Request failed (${response.status}).`;
    const textMessage = String(textBody || "").trim().slice(0, 160);
    throw new Error(payload.message || textMessage || fallbackByStatus);
  }
  if (shouldCache && isJson) {
    writeApiCache(cacheKey, payload);
  }
  return payload;
}
export const authApi = {
  signup: (body) => request("/auth/signup", { method: "POST", body }),
  login: (body) => request("/auth/login", { method: "POST", body }),
  adminLogin: (body) => request("/auth/admin/login", { method: "POST", body }),
  adminBootstrap: (token) => request("/auth/admin/bootstrap", { method: "POST", token }),
  me: (token) => request("/auth/me", { token })
};
export const profileApi = {
  get: (token) => request("/profile", { token }),
  update: (token, body) => request("/profile", { method: "PUT", token, body }),
  deleteAccount: (token, body) => request("/profile/account", { method: "DELETE", token, body })
};
export const questionApi = {
  meta: () => request("/questions/meta"),
  predefined: (token, query) => {
    const params = new URLSearchParams(query).toString();
    return request(`/questions/predefined?${params}`, { token });
  },
  generate: (token, body) => request("/questions/generate", { method: "POST", token, body })
};
export const adminQuestionApi = {
  list: (token, query = {}) => {
    const params = new URLSearchParams(query).toString();
    return request(`/questions/admin${params ? `?${params}` : ""}`, { token });
  },
  create: (token, body) => request("/questions/admin", { method: "POST", token, body }),
  update: (token, questionId, body) => request(`/questions/admin/${questionId}`, { method: "PUT", token, body }),
  remove: (token, questionId) => request(`/questions/admin/${questionId}`, { method: "DELETE", token })
};
export const sessionApi = {
  create: (token, body) => request("/sessions", { method: "POST", token, body }),
  list: (token) => request("/sessions", { token }),
  details: (token, sessionId) => request(`/sessions/${sessionId}`, { token }),
  answer: (token, sessionId, questionId, body) => request(`/sessions/${sessionId}/answers/${questionId}`, { method: "POST", token, body }),
  followUp: (token, sessionId, questionId, body) => request(`/sessions/${sessionId}/answers/${questionId}/follow-up`, { method: "POST", token, body }),
  judgeChat: (token, sessionId, body) => request(`/sessions/${sessionId}/judge-chat`, { method: "POST", token, body }),
  reportSecurityIncident: (token, sessionId, body) => request(`/sessions/${sessionId}/security-incident`, { method: "POST", token, body }),
  complete: (token, sessionId) => request(`/sessions/${sessionId}/complete`, { method: "POST", token })
};
export const certificateApi = {
  verify: (certificateId) => request(`/sessions/certificates/${certificateId}`)
};
export const analyticsApi = {
  progress: (token) => request("/analytics/progress", { token }),
  adminOverview: (token) => request("/analytics/admin-overview", { token }),
  adminDbReport: (token, query = {}) => {
    const params = new URLSearchParams(query).toString();
    return request(`/analytics/admin-db-report${params ? `?${params}` : ""}`, { token });
  },
  adminBilling: (token, query = {}) => {
    const params = new URLSearchParams(query).toString();
    return request(`/analytics/admin-billing${params ? `?${params}` : ""}`, { token });
  },
  adminUpdateSubscription: (token, userId, body) => request(`/analytics/admin-subscription/${userId}`, { method: "PATCH", token, body }),
  adminUsers: (token, query = {}) => {
    const params = new URLSearchParams(query).toString();
    return request(`/analytics/admin-users${params ? `?${params}` : ""}`, { token });
  },
  adminExportUsersToGoogleSheet: (token, body = {}) => request("/analytics/admin-users/export-google-sheet", { method: "POST", token, body }),
  adminUpdateUser: (token, userId, body) => request(`/analytics/admin-users/${userId}`, { method: "PATCH", token, body })
};
export const leaderboardApi = {
  list: (token) => request("/leaderboard", { token })
};
export const paymentApi = {
  createIntent: (token, body) => request("/payments/intent", { method: "POST", token, body }),
  status: (token, paymentId) => request(`/payments/${paymentId}`, { token }),
  confirm: (token, paymentId, body = {}) => request(`/payments/${paymentId}/confirm`, { method: "POST", token, body }),
  subscription: (token) => request("/payments/subscription/me", { token })
};
export const supportApi = {
  contact: (token, body) => request("/support/contact", { method: "POST", token, body })
};
export { API_BASE, request };
