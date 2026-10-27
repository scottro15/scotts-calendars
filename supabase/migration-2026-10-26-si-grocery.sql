-- SANDY migration 2026-10-26f: Sandy Intelligence feature #7 — Grocery nudge toggle.
-- Run once in Supabase Dashboard -> SQL Editor. Idempotent, additive only.
-- Push uses existing si_nudge_sends with kind 'grocery' (already allowed by
-- si_nudge_sends_kind_check from migration-2026-10-26-si-clash.sql).
-- Redeploy send-reminders ONLY after this column exists (and after si_weekly_review).
begin;
alter table public.profiles add column if not exists si_grocery boolean not null default true;

do $$ begin
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'profiles' and column_name = 'si_grocery'
  ) then raise exception 'si_grocery column missing'; end if;
end $$;
commit;
