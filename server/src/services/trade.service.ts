// ---------------------------------------------------------------------------
// Trade service — business logic for the Trade lifecycle.
//
// This is the only layer that talks to the `trades` table and orchestrates the
// storage + PDF helpers. Controllers stay thin and call into here.
// ---------------------------------------------------------------------------

import { randomUUID } from "crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { env } from "../config/env";
import { ApiError } from "../middleware/errorHandler";
import type { JsonObject, Trade, TradeGeneration, TradeStatus, UpdateTradeInput } from "../types/trade";
import { isContractData } from "../types/contract";
import { parsePdf } from "../utils/pdfParser";
import { generateOverlayPdf, generateSummaryPdf } from "../utils/pdfGenerator";
import {
  downloadPdfFromStorage,
  pathFromPublicUrl,
  removeFromStorage,
  uploadPdfToStorage,
} from "./storage.service";
import { resolveClientForBuyer } from "./client.service";
import type { BuyerLike } from "../types/client";
import { getBankProfileById } from "./bankProfile.service";
import type { BankProfile } from "../types/bankProfile";
import { toNum, deriveSaleTotal, sumCosts } from "../utils/financials";
import { recordAudit } from "./audit.service";
import { AUDIT_ACTIONS } from "../types/audit";
import { logStep, logError, logSupabase } from "../utils/logger";

const SCOPE = "TradeService";
const TABLE = env.tradesTable;
const GEN_TABLE = "trade_generations";

/** Next version number for a trade's generation history (1-based). */
async function getNextGenerationVersion(supabase: SupabaseClient, tradeId: string): Promise<number> {
  const { data, error } = await supabase
    .from(GEN_TABLE)
    .select("version")
    .eq("trade_id", tradeId)
    .order("version", { ascending: false })
    .limit(1);

  logSupabase(`SELECT max(version) trade_generations (trade ${tradeId})`, { data, error });
  if (error) {
    throw new ApiError(502, `Failed to read generation history: ${error.message}`);
  }
  const max = data && data.length ? (data[0].version as number) : 0;
  return max + 1;
}

/** List all generations for a trade, newest version first. */
export async function listTradeGenerations(supabase: SupabaseClient, id: string): Promise<TradeGeneration[]> {
  logStep(SCOPE, `Starting listTradeGenerations(${id})`);
  const { data, error } = await supabase
    .from(GEN_TABLE)
    .select()
    .eq("trade_id", id)
    .order("version", { ascending: false });

  logSupabase(`SELECT trade_generations (trade ${id})`, { data, error });
  if (error) {
    throw new ApiError(502, `Failed to list generations: ${error.message}`);
  }
  return (data ?? []) as TradeGeneration[];
}

/**
 * Create a new trade from an uploaded PDF:
 *   1. upload the original PDF to Storage
 *   2. extract text/fields with pdf-parse
 *   3. insert a `draft` row in Postgres
 */
export async function createTradeFromPdf(
  supabase: SupabaseClient,
  file: Express.Multer.File,
  userId?: string | null
): Promise<Trade> {
  logStep(SCOPE, "Starting createTradeFromPdf()");
  const id = randomUUID();
  logStep(SCOPE, `Generated new trade id: ${id}`);

  // 1. Store the original PDF.
  logStep(SCOPE, "Uploading original PDF to Storage...");
  const stored = await uploadPdfToStorage(supabase, file.buffer, "originals", `${id}.pdf`);
  logStep(SCOPE, `Original PDF stored at: ${stored.url}`);

  // 2. Extract data (non-fatal: store empty fields if parsing fails).
  logStep(SCOPE, "Parsing PDF text/fields...");
  let extracted: JsonObject = {};
  try {
    const parsed = await parsePdf(file.buffer);
    extracted = {
      ...parsed.fields,
      _meta: {
        numPages: parsed.numPages,
        originalFilename: file.originalname,
        rawTextPreview: parsed.text.slice(0, 2000),
      },
    };
    logStep(SCOPE, "PDF parsed successfully", parsed.fields);
  } catch (err) {
    // Non-fatal by design, but NEVER silent — log the full stack.
    logError(`${SCOPE}.createTradeFromPdf parsePdf`, err);
    extracted = {
      _meta: { parseError: err instanceof Error ? err.message : "unknown parse error" },
    };
  }

  // 3. CLIENT RESOLUTION (MANDATORY, runs BEFORE the trade is inserted).
  //    Every trade must be created with a valid client_id. We never swallow a
  //    failure here — if the client cannot be resolved the trade is NOT created
  //    (and the just-uploaded PDF is rolled back to avoid an orphan).
  const buyer: BuyerLike = { ...((extracted.buyer ?? {}) as BuyerLike) };
  if (!buyer.name && !buyer.email && !buyer.vatNumber) {
    // No identifiable buyer in the document — derive a deterministic identity
    // from real document data (contract number, else original filename) so the
    // trade is still linked to a single, dedupable client (never left orphan).
    const ref = (extracted.contractNumber as string) || file.originalname || id;
    buyer.name = `Unidentified Buyer — ${ref}`;
    logStep(SCOPE, `No buyer entity parsed; using derived identity "${buyer.name}"`);
  }

  let clientId: string | null;
  try {
    clientId = await resolveClientForBuyer(supabase, buyer, userId);
  } catch (err) {
    logError(`${SCOPE}.createTradeFromPdf resolveClient`, err);
    await removeFromStorage(supabase, [stored.path]); // roll back the orphan PDF
    const msg = err instanceof Error ? err.message : "unknown error";
    if (/relation .*clients.* does not exist|could not find the table|client_id/i.test(msg)) {
      throw new ApiError(500, "Client schema missing — run schema_phase2.sql (clients table + trades.client_id).");
    }
    throw err instanceof ApiError ? err : new ApiError(502, `Client resolution failed: ${msg}`);
  }
  if (!clientId) {
    await removeFromStorage(supabase, [stored.path]);
    throw new ApiError(502, "Client could not be resolved; trade not created.");
  }
  logStep(SCOPE, `Resolved client_id: ${clientId}`);

  // 4. Derive financial columns from the parsed data (single source of truth).
  //    At upload time the parser rarely has a clean total, so these are often
  //    null now and get populated when the editor saves edited_data.trade.
  const insertSale = deriveSaleTotal(extracted, extracted);
  const insertCosts = insertSale != null ? 0 : null;
  const insertNet = insertSale != null ? insertSale - 0 : null;

  // 5. Insert the trade row — ALWAYS with a valid client_id.
  logStep(SCOPE, "Inserting trade row into Supabase...");
  const { data, error } = await supabase
    .from(TABLE)
    .insert({
      id,
      original_pdf_url: stored.url,
      extracted_data: extracted,
      edited_data: extracted, // seed editable copy with the extracted values
      status: "draft" as TradeStatus,
      client_id: clientId,
      sale_total: insertSale,
      total_costs: insertCosts,
      net_profit: insertNet,
    })
    .select()
    .single();

  logSupabase("INSERT trades", { data, error });
  if (error) {
    await removeFromStorage(supabase, [stored.path]); // roll back the orphan PDF
    throw new ApiError(502, `Failed to create trade: ${error.message}`);
  }

  // Audit: the original PDF upload + the trade creation.
  const ref = (data as Trade).trade_reference || id.slice(0, 8);
  await recordAudit(supabase, {
    userId, action: AUDIT_ACTIONS.PDF_UPLOADED, entityType: "trade", entityId: id,
    message: `Frigo contract uploaded (${file.originalname})`,
    metadata: { fileName: file.originalname, sizeBytes: file.size },
  });
  await recordAudit(supabase, {
    userId, action: AUDIT_ACTIONS.TRADE_CREATED, entityType: "trade", entityId: id,
    message: `Trade ${ref} created${buyer.name ? ` for ${buyer.name}` : ""}`,
    metadata: { clientId, saleTotal: insertSale },
  });

  logStep(SCOPE, `createTradeFromPdf() done — returning trade ${id}`);
  return data as Trade;
}

/** Fetch a single trade by id. */
export async function getTradeById(supabase: SupabaseClient, id: string): Promise<Trade> {
  logStep(SCOPE, `Starting getTradeById(${id})`);
  const { data, error } = await supabase
    .from(TABLE)
    .select()
    .eq("id", id)
    .single();

  logSupabase(`SELECT trades WHERE id=${id}`, { data, error });
  if (error || !data) {
    throw new ApiError(404, `Trade not found: ${id}`);
  }
  logStep(SCOPE, "Trade loaded successfully");
  return data as Trade;
}

/** List all trades, newest first. */
export async function listTrades(supabase: SupabaseClient): Promise<Trade[]> {
  logStep(SCOPE, "Starting listTrades()");
  const { data, error } = await supabase
    .from(TABLE)
    .select()
    .order("created_at", { ascending: false });

  logSupabase("SELECT trades (all)", { data, error });
  if (error) {
    throw new ApiError(502, `Failed to list trades: ${error.message}`);
  }
  return (data ?? []) as Trade[];
}

const FINANCIAL_NUM_FIELDS = [
  "frigo_purchase_price",
  "sale_unit_price",
  "sale_total",
  "shipping_cost",
  "insurance_cost",
  "bank_fees",
] as const;

/** Update a trade's edited_data, status and/or financial fields. */
export async function updateTrade(
  supabase: SupabaseClient,
  id: string,
  input: UpdateTradeInput,
  userId?: string | null
): Promise<Trade> {
  logStep(SCOPE, `Starting updateTrade(${id})`);

  // Ensure the trade exists (clean 404 instead of a silent no-op).
  const existing = await getTradeById(supabase, id);
  logStep(SCOPE, "Target trade exists — preparing patch");

  const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (input.edited_data !== undefined) patch.edited_data = input.edited_data;
  if (input.status !== undefined) patch.status = input.status;
  if (input.trade_reference !== undefined) patch.trade_reference = input.trade_reference;
  if (input.currency !== undefined) patch.currency = input.currency;
  if (input.signing_date !== undefined) patch.signing_date = input.signing_date;
  if (input.bank_profile_id !== undefined) patch.bank_profile_id = input.bank_profile_id;

  // Recompute the financial COLUMNS (single source of truth) whenever the
  // contract JSON or any financial field changes. This covers BOTH write paths:
  //   • the editor saving { edited_data }   -> derive sale_total from the JSON
  //   • the financial card sending columns   -> use the explicit values
  // A status-only / unrelated update leaves the financial columns untouched, so
  // a manually-corrected value is never clobbered.
  const editedChanged = input.edited_data !== undefined;
  const financialTouched = FINANCIAL_NUM_FIELDS.some((f) => input[f] !== undefined);
  if (editedChanged || financialTouched) {
    // Persist any explicitly-provided financial inputs.
    for (const f of FINANCIAL_NUM_FIELDS) {
      if (input[f] !== undefined) patch[f] = toNum(input[f]);
    }
    const merged = (f: (typeof FINANCIAL_NUM_FIELDS)[number]) =>
      f in patch ? toNum(patch[f]) : toNum((existing as any)[f]);

    // sale_total precedence: explicit input > derived from (new) edited_data > existing.
    let saleTotal: number | null;
    if (input.sale_total !== undefined) {
      saleTotal = toNum(input.sale_total);
    } else if (editedChanged) {
      const effEdited = input.edited_data ?? existing.edited_data;
      saleTotal = deriveSaleTotal(existing.extracted_data, effEdited) ?? toNum(existing.sale_total);
    } else {
      saleTotal = toNum(existing.sale_total);
    }
    patch.sale_total = saleTotal;

    const totalCosts = sumCosts({
      frigo_purchase_price: merged("frigo_purchase_price"),
      shipping_cost: merged("shipping_cost"),
      insurance_cost: merged("insurance_cost"),
      bank_fees: merged("bank_fees"),
    });
    patch.total_costs = totalCosts;
    patch.net_profit = (saleTotal ?? 0) - totalCosts;
    logStep(SCOPE, `Computed financials — sale_total=${saleTotal}, total_costs=${totalCosts}, net_profit=${patch.net_profit}`);
  }

  logStep(SCOPE, "Updating Supabase...", { fields: Object.keys(patch) });
  const { data, error } = await supabase
    .from(TABLE)
    .update(patch)
    .eq("id", id)
    .select()
    .single();

  logSupabase(`UPDATE trades WHERE id=${id}`, { data, error });
  if (error) {
    throw new ApiError(502, `Failed to update trade: ${error.message}`);
  }

  // Audit: emit the most specific events for what actually changed.
  const updated = data as Trade;
  const ref = updated.trade_reference || id.slice(0, 8);
  if (input.status !== undefined && input.status !== existing.status) {
    await recordAudit(supabase, {
      userId, action: AUDIT_ACTIONS.TRADE_STATUS_CHANGED, entityType: "trade", entityId: id,
      message: `Trade ${ref} status changed from ${existing.status} to ${input.status}`,
      metadata: { from: existing.status, to: input.status },
    });
  }
  const priceChanged = (field: "sale_unit_price" | "sale_total", action: string, label: string) => {
    if (input[field] === undefined) return;
    const before = toNum((existing as any)[field]);
    const after = toNum((input as any)[field]);
    if (before === after) return;
    return recordAudit(supabase, {
      userId, action, entityType: "trade", entityId: id,
      message: `${label} updated from ${before ?? "—"} to ${after ?? "—"} (trade ${ref})`,
      metadata: { from: before, to: after },
    });
  };
  await priceChanged("sale_unit_price", AUDIT_ACTIONS.UNIT_PRICE_UPDATED, "Unit price");
  await priceChanged("sale_total", AUDIT_ACTIONS.SALE_PRICE_UPDATED, "Sale price");
  if ((editedChanged || financialTouched)) {
    await recordAudit(supabase, {
      userId, action: AUDIT_ACTIONS.TRADE_RECALCULATED, entityType: "trade", entityId: id,
      message: `Trade ${ref} recalculated — net profit ${updated.net_profit ?? 0}`,
      metadata: { sale_total: updated.sale_total, total_costs: updated.total_costs, net_profit: updated.net_profit },
    });
  } else if (input.status === undefined) {
    await recordAudit(supabase, {
      userId, action: AUDIT_ACTIONS.TRADE_UPDATED, entityType: "trade", entityId: id,
      message: `Trade ${ref} updated`,
    });
  }

  logStep(SCOPE, "updateTrade() done — returning updated trade");
  return updated;
}

/** Trim a value to a non-empty string, or undefined. Used so an empty bank
 *  profile field NEVER blanks the template original (the overlay leaves any
 *  null/undefined value untouched — see pdfGenerator.ts). */
function nonEmpty(v: unknown): string | undefined {
  const t = v == null ? "" : String(v).trim();
  return t === "" ? undefined : t;
}

/**
 * Merge a bank profile into the contract's `banking` block (immutably). Only the
 * fields the overlay engine knows how to draw are mapped onto the beneficiary /
 * intermediary bank sub-blocks; the full profile is also snapshotted under
 * `banking.profile` so no data is lost. Empty profile fields stay undefined so
 * the template's original values are preserved. Every other contract field is
 * left exactly as it was.
 */
function applyBankProfileToContract(editedData: JsonObject, p: BankProfile): JsonObject {
  const ed: any = { ...(editedData as any) };
  const banking: any = { ...(ed.banking ?? {}) };
  const beneficiaryBank: any = { ...(banking.beneficiaryBank ?? {}) };
  const intermediaryBank: any = { ...(banking.intermediaryBank ?? {}) };

  // Beneficiary (drawn as the "Beneficiary" line).
  const beneficiary = nonEmpty(p.beneficiary_name);
  if (beneficiary !== undefined) banking.beneficiary = beneficiary;

  // Beneficiary bank block.
  const benBankName = nonEmpty(p.bank_name);
  if (benBankName !== undefined) beneficiaryBank.bankName = benBankName;
  const benSwift = nonEmpty(p.bank_swift);
  if (benSwift !== undefined) beneficiaryBank.swift = benSwift;
  // The template has a single "Account Number" line — prefer account_number, fall back to IBAN.
  const acct = nonEmpty(p.account_number) ?? nonEmpty(p.iban);
  if (acct !== undefined) beneficiaryBank.accountNumber = acct;
  const benAddress = nonEmpty(p.beneficiary_address);
  if (benAddress !== undefined) beneficiaryBank.address = benAddress;

  // Intermediary bank block.
  const interName = nonEmpty(p.intermediary_bank_name);
  if (interName !== undefined) intermediaryBank.bankName = interName;
  const interSwift = nonEmpty(p.intermediary_bank_swift);
  if (interSwift !== undefined) intermediaryBank.swift = interSwift;
  const interAddress = nonEmpty(p.intermediary_bank_address);
  if (interAddress !== undefined) intermediaryBank.address = interAddress;

  banking.beneficiaryBank = beneficiaryBank;
  banking.intermediaryBank = intermediaryBank;
  // Full snapshot (incl. fields the current template has no anchor for: IBAN,
  // ARA number, field 71A, currency) so the data is retained on the generation.
  banking.profile = {
    id: p.id,
    profileName: nonEmpty(p.profile_name),
    beneficiaryName: nonEmpty(p.beneficiary_name),
    beneficiaryAddress: nonEmpty(p.beneficiary_address),
    intermediaryBankName: nonEmpty(p.intermediary_bank_name),
    intermediaryBankAddress: nonEmpty(p.intermediary_bank_address),
    intermediaryBankSwift: nonEmpty(p.intermediary_bank_swift),
    bankName: nonEmpty(p.bank_name),
    bankSwift: nonEmpty(p.bank_swift),
    accountNumber: nonEmpty(p.account_number),
    iban: nonEmpty(p.iban),
    araNumber: nonEmpty(p.ara_number),
    field71a: nonEmpty(p.field_71a),
    currency: nonEmpty(p.currency),
  };

  ed.banking = banking;
  return ed;
}

/**
 * Generate a new PDF for a trade from its edited_data:
 *   - if the original PDF is available, overlay edits on top of it
 *   - otherwise build a fresh summary PDF
 * The result is uploaded to Storage and saved on the trade row.
 */
export async function generateTradePdf(supabase: SupabaseClient, id: string, userId?: string | null): Promise<Trade> {
  logStep(SCOPE, `Starting generateTradePdf(${id})`);
  const trade = await getTradeById(supabase, id);
  let contractData = (trade.edited_data ?? trade.extracted_data ?? {}) as JsonObject;

  // Bank Profile integration: when a trade references a bank profile, inject it
  // into the contract's banking block so the generated PDF reflects the chosen
  // profile. A NULL bank_profile_id (existing trades) is a no-op — the banking
  // data already on edited_data is used exactly as before. A missing/deleted
  // profile never fails generation; we log and proceed with existing data.
  if (trade.bank_profile_id) {
    try {
      const profile = await getBankProfileById(supabase, trade.bank_profile_id);
      contractData = applyBankProfileToContract(contractData, profile);
      logStep(SCOPE, `Applied bank profile "${profile.profile_name}" (${trade.bank_profile_id}) to banking block`);
    } catch (err) {
      logError(`${SCOPE}.generateTradePdf bankProfile`, err);
      logStep(SCOPE, `Bank profile ${trade.bank_profile_id} not applied — generating with existing banking data`);
    }
  }

  // Keep `editedData` const so the overlay engine's ContractData narrowing (via
  // isContractData below) still applies.
  const editedData = contractData;

  let pdfBytes: Uint8Array;

  const originalPath = trade.original_pdf_url
    ? pathFromPublicUrl(trade.original_pdf_url)
    : null;

  const useOverlay = !!(originalPath && isContractData(editedData));
  logStep(
    SCOPE,
    `Generation path: ${useOverlay ? "OVERLAY (legacy engine)" : "SUMMARY (fallback)"} ` +
      `(hasTemplate: ${!!originalPath}, isContractData: ${isContractData(editedData)})`
  );

  // PRIMARY PATH (legacy engine): overlay the edited ContractData onto the
  // ORIGINAL template PDF — only possible when we have both the template and a
  // full ContractData-shaped edited_data (i.e. the edit form was saved).
  if (useOverlay) {
    try {
      logStep(SCOPE, "Downloading original template from Storage...");
      const originalBuffer = await downloadPdfFromStorage(supabase, originalPath!);
      logStep(SCOPE, "Running overlay engine...");
      pdfBytes = await generateOverlayPdf(editedData, originalBuffer);
      logStep(SCOPE, `Overlay PDF generated (${pdfBytes.length} bytes)`);
    } catch (err) {
      // If overlay fails for any reason, never lose the request — fall back.
      // NEVER silent: log the full stack before falling back.
      logError(`${SCOPE}.generateTradePdf overlay`, err);
      logStep(SCOPE, "Overlay failed — using summary fallback");
      pdfBytes = await generateSummaryPdf(editedData);
    }
  } else {
    // No template or edited_data isn't a full ContractData → summary fallback.
    pdfBytes = await generateSummaryPdf(editedData);
    logStep(SCOPE, `Summary PDF generated (${pdfBytes.length} bytes)`);
  }

  // Each generation gets a UNIQUE, versioned path. This is the fix for the
  // "PDF never reflects the latest edit" bug: the old code always wrote to
  // generated/<id>.pdf, so getPublicUrl returned the SAME URL every time and the
  // CDN/browser served the cached first version. A new path per version → a new
  // URL → always fresh. It also gives us a full generation history for free.
  const version = await getNextGenerationVersion(supabase, id);
  const storageName = `${id}/v${version}.pdf`;
  logStep(SCOPE, `Uploading generated PDF v${version} to Storage (generated/${storageName})...`);
  const stored = await uploadPdfToStorage(
    supabase,
    Buffer.from(pdfBytes),
    "generated",
    storageName,
    "0" // never cache (belt-and-suspenders on top of the unique path)
  );
  logStep(SCOPE, `Generated PDF v${version} stored at: ${stored.url}`);

  // Record this generation in history — previous generations are NEVER touched.
  const { data: genRow, error: genErr } = await supabase
    .from(GEN_TABLE)
    .insert({
      trade_id: id,
      version,
      generated_pdf_url: stored.url,
      storage_path: stored.path,
      // Immutable full snapshot of the trade state used for THIS version.
      snapshot: editedData,
      created_by: userId ?? null,
    })
    .select()
    .single();

  logSupabase(`INSERT trade_generations (trade ${id} v${version})`, { data: genRow, error: genErr });
  if (genErr) {
    throw new ApiError(502, `Failed to record generation: ${genErr.message}`);
  }

  // Keep trades.generated_pdf_url pointing at the LATEST generation.
  logStep(SCOPE, "Updating trades.generated_pdf_url + status=completed...");
  const { data, error } = await supabase
    .from(TABLE)
    .update({
      generated_pdf_url: stored.url,
      status: "completed" as TradeStatus, // FINAL step: mark the trade done
      updated_at: new Date().toISOString(),
    })
    .eq("id", id)
    .select()
    .single();

  logSupabase(`UPDATE trades (generated_pdf_url) WHERE id=${id}`, { data, error });
  if (error) {
    throw new ApiError(502, `Failed to save generated PDF: ${error.message}`);
  }
  // Audit: contract generated (v1) vs regenerated (v>1) + the version record.
  const genTrade = data as Trade;
  const ref = genTrade.trade_reference || id.slice(0, 8);
  await recordAudit(supabase, {
    userId,
    action: version > 1 ? AUDIT_ACTIONS.CONTRACT_REGENERATED : AUDIT_ACTIONS.CONTRACT_GENERATED,
    entityType: "trade", entityId: id,
    message: `Sales contract ${version > 1 ? "re-generated" : "generated"} (v${version}) for trade ${ref}`,
    metadata: { version, url: stored.url },
  });
  await recordAudit(supabase, {
    userId, action: AUDIT_ACTIONS.VERSION_CREATED, entityType: "trade", entityId: id,
    message: `Version ${version} created for trade ${ref}`,
    metadata: { version },
  });

  logStep(SCOPE, `generateTradePdf() done — v${version}, returning completed trade`);
  return genTrade;
}

/**
 * Delete a trade: best-effort remove its stored PDFs, then delete the row.
 * Throws 404 if the trade doesn't exist (so the API reports it cleanly).
 */
export async function deleteTrade(supabase: SupabaseClient, id: string, userId?: string | null): Promise<void> {
  logStep(SCOPE, `Starting deleteTrade(${id})`);

  // Ensure it exists first (clean 404 instead of a silent no-op delete).
  const trade = await getTradeById(supabase, id);

  // Best-effort: remove the original + every generated PDF from Storage.
  // (Generations now live at generated/<id>/v<n>.pdf — gather them all.)
  const generations = await listTradeGenerations(supabase, id);
  const genPaths = generations
    .map((g) => g.storage_path ?? (g.generated_pdf_url ? pathFromPublicUrl(g.generated_pdf_url) : null))
    .filter((p): p is string => !!p);
  const paths = [
    ...[trade.original_pdf_url, trade.generated_pdf_url]
      .map((url) => (url ? pathFromPublicUrl(url) : null))
      .filter((p): p is string => !!p),
    ...genPaths,
  ];
  await removeFromStorage(supabase, paths);

  // Delete the DB row.
  logStep(SCOPE, "Deleting trade row from Supabase...");
  const { data, error } = await supabase.from(TABLE).delete().eq("id", id).select();

  logSupabase(`DELETE trades WHERE id=${id}`, { data, error });
  if (error) {
    throw new ApiError(502, `Failed to delete trade: ${error.message}`);
  }
  await recordAudit(supabase, {
    userId, action: AUDIT_ACTIONS.TRADE_DELETED, entityType: "trade", entityId: id,
    message: `Trade ${trade.trade_reference || id.slice(0, 8)} deleted`,
  });
  logStep(SCOPE, `deleteTrade() done — trade ${id} removed`);
}
