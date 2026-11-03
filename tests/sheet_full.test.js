// To-Do quick sheet: drag up to full screen (Scott 2026-11-02, t179u: "when I enter the edit event screen ... it just stays
// at about a half page"). Phones: the sheet opens at half height; dragging the handle (or the header) up snaps it to full
// screen, dragging down goes back to half, a longer pull down closes it (and still autosaves). Tapping the handle toggles
// (keyboard / screen-reader path, aria-expanded). Every open starts at half. Height animates; reduced motion snaps.
// Tablets: the To-Do sheet is already a full-height side pane, so nothing changes there (handle stays hidden).
// 4 devices x light/dark, local mode.   node tests/sheet_full.test.js http://127.0.0.1:8830/ /tmp/shots [device]
const PW = process.env.PW || '/usr/local/lib/pnpm/5/.pnpm/playwright-core@1.59.1/node_modules/playwright-core';
const { chromium, webkit } = require(PW);
const fs = require('fs');
const BASE = process.argv[2] || 'http://127.0.0.1:8830/';
const OUT = process.argv[3] || '/tmp/sheetfull';
const only = process.argv[4] || '';
fs.mkdirSync(OUT, { recursive: true });
const DEV = [['iphone', 'webkit', 393, 852], ['ipad', 'webkit', 820, 1180], ['android-phone', 'chromium', 412, 915], ['android-tablet', 'chromium', 800, 1280]];
let n = 0;
const HIT = sel => { const el = document.querySelector(sel); if (!el || el.hidden) return { ok: false, why: 'missing/hidden' }; const r = el.getBoundingClientRect(); const cs = getComputedStyle(el);
  if (!r.width || !r.height || cs.visibility === 'hidden' || cs.display === 'none' || +cs.opacity < .5) return { ok: false, why: 'not visible' };
  const x = r.left + r.width / 2, y = r.top + r.height / 2; if (r.top < 0 || r.bottom > innerHeight) return { ok: false, why: 'off screen ' + Math.round(r.top) + '/' + Math.round(r.bottom) };
  const h = document.elementFromPoint(x, y); return { ok: !!h && (h === el || el.contains(h)), why: 'covered by ' + (h && (h.id || h.className)) }; };
const box = () => { const s = document.getElementById('qsSheet'); const r = s.getBoundingClientRect(); const g = document.getElementById('qsGrab'); const gr = g.getBoundingClientRect();
  return { top: Math.round(r.top), bottom: Math.round(r.bottom), h: Math.round(r.height), vh: innerHeight, full: s.classList.contains('qs-full'), open: SandyQuickSheet.isOpen, resizing: s.classList.contains('qs-resizing'),
    exp: g.getAttribute('aria-expanded'), gx: Math.round(gr.left + gr.width / 2), gy: Math.round(gr.top + gr.height / 2), gvis: gr.width > 0 && getComputedStyle(g).display !== 'none' }; };
(async () => {
  const errs = [];
  const ok = (c, m, tag) => { if (!c) errs.push(tag + ': ' + m); else n++; };
  for (const [name, eng, w, h] of DEV) {
    if (only && name !== only) continue;
    const phone = w < 600;
    const br = eng === 'webkit' ? await webkit.launch() : await chromium.launch({ executablePath: '/usr/bin/google-chrome', args: ['--no-sandbox'] });
    for (const dark of [false, true]) {
      const tag = `${name}-${dark ? 'dark' : 'light'}`;
      const ctx = await br.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 2, isMobile: eng === 'chromium', hasTouch: true, serviceWorkers: 'block', timezoneId: 'America/Chicago', colorScheme: dark ? 'dark' : 'light' });
      await ctx.route('**/config.js', r => r.fulfill({ contentType: 'application/javascript', body: "window.CALENDAR_CONFIG={APP_NAME:'SANDY',SUPABASE_URL:'',SUPABASE_ANON_KEY:'',OWNER_EMAIL:''};" }));
      await ctx.addInitScript(d => { if (sessionStorage.getItem('__i')) return; sessionStorage.setItem('__i', '1'); localStorage.clear(); localStorage.setItem('sandy.welcome.off', '1'); localStorage.setItem('sandy.tour.off', '1'); if (d) localStorage.setItem('sandy.theme', 'dark'); }, dark);
      const p = await ctx.newPage();
      p.on('pageerror', e => { if (!/ResizeObserver loop/.test(e.message)) errs.push(tag + ': page error ' + e.message); });
      const cdp = eng === 'chromium' ? await ctx.newCDPSession(p) : null;
      // a finger drag from (x,y0) to (x,y1): real touch on Chromium (CDP), dispatched TouchEvents on WebKit
      const drag = async (x, y0, y1, ms = 220, steps = 8) => {
        if (cdp) {
          await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y: y0 }] });
          for (let i = 1; i <= steps; i++) { await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x, y: y0 + (y1 - y0) * i / steps }] }); await p.waitForTimeout(ms / steps); }
          await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
        } else {
          await p.evaluate(async ({ x, y0, y1, ms, steps }) => {
            const t = document.elementFromPoint(x, y0); const mk = (type, y) => { const tc = { identifier: 1, target: t, clientX: x, clientY: y, pageX: x, pageY: y };
              // this WebKit build has no Touch constructor: a plain cancelable event carrying the same touch lists
              const ev = new Event(type, { bubbles: true, cancelable: true }); const L = type === 'touchend' ? [] : [tc];
              Object.defineProperties(ev, { touches: { value: L }, targetTouches: { value: L }, changedTouches: { value: [tc] } }); t.dispatchEvent(ev); };
            mk('touchstart', y0); for (let i = 1; i <= steps; i++) { mk('touchmove', y0 + (y1 - y0) * i / steps); await new Promise(r => setTimeout(r, ms / steps)); } mk('touchend', y1);
          }, { x, y0, y1, ms, steps });
        }
        await p.waitForTimeout(450);
      };
      await p.goto(BASE + '?tab=todo'); await p.waitForFunction(() => window.__app && window.SandyQuickSheet && window.SandyNav);
      const ids = await p.evaluate(async () => { const a = __app, d = a.ymd(a.nowWall());
        const t = await a.Store.save({ calendar: a.calendars()[0].id, kind: 'task', title: 'QA full-sheet task', allDay: true, start: d, end: d, recurrence: { freq: 'none' }, notes: 'QA notes for the full sheet' });
        return { t: t.id }; });
      await p.reload(); await p.waitForFunction(() => window.__app && window.SandyQuickSheet && window.SandyNav);
      if (!(await p.evaluate(() => document.body.classList.contains('tab-todo')))) await p.evaluate(() => document.querySelector('#bottomNav [data-tab=todo]').click());
      await p.waitForSelector(`[data-ev="${ids.t}"] .td-title`); await p.waitForTimeout(400);
      const openEdit = async () => { await p.tap(`[data-ev="${ids.t}"] .td-title`); await p.waitForFunction(() => SandyQuickSheet.isOpen && SandyQuickSheet.editing); await p.waitForTimeout(500); };
      await openEdit();
      let b = await p.evaluate(box);
      if (!phone) {
        // tablets: full-height side pane already; no handle, no full-screen mode
        ok(!b.gvis, `tablet: no drag handle (${JSON.stringify(b)})`, tag);
        ok(b.bottom >= b.vh - 2 && b.top <= 80 && b.h > b.vh * 0.85, `tablet: To-Do edit pane is full height ${b.top}-${b.bottom}/${b.vh}`, tag);
        await drag(Math.round(w - 150), 120, 40); b = await p.evaluate(box);
        ok(!b.full && b.open, `tablet: an upward swipe changes nothing (${JSON.stringify(b)})`, tag);
        await p.screenshot({ path: `${OUT}/${tag}-1-pane.png` });
        // quick add from the + on another page is the full editor dialog, unchanged; the To-Do + opens the pane
        await p.evaluate(() => SandyQuickSheet.close && SandyQuickSheet.close()); await p.waitForTimeout(400);
        await ctx.close(); continue;
      }
      // ---- phones
      const half = b.h;
      ok(b.h < b.vh * 0.8 && b.bottom >= b.vh - 2, `opens at half (${b.h}/${b.vh})`, tag);
      ok(b.gvis && b.exp === 'false', `handle visible, aria-expanded=false (${JSON.stringify(b)})`, tag);
      let hit = await p.evaluate(HIT, '#qsGrab'); ok(hit.ok, `handle is tappable (${hit.why})`, tag);
      await p.screenshot({ path: `${OUT}/${tag}-1-half.png` });
      // A. drag the handle up -> full screen
      await drag(b.gx, b.gy, b.gy - 320);
      b = await p.evaluate(box);
      ok(b.full && b.top <= 14 && b.bottom >= b.vh - 2, `drag up -> full screen (${JSON.stringify(b)})`, tag);
      ok(b.exp === 'true', 'aria-expanded=true when full', tag);
      hit = await p.evaluate(HIT, '#qsSend'); ok(hit.ok, `Save still tappable when full (${hit.why})`, tag);
      hit = await p.evaluate(HIT, '#qsGrab'); ok(hit.ok, `handle still reachable when full (${hit.why})`, tag);
      await p.screenshot({ path: `${OUT}/${tag}-2-full.png` });
      // B. short pull down from the handle -> back to half (not closed)
      await drag(b.gx, b.gy, b.gy + 140);
      b = await p.evaluate(box);
      ok(b.open && !b.full && Math.abs(b.h - half) <= 6, `short pull down -> back to half (${b.h} vs ${half}, open ${b.open})`, tag);
      // C. a small upward wiggle (< 60 px) springs back to half
      await drag(b.gx, b.gy, b.gy - 30, 400);
      b = await p.evaluate(box); ok(!b.full && Math.abs(b.h - half) <= 6, `small wiggle springs back to half (${b.h})`, tag);
      // D. tap the handle: full; mid-animation the height is between (it animates); tap again: half
      await p.tap('#qsGrab');
      // sample in-page across the animation (robust under suite load): some frame must sit between half and full
      const mid = await p.evaluate((half) => new Promise(res => { const t0 = performance.now(); let best = null;
        const tick = () => { const s = document.getElementById('qsSheet'); const h = Math.round(s.getBoundingClientRect().height);
          if (s.classList.contains('qs-resizing') && h > half + 4 && h < innerHeight - 16) best = { resizing: true, h, vh: innerHeight };
          if (best || performance.now() - t0 > 400) res(best || { resizing: s.classList.contains('qs-resizing'), h, vh: innerHeight }); else requestAnimationFrame(tick); };
        tick(); }), half);
      ok(mid.resizing && mid.h > half + 4 && mid.h < mid.vh - 16, `height animates (mid ${mid.h}, half ${half})`, tag);
      await p.waitForTimeout(450); b = await p.evaluate(box); ok(b.full && b.top <= 14, `tap handle -> full (${b.top})`, tag);
      await p.tap('#qsGrab'); await p.waitForTimeout(450); b = await p.evaluate(box); ok(!b.full && Math.abs(b.h - half) <= 6, `tap again -> half (${b.h})`, tag);
      // E. full, edit the title, long pull down closes it and the edit is kept (autosave on close)
      await p.tap('#qsGrab'); await p.waitForTimeout(450);
      await p.fill('#qsText', 'QA full-sheet task EDITED'); await p.evaluate(() => document.activeElement && document.activeElement.blur()); await p.waitForTimeout(200);
      b = await p.evaluate(box); await p.evaluate(() => { document.getElementById('qsSheet').scrollTop = 0; });
      await drag(b.gx, b.gy, Math.min(b.vh - 10, b.gy + b.vh - 60), 260, 10);
      await p.waitForTimeout(300);
      b = await p.evaluate(box); ok(!b.open, `long pull down from full closes it (${JSON.stringify(b)})`, tag);
      const t1 = await p.evaluate(async id => (await __app.Store.get(id)).title, ids.t); ok(t1 === 'QA full-sheet task EDITED', `edit kept after closing from full (${t1})`, tag);
      // F. reopening starts at half again
      await openEdit(); b = await p.evaluate(box); ok(!b.full && Math.abs(b.h - half) <= 8 && b.exp === 'false', `reopens at half (${b.h})`, tag);
      // G. the old short swipe down from half still closes
      await drag(b.gx, b.gy, b.gy + 200); b = await p.evaluate(box); ok(!b.open, 'swipe down from half still closes', tag);
      // H. quick add (+): drag up -> full, the Add row sits at the bottom
      await p.tap('#todoFab'); await p.waitForFunction(() => SandyQuickSheet.isOpen); await p.waitForTimeout(500);
      await p.evaluate(() => document.activeElement && document.activeElement.blur()); await p.waitForTimeout(400);
      b = await p.evaluate(box); const halfAdd = b.h;
      await drag(b.gx, b.gy, b.gy - 320); b = await p.evaluate(box);
      const foot = await p.evaluate(() => { const f = document.querySelector('#qsSheet .qs-foot').getBoundingClientRect(); return Math.round(f.bottom); });
      ok(b.full && b.top <= 14, `quick add drags up to full (${b.top}, half ${halfAdd})`, tag);
      ok(b.bottom - foot < 60, `quick add: Add row at the bottom when full (${foot} vs ${b.bottom})`, tag);
      await p.screenshot({ path: `${OUT}/${tag}-3-quickadd-full.png` });
      await p.evaluate(() => SandyQuickSheet.close()); await p.waitForTimeout(400);
      // I. reduced motion: tap snaps with no animation
      await p.emulateMedia({ reducedMotion: 'reduce' });
      await openEdit(); await p.tap('#qsGrab'); await p.waitForTimeout(40);
      b = await p.evaluate(box); ok(b.full && !b.resizing, `reduced motion: snaps to full (${JSON.stringify(b)})`, tag);
      await p.evaluate(() => SandyQuickSheet.close()); await p.waitForTimeout(400);
      await ctx.close();
    }
    await br.close();
  }
  for (const e of errs) console.log('FAIL', e);
  console.log(errs.length ? `FAIL (${errs.length}), ${n} ok` : `PASS ${n} checks`);
  process.exit(errs.length ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
