-- SANDY migration 2026-10-26: Sandy Intelligence feature #2 — Long-day nudge.
-- Run once in Supabase Dashboard -> SQL Editor. Idempotent, additive only.
-- Then redeploy the send-reminders Edge Function (same every-minute pg_cron; no new cron).
--   * profiles.si_long_day  : per-user on/off (default on — Scott opted into SI #2)
--   * si_nudge_sends        : dedupe log for SI evening pushes (service_role only)
begin;
alter table public.profiles add column if not exists si_long_day boolean not null default true;

create table if not exists public.si_nudge_sends (
  owner_id    uuid not null references auth.users(id) on delete cascade,
  kind        text not null check (kind in ('long_day')),
  target_date date not null,
  sent_at     timestamptz not null default now(),
  primary key (owner_id, kind, target_date)
);
alter table public.si_nudge_sends enable row level security;
revoke all on public.si_nudge_sends from anon, authenticated;
grant all on public.si_nudge_sends to service_role;
-- no policies for authenticated: only the Edge Function (service role) writes/reads

do $$ declare bad int; begin
  select count(*) into bad from (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'profiles' and column_name = 'si_long_day'
  ) x;
  if bad < 1 then raise exception 'si_long_day column missing'; end if;
  if to_regclass('public.si_nudge_sends') is null then raise exception 'si_nudge_sends missing'; end if;
end $$;
commit;
