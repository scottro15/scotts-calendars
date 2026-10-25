/* SANDY - bottom nav v2 (Scott 2026-10-25, nav2): floating capsule - sliding active pill + shrink-on-scroll.
   - Pill: one .nav-pill behind the active tab; its x comes from the active button's centre (relative to the bar) via the
     --pill-x custom property, so switching tabs slides it (CSS transform transition, 250ms ease). Re-placed when
     aria-current changes (nav.js go()), on resize and when fonts/avatars load. No animation on the first placement.
   - Shrink: any vertical scroll (window or an inner scroller: List/Day/Week/Month, Today, To-Do, Search, Profile...)
     is sampled once per frame (passive capture listener + rAF). A user-driven (touch/wheel/scroll-key) move DOWN the content by > DOWN_PX (accumulated in
     one direction) adds .nav-compact; moving back UP by > UP_PX, reaching the top (<= TOP_PX) or switching tab
     removes it (scrolls in the 700ms after a tab switch only re-baseline). Horizontal scrolling (swipe pager), dialogs, sheets, inputs and the AI chat log are ignored.
   - prefers-reduced-motion: the same states apply instantly (CSS turns transitions off). */
(function () {
  'use strict';
  const nav = document.getElementById('bottomNav'); if (!nav) return;
  const DOWN_PX = 24, UP_PX = 16, TOP_PX = 8;
  const pill = document.createElement('span'); pill.className = 'nav-pill no-anim'; pill.setAttribute('aria-hidden', 'true');
  nav.insertBefore(pill, nav.firstChild);

  function place(animate) {
    const b = nav.querySelector('button[aria-current=page]');
    if (!b) { pill.style.opacity = '0'; return; }
    pill.style.opacity = '';
    if (!animate) pill.classList.add('no-anim');
    const w = pill.offsetWidth || 60;
    // rects include the bar's transform (translate + compact scale): undo the scale and the 1px border so x is in the bar's own px
    const nr = nav.getBoundingClientRect(), br = b.getBoundingClientRect(), k = nr.width / (nav.offsetWidth || nr.width || 1);
    nav.style.setProperty('--pill-x', ((br.left - nr.left + br.width / 2) / k - nav.clientLeft - w / 2).toFixed(1) + 'px');
    if (!animate) { void pill.offsetWidth; requestAnimationFrame(() => requestAnimationFrame(() => pill.classList.remove('no-anim'))); }
  }

  let compact = false;
  function set(on) { on = !!on; if (on === compact) return; compact = on; nav.classList.toggle('nav-compact', on); }

  const last = new WeakMap(); let acc = 0, pending = null, ticking = false, quietUntil = 0;
  const IGNORE = 'dialog, .ai-sheet, .ai-log, .ai-hist, .ac-list, .onb, textarea, input, select, .swipe-ghost, .inv-list, .fb-list';
  function scrollerOf(t) {
    if (t === document || t === window || t === document.documentElement || t === document.body) return document.scrollingElement || document.documentElement;
    return t instanceof Element ? t : null;
  }
  // Only a scroll the user is driving may SHRINK the bar; app-initiated scrolls (list auto-scroll to "now",
  // scroll restore, scrollIntoView) only re-baseline. Restoring to full size is always allowed.
  let userUntil = 0; const intent = () => { userUntil = performance.now() + 1200; };
  // (taps/clicks don't count: tapping a view button that then auto-scrolls must not shrink the bar)
  const SCROLL_KEYS = new Set(['ArrowDown', 'PageDown', 'End', ' ', 'Spacebar']);
  ['wheel', 'touchmove'].forEach(t => document.addEventListener(t, intent, { passive: true, capture: true }));
  document.addEventListener('keydown', e => { if (SCROLL_KEYS.has(e.key)) intent(); }, { passive: true, capture: true });
  function onScroll(e) {
    const el = scrollerOf(e.target); if (!el) return;
    if (el !== document.scrollingElement && el.closest(IGNORE)) return;
    pending = el; if (!ticking) { ticking = true; requestAnimationFrame(update); }
  }
  function update() {
    ticking = false; const el = pending; pending = null; if (!el) return;
    const max = Math.max(0, el.scrollHeight - el.clientHeight);
    const y = Math.min(Math.max(el.scrollTop, 0), max); // clamp iOS rubber-band overscroll
    const prev = last.get(el); last.set(el, y);
    if (performance.now() < quietUntil) return; // programmatic scroll right after a tab switch (scroll to top / to today)
    if (prev == null) { if (y <= TOP_PX) set(false); return; }
    const dy = y - prev; if (!dy) return;
    if (y <= TOP_PX && el === document.scrollingElement) { acc = 0; set(false); return; }
    if ((dy > 0) !== (acc > 0)) acc = 0;
    acc += dy;
    if (acc > DOWN_PX) { if (performance.now() < userUntil) set(true); acc = 0; } else if (acc < -UP_PX) { set(false); acc = 0; }
  }
  document.addEventListener('scroll', onScroll, { passive: true, capture: true });
  window.addEventListener('scroll', onScroll, { passive: true });

  new MutationObserver(() => { set(false); acc = 0; quietUntil = performance.now() + 700; requestAnimationFrame(() => place(true)); }).observe(nav, { subtree: true, attributes: true, attributeFilter: ['aria-current'] });
  window.addEventListener('resize', () => place(false), { passive: true });
  // tab widths can shift for a moment while a page slides in (the layout viewport briefly widens); follow them
  if (window.ResizeObserver) { const ro = new ResizeObserver(() => place(true)); nav.querySelectorAll('button').forEach(x => ro.observe(x)); }
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(() => place(false));
  place(false);
  window.SandyNavBar = { place, set, isCompact: () => compact, DOWN_PX, UP_PX, TOP_PX };
})();
