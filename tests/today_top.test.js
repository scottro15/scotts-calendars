// Browser test: the Today tab always opens at its top (Up next / Heads up / Suggestions), phone + iPad.
//   node tests/today_top.test.js http://127.0.0.1:8766/
// Covers: scrolled Today -> other tab -> Today, scrolled Home -> Today (shared #page-home), reload landing on
// Today, cold start ?tab=today, return from background; and that other tabs also open at the top on reload.
const { chromium } = require(process.env.PW || '/workspace/shot-tools/node_modules/playwright-core');
const BASE = process.argv[2] || 'http://127.0.0.1:8766/';
const assert = (c, m) => { if (!c) throw new Error('FAIL: ' + m); console.log('ok -', m); };
const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';
const IPAD = 'Mozilla/5.0 (iPad; CPU OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';
const ANDROID = 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36';
(async () => {
  const b = await chromium.launch({ executablePath: '/usr/bin/google-chrome', headless: true, args: ['--no-sandbox'] });
  const errs = [];
  for (const [name, w, h, ua] of [['iphone', 390, 844, IPHONE], ['android', 412, 839, ANDROID], ['ipad-portrait', 820, 1180, IPAD], ['ipad-landscape', 1180, 820, IPAD]]) {
    const N = `[${name}]`;
    const ctx = await b.newContext({ viewport: { width: w, height: h }, userAgent: ua, isMobile: true, hasTouch: true, timezoneId: 'America/Chicago' });
    await ctx.addInitScript(() => { if (sessionStorage.getItem('__t')) return; sessionStorage.setItem('__t', '1'); localStorage.clear(); localStorage.setItem('sandy.welcome.off', '1'); localStorage.setItem('sandy.tour.off', '1'); });
    const p = await ctx.newPage(); p.on('pageerror', e => errs.push(e.message));
    await p.goto(BASE); await p.waitForSelector('.fc', { state: 'attached' }); await p.waitForTimeout(800);
    const y = () => p.evaluate(() => Math.round(window.scrollY));
    const down = async () => { await p.evaluate(() => { window.dispatchEvent(new Event('wheel')); window.scrollTo(0, 100000); }); await p.waitForTimeout(200); return y(); };
    const tap = async t => { await p.click(`.bottom-nav button[data-tab="${t}"]`); await p.waitForTimeout(900); };
    await tap('today'); assert(await down() > 0 || w >= 810, `${N} Today scrolled down (${await y()})`);
    await tap('todo'); await tap('today'); assert(await y() === 0, `${N} Today -> To-Do -> Today opens at top`);
    await tap('home'); const hy = await down(); await tap('today');
    assert(await y() === 0, `${N} scrolled Home (${hy}) -> Today opens at top`);
    await p.waitForTimeout(2000); assert(await y() === 0, `${N} ...and stays at top after late content`);
    await down(); await p.reload(); await p.waitForSelector('.fc', { state: 'attached' }); await p.waitForTimeout(2500);
    assert(await p.evaluate(() => document.body.classList.contains('tab-today')) && await y() === 0, `${N} reload landing on Today opens at top`);
    await down(); await p.evaluate(() => { const d = v => Object.defineProperty(document, 'visibilityState', { get: () => v, configurable: true }); d('hidden'); document.dispatchEvent(new Event('visibilitychange')); d('visible'); document.dispatchEvent(new Event('visibilitychange')); });
    await p.waitForTimeout(300); assert(await y() === 0, `${N} return from background on Today -> top`);
    for (const t of ['todo', 'profile']) { await tap(t); await down(); await p.reload(); await p.waitForSelector('.fc', { state: 'attached' }); await p.waitForTimeout(2000); assert(await y() === 0, `${N} reload landing on ${t} opens at top`); }
    await ctx.close();
    const c2 = await b.newContext({ viewport: { width: w, height: h }, userAgent: ua, isMobile: true, hasTouch: true, timezoneId: 'America/Chicago' });
    await c2.addInitScript(() => { localStorage.setItem('sandy.welcome.off', '1'); localStorage.setItem('sandy.tour.off', '1'); });
    const p2 = await c2.newPage(); await p2.goto(BASE + '?tab=today'); await p2.waitForTimeout(3000);
    assert(await p2.evaluate(() => document.body.classList.contains('tab-today') && Math.round(scrollY) === 0), `${N} cold start ?tab=today at top`);
    await c2.close();
  }
  assert(errs.length === 0, 'no page errors ' + errs.join(' | '));
  await b.close();
})().catch(e => { console.error(e.message || e); process.exit(1); });
