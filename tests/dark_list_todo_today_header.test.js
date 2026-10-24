// Browser test (Scott 2026-10-24 fix pass): dark-mode List text contrast, to-do text inside its colored bar
// (List, Day, Today), and the Today header (big bold date, count pills, spacing before Up Next). 390px, light + dark.
//   node tests/dark_list_todo_today_header.test.js http://127.0.0.1:8787/ [screenshotDir]
const { chromium } = require(process.env.PW || '/workspace/shot-tools/node_modules/playwright-core');
const BASE = process.argv[2] || 'http://127.0.0.1:8787/'; const SHOTS = process.argv[3] || '/workspace/shots-fix3';
require('fs').mkdirSync(SHOTS, { recursive: true });
const assert = (c, m) => { if (!c) throw new Error('FAIL: ' + m); console.log('ok -', m); };
// WCAG contrast computed in the page (handles rgb() and color(srgb ...) from color-mix)
const CONTRAST = `(() => {
  const parse = s => { let m = s.match(/color\\(srgb ([\\d.]+) ([\\d.]+) ([\\d.]+)/); if (m) return [+m[1] * 255, +m[2] * 255, +m[3] * 255];
    m = s.match(/rgba?\\(([\\d.]+),? ([\\d.]+),? ([\\d.]+)/); return m ? [+m[1], +m[2], +m[3]] : null; };
  const lum = c => { const f = v => { v /= 255; return v <= .03928 ? v / 12.92 : Math.pow((v + .055) / 1.055, 2.4); }; return .2126 * f(c[0]) + .7152 * f(c[1]) + .0722 * f(c[2]); };
  window.__contrast = (fg, bg) => { const a = lum(parse(fg)), b = lum(parse(bg)); return (Math.max(a, b) + .05) / (Math.min(a, b) + .05); };
})()`;
(async () => {
  const b = await chromium.launch({ executablePath: '/usr/bin/google-chrome', headless: true, args: ['--no-sandbox'] });
  const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, timezoneId: 'America/Chicago', locale: 'en-US', isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
  const p = await ctx.newPage(); const errs = []; p.on('pageerror', e => errs.push(e.message));
  await p.clock.install({ time: new Date('2026-10-24T15:00:00Z') }); // Sat Oct 24, 10:00 AM CT
  await p.goto(BASE); await p.waitForFunction(() => window.__app && window.__app.Store);
  await p.evaluate(() => { localStorage.clear(); sessionStorage.clear(); }); await p.goto(BASE); await p.waitForFunction(() => window.__app && window.__app.Store && window.SandyNav);
  await p.evaluate(CONTRAST);
  // Scott's real Saturday (from cal.py list, read-only)
  await p.evaluate(async () => {
    const S = window.__app.Store; await S.removeWhere(() => true);
    const ev = o => ({ id: crypto.randomUUID(), kind: 'event', allDay: false, recurrence: { freq: 'none' }, location: '', notes: '', ...o });
    await S.save(ev({ title: 'Study: The Covenant Code', calendar: 'msc', category: 'Study time', start: '2026-10-24T06:00', end: '2026-10-24T07:00' }));
    await S.save(ev({ title: 'Get Minds Above Matters website back up', kind: 'task', calendar: 'mam', category: 'Task / to-do', start: '2026-10-24T11:00', end: '2026-10-24T11:30' }));
    await S.save(ev({ title: 'Life Time shift', calendar: 'lifetime', category: 'Work shift', start: '2026-10-24T17:00', end: '2026-10-24T22:00' }));
    await S.save(ev({ title: 'Office study: The Teachings (30 min, during shift)', calendar: 'msc', category: 'Study time', start: '2026-10-24T20:00', end: '2026-10-24T20:30' }));
    await S.save(ev({ title: 'File taxes', kind: 'task', calendar: 'mam', allDay: true, start: '2026-10-20', end: '2026-10-20' }));
    window.__app.refresh();
  });
  await p.waitForTimeout(500);
  const view = async v => { await p.click('#bottomNav [data-tab=home]'); await p.waitForTimeout(300); await p.evaluate(v => window.__app.calendar.changeView(v, '2026-10-24'), v); await p.waitForTimeout(600); };
  const listContrast = () => p.$$eval('#calendar .fc-list-event', rows => rows.map(r => {
    const bg = getComputedStyle(r.querySelector('td')).backgroundColor;
    const t = r.querySelector('.fc-list-event-title a') || r.querySelector('.fc-list-event-title'); const tm = r.querySelector('.fc-list-event-time');
    return { title: t.textContent, t: window.__contrast(getComputedStyle(t).color, bg), tm: window.__contrast(getComputedStyle(tm).color, bg) };
  }));
  const inside = (o, i, pad = 1) => i.left >= o.left - pad && i.right <= o.right + pad && i.top >= o.top - pad && i.bottom <= o.bottom + pad;
  const rect = h => h.evaluate(e => { const r = e.getBoundingClientRect(); return { left: r.left, right: r.right, top: r.top, bottom: r.bottom }; });
  for (const dark of [false, true]) {
    const tag = dark ? 'dark' : 'light';
    await p.evaluate(d => window.SandyNav.setDark(d), dark); await p.waitForTimeout(200);
    // ---- List view contrast
    await view('listWeek');
    const c = await listContrast();
    assert(c.length >= 5 && c.every(x => x.t >= 4.5 && x.tm >= 4.5), `${tag} List: title + time contrast ≥ 4.5 on tinted rows (min ${Math.min(...c.map(x => Math.min(x.t, x.tm))).toFixed(2)})`);
    const day = await p.$eval('#calendar .fc-list-day-cushion', e => window.__contrast(getComputedStyle(e).color, getComputedStyle(e).backgroundColor));
    assert(day >= 4.5, `${tag} List: day header contrast ${day.toFixed(2)}`);
    // ---- List: to-do text sits beside its checkbox, inside the row
    const row = await p.$('#calendar .fc-list-event:has(.todo-check)');
    const [rr, cell, chk, a] = await Promise.all([rect(row), rect(await row.$('.fc-list-event-title')), rect(await row.$('.todo-check .box')), rect(await row.$('.fc-list-event-title a'))]);
    assert(a.left >= chk.right && inside(cell, a) && inside(rr, chk), `${tag} List: to-do text right of its box and inside the row (wrapped lines stay aligned)`);
    if (dark) { await row.evaluate(e => e.scrollIntoView({ block: 'center' })); await p.waitForTimeout(150); await p.screenshot({ path: `${SHOTS}/list_dark.png` }); }
    // ---- Day view: to-do text inside its colored block
    await view('timeGridDay');
    const ev = await p.$('#calendar .fc-timegrid-event:has(.todo-check)');
    await ev.evaluate(e => e.scrollIntoView({ block: 'center' })); await p.waitForTimeout(150);
    const er = await rect(ev); const tr = await rect(await ev.$('.fc-event-title')); const br = await rect(await ev.$('.todo-check .box'));
    const vis = await ev.$eval('.fc-event-title', e => { const r = e.getBoundingClientRect(); return r.width > 20 && r.height > 8; });
    assert(vis && inside(er, tr) && inside(er, br) && tr.left >= br.right, `${tag} Day: 30-min to-do title visible, inside its block, right of the box`);
    const dc = await ev.$eval('.fc-event-title', e => window.__contrast(getComputedStyle(e).color, getComputedStyle(e.closest('.fc-event')).backgroundColor));
    assert(dc >= 3, `${tag} Day: to-do title readable on its color (${dc.toFixed(2)})`);
    if (!dark) { const box = await rect(ev); await p.screenshot({ path: `${SHOTS}/todo_fixed.png`, clip: { x: 0, y: Math.max(0, box.top - 120), width: 390, height: 260 } }); }
    // ---- Today tab
    await p.click('#bottomNav [data-tab=today]'); await p.waitForTimeout(700);
    const t = await p.$$eval('.tc-on .tc-ev.is-task', es => es.map(e => { const r = e.getBoundingClientRect(), q = e.querySelector('.tc-title').getBoundingClientRect(); return q.left >= r.left && q.right <= r.right + 1 && q.top >= r.top && q.bottom <= r.bottom + 1; }));
    assert(t.length >= 1 && t.every(Boolean), `${tag} Today: to-do text inside its colored bar`);
    const hd = await p.evaluate(() => { const h = document.querySelector('#todayH'), cs = getComputedStyle(h); const sub = document.getElementById('todaySub');
      const st = document.querySelector('.tc-stats').getBoundingClientRect(), up = document.querySelector('.tc-upnext');
      return { text: h.textContent, fs: parseFloat(cs.fontSize), fw: +cs.fontWeight, sub: sub.textContent, subFs: parseFloat(getComputedStyle(sub).fontSize), con: window.__contrast(cs.color, getComputedStyle(document.getElementById('todayCard')).backgroundColor === 'rgba(0, 0, 0, 0)' ? getComputedStyle(document.body).backgroundColor : (dark => dark ? 'rgb(17, 26, 43)' : 'rgb(255, 255, 255)')(document.documentElement.classList.contains('dark'))),
        pills: [...document.querySelectorAll('.tc-stats .tc-pill')].map(x => x.textContent), pillH: Math.max(...[...document.querySelectorAll('.tc-stats .tc-pill')].map(x => x.getBoundingClientRect().height)),
        gap: up ? up.getBoundingClientRect().top - st.bottom : -1, upText: up ? up.textContent : '' }; });
    assert(hd.text === 'Saturday, Oct 24' && hd.fs >= 24 && hd.fw >= 700, `${tag} Today: big bold date "${hd.text}" ${hd.fs}px/${hd.fw}`);
    assert(/^Today · October 2026$/.test(hd.sub) && hd.subFs < hd.fs, `${tag} Today: smaller secondary line "${hd.sub}"`);
    assert(hd.con >= 7, `${tag} Today: date contrast ${hd.con.toFixed(1)}`);
    assert(hd.pills.join('|') === '3 events|1 to-do|1 overdue' && hd.pillH <= 30, `${tag} Today: count pills ${JSON.stringify(hd.pills)}`);
    assert(hd.gap >= 14 && /Up next/i.test(hd.upText), `${tag} Today: ${Math.round(hd.gap)}px of space before Up Next`);
    await p.evaluate(() => window.scrollTo(0, 0)); await p.$eval('#todayCard', e => { e.scrollIntoView({ block: 'start' }); let n = e.parentElement; while (n && !(n.scrollTop > 0)) n = n.parentElement; (n || document.scrollingElement).scrollTop -= 80; window.scrollBy(0, -80); }); await p.waitForTimeout(150);
    await p.screenshot({ path: `${SHOTS}/today_header_${tag}.png` });
  }
  assert(errs.length === 0, 'no page errors ' + errs.join(' | '));
  await b.close();
})().catch(e => { console.error(e.message || e); process.exit(1); });
