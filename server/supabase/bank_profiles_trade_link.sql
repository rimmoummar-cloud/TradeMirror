-- ===========================================================================
-- TradeMirror OS — Link trades to bank profiles (read-only relationship)
--
-- Adds a NULLABLE foreign key so a trade can optionally reference the bank
-- profile it was generated with. Fully ADDITIVE and IDEMPOTENT. This does NOT
-- modify the trade-creation flow or PDF generation — the column simply enables
-- the "trades using this bank profile" view on the Bank Profile detail page.
-- Run AFTER bank_profiles.sql.
-- ===========================================================================

alter table public.trades
  add column if not exists bank_profile_id uuid references public.bank_profiles(id);

create index if not exists trades_bank_profile_idx on public.trades (bank_profile_id);
