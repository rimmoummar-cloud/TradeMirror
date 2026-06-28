// ---------------------------------------------------------------------------
// Audit service — writes the immutable audit trail and reads it back.
//
// recordAudit() is BEST-EFFORT: a logging failure must NEVER break or roll back
// the business mutation it is recording, so it swallows (but logs) its errors.
// ---------------------------------------------------------------------------

import type { SupabaseClient } from "@supabase/supabase-js";
import { ApiError } from "../middleware/errorHandler";
import type { AuditInput, AuditLog } from "../types/audit";
import { logStep, logError, logSupabase } from "../utils/logger";

const SCOPE = "AuditService";
const TABLE = "audit_logs";

/** Insert one audit event. Never throws — logging is non-blocking. */
export async function recordAudit(supabase: SupabaseClient, input: AuditInput): Promise<void> {
  try {
    const { error } = await supabase.from(TABLE).insert({
      user_id: input.userId ?? null,
      action: input.action,
      entity_type: input.entityType ?? null,
      entity_id: input.entityId ?? null,
      message: input.message ?? null,
      metadata: input.metadata ?? null,
      ip_address: input.ipAddress ?? null,
      user_agent: input.userAgent ?? null,
    });
    if (error) {
      logError(`${SCOPE}.recordAudit`, error);
    } else {
      logStep(SCOPE, `audit: ${input.action} ${input.entityType ?? ""} ${input.entityId ?? ""}`);
    }
  } catch (err) {
    // Absolutely never let an audit failure bubble into the caller.
    logError(`${SCOPE}.recordAudit (unexpected)`, err);
  }
}

/** Attach the actor email (from public.users) onto a page of logs for display. */
async function withUserEmails(supabase: SupabaseClient, rows: AuditLog[]): Promise<AuditLog[]> {
  const ids = Array.from(new Set(rows.map((r) => r.user_id).filter(Boolean))) as string[];
  if (!ids.length) return rows;
  const { data } = await supabase.from("users").select("id, email").in("id", ids);
  const emailById = new Map((data ?? []).map((u: any) => [u.id, u.email]));
  return rows.map((r) => ({ ...r, user_email: r.user_id ? emailById.get(r.user_id) ?? null : null }));
}

export interface ListAuditParams {
  search?: string;
  action?: string;
  entityType?: string;
  from?: string; // ISO date
  to?: string; // ISO date
  page?: number; // 1-based
  pageSize?: number;
}

export interface ListAuditResult {
  logs: AuditLog[];
  total: number;
  page: number;
  pageSize: number;
}

/** Paginated, filtered log listing (newest first). */
export async function listAuditLogs(
  supabase: SupabaseClient,
  params: ListAuditParams
): Promise<ListAuditResult> {
  const page = Math.max(1, params.page ?? 1);
  const pageSize = Math.min(100, Math.max(1, params.pageSize ?? 25));
  const fromIdx = (page - 1) * pageSize;
  const toIdx = fromIdx + pageSize - 1;

  let query = supabase
    .from(TABLE)
    .select("*", { count: "exact" })
    .order("created_at", { ascending: false });

  if (params.action) query = query.eq("action", params.action);
  if (params.entityType) query = query.eq("entity_type", params.entityType);
  if (params.from) query = query.gte("created_at", params.from);
  if (params.to) query = query.lte("created_at", params.to);
  if (params.search && params.search.trim()) {
    const term = `%${params.search.trim()}%`;
    // Search across action, message and entity_type.
    query = query.or(`action.ilike.${term},message.ilike.${term},entity_type.ilike.${term}`);
  }

  const { data, error, count } = await query.range(fromIdx, toIdx);
  logSupabase("SELECT audit_logs", { data: data ? `[${data.length}]` : null, error });
  if (error) throw new ApiError(502, `Failed to list audit logs: ${error.message}`);

  const logs = await withUserEmails(supabase, (data ?? []) as AuditLog[]);
  return { logs, total: count ?? logs.length, page, pageSize };
}

/** Recent logs for a single entity (e.g. a trade's activity timeline). */
export async function listEntityLogs(
  supabase: SupabaseClient,
  entityType: string,
  entityId: string,
  limit = 10
): Promise<AuditLog[]> {
  const { data, error } = await supabase
    .from(TABLE)
    .select("*")
    .eq("entity_type", entityType)
    .eq("entity_id", entityId)
    .order("created_at", { ascending: false })
    .limit(limit);
  logSupabase(`SELECT audit_logs (${entityType} ${entityId})`, { data: data ? `[${data.length}]` : null, error });
  if (error) throw new ApiError(502, `Failed to load activity: ${error.message}`);
  return withUserEmails(supabase, (data ?? []) as AuditLog[]);
}
