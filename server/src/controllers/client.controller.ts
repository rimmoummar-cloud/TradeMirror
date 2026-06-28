// ---------------------------------------------------------------------------
// Client controller — HTTP handlers for the Client Management module.
// Thin layer: validate, delegate to client.service, return the standard
// { success, data, debug } envelope.
// ---------------------------------------------------------------------------

import { Request, Response } from "express";
import { ApiError } from "../middleware/errorHandler";
import type { ClientInput } from "../types/client";
import * as clientService from "../services/client.service";
import { logStep } from "../utils/logger";

function successResponse(step: string, data: any) {
  return { success: true, data, debug: { step, trace: null, warnings: [] } };
}

/** GET /api/clients?search= — list clients (optional name/country search). */
export async function listClients(req: Request, res: Response) {
  const search = typeof req.query.search === "string" ? req.query.search : undefined;
  logStep("[CLIENTS]", `listClients — search: ${search ?? "(none)"}`);
  const clients = await clientService.listClients(res.locals.supabase, search);
  res.json(successResponse("listClients", clients));
}

/** GET /api/clients/:id — one client. */
export async function getClient(req: Request, res: Response) {
  logStep("[CLIENTS]", `getClient — id: ${req.params.id}`);
  const client = await clientService.getClientById(res.locals.supabase, req.params.id);
  res.json(successResponse("getClient", client));
}

/** POST /api/clients — create a client. */
export async function createClient(req: Request, res: Response) {
  logStep("[CLIENTS]", `createClient — name: ${req.body?.name}`);
  const input = (req.body ?? {}) as ClientInput;
  if (!input.name || typeof input.name !== "string") {
    throw new ApiError(400, "A client 'name' (string) is required.");
  }
  const client = await clientService.createClient(res.locals.supabase, input, res.locals.user?.id ?? null);
  res.status(201).json(successResponse("createClient", client));
}

/** PUT /api/clients/:id — update a client. */
export async function updateClient(req: Request, res: Response) {
  logStep("[CLIENTS]", `updateClient — id: ${req.params.id}`);
  const input = (req.body ?? {}) as Partial<ClientInput>;
  if (input === null || typeof input !== "object" || Array.isArray(input)) {
    throw new ApiError(400, "Request body must be a JSON object.");
  }
  const client = await clientService.updateClient(res.locals.supabase, req.params.id, input, res.locals.user?.id ?? null);
  res.json(successResponse("updateClient", client));
}

/** DELETE /api/clients/:id — delete (blocked if linked trades exist). */
export async function deleteClient(req: Request, res: Response) {
  logStep("[CLIENTS]", `deleteClient — id: ${req.params.id}`);
  await clientService.deleteClient(res.locals.supabase, req.params.id, res.locals.user?.id ?? null);
  res.json(successResponse("deleteClient", { id: req.params.id }));
}

/** GET /api/clients/:id/analytics — live trade statistics. */
export async function getClientAnalytics(req: Request, res: Response) {
  logStep("[CLIENTS]", `getClientAnalytics — id: ${req.params.id}`);
  const analytics = await clientService.getClientAnalytics(res.locals.supabase, req.params.id);
  res.json(successResponse("getClientAnalytics", analytics));
}

/** GET /api/clients/:id/trades — all trades linked to this client. */
export async function listClientTrades(req: Request, res: Response) {
  logStep("[CLIENTS]", `listClientTrades — id: ${req.params.id}`);
  const trades = await clientService.listClientTrades(res.locals.supabase, req.params.id);
  res.json(successResponse("listClientTrades", trades));
}

/** GET /api/clients/:id/financial-summary — aggregated financial figures. */
export async function getFinancialSummary(req: Request, res: Response) {
  logStep("[CLIENTS]", `getFinancialSummary — id: ${req.params.id}`);
  const summary = await clientService.getClientFinancialSummary(res.locals.supabase, req.params.id);
  res.json(successResponse("getFinancialSummary", summary));
}

/** GET /api/clients/:id/profit-analysis — overall + monthly profit breakdown. */
export async function getProfitAnalysis(req: Request, res: Response) {
  logStep("[CLIENTS]", `getProfitAnalysis — id: ${req.params.id}`);
  const analysis = await clientService.getClientProfitAnalysis(res.locals.supabase, req.params.id);
  res.json(successResponse("getProfitAnalysis", analysis));
}

/** GET /api/clients/:id/dashboard — full BI dashboard (single SQL aggregation). */
export async function getDashboard(req: Request, res: Response) {
  logStep("[CLIENTS]", `getDashboard — id: ${req.params.id}`);
  const dashboard = await clientService.getClientDashboard(res.locals.supabase, req.params.id);
  res.json(successResponse("getDashboard", dashboard));
}
