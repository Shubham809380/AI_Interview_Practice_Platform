const mongoose = require("mongoose");
const { connectDb } = require("../config/db");
const { env } = require("../config/env");
const { User } = require("../models");

function normalizeEmail(value) {
  return String(value || "").trim().toLowerCase();
}

async function run() {
  const emailArg = process.argv[2];
  const email = normalizeEmail(emailArg);
  const primaryAdminEmail = normalizeEmail(env.primaryAdminEmail);

  if (!email) {
    console.error("Usage: node src/scripts/makeAdmin.js <admin-email>");
    process.exitCode = 1;
    return;
  }
  if (!primaryAdminEmail) {
    console.error("PRIMARY_ADMIN_EMAIL is not configured.");
    process.exitCode = 1;
    return;
  }
  if (email !== primaryAdminEmail) {
    console.error(`Only PRIMARY_ADMIN_EMAIL can be admin: ${primaryAdminEmail}`);
    process.exitCode = 1;
    return;
  }

  await connectDb();

  try {
    const user = await User.findOne({ email });
    if (!user) {
      console.error(`User not found for email: ${email}`);
      process.exitCode = 1;
      return;
    }

    if (user.role === "admin") {
      console.log(`User is already admin: ${email}`);
      return;
    }

    user.role = "admin";
    await user.save();
    await User.updateMany(
      { role: "admin", email: { $ne: primaryAdminEmail } },
      { $set: { role: "user" } }
    );
    console.log(`User promoted to admin: ${email}`);
  } finally {
    await mongoose.connection.close();
  }
}

run().catch((error) => {
  console.error(error?.message || error);
  process.exitCode = 1;
});
