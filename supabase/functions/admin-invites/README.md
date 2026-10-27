# admin-invites (Edge Function)

Invite-only access for the free prototype. Used by the app's **✉️ Invites** screen (shown only to the admin = owner account).

- Deploy: `npx -y supabase@latest functions deploy admin-invites --project-ref dnsihqpdjflswbpahzvl --use-api` (JWT verification on).
- Needs the launch migration (`supabase/migration-2026-10-24-launch.sql`: `invites` table, `sandy_is_admin()`).
- Uses `SUPABASE_SERVICE_ROLE_KEY`, which Supabase injects into Edge Functions automatically. It is never sent to the browser.
- The caller's own JWT is checked first (`/auth/v1/user` + `rpc sandy_is_admin`); non-admins get 403 before the service key is touched.
- `invite` creates the auth user with `email_confirm: true` and sends **no email** by default, so the person can request a magic link at the site.
  `sendEmail: true` uses Supabase's invite email instead (needs custom SMTP for non-team addresses).
- `firstName` (or `note`) on `invite` is stored on `invites.note` (max 80 chars) for the personalized invite text in the app.
- `set_name` updates only that field (redeploy this function to enable it in production; new invites already store the name via `note`).
- `revoke` bans sign-in (reversible with `restore`). It never deletes data.
- Tests: `node tests/admin_invites_function.test.mjs`, plus `tests/launch.test.js` (end to end on the local stand-in).
