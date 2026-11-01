// Skeleton loading screen (Scott 2026-11-01, t174u): on a first open (no saved copy) shimmering blocks shaped like
// Today / Home / To-Do paint from inline HTML/CSS before the app JS, then cross-fade out as real content shows.
// With saved data there is no skeleton (no flash). Reduced motion: no shimmer, no fade. 4 devices x light/dark, local mode.
//   node tests/skeleton.test.js http://127.0.0.1:8815/ /tmp/shots [device]
const PW = process.env.PW || '/usr/local/lib/pnpm/5/.pnpm/playwright-core@1.59.1/node_modules/playwright-core';
const { chromium, webkit } = require(PW);
const fs = require('fs');
const BASE = process.argv[2] || 'http://127.0.0.1:8815/';
const OUT = process.argv[3] || '/tmp/skeleton';
const only = process.argv[4] || '';
fs.mkdirSync(OUT, { recursive: true });
const DEV = [['iphone', 'webkit', 393, 852], ['ipad', 'webkit', 820, 1180], ['android-phone', 'chromium', 412, 915], ['android-tablet', 'chromium', 800, 1280]];
let n = 0;
const sleep = ms => new Promise(r => setTimeout(r, ms));
(async () => {
  const errs = [];
  const ok = (c, m, tag) => { if (!c) errs.push(tag + ': ' + m); else n++; };
  for (const [name, eng, w, h] of DEV) {
    if (only && name !== only) continue;
    const br = eng === 'webkit' ? await webkit.launch() : await chromium.launch({ executablePath: '/usr/bin/google-chrome', args: ['--no-sandbox'] });
    for (const dark of [false, true]) {
      const tag = `${name}-${dark ? 'dark' : 'light'}`;
      const mk = async (opts = {}) => {
        const ctx = await br.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 2, isMobile: eng === 'chromium', hasTouch: true, serviceWorkers: 'block', timezoneId: 'America/Chicago', colorScheme: dark ? 'dark' : 'light', reducedMotion: opts.reduce ? 'reduce' : 'no-preference' });
        await ctx.route('**/config.js', r => r.fulfill({ contentType: 'application/javascript', body: "window.CALENDAR_CONFIG={APP_NAME:'SANDY',SUPABASE_URL:'',SUPABASE_ANON_KEY:'',OWNER_EMAIL:''};" }));
        let release; const gate = new Promise(r => { release = r; });
        // hold app.js so the page stays "loading" until we have looked at the skeleton
        await ctx.route('**/app.js*', async r => { if (opts.stub) return r.fulfill({ contentType: 'application/javascript', body: '/* app held back for the mid-load screenshot */' }); if (opts.hold) await gate; r.continue(); });
        await ctx.addInitScript(d => { if (sessionStorage.getItem('__i')) return; sessionStorage.setItem('__i', '1'); localStorage.clear(); localStorage.setItem('sandy.welcome.off', '1'); localStorage.setItem('sandy.tour.off', '1'); if (d) localStorage.setItem('sandy.theme', 'dark'); }, dark);
        // record whether a skeleton ever showed and when it went
        await ctx.addInitScript(() => { window.__sk = { seen: false, out: false }; new MutationObserver(() => { const e = document.getElementById('skel'); if (e) { window.__sk.seen = true; if (e.classList.contains('skel-out')) window.__sk.out = true; } }).observe(document, { subtree: true, childList: true, attributes: true, attributeFilter: ['class'] }); });
        const p = await ctx.newPage();
        p.on('pageerror', e => { if (!opts.stub && !/ResizeObserver loop/.test(e.message)) errs.push(tag + ': page error ' + e.message); });
        return { ctx, p, release };
      };
      for (const tab of ['today', 'home', 'todo']) {
        const { ctx, p, release } = await mk({ hold: true });
        p.goto(BASE + '?tab=' + tab).catch(() => {});
        await p.waitForSelector('#skel', { timeout: 15000 }).catch(() => {});
        await sleep(400);
        const s = await p.evaluate(() => {
          const e = document.getElementById('skel'); if (!e) return null; const r = e.getBoundingClientRect(); const tb = document.querySelector('.topbar').getBoundingClientRect();
          const blk = e.querySelector('.sk:not(.sk-nav)'); const nav = e.querySelector('.sk-nav').getBoundingClientRect();
          return { tab: e.dataset.tab, top: r.top, tb: tb.bottom, bottom: r.bottom, vh: innerHeight, w: r.width, vw: innerWidth, z: +getComputedStyle(e).zIndex, bg: getComputedStyle(e).backgroundColor,
            blk: getComputedStyle(blk).backgroundColor, anim: getComputedStyle(blk).animationName, cards: e.querySelectorAll('.sk-card').length, cells: e.querySelectorAll('.sk-cell').length, dots: e.querySelectorAll('.sk-dot').length,
            nav: { w: nav.width, h: nav.height, l: nav.left }, appBooted: !!window.__app, aria: e.getAttribute('aria-hidden') };
        });
        ok(!!s, `${tab}: skeleton shows before the app JS has run`, tag);
        if (s) {
          ok(!s.appBooted, `${tab}: (app not booted yet while the skeleton shows)`, tag);
          ok(s.tab === tab, `${tab}: skeleton shaped for ${tab} (${s.tab})`, tag);
          ok(Math.abs(s.top - s.tb) <= 1 && s.bottom >= s.vh - 1 && s.w >= s.vw - 1, `${tab}: covers the page under the top bar (${s.top} vs ${s.tb})`, tag);
          ok(s.aria === 'true', `${tab}: hidden from screen readers`, tag);
          ok(dark ? s.bg === 'rgb(11, 18, 32)' : s.bg === 'rgb(248, 250, 252)', `${tab}: page colour matches the theme (${s.bg})`, tag);
          ok(dark ? s.blk === 'rgb(28, 38, 56)' : s.blk === 'rgb(229, 231, 235)', `${tab}: block colour matches the theme (${s.blk})`, tag);
          ok(s.anim === 'skel-sh', `${tab}: blocks shimmer (${s.anim})`, tag);
          if (tab === 'home' && w >= 768) ok(s.cells === 35, 'home tablet: month grid shape', tag);
          if (tab === 'todo') ok(s.dots === 5, 'todo: to-do rows with circles', tag);
          if (tab === 'today') ok(s.cards >= 2, 'today: Today cards', tag);
          ok(w >= 768 ? (s.nav.w === 92 && s.nav.l === 0) : (s.nav.h === 60), `${tab}: nav placeholder (${w >= 768 ? 'side rail' : 'bottom bar'})`, tag);
          ok(s.z < 70 && s.z > 60, `${tab}: under the update pill (z ${s.z} < 70), over the nav`, tag);
        }
        release();
        const sel = { today: '#todayBody .tc-summary', home: '#calendar .fc-event', todo: '#todoList .todo-row' }[tab];
        await p.waitForSelector(sel, { timeout: 20000 }).catch(() => {});
        await p.waitForFunction(() => !document.getElementById('skel'), null, { timeout: 5000 }).catch(() => {});
        const after = await p.evaluate(s => ({ gone: !document.getElementById('skel'), faded: window.__sk.out, real: !!document.querySelector(s), on: document.documentElement.classList.contains('skel-on') }), sel);
        ok(after.real, `${tab}: real content shows`, tag);
        ok(after.gone && !after.on, `${tab}: skeleton removed once content is in`, tag);
        ok(after.faded, `${tab}: cross-fades out (not a hard cut)`, tag);
        await p.screenshot({ path: `${OUT}/${tag}-${tab}-2-loaded.png` });
        // mid-load picture: same page with the app script held back (a held script keeps the page "loading", which screenshots wait out)
        { const m = await mk({ stub: true }); await m.p.goto(BASE + '?tab=' + tab); await m.p.waitForSelector('#skel'); await sleep(500);
          await m.p.screenshot({ path: `${OUT}/${tag}-${tab}-1-loading-skeleton.png`, animations: 'disabled' }); await m.ctx.close(); }
        // reopen with the saved copy on this device → no skeleton at all (no flash)
        await p.reload(); await p.waitForSelector(sel, { timeout: 20000 }).catch(() => {}); await sleep(300);
        ok(!(await p.evaluate(() => window.__sk.seen)), `${tab}: no skeleton flash when data is saved on the device`, tag);
        await ctx.close();
      }
      // search / profile never get a skeleton
      { const { ctx, p } = await mk(); await p.goto(BASE + '?tab=search'); await p.waitForFunction(() => window.__app); await sleep(300);
        ok(!(await p.evaluate(() => window.__sk.seen)), 'no skeleton for Search', tag); await ctx.close(); }
      // reduced motion: no shimmer; removed without a fade
      { const { ctx, p, release } = await mk({ hold: true, reduce: true }); p.goto(BASE + '?tab=today').catch(() => {});
        await p.waitForSelector('#skel', { timeout: 15000 }).catch(() => {});
        const a = await p.evaluate(() => { const e = document.getElementById('skel'); return e ? [getComputedStyle(e.querySelector('.sk')).animationName, getComputedStyle(e).animationName] : null; });
        ok(a && a[0] === 'none' && a[1] === 'none', `reduced motion: no shimmer, no fade-in (${a})`, tag);
        release(); await p.waitForSelector('#todayBody .tc-summary', { timeout: 20000 }).catch(() => {});
        ok(await p.evaluate(() => !document.getElementById('skel') && !window.__sk.out), 'reduced motion: removed at once (no fade)', tag);
        await ctx.close(); }
      // never stuck: if no page reports in (e.g. a sign-in screen), "any" ends it
      { const { ctx, p, release } = await mk({ hold: true }); p.goto(BASE + '?tab=home').catch(() => {});
        await p.waitForSelector('#skel', { timeout: 15000 }).catch(() => {});
        await p.evaluate(() => window.SandySkel.ready('today')); await sleep(50);
        ok(await p.evaluate(() => !!document.getElementById('skel')), 'another page reporting in does not end Home\'s skeleton', tag);
        await p.evaluate(() => window.SandySkel.ready('any')); await sleep(400);
        ok(await p.evaluate(() => !document.getElementById('skel')), '"any" (sign-in / welcome) ends it', tag);
        release(); await ctx.close(); }
    }
    await br.close();
  }
  console.log(`${n} checks passed`);
  if (errs.length) { console.log('FAIL\n' + errs.join('\n')); process.exit(1); }
  console.log('PASS');
})().catch(e => { console.error(e); process.exit(1); });
