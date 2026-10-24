// Browser test: tappable to-do box in List/Day view + overdue to-dos in Week/Month/Season tabs.
//   node tests/todo_check_overdue.test.js http://127.0.0.1:8771/ [screenshotDir]
const { chromium } = require(process.env.PW || '/workspace/shot-tools/node_modules/playwright-core');
const BASE = process.argv[2] || 'http://127.0.0.1:8771/'; const SHOTS = process.argv[3];
const assert = (c, m) => { if (!c) { throw new Error('FAIL: ' + m); } console.log('ok -', m); };
(async () => {
  const b = await chromium.launch({ executablePath: '/usr/bin/google-chrome', headless: true, args: ['--no-sandbox'] });
  const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, timezoneId: 'America/Chicago', isMobile: true, hasTouch: true });
  await ctx.route('**/config.js', r => r.fulfill({ contentType: 'application/javascript', body: 'window.CALENDAR_CONFIG = {};' }));
  const p = await ctx.newPage(); const errs = []; p.on('pageerror', e => errs.push(e.message));
  await p.clock.install({ time: new Date('2026-10-23T15:00:00Z') }); // Fri Oct 23, 10 AM CT
  await p.goto(BASE + '?view=listWeek'); await p.waitForSelector('.fc-list-event');
  await p.evaluate(() => localStorage.clear()); await p.reload(); await p.waitForSelector('.fc-list-event');
  const ids = await p.evaluate(async () => {
    const a = await Store.save({ calendar: 'lifetime', kind: 'task', scope: 'day', category: 'Task / to-do', title: 'Order pool chemicals', allDay: true, start: '2026-10-19', end: '2026-10-19', done: false, recurrence: { freq: 'none' } });
    const c = await Store.save({ calendar: 'mam', kind: 'task', scope: 'day', category: 'Task / to-do', title: 'Send practice plan', allDay: true, start: '2026-10-23', end: '2026-10-23', done: false, recurrence: { freq: 'none' } });
    return { a: a.id, c: c.id };
  });
  await p.reload(); await p.waitForSelector('.fc-list-event .todo-check');
  const row = p.locator('tr.fc-list-event:has-text("Send practice plan")');
  const box = row.locator('.todo-check');
  const bb = await box.boundingBox(); assert(bb.width >= 32 && bb.height >= 32, `hit area ${bb.width}x${bb.height}`);
  assert(!(await row.locator('.fc-list-event-title').innerText()).includes('☐'), 'no text box prefix in List view');
  if (SHOTS) { await row.scrollIntoViewIfNeeded(); await p.screenshot({ path: `${SHOTS}/25_todo_checkbox_list_mobile.png` }); }
  const title = await p.evaluate(() => document.querySelector('.fc-toolbar-title').textContent);
  await box.tap(); await p.waitForTimeout(700);
  assert(!(await p.evaluate(() => document.querySelector('dialog[open]'))), 'tapping box does not open editor');
  assert(await p.evaluate(() => document.querySelector('.fc-toolbar-title').textContent) === title, 'tapping box does not swipe');
  assert(await p.evaluate(async id => (await Store.get(id)).done, ids.c), 'saved done');
  assert(await p.locator('tr.fc-list-event.task-done:has-text("Send practice plan") .todo-check.checked').count() === 1, 'shown checked/dimmed after re-render');
  if (SHOTS) await p.screenshot({ path: `${SHOTS}/25_todo_checked_list_mobile.png` });
  await p.locator('tr.fc-list-event:has-text("Send practice plan") .fc-list-event-title a, tr.fc-list-event:has-text("Send practice plan") .fc-list-event-title').first().click({ position: { x: 150, y: 10 } });
  await p.waitForSelector('dialog[open]'); assert(true, 'tapping elsewhere opens editor'); await p.keyboard.press('Escape'); await p.waitForTimeout(300);
  // overdue in Week tab ("By period" lives on the To-Do tab)
  await p.click('#bottomNav [data-tab=todo]'); await p.waitForTimeout(400);
  await p.click('#scopeTabs [data-scope=week]'); await p.waitForTimeout(400);
  const txt = await p.locator('#taskList li:has-text("Order pool chemicals")').innerText(); assert(/Overdue 4 days/.test(txt) && /Mon, Oct 19/.test(txt), 'Week tab: original date + "Overdue 4 days": ' + txt.replace(/\n/g, ' '));
  const cls = await p.$$eval('#taskList li', ls => ls.map(l => l.classList.contains('overdue'))); assert(cls.indexOf(false) === -1 || cls.lastIndexOf(true) < cls.indexOf(false), 'overdue items sorted first');
  assert(await p.locator('#taskList li:has-text("Facility walk-through")').count() <= 1, 'repeating to-do shows only latest miss');
  for (const s of ['month', 'season', 'day']) { await p.click(`#scopeTabs [data-scope=${s}]`); await p.waitForTimeout(200); assert(/Overdue 4 days/.test(await p.locator('#taskList').innerText()), `${s} tab shows overdue`); }
  await p.click('#scopeTabs [data-scope=week]'); await p.waitForTimeout(300);
  if (SHOTS) { await p.locator('#taskList li:has-text("Order pool chemicals")').scrollIntoViewIfNeeded(); await p.screenshot({ path: `${SHOTS}/25_todo_overdue_week_mobile.png` }); }
  await p.locator('#taskList li:has-text("Order pool chemicals") input').click(); await p.waitForTimeout(600);
  assert(!/Overdue/.test(await p.locator('#taskList li:has-text("Order pool chemicals")').innerText().catch(() => '')), 'checked off: no longer overdue');
  // Day view box
  await p.click('#bottomNav [data-tab=home]'); await p.waitForTimeout(300);
  await p.evaluate(() => __app.calendar.changeView('timeGridDay')); await p.waitForTimeout(500);
  assert(await p.locator('.fc-event .todo-check').count() >= 1, 'Day view has the box');
  assert(errs.length === 0, 'no page errors ' + errs.join('|'));
  await b.close();
})().catch(e => { console.error(e.message); process.exit(1); });
