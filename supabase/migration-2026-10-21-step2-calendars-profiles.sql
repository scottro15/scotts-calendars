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
