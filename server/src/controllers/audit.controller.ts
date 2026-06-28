// ---------------------------------------------------------------------------
// Audit controller — read the trail + accept client-emitted events (auth).
// ---------------------------------------------------------------------------

import { Request, Response } from "express";
import { ApiError } from "../middleware/errorHandler";
import * as auditService from "../services/audit.service";
import { logStep } from "../utils/logger";

function successResponse(step: string, data: any) {
  return { success: true, data, debug: { step, trace: null, warnings: [] } };
}

function clientIp(req: Request): string | null {
  const fwd = req.headers["x-forwarded-for"];
  if (typeof fwd === "string" && fwd.length) return fwd.split(",")[0].trim();
  return req.ip ?? req.socket?.remoteAddress ?? null;
}

/** GET /api/audit/logs — paginated, filterable trail. */
export async function listLogs(req: Request, res: Response) {
  logStep("[AUDIT]", "listLogs");
  const q = req.query;
  const result = await auditService.listAuditLogs(res.locals.supabase, {
    search: typeof q.search === "string" ? q.search : undefined,
    action: typeof q.action === "string" ? q.action : undefined,
    entityType: typeof q.entity_type === "string" ? q.entity_type : undefined,
    from: typeof q.from === "string" ? q.from : undefined,
    to: typeof q.to === "string" ? q.to : undefined,
    page: q.page ? parseInt(String(q.page), 10) : undefined,
    pageSize: q.page_size ? parseInt(String(q.page_size), 10) : undefined,
  });
  res.json(successResponse("listLogs", result));
}

/** GET /api/audit/entity/:type/:id — recent activity for one entity. */
export async function listEntityLogs(req: Request, res: Response) {
  logStep("[AUDIT]", `listEntityLogs — ${req.params.type}/${req.params.id}`);
  const limit = req.query.limit ? parseInt(String(req.query.limit), 10) : 10;
  const logs = await auditService.listEntityLogs(res.locals.supabase, req.params.type, req.params.id, limit);
  res.json(successResponse("listEntityLogs", logs));
}

/** POST /api/audit/event — record an event for the authenticated user.
 *  Used by the client for auth events (login/logout). action is required. */
export async function recordEvent(req: Request, res: Response) {
  const { action, entity_type, entity_id, message, metadata } = req.body ?? {};
  if (!action || typeof action !== "string") {
    throw new ApiError(400, "action (string) is required.");
  }
  await auditService.recordAudit(res.locals.supabase, {
    userId: res.locals.user?.id ?? null,
    action,
    entityType: entity_type ?? "auth",
    entityId: entity_id ?? null,
    message: typeof message === "string" ? message : null,
    metadata: metadata && typeof metadata === "object" ? metadata : null,
    ipAddress: clientIp(req),
    userAgent: req.headers["user-agent"] ?? null,
  });
  res.status(201).json(successResponse("recordEvent", { ok: true }));
}
