-- SANDY migration 2026-10-25b: leave-by push alerts (Sandy Intelligence feature A).
-- Run once in Supabase Dashboard -> SQL Editor AFTER migration-2026-10-25-home.sql. Idempotent, additive only.
-- Then redeploy the send-reminders Edge Function (it already runs every minute from pg_cron).
--   * profiles.leave_alerts       : per-user on/off (default off)
--   * profiles.leave_alerts_early : also a "leave in 10 min" heads-up (default on)
--   * leave_plans                 : the app's computed leave-by time per event occurrence (owner-only via RLS).
--     It stores the time to leave, the drive minutes and a label ("home", "your current location", a previous
--     event) -- never GPS coordinates. dest_lat/dest_lon are the EVENT's geocoded location (not the user's).
begin;
alter table public.profiles add column if not exists leave_alerts boolean not null default false;
alter table public.profiles add column if not exists leave_alerts_early boolean not null default true;

create table if not exists public.leave_plans (
  event_id        uuid not null references public.events(id) on delete cascade,
  occurrence_date date not null,
  owner_id        uuid not null default auth.uid() references auth.users(id) on delete cascade,
  event_start     timestamp without time zone not null,             -- wall clock (same as events.start_at)
  location        text not null check (length(location) <= 500),
  leave_at        timestamptz not null,
  home_leave_at   timestamptz,                                      -- leave-by from home (drives the 1-hour "check your drive" push)
  drive_min       integer not null check (drive_min between 0 and 1440),
  origin          text not null default 'home' check (origin in ('home', 'event', 'current')),
  origin_label    text not null default 'home' check (length(origin_label) <= 200),
  status          text not null default 'ok' check (status in ('ok', 'failed')),
  source          text not null default 'client' check (source in ('client', 'server')),
  updated_at      timestamptz not null default now(),
  primary key (event_id, occurrence_date)
);
create index if not exists leave_plans_due_idx on public.leave_plans (leave_at);
create index if not exists leave_plans_owner_idx on public.leave_plans (owner_id);
alter table public.leave_plans enable row level security;
revoke all on public.leave_plans from anon, authenticated;
grant select, insert, update, delete on public.leave_plans to authenticated;
grant all on public.leave_plans to service_role;
drop policy if exists leave_plans_own on public.leave_plans;
create policy leave_plans_own on public.leave_plans for all to authenticated
  using (owner_id = (select auth.uid()))
  with check (owner_id = (select auth.uid())
    and exists (select 1 from public.events e where e.id = event_id and e.owner_id = (select auth.uid())));
-- old plans (2+ days past) are deleted by send-reminders once an hour
notify pgrst, 'reload schema';
commit;
