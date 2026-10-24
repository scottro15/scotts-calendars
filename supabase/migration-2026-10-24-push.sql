-- SANDY migration 2026-10-24b: reminders + Web Push notifications.
-- Run in Supabase Dashboard -> SQL Editor AFTER migration-2026-10-24-launch.sql. Rerunnable.
-- Part 1 (one transaction) adds tables/columns; no existing rows are changed (guarded).
-- Part 2 schedules the every-minute job (pg_cron + pg_net) that calls the send-reminders Edge Function.
-- The cron secret is generated INSIDE the database (Vault) and never leaves it in plain text.
begin;

create temp table _c4 on commit drop as
  select 'events' t, count(*) n from public.events
  union all select 'calendars', count(*) from public.calendars
  union all select 'profiles', count(*) from public.profiles;

-- ---------------------------------------------------------------- 1. reminders on events / to-dos
-- minutes before the start (all-day items: before 9:00 AM local), at most 6, up to 6 months (186 days)
alter table public.events add column if not exists reminders integer[] not null default '{}';
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'events_reminders_ok') then
    alter table public.events add constraint events_reminders_ok
      check (cardinality(reminders) <= 6 and 0 <= all (reminders) and 267840 >= all (reminders));
  end if;
end $$;
create index if not exists events_has_reminders_idx on public.events (owner_id) where reminders <> '{}';

-- ---------------------------------------------------------------- 2. push subscriptions (one per device/browser)
create table if not exists public.push_subscriptions (
  id           uuid primary key default gen_random_uuid(),
  owner_id     uuid not null default auth.uid() references auth.users(id) on delete cascade,
  endpoint     text not null unique check (endpoint ~ '^https://' and length(endpoint) <= 1000),
  p256dh       text not null check (length(p256dh) between 40 and 200),
  auth         text not null check (length(auth) between 10 and 100),
  user_agent   text check (user_agent is null or length(user_agent) <= 400),
  created_at   timestamptz not null default now()
);
create index if not exists push_subscriptions_owner_idx on public.push_subscriptions (owner_id);
alter table public.push_subscriptions enable row level security;
revoke all on public.push_subscriptions from anon, authenticated;
grant select, delete on public.push_subscriptions to authenticated;
grant all on public.push_subscriptions to service_role;
drop policy if exists push_subs_own_read on public.push_subscriptions;
create policy push_subs_own_read on public.push_subscriptions for select to authenticated using (owner_id = (select auth.uid()));
drop policy if exists push_subs_own_delete on public.push_subscriptions;
create policy push_subs_own_delete on public.push_subscriptions for delete to authenticated using (owner_id = (select auth.uid()));

-- Save this device for the caller. A browser endpoint belongs to whoever signed in last on it.
create or replace function public.save_push_subscription(p_endpoint text, p_p256dh text, p_auth text, p_user_agent text default null)
returns void language plpgsql security definer set search_path = '' as $$
declare me uuid := auth.uid(); n int;
begin
  if me is null then raise exception 'Not signed in'; end if;
  select count(*) into n from public.push_subscriptions where owner_id = me and endpoint <> p_endpoint;
  if n >= 10 then raise exception 'Limit reached: at most 10 devices with notifications'; end if;
  delete from public.push_subscriptions where endpoint = p_endpoint;
  insert into public.push_subscriptions (owner_id, endpoint, p256dh, auth, user_agent)
    values (me, p_endpoint, p_p256dh, p_auth, left(p_user_agent, 400));
end $$;
revoke all on function public.save_push_subscription(text, text, text, text) from public, anon;
grant execute on function public.save_push_subscription(text, text, text, text) to authenticated;

-- ---------------------------------------------------------------- 3. sent log (dedupe; service role only)
create table if not exists public.reminder_sends (
  event_id        uuid not null references public.events(id) on delete cascade,
  occurrence_date date not null,
  minutes         integer not null,
  owner_id        uuid references auth.users(id) on delete cascade,
  sent_at         timestamptz not null default now(),
  primary key (event_id, occurrence_date, minutes)
);
alter table public.reminder_sends enable row level security;
revoke all on public.reminder_sends from anon, authenticated;
grant all on public.reminder_sends to service_role;

-- ---------------------------------------------------------------- 4. cron secret (lives only in Vault)
create or replace function public.sandy_check_cron_secret(s text)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from vault.decrypted_secrets where name = 'sandy_push_cron_secret' and decrypted_secret = s)
$$;
revoke all on function public.sandy_check_cron_secret(text) from public, anon, authenticated;
grant execute on function public.sandy_check_cron_secret(text) to service_role;
do $$ begin
  if not exists (select 1 from vault.secrets where name = 'sandy_push_cron_secret') then
    perform vault.create_secret(replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', ''), 'sandy_push_cron_secret', 'SANDY: send-reminders cron caller check');
  end if;
end $$;

do $$ declare bad int; begin
  select count(*) into bad from _c4 c where c.n <> case c.t
      when 'events' then (select count(*) from public.events)
      when 'calendars' then (select count(*) from public.calendars)
      else (select count(*) from public.profiles) end;
  if bad > 0 then raise exception 'row counts changed; aborting'; end if;
end $$;
commit;

-- ---------------------------------------------------------------- 5. every-minute job (Part 2)
create extension if not exists pg_cron;
create extension if not exists pg_net with schema extensions;
select cron.unschedule(jobid) from cron.job where jobname in ('sandy-send-reminders', 'sandy-reminders-cleanup');
select cron.schedule('sandy-send-reminders', '* * * * *', $job$
  select net.http_post(
    url := 'https://dnsihqpdjflswbpahzvl.supabase.co/functions/v1/send-reminders',
    headers := jsonb_build_object('content-type', 'application/json',
      'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'sandy_push_cron_secret')),
    body := '{}'::jsonb, timeout_milliseconds := 25000)
$job$);
-- keep the logs small: sent log 30 days, cron run history 3 days
select cron.schedule('sandy-reminders-cleanup', '17 4 * * *', $job$
  delete from public.reminder_sends where sent_at < now() - interval '30 days';
  delete from cron.job_run_details where end_time < now() - interval '3 days';
$job$);

notify pgrst, 'reload schema';
select jobname, schedule, active from cron.job where jobname like 'sandy-%';
