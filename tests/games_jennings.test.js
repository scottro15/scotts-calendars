// Browser test (Scott 2026-10-26): Jennings High School (Jennings Warriors boys varsity) game events. Same as the HSSU
// games (games_hssu.test.js) but the glowing border and the big H / A / N badge are ORANGE (orange letter + orange
// border, letter >= 3:1 on its tile in both themes), clearly distinct from Maryville red and HSSU yellow. Every Jennings
// game (home too) shows the venue + "Drive from home" with Google Maps directions from home (from the event's notes;
// the home address is never in the app code). Also: the away / neutral Jennings travel plan on Today (from Profile
// home, else the notes' "Drive from home"; orange accent + "Jennings" tag) with OSM routing / Open-Meteo mocked.
// Uses a FAKE home address. Light + dark at 390x844, List / Day / Week.
//   node tests/games_jennings.test.js http://127.0.0.1:8787/ [screenshotDir]
const { chromium } = require(process.env.PW || '/workspace/shot-tools/node_modules/playwright-core');
const BASE = process.argv[2] || 'http://127.0.0.1:8787/'; const SHOTS = process.argv[3] || '/workspace/shots-jennings';
require('fs').mkdirSync(SHOTS, { recursive: true });
let n = 0; const assert = (c, m) => { if (!c) throw new Error('FAIL: ' + m); n++; console.log('ok -', m); };
const CONTRAST = `(() => {
  const parse = s => { let m = s.match(/color\\(srgb ([\\d.]+) ([\\d.]+) ([\\d.]+)/); if (m) return [+m[1] * 255, +m[2] * 255, +m[3] * 255];
    m = s.match(/rgba?\\(([\\d.]+),? ([\\d.]+),? ([\\d.]+)/); return m ? [+m[1], +m[2], +m[3]] : null; };
  const lum = c => { const f = v => { v /= 255; return v <= .03928 ? v / 12.92 : Math.pow((v + .055) / 1.055, 2.4); }; return .2126 * f(c[0]) + .7152 * f(c[1]) + .0722 * f(c[2]); };
  window.__contrast = (fg, bg) => { const a = lum(parse(fg)), b = lum(parse(bg)); return (Math.max(a, b) + .05) / (Math.min(a, b) + .05); };
})()`;
const FAKE_HOME = '1 Test Home Rd, Testville, MO 63000';
const dir = dest => 'https://www.google.com/maps/dir/?api=1&travelmode=driving&origin=' + encodeURIComponent(FAKE_HOME) + '&destination=' + encodeURIComponent(dest);
const HOME_LOC = 'Jennings Senior High School, 8850 Cozens Ave, Jennings, MO 63136';
const AWAY_LOC = 'Marquette High School, 2351 Clarkson Rd, Chesterfield, MO 63017';
const NEU_LOC = 'Alton High School, 4200 Humbert Rd, Alton, IL 62002';
const notes = (miles, drive, loc, extra = '') => `Jennings High School boys varsity basketball 2026-27${extra}\nJV 4:30 PM, varsity 6:00 PM\nDrive from home: ${miles} mi, about ${drive}\nDirections from home: ${dir(loc)}\n(Driving distance/time: OpenStreetMap routing (Valhalla), approximate.)\nSchedule: Jennings Warriors boys basketball 2026-27 schedule poster`;
(async () => {
  const b = await chromium.launch({ executablePath: '/usr/bin/google-chrome', headless: true, args: ['--no-sandbox'] });
  const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, timezoneId: 'America/Chicago', locale: 'en-US', isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
  const p = await ctx.newPage(); const errs = []; p.on('pageerror', e => errs.push(e.message));
  await p.clock.install({ time: new Date('2026-11-16T15:00:00Z') }); // Mon Nov 16, 9:00 AM CT
  await p.goto(BASE); await p.waitForFunction(() => window.__app && window.__app.Store);
  await p.evaluate(() => { localStorage.clear(); sessionStorage.clear(); }); await p.goto(BASE); await p.waitForFunction(() => window.__app && window.__app.Store && window.SandyNav && window.SandyGames);
  await p.evaluate(CONTRAST);
  // ---- unit: SandyGames.info team + "from home" parsing
  const u = await p.evaluate(([n1, n2]) => {
    const G = window.SandyGames;
    return {
      away: G.info({ title: 'Jennings @ Marquette - AWAY', category: 'Game – Jennings High School', location: 'Marquette High School', notes: n1 }),
      home: G.info({ title: 'Jennings vs Kirkwood - HOME', category: 'Game – Jennings High School', location: 'Jennings Senior High School', notes: n2 }),
      tourney: G.info({ title: 'BSN Alton Shootout: Jennings vs Collinsville - NEUTRAL', category: 'Other', location: 'Alton High School', notes: 'Drive from home: 55 mi, about 1 hr 8 min' }),
      ramey: G.info({ title: 'Ramey Christmas Tournament - NEUTRAL', category: 'Game – Jennings High School', location: 'Cardinal Ritter College Prep', notes: '' }),
      practice: G.info({ title: 'Jennings High School basketball practice', category: 'Team practice – Jennings High School', location: '', notes: '' }),
      hs: G.info({ title: 'HSSU @ Lincoln University of Missouri - AWAY', category: 'Game – Harris-Stowe State University', location: 'X', notes: 'Drive from home: 99 mi' }),
      mv: G.info({ title: 'Maryville University @ Union University (Tenn.) - AWAY', category: 'Game – Maryville University', location: 'X Gym', notes: 'Drive from Maryville University: 268 mi, about 4 hr 14 min' }),
      legacy: G.info({ title: 'Somebody vs Other - HOME', category: 'Game', location: '' }),
      code: [G.ORIGIN, ...G.TEAMS.map(t => t.origin)].join('|'),
    };
  }, [notes(25, '32 min', AWAY_LOC, ' · Conference game'), notes(40, '51 min', HOME_LOC, ' · Conference game')]);
  assert(u.away.team === 'jennings' && u.away.ha === 'A' && u.away.miles === 25 && u.away.drive === '32 min' && u.away.from === 'home', 'info: Jennings away game, 25 mi from home');
  assert(u.away.url === dir(AWAY_LOC) && u.away.dirFrom === 'home', 'info: directions URL comes from the notes ("Directions from home")');
  assert(u.home.team === 'jennings' && u.home.ha === 'H' && u.home.travel && u.home.miles === 40 && u.home.url === dir(HOME_LOC), 'info: Jennings home game also shows venue + drive from home');
  assert(u.tourney.team === 'jennings' && u.tourney.ha === 'N' && u.tourney.miles === 55, 'info: tournament title "BSN Alton Shootout: Jennings vs …" -> Jennings, neutral');
  assert(u.ramey.team === 'jennings' && u.ramey.ha === 'N', 'info: tournament without "Jennings" in the title -> team from the category');
  assert(!u.practice, 'info: Jennings practice is not a game');
  assert(u.hs.team === 'hssu' && u.mv.team === 'maryville' && u.legacy.team === 'maryville', 'info: HSSU / Maryville / unnamed games unchanged');
  assert(u.code === 'Maryville University, 650 Maryville University Dr, St. Louis, MO 63141|||Maryville University, 650 Maryville University Dr, St. Louis, MO 63141', 'app code carries no personal home address (Jennings has no baked-in origin)');
  // ---- seed the week of Nov 15-21: Jennings home (Thu), away (Fri), neutral (Sat), Maryville away (Sat), HSSU home (Wed), a practice
  await p.evaluate(async ({ HOME_LOC, AWAY_LOC, NEU_LOC, nH, nA, nN }) => {
    const S = window.__app.Store; await S.removeWhere(() => true);
    const ev = o => ({ id: crypto.randomUUID(), kind: 'event', allDay: false, recurrence: { freq: 'none' }, location: '', notes: '', calendar: 'mam', ...o });
    const cat = 'Game – Jennings High School';
    await S.save(ev({ title: 'Jennings vs Kirkwood - HOME', category: cat, start: '2026-11-19T18:00', end: '2026-11-19T19:30', location: HOME_LOC, notes: nH }));
    await S.save(ev({ title: 'Jennings @ Marquette - AWAY', category: cat, start: '2026-11-20T19:00', end: '2026-11-20T20:30', location: AWAY_LOC, notes: nA }));
    await S.save(ev({ title: 'BSN Alton Shootout: Jennings vs Collinsville - NEUTRAL', category: cat, start: '2026-11-21T13:00', end: '2026-11-21T14:30', location: NEU_LOC, notes: nN }));
    await S.save(ev({ title: 'Maryville University @ Union University (Tenn.) - AWAY', category: 'Game – Maryville University', start: '2026-11-21T16:00', end: '2026-11-21T18:00', location: 'Fred DeLay Gymnasium (Union University), 1050 Union University Dr, Jackson, TN 38305', notes: "Maryville University men's basketball 2026-27\nDrive from Maryville University: 268 mi, about 4 hr 14 min" }));
    await S.save(ev({ title: 'HSSU vs Principia College - HOME', category: 'Game – Harris-Stowe State University', start: '2026-11-18T19:00', end: '2026-11-18T21:00', location: 'Emerson Performance Center (Harris-Stowe State University), 3026 Laclede Ave, St. Louis, MO 63103', notes: "Harris-Stowe State University men's basketball 2026-27\nDrive from home: 41 mi, about 46 min" }));
    await S.save(ev({ title: 'Jennings High School basketball practice', category: 'Team practice – Jennings High School', start: '2026-11-19T13:00', end: '2026-11-19T15:00' }));
    window.__app.refresh();
  }, { HOME_LOC, AWAY_LOC, NEU_LOC, nH: notes(40, '51 min', HOME_LOC, ' · Conference game'), nA: notes(25, '32 min', AWAY_LOC, ' · Conference game'), nN: notes(55, '1 hr 8 min', NEU_LOC, ' · BSN Alton Shootout') });
  await p.waitForTimeout(500);
  const view = async (v, d) => { await p.click('#bottomNav [data-tab=home]'); await p.waitForTimeout(300); await p.evaluate(([v, d]) => window.__app.calendar.changeView(v, d), [v, d]); await p.waitForTimeout(700); };
  const rect = h => h.evaluate(e => { const r = e.getBoundingClientRect(); return { left: r.left, right: r.right, top: r.top, bottom: r.bottom, w: r.width, h: r.height }; });
  const inside = (o, i, pad = 1) => i.left >= o.left - pad && i.right <= o.right + pad && i.top >= o.top - pad && i.bottom <= o.bottom + pad;
  const rgb = c => (c.match(/[\d.]+/g) || []).map(Number);
  const yellow = c => { const [r, g, bl] = rgb(c); return r > 190 && g > 130 && bl < 60 && r - bl > 150; };
  const red = c => { const [r, g, bl] = rgb(c); return r > 200 && g < 75 && bl < 120; };
  // orange: red-dominant, clearly more green than Maryville red, much less than HSSU yellow
  const orange = c => { const [r, g, bl] = rgb(c); return r > 180 && g >= 60 && g < 170 && g - bl >= 40 && r - g >= 70; };
  const badgeStyle = h => h.evaluate(e => { const cs = getComputedStyle(e); return { t: e.textContent, color: cs.color, bg: cs.backgroundColor, bc: cs.borderTopColor, fs: parseFloat(cs.fontSize), fw: +cs.fontWeight, label: e.getAttribute('aria-label'), con: window.__contrast(cs.color, cs.backgroundColor), bcon: window.__contrast(cs.borderTopColor, cs.backgroundColor) }; });
  // orange letter + orange border (not an orange fill), letter >= 3:1 on its tile, border >= 3:1 on the tile
  const oBadge = b => orange(b.color) && orange(b.bc) && !orange(b.bg) && b.con >= 3 && b.bcon >= 3;
  for (const dark of [false, true]) {
    const tag = dark ? 'dark' : 'light';
    await p.evaluate(d => window.SandyNav.setDark(d), dark); await p.waitForTimeout(200);
    // ================= List =================
    await view('listWeek', '2026-11-19');
    const rows = await p.$$('#calendar .fc-list-event.sandy-game.game-team-jennings');
    assert(rows.length === 3, `${tag} List: 3 Jennings game rows`);
    const mvRow = await p.$('#calendar .fc-list-event.sandy-game.game-team-maryville');
    const mvc = await mvRow.evaluate(e => ({ bc: getComputedStyle(e, '::after').borderTopColor, badge: getComputedStyle(e.querySelector('.game-ha')).color }));
    assert(red(mvc.bc) && red(mvc.badge) && !orange(mvc.bc) && !orange(mvc.badge), `${tag} List: Maryville game still red, not orange (${mvc.bc})`);
    const hsRow = await p.$('#calendar .fc-list-event.sandy-game.game-team-hssu');
    const hsc = await hsRow.evaluate(e => ({ bc: getComputedStyle(e, '::after').borderTopColor, badge: getComputedStyle(e.querySelector('.game-ha')).color }));
    assert(yellow(hsc.bc) && yellow(hsc.badge) && !orange(hsc.bc) && !orange(hsc.badge), `${tag} List: HSSU game still yellow, not orange (${hsc.bc} / ${hsc.badge})`);
    assert((await p.$$('#calendar .fc-list-event:not(.sandy-game) .game-ha')).length === 0, `${tag} List: practice untouched`);
    for (const row of rows) {
      const g = await row.evaluate(e => { const a = getComputedStyle(e, '::after'); return { title: e.querySelector('.fc-list-event-title a').textContent, bc: a.borderTopColor, bw: parseFloat(a.borderTopWidth), sh: a.boxShadow }; });
      assert(orange(g.bc) && g.bw >= 2 && /rgba?\(/.test(g.sh) && orange((g.sh.match(/rgba?\([^)]*\)/) || [''])[0]), `${tag} List: ORANGE glowing border on "${g.title}" (${g.bc})`);
      assert(/^(BSN Alton Shootout: )?Jennings (vs|@) .+ - (HOME|AWAY|NEUTRAL)$/.test(g.title), `${tag} List: title format "${g.title}"`);
      const bs = await badgeStyle(await row.$('.game-ha'));
      const want = { HOME: 'H', AWAY: 'A', NEUTRAL: 'N' }[g.title.match(/(HOME|AWAY|NEUTRAL)$/)[1]];
      assert(bs.t === want && oBadge(bs) && bs.fs >= 16 && bs.fw >= 800, `${tag} List: big "${bs.t}" badge, ORANGE letter + ORANGE border (${bs.color} / ${bs.bc} on ${bs.bg}, letter ${bs.con.toFixed(2)}:1) — ${bs.label}`);
      const rr = await rect(row);
      for (const h of await row.$$('.game-ha, .fc-list-event-title a, .game-meta')) assert(inside(rr, await rect(h)), `${tag} List: ${await h.evaluate(e => e.className || e.tagName)} inside the row`);
      const m = await row.evaluate(e => { const a = e.querySelector('.game-loc'), d = e.querySelector('.game-dist'), bg = getComputedStyle(e.querySelector('td')).backgroundColor;
        return { href: a && a.href, text: a && a.textContent, aria: a && a.getAttribute('aria-label'), dist: d && d.textContent, ca: a && window.__contrast(getComputedStyle(a).color, bg), cd: d && window.__contrast(getComputedStyle(d).color, bg) }; });
      assert(m.href && m.href.startsWith('https://www.google.com/maps/dir/?api=1') && m.href.includes('origin=1%20Test%20Home%20Rd') && /directions from home/.test(m.aria), `${tag} List: venue links to Google Maps directions FROM HOME (${want})`);
      assert(/\d+ mi · ~.+ from home$/.test(m.dist.trim()), `${tag} List: drive line "${m.dist.trim()}"`);
      assert(m.ca >= 4.5 && m.cd >= 4.5, `${tag} List: venue/distance readable (${m.ca.toFixed(2)}, ${m.cd.toFixed(2)})`);
    }
    // tap the HOME game's venue -> Maps opens, editor stays closed
    const [pop] = await Promise.all([ctx.waitForEvent('page', { timeout: 4000 }), rows[0].$eval('.game-loc', a => a.click())]);
    await pop.waitForURL(/maps|google/, { timeout: 4000 }).catch(() => {}); const popUrl = pop.url(); await pop.close();
    const edOpen = await p.evaluate(() => [...document.querySelectorAll('dialog')].some(d => d.open));
    assert(/google\.com\/maps\/dir/.test(popUrl) && !edOpen, `${tag} List: tapping the home-game venue opens Maps directions, editor stays closed`);
    await p.evaluate(() => { const d = document.querySelector('#calendar .fc-list-day[data-date="2026-11-19"]') || document.querySelector('#calendar .sandy-game'); d.scrollIntoView({ block: 'start' }); window.scrollBy(0, -150); }); await p.waitForTimeout(200);
    await p.screenshot({ path: `${SHOTS}/list_${tag}.png` });
    { // badge close-up: Jennings H / A / N next to Maryville's red A and HSSU's yellow H
      const hb = await rows[0].$('.game-ha'); const r0 = await rect(hb); await p.screenshot({ path: `${SHOTS}/badge_closeup_${tag}.png`, clip: { x: 0, y: Math.max(0, r0.top - 20), width: 390, height: 70 } });
      const bx = await p.$$eval('#calendar .fc-list-event.sandy-game .game-ha', bs => { const r = bs.map(b => b.getBoundingClientRect()); return { top: Math.min(...r.map(x => x.top)), bottom: Math.max(...r.map(x => x.bottom)) }; });
      await p.screenshot({ path: `${SHOTS}/badges_all_${tag}.png`, clip: { x: 0, y: Math.max(0, bx.top - 30), width: 390, height: Math.min(780, bx.bottom - bx.top + 60) } }); }
    // ================= Day (home game, Thu) =================
    await view('timeGridDay', '2026-11-19');
    const ev = await p.$('#calendar .fc-timegrid-event.sandy-game.game-team-jennings');
    assert(!!ev, `${tag} Day: Jennings home game marked`);
    await ev.evaluate(e => e.scrollIntoView({ block: 'center' })); await p.waitForTimeout(200);
    const ds = await ev.evaluate(e => { const cs = getComputedStyle(e); return { bc: cs.borderTopColor, bw: parseFloat(cs.borderTopWidth), sh: cs.boxShadow }; });
    assert(orange(ds.bc) && ds.bw >= 2 && ds.sh !== 'none' && orange((ds.sh.match(/rgba?\([^)]*\)/) || [''])[0]), `${tag} Day: orange glowing border (${ds.bc})`);
    const db = await badgeStyle(await ev.$('.game-ha'));
    assert(db.t === 'H' && oBadge(db) && db.fs >= 16 && db.fw >= 800, `${tag} Day: big "H" badge, orange letter + border (letter ${db.con.toFixed(2)}:1)`);
    const er = await rect(ev);
    for (const s of ['.game-ha', '.fc-event-title', '.game-loc', '.game-dist']) { const h = await ev.$(s); assert(h && inside(er, await rect(h)), `${tag} Day: ${s} visible inside the block`); }
    const dd = await ev.$eval('.game-dist', d => d.textContent);
    assert(/40 mi · ~51 min from home/.test(dd), `${tag} Day: home game shows the drive from home ("${dd.trim()}")`);
    const prac = await p.$('#calendar .fc-timegrid-event:not(.sandy-game)');
    assert(prac && !(await prac.$('.game-ha')), `${tag} Day: practice untouched`);
    await p.screenshot({ path: `${SHOTS}/day_${tag}.png`, clip: { x: 0, y: Math.max(0, er.top - 150), width: 390, height: 420 } });
    // ================= Week =================
    await view('timeGridWeek', '2026-11-19');
    const wk = await p.$$('#calendar .fc-timegrid-event.sandy-game');
    assert(wk.length === 5, `${tag} Week: 5 games marked (3 Jennings + 1 Maryville + 1 HSSU)`);
    let ny = 0, nr = 0, nh = 0;
    for (const w of wk) {
      await w.evaluate(e => e.scrollIntoView({ block: 'center' })); await p.waitForTimeout(80);
      const ws = await w.evaluate(e => { const b = getComputedStyle(e.querySelector('.game-ha')); return { hs: e.classList.contains('game-team-jennings'), y: e.classList.contains('game-team-hssu'), bc: getComputedStyle(e).borderTopColor, t: e.querySelector('.game-ha')?.textContent, bg: b.backgroundColor, fg: b.color, bbc: b.borderTopColor, con: window.__contrast(b.color, b.backgroundColor) }; });
      const wr = await rect(w), br = await rect(await w.$('.game-ha'));
      if (ws.hs) { ny++; assert(orange(ws.bc) && orange(ws.fg) && orange(ws.bbc) && !orange(ws.bg) && ws.con >= 3 && /^[HAN]$/.test(ws.t) && inside(wr, br), `${tag} Week: orange border + orange-letter "${ws.t}" badge inside the block (${ws.con.toFixed(2)}:1)`); }
      else if (ws.y) { nh++; assert(yellow(ws.bc) && !orange(ws.bc), `${tag} Week: HSSU block stays yellow`); }
      else { nr++; assert(red(ws.bc) && !orange(ws.bc), `${tag} Week: Maryville block stays red`); }
    }
    assert(ny === 3 && nr === 1 && nh === 1, `${tag} Week: 3 orange + 1 red + 1 yellow`);
    await wk[0].evaluate(e => e.scrollIntoView({ block: 'center' })); await p.waitForTimeout(200);
    await p.screenshot({ path: `${SHOTS}/week_${tag}.png` });
    // ================= Editor =================
    await view('listWeek', '2026-11-19');
    await p.click('#calendar .fc-list-event.game-team-jennings.game-H .fc-list-event-title a'); await p.waitForTimeout(500);
    const ed = await p.evaluate(() => { const g = document.getElementById('gameDir'); const a = g.querySelector('a'); return { vis: !g.hidden && g.getBoundingClientRect().height > 0, href: a && a.href, text: g.textContent }; });
    assert(ed.vis && ed.href.includes('origin=1%20Test%20Home%20Rd') && /Directions from home/.test(ed.text) && /40 mi/.test(ed.text), `${tag} Editor: "Directions from home" + distance under Location (home game)`);
    if (!dark) await p.screenshot({ path: `${SHOTS}/editor_${tag}.png` });
    await p.keyboard.press('Escape'); await p.waitForTimeout(500);
  }
  assert(errs.length === 0, 'no page errors' + (errs.length ? ': ' + errs.join(' | ') : ''));

  // ================= Travel plan on Today (Jennings away + neutral) =================
  const HOMEC = [38.60, -90.80], LINC = [38.57, -92.17], ELSAH = [38.95, -90.36];
  const near = (a, c) => Math.abs(a - c) < 2e-3;
  async function openTravel(dark) {
    const c2 = await b.newContext({ viewport: { width: 390, height: 844 }, timezoneId: 'America/Chicago', locale: 'en-US', isMobile: true, hasTouch: true, deviceScaleFactor: 2, reducedMotion: 'reduce', colorScheme: dark ? 'dark' : 'light' });
    const calls = { route: 0 };
    await c2.route('https://photon.komoot.io/**', r => { const q = (new URL(r.request().url()).searchParams.get('q') || '').toLowerCase();
      const c = q.includes('test home') ? HOMEC : q.includes('marquette') ? LINC : q.includes('alton') ? ELSAH : null;
      r.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify({ features: c ? [{ geometry: { coordinates: [c[1], c[0]] }, properties: {} }] : [] }) }); });
    await c2.route('https://nominatim.openstreetmap.org/**', r => r.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: '[]' }));
    await c2.route('https://valhalla1.openstreetmap.de/**', r => { calls.route++; const j = JSON.parse(new URL(r.request().url()).searchParams.get('json')); const [o, d] = j.locations;
      const mins = near(d.lat, LINC[0]) ? 100 : 70; assert(near(o.lat, HOMEC[0]) && near(o.lon, HOMEC[1]), 'travel: route starts at Profile home (fake)');
      r.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify({ trip: { summary: { time: mins * 60, length: mins * 0.95 } } }) }); });
    await c2.route('https://router.project-osrm.org/**', r => r.fulfill({ status: 500, body: 'x' }));
    await c2.route('https://api.open-meteo.com/**', r => { const date = new URL(r.request().url()).searchParams.get('start_date'); const time = Array.from({ length: 24 }, (_, h) => `${date}T${String(h).padStart(2, '0')}:00`);
      r.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify({ hourly: { time, temperature_2m: time.map((_, h) => 30 + h), precipitation_probability: time.map(() => 10), weather_code: time.map(() => 1), wind_speed_10m: time.map(() => 5) } }) }); });
    const tp = await c2.newPage(); const te = []; tp.on('pageerror', e => te.push(e.message));
    await tp.clock.install({ time: new Date('2026-11-19T15:00:00Z') }); // Thu Nov 19, 9 AM CT
    await tp.goto(BASE); await tp.waitForFunction(() => window.__app && window.__app.Store && window.SandyTravel && window.SandyLeave);
    await tp.evaluate(() => { localStorage.clear(); sessionStorage.clear(); }); await tp.goto(BASE); await tp.waitForFunction(() => window.__app && window.__app.Store && window.SandyTravel && window.SandyLeave);
    await tp.evaluate(CONTRAST);
    return { c2, tp, te, calls };
  }
  const seedTrip = (tp, home) => tp.evaluate(async ([AWAY_LOC, NEU_LOC, HOME_LOC, nA, nN, nH, home]) => {
    const S = window.__app.Store; await S.removeWhere(() => true);
    const ev = o => ({ id: crypto.randomUUID(), kind: 'event', allDay: false, recurrence: { freq: 'none' }, calendar: 'mam', category: 'Game – Jennings High School', ...o });
    await S.save(ev({ title: 'Jennings vs Kirkwood - HOME', start: '2026-11-19T19:00', end: '2026-11-19T21:00', location: HOME_LOC, notes: nH }));
    await S.save(ev({ title: 'Jennings @ Marquette - AWAY', start: '2026-11-20T19:00', end: '2026-11-20T21:00', location: AWAY_LOC, notes: nA }));
    await S.save(ev({ title: 'BSN Alton Shootout: Jennings vs Collinsville - NEUTRAL', start: '2026-11-21T13:00', end: '2026-11-21T15:00', location: NEU_LOC, notes: nN }));
    await S.save(ev({ title: 'Ramey Christmas Tournament - NEUTRAL', allDay: true, start: '2026-11-20', end: '2026-11-21', location: 'Cardinal Ritter College Prep, 701 N Spring Ave, St. Louis, MO 63108', notes: 'Time TBA' }));
    await S.save(ev({ title: 'Riverside HS @ Rival High - AWAY', category: 'Game – Riverside High School', start: '2026-11-20T17:00', end: '2026-11-20T19:00', location: AWAY_LOC }));
    await window.SandyLeave.setHome(home ? '1 Test Home Rd, Testville, MO 63000' : '');
    window.__app.refresh();
  }, [AWAY_LOC, NEU_LOC, HOME_LOC, notes(99, '1 hr 44 min', AWAY_LOC), notes(64, '1 hr 15 min', NEU_LOC), notes(40, '51 min', HOME_LOC), home]);
  const todayCards = async tp => { await tp.evaluate(() => window.SandyNav.go('today')); await tp.evaluate(() => window.SandyNav.renderToday());
    await tp.waitForFunction(() => document.querySelector('.tc-travel') && [...document.querySelectorAll('.tc-travel')].every(s => !s.querySelector('[data-state=pending]')), null, { timeout: 8000 }).catch(() => {}); await tp.waitForTimeout(300);
    return tp.$$eval('.tc-travel', cs => cs.map(c => { const tx = e => e ? e.innerText.replace(/\s+/g, ' ').trim() : ''; const lv = c.querySelector('.tv-leave'); const cs2 = getComputedStyle(c); const tm = c.querySelector('.tv-team');
      return { cls: c.className, head: tx(c.querySelector('h3')), game: tx(c.querySelector('.tv-game')), leave: tx(lv), leaveAt: lv ? lv.dataset.leave || '' : '', backAt: lv ? lv.dataset.back || '' : '', note: tx(c.querySelector('.tv-note')), wx: tx(c.querySelector('.tv-wx')),
        dir: (c.querySelector('.tv-dir a') || {}).href || '', dirText: tx(c.querySelector('.tv-dir')), accent: cs2.borderLeftColor, teamFg: tm && getComputedStyle(tm).color, teamCon: tm && window.__contrast(getComputedStyle(tm).color, getComputedStyle(tm).backgroundColor) }; })); };
  for (const dark of [false, true]) {
    const tag = dark ? 'dark' : 'light';
    const T = await openTravel(dark); await T.tp.evaluate(d => window.SandyNav.setDark(d), dark); await seedTrip(T.tp, true);
    const c = await todayCards(T.tp);
    assert(c.length === 2 && /Marquette/.test(c[0].game) && /Collinsville/.test(c[1].game) && /Jennings · Away/.test(c[0].head) && /Jennings · Neutral site/.test(c[1].head), `${tag} travel: Jennings away (Fri) + neutral (Sat) cards; no card for the Jennings home game, the all-day TBA tournament or an unnamed team (${c.map(x => x.head).join(' / ')})`);
    assert(c[0].leaveAt === '4:20 PM' && /from home/.test(c[0].leave) && /1 hr 40 min drive/.test(c[0].leave) && /there 60 min before tip-off/.test(c[0].leave), `${tag} travel: away leave = 7:00 PM - 100 min drive - 60 min = 4:20 PM from home (${c[0].leave})`);
    assert(c[0].backAt === '11:10 PM', `${tag} travel: away back about 11:10 PM (9:00 + 30 + 100, rounded up) (${c[0].backAt})`);
    assert(c[1].leaveAt === '10:50 AM' && c[1].backAt === '4:40 PM', `${tag} travel: neutral leave 10:50 AM, back 4:40 PM (${c[1].leaveAt} / ${c[1].backAt})`);
    assert(/°F/.test(c[0].wx) && /at tip-off/.test(c[0].wx), `${tag} travel: weather at tip-off (${c[0].wx})`);
    assert(c[0].dir.includes('origin=1%20Test%20Home%20Rd') && /Directions from home/.test(c[0].dirText), `${tag} travel: "Directions from home" link from the event notes`);
    assert(/tv-team-jennings/.test(c[0].cls) && orange(c[0].accent) && orange(c[0].teamFg) && c[0].teamCon >= 3, `${tag} travel: orange accent (${c[0].accent}, Jennings tag ${c[0].teamCon.toFixed(2)}:1)`);
    await T.tp.evaluate(() => { const el = document.querySelector('.tc-travel'); el.scrollIntoView({ block: 'start' }); document.scrollingElement.scrollTop -= 80; }); await T.tp.waitForTimeout(250);
    await T.tp.screenshot({ path: `${SHOTS}/travel_card_${tag}.png` });
    if (!dark) { // no Profile home -> Jennings falls back to the notes' "Drive from home" (never routes from Maryville)
      const r0 = T.calls.route; await seedTrip(T.tp, false); const c3 = await todayCards(T.tp);
      assert(c3.length === 2 && c3[0].leaveAt === '4:15 PM' && /from home/.test(c3[0].leave) && /1 hr 44 min drive, 99 mi/.test(c3[0].leave) && /from home/.test(c3[0].note) && T.calls.route === r0, `${tag} travel: no Profile home -> notes "Drive from home: 99 mi, about 1 hr 44 min" -> leave 4:15 PM, no routing (${c3[0].leave} | ${c3[0].note})`);
    }
    assert(T.te.length === 0, `${tag} travel: no page errors ${T.te.join(' | ')}`);
    await T.c2.close();
  }
  console.log(`\n${n} checks passed`); await b.close();
})().catch(e => { console.error(e); process.exit(1); });
