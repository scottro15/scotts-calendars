-- Day notes migration: paste into Supabase SQL Editor and Run (safe to re-run).
-- ---------- Day notes
create table if not exists public.occurrence_notes (
  id              uuid primary key default gen_random_uuid(),
  event_id        uuid not null references public.events(id) on delete cascade,
  occurrence_date date not null,                                 -- America/Chicago date
  body            text not null check (length(trim(body)) > 0),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (event_id, occurrence_date)
);
create index if not exists occurrence_notes_date_idx on public.occurrence_notes (occurrence_date);

drop trigger if exists occurrence_notes_touch on public.occurrence_notes;
create trigger occurrence_notes_touch before update on public.occurrence_notes
  for each row execute function public.touch_updated_at();

alter table public.occurrence_notes enable row level security;
revoke all on public.occurrence_notes from anon;
grant select, insert, update, delete on public.occurrence_notes to authenticated;
grant all on public.occurrence_notes to service_role;

drop policy if exists occurrence_notes_owner_all on public.occurrence_notes;
create policy occurrence_notes_owner_all on public.occurrence_notes
  for all to authenticated
  using (public.is_calendar_owner())
  with check (public.is_calendar_owner());

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (select 1 from pg_publication_tables
                     where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'occurrence_notes') then
    alter publication supabase_realtime add table public.occurrence_notes;
  end if;
end $$;
alter table public.occurrence_notes replica identity full;
