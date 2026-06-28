// ---------------------------------------------------------------------------
// Trade domain types
//
// A `Trade` is the core entity of TradeMirror OS. It represents one business
// transaction that originated from an uploaded PDF contract.
//
// `extracted_data` and `edited_data` are intentionally typed loosely as JSON
// objects: they mirror the rich `ContractData` shape used by the frontend, but
// the backend stays schema-agnostic so the contract template can evolve without
// a server change. (See ../../TradeMirror/src/types/contract.ts for the shape
// the client produces/consumes.)
// ---------------------------------------------------------------------------

export type TradeStatus = "draft" | "active" | "completed";

/** Arbitrary JSON payload (parsed contract fields). */
export type JsonObject = Record<string, unknown>;

/** A row as stored in the Supabase `trades` table. */
export interface Trade {
  id: string; // uuid (Postgres default gen_random_uuid())
  original_pdf_url: string | null; // public URL of the uploaded source PDF
  extracted_data: JsonObject | null; // raw fields parsed from the PDF
  edited_data: JsonObject | null; // user-corrected fields
  generated_pdf_url: string | null; // URL of the regenerated/overlaid PDF
  status: TradeStatus;
  created_at: string; // ISO timestamp (Postgres now())
  updated_at: string; // ISO timestamp
  client_id: string | null;
  bank_profile_id: string | null; // optional link to the bank profile used at generation

  // Financial fields (numeric in Postgres; total_costs + net_profit are
  // computed server-side, never trusted from the client).
  trade_reference: string | null;
  currency: string | null;
  signing_date: string | null;
  frigo_purchase_price: number | null;
  sale_unit_price: number | null;
  sale_total: number | null;
  shipping_cost: number | null;
  insurance_cost: number | null;
  bank_fees: number | null;
  total_costs: number | null;
  net_profit: number | null;
}

/** The financial INPUT fields a user may set (totals are derived, not input). */
export interface TradeFinancialInput {
  trade_reference?: string | null;
  currency?: string | null;
  signing_date?: string | null;
  frigo_purchase_price?: number | null;
  sale_unit_price?: number | null;
  sale_total?: number | null;
  shipping_cost?: number | null;
  insurance_cost?: number | null;
  bank_fees?: number | null;
}

/** Payload accepted when updating a trade. All fields optional. */
export interface UpdateTradeInput extends TradeFinancialInput {
  edited_data?: JsonObject;
  status?: TradeStatus;
  bank_profile_id?: string | null;
}

/** One row in `trade_generations` — a single, immutable PDF generation. */
export interface TradeGeneration {
  id: string;
  trade_id: string;
  version: number;
  generated_pdf_url: string;
  storage_path: string | null;
  created_at: string;
  snapshot?: JsonObject | null; // immutable trade state at generation time
  created_by?: string | null;
}

// ---------------------------------------------------------------------------
// Trade Folder documents
// ---------------------------------------------------------------------------

/** Categories of uploadable documents in the Trade Folder. */
export type TradeDocumentType = "signed_contract" | "bol" | "additional";

/** A row in `trade_documents`. */
export interface TradeDocument {
  id: string;
  trade_id: string;
  doc_type: TradeDocumentType;
  file_name: string;
  storage_path: string;
  file_url: string;
  mime_type: string | null;
  size_bytes: number | null;
  bol_date: string | null; // YYYY-MM-DD, only for doc_type === 'bol'
  uploaded_by: string | null;
  created_at: string;
}

/** Input accepted when uploading a Trade Folder document. */
export interface UploadDocumentInput {
  docType: TradeDocumentType;
  fileName: string;
  buffer: Buffer;
  mimeType: string;
  sizeBytes: number;
  bolDate?: string | null;
  uploadedBy?: string | null;
}
