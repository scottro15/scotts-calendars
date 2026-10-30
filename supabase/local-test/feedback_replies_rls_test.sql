-- LOCAL TESTING ONLY: feedback replies RLS (migration-2026-10-30-feedback-replies.sql). Every check asserts.
-- Run on the launchui scratch DB (launch_db_reset.sh): Scott (admin), alice, bob.
\set ON_ERROR_STOP 1
\set QUIET 1
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
delete from public.feedback;
set role authenticated;
select pg_temp.as_user('aaaaaaaa-0000-0000-0000-00000000000a', 'alice@example.com');
insert into public.feedback (body, pushed_at, seen_at) values ('alice: the week view is slow', now(), now());
select pg_temp.ok((select pushed_at is null and seen_at is null from public.feedback), 'sender cannot pre-mark feedback pushed/seen');
select pg_temp.fails($$insert into public.feedback_replies (feedback_id, status) select id, 'fixed' from public.feedback$$, 'alice cannot reply (not admin)');
select pg_temp.fails($$select public.mark_feedback_seen()$$, 'alice cannot mark the inbox seen');
select pg_temp.as_user('bbbbbbbb-0000-0000-0000-00000000000b', 'bob@example.com');
insert into public.feedback (body) values ('bob: love it');
select pg_temp.ok((select count(*) from public.feedback) = 1, 'bob sees only his own feedback');
select pg_temp.as_user('f85fb17b-2943-4266-b1b2-dc130ae8b678', 'scottro1522@gmail.com');
select pg_temp.ok((select count(*) from public.feedback where seen_at is null) = 2, 'scott sees 2 unseen');
insert into public.feedback_replies (feedback_id, status, owner_id, read_at, pushed_at)
  select id, 'fixing', 'bbbbbbbb-0000-0000-0000-00000000000b', now(), now() from public.feedback where body like 'alice%';
select pg_temp.ok((select owner_id = 'aaaaaaaa-0000-0000-0000-00000000000a' and author_id = 'f85fb17b-2943-4266-b1b2-dc130ae8b678' and read_at is null and pushed_at is null from public.feedback_replies),
  'reply owner/author/read/pushed are server-set (spoofed owner ignored)');
insert into public.feedback_replies (feedback_id, status, body) select id, 'fixed', '  Fixed in today''s update  ' from public.feedback where body like 'alice%';
select pg_temp.ok((select body from public.feedback_replies where status = 'fixed') = 'Fixed in today''s update', 'reply body trimmed');
select pg_temp.fails($$insert into public.feedback_replies (feedback_id, status, body) select id, 'note', '  ' from public.feedback limit 1$$, 'custom note needs text');
select pg_temp.fails($$insert into public.feedback_replies (feedback_id, status) select id, 'bogus' from public.feedback limit 1$$, 'unknown status rejected');
select pg_temp.ok(public.mark_feedback_seen() = 2, 'scott marks inbox seen');
select pg_temp.as_user('bbbbbbbb-0000-0000-0000-00000000000b', 'bob@example.com');
select pg_temp.ok((select count(*) from public.feedback_replies) = 0, 'bob cannot see replies to alice');
select pg_temp.ok(public.mark_my_feedback_replies_read() = 0, 'bob marking read touches nothing of alice''s');
delete from public.feedback_replies;
select pg_temp.fails($$update public.feedback_replies set read_at = now()$$, 'no direct update');
select pg_temp.as_user('aaaaaaaa-0000-0000-0000-00000000000a', 'alice@example.com');
select pg_temp.ok((select count(*) from public.feedback_replies where read_at is null) = 2, 'alice sees her 2 unread replies (bob''s delete did nothing)');
delete from public.feedback_replies;
select pg_temp.ok((select count(*) from public.feedback_replies) = 2, 'alice cannot delete replies');
select pg_temp.ok(public.mark_my_feedback_replies_read() = 2, 'alice marks her replies read');
select pg_temp.ok((select count(*) from public.feedback_replies where read_at is null) = 0, 'now 0 unread');
reset role;
select pg_temp.ok((select count(*) from public.feedback_replies) = 2, 'rows intact');
delete from public.feedback;
select pg_temp.ok((select count(*) from public.feedback_replies) = 0, 'replies cascade with feedback');
