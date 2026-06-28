import { PDFDocument, StandardFonts, rgb, type PDFFont } from "pdf-lib";
import * as pdfjsLib from "pdfjs-dist";
import workerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import type { ContractData } from "../types/contract";

// Worker config (idempotent with pdfParser.ts).
pdfjsLib.GlobalWorkerOptions.workerSrc = workerUrl;


interface PdfTextItem {
  str: string;
  transform: number[];
  width?: number;
  height?: number;
}
interface RowItem {
  x: number;
  y: number;
  w: number;
  size: number;
  str: string;
}
interface FieldBox {
  text: string;
  x: number | null;
  y?: number;
  w?: number;
  size?: number;
  inline?: { x: number; y: number; size: number; prefix: string; right: number };
}

const SPLIT_X = 340;
const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Keep only the last-drawn item where items overlap on a row — removes
 * masked-but-present original text if a generated PDF is used as the template,
 * so overlay locating never sees stale/duplicated values. No-op on a pristine
 * source PDF. */
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
    r.items.push({ x, y, w, size, str });
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
      // empty cell: anchor just after the label
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
    // label+value are a single combined item: defer x to font measurement
    const prefix = text.slice(0, text.length - valStr.length);
    return { text: valStr, x: null, inline: { x: its[0].x, y: its[0].y, size: rowSize, prefix, right: rowRight } };
  }
  return null;
}

/** Locate an unlabeled "orphan" value line (e.g. the intermediary bank
 * address `NEW YORK, USA`) sitting directly below a labelled row. */
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
    };
  };
  return {
    quantity: band(0, 110) as FieldBox,
    commodity: band(110, 450) as FieldBox,
    unitPrice: band(450, 505) as FieldBox,
    lineTotal: band(505, 600) as FieldBox,
  };
}

/** Grand-total cell: the value after "Total" on the "<qty> Total <amount>" row
 * (mirrors the parser's grand-total detection; located by content, no fixed
 * coordinates). */
function locateGrandTotal(rows: Row[]): FieldBox | null {
  const row = rows.find((r) => {
    const t = r.items.map((i) => i.str).join(" ").replace(/\s+/g, " ").trim();
    return /^[\d.,]+\s+Total\s+[\d.,]+$/i.test(t);
  });
  if (!row) return null;
  const value = [...row.items].reverse().find((i) => /^[\d.,]+$/.test(i.str));
  if (!value) return null;
  return { text: value.str, x: value.x, y: value.y, w: value.w, size: value.size };
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

// ---- value formatting ----
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
    packing: d.packing,
    plantNo: d.plantNo,
    lawJurisdiction: d.lawJurisdiction,
  };
}

const NUMERIC = new Set(["quantity", "unitPrice", "lineTotal", "grandTotal"]);
const BOLD = new Set([
  "contractNumber", "sellerName", "buyerName", "commodity", "quantity",
  "unitPrice", "lineTotal", "grandTotal", "incoterm", "interBankName", "interSwift",
  "interAccountNumber", "interAddress", "benBankName", "benSwift", "benAccountNumber",
  "beneficiary", "plantNo",
]);
// Single normalized palette — every draw call references these constants, so a
// given logical colour always resolves to the exact same RGB. (pdf-lib rgb()
// takes 0–1 floats; values are defined once here and never re-created inline.)
const COLORS = {
  white: rgb(1, 1, 1),
  black: rgb(0.1, 0.1, 0.1),
  red: rgb(0.78, 0.05, 0.05),
  orange: rgb(0.85, 0.45, 0.0),
} as const;

// Per-field text colour matching the template; everything else is black.
const FIELD_COLOR: Record<string, ReturnType<typeof rgb>> = {
  contractNumber: COLORS.red,
  incoterm: COLORS.orange,
};

// Glyph extent as fractions of font size. The white mask MUST cover the full
// original glyph box (descender..ascender); if it under-covers, leftover pixels
// of the original glyphs bleed through and tint the redrawn colour — which is
// what makes the same RGB look inconsistent.
const GLYPH_ASCENT = 0.92;
const GLYPH_DESCENT = 0.3;

/**
 * Overlays the edited draft values onto the original template PDF.
 * @param draft         edited contract data
 * @param templateBytes the ORIGINAL uploaded PDF
 */
export async function generatePdf(
  draft: ContractData,
  templateBytes: ArrayBuffer
): Promise<Blob> {
    console.log("generatePdf started");
  // 1. read original text positions
  const pdf = await pdfjsLib.getDocument({ data: new Uint8Array(templateBytes.slice(0)) }).promise;
  const page1 = await pdf.getPage(1);
  console.log("page loaded");
  const items = (await page1.getTextContent()).items.filter(
    (i) => "str" in i
  ) as unknown as PdfTextItem[];
  const boxes = locateFields(items);
  console.log(boxes);
  const vals = newValues(draft);

  // 2. load same bytes for editing with pd-lib
  const pdfDoc = await PDFDocument.load(templateBytes.slice(0));
  const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const fontBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
  const page = pdfDoc.getPages()[0];

  // 3. overlay only changed fields
  for (const [key, box] of Object.entries(boxes)) {
    console.log("FIELD:", key);
    const nv = vals[key];
    
console.log({
  key,
  old: box.text,
  new: nv,
});
    if (nv == null) continue;

    // Contract Number is the single source of truth: ALWAYS rendered from the
    // draft in the one consistent red, never skipped — so the original banner
    // value can never reappear and the colour is always identical. Other fields
    // keep the "skip if unchanged" optimisation.
    const alwaysDraw = key === "contractNumber";

    let draw: string;
    if (NUMERIC.has(key)) {
      if (!alwaysDraw && parseNum(box.text) === Number(nv)) continue;
      draw = formatLike(Number(nv), box.text);
    } else {
      if (!alwaysDraw && String(nv).trim() === box.text.trim()) continue;
      draw = String(nv);
    }
    
    // Never blank a field: if the draft value is empty, leave the original.
    if (alwaysDraw && draw.trim() === "") continue;

    const f: PDFFont = BOLD.has(key) ? fontBold : font;
    let x = box.x;
    let y = box.y;
    let size = box.size ?? 8;
  let coverW = Math.min(box.w ?? 0, 220); 
    if (x == null && box.inline) {
      size = box.inline.size;
      y = box.inline.y;
      if (alwaysDraw) {
        // Banner is a single "label: value" item. Redraw the WHOLE banner so
        // the white mask removes the original combined item cleanly — correct
        // visually AND leaves re-extractable text ("Contract No.: <value>").
        draw = box.inline.prefix + draw;
        x = box.inline.x;
        coverW = box.inline.right - box.inline.x;
      } else {
        // Measure the label prefix in the SAME font we draw in, so the value
        // lands exactly over the original (no drift into the label).
        x = (box.inline?.x ?? 0) + f.widthOfTextAtSize(box.inline?.prefix ?? "", size);
        coverW = box.inline.right - x;
      }
    }
    console.log("DRAW:", {
  key,
  draw,
  x,
  y,
});
    if (x == null || y == null) continue;

    // Mask only the ORIGINAL text bounds (coverW). Sizing the mask to the new
    // text width would let a longer edited value erase adjacent text on the row.
    page.drawRectangle({
      x: x - 2,
      y: y - size * GLYPH_DESCENT,
      width: coverW + 2,
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
    console.log("DONE:", key);
  }

  const bytes = await pdfDoc.save();
  const buffer = bytes.buffer.slice(
    bytes.byteOffset,
    bytes.byteOffset + bytes.byteLength
  ) as ArrayBuffer;
  return new Blob([buffer], { type: "application/pdf" });
}
