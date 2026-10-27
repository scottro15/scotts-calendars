-- SANDY migration 2026-10-26c: Sandy Intelligence feature #4 — Free-gap to-do coach toggle.
-- Run once in Supabase Dashboard -> SQL Editor. Idempotent, additive only.
-- In-app only (no push / no si_nudge_sends kind). Future SI push kinds need a separate
-- migration to widen si_nudge_sends.kind beyond 'long_day'.
begin;
alter table public.profiles add column if not exists si_free_gap boolean not null default true;

do $$ begin
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'profiles' and column_name = 'si_free_gap'
  ) then raise exception 'si_free_gap column missing'; end if;
end $$;
commit;
