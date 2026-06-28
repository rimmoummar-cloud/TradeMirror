// ---------------------------------------------------------------------------
// Email service — sends transactional email via the Brevo Transactional Email
// REST API (https://api.brevo.com/v3/smtp/email).
//
// No SDK dependency: uses global fetch (Node 18+). Best-effort — if
// BREVO_API_KEY is not configured, sending is skipped and the caller continues
// (the invite link is logged so a Super Admin can still deliver it manually).
// ---------------------------------------------------------------------------

import { env } from "../config/env";
import { logStep, logError, fmt } from "../utils/logger";

const SCOPE = "EmailService";
const BREVO_ENDPOINT = "https://api.brevo.com/v3/smtp/email";

export interface SendResult {
  sent: boolean;
  skipped?: boolean;
  /** Short reason for the caller / UI. */
  error?: string;
  /** HTTP status returned by Brevo (when it answered). */
  status?: number;
  /** Brevo's machine-readable error code, e.g. "invalid_parameter". */
  errorName?: string;
}

/**
 * Parse BREVO_FROM into Brevo's `sender` object. Accepts either
 * "Name <email@domain>" or a bare "email@domain".
 */
function parseSender(from: string): { name?: string; email: string } {
  const m = from.match(/^\s*(.*?)\s*<\s*([^>]+?)\s*>\s*$/);
  if (m) {
    const name = m[1].trim();
    const email = m[2].trim();
    return name ? { name, email } : { email };
  }
  return { email: from.trim() };
}

async function sendEmail(
  to: string,
  subject: string,
  html: string,
  toName?: string
): Promise<SendResult> {
  if (!env.brevoApiKey) {
    logStep(SCOPE, `BREVO_API_KEY not set — skipping email to ${to} ("${subject}")`);
    const skipped: SendResult = { sent: false, skipped: true };
    logStep(SCOPE, `emailSent=${skipped.sent} (skipped, no API key)`);
    return skipped;
  }

  const sender = parseSender(env.brevoFrom);
  const payload = {
    sender,
    to: [toName ? { email: to, name: toName } : { email: to }],
    subject,
    htmlContent: html,
  };

  // Log the request payload — API key intentionally EXCLUDED (only a prefix).
  logStep(SCOPE, `Brevo request → POST /v3/smtp/email`, {
    endpoint: BREVO_ENDPOINT,
    sender,
    to: payload.to,
    subject,
    apiKeyPrefix: env.brevoApiKey.slice(0, 6) + "…",
  });

  try {
    const resp = await fetch(BREVO_ENDPOINT, {
      method: "POST",
      headers: {
        "api-key": env.brevoApiKey,
        "content-type": "application/json",
        accept: "application/json",
      },
      body: JSON.stringify(payload),
    });

    // Read the body ONCE as text, then try to parse it as JSON so we can show
    // both the raw payload and the structured fields Brevo returns.
    const raw = await resp.text();
    let parsed: any = null;
    try {
      parsed = raw ? JSON.parse(raw) : null;
    } catch {
      /* non-JSON body — keep raw */
    }

    // ALWAYS log the full Brevo exchange (success or failure): HTTP status,
    // raw response body, and parsed JSON.
    console.log(
      `\n[${SCOPE}] Brevo response\n` +
        `  HTTP status : ${resp.status} ${resp.statusText} (resp.ok=${resp.ok})\n` +
        `  Raw body    : ${raw || "(empty)"}\n` +
        `  Parsed JSON : ${fmt(parsed)}`
    );

    if (!resp.ok) {
      // Brevo errors look like: { "code": "invalid_parameter",
      //   "message": "Sender email is not valid / not verified" }.
      const name = parsed?.code ?? "unknown_error";
      const message = parsed?.message ?? raw ?? "(empty body)";

      console.error(
        `\n[${SCOPE}] ❌ BREVO REFUSED EMAIL to ${to}\n` +
          `  HTTP status : ${resp.status} ${resp.statusText}\n` +
          `  Error code  : ${name}\n` +
          `  Message     : ${message}\n` +
          `  Full body   : ${fmt(parsed ?? raw)}`
      );

      const result: SendResult = {
        sent: false,
        error: `Brevo ${resp.status} ${name}: ${message}`,
        status: resp.status,
        errorName: name,
      };
      logStep(SCOPE, `emailSent=${result.sent} (Brevo error)`);
      return result;
    }

    // 2xx (Brevo returns 201 Created with a messageId) ⇒ accepted.
    logStep(
      SCOPE,
      `✅ Email accepted by Brevo → ${to} (messageId: ${parsed?.messageId ?? "n/a"})`,
      parsed ?? raw
    );
    const result: SendResult = { sent: true, status: resp.status };
    logStep(SCOPE, `emailSent=${result.sent}`);
    return result;
  } catch (err) {
    // Network / DNS / fetch-level failure — never reached Brevo.
    logError(`${SCOPE}.sendEmail (transport failure, request did not complete)`, err);
    const result: SendResult = {
      sent: false,
      error: err instanceof Error ? err.message : "unknown transport error",
    };
    logStep(SCOPE, `emailSent=${result.sent} (transport failure)`);
    return result;
  }
}

/** Invitation email with the secure accept link + role + expiry. */
export async function sendInvitationEmail(params: {
  to: string;
  fullName: string;
  role: string;
  token: string;
  expiresAt: string;
}): Promise<SendResult> {
  const link = `${env.appBaseUrl.replace(/\/$/, "")}/accept-invite?token=${encodeURIComponent(params.token)}`;
  const expires = new Date(params.expiresAt).toLocaleDateString("en-US", {
    year: "numeric", month: "long", day: "numeric",
  });
  const roleLabel = params.role.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());

  const html = `
  <div style="font-family:system-ui,Arial,sans-serif;max-width:560px;margin:0 auto;color:#0f172a">
    <h2 style="color:#1d4ed8">You're invited to TradeMirror OS</h2>
    <p>Hello ${escapeHtml(params.fullName || params.to)},</p>
    <p>You have been invited to join <strong>TradeMirror OS</strong> with the role
       <strong>${escapeHtml(roleLabel)}</strong>.</p>
    <p style="margin:24px 0">
      <a href="${link}" style="background:#2563eb;color:#fff;padding:12px 20px;border-radius:8px;text-decoration:none;font-weight:600">
        Accept invitation &amp; set password
      </a>
    </p>
    <p style="font-size:13px;color:#475569">Or paste this link into your browser:<br>
      <a href="${link}">${link}</a></p>
    <p style="font-size:13px;color:#b45309">This invitation expires on <strong>${expires}</strong> (7 days).</p>
    <hr style="border:none;border-top:1px solid #e2e8f0;margin:24px 0">
    <p style="font-size:12px;color:#94a3b8">If you did not expect this invitation, you can ignore this email.</p>
  </div>`;

  return sendEmail(params.to, "You're invited to TradeMirror OS", html, params.fullName);
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c] as string)
  );
}
