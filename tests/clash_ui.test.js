// Browser test: SI #5 Clash check. Local mode, 390px.
//   node tests/clash_ui.test.js http://127.0.0.1:8779/ /workspace/shots-si5
const { chromium } = require(process.env.PW || '/workspace/shot-tools/node_modules/playwright-core');
const fs = require('fs');
const BASE = process.argv[2] || 'http://127.0.0.1:8779/';
const SHOTS = process.argv[3] || '/workspace/shots-si5';
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
    await p.waitForFunction(() => window.__app && window.SandyClash && document.querySelector('#bottomNav'), null, { timeout: 20000 });
    return { ctx, p, errs };
  }
  const seed = async p => p.evaluate(async () => {
    const S = window.__app.Store;
    if (S.clearExamples) await S.clearExamples();
    for (const e of await S.list()) { try { await S.remove(e.id); } catch (_) {} }
    try { const inbox = window.SandyNav.Inbox; for (const i of await inbox.list()) await inbox.remove(i.id); } catch (_) {}
    const ev = o => ({ id: crypto.randomUUID(), kind: 'event', allDay: false, recurrence: { freq: 'none' }, location: '', notes: '', calendar: 'mam', category: 'Other', ...o });
    const add = async o => S.save(ev(o));
    // Mon Oct 26 evening clock — seed clashes across the week
    await add({ title: 'Life Time shift', calendar: 'lifetime', category: 'Work shift', start: '2026-10-27T11:00', end: '2026-10-27T19:00' });
    await add({ title: 'Kid dentist', calendar: 'personal', category: 'Personal', start: '2026-10-27T16:00', end: '2026-10-27T17:00' });
    await add({ title: 'Christian DAKE Workout 🏀', calendar: 'mam', category: 'Client workout', start: '2026-10-27T12:00', end: '2026-10-27T12:30' });
    await add({ title: 'Office study: The Teachings (30 min, during shift)', calendar: 'msc', category: 'Study time', start: '2026-10-27T14:00', end: '2026-10-27T14:30' });
    await add({
      title: 'Maryville University @ Southern Illinois University - AWAY',
      category: 'Game – Maryville University',
      start: '2026-10-28T19:00', end: '2026-10-28T21:00'
    });
    await add({ title: 'Jeff - Mental Healing', calendar: 'msc', category: 'Client session', start: '2026-10-28T19:00', end: '2026-10-28T20:00' });
    await add({ title: 'Jennings High School basketball practice', category: 'Team practice – Jennings High School', start: '2026-10-29T15:30', end: '2026-10-29T18:30' });
    await add({ title: 'Jennings High School Boot Camp 🏀', category: 'Team practice – Jennings High School', start: '2026-10-29T16:00', end: '2026-10-29T18:00' });
    await add({ title: 'Study: The Teachings', calendar: 'msc', category: 'Study time', start: '2026-10-28T20:00', end: '2026-10-28T21:00' });
    await add({ title: 'Fall Classic', category: 'Tournament', allDay: true, start: '2026-10-27', end: '2026-10-29' });
  });
  const goToday = async p => { await p.click('#bottomNav button[data-tab="today"]'); await p.waitForSelector('#todayBody'); await p.waitForTimeout(600); };
  const shot = async (p, name, sel = '.tc-heads') => {
    await p.evaluate(sel => {
      const t = document.getElementById('toast'); if (t) t.hidden = true;
      const el = document.querySelector(sel); if (el) el.scrollIntoView({ block: 'center' });
    }, sel);
    await p.waitForTimeout(250);
    await p.screenshot({ path: `${SHOTS}/${name}.png` });
  };

  // Light: Heads Up clashes
  {
    const { ctx, p, errs } = await open({ at: '2026-10-26T21:00:00' });
    await seed(p);
    await goToday(p);
    await p.waitForSelector('#tcClash', { timeout: 8000 });
    const text = await p.$eval('#tcClash', el => el.innerText);
    assert(/Life Time shift/.test(text) && /Kid dentist/.test(text), 'shift ∩ kid: ' + text.replace(/\s+/g, ' ').slice(0, 180));
    assert(/Maryville/.test(text) && /Jeff/.test(text), 'game ∩ Jeff');
    assert(!/DAKE|Dake/.test(text), 'Dake absent');
    assert(!/Boot Camp/.test(text) || !/basketball practice/.test(text), 'same-team boot not both as clash pair text ok');
    // same-team pair should not appear as a row mentioning both
    const rows = await p.$$eval('#tcClash .cl-row', els => els.map(e => e.innerText));
    assert(!rows.some(r => /Boot Camp/.test(r) && /basketball practice/.test(r)), 'no same-team row: ' + JSON.stringify(rows));
    assert(!/Fall Classic/.test(text), 'all-day tournament ignored');
    assert(!/Office study/.test(text), 'nested office study ignored');
    assert(!/Study: The Teachings/.test(text), 'soft study ignored');
    assert(/Who's covering/.test(text), 'add covering CTA');
    await shot(p, '01-clash-heads-light', '.tc-heads');
    // tap add covering
    await p.click('#tcClash .cl-add');
    await p.waitForTimeout(500);
    const toast = await p.$eval('#toast', el => el.innerText);
    assert(/Who's covering|Added/.test(toast), 'toast: ' + toast);
    // undo before shot hides it
    await p.click('#toast .toast-undo');
    await p.waitForTimeout(400);
    await shot(p, '02-clash-after-undo-light', '.tc-heads');
    // add again and confirm dedupe label
    await p.click('#tcClash .cl-add');
    await p.waitForTimeout(500);
    await goToday(p);
    await p.waitForSelector('#tcClash .cl-done, #tcClash .cl-add', { timeout: 5000 });
    const after = await p.$eval('#tcClash', el => el.innerText);
    assert(/Covering to-do added/.test(after), 'deduped state: ' + after.replace(/\s+/g, ' ').slice(0, 200));
    await shot(p, '03-clash-covered-light', '.tc-heads');
    assert(!errs.length, 'no page errors: ' + errs.join('; '));
    await ctx.close();
  }

  // Dark
  {
    const { ctx, p } = await open({ at: '2026-10-26T21:00:00', dark: true });
    await seed(p);
    await goToday(p);
    await p.waitForSelector('#tcClash', { timeout: 8000 });
    await shot(p, '04-clash-heads-dark', '.tc-heads');
    await ctx.close();
  }

  // Profile toggle
  {
    const { ctx, p } = await open({ at: '2026-10-26T21:00:00' });
    await seed(p);
    await p.click('#bottomNav button[data-tab="profile"]');
    await p.waitForSelector('#siClash');
    await p.evaluate(() => document.querySelector('#siSection')?.scrollIntoView({ block: 'center' }));
    await p.waitForTimeout(200);
    assert(await p.$eval('#siClash', el => el.checked) === true, 'toggle on');
    await shot(p, '05-profile-si-clash-light', '#siSection');
    await p.click('#siClash');
    await p.waitForTimeout(300);
    assert(await p.$eval('#siClash', el => el.checked) === false, 'toggle off');
    await goToday(p);
    await p.waitForTimeout(500);
    assert(await p.$('#tcClash') === null, 'clash hidden when off');
    await p.click('#bottomNav button[data-tab="profile"]');
    await p.waitForSelector('#siClash');
    await p.click('#siClash'); // back on
    await p.evaluate(() => { document.documentElement.classList.add('dark'); localStorage.setItem('sandy.theme', 'dark'); });
    await p.waitForTimeout(200);
    await p.evaluate(() => document.querySelector('#siSection')?.scrollIntoView({ block: 'center' }));
    await shot(p, '06-profile-si-clash-dark', '#siSection');
    await ctx.close();
  }

  await b.close();
  console.log('All clash UI tests passed. Shots in', SHOTS);
})().catch(e => { console.error(e); process.exit(1); });
