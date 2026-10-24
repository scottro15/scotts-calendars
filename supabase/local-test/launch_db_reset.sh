#!/usr/bin/env bash
# LOCAL TESTING ONLY: (re)build the scratch DB for tests/launch.test.js and launch_rls_test.sql from schema.sql.
# usage: PGPORT=55433 DB=launchui supabase/local-test/launch_db_reset.sh   (needs a local Postgres; PostgREST must point at $DB)
set -euo pipefail
cd "$(dirname "$0")/.."
P="psql -h 127.0.0.1 -p ${PGPORT:-55433} -U postgres -v ON_ERROR_STOP=1 -q"
DB=${DB:-launchui}
$P -d postgres -c "select pg_terminate_backend(pid) from pg_stat_activity where datname = '$DB' and pid <> pg_backend_pid()" -o /dev/null
$P -d postgres -c "drop database if exists $DB" -c "create database $DB" 2>/dev/null
$P -d $DB -f local-test/supabase_stubs.sql 2>/dev/null
$P -d $DB -c "insert into auth.users values ('f85fb17b-2943-4266-b1b2-dc130ae8b678','scottro1522@gmail.com'),('aaaaaaaa-0000-0000-0000-00000000000a','alice@example.com'),('bbbbbbbb-0000-0000-0000-00000000000b','bob@example.com')"
$P -d $DB -o /dev/null -f schema.sql 2>/dev/null
$P -d $DB -c "insert into public.events (calendar,title,start_at) values ('msc','Scott private event','2026-10-26 09:00')"
echo "reset $DB"
