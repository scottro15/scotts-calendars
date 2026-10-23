// Browser test: AI button + chat sheet, confirm cards (add / edit one occurrence / check / delete), Brief me.
//   node tests/ai_assistant.test.js http://127.0.0.1:8771/ [screenshotDir]
const { chromium } = require(process.env.PW || '/workspace/shot-tools/node_modules/playwright-core');
const BASE = process.argv[2] || 'http://127.0.0.1:8771/'; const SHOTS = process.argv[3];
const assert = (c, m) => { if (!c) { throw new Error('FAIL: ' + m); } console.log('ok -', m); };
(async () => {
  const b = await chromium.launch({ executablePath: '/usr/bin/google-chrome', headless: true, args: ['--no-sandbox'] });
  const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, timezoneId: 'America/Chicago', isMobile: true, hasTouch: true });
  await ctx.route('**/config.js', r => r.fulfill({ contentType: 'application/javascript', body: "window.CALENDAR_CONFIG = { AI_ENDPOINT: 'https://ai.test/fn' };" }));
  let next = null; const sent = [];
  await ctx.route('https://ai.test/fn', async r => { sent.push(JSON.parse(r.request().postData())); await r.fulfill({ contentType: 'application/json', body: JSON.stringify(next(sent[sent.length - 1])) }); });
  const p = await ctx.newPage(); const errs = []; p.on('pageerror', e => errs.push(e.message));
  await p.clock.install({ time: new Date('2026-10-23T15:00:00Z') }); // Fri Oct 23, 10 AM CT
  await p.goto(BASE + '?view=listWeek'); await p.waitForSelector('.fc-list-event');
  await p.evaluate(() => localStorage.clear()); await p.reload(); await p.waitForSelector('.fc-list-event');
  const ids = await p.evaluate(async () => {
    await Store.removeWhere(() => true);
    const s = await Store.save({ calendar: 'mam', kind: 'event', category: 'Other', title: 'Maryville practice', allDay: false, start: '2026-10-19T13:00', end: '2026-10-19T15:00', recurrence: { freq: 'weekly', interval: 1, byWeekday: [1, 5] } });
    await Store.save({ calendar: 'mam', kind: 'event', category: 'Client workout', title: 'Christian Dake workout', allDay: false, start: '2026-10-23T13:30', end: '2026-10-23T14:30', recurrence: { freq: 'none' } });
    await Store.save({ calendar: 'msc', kind: 'event', category: 'Meeting', title: 'Call with Bill', allDay: false, start: '2026-10-23T14:30', end: '2026-10-23T15:30', recurrence: { freq: 'none' } });
    const t = await Store.save({ calendar: 'lifetime', kind: 'task', scope: 'day', category: 'Task / to-do', title: 'CTR Reformer install', allDay: true, start: '2026-10-22', end: '2026-10-22', done: false, recurrence: { freq: 'none' } });
    return { s: s.id, t: t.id };
  });
  await p.reload(); await p.waitForSelector('#aiBtn');
  await p.tap('#aiBtn'); await p.waitForSelector('#aiSheet:not([hidden])');
  const fs = await p.$eval('#aiText', e => getComputedStyle(e).fontSize); assert(fs === '16px', 'input is 16px (no zoom): ' + fs);
  const col = await p.$eval('.ai-msg.assistant', e => getComputedStyle(e).color); assert(col === 'rgb(17, 24, 39)', 'dark readable text ' + col);
  // Brief me
  await p.tap('#aiBrief'); await p.waitForFunction(() => /Overlaps/.test(document.querySelector('#aiLog').innerText));
  const brief = await p.$eval('#aiLog', e => e.innerText);
  assert(/Maryville practice/.test(brief) && /Christian Dake workout/.test(brief), 'brief lists today');
  assert(/CTR Reformer install/.test(brief), 'brief lists overdue to-do');
  assert(/Maryville practice \(1 PM–3 PM\) overlaps Call with Bill/.test(brief), 'brief flags real overlap');
  assert(!/Christian Dake workout \(.*overlaps|overlaps Christian/.test(brief), 'Christian Dake never flagged as conflict');
  if (SHOTS) await p.screenshot({ path: `${SHOTS}/30_ai_brief_mobile.png` });
  // Add proposal
  next = () => ({ reply: 'Here you go. Tap Confirm to save.', proposals: [{ type: 'add', title: 'Film with Nick', calendar: 'mam', start: '2026-10-23T16:00', end: '2026-10-23T17:00', summary: 'Add film with Nick, Fri 4–5 PM' }] });
  await p.fill('#aiText', 'Add film with Nick today 4pm'); await p.tap('#aiSend');
  await p.waitForSelector('.ai-card [data-ok]');
  assert(sent[0].context.today === '2026-10-23' && sent[0].context.events.some(e => e.title === 'Maryville practice' && e.occ === '2026-10-23'), 'context has expanded occurrences');
  assert(sent[0].messages.at(-1).content === 'Add film with Nick today 4pm', 'message sent');
  assert(!(await p.evaluate(async () => (await Store.list()).some(e => e.title === 'Film with Nick'))), 'not saved before Confirm');
  if (SHOTS) await p.screenshot({ path: `${SHOTS}/30_ai_chat_sheet_mobile.png` });
  await p.tap('.ai-card:last-child [data-ok]'); await p.waitForSelector('.ai-card-status');
  assert(await p.evaluate(async () => (await Store.list()).some(e => e.title === 'Film with Nick' && e.start === '2026-10-23T16:00')), 'saved after Confirm');
  // Edit single occurrence + check + delete one
  next = () => ({ reply: 'Tap Confirm.', proposals: [
    { type: 'edit', id: ids.s, occurrence: '2026-10-23', scope: 'one', changes: { start: '2026-10-23T14:00', end: '2026-10-23T16:00' }, summary: 'Move today\'s practice to 2 PM' },
    { type: 'check', id: ids.t, occurrence: '2026-10-22', done: true, summary: 'Check off install' },
    { type: 'delete', id: ids.s, occurrence: '2026-10-26', scope: 'one', summary: 'Skip Monday practice' }] });
  await p.fill('#aiText', 'do stuff'); await p.tap('#aiSend'); await p.waitForFunction(() => document.querySelectorAll('.ai-card [data-ok]').length === 3);
  for (let i = 0; i < 3; i++) { await p.tap('.ai-card [data-ok]:not([disabled])'); await p.waitForTimeout(300); }
  const st = await p.evaluate(async (ids) => { const all = await Store.list(); const s = all.find(e => e.id === ids.s); return { ex: s.exdates, det: all.find(e => e.seriesId === ids.s), t: all.find(e => e.id === ids.t).done }; }, ids);
  assert(st.ex.includes('2026-10-23') && st.det && st.det.start === '2026-10-23T14:00', 'single occurrence moved');
  assert(st.ex.includes('2026-10-26'), 'single occurrence deleted');
  assert(st.t === true, 'to-do checked off');
  assert(sent[1].messages.some(m => /I confirmed/.test(m.content)), 'confirmations go into history');
  // Cancel + error
  next = () => ({ reply: 'Tap Confirm.', proposals: [{ type: 'delete', id: ids.t, occurrence: '2026-10-22', summary: 'Delete install' }] });
  await p.fill('#aiText', 'delete it'); await p.tap('#aiSend'); await p.waitForTimeout(400); await p.tap('.ai-card [data-no]:not([disabled])'); await p.waitForTimeout(200);
  assert(await p.evaluate(async id => !!(await Store.get(id)), ids.t), 'cancel keeps item');
  await ctx.unroute('https://ai.test/fn'); await ctx.route('https://ai.test/fn', r => r.fulfill({ status: 429, contentType: 'application/json', body: JSON.stringify({ error: 'Daily AI limit reached (50 requests).' }) }));
  await p.fill('#aiText', 'hi'); await p.tap('#aiSend'); await p.waitForSelector('.ai-msg.error'); assert(/Daily AI limit/.test(await p.$eval('.ai-msg.error', e => e.textContent)), 'rate-limit message shown');
  await p.tap('.ai-x'); assert(await p.$eval('#aiSheet', e => e.hidden), 'closes');
  assert(!errs.length, 'no page errors ' + errs.join(';'));
  await b.close(); console.log('PASS ai_assistant');
})().catch(e => { console.error(e); process.exit(1); });
