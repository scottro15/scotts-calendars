-- SANDY migration 2026-10-30: feedback replies (status updates from Scott) + new-feedback alerts.
-- Run once in Supabase Dashboard -> SQL Editor, AFTER migration-2026-10-24-launch.sql and -push.sql.
-- ONE transaction, rerunnable, additive only. Existing feedback rows are only marked as already
-- pushed/seen (so Scott isn't alerted about old notes); nothing is deleted.
-- Pushes are sent by the existing every-minute send-reminders job (web push only, no email).
begin;

do $$ begin
  if to_regclass('public.feedback') is null or to_regprocedure('public.sandy_is_admin()') is null
     or to_regclass('public.push_subscriptions') is null then
    raise exception 'Run the launch and push migrations first; aborting';
  end if;
end $$;

create temp table _fbn on commit drop as select count(*) n from public.feedback;

-- ---------------------------------------------------------------- 1. feedback: admin badge + alert queue
alter table public.feedback add column if not exists seen_at   timestamptz;  -- Scott opened the inbox after this arrived
alter table public.feedback add column if not exists pushed_at timestamptz;  -- new-feedback push to Scott handled
update public.feedback set pushed_at = coalesce(pushed_at, now()), seen_at = coalesce(seen_at, now())
  where pushed_at is null and created_at < now() - interval '1 minute';
create index if not exists feedback_unpushed_idx on public.feedback (created_at) where pushed_at is null;

-- senders can't pre-mark their own note as seen/pushed
create or replace function public.sandy_feedback_stamp()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is not null then
    new.owner_id := auth.uid();
    select email into new.email from auth.users where id = auth.uid();
  end if;
  new.created_at := now(); new.seen_at := null; new.pushed_at := null;
  return new;
end $$;
revoke all on function public.sandy_feedback_stamp() from public, anon, authenticated;

create or replace function public.mark_feedback_seen()
returns integer language plpgsql security definer set search_path = '' as $$
declare n int;
begin
  if not public.sandy_is_admin() then raise exception 'Not allowed' using errcode = '42501'; end if;
  update public.feedback set seen_at = now() where seen_at is null;
  get diagnostics n = row_count; return n;
end $$;
revoke all on function public.mark_feedback_seen() from public, anon;
grant execute on function public.mark_feedback_seen() to authenticated;

-- ---------------------------------------------------------------- 2. replies
create table if not exists public.feedback_replies (
  id          uuid primary key default gen_random_uuid(),
  feedback_id uuid not null references public.feedback(id) on delete cascade,
  owner_id    uuid not null references auth.users(id) on delete cascade,   -- who sent the feedback (reader)
  author_id   uuid references auth.users(id) on delete set null,           -- Scott
  status      text not null check (status in ('looking','fixing','fixed','planned','note')),
  body        text check (body is null or length(body) <= 2000),
  created_at  timestamptz not null default now(),
  read_at     timestamptz,
  pushed_at   timestamptz,
  constraint feedback_replies_note_body check (status <> 'note' or length(trim(coalesce(body, ''))) > 0)
);
create index if not exists feedback_replies_fb_idx on public.feedback_replies (feedback_id, created_at);
create index if not exists feedback_replies_owner_idx on public.feedback_replies (owner_id) where read_at is null;
create index if not exists feedback_replies_unpushed_idx on public.feedback_replies (created_at) where pushed_at is null;
alter table public.feedback_replies enable row level security;
revoke all on public.feedback_replies from anon, authenticated;
grant select, insert, delete on public.feedback_replies to authenticated;
grant all on public.feedback_replies to service_role;
drop policy if exists feedback_replies_read on public.feedback_replies;
create policy feedback_replies_read on public.feedback_replies for select to authenticated
  using (owner_id = (select auth.uid()) or public.sandy_is_admin());
drop policy if exists feedback_replies_admin_insert on public.feedback_replies;
create policy feedback_replies_admin_insert on public.feedback_replies for insert to authenticated
  with check (public.sandy_is_admin());
drop policy if exists feedback_replies_admin_delete on public.feedback_replies;
create policy feedback_replies_admin_delete on public.feedback_replies for delete to authenticated
  using (public.sandy_is_admin());

-- owner comes from the feedback row; author/time/read/pushed are server-set
create or replace function public.sandy_feedback_reply_stamp()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  select owner_id into new.owner_id from public.feedback where id = new.feedback_id;
  if new.owner_id is null then raise exception 'Feedback not found' using errcode = '23503'; end if;
  new.author_id := coalesce(auth.uid(), new.author_id);
  new.body := nullif(trim(coalesce(new.body, '')), '');
  new.created_at := now(); new.read_at := null; new.pushed_at := null;
  return new;
end $$;
revoke all on function public.sandy_feedback_reply_stamp() from public, anon, authenticated;
drop trigger if exists feedback_replies_stamp on public.feedback_replies;
create trigger feedback_replies_stamp before insert on public.feedback_replies for each row execute function public.sandy_feedback_reply_stamp();
drop trigger if exists feedback_replies_zz_cap on public.feedback_replies;
create trigger feedback_replies_zz_cap before insert on public.feedback_replies for each row execute function public.sandy_row_cap('500');

-- the reader marks their own replies read (no direct UPDATE grant)
create or replace function public.mark_my_feedback_replies_read()
returns integer language plpgsql security definer set search_path = '' as $$
declare n int;
begin
  if auth.uid() is null then return 0; end if;
  update public.feedback_replies set read_at = now() where owner_id = auth.uid() and read_at is null;
  get diagnostics n = row_count; return n;
end $$;
revoke all on function public.mark_my_feedback_replies_read() from public, anon;
grant execute on function public.mark_my_feedback_replies_read() to authenticated;

do $$ begin
  if (select count(*) from public.feedback) <> (select n from _fbn) then raise exception 'feedback row count changed; aborting'; end if;
end $$;
commit;
notify pgrst, 'reload schema';
select 'feedback' t, count(*) from public.feedback union all select 'feedback_replies', count(*) from public.feedback_replies;
