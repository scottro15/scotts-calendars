/* Update banner: detect a newer deploy and offer "Tap to refresh" above the floating nav.
   Detection:
     1) poll version.json (preferred) or the styles.css?v= tag in index.html
        — on open (~2.5s), on visibilitychange→visible, every ~30 min while open
     2) service worker updatefound → installed+waiting (when a controller already exists)
   Tap → postMessage SKIP_WAITING to the waiting worker (if any), then location.replace once
   with ?build=<tag> so a still-stale HTTP cache can't loop. Dismiss remembers the tag for
   this session. If an editor/sheet is open, confirm before reloading. */
(function () {
  const TAG_RE = /styles\.css\?v=([\w.-]+)/;
  const tagOf = s => { const m = String(s || '').match(TAG_RE); return m ? m[1] : ''; };
  const link = document.querySelector('link[rel="stylesheet"][href*="styles.css?v="]');
  const running = tagOf(link && link.getAttribute('href'));
  const DISMISS = 'sandy.updateDismissed';
  const TRIED = 'sandy.updateTried';
  const POLL_MS = 30 * 60 * 1000;
  const MIN_GAP = 60 * 1000;

  const el = () => document.getElementById('updateBanner');
  let last = 0, busy = false, pending = null, shown = false;

  function editorOpen() {
    return !!(document.querySelector('dialog[open]') || document.body.classList.contains('qs-open')
      || document.querySelector('.sheet.open, .modal.open, .qs-sheet:not([hidden])'));
  }

  function paint() {
    const b = el(); if (!b || !pending) return;
    if (sessionStorage.getItem(DISMISS) === pending) return;
    b.hidden = false;
    requestAnimationFrame(() => { requestAnimationFrame(() => b.classList.add('is-in')); });
    shown = true;
  }

  function waitThenPaint() {
    // Modal <dialog> uses the top layer and would cover the pill — wait until editors/sheets close.
    if (!editorOpen()) { paint(); return; }
    const tryPaint = () => { if (!editorOpen()) { cleanup(); paint(); } };
    const cleanup = () => {
      document.removeEventListener('close', tryPaint, true);
      document.removeEventListener('click', tryPaint, true);
      clearInterval(iv);
    };
    document.addEventListener('close', tryPaint, true);
    document.addEventListener('click', tryPaint, true);
    const iv = setInterval(tryPaint, 600);
  }

  function show(live) {
    if (!live || live === running) return;
    if (sessionStorage.getItem(DISMISS) === live) return;
    pending = live;
    waitThenPaint();
  }

  function hide() {
    const b = el(); if (!b) return;
    b.classList.remove('is-in');
    // keep layout until fade finishes
    setTimeout(() => { if (!b.classList.contains('is-in')) b.hidden = true; }, 280);
    shown = false;
  }

  async function activateWaiting() {
    if (!navigator.serviceWorker) return;
    try {
      const reg = await navigator.serviceWorker.getRegistration();
      if (!reg || !reg.waiting) return;
      await new Promise(res => {
        let done = false;
        const finish = () => { if (done) return; done = true; res(); };
        navigator.serviceWorker.addEventListener('controllerchange', finish, { once: true });
        reg.waiting.postMessage({ type: 'SKIP_WAITING' });
        setTimeout(finish, 1200);
      });
    } catch (_) {}
  }

  async function reloadOnce(live) {
    if (!live) return;
    // already tried this tag this session → avoid a reload loop on a stale cache
    if (sessionStorage.getItem(TRIED) === live) return;
    sessionStorage.setItem(TRIED, live);
    window.SandyUpdate.reloading = live;
    await activateWaiting();
    const u = new URL(location.href);
    u.searchParams.set('build', live);
    location.replace(u.href);
  }

  async function onTap() {
    const live = pending; if (!live) return;
    if (editorOpen()) {
      const ok = window.confirm('A new update is ready. Reload now?\n\nUnsaved edits in an open editor may be lost.');
      if (!ok) return;
    }
    await reloadOnce(live);
  }

  function onDismiss(e) {
    if (e) e.stopPropagation();
    if (pending) sessionStorage.setItem(DISMISS, pending);
    hide();
  }

  async function fetchLive() {
    // Prefer the tiny version.json; fall back to scraping index.html's cache tag.
    try {
      const vr = await fetch('version.json?t=' + Date.now(), { cache: 'no-store' });
      if (vr.ok) {
        const j = await vr.json();
        const v = String((j && (j.v || j.version)) || '');
        if (v) return v;
      }
    } catch (_) {}
    try {
      const path = location.pathname.endsWith('/') ? location.pathname : location.pathname.replace(/[^/]+$/, '') || '/';
      const r = await fetch(path + '?fresh=' + Date.now(), { cache: 'no-store' });
      if (r.ok) return tagOf(await r.text());
    } catch (_) {}
    return '';
  }

  async function check(force) {
    if (!running || busy) return;
    if (!force && Date.now() - last < MIN_GAP) return;
    // https (installed app / GH Pages) or explicit test flag (Playwright on http)
    if (location.protocol !== 'https:' && !window.__SANDY_UPDATE_TEST) return;
    busy = true; last = Date.now();
    try {
      try {
        const reg = await (navigator.serviceWorker && navigator.serviceWorker.getRegistration && navigator.serviceWorker.getRegistration());
        if (reg) reg.update().catch(() => {});
      } catch (_) {}
      const live = await fetchLive();
      if (live && live !== running) show(live);
      else if (live && live === running && sessionStorage.getItem(TRIED) === live) {
        // successfully landed on the new build — clear the loop guard
        sessionStorage.removeItem(TRIED);
      }
    } catch (_) {} finally { busy = false; }
  }

  function watchReg(reg) {
    if (!reg) return;
    // already waiting from a prior deploy while this tab was open
    if (reg.waiting && navigator.serviceWorker.controller) check(true);
    reg.addEventListener('updatefound', () => {
      const nw = reg.installing; if (!nw) return;
      nw.addEventListener('statechange', () => {
        if (nw.state === 'installed' && navigator.serviceWorker.controller) check(true);
      });
    });
  }

  async function boot() {
    if (navigator.serviceWorker) {
      try {
        const reg = await navigator.serviceWorker.getRegistration();
        watchReg(reg);
        // Also watch future registrations (push.js registers asynchronously)
        navigator.serviceWorker.ready.then(r => watchReg(r)).catch(() => {});
      } catch (_) {}
    }
    check(true);
  }

  function bind() {
    const tap = document.getElementById('updateBannerTap');
    const x = document.getElementById('updateBannerDismiss');
    if (tap) tap.addEventListener('click', onTap);
    if (x) x.addEventListener('click', onDismiss);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', bind);
  else bind();

  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') check(); });
  window.addEventListener('pageshow', e => { if (e.persisted) check(); });
  setTimeout(boot, 2500);
  setInterval(() => check(), POLL_MS);

  window.SandyUpdate = {
    check: () => check(true),
    running,
    tagOf,
    show,
    get pending() { return pending; },
    get visible() { return shown; },
    reload: () => pending && reloadOnce(pending),
  };
})();
