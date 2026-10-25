// Leave-by push alerts (SI feature A) against the LOCAL stand-in (Postgres with schema.sql incl.
// migration-2026-10-25-leave-alerts.sql + PostgREST + dev_proxy.py). Maps + geolocation mocked; fake addresses.
// Covers: Profile switch (turns notifications on, saves profiles.leave_alerts), plans saved to leave_plans (time,
// minutes, label -- no coordinates) and not re-sent when unchanged; current location updates the plan; 10-min
// switch; RLS (Bob can't read or write Alice's plans); the send-reminders Edge Function run against the stand-in
// sends "Time to leave" at the updated time, once; and the friendly message before the migration exists.
// Run: SECRET=<local postgrest jwt-secret> node tests/leave_alerts_supabase.test.js http://127.0.0.1:8786/
const { chromium } = require(process.env.PW || '/workspace/shot-tools/node_modules/playwright-core');
const crypto = require('crypto'); const fs = require('fs'); const os = require('os'); const path = require('path'); const { execFileSync } = require('child_process');
const BASE = process.argv[2] || 'http://127.0.0.1:8786/';
const REST = process.env.REST || 'http://127.0.0.1:3010';
const SECRET = process.env.SECRET;
const SHOTS = process.env.SHOTS || '/workspace/shots-si-a/'; fs.mkdirSync(SHOTS, { recursive: true });
const assert = (c, m) => { if (!c) throw new Error('FAIL: ' + m); console.log('ok -', m); };
const ALICE = { id: 'aaaaaaaa-0000-0000-0000-00000000000a', email: 'alice@example.com' };
const BOB = { id: 'bbbbbbbb-0000-0000-0000-00000000000b', email: 'bob@example.com' };
const b64 = x => Buffer.from(x).toString('base64url');
const sign = p => { const h = b64(JSON.stringify({ alg: 'HS256', typ: 'JWT' })); const q = b64(JSON.stringify(p));
  return `${h}.${q}.${crypto.createHmac('sha256', SECRET).update(`${h}.${q}`).digest('base64url')}`; };
const jwt = u => sign({ role: 'authenticated', sub: u.id, email: u.email, aud: 'authenticated', exp: Math.floor(Date.now() / 1000) + 86400 * 60 });
const SVC = sign({ role: 'service_role', exp: Math.floor(Date.now() / 1000) + 86400 * 60 });
const rest = async (p, init = {}, tok = SVC) => fetch(REST + p, { ...init, headers: { authorization: `Bearer ${tok}`, 'content-type': 'application/json', ...(init.headers || {}) } });
const restJ = async (p, tok) => (await rest(p, {}, tok)).json();
const VAPID = 'BPaeiWhjWtYiwgVHbjz8CNHzP8VzQ3l6jqqq4pkWcOqFAOJk44AbKKXHWoWkBErDF8Q_VOppwI1nIwQO_2sPUIQ';
const HOME = [38.6, -90.8], FAR = [38.95, -90.2], GYM = [38.7, -90.4];
const near = (a, b) => Math.abs(a - b) < 2e-3;

(async () => {
  const b = await chromium.launch({ executablePath: '/usr/bin/google-chrome', headless: true, args: ['--no-sandbox'] });
  async function open(u, { extra } = {}) {
    const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, timezoneId: 'America/Chicago', locale: 'en-US', serviceWorkers: 'allow' });
    await ctx.grantPermissions(['notifications'], { origin: new URL(BASE).origin });
    const cfg = `window.CALENDAR_CONFIG = { APP_NAME: 'SANDY', SUPABASE_URL: '${BASE.replace(/\/$/, '')}', SUPABASE_ANON_KEY: 'local-anon', OWNER_EMAIL: 'scottro1522@gmail.com', VAPID_PUBLIC_KEY: '${VAPID}' };`;
    await ctx.route('**/config.js', r => r.fulfill({ contentType: 'application/javascript', body: cfg }));
    await ctx.route('**/auth/v1/**', r => r.fulfill({ status: 200, contentType: 'application/json', body: '{}' }));
    const key = 'sb-' + new URL(BASE).hostname.split('.')[0] + '-auth-token';
    const s = JSON.stringify({ access_token: jwt(u), refresh_token: 'x', token_type: 'bearer', expires_in: 86400, expires_at: Math.floor(Date.now() / 1000) + 86400 * 60, user: { id: u.id, email: u.email, aud: 'authenticated', role: 'authenticated' } });
    await ctx.addInitScript(([k, v]) => { if (!sessionStorage.getItem('__i')) { sessionStorage.setItem('__i', 1); localStorage.setItem(k, v); } }, [key, s]);
    await ctx.addInitScript(() => { // headless Chrome has no push service: stand in for PushManager (as in push_reminders.test.js)
      if (!window.PushManager) return; let sub = null;
      const mk = key => ({ endpoint: 'https://fcm.googleapis.com/fcm/send/test-' + Math.random().toString(36).slice(2), options: { applicationServerKey: key },
        toJSON() { return { endpoint: this.endpoint, keys: { p256dh: 'B' + 'x'.repeat(86), auth: 'y'.repeat(22) } }; }, async unsubscribe() { sub = null; return true; } });
      PushManager.prototype.getSubscription = async () => sub;
      PushManager.prototype.subscribe = async o => (sub = mk(o.applicationServerKey.buffer || o.applicationServerKey));
    });
    const calls = { plans: 0 };
    await ctx.route('https://photon.komoot.io/**', r => { const q = (new URL(r.request().url()).searchParams.get('q') || '').toLowerCase(); const c = q.includes('test home') ? HOME : q.includes('gym a') ? GYM : null;
      r.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify({ features: c ? [{ geometry: { coordinates: [c[1], c[0]] }, properties: {} }] : [] }) }); });
    await ctx.route('https://valhalla1.openstreetmap.de/**', r => { const o = JSON.parse(new URL(r.request().url()).searchParams.get('json')).locations[0];
      const mins = near(o.lat, HOME[0]) && near(o.lon, HOME[1]) ? 32 : 50;
      r.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify({ trip: { summary: { time: mins * 60, length: mins * 0.7 } } }) }); });
    if (extra) await extra(ctx);
    const p = await ctx.newPage(); const errs = []; p.on('pageerror', e => errs.push(e.message));
    p.on('request', q => { if (q.url().includes('/rest/v1/leave_plans') && q.method() === 'POST') calls.plans++; });
    await p.clock.install({ time: new Date('2026-11-17T16:00:00Z') }); // Tue Nov 17 2026, 10:00 AM CT
    await p.goto(BASE);
    await p.waitForSelector('.onb, #calendar .fc-view', { timeout: 15000 });
    if (await p.$('.onb')) await p.click('.onb-go');
    await p.waitForSelector('#calendar .fc-view'); await p.waitForFunction(() => window.__app && window.__app.Store && window.SandyNav);
    await p.goto(BASE + '?tab=profile'); await p.waitForFunction(() => window.__app && window.__app.user && window.__app.user() && window.SandyNav && window.SandyLeave);
    return { ctx, p, errs, calls };
  }
  const t = (p, ms = 600) => p.waitForTimeout(ms);
  const waitPlans = async (ok, ms = 8000) => { const end = Date.now() + ms; let r; do { r = await restJ('/leave_plans?select=*'); if (ok(r)) return r; await new Promise(z => setTimeout(z, 250)); } while (Date.now() < end); console.log('plans now:', JSON.stringify(r)); return r; };
  const today = async p => { await p.click('#bottomNav [data-tab=today]'); await p.evaluate(() => window.SandyNav.renderToday());
    await p.waitForFunction(() => { const l = document.getElementById('tcLeave'); return l && l.querySelector('li') && !l.querySelector('[data-state=pending]'); }); await t(p, 800); };
  const profile = async p => { await p.click('#bottomNav [data-tab=profile]'); await p.waitForSelector('#leaveAlertsBox', { state: 'visible' }); await t(p, 500); };

  // start clean: other stand-in tests may have left events for these users
  for (const u of [ALICE, BOB]) { await rest(`/leave_plans?owner_id=eq.${u.id}`, { method: 'DELETE' }); await rest(`/events?owner_id=eq.${u.id}`, { method: 'DELETE' }); }
  // ...and shared calendars can show other users' events on the test day (a back-to-back event changes the start point)
  await rest('/events?start_at=gte.2026-11-16T00:00:00&start_at=lt.2026-11-19T00:00:00', { method: 'DELETE' });
  await rest('/events?recur_freq=neq.none', { method: 'DELETE' });
  // launch.test.js moves Alice to Europe/London; this test's times are Central
  await rest(`/profiles?user_id=in.(${ALICE.id},${BOB.id})`, { method: 'PATCH', body: JSON.stringify({ time_zone: 'America/Chicago', leave_alerts: false, leave_alerts_early: true }) });
  assert((await restJ(`/events?owner_id=in.(${ALICE.id},${BOB.id})&select=id`)).length === 0, 'clean start: no leftover events for the test users or the test day');
  // ---------- Alice
  let { ctx, p, errs, calls } = await open(ALICE);
  await p.fill('#homeAddr', '1 Test Home Rd, Testville, MO 63000'); await p.click('#homeSave'); await p.waitForFunction(() => /Saved/.test(document.getElementById('homeMsg').textContent));
  const evId = await p.evaluate(async () => { const id = crypto.randomUUID(); await window.__app.Store.save({ id, kind: 'event', allDay: false, recurrence: { freq: 'none' }, title: 'Jennings practice', calendar: (window.__app.calendars()[0] || {}).id, category: 'Practice', start: '2026-11-17T18:00', end: '2026-11-17T20:00', location: 'Gym A, Jennings, MO', notes: '' }); window.__app.refresh(); return id; });
  await profile(p);
  assert(!(await p.isChecked('#leaveAlerts')) && !(await p.isDisabled('#leaveAlerts')), 'signed in: alerts switch available, off by default');
  await today(p);
  assert(calls.plans === 0 && (await restJ('/leave_plans?select=event_id')).length === 0, 'alerts off: no plans sent to the server');
  await profile(p);
  await p.click('#leaveAlerts'); await p.waitForFunction(() => /On\. Open Today/.test(document.getElementById('leaveMsg').textContent), null, { timeout: 8000 });
  let prof = (await restJ(`/profiles?user_id=eq.${ALICE.id}&select=leave_alerts,leave_alerts_early`))[0];
  assert(prof.leave_alerts === true && prof.leave_alerts_early === true, 'switch on: profiles.leave_alerts saved (10-min on by default)');
  assert((await restJ(`/push_subscriptions?owner_id=eq.${ALICE.id}&select=id`)).length === 1, 'turning alerts on also turned on notifications for this device');
  await p.evaluate(() => document.getElementById('leaveAlertsBox').scrollIntoView({ block: 'center' })); await t(p, 200);
  await p.screenshot({ path: SHOTS + 'profile_alerts_on.png' });
  await today(p);
  let plans = await waitPlans(x => x.length >= 1);
  if (plans.length !== 1) console.log('plans:', JSON.stringify(plans.map(x => [x.event_id, x.owner_id, x.event_start, x.location])));
  assert(plans.length === 1 && plans[0].event_id === evId && plans[0].owner_id === ALICE.id && plans[0].event_start === '2026-11-17T18:00:00' && plans[0].occurrence_date === '2026-11-17', 'plan saved for the event occurrence');
  assert(Date.parse(plans[0].leave_at) === Date.parse('2026-11-17T23:15:00Z') && Date.parse(plans[0].home_leave_at) === Date.parse('2026-11-17T23:15:00Z') && plans[0].drive_min === 32 && plans[0].origin === 'home' && plans[0].source === 'client', 'leave at 5:15 PM CST (23:15Z) from home, 32 min');
  assert(!Object.keys(plans[0]).some(k => /lat|lon/.test(k)), 'no coordinate columns in leave_plans: ' + Object.keys(plans[0]).join(','));
  const n1 = calls.plans; await today(p); await today(p);
  assert(calls.plans === n1, 'unchanged plan: not re-sent on re-render');
  // ---------- current location near leave time (4:20 PM), far from home
  await ctx.grantPermissions(['geolocation', 'notifications'], { origin: new URL(BASE).origin }); await ctx.setGeolocation({ latitude: FAR[0], longitude: FAR[1] });
  await p.clock.setSystemTime(new Date('2026-11-17T22:20:00Z')); await today(p);
  await p.waitForFunction(() => document.querySelector('#tcLeave [data-origin=current]'), null, { timeout: 8000 }).catch(async e => { console.log(await p.evaluate(async () => [document.getElementById('tcLeave').innerText, await window.SandyLeave.locState(), window.__app.nowWall().toISOString()])); throw e; }); await t(p, 800);
  plans = await waitPlans(x => x.length === 1 && x[0].origin === 'current');
  assert(plans.length === 1 && plans[0].origin === 'current' && plans[0].origin_label === 'your current location' && plans[0].drive_min === 50 && Date.parse(plans[0].leave_at) === Date.parse('2026-11-17T23:00:00Z') && Date.parse(plans[0].home_leave_at) === Date.parse('2026-11-17T23:15:00Z'), 'plan updated from current location: leave 5:00 PM (23:00Z), label only, no coordinates');
  await p.screenshot({ path: SHOTS + 'today_current_signed_in.png' });
  // ---------- 10-min heads-up off
  await profile(p); await p.click('#leaveEarly'); await t(p, 800);
  prof = (await restJ(`/profiles?user_id=eq.${ALICE.id}&select=leave_alerts,leave_alerts_early`))[0];
  assert(prof.leave_alerts === true && prof.leave_alerts_early === false, '"Also 10 minutes before" off saved');
  assert(!errs.length, 'no page errors (Alice): ' + errs.join(' | '));
  await ctx.close();

  // ---------- RLS
  const bobTok = jwt(BOB);
  assert((await restJ('/leave_plans?select=event_id', bobTok)).length === 0, "RLS: Bob can't see Alice's plans");
  const bad = { event_id: evId, occurrence_date: '2026-11-17', event_start: '2026-11-17T18:00:00', location: 'X', leave_at: '2026-11-17T23:00:00Z', drive_min: 5 };
  let w = await rest('/leave_plans', { method: 'POST', body: JSON.stringify(bad) }, bobTok);
  assert(w.status >= 400, "RLS: Bob can't plan Alice's event (" + w.status + ')');
  w = await rest('/leave_plans', { method: 'POST', body: JSON.stringify({ ...bad, owner_id: ALICE.id }) }, bobTok);
  assert(w.status >= 400, "RLS: Bob can't write a plan as Alice (" + w.status + ')');
  w = await rest(`/leave_plans?event_id=eq.${evId}`, { method: 'PATCH', body: JSON.stringify({ leave_at: '2026-11-17T20:00:00Z' }), headers: { Prefer: 'return=representation' } }, bobTok);
  assert((await w.json()).length === 0, "RLS: Bob can't move Alice's plan");
  assert(Date.parse((await restJ('/leave_plans?select=leave_at'))[0].leave_at) === Date.parse('2026-11-17T23:00:00Z'), 'plan unchanged');

  // ---------- send-reminders Edge Function against the stand-in (push service faked)
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lafn-')); const fp = path.join(dir, 'fn.mjs');
  fs.writeFileSync(fp, fs.readFileSync(path.join(__dirname, '../supabase/functions/send-reminders/index.ts'), 'utf8'));
  const M = await import(fp);
  execFileSync('psql', ['-h', '127.0.0.1', '-p', process.env.PGPORT || '55433', '-U', 'postgres', '-d', process.env.DB || 'launchui', '-q', '-c',
    "insert into vault.secrets values ('sandy_push_cron_secret','local-cron-test') on conflict (name) do update set secret = excluded.secret"], { env: { ...process.env, PATH: '/usr/lib/postgresql/17/bin:' + process.env.PATH } });
  const ua = crypto.createECDH('prime256v1'); ua.generateKeys();
  await rest(`/push_subscriptions?owner_id=eq.${ALICE.id}`, { method: 'PATCH', body: JSON.stringify({ p256dh: ua.getPublicKey().toString('base64url'), auth: crypto.randomBytes(16).toString('base64url') }) });
  const kp = crypto.generateKeyPairSync('ec', { namedCurve: 'P-256' }); const jwk = kp.privateKey.export({ format: 'jwk' });
  const env = { SUPABASE_URL: BASE.replace(/\/$/, ''), SUPABASE_SERVICE_ROLE_KEY: SVC, VAPID_PRIVATE_KEY: jwk.d,
    VAPID_PUBLIC_KEY: Buffer.concat([Buffer.from([4]), Buffer.from(jwk.x, 'base64url'), Buffer.from(jwk.y, 'base64url')]).toString('base64url') };
  const pushed = [];
  const f = async (url, init) => { if (String(url).startsWith(env.SUPABASE_URL)) return fetch(url, init);
    if (/photon|valhalla/.test(url)) throw new Error('unexpected map lookup: ' + url);
    pushed.push(url); return new Response(null, { status: 201 }); };
  const run = async iso => (await M.handle(new Request('https://x/functions/v1/send-reminders', { method: 'POST', headers: { 'x-cron-secret': 'local-cron-test' }, body: '{}' }), env, f, Date.parse(iso))).json();
  let r = await run('2026-11-17T22:15:00Z');
  assert(r.leave_due === 0 && pushed.length === 0, '4:15 PM: no "check your drive" (already re-checked from current location): ' + JSON.stringify(r));
  r = await run('2026-11-17T22:50:00Z');
  assert(r.leave_due === 0 && pushed.length === 0, '4:50 PM: 10-min heads-up switched off -> nothing');
  r = await run('2026-11-17T23:00:00Z');
  assert(r.leave_due === 1 && r.sent === 1 && pushed.length === 1 && pushed[0].startsWith('https://fcm.googleapis.com/'), '5:00 PM: "Time to leave" pushed to Alice\'s device: ' + JSON.stringify(r));
  const sends = await restJ('/reminder_sends?select=event_id,minutes,occurrence_date');
  assert(sends.some(s => s.event_id === evId && s.minutes === -1 && s.occurrence_date === '2026-11-17'), 'recorded in reminder_sends (code -1)');
  r = await run('2026-11-17T23:01:00Z');
  assert(r.sent === 0 && pushed.length === 1, 'not sent twice');
  // event moved after planning -> stale plan not sent
  await rest(`/events?id=eq.${evId}`, { method: 'PATCH', body: JSON.stringify({ start_at: '2026-11-17 19:00:00' }) });
  await rest('/reminder_sends?minutes=lt.0', { method: 'DELETE' });
  r = await run('2026-11-17T23:00:00Z');
  assert(r.sent === 0 && pushed.length === 1, 'event moved: the stale plan is not sent');

  // ---------- before the migration: friendly message, switch stays off
  ({ ctx, p, errs } = await open(BOB, { extra: async c => c.route('**/rest/v1/profiles**', async r => {
    const body = r.request().postData() || ''; if (r.request().method() !== 'GET' && /leave_alerts/.test(body)) return r.fulfill({ status: 400, contentType: 'application/json', body: JSON.stringify({ code: 'PGRST204', message: "Could not find the 'leave_alerts' column of 'profiles' in the schema cache" }) });
    return r.continue(); }) }));
  await profile(p); await p.click('#leaveAlerts'); await p.waitForFunction(() => /one-time server update/.test(document.getElementById('leaveMsg').textContent), null, { timeout: 8000 });
  assert(!(await p.isChecked('#leaveAlerts')), 'missing column: switch flips back off with a friendly message');
  assert(!errs.length, 'no page errors (Bob)');
  await ctx.close(); await b.close();
  console.log('LEAVE ALERTS SUPABASE TESTS PASSED');
})().catch(e => { console.error(e); process.exit(1); });
