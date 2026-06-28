// ---------------------------------------------------------------------------
// Trade controller — HTTP request/response handling.
//
// Controllers validate input, call the service layer, and shape the JSON
// response. They contain no business logic and no direct Supabase access.
// ---------------------------------------------------------------------------

import { Request, Response } from "express";
import { ApiError } from "../middleware/errorHandler";
import type { TradeStatus, UpdateTradeInput } from "../types/trade";
import * as tradeService from "../services/trade.service";
import { logStep } from "../utils/logger";

const VALID_STATUSES: TradeStatus[] = ["draft", "active", "completed"];

function successResponse(step: string, data: any) {
  return {
    success: true,
    data,
    debug: { step, trace: null, warnings: [] }
  };
}

/** POST /api/trades/create — upload a PDF and create a trade. */
export async function createTrade(req: Request, res: Response) {
  logStep("[TRADE CREATE]", `createTrade — file: ${req.file?.originalname ?? "none"}`);
  if (!req.file) {
    throw new ApiError(400, "A PDF file is required (multipart field name: 'pdf').");
  }
  const trade = await tradeService.createTradeFromPdf(res.locals.supabase, req.file, res.locals.user?.id ?? null);
  logStep("[TRADE CREATE]", `createTrade — responding 201 (id: ${trade.id})`);
  res.status(201).json(successResponse("createTrade", trade));
}

/** GET /api/trades/:id — fetch one trade. */
export async function getTrade(req: Request, res: Response) {
  logStep("Controller", `getTrade — id: ${req.params.id}`);
  const trade = await tradeService.getTradeById(res.locals.supabase, req.params.id);
  res.json(successResponse("getTrade", trade));
}

/** GET /api/trades — list all trades. */
export async function listTrades(_req: Request, res: Response) {
  logStep("Controller", "listTrades");
  const trades = await tradeService.listTrades(res.locals.supabase);
  logStep("Controller", `listTrades — responding with ${trades.length} trade(s)`);
  res.json(successResponse("listTrades", trades));
}

const FINANCIAL_NUM_FIELDS = [
  "frigo_purchase_price",
  "sale_unit_price",
  "sale_total",
  "shipping_cost",
  "insurance_cost",
  "bank_fees",
] as const;
const TEXT_FIELDS = ["trade_reference", "currency", "signing_date"] as const;

/** PUT /api/trades/:id — update edited_data, status and/or financial fields. */
export async function updateTrade(req: Request, res: Response) {
  logStep("[TRADE UPDATE]", `updateTrade — id: ${req.params.id}`);
  const body = (req.body ?? {}) as Record<string, unknown>;
  const { edited_data, status } = body;

  const input: UpdateTradeInput = {};

  if (edited_data !== undefined) {
    if (typeof edited_data !== "object" || edited_data === null) {
      throw new ApiError(400, "edited_data must be a JSON object.");
    }
    input.edited_data = edited_data as UpdateTradeInput["edited_data"];
  }
  if (status !== undefined) {
    if (!VALID_STATUSES.includes(status as TradeStatus)) {
      throw new ApiError(400, `status must be one of: ${VALID_STATUSES.join(", ")}.`);
    }
    input.status = status as TradeStatus;
  }

  // Financial numeric fields: must be a finite number or null.
  for (const f of FINANCIAL_NUM_FIELDS) {
    if (body[f] === undefined) continue;
    const v = body[f];
    if (v !== null && (typeof v !== "number" || !Number.isFinite(v))) {
      throw new ApiError(400, `${f} must be a number or null.`);
    }
    (input as any)[f] = v;
  }
  for (const f of TEXT_FIELDS) {
    if (body[f] === undefined) continue;
    const v = body[f];
    if (v !== null && typeof v !== "string") {
      throw new ApiError(400, `${f} must be a string or null.`);
    }
    (input as any)[f] = v;
  }

  // Optional link to a bank profile (uuid string) or null to clear it.
  if (body.bank_profile_id !== undefined) {
    const v = body.bank_profile_id;
    if (v !== null && typeof v !== "string") {
      throw new ApiError(400, "bank_profile_id must be a string (uuid) or null.");
    }
    input.bank_profile_id = v as string | null;
  }

  if (Object.keys(input).length === 0) {
    throw new ApiError(
      400,
      "Provide at least one of: edited_data, status, or a financial field."
    );
  }

  const trade = await tradeService.updateTrade(res.locals.supabase, req.params.id, input, res.locals.user?.id ?? null);
  logStep("[TRADE UPDATE]", `updateTrade — responding (id: ${trade.id})`);
  res.json(successResponse("updateTrade", trade));
}

/** POST /api/trades/:id/generate-pdf — regenerate the PDF from edited_data. */
export async function generatePdf(req: Request, res: Response) {
  logStep("[PDF GENERATE]", `generatePdf — id: ${req.params.id}`);
  const trade = await tradeService.generateTradePdf(res.locals.supabase, req.params.id, res.locals.user?.id ?? null);
  logStep("[PDF GENERATE]", `generatePdf — responding (id: ${trade.id}, status: ${trade.status})`);
  res.json(successResponse("generatePdf", trade));
}

/** GET /api/trades/:id/generations — list this trade's PDF generation history. */
export async function listGenerations(req: Request, res: Response) {
  logStep("Controller", `listGenerations — id: ${req.params.id}`);
  const generations = await tradeService.listTradeGenerations(res.locals.supabase, req.params.id);
  logStep("Controller", `listGenerations — responding with ${generations.length} generation(s)`);
  res.json(successResponse("listGenerations", generations));
}

/** DELETE /api/trades/:id — remove a trade (and its stored PDFs). */
export async function deleteTrade(req: Request, res: Response) {
  logStep("Controller", `deleteTrade — id: ${req.params.id}`);
  await tradeService.deleteTrade(res.locals.supabase, req.params.id, res.locals.user?.id ?? null);
  logStep("Controller", `deleteTrade — responding 200 (id: ${req.params.id})`);
  res.json(successResponse("deleteTrade", { id: req.params.id }));
}
