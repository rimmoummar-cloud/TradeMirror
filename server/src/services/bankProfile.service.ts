// ---------------------------------------------------------------------------
// Bank Profile service — business logic for the Banking Profiles module.
//
// Standalone CRUD over the `bank_profiles` table. Follows the same conventions
// as client.service: a Supabase client is injected, every Supabase call is
// logged, and failures throw ApiError. Not linked to the trade flow.
// ---------------------------------------------------------------------------

import type { SupabaseClient } from "@supabase/supabase-js";
import { ApiError } from "../middleware/errorHandler";
import type { BankProfile, BankProfileInput, BankProfileTrade } from "../types/bankProfile";
import { recordAudit } from "./audit.service";
import { AUDIT_ACTIONS } from "../types/audit";
import { logStep, logSupabase } from "../utils/logger";

const SCOPE = "BankProfileService";
const TABLE = "bank_profiles";

/** Editable columns (everything except id / timestamps). */
const FIELDS = [
  "profile_name",
  "beneficiary_name",
  "beneficiary_address",
  "intermediary_bank_name",
  "intermediary_bank_swift",
  "intermediary_bank_address",
  "bank_name",
  "bank_swift",
  "account_number",
  "iban",
  "ara_number",
  "field_71a",
  "currency",
] as const;

/** Columns that must not be blank. */
const REQUIRED: ReadonlyArray<(typeof FIELDS)[number]> = [
  "profile_name",
  "beneficiary_name",
  "bank_name",
];

function clean(v?: string | null): string | null {
  if (v === undefined || v === null) return null;
  const t = String(v).trim();
  return t === "" ? null : t;
}

/** Ensure at most one default profile by clearing the flag on all others. */
async function clearOtherDefaults(supabase: SupabaseClient, exceptId: string): Promise<void> {
  const { error } = await supabase
    .from(TABLE)
    .update({ is_default: false, updated_at: new Date().toISOString() })
    .neq("id", exceptId)
    .eq("is_default", true);
  logSupabase("UPDATE bank_profiles clear other defaults", { data: null, error });
  if (error) throw new ApiError(502, `Failed to update default profile: ${error.message}`);
}

// ---- CRUD ------------------------------------------------------------------

export async function listBankProfiles(supabase: SupabaseClient): Promise<BankProfile[]> {
  logStep(SCOPE, "Starting listBankProfiles()");
  const { data, error } = await supabase
    .from(TABLE)
    .select()
    .order("is_default", { ascending: false })
    .order("profile_name", { ascending: true });
  logSupabase("SELECT bank_profiles", { data, error });
  if (error) throw new ApiError(502, `Failed to list bank profiles: ${error.message}`);
  return (data ?? []) as BankProfile[];
}

export async function getBankProfileById(supabase: SupabaseClient, id: string): Promise<BankProfile> {
  logStep(SCOPE, `Starting getBankProfileById(${id})`);
  const { data, error } = await supabase.from(TABLE).select().eq("id", id).single();
  logSupabase(`SELECT bank_profiles WHERE id=${id}`, { data, error });
  if (error || !data) throw new ApiError(404, `Bank profile not found: ${id}`);
  return data as BankProfile;
}

export async function createBankProfile(
  supabase: SupabaseClient,
  input: BankProfileInput,
  userId?: string | null
): Promise<BankProfile> {
  logStep(SCOPE, `Starting createBankProfile(${input.profile_name})`);

  for (const key of REQUIRED) {
    if (!clean(input[key] as string | null)) {
      throw new ApiError(400, `Bank profile '${key}' is required.`);
    }
  }

  const row: Record<string, unknown> = {};
  for (const key of FIELDS) {
    if (input[key] !== undefined) row[key] = clean(input[key] as string | null);
  }
  // Apply schema defaults explicitly when omitted (matches the table defaults).
  if (row.field_71a === undefined || row.field_71a === null) row.field_71a = "OUR";
  if (row.currency === undefined || row.currency === null) row.currency = "USD";
  row.is_default = input.is_default === true;

  const { data, error } = await supabase.from(TABLE).insert(row).select().single();
  logSupabase("INSERT bank_profiles", { data, error });
  if (error) throw new ApiError(502, `Failed to create bank profile: ${error.message}`);
  const created = data as BankProfile;

  if (created.is_default) await clearOtherDefaults(supabase, created.id);

  await recordAudit(supabase, {
    userId, action: AUDIT_ACTIONS.BANK_PROFILE_CREATED, entityType: "bank_profile", entityId: created.id,
    message: `Bank profile ${created.profile_name} created`,
  });
  return created;
}

export async function updateBankProfile(
  supabase: SupabaseClient,
  id: string,
  input: Partial<BankProfileInput>,
  userId?: string | null
): Promise<BankProfile> {
  logStep(SCOPE, `Starting updateBankProfile(${id})`);
  await getBankProfileById(supabase, id); // clean 404

  const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
  for (const key of FIELDS) {
    if (input[key] !== undefined) patch[key] = clean(input[key] as string | null);
  }
  for (const key of REQUIRED) {
    if (key in patch && patch[key] === null) {
      throw new ApiError(400, `Bank profile '${key}' cannot be empty.`);
    }
  }
  if (input.is_default !== undefined) patch.is_default = input.is_default === true;

  const { data, error } = await supabase.from(TABLE).update(patch).eq("id", id).select().single();
  logSupabase(`UPDATE bank_profiles WHERE id=${id}`, { data, error });
  if (error) throw new ApiError(502, `Failed to update bank profile: ${error.message}`);
  const updated = data as BankProfile;

  if (updated.is_default) await clearOtherDefaults(supabase, updated.id);

  await recordAudit(supabase, {
    userId, action: AUDIT_ACTIONS.BANK_PROFILE_UPDATED, entityType: "bank_profile", entityId: id,
    message: `Bank profile ${updated.profile_name} updated`,
    metadata: { fields: Object.keys(patch).filter((k) => k !== "updated_at") },
  });
  return updated;
}

/**
 * Trades linked to this bank profile (newest first). The link is the nullable
 * trades.bank_profile_id FK (additive — see bank_profiles_trade_link.sql). Read
 * only: this never touches the trade-creation flow.
 */
export async function listBankProfileTrades(
  supabase: SupabaseClient,
  id: string
): Promise<BankProfileTrade[]> {
  logStep(SCOPE, `Starting listBankProfileTrades(${id})`);
  await getBankProfileById(supabase, id); // clean 404

  const { data, error } = await supabase
    .from("trades")
    .select("id, trade_reference, status, created_at, client:clients(name)")
    .eq("bank_profile_id", id)
    .order("created_at", { ascending: false });
  logSupabase(`SELECT trades WHERE bank_profile_id=${id}`, { data, error });
  if (error) throw new ApiError(502, `Failed to list linked trades: ${error.message}`);

  return (data ?? []).map((t: any) => ({
    id: t.id,
    trade_reference: t.trade_reference ?? null,
    status: t.status,
    created_at: t.created_at,
    client_name: t.client?.name ?? null,
  }));
}

export async function deleteBankProfile(
  supabase: SupabaseClient,
  id: string,
  userId?: string | null
): Promise<void> {
  logStep(SCOPE, `Starting deleteBankProfile(${id})`);
  const existing = await getBankProfileById(supabase, id); // clean 404

  const { error } = await supabase.from(TABLE).delete().eq("id", id);
  logSupabase(`DELETE bank_profiles WHERE id=${id}`, { data: null, error });
  if (error) throw new ApiError(502, `Failed to delete bank profile: ${error.message}`);
  await recordAudit(supabase, {
    userId, action: AUDIT_ACTIONS.BANK_PROFILE_DELETED, entityType: "bank_profile", entityId: id,
    message: `Bank profile ${existing.profile_name} deleted`,
  });
}
