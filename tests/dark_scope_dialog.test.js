// Browser test (Scott 2026-10-24 fix4): the "Apply changes to… / Delete…" scope dialog for repeating items
// must have dark backgrounds and readable text in dark mode (incl. focused/hover/active option), light mode unchanged.
//   node tests/dark_scope_dialog.test.js http://127.0.0.1:8787/ [screenshotDir]
const { chromium } = require(process.env.PW || '/workspace/shot-tools/node_modules/playwright-core');
const BASE = process.argv[2] || 'http://127.0.0.1:8787/'; const SHOTS = process.argv[3] || '/workspace/shots-fix4';
const SHOTNAME = process.env.SHOTNAME || 'scope_dark_after'; const EXPECT_FAIL = !!process.env.EXPECT_FAIL;
require('fs').mkdirSync(SHOTS, { recursive: true });
let fails = 0; const assert = (c, m) => { if (!c) { fails++; console.log('FAIL -', m); } else console.log('ok -', m); };
const CONTRAST = `(() => {
  const parse = s => { const m = s.match(/rgba?\\(([\\d.]+),? ([\\d.]+),? ([\\d.]+)/); return [+m[1], +m[2], +m[3]]; };
  const lum = c => { const f = v => { v /= 255; return v <= .03928 ? v / 12.92 : Math.pow((v + .055) / 1.055, 2.4); }; return .2126 * f(c[0]) + .7152 * f(c[1]) + .0722 * f(c[2]); };
  window.__contrast = (fg, bg) => { const a = lum(parse(fg)), b = lum(parse(bg)); return (Math.max(a, b) + .05) / (Math.min(a, b) + .05); };
  window.__lum = s => lum(parse(s));
})()`;
(async () => {
  const b = await chromium.launch({ executablePath: '/usr/bin/google-chrome', headless: true, args: ['--no-sandbox'] });
  const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2, timezoneId: 'America/Chicago' });
  const p = await ctx.newPage(); const errs = []; p.on('pageerror', e => errs.push(e.message));
  await p.goto(BASE); await p.waitForFunction(() => window.SandyNav && document.getElementById('scopeDialog'));
  await p.evaluate(CONTRAST);
  const measure = () => p.evaluate(() => {
    const d = document.getElementById('scopeDialog'); const out = [];
    const bgOf = el => { while (el) { const c = getComputedStyle(el).backgroundColor; if (c !== 'rgba(0, 0, 0, 0)' && !c.endsWith(', 0)')) return c; el = el.parentElement; } return 'rgb(255, 255, 255)'; };
    for (const el of d.querySelectorAll('h2, p:not([hidden]), .scope-opt strong, .scope-opt span, #scopeCancel'))
      if (el.textContent.trim()) out.push({ t: el.textContent.trim().slice(0, 30), c: window.__contrast(getComputedStyle(el).color, bgOf(el)), bg: bgOf(el) });
    return out;
  });
  for (const dark of [false, true]) {
    for (const mode of ['save', 'delete']) {
      await p.evaluate(d => window.SandyNav.setDark(d), dark);
      await p.evaluate(m => { const d = document.getElementById('scopeDialog');
        document.getElementById('scopeTitle').textContent = m === 'delete' ? 'Delete…' : 'Apply changes to…';
        document.getElementById('scopeDesc').textContent = '"Covenant Code study" is a repeating event.';
        document.getElementById('scopeOneSub').textContent = 'Only Sun, Oct 25';
        d.classList.toggle('danger-mode', m === 'delete'); if (!d.open) d.showModal(); document.getElementById('scopeOne').focus(); }, mode);
      await p.waitForTimeout(400); { const r = await p.$eval('#scopeAll', e => { const b = e.getBoundingClientRect(); return [b.x + b.width / 2, b.y + b.height / 2]; }); await p.mouse.move(r[0], r[1]); } await p.waitForTimeout(150);
      const r = await measure(); const tag = `${dark ? 'dark' : 'light'}/${mode}`;
      for (const x of r) assert(x.c >= 4.5, `${tag} "${x.t}" contrast ${x.c.toFixed(2)} >= 4.5`);
      const bgs = await p.$$eval('.scope-opt', els => els.map(e => getComputedStyle(e).backgroundColor));
      if (dark) for (const bg of bgs) assert(await p.evaluate(s => window.__lum(s), bg) < 0.1, `${tag} option background dark (${bg})`);
      else assert(bgs.includes('rgb(255, 255, 255)') || bgs.includes('rgb(239, 246, 255)'), `${tag} light option backgrounds unchanged (${bgs})`);
      if (dark && mode === 'save') await p.screenshot({ path: `${SHOTS}/${SHOTNAME}.png` });
      await p.evaluate(() => document.getElementById('scopeDialog').close()); await p.waitForTimeout(600);
    }
  }
  assert(!errs.length, 'no page errors ' + errs.join(';'));
  await b.close();
  if (EXPECT_FAIL) { console.log(fails ? `expected failures: ${fails}` : 'UNEXPECTED: no failures'); process.exit(fails ? 0 : 1); }
  console.log(fails ? `${fails} FAILED` : 'ALL PASS'); process.exit(fails ? 1 : 0);
})();
