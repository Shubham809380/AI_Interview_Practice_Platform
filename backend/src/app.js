const express = require("express");
const cors = require("cors");
const helmet = require("helmet");
const morgan = require("morgan");
const rateLimit = require("express-rate-limit");
const session = require("express-session");
const LocalStrategy = require("passport-local").Strategy;
const { env } = require("./config/env");
const { User } = require("./models");
const { passport, configurePassport } = require("./config/passport");
const authRoutes = require("./routes/auth.routes");
const profileRoutes = require("./routes/profile.routes");
const questionRoutes = require("./routes/questions.routes");
const sessionRoutes = require("./routes/sessions.routes");
const analyticsRoutes = require("./routes/analytics.routes");
const leaderboardRoutes = require("./routes/leaderboard.routes");
const paymentRoutes = require("./routes/payments.routes");
const supportRoutes = require("./routes/support.routes");
const { notFound, errorHandler } = require("./middleware/errorHandler");

const app = express();
configurePassport();

if (!passport._strategy("local")) {
  passport.use(
    "local",
    new LocalStrategy(
      {
        usernameField: "email",
        passwordField: "password"
      },
      User.authenticate()
    )
  );
}
passport.serializeUser(User.serializeUser());
passport.deserializeUser(User.deserializeUser());

app.use(helmet());
app.use(
  cors({
    origin: env.frontendOrigin,
    credentials: true
  })
);
app.use(express.json({ limit: "6mb" }));
app.use(
  session({
    secret: env.sessionSecret,
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      sameSite: "lax",
      secure: env.nodeEnv === "production"
    }
  })
);
app.use(passport.initialize());
app.use(passport.session());
app.use(morgan(env.nodeEnv === "development" ? "dev" : "combined"));
app.use(
  "/api",
  rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 500,
    standardHeaders: true,
    legacyHeaders: false
  })
);

app.get("/api/health", (req, res) => {
  res.json({
    status: "ok",
    environment: env.nodeEnv,
    aiConfigured: Boolean(env.googleAiApiKey || env.openAiApiKey),
    aiModel: env.googleAiModel,
    openAiEvaluationModel: env.openAiEvaluationModel,
    whisperModel: env.openAiWhisperModel,
    timestamp: new Date().toISOString()
  });
});

app.get("/", (req, res) => {
  res.json({
    status: "ok",
    message: "Backend is running.",
    health: "/api/health",
    frontend: env.frontendOrigin
  });
});

app.use("/api/auth", authRoutes);
app.use("/api/profile", profileRoutes);
app.use("/api/questions", questionRoutes);
app.use("/api/sessions", sessionRoutes);
app.use("/api/analytics", analyticsRoutes);
app.use("/api/leaderboard", leaderboardRoutes);
app.use("/api/payments", paymentRoutes);
app.use("/api/support", supportRoutes);

app.use(notFound);
app.use(errorHandler);

module.exports = { app };
