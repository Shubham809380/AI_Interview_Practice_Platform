const mongoose = require("mongoose");
const { connectDb } = require("../config/db");
const { env } = require("../config/env");
const { User } = require("../models");

function normalizeEmail(value) {
  return String(value || "").trim().toLowerCase();
}

function toDisplayName(email) {
  const localPart = String(email || "").split("@")[0] || "Admin";
  const cleaned = localPart.replace(/[^a-zA-Z0-9._-]/g, " ").trim();
  return (cleaned || "Primary Admin").slice(0, 80);
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

function registerAdminUser(user, password) {
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

async function run() {
  const newPassword = String(process.argv[2] || "");
  const emailArg = normalizeEmail(process.argv[3]);
  const primaryAdminEmail = normalizeEmail(env.primaryAdminEmail);
  const targetEmail = emailArg || primaryAdminEmail;

  if (!newPassword) {
    console.error("Usage: node src/scripts/resetAdminPassword.js <new-password> [admin-email]");
    process.exitCode = 1;
    return;
  }

  if (newPassword.length < 8) {
    console.error("Password must be at least 8 characters.");
    process.exitCode = 1;
    return;
  }

  if (!primaryAdminEmail) {
    console.error("PRIMARY_ADMIN_EMAIL is not configured.");
    process.exitCode = 1;
    return;
  }

  if (targetEmail !== primaryAdminEmail) {
    console.error(`Only PRIMARY_ADMIN_EMAIL can be reset: ${primaryAdminEmail}`);
    process.exitCode = 1;
    return;
  }

  await connectDb();

  try {
    let user = await User.findOne({ email: targetEmail });
    if (!user) {
      user = new User({
        name: toDisplayName(targetEmail),
        email: targetEmail,
        role: "admin",
        authProvider: "local"
      });
      await registerAdminUser(user, newPassword);
      console.log(`Primary admin created and password set: ${targetEmail}`);
    } else {
      await setUserPassword(user, newPassword);
      user.role = "admin";
      user.authProvider = "local";
      user.passwordHash = "";
      await user.save();
      console.log(`Primary admin password reset successfully: ${targetEmail}`);
    }

    await User.updateMany(
      { role: "admin", email: { $ne: primaryAdminEmail } },
      { $set: { role: "user" } }
    );
    console.log("Non-primary admins were demoted to user.");
  } finally {
    await mongoose.connection.close();
  }
}

run().catch((error) => {
  console.error(error?.message || error);
  process.exitCode = 1;
});
