import * as pdfjsLib from "pdfjs-dist";
import workerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import type { ContractData, ProductLine } from "../types/contract";

// Configure the pdf.js worker once (Vite resolves `?url` to the asset URL).
pdfjsLib.GlobalWorkerOptions.workerSrc = workerUrl;

interface PdfTextItem {
  str: string;
  transform: number[]; // [a, b, c, d, x, y]  (a = font size, x = [4], y = [5])
  width?: number;
}

const SPLIT_X = 340; // column gutter between the left and right label columns
const Y_TOL = 3; // y-clustering tolerance for grouping items into a row
const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// ===========================================================================
// LAYER 1 — LAYOUT NORMALIZER
// pdf.js text items -> spatial cells -> rows (Y-clustered, sorted t→b, l→r).
// Spatial geometry (x/y) is the primary source of truth from here on.
// ===========================================================================

interface Cell {
  x: number;
  y: number;
  w: number;
  size: number;
  text: string;
}
interface Row {
  y: number;
  cells: Cell[];
}

/** Drop any item a later-drawn item overlaps on the same row (keep the last).
 * Removes masked-but-present original text when a generated PDF is re-parsed;
 * no-op on a pristine source PDF. */
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
      if (Math.abs(ky - y) <= Y_TOL && x0 < kx1 && kx0 < x1) kept.splice(i, 1);
    }
    kept.push(it);
  }
  return kept;
}

/** Normalize raw items into clean cells: collapse whitespace, drop empties. */
function normalizeCells(rawItems: PdfTextItem[]): Cell[] {
  const cells: Cell[] = [];
  for (const it of dedupeOverlaps(rawItems)) {
    const text = (it.str || "").replace(/\s+/g, " ").trim();
    if (!text) continue;
    cells.push({
      x: it.transform[4],
      y: it.transform[5],
      w: it.width ?? 0,
      size: it.transform[0] || 8,
      text,
    });
  }
  return cells;
}

/** Group cells into rows by Y proximity; rows top→bottom, cells left→right. */
function clusterRows(cells: Cell[]): Row[] {
  const rows: Row[] = [];
  for (const c of cells) {
    let r = rows.find((row) => Math.abs(row.y - c.y) <= Y_TOL);
    if (!r) {
      r = { y: c.y, cells: [] };
      rows.push(r);
    }
    r.cells.push(c);
  }
  rows.sort((a, b) => b.y - a.y);
  for (const r of rows) r.cells.sort((a, b) => a.x - b.x);
  return rows;
}
const joinCells = (cells: Cell[]) =>
  cells
    .sort((a, b) => a.x - b.x)
    .map(c => c.text)
    .filter(Boolean)
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();

/** Per-row text of a single column (L = x < SPLIT_X, R = x >= SPLIT_X).
 * This keeps left/right blocks from contaminating each other on shared rows. */
function columnLines(rows: Row[], side: "L" | "R"): string[] {
  return rows
    .map((r) =>
      joinCells(r.cells.filter((c) => (side === "L" ? c.x < SPLIT_X : c.x >= SPLIT_X)))
    )
    .filter(Boolean);
}

// ===========================================================================
// LAYER 2 — STRUCTURAL DETECTION
// Detect table semantics from cell geometry/shape, never from page-wide text.
// ===========================================================================

/** A pure numeric token (European format): "27,00", "2.100,000", "000014514". */
const isNum = (s: string) => /^[\d.,]+$/.test(s) && /\d/.test(s);

/** European number: "2.100,000" -> 2100, "56.700,00" -> 56700, "27,00" -> 27. */
function parseNum(s: string): number {
  if (!s) return 0;
  const n = parseFloat(s.replace(/\./g, "").replace(",", "."));
  return Number.isFinite(n) ? n : 0;
}

/** (A) Product rows: >=3 numeric cells, >=1 descriptive cell, NOT a "total" row.
 * Column roles are assigned by ORDER/position (robust to x drift):
 * first numeric = quantity, last = lineTotal, second-last = unitPrice,
 * cells between quantity and unitPrice = commodity. Supports multiple rows. */
function detectProductRows(rows: Row[]): ProductLine[] {
  const lines: ProductLine[] = [];

  for (const r of rows) {
    const cells = r.cells;

    const nums = cells.filter(c => isNum(c.text));
    const hasAlpha = cells.some(c => /[A-Za-z]/.test(c.text));
    const hasTotalWord = cells.some(c => /total/i.test(c.text));

    if (nums.length < 3 || !hasAlpha || hasTotalWord) continue;

    // 🔥 بدل الاعتماد على "ترتيب nums"
    // نعتمد على x-position sorting الحقيقي
    const sortedNums = [...nums].sort((a, b) => a.x - b.x);

    const qty = sortedNums[0];
    const unitPrice = sortedNums[sortedNums.length - 2];
    const lineTotal = sortedNums[sortedNums.length - 1];

    const commodity = joinCells(
      cells.filter(c => c.x > qty.x && c.x < unitPrice.x)
    );

    lines.push({
      quantity: parseNum(qty.text),
      commodity,
      unitPrice: parseNum(unitPrice.text),
      lineTotal: parseNum(lineTotal.text),
    });
  }

  return lines;
}

/** (B) Grand total: the LAST numeric cell of a row containing "total".
 * Prefers a row with a standalone "Total" cell; never assumes the last line. */
function detectGrandTotal(rows: Row[]): number | null {
  const matchers: ((r: Row) => boolean)[] = [
    (r) => r.cells.some((c) => /^total$/i.test(c.text)),
    (r) => r.cells.some((c) => /total/i.test(c.text)),
  ];

  for (const matches of matchers) {
    for (const r of rows) {
      if (!matches(r)) continue;

      const nums = r.cells.filter((c) => isNum(c.text));
      if (!nums.length) continue;

      const value = [...nums]
        .map(n => ({ n: parseNum(n.text), x: n.x }))
        .sort((a, b) => a.x - b.x)
        .pop();

      return value?.n ?? null;
    }
  }

  return null;
}

// Labels that mark the start of a different field/section — used to bound
// multi-line block collection so it never bleeds into the next field.
const STOP_LABELS = [
  "Beneficiary", "Bank", "Swift", "Account Number", "ARA Number",
  "Intermediary", "Brand", "Validity", "Temperature", "Packing",
  "Shipment", "Origin", "Destination", "Prepayment", "Balance",
  "Law", "Obs", "Exporter", "Client", "Payer", "Total",
];
function isHeaderLike(text: string): boolean {
  if (/:$/.test(text)) return true;

  // 🔥 مهم: منع دمج الجمل الطويلة
  if (text.length > 60) return true;

  return STOP_LABELS.some((l) =>
    new RegExp("^" + esc(l), "i").test(text)
  );
}

/** (C) Beneficiary: a multi-line LEFT-column block. Take the value on the
 * label row, then append following left-column rows until a new header, a
 * vertical gap, or 3 lines collected. Column-aware so right-column EXIGENCIES
 * text on the same rows never contaminates it. */
function detectBeneficiary(rows: Row[]): string {
  const leftText = (r: Row) => joinCells(r.cells.filter((c) => c.x < SPLIT_X));
  // Require a space after the label so the "BENEFICIARY'S BANK:" header
  // (apostrophe, no space) is never mistaken for the "Beneficiary <value>" row.
  const idx = rows.findIndex((r) => /^Beneficiary\s/i.test(leftText(r)));
  if (idx < 0) return "";

  const head = leftText(rows[idx]).replace(/^Beneficiary\s*:?\s*/i, "").trim();
  const parts = head ? [head] : [];
  let prevY = rows[idx].y;
  for (let i = idx + 1; i < rows.length && parts.length < 3; i++) {
    const text = leftText(rows[i]);
    if (!text) continue;
    if (prevY - rows[i].y > 14) break; // vertical gap → block ended
    if (isHeaderLike(text)) break; // next labelled field/section
    parts.push(text);
    prevY = rows[i].y;
  }
  return parts.join(" ").replace(/\s+/g, " ").trim();
}

// ---- shared label/section helpers (operate on per-column row lines) ----

/** Value following a label on the same column line (first match). */
function after(lines: string[], label: string): string {
  const re = new RegExp("^" + esc(label) + "\\s*:?\\s*", "i");
  for (const l of lines) if (re.test(l)) return l.replace(re, "").trim();
  return "";
}

/** Slice a column's lines into a labelled section: startLabel .. next boundary. */
function section(lines: string[], startLabel: string, boundaries: string[]): string[] {
  const start = lines.findIndex((l) => new RegExp("^" + esc(startLabel), "i").test(l));
  if (start < 0) return [];
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i++) {
    if (boundaries.some((b) => new RegExp("^" + esc(b), "i").test(lines[i]))) {
      end = i;
      break;
    }
  }
  return lines.slice(start, end);
}

const MONTHS: Record<string, number> = {
  JANUARY: 1, FEBRUARY: 2, MARCH: 3, APRIL: 4, MAY: 5, JUNE: 6,
  JULY: 7, AUGUST: 8, SEPTEMBER: 9, OCTOBER: 10, NOVEMBER: 11, DECEMBER: 12,
};

/** "APRIL 20/2026" -> "2026-04-20"; passes through ISO; raw otherwise. */
function parseIssueDate(raw: string): string {
  if (!raw) return "";
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw; // already ISO
  const m = raw.match(/([A-Za-z]+)\s+(\d{1,2})\s*\/\s*(\d{4})/);
  if (!m) return raw;
  const mo = MONTHS[m[1].toUpperCase()];
  if (!mo) return raw;
  return `${m[3]}-${String(mo).padStart(2, "0")}-${String(+m[2]).padStart(2, "0")}`;
}

const uid = () =>
  typeof crypto !== "undefined" && crypto.randomUUID
    ? crypto.randomUUID()
    : "id-" + Math.random().toString(36).slice(2, 10);

// ===========================================================================
// LAYER 3 — SEMANTIC RESOLVER
// Map structured rows + detections into the final ContractData.
// ===========================================================================

/** Pure extraction from positioned text items → ContractData. */
export function extractContract(items: PdfTextItem[]): ContractData {
  // Layer 1
  const rows = clusterRows(normalizeCells(items));
  rows.forEach((r, i) => {
  console.log(
    i,
    r.cells.map(c => ({
      text: c.text,
      x: Math.round(c.x),
      y: Math.round(c.y),
    }))
  );
});
  const left = columnLines(rows, "L");
  const right = columnLines(rows, "R");

  // Layer 2
  const productLines = detectProductRows(rows);
  const grandTotal = detectGrandTotal(rows);
  const beneficiary = detectBeneficiary(rows);

  // ---- header (row-scoped, not page-wide search) ----
  const cnRow = rows.find((r) => /Contract\s*N[o0]\b/i.test(joinCells(r.cells)));
  const contractNumber =
    (cnRow ? joinCells(cnRow.cells) : "")
      .match(/Contract\s*N[o0]\.?\s*:?\s*([A-Za-z0-9/\-]+)/i)?.[1]
      ?.trim() ?? "";
  const contractDateRaw = after(right, "Date of Issue");

  // ---- seller (Exporter block) ----
  const sellerSec = section(left, "Exporter", ["Client", "Payer"]);
  const seller = {
    id: uid(),
    name: after(sellerSec, "Exporter"),
    vatNumber: after(sellerSec, "R.U.C."),
    address: after(sellerSec, "Address"),
    city: after(sellerSec, "City"),
    country: after(sellerSec, "Country"),
    email: after(right, "Email"),
  };

  // ---- buyer (Client block + right-column contacts) ----
  const buyerSec = section(left, "Client", ["Payer"]);
  const buyer = {
    id: uid(),
    name: after(buyerSec, "Client"),
    address: after(buyerSec, "Address"),
    city: after(buyerSec, "City"),
    country: after(buyerSec, "Country"),
    contactPerson: after(right, "Contact Person"),
    phone: after(right, "Phone"),
    email: after(right, "E-mail"),
  };

  // ---- product (structural, multi-row aware) ----
  const primary = productLines[0];
  const trade = {
    id: uid(),
    commodity: primary?.commodity ?? "",
    quantity: primary?.quantity ?? 0,
    unit: "Ton",
    unitPrice: primary?.unitPrice ?? 0,
    currency: "USD",
    totalAmount: grandTotal ?? productLines.reduce((s, l) => s + l.lineTotal, 0),
    lines: productLines,
    incoterm: after(right, "Incoterm:"),
    origin: after(left, "Origin"),
    destination: after(left, "Destination"),
    shipmentDate: after(left, "Shipment's Date"),
  };

  // ---- banking ----
  const interSec = section(left, "Intermediary Bank", [
    "ARA Number",
    "Bank Paraguay",
    "Beneficiary",
  ]);
  const interKnown = ["Intermediary Bank", "Swift", "Account Number"];
  const interAddress = interSec
    .slice(1)
    .filter((l) => !interKnown.some((k) => new RegExp("^" + esc(k), "i").test(l)))
    .join(", ");
  const benBankSec = section(left, "Bank Paraguay", ["Beneficiary"]);

  const banking = {
    intermediaryBank: {
      bankName: after(interSec, "Intermediary Bank"),
      swift: after(interSec, "Swift"),
      accountNumber: after(interSec, "Account Number"),
      address: interAddress,
    },
    beneficiaryBank: {
      bankName: after(benBankSec, "Bank Paraguay"),
      swift: after(benBankSec, "Swift"),
      accountNumber: after(benBankSec, "Account Number"),
    },
    beneficiary,
  };

  // ---- logistics / terms ----
  const prepaymentCondition = after(left, "Prepayment Condition");
  const balanceCondition = after(left, "Balance Condition");
  const obsSec = section(left, "Obs:", ["Brand", "Incoterm"]);

  return {
    contractNumber,
    contractDate: parseIssueDate(contractDateRaw),
    contractDateRaw,
    salesPerson: after(right, "Sales Person"),
    salesAssistant: after(right, "Sales Assistant"),
    buyer,
    seller,
    trade,
    freightCondition: after(right, "Freight Condition"),
    paymentTerms: [prepaymentCondition, balanceCondition]
      .filter(Boolean)
      .join(" | "),
    prepaymentCondition,
    balanceCondition,
    banking,
    brand: after(left, "Brand"),
    validity: after(left, "Validity"),
    temperature: after(left, "Temperature"),
    packing: after(left, "Packing"),
    plantNo: after(right, "Plant No.:"),
    lawJurisdiction: after(left, "Law and Jurisdiction"),
    notes: obsSec.join(" ").replace(/^Obs:\s*/i, "").trim(),
  };
}

/**
 * Loads a PDF File and extracts ContractData from page 1 (the template is a
 * single-page contract).
 */
export async function parsePdf(file: File): Promise<ContractData> {
  const buffer = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data: new Uint8Array(buffer) }).promise;
  const page = await pdf.getPage(1);
  const content = await page.getTextContent();
  console.log("content loaded");
  const items = content.items.filter(
    (i) => "str" in i
  ) as unknown as PdfTextItem[];
  console.log(items.length);
  return extractContract(items);
}
