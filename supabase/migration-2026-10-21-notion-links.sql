-- SANDY migration 2026-10-21b: per-occurrence Notion links (occurrence_links).
-- Run once in Supabase Dashboard -> SQL Editor AFTER migration-2026-10-21-checklists-and-owner.sql.
-- Idempotent (safe to rerun) and all-or-nothing (one transaction). Touches no existing rows.
begin;

do $$ begin
  if to_regprocedure('public.sandy_set_owner()') is null then
    raise exception 'Run migration-2026-10-21-checklists-and-owner.sql first; aborting';
  end if;
end $$;

create table if not exists public.occurrence_links (
  id              uuid primary key default gen_random_uuid(),
  event_id        uuid not null references public.events(id) on delete cascade,
  occurrence_date date not null,
  notion_url      text not null check (notion_url ~ '^https://([a-z0-9-]+\.)*notion\.(so|com|site)/'),
  owner_id        uuid references auth.users(id) on delete cascade,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (event_id, occurrence_date)
);

-- owner: always inherited from the event (same trigger as notes/checks)
create or replace function public.sandy_set_owner_links()
returns trigger language plpgsql security definer set search_path = '' as $$
declare parent uuid;
begin
  select owner_id into parent from public.events where id = new.event_id;
  if tg_op = 'UPDATE' and parent is distinct from old.owner_id and coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'owner_id cannot be changed';
  end if;
  new.owner_id := parent;
  return new;
end $$;
drop trigger if exists occurrence_links_owner on public.occurrence_links;
create trigger occurrence_links_owner before insert or update on public.occurrence_links
  for each row execute function public.sandy_set_owner_links();
drop trigger if exists occurrence_links_touch on public.occurrence_links;
create trigger occurrence_links_touch before update on public.occurrence_links
  for each row execute function public.touch_updated_at();

alter table public.occurrence_links enable row level security;
revoke all on public.occurrence_links from anon;
grant select, insert, update, delete on public.occurrence_links to authenticated;
grant all on public.occurrence_links to service_role;
drop policy if exists occurrence_links_owner_all on public.occurrence_links;
create policy occurrence_links_owner_all on public.occurrence_links for all to authenticated
  using (owner_id = auth.uid()) with check (owner_id = auth.uid());

alter table public.occurrence_links replica identity full;
do $$ begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime'
                     and schemaname = 'public' and tablename = 'occurrence_links') then
    alter publication supabase_realtime add table public.occurrence_links;
  end if;
end $$;

commit;
