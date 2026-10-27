// SANDY motion: small, purposeful UI animations (CSS does the drawing; this file sequences
// exit animations so elements are only closed/hidden after they finish).
// Respects prefers-reduced-motion: everything becomes instant.
(function () {
  const mq = window.matchMedia ? matchMedia('(prefers-reduced-motion: reduce)') : { matches: false };
  const reduced = () => mq.matches;
  const sync = () => document.documentElement.classList.toggle('reduce-motion', reduced());
  sync(); if (mq.addEventListener) mq.addEventListener('change', sync);

  // Run an exit class, then call done() once its animation/transition ends (with a safety timeout).
  function runExit(el, cls, done, ms = 200) {
    if (reduced()) { done(); return; }
    let fin = false;
    const end = e => { if (e && e.target !== el) return; if (fin) return; fin = true; el.removeEventListener('animationend', end); el.removeEventListener('transitionend', end); clearTimeout(t); el.classList.remove(cls); done(); };
    el.addEventListener('animationend', end); el.addEventListener('transitionend', end);
    const t = setTimeout(end, ms + 80);
    el.classList.add(cls);
  }

  // Remember where the user last pressed, so dialogs grow out of the clicked thing.
  let lastPt = null;
  document.addEventListener('pointerdown', e => { lastPt = { x: e.clientX, y: e.clientY, t: Date.now() }; }, true);

  const P = HTMLDialogElement.prototype;
  const nativeShow = P.showModal, nativeClose = P.close;
  P.showModal = function () {
    this._closeTok = (this._closeTok || 0) + 1; // cancel a close still animating out
    this.classList.remove('closing');
    if (this.open) nativeClose.call(this);
    nativeShow.call(this);
    if (lastPt && Date.now() - lastPt.t < 1500) {
      const r = this.getBoundingClientRect();
      const ox = Math.max(0, Math.min(r.width, lastPt.x - r.left)), oy = Math.max(0, Math.min(r.height, lastPt.y - r.top));
      this.style.transformOrigin = `${ox}px ${oy}px`;
    } else this.style.transformOrigin = '';
    this.classList.add('anim-in');
  };
  P.close = function (rv) {
    if (!this.open || this.classList.contains('closing')) { if (!this.open) return; return; }
    this.classList.remove('anim-in');
    if (reduced()) { nativeClose.call(this, rv); return; }
    const tok = this._closeTok = (this._closeTok || 0) + 1;
    runExit(this, 'closing', () => { if (this.open && this._closeTok === tok) nativeClose.call(this, rv); }, this.id === 'eventDialog' ? 260 : 200);
  };

  function wireDialog(d) {
    // Escape: animate out instead of the instant native close (preventDefault only if nothing else did).
    d.addEventListener('cancel', e => { if (e.defaultPrevented) return; e.preventDefault(); d.close(); });
    // <form method="dialog"> buttons close natively; route them through the animated close.
    const form = d.querySelector('form[method=dialog]');
    if (form) form.addEventListener('submit', e => {
      if (e.defaultPrevented || form.id === 'eventForm') return; // event form handles its own submit
      e.preventDefault(); d.close(e.submitter && e.submitter.value || '');
    });
    d.addEventListener('animationend', e => { if (e.target === d) d.classList.remove('anim-in'); });
  }
  document.querySelectorAll('dialog').forEach(wireDialog);

  // Briefing collapse/expand: animate height + opacity, then set [hidden].
  function slide(el, open) {
    if (reduced()) { el.hidden = !open; return; }
    el.getAnimations().forEach(a => a.cancel());
    if (open) {
      el.hidden = false; const h = el.scrollHeight;
      el.animate([{ height: '0px', opacity: 0, overflow: 'hidden' }, { height: h + 'px', opacity: 1, overflow: 'hidden' }], { duration: 240, easing: 'cubic-bezier(.2,.8,.2,1)' });
    } else {
      const h = el.offsetHeight;
      const a = el.animate([{ height: h + 'px', opacity: 1, overflow: 'hidden' }, { height: '0px', opacity: 0, overflow: 'hidden' }], { duration: 200, easing: 'cubic-bezier(.4,0,1,1)', fill: 'forwards' });
      a.onfinish = () => { el.hidden = true; a.cancel(); };
    }
  }
  // Crossfade/slight slide for swapped content (briefing period switches).
  function swap(el, dir = 0) {
    if (reduced() || !el) return;
    el.animate([{ opacity: 0, transform: `translateX(${dir * 8}px)` }, { opacity: 1, transform: 'none' }], { duration: 200, easing: 'ease-out' });
  }
  // Generic popover (e.g. autocomplete): drop-in when unhidden.
  function watchPop(el) {
    new MutationObserver(() => {
      if (!el.hidden && !reduced()) el.animate([{ opacity: 0, transform: 'translateY(-6px)' }, { opacity: 1, transform: 'none' }], { duration: 160, easing: 'ease-out' });
    }).observe(el, { attributes: true, attributeFilter: ['hidden'] });
  }
  document.querySelectorAll('.ac-pop').forEach(watchPop);

  // Toast: fade/slide in.
  const toastEl = document.getElementById('toast');
  if (toastEl) {
    watchPop(toastEl);
    // Intercept hide: fade/slide out first, then set [hidden] for real.
    const desc = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'hidden');
    Object.defineProperty(toastEl, 'hidden', { configurable: true, get() { return desc.get.call(this); },
      set(v) {
        clearTimeout(this._hideT); this.classList.remove('toast-out');
        if (!v || reduced() || desc.get.call(this)) { desc.set.call(this, v); return; }
        this.classList.add('toast-out'); this._hideT = setTimeout(() => { this.classList.remove('toast-out'); desc.set.call(this, true); }, 180);
      } });
  }
  // Inline reveals (custom category, repeat options, checklist, day note…): small fade-down on unhide.
  document.querySelectorAll('#customCatWrap, #taskFields, #intervalWrap, #untilWrap, #weekdayWrap, #scopeHint, #migrateBox, #briefSeasons, #reviewDayPick').forEach(watchPop);

  // Press feedback for scrollable event/todo rows: never highlight during a scroll/drag.
  // Arm `.is-press` only after a short hold with no movement; cancel on move/scroll; clear on up.
  // Selectors cover Briefing, Today card, Search, To-Do title, and List-view events.
  const PRESS_SEL = '.brief-item, button.tc-item.tc-ev, .sr-item, .todo-row .td-title, .fc-list-event';
  const PRESS_SKIP = 'input, textarea, select, .todo-check, .td-check, .cat-pick, a[href], .notion-link';
  const PRESS_MOVE = 10;   // px — finger drift that counts as a scroll/drag
  const PRESS_DELAY = 90;  // ms — wait before showing pressed state
  let press = null;
  function pressClear(flash) {
    if (!press) return;
    clearTimeout(press.timer);
    const el = press.el;
    const moved = press.moved;
    press = null;
    if (!el) return;
    if (flash && !moved) {
      el.classList.add('is-press');
      setTimeout(() => el.classList.remove('is-press'), 140);
    } else el.classList.remove('is-press');
  }
  function pressTarget(e) {
    const t = e.target;
    if (!(t instanceof Element)) return null;
    if (t.closest(PRESS_SKIP)) return null;
    const el = t.closest(PRESS_SEL);
    if (!el || el.disabled) return null;
    return el;
  }
  function pressPt(e) {
    if (e.touches && e.touches[0]) return e.touches[0];
    if (e.changedTouches && e.changedTouches[0]) return e.changedTouches[0];
    return e;
  }
  document.addEventListener('pointerdown', e => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    const el = pressTarget(e); if (!el) return;
    const pt = pressPt(e);
    pressClear(false);
    press = { el, x: pt.clientX, y: pt.clientY, moved: false, pointerId: e.pointerId,
      timer: setTimeout(() => { if (press && press.el === el && !press.moved) el.classList.add('is-press'); }, PRESS_DELAY) };
  }, true);
  document.addEventListener('pointermove', e => {
    if (!press) return;
    if (press.pointerId != null && e.pointerId !== press.pointerId) return;
    const pt = pressPt(e);
    if (Math.hypot(pt.clientX - press.x, pt.clientY - press.y) > PRESS_MOVE) {
      press.moved = true;
      clearTimeout(press.timer);
      press.el.classList.remove('is-press');
    }
  }, true);
  document.addEventListener('pointerup', () => pressClear(true), true);
  document.addEventListener('pointercancel', () => pressClear(false), true);
  // Scroll of any ancestor (Briefing list, page, Today, Search, List) cancels pressed state
  document.addEventListener('scroll', () => { if (press) { press.moved = true; pressClear(false); } }, true);

  window.Motion = { reduced, runExit, slide, swap, PRESS_MOVE, PRESS_DELAY, PRESS_SEL };
})();
