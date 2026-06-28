import { Request, Response, NextFunction } from "express";
import { supabase as adminClient } from "../config/supabase";
import { ApiError } from "./errorHandler";
import { logStep } from "../utils/logger";
import { isValidRole } from "../types/user";

export type UserRole = "super_admin" | "admin" | "employee" | "partner";

export interface UserProfile {
  id: string;
  email: string | null;
  role: UserRole | string;
  is_active: boolean;
  full_name: string | null;
  invitation_status: string | null;
}

/**
 * Create a public.users row for a valid Auth user that has no profile yet.
 * Mirrors the DB-level handle_new_user trigger so the system self-heals even if
 * the trigger isn't installed. Returns the new profile, or null if it couldn't
 * be created (then the caller surfaces the usual 403).
 */
async function healMissingProfile(
  user: { id: string; email?: string | null; user_metadata?: Record<string, unknown> | null }
): Promise<UserProfile | null> {
  const meta = (user.user_metadata ?? {}) as Record<string, unknown>;
  const metaRole = typeof meta.role === "string" && isValidRole(meta.role) ? meta.role : "employee";
  const fullName = typeof meta.full_name === "string" ? meta.full_name : null;

  const row = {
    id: user.id,
    email: user.email ?? null,
    role: metaRole,
    is_active: true,
    full_name: fullName,
    invitation_status: "accepted",
  };

  // Try the full row; if the user_management columns aren't present, fall back
  // to the base columns so a profile still gets created.
  const full = await adminClient
    .from("users")
    .upsert(row, { onConflict: "id" })
    .select("id, email, role, is_active, full_name, invitation_status")
    .single();
  if (full.data) {
    logStep("Auth", `self-healed missing profile for ${user.id} (${user.email})`);
    return full.data as UserProfile;
  }
  logStep("Auth", `self-heal full upsert failed (${full.error?.code}: ${full.error?.message}) — base upsert`);

  const base = await adminClient
    .from("users")
    .upsert({ id: user.id, email: user.email ?? null, role: metaRole }, { onConflict: "id" })
    .select("id, email, role")
    .single();
  if (base.data) {
    logStep("Auth", `self-healed missing profile (base cols) for ${user.id}`);
    return {
      id: base.data.id,
      email: base.data.email,
      role: base.data.role,
      is_active: true,
      full_name: null,
      invitation_status: "accepted",
    };
  }
  logStep("Auth", `self-heal failed for ${user.id}: ${base.error?.code}: ${base.error?.message}`);
  return null;
}

/**
 * Authenticate the request and load the caller's public.users profile.
 * Verifies: (1) a valid JWT and (2) the user exists in public.users. Does NOT
 * block inactive users here — that is enforced by requireActive/requireRole so
 * that the login/session endpoint can still report an inactive account.
 */
export async function requireAuth(req: Request, res: Response, next: NextFunction) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return next(new ApiError(401, "Missing or invalid Authorization header"));
  }

  const token = authHeader.substring(7);
  try {
    const { data: { user }, error } = await adminClient.auth.getUser(token);
    if (error || !user) {
      return next(new ApiError(401, "Invalid or expired token"));
    }

    // Load the profile. Select the full set first; if that fails because the
    // user_management migration columns aren't present yet (Postgres 42703),
    // fall back to the base columns so authentication keeps working — and NEVER
    // swallow the real error (that previously surfaced as a misleading 403).
    let profile: UserProfile | null = null;
    const full = await adminClient
      .from("users")
      .select("id, email, role, is_active, full_name, invitation_status")
      .eq("id", user.id)
      .single();

    if (full.data) {
      profile = full.data as UserProfile;
    } else {
      if (full.error) {
        logStep("Auth", `profile full-select failed (${full.error.code}: ${full.error.message}) — retrying base columns`);
      }
      const base = await adminClient
        .from("users")
        .select("id, email, role")
        .eq("id", user.id)
        .single();
      if (base.error) {
        logStep("Auth", `profile base-select failed (${base.error.code}: ${base.error.message})`);
      }
      if (base.data) {
        // Columns added by user_management.sql are optional here; default to
        // active so existing users are never locked out before the migration.
        profile = {
          id: base.data.id,
          email: base.data.email,
          role: base.data.role,
          is_active: true,
          full_name: null,
          invitation_status: "accepted",
        };
      }
    }

    // Self-healing: a VALID Auth user with no public.users row gets one created
    // automatically (from the Auth metadata) so a legitimate user is never
    // locked out with "User profile not found". Deactivated users are NOT healed
    // here — their row still exists (is_active=false), so this only fires when
    // the profile is genuinely missing.
    if (!profile) {
      profile = await healMissingProfile(user);
    }

    if (!profile) {
      return next(new ApiError(403, "User profile not found. Contact an administrator."));
    }

    logStep("Auth", `Authenticated ${user.id} (${user.email}) role=${profile.role} active=${profile.is_active}`);
    res.locals.user = user;
    res.locals.profile = profile;
    res.locals.supabase = adminClient;
    next();
  } catch (err) {
    next(new ApiError(401, "Authentication failed"));
  }
}

/** Reject inactive accounts. Use after requireAuth on protected routes. */
export function requireActive(_req: Request, res: Response, next: NextFunction) {
  const profile = res.locals.profile as UserProfile | undefined;
  if (!profile) return next(new ApiError(403, "User profile not found."));
  if (!profile.is_active) {
    return next(new ApiError(403, "Your account is inactive. Please contact the administrator."));
  }
  next();
}

/**
 * Authorize by role. Implies active + exists. Backend is the source of truth —
 * the frontend's role gating is cosmetic only.
 */
export function requireRole(...roles: UserRole[]) {
  return (_req: Request, res: Response, next: NextFunction) => {
    const profile = res.locals.profile as UserProfile | undefined;
    if (!profile) return next(new ApiError(403, "User profile not found."));
    if (!profile.is_active) {
      return next(new ApiError(403, "Your account is inactive. Please contact the administrator."));
    }
    if (!roles.includes(profile.role as UserRole)) {
      return next(new ApiError(403, "You do not have permission to perform this action."));
    }
    next();
  };
}
