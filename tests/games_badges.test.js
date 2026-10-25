// Browser test (Scott 2026-10-24): Maryville game events. Red glowing border + big red H / A badge in
// List, Day and Week views; away games show the venue (tap = Google Maps directions from Maryville
// University) and the drive distance. Light + dark at 390x844. Non-game events are untouched.
//   node tests/games_badges.test.js http://127.0.0.1:8787/ [screenshotDir]
const { chromium } = require(process.env.PW || '/workspace/shot-tools/node_modules/playwright-core');
const BASE = process.argv[2] || 'http://127.0.0.1:8787/'; const SHOTS = process.argv[3] || '/workspace/shots-games';
require('fs').mkdirSync(SHOTS, { recursive: true });
let n = 0; const assert = (c, m) => { if (!c) throw new Error('FAIL: ' + m); n++; console.log('ok -', m); };
const CONTRAST = `(() => {
  const parse = s => { let m = s.match(/color\\(srgb ([\\d.]+) ([\\d.]+) ([\\d.]+)/); if (m) return [+m[1] * 255, +m[2] * 255, +m[3] * 255];
    m = s.match(/rgba?\\(([\\d.]+),? ([\\d.]+),? ([\\d.]+)/); return m ? [+m[1], +m[2], +m[3]] : null; };
  const lum = c => { const f = v => { v /= 255; return v <= .03928 ? v / 12.92 : Math.pow((v + .055) / 1.055, 2.4); }; return .2126 * f(c[0]) + .7152 * f(c[1]) + .0722 * f(c[2]); };
  window.__contrast = (fg, bg) => { const a = lum(parse(fg)), b = lum(parse(bg)); return (Math.max(a, b) + .05) / (Math.min(a, b) + .05); };
})()`;
const AWAY_LOC = 'Fred DeLay Gymnasium (Union University), 1050 Union University Dr, Jackson, TN 38305';
const NOTES = 'Maryville University men\'s basketball 2026-27\nDrive from Maryville University: 268 mi, about 4 hr 14 min\nSchedule: https://maryvillesaints.com/sports/mens-basketball/schedule/2026-27';
(async () => {
  const b = await chromium.launch({ executablePath: '/usr/bin/google-chrome', headless: true, args: ['--no-sandbox'] });
  const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, timezoneId: 'America/Chicago', locale: 'en-US', isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
  const p = await ctx.newPage(); const errs = []; p.on('pageerror', e => errs.push(e.message));
  await p.clock.install({ time: new Date('2026-11-16T15:00:00Z') }); // Mon Nov 16, 9:00 AM CT
  await p.goto(BASE); await p.waitForFunction(() => window.__app && window.__app.Store);
  await p.evaluate(() => { localStorage.clear(); sessionStorage.clear(); }); await p.goto(BASE); await p.waitForFunction(() => window.__app && window.__app.Store && window.SandyNav && window.SandyGames);
  await p.evaluate(CONTRAST);
  // ---- unit: SandyGames.info parsing
  const u = await p.evaluate(() => {
    const G = window.SandyGames;
    return {
      away: G.info({ title: 'Maryville University @ Union University (Tenn.) - AWAY', category: 'Game – Maryville University', location: 'X Gym, 1 Main St, Jackson, TN', notes: 'a\nDrive from Maryville University: 268 mi, about 4 hr 14 min\nb' }),
      home: G.info({ title: 'Maryville University vs Lincoln University - HOME', category: 'Game – Maryville University', location: 'Simon', notes: '' }),
      neutral: G.info({ title: 'Maryville University vs Malone University - NEUTRAL', category: 'Other', location: 'Kates Gym', notes: 'Drive from Maryville University: 509 mi' }),
      none: G.info({ title: 'Maryville University basketball practice', category: 'Team practice – Maryville University' }),
      cat: G.info({ title: 'Maryville University @ Somebody', category: 'Game – Maryville University' }),
    };
  });
  assert(u.away.ha === 'A' && u.away.miles === 268 && u.away.drive === '4 hr 14 min' && u.away.travel, 'info: away game, 268 mi, drive time parsed from Notes');
  assert(u.away.url.startsWith('https://www.google.com/maps/dir/?api=1') && u.away.url.includes('origin=Maryville%20University%2C%20650%20Maryville%20University%20Dr%2C%20St.%20Louis%2C%20MO%2063141') && u.away.url.includes('destination=X%20Gym'), 'info: Google Maps directions URL from Maryville University to the venue');
  assert(u.home.ha === 'H' && !u.home.travel && u.home.url === '', 'info: home game, no directions');
  assert(u.neutral.ha === 'N' && u.neutral.miles === 509 && u.neutral.drive === '', 'info: neutral site from the title suffix');
  assert(u.none === null, 'info: practices are not games');
  assert(u.cat && u.cat.ha === 'A', 'info: Game category + "@" title = away');
  // ---- seed a real week (Nov 15–21) from the 2026-27 schedule + a normal practice
  await p.evaluate(async ({ AWAY_LOC, NOTES }) => {
    const S = window.__app.Store; await S.removeWhere(() => true);
    const ev = o => ({ id: crypto.randomUUID(), kind: 'event', allDay: false, recurrence: { freq: 'none' }, location: '', notes: '', calendar: 'mam', ...o });
    await S.save(ev({ title: 'Maryville University vs University of Wisconsin-Parkside - HOME', category: 'Game – Maryville University', start: '2026-11-18T19:00', end: '2026-11-18T21:00', location: 'John E. and Adaline Simon Athletic Center, 650 Maryville University Dr, St. Louis, MO 63141', notes: "Maryville University men's basketball 2026-27" }));
    await S.save(ev({ title: 'Maryville University @ Union University (Tenn.) - AWAY', category: 'Game – Maryville University', start: '2026-11-21T16:00', end: '2026-11-21T18:00', location: AWAY_LOC, notes: NOTES }));
    await S.save(ev({ title: 'Maryville University basketball practice', category: 'Team practice – Maryville University', start: '2026-11-19T13:00', end: '2026-11-19T15:00' }));
    await S.save(ev({ title: 'Life Time shift', calendar: 'lifetime', category: 'Work shift', start: '2026-11-21T09:00', end: '2026-11-21T13:00' }));
    window.__app.refresh();
  }, { AWAY_LOC, NOTES });
  await p.waitForTimeout(500);
  const view = async (v, d) => { await p.click('#bottomNav [data-tab=home]'); await p.waitForTimeout(300); await p.evaluate(([v, d]) => window.__app.calendar.changeView(v, d), [v, d]); await p.waitForTimeout(700); };
  const rect = h => h.evaluate(e => { const r = e.getBoundingClientRect(); return { left: r.left, right: r.right, top: r.top, bottom: r.bottom, w: r.width, h: r.height }; });
  const inside = (o, i, pad = 1) => i.left >= o.left - pad && i.right <= o.right + pad && i.top >= o.top - pad && i.bottom <= o.bottom + pad;
  const red = c => { const m = c.match(/(\d+), (\d+), (\d+)/); return m && +m[1] > 200 && +m[2] < 120 && +m[3] < 120; };
  const badgeStyle = h => h.evaluate(e => { const cs = getComputedStyle(e); return { t: e.textContent, color: cs.color, fs: parseFloat(cs.fontSize), fw: +cs.fontWeight, label: e.getAttribute('aria-label'), con: window.__contrast(cs.color, cs.backgroundColor) }; });
  for (const dark of [false, true]) {
    const tag = dark ? 'dark' : 'light';
    await p.evaluate(d => window.SandyNav.setDark(d), dark); await p.waitForTimeout(200);
    // ================= List view =================
    await view('listWeek', '2026-11-18');
    const games = await p.$$('#calendar .fc-list-event.sandy-game');
    assert(games.length === 2, `${tag} List: 2 game rows marked`);
    const plain = await p.$$eval('#calendar .fc-list-event:not(.sandy-game)', r => r.length);
    assert(plain === 2 && (await p.$$('#calendar .fc-list-event:not(.sandy-game) .game-ha')).length === 0, `${tag} List: practice + shift untouched (no glow, no badge)`);
    for (const row of games) {
      const g = await row.evaluate(e => { const a = getComputedStyle(e, '::after'); return { title: e.querySelector('.fc-list-event-title a').textContent, bc: a.borderTopColor, bw: parseFloat(a.borderTopWidth), sh: a.boxShadow, content: a.content }; });
      const home = / - HOME$/.test(g.title);
      assert(g.content !== 'none' && red(g.bc) && g.bw >= 2 && /rgba?\(/.test(g.sh), `${tag} List: red glowing border on "${g.title}" (${g.bc}, ${g.sh.slice(0, 40)}…)`);
      const bs = await badgeStyle(await row.$('.game-ha'));
      assert(bs.t === (home ? 'H' : 'A') && red(bs.color) && bs.fs >= 16 && bs.fw >= 800 && bs.con >= 4.5, `${tag} List: big bold red "${bs.t}" badge (${bs.fs}px/${bs.fw}, contrast ${bs.con.toFixed(2)}) — ${bs.label}`);
      const rr = await rect(row); const parts = await row.$$('.game-ha, .fc-list-event-title a, .game-meta');
      for (const h of parts) assert(inside(rr, await rect(h)), `${tag} List: ${await h.evaluate(e => e.className || e.tagName)} inside the row`);
      const meta = await row.$('.game-meta');
      if (home) assert(!meta, `${tag} List: home game has no venue/distance line`);
      else {
        const m = await row.evaluate(e => { const a = e.querySelector('.game-loc'), d = e.querySelector('.game-dist'), bg = getComputedStyle(e.querySelector('td')).backgroundColor;
          return { href: a.href, text: a.textContent, target: a.target, dist: d.textContent, ca: window.__contrast(getComputedStyle(a).color, bg), cd: window.__contrast(getComputedStyle(d).color, bg) }; });
        assert(m.text.includes('Fred DeLay Gymnasium') && m.href.startsWith('https://www.google.com/maps/dir/?api=1') && m.href.includes('destination=Fred%20DeLay') && /origin=Maryville%20University/.test(m.href) && m.target === '_blank', `${tag} List: away venue shown and links to Google Maps directions from Maryville`);
        assert(/268 mi · ~4 hr 14 min from Maryville/.test(m.dist), `${tag} List: drive distance "${m.dist.trim()}"`);
        assert(m.ca >= 4.5 && m.cd >= 4.5, `${tag} List: venue/distance readable (${m.ca.toFixed(2)}, ${m.cd.toFixed(2)})`);
        // Tapping the venue opens Maps (new tab) and does NOT open the editor
        const [pop] = await Promise.all([ctx.waitForEvent('page', { timeout: 4000 }), row.$eval('.game-loc', a => a.click())]);
        await pop.waitForURL(/maps|google/, { timeout: 4000 }).catch(() => {}); const popUrl = pop.url(); await pop.close();
        const edOpen = await p.evaluate(() => document.getElementById('eventDialog')?.open || [...document.querySelectorAll('dialog')].some(d => d.open));
        console.log('  popup:', popUrl.slice(0, 80), 'editorOpen:', edOpen); assert(/google\.com\/maps\/dir/.test(popUrl) && !edOpen, `${tag} List: tapping the venue opens Google Maps directions, editor stays closed`);
        if (dark) { await row.evaluate(e => e.scrollIntoView({ block: 'center' })); await p.waitForTimeout(200); }
      }
    }
    await p.screenshot({ path: `${SHOTS}/list_${tag}.png` });
    // ================= Day view (away game) =================
    await view('timeGridDay', '2026-11-21');
    const ev = await p.$('#calendar .fc-timegrid-event.sandy-game');
    assert(!!ev, `${tag} Day: away game marked`);
    await ev.evaluate(e => e.scrollIntoView({ block: 'center' })); await p.waitForTimeout(200);
    const ds = await ev.evaluate(e => { const cs = getComputedStyle(e); return { bc: cs.borderTopColor, bw: parseFloat(cs.borderTopWidth), sh: cs.boxShadow }; });
    assert(red(ds.bc) && ds.bw >= 2 && ds.sh !== 'none', `${tag} Day: red glowing border (${ds.bc})`);
    const db = await badgeStyle(await ev.$('.game-ha'));
    assert(db.t === 'A' && red(db.color) && db.fs >= 16 && db.fw >= 800, `${tag} Day: big red "A" badge`);
    const er = await rect(ev);
    for (const s of ['.game-ha', '.fc-event-title', '.game-loc', '.game-dist']) { const h = await ev.$(s); assert(h && inside(er, await rect(h)), `${tag} Day: ${s} visible inside the block`); }
    const clipd = await ev.evaluate(e => { const t = e.querySelector('.fc-event-title'), c = t.parentElement, m = e.querySelector('.game-meta');
      return { title: t.scrollHeight <= c.getBoundingClientRect().height + 1 && t.scrollHeight <= t.getBoundingClientRect().height + 1, meta: m.scrollHeight <= m.clientHeight + 1, lines: Math.round(t.getBoundingClientRect().height / parseFloat(getComputedStyle(t).lineHeight)) }; });
    assert(clipd.title && clipd.meta, `${tag} Day: full title (${clipd.lines} lines) and venue/distance shown, nothing clipped`);
    const dlink = await ev.$eval('.game-loc', a => a.href);
    assert(dlink.includes('maps/dir') && dlink.includes('destination=Fred%20DeLay'), `${tag} Day: venue links to Google Maps directions`);
    const other = await p.$('#calendar .fc-timegrid-event:not(.sandy-game)');
    assert(other && !(await other.$('.game-ha')) && (await other.evaluate(e => getComputedStyle(e).borderTopColor)) !== ds.bc, `${tag} Day: Life Time shift untouched`);
    const clip = { x: 0, y: Math.max(0, er.top - 150), width: 390, height: 420 };
    await p.screenshot({ path: `${SHOTS}/day_${tag}.png`, clip });
    // ================= Week view =================
    await view('timeGridWeek', '2026-11-18');
    const wk = await p.$$('#calendar .fc-timegrid-event.sandy-game');
    assert(wk.length === 2, `${tag} Week: 2 games marked`);
    for (const w of wk) {
      await w.evaluate(e => e.scrollIntoView({ block: 'center' })); await p.waitForTimeout(100);
      const ws = await w.evaluate(e => ({ bc: getComputedStyle(e).borderTopColor, sh: getComputedStyle(e).boxShadow, t: e.querySelector('.game-ha')?.textContent }));
      const wr = await rect(w), br = await rect(await w.$('.game-ha'));
      assert(red(ws.bc) && ws.sh !== 'none' && /^[HA]$/.test(ws.t) && inside(wr, br), `${tag} Week: red glow + "${ws.t}" badge inside the block`);
      const wt = await w.evaluate(e => { const t = e.querySelector('.fc-event-title'), m = e.querySelector('.game-meta'), r = e.getBoundingClientRect(), q = t.getBoundingClientRect();
        return { tw: q.width, inside: q.left >= r.left - 1 && q.right <= r.right + 1 && q.top >= r.top - 1, metaHidden: !m || m.getBoundingClientRect().height === 0 }; });
      assert(wt.tw >= 20 && wt.inside && wt.metaHidden, `${tag} Week: title keeps its width inside the block (${Math.round(wt.tw)}px), venue line hidden in the narrow column`);
    }
    if (!dark) { await wk[1].evaluate(e => e.scrollIntoView({ block: 'center' })); await p.waitForTimeout(200); await p.screenshot({ path: `${SHOTS}/week_${tag}.png` }); }
    await view('timeGridDay', '2026-11-21');
    const ev2 = await p.$('#calendar .fc-timegrid-event.sandy-game');
    const again = await ev2.evaluate(e => { const r = e.getBoundingClientRect(); const ok = s => { const x = e.querySelector(s); if (!x) return false; const q = x.getBoundingClientRect(); return q.height > 0 && q.left >= r.left - 1 && q.right <= r.right + 1 && q.bottom <= r.bottom + 1; };
      return { n: e.querySelectorAll('.game-ha').length, ok: ['.game-ha', '.fc-event-title', '.game-loc', '.game-dist'].every(ok) }; });
    assert(again.n === 1 && again.ok, `${tag} Day after Week: one badge, venue + drive back, all inside the block`);
    // ================= Editor: directions under Location =================
    await view('listWeek', '2026-11-18');
    await p.click('#calendar .fc-list-event.game-A .fc-list-event-title a'); await p.waitForTimeout(500);
    const ed = await p.evaluate(() => { const g = document.getElementById('gameDir'); const a = g.querySelector('a'); return { vis: !g.hidden && g.getBoundingClientRect().height > 0, href: a && a.href, text: g.textContent }; });
    assert(ed.vis && ed.href.includes('maps/dir') && /268 mi/.test(ed.text), `${tag} Editor: "Directions from Maryville University" + distance under Location`);
    await p.keyboard.press('Escape'); await p.waitForTimeout(500);
    await p.click('#calendar .fc-list-event:not(.sandy-game) .fc-list-event-title a'); await p.waitForTimeout(500);
    assert(await p.evaluate(() => document.getElementById('gameDir').hidden), `${tag} Editor: hidden for non-game events`);
    await p.keyboard.press('Escape'); await p.waitForTimeout(500);
  }
  assert(errs.length === 0, 'no page errors' + (errs.length ? ': ' + errs.join(' | ') : ''));
  console.log(`\n${n} checks passed`); await b.close();
})().catch(e => { console.error(e); process.exit(1); });
