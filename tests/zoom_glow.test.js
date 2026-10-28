// Phone event editor has no auto-zoom (all fields >= 16px, fits 390px), and all-day to-dos in List View glow counter-clockwise.
// Run: node tests/zoom_glow.test.js [baseUrl]
const { chromium } = require(process.env.PW || '/workspace/shot-tools/node_modules/playwright-core');
const BASE = process.argv[2] || 'http://127.0.0.1:8765/';
const SHOTS = __dirname + '/../screenshots/';
const assert = (c, m) => { if (!c) throw new Error('FAIL: ' + m); console.log('ok -', m); };
(async () => {
  const b = await chromium.launch({ executablePath: '/usr/bin/google-chrome', headless: true, args: ['--no-sandbox'] });
  const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2, timezoneId: 'America/Chicago' });
  const p = await ctx.newPage(); const errs = []; p.on('pageerror', e => errs.push(e.message));
  await p.goto(BASE); await p.waitForSelector('.fc-event');
  // seed an all-day task on today + a timed event
  await p.evaluate(async () => { const d = __app.ymd(__app.nowWall());
    await Store.save({ kind: 'task', calendar: 'mam', title: 'Coaches Certification', category: 'Task / to-do', allDay: true, start: d, end: d, scope: 'day', recurrence: { freq: 'none', interval: 1 } }); });
  await p.reload(); await p.waitForSelector('.fc-event');
  await p.click('.fc-listWeek-button');
  await p.waitForSelector('.fc-list tr.sandy-todo-glow');
  const g = await p.evaluate(() => { const tr = document.querySelector('.fc-list tr.sandy-todo-glow'); const s = getComputedStyle(tr, '::after');
    const timedGlow = [...document.querySelectorAll('.fc-list tr.fc-list-event')].some(r => r.dataset.allDay !== '1' && r.classList.contains('sandy-todo-glow'));
    return { anim: s.animationName, bg: s.backgroundImage, timedGlow, a1: s.getPropertyValue('--angle') }; });
  assert(g.anim === 'sandy-ccw' && /conic-gradient/.test(g.bg), 'all-day to-do has animated conic border');
  assert(!g.timedGlow, 'timed events have no glow');
  const a1 = await p.evaluate(() => getComputedStyle(document.querySelector('.fc-list tr.sandy-todo-glow'), '::after').getPropertyValue('--angle'));
  await p.waitForTimeout(400);
  const a2 = await p.evaluate(() => getComputedStyle(document.querySelector('.fc-list tr.sandy-todo-glow'), '::after').getPropertyValue('--angle'));
  assert(parseFloat(a2) < parseFloat(a1) || parseFloat(a1) < 30, `angle decreases = counter-clockwise (${a1} -> ${a2})`);
  await p.locator('.fc-list tr.sandy-todo-glow').first().scrollIntoViewIfNeeded();
  await p.screenshot({ path: SHOTS + '20_todo_glow_list_mobile.png' });
  // editor
  await p.click('#addBtn:visible, #railNew:visible'); await p.waitForTimeout(500);
  const z = await p.evaluate(() => { const d = document.querySelector('dialog[open]'); const r = d.getBoundingClientRect();
    const small = [...d.querySelectorAll('input:not([type=checkbox]):not([type=radio]), select, textarea')].filter(e => e.offsetParent && parseFloat(getComputedStyle(e).fontSize) < 16).map(e => e.name || e.id);
    return { small, left: r.left, right: r.right, w: innerWidth, sw: document.documentElement.scrollWidth, vp: document.querySelector('meta[name=viewport]').content }; });
  assert(z.small.length === 0, 'every editor field is >= 16px (no iOS focus zoom) ' + z.small.join(','));
  assert(z.left >= 0 && z.right <= z.w && z.sw <= z.w, `editor fits 390px (${Math.round(z.left)}..${Math.round(z.right)})`);
  assert(!/user-scalable=no|maximum-scale/.test(z.vp), 'pinch-zoom still allowed');
  await p.focus('input[name=title]'); await p.waitForTimeout(200);
  await p.screenshot({ path: SHOTS + '20_event_editor_390.png' });
  const ctx2 = await b.newContext({ viewport: { width: 390, height: 844 }, reducedMotion: 'reduce', timezoneId: 'America/Chicago' });
  const p2 = await ctx2.newPage(); await p2.goto(BASE); await p2.waitForSelector('.fc-event');
  await p2.evaluate(async () => { const d = __app.ymd(__app.nowWall()); await Store.save({ kind: 'task', calendar: 'mam', title: 'Coaches Certification', category: 'Task / to-do', allDay: true, start: d, end: d, scope: 'day', recurrence: { freq: 'none', interval: 1 } }); });
  await p2.reload(); await p2.waitForSelector('.fc-event');
  await p2.click('.fc-listWeek-button');
  await p2.waitForSelector('.fc-list tr.sandy-todo-glow');
  const rm = await p2.evaluate(() => getComputedStyle(document.querySelector('.fc-list tr.sandy-todo-glow'), '::after').animationName);
  assert(rm === 'none', 'reduced motion: static glow');
  assert(errs.length === 0, 'no page errors ' + errs.join('|'));
  await b.close(); console.log('ALL ZOOM/GLOW TESTS PASSED');
})().catch(e => { console.error(e.message); process.exit(1); });
