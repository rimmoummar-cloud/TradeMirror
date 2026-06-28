-- ===========================================================================
-- TradeMirror OS — Make trades.client_id MANDATORY (one client -> many trades).
--
-- Run AFTER schema_phase2.sql. Idempotent. Steps:
--   1. (re)backfill client_id from each trade's parsed buyer data (real data).
--   2. ensure the FK exists.
--   3. set NOT NULL — but ONLY if no NULLs remain, so we never invent fake
--      client data to satisfy the constraint. If some legacy trades still have
--      no buyer data, the script leaves the column nullable and reports how many
--      remain (the application layer still guarantees client_id on every NEW
--      trade created via the upload pipeline).
-- ===========================================================================

-- 1. Backfill from buyer data (same logic as schema_phase2.sql section 7).
do $$
declare
  r record; cid uuid; bname text; bemail text;
begin
  for r in select id, edited_data, extracted_data from public.trade_financials where client_id is null loop
    bname := coalesce(r.edited_data->'buyer'->>'name', r.extracted_data->'buyer'->>'name');
    if bname is null or btrim(bname) = '' then continue; end if;
    bemail := coalesce(r.edited_data->'buyer'->>'email', r.extracted_data->'buyer'->>'email');
    select id into cid from public.clients
      where lower(name) = lower(bname)
        and coalesce(lower(email),'') = coalesce(lower(bemail),'') limit 1;
    if cid is null then
      insert into public.clients (name, email, address, city, country, tax_id, contact_person, phone)
      values (
        bname, bemail,
        coalesce(r.edited_data->'buyer'->>'address',       r.extracted_data->'buyer'->>'address'),
        coalesce(r.edited_data->'buyer'->>'city',          r.extracted_data->'buyer'->>'city'),
        coalesce(r.edited_data->'buyer'->>'country',       r.extracted_data->'buyer'->>'country'),
        coalesce(r.edited_data->'buyer'->>'vatNumber',     r.extracted_data->'buyer'->>'vatNumber'),
        coalesce(r.edited_data->'buyer'->>'contactPerson', r.extracted_data->'buyer'->>'contactPerson'),
        coalesce(r.edited_data->'buyer'->>'phone',         r.extracted_data->'buyer'->>'phone')
      ) returning id into cid;
    end if;
    update public.trades set client_id = cid where id = r.id;
  end loop;
end$$;

-- 2. Ensure the foreign key exists (schema_phase2 created it inline; this is a
--    safety net that names it explicitly if it is somehow missing).
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'trades_client_fk') then
    -- Only add if there isn't already an (unnamed) FK on client_id.
    if not exists (
      select 1 from pg_constraint c
      join pg_attribute a on a.attrelid = c.conrelid and a.attnum = any(c.conkey)
      where c.conrelid = 'public.trades'::regclass and c.contype = 'f' and a.attname = 'client_id'
    ) then
      alter table public.trades
        add constraint trades_client_fk foreign key (client_id) references public.clients(id);
    end if;
  end if;
end$$;

-- 3. Enforce NOT NULL only when every trade is linked (never fabricate data).
do $$
declare remaining bigint;
begin
  select count(*) into remaining from public.trade_financials where client_id is null;
  if remaining = 0 then
    alter table public.trades alter column client_id set not null;
    raise notice 'trades.client_id is now NOT NULL (all trades linked).';
  else
    raise notice 'trades.client_id left NULLABLE: % trade(s) have no buyer data to link. New trades are still guaranteed a client_id by the upload pipeline.', remaining;
  end if;
end$$;
