// Leave-by home address (SI 1) against the LOCAL stand-in (Postgres with schema.sql incl. migration-2026-10-25-home.sql
// + PostgREST + dev_proxy.py): home saved to profiles (per user, RLS), shown on another device, used for leave-by,
// cleared; and the fallback to this device when the columns are missing (migration not run). Maps mocked; fake addresses.
// Run: SECRET=<local postgrest jwt-secret> node tests/leave_by_supabase.test.js http://127.0.0.1:8786/
const { chromium } = require(process.env.PW || '/workspace/shot-tools/node_modules/playwright-core');
const crypto = require('crypto'); const fs = require('fs');
const BASE = process.argv[2] || 'http://127.0.0.1:8786/';
const REST = process.env.REST || 'http://127.0.0.1:3010';
const SECRET = process.env.SECRET;
const assert = (c, m) => { if (!c) throw new Error('FAIL: ' + m); console.log('ok -', m); };
const ALICE = { id: 'aaaaaaaa-0000-0000-0000-00000000000a', email: 'alice@example.com' };
const BOB = { id: 'bbbbbbbb-0000-0000-0000-00000000000b', email: 'bob@example.com' };
const b64 = x => Buffer.from(x).toString('base64url');
const sign = p => { const h = b64(JSON.stringify({ alg: 'HS256', typ: 'JWT' })); const q = b64(JSON.stringify(p));
  return `${h}.${q}.${crypto.createHmac('sha256', SECRET).update(`${h}.${q}`).digest('base64url')}`; };
const jwt = u => sign({ role: 'authenticated', sub: u.id, email: u.email, aud: 'authenticated', exp: Math.floor(Date.now() / 1000) + 86400 * 60 });
const SVC = sign({ role: 'service_role', exp: Math.floor(Date.now() / 1000) + 86400 * 60 });
const rest = async (p) => (await fetch(REST + p, { headers: { authorization: `Bearer ${SVC}` } })).json();
const VAPID = 'BPaeiWhjWtYiwgVHbjz8CNHzP8VzQ3l6jqqq4pkWcOqFAOJk44AbKKXHWoWkBErDF8Q_VOppwI1nIwQO_2sPUIQ';

(async () => {
  const b = await chromium.launch({ executablePath: '/usr/bin/google-chrome', headless: true, args: ['--no-sandbox'] });
  async function open(u, { vp = { width: 390, height: 844 }, ua, perms = true, extra } = {}) {
    const ctx = await b.newContext({ viewport: vp, timezoneId: 'America/Chicago', locale: 'en-US', userAgent: ua, serviceWorkers: 'allow' });
    if (perms) await ctx.grantPermissions(['notifications'], { origin: new URL(BASE).origin });
    const cfg = `window.CALENDAR_CONFIG = { APP_NAME: 'SANDY', SUPABASE_URL: '${BASE.replace(/\/$/, '')}', SUPABASE_ANON_KEY: 'local-anon', OWNER_EMAIL: 'scottro1522@gmail.com', VAPID_PUBLIC_KEY: '${VAPID}' };`;
    await ctx.route('**/config.js', r => r.fulfill({ contentType: 'application/javascript', body: cfg }));
    await ctx.route('**/auth/v1/**', r => r.fulfill({ status: 200, contentType: 'application/json', body: '{}' }));
    const key = 'sb-' + new URL(BASE).hostname.split('.')[0] + '-auth-token';
    const s = JSON.stringify({ access_token: jwt(u), refresh_token: 'x', token_type: 'bearer', expires_in: 86400, expires_at: Math.floor(Date.now() / 1000) + 86400 * 60, user: { id: u.id, email: u.email, aud: 'authenticated', role: 'authenticated' } });
    await ctx.addInitScript(([k, v]) => { if (!sessionStorage.getItem('__i')) { sessionStorage.setItem('__i', 1); localStorage.setItem(k, v); } }, [key, s]);
    await mockMaps(ctx); if (extra) await extra(ctx);
    const p = await ctx.newPage(); const errs = []; p.on('pageerror', e => errs.push(e.message));
    await p.clock.install({ time: new Date('2026-11-17T16:00:00Z') }); // Tue Nov 17 2026, 10:00 AM CT
    await p.goto(BASE);
    await p.waitForSelector('.onb, #calendar .fc-view', { timeout: 15000 });
    if (await p.$('.onb')) await p.click('.onb-go'); // first sign-in: accept the default calendars
    await p.waitForSelector('#calendar .fc-view'); await p.waitForFunction(() => window.__app && window.__app.Store && window.SandyNav);
    await p.goto(BASE + '?tab=profile'); await p.waitForFunction(() => window.__app && window.__app.user && window.__app.user() && window.SandyNav && window.SandyLeave);
    return { ctx, p, errs };
  }
async function mockMaps(ctx) {
  const P = { 'test home': [38.6, -90.8], 'gym a': [38.7, -90.4] };
  await ctx.route('https://photon.komoot.io/**', r => { const q = (new URL(r.request().url()).searchParams.get('q') || '').toLowerCase(); const k = Object.keys(P).find(x => q.includes(x));
    r.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify({ features: k ? [{ type: 'Feature', geometry: { type: 'Point', coordinates: [P[k][1], P[k][0]] }, properties: {} }] : [] }) }); });
  await ctx.route('https://valhalla1.openstreetmap.de/**', r => r.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify({ trip: { summary: { time: 32 * 60, length: 25.6 } } }) }));
}
  const t = (p, ms = 600) => p.waitForTimeout(ms);
  const today = async p => { await p.click('#bottomNav [data-tab=today]'); await p.waitForFunction(() => { const l = document.getElementById('tcLeave'); return l && !l.querySelector('[data-state=pending]'); }); await t(p, 300);
    return p.$$eval('#tcLeave li', ls => ls.map(l => ({ state: l.dataset.state, text: l.textContent.replace(/\s+/g, ' ').trim(), href: (l.querySelector('a.lb-maps') || {}).href || '' }))); };
  const saveHome = async (p, addr) => { await p.click('#bottomNav [data-tab=profile]'); await t(p, 300); await p.fill('#homeAddr', addr);
    if (addr) await p.click('#homeSave'); else await p.click('#homeClear');
    await p.waitForFunction(() => /Saved|cleared|Could/.test(document.getElementById('homeMsg').textContent)); return p.textContent('#homeMsg'); };
  const addEvent = p => p.evaluate(async () => { const S = window.__app.Store;
    await S.save({ id: crypto.randomUUID(), kind: 'event', allDay: false, recurrence: { freq: 'none' }, title: 'Jennings practice', calendar: (window.__app.calendars()[0] || {}).id, category: 'Practice', start: '2026-11-17T18:00', end: '2026-11-17T20:00', location: 'Gym A, Jennings, MO', notes: '' });
    window.__app.refresh(); });
  const HOME = '1 Test Home Rd, Testville, MO 63000';

  // ---------- Alice: home saved to her account (profiles table)
  let { ctx, p, errs } = await open(ALICE);
  let m = await saveHome(p, HOME);
  assert(/✓ Saved\. Leave-by/.test(m) && !/device/.test(m), `signed in: home saved to the account ("${m.trim()}")`);
  let prof = await rest(`/profiles?user_id=eq.${ALICE.id}&select=home_address,home_lat,home_lon`);
  assert(prof.length === 1 && prof[0].home_address === HOME && prof[0].home_lat === 38.6 && prof[0].home_lon === -90.8, 'profiles row has home_address / home_lat / home_lon');
  assert(await p.evaluate(id => !localStorage.getItem('sandy.home.v1.' + id) && !localStorage.getItem('sandy.home.v1'), ALICE.id), 'nothing kept on the device when the account has it');
  await addEvent(p); await t(p, 800);
  let rs = await today(p);
  assert(rs.some(r => r.state === 'ok' && /Leave by 5:15 PM · 32 min drive/.test(r.text) && /from home/.test(r.text)), 'Today shows "Leave by 5:15 PM · 32 min drive" from the account home');
  assert(errs.length === 0, 'alice: no page errors ' + errs.join(' | '));
  await ctx.close();
  // new device (fresh context): home comes back from the account
  ({ ctx, p, errs } = await open(ALICE));
  await t(p, 500);
  assert(await p.inputValue('#homeAddr') === HOME, 'another device: Profile shows the home from the account');
  rs = await today(p); assert(rs.some(r => r.state === 'ok' && /Leave by 5:15 PM/.test(r.text)), 'another device: leave-by works from the account home');
  await ctx.close();

  // ---------- Bob: per-user — he does not see Alice's home
  ({ ctx, p, errs } = await open(BOB));
  assert(await p.inputValue('#homeAddr') === '', 'Bob: no home (homes are per user)');
  await addEvent(p); await t(p, 800); rs = await today(p);
  assert(rs.some(r => r.state === 'nohome') && !rs.some(r => r.state === 'ok'), 'Bob: hint to set his home, no drive line');
  await ctx.close();

  // ---------- Bob on a database without the new columns (migration not run yet): falls back to this device
  const missing = async c => c.route(/\/rest\/v1\/profiles/, r => {
    const body = r.request().postData() || '';
    if (/home_address/.test(body)) return r.fulfill({ status: 400, contentType: 'application/json', body: JSON.stringify({ code: 'PGRST204', details: null, hint: null, message: "Could not find the 'home_address' column of 'profiles' in the schema cache" }) });
    return r.continue(); });
  ({ ctx, p, errs } = await open(BOB, { extra: missing }));
  m = await saveHome(p, HOME);
  assert(/Saved on this device/.test(m), `missing columns: saved on this device ("${m.trim()}")`);
  assert(await p.evaluate(id => !!JSON.parse(localStorage.getItem('sandy.home.v1.' + id) || 'null'), BOB.id), 'device copy is keyed to Bob\'s user id');
  prof = await rest(`/profiles?user_id=eq.${BOB.id}&select=home_address`);
  assert(!prof.length || !prof[0].home_address, 'nothing written to Bob\'s profile');
  rs = await today(p); assert(rs.some(r => r.state === 'ok' && /Leave by 5:15 PM/.test(r.text)), 'device fallback: leave-by still works');
  assert(errs.length === 0, 'bob: no page errors ' + errs.join(' | '));
  await ctx.close();

  // ---------- Alice clears her home
  ({ ctx, p, errs } = await open(ALICE));
  m = await saveHome(p, '');
  prof = await rest(`/profiles?user_id=eq.${ALICE.id}&select=home_address,home_lat,home_lon`);
  assert(/Home cleared/.test(m) && prof[0].home_address === null && prof[0].home_lat === null, 'Clear removes the home from the account');
  await ctx.close();
  await b.close(); console.log('LEAVE-BY SUPABASE TESTS PASSED');
})().catch(e => { console.error(e); process.exit(1); });
