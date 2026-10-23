// Browser test (mobile): cancelled long-press drag -> one tap opens the editor; scope dialog text is near-black.
//   node tests/scope_dialog_tap_readable.test.js http://127.0.0.1:8793/ [screenshotDir]   (copy served with an empty config.js)
const { chromium } = require(process.env.PW || '/workspace/shot-tools/node_modules/playwright-core');
const BASE = process.argv[2] || 'http://127.0.0.1:8793/'; const SHOTS = process.argv[3];
const assert = (c, m) => { if (!c) { throw new Error('FAIL: ' + m); } console.log('ok -', m); };
(async () => {
  const b = await chromium.launch({ executablePath: '/usr/bin/google-chrome', headless: true, args: ['--no-sandbox'] });
  const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, timezoneId: 'America/Chicago', isMobile: true, hasTouch: true });
  await ctx.route('**/config.js', r => r.fulfill({ contentType: 'application/javascript', body: 'window.CALENDAR_CONFIG = {};' }));
  const p = await ctx.newPage(); const errs = []; p.on('pageerror', e => errs.push(e.message));
  await p.clock.install({ time: new Date('2026-10-23T15:00:00Z') });
  await p.goto(BASE + '?view=timeGridDay'); await p.waitForSelector('.fc-timegrid-event'); await p.waitForTimeout(800);
  const cdp = await ctx.newCDPSession(p); const T = (type, x, y) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: type === 'touchEnd' ? [] : [{ x, y }] });
  for (let round = 1; round <= 2; round++) {
    const r = await p.evaluate(() => { const e = document.querySelector('#calendar .fc-timegrid-event'); e.scrollIntoView({ block: 'center' }); const r = e.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + 15 }; });
    await p.waitForTimeout(200);
    await T('touchStart', r.x, r.y); await p.waitForTimeout(1150); for (let k = 1; k <= 5; k++) { await T('touchMove', r.x - k * 4, r.y + k * 12); await p.waitForTimeout(30); } await T('touchEnd'); await p.waitForTimeout(600);
    assert(await p.evaluate(() => document.getElementById('scopeDialog').open), `round ${round}: scope dialog shown`);
    if (round === 1) {
      const cols = await p.evaluate(() => ['#scopeTitle', '#scopeDesc', '#scopeOne strong', '#scopeOneSub', '#scopeAll strong', '#scopeAllSub', '#scopeCancel'].map(s => getComputedStyle(document.querySelector(s)).color));
      assert(cols.every(c => c === 'rgb(17, 17, 17)'), 'all dialog text is #111: ' + cols.join(' '));
      if (SHOTS) await p.screenshot({ path: `${SHOTS}/26_scope_dialog_readable_mobile.png` });
      await p.keyboard.press('Escape');
    } else await p.click('#scopeCancel');
    await p.waitForTimeout(500);
    await p.tap('#calendar .fc-timegrid-event >> nth=0'); await p.waitForTimeout(600);
    assert(await p.evaluate(() => document.getElementById('eventDialog').open), `round ${round}: single tap after cancelled drag opens editor`);
    await p.evaluate(() => document.getElementById('eventDialog').close()); await p.waitForTimeout(300);
  }
  assert(errs.length === 0, 'no page errors ' + errs.join('|'));
  await b.close();
})().catch(e => { console.error(e.message); process.exit(1); });
