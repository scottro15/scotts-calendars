-- SANDY migration 2026-10-26d: Sandy Intelligence feature #5 — Clash check toggle
-- + widen si_nudge_sends.kind for future SI pushes (clash, weekly_review, grocery, weather).
-- Run once in Supabase Dashboard -> SQL Editor. Idempotent, additive only.
-- In-app Clash check does not push yet; the kind list is widened so later features
-- do not need another constraint migration.
begin;

alter table public.profiles add column if not exists si_clash boolean not null default true;

-- Widen si_nudge_sends.kind check: drop any existing CHECK on kind, add the expanded one.
do $$
declare
  r record;
begin
  if to_regclass('public.si_nudge_sends') is null then
    create table public.si_nudge_sends (
      owner_id    uuid not null references auth.users(id) on delete cascade,
      kind        text not null,
      target_date date not null,
      sent_at     timestamptz not null default now(),
      primary key (owner_id, kind, target_date),
      constraint si_nudge_sends_kind_check check (kind in ('long_day', 'clash', 'weekly_review', 'grocery', 'weather'))
    );
    alter table public.si_nudge_sends enable row level security;
    revoke all on public.si_nudge_sends from anon, authenticated;
    grant all on public.si_nudge_sends to service_role;
  else
    for r in
      select c.conname
      from pg_constraint c
      join pg_class t on t.oid = c.conrelid
      join pg_namespace n on n.oid = t.relnamespace
      where n.nspname = 'public' and t.relname = 'si_nudge_sends'
        and c.contype = 'c'
        and pg_get_constraintdef(c.oid) ilike '%kind%'
    loop
      execute format('alter table public.si_nudge_sends drop constraint %I', r.conname);
    end loop;
    alter table public.si_nudge_sends
      add constraint si_nudge_sends_kind_check
      check (kind in ('long_day', 'clash', 'weekly_review', 'grocery', 'weather'));
  end if;
end $$;

do $$ begin
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'profiles' and column_name = 'si_clash'
  ) then raise exception 'si_clash column missing'; end if;
  if to_regclass('public.si_nudge_sends') is null then raise exception 'si_nudge_sends missing'; end if;
end $$;

commit;
