// Browser test: occurrences with a Notion link show a Notion icon in List + Day view; tapping it opens Notion, not the editor.
//   node tests/notion_link.test.js http://127.0.0.1:8766/ [screenshotDir]   (copy served with an empty config.js)
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
  const URL = 'https://app.notion.com/p/4002151db7338120a189d42a8d4a0a17';
  await p.evaluate(async (url) => {
    const s = await Store.save({ calendar: 'mam', kind: 'event', category: 'Practice', title: 'Maryville Practice', start: '2026-10-19T12:00', end: '2026-10-19T15:00',
      recurrence: { freq: 'weekly', interval: 1, byWeekday: [1, 3] }, notes: '' });
    localStorage.setItem('scott-calendar-links-v1', JSON.stringify([{ eventId: s.id, date: '2026-10-19', url }, { eventId: s.id, date: '2026-10-21', url: 'javascript:alert(1)' }]));
  }, URL);
  await p.reload(); await p.waitForSelector('.fc-list-event');
  const icons = p.locator('tr.fc-list-event .notion-link');
  assert(await icons.count() === 1, 'one Notion icon in List View (only the linked date; bad URL ignored)');
  assert(await icons.first().getAttribute('href') === URL && await icons.first().getAttribute('target') === '_blank', 'icon links to the page in a new tab');
  if (SHOTS) { await icons.first().scrollIntoViewIfNeeded(); await p.screenshot({ path: `${SHOTS}/21_notion_icon_list.png` }); }
  const [popup] = await Promise.all([ctx.waitForEvent('page', { timeout: 5000 }).catch(() => null), icons.first().click()]);
  await p.waitForTimeout(500);
  assert(!(await p.evaluate(() => document.querySelector('dialog[open]'))), 'tapping icon does not open the editor');
  assert(popup, 'tapping icon opens a new tab'); if (popup) await popup.close();
  await p.locator('tr.fc-list-event:has(.notion-link) td.fc-list-event-title').click(); await p.waitForSelector('#dayNoteNotion:not([hidden]) .notion-link');
  assert(true, 'editor shows Open in Notion near Today\'s Note');
  if (SHOTS) { await p.locator('#dayNoteBox').scrollIntoViewIfNeeded(); await p.screenshot({ path: `${SHOTS}/21_notion_link_editor.png` }); }
  await p.keyboard.press('Escape'); await p.waitForTimeout(400);
  await p.click('.fc-timeGridDay-button'); await p.waitForTimeout(400); await p.click('.fc-prev-button'); await p.waitForTimeout(300); await p.click('.fc-prev-button');
  await p.waitForSelector('.fc-timegrid-event .notion-link', { timeout: 5000 });
  assert(true, 'Day view shows the icon');
  if (SHOTS) { await p.locator('.fc-timegrid-event .notion-link').scrollIntoViewIfNeeded(); await p.screenshot({ path: `${SHOTS}/21_notion_icon_day.png` }); }
  assert(errs.length === 0, 'no page errors ' + errs.join('|'));
  await b.close();
})().catch(e => { console.error(e.message); process.exit(1); });
