# ai-assistant (SANDY AI, Phase 1)

Deploy (needs a Supabase access token or dashboard login):

1. Run `supabase/migration-2026-10-22-ai-usage.sql` in the SQL Editor (adds `ai_usage` + `ai_bump_usage()`).
2. `supabase functions deploy ai-assistant --project-ref dnsihqpdjflswbpahzvl` (or Dashboard → Edge Functions →
   Deploy a new function → Via editor, name `ai-assistant`, paste `index.ts`). Keep "Verify JWT" ON.
3. Secret: `supabase secrets set ANTHROPIC_API_KEY=... --project-ref dnsihqpdjflswbpahzvl`
   (or Dashboard → Edge Functions → Secrets). Never put the key in the repo or the browser.

Model: `claude-haiku-5-5`. Limit: 50 requests per user per day (America/Chicago).
