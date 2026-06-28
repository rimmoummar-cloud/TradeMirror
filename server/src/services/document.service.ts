// ---------------------------------------------------------------------------
// Document service — Trade Folder business logic.
//
// Manages the `trade_documents` table + the underlying Storage objects for
// signed contracts, Bills of Lading (BOL) and arbitrary additional documents.
// Follows the same conventions as trade.service: a Supabase client is injected,
// every Supabase call is logged, and failures throw ApiError.
// ---------------------------------------------------------------------------

import { randomUUID } from "crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { ApiError } from "../middleware/errorHandler";
import type { TradeDocument, UploadDocumentInput } from "../types/trade";
import { uploadFileToStorage, removeFromStorage } from "./storage.service";
import { recordAudit } from "./audit.service";
import { AUDIT_ACTIONS } from "../types/audit";
import { logStep, logSupabase } from "../utils/logger";

const SCOPE = "DocumentService";
const TABLE = "trade_documents";

/** Sanitize a filename for use inside a storage path. */
function safeName(name: string): string {
  return name.replace(/[^\w.\-]+/g, "_").slice(0, 120) || "file";
}

/** List every document for a trade, newest first. */
export async function listTradeDocuments(
  supabase: SupabaseClient,
  tradeId: string
): Promise<TradeDocument[]> {
  logStep(SCOPE, `Starting listTradeDocuments(${tradeId})`);
  const { data, error } = await supabase
    .from(TABLE)
    .select()
    .eq("trade_id", tradeId)
    .order("created_at", { ascending: false });

  logSupabase(`SELECT trade_documents (trade ${tradeId})`, { data, error });
  if (error) {
    throw new ApiError(502, `Failed to list documents: ${error.message}`);
  }
  return (data ?? []) as TradeDocument[];
}

/**
 * Upload a document into the Trade Folder.
 *
 * `signed_contract` is treated as a singleton: uploading a new one REPLACES the
 * previous signed contract (old DB rows + storage objects are removed first),
 * which is the "upload / replace" behaviour the UI exposes. BOLs and additional
 * documents are appended.
 */
export async function uploadTradeDocument(
  supabase: SupabaseClient,
  tradeId: string,
  input: UploadDocumentInput
): Promise<TradeDocument> {
  logStep(SCOPE, `Starting uploadTradeDocument(${tradeId}, ${input.docType})`);

  if (input.docType === "bol" && !input.bolDate) {
    throw new ApiError(400, "A BOL Date is required when uploading a Bill of Lading.");
  }

  // Replace semantics for the signed contract.
  if (input.docType === "signed_contract") {
    const { data: existing } = await supabase
      .from(TABLE)
      .select("id, storage_path")
      .eq("trade_id", tradeId)
      .eq("doc_type", "signed_contract");
    if (existing && existing.length) {
      await removeFromStorage(supabase, existing.map((d: any) => d.storage_path));
      const { error: delErr } = await supabase
        .from(TABLE)
        .delete()
        .in("id", existing.map((d: any) => d.id));
      logSupabase("DELETE prior signed_contract", { data: null, error: delErr });
    }
  }

  const path = `documents/${tradeId}/${input.docType}/${randomUUID()}-${safeName(input.fileName)}`;
  const stored = await uploadFileToStorage(supabase, input.buffer, path, input.mimeType);

  const { data, error } = await supabase
    .from(TABLE)
    .insert({
      trade_id: tradeId,
      doc_type: input.docType,
      file_name: input.fileName,
      storage_path: stored.path,
      file_url: stored.url,
      mime_type: input.mimeType,
      size_bytes: input.sizeBytes,
      bol_date: input.docType === "bol" ? input.bolDate : null,
      uploaded_by: input.uploadedBy ?? null,
    })
    .select()
    .single();

  logSupabase("INSERT trade_documents", { data, error });
  if (error) {
    // Roll back the just-uploaded object so we don't orphan storage.
    await removeFromStorage(supabase, [stored.path]);
    throw new ApiError(502, `Failed to save document metadata: ${error.message}`);
  }

  const doc = data as TradeDocument;
  await recordAudit(supabase, {
    userId: input.uploadedBy, action: AUDIT_ACTIONS.DOCUMENT_UPLOADED,
    entityType: "trade", entityId: tradeId,
    message: `Document uploaded (${input.docType}): ${input.fileName}`,
    metadata: { documentId: doc.id, docType: input.docType, fileName: input.fileName },
  });
  logStep(SCOPE, `uploadTradeDocument() done — document ${doc.id}`);
  return doc;
}

/** Delete a single document (storage object + DB row). */
export async function deleteTradeDocument(
  supabase: SupabaseClient,
  tradeId: string,
  documentId: string,
  userId?: string | null
): Promise<void> {
  logStep(SCOPE, `Starting deleteTradeDocument(${tradeId}, ${documentId})`);

  const { data: doc, error: findErr } = await supabase
    .from(TABLE)
    .select("id, storage_path, file_name, doc_type")
    .eq("id", documentId)
    .eq("trade_id", tradeId)
    .single();

  logSupabase("SELECT trade_document for delete", { data: doc, error: findErr });
  if (findErr || !doc) {
    throw new ApiError(404, "Document not found.");
  }

  await removeFromStorage(supabase, [(doc as any).storage_path]);

  const { error } = await supabase.from(TABLE).delete().eq("id", documentId);
  logSupabase("DELETE trade_documents", { data: null, error });
  if (error) {
    throw new ApiError(502, `Failed to delete document: ${error.message}`);
  }
  await recordAudit(supabase, {
    userId, action: AUDIT_ACTIONS.DOCUMENT_DELETED, entityType: "trade", entityId: tradeId,
    message: `Document deleted (${(doc as any).doc_type}): ${(doc as any).file_name}`,
    metadata: { documentId },
  });
  logStep(SCOPE, `deleteTradeDocument() done — ${documentId}`);
}
