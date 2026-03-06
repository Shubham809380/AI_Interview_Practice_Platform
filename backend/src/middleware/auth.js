const { verifyJwt } = require("../utils/jwt");
const { User } = require("../models");
const { env } = require("../config/env");

function extractBearerToken(req) {
  const header = req.headers.authorization || "";
  return header.startsWith("Bearer ") ? header.slice(7) : "";
}

function normalizeEmail(value) {
  return String(value || "").trim().toLowerCase();
}

function isPrimaryAdminEmail(email) {
  const primaryAdminEmail = normalizeEmail(env.primaryAdminEmail);
  if (!primaryAdminEmail) {
    return false;
  }
  return normalizeEmail(email) === primaryAdminEmail;
}

async function resolveAuthenticatedUser(token) {
  const decoded = verifyJwt(token);
  const user = await User.findById(decoded.sub).select("role accountStatus email");
  return { decoded, user };
}

async function authRequired(req, res, next) {
  const token = extractBearerToken(req);

  if (!token) {
    return res.status(401).json({ message: "Authorization token is required." });
  }

  try {
    const { decoded, user } = await resolveAuthenticatedUser(token);
    if (!user) {
      return res.status(401).json({ message: "User not found for this token." });
    }
    if (String(user.accountStatus || "active").toLowerCase() === "suspended") {
      return res.status(403).json({ message: "Your account is suspended. Contact admin support." });
    }

    req.auth = {
      ...decoded,
      role: user.role,
      accountStatus: user.accountStatus
    };
    return next();
  } catch (error) {
    return res.status(401).json({ message: "Invalid or expired token." });
  }
}

async function adminRequired(req, res, next) {
  const token = extractBearerToken(req);

  if (!token) {
    return res.status(401).json({ message: "Authorization token is required." });
  }

  try {
    const { decoded, user } = await resolveAuthenticatedUser(token);
    if (!user) {
      return res.status(401).json({ message: "User not found for this token." });
    }
    if (String(user.accountStatus || "active").toLowerCase() === "suspended") {
      return res.status(403).json({ message: "Your account is suspended. Contact admin support." });
    }
    if (user.role !== "admin" || !isPrimaryAdminEmail(user.email)) {
      return res.status(403).json({ message: "Admin access is required." });
    }

    req.auth = {
      ...decoded,
      role: user.role,
      accountStatus: user.accountStatus
    };
    return next();
  } catch (error) {
    return res.status(401).json({ message: "Invalid or expired token." });
  }
}

module.exports = { authRequired, adminRequired };
