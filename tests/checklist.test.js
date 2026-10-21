// Browser test: '- [ ]' lines in notes render as per-occurrence checkboxes.
//   node tests/checklist.test.js http://127.0.0.1:8766/ [screenshotDir]   (copy served with an empty config.js)
const { chromium } = require(process.env.PW || '/workspace/shot-tools/node_modules/playwright-core');
const BASE = process.argv[2] || 'http://127.0.0.1:8766/'; const SHOTS = process.argv[3];
const assert = (c, m) => { if (!c) { throw new Error('FAIL: ' + m); } console.log('ok -', m); };
(async () => {
  const b = await chromium.launch({ executablePath: '/usr/bin/google-chrome', headless: true, args: ['--no-sandbox'] });
  const ctx = await b.newContext({ viewport: { width: 390, height: 800 }, timezoneId: 'America/Chicago', isMobile: true, hasTouch: true });
  const p = await ctx.newPage(); const errs = []; p.on('pageerror', e => errs.push(e.message));
  await p.clock.install({ time: new Date('2026-10-21T17:00:00Z') });
  await p.goto(BASE + '?view=listWeek'); await p.waitForSelector('.fc-list-event');
  await p.evaluate(() => localStorage.clear()); await p.reload(); await p.waitForSelector('.fc-list-event');
  await p.evaluate(async () => { await Store.save({ calendar: 'lifetime', kind: 'event', category: 'Work shift', title: 'CK shift', start: '2026-10-21T17:00', end: '2026-10-21T23:00',
    recurrence: { freq: 'weekly', interval: 1, byWeekday: [3] }, notes: 'Preview (start of every shift):\n- [ ] check boards\n- [ ] check emails\n\nPlain line' }); });
  await p.reload(); await p.waitForSelector('.fc-list-event');
  const row = 'tr.fc-list-event:has-text("CK shift")';
  await p.locator(row).first().locator('td.fc-list-event-title').click();
  await p.waitForSelector('#checklistBox:not([hidden])');
  assert(await p.locator('#checklistItems input').count() === 2, 'two checkboxes');
  await p.locator('#checklistItems input').first().check(); await p.waitForTimeout(1200);
  assert((await p.textContent('#checklistStatus')).includes('1/2'), 'status 1/2');
  const notesBefore = await p.inputValue('textarea[name=notes]');
  await p.keyboard.press('Escape'); await p.waitForTimeout(400);
  await p.locator(row).first().locator('td.fc-list-event-title').click(); await p.waitForSelector('#checklistBox:not([hidden])');
  assert(await p.locator('#checklistItems input').first().isChecked(), 'tick persisted on reopen');
  if (SHOTS) { await p.locator('#checklistBox').scrollIntoViewIfNeeded(); await p.screenshot({ path: `${SHOTS}/19-checklist-mobile.png` }); }
  assert(await p.inputValue('textarea[name=notes]') === notesBefore && notesBefore.includes('Plain line'), 'notes text unchanged');
  await p.keyboard.press('Escape'); await p.waitForTimeout(400);
  // next week's occurrence starts unticked
  await p.click('.fc-next-button'); await p.waitForSelector(row);
  await p.locator(row).first().locator('td.fc-list-event-title').click(); await p.waitForSelector('#checklistBox:not([hidden])');
  assert(!(await p.locator('#checklistItems input').first().isChecked()), 'other date independent');
  assert(errs.length === 0, 'no page errors ' + errs.join('|'));
  await b.close();
})().catch(e => { console.error(e.message); process.exit(1); });
