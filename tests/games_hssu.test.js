// Browser test (Scott 2026-10-25): Harris-Stowe State University (HSSU) game events. Same as the Maryville games
// (games_badges.test.js) but the glowing border and the big H / A / N badge are YELLOW, readable in both themes,
// and every HSSU game (home too) shows the venue + "Drive from home" with Google Maps directions from home
// (the link comes from the event's notes; the home address is never in the app code). Maryville stays red.
// Uses a FAKE home address. Light + dark at 390x844, List / Day / Week.
//   node tests/games_hssu.test.js http://127.0.0.1:8787/ [screenshotDir]
const { chromium } = require(process.env.PW || '/workspace/shot-tools/node_modules/playwright-core');
const BASE = process.argv[2] || 'http://127.0.0.1:8787/'; const SHOTS = process.argv[3] || '/workspace/shots-hssu';
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
const HOME_LOC = 'Emerson Performance Center (Harris-Stowe State University), 3026 Laclede Ave, St. Louis, MO 63103';
const AWAY_LOC = 'Jason Gym (Lincoln University), 820 Chestnut St, Jefferson City, MO 65101';
const NEU_LOC = 'Hay Field House (Principia College), 1 Maybeck Pl, Elsah, IL 62028';
const notes = (miles, drive, loc, extra = '') => `Harris-Stowe State University men's basketball 2026-27${extra}\nDrive from home: ${miles} mi, about ${drive}\nDirections from home: ${dir(loc)}\n(Driving distance/time: OpenStreetMap routing (Valhalla), approximate.)\nSchedule: https://hornetsathletics.com/sports/mens-basketball/schedule/2026-2027`;
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
      away: G.info({ title: 'HSSU @ Lincoln University of Missouri - AWAY', category: 'Game – Harris-Stowe State University', location: 'Jason Gym, Jefferson City', notes: n1 }),
      home: G.info({ title: 'HSSU vs Principia College - HOME', category: 'Game – Harris-Stowe State University', location: 'Emerson Performance Center', notes: n2 }),
      homeNoDrive: G.info({ title: 'HSSU vs Fisk University - HOME', category: 'Game – HSSU', location: 'Emerson Performance Center', notes: '' }),
      byTitle: G.info({ title: 'Harris-Stowe State University vs X - NEUTRAL', category: 'Other', location: 'Somewhere', notes: 'Drive from home: 64 mi' }),
      noLink: G.info({ title: 'HSSU @ Y - AWAY', category: 'Game – HSSU', location: 'Y Gym', notes: 'Drive from home: 10 mi, about 15 min' }),
      mv: G.info({ title: 'Maryville University @ Union University (Tenn.) - AWAY', category: 'Game – Maryville University', location: 'X Gym', notes: 'Drive from Maryville University: 268 mi, about 4 hr 14 min' }),
      mvHome: G.info({ title: 'Maryville University vs Lincoln University - HOME', category: 'Game – Maryville University', location: 'Simon', notes: '' }),
      legacy: G.info({ title: 'Somebody vs Other - HOME', category: 'Game', location: '' }),
      code: [G.ORIGIN, ...G.TEAMS.map(t => t.origin)].join('|'),
    };
  }, [notes(99, '1 hr 44 min', AWAY_LOC), notes(41, '46 min', HOME_LOC)]);
  assert(u.away.team === 'hssu' && u.away.ha === 'A' && u.away.miles === 99 && u.away.drive === '1 hr 44 min' && u.away.from === 'home', 'info: HSSU away game, 99 mi from home');
  assert(u.away.url === dir(AWAY_LOC) && u.away.dirFrom === 'home', 'info: directions URL comes from the notes ("Directions from home")');
  assert(u.home.team === 'hssu' && u.home.ha === 'H' && u.home.travel && u.home.miles === 41 && u.home.url === dir(HOME_LOC), 'info: HSSU home game also shows venue + drive from home');
  assert(u.homeNoDrive.team === 'hssu' && !u.homeNoDrive.travel, 'info: HSSU home game without a drive line shows no venue line ("Game – HSSU" category works too)');
  assert(u.byTitle.team === 'hssu' && u.byTitle.ha === 'N' && u.byTitle.miles === 64, 'info: team from the title, neutral site');
  assert(u.noLink.url === 'https://www.google.com/maps/dir/?api=1&travelmode=driving&destination=Y%20Gym', 'info: no directions line -> Maps directions from current location (no origin baked in)');
  assert(u.mv.team === 'maryville' && /origin=Maryville%20University/.test(u.mv.url) && u.mv.from === 'Maryville University', 'info: Maryville unchanged (directions from Maryville University)');
  assert(u.mvHome.team === 'maryville' && !u.mvHome.travel && u.mvHome.url === '', 'info: Maryville home game unchanged (no venue line)');
  assert(u.legacy.team === 'maryville', 'info: a game with no team name keeps the original (red) look');
  assert(u.code === 'Maryville University, 650 Maryville University Dr, St. Louis, MO 63141||Maryville University, 650 Maryville University Dr, St. Louis, MO 63141', 'app code carries no personal home address (HSSU has no baked-in origin)');
  // ---- seed the week of Nov 15-21: HSSU home (Thu), HSSU away (Fri), HSSU neutral (Sat), a Maryville away game (Sat), a practice
  await p.evaluate(async ({ HOME_LOC, AWAY_LOC, NEU_LOC, nH, nA, nN }) => {
    const S = window.__app.Store; await S.removeWhere(() => true);
    const ev = o => ({ id: crypto.randomUUID(), kind: 'event', allDay: false, recurrence: { freq: 'none' }, location: '', notes: '', calendar: 'mam', ...o });
    const cat = 'Game – Harris-Stowe State University';
    await S.save(ev({ title: 'HSSU vs Principia College - HOME', category: cat, start: '2026-11-19T19:00', end: '2026-11-19T21:00', location: HOME_LOC, notes: nH }));
    await S.save(ev({ title: 'HSSU @ Lincoln University of Missouri - AWAY', category: cat, start: '2026-11-20T19:00', end: '2026-11-20T21:00', location: AWAY_LOC, notes: nA }));
    await S.save(ev({ title: 'HSSU vs University of the Ozarks - NEUTRAL', category: cat, start: '2026-11-21T13:00', end: '2026-11-21T15:00', location: NEU_LOC, notes: nN }));
    await S.save(ev({ title: 'Maryville University @ Union University (Tenn.) - AWAY', category: 'Game – Maryville University', start: '2026-11-21T16:00', end: '2026-11-21T18:00', location: 'Fred DeLay Gymnasium (Union University), 1050 Union University Dr, Jackson, TN 38305', notes: "Maryville University men's basketball 2026-27\nDrive from Maryville University: 268 mi, about 4 hr 14 min" }));
    await S.save(ev({ title: 'Maryville University basketball practice', category: 'Team practice – Maryville University', start: '2026-11-19T13:00', end: '2026-11-19T15:00' }));
    window.__app.refresh();
  }, { HOME_LOC, AWAY_LOC, NEU_LOC, nH: notes(41, '46 min', HOME_LOC), nA: notes(99, '1 hr 44 min', AWAY_LOC, ' · Exhibition'), nN: notes(64, '1 hr 15 min', NEU_LOC) });
  await p.waitForTimeout(500);
  const view = async (v, d) => { await p.click('#bottomNav [data-tab=home]'); await p.waitForTimeout(300); await p.evaluate(([v, d]) => window.__app.calendar.changeView(v, d), [v, d]); await p.waitForTimeout(700); };
  const rect = h => h.evaluate(e => { const r = e.getBoundingClientRect(); return { left: r.left, right: r.right, top: r.top, bottom: r.bottom, w: r.width, h: r.height }; });
  const inside = (o, i, pad = 1) => i.left >= o.left - pad && i.right <= o.right + pad && i.top >= o.top - pad && i.bottom <= o.bottom + pad;
  const rgb = c => (c.match(/[\d.]+/g) || []).map(Number);
  const yellow = c => { const [r, g, bl] = rgb(c); return r > 190 && g > 130 && bl < 60 && r - bl > 150; };
  const red = c => { const [r, g, bl] = rgb(c); return r > 200 && g < 120 && bl < 120; };
  const badgeStyle = h => h.evaluate(e => { const cs = getComputedStyle(e); return { t: e.textContent, color: cs.color, bg: cs.backgroundColor, bc: cs.borderTopColor, fs: parseFloat(cs.fontSize), fw: +cs.fontWeight, label: e.getAttribute('aria-label'), con: window.__contrast(cs.color, cs.backgroundColor) }; });
  for (const dark of [false, true]) {
    const tag = dark ? 'dark' : 'light';
    await p.evaluate(d => window.SandyNav.setDark(d), dark); await p.waitForTimeout(200);
    // ================= List =================
    await view('listWeek', '2026-11-19');
    const rows = await p.$$('#calendar .fc-list-event.sandy-game.game-team-hssu');
    assert(rows.length === 3, `${tag} List: 3 HSSU game rows`);
    const mvRow = await p.$('#calendar .fc-list-event.sandy-game.game-team-maryville');
    const mvc = await mvRow.evaluate(e => ({ bc: getComputedStyle(e, '::after').borderTopColor, badge: getComputedStyle(e.querySelector('.game-ha')).color }));
    assert(red(mvc.bc) && red(mvc.badge), `${tag} List: Maryville game still red (${mvc.bc})`);
    assert((await p.$$('#calendar .fc-list-event:not(.sandy-game) .game-ha')).length === 0, `${tag} List: practice untouched`);
    for (const row of rows) {
      const g = await row.evaluate(e => { const a = getComputedStyle(e, '::after'); return { title: e.querySelector('.fc-list-event-title a').textContent, bc: a.borderTopColor, bw: parseFloat(a.borderTopWidth), sh: a.boxShadow }; });
      assert(yellow(g.bc) && g.bw >= 2 && /rgba?\(/.test(g.sh) && yellow((g.sh.match(/rgba?\([^)]*\)/) || [''])[0]), `${tag} List: YELLOW glowing border on "${g.title}" (${g.bc})`);
      assert(/^HSSU (vs|@) .+ - (HOME|AWAY|NEUTRAL)$/.test(g.title), `${tag} List: title format "${g.title}"`);
      const bs = await badgeStyle(await row.$('.game-ha'));
      const want = { HOME: 'H', AWAY: 'A', NEUTRAL: 'N' }[g.title.match(/(HOME|AWAY|NEUTRAL)$/)[1]];
      assert(bs.t === want && yellow(bs.bg) && bs.fs >= 16 && bs.fw >= 800 && bs.con >= 7, `${tag} List: big yellow "${bs.t}" badge, dark letter (${bs.color} on ${bs.bg}, contrast ${bs.con.toFixed(2)}) — ${bs.label}`);
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
    // ================= Day (home game, Thu) =================
    await view('timeGridDay', '2026-11-19');
    const ev = await p.$('#calendar .fc-timegrid-event.sandy-game.game-team-hssu');
    assert(!!ev, `${tag} Day: HSSU home game marked`);
    await ev.evaluate(e => e.scrollIntoView({ block: 'center' })); await p.waitForTimeout(200);
    const ds = await ev.evaluate(e => { const cs = getComputedStyle(e); return { bc: cs.borderTopColor, bw: parseFloat(cs.borderTopWidth), sh: cs.boxShadow }; });
    assert(yellow(ds.bc) && ds.bw >= 2 && ds.sh !== 'none', `${tag} Day: yellow glowing border (${ds.bc})`);
    const db = await badgeStyle(await ev.$('.game-ha'));
    assert(db.t === 'H' && yellow(db.bg) && db.con >= 7 && db.fs >= 16 && db.fw >= 800, `${tag} Day: big yellow "H" badge (contrast ${db.con.toFixed(2)})`);
    const er = await rect(ev);
    for (const s of ['.game-ha', '.fc-event-title', '.game-loc', '.game-dist']) { const h = await ev.$(s); assert(h && inside(er, await rect(h)), `${tag} Day: ${s} visible inside the block`); }
    const dd = await ev.$eval('.game-dist', d => d.textContent);
    assert(/41 mi · ~46 min from home/.test(dd), `${tag} Day: home game shows the drive from home ("${dd.trim()}")`);
    const prac = await p.$('#calendar .fc-timegrid-event:not(.sandy-game)');
    assert(prac && !(await prac.$('.game-ha')), `${tag} Day: practice untouched`);
    await p.screenshot({ path: `${SHOTS}/day_${tag}.png`, clip: { x: 0, y: Math.max(0, er.top - 150), width: 390, height: 420 } });
    // ================= Week =================
    await view('timeGridWeek', '2026-11-19');
    const wk = await p.$$('#calendar .fc-timegrid-event.sandy-game');
    assert(wk.length === 4, `${tag} Week: 4 games marked (3 HSSU + 1 Maryville)`);
    let ny = 0, nr = 0;
    for (const w of wk) {
      await w.evaluate(e => e.scrollIntoView({ block: 'center' })); await p.waitForTimeout(80);
      const ws = await w.evaluate(e => ({ hs: e.classList.contains('game-team-hssu'), bc: getComputedStyle(e).borderTopColor, t: e.querySelector('.game-ha')?.textContent, bg: getComputedStyle(e.querySelector('.game-ha')).backgroundColor }));
      const wr = await rect(w), br = await rect(await w.$('.game-ha'));
      if (ws.hs) { ny++; assert(yellow(ws.bc) && yellow(ws.bg) && /^[HAN]$/.test(ws.t) && inside(wr, br), `${tag} Week: yellow border + yellow "${ws.t}" badge inside the block`); }
      else { nr++; assert(red(ws.bc), `${tag} Week: Maryville block stays red`); }
    }
    assert(ny === 3 && nr === 1, `${tag} Week: 3 yellow + 1 red`);
    await wk[0].evaluate(e => e.scrollIntoView({ block: 'center' })); await p.waitForTimeout(200);
    await p.screenshot({ path: `${SHOTS}/week_${tag}.png` });
    // ================= Editor =================
    await view('listWeek', '2026-11-19');
    await p.click('#calendar .fc-list-event.game-team-hssu.game-H .fc-list-event-title a'); await p.waitForTimeout(500);
    const ed = await p.evaluate(() => { const g = document.getElementById('gameDir'); const a = g.querySelector('a'); return { vis: !g.hidden && g.getBoundingClientRect().height > 0, href: a && a.href, text: g.textContent }; });
    assert(ed.vis && ed.href.includes('origin=1%20Test%20Home%20Rd') && /Directions from home/.test(ed.text) && /41 mi/.test(ed.text), `${tag} Editor: "Directions from home" + distance under Location (home game)`);
    if (!dark) await p.screenshot({ path: `${SHOTS}/editor_${tag}.png` });
    await p.keyboard.press('Escape'); await p.waitForTimeout(500);
  }
  assert(errs.length === 0, 'no page errors' + (errs.length ? ': ' + errs.join(' | ') : ''));
  console.log(`\n${n} checks passed`); await b.close();
})().catch(e => { console.error(e); process.exit(1); });
