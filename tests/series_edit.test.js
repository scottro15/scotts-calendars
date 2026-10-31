// t166u: Sandy Intelligence edits repeating series in plain words: split from a date ("starting in 2 weeks move my
// Tuesday 6 PM practice to Thursday 7 PM"), several single-date exceptions (skip / retime), and replacing one date
// with a one-off ("remove Maryville practice on Nov 2 and replace it with Maryville Walkthrough at 2pm"). Each is a
// confirm card that previews exactly what changes; wrong dates are caught; Undo puts everything back. Also: the
// editor's "This and following" (save, delete), Today/Home/calendar views, push reminders (server expansion) and
// leave-by validity after the changes. The model is mocked (no AI calls, $0). iPhone, iPad, Android phone + tablet,
// light + dark.   node tests/series_edit.test.js BASE [SHOTS]
const PW = require(process.env.PW || '/usr/local/lib/pnpm/5/.pnpm/playwright-core@1.59.1/node_modules/playwright-core');
const fs = require('fs'), os = require('os'), path = require('path');
const BASE = process.argv[2] || 'http://127.0.0.1:8793/';
const SHOTS = process.argv[3] || '/workspace/shots-oct29/series-edit'; fs.mkdirSync(SHOTS, { recursive: true });
let n = 0; const ok = (c, m) => { if (!c) throw new Error('FAIL: ' + m); n++; console.log('ok -', m); };
const DEV = [['iphone', 'webkit', 393, 852], ['ipad', 'webkit', 820, 1180], ['android-phone', 'chromium', 412, 915], ['android-tablet', 'chromium', 800, 1280]];
const NOW = '2026-10-31T20:00:00Z'; // Sat Oct 31, 3 PM CT
async function seed(p) {
  return p.evaluate(async () => {
    await Store.removeWhere(() => true);
    const m = await Store.save({ calendar: 'mam', kind: 'event', category: 'Other', title: 'Maryville practice', allDay: false, start: '2026-09-07T15:30', end: '2026-09-07T17:30', location: 'Maryville High School', notes: 'Gym B', reminders: [60], recurrence: { freq: 'weekly', interval: 1, byWeekday: [1, 4] } });
    const t = await Store.save({ calendar: 'lifetime', kind: 'event', category: 'Other', title: 'Team practice', allDay: false, start: '2026-09-01T18:00', end: '2026-09-01T19:30', location: 'Rec Center', notes: 'Bring cones', reminders: [30, 1440], recurrence: { freq: 'weekly', interval: 1, byWeekday: [2] } });
    return { m: m.id, t: t.id };
  });
}
const occ = (p, id, a, b) => p.evaluate(([id, a, b]) => { const A = __app; return Store.list().then(l => { const out = []; for (const ev of l) if (ev.id === id || ev.seriesId === id || (id === '*')) for (const o of A.occurrences(ev, A.parseLocal(a), A.parseLocal(b))) out.push(`${o.key} ${A.hm(o.start)} ${ev.title}`); return out.sort(); }); }, [id, a, b]);
(async () => {
  const B = { webkit: await PW.webkit.launch(), chromium: await PW.chromium.launch({ executablePath: '/usr/bin/google-chrome', args: ['--no-sandbox'] }) };
  const errs = []; let dumped = null;
  try {
    for (const [name, eng, w, h] of DEV) for (const dark of [false, true]) {
      const tag = `${name}-${dark ? 'dark' : 'light'}`; console.log('#', tag);
      const ctx = await B[eng].newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 2, isMobile: eng === 'chromium', hasTouch: true, serviceWorkers: 'block', timezoneId: 'America/Chicago', colorScheme: dark ? 'dark' : 'light' });
      await ctx.route('**/config.js', r => r.fulfill({ contentType: 'application/javascript', body: "window.CALENDAR_CONFIG = { AI_ENDPOINT: '/__ai/fn' };" }));
      let reply = null; const sent = [];
      await ctx.route('**/__ai/fn', async r => { const body = JSON.parse(r.request().postData()); sent.push(body); await r.fulfill({ contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify(reply(body)) }); });
      await ctx.addInitScript(d => { if (sessionStorage.getItem('__i')) return; sessionStorage.setItem('__i', '1'); localStorage.clear(); localStorage.setItem('sandy.welcome.off', '1'); localStorage.setItem('sandy.tour.off', '1'); if (d) localStorage.setItem('sandy.theme', 'dark'); }, dark);
      const p = await ctx.newPage(); p.on('pageerror', e => errs.push(`${tag}: ${e.message}`)); p.on('console', m => m.type() === 'error' && console.log('CONSOLE', m.text()));
      await p.clock.install({ time: new Date(NOW) });
      await p.goto(BASE + '?view=listWeek'); await p.waitForFunction(() => window.__app && window.Store && window.SandySeries && window.SandyAI);
      const ids = await seed(p); await p.reload(); await p.waitForFunction(() => window.SandyAI && window.__app);
      const ask = async (text, mk) => {
        reply = mk; const before = await p.$$eval('#aiLog .ai-series-card', e => e.length);
        await p.fill('#aiText', text); await p.click('#aiSend');
        await p.waitForFunction(k => document.querySelectorAll('#aiLog .ai-series-card').length > k, before, { timeout: 8000 }).catch(async e => { console.log('LOG:', await p.$eval('#aiLog', x => x.innerText.slice(-600))); throw e; });
        await p.waitForTimeout(450); return p.$$('#aiLog .ai-series-card').then(a => a[a.length - 1]);
      };
      const dl = card => card.$$eval('dt', ds => ds.map(d => `${d.textContent}: ${d.nextElementSibling.textContent}`));
      await p.click('#aiBtn'); await p.waitForSelector('#aiSheet:not([hidden])'); await p.waitForTimeout(400);

      // ---- 1. replace one date with a one-off ----
      let card = await ask('remove Maryville practice on Nov. 2nd and replace it with Maryville Walkthrough at 2pm. Keep the rest of the series the same', b => {
        ok(b.context.series.some(s => s.id === ids.m && /Mondays|Mon, Thu/.test(s.rule) && s.nextDates.includes('2026-11-02')), `${tag}: SI context lists the series with its rule + next dates`);
        return { reply: 'Here’s the swap for Monday, Nov 2. Tap Confirm to save.', proposals: [{ type: 'series', id: ids.m, action: 'replace', date: '2026-11-02', replacement: { title: 'Maryville Walkthrough', start: '14:00' }, summary: 'Replace Maryville practice on Mon, Nov 2 with Maryville Walkthrough at 2 PM' }] };
      });
      let rows = await dl(card);
      ok(rows.some(r => /^Cancel: Mon, Nov 2, 3:30 PM/.test(r)) && rows.some(r => /^Add instead: Maryville Walkthrough · Mon, Nov 2, 2 PM–4 PM/.test(r)) && rows.some(r => /^Where: Maryville High School/.test(r)) && rows.some(r => /^Rest of the series: unchanged/.test(r)), `${tag}: replace card previews cancel + add + location + rest unchanged (${rows.join(' | ')})`);
      ok(await card.evaluate(e => getComputedStyle(e).animationName !== 'none'), `${tag}: card animates in`);
      await card.scrollIntoViewIfNeeded(); await p.screenshot({ path: `${SHOTS}/${tag}-1-replace-card.png` });
      await (await card.$('[data-ok]')).click(); await card.waitForSelector('[data-undo]');
      let L = await occ(p, ids.m, '2026-11-01', '2026-11-08');
      ok(L.join() === '2026-11-05 15:30 Maryville practice', `${tag}: Nov 2 practice cancelled, Nov 5 unchanged (${L})`);
      let walk = await p.evaluate(() => Store.list().then(l => l.find(e => e.title === 'Maryville Walkthrough')));
      ok(walk && walk.start === '2026-11-02T14:00' && walk.end === '2026-11-02T16:00' && walk.location === 'Maryville High School' && walk.calendar === 'mam' && JSON.stringify(walk.reminders) === '[60]' && walk.recurrence.freq === 'none', `${tag}: one-off Walkthrough 2–4 PM inherits location, calendar, reminders`);
      await p.waitForTimeout(350); await p.screenshot({ path: `${SHOTS}/${tag}-2-replace-saved.png` });
      await (await card.$('[data-undo]')).click(); await card.waitForSelector('.ai-undone');
      L = await occ(p, ids.m, '2026-11-01', '2026-11-08');
      ok(L.join() === '2026-11-02 15:30 Maryville practice,2026-11-05 15:30 Maryville practice' && !(await p.evaluate(() => Store.list().then(l => l.some(e => e.title === 'Maryville Walkthrough')))), `${tag}: Undo restores Nov 2 and removes the Walkthrough`);

      // ---- 2. wrong date: caught, no Confirm ----
      card = await ask('cancel maryville practice on nov 3', () => ({ reply: 'Tap Confirm.', proposals: [{ type: 'series', id: ids.m, action: 'exceptions', items: [{ date: '2026-11-03', skip: true }], summary: 'Skip Maryville practice on Tue, Nov 3' }] }));
      ok(/Tue, Nov 3 isn’t a date for “Maryville practice”\. Nearest dates: .*Mon, Nov 2/.test(await card.$eval('.ai-card-warn', e => e.textContent)) && await card.$eval('[data-ok]', b => b.disabled), `${tag}: a date that isn't in the series is flagged and can't be confirmed`);
      await (await card.$('[data-no]')).click();

      // ---- 3. split from a date ----
      card = await ask('starting in 2 weeks move my Tuesday 6 PM practice to Thursday 7 PM', () => ({ reply: 'From Sat, Nov 14 on, Team practice moves to Thursdays at 7 PM. Earlier Tuesdays stay. Tap Confirm to save.',
        proposals: [{ type: 'series', id: ids.t, action: 'split', from: '2026-11-14', changes: { weekdays: [4], start: '19:00' }, summary: 'Move Team practice to Thursdays 7 PM from Nov 14' }] }));
      rows = await dl(card);
      ok(rows.includes('Series: Team practice · Tuesdays, 6 PM–7:30 PM') && rows.includes('Stays the same: through Tue, Nov 10') && rows.includes('From Thu, Nov 19: Thursdays, 7 PM–8:30 PM') && rows.some(r => /^Next dates: Thu, Nov 19, Thu, Nov 26, Thu, Dec 3/.test(r)) && rows.some(r => /^Kept: calendar, category, location, notes and reminders/.test(r)), `${tag}: split card previews before/after (${rows.join(' | ')})`);
      await card.scrollIntoViewIfNeeded(); await p.screenshot({ path: `${SHOTS}/${tag}-3-split-card.png` });
      await (await card.$('[data-ok]')).click(); await card.waitForSelector('[data-undo]');
      L = await p.evaluate(() => Store.list().then(l => l.filter(e => e.title === 'Team practice').map(e => ({ id: e.id, start: e.start, until: e.recurrence.until || null, wd: e.recurrence.byWeekday, loc: e.location, notes: e.notes, rem: e.reminders, cal: e.calendar }))));
      const oldT = L.find(e => e.id === ids.t), newT = L.find(e => e.id !== ids.t);
      ok(L.length === 2 && oldT.until === '2026-11-13' && newT.start === '2026-11-19T19:00' && JSON.stringify(newT.wd) === '[4]' && newT.loc === 'Rec Center' && newT.notes === 'Bring cones' && JSON.stringify(newT.rem) === '[30,1440]' && newT.cal === 'lifetime', `${tag}: old series ends Nov 13; new Thursday 7 PM series keeps location, notes, reminders, calendar`);
      L = await occ(p, '*', '2026-11-08', '2026-11-28'); L = L.filter(x => /Team practice/.test(x));
      ok(L.join() === '2026-11-10 18:00 Team practice,2026-11-19 19:00 Team practice,2026-11-26 19:00 Team practice', `${tag}: Tue Nov 10 6 PM kept, Tue Nov 17 gone, Thu Nov 19/26 7 PM (${L})`);
      await p.waitForTimeout(350); await p.screenshot({ path: `${SHOTS}/${tag}-4-split-saved.png` });

      // ---- 4. several single dates: skip one, retime two ----
      card = await ask('skip Maryville practice Nov 5, and move just Nov 9 and 12 to 5 PM', () => ({ reply: 'Tap Confirm to save.', proposals: [{ type: 'series', id: ids.m, action: 'exceptions', items: [{ date: '2026-11-05', skip: true }, { date: '2026-11-09', start: '17:00' }, { date: '2026-11-12', start: '17:00' }], summary: 'Skip Nov 5; move Nov 9 and 12 to 5 PM' }] }));
      rows = await dl(card);
      ok(rows.includes('Skip: Thu, Nov 5') && rows.includes('Mon, Nov 9: 5 PM–7 PM') && rows.includes('Thu, Nov 12: 5 PM–7 PM') && rows.includes('Everything else: unchanged'), `${tag}: exceptions card lists each date (${rows.join(' | ')})`);
      await (await card.$('[data-ok]')).click(); await card.waitForSelector('[data-undo]');
      L = await occ(p, ids.m, '2026-11-02', '2026-11-17');
      ok(L.join() === '2026-11-02 15:30 Maryville practice,2026-11-09 17:00 Maryville practice,2026-11-12 17:00 Maryville practice,2026-11-16 15:30 Maryville practice', `${tag}: Nov 5 skipped, Nov 9/12 at 5 PM, the rest unchanged (${L})`);
      ok(await p.evaluate(id => Store.list().then(l => l.filter(e => e.seriesId === id).every(e => JSON.stringify(e.reminders) === '[60]' && e.location === 'Maryville High School')), ids.m), `${tag}: moved dates keep reminders + location`);
      await p.screenshot({ path: `${SHOTS}/${tag}-5-exceptions-saved.png` });
      if (name === 'iphone' && !dark) dumped = await p.evaluate(() => Store.list());
      ok(sent.every(b => !JSON.stringify(b).includes('service_role')), `${tag}: nothing secret sent`);
      await ctx.close();
    }
    // ---- views (Home list, Today) + the editor's "This and following" (iPhone light + Android phone dark) ----
    for (const [name, eng, w, h, dark] of [['iphone', 'webkit', 393, 852, false], ['android-phone', 'chromium', 412, 915, true]]) {
      const tag = `${name}-${dark ? 'dark' : 'light'}`;
      const ctx = await B[eng].newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 2, isMobile: eng === 'chromium', hasTouch: true, serviceWorkers: 'block', timezoneId: 'America/Chicago' });
      await ctx.route('**/config.js', r => r.fulfill({ contentType: 'application/javascript', body: 'window.CALENDAR_CONFIG = {};' }));
      await ctx.addInitScript(d => { if (sessionStorage.getItem('__i')) return; sessionStorage.setItem('__i', '1'); localStorage.clear(); localStorage.setItem('sandy.welcome.off', '1'); localStorage.setItem('sandy.tour.off', '1'); if (d) localStorage.setItem('sandy.theme', 'dark'); }, dark);
      const p = await ctx.newPage(); p.on('pageerror', e => errs.push(`${tag}: ${e.message}`));
      await p.clock.install({ time: new Date('2026-11-02T15:00:00Z') }); // Mon Nov 2, 9 AM CT
      await p.goto(BASE); await p.waitForFunction(() => window.SandySeries && window.__app);
      const ids = await seed(p);
      await p.evaluate(async id => { const all = await Store.list(); const s = all.find(e => e.id === id); await SandySeries.apply(SandySeries.replace(s, '2026-11-02', { title: 'Maryville Walkthrough', start: '14:00' }, all)); }, ids.m);
      await p.goto(BASE + '?view=listWeek&tab=today'); await p.waitForTimeout(1500);
      const txt = await p.evaluate(() => document.getElementById('page-home').innerText);
      ok(/Maryville Walkthrough/.test(txt) && !/Maryville practice/.test(txt.split(/Tomorrow/i)[0]), `${tag}: Today shows the Walkthrough, not the cancelled practice`);
      await p.screenshot({ path: `${SHOTS}/${tag}-6-today-replaced.png` });
      // editor: open Tue Nov 17 Team practice → change time → "This and following"
      await p.evaluate(id => __app.openEditor(id, '2026-11-17'), ids.t); await p.waitForSelector('#eventDialog[open]');
      await p.fill('#eventDialog [name=startTime]', '19:00'); await p.fill('#eventDialog [name=endTime]', '20:30');
      await p.click('#eventDialog button[type=submit]'); await p.waitForSelector('#scopeDialog[open] #scopeFollowing:not([hidden])');
      ok(/Tue, Nov 17 and after; earlier dates stay/.test(await p.textContent('#scopeFollowingSub')), `${tag}: editor offers "This and following events"`);
      await p.waitForTimeout(350); await p.screenshot({ path: `${SHOTS}/${tag}-7-editor-following.png` });
      await p.click('#scopeFollowing'); await p.waitForTimeout(700);
      let L = (await occ(p, '*', '2026-11-09', '2026-11-26')).filter(x => /Team/.test(x));
      ok(L.join() === '2026-11-10 18:00 Team practice,2026-11-17 19:00 Team practice,2026-11-24 19:00 Team practice', `${tag}: editor "this and following" splits the series (${L})`);
      // delete this and following from Dec 1
      const nid = await p.evaluate(() => Store.list().then(l => l.find(e => e.title === 'Team practice' && e.start.startsWith('2026-11-17')).id));
      await p.evaluate(id => __app.openEditor(id, '2026-12-01'), nid); await p.waitForSelector('#eventDialog[open]');
      p.once('dialog', d => d.accept());
      await p.click('#deleteBtn'); await p.waitForSelector('#scopeDialog[open] #scopeFollowing:not([hidden])'); await p.click('#scopeFollowing'); await p.waitForTimeout(700);
      L = (await occ(p, '*', '2026-11-20', '2026-12-20')).filter(x => /Team/.test(x));
      ok(L.join() === '2026-11-24 19:00 Team practice', `${tag}: delete "this and following" ends the series before Dec 1 (${L})`);
      // first occurrence: no "following" (same as all)
      await p.evaluate(id => __app.openEditor(id, '2026-09-01'), ids.t); await p.waitForSelector('#eventDialog[open]');
      await p.fill('#eventDialog [name=startTime]', '18:15'); await p.click('#eventDialog button[type=submit]'); await p.waitForSelector('#scopeDialog[open]');
      ok(await p.isHidden('#scopeFollowing'), `${tag}: first date of a series: no "this and following" (it would be "all")`);
      await p.click('#scopeCancel'); await p.waitForTimeout(300);
      await ctx.close();
    }
    // ---- push reminders + leave-by validity: the server's own expansion (send-reminders) ----
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'srfn-')); const f = path.join(dir, 'fn.mjs');
    fs.writeFileSync(f, fs.readFileSync(path.join(__dirname, '../supabase/functions/send-reminders/index.ts'), 'utf8'));
    const M = await import(f);
    const toRow = ev => ({ id: ev.id, owner_id: 'u', title: ev.title, location: ev.location || '', all_day: !!ev.allDay, is_task: false, start_at: ev.start.replace('T', ' ') + ':00', recur_freq: ev.recurrence.freq, recur_interval: ev.recurrence.interval || 1, recur_until: ev.recurrence.until || null, recur_by_weekday: ev.recurrence.byWeekday || null, exdates: ev.exdates || [], reminders: ev.reminders || [] });
    const rows = dumped.map(toRow); const utc = s => Date.parse(s);
    const at = (iso) => M.dueReminders(rows, () => 'America/Chicago', utc(iso)).map(x => `${x.row.title}@${x.occ}-${x.minutes}`);
    ok(at('2026-11-05T20:30:00Z').length === 0, 'push: no reminder for the skipped Nov 5 practice (would be 2:30 PM CT)');
    ok(at('2026-11-09T22:00:00Z').includes('Maryville practice@2026-11-09-60') && !at('2026-11-09T20:30:00Z').some(x => /Maryville/.test(x)), 'push: moved Nov 9 reminder at 4 PM CT (5 PM − 1 h), none at the old 2:30 PM');
    ok(at('2026-11-18T00:30:00Z').length === 0 && at('2026-11-20T00:30:00Z').includes('Team practice@2026-11-19-30'), 'push: no Tue Nov 17 Team reminder after the split; Thu Nov 19 6:30 PM CT reminder fires');
    ok(at('2026-11-10T23:30:00Z').includes('Team practice@2026-11-10-30'), 'push: Tue Nov 10 (before the split) still reminds');
    const series = rows.find(r => r.title === 'Maryville practice' && r.recur_freq !== 'none');
    ok(!M.planStillValid({ owner_id: 'u', location: 'Maryville High School', event_start: '2026-11-05 15:30', occurrence_date: '2026-11-05' }, series), 'leave-by: a plan for the skipped date is dropped');
    const real = errs.filter(e => !/ResizeObserver loop/.test(e)); ok(real.length === 0, 'no page errors ' + real.join(' | '));
  } finally { await B.webkit.close(); await B.chromium.close(); }
  console.log(`SERIES EDIT TEST PASSED (${n} checks)`);
})().catch(e => { console.error(e.message || e); process.exit(1); });
