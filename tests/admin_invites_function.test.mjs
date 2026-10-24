// Node test for the admin-invites Edge Function (no network): auth, admin-only, validation, key handling.
//   node tests/admin_invites_function.test.mjs
import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs'; import { tmpdir } from 'node:os'; import { join } from 'node:path';
const dir = mkdtempSync(join(tmpdir(), 'invfn-')); const f = join(dir, 'fn.mjs');
writeFileSync(f, readFileSync(new URL('../supabase/functions/admin-invites/index.ts', import.meta.url), 'utf8'));
const { handle } = await import(f);
const assert = (c, m) => { if (!c) throw new Error('FAIL: ' + m); console.log('ok -', m); };
const env = { SUPABASE_URL: 'https://x.supabase.co', SUPABASE_ANON_KEY: 'anon', SUPABASE_SERVICE_ROLE_KEY: 'svc' };
const req = (body, auth = 'Bearer user') => new Request('https://x/functions/v1/admin-invites', { method: 'POST', headers: { authorization: auth, 'content-type': 'application/json' }, body: JSON.stringify(body) });
let svcUsed = false;
const mk = admin => async (url, init = {}) => { const u = new URL(url); const h = init.headers || {};
  if (h.authorization === 'Bearer svc') svcUsed = true;
  if (u.pathname === '/auth/v1/user') return new Response(h.authorization === 'Bearer user' ? '{"id":"u1","email":"a@b.co"}' : '{}', { status: h.authorization === 'Bearer user' ? 200 : 401 });
  if (u.pathname === '/rest/v1/rpc/sandy_is_admin') { assert(h.authorization === 'Bearer user', 'admin check runs with the CALLER\'s token'); return new Response(JSON.stringify(admin)); }
  return new Response('[]'); };
assert((await handle(req({ action: 'list' }, ''), env, mk(true))).status === 401, 'no token -> 401');
assert((await handle(req({ action: 'list' }, 'Bearer bad'), env, mk(true))).status === 401, 'bad token -> 401');
svcUsed = false; assert((await handle(req({ action: 'invite', email: 'x@y.co' }), env, mk(false))).status === 403, 'non-admin -> 403');
assert(!svcUsed, 'service key never used for a non-admin');
assert((await handle(req({ action: 'invite', email: 'nope' }), env, mk(true))).status === 400, 'bad email -> 400');
assert((await handle(req({ action: 'revoke', email: 'A@B.co' }), env, mk(true))).status === 400, 'admin cannot revoke self');
assert((await handle(new Request('https://x', { method: 'GET' }), env, mk(true))).status === 405, 'GET -> 405');
const r = await handle(req({ action: 'list' }), { ...env, SUPABASE_SERVICE_ROLE_KEY: '' }, mk(true)); assert(r.status === 500 && !(await r.text()).includes('svc'), 'missing config -> 500, no secrets echoed');
console.log('ADMIN INVITES FUNCTION TESTS PASSED');
