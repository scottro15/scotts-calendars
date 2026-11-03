// Node test for the send-reminders Edge Function: Web Push crypto (checked against the reference http_ece
// decoder when available), VAPID JWT signature, due-reminder math (time zones, DST, repeats, all-day, to-dos),
// cron-secret check, dedupe and dead-subscription cleanup. No network.
//   node tests/send_reminders_function.test.mjs   (optional: ECE=/path/to/node_modules/http_ece)
import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs'; import { tmpdir } from 'node:os'; import { join } from 'node:path';
import { createRequire } from 'node:module'; import nodeCrypto from 'node:crypto';
const dir = mkdtempSync(join(tmpdir(), 'remfn-')); const f = join(dir, 'fn.mjs');
writeFileSync(f, readFileSync(new URL('../supabase/functions/send-reminders/index.ts', import.meta.url), 'utf8'));
const M = await import(f);
const assert = (c, m) => { if (!c) throw new Error('FAIL: ' + m); console.log('ok -', m); };
const T = (iso) => Date.parse(iso);

// --- push encryption round trip
const ua = nodeCrypto.createECDH('prime256v1'); ua.generateKeys();
const authSecret = nodeCrypto.randomBytes(16);
const sub = { endpoint: 'https://push.example.net/send/abc', p256dh: ua.getPublicKey().toString('base64url'), auth: authSecret.toString('base64url') };
const body = await M.encryptPayload('{"title":"Hi"}', sub.p256dh, sub.auth);
assert(body.length === 16 + 4 + 1 + 65 + 14 + 1 + 16, 'aes128gcm body layout (salt, rs, keyid, ciphertext+tag)');
let ece = null; try { ece = createRequire(import.meta.url)(process.env.ECE || '/tmp/wp/node_modules/http_ece'); } catch (_) {}
if (ece) {
  const out = ece.decrypt(Buffer.from(body), { version: 'aes128gcm', privateKey: ua, authSecret });
  assert(out.toString() === '{"title":"Hi"}', 'reference decoder (http_ece) decrypts our payload');
} else console.log('skip - http_ece not installed: reference decrypt');


// --- "at a set time" reminders (2B): clock time N days before, in the owner's zone, DST-safe, sent once per code
{
  const tz = () => 'America/Chicago'; const c1 = M.fixedCode(1, 20 * 60), c2 = M.fixedCode(2, 9 * 60), c0 = M.fixedCode(0, 8 * 60);
  const x = M.fixedOf(c1); assert(x && x.days === 1 && x.minute === 1200 && M.fixedOf(1440) === null && M.fixedOf(59940) === null && M.fixedOf(30) === null, 'fixed codec decodes, "before" values are not fixed');
  let bad = 0; for (let d = 0; d <= 30; d++) for (let m = 0; m < 1440; m += 7) { const y = M.fixedOf(M.fixedCode(d, m)); if (!y || y.days !== d || y.minute !== m) bad++; }
  assert(bad === 0 && M.fixedCode(30, 1439) <= M.MAX_MINUTES, 'fixed codec round-trips within the DB range');
  const ev = { id: 'fx1', owner_id: 'o', title: 'Dentist', start_at: '2026-11-10 15:00:00', all_day: false, recur_freq: 'none', reminders: [30, c1, c2] };
  const d1 = M.dueReminders([ev], tz, T('2026-11-10T02:01:00Z'));
  assert(d1.length === 1 && d1[0].minutes === c1 && d1[0].fireAt === T('2026-11-10T02:00:00Z') && d1[0].payload.body.startsWith('Tomorrow · Tue, Nov 10 · 3:00 PM') && d1[0].payload.tag === `fx1:2026-11-10:${c1}`, '8 PM the night before fires Mon 8:00 PM CST: ' + JSON.stringify(d1.map(d => d.payload.body)));
  const d2 = M.dueReminders([ev], tz, T('2026-11-08T15:05:00Z'));
  assert(d2.length === 1 && d2[0].minutes === c2 && d2[0].payload.body.startsWith('In 2 days'), '9 AM 2 days before fires Sun 9:00 AM CST');
  assert(M.dueReminders([ev], tz, T('2026-11-10T01:58:00Z')).length === 0 && M.dueReminders([ev], tz, T('2026-11-10T02:16:00Z')).length === 0, 'not before its time, not after the 15-min window');
  const dst = M.dueReminders([{ ...ev, id: 'fx2', start_at: '2027-03-15 10:00:00', reminders: [c1] }], tz, T('2027-03-15T01:02:00Z'));
  assert(dst.length === 1 && dst[0].fireAt === T('2027-03-15T01:00:00Z'), 'after the spring DST change: 8 PM CDT');
  const todo = { id: 'fx3', owner_id: 'o', title: 'Trash', start_at: '2026-10-26 00:00:00', all_day: true, is_task: true, recur_freq: 'weekly', recur_by_weekday: [1], reminders: [c0], completed_dates: ['2026-11-16'] };
  const d3 = M.dueReminders([todo], tz, T('2026-11-09T14:03:00Z'));
  assert(d3.length === 1 && d3[0].occ === '2026-11-09' && d3[0].payload.body.startsWith('Today · due Mon, Nov 9'), 'repeating all-day to-do: 8 AM the same day (not the 9 AM anchor)');
  assert(M.dueReminders([todo], tz, T('2026-11-16T14:03:00Z')).length === 0, 'a done to-do date is skipped');
  const tok = M.dueReminders([{ ...ev, id: 'fx4', reminders: [c1] }], () => 'Asia/Tokyo', T('2026-11-09T11:00:00Z'));
  assert(tok.length === 1, 'uses the owner time zone (8 PM Tokyo)');
}

// --- VAPID JWT verifies with the public key
const kp = nodeCrypto.generateKeyPairSync('ec', { namedCurve: 'P-256' }); const jwk = kp.privateKey.export({ format: 'jwk' });
const vapid = { publicKey: Buffer.concat([Buffer.from([4]), Buffer.from(jwk.x, 'base64url'), Buffer.from(jwk.y, 'base64url')]).toString('base64url'), privateKey: jwk.d, subject: 'mailto:a@b.co' };
const hdr = await M.vapidAuth(sub.endpoint, vapid);
const [, tok, k] = hdr.match(/^vapid t=([^,]+), k=(.+)$/); const [h, p, s] = tok.split('.');
assert(nodeCrypto.verify('sha256', Buffer.from(`${h}.${p}`), { key: kp.publicKey, dsaEncoding: 'ieee-p1363' }, Buffer.from(s, 'base64url')), 'VAPID JWT signature valid (ES256)');
const claims = JSON.parse(Buffer.from(p, 'base64url')); assert(claims.aud === 'https://push.example.net' && claims.sub === 'mailto:a@b.co' && k === vapid.publicKey, 'VAPID claims + key');

// --- due math
const ev = (o) => ({ id: 'e1', owner_id: 'u1', title: 'Practice', all_day: false, recur_freq: 'none', reminders: [10], ...o });
const tzC = () => 'America/Chicago';
// 3:30 PM CDT Oct 24 = 20:30Z; 10 min before = 20:20Z
assert(M.dueReminders([ev({ start_at: '2026-10-24T15:30:00' })], tzC, T('2026-10-24T20:20:00Z')).length === 1, 'one-off: due exactly 10 min before (Chicago)');
assert(M.dueReminders([ev({ start_at: '2026-10-24T15:30:00' })], tzC, T('2026-10-24T20:19:00Z')).length === 0, 'not due 1 min early');
assert(M.dueReminders([ev({ start_at: '2026-10-24T15:30:00' })], tzC, T('2026-10-24T20:34:00Z')).length === 1, 'still sent if cron runs late (within 15 min)');
assert(M.dueReminders([ev({ start_at: '2026-10-24T15:30:00' })], tzC, T('2026-10-24T20:36:00Z')).length === 0, 'dropped when > 15 min late');
assert(M.dueReminders([ev({ start_at: '2026-10-24T15:30:00' })], () => 'America/Denver', T('2026-10-24T21:20:00Z')).length === 1, 'uses the owner\'s zone (Denver)');
// weekly repeat Tue/Thu 6:00 AM; the Nov 3 occurrence (after DST ends: CST = UTC-6) 30 min before = 11:30Z
const wk = ev({ start_at: '2026-09-01T06:00:00', recur_freq: 'weekly', recur_by_weekday: [2, 4], reminders: [30] });
const d1 = M.dueReminders([wk], tzC, T('2026-11-03T11:30:00Z'));
assert(d1.length === 1 && d1[0].occ === '2026-11-03', 'repeating: reminds per occurrence, DST-correct');
assert(M.dueReminders([{ ...wk, exdates: ['2026-11-03'] }], tzC, T('2026-11-03T11:30:00Z')).length === 0, 'skipped occurrence: no reminder');
// 6 months ahead (186 days = 267840 min)
const far = M.dueReminders([ev({ start_at: '2027-04-28T12:00:00', reminders: [267840] })], tzC, T('2026-10-24T17:00:00Z'));
assert(far.length === 1, 'up to 6 months ahead (267840 min)');
// all-day to-do: 1 day before 9:00 AM -> Oct 25 09:00 CDT = 14:00Z
const td = ev({ start_at: '2026-10-26T00:00:00', all_day: true, is_task: true, done: false, reminders: [1440] });
const d2 = M.dueReminders([td], tzC, T('2026-10-25T14:00:00Z'));
assert(d2.length === 1 && d2[0].payload.title.startsWith('☑️') && /In 1 day · due Mon, Oct 26/.test(d2[0].payload.body), 'all-day to-do: day before at 9 AM, friendly text: ' + (d2[0] && d2[0].payload.body));
assert(M.dueReminders([{ ...td, done: true }], tzC, T('2026-10-25T14:00:00Z')).length === 0, 'done to-do: no reminder');
assert(M.dueReminders([ev({ start_at: '2026-10-24T15:30:00', reminders: [10, 10, 60] })], tzC, T('2026-10-24T20:20:00Z')).length === 1, 'duplicate minutes collapse');
assert(M.leadText(90) === 'In 90 minutes' && M.leadText(60) === 'In 1 hour' && M.leadText(10080) === 'In 1 week' && M.leadText(0) === 'Now', 'lead text');

// --- handler: secret, dedupe, gone cleanup
const calls = []; const claimed = new Set();
const fake = async (url, init = {}) => { const u = new URL(url); calls.push(`${init.method || 'GET'} ${u.pathname}${u.search}`);
  if (u.pathname.endsWith('/rpc/sandy_check_cron_secret')) return new Response(JSON.stringify(JSON.parse(init.body).s === 'good'));
  if (u.pathname.endsWith('/events')) return new Response(JSON.stringify([ev({ start_at: '2026-10-24T15:30:00' })]));
  if (u.pathname.endsWith('/profiles')) return new Response('[{"user_id":"u1","time_zone":"America/Chicago"}]');
  if (u.pathname.endsWith('/push_subscriptions') && (init.method || 'GET') === 'GET') return new Response(JSON.stringify([{ id: 's1', owner_id: 'u1', ...sub }, { id: 's2', owner_id: 'u1', ...sub, endpoint: 'https://push.example.net/gone' }]));
  if (u.pathname.endsWith('/reminder_sends')) { const b = JSON.parse(init.body); const key = `${b.event_id}${b.occurrence_date}${b.minutes}`; const fresh = !claimed.has(key); claimed.add(key); return new Response(JSON.stringify(fresh ? [b] : [])); }
  if (u.hostname === 'push.example.net') { assert(/^vapid t=/.test(init.headers.authorization) && init.headers['content-encoding'] === 'aes128gcm', 'push request has VAPID auth + aes128gcm'); return new Response('', { status: u.pathname === '/gone' ? 410 : 201 }); }
  return new Response('[]'); };
const env = { SUPABASE_URL: 'https://x.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 'svc', ...{ VAPID_PUBLIC_KEY: vapid.publicKey, VAPID_PRIVATE_KEY: vapid.privateKey } };
const rq = (sec) => new Request('https://x/functions/v1/send-reminders', { method: 'POST', headers: sec ? { 'x-cron-secret': sec } : {}, body: '{}' });
assert((await M.handle(rq(''), env, fake)).status === 403 && (await M.handle(rq('bad'), env, fake)).status === 403, 'wrong/missing cron secret -> 403');
const r1 = await (await M.handle(rq('good'), env, fake, T('2026-10-24T20:21:00Z'))).json();
assert(r1.due === 1 && r1.sent === 1 && r1.gone === 1, 'sends to live device, counts the expired one: ' + JSON.stringify(r1));
assert(calls.some(c => c.startsWith('DELETE /rest/v1/push_subscriptions?id=eq.s2')), 'expired subscription (410) deleted');
const r2 = await (await M.handle(rq('good'), env, fake, T('2026-10-24T20:22:00Z'))).json();
assert(r2.due === 1 && r2.sent === 0, 'next minute: already claimed, not sent twice');
const r3 = await M.handle(rq('good'), { ...env, VAPID_PRIVATE_KEY: '' }, fake); const t3 = await r3.text();
assert(r3.status === 500 && !t3.includes(vapid.publicKey), 'missing VAPID secret -> 500, nothing echoed');
console.log('SEND REMINDERS FUNCTION TESTS PASSED');
