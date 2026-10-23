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
