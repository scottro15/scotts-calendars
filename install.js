/* Android "Install SANDY" card (t135u).
   Chrome/Android fire `beforeinstallprompt` when the PWA is installable; we keep the event and offer a
   small dismissible card above the nav instead of the browser's mini-infobar. Never on iOS (iOS keeps
   its own Add-to-Home-Screen hint), never when already installed/standalone, never while the update
   banner, a sheet/editor, the tour or the sign-in gate is showing. Dismissal is remembered. */
(function () {
  'use strict';
  const ua = navigator.userAgent || '';
  const iOS = /iP(hone|ad|od)/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const standalone = () => !!((window.matchMedia && (matchMedia('(display-mode: standalone)').matches || matchMedia('(display-mode: fullscreen)').matches || matchMedia('(display-mode: minimal-ui)').matches)) || navigator.standalone);
  if (iOS || standalone()) return;
  const KEY = 'sandy.install.dismissed';
  const dismissed = () => { try { return !!localStorage.getItem(KEY); } catch (_) { return false; } };
  const remember = v => { try { localStorage.setItem(KEY, v || String(Date.now())); } catch (_) {} };
  let deferred = null, card = null, timer = 0, iv = 0;

  function busy() {
    const b = document.body, up = document.getElementById('updateBanner'), gate = document.getElementById('authGate');
    return !!(document.querySelector('dialog[open]') || b.classList.contains('qs-open') || b.classList.contains('ai-open')
      || b.classList.contains('tour-open') || b.classList.contains('wl-open') || document.getElementById('tourOffer')
      || (up && !up.hidden) || (gate && !gate.hidden && gate.offsetParent !== null));
  }
  function build() {
    card = document.createElement('div');
    card.id = 'installCard'; card.className = 'install-card'; card.setAttribute('role', 'dialog'); card.setAttribute('aria-label', 'Install SANDY');
    card.innerHTML = '<img class="install-card-ic" src="icons/icon-192.png" alt="" width="40" height="40">'
      + '<div class="install-card-txt"><b>Install SANDY</b><span>Opens faster, full screen</span></div>'
      + '<button type="button" class="install-card-go" id="installGo">Install</button>'
      + '<button type="button" class="install-card-x" id="installX" aria-label="Not now">×</button>';
    document.body.appendChild(card);
    card.querySelector('#installGo').addEventListener('click', install);
    card.querySelector('#installX').addEventListener('click', () => { remember(); hide(); });
  }
  function show() {
    if (!deferred || dismissed() || standalone()) return;
    if (busy()) return;
    clearInterval(iv); iv = 0;
    if (!card) build();
    card.hidden = false;
    requestAnimationFrame(() => requestAnimationFrame(() => card && card.classList.add('is-in')));
  }
  function hide() {
    clearInterval(iv); iv = 0; clearTimeout(timer);
    if (!card) return;
    const c = card; c.classList.remove('is-in');
    setTimeout(() => { if (!c.classList.contains('is-in')) c.hidden = true; }, 220);
  }
  async function install() {
    const e = deferred; if (!e) { hide(); return; }
    deferred = null; hide();
    try { await e.prompt(); const r = await e.userChoice; if (r && r.outcome === 'accepted') remember('installed'); } catch (_) {}
  }
  // Keep out of the update banner's way: if it appears while we're up, step aside.
  function watch() {
    const up = document.getElementById('updateBanner');
    if (up) new MutationObserver(() => { if (!up.hidden && card && !card.hidden) hide(); }).observe(up, { attributes: true, attributeFilter: ['hidden'] });
  }
  window.addEventListener('beforeinstallprompt', e => {
    e.preventDefault(); // we show our own card instead of the mini-infobar
    deferred = e;
    if (dismissed()) return;
    clearTimeout(timer);
    timer = setTimeout(() => { show(); if (!card || card.hidden) iv = setInterval(show, 1500); }, 4000);
  });
  window.addEventListener('appinstalled', () => { remember('installed'); deferred = null; hide(); });
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', watch); else watch();
  window.SandyInstall = { show, hide, prompt: install, get available() { return !!deferred; } };
})();
