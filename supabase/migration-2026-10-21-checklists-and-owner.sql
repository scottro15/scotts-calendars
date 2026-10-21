-- SANDY migration 2026-10-21: (A) per-occurrence checklist state, (B) multi-user step 1 (owner_id + per-user RLS).
-- Run once in Supabase Dashboard -> SQL Editor. Idempotent and runs in ONE transaction:
-- if any row-count or owner check fails, everything rolls back and nothing changes.
-- Sign-ups stay disabled (Auth settings are untouched). No rows are deleted or rewritten except owner_id backfill.
begin;

-- ---------------------------------------------------------------- 0. counts before
create temp table _mig_counts on commit drop as
  select 'events' t, count(*) n from public.events
  union all select 'categories', count(*) from public.categories
  union all select 'occurrence_notes', count(*) from public.occurrence_notes;

-- the owner: Scott's auth user (fails loudly if missing)
create or replace function public.sandy_default_owner()
returns uuid language sql stable security definer set search_path = '' as $$
  select id from auth.users where lower(email) = 'scottro1522@gmail.com' limit 1
$$;
revoke all on function public.sandy_default_owner() from public, anon, authenticated;
grant execute on function public.sandy_default_owner() to service_role;
do $$ begin
  if public.sandy_default_owner() is null then raise exception 'Scott''s auth user not found; aborting'; end if;
end $$;

-- ---------------------------------------------------------------- A. checklist state per occurrence
-- One row per (event, date) holding the keys of the '- [ ]' items ticked on that date.
create table if not exists public.occurrence_checks (
  id              uuid primary key default gen_random_uuid(),
  event_id        uuid not null references public.events(id) on delete cascade,
  occurrence_date date not null,
  checked         text[] not null default '{}',
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (event_id, occurrence_date)
);
drop trigger if exists occurrence_checks_touch on public.occurrence_checks;
create trigger occurrence_checks_touch before update on public.occurrence_checks
  for each row execute function public.touch_updated_at();
alter table public.occurrence_checks enable row level security;
revoke all on public.occurrence_checks from anon;
grant select, insert, update, delete on public.occurrence_checks to authenticated;
grant all on public.occurrence_checks to service_role;
alter table public.occurrence_checks replica identity full;
do $$ begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime'
                     and schemaname = 'public' and tablename = 'occurrence_checks') then
    alter publication supabase_realtime add table public.occurrence_checks;
  end if;
end $$;

-- ---------------------------------------------------------------- B1. owner_id columns + backfill
alter table public.events            add column if not exists owner_id uuid references auth.users(id) on delete cascade;
alter table public.categories        add column if not exists owner_id uuid references auth.users(id) on delete cascade;
alter table public.occurrence_notes  add column if not exists owner_id uuid references auth.users(id) on delete cascade;
alter table public.occurrence_checks add column if not exists owner_id uuid references auth.users(id) on delete cascade;

update public.events            set owner_id = public.sandy_default_owner() where owner_id is null;
update public.categories        set owner_id = public.sandy_default_owner() where owner_id is null;
update public.occurrence_notes  n set owner_id = e.owner_id from public.events e where e.id = n.event_id and n.owner_id is null;
update public.occurrence_checks c set owner_id = e.owner_id from public.events e where e.id = c.event_id and c.owner_id is null;

-- Fill owner_id on new rows: the signed-in user; for service-role writes (cal.py, bots) with no
-- user, fall back to Scott (transitional, single-owner bots). Notes/checks and series exceptions
-- always inherit the owner of their event/series, so they can never point across accounts.
create or replace function public.sandy_set_owner()
returns trigger language plpgsql security definer set search_path = '' as $$
declare parent uuid;
begin
  if tg_table_name = 'events' then
    if new.series_id is not null then
      select owner_id into parent from public.events where id = new.series_id;
      new.owner_id := parent;
    end if;
  elsif tg_table_name in ('occurrence_notes', 'occurrence_checks') then
    select owner_id into parent from public.events where id = new.event_id;
    new.owner_id := parent;
  end if;
  if tg_op = 'UPDATE' and new.owner_id is distinct from old.owner_id and coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'owner_id cannot be changed';
  end if;
  if new.owner_id is null then new.owner_id := coalesce(auth.uid(), public.sandy_default_owner()); end if;
  return new;
end $$;
revoke all on function public.sandy_set_owner() from public, anon, authenticated;

do $$ declare t text; begin
  foreach t in array array['events','categories','occurrence_notes','occurrence_checks'] loop
    execute format('drop trigger if exists %I on public.%I', t || '_owner', t);
    execute format('create trigger %I before insert or update on public.%I for each row execute function public.sandy_set_owner()', t || '_owner', t);
    execute format('alter table public.%I alter column owner_id set not null', t);
  end loop;
end $$;

create index if not exists events_owner_start_idx    on public.events (owner_id, start_at);
create index if not exists events_owner_calendar_idx on public.events (owner_id, calendar);
create index if not exists categories_owner_idx      on public.categories (owner_id);
create index if not exists occurrence_notes_owner_idx  on public.occurrence_notes (owner_id, occurrence_date);
create index if not exists occurrence_checks_owner_idx on public.occurrence_checks (owner_id, occurrence_date);

-- ---------------------------------------------------------------- B2. per-user RLS (replaces the email allow-list)
drop policy if exists events_owner_all            on public.events;
drop policy if exists categories_owner_all        on public.categories;
drop policy if exists occurrence_notes_owner_all  on public.occurrence_notes;
drop policy if exists occurrence_checks_owner_all on public.occurrence_checks;

-- (series exceptions inherit the series owner in sandy_set_owner, so with check also blocks cross-account series links)
create policy events_owner_all on public.events for all to authenticated
  using (owner_id = (select auth.uid())) with check (owner_id = (select auth.uid()));
create policy categories_owner_all on public.categories for all to authenticated
  using (owner_id = (select auth.uid())) with check (owner_id = (select auth.uid()));
create policy occurrence_notes_owner_all on public.occurrence_notes for all to authenticated
  using (owner_id = (select auth.uid()))
  with check (owner_id = (select auth.uid())
              and exists (select 1 from public.events e where e.id = event_id and e.owner_id = (select auth.uid())));
create policy occurrence_checks_owner_all on public.occurrence_checks for all to authenticated
  using (owner_id = (select auth.uid()))
  with check (owner_id = (select auth.uid())
              and exists (select 1 from public.events e where e.id = event_id and e.owner_id = (select auth.uid())));

drop function if exists public.is_calendar_owner();

-- ---------------------------------------------------------------- checks (abort on any mismatch)
do $$ declare bad int; begin
  select count(*) into bad from _mig_counts c where c.n <> case c.t
      when 'events' then (select count(*) from public.events)
      when 'categories' then (select count(*) from public.categories)
      else (select count(*) from public.occurrence_notes) end;
  if bad > 0 then raise exception 'row counts changed; aborting'; end if;
  if exists (select 1 from public.events where owner_id is distinct from public.sandy_default_owner())
     or exists (select 1 from public.categories where owner_id is distinct from public.sandy_default_owner())
     or exists (select 1 from public.occurrence_notes where owner_id is distinct from public.sandy_default_owner())
  then raise exception 'some rows not owned by Scott; aborting'; end if;
end $$;

commit;

select 'events' t, count(*) from public.events union all select 'categories', count(*) from public.categories
union all select 'occurrence_notes', count(*) from public.occurrence_notes union all select 'occurrence_checks', count(*) from public.occurrence_checks;
