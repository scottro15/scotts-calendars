// Browser test: SI #4 Free-gap to-do coach. Local mode, 390px.
//   node tests/freegap_ui.test.js http://127.0.0.1:8778/ /workspace/shots-si4
const { chromium } = require(process.env.PW || '/workspace/shot-tools/node_modules/playwright-core');
const fs = require('fs');
const BASE = process.argv[2] || 'http://127.0.0.1:8778/';
const SHOTS = process.argv[3] || '/workspace/shots-si4';
fs.mkdirSync(SHOTS, { recursive: true });
const assert = (c, m) => { if (!c) throw new Error('FAIL: ' + m); console.log('ok -', m); };

(async () => {
  const b = await chromium.launch({ executablePath: '/usr/bin/google-chrome', headless: true, args: ['--no-sandbox'] });
  async function open({ at, dark = false }) {
    const ctx = await b.newContext({
      viewport: { width: 390, height: 844 }, timezoneId: 'America/Chicago', locale: 'en-US',
      isMobile: true, hasTouch: true, deviceScaleFactor: 2, reducedMotion: 'reduce',
      colorScheme: dark ? 'dark' : 'light'
    });
    await ctx.route('**/config.js', r => r.fulfill({
      contentType: 'application/javascript',
      body: "window.CALENDAR_CONFIG = { APP_NAME: 'SANDY', SUPABASE_URL: '', SUPABASE_ANON_KEY: '', OWNER_EMAIL: '' };"
    }));
    await ctx.addInitScript(d => {
      localStorage.clear();
      localStorage.setItem('sandy.welcome.off', '1');
      localStorage.setItem('sandy.tour.off', '1');
      if (d) localStorage.setItem('sandy.theme', 'dark');
    }, dark);
    const p = await ctx.newPage();
    const errs = []; p.on('pageerror', e => errs.push(e.message));
    await p.clock.install({ time: new Date(at) });
    await p.goto(BASE);
    await p.waitForFunction(() => window.__app && window.SandyFreeGap && window.SandyLongDay && document.querySelector('#bottomNav'), null, { timeout: 20000 });
    return { ctx, p, errs };
  }
  const seed = async p => p.evaluate(async () => {
    const S = window.__app.Store;
    if (S.clearExamples) await S.clearExamples();
    for (const e of await S.list()) { try { await S.remove(e.id); } catch (_) {} }
    try { const inbox = window.SandyNav.Inbox; for (const i of await inbox.list()) await inbox.remove(i.id); } catch (_) {}
    const ev = o => ({ id: crypto.randomUUID(), kind: 'event', allDay: false, recurrence: { freq: 'none' }, location: '', notes: '', calendar: 'mam', category: 'Other', ...o });
    const task = o => ({ id: crypto.randomUUID(), kind: 'task', allDay: true, recurrence: { freq: 'none' }, location: '', notes: '', calendar: 'personal', category: 'Task / to-do', scope: 'day', done: false, ...o });
    const add = async o => S.save(ev(o));
    // Mon Oct 26 schedule (Scott-ish), clock at 8:00 AM CT
    await add({ title: 'Study', calendar: 'msc', start: '2026-10-26T06:00', end: '2026-10-26T07:00' });
    await add({ title: 'Morning routine', calendar: 'msc', start: '2026-10-26T07:00', end: '2026-10-26T07:30' });
    await add({ title: 'Christian DAKE Workout', calendar: 'mam', start: '2026-10-26T09:45', end: '2026-10-26T10:15' }); // ref — must not block
    await add({ title: 'Recovery', calendar: 'personal', start: '2026-10-26T09:30', end: '2026-10-26T11:00' });
    await add({ title: 'Maryville practice', start: '2026-10-26T12:00', end: '2026-10-26T15:00' });
    await add({ title: 'Jennings practice', start: '2026-10-26T15:30', end: '2026-10-26T18:30' });
    await add({ title: 'Jeff', start: '2026-10-26T19:00', end: '2026-10-26T20:00' });
    // Tomorrow long day (for evening + protect lunch)
    await add({ title: 'Study early', calendar: 'msc', start: '2026-10-27T06:00', end: '2026-10-27T07:00' });
    await add({ title: 'Routine', calendar: 'msc', start: '2026-10-27T07:00', end: '2026-10-27T07:30' });
    await add({ title: 'Lift', calendar: 'personal', start: '2026-10-27T09:00', end: '2026-10-27T10:30' });
    await add({ title: 'Life Time shift', calendar: 'lifetime', start: '2026-10-27T11:00', end: '2026-10-27T19:00' });
    await add({ title: 'Evening study', calendar: 'msc', start: '2026-10-27T20:00', end: '2026-10-27T21:00' });
    // To-dos
    await S.save(task({ title: 'Call insurance', priority: 1, start: '2026-10-20', end: '2026-10-20' })); // overdue
    await S.save(task({ title: 'Email Jeff', priority: 2, start: '2026-10-26', end: '2026-10-26' }));
    await S.save(task({ title: 'Organize files 2h', priority: 1, start: '2026-10-26', end: '2026-10-26' }));
    await window.SandyNav.Inbox.save({ id: crypto.randomUUID(), body: 'Buy stamps', kind: 'todo', done: false, calendar: null, priority: 3 });
  });
  const goToday = async p => { await p.click('#bottomNav button[data-tab="today"]'); await p.waitForSelector('#todayBody'); await p.waitForTimeout(500); };
  const shot = async (p, name, sel = '#tcFreeGap') => {
    await p.evaluate(sel => {
      const t = document.getElementById('toast'); if (t) t.hidden = true;
      const el = document.querySelector(sel); if (el) el.scrollIntoView({ block: 'center' });
    }, sel);
    await p.waitForTimeout(250);
    await p.screenshot({ path: `${SHOTS}/${name}.png` });
  };

  // Morning: free-gap card with suggestions
  {
    const { ctx, p, errs } = await open({ at: '2026-10-26T08:00:00' });
    await seed(p);
    await goToday(p);
    await p.waitForSelector('#tcFreeGap', { timeout: 8000 });
    const text = await p.$eval('#tcFreeGap', el => el.innerText);
    assert(/You're free/.test(text) && /Knock out/.test(text), 'card copy: ' + text.replace(/\s+/g, ' ').slice(0, 200));
    assert(/Call insurance/.test(text), 'suggests overdue P1');
    assert(!/Christian DAKE/i.test(text), 'ref not mentioned');
    // Christian Dake shouldn't eat the 7:30–9:30 gap — still a morning free window
    assert(/7:30|8:00|8:/.test(text) || /9:00|9:30|11:00|11:/.test(text), 'shows a real gap time');
    await shot(p, '01-freegap-morning-light');
    assert(!errs.length, 'no errors: ' + errs.join('; '));
    await ctx.close();
  }

  // Dark
  {
    const { ctx, p } = await open({ at: '2026-10-26T08:00:00', dark: true });
    await seed(p); await goToday(p);
    await p.waitForSelector('#tcFreeGap');
    await shot(p, '02-freegap-morning-dark');
    await ctx.close();
  }

  // Tap to schedule + undo
  {
    const { ctx, p } = await open({ at: '2026-10-26T08:00:00' });
    await seed(p); await goToday(p);
    await p.waitForSelector('.fg-todo');
    const before = await p.evaluate(async () => (await window.__app.Store.list()).filter(e => e.kind === 'task' && /Call insurance/i.test(e.title) && !e.allDay).length);
    await p.click('.fg-todo');
    await p.waitForFunction(() => { const t = document.getElementById('toast'); return t && !t.hidden && /Scheduled|Undo/i.test(t.innerText); }, null, { timeout: 8000 });
    const after = await p.evaluate(async () => {
      const e = (await window.__app.Store.list()).find(x => x.kind === 'task' && /Call insurance/i.test(x.title));
      return { allDay: e.allDay, start: e.start, end: e.end };
    });
    assert(after.allDay === false && /T/.test(after.start), 'scheduled timed: ' + JSON.stringify(after));
    // Undo before screenshot (shot() hides the toast)
    await p.evaluate(() => { const t = document.getElementById('toast'); if (t) { t.hidden = false; t.style.opacity = '1'; } });
    await p.locator('#toast .toast-undo').click({ force: true });
    await p.waitForTimeout(700);
    const undone = await p.evaluate(async () => {
      const e = (await window.__app.Store.list()).find(x => x.kind === 'task' && /Call insurance/i.test(x.title));
      return e && e.allDay === true;
    });
    assert(undone, 'undo restored all-day');
    // Re-schedule once for the screenshot of a scheduled state
    await goToday(p);
    await p.waitForSelector('.fg-todo');
    await p.click('.fg-todo');
    await p.waitForTimeout(500);
    await shot(p, '03-freegap-after-schedule-light');
    await ctx.close();
  }

  // Evening: tomorrow gaps, long-day meal window not duplicated as a free-gap
  {
    const { ctx, p } = await open({ at: '2026-10-26T17:30:00' });
    await seed(p); await goToday(p);
    await p.waitForSelector('#tcFreeGap');
    await p.waitForSelector('#tcLongDay');
    const fg = await p.$eval('#tcFreeGap', el => el.innerText);
    const ld = await p.$eval('#tcLongDay', el => el.innerText);
    assert(/Tomorrow/i.test(fg) || /free/i.test(fg), 'evening freegap: ' + fg.replace(/\s+/g, ' ').slice(0, 160));
    assert(/Long day|Pack lunch/i.test(ld), 'long-day still present');
    // protected 7:30–9:00 tomorrow should not appear as freegap "Tomorrow 7:30"
    assert(!/Tomorrow 7:30/.test(fg) && !/Tomorrow 7:30 AM/.test(fg), 'does not hawk long-day lunch window: ' + fg.replace(/\s+/g, ' ').slice(0, 200));
    await shot(p, '04-freegap-evening-with-longday-light');
    await ctx.close();
  }

  // Profile toggle
  {
    const { ctx, p } = await open({ at: '2026-10-26T08:00:00' });
    await seed(p); await goToday(p);
    await p.waitForSelector('#tcFreeGap');
    await p.click('#bottomNav button[data-tab="profile"]');
    await p.waitForSelector('#siFreeGap');
    await p.evaluate(() => document.getElementById('siSection').scrollIntoView({ block: 'center' }));
    await p.waitForTimeout(200);
    await shot(p, '05-profile-si-freegap-light');
    assert(await p.$eval('#siFreeGap', el => el.checked) === true, 'toggle on');
    await p.click('#siFreeGap');
    await p.waitForTimeout(300);
    await goToday(p);
    await p.waitForTimeout(400);
    assert(!(await p.$('#tcFreeGap')), 'toggle off hides card');
    // dark profile
    await p.evaluate(() => { document.documentElement.classList.add('dark'); localStorage.setItem('sandy.theme', 'dark'); });
    await p.click('#bottomNav button[data-tab="profile"]');
    await p.waitForSelector('#siSection');
    await p.evaluate(() => document.getElementById('siSection').scrollIntoView({ block: 'center' }));
    await shot(p, '06-profile-si-freegap-dark');
    await ctx.close();
  }

  await b.close();
  console.log('All freegap_ui tests passed. Shots in', SHOTS);
})().catch(e => { console.error(e); process.exit(1); });
