/* welcome.js: one-time "Welcome to SANDY" note for beta testers (Scott 2026-10-26).
 * Rule (shouldShow): Supabase mode, signed in, not the owner account (config OWNER_EMAIL), and this user
 * has not dismissed it on this device (localStorage "sandy.welcome.v1:<user id>"). Existing testers
 * see it once; Scott never gets it automatically. Profile → Account → "Welcome guide" reopens it anytime. */
(function () {
  'use strict';
  const CFG = window.CALENDAR_CONFIG || {};
  const KEY = id => 'sandy.welcome.v1:' + id;
  const reduce = () => window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;
  const dismissed = user => { try { return !!localStorage.getItem(KEY(user.id)); } catch (e) { return false; } };
  const markDismissed = user => { try { if (user && user.id) localStorage.setItem(KEY(user.id), new Date().toISOString()); } catch (e) {} };
  const isOwnerAccount = user => !!(user && user.email && CFG.OWNER_EMAIL && user.email.toLowerCase() === String(CFG.OWNER_EMAIL).toLowerCase());
  const optedOut = () => { try { return localStorage.getItem('sandy.welcome.off') === '1'; } catch (e) { return false; } }; // test hook
  function shouldShow(user) { return !!(user && user.id) && !isOwnerAccount(user) && !dismissed(user) && !optedOut(); }

  // Which install steps to show (t143u): iPhone keeps Safari's Share steps; Android gets Chrome / Samsung
  // Internet / Mi Browser steps; desktop and anything unknown sees both. Samsung Internet and Chrome on big
  // tablets may send a desktop "X11; Linux" UA, so a touch Linux (not ChromeOS) counts as Android too.
  function platform(ua, touch, plat) {
    ua = ua == null ? (navigator.userAgent || '') : ua;
    touch = touch == null ? (navigator.maxTouchPoints || 0) : touch;
    plat = plat == null ? (navigator.platform || '') : plat;
    if (/iP(hone|ad|od)/.test(ua) || (plat === 'MacIntel' && touch > 1)) return 'ios';
    if (/SamsungBrowser/i.test(ua)) return 'samsung';
    if (/MiuiBrowser|XiaoMi\//i.test(ua)) return 'mi';
    if (/Android/i.test(ua) || (/Linux/.test(ua) && !/CrOS/.test(ua) && touch > 0 && coarse())) return 'android';
    return 'other';
  }
  const coarse = () => { try { return !window.matchMedia || matchMedia('(pointer: coarse)').matches; } catch (e) { return true; } };
  const installed = () => { try { return !!((window.matchMedia && matchMedia('(display-mode: standalone)').matches) || navigator.standalone); } catch (e) { return false; } };
  const IOS_STEPS = `<li>Open SANDY in Safari and tap <b>Share</b>, then <b>Add to Home Screen</b>.</li>
      <li>Open SANDY from your Home Screen icon, not from Safari.</li>`;
  const CHROME_STEPS = `<li>Open SANDY in <b>Chrome</b> and tap <b>Install</b> on the <b>Install SANDY</b> card (or Chrome's own <b>Install app</b> pop-up). Don't see it? Tap <b>⋮</b> at the top right, then <b>Add to Home screen</b> → <b>Install</b> (some phones say <b>Install app</b>).</li>
      <li>Open SANDY from its Home screen icon, not from Chrome.</li>`;
  const SAMSUNG_STEPS = `<li>In <b>Samsung Internet</b>, tap the <b>install icon</b> in the address bar if you see it (or <b>Install</b> on the <b>Install SANDY</b> card). Otherwise tap <b>☰</b> (bottom right), then <b>Add page to</b> → <b>Home screen</b>.</li>
      <li>Open SANDY from its Home screen icon, not from Samsung Internet.</li>`;
  const MI_STEPS = `<li>Open SANDY in <b>Chrome</b> to install it, because Mi Browser can't install apps like SANDY. Copy the link, open it in Chrome, then tap <b>Install</b>, or tap <b>⋮</b> → <b>Add to Home screen</b> → <b>Install</b>.</li>
      <li>Open SANDY from its Home screen icon, not from the browser.</li>`;
  function installSteps(pf) {
    if (installed()) return `<li>You're already using the SANDY app from your Home Screen. That's the best way to run it.</li>`;
    if (pf === 'ios') return IOS_STEPS;
    if (pf === 'samsung') return SAMSUNG_STEPS;
    if (pf === 'mi') return MI_STEPS;
    if (pf === 'android') return CHROME_STEPS;
    return `<li><b>iPhone:</b> open SANDY in Safari, tap <b>Share</b>, then <b>Add to Home Screen</b>.<br><b>Android:</b> open SANDY in Chrome and tap <b>Install</b>, or tap <b>⋮</b> → <b>Add to Home screen</b> (Samsung Internet: <b>☰</b> → <b>Add page to</b> → <b>Home screen</b>).</li>
      <li>Open SANDY from your Home Screen icon, not from the browser.</li>`;
  }
  const body = pf => `
    <p>This is a beta, so there will be bugs. Please report any issues you run into, and send me your feedback and suggestions too.</p>
    <h3 class="wl-h">Getting Started <span class="wl-key">(this part is key)</span></h3>
    <ol class="wl-steps" data-platform="${pf}">
      ${installSteps(pf)}
      <li>Enter your email, then type the 8-digit code we send you into SANDY.</li>
      <li>Add your calendars and a few events, then swipe left and right to move through your days.</li>
    </ol>
    <div class="wl-install-now" hidden><button type="button" class="primary wl-install-btn">Install SANDY now</button></div>
    <h3 class="wl-h">Features</h3>
    <ul class="wl-feats">
      <li><b>Sandy Intelligence (SI):</b> your built-in AI assistant. Tap <b>AI</b> to ask about your schedule, plan your day, or have it add things for you. It also keeps your past chats, and more AI features are coming soon.</li>
      <li><b>Leave-by alerts:</b> add a location to an event, and SANDY tells you when to leave and sends you a heads-up.</li>
      <li><b>Today:</b> see what's next, what's on today, anything overdue, and a preview of tomorrow. Tap any section to open or close it.</li>
      <li><b>Smart to-dos:</b> tap the <b>+</b> button and type naturally, like "meeting next Friday at 3pm." SANDY fills in the date and time, and you can set a priority.</li>
      <li><b>Reminders:</b> go to <b>Profile</b> and tap <b>Enable notifications</b> to get up to 6 reminders per event.</li>
    </ul>
    <p class="wl-close-note">If something feels off or you have an idea, tap <b>Send feedback</b> and tell me. I read every one.</p>
    <p class="wl-sig">— Scott, Minds Above Matters</p>`;

  let cur = null;
  function show({ user, onClose } = {}) {
    if (cur) return cur.root;
    const prevFocus = document.activeElement;
    const back = document.createElement('div'); back.className = 'wl-backdrop';
    const root = document.createElement('div');
    root.className = 'wl-sheet'; root.id = 'welcomeSheet';
    root.setAttribute('role', 'dialog'); root.setAttribute('aria-modal', 'true'); root.setAttribute('aria-labelledby', 'wlTitle');
    root.innerHTML = `<div class="wl-grab" aria-hidden="true"></div>
      <div class="wl-head"><span class="wl-wave" aria-hidden="true">👋</span><h2 id="wlTitle">Welcome to SANDY, and thank you for taking the time to test it.</h2>
        <button type="button" class="icon-btn wl-x" aria-label="Close welcome">✕</button></div>
      <div class="wl-body" tabindex="-1">${body(platform())}</div>
      <div class="wl-foot"><button type="button" class="primary wl-go">Let's go</button></div>`;
    document.body.append(back, root); document.body.classList.add('wl-open');
    const close = () => {
      if (!cur || cur.root !== root) return;
      cur = null; markDismissed(user);
      document.removeEventListener('keydown', onKey, true);
      root.classList.remove('open'); back.classList.remove('open'); root.classList.add('leaving');
      const done = () => { root.remove(); back.remove(); document.body.classList.remove('wl-open'); if (prevFocus && prevFocus.focus && document.contains(prevFocus)) try { prevFocus.focus({ preventScroll: true }); } catch (e) {} if (onClose) onClose(); };
      if (reduce()) done(); else setTimeout(done, 320);
    };
    const onKey = e => {
      if (e.key === 'Escape') { e.preventDefault(); close(); }
      else if (e.key === 'Tab') { // keep focus inside the sheet
        const f = [...root.querySelectorAll('button')]; const first = f[0], last = f[f.length - 1];
        if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
        else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
      }
    };
    document.addEventListener('keydown', onKey, true);
    // Ties in with the Install SANDY card: when the browser can install right now, offer it here too.
    const inst = root.querySelector('.wl-install-now');
    if (inst && window.SandyInstall && SandyInstall.available && !installed()) {
      inst.hidden = false;
      inst.querySelector('button').onclick = () => { close(); setTimeout(() => SandyInstall.prompt(), reduce() ? 0 : 330); };
    }
    root.querySelector('.wl-go').onclick = close; root.querySelector('.wl-x').onclick = close; back.onclick = close;
    cur = { root, close };
    if (reduce()) { root.classList.add('open', 'no-anim'); back.classList.add('open'); }
    else { void root.offsetWidth; requestAnimationFrame(() => { root.classList.add('open'); back.classList.add('open'); }); }
    setTimeout(() => { try { root.querySelector('.wl-go').focus({ preventScroll: true }); } catch (e) {} }, 60);
    return root;
  }
  function maybeShow({ user, delay = 700, onClose } = {}) {
    if (!shouldShow(user)) return false;
    setTimeout(() => { if (!document.querySelector('.onb')) show({ user, onClose }); }, delay);
    return true;
  }
  // Profile → Account: "Welcome guide" row (reopens the note anytime)
  function mountRow({ user } = {}) {
    const sec = document.getElementById('accountSection'); if (!sec || document.getElementById('welcomeBtn')) return;
    const row = document.createElement('div'); row.className = 'data-btns wl-row';
    row.innerHTML = '<button id="welcomeBtn" type="button">👋 Welcome guide</button>';
    const fb = document.getElementById('feedbackBtn');
    if (fb && fb.parentElement && fb.parentElement.parentElement) fb.parentElement.after(row);
    else sec.insertBefore(row, sec.querySelector('#acctDelete'));
    row.querySelector('#welcomeBtn').onclick = () => show({ user });
  }
  window.SandyWelcome = { show, maybeShow, shouldShow, mountRow, platform, close: () => cur && cur.close(), key: KEY };
})();
