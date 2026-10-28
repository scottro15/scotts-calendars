// Browser test: adding an event for TOMORROW saves on Android phones + tablets (and iPhone), t143u.
//   node tests/android_event_save.test.js http://127.0.0.1:8766/
// Root cause found 2026-10-28: "+ New" always opened the editor on TODAY even when Home was showing tomorrow,
// and a failed save only showed a toast hidden behind the open editor. Covers: + New defaults to the viewed day
// (Day / Week / Month, phone topbar + tablet rail), explicit tomorrow date, save lands + persists after reload,
// visible inline error on a failed save (editor stays open, nothing lost), hidden invalid field named, no double
// save on a double tap, Android back during an in-flight save, other device time zones / locales.
const { chromium } = require(process.env.PW || '/workspace/shot-tools/node_modules/playwright-core');
const BASE = process.argv[2] || 'http://127.0.0.1:8766/';
const assert = (c, m) => { if (!c) throw new Error('FAIL: ' + m); console.log('ok -', m); };
const UA = {
  redmi: 'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Mobile Safari/537.36',
  pixel: 'Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36',
  samsungTab: 'Mozilla/5.0 (Linux; Android 14; SM-X710) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/26.0 Chrome/122.0.0.0 Safari/537.36',
  iphone: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1',
};
const PROFILES = [
  ['redmi-note13pro-chrome', 393, 873, 2.75, UA.redmi], ['pixel7-chrome', 412, 915, 2.625, UA.pixel],
  ['galaxy-tab-samsung-portrait', 800, 1280, 2, UA.samsungTab], ['galaxy-tab-samsung-landscape', 1280, 800, 2, UA.samsungTab],
  ['galaxy-tab-s-samsung', 753, 1205, 2.4, UA.samsungTab], ['iphone', 390, 844, 3, UA.iphone],
];
(async () => {
  const b = await chromium.launch({ executablePath: '/usr/bin/google-chrome', headless: true, args: ['--no-sandbox'] });
  const errs = [];
  const mk = async (w, h, dpr, ua, extra = {}) => {
    const ctx = await b.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: dpr, userAgent: ua, isMobile: true, hasTouch: true, timezoneId: 'America/Chicago', serviceWorkers: 'block', ...extra });
    await ctx.addInitScript(() => { if (sessionStorage.getItem('__t')) return; sessionStorage.setItem('__t', '1'); localStorage.clear(); localStorage.setItem('sandy.welcome.off', '1'); localStorage.setItem('sandy.tour.off', '1'); });
    const p = await ctx.newPage(); p.on('pageerror', e => errs.push(e.message));
    await p.goto(BASE); await p.waitForSelector('.fc', { state: 'attached' }); await p.waitForTimeout(900);
    return { ctx, p };
  };
  const newBtn = async p => ((await p.$('#railNew')) && await p.$eval('#railNew', e => !!e.offsetParent)) ? '#railNew' : '#addBtn';
  const dates = p => p.evaluate(() => { const a = __app, t = a.nowWall(), d = n => { const x = new Date(t); x.setUTCDate(x.getUTCDate() + n); return a.ymd(x); }; return { today: d(0), tom: d(1), next7: d(7) }; });
  const mine = (p, re) => p.evaluate(async src => (await __app.Store.list()).filter(e => new RegExp(src).test(e.title)).map(e => ({ t: e.title, s: e.start })), re.source);
  const openNew = async p => { await p.tap(await newBtn(p)); await p.waitForSelector('#eventDialog[open]'); await p.waitForTimeout(450); };
  const save = async p => { await p.tap('#eventForm button[type=submit]'); await p.waitForTimeout(900); };

  for (const [name, w, h, dpr, ua] of PROFILES) {
    const N = `[${name}]`; const { ctx, p } = await mk(w, h, dpr, ua); const D = await dates(p);
    // A: Home Day view swiped to tomorrow → + New → title only → Save
    await p.evaluate(() => { SandyNav.go('home'); __app.calendar.changeView('timeGridDay'); __app.calendar.today(); __app.calendar.next(); }); await p.waitForTimeout(400);
    await openNew(p);
    assert(await p.$eval('input[name=startDate]', e => e.value) === D.tom, `${N} + New while viewing tomorrow opens on tomorrow (${D.tom})`);
    await p.fill('#event-title', 'Tmrw A ' + name); await save(p);
    assert(!(await p.$eval('#eventDialog', d => d.open)), `${N} editor closed after Save`);
    let got = await mine(p, /^Tmrw A/); assert(got.length === 1 && got[0].s.startsWith(D.tom), `${N} event saved on tomorrow ${JSON.stringify(got)}`);
    assert(await p.evaluate(() => __app.calendar.getEvents().some(e => /^Tmrw A/.test(e.title))), `${N} event visible on the tomorrow Day view`);
    // B: back to today, + New → today default; then pick tomorrow 2pm explicitly
    await p.evaluate(() => __app.calendar.today()); await p.waitForTimeout(300); await openNew(p);
    assert(await p.$eval('input[name=startDate]', e => e.value) === D.today, `${N} + New on today's view still opens on today`);
    await p.fill('#event-title', 'Tmrw B ' + name); await p.fill('input[name=startDate]', D.tom); await p.fill('input[name=startTime]', '14:00'); await save(p);
    got = await mine(p, /^Tmrw B/); assert(got.length === 1 && got[0].s === D.tom + 'T14:00', `${N} explicit tomorrow 2pm saved ${JSON.stringify(got)}`);
    // C: Week view of next week → + New lands on that week, not today
    await p.evaluate(() => { __app.calendar.changeView('timeGridWeek'); __app.calendar.today(); __app.calendar.next(); }); await p.waitForTimeout(300); await openNew(p);
    const wk = await p.$eval('input[name=startDate]', e => e.value); assert(wk > D.today && wk <= D.next7, `${N} + New on next week opens in that week (${wk})`);
    await p.tap('#cancelBtn'); await p.waitForTimeout(500);
    // D: persists after reload
    await p.reload(); await p.waitForSelector('.fc', { state: 'attached' }); await p.waitForTimeout(900);
    assert((await mine(p, /^Tmrw [AB]/)).length === 2, `${N} both tomorrow events persist after reload`);
    await ctx.close();
  }

  // Failure paths (Redmi profile)
  { const N = '[redmi failures]'; const { ctx, p } = await mk(393, 873, 2.75, UA.redmi);
    await p.evaluate(() => { window.__orig = __app.Store.save; __app.Store.save = async () => { throw new Error('Failed to fetch'); }; });
    await openNew(p); await p.fill('#event-title', 'Will fail'); await save(p);
    assert(await p.$eval('#eventDialog', d => d.open), `${N} editor stays open when the save fails`);
    const err = await p.evaluate(() => { const e = document.getElementById('eventErr'); const r = e.getBoundingClientRect(); const top = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2); return { shown: !e.hidden, txt: e.textContent, onTop: !!top && (top === e || e.contains(top)) }; });
    assert(err.shown && /Could not save: Failed to fetch/.test(err.txt) && err.onTop, `${N} visible inline error above Save: "${err.txt}"`);
    assert(await p.$eval('#event-title', e => e.value) === 'Will fail', `${N} typed title kept for retry`);
    assert(await p.$eval('#eventForm button[type=submit]', b => !b.disabled && b.textContent === 'Save'), `${N} Save button re-enabled`);
    // retry succeeds
    await p.evaluate(() => { __app.Store.save = window.__orig; }); await save(p);
    assert(!(await p.$eval('#eventDialog', d => d.open)) && (await mine(p, /^Will fail/)).length === 1, `${N} retry after the error saves`);
    // hidden invalid field gets named instead of failing silently
    await openNew(p); await p.fill('#event-title', 'Invalid end');
    await p.evaluate(() => { const f = document.getElementById('eventForm'); f.until.min = '2099-01-01'; f.until.value = '2026-01-01'; });
    await save(p);
    const inv = await p.evaluate(() => ({ open: document.getElementById('eventDialog').open, shown: !document.getElementById('eventErr').hidden, txt: document.getElementById('eventErr').textContent }));
    assert(inv.open && inv.shown && /Not saved yet/.test(inv.txt), `${N} invalid (even hidden) field shows an inline message: "${inv.txt}"`);
    await p.tap('#cancelBtn'); await p.waitForTimeout(500);
    // double tap → one event; Android back gesture mid-save → still saved once
    await p.evaluate(() => { const o = __app.Store.save.bind(__app.Store); __app.Store.save = async ev => { await new Promise(r => setTimeout(r, 700)); return o(ev); }; });
    await openNew(p); await p.fill('#event-title', 'Double tap');
    const bb = await p.$eval('#eventForm button[type=submit]', e => { const r = e.getBoundingClientRect(); return [r.x + r.width / 2, r.y + r.height / 2]; });
    await p.touchscreen.tap(...bb); await p.waitForTimeout(60); await p.touchscreen.tap(...bb); await p.waitForTimeout(60);
    assert(await p.$eval('#eventForm button[type=submit]', b => b.disabled && /Saving/.test(b.textContent)), `${N} Save shows "Saving…" while in flight`);
    await p.waitForTimeout(1500); assert((await mine(p, /^Double tap/)).length === 1, `${N} double tap saves exactly once`);
    await openNew(p); await p.fill('#event-title', 'Back mid save'); await p.tap('#eventForm button[type=submit]'); await p.waitForTimeout(150);
    await p.goBack().catch(() => {}); await p.waitForTimeout(1600);
    assert((await mine(p, /^Back mid save/)).length === 1, `${N} back gesture during the save does not lose the event`);
    assert(await p.evaluate(() => !!document.querySelector('.fc')), `${N} still in the app after back`);
    await ctx.close(); }

  // Device clock in another zone / locale: "tomorrow" follows the SANDY profile day (America/Chicago)
  for (const [tz, locale] of [['Asia/Tokyo', 'en-GB'], ['America/Los_Angeles', 'de-DE'], ['UTC', 'en-IN']]) {
    const N = `[redmi ${tz} ${locale}]`; const { ctx, p } = await mk(393, 873, 2.75, UA.redmi, { timezoneId: tz, locale });
    const D = await dates(p);
    await p.evaluate(() => { __app.calendar.changeView('timeGridDay'); __app.calendar.today(); __app.calendar.next(); }); await p.waitForTimeout(300);
    await openNew(p); assert(await p.$eval('input[name=startDate]', e => e.value) === D.tom, `${N} + New on tomorrow → ${D.tom}`);
    await p.fill('#event-title', 'TZ ' + tz); await save(p);
    const got = await mine(p, /^TZ /); assert(got.length === 1 && got[0].s === D.tom + 'T09:00', `${N} saved ${JSON.stringify(got)}`);
    await ctx.close();
  }
  assert(errs.length === 0, 'no page errors ' + errs.join(' | '));
  await b.close(); console.log('ALL PASS');
})().catch(e => { console.error(e); process.exit(1); });
