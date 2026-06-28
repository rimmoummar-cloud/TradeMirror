// ---------------------------------------------------------------------------
// Environment configuration
//
// Loads variables from `.env` and validates the required ones up-front so the
// server fails fast with a clear message instead of crashing later on a vague
// "undefined" error deep inside a request handler.
// ---------------------------------------------------------------------------

import dotenv from "dotenv";

dotenv.config();

/** Read a required env var or throw a descriptive error. */
function required(name: string): string {
  const value = process.env[name];
  if (!value || value.trim() === "") {
    throw new Error(
      `Missing required environment variable: ${name}. ` +
        `Set it in your .env file (local) or in your hosting platform's ` +
        `environment variables (production).`
    );
  }
  return value;
}

/** Read an optional env var, falling back to a default. */
function optional(name: string, fallback: string): string {
  const value = process.env[name];
  return value && value.trim() !== "" ? value : fallback;
}

/** Runtime environment. Set NODE_ENV=production on your hosting platform. */
const nodeEnv = optional("NODE_ENV", "development");

export const env = {
  nodeEnv,
  isProduction: nodeEnv === "production",
  supabaseUrl: required("SUPABASE_URL"),
  supabaseKey: required("SUPABASE_KEY"),
  supabaseBucket: optional("SUPABASE_BUCKET", "trade-pdfs"),
  tradesTable: optional("SUPABASE_TRADES_TABLE", "trades"),
  port: parseInt(optional("PORT", "4000"), 10),
  // User-invitation email (Brevo Transactional Email API). If BREVO_API_KEY is
  // empty, invitations are still created and the link is logged — email sending
  // is skipped gracefully. BREVO_FROM accepts "Name <email>" or a bare email and
  // must be a sender verified in your Brevo account.
  brevoApiKey: optional("BREVO_API_KEY", ""),
  brevoFrom: optional("BREVO_FROM", "TradeMirror OS <no-reply@trademirror.app>"),
  // Public base URL of the frontend, used to build invitation accept links.
  // MUST be set to the deployed frontend URL in production (e.g.
  // https://app.example.com); otherwise invite links point at localhost.
  // Prefer FRONTEND_BASE_URL; APP_BASE_URL is kept as a backwards-compatible alias.
  appBaseUrl: optional("FRONTEND_BASE_URL", optional("APP_BASE_URL", "http://localhost:5173")),
  // Comma-separated list of allowed CORS origins (the deployed frontend URL).
  // Leave empty to reflect any origin (the previous default behaviour) — set it
  // in production to lock the API down to your frontend.
  corsOrigin: optional("CORS_ORIGIN", ""),
} as const;
