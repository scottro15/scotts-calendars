-- =====================================================================
-- SANDY: Supabase schema
-- Run once in the Supabase dashboard: SQL Editor -> New query -> paste -> Run.
-- It's safe to re-run (idempotent).
--
-- Time model: every start/end is a WALL-CLOCK time in America/Chicago,
-- stored as `timestamp without time zone`. That's how repeating events
-- stay at "6:00 AM" across DST changes. Convert with
--   start_at AT TIME ZONE 'America/Chicago'   -> timestamptz
-- All-day items store midnight and an INCLUSIVE end date.
--
-- Access:
--   * Browser app (anon key + Scott's signed-in session): RLS allows only
--     the owner email below.
--   * Bots (service_role key): bypass RLS by design. Keep that key secret.
-- =====================================================================


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
