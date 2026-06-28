// ---------------------------------------------------------------------------
// TradeMirror OS — server entry point
//
// Wires together Express, middleware, and the trade routes, then starts
// listening. Validation of required env vars happens at import time inside
// ./config/env, so a misconfigured server fails fast and loudly.
// ---------------------------------------------------------------------------

import express from "express";
import cors from "cors";
import { env } from "./config/env";
import tradeRoutes from "./routes/trade.routes";
import clientRoutes from "./routes/client.routes";
import bankProfileRoutes from "./routes/bankProfile.routes";
import auditRoutes from "./routes/audit.routes";
import userRoutes from "./routes/user.routes";
import authRoutes from "./routes/auth.routes";
import { errorHandler, notFoundHandler } from "./middleware/errorHandler";
import { requestLogger } from "./middleware/requestLogger";

const app = express();

// ---- Global middleware -----------------------------------------------------
// CORS: when CORS_ORIGIN is set (comma-separated list of frontend origins) the
// API is locked down to those origins. When it is empty we reflect any origin —
// the previous default — so local/dev and first deploys keep working until you
// fill in CORS_ORIGIN. Auth uses Bearer tokens (not cookies), so credentials
// are left at the default.
const allowedOrigins = env.corsOrigin
  .split(",")
  .map((o) => o.trim())
  .filter(Boolean);
app.use(cors(allowedOrigins.length ? { origin: allowedOrigins } : {}));
app.use(express.json({ limit: "5mb" }));
app.use(express.urlencoded({ extended: true }));

// Log every request as soon as the body is parsed (must come BEFORE routes).
app.use(requestLogger);

// ---- Health check ----------------------------------------------------------
app.get("/health", (_req, res) => {
  res.json({ status: "ok", service: "trademirror-server", time: new Date().toISOString() });
});

// ---- Feature routes --------------------------------------------------------
app.use("/api/trades", tradeRoutes);
app.use("/api/clients", clientRoutes);
app.use("/api/bank-profiles", bankProfileRoutes);
app.use("/api/audit", auditRoutes);
app.use("/api/users", userRoutes);
app.use("/api/auth", authRoutes);

// ---- Fallbacks (order matters: 404 then error handler) ---------------------
app.use(notFoundHandler);
app.use(errorHandler);

// ---- Safety net: never let an async failure die silently -------------------
process.on("unhandledRejection", (reason) => {
  console.error("\n[process] ❌ UNHANDLED PROMISE REJECTION");
  console.error(reason instanceof Error ? reason.stack : reason);
});
process.on("uncaughtException", (err) => {
  console.error("\n[process] ❌ UNCAUGHT EXCEPTION");
  console.error(err.stack || err);
});

// ---- Start -----------------------------------------------------------------
// Bind to 0.0.0.0 so the process is reachable inside containers / hosting
// platforms (Render, Railway, a VPS behind a proxy), not just the loopback.
app.listen(env.port, "0.0.0.0", () => {
  console.log(`🚀 TradeMirror server listening on port ${env.port} (${env.nodeEnv})`);
  console.log(`   Health check: GET /health`);
});

export default app;
