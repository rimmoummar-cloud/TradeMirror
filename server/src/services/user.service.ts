// ---------------------------------------------------------------------------
// User service — user management, secure invitations, accept flow, auth events.
// Table writes use the injected (service-role) client; Supabase Auth admin
// operations use the shared admin client.
// ---------------------------------------------------------------------------

import { randomBytes } from "crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { supabase as adminClient } from "../config/supabase";
import { ApiError } from "../middleware/errorHandler";
import type { AppUser, InviteResult, UserRole } from "../types/user";
import { isValidRole } from "../types/user";
import { recordAudit } from "./audit.service";
import { AUDIT_ACTIONS } from "../types/audit";
import { sendInvitationEmail } from "./email.service";
import { env } from "../config/env";
import { logStep, logSupabase } from "../utils/logger";

const SCOPE = "UserService";
const TABLE = "users";
const INVITES = "user_invitations";
const INVITE_TTL_DAYS = 7;

function clean(v?: string | null): string | null {
  if (v == null) return null;
  const t = String(v).trim();
  return t === "" ? null : t;
}

// ---- Queries ---------------------------------------------------------------

export async function listUsers(
  supabase: SupabaseClient,
  params: { search?: string; role?: string }
): Promise<AppUser[]> {
  let query = supabase.from(TABLE).select("*").order("created_at", { ascending: false });
  if (params.role) query = query.eq("role", params.role);
  if (params.search && params.search.trim()) {
    const term = `%${params.search.trim()}%`;
    query = query.or(`full_name.ilike.${term},email.ilike.${term}`);
  }
  const { data, error } = await query;
  logSupabase("SELECT users", { data: data ? `[${data.length}]` : null, error });
  if (error) throw new ApiError(502, `Failed to list users: ${error.message}`);
  return (data ?? []) as AppUser[];
}

export async function getUserById(supabase: SupabaseClient, id: string): Promise<AppUser> {
  const { data, error } = await supabase.from(TABLE).select("*").eq("id", id).single();
  if (error || !data) throw new ApiError(404, `User not found: ${id}`);
  return data as AppUser;
}

// ---- Invitation ------------------------------------------------------------

/**
 * Find an existing Supabase Auth user by email. The admin API has no direct
 * "get by email", so we page through the user list. Returns null if not found
 * or on error (the caller decides what to do). Used to make invites idempotent:
 * we must NEVER blindly re-create an auth user that already exists (→ 409).
 */
async function findAuthUserByEmail(email: string): Promise<{ id: string } | null> {
  const target = email.toLowerCase();
  const perPage = 200;
  for (let page = 1; page <= 25; page++) {
    const { data, error } = await adminClient.auth.admin.listUsers({ page, perPage });
    if (error) {
      logSupabase("listUsers (find by email)", { data: null, error });
      return null;
    }
    const users = data?.users ?? [];
    const match = users.find((u) => (u.email ?? "").toLowerCase() === target);
    if (match) return { id: match.id };
    if (users.length < perPage) break; // last page reached
  }
  return null;
}

/**
 * Invite a user — fully IDEMPOTENT. Re-inviting the same email never throws a
 * 409: if the Auth user already exists we reuse it, refresh the invitation
 * token, and re-send the email. An already-active account is never reset.
 *
 * Flow:
 *  1. Resolve the Auth user id (reuse existing email; create only if truly new).
 *  2. If the profile is already active+accepted → just sync name/role, no token.
 *  3. Otherwise upsert the profile as inactive/pending.
 *  4. Expire any outstanding tokens, mint a fresh one, email it.
 */
export async function inviteUser(
  supabase: SupabaseClient,
  input: { email: string; fullName?: string | null; role: string },
  invitedBy?: string | null
): Promise<InviteResult> {
  const email = clean(input.email)?.toLowerCase();
  const fullName = clean(input.fullName);
  const role = input.role;
  if (!email) throw new ApiError(400, "email is required.");
  if (!isValidRole(role)) throw new ApiError(400, "Invalid role.");

  // 1. Resolve the Auth user id idempotently. ---------------------------------
  let userId: string | null = null;

  // 1a. Fast path — a profile already references this email.
  const { data: existingByEmail } = await supabase
    .from(TABLE)
    .select("id")
    .eq("email", email)
    .maybeSingle();
  if (existingByEmail?.id) userId = existingByEmail.id as string;

  // 1b. Otherwise look it up in Supabase Auth (may exist without a profile).
  if (!userId) {
    const found = await findAuthUserByEmail(email);
    if (found) userId = found.id;
  }

  // 1c. Still nothing → create the Auth user without a password.
  if (!userId) {
    const { data: created, error: createErr } = await adminClient.auth.admin.createUser({
      email,
      email_confirm: false,
      user_metadata: { full_name: fullName, role },
    });
    if (created?.user) {
      userId = created.user.id;
    } else {
      // "already registered" race (created between our lookup and now): recover
      // by resolving the existing user instead of surfacing a 409.
      const recovered = await findAuthUserByEmail(email);
      if (recovered) {
        userId = recovered.id;
        logStep(SCOPE, `createUser said exists — recovered existing auth id for ${email}`);
      } else {
        throw new ApiError(502, `Could not create user: ${createErr?.message ?? "unknown error"}`);
      }
    }
  }

  // 2. Never clobber an already-active account on re-invite. -------------------
  const { data: currentProfile } = await supabase
    .from(TABLE)
    .select("*")
    .eq("id", userId)
    .maybeSingle();
  const alreadyActive =
    currentProfile?.is_active === true && currentProfile?.invitation_status === "accepted";

  if (alreadyActive) {
    const { data: updated, error: updErr } = await supabase
      .from(TABLE)
      .update({ full_name: fullName ?? currentProfile!.full_name, role })
      .eq("id", userId)
      .select()
      .single();
    if (updErr) throw new ApiError(502, `Failed to update existing user: ${updErr.message}`);
    await recordAudit(supabase, {
      userId: invitedBy, action: AUDIT_ACTIONS.USER_UPDATED, entityType: "user", entityId: userId,
      message: `Re-invite of already-active ${email} — profile synced, no new invitation sent`,
      metadata: { email, role, alreadyActive: true },
    });
    return {
      user: updated as AppUser,
      invitationLink: "",
      emailSent: false,
      expiresAt: "",
      alreadyActive: true,
    };
  }

  // 3. Upsert the profile as inactive + pending (idempotent on id). -----------
  const { data: profile, error: upsertErr } = await supabase
    .from(TABLE)
    .upsert(
      {
        id: userId,
        email,
        full_name: fullName,
        role,
        is_active: false,
        invitation_status: "pending",
        invited_at: new Date().toISOString(),
      },
      { onConflict: "id" }
    )
    .select()
    .single();
  logSupabase("UPSERT users (invite)", { data: profile, error: upsertErr });
  if (upsertErr) {
    throw new ApiError(502, `Failed to create user profile: ${upsertErr.message}`);
  }

  // 4. Refresh the invitation token: expire outstanding ones, mint one fresh. -
  //    (Exactly one live token per pending user.)
  await supabase
    .from(INVITES)
    .update({ status: "expired" })
    .eq("user_id", userId)
    .eq("status", "pending");

  const token = randomBytes(32).toString("hex");
  const expiresAt = new Date(Date.now() + INVITE_TTL_DAYS * 86_400_000).toISOString();
  const { error: invErr } = await supabase.from(INVITES).insert({
    user_id: userId, email, role, token, status: "pending",
    expires_at: expiresAt, invited_by: invitedBy ?? null,
  });
  logSupabase("INSERT user_invitations", { data: { token: "[hidden]" }, error: invErr });
  if (invErr) throw new ApiError(502, `Failed to store invitation: ${invErr.message}`);

  // 5. Email the invite (best-effort).
  const emailResult = await sendInvitationEmail({
    to: email, fullName: fullName ?? email, role, token, expiresAt,
  });
  // Log the exact object sendInvitationEmail() returned (this is what drives
  // emailSent in the API response).
  logStep(SCOPE, `sendInvitationEmail() returned`, emailResult);
  if (!emailResult.sent && !emailResult.skipped) {
    logStep(SCOPE, `Invitation email to ${email} was NOT sent — ${emailResult.error ?? "unknown reason"}`);
  }
  const invitationLink = `${env.appBaseUrl.replace(/\/$/, "")}/accept-invite?token=${token}`;

  // 6. Audit.
  await recordAudit(supabase, {
    userId: invitedBy, action: AUDIT_ACTIONS.USER_INVITED, entityType: "user", entityId: userId,
    message: `Invited ${email} as ${role}`,
    metadata: { email, role, emailSent: emailResult.sent, reused: !!currentProfile },
  });

  return {
    user: profile as AppUser,
    invitationLink,
    emailSent: emailResult.sent,
    expiresAt,
  };
}

/** Public: validate an invitation token without consuming it. */
export async function validateInvitation(supabase: SupabaseClient, token: string) {
  const { data: inv } = await supabase.from(INVITES).select("*").eq("token", token).single();
  if (!inv) return { valid: false as const, reason: "Invitation not found." };
  if (inv.status === "accepted") return { valid: false as const, reason: "This invitation has already been used." };
  if (new Date(inv.expires_at).getTime() < Date.now()) {
    return { valid: false as const, reason: "This invitation has expired." };
  }
  return {
    valid: true as const,
    email: inv.email as string,
    role: inv.role as string,
    expiresAt: inv.expires_at as string,
  };
}

/** Public: accept an invitation — set password, activate, close the token. */
export async function acceptInvitation(
  supabase: SupabaseClient,
  token: string,
  password: string
): Promise<{ email: string }> {
  if (!password || password.length < 8) {
    throw new ApiError(400, "Password must be at least 8 characters.");
  }
  const { data: inv } = await supabase.from(INVITES).select("*").eq("token", token).single();
  if (!inv) throw new ApiError(404, "Invitation not found.");
  if (inv.status === "accepted") throw new ApiError(409, "This invitation has already been used.");
  if (new Date(inv.expires_at).getTime() < Date.now()) {
    throw new ApiError(410, "This invitation has expired.");
  }

  // Set the password + confirm the email on the Auth user.
  const { error: pwErr } = await adminClient.auth.admin.updateUserById(inv.user_id, {
    password,
    email_confirm: true,
  });
  if (pwErr) throw new ApiError(502, `Failed to set password: ${pwErr.message}`);

  // Activate the profile.
  await supabase.from(TABLE).update({
    is_active: true, invitation_status: "accepted",
  }).eq("id", inv.user_id);

  // Close the invitation.
  await supabase.from(INVITES).update({
    status: "accepted", accepted_at: new Date().toISOString(),
  }).eq("id", inv.id);

  await recordAudit(supabase, {
    userId: inv.user_id, action: AUDIT_ACTIONS.USER_INVITATION_ACCEPTED, entityType: "user",
    entityId: inv.user_id, message: `${inv.email} accepted their invitation and activated their account`,
  });

  logStep(SCOPE, `Invitation accepted for ${inv.email}`);
  return { email: inv.email as string };
}

// ---- Mutations -------------------------------------------------------------

export async function updateUser(
  supabase: SupabaseClient,
  id: string,
  input: { full_name?: string | null; role?: string },
  actorId?: string | null
): Promise<AppUser> {
  const existing = await getUserById(supabase, id);
  const patch: Record<string, unknown> = {};
  if (input.full_name !== undefined) patch.full_name = clean(input.full_name);
  if (input.role !== undefined) {
    if (!isValidRole(input.role)) throw new ApiError(400, "Invalid role.");
    patch.role = input.role;
  }
  if (Object.keys(patch).length === 0) throw new ApiError(400, "Nothing to update.");

  const { data, error } = await supabase.from(TABLE).update(patch).eq("id", id).select().single();
  logSupabase(`UPDATE users WHERE id=${id}`, { data, error });
  if (error) throw new ApiError(502, `Failed to update user: ${error.message}`);

  const roleChanged = patch.role !== undefined && patch.role !== existing.role;
  if (roleChanged) {
    await recordAudit(supabase, {
      userId: actorId, action: AUDIT_ACTIONS.USER_ROLE_CHANGED, entityType: "user", entityId: id,
      message: `Role for ${existing.email} changed from ${existing.role} to ${patch.role}`,
      metadata: { from: existing.role, to: patch.role },
    });
  } else {
    await recordAudit(supabase, {
      userId: actorId, action: AUDIT_ACTIONS.USER_UPDATED, entityType: "user", entityId: id,
      message: `User ${existing.email} updated`,
      metadata: { fields: Object.keys(patch) },
    });
  }
  return data as AppUser;
}

export async function setUserActive(
  supabase: SupabaseClient,
  id: string,
  active: boolean,
  actorId?: string | null
): Promise<AppUser> {
  if (id === actorId) throw new ApiError(400, "You cannot change your own active status.");
  const existing = await getUserById(supabase, id);
  const { data, error } = await supabase.from(TABLE).update({ is_active: active }).eq("id", id).select().single();
  if (error) throw new ApiError(502, `Failed to update status: ${error.message}`);
  await recordAudit(supabase, {
    userId: actorId,
    action: active ? AUDIT_ACTIONS.USER_ACTIVATED : AUDIT_ACTIONS.USER_DEACTIVATED,
    entityType: "user", entityId: id,
    message: `${existing.email} ${active ? "activated" : "deactivated"}`,
  });
  return data as AppUser;
}

export async function deleteUser(
  supabase: SupabaseClient,
  id: string,
  actorId?: string | null
): Promise<void> {
  if (id === actorId) throw new ApiError(400, "You cannot delete your own account.");
  const existing = await getUserById(supabase, id);

  // Delete the Auth user; the public.users row cascades via its FK. Delete the
  // profile row explicitly too as a safety net.
  await adminClient.auth.admin.deleteUser(id).catch(() => undefined);
  const { error } = await supabase.from(TABLE).delete().eq("id", id);
  if (error) throw new ApiError(502, `Failed to delete user: ${error.message}`);

  await recordAudit(supabase, {
    userId: actorId, action: AUDIT_ACTIONS.USER_DELETED, entityType: "user", entityId: id,
    message: `User ${existing.email} deleted`,
  });
}

// ---- Auth events -----------------------------------------------------------

/** Called after a successful client login. Enforces active + records login. */
export async function recordLogin(supabase: SupabaseClient, profile: AppUser): Promise<AppUser> {
  if (!profile.is_active) {
    throw new ApiError(403, "Your account is inactive. Please contact the administrator.");
  }
  const { data } = await supabase
    .from(TABLE)
    .update({ last_login_at: new Date().toISOString() })
    .eq("id", profile.id)
    .select()
    .single();
  await recordAudit(supabase, {
    userId: profile.id, action: AUDIT_ACTIONS.USER_LOGIN_SUCCESS, entityType: "auth", entityId: profile.id,
    message: `User ${profile.email} logged in successfully`,
  });
  return (data ?? profile) as AppUser;
}

export async function recordLogout(supabase: SupabaseClient, userId: string, email?: string | null): Promise<void> {
  await recordAudit(supabase, {
    userId, action: AUDIT_ACTIONS.USER_LOGOUT, entityType: "auth", entityId: userId,
    message: `User ${email ?? userId} logged out`,
  });
}
