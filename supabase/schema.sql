-- =====================================================================
-- SANDY: FULL Supabase schema (base + every migration, in order), updated 2026-10-24.
-- This is the one file to rebuild the database from scratch:
--   SQL Editor -> New query -> paste -> Run. Every part is idempotent (safe to re-run).
-- Prerequisite: the owner's auth user (scottro1522@gmail.com) must exist first
-- (Authentication -> Users -> Add user), because ownership backfill and the admin check use it.
-- On the LIVE project nothing here needs running: the migration files were already applied
-- (run only migration-2026-10-24-launch.sql if it hasn't been yet).
-- Time model: wall-clock `timestamp without time zone` in the owner's time zone
-- (profiles.time_zone; events.time_zone records it).
-- =====================================================================

-- ######## PART 0: base schema (original schema.sql)


-- ---------- owner check ----------------------------------------------
-- Single-owner app. To change the owner, edit the email and re-run this file.
create or replace function public.is_calendar_owner()
returns boolean
language sql
stable
set search_path = ''
as $$
  select coalesce(
    lower(auth.jwt() ->> 'email') = 'scottro1522@gmail.com'
    and auth.uid() is not null
    and coalesce(auth.jwt() ->> 'role', '') = 'authenticated',
    false)
$$;
revoke all on function public.is_calendar_owner() from public;
grant execute on function public.is_calendar_owner() to authenticated, service_role;

-- ---------- events -----------------------------------------------------
create table if not exists public.events (
  id               uuid primary key default gen_random_uuid(),
  calendar         text not null check (calendar in ('msc', 'mam', 'lifetime')),
  category         text not null default 'Other',
  title            text not null check (length(trim(title)) > 0),

  all_day          boolean not null default false,
  start_at         timestamp without time zone not null,        -- America/Chicago wall clock
  end_at           timestamp without time zone,                 -- all-day: inclusive end date (midnight)
  time_zone        text not null default 'America/Chicago' check (time_zone = 'America/Chicago'),

  -- recurrence (mirrors the app's model; freq 'none' = one-off)
  recur_freq       text not null default 'none'
                   check (recur_freq in ('none', 'daily', 'weekly', 'monthly', 'yearly')),
  recur_interval   integer not null default 1 check (recur_interval between 1 and 999),
  recur_until      date,                                         -- inclusive
  recur_by_weekday smallint[] check (recur_by_weekday <@ array[0,1,2,3,4,5,6]::smallint[]), -- 0=Sun
  exdates          date[] not null default '{}',                 -- skipped / detached occurrences

  -- single-occurrence edits: an exception is a normal one-off row that points at its series
  series_id        uuid references public.events(id) on delete cascade,
  original_date    date,                                         -- which occurrence it replaces

  location         text not null default '',
  notes            text not null default '',

  -- tasks / to-dos
  is_task          boolean not null default false,
  task_scope       text check (task_scope in ('day', 'week', 'month', 'season')),
  done             boolean not null default false,              -- one-off tasks
  completed_dates  date[] not null default '{}',                -- repeating tasks: done per occurrence

  example          boolean not null default false,
  source           text not null default 'app',                 -- 'app', 'scheduler', 'chief-of-staff', 'import', ...
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),

  constraint end_after_start check (end_at is null or end_at >= start_at),
  constraint exception_shape check ((series_id is null) = (original_date is null)),
  constraint exception_not_recurring check (series_id is null or recur_freq = 'none'),
  constraint task_scope_only_for_tasks check (is_task or task_scope is null)
);

create index if not exists events_start_idx    on public.events (start_at);
create index if not exists events_calendar_idx on public.events (calendar);
create index if not exists events_series_idx   on public.events (series_id);
create index if not exists events_recur_idx    on public.events (recur_freq) where recur_freq <> 'none';

-- ---------- custom categories ------------------------------------------
create table if not exists public.categories (
  id         uuid primary key default gen_random_uuid(),
  calendar   text not null check (calendar in ('msc', 'mam', 'lifetime')),
  name       text not null check (length(trim(name)) > 0),
  created_at timestamptz not null default now(),
  unique (calendar, name)
);

-- ---------- updated_at trigger -----------------------------------------
create or replace function public.touch_updated_at()
returns trigger language plpgsql set search_path = '' as $$
begin
  new.updated_at := now();
  return new;
end $$;

drop trigger if exists events_touch on public.events;
create trigger events_touch before update on public.events
  for each row execute function public.touch_updated_at();

-- ---------- Row Level Security -----------------------------------------
alter table public.events     enable row level security;
alter table public.categories enable row level security;

-- Nobody without a login gets anything.
revoke all on public.events, public.categories from anon;
grant select, insert, update, delete on public.events, public.categories to authenticated;
grant all on public.events, public.categories to service_role;

drop policy if exists events_owner_all on public.events;
create policy events_owner_all on public.events
  for all to authenticated
  using (public.is_calendar_owner())
  with check (public.is_calendar_owner());

drop policy if exists categories_owner_all on public.categories;
create policy categories_owner_all on public.categories
  for all to authenticated
  using (public.is_calendar_owner())
  with check (public.is_calendar_owner());

-- service_role has BYPASSRLS in Supabase, so the bots need no policy.

-- ---------- Realtime (live updates in the app when a bot writes) ---------
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    if not exists (select 1 from pg_publication_tables
                   where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'events') then
      alter publication supabase_realtime add table public.events;
    end if;
    if not exists (select 1 from pg_publication_tables
                   where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'categories') then
      alter publication supabase_realtime add table public.categories;
    end if;
  end if;
end $$;
-- Full row on delete/update so realtime payloads carry the id.
alter table public.events     replica identity full;
alter table public.categories replica identity full;

-- ---------- Day notes ("Today's Note") ---------------------------------
-- One note per event (or series) per Chicago date. Separate from events, so
-- writing a day note never creates a recurrence exception or edits the event row.
-- For a changed occurrence the app keys the note by its series id + original date.
create table if not exists public.occurrence_notes (
  id              uuid primary key default gen_random_uuid(),
  event_id        uuid not null references public.events(id) on delete cascade,
  occurrence_date date not null,                                 -- America/Chicago date
  body            text not null check (length(trim(body)) > 0),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (event_id, occurrence_date)
);
create index if not exists occurrence_notes_date_idx on public.occurrence_notes (occurrence_date);

drop trigger if exists occurrence_notes_touch on public.occurrence_notes;
create trigger occurrence_notes_touch before update on public.occurrence_notes
  for each row execute function public.touch_updated_at();

alter table public.occurrence_notes enable row level security;
revoke all on public.occurrence_notes from anon;
grant select, insert, update, delete on public.occurrence_notes to authenticated;
grant all on public.occurrence_notes to service_role;

drop policy if exists occurrence_notes_owner_all on public.occurrence_notes;
create policy occurrence_notes_owner_all on public.occurrence_notes
  for all to authenticated
  using (public.is_calendar_owner())
  with check (public.is_calendar_owner());

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (select 1 from pg_publication_tables
                     where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'occurrence_notes') then
    alter publication supabase_realtime add table public.occurrence_notes;
  end if;
end $$;
alter table public.occurrence_notes replica identity full;

-- ######## PART: migration-2026-10-19-occurrence-notes.sql
-- Day notes migration: paste into Supabase SQL Editor and Run (safe to re-run).
-- ---------- Day notes
create table if not exists public.occurrence_notes (
  id              uuid primary key default gen_random_uuid(),
  event_id        uuid not null references public.events(id) on delete cascade,
  occurrence_date date not null,                                 -- America/Chicago date
  body            text not null check (length(trim(body)) > 0),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (event_id, occurrence_date)
);
create index if not exists occurrence_notes_date_idx on public.occurrence_notes (occurrence_date);

drop trigger if exists occurrence_notes_touch on public.occurrence_notes;
create trigger occurrence_notes_touch before update on public.occurrence_notes
  for each row execute function public.touch_updated_at();

alter table public.occurrence_notes enable row level security;
revoke all on public.occurrence_notes from anon;
grant select, insert, update, delete on public.occurrence_notes to authenticated;
grant all on public.occurrence_notes to service_role;

drop policy if exists occurrence_notes_owner_all on public.occurrence_notes;
create policy occurrence_notes_owner_all on public.occurrence_notes
  for all to authenticated
  using (public.is_calendar_owner())
  with check (public.is_calendar_owner());

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (select 1 from pg_publication_tables
                     where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'occurrence_notes') then
    alter publication supabase_realtime add table public.occurrence_notes;
  end if;
end $$;
alter table public.occurrence_notes replica identity full;

-- ######## PART: migration-2026-10-21-checklists-and-owner.sql
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

-- ######## PART: migration-2026-10-21-notion-links.sql
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

-- ######## PART: migration-2026-10-21-step2-calendars-profiles.sql
-- SANDY migration 2026-10-21 (multi-user step 2): per-user calendars, profiles, account
-- export/delete support, abuse limits, per-owner category names.
-- Run in Supabase Dashboard -> SQL Editor AFTER the step 1 + notion-links migrations.
-- ONE transaction and rerunnable: if any guard fails, everything rolls back and nothing changes.
-- No existing rows are changed or deleted. Scott's three calendars are inserted with the exact
-- names/colors/slugs the app uses today, so events.calendar ('msc'/'mam'/'lifetime') keeps working.
begin;

do $$ begin
  if to_regprocedure('public.sandy_set_owner()') is null or to_regclass('public.occurrence_links') is null then
    raise exception 'Run the step 1 and notion-links migrations first; aborting';
  end if;
  if public.sandy_default_owner() is null then raise exception 'Scott''s auth user not found; aborting'; end if;
end $$;

create temp table _c2 on commit drop as
  select 'events' t, count(*) n from public.events
  union all select 'categories', count(*) from public.categories
  union all select 'occurrence_notes', count(*) from public.occurrence_notes
  union all select 'occurrence_checks', count(*) from public.occurrence_checks
  union all select 'occurrence_links', count(*) from public.occurrence_links;

-- ---------------------------------------------------------------- 1. calendars
create table if not exists public.calendars (
  id         uuid primary key default gen_random_uuid(),
  owner_id   uuid not null references auth.users(id) on delete cascade,
  slug       text not null check (slug ~ '^[a-z0-9][a-z0-9-]{0,39}$'),
  name       text not null check (length(trim(name)) between 1 and 80),
  short      text check (short is null or length(short) <= 20),
  color      text not null check (color ~ '^#[0-9a-fA-F]{6}$'),
  sort       integer not null default 0,
  created_at timestamptz not null default now(),
  unique (owner_id, slug)
);
-- owner_id may be omitted on insert; the step 1 trigger fills it (auth.uid(), or Scott for bots)
alter table public.calendars alter column owner_id drop not null;
drop trigger if exists calendars_owner on public.calendars;
create trigger calendars_owner before insert or update on public.calendars
  for each row execute function public.sandy_set_owner();
alter table public.calendars alter column owner_id set not null;
alter table public.calendars enable row level security;
revoke all on public.calendars from anon;
grant select, insert, update, delete on public.calendars to authenticated;
grant all on public.calendars to service_role;
drop policy if exists calendars_owner_all on public.calendars;
create policy calendars_owner_all on public.calendars for all to authenticated
  using (owner_id = (select auth.uid())) with check (owner_id = (select auth.uid()));
create index if not exists calendars_owner_idx on public.calendars (owner_id, sort);

insert into public.calendars (owner_id, slug, name, short, color, sort) values
  (public.sandy_default_owner(), 'msc',      'MSC – Mental Stability Community', 'MSC',       '#7c3aed', 0),
  (public.sandy_default_owner(), 'mam',      'Minds Above Matters',              'MAM',       '#ea580c', 1),
  (public.sandy_default_owner(), 'lifetime', 'Life Time – Facility Ops',         'Life Time', '#0f766e', 2)
on conflict (owner_id, slug) do nothing;

-- ---------------------------------------------------------------- 2. slugs are per owner, not global
do $$ declare r record; begin
  for r in select conrelid::regclass::text tbl, conname from pg_constraint
           where conrelid in ('public.events'::regclass, 'public.categories'::regclass)
             and contype = 'c' and pg_get_constraintdef(oid) ilike '%''lifetime''%' loop
    execute format('alter table %s drop constraint %I', r.tbl, r.conname);
  end loop;
  -- categories: unique (calendar, name) -> unique (owner_id, calendar, name)
  for r in select conname from pg_constraint
           where conrelid = 'public.categories'::regclass and contype = 'u'
             and pg_get_constraintdef(oid) = 'UNIQUE (calendar, name)' loop
    execute format('alter table public.categories drop constraint %I', r.conname);
  end loop;
end $$;
create unique index if not exists categories_owner_cal_name_key on public.categories (owner_id, calendar, name);

-- events/categories must name one of the owner's calendars (runs after the owner trigger: name sorts later)
create or replace function public.sandy_check_calendar()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if not exists (select 1 from public.calendars c where c.owner_id = new.owner_id and c.slug = new.calendar) then
    raise exception 'Unknown calendar "%" for this account', new.calendar using errcode = '23514';
  end if;
  return new;
end $$;
revoke all on function public.sandy_check_calendar() from public, anon, authenticated;
drop trigger if exists events_zz_calendar on public.events;
create trigger events_zz_calendar before insert or update of calendar, owner_id on public.events
  for each row execute function public.sandy_check_calendar();
drop trigger if exists categories_zz_calendar on public.categories;
create trigger categories_zz_calendar before insert or update of calendar, owner_id on public.categories
  for each row execute function public.sandy_check_calendar();

-- ---------------------------------------------------------------- 3. profiles
create table if not exists public.profiles (
  user_id      uuid primary key default auth.uid() references auth.users(id) on delete cascade,
  display_name text check (display_name is null or length(display_name) <= 80),
  time_zone    text not null default 'America/Chicago',
  plan         text not null default 'free' check (plan in ('free', 'paid', 'paid_ai')),
  created_at   timestamptz not null default now()
);
create or replace function public.sandy_profile_guard()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if not exists (select 1 from pg_catalog.pg_timezone_names where name = new.time_zone) then
    raise exception 'Unknown time zone "%"', new.time_zone using errcode = '23514';
  end if;
  if auth.uid() is not null and coalesce(auth.role(), '') <> 'service_role' then  -- a signed-in user (not bots / SQL editor)
    -- users can't choose their own plan (billing will set it later)
    if tg_op = 'INSERT' then new.plan := 'free'; else new.plan := old.plan; new.user_id := old.user_id; end if;
  end if;
  return new;
end $$;
revoke all on function public.sandy_profile_guard() from public, anon, authenticated;
drop trigger if exists profiles_guard on public.profiles;
create trigger profiles_guard before insert or update on public.profiles
  for each row execute function public.sandy_profile_guard();
alter table public.profiles enable row level security;
revoke all on public.profiles from anon, authenticated;
grant select, insert, update on public.profiles to authenticated;
grant all on public.profiles to service_role;
drop policy if exists profiles_self on public.profiles;
create policy profiles_self on public.profiles for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

insert into public.profiles (user_id, display_name, time_zone)
  values (public.sandy_default_owner(), 'Scott', 'America/Chicago')
on conflict (user_id) do nothing;

-- ---------------------------------------------------------------- 4. abuse limits
-- (NOT VALID is not used: existing rows are checked, so a violation aborts the migration)
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'events_title_len') then
    alter table public.events add constraint events_title_len check (length(title) <= 300);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'events_notes_len') then
    alter table public.events add constraint events_notes_len check (notes is null or length(notes) <= 20000);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'events_location_len') then
    alter table public.events add constraint events_location_len check (location is null or length(location) <= 500);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'occurrence_notes_body_len') then
    alter table public.occurrence_notes add constraint occurrence_notes_body_len check (length(body) <= 20000);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'categories_name_len') then
    alter table public.categories add constraint categories_name_len check (length(name) <= 80);
  end if;
end $$;

create or replace function public.sandy_row_cap()
returns trigger language plpgsql security definer set search_path = '' as $$
declare cap int := tg_argv[0]::int; n int;
begin
  execute format('select count(*) from public.%I where owner_id = $1', tg_table_name) into n using new.owner_id;
  if n >= cap then
    raise exception 'Limit reached: at most % % per account', cap, replace(tg_table_name, '_', ' ') using errcode = '54000';
  end if;
  return new;
end $$;
revoke all on function public.sandy_row_cap() from public, anon, authenticated;
drop trigger if exists events_zz_cap on public.events;
create trigger events_zz_cap before insert on public.events for each row execute function public.sandy_row_cap('5000');
drop trigger if exists calendars_zz_cap on public.calendars;
create trigger calendars_zz_cap before insert on public.calendars for each row execute function public.sandy_row_cap('20');
drop trigger if exists categories_zz_cap on public.categories;
create trigger categories_zz_cap before insert on public.categories for each row execute function public.sandy_row_cap('300');
drop trigger if exists occurrence_notes_zz_cap on public.occurrence_notes;
create trigger occurrence_notes_zz_cap before insert on public.occurrence_notes for each row execute function public.sandy_row_cap('20000');

-- ---------------------------------------------------------------- 5. delete my account
-- Only ever deletes the CALLER's own data (auth.uid()); the caller must type their exact email.
create or replace function public.delete_my_account(confirm_email text)
returns json language plpgsql security definer set search_path = '' as $$
declare me uuid := auth.uid(); my_email text; n_events int;
begin
  if me is null then raise exception 'Not signed in'; end if;
  select email into my_email from auth.users where id = me;
  if my_email is null or confirm_email is null or trim(confirm_email) <> my_email then
    raise exception 'Confirmation does not match this account''s email; nothing was deleted';
  end if;
  delete from public.occurrence_links  where owner_id = me;
  delete from public.occurrence_checks where owner_id = me;
  delete from public.occurrence_notes  where owner_id = me;
  delete from public.events where owner_id = me and series_id is not null;
  delete from public.events where owner_id = me;
  get diagnostics n_events = row_count;
  delete from public.categories where owner_id = me;
  delete from public.calendars  where owner_id = me;
  delete from public.profiles   where user_id = me;
  delete from auth.users where id = me;
  return json_build_object('deleted', true, 'series_and_events', n_events);
end $$;
revoke all on function public.delete_my_account(text) from public, anon;
grant execute on function public.delete_my_account(text) to authenticated;

-- ---------------------------------------------------------------- guards
do $$ declare bad int; begin
  select count(*) into bad from _c2 c where c.n <> case c.t
      when 'events' then (select count(*) from public.events)
      when 'categories' then (select count(*) from public.categories)
      when 'occurrence_notes' then (select count(*) from public.occurrence_notes)
      when 'occurrence_checks' then (select count(*) from public.occurrence_checks)
      else (select count(*) from public.occurrence_links) end;
  if bad > 0 then raise exception 'row counts changed; aborting'; end if;
  if (select count(*) from public.calendars where owner_id = public.sandy_default_owner()
        and slug in ('msc','mam','lifetime')) <> 3 then raise exception 'Scott''s 3 calendars missing; aborting'; end if;
  if exists (select 1 from public.events e where not exists
               (select 1 from public.calendars c where c.owner_id = e.owner_id and c.slug = e.calendar))
     or exists (select 1 from public.categories k where not exists
               (select 1 from public.calendars c where c.owner_id = k.owner_id and c.slug = k.calendar))
  then raise exception 'some rows point at a calendar their owner does not have; aborting'; end if;
end $$;

commit;
notify pgrst, 'reload schema';

select 'calendars' t, count(*) from public.calendars union all select 'profiles', count(*) from public.profiles
union all select 'events', count(*) from public.events union all select 'categories', count(*) from public.categories
union all select 'occurrence_notes', count(*) from public.occurrence_notes;

-- ######## PART: migration-2026-10-22-ai-usage.sql
-- SANDY AI assistant (Phase 1): per-user daily request counter for the ai-assistant Edge Function.
-- Safe to re-run.
create table if not exists public.ai_usage (
  owner_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  day      date not null,                    -- America/Chicago date
  count    integer not null default 0,
  primary key (owner_id, day)
);
alter table public.ai_usage enable row level security;
revoke all on public.ai_usage from anon, authenticated;
grant select on public.ai_usage to authenticated;
grant all on public.ai_usage to service_role;
drop policy if exists ai_usage_owner_read on public.ai_usage;
create policy ai_usage_owner_read on public.ai_usage for select to authenticated using (owner_id = auth.uid());

-- Atomically bump today's counter for the caller; returns the new count, or -1 when over the limit.
create or replace function public.ai_bump_usage(daily_limit integer default 50)
returns integer language plpgsql security definer set search_path = '' as $$
declare uid uuid := auth.uid(); d date := (now() at time zone 'America/Chicago')::date; n integer;
begin
  if uid is null then raise exception 'not signed in'; end if;
  insert into public.ai_usage (owner_id, day, count) values (uid, d, 1)
    on conflict (owner_id, day) do update set count = public.ai_usage.count + 1
    returning count into n;
  if n > least(greatest(daily_limit, 1), 500) then return -1; end if;
  return n;
end $$;
revoke all on function public.ai_bump_usage(integer) from public, anon;
grant execute on function public.ai_bump_usage(integer) to authenticated;

-- ######## PART: migration-2026-10-24-launch.sql
-- SANDY migration 2026-10-24 (free-prototype launch): invites, feedback, admin check, per-user time zone.
-- Run in Supabase Dashboard -> SQL Editor AFTER all earlier migrations (step 2 + ai-usage).
-- ONE transaction and rerunnable. No existing rows are changed or deleted (guarded below).
begin;

do $$ begin
  if to_regclass('public.profiles') is null or to_regprocedure('public.ai_bump_usage(integer)') is null then
    raise exception 'Run the step 2 and ai-usage migrations first; aborting';
  end if;
end $$;

create temp table _c3 on commit drop as
  select 'events' t, count(*) n from public.events
  union all select 'calendars', count(*) from public.calendars
  union all select 'profiles', count(*) from public.profiles
  union all select 'categories', count(*) from public.categories
  union all select 'occurrence_notes', count(*) from public.occurrence_notes;

-- ---------------------------------------------------------------- 1. admin = the owner account (Scott)
-- No flag column: nobody can make themselves admin by editing a row.
create or replace function public.sandy_is_admin()
returns boolean language sql stable security definer set search_path = '' as $$
  select auth.uid() is not null and auth.uid() = public.sandy_default_owner()
$$;
revoke all on function public.sandy_is_admin() from public, anon;
grant execute on function public.sandy_is_admin() to authenticated, service_role;

-- ---------------------------------------------------------------- 2. invites (admin only)
-- Written by the admin-invites Edge Function (service role); the admin can read them in the app.
create table if not exists public.invites (
  id          uuid primary key default gen_random_uuid(),
  email       text not null check (email = lower(trim(email)) and email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' and length(email) <= 254),
  status      text not null default 'invited' check (status in ('invited', 'accepted', 'revoked')),
  user_id     uuid references auth.users(id) on delete set null,
  invited_by  uuid references auth.users(id) on delete set null,
  note        text check (note is null or length(note) <= 500),
  created_at  timestamptz not null default now(),
  accepted_at timestamptz,
  unique (email)
);
alter table public.invites enable row level security;
revoke all on public.invites from anon, authenticated;
grant select on public.invites to authenticated;
grant all on public.invites to service_role;
drop policy if exists invites_admin_read on public.invites;
create policy invites_admin_read on public.invites for select to authenticated using (public.sandy_is_admin());

-- Called by the app after sign-in: marks the caller's own invite accepted (no-op otherwise).
create or replace function public.accept_my_invite()
returns void language plpgsql security definer set search_path = '' as $$
declare me uuid := auth.uid(); my_email text;
begin
  if me is null then return; end if;
  select lower(email) into my_email from auth.users where id = me;
  update public.invites set status = 'accepted', accepted_at = coalesce(accepted_at, now()), user_id = me
    where email = my_email and status = 'invited';
end $$;
revoke all on function public.accept_my_invite() from public, anon;
grant execute on function public.accept_my_invite() to authenticated;

-- ---------------------------------------------------------------- 3. feedback
create table if not exists public.feedback (
  id         uuid primary key default gen_random_uuid(),
  owner_id   uuid not null default auth.uid() references auth.users(id) on delete cascade,
  email      text,
  body       text not null check (length(trim(body)) between 1 and 5000),
  page       text check (page is null or length(page) <= 200),
  user_agent text check (user_agent is null or length(user_agent) <= 400),
  created_at timestamptz not null default now()
);
create index if not exists feedback_created_idx on public.feedback (created_at desc);
alter table public.feedback enable row level security;
revoke all on public.feedback from anon, authenticated;
grant select, insert on public.feedback to authenticated;
grant all on public.feedback to service_role;
drop policy if exists feedback_insert_own on public.feedback;
create policy feedback_insert_own on public.feedback for insert to authenticated
  with check (owner_id = (select auth.uid()));
drop policy if exists feedback_read on public.feedback;
create policy feedback_read on public.feedback for select to authenticated
  using (owner_id = (select auth.uid()) or public.sandy_is_admin());
-- stamp the sender's email server-side (can't be spoofed)
create or replace function public.sandy_feedback_stamp()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is not null then
    new.owner_id := auth.uid();
    select email into new.email from auth.users where id = auth.uid();
  end if;
  new.created_at := now();
  return new;
end $$;
revoke all on function public.sandy_feedback_stamp() from public, anon, authenticated;
drop trigger if exists feedback_stamp on public.feedback;
create trigger feedback_stamp before insert on public.feedback for each row execute function public.sandy_feedback_stamp();
drop trigger if exists feedback_zz_cap on public.feedback;
create trigger feedback_zz_cap before insert on public.feedback for each row execute function public.sandy_row_cap('500');

-- ---------------------------------------------------------------- 4. per-user time zone
-- profiles.time_zone already exists (validated). events.time_zone was pinned to America/Chicago:
-- relax it to "any valid zone" and default new rows to the owner's profile zone.
do $$ declare r record; begin
  for r in select conname from pg_constraint where conrelid = 'public.events'::regclass and contype = 'c'
             and pg_get_constraintdef(oid) ilike '%time_zone%America/Chicago%' loop
    execute format('alter table public.events drop constraint %I', r.conname);
  end loop;
end $$;
create or replace function public.sandy_event_tz()
returns trigger language plpgsql security definer set search_path = '' as $$
declare z text;
begin
  if tg_op = 'INSERT' and (new.time_zone is null or new.time_zone = 'America/Chicago') then
    select time_zone into z from public.profiles where user_id = new.owner_id;
    if z is not null then new.time_zone := z; end if;
  end if;
  if not exists (select 1 from pg_catalog.pg_timezone_names where name = new.time_zone) then
    raise exception 'Unknown time zone "%"', new.time_zone using errcode = '23514';
  end if;
  return new;
end $$;
revoke all on function public.sandy_event_tz() from public, anon, authenticated;
drop trigger if exists events_zz_tz on public.events;
create trigger events_zz_tz before insert or update of time_zone on public.events
  for each row execute function public.sandy_event_tz();

-- AI daily limit counts days in the caller's own time zone
create or replace function public.ai_bump_usage(daily_limit integer default 50)
returns integer language plpgsql security definer set search_path = '' as $$
declare uid uuid := auth.uid(); z text; d date; n integer;
begin
  if uid is null then raise exception 'not signed in'; end if;
  select time_zone into z from public.profiles where user_id = uid;
  d := (now() at time zone coalesce(z, 'America/Chicago'))::date;
  insert into public.ai_usage (owner_id, day, count) values (uid, d, 1)
    on conflict (owner_id, day) do update set count = public.ai_usage.count + 1
    returning count into n;
  if n > least(greatest(daily_limit, 1), 500) then return -1; end if;
  return n;
end $$;
revoke all on function public.ai_bump_usage(integer) from public, anon;
grant execute on function public.ai_bump_usage(integer) to authenticated;

-- ---------------------------------------------------------------- guards
do $$ declare bad int; begin
  select count(*) into bad from _c3 c where c.n <> case c.t
      when 'events' then (select count(*) from public.events)
      when 'calendars' then (select count(*) from public.calendars)
      when 'profiles' then (select count(*) from public.profiles)
      when 'categories' then (select count(*) from public.categories)
      else (select count(*) from public.occurrence_notes) end;
  if bad > 0 then raise exception 'row counts changed; aborting'; end if;
end $$;

commit;
notify pgrst, 'reload schema';
select 'invites' t, count(*) from public.invites union all select 'feedback', count(*) from public.feedback;
