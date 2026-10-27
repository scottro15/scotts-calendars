// Browser test: SI #2 Long-day nudge card + Profile toggle. Local mode, 390px.
//   node tests/longday_ui.test.js http://127.0.0.1:8777/ [/workspace/shots-si2]
const { chromium } = require(process.env.PW || '/workspace/shot-tools/node_modules/playwright-core');
const fs = require('fs');
const BASE = process.argv[2] || 'http://127.0.0.1:8777/';
const SHOTS = process.argv[3] || '/workspace/shots-si2';
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
    // Force local mode (empty Supabase) so tests don't hit the invite-only auth gate.
    await ctx.route('**/config.js', r => r.fulfill({
      contentType: 'application/javascript',
      body: "window.CALENDAR_CONFIG = { APP_NAME: 'SANDY', SUPABASE_URL: '', SUPABASE_ANON_KEY: '', OWNER_EMAIL: '' };"
    }));
    if (dark) await ctx.addInitScript(() => localStorage.setItem('sandy.theme', 'dark'));
    await ctx.addInitScript(dark => {
      localStorage.clear();
      localStorage.setItem('sandy.welcome.off', '1');
      localStorage.setItem('sandy.tour.off', '1');
      if (dark) localStorage.setItem('sandy.theme', 'dark');
    }, dark);
    const p = await ctx.newPage();
    const errs = []; p.on('pageerror', e => errs.push(e.message));
    await p.clock.install({ time: new Date(at) });
    await p.goto(BASE);
    await p.waitForFunction(() => window.__app && window.__app.Store && window.SandyLongDay && document.querySelector('#bottomNav'), null, { timeout: 20000 });
    return { ctx, p, errs };
  }
  const seedScottTuesday = async (p) => p.evaluate(async () => {
    const S = window.__app.Store;
    if (S.clearExamples) await S.clearExamples();
    for (const e of await S.list()) { try { await S.remove(e.id); } catch (_) {} }
    const ev = o => ({ id: crypto.randomUUID(), kind: 'event', allDay: false, recurrence: { freq: 'none' }, location: '', notes: '', calendar: 'personal', category: 'Other', ...o });
    const add = async o => { await S.save(ev(o)); };
    // Tonight Mon Oct 26 evening → tomorrow Tue Oct 27 (Scott-like)
    await add({ title: 'Study: The Covenant Code', calendar: 'msc', start: '2026-10-27T06:00', end: '2026-10-27T07:00' });
    await add({ title: 'Morning/Evening Routine ☀️🌙', calendar: 'msc', start: '2026-10-27T07:00', end: '2026-10-27T07:30' });
    await add({ title: 'Upper Body Lift and Shower', calendar: 'personal', start: '2026-10-27T09:00', end: '2026-10-27T10:30' });
    await add({ title: 'Christian DAKE Workout 🏀', calendar: 'mam', start: '2026-10-27T09:30', end: '2026-10-27T10:00' });
    await add({ title: 'Life Time shift', calendar: 'lifetime', start: '2026-10-27T11:00', end: '2026-10-27T19:00' });
    await add({ title: 'Study: The Teachings', calendar: 'msc', start: '2026-10-27T20:00', end: '2026-10-27T21:00' });
    await add({ title: 'Picture day', allDay: true, start: '2026-10-27', end: '2026-10-27' });
    // short unrelated today item
    await add({ title: 'Tonight wrap-up', start: '2026-10-26T19:00', end: '2026-10-26T19:30' });
  });
  const goToday = async p => {
    await p.click('#bottomNav button[data-tab="today"]');
    await p.waitForSelector('#todayBody');
    await p.waitForTimeout(400);
  };
  const shot = async (p, name, sel = '#tcLongDay') => {
    await p.evaluate(sel => {
      const t = document.getElementById('toast'); if (t) t.hidden = true;
      const el = document.querySelector(sel); if (el) { el.scrollIntoView({ block: 'center' }); }
    }, sel);
    await p.waitForTimeout(200);
    await p.screenshot({ path: `${SHOTS}/${name}.png` });
  };

  // --- before 5 PM: no card ---
  {
    const { ctx, p, errs } = await open({ at: '2026-10-26T16:30:00' });
    await seedScottTuesday(p);
    await goToday(p);
    assert(!(await p.$('#tcLongDay')), '4:30 PM: no long-day card');
    assert(!errs.length, 'no page errors before 5: ' + errs.join('; '));
    await ctx.close();
  }

  // --- 5:30 PM: card appears ---
  {
    const { ctx, p, errs } = await open({ at: '2026-10-26T17:30:00' });
    await seedScottTuesday(p);
    await goToday(p);
    await p.waitForSelector('#tcLongDay', { timeout: 5000 });
    const text = await p.$eval('#tcLongDay', el => el.innerText);
    assert(/Long day/.test(text) && /Pack lunch and snacks tonight/.test(text), 'card text: ' + text.replace(/\s+/g, ' ').slice(0, 180));
    assert(/6:00 AM|6 AM/.test(text) && /9:00 PM|9 PM/.test(text), 'shows span times');
    assert(!/Christian DAKE/i.test(text), 'does not mention reference event');
    assert(/Tue.*Oct.*27|Oct 27/i.test(text), 'names tomorrow: ' + text.slice(0, 80));
    await shot(p, '01-longday-card-light');
    assert(!errs.length, 'no page errors at 5:30: ' + errs.join('; '));
    await ctx.close();
  }

  // --- dark mode ---
  {
    const { ctx, p } = await open({ at: '2026-10-26T17:30:00', dark: true });
    await seedScottTuesday(p);
    await goToday(p);
    await p.waitForSelector('#tcLongDay');
    await shot(p, '02-longday-card-dark');
    await ctx.close();
  }

  // --- 8 PM: still shows + Tomorrow also present ---
  {
    const { ctx, p } = await open({ at: '2026-10-26T20:05:00' });
    await seedScottTuesday(p);
    await goToday(p);
    await p.waitForSelector('#tcLongDay');
    assert(await p.$('#tcTomorrow'), '8 PM: Tomorrow card also shown');
    await shot(p, '03-longday-with-tomorrow-light');
    await ctx.close();
  }

  // --- toggle off in Profile ---
  {
    const { ctx, p } = await open({ at: '2026-10-26T17:30:00' });
    await seedScottTuesday(p);
    await goToday(p);
    await p.waitForSelector('#tcLongDay');
    await p.click('#bottomNav button[data-tab="profile"]');
    await p.waitForSelector('#siLongDay');
    const on = await p.$eval('#siLongDay', el => el.checked);
    assert(on === true, 'Profile toggle defaults on');
    await shot(p, '04-profile-si-section-light', '#siSection');
    await p.click('#siLongDay');
    await p.waitForTimeout(300);
    assert(await p.$eval('#siLongDay', el => el.checked) === false, 'toggle off');
    await goToday(p);
    await p.waitForTimeout(400);
    assert(!(await p.$('#tcLongDay')), 'toggle off: card hidden');
    // dark profile
    await p.evaluate(() => { document.documentElement.classList.add('dark'); localStorage.setItem('sandy.theme', 'dark'); });
    await p.click('#bottomNav button[data-tab="profile"]');
    await p.waitForSelector('#siSection');
    await shot(p, '05-profile-si-section-dark', '#siSection');
    await ctx.close();
  }

  // --- short day: no card ---
  {
    const { ctx, p } = await open({ at: '2026-10-26T17:30:00' });
    await p.evaluate(async () => {
      const S = window.__app.Store;
      if (S.clearExamples) await S.clearExamples();
      for (const e of await S.list()) { try { await S.remove(e.id); } catch (_) {} }
      await S.save({ id: crypto.randomUUID(), kind: 'event', allDay: false, recurrence: { freq: 'none' }, location: '', notes: '',
        calendar: 'personal', category: 'Other', title: 'Short meeting', start: '2026-10-27T10:00', end: '2026-10-27T11:00' });
    });
    await goToday(p);
    assert(!(await p.$('#tcLongDay')), 'short tomorrow: no card');
    await ctx.close();
  }

  await b.close();
  console.log('All longday_ui tests passed. Shots in', SHOTS);
})().catch(e => { console.error(e); process.exit(1); });
