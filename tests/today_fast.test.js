// Browser test (Scott 2026-10-29, t148u item 4): Today paints from local data first and never waits on the
// weather / place / drive-time services. Local mode; every outside lookup (Photon, Open-Meteo, weather.gov,
// Valhalla) is made to HANG (never answers) or answer slowly.
//  - Hanging services: Up next + On Today show within 1.2 s of the app being ready; Heads Up shows a thin shimmer
//    placeholder (not the explainer), and the shimmer is gone within ~4 s (2.5 s timeout, fails quietly, no errors).
//  - Slow services (1.5 s): the weather line fades in afterwards without a reload; reload → it shows straight from cache.
//  - Every lookup is started in parallel (not one after another).
//   node tests/today_fast.test.js http://127.0.0.1:8794/ [shotsDir]
const { chromium } = require(process.env.PW || '/workspace/shot-tools/node_modules/playwright-core');
const fs = require('fs');
const BASE = process.argv[2] || 'http://127.0.0.1:8794/'; const SHOTS = process.argv[3] || '/workspace/shots-oct29/speed/test';
fs.mkdirSync(SHOTS, { recursive: true });
let n = 0; const assert = (c, m) => { if (!c) throw new Error('FAIL: ' + m); n++; console.log('ok -', m); };
const NOW = new Date('2026-11-17T16:00:00Z'); // Tue Nov 17 2026, 10:00 AM CT
const HDR = { 'access-control-allow-origin': '*' };
function hourly(code) { const time = [], temp = [], pop = [], c = [], wind = []; for (let h = 0; h < 24; h++) { time.push(`2026-11-17T${String(h).padStart(2, '0')}:00`); temp.push(18); pop.push(90); c.push(code); wind.push(28); } return { hourly: { time, temperature_2m: temp, precipitation_probability: pop, weather_code: c, wind_speed_10m: wind } }; }
async function run(b, mode, dark) {
  const ctx = await b.newContext({ viewport: { width: 393, height: 873 }, timezoneId: 'America/Chicago', locale: 'en-US', isMobile: true, hasTouch: true, deviceScaleFactor: 2, reducedMotion: 'no-preference' });
  const starts = []; const t0 = Date.now();
  const slow = (r, body) => { starts.push([new URL(r.request().url()).host, Date.now() - t0]); if (mode === 'hang') return; setTimeout(() => r.fulfill({ status: 200, contentType: 'application/json', headers: HDR, body: JSON.stringify(body) }).catch(() => {}), 1500); };
  await ctx.route('https://photon.komoot.io/**', r => slow(r, { type: 'FeatureCollection', features: [{ type: 'Feature', geometry: { type: 'Point', coordinates: [-90.4, 38.7] }, properties: { name: 'gym' } }] }));
  await ctx.route('https://valhalla1.openstreetmap.de/**', r => slow(r, { trip: { summary: { time: 1200, length: 9 } } }));
  await ctx.route('https://api.open-meteo.com/**', r => slow(r, hourly(73)));
  await ctx.route('https://api.weather.gov/**', r => slow(r, { features: [] }));
  const p = await ctx.newPage(); const errs = []; p.on('pageerror', e => errs.push(e.message));
  await p.clock.install({ time: NOW });
  await p.addInitScript(dark => { if (sessionStorage.getItem('__t')) return; sessionStorage.setItem('__t', '1'); localStorage.clear(); localStorage.setItem('sandy.tour.off', '1'); localStorage.setItem('sandy.welcome.off', '1');
    localStorage.setItem('sandy.theme', dark ? 'dark' : 'light'); localStorage.setItem('sandy.home.v1', JSON.stringify({ address: 'QA Home', lat: 38.6, lon: -90.3 })); sessionStorage.setItem('sandy.tab', 'today'); }, dark);
  await p.goto(BASE); await p.waitForFunction(() => window.__app && window.__app.Store && window.SandyNav);
  await p.evaluate(async () => { const S = __app.Store; for (const e of await S.list()) { try { await S.remove(e.id); } catch (_) {} }
    const ev = (t, s, e, loc) => ({ id: crypto.randomUUID(), kind: 'event', allDay: false, recurrence: { freq: 'none' }, notes: '', calendar: 'mam', category: 'Practice', title: t, start: s, end: e, location: loc });
    await S.saveMany([ev('QA fast lift', '2026-11-17T11:30', '2026-11-17T12:30', 'Gym One, St. Louis'), ev('QA fast film', '2026-11-17T14:00', '2026-11-17T15:00', 'Film Room, Clayton'), ev('QA fast practice', '2026-11-17T17:00', '2026-11-17T19:00', 'Practice Gym, Maryville')]); });
  // fresh open on Today (caches empty, services hanging/slow)
  starts.length = 0;
  await p.evaluate(() => { for (const k of Object.keys(localStorage)) if (/sandy\.(geo|route|wx|weather|alerts)/i.test(k)) localStorage.removeItem(k); });
  await p.reload(); const tReady = Date.now();
  await p.waitForFunction(() => document.querySelector('#todayBody .tc-on') && /QA fast lift/.test(document.getElementById('todayBody').textContent), null, { timeout: 8000 });
  const paintMs = Date.now() - tReady;
  const tag = `${mode} ${dark ? 'dark' : 'light'}`;
  assert(paintMs < 4000, `${tag}: Up next + On Today painted ${paintMs} ms after open without waiting on lookups`);
  const shim = await p.evaluate(() => !!document.querySelector('#todayBody .tc-heads:not([hidden]) .tc-shimmer'));
  if (mode === 'hang') assert(shim, `${tag}: Heads Up shows the thin shimmer while lookups are out`);
  await p.screenshot({ path: `${SHOTS}/today-fast-${mode}-${dark ? 'dark' : 'light'}-early.png` });
  if (mode === 'hang') {
    await p.waitForFunction(() => !document.querySelector('#todayBody .tc-shimmer'), null, { timeout: 9000 });
    assert(true, `${tag}: shimmer goes away once the lookups time out (fails quietly)`);
    await p.waitForTimeout(3000); await p.screenshot({ path: `${SHOTS}/today-fast-${mode}-${dark ? 'dark' : 'light'}-late.png` });
    assert(!/Working out the drive/.test(await p.textContent('#todayBody')), `${tag}: no endless "Working out the drive" once the drive lookups time out`);
    assert(/QA fast lift/.test(await p.textContent('#todayBody')), `${tag}: events still on Today after the timeouts`);
  } else {
    await p.waitForFunction(() => /snow/i.test((document.querySelector('#todayBody .tc-heads') || {}).textContent || ''), null, { timeout: 12000 });
    assert(true, `${tag}: weather line fades into Heads Up when the slow lookup lands`);
    const hosts = starts.filter(x => /open-meteo/.test(x[0])).map(x => x[1]);
    const geos = starts.filter(x => /photon/.test(x[0])).map(x => x[1]);
    assert(geos.length >= 2 && Math.max(...geos) - Math.min(...geos) < 1400, `${tag}: place lookups start together, not one after another (${geos.join(',')} ms)`);
    await p.screenshot({ path: `${SHOTS}/today-fast-${mode}-${dark ? 'dark' : 'light'}-late.png` });
    starts.length = 0; await p.reload(); const t1 = Date.now();
    await p.waitForFunction(() => /snow/i.test((document.querySelector('#todayBody .tc-heads') || {}).textContent || ''), null, { timeout: 8000 });
    assert(Date.now() - t1 < 4000, `${tag}: after a reopen the cached weather shows straight away (${Date.now() - t1} ms, ${hosts.length} forecast calls first time)`);
  }
  assert(!errs.length, `${tag}: no page errors ${errs.join(' | ')}`);
  await ctx.close();
}
(async () => {
  const b = await chromium.launch({ executablePath: '/usr/bin/google-chrome', headless: true, args: ['--no-sandbox'] });
  for (const mode of ['hang', 'slow']) for (const dark of [false, true]) await run(b, mode, dark);
  await b.close(); console.log(`\n${n} ok`);
})().catch(e => { console.error(e); process.exit(1); });
