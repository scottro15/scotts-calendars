// Item 7 (t152u/t153u): Home Screen app sign-in. iPhone/iPad Home Screen apps keep their own sign-in (separate
// from Safari): standalone + signed out shows clear guidance; code sign-in completes inside the app; the session
// survives reopen/update (refresh token + saved copies kept); an expired token that can't be renewed offline shows
// "still signed in, reconnecting" (not the sign-in form) and recovers; a token the server rejects shows sign-in.
// Safari on iPhone/iPad tells you to sign in once more in the Home Screen app. Auth/REST mocked. Light + dark.
//   node tests/standalone_signin.test.js BASE [SHOTS]
const PW = require(process.env.PW || '/usr/local/lib/pnpm/5/.pnpm/playwright-core@1.59.1/node_modules/playwright-core');
const fs = require('fs');
const BASE = process.argv[2] || 'http://127.0.0.1:8793/';
const SHOTS = process.argv[3] || '/workspace/shots-oct29/standalone-signin'; fs.mkdirSync(SHOTS, { recursive: true });
let n = 0; const ok = (c, m) => { if (!c) throw new Error('FAIL: ' + m); console.log('ok -', m); n++; };
const DEV = [['iphone', 'webkit', 393, 852], ['ipad', 'webkit', 820, 1180], ['android-phone', 'chromium', 412, 915], ['android-tablet', 'chromium', 800, 1280]];
const UA = { iphone: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1',
  ipad: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15',
  'android-phone': 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Mobile Safari/537.36',
  'android-tablet': 'Mozilla/5.0 (Linux; Android 14; SM-X710) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36' };
const ORIGIN = new URL(BASE).origin, REF = new URL(BASE).hostname.split('.')[0], KEY = `sb-${REF}-auth-token`;
const UID = '33333333-3333-3333-3333-333333333333';
const b64 = o => Buffer.from(JSON.stringify(o)).toString('base64url');
const sess = (expIn, rt = 'r1') => { const exp = Math.floor(Date.now() / 1000) + expIn;
  return { access_token: [b64({ alg: 'HS256', typ: 'JWT' }), b64({ sub: UID, email: 'qa@example.com', role: 'authenticated', aud: 'authenticated', exp }), 'sig'].join('.'), refresh_token: rt, token_type: 'bearer', expires_in: expIn, expires_at: exp,
    user: { id: UID, email: 'qa@example.com', aud: 'authenticated', role: 'authenticated' } }; };
const json = (r, body, status = 200) => r.fulfill({ status, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify(body) });
(async () => {
  const B = { webkit: await PW.webkit.launch(), chromium: await PW.chromium.launch({ executablePath: '/usr/bin/google-chrome', args: ['--no-sandbox'] }) };
  const errs = [];
  try {
    for (const [name, eng, w, h] of DEV) for (const dark of [false, true]) {
      const tag = `${name}-${dark ? 'dark' : 'light'}`; const ios = eng === 'webkit';
      async function open({ standalone, stored, token = 'ok' }) {
        const ctx = await B[eng].newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 2, isMobile: !ios || name === 'iphone' ? eng === 'chromium' : false, hasTouch: true, userAgent: UA[name], colorScheme: dark ? 'dark' : 'light', timezoneId: 'America/Chicago', locale: 'en-US', serviceWorkers: 'block' });
        await ctx.route('**/config.js', r => r.fulfill({ contentType: 'application/javascript', body: `window.CALENDAR_CONFIG = { SUPABASE_URL: '${ORIGIN}', SUPABASE_ANON_KEY: 'local-anon' };` }));
        const st = { token, calls: [] };
        await ctx.route('**/auth/v1/**', r => { const u = r.request().url(); st.calls.push(u.replace(ORIGIN, ''));
          if (/\/otp/.test(u)) return json(r, {});
          if (/\/verify/.test(u)) return json(r, sess(3600, 'r-new'));
          if (/\/token/.test(u)) { if (st.token === 'offline') return r.abort('internetdisconnected'); if (st.token === 'rejected') return json(r, { code: 400, error_code: 'refresh_token_not_found', msg: 'Invalid Refresh Token: Refresh Token Not Found' }, 400); return json(r, sess(3600, 'r-renewed')); }
          if (/\/user/.test(u)) return json(r, sess(3600).user);
          return json(r, {}); });
        await ctx.route('**/rest/v1/**', r => { const u = r.request().url();
          if (/\/calendars/.test(u)) return json(r, [{ id: 'msc', owner_id: UID, name: 'Work', color: '#2563eb', sort: 0 }]);
          if (/\/profiles/.test(u)) return json(r, /select=\*|select=/.test(u) ? [{ user_id: UID, time_zone: 'America/Chicago' }] : []);
          return json(r, []); });
        await ctx.route(/api\.weather\.gov|open-meteo\.com|photon\.komoot|valhalla/, r => json(r, {}));
        await ctx.addInitScript(([standalone, stored, key, d, ios]) => {
          if (/Macintosh/.test(navigator.userAgent)) Object.defineProperty(Navigator.prototype, 'maxTouchPoints', { get: () => 5, configurable: true }); // iPadOS reports a Mac UA + touch
          if (standalone) { const mm = window.matchMedia.bind(window); window.matchMedia = q => /display-mode:\s*standalone/.test(q) ? { matches: true, media: q, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {}, onchange: null, dispatchEvent() { return false; } } : mm(q);
            if (ios) Object.defineProperty(navigator, 'standalone', { get: () => true, configurable: true }); }
          if (sessionStorage.getItem('__i')) return; sessionStorage.setItem('__i', '1');
          localStorage.setItem('sandy.welcome.off', '1'); localStorage.setItem('sandy.tour.off', '1'); if (d) localStorage.setItem('sandy.theme', 'dark');
          if (stored) localStorage.setItem(key, JSON.stringify(stored));
        }, [standalone, stored || null, KEY, dark, ios]);
        const p = await ctx.newPage(); p.on('pageerror', e => errs.push(`${tag}: ${e.message}`));
        await p.goto(BASE); return { ctx, p, st };
      }
      const signedIn = p => p.waitForFunction(() => document.getElementById('authGate').hidden && window.__app && window.__app.Store, null, { timeout: 15000 });
      console.log('#', tag);
      // 1. Home Screen app, signed out: guidance + code sign-in inside the app
      let { ctx, p, st } = await open({ standalone: true });
      await p.waitForSelector('#authGate:not([hidden]) #authHomeNote:not([hidden])');
      const note = await p.textContent('#authHomeNote');
      ok(ios ? /Sign in once here in the Home Screen app/.test(note) && /separate sign-ins/.test(note) && /no link to tap/.test(note) : /Sign in once here in the SANDY app/.test(note), `${tag}: standalone + signed out shows Home Screen guidance`);
      ok(await p.$eval('#authHomeNote', e => getComputedStyle(e).animationName) === 'onb-in', `${tag}: guidance eases in`);
      ok(await p.isVisible('#authForm') && await p.isHidden('#authReconnect'), `${tag}: email form shown (no saved sign-in)`);
      await p.waitForTimeout(450); await p.screenshot({ path: `${SHOTS}/${tag}-1-homescreen-signin.png` });
      await p.fill('#authEmail', 'qa@example.com'); await p.click('#authForm button[type=submit]'); await p.waitForSelector('#authCodeForm:not([hidden])');
      ok(await p.isVisible('#authHomeNote'), `${tag}: guidance stays while typing the code`);
      await p.fill('#authCode', '12345678'); await p.click('#authCodeBtn'); await signedIn(p);
      ok(st.calls.some(c => /\/verify/.test(c)), `${tag}: code verified inside the app (no link / no Safari)`);
      const saved = await p.evaluate(k => JSON.parse(localStorage.getItem(k) || 'null'), KEY);
      ok(saved && saved.refresh_token === 'r-new', `${tag}: session + refresh token saved in the app's storage`);
      await p.waitForTimeout(1500);
      // 2. close + reopen / update reload: still signed in, refresh token + saved copies kept
      await p.reload(); await signedIn(p); await p.waitForTimeout(800);
      await p.evaluate(() => sessionStorage.setItem('sandy.updateTried', 'x')); await p.reload(); await signedIn(p); await p.waitForTimeout(800);
      const after = await p.evaluate(([k, uid]) => ({ s: JSON.parse(localStorage.getItem(k) || 'null'), snap: Object.keys(localStorage).filter(x => x.startsWith('sandy.snap.v1.') && x.endsWith(uid)) }), [KEY, UID]);
      ok(after.s && after.s.refresh_token && await p.isHidden('#authGate'), `${tag}: reopen + update reload stay signed in (refresh token kept)`);
      ok(after.snap.length >= 1, `${tag}: update-safe saved copies still written (${after.snap.join(',')})`);
      await ctx.close();
      // 3. expired token, offline: "still signed in, reconnecting", then recovers
      ({ ctx, p, st } = await open({ standalone: true, stored: sess(-600, 'r-old'), token: 'offline' }));
      await p.waitForSelector('#authReconnect:not([hidden])', { timeout: 20000 });
      ok(/still signed in/i.test(await p.textContent('#authMsg')) && await p.isHidden('#authForm') && await p.isHidden('#authHomeNote'), `${tag}: offline renew -> "still signed in", no sign-in form`);
      ok(await p.$eval('#authReconnect', e => getComputedStyle(e).animationName) === 'onb-in', `${tag}: reconnect state eases in`);
      ok(!!(await p.evaluate(k => localStorage.getItem(k), KEY)), `${tag}: saved sign-in not removed by the network error`);
      await p.waitForTimeout(400); await p.screenshot({ path: `${SHOTS}/${tag}-2-reconnecting.png` });
      st.token = 'ok'; await p.click('#authRetry'); await p.waitForFunction(() => document.getElementById('authGate').hidden && window.__app && window.__app.Store, null, { timeout: 40000 });
      ok((await p.evaluate(k => JSON.parse(localStorage.getItem(k)).refresh_token, KEY)) === 'r-renewed', `${tag}: back online -> renewed and into the app, no code needed`);
      await ctx.close();
      // 4. server rejects the refresh token: normal sign-in (with guidance)
      ({ ctx, p, st } = await open({ standalone: true, stored: sess(-600, 'r-bad'), token: 'rejected' }));
      await p.waitForSelector('#authForm:not([hidden])', { timeout: 20000 });
      ok(await p.isHidden('#authReconnect') && await p.isVisible('#authHomeNote'), `${tag}: rejected sign-in -> sign-in form with guidance`);
      await ctx.close();
      // 5. browser (not installed), signed out
      ({ ctx, p, st } = await open({ standalone: false }));
      await p.waitForSelector('#authGate:not([hidden]) #authForm');
      if (ios) { await p.waitForSelector('#authHomeNote:not([hidden])'); ok(/sign in once there too/.test(await p.textContent('#authHomeNote')), `${tag}: Safari tells you to sign in again in the Home Screen app`);
        await p.waitForTimeout(450); await p.screenshot({ path: `${SHOTS}/${tag}-3-safari-signin.png` }); }
      else ok(await p.isHidden('#authHomeNote'), `${tag}: Android browser: no extra note (Chrome shares sign-in with the installed app)`);
      await ctx.close();
    }
    ok(errs.length === 0, 'no page errors ' + errs.join(' | '));
  } finally { await B.webkit.close(); await B.chromium.close(); }
  console.log(`STANDALONE SIGN-IN TEST PASSED (${n} checks)`);
})().catch(e => { console.error(e.message || e); process.exit(1); });
