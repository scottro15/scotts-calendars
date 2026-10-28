// Welcome note: platform-specific install steps (t143u). iPhone → Safari Share steps; Android Chrome
// (incl. Redmi / Xiaomi) → Install card / ⋮ menu; Samsung Internet (phone + Galaxy Tab, incl. its desktop
// "X11; Linux" tablet UA) → install icon / ☰ → Add page to → Home screen; Mi Browser → open in Chrome;
// desktop / unknown → both. "Install SANDY now" appears only when the browser offers an install prompt.
//   node tests/welcome_platform.test.js http://127.0.0.1:8766/   (env SHOTS=dir for light/dark screenshots)
const { chromium } = require(process.env.PW || '/workspace/shot-tools/node_modules/playwright-core');
const BASE = process.argv[2] || 'http://127.0.0.1:8766/'; const SHOTS = process.env.SHOTS || '';
const assert = (c, m) => { if (!c) throw new Error('FAIL: ' + m); console.log('ok -', m); };
const UA = {
  iphone: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1',
  ipadDesk: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15',
  pixel: 'Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36',
  redmi: 'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Mobile Safari/537.36',
  redmiFull: 'Mozilla/5.0 (Linux; Android 14; 23117RA68G Build/UP1A.231005.007) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Mobile Safari/537.36',
  miui: 'Mozilla/5.0 (Linux; U; Android 14; en-us; 23117RA68G Build/UP1A.231005.007) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/112.0.5615.136 Mobile Safari/537.36 XiaoMi/MiuiBrowser/14.9.0-gn',
  samsungPhone: 'Mozilla/5.0 (Linux; Android 14; SAMSUNG SM-S921B) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/26.0 Chrome/122.0.0.0 Mobile Safari/537.36',
  samsungTab: 'Mozilla/5.0 (Linux; Android 14; SM-X710) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/26.0 Chrome/122.0.0.0 Safari/537.36',
  samsungTabDesk: 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/26.0 Chrome/122.0.0.0 Safari/537.36',
  firefoxAndroid: 'Mozilla/5.0 (Android 14; Mobile; rv:131.0) Gecko/131.0 Firefox/131.0',
  macChrome: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36',
  winEdge: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36 Edg/130.0.0.0',
  cros: 'Mozilla/5.0 (X11; CrOS x86_64 14541.0.0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36',
  linuxDesk: 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36',
};
(async () => {
  const b = await chromium.launch({ executablePath: '/usr/bin/google-chrome', headless: true, args: ['--no-sandbox'] }); const errs = [];
  const mk = async (ua, { w = 393, h = 873, dpr = 2.75, mobile = true, dark = false } = {}) => {
    const ctx = await b.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: dpr, userAgent: ua, isMobile: mobile, hasTouch: mobile, timezoneId: 'America/Chicago', serviceWorkers: 'block', reducedMotion: 'reduce' });
    await ctx.addInitScript(d => { if (sessionStorage.getItem('__t')) return; sessionStorage.setItem('__t', '1'); localStorage.clear(); localStorage.setItem('sandy.welcome.off', '1'); localStorage.setItem('sandy.tour.off', '1'); if (d) localStorage.setItem('sandy.theme', 'dark'); }, dark);
    const p = await ctx.newPage(); p.on('pageerror', e => errs.push(e.message)); await p.goto(BASE); await p.waitForSelector('.fc', { state: 'attached' }); await p.waitForTimeout(600); return { ctx, p };
  };
  // 1) pure detection (no touch for desktop UAs, touch for phones/tablets)
  { const { ctx, p } = await mk(UA.pixel);
    const cases = [['iphone', 5, '', 'ios'], ['ipadDesk', 5, 'MacIntel', 'ios'], ['pixel', 5, 'Linux armv8l', 'android'], ['redmi', 5, 'Linux armv8l', 'android'], ['redmiFull', 5, 'Linux armv8l', 'android'],
      ['miui', 5, 'Linux armv8l', 'mi'], ['samsungPhone', 5, 'Linux armv8l', 'samsung'], ['samsungTab', 10, 'Linux armv8l', 'samsung'], ['samsungTabDesk', 10, 'Linux x86_64', 'samsung'],
      ['firefoxAndroid', 5, 'Linux armv8l', 'android'], ['macChrome', 0, 'MacIntel', 'other'], ['winEdge', 0, 'Win32', 'other'], ['cros', 10, 'Linux x86_64', 'other'], ['linuxDesk', 0, 'Linux x86_64', 'other']];
    for (const [k, t, pl, want] of cases) assert(await p.evaluate(([u, t, pl]) => SandyWelcome.platform(u, t, pl), [UA[k], t, pl]) === want, `platform(${k}) = ${want}`);
    await ctx.close(); }
  // 2) rendered note per device
  const R = [
    ['redmi-chrome', UA.redmi, {}, 'android', [/in Chrome/, /Install SANDY/, /⋮/, /Add to Home screen/, /not from Chrome/], [/Safari/, /Samsung/]],
    ['pixel-chrome', UA.pixel, { w: 412, h: 915, dpr: 2.625 }, 'android', [/⋮/, /Add to Home screen/], [/Safari/]],
    ['samsung-tab-portrait', UA.samsungTab, { w: 800, h: 1280, dpr: 2 }, 'samsung', [/Samsung Internet/, /install icon/, /☰/, /Add page to/, /Home screen/], [/Safari/, /⋮/]],
    ['samsung-tab-desktop-ua', UA.samsungTabDesk, { w: 1280, h: 800, dpr: 2 }, 'samsung', [/Add page to/], [/Safari/]],
    ['mi-browser', UA.miui, {}, 'mi', [/Open SANDY in Chrome/, /Mi Browser can't install/], [/Safari/]],
    ['iphone', UA.iphone, { w: 390, h: 844, dpr: 3 }, 'ios', [/Open SANDY in Safari and tap Share, then Add to Home Screen\./, /not from Safari/], [/Chrome/, /⋮/, /Samsung/]],
    ['desktop', UA.macChrome, { w: 1280, h: 800, dpr: 1, mobile: false }, 'other', [/iPhone:/, /Safari/, /Android:/, /⋮/, /Add page to/], []],
  ];
  for (const [name, ua, o, pf, yes, no] of R) for (const dark of [false, true]) {
    const N = `[${name}${dark ? ' dark' : ''}]`; const { ctx, p } = await mk(ua, { ...o, dark });
    await p.evaluate(() => SandyWelcome.show({ user: { id: 'u1', email: 'tester@example.com' } })); await p.waitForSelector('#welcomeSheet'); await p.waitForTimeout(300);
    const r = await p.evaluate(() => { const s = document.querySelector('#welcomeSheet .wl-steps'); return { pf: s.dataset.platform, n: s.children.length, txt: s.textContent.replace(/\s+/g, ' '), inst: !document.querySelector('.wl-install-now').hidden }; });
    assert(r.pf === pf && r.n === 4, `${N} steps for ${pf} (4 steps)`);
    for (const re of yes) assert(re.test(r.txt), `${N} mentions ${re}`);
    for (const re of no) assert(!re.test(r.txt), `${N} does not mention ${re}`);
    assert(!r.inst, `${N} no "Install SANDY now" without a browser install prompt`);
    if (SHOTS && ['redmi-chrome', 'samsung-tab-portrait', 'mi-browser', 'iphone', 'desktop'].includes(name)) await p.screenshot({ path: `${SHOTS}/welcome-${name}-${dark ? 'dark' : 'light'}.png` });
    await ctx.close();
  }
  // 3) "Install SANDY now" when Chrome offered beforeinstallprompt → closes the note, opens the install prompt
  { const { ctx, p } = await mk(UA.redmi);
    await p.evaluate(() => { const e = new Event('beforeinstallprompt', { cancelable: true }); e.prompt = () => { window.__prompted = (window.__prompted || 0) + 1; return Promise.resolve(); }; e.userChoice = Promise.resolve({ outcome: 'dismissed' }); window.dispatchEvent(e); });
    await p.evaluate(() => SandyWelcome.show({ user: { id: 'u2' } })); await p.waitForSelector('#welcomeSheet');
    assert(await p.$eval('.wl-install-now', e => !e.hidden), '[redmi] "Install SANDY now" shown when Chrome can install');
    if (SHOTS) await p.screenshot({ path: `${SHOTS}/welcome-redmi-chrome-install-now-light.png` });
    await p.tap('.wl-install-btn'); await p.waitForTimeout(700);
    assert(!(await p.$('#welcomeSheet')) && await p.evaluate(() => window.__prompted === 1), '[redmi] tapping it closes the note and opens the install prompt');
    assert(await p.evaluate(() => !!localStorage.getItem('sandy.welcome.v1:u2')), '[redmi] still counted as seen (shown once)');
    await ctx.close(); }
  assert(errs.length === 0, 'no page errors ' + errs.join(' | ')); await b.close(); console.log('ALL PASS');
})().catch(e => { console.error(e); process.exit(1); });
