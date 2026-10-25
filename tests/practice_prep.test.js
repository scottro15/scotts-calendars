// Browser test (Scott 2026-10-25, SI feature C): Practice prep card on the Today tab. Local mode, 390px, fake data.
// Covers: Maryville practice today -> card with the last Maryville practice's Today's Note (newest one with notes,
// long notes folded behind "Show N more lines"), its Notion link (opens the page; the app makes no Notion calls),
// and this practice's own note; still shown during practice ("now, until"); gone after it ends; tomorrow's Jennings
// practice only in the evening; a one-off practice's own notes count (category or title "Jennings ... practice");
// "No notes from <date>" when the latest practice had none; nothing yet -> hint; games, client workouts and other
// teams get no card; tapping opens the editor; no outside network calls. Screenshots light + dark.
//   node tests/practice_prep.test.js http://127.0.0.1:8766/ [shotsDir]
const { chromium } = require(process.env.PW || '/workspace/shot-tools/node_modules/playwright-core');
const fs = require('fs');
const BASE = process.argv[2] || 'http://127.0.0.1:8766/'; const SHOTS = process.argv[3] || '/workspace/shots-si-c';
fs.mkdirSync(SHOTS, { recursive: true });
const assert = (c, m) => { if (!c) throw new Error('FAIL: ' + m); console.log('ok -', m); };
const NOTION = 'https://www.notion.so/test-workspace/Maryville-practice-Nov-12-0123456789abcdef0123456789abcdef';

(async () => {
  const b = await chromium.launch({ executablePath: '/usr/bin/google-chrome', headless: true, args: ['--no-sandbox'] });
  const ext = [];
  async function open({ at, dark = false }) {
    const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, timezoneId: 'America/Chicago', locale: 'en-US', isMobile: true, hasTouch: true, deviceScaleFactor: 2, reducedMotion: 'reduce', colorScheme: dark ? 'dark' : 'light' });
    await ctx.route(/photon\.komoot|valhalla1\.openstreetmap|notion\.so/, r => r.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: '{"features":[]}' }));
    const p = await ctx.newPage(); const errs = []; p.on('pageerror', e => errs.push(e.message));
    p.on('request', q => { const u = q.url(); if (!u.startsWith(BASE) && !/^data:|^blob:/.test(u)) ext.push(u); });
    await p.clock.install({ time: new Date(at) });
    await p.goto(BASE); await p.waitForFunction(() => window.__app && window.__app.Store && window.SandyPractice && document.querySelector('#calendar .fc-view, .tc-summary'));
    await p.evaluate(() => { localStorage.clear(); sessionStorage.clear(); });
    return { ctx, p, errs };
  }
  const seed = async p => p.evaluate(async NOTION => {
    const S = window.__app.Store; if (S.clearExamples) await S.clearExamples(); for (const e of await S.list()) { try { await S.remove(e.id); } catch (_) {} }
    const ev = o => ({ id: crypto.randomUUID(), kind: 'event', allDay: false, recurrence: { freq: 'none' }, location: '', notes: '', calendar: 'mam', category: 'Other', ...o });
    const ids = {}; const add = async (k, o) => { const e = ev(o); ids[k] = e.id; await S.save(e); };
    await add('mv', { title: 'Maryville University practice', category: 'Team practice – Maryville University', start: '2026-10-01T15:00', end: '2026-10-01T17:00', recurrence: { freq: 'weekly', interval: 1, byWeekday: [2, 4] }, notes: 'Bring film clips' });
    await add('jn', { title: 'Jennings practice', category: 'Team practice – Jennings High School', start: '2026-10-07T15:30', end: '2026-10-07T17:30', recurrence: { freq: 'weekly', interval: 1, byWeekday: [3] } });
    await add('jn1', { title: 'Jennings HS practice (extra)', category: 'Other', start: '2026-11-09T16:00', end: '2026-11-09T17:00', notes: '- Free throws: 50 each\n- Closeouts' });
    await add('beal', { title: 'Brad Beal Elite EYBL practice', category: 'Team practice – Brad Beal Elite (EYBL)', start: '2026-11-17T12:00', end: '2026-11-17T13:00' });
    await add('bealOld', { title: 'Brad Beal Elite EYBL practice', category: 'Team practice – Brad Beal Elite (EYBL)', start: '2026-11-10T12:00', end: '2026-11-10T13:00', notes: 'Beal note' });
    await add('game', { title: 'Maryville University vs Test College - HOME', category: 'Game – Maryville University', start: '2026-11-17T19:00', end: '2026-11-17T21:00', notes: 'Scout: zone' });
    await add('dake', { title: 'Christian Dake workout', category: 'Client workout', start: '2026-11-17T08:00', end: '2026-11-17T09:00' });
    await add('dakeOld', { title: 'Christian Dake workout', category: 'Client workout', start: '2026-11-14T08:00', end: '2026-11-14T09:00' });
    const long = ['Press break: trap the corner', 'Box out drill 3x', 'BLOB sets: 2 new', 'Transition D: sprint back', 'Free throws under fatigue', 'Ball screen coverage: ICE', 'Shell drill 10 min', 'Closeouts: high hands', 'Conditioning: 17s', 'Film: Thursday 2 PM'].join('\n');
    await S.notes.set(ids.mv, '2026-11-12', long);
    await S.notes.set(ids.mv, '2026-11-10', 'Old Maryville note');
    await S.notes.set(ids.mv, '2026-11-17', 'Plan: zone offense <b>x</b>');
    await S.notes.set(ids.dakeOld, '2026-11-14', 'Dake: single-leg work');
    localStorage.setItem('scott-calendar-links-v1', JSON.stringify([{ eventId: ids.mv, date: '2026-11-12', url: NOTION }]));
    S.links.invalidate();
    window.__app.refresh(); return ids;
  }, NOTION);
  const today = async p => { await p.evaluate(() => window.SandyNav.go('today')); await p.evaluate(() => window.SandyNav.renderToday()); await p.waitForTimeout(500); };
  const cards = p => p.$$eval('.tc-practice', cs => cs.map(c => { const tx = e => e ? e.textContent.replace(/\s+/g, ' ').trim() : '';
    return { team: c.dataset.team, head: tx(c.querySelector('h3')), next: tx(c.querySelector('.pp-next')), h4: [...c.querySelectorAll('.pp-h4')].map(tx),
      notes: [...((c.querySelector(':scope > .pp-notes') || { querySelectorAll: () => [] }).querySelectorAll('li'))].map(tx), allNotes: [...c.querySelectorAll('.pp-notes li')].map(tx), more: tx(c.querySelector('.pp-more summary')),
      link: (c.querySelector('.pp-notion') || {}).href || '', target: (c.querySelector('.pp-notion') || { getAttribute: () => '' }).getAttribute('target'),
      gap: tx(c.querySelector('.pp-gap')), none: tx(c.querySelector('.pp-none')), html: c.innerHTML }; }));
  const shot = async (p, name) => { await p.evaluate(() => { const el = document.querySelector('.tc-practice'); if (el) { el.scrollIntoView({ block: 'start' }); document.scrollingElement.scrollTop -= 80; } }); await p.waitForTimeout(250); await p.screenshot({ path: `${SHOTS}/${name}.png` }); };

  // ---------- 1. Tue Nov 17, 10 AM: Maryville practice at 3 PM
  let s = await open({ at: '2026-11-17T16:00:00Z' }); const ids = await seed(s.p); await today(s.p);
  let c = await cards(s.p);
  assert(c.length === 1 && c[0].team === 'maryville', 'one card: Maryville (no Jennings tomorrow in the morning; no Beal, game or Dake workout card): ' + c.map(x => x.team));
  assert(/Practice prep · Maryville University/.test(c[0].head) && /Next\s*Maryville University practice Today 3:00 PM/.test(c[0].next), 'next practice today 3:00 PM: ' + c[0].next);
  assert(c[0].h4[0] === 'Last practice · Thu, Nov 12', 'last practice WITH notes = Thu, Nov 12 (newest; Nov 10 older, Nov 14/17 none yet): ' + c[0].h4[0]);
  assert(c[0].notes.length === 8 && c[0].notes[0] === 'Press break: trap the corner' && /Show 2 more lines/.test(c[0].more) && c[0].allNotes.includes('Film: Thursday 2 PM'), 'its note: first 8 lines, then "Show 2 more lines"');
  assert(!c[0].allNotes.some(x => /Old Maryville note|Bring film clips|Beal|Dake|Scout/.test(x)), "older note, series notes, other teams', games and workouts not mixed in");
  assert(c[0].link === NOTION && c[0].target === '_blank', 'Notion page link for that practice (opens in a new tab)');
  assert(c[0].h4[1] === 'This practice' && c[0].allNotes.includes('Plan: zone offense <b>x</b>') && !/<b>x<\/b>/.test(c[0].html), "this practice's own note shown (escaped)");
  assert(c[0].gap === '', 'no gap message (Nov 12 note is from the latest practice before today) ');
  await shot(s.p, 'practice_light');
  await s.p.click('.tc-practice .pp-more summary'); await s.p.waitForTimeout(200);
  assert(await s.p.$eval('.tc-practice .pp-more', d => d.open), '"Show 2 more lines" expands');
  await s.p.click('.tc-practice .pp-h4 .tc-item'); await s.p.waitForFunction(() => document.getElementById('eventDialog').open);
  assert(await s.p.inputValue('#eventDialog input[name=title]') === 'Maryville University practice', 'tapping "Thu, Nov 12" opens that practice');
  await s.p.evaluate(() => document.getElementById('eventDialog').close()); await s.p.waitForTimeout(300);
  // ---------- 2. 4 PM: during practice
  await s.p.clock.setSystemTime(new Date('2026-11-17T22:00:00Z')); await today(s.p); c = await cards(s.p);
  assert(c.length === 1 && /now, until 5:00 PM/.test(c[0].next), 'during practice: "now, until 5:00 PM"');
  // ---------- 3. 5:01 PM: over; next Maryville is Thursday, Jennings tomorrow but not evening yet
  await s.p.clock.setSystemTime(new Date('2026-11-17T23:01:00Z')); await today(s.p);
  assert((await cards(s.p)).length === 0, '5:01 PM: no card (practice over; tomorrow waits for the evening)');
  // ---------- 4. 7 PM: Jennings tomorrow 3:30 PM; last notes = the one-off extra practice (title match), gap note for Nov 11
  await s.p.clock.setSystemTime(new Date('2026-11-18T01:00:00Z')); await today(s.p); c = await cards(s.p);
  assert(c.length === 1 && c[0].team === 'jennings' && /Tomorrow 3:30 PM/.test(c[0].next), 'evening: Jennings practice tomorrow 3:30 PM: ' + c.map(x => x.next));
  assert(c[0].h4[0] === 'Last practice · Mon, Nov 9' && c[0].notes.join('|') === 'Free throws: 50 each|Closeouts', "one-off practice's own notes (title \"Jennings HS practice\")");
  assert(/No notes from Wed, Nov 11; these are the most recent\./.test(c[0].gap) && c[0].link === '', 'gap message when the latest practice had no notes; no Notion link');
  // ---------- 5. no notes yet -> hint
  await s.p.evaluate(async ids => { const S = window.__app.Store; await S.notes.set(ids.mv, '2026-11-12', ''); await S.notes.set(ids.mv, '2026-11-10', ''); await S.notes.set(ids.mv, '2026-11-17', ''); localStorage.setItem('scott-calendar-links-v1', '[]'); S.links.invalidate(); window.__app.refresh(); }, ids);
  await s.p.clock.setSystemTime(new Date('2026-11-19T16:00:00Z')); await today(s.p); c = await cards(s.p);
  assert(c.length === 1 && c[0].team === 'maryville' && /Thu/.test(c[0].next) === false && /Today 3:00 PM/.test(c[0].next) && /No notes from an earlier Maryville University practice yet/.test(c[0].none) && c[0].h4.length === 0, 'no notes anywhere -> friendly hint');
  // hidden calendar -> no card
  await s.p.evaluate(() => { const st = window.__app.settings(); st.visible.mam = false; window.__app.saveSettings && window.__app.saveSettings(); window.__app.refresh(); }); await today(s.p);
  assert((await cards(s.p)).length === 0, 'calendar turned off -> no card');
  assert(s.errs.length === 0, 'no page errors: ' + s.errs.join(' | '));
  // ---------- 6. dark
  const d = await open({ at: '2026-11-17T16:00:00Z', dark: true }); await seed(d.p); await d.p.evaluate(() => window.SandyNav.setDark && window.SandyNav.setDark(true)); await today(d.p);
  assert((await cards(d.p)).length === 1, 'dark: card shown'); await shot(d.p, 'practice_dark');
  await d.p.clock.setSystemTime(new Date('2026-11-18T01:00:00Z')); await today(d.p); await shot(d.p, 'practice_jennings_evening_dark');
  assert(d.errs.length === 0, 'no page errors (dark)');
  assert(ext.length === 0, 'no outside network calls (no Notion API; SANDY data only): ' + ext.slice(0, 3).join(' '));
  await b.close(); console.log('PRACTICE PREP TESTS PASSED');
})().catch(e => { console.error(e); process.exit(1); });
