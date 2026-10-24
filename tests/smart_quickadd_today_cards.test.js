// Browser test (Scott 2026-10-24): smart To-Do quick add (blue chips while typing, parsed date/time/category)
// and Today section cards (Heads Up / On Today / Overdue To-Dos) in light + dark mode, at 390px.
//   node tests/smart_quickadd_today_cards.test.js http://127.0.0.1:8787/ [screenshotDir]
const { chromium } = require(process.env.PW || '/workspace/shot-tools/node_modules/playwright-core');
const BASE = process.argv[2] || 'http://127.0.0.1:8787/'; const SHOTS = process.argv[3] || '/workspace/shots-todo-today';
require('fs').mkdirSync(SHOTS, { recursive: true });
const assert = (c, m) => { if (!c) throw new Error('FAIL: ' + m); console.log('ok -', m); };
(async () => {
  const b = await chromium.launch({ executablePath: '/usr/bin/google-chrome', headless: true, args: ['--no-sandbox'] });
  const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, timezoneId: 'America/Chicago', locale: 'en-US', isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
  const p = await ctx.newPage(); const errs = []; p.on('pageerror', e => errs.push(e.message));
  await p.clock.install({ time: new Date('2026-10-24T21:07:00Z') }); // Sat Oct 24, 4:07 PM CT
  await p.goto(BASE); await p.waitForFunction(() => window.__app && window.__app.Store);
  await p.evaluate(() => { localStorage.clear(); sessionStorage.clear(); }); await p.goto(BASE); await p.waitForFunction(() => window.__app && window.__app.Store && window.SandyNav && window.SandyParse);
  await p.evaluate(async () => {
    const S = window.__app.Store; await S.removeWhere(() => true);
    const ev = o => ({ id: crypto.randomUUID(), kind: 'event', allDay: false, recurrence: { freq: 'none' }, location: '', notes: '', ...o });
    await S.save(ev({ title: 'Client session Ana', calendar: 'msc', category: 'Client session', start: '2026-10-24T17:00', end: '2026-10-24T18:00' }));
    await S.save(ev({ title: 'Gym class', calendar: 'lifetime', start: '2026-10-24T17:30', end: '2026-10-24T18:30' }));
    await S.save(ev({ title: 'Dinner with family', calendar: 'mam', start: '2026-10-24T18:40', end: '2026-10-24T20:00' }));
    await S.save(ev({ title: 'File taxes', kind: 'task', calendar: 'mam', allDay: true, start: '2026-10-20', end: '2026-10-20' }));
    await window.SandyNav.Cats.save({ id: 'cat-meeting', name: 'Meeting', color: '#3b82f6', sort: 0 });
    window.__app.refresh();
  });
  // ---------- To-Do smart quick add
  await p.click('#bottomNav [data-tab=todo]'); await p.waitForTimeout(400);
  await p.click('#qaText');
  await p.keyboard.type('meeting next Friday at 3pm', { delay: 25 }); await p.waitForTimeout(300);
  const chips = await p.$$eval('#qaHl .qa-chip', es => es.map(e => [e.textContent, e.className]));
  assert(chips.map(c => c[0]).join('|') === 'meeting|next Friday|at 3pm', 'chips on "meeting", "next Friday", "at 3pm": ' + JSON.stringify(chips.map(c => c[0])));
  const bg = await p.$eval('#qaHl .qa-chip', e => getComputedStyle(e).backgroundColor);
  assert(bg === 'rgb(37, 99, 235)', 'chips are filled blue');
  // overlay lines up with the input text (same left edge / font)
  const align = await p.evaluate(() => { const i = document.getElementById('qaText'), h = document.getElementById('qaHl'); const a = getComputedStyle(i), c = getComputedStyle(h); return a.fontSize === c.fontSize && a.fontFamily === c.fontFamily && Math.abs(i.getBoundingClientRect().left - h.getBoundingClientRect().left) < 1; });
  assert(align, 'highlight layer aligned with the input');
  assert(await p.$eval('#qaText', e => e.selectionStart === e.value.length), 'caret stays at the end while typing');
  const pv = await p.textContent('#qaPreview');
  assert(/Adds a to-do “Meeting”/.test(pv) && /Fri, Oct 30 · 3 PM/.test(pv) && /# Meeting/.test(pv), 'preview: Fri, Oct 30 · 3 PM, # Meeting: ' + pv.trim());
  await p.screenshot({ path: `${SHOTS}/1_chips_typing.png` });
  await p.keyboard.press('Enter'); await p.waitForTimeout(600);
  const saved = await p.evaluate(async () => (await window.__app.Store.list()).find(e => e.kind === 'task' && e.title === 'Meeting'));
  assert(saved && saved.start === '2026-10-30T15:00' && !saved.allDay && saved.todoCategoryId === 'cat-meeting', 'to-do saved: Meeting · Fri Oct 30 3:00 PM · category Meeting');
  assert(await p.$eval('#qaText', e => e.value === '') && await p.$eval('#qaHl', e => !e.querySelector('.qa-chip')) && await p.isHidden('#qaPreview'), 'input + chips cleared after add');
  const rowTxt = await p.locator('.todo-row', { hasText: 'Meeting' }).first().textContent();
  assert(/Fri, Oct 30 3:00 PM/.test(rowTxt), 'row shows Fri, Oct 30 3:00 PM: ' + rowTxt.replace(/\s+/g, ' ').trim());
  await p.locator('.todo-row', { hasText: 'Meeting' }).first().scrollIntoViewIfNeeded();
  await p.screenshot({ path: `${SHOTS}/2_resulting_todo.png` });
  // tap a chip in the preview → that phrase becomes plain text
  await p.click('#qaText'); await p.keyboard.type('Call mom tomorrow', { delay: 15 }); await p.waitForTimeout(200);
  assert((await p.$$eval('#qaHl .qa-chip', es => es.map(e => e.textContent))).join() === 'tomorrow', 'chip on "tomorrow"');
  await p.click('#qaPreview .qa-pv'); await p.waitForTimeout(200);
  assert(!(await p.$('#qaHl .qa-chip')) && await p.$eval('#qaHl', e => e.textContent.includes('Call mom tomorrow')), 'tapping the chip keeps "tomorrow" as plain text');
  await p.keyboard.press('Enter'); await p.waitForTimeout(500);
  assert(await p.evaluate(async () => (await window.SandyNav.Inbox.list()).some(i => i.body === 'Call mom tomorrow')), 'unrecognized text goes to Inbox unchanged');
  // tap inside an inline chip in the input
  await p.click('#qaText'); await p.keyboard.type('gym Thursday', { delay: 15 }); await p.waitForTimeout(200);
  await p.evaluate(() => { const i = document.getElementById('qaText'); i.setSelectionRange(7, 7); i.dispatchEvent(new MouseEvent('click', { bubbles: true })); });
  await p.waitForTimeout(100);
  assert(!(await p.$('#qaHl .qa-chip')), 'tapping inside an inline chip removes its recognition');
  await p.fill('#qaText', ''); await p.dispatchEvent('#qaText', 'input');
  // plain jot + category only
  await p.click('#qaText'); await p.keyboard.type('Meeting', { delay: 15 }); await p.keyboard.press('Enter'); await p.waitForTimeout(500);
  assert(await p.evaluate(async () => (await window.SandyNav.Inbox.list()).some(i => i.body === 'Meeting' && i.categoryId === 'cat-meeting')), 'category-only jot → Inbox "Meeting" with category');
  // ---------- Today cards, light
  await p.click('#bottomNav [data-tab=today]'); await p.waitForTimeout(700);
  const cards = await p.$$eval('#todayBody .tc-card', es => es.map(e => { const cs = getComputedStyle(e); return { h: e.querySelector('h3').textContent, r: cs.borderTopLeftRadius, bw: cs.borderTopWidth, bc: cs.borderTopColor, bl: cs.borderLeftWidth, blc: cs.borderLeftColor, bg: cs.backgroundColor, mb: cs.marginBottom }; }));
  assert(cards.map(c => c.h).join('|') === 'Heads Up|On Today|Overdue To-Dos', 'three cards with titles inside: ' + cards.map(c => c.h).join('|'));
  assert(cards.every(c => parseFloat(c.r) >= 12 && c.bw === '1px' && parseFloat(c.mb) >= 12), 'rounded, thin border, spaced');
  assert(cards[0].bc === 'rgb(229, 231, 235)', 'light-gray border');
  assert(cards[2].bl === '4px' && /248, 113, 113/.test(cards[2].blc), 'Overdue card has a red left accent');
  const evs = await p.$$eval('.tc-on .tc-ev', es => es.map(e => ({ t: e.querySelector('.tc-title').textContent, sh: getComputedStyle(e).boxShadow, bg: getComputedStyle(e).backgroundColor })));
  assert(evs.length >= 3 && evs.every(e => /inset/.test(e.sh) && e.bg !== 'rgba(0, 0, 0, 0)'), 'On Today events have calendar color bar + tint');
  assert(await p.$eval('.tc-on .tc-ev .client-key', e => getComputedStyle(e).fontWeight === '700'), 'client session still bold');
  await p.screenshot({ path: `${SHOTS}/3_today_light.png`, fullPage: false });
  await p.$eval('#todayCard', e => e.scrollIntoView()); await p.screenshot({ path: `${SHOTS}/3b_today_light_cards.png` });
  // ---------- dark
  await p.evaluate(() => window.SandyNav.setDark(true)); await p.waitForTimeout(300);
  const dk = await p.$eval('.tc-card', e => [getComputedStyle(e).backgroundColor, getComputedStyle(document.body).backgroundColor]);
  assert(dk[0] === 'rgb(22, 33, 58)' && dk[0] !== dk[1], 'dark: cards are a slightly lighter surface');
  await p.evaluate(() => window.scrollTo(0, 0)); await p.screenshot({ path: `${SHOTS}/4_today_dark.png` });
  await p.$eval('#todayCard', e => e.scrollIntoView()); await p.screenshot({ path: `${SHOTS}/4b_today_dark_cards.png` });
  await p.click('#bottomNav [data-tab=todo]'); await p.waitForTimeout(300);
  await p.click('#qaText'); await p.keyboard.type('errands tomorrow noon meeting', { delay: 10 }); await p.waitForTimeout(200);
  await p.screenshot({ path: `${SHOTS}/5_chips_dark.png` });
  assert(!errs.length, 'no page errors ' + errs.join('; '));
  await b.close(); console.log('ALL PASS');
})().catch(e => { console.error(e); process.exit(1); });
