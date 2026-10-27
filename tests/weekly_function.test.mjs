// Node test for weekly review nudge in send-reminders (SI #6).
//   node tests/weekly_function.test.mjs
import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import nodeCrypto from 'node:crypto';

const dir = mkdtempSync(join(tmpdir(), 'wkfn-'));
const fp = join(dir, 'fn.mjs');
writeFileSync(fp, readFileSync(new URL('../supabase/functions/send-reminders/index.ts', import.meta.url), 'utf8'));
const M = await import(fp);
const assert = (c, m) => { if (!c) throw new Error('FAIL: ' + m); console.log('ok -', m); };
const T = (iso) => Date.parse(iso);
const U = 'u1';

assert(M.WEEKLY_REVIEW_PUSH_HOUR === 18 && M.WEEKLY_REVIEW_WINDOW_MIN === 15, 'constants');

const profiles = [{ user_id: U, time_zone: 'America/Chicago' }];
// Sunday Nov 1 2026 is after DST ends → CST (UTC-6). 6:00 PM CST = 2026-11-02T00:00:00Z
const at6 = '2026-11-02T00:00:00Z';
let due = M.dueWeeklyReviewNudges(profiles, new Set(), T(at6));
assert(due.length === 1 && due[0].target === '2026-11-01', 'due Sunday 6 PM: ' + JSON.stringify(due[0] && { t: due[0].target }));
assert(due[0].payload.title.includes('week ahead') && due[0].payload.url.includes('si=weekly'), 'payload: ' + due[0].payload.url);
assert(M.dueWeeklyReviewNudges(profiles, new Set([`${U}|2026-11-01`]), T(at6)).length === 0, 'deduped');
assert(M.dueWeeklyReviewNudges(profiles, new Set(), T('2026-11-01T23:59:00Z')).length === 0, 'not before 6');
assert(M.dueWeeklyReviewNudges(profiles, new Set(), T('2026-11-02T00:16:00Z')).length === 0, 'not after window');
// Monday Nov 2 6 PM CST — no
assert(M.dueWeeklyReviewNudges(profiles, new Set(), T('2026-11-03T00:00:00Z')).length === 0, 'not Monday');

// handler e2e
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
    if (u.search.includes('leave_alerts')) return new Response(JSON.stringify([]));
    if (u.search.includes('si_long_day')) return new Response(JSON.stringify([]));
    if (u.search.includes('si_weekly_review=is.true')) return new Response(JSON.stringify(profiles));
    return new Response(JSON.stringify(profiles));
  }
  if (u.pathname.endsWith('/push_subscriptions')) return new Response(JSON.stringify([sub]));
  if (u.pathname.endsWith('/leave_plans')) return new Response(JSON.stringify([]));
  if (u.pathname.endsWith('/si_nudge_sends')) {
    if (m === 'GET') return new Response(JSON.stringify(nudges.filter(n => {
      // filter by kind if requested
      if (u.search.includes('weekly_review')) return n.kind === 'weekly_review';
      if (u.search.includes('long_day')) return n.kind === 'long_day';
      return true;
    })));
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
let res = await M.handle(req('good'), env, fake, T(at6));
let body = await res.json();
assert(res.status === 200 && body.weekly_review_due === 1 && pushes.length === 1, 'handler sends weekly once: ' + JSON.stringify(body));
res = await M.handle(req('good'), env, fake, T(at6));
body = await res.json();
assert(body.weekly_review_due === 0 || pushes.length === 1, 'second run deduped: pushes=' + pushes.length);

const fakeNoCol = async (url, init = {}) => {
  const u = new URL(url);
  if (u.pathname.endsWith('/profiles') && u.search.includes('si_weekly_review')) return new Response(JSON.stringify({ message: 'column' }), { status: 400 });
  return fake(url, init);
};
res = await M.handle(req('good'), env, fakeNoCol, T(at6));
body = await res.json();
assert(res.status === 200 && (body.weekly_review_due === 0 || body.weekly_review_due == null), 'missing column skipped');

console.log('All weekly_function tests passed.');
