// 5a (t150u): the Sandy Intelligence explainer moved off Today into Profile → "What Sandy can do" (collapsed, opens with a small fade).
//   node tests/si_cando.test.js BASE [SHOTS]   (iPhone + iPad on WebKit, Android phone + tablet on Chromium; light + dark)
const PW = require(process.env.PW || '/usr/local/lib/pnpm/5/.pnpm/playwright-core@1.59.1/node_modules/playwright-core');
const fs = require('fs');
const BASE = process.argv[2] || 'http://127.0.0.1:8793/';
const SHOTS = process.argv[3] || '/workspace/shots-oct29/today-design/5a';
fs.mkdirSync(SHOTS, { recursive: true });
let n = 0; const ok = (c, m) => { if (!c) throw new Error('FAIL: ' + m); console.log('ok -', m); n++; };
const DEV = [['iphone', 'webkit', 393, 852], ['ipad', 'webkit', 820, 1180], ['android-phone', 'chromium', 412, 915], ['android-tablet', 'chromium', 800, 1280]];
(async () => {
  const B = { webkit: await PW.webkit.launch(), chromium: await PW.chromium.launch({ executablePath: '/usr/bin/google-chrome', args: ['--no-sandbox'] }) };
  const errs = [];
  try {
    for (const [name, eng, w, h] of DEV) for (const dark of [false, true]) {
      const tag = `${name}-${dark ? 'dark' : 'light'}`;
      const ctx = await B[eng].newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 2, isMobile: eng === 'chromium', hasTouch: true, colorScheme: dark ? 'dark' : 'light' });
      await ctx.route('**/config.js', r => r.fulfill({ contentType: 'application/javascript', body: "window.CALENDAR_CONFIG = { APP_NAME: 'SANDY', SUPABASE_URL: '', SUPABASE_ANON_KEY: '', OWNER_EMAIL: '' };" }));
      await ctx.addInitScript(d => { localStorage.setItem('sandy.welcome.off', '1'); localStorage.setItem('sandy.tour.off', '1'); if (d) localStorage.setItem('sandy.theme', 'dark'); }, dark);
      const p = await ctx.newPage(); p.on('pageerror', e => errs.push(tag + ': ' + e.message));
      await p.goto(BASE + '?tab=today'); await p.waitForFunction(() => window.__app && window.SandyNav);
      await p.waitForTimeout(400);
      ok(await p.evaluate(() => !document.getElementById('todayNudges') && !/Sandy Intelligence/.test(document.getElementById('todayCard').textContent)), `${tag}: Today no longer shows the explainer`);
      await p.click('#bottomNav [data-tab=profile]'); await p.waitForSelector('#siCanDo');
      await p.locator('#siCanDo').scrollIntoViewIfNeeded();
      const closed = await p.evaluate(() => { const d = document.getElementById('siCanDo'), s = d.querySelector('summary').getBoundingClientRect(); return { open: d.open, h: s.height, txt: d.querySelector('summary').textContent.trim(), inSi: !!d.closest('#siSection') }; });
      ok(!closed.open && closed.inSi && /What Sandy can do/.test(closed.txt) && closed.h >= 44, `${tag}: Profile → Sandy Intelligence has "What Sandy can do", closed, tap target ${closed.h}px`);
      await p.click('#siCanDo summary'); await p.waitForTimeout(350);
      const open = await p.evaluate(() => { const d = document.getElementById('siCanDo'), l = d.querySelector('.si-cando-list'), r = l.getBoundingClientRect(), sec = document.getElementById('siSection').getBoundingClientRect();
        return { open: d.open, items: l.querySelectorAll('li').length, vis: r.height > 100, fits: r.right <= sec.right + 0.5 && d.scrollWidth <= d.clientWidth + 1, anim: getComputedStyle(l).animationName, leave: /Leave by/.test(l.textContent) && /Travel plan/.test(l.textContent) }; });
      ok(open.open && open.items === 8 && open.vis && open.fits && open.leave, `${tag}: opens to the 8 features, no sideways overflow`);
      ok(open.anim === 'siCanDoIn', `${tag}: opens with the small fade-in`);
      await p.locator('#siSection').screenshot({ path: `${SHOTS}/${tag}.png` });
      await p.click('#siCanDo summary'); await p.waitForTimeout(150);
      ok(await p.evaluate(() => !document.getElementById('siCanDo').open), `${tag}: closes again`);
      await ctx.close();
    }
    ok(errs.length === 0, 'no page errors ' + JSON.stringify(errs));
  } finally { await B.webkit.close(); await B.chromium.close(); }
  console.log(`\n${n} checks passed`);
})().catch(e => { console.error(e); process.exit(1); });
