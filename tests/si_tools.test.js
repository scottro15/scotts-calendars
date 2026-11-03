// Item 5 (2026-11-02): Sandy Intelligence can set everything the edit box can, on new items and edits, single items and
// series: reminders ("X before" and 2B fixed clock times like 8 PM the night before), repeat on a normal edit, moving a
// series (with its changed dates) to another calendar, to-do scope / priority / category / sub-tasks, a date's own note
// and Notion link, and switching event <-> to-do. Plus the editor's new "At a set time" reminder rows.
// The model is mocked (no AI calls, $0). iPhone, iPad, Android phone + tablet, light + dark.
//   node tests/si_tools.test.js BASE [SHOTS] [device]
const PW = require(process.env.PW || '/usr/local/lib/pnpm/5/.pnpm/playwright-core@1.59.1/node_modules/playwright-core');
const fs = require('fs');
const BASE = process.argv[2] || 'http://127.0.0.1:8870/';
const SHOTS = process.argv[3] || '/workspace/shots-oct29/si-tools'; fs.mkdirSync(SHOTS, { recursive: true });
const only = process.argv[4] || '';
let n = 0; const ok = (c, m) => { if (!c) throw new Error('FAIL: ' + m); n++; console.log('ok -', m); };
const DEV = [['iphone', 'webkit', 393, 852], ['ipad', 'webkit', 820, 1180], ['android-phone', 'chromium', 412, 915], ['android-tablet', 'chromium', 800, 1280]];
const NOW = '2026-11-02T21:00:00Z'; // Mon Nov 2, 3 PM CT
const fixed = (d, m) => { const i = d * 1440 + m; return 60480 + Math.floor(i / 1439) * 1440 + (i % 1439) + 1; };
(async () => {
  const B = {}; const errs = [];
  try {
    for (const [name, eng, w, h] of DEV) for (const dark of [false, true]) {
      if (only && name !== only) continue;
      B[eng] = B[eng] || (eng === 'webkit' ? await PW.webkit.launch() : await PW.chromium.launch({ executablePath: '/usr/bin/google-chrome', args: ['--no-sandbox'] }));
      const tag = `${name}-${dark ? 'dark' : 'light'}`; console.log('#', tag);
      const ctx = await B[eng].newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 2, isMobile: eng === 'chromium', hasTouch: true, serviceWorkers: 'block', timezoneId: 'America/Chicago', colorScheme: dark ? 'dark' : 'light' });
      await ctx.route('**/config.js', r => r.fulfill({ contentType: 'application/javascript', body: "window.CALENDAR_CONFIG = { AI_ENDPOINT: '/__ai/fn' };" }));
      let reply = null; const sent = [];
      await ctx.route('**/__ai/fn', async r => { const body = JSON.parse(r.request().postData()); sent.push(body); await r.fulfill({ contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify(reply(body)) }); });
      await ctx.addInitScript(d => { if (sessionStorage.getItem('__i')) return; sessionStorage.setItem('__i', '1'); localStorage.clear(); localStorage.setItem('sandy.welcome.off', '1'); localStorage.setItem('sandy.tour.off', '1');
        localStorage.setItem('sandy.todoCats.v1', JSON.stringify([{ id: 'cat-home', name: 'Home', color: '#16a34a', sort: 0 }, { id: 'cat-work', name: 'Work', color: '#2563eb', sort: 1 }]));
        if (d) localStorage.setItem('sandy.theme', 'dark'); }, dark);
      const p = await ctx.newPage(); p.on('pageerror', e => { if (!/ResizeObserver loop/.test(e.message)) errs.push(`${tag}: ${e.message}`); });
      await p.clock.install({ time: new Date(NOW) });
      await p.goto(BASE + '?view=listWeek'); await p.waitForFunction(() => window.__app && window.Store && window.SandySeries && window.SandyAI && window.SandyRem);
      await p.evaluate(() => Store.removeWhere(() => true)); await p.reload(); await p.waitForFunction(() => window.SandyAI && window.__app && window.SandyRem);
      const cards = () => p.$$eval('#aiLog .ai-card', e => e.length);
      const ask = async (text, mk, wantCard = true) => {
        reply = mk; const before = await cards(); const nb = sent.length;
        await p.fill('#aiText', text); await p.click('#aiSend');
        await p.waitForFunction(k => !document.querySelector('#aiLog .thinking'), null, { timeout: 8000 });
        if (wantCard) await p.waitForFunction(k => document.querySelectorAll('#aiLog .ai-card').length > k, before, { timeout: 8000 });
        else await p.waitForFunction(k => k, sent.length > nb);
        await p.waitForTimeout(450); return wantCard ? p.$$('#aiLog .ai-card').then(a => a[a.length - 1]) : null;
      };
      const confirm = async card => { await card.$eval('[data-ok]', b => b.click()); await p.waitForFunction(() => /Saved/.test([...document.querySelectorAll('#aiLog .ai-card')].pop().textContent), null, { timeout: 8000 }); await p.waitForTimeout(200); };
      const undoLast = async () => { await p.$$eval('#aiLog .ai-card', a => a[a.length - 1].querySelector('[data-undo]').click()); await p.waitForFunction(() => /Undone/.test([...document.querySelectorAll('#aiLog .ai-card')].pop().textContent), null, { timeout: 8000 }); };
      const dl = card => card.$$eval('dt', ds => ds.map(d => `${d.textContent}: ${d.nextElementSibling.textContent}`));
      const byTitle = t => p.evaluate(t => Store.list().then(l => l.find(e => e.title === t) || null), t);
      const note = (id, d) => p.evaluate(([id, d]) => Store.notes.get(id, d).then(n => n && n.body), [id, d]);
      const link = (id, d) => p.evaluate(([id, d]) => Store.links.get(id, d), [id, d]);
      await p.click('#aiBtn'); await p.waitForSelector('#aiSheet:not([hidden])'); await p.waitForTimeout(400);

      // 1. new to-do with every edit-box field
      let card = await ask('add a to-do for the dentist forms next Tuesday, due that week, top priority, Home, with sub-tasks, remind me 8pm the night before and a day before, note and Notion link', b => {
        ok(JSON.stringify(b.context.todoCategories) === JSON.stringify([{ id: 'cat-home', name: 'Home' }, { id: 'cat-work', name: 'Work' }]), `${tag}: the request carries the to-do categories`);
        { const g = b.context.eventsRange || {}; ok(/^\d{4}-\d{2}-\d{2}$/.test(g.from) && /^\d{4}-\d{2}-\d{2}$/.test(g.to) && Math.round((Date.parse(g.to) - Date.parse(g.from)) / 864e5) === 59 && g.from < b.context.today && g.to > b.context.today, `${tag}: the request says which dates are loaded (${g.from}..${g.to}) so unknown dates are never called free`); }
        return { reply: 'Tap Confirm to save.', proposals: [{ type: 'add', kind: 'task', title: 'QA dentist forms', calendar: 'msc', start: '2026-11-10', allDay: true, scope: 'week', priority: 1, todoCategory: 'Home',
          subtasks: ['Bring insurance card', 'X-ray form'], notes: 'Front desk wants these early', reminders: [{ at: '20:00', daysBefore: 1 }, { before: 1440 }], dayNote: 'Ask about the cleaning', notionUrl: 'https://www.notion.so/QA-dentist-0123abcd', summary: 'Add the QA dentist forms to-do' }] };
      });
      let rows = await dl(card);
      for (const want of ['Type: To-do', 'Reminders: 1 day before, 8:00 PM the night before', 'Due: Any time that week', 'Priority: P1 (highest)', 'To-do category: Home', 'Sub-tasks: Bring insurance card · X-ray form', 'That day’s note: Ask about the cleaning', 'Notion link: www.notion.so/QA-dentist-0123abcd', 'Notes: Front desk wants these early'])
        ok(rows.includes(want), `${tag}: add card shows "${want}"`);
      await p.waitForTimeout(150); await p.screenshot({ path: `${SHOTS}/${tag}-1-add-card.png` });
      await confirm(card);
      let ev = await byTitle('QA dentist forms');
      ok(ev && ev.kind === 'task' && ev.scope === 'week' && ev.priority === 1 && ev.todoCategoryId === 'cat-home', `${tag}: saved as a to-do: week, P1, Home (${ev && [ev.kind, ev.scope, ev.priority, ev.todoCategoryId]})`);
      ok(JSON.stringify(ev.reminders) === JSON.stringify([1440, fixed(1, 1200)]), `${tag}: reminders saved as 1 day + the 8 PM code (${ev.reminders})`);
      ok(/Front desk wants these early\n- \[ \] Bring insurance card\n- \[ \] X-ray form$/.test(ev.notes), `${tag}: sub-tasks saved as checklist lines after the notes`);
      ok(await note(ev.id, '2026-11-10') === 'Ask about the cleaning' && await link(ev.id, '2026-11-10') === 'https://www.notion.so/QA-dentist-0123abcd', `${tag}: that date's note and Notion link saved`);
      const dentist = ev.id;

      // 2. the next request shows it all back; switch it to an event (to-do-only fields go), with new reminders
      card = await ask('make it a 3pm appointment instead, remind me 30 min before and 9am two days before', b => {
        const r = b.context.events.find(e => e.id === dentist) || {};
        ok(JSON.stringify(r.reminders) === JSON.stringify([{ before: 1440 }, { at: '20:00', daysBefore: 1 }]) && r.priority === 1 && r.scope === 'week' && r.todoCategory === 'Home', `${tag}: context: reminders, priority, scope, category (${JSON.stringify(r)})`);
        ok(JSON.stringify(r.subtasks) === JSON.stringify(['Bring insurance card', 'X-ray form']) && r.notes === 'Front desk wants these early' && r.dayNote === 'Ask about the cleaning' && r.notionUrl === 'https://www.notion.so/QA-dentist-0123abcd', `${tag}: context: sub-tasks, notes, day note, link`);
        return { reply: 'Tap Confirm.', proposals: [{ type: 'edit', id: dentist, occurrence: '2026-11-10', changes: { kind: 'event', allDay: false, start: '2026-11-10T15:00', end: '2026-11-10T16:00', reminders: [{ before: 30 }, { at: '9:00 AM', daysBefore: 2 }] }, summary: 'Make the dentist an appointment at 3 PM' }] };
      });
      rows = await dl(card);
      ok(rows.includes('Type: To-do → Event') && rows.includes('Reminders: 30 minutes before, 9:00 AM 2 days before'), `${tag}: switch card: type + reminders (${rows})`);
      await confirm(card);
      ev = await byTitle('QA dentist forms');
      ok(ev.kind === 'event' && !ev.allDay && ev.start === '2026-11-10T15:00' && ev.priority == null && ev.scope === undefined && ev.todoCategoryId == null, `${tag}: now an event at 3 PM, to-do fields cleared`);
      ok(JSON.stringify(ev.reminders) === JSON.stringify([30, fixed(2, 540)]) && /- \[ \] X-ray form/.test(ev.notes), `${tag}: new reminders; sub-tasks kept as the checklist`);
      // a to-do-only field on an event is refused on the card
      card = await ask('give it priority 2', () => ({ reply: 'Tap Confirm.', proposals: [{ type: 'edit', id: dentist, occurrence: '2026-11-10', changes: { priority: 2 }, summary: 'Priority 2' }] }));
      ok(await card.$eval('[data-ok]', b => b.disabled) && /Only to-dos have a priority/.test(await card.innerText()), `${tag}: priority on an event is refused`);
      card = await ask('remind me 7 times', () => ({ reply: 'Tap Confirm.', proposals: [{ type: 'edit', id: dentist, occurrence: '2026-11-10', changes: { reminders: [0, 5, 10, 15, 20, 25, 30] }, summary: '7 reminders' }] }));
      ok(await card.$eval('[data-ok]', b => b.disabled) && /At most 6 reminders/.test(await card.innerText()), `${tag}: a 7th reminder is refused`);
      // switch back to a to-do with sub-tasks replaced
      card = await ask('actually make it a to-do again, month, Work, priority 3, sub-tasks just the x-ray form', () => ({ reply: 'Tap Confirm.', proposals: [{ type: 'edit', id: dentist, occurrence: '2026-11-10', changes: { kind: 'task', scope: 'month', todoCategory: 'cat-work', priority: 3, subtasks: ['X-ray form'] }, summary: 'Back to a to-do' }] }));
      rows = await dl(card);
      ok(rows.includes('Type: Event → To-do') && rows.includes('Due: Any time that month') && rows.includes('To-do category: Work') && rows.includes('Priority: P3') && rows.includes('Sub-tasks: X-ray form'), `${tag}: back-to-to-do card (${rows})`);
      await confirm(card);
      ev = await byTitle('QA dentist forms');
      ok(ev.kind === 'task' && ev.scope === 'month' && ev.todoCategoryId === 'cat-work' && ev.priority === 3 && ev.done === false && /Front desk wants these early\n- \[ \] X-ray form$/.test(ev.notes) && !/insurance/.test(ev.notes), `${tag}: to-do again; sub-tasks replaced, notes kept`);
      await undoLast(); ev = await byTitle('QA dentist forms');
      ok(ev.kind === 'event' && /insurance/.test(ev.notes), `${tag}: Undo puts the event back`);

      // 3. series: new repeating event with a set-time reminder; a changed date; then a series-wide edit
      card = await ask('add QA practice Tuesdays 6-7pm, remind me 8pm the night before', () => ({ reply: 'Tap Confirm.', proposals: [{ type: 'add', title: 'QA practice', calendar: 'msc', start: '2026-11-03T18:00', end: '2026-11-03T19:00', repeat: { freq: 'weekly', byWeekday: [2] }, reminders: [{ at: '20:00', daysBefore: 1 }], summary: 'Add QA practice Tuesdays' }] }));
      await confirm(card);
      let pr = await byTitle('QA practice'); const sid = pr.id;
      ok(JSON.stringify(pr.reminders) === JSON.stringify([fixed(1, 1200)]), `${tag}: series saved with the 8 PM night-before reminder`);
      card = await ask('on the 17th call it QA scrimmage', () => ({ reply: 'Tap Confirm.', proposals: [{ type: 'edit', id: sid, occurrence: '2026-11-17', scope: 'one', changes: { title: 'QA scrimmage' }, summary: 'Rename Nov 17' }] }));
      await confirm(card);
      // a date's note only: the series is not split / detached
      const before = (await p.evaluate(() => Store.list())).length;
      card = await ask('note for the 24th: bring cones', () => ({ reply: 'Tap Confirm.', proposals: [{ type: 'edit', id: sid, occurrence: '2026-11-24', scope: 'one', changes: { dayNote: 'Bring cones', notionUrl: 'https://acme.notion.site/Practice-plan-99' }, summary: 'Note for Nov 24' }] }));
      await confirm(card);
      ok((await p.evaluate(() => Store.list())).length === before && await note(sid, '2026-11-24') === 'Bring cones' && await link(sid, '2026-11-24') === 'https://acme.notion.site/Practice-plan-99', `${tag}: a date's note + link save without detaching that date`);
      // repeat on one date is refused
      card = await ask('make just the 24th every other week', () => ({ reply: 'Tap Confirm.', proposals: [{ type: 'edit', id: sid, occurrence: '2026-11-24', scope: 'one', changes: { repeat: { interval: 2 } }, summary: 'x' }] }));
      ok(await card.$eval('[data-ok]', b => b.disabled) && /only change for the whole series/.test(await card.innerText()), `${tag}: repeat on one date is refused`);
      // whole series: another calendar (changed date too), every other week (days kept), new reminders
      card = await ask('move practice to Mam’s calendar, every other week, remind me an hour before and 9am that morning', b => {
        const r = b.context.events.find(e => e.id === sid && e.occ === '2026-11-24') || {};
        ok(r.dayNote === 'Bring cones' && r.notionUrl === 'https://acme.notion.site/Practice-plan-99' && JSON.stringify(r.reminders) === JSON.stringify([{ at: '20:00', daysBefore: 1 }]), `${tag}: context: the series date's note, link and set-time reminder`);
        return { reply: 'Tap Confirm.', proposals: [{ type: 'edit', id: sid, occurrence: '2026-11-03', scope: 'all', changes: { calendar: 'mam', repeat: { interval: 2 }, reminders: [{ before: 60 }, { at: '09:00', daysBefore: 0 }] }, summary: 'Move QA practice to Mam, every other week' }] };
      });
      rows = await dl(card);
      ok(rows.some(r => /^Move to: /.test(r)) && rows.includes('Repeats: every 2 weeks on Tuesdays') && rows.includes('Changed dates: move too (1)') && rows.includes('Reminders: 1 hour before, 9:00 AM the same day') && rows.includes('Applies to: All repeats'), `${tag}: series card (${rows})`);
      await p.waitForTimeout(150); await p.screenshot({ path: `${SHOTS}/${tag}-2-series-card.png` });
      await confirm(card);
      pr = await p.evaluate(id => Store.get(id), sid); const ex = await byTitle('QA scrimmage');
      ok(pr.calendar === 'mam' && ex && ex.calendar === 'mam' && ex.seriesId === sid, `${tag}: the series and its changed date moved to mam`);
      ok(pr.recurrence.freq === 'weekly' && +pr.recurrence.interval === 2 && JSON.stringify(pr.recurrence.byWeekday) === '[2]' && JSON.stringify(pr.reminders) === JSON.stringify([60, fixed(0, 540)]), `${tag}: every other week, Tuesdays kept, new reminders`);
      await undoLast();
      pr = await p.evaluate(id => Store.get(id), sid);
      ok(pr.calendar === 'msc' && (await byTitle('QA scrimmage')).calendar === 'msc' && +(pr.recurrence.interval || 1) === 1, `${tag}: Undo moves both back`);
      await p.screenshot({ path: `${SHOTS}/${tag}-3-chat.png` });

      // 4. the editor shows set-time reminders and adds them; ✕ animates out
      await p.click('#aiClose').catch(() => p.keyboard.press('Escape')); await p.waitForTimeout(400);
      await p.evaluate(id => __app.openEditor(id, null), dentist); await p.waitForSelector('#eventDialog[open]'); await p.waitForTimeout(350);
      let ed = await p.$$eval('#remList li', l => l.map(li => li.dataset.mode === 'at' ? `at ${li.querySelector('input').value} ${li.querySelector('select').selectedOptions[0].textContent}` : `${li.querySelector('input').value} ${li.querySelector('select').value} before`));
      ok(JSON.stringify(ed) === JSON.stringify(['30 minutes before', 'at 09:00 2 days before']), `${tag}: editor shows both kinds (${ed})`);
      await p.click('#remAddAt'); await p.waitForTimeout(350);
      ed = await p.$$eval('#remList li', l => l.map(li => li.dataset.mode === 'at' ? `at ${li.querySelector('input').value} ${li.querySelector('select').selectedOptions[0].textContent}` : `${li.querySelector('input').value} before`));
      ok(ed[2] === 'at 20:00 the day before', `${tag}: "+ At a set time" adds 8 PM the day before (${ed[2]})`);
      await p.fill('#remList li:nth-child(3) input[type=time]', '19:30');
      await p.$eval('#remDetails, .rem-box', el => el.scrollIntoView({ block: 'center' })).catch(() => {});
      await p.evaluate(() => document.activeElement && document.activeElement.blur()); await p.waitForTimeout(200); await p.screenshot({ path: `${SHOTS}/${tag}-4-editor-reminders.png` });
      // fill to 6: both add buttons hide
      for (let i = 0; i < 3; i++) await p.click('#remAdd');
      ok(await p.$eval('#remAdd', b => b.hidden) && await p.$eval('#remAddAt', b => b.hidden), `${tag}: at 6 reminders both add buttons hide`);
      await p.click('#remList li:nth-child(6) .rem-del');
      ok(await p.$eval('#remList li:nth-child(6)', li => li.classList.contains('rem-out')).catch(() => false) && !(await p.$eval('#remAdd', b => b.hidden)), `${tag}: ✕ plays a leave animation; add is back`);
      await p.waitForFunction(() => document.querySelectorAll('#remList li').length === 5, null, { timeout: 2000 });
      await p.click('#remList li:nth-child(5) .rem-del'); await p.click('#remList li:nth-child(4) .rem-del');
      await p.waitForFunction(() => document.querySelectorAll('#remList li').length === 3, null, { timeout: 2000 });
      await p.click('#eventDialog button[type=submit].primary'); await p.waitForFunction(() => !document.querySelector('#eventDialog[open]'), null, { timeout: 5000 });
      ev = await p.evaluate(id => Store.get(id), dentist);
      ok(JSON.stringify(ev.reminders) === JSON.stringify([30, fixed(1, 19 * 60 + 30), fixed(2, 540)]), `${tag}: editor saved 30 min + 7:30 PM the day before + 9 AM 2 days before (${ev.reminders})`);
      ok(await p.evaluate(c => SandyRem.label(c), fixed(1, 19 * 60 + 30)) === '7:30 PM the night before', `${tag}: label reads "7:30 PM the night before"`);
      await ctx.close();
    }
  } finally { for (const b of Object.values(B)) await b.close(); }
  if (errs.length) { console.log('FAIL page errors\n' + errs.join('\n')); process.exit(1); }
  console.log(`PASS ${n} checks`);
})().catch(e => { console.error(e); process.exit(1); });
