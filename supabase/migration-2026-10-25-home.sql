-- SANDY migration 2026-10-25: per-user Home address for Sandy Intelligence leave-by times (leaveby.js).
-- Run once in Supabase Dashboard -> SQL Editor. Idempotent, additive only (three nullable columns on profiles).
-- Until it runs, the app keeps each user's home on their device (localStorage, keyed by user id).
-- profiles already has per-user RLS (each user reads/writes only their own row), so nobody else can see it.
begin;
alter table public.profiles add column if not exists home_address text check (home_address is null or length(home_address) <= 300);
alter table public.profiles add column if not exists home_lat double precision check (home_lat is null or home_lat between -90 and 90);
alter table public.profiles add column if not exists home_lon double precision check (home_lon is null or home_lon between -180 and 180);
notify pgrst, 'reload schema';
commit;
