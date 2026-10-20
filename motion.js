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
    runExit(this, 'closing', () => { if (this.open && this._closeTok === tok) nativeClose.call(this, rv); }, 160);
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
  if (toastEl) watchPop(toastEl);

  window.Motion = { reduced, runExit, slide, swap };
})();
