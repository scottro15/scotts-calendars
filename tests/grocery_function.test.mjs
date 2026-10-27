// Node test for grocery nudge in send-reminders (SI #7).
//   node tests/grocery_function.test.mjs
import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import nodeCrypto from 'node:crypto';

const dir = mkdtempSync(join(tmpdir(), 'grfn-'));
const fp = join(dir, 'fn.mjs');
writeFileSync(fp, readFileSync(new URL('../supabase/functions/send-reminders/index.ts', import.meta.url), 'utf8'));
const M = await import(fp);
const assert = (c, m) => { if (!c) throw new Error('FAIL: ' + m); console.log('ok -', m); };
const T = (iso) => Date.parse(iso);
const U = 'u1';

assert(M.GROCERY_PUSH_DOW === 6 && M.GROCERY_PUSH_HOUR === 10, 'constants');
assert(M.isGroceryText({ title: 'Schnucks' }) && !M.isGroceryText({ title: 'Practice' }), 'match');

const profiles = [{ user_id: U, time_zone: 'America/Chicago' }];
// Sat Oct 31 2026 10:00 AM CDT = 15:00Z (CDT UTC-5; DST still on until Nov 1)
const at10 = '2026-10-31T15:00:00Z';
const weekSun = '2026-10-25';
let due = M.dueGroceryNudges(profiles, [], new Set(), T(at10));
assert(due.length === 1 && due[0].target === weekSun, 'due Sat 10 AM: ' + JSON.stringify(due[0] && { t: due[0].target }));
assert(due[0].payload.url.includes('si=grocery'), 'payload url');
assert(M.dueGroceryNudges(profiles, [], new Set([`${U}|${weekSun}`]), T(at10)).length === 0, 'deduped');
assert(M.dueGroceryNudges(profiles, [], new Set(), T('2026-10-31T14:59:00Z')).length === 0, 'not before 10');
assert(M.dueGroceryNudges(profiles, [], new Set(), T('2026-11-01T15:00:00Z')).length === 0, 'not Sunday');
const withGrocery = [{ owner_id: U, title: 'Costco', start_at: '2026-11-02T10:00:00', is_task: false, done: false, notes: '', category: '' }];
assert(M.dueGroceryNudges(profiles, withGrocery, new Set(), T(at10)).length === 0, 'suppressed when Costco in window');

// handler: missing si_grocery column skipped
const ua = nodeCrypto.createECDH('prime256v1'); ua.generateKeys();
const sub = { id: 's1', owner_id: U, endpoint: 'https://push.example.net/send/abc', p256dh: ua.getPublicKey().toString('base64url'), auth: nodeCrypto.randomBytes(16).toString('base64url') };
const kp = nodeCrypto.generateKeyPairSync('ec', { namedCurve: 'P-256' }); const jwk = kp.privateKey.export({ format: 'jwk' });
const env = { SUPABASE_URL: 'https://x.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 'svc', VAPID_PRIVATE_KEY: jwk.d,
  VAPID_PUBLIC_KEY: Buffer.concat([Buffer.from([4]), Buffer.from(jwk.x, 'base64url'), Buffer.from(jwk.y, 'base64url')]).toString('base64url') };
const nudges = []; const pushes = [];
const fake = async (url, init = {}) => {
  const u = new URL(url); const m = init.method || 'GET';
  if (u.pathname.endsWith('/rpc/sandy_check_cron_secret')) return new Response(JSON.stringify(JSON.parse(init.body).s === 'good'));
  if (u.pathname.endsWith('/events')) return new Response(JSON.stringify([]));
  if (u.pathname.endsWith('/profiles')) {
    if (u.search.includes('si_grocery=is.true')) return new Response(JSON.stringify(profiles));
    if (u.search.includes('si_weekly_review')) return new Response(JSON.stringify([]));
    if (u.search.includes('si_long_day')) return new Response(JSON.stringify([]));
    if (u.search.includes('leave_alerts')) return new Response(JSON.stringify([]));
    return new Response(JSON.stringify(profiles));
  }
  if (u.pathname.endsWith('/push_subscriptions')) return new Response(JSON.stringify([sub]));
  if (u.pathname.endsWith('/leave_plans')) return new Response(JSON.stringify([]));
  if (u.pathname.endsWith('/si_nudge_sends')) {
    if (m === 'GET') return new Response(JSON.stringify(nudges.filter(n => u.search.includes(n.kind) || true)));
    if (m === 'POST') {
      const b = JSON.parse(init.body);
      if (nudges.some(n => n.owner_id === b.owner_id && n.target_date === b.target_date && n.kind === b.kind))
        return new Response(JSON.stringify([]), { status: 201 });
      nudges.push(b);
      return new Response(JSON.stringify([b]), { status: 201 });
    }
  }
  if (u.hostname === 'push.example.net') { pushes.push(init); return new Response(null, { status: 201 }); }
  return new Response(JSON.stringify([]));
};
const req = (secret) => new Request('https://x/functions/v1/send-reminders', { method: 'POST', headers: { 'x-cron-secret': secret } });
let res = await M.handle(req('good'), env, fake, T(at10));
let body = await res.json();
assert(res.status === 200 && body.grocery_due === 1 && pushes.length === 1, 'handler grocery once: ' + JSON.stringify(body));

const fakeNoCol = async (url, init = {}) => {
  const u = new URL(url);
  if (u.pathname.endsWith('/profiles') && u.search.includes('si_grocery')) return new Response(JSON.stringify({ message: 'column' }), { status: 400 });
  return fake(url, init);
};
res = await M.handle(req('good'), env, fakeNoCol, T(at10));
body = await res.json();
assert(res.status === 200 && (body.grocery_due === 0 || body.grocery_due == null), 'missing column skipped: ' + JSON.stringify(body));

console.log('All grocery_function tests passed.');
