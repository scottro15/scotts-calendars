// Node test for leave-by push alerts in the send-reminders Edge Function (Sandy Intelligence feature A):
// due math (check-your-drive 1 hr before the from-home leave time, 10-min heads-up, time to leave), validation
// against the live event (moved / relocated / skipped / deleted / someone else's), the server-side fallback plan
// (free Photon + Valhalla, mocked here), dedupe via reminder_sends, and that no user coordinates are stored. No network.
//   node tests/leave_alerts_function.test.mjs
import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs'; import { tmpdir } from 'node:os'; import { join } from 'node:path';
import nodeCrypto from 'node:crypto';
const dir = mkdtempSync(join(tmpdir(), 'leavefn-')); const fp = join(dir, 'fn.mjs');
writeFileSync(fp, readFileSync(new URL('../supabase/functions/send-reminders/index.ts', import.meta.url), 'utf8'));
const M = await import(fp);
const assert = (c, m) => { if (!c) throw new Error('FAIL: ' + m); console.log('ok -', m); };
const T = (iso) => Date.parse(iso);
const U = 'u1';
const ev = (o = {}) => ({ id: 'e1', owner_id: U, title: 'Maryville @ Lindenwood', location: '1 Test Field Rd, Testville, MO 63000', all_day: false,
  start_at: '2026-11-17T18:00:00', recur_freq: 'none', exdates: [], is_task: false, done: false, completed_dates: [], ...o });
// 6:00 PM CST (UTC-6) = 00:00Z; 32 min drive + 10 min buffer -> 5:18 -> rounded down 5:15 PM = 23:15Z
const plan = (o = {}) => ({ event_id: 'e1', occurrence_date: '2026-11-17', owner_id: U, event_start: '2026-11-17T18:00:00', location: '1 Test Field Rd, Testville, MO 63000',
  leave_at: '2026-11-17T23:15:00+00:00', home_leave_at: '2026-11-17T23:15:00+00:00', drive_min: 32, origin: 'home', origin_label: 'home', status: 'ok', source: 'client', ...o });
const prefs = (o = {}) => (id) => id === U ? { early: true, tz: 'America/Chicago', home: { lat: 38.6, lon: -90.9 }, ...o } : null;
const due = (p, rows, now, pf = prefs()) => M.dueLeaveAlerts([p], new Map(rows.map(r => [r.id, r])), pf, T(now));

assert(new Date(M.leaveAtUtc(T('2026-11-18T00:00:00Z'), 32)).toISOString() === '2026-11-17T23:15:00.000Z', 'leave time = start - drive - 10 min, rounded down to 5 min');
// check-your-drive: 1 hour before the from-home leave time
let d = due(plan(), [ev()], '2026-11-17T22:15:00Z');
assert(d.length === 1 && d[0].code === M.LEAVE.CHECK && d[0].payload.title === '🚗 Check your drive to Maryville @ Lindenwood', 'check-your-drive at 4:15 PM: ' + (d[0] && d[0].payload.title));
assert(/^Leave by 5:15 PM from home \(32 min drive\) · starts 6:00 PM/.test(d[0].payload.body) && /check from where you are/.test(d[0].payload.body), 'check body: ' + d[0].payload.body);
assert(d[0].payload.url === './?tab=today&locate=1' && d[0].payload.tag === 'e1:2026-11-17:leave', 'opens Today and triggers the location check; one tag per event so alerts replace each other');
assert(due(plan(), [ev()], '2026-11-17T22:14:00Z').length === 0, 'not before');
assert(due(plan(), [ev()], '2026-11-17T22:25:00Z').length === 0, 'not more than 10 min late');
assert(due(plan({ origin: 'current', origin_label: 'your current location' }), [ev()], '2026-11-17T22:15:00Z').length === 0, 'already re-checked from current location: no check push');
// 10-min heads-up
d = due(plan(), [ev()], '2026-11-17T23:05:00Z');
assert(d.length === 1 && d[0].code === M.LEAVE.EARLY && d[0].payload.title === '🚗 Leave in 10 min for Maryville @ Lindenwood' && /^Leave by 5:15 PM · 32 min drive from home · starts 6:00 PM/.test(d[0].payload.body), 'leave in 10 min: ' + (d[0] && d[0].payload.body));
assert(due(plan(), [ev()], '2026-11-17T23:05:00Z', prefs({ early: false })).length === 0, 'early heads-up off: nothing at 5:05');
// time to leave
d = due(plan(), [ev()], '2026-11-17T23:15:00Z');
assert(d.length === 1 && d[0].code === M.LEAVE.NOW && d[0].payload.title === '🚗 Time to leave for Maryville @ Lindenwood' && /^32 min drive from home · starts 6:00 PM · 1 Test Field Rd/.test(d[0].payload.body), 'time to leave: ' + (d[0] && d[0].payload.body));
d = due(plan({ origin: 'current', origin_label: 'your current location', drive_min: 50, leave_at: '2026-11-17T22:55:00+00:00' }), [ev()], '2026-11-17T22:55:00Z');
assert(d.length === 1 && d[0].code === M.LEAVE.NOW && /^50 min drive from your current location/.test(d[0].payload.body), 'plan updated from current location: alert at the new time, labelled');
// a "leave in 10 min" that would arrive more than 4 min late is skipped (time-to-leave follows shortly)
assert(due(plan(), [ev()], '2026-11-17T23:08:00Z').length === 1, '10-min heads-up up to 4 min late: still sent');
assert(due(plan(), [ev()], '2026-11-17T23:10:00Z').length === 0, '5 min late: skipped (would mislead)');
// validation against the live event
assert(due(plan(), [ev({ start_at: '2026-11-17T19:00:00' })], '2026-11-17T23:15:00Z').length === 0, 'event moved: stale plan ignored');
assert(due(plan(), [ev({ location: '2 Other St, Testville' })], '2026-11-17T23:15:00Z').length === 0, 'location changed: stale plan ignored');
assert(due(plan(), [], '2026-11-17T23:15:00Z').length === 0, 'event deleted: nothing');
assert(due(plan(), [ev({ owner_id: 'u2' })], '2026-11-17T23:15:00Z').length === 0, "someone else's event: nothing");
assert(due(plan(), [ev()], '2026-11-17T23:15:00Z', () => null).length === 0, 'alerts off: nothing');
assert(due(plan({ status: 'failed' }), [ev()], '2026-11-17T23:15:00Z').length === 0, 'failed plan: nothing');
const wk = ev({ start_at: '2026-09-01T18:00:00', recur_freq: 'weekly', recur_by_weekday: [2] });
assert(due(plan(), [wk], '2026-11-17T23:15:00Z').length === 1, 'repeating event: that occurrence still exists -> sent (DST-correct, CST)');
assert(due(plan(), [{ ...wk, exdates: ['2026-11-17'] }], '2026-11-17T23:15:00Z').length === 0, 'skipped occurrence: nothing');
assert(due(plan({ leave_at: '2026-11-18T00:05:00+00:00' }), [ev()], '2026-11-18T00:05:00Z').length === 0, 'never after the event started');
// server-side fallback planning
const need = (rows, plans, now, pf = prefs()) => M.needsServerPlan(rows, plans, pf, T(now));
assert(need([ev()], [], '2026-11-17T21:30:00Z').length === 1, 'no plan, starts in 2.5 hr: server plans it');
assert(need([ev()], [], '2026-11-17T20:30:00Z').length === 0, 'starts in 3.5 hr: not yet');
assert(need([ev()], [plan()], '2026-11-17T21:30:00Z').length === 0, 'app already planned it');
assert(need([ev({ start_at: '2026-11-17T18:30:00' })], [plan()], '2026-11-17T21:30:00Z').length === 1, 'plan is for an old start time: replanned');
assert(need([ev()], [plan({ status: 'failed', updated_at: '2026-11-17T21:20:00Z' })], '2026-11-17T21:30:00Z').length === 0, 'failed 10 min ago: wait before retrying');
assert(need([ev()], [plan({ status: 'failed', updated_at: '2026-11-17T20:00:00Z' })], '2026-11-17T21:30:00Z').length === 1, 'failed over an hour ago: retry');
assert(need([ev()], [], '2026-11-17T21:30:00Z', prefs({ home: null })).length === 0, 'no home saved: no server plan');
assert(need([ev({ location: '' }), ev({ id: 'e2', all_day: true }), ev({ id: 'e3', is_task: true })], [], '2026-11-17T21:30:00Z').length === 0, 'no location / all-day / to-do: skipped');

// --- handler end to end (mocked Supabase REST + Photon + Valhalla + push service)
const ua = nodeCrypto.createECDH('prime256v1'); ua.generateKeys();
const sub = { id: 's1', owner_id: U, endpoint: 'https://push.example.net/send/abc', p256dh: ua.getPublicKey().toString('base64url'), auth: nodeCrypto.randomBytes(16).toString('base64url') };
const kp = nodeCrypto.generateKeyPairSync('ec', { namedCurve: 'P-256' }); const jwk = kp.privateKey.export({ format: 'jwk' });
const env = { SUPABASE_URL: 'https://x.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 'svc', VAPID_PRIVATE_KEY: jwk.d,
  VAPID_PUBLIC_KEY: Buffer.concat([Buffer.from([4]), Buffer.from(jwk.x, 'base64url'), Buffer.from(jwk.y, 'base64url')]).toString('base64url') };
let plans = []; const claimed = new Set(); const pushes = []; const calls = []; let lookups = 0;
const fake = async (url, init = {}) => { const u = new URL(url); const m = init.method || 'GET'; calls.push(`${m} ${u.pathname}${u.search}`);
  if (u.pathname.endsWith('/rpc/sandy_check_cron_secret')) return new Response(JSON.stringify(JSON.parse(init.body).s === 'good'));
  if (u.pathname.endsWith('/events')) return new Response(JSON.stringify(u.search.includes('reminders=') ? [] : [ev()]));
  if (u.pathname.endsWith('/profiles')) return new Response(JSON.stringify(u.search.includes('leave_alerts=is.true')
    ? [{ user_id: U, time_zone: 'America/Chicago', leave_alerts_early: true, home_lat: 38.6, home_lon: -90.9 }] : [{ user_id: U, time_zone: 'America/Chicago' }]));
  if (u.pathname.endsWith('/push_subscriptions')) return new Response(JSON.stringify([sub]));
  if (u.pathname.endsWith('/leave_plans')) { if (m === 'GET') return new Response(JSON.stringify(plans));
    if (m === 'POST') { const b = JSON.parse(init.body); plans = plans.filter(p => !(p.event_id === b.event_id && p.occurrence_date === b.occurrence_date)).concat([b]); return new Response(null, { status: 201 }); }
    return new Response(null, { status: 204 }); }
  if (u.pathname.endsWith('/reminder_sends')) { const b = JSON.parse(init.body); const k = `${b.event_id}|${b.occurrence_date}|${b.minutes}`; const fresh = !claimed.has(k); claimed.add(k); return new Response(JSON.stringify(fresh ? [b] : [])); }
  if (u.hostname === 'photon.komoot.io') { lookups++; return new Response(JSON.stringify({ features: [{ geometry: { coordinates: [-90.5, 38.7] } }] })); }
  if (u.hostname === 'valhalla1.openstreetmap.de') return new Response(JSON.stringify({ trip: { summary: { time: 32 * 60, length: 21.4 } } }));
  if (u.hostname === 'push.example.net') { pushes.push(T('2026-01-01')); return new Response(null, { status: 201 }); }
  return new Response('[]'); };
const rq = () => new Request('https://x/functions/v1/send-reminders', { method: 'POST', headers: { 'x-cron-secret': 'good' }, body: '{}' });
const run = async (iso) => (await M.handle(rq(), env, fake, T(iso))).json();
let r = await run('2026-11-17T21:30:00Z');
assert(r.planned === 1 && plans.length === 1 && plans[0].source === 'server' && plans[0].drive_min === 32 && plans[0].leave_at === '2026-11-17T23:15:00.000Z', 'app not opened: server plans from home with free OSM services: ' + JSON.stringify(plans[0]));
assert(!Object.keys(plans[0]).some(k => /lat|lon/.test(k)), 'no coordinates stored in the plan');
assert(calls.some(c => c.startsWith('GET /api/?') && c.includes('q=1+Test+Field+Rd')), 'Photon geocodes the event location');
r = await run('2026-11-17T21:31:00Z'); assert(r.planned === 0 && lookups === 1, 'next minute: no repeat lookups');
r = await run('2026-11-17T22:15:00Z'); assert(r.leave_due === 1 && r.sent === 1 && claimed.has('e1|2026-11-17|-60'), 'check-your-drive push sent at 4:15 PM');
r = await run('2026-11-17T22:16:00Z'); assert(r.sent === 0, 'not sent twice');
// the app re-checks from the current location (farther away): it updates the plan, the server follows
plans = [plan({ origin: 'current', origin_label: 'your current location', drive_min: 50, leave_at: '2026-11-17T22:55:00+00:00' })];
r = await run('2026-11-17T22:45:00Z'); assert(r.sent === 1 && claimed.has('e1|2026-11-17|-10'), '10-min heads-up uses the updated (current location) time');
r = await run('2026-11-17T22:55:00Z'); assert(r.sent === 1 && claimed.has('e1|2026-11-17|-1'), 'time to leave sent at the updated time');
r = await run('2026-11-17T23:15:00Z'); assert(r.sent === 0, 'old from-home time: nothing more');
const before = calls.length; await run('2026-11-17T23:07:00Z');
assert(calls.slice(before).some(c => c.startsWith('DELETE /rest/v1/leave_plans?occurrence_date=lt.')), 'hourly: old plans cleaned up');
// migration not applied yet (profiles.leave_alerts missing -> 400): reminders still work, leave part skipped
const noCol = async (url, init) => new URL(url).search.includes('leave_alerts=is.true') ? new Response('{"code":"42703"}', { status: 400 }) : fake(url, init);
const r0 = await (await M.handle(rq(), env, noCol, T('2026-11-17T23:20:00Z'))).json();
assert(!r0.leave_due && !('error' in r0), 'before the migration: leave alerts quietly skipped: ' + JSON.stringify(r0));
console.log('LEAVE ALERTS FUNCTION TESTS PASSED');
