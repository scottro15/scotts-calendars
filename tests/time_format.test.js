// Browser test (Scott 2026-10-26): Profile → Appearance → Time format: Auto (phone setting) / 12-hour / 24-hour.
// Every time the app formats follows it: Heads Up ranges, Today (leave-by, travel plan), List / Day / Week / Month
// (event times + slot labels), To-Do quick-add chips / preview / rows, Search, the editor's all-day reminder hint.
// Auto = the phone's clock (Intl hourCycle): en-US → 12-hour, en-GB → 24-hour. Live switch without reload.
// Also: "1430" typed in To-Do quick add → 2:30 PM. Light + dark × 12h + 24h at 390x844. Fake home address only.
//   node tests/time_format.test.js http://127.0.0.1:8787/ [screenshotDir]
const { chromium } = require(process.env.PW || '/workspace/shot-tools/node_modules/playwright-core');
const BASE = process.argv[2] || 'http://127.0.0.1:8787/'; const SHOTS = process.argv[3] || '/workspace/shots-24h';
require('fs').mkdirSync(SHOTS, { recursive: true });
let n = 0; const assert = (c, m) => { if (!c) throw new Error('FAIL: ' + m); n++; console.log('ok -', m); };
const AMPM = /\d{1,2}(:\d{2})?\s?(AM|PM|am|pm|a|p)\b/;
const HOMEC = [38.60, -90.80], LINC = [38.57, -92.17], ELSAH = [38.95, -90.36];
const AWAY_LOC = 'Marquette High School, 2351 Clarkson Rd, Chesterfield, MO 63017';
const NEU_LOC = 'Alton High School, 4200 Humbert Rd, Alton, IL 62002';
const CONTRAST = `(() => {
  const parse = s => { let m = s.match(/color\\(srgb ([\\d.]+) ([\\d.]+) ([\\d.]+)/); if (m) return [+m[1] * 255, +m[2] * 255, +m[3] * 255];
    m = s.match(/rgba?\\(([\\d.]+),? ([\\d.]+),? ([\\d.]+)/); return m ? [+m[1], +m[2], +m[3]] : null; };
  const lum = c => { const f = v => { v /= 255; return v <= .03928 ? v / 12.92 : Math.pow((v + .055) / 1.055, 2.4); }; return .2126 * f(c[0]) + .7152 * f(c[1]) + .0722 * f(c[2]); };
  window.__contrast = (fg, bg) => { const a = lum(parse(fg)), b = lum(parse(bg)); return (Math.max(a, b) + .05) / (Math.min(a, b) + .05); };
})()`;
(async () => {
  const b = await chromium.launch({ executablePath: '/usr/bin/google-chrome', headless: true, args: ['--no-sandbox'] });
  async function open({ dark, fmt, locale = 'en-US' }) {
    const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, timezoneId: 'America/Chicago', locale, isMobile: true, hasTouch: true, deviceScaleFactor: 2, reducedMotion: 'reduce' });
    await ctx.addInitScript(([dark, fmt]) => { if (!sessionStorage.getItem('__init')) { sessionStorage.setItem('__init', '1'); localStorage.clear(); localStorage.setItem('sandy.theme', dark ? 'dark' : 'light'); if (fmt) localStorage.setItem('sandy.timeFormat', fmt); } }, [dark, fmt]);
    await ctx.route('https://photon.komoot.io/**', r => { const q = (new URL(r.request().url()).searchParams.get('q') || '').toLowerCase();
      const c = q.includes('test home') ? HOMEC : q.includes('marquette') ? LINC : q.includes('alton') ? ELSAH : null;
      r.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify({ features: c ? [{ geometry: { coordinates: [c[1], c[0]] }, properties: {} }] : [] }) }); });
    await ctx.route('https://nominatim.openstreetmap.org/**', r => r.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: '[]' }));
    await ctx.route('https://valhalla1.openstreetmap.de/**', r => { const j = JSON.parse(new URL(r.request().url()).searchParams.get('json')); const d = j.locations[1];
      const mins = Math.abs(d.lat - LINC[0]) < 2e-3 ? 100 : 70;
      r.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify({ trip: { summary: { time: mins * 60, length: mins * 0.95 } } }) }); });
    await ctx.route('https://router.project-osrm.org/**', r => r.fulfill({ status: 500, body: 'x' }));
    await ctx.route('https://api.open-meteo.com/**', r => { const date = new URL(r.request().url()).searchParams.get('start_date'); const time = Array.from({ length: 24 }, (_, h) => `${date}T${String(h).padStart(2, '0')}:00`);
      r.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify({ hourly: { time, temperature_2m: time.map((_, h) => 30 + h), precipitation_probability: time.map(() => 10), weather_code: time.map(() => 1), wind_speed_10m: time.map(() => 5) } }) }); });
    const p = await ctx.newPage(); const errs = []; p.on('pageerror', e => errs.push(e.message));
    await p.clock.install({ time: new Date('2026-11-19T15:00:00Z') }); // Thu Nov 19 2026, 9:00 AM CT
    await p.goto(BASE); await p.waitForFunction(() => window.__app && window.__app.Store && window.SandyTime && window.SandyNav && window.SandyLeave && window.SandyTravel);
    await p.evaluate(CONTRAST);
    await p.evaluate(async ([AWAY_LOC, NEU_LOC]) => {
      const S = window.__app.Store; await S.removeWhere(() => true);
      const ev = o => ({ id: crypto.randomUUID(), kind: 'event', allDay: false, recurrence: { freq: 'none' }, calendar: 'mam', location: '', notes: '', ...o });
      await S.save(ev({ title: 'Team sync', start: '2026-11-19T14:30', end: '2026-11-19T15:30', location: NEU_LOC }));
      await S.save(ev({ title: 'Late lift', start: '2026-11-19T21:00', end: '2026-11-19T22:15' }));
      await S.save(ev({ title: 'Jennings @ Marquette - AWAY', category: 'Game – Jennings High School', start: '2026-11-20T19:00', end: '2026-11-20T21:00', location: AWAY_LOC, notes: 'Jennings High School boys varsity basketball 2026-27' }));
      await S.save(ev({ title: 'Pay invoice', kind: 'task', start: '2026-11-19T16:00', end: '2026-11-19T16:00' }));
      await window.SandyLeave.setHome('1 Test Home Rd, Testville, MO 63000');
      window.__app.refresh();
    }, [AWAY_LOC, NEU_LOC]);
    await p.waitForTimeout(500);
    return { ctx, p, errs };
  }
  const T = fmt24 => (h, m) => fmt24 ? `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}` : `${h % 12 || 12}:${String(m).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`;
  const settle = async p => { await p.waitForFunction(() => ![...document.querySelectorAll('[data-state=pending]')].length, null, { timeout: 8000 }).catch(() => {}); await p.waitForTimeout(300); };

  for (const dark of [false, true]) for (const fmt of ['12', '24']) {
    const tag = `${dark ? 'dark' : 'light'} ${fmt}h`, f = `${dark ? 'dark' : 'light'}_${fmt}h`, is24 = fmt === '24', t = T(is24);
    const { ctx, p, errs } = await open({ dark, fmt });
    assert(await p.evaluate(() => SandyTime.pref()) === fmt && await p.evaluate(() => SandyTime.is24()) === is24, `${tag}: SandyTime pref ${fmt}`);
    // ---- Profile setting
    await p.evaluate(() => SandyNav.go('profile')); await p.waitForTimeout(400);
    const sel = await p.$eval('#timeFormat', s => ({ v: s.value, opts: [...s.options].map(o => o.textContent), note: document.getElementById('timeFmtNote').textContent }));
    assert(sel.v === fmt && sel.opts.join('|') === 'Auto (phone setting)|12-hour (2:30 PM)|24-hour (14:30)', `${tag}: Profile → Time format shows ${fmt}-hour (${sel.opts.join(' / ')})`);
    assert(/now 12-hour/.test(sel.note), `${tag}: Auto note says the phone is on 12-hour (en-US): ${sel.note}`);
    const cr = await p.evaluate(() => { const s = document.getElementById('timeFormat'), l = s.closest('.pf-row'); let bg = 'rgba(0, 0, 0, 0)', e = s;
      while (e && /rgba\(0, 0, 0, 0\)|transparent/.test(bg)) { bg = getComputedStyle(e).backgroundColor; e = e.parentElement; }
      let bg2 = 'rgba(0, 0, 0, 0)'; e = l; while (e && /rgba\(0, 0, 0, 0\)|transparent/.test(bg2)) { bg2 = getComputedStyle(e).backgroundColor; e = e.parentElement; }
      return [__contrast(getComputedStyle(s).color, bg), __contrast(getComputedStyle(l.querySelector('.pf-lbl')).color, bg2), __contrast(getComputedStyle(l.querySelector('.pf-note')).color, bg2)]; });
    assert(cr.every(x => x >= 4.5), `${tag}: Time format select / label / note contrast >= 4.5 (${cr.map(x => x.toFixed(2)).join(', ')})`);
    await p.locator('#appearanceSection').scrollIntoViewIfNeeded(); await p.screenshot({ path: `${SHOTS}/${f}_1_profile.png` });
    // ---- Home: Heads Up ranges
    await p.evaluate(() => SandyNav.go('home')); await p.waitForTimeout(300);
    await p.evaluate(() => window.__app.calendar.changeView('listWeek', '2026-11-19')); await p.waitForTimeout(500);
    const brief = await p.$eval('#briefing', e => e.innerText);
    assert(brief.includes(`${t(14, 30)} – ${t(15, 30)}`) && brief.includes(`${t(21, 0)} – ${t(22, 15)}`), `${tag}: Heads Up ranges ${t(14, 30)} – ${t(15, 30)}, ${t(21, 0)} – ${t(22, 15)}`);
    if (is24) assert(!AMPM.test(brief), `${tag}: no AM/PM anywhere in Heads Up`);
    // ---- List / Day / Week / Month
    const lt = await p.$$eval('.fc-list-event-time', es => es.map(e => e.textContent));
    assert(lt.includes(is24 ? '14:30 - 15:30' : '2:30pm - 3:30pm') && lt.includes(is24 ? '21:00 - 22:15' : '9:00pm - 10:15pm'), `${tag}: List times ${JSON.stringify(lt.slice(0, 3))}`);
    await p.screenshot({ path: `${SHOTS}/${f}_2_list.png` });
    await p.evaluate(() => window.__app.calendar.changeView('timeGridDay', '2026-11-19')); await p.waitForTimeout(500);
    const day = await p.evaluate(() => ({ slots: [...document.querySelectorAll('.fc-timegrid-slot-label-cushion')].map(e => e.textContent).filter(Boolean).slice(0, 3), ev: [...document.querySelectorAll('.fc-event-time')].map(e => e.textContent) }));
    assert(day.slots.join('|') === (is24 ? '05:00|06:00|07:00' : '5am|6am|7am'), `${tag}: Day slot labels ${day.slots.join(' ')}`);
    assert(day.ev.includes(is24 ? '14:30 - 15:30' : '2:30pm - 3:30pm'), `${tag}: Day event time ${JSON.stringify(day.ev)}`);
    await p.evaluate(() => document.querySelector('.fc-timegrid-slot[data-time="13:00:00"]').scrollIntoView({ block: 'center' })); await p.screenshot({ path: `${SHOTS}/${f}_3_day.png` });
    await p.evaluate(() => window.__app.calendar.changeView('timeGridWeek', '2026-11-19')); await p.waitForTimeout(500);
    const wk = await p.$$eval('.fc-timegrid-slot-label-cushion', es => es.map(e => e.textContent).filter(Boolean).slice(0, 2));
    assert(wk.join('|') === (is24 ? '05:00|06:00' : '5am|6am'), `${tag}: Week slot labels ${wk.join(' ')}`);
    await p.evaluate(() => window.__app.calendar.changeView('dayGridMonth', '2026-11-19')); await p.waitForTimeout(500);
    const mo = await p.$$eval('.fc-daygrid-event .fc-event-time', es => es.map(e => e.textContent));
    assert(mo.length && mo.every(x => is24Check(x)), `${tag}: Month event times ${JSON.stringify(mo)}`);
    function is24Check(x) { return is24 ? /^\d{2}:\d{2}$/.test(x) : /^\d{1,2}(:\d{2})?[ap]/.test(x); }
    // ---- Today: leave-by + travel plan
    await p.evaluate(() => { window.SandyNav.go('today'); window.SandyNav.renderToday(); }); await settle(p);
    const today = await p.evaluate(() => ({ text: document.getElementById('todayCard').innerText, lb: [...document.querySelectorAll('.lb-row')].map(r => r.dataset.leave || ''), tv: [...document.querySelectorAll('.tc-travel .tv-leave')].map(r => r.dataset.leave || '') }));
    assert(today.lb.includes(t(13, 10)), `${tag}: leave-by for 14:30 Team sync (70 min + 10) = ${t(13, 10)} (${JSON.stringify(today.lb)})`);
    assert(today.tv.includes(t(16, 20)), `${tag}: travel plan leave for tomorrow's 7 PM away game = ${t(16, 20)} (${JSON.stringify(today.tv)})`);
    assert(today.text.includes(t(14, 30)), `${tag}: Today lists ${t(14, 30)}`);
    if (is24) { const bad = (today.text.match(new RegExp(AMPM.source, 'g')) || []).filter(x => /\d:\d\d/.test(x)); assert(!bad.length, `${tag}: no H:MM AM/PM left on Today (${JSON.stringify(bad)})`); }
    await p.evaluate(() => { SandyNav.go('home'); }); await p.waitForTimeout(300); await p.evaluate(() => { SandyNav.go('today'); SandyNav.renderToday(); }); await settle(p);
    await p.evaluate(() => { const r = document.querySelector('.lb-row') || document.getElementById('todayCard'); r.scrollIntoView({ block: 'center' }); }); await p.waitForTimeout(200);
    await p.screenshot({ path: `${SHOTS}/${f}_4_today.png` });
    await p.evaluate(() => { const r = document.querySelector('.tc-travel'); if (r) r.scrollIntoView({ block: 'center' }); }); await p.waitForTimeout(200);
    await p.screenshot({ path: `${SHOTS}/${f}_4b_travel.png` });
    // ---- To-Do quick add with military time
    await p.evaluate(() => SandyNav.go('todo')); await p.waitForTimeout(300);
    await p.click('#qaText'); await p.keyboard.type('call mom 1430', { delay: 15 }); await p.waitForTimeout(300);
    const chips = await p.$$eval('#qaHl .qa-chip', es => es.map(e => e.textContent));
    const pv = (await p.textContent('#qaPreview')).replace(/\s+/g, ' ');
    assert(chips.join('|') === '1430', `${tag}: "1430" is a time chip (${JSON.stringify(chips)})`);
    assert(pv.includes(is24 ? '14:30' : '2:30 PM') && /call mom/i.test(pv), `${tag}: preview "${pv.trim()}"`);
    await p.screenshot({ path: `${SHOTS}/${f}_5_todo_chip.png` });
    await p.keyboard.press('Enter'); await p.waitForTimeout(500);
    const saved = await p.evaluate(async () => (await window.__app.Store.list()).find(e => e.kind === 'task' && e.title.toLowerCase() === "call mom"));
    assert(saved && saved.start === '2026-11-19T14:30' && !saved.allDay, `${tag}: to-do saved at 2026-11-19T14:30`);
    const rows = (await p.$eval('#todoList', e => e.innerText)).replace(/\s+/g, ' ');
    assert(rows.includes(t(14, 30)) && rows.includes(t(16, 0)), `${tag}: To-Do rows show ${t(14, 30)} and ${t(16, 0)}`);
    if (is24) assert(!/\d:\d\d ?[AP]M/.test(rows), `${tag}: no AM/PM in To-Do rows`);
    await p.screenshot({ path: `${SHOTS}/${f}_6_todo_rows.png` });
    // "+" sheet (quicksheet.js) shares the same parse + formatter
    const qs = await p.evaluate(() => ({ chip: SandyNav.fmtTime('14:30'), p: SandyNav.parseQuick ? SandyNav.parseQuick('lift 0730 tomorrow').time : null }));
    assert(qs.chip === (is24 ? '14:30' : '2:30 PM') && (qs.p === null || qs.p === '07:30'), `${tag}: + sheet chip format ${qs.chip}, "0730" → ${qs.p}`);
    // ---- Search
    await p.evaluate(() => SandyNav.go('search')); await p.waitForTimeout(300);
    await p.fill('#searchBox', 'late lift'); await p.waitForTimeout(600);
    const sr = (await p.$eval('#searchResults', e => e.innerText)).replace(/\s+/g, ' ');
    assert(sr.includes(t(21, 0)), `${tag}: Search result shows ${t(21, 0)}: ${sr.slice(0, 120)}`);
    await p.screenshot({ path: `${SHOTS}/${f}_7_search.png` });
    // ---- editor's all-day reminder hint
    const hint = await p.$eval('#remHint [data-sandy-time]', e => e.textContent);
    assert(hint === (is24 ? '09:00' : '9:00 AM'), `${tag}: editor all-day reminder hint "${hint}"`);
    // ---- live switch from Profile (no reload)
    await p.evaluate(() => SandyNav.go('profile')); await p.waitForTimeout(300);
    await p.selectOption('#timeFormat', is24 ? '12' : '24'); await p.waitForTimeout(500);
    assert(await p.evaluate(() => localStorage.getItem('sandy.timeFormat')) === (is24 ? '12' : '24'), `${tag}: switching saves to localStorage`);
    await p.evaluate(() => { SandyNav.go('home'); window.__app.calendar.changeView('listWeek', '2026-11-19'); }); await p.waitForTimeout(600);
    const lt2 = await p.$$eval('.fc-list-event-time', es => es.map(e => e.textContent));
    const b2 = await p.$eval('#briefing', e => e.innerText);
    assert(lt2.includes(is24 ? '2:30pm - 3:30pm' : '14:30 - 15:30') && b2.includes(T(!is24)(14, 30)), `${tag}: live switch → ${is24 ? '12' : '24'}-hour in List + Heads Up`);
    await p.evaluate(() => window.__app.calendar.changeView('timeGridDay', '2026-11-19')); await p.waitForTimeout(500);
    const sl3 = await p.$$eval('.fc-timegrid-slot-label-cushion', es => es.map(e => e.textContent).filter(Boolean).slice(0, 2));
    const frames = await p.$$eval('#calendar .fc-timegrid-slot-label .fc-scrollgrid-shrink-frame', es => es.length);
    assert(sl3.join('|') === (is24 ? '5am|6am' : '05:00|06:00') && frames > 10, `${tag}: live switch → Day slot labels ${sl3.join(' ')} (FullCalendar slot frames intact: ${frames})`);
    assert(errs.length === 0, `${tag}: no page errors` + (errs.length ? ': ' + errs.join(' | ') : ''));
    await ctx.close();
  }
  // ---- Auto follows the phone: en-GB (24-hour clock) vs en-US
  for (const [locale, want] of [['en-GB', true], ['en-US', false]]) {
    const { ctx, p, errs } = await open({ dark: false, fmt: null, locale });
    const r = await p.evaluate(() => ({ pref: SandyTime.pref(), is24: SandyTime.is24(), s: SandyTime.fmtHM('14:30') }));
    assert(r.pref === 'auto' && r.is24 === want && r.s === (want ? '14:30' : '2:30 PM'), `Auto in ${locale}: ${r.s}`);
    await p.evaluate(() => SandyNav.go('home')); await p.waitForTimeout(300);
    const brief = await p.$eval('#briefing', e => e.innerText);
    assert(brief.includes(T(want)(14, 30)), `Auto in ${locale}: Heads Up shows ${T(want)(14, 30)}`);
    await p.evaluate(() => SandyNav.go('profile')); await p.waitForTimeout(300);
    const note = await p.textContent('#timeFmtNote');
    assert(note.includes(want ? '24-hour' : '12-hour') && await p.$eval('#timeFormat', s => s.value) === 'auto', `Auto in ${locale}: Profile says "${note}"`);
    if (locale === 'en-GB') { await p.locator('#appearanceSection').scrollIntoViewIfNeeded(); await p.screenshot({ path: `${SHOTS}/auto_enGB_profile.png` }); }
    assert(errs.length === 0, `Auto ${locale}: no page errors`);
    await ctx.close();
  }
  await b.close(); console.log(`\n${n} checks passed`);
})().catch(e => { console.error(e.message || e); process.exit(1); });
