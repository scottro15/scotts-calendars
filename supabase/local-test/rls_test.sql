-- LOCAL TESTING ONLY: checks RLS behaviour of schema.sql.
\set ON_ERROR_STOP 0
\echo '--- service_role insert (bots)'
set role service_role;
insert into public.events (id, calendar, title, start_at, end_at, source)
  values ('11111111-1111-1111-1111-111111111111','mam','Bot event','2026-10-20 09:00','2026-10-20 10:00','scheduler');
select count(*) as service_sees from public.events;
reset role;

\echo '--- anon: expect permission denied'
set role anon;
select count(*) from public.events;
reset role;

\echo '--- other authenticated user: expect 0 rows and insert blocked'
set role authenticated;
select set_config('request.jwt.claims', '{"sub":"22222222-2222-2222-2222-222222222222","email":"someone@else.com","role":"authenticated"}', false);
select count(*) as other_sees from public.events;
insert into public.events (calendar, title, start_at) values ('msc','Hacker','2026-10-20 09:00');
update public.events set title='pwned';
reset role;

\echo '--- owner (Scott): expect sees 1, can insert/update/delete'
set role authenticated;
select set_config('request.jwt.claims', '{"sub":"33333333-3333-3333-3333-333333333333","email":"ScottRo1522@gmail.com","role":"authenticated"}', false);
select count(*) as owner_sees from public.events;
insert into public.events (calendar, title, start_at, recur_freq, recur_by_weekday) values ('lifetime','Shift','2026-10-19 06:00','weekly','{1,2,3,4,5}') returning id, title;
update public.events set title='Bot event (edited)' where id='11111111-1111-1111-1111-111111111111' returning title, updated_at > created_at as touched;
insert into public.categories (calendar, name) values ('mam','Team practice – SLU') returning name;
\echo '--- constraints: expect 3 errors (bad calendar, bad weekday, exception w/o original_date)'
insert into public.events (calendar, title, start_at) values ('xyz','x','2026-10-20');
insert into public.events (calendar, title, start_at, recur_by_weekday) values ('msc','x','2026-10-20','{7}');
insert into public.events (calendar, title, start_at, series_id) values ('msc','x','2026-10-20','11111111-1111-1111-1111-111111111111');
\echo '--- exception cascade: expect 1 then 0'
insert into public.events (calendar, title, start_at, series_id, original_date) values ('mam','moved','2026-10-21 09:00','11111111-1111-1111-1111-111111111111','2026-10-20');
select count(*) from public.events where series_id='11111111-1111-1111-1111-111111111111';
delete from public.events where id='11111111-1111-1111-1111-111111111111';
select count(*) from public.events where series_id='11111111-1111-1111-1111-111111111111';
reset role;
select pubname, tablename from pg_publication_tables where pubname='supabase_realtime';
