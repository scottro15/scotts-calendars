// Profile → Sandy Intelligence: labels/notes must not overlap; switch stays clear at 320–430px.
//   node tests/si_profile_spacing.test.js http://127.0.0.1:8780/ /workspace/shots-fix-si-spacing
const { chromium } = require(process.env.PW || '/usr/local/lib/pnpm/5/.pnpm/playwright-core@1.59.1/node_modules/playwright-core');
const fs = require('fs');
const BASE = process.argv[2] || 'http://127.0.0.1:8780/';
const SHOTS = process.argv[3] || '/workspace/shots-fix-si-spacing';
fs.mkdirSync(SHOTS, { recursive: true });
const assert = (c, m) => { if (!c) throw new Error('FAIL: ' + m); console.log('ok -', m); };
let n = 0; const ok = (c, m) => { assert(c, m); n++; };

(async () => {
  const b = await chromium.launch({ executablePath: '/usr/bin/google-chrome', headless: true, args: ['--no-sandbox'] });
  for (const [w, dark, tag] of [[320, false, '320-light'], [390, false, '390-light'], [390, true, '390-dark'], [430, false, '430-light']]) {
    const ctx = await b.newContext({
      viewport: { width: w, height: 900 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true,
      colorScheme: dark ? 'dark' : 'light',
    });
    await ctx.route('**/config.js', r => r.fulfill({
      contentType: 'application/javascript',
      body: "window.CALENDAR_CONFIG = { APP_NAME: 'SANDY', SUPABASE_URL: '', SUPABASE_ANON_KEY: '', OWNER_EMAIL: '' };",
    }));
    await ctx.addInitScript(d => {
      localStorage.clear();
      localStorage.setItem('sandy.welcome.off', '1');
      localStorage.setItem('sandy.tour.off', '1');
      if (d) { localStorage.setItem('sandy.theme', 'dark'); document.documentElement.classList.add('dark'); }
    }, dark);
    const p = await ctx.newPage();
    await p.goto(BASE);
    await p.waitForFunction(() => window.__app);
    await p.click('#bottomNav [data-tab=profile]');
    await p.waitForSelector('#siSection');
    await p.locator('#siSection').scrollIntoViewIfNeeded();
    await p.waitForTimeout(120);
    await p.locator('#siSection').screenshot({ path: `${SHOTS}/live-${tag}.png` });
    const info = await p.evaluate(() => [...document.querySelectorAll('#siSection label.pf-row')].map(r => {
      const lbl = r.querySelector('.pf-lbl'), note = r.querySelector('.pf-note'), sw = r.querySelector('.switch');
      const lb = lbl.getBoundingClientRect(), nb = note.getBoundingClientRect(), sb = sw.getBoundingClientRect();
      return {
        title: lbl.textContent.trim(),
        sameLine: Math.abs(lb.top - nb.top) < 4,
        gap: nb.top - lb.bottom,
        underSwitch: nb.right > sb.left + 2 && nb.bottom > sb.top + 4 && nb.top < sb.bottom - 4,
      };
    }));
    ok(info.length >= 6, `${tag}: ${info.length} SI toggle rows`);
    for (const r of info) {
      ok(!r.sameLine, `${tag}/${r.title}: stacked`);
      ok(r.gap >= 2, `${tag}/${r.title}: gap ${r.gap.toFixed(1)}px`);
      ok(!r.underSwitch, `${tag}/${r.title}: clear of switch`);
    }
    await ctx.close();
  }
  console.log(`\n${n} checks passed`);
  await b.close();
})().catch(e => { console.error(e); process.exit(1); });
