// Browser test: "Apply changes to…" dialog for repeating events (save / delete / drag), desktop + mobile.
//   node tests/scope_dialog.test.js http://127.0.0.1:8766/
const { chromium } = require(process.env.PW || '/workspace/shot-tools/node_modules/playwright-core');
const BASE = process.argv[2] || 'http://127.0.0.1:8766/';
const assert = (c, m) => { if (!c) throw new Error('FAIL: ' + m); console.log('ok -', m); };
(async () => {
  const b = await chromium.launch({ executablePath: '/usr/bin/google-chrome', headless: true, args: ['--no-sandbox'] });
  for (const vp of [{ width: 1300, height: 800, name: 'desktop' }, { width: 390, height: 800, name: 'mobile' }]) {
    const ctx = await b.newContext({ viewport: vp, timezoneId: 'America/Chicago', isMobile: vp.name === 'mobile', hasTouch: vp.name === 'mobile' });
    const p = await ctx.newPage(); const N = `[${vp.name}]`; const errs = []; p.on('pageerror', e => errs.push(e.message));
    await p.clock.install({ time: new Date('2026-10-19T15:00:00Z') });
    await p.goto(BASE); await p.evaluate(() => localStorage.clear()); await p.reload(); await p.waitForSelector('.fc');
    // seed: one weekly series + one one-off
    await p.evaluate(async () => {
      await Store.save({ id: 'ser1', kind: 'event', calendar: 'mam', category: 'Other', title: 'Weekly Lift', allDay: false,
        start: '2026-10-19T09:00', end: '2026-10-19T10:00', recurrence: { freq: 'weekly', interval: 1, byWeekday: [1, 3] } });
      await Store.save({ id: 'one1', kind: 'event', calendar: 'mam', category: 'Other', title: 'Solo Thing', allDay: false,
        start: '2026-10-20T13:00', end: '2026-10-20T14:00', recurrence: { freq: 'none' } });
    });
    await p.reload(); await p.waitForSelector('.fc');
    const open = async (id, occ) => { await p.evaluate(([id, occ]) => __app.openEditor ? __app.openEditor(id, occ) : null, [id, occ]); await p.waitForTimeout(300); };
    const hasOpen = await p.evaluate(() => !!(window.__app && __app.openEditor));
    assert(hasOpen, `${N} __app.openEditor exposed`);
    const scopeOpen = () => p.evaluate(() => document.getElementById('scopeDialog').open);
    const submit = () => p.click('#eventForm button[type=submit]');
    const list = () => p.evaluate(async () => Store.list());

    // radio removed
    assert(await p.locator('input[name=applyTo]').count() === 0, `${N} old radio removed`);
    // one-time event: no dialog
    await open('one1', null); await p.fill('#eventForm input[name=title]', 'Solo Thing 2'); await submit(); await p.waitForTimeout(300);
    assert(!(await scopeOpen()), `${N} no dialog for one-time event`);
    assert((await list()).find(e => e.id === 'one1').title === 'Solo Thing 2', `${N} one-time saved`);
    // only Today's Note changed: no dialog
    await open('ser1', '2026-10-21'); await submit(); await p.waitForTimeout(300);
    assert(!(await scopeOpen()), `${N} no dialog when nothing but note changed`);
    // cancel keeps editor open, nothing saved
    await open('ser1', '2026-10-21'); await p.fill('#eventForm input[name=title]', 'Changed');
    await submit(); await p.waitForTimeout(300);
    assert(await scopeOpen(), `${N} dialog shown for repeating occurrence`);
    assert(await p.textContent('#scopeTitle') === 'Apply changes to…', `${N} title`);
    assert(await p.evaluate(() => document.activeElement.id) === 'scopeOne', `${N} focus on first option`);
    await p.keyboard.press('Tab'); await p.keyboard.press('Tab'); await p.keyboard.press('Tab');
    assert(await p.evaluate(() => document.getElementById('scopeDialog').contains(document.activeElement)), `${N} focus trapped`);
    await p.keyboard.press('Escape'); await p.waitForTimeout(300);
    assert(!(await scopeOpen()) && await p.evaluate(() => document.getElementById('eventDialog').open), `${N} Escape cancels, editor stays`);
    assert((await list()).find(e => e.id === 'ser1').title === 'Weekly Lift', `${N} nothing saved on cancel`);
    // This event only
    await submit(); await p.waitForTimeout(250); await p.click('#scopeOne'); await p.waitForTimeout(400);
    let L = await list(); const exc = L.find(e => e.seriesId === 'ser1');
    assert(exc && exc.title === 'Changed' && exc.originalDate === '2026-10-21', `${N} this event only -> exception`);
    assert(L.find(e => e.id === 'ser1').exdates.includes('2026-10-21'), `${N} parent exdate`);
    // exception itself: no dialog
    await open(exc.id, null);
    await p.fill('#eventForm input[name=title]', 'Changed 2'); await submit(); await p.waitForTimeout(300);
    assert(!(await scopeOpen()), `${N} no dialog for changed occurrence`);
    // All events in the series (time shift)
    await open('ser1', '2026-10-26'); await p.fill('input[name=startTime]', '09:30'); await p.dispatchEvent('input[name=startTime]', 'change');
    await submit(); await p.waitForTimeout(250); await p.click('#scopeAll'); await p.waitForTimeout(400);
    L = await list(); const s = L.find(e => e.id === 'ser1');
    assert(s.start === '2026-10-19T09:30' && s.end === '2026-10-19T10:30', `${N} all -> series shifted (${s.start}-${s.end})`);
    // repeat-rule change disables "This event only"
    await open('ser1', '2026-10-26'); await p.fill('input[name=interval]', '2'); await submit(); await p.waitForTimeout(250);
    assert(await p.isDisabled('#scopeOne') && await p.isVisible('#scopeHint'), `${N} repeat change -> only "all" allowed`);
    await p.click('#scopeCancel'); await p.waitForTimeout(250); await p.evaluate(() => document.getElementById('eventDialog').close()); await p.waitForTimeout(250);
    // delete one
    await open('ser1', '2026-10-28'); await p.click('#deleteBtn'); await p.waitForTimeout(250);
    assert(await p.textContent('#scopeTitle') === 'Delete…', `${N} delete dialog`);
    await p.click('#scopeOne'); await p.waitForTimeout(400);
    assert((await list()).find(e => e.id === 'ser1').exdates.includes('2026-10-28'), `${N} delete this event only`);
    // drag via moveEvent: cancel reverts, all shifts
    const mv = choice => p.evaluate(async c => {
      let reverted = false; const st = new Date(Date.UTC(2026, 10, 2, 11, 30)), en = new Date(Date.UTC(2026, 10, 2, 12, 30));
      const pr = __app.moveEvent({ event: { start: st, end: en, allDay: false, extendedProps: { sourceId: 'ser1', occKey: '2026-11-02' } }, revert: () => { reverted = true; } });
      await new Promise(r => setTimeout(r, 300));
      document.getElementById(c).click(); await pr; return reverted;
    }, choice);
    if (await p.evaluate(() => !!__app.moveEvent)) {
      assert(await mv('scopeCancel') === true, `${N} drag cancel reverts`);
      await mv('scopeAll'); await p.waitForTimeout(200);
      const s2 = (await list()).find(e => e.id === 'ser1');
      assert(s2.start === '2026-10-19T11:30', `${N} drag all shifts series (${s2.start})`);
    }
    // delete all
    await open('ser1', '2026-11-02'); await p.click('#deleteBtn'); await p.waitForTimeout(250); await p.click('#scopeAll'); await p.waitForTimeout(400);
    assert(!(await list()).find(e => e.id === 'ser1'), `${N} delete all`);
    assert(!errs.length, `${N} no page errors ${errs.join(';')}`);
    await ctx.close();
  }
  await b.close();
})().catch(e => { console.error(e); process.exit(1); });
