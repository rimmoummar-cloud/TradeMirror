-- ===========================================================================
-- TradeMirror OS — Backfill trades.sale_total / total_costs / net_profit
-- from the invoice JSON, where the financial columns are still empty.
--
-- Verified against the LIVE data (2026-06-27): the usable sale value is stored
-- as a real JSON NUMBER in edited_data->'trade'->>'totalAmount' (e.g. 56700),
-- with quantity/unitPrice/lines[].lineTotal as fallbacks. extracted_data on the
-- current rows does NOT contain a parseable total, so it is only a last resort.
-- There is no cost data in the JSON, so total_costs is derived from the cost
-- columns (frigo + shipping + insurance + bank fees) and is 0 until entered.
--
-- Idempotent + non-destructive: only touches rows whose sale_total is NULL or 0,
-- never writes NULL, and preserves any already-corrected non-zero total_costs.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 1. Helper: parse a JSON text value into numeric, safely.
--    JSON numbers serialize as plain strings ("56700") -> cast. Anything that
--    is not a clean number (labels, European "56.700,00", empty) -> NULL, so we
--    never mis-read a thousands separator as a decimal point.
-- ---------------------------------------------------------------------------
create or replace function public.safe_numeric(p text)
returns numeric
language sql
immutable
as $$
  select case
    when p is null then null
    when btrim(p) = '' then null
    when btrim(p) ~ '^-?[0-9]+(\.[0-9]+)?$' then btrim(p)::numeric
    else null
  end;
$$;

-- ---------------------------------------------------------------------------
-- 2. Helper: resolve a trade's sale total from the invoice JSON.
--    Priority (first non-null wins):
--      1. edited_data.trade.totalAmount        (corrected structured value)
--      2. edited_data.trade.quantity * unitPrice
--      3. SUM(edited_data.trade.lines[].lineTotal)
--      4. edited_data.totalAmount              (flat, legacy)
--      5. extracted_data.totalAmount           (flat parser output)
--      6. extracted_data.quantity * unitPrice  (flat parser output)
-- ---------------------------------------------------------------------------
create or replace function public.trade_sale_total(p_extracted jsonb, p_edited jsonb)
returns numeric
language sql
immutable
as $$
  select coalesce(
    public.safe_numeric(p_edited #>> '{trade,totalAmount}'),
    case
      when public.safe_numeric(p_edited #>> '{trade,quantity}') is not null
       and public.safe_numeric(p_edited #>> '{trade,unitPrice}') is not null
      then public.safe_numeric(p_edited #>> '{trade,quantity}')
         * public.safe_numeric(p_edited #>> '{trade,unitPrice}')
    end,
    (
      select sum(public.safe_numeric(l ->> 'lineTotal'))
      from jsonb_array_elements(
        case when jsonb_typeof(p_edited #> '{trade,lines}') = 'array'
             then p_edited #> '{trade,lines}' else '[]'::jsonb end
      ) l
    ),
    public.safe_numeric(p_edited ->> 'totalAmount'),
    public.safe_numeric(p_extracted ->> 'totalAmount'),
    case
      when public.safe_numeric(p_extracted ->> 'quantity') is not null
       and public.safe_numeric(p_extracted ->> 'unitPrice') is not null
      then public.safe_numeric(p_extracted ->> 'quantity')
         * public.safe_numeric(p_extracted ->> 'unitPrice')
    end
  );
$$;

-- ---------------------------------------------------------------------------
-- 3. BACKFILL — only empty rows; never overwrites corrected values.
-- ---------------------------------------------------------------------------
update public.trades tr
set
  sale_total  = v.sale_total,
  total_costs = coalesce(nullif(tr.total_costs, 0), v.cost_sum),
  net_profit  = v.sale_total - coalesce(nullif(tr.total_costs, 0), v.cost_sum),
  currency    = coalesce(nullif(tr.currency, ''), v.currency, 'USD'),
  updated_at  = now()
from (
  select
    id,
    public.trade_sale_total(extracted_data, edited_data) as sale_total,
    ( coalesce(frigo_purchase_price, 0)
    + coalesce(shipping_cost, 0)
    + coalesce(insurance_cost, 0)
    + coalesce(bank_fees, 0) )                          as cost_sum,
    coalesce(
      edited_data    #>> '{trade,currency}',
      edited_data    ->>  'currency',
      extracted_data ->>  'currency',
      'USD'
    )                                                    as currency
 from public.trade_financials
) v
where tr.id = v.id
  and v.sale_total is not null              -- only when a value was actually found
  and (tr.sale_total is null or tr.sale_total = 0);  -- never clobber corrected totals

-- ---------------------------------------------------------------------------
-- 4. VERIFY (read-only) — inspect the result.
-- ---------------------------------------------------------------------------
-- select id, currency, sale_total, total_costs, net_profit
-- from public.trades
-- order by created_at desc;
