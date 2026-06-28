// ---------------------------------------------------------------------------
// Auth controller — post-login session bootstrap, logout, and the public
// invitation accept flow.
// ---------------------------------------------------------------------------

import { Request, Response } from "express";
import { ApiError } from "../middleware/errorHandler";
import * as userService from "../services/user.service";
import type { UserProfile } from "../middleware/auth";
import { supabase as adminClient } from "../config/supabase";
import { logStep } from "../utils/logger";

function ok(step: string, data: any) {
  return { success: true, data, debug: { step, trace: null, warnings: [] } };
}

/**
 * POST /api/auth/session — called by the client right after a successful
 * Supabase login. Enforces the active check, records the login + last_login_at,
 * and returns the profile. requireAuth (no requireActive) so it can report an
 * inactive account with a clear 403.
 */
export async function bootstrapSession(_req: Request, res: Response) {
  const profile = res.locals.profile as UserProfile;
  logStep("[AUTH]", `session — ${profile.email}`);
  const updated = await userService.recordLogin(res.locals.supabase, profile as any);
  res.json(ok("session", updated));
}

/** GET /api/auth/me — return the caller's profile (no login recorded). Used to
 *  hydrate role/active state on page refresh. */
export async function me(_req: Request, res: Response) {
  res.json(ok("me", res.locals.profile));
}

/** POST /api/auth/logout — record the logout event. */
export async function logout(_req: Request, res: Response) {
  const profile = res.locals.profile as UserProfile;
  await userService.recordLogout(res.locals.supabase, profile.id, profile.email);
  res.json(ok("logout", { ok: true }));
}

/** GET /api/auth/invitation/:token — public: validate a token for the accept page. */
export async function validateInvitation(req: Request, res: Response) {
  const result = await userService.validateInvitation(adminClient, req.params.token);
  res.json(ok("validateInvitation", result));
}

/** POST /api/auth/accept-invite — public: set password + activate the account. */
export async function acceptInvite(req: Request, res: Response) {
  const { token, password } = req.body ?? {};
  if (!token || typeof token !== "string") throw new ApiError(400, "token is required.");
  if (!password || typeof password !== "string") throw new ApiError(400, "password is required.");
  const result = await userService.acceptInvitation(adminClient, token, password);
  res.json(ok("acceptInvite", result));
}
