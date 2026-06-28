-- ===========================================================================
-- TradeMirror OS — Supabase Schema Update (Auth & RLS)
-- Run this AFTER schema.sql to add Role-Based Access Control and RLS.
--
-- This script is IDEMPOTENT: it can be run multiple times without error.
--
-- ⚠️ IMPORTANT — RLS vs. the current backend:
--    The Express backend talks to Postgres with a user-scoped client, and
--    `createTradeFromPdf` does NOT currently set `trades.created_by`.
--    With the partner-scoped policies below, a 'partner' user would therefore
--    be unable to INSERT or SELECT their own trades.
--    Until the backend is updated to set `created_by = auth.uid()` on insert,
--    keep trade users as 'internal'/'super_admin', OR defer enabling RLS on
--    `public.trades`. Login is unaffected either way (it only uses auth.users).
-- ===========================================================================

-- 1. Create Role Enum (idempotent)
do $$
begin
  if not exists (select 1 from pg_type where typname = 'user_role') then
    create type public.user_role as enum ('super_admin', 'internal', 'partner');
  end if;
end$$;

-- 2. Create Users Table
create table if not exists public.users (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null,
  role public.user_role not null default 'partner',
  created_at timestamptz not null default now()
);

-- Trigger to sync auth.users to public.users on signup
create or replace function public.handle_new_user()
returns trigger as $$
begin
  insert into public.users (id, email, role)
  values (new.id, new.email, coalesce((new.raw_user_meta_data->>'role')::public.user_role, 'partner'))
  on conflict (id) do nothing;
  return new;
end;
$$ language plpgsql security definer;

-- Drop trigger if exists
drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();

-- Backfill: ensure any EXISTING auth users have a public.users row
insert into public.users (id, email, role)
select u.id, u.email, 'partner'::public.user_role
from auth.users u
on conflict (id) do nothing;

-- 3. Add ownership to Trades
alter table public.trades
add column if not exists created_by uuid references public.users(id);

-- 4. Enable Row Level Security
alter table public.users enable row level security;
alter table public.trades enable row level security;
alter table public.trade_generations enable row level security;

-- 5. RLS Policies (idempotent: drop-then-create)
-- Users: Can read their own data, internal/super_admin can read all
drop policy if exists "Users can read own data" on public.users;
create policy "Users can read own data" on public.users
  for select using (auth.uid() = id);

drop policy if exists "Internal/Admin can read all users" on public.users;
create policy "Internal/Admin can read all users" on public.users
  for select using (
    exists (select 1 from public.users where id = auth.uid() and role in ('super_admin', 'internal'))
  );

-- Trades: Partners can only see/update their own trades. Internal/Admin can see/update all.
drop policy if exists "Partners can see own trades" on public.trades;
create policy "Partners can see own trades" on public.trades
  for select using (
    created_by = auth.uid() or
    exists (select 1 from public.users where id = auth.uid() and role in ('super_admin', 'internal'))
  );

drop policy if exists "Partners can insert own trades" on public.trades;
create policy "Partners can insert own trades" on public.trades
  for insert with check (
    created_by = auth.uid() or
    exists (select 1 from public.users where id = auth.uid() and role in ('super_admin', 'internal'))
  );

drop policy if exists "Partners can update own trades" on public.trades;
create policy "Partners can update own trades" on public.trades
  for update using (
    created_by = auth.uid() or
    exists (select 1 from public.users where id = auth.uid() and role in ('super_admin', 'internal'))
  );

drop policy if exists "Internal/Admin can delete trades" on public.trades;
create policy "Internal/Admin can delete trades" on public.trades
  for delete using (
    exists (select 1 from public.users where id = auth.uid() and role in ('super_admin', 'internal'))
  );

-- Trade Generations: Inherit from trades
drop policy if exists "Users can see generations of visible trades" on public.trade_generations;
create policy "Users can see generations of visible trades" on public.trade_generations
  for select using (
    exists (select 1 from public.trade_financials  where public.trades.id = trade_id)
  );

drop policy if exists "Users can insert generations of visible trades" on public.trade_generations;
create policy "Users can insert generations of visible trades" on public.trade_generations
  for insert with check (
    exists (select 1 from public.trade_financials where public.trades.id = trade_id)
  );

-- 6. Storage Policies (trade-pdfs bucket)
-- Note: Assuming bucket 'trade-pdfs' exists
-- Must run this via SQL Editor or API as postgres role
drop policy if exists "Authenticated users can upload pdfs" on storage.objects;
create policy "Authenticated users can upload pdfs" on storage.objects
  for insert to authenticated with check (bucket_id = 'trade-pdfs');

drop policy if exists "Authenticated users can read pdfs" on storage.objects;
create policy "Authenticated users can read pdfs" on storage.objects
  for select to authenticated using (bucket_id = 'trade-pdfs');
