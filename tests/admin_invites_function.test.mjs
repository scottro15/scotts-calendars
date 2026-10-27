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

// Personalized first name (Scott 2026-10-26): stored on invites.note; set_name patches only that field.
{
  let patched = null, created = null;
  const mk2 = async (url, init = {}) => {
    const u = new URL(url); const h = init.headers || {};
    if (u.pathname === '/auth/v1/user') return new Response('{"id":"u1","email":"a@b.co"}');
    if (u.pathname === '/rest/v1/rpc/sandy_is_admin') return new Response('true');
    if (u.pathname === '/auth/v1/admin/users' && init.method === 'POST') {
      created = JSON.parse(init.body); return new Response(JSON.stringify({ id: 'nu1', email: created.email }), { status: 200 });
    }
    if (u.pathname.startsWith('/auth/v1/admin/users')) return new Response(JSON.stringify({ users: [] }));
    if (u.pathname.startsWith('/rest/v1/invites') && (init.method === 'HEAD' || !init.method)) {
      return new Response('[]', { headers: { 'content-range': '0-0/0' } });
    }
    if (u.pathname.startsWith('/rest/v1/invites') && init.method === 'POST') {
      created = JSON.parse(init.body); return new Response(JSON.stringify([created]));
    }
    if (u.pathname.startsWith('/rest/v1/invites') && init.method === 'PATCH') {
      patched = JSON.parse(init.body); return new Response(JSON.stringify([{ email: 'pat@x.co', note: patched.note }]));
    }
    return new Response('[]');
  };
  const r1 = await handle(req({ action: 'invite', email: 'Pat@X.co', firstName: '  Pat  ' }), env, mk2);
  assert(r1.status === 200, 'invite with firstName -> 200');
  const j1 = await r1.json();
  assert(j1.firstName === 'Pat' && created.note === 'Pat' && created.email === 'pat@x.co', 'firstName trimmed and stored on invites.note');
  const r2 = await handle(req({ action: 'set_name', email: 'pat@x.co', firstName: 'Patricia' }), env, mk2);
  assert(r2.status === 200 && patched.note === 'Patricia', 'set_name patches note only');
  const r3 = await handle(req({ action: 'set_name', email: 'pat@x.co', firstName: '' }), env, mk2);
  assert(r3.status === 200 && patched.note === null, 'set_name empty clears note');
  console.log('ok - personalized invite name actions');
}
console.log('ADMIN INVITES FUNCTION TESTS PASSED');
