// Browser test (390px): collapsible Today cards (collapse.js). Heads Up (incl. leave-by), On Today, Overdue To-Dos,
// Tomorrow, Practice prep and Travel plan each get a header <button> (aria-expanded/aria-controls), chevron,
// summary when collapsed ("On Today · 4"), saved per section per user on the device (survives re-render, reload,
// next day), keyboard (Enter/Space; collapsed content not focusable), focus kept across the 1-minute re-render,
// smooth height/opacity animation that is turned off for prefers-reduced-motion. Light + dark.
//   node tests/today_collapse.test.js http://127.0.0.1:8796/ [shotsDir]
const { chromium } = require(process.env.PW || '/workspace/shot-tools/node_modules/playwright-core');
const BASE = process.argv[2] || 'http://127.0.0.1:8796/'; const SHOTS = process.argv[3] || '/workspace/shots-collapse';
const assert = (c, m) => { if (!c) throw new Error('FAIL: ' + m); console.log('ok -', m); };
const ok200 = (r, body) => r.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify(body) });
(async () => {
  const b = await chromium.launch({ executablePath: '/usr/bin/google-chrome', headless: true, args: ['--no-sandbox'] });
  async function open({ motion = 'reduce', dark = false } = {}) {
    const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, timezoneId: 'America/Chicago', locale: 'en-US', isMobile: true, hasTouch: true, deviceScaleFactor: 2, reducedMotion: motion, colorScheme: dark ? 'dark' : 'light' });
    await ctx.route('https://photon.komoot.io/**', r => ok200(r, { features: [{ geometry: { coordinates: [-90.5, 38.6] }, properties: {} }] }));
    await ctx.route('https://valhalla1.openstreetmap.de/**', r => ok200(r, { trip: { summary: { time: 1920, length: 25 } } }));
    await ctx.route('https://api.open-meteo.com/**', r => { const d = new URL(r.request().url()).searchParams.get('start_date'); const time = Array.from({ length: 24 }, (_, h) => `${d}T${String(h).padStart(2, '0')}:00`);
      ok200(r, { hourly: { time, temperature_2m: time.map(() => 50), precipitation_probability: time.map(() => 10), weather_code: time.map(() => 1), wind_speed_10m: time.map(() => 5) } }); });
    const p = await ctx.newPage(); const errs = []; p.on('pageerror', e => errs.push(e.message));
    await p.clock.install({ time: new Date('2026-11-17T23:15:00Z') }); // Tue Nov 17, 5:15 PM CT
    await p.goto(BASE); await p.waitForFunction(() => window.__app && window.SandyNav && window.SandyCollapse && document.querySelector('#calendar .fc-view, .tc-summary'));
    return { ctx, p, errs };
  }
  const seed = p => p.evaluate(async () => {
    localStorage.removeItem('sandy.todayCollapsed.v1');
    const S = window.__app.Store; if (S.clearExamples) await S.clearExamples(); for (const e of await S.list()) { try { await S.remove(e.id); } catch (_) {} }
    const ev = o => ({ id: crypto.randomUUID(), kind: 'event', allDay: false, recurrence: { freq: 'none' }, location: '', notes: '', calendar: 'mam', category: 'Other', ...o });
    for (const e of [
      ev({ title: 'Maryville University vs Malone University - NEUTRAL', category: 'Game – Maryville University', start: '2026-11-17T19:30', end: '2026-11-17T21:30', location: 'Gym A, Testville, MO' }),
      ev({ title: 'Film with Nick', start: '2026-11-17T18:00', end: '2026-11-17T19:00' }),
      ev({ title: 'Call with Bill', calendar: 'msc', start: '2026-11-17T18:30', end: '2026-11-17T19:15' }),
      ev({ title: 'Jennings HS practice', category: 'Team practice – Jennings High School', start: '2026-11-18T15:00', end: '2026-11-18T17:00' }),
      ev({ title: 'Lift', start: '2026-11-18T07:00', end: '2026-11-18T08:00' }),
      { ...ev({ title: 'Order new bands', kind: 'task', allDay: true, start: '2026-11-15', end: '2026-11-15', category: 'Task / to-do' }), scope: 'day', done: false, completedDates: [] },
    ]) await S.save(e);
    await window.SandyLeave.setHome('1 Test Home Rd, Testville, MO 63000'); window.__app.refresh();
  });
  const today = async p => { await p.evaluate(() => window.SandyNav.go('today')); await p.evaluate(() => window.SandyNav.renderToday()); await p.waitForTimeout(900); };
  const heads = p => p.$$eval('#todayBody section.tc-card:not([hidden])', ss => ss.map(s => { const b = s.querySelector(':scope > h3 .tc-tog');
    return { cls: [...s.classList].filter(c => /^tc-(heads|on|overdue|tomorrow|practice|travel)$/.test(c))[0], key: b && b.dataset.ckey, exp: b && b.getAttribute('aria-expanded'), ctl: b && b.getAttribute('aria-controls'),
      body: !!(b && document.getElementById(b.getAttribute('aria-controls'))), text: s.querySelector(':scope > h3').textContent.replace(/\s+/g, ' ').trim(), collapsed: s.classList.contains('is-collapsed') }; }));
  const tog = (p, cls) => p.click(`#todayBody section.${cls} > h3 .tc-tog`);
  const H = async (p, cls) => (await heads(p)).find(h => h.cls === cls);

  // ---- light, reduced motion
  let { ctx, p, errs } = await open(); await seed(p); await p.clock.setSystemTime(new Date('2026-11-18T00:15:00Z')); await today(p); // 6:15 PM: evening (Tomorrow shows)
  let hs = await heads(p);
  assert(['tc-heads', 'tc-travel', 'tc-practice', 'tc-tomorrow', 'tc-on', 'tc-overdue'].every(c => hs.some(h => h.cls === c)), 'all six Today cards present: ' + hs.map(h => h.cls).join());
  assert(hs.every(h => h.key && h.exp === 'true' && h.ctl && h.body), 'every card header is a button with aria-expanded="true" + aria-controls -> its body');
  assert(hs.every(h => !/·\s*\d+\s*$/.test(h.text) && !/\d+ alerts?|items?$/.test(h.text)), 'open headers show no summary count: ' + hs.map(h => h.text).join(' | '));
  assert(await p.$eval('#todayBody section.tc-on > h3 .tc-tog', e => e.tagName === 'BUTTON' && e.type === 'button'), 'header toggle is a native button (Enter/Space, role=button)');
  await p.screenshot({ path: `${SHOTS}/today_expanded_light.png`, fullPage: false });

  // collapse On Today
  await tog(p, 'tc-on'); let on = await H(p, 'tc-on');
  assert(on.collapsed && on.exp === 'false', 'tap: On Today collapses (aria-expanded="false")');
  assert(/^On Today · 3$/i.test(on.text), 'collapsed header shows a count: ' + on.text);
  assert(await p.$eval('section.tc-on > .tc-body', e => e.inert && e.getBoundingClientRect().height < 1 && getComputedStyle(e).visibility === 'hidden'), 'collapsed body: zero height, hidden, inert');
  assert(await p.evaluate(() => JSON.parse(localStorage.getItem('sandy.todayCollapsed.v1')).on === 1), 'saved on the device (sandy.todayCollapsed.v1)');
  const rot = s => p.$eval(`section.${s} .tc-chev`, e => getComputedStyle(e).transform);
  assert(await rot('tc-on') !== await rot('tc-overdue'), 'chevron rotates when collapsed');

  // every other card collapses with its own summary
  for (const c of ['tc-heads', 'tc-overdue', 'tc-tomorrow', 'tc-practice', 'tc-travel']) await tog(p, c);
  hs = await heads(p); const t = c => hs.find(h => h.cls === c).text;
  assert(/^Heads Up · \d+ alerts?$/i.test(t('tc-heads')), 'Heads Up (leave-by + overlaps) summary: ' + t('tc-heads'));
  assert(/^Overdue To-Dos · 1$/i.test(t('tc-overdue')), 'Overdue summary: ' + t('tc-overdue'));
  assert(/^🌙 Tomorrow · Wed, Nov 18 · 2 items$/i.test(t('tc-tomorrow')), 'Tomorrow summary: ' + t('tc-tomorrow'));
  assert(/^🏀 Practice prep · Jennings High School · Tomorrow 3(:00)? PM$/i.test(t('tc-practice')), 'Practice prep summary: ' + t('tc-practice'));
  assert(/^🚌 Travel plan · Neutral site · leave \d{1,2}:\d\d [AP]M$/i.test(t('tc-travel')), 'Travel plan summary: ' + t('tc-travel'));
  await p.screenshot({ path: `${SHOTS}/today_collapsed_light.png` });

  // the Sandy Intelligence intro card collapses too
  await p.click('#todayNudges .tc-tog');
  assert(await p.$eval('#todayNudges', e => e.classList.contains('is-collapsed') && e.querySelector('.tc-tog').getAttribute('aria-expanded') === 'false' && e.querySelector('.tc-body').getBoundingClientRect().height < 1), 'Sandy Intelligence intro card collapses');
  assert(await p.evaluate(() => JSON.parse(localStorage.getItem('sandy.todayCollapsed.v1'))['si-intro'] === 1), '...and is remembered');
  // re-render (every minute), next day, reload: state kept, no animation
  await tog(p, 'tc-tomorrow'); // re-open one
  await p.evaluate(() => window.SandyNav.renderToday()); await p.waitForTimeout(500);
  hs = await heads(p); assert(hs.filter(h => h.collapsed).length === 5 && !hs.find(h => h.cls === 'tc-tomorrow').collapsed, 'state survives the minute re-render');
  assert(await p.$eval('section.tc-on', e => e.classList.contains('tc-noanim') || getComputedStyle(e.querySelector('.tc-body')).transitionDuration.split(',').every(x => parseFloat(x) === 0)), 're-render does not animate');
  await p.reload(); await p.waitForFunction(() => window.SandyCollapse && window.SandyNav); await today(p);
  hs = await heads(p); assert(hs.find(h => h.cls === 'tc-on').collapsed && hs.find(h => h.cls === 'tc-heads').collapsed && !hs.find(h => h.cls === 'tc-tomorrow').collapsed, 'state survives a reload');
  assert(await p.$eval('#todayNudges', e => e.classList.contains('is-collapsed')), 'intro card state survives a reload');
  await p.clock.setSystemTime(new Date('2026-11-18T14:00:00Z')); await today(p); // Wed 8 AM
  hs = await heads(p); assert(hs.find(h => h.cls === 'tc-on').collapsed && hs.find(h => h.cls === 'tc-practice').collapsed, 'state carries to the next day');
  // per user
  const otherUser = await p.evaluate(() => { const a = window.__app; const old = a.user; a.user = () => ({ id: 'user-2' }); const k = window.SandyCollapse.key(); const s = window.SandyCollapse.read(); a.user = old; return { k, s }; });
  assert(otherUser.k === 'sandy.todayCollapsed.v1.user-2' && Object.keys(otherUser.s).length === 0, 'state is kept per signed-in user');

  // keyboard
  await p.evaluate(() => { for (const b of document.querySelectorAll('#todayBody .tc-card.is-collapsed > h3 .tc-tog')) b.click(); }); await p.waitForTimeout(200);
  await p.focus('section.tc-on > h3 .tc-tog'); await p.keyboard.press('Enter'); assert((await H(p, 'tc-on')).collapsed, 'Enter collapses');
  await p.keyboard.press('Tab'); const nextFocus = await p.evaluate(() => !!document.activeElement.closest('section.tc-on .tc-body'));
  assert(!nextFocus, 'Tab skips the collapsed content');
  await p.focus('section.tc-on > h3 .tc-tog'); await p.keyboard.press('Space'); assert(!(await H(p, 'tc-on')).collapsed, 'Space expands');
  await p.focus('section.tc-on > h3 .tc-tog'); await p.evaluate(() => window.SandyNav.renderToday()); await p.waitForTimeout(400);
  assert(await p.evaluate(() => document.activeElement && document.activeElement.dataset.ckey === 'on'), 'keyboard focus stays on the header across the re-render');
  assert(!errs.length, 'no page errors: ' + errs.join(' | ')); await ctx.close();

  // ---- motion on: animated
  ({ ctx, p, errs } = await open({ motion: 'no-preference' })); await seed(p); await today(p);
  await tog(p, 'tc-on'); await p.waitForTimeout(40);
  const mid = await p.$eval('section.tc-on > .tc-body', e => ({ dur: getComputedStyle(e).transitionDuration, h: e.getBoundingClientRect().height }));
  assert(mid.dur.split(',').some(x => parseFloat(x) >= 0.2), 'height/opacity transition when motion is allowed: ' + mid.dur);
  await p.waitForTimeout(400); assert(await p.$eval('section.tc-on > .tc-body', e => e.getBoundingClientRect().height < 1), 'animation ends collapsed');
  assert(await p.$eval('section.tc-on .tc-chev', e => parseFloat(getComputedStyle(e).transitionDuration) > 0), 'chevron rotation animates');
  assert(!errs.length, 'no page errors (motion)'); await ctx.close();
  ({ ctx, p, errs } = await open()); await seed(p); await today(p);
  assert(await p.$eval('section.tc-on > .tc-body', e => getComputedStyle(e).transitionDuration.split(',').every(x => parseFloat(x) === 0)), 'prefers-reduced-motion: no transition');
  await ctx.close();

  // ---- dark
  ({ ctx, p, errs } = await open({ dark: true })); await seed(p); await p.clock.setSystemTime(new Date('2026-11-18T00:15:00Z'));
  await p.evaluate(() => window.SandyNav.setDark(true)); await today(p);
  await tog(p, 'tc-on'); await tog(p, 'tc-practice'); await p.waitForTimeout(200);
  await p.screenshot({ path: `${SHOTS}/today_mixed_dark.png` });
  await p.focus('section.tc-heads > h3 .tc-tog'); await p.keyboard.press('Shift+Tab'); await p.keyboard.press('Tab'); await p.waitForTimeout(100);
  await p.screenshot({ path: `${SHOTS}/today_focus_dark.png` });
  assert(!errs.length, 'no page errors (dark)'); await ctx.close();
  await b.close(); console.log('TODAY COLLAPSE TESTS PASSED');
})().catch(e => { console.error(e); process.exit(1); });
