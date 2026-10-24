// Browser test (Scott 2026-10-24): (1) MSC "Client session / reach-out / check-in" titles bold + underlined in List
// and Day view (case-insensitive, MSC only, others untouched); (2) event editor Save/Cancel stay visible while the
// sheet scrolls, without covering content; (3) tapping the Briefing header toggles it (its buttons still work).
//   node tests/client_bold_sticky_brief.test.js http://127.0.0.1:8787/ [screenshotDir]
const { chromium } = require(process.env.PW || '/workspace/shot-tools/node_modules/playwright-core');
const BASE = process.argv[2] || 'http://127.0.0.1:8787/'; const SHOTS = process.argv[3] || '/workspace/shots-tweaks';
require('fs').mkdirSync(SHOTS, { recursive: true });
const assert = (c, m) => { if (!c) throw new Error('FAIL: ' + m); console.log('ok -', m); };
(async () => {
  const b = await chromium.launch({ executablePath: '/usr/bin/google-chrome', headless: true, args: ['--no-sandbox'] });
  for (const vp of [{ width: 390, height: 700, name: 'mobile' }, { width: 1300, height: 800, name: 'desktop' }]) {
    const N = `[${vp.name}]`; const mob = vp.name === 'mobile';
    const ctx = await b.newContext({ viewport: vp, timezoneId: 'America/Chicago', locale: 'en-US', isMobile: mob, hasTouch: mob });
    const p = await ctx.newPage(); const errs = []; p.on('pageerror', e => errs.push(e.message));
    await p.clock.install({ time: new Date('2026-10-21T15:00:00Z') });
    await p.goto(BASE + '?view=listWeek'); await p.waitForFunction(() => window.__app && window.__app.Store);
    await p.evaluate(() => localStorage.clear()); await p.reload(); await p.waitForFunction(() => window.__app && window.__app.Store);
    await p.evaluate(async () => {
      const S = window.__app.Store; const all = await S.all ? await S.all() : [];
      const mk = (title, calendar, category, h) => ({ id: crypto.randomUUID(), kind: 'event', title, calendar, category, allDay: false, start: `2026-10-21T${h}:00`, end: `2026-10-21T${h}:30`, recurrence: { freq: 'none' } });
      for (const e of [mk('KEY session', 'msc', 'Client session', '10'), mk('KEY reach', 'msc', 'client reach-out', '11'), mk('KEY checkin', 'msc', 'CLIENT CHECK-IN', '12'),
        mk('PLAIN msc meeting', 'msc', 'Meeting', '13'), mk('PLAIN mam checkin', 'mam', 'Client check-in', '14')]) await S.save(e);
      window.__app.refresh();
    });
    await p.waitForTimeout(600);
    const style = async (sel, t) => p.evaluate(([sel, t]) => { const el = [...document.querySelectorAll(sel)].find(e => e.textContent.includes(t)); if (!el) return null; const s = getComputedStyle(el); return { w: +s.fontWeight, u: s.textDecorationLine.includes('underline') }; }, [sel, t]);
    for (const view of ['list', 'day']) {
      if (view === 'day') { await p.evaluate(() => { window.__app.calendar.changeView('timeGridDay', '2026-10-21'); }); await p.waitForTimeout(500); }
      const sel = view === 'list' ? '.fc-list-event-title a' : '.fc-event-title';
      for (const t of ['KEY session', 'KEY reach', 'KEY checkin']) { const s = await style(sel, t); assert(s && s.w >= 700 && s.u, `${N} ${view}: "${t}" bold + underlined`); }
      for (const t of ['PLAIN msc meeting', 'PLAIN mam checkin']) { const s = await style(sel, t); assert(s && s.w < 700 && !s.u, `${N} ${view}: "${t}" unchanged`); }
      await p.screenshot({ path: `${SHOTS}/client_bold_${view}_${vp.name}.png` });
    }
    // Briefing header toggles
    const open = () => p.getAttribute('#briefCollapse', 'aria-expanded');
    const before = await open();
    await p.click('#briefTitle'); await p.waitForTimeout(450);
    assert(await open() !== before, `${N} tapping the Briefing title toggles it`);
    await p.click('#briefing .brief-head', { position: { x: 4, y: 6 } }); await p.waitForTimeout(450);
    assert(await open() === before, `${N} tapping the header again toggles back`);
    if (before === 'true') {
      await p.click('#briefScope [data-scope=week]'); await p.waitForTimeout(300);
      assert(await open() === 'true' && await p.getAttribute('#briefScope [data-scope=week]', 'aria-pressed') === 'true', `${N} period buttons still work and don't toggle`);
      await p.click('#briefScope [data-scope=day]');
    }
    await p.click('#briefCollapse'); await p.waitForTimeout(450);
    assert(await open() !== before, `${N} chevron still toggles once (no double toggle)`);
    await p.click('#briefCollapse'); await p.waitForTimeout(450);
    // Sticky Save/Cancel
    await p.evaluate(() => window.__app.openEditor(null, null, { title: 'x' })); await p.waitForSelector('#eventDialog[open]'); await p.waitForTimeout(500);
    const vis = async () => p.evaluate(() => { const d = document.getElementById('eventDialog'); const r = d.getBoundingClientRect();
      const ok = id => { const b = id === 'save' ? d.querySelector('.dialog-actions [type=submit]') : document.getElementById('cancelBtn'); const q = b.getBoundingClientRect();
        const top = document.elementFromPoint(q.left + q.width / 2, q.top + q.height / 2); return q.top >= r.top && q.bottom <= Math.min(r.bottom, innerHeight) + 0.5 && (top === b || b.contains(top)); };
      return { save: ok('save'), cancel: ok('cancel'), scrollable: d.scrollHeight > d.clientHeight }; });
    let v = await vis(); assert(v.save && v.cancel, `${N} editor top: Save + Cancel visible`);
    await p.evaluate(() => { const d = document.getElementById('eventDialog'); d.scrollTop = d.scrollHeight / 2; }); await p.waitForTimeout(150);
    v = await vis(); assert(v.save && v.cancel, `${N} editor middle: Save + Cancel visible${v.scrollable ? '' : ' (sheet fits)'}`);
    if (mob) await p.screenshot({ path: `${SHOTS}/editor_sticky_mid_${vp.name}.png` });
    await p.evaluate(() => { const d = document.getElementById('eventDialog'); d.scrollTop = d.scrollHeight; }); await p.waitForTimeout(150);
    v = await vis(); assert(v.save && v.cancel, `${N} editor bottom: Save + Cancel visible`);
    const covered = await p.evaluate(() => { const a = document.querySelector('#eventDialog .dialog-actions').getBoundingClientRect(); const prev = document.querySelector('#eventDialog .dialog-actions').previousElementSibling;
      let el = prev; while (el && (el.hidden || !el.getBoundingClientRect().height)) el = el.previousElementSibling; return el ? el.getBoundingClientRect().bottom - a.top : 0; });
    assert(covered <= 1, `${N} scrolled to the end, the footer covers no content (${covered.toFixed(1)}px)`);
    await p.click('#cancelBtn'); await p.waitForSelector('#eventDialog', { state: 'hidden' });
    assert(errs.length === 0, `${N} no page errors ${errs.join('|')}`);
    await ctx.close();
  }
  await b.close(); console.log('CLIENT BOLD / STICKY / BRIEFING TESTS PASSED');
})().catch(e => { console.error(e); process.exit(1); });
