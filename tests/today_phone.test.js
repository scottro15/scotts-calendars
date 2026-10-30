// 5c (t150u): phone Today reads top-down: Now/Next, On Today (+ Overdue), Heads Up, then ONE suggestion with
// "More ideas" (opens the rest with the tile ease-in; dismiss × still works; Simple mode hides suggestions).
// No day calendar under Today on phones. Tablets (iPad, Android tablet) unchanged. Light + dark.
//   node tests/today_phone.test.js BASE [SHOTS]
const PW = require(process.env.PW || '/usr/local/lib/pnpm/5/.pnpm/playwright-core@1.59.1/node_modules/playwright-core');
const fs = require('fs');
const BASE = process.argv[2] || 'http://127.0.0.1:8892/';
const SHOTS = process.argv[3] || '/workspace/shots-oct29/today-design/5c';
fs.mkdirSync(SHOTS, { recursive: true });
let n = 0; const ok = (c, m) => { if (!c) throw new Error('FAIL: ' + m); console.log('ok -', m); n++; };
const DEV = [['iphone', 'webkit', 393, 852, true], ['ipad', 'webkit', 820, 1180, false], ['android-phone', 'chromium', 412, 915, true], ['android-tablet', 'chromium', 800, 1280, false]];
const ok200 = (r, body) => r.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify(body) });
(async () => {
  const B = { webkit: await PW.webkit.launch(), chromium: await PW.chromium.launch({ executablePath: '/usr/bin/google-chrome', args: ['--no-sandbox'] }) };
  const errs = [];
  try {
    for (const [name, eng, w, h, phone] of DEV) for (const dark of [false, true]) {
      const tag = `${name}-${dark ? 'dark' : 'light'}`;
      const ctx = await B[eng].newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 2, isMobile: eng === 'chromium', hasTouch: true, colorScheme: dark ? 'dark' : 'light', timezoneId: 'America/Chicago', locale: 'en-US' });
      await ctx.route('**/config.js', r => r.fulfill({ contentType: 'application/javascript', body: "window.CALENDAR_CONFIG = { APP_NAME: 'SANDY', SUPABASE_URL: '', SUPABASE_ANON_KEY: '', OWNER_EMAIL: '' };" }));
      await ctx.route('https://photon.komoot.io/**', r => ok200(r, { features: [{ geometry: { coordinates: [-90.5, 38.6] }, properties: {} }] }));
      await ctx.route('https://valhalla1.openstreetmap.de/**', r => ok200(r, { trip: { summary: { time: 1920, length: 25 } } }));
      await ctx.route('https://api.weather.gov/**', r => ok200(r, { features: [] }));
      await ctx.route('https://api.open-meteo.com/**', r => { const d = new URL(r.request().url()).searchParams.get('start_date'); const time = Array.from({ length: 24 }, (_, h) => `${d}T${String(h).padStart(2, '0')}:00`);
        ok200(r, { hourly: { time, temperature_2m: time.map(() => 50), precipitation_probability: time.map(() => 10), weather_code: time.map(() => 1), wind_speed_10m: time.map(() => 5) } }); });
      await ctx.addInitScript(d => { if (sessionStorage.getItem('tp')) return; sessionStorage.setItem('tp', '1'); localStorage.clear();
        localStorage.setItem('sandy.welcome.off', '1'); localStorage.setItem('sandy.tour.off', '1'); if (d) localStorage.setItem('sandy.theme', 'dark'); }, dark);
      const p = await ctx.newPage(); p.on('pageerror', e => errs.push(tag + ': ' + e.message));
      await p.clock.install({ time: new Date('2026-11-18T00:15:00Z') }); // Tue Nov 17, 6:15 PM CT (evening: Tomorrow shows)
      await p.goto(BASE); await p.waitForFunction(() => window.__app && window.__app.Store && window.SandyNav && window.SandyLeave);
      await p.evaluate(async () => {
        const S = window.__app.Store; if (S.clearExamples) await S.clearExamples(); for (const e of await S.list()) { try { await S.remove(e.id); } catch (_) {} }
        const ev = o => ({ id: crypto.randomUUID(), kind: 'event', allDay: false, recurrence: { freq: 'none' }, location: '', notes: '', calendar: 'mam', category: 'Other', ...o });
        for (const e of [
          ev({ title: 'Maryville University vs Malone University - NEUTRAL', category: 'Game – Maryville University', start: '2026-11-17T19:30', end: '2026-11-17T21:30', location: 'Gym A, Testville, MO' }),
          ev({ title: 'Film with Nick', start: '2026-11-17T18:00', end: '2026-11-17T19:00' }),
          ev({ title: 'Call with Bill', calendar: 'msc', start: '2026-11-17T18:30', end: '2026-11-17T19:15' }),
          ev({ title: 'Jennings HS practice', category: 'Team practice – Jennings High School', start: '2026-11-18T15:00', end: '2026-11-18T17:00' }),
          ev({ title: 'Lift', start: '2026-11-18T07:00', end: '2026-11-18T08:00' }),
          { ...ev({ title: 'Order new bands', kind: 'task', allDay: true, start: '2026-11-15', end: '2026-11-15', category: 'Task / to-do' }), scope: 'day', done: false, completedDates: [] },
        ]) await S.save(e);
        await window.SandyLeave.setHome('1 Test Home Rd, Testville, MO 63000'); window.__app.refresh();
      });
      const today = async () => { await p.evaluate(() => window.SandyNav.go('today')); await p.evaluate(() => window.SandyNav.renderToday()); await p.waitForFunction(() => document.querySelector('#tcSuggestions') && !document.querySelector('#tcLeave [data-state=pending]')); await p.waitForTimeout(500); };
      await today();
      const st = () => p.evaluate(() => {
        const vis = e => !!e && e.getClientRects().length > 0 && getComputedStyle(e).display !== 'none';
        const order = [...document.querySelectorAll('#todayBody .tc-summary, #todayBody section.tc-card')].filter(vis).map(s => [...s.classList].find(c => /^tc-(summary|on|overdue|heads|suggestions|weekly)$/.test(c))).filter(Boolean);
        const sug = document.getElementById('tcSuggestions'), tiles = sug ? [...sug.querySelectorAll('.sug-list > .sug-tile')] : [];
        const more = sug && sug.querySelector('.sug-more');
        const cal = document.getElementById('calendar');
        return { order, tiles: tiles.length, shown: tiles.filter(vis).length, anims: tiles.filter(vis).map(t => getComputedStyle(t).animationName), more: more ? { text: more.textContent.trim(), exp: more.getAttribute('aria-expanded'), h: more.getBoundingClientRect().height } : null,
          cal: vis(cal) && cal.getBoundingClientRect().height > 20, over: document.documentElement.scrollWidth > innerWidth + 1 };
      });
      let s = await st();
      if (phone) {
        ok(JSON.stringify(s.order.slice(0, 5)) === JSON.stringify(['tc-summary', 'tc-on', 'tc-overdue', 'tc-heads', 'tc-suggestions']), `${tag}: order Now/Next → On Today → Overdue → Heads Up → Suggestions (${s.order.join(', ')})`);
        ok(!s.cal, `${tag}: no day calendar under Today`);
        ok(s.tiles >= 3 && s.shown === 1 && s.more && s.more.text === `More ideas (${s.tiles - 1})` && s.more.exp === 'false' && s.more.h >= 44, `${tag}: one suggestion + "${s.more && s.more.text}" (44 px)`);
        await p.locator('#todayCard').screenshot({ path: `${SHOTS}/${tag}.png` });
        await p.click('#tcSuggestions .sug-more'); await p.waitForTimeout(80);
        s = await st();
        ok(s.shown === s.tiles && s.more.text === 'Fewer ideas' && s.more.exp === 'true' && s.anims.slice(1).every(a => a === 'tc-tile-in'), `${tag}: "More ideas" opens all ${s.tiles} with the ease-in`);
        await p.waitForTimeout(300);
        await p.locator('#tcSuggestions').screenshot({ path: `${SHOTS}/${tag}-more.png` });
        await p.evaluate(() => window.SandyNav.renderToday()); await p.waitForTimeout(400);
        ok((await st()).shown === s.tiles, `${tag}: stays open across the 1-minute re-render`);
        await p.click('#tcSuggestions .sug-more'); await p.waitForTimeout(80);
        ok((await st()).shown === 1, `${tag}: "Fewer ideas" goes back to one`);
        const before = (await st()).tiles;
        await p.click('#tcSuggestions .sug-list > .sug-tile:first-child .sug-x'); await p.waitForTimeout(450);
        s = await st();
        ok(s.tiles === before - 1 && s.shown === 1 && (s.tiles > 1 ? s.more.text === `More ideas (${s.tiles - 1})` : !s.more), `${tag}: dismiss × shows the next idea (${s.more ? s.more.text : 'no more button'})`);
        await p.evaluate(() => { window.SandySimple.set(true); window.SandyNav.renderToday(); }); await p.waitForTimeout(500);
        s = await st();
        ok(!s.order.includes('tc-suggestions') && s.order[1] === 'tc-on', `${tag}: Simple mode: no suggestions, On Today second`);
        await p.evaluate(() => { window.SandySimple.set(false); window.SandyNav.renderToday(); }); await p.waitForTimeout(300);
      } else {
        ok(s.order.indexOf('tc-heads') < s.order.indexOf('tc-on') || s.order.indexOf('tc-heads') === -1 ? true : false, `${tag}: tablet keeps its layout (${s.order.join(', ')})`);
        ok(s.shown === s.tiles && !s.more, `${tag}: tablet shows all ${s.tiles} suggestions, no "More ideas"`);
        await p.screenshot({ path: `${SHOTS}/${tag}.png` });
      }
      ok(!s.over, `${tag}: no sideways overflow`);
      await ctx.close();
    }
    ok(errs.length === 0, 'no page errors ' + JSON.stringify(errs));
  } finally { await B.webkit.close(); await B.chromium.close(); }
  console.log(`\n${n} checks passed`);
})().catch(e => { console.error(e); process.exit(1); });
