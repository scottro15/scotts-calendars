// Browser test: "Today's Note" (day-specific occurrence notes) + Notes Review sidebar section + deep links.
//   node tests/day_notes_review.test.js http://127.0.0.1:8766/ [screenshotDir]   (copy served with an empty config.js)
const { chromium } = require(process.env.PW || '/workspace/shot-tools/node_modules/playwright-core');
const BASE = process.argv[2] || 'http://127.0.0.1:8766/'; const SHOTS = process.argv[3];
const assert = (c, m) => { if (!c) { throw new Error('FAIL: ' + m); } console.log('ok -', m); };
const T0 = new Date('2026-10-19T17:00:00Z'); // Mon Oct 19 2026, noon Chicago
(async () => {
  const b = await chromium.launch({ executablePath: '/usr/bin/google-chrome', headless: true, args: ['--no-sandbox'] });
  for (const vp of [{ width: 1300, height: 800, name: 'desktop' }, { width: 390, height: 800, name: 'mobile' }]) {
    const N = `[${vp.name}]`;
    const ctx = await b.newContext({ viewport: vp, timezoneId: 'America/Chicago', locale: 'en-US', isMobile: vp.name === 'mobile', hasTouch: vp.name === 'mobile' });
    const p = await ctx.newPage(); const errs = []; p.on('pageerror', e => errs.push(e.message));
    await p.clock.install({ time: T0 });
    await p.goto(BASE + '?view=listWeek'); await p.waitForSelector('.fc-list-event');
    await p.evaluate(() => localStorage.clear()); await p.reload(); await p.waitForSelector('.fc-list-event');
    const MV = 'tr.fc-list-event:has-text("Maryville University practice")';
    const seriesBefore = await p.evaluate(async () => JSON.stringify(await Store.list()));
    assert(await p.locator(MV).count() === 2, `${N} two Maryville occurrences this week`);

    // ---- write a day note on Tuesday's occurrence
    await p.locator(MV).nth(0).locator('a, td.fc-list-event-title').first().click();
    await p.waitForSelector('#dayNoteBox:not([hidden])');
    assert((await p.textContent('#dayNoteDate')).trim() === 'Note for Tuesday, Oct 20', `${N} header shows the occurrence date`);
    assert((await p.textContent('#dayNoteTitle')).includes("Today's Note — this date only"), `${N} section title`);
    assert((await p.textContent('#notesLabel')).trim() === 'Notes (every occurrence)', `${N} series notes relabelled`);
    const bg = await p.$eval('#dayNoteBox', el => getComputedStyle(el).backgroundColor);
    assert(bg !== 'rgba(0, 0, 0, 0)' && bg !== 'rgb(255, 255, 255)', `${N} day note visually distinct (${bg})`);
    await p.fill('#dayNote', 'Great energy. Work on closeouts.');
    await p.waitForTimeout(500); if (SHOTS) await p.screenshot({ path: `${SHOTS}/16-todays-note-editor-${vp.name}.png` });
    await p.click('#eventForm button[type=submit]'); await p.waitForTimeout(500);
    const st = await p.evaluate(async () => ({ evs: JSON.stringify(await Store.list()), notes: await Store.notes.all() }));
    assert(st.evs === seriesBefore, `${N} events untouched (no exception, no row change)`);
    assert(st.notes.length === 1 && st.notes[0].date === '2026-10-20' && st.notes[0].body === 'Great energy. Work on closeouts.', `${N} note stored for 2026-10-20 only`);
    await p.waitForTimeout(400);
    assert(await p.locator(MV).nth(0).evaluate(el => el.classList.contains('has-day-note') && !!el.querySelector('.day-note-dot')), `${N} indicator on Tuesday`);
    assert(!(await p.locator(MV).nth(1).evaluate(el => el.classList.contains('has-day-note'))), `${N} no indicator on Thursday`);

    // ---- Thursday's occurrence doesn't show it
    await p.locator(MV).nth(1).locator('a, td.fc-list-event-title').first().click();
    await p.waitForSelector('#dayNoteBox:not([hidden])');
    assert((await p.textContent('#dayNoteDate')).includes('Thursday, Oct 22') && (await p.inputValue('#dayNote')) === '', `${N} Thursday has its own empty note`);
    await p.click('#cancelBtn'); await p.waitForTimeout(400);

    // ---- empty deletes (autosave on cancel)
    await p.locator(MV).nth(0).locator('a, td.fc-list-event-title').first().click();
    await p.waitForSelector('#dayNoteBox:not([hidden])');
    assert((await p.inputValue('#dayNote')).startsWith('Great energy'), `${N} note shown again on Tuesday`);
    await p.fill('#dayNote', '   '); await p.click('#cancelBtn'); await p.waitForTimeout(600);
    assert((await p.evaluate(async () => (await Store.notes.all()).length)) === 0, `${N} empty note deleted`);
    assert((await p.evaluate(async () => JSON.stringify(await Store.list()))) === seriesBefore, `${N} events still untouched`);

    // ---- one-off event works too
    await p.evaluate(async () => {
      const ev = await Store.save({ kind: 'event', calendar: 'msc', category: 'Other', title: 'One-off talk', allDay: false, start: '2026-10-21T13:00', end: '2026-10-21T14:00', recurrence: { freq: 'none' }, notes: '' });
      window.__oneoff = ev.id;
    });
    // ---- seed notes for review
    await p.evaluate(async () => {
      const L = await Store.list(); const by = t => L.find(e => e.title.startsWith(t)).id;
      const mv = by('Maryville'), lt = by('Life Time shift'), st = by('Study block');
      await Store.notes.set(mv, '2026-10-20', 'Tue: closeouts');
      await Store.notes.set(mv, '2026-10-22', 'Thu: press break');
      await Store.notes.set(lt, '2026-10-19', 'Mon shift: pool pump noisy');
      await Store.notes.set(st, '2026-10-19', 'Study: chapter 3');
      await Store.notes.set(lt, '2026-11-02', 'Nov shift: inventory');
      await Store.notes.set(lt, '2027-01-05', 'Jan shift: new year');
      await Store.notes.set(window.__oneoff, '2026-10-21', 'Talk went well');
    });
    await p.reload(); await p.waitForSelector('.fc-list-event');
    if (vp.name === 'mobile') { await p.click('#menuBtn'); await p.waitForTimeout(300); }
    const cnt = () => p.locator('#reviewList .review-item').count();
    const tab = async s => { await p.click(`#reviewScope [data-scope=${s}]`); await p.waitForTimeout(250); };
    assert(await cnt() === 2, `${N} Day (today Mon Oct 19): 2 notes`);
    assert((await p.textContent('#reviewPeriod')).includes('Monday, October 19, 2026'), `${N} day title`);
    await p.click('#reviewChips button[data-date="2026-10-20"]'); await p.waitForTimeout(250);
    assert(await cnt() === 1 && (await p.textContent('#reviewList')).includes('Tue: closeouts'), `${N} Tue chip shows Tue note`);
    await p.fill('#reviewDate', '2026-10-21'); await p.dispatchEvent('#reviewDate', 'change'); await p.waitForTimeout(250);
    assert(await cnt() === 1 && (await p.textContent('#reviewList')).includes('One-off talk'), `${N} date picker + one-off event`);
    await p.click('#reviewNext'); await p.waitForTimeout(250);
    assert(await cnt() === 1 && (await p.textContent('#reviewList')).includes('press break'), `${N} next day`);
    await tab('week'); assert(await cnt() === 5, `${N} Week: 5 notes`);
    assert(await p.locator('#reviewList .review-day').count() === 4, `${N} Week grouped by 4 dates`);
    const meta = await p.locator('#reviewList .review-item .ri-meta').first().textContent();
    assert(/AM|PM|All day/.test(meta) && /MSC|Life Time|MAM/.test(meta), `${N} item shows time + calendar (${meta})`);
    await p.locator('#reviewSection').scrollIntoViewIfNeeded(); await p.waitForTimeout(300); if (SHOTS) await p.screenshot({ path: `${SHOTS}/16-notes-review-week-${vp.name}.png` });
    await tab('month'); assert(await cnt() === 5, `${N} Month (Oct): 5`);
    await p.click('#reviewNext'); await p.waitForTimeout(250); assert(await cnt() === 1, `${N} Month (Nov): 1`);
    await tab('season'); assert((await p.textContent('#reviewPeriod')).includes('Autumn 2026') && await cnt() === 6, `${N} Season Autumn 2026: 6`);
    await p.click('#reviewNext'); await p.waitForTimeout(250);
    assert((await p.textContent('#reviewPeriod')).includes('Winter 2026–27') && await cnt() === 1, `${N} Season Winter 2026–27: 1`);
    await tab('year'); assert((await p.textContent('#reviewPeriod')).trim() === '2027' && await cnt() === 1, `${N} Year 2027: 1`);
    await p.click('#reviewPrev'); await p.waitForTimeout(250); assert(await cnt() === 6, `${N} Year 2026: 6`);
    // filters
    await p.click('#reviewFilters summary');
    await p.uncheck('#reviewCals input[data-cal=lifetime]'); await p.waitForTimeout(250);
    assert(await cnt() === 4, `${N} calendar filter (no Life Time): 4`);
    await p.uncheck('#reviewCals input[data-cal=msc]'); await p.waitForTimeout(250);
    assert(await cnt() === 2, `${N} calendar filter (MAM only): 2`);
    await p.check('#reviewCals input[data-cal=lifetime]'); await p.check('#reviewCals input[data-cal=msc]'); await p.waitForTimeout(250);
    const opts = await p.$$eval('#reviewEvent option', os => os.map(o => o.textContent));
    assert(opts.length === 5 && opts.filter(o => o.startsWith('Life Time shift')).length === 1, `${N} event dropdown: series listed once (${opts.join(' | ')})`);
    const mvId = await p.$eval('#reviewEvent', s => [...s.options].find(o => o.textContent.startsWith('Maryville')).value);
    await p.selectOption('#reviewEvent', mvId); await p.waitForTimeout(250);
    assert(await cnt() === 2, `${N} event filter (Maryville): 2`);
    assert((await p.textContent('#reviewFilterSummary')).includes('1 on'), `${N} filter summary`);
    await p.click('#reviewClear'); await p.waitForTimeout(250);
    await p.fill('#reviewSearch', 'pool'); await p.waitForTimeout(450);
    assert(await cnt() === 1, `${N} search`);
    await p.click('#reviewClear'); await p.waitForTimeout(250); assert(await cnt() === 6, `${N} clear filters`);
    // empty state
    await tab('day'); await p.fill('#reviewDate', '2026-10-25'); await p.dispatchEvent('#reviewDate', 'change'); await p.waitForTimeout(250);
    assert(await cnt() === 0 && (await p.textContent('#reviewList')).includes("No Today's Notes"), `${N} empty state`);
    // tap opens that occurrence
    await p.fill('#reviewDate', '2026-10-22'); await p.dispatchEvent('#reviewDate', 'change'); await p.waitForTimeout(250);
    await p.click('#reviewList .review-item'); await p.waitForSelector('#dayNoteBox:not([hidden])');
    assert((await p.inputValue('#dayNote')) === 'Thu: press break' && (await p.textContent('#dayNoteDate')).includes('Thursday, Oct 22'), `${N} tap opens that occurrence`);
    await p.click('#cancelBtn'); await p.waitForTimeout(300);

    // deep links
    for (const [q, scope, n, title] of [['review=week&date=2026-10-19', 'week', 5, 'Oct 18'], ['review=month&date=2026-11-10', 'month', 1, 'November 2026'], ['review=day&date=2026-10-19', 'day', 2, 'October 19']]) {
      await p.goto(BASE + '?' + q); await p.waitForSelector('#reviewList'); await p.waitForTimeout(600);
      const s = await p.evaluate(() => window.__app.reviewState());
      assert(s.scope === scope && await cnt() === n && (await p.textContent('#reviewPeriod')).includes(title), `${N} deep link ?${q}`);
      if (vp.name === 'mobile') assert(await p.evaluate(() => document.getElementById('sidebar').classList.contains('open')), `${N} deep link opens the menu`);
    }
    // deep link survives a sign-in round trip (stored, then restored on the bare URL)
    await p.evaluate(() => localStorage.setItem('sandy.pendingReviewLink.v1', JSON.stringify({ review: 'month', date: '2026-10-05', cals: '', at: Date.now() })));
    await p.goto(BASE); await p.waitForSelector('#reviewList'); await p.waitForTimeout(600);
    assert((await p.evaluate(() => window.__app.reviewState())).scope === 'month' && await cnt() === 5, `${N} pending deep link restored after redirect`);
    assert(errs.length === 0, `${N} no page errors ${errs.join(' | ')}`);
    await ctx.close();
  }
  await b.close(); console.log('ALL DAY-NOTE/REVIEW TESTS PASSED');
})().catch(e => { console.error(e); process.exit(1); });
