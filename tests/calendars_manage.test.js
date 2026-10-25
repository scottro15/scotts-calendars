// Browser test (Scott 2026-10-25): Profile → "Add or edit calendars" in LOCAL mode, iPhone size.
// Bug 1: the screen opened straight into editing a colour. Now it opens on a plain list (nothing focused or
// expanded); tapping a calendar opens only that one's editor. Bug 2: adding "Personal" threw
// "undefined is not an object (evaluating 'taken.has')" (slugify called without its Set). Covers: list first,
// one editor at a time, add "Personal" (saved, survives reload, usable for events), duplicate name refused,
// rename + recolour, slugify defaults, light + dark screenshots, no page errors.
//   node tests/calendars_manage.test.js http://127.0.0.1:8766/ [shotsDir]
const { chromium } = require(process.env.PW || '/workspace/shot-tools/node_modules/playwright-core');
const fs = require('fs');
const BASE = process.argv[2] || 'http://127.0.0.1:8766/'; const SHOTS = process.argv[3] || '/workspace/shots-cal-add';
fs.mkdirSync(SHOTS, { recursive: true });
const assert = (c, m) => { if (!c) throw new Error('FAIL: ' + m); console.log('ok -', m); };

(async () => {
  const b = await chromium.launch({ executablePath: '/usr/bin/google-chrome', headless: true, args: ['--no-sandbox'] });
  const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, timezoneId: 'America/Chicago', locale: 'en-US', isMobile: true, hasTouch: true, deviceScaleFactor: 2, reducedMotion: 'reduce' });
  const p = await ctx.newPage(); const errs = []; p.on('pageerror', e => errs.push(e.message));
  const settle = (ms = 400) => p.waitForTimeout(ms);
  const ready = () => p.waitForFunction(() => window.__app && window.SandyNav && document.querySelector('#calendar .fc-view'));
  await p.goto(BASE); await ready(); await p.evaluate(() => { localStorage.clear(); sessionStorage.clear(); }); await p.goto(BASE); await ready();
  const openDlg = async () => { await p.click('#bottomNav [data-tab=profile]'); await settle(); await p.click('#manageCalsBtn'); await p.waitForSelector('dialog.cal-dlg[open]'); await settle(300); };
  const shot = async name => { await p.mouse.move(2, 840); await p.evaluate(() => { const t = document.getElementById('toast'); if (t) t.hidden = true; }); await settle(150); await p.screenshot({ path: `${SHOTS}/${name}.png` }); };

  // slugify: the root cause (called without its "taken" Set)
  const sl = await p.evaluate(() => { const f = window.SandyAccount.slugify; const t = new Set(['personal']); return [f('Personal'), f('Personal', t), f('Personal', ['personal', 'personal-2']), f("Kids' Sports!"), f('  ')]; });
  assert(sl[0] === 'personal' && sl[1] === 'personal-2' && sl[2] === 'personal-3' && sl[3] === 'kids-sports' && sl[4] === 'calendar', `slugify works with no Set, a Set or an array (${sl})`);

  // ---------- 1. opens on a plain list
  await openDlg();
  const st = await p.evaluate(() => { const d = document.querySelector('dialog.cal-dlg'); const vis = el => !!(el && el.offsetParent);
    return { items: [...d.querySelectorAll('.cal-item .cal-nm')].map(x => x.textContent), editors: [...d.querySelectorAll('.cal-edit')].filter(vis).length,
      colors: [...d.querySelectorAll('input[type=color]')].filter(vis).length, inputs: [...d.querySelectorAll('input')].filter(vis).length,
      focus: document.activeElement.tagName + (document.activeElement.type ? ':' + document.activeElement.type : '') }; });
  assert(st.items.length === 3 && /MSC/.test(st.items[0]), `opens to a list of calendars (${st.items.join(' | ')})`);
  assert(st.editors === 0 && st.colors === 0 && st.inputs === 0, 'nothing is being edited when it opens (no editors, colour pickers or fields showing)');
  assert(!/^INPUT/.test(st.focus), `focus is not in a field or colour picker (${st.focus})`);
  await shot('calendars_list_light');

  // ---------- 2. tap to edit, one at a time
  const item = i => p.locator('dialog.cal-dlg .cal-list > li').nth(i);
  await item(1).locator('.cal-item').click(); await settle(200);
  assert(await item(1).locator('.cal-edit').isVisible() && await item(1).locator('.cal-item').getAttribute('aria-expanded') === 'true', 'tapping a calendar opens its editor');
  assert(await p.evaluate(() => document.activeElement.classList.contains('cn')), 'editor focuses the name field, not the colour');
  await shot('calendars_edit_light');
  await item(2).locator('.cal-item').click(); await settle(200);
  assert(!(await item(1).locator('.cal-edit').isVisible()) && await item(2).locator('.cal-edit').isVisible(), 'only one editor open at a time');
  await item(2).locator('.cal-item').click(); await settle(200);
  assert(!(await item(2).locator('.cal-edit').isVisible()), 'tapping again closes it');

  // ---------- 3. add "Personal"
  assert(!(await p.isVisible('#ncName')), 'add form hidden until "+ Add a calendar"');
  await p.click('#calAddBtn'); await settle(200);
  await p.fill('#ncName', 'Personal'); await p.$eval('#ncColor', el => { el.value = '#db2777'; el.dispatchEvent(new Event('input', { bubbles: true })); });
  await shot('calendars_add_light');
  await p.click('#calSave');
  await p.waitForEvent('load', { timeout: 8000 }).catch(() => {}); await ready(); await settle(600);
  assert(!errs.some(e => /taken/.test(e)), 'no "taken.has" error');
  let cals = await p.evaluate(() => window.__app.calendars().map(c => ({ id: c.id, name: c.name, color: c.color })));
  const pers = cals.find(c => c.name === 'Personal');
  assert(pers && pers.id === 'personal' && pers.color === '#db2777' && cals.length === 4, `"Personal" added (${JSON.stringify(pers)})`);
  assert(await p.evaluate(() => JSON.parse(localStorage.getItem('scottcal.calendars.v1')).length === 4), 'saved on this device');
  assert(await p.evaluate(() => [...document.querySelectorAll('#calSection, #calToggles, .cal-toggles')].some(e => /Personal/.test(e.textContent))), 'Personal shows in the calendar list');
  await p.evaluate(async () => { await window.__app.Store.save({ id: crypto.randomUUID(), kind: 'event', allDay: false, recurrence: { freq: 'none' }, title: 'Kids pickup', calendar: 'personal', category: 'Event', start: '2026-11-17T15:00', end: '2026-11-17T15:30', location: '', notes: '' }); window.__app.refresh(); });
  await p.reload(); await ready(); await settle(500);
  cals = await p.evaluate(() => window.__app.calendars().map(c => c.id));
  assert(cals.includes('personal'), 'Personal survives a reload');
  assert(await p.evaluate(() => (window.__app.calendars().find(c => c.id === 'personal') || {}).categories.includes('Event')), 'Personal has the generic categories');
  assert(await p.evaluate(async () => (await window.__app.Store.list()).some(e => e.calendar === 'personal' && e.title === 'Kids pickup')), 'events can live in Personal');

  // ---------- 4. duplicate refused; rename + recolour
  await openDlg(); await p.click('#calAddBtn'); await p.fill('#ncName', 'personal'); await p.click('#calSave'); await settle(300);
  assert(/already have a calendar called/.test(await p.textContent('dialog.cal-dlg .onb-err')), 'adding a second "Personal" is refused with a clear message');
  await p.fill('#ncName', '');
  const li = p.locator('dialog.cal-dlg .cal-list > li[data-slug=personal]');
  await li.locator('.cal-item').click(); await li.locator('.cn').fill('Personal & family'); await li.locator('input[type=color]').evaluate(el => { el.value = '#16a34a'; el.dispatchEvent(new Event('input', { bubbles: true })); });
  await p.click('#calSave'); await p.waitForEvent('load', { timeout: 8000 }).catch(() => {}); await ready(); await settle(500);
  const pe = await p.evaluate(() => window.__app.calendars().find(c => c.id === 'personal'));
  assert(pe.name === 'Personal & family' && pe.color === '#16a34a', 'rename + new colour saved (same id, events stay attached)');
  await openDlg(); await p.locator('dialog.cal-dlg .cal-list > li').nth(0).locator('.cn').evaluate(el => { el.value = ''; });
  await p.locator('dialog.cal-dlg .cal-list > li').nth(0).locator('.cal-item').click(); await p.locator('dialog.cal-dlg .cal-list > li').nth(0).locator('.cn').fill(''); await p.click('#calSave'); await settle(300);
  assert(/cannot be empty/.test(await p.textContent('dialog.cal-dlg .onb-err')), 'empty name refused');
  await p.click('dialog.cal-dlg button[value=cancel]'); await settle(300);

  // ---------- 5. dark mode screenshots
  await p.evaluate(() => window.SandyNav.setDark(true)); await openDlg(); await shot('calendars_list_dark');
  await p.locator('dialog.cal-dlg .cal-list > li').nth(3).locator('.cal-item').click(); await p.click('#calAddBtn'); await settle(200); await shot('calendars_edit_add_dark');
  await p.click('dialog.cal-dlg button[value=cancel]'); await p.evaluate(() => window.SandyNav.setDark(false));

  assert(errs.length === 0, 'no page errors ' + errs.join(' | '));
  await b.close(); console.log('CALENDARS MANAGE TESTS PASSED');
})().catch(e => { console.error(e); process.exit(1); });
