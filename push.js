/*
 * push.js: phone/tablet/desktop notifications for reminders (Web Push).
 * - Profile → Account → Notifications: status, "Enable notifications", "Send test notification", "Turn off".
 * - Works per platform (t147u):
 *     Android Chrome / Samsung Internet / desktop: permission prompt straight from the tap, then subscribe.
 *     iPhone / iPad: Web Push only works in the Home Screen app on iOS/iPadOS 16.4+, so Safari shows
 *     "Add to Home Screen" steps first (iPad gets iPad wording; old versions are told to update).
 *     In-app browsers / Android WebView (Instagram, Facebook, …): no notifications there; say "open in Chrome".
 * - Every failure shows a plain reason in the box, and "blocked" lists the fix steps for that platform.
 * - "Send test notification" goes through the real push server (Edge Function send-test-push), so it proves
 *   the whole path; expired devices (404/410) are removed there.
 * - nudge(): called after saving an item with reminders; offers to turn notifications on (once per device).
 * Reminder sending happens server-side (supabase/functions/send-reminders, every minute).
 */
(function () {
  const CFG = window.CALENDAR_CONFIG || {};
  const KEY = CFG.VAPID_PUBLIC_KEY || '';
  const NUDGED = 'sandy.pushNudged';
  const SW_TIMEOUT = 20000;
  let ctx = null;

  // ---------- platform ----------
  const ua = navigator.userAgent || '';
  const touch = navigator.maxTouchPoints || 0;
  const coarse = () => { try { return !window.matchMedia || matchMedia('(pointer: coarse)').matches; } catch (_) { return true; } };
  const isIOS = /iPad|iPhone|iPod/.test(ua) || (navigator.platform === 'MacIntel' && touch > 1);
  const isIPad = /iPad/.test(ua) || (!/iPhone|iPod/.test(ua) && navigator.platform === 'MacIntel' && touch > 1);
  function platform() {
    if (isIOS) return isIPad ? 'ipad' : 'iphone';
    if (/SamsungBrowser/i.test(ua)) return 'samsung';
    if (/MiuiBrowser|XiaoMi\//i.test(ua)) return 'mi';
    if (/Android/i.test(ua) || (/Linux/.test(ua) && !/CrOS/.test(ua) && touch > 0 && coarse())) return 'android';
    return 'desktop';
  }
  const PLAT = platform();
  const isAndroid = PLAT === 'samsung' || PLAT === 'mi' || PLAT === 'android';
  // Android WebView ("; wv)") and social apps' built-in browsers can't do notifications.
  const inApp = () => (/Android/.test(ua) && /; wv\)/.test(ua)) || /FBAN|FBAV|FB_IAB|Instagram|Snapchat|musical_ly|BytedanceWebview|TikTok|Line\/|MicroMessenger|Pinterest|LinkedInApp|GSA\//.test(ua);
  // iOS / iPadOS version (iPad "desktop site" UA carries it as Version/x.y)
  function iosVersion() {
    const m = ua.match(/OS (\d+)[_.](\d+)/) || ua.match(/Version\/(\d+)\.(\d+)/);
    return m ? +m[1] + +m[2] / 100 : 99;
  }
  const DEV = { iphone: 'iPhone', ipad: 'iPad' }[PLAT] || 'device';
  const standalone = () => !!((window.matchMedia && matchMedia('(display-mode: standalone)').matches) || navigator.standalone);
  const supported = () => 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
  const u8 = b64 => { const s = atob((b64 + '='.repeat((4 - b64.length % 4) % 4)).replace(/-/g, '+').replace(/_/g, '/')); return Uint8Array.from(s, c => c.charCodeAt(0)); };
  const b64u = buf => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  const client = () => ctx && ctx.store && ctx.store.adapter && ctx.store.adapter.client;

  let regP = null;
  function registration() {
    if (!regP) {
      regP = navigator.serviceWorker.register('sw.js', { scope: './', updateViaCache: 'none' }).then(async reg => {
        // First visit: no controller yet — activate immediately so Push + ready() work.
        // Later deploys leave the new worker waiting until the update banner posts SKIP_WAITING.
        if (!navigator.serviceWorker.controller) {
          const kick = w => { try { w && w.postMessage({ type: 'SKIP_WAITING' }); } catch (_) {} };
          if (reg.waiting) kick(reg.waiting);
          else if (reg.installing) {
            await new Promise(res => {
              const w = reg.installing;
              w.addEventListener('statechange', function on() {
                if (w.state === 'installed' || w.state === 'activated' || w.state === 'redundant') {
                  kick(w); w.removeEventListener('statechange', on); res();
                }
              });
            });
          }
        }
        return navigator.serviceWorker.ready;
      });
      regP.catch(() => { regP = null; }); // a failed register can be retried
    }
    return regP;
  }
  // Never hang the button: give the background helper SW_TIMEOUT ms, then say so.
  function readyReg(ms = SW_TIMEOUT) {
    return Promise.race([registration(), new Promise((_, rej) => setTimeout(() => rej(new PushErr('sw')), ms))]);
  }

  class PushErr extends Error { constructor(code, msg) { super(msg || code); this.code = code; } }

  // ---------- state ----------
  // 'on' | 'off' | 'blocked' | 'ios-install' | 'ios-old' | 'inapp' | 'unsupported' | 'nokey'
  function quickState() {
    if (isIOS && iosVersion() < 16.4) return 'ios-old';
    if (isIOS && !standalone()) return 'ios-install';
    if (inApp() && !supported()) return 'inapp';
    if (!supported()) return isIOS ? 'ios-install' : (PLAT === 'mi' ? 'inapp' : 'unsupported');
    if (!KEY) return 'nokey';
    if (Notification.permission === 'denied') return 'blocked';
    if (Notification.permission !== 'granted') return 'off';
    return null; // granted: depends on the subscription
  }
  async function state() {
    const q = quickState(); if (q) return q;
    try { const reg = await readyReg(8000); return (await reg.pushManager.getSubscription()) ? 'on' : 'off'; } catch (_) { return 'off'; }
  }

  // ---------- fix steps per platform (shown when blocked / test not seen) ----------
  const SITE = location.host || 'this site';
  const FIX = {
    android: [
      `In Chrome, tap the <b>tune / ⓘ icon</b> at the left of the address bar → <b>Permissions</b> (or <b>Notifications</b>) → <b>Allow</b>.`,
      `Or: <b>⋮</b> → <b>Settings</b> → <b>Site settings</b> → <b>Notifications</b> → find <b>${SITE}</b> → <b>Allow</b>.`,
      `Installed SANDY app? Long-press its icon → <b>App info</b> → <b>Notifications</b> → turn on.`,
      `Then come back here and tap <b>Enable notifications</b>.`],
    samsung: [
      `In Samsung Internet, tap <b>☰</b> (bottom right) → <b>Settings</b> → <b>Sites and downloads</b> → <b>Notifications</b>.`,
      `Turn on <b>Allow sites to ask</b>, then tap <b>⋮</b> → <b>Allowed or blocked sites</b> and switch <b>${SITE}</b> on.`,
      `Installed SANDY app? Long-press its icon → <b>App info</b> → <b>Notifications</b> → turn on.`,
      `Then come back here and tap <b>Enable notifications</b>.`],
    iphone: [
      `Open the iPhone <b>Settings</b> app → <b>Notifications</b> → <b>SANDY</b>.`,
      `Turn on <b>Allow Notifications</b> (and <b>Banners</b>).`,
      `Come back to SANDY and tap <b>Enable notifications</b>.`],
    desktop: [
      `Click the <b>lock / tune icon</b> at the left of the address bar → <b>Notifications</b> → <b>Allow</b>.`,
      `Reload the page, then click <b>Enable notifications</b>.`],
  };
  FIX.mi = FIX.android;
  FIX.ipad = FIX.iphone.map(s => s.replace('iPhone', 'iPad'));
  const OS_STEPS = {
    android: `Still nothing? Make sure your phone lets <b>Chrome</b> show notifications: Android <b>Settings</b> → <b>Apps</b> → <b>Chrome</b> → <b>Notifications</b> → on. On Xiaomi / Redmi also turn on <b>Floating notifications</b> and <b>Lock screen</b> there, and check that Do Not Disturb is off.`,
    samsung: `Still nothing? Android <b>Settings</b> → <b>Apps</b> → <b>Samsung Internet</b> → <b>Notifications</b> → on (and check that Do Not Disturb is off).`,
    iphone: `Still nothing? <b>Settings</b> → <b>Notifications</b> → <b>SANDY</b> → <b>Allow Notifications</b>, and check that Focus / Do Not Disturb is off.`,
    desktop: `Still nothing? Check that your computer allows notifications from this browser (system notification settings / Focus).`,
  };
  OS_STEPS.mi = OS_STEPS.android; OS_STEPS.ipad = OS_STEPS.iphone;
  const fixList = () => `<ol class="push-fix">${(FIX[PLAT] || FIX.desktop).map(s => `<li>${s}</li>`).join('')}</ol>`;
  const browserName = { samsung: 'Samsung Internet', mi: 'Mi Browser', android: 'Chrome', desktop: 'your browser' }[PLAT] || 'Safari';

  // ---------- permission (first await after the tap: keeps the user gesture) ----------
  function askPermission() {
    return new Promise(res => {
      let done = false; const fin = v => { if (!done) { done = true; res(v); } };
      try { const r = Notification.requestPermission(fin); if (r && r.then) r.then(fin, () => fin(Notification.permission)); } // old callback style too
      catch (_) { fin(Notification.permission); }
    });
  }
  const NOPROMPT_HINT = {
    android: `Don't see a pop-up? Look for a <b>bell 🔔</b> or <b>"Notifications blocked"</b> in Chrome's address bar and tap it, then <b>Allow</b>.`,
    samsung: `Don't see a pop-up? Samsung Internet may be set to stop sites from asking: <b>☰</b> → <b>Settings</b> → <b>Sites and downloads</b> → <b>Notifications</b> → turn on <b>Allow sites to ask</b>.`,
    desktop: `Don't see a pop-up? Look for a bell or "Notifications blocked" in the address bar and click it.`,
    iphone: `Look for the <b>Allow</b> pop-up at the top of the screen.`,
  };
  NOPROMPT_HINT.mi = NOPROMPT_HINT.android; NOPROMPT_HINT.ipad = NOPROMPT_HINT.iphone;

  // enable(): true when on, false when it showed the iPhone/iPad install steps; throws PushErr otherwise.
  async function enable(opts = {}) {
    const q = quickState();
    if (q === 'ios-install') { showInstall(); return false; }
    if (q === 'ios-old') throw new PushErr('ios-old');
    if (q === 'inapp') throw new PushErr('inapp');
    if (q === 'unsupported' || q === 'nokey') throw new PushErr(q);
    if (!client()) throw new PushErr('signin');
    let perm = Notification.permission;
    if (perm !== 'granted') {
      const hintT = opts.onSlowPrompt ? setTimeout(opts.onSlowPrompt, 4000) : 0;
      perm = await askPermission();
      clearTimeout(hintT);
    }
    if (perm === 'denied') throw new PushErr('blocked');
    if (perm !== 'granted') throw new PushErr('dismissed');
    let reg;
    try { reg = await readyReg(); } catch (e) { throw e instanceof PushErr ? e : new PushErr('sw', e && e.message); }
    let sub;
    try {
      sub = await reg.pushManager.getSubscription();
      if (sub && sub.options && sub.options.applicationServerKey && b64u(sub.options.applicationServerKey) !== KEY) { await sub.unsubscribe(); sub = null; }
      if (!sub) sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: u8(KEY) });
    } catch (e) {
      const n = e && e.name;
      if (n === 'NotAllowedError') throw new PushErr(Notification.permission === 'denied' ? 'blocked' : 'notallowed', e.message);
      if (n === 'InvalidStateError') { // stale subscription with another key: drop it and try once more
        try { const old = await reg.pushManager.getSubscription(); if (old) await old.unsubscribe(); sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: u8(KEY) }); }
        catch (e2) { throw new PushErr('pushsvc', e2 && e2.message); }
      } else throw new PushErr('pushsvc', e && e.message);
    }
    await saveSub(sub);
    return true;
  }
  async function saveSub(sub) {
    const j = sub.toJSON(); const sb = client();
    if (!sb) throw new PushErr('signin');
    const { error } = await sb.rpc('save_push_subscription', { p_endpoint: j.endpoint, p_p256dh: j.keys.p256dh, p_auth: j.keys.auth, p_user_agent: ua.slice(0, 400) });
    if (error) throw new PushErr(/save_push_subscription|schema cache/.test(error.message) ? 'db' : 'save', error.message);
  }

  async function disable() {
    const reg = await readyReg(); const sub = await reg.pushManager.getSubscription();
    if (!sub) return;
    const sb = client();
    if (sb) await sb.from('push_subscriptions').delete().eq('endpoint', sub.endpoint);
    await sub.unsubscribe();
  }

  // Send a real push to THIS device through the server (proves browser + push service + server).
  async function sendTest() {
    const reg = await readyReg(); const sub = await reg.pushManager.getSubscription();
    if (!sub) throw new PushErr('nosub');
    const sb = client(); if (!sb) throw new PushErr('signin');
    const call = async () => { try { const r = await sb.functions.invoke('send-test-push', { body: { endpoint: sub.endpoint } }); return r; } catch (e) { return { error: e }; } };
    let { data, error } = await call();
    if (!error && data && data.devices === 0) { await saveSub(sub); ({ data, error } = await call()); } // server forgot this device: re-save
    // a just-made subscription can take a few seconds to go live at the push service
    for (let i = 0; i < 4 && !error && data && data.pending && !data.sent; i++) { await new Promise(r => setTimeout(r, 5500)); ({ data, error } = await call()); }
    if (!error && data && data.pending && !data.sent) throw new PushErr('pending');
    if (error || !data) {
      // server unreachable: still prove the device can display one
      await reg.showNotification('SANDY', { body: 'Test notification (shown by this device; the server test was unavailable).', tag: 'sandy-test', icon: 'icons/icon-192.png', badge: 'icons/badge-72.png' });
      return { local: true };
    }
    if (data.gone) { try { await sub.unsubscribe(); } catch (_) {} throw new PushErr('gone'); }
    if (!data.sent) throw new PushErr('testfail', data.status ? `push service answered ${data.status}` : '');
    return data;
  }

  // ---------- messages ----------
  function reason(e) {
    const code = (e && e.code) || '';
    const raw = e && e.message && e.message !== code ? ` (${e.message})` : '';
    switch (code) {
      case 'blocked': return { text: `Notifications are blocked for SANDY on this ${DEV}. To fix it:`, fix: true };
      case 'dismissed': return { text: `The pop-up was closed without choosing Allow. Tap Enable notifications and choose Allow.`, hint: true };
      case 'notallowed': return { text: `${browserName} didn't allow notifications here. Try again and choose Allow. If no pop-up shows, follow these steps:`, fix: true };
      case 'sw': return { text: `SANDY's background helper didn't start in time. Check you're online, reload the page, and try again.${raw}` };
      case 'pushsvc': return { text: isAndroid
        ? `Your phone's push service didn't answer. Check you're online, that Google Play services is up to date, and that you're not in a private / Secret tab, then try again.${raw}`
        : `This browser's push service didn't answer. Check you're online and not in a private window, then try again.${raw}` };
      case 'signin': return { text: 'Sign in to turn on notifications.' };
      case 'db': return { text: 'Notifications need a quick database update first. Try again soon.' };
      case 'save': return { text: `Couldn't save this ${DEV} for notifications${raw}. Try again.` };
      case 'ios-old': return { text: `Notifications need ${PLAT === 'ipad' ? 'iPadOS' : 'iOS'} 16.4 or newer. Update in Settings → General → Software Update, then add SANDY to your Home Screen.` };
      case 'inapp': return { text: PLAT === 'mi'
        ? 'Mi Browser can\'t show SANDY notifications. Open SANDY in Chrome, then tap Enable notifications there.'
        : 'This in-app browser can\'t show notifications. Open SANDY in Chrome (or Samsung Internet / Safari): tap ⋮ or the share button → Open in browser.' };
      case 'unsupported': return { text: "This browser can't show notifications. Try Chrome, Samsung Internet, Edge, Firefox or Safari." };
      case 'nokey': return { text: 'Notifications are not set up yet.' };
      case 'nosub': return { text: 'Notifications are off for this device. Tap Enable notifications first.' };
      case 'gone': return { text: `This ${DEV}'s notification link had expired, so it was removed. Tap Enable notifications to turn it back on.` };
      case 'pending': return { text: `This ${DEV} was just turned on and the push service is still setting it up. Try Send test notification again in a minute.` };
      case 'testfail': return { text: `The test couldn't be delivered${raw}. Turn notifications off and on again, then retry.` };
      default: return { text: (e && e.message) || String(e) };
    }
  }

  function dialog(html, cls) {
    const d = document.createElement('dialog'); d.className = 'push-dlg ' + (cls || '');
    d.innerHTML = `<form method="dialog">${html}</form>`;
    document.body.appendChild(d);
    d.addEventListener('close', () => d.remove());
    d.showModal ? d.showModal() : d.setAttribute('open', '');
    return d;
  }

  function showInstall() {
    const pad = PLAT === 'ipad';
    const third = /CriOS|FxiOS|EdgiOS/.test(ua);
    const share = pad
      ? `Tap the <b>Share</b> button <span aria-hidden="true">(the square with the ↑ arrow)</span> at the top right, next to the address bar.`
      : `Tap the <b>Share</b> button <span aria-hidden="true">(the square with the ↑ arrow)</span>${third ? ' in the address bar' : ' in Safari'}.`;
    dialog(`<h2>Get reminders on your ${DEV}</h2>
      <p>${pad ? 'iPad' : 'iPhone'} shows notifications only for apps on your Home Screen. It takes a few seconds:</p>
      <ol class="push-steps">
        <li>${share}</li>
        <li>Choose <b>Add to Home Screen</b>, then tap <b>Add</b>.</li>
        <li>Open <b>SANDY</b> from the new Home Screen icon and sign in once there. It keeps its own sign-in, separate from Safari.</li>
        <li>Open <b>Profile</b> → <b>Notifications</b> → <b>Enable notifications</b> → <b>Allow</b>.</li>
      </ol>
      <p class="muted small">Needs ${pad ? 'iPadOS' : 'iOS'} 16.4 or newer.</p>
      <div class="data-btns"><button value="ok" class="primary">Got it</button></div>`, 'push-install');
  }

  const LABEL = {
    'on': `On for this ${DEV}. Reminders will pop up here.`,
    'off': `Off for this ${DEV}.`,
    'blocked': `Blocked for SANDY on this ${DEV}. To turn them on:`,
    'ios-install': `On ${DEV === 'device' ? 'iPhone' : DEV}, add SANDY to your Home Screen first, then turn notifications on there.`,
    'ios-old': '', 'inapp': '',
    'unsupported': "This browser doesn't support notifications.",
    'nokey': 'Notifications are not set up yet.',
  };

  function setMsg(box, r, tone) {
    const st = box.querySelector('.push-status'); const fx = box.querySelector('.push-help');
    st.textContent = r.text; st.className = 'push-status small ' + (tone || 'muted');
    fx.innerHTML = r.fix ? fixList() : r.hint ? `<p class="small">${NOPROMPT_HINT[PLAT] || NOPROMPT_HINT.desktop}</p>` : r.html || '';
    fx.hidden = !fx.innerHTML;
  }

  async function paint(box, keep) {
    const s = await state();
    box.dataset.state = s; box.dataset.platform = PLAT;
    if (!keep) {
      if (s === 'blocked') setMsg(box, { text: LABEL.blocked, fix: true }, 'bad');
      else if (s === 'ios-old' || s === 'inapp') setMsg(box, reason({ code: s }), 'bad');
      else setMsg(box, { text: LABEL[s] }, s === 'on' ? 'ok' : 'muted');
    }
    const on = box.querySelector('#pushEnable'), off = box.querySelector('#pushOff'), test = box.querySelector('#pushTest');
    on.hidden = s === 'on' || s === 'unsupported' || s === 'nokey' || s === 'inapp' || s === 'ios-old';
    on.textContent = s === 'ios-install' ? `How to enable on ${DEV === 'device' ? 'iPhone' : DEV}` : s === 'blocked' ? 'Try again' : 'Enable notifications';
    off.hidden = test.hidden = s !== 'on';
    return s;
  }

  // Re-register this device with the server once per visit (covers a server-side cleanup or a browser key change).
  async function resync() {
    try {
      if (quickState() !== null) return; const reg = await readyReg(8000); const sub = await reg.pushManager.getSubscription();
      if (sub && client()) await saveSub(sub);
    } catch (_) {}
  }

  function mount({ store, user }) {
    ctx = { store, user };
    const acct = document.getElementById('accountSection');
    if (!acct || !user || document.getElementById('pushBox')) return;
    const box = document.createElement('div'); box.id = 'pushBox'; box.className = 'push-box';
    box.innerHTML = `<h3>Notifications</h3><p class="push-status small muted" role="status" aria-live="polite">…</p>
      <div class="push-help" hidden></div>
      <div class="data-btns"><button id="pushEnable" class="primary">Enable notifications</button>
      <button id="pushTest" hidden>Send test notification</button><button id="pushOff" class="link-btn" hidden>Turn off on this device</button></div>
      <p class="muted small">Add reminders to any event or to-do in its edit screen.</p>`;
    acct.querySelector('.data-btns').after(box);
    box.querySelector('#pushEnable').onclick = async e => {
      const b = e.currentTarget; if (b.disabled) return; b.disabled = true;
      setMsg(box, { text: quickState() === 'ios-install' ? '' : 'Turning on… choose Allow if asked.' }, 'muted');
      try {
        const ok = await enable({ onSlowPrompt: () => setMsg(box, { text: 'Waiting for you to choose Allow…', hint: true }, 'muted') });
        b.disabled = false;
        if (ok) { toast('Notifications on'); await paint(box, true); setMsg(box, { text: `On for this ${DEV}. Tap Send test notification to check it pops up.` }, 'ok'); }
        else await paint(box);
      } catch (ex) { b.disabled = false; await paint(box, true); setMsg(box, reason(ex), 'bad'); }
    };
    box.querySelector('#pushOff').onclick = async () => {
      try { await disable(); toast('Notifications off on this device'); await paint(box); } catch (ex) { await paint(box, true); setMsg(box, reason(ex), 'bad'); }
    };
    box.querySelector('#pushTest').onclick = async e => {
      const b = e.currentTarget; if (b.disabled) return; b.disabled = true; setMsg(box, { text: 'Sending a test…' }, 'muted');
      try {
        const r = await sendTest();
        setMsg(box, { text: r.local ? 'Test shown by this device. (The server test is unavailable right now.)' : 'Test sent ✓ It should pop up within a few seconds.',
          html: `<p class="small">${OS_STEPS[PLAT] || OS_STEPS.desktop}</p>` }, 'ok');
      } catch (ex) { await paint(box, true); setMsg(box, reason(ex), 'bad'); }
      finally { b.disabled = false; }
    };
    if (supported()) registration().catch(() => {}); // keeps the worker fresh
    paint(box).then(s => { if (s === 'on') resync(); });
  }

  // After saving an item with reminders: offer to turn notifications on (once per device; never nags).
  async function nudge() {
    const st = await state();
    if (st !== 'off' && st !== 'ios-install') return;
    if (localStorage.getItem(NUDGED)) return;
    localStorage.setItem(NUDGED, '1');
    if (st === 'ios-install') { showInstall(); return; }
    const d = dialog(`<h2>Get a heads-up?</h2>
      <p>Turn on notifications so your reminders pop up on this ${DEV}.</p>
      <div class="onb-err" role="alert"></div>
      <div class="data-btns"><button value="later">Not now</button><button id="nudgeGo" class="primary">Enable notifications</button></div>`, 'push-nudge');
    const err = d.querySelector('.onb-err');
    d.querySelector('#nudgeGo').onclick = async e => {
      e.preventDefault(); const b = e.currentTarget; b.disabled = true;
      try { await enable({ onSlowPrompt: () => { err.innerHTML = `<p class="small">${NOPROMPT_HINT[PLAT] || NOPROMPT_HINT.desktop}</p>`; } }); d.close(); toast('Notifications on'); const box = document.getElementById('pushBox'); if (box) paint(box); }
      catch (ex) { const r = reason(ex); err.innerHTML = ''; const p = document.createElement('p'); p.textContent = r.text; err.appendChild(p); if (r.fix) err.insertAdjacentHTML('beforeend', fixList()); b.disabled = false; }
    };
  }

  function toast(m) { if (window.__app && window.__app.toast) window.__app.toast(m); }
  window.SandyPush = { mount, enable, disable, state, nudge, showInstall, sendTest, platform: () => PLAT, reason };
  // t135u: register the worker on every load (not only when Profile mounts) so the offline page works.
  if ('serviceWorker' in navigator) window.addEventListener('load', () => setTimeout(() => { try { registration().catch(() => {}); } catch (_) {} }, 1500));
})();
