// ---------------------------------------------------------------------------
// Financial derivation — the SINGLE source of the rules that populate the
// trades.sale_total / total_costs / net_profit COLUMNS from the invoice JSON.
//
// Architecture decision: the columns are the single source of truth (analytics
// + the SQL RPCs read columns). The JSON (extracted_data / edited_data) is raw
// provenance. These helpers run on every INSERT and UPDATE so the columns are
// always consistent, and they mirror backfill_trade_financials.sql exactly so
// the database and application never disagree.
// ---------------------------------------------------------------------------

/** Coerce a JSON value / numeric string / number to a finite number or null. */
export function toNum(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = typeof v === "number" ? v : parseFloat(String(v));
  return Number.isFinite(n) ? n : null;
}

/**
 * Resolve a trade's sale total from the invoice JSON. Priority (first hit wins):
 *   1. edited_data.trade.totalAmount        (corrected structured value)
 *   2. edited_data.trade.quantity * unitPrice
 *   3. SUM(edited_data.trade.lines[].lineTotal)
 *   4. edited_data.totalAmount              (flat, legacy)
 *   5. extracted_data.totalAmount           (flat parser output)
 *   6. extracted_data.quantity * unitPrice
 * Returns null when no usable value exists.
 */
export function deriveSaleTotal(extracted: any, edited: any): number | null {
  const t = (edited && typeof edited === "object" ? edited.trade : null) ?? {};

  const total = toNum(t.totalAmount);
  if (total != null) return total;

  const q = toNum(t.quantity);
  const p = toNum(t.unitPrice);
  if (q != null && p != null) return q * p;

  if (Array.isArray(t.lines)) {
    const sum = t.lines.reduce((s: number, l: any) => s + (toNum(l?.lineTotal) ?? 0), 0);
    if (sum) return sum;
  }

  const flatEdited = toNum(edited?.totalAmount);
  if (flatEdited != null) return flatEdited;

  const flatExtracted = toNum(extracted?.totalAmount);
  if (flatExtracted != null) return flatExtracted;

  const eq = toNum(extracted?.quantity);
  const ep = toNum(extracted?.unitPrice);
  if (eq != null && ep != null) return eq * ep;

  return null;
}

export interface CostInputs {
  frigo_purchase_price?: number | null;
  shipping_cost?: number | null;
  insurance_cost?: number | null;
  bank_fees?: number | null;
}

/** Total costs = frigo + shipping + insurance + bank fees (missing → 0). */
export function sumCosts(c: CostInputs): number {
  return (
    (toNum(c.frigo_purchase_price) ?? 0) +
    (toNum(c.shipping_cost) ?? 0) +
    (toNum(c.insurance_cost) ?? 0) +
    (toNum(c.bank_fees) ?? 0)
  );
}
