-- SANDY migration 2026-10-26e: Sandy Intelligence feature #6 — Sunday weekly review toggle.
-- Run once in Supabase Dashboard -> SQL Editor. Idempotent, additive only.
-- Push uses existing si_nudge_sends with kind 'weekly_review' (already allowed by
-- si_nudge_sends_kind_check from migration-2026-10-26-si-clash.sql). Redeploy send-reminders.
begin;
alter table public.profiles add column if not exists si_weekly_review boolean not null default true;

do $$ begin
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'profiles' and column_name = 'si_weekly_review'
  ) then raise exception 'si_weekly_review column missing'; end if;
end $$;
commit;
