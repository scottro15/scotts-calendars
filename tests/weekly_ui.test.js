// Browser test: SI #6 Sunday weekly review. Local mode, 390px.
//   node tests/weekly_ui.test.js http://127.0.0.1:8780/ /workspace/shots-si6
const { chromium } = require(process.env.PW || '/workspace/shot-tools/node_modules/playwright-core');
const fs = require('fs');
const BASE = process.argv[2] || 'http://127.0.0.1:8780/';
const SHOTS = process.argv[3] || '/workspace/shots-si6';
fs.mkdirSync(SHOTS, { recursive: true });
const assert = (c, m) => { if (!c) throw new Error('FAIL: ' + m); console.log('ok -', m); };

(async () => {
  const b = await chromium.launch({ executablePath: '/usr/bin/google-chrome', headless: true, args: ['--no-sandbox'] });
  async function open({ at, dark = false, url = BASE }) {
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
    await p.goto(url);
    await p.waitForFunction(() => window.__app && window.SandyWeekly && window.SandyClash && window.SandyLongDay && document.querySelector('#bottomNav'), null, { timeout: 20000 });
    return { ctx, p, errs };
  }
  const seed = async p => p.evaluate(async () => {
    const S = window.__app.Store;
    if (S.clearExamples) await S.clearExamples();
    for (const e of await S.list()) { try { await S.remove(e.id); } catch (_) {} }
    try { const inbox = window.SandyNav.Inbox; for (const i of await inbox.list()) await inbox.remove(i.id); } catch (_) {}
    const ev = o => ({ id: crypto.randomUUID(), kind: 'event', allDay: false, recurrence: { freq: 'none' }, location: '', notes: '', calendar: 'mam', category: 'Other', ...o });
    const task = o => ({ id: crypto.randomUUID(), kind: 'task', allDay: true, recurrence: { freq: 'none' }, location: '', notes: '', calendar: 'msc', category: 'Task / to-do', scope: 'day', done: false, ...o });
    const add = async o => S.save(ev(o));
    // Week of Nov 1–7 2026
    await add({ title: 'Study: Covenant', calendar: 'msc', category: 'Study time', start: '2026-11-02T06:00', end: '2026-11-02T07:00' });
    await add({ title: 'Life Time shift', calendar: 'lifetime', category: 'Work shift', start: '2026-11-03T11:00', end: '2026-11-03T19:00' });
    await add({ title: 'Jennings Boot Camp', category: 'Team practice – Jennings High School', start: '2026-11-03T16:00', end: '2026-11-03T18:00' });
    await add({ title: 'Maryville @ SIU - AWAY', category: 'Game – Maryville University', start: '2026-11-02T19:00', end: '2026-11-02T21:00' });
    await add({ title: 'Jeff - Mental Healing', calendar: 'msc', category: 'Client session', start: '2026-11-02T19:00', end: '2026-11-02T20:00' });
    await add({ title: 'Christian DAKE Workout', category: 'Client workout', start: '2026-11-02T12:00', end: '2026-11-02T12:30' });
    await add({ title: 'Life Time shift', calendar: 'lifetime', category: 'Work shift', start: '2026-11-07T17:00', end: '2026-11-08T00:00' });
    await add({ title: 'Recovery', calendar: 'personal', category: 'Workout/Recovery', start: '2026-11-01T08:00', end: '2026-11-01T10:00' });
    // last week event + completed todo
    await add({ title: 'Last week lift', calendar: 'personal', start: '2026-10-28T09:00', end: '2026-10-28T10:00' });
    await S.save(task({ title: 'Call insurance', priority: 1, start: '2026-10-20', end: '2026-10-20' })); // overdue
    await S.save(task({ title: 'Email Jeff', priority: 2, start: '2026-11-04', end: '2026-11-04' })); // due this week
    await S.save(task({ title: 'Finished thing', start: '2026-10-27', end: '2026-10-27', done: true, updatedAt: '2026-10-27T18:00:00.000Z' }));
  });
  const goToday = async p => { await p.click('#bottomNav button[data-tab="today"]'); await p.waitForSelector('#todayBody'); await p.waitForTimeout(700); };
  const shot = async (p, name, sel = '#tcWeekly') => {
    await p.evaluate(sel => {
      const t = document.getElementById('toast'); if (t) t.hidden = true;
      const el = document.querySelector(sel); if (el) el.scrollIntoView({ block: 'start' });
    }, sel);
    await p.waitForTimeout(300);
    await p.screenshot({ path: `${SHOTS}/${name}.png`, fullPage: false });
  };

  // Sunday 5 PM — card visible
  {
    const { ctx, p, errs } = await open({ at: '2026-11-01T17:00:00' });
    await seed(p);
    await goToday(p);
    await p.waitForSelector('#tcWeekly', { timeout: 10000 });
    const text = await p.$eval('#tcWeekly', el => el.innerText);
    assert(/Your week ahead/i.test(text), 'title: ' + text.slice(0, 80));
    assert(/Busiest day/i.test(text), 'busiest');
    assert(/Hours by calendar/i.test(text) && /Life Time|MSC|MAM|Personal/i.test(text), 'hours: ' + text.slice(0, 200));
    assert(/Maryville|SIU/i.test(text) && /AWAY|Games/i.test(text), 'games');
    assert(/Long days/i.test(text), 'long days section');
    assert(/Clashes/i.test(text) && (/Boot Camp|Jeff/i.test(text)), 'clashes');
    assert(!/DAKE|Dake/.test(text), 'dake absent from review text');
    assert(/Early starts|late nights|Free evenings|Last week|To-dos due/i.test(text), 'sections present');
    await shot(p, '01-weekly-sunday-light', '#tcWeekly');
    // scroll full card
    await p.evaluate(() => { const el = document.getElementById('tcWeekly'); if (el) el.scrollIntoView({ block: 'end' }); });
    await p.waitForTimeout(200);
    await p.screenshot({ path: `${SHOTS}/02-weekly-sunday-bottom-light.png` });
    assert(!errs.length, 'no page errors: ' + errs.join('; '));
    await ctx.close();
  }

  // Sunday 3 PM — hidden until 4
  {
    const { ctx, p } = await open({ at: '2026-11-01T15:00:00' });
    await seed(p);
    await goToday(p);
    await p.waitForTimeout(500);
    assert(await p.$('#tcWeekly') === null, 'hidden before 4 PM');
    await ctx.close();
  }

  // Dark + Profile
  {
    const { ctx, p } = await open({ at: '2026-11-01T17:00:00', dark: true });
    await seed(p);
    await goToday(p);
    await p.waitForSelector('#tcWeekly', { timeout: 8000 });
    await shot(p, '03-weekly-sunday-dark', '#tcWeekly');
    await p.click('#bottomNav button[data-tab="profile"]');
    await p.waitForSelector('#siWeeklyReview');
    await p.evaluate(() => document.querySelector('#siSection')?.scrollIntoView({ block: 'center' }));
    await p.waitForTimeout(200);
    assert(await p.$eval('#siWeeklyReview', el => el.checked) === true, 'toggle on');
    await shot(p, '04-profile-si-weekly-dark', '#siSection');
    await p.click('#siWeeklyReview');
    await p.waitForTimeout(300);
    await goToday(p);
    await p.waitForTimeout(500);
    assert(await p.$('#tcWeekly') === null, 'hidden when toggle off');
    await ctx.close();
  }

  // Profile open button forces card on Wednesday
  {
    const { ctx, p } = await open({ at: '2026-11-04T12:00:00' }); // Wed in week
    await seed(p);
    await p.click('#bottomNav button[data-tab="profile"]');
    await p.waitForSelector('#siWeeklyOpen');
    await shot(p, '05-profile-si-weekly-light', '#siSection');
    await p.click('#siWeeklyOpen');
    await p.waitForSelector('#tcWeekly', { timeout: 8000 });
    assert(await p.$('#tcWeekly'), 'forced open mid-week');
    await shot(p, '06-weekly-forced-wed-light', '#tcWeekly');
    await ctx.close();
  }

  // Deep link si=weekly
  {
    const { ctx, p } = await open({ at: '2026-11-01T15:00:00', url: BASE + '?tab=today&si=weekly' });
    await seed(p);
    // may need navigate to today again after seed
    await goToday(p);
    await p.waitForSelector('#tcWeekly', { timeout: 8000 });
    assert(await p.$('#tcWeekly'), 'deep link forces before 4 PM');
    await ctx.close();
  }

  await b.close();
  console.log('All weekly UI tests passed. Shots in', SHOTS);
})().catch(e => { console.error(e); process.exit(1); });
