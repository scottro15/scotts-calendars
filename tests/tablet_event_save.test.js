// New / edit / delete events on iPad and Android tablets (t148u: "unable to save a new event on iPad").
//   node tests/tablet_event_save.test.js http://127.0.0.1:8793/        (SHOTS=/dir/ for screenshots)
// Root cause: on tablets the editor is a short centred sheet, so Location sits just above the sticky Save bar.
// Typing a location opened the suggestion list (z-index 20) right over Save (z-index 3); iOS doesn't blur the
// field when you tap elsewhere, so the list stayed open and taps on "Save" landed on the list. Also the on-screen
// keyboard only shrinks the visual viewport (iPad Safari, Android Chrome 108+), leaving Save behind the keyboard.
// Covers: iPad Pro 11 + iPad mini (portrait/landscape), iPad desktop-mode Mac UA (WebKit), Galaxy Tab Samsung
// Internet 800x1280 / 1280x800 (Chromium); iPhone + Android phone regression. Today / tomorrow / other date,
// location list open while tapping Save, list opening upward when there's no room, tap outside closes it,
// keyboard-up editor keeps Save visible, edit + delete.
const PW = require(process.env.PW || '/workspace/shot-tools/node_modules/playwright-core');
const fs = require('fs');
const BASE = process.argv[2] || 'http://127.0.0.1:8793/';
const SHOT = process.env.SHOTS || '/workspace/shots-oct29/ipad-save/'; fs.mkdirSync(SHOT, { recursive: true });
let fails = 0; const assert = (c, m) => { if (!c) { fails++; console.log('FAIL -', m); } else console.log('ok -', m); };
const MAC = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15';
const SAM = 'Mozilla/5.0 (Linux; Android 14; SM-X710) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/26.0 Chrome/122.0.0.0 Safari/537.36';
const REDMI = 'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Mobile Safari/537.36';
const DEV = [
  ['ipad-pro11-portrait', 'webkit', { device: 'iPad Pro 11' }], ['ipad-pro11-landscape', 'webkit', { device: 'iPad Pro 11 landscape' }],
  ['ipad-mini-portrait', 'webkit', { device: 'iPad Mini' }], ['ipad-mini-landscape', 'webkit', { device: 'iPad Mini landscape' }],
  ['ipad-desktop-ua', 'webkit', { w: 1024, h: 1366, ua: MAC }],
  ['galaxy-tab-portrait', 'chromium', { w: 800, h: 1280, ua: SAM }], ['galaxy-tab-landscape', 'chromium', { w: 1280, h: 800, ua: SAM }],
  ['iphone-15', 'webkit', { device: 'iPhone 15' }], ['redmi-chrome', 'chromium', { w: 393, h: 873, ua: REDMI }],
];
const ONLY = process.env.ONLY ? process.env.ONLY.split(',') : null;
const PHOTON = { features: ['Maryville University|650 Maryville University Dr|Town and Country', 'Maryville University Library|610 Maryville University Dr|Town and Country', 'Maryville University Dr||Town and Country', 'Maryville Talent|1 Main St|Maryville', 'Maryville Bowl|2 Main St|Maryville', 'Maryville Park|3 Main St|Maryville']
  .map(s => { const [name, street, city] = s.split('|'); return { properties: { name, street, city, state: 'Missouri', postcode: '63141', countrycode: 'US' } }; }) };

(async () => {
  const br = { webkit: await PW.webkit.launch(), chromium: await PW.chromium.launch({ executablePath: '/usr/bin/google-chrome', headless: true, args: ['--no-sandbox'] }) };
  // each device/theme runs in its own context; three at a time keeps the run under the suite's 240 s cap
  const jobs = [];
  for (const [name, eng, o] of DEV) { if (ONLY && !ONLY.includes(name)) continue; for (const dark of [false, true]) jobs.push([name, eng, o, dark]); }
  const runOne = async ([name, eng, o, dark]) => {
    {
      const N = `[${name}${dark ? ' dark' : ''}]`;
      const dev = o.device ? { ...PW.devices[o.device] } : { viewport: { width: o.w, height: o.h }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, userAgent: o.ua };
      delete dev.defaultBrowserType; if (eng === 'webkit') delete dev.isMobile;
      const ctx = await br[eng].newContext({ ...dev, timezoneId: 'America/Chicago', serviceWorkers: 'block' });
      await ctx.route('https://photon.komoot.io/**', r => r.fulfill({ contentType: 'application/json', body: JSON.stringify(PHOTON) }));
      await ctx.addInitScript(dark => {
        if (!sessionStorage.getItem('__t')) { sessionStorage.setItem('__t', '1'); localStorage.clear(); localStorage.setItem('sandy.welcome.off', '1'); localStorage.setItem('sandy.tour.off', '1'); if (dark) localStorage.setItem('sandy.theme', 'dark'); }
        // stand-in visualViewport so the test can raise an on-screen keyboard
        const real = window.visualViewport; const fake = new EventTarget(); let kb = 0;
        Object.defineProperty(fake, 'height', { get: () => innerHeight - kb }); Object.defineProperty(fake, 'width', { get: () => innerWidth });
        Object.defineProperty(fake, 'offsetTop', { get: () => 0 }); Object.defineProperty(fake, 'offsetLeft', { get: () => 0 }); Object.defineProperty(fake, 'scale', { get: () => 1 });
        try { Object.defineProperty(window, 'visualViewport', { configurable: true, get: () => fake }); } catch (_) {}
        window.__kb = h => { kb = h; fake.dispatchEvent(new Event('resize')); };
        void real;
      }, dark);
      const p = await ctx.newPage(); const errs = []; p.on('pageerror', e => errs.push(e.message));
      await p.goto(BASE); await p.waitForSelector('.fc', { state: 'attached' }); await p.waitForTimeout(900);
      const D = await p.evaluate(() => { const a = __app, t = a.nowWall(), d = n => { const x = new Date(t); x.setUTCDate(x.getUTCDate() + n); return a.ymd(x); }; return { today: d(0), tom: d(1), other: d(9) }; });
      const newBtn = async () => ((await p.$('#railNew')) && await p.$eval('#railNew', e => !!e.offsetParent)) ? '#railNew' : '#addBtn';
      const openNew = async () => { await p.tap(await newBtn()); await p.waitForSelector('#eventDialog[open]'); await p.waitForTimeout(450); };
      const mine = re => p.evaluate(async src => (await __app.Store.list()).filter(e => new RegExp(src).test(e.title)).map(e => ({ id: e.id, t: e.title, s: e.start, loc: e.location })), re.source);
      const saveHit = () => p.evaluate(() => { const b = document.querySelector('#eventForm button[type=submit]'); const r = b.getBoundingClientRect(); const e = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2); return e === b && r.bottom <= visualViewport.height + 1; });
      const tapSave = async () => { await p.tap('#eventForm button[type=submit]', { timeout: 4000 }); await p.waitForTimeout(900); };
      const isOpen = () => p.$eval('#eventDialog', d => d.open);

      await p.evaluate(() => SandyNav.go('today')); await p.waitForTimeout(500);
      // 1) today, title only
      await openNew(); await p.locator('#event-title').tap(); await p.keyboard.type('Tab today');
      await tapSave(); assert(!(await isOpen()) && (await mine(/^Tab today$/)).some(e => e.s.startsWith(D.today)), `${N} new event today saves`);
      // 2) tomorrow with a typed location, list still open when Save is tapped
      await openNew(); await p.locator('#event-title').tap(); await p.keyboard.type('Tab tomorrow');
      await p.fill('input[name=startDate]', D.tom); await p.fill('input[name=startTime]', '15:30'); await p.fill('input[name=endTime]', '17:00');
      await p.locator('#fLocation').tap(); await p.keyboard.type('Maryville Univ'); await p.waitForSelector('.ac-wrap .ac-pop:not([hidden]) li', { timeout: 5000 });
      assert(await saveHit(), `${N} location list open: Save is still visible and on top`);
      const pr = await p.evaluate(() => { const pop = document.querySelector('#eventDialog .ac-wrap .ac-pop'), r = pop.getBoundingClientRect(), f = document.querySelector('#eventDialog .dialog-actions').getBoundingClientRect(); return { up: pop.classList.contains('ac-up'), overlap: r.bottom > f.top + 1 && r.top < f.top }; });
      assert(!pr.overlap, `${N} list doesn't run under the Save bar (opens ${pr.up ? 'upward' : 'downward'})`);
      if (!dark) await p.screenshot({ path: `${SHOT}${name}-location-list-light.png` }); else await p.screenshot({ path: `${SHOT}${name}-location-list-dark.png` });
      await tapSave();
      let got = await mine(/^Tab tomorrow$/);
      assert(!(await isOpen()) && got.length === 1 && got[0].s === D.tom + 'T15:30' && got[0].loc === 'Maryville Univ', `${N} tomorrow 3:30pm saved straight from the open list ${JSON.stringify(got)}`);
      // 3) other date; pick a suggestion first; tap outside closes the list
      await openNew(); await p.locator('#event-title').tap(); await p.keyboard.type('Tab other');
      await p.fill('input[name=startDate]', D.other);
      await p.locator('#fLocation').tap(); await p.keyboard.type('Maryville Univ'); await p.waitForSelector('.ac-wrap .ac-pop:not([hidden]) li');
      await p.locator('#eventDialog h2').tap(); await p.waitForTimeout(250);
      assert(await p.$eval('#eventDialog .ac-wrap .ac-pop', e => e.hidden), `${N} tap outside closes the location list`);
      await p.locator('#fLocation').fill(''); await p.locator('#fLocation').tap(); await p.keyboard.type('Maryville Univ'); await p.waitForSelector('.ac-wrap .ac-pop:not([hidden]) li');
      await p.locator('#eventDialog .ac-wrap .ac-list li').first().tap(); await p.waitForTimeout(300);
      await tapSave(); got = await mine(/^Tab other$/);
      assert(!(await isOpen()) && got.length === 1 && got[0].s.startsWith(D.other) && /650 Maryville/.test(got[0].loc), `${N} other date + picked place saved ${JSON.stringify(got)}`);
      // 4) keyboard up: Save stays reachable above it
      await openNew(); await p.locator('#event-title').tap(); await p.keyboard.type('Tab keyboard');
      const vh = await p.evaluate(() => innerHeight);
      await p.evaluate(h => window.__kb(h), Math.round(vh * 0.42)); await p.waitForTimeout(200);
      assert(await saveHit(), `${N} on-screen keyboard up: Save sits above it`);
      await p.screenshot({ path: `${SHOT}${name}-keyboard-${dark ? 'dark' : 'light'}.png` });
      await tapSave(); await p.evaluate(() => window.__kb(0));
      assert(!(await isOpen()) && (await mine(/^Tab keyboard$/)).length === 1, `${N} saved with the keyboard up`);
      const st = await p.evaluate(() => { const d = document.getElementById('eventDialog'); return d.style.maxHeight + d.style.marginTop; });
      assert(st === '', `${N} editor sizing resets after close`);
      // 5) edit + delete
      const ev = (await mine(/^Tab other$/))[0];
      await p.evaluate(id => __app.openEditor(id), ev.id); await p.waitForSelector('#eventDialog[open]'); await p.waitForTimeout(400);
      await p.fill('#event-title', 'Tab other edited'); await tapSave();
      assert((await mine(/^Tab other edited$/)).length === 1, `${N} edit saves`);
      p.once('dialog', d => d.accept());
      await p.evaluate(id => __app.openEditor(id), ev.id); await p.waitForSelector('#eventDialog[open]'); await p.waitForTimeout(400);
      await p.tap('#deleteBtn'); await p.waitForTimeout(700);
      assert(!(await isOpen()) && !(await mine(/^Tab other edited$/)).length, `${N} delete works`);
      if (!dark) { await openNew(); await p.screenshot({ path: `${SHOT}${name}-editor-light.png` }); await p.tap('#cancelBtn'); }
      else { await openNew(); await p.screenshot({ path: `${SHOT}${name}-editor-dark.png` }); await p.tap('#cancelBtn'); }
      assert(!errs.length, `${N} no page errors ${errs.join(' | ')}`);
      await ctx.close();
    }
  };
  const q = jobs.slice(); await Promise.all([0, 1, 2].map(async () => { while (q.length) await runOne(q.shift()); }));
  await br.webkit.close(); await br.chromium.close();
  console.log(fails ? `${fails} FAILED` : 'TABLET EVENT SAVE TESTS PASSED'); process.exit(fails ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
