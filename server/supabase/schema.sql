-- ===========================================================================
-- TradeMirror OS — Supabase schema
-- Run this in the Supabase SQL editor (or via the CLI) to provision the
-- `trades` table. Phase 1 has NO authentication/RLS by design.
-- ===========================================================================

-- gen_random_uuid() lives in pgcrypto.
create extension if not exists pgcrypto;

create table if not exists public.trades (
  id                uuid primary key default gen_random_uuid(),
  original_pdf_url  text,
  extracted_data    jsonb,
  edited_data       jsonb,
  generated_pdf_url text,
  status            text not null default 'draft'
                      check (status in ('draft', 'active', 'completed')),
  created_at        timestamptz 
  not null default now(),
  updated_at        timestamptz not null default now()
);

create index if not exists trades_status_idx     on public.trades (status);
create index if not exists trades_created_at_idx  on public.trades (created_at desc);

-- Keep updated_at fresh on every UPDATE (belt-and-braces; the API also sets it).
create or replace function public.set_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists trades_set_updated_at on public.trades;
create trigger trades_set_updated_at
  before update on public.trades
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- Generation history
-- One row per "Generate PDF" run. Previous generations are NEVER overwritten,
-- so each trade keeps a full, versioned history of generated PDFs.
-- ---------------------------------------------------------------------------
create table if not exists public.trade_generations (
  id                uuid primary key default gen_random_uuid(),
  trade_id          uuid not null references public.trades (id) on delete cascade,
  version           integer not null,
  generated_pdf_url text not null,
  storage_path      text,
  created_at        timestamptz not null default now(),
  unique (trade_id, version)
);

create index if not exists trade_generations_trade_idx
  on public.trade_generations (trade_id, version desc);

-- ---------------------------------------------------------------------------
-- Storage bucket
-- Create a PUBLIC bucket named "trade-pdfs" (matching SUPABASE_BUCKET) in the
-- dashboard, OR uncomment the line below if you use the storage SQL API:
--
-- insert into storage.buckets (id, name, public)
-- values ('trade-pdfs', 'trade-pdfs', true)
-- on conflict (id) do nothing;
-- ---------------------------------------------------------------------------
