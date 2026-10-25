// Browser test (Scott 2026-10-25, fab): To-Do "+" FAB + Todoist-style quick-add sheet. 390x844, light + dark, local mode.
// Covers: FAB only on To-Do; 56px round red with white "+"; bottom-right ABOVE the floating nav (full and shrunk) and
// clear of it; press scale; tap -> sheet slides up with Task name focused synchronously in the tap; inline chips
// (date/time/category/priority) + Date/Priority/Category chips; send disabled until text; Enter saves through the shared
// save path (dated -> scheduled to-do with the right date/time/category/priority/description; undated -> Inbox) and keeps
// the sheet open for rapid entry; Date/Reminders/Inbox selectors; note mode; dismiss by backdrop, Escape, swipe down;
// sits on top of the keyboard (visualViewport); contrast of sheet text; reduced motion; no page errors.
//   node tests/todo_fab.test.js http://127.0.0.1:8787/ [shotsDir] [videoDir]
const { chromium } = require(process.env.PW || '/workspace/shot-tools/node_modules/playwright-core');
const fs = require('fs');
const BASE = process.argv[2] || 'http://127.0.0.1:8787/'; const SHOTS = process.argv[3] || '/workspace/shots-fab'; const VIDEO = process.argv[4] || '';
fs.mkdirSync(SHOTS, { recursive: true });
let n = 0; const assert = (c, m) => { if (!c) throw new Error('FAIL: ' + m); n++; console.log('ok -', m); };
const SEED = async () => {
  const S = window.__app.Store; await S.removeWhere(() => true);
  const d0 = window.__app.ymd(window.__app.nowWall());
  for (let t = 0; t < 14; t++) await S.save({ id: crypto.randomUUID(), kind: 'task', calendar: ['msc', 'mam', 'lifetime'][t % 3], title: 'To-do item number ' + (t + 1), category: 'Task / to-do', allDay: true, start: d0, end: d0, scope: 'day', recurrence: { freq: 'none', interval: 1 }, location: '', notes: '' });
  await window.SandyNav.Cats.save({ id: 'cat-errands', name: 'Errands', color: '#10b981', sort: 0, createdAt: new Date().toISOString() });
  window.__app.refresh();
};
const CONTRAST = `window.__cr = (fg, bg) => { const P = s => s.match(/[\\d.]+/g).map(Number); const L = c => { const f = v => { v /= 255; return v <= .03928 ? v / 12.92 : Math.pow((v + .055) / 1.055, 2.4); }; return .2126 * f(c[0]) + .7152 * f(c[1]) + .0722 * f(c[2]); }; const a = L(P(fg)), b = L(P(bg)); return (Math.max(a, b) + .05) / (Math.min(a, b) + .05); };`;
(async () => {
  const b = await chromium.launch({ executablePath: '/usr/bin/google-chrome', headless: true, args: ['--no-sandbox'] });
  async function open({ dark = false, reduced = false, video = '' } = {}) {
    const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, timezoneId: 'America/Chicago', locale: 'en-US', isMobile: true, hasTouch: true, deviceScaleFactor: 2,
      reducedMotion: reduced ? 'reduce' : 'no-preference', colorScheme: dark ? 'dark' : 'light', ...(video ? { recordVideo: { dir: video, size: { width: 390, height: 844 } } } : {}) });
    const p = await ctx.newPage(); const errs = []; p.on('pageerror', e => errs.push(e.message));
    await p.clock.install({ time: new Date('2026-11-18T16:00:00Z') }); // Wed Nov 18, 10 AM CT
    await p.goto(BASE); await p.waitForFunction(() => window.__app && window.__app.Store);
    await p.evaluate(() => { localStorage.clear(); sessionStorage.clear(); }); await p.goto(BASE);
    await p.waitForFunction(() => window.__app && window.__app.Store && window.SandyNav && window.SandyNavBar && window.SandyQuickSheet);
    await p.evaluate(SEED); await p.evaluate(d => window.SandyNav.setDark(d), dark); await p.evaluate(CONTRAST); await p.waitForTimeout(400);
    return { ctx, p, errs };
  }
  const go = async (p, t) => { await p.click(`#bottomNav [data-tab=${t}]`); await p.waitForTimeout(500); };
  const geo = p => p.evaluate(() => { const f = document.getElementById('todoFab'); const r = f.getBoundingClientRect(); const nb = document.getElementById('bottomNav').getBoundingClientRect(); const cs = getComputedStyle(f);
    return { vis: cs.display !== 'none' && r.width > 0, l: r.left, r: r.right, t: r.top, b: r.bottom, w: r.width, h: r.height, navTop: nb.top, navR: nb.right, radius: cs.borderRadius, bg: cs.backgroundColor, color: cs.color, shadow: cs.boxShadow, vw: innerWidth }; });
  const sheet = p => p.evaluate(() => { const s = document.getElementById('qsSheet'); const r = s.getBoundingClientRect(); return { open: window.SandyQuickSheet.isOpen, hidden: s.hidden, top: r.top, bottom: r.bottom, h: r.height, active: document.activeElement && document.activeElement.id, send: document.getElementById('qsSend').disabled, bd: !document.getElementById('qsBackdrop').hidden && +getComputedStyle(document.getElementById('qsBackdrop')).opacity }; });
  const typeIn = async (p, txt) => { await p.evaluate(() => { const t = document.getElementById('qsText'); t.focus(); t.value = ''; t.dispatchEvent(new Event('input')); }); await p.keyboard.type(txt, { delay: 4 }); await p.waitForTimeout(150); };
  const events = p => p.evaluate(async () => (await window.__app.Store.list()).filter(e => e.kind === 'task' && !/^To-do item number/.test(e.title)).map(e => ({ title: e.title, start: e.start, allDay: e.allDay, cat: e.todoCategoryId, pri: e.priority || null, notes: e.notes, rem: e.reminders, cal: e.calendar })));
  const inbox = p => p.evaluate(async () => (await window.SandyNav.Inbox.list()).map(i => ({ body: i.body, kind: i.kind, cal: i.calendar, cat: i.categoryId, pri: i.priority || null })));

  for (const dark of [false, true]) {
    const tag = dark ? 'dark' : 'light';
    const { ctx, p, errs } = await open({ dark });
    // ---- only on To-Do
    for (const t of ['home', 'today', 'search', 'profile']) { await go(p, t); assert(!(await geo(p)).vis, `${tag}: no FAB on ${t}`); }
    await go(p, 'todo');
    let g = await geo(p);
    assert(g.vis && Math.abs(g.w - 56) < 1 && Math.abs(g.h - 56) < 1 && parseFloat(g.radius) >= 28, `${tag}: FAB is a 56px circle (${g.w}x${g.h}, radius ${g.radius})`);
    assert(/rgb\(220, 76, 62\)/.test(g.bg) && /rgb\(255, 255, 255\)/.test(g.color) && g.shadow !== 'none', `${tag}: Todoist red FAB, white +, soft shadow (${g.bg})`);
    assert(g.vw - g.r >= 16 && g.vw - g.r <= 24, `${tag}: FAB bottom-right (${(g.vw - g.r).toFixed(0)}px from the right edge)`);
    assert(g.b <= g.navTop - 12, `${tag}: FAB sits above the full nav capsule (gap ${(g.navTop - g.b).toFixed(1)}px)`);
    await p.screenshot({ path: `${SHOTS}/fab_todo_${tag}.png` });
    // nav shrinks
    await p.evaluate(() => window.SandyNavBar.set(true)); await p.waitForTimeout(450);
    const g2 = await geo(p);
    assert(g2.b <= g2.navTop - 12 && g2.t > g.t, `${tag}: still clear when the nav shrinks (gap ${(g2.navTop - g2.b).toFixed(1)}px, settled ${(g2.t - g.t).toFixed(0)}px lower)`);
    await p.screenshot({ path: `${SHOTS}/fab_todo_navshrunk_${tag}.png` });
    await p.evaluate(() => window.SandyNavBar.set(false)); await p.waitForTimeout(450);
    // last row can scroll clear of the FAB
    const clear = await p.evaluate(() => { window.scrollTo(0, 1e6); const rows = document.querySelectorAll('#todoList .todo-row'); const r = rows[rows.length - 1].getBoundingClientRect(); return r.bottom <= document.getElementById('todoFab').getBoundingClientRect().top + 1; });
    assert(clear, `${tag}: the last to-do row scrolls clear of the FAB`);
    await p.evaluate(() => window.scrollTo(0, 0));
    // ---- press scale
    const fb = await p.$('#todoFab'); const bx = await fb.boundingBox();
    await p.mouse.move(bx.x + 28, bx.y + 28); await p.mouse.down(); await p.waitForTimeout(400);
    const sc = await p.evaluate(() => new DOMMatrix(getComputedStyle(document.getElementById('todoFab')).transform).m11);
    assert(sc < 0.95, `${tag}: subtle press scale on the FAB (${sc.toFixed(2)})`);
    await p.mouse.up(); await p.waitForTimeout(80);
    // ---- open: focus synchronously inside the tap handler (iOS keyboard)
    const syncFocus = await p.evaluate(() => { const s = window.SandyQuickSheet; if (s.isOpen) s.close(); return null; });
    await p.waitForTimeout(350);
    const f0 = await p.evaluate(() => { document.getElementById('todoFab').click(); return document.activeElement && document.activeElement.id; });
    assert(f0 === 'qsText', `${tag}: tapping + focuses "Task name" synchronously in the tap handler (${f0})`);
    let s = await sheet(p);
    assert(s.open && !s.hidden && s.send, `${tag}: sheet opens, send disabled while empty`);
    const mid = await p.evaluate(() => new DOMMatrix(getComputedStyle(document.getElementById('qsSheet')).transform).m42);
    await p.waitForTimeout(400); s = await sheet(p);
    assert(mid > 5 && Math.abs(s.bottom - 844) < 1 && s.bd > 0.9, `${tag}: sheet slides up from the bottom (mid ${mid.toFixed(0)}px), dimmed backdrop`);
    assert(await p.evaluate(() => getComputedStyle(document.getElementById('todoFab')).opacity === '0'), `${tag}: FAB tucks away under the open sheet`);
    const ph = await p.evaluate(() => ['qsText', 'qsDesc'].map(id => document.getElementById(id).placeholder));
    assert(ph[0] === 'Task name' && ph[1] === 'Description', `${tag}: Task name + Description inputs`);
    const labels = await p.evaluate(() => [...document.querySelectorAll('.qs-chips .qs-chip:not([hidden])')].map(c => c.textContent.trim().replace(/\s+/g, ' ')));
    assert(/^Date/.test(labels[0]) && /^Priority/.test(labels[1]) && /^Category/.test(labels[2]) && /^Reminders/.test(labels[3]) && labels[4].includes('•••'), `${tag}: chip row Date / Priority / Category / Reminders / … (${labels.map(l => l.slice(0, 12)).join(' | ')})`);
    assert(await p.evaluate(() => document.getElementById('qsCalLbl').textContent === 'Inbox'), `${tag}: "Inbox ▾" selector bottom-left`);
    await p.screenshot({ path: `${SHOTS}/sheet_empty_${tag}.png` });
    // ---- inline chips
    await typeIn(p, 'Pick up dry cleaning tomorrow at 3pm Errands p2');
    await p.fill('#qsDesc', 'Two shirts');
    const chips = await p.evaluate(() => [...document.querySelectorAll('#qsHl .qa-chip')].map(c => c.className.match(/qa-(date|time|category|priority)/)[1] + ':' + c.textContent));
    assert(chips.join(',') === 'date:tomorrow,time:at 3pm,category:Errands,priority:p2', `${tag}: filled blue chips inline (${chips.join(', ')})`);
    const bg = await p.evaluate(() => getComputedStyle(document.querySelector('#qsHl .qa-chip')).backgroundColor);
    assert(/rgb\(37, 99, 235\)|rgb\(59, 130, 246\)/.test(bg), `${tag}: chips are filled blue (${bg})`);
    const cl = await p.evaluate(() => ['qsDateLbl', 'qsPriLbl', 'qsCatLbl'].map(id => document.getElementById(id).textContent));
    assert(cl[0] === 'Tomorrow 3 PM' && cl[1] === 'P2' && cl[2] === 'Errands', `${tag}: Date / Priority / Category chips follow the text (${cl.join(' · ')})`);
    s = await sheet(p); assert(!s.send, `${tag}: send arrow enabled once there's text`);
    // contrast of sheet text
    const cr = await p.evaluate(() => { const sbg = getComputedStyle(document.getElementById('qsSheet')).backgroundColor;
      return [['title', '#qsHl'], ['desc', '#qsDesc'], ['date chip', '#qsDateChip'], ['priority chip', '#qsPriChip'], ['category chip', '#qsCatChip'], ['reminders chip', '#qsRemChip'], ['inbox', '#qsCalChip']].map(([k, sel]) => [k, window.__cr(getComputedStyle(document.querySelector(sel)).color, sbg)]); });
    assert(cr.every(([, v]) => v >= 4.5), `${tag}: sheet text >= 4.5:1 (${cr.map(([k, v]) => k + ' ' + v.toFixed(1)).join(', ')})`);
    const phc = await p.evaluate(() => { const sbg = getComputedStyle(document.getElementById('qsSheet')).backgroundColor; const t = document.getElementById('qsText'); t.value = ''; t.dispatchEvent(new Event('input')); const v = window.__cr(getComputedStyle(t, '::placeholder').color, sbg); return v; });
    assert(phc >= 4.5, `${tag}: placeholder >= 4.5:1 (${phc.toFixed(1)})`);
    await typeIn(p, 'Pick up dry cleaning tomorrow at 3pm Errands p2');
    await p.screenshot({ path: `${SHOTS}/sheet_chips_${tag}.png` });
    // ---- Enter submits, sheet stays open, item created with the right date / category / priority
    await p.focus('#qsText'); await p.keyboard.press('Enter'); await p.waitForTimeout(600);
    let ev = await events(p);
    const e1 = ev.find(e => e.title === 'Pick up dry cleaning');
    assert(e1 && e1.start === '2026-11-19T15:00' && !e1.allDay && e1.cat === 'cat-errands' && e1.pri === 2 && e1.notes === 'Two shirts', `${tag}: Enter created the to-do for tomorrow 3 PM, Errands, P2, with the description (${JSON.stringify(e1)})`);
    s = await sheet(p);
    const cleared = await p.evaluate(() => document.getElementById('qsText').value === '' && document.getElementById('qsDesc').value === '' && document.getElementById('qsDateLbl').textContent === 'Date');
    assert(s.open && s.active === 'qsText' && cleared && s.send, `${tag}: sheet stays open, cleared and focused for the next one`);
    const tst = await p.evaluate(() => { const t = document.getElementById('toast'); return { on: !t.hidden, txt: t.textContent, b: t.getBoundingClientRect().bottom, st: document.getElementById('qsSheet').getBoundingClientRect().top }; });
    assert(tst.on && /dry cleaning/.test(tst.txt) && tst.b <= tst.st, `${tag}: toast above the sheet (“${tst.txt}”)`);
    assert(await p.evaluate(() => !!document.querySelector('#todoList .todo-row.just-added')), `${tag}: the new row animates into the list`);
    await p.waitForTimeout(400);
    await p.screenshot({ path: `${SHOTS}/sheet_added_${tag}.png` });
    // ---- rapid multi-add
    for (const t of ['Buy milk', 'Email coach friday', 'Book physio next week p1', 'Return library books Errands']) { await p.keyboard.type(t, { delay: 2 }); await p.keyboard.press('Enter'); await p.waitForTimeout(60); }
    await p.waitForTimeout(900);
    ev = await events(p); let ib = await inbox(p);
    assert(ib.some(i => i.body === 'Buy milk' && i.kind === 'todo' && !i.cal) && ib.some(i => i.body === 'Return library books' && i.cat === 'cat-errands'), `${tag}: undated adds go to the Inbox (with category)`);
    assert(ev.some(e => e.title === 'Email coach' && e.start === '2026-11-20' && e.allDay) && ev.some(e => e.title === 'Book physio' && e.start === '2026-11-23' && e.pri === 1), `${tag}: rapid adds keep their own dates (Fri Nov 20, Mon Nov 23 P1)`);
    assert(ev.length + ib.length === 5 + 0, `${tag}: rapid multi-add saved every item exactly once (${ev.length} dated + ${ib.length} inbox)`);
    // ---- slow network: typing the next task while the last one is still saving never loses text
    await p.evaluate(() => { const N = window.SandyNav; N.__orig = N.saveQuick; N.saveQuick = async o => { await new Promise(r => setTimeout(r, 400)); return N.__orig(o); }; });
    await p.keyboard.type('Slow one', { delay: 2 }); await p.keyboard.press('Enter'); await p.keyboard.type('Typed while saving', { delay: 2 });
    await p.waitForTimeout(700);
    const kept = await p.evaluate(() => document.getElementById('qsText').value);
    await p.keyboard.press('Enter'); await p.waitForTimeout(800); ib = await inbox(p);
    await p.evaluate(() => { window.SandyNav.saveQuick = window.SandyNav.__orig; });
    assert(kept === 'Typed while saving' && ib.some(i => i.body === 'Slow one') && ib.some(i => i.body === 'Typed while saving'), `${tag}: typing the next task while the previous one saves keeps the text and saves both`);
    // ---- Date + Reminders chips, Inbox selector
    await p.keyboard.type('Stretch', { delay: 2 });
    await p.selectOption('#qsDate', '2026-11-18'); await p.selectOption('#qsRem', '30'); await p.selectOption('#qsPri', '3');
    const dl = await p.evaluate(() => [document.getElementById('qsDateLbl').textContent, document.getElementById('qsDateChip').dataset.when, document.getElementById('qsRemLbl').textContent, document.getElementById('qsPriLbl').textContent]);
    assert(dl[0] === 'Today' && dl[1] === 'today' && /30 minutes/.test(dl[2]) && dl[3] === 'P3', `${tag}: Date chip shows "Today", reminder + P3 picked (${dl.join(' · ')})`);
    await p.selectOption('#qsCal', 'mam');
    assert(await p.evaluate(() => document.getElementById('qsCalLbl').textContent !== 'Inbox'), `${tag}: Inbox ▾ switches to a calendar`);
    await p.click('#qsSend'); await p.waitForTimeout(600);
    ev = await events(p); const st1 = ev.find(e => e.title === 'Stretch');
    assert(st1 && st1.start === '2026-11-18' && st1.cal === 'mam' && JSON.stringify(st1.rem) === '[30]' && st1.pri === 3, `${tag}: send arrow saves with the picked date, calendar, reminder and priority (${JSON.stringify(st1)})`);
    assert((await sheet(p)).active === 'qsText', `${tag}: the send arrow doesn't steal focus (keyboard stays up)`);
    // ---- quick note via … more
    await p.selectOption('#qsMore', 'note');
    await p.keyboard.type('Idea: film review tomorrow', { delay: 2 });
    const nt = await p.evaluate(() => [document.getElementById('qsDateChip').hidden, document.querySelectorAll('#qsHl .qa-date').length, document.getElementById('qsText').placeholder]);
    assert(nt[0] && nt[1] === 0 && nt[2] === 'Note', `${tag}: "… > Quick note" hides dates (notes have none)`);
    await p.keyboard.press('Enter'); await p.waitForTimeout(500);
    ib = await inbox(p);
    assert(ib.some(i => i.kind === 'note' && i.body === 'Idea: film review tomorrow' && i.cal === 'mam'), `${tag}: quick note saved as an Inbox note`);
    await p.selectOption('#qsMore', 'todo');
    // ---- keyboard: sheet sits on top of it (visualViewport)
    const kbb = await p.evaluate(() => { const real = Object.getOwnPropertyDescriptor(window, 'visualViewport'); Object.defineProperty(window, 'visualViewport', { configurable: true, get: () => ({ height: 844 - 336, offsetTop: 0, addEventListener() {} }) });
      window.SandyQuickSheet.layout(); const r = document.getElementById('qsSheet').getBoundingClientRect().bottom; if (real) Object.defineProperty(window, 'visualViewport', real); else delete window.visualViewport; return r; });
    await p.waitForTimeout(250);
    const kb2 = await p.evaluate(() => document.getElementById('qsSheet').getBoundingClientRect().bottom);
    assert(Math.abs(kb2 - 508) < 2, `${tag}: with a 336px keyboard the sheet sits right on top of it (bottom ${kb2.toFixed(0)} = 844 - 336)`);
    await p.screenshot({ path: `${SHOTS}/sheet_keyboard_${tag}.png` });
    await p.evaluate(() => window.SandyQuickSheet.layout()); await p.waitForTimeout(250);
    // ---- dismiss: backdrop, Escape, swipe down
    await p.mouse.click(195, 120); await p.waitForTimeout(400); s = await sheet(p);
    assert(!s.open && s.hidden && s.active !== 'qsText', `${tag}: tapping the backdrop dismisses it`);
    await p.click('#todoFab'); await p.waitForTimeout(400); await p.keyboard.press('Escape'); await p.waitForTimeout(400);
    assert((await sheet(p)).hidden, `${tag}: Escape dismisses it`);
    await p.click('#todoFab'); await p.waitForTimeout(400);
    const cdp = await ctx.newCDPSession(p); const T = (type, y) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: type === 'touchEnd' ? [] : [{ x: 195, y }] });
    const top = (await sheet(p)).top;
    await T('touchStart', top + 8); for (let i = 1; i <= 8; i++) { await T('touchMove', top + 8 + i * 22); await p.waitForTimeout(16); }
    const dragged = await p.evaluate(() => new DOMMatrix(getComputedStyle(document.getElementById('qsSheet')).transform).m42);
    await T('touchEnd'); await p.waitForTimeout(450);
    assert(dragged > 100 && (await sheet(p)).hidden, `${tag}: swiping the sheet down follows the finger (${dragged.toFixed(0)}px) and dismisses it`);
    await p.click('#todoFab'); await p.waitForTimeout(400);
    await T('touchStart', top + 8); for (let i = 1; i <= 3; i++) { await T('touchMove', top + 8 + i * 8); await p.waitForTimeout(40); } await T('touchEnd'); await p.waitForTimeout(450);
    assert(!(await sheet(p)).hidden, `${tag}: a small drag snaps back (stays open)`);
    await p.keyboard.press('Escape'); await p.waitForTimeout(400);
    await go(p, 'home'); assert(!(await geo(p)).vis, `${tag}: FAB gone again on Home`);
    assert(!errs.length, `${tag}: no page errors ${errs.join(' | ')}`);
    await ctx.close();
  }
  // ---- reduced motion
  { const { ctx, p, errs } = await open({ reduced: true }); await go(p, 'todo');
    const t = await p.evaluate(() => [getComputedStyle(document.getElementById('qsSheet')).transitionDuration, getComputedStyle(document.getElementById('todoFab')).transitionDuration]);
    await p.click('#todoFab'); const m = await p.evaluate(() => new DOMMatrix(getComputedStyle(document.getElementById('qsSheet')).transform).m42);
    assert(t.every(x => x.split(',').every(v => parseFloat(v) === 0)) && Math.abs(m) < 1, `reduced motion: no transitions, sheet in place at once`);
    await p.keyboard.press('Escape'); assert((await sheet(p)).hidden, 'reduced motion: closes instantly'); assert(!errs.length, 'reduced motion: no page errors');
    await ctx.close(); }
  // ---- demo video
  if (VIDEO) { const { ctx, p } = await open({ video: VIDEO });
    await go(p, 'todo'); await p.waitForTimeout(600);
    const fb = await p.$('#todoFab'); const bx = await fb.boundingBox();
    await p.mouse.move(bx.x + 28, bx.y + 28); await p.mouse.down(); await p.waitForTimeout(160); await p.mouse.up(); await p.waitForTimeout(700);
    await p.keyboard.type('Pick up dry cleaning tomorrow at 3pm Errands p2', { delay: 45 }); await p.waitForTimeout(500);
    await p.keyboard.type('', {}); await p.fill('#qsDesc', 'Two shirts'); await p.focus('#qsText'); await p.waitForTimeout(500);
    await p.keyboard.press('Enter'); await p.waitForTimeout(1300);
    for (const t of ['Buy milk', 'Email coach friday', 'Book physio next week p1']) { await p.keyboard.type(t, { delay: 35 }); await p.waitForTimeout(250); await p.keyboard.press('Enter'); await p.waitForTimeout(900); }
    await p.waitForTimeout(600);
    const cdp = await ctx.newCDPSession(p); const T = (type, y) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: type === 'touchEnd' ? [] : [{ x: 195, y }] });
    const top = (await sheet(p)).top; await T('touchStart', top + 8); for (let i = 1; i <= 12; i++) { await T('touchMove', top + 8 + i * 18); await p.waitForTimeout(30); } await T('touchEnd'); await p.waitForTimeout(1200);
    await p.evaluate(() => window.scrollTo({ top: 0, behavior: 'smooth' })); await p.waitForTimeout(1000);
    await ctx.close(); }
  console.log(`\n${n} checks passed`); await b.close();
})().catch(e => { console.error(e); process.exit(1); });
