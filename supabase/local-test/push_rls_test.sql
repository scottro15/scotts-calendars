-- LOCAL TESTING ONLY: RLS + RPC checks for the push migration. Run after launch_db_reset.sh.
\set ON_ERROR_STOP 1
select count(*) = 1 as vault_secret_created from vault.secrets where name = 'sandy_push_cron_secret' \gset
\if :vault_secret_created \echo ok - vault cron secret created \else \quit \endif
begin;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"aaaaaaaa-0000-0000-0000-00000000000a","role":"authenticated"}', true);
select public.save_push_subscription('https://push.example/a1', repeat('k',87), repeat('a',22), 'UA');
select public.save_push_subscription('https://push.example/a1', repeat('k',87), repeat('b',22), 'UA2');  -- re-save replaces
do $$ begin if (select count(*) from public.push_subscriptions) <> 1 then raise exception 'FAIL resave'; end if; end $$;
\echo ok - save/resave own subscription
do $$ begin insert into public.push_subscriptions(endpoint,p256dh,auth) values ('https://x/y',repeat('k',87),repeat('a',22)); raise exception 'FAIL direct insert';
exception when insufficient_privilege then null; end $$;
\echo ok - no direct insert
do $$ begin perform 1 from public.reminder_sends; raise exception 'FAIL reminder_sends readable';
exception when insufficient_privilege then null; end $$;
\echo ok - reminder_sends hidden
do $$ begin perform public.sandy_check_cron_secret('x'); raise exception 'FAIL secret check callable';
exception when insufficient_privilege then null; end $$;
\echo ok - cron secret check not callable by users
do $$ begin update public.events set reminders = '{1,2,3,4,5,6,7}' where false; perform 1; end $$;
select set_config('request.jwt.claims', '{"sub":"bbbbbbbb-0000-0000-0000-00000000000b","role":"authenticated"}', true);
do $$ begin if (select count(*) from public.push_subscriptions) <> 0 then raise exception 'FAIL bob sees alice'; end if; end $$;
delete from public.push_subscriptions;
reset role;
do $$ begin if (select count(*) from public.push_subscriptions) <> 1 then raise exception 'FAIL bob deleted alice'; end if; end $$;
\echo ok - other users cannot see or delete
do $$ begin update public.events set reminders = '{1,2,3,4,5,6,7}'; raise exception 'FAIL 7 reminders';
exception when check_violation then null; end $$;
do $$ begin update public.events set reminders = '{267841}'; raise exception 'FAIL > 6 months';
exception when check_violation then null; end $$;
update public.events set reminders = '{0,10,267840}';
\echo ok - reminders check (max 6, 0..267840)
rollback;
\echo PUSH RLS TESTS PASSED
