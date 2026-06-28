-- ===========================================================================
-- TradeMirror OS — Banking Profiles module
--
-- Standalone table holding beneficiary banking details. Independent from the
-- trade flow (no FK to trades). Fully ADDITIVE and IDEMPOTENT: it never drops
-- data and can be run repeatedly. Run AFTER schema.sql.
-- ===========================================================================

create extension if not exists pgcrypto;

create table if not exists public.bank_profiles (
  id                        uuid primary key default gen_random_uuid(),
  profile_name              text not null,
  beneficiary_name          text not null,
  beneficiary_address       text,
  intermediary_bank_name    text,
  intermediary_bank_swift   text,
  bank_name                 text not null,
  bank_swift                text,
  account_number            text,
  ara_number                text,
  field_71a                 text default 'OUR',
  is_default                boolean default false,
  created_at                timestamptz not null default now()
);

create index if not exists bank_profiles_name_idx on public.bank_profiles (lower(profile_name));

-- ---------------------------------------------------------------------------
-- Row Level Security (defense-in-depth for the public anon path; the trusted
-- server uses the service-role key and bypasses these). Matches the convention
-- used by the other Phase 2 tables.
-- ---------------------------------------------------------------------------
alter table public.bank_profiles enable row level security;

drop policy if exists "Authenticated can read bank_profiles" on public.bank_profiles;
create policy "Authenticated can read bank_profiles" on public.bank_profiles
  for select to authenticated using (true);

drop policy if exists "Authenticated can write bank_profiles" on public.bank_profiles;
create policy "Authenticated can write bank_profiles" on public.bank_profiles
  for all to authenticated using (true) with check (true);
