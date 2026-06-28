-- ===========================================================================
-- TradeMirror OS — public.trade_financials view + analytics RPCs read it.
-- Drop-in superset of public.trades: every column passes through unchanged;
-- only sale_total / total_costs / net_profit are DERIVED. No schema redesign,
-- no triggers, no data writes, no RPC signature changes. Idempotent.
-- ===========================================================================

create or replace view public.trade_financials as
select
  b.id,
  b.client_id,
  b.original_pdf_url,
  b.extracted_data,
  b.edited_data,
  b.generated_pdf_url,
  b.status,
  b.currency,
  b.signing_date,
  b.trade_reference,
  b.created_at,
  b.updated_at,
  b.sale_unit_price,
  b.frigo_purchase_price,
  b.shipping_cost,
  b.insurance_cost,
  b.bank_fees,
  b.sale_total,                          -- derived (see below)
  b.total_costs,                         -- derived
  b.sale_total - b.total_costs as net_profit
from (
  select
    t.id,
    t.client_id,
    t.original_pdf_url,
    t.extracted_data,
    t.edited_data,
    t.generated_pdf_url,
    t.status,
    coalesce(nullif(t.currency, ''), 'USD')  as currency,
    t.signing_date,
    t.trade_reference,
    t.created_at,
    t.updated_at,
    t.sale_unit_price,
    coalesce(t.frigo_purchase_price, 0)      as frigo_purchase_price,
    coalesce(t.shipping_cost, 0)             as shipping_cost,
    coalesce(t.insurance_cost, 0)            as insurance_cost,
    coalesce(t.bank_fees, 0)                 as bank_fees,
    -- SINGLE SOURCE OF TRUTH: edited_data.trade.totalAmount, then
    -- extracted_data.totalAmount; regex-guarded so non-numeric JSON never errors.
    case
      when (t.edited_data    #>> '{trade,totalAmount}') ~ '^-?[0-9]+(\.[0-9]+)?$'
           then (t.edited_data    #>> '{trade,totalAmount}')::numeric
      when (t.extracted_data ->>  'totalAmount')        ~ '^-?[0-9]+(\.[0-9]+)?$'
           then (t.extracted_data ->>  'totalAmount')::numeric
      else 0
    end                                      as sale_total,
    ( coalesce(t.frigo_purchase_price, 0)
    + coalesce(t.shipping_cost, 0)
    + coalesce(t.insurance_cost, 0)
    + coalesce(t.bank_fees, 0) )             as total_costs
  from public.trades t
) b;

-- ---------------------------------------------------------------------------
-- RPCs now read the view (signatures + return types UNCHANGED).
-- ---------------------------------------------------------------------------
create or replace function public.client_financial_summary(p_client_id uuid)
returns table (
  total_trades bigint, total_revenue numeric, total_frigo numeric, total_shipping numeric,
  total_insurance numeric, total_bank_fees numeric, total_costs numeric,
  total_net_profit numeric, avg_net_profit numeric, last_trade_date timestamptz
)
language sql stable as $$
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

create or replace function public.client_profit_analysis(p_client_id uuid)
returns table (month date, trade_count bigint, revenue numeric, costs numeric, net_profit numeric)
language sql stable as $$
  select
    date_trunc('month', created_at)::date as month,
    count(*)::bigint,
    coalesce(sum(sale_total), 0),
    coalesce(sum(total_costs), 0),
    coalesce(sum(net_profit), 0)
  from public.trade_financials
  where client_id = p_client_id
  group by 1 order by 1;
$$;

create or replace function public.client_dashboard(p_client_id uuid)
returns jsonb
language sql
stable
as $$
with t as (
  select
    id, status,
    coalesce(nullif(currency, ''), 'USD') as currency,
    coalesce(sale_total, 0)  as sale_total,
    coalesce(total_costs, 0) as total_costs,
    coalesce(net_profit, 0)  as net_profit,
    coalesce(frigo_purchase_price, 0) as frigo,
    coalesce(shipping_cost, 0)        as shipping,
    coalesce(insurance_cost, 0)       as insurance,
    coalesce(bank_fees, 0)            as bank_fees,
    created_at
  from public.trade_financials
  where client_id = p_client_id
),
fin_by_cur as (
  select
    currency,
    count(*)        as trade_count,
    sum(sale_total) as revenue,
    sum(total_costs) as costs,
    sum(net_profit) as net_profit,
    avg(net_profit) as avg_profit,
    case when sum(sale_total) <> 0
         then round(sum(net_profit) / sum(sale_total) * 100, 2) else 0 end as margin_pct,
    sum(frigo) as frigo, sum(shipping) as shipping, sum(insurance) as insurance, sum(bank_fees) as bank_fees
  from t group by currency
),
monthly as (
  select
    currency,
    to_char(date_trunc('month', created_at), 'YYYY-MM-DD') as month,
    count(*) as trade_count, sum(sale_total) as revenue, sum(total_costs) as costs,
    sum(net_profit) as net_profit, avg(net_profit) as avg_profit
  from t group by currency, date_trunc('month', created_at)
),
pm as (
  select m.kind, m.status, coalesce(m.amount, 0) as amount, m.due_date, m.received_date
  from public.payment_milestones m join t on t.id = m.trade_id
),
docs as (
  select d.doc_type from public.trade_documents d join t on t.id = d.trade_id
)
select jsonb_build_object(
  'tradeCount', (select count(*) from t),
  'currencies', (select coalesce(jsonb_agg(c order by c), '[]'::jsonb) from (select distinct currency c from t) s),
  'financialByCurrency', (
    select coalesce(jsonb_agg(jsonb_build_object(
      'currency', currency, 'tradeCount', trade_count, 'revenue', revenue, 'costs', costs,
      'netProfit', net_profit, 'avgProfit', avg_profit, 'marginPct', margin_pct,
      'frigo', frigo, 'shipping', shipping, 'insurance', insurance, 'bankFees', bank_fees
    ) order by trade_count desc), '[]'::jsonb) from fin_by_cur
  ),
  'monthly', (
    select coalesce(jsonb_agg(jsonb_build_object(
      'currency', currency, 'month', month, 'tradeCount', trade_count, 'revenue', revenue,
      'costs', costs, 'netProfit', net_profit, 'avgProfit', avg_profit
    ) order by month), '[]'::jsonb) from monthly
  ),
  'statusCounts', (select coalesce(jsonb_object_agg(status, c), '{}'::jsonb)
                   from (select status, count(*) c from t group by status) s),
  'payments', (
    select jsonb_build_object(
      'pending',           count(*) filter (where status = 'pending'),
      'received',          count(*) filter (where status = 'received'),
      'overdue',           count(*) filter (where status = 'overdue'),
      'advanceReceived',   count(*) filter (where kind = 'advance' and status = 'received'),
      'balanceReceived',   count(*) filter (where kind = 'balance' and status = 'received'),
      'receivedAmount',    coalesce(sum(amount) filter (where status = 'received'), 0),
      'outstandingAmount', coalesce(sum(amount) filter (where status <> 'received'), 0),
      'totalAmount',       coalesce(sum(amount), 0),
      'collectionPct',     case when coalesce(sum(amount), 0) <> 0
                                then round(coalesce(sum(amount) filter (where status = 'received'), 0) / sum(amount) * 100, 2)
                                else 0 end,
      'avgPaymentDelayDays', coalesce(round(
                               avg((received_date - due_date))
                               filter (where received_date is not null and due_date is not null), 1), 0)
    ) from pm
  ),
  'documents', (
    select jsonb_build_object(
      'total', count(*), 'signed', count(*) filter (where doc_type = 'signed_contract'),
      'bol', count(*) filter (where doc_type = 'bol'), 'additional', count(*) filter (where doc_type = 'additional')
    ) from docs
  ),
  'activity', (
    select jsonb_build_object('firstTradeDate', min(created_at), 'lastTradeDate', max(created_at), 'tradeCount', count(*)) from t
  ),
  'performance', jsonb_build_object(
    'largestSale',     (select jsonb_build_object('tradeId', id, 'value', sale_total, 'currency', currency) from t where sale_total <> 0 order by sale_total desc limit 1),
    'largestProfit',   (select jsonb_build_object('tradeId', id, 'value', net_profit, 'currency', currency) from t order by net_profit desc limit 1),
    'highestShipping', (select jsonb_build_object('tradeId', id, 'value', shipping, 'currency', currency) from t where shipping <> 0 order by shipping desc limit 1),
    'highestBankFees', (select jsonb_build_object('tradeId', id, 'value', bank_fees, 'currency', currency) from t where bank_fees <> 0 order by bank_fees desc limit 1),
    'highestInsurance',(select jsonb_build_object('tradeId', id, 'value', insurance, 'currency', currency) from t where insurance <> 0 order by insurance desc limit 1),
    'highestMargin',   (select jsonb_build_object('tradeId', id, 'value', round(net_profit / sale_total * 100, 2), 'currency', currency) from t where sale_total <> 0 order by net_profit / sale_total desc limit 1),
    'lowestMargin',    (select jsonb_build_object('tradeId', id, 'value', round(net_profit / sale_total * 100, 2), 'currency', currency) from t where sale_total <> 0 order by net_profit / sale_total asc limit 1)
  ),
  'recent', (
    select coalesce(jsonb_agg(jsonb_build_object(
      'id', id, 'status', status, 'revenue', sale_total, 'profit', net_profit, 'currency', currency, 'createdAt', created_at
    ) order by created_at desc), '[]'::jsonb)
    from (select id, status, sale_total, net_profit, currency, created_at from t order by created_at desc limit 10) r
  )
);
$$;

notify pgrst, 'reload schema';
