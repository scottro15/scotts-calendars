-- LOCAL TESTING ONLY: two-account isolation across EVERY user table + launch features
-- (invites, feedback, admin, time zone). Every check is an assertion: any failure aborts with an error.
-- Run on a scratch DB: supabase_stubs.sql, the owner auth user, then schema.sql, then this file.
\set ON_ERROR_STOP 1
\set QUIET 1
insert into auth.users values ('aaaaaaaa-0000-0000-0000-00000000000a','alice@example.com'),
                              ('bbbbbbbb-0000-0000-0000-00000000000b','bob@example.com') on conflict do nothing;
create or replace function pg_temp.as_user(uid text, email text) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', uid, 'email', email, 'role', 'authenticated')::text, false) $$;
create or replace function pg_temp.ok(cond boolean, what text) returns void language plpgsql as $$
begin if not coalesce(cond, false) then raise exception 'FAIL: %', what; end if; raise notice 'ok  %', what; end $$;
create or replace function pg_temp.fails(q text, what text) returns void language plpgsql as $$
begin
  begin execute q; exception when others then raise notice 'ok  % (blocked: %)', what, sqlerrm; return; end;
  raise exception 'FAIL: % (was allowed)', what;
end $$;
grant execute on all functions in schema pg_temp to authenticated;

-- ---- Scott (admin) seeds data, as himself
set role authenticated;
select pg_temp.as_user('f85fb17b-2943-4266-b1b2-dc130ae8b678', 'scottro1522@gmail.com');
insert into public.events (calendar, title, start_at) values ('msc', 'Scott private', '2026-10-26 09:00');
insert into public.occurrence_notes (event_id, occurrence_date, body) select id, '2026-10-26', 'scott note' from public.events where title = 'Scott private';
insert into public.occurrence_checks (event_id, occurrence_date, checked) select id, '2026-10-26', '{a}' from public.events where title = 'Scott private';
insert into public.categories (calendar, name) values ('msc', 'Scott cat');
insert into public.feedback (body) values ('scott feedback');
select pg_temp.ok(public.sandy_is_admin(), 'Scott is admin');
reset role;
-- admin-invites function (service role) creates invites for Alice and Bob
insert into public.invites (email, invited_by) values ('alice@example.com', 'f85fb17b-2943-4266-b1b2-dc130ae8b678'), ('bob@example.com', 'f85fb17b-2943-4266-b1b2-dc130ae8b678');

-- ---- Alice: new user onboarding
set role authenticated;
select pg_temp.as_user('aaaaaaaa-0000-0000-0000-00000000000a', 'alice@example.com');
select pg_temp.ok((select count(*) from public.events) = 0 and (select count(*) from public.calendars) = 0
  and (select count(*) from public.profiles) = 0 and (select count(*) from public.categories) = 0
  and (select count(*) from public.occurrence_notes) = 0 and (select count(*) from public.occurrence_checks) = 0
  and (select count(*) from public.occurrence_links) = 0 and (select count(*) from public.ai_usage) = 0, 'Alice starts with no rows at all');
select pg_temp.ok(not public.sandy_is_admin(), 'Alice is not admin');
select pg_temp.ok((select count(*) from public.invites) = 0, 'Alice cannot read invites');
select pg_temp.fails($$insert into public.invites (email) values ('evil@example.com')$$, 'Alice cannot create invites');
select public.accept_my_invite();
insert into public.profiles (display_name, time_zone, plan) values ('Alice', 'America/Denver', 'paid_ai');
select pg_temp.ok((select plan from public.profiles) = 'free', 'Alice cannot pick a paid plan');
insert into public.calendars (slug, name, color) values ('personal', 'Personal', '#2563eb'), ('msc', 'Alice MSC', '#16a34a');
insert into public.events (calendar, title, start_at) values ('personal', 'Alice private', '2026-10-26 10:00');
select pg_temp.ok((select time_zone from public.events where title = 'Alice private') = 'America/Denver', 'new event defaults to Alice''s time zone');
insert into public.feedback (body, owner_id, email) values ('alice says hi', 'f85fb17b-2943-4266-b1b2-dc130ae8b678', 'spoof@example.com');
select pg_temp.ok((select owner_id::text || email from public.feedback) = 'aaaaaaaa-0000-0000-0000-00000000000aalice@example.com', 'feedback owner/email are stamped server-side (no spoofing)');
select pg_temp.ok((select count(*) from public.feedback) = 1, 'Alice sees only her own feedback');
select pg_temp.ok((select count(*) from public.events) = 1 and (select count(*) from public.calendars) = 2, 'Alice sees only her rows');
-- write attempts on Scott's rows affect nothing / are rejected
update public.events set title = 'pwned' where title = 'Scott private';
delete from public.events where title = 'Scott private';
delete from public.occurrence_notes; delete from public.categories where name = 'Scott cat';
update public.profiles set display_name = 'x' where user_id = 'f85fb17b-2943-4266-b1b2-dc130ae8b678';
select pg_temp.fails($$insert into public.events (owner_id, calendar, title, start_at) values ('f85fb17b-2943-4266-b1b2-dc130ae8b678', 'msc', 'planted', '2026-10-26 09:00')$$, 'Alice cannot plant an event in Scott''s account');
insert into public.occurrence_notes (event_id, occurrence_date, body) select id, '2026-10-27', 'alice note' from public.events where title = 'Alice private';
update public.occurrence_notes set owner_id = 'f85fb17b-2943-4266-b1b2-dc130ae8b678';
select pg_temp.ok((select owner_id from public.occurrence_notes) = 'aaaaaaaa-0000-0000-0000-00000000000a', 'Alice cannot hand a note to Scott (owner forced to the event owner)');
select pg_temp.fails($$insert into public.occurrence_notes (event_id, occurrence_date, body) select id, '2026-10-28', 'x' from public.events where title = 'Alice private' limit 0;
  insert into public.occurrence_notes (event_id, occurrence_date, body) values ((select id from public.events limit 1), '2026-10-28', 'x');
  insert into public.occurrence_notes (event_id, occurrence_date, body) values (gen_random_uuid(), '2026-10-28', 'x')$$, 'Alice cannot attach a note to an event she cannot see');
select pg_temp.fails($$update public.profiles set time_zone = 'Mars/Base'$$, 'invalid time zone rejected');
update public.profiles set time_zone = 'Europe/London';
select pg_temp.ok((select time_zone from public.profiles) = 'Europe/London', 'Alice can change her time zone');
select pg_temp.ok(public.ai_bump_usage(50) = 1, 'AI counter is per user');

-- ---- Bob: second new account, sees nothing of Alice or Scott
select pg_temp.as_user('bbbbbbbb-0000-0000-0000-00000000000b', 'bob@example.com');
select pg_temp.ok((select count(*) from public.events) + (select count(*) from public.calendars) + (select count(*) from public.profiles)
  + (select count(*) from public.feedback) + (select count(*) from public.invites) + (select count(*) from public.ai_usage)
  + (select count(*) from public.occurrence_notes) + (select count(*) from public.categories) = 0, 'Bob sees none of Alice''s or Scott''s rows');
select pg_temp.fails($$select public.delete_my_account('alice@example.com')$$, 'Bob cannot delete Alice''s account');

-- ---- Scott: data untouched, admin reads invites + all feedback, cannot see Alice's calendar data
select pg_temp.as_user('f85fb17b-2943-4266-b1b2-dc130ae8b678', 'scottro1522@gmail.com');
select pg_temp.ok((select title from public.events where title like 'Scott%') = 'Scott private'
  and (select count(*) from public.occurrence_notes) = 1 and (select body from public.occurrence_notes) = 'scott note' and (select count(*) from public.categories where name = 'Scott cat') = 1, 'Scott''s rows unchanged');
select pg_temp.ok((select count(*) from public.events where title = 'Alice private') = 0 and (select count(*) from public.profiles) = 1, 'Scott (admin) still cannot see Alice''s calendar data');
select pg_temp.ok((select count(*) from public.feedback) = 2, 'admin reads all feedback');
select pg_temp.ok((select status from public.invites where email = 'alice@example.com') = 'accepted'
  and (select status from public.invites where email = 'bob@example.com') = 'invited', 'admin sees invite status (Alice accepted, Bob invited)');
reset role;
\echo 'ALL LAUNCH RLS CHECKS PASSED'
