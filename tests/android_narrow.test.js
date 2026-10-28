// No page is wider than a 360px Android phone (Galaxy S/A series) or a 320px iPhone SE (t143u).
// Profile's "Default view" select ("Season (Month + Season briefing)") widened the page to 380px, so Chrome
// zoomed the whole Profile tab out on 360px phones.   node tests/android_narrow.test.js http://127.0.0.1:8766/
const { chromium } = require(process.env.PW || '/workspace/shot-tools/node_modules/playwright-core');
const BASE = process.argv[2] || 'http://127.0.0.1:8766/';
const assert = (c, m) => { if (!c) throw new Error('FAIL: ' + m); console.log('ok -', m); };
const UA = { samsung: 'Mozilla/5.0 (Linux; Android 14; SAMSUNG SM-S921B) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/26.0 Chrome/122.0.0.0 Mobile Safari/537.36',
  iphone: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1' };
(async () => {
  const b = await chromium.launch({ executablePath: '/usr/bin/google-chrome', headless: true, args: ['--no-sandbox'] }); const errs = [];
  for (const [name, w, ua] of [['galaxy-360', 360, UA.samsung], ['iphone-se-320', 320, UA.iphone]]) for (const dark of [false, true]) {
    const ctx = await b.newContext({ viewport: { width: w, height: 760 }, deviceScaleFactor: 3, userAgent: ua, isMobile: true, hasTouch: true, timezoneId: 'America/Chicago', serviceWorkers: 'block' });
    await ctx.addInitScript(d => { if (sessionStorage.getItem('__t')) return; sessionStorage.setItem('__t', '1'); localStorage.clear(); localStorage.setItem('sandy.welcome.off', '1'); localStorage.setItem('sandy.tour.off', '1'); if (d) localStorage.setItem('sandy.theme', 'dark'); }, dark);
    const p = await ctx.newPage(); p.on('pageerror', e => errs.push(e.message)); await p.goto(BASE); await p.waitForSelector('.fc', { state: 'attached' }); await p.waitForTimeout(800);
    for (const t of ['home', 'today', 'todo', 'search', 'profile']) {
      await p.evaluate(t => SandyNav.go(t), t); await p.waitForTimeout(600);
      const r = await p.evaluate(() => ({ iw: innerWidth, sw: document.documentElement.scrollWidth }));
      assert(r.iw === w && r.sw <= w, `[${name}${dark ? ' dark' : ''}] ${t}: page fits (${r.sw}px in ${w}px, layout ${r.iw}px)`);
    }
    await p.evaluate(() => { document.getElementById('defaultView').value = 'season'; });
    const dv = await p.$eval('#defaultView', e => e.getBoundingClientRect().right);
    assert(dv <= w, `[${name}${dark ? ' dark' : ''}] long "Season" choice stays on screen`);
    await ctx.close();
  }
  assert(errs.length === 0, 'no page errors ' + errs.join(' | ')); await b.close(); console.log('ALL PASS');
})().catch(e => { console.error(e); process.exit(1); });
