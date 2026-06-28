// ---------------------------------------------------------------------------
// PDF parsing helpers
//
// Uses `pdf-parse` to pull raw text out of an uploaded PDF buffer, then applies
// a few light-touch regular-expression heuristics to lift common contract
// fields into a structured object.
//
// This deliberately stays simple and forgiving: every field is optional and a
// failed match simply means the field is omitted. The frontend lets the user
// correct anything we get wrong (that's what `edited_data` is for).
// ---------------------------------------------------------------------------

import pdfParse from "pdf-parse";
import type { JsonObject } from "../types/trade";
import { logStep } from "./logger";

export interface ParsedPdf {
  text: string; // full extracted text
  numPages: number;
  fields: JsonObject; // best-effort structured fields
}

/** Run a regex against the text and return the first capture group, trimmed. */
function match(text: string, re: RegExp): string | undefined {
  const m = text.match(re);
  return m && m[1] ? m[1].trim() : undefined;
}

/** Parse a numeric value, stripping thousands separators and currency symbols. */
function toNumber(raw?: string): number | undefined {
  if (!raw) return undefined;
  const cleaned = raw.replace(/[^0-9.,-]/g, "").replace(/,/g, "");
  const n = parseFloat(cleaned);
  return Number.isFinite(n) ? n : undefined;
}

/**
 * Best-effort extraction of common trade-contract fields. These patterns are
 * intentionally generic; tune them to your actual contract templates.
 */
function extractFields(text: string): JsonObject {
  const fields: JsonObject = {};

  const contractNumber = match(text, /contract\s*(?:no\.?|number|#)\s*:?\s*([A-Za-z0-9\-\/]+)/i);
  if (contractNumber) fields.contractNumber = contractNumber;

  const contractDate = match(text, /(?:contract\s*date|date)\s*:?\s*([A-Za-z0-9 ,\/\-]+?)(?:\n|$)/i);
  if (contractDate) fields.contractDate = contractDate;

  const commodity = match(text, /(?:commodity|product|description)\s*:?\s*([A-Za-z0-9 ,\-\/]+?)(?:\n|$)/i);
  if (commodity) fields.commodity = commodity;

  const quantity = toNumber(match(text, /(?:quantity|qty)\s*:?\s*([0-9.,]+)/i));
  if (quantity !== undefined) fields.quantity = quantity;

  const unitPrice = toNumber(match(text, /(?:unit\s*price|price\/unit|price)\s*:?\s*([0-9.,]+)/i));
  if (unitPrice !== undefined) fields.unitPrice = unitPrice;

  const totalAmount = toNumber(match(text, /(?:total\s*amount|grand\s*total|total)\s*:?\s*([0-9.,]+)/i));
  if (totalAmount !== undefined) fields.totalAmount = totalAmount;

  const currency = match(text, /\b(USD|EUR|GBP|JPY|CNY|BRL)\b/);
  if (currency) fields.currency = currency;

  const incoterm = match(text, /\b(EXW|FCA|FAS|FOB|CFR|CIF|CPT|CIP|DAP|DPU|DDP)\b[^\n]*/);
  if (incoterm) fields.incoterm = incoterm.trim();

  const buyer = extractBuyer(text);
  if (buyer) fields.buyer = buyer;

  return fields;
}

/**
 * Deep buyer-entity extraction. Combines BLOCK parsing (locate a buyer/importer/
 * consignee section and read the company name + address from the lines that
 * follow) with GLOBAL field scans (email / phone / tax id / country / contact).
 * Keys mirror the frontend ContractData.Client shape (vatNumber = tax id).
 *
 * This feeds the client-resolution pipeline, so it returns the richest object it
 * can; an empty result means the document had no recognizable buyer block.
 */
export function extractBuyer(text: string): JsonObject | undefined {
  const buyer: JsonObject = {};
  const lines = text.split(/\r?\n/).map((l) => l.trim());

  // ---- BLOCK: header line -> company name (inline or next non-empty line) ----
  const headerRe = /^(?:buyer|importer|consignee|customer|bill\s*to|sold\s*to|client)\b\s*[:\-]?\s*(.*)$/i;
  const noise = /@|tel\.?|phone|fax|vat|r\.?u\.?c|tax|email|country|address/i;
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(headerRe);
    if (!m) continue;
    let name = (m[1] ?? "").trim();
    let nameLineIdx = i;
    if (!name) {
      let j = i + 1;
      while (j < lines.length && !lines[j]) j++;
      name = (lines[j] ?? "").trim();
      nameLineIdx = j;
    }
    name = name.replace(/^(?:name|company)\s*[:\-]\s*/i, "").trim();
    if (name && !noise.test(name)) {
      buyer.name = name;
      // The line right after the company name is frequently the street address.
      const addr = (lines[nameLineIdx + 1] ?? "").trim();
      if (addr && !noise.test(addr)) buyer.address = addr;
      break;
    }
  }

  // ---- GLOBAL field scans -------------------------------------------------
  const email = match(text, /([\w.+-]+@[\w-]+\.[\w.-]+)/);
  if (email) buyer.email = email;

  const phone = match(text, /(?:phone|tel\.?|telephone|mobile|fax)\s*[:\-]?\s*([+0-9][\d\s()\-]{6,})/i);
  if (phone) buyer.phone = phone.trim().replace(/\s+/g, " ");

  const taxId = match(
    text,
    /(?:tax\s*id|vat(?:\s*(?:no\.?|number))?|r\.?u\.?c\.?|nif|ein|cnpj|abn)\s*[:#\-]?\s*([A-Za-z0-9][A-Za-z0-9\-\/.]{3,})/i
  );
  if (taxId) buyer.vatNumber = taxId;

  const country = match(text, /(?:country)\s*[:\-]?\s*([A-Za-z ]{2,40}?)(?:\n|$)/i);
  if (country) buyer.country = country.trim();

  const contact = match(text, /(?:contact\s*person|attn|attention)\s*[:\-]?\s*([A-Za-z .'\-]{2,60}?)(?:\n|$)/i);
  if (contact) buyer.contactPerson = contact.trim();

  return Object.keys(buyer).length ? buyer : undefined;
}

/** Extract text + best-effort structured fields from a PDF buffer. */
export async function parsePdf(buffer: Buffer): Promise<ParsedPdf> {
  logStep("PdfParser", `Starting parsePdf() (${buffer.length} bytes)`);
  const result = await pdfParse(buffer);
  const text = result.text || "";
  const fields = extractFields(text);
  logStep("PdfParser", `parsePdf() done — pages: ${result.numpages ?? 0}, fields found: ${Object.keys(fields).length}`);
  return {
    text,
    numPages: result.numpages ?? 0,
    fields,
  };
}
