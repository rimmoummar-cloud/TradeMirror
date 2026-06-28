// ---------------------------------------------------------------------------
// PDF generation (backend)
//
// PORTED FROM THE LEGACY WORKING ENGINE: TradeMirror/src/core/pdfGenerator.ts.
// The field-location and value-formatting logic below is the proven legacy
// algori
// thm, unchanged in behaviour. The only adaptations for the server are:
//   - text positions come from ./pdfTextExtract (pdfjs legacy build in Node)
//     instead of the browser pdfjs worker;
//   - the result is returned as raw bytes (Uint8Array) for Supabase upload
//     instead of a browser Blob;
//   - debug console logging removed.
//
// generateOverlayPdf() is the primary path (exact template overlay). When the
// edited_data is not a full ContractData (e.g. a trade whose form was never
// saved), generateSummaryPdf() is used as a safe fallback.
// ---------------------------------------------------------------------------

import { PDFDocument, StandardFonts, rgb, type PDFFont } from "pdf-lib";
import type { ContractData } from "../types/contract";
import type { JsonObject } from "../types/trade";
import { extractTextItems, type PdfTextItem } from "./pdfTextExtract";
import { logStep } from "./logger";

interface RowItem {
  x: number;
  y: number;
  w: number;
  size: number;
  str: string;
  bold: boolean;
}
interface FieldBox {
  text: string;
  x: number | null;
  y?: number;
  w?: number;
  size?: number;
  bold?: boolean; // detected original weight; undefined → fall back to BOLD set
  inline?: { x: number; y: number; size: number; prefix: string; right: number };
}
/** The multi-line "Obs:" notes paragraph (Notes field). Unlike FieldBox this
 * spans several wrapped lines, so it carries the per-line geometry needed to
 * erase the whole original area and re-flow the edited paragraph in place. */
interface NotesBox {
  valueStartX: number; // left edge of the value text (after the "Obs:" label)
  topY: number; // baseline y of the first value line
  lineHeight: number; // vertical advance between wrapped lines
  size: number; // original value font size
  rightLimit: number; // right boundary of the value column (wrap + erase edge)
  lines: { y: number; right: number }[]; // original value lines (for erasing)
  originalText: string; // joined original paragraph (for unchanged detection)
}

const SPLIT_X = 340;
const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Keep only the last-drawn item where items overlap on a row — removes
 * masked-but-present original text if a generated PDF is used as the template. */
function dedupeOverlaps(items: PdfTextItem[]): PdfTextItem[] {
  const kept: PdfTextItem[] = [];
  for (const it of items) {
    if (!it.str || !it.str.trim()) continue;
    const x0 = it.transform[4];
    const x1 = x0 + (it.width ?? 0);
    const y = it.transform[5];
    for (let i = kept.length - 1; i >= 0; i--) {
      const k = kept[i];
      const kx0 = k.transform[4];
      const kx1 = kx0 + (k.width ?? 0);
      const ky = k.transform[5];
      if (Math.abs(ky - y) <= 3 && x0 < kx1 && kx0 < x1) kept.splice(i, 1);
    }
    kept.push(it);
  }
  return kept;
}

function buildRows(rawItems: PdfTextItem[]) {
  const items = dedupeOverlaps(rawItems);
  const rows: { y: number; items: RowItem[] }[] = [];
  for (const it of items) {
    const str = (it.str || "").trim();
    if (!str) continue;
    const x = it.transform[4];
    const y = it.transform[5];
    const size = it.transform[0] || it.height || 8;
    const w = it.width || 0;
    let r = rows.find((r) => Math.abs(r.y - y) <= 3);
    if (!r) {
      r = { y, items: [] };
      rows.push(r);
    }
    r.items.push({ x, y, w, size, str, bold: !!it.bold });
  }
  rows.sort((a, b) => b.y - a.y);
  for (const r of rows) r.items.sort((a, b) => a.x - b.x);
  return rows;
}

type Row = { y: number; items: RowItem[] };
const colRows = (rows: Row[], side: "L" | "R"): Row[] =>
  rows
    .map((r) => ({
      y: r.y,
      items: r.items.filter((i) => (side === "L" ? i.x < SPLIT_X : i.x >= SPLIT_X)),
    }))
    .filter((r) => r.items.length);

/** Locate the value box for the nth occurrence of a label within rows. */
function locate(rows: Row[], label: string, nth = 1): FieldBox | null {
  const re = new RegExp("^" + esc(label), "i");
  const strip = new RegExp("^" + esc(label) + "\\s*:?\\s*", "i");
  let count = 0;
  for (const r of rows) {
    const text = r.items.map((i) => i.str).join(" ").replace(/\s+/g, " ").trim();
    if (!re.test(text)) continue;
    count++;
    if (count < nth) continue;

    const its = r.items;
    const rowRight = Math.max(...its.map((t) => t.x + t.w));
    const rowSize = Math.max(...its.map((t) => t.size));
    const valStr = text.replace(strip, "").trim();

    if (!valStr) {
      return { text: "", x: rowRight + 4, y: its[0].y, w: 70, size: rowSize };
    }
    for (let i = 0; i < its.length; i++) {
      const join = its.slice(i).map((t) => t.str).join(" ").replace(/\s+/g, " ").trim();
      if (join === valStr) {
        const seg = its.slice(i);
        return {
          text: valStr,
          x: Math.min(...seg.map((t) => t.x)),
          y: its[i].y,
          w:
            Math.max(...seg.map((t) => t.x + t.w)) -
            Math.min(...seg.map((t) => t.x)),
          size: Math.max(...seg.map((t) => t.size)),
        };
      }
    }
    const prefix = text.slice(0, text.length - valStr.length);
    return { text: valStr, x: null, inline: { x: its[0].x, y: its[0].y, size: rowSize, prefix, right: rowRight } };
  }
  return null;
}

/** Locate an unlabeled "orphan" value line sitting directly below a labelled row. */
function locateOrphan(rows: Row[], afterLabel: string, boundaries: string[]): FieldBox | null {
  const join = (r: Row) => r.items.map((i) => i.str).join(" ").replace(/\s+/g, " ").trim();
  const i = rows.findIndex((r) => new RegExp("^" + esc(afterLabel), "i").test(join(r)));
  if (i < 0 || i + 1 >= rows.length) return null;
  const next = rows[i + 1];
  const text = join(next);
  if (boundaries.some((b) => new RegExp("^" + esc(b), "i").test(text))) return null;
  const its = next.items;
  return {
    text,
    x: Math.min(...its.map((t) => t.x)),
    y: its[0].y,
    w: Math.max(...its.map((t) => t.x + t.w)) - Math.min(...its.map((t) => t.x)),
    size: Math.max(...its.map((t) => t.size)),
  };
}

/** Product table cells, grouped by x band within the product row. */
function locateProduct(rows: Row[]): Record<string, FieldBox> {
  const row = rows.find((r) => {
    const t = r.items.map((i) => i.str).join(" ").replace(/\s+/g, " ").trim();
    return /^[\d.,]+\s+[A-Za-z].*[\d.,]+\s+[\d.,]+$/.test(t) && /[A-Za-z]/.test(t);
  });
  if (!row) return {};
  const band = (lo: number, hi: number): FieldBox | null => {
    const seg = row.items.filter((i) => i.x >= lo && i.x < hi);
    if (!seg.length) return null;
    return {
      text: seg.map((i) => i.str).join(" ").replace(/\s+/g, " ").trim(),
      x: Math.min(...seg.map((i) => i.x)),
      y: seg[0].y,
      w: Math.max(...seg.map((i) => i.x + i.w)) - Math.min(...seg.map((i) => i.x)),
      size: Math.max(...seg.map((i) => i.size)),
      bold: seg.some((i) => i.bold), // match the cell's ORIGINAL weight
    };
  };
  return {
    quantity: band(0, 110) as FieldBox,
    commodity: band(110, 450) as FieldBox,
    unitPrice: band(450, 505) as FieldBox,
    lineTotal: band(505, 600) as FieldBox,
  };
}

/** Grand-total cell: the value after "Total" on the "<qty> Total <amount>" row. */
function locateGrandTotal(rows: Row[]): FieldBox | null {
  const row = rows.find((r) => {
    const t = r.items.map((i) => i.str).join(" ").replace(/\s+/g, " ").trim();
    return /^[\d.,]+\s+Total\s+[\d.,]+$/i.test(t);
  });
  if (!row) return null;
  const value = [...row.items].reverse().find((i) => /^[\d.,]+$/.test(i.str));
  if (!value) return null;
  return { text: value.str, x: value.x, y: value.y, w: value.w, size: value.size, bold: value.bold };
}

/** Total-row quantity cell: the FIRST number on the "<qty> Total <amount>" row.
 * Without this, editing Quantity updates the product-row quantity but leaves the
 * totals-row quantity showing the ORIGINAL value (bug #1). */
function locateTotalQuantity(rows: Row[]): FieldBox | null {
  const row = rows.find((r) => {
    const t = r.items.map((i) => i.str).join(" ").replace(/\s+/g, " ").trim();
    return /^[\d.,]+\s+Total\s+[\d.,]+$/i.test(t);
  });
  if (!row) return null;
  const value = row.items.find((i) => /^[\d.,]+$/.test(i.str)); // first numeric = qty
  if (!value) return null;
  return { text: value.str, x: value.x, y: value.y, w: value.w, size: value.size, bold: value.bold };
}

/** Quantity UNIT sub-header cell (e.g. "Ton"): the alphabetic token sitting in
 * the quantity column directly above the product row. Overlaying it lets the
 * edited unit appear in the PDF, in its natural template position. */
function locateUnit(rows: Row[]): FieldBox | null {
  const prodIdx = rows.findIndex((r) => {
    const t = r.items.map((i) => i.str).join(" ").replace(/\s+/g, " ").trim();
    return /^[\d.,]+\s+[A-Za-z].*[\d.,]+\s+[\d.,]+$/.test(t) && /[A-Za-z]/.test(t);
  });
  if (prodIdx < 0) return null;
  for (let i = prodIdx - 1; i >= 0 && i >= prodIdx - 2; i--) {
    const cell = rows[i].items.find(
      (it) => it.x < 110 && /^[A-Za-z]+$/.test(it.str.trim()) && !/^quantity$/i.test(it.str.trim())
    );
    if (cell) return { text: cell.str.trim(), x: cell.x, y: cell.y, w: cell.w, size: cell.size, bold: cell.bold };
  }
  return null;
}

/** Currency sub-header cell (e.g. "US$"): explicitly mapped based on the 701/2026 template.
 * Sits directly above the unit price (x >= 450). */
function locateCurrency(rows: Row[]): FieldBox | null {
  const prodIdx = rows.findIndex((r) => {
    const t = r.items.map((i) => i.str).join(" ").replace(/\s+/g, " ").trim();
    return /^[\d.,]+\s+[A-Za-z].*[\d.,]+\s+[\d.,]+$/.test(t) && /[A-Za-z]/.test(t);
  });
  if (prodIdx < 0) return null;
  // Look at the 1-2 rows ABOVE the product row for a currency token in the price/total column.
  for (let i = prodIdx - 1; i >= 0 && i >= prodIdx - 2; i--) {
    const cell = rows[i].items.find(
      (it) => it.x >= 450 && /^(US\$|USD|EUR|GBP|BRL|PYG)$/i.test(it.str.trim())
    );
    if (cell) return { text: cell.str.trim(), x: cell.x, y: cell.y, w: cell.w, size: cell.size, bold: cell.bold };
  }
  return null;
}

/** Notes paragraph boundaries — the left-column labels that start the sections
 * directly below the "Obs:" block. The paragraph runs until the first of these. */
const NOTES_BOUNDARIES = [
  "Brand", "Validity", "Temperature", "Packing", "Shipment", "Origin",
  "Destination", "Prepayment", "Balance", "Law", "Incoterm", "BENEFICIARY",
];

/** Locate the multi-line "Obs:" notes paragraph in the LEFT column. Returns the
 * geometry of every original value line so the whole area can be erased and the
 * edited paragraph re-flowed at the same position, font and size. */
function locateNotes(items: PdfTextItem[]): NotesBox | null {
  const rows = buildRows(items);
  const L = colRows(rows, "L");
  const startIdx = L.findIndex((r) =>
    /^Obs\s*:?/i.test(r.items.map((i) => i.str).join(" ").replace(/\s+/g, " ").trim())
  );
  if (startIdx < 0) return null;

  const lines: { y: number; right: number }[] = [];
  const texts: string[] = [];
  let valueStartX = Infinity;
  let rightLimit = -Infinity;
  let size = 0;

  for (let i = startIdx; i < L.length; i++) {
    const row = L[i];
    const text = row.items.map((it) => it.str).join(" ").replace(/\s+/g, " ").trim();
    if (i > startIdx && NOTES_BOUNDARIES.some((b) => new RegExp("^" + esc(b), "i").test(text))) break;

    // Drop the "Obs:" label token(s) from the first line — keep value items only.
    const its =
      i === startIdx
        ? row.items.filter((it) => !/^Obs\s*:?$/i.test(it.str.trim()) && it.str.trim() !== ":")
        : row.items;
    if (!its.length) continue;

    const lineX = Math.min(...its.map((it) => it.x));
    const lineRight = Math.max(...its.map((it) => it.x + it.w));
    valueStartX = Math.min(valueStartX, lineX);
    rightLimit = Math.max(rightLimit, lineRight);
    size = Math.max(size, ...its.map((it) => it.size));
    lines.push({ y: its[0].y, right: lineRight });
    texts.push(its.map((it) => it.str).join(" ").replace(/\s+/g, " ").trim());
  }
  if (!lines.length || !Number.isFinite(valueStartX)) return null;

  const lineHeight =
    lines.length > 1 ? Math.abs(lines[0].y - lines[1].y) : Math.max(size, 1) * 1.35;
  return {
    valueStartX,
    topY: lines[0].y,
    lineHeight,
    size: size || 7,
    rightLimit,
    lines,
    originalText: texts.join(" ").replace(/\s+/g, " ").trim(),
  };
}

/** Greedy word-wrap to a pixel width, matching the original column's bounds. */
function wrapText(text: string, font: PDFFont, size: number, maxWidth: number): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let cur = "";
  for (const word of words) {
    const trial = cur ? `${cur} ${word}` : word;
    if (!cur || font.widthOfTextAtSize(trial, size) <= maxWidth) {
      cur = trial;
    } else {
      lines.push(cur);
      cur = word;
    }
  }
  if (cur) lines.push(cur);
  return lines;
}

function locateFields(items: PdfTextItem[]): Record<string, FieldBox> {
  const rows = buildRows(items);
  const L = colRows(rows, "L");
  const R = colRows(rows, "R");
  const prod = locateProduct(rows);

  const boxes: Record<string, FieldBox> = {};
  const put = (k: string, b: FieldBox | null | undefined) => {
    if (b && (b.x != null || b.inline)) boxes[k] = b;
  };

  put("contractNumber", locate(rows, "Contract No."));
  put("contractDate", locate(R, "Date of Issue"));
  put("salesPerson", locate(R, "Sales Person"));
  put("salesAssistant", locate(R, "Sales Assistant"));

  put("sellerName", locate(L, "Exporter"));
  put("sellerVatNumber", locate(L, "R.U.C."));
  put("sellerAddress", locate(L, "Address", 1));
  put("sellerCity", locate(L, "City", 1));
  put("sellerCountry", locate(L, "Country", 1));
  put("sellerEmail", locate(R, "Email"));

  put("buyerName", locate(L, "Client"));
  put("buyerAddress", locate(L, "Address", 2));
  put("buyerCity", locate(L, "City", 2));
  put("buyerCountry", locate(L, "Country", 2));
  put("buyerContactPerson", locate(R, "Contact Person"));
  put("buyerPhone", locate(R, "Phone"));
  put("buyerEmail", locate(R, "E-mail"));

  put("commodity", prod.commodity);
  put("quantity", prod.quantity);
  put("unitPrice", prod.unitPrice);
  put("lineTotal", prod.lineTotal);
  put("grandTotal", locateGrandTotal(rows));
  put("totalQuantity", locateTotalQuantity(rows));
  put("unit", locateUnit(rows));
  put("currency", locateCurrency(rows));
  put("incoterm", locate(R, "Incoterm:"));

  put("origin", locate(L, "Origin"));
  put("destination", locate(L, "Destination"));
  put("shipmentDate", locate(L, "Shipment's Date"));
  put("freightCondition", locate(R, "Freight Condition"));

  put("prepaymentCondition", locate(L, "Prepayment Condition"));
  put("balanceCondition", locate(L, "Balance Condition"));

  put("interBankName", locate(L, "Intermediary Bank"));
  put("interSwift", locate(L, "Swift", 1));
  put("interAccountNumber", locate(L, "Account Number", 1));
  put("interAddress", locateOrphan(L, "Account Number", ["ARA Number", "Bank Paraguay", "Beneficiary"]));
  put("benBankName", locate(L, "Bank Paraguay"));
  put("benSwift", locate(L, "Swift", 2));
  put("benAccountNumber", locate(L, "Account Number", 2));
  put("beneficiary", locate(L, "Beneficiary "));

  put("brand", locate(L, "Brand"));
  put("validity", locate(L, "Validity"));
  put("temperature", locate(L, "Temperature"));
  put("packing", locate(L, "Packing"));
  put("plantNo", locate(R, "Plant No."));
  put("lawJurisdiction", locate(L, "Law and Jurisdiction"));

  return boxes;
}

// ---- value formatting (legacy, unchanged) ----
function parseNum(s: string): number {
  if (!s) return 0;
  const n = parseFloat(String(s).replace(/\./g, "").replace(",", "."));
  return Number.isFinite(n) ? n : 0;
}
function decimalsOf(s: string): number {
  const m = String(s).match(/,(\d+)/);
  return m ? m[1].length : 0;
}
function formatLike(value: number, originalStr: string): string {
  const dec = decimalsOf(originalStr);
  const fixed = Number(value).toFixed(dec);
  const [int, frac] = fixed.split(".");
  const grouped = int.replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  return frac ? `${grouped},${frac}` : grouped;
}
const MON = ["JANUARY","FEBRUARY","MARCH","APRIL","MAY","JUNE","JULY","AUGUST","SEPTEMBER","OCTOBER","NOVEMBER","DECEMBER"];
function isoToTemplate(iso: string): string {
  const m = String(iso).match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return iso;
  return `${MON[+m[2] - 1]} ${+m[3]}/${m[1]}`;
}

/** New display value per field key, derived from the edited draft. */
function newValues(d: ContractData): Record<string, string | number | undefined> {
  const t = d.trade;
  return {
    contractNumber: d.contractNumber,
    contractDate: isoToTemplate(d.contractDate),
    salesPerson: d.salesPerson,
    salesAssistant: d.salesAssistant,
    sellerName: d.seller.name,
    sellerVatNumber: d.seller.vatNumber,
    sellerAddress: d.seller.address,
    sellerCity: d.seller.city,
    sellerCountry: d.seller.country,
    sellerEmail: d.seller.email,
    buyerName: d.buyer.name,
    buyerAddress: d.buyer.address,
    buyerCity: d.buyer.city,
    buyerCountry: d.buyer.country,
    buyerContactPerson: d.buyer.contactPerson,
    buyerPhone: d.buyer.phone,
    buyerEmail: d.buyer.email,
    commodity: t.commodity,
    quantity: t.quantity,
    totalQuantity: t.quantity, // totals-row quantity = product quantity (single line)
    unit: t.unit, // (#1) edited unit (Ton/Kg/…) overlaid on the unit sub-header
    currency: d.trade.currency,
    unitPrice: t.unitPrice,
    lineTotal: t.totalAmount,
    grandTotal: t.totalAmount,
    incoterm: t.incoterm,
    origin: t.origin,
    destination: t.destination,
    shipmentDate: t.shipmentDate,
    freightCondition: d.freightCondition,
    prepaymentCondition: d.prepaymentCondition,
    balanceCondition: d.balanceCondition,
    interBankName: d.banking?.intermediaryBank?.bankName,
    interSwift: d.banking?.intermediaryBank?.swift,
    interAccountNumber: d.banking?.intermediaryBank?.accountNumber,
    interAddress: d.banking?.intermediaryBank?.address,
    benBankName: d.banking?.beneficiaryBank?.bankName,
    benSwift: d.banking?.beneficiaryBank?.swift,
    benAccountNumber: d.banking?.beneficiaryBank?.accountNumber,
    beneficiary: d.banking?.beneficiary,
    brand: d.brand,
    validity: d.validity,
    temperature: d.temperature,
    // Packing is ALWAYS regenerated from the edited product quantity + unit,
    // never the stale template value. Format: "CONTAINER WITH <qty> <UNIT>"
    // (unit uppercased to match the template's casing, e.g. "Ton" -> "TONS").
    packing: `CONTAINER WITH ${t.quantity} ${String(t.unit ?? "").toUpperCase()}`.trim(),
    plantNo: d.plantNo,
    lawJurisdiction: d.lawJurisdiction,
  };
}

const NUMERIC = new Set(["quantity", "totalQuantity", "unitPrice", "lineTotal", "grandTotal"]);
// Quantity cells live in a narrow column; values must shrink-to-fit (#2) rather
// than overflow into the Description / "Total" column which starts at x≈119.
const QTY_KEYS = new Set(["quantity", "totalQuantity"]);
const QTY_COL_RIGHT = 115;
const BOLD = new Set([
  "contractNumber", "sellerName", "buyerName", "commodity", "quantity", "totalQuantity",
  "unitPrice", "lineTotal", "grandTotal", "incoterm", "interBankName", "interSwift",
  "interAccountNumber", "interAddress", "benBankName", "benSwift", "benAccountNumber",
  "beneficiary", "plantNo",
]);
const COLORS = {
  white: rgb(1, 1, 1),
  black: rgb(0.1, 0.1, 0.1),
  red: rgb(0.78, 0.05, 0.05),
  orange: rgb(0.85, 0.45, 0.0),
} as const;
const FIELD_COLOR: Record<string, ReturnType<typeof rgb>> = {
  contractNumber: COLORS.red,
  incoterm: COLORS.orange,
};
const GLYPH_ASCENT = 0.92;
const GLYPH_DESCENT = 0.3;

/**
 * PRIMARY PATH — overlay the edited draft values onto the original template PDF,
 * exactly like the legacy engine. Reads field positions from the template, masks
 * each original value, and redraws the new value in place (matching font / weight
 * / colour).
 *
 * @param draft         edited contract data (edited_data)
 * @param templateBytes the ORIGINAL uploaded PDF bytes
 * @returns the generated PDF as raw bytes (ready for Supabase upload)
 */
export async function generateOverlayPdf(
  draft: ContractData,
  templateBytes: Buffer
): Promise<Uint8Array> {
  logStep("PdfGenerator", "Starting generateOverlayPdf() — extracting text positions (pdfjs)...");
  // 1. read original text positions (pdfjs, Node)
  const items = await extractTextItems(new Uint8Array(templateBytes));
  const boxes = locateFields(items);
  const vals = newValues(draft);
  logStep("PdfGenerator", `Located ${Object.keys(boxes).length} field box(es) on template`);

  // 2. load the same bytes for editing with pdf-lib
  const pdfDoc = await PDFDocument.load(templateBytes);
  const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const fontBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
  const page = pdfDoc.getPages()[0];

  // 3. overlay only changed fields
  for (const [key, box] of Object.entries(boxes)) {
    const nv = vals[key];
    if (nv == null) continue;

    let draw: string;
    if (NUMERIC.has(key)) {
      // Skip only when the edited number truly equals the template value.
      if (parseNum(box.text) === Number(nv)) continue;
      draw = formatLike(Number(nv), box.text);
    } else {
      const cur = String(nv).trim();
      const orig = box.text.trim();
      // (#3) Beneficiary wraps onto a 2nd line in the template, so the located
      // box only holds the FIRST line. Treat "stored value starts with the
      // located line" as UNCHANGED so we never redraw the whole value on one
      // line (which overflowed into the neighbouring column). When the user DOES
      // edit it, the value comes from edited_data and is drawn at this box.
      const unchanged =
        cur === orig || (key === "beneficiary" && orig.length > 0 && cur.startsWith(orig));
      if (unchanged) continue;
      draw = cur;
    }

    // Prefer the weight DETECTED from the template font; fall back to the
    // static BOLD set only when detection was unavailable (box.bold undefined).
    const f: PDFFont = (box.bold ?? BOLD.has(key)) ? fontBold : font;
    let x = box.x;
    let y = box.y;
    let size = box.size ?? 8;
    let origValW = box.w ?? 0; // width of the ORIGINAL value (its own bounds)

    // (#4) Contract Number is a single "Contract No.: <num>" item. When it
    // changes, redraw the WHOLE banner (label + number) in ONE red so the label
    // and number always share the exact same red — never a mismatched shade or
    // black. (When unchanged it was already skipped above, preserving the
    // template's original red pixel-for-pixel.)
    const contractBanner = key === "contractNumber" && box.x == null && box.inline != null;
    if (contractBanner && box.inline) {
      size = box.inline.size;
      y = box.inline.y;
      x = box.inline.x;
      draw = box.inline.prefix + draw; // "Contract No.: <number>"
      origValW = Math.max(0, box.inline.right - box.inline.x);
    } else if (x == null && box.inline) {
      // Inline "label: value" item — draw the value right after the label.
      size = box.inline.size;
      y = box.inline.y;
      x = box.inline.x + f.widthOfTextAtSize(box.inline.prefix, size);
      origValW = Math.max(0, box.inline.right - x);
    }
    if (x == null || y == null) continue;

    logStep("PdfGenerator", `[PDF GENERATE] Placing field: ${key} at (x:${x}, y:${y}, w:${origValW}), font size:${size}, value: ${draw}`);

    // (#2) Quantity cells must expand to the RIGHT only and never spill into the
    // next column. The left edge is anchored (alignment stays stable); if the
    // value is too wide for the quantity column, shrink the font to fit instead
    // of overflowing or shifting.
    if (QTY_KEYS.has(key)) {
      const availW = QTY_COL_RIGHT - x;
      const w0 = f.widthOfTextAtSize(draw, size);
      if (availW > 0 && w0 > availW) {
        logStep("PdfGenerator", `[PDF WARNING] Overflow detected in field: ${key} (w:${w0} > avail:${availW}). Shrinking font to fit.`);
        size = Math.max(5, size * (availW / w0));
      }
    }

    // Beneficiary can be longer than its slot. Instead of overflowing onto one
    // line into the neighbouring column, wrap it within the original value's
    // width and flow extra lines DOWNWARD into the free space below. origValW is
    // the template's allocated width (its first wrapped line), so the value
    // always stays inside its region with the original left margin / alignment.
    if (key === "beneficiary") {
      const availW = origValW > 0 ? origValW : 220;
      const lineHeight = size * 1.33;
      const w0 = f.widthOfTextAtSize(draw, size);
      if (w0 > availW) {
        logStep("PdfGenerator", `[PDF WARNING] Overflow detected in field: ${key} (w:${w0} > avail:${availW}). Wrapping text.`);
      }
      const lines = wrapText(draw, f, size, availW);
      // Erase the original area: at least the 2 template lines, more if the new
      // value needs them. Width is clamped to the original slot so neighbouring
      // content is never covered.
      const eraseCount = Math.max(lines.length, 2);
      logStep("PdfGenerator", `[PDF GENERATE] Applying white-block overlay for ${key} (${eraseCount} lines)`);
      for (let li = 0; li < eraseCount; li++) {
        page.drawRectangle({
          x: x - 1,
          y: y - li * lineHeight - size * GLYPH_DESCENT,
          width: availW + 2,
          height: size * (GLYPH_ASCENT + GLYPH_DESCENT),
          color: COLORS.white,
        });
      }
      let yy = y;
      for (const line of lines) {
        page.drawText(line, { x, y: yy, size, font: f, color: COLORS.black });
        yy -= lineHeight;
      }
      continue; // handled — skip the generic single-line draw below
    }

    // (#1) Erase the ORIGINAL value area before drawing the new value. The white
    // rectangle is sized to the ORIGINAL value's own bounds (origValW) — NOT the
    // new text width. This is the minimal mask that fully covers the old glyphs:
    //   - a SHORTER edit can never leave leftover characters ("Ton" -> "kg");
    //   - a LONGER edit never grows the white box past the original value, so
    //     neighbouring columns are never covered by the overlay.
    // A tiny pad guarantees clean edge coverage without bleeding into neighbours.
    const PAD = 1;
    const maskW = origValW;
    logStep("PdfGenerator", `[PDF GENERATE] Applying white-block overlay for ${key} (w:${maskW})`);
    page.drawRectangle({
      x: x - PAD,
      y: y - size * GLYPH_DESCENT,
      width: maskW + PAD * 2,
      height: size * (GLYPH_ASCENT + GLYPH_DESCENT),
      color: COLORS.white,
    });
    page.drawText(draw, {
      x,
      y,
      size,
      font: f,
      color: FIELD_COLOR[key] ?? COLORS.black,
    });
  }

  // 4. Notes ("Obs:" paragraph) — handled separately because it is a multi-line
  // wrapped block, not a single-line value box. ALWAYS reflect edited_data.notes:
  // erase the whole original paragraph area, then re-flow the edited text at the
  // same position / font / size / alignment. Skipped only when the value is
  // unchanged, so the template's original paragraph is preserved pixel-for-pixel.
  const notesBox = locateNotes(items);
  if (notesBox && draft.notes != null) {
    const newNotes = String(draft.notes).trim();
    const norm = (s: string) => s.replace(/\s+/g, " ").trim().toLowerCase();
    if (norm(newNotes) !== norm(notesBox.originalText)) {
      const size = notesBox.size;
      const eraseW = notesBox.rightLimit - notesBox.valueStartX + 2;
      const availW = Math.max(40, notesBox.rightLimit - notesBox.valueStartX);
      const w0 = font.widthOfTextAtSize(newNotes, size);
      if (w0 > availW) {
        logStep("PdfGenerator", `[PDF WARNING] Overflow detected in field: notes (w:${w0} > avail:${availW}). Wrapping text.`);
      }
      logStep("PdfGenerator", `[PDF GENERATE] Applying white-block overlay for notes (${notesBox.lines.length} lines)`);
      // Erase every original value line across the full column width so no stale
      // glyphs survive when the edited paragraph is shorter or wraps differently.
      for (const ln of notesBox.lines) {
        page.drawRectangle({
          x: notesBox.valueStartX - 1,
          y: ln.y - size * GLYPH_DESCENT,
          width: eraseW,
          height: size * (GLYPH_ASCENT + GLYPH_DESCENT),
          color: COLORS.white,
        });
      }
      let y = notesBox.topY;
      for (const line of wrapText(newNotes, font, size, availW)) {
        page.drawText(line, { x: notesBox.valueStartX, y, size, font, color: COLORS.black });
        y -= notesBox.lineHeight;
      }
    }
  }

  logStep("PdfGenerator", "generateOverlayPdf() done — saving PDF bytes");
  return pdfDoc.save();
}

// ---------------------------------------------------------------------------
// FALLBACK — when edited_data is NOT a full ContractData (e.g. the form was
// never saved), build a clean one-page summary from whatever JSON is present.
// ---------------------------------------------------------------------------

/** Flatten a (possibly nested) object into "Label: value" display rows. */
function toRows(data: JsonObject, prefix = ""): Array<[string, string]> {
  const rows: Array<[string, string]> = [];
  for (const [key, value] of Object.entries(data)) {
    if (value === null || value === undefined) continue;
    const label = prefix ? `${prefix}.${key}` : key;
    if (typeof value === "object" && !Array.isArray(value)) {
      rows.push(...toRows(value as JsonObject, label));
    } else {
      rows.push([label, Array.isArray(value) ? JSON.stringify(value) : String(value)]);
    }
  }
  return rows;
}

/** Build a clean one-page PDF summary from arbitrary edited fields. */
export async function generateSummaryPdf(editedData: JsonObject): Promise<Uint8Array> {
  logStep("PdfGenerator", "Starting generateSummaryPdf() (fallback)");
  const pdfDoc = await PDFDocument.create();
  let page = pdfDoc.addPage([595, 842]); // A4 portrait (points)
  const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const bold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
  const { width, height } = page.getSize();

  let y = height - 60;
  page.drawText("TradeMirror — Trade Contract", {
    x: 50, y, size: 18, font: bold, color: rgb(0.1, 0.1, 0.45),
  });
  y -= 14;
  page.drawLine({
    start: { x: 50, y }, end: { x: width - 50, y },
    thickness: 1, color: rgb(0.1, 0.1, 0.45),
  });
  y -= 28;

  const rows = toRows(editedData);
  for (const [label, value] of rows) {
    if (y < 60) {
      page = pdfDoc.addPage([595, 842]);
      y = height - 60;
    }
    page.drawText(`${label}:`, { x: 50, y, size: 11, font: bold, color: rgb(0.2, 0.2, 0.2) });
    page.drawText(value.slice(0, 70), { x: 230, y, size: 11, font, color: rgb(0, 0, 0) });
    y -= 20;
  }

  return pdfDoc.save();
}
