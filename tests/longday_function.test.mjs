// Node test for long-day nudge in send-reminders Edge Function (SI #2).
//   node tests/longday_function.test.mjs
import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import nodeCrypto from 'node:crypto';

const dir = mkdtempSync(join(tmpdir(), 'ldfn-'));
const fp = join(dir, 'fn.mjs');
writeFileSync(fp, readFileSync(new URL('../supabase/functions/send-reminders/index.ts', import.meta.url), 'utf8'));
const M = await import(fp);
const assert = (c, m) => { if (!c) throw new Error('FAIL: ' + m); console.log('ok -', m); };
const T = (iso) => Date.parse(iso);
const U = 'u1';
const W = (y, m, d, h = 0, mi = 0) => new Date(Date.UTC(y, m, d, h, mi));

assert(M.LONG_DAY_SPAN_HOURS === 10 && M.LONG_DAY_PUSH_HOUR === 20, 'constants exported');

const info = M.analyzeLongDay([
  { start: W(2026, 9, 27, 6), end: W(2026, 9, 27, 7), title: 'Study' },
  { start: W(2026, 9, 27, 7), end: W(2026, 9, 27, 7, 30), title: 'Routine' },
  { start: W(2026, 9, 27, 9), end: W(2026, 9, 27, 10, 30), title: 'Lift' },
  { start: W(2026, 9, 27, 9, 30), end: W(2026, 9, 27, 10), title: 'Christian DAKE Workout' },
  { start: W(2026, 9, 27, 11), end: W(2026, 9, 27, 19), title: 'Life Time shift' },
  { start: W(2026, 9, 27, 20), end: W(2026, 9, 27, 21), title: 'Study 2' },
]);
assert(info.isLong && info.count === 5 && info.spanMin === 900, 'analyze mirrors client: ' + JSON.stringify({ c: info.count, span: info.spanMin, sched: info.scheduledMin }));
assert(/Pack lunch and snacks tonight/.test(M.longDayMessage(info)), 'message: ' + M.longDayMessage(info));

// timedOnDay from DB-shaped rows
const rows = [
  { id: 'e1', owner_id: U, title: 'Study', all_day: false, is_task: false, start_at: '2026-10-27T06:00:00', end_at: '2026-10-27T07:00:00', recur_freq: 'none', exdates: [] },
  { id: 'e2', owner_id: U, title: 'Life Time shift', all_day: false, is_task: false, start_at: '2026-10-27T11:00:00', end_at: '2026-10-27T19:00:00', recur_freq: 'none', exdates: [] },
  { id: 'e3', owner_id: U, title: 'Christian DAKE Workout', all_day: false, is_task: false, start_at: '2026-10-27T09:30:00', end_at: '2026-10-27T10:00:00', recur_freq: 'none', exdates: [] },
  { id: 'e4', owner_id: U, title: 'Evening', all_day: false, is_task: false, start_at: '2026-10-27T20:00:00', end_at: '2026-10-27T21:00:00', recur_freq: 'none', exdates: [] },
  { id: 'e5', owner_id: U, title: 'Picture day', all_day: true, is_task: false, start_at: '2026-10-27', end_at: '2026-10-27', recur_freq: 'none', exdates: [] },
];
const timed = M.timedOnDay(rows, U, '2026-10-27');
assert(timed.length === 3 && !timed.some(t => /christian/i.test(t.title)), 'timedOnDay drops ref + all-day: ' + timed.length);
assert(M.analyzeLongDay(timed).isLong, 'sparse long day still long by span');

const profiles = [{ user_id: U, time_zone: 'America/Chicago' }];
// 8:00 PM CDT on Oct 26 2026 = 01:00Z Oct 27 (CDT is UTC-5 in late Oct)
const at8 = '2026-10-27T01:00:00Z';
let due = M.dueLongDayNudges(profiles, rows, new Set(), T(at8));
assert(due.length === 1 && due[0].target === '2026-10-27', 'due at 8 PM: ' + JSON.stringify(due[0] && { t: due[0].target, title: due[0].payload.title }));
assert(due[0].payload.title === '🥪 Long day tomorrow' && /Pack lunch/.test(due[0].payload.body), 'payload: ' + due[0].payload.body);
assert(due[0].payload.url === './?tab=today' && due[0].payload.tag === 'longday:2026-10-27', 'opens Today, tagged once/day');

assert(M.dueLongDayNudges(profiles, rows, new Set([`${U}|2026-10-27`]), T(at8)).length === 0, 'dedupe via sent set');
assert(M.dueLongDayNudges(profiles, rows, new Set(), T('2026-10-27T00:59:00Z')).length === 0, 'not before 8 PM');
assert(M.dueLongDayNudges(profiles, rows, new Set(), T('2026-10-27T01:16:00Z')).length === 0, 'not more than 15 min late');
assert(M.dueLongDayNudges(profiles, rows, new Set(), T('2026-10-27T01:10:00Z')).length === 1, 'within 15 min window: still sent');

// short day: no nudge
const short = [{ id: 's1', owner_id: U, title: 'Meeting', all_day: false, is_task: false, start_at: '2026-10-27T10:00:00', end_at: '2026-10-27T11:00:00', recur_freq: 'none', exdates: [] }];
assert(M.dueLongDayNudges(profiles, short, new Set(), T(at8)).length === 0, 'short day: no nudge');

// --- handler e2e with mocks ---
const ua = nodeCrypto.createECDH('prime256v1'); ua.generateKeys();
const sub = { id: 's1', owner_id: U, endpoint: 'https://push.example.net/send/abc', p256dh: ua.getPublicKey().toString('base64url'), auth: nodeCrypto.randomBytes(16).toString('base64url') };
const kp = nodeCrypto.generateKeyPairSync('ec', { namedCurve: 'P-256' }); const jwk = kp.privateKey.export({ format: 'jwk' });
const env = { SUPABASE_URL: 'https://x.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 'svc', VAPID_PRIVATE_KEY: jwk.d,
  VAPID_PUBLIC_KEY: Buffer.concat([Buffer.from([4]), Buffer.from(jwk.x, 'base64url'), Buffer.from(jwk.y, 'base64url')]).toString('base64url') };
const nudges = []; const pushes = [];
const fake = async (url, init = {}) => {
  const u = new URL(url); const m = init.method || 'GET';
  if (u.pathname.endsWith('/rpc/sandy_check_cron_secret')) return new Response(JSON.stringify(JSON.parse(init.body).s === 'good'));
  if (u.pathname.endsWith('/events')) {
    if (u.search.includes('reminders=')) return new Response(JSON.stringify([]));
    return new Response(JSON.stringify(rows));
  }
  if (u.pathname.endsWith('/profiles')) {
    if (u.search.includes('leave_alerts=is.true')) return new Response(JSON.stringify([]));
    if (u.search.includes('si_long_day=is.true')) return new Response(JSON.stringify(profiles));
    return new Response(JSON.stringify(profiles));
  }
  if (u.pathname.endsWith('/push_subscriptions')) return new Response(JSON.stringify([sub]));
  if (u.pathname.endsWith('/leave_plans')) return new Response(JSON.stringify([]));
  if (u.pathname.endsWith('/si_nudge_sends')) {
    if (m === 'GET') return new Response(JSON.stringify(nudges));
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
let res = await M.handle(req('good'), env, fake, T(at8));
let body = await res.json();
assert(res.status === 200 && body.long_day_due === 1 && pushes.length === 1, 'handler sends long-day once: ' + JSON.stringify(body));
res = await M.handle(req('good'), env, fake, T(at8));
body = await res.json();
assert(body.long_day_due === 0 || pushes.length === 1, 'second run deduped: pushes=' + pushes.length + ' ' + JSON.stringify(body));

// missing migration: si_long_day filter fails -> no long day work
const fakeNoCol = async (url, init = {}) => {
  const u = new URL(url);
  if (u.pathname.endsWith('/profiles') && u.search.includes('si_long_day')) return new Response(JSON.stringify({ message: 'column' }), { status: 400 });
  return fake(url, init);
};
res = await M.handle(req('good'), env, fakeNoCol, T(at8));
body = await res.json();
assert(res.status === 200 && (body.long_day_due === 0 || body.long_day_due == null), 'missing column: skipped gracefully');

console.log('All longday_function tests passed.');
