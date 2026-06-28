// ---------------------------------------------------------------------------
// Request logging middleware
//
// Logs EVERY incoming request the instant it arrives (so a hang is immediately
// visible: you see the request, then the service step it reached, then silence),
// and logs the matching response with status + duration when it finishes.
//
// Mounted AFTER the body parsers in app.ts so req.body is already populated.
// ---------------------------------------------------------------------------

import { NextFunction, Request, Response } from "express";
import { fmt, now } from "../utils/logger";

// Keys whose values must never reach the logs (passwords, invite tokens, etc.).
const SENSITIVE_KEYS = new Set(["password", "token", "access_token", "refresh_token"]);

/** Shallow copy of the body with sensitive values masked before logging. */
function redact(body: unknown): unknown {
  if (!body || typeof body !== "object") return body;
  const clone: Record<string, unknown> = { ...(body as Record<string, unknown>) };
  for (const key of Object.keys(clone)) {
    if (SENSITIVE_KEYS.has(key.toLowerCase())) clone[key] = "[REDACTED]";
  }
  return clone;
}

export function requestLogger(req: Request, res: Response, next: NextFunction): void {
  const start = Date.now();

  // Avoid dumping raw binary for file uploads.
  const isMultipart = (req.headers["content-type"] || "").includes("multipart/form-data");

  console.log("\n--------------------------------------------------");
  console.log("[REQUEST]");
  console.log(`${req.method} ${req.originalUrl}`);
  console.log(`Params: ${fmt(req.params)}`);
  console.log(`Query:  ${fmt(req.query)}`);
  console.log(`Body:   ${isMultipart ? "[multipart/form-data upload]" : fmt(redact(req.body))}`);
  console.log(`Timestamp: ${now()}`);

  // res.on('finish') fires once the response has been fully handed off — at this
  // point req.params is fully resolved by the router.
  res.on("finish", () => {
    const ms = Date.now() - start;
    console.log(
      `[RESPONSE] ${req.method} ${req.originalUrl} (params: ${fmt(req.params)}) ` +
        `-> ${res.statusCode} in ${ms}ms`
    );
    console.log("--------------------------------------------------\n");
  });

  // If the connection closes WITHOUT a response (client aborted / true hang),
  // make that visible too instead of leaving silent ambiguity.
  res.on("close", () => {
    if (!res.writableEnded) {
      const ms = Date.now() - start;
      console.warn(
        `[ABORTED] ${req.method} ${req.originalUrl} — connection closed with NO response after ${ms}ms`
      );
    }
  });

  next();
}
