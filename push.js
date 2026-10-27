/*
 * push.js: phone/desktop notifications for reminders (Web Push).
 * - Account → Notifications: status + "Enable notifications" (subscribes this device, saved via save_push_subscription).
 * - iPhone/iPad: Web Push only works from the Home Screen app (iOS 16.4+), so Safari shows a friendly
 *   "Add to Home Screen" explainer first.
 * - nudge(): called after saving an item with reminders; offers to turn notifications on (once per device).
 * Sending happens server-side (supabase/functions/send-reminders, every minute).
 */
(function () {
  const CFG = window.CALENDAR_CONFIG || {};
  const KEY = CFG.VAPID_PUBLIC_KEY || '';
  const NUDGED = 'sandy.pushNudged';
  let ctx = null;

  const ua = navigator.userAgent || '';
  const isIOS = /iPad|iPhone|iPod/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const standalone = () => !!((window.matchMedia && matchMedia('(display-mode: standalone)').matches) || navigator.standalone);
  const supported = () => 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
  const u8 = b64 => { const s = atob((b64 + '='.repeat((4 - b64.length % 4) % 4)).replace(/-/g, '+').replace(/_/g, '/')); return Uint8Array.from(s, c => c.charCodeAt(0)); };
  const b64u = buf => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

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
    }
    return regP;
  }

  // 'ios-install' | 'unsupported' | 'blocked' | 'on' | 'off' | 'nokey'
  async function state() {
    if (isIOS && !standalone()) return 'ios-install';
    if (!supported()) return 'unsupported';
    if (!KEY) return 'nokey';
    if (Notification.permission === 'denied') return 'blocked';
    if (Notification.permission !== 'granted') return 'off';
    try { const reg = await registration(); return (await reg.pushManager.getSubscription()) ? 'on' : 'off'; } catch (_) { return 'off'; }
  }

  async function enable() {
    const st = await state();
    if (st === 'ios-install') { showInstall(); return false; }
    if (st === 'unsupported' || st === 'nokey') throw new Error("This browser can't show notifications.");
    const perm = await Notification.requestPermission();
    if (perm !== 'granted') throw new Error(perm === 'denied' ? 'Notifications are blocked. Turn them on in Settings for this app/site.' : 'Notifications were not allowed.');
    const reg = await registration();
    let sub = await reg.pushManager.getSubscription();
    if (sub && sub.options && sub.options.applicationServerKey && b64u(sub.options.applicationServerKey) !== KEY) { await sub.unsubscribe(); sub = null; }
    if (!sub) sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: u8(KEY) });
    const j = sub.toJSON();
    const sb = ctx && ctx.store.adapter && ctx.store.adapter.client;
    if (!sb) throw new Error('Sign in to turn on notifications.');
    const { error } = await sb.rpc('save_push_subscription', { p_endpoint: j.endpoint, p_p256dh: j.keys.p256dh, p_auth: j.keys.auth, p_user_agent: ua.slice(0, 400) });
    if (error) throw new Error(/save_push_subscription|schema cache/.test(error.message) ? 'Notifications need a quick database update first. Try again soon.' : error.message);
    return true;
  }

  async function disable() {
    const reg = await registration(); const sub = await reg.pushManager.getSubscription();
    if (!sub) return;
    const sb = ctx && ctx.store.adapter && ctx.store.adapter.client;
    if (sb) await sb.from('push_subscriptions').delete().eq('endpoint', sub.endpoint);
    await sub.unsubscribe();
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
    dialog(`<h2>Get reminders on your iPhone</h2>
      <p>iPhone shows notifications only for apps on your Home Screen. It takes a few seconds:</p>
      <ol class="push-steps">
        <li>Tap the <b>Share</b> button <span aria-hidden="true">(the square with the ↑ arrow)</span> in Safari.</li>
        <li>Choose <b>Add to Home Screen</b>, then tap <b>Add</b>.</li>
        <li>Open <b>SANDY</b> from the new Home Screen icon and sign in.</li>
        <li>Open the menu → <b>Account</b> → <b>Enable notifications</b> → <b>Allow</b>.</li>
      </ol>
      <p class="muted small">Needs iOS 16.4 or newer.</p>
      <div class="data-btns"><button value="ok" class="primary">Got it</button></div>`, 'push-install');
  }

  const LABEL = {
    'on': 'On for this device. Reminders will pop up here.',
    'off': 'Off for this device.',
    'blocked': 'Blocked. Allow notifications for this site/app in your settings, then reload.',
    'ios-install': 'On iPhone, add SANDY to your Home Screen first.',
    'unsupported': "This browser doesn't support notifications.",
    'nokey': 'Notifications are not set up yet.',
  };

  async function paint(box) {
    const st = await state();
    box.querySelector('.push-status').textContent = LABEL[st];
    const on = box.querySelector('#pushEnable'), off = box.querySelector('#pushOff'), test = box.querySelector('#pushTest');
    on.hidden = st === 'on' || st === 'unsupported' || st === 'nokey';
    on.textContent = st === 'ios-install' ? 'How to enable on iPhone' : 'Enable notifications';
    off.hidden = test.hidden = st !== 'on';
    return st;
  }

  function mount({ store, user }) {
    ctx = { store, user };
    const acct = document.getElementById('accountSection');
    if (!acct || !user || document.getElementById('pushBox')) return;
    const box = document.createElement('div'); box.id = 'pushBox'; box.className = 'push-box';
    box.innerHTML = `<h3>Notifications</h3><p class="push-status small muted" role="status" aria-live="polite">…</p>
      <div class="data-btns"><button id="pushEnable" class="primary">Enable notifications</button>
      <button id="pushTest" hidden>Send a test</button><button id="pushOff" class="link-btn" hidden>Turn off on this device</button></div>
      <p class="muted small">Add reminders to any event or to-do in its edit screen.</p>`;
    acct.querySelector('.data-btns').after(box);
    const st = box.querySelector('.push-status');
    box.querySelector('#pushEnable').onclick = async e => {
      const b = e.currentTarget; b.disabled = true;
      try { if (await enable()) toast('Notifications on'); } catch (ex) { st.textContent = ex.message || String(ex); b.disabled = false; return; }
      b.disabled = false; paint(box);
    };
    box.querySelector('#pushOff').onclick = async () => { try { await disable(); toast('Notifications off on this device'); } catch (ex) { st.textContent = ex.message; } paint(box); };
    box.querySelector('#pushTest').onclick = async () => {
      const reg = await registration();
      reg.showNotification('SANDY', { body: 'Notifications work on this device 🎉', tag: 'sandy-test', icon: 'icons/icon-192.png', badge: 'icons/badge-72.png' });
    };
    if (supported()) registration().catch(() => {}); // keeps the worker fresh
    paint(box);
  }

  // After saving an item with reminders: offer to turn notifications on (once per device; never nags).
  async function nudge() {
    const st = await state();
    if (st === 'on' || st === 'unsupported' || st === 'nokey' || st === 'blocked') return;
    if (localStorage.getItem(NUDGED)) return;
    localStorage.setItem(NUDGED, '1');
    if (st === 'ios-install') { showInstall(); return; }
    const d = dialog(`<h2>Get a heads-up?</h2>
      <p>Turn on notifications so your reminders pop up on this device.</p>
      <p class="onb-err" role="alert"></p>
      <div class="data-btns"><button value="later">Not now</button><button id="nudgeGo" class="primary">Enable notifications</button></div>`, 'push-nudge');
    d.querySelector('#nudgeGo').onclick = async e => {
      e.preventDefault();
      try { await enable(); d.close(); toast('Notifications on'); const box = document.getElementById('pushBox'); if (box) paint(box); }
      catch (ex) { d.querySelector('.onb-err').textContent = ex.message || String(ex); }
    };
  }

  function toast(m) { if (window.__app && window.__app.toast) window.__app.toast(m); }
  window.SandyPush = { mount, enable, disable, state, nudge, showInstall };
})();
