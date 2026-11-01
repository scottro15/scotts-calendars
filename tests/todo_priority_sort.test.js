// To-Do priority order (Scott 2026-11-01): rows stay grouped by calendar/category; inside each group P1 → P2 → P3 →
// no priority; same priority → dated first by earliest date/time, then undated A–Z (case-insensitive). Done rows keep
// going last; sub-tasks stay under their parent; By period uses the same order; a priority change re-sorts with a
// short slide (none with reduced motion). 4 devices x light/dark, local mode.
//   node tests/todo_priority_sort.test.js http://127.0.0.1:8793/ /tmp/shots [device]
const PW = process.env.PW || '/usr/local/lib/pnpm/5/.pnpm/playwright-core@1.59.1/node_modules/playwright-core';
const { chromium, webkit } = require(PW);
const fs = require('fs');
const BASE = process.argv[2] || 'http://127.0.0.1:8793/';
const OUT = process.argv[3] || '/tmp/priosort';
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
      await p.goto(BASE); await p.waitForFunction(() => window.__app && window.SandyQuickSheet && window.SandyNav);
      // the example: 2x P1, 1x P3, 3x none in Minds Above Matters; a P1/P2/none trio in MSC
      await p.evaluate(async () => {
        const a = __app, now = a.nowWall(), t = a.ymd(now), tm = a.ymd(a.addDays(now, 1)), nx = a.ymd(a.addDays(now, 3));
        const q = o => SandyNav.saveQuick({ kind: 'todo', date: null, time: null, ...o });
        await q({ raw: 'zeta call', priority: 1, calendar: 'mam', date: tm, time: '10:00' });
        await q({ raw: 'alpha plan', priority: 1, calendar: 'mam', description: 'outline first\n- [ ] Draft\n- [ ] Review' });
        await q({ raw: 'Report', priority: 3, calendar: 'mam' });
        await q({ raw: 'Banana bread', calendar: 'mam' });
        await q({ raw: 'apple pie', calendar: 'mam' });
        await q({ raw: 'Cherry pick', calendar: 'mam', date: nx, time: null });
        await q({ raw: 'A task', calendar: 'msc' });
        await q({ raw: 'b task', priority: 2, calendar: 'msc', date: t, time: '15:00' });
        await q({ raw: 'C task', priority: 1, calendar: 'msc' });
      });
      await p.evaluate(() => document.querySelector('#bottomNav [data-tab=todo]').click()); await p.waitForTimeout(800);
      const group = label => p.evaluate(l => { const g = [...document.querySelectorAll('#todoList .todo-group')].find(s => s.querySelector('h3').textContent.trim().startsWith(l)); return g ? [...g.querySelectorAll(':scope > ul > .todo-row')].map(r => r.querySelector('.td-title').textContent.trim()) : null; }, label);
      const mam = await group('Minds Above Matters');
      ok(JSON.stringify(mam) === JSON.stringify(['zeta call', 'alpha plan', 'Report', 'Cherry pick', 'apple pie', 'Banana bread']), 'MAM: P1 dated, P1 undated, P3, none dated, none A–Z ' + JSON.stringify(mam), tag);
      const msc = (await group('MSC')).filter(t => /task$/.test(t));
      ok(JSON.stringify(msc) === JSON.stringify(['C task', 'b task', 'A task']), 'MSC: P1, P2, none ' + JSON.stringify(msc), tag);
      ok(await p.evaluate(() => { const r = [...document.querySelectorAll('.todo-row')].find(x => x.querySelector('.td-title').textContent === 'alpha plan'); return r && r.querySelectorAll('.td-sub').length === 2 && [...r.querySelectorAll('.td-sub-text')].map(s => s.textContent).join() === 'Draft,Review'; }), 'sub-tasks stay under their parent', tag);
      ok(await p.evaluate(() => { const gs = [...document.querySelectorAll('#todoList .todo-group h3')].map(h => h.textContent.trim()); return gs.filter(g => g.startsWith('Minds Above Matters')).length === 1 && gs.filter(g => g.startsWith('MSC')).length === 1; }), 'each calendar stays one group', tag);
      await p.evaluate(() => { const g = [...document.querySelectorAll('#todoList .todo-group')].find(s => s.querySelector('h3').textContent.includes('Minds Above Matters')); g.scrollIntoView({ block: 'start' }); window.scrollBy(0, -70); }); await p.waitForTimeout(300);
      await p.screenshot({ path: `${OUT}/${tag}-1-sorted-by-priority.png` });

      // group by Date: same order inside "No date"
      await p.selectOption('#todoGroup', 'date'); await p.waitForTimeout(500);
      const nod = (await group('No date')).filter(t => /^(alpha plan|Report|Banana bread|apple pie|A task|C task)$/.test(t));
      ok(JSON.stringify(nod) === JSON.stringify(['alpha plan', 'C task', 'Report', 'A task', 'apple pie', 'Banana bread']), 'Date grouping: No date sorted P1 A–Z, P3, none A–Z ' + JSON.stringify(nod), tag);
      await p.selectOption('#todoGroup', 'calendar'); await p.waitForTimeout(500);

      // done rows still go last in their group
      await p.check('#todoShowDone'); await p.waitForTimeout(300);
      await p.evaluate(() => { const r = [...document.querySelectorAll('.todo-row')].find(x => x.querySelector('.td-title').textContent === 'zeta call'); r.querySelector('.td-check').click(); });
      await p.waitForTimeout(1200);
      const mamDone = await group('Minds Above Matters');
      ok(mamDone[mamDone.length - 1] === 'zeta call' && mamDone[0] === 'alpha plan', 'done P1 moves to the bottom of its group ' + JSON.stringify(mamDone), tag);
      await p.uncheck('#todoShowDone'); await p.waitForTimeout(400);

      // edit: Banana bread → P1 re-sorts, with a slide
      await p.evaluate(() => { const r = [...document.querySelectorAll('.todo-row')].find(x => x.querySelector('.td-title').textContent === 'Banana bread'); r.querySelector('.td-title').click(); });
      await p.waitForTimeout(700);
      await p.evaluate(() => { window.__anims = 0; const lst = document.getElementById('todoList'); const mo = new MutationObserver(() => { requestAnimationFrame(() => { window.__anims = Math.max(window.__anims, [...lst.querySelectorAll('.todo-row')].filter(r => r.getAnimations().some(a => a.effect && a.effect.getKeyframes().some(k => /translateY/.test(k.transform || '')))).length); }); }); mo.observe(lst, { childList: true }); });
      await p.selectOption('#qsPri', '1'); await p.waitForTimeout(150);
      await p.evaluate(() => SandyQuickSheet.close()); await p.waitForTimeout(1200);
      const mam2 = await group('Minds Above Matters');
      ok(JSON.stringify(mam2) === JSON.stringify(['alpha plan', 'Banana bread', 'Report', 'Cherry pick', 'apple pie']), 'edited to P1 → sorted among P1s, A–Z ' + JSON.stringify(mam2), tag);
      ok(await p.evaluate(() => window.__anims) > 0, 'rows slide to their new places', tag);
      await p.evaluate(() => { const g = [...document.querySelectorAll('#todoList .todo-group')].find(s => s.querySelector('h3').textContent.includes('Minds Above Matters')); g.scrollIntoView({ block: 'start' }); window.scrollBy(0, -70); }); await p.waitForTimeout(300);
      await p.screenshot({ path: `${OUT}/${tag}-2-after-edit-resorted.png` });

      // new task re-sorts in: a new P2 lands between the P1s and the P3
      await p.evaluate(() => SandyQuickSheet.open()); await p.waitForTimeout(400);
      await p.locator('#qsText').fill('Mid priority thing'); await p.selectOption('#qsPri', '2');
      await p.selectOption('#qsCal', 'mam').catch(() => {});
      await p.click('#qsSend'); await p.waitForTimeout(900); await p.evaluate(() => SandyQuickSheet.close()); await p.waitForTimeout(600);
      const mam3 = await group('Minds Above Matters');
      ok(mam3 && mam3.indexOf('Mid priority thing') === 2, 'new P2 slots in after the P1s ' + JSON.stringify(mam3), tag);

      // By period (Home/Today card) uses the same order
      const bp = await p.evaluate(async () => { const t = __app.ymd(__app.nowWall()); for (const [title, pr] of [['zz none', 4], ['mm p2', 2], ['aa p1', 1]]) await __app.Store.save({ id: 'bp' + pr, kind: 'task', title, calendar: 'msc', allDay: true, start: t, end: t, recurrence: { freq: 'none', interval: 1 }, scope: 'day', ...(pr < 4 ? { priority: pr } : {}) }); document.querySelector('#scopeTabs [data-scope=day]').click(); await new Promise(r => setTimeout(r, 900)); document.getElementById('periodTasks').scrollIntoView({ block: 'center' }); return [...document.querySelectorAll('#taskList li')].map(l => l.textContent).filter(t => /^.*(aa p1|mm p2|zz none)/.test(t)).map(t => t.match(/aa p1|mm p2|zz none/)[0]); });
      ok(JSON.stringify(bp) === JSON.stringify(['aa p1', 'mm p2', 'zz none']), 'By period: P1, P2, none ' + JSON.stringify(bp), tag);
      await p.screenshot({ path: `${OUT}/${tag}-3-by-period.png` });

      // reduced motion: no slide
      await p.emulateMedia({ reducedMotion: 'reduce' });
      await p.evaluate(() => SandyNav.go('todo')); await p.waitForTimeout(700);
      const still = await p.evaluate(async () => { const r = [...document.querySelectorAll('.todo-row')].find(x => x.querySelector('.td-title').textContent === 'Report'); r.querySelector('.td-title').click(); await new Promise(z => setTimeout(z, 600)); const s = document.getElementById('qsPri'); s.value = '1'; s.dispatchEvent(new Event('change', { bubbles: true })); SandyQuickSheet.close(); await new Promise(z => setTimeout(z, 900)); return [...document.querySelectorAll('#todoList .todo-row')].filter(x => x.getAnimations().some(a => a.effect && a.effect.getKeyframes().some(k => /translateY/.test(k.transform || '')))).length; });
      ok(still === 0, 'reduced motion: no slide', tag);
      await ctx.close();
    }
    await br.close();
  }
  console.log(`${n} checks passed`);
  if (errs.length) { console.log('FAIL\n' + errs.join('\n')); process.exit(1); }
  console.log('PASS');
})().catch(e => { console.error(e); process.exit(1); });
