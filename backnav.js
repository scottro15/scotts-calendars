/* Android back button / gesture (t135u).
   Mirrors SANDY's UI in browser history so the system Back:
     1) closes the top-most overlay (dialog / editor, quick-add sheet, AI panel, tour, welcome, …)
     2) otherwise returns to the previous tab
     3) only leaves the app from Home with nothing open.
   Overlays/tabs are detected by observing the DOM, so no module has to call in. URLs are never
   changed (pushState without a URL), so deep links, ?tab=, ?review=, magic-link hashes and the OTP
   flow are untouched. Disabled on iOS / iPadOS: the iPhone PWA behaves exactly as before. */
(function () {
  'use strict';
  const ua = navigator.userAgent || '';
  const iOS = /iP(hone|ad|od)/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  if (iOS || !window.history || !history.pushState) return;

  const TABS = ['home', 'today', 'todo', 'search', 'profile'];
  const $ = id => document.getElementById(id);
  const curTab = () => TABS.find(t => document.body.classList.contains('tab-' + t)) || 'home';

  // ---- overlay detectors (key → is it open? / how to close it like the user would)
  function openOverlays() {
    const out = [];
    for (const d of document.querySelectorAll('dialog[open]:not(.closing)')) {
      if (!d._bnKey) d._bnKey = 'dlg' + (++seq);
      out.push({ k: d._bnKey, close: () => { const ev = new Event('cancel', { cancelable: true }); d.dispatchEvent(ev); if (!ev.defaultPrevented && d.open) d.close(); } });
    }
    const qs = window.SandyQuickSheet;
    if (qs && qs.isOpen) out.push({ k: 'qs', close: () => qs.close() });
    const ai = $('aiSheet');
    if (ai && !ai.hidden && !ai.classList.contains('ai-closing') && window.SandyAI) out.push({ k: 'ai', close: () => SandyAI.close() });
    const wl = $('welcomeSheet');
    if (wl && !wl.classList.contains('leaving') && window.SandyWelcome) out.push({ k: 'welcome', close: () => SandyWelcome.close() });
    const offer = $('tourOffer');
    if (offer && document.contains(offer)) out.push({ k: 'tourOffer', close: () => { const b = $('tourLater'); if (b) b.click(); } });
    if (window.SandyTour && SandyTour.isActive && SandyTour.isActive()) out.push({ k: 'tour', close: () => SandyTour.end() });
    return out;
  }

  let seq = 0, order = [], pushed = 0, ignorePops = 0, lastTab = null, expectTab = null, raf = 0, ready = false;
  const st = (kind, extra) => Object.assign({ sandy: 1, kind, tab: curTab() }, extra || {});

  function sync() {
    raf = 0;
    if (!ready || ignorePops) return;
    const open = openOverlays();
    const keys = open.map(o => o.k);
    order = order.filter(k => keys.includes(k));
    for (const k of keys) if (!order.includes(k)) order.push(k);
    if (open.length > pushed) {
      while (pushed < open.length) { history.pushState(st('ov'), ''); pushed++; }
    } else if (open.length < pushed) {
      // closed from the UI (Cancel, Save, ×, backdrop, Escape): drop our now-stale history entries
      const n = pushed - open.length; pushed = open.length; ignorePops++; history.go(-n); return;
    }
    const t = curTab();
    if (t !== lastTab) {
      if (expectTab === t) expectTab = null;
      else if (pushed === 0) history.pushState(st('tab'), '');
      lastTab = t;
    }
  }
  const schedule = () => { if (!raf) raf = requestAnimationFrame(sync); };

  function onPop(e) {
    if (ignorePops) { ignorePops--; schedule(); return; }
    if (pushed > 0) {
      pushed--;
      const open = openOverlays();
      const topKey = order[order.length - 1];
      const top = open.find(o => o.k === topKey) || open[open.length - 1];
      if (top) { order = order.filter(k => k !== top.k); try { top.close(); } catch (_) {} }
      schedule(); // if the overlay refused to close, sync() re-pushes its entry
      return;
    }
    // no overlay: navigate tabs (base entry / foreign state = Home)
    const s = e.state && e.state.sandy ? e.state : null;
    const t = s && TABS.includes(s.tab) ? s.tab : 'home';
    if (t !== curTab() && window.SandyNav && SandyNav.go) { expectTab = t; SandyNav.go(t); }
    lastTab = curTab(); if (expectTab === lastTab) expectTab = null;
    schedule();
  }

  function init() {
    // Mark the entry we were loaded on as the Home base without touching the URL.
    try { history.replaceState(Object.assign({}, history.state || {}, { sandy: 1, kind: 'base', tab: 'home' }), ''); } catch (_) {}
    lastTab = 'home';
    window.addEventListener('popstate', onPop);
    new MutationObserver(schedule).observe(document.body, { subtree: true, childList: true, attributes: true, attributeFilter: ['open', 'class', 'hidden'] });
    ready = true; schedule();
  }
  window.SandyBack = { get depth() { return pushed; }, get order() { return order.slice(); } };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();
