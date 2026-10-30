// 5b (t150u): leave-by sanity check. A bare place name is matched near home first ("Jennings High School" must not
// jump to Kansas); a vague place that still lands far away (>150 mi) or a 2 h+ drive shows "Check this location" and
// sends no leave-by alarm. Explicit far addresses (away games: street / city, ST / ZIP) keep a normal leave-by.
// Photon + Valhalla are MOCKED; local mode. iPhone + iPad (WebKit), Android phone + tablet (Chromium), light + dark.
//   node tests/leaveby_sanity.test.js BASE [SHOTS]
const PW = require(process.env.PW || '/usr/local/lib/pnpm/5/.pnpm/playwright-core@1.59.1/node_modules/playwright-core');
const fs = require('fs');
const BASE = process.argv[2] || 'http://127.0.0.1:8793/';
const SHOTS = process.argv[3] || '/workspace/shots-oct29/today-design/5b';
fs.mkdirSync(SHOTS, { recursive: true });
let n = 0; const ok = (c, m) => { if (!c) throw new Error('FAIL: ' + m); console.log('ok -', m); n++; };
const DEV = [['iphone', 'webkit', 393, 852], ['ipad', 'webkit', 820, 1180], ['android-phone', 'chromium', 412, 915], ['android-tablet', 'chromium', 800, 1280]];
// coordinates [lat, lon] and drive minutes from anywhere
const P = { home: [38.60, -90.80], jenKS: [39.68, -100.30], jenLA: [30.22, -92.66], jenMO: [38.72, -90.26], indy: [39.71, -86.13], kc: [39.10, -94.60], cabin: [38.00, -92.70] };
const DRIVE = { jenMO: 25, jenKS: 470, jenLA: 520, indy: 250, kc: 235, cabin: 140 };
const GEO = q => { q = q.toLowerCase(); // Photon-like answers (best text match first, not nearest)
  if (q.includes('test home')) return ['home'];
  if (q.includes('jennings high school')) return ['jenKS', 'jenLA', 'jenMO'];
  if (q.includes('nicoson')) return []; // the full venue line finds nothing ...
  if (q.includes('1400 e hanna ave')) return ['indy']; // ... the street part does
  if (q.includes('riverside arena')) return ['kc'];
  if (q.includes('lake cabin')) return ['cabin'];
  return []; };
(async () => {
  const B = { webkit: await PW.webkit.launch(), chromium: await PW.chromium.launch({ executablePath: '/usr/bin/google-chrome', args: ['--no-sandbox'] }) };
  const errs = []; let first = true;
  try {
    for (const [name, eng, w, h] of DEV) for (const dark of [false, true]) {
      const tag = `${name}-${dark ? 'dark' : 'light'}`;
      const ctx = await B[eng].newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 2, isMobile: eng === 'chromium', hasTouch: true, colorScheme: dark ? 'dark' : 'light', timezoneId: 'America/Chicago', locale: 'en-US' });
      await ctx.route('**/config.js', r => r.fulfill({ contentType: 'application/javascript', body: "window.CALENDAR_CONFIG = { APP_NAME: 'SANDY', SUPABASE_URL: '', SUPABASE_ANON_KEY: '', OWNER_EMAIL: '' };" }));
      for (const u of ['https://api.weather.gov/**', 'https://*.open-meteo.com/**']) await ctx.route(u, r => r.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: '{"features":[]}' }));
      const geoCalls = [];
      const hdr = { 'access-control-allow-origin': '*' };
      await ctx.route('https://photon.komoot.io/**', r => { const u = new URL(r.request().url()); geoCalls.push({ q: u.searchParams.get('q'), limit: u.searchParams.get('limit') });
        const features = GEO(u.searchParams.get('q') || '').map(k => ({ type: 'Feature', geometry: { type: 'Point', coordinates: [P[k][1], P[k][0]] }, properties: { name: k } }));
        r.fulfill({ status: 200, contentType: 'application/json', headers: hdr, body: JSON.stringify({ type: 'FeatureCollection', features }) }); });
      await ctx.route('https://valhalla1.openstreetmap.de/**', r => { const j = JSON.parse(new URL(r.request().url()).searchParams.get('json')); const d = j.locations[1];
        const k = Object.keys(DRIVE).find(k => Math.abs(P[k][0] - d.lat) < 1e-6 && Math.abs(P[k][1] - d.lon) < 1e-6);
        if (!k) return r.fulfill({ status: 400, contentType: 'application/json', headers: hdr, body: '{"error":"No path"}' });
        r.fulfill({ status: 200, contentType: 'application/json', headers: hdr, body: JSON.stringify({ trip: { summary: { time: DRIVE[k] * 60, length: DRIVE[k] * 0.9 } } }) }); });
      await ctx.addInitScript(d => { if (sessionStorage.getItem('lbs')) return; sessionStorage.setItem('lbs', '1'); localStorage.clear();
        localStorage.setItem('sandy.welcome.off', '1'); localStorage.setItem('sandy.tour.off', '1'); if (d) localStorage.setItem('sandy.theme', 'dark');
        // an old (v1) cache that still holds the Kansas pick must not be used
        localStorage.setItem('sandy.geo.v1', JSON.stringify({ 'jennings high school': { ok: true, lat: 39.68, lon: -100.30, t: Date.now() } })); }, dark);
      const p = await ctx.newPage(); p.on('pageerror', e => errs.push(tag + ': ' + e.message));
      await p.clock.install({ time: new Date('2026-11-17T16:00:00Z') }); // Tue Nov 17 2026, 10:00 AM CT
      await p.goto(BASE + '?tab=today'); await p.waitForFunction(() => window.__app && window.__app.Store && window.SandyNav && window.SandyLeave);
      const ids = await p.evaluate(async () => {
        const S = window.__app.Store; for (const e of await S.list()) { try { await S.remove(e.id); } catch (_) {} }
        await window.SandyLeave.setHome('Test Home');
        const L = window.SandyLeave, o = L.render; L.render = async (...a) => { const r = await o(...a); window.__lb = r; return r; };
        const ev = o => ({ id: crypto.randomUUID(), kind: 'event', allDay: false, recurrence: { freq: 'none' }, notes: '', calendar: 'mam', category: 'Practice', ...o });
        const E = { cabin: ev({ title: 'Team retreat', start: '2026-11-17T13:00', end: '2026-11-17T13:30', location: 'Lake Cabin' }),
          kc: ev({ title: 'Scout game', start: '2026-11-17T15:00', end: '2026-11-17T15:30', location: 'Riverside Arena' }),
          jen: ev({ title: 'Jennings practice', start: '2026-11-17T17:00', end: '2026-11-17T17:30', location: 'Jennings High School' }),
          indy: ev({ title: 'Maryville at UIndy', start: '2026-11-17T19:30', end: '2026-11-17T21:30', location: 'Nicoson Hall (University of Indianapolis), 1400 E Hanna Ave, Indianapolis, IN 46227' }) };
        for (const e of Object.values(E)) await S.save(e);
        window.__app.refresh(); return Object.fromEntries(Object.entries(E).map(([k, v]) => [k, v.id]));
      });
      await p.click('#bottomNav [data-tab=today]').catch(() => {});
      await p.waitForFunction(() => { const l = document.getElementById('tcLeave'); return l && l.querySelectorAll('li').length >= 4 && !l.querySelector('[data-state=pending]') && window.__lb && window.__lb.plans; }, null, { timeout: 15000 });
      await p.waitForTimeout(300);
      const rows = await p.$$eval('#tcLeave li', ls => ls.map(l => ({ state: l.dataset.state, id: (l.querySelector('.tc-item') || {}).dataset?.id, leave: l.dataset.leave || '', text: l.textContent.replace(/\s+/g, ' ').trim(), maps: !!l.querySelector('a.lb-maps'), anim: getComputedStyle(l).animationName })));
      const row = id => rows.find(r => r.id === id) || {};
      ok(row(ids.jen).state === 'ok' && /25 min drive/.test(row(ids.jen).text) && row(ids.jen).leave === '4:25 PM', `${tag}: "Jennings High School" → Jennings, MO (25 min, leave by 4:25 PM), not Kansas`);
      ok(row(ids.indy).state === 'ok' && /4 hr 10 min drive/.test(row(ids.indy).text) && row(ids.indy).leave === '3:10 PM', `${tag}: explicit far away game (Indianapolis, IN) keeps its normal leave-by (3:10 PM)`);
      for (const k of ['kc', 'cabin']) ok(row(ids[k]).state === 'check' && /Check this location/.test(row(ids[k]).text) && !row(ids[k]).leave && row(ids[k]).maps && /Add the city or full address/.test(row(ids[k]).text),
        `${tag}: "${k === 'kc' ? 'Riverside Arena' : 'Lake Cabin'}" (${k === 'kc' ? '>150 mi' : '2 h 20 min drive'}) → "Check this location" + Open in Maps, no leave time`);
      ok(row(ids.kc).anim && row(ids.kc).anim !== 'none', `${tag}: check row eases in like the other Heads Up rows (${row(ids.kc).anim})`);
      const planIds = await p.evaluate(() => window.__lb.plans.map(x => x.c.x.ev.id));
      ok(planIds.includes(ids.jen) && planIds.includes(ids.indy) && !planIds.includes(ids.kc) && !planIds.includes(ids.cabin), `${tag}: no leave-by alarm planned for "Check this location" events`);
      if (first) {
        const cache = await p.evaluate(() => JSON.parse(localStorage.getItem('sandy.geo.v2') || '{}'));
        ok(cache['jennings high school'] && cache['jennings high school'].mi < 150 && !cache['jennings high school'].far, 'geocode cache v2 holds the near Jennings pick (old v1 Kansas entry ignored)');
        ok(cache['riverside arena'] && cache['riverside arena'].far === true, 'a vague place with no match within 150 mi is cached as far');
        ok(geoCalls.length && geoCalls.every(c => c.limit === '5'), 'Photon asked for 5 candidates');
        ok(geoCalls.some(c => /nicoson/i.test(c.q)) && geoCalls.some(c => /^1400 E Hanna Ave/.test(c.q)), 'venue line with no match retries with its street address');
        const helpers = await p.evaluate(() => { const T = window.SandyLeave._test; return ['Jennings High School', 'Gym, Chicago, IL', 'Union University, Jackson, Tennessee', '8850 Cozens Ave', 'Lunch, in Clayton', 'Field 63141'].map(T.explicit); });
        ok(JSON.stringify(helpers) === JSON.stringify([false, true, true, true, false, true]), 'explicit-address detection (state, ZIP, street number; ", in" is not Indiana)');
        const tm = await p.evaluate(async () => { const d = await window.SandyLeave.drive({ kind: 'home', address: 'Test Home' }, 'Riverside Arena'); return d.check === true; });
        ok(tm, 'drive() flags the far vague place for the Tomorrow preview and travel plans');
        first = false;
      }
      await p.evaluate(() => { const t = document.getElementById('toast'); if (t) t.hidden = true; });
      const sec = p.locator('#tcLeave').locator('xpath=ancestor::*[contains(@class,"tc-heads")][1]');
      await sec.scrollIntoViewIfNeeded(); await sec.screenshot({ path: `${SHOTS}/${tag}.png` });
      await ctx.close();
    }
    ok(errs.length === 0, 'no page errors ' + JSON.stringify(errs));
  } finally { await B.webkit.close(); await B.chromium.close(); }
  console.log(`\n${n} checks passed`);
})().catch(e => { console.error(e); process.exit(1); });
