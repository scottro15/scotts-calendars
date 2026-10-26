// Calendars screen against the LOCAL stand-in (Postgres with schema.sql + PostgREST + dev_proxy.py), signed in
// (multi-user step 2 calendars table). Covers the 2026-10-25 fixes: opens to a plain list; adding "Personal" works
// (was "undefined is not an object (evaluating 'taken.has')"), slug collisions, rename/recolour per user, events in
// the new calendar, and a second user keeping separate calendars.
// Run: SECRET=<local postgrest jwt-secret> node tests/calendars_supabase.test.js http://127.0.0.1:8786/
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
const del = async p => { const r = await fetch(REST + p, { method: 'DELETE', headers: { authorization: `Bearer ${SVC}` } }); if (!r.ok) throw new Error(p + ' ' + r.status); };
const post = async (p, body) => { const r = await fetch(REST + p, { method: 'POST', headers: { authorization: `Bearer ${SVC}`, 'content-type': 'application/json', prefer: 'return=minimal' }, body: JSON.stringify(body) }); if (!r.ok) throw new Error(p + ' ' + r.status + ' ' + await r.text()); };
const VAPID = 'BPaeiWhjWtYiwgVHbjz8CNHzP8VzQ3l6jqqq4pkWcOqFAOJk44AbKKXHWoWkBErDF8Q_VOppwI1nIwQO_2sPUIQ';

(async () => {
  const b = await chromium.launch({ executablePath: '/usr/bin/google-chrome', headless: true, args: ['--no-sandbox'] });
  async function open(u, { vp = { width: 390, height: 844 }, ua, perms = true, extra } = {}) {
    const ctx = await b.newContext({ viewport: vp, timezoneId: 'America/Chicago', locale: 'en-US', userAgent: ua, serviceWorkers: 'allow' });
    await ctx.addInitScript(() => { try { localStorage.setItem('sandy.welcome.off', '1'); } catch (e) {} }); // beta welcome sheet: covered by tests/welcome.test.js
    if (perms) await ctx.grantPermissions(['notifications'], { origin: new URL(BASE).origin });
    const cfg = `window.CALENDAR_CONFIG = { APP_NAME: 'SANDY', SUPABASE_URL: '${BASE.replace(/\/$/, '')}', SUPABASE_ANON_KEY: 'local-anon', OWNER_EMAIL: 'scottro1522@gmail.com', VAPID_PUBLIC_KEY: '${VAPID}' };`;
    await ctx.route('**/config.js', r => r.fulfill({ contentType: 'application/javascript', body: cfg }));
    await ctx.route('**/auth/v1/**', r => r.fulfill({ status: 200, contentType: 'application/json', body: '{}' }));
    const key = 'sb-' + new URL(BASE).hostname.split('.')[0] + '-auth-token';
    const s = JSON.stringify({ access_token: jwt(u), refresh_token: 'x', token_type: 'bearer', expires_in: 86400, expires_at: Math.floor(Date.now() / 1000) + 86400 * 60, user: { id: u.id, email: u.email, aud: 'authenticated', role: 'authenticated' } });
    await ctx.addInitScript(([k, v]) => { if (!sessionStorage.getItem('__i')) { sessionStorage.setItem('__i', 1); localStorage.setItem(k, v); } }, [key, s]);
    if (extra) await extra(ctx);
    const p = await ctx.newPage(); const errs = []; p.on('pageerror', e => errs.push(e.message));
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
  const t = (p, ms = 500) => p.waitForTimeout(ms);
  const ready = p => p.waitForFunction(() => window.__app && window.__app.user && window.__app.user() && window.SandyNav && document.querySelector('#calendar .fc-view'));
  const openDlg = async p => { await p.click('#bottomNav [data-tab=profile]'); await t(p, 400); await p.click('#manageCalsBtn'); await p.waitForSelector('dialog.cal-dlg[open]'); await t(p, 300); };
  const save = async p => { await p.click('#calSave'); await p.waitForEvent('load', { timeout: 8000 }).catch(() => {}); await ready(p); await t(p, 600); };
  const addCal = async (p, name, color = '#db2777') => { await openDlg(p); await p.click('#calAddBtn'); await p.fill('#ncName', name); await p.$eval('#ncColor', (el, c) => { el.value = c; }, color); await save(p); };
  const dbCals = async u => rest(`/calendars?owner_id=eq.${u.id}&select=slug,name,short,color,sort&order=sort`);

  // ---------- Alice (signed in, multi-user) with three work calendars like Scott's (no "Personal" yet): list first, then add "Personal"
  // self-contained: start both users from no calendars (other stand-in tests may have run first)
  for (const u of [ALICE, BOB]) await del(`/calendars?owner_id=eq.${u.id}`);
  await del('/events?title=eq.Date%20night');
  await post('/calendars', [['work-a', 'Coaching', '#7c3aed'], ['work-b', 'Training', '#ea580c'], ['work-c', 'Facility', '#0f766e']].map(([slug, name, color], i) => ({ owner_id: ALICE.id, slug, name, short: name, color, sort: i })));
  let { ctx, p, errs } = await open(ALICE);
  await openDlg(p);
  const st = await p.evaluate(() => { const d = document.querySelector('dialog.cal-dlg'); const vis = el => !!(el && el.offsetParent);
    return { n: d.querySelectorAll('.cal-item').length, inputs: [...d.querySelectorAll('input')].filter(vis).length, focus: document.activeElement.tagName }; });
  assert(st.n >= 1 && st.inputs === 0 && st.focus !== 'INPUT', `signed in: opens to a plain list (${st.n} calendars, no fields showing, focus ${st.focus})`);
  await p.click('dialog.cal-dlg button[value=cancel]'); await t(p, 300);
  const before = await dbCals(ALICE);
  await addCal(p, 'Personal');
  assert(!errs.some(e => /taken/.test(e)), 'no "taken.has" error');
  let rows = await dbCals(ALICE);
  const pr = rows.find(r => r.name === 'Personal');
  assert(rows.length === before.length + 1 && pr && pr.slug === 'personal' && pr.color === '#db2777' && pr.sort === before.length, `"Personal" saved to the calendars table for Alice (${JSON.stringify(pr)})`);
  assert(await p.evaluate(() => window.__app.calendars().some(c => c.id === 'personal' && c.name === 'Personal')), 'Personal shows in the app after saving');
  // a name that slugs the same gets the next free slug
  await addCal(p, 'Personal!', '#16a34a');
  rows = await dbCals(ALICE);
  assert(rows.some(r => r.name === 'Personal!' && r.slug === 'personal-2'), 'a name with the same slug gets "personal-2"');
  // rename + recolour through the per-user update
  await openDlg(p); const li = p.locator('dialog.cal-dlg .cal-list > li[data-slug=personal-2]');
  await li.locator('.cal-item').click(); await li.locator('.cn').fill('Kids'); await li.locator('input[type=color]').evaluate(el => { el.value = '#0f766e'; });
  await save(p); rows = await dbCals(ALICE);
  assert(rows.some(r => r.slug === 'personal-2' && r.name === 'Kids' && r.color === '#0f766e'), 'rename + recolour saved to Alice\'s row');
  // an event in Personal syncs
  await p.evaluate(async () => { await window.__app.Store.save({ id: crypto.randomUUID(), kind: 'event', allDay: false, recurrence: { freq: 'none' }, title: 'Date night', calendar: 'personal', category: 'Event', start: '2026-11-20T19:00', end: '2026-11-20T21:00', location: '', notes: '' }); });
  await t(p, 800);
  const evs = await rest(`/events?title=eq.Date%20night&select=calendar,owner_id`);
  assert(evs.length === 1 && evs[0].calendar === 'personal' && evs[0].owner_id === ALICE.id, 'an event in Personal saves with calendar "personal"');
  assert(errs.length === 0, 'alice: no page errors ' + errs.join(' | '));
  await ctx.close();

  // ---------- Bob: new user with the onboarding defaults (which already include "Personal")
  ({ ctx, p, errs } = await open(BOB));
  const bob0 = await dbCals(BOB);
  assert(bob0.some(r => r.slug === 'personal') && (await dbCals(BOB)).every(r => r.color !== '#db2777'), 'Bob has his own default "Personal", not Alice\'s');
  await openDlg(p); await p.click('#calAddBtn'); await p.fill('#ncName', 'personal'); await p.click('#calSave'); await t(p, 400);
  assert(/already have a calendar called/.test(await p.textContent('dialog.cal-dlg .onb-err')), 'Bob adding a second "Personal": clear message, nothing saved');
  await p.click('dialog.cal-dlg button[value=cancel]'); await t(p, 300);
  assert((await dbCals(BOB)).length === bob0.length, 'Bob still has the same calendars');
  await addCal(p, 'Personal (kids)', '#7c3aed');
  assert((await dbCals(BOB)).some(r => r.slug === 'personal-kids' && r.name === 'Personal (kids)'), 'Bob adds "Personal (kids)" → slug personal-kids');
  assert((await dbCals(ALICE)).find(r => r.slug === 'personal').color === '#db2777', 'Alice\'s Personal untouched');
  assert(errs.length === 0, 'bob: no page errors ' + errs.join(' | '));
  await ctx.close();
  await b.close(); console.log('CALENDARS SUPABASE TESTS PASSED');
})().catch(e => { console.error(e); process.exit(1); });
