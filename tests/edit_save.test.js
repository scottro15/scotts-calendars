// Edit sheet always has a Save button (Scott 2026-11-01: "no save button when clicking back on a to-do ... I'm unable to
// save it"). The To-Do task view used to hide Save (Todoist-style autosave), so it looked like edits could not be saved.
// Now: a Save pill sits in the sticky header, visible + tappable (not under the FAB / nav / safe area), soft until
// something changed, then filled; tapping it saves every field (title, description, priority, date, category, sub-tasks)
// and closes. Autosave still runs on close and when the app goes to the background. Changes survive a reload.
// Also: the full event editor opened from Home / Today / Calendar / To-Do "Full editor" has a visible Save.
// 4 devices x light/dark, local mode.   node tests/edit_save.test.js http://127.0.0.1:8820/ /tmp/shots [device]
const PW = process.env.PW || '/usr/local/lib/pnpm/5/.pnpm/playwright-core@1.59.1/node_modules/playwright-core';
const { chromium, webkit } = require(PW);
const fs = require('fs');
const BASE = process.argv[2] || 'http://127.0.0.1:8820/';
const OUT = process.argv[3] || '/tmp/editsave';
const only = process.argv[4] || '';
fs.mkdirSync(OUT, { recursive: true });
const DEV = [['iphone', 'webkit', 393, 852], ['ipad', 'webkit', 820, 1180], ['android-phone', 'chromium', 412, 915], ['android-tablet', 'chromium', 800, 1280]];
let n = 0;
// the element is on screen and is what a finger at its centre hits
const HIT = sel => { const el = document.querySelector(sel); if (!el || el.hidden) return { ok: false, why: 'missing/hidden' }; const r = el.getBoundingClientRect(); const cs = getComputedStyle(el);
  if (!r.width || !r.height || cs.visibility === 'hidden' || +cs.opacity < .5) return { ok: false, why: 'not visible ' + JSON.stringify([r.width, r.height, cs.opacity]) };
  const x = r.left + r.width / 2, y = r.top + r.height / 2; if (r.top < 0 || r.bottom > innerHeight || r.left < 0 || r.right > innerWidth) return { ok: false, why: 'off screen ' + JSON.stringify([r.left, r.top, r.right, r.bottom]) };
  const h = document.elementFromPoint(x, y); return { ok: !!h && (h === el || el.contains(h)), why: 'covered by ' + (h && (h.id || h.className)), text: el.textContent.trim() }; };
(async () => {
  const errs = [];
  const ok = (c, m, tag) => { if (!c) errs.push(tag + ': ' + m); else n++; };
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
      p.on('dialog', d => d.accept(d.type() === 'prompt' ? 'QA Errands' : undefined));
      await p.goto(BASE + '?tab=todo'); await p.waitForFunction(() => window.__app && window.SandyQuickSheet && window.SandyNav);
      const ids = await p.evaluate(async () => { const a = __app, d = a.ymd(a.nowWall());
        const t = await a.Store.save({ calendar: a.calendars()[0].id, kind: 'task', title: 'QA edit-save task', allDay: true, start: d, end: d, recurrence: { freq: 'none' } });
        const t2 = await a.Store.save({ calendar: a.calendars()[0].id, kind: 'task', title: 'QA timed to-do', allDay: false, start: d + 'T23:00', end: d + 'T23:30', recurrence: { freq: 'none' } });
        return { t: t.id, t2: t2.id, today: d, tomorrow: a.ymd(a.addDays(a.nowWall(), 1)) }; });
      await p.reload(); await p.waitForFunction(() => window.__app && window.SandyQuickSheet && window.SandyNav);
      if (!(await p.evaluate(() => document.body.classList.contains('tab-todo')))) await p.evaluate(() => document.querySelector('#bottomNav [data-tab=todo]').click());
      await p.waitForSelector(`[data-ev="${ids.t}"] .td-title`); await p.waitForTimeout(400);
      const get = id => p.evaluate(async id => { const e = await __app.Store.get(id); return e && { title: e.title, notes: e.notes || e.description || '', priority: e.priority, start: e.start, category: e.category || e.categoryId || e.category_id || null }; }, id);
      const dirty = () => p.evaluate(() => document.getElementById('qsSend').classList.contains('qs-dirty'));

      // --- A. open an existing to-do: Save is there, reachable, quiet (nothing changed yet)
      await p.tap(`[data-ev="${ids.t}"] .td-title`); await p.waitForFunction(() => SandyQuickSheet.isOpen && SandyQuickSheet.editing); await p.waitForTimeout(450);
      let hit = await p.evaluate(HIT, '#qsSend');
      ok(hit.ok && hit.text === 'Save', `Save visible + tappable on open (${hit.why} "${hit.text}")`, tag);
      ok(!(await dirty()), 'Save is quiet before any change', tag);
      // --- B. change every field
      await p.selectOption('#qsPri', '1'); await p.waitForTimeout(150);
      await p.selectOption('#qsDate', { index: 2 }); await p.waitForTimeout(150); // Tomorrow
      const catOpts = await p.evaluate(() => [...document.querySelectorAll('#qsCat option')].map(o => o.value));
      let catWanted = null;
      if (catOpts.some(v => v && v !== '__new__')) { catWanted = catOpts.find(v => v && v !== '__new__'); await p.selectOption('#qsCat', catWanted); }
      else { await p.selectOption('#qsCat', '__new__'); await p.waitForTimeout(400); const v = await p.inputValue('#qsCat'); if (v && v !== '__new__') catWanted = v; }
      await p.waitForTimeout(200);
      if (await p.locator('#qsSubChip').isVisible()) await p.tap('#qsSubChip');
      await p.tap('#qsSubNew'); await p.keyboard.type('QA bring gloves'); await p.keyboard.press('Enter'); await p.waitForTimeout(300);
      await p.tap('#qsDesc'); await p.keyboard.type('QA notes line');
      await p.tap('#qsText'); await p.keyboard.press('End'); await p.keyboard.type(' EDITED'); await p.waitForTimeout(350);
      ok(await dirty(), 'Save fills in once something changed', tag);
      hit = await p.evaluate(HIT, '#qsSend');
      ok(hit.ok, `Save still reachable while editing (${hit.why})`, tag);
      await p.screenshot({ path: `${OUT}/${tag}-1-todo-edit-save.png` });
      // --- C. tap Save: sheet closes, says Saved, everything stored
      await p.tap('#qsSend'); await p.waitForTimeout(900);
      ok(!(await p.evaluate(() => SandyQuickSheet.isOpen)), 'Save closes the sheet', tag);
      const toast = await p.evaluate(() => [...document.querySelectorAll('.toast, #toast, [role=status]')].map(t => t.textContent).join('|'));
      ok(/Saved/.test(toast), `"Saved" confirmation (${toast.slice(0, 80)})`, tag);
      await p.screenshot({ path: `${OUT}/${tag}-2-after-save.png` });
      const want = e => e && e.title === 'QA edit-save task EDITED' && /QA notes line/.test(e.notes) && /QA bring gloves/.test(e.notes) && e.priority === 1 && String(e.start).slice(0, 10) === ids.tomorrow && (!catWanted || e.category === catWanted);
      let e1 = await get(ids.t);
      ok(want(e1), `all fields saved ${JSON.stringify(e1)} cat=${catWanted}`, tag);
      await p.reload(); await p.waitForFunction(() => window.__app && window.SandyNav); await p.waitForTimeout(600);
      e1 = await get(ids.t);
      ok(want(e1), `all fields still there after reload ${JSON.stringify(e1)}`, tag);
      ok(await p.evaluate(() => [...document.querySelectorAll('#todoList .td-title')].some(t => /QA edit-save task EDITED/.test(t.textContent))), 'list row shows the new title', tag);

      // --- D. reopen with no change: Save is quiet and just closes
      await p.waitForSelector(`[data-ev="${ids.t}"] .td-title`);
      await p.tap(`[data-ev="${ids.t}"] .td-title`); await p.waitForFunction(() => SandyQuickSheet.isOpen && SandyQuickSheet.editing); await p.waitForTimeout(400);
      ok(!(await dirty()), 'reopened: quiet Save', tag);
      await p.tap('#qsSend'); await p.waitForTimeout(700);
      ok(!(await p.evaluate(() => SandyQuickSheet.isOpen)), 'quiet Save closes', tag);

      // --- E. timed to-do: edit, leave the app (background) without closing -> kept
      await p.tap(`[data-ev="${ids.t2}"] .td-title`); await p.waitForFunction(() => SandyQuickSheet.isOpen && SandyQuickSheet.editing); await p.waitForTimeout(400);
      hit = await p.evaluate(HIT, '#qsSend'); ok(hit.ok, `timed to-do: Save reachable (${hit.why})`, tag);
      await p.tap('#qsDesc'); await p.keyboard.type('typed then switched apps'); await p.waitForTimeout(150);
      await p.evaluate(() => { Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true }); document.dispatchEvent(new Event('visibilitychange')); });
      await p.waitForTimeout(600);
      ok(/typed then switched apps/.test((await get(ids.t2)).notes), 'backgrounding the app saves the open edit', tag);
      await p.evaluate(() => { delete document.visibilityState; });
      await p.keyboard.press('Escape'); await p.waitForTimeout(500);
      const e2 = await get(ids.t2); ok(/^QA timed to-do$/.test(e2.title) && String(e2.start).includes('T23:00'), `timed to-do kept its time ${JSON.stringify(e2)}`, tag);

      // --- F. full event editor (Home / Today / Calendar / To-Do "Full editor"): Save visible + reachable
      await p.evaluate(id => __app.openEditor(id), ids.t2); await p.waitForTimeout(600);
      const fe = await p.evaluate(() => { const d = [...document.querySelectorAll('dialog[open], .modal.open, [role=dialog]:not([hidden])')].find(x => x.offsetParent !== null || x.open); if (!d) return null;
        const b = [...d.querySelectorAll('button')].find(b => /^\s*Save\b/.test(b.textContent) && b.offsetParent !== null); if (!b) return { why: 'no Save' }; b.id = b.id || '__feSave'; return { id: b.id }; });
      if (!fe || !fe.id) ok(false, 'full editor: Save button found ' + JSON.stringify(fe), tag);
      else { const fh = await p.evaluate(HIT, '#' + fe.id); ok(fh.ok, `full editor: Save visible + tappable (${fh.why})`, tag);
        await p.screenshot({ path: `${OUT}/${tag}-3-full-editor.png` });
        await p.fill('#event-title', 'QA timed to-do FULL').catch(() => {});
        await p.tap('#' + fe.id); await p.waitForTimeout(900);
        const e3 = await get(ids.t2); ok(e3.title === 'QA timed to-do FULL', `full editor Save stores the change (${e3.title})`, tag); }
      await ctx.close();
    }
    await br.close();
  }
  if (errs.length) { console.log('FAIL\n' + errs.join('\n')); process.exit(1); }
  console.log(`PASS ${n} checks`);
})().catch(e => { console.error(e); process.exit(1); });
