// Browser test (Scott 2026-10-25, SI feature A): leave-by from your CURRENT LOCATION, local mode, geolocation MOCKED
// (Playwright geolocation emulation + an injected denial/failure). Photon + Valhalla mocked: no real network calls.
// Covers: nothing asked before the 1-hour window; in the window an in-app explanation first (no browser prompt until
// "Use my location"); far from home → drive re-worked from there, labelled "from your current location", Maps link
// starts there; position reused for 5 min; near home (< 0.3 mi) → home plan; "No thanks" remembered; browser denial
// remembered, home plan stays; position unavailable → home plan; opened from a "Check your drive" push
// (?tab=today&locate=1) → checks right away, even before the window; Profile "Use my current location" off → never
// asks; position never written to storage; local mode: alerts switch says sign in. Screenshots light + dark.
//   node tests/leave_location.test.js http://127.0.0.1:8766/ [shotsDir]
const { chromium } = require(process.env.PW || '/workspace/shot-tools/node_modules/playwright-core');
const fs = require('fs');
const BASE = process.argv[2] || 'http://127.0.0.1:8766/'; const SHOTS = process.argv[3] || '/workspace/shots-si-a';
fs.mkdirSync(SHOTS, { recursive: true });
const assert = (c, m) => { if (!c) throw new Error('FAIL: ' + m); console.log('ok -', m); };
const HOME = [38.60, -90.80], FAR = [38.95, -90.20], NEAR = [38.6015, -90.8015] /* ~200 m */, GYM = [38.70, -90.40];
const near = (a, b) => Math.abs(a - b) < 2e-3;

(async () => {
  const b = await chromium.launch({ executablePath: '/usr/bin/google-chrome', headless: true, args: ['--no-sandbox'] });
  async function open({ at, url = '', grant = false, geo = FAR, inject = null, dark = false, keepStorage = null } = {}) {
    const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, timezoneId: 'America/Chicago', locale: 'en-US', isMobile: true, hasTouch: true, deviceScaleFactor: 2, reducedMotion: 'reduce', colorScheme: dark ? 'dark' : 'light' });
    const calls = { geo: [], route: [] };
    await ctx.route('https://photon.komoot.io/**', r => {
      const q = (new URL(r.request().url()).searchParams.get('q') || '').toLowerCase(); calls.geo.push(q);
      const c = q.includes('test home') ? HOME : q.includes('gym a') ? GYM : null;
      r.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify({ features: c ? [{ geometry: { coordinates: [c[1], c[0]] }, properties: {} }] : [] }) });
    });
    await ctx.route('https://valhalla1.openstreetmap.de/**', r => {
      const j = JSON.parse(new URL(r.request().url()).searchParams.get('json')); calls.route.push(j.locations[0]);
      const o = j.locations[0]; const mins = near(o.lat, HOME[0]) && near(o.lon, HOME[1]) ? 32 : near(o.lat, FAR[0]) ? 50 : 33;
      r.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify({ trip: { summary: { time: mins * 60, length: mins * 0.7 } } }) });
    });
    if (grant) { await ctx.grantPermissions(['geolocation']); await ctx.setGeolocation({ latitude: geo[0], longitude: geo[1] }); }
    await ctx.addInitScript(inj => { // count browser location requests; optionally fail them
      const g = navigator.geolocation; if (!g) return; const orig = g.getCurrentPosition.bind(g); window.__geoCalls = 0;
      g.getCurrentPosition = (ok, err, o) => { window.__geoCalls++; if (inj) return setTimeout(() => err && err({ code: inj, message: 'mock' }), 10); return orig(ok, err, o); };
    }, inject);
    const p = await ctx.newPage(); const errs = []; p.on('pageerror', e => errs.push(e.message));
    await p.clock.install({ time: new Date(at) });
    if (keepStorage) await ctx.addInitScript(s => { if (!sessionStorage.getItem('__seed')) { sessionStorage.setItem('__seed', 1); for (const [k, v] of Object.entries(s)) localStorage.setItem(k, v); } }, keepStorage);
    await p.goto(BASE + url); await p.waitForFunction(() => window.__app && window.__app.Store && window.SandyLeave && document.querySelector('#calendar .fc-view, .tc-summary'));
    return { ctx, p, errs, calls };
  }
  const seed = async p => p.evaluate(async () => {
    const S = window.__app.Store; if (S.clearExamples) await S.clearExamples(); for (const e of await S.list()) { try { await S.remove(e.id); } catch (_) {} }
    const ev = o => ({ id: crypto.randomUUID(), kind: 'event', allDay: false, recurrence: { freq: 'none' }, location: '', notes: '', calendar: 'mam', category: 'Practice', ...o });
    await S.save(ev({ title: 'Jennings practice', start: '2026-11-17T18:00', end: '2026-11-17T20:00', location: 'Gym A, Jennings, MO' }));
    await window.SandyLeave.setHome('1 Test Home Rd, Testville, MO 63000');
    window.__app.refresh();
  });
  const today = async p => { await p.evaluate(() => { window.SandyNav.go ? window.SandyNav.go('today') : document.querySelector('#bottomNav [data-tab=today]').click(); });
    await p.evaluate(() => window.SandyNav.renderToday());
    await p.waitForFunction(() => { const l = document.getElementById('tcLeave'); return l && l.querySelector('li') && !l.querySelector('[data-state=pending]'); });
    await p.waitForTimeout(600); };
  const rows = p => p.$$eval('#tcLeave li', ls => ls.map(l => ({ state: l.dataset.state, origin: l.dataset.origin || '', leave: l.dataset.leave || '', mins: l.dataset.mins || '', text: l.textContent.replace(/\s+/g, ' ').trim(), href: (l.querySelector('a.lb-maps') || {}).href || '' })));
  const geoCalls = p => p.evaluate(() => window.__geoCalls);
  const shot = async (p, name) => { await p.evaluate(() => { const t = document.getElementById('toast'); if (t) t.hidden = true; const el = document.querySelector('.tc-heads'); if (el) { el.scrollIntoView({ block: 'start' }); document.scrollingElement.scrollTop -= 72; } }); await p.waitForTimeout(250); await p.screenshot({ path: `${SHOTS}/${name}.png` }); };

  // ---------- 1. 10:00 AM: far outside the window -> home plan, nothing asked
  let s = await open({ at: '2026-11-17T16:00:00Z' });
  await s.p.evaluate(() => { localStorage.clear(); sessionStorage.clear(); }); await seed(s.p); await today(s.p);
  let r = await rows(s.p);
  assert(r.length === 1 && r[0].state === 'ok' && r[0].leave === '5:15 PM' && /from home/.test(r[0].text), '10 AM: leave by 5:15 PM from home: ' + r[0].text);
  assert(await geoCalls(s.p) === 0, '10 AM: location not requested (outside the 1-hour window)');
  // ---------- 2. 4:20 PM (inside 1 hr of 5:15): explanation row first, no browser prompt yet
  await s.p.clock.setSystemTime(new Date('2026-11-17T22:20:00Z')); await today(s.p);
  r = await rows(s.p);
  assert(r.some(x => x.state === 'askloc' && /Not leaving from home\?/.test(x.text) && /stays on this phone/.test(x.text)), 'in the window: in-app explanation shown first');
  assert(r[0].leave === '5:15 PM' && await geoCalls(s.p) === 0, 'no browser prompt until the user agrees; home plan meanwhile');
  await shot(s.p, 'ask_light');
  // ---------- 3. "Use my location" (the browser then asks; here: Allow) -> far from home -> re-worked from there
  await s.ctx.grantPermissions(['geolocation']); await s.ctx.setGeolocation({ latitude: FAR[0], longitude: FAR[1] });
  await s.p.click('#tcLeave .lb-loc-yes');
  await s.p.waitForFunction(() => document.querySelector('#tcLeave [data-origin=current]'), null, { timeout: 8000 });
  r = await rows(s.p);
  assert(r.length === 1 && r[0].origin === 'current' && r[0].mins === '50' && r[0].leave === '5:00 PM', 'far away: 50 min drive, leave by 5:00 PM: ' + r[0].text);
  assert(/from your current location/.test(r[0].text) && !/from home/.test(r[0].text) && r[0].text.startsWith('📍'), 'labelled "from your current location"');
  assert(/origin=38\.95%2C-90\.2/.test(r[0].href), 'Directions start from where you are: ' + r[0].href);
  assert(await geoCalls(s.p) === 1, 'browser asked exactly once');
  await shot(s.p, 'current_location_light');
  await today(s.p); r = await rows(s.p);
  assert(r[0].origin === 'current' && await geoCalls(s.p) === 1, 're-render within 5 min: position reused, not re-requested');
  const stored = await s.p.evaluate(() => JSON.stringify({ ...localStorage }) + JSON.stringify({ ...sessionStorage }));
  assert(!/38\.95|-90\.2[^0-9]|90\.20/.test(stored), 'current position never written to localStorage/sessionStorage');
  // ---------- 4. back near home (~200 m): home plan
  await s.ctx.setGeolocation({ latitude: NEAR[0], longitude: NEAR[1] }); await s.p.evaluate(() => window.SandyLeave.clearPos()); await today(s.p);
  r = await rows(s.p);
  assert(r.length === 1 && r[0].origin === 'home' && r[0].leave === '5:15 PM' && /from home/.test(r[0].text), 'within 0.3 mi of home: home plan kept: ' + JSON.stringify(r) + ' calls ' + await geoCalls(s.p));
  assert(await geoCalls(s.p) === 2, 'cached position cleared: asked again (fresh fix)');
  // ---------- 5. Profile: "Use my current location" off -> never asks; local mode alerts say sign in
  await s.p.click('#bottomNav [data-tab=profile]'); await s.p.waitForSelector('#leaveAlertsBox', { state: 'visible' }); await s.p.waitForTimeout(300);
  assert(await s.p.isChecked('#leaveUseLoc') && await s.p.isDisabled('#leaveAlerts'), 'Profile: location on by default; alerts switch disabled in local mode');
  assert(/Sign in to get leave-by alerts/.test(await s.p.textContent('#leaveMsg')), 'local mode: sign-in hint');
  await s.p.evaluate(() => document.getElementById('leaveAlertsBox').scrollIntoView({ block: 'center' })); await s.p.waitForTimeout(200);
  await s.p.screenshot({ path: `${SHOTS}/profile_local_light.png` });
  await s.p.click('#leaveUseLoc'); await s.p.waitForTimeout(200);
  assert(await s.p.evaluate(() => window.SandyLeave.useLoc()) === false, 'switch off saved on this device');
  await s.ctx.setGeolocation({ latitude: FAR[0], longitude: FAR[1] }); await today(s.p);
  r = await rows(s.p);
  assert(r.length === 1 && r[0].origin === 'home' && await geoCalls(s.p) === 2, 'location off: home plan, browser not asked');
  assert(!s.errs.length, 'no page errors: ' + s.errs.join(' | '));
  await s.ctx.close();

  // ---------- 6. "No thanks" remembered
  s = await open({ at: '2026-11-17T22:20:00Z' });
  await s.p.evaluate(() => { localStorage.clear(); sessionStorage.clear(); }); await seed(s.p); await today(s.p);
  await s.p.click('#tcLeave .lb-loc-no'); await s.p.waitForTimeout(500);
  r = await rows(s.p); assert(r.length === 1 && r[0].origin === 'home' && !r.some(x => x.state === 'askloc'), '"No thanks": home plan, row gone');
  await today(s.p); r = await rows(s.p); assert(!r.some(x => x.state === 'askloc') && await geoCalls(s.p) === 0, '"No thanks" remembered, browser never asked');
  await s.ctx.close();

  // ---------- 7. browser denies -> remembered, home plan
  s = await open({ at: '2026-11-17T22:20:00Z', inject: 1 });
  await s.p.evaluate(() => { localStorage.clear(); sessionStorage.clear(); }); await seed(s.p); await today(s.p);
  await s.p.click('#tcLeave .lb-loc-yes'); await s.p.waitForTimeout(800);
  r = await rows(s.p); assert(r.length === 1 && r[0].origin === 'home' && r[0].leave === '5:15 PM' && !r.some(x => x.state === 'askloc'), 'denied: home plan stays, no ask row');
  await today(s.p); assert(await geoCalls(s.p) === 1 && await s.p.evaluate(() => window.SandyLeave.locState()) === 'denied', 'denial remembered: not asked again');
  assert(!s.errs.length, 'no page errors (denied)');
  await s.ctx.close();

  // ---------- 8. position unavailable (code 2) -> home plan, no error
  s = await open({ at: '2026-11-17T22:20:00Z', inject: 2, grant: true });
  await s.p.evaluate(() => { localStorage.clear(); sessionStorage.clear(); }); await seed(s.p); await today(s.p);
  r = await rows(s.p); assert(r.length === 1 && r[0].origin === 'home' && r[0].leave === '5:15 PM' && await geoCalls(s.p) >= 1, 'permission granted but position unavailable: home plan');
  assert(!s.errs.length, 'no page errors (unavailable)');
  await s.ctx.close();

  // ---------- 9. opened from "Check your drive" push before the window (2:00 PM) -> Today + checks right away
  const seedCtx = await open({ at: '2026-11-17T20:00:00Z', grant: true });
  await seedCtx.p.evaluate(() => { localStorage.clear(); sessionStorage.clear(); }); await seed(seedCtx.p);
  const ls = await seedCtx.p.evaluate(() => ({ ...localStorage })); await seedCtx.ctx.close();
  s = await open({ at: '2026-11-17T20:00:00Z', grant: true, url: '?tab=today&locate=1', keepStorage: ls, dark: true });
  await s.p.waitForFunction(() => document.querySelector('#tcLeave [data-origin]'), null, { timeout: 10000 });
  await s.p.waitForFunction(() => document.querySelector('#tcLeave [data-origin=current]'), null, { timeout: 8000 });
  r = await rows(s.p);
  assert(await s.p.evaluate(() => window.SandyNav.tab) === 'today', 'push link opens Today');
  assert(r[0].origin === 'current' && r[0].leave === '5:00 PM' && /from your current location/.test(r[0].text), 'locate=1: checked from current location right away (2 PM): ' + r[0].text);
  await s.p.evaluate(() => window.SandyNav.setDark(true)); await s.p.waitForTimeout(200);
  await shot(s.p, 'current_location_dark');
  assert(!s.errs.length, 'no page errors (push open)');
  await s.ctx.close();
  // ---------- 10. dark: ask row screenshot
  s = await open({ at: '2026-11-17T22:20:00Z', dark: true });
  await s.p.evaluate(() => { localStorage.clear(); sessionStorage.clear(); }); await seed(s.p); await s.p.evaluate(() => window.SandyNav.setDark(true)); await today(s.p);
  await shot(s.p, 'ask_dark');
  await s.p.click('#bottomNav [data-tab=profile]'); await s.p.waitForSelector('#leaveAlertsBox', { state: 'visible' }); await s.p.evaluate(() => document.getElementById('leaveAlertsBox').scrollIntoView({ block: 'center' })); await s.p.waitForTimeout(250);
  await s.p.screenshot({ path: `${SHOTS}/profile_local_dark.png` });
  await s.ctx.close();
  await b.close();
  console.log('LEAVE LOCATION TESTS PASSED');
})().catch(e => { console.error(e); process.exit(1); });
