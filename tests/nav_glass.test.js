// Browser test (Scott 2026-10-25, nav2): bottom nav v2 - Instagram-style frosted glass bar + Hinge-style sliding
// active pill + shrink-on-scroll. 390x844, light + dark, local mode.
// Covers: translucency (computed backdrop-filter / -webkit-, semi-transparent bg, hairline border, content visible
// underneath); pill centred on each tab and SLIDING between tabs (mid-transition sample, 250ms transform transition);
// active vs inactive colours + contrast; shrink on scroll down / restore on scroll up with hysteresis in List, Day,
// Week, Month, Today, To-Do, Search, Profile and an inner scroll container; full size at the top; tab switch resets;
// tap targets >= 44px visible when shrunk; dialogs above the bar; last content row not hidden; reduced motion.
//   node tests/nav_glass.test.js http://127.0.0.1:8787/ [shotsDir] [videoDir]
const { chromium } = require(process.env.PW || '/workspace/shot-tools/node_modules/playwright-core');
const fs = require('fs');
const BASE = process.argv[2] || 'http://127.0.0.1:8787/'; const SHOTS = process.argv[3] || '/workspace/shots-nav2'; const VIDEO = process.argv[4] || '';
fs.mkdirSync(SHOTS, { recursive: true });
let n = 0; const assert = (c, m) => { if (!c) throw new Error('FAIL: ' + m); n++; console.log('ok -', m); };
const CONTRAST = `(() => {
  const parse = s => { let m = s.match(/rgba?\\(([\\d.]+),? ([\\d.]+),? ([\\d.]+)(?:,? \\/?\\s*([\\d.]+))?/); return m ? [+m[1], +m[2], +m[3], m[4] == null ? 1 : +m[4]] : null; };
  const lum = c => { const f = v => { v /= 255; return v <= .03928 ? v / 12.92 : Math.pow((v + .055) / 1.055, 2.4); }; return .2126 * f(c[0]) + .7152 * f(c[1]) + .0722 * f(c[2]); };
  const over = (top, under) => [0, 1, 2].map(i => top[i] * top[3] + under[i] * (1 - top[3])).concat(1);
  window.__nav = {
    parse, alpha: s => parse(s)[3],
    // text colour vs the glass composited over the page bg (worst case of white/black content under the glass is checked too)
    contrast: (fg, glass, under) => { const g = over(parse(glass), parse(under)); const a = lum(parse(fg)), b = lum(g); return (Math.max(a, b) + .05) / (Math.min(a, b) + .05); },
  };
})()`;
const SEED = async () => {
  const S = window.__app.Store; await S.removeWhere(() => true);
  const d0 = window.__app.ymd(window.__app.nowWall()); const base = new Date(d0 + 'T00:00:00Z');
  const day = k => new Date(base.getTime() + k * 864e5).toISOString().slice(0, 10);
  const cals = ['msc', 'mam', 'lifetime'];
  let i = 0;
  for (let k = -3; k <= 3; k++) for (let h = 6; h <= 21; h += 1.5) {
    const hh = Math.floor(h), mm = h % 1 ? '30' : '00';
    await S.save({ id: crypto.randomUUID(), kind: 'event', calendar: cals[i % 3], category: ['Client workout', 'Meeting', 'Team practice – Maryville University'][i % 3], title: ['Client session', 'Team film review', 'Practice block', 'Strategy call', 'Lift + mobility'][i % 5] + ' ' + (++i),
      allDay: false, start: `${day(k)}T${String(hh).padStart(2, '0')}:${mm}`, end: `${day(k)}T${String(hh + 1).padStart(2, '0')}:${mm}`, location: '', notes: '', recurrence: { freq: 'none' } });
  }
  for (let t = 0; t < 22; t++) await S.save({ id: crypto.randomUUID(), kind: 'task', calendar: cals[t % 3], title: 'To-do item number ' + (t + 1), category: 'Task / to-do', allDay: true, start: d0, end: d0, scope: 'day', recurrence: { freq: 'none', interval: 1 } });
  window.__app.refresh();
};
(async () => {
  const b = await chromium.launch({ executablePath: '/usr/bin/google-chrome', headless: true, args: ['--no-sandbox'] });
  async function open({ dark = false, reduced = false, video = '' } = {}) {
    const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, timezoneId: 'America/Chicago', locale: 'en-US', isMobile: true, hasTouch: true, deviceScaleFactor: 2,
      reducedMotion: reduced ? 'reduce' : 'no-preference', colorScheme: dark ? 'dark' : 'light', ...(video ? { recordVideo: { dir: video, size: { width: 390, height: 844 } } } : {}) });
    const p = await ctx.newPage(); const errs = []; p.on('pageerror', e => errs.push(e.message));
    await p.clock.install({ time: new Date('2026-11-18T16:00:00Z') }); // Wed Nov 18, 10 AM CT
    await p.goto(BASE); await p.waitForFunction(() => window.__app && window.__app.Store);
    await p.evaluate(() => { localStorage.clear(); sessionStorage.clear(); }); await p.goto(BASE);
    await p.waitForFunction(() => window.__app && window.__app.Store && window.SandyNav && window.SandyNavBar);
    await p.evaluate(SEED); await p.evaluate(d => window.SandyNav.setDark(d), dark); await p.evaluate(CONTRAST); await p.waitForTimeout(500);
    return { ctx, p, errs };
  }
  const tabs = ['home', 'today', 'todo', 'search', 'profile'];
  const navState = p => p.evaluate(() => { const nav = document.getElementById('bottomNav'); const cs = getComputedStyle(nav); const m = new DOMMatrix(cs.transform);
    const lab = document.querySelector('#bottomNav button[aria-current=page] > span'); const btns = [...document.querySelectorAll('#bottomNav button')].map(x => x.getBoundingClientRect());
    return { compact: nav.classList.contains('nav-compact'), ty: m.m42, sx: m.m11, w: nav.getBoundingClientRect().width, labelOp: +getComputedStyle(lab).opacity, top: nav.getBoundingClientRect().top, minVisible: Math.min(...btns.map(r => Math.min(r.bottom, innerHeight) - r.top)), minW: Math.min(...btns.map(r => r.width)) }; });
  const pillInfo = p => p.evaluate(() => { const pl = document.querySelector('#bottomNav .nav-pill').getBoundingClientRect(); const a = document.querySelector('#bottomNav button[aria-current=page]').getBoundingClientRect();
    return { pc: pl.left + pl.width / 2, bc: a.left + a.width / 2, w: pl.width, h: pl.height }; });
  const go = async (p, t) => { await p.click(`#bottomNav [data-tab=${t}]`); await p.waitForTimeout(450); };
  const settle = p => p.waitForTimeout(400);
  // scroll a scroller in small steps (like a finger), so per-frame sampling sees each step
  const scrollBy = async (p, dy, sel = null) => { const steps = Math.max(1, Math.round(Math.abs(dy) / 12)); for (let i = 0; i < steps; i++) { await p.evaluate(([s, d, sel]) => { document.dispatchEvent(new Event('touchmove')); const el = sel ? document.querySelector(sel) : document.scrollingElement; el.scrollTop += d; }, [null, dy / steps, sel]); await p.waitForTimeout(20); } await settle(p); };
  const toTop = async (p, sel = null) => { await p.evaluate(sel => { document.dispatchEvent(new Event('touchmove')); const el = sel ? document.querySelector(sel) : document.scrollingElement; el.scrollTop = 0; }, sel); await settle(p); };

  for (const dark of [false, true]) {
    const tag = dark ? 'dark' : 'light';
    const { ctx, p, errs } = await open({ dark });
    // ---------------- translucency
    const g = await p.evaluate(() => { const nav = document.getElementById('bottomNav'); const cs = getComputedStyle(nav);
      return { bf: cs.backdropFilter || '', wbf: cs.webkitBackdropFilter || '', bg: cs.backgroundColor, bt: parseFloat(cs.borderTopWidth), btc: cs.borderTopColor, pos: cs.position, pageBg: getComputedStyle(document.body).backgroundColor,
        css: [...document.styleSheets].some(s => { try { return [...s.cssRules].some(r => /-webkit-backdrop-filter/.test(r.cssText) && /bottom-nav/.test(r.cssText)); } catch (_) { return false; } }),
        fallback: [...document.styleSheets].some(s => { try { return [...s.cssRules].some(r => r.constructor.name === 'CSSSupportsRule' && /not/.test(r.conditionText) && /backdrop-filter/.test(r.conditionText) && /bottom-nav/.test(r.cssText)); } catch (_) { return false; } }) }; });
    assert(/blur\(20px\)/.test(g.bf) && /saturate/.test(g.bf), `${tag}: backdrop-filter = ${g.bf}`);
    assert(g.css || /blur/.test(g.wbf), `${tag}: -webkit-backdrop-filter present for iOS Safari`);
    assert(g.fallback, `${tag}: @supports not (backdrop-filter) fallback rule present`);
    const al = await p.evaluate(s => window.__nav.alpha(s), g.bg);
    assert(al >= .55 && al <= .8, `${tag}: semi-transparent background (${g.bg}, alpha ${al})`);
    assert(g.bt > 0 && g.bt <= 1 && g.pos === 'fixed', `${tag}: subtle 1px border (${g.bt}px ${g.btc})`);
    // floating capsule: rounded, inset from the sides, lifted above the bottom edge (home indicator), soft shadow, border on all sides
    const fc = await p.evaluate(() => { const nav = document.getElementById('bottomNav'); const cs = getComputedStyle(nav); const r = nav.getBoundingClientRect();
      return { left: r.left, right: innerWidth - r.right, gap: innerHeight - r.bottom, rad: parseFloat(cs.borderTopLeftRadius), h: r.height, shadow: cs.boxShadow,
        sides: ['Top', 'Right', 'Bottom', 'Left'].every(k => parseFloat(cs['border' + k + 'Width']) > 0) }; });
    assert(fc.left >= 12 && fc.left <= 16 && fc.right >= 12 && fc.right <= 16, `${tag}: floating capsule inset from the sides (${fc.left.toFixed(1)} / ${fc.right.toFixed(1)}px)`);
    assert(fc.gap >= 8 && fc.gap <= 12, `${tag}: capsule lifted ${fc.gap.toFixed(1)}px above the bottom (+ safe-area inset on iOS)`);
    assert(fc.rad >= fc.h / 2 - 1, `${tag}: capsule shape (radius ${fc.rad}px, height ${fc.h.toFixed(0)}px)`);
    assert(fc.shadow && fc.shadow !== 'none' && fc.sides, `${tag}: soft drop shadow + 1px border all round (${fc.shadow.slice(0, 40)}...)`);
    const sa = await p.evaluate(() => [...document.styleSheets].some(s => { try { return [...s.cssRules].some(r => /\.bottom-nav/.test(r.selectorText || '') && /safe-area-inset-bottom/.test(r.style && r.style.bottom || '')); } catch (_) { return false; } }));
    assert(sa, `${tag}: capsule bottom includes env(safe-area-inset-bottom)`);
    // toast floats above the capsule
    const ts = await p.evaluate(async () => { window.__app.toast && window.__app.toast('Saved'); await new Promise(r => setTimeout(r, 100)); const t = document.getElementById('toast'); if (!t || t.hidden) return null;
      return { tb: t.getBoundingClientRect().bottom, nt: document.getElementById('bottomNav').getBoundingClientRect().top }; });
    assert(ts && ts.tb <= ts.nt, `${tag}: toast sits above the floating bar (${ts && ts.tb.toFixed(0)} <= ${ts && ts.nt.toFixed(0)})`);
    // content really is under the bar while scrolling (List view, event rows pass behind it)
    await p.evaluate(() => window.__app.calendar.changeView('listWeek')); await settle(p);
    await scrollBy(p, 600);
    const under = await p.evaluate(() => { const r = document.getElementById('bottomNav').getBoundingClientRect(); const x = 120, y = r.top + 20;
      const els = document.elementsFromPoint(x, y); return { first: els[0] && els[0].closest('#bottomNav') ? 'nav' : 'other', calUnder: els.some(e => e.closest && e.closest('#calendar')) }; });
    assert(under.first === 'nav' && under.calUnder, `${tag}: List rows scroll underneath the glass bar`);
    await p.evaluate(() => window.SandyNavBar.set(false)); await settle(p);
    await p.screenshot({ path: `${SHOTS}/glass_over_list_${tag}.png`, clip: { x: 0, y: 844 - 260, width: 390, height: 260 } });
    await p.screenshot({ path: `${SHOTS}/full_${tag}.png` });
    await scrollBy(p, 120); await p.screenshot({ path: `${SHOTS}/shrunk_${tag}.png` });
    await p.screenshot({ path: `${SHOTS}/shrunk_bar_${tag}.png`, clip: { x: 0, y: 844 - 160, width: 390, height: 160 } });
    await scrollBy(p, -80); await p.screenshot({ path: `${SHOTS}/full_bar_${tag}.png`, clip: { x: 0, y: 844 - 160, width: 390, height: 160 } });
    await toTop(p);

    // ---------------- pill on every tab + slide
    for (const t of tabs) {
      await go(p, t); const pi = await pillInfo(p);
      assert(Math.abs(pi.pc - pi.bc) <= 2 && pi.w >= 50 && pi.h >= 28, `${tag}: pill centred under the active "${t}" tab (pill ${pi.pc.toFixed(1)} vs tab ${pi.bc.toFixed(1)})`);
      const col = await p.evaluate(() => { const on = document.querySelector('#bottomNav button[aria-current=page]'); const off = document.querySelector('#bottomNav button:not([aria-current])');
        const nav = getComputedStyle(document.getElementById('bottomNav')).backgroundColor, pg = getComputedStyle(document.body).backgroundColor, pill = getComputedStyle(document.querySelector('.nav-pill')).backgroundColor;
        const sOn = getComputedStyle(on.querySelector('span')), sOff = getComputedStyle(off.querySelector('span'));
        // worst case for the glass: pure white and pure black content under the bar
        const cOff = Math.min(window.__nav.contrast(sOff.color, nav, pg), window.__nav.contrast(sOff.color, nav, 'rgb(255, 255, 255)'), window.__nav.contrast(sOff.color, nav, 'rgb(0, 0, 0)'));
        const cOn = window.__nav.contrast(sOn.color, nav, pg);
        return { on: sOn.color, off: sOff.color, fwOn: +sOn.fontWeight, fwOff: +sOff.fontWeight, swOn: parseFloat(getComputedStyle(on.querySelector('svg') || on).strokeWidth) || 0, swOff: parseFloat(getComputedStyle(off.querySelector('svg')).strokeWidth), cOn, cOff, pill }; });
      if (t === 'home') {
        assert(col.on !== col.off && col.fwOn > col.fwOff && (col.swOn === 0 || col.swOn > col.swOff), `${tag}: active tab in full colour + weight (${col.on} ${col.fwOn}) vs muted inactive (${col.off} ${col.fwOff})`);
        assert(col.cOn >= 4.5 && col.cOff >= 4.5, `${tag}: labels readable on the glass (active ${col.cOn.toFixed(2)}:1, inactive worst case ${col.cOff.toFixed(2)}:1)`);
        assert(p.evaluate && (await p.evaluate(s => window.__nav.alpha(s), col.pill)) > 0, `${tag}: pill is a soft tint (${col.pill})`);
      }
      if (t === 'home' || t === 'todo' || t === 'profile') await p.screenshot({ path: `${SHOTS}/pill_${t}_${tag}.png`, clip: { x: 0, y: 844 - 120, width: 390, height: 120 } });
    }
    // slide: sample mid-transition when jumping Home -> Profile
    await go(p, 'home'); const from = (await pillInfo(p)).pc;
    const tr = await p.evaluate(() => { const cs = getComputedStyle(document.querySelector('.nav-pill')); return { prop: cs.transitionProperty, dur: cs.transitionDuration, tf: cs.transitionTimingFunction }; });
    assert(/transform/.test(tr.prop) && /0\.25s/.test(tr.dur) && /ease/.test(tr.tf), `${tag}: pill transition = transform ${tr.dur} ${tr.tf}`);
    await p.evaluate(() => document.querySelector('#bottomNav [data-tab=profile]').click()); await p.waitForTimeout(110);
    const mid = (await pillInfo(p)).pc; await p.waitForTimeout(400); const to = (await pillInfo(p)).pc;
    assert(mid > from + 20 && mid < to - 20, `${tag}: pill SLIDES between tabs (${from.toFixed(0)} -> ${mid.toFixed(0)} mid-way -> ${to.toFixed(0)})`);

    // ---------------- shrink / restore in every view
    const check = async (label, sel = null) => {
      await toTop(p, sel); let s = await navState(p);
      assert(!s.compact && Math.abs(s.ty) < .5, `${tag} ${label}: full size at the top`);
      await scrollBy(p, 12, sel); s = await navState(p); assert(!s.compact, `${tag} ${label}: tiny scroll (12px) stays full (threshold)`);
      await scrollBy(p, 160, sel); s = await navState(p);
      assert(s.compact && s.ty > 4 && s.ty < 9 && s.sx > .85 && s.sx < .95 && s.labelOp < .05, `${tag} ${label}: scrolling DOWN shrinks the capsule (scale ${s.sx.toFixed(2)}, settles ${s.ty.toFixed(1)}px lower, labels ${s.labelOp})`);
      assert(s.minVisible >= 44 && s.minW >= 44, `${tag} ${label}: tap targets still >= 44px when shrunk (${s.minVisible.toFixed(0)}px tall, ${s.minW.toFixed(0)}px wide)`);
      await scrollBy(p, -8, sel); await scrollBy(p, 8, sel); s = await navState(p); assert(s.compact, `${tag} ${label}: small jitter doesn't flip it`);
      await scrollBy(p, -60, sel); s = await navState(p);
      assert(!s.compact && Math.abs(s.ty) < .5 && Math.abs(s.sx - 1) < .01 && s.labelOp > .95, `${tag} ${label}: scrolling back UP restores full size`);
      await toTop(p, sel);
    };
    await go(p, 'home');
    for (const v of ['listWeek', 'timeGridDay', 'timeGridWeek', 'dayGridMonth']) { await p.evaluate(v => window.__app.calendar.changeView(v), v); await settle(p); await check(v); }
    await go(p, 'today'); await check('Today');
    await go(p, 'todo'); await check('To-Do');
    await go(p, 'search'); await p.fill('#searchInput, .search-box input', 'e').catch(() => {}); await settle(p);
    if (await p.evaluate(() => document.scrollingElement.scrollHeight - innerHeight < 300)) await p.evaluate(() => { const d = document.createElement('div'); d.id = 'padTest'; d.style.height = '1200px'; document.querySelector('.tab-page:not([hidden])')?.appendChild(d); });
    await check('Search');
    await go(p, 'profile'); await check('Profile');
    // inner scroll container
    await go(p, 'home'); await p.evaluate(() => { const d = document.createElement('div'); d.id = 'innerScroll'; d.style.cssText = 'height:300px;overflow-y:auto'; d.innerHTML = '<div style="height:1500px">inner</div>';
      document.querySelector('#calendar').before(d); }); await check('inner scroller', '#innerScroll'); await p.evaluate(() => document.getElementById('innerScroll').remove());
    // tab switch resets to full size
    await scrollBy(p, 200); assert((await navState(p)).compact, `${tag}: compact after scrolling Home`);
    await go(p, 'todo'); assert(!(await navState(p)).compact, `${tag}: switching tab returns the bar to full size`);
    // app-initiated scroll (no wheel/touch/key input) never shrinks it -- e.g. List auto-scrolling to "now"
    await go(p, 'home'); await toTop(p); await p.waitForTimeout(1400);
    for (let i = 0; i < 10; i++) { await p.evaluate(() => { document.scrollingElement.scrollTop += 30; }); await p.waitForTimeout(20); } await settle(p);
    assert(!(await navState(p)).compact, `${tag}: programmatic scroll (no user input) keeps the bar full size`);
    // horizontal scrolling (swipe pager) never shrinks it
    await go(p, 'home'); await toTop(p);
    await p.evaluate(() => { const d = document.createElement('div'); d.id = 'hScroll'; d.style.cssText = 'width:300px;overflow-x:auto;white-space:nowrap'; d.innerHTML = '<div style="width:2000px;height:20px"></div>'; document.querySelector('#calendar').before(d); });
    for (let i = 0; i < 10; i++) { await p.evaluate(() => { document.getElementById('hScroll').scrollLeft += 40; }); await p.waitForTimeout(20); }
    assert(!(await navState(p)).compact, `${tag}: horizontal scrolling doesn't shrink it`); await p.evaluate(() => document.getElementById('hScroll').remove());

    // ---------------- last content row not hidden (full and compact), List + To-Do
    for (const [t, v, sel] of [['home', 'listWeek', '#calendar .fc-list-event:last-of-type, #calendar tr.fc-list-event'], ['todo', null, '.tab-page:not([hidden]) li, .todo-list li']]) {
      await go(p, t); if (v) { await p.evaluate(v => window.__app.calendar.changeView(v), v); await settle(p); }
      await p.evaluate(() => window.scrollTo(0, document.scrollingElement.scrollHeight)); await settle(p);
      for (const full of [true, false]) {
        await p.evaluate(f => window.SandyNavBar.set(!f), full); await settle(p);
        const r = await p.evaluate(sel => { const all = [...document.querySelectorAll(sel)].filter(e => e.offsetParent); const last = all[all.length - 1]; const nav = document.getElementById('bottomNav').getBoundingClientRect();
          return last ? { bottom: last.getBoundingClientRect().bottom, navTop: nav.top, txt: last.textContent.trim().slice(0, 30) } : null; }, sel);
        assert(r && r.bottom <= r.navTop + 1, `${tag} ${t}: last row "${r && r.txt}" ends above the bar (${r && r.bottom.toFixed(0)} <= ${r && r.navTop.toFixed(0)}, ${full ? 'full' : 'shrunk'})`);
      }
      await p.evaluate(() => window.SandyNavBar.set(false)); await toTop(p);
    }
    // ---------------- dialog sits above the bar
    await go(p, 'home'); await p.click('#newEventBtn, .topbar .primary').catch(() => {}); await p.waitForTimeout(500);
    const dlg = await p.evaluate(() => { const d = [...document.querySelectorAll('dialog')].find(x => x.open); if (!d) return null; const r = document.getElementById('bottomNav').getBoundingClientRect(); const el = document.elementFromPoint(195, r.top + 20); return { navHit: !!(el && el.closest('#bottomNav')) }; });
    assert(dlg && !dlg.navHit, `${tag}: an open dialog/sheet sits above the bar`);
    await p.keyboard.press('Escape'); await p.waitForTimeout(400);
    assert(errs.length === 0, `${tag}: no page errors ${errs.join(' | ')}`);
    await ctx.close();
  }
  // ---------------- reduced motion: no transitions, states switch instantly (still never jitters at the top)
  { const { ctx, p, errs } = await open({ reduced: true });
    const t = await p.evaluate(() => [getComputedStyle(document.getElementById('bottomNav')).transitionDuration, getComputedStyle(document.querySelector('.nav-pill')).transitionDuration, getComputedStyle(document.querySelector('#bottomNav button span')).transitionDuration]);
    assert(t.every(x => /^0s(, 0s)*$/.test(x)), `reduced motion: no nav / pill / label transitions (${t.join(' | ')})`);
    await p.evaluate(() => window.__app.calendar.changeView('listWeek')); await settle(p);
    await scrollBy(p, 200); let s = await navState(p); assert(s.compact && s.ty > 4 && s.sx < .95, 'reduced motion: shrinks instantly on scroll down');
    await scrollBy(p, -60); s = await navState(p); assert(!s.compact && Math.abs(s.ty) < .5, 'reduced motion: restores instantly on scroll up');
    await p.click('#bottomNav [data-tab=todo]'); await p.waitForTimeout(30); const pi = await pillInfo(p);
    assert(Math.abs(pi.pc - pi.bc) <= 2, 'reduced motion: pill jumps straight to the new tab');
    assert(errs.length === 0, 'reduced motion: no page errors'); await ctx.close(); }
  // ---------------- optional demo video
  if (VIDEO) { const { ctx, p } = await open({ video: VIDEO });
    await p.evaluate(() => window.__app.calendar.changeView('listWeek')); await p.waitForTimeout(800);
    for (let i = 0; i < 30; i++) { await p.mouse.wheel(0, 18); await p.waitForTimeout(30); } await p.waitForTimeout(700);
    for (let i = 0; i < 12; i++) { await p.mouse.wheel(0, -12); await p.waitForTimeout(30); } await p.waitForTimeout(700);
    for (const t of ['today', 'todo', 'search', 'profile', 'home']) { await p.click(`#bottomNav [data-tab=${t}]`); await p.waitForTimeout(800); }
    for (let i = 0; i < 25; i++) { await p.mouse.wheel(0, 20); await p.waitForTimeout(30); } await p.waitForTimeout(900);
    await ctx.close(); }
  console.log(`\n${n} checks passed`); await b.close();
})().catch(e => { console.error(e); process.exit(1); });
