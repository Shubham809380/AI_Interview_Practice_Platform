const express = require("express");
const crypto = require("crypto");
const bcrypt = require("bcryptjs");
const { User } = require("../models");
const { env } = require("../config/env");
const { passport } = require("../config/passport");
const { signJwt } = require("../utils/jwt");
const { asyncHandler } = require("../utils/asyncHandler");
const { authRequired } = require("../middleware/auth");
const router = express.Router();
const OAUTH_STATE_TTL_MS = 10 * 60 * 1e3;
const oauthStateStore = new Map();
function normalizeEmail(value) {
  return String(value || "").trim().toLowerCase();
}
function isValidEmail(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}
function getPrimaryAdminEmail() {
  return normalizeEmail(env.primaryAdminEmail);
}
function isPrimaryAdminEmail(email) {
  const primaryAdminEmail = getPrimaryAdminEmail();
  if (!primaryAdminEmail) {
    return false;
  }
  return normalizeEmail(email) === primaryAdminEmail;
}
async function demoteNonPrimaryAdmins() {
  const primaryAdminEmail = getPrimaryAdminEmail();
  if (!primaryAdminEmail) {
    return;
  }
  await User.updateMany(
    { role: "admin", email: { $ne: primaryAdminEmail } },
    { $set: { role: "user" } }
  );
}
function cleanupExpiredOauthStates() {
  const now = Date.now();
  for (const [state, data] of oauthStateStore.entries()) {
    if (!data || data.expiresAt <= now) {
      oauthStateStore.delete(state);
    }
  }
}
function getOauthConfig(provider) {
  const normalized = String(provider || "").trim().toLowerCase();
  if (normalized === "google") {
    return {
      strategy: "google",
      provider: "google",
      name: "Google",
      clientId: env.googleOAuthClientId,
      clientSecret: env.googleOAuthClientSecret,
      scopes: env.googleOAuthScopes
    };
  }
  if (normalized === "linkedin") {
    return {
      strategy: "linkedin",
      provider: "linkedin",
      name: "LinkedIn",
      clientId: env.linkedinOAuthClientId,
      clientSecret: env.linkedinOAuthClientSecret,
      scopes: env.linkedinOAuthScopes
    };
  }
  return null;
}
function hasOauthCredentials(config) {
  return Boolean(config?.clientId && config?.clientSecret);
}
function normalizeOrigin(origin) {
  return String(origin || "").trim().replace(/\/+$/, "");
}
function isLoopbackHost(hostname = "") {
  return ["localhost", "127.0.0.1"].includes(String(hostname || "").trim().toLowerCase());
}
function toSafeHttpOrigin(input) {
  const candidate = normalizeOrigin(input);
  if (!candidate) {
    return "";
  }
  try {
    const parsed = new URL(candidate);
    if (!["http:", "https:"].includes(parsed.protocol)) {
      return "";
    }
    return normalizeOrigin(parsed.origin);
  } catch {
    return "";
  }
}
function getVercelOriginFallback() {
  const raw = String(process.env.VERCEL_PROJECT_PRODUCTION_URL || process.env.VERCEL_URL || "").trim();
  if (!raw) {
    return "";
  }
  const host = raw.replace(/^https?:\/\//i, "").replace(/\/+$/, "");
  if (!host) {
    return "";
  }
  return toSafeHttpOrigin(`https://${host}`);
}
function getRequestOrigin(req) {
  const forwardedProto = String(req?.headers?.["x-forwarded-proto"] || "").split(",")[0].trim();
  const forwardedHost = String(req?.headers?.["x-forwarded-host"] || "").split(",")[0].trim();
  const host = forwardedHost || String(req?.get("host") || "").trim();
  const protocol = forwardedProto || req?.protocol || "http";
  if (!host) {
    return "";
  }
  return toSafeHttpOrigin(`${protocol}://${host}`);
}
function getSafeBackendOrigin(req) {
  const requestOrigin = getRequestOrigin(req);
  const configured = toSafeHttpOrigin(env.backendBaseUrl);
  const vercelOrigin = getVercelOriginFallback();
  if (requestOrigin && !isLoopbackHost(new URL(requestOrigin).hostname)) {
    return requestOrigin;
  }
  if (configured && !isLoopbackHost(new URL(configured).hostname)) {
    return configured;
  }
  return requestOrigin || configured || vercelOrigin || "http://localhost:5000";
}
function getSafeFrontendOrigin(req) {
  const requestOrigin = getRequestOrigin(req);
  const configured = toSafeHttpOrigin(env.frontendOrigin);
  const vercelOrigin = getVercelOriginFallback();
  if (configured && !isLoopbackHost(new URL(configured).hostname)) {
    return configured;
  }
  if (requestOrigin && !isLoopbackHost(new URL(requestOrigin).hostname)) {
    return requestOrigin;
  }
  return configured || requestOrigin || vercelOrigin || "http://localhost:5173";
}
function getFrontendRedirect(redirectUriInput, req) {
  const frontendOrigin = getSafeFrontendOrigin(req);
  const fallback = `${frontendOrigin}/`;
  const candidate = String(redirectUriInput || "").trim();
  if (!candidate) {
    return fallback;
  }
  if (candidate.startsWith("/")) {
    return `${frontendOrigin}${candidate}`;
  }
  try {
    const parsed = new URL(candidate);
    const normalizedCandidateOrigin = normalizeOrigin(parsed.origin);
    if (normalizedCandidateOrigin !== frontendOrigin) {
      const fallbackUrl = new URL(frontendOrigin);
      const candidateIsLoopback = ["localhost", "127.0.0.1"].includes(parsed.hostname);
      const fallbackIsLoopback = ["localhost", "127.0.0.1"].includes(fallbackUrl.hostname);
      const samePort = String(parsed.port || (parsed.protocol === "https:" ? "443" : "80")) === String(fallbackUrl.port || (fallbackUrl.protocol === "https:" ? "443" : "80"));
      const sameProtocol = parsed.protocol === fallbackUrl.protocol;
      if (!(candidateIsLoopback && fallbackIsLoopback && samePort && sameProtocol)) {
        return fallback;
      }
    }
    if (!["http:", "https:"].includes(parsed.protocol)) {
      return fallback;
    }
    return parsed.toString();
  } catch {
    return fallback;
  }
}
function createOauthState({ provider, frontendRedirect }) {
  cleanupExpiredOauthStates();
  const state = crypto.randomBytes(24).toString("hex");
  oauthStateStore.set(state, {
    provider,
    frontendRedirect,
    expiresAt: Date.now() + OAUTH_STATE_TTL_MS
  });
  return state;
}
function consumeOauthState({ provider, state }) {
  cleanupExpiredOauthStates();
  const value = oauthStateStore.get(state);
  oauthStateStore.delete(state);
  if (!value) {
    return null;
  }
  if (value.provider !== provider || value.expiresAt <= Date.now()) {
    return null;
  }
  return value;
}
function appendUrlParam(url, key, value) {
  try {
    const parsed = new URL(url);
    parsed.searchParams.set(key, value);
    return parsed.toString();
  } catch {
    const fallback = new URL(`${getSafeFrontendOrigin()}/`);
    fallback.searchParams.set(key, value);
    return fallback.toString();
  }
}
function normalizeDisplayName(input, email) {
  const fallbackFromEmail = String(email || "").split("@")[0] || "User";
  const sanitized = String(input || fallbackFromEmail).trim().slice(0, 80);
  if (sanitized.length >= 2) {
    return sanitized;
  }
  return `${sanitized || "User"} User`.slice(0, 80);
}
function buildOauthFallbackEmail(provider, providerId) {
  const safeProvider = String(provider || "oauth").trim().toLowerCase().replace(/[^a-z0-9]/g, "");
  const safeProviderId = String(providerId || "").trim().toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 48);
  if (!safeProviderId) {
    return "";
  }
  return `${safeProvider}-${safeProviderId}@oauth.local`;
}
async function createRandomPassword() {
  const randomPassword = crypto.randomBytes(32).toString("hex");
  return randomPassword;
}
function registerLocalUser(user, password) {
  return new Promise((resolve, reject) => {
    User.register(user, password, (error, registeredUser) => {
      if (error) {
        reject(error);
        return;
      }
      resolve(registeredUser);
    });
  });
}
function setUserPassword(user, password) {
  return new Promise((resolve, reject) => {
    user.setPassword(password, (error, updatedUser) => {
      if (error) {
        reject(error);
        return;
      }
      resolve(updatedUser);
    });
  });
}
function authenticateLocalCredentials(email, password) {
  return new Promise((resolve, reject) => {
    const authenticator = User.authenticate();
    authenticator(email, password, (error, user, details) => {
      if (error) {
        reject(error);
        return;
      }
      resolve({ user, details });
    });
  });
}
async function verifyLocalPassword(user, password) {
  const normalizedPassword = String(password || "");
  const result = await authenticateLocalCredentials(user.email, normalizedPassword);
  if (result?.user) {
    return true;
  }
  if (user?.passwordHash) {
    const legacyValid = await bcrypt.compare(normalizedPassword, user.passwordHash);
    if (legacyValid) {
      await setUserPassword(user, normalizedPassword);
      user.passwordHash = "";
      await user.save();
      return true;
    }
  }
  return false;
}
function extractOauthErrorMessage(error, fallback) {
  const responseMessage = error?.response?.data?.error_description || error?.response?.data?.error || error?.message;
  return String(responseMessage || fallback || "OAuth login failed.").slice(0, 180);
}
function buildAuthPayload(user) {
  const token = signJwt({
    sub: String(user._id),
    email: user.email,
    name: user.name,
    role: user.role || "user"
  });
  return {
    token,
    user: user.toSafeObject()
  };
}
async function getOrCreateOauthUser({ email, name, provider = "oauth", providerId = "" }) {
  let resolvedEmail = normalizeEmail(email);
  if (!isValidEmail(resolvedEmail)) {
    resolvedEmail = buildOauthFallbackEmail(provider, providerId);
  }
  if (!isValidEmail(resolvedEmail)) {
    throw new Error("Provider did not return a valid email.");
  }
  const existing = await User.findOne({ email: resolvedEmail });
  if (existing) {
    if (existing.authProvider !== "oauth") {
      existing.authProvider = "oauth";
      await existing.save();
    }
    return existing;
  }
  const randomPassword = await createRandomPassword();
  const user = new User({
    name: normalizeDisplayName(name, resolvedEmail),
    email: resolvedEmail,
    authProvider: "oauth"
  });
  await setUserPassword(user, randomPassword);
  await user.save();
  return user;
}
function runPassportAuthenticate(req, res, provider) {
  return new Promise((resolve, reject) => {
    passport.authenticate(provider, { session: false }, (error, profile, info) => {
      if (error) {
        reject(error);
        return;
      }
      if (!profile) {
        const message = info?.message || "OAuth profile not returned.";
        reject(new Error(message));
        return;
      }
      resolve(profile);
    })(req, res, (nextError) => {
      if (nextError) {
        reject(nextError);
      }
    });
  });
}
router.get(
  "/oauth/providers",
  asyncHandler(async (req, res) => {
    const backendOrigin = getSafeBackendOrigin(req);
    const providers = ["google", "linkedin"].map((providerKey) => getOauthConfig(providerKey)).filter(Boolean).map((config) => ({
      provider: config.provider,
      name: config.name,
      configured: hasOauthCredentials(config),
      callbackUrl: `${backendOrigin}/api/auth/oauth/${config.provider}/callback`
    }));
    return res.json({ providers });
  })
);
router.get(
  "/oauth/:provider/start",
  asyncHandler(async (req, res, next) => {
    const config = getOauthConfig(req.params.provider);
    const frontendRedirect = getFrontendRedirect(req.query.redirectUri, req);
    if (!config) {
      const redirectUrl = appendUrlParam(frontendRedirect, "authError", "Unsupported OAuth provider.");
      return res.redirect(302, redirectUrl);
    }
    if (!hasOauthCredentials(config)) {
      const redirectUrl = appendUrlParam(frontendRedirect, "authError", `${config.name} OAuth is not configured yet.`);
      return res.redirect(302, redirectUrl);
    }
    const hasStrategy = Boolean(passport._strategy(config.strategy));
    if (!hasStrategy) {
      const redirectUrl = appendUrlParam(frontendRedirect, "authError", `${config.name} OAuth strategy is unavailable.`);
      return res.redirect(302, redirectUrl);
    }
    const state = createOauthState({
      provider: config.provider,
      frontendRedirect
    });
    const options = {
      session: false,
      scope: config.scopes,
      state,
      callbackURL: `${getSafeBackendOrigin(req)}/api/auth/oauth/${config.provider}/callback`
    };
    if (config.provider === "google") {
      options.prompt = "select_account";
    }
    return passport.authenticate(config.strategy, options)(req, res, next);
  })
);
router.get(
  "/oauth/:provider/callback",
  asyncHandler(async (req, res) => {
    const config = getOauthConfig(req.params.provider);
    if (!config) {
      const fallbackRedirect = `${getSafeFrontendOrigin(req)}/`;
      const redirectUrl = appendUrlParam(fallbackRedirect, "authError", "Unsupported OAuth provider.");
      return res.redirect(302, redirectUrl);
    }
    if (!hasOauthCredentials(config)) {
      const fallbackRedirect = `${getSafeFrontendOrigin(req)}/`;
      const redirectUrl = appendUrlParam(fallbackRedirect, "authError", `${config.name} OAuth is not configured yet.`);
      return res.redirect(302, redirectUrl);
    }
    const state = String(req.query.state || "").trim();
    const providerError = String(req.query.error_description || req.query.error || "").trim();
    const statePayload = consumeOauthState({ provider: config.provider, state });
    if (!statePayload) {
      const fallbackRedirect = `${getSafeFrontendOrigin(req)}/`;
      const redirectUrl = appendUrlParam(fallbackRedirect, "authError", "OAuth session expired. Please try again.");
      return res.redirect(302, redirectUrl);
    }
    const frontendRedirect = statePayload.frontendRedirect;
    if (providerError) {
      const redirectUrl = appendUrlParam(frontendRedirect, "authError", `${config.name} login was cancelled or failed.`);
      return res.redirect(302, redirectUrl);
    }
    if (!String(req.query.code || "").trim()) {
      const redirectUrl = appendUrlParam(frontendRedirect, "authError", `${config.name} did not return auth code.`);
      return res.redirect(302, redirectUrl);
    }
    try {
      const profile = await runPassportAuthenticate(req, res, config.strategy);
      const user = await getOrCreateOauthUser(profile);
      if (String(user.accountStatus || "active").toLowerCase() === "suspended") {
        const redirectUrl2 = appendUrlParam(frontendRedirect, "authError", "Your account is suspended. Contact admin support.");
        return res.redirect(302, redirectUrl2);
      }
      const payload = buildAuthPayload(user);
      const redirectUrl = appendUrlParam(frontendRedirect, "authToken", payload.token);
      return res.redirect(302, redirectUrl);
    } catch (error) {
      const fallback = `${config.name} login failed. Please try again.`;
      const message = extractOauthErrorMessage(error, fallback);
      const redirectUrl = appendUrlParam(frontendRedirect, "authError", message);
      return res.redirect(302, redirectUrl);
    }
  })
);
router.post(
  "/signup",
  asyncHandler(async (req, res) => {
    const name = String(req.body.name || "").trim();
    const email = normalizeEmail(req.body.email);
    const password = String(req.body.password || "");
    if (!name || !email || !password) {
      return res.status(400).json({ message: "Name, email, and password are required." });
    }
    if (!isValidEmail(email)) {
      return res.status(400).json({ message: "Please provide a valid email." });
    }
    if (password.length < 8) {
      return res.status(400).json({ message: "Password must be at least 8 characters." });
    }
    const existing = await User.findOne({ email });
    if (existing) {
      if (existing.authProvider && existing.authProvider !== "local") {
        return res.status(409).json({
          message: "This email is registered with Google/LinkedIn. Please use social login."
        });
      }
      return res.status(409).json({ message: "Email is already registered. Please log in." });
    }
    const user = new User({
      name,
      email,
      authProvider: "local"
    });
    try {
      await registerLocalUser(user, password);
    } catch (registerError) {
      if (registerError?.name === "UserExistsError" || registerError?.code === 11e3) {
        return res.status(409).json({ message: "Email is already registered. Please log in." });
      }
      throw registerError;
    }
    return res.status(201).json(buildAuthPayload(user));
  })
);
router.post(
  "/login",
  asyncHandler(async (req, res) => {
    const email = normalizeEmail(req.body.email);
    const password = String(req.body.password || "");
    if (!email || !password) {
      return res.status(400).json({ message: "Email and password are required." });
    }
    const user = await User.findOne({ email });
    if (!user) {
      return res.status(401).json({ message: "Account not found. Please sign up first." });
    }
    if (user.authProvider && user.authProvider !== "local") {
      return res.status(401).json({ message: "This account uses Google/LinkedIn sign in." });
    }
    if (String(user.accountStatus || "active").toLowerCase() === "suspended") {
      return res.status(403).json({ message: "Your account is suspended. Contact admin support." });
    }
    const isValid = await verifyLocalPassword(user, password);
    if (!isValid) {
      return res.status(401).json({ message: "Incorrect password. Please try again." });
    }
    return res.json(buildAuthPayload(user));
  })
);
router.post(
  "/admin/login",
  asyncHandler(async (req, res) => {
    const email = normalizeEmail(req.body.email);
    const password = String(req.body.password || "");
    if (!email || !password) {
      return res.status(400).json({ message: "Email and password are required." });
    }
    if (!isPrimaryAdminEmail(email)) {
      return res.status(403).json({ message: "Only configured primary admin can log in to Admin Panel." });
    }
    const primaryAdminEmail = getPrimaryAdminEmail();
    const hasPrimaryAdmin = primaryAdminEmail ? await User.exists({ role: "admin", email: primaryAdminEmail }) : false;
    const canBootstrapAdmin = !hasPrimaryAdmin && env.nodeEnv !== "production";
    const bootstrapHint = canBootstrapAdmin
      ? " Primary admin account is not active yet. Use this form with the primary admin email to bootstrap admin access."
      : "";
    let user = await User.findOne({ email });
    if (!user && canBootstrapAdmin) {
      if (!isValidEmail(email)) {
        return res.status(400).json({ message: "Please provide a valid email." });
      }
      if (password.length < 8) {
        return res.status(400).json({ message: "Password must be at least 8 characters." });
      }
      user = new User({
        name: normalizeDisplayName(req.body.name, email),
        email,
        role: "admin",
        authProvider: "local"
      });
      try {
        await registerLocalUser(user, password);
      } catch (registerError) {
        if (registerError?.name === "UserExistsError" || registerError?.code === 11e3) {
          return res.status(409).json({ message: "Email already exists. Use another email for admin bootstrap." });
        }
        throw registerError;
      }
      await demoteNonPrimaryAdmins();
      return res.json(buildAuthPayload(user));
    }
    if (!user) {
      return res.status(401).json({ message: `Invalid credentials.${bootstrapHint}` });
    }
    if (String(user.accountStatus || "active").toLowerCase() === "suspended") {
      return res.status(403).json({ message: "Your account is suspended. Contact super admin." });
    }
    if (user.authProvider && user.authProvider !== "local") {
      if (!canBootstrapAdmin) {
        return res.status(403).json({ message: "Only admin can log in to Admin Panel." });
      }
      await setUserPassword(user, password);
      user.role = "admin";
      user.authProvider = "local";
      user.passwordHash = "";
      await user.save();
      await demoteNonPrimaryAdmins();
      return res.json(buildAuthPayload(user));
    }
    const isValid = await verifyLocalPassword(user, password);
    if (!isValid) {
      return res.status(401).json({ message: `Invalid credentials.${bootstrapHint}` });
    }
    if (user.role !== "admin") {
      user.role = "admin";
      await user.save();
    }
    await demoteNonPrimaryAdmins();
    return res.json(buildAuthPayload(user));
  })
);
router.post(
  "/admin/bootstrap",
  authRequired,
  asyncHandler(async (req, res) => {
    const primaryAdminEmail = getPrimaryAdminEmail();
    const hasPrimaryAdmin = primaryAdminEmail ? await User.exists({ role: "admin", email: primaryAdminEmail }) : false;
    if (hasPrimaryAdmin) {
      return res.status(409).json({ message: "Admin already exists. Ask an admin to promote your account." });
    }
    if (env.nodeEnv === "production") {
      return res.status(403).json({ message: "Admin bootstrap is disabled in production." });
    }
    const user = await User.findById(req.auth.sub);
    if (!user) {
      return res.status(404).json({ message: "User not found." });
    }
    if (!isPrimaryAdminEmail(user.email)) {
      return res.status(403).json({ message: "Only configured primary admin email can bootstrap admin access." });
    }
    user.role = "admin";
    await user.save();
    await demoteNonPrimaryAdmins();
    return res.json(buildAuthPayload(user));
  })
);
router.get(
  "/me",
  authRequired,
  asyncHandler(async (req, res) => {
    const user = await User.findById(req.auth.sub);
    if (!user) {
      return res.status(404).json({ message: "User not found." });
    }
    return res.json({ user: user.toSafeObject() });
  })
);
module.exports = router;
