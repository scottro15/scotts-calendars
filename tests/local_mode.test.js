// Browser test of the localStorage path. Run: node tests/local_mode.test.js [baseUrl]
// Needs playwright-core (see /workspace/shot-tools) and Chrome.
const { chromium } = require(process.env.PW || '/workspace/shot-tools/node_modules/playwright-core');
const BASE = process.argv[2] || 'http://127.0.0.1:8765/';
const assert = (c, m) => { if (!c) { throw new Error('FAIL: ' + m); } console.log('ok -', m); };
(async () => {
  const b = await chromium.launch({ executablePath: '/usr/bin/google-chrome', headless: true, args: ['--no-sandbox'] });
  for (const tz of ['America/Chicago', 'Asia/Tokyo', 'America/Los_Angeles']) {
    const ctx = await b.newContext({ viewport: { width: 1300, height: 900 }, timezoneId: tz, locale: 'en-US' });
    const p = await ctx.newPage(); const errs = [];
    p.on('pageerror', e => errs.push(e.message)); p.on('console', m => { if (m.type() === 'error') errs.push(m.text()); });
    await p.goto(BASE + '?view=timeGridWeek&cals=lifetime'); await p.waitForSelector('.fc-event');
    const t = await p.locator('.fc-timegrid-event:has-text("Life Time shift") .fc-event-time').first().textContent();
    assert(/^6:00/.test(t.trim()), `[${tz}] shift shows Chicago wall time 6:00 (got "${t.trim()}")`);
    const today = await p.evaluate(() => __app.ymd(__app.nowWall()));
    const chicagoToday = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Chicago' }).format(new Date());
    assert(today === chicagoToday, `[${tz}] "today" is Chicago's date ${chicagoToday}`);
    const fcToday = await p.locator('.fc-day-today').first().getAttribute('data-date');
    assert(fcToday === chicagoToday, `[${tz}] FullCalendar highlights Chicago today (${fcToday})`);
    assert(errs.length === 0, `[${tz}] no page errors ${errs.join(' | ')}`);
    if (tz !== 'America/Chicago') { await ctx.close(); continue; }

    // ---- single-occurrence edit
    const before = await p.locator('.fc-event:has-text("Life Time shift")').count();
    await p.locator('.fc-event:has-text("Life Time shift")').nth(1).click();
    await p.fill('#eventForm input[name=title]', 'Shift (covering)');
    await p.fill('input[name=startTime]', '08:00'); await p.fill('input[name=endTime]', '16:00');
    await p.click('#eventForm button[type=submit]'); await p.click('#scopeOne'); await p.waitForTimeout(400);
    const after = await p.locator('.fc-event:has-text("Life Time shift")').count();
    const cov = await p.locator('.fc-timegrid-event:has-text("Shift (covering)") .fc-event-time').first().textContent();
    assert(after === before - 1, `series lost exactly one occurrence (${before} -> ${after})`);
    assert(/^8:00/.test(cov.trim()), `exception shows at 8:00 (${cov.trim()})`);
    const exc = await p.evaluate(async () => (await Store.list()).find(e => e.seriesId));
    assert(exc && exc.originalDate && exc.recurrence.freq === 'none', 'exception stored with seriesId/originalDate');
    const parent = await p.evaluate(async id => Store.get(id), exc.seriesId);
    assert(parent.exdates.includes(exc.originalDate), 'parent exdates contains the occurrence');

    // ---- whole-series edit from an occurrence, shifting time
    await p.locator('.fc-event:has-text("Life Time shift")').first().click();
    assert(await p.isVisible('#recurFieldset'), 'repeat rule visible for series');
    await p.fill('input[name=startTime]', '05:30'); await p.fill('input[name=endTime]', '14:00');
    await p.click('#eventForm button[type=submit]'); await p.click('#scopeAll'); await p.waitForTimeout(400);
    const p2 = await p.evaluate(async id => Store.get(id), exc.seriesId);
    assert(p2.start.endsWith('T05:30') && p2.end.endsWith('T14:00'), `series time shifted (${p2.start} – ${p2.end})`);
    assert(p2.start.slice(0, 10) === parent.start.slice(0, 10), 'series start date unchanged');
    const covStill = await p.locator('.fc-timegrid-event:has-text("Shift (covering)") .fc-event-time').first().textContent();
    assert(/^8:00/.test(covStill.trim()), 'exception kept its own time after series edit');

    // ---- restore exception
    await p.locator('.fc-event:has-text("Shift (covering)")').first().click();
    assert(await p.isVisible('#restoreBtn'), 'restore button shown on exception');
    p.once('dialog', d => d.accept());
    await p.click('#restoreBtn'); await p.waitForTimeout(400);
    assert(await p.locator('.fc-event:has-text("Shift (covering)")').count() === 0, 'exception removed');
    assert(await p.locator('.fc-event:has-text("Life Time shift")').count() === before, 'occurrence back in series');

    // ---- custom category goes to Store.categories
    await p.click('#addBtn'); await p.fill('#eventForm input[name=title]', 'SLU practice');
    await p.selectOption('#fCalendar', 'mam'); await p.selectOption('#fCategory', '__custom__');
    await p.fill('input[name=customCategory]', 'Team practice – SLU'); await p.click('#eventForm button[type=submit]'); await p.waitForTimeout(300);
    const cats = await p.evaluate(() => Store.categories());
    assert((cats.mam || []).includes('Team practice – SLU'), 'custom category saved');

    // ---- drag-free move of a one-off, delete one occurrence still works
    await p.locator('.fc-event:has-text("Life Time shift")').first().click();
    await p.click('#deleteBtn'); await p.click('#scopeOne'); await p.waitForTimeout(300);
    assert(await p.locator('.fc-event:has-text("Life Time shift")').count() === before - 1, 'delete one occurrence');
    // ---- reload persists
    await p.reload(); await p.waitForSelector('.fc-event');
    assert(await p.locator('.fc-event:has-text("Life Time shift")').count() === before - 1, 'persisted across reload');
    assert(errs.length === 0, 'no page errors after edits ' + errs.join(' | '));
    const note = await p.textContent('#storageNote');
    assert(/this device only/i.test(note), 'storage note says local: ' + note);
    await p.screenshot({ path: '/tmp/local-week.png' });
    await ctx.close();
  }
  await b.close();
  console.log('ALL LOCAL TESTS PASSED');
})().catch(e => { console.error(e.message); process.exit(1); });
