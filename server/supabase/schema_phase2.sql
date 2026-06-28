-- ===========================================================================
-- TradeMirror OS — Phase 2 schema (Document Workspace, Financials,
-- Payment Milestones, Status Workflow, Clients)
--
-- Run AFTER schema.sql and schema_update.sql. Fully ADDITIVE and IDEMPOTENT:
-- it never drops data and can be run repeatedly. Existing features are
-- unaffected — every column/table is new or guarded with IF NOT EXISTS.
-- ===========================================================================

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------------
-- 1. CLIENTS (normalized) — single source of truth for buyer/contact data.
-- ---------------------------------------------------------------------------
create table if not exists public.clients (
  id              uuid primary key default gen_random_uuid(),
  name            text not null,
  address         text,
  city            text,
  country         text,
  tax_id          text,           -- R.U.C. / VAT number
  contact_person  text,
  phone           text,
  email           text,
  created_by      uuid references public.users(id),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create index if not exists clients_name_idx on public.clients (lower(name));

drop trigger if exists clients_set_updated_at on public.clients;
create trigger clients_set_updated_at
  before update on public.clients
  for each row execute function public.set_updated_at();

-- Link trades -> clients (FK). Nullable so existing trades keep working.
alter table public.trades
  add column if not exists client_id uuid references public.clients(id);
create index if not exists trades_client_idx on public.trades (client_id);

-- ---------------------------------------------------------------------------
-- 2. FINANCIAL FIELDS + workflow metadata on trades.
-- ---------------------------------------------------------------------------
alter table public.trades
  add column if not exists trade_reference      text,
  add column if not exists currency             text default 'USD',
  add column if not exists signing_date         date,
  add column if not exists frigo_purchase_price numeric(14,2),
  add column if not exists sale_unit_price      numeric(14,2),
  add column if not exists sale_total           numeric(14,2),
  add column if not exists shipping_cost        numeric(14,2),
  add column if not exists insurance_cost       numeric(14,2),
  add column if not exists bank_fees            numeric(14,2),
  add column if not exists total_costs          numeric(14,2),
  add column if not exists net_profit           numeric(14,2);

-- ---------------------------------------------------------------------------
-- 3. STATUS WORKFLOW — expand the allowed statuses (keep 'completed' for
--    backward-compat with existing rows). App-layer validation is widened in
--    the status-workflow slice; existing rows remain valid.
-- ---------------------------------------------------------------------------
alter table public.trades drop constraint if exists trades_status_check;
alter table public.trades
  add constraint trades_status_check
  check (status in (
    'draft', 'active', 'advance_received', 'shipped',
    'balance_received', 'overdue', 'completed'
  ));

-- ---------------------------------------------------------------------------
-- 4. PAYMENT MILESTONES (advance 50% / balance 50%).
-- ---------------------------------------------------------------------------
do $$
begin
  if not exists (select 1 from pg_type where typname = 'milestone_kind') then
    create type public.milestone_kind as enum ('advance', 'balance');
  end if;
  if not exists (select 1 from pg_type where typname = 'milestone_status') then
    create type public.milestone_status as enum ('pending', 'received', 'overdue');
  end if;
end$$;

create table if not exists public.payment_milestones (
  id            uuid primary key default gen_random_uuid(),
  trade_id      uuid not null references public.trades(id) on delete cascade,
  kind          public.milestone_kind not null,
  amount        numeric(14,2),
  status        public.milestone_status not null default 'pending',
  due_date      date,
  received_date date,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (trade_id, kind)
);
create index if not exists payment_milestones_trade_idx on public.payment_milestones (trade_id);

drop trigger if exists payment_milestones_set_updated_at on public.payment_milestones;
create trigger payment_milestones_set_updated_at
  before update on public.payment_milestones
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- 5. TRADE DOCUMENTS — the Trade Folder workspace.
--    original_frigo + generated_sales remain tracked by trades.original_pdf_url
--    and trade_generations; this table holds signed contracts, BOLs and any
--    number of additional documents.
-- ---------------------------------------------------------------------------
do $$
begin
  if not exists (select 1 from pg_type where typname = 'trade_document_type') then
    create type public.trade_document_type as enum (
      'signed_contract', 'bol', 'additional'
    );
  end if;
end$$;

create table if not exists public.trade_documents (
  id            uuid primary key default gen_random_uuid(),
  trade_id      uuid not null references public.trades(id) on delete cascade,
  doc_type      public.trade_document_type not null,
  file_name     text not null,            -- original filename shown to users
  storage_path  text not null,            -- path inside the storage bucket
  file_url      text not null,            -- public URL
  mime_type     text,
  size_bytes    bigint,
  bol_date      date,                     -- only set when doc_type = 'bol'
  uploaded_by   uuid references public.users(id),
  created_at    timestamptz not null default now()
);
create index if not exists trade_documents_trade_idx
  on public.trade_documents (trade_id, doc_type, created_at desc);

-- ---------------------------------------------------------------------------
-- 6. ROW LEVEL SECURITY (defense-in-depth for the public anon path; the
--    trusted server uses the service-role key and bypasses these).
-- ---------------------------------------------------------------------------
alter table public.clients            enable row level security;
alter table public.payment_milestones enable row level security;
alter table public.trade_documents    enable row level security;

drop policy if exists "Authenticated can read clients" on public.clients;
create policy "Authenticated can read clients" on public.clients
  for select to authenticated using (true);
drop policy if exists "Authenticated can write clients" on public.clients;
create policy "Authenticated can write clients" on public.clients
  for all to authenticated using (true) with check (true);

drop policy if exists "Authenticated can read milestones" on public.payment_milestones;
create policy "Authenticated can read milestones" on public.payment_milestones
  for select to authenticated using (true);
drop policy if exists "Authenticated can write milestones" on public.payment_milestones;
create policy "Authenticated can write milestones" on public.payment_milestones
  for all to authenticated using (true) with check (true);

drop policy if exists "Authenticated can read documents" on public.trade_documents;
create policy "Authenticated can read documents" on public.trade_documents
  for select to authenticated using (true);
drop policy if exists "Authenticated can write documents" on public.trade_documents;
create policy "Authenticated can write documents" on public.trade_documents
  for all to authenticated using (true) with check (true);

-- ---------------------------------------------------------------------------
-- 7. BACKFILL clients from existing trades' buyer data (best-effort, safe:
--    only runs for trades not yet linked, dedupes by lower(name)+email).
-- ---------------------------------------------------------------------------
do $$
declare
  r      record;
  cid    uuid;
  bname  text;
  bemail text;
begin
  for r in
    select id, edited_data, extracted_data
from public.trade_financials
    where client_id is null
  loop
    bname := coalesce(
      r.edited_data->'buyer'->>'name',
      r.extracted_data->'buyer'->>'name'
    );
    if bname is null or btrim(bname) = '' then
      continue;
    end if;
    bemail := coalesce(
      r.edited_data->'buyer'->>'email',
      r.extracted_data->'buyer'->>'email'
    );

    select id into cid
    from public.clients
    where lower(name) = lower(bname)
      and coalesce(lower(email), '') = coalesce(lower(bemail), '')
    limit 1;

    if cid is null then
      insert into public.clients (name, email, address, city, country, tax_id, contact_person, phone)
      values (
        bname,
        bemail,
        coalesce(r.edited_data->'buyer'->>'address',       r.extracted_data->'buyer'->>'address'),
        coalesce(r.edited_data->'buyer'->>'city',          r.extracted_data->'buyer'->>'city'),
        coalesce(r.edited_data->'buyer'->>'country',       r.extracted_data->'buyer'->>'country'),
        coalesce(r.edited_data->'buyer'->>'vatNumber',     r.extracted_data->'buyer'->>'vatNumber'),
        coalesce(r.edited_data->'buyer'->>'contactPerson', r.extracted_data->'buyer'->>'contactPerson'),
        coalesce(r.edited_data->'buyer'->>'phone',         r.extracted_data->'buyer'->>'phone')
      )
      returning id into cid;
    end if;

    update public.trades set client_id = cid where id = r.id;
  end loop;
end$$;
