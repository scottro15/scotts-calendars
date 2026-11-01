// Sub-task text never sticks on one line (Scott 2026-11-01): in the quick-add sheet (create + edit / tablet pane), its
// "Add sub-task" field, the full editor's list + "Add sub-task" field, and the To-Do list rows, long text wraps and the
// field grows so all of it shows while typing and after. Enter adds (no newlines; a pasted one becomes a space), the
// check box lines up with the first line, the drag handle still reorders. 4 devices x light/dark, local mode.
//   node tests/subtask_wrap.test.js http://127.0.0.1:8793/ /tmp/shots [device]
const PW = process.env.PW || '/usr/local/lib/pnpm/5/.pnpm/playwright-core@1.59.1/node_modules/playwright-core';
const { chromium, webkit } = require(PW);
const fs = require('fs');
const BASE = process.argv[2] || 'http://127.0.0.1:8793/';
const OUT = process.argv[3] || '/tmp/subwrap';
const only = process.argv[4] || '';
fs.mkdirSync(OUT, { recursive: true });
const DEV = [['iphone', 'webkit', 393, 852], ['ipad', 'webkit', 820, 1180], ['android-phone', 'chromium', 412, 915], ['android-tablet', 'chromium', 800, 1280]];
const LONG = 'Call the venue about parking for the whole team, confirm the loading dock hours and ask whether we can bring our own coffee';
const LONG2 = 'Email everyone the final agenda with directions, the dial-in link for remote folks and a reminder to bring laptops';
let n = 0;
(async () => {
  const errs = [];
  const ok = (c, m, tag) => { if (!c) errs.push(tag + ': ' + m); else n++; };
  // fits = all text visible (no inner scroll, no clipping), several lines tall
  const FIT = a => { const [sel, i] = Array.isArray(a) ? a : [a, 0]; const el = document.querySelectorAll(sel)[i || 0]; if (!el) return null; const r = el.getBoundingClientRect(); return { h: Math.round(r.height), top: r.top, sh: el.scrollHeight, ch: el.clientHeight, sw: el.scrollWidth, cw: el.clientWidth, v: 'value' in el ? el.value : el.textContent }; };
  const fits = f => f && f.sh <= f.ch + 2 && f.sw <= f.cw + 2;
  for (const [name, eng, w, h] of DEV) {
    if (only && name !== only) continue;
    const br = eng === 'webkit' ? await webkit.launch() : await chromium.launch({ executablePath: '/usr/bin/google-chrome', args: ['--no-sandbox'] });
    for (const dark of [false, true]) {
      const tag = `${name}-${dark ? 'dark' : 'light'}`;
      const ctx = await br.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 2, isMobile: eng === 'chromium', hasTouch: true, serviceWorkers: 'block', timezoneId: 'America/Chicago', colorScheme: dark ? 'dark' : 'light' });
      await ctx.route('**/config.js', r => r.fulfill({ contentType: 'application/javascript', body: "window.CALENDAR_CONFIG={APP_NAME:'SANDY',SUPABASE_URL:'',SUPABASE_ANON_KEY:'',OWNER_EMAIL:''};" }));
      await ctx.addInitScript(d => { if (sessionStorage.getItem('__i')) return; sessionStorage.setItem('__i', '1'); localStorage.clear(); localStorage.setItem('sandy.welcome.off', '1'); localStorage.setItem('sandy.tour.off', '1'); if (d) localStorage.setItem('sandy.theme', 'dark'); }, dark);
      const p = await ctx.newPage();
      p.on('pageerror', e => { if (!/ResizeObserver loop/.test(e.message)) errs.push(tag + ': page error ' + e.message); });
      p.on('dialog', d => d.accept());
      await p.goto(BASE); await p.waitForFunction(() => window.__app && window.SandyQuickSheet && window.SandyNav);
      await p.evaluate(() => document.querySelector('#bottomNav [data-tab=todo]').click()); await p.waitForTimeout(700);

      // --- A. create sheet: type a long sub-task
      await p.evaluate(() => SandyQuickSheet.open()); await p.waitForTimeout(400);
      await p.locator('#qsText').fill('Team offsite');
      await p.click('#qsSubChip'); await p.waitForTimeout(300);
      ok(await p.evaluate(() => document.getElementById('qsSubNew').tagName) === 'TEXTAREA', 'Add sub-task is a wrapping field', tag);
      const one = await p.evaluate(FIT, '#qsSubNew');
      await p.click('#qsSubNew'); await p.keyboard.type(LONG, { delay: 4 }); await p.waitForTimeout(150);
      const typing = await p.evaluate(FIT, '#qsSubNew');
      ok(fits(typing) && typing.h >= one.h + 18, `typing: field grows and shows it all (${one.h}→${typing.h}, sh ${typing.sh}/${typing.ch})`, tag);
      ok(typing.v === LONG, 'typed text intact, no newlines', tag);
      await p.screenshot({ path: `${OUT}/${tag}-1-typing-long-subtask.png` });
      await p.keyboard.press('Enter'); await p.waitForTimeout(350);
      const after = await p.evaluate(FIT, '#qsSubNew');
      ok(after.v === '' && after.h <= one.h + 2, `Enter adds; the field shrinks back (${after.h})`, tag);
      const row = await p.evaluate(FIT, '#qsSubList .qs-sub-text');
      ok(row && row.v === LONG && fits(row) && row.h >= 40, `added sub-task wraps, all visible (h ${row && row.h})`, tag);
      const al = await p.evaluate(() => { const li = document.querySelector('#qsSubList .qs-sub'), c = li.querySelector('.qs-sub-check').getBoundingClientRect(), t = li.querySelector('.qs-sub-text').getBoundingClientRect(), d = li.querySelector('.qs-sub-drag').getBoundingClientRect(); return { dc: c.top - t.top, dd: d.top - t.top, ch: c.height }; });
      ok(al.dc >= -2 && al.dc <= 6, `check box on the first line (${al.dc.toFixed(1)})`, tag);
      ok(al.dd >= -6 && al.dd <= 4, `drag handle at the top (${al.dd.toFixed(1)})`, tag);
      // paste with a newline → a space; then a second long one
      await p.evaluate(() => { const t = document.getElementById('qsSubNew'); t.focus(); t.value = 'Line one\nline two'; t.dispatchEvent(new InputEvent('input', { bubbles: true })); });
      ok(await p.inputValue('#qsSubNew') === 'Line one line two', 'pasted newline becomes a space', tag);
      await p.fill('#qsSubNew', LONG2); await p.press('#qsSubNew', 'Enter'); await p.waitForTimeout(300);
      // drag handle still reorders (keyboard on the handle)
      await p.locator('#qsSubList .qs-sub-drag').nth(1).focus(); await p.keyboard.press('ArrowUp'); await p.waitForTimeout(200);
      const order = await p.evaluate(() => [...document.querySelectorAll('#qsSubList .qs-sub-text')].map(t => t.value));
      ok(order[0] === LONG2 && order[1] === LONG, 'drag handle reorders long sub-tasks', tag);
      const hd = await p.evaluate(() => { const d = document.querySelectorAll('#qsSubList .qs-sub-drag')[0], r = d.getBoundingClientRect(); const e = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2); return !!(e && e.closest('.qs-sub-drag') === d); });
      ok(hd, 'drag handle is hit-testable (not covered by the grown text)', tag);
      ok(await p.evaluate(() => [...document.querySelectorAll('#qsSubList .qs-sub-text')].every(t => t.scrollHeight <= t.clientHeight + 2 && t.clientHeight >= 40)), 'both long sub-tasks fully visible after reorder', tag);
      // rename a long one while typing more: still fits
      const ren = p.locator('#qsSubList .qs-sub-text').nth(1); await ren.click(); await ren.evaluate(t => { t.focus(); t.setSelectionRange(t.value.length, t.value.length); }); await p.keyboard.type(' and snacks for everyone in the afternoon', { delay: 4 }); await p.waitForTimeout(150);
      ok(fits(await p.evaluate(FIT, ['#qsSubList .qs-sub-text', 1])), 'renaming: grows while typing', tag);
      await p.keyboard.press('Enter'); await p.waitForTimeout(200);
      await p.locator('#qsSheet').evaluate(s => { s.scrollTop = 0; });
      await p.screenshot({ path: `${OUT}/${tag}-2-long-subtasks-in-sheet.png` });
      await p.click('#qsSend'); await p.waitForTimeout(900);
      await p.keyboard.press('Escape'); await p.waitForTimeout(500);

      // --- B. the list row under the parent
      const jid = await p.evaluate(async () => (await SandyNav.Inbox.list()).find(x => /^Team offsite/.test(x.body)).id);
      await p.evaluate(id => document.querySelector(`[data-inbox="${id}"]`).scrollIntoView({ block: 'center' }), jid);
      const lr = await p.evaluate(id => [...document.querySelectorAll(`[data-inbox="${id}"] .td-sub`)].map(li => { const t = li.querySelector('.td-sub-text'), c = li.querySelector('.td-sub-check').getBoundingClientRect(), r = t.getBoundingClientRect(); return { h: r.height, sh: t.scrollHeight, ch: t.clientHeight, dc: c.top - r.top, lh: parseFloat(getComputedStyle(t).lineHeight), sw: t.scrollWidth, cw: t.clientWidth }; }), jid);
      ok(lr.length === 2 && lr.every(x => x.h >= x.lh * 2 - 1 && x.sh <= x.ch + 2 && x.sw <= x.cw + 2), 'list rows wrap, nothing clipped ' + JSON.stringify(lr.map(x => Math.round(x.h))), tag);
      ok(lr.every(x => x.dc >= -2 && x.dc <= 5), 'list check boxes on the first line ' + JSON.stringify(lr.map(x => x.dc.toFixed(1))), tag);
      await p.screenshot({ path: `${OUT}/${tag}-3-long-subtasks-in-list.png` });

      // --- C. edit sheet / tablet pane opens with the long sub-tasks fully shown (they were hidden while rendered)
      await p.click(`[data-inbox="${jid}"] .td-title`); await p.waitForTimeout(700);
      const ed = await p.evaluate(() => [...document.querySelectorAll('#qsSubList .qs-sub-text')].map(t => ({ sh: t.scrollHeight, ch: t.clientHeight })));
      ok(ed.length === 2 && ed.every(x => x.sh <= x.ch + 2 && x.ch >= 40), 'edit sheet / pane shows the whole long sub-tasks ' + JSON.stringify(ed), tag);
      await p.screenshot({ path: `${OUT}/${tag}-4-edit-sheet-long-subtasks.png` });
      await p.evaluate(() => SandyQuickSheet.close()); await p.waitForTimeout(500);

      // --- D. full editor: list items + Add sub-task field
      await p.evaluate(() => { const a = __app, t = a.ymd(a.nowWall()); a.openEditor(null, null, { kind: 'task', allDay: true, start: t, end: t, calendar: a.firstVisibleCal() }); });
      await p.waitForSelector('#eventDialog[open]'); await p.waitForTimeout(400);
      await p.fill('#event-title', 'Offsite prep');
      ok(await p.evaluate(() => document.getElementById('checklistNew').tagName) === 'TEXTAREA', 'editor Add sub-task wraps', tag);
      const e1 = await p.evaluate(FIT, '#checklistNew');
      await p.click('#checklistNew'); await p.keyboard.type(LONG, { delay: 3 }); await p.waitForTimeout(150);
      const e2 = await p.evaluate(FIT, '#checklistNew');
      ok(fits(e2) && e2.h >= e1.h + 18, `editor field grows while typing (${e1.h}→${e2.h})`, tag);
      await p.evaluate(() => document.getElementById('checklistNew').scrollIntoView({ block: 'center' }));
      await p.screenshot({ path: `${OUT}/${tag}-5-editor-typing-long-subtask.png` });
      await p.keyboard.press('Enter'); await p.waitForTimeout(300);
      const e3 = await p.evaluate(FIT, '#checklistNew');
      ok(e3.v === '' && e3.h <= e1.h + 2, 'editor Enter adds, field shrinks back', tag);
      const ei = await p.evaluate(() => { const lb = document.querySelector('#checklistItems label, .checklist-items label'); const s = lb.querySelector('span'), c = lb.querySelector('input').getBoundingClientRect(), r = s.getBoundingClientRect(); return { text: s.textContent, h: r.height, dc: c.top - r.top, sw: s.scrollWidth, cw: s.clientWidth, right: r.right, box: lb.getBoundingClientRect().right }; });
      ok(ei.text === LONG && ei.h >= 40 && ei.sw <= ei.cw + 2 && ei.right <= ei.box + 1, 'editor list item wraps inside the box ' + JSON.stringify(ei), tag);
      ok(ei.dc >= -2 && ei.dc <= 5, `editor check box on the first line (${ei.dc.toFixed(1)})`, tag);
      ok(await p.evaluate(() => /- \[ \] Call the venue about parking[^\n]+coffee$/.test(document.querySelector('[name=event-notes]').value)), 'saved as one sub-task line', tag);
      await p.evaluate(() => document.querySelector('.checklist-items').scrollIntoView({ block: 'center' }));
      await p.screenshot({ path: `${OUT}/${tag}-6-editor-long-subtask-in-list.png` });
      await ctx.close();
    }
    await br.close();
  }
  console.log(`${n} checks passed`);
  if (errs.length) { console.log('FAIL\n' + errs.join('\n')); process.exit(1); }
  console.log('PASS');
})().catch(e => { console.error(e); process.exit(1); });
