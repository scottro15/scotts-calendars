// Browser test (Scott 2026-10-24 dark2, light mode added 2026-10-25 light1): walk every screen in DARK and LIGHT mode at iPhone size (390x844) and check that
// all visible text meets WCAG AA against its effective background (4.5:1 normal text, 3:1 large text / icon glyphs).
// Covers Home (Today card: Heads Up, On Today, Overdue; briefing), List/Day/Week/Month views (incl. game badges),
// To-Do (quick-add chips, inbox editor, categories), Search (hint, results incl. Today's Notes, empty state, Notes
// Review), Profile, event editor (new / existing with day note + checklist / game), scope dialog, month picker,
// AI panel and toast. Inputs: value text and placeholders. Also checks the List day-box border (both modes).
//   node tests/dark_contrast_audit.test.js http://127.0.0.1:8787/ [screenshotDir]
//   By default runs both themes (dark, then light) and fails if either has text below AA.
//   env: THEME=dark|light -> audit one theme only   SNAP=file.json -> dump measured styles
//        SHOTPREFIX=before_  -> screenshot name prefix     REPORT_ONLY=1 -> print failures but exit 0
if (!process.env.THEME) { // default: both themes, each in its own process
  const { spawnSync } = require('child_process'); let code = 0;
  for (const t of ['dark', 'light']) { const r = spawnSync(process.execPath, process.argv.slice(1), { stdio: 'inherit', env: { ...process.env, THEME: t } }); if (r.status !== 0) code = 1; }
  console.log(code ? 'CONTRAST AUDIT FAILED (see above)' : 'BOTH THEMES PASS'); process.exit(code);
}
const { chromium } = require(process.env.PW || '/workspace/shot-tools/node_modules/playwright-core');
const fs = require('fs');
const BASE = process.argv[2] || 'http://127.0.0.1:8787/'; const SHOTS = process.argv[3] || '/workspace/shots-dark2';
const THEME = process.env.THEME || 'dark'; const DARK = THEME === 'dark'; const PFX = process.env.SHOTPREFIX || '';
const REPORT_ONLY = !!process.env.REPORT_ONLY;
fs.mkdirSync(SHOTS, { recursive: true });
let fails = 0, checked = 0; const failList = []; const snap = {};
const assert = (c, m) => { if (!c) { fails++; console.log('FAIL -', m); } else console.log('ok -', m); };

// In-page auditor: every visible text node / form value / placeholder / pseudo-element text inside `root`.
const AUDITOR = `(() => {
  const cv = document.createElement('canvas'); cv.width = cv.height = 1; const cx = cv.getContext('2d', { willReadFrequently: true });
  // Any CSS colour -> [r,g,b,a]: paint it over black and over white and solve (exact for srgb, color-mix, oklab…).
  const px = (bg, s) => { cx.globalCompositeOperation = 'copy'; cx.fillStyle = bg; cx.fillRect(0, 0, 1, 1); cx.globalCompositeOperation = 'source-over'; cx.fillStyle = bg; cx.fillStyle = s; cx.fillRect(0, 0, 1, 1); return cx.getImageData(0, 0, 1, 1).data; };
  const col = s => { if (!s || s === 'transparent') return [0, 0, 0, 0]; const B = px('#000', s), W = px('#fff', s);
    const a = Math.max(0, Math.min(1, 1 - ((W[0] - B[0]) + (W[1] - B[1]) + (W[2] - B[2])) / 765)); if (a < .004) return [0, 0, 0, 0];
    return [Math.min(255, B[0] / a), Math.min(255, B[1] / a), Math.min(255, B[2] / a), a]; };
  const over = (top, bot) => { const a = top[3]; return [top[0] * a + bot[0] * (1 - a), top[1] * a + bot[1] * (1 - a), top[2] * a + bot[2] * (1 - a), 1]; };
  const lum = c => { const f = v => { v /= 255; return v <= .03928 ? v / 12.92 : Math.pow((v + .055) / 1.055, 2.4); }; return .2126 * f(c[0]) + .7152 * f(c[1]) + .0722 * f(c[2]); };
  const ratio = (a, b) => { const x = lum(a), y = lum(b); return (Math.max(x, y) + .05) / (Math.min(x, y) + .05); };
  const hex = c => '#' + c.slice(0, 3).map(v => Math.round(v).toString(16).padStart(2, '0')).join('');
  const gradColors = img => (img.match(/(rgba?\\([^)]*\\)|color\\([^)]*\\)|oklab\\([^)]*\\)|oklch\\([^)]*\\)|#[0-9a-f]{3,8})/gi) || []).map(col);
  // Effective background(s) behind an element: composite translucent layers up the ancestor chain.
  function bgs(el) {
    const layers = []; let base = null;
    for (let e = el; e; e = e.parentElement) {
      const cs = getComputedStyle(e);
      if (cs.backgroundImage && cs.backgroundImage.includes('gradient')) { const g = gradColors(cs.backgroundImage).filter(c => c[3] > 0); if (g.length && g.every(c => c[3] >= .99)) { base = g; break; } }
      const c = col(cs.backgroundColor); if (c[3] > 0) { layers.push(c); if (c[3] >= .99) { base = [c]; layers.pop(); break; } }
      if (e.tagName === 'DIALOG' && e.open) { const d = col(getComputedStyle(e).backgroundColor); if (d[3] >= .99) { base = [d]; break; } }
    }
    if (!base) base = [col(getComputedStyle(document.documentElement).backgroundColor)].map(c => c[3] ? c : [255, 255, 255, 1]);
    return base.map(b => layers.reduceRight((acc, l) => over(l, acc), [b[0], b[1], b[2], 1]));
  }
  const opac = el => { let o = 1; for (let e = el; e; e = e.parentElement) o *= +getComputedStyle(e).opacity; return o; };
  const visible = el => { if (!el.checkVisibility || !el.checkVisibility({ opacityProperty: true, visibilityProperty: true, contentVisibilityAuto: true })) return false;
    const r = el.getBoundingClientRect(); if (r.width <= 1.5 || r.height <= 1.5) return false;
    for (let e = el; e; e = e.parentElement) { const cs = getComputedStyle(e); if (cs.clip && cs.clip.startsWith('rect(0')) return false; if (e.closest && e.matches('[aria-hidden=true] .sr-only, .sr-only')) return false; }
    return true; };
  const describe = el => { let s = el.tagName.toLowerCase(); if (el.id) s += '#' + el.id; const cl = [...el.classList].slice(0, 3).join('.'); if (cl) s += '.' + cl;
    const p = el.parentElement; if (p && !el.id) { let q = p.tagName.toLowerCase(); if (p.id) q += '#' + p.id; else if (p.classList.length) q += '.' + [...p.classList].slice(0, 2).join('.'); s = q + ' > ' + s; } return s; };
  window.__audit = (rootSel) => {
    const roots = [...document.querySelectorAll(rootSel)]; const out = []; const seen = new Set();
    const check = (el, text, colorStr, kind) => {
      const cs = getComputedStyle(el); const fs = parseFloat(cs.fontSize), fw = +cs.fontWeight || 400;
      const glyph = !/[\\p{L}\\p{N}]/u.test(text);
      const large = fs >= 24 || (fs >= 18.66 && fw >= 700) || glyph;
      const need = large ? 3 : 4.5; const o = opac(el);
      // -webkit-text-fill-color wins over color; transparent fill + background-clip:text = gradient text
      let fgs = [col(colorStr)]; let bgEl = el;
      if (kind === 'text') { const tf = cs.webkitTextFillColor; if (tf && tf !== colorStr) fgs = [col(tf)];
        if (fgs[0][3] === 0 && /text/.test(cs.backgroundClip || cs.webkitBackgroundClip) && cs.backgroundImage.includes('gradient')) { fgs = gradColors(cs.backgroundImage); bgEl = el.parentElement; } }
      if (fgs.every(c => c[3] === 0)) return; // transparent text drawn by an overlay (e.g. quick-add highlighter)
      let worst = 99, wb = null, wf = null;
      for (const b of bgs(bgEl)) for (const fg0 of fgs) { const fg = over([fg0[0], fg0[1], fg0[2], fg0[3] * o], b); const r = ratio(fg, b); if (r < worst) { worst = r; wb = b; wf = fg; } }
      out.push({ sel: describe(el), text: text.trim().replace(/\\s+/g, ' ').slice(0, 40), kind, ratio: +worst.toFixed(2), need, fg: hex(wf), bg: hex(wb), fs, color: colorStr });
    };
    for (const root of roots) {
      const tw = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
      for (let n = tw.nextNode(); n; n = tw.nextNode()) {
        if (!n.nodeValue.trim()) continue; const el = n.parentElement; if (!el || seen.has(el)) continue; seen.add(el);
        if (['SCRIPT', 'STYLE', 'OPTION', 'TITLE', 'NOSCRIPT', 'TEXTAREA'].includes(el.tagName)) continue;
        if (el.closest('[disabled], [inert], .sr-only, svg')) continue;
        if (!visible(el)) continue;
        const rg = document.createRange(); rg.selectNodeContents(n); const rr = rg.getBoundingClientRect(); if (rr.width < 1 || rr.height < 1) continue;
        check(el, n.nodeValue, getComputedStyle(el).color, 'text');
      }
      for (const el of root.querySelectorAll('input, select, textarea')) {
        if (el.disabled || !visible(el) || ['checkbox', 'radio', 'file', 'hidden', 'color', 'range'].includes(el.type)) continue;
        const v = el.tagName === 'SELECT' ? (el.selectedOptions[0] || {}).text || '' : el.value;
        if (v && v.trim()) check(el, v, getComputedStyle(el).color, 'value');
        else if (el.placeholder) check(el, el.placeholder, getComputedStyle(el, '::placeholder').color, 'placeholder');
      }
      for (const el of root.querySelectorAll('*')) for (const ps of ['::before', '::after']) {
        const pcs = getComputedStyle(el, ps); const c = pcs.content; if (!c || c === 'none' || c === 'normal' || c === '""' || pcs.display === 'none') continue;
        const t = c.replace(/^"|"$/g, ''); if (!t.trim() || !/[\\p{L}\\p{N}]/u.test(t) || !visible(el)) continue;
        check(el, t, pcs.color, 'pseudo' + ps);
      }
    }
    return out;
  };
})()`;

(async () => {
  const b = await chromium.launch({ executablePath: '/usr/bin/google-chrome', headless: true, args: ['--no-sandbox'] });
  const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, timezoneId: 'America/Chicago', locale: 'en-US', isMobile: true, hasTouch: true, deviceScaleFactor: 2, reducedMotion: 'reduce' });
  // Leave-by (SI 1): mock free geocoding + routing so Heads Up shows every kind of line without real network calls.
  const geo = new Map(); let holdRoutes = null;
  await ctx.route('https://photon.komoot.io/**', r => { const q = (new URL(r.request().url()).searchParams.get('q') || '').toLowerCase();
    const sp = new URL(r.request().url()).searchParams;
    if (sp.get('limit') && sp.get('limit') !== '1') { // address suggestions (places.js search-as-you-type)
      const mk = (name, street, hn, city, pc) => ({ type: 'Feature', geometry: { type: 'Point', coordinates: [-90.5, 38.6] }, properties: { name, street, housenumber: hn, city, state: 'Missouri', postcode: pc, country: 'United States', countrycode: 'US' } });
      return r.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify({ features: [mk('Maryville University', 'Maryville University Drive', '650', 'Town and Country', '63141'), mk('Simon Athletic Center', 'Maryville University Drive', '650', 'Town and Country', '63141'), mk(undefined, 'Maryville Avenue', '12', 'St. Louis', '63110')] }) });
    }
    let f = []; if (!q.includes('unroutable')) { const h = [...q].reduce((a, c) => (a * 31 + c.charCodeAt(0)) >>> 0, 7); const lat = 38 + (h % 1000) / 2000, lon = -91 + ((h >> 10) % 1000) / 2000; geo.set(lat.toFixed(5) + ',' + lon.toFixed(5), q); f = [{ type: 'Feature', geometry: { type: 'Point', coordinates: [lon, lat] }, properties: {} }]; }
    r.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify({ features: f }) }); });
  await ctx.route('https://valhalla1.openstreetmap.de/**', async r => { if (holdRoutes) await holdRoutes;
    const j = JSON.parse(new URL(r.request().url()).searchParams.get('json')); const to = geo.get(j.locations[1].lat.toFixed(5) + ',' + j.locations[1].lon.toFixed(5)) || '';
    const hdr = { 'access-control-allow-origin': '*' };
    if (to.includes('island')) return r.fulfill({ status: 400, headers: hdr, contentType: 'application/json', body: '{"error_code":442,"error":"No path"}' }).catch(() => {});
    r.fulfill({ status: 200, headers: hdr, contentType: 'application/json', body: JSON.stringify({ trip: { summary: { time: 1920, length: 25 } } }) }).catch(() => {}); });
  // Travel plan weather (SI D): mock Open-Meteo (free, no key)
  await ctx.route('https://api.open-meteo.com/**', r => { const d = new URL(r.request().url()).searchParams.get('start_date'); const time = Array.from({ length: 24 }, (_, h) => `${d}T${String(h).padStart(2, '0')}:00`);
    r.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify({ hourly: { time, temperature_2m: time.map(() => 41), precipitation_probability: time.map(() => 60), weather_code: time.map(() => 63), wind_speed_10m: time.map(() => 20) } }) }); });
  const p = await ctx.newPage(); const errs = []; p.on('pageerror', e => errs.push(e.message));
  await p.clock.install({ time: new Date('2026-11-17T16:00:00Z') }); // Tue Nov 17 2026, 10:00 AM CT
  await p.goto(BASE); await p.waitForFunction(() => window.__app && window.__app.Store);
  await p.evaluate(() => { localStorage.clear(); sessionStorage.clear(); }); await p.goto(BASE);
  await p.waitForFunction(() => window.__app && window.__app.Store && window.SandyNav && window.SandyGames && document.querySelector('#calendar .fc-view'));
  await p.waitForTimeout(600);
  // ---- seed: examples (auto) + games, overdue to-do, conflict, day notes, inbox jots, checklist
  const ids = await p.evaluate(async () => {
    const A = window.__app, S = A.Store, N = window.SandyNav;
    const ev = o => ({ id: crypto.randomUUID(), kind: 'event', allDay: false, recurrence: { freq: 'none' }, location: '', notes: '', calendar: 'mam', ...o });
    const away = ev({ title: 'Maryville University @ Union University (Tenn.) - AWAY', category: 'Game – Maryville University', start: '2026-11-21T16:00', end: '2026-11-21T18:00', location: 'Fred DeLay Gymnasium (Union University), 1050 Union University Dr, Jackson, TN 38305', notes: "Maryville University men's basketball 2026-27\nDrive from Maryville University: 268 mi, about 4 hr 14 min" });
    const home = ev({ title: 'Maryville University vs University of Wisconsin-Parkside - HOME', category: 'Game – Maryville University', start: '2026-11-18T19:00', end: '2026-11-18T21:00', location: 'Simon Athletic Center' });
    const neutral = ev({ title: 'Maryville University vs Malone University - NEUTRAL', category: 'Game – Maryville University', start: '2026-11-17T18:00', end: '2026-11-17T20:00', location: 'Kates Gym', notes: 'Drive from Maryville University: 509 mi' });
    // Harris-Stowe (yellow) games: home + away, with "Drive from home" + a directions link (fake home address)
    const hsDir = d => 'Directions from home: https://www.google.com/maps/dir/?api=1&travelmode=driving&origin=1%20Test%20Home%20Rd%2C%20Testville%2C%20MO%2063000&destination=' + encodeURIComponent(d);
    const hsHome = ev({ title: 'HSSU vs Principia College - HOME', category: 'Game – Harris-Stowe State University', start: '2026-11-19T19:00', end: '2026-11-19T21:00', location: 'Emerson Performance Center (Harris-Stowe State University), 3026 Laclede Ave, St. Louis, MO 63103', notes: "Harris-Stowe State University men's basketball 2026-27\nDrive from home: 41 mi, about 46 min\n" + hsDir('Emerson Performance Center') });
    const hsAway = ev({ title: 'HSSU @ Lincoln University of Missouri - AWAY', category: 'Game – Harris-Stowe State University', start: '2026-11-20T19:00', end: '2026-11-20T21:00', location: 'Jason Gym (Lincoln University), 820 Chestnut St, Jefferson City, MO 65101', notes: "Harris-Stowe State University men's basketball 2026-27 · Exhibition\nDrive from home: 99 mi, about 1 hr 44 min\n" + hsDir('Jason Gym') });
    const cl = ev({ title: 'Film breakdown', calendar: 'msc', category: 'Film study', start: '2026-11-17T11:00', end: '2026-11-17T12:00', notes: 'Watch the press break\n- [ ] Clip transition defense\n- [ ] Note press break spacing' });
    const clash = ev({ title: 'Recruiting call', calendar: 'lifetime', category: 'Meeting', start: '2026-11-17T11:30', end: '2026-11-17T12:15' });
    const overdue = ev({ kind: 'task', scope: 'day', title: 'Send press break film to staff', calendar: 'mam', category: 'Task / to-do', allDay: true, start: '2026-11-13', end: '2026-11-13', done: false, completedDates: [] });
    const gymrun = ev({ title: 'Client session', calendar: 'msc', category: 'Meeting', start: '2026-11-17T10:20', end: '2026-11-17T10:50', location: 'Test Gym A, Testville' });
    const island = ev({ title: 'Island scrimmage', category: 'Practice', start: '2026-11-17T14:00', end: '2026-11-17T15:00', location: 'Island Gym' });
    const b2b = ev({ title: 'Team dinner', category: 'Meeting', start: '2026-11-17T20:30', end: '2026-11-17T21:30', location: 'Test Restaurant B' });
    const lost = ev({ title: 'Mystery meetup', category: 'Meeting', start: '2026-11-17T16:00', end: '2026-11-17T16:30', location: 'Nowhere Unroutable Place' });
    for (const e of [away, home, neutral, hsHome, hsAway, cl, clash, overdue, gymrun, island, b2b, lost]) await S.save(e);
    await S.notes.set(cl.id, '2026-11-17', 'Press break looked sharp. Need more ball reversal and quicker outlet passes.');
    await S.notes.set(home.id, '2026-11-18', 'Press break: trap the corner, rotate early.');
    try { await N.Inbox.save({ id: crypto.randomUUID(), kind: 'todo', body: 'Order press break cones', done: false }); await N.Inbox.save({ id: crypto.randomUUID(), kind: 'note', body: 'Idea: press break drill for Jennings', done: false }); } catch (e) { console.warn(e); }
    A.refresh(); return { away: away.id, cl: cl.id, home: home.id, hsHome: hsHome.id, hsAway: hsAway.id };
  });
  await p.waitForTimeout(500);
  await p.evaluate(AUDITOR);
  await p.evaluate(d => window.SandyNav.setDark(d), DARK); await p.waitForTimeout(300);

  const settle = (ms = 700) => p.waitForTimeout(ms);
  async function audit(name, rootSel, shot) {
    const r = await p.evaluate(s => window.__audit(s), rootSel);
    const bad = r.filter(x => x.ratio < x.need); checked += r.length; snap[name] = r;
    for (const x of bad) failList.push({ screen: name, ...x });
    assert(!bad.length || REPORT_ONLY, `${THEME} ${name}: ${r.length} text items, ${bad.length} below AA` + (bad.length ? '\n    ' + bad.slice(0, 40).map(x => `${x.ratio} < ${x.need}  ${x.sel} "${x.text}" fg ${x.fg} on ${x.bg}`).join('\n    ') : ''));
    if (shot) await p.screenshot({ path: `${SHOTS}/${PFX}${shot}.png` });
    return r;
  }
  const home = async () => { await p.click('#bottomNav [data-tab=home]'); await settle(400); };
  const view = async (v, d = '2026-11-17') => { await home(); await p.evaluate(([v, d]) => window.__app.calendar.changeView(v, d), [v, d]); await settle(); };
  const page = '.topbar, #bottomNav, #page-home';
  const closeDialogs = async () => { await p.evaluate(() => document.querySelectorAll('dialog[open]').forEach(d => d.close())); await settle(500); };

  // ---- Home: Today card + briefing + each calendar view
  await view('listWeek'); await p.evaluate(() => window.scrollTo(0, 0));
  await audit('home-today', '.topbar, #bottomNav, #todayCard, #briefing', 'home_today_' + THEME);
  await audit('view-list', page);
  for (const sc of ['week', 'month', 'season']) { await p.click(`#briefScope [data-scope=${sc}]`); await settle(600); await audit('briefing-' + sc, '#briefing'); }
  await p.click('#briefScope [data-scope=day]'); await settle(400);
  // Today tab (bottom nav)
  await p.click('#bottomNav [data-tab=today]'); await settle(900); await audit('today-heads-nohome', '#todayCard .tc-heads');
  assert(await p.$('#tcLeave [data-state=nohome]'), `${THEME} leave-by: no-home hint shown`);
  await p.evaluate(() => window.SandyLeave.setHome('1 Test Home Rd, Testville, MO 63000')); await p.evaluate(() => window.SandyNav.renderToday()); await settle(900);
  const lbStates = await p.$$eval('#tcLeave li', ls => ls.map(l => l.dataset.state));
  assert(['ok', 'now', 'noroute'].every(x => lbStates.includes(x)), `${THEME} leave-by: ok / now / noroute lines all present (${lbStates})`);
  await audit('today-tab', 'body > *:not(dialog):not(script)', 'today_tab_' + THEME);
  let release; holdRoutes = new Promise(res => release = res);
  await p.evaluate(() => { localStorage.removeItem('sandy.route.v1'); window.SandyNav.renderToday(); }); await settle(400);
  assert(await p.$('#tcLeave [data-state=pending]'), `${THEME} leave-by: pending lines while routing`);
  await audit('today-heads-pending', '#todayCard .tc-heads'); release(); holdRoutes = null; await settle(600);
  // leave-by from current location (SI A): in-app ask row, then a "from your current location" line
  assert(await p.$('#tcLeave [data-state=askloc]'), `${THEME} leave-by: "Not leaving from home?" ask row shown in the 1-hour window`);
  await audit('today-heads-askloc', '#todayCard .tc-heads');
  await ctx.grantPermissions(['geolocation']); await ctx.setGeolocation({ latitude: 38.95, longitude: -90.2 });
  await p.click('#tcLeave .lb-loc-yes'); await p.waitForSelector('#tcLeave [data-origin=current]', { timeout: 8000 }); await settle(300);
  await audit('today-heads-current', '#todayCard .tc-heads');
  // Collapsible Today cards (collapse.js): every card collapsed (headers + summary counts + chevrons), then restored
  await p.evaluate(() => { window.SandyNav.renderToday(); }); await settle(600);
  await p.evaluate(() => { document.querySelectorAll('#todayCard [data-collapsible]:not(.is-collapsed) .tc-tog').forEach(b => b.click()); }); await settle(400);
  await p.evaluate(() => document.getElementById('todayCard').scrollIntoView({ block: 'start' })); await settle(200);
  await audit('today-collapsed', '#todayCard', 'today_collapsed_' + THEME);
  await p.evaluate(() => { document.querySelectorAll('#todayCard [data-collapsible].is-collapsed .tc-tog').forEach(b => b.click()); localStorage.removeItem('sandy.todayCollapsed.v1'); }); await settle(300);
  // Away-game travel plan (SI D): the seeded NEUTRAL game today (Kates Gym) + an away game Thursday; weather mocked
  const tvId = await p.evaluate(async () => { const S = window.__app.Store; const e = { id: crypto.randomUUID(), kind: 'event', allDay: false, recurrence: { freq: 'none' }, calendar: 'mam', category: 'Game – Maryville University', title: 'Maryville University @ Test College - AWAY', start: '2026-11-19T18:00', end: '2026-11-19T20:00', location: 'Test Gym A, Testville', notes: 'Drive from Maryville University: 314 mi, about 5 hr 59 min' };
    await S.save(e); window.__app.refresh(); return e.id; });
  await p.evaluate(() => window.SandyNav.renderToday());
  await p.waitForFunction(() => { const s = [...document.querySelectorAll('.tc-travel')]; return s.length && s.every(x => !x.querySelector('[data-state=pending]')); }, null, { timeout: 8000 }); await settle(300);
  await p.evaluate(() => document.querySelector('.tc-travel').scrollIntoView({ block: 'start' })); await settle(200);
  await audit('today-travel', '.tc-travel', 'today_travel_' + THEME);
  await p.evaluate(async id => { await window.__app.Store.remove(id); window.__app.refresh(); }, tvId); await settle(300);
  // Practice prep (SI C): last Maryville practice's notes + Notion link + this practice's note
  const ppId = await p.evaluate(async () => { const S = window.__app.Store; const e = { id: crypto.randomUUID(), kind: 'event', allDay: false, recurrence: { freq: 'weekly', interval: 1, byWeekday: [2, 4] }, location: '', notes: '', calendar: 'mam', category: 'Team practice – Maryville University', title: 'Maryville University practice', start: '2026-11-03T15:00', end: '2026-11-03T17:00' };
    await S.save(e); await S.notes.set(e.id, '2026-11-12', Array.from({ length: 10 }, (_, i) => 'Practice point ' + (i + 1)).join('\n')); await S.notes.set(e.id, '2026-11-17', 'Plan: zone offense');
    localStorage.setItem('scott-calendar-links-v1', JSON.stringify([{ eventId: e.id, date: '2026-11-12', url: 'https://www.notion.so/test/Practice-0123456789abcdef0123456789abcdef' }])); S.links.invalidate(); window.__app.refresh(); return e.id; });
  await p.evaluate(() => window.SandyNav.renderToday()); await p.waitForSelector('.tc-practice .pp-notion', { timeout: 8000 });
  await p.evaluate(() => { document.querySelector('.tc-practice .pp-more').open = true; document.querySelector('.tc-practice').scrollIntoView({ block: 'center' }); }); await settle(300);
  await audit('today-practice', '.tc-practice', 'today_practice_' + THEME);
  await p.evaluate(async id => { localStorage.setItem('scott-calendar-links-v1', '[]'); window.__app.Store.links.invalidate(); await window.__app.Store.remove(id); window.__app.refresh(); }, ppId); await settle(300);
  // Tomorrow preview (SI B): 7 PM, tomorrow has an early drive, a checklist line, a Bring line and a to-do
  const tmIds = await p.evaluate(async () => { const S = window.__app.Store; const mk = o => ({ id: crypto.randomUUID(), kind: 'event', allDay: false, recurrence: { freq: 'none' }, location: '', calendar: 'mam', category: 'Practice', ...o });
    const a = mk({ title: 'Morning shootaround', start: '2026-11-18T07:00', end: '2026-11-18T08:00', location: 'Test Gym A, Testville', notes: '- [ ] Ball bag\nBring: water' });
    const t = mk({ kind: 'task', title: 'Print scouting report', allDay: true, start: '2026-11-18', end: '2026-11-18' });
    await S.save(a); await S.save(t); return [a.id, t.id]; });
  await p.clock.setSystemTime(new Date('2026-11-18T01:00:00Z')); await p.evaluate(() => window.SandyNav.renderToday());
  await p.waitForFunction(() => { const l = document.getElementById('tmLeave'); return l && !l.hidden; }, null, { timeout: 8000 }); await settle(300);
  assert(await p.$('#tcTomorrow .tm-prep-check') && await p.$('#tcTomorrow .tm-prep-bring') && await p.$('#tcTomorrow .tm-prep-early'), `${THEME} tomorrow card: prep items shown`);
  await p.evaluate(() => document.getElementById('tcTomorrow').scrollIntoView({ block: 'center' })); await settle(200);
  await audit('today-tomorrow', '#tcTomorrow', 'today_tomorrow_' + THEME);
  await p.evaluate(async ids => { for (const id of ids) await window.__app.Store.remove(id); window.__app.refresh(); }, tmIds);
  await p.clock.setSystemTime(new Date('2026-11-17T16:30:00Z')); await settle(300);
  await view('listWeek');
  // List view screenshot scrolled to the event list (day groups)
  await p.evaluate(() => { const el = document.querySelector('#calendar .fc-list-day'); if (el) window.scrollTo(0, el.getBoundingClientRect().top + window.scrollY - 140); }); await settle(400);
  await p.screenshot({ path: `${SHOTS}/${PFX}list_${THEME}.png` });
  // List day-box border check
  const dayBox = await p.evaluate(() => [...document.querySelectorAll('#calendar .fc-list-day .fc-list-day-cushion')].slice(0, 3).map(e => { const cs = getComputedStyle(e); return { w: parseFloat(cs.borderTopWidth), c: cs.borderTopColor, style: cs.borderTopStyle, l: parseFloat(cs.borderLeftWidth), r: parseFloat(cs.borderRightWidth), btm: parseFloat(cs.borderBottomWidth) }; }));
  snap.dayBox = dayBox;
  assert(dayBox.length >= 2, `${THEME} list has day groups (${dayBox.length})`);
  for (const d of dayBox) {
    assert(d.style === 'solid' && d.w >= 0.5 && d.w <= 1.5 && d.l >= .5 && d.r >= .5 && d.btm >= .5, `${THEME} day box has a thin border on all sides (${d.w}px ${d.style})`);
    const m = d.c.match(/[\d.]+/g).map(Number); const a = m.length > 3 ? m[3] : 1;
    if (DARK) assert(m[0] > 200 && m[1] > 200 && m[2] > 200 && a >= .6, `dark day box border is soft white (${d.c})`);
    else assert(m[0] < 200 && m[1] < 200 && m[2] < 200 && a >= .3, `light day box border is gray/dark (${d.c})`);
  }
  await view('timeGridDay'); await audit('view-day', page, 'day_' + THEME);
  await view('timeGridWeek'); await audit('view-week', page, 'week_' + THEME);
  await view('dayGridMonth'); await audit('view-month', page, 'month_' + THEME);
  // Harris-Stowe (yellow) games: List rows, Day (home game with drive from home), Week
  await view('listWeek', '2026-11-19');
  await p.evaluate(() => document.querySelector('#calendar .sandy-game.game-team-hssu').scrollIntoView({ block: 'center' })); await settle(300);
  assert((await p.$$('#calendar .fc-list-event.sandy-game.game-team-hssu .game-ha-hssu')).length === 2, `${THEME} HSSU: 2 yellow-badged List rows`);
  await audit('view-hssu-list', '#calendar', 'hssu_list_' + THEME);
  await view('timeGridDay', '2026-11-19'); await p.evaluate(() => document.querySelector('#calendar .sandy-game.game-team-hssu').scrollIntoView({ block: 'center' })); await settle(300);
  await audit('view-hssu-day', '#calendar', 'hssu_day_' + THEME);
  await view('timeGridWeek', '2026-11-19'); await p.evaluate(() => document.querySelector('#calendar .sandy-game.game-team-hssu').scrollIntoView({ block: 'center' })); await settle(300);
  await audit('view-hssu-week', '#calendar', 'hssu_week_' + THEME);
  // month picker
  await p.click('#calendar .fc-toolbar-title'); await settle(); await audit('month-picker', '#monthPicker'); await closeDialogs();
  await view('listWeek');

  // ---- To-Do
  await p.click('#bottomNav [data-tab=todo]'); await settle();
  await audit('todo', '.topbar, #bottomNav, #page-todo', 'todo_' + THEME);
  // done items + group by date
  await p.evaluate(async () => { const it = (window.SandyNav.Inbox.cache || [])[0]; if (it) await window.SandyNav.Inbox.save({ ...it, done: true }); });
  await p.check('#todoShowDone'); await p.selectOption('#todoGroup', 'date'); await settle(700);
  await audit('todo-done-by-date', '#page-todo');
  await p.uncheck('#todoShowDone'); await p.selectOption('#todoGroup', 'calendar'); await settle(500);
  await p.fill('#qaText', 'Call Jon tomorrow 3pm'); await p.dispatchEvent('#qaText', 'input'); await settle();
  await audit('todo-quickadd-chips', '#page-todo');
  await p.fill('#qaText', ''); await p.dispatchEvent('#qaText', 'input'); await settle(300);
  const inboxRow = await p.$('#todoList [data-inbox] .td-title, #todoList [data-inbox]');
  if (inboxRow) { await inboxRow.click(); await settle(); if (await p.$('dialog[open]')) { await audit('todo-inbox-editor', 'dialog[open]'); await closeDialogs(); } }
  await p.click('#todoCatsBtn'); await settle(); if (await p.$('dialog[open]')) { await audit('todo-categories', 'dialog[open]'); await closeDialogs(); }

  // ---- Search
  await p.click('#bottomNav [data-tab=search]'); await settle();
  await audit('search-hint', '#page-search');
  await p.fill('#searchBox', 'press'); await p.dispatchEvent('#searchBox', 'input'); await settle(900);
  await p.evaluate(() => window.scrollTo(0, 0));
  await audit('search-results-notes', '.topbar, #bottomNav, #page-search', 'search_notes_' + THEME);
  await p.fill('#searchBox', 'maryville'); await p.dispatchEvent('#searchBox', 'input'); await settle(900);
  await audit('search-results-events', '#page-search');
  await p.fill('#searchBox', 'dark mode'); await p.dispatchEvent('#searchBox', 'input'); await settle(900);
  await audit('search-results-settings', '#page-search');
  await p.fill('#searchBox', 'zzqqxx'); await p.dispatchEvent('#searchBox', 'input'); await settle(900);
  await audit('search-empty', '#page-search');
  await p.fill('#searchBox', ''); await p.dispatchEvent('#searchBox', 'input'); await settle(400);
  // Notes Review (week of Nov 16) on the Search page
  await p.evaluate(() => { const b = document.querySelector('#reviewScope [data-scope=week], #reviewScope button:nth-child(2)'); if (b) b.click(); }); await settle(700);
  await p.evaluate(() => document.getElementById('reviewSection').scrollIntoView({ block: 'start' })); await settle(400);
  await p.evaluate(() => { const f = document.getElementById('reviewFilters'); if (f) f.open = true; }); await settle(300);
  await audit('search-notes-review', '#reviewSection');
  await p.evaluate(() => { const f = document.getElementById('reviewFilters'); if (f) f.open = false; document.getElementById('reviewList').scrollIntoView({ block: 'center' }); }); await settle(400);
  await p.screenshot({ path: `${SHOTS}/${PFX}search_review_${THEME}.png` });

  // ---- Profile
  await p.click('#bottomNav [data-tab=profile]'); await settle();
  await audit('profile', '.topbar, #bottomNav, #page-profile', 'profile_' + THEME);
  // Profile → Home address suggestions open
  await p.evaluate(() => document.getElementById('homeSection').scrollIntoView({ block: 'start' })); await p.fill('#homeAddr', ''); await p.type('#homeAddr', 'Maryville', { delay: 30 });
  await p.waitForSelector('#homeAddrList li', { timeout: 8000 }); await p.press('#homeAddr', 'ArrowDown'); await p.mouse.move(2, 2); await settle(400);
  await audit('profile-home-suggest', '#homeSection', 'home_suggest_' + THEME);
  await p.evaluate(() => document.getElementById('leaveAlertsBox').scrollIntoView({ block: 'center' })); await settle(200);
  await audit('profile-leave-alerts', '#leaveAlertsBox');
  await p.press('#homeAddr', 'Escape'); await p.fill('#homeAddr', ''); await settle(200);
  // Calendars screen (2026-10-25): plain list, one calendar's editor open, add form open
  await p.click('#manageCalsBtn'); await p.waitForSelector('dialog.cal-dlg[open]'); await settle(400);
  await audit('dlg-calendars-list', 'dialog[open]', 'calendars_list_' + THEME);
  await p.click('dialog.cal-dlg .cal-list > li:nth-child(2) .cal-item'); await p.click('#calAddBtn'); await p.fill('#ncName', 'Personal'); await p.mouse.move(2, 840); await settle(300);
  await audit('dlg-calendars-edit-add', 'dialog[open]', 'calendars_edit_' + THEME); await closeDialogs();

  // ---- Signed-in-only UI, mounted with stand-ins (no network): Account section, notifications box, time zone /
  //      feedback / admin buttons, and their dialogs; first-run welcome; sign-in screen
  await p.evaluate(() => {
    const user = { id: 'u1', email: 'scott@example.com' };
    const fakeSb = { rpc: n => Promise.resolve({ data: n === 'sandy_is_admin' }),
      from: () => ({ select: () => ({ order: () => ({ limit: async () => ({ data: [{ email: 'coach@example.com', body: 'Love the dark mode. The list view is easier now.', created_at: '2026-11-16T15:00:00Z' }] }) }) }), insert: async () => ({}) }) };
    const store = { auth: {}, adapter: { client: fakeSb }, profile: async () => ({ plan: 'free' }) };
    const realFetch = window.fetch; window.fetch = (u, o) => (o && o.method === 'POST' && /invites/.test(String(o.body || '')) || (o && o.method === 'POST' && String(o.body || '').includes('"action"')))
      ? Promise.resolve(new Response(JSON.stringify({ invites: [{ email: 'friend@example.com', status: 'invited', created_at: '2026-11-10T15:00:00Z' }, { email: 'coach@example.com', status: 'accepted', created_at: '2026-11-02T15:00:00Z', last_sign_in_at: '2026-11-16T15:00:00Z' }, { email: 'old@example.com', status: 'revoked', created_at: '2026-10-01T15:00:00Z' }] }), { status: 200, headers: { 'content-type': 'application/json' } }))
      : realFetch(u, o);
    if (!document.getElementById('accountSection')) window.SandyAccount.mountAccount({ store, user, mount: document.getElementById('dataSection') });
    try { window.SandyPush.mount({ store, user }); } catch (e) { console.warn(e); }
    window.SandyLaunch.mount({ store, user, timeZone: () => 'America/Chicago', setTZ() {}, toast() {} });
  });
  await p.click('#bottomNav [data-tab=profile]'); await settle(900);
  await audit('profile-signed-in', '#page-profile', 'profile_signed_in_' + THEME);
  for (const [btn, name] of [['#feedbackBtn', 'dlg-feedback'], ['#invitesBtn', 'dlg-invites'], ['#fbInboxBtn', 'dlg-feedback-inbox'], ['#acctDelete', 'dlg-delete-account']]) {
    if (!(await p.$(btn)) || !(await p.isVisible(btn))) { console.log('skip', name); continue; }
    await p.click(btn); await settle(900); await audit(name, 'dialog[open]'); await closeDialogs();
  }
  await p.evaluate(() => window.SandyPush.showInstall()); await settle(700); await audit('dlg-push-install', 'dialog[open]'); await closeDialogs();
  await p.evaluate(() => { window.SandyAccount.onboarding({ store: {}, user: { email: 'new@example.com' } }); }); await settle(700);
  await audit('onboarding', '.onb'); await p.evaluate(() => document.querySelectorAll('.onb').forEach(n => n.remove()));
  await p.evaluate(() => { const g = document.getElementById('authGate'); g.hidden = false; document.getElementById('authMsg').textContent = 'SANDY is invite-only. Enter your email to get a sign-in code.'; }); await settle(300);
  await audit('sign-in', '#authGate');
  await p.evaluate(() => { document.getElementById('authForm').hidden = true; document.getElementById('authCodeForm').hidden = false; const e = document.getElementById('authCodeErr'); e.hidden = false; e.textContent = 'That code did not work. Check the newest email.'; }); await settle(300);
  await audit('sign-in-code', '#authGate');
  await p.evaluate(() => { document.getElementById('authGate').hidden = true; document.getElementById('authForm').hidden = false; document.getElementById('authCodeForm').hidden = true; });

  // ---- Event editor: new, existing with day note + checklist, away game
  await home(); await p.click('#addBtn'); await settle(); await audit('editor-new', '#eventDialog'); await closeDialogs();
  // Location suggestions open (2026-10-25): typing, then a highlighted (keyboard-active) suggestion
  await p.click('#addBtn'); await settle(); await p.click('#fLocation'); await p.type('#fLocation', 'Maryville', { delay: 30 });
  await p.waitForSelector('#fLocationList li', { timeout: 8000 }); await settle(400);
  await p.evaluate(() => document.getElementById('fLocation').scrollIntoView({ block: 'center' })); await p.mouse.move(2, 2); await settle(200);
  const popBg = await p.evaluate(() => getComputedStyle(document.querySelector('.loc-field .ac-pop')).backgroundColor);
  assert(DARK ? popBg === 'rgb(17, 26, 43)' : popBg === 'rgb(255, 255, 255)', `${THEME} Location suggestions use the ${DARK ? 'dark panel' : 'white'} background (${popBg})`);
  await audit('editor-location-suggest', '#eventDialog', 'loc_suggest_' + THEME);
  await p.press('#fLocation', 'ArrowDown'); await p.press('#fLocation', 'ArrowDown'); await settle(200);
  assert(await p.$('#fLocationList li[aria-selected=true]'), `${THEME} a suggestion is highlighted`);
  await audit('editor-location-suggest-active', '#eventDialog', 'loc_suggest_active_' + THEME); await closeDialogs();
  await p.evaluate(id => window.__app.openEditor(id, '2026-11-17'), ids.cl); await settle(900);
  await audit('editor-daynote-checklist', '#eventDialog');
  await p.evaluate(() => document.getElementById('checklistBox').scrollIntoView({ block: 'start' })); await settle(400);
  await p.screenshot({ path: `${SHOTS}/${PFX}editor_${THEME}.png` }); await closeDialogs();
  await p.evaluate(id => window.__app.openEditor(id, '2026-11-21'), ids.away); await settle(900);
  await audit('editor-game', '#eventDialog'); await closeDialogs();
  await p.evaluate(id => window.__app.openEditor(id, '2026-11-20'), ids.hsAway); await settle(900);
  await audit('editor-game-hssu', '#eventDialog'); await closeDialogs();

  // ---- Scope dialog (repeating event) — save + delete wording
  for (const mode of ['save', 'delete']) {
    await p.evaluate(m => { const d = document.getElementById('scopeDialog');
      document.getElementById('scopeTitle').textContent = m === 'delete' ? 'Delete…' : 'Apply changes to…';
      document.getElementById('scopeDesc').textContent = '"Study block" is a repeating event.';
      document.getElementById('scopeOneSub').textContent = 'Only Tue, Nov 17'; d.classList.toggle('danger-mode', m === 'delete'); d.showModal(); }, mode);
    await settle(); await audit('scope-dialog-' + mode, '#scopeDialog'); await closeDialogs();
  }

  // ---- AI panel (empty, then with user / assistant / proposal / error messages) + toast
  await p.click('#aiBtn'); await settle(900);
  if (await p.$('.ai-panel')) {
    await audit('ai-panel', '.ai-panel');
    await p.evaluate(() => { const log = document.getElementById('aiLog'); if (!log) return;
      const add = (cls, html) => { const d = document.createElement('div'); d.className = 'ai-msg ' + cls; d.innerHTML = html; log.appendChild(d); return d; };
      add('user', 'Move film study to 4pm tomorrow');
      add('assistant', 'Sure. Here is what I would change:');
      add('assistant thinking', 'Checking your calendar…');
      const c = add('assistant card', '<div class="ai-card-from">✨ Sandy Intelligence suggests</div><div class="ai-card-title">Move Film study</div><dl><dt>Item</dt><dd>Film study</dd><dt>New start</dt><dd>Wed, Nov 18 · 4:00 PM</dd></dl><div class="ai-card-btns"><button type="button" class="primary">Confirm</button><button type="button">Cancel</button></div>'); c.classList.add('ai-card');
      const c2 = add('assistant card', '<div class="ai-card-from">✨ Sandy Intelligence suggests</div><div class="ai-card-title">Add Lift</div><div class="ai-card-btns"><span class="ai-card-status">✓ Saved</span></div>'); c2.classList.add('ai-card');
      add('error', 'Could not reach Sandy Intelligence. Try again.');
      add('note', 'I confirmed: Add Lift, Wed 6–7 PM'); add('ai-resumed', '<span>Move film study to 4pm tomorrow</span> · Sat, Nov 14'); // chat history (SI E)
    }); await settle(400);
    await audit('ai-panel-messages', '.ai-panel', 'ai_' + THEME);
    // Chat history panel (SI E): two saved chats (one open), one row asking "Delete?"
    await p.evaluate(async () => { const C = window.SandyAI.Chats; for (const c of await C.list()) await C.remove(c.id);
      await C.save({ id: 'audit-chat-1', title: 'What do I have Saturday afternoon?', messages: [{ role: 'user', content: 'What do I have Saturday afternoon?' }, { role: 'assistant', content: 'Film at 4.' }] });
      await C.save({ id: 'audit-chat-2', title: 'Can you move my Tuesday meeting with Bill to Wednesday at 3…', messages: [{ role: 'user', content: 'Can you move my Tuesday meeting' }] });
      await window.SandyAI.openChat('audit-chat-1'); await window.SandyAI.showHistory(); });
    await p.waitForSelector('.ai-hist-row'); await p.click('[data-del="audit-chat-2"]'); await settle(300);
    await audit('ai-history', '.ai-panel', 'ai_history_' + THEME);
    await p.evaluate(async () => { window.SandyAI.hideHistory(); const C = window.SandyAI.Chats; for (const c of await C.list()) await C.remove(c.id); await window.SandyAI.newChat(); });
  }
  await p.keyboard.press('Escape'); await closeDialogs();
  await p.evaluate(() => window.__app.toast('Saved')); await settle(300); await audit('toast', '#toast');

  assert(!errs.length, 'no page errors ' + errs.join(';'));
  await b.close();
  if (process.env.SNAP) fs.writeFileSync(process.env.SNAP, JSON.stringify(snap, null, 1));
  console.log(`checked ${checked} text items in ${THEME} mode; ${failList.length} below AA`);
  if (failList.length) { const byScreen = {}; for (const f of failList) (byScreen[f.screen] = byScreen[f.screen] || []).push(f); console.log('below AA by screen: ' + Object.entries(byScreen).map(([k, v]) => `${k}=${v.length}`).join(', ')); }
  if (REPORT_ONLY) { console.log('REPORT ONLY'); process.exit(0); }
  console.log(fails ? `${fails} FAILED` : 'ALL PASS'); process.exit(fails ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
