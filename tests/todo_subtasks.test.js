// To-Do like Todoist's Inbox (Scott 2026-10-31): full multi-line descriptions in the list, multi-line quick-add
// description, task view (edit) with a sideways chip row and sub-tasks (add / tick / rename / reorder / delete, count
// in the list), Inbox jots keep ticks inline, repeating to-dos keep their series start. 4 devices x light/dark.
//   node tests/todo_subtasks.test.js http://127.0.0.1:8793/ /tmp/shots
const PW = process.env.PW || '/usr/local/lib/pnpm/5/.pnpm/playwright-core@1.59.1/node_modules/playwright-core';
const { chromium, webkit } = require(PW);
const fs = require('fs');
const BASE = process.argv[2] || 'http://127.0.0.1:8793/';
const OUT = process.argv[3] || '/tmp/tt';
const only = process.argv[4] || '';
fs.mkdirSync(OUT, { recursive: true });
const DEV = [['iphone', 'webkit', 393, 852], ['ipad', 'webkit', 820, 1180], ['android-phone', 'chromium', 412, 915], ['android-tablet', 'chromium', 800, 1280]];
const LONG = 'Pick up the order at the side door, not the front.\nBring the blue folder with:\n• last month\'s receipts\n• the signed waiver\nIf Dana is not there, call the front desk and ask for the manager on duty - they know about it and will hand it over. Then drop the receipts at the office before 5.';
(async () => {
  const errs = [];
  for (const [name, eng, w, h] of DEV) {
    if (only && name !== only) continue;
    const br = eng === 'webkit' ? await webkit.launch() : await chromium.launch({ executablePath: '/usr/bin/google-chrome', args: ['--no-sandbox'] });
    for (const dark of [false, true]) {
      const tag = `${name}-${dark ? 'dark' : 'light'}`;
      const ctx = await br.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 2, isMobile: eng === 'chromium', hasTouch: true, serviceWorkers: 'block', timezoneId: 'America/Chicago', colorScheme: dark ? 'dark' : 'light' });
      await ctx.route('**/config.js', r => r.fulfill({ contentType: 'application/javascript', body: "window.CALENDAR_CONFIG={APP_NAME:'SANDY',SUPABASE_URL:'',SUPABASE_ANON_KEY:'',OWNER_EMAIL:''};" }));
      await ctx.addInitScript(d => { localStorage.setItem('sandy.welcome.off', '1'); localStorage.setItem('sandy.tour.off', '1'); if (d) localStorage.setItem('sandy.theme', 'dark'); }, dark);
      const p = await ctx.newPage();
      p.on('pageerror', e => { if (!/ResizeObserver loop/.test(e.message)) errs.push(tag + ': ' + e.message); });
      await p.goto(BASE); await p.waitForFunction(() => window.__app && window.SandyQuickSheet && window.SandyNav);
      await p.evaluate(() => { const b = document.querySelector('#bottomNav [data-tab=todo], [data-tab=todo]'); b && b.click(); });
      await p.waitForTimeout(600);
      const ids = await p.evaluate(async LONG => {
        const a = __app, t = a.ymd(a.nowWall());
        const r1 = await SandyNav.saveQuick({ raw: 'Pick up the gym order', kind: 'todo', priority: 2, reminders: [], description: LONG + '\n- [ ] Receipts folder\n- [ ] Waiver\n- [ ] Office drop-off', date: t, time: '16:00' });
        const r2 = await SandyNav.saveQuick({ raw: 'Plan the team lunch', kind: 'todo', description: 'Ask about allergies first\n- [x] Pick a date\n- [ ] Book the room' });
        await SandyNav.renderTodo(); return { ev: r1.ev.id, inbox: r2.item.id };
      }, LONG);
      await p.waitForTimeout(400);
      const row = p.locator(`[data-ev="${ids.ev}"]`);
      await row.scrollIntoViewIfNeeded();
      const info = await p.evaluate(id => { const r = document.querySelector(`[data-ev="${id}"]`); const d = r.querySelector('.td-desc'); return { desc: d && d.textContent, h: d && d.getBoundingClientRect().height, sub: r.querySelector('.td-subs') && r.querySelector('.td-subs').textContent }; }, ids.ev);
      if (!info.desc || !info.desc.includes('drop the receipts') || info.desc.includes('[ ]')) errs.push(tag + ': list desc ' + JSON.stringify(info));
      if (info.sub !== '0/3') errs.push(tag + ': sub count ' + info.sub);
      await p.evaluate(id => document.querySelector(`[data-ev="${id}"]`).scrollIntoView({ block: 'start' }), ids.ev); await p.evaluate(() => window.scrollBy(0, -70));
      await p.waitForTimeout(250); await p.screenshot({ path: `${OUT}/${tag}-1-list-long-desc.png` });
      // open the task view
      await row.locator('.td-title').click();
      await p.waitForFunction(() => SandyQuickSheet.editing); await p.waitForTimeout(500);
      await p.screenshot({ path: `${OUT}/${tag}-2-edit-sheet.png` });
      // sub-tasks: tick one, add one, rename, reorder via keyboard, delete
      await p.locator('.qs-sub-check').first().click(); await p.waitForTimeout(350);
      await p.fill('#qsSubNew', 'Text Dana when done'); await p.press('#qsSubNew', 'Enter'); await p.waitForTimeout(300);
      await p.locator('.qs-sub-drag').nth(3).focus(); await p.keyboard.press('ArrowUp'); await p.waitForTimeout(250);
      const t2 = p.locator('.qs-sub-text').nth(1); await t2.fill('Signed waiver'); await t2.press('Enter'); await p.waitForTimeout(300);
      await p.evaluate(() => { const s = document.getElementById('qsSubs'); s.scrollIntoView({ block: 'center' }); });
      await p.waitForTimeout(300);
      await p.screenshot({ path: `${OUT}/${tag}-4-subtasks.png` });
      // chip row scrolled
      await p.evaluate(() => { const c = document.querySelector('.qs-chips'); c.scrollIntoView({ block: 'center' }); c.scrollLeft = c.scrollWidth; });
      await p.waitForTimeout(250); await p.screenshot({ path: `${OUT}/${tag}-3-chips-scrolled.png` });
      const cs = await p.evaluate(() => { const c = document.querySelector('.qs-chips'); return { sw: c.scrollWidth, cw: c.clientWidth, wrap: getComputedStyle(c).flexWrap, rows: new Set([...c.children].filter(x => x.offsetParent).map(x => x.offsetTop)).size }; });
      if (cs.wrap !== 'nowrap' || cs.rows !== 1) errs.push(tag + ': chips ' + JSON.stringify(cs));
      await p.click('#qsClose').catch(async () => { await p.click('#qsPaneClose'); });
      await p.waitForFunction(() => !SandyQuickSheet.isOpen); await p.waitForTimeout(600);
      const after = await p.evaluate(async id => { const ev = await __app.Store.get(id); const nk = __app.noteKeyFor(ev, null); const c = await __app.Store.checks.get(nk.eventId, nk.date); const r = document.querySelector(`[data-ev="${id}"] .td-subs`); return { notes: ev.notes, checks: c, count: r && r.textContent }; }, ids.ev);
      const want = '- [ ] Receipts folder\n- [ ] Signed waiver\n- [ ] Text Dana when done\n- [ ] Office drop-off';
      if (!after.notes.endsWith(want) || JSON.stringify(after.checks) !== '["receipts folder"]' || after.count !== '1/4') errs.push(tag + ': saved ' + JSON.stringify(after));
      // quick add with multi-line description
      await p.click('#todoFab'); await p.waitForFunction(() => SandyQuickSheet.isOpen && !SandyQuickSheet.editing);
      await p.fill('#qsText', 'Call the plumber tomorrow');
      await p.click('#qsDesc'); await p.keyboard.type('Line one'); await p.keyboard.press('Enter'); await p.keyboard.type('Line two'); await p.keyboard.press('Enter'); await p.keyboard.type('Line three');
      await p.waitForTimeout(250);
      const qd = await p.evaluate(() => { const d = document.getElementById('qsDesc'); return { v: d.value, h: d.offsetHeight, open: SandyQuickSheet.isOpen }; });
      if (qd.v !== 'Line one\nLine two\nLine three' || qd.h < 60) errs.push(tag + ': quick desc ' + JSON.stringify(qd));
      await p.screenshot({ path: `${OUT}/${tag}-5-quick-add-multiline.png` });
      await p.evaluate(() => { const c = document.querySelector('.qs-chips'); c.scrollLeft = c.scrollWidth; }); await p.waitForTimeout(200);
      await p.screenshot({ path: `${OUT}/${tag}-6-quick-add-chips-scrolled.png` });
      // inbox jot sub-tasks (inline ticks)
      await p.keyboard.press('Escape'); await p.waitForFunction(() => !SandyQuickSheet.isOpen); await p.waitForTimeout(400);
      const ib = await p.evaluate(id => { const r = document.querySelector(`[data-inbox="${id}"] .td-subs`); return r && r.textContent; }, ids.inbox);
      if (ib !== '1/2') errs.push(tag + ': inbox count ' + ib);
      await p.locator(`[data-inbox="${ids.inbox}"] .td-title`).click(); await p.waitForFunction(() => SandyQuickSheet.editing); await p.waitForTimeout(300);
      await p.locator('.qs-sub-check').nth(1).click(); await p.waitForTimeout(400);
      await p.locator('.qs-sub-del').first().click(); await p.waitForTimeout(500);
      await p.keyboard.press('Escape'); await p.waitForTimeout(700);
      const ib2 = await p.evaluate(async id => (await SandyNav.Inbox.list()).find(x => x.id === id).body, ids.inbox);
      if (ib2 !== 'Plan the team lunch\nAsk about allergies first\n- [x] Book the room') errs.push(tag + ': inbox body ' + JSON.stringify(ib2));
      // helpers + repeating to-do keeps its series start when edited from a later date
      const unit = await p.evaluate(async () => {
        const S = SandySubs, out = [];
        const ps = S.parse('Line a\n\nLine b\n- [ ] One\n- [x] Two\n* [ ] one');
        out.push(ps.desc === 'Line a\n\nLine b' && ps.subs.length === 2 && ps.subs[1].done);
        out.push(S.compose('D', [{ text: 'A', done: true }, { text: 'B' }], true) === 'D\n- [x] A\n- [ ] B');
        out.push(S.compose('', [{ text: 'A', done: true }], false) === '- [ ] A');
        const a = __app; const t = a.ymd(a.nowWall()); const d0 = new Date(t + 'T00:00:00Z'); d0.setUTCDate(d0.getUTCDate() - 14); const s0 = d0.toISOString().slice(0, 10);
        const ev = { id: a.Store.uid(), kind: 'task', title: 'Weekly sweep', calendar: a.firstVisibleCal(), allDay: true, start: s0, end: s0, recurrence: { freq: 'weekly', interval: 1 }, notes: '' };
        await a.Store.save(ev);
        const r = await SandyNav.saveEdit({ raw: 'Weekly sweep!', kind: 'todo', priority: 4, description: 'x', date: t, time: null, origDate: t, edit: { type: 'task', id: ev.id, key: t } });
        out.push(r.ev.start === s0 && r.ev.title === 'Weekly sweep!');
        await a.Store.remove(ev.id);
        return out;
      });
      if (unit.some(x => !x)) errs.push(tag + ': unit ' + JSON.stringify(unit));
      console.log(tag, 'done');
      await ctx.close();
    }
    await br.close();
  }
  if (errs.length) { console.error('FAIL:\n' + errs.join('\n')); process.exit(1); }
  console.log('TODO SUBTASKS PASSED (8 device/theme runs)');
})().catch(e => { console.error(e); process.exit(1); });
