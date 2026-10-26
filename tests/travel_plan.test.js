// Browser test (Scott 2026-10-25, SI feature D): away / neutral Maryville game travel plan on Today. Local mode, 390px.
// Photon, Valhalla and Open-Meteo MOCKED (no real network). Fake addresses. Covers: which games get a card (Maryville
// away + neutral within 3 days, not home games, other teams, finished or far-off games; max 2, soonest first);
// leave time = tip-off - drive - 60 min (rounded down to 5), from home; return = end + 30 min + drive (rounded up),
// overnight return labelled with the day; no home -> from Maryville University; venue not found -> drive from the
// game's notes; weather at tip-off from Open-Meteo (Fahrenheit, America/Chicago, no key), cached 1 hour, refreshed
// after; weather failure message; forecast-too-far message (unit); venue Maps link; no other network calls.
//   node tests/travel_plan.test.js http://127.0.0.1:8766/ [shotsDir]
const { chromium } = require(process.env.PW || '/workspace/shot-tools/node_modules/playwright-core');
const fs = require('fs');
const BASE = process.argv[2] || 'http://127.0.0.1:8766/'; const SHOTS = process.argv[3] || '/workspace/shots-si-d';
fs.mkdirSync(SHOTS, { recursive: true });
const assert = (c, m) => { if (!c) throw new Error('FAIL: ' + m); console.log('ok -', m); };
const HOME = [38.60, -90.80], GYM = [38.70, -90.40], FIELD = [35.6, -88.8], CAMPUS = [38.64, -90.50];
const near = (a, b) => Math.abs(a - b) < 2e-3;

(async () => {
  const b = await chromium.launch({ executablePath: '/usr/bin/google-chrome', headless: true, args: ['--no-sandbox'] });
  const ext = [];
  async function open({ at, dark = false, wxFail = false }) {
    const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, timezoneId: 'America/Chicago', locale: 'en-US', isMobile: true, hasTouch: true, deviceScaleFactor: 2, reducedMotion: 'reduce', colorScheme: dark ? 'dark' : 'light' });
    const calls = { wx: [], route: 0 };
    await ctx.route('https://photon.komoot.io/**', r => {
      const q = (new URL(r.request().url()).searchParams.get('q') || '').toLowerCase();
      const c = q.includes('test home') ? HOME : q.includes('gym a') ? GYM : q.includes('field b') ? FIELD : q.includes('maryville university') ? CAMPUS : null;
      r.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify({ features: c ? [{ geometry: { coordinates: [c[1], c[0]] }, properties: {} }] : [] }) });
    });
    await ctx.route('https://valhalla1.openstreetmap.de/**', r => { calls.route++;
      const j = JSON.parse(new URL(r.request().url()).searchParams.get('json')); const [o, d] = j.locations;
      const fromHome = near(o.lat, HOME[0]) && near(o.lon, HOME[1]);
      const mins = near(d.lat, FIELD[0]) ? (fromHome ? 330 : 360) : (fromHome ? 32 : 25);
      r.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify({ trip: { summary: { time: mins * 60, length: mins * 0.9 } } }) });
    });
    await ctx.route('https://api.open-meteo.com/**', r => {
      const u = new URL(r.request().url()); calls.wx.push(Object.fromEntries(u.searchParams));
      if (wxFail) return r.fulfill({ status: 500, body: 'down', headers: { 'access-control-allow-origin': '*' } });
      const date = u.searchParams.get('start_date'); const rain = date === '2026-11-19';
      const time = Array.from({ length: 24 }, (_, h) => `${date}T${String(h).padStart(2, '0')}:00`);
      r.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify({ hourly: { time,
        temperature_2m: time.map((_, h) => 40 + h + 0.4), precipitation_probability: time.map(() => rain ? 70 : 20), weather_code: time.map(() => rain ? 63 : 2), wind_speed_10m: time.map(() => rain ? 18 : 6) } }) });
    });
    const p = await ctx.newPage(); const errs = []; p.on('pageerror', e => errs.push(e.message));
    p.on('request', q => { const u = q.url(); if (!u.startsWith(BASE) && !/photon\.komoot|valhalla1\.openstreetmap|api\.open-meteo\.com|^data:|^blob:/.test(u)) ext.push(u); });
    await p.clock.install({ time: new Date(at) });
    await p.goto(BASE); await p.waitForFunction(() => window.__app && window.__app.Store && window.SandyTravel && window.SandyGames && document.querySelector('#calendar .fc-view, .tc-summary'));
    await p.evaluate(() => { localStorage.clear(); sessionStorage.clear(); });
    return { ctx, p, errs, calls };
  }
  const seed = async (p, { home = true, venue = 'Field B, Testtown, TN 38000' } = {}) => p.evaluate(async ([home, venue]) => {
    const S = window.__app.Store; if (S.clearExamples) await S.clearExamples(); for (const e of await S.list()) { try { await S.remove(e.id); } catch (_) {} }
    const ev = o => ({ id: crypto.randomUUID(), kind: 'event', allDay: false, recurrence: { freq: 'none' }, location: '', notes: '', calendar: 'mam', category: 'Game – Maryville University', ...o });
    const L = [
      ev({ title: 'Maryville University vs Malone University - NEUTRAL', start: '2026-11-17T18:00', end: '2026-11-17T20:00', location: 'Gym A, Testville, MO' }),
      ev({ title: 'Maryville University @ Test College - AWAY', start: '2026-11-19T18:00', end: '2026-11-19T20:00', location: venue, notes: 'Drive from Maryville University: 314 mi, about 5 hr 59 min' }),
      ev({ title: 'Maryville University vs Home College - HOME', start: '2026-11-18T19:00', end: '2026-11-18T21:00', location: 'Simon Athletic Center' }),
      ev({ title: 'Maryville University @ Early College - AWAY', start: '2026-11-17T08:00', end: '2026-11-17T10:00', location: 'Gym A, Testville, MO' }),
      ev({ title: 'Maryville University @ Far College - AWAY', start: '2026-11-27T18:00', end: '2026-11-27T20:00', location: 'Gym A, Testville, MO' }),
      ev({ title: 'Riverside HS @ Rival High - AWAY', category: 'Game – Riverside High School', start: '2026-11-18T18:00', end: '2026-11-18T20:00', location: 'Gym A, Testville, MO' }),
    ];
    for (const e of L) await S.save(e);
    if (home) await window.SandyLeave.setHome('1 Test Home Rd, Testville, MO 63000'); else await window.SandyLeave.setHome('');
    window.__app.refresh();
  }, [home, venue]);
  const today = async p => { await p.evaluate(() => window.SandyNav.go('today')); await p.evaluate(() => window.SandyNav.renderToday());
    await p.waitForFunction(() => [...document.querySelectorAll('.tc-travel')].every(s => !s.querySelector('[data-state=pending]')), null, { timeout: 8000 }).catch(() => {}); await p.waitForTimeout(400); };
  const cards = p => p.$$eval('.tc-travel', cs => cs.map(c => { const tx = e => e ? e.innerText.replace(/\s+/g, ' ').trim().replace(/^(GAME|LEAVE|BACK|WEATHER) /, (m, w) => w[0] + w.slice(1).toLowerCase() + ' ') : '';
    const lv = c.querySelector('.tv-leave');
    return { head: tx(c.querySelector('h3')), game: tx(c.querySelector('.tv-game')), venue: tx(c.querySelector('.tv-venue')), venueHref: (c.querySelector('.tv-venue a') || {}).href || '',
      leave: tx(lv), leaveState: lv ? lv.dataset.state : '', leaveAt: lv ? lv.dataset.leave || '' : '', backAt: lv ? lv.dataset.back || '' : '', back: tx(c.querySelector('.tv-back')),
      note: tx(c.querySelector('.tv-note')), wx: tx(c.querySelector('.tv-wx')), wxState: (c.querySelector('.tv-wx') || { dataset: {} }).dataset.state }; }));
  const shot = async (p, name) => { await p.evaluate(() => { const el = document.querySelector('.tc-travel'); if (el) { el.scrollIntoView({ block: 'start' }); document.scrollingElement.scrollTop -= 80; } }); await p.waitForTimeout(250); await p.screenshot({ path: `${SHOTS}/${name}.png`, fullPage: false }); };

  // ---------- 1. Tue Nov 17, 10 AM, home set
  let s = await open({ at: '2026-11-17T16:00:00Z' }); await seed(s.p); await today(s.p);
  let c = await cards(s.p);
  assert(c.length === 2 && /Neutral site/.test(c[0].head) && /Malone/.test(c[0].game) && /Away/.test(c[1].head) && /Test College/.test(c[1].game), 'two cards, soonest first: today\'s neutral game, Thursday\'s away game (no home game, unnamed-team game, finished or far-off games)');
  assert(/Today 6:00 PM/.test(c[0].game) && /Thu, Nov 19 6:00 PM/.test(c[1].game), 'game times: ' + c[0].game + ' / ' + c[1].game);
  assert(c[0].leaveAt === '4:25 PM' && /Leave Today 4:25 PM from home 32 min drive, 28.8 mi/.test(c[0].leave) && /there 60 min before tip-off/.test(c[0].leave), 'neutral: leave 4:25 PM (6:00 - 32 - 60, rounded down): ' + c[0].leave);
  assert(c[0].backAt === '9:05 PM' && /Back about 9:05 PM game ends 8:00 PM \+ 30 min \+ drive/.test(c[0].back), 'neutral: back about 9:05 PM (8:00 + 30 + 32, rounded up): ' + c[0].back);
  assert(c[1].leaveAt === '11:30 AM' && /Leave Thu, Nov 19 11:30 AM from home 5 hr 30 min drive, 297 mi/.test(c[1].leave), 'away: leave Thu 11:30 AM (5 hr 30 drive + 1 hr early): ' + c[1].leave);
  assert(c[1].backAt === '2:00 AM' && /Back about Fri, Nov 20 2:00 AM/.test(c[1].back), 'away: back after midnight -> labelled Fri, Nov 20 2:00 AM (8:00 + 30 + 5 hr 30): ' + c[1].back);
  assert(c[0].wxState === 'ok' && /Weather ⛅ 58°F, partly cloudy · 20% chance of rain\/snow at tip-off · Open-Meteo/.test(c[0].wx) && !/wind/.test(c[0].wx), 'neutral weather at tip-off (6 PM hour): ' + c[0].wx);
  assert(/🌧️ 58°F, rain · 70% chance of rain\/snow · wind 18 mph/.test(c[1].wx), 'away weather: rain + wind when windy: ' + c[1].wx);
  const w = s.calls.wx[0];
  assert(s.calls.wx.length === 2 && w.temperature_unit === 'fahrenheit' && w.timezone === 'America/Chicago' && w.wind_speed_unit === 'mph' && !Object.keys(w).some(k => /key|token/i.test(k)) && s.calls.wx.some(x => x.start_date === '2026-11-19' && near(+x.latitude, FIELD[0])), 'Open-Meteo asked once per game at the venue, °F, Central time, no key');
  assert(/Field B, Testtown, TN 38000/.test(c[1].venue) && /google\.com\/maps\/dir\/.*destination=Field/.test(c[1].venueHref), 'venue with a Maps directions link');
  await shot(s.p, 'travel_light');
  // cached: re-render does not call Open-Meteo again; after 2 hours it refreshes
  await today(s.p); await today(s.p);
  assert(s.calls.wx.length === 2, 'weather cached (no new calls on re-render)');
  await s.p.clock.setSystemTime(new Date('2026-11-17T18:05:00Z')); await today(s.p);
  assert(s.calls.wx.length === 4, 'weather refreshed after an hour: ' + s.calls.wx.length);
  // after the neutral game ends -> only the away card
  await s.p.clock.setSystemTime(new Date('2026-11-18T02:01:00Z')); await today(s.p); c = await cards(s.p);
  assert(c.length === 1 && /Test College/.test(c[0].game), 'after the game ends, its card goes');
  // unit: forecast too far ahead
  const far = await s.p.evaluate(async () => { const n = window.__app.nowWall(); const r = await window.SandyTravel.weather(35, -88, new Date(n.getTime() + 20 * 864e5), n); return [r, window.SandyTravel.wxText(r)]; });
  assert(far[0].why === 'far' && /about 2 weeks out/.test(far[1]), 'more than ~2 weeks out: no forecast call, friendly text');
  assert(s.errs.length === 0, 'no page errors: ' + s.errs.join(' | '));
  // ---------- 2. no home, unknown venue, weather down (dark)
  const d = await open({ at: '2026-11-17T16:00:00Z', dark: true, wxFail: true }); await seed(d.p, { home: false, venue: 'Unknown Arena Nowhere' });
  await d.p.evaluate(() => window.SandyNav.setDark && window.SandyNav.setDark(true)); await today(d.p); c = await cards(d.p);
  assert(/from Maryville University 25 min drive/.test(c[0].leave) && c[0].leaveAt === '4:35 PM', 'no home: leaves from Maryville University (routed): ' + c[0].leave);
  assert(c[1].leaveAt === '11:00 AM' && /from Maryville University 5 hr 59 min drive, 314 mi/.test(c[1].leave) && /Drive time from the game's notes/.test(c[1].note), "venue not found: drive from the game's notes (5 hr 59 min): " + c[1].leave);
  assert(c[0].wxState === 'fail' && /Weather unavailable right now/.test(c[0].wx) && /Weather unavailable/.test(c[1].wx), 'weather service down / venue unknown: "Weather unavailable right now."');
  await shot(d.p, 'travel_fallbacks_dark');
  const before = d.calls.wx.length; await today(d.p); await today(d.p);
  assert(d.calls.wx.length === before, 'weather failure remembered for 10 min (no retry every minute)');
  await d.p.evaluate(() => window.SandyLeave.setHome('1 Test Home Rd, Testville, MO 63000'));
  const d2 = await open({ at: '2026-11-17T16:00:00Z', dark: true }); await seed(d2.p); await d2.p.evaluate(() => window.SandyNav.setDark && window.SandyNav.setDark(true)); await today(d2.p);
  await shot(d2.p, 'travel_dark');
  assert(d.errs.length === 0 && d2.errs.length === 0, 'no page errors (dark)');
  assert(ext.length === 0, 'no other network calls: ' + ext.slice(0, 3).join(' '));
  await b.close(); console.log('TRAVEL PLAN TESTS PASSED');
})().catch(e => { console.error(e); process.exit(1); });
