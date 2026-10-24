-- SANDY migration 2026-10-24c: bottom-nav revamp (To-Do inbox, to-do categories, profile pictures).
-- Run in Supabase Dashboard -> SQL Editor (after the launch migration; independent of the push one). Rerunnable.
-- Adds tables/columns + a private Storage bucket; changes no existing rows (guarded).
begin;
create temp table _c5 on commit drop as
  select 'events' t, count(*) n from public.events
  union all select 'calendars', count(*) from public.calendars
  union all select 'profiles', count(*) from public.profiles;

-- ---------------------------------------------------------------- 1. to-do categories (user-created)
create table if not exists public.todo_categories (
  id         uuid primary key default gen_random_uuid(),
  owner_id   uuid not null default auth.uid() references auth.users(id) on delete cascade,
  name       text not null check (length(trim(name)) between 1 and 40),
  color      text not null default '#6b7280' check (color ~ '^#[0-9a-fA-F]{6}$'),
  sort       integer not null default 0,
  created_at timestamptz not null default now()
);
create unique index if not exists todo_categories_owner_name on public.todo_categories (owner_id, lower(name));
-- ---------------------------------------------------------------- 2. inbox: quick to-dos / notes, no date needed
create table if not exists public.inbox_items (
  id          uuid primary key default gen_random_uuid(),
  owner_id    uuid not null default auth.uid() references auth.users(id) on delete cascade,
  body        text not null check (length(trim(body)) between 1 and 2000),
  kind        text not null default 'todo' check (kind in ('todo', 'note')),
  calendar    text check (calendar is null or calendar ~ '^[a-z0-9][a-z0-9-]{0,39}$'),
  category_id uuid references public.todo_categories(id) on delete set null,
  done        boolean not null default false,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index if not exists inbox_items_owner_idx on public.inbox_items (owner_id, created_at);
-- ---------------------------------------------------------------- 3. scheduled to-dos can carry a category too
alter table public.events add column if not exists todo_category_id uuid references public.todo_categories(id) on delete set null;

-- owner stamping + "category must be yours" (security definer so it can see the category row)
create or replace function public.sandy_todo_owner()
returns trigger language plpgsql security definer set search_path = '' as $$
declare cat_owner uuid; cid uuid;
begin
  if tg_table_name in ('todo_categories', 'inbox_items') then
    if tg_op = 'UPDATE' and new.owner_id is distinct from old.owner_id and coalesce(auth.role(), '') <> 'service_role' then
      raise exception 'owner_id cannot be changed';
    end if;
    if tg_op = 'INSERT' and coalesce(auth.role(), '') <> 'service_role' then new.owner_id := auth.uid(); end if;
    if new.owner_id is null then raise exception 'Not signed in'; end if;
  end if;
  if tg_table_name = 'todo_categories' then return new; end if;
  if tg_table_name = 'inbox_items' then cid := new.category_id; else cid := new.todo_category_id; end if;
  if cid is not null then
    select owner_id into cat_owner from public.todo_categories where id = cid;
    if cat_owner is distinct from new.owner_id then raise exception 'Unknown category'; end if;
  end if;
  if tg_table_name = 'inbox_items' then new.updated_at := now(); end if;
  return new;
end $$;
revoke all on function public.sandy_todo_owner() from public, anon, authenticated;
drop trigger if exists todo_categories_owner on public.todo_categories;
create trigger todo_categories_owner before insert or update on public.todo_categories for each row execute function public.sandy_todo_owner();
drop trigger if exists inbox_items_owner on public.inbox_items;
create trigger inbox_items_owner before insert or update on public.inbox_items for each row execute function public.sandy_todo_owner();
drop trigger if exists events_zy_todo_category on public.events; -- runs after events_owner (alphabetical)
create trigger events_zy_todo_category before insert or update of todo_category_id, owner_id on public.events
  for each row when (new.todo_category_id is not null) execute function public.sandy_todo_owner();
drop trigger if exists todo_categories_zz_cap on public.todo_categories;
create trigger todo_categories_zz_cap before insert on public.todo_categories for each row execute function public.sandy_row_cap('50');
drop trigger if exists inbox_items_zz_cap on public.inbox_items;
create trigger inbox_items_zz_cap before insert on public.inbox_items for each row execute function public.sandy_row_cap('2000');

alter table public.todo_categories enable row level security;
alter table public.inbox_items enable row level security;
revoke all on public.todo_categories, public.inbox_items from anon;
grant select, insert, update, delete on public.todo_categories, public.inbox_items to authenticated;
grant all on public.todo_categories, public.inbox_items to service_role;
drop policy if exists todo_categories_own on public.todo_categories;
create policy todo_categories_own on public.todo_categories for all to authenticated
  using (owner_id = (select auth.uid())) with check (owner_id = (select auth.uid()));
drop policy if exists inbox_items_own on public.inbox_items;
create policy inbox_items_own on public.inbox_items for all to authenticated
  using (owner_id = (select auth.uid())) with check (owner_id = (select auth.uid()));
do $$ begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    begin alter publication supabase_realtime add table public.inbox_items; exception when duplicate_object then null; end;
  end if;
end $$;

-- ---------------------------------------------------------------- 4. profile pictures: private bucket, one folder per user
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
  values ('avatars', 'avatars', false, 2097152, array['image/jpeg', 'image/png', 'image/webp'])
  on conflict (id) do update set public = false, file_size_limit = 2097152, allowed_mime_types = array['image/jpeg', 'image/png', 'image/webp'];
drop policy if exists sandy_avatars_read on storage.objects;
create policy sandy_avatars_read on storage.objects for select to authenticated
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = (select auth.uid())::text);
drop policy if exists sandy_avatars_insert on storage.objects;
create policy sandy_avatars_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'avatars' and (storage.foldername(name))[1] = (select auth.uid())::text);
drop policy if exists sandy_avatars_update on storage.objects;
create policy sandy_avatars_update on storage.objects for update to authenticated
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = (select auth.uid())::text)
  with check (bucket_id = 'avatars' and (storage.foldername(name))[1] = (select auth.uid())::text);
drop policy if exists sandy_avatars_delete on storage.objects;
create policy sandy_avatars_delete on storage.objects for delete to authenticated
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = (select auth.uid())::text);

do $$ declare bad int; begin
  select count(*) into bad from _c5 c where c.n <> case c.t
      when 'events' then (select count(*) from public.events)
      when 'calendars' then (select count(*) from public.calendars)
      else (select count(*) from public.profiles) end;
  if bad > 0 then raise exception 'row counts changed; aborting'; end if;
end $$;
commit;
notify pgrst, 'reload schema';
select (select count(*) from public.todo_categories) as todo_categories, (select count(*) from public.inbox_items) as inbox_items,
       (select public from storage.buckets where id = 'avatars') as avatars_public;
