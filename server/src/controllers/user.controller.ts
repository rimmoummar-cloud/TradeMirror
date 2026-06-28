// ---------------------------------------------------------------------------
// User controller — Super-Admin user management (list/invite/update/active/delete).
// ---------------------------------------------------------------------------

import { Request, Response } from "express";
import { ApiError } from "../middleware/errorHandler";
import * as userService from "../services/user.service";
import { isValidRole } from "../types/user";
import { logStep } from "../utils/logger";

function ok(step: string, data: any) {
  return { success: true, data, debug: { step, trace: null, warnings: [] } };
}

export async function listUsers(req: Request, res: Response) {
  logStep("[USERS]", "listUsers");
  const users = await userService.listUsers(res.locals.supabase, {
    search: typeof req.query.search === "string" ? req.query.search : undefined,
    role: typeof req.query.role === "string" ? req.query.role : undefined,
  });
  res.json(ok("listUsers", users));
}

/** POST /api/users — invite a new user. */
export async function inviteUser(req: Request, res: Response) {
  const { email, full_name, role } = req.body ?? {};
  if (!email || typeof email !== "string") throw new ApiError(400, "email is required.");
  if (!isValidRole(role)) throw new ApiError(400, "A valid role is required (super_admin, admin, employee, partner).");
  logStep("[USERS]", `inviteUser — ${email} as ${role}`);
  const result = await userService.inviteUser(
    res.locals.supabase,
    { email, fullName: full_name, role },
    res.locals.user?.id ?? null
  );
  const payload = ok("inviteUser", result);
  // Final API response as the client will receive it (after envelope unwrap the
  // client reads `data`, so `emailSent` here is exactly what the UI sees).
  logStep("[USERS]", `inviteUser response — emailSent=${result.emailSent}, alreadyActive=${!!result.alreadyActive}`, payload);
  res.status(201).json(payload);
}

export async function updateUser(req: Request, res: Response) {
  const { full_name, role } = req.body ?? {};
  logStep("[USERS]", `updateUser — ${req.params.id}`);
  const user = await userService.updateUser(
    res.locals.supabase, req.params.id,
    { full_name, role }, res.locals.user?.id ?? null
  );
  res.json(ok("updateUser", user));
}

export async function setActive(req: Request, res: Response) {
  const { is_active } = req.body ?? {};
  if (typeof is_active !== "boolean") throw new ApiError(400, "is_active (boolean) is required.");
  logStep("[USERS]", `setActive — ${req.params.id} => ${is_active}`);
  const user = await userService.setUserActive(res.locals.supabase, req.params.id, is_active, res.locals.user?.id ?? null);
  res.json(ok("setActive", user));
}

export async function deleteUser(req: Request, res: Response) {
  logStep("[USERS]", `deleteUser — ${req.params.id}`);
  await userService.deleteUser(res.locals.supabase, req.params.id, res.locals.user?.id ?? null);
  res.json(ok("deleteUser", { id: req.params.id }));
}
