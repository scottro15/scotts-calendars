// Browser test (Scott 2026-10-25, SI feature 1): Sandy Intelligence leave-by lines in Today → Heads Up, local mode.
// Routing + geocoding are MOCKED (Photon + Valhalla intercepted): no real network calls.
// Covers: no home → hint + back-to-back-only rows; Profile → Home (save, bad address, clear); leave-by maths
// (start − drive − 10 min, rounded down to 5), previous back-to-back location as the start point, already-there skip,
// past / started / all-day / to-do / no-location skipped, unroutable + unknown addresses, "Leave now … late",
// service down (not cached, recovers), caching (no repeat calls across re-renders and a reload), Maps links,
// tapping the event opens the editor, settings search, no page errors. Screenshots light + dark.
//   node tests/leave_by.test.js http://127.0.0.1:8766/ [shotsDir]
const { chromium } = require(process.env.PW || '/workspace/shot-tools/node_modules/playwright-core');
const fs = require('fs');
const BASE = process.argv[2] || 'http://127.0.0.1:8766/'; const SHOTS = process.argv[3] || '/workspace/shots-si1';
fs.mkdirSync(SHOTS, { recursive: true });
const assert = (c, m) => { if (!c) throw new Error('FAIL: ' + m); console.log('ok -', m); };

// fake map: address keyword -> [lat, lon]; drive minutes keyed by destination keyword (from any origin)
const PLACES = { 'test home': [38.60, -90.80], 'gym a': [38.70, -90.40], 'restaurant b': [38.72, -90.35], 'gym c': [38.65, -90.60], 'island gym': [10.00, -80.00], 'past gym': [38.61, -90.61] };
const DRIVE = { 'gym a': 32, 'restaurant b': 12, 'gym c': 45, 'past gym': 5 };
const keyOf = q => Object.keys(PLACES).find(k => q.toLowerCase().includes(k));
const byCoord = (lat, lon) => Object.keys(PLACES).find(k => Math.abs(PLACES[k][0] - lat) < 1e-6 && Math.abs(PLACES[k][1] - lon) < 1e-6);

(async () => {
  const b = await chromium.launch({ executablePath: '/usr/bin/google-chrome', headless: true, args: ['--no-sandbox'] });
  const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, timezoneId: 'America/Chicago', locale: 'en-US', isMobile: true, hasTouch: true, deviceScaleFactor: 2, reducedMotion: 'reduce' });
  const calls = { geo: [], route: [] }; let routeDown = false;
  await ctx.route('https://photon.komoot.io/**', r => {
    const q = new URL(r.request().url()).searchParams.get('q') || ''; calls.geo.push(q);
    const k = keyOf(q);
    const features = k ? [{ type: 'Feature', geometry: { type: 'Point', coordinates: [PLACES[k][1], PLACES[k][0]] }, properties: { name: k } }] : [];
    r.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify({ type: 'FeatureCollection', features }) });
  });
  await ctx.route('https://valhalla1.openstreetmap.de/**', r => {
    const j = JSON.parse(new URL(r.request().url()).searchParams.get('json')); calls.route.push(j);
    const hdr = { 'access-control-allow-origin': '*' };
    if (routeDown) return r.fulfill({ status: 503, headers: hdr, body: 'busy' });
    const to = byCoord(j.locations[1].lat, j.locations[1].lon);
    if (!to || !(to in DRIVE)) return r.fulfill({ status: 400, contentType: 'application/json', headers: hdr, body: JSON.stringify({ error_code: 442, error: 'No path could be found for input' }) });
    r.fulfill({ status: 200, contentType: 'application/json', headers: hdr, body: JSON.stringify({ trip: { summary: { time: DRIVE[to] * 60, length: DRIVE[to] * 0.8 } } }) });
  });
  const p = await ctx.newPage(); const errs = []; p.on('pageerror', e => errs.push(e.message));
  await p.clock.install({ time: new Date('2026-11-17T16:00:00Z') }); // Tue Nov 17 2026, 10:00 AM CT
  await p.goto(BASE); await p.waitForFunction(() => window.__app && window.__app.Store);
  await p.evaluate(() => { localStorage.clear(); sessionStorage.clear(); }); await p.goto(BASE);
  await p.waitForFunction(() => window.__app && window.SandyNav && window.SandyLeave && document.querySelector('#calendar .fc-view'));
  await p.evaluate(async () => { const S = window.__app.Store; for (const e of await S.list()) if (e.example) await S.remove(e.id); }).catch(() => {});
  await p.evaluate(async () => { // start from a clean calendar
    const S = window.__app.Store; const all = await S.list();
    if (all.length && S.clearExamples) await S.clearExamples();
    for (const e of await S.list()) { try { await S.remove(e.id); } catch (_) {} }
  });
  const ids = await p.evaluate(async () => {
    const S = window.__app.Store;
    const ev = o => ({ id: crypto.randomUUID(), kind: 'event', allDay: false, recurrence: { freq: 'none' }, location: '', notes: '', calendar: 'mam', category: 'Practice', ...o });
    const E = {
      past: ev({ title: 'Morning lift', start: '2026-11-17T08:00', end: '2026-11-17T09:00', location: 'Past Gym' }),
      soon: ev({ title: 'Client session', calendar: 'msc', start: '2026-11-17T10:20', end: '2026-11-17T11:00', location: 'Gym C, St. Louis' }),
      noloc: ev({ title: 'Phone check-in', calendar: 'lifetime', start: '2026-11-17T13:00', end: '2026-11-17T13:30' }),
      island: ev({ title: 'Island scrimmage', start: '2026-11-17T15:00', end: '2026-11-17T15:30', location: 'Island Gym' }),
      mystery: ev({ title: 'Mystery meetup', start: '2026-11-17T16:00', end: '2026-11-17T16:30', location: 'Nowhere Unroutable Place' }),
      practice: ev({ title: 'Jennings practice', start: '2026-11-17T18:00', end: '2026-11-17T20:00', location: 'Gym A, Jennings, MO' }),
      dinner: ev({ title: 'Team dinner', start: '2026-11-17T20:30', end: '2026-11-17T21:30', location: 'Restaurant B' }),
      film: ev({ title: 'Film at dinner', start: '2026-11-17T21:30', end: '2026-11-17T22:00', location: 'restaurant b' }),
      allday: ev({ title: 'Tournament day', allDay: true, start: '2026-11-17', end: '2026-11-17', location: 'Gym C' }),
      task: ev({ kind: 'task', title: 'Pick up jerseys', start: '2026-11-17T12:00', end: '2026-11-17T12:15', location: 'Gym A' }),
      tomorrow: ev({ title: 'Tomorrow practice', start: '2026-11-18T18:00', end: '2026-11-18T20:00', location: 'Gym A' }),
    };
    for (const e of Object.values(E)) await S.save(e);
    window.__app.refresh(); return Object.fromEntries(Object.entries(E).map(([k, v]) => [k, v.id]));
  });
  const settle = (ms = 500) => p.waitForTimeout(ms);
  const rows = () => p.$$eval('#tcLeave li', ls => ls.map(l => ({ state: l.dataset.state, text: l.textContent.replace(/\s+/g, ' ').trim(), id: (l.querySelector('.tc-item') || {}).dataset?.id || null, href: (l.querySelector('a.lb-maps') || {}).href || '', leave: l.dataset.leave || '', mins: l.dataset.mins || '' })));
  const today = async () => { await p.click('#bottomNav [data-tab=today]'); await p.waitForFunction(() => { const l = document.getElementById('tcLeave'); return l && !l.querySelector('[data-state=pending]'); }); await settle(300); };
  const rowFor = (rs, id) => rs.find(r => r.id === id);
  const shot = async (name, sel) => { // tidy screenshot: no toast, the section just below the top bar
    await p.evaluate(sel => { const t = document.getElementById('toast'); if (t) t.hidden = true; const el = document.querySelector(sel);
      if (el) { el.scrollIntoView({ block: 'start' }); const sc = document.scrollingElement; sc.scrollTop -= 72; let e = el.parentElement; while (e) { if (e.scrollHeight > e.clientHeight + 4 && /auto|scroll/.test(getComputedStyle(e).overflowY)) e.scrollTop -= 72; e = e.parentElement; } } }, sel);
    await settle(250); await p.screenshot({ path: `${SHOTS}/${name}.png` }); };

  // ---------- 1. pure helpers
  const pure = await p.evaluate(() => { const L = window.SandyLeave; const d = s => new Date(s + 'Z');
    return { a: L.leaveAt(d('2026-11-17T19:00:00'), 32).toISOString(), b: L.leaveAt(d('2026-11-17T19:00:00'), 35).toISOString(), c: L.leaveAt(d('2026-11-17T09:00:00'), 0).toISOString(), buf: L.BUFFER_MIN }; });
  assert(pure.a === '2026-11-17T18:15:00.000Z', 'leave-by: 7:00 PM start, 32 min drive -> 6:15 PM (10 min buffer, rounded down to 5)');
  assert(pure.b === '2026-11-17T18:15:00.000Z' && pure.c === '2026-11-17T08:50:00.000Z' && pure.buf === 10, 'leave-by rounding edge cases');

  // ---------- 2. no home yet
  await today();
  let rs = await rows();
  assert(rs.some(r => r.state === 'nohome' && /Add your home address/.test(r.text)), 'no home: hint to set it in Profile');
  assert(!rowFor(rs, ids.practice) && !rowFor(rs, ids.soon), 'no home: events that would start from home get no drive line');
  await shot('today_nohome_light', '.tc-heads');
  const din0 = rowFor(rs, ids.dinner);
  assert(din0 && din0.state === 'ok' && /from Jennings practice/.test(din0.text), 'no home: back-to-back event still uses the previous event location');
  assert(await p.isVisible('.tc-heads h3'), 'Heads Up card shows');
  await p.click('#tcLeave .lb-sethome'); await settle(700);
  assert(await p.evaluate(() => window.SandyNav.tab === 'profile' && document.activeElement && document.activeElement.id === 'homeAddr'), '"Set home in Profile" opens Profile with the Home field focused');

  // ---------- 3. Profile → Home: bad address, then a good one
  await p.fill('#homeAddr', 'zzzz Not A Real Address'); await p.click('#homeSave');
  await p.waitForFunction(() => /Couldn’t find that address/.test(document.getElementById('homeMsg').textContent));
  assert(await p.evaluate(() => !localStorage.getItem('sandy.home.v1')), 'unknown home address: friendly error, nothing saved');
  await p.fill('#homeAddr', '1 Test Home Rd, Testville, MO 63000'); await p.click('#homeSave');
  await p.waitForFunction(() => /Saved/.test(document.getElementById('homeMsg').textContent));
  const saved = await p.evaluate(() => JSON.parse(localStorage.getItem('sandy.home.v1')));
  assert(saved && saved.address === '1 Test Home Rd, Testville, MO 63000' && saved.lat === 38.6 && saved.lon === -90.8, 'home saved on this device (local mode) with its map position');
  await shot('profile_home_light', '#homeSection');

  // ---------- 4. Today with home
  await today(); rs = await rows();
  const pr = rowFor(rs, ids.practice);
  assert(pr && pr.state === 'ok' && pr.leave === '5:15 PM' && pr.mins === '32' && /Leave by 5:15 PM · 32 min drive/.test(pr.text) && /from home/.test(pr.text), `practice: "Leave by 5:15 PM · 32 min drive" from home (${pr && pr.text})`);
  assert(pr.href.includes('origin=' + encodeURIComponent('1 Test Home Rd, Testville, MO 63000')) && pr.href.includes('destination=' + encodeURIComponent('Gym A, Jennings, MO')) && pr.href.startsWith('https://www.google.com/maps/dir/'), 'practice: Maps link from home to the venue');
  const dn = rowFor(rs, ids.dinner);
  assert(dn && dn.leave === '8:05 PM' && /12 min drive/.test(dn.text) && /from Jennings practice/.test(dn.text) && dn.href.includes('origin=' + encodeURIComponent('Gym A, Jennings, MO')), 'back-to-back: dinner starts from the practice venue (Leave by 8:05 PM)');
  assert(!rowFor(rs, ids.film), 'already there (same place as the event before): no line');
  const so = rowFor(rs, ids.soon);
  assert(so && so.state === 'now' && /Leave now · 45 min drive/.test(so.text) && /about 25 min late/.test(so.text), `starts too soon: "Leave now … (about 25 min late)" (${so && so.text})`);
  const isl = rowFor(rs, ids.island), mys = rowFor(rs, ids.mystery);
  assert(isl && isl.state === 'noroute' && /Couldn’t work out the drive/.test(isl.text) && /Open in Maps/.test(isl.text), 'unroutable venue: friendly line + Open in Maps');
  assert(mys && mys.state === 'noroute' && mys.href.includes('destination=' + encodeURIComponent('Nowhere Unroutable Place')), 'unknown address: friendly line + Maps search link');
  for (const k of ['past', 'noloc', 'allday', 'task', 'tomorrow']) assert(!rowFor(rs, ids[k]), `no line for: ${k}`);
  assert(!rs.some(r => r.state === 'nohome'), 'home set: no hint');
  const order = rs.map(r => r.id); assert(order.indexOf(ids.soon) < order.indexOf(ids.practice) && order.indexOf(ids.practice) < order.indexOf(ids.dinner), 'lines in time order');
  await shot('today_leaveby_light', '.tc-heads');

  // ---------- 5. caching
  const n0 = { g: calls.geo.length, r: calls.route.length };
  for (let i = 0; i < 3; i++) { await p.evaluate(() => window.SandyNav.renderToday()); await settle(250); }
  await p.click('#bottomNav [data-tab=home]'); await settle(300); await today();
  assert(calls.geo.length === n0.g && calls.route.length === n0.r, `re-rendering Today makes no new lookups (geo ${n0.g}, route ${n0.r})`);
  await p.reload(); await p.waitForFunction(() => window.SandyNav && window.SandyLeave && document.querySelector('#calendar .fc-view')); await today();
  assert(calls.geo.length === n0.g && calls.route.length === n0.r, 'after a reload: still served from the cache');
  assert(n0.r <= 6, `route calls kept small (${n0.r})`);

  // ---------- 6. service down: friendly, not cached, recovers
  routeDown = true;
  await p.evaluate(() => { localStorage.removeItem('sandy.route.v1'); window.SandyNav.renderToday(); });
  await p.waitForFunction(() => document.querySelector('#tcLeave [data-state=offline]')); await settle(300);
  rs = await rows(); assert(rowFor(rs, ids.practice).state === 'offline' && /Drive time unavailable right now/.test(rowFor(rs, ids.practice).text), 'routing down: "Drive time unavailable right now" + Maps link');
  routeDown = false;
  await p.evaluate(() => window.SandyNav.renderToday()); await p.waitForFunction(() => !document.querySelector('#tcLeave [data-state=offline]') && !document.querySelector('#tcLeave [data-state=pending]'));
  rs = await rows(); assert(rowFor(rs, ids.practice).state === 'ok', 'routing back: drive time shows again (failure was not cached)');

  // ---------- 7. tap, past event later in the day, dark mode
  await p.click(`#tcLeave .tc-item[data-id="${ids.practice}"]`); await p.waitForSelector('#eventDialog[open]');
  assert(await p.inputValue('#fTitle').catch(() => '') === 'Jennings practice' || await p.evaluate(() => document.querySelector('#eventDialog [name=title]').value === 'Jennings practice'), 'tapping the event in a leave line opens it');
  await p.evaluate(() => document.querySelectorAll('dialog[open]').forEach(d => d.close())); await settle(400);
  await p.clock.setFixedTime(new Date('2026-11-18T00:40:00Z')); // 6:40 PM: practice has started
  await p.evaluate(() => window.SandyNav.renderToday()); await p.waitForFunction(() => !document.querySelector('#tcLeave [data-state=pending]')); await settle(200);
  rs = await rows(); assert(!rowFor(rs, ids.practice) && rowFor(rs, ids.dinner), 'once an event has started its line goes away; later ones stay');
  await p.clock.setFixedTime(new Date('2026-11-17T16:00:00Z'));
  await p.evaluate(() => window.SandyNav.setDark(true)); await p.evaluate(() => window.SandyNav.renderToday()); await p.waitForFunction(() => !document.querySelector('#tcLeave [data-state=pending]')); await settle(300);
  await p.mouse.move(5, 5); await shot('today_leaveby_dark', '.tc-heads');
  await p.click('#bottomNav [data-tab=profile]'); await settle(400);
  assert(await p.inputValue('#homeAddr') === '1 Test Home Rd, Testville, MO 63000', 'Profile shows the saved home');
  await shot('profile_home_dark', '#homeSection');
  await p.evaluate(() => window.SandyNav.setDark(false));

  // ---------- 8. settings search + clear
  await p.click('#bottomNav [data-tab=search]'); await p.fill('#searchBox', 'home address'); await settle(500);
  assert(await p.evaluate(() => /Home address/.test(document.getElementById('searchResults').textContent)), 'Search finds the Home address setting');
  await p.click('#bottomNav [data-tab=profile]'); await settle(300); await p.click('#homeClear');
  await p.waitForFunction(() => /Home cleared/.test(document.getElementById('homeMsg').textContent));
  assert(await p.evaluate(() => !localStorage.getItem('sandy.home.v1')) && await p.inputValue('#homeAddr') === '', 'Clear removes the home');
  await today(); rs = await rows(); assert(rs.some(r => r.state === 'nohome') && !rowFor(rs, ids.practice), 'after clearing: back to the hint');
  await p.evaluate(() => window.SandyNav.setDark(true)); await p.mouse.move(5, 5); await shot('today_nohome_dark', '.tc-heads'); await p.evaluate(() => window.SandyNav.setDark(false));

  assert(errs.length === 0, 'no page errors ' + errs.join(' | '));
  await b.close(); console.log('LEAVE-BY TESTS PASSED');
})().catch(e => { console.error(e); process.exit(1); });
