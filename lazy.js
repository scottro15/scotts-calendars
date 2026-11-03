/* lazy.js — speed step B (t182u): code that isn't needed to draw Home/Today loads after startup.
 * Chunks (scripts/lazy-chunks.json): 'ai' = Sandy Intelligence (ai.js); 'extras' = invites/admin + feedback (launch.js),
 * welcome guide (welcome.js), tour (tour.js). index.html sets window.__lazyFiles = { name: [urls] } (scripts/build-dist.mjs);
 * a chunk with no entry is already in the page (eager build / rollback), so load() resolves at once.
 * - Both chunks start downloading once the page has loaded (after Home/Today are drawn), so a tap is normally instant.
 * - Tapping ✨ AI before the chunk arrives shows a small busy state, then opens SI. Offline: the service worker precaches
 *   the chunks; if one can't load at all, a toast says so and nothing else changes.
 * Order is kept: a chunk's files run in their original order, the same as when they were <script> tags. */
(function () {
  'use strict';
  const FILES = window.__lazyFiles || {};
  const done = {}, state = {};
  const addScript = src => new Promise((res, rej) => {
    const s = document.createElement('script'); s.src = src; s.async = false;
    s.onload = () => res(); s.onerror = () => { s.remove(); rej(new Error('Could not load ' + src.split('?')[0])); };
    document.body.appendChild(s);
  });
  function load(name) {
    if (done[name]) return done[name];
    const list = FILES[name];
    if (!list || !list.length) { state[name] = 'in'; return (done[name] = Promise.resolve()); }
    const p = list.reduce((chain, src) => chain.then(() => addScript(src)), Promise.resolve());
    done[name] = p.then(() => { state[name] = 'in'; }, e => { delete done[name]; throw e; }); // a failed load (offline) can be retried later
    return done[name];
  }
  const loaded = name => state[name] === 'in';
  // ---------- ✨ AI tapped before the SI chunk is in ----------
  const toast = m => { const a = window.__app; if (a && a.toast) a.toast(m, 3500); };
  const waitFor = (test, ms) => new Promise((res, rej) => { const t0 = Date.now(); (function poll() { if (test()) return res(); if (Date.now() - t0 > ms) return rej(new Error('timeout')); setTimeout(poll, 30); })(); });
  document.addEventListener('click', e => {
    const b = e.target && e.target.closest && e.target.closest('#aiBtn');
    if (!b || window.SandyAI) return; // loaded: ai.js's own handler opens the sheet
    e.preventDefault(); e.stopImmediatePropagation();
    if (b.classList.contains('lazy-busy')) return; // one open per wait, however many taps
    b.classList.add('lazy-busy'); b.setAttribute('aria-busy', 'true');
    load('ai').then(() => waitFor(() => window.SandyAI, 20000)) // ai.js sets SandyAI once the app is ready
      .then(() => { if (b.classList.contains('lazy-busy')) window.SandyAI.open(); })
      .catch(() => toast('Sandy Intelligence needs a connection to open. Try again in a moment.'))
      .finally(() => { b.classList.remove('lazy-busy'); b.removeAttribute('aria-busy'); });
  }, true);
  // ---------- background load after startup ----------
  function preload() {
    const go = () => { load('extras').catch(() => {}); load('ai').catch(() => {}); };
    // after the first paint of Home/Today: 'load' (all startup scripts/styles in) + two frames
    const after = () => requestAnimationFrame(() => requestAnimationFrame(go));
    if (document.readyState === 'complete') after(); else window.addEventListener('load', after, { once: true });
    if (document.hidden) setTimeout(go, 0); // rAF doesn't run in a background tab
  }
  window.SandyLazy = { load, loaded, files: FILES };
  preload();
})();
