// ---------------------------------------------------------------------------
// Document controller — Trade Folder HTTP handlers.
//
// Thin layer: validate the multipart input, delegate to document.service, and
// return the standard { success, data, debug } envelope used across the API.
// ---------------------------------------------------------------------------

import { Request, Response } from "express";
import { ApiError } from "../middleware/errorHandler";
import type { TradeDocumentType } from "../types/trade";
import * as documentService from "../services/document.service";
import { logStep } from "../utils/logger";

const VALID_DOC_TYPES: TradeDocumentType[] = ["signed_contract", "bol", "additional"];

function successResponse(step: string, data: any) {
  return { success: true, data, debug: { step, trace: null, warnings: [] } };
}

/** GET /api/trades/:id/documents — list the trade's folder documents. */
export async function listDocuments(req: Request, res: Response) {
  logStep("[DOCS]", `listDocuments — trade: ${req.params.id}`);
  const docs = await documentService.listTradeDocuments(res.locals.supabase, req.params.id);
  logStep("[DOCS]", `listDocuments — ${docs.length} document(s)`);
  res.json(successResponse("listDocuments", docs));
}

/** POST /api/trades/:id/documents — upload a document (multipart field: 'file'). */
export async function uploadDocument(req: Request, res: Response) {
  logStep("[DOCS]", `uploadDocument — trade: ${req.params.id}, type: ${req.body?.doc_type}`);

  if (!req.file) {
    throw new ApiError(400, "A file is required (multipart field name: 'file').");
  }
  const docType = req.body?.doc_type as TradeDocumentType;
  if (!VALID_DOC_TYPES.includes(docType)) {
    throw new ApiError(400, `doc_type must be one of: ${VALID_DOC_TYPES.join(", ")}.`);
  }
  const bolDate = req.body?.bol_date ? String(req.body.bol_date) : null;
  if (docType === "bol" && !bolDate) {
    throw new ApiError(400, "bol_date is required when uploading a Bill of Lading.");
  }

  const document = await documentService.uploadTradeDocument(res.locals.supabase, req.params.id, {
    docType,
    fileName: req.file.originalname,
    buffer: req.file.buffer,
    mimeType: req.file.mimetype,
    sizeBytes: req.file.size,
    bolDate,
    uploadedBy: res.locals.user?.id ?? null,
  });

  logStep("[DOCS]", `uploadDocument — responding 201 (id: ${document.id})`);
  res.status(201).json(successResponse("uploadDocument", document));
}

/** DELETE /api/trades/:id/documents/:docId — remove a document. */
export async function deleteDocument(req: Request, res: Response) {
  logStep("[DOCS]", `deleteDocument — trade: ${req.params.id}, doc: ${req.params.docId}`);
  await documentService.deleteTradeDocument(res.locals.supabase, req.params.id, req.params.docId, res.locals.user?.id ?? null);
  res.json(successResponse("deleteDocument", { id: req.params.docId }));
}
