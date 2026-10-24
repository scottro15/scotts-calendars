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
