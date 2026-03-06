const { app } = require("../backend/src/app");
const { connectDb } = require("../backend/src/config/db");
const { ensureSeedData } = require("../backend/src/scripts/seed");

let bootPromise = null;

async function ensureBackendReady() {
  if (!bootPromise) {
    bootPromise = (async () => {
      await connectDb();
      await ensureSeedData();
    })().catch((error) => {
      bootPromise = null;
      throw error;
    });
  }
  return bootPromise;
}

module.exports = async (req, res) => {
  try {
    await ensureBackendReady();
  } catch (error) {
    return res.status(503).json({
      message: `Backend startup failed: ${error?.message || "unknown"}`
    });
  }
  return app(req, res);
};
