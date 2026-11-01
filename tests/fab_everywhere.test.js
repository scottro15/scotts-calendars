// One floating + on every page but Profile (Scott 2026-11-01): the header "+ New" is gone; on To-Do the + opens the
// to-do sheet, on Home/Today/Search it opens the new-event editor on the day being viewed. It never covers the nav /
// tablet sidebar or Today's Up next, honours safe areas, and the other "new" paths (rail New, ?new=event) still work.
//   node tests/fab_everywhere.test.js http://127.0.0.1:8812/ /tmp/shots [device]
const PW = process.env.PW || '/usr/local/lib/pnpm/5/.pnpm/playwright-core@1.59.1/node_modules/playwright-core';
const { chromium, webkit } = require(PW);
const fs = require('fs');
const BASE = process.argv[2] || 'http://127.0.0.1:8793/';
const OUT = process.argv[3] || '/tmp/fabeverywhere';
const only = process.argv[4] || '';
fs.mkdirSync(OUT, { recursive: true });
const DEV = [['iphone', 'webkit', 393, 852], ['ipad', 'webkit', 820, 1180], ['android-phone', 'chromium', 412, 915], ['android-tablet', 'chromium', 800, 1280]];
let n = 0;
(async () => {
  const errs = [];
  const ok = (c, m, tag) => { if (!c) errs.push(tag + ': ' + m); else n++; };
  for (const [name, eng, w, h] of DEV) {
    if (only && name !== only) continue;
    const br = eng === 'webkit' ? await webkit.launch() : await chromium.launch({ executablePath: '/usr/bin/google-chrome', args: ['--no-sandbox'] });
    for (const dark of [false, true]) {
      const tag = `${name}-${dark ? 'dark' : 'light'}`;
      const ctx = await br.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 2, isMobile: eng === 'chromium', hasTouch: true, serviceWorkers: 'block', timezoneId: 'America/Chicago', colorScheme: dark ? 'dark' : 'light' });
      await ctx.route('**/config.js', r => r.fulfill({ contentType: 'application/javascript', body: "window.CALENDAR_CONFIG={APP_NAME:'SANDY',SUPABASE_URL:'',SUPABASE_ANON_KEY:'',OWNER_EMAIL:''};" }));
      await ctx.addInitScript(d => { if (sessionStorage.getItem('__i')) return; sessionStorage.setItem('__i', '1'); localStorage.clear(); localStorage.setItem('sandy.welcome.off', '1'); localStorage.setItem('sandy.tour.off', '1'); if (d) localStorage.setItem('sandy.theme', 'dark'); }, dark);
      const p = await ctx.newPage();
      p.on('pageerror', e => { if (!/ResizeObserver loop/.test(e.message)) errs.push(tag + ': page error ' + e.message); });
      p.on('dialog', d => d.accept());
      await p.goto(BASE); await p.waitForFunction(() => window.__app && window.SandyQuickSheet && window.SandyNav); await p.waitForTimeout(500);
      const go = async t => { await p.evaluate(t => SandyNav.go(t), t); await p.waitForTimeout(700); };
      const geo = () => p.evaluate(() => {
        const f = document.getElementById('todoFab'), cs = getComputedStyle(f), r = f.getBoundingClientRect();
        const hit = el => { if (!el || !el.offsetParent && getComputedStyle(el).position !== 'fixed') return false; const q = el.getBoundingClientRect(); if (!q.width || !q.height) return false; return !(r.right <= q.left || r.left >= q.right || r.bottom <= q.top || r.top >= q.bottom); };
        return { vis: cs.display !== 'none' && r.width > 0 && cs.visibility !== 'hidden', label: f.getAttribute('aria-label'), inView: r.right <= innerWidth && r.bottom <= innerHeight && r.left >= 0,
          nav: hit(document.getElementById('bottomNav')), upnext: [...document.querySelectorAll('.tc-upnext')].some(hit),
          header: !!document.querySelector('#addBtn') && document.getElementById('addBtn').getBoundingClientRect().width > 0,
          safe: /safe-area-inset-bottom/.test([...document.styleSheets].flatMap(s => { try { return [...s.cssRules]; } catch (_) { return []; } }).filter(x => x.selectorText && /todo-fab/.test(x.selectorText) && x.style && x.style.bottom).map(x => x.style.bottom).join(' ')) };
      });
      const closeEditor = async () => { await p.keyboard.press('Escape'); await p.waitForTimeout(500); };
      const editorDate = () => p.evaluate(() => { const d = document.getElementById('eventDialog'); return d.open ? d.querySelector('input[name=startDate]').value : null; });
      const today = await p.evaluate(() => __app.ymd(__app.nowWall()));
      for (const t of ['home', 'today', 'todo', 'search']) {
        await go(t); const g = await geo();
        ok(g.vis && g.inView, `+ shows on ${t}`, tag);
        ok(!g.header, `no header "+ New" on ${t}`, tag);
        ok(!g.nav, `+ clear of the nav / sidebar on ${t}`, tag);
        ok(!g.upnext, `+ clear of Up next on ${t}`, tag);
        ok(g.label === (t === 'todo' ? 'Add task' : 'New event'), `+ label on ${t}: ${g.label}`, tag);
        if (t === 'home') ok(g.safe, '+ position uses the safe-area inset', tag);
        await p.screenshot({ path: `${OUT}/${tag}-${t}.png` });
      }
      await go('profile'); ok(!(await geo()).vis, 'no + on Profile', tag);
      // To-Do → to-do sheet
      await go('todo'); await p.click('#todoFab'); await p.waitForTimeout(450);
      ok(await p.evaluate(() => SandyQuickSheet.isOpen && !document.getElementById('eventDialog').open), 'To-Do + opens the to-do sheet', tag);
      await p.keyboard.press('Escape'); await p.waitForTimeout(450);
      // Today / Search → editor on today
      for (const t of ['today', 'search']) {
        await go(t); await p.click('#todoFab'); await p.waitForTimeout(500);
        const d = await editorDate(); ok(d === today, `${t} + opens the event editor on today (${d})`, tag);
        ok(!(await p.evaluate(() => SandyQuickSheet.isOpen)), `${t} + does not open the to-do sheet`, tag);
        if (t === 'today') await p.screenshot({ path: `${OUT}/${tag}-editor-from-today.png` });
        await closeEditor();
      }
      // Home showing another month → editor on that month's first day
      await go('home');
      await p.evaluate(async () => { document.querySelector(".fc-next-button").click(); await new Promise(r => setTimeout(r, 400)); });
      await p.click('#todoFab'); await p.waitForTimeout(500);
      const hd = await editorDate(); ok(hd && hd > today, `Home + opens the editor on the viewed (next) period (${hd})`, tag);
      await p.screenshot({ path: `${OUT}/${tag}-editor-from-home.png` });
      await closeEditor();
      // other paths still work: rail New (tablets), ?new=event
      if (await p.evaluate(() => { const b = document.getElementById('railNew'); return !!(b && b.offsetParent); })) {
        await go('today'); await p.click('#railNew'); await p.waitForTimeout(500);
        ok(!!(await editorDate()), 'rail New still opens the editor', tag); await closeEditor();
      }
      await p.goto(BASE + '?new=event'); await p.waitForFunction(() => window.__app && window.SandyNav); await p.waitForTimeout(1200);
      ok(!!(await editorDate()), '?new=event shortcut still opens the editor', tag); await closeEditor();
      // reduced motion: no entry animation
      await p.emulateMedia({ reducedMotion: 'reduce' }); await go('today');
      ok(await p.evaluate(() => { const n = getComputedStyle(document.getElementById('todoFab')).animationName; return n === 'none' || parseFloat(getComputedStyle(document.getElementById('todoFab')).animationDuration) <= 0.001; }), 'reduced motion: + appears without animating', tag);
      await ctx.close();
    }
    await br.close();
  }
  console.log(`${n} checks passed`);
  if (errs.length) { console.log('FAIL\n' + errs.join('\n')); process.exit(1); }
  console.log('PASS');
})().catch(e => { console.error(e); process.exit(1); });
