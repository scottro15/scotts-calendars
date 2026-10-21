// Browser test: List View today border, scroll-to-today, now-line position + minute updates, empty day.
// Local mode with a mocked clock. Run against a copy served with an empty config.js:
//   node tests/list_today_nowline.test.js http://127.0.0.1:8766/ [screenshotDir]
const { chromium } = require(process.env.PW || '/workspace/shot-tools/node_modules/playwright-core');
const BASE = process.argv[2] || 'http://127.0.0.1:8766/'; const SHOTS = process.argv[3];
const assert = (c, m) => { if (!c) { throw new Error('FAIL: ' + m); } console.log('ok -', m); };
// Wed Oct 21 2026 18:15 Chicago (CDT, UTC-5) => 23:15Z
const T0 = new Date('2026-10-21T23:15:00Z');
(async () => {
  const b = await chromium.launch({ executablePath: '/usr/bin/google-chrome', headless: true, args: ['--no-sandbox'] });
  for (const vp of [{ width: 1300, height: 700, name: 'desktop' }, { width: 390, height: 700, name: 'mobile' }]) {
    const ctx = await b.newContext({ viewport: vp, timezoneId: 'Asia/Tokyo', locale: 'en-US', isMobile: vp.name === 'mobile', hasTouch: vp.name === 'mobile' });
    const p = await ctx.newPage(); const errs = []; const N = `[${vp.name}]`;
    p.on('pageerror', e => errs.push(e.message));
    await p.clock.install({ time: T0 });
    await p.goto(BASE + '?view=dayGridMonth'); await p.waitForSelector('.fc-event');
    await p.evaluate(() => localStorage.clear()); await p.reload(); await p.waitForSelector('.fc-event');
    assert(await p.locator('.sandy-now-row').count() === 0, `${N} no now-line outside List View`);
    await p.evaluate(() => window.scrollTo(0, 0));
    await p.click('.fc-listWeek-button'); await p.waitForSelector('.sandy-now-line');
    await p.clock.runFor(1500); await p.waitForTimeout(1200);
    const hdr = p.locator('tr.fc-list-day.sandy-today-first');
    assert(await hdr.getAttribute('data-date') === '2026-10-21', `${N} today's header highlighted`);
    assert(await p.locator('tr.fc-list-day.sandy-today').count() === 1, `${N} only one day highlighted`);
    const border = await hdr.locator('th').evaluate(e => getComputedStyle(e).borderTopWidth);
    assert(border === '3px', `${N} border on today (${border})`);
    const lbl = await p.textContent('.sandy-now-label');
    assert(lbl === '6:15 PM', `${N} label shows exact time (${lbl})`);
    assert(await p.getAttribute('.sandy-now-line', 'aria-label') === 'Current time 6:15 PM', `${N} aria-label`);
    assert(await p.locator('.sandy-now-line').count() === 1, `${N} exactly one line`);
    const pos = await p.evaluate(() => {
      const line = document.querySelector('.sandy-now-row'); const rows = [...document.querySelectorAll('tr.sandy-today.fc-list-event')];
      const prev = rows.filter(r => r.compareDocumentPosition(line) & 4).filter(r => !r.dataset.allDay).map(r => r.dataset.start);
      const next = rows.filter(r => line.compareDocumentPosition(r) & 4).map(r => r.dataset.start);
      return { prev, next };
    });
    assert(pos.prev.every(s => s <= '2026-10-21T18:15') && pos.next.every(s => s > '2026-10-21T18:15'), `${N} line between events by time (${JSON.stringify(pos)})`);
    // scroll: header just below the sticky topbar + sticky FullCalendar toolbar
    const geo = await p.evaluate(() => ({ y: scrollY, top: document.querySelector('tr.sandy-today-first').getBoundingClientRect().top, bar: /sticky|fixed/.test(getComputedStyle(document.querySelector('.topbar')).position) ? document.querySelector('.topbar').getBoundingClientRect().height : 0, tool: document.querySelector('.fc-header-toolbar').getBoundingClientRect().height }));
    assert(geo.y > 0 && Math.abs(geo.top - geo.bar - geo.tool) < 6, `${N} scrolled so today sits at top (${JSON.stringify(geo)})`);
    // minute tick moves label; no re-scroll
    await p.evaluate(() => window.scrollTo(0, 0));
    await p.clock.runFor(60000); await p.waitForTimeout(50);
    assert(await p.textContent('.sandy-now-label') === '6:16 PM', `${N} updates on the minute`);
    assert(await p.evaluate(() => scrollY) === 0, `${N} minute tick does not hijack scroll`);
    // ongoing: advance to 7:45 PM -> Client check-in (Example) is Tue; use Wed 15:30-17:30 Jennings? set to 16:00
    await p.clock.setSystemTime(new Date('2026-10-21T21:00:00Z')); await p.evaluate(() => __app.decorateList());
    const ong = await p.locator('tr.sandy-ongoing').allTextContents();
    assert(ong.some(t => /Jennings/.test(t)), `${N} ongoing event marked at 4:00 PM (${ong.length})`);
    const after = await p.evaluate(() => { const r = document.querySelector('tr.sandy-ongoing'); let n = r.nextElementSibling; return n && n.classList.contains('sandy-now-row'); });
    assert(after, `${N} line sits at the ongoing event row`);
    // toggles respected: hide all calendars -> empty-day placeholder
    await p.evaluate(() => { const a = document.getElementById('toggleAll') || document.querySelector('[id*=oggleAll]'); if (a) { a.checked = false; a.dispatchEvent(new Event('change', { bubbles: true })); } });
    await p.waitForTimeout(400);
    assert(await p.locator('tr.fc-list-event').count() === 0, `${N} toggles hide events`);
    assert(await p.locator('tr.sandy-today-placeholder.fc-list-day[data-date="2026-10-21"]').count() === 1, `${N} empty-day placeholder for today`);
    assert(await p.locator('.sandy-now-line').count() === 1, `${N} line shown on empty day`);
    await p.evaluate(() => { const a = document.getElementById('toggleAll') || document.querySelector('[id*=oggleAll]'); a.checked = true; a.dispatchEvent(new Event('change', { bubbles: true })); });
    await p.waitForTimeout(400);
    // midnight rollover -> Thursday
    await p.clock.setSystemTime(new Date('2026-10-22T04:59:30Z')); await p.clock.runFor(61000); await p.waitForTimeout(50);
    assert(await p.locator('tr.fc-list-day.sandy-today-first').getAttribute('data-date') === '2026-10-22', `${N} midnight moves highlight to Thursday`);
    assert(await p.textContent('.sandy-now-label') === '12:00 AM', `${N} label after midnight`);
    // other week -> no line
    await p.click('.fc-next-button'); await p.waitForTimeout(300);
    assert(await p.locator('.sandy-now-row, .sandy-today').count() === 0, `${N} no highlight when today not in range`);
    if (SHOTS) {
      await p.clock.setSystemTime(T0); await p.click('.fc-today-button'); await p.click('.fc-dayGridMonth-button'); await p.waitForTimeout(200);
      await p.evaluate(() => window.scrollTo(0, 0)); await p.click('.fc-listWeek-button'); await p.waitForTimeout(1200);
      await p.screenshot({ path: `${SHOTS}/14-list-today-nowline-${vp.name}.png` });
    }
    assert(errs.length === 0, `${N} no page errors ${errs.join('; ')}`);
    await ctx.close();
  }
  await b.close(); console.log('ALL PASSED');
})().catch(e => { console.error(e); process.exit(1); });
