// ---------------------------------------------------------------------------
// Bank Profile controller — HTTP handlers for the Banking Profiles module.
// Thin layer: validate, delegate to bankProfile.service, return the standard
// { success, data, debug } envelope.
// ---------------------------------------------------------------------------

import { Request, Response } from "express";
import { ApiError } from "../middleware/errorHandler";
import type { BankProfileInput } from "../types/bankProfile";
import * as bankProfileService from "../services/bankProfile.service";
import { logStep } from "../utils/logger";

function successResponse(step: string, data: any) {
  return { success: true, data, debug: { step, trace: null, warnings: [] } };
}

/** GET /api/bank-profiles — list all bank profiles. */
export async function listBankProfiles(_req: Request, res: Response) {
  logStep("[BANK_PROFILES]", "listBankProfiles");
  const profiles = await bankProfileService.listBankProfiles(res.locals.supabase);
  res.json(successResponse("listBankProfiles", profiles));
}

/** GET /api/bank-profiles/:id — one bank profile. */
export async function getBankProfile(req: Request, res: Response) {
  logStep("[BANK_PROFILES]", `getBankProfile — id: ${req.params.id}`);
  const profile = await bankProfileService.getBankProfileById(res.locals.supabase, req.params.id);
  res.json(successResponse("getBankProfile", profile));
}

/** POST /api/bank-profiles — create a bank profile. */
export async function createBankProfile(req: Request, res: Response) {
  logStep("[BANK_PROFILES]", `createBankProfile — name: ${req.body?.profile_name}`);
  const input = (req.body ?? {}) as BankProfileInput;
  if (input === null || typeof input !== "object" || Array.isArray(input)) {
    throw new ApiError(400, "Request body must be a JSON object.");
  }
  const profile = await bankProfileService.createBankProfile(res.locals.supabase, input, res.locals.user?.id ?? null);
  res.status(201).json(successResponse("createBankProfile", profile));
}

/** PUT /api/bank-profiles/:id — update a bank profile. */
export async function updateBankProfile(req: Request, res: Response) {
  logStep("[BANK_PROFILES]", `updateBankProfile — id: ${req.params.id}`);
  const input = (req.body ?? {}) as Partial<BankProfileInput>;
  if (input === null || typeof input !== "object" || Array.isArray(input)) {
    throw new ApiError(400, "Request body must be a JSON object.");
  }
  const profile = await bankProfileService.updateBankProfile(res.locals.supabase, req.params.id, input, res.locals.user?.id ?? null);
  res.json(successResponse("updateBankProfile", profile));
}

/** GET /api/bank-profiles/:id/trades — trades linked to this bank profile. */
export async function listBankProfileTrades(req: Request, res: Response) {
  logStep("[BANK_PROFILES]", `listBankProfileTrades — id: ${req.params.id}`);
  const trades = await bankProfileService.listBankProfileTrades(res.locals.supabase, req.params.id);
  res.json(successResponse("listBankProfileTrades", trades));
}

/** DELETE /api/bank-profiles/:id — delete a bank profile. */
export async function deleteBankProfile(req: Request, res: Response) {
  logStep("[BANK_PROFILES]", `deleteBankProfile — id: ${req.params.id}`);
  await bankProfileService.deleteBankProfile(res.locals.supabase, req.params.id, res.locals.user?.id ?? null);
  res.json(successResponse("deleteBankProfile", { id: req.params.id }));
}
