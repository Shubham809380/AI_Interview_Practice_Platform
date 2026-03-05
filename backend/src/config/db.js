const fs = require("fs");
const net = require("net");
const path = require("path");
const { spawn } = require("child_process");
const mongoose = require("mongoose");
const { env } = require("./env");

const LOCAL_MONGO_REGEX = /^mongodb:\/\/(127\.0\.0\.1|localhost):27017(\/|$)/i;
const ATLAS_MONGO_REGEX = /^mongodb\+srv:\/\//i;
const mongoConnectOptions = {
  serverSelectionTimeoutMS: 8000,
  ...(env.mongoIpFamily === 4 || env.mongoIpFamily === 6 ? { family: env.mongoIpFamily } : {})
};

function shouldTryLocalMongoAutoStart(error, mongoUri = env.mongoUri) {
  const enabled = String(process.env.MONGO_AUTOSTART_LOCAL || "true").toLowerCase() !== "false";
  if (!enabled || process.platform !== "win32") {
    return false;
  }

  if (!LOCAL_MONGO_REGEX.test(String(mongoUri || "").trim())) {
    return false;
  }

  const text = String(error?.message || "");
  return text.includes("ECONNREFUSED") || text.includes("Server selection timed out");
}

function isConnectivityError(error) {
  const text = String(error?.message || "").toLowerCase();
  return (
    text.includes("could not connect to any servers") ||
    text.includes("server selection timed out") ||
    text.includes("econnrefused") ||
    text.includes("etimedout") ||
    text.includes("enotfound")
  );
}

function shouldTryFallbackMongo(error) {
  if (!env.mongoAllowFallback) {
    return false;
  }

  const primaryUri = String(env.mongoUri || "").trim();
  const fallbackUri = String(env.mongoFallbackUri || "").trim();
  if (!primaryUri || !fallbackUri || primaryUri === fallbackUri) {
    return false;
  }

  // Avoid switching silently between two remote databases.
  if (!ATLAS_MONGO_REGEX.test(primaryUri) || !LOCAL_MONGO_REGEX.test(fallbackUri)) {
    return false;
  }

  return isConnectivityError(error);
}

function waitForPort({ host, port, timeoutMs = 20000, intervalMs = 500 }) {
  const startedAt = Date.now();

  return new Promise((resolve) => {
    function tryConnect() {
      return new Promise((attemptResolve) => {
        const socket = net.createConnection({ host, port });
        let done = false;

        const finish = (value) => {
          if (done) return;
          done = true;
          socket.destroy();
          attemptResolve(value);
        };

        socket.setTimeout(1200);
        socket.once("connect", () => finish(true));
        socket.once("timeout", () => finish(false));
        socket.once("error", () => finish(false));

        setTimeout(() => {
          if (done) return;
          finish(false);
        }, 1300);
      });
    }

    (function loop() {
      tryConnect().then((ok) => {
        if (ok) {
          resolve(true);
          return;
        }

        if (Date.now() - startedAt >= timeoutMs) {
          resolve(false);
          return;
        }

        setTimeout(loop, intervalMs);
      });
    })();
  });
}

function tryStartLocalMongoProcess() {
  const mongoExe = process.env.MONGO_BIN_PATH || "C:\\Program Files\\MongoDB\\Server\\8.2\\bin\\mongod.exe";
  if (!fs.existsSync(mongoExe)) {
    return { started: false, reason: `mongod not found at ${mongoExe}` };
  }

  const projectRoot = path.join(__dirname, "..", "..");
  const dataDir = process.env.MONGO_LOCAL_DATA_DIR || path.join(projectRoot, ".mongodb", "data");
  const logDir = process.env.MONGO_LOCAL_LOG_DIR || path.join(projectRoot, ".mongodb", "log");
  const logPath = process.env.MONGO_LOCAL_LOG_PATH || path.join(logDir, "mongod.log");

  fs.mkdirSync(dataDir, { recursive: true });
  fs.mkdirSync(logDir, { recursive: true });

  const child = spawn(
    mongoExe,
    ["--dbpath", dataDir, "--logpath", logPath, "--bind_ip", "127.0.0.1", "--port", "27017"],
    { detached: true, stdio: "ignore", windowsHide: true }
  );
  child.unref();

  return { started: true, pid: child.pid, logPath };
}

async function connectDb() {
  mongoose.set("strictQuery", true);
  const primaryUri = String(env.mongoUri || "").trim();
  const fallbackUri = String(env.mongoFallbackUri || "").trim();

  try {
    await mongoose.connect(primaryUri, mongoConnectOptions);
    return mongoose.connection;
  } catch (primaryError) {
    if (shouldTryLocalMongoAutoStart(primaryError, primaryUri)) {
      const startResult = tryStartLocalMongoProcess();
      if (!startResult.started) {
        throw new Error(
          `MongoDB connection failed and auto-start skipped: ${startResult.reason}. Original error: ${primaryError.message}`
        );
      }

      const isReady = await waitForPort({ host: "127.0.0.1", port: 27017, timeoutMs: 25000, intervalMs: 600 });
      if (!isReady) {
        throw new Error(
          `MongoDB auto-start attempted (pid ${startResult.pid}) but port 27017 did not become ready. Check log: ${startResult.logPath}`
        );
      }

      await mongoose.connect(primaryUri, mongoConnectOptions);
      return mongoose.connection;
    }

    if (!shouldTryFallbackMongo(primaryError)) {
      throw primaryError;
    }

    console.warn(
      "Primary MongoDB connection failed. Attempting local fallback using MONGODB_FALLBACK_URI."
    );

    try {
      await mongoose.disconnect().catch(() => {
      });
      await mongoose.connect(fallbackUri, mongoConnectOptions);
      console.warn("Connected to fallback MongoDB URI.");
      return mongoose.connection;
    } catch (fallbackError) {
      if (shouldTryLocalMongoAutoStart(fallbackError, fallbackUri)) {
        const startResult = tryStartLocalMongoProcess();
        if (!startResult.started) {
          throw new Error(
            `Primary MongoDB failed (${primaryError.message}). Fallback auto-start skipped: ${startResult.reason}.`
          );
        }

        const isReady = await waitForPort({ host: "127.0.0.1", port: 27017, timeoutMs: 25000, intervalMs: 600 });
        if (!isReady) {
          throw new Error(
            `Primary MongoDB failed (${primaryError.message}). Fallback MongoDB auto-start attempted (pid ${startResult.pid}) but port 27017 did not become ready. Check log: ${startResult.logPath}`
          );
        }

        await mongoose.connect(fallbackUri, mongoConnectOptions);
        console.warn("Connected to fallback local MongoDB after auto-start.");
        return mongoose.connection;
      }

      throw new Error(
        `Primary MongoDB failed (${primaryError.message}). Fallback MongoDB failed (${fallbackError.message}).`
      );
    }
  }
}

module.exports = { connectDb };
