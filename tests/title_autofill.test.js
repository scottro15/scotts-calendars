// Title autofill from past events (t148u item 2). Local mode.
//   node tests/title_autofill.test.js http://127.0.0.1:8793/      (SHOTS=/dir/, ONLY=dev1,dev2)
// iPhone 15 / SE, iPad Pro 11 portrait + landscape (sidebar layout), iPad mini, Android phone (Chrome) and
// Galaxy Tab (Samsung Internet) portrait + landscape; light + dark. Checks ranking/no dupes/no example rows,
// keep-typing, ↑↓+Enter, tap, Escape, tap outside, Android Back (list first, then editor), fill of calendar /
// category / kind / time + duration / location / notes / reminders with the creating date kept, save, no list
// when editing, 16px field (no iOS zoom), autocomplete=off, enter/leave animation, local cache.
const PW = require(process.env.PW || '/workspace/shot-tools/node_modules/playwright-core');
const fs = require('fs');
const BASE = process.argv[2] || 'http://127.0.0.1:8793/';
const SHOT = process.env.SHOTS || '/workspace/shots-oct29/autofill/'; fs.mkdirSync(SHOT, { recursive: true });
let fails = 0; const assert = (c, m) => { if (!c) { fails++; console.log('FAIL -', m); } else console.log('ok -', m); };
const SAM = 'Mozilla/5.0 (Linux; Android 14; SM-X710) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/26.0 Chrome/122.0.0.0 Safari/537.36';
const DROID = 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Mobile Safari/537.36';
const DEV = [
  ['iphone-15', 'webkit', { device: 'iPhone 15' }], ['iphone-se', 'webkit', { device: 'iPhone SE' }],
  ['ipad-pro11-portrait', 'webkit', { device: 'iPad Pro 11' }], ['ipad-pro11-landscape', 'webkit', { device: 'iPad Pro 11 landscape' }],
  ['ipad-mini', 'webkit', { device: 'iPad Mini' }],
  ['android-phone', 'chromium', { w: 412, h: 915, ua: DROID, android: true }],
  ['galaxy-tab-portrait', 'chromium', { w: 800, h: 1280, ua: SAM, android: true }], ['galaxy-tab-landscape', 'chromium', { w: 1280, h: 800, ua: SAM, android: true }],
];
const ONLY = process.env.ONLY ? process.env.ONLY.split(',') : null;
const SEED = d => [
  ...[1, 2, 3].map(i => ({ id: 'f' + i, kind: 'event', title: i === 2 ? 'film study – maryville' : 'Film study – Maryville', calendar: 'mam', category: 'Film study', allDay: false,
    start: `${d(-7 * i)}T15:30`, end: `${d(-7 * i)}T17:00`, location: '650 Maryville University Dr', notes: 'Bring laptop\n- [ ] clips', reminders: [30, 1440],
    recurrence: { freq: 'none' }, updatedAt: new Date(Date.now() - i * 864e5).toISOString(), createdAt: new Date(Date.now() - i * 864e5).toISOString() })),
  { id: 'f4', kind: 'event', title: 'Film night', calendar: 'msc', category: 'Other', allDay: false, start: `${d(-200)}T19:00`, end: `${d(-200)}T21:00`, recurrence: { freq: 'none' }, updatedAt: new Date(Date.now() - 200 * 864e5).toISOString() },
  { id: 'f5', kind: 'event', title: 'Team film', calendar: 'mam', category: 'Meeting', allDay: false, start: `${d(-1)}T08:00`, end: `${d(-1)}T08:45`, recurrence: { freq: 'none' }, updatedAt: new Date(Date.now() - 864e5).toISOString() },
  { id: 'f6', kind: 'event', title: 'Film demo', example: true, calendar: 'msc', category: 'Other', allDay: false, start: `${d(-2)}T08:00`, end: `${d(-2)}T09:00`, recurrence: { freq: 'none' } },
  { id: 'f7', kind: 'task', title: 'Fitness program upload', calendar: 'lifetime', category: 'Task / to-do', allDay: true, start: d(-3), end: d(-3), scope: 'week', recurrence: { freq: 'none' }, reminders: [60], updatedAt: new Date(Date.now() - 3 * 864e5).toISOString() },
  { id: 'f8', kind: 'event', title: 'Fitness class', calendar: 'lifetime', category: 'Event', allDay: false, start: `${d(-4)}T06:00`, end: `${d(-4)}T07:00`, recurrence: { freq: 'none' }, updatedAt: new Date(Date.now() - 4 * 864e5).toISOString() },
];

(async () => {
  const br = { webkit: await PW.webkit.launch(), chromium: await PW.chromium.launch({ executablePath: '/usr/bin/google-chrome', headless: true, args: ['--no-sandbox'] }) };
  const jobs = [];
  for (const [name, eng, o] of DEV) { if (ONLY && !ONLY.includes(name)) continue; for (const dark of [false, true]) jobs.push([name, eng, o, dark]); }
  const runOne = async ([name, eng, o, dark]) => {
    const N = `[${name}${dark ? ' dark' : ''}]`; const mode = dark ? 'dark' : 'light';
    const dev = o.device ? { ...PW.devices[o.device] } : { viewport: { width: o.w, height: o.h }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, userAgent: o.ua };
    delete dev.defaultBrowserType; if (eng === 'webkit') delete dev.isMobile;
    const ctx = await br[eng].newContext({ ...dev, timezoneId: 'America/Chicago', serviceWorkers: 'block' });
    await ctx.addInitScript(dark => {
      if (!sessionStorage.getItem('__t')) { sessionStorage.setItem('__t', '1'); localStorage.clear(); localStorage.setItem('sandy.welcome.off', '1'); localStorage.setItem('sandy.tour.off', '1'); if (dark) localStorage.setItem('sandy.theme', 'dark'); }
    }, dark);
    const p = await ctx.newPage(); const errs = []; p.on('pageerror', e => errs.push(e.message));
    await p.goto(BASE); await p.waitForSelector('.fc', { state: 'attached' }); await p.waitForTimeout(800);
    const D = await p.evaluate(() => { const a = __app, t = a.nowWall(), d = n => { const x = new Date(t); x.setUTCDate(x.getUTCDate() + n); return a.ymd(x); }; return { today: d(0), other: d(12) }; });
    await p.evaluate(async src => { const a = __app, t = a.nowWall(), d = n => { const x = new Date(t); x.setUTCDate(x.getUTCDate() + n); return a.ymd(x); }; await a.Store.saveMany(eval(src)(d)); }, SEED.toString());
    const list = () => p.$$eval('#titleAcList li .ac-main', a => a.map(x => x.textContent));
    const shown = () => p.$eval('#titleAcPop', e => !e.hidden && !e.classList.contains('tac-leaving'));
    const gone = async () => { await p.waitForTimeout(220); return p.$eval('#titleAcPop', e => e.hidden); };
    const newBtn = async () => ((await p.$('#railNew')) && await p.$eval('#railNew', e => !!e.offsetParent)) ? '#railNew' : '#addBtn';
    const openNew = async (date) => {
      if (date) await p.evaluate(dt => __app.openEditor(null, null, { start: dt + 'T09:00', end: dt + 'T10:00' }), date);
      else await p.tap(await newBtn());
      await p.waitForSelector('#eventDialog[open]'); await p.waitForTimeout(400);
    };
    const typeTitle = async s => { await p.locator('#event-title').tap(); await p.keyboard.type(s, { delay: 15 }); await p.waitForTimeout(250); };
    const isOpen = () => p.$eval('#eventDialog', d => d.open);

    await p.evaluate(() => SandyNav.go('today')); await p.waitForTimeout(400);
    // field basics
    await openNew();
    const fb = await p.$eval('#event-title', e => ({ fs: parseFloat(getComputedStyle(e).fontSize), ac: e.getAttribute('autocomplete'), role: e.getAttribute('role') }));
    assert(fb.ac === 'off' && fb.role === 'combobox', `${N} title field autocomplete=off, combobox role`);
    if (name.startsWith('iphone') || name.startsWith('ipad')) assert(fb.fs >= 16, `${N} title field ≥16px, no iOS zoom (${fb.fs})`);
    await typeTitle('f');
    assert(!(await shown()), `${N} 1 letter: no list yet`);
    await p.keyboard.type('il'); await p.waitForTimeout(80);
    const anim = await p.$eval('#titleAcPop', e => getComputedStyle(e).animationName === 'tacIn');
    await p.waitForTimeout(200);
    let L = await list();
    assert(await shown() && L[0] === 'Film study – Maryville', `${N} "fil": most used title first ${JSON.stringify(L)}`);
    assert(new Set(L.map(x => x.toLowerCase())).size === L.length && L.filter(x => /film study/i.test(x)).length === 1, `${N} no duplicate titles`);
    assert(!L.includes('Film demo'), `${N} example events never suggested`);
    assert(L.indexOf('Film night') < L.indexOf('Team film'), `${N} prefix matches rank before mid-title matches`);
    assert(anim, `${N} list has an enter animation`);
    const sec = await p.$eval('#titleAcList li .ac-sec', e => e.textContent);
    assert(/Minds Above Matters/.test(sec) && /3:30/.test(sec) && /1h 30m/.test(sec), `${N} row shows calendar, time and length (${sec})`);
    await p.waitForFunction(() => getComputedStyle(document.getElementById('titleAcPop')).opacity === '1'); await p.waitForTimeout(100);
    await p.screenshot({ path: `${SHOT}${name}-list-${mode}.png` });
    // keep typing to narrow, then to ignore
    await p.keyboard.type('m s'); await p.waitForTimeout(200); L = await list();
    assert(L.length === 1 && L[0] === 'Film study – Maryville', `${N} keep typing narrows the list ${JSON.stringify(L)}`);
    await p.keyboard.type('zzq'); 
    assert(await gone(), `${N} no match: list goes away, typed text kept`);
    assert(await p.$eval('#event-title', e => e.value) === 'film szzq', `${N} typed text untouched`);
    // tap outside closes
    await p.fill('#event-title', ''); await typeTitle('fit');
    assert(await shown(), `${N} list for "fit"`);
    await p.locator('#eventDialog h2').tap();
    assert(await gone() && await isOpen(), `${N} tap outside closes the list, editor stays`);
    // Escape closes list only
    await p.fill('#event-title', ''); await typeTitle('fit'); await p.keyboard.press('Escape');
    assert(await gone() && await isOpen(), `${N} Escape closes the list, not the editor`);
    await p.tap('#cancelBtn'); await p.waitForTimeout(400);

    // keyboard pick on another date
    await openNew(D.other); await typeTitle('fil');
    await p.keyboard.press('ArrowDown'); await p.keyboard.press('ArrowDown'); await p.keyboard.press('ArrowUp');
    const hi = await p.$eval('#titleAcList li[aria-selected=true] .ac-main', e => e.textContent);
    assert(hi === 'Film study – Maryville', `${N} arrow keys move the highlight`);
    await p.keyboard.press('Enter'); await p.waitForTimeout(250);
    const F = await p.evaluate(() => { const g = n => document.querySelector(`#eventForm [name="${n}"]`); return { open: document.getElementById('eventDialog').open, title: g('event-title').value, cal: g('calendar').value, cat: g('category').value, kind: document.querySelector('input[name=kind]:checked').value, sd: g('startDate').value, st: g('startTime').value, ed: g('endDate').value, et: g('endTime').value, loc: g('location').value, notes: g('event-notes').value, rem: document.querySelectorAll('#remList > *').length, popHidden: document.getElementById('titleAcPop').hidden || document.getElementById('titleAcPop').classList.contains('tac-leaving') }; });
    assert(F.open && F.title === 'Film study – Maryville', `${N} Enter picks (doesn't submit) ${JSON.stringify(F)}`);
    assert(F.cal === 'mam' && F.cat === 'Film study' && F.kind === 'event', `${N} calendar + category (colour/style) filled`);
    assert(F.sd === D.other && F.ed === D.other && F.st === '15:30' && F.et === '17:00', `${N} time of day + 1h30 duration filled, creating date kept`);
    assert(F.loc === '650 Maryville University Dr' && /Bring laptop/.test(F.notes) && F.rem === 2, `${N} location, notes and both reminders filled`);
    assert(F.popHidden, `${N} list closes after the pick`);
    await p.screenshot({ path: `${SHOT}${name}-filled-${mode}.png` });
    await p.tap('#eventForm button[type=submit]'); await p.waitForTimeout(700);
    const saved = await p.evaluate(async d => (await __app.Store.list()).filter(e => e.start.startsWith(d) && /^Film study/.test(e.title)).map(e => ({ s: e.start, e: e.end, c: e.calendar, cat: e.category, r: e.reminders, loc: e.location })), D.other);
    assert(!(await isOpen()) && saved.length === 1 && saved[0].s === D.other + 'T15:30' && saved[0].e === D.other + 'T17:00' && saved[0].c === 'mam' && saved[0].r.length === 2, `${N} saves on the chosen date ${JSON.stringify(saved)}`);

    // tap pick of a to-do (kind/scope/all-day) on today
    await openNew(D.today); await typeTitle('fitness p');
    await p.locator('#titleAcList li').first().tap(); await p.waitForTimeout(250);
    const T = await p.evaluate(() => ({ kind: document.querySelector('input[name=kind]:checked').value, cal: document.getElementById('fCalendar').value, allDay: document.querySelector('[name=allDay]').checked, scope: document.querySelector('[name=scope]').value, sd: document.querySelector('[name=startDate]').value, title: document.getElementById('event-title').value }));
    assert(T.title === 'Fitness program upload' && T.kind === 'task' && T.cal === 'lifetime' && T.allDay && T.scope === 'week' && T.sd === D.today, `${N} tap pick of a to-do fills kind/scope/all-day ${JSON.stringify(T)}`);
    // the newly-saved event now ranks (index refreshed + cached per user)
    await p.fill('#event-title', ''); await typeTitle('film');
    const cache = await p.evaluate(() => Object.keys(localStorage).filter(k => k.startsWith('sandy.titleac.')).map(k => JSON.parse(localStorage.getItem(k)).items.length));
    assert(cache.length === 1 && cache[0] >= 5, `${N} index cached locally (${cache})`);
    assert((await p.$$eval('#titleAcList .tac-n', a => a.map(x => x.textContent)))[0] === '×4', `${N} frequency counts include the event just saved`);
    if (o.android) {
      await p.evaluate(() => history.back()); await p.waitForTimeout(400);
      assert(await gone() && await isOpen(), `${N} Android Back closes the list first`);
      await p.evaluate(() => history.back()); await p.waitForTimeout(500);
      assert(!(await isOpen()), `${N} second Back closes the editor`);
    } else { await p.tap('#cancelBtn'); await p.waitForTimeout(400); }

    // editing an existing event: no suggestions
    await p.evaluate(() => __app.openEditor('f5')); await p.waitForSelector('#eventDialog[open]'); await p.waitForTimeout(300);
    await p.fill('#event-title', ''); await typeTitle('fil');
    assert(await p.$eval('#titleAcPop', e => e.hidden), `${N} no autofill list while editing an existing event`);
    await p.tap('#cancelBtn'); await p.waitForTimeout(300);
    assert(!errs.length, `${N} no page errors ${errs.join(' | ')}`);
    await ctx.close();
  };
  const q = jobs.slice(); await Promise.all([0, 1, 2].map(async () => { while (q.length) { const j = q.shift(); try { await runOne(j); } catch (e) { fails++; console.log('FAIL -', j[0], j[3] ? 'dark' : 'light', e.message.split('\n')[0]); } } }));
  await br.webkit.close(); await br.chromium.close();
  console.log(fails ? `${fails} FAILED` : 'TITLE AUTOFILL TESTS PASSED'); process.exit(fails ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
