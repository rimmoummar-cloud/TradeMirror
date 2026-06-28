-- ===========================================================================
-- TradeMirror OS — Financial analytics (SQL aggregation functions)
--
-- Real Postgres aggregation backing the client analytics endpoints. Called via
-- supabase.rpc() from the server (service-role). Idempotent (create or replace).
-- The financial COLUMNS on public.trades were created in schema_phase2.sql:
--   frigo_purchase_price, sale_unit_price, sale_total, shipping_cost,
--   insurance_cost, bank_fees, total_costs, net_profit.
-- ===========================================================================

-- Aggregated financial summary for one client (single row).
create or replace function public.client_financial_summary(p_client_id uuid)
returns table (
  total_trades     bigint,
  total_revenue    numeric,
  total_frigo      numeric,
  total_shipping   numeric,
  total_insurance  numeric,
  total_bank_fees  numeric,
  total_costs      numeric,
  total_net_profit numeric,
  avg_net_profit   numeric,
  last_trade_date  timestamptz
)
language sql
stable
as $$
  select
    count(*)::bigint,
    coalesce(sum(sale_total), 0),
    coalesce(sum(frigo_purchase_price), 0),
    coalesce(sum(shipping_cost), 0),
    coalesce(sum(insurance_cost), 0),
    coalesce(sum(bank_fees), 0),
    coalesce(sum(total_costs), 0),
    coalesce(sum(net_profit), 0),
    coalesce(avg(net_profit), 0),
    max(created_at)
from public.trade_financials
  where client_id = p_client_id;
$$;

-- Monthly profit breakdown for one client (one row per month with trades).
create or replace function public.client_profit_analysis(p_client_id uuid)
returns table (
  month       date,
  trade_count bigint,
  revenue     numeric,
  costs       numeric,
  net_profit  numeric
)
language sql
stable
as $$
  select
    date_trunc('month', created_at)::date as month,
    count(*)::bigint,
    coalesce(sum(sale_total), 0),
    coalesce(sum(total_costs), 0),
from public.trade_financials
  where client_id = p_client_id
  group by 1
  order by 1;
$$;
