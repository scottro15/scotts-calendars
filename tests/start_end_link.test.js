// Browser test: event form Start/End linkage (duration preserved, end clamped, min attrs), desktop + mobile.
//   node tests/start_end_link.test.js http://127.0.0.1:8766/
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
    const set = (n, v) => p.evaluate(([n, v]) => { const el = document.querySelector(`#eventForm [name=${n}], form [name=${n}]`); el.value = v; el.dispatchEvent(new Event('change', { bubbles: true })); }, [n, v]);
    const get = () => p.evaluate(() => { const g = n => document.querySelector(`form [name=${n}]`); return { sd: g('startDate').value, st: g('startTime').value, ed: g('endDate').value, et: g('endTime').value, edMin: g('endDate').min, etMin: g('endTime').min }; });
    await p.click('#addBtn'); await p.waitForTimeout(400);
    let v = await get(); assert(v.st === '09:00' && v.et === '10:00', `${N} new event default 1h`);
    await set('startDate', '2026-10-20'); v = await get();
    assert(v.ed === '2026-10-20' && v.et === '10:00', `${N} start date -> end date follows`);
    assert(v.edMin === '2026-10-20' && v.etMin === '09:00', `${N} end min attrs`);
    await set('startTime', '13:00'); v = await get(); assert(v.et === '14:00', `${N} start 1pm -> end 2pm`);
    await set('endTime', '16:00'); v = await get(); assert(v.et === '16:00', `${N} later end kept`);
    await set('startTime', '14:00'); v = await get(); assert(v.et === '17:00', `${N} duration 3h preserved`);
    await set('endTime', '13:00'); v = await get(); assert(v.et === '15:00' && v.ed === '2026-10-20', `${N} end before start -> start+1h`);
    await set('startTime', '23:30'); v = await get(); assert(v.ed === '2026-10-21' && v.et === '00:30', `${N} crosses midnight`);
    await p.check('#fAllDay'); await set('startDate', '2026-10-25'); v = await get();
    assert(v.ed >= '2026-10-25', `${N} all-day end >= start (${v.ed})`);
    await set('endDate', '2026-10-27'); await set('startDate', '2026-10-26'); v = await get(); assert(v.ed === '2026-10-28', `${N} all-day duration preserved`);
    await set('endDate', '2026-10-01'); v = await get(); assert(v.ed === '2026-10-26', `${N} all-day end clamped to start`);
    assert(!errs.length, `${N} no page errors ${errs.join(';')}`);
    await ctx.close();
  }
  await b.close();
})().catch(e => { console.error(e); process.exit(1); });
