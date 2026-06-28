-- ===========================================================================
-- TradeMirror OS — User Management & Invitations.
-- Additive + idempotent. Extends public.users and adds public.user_invitations.
-- Roles are stored as TEXT (validated in the app): super_admin | admin |
-- employee | partner. Existing rows are marked active/accepted automatically.
-- ===========================================================================

alter table public.users
  add column if not exists full_name         text,
  add column if not exists is_active          boolean not null default true,
  add column if not exists invited_at         timestamptz,
  add column if not exists last_login_at      timestamptz,
  add column if not exists invitation_status  text not null default 'accepted';

-- Invitations — one row per outstanding/closed invite, with a secure token.
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
create index if not exists user_invitations_token_idx  on public.user_invitations (token);
create index if not exists user_invitations_user_idx   on public.user_invitations (user_id);

-- RLS: enable (server uses the service-role key and bypasses this; blocks the
-- public anon path entirely since no policies are defined).
alter table public.user_invitations enable row level security;
