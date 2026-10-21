-- LOCAL TESTING ONLY. Mimics the bits of a Supabase database that schema.sql relies on
-- (roles, auth.uid(), auth.jwt(), the supabase_realtime publication). Never run on Supabase.
do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role nologin bypassrls; end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticator') then
    create role authenticator login password 'localtest' noinherit;
  end if;
end $$;
grant anon, authenticated, service_role to authenticator;
create schema if not exists auth;
grant usage on schema auth to anon, authenticated, service_role;
grant usage on schema public to anon, authenticated, service_role;
create or replace function auth.jwt() returns jsonb language sql stable as $$
  select coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb $$;
create or replace function auth.uid() returns uuid language sql stable as $$
  select nullif(auth.jwt() ->> 'sub', '')::uuid $$;
do $$ begin
  if not exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    create publication supabase_realtime;
  end if;
end $$;
-- (step 2) auth.role() and a minimal auth.users, as on Supabase
create or replace function auth.role() returns text language sql stable as $$
  select nullif(auth.jwt() ->> 'role', '') $$;
create table if not exists auth.users (id uuid primary key, email text);
