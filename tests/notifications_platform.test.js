// Notifications per platform (t147u): the Profile → Notifications box on Android Chrome (Redmi), Samsung Internet
// (Galaxy Tab, incl. desktop-mode UA), in-app browsers, iPhone and iPad (WebKit). Covers granted / already blocked /
// denied at the prompt / dismissed (Chrome quiet UI) / slow prompt hint / iOS "add to Home Screen" first (iPad
// wording) / old iOS / iPad Home Screen app, plus "Send test notification" going to the send-test-push function
// (sent, pending → retry, expired device, server unreachable → local), and a push delivered to sw.js over CDP.
// Self-contained: serves a small harness page with the real push.js + styles.css + sw.js, fake Supabase client.
// Run: node tests/notifications_platform.test.js http://127.0.0.1:8793/   (SHOTS=/dir/ for screenshots)
const PW = require(process.env.PW || '/workspace/shot-tools/node_modules/playwright-core');
const fs = require('fs');
const BASE = process.argv[2] || 'http://127.0.0.1:8793/';
const ORIGIN = new URL(BASE).origin;
const SHOT = process.env.SHOTS || '/workspace/shots-notif/'; fs.mkdirSync(SHOT, { recursive: true });
let fails = 0;
const assert = (c, m) => { if (!c) { fails++; console.log('FAIL -', m); } else console.log('ok -', m); };
const VAPID = 'BPaeiWhjWtYiwgVHbjz8CNHzP8VzQ3l6jqqq4pkWcOqFAOJk44AbKKXHWoWkBErDF8Q_VOppwI1nIwQO_2sPUIQ';

const UA = {
  redmi: 'Mozilla/5.0 (Linux; Android 14; 23117RA68G) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36',
  samsungTab: 'Mozilla/5.0 (Linux; Android 14; SM-X710) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/27.0 Chrome/125.0.0.0 Safari/537.36',
  samsungDesk: 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/27.0 Chrome/125.0.0.0 Safari/537.36',
  instagram: 'Mozilla/5.0 (Linux; Android 14; 23117RA68G; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/130.0.0.0 Mobile Safari/537.36 Instagram 350.0.0.0',
  iphone: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1',
  iphoneOld: 'Mozilla/5.0 (iPhone; CPU iPhone OS 15_7 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/15.7 Mobile/15E148 Safari/604.1',
  ipad: 'Mozilla/5.0 (iPad; CPU OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1',
  ipadDesk: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15',
};
const VP = { redmi: { width: 393, height: 873 }, tab: { width: 800, height: 1280 }, iphone: { width: 390, height: 844 }, ipad: { width: 820, height: 1180 } };

const page = dark => `<!doctype html><html class="${dark ? 'dark' : ''}" lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="styles.css">
<script>window.CALENDAR_CONFIG = { APP_NAME: 'SANDY', VAPID_PUBLIC_KEY: '${VAPID}' };</script></head>
<body style="padding:16px"><h1 style="font-size:20px">Profile</h1>
<section id="accountSection"><h2>Account</h2><p class="small">qa@example.com</p><div class="data-btns"><button>Export my data</button></div></section>
<script src="push.js"></script>
<script>window.__calls = [];
const sb = { rpc: async (n, a) => { __calls.push(['rpc', n, a]); return { error: null }; },
  from: () => ({ delete: () => ({ eq: async () => ({ error: null }) }) }),
  functions: { invoke: async (n, o) => { __calls.push(['fn', n, o && o.body]); const q = window.__fnQ || []; const r = q.length ? q.shift() : { data: { sent: 1, failed: 0, gone: false, devices: 1, status: 201 } };
    if (r === 'throw') throw new Error('Failed to fetch'); return r; } } };
SandyPush.mount({ store: { adapter: { client: sb } }, user: { id: 'u1', email: 'qa@example.com' } });</script></body></html>`;

// perm: 'granted' | 'denied' (already blocked) | 'deny' (blocks at the prompt) | 'dismiss' | 'slow' | 'ask' (allows)
function stubs({ perm, noNotif, ios, standalone, macTouch }) {
  if (macTouch) { Object.defineProperty(Navigator.prototype, 'platform', { get: () => 'MacIntel' }); Object.defineProperty(Navigator.prototype, 'maxTouchPoints', { get: () => 5 }); }
  if (standalone) Object.defineProperty(Navigator.prototype, 'standalone', { get: () => true });
  if (noNotif) { delete window.Notification; delete window.PushManager; return; }
  if (ios && standalone && !window.PushManager) { // iOS 16.4+ Home Screen app has PushManager; Linux WebKit doesn't
    window.PushManager = function PushManager() {};
    const pm = new window.PushManager();
    Object.defineProperty(ServiceWorkerRegistration.prototype, 'pushManager', { get: () => pm });
  }
  let cur = perm === 'denied' ? 'denied' : perm === 'granted' ? 'granted' : 'default';
  if (window.Notification) {
    Object.defineProperty(Notification, 'permission', { configurable: true, get: () => cur });
    Notification.requestPermission = () => new Promise(res => {
      const v = perm === 'deny' ? 'denied' : perm === 'dismiss' ? 'default' : perm === 'denied' ? 'denied' : 'granted';
      setTimeout(() => { cur = v; res(v); }, perm === 'slow' ? 5200 : 150);
    });
  }
  if (!window.PushManager) return;
  let sub = null;
  const mk = key => ({ endpoint: 'https://fcm.googleapis.com/fcm/send/test-' + Math.random().toString(36).slice(2), options: { applicationServerKey: key },
    toJSON() { return { endpoint: this.endpoint, keys: { p256dh: 'B' + 'x'.repeat(86), auth: 'y'.repeat(22) } }; },
    async unsubscribe() { sub = null; return true; } });
  PushManager.prototype.getSubscription = async () => sub;
  PushManager.prototype.subscribe = async o => (sub = mk(o.applicationServerKey.buffer || o.applicationServerKey));
}

(async () => {
  const chrome = await PW.chromium.launch({ executablePath: '/usr/bin/google-chrome', headless: true, args: ['--no-sandbox'] });
  const webkit = await PW.webkit.launch();
  async function open(name, { engine = 'chrome', ua, vp, touch = true, dark = false, ...st }) {
    const b = engine === 'webkit' ? webkit : chrome;
    const ctx = await b.newContext({ viewport: vp, userAgent: ua, hasTouch: touch, isMobile: engine === 'chrome' ? touch : undefined, colorScheme: dark ? 'dark' : 'light', serviceWorkers: 'allow', locale: 'en-US' });
    if (engine === 'chrome' && (st.perm === 'granted' || ['ask', 'slow'].includes(st.perm))) await ctx.grantPermissions(['notifications'], { origin: ORIGIN });
    await ctx.route('**/__notif.html', r => r.fulfill({ contentType: 'text/html', body: page(dark) }));
    await ctx.addInitScript(stubs, { ios: engine === 'webkit', ...st });
    const p = await ctx.newPage(); const errs = []; p.on('pageerror', e => errs.push(e.message));
    await p.goto(BASE + '__notif.html');
    await p.waitForFunction(() => { const b = document.getElementById('pushBox'); return b && b.dataset.state; }, null, { timeout: 15000 });
    return { ctx, p, errs, shot: async tag => p.screenshot({ path: `${SHOT}${name}-${tag}-${dark ? 'dark' : 'light'}.png` }) };
  }
  const S = p => p.evaluate(() => { const b = document.getElementById('pushBox'); const v = s => { const e = b.querySelector(s); return e && !e.hidden ? e.textContent.trim() : null; };
    return { state: b.dataset.state, plat: b.dataset.platform, status: b.querySelector('.push-status').textContent.trim(), help: v('.push-help'), enable: v('#pushEnable'), test: v('#pushTest'), off: v('#pushOff'), calls: window.__calls }; });
  const tap = async (p, sel) => p.locator(sel).tap();
  const waitStatus = (p, re, ms = 15000) => p.waitForFunction(r => new RegExp(r).test(document.querySelector('#pushBox .push-status').textContent), re.source, { timeout: ms });

  for (const dark of [false, true]) {
    const M = dark ? ' [dark]' : '';
    // ---------- Android Chrome (Redmi) and Samsung Internet (Galaxy Tab): granted → on → test
    for (const [name, ua, vp, plat] of [['redmi-chrome', UA.redmi, VP.redmi, 'android'], ['galaxy-tab-samsung', UA.samsungTab, VP.tab, 'samsung'], ['galaxy-tab-samsung-desktop-ua', UA.samsungDesk, VP.tab, 'samsung']]) {
      const { ctx, p, errs, shot } = await open(name, { ua, vp, perm: 'ask', dark });
      let s = await S(p);
      assert(s.plat === plat && s.state === 'off' && s.enable === 'Enable notifications' && !s.test, `${name}${M}: platform ${plat}, off, Enable shown`);
      await shot('off');
      await tap(p, '#pushEnable'); await waitStatus(p, /On for this/);
      s = await S(p);
      assert(s.state === 'on' && s.test === 'Send test notification' && s.off && s.calls.some(c => c[1] === 'save_push_subscription' && /fcm/.test(c[2].p_endpoint)), `${name}${M}: tap Enable → on, device saved to server`);
      await shot('on');
      await tap(p, '#pushTest'); await waitStatus(p, /Test sent/);
      s = await S(p);
      const fn = s.calls.filter(c => c[0] === 'fn');
      assert(fn.length === 1 && fn[0][1] === 'send-test-push' && /fcm/.test(fn[0][2].endpoint), `${name}${M}: Send test → send-test-push with this device's endpoint`);
      assert(/Still nothing\?/.test(s.help) && (plat === 'samsung' ? /Samsung Internet/.test(s.help) : /Floating notifications/.test(s.help)), `${name}${M}: test sent shows the ${plat} "still nothing?" steps`);
      await shot('test-sent');
      // the push itself: deliver to sw.js over CDP and check it shows the notification
      if (!dark) {
        const cdp = await ctx.newCDPSession(p);
        const regs = []; cdp.on('ServiceWorker.workerRegistrationUpdated', e => regs.push(...e.registrations));
        await cdp.send('ServiceWorker.enable'); await p.waitForTimeout(500);
        const reg = regs.find(r => r.scopeURL.startsWith(ORIGIN) && !r.isDeleted);
        await cdp.send('ServiceWorker.deliverPushMessage', { origin: ORIGIN, registrationId: reg.registrationId, data: JSON.stringify({ title: 'SANDY', body: 'Test notification: notifications work on this device 🎉', tag: 'sandy-test', url: './?tab=profile' }) });
        const shown = await p.evaluate(async () => { for (let i = 0; i < 40; i++) { const r = await navigator.serviceWorker.ready; const n = await r.getNotifications({ tag: 'sandy-test' }); if (n.length) return n.map(x => x.body); await new Promise(r => setTimeout(r, 100)); } return []; });
        assert(shown.length === 1 && /notifications work/.test(shown[0]), `${name}: push delivered to sw.js shows the test notification`);
      }
      // turn off
      await tap(p, '#pushOff'); await waitStatus(p, /Off for this/);
      assert((await S(p)).state === 'off', `${name}${M}: Turn off → off`);
      assert(!errs.length, `${name}${M}: no page errors ${errs.join('|')}`);
      await ctx.close();
    }

    // ---------- Android: already blocked, blocked at the prompt, dismissed (quiet UI), slow prompt
    for (const [name, ua, vp, plat] of [['redmi-chrome', UA.redmi, VP.redmi, 'android'], ['galaxy-tab-samsung', UA.samsungTab, VP.tab, 'samsung']]) {
      const fixRe = plat === 'samsung' ? /Allow sites to ask/ : /Site settings/;
      let { ctx, p, shot } = await open(name, { ua, vp, perm: 'denied', dark });
      let s = await S(p);
      assert(s.state === 'blocked' && s.enable === 'Try again' && fixRe.test(s.help) && /App info/.test(s.help), `${name}${M}: already blocked → "Try again" + ${plat} fix steps`);
      await shot('blocked'); await ctx.close();

      ({ ctx, p, shot } = await open(name, { ua, vp, perm: 'deny', dark }));
      await tap(p, '#pushEnable'); await waitStatus(p, /blocked/);
      s = await S(p);
      assert(s.state === 'blocked' && fixRe.test(s.help) && !s.calls.length, `${name}${M}: Block at the prompt → blocked with fix steps, nothing saved`);
      await ctx.close();

      ({ ctx, p, shot } = await open(name, { ua, vp, perm: 'dismiss', dark }));
      await tap(p, '#pushEnable'); await waitStatus(p, /closed without choosing Allow/);
      s = await S(p);
      assert(s.state === 'off' && (plat === 'samsung' ? /Allow sites to ask/ : /bell/).test(s.help) && s.enable === 'Enable notifications', `${name}${M}: dismissed / quiet prompt → reason + where to look`);
      await shot('dismissed'); await ctx.close();

      if (!dark) {
        ({ ctx, p, shot } = await open(name, { ua, vp, perm: 'slow', dark }));
        await tap(p, '#pushEnable'); await waitStatus(p, /Waiting for you to choose Allow/, 6000);
        s = await S(p);
        assert((plat === 'samsung' ? /Allow sites to ask/ : /bell/).test(s.help), `${name}: no pop-up after 4 s → hint where the prompt went`);
        await waitStatus(p, /On for this/);
        assert((await S(p)).state === 'on', `${name}: late Allow still turns it on`);
        await ctx.close();
      }
    }

    // ---------- Send test: pending (new device) → retried, expired → removed, server unreachable → local
    if (!dark) {
      const { ctx, p } = await open('redmi-chrome', { ua: UA.redmi, vp: VP.redmi, perm: 'granted' });
      await tap(p, '#pushEnable'); await waitStatus(p, /On for this/);
      await p.evaluate(() => { window.__fnQ = [{ data: { sent: 0, pending: 1, gone: false, devices: 1, status: 410 } }]; });
      await tap(p, '#pushTest'); await waitStatus(p, /Test sent/, 12000);
      assert((await S(p)).calls.filter(c => c[0] === 'fn').length === 2, 'test on a brand-new device: pending → retried → sent');
      await p.evaluate(() => { window.__fnQ = [{ data: { sent: 0, devices: 0, status: 0 } }]; });
      await tap(p, '#pushTest'); await waitStatus(p, /Test sent/);
      const c = (await S(p)).calls; assert(c.slice(-2)[0][1] === 'save_push_subscription' && c.slice(-1)[0][1] === 'send-test-push', 'server forgot the device → re-saved and test re-sent');
      await p.evaluate(() => { window.__fnQ = ['throw']; });
      await tap(p, '#pushTest'); await waitStatus(p, /shown by this device/);
      assert(true, 'server unreachable → local test notification fallback');
      await p.evaluate(() => { window.__fnQ = [{ data: { sent: 0, gone: true, devices: 1, status: 410 } }]; });
      await tap(p, '#pushTest'); await waitStatus(p, /expired/);
      assert((await S(p)).state === 'off', 'expired device (410) → removed, box back to off with a reason');
      await ctx.close();
    }

    // ---------- in-app browser (Instagram / Android WebView: no Notification API)
    {
      const { ctx, p, shot } = await open('instagram-inapp', { ua: UA.instagram, vp: VP.redmi, noNotif: true, dark });
      const s = await S(p);
      assert(s.state === 'inapp' && /in-app browser/.test(s.status) && /Open SANDY in Chrome/.test(s.status) && !s.enable, `in-app browser${M}: says open in Chrome, no dead button`);
      await shot('inapp'); await ctx.close();
    }

    // ---------- iPhone / iPad in Safari: add to Home Screen first
    for (const [name, ua, vp, dev, extra] of [['iphone', UA.iphone, VP.iphone, 'iPhone', {}], ['ipad', UA.ipad, VP.ipad, 'iPad', {}], ['ipad-desktop-ua', UA.ipadDesk, VP.ipad, 'iPad', { macTouch: true }]]) {
      const { ctx, p, errs, shot } = await open(name, { engine: 'webkit', ua, vp, perm: 'ask', dark, ...extra });
      let s = await S(p);
      assert(s.state === 'ios-install' && s.plat === dev.toLowerCase() && s.enable === `How to enable on ${dev}` && new RegExp(`On ${dev}, add SANDY to your Home Screen`).test(s.status), `${name}${M}: Safari → "${s.enable}"`);
      await shot('needs-install');
      await tap(p, '#pushEnable');
      await p.waitForSelector('dialog.push-install[open]');
      const t = await p.textContent('dialog.push-install');
      assert(new RegExp(`${dev} shows notifications only for apps on your Home Screen`).test(t) && (dev === 'iPad' ? /top right/.test(t) && /iPadOS 16\.4/.test(t) : /iOS 16\.4/.test(t)), `${name}${M}: install steps use ${dev} wording`);
      await p.waitForTimeout(700); await shot('install-steps');
      assert(!errs.length, `${name}${M}: no page errors ${errs.join('|')}`);
      await ctx.close();
    }
    {
      const { ctx, p, shot } = await open('iphone-ios15', { engine: 'webkit', ua: UA.iphoneOld, vp: VP.iphone, perm: 'ask', dark });
      const s = await S(p);
      assert(s.state === 'ios-old' && /iOS 16\.4 or newer/.test(s.status) && !s.enable, `iOS 15${M}: told to update, no dead button`);
      await shot('ios-old'); await ctx.close();
    }
    // ---------- iPad / iPhone Home Screen app (iPadOS 17): Allow → on → test; Don't Allow → iPad fix steps
    for (const [name, ua, vp, dev] of [['ipad-homescreen', UA.ipad, VP.ipad, 'iPad'], ['iphone-homescreen', UA.iphone, VP.iphone, 'iPhone']]) {
      let { ctx, p, errs, shot } = await open(name, { engine: 'webkit', ua, vp, perm: 'ask', standalone: true, dark });
      let s = await S(p);
      assert(s.state === 'off' && s.enable === 'Enable notifications', `${name}${M}: Home Screen app → off, Enable shown`);
      await shot('off');
      await tap(p, '#pushEnable'); await waitStatus(p, /On for this/);
      s = await S(p);
      assert(s.state === 'on' && new RegExp(`On for this ${dev}`).test(s.status) && s.calls.some(c => c[1] === 'save_push_subscription'), `${name}${M}: Allow → on, device saved`);
      await shot('on');
      await tap(p, '#pushTest'); await waitStatus(p, /Test sent/);
      assert(/Focus/.test((await S(p)).help), `${name}${M}: test sent + iOS "still nothing?" steps`);
      await shot('test-sent');
      assert(!errs.length, `${name}${M}: no page errors ${errs.join('|')}`);
      await ctx.close();
      ({ ctx, p, shot } = await open(name, { engine: 'webkit', ua, vp, perm: 'deny', standalone: true, dark }));
      await tap(p, '#pushEnable'); await waitStatus(p, /blocked/);
      s = await S(p);
      assert(s.state === 'blocked' && new RegExp(`Open the ${dev} <b>|Open the ${dev} Settings`).test(s.help) && /SANDY/.test(s.help), `${name}${M}: Don't Allow → blocked with ${dev} Settings steps`);
      await shot('blocked'); await ctx.close();
    }
  }
  await chrome.close(); await webkit.close();
  console.log(fails ? `${fails} FAILED` : 'NOTIFICATIONS PLATFORM TESTS PASSED');
  process.exit(fails ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
