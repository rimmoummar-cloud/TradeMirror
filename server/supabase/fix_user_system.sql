-- ===========================================================================
-- TradeMirror OS — USER SYSTEM FULL SYNC & SELF-HEAL
-- ---------------------------------------------------------------------------
-- Run this ONCE in the Supabase SQL editor. It is additive + idempotent: safe
-- to run repeatedly. It brings public.users / public.user_invitations fully in
-- sync with the backend code, normalizes roles, installs a DB-level trigger so
-- every auth.users row always gets a public.users profile (kills "User profile
-- not found"), backfills any existing orphans, and reloads the PostgREST schema
-- cache (kills "Could not find column/table in schema cache").
-- ===========================================================================

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------------
-- 1. public.users — ensure every column the backend reads/writes exists.
-- ---------------------------------------------------------------------------
alter table public.users
  add column if not exists email             text,
  add column if not exists full_name         text,
  add column if not exists role              text,
  add column if not exists is_active         boolean     not null default true,
  add column if not exists invited_at        timestamptz,
  add column if not exists last_login_at     timestamptz,
  add column if not exists invitation_status text        not null default 'accepted',
  add column if not exists created_at        timestamptz not null default now();

-- ---------------------------------------------------------------------------
-- 2. Role normalization — collapse any legacy/invalid role to 'employee',
--    then enforce the canonical 4-role set at the database level.
-- ---------------------------------------------------------------------------
update public.users
   set role = 'employee'
 where role is null
    or role not in ('super_admin', 'admin', 'employee', 'partner');

alter table public.users drop constraint if exists users_role_check;
alter table public.users
  add constraint users_role_check
  check (role in ('super_admin', 'admin', 'employee', 'partner'));

-- ---------------------------------------------------------------------------
-- 3. One profile per email — add a unique constraint (only if data allows it).
--    The app always lowercases emails before writing, so a plain unique works.
-- ---------------------------------------------------------------------------
do $$
begin
  if not exists (
    select 1 from pg_constraint
     where conrelid = 'public.users'::regclass and conname = 'users_email_key'
  ) and not exists (
    select 1 from public.users
     where email is not null
     group by lower(email) having count(*) > 1
  ) then
    alter table public.users add constraint users_email_key unique (email);
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 4. public.user_invitations — secure one-time invite tokens.
-- ---------------------------------------------------------------------------
create table if not exists public.user_invitations (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references public.users(id) on delete cascade,
  email        text not null,
  role         text not null,
  token        text not null unique,
  status       text not null default 'pending',   -- pending | accepted | expired
  expires_at   timestamptz not null,
  accepted_at  timestamptz,
  invited_by   uuid references public.users(id),
  created_at   timestamptz not null default now()
);
create index if not exists user_invitations_token_idx on public.user_invitations (token);
create index if not exists user_invitations_user_idx  on public.user_invitations (user_id);
alter table public.user_invitations enable row level security;

-- ---------------------------------------------------------------------------
-- 5. SELF-HEALING trigger — every new auth.users row gets a public.users
--    profile automatically. Admin-invited (unconfirmed) users start
--    inactive/pending; confirmed users start active/accepted. The app's invite
--    upsert later overwrites role/name as needed (on conflict do nothing keeps
--    this non-destructive).
-- ---------------------------------------------------------------------------
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.users (id, email, role, full_name, is_active, invitation_status)
  values (
    new.id,
    new.email,
    coalesce(nullif(new.raw_user_meta_data ->> 'role', ''), 'employee'),
    nullif(new.raw_user_meta_data ->> 'full_name', ''),
    (new.email_confirmed_at is not null),
    case when new.email_confirmed_at is not null then 'accepted' else 'pending' end
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------------------------------------------------------------------------
-- 6. Backfill — heal any EXISTING auth.users that have no profile row.
-- ---------------------------------------------------------------------------
insert into public.users (id, email, role, is_active, invitation_status)
select u.id,
       u.email,
       coalesce(nullif(u.raw_user_meta_data ->> 'role', ''), 'employee'),
       (u.email_confirmed_at is not null),
       case when u.email_confirmed_at is not null then 'accepted' else 'pending' end
  from auth.users u
  left join public.users p on p.id = u.id
 where p.id is null
on conflict (id) do nothing;

-- ---------------------------------------------------------------------------
-- 7. Bootstrap — guarantee the founder account can manage users.
--    (Change the email if your super admin differs.)
-- ---------------------------------------------------------------------------
update public.users
   set role = 'super_admin', is_active = true, invitation_status = 'accepted'
 where lower(email) = 'reem@gmail.com';

-- ---------------------------------------------------------------------------
-- 8. Reload the PostgREST schema cache so the API immediately sees all of the
--    above (otherwise "Could not find column/table in schema cache" persists).
-- ---------------------------------------------------------------------------
notify pgrst, 'reload schema';
