-- SANDY migration 2026-10-25c: Sandy Intelligence chat history (feature E).
-- Run once in Supabase Dashboard -> SQL Editor. Idempotent, additive only. No Edge Function change needed.
--   * ai_chats: one row per conversation with the assistant, owner-only via RLS (nobody else, not even other
--     invited users, can read it). messages is the same [{role, content}] list the app already sends to the
--     ai-assistant function, plus small "(I confirmed: ...)" notes. Nothing here triggers an AI call.
--   * Until this runs, the app keeps chat history on the device instead (localStorage) and says so.
begin;
create table if not exists public.ai_chats (
  id          uuid primary key default gen_random_uuid(),
  owner_id    uuid not null default auth.uid() references auth.users(id) on delete cascade,
  title       text not null default 'New chat' check (length(title) between 1 and 120),
  messages    jsonb not null default '[]'::jsonb
              check (jsonb_typeof(messages) = 'array' and jsonb_array_length(messages) <= 400 and pg_column_size(messages) <= 262144),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index if not exists ai_chats_owner_recent_idx on public.ai_chats (owner_id, updated_at desc);
alter table public.ai_chats enable row level security;
revoke all on public.ai_chats from anon, authenticated;
grant select, insert, update, delete on public.ai_chats to authenticated;
grant all on public.ai_chats to service_role;
drop policy if exists ai_chats_own on public.ai_chats;
create policy ai_chats_own on public.ai_chats for all to authenticated
  using (owner_id = (select auth.uid()))
  with check (owner_id = (select auth.uid()));
notify pgrst, 'reload schema';
commit;
