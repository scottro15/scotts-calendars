// To-Do search bar (Scott 2026-11-01): replaces the one-line "Jot a to-do or note…" box. Searches to-dos and notes
// by title, description and sub-task text; the list filters live while typing with matches <mark>ed; clear (x);
// Escape clears; "/" focuses it; empty state; a matching sub-task shows even when its list is folded; the query is
// never saved. 4 devices x light/dark, local mode.
//   node tests/todo_search.test.js http://127.0.0.1:8793/ /tmp/shots [device]
const PW = process.env.PW || '/usr/local/lib/pnpm/5/.pnpm/playwright-core@1.59.1/node_modules/playwright-core';
const { chromium, webkit } = require(PW);
const fs = require('fs');
const BASE = process.argv[2] || 'http://127.0.0.1:8793/';
const OUT = process.argv[3] || '/tmp/todosearch';
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
      await p.evaluate(async () => {
        const a = __app, t = a.ymd(a.nowWall()), tm = a.ymd(a.addDays(a.nowWall(), 1));
        await SandyNav.saveQuick({ raw: 'Buy groceries', kind: 'todo', description: 'milk and eggs\n- [ ] Bananas\n- [x] Coffee beans', date: null });
        await SandyNav.saveQuick({ raw: 'Gift ideas for Sam', kind: 'note', description: 'Lego set, coffee mug', date: null });
        await SandyNav.saveQuick({ raw: 'Call the dentist', kind: 'todo', description: 'ask about cleaning', date: t, time: null });
        await SandyNav.saveQuick({ raw: 'Pay rent', kind: 'todo', date: tm, time: null });
      });
      await p.evaluate(() => document.querySelector('#bottomNav [data-tab=todo]').click()); await p.waitForTimeout(700);
      const rows = () => p.evaluate(() => [...document.querySelectorAll('#todoList .todo-row')].map(r => r.querySelector('.td-title').textContent));
      const type = async q => { await p.fill('#todoSearch', q); await p.waitForTimeout(350); };

      // --- the jot box is gone, the search bar is there
      const sb = await p.evaluate(() => { const i = document.getElementById('todoSearch'), b = document.getElementById('todoSearchBox').getBoundingClientRect(), l = document.getElementById('todoList').getBoundingClientRect(); return { jot: !!document.querySelector('#quickAdd, #qaText, #qaPreview'), type: i.type, ph: i.placeholder, fs: parseFloat(getComputedStyle(i).fontSize), xHidden: document.getElementById('todoSearchClear').hidden, inCol: b.left >= l.left - 1 && b.right <= l.right + 1 && b.width > 200, overflow: document.scrollingElement.scrollWidth > innerWidth + 1, h: b.height }; });
      ok(!sb.jot, 'jot box removed', tag);
      ok(sb.type === 'search' && sb.ph === 'Search to-dos', 'search input + placeholder ' + sb.ph, tag);
      ok(sb.fs >= 16, 'font >= 16px (no iOS zoom) ' + sb.fs, tag);
      ok(sb.xHidden, 'clear (x) hidden while empty', tag);
      ok(sb.inCol && !sb.overflow && sb.h >= 40, 'fits the list column, no sideways scroll ' + JSON.stringify(sb), tag);
      const all0 = (await rows()).length;
      ok(all0 >= 4, 'all rows before searching ' + all0, tag);
      await p.screenshot({ path: `${OUT}/${tag}-0-search-bar.png` });

      // --- live filter: sub-task + description matches, highlighted
      await p.click('#todoSearch'); await p.keyboard.type('coffee', { delay: 30 }); await p.waitForTimeout(350);
      const r1 = await rows();
      ok(JSON.stringify(r1.sort()) === JSON.stringify(['Buy groceries', 'Gift ideas for Sam']), 'coffee → sub-task + note desc matches ' + JSON.stringify(r1), tag);
      const m1 = await p.evaluate(() => ({ sub: [...document.querySelectorAll('.td-sub-text mark.td-hit')].map(m => m.textContent), desc: [...document.querySelectorAll('.td-desc mark.td-hit')].map(m => m.textContent), count: document.getElementById('todoCount').textContent, x: !document.getElementById('todoSearchClear').hidden, focus: document.activeElement.id }));
      ok(m1.sub.join() === 'Coffee' && m1.desc.join() === 'coffee', 'matches highlighted ' + JSON.stringify(m1), tag);
      ok(m1.count === '2 matches', 'count shows matches ' + m1.count, tag);
      ok(m1.x && m1.focus === 'todoSearch', 'clear (x) shows; focus stays in the box while typing', tag);
      ok(await p.evaluate(() => { const li = [...document.querySelectorAll('.td-sub')].find(l => /Coffee/.test(l.textContent)); return li && !li.hidden && !li.closest('.td-subwrap').classList.contains('folded'); }), 'matching (done) sub-task visible', tag);
      const bg = await p.evaluate(() => getComputedStyle(document.querySelector('mark.td-hit')).backgroundColor);
      ok(dark ? bg === 'rgb(133, 77, 14)' : bg === 'rgb(253, 230, 138)', 'highlight colour for theme ' + bg, tag);
      await p.screenshot({ path: `${OUT}/${tag}-1-search-coffee.png` });

      // title, multi-word, case-insensitive
      await type('DENT'); ok(JSON.stringify(await rows()) === '["Call the dentist"]' && await p.evaluate(() => document.querySelector('.td-title mark.td-hit').textContent === 'dent'), 'title match, case-insensitive', tag);
      await type('eggs   milk'); ok(JSON.stringify(await rows()) === '["Buy groceries"]', 'all words must match (any order)', tag);
      ok(await p.evaluate(() => [...document.querySelectorAll('.td-desc mark')].map(m => m.textContent).join()) === 'milk,eggs', 'each word highlighted', tag);
      await type('<b>'); ok((await rows()).length === 0 && !(await p.$('#todoList b')), 'markup in the query is plain text', tag);

      // --- empty state
      await type('zzzz');
      const es = await p.evaluate(() => { const e = document.querySelector('#todoList .todo-nomatch'); return e && e.textContent; });
      ok(es && es.includes('No to-dos or notes match “zzzz”') && /Show done/.test(es), 'empty state message ' + es, tag);
      ok(await p.evaluate(() => document.getElementById('todoCount').textContent) === '0 matches', '0 matches', tag);
      await p.screenshot({ path: `${OUT}/${tag}-2-no-matches.png` });

      // --- clear (x) and Escape
      await p.click('#todoSearchClear'); await p.waitForTimeout(350);
      ok((await rows()).length === all0 && await p.inputValue('#todoSearch') === '' && await p.evaluate(() => document.getElementById('todoSearchClear').hidden && /open/.test(document.getElementById('todoCount').textContent)), 'clear restores the full list', tag);
      ok(await p.evaluate(() => document.activeElement.id) === 'todoSearch', 'clear keeps focus in the box', tag);
      await type('pay rent'); ok((await rows()).length === 1, 'pay rent → 1', tag);
      await p.press('#todoSearch', 'Escape'); await p.waitForTimeout(350);
      ok((await rows()).length === all0 && await p.inputValue('#todoSearch') === '', 'Escape clears', tag);

      // --- folded sub-tasks open for a match, fold state kept
      const gid = await p.evaluate(() => document.querySelector('.todo-row[data-inbox] .td-fold').closest('.todo-row').dataset.inbox);
      await p.click(`[data-inbox="${gid}"] .td-fold`); await p.waitForTimeout(300);
      ok(await p.evaluate(id => document.querySelector(`[data-inbox="${id}"] .td-subwrap`).classList.contains('folded'), gid), 'folded', tag);
      await type('banana');
      ok(await p.evaluate(id => !document.querySelector(`[data-inbox="${id}"] .td-subwrap`).classList.contains('folded'), gid), 'match opens folded sub-tasks', tag);
      await p.click('#todoSearchClear'); await p.waitForTimeout(350);
      ok(await p.evaluate(id => document.querySelector(`[data-inbox="${id}"] .td-subwrap`).classList.contains('folded'), gid), 'fold kept after clearing', tag);
      await p.click(`[data-inbox="${gid}"] .td-fold`); await p.waitForTimeout(200);

      // --- ticking while searching keeps the query; filter chips + search combine
      await type('dentist');
      await p.click('#todoList .td-check'); await p.waitForTimeout(800);
      ok(await p.inputValue('#todoSearch') === 'dentist', 'query kept after ticking', tag);
      ok(await p.evaluate(() => !!document.querySelector('#todoList .todo-nomatch')), 'done row drops out (Show done off) → empty state', tag);
      await p.check('#todoShowDone'); await p.waitForTimeout(400);
      ok(JSON.stringify(await rows()) === '["Call the dentist"]', 'Show done + search', tag);
      await p.uncheck('#todoShowDone'); await p.waitForTimeout(300);
      await p.evaluate(() => document.querySelector('#todoFilter [data-f=inbox]').click()); await p.waitForTimeout(300);
      await type('pay'); ok(!!(await p.$('#todoList .todo-nomatch')), 'Inbox chip + search: dated rent not shown', tag);
      await p.evaluate(() => document.querySelector('#todoFilter [data-f=all]').click()); await p.waitForTimeout(300);
      ok(JSON.stringify(await rows()) === '["Pay rent"]', 'All chip + search', tag);
      ok(await p.evaluate(() => !/"q"/.test(localStorage.getItem('sandy.todoUI') || '')), 'query not saved', tag);

      // --- tapping a match opens it; "/" shortcut; still works after leaving and coming back
      await p.click('#todoList .td-title'); await p.waitForTimeout(500);
      ok(await p.evaluate(() => { const s = document.getElementById('qsSheet'); return s && s.classList.contains('open') && document.getElementById('qsText').value === 'Pay rent'; }), 'tapping a match opens it to edit', tag);
      await p.evaluate(() => SandyQuickSheet.close && SandyQuickSheet.close()); await p.waitForTimeout(400);
      await p.click('#todoSearchClear'); await p.waitForTimeout(300);
      await p.evaluate(() => document.activeElement && document.activeElement.blur());
      await p.keyboard.press('/'); await p.waitForTimeout(100);
      ok(await p.evaluate(() => document.activeElement.id) === 'todoSearch' && await p.inputValue('#todoSearch') === '', '"/" focuses search', tag);
      ok(!!(await p.$('#todoFab')) && await p.isVisible('#todoFab'), '+ still there to add', tag);
      await ctx.close();
    }
    await br.close();
  }
  console.log(`${n} checks passed`);
  if (errs.length) { console.log('FAIL\n' + errs.join('\n')); process.exit(1); }
  console.log('PASS');
})().catch(e => { console.error(e); process.exit(1); });
