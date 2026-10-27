// Browser test: SI #7 Grocery nudge. Local mode, 390px.
//   node tests/grocery_ui.test.js http://127.0.0.1:8780/ /workspace/shots-si7
const { chromium } = require(process.env.PW || '/workspace/shot-tools/node_modules/playwright-core');
const fs = require('fs');
const BASE = process.argv[2] || 'http://127.0.0.1:8780/';
const SHOTS = process.argv[3] || '/workspace/shots-si7';
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
    await p.waitForFunction(() => window.__app && window.SandyGrocery && window.SandyFreeGap && document.querySelector('#bottomNav'), null, { timeout: 20000 });
    return { ctx, p, errs };
  }
  const clear = async p => p.evaluate(async () => {
    const S = window.__app.Store;
    if (S.clearExamples) await S.clearExamples();
    for (const e of await S.list()) { try { await S.remove(e.id); } catch (_) {} }
    try { localStorage.removeItem('sandy.si.grocery.snoozeUntil'); } catch (_) {}
  });
  const goToday = async p => { await p.click('#bottomNav button[data-tab="today"]'); await p.waitForSelector('#todayBody'); await p.waitForTimeout(600); };
  const shot = async (p, name, sel = '#tcGrocery') => {
    await p.evaluate(sel => {
      const t = document.getElementById('toast'); if (t) t.hidden = true;
      const el = document.querySelector(sel); if (el) el.scrollIntoView({ block: 'start' });
    }, sel);
    await p.waitForTimeout(250);
    await p.screenshot({ path: `${SHOTS}/${name}.png`, fullPage: false });
  };

  // No grocery → card shows
  {
    const { ctx, p, errs } = await open({ at: '2026-10-26T15:00:00' });
    await clear(p);
    // Busy morning so gap suggestion still finds afternoon
    await p.evaluate(async () => {
      const S = window.__app.Store;
      await S.save({ id: crypto.randomUUID(), kind: 'event', title: 'Life Time shift', calendar: 'lifetime', category: 'Work shift', allDay: false, recurrence: { freq: 'none' }, location: '', notes: '', start: '2026-10-26T11:00', end: '2026-10-26T19:00' });
    });
    await goToday(p);
    await p.waitForSelector('#tcGrocery', { timeout: 10000 });
    const text = await p.$eval('#tcGrocery', el => el.innerText);
    assert(/Grocery/i.test(text), 'title: ' + text.slice(0, 80));
    assert(/Add grocery/i.test(text), 'add action');
    assert(/Not this week/i.test(text), 'snooze');
    await shot(p, '01-grocery-nudge-light');
    assert(!errs.length, 'no errors: ' + errs.join('; '));
    await ctx.close();
  }

  // Dark
  {
    const { ctx, p } = await open({ at: '2026-10-26T15:00:00', dark: true });
    await clear(p);
    await goToday(p);
    await p.waitForSelector('#tcGrocery', { timeout: 8000 });
    await shot(p, '02-grocery-nudge-dark');
    await p.click('#bottomNav button[data-tab="profile"]');
    await p.waitForSelector('#siGrocery');
    await p.evaluate(() => document.querySelector('#siSection')?.scrollIntoView({ block: 'center' }));
    await p.waitForTimeout(200);
    assert(await p.$eval('#siGrocery', el => el.checked) === true, 'toggle on');
    await shot(p, '03-profile-si-grocery-dark', '#siSection');
    await ctx.close();
  }

  // Profile light + toggle off hides
  {
    const { ctx, p } = await open({ at: '2026-10-26T15:00:00' });
    await clear(p);
    await p.click('#bottomNav button[data-tab="profile"]');
    await p.waitForSelector('#siGrocery');
    await p.evaluate(() => document.querySelector('#siSection')?.scrollIntoView({ block: 'center' }));
    await shot(p, '04-profile-si-grocery-light', '#siSection');
    await p.click('#siGrocery');
    await p.waitForTimeout(300);
    await goToday(p);
    await p.waitForTimeout(500);
    assert(await p.$('#tcGrocery') === null, 'hidden when toggle off');
    await ctx.close();
  }

  // Costco in window → no card
  {
    const { ctx, p } = await open({ at: '2026-10-26T15:00:00' });
    await clear(p);
    await p.evaluate(async () => {
      await window.__app.Store.save({ id: crypto.randomUUID(), kind: 'event', title: 'Costco', calendar: 'personal', category: 'Errand', allDay: false, recurrence: { freq: 'none' }, location: '', notes: '', start: '2026-10-29T10:00', end: '2026-10-29T11:00' });
    });
    await goToday(p);
    await p.waitForTimeout(700);
    assert(await p.$('#tcGrocery') === null, 'hidden when Costco in window');
    await ctx.close();
  }

  // Add grocery run + undo
  {
    const { ctx, p } = await open({ at: '2026-10-26T15:00:00' });
    await clear(p);
    await goToday(p);
    await p.waitForSelector('#tcGrocery .gr-add', { timeout: 8000 });
    await p.click('#tcGrocery .gr-add');
    await p.waitForTimeout(800);
    const titles = await p.evaluate(async () => (await window.__app.Store.list()).map(e => e.title));
    assert(titles.some(t => /Grocery/i.test(t)), 'created grocery: ' + titles.join(','));
    await shot(p, '05-grocery-after-add-light', '#todayBody');
    // Undo via API (toast may be cleared by re-render)
    await p.evaluate(async () => {
      const list = await window.__app.Store.list();
      const g = list.find(e => /Grocery/i.test(e.title));
      if (g) await window.__app.Store.remove(g.id);
    });
    await goToday(p);
    await p.waitForSelector('#tcGrocery', { timeout: 8000 });
    assert(await p.$('#tcGrocery'), 'card back after remove');
    await ctx.close();
  }

  // Snooze
  {
    const { ctx, p } = await open({ at: '2026-10-26T15:00:00' });
    await clear(p);
    await goToday(p);
    await p.waitForSelector('#tcGrocery .gr-snooze', { timeout: 8000 });
    await p.click('#tcGrocery .gr-snooze');
    await p.waitForTimeout(600);
    assert(await p.$('#tcGrocery') === null, 'hidden after snooze');
    await ctx.close();
  }

  await b.close();
  console.log('All grocery UI tests passed. Shots in', SHOTS);
})().catch(e => { console.error(e); process.exit(1); });
