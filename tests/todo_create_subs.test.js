// Sub-tasks while CREATING a to-do (Scott 2026-11-01): the quick-add sheet's "Sub-tasks" chip reveals the section
// (add / rename / tick / reorder / delete before saving); they save with the new task in one go (jot: inline; dated:
// notes + first-date ticks, rolled back together on failure); cancel discards; the full editor (handoff + "+ Scheduled
// to-do", repeating) has the same "Add sub-task" row. 4 devices x light/dark.
//   node tests/todo_create_subs.test.js http://127.0.0.1:8793/ /tmp/shots [device]
const PW = process.env.PW || '/usr/local/lib/pnpm/5/.pnpm/playwright-core@1.59.1/node_modules/playwright-core';
const { chromium, webkit } = require(PW);
const fs = require('fs');
const BASE = process.argv[2] || 'http://127.0.0.1:8793/';
const OUT = process.argv[3] || '/tmp/createsubs';
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
      await p.evaluate(() => document.querySelector('#bottomNav [data-tab=todo]').click()); await p.waitForTimeout(700);
      const openSheet = async () => { await p.evaluate(() => SandyQuickSheet.open()); await p.waitForTimeout(400); };
      const addSub = async t => { await p.fill('#qsSubNew', t); await p.press('#qsSubNew', 'Enter'); await p.waitForTimeout(120); };
      const subs = () => p.evaluate(() => [...document.querySelectorAll('#qsSubList .qs-sub')].map(li => (li.classList.contains('done') ? 'x:' : '') + li.querySelector('.qs-sub-text').value));
      const counts = () => p.evaluate(async () => ({ ev: (await __app.Store.list()).filter(e => e.kind === 'task').length, ib: (await SandyNav.Inbox.list()).length }));

      // --- A. Inbox jot: chip reveals the section; add, rename, tick, reorder, delete; one save
      await openSheet();
      ok(await p.evaluate(() => { const c = document.getElementById('qsSubChip'); return !c.hidden && document.getElementById('qsSubs').hidden && c.getAttribute('aria-expanded') === 'false'; }), 'create sheet: Sub-tasks chip shown, section hidden until tapped', tag);
      await p.locator('#qsText').fill('Plan the team lunch');
      await p.click('#qsSubChip'); await p.waitForTimeout(300);
      ok(await p.evaluate(() => !document.getElementById('qsSubs').hidden && document.activeElement.id === 'qsSubNew'), 'chip reveals Sub-tasks and focuses "Add sub-task"', tag);
      for (const t of ['Pick a date', 'Book the room', 'Order pizza', 'Extra']) await addSub(t);
      const ren = p.locator('#qsSubList .qs-sub-text').nth(2); await ren.fill('Order pizzas'); await p.locator('#qsSubNew').focus(); await p.waitForTimeout(100);
      await p.locator('#qsSubList .qs-sub-check').nth(1).click(); await p.waitForTimeout(350);
      await p.locator('#qsSubList .qs-sub-drag').nth(2).focus(); await p.keyboard.press('ArrowUp'); await p.waitForTimeout(150);
      await p.locator('#qsSubList .qs-sub-del').nth(3).click(); await p.waitForTimeout(350);
      const sA = await subs();
      ok(JSON.stringify(sA) === JSON.stringify(['Pick a date', 'Order pizzas', 'x:Book the room']), 'add/rename/tick/reorder/delete before saving ' + JSON.stringify(sA), tag);
      ok(await p.evaluate(() => document.getElementById('qsSubLbl').textContent) === 'Sub-tasks 3', 'chip shows the count', tag);
      const c0 = await counts();
      ok(JSON.stringify(await counts()) === JSON.stringify(c0), 'no partial save while editing sub-tasks', tag);
      await p.locator('#qsSheet').evaluate(s => { s.scrollTop = 0; });
      await p.screenshot({ path: `${OUT}/${tag}-1-adding-subtasks.png` });
      await p.click('#qsSend'); await p.waitForTimeout(800);
      const jot = await p.evaluate(async () => (await SandyNav.Inbox.list()).find(x => /^Plan the team lunch/.test(x.body)));
      ok(jot && jot.body === 'Plan the team lunch\n- [ ] Pick a date\n- [ ] Order pizzas\n- [x] Book the room', 'jot saved with its sub-tasks in one write ' + JSON.stringify(jot && jot.body), tag);
      ok(await p.evaluate(() => document.getElementById('qsSubs').hidden && document.getElementById('qsSubLbl').textContent === 'Sub-tasks' && !document.querySelector('#qsSubList li') && document.getElementById('qsText').value === ''), 'sheet clears for the next task', tag);
      ok(await p.evaluate(id => (document.querySelector(`[data-inbox="${id}"] .td-subs-n`) || {}).textContent, jot && jot.id) === '1/3', 'list shows 1/3 under the new jot', tag);

      // --- B. dated to-do: tick + a half-typed sub-task kept on send; ticks on its date
      await p.locator('#qsText').fill('Pack bags tomorrow');
      await p.click('#qsSubChip'); await addSub('Shoes'); await addSub('Socks');
      await p.locator('#qsSubList .qs-sub-check').nth(1).click(); await p.waitForTimeout(350);
      await p.fill('#qsSubNew', 'Snacks'); // not Enter'd: the send arrow keeps it
      await p.screenshot({ path: `${OUT}/${tag}-2-dated-with-subtasks.png` });
      await p.click('#qsSend'); await p.waitForTimeout(900);
      const evB = await p.evaluate(async () => { const e = (await __app.Store.list()).find(x => x.title === 'Pack bags'); if (!e) return null; const nk = __app.noteKeyFor(e, null); return { notes: e.notes, start: e.start, checks: await __app.Store.checks.get(nk.eventId, nk.date) }; });
      ok(evB && evB.notes === '- [ ] Shoes\n- [ ] Socks\n- [ ] Snacks' && JSON.stringify(evB.checks) === '["socks"]', 'dated to-do saved with sub-tasks + tick ' + JSON.stringify(evB), tag);
      await p.keyboard.press('Escape'); await p.waitForTimeout(400);

      // --- C. cancel discards
      const c1 = await counts();
      await openSheet(); await p.locator('#qsText').fill('Throwaway task'); await p.click('#qsSubChip'); await addSub('Never saved');
      await p.keyboard.press('Escape'); await p.waitForTimeout(500);
      ok(JSON.stringify(await counts()) === JSON.stringify(c1), 'cancel saves nothing', tag);
      await openSheet();
      ok(await p.evaluate(() => document.getElementById('qsText').value === '' && !document.querySelector('#qsSubList li') && document.getElementById('qsSubs').hidden), 'reopened sheet: sub-tasks discarded', tag);
      // note kind hides the chip
      await p.selectOption('#qsMore', 'note'); await p.waitForTimeout(150);
      ok(await p.evaluate(() => document.getElementById('qsSubChip').hidden && document.getElementById('qsSubs').hidden), 'quick note: no sub-tasks', tag);
      await p.selectOption('#qsMore', 'todo'); await p.waitForTimeout(150);

      // --- D. rollback: ticks can't save -> no task left, typed text + sub-tasks come back
      await p.locator('#qsText').fill('Rollback test today');
      await p.click('#qsSubChip'); await addSub('One'); await p.locator('#qsSubList .qs-sub-check').first().click(); await p.waitForTimeout(300);
      await p.evaluate(() => { window.__realSet = __app.Store.checks.set; __app.Store.checks.set = async () => { throw new Error('offline test'); }; });
      await p.click('#qsSend'); await p.waitForTimeout(900);
      await p.evaluate(() => { __app.Store.checks.set = window.__realSet; });
      const rb = await p.evaluate(async () => ({ left: (await __app.Store.list()).some(e => e.title === 'Rollback test'), text: document.getElementById('qsText').value, subs: [...document.querySelectorAll('#qsSubList .qs-sub')].map(li => li.classList.contains('done')) }));
      ok(!rb.left && rb.text === 'Rollback test today' && JSON.stringify(rb.subs) === '[true]', 'failed tick save rolls the task back, keeps the draft ' + JSON.stringify(rb), tag);

      // --- E. hand off to the full editor (More -> full editor), make it repeat, add one more there
      await p.locator('#qsText').fill('Weekly gear check');
      await p.selectOption('#qsMore', 'full'); await p.waitForTimeout(900);
      const ed1 = await p.evaluate(() => ({ open: document.getElementById('eventDialog').open, notes: document.querySelector('[name="event-notes"]').value, title: document.getElementById('checklistTitle').textContent, box: !document.getElementById('checklistBox').hidden, ticked: [...document.querySelectorAll('#checklistItems input')].map(i => i.checked), add: !document.getElementById('checklistAdd').hidden }));
      ok(ed1.open && ed1.notes === '- [x] One' && ed1.title === 'Sub-tasks' && ed1.box && JSON.stringify(ed1.ticked) === '[true]' && ed1.add, 'full editor gets the sub-tasks + ticks ' + JSON.stringify(ed1), tag);
      await p.selectOption('#fFreq', 'weekly'); await p.waitForTimeout(150);
      await p.fill('#checklistNew', 'Two'); await p.press('#checklistNew', 'Enter'); await p.waitForTimeout(250);
      await p.locator('#checklistBox').scrollIntoViewIfNeeded(); await p.waitForTimeout(200);
      await p.screenshot({ path: `${OUT}/${tag}-3-full-editor-subtasks.png` });
      await p.click('#eventDialog button[type=submit].primary'); await p.waitForTimeout(1000);
      const evE = await p.evaluate(async () => { const e = (await __app.Store.list()).find(x => x.title === 'Weekly gear check'); if (!e) return null; const d = e.start.slice(0, 10); const nk = __app.noteKeyFor(e, d); return { notes: e.notes, freq: e.recurrence.freq, checks: await __app.Store.checks.get(nk.eventId, nk.date) }; });
      ok(evE && evE.notes === '- [ ] One\n- [ ] Two' && evE.freq === 'weekly' && JSON.stringify(evE.checks) === '["one"]', 'repeating to-do from the editor: sub-tasks + first-date tick ' + JSON.stringify(evE), tag);

      // --- F. "+ Scheduled to-do" editor: Add sub-task row from scratch; Cancel discards
      await p.evaluate(() => { const b = document.getElementById('todoNewDated'); b.scrollIntoView(); b.click(); }); await p.waitForTimeout(700);
      await p.fill('#event-title', 'Editor cancel'); await p.fill('#checklistNew', 'Gone'); await p.press('#checklistNew', 'Enter');
      const c2 = await counts(); await p.keyboard.press('Escape'); await p.waitForTimeout(500);
      ok(JSON.stringify(await counts()) === JSON.stringify(c2) && !await p.evaluate(() => document.getElementById('eventDialog').open), 'editor cancel saves nothing', tag);
      await p.evaluate(() => document.getElementById('todoNewDated').click()); await p.waitForTimeout(700);
      ok(await p.evaluate(() => !document.getElementById('checklistBox').hidden && !document.querySelector('#checklistItems li') && document.querySelector('[name="event-notes"]').value === ''), 'fresh editor: empty Sub-tasks with Add row', tag);
      await p.fill('#event-title', 'Editor subs'); await p.fill('#checklistNew', 'Alpha'); await p.press('#checklistNew', 'Enter'); await p.fill('#checklistNew', 'Beta'); // Beta via blur on Save
      await p.click('#eventDialog button[type=submit].primary'); await p.waitForTimeout(1000);
      const evF = await p.evaluate(async () => { const e = (await __app.Store.list()).find(x => x.title === 'Editor subs'); return e && e.notes; });
      ok(evF === '- [ ] Alpha\n- [ ] Beta', 'scheduled to-do editor saves sub-tasks ' + JSON.stringify(evF), tag);
      await ctx.close();
    }
    await br.close();
  }
  if (errs.length) { console.error('FAIL:\n' + errs.join('\n')); process.exit(1); }
  console.log(`TODO CREATE SUB-TASKS PASSED (${n} checks)`);
})().catch(e => { console.error(e); process.exit(1); });
