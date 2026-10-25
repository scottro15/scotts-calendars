-- SANDY migration 2026-10-25 (fab): Todoist-style to-do priority (P1-P3; null = P4 / none).
-- Run in Supabase Dashboard -> SQL Editor (after migration-2026-10-24-nav.sql). Rerunnable. Changes no existing rows.
-- Until it runs, the app saves everything else and the To-Do "+" sheet's Priority chip simply isn't stored.
begin;
alter table public.events      add column if not exists priority smallint check (priority is null or priority between 1 and 3);
alter table public.inbox_items add column if not exists priority smallint check (priority is null or priority between 1 and 3);
notify pgrst, 'reload schema';
commit;
