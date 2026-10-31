// To-Do list shows sub-tasks under their parent (Todoist project view, Scott 2026-10-31): fold arrow on the count
// (remembered per device), tick from the list (saves + count updates), tap opens the parent's task view,
// "Hide completed" shared with the task view. 4 devices x light/dark.
//   node tests/todo_subrows.test.js http://127.0.0.1:8793/ /tmp/shots
const PW = process.env.PW || '/usr/local/lib/pnpm/5/.pnpm/playwright-core@1.59.1/node_modules/playwright-core';
const { chromium, webkit } = require(PW);
const fs = require('fs');
const BASE = process.argv[2] || 'http://127.0.0.1:8793/';
const OUT = process.argv[3] || '/tmp/subrows';
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
      const toTodo = async () => { await p.waitForFunction(() => window.__app && window.SandyQuickSheet && window.SandyNav); await p.evaluate(() => document.querySelector('#bottomNav [data-tab=todo]').click()); await p.waitForTimeout(700); };
      await p.goto(BASE); await toTodo();
      const ids = await p.evaluate(async () => {
        const a = __app, t = a.ymd(a.nowWall());
        const r1 = await SandyNav.saveQuick({ raw: 'Pack for the tournament', kind: 'todo', priority: 1, reminders: [], description: 'Leave by 7\n- [ ] Uniforms\n- [ ] Water bottles\n- [ ] Snacks for the bus ride home after the late game', date: t, time: '18:00' });
        const r2 = await SandyNav.saveQuick({ raw: 'Plan the team lunch', kind: 'todo', description: '- [ ] Pick a date\n- [ ] Book the room' });
        await SandyNav.renderTodo(); return { ev: r1.ev.id, ib: r2.item.id };
      });
      const row = `[data-ev="${ids.ev}"]`, irow = `[data-inbox="${ids.ib}"]`;
      await p.evaluate(r => { document.querySelector(r).scrollIntoView({ block: 'start' }); window.scrollBy(0, -80); }, row); await p.waitForTimeout(200);
      const g = await p.evaluate(r => { const el = document.querySelector(r); const t = el.querySelector('.td-title').getBoundingClientRect(), c = el.querySelector('.td-check').getBoundingClientRect(); const s = [...el.querySelectorAll('.td-sub')].map(x => x.getBoundingClientRect()); return { n: s.length, subL: s[0] && s[0].left, titleL: t.left, checkL: c.left, ok: s.every(x => x.height > 10) }; }, row);
      ok(g.n === 3 && g.ok && g.subL >= g.titleL - 1 && g.subL > g.checkL + 10, 'sub-tasks listed + indented under the parent ' + JSON.stringify(g), tag);
      // tick from the list
      await p.locator(`${row} .td-sub-check`).first().click(); await p.waitForTimeout(500);
      const t1 = await p.evaluate(async ({ r, id }) => { const ev = await __app.Store.get(id); const nk = __app.noteKeyFor(ev, null); return { cnt: document.querySelector(r + ' .td-subs-n').textContent, checks: await __app.Store.checks.get(nk.eventId, nk.date), aria: document.querySelector(r + ' .td-sub-check').getAttribute('aria-checked') }; }, { r: row, id: ids.ev });
      ok(t1.cnt === '1/3' && JSON.stringify(t1.checks) === '["uniforms"]' && t1.aria === 'true', 'list tick saves + count updates ' + JSON.stringify(t1), tag);
      await p.locator(`${irow} .td-sub-check`).nth(1).click(); await p.waitForTimeout(500);
      const ib = await p.evaluate(async id => (await SandyNav.Inbox.list()).find(x => x.id === id).body, ids.ib);
      ok(ib === 'Plan the team lunch\n- [ ] Pick a date\n- [x] Book the room', 'inbox jot tick saved inline ' + JSON.stringify(ib), tag);
      ok(await p.evaluate(r => document.querySelector(r + ' .td-subs-n').textContent, irow) === '1/2', 'inbox count 1/2', tag);
      await p.evaluate(r => { document.querySelector(r).scrollIntoView({ block: 'start' }); window.scrollBy(0, -80); }, irow); await p.waitForTimeout(250);
      await p.screenshot({ path: `${OUT}/${tag}-1-expanded.png` });
      // collapse (remembered after reload)
      await p.locator(`${row} .td-fold`).click(); await p.waitForTimeout(450);
      const c1 = await p.evaluate(r => { const el = document.querySelector(r); return { f: el.querySelector('.td-subwrap').classList.contains('folded'), h: el.querySelector('.td-subwrap').getBoundingClientRect().height, ex: el.querySelector('.td-fold').getAttribute('aria-expanded') }; }, row);
      ok(c1.f && c1.h < 1 && c1.ex === 'false', 'collapse folds the sub-tasks ' + JSON.stringify(c1), tag);
      await p.evaluate(r => { document.querySelector(r).scrollIntoView({ block: 'start' }); window.scrollBy(0, -160); }, row); await p.waitForTimeout(200);
      await p.screenshot({ path: `${OUT}/${tag}-2-collapsed.png` });
      await p.reload(); await toTodo();
      const c2 = await p.evaluate(r => { const el = document.querySelector(r); return el && el.querySelector('.td-subwrap').classList.contains('folded') && el.querySelector('.td-subs-n').textContent; }, row);
      ok(c2 === '1/3', 'collapsed state + count kept after reload ' + c2, tag);
      await p.locator(`${row} .td-fold`).click(); await p.waitForTimeout(450);
      ok(await p.evaluate(r => document.querySelector(r + ' .td-subwrap').getBoundingClientRect().height > 60, row), 'expand again', tag);
      // tap a sub-task -> parent's task view
      await p.locator(`${row} .td-sub-text`).nth(1).click();
      await p.waitForFunction(() => SandyQuickSheet.editing); await p.waitForTimeout(400);
      const sv = await p.evaluate(() => ({ t: document.getElementById('qsText').value, subs: [...document.querySelectorAll('.qs-sub')].map(x => x.classList.contains('done')) }));
      ok(sv.t === 'Pack for the tournament' && JSON.stringify(sv.subs) === '[true,false,false]', 'tap opens the parent task view ' + JSON.stringify(sv), tag);
      // tablet pane stays open beside the list: a list tick follows into the open task view
      if (name.includes('ipad') || name.includes('tablet')) {
        await p.locator(`${row} .td-sub-check`).nth(1).click(); await p.waitForTimeout(500);
        ok(await p.evaluate(() => document.querySelectorAll('.qs-sub.done').length) === 2, 'list tick follows into the open pane', tag);
        await p.locator(`${row} .td-sub-check`).nth(1).click(); await p.waitForTimeout(500);
      }
      // Hide completed (shared)
      await p.click('#qsSubsHide'); await p.waitForTimeout(400);
      ok(await p.evaluate(r => document.querySelector(r + ' .td-sub[data-sk="uniforms"]').hidden, row), 'Hide completed hides done sub-tasks in the list', tag);
      if (await p.locator('#qsClose').isVisible()) await p.click('#qsClose'); else await p.click('#qsPaneClose');
      await p.waitForFunction(() => !SandyQuickSheet.isOpen); await p.waitForTimeout(500);
      await p.locator(`${row} .td-sub:not([hidden]) .td-sub-check`).first().click(); await p.waitForTimeout(600); // ticks "water bottles" -> slides away
      const hd = await p.evaluate(r => ({ vis: [...document.querySelectorAll(r + ' .td-sub')].filter(x => !x.hidden).map(x => x.dataset.sk), cnt: document.querySelector(r + ' .td-subs-n').textContent }), row);
      ok(hd.cnt === '2/3' && JSON.stringify(hd.vis) === '["snacks for the bus ride home after the late game"]', 'tick with Hide completed: count 2/3, row slides away ' + JSON.stringify(hd), tag);
      await p.evaluate(r => { document.querySelector(r).scrollIntoView({ block: 'start' }); window.scrollBy(0, -80); }, row); await p.waitForTimeout(200);
      await p.screenshot({ path: `${OUT}/${tag}-3-hide-completed.png` });
      await p.evaluate(() => SandyNav.SubUI.hideDone = false);
      await ctx.close();
    }
    await br.close();
  }
  if (errs.length) { console.error('FAIL:\n' + errs.join('\n')); process.exit(1); }
  console.log(`TODO SUB-ROWS PASSED (${n} checks)`);
})().catch(e => { console.error(e); process.exit(1); });
