// Browser test (Scott 2026-10-25, SI feature B): evening "Tomorrow" preview on the Today tab. Local mode, 390px.
// Photon + Valhalla mocked (no real network). Covers: hidden before 6 PM and after midnight; from 6 PM a card with
// tomorrow's date, event / to-do counts (today's and later events not counted), first timed event (before all-day),
// leave-by for it from home (start - drive - 10 min, rounded down to 5), prep list from your own data only:
// early start, unticked "- [ ]" checklist lines (ticked ones for that date hidden), Bring/Pack/Don't-forget lines in
// event notes and Today's Notes (recurring event -> that date's note), open to-dos due tomorrow (done ones skipped);
// "+N more" cap; tapping a title opens the editor; no home -> "Add your home"; nothing to prep; nothing tomorrow;
// first drive is not the first event; re-render each minute keeps it. Screenshots light + dark.
//   node tests/tomorrow_preview.test.js http://127.0.0.1:8766/ [shotsDir]
const { chromium } = require(process.env.PW || '/workspace/shot-tools/node_modules/playwright-core');
const fs = require('fs');
const BASE = process.argv[2] || 'http://127.0.0.1:8766/'; const SHOTS = process.argv[3] || '/workspace/shots-si-b';
fs.mkdirSync(SHOTS, { recursive: true });
const assert = (c, m) => { if (!c) throw new Error('FAIL: ' + m); console.log('ok -', m); };
const HOME = [38.60, -90.80], GYM = [38.70, -90.40], FIELD = [38.75, -90.30];
const near = (a, b) => Math.abs(a - b) < 2e-3;

(async () => {
  const b = await chromium.launch({ executablePath: '/usr/bin/google-chrome', headless: true, args: ['--no-sandbox'] });
  const ext = [];
  async function open({ at, dark = false }) {
    const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, timezoneId: 'America/Chicago', locale: 'en-US', isMobile: true, hasTouch: true, deviceScaleFactor: 2, reducedMotion: 'reduce', colorScheme: dark ? 'dark' : 'light' });
    const calls = { route: 0 };
    await ctx.route('https://photon.komoot.io/**', r => {
      const q = (new URL(r.request().url()).searchParams.get('q') || '').toLowerCase();
      const c = q.includes('test home') ? HOME : q.includes('gym a') ? GYM : q.includes('field b') ? FIELD : null;
      r.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify({ features: c ? [{ geometry: { coordinates: [c[1], c[0]] }, properties: {} }] : [] }) });
    });
    await ctx.route('https://valhalla1.openstreetmap.de/**', r => { calls.route++;
      const j = JSON.parse(new URL(r.request().url()).searchParams.get('json')); const o = j.locations[0];
      const mins = near(o.lat, HOME[0]) && near(o.lon, HOME[1]) ? 32 : 20;
      r.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify({ trip: { summary: { time: mins * 60, length: mins * 0.7 } } }) });
    });
    const p = await ctx.newPage(); const errs = []; p.on('pageerror', e => errs.push(e.message));
    p.on('request', q => { const u = q.url(); if (!u.startsWith(BASE) && !/photon\.komoot|valhalla1\.openstreetmap|^data:|^blob:/.test(u)) ext.push(u); });
    await p.clock.install({ time: new Date(at) });
    await p.goto(BASE); await p.waitForFunction(() => window.__app && window.__app.Store && window.SandyTomorrow && document.querySelector('#calendar .fc-view, .tc-summary'));
    return { ctx, p, errs, calls };
  }
  const seed = async (p, home = true) => p.evaluate(async home => {
    localStorage.removeItem('sandy.locAsked.v1');
    const S = window.__app.Store; if (S.clearExamples) await S.clearExamples(); for (const e of await S.list()) { try { await S.remove(e.id); } catch (_) {} }
    const ev = o => ({ id: crypto.randomUUID(), kind: 'event', allDay: false, recurrence: { freq: 'none' }, location: '', notes: '', calendar: 'mam', category: 'Other', ...o });
    const ids = {};
    const add = async (k, o) => { const e = ev(o); ids[k] = e.id; await S.save(e); };
    await add('today', { title: 'Tonight thing', start: '2026-11-17T19:00', end: '2026-11-17T20:00', location: 'Gym A, Jennings, MO' });
    await add('allday', { title: 'Picture day', allDay: true, start: '2026-11-18', end: '2026-11-18' });
    await add('game', { title: 'Maryville game', category: 'Game', start: '2026-11-18T07:00', end: '2026-11-18T09:00', location: 'Gym A, Jennings, MO',
      notes: 'Big one.\n- [ ] Water bottle\n- [ ] Snacks\nBring: team roster\nwear the blue jersey' });
    await add('practice', { title: 'Jennings practice', category: 'Practice', start: '2026-11-11T18:00', end: '2026-11-11T20:00', location: 'Field B, Jennings, MO',
      recurrence: { freq: 'weekly', interval: 1, byWeekday: [3] }, notes: 'Pack cleats' });
    await add('later', { title: 'Thursday thing', start: '2026-11-19T09:00', end: '2026-11-19T10:00', notes: 'Bring nothing' });
    await add('task', { kind: 'task', title: 'Sign field trip form', allDay: true, start: '2026-11-18', end: '2026-11-18' });
    await add('done', { kind: 'task', title: 'Already done thing', allDay: true, start: '2026-11-18', end: '2026-11-18' });
    await add('movie', { title: 'Movie night', start: '2026-11-21T19:00', end: '2026-11-21T21:00' });
    await window.__app.setDone(ids.done, '2026-11-18', true);
    await S.checks.set(ids.game, '2026-11-18', ['snacks']);
    await S.notes.set(ids.practice, '2026-11-18', "Don't forget the permission slip\nCoach wants film");
    await S.notes.set(ids.practice, '2026-11-25', 'Bring the other ball'); // a different date of the series: not tomorrow
    if (home) await window.SandyLeave.setHome('1 Test Home Rd, Testville, MO 63000'); else await window.SandyLeave.setHome('');
    window.__app.refresh(); return ids;
  }, home);
  const today = async p => { await p.evaluate(() => window.SandyNav.go('today')); await p.evaluate(() => window.SandyNav.renderToday()); await p.waitForTimeout(300);
    await p.waitForFunction(() => { const c = document.getElementById('tcTomorrow'); if (!c) return true; const l = document.getElementById('tmLeave'); return !l || !l.hidden || !c.querySelector('.tm-first'); }, null, { timeout: 5000 }).catch(() => {}); await p.waitForTimeout(500); };
  const card = p => p.evaluate(() => { const c = document.getElementById('tcTomorrow'); if (!c) return null; const tx = e => e ? e.textContent.replace(/\s+/g, ' ').trim() : '';
    const l = document.getElementById('tmLeave');
    return { head: tx(c.querySelector('h3')), stats: tx(c.querySelector('.tm-stats')), first: tx(c.querySelector('.tm-first')), leave: l && !l.hidden ? tx(l) : '', leaveState: l ? l.dataset.state || '' : '',
      prep: [...c.querySelectorAll('.tm-prep li')].map(li => ({ kind: li.className.replace('tm-prep-', ''), text: tx(li) })), more: tx(c.querySelector('.tm-more')), none: tx(c.querySelector('.tm-none')), empty: tx(c.querySelector('.tm-empty')),
      afterHeads: !!(c.previousElementSibling && c.previousElementSibling.classList.contains('tc-heads')) || !!c.parentElement.querySelector('.tc-heads ~ #tcTomorrow') }; });
  const shot = async (p, name) => { await p.evaluate(() => { const t = document.getElementById('toast'); if (t) t.hidden = true; const el = document.getElementById('tcTomorrow'); if (el) { el.scrollIntoView({ block: 'start' }); document.scrollingElement.scrollTop -= 80; } }); await p.waitForTimeout(250); await p.screenshot({ path: `${SHOTS}/${name}.png` }); };

  // ---------- 1. 5:59 PM Tue Nov 17: no card yet
  let s = await open({ at: '2026-11-17T23:59:00Z' });
  await s.p.evaluate(() => { localStorage.clear(); sessionStorage.clear(); }); const ids = await seed(s.p); await today(s.p);
  assert(await card(s.p) === null, '5:59 PM: no Tomorrow card yet');
  // ---------- 2. 6:00 PM: card
  await s.p.clock.setSystemTime(new Date('2026-11-18T00:00:00Z')); await today(s.p);
  let c = await card(s.p);
  assert(c && /Tomorrow · Wed, Nov 18/.test(c.head), '6:00 PM: Tomorrow card for Wed, Nov 18: ' + (c && c.head));
  assert(c.stats.replace(/\s/g, '') === '3events2to-dos', "counts tomorrow only (all-day + game + practice; 2 to-dos): " + c.stats);
  assert(/^First up\s*Maryville game at 7:00 AM$/.test(c.first), 'first up = first timed event (not the all-day one): ' + c.first);
  assert(c.leaveState === 'ok' && /Leave by 6:15 AM · 32 min from home/.test(c.leave) && !/ for /.test(c.leave), 'leave by 6:15 AM from home (7:00 - 32 - 10, rounded down): ' + c.leave);
  const kinds = c.prep.map(x => x.kind).join(','), texts = c.prep.map(x => x.text);
  console.log('# prep:', JSON.stringify(texts));
  assert(kinds === 'early,check,bring,bring,bring,bring' && c.more === '+1 more', 'prep order: early start, checklist, bring lines, capped at 6 with "+1 more": ' + kinds + ' ' + c.more);
  assert(/Early start: Maryville game at 7:00 AM/.test(texts[0]), 'early start flagged (before 8 AM)');
  assert(/Checklist: Water bottle · Maryville game/.test(texts[1]) && !texts.some(t => /Snacks/.test(t)), 'unticked checklist line shown; ticked "Snacks" (for that date) hidden');
  assert(texts.some(t => /^🎒 Bring: team roster · Maryville game$/.test(t)) && texts.some(t => /wear the blue jersey/.test(t)), 'Bring / wear lines from the event notes');
  assert(texts.some(t => /Pack cleats · Jennings practice/.test(t)) && texts.some(t => /Don't forget the permission slip · Jennings practice/.test(t)), "recurring event: series notes + that date's Today's Note");
  assert(!texts.some(t => /Coach wants film|other ball|Bring nothing|Tonight thing/.test(t)), "plain note lines, other dates' notes and other days' events not included");
  await shot(s.p, 'tomorrow_light');
  // tap a title -> editor
  await s.p.click('#tcTomorrow .tm-first .tc-item'); await s.p.waitForFunction(() => document.getElementById('eventDialog').open);
  assert(await s.p.inputValue('#eventDialog input[name=title]') === 'Maryville game', 'tapping the first event opens it in the editor');
  await s.p.keyboard.press('Escape'); await s.p.waitForTimeout(400);
  // ---------- 3. fewer prep items: tick the checklist, mark the to-do done -> to-do appears? (cap logic)
  await s.p.evaluate(async ids => { await window.__app.Store.checks.set(ids.game, '2026-11-18', ['snacks', 'water bottle']); await window.__app.Store.notes.set(ids.practice, '2026-11-18', ''); window.__app.refresh(); }, ids);
  await today(s.p); c = await card(s.p);
  assert(!c.prep.some(x => x.kind === 'check') && c.prep.some(x => x.kind === 'todo' && /To-do: Sign field trip form/.test(x.text)) && !c.prep.some(x => /Already done/.test(x.text)) && c.more === '', 'checklist ticked off -> gone; open to-do due tomorrow shown; done to-do skipped; no "+more": ' + JSON.stringify(c.prep.map(x => x.text)));
  // minute re-render keeps the card
  await s.p.clock.runFor(61000); await s.p.waitForTimeout(800); c = await card(s.p);
  assert(c && /Leave by 6:15 AM/.test(c.leave), 'still there after the 1-minute refresh');
  // ---------- 4. 11:59 PM still shown; 12:05 AM (now Wed) the card is gone
  await s.p.clock.setSystemTime(new Date('2026-11-18T05:59:00Z')); await today(s.p);
  assert(/Wed, Nov 18/.test((await card(s.p)).head), '11:59 PM: still showing tomorrow');
  await s.p.clock.setSystemTime(new Date('2026-11-18T06:05:00Z')); await today(s.p);
  assert(await card(s.p) === null, '12:05 AM: no card (morning; Today shows the day itself)');
  // ---------- 5. Fri Nov 20 evening: tomorrow = Sat Nov 21: Movie night, no location -> no leave line; nothing to prep
  await s.p.clock.setSystemTime(new Date('2026-11-21T01:30:00Z')); await today(s.p); c = await card(s.p);
  assert(/Sat, Nov 21/.test(c.head) && /First up\s*Movie night at 7:00 PM/.test(c.first) && c.leave === '' && /Nothing flagged/.test(c.none), 'no location -> no leave line; nothing flagged to prep: ' + c.none);
  // ---------- 6. Sat Nov 21 evening: tomorrow Sunday empty
  await s.p.clock.setSystemTime(new Date('2026-11-22T01:30:00Z')); await today(s.p); c = await card(s.p);
  assert(/Sun, Nov 22/.test(c.head) && c.stats.replace(/\s/g, '') === '0events0to-dos' && /Nothing on the calendar tomorrow/.test(c.empty), 'empty tomorrow: says so');
  // ---------- 7. Tue Nov 24 evening: tomorrow only the recurring practice at 6 PM (Field B), plus an all-day event first in the list
  await s.p.clock.setSystemTime(new Date('2026-11-25T01:00:00Z')); await today(s.p); c = await card(s.p);
  assert(/Wed, Nov 25/.test(c.head) && /First up\s*Jennings practice at 6:00 PM/.test(c.first) && /Leave by 5:15 PM · 32 min from home/.test(c.leave) && !c.prep.some(x => x.kind === 'early'), 'recurring occurrence: leave by 5:15 PM; no early-start flag: ' + c.leave);
  assert(c.prep.some(x => /Bring the other ball/.test(x.text)) && c.prep.some(x => /Pack cleats/.test(x.text)), "that date's own Today's Note used");
  assert(s.errs.length === 0, 'no page errors: ' + s.errs.join(' | '));
  // ---------- 8. dark mode + no home
  let d = await open({ at: '2026-11-18T00:30:00Z', dark: true });
  await d.p.evaluate(() => { localStorage.clear(); sessionStorage.clear(); }); await seed(d.p, false);
  await d.p.evaluate(() => window.SandyNav.setDark && window.SandyNav.setDark(true)); await today(d.p); c = await card(d.p);
  assert(c.leaveState === 'nohome' && /Add your home to see when to leave/.test(c.leave), 'no home: "Add your home" in the Tomorrow card');
  await shot(d.p, 'tomorrow_nohome_dark');
  await d.p.click('#tmLeave .lb-sethome'); await d.p.waitForFunction(() => { const s = document.getElementById('homeSection'); return s && s.offsetParent; });
  assert(true, '"Add your home" opens Profile → Home');
  await d.p.evaluate(() => window.SandyLeave.setHome('1 Test Home Rd, Testville, MO 63000')); await d.p.evaluate(() => window.SandyLeave.invalidate()); await today(d.p);
  c = await card(d.p); assert(/Leave by 6:15 AM/.test(c.leave), 'dark: leave line after setting home');
  await shot(d.p, 'tomorrow_dark');
  assert(d.errs.length === 0, 'no page errors (dark): ' + d.errs.join(' | '));
  assert(ext.length === 0, 'no other network calls (prep is from your own data; no AI): ' + ext.slice(0, 3).join(' '));
  await b.close(); console.log('TOMORROW PREVIEW TESTS PASSED');
})().catch(e => { console.error(e); process.exit(1); });
