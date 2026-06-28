-- ===========================================================================
-- TradeMirror OS — Client Management indexes (supplements schema_phase2.sql)
--
-- The clients table, trades.client_id FK, lower(name) index and the buyer
-- backfill were created in schema_phase2.sql. This file only adds the extra
-- matching indexes used by the auto client-detection pipeline. Idempotent.
-- ===========================================================================

create index if not exists clients_email_idx  on public.clients (lower(email));
create index if not exists clients_tax_id_idx on public.clients (lower(tax_id));
-- lower(name) index already created in schema_phase2.sql as clients_name_idx.
