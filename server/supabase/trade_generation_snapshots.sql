-- ===========================================================================
-- TradeMirror OS — make each trade version an immutable JSON snapshot.
--
-- trade_generations previously stored only the generated PDF URL. The version
-- comparison (diff) feature needs the full trade state at generation time, so
-- we add a `snapshot` jsonb column (and `created_by` for the version card).
-- Additive + idempotent. No data destroyed.
-- ===========================================================================

alter table public.trade_generations
  add column if not exists snapshot   jsonb,
  add column if not exists created_by uuid;

-- Best-effort backfill: existing versions predate snapshotting, so seed them
-- with the trade's current edited_data. (Historical accuracy starts from the
-- next generation; this just makes existing versions comparable rather than
-- empty.)
update public.trade_generations g
set snapshot = t.edited_data
from public.trades t
where g.trade_id = t.id
  and g.snapshot is null;
