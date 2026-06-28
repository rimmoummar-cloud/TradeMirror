// ---------------------------------------------------------------------------
// Client service — business logic for the Client (single source of truth).
//
// Includes the auto client-detection pipeline used at PDF-upload time:
// normalize buyer identity -> match an existing client (tax_id > email > name)
// -> reuse or create. No duplicate clients; trades link via trades.client_id.
// ---------------------------------------------------------------------------

import type { SupabaseClient } from "@supabase/supabase-js";
import { ApiError } from "../middleware/errorHandler";
import type {
  Client, ClientInput, BuyerLike, ClientAnalytics,
  ClientFinancialSummary, ClientProfitAnalysis, ProfitAnalysisPoint,
  ClientDashboard, MonthlyPoint, DashboardTrend,
} from "../types/client";
import type { Trade } from "../types/trade";
import { recordAudit } from "./audit.service";
import { AUDIT_ACTIONS } from "../types/audit";
import { logStep, logSupabase } from "../utils/logger";

const SCOPE = "ClientService";
const TABLE = "clients";

/** Collapse whitespace, lowercase, strip trailing punctuation — for matching. */
function normalizeName(name: string): string {
  return name.toLowerCase().replace(/\s+/g, " ").replace(/[.,]+$/g, "").trim();
}

function clean(v?: string | null): string | null {
  if (v === undefined || v === null) return null;
  const t = String(v).trim();
  return t === "" ? null : t;
}

// ---- CRUD ------------------------------------------------------------------

export async function listClients(supabase: SupabaseClient, search?: string): Promise<Client[]> {
  logStep(SCOPE, `Starting listClients(search=${search ?? ""})`);
  let query = supabase.from(TABLE).select().order("name", { ascending: true });
  if (search && search.trim()) {
    const term = `%${search.trim()}%`;
    query = query.or(`name.ilike.${term},country.ilike.${term}`);
  }
  const { data, error } = await query;
  logSupabase("SELECT clients", { data, error });
  if (error) throw new ApiError(502, `Failed to list clients: ${error.message}`);
  return (data ?? []) as Client[];
}

export async function getClientById(supabase: SupabaseClient, id: string): Promise<Client> {
  logStep(SCOPE, `Starting getClientById(${id})`);
  const { data, error } = await supabase.from(TABLE).select().eq("id", id).single();
  logSupabase(`SELECT clients WHERE id=${id}`, { data, error });
  if (error || !data) throw new ApiError(404, `Client not found: ${id}`);
  return data as Client;
}

export async function createClient(
  supabase: SupabaseClient,
  input: ClientInput,
  createdBy?: string | null
): Promise<Client> {
  logStep(SCOPE, `Starting createClient(${input.name})`);
  if (!clean(input.name)) throw new ApiError(400, "Client name is required.");

  const row = {
    name: clean(input.name),
    tax_id: clean(input.tax_id),
    email: clean(input.email),
    phone: clean(input.phone),
    address: clean(input.address),
    city: clean(input.city),
    country: clean(input.country),
    contact_person: clean(input.contact_person),
    created_by: createdBy ?? null,
  };
  const { data, error } = await supabase.from(TABLE).insert(row).select().single();
  logSupabase("INSERT clients", { data, error });
  if (error) throw new ApiError(502, `Failed to create client: ${error.message}`);
  const created = data as Client;
  await recordAudit(supabase, {
    userId: createdBy, action: AUDIT_ACTIONS.CLIENT_CREATED, entityType: "client", entityId: created.id,
    message: `Client ${created.name} created`,
  });
  return created;
}

export async function updateClient(
  supabase: SupabaseClient,
  id: string,
  input: Partial<ClientInput>,
  userId?: string | null
): Promise<Client> {
  logStep(SCOPE, `Starting updateClient(${id})`);
  await getClientById(supabase, id); // clean 404

  const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
  for (const key of ["name", "tax_id", "email", "phone", "address", "city", "country", "contact_person"] as const) {
    if (input[key] !== undefined) patch[key] = clean(input[key] as string | null);
  }
  if (patch.name === null) throw new ApiError(400, "Client name cannot be empty.");

  const { data, error } = await supabase.from(TABLE).update(patch).eq("id", id).select().single();
  logSupabase(`UPDATE clients WHERE id=${id}`, { data, error });
  if (error) throw new ApiError(502, `Failed to update client: ${error.message}`);
  const updated = data as Client;
  await recordAudit(supabase, {
    userId, action: AUDIT_ACTIONS.CLIENT_UPDATED, entityType: "client", entityId: id,
    message: `Client ${updated.name} updated`,
    metadata: { fields: Object.keys(patch).filter((k) => k !== "updated_at") },
  });
  return updated;
}

/** Delete a client — BLOCKED if any trade still references it (data integrity). */
export async function deleteClient(supabase: SupabaseClient, id: string, userId?: string | null): Promise<void> {
  logStep(SCOPE, `Starting deleteClient(${id})`);
  const existing = await getClientById(supabase, id); // clean 404

  const { count, error: countErr } = await supabase
    .from("trades")
    .select("id", { count: "exact", head: true })
    .eq("client_id", id);
  logSupabase(`COUNT trades WHERE client_id=${id}`, { data: { count }, error: countErr });
  if (countErr) throw new ApiError(502, `Failed to check linked trades: ${countErr.message}`);
  if ((count ?? 0) > 0) {
    throw new ApiError(409, `Cannot delete client: ${count} trade(s) still reference it.`);
  }

  const { error } = await supabase.from(TABLE).delete().eq("id", id);
  logSupabase(`DELETE clients WHERE id=${id}`, { data: null, error });
  if (error) throw new ApiError(502, `Failed to delete client: ${error.message}`);
  await recordAudit(supabase, {
    userId, action: AUDIT_ACTIONS.CLIENT_DELETED, entityType: "client", entityId: id,
    message: `Client ${existing.name} deleted`,
  });
}

// ---- Trades + analytics ----------------------------------------------------

export async function listClientTrades(supabase: SupabaseClient, clientId: string): Promise<Trade[]> {
  logStep(SCOPE, `Starting listClientTrades(${clientId})`);
  const { data, error } = await supabase
    .from("trades")
    .select()
    .eq("client_id", clientId)
    .order("created_at", { ascending: false });
  logSupabase(`SELECT trades WHERE client_id=${clientId}`, { data, error });
  if (error) throw new ApiError(502, `Failed to list client trades: ${error.message}`);
  return (data ?? []) as Trade[];
}

/** Postgres numeric values arrive as strings via PostgREST/RPC — coerce safely. */
function num(v: unknown): number {
  if (v === null || v === undefined) return 0;
  const n = typeof v === "number" ? v : parseFloat(String(v));
  return Number.isFinite(n) ? n : 0;
}

/** Call the SQL aggregation function and return its single summary row. */
async function fetchFinancialSummaryRow(supabase: SupabaseClient, clientId: string) {
  const { data, error } = await supabase.rpc("client_financial_summary", {
    p_client_id: clientId,
  });
  logSupabase(`RPC client_financial_summary(${clientId})`, { data, error });
  if (error) throw new ApiError(502, `Failed to compute financial summary: ${error.message}`);
  // returns table -> array with one row (always present thanks to count(*)).
  return (Array.isArray(data) ? data[0] : data) ?? {};
}

/** Live analytics from real SQL aggregation (no in-JS summing). */
export async function getClientAnalytics(supabase: SupabaseClient, clientId: string): Promise<ClientAnalytics> {
  logStep(SCOPE, `Starting getClientAnalytics(${clientId})`);
  await getClientById(supabase, clientId); // clean 404
  const row: any = await fetchFinancialSummaryRow(supabase, clientId);
  const totalTrades = num(row.total_trades);
  return {
    totalTrades,
    totalRevenue: num(row.total_revenue),
    totalCosts: num(row.total_costs),
    netProfit: num(row.total_net_profit),
    averageProfitPerTrade: num(row.avg_net_profit),
    lastTradeDate: row.last_trade_date ?? null,
  };
}

/** Full financial summary (real SQL aggregation). */
export async function getClientFinancialSummary(
  supabase: SupabaseClient,
  clientId: string
): Promise<ClientFinancialSummary> {
  logStep(SCOPE, `Starting getClientFinancialSummary(${clientId})`);
  await getClientById(supabase, clientId); // clean 404
  const row: any = await fetchFinancialSummaryRow(supabase, clientId);
  return {
    totalTrades: num(row.total_trades),
    totalRevenue: num(row.total_revenue),
    totalFrigo: num(row.total_frigo),
    totalShipping: num(row.total_shipping),
    totalInsurance: num(row.total_insurance),
    totalBankFees: num(row.total_bank_fees),
    totalCosts: num(row.total_costs),
    totalNetProfit: num(row.total_net_profit),
    averageNetProfit: num(row.avg_net_profit),
    lastTradeDate: row.last_trade_date ?? null,
  };
}

/** Profit analysis: overall + monthly series (real SQL aggregation). */
export async function getClientProfitAnalysis(
  supabase: SupabaseClient,
  clientId: string
): Promise<ClientProfitAnalysis> {
  logStep(SCOPE, `Starting getClientProfitAnalysis(${clientId})`);
  await getClientById(supabase, clientId); // clean 404

  const { data, error } = await supabase.rpc("client_profit_analysis", {
    p_client_id: clientId,
  });
  logSupabase(`RPC client_profit_analysis(${clientId})`, { data, error });
  if (error) throw new ApiError(502, `Failed to compute profit analysis: ${error.message}`);

  const monthly: ProfitAnalysisPoint[] = (Array.isArray(data) ? data : []).map((r: any) => ({
    month: r.month,
    tradeCount: num(r.trade_count),
    revenue: num(r.revenue),
    costs: num(r.costs),
    netProfit: num(r.net_profit),
  }));

  const totalRevenue = monthly.reduce((s, m) => s + m.revenue, 0);
  const totalCosts = monthly.reduce((s, m) => s + m.costs, 0);
  const netProfit = monthly.reduce((s, m) => s + m.netProfit, 0);

  return {
    totalRevenue,
    totalCosts,
    netProfit,
    marginPct: totalRevenue ? (netProfit / totalRevenue) * 100 : 0,
    monthly,
  };
}

/** Percentage change helper (null when the previous value is 0 / missing). */
function pctChange(current: number, previous: number): number | null {
  if (!previous) return null;
  return Math.round(((current - previous) / Math.abs(previous)) * 1000) / 10;
}

/**
 * Full BI dashboard for a client: one SQL aggregation (client_dashboard) plus
 * light derivation (primary currency, activity rates, month-over-month trend)
 * that needs no per-trade data. The DB is the single source of truth.
 */
export async function getClientDashboard(
  supabase: SupabaseClient,
  clientId: string
): Promise<ClientDashboard> {
  logStep(SCOPE, `Starting getClientDashboard(${clientId})`);
  await getClientById(supabase, clientId); // clean 404

  const { data, error } = await supabase.rpc("client_dashboard", { p_client_id: clientId });
  logSupabase(`RPC client_dashboard(${clientId})`, { data: data ? "[jsonb]" : null, error });
  if (error) throw new ApiError(502, `Failed to build dashboard: ${error.message}`);

  const d = (data ?? {}) as any;
  const financialByCurrency = (d.financialByCurrency ?? []) as ClientDashboard["financialByCurrency"];
  const monthly = (d.monthly ?? []) as MonthlyPoint[];
  const currencies = (d.currencies ?? []) as string[];

  // Primary currency = the one with the most trades (financialByCurrency is
  // already ordered by trade_count desc in SQL).
  const primaryCurrency = financialByCurrency[0]?.currency ?? "USD";

  // Activity rates derived from first/last/count only (no per-trade transfer).
  const first = d.activity?.firstTradeDate ? new Date(d.activity.firstTradeDate) : null;
  const last = d.activity?.lastTradeDate ? new Date(d.activity.lastTradeDate) : null;
  const count = Number(d.activity?.tradeCount ?? 0);
  const DAY = 86_400_000;
  const daysSinceLastTrade = last ? Math.floor((Date.now() - last.getTime()) / DAY) : null;
  let avgTradesPerMonth = 0;
  let avgDaysBetweenTrades: number | null = null;
  if (first && last && count > 0) {
    const months =
      (last.getFullYear() - first.getFullYear()) * 12 +
      (last.getMonth() - first.getMonth()) +
      1;
    avgTradesPerMonth = Math.round((count / Math.max(1, months)) * 100) / 100;
    avgDaysBetweenTrades =
      count > 1 ? Math.round(((last.getTime() - first.getTime()) / DAY / (count - 1)) * 10) / 10 : 0;
  }

  // Trend: latest vs previous month for the PRIMARY currency (never mixes
  // currencies). volume change uses that currency's monthly trade counts.
  let trend: DashboardTrend | null = null;
  const primaryMonths = monthly
    .filter((m) => m.currency === primaryCurrency)
    .sort((a, b) => (a.month < b.month ? -1 : 1));
  if (primaryMonths.length >= 2) {
    const cur = primaryMonths[primaryMonths.length - 1];
    const prev = primaryMonths[primaryMonths.length - 2];
    trend = {
      currentMonth: cur.month,
      previousMonth: prev.month,
      revenueChangePct: pctChange(cur.revenue, prev.revenue),
      profitChangePct: pctChange(cur.netProfit, prev.netProfit),
      volumeChangePct: pctChange(cur.tradeCount, prev.tradeCount),
    };
  }

  return {
    tradeCount: Number(d.tradeCount ?? 0),
    currencies,
    primaryCurrency,
    multiCurrency: currencies.length > 1,
    financialByCurrency,
    monthly,
    statusCounts: (d.statusCounts ?? {}) as Record<string, number>,
    payments: d.payments,
    documents: d.documents,
    activity: {
      firstTradeDate: d.activity?.firstTradeDate ?? null,
      lastTradeDate: d.activity?.lastTradeDate ?? null,
      tradeCount: count,
      daysSinceLastTrade,
      avgTradesPerMonth,
      avgDaysBetweenTrades,
    },
    performance: d.performance,
    recent: d.recent ?? [],
    trend,
  };
}

// ---- Auto client-detection -------------------------------------------------

/**
 * Resolve a buyer to a client id, reusing an existing client when possible and
 * creating one otherwise. Match priority:
 *   1. tax_id (exact, case-insensitive)
 *   2. email  (exact, case-insensitive)
 *   3. normalized company name (exact, case-insensitive)
 *   4. fuzzy name (ilike contains)
 * Returns null when there is not enough buyer data to identify a client.
 */
export async function resolveClientForBuyer(
  supabase: SupabaseClient,
  buyer: BuyerLike | null | undefined,
  createdBy?: string | null
): Promise<string | null> {
  if (!buyer) return null;
  const name = clean(buyer.name);
  const taxId = clean(buyer.vatNumber);
  const email = clean(buyer.email);
  if (!name && !taxId && !email) {
    logStep(SCOPE, "resolveClientForBuyer — no identifying buyer data, skipping");
    return null;
  }

  // 1. tax_id
  if (taxId) {
    const { data } = await supabase.from(TABLE).select("id").ilike("tax_id", taxId).limit(1);
    if (data && data.length) {
      logStep(SCOPE, `Matched client by tax_id -> ${data[0].id}`);
      return data[0].id as string;
    }
  }
  // 2. email
  if (email) {
    const { data } = await supabase.from(TABLE).select("id").ilike("email", email).limit(1);
    if (data && data.length) {
      logStep(SCOPE, `Matched client by email -> ${data[0].id}`);
      return data[0].id as string;
    }
  }
  // 3 & 4. name (exact-normalized, then fuzzy contains)
  if (name) {
    const norm = normalizeName(name);
    const { data: exact } = await supabase.from(TABLE).select("id, name").ilike("name", norm);
    const hit = (exact ?? []).find((c: any) => normalizeName(c.name) === norm);
    if (hit) {
      logStep(SCOPE, `Matched client by normalized name -> ${hit.id}`);
      return hit.id as string;
    }
    const { data: fuzzy } = await supabase
      .from(TABLE)
      .select("id")
      .ilike("name", `%${norm}%`)
      .limit(1);
    if (fuzzy && fuzzy.length) {
      logStep(SCOPE, `Matched client by fuzzy name -> ${fuzzy[0].id}`);
      return fuzzy[0].id as string;
    }
  }

  // No match -> create a new client (single source of truth).
  logStep(SCOPE, "No client match — creating new client from buyer");
  const created = await createClient(
    supabase,
    {
      name: name ?? email ?? taxId ?? "Unknown client",
      tax_id: taxId,
      email,
      phone: clean(buyer.phone),
      address: clean(buyer.address),
      city: clean(buyer.city),
      country: clean(buyer.country),
      contact_person: clean(buyer.contactPerson),
    },
    createdBy
  );
  return created.id;
}
