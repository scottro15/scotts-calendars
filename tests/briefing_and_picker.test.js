// Browser test: Briefing panel (Day/Week/Month/Season + season chips) and the month/year picker.
// Local mode only (no Supabase). Run against a copy served with an empty config.js:
//   node tests/briefing_and_picker.test.js http://127.0.0.1:8766/
const { chromium } = require(process.env.PW || '/workspace/shot-tools/node_modules/playwright-core');
const BASE = process.argv[2] || 'http://127.0.0.1:8766/';
const assert = (c, m) => { if (!c) { throw new Error('FAIL: ' + m); } console.log('ok -', m); };
(async () => {
  const b = await chromium.launch({ executablePath: '/usr/bin/google-chrome', headless: true, args: ['--no-sandbox'] });
  for (const vp of [{ width: 1300, height: 900, name: 'desktop' }, { width: 390, height: 844, name: 'mobile' }]) {
    const ctx = await b.newContext({ viewport: vp, timezoneId: 'Asia/Tokyo', locale: 'en-US', hasTouch: vp.name === 'mobile', isMobile: vp.name === 'mobile' });
    const p = await ctx.newPage(); const errs = [];
    p.on('pageerror', e => errs.push(e.message)); p.on('console', m => { if (m.type() === 'error') errs.push(m.text()); });
    await p.goto(BASE + '?view=dayGridMonth'); await p.waitForSelector('.fc-event');
    await p.evaluate(() => localStorage.clear()); await p.reload(); await p.waitForSelector('.fc-event'); await p.waitForTimeout(300);
    const N = `[${vp.name}]`;

    // ---- pure helpers: meteorological seasons
    const s = await p.evaluate(() => {
      const { seasonOf, seasonPeriod, seasonTitle, parseLocal: P, ymd } = __app;
      const per = (n, d) => seasonPeriod(n, P(d)).map(ymd).join('/');
      return {
        of: ['2026-03-01', '2026-05-31', '2026-06-01', '2026-08-31', '2026-09-01', '2026-11-30', '2026-12-01', '2027-01-15', '2027-02-28'].map(d => seasonOf(P(d))),
        spring: per('spring', '2026-10-19'), summer: per('summer', '2026-10-19'), autumn: per('autumn', '2026-10-19'),
        winterOct: per('winter', '2026-10-19'), winterJan: per('winter', '2027-01-10'), springJan: per('spring', '2027-01-10'),
        title: seasonTitle('winter', P('2026-10-19')), y50: per('summer', '0050-07-01'),
      };
    });
    assert(s.of.join() === 'spring,spring,summer,summer,autumn,autumn,winter,winter,winter', `${N} seasonOf boundaries (${s.of})`);
    assert(s.spring === '2026-03-01/2026-06-01' && s.summer === '2026-06-01/2026-09-01' && s.autumn === '2026-09-01/2026-12-01', `${N} spring/summer/autumn ranges`);
    assert(s.winterOct === '2026-12-01/2027-03-01', `${N} winter of 2026 = Dec 2026–Feb 2027 (${s.winterOct})`);
    assert(s.winterJan === '2026-12-01/2027-03-01' && s.springJan === '2027-03-01/2027-06-01', `${N} from Jan 2027: winter is the containing one, spring is 2027`);
    assert(s.title === 'Winter 2026–27 (Dec–Feb)', `${N} winter title (${s.title})`);
    assert(s.y50 === '0050-06-01/0050-09-01', `${N} works for year 50 (${s.y50})`);

    // ---- default: Day = today (Chicago), with today's visible events
    assert(await p.isVisible('#briefing'), `${N} briefing visible`);
    assert(await p.getAttribute('#briefScope [data-scope=day]', 'aria-pressed') === 'true', `${N} Day selected by default`);
    const today = await p.evaluate(() => __app.ymd(__app.nowWall()));
    const expectDay = await p.evaluate(async () => {
      const t = __app.parseLocal(__app.ymd(__app.nowWall()));
      const all = await Store.list(); const vis = { msc: true, mam: true, lifetime: true };
      return __app.briefingItems(all, t, new Date(t.getTime() + 864e5), 'day', vis).map(r => r.ev.title);
    });
    const shownDay = await p.locator('#briefList .bi-title').allTextContents();
    assert(JSON.stringify(shownDay) === JSON.stringify(expectDay), `${N} Day list matches today's items (${shownDay.length})`);
    const period = await p.textContent('#briefPeriod');
    const longToday = new Date(today + 'T12:00:00Z').toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
    assert(period === longToday, `${N} Day period label is today (${period})`);
    assert(!(await p.isVisible('#briefSeasons')), `${N} season chips hidden outside Season mode`);

    // ---- Week: grouped by day, all 7 days of the visible week range
    await p.click('#briefScope [data-scope=week]');
    assert(/^Week of /.test(await p.textContent('#briefPeriod')), `${N} week label`);
    const days = await p.locator('#briefList .brief-day').count();
    assert(days >= 5 && days <= 7, `${N} week grouped into day headers (${days})`);
    const wkTasks = await p.locator('#briefList .brief-item:has-text("Review maintenance work orders")').count();
    assert(wkTasks === 1, `${N} week-scope task included in Week`);
    const dayTaskInWeek = await p.locator('#briefList .brief-item:has-text("Facility walk-through")').count();
    assert(dayTaskInWeek === 0, `${N} day-scope tasks not repeated in Week`);

    // ---- respects calendar toggles
    await p.click('#briefScope [data-scope=month]');
    const monthAll = await p.locator('#briefList .brief-item').count();
    await p.evaluate(() => { const cb = document.querySelector('#calToggles input[data-cal=lifetime]'); cb.checked = false; cb.dispatchEvent(new Event('change', { bubbles: true })); });
    await p.waitForTimeout(300);
    const lifetimeShown = await p.locator('#briefList .bi-cal', { hasText: /^Life Time$/ }).count();
    const monthNoLT = await p.locator('#briefList .brief-item').count();
    assert(lifetimeShown === 0 && monthNoLT < monthAll, `${N} hiding Life Time removes it from the briefing (${monthAll} -> ${monthNoLT})`);
    await p.evaluate(() => { const cb = document.querySelector('#calToggles input[data-cal=lifetime]'); cb.checked = true; cb.dispatchEvent(new Event('change', { bubbles: true })); });
    await p.waitForTimeout(300);

    // ---- Month follows calendar navigation
    const m0 = await p.textContent('#briefPeriod');
    await p.click('.fc-next-button'); await p.waitForTimeout(300);
    const m1 = await p.textContent('#briefPeriod');
    assert(m0 !== m1 && /\d{4}$/.test(m1), `${N} Month follows calendar (${m0} -> ${m1})`);
    await p.click('.fc-today-button'); await p.waitForTimeout(300);

    // ---- Season: default containing view date; chips switch within the viewed year
    await p.click('#briefScope [data-scope=season]');
    assert(await p.isVisible('#briefSeasons'), `${N} season chips visible`);
    const cur = await p.evaluate(() => __app.seasonOf(__app.viewRef()));
    assert(await p.getAttribute(`#briefSeasons [data-season=${cur}]`, 'aria-pressed') === 'true', `${N} default season = ${cur}`);
    const vy = await p.evaluate(() => __app.viewRef().getUTCFullYear());
    await p.click('#briefSeasons [data-season=spring]');
    assert(await p.textContent('#briefPeriod') === `Spring ${vy} (Mar–May)`, `${N} tapping Spring shows Spring ${vy}`);
    await p.click('#briefSeasons [data-season=summer]');
    assert(await p.textContent('#briefPeriod') === `Summer ${vy} (Jun–Aug)`, `${N} tapping Summer shows Summer ${vy}`);
    assert(await p.getAttribute('#briefSeasons [data-season=summer]', 'aria-pressed') === 'true', `${N} Summer pressed`);

    // ---- Month/year picker from the title
    const title = p.locator('.fc-toolbar-title');
    assert(await title.getAttribute('role') === 'button' && await title.getAttribute('tabindex') === '0', `${N} title is a keyboard-focusable button`);
    await title.click();
    assert(await p.isVisible('#monthPicker'), `${N} picker opens on tap`);
    assert(+(await p.inputValue('#mpYear')) === vy, `${N} picker starts at viewed year`);
    await p.click('#mpNextYear'); await p.click('#mpNextYear'); await p.click('#mpPrevYear');
    assert(+(await p.inputValue('#mpYear')) === vy + 1, `${N} prev/next year buttons`);
    await p.fill('#mpYear', '2031'); await p.click('#mpMonths [data-month="6"]'); await p.waitForTimeout(300);
    assert(!(await p.isVisible('#monthPicker')), `${N} picker closes after choosing`);
    assert(/July 2031/.test(await title.textContent()), `${N} calendar jumped to July 2031 (${await title.textContent()})`);
    assert(await p.textContent('#briefPeriod') === 'Summer 2031 (Jun–Aug)', `${N} briefing season follows to 2031 (${await p.textContent('#briefPeriod')})`);
    await p.click('#briefSeasons [data-season=winter]');
    assert(await p.textContent('#briefPeriod') === 'Winter 2031–32 (Dec–Feb)', `${N} winter within 2031`);
    // keyboard open + far year
    await title.focus(); await p.keyboard.press('Enter');
    assert(await p.isVisible('#monthPicker'), `${N} picker opens with Enter`);
    await p.fill('#mpYear', '1999'); await p.click('#mpMonths [data-month="0"]'); await p.waitForTimeout(300);
    assert(/January 1999/.test(await title.textContent()), `${N} jump to January 1999`);
    await p.click('#briefScope [data-scope=month]');
    assert(await p.textContent('#briefPeriod') === 'January 1999', `${N} briefing month follows picker`);
    // invalid year doesn't navigate
    await title.click(); await p.fill('#mpYear', '0'); await p.click('#mpMonths [data-month="3"]');
    assert(await p.isVisible('#monthPicker') && /January 1999/.test(await title.textContent()), `${N} invalid year is rejected`);
    await p.keyboard.press('Escape');
    // "This month" button returns to today
    await title.click(); await p.click('#mpToday'); await p.waitForTimeout(300);
    const thisMonth = new Date(today + 'T12:00:00Z').toLocaleDateString('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' });
    assert(await p.textContent('#briefPeriod') === thisMonth, `${N} "This month" goes back (${thisMonth})`);

    // ---- collapse persists
    await p.click('#briefCollapse');
    assert(!(await p.isVisible('#briefBody')) && await p.getAttribute('#briefCollapse', 'aria-expanded') === 'false', `${N} collapse hides body`);
    await p.reload(); await p.waitForSelector('.fc-event');
    assert(!(await p.isVisible('#briefBody')), `${N} collapsed state persists`);
    await p.click('#briefCollapse'); assert(await p.isVisible('#briefBody'), `${N} expand again`);

    // ---- clicking a briefing item opens the editor (no save)
    await p.click('#briefScope [data-scope=week]');
    await p.locator('#briefList .brief-item').first().click();
    assert(await p.isVisible('#eventDialog'), `${N} tapping a briefing item opens it`);
    await p.click('#cancelBtn');
    assert(errs.length === 0, `${N} no page errors ${errs.join(' | ')}`);
    await ctx.close();
  }
  await b.close();
  console.log('ALL BRIEFING/PICKER TESTS PASSED');
})().catch(e => { console.error(e.message); process.exit(1); });
