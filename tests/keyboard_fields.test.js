// t184u: note and text fields stay visible above the on-screen keyboard while typing.
//   node tests/keyboard_fields.test.js BASE [SHOTS] [device]
// Bug: in the full editor, Today's Note (7–14 lines tall) dropped below the keyboard on focus, and its caret went
// out of view while typing a long note, every time. iPad / Android Chrome only shrink the *visual* viewport, so a stand-in
// visualViewport raises a keyboard here (as tablet_event_save does). Checks, on iPhone / iPad / Android phone / tablet,
// light + dark: the caret line is above the keyboard and not under the sticky Save bar (elementFromPoint), on focus, after
// a long note, and on coming back to it; plus event Notes, the to-do sheet's Description and sub-tasks, the inbox Note
// dialog and the SI input.
const PW = require(process.env.PW || '/usr/local/lib/pnpm/5/.pnpm/playwright-core@1.59.1/node_modules/playwright-core');
const fs = require('fs');
const BASE = process.argv[2] || 'http://127.0.0.1:8871/';
const SHOTS = process.argv[3] || '/workspace/shots-oct29/kb-fields'; fs.mkdirSync(SHOTS, { recursive: true });
const only = process.argv[4] || '';
let n = 0, fails = 0; const ok = (c, m) => { if (!c) { fails++; console.log('FAIL -', m); } else { n++; console.log('ok -', m); } };
// keyboard heights roughly as on the devices (incl. the suggestion bar)
const DEV = [['iphone', 'webkit', 393, 852, 336], ['ipad', 'webkit', 820, 1180, 410], ['android-phone', 'chromium', 412, 915, 330], ['android-tablet', 'chromium', 800, 1280, 470]];
const NOW = '2026-11-03T15:00:00Z'; // Tue Nov 3, 9 AM CT
const LONG = Array.from({ length: 22 }, (_, i) => `Line ${i + 1}: how practice went, who was out`).join('\n');

// is the caret (textarea / input) or the element visible: inside the visual viewport and actually on top there
const caretVisible = (p, sel) => p.evaluate(sel => {
  const el = document.querySelector(sel); if (!el) return { ok: false, why: 'missing ' + sel };
  if (document.activeElement !== el) return { ok: false, why: 'not focused (' + (document.activeElement && (document.activeElement.id || document.activeElement.tagName)) + ')' };
  const r = el.getBoundingClientRect(); let y0 = r.top, y1 = r.bottom;
  if (el.tagName === 'TEXTAREA') {
    const cs = getComputedStyle(el), m = document.createElement('div');
    m.style.cssText = 'position:absolute;visibility:hidden;left:-9999px;top:0;white-space:pre-wrap;overflow-wrap:break-word;box-sizing:border-box;';
    for (const k of ['width', 'paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft', 'borderTopWidth', 'borderRightWidth', 'borderBottomWidth', 'borderLeftWidth', 'borderStyle', 'fontFamily', 'fontSize', 'fontWeight', 'lineHeight', 'letterSpacing']) m.style[k] = cs[k];
    m.textContent = el.value.slice(0, el.selectionEnd); const s = document.createElement('span'); s.textContent = '\u200b'; m.appendChild(s); document.body.appendChild(m);
    y0 = r.top + s.offsetTop - el.scrollTop; y1 = y0 + (s.offsetHeight || 20); m.remove();
    if (y0 < r.top - 2 || y1 > r.bottom + 2) return { ok: false, why: `caret outside its own box (${Math.round(y0)}..${Math.round(y1)} vs ${Math.round(r.top)}..${Math.round(r.bottom)})` };
  }
  const vv = visualViewport, top = vv.offsetTop, bot = vv.offsetTop + vv.height;
  if (y0 < top - 1 || y1 > bot + 1) return { ok: false, why: `caret ${Math.round(y0)}..${Math.round(y1)} outside visible ${Math.round(top)}..${Math.round(bot)}` };
  const x = Math.min(r.right - 6, r.left + 14), y = Math.max(y0 + 2, Math.min(y1 - 2, (y0 + y1) / 2));
  const hit = document.elementFromPoint(x, y);
  if (!(hit === el || el.contains(hit))) return { ok: false, why: `covered by ${hit && (hit.id || hit.className || hit.tagName)}` };
  return { ok: true, why: `caret ${Math.round(y0)}..${Math.round(y1)}, keyboard at ${Math.round(bot)}` };
}, sel);

(async () => {
  const B = {}; const errs = [];
  for (const [name, eng, w, h, KB] of DEV) for (const dark of [false, true]) {
    if (only && name !== only) continue;
    B[eng] = B[eng] || (eng === 'webkit' ? await PW.webkit.launch() : await PW.chromium.launch({ executablePath: '/usr/bin/google-chrome', args: ['--no-sandbox'] }));
    const tag = `${name}-${dark ? 'dark' : 'light'}`; console.log('#', tag);
    const ctx = await B[eng].newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 2, isMobile: eng === 'chromium', hasTouch: true, serviceWorkers: 'block', timezoneId: 'America/Chicago', colorScheme: dark ? 'dark' : 'light' });
    await ctx.addInitScript(d => {
      if (!sessionStorage.getItem('__i')) { sessionStorage.setItem('__i', '1'); localStorage.clear(); localStorage.setItem('sandy.welcome.off', '1'); localStorage.setItem('sandy.tour.off', '1'); if (d) localStorage.setItem('sandy.theme', 'dark'); }
      const fake = new EventTarget(); let kb = 0;
      Object.defineProperty(fake, 'height', { get: () => innerHeight - kb }); Object.defineProperty(fake, 'width', { get: () => innerWidth });
      for (const k of ['offsetTop', 'offsetLeft', 'pageTop', 'pageLeft']) Object.defineProperty(fake, k, { get: () => 0 }); Object.defineProperty(fake, 'scale', { get: () => 1 });
      try { Object.defineProperty(window, 'visualViewport', { configurable: true, get: () => fake }); } catch (_) {}
      window.__kb = hh => { kb = hh; fake.dispatchEvent(new Event('resize')); };
      // the keyboard comes up when a text field gets focus and goes away when focus leaves all of them (like the devices)
      const TXT = 'textarea, input:not([type]), input[type=text], input[type=search]';
      document.addEventListener('focusin', e => { if (e.target.matches && e.target.matches(TXT)) setTimeout(() => window.__kb(window.__KB || 0), 60); });
      document.addEventListener('focusout', () => setTimeout(() => { const a = document.activeElement; if (!(a && a.matches && a.matches(TXT))) window.__kb(0); }, 30));
    }, dark);
    const p = await ctx.newPage(); p.on('pageerror', e => { if (!/ResizeObserver loop/.test(e.message)) errs.push(`${tag}: ${e.message}`); });
    await p.clock.install({ time: new Date(NOW) });
    await p.goto(BASE + '?view=listWeek'); await p.waitForFunction(() => window.__app && window.Store && window.SandyNav);
    await p.evaluate(kb => { window.__KB = kb; }, KB);
    const check = async (sel, what) => { await p.waitForTimeout(450); const v = await caretVisible(p, sel); ok(v.ok, `${tag}: ${what} (${v.why})`); return v.ok; };
    const shot = async s => { // draw the simulated keyboard where it would sit (screenshot only; not part of the checks)
      await p.evaluate(dk => { const k = document.createElement('div'); k.id = '__kbOverlay'; const h = innerHeight - visualViewport.height;
        k.style.cssText = `position:fixed;left:0;right:0;bottom:0;height:${h}px;z-index:2147483647;pointer-events:none;background:${dk ? '#2b2b2e' : '#d1d3d9'};display:flex;align-items:center;justify-content:center;font:600 15px system-ui;color:${dk ? '#9ca3af' : '#4b5563'};border-top:1px solid ${dk ? '#3f3f46' : '#b8bac0'}`;
        k.textContent = `simulated keyboard (${h}px)`; if (h) document.body.appendChild(k); }, dark);
      await p.screenshot({ path: `${SHOTS}/${tag}-${s}.png` }); await p.evaluate(() => { const k = document.getElementById('__kbOverlay'); if (k) k.remove(); }); };
    try {
      // ---------- full editor: Today's Note on a weekly practice ----------
      const id = await p.evaluate(async () => (await Store.save({ calendar: __app.calendars()[0].id, kind: 'event', category: 'Other', title: 'KB practice', allDay: false, start: '2026-11-03T15:00', end: '2026-11-03T17:00', recurrence: { freq: 'weekly', interval: 1, byWeekday: [2] } })).id);
      await p.evaluate(id => __app.openEditor(id, '2026-11-03'), id); await p.waitForSelector('#eventDialog[open]'); await p.waitForSelector('#dayNoteBox:not([hidden])'); await p.waitForTimeout(500);
      await p.locator('#dayNote').scrollIntoViewIfNeeded(); await p.locator('#dayNote').tap({ position: { x: 30, y: 20 } });
      await check('#dayNote', "Today's Note: on first tap it is above the keyboard");
      await p.keyboard.type('Rain, moved inside. ');
      await check('#dayNote', "Today's Note: caret visible while typing");
      await shot('1-daynote-focus');
      await p.keyboard.type(LONG);
      await check('#dayNote', "Today's Note: caret still visible after a 22-line note");
      ok(await p.$eval('#dayNote', t => t.value.endsWith('who was out')), `${tag}: the whole note was typed`);
      await shot('2-daynote-long');
      // leave it, come back and keep typing (it used to stay hidden every time after that)
      await p.locator('#event-title').tap(); await p.waitForTimeout(350);
      await check('#event-title', 'title field visible when moving to it');
      await p.locator('#dayNote').scrollIntoViewIfNeeded(); await p.locator('#dayNote').tap({ position: { x: 30, y: 12 } });
      await p.evaluate(() => { const t = document.getElementById('dayNote'); t.setSelectionRange(t.value.length, t.value.length); });
      await p.keyboard.type('\nBack again: still visible');
      await check('#dayNote', "Today's Note: visible again when coming back to it");
      await shot('3-daynote-again');
      // the editor's own Notes field
      await p.locator('textarea[name=event-notes]').scrollIntoViewIfNeeded(); await p.locator('textarea[name=event-notes]').tap();
      await p.keyboard.type(LONG.split('\n').slice(0, 12).join('\n'));
      await check('textarea[name=event-notes]', 'event Notes: caret visible after 12 lines');
      ok(await p.evaluate(() => { const b = document.querySelector('#eventForm button[type=submit]'); const r = b.getBoundingClientRect(); const e = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2); return (e === b || b.contains(e)) && r.bottom <= visualViewport.height + 1; }), `${tag}: Save still visible above the keyboard`);
      await p.locator('#event-title').tap(); await p.waitForTimeout(200); await p.evaluate(() => document.activeElement.blur()); await p.waitForTimeout(300);
      const back = await p.waitForFunction(() => !document.getElementById('eventDialog').classList.contains('kb-fit') && !document.getElementById('dayNote').style.maxHeight && !document.querySelector('textarea[name=event-notes]').style.maxHeight, null, { timeout: 1500 }).then(() => 'ok', async () => p.evaluate(() => `fit=${document.getElementById('eventDialog').classList.contains('kb-fit')} note=${document.getElementById('dayNote').style.maxHeight} notes=${document.querySelector('textarea[name=event-notes]').style.maxHeight} vvh=${visualViewport.height} ih=${innerHeight} act=${document.activeElement && (document.activeElement.id || document.activeElement.tagName)}`));
      ok(back === 'ok', `${tag}: keyboard down: editor and note back to normal size (${back})`);
      await p.evaluate(() => document.querySelector('#eventDialog').close()); await p.waitForTimeout(400);

      // ---------- to-do sheet: Description + sub-tasks ----------
      await p.evaluate(() => SandyNav.go('todo')); await p.waitForTimeout(400);
      await p.tap('#todoFab'); await p.waitForSelector('#qsSheet.open'); await p.waitForTimeout(500);
      await p.keyboard.type('KB to-do');
      await p.locator('#qsDesc').tap(); await p.keyboard.type(LONG.split('\n').slice(0, 10).join('\n'));
      await check('#qsDesc', 'to-do Description: caret visible after 10 lines');
      await p.tap('#qsSubChip'); await p.waitForTimeout(300);
      await p.locator('#qsSubNew').tap();
      for (let i = 1; i <= 8; i++) { await p.keyboard.type(`Sub-task ${i}`); await p.keyboard.press('Enter'); await p.waitForTimeout(60); }
      await p.keyboard.type('Sub-task 9');
      await check('#qsSubNew', 'sub-tasks: the add field stays visible after 8 sub-tasks');
      await shot('4-todo-subtasks');
      ok(await p.evaluate(() => document.getElementById('qsSheet').getBoundingClientRect().top >= visualViewport.offsetTop - 1), `${tag}: to-do sheet fits above the keyboard (scrolls inside instead of running off the top)`);
      await p.evaluate(() => document.activeElement.blur()); await p.waitForTimeout(250);
      await p.evaluate(() => window.SandyQuickSheet && SandyQuickSheet.close ? SandyQuickSheet.close() : document.querySelector('#qsClose, .qs-backdrop') && document.querySelector('#qsClose, .qs-backdrop').click()); await p.waitForTimeout(500);

      // ---------- a note on the To-do page (opens in the sheet, edit mode) ----------
      await p.evaluate(async () => { await SandyNav.Inbox.save({ id: crypto.randomUUID(), body: 'KB inbox note', kind: 'note', done: false, calendar: null, categoryId: null }); SandyNav.go('todo'); SandyNav.renderTodo(); });
      await p.waitForFunction(() => [...document.querySelectorAll('[data-inbox]')].some(x => /KB inbox note/.test(x.textContent))); await p.waitForTimeout(300);
      await p.evaluate(() => { const r = [...document.querySelectorAll('[data-inbox]')].find(x => /KB inbox note/.test(x.textContent)); r.querySelector('.td-title, .td-main').click(); });
      const inSheet = await p.waitForSelector('#qsSheet.open.qs-editing', { timeout: 3000 }).then(() => true, () => false);
      ok(inSheet, `${tag}: note opened in the sheet`);
      if (inSheet) {
        await p.waitForTimeout(400);
        const fld = await p.evaluate(() => document.getElementById('qsDesc').offsetParent ? '#qsDesc' : '#qsText');
        await p.locator(fld).tap(); await p.evaluate(s => { const t = document.querySelector(s); t.setSelectionRange(t.value.length, t.value.length); }, fld);
        await p.keyboard.type((fld === '#qsDesc' ? '' : ' ') + LONG.split('\n').slice(0, 12).join(fld === '#qsDesc' ? '\n' : ' '));
        await check(fld, `To-do page note (${fld}): caret visible after a long note`);
        ok(await p.evaluate(() => document.getElementById('qsSheet').getBoundingClientRect().top >= visualViewport.offsetTop - 1), `${tag}: note sheet fits above the keyboard`);
        await p.evaluate(() => document.activeElement.blur()); await p.waitForTimeout(250);
        await p.evaluate(() => SandyQuickSheet.close && SandyQuickSheet.close()); await p.waitForTimeout(500);
      }
      // ---------- the same note from Search (inbox Note dialog) ----------
      await p.evaluate(() => SandyNav.go('search')); await p.waitForTimeout(300);
      await p.fill('#searchBox', 'KB inbox'); await p.waitForTimeout(600);
      await p.evaluate(() => document.activeElement && document.activeElement.blur()); await p.waitForTimeout(250);
      await p.evaluate(() => { const b = document.querySelector('.sr-item[data-inbox]'); b && b.click(); });
      const hasIb = await p.waitForSelector('#ibBody', { timeout: 3000 }).then(() => true, () => false);
      ok(hasIb, `${tag}: Search opens the inbox Note dialog`);
      if (hasIb) {
        await p.waitForTimeout(400);
        await p.locator('#ibBody').tap(); await p.evaluate(() => { const t = document.getElementById('ibBody'); t.setSelectionRange(t.value.length, t.value.length); });
        await p.keyboard.type('\n' + LONG.split('\n').slice(0, 14).join('\n'));
        await check('#ibBody', 'inbox Note dialog: caret visible after 14 lines');
        ok(await p.evaluate(() => { const d = document.querySelector('dialog.inbox-dlg'), r = d.getBoundingClientRect(); return r.bottom <= visualViewport.height + 1 && r.top >= -1; }), `${tag}: inbox dialog fits above the keyboard`);
        await shot('5-inbox-note');
        await p.evaluate(() => document.activeElement.blur()); await p.waitForTimeout(250);
        await p.evaluate(() => document.querySelector('dialog.inbox-dlg').close()); await p.waitForTimeout(300);
      }

      // ---------- SI input ----------
      await p.evaluate(() => document.activeElement && document.activeElement.blur()); await p.waitForTimeout(200);
      await p.click('#aiBtn'); await p.waitForSelector('#aiSheet:not([hidden])'); await p.waitForTimeout(500);
      await p.locator('#aiText').tap();
      await check('#aiText', 'SI input: above the keyboard on focus');
      await p.keyboard.type('Add film with Nick tomorrow 4pm and also remind me to bring the cones and the ball pump');
      await check('#aiText', 'SI input: caret visible while typing');
      ok(await p.evaluate(() => { const b = document.getElementById('aiSend').getBoundingClientRect(), hd = document.querySelector('.ai-head').getBoundingClientRect(); return b.bottom <= visualViewport.height + 1 && hd.top >= -1; }), `${tag}: SI Send button above the keyboard, header still on screen`);
      await shot('6-si-input');
      await p.evaluate(() => document.activeElement.blur()); await p.waitForTimeout(300);
      ok(await p.evaluate(() => !document.getElementById('aiSheet').classList.contains('kb-fit')), `${tag}: SI sheet back to normal when the keyboard closes`);
    } catch (e) { ok(false, `${tag}: error ${e.message.split('\n')[0]}`); }
    await ctx.close();
  }
  ok(!errs.length, 'no page errors ' + errs.join(' | '));
  for (const b of Object.values(B)) await b.close();
  console.log(fails ? `FAIL ${fails} (${n} ok)` : `KEYBOARD FIELDS PASSED (${n} checks)`); process.exit(fails ? 1 : 0);
})();
