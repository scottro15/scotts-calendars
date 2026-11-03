/* snapview.js — speed step C (t182u): on a reopen, Today/Home appear at once from a saved picture of the page.
 *
 * SAVE (here, after the app is up): when Today or Home shows live data and is in its "fresh open" state (Today tab, or Home
 * on the range that holds today; no sheet/dialog open; not showing the offline copy), a cleaned copy of the visible page
 * (.layout without its hidden pages) is kept in localStorage under sandy.snap.v1.view.<tab>.<user id>, with the build tag,
 * the day + time zone, the window size, light/dark, the body classes that shape the layout, scroll offsets inside the page
 * and FullCalendar's own CSS. sandy.snap.v1.* is what sign-out already wipes, so a picture never outlives its sign-in.
 * DRAW (inline at the end of index.html <body>, before any app code): only for the same signed-in user, the same build,
 * the same day, the same window width (± small height change), the same theme, the same tab, no deep link; otherwise the
 * normal open runs unchanged (blank → app, or the skeleton on a first open).
 * HANDOVER (here): the picture is an inert cover (#snapView, under the top bar and bottom nav). When the app says that page
 * has real content (SandySkel.ready, the same signal that ends the skeleton) we wait until the live page stops changing
 * (max 1.2 s), then fade the cover out (120 ms; instant with reduced motion). It goes at once if the user switches tab, a
 * sheet/dialog or the sign-in screen opens, the user taps after the app is ready, or after 10 s whatever happens.
 * Nothing in the picture is clickable, and it never replaces any live element: the app runs exactly as before underneath.
 */
(function () {
  'use strict';
  const PFX = 'sandy.snap.v1.view.', FCKEY = 'sandy.snap.v1.viewcss', MAX = 350000;
  const tagNow = () => { const l = document.querySelector('link[href*="styles.css"]'); return l ? (new URL(l.href, location.href).searchParams.get('v') || '') : ''; };
  const ymdIn = tz => { try { return new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date()); } catch (_) { return ''; } };
  const reduce = () => document.documentElement.classList.contains('reduce-motion') || matchMedia('(prefers-reduced-motion: reduce)').matches;
  const BODY_CLS = /^(tab-(today|home)|today-simple|tt-grid|tt-one)$/;

  // ---------------------------------------------------------------- handover
  const V = window.__snapView; // set by the inline draw: { el, tab, css, t0 }
  let gone = !V;
  function drop(why, now) {
    if (gone) return; gone = true;
    const el = V.el; V.dropped = why; V.droppedAt = Math.round(performance.now());
    const end = () => el.remove();
    if (now || reduce()) end(); else { el.classList.add('snap-out'); setTimeout(end, 140); }
    document.documentElement.classList.remove('snap-on');
  }
  if (V) {
    V.drop = drop;
    // the app's "this page has real content" signal (also ends the skeleton on a first open)
    const prev = window.SandySkel;
    window.SandySkel = { tab: V.tab, ready(what) {
      try { if (prev && prev.ready) prev.ready(what); } catch (_) {}
      if (gone) return;
      if (what === 'any') return drop('other', true); // sign-in, welcome sheet, an error screen: show it as it is
      if (what === V.tab) settle();
    } };
    let settling = false;
    function settle() { // live page drawn: wait until it stops changing (cards fill in), then swap
      if (settling) return; settling = true; V.readyAt = Math.round(performance.now());
      V.el.style.pointerEvents = 'none'; // the live page is up underneath: taps go to it (the first one also removes the picture)
      const page = document.getElementById('page-home'); let t = null; const t0 = Date.now();
      // ... and until its own enter animations (Today's tab-in fade, card fades) have finished: fading the picture out
      // while the live card is still fading in would show an empty page for a moment
      const animsDone = () => { const L = document.querySelector('.layout'); let an = []; try { an = (document.getAnimations ? document.getAnimations() : []).filter(x => { const t = x.effect && x.effect.target; return t && L && L.contains(t) && x.playState === 'running' && !(x.effect.getTiming && x.effect.getTiming().iterations === Infinity); }); } catch (_) {}
        return an.length ? Promise.race([Promise.all(an.map(x => x.finished.catch(() => {}))), new Promise(r => setTimeout(r, 700))]) : Promise.resolve(); };
      let fin = false;
      const scrolled = () => new Promise(res => { const t1 = Date.now(); (function chk() { if (Math.abs(scrollY - (V.sy || 0)) <= 4 || Date.now() - t1 > 1500) return res(); setTimeout(chk, 50); })(); });
      const done = () => { if (fin) return; fin = true; mo.disconnect(); Promise.all([animsDone(), scrolled()]).then(() => requestAnimationFrame(() => drop('live'))); };
      const mo = new MutationObserver(() => { if (Date.now() - t0 > 1200) return done(); clearTimeout(t); t = setTimeout(done, 150); });
      if (page) mo.observe(page, { childList: true, subtree: true, attributes: true, characterData: true });
      t = setTimeout(done, 150); setTimeout(() => { if (!gone) done(); }, 1250);
    }
    // anything that makes the picture wrong goes at once: another tab, a sheet / dialog / sign-in screen, a tap
    const bodyMo = new MutationObserver(() => {
      const b = document.body.classList;
      if ([...b].some(c => /^tab-/.test(c) && c !== 'tab-' + V.tab)) drop('tab', true);
      if (b.contains('qs-open') || b.contains('wl-open') || b.contains('tour-open') || document.documentElement.classList.contains('ai-open')) drop('sheet', true);
    });
    bodyMo.observe(document.body, { attributes: true, attributeFilter: ['class'] });
    const dark0 = document.documentElement.classList.contains('dark');
    new MutationObserver(() => { const h = document.documentElement.classList; if (h.contains('ai-open')) drop('sheet', true); if (h.contains('dark') !== dark0) drop('theme', true); }).observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
    const gate = document.getElementById('authGate');
    if (gate) new MutationObserver(() => { if (!gate.hidden) drop('signin', true); }).observe(gate, { attributes: true, attributeFilter: ['hidden'] });
    document.addEventListener('toggle', e => { if (e.target && e.target.open) drop('dialog', true); }, true);
    document.addEventListener('pointerdown', () => { if (V.readyAt) drop('tap', true); }, true); // before ready the picture takes taps (the app can't act on them yet, as before)
    setTimeout(() => drop('timeout', true), Math.max(0, 10000 - (performance.now() - (V.t0 || 0))));
    window.addEventListener('pagehide', () => drop('leave', true));
  }

  // ---------------------------------------------------------------- save
  function uidNow() {
    try { const C = window.CALENDAR_CONFIG || {}; const ref = (/^https:\/\/([^.]+)\./.exec(C.SUPABASE_URL || '') || [])[1]; if (!ref) return null;
      let s = JSON.parse(localStorage.getItem('sb-' + ref + '-auth-token') || 'null'); if (s && s.currentSession) s = s.currentSession;
      return s && s.user && s.user.id || null; } catch (_) { return null; }
  }
  function freshState() { // is the page what a fresh open of this tab would show?
    const a = window.__app; if (!a || !a.Store || a.Store.mode !== 'supabase' || a.Store.offline || window.__sandySnapOff) return null;
    if (!gone || document.getElementById('skel')) return null; // our own cover / skeleton still up
    const b = document.body.classList; const t0 = window.SandyNav && SandyNav.tab; const tab = t0 === 'today' || t0 === 'home' ? t0 : null; if (!tab) return null;
    if (tab === 'home' && (b.contains('tab-today') || document.getElementById('page-home').hidden)) return null;
    if (document.querySelector('dialog[open]') || b.contains('qs-open') || b.contains('wl-open') || b.contains('tour-open') || document.documentElement.classList.contains('ai-open')) return null;
    const gate = document.getElementById('authGate'); if (gate && !gate.hidden) return null;
    if (document.visibilityState === 'hidden' && !saveOnHide) return null;
    const tz = a.timeZone ? a.timeZone() : Intl.DateTimeFormat().resolvedOptions().timeZone; const day = ymdIn(tz);
    try { const v = a.calendar.view; const s = a.ymd(v.currentStart), e = a.ymd(v.currentEnd); if (!(day >= s && day < e)) return null; } catch (_) { return null; }
    if (tab === 'today' && !document.querySelector('#todayBody .tc-summary')) return null;
    if (tab === 'home' && !document.querySelector('#calendar .fc-view')) return null;
    // only the position a fresh open lands on: Today at the top; Home's List at today's header (app.js scrolls there
    // on open), any other Home view at the top with nothing scrolled inside (a time grid opens at its own start time)
    let sy = 0;
    if (tab === 'home' && /^list/.test(a.calendar.view.type)) {
      const h = document.querySelector('#calendar .sandy-today-first'); if (!h) return null;
      const cs = getComputedStyle(document.documentElement); const off = (parseFloat(cs.getPropertyValue('--topbar-h')) || 0) + (parseFloat(cs.getPropertyValue('--fc-toolbar-h')) || 0);
      const se = document.scrollingElement || document.documentElement; const y = Math.min(h.getBoundingClientRect().top + scrollY - off, se.scrollHeight - innerHeight); sy = y > 0 ? y : 0; /* the browser stops at the bottom of the page */
      if (Math.abs(scrollY - sy) > 4) return null; sy = Math.round(scrollY);
    } else {
      if (scrollY > 4) return null;
      if ([...document.querySelectorAll('.layout *')].some(e => e.scrollTop > 0 && e.scrollHeight > e.clientHeight && getComputedStyle(e).overflowY !== 'visible')) return null;
    }
    return { tab, tz, day, sy };
  }
  let saveOnHide = false;
  function capture(st) {
    const live = document.querySelector('.layout'); if (!live) return null;
    const r = live.getBoundingClientRect();
    // scroll offsets inside the page (calendar scrollers) travel as attributes on the copy
    const scrolled = [...live.querySelectorAll('*')].filter(e => e.scrollTop > 0 || e.scrollLeft > 0);
    scrolled.forEach(e => e.setAttribute('data-snap-st', e.scrollTop + ',' + e.scrollLeft));
    const c = live.cloneNode(true);
    scrolled.forEach(e => e.removeAttribute('data-snap-st'));
    // form state lives in properties, not attributes
    const lf = live.querySelectorAll('input, select, textarea'), cf = c.querySelectorAll('input, select, textarea');
    lf.forEach((e, i) => { const k = cf[i]; if (!k) return; if (e.type === 'checkbox' || e.type === 'radio') { if (e.checked) k.setAttribute('checked', ''); else k.removeAttribute('checked'); } else if (e.tagName === 'TEXTAREA') k.textContent = e.value; else if (e.tagName !== 'SELECT') k.setAttribute('value', e.value); });
    c.querySelectorAll('[hidden], script, template, iframe, video, audio, object, embed, dialog').forEach(e => e.remove());
    c.querySelectorAll('img').forEach(e => { const s = e.getAttribute('src') || ''; if (!/^(data:|[\w./-]+\.(svg|png|webp|jpe?g)$)/i.test(s)) e.removeAttribute('src'); e.removeAttribute('srcset'); });
    for (const e of [c, ...c.querySelectorAll('*')]) for (const at of [...e.attributes]) if (/^on/i.test(at.name) || at.name === 'autofocus' || ((at.name === 'href' || at.name === 'src' || at.name === 'action') && /^\s*javascript:/i.test(at.value))) e.removeAttribute(at.name);
    c.setAttribute('aria-hidden', 'true');
    const html = c.outerHTML;
    if (html.length > MAX) return null;
    return { v: 1, uid: null, tag: tagNow(), tab: st.tab, tz: st.tz, day: st.day, w: innerWidth, h: innerHeight, dark: document.documentElement.classList.contains('dark'),
      body: [...document.body.classList].filter(x => BODY_CLS.test(x)), html_: [...document.documentElement.classList].filter(x => /^lay-(tablet|wide|rail)$/.test(x)), top: Math.round(r.top + scrollY), left: Math.round(r.left), width: Math.round(r.width),
      sy: st.sy, sh: (document.scrollingElement || document.documentElement).scrollHeight,
      vars: [document.documentElement, document.body].map(e => [...e.style].filter(p => p.indexOf('--') === 0).map(p => p + ':' + e.style.getPropertyValue(p)).join(';')), /* sticky offsets etc. (syncStickyOffsets) */ at: Date.now(), html };
  }
  function save() {
    try {
      const st = freshState(); if (!st) return; const uid = uidNow(); if (!uid) return;
      const v = capture(st); if (!v) { localStorage.removeItem(PFX + st.tab + '.' + uid); return; }
      v.uid = uid;
      const fc = [...document.querySelectorAll('style[data-fullcalendar]')].map(s => { try { return s.textContent || [...s.sheet.cssRules].map(r => r.cssText).join('\n'); } catch (_) { return ''; } }).join('\n'); // FullCalendar adds its rules with insertRule
      const old = JSON.parse(localStorage.getItem(FCKEY) || 'null');
      if (fc && (!old || old.tag !== v.tag || old.css !== fc)) localStorage.setItem(FCKEY, JSON.stringify({ tag: v.tag, css: fc }));
      localStorage.setItem(PFX + st.tab + '.' + uid, JSON.stringify(v));
      SandySnapView.savedAt = Date.now();
    } catch (_) { /* full storage etc.: the picture is optional; the data copy (sandy.snap.v1.events …) is never touched */ }
  }
  let t = null;
  let pend = null; // window size when a save was asked for: leaving the page only flushes that pending save, at that size
  const later = (ms = 1500) => { clearTimeout(t); pend = innerWidth + 'x' + innerHeight; t = setTimeout(() => (window.requestIdleCallback || setTimeout)(() => { pend = null; save(); }, { timeout: 2000 }), ms); };
  function hook() {
    if (!window.__snapViewOn) { try { for (let i = localStorage.length - 1; i >= 0; i--) { const k = localStorage.key(i) || ''; if (k.indexOf(PFX) === 0 || k === FCKEY) localStorage.removeItem(k); } } catch (_) {} return; }
    const a = window.__app; if (!a || !a.Store) return setTimeout(hook, 300);
    if (a.Store.mode !== 'supabase') return; // local mode: no sign-in, no picture
    a.Store.onChange(() => later());
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden' && pend && pend === innerWidth + 'x' + innerHeight) { clearTimeout(t); pend = null; saveOnHide = true; save(); saveOnHide = false; } });
    new MutationObserver(() => later()).observe(document.body, { attributes: true, attributeFilter: ['class'] }); // tab switches
    later(2500); // first save once the opening page has settled
  }
  window.SandySnapView = { save, freshState, drop: V ? drop : () => {}, view: V || null };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', hook); else hook();
})();
