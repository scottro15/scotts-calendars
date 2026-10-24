-- LOCAL TESTING ONLY: per-user RLS for todo_categories, inbox_items, events.todo_category_id, avatars bucket.
-- Run after launch_db_reset.sh.
\set ON_ERROR_STOP 1
\set QUIET 1
begin;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"aaaaaaaa-0000-0000-0000-00000000000a","role":"authenticated"}', true) \g /dev/null
insert into public.calendars (slug, name, color) values ('personal', 'Personal', '#2563eb') on conflict do nothing;
insert into public.todo_categories (id, name, color) values ('00000000-0000-0000-0000-0000000000c1', 'Errands', '#ff0000');
insert into public.inbox_items (body, category_id) values ('buy milk', '00000000-0000-0000-0000-0000000000c1');
insert into public.inbox_items (body, kind, owner_id) values ('idea', 'note', 'bbbbbbbb-0000-0000-0000-00000000000b'); -- spoofed owner gets stamped
do $$ begin if (select count(*) from public.inbox_items where owner_id = 'aaaaaaaa-0000-0000-0000-00000000000a') <> 2 then raise exception 'FAIL stamping'; end if; end $$;
\echo ok - alice creates category + inbox items (owner stamped)
insert into storage.objects (bucket_id, name) values ('avatars', 'aaaaaaaa-0000-0000-0000-00000000000a/avatar.jpg');
do $$ begin insert into storage.objects (bucket_id, name) values ('avatars', 'bbbbbbbb-0000-0000-0000-00000000000b/avatar.jpg'); raise exception 'FAIL avatar other folder';
exception when insufficient_privilege then null; end $$;
\echo ok - avatar only in own folder
select set_config('request.jwt.claims', '{"sub":"bbbbbbbb-0000-0000-0000-00000000000b","role":"authenticated"}', true) \g /dev/null
do $$ begin
  if (select count(*) from public.inbox_items) + (select count(*) from public.todo_categories) + (select count(*) from storage.objects) <> 0 then raise exception 'FAIL bob sees alice'; end if;
end $$;
insert into public.calendars (slug, name, color) values ('personal', 'Personal', '#2563eb') on conflict do nothing;
update public.inbox_items set body = 'hacked'; delete from public.todo_categories;
do $$ begin insert into public.inbox_items (body, category_id) values ('x', '00000000-0000-0000-0000-0000000000c1'); raise exception 'FAIL foreign category';
exception when raise_exception then if sqlerrm like 'FAIL%' then raise; end if; end $$;
do $$ begin insert into public.events (calendar, title, start_at, is_task, todo_category_id) values ('personal', 't', '2026-10-26 09:00', true, '00000000-0000-0000-0000-0000000000c1'); raise exception 'FAIL foreign category on event';
exception when raise_exception then if sqlerrm like 'FAIL%' then raise; end if; end $$;
\echo ok - bob cannot see or change alice items, nor use her category
select set_config('request.jwt.claims', '{"sub":"aaaaaaaa-0000-0000-0000-00000000000a","role":"authenticated"}', true) \g /dev/null
do $$ begin if (select body from public.inbox_items where kind = 'todo') <> 'buy milk' or (select count(*) from public.todo_categories) <> 1 then raise exception 'FAIL alice data changed'; end if; end $$;
insert into public.events (id, calendar, title, start_at, is_task, todo_category_id) values ('00000000-0000-0000-0000-0000000000e1', 'personal', 'task', '2026-10-26 09:00', true, '00000000-0000-0000-0000-0000000000c1');
delete from public.todo_categories;
do $$ begin if (select todo_category_id from public.events where id = '00000000-0000-0000-0000-0000000000e1') is not null
  or (select category_id from public.inbox_items where kind = 'todo') is not null then raise exception 'FAIL set null'; end if; end $$;
\echo ok - own category on a to-do; deleting it un-categorizes (no data loss)
do $$ begin insert into public.inbox_items (body) values ('   '); raise exception 'FAIL blank';
exception when check_violation then null; end $$;
\echo ok - blank inbox item rejected
rollback;
\echo NAV RLS TESTS PASSED
