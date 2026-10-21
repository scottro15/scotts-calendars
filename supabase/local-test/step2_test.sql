-- LOCAL TESTING ONLY: step 2 onboarding + isolation + limits + account deletion.
\set ON_ERROR_STOP 0
\set QUIET 1
grant usage on schema public to authenticated;
\echo '--- tester (new user): sees 0 calendars, 0 events, 0 profiles'
set role authenticated;
select set_config('request.jwt.claims', '{"sub":"22222222-2222-2222-2222-222222222222","email":"tester@example.com","role":"authenticated"}', false);
select (select count(*) from public.calendars) cals, (select count(*) from public.events) evs, (select count(*) from public.profiles) profs, (select count(*) from public.categories) cats;
\echo '--- onboarding: create profile (plan forced to free) + 2 calendars, one reusing slug mam'
insert into public.profiles (display_name, time_zone, plan) values ('Tester', 'America/New_York', 'paid_ai') returning user_id, time_zone, plan;
insert into public.calendars (slug, name, color, sort) values ('work','Work','#2563eb',0), ('mam','My MAM','#16a34a',1) returning slug, owner_id;
\echo '--- expect error: bad time zone'
update public.profiles set time_zone = 'Mars/Base';
\echo '--- expect plan stays free'
update public.profiles set plan = 'paid' returning plan;
\echo '--- tester event in own calendar ok; in non-existent calendar -> error'
insert into public.events (calendar, title, start_at) values ('work','Tester event','2026-10-22 09:00') returning title;
insert into public.events (calendar, title, start_at) values ('msc','Sneaky','2026-10-22 09:00');
\echo '--- category with same name as Scott''s (per-owner unique) ok'
insert into public.categories (calendar, name) values ('mam','Personal Workout') returning name;
\echo '--- isolation: tester sees only own rows; updates/deletes on Scott rows affect 0'
select (select count(*) from public.calendars) cals, (select count(*) from public.events) evs, (select count(*) from public.profiles) profs, (select count(*) from public.occurrence_notes) notes;
update public.events set title='pwned' where owner_id='f85fb17b-2943-4266-b1b2-dc130ae8b678';
delete from public.calendars where owner_id='f85fb17b-2943-4266-b1b2-dc130ae8b678';
update public.profiles set display_name='x' where user_id='f85fb17b-2943-4266-b1b2-dc130ae8b678';
\echo '--- expect error: insert calendar owned by Scott'
insert into public.calendars (owner_id, slug, name, color) values ('f85fb17b-2943-4266-b1b2-dc130ae8b678','evil','Evil','#000000');
\echo '--- limits: expect errors for long title and long note'
insert into public.events (calendar, title, start_at) values ('work', repeat('x', 301), '2026-10-22 09:00');
insert into public.events (calendar, title, start_at, notes) values ('work', 'n', '2026-10-22 09:00', repeat('x', 20001));
\echo '--- delete account: wrong email -> error; Scott''s email -> error'
select public.delete_my_account('tester@exampl.com');
select public.delete_my_account('scottro1522@gmail.com');
reset role;
\echo '--- event cap: fill tester to 5000, then one more -> error'
insert into public.events (owner_id, calendar, title, start_at) select '22222222-2222-2222-2222-222222222222','work','bulk '||g, '2026-10-22 09:00' from generate_series(1,4999) g;
set role authenticated;
insert into public.events (calendar, title, start_at) values ('work','one too many','2026-10-22 09:00');
\echo '--- delete own account with exact email'
select public.delete_my_account('tester@example.com');
reset role;
\echo '--- after: tester rows gone, Scott untouched (expect 0 | 27 | 3 | 1 | 2 | 2)'
select (select count(*) from public.events where owner_id='22222222-2222-2222-2222-222222222222') tester_evs,
       (select count(*) from public.events) all_evs, (select count(*) from public.calendars) cals,
       (select count(*) from public.profiles) profs, (select count(*) from public.categories) cats,
       (select count(*) from public.occurrence_notes) notes, (select count(*) from auth.users) users;
\echo '--- anon: expect permission denied'
set role anon;
select count(*) from public.calendars;
select count(*) from public.profiles;
reset role;
