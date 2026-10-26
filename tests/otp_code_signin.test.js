// Code sign-in for the iPhone Home Screen app: after the email is sent, a numeric code field appears,
// verifyOtp({type:'email'}) signs in inside the app. Auth endpoints are mocked. Run: node tests/otp_code_signin.test.js [baseUrl]
const { chromium } = require(process.env.PW || '/workspace/shot-tools/node_modules/playwright-core');
const BASE = process.argv[2] || 'http://127.0.0.1:8765/';
const SHOTS = process.env.OTP_SHOTS || '/workspace/shots-otp';
const assert = (c, m) => { if (!c) throw new Error('FAIL: ' + m); console.log('ok -', m); };
const cfg = `window.CALENDAR_CONFIG = { SUPABASE_URL: '${new URL(BASE).origin}', SUPABASE_ANON_KEY: 'local-anon' };`;
const b64 = o => Buffer.from(JSON.stringify(o)).toString('base64url');
const jwt = [b64({ alg: 'HS256', typ: 'JWT' }), b64({ sub: '33333333-3333-3333-3333-333333333333', email: 'scott@example.com', role: 'authenticated', aud: 'authenticated', exp: Math.floor(Date.now() / 1000) + 86400 }), 'sig'].join('.');
const session = { access_token: jwt, refresh_token: 'r', token_type: 'bearer', expires_in: 86400, expires_at: Math.floor(Date.now() / 1000) + 86400,
  user: { id: '33333333-3333-3333-3333-333333333333', email: 'scott@example.com', aud: 'authenticated', role: 'authenticated' } };
(async () => {
  const b = await chromium.launch({ executablePath: '/usr/bin/google-chrome', headless: true, args: ['--no-sandbox'] });
  for (const dark of [false, true]) {
    const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, colorScheme: dark ? 'dark' : 'light' });
    await ctx.route('**/config.js', r => r.fulfill({ contentType: 'application/javascript', body: cfg }));
    if (dark) await ctx.addInitScript(() => { try { const s = JSON.parse(localStorage.getItem('sandy.settings') || '{}'); } catch (e) {} document.documentElement.classList.add('dark'); });
    const calls = { otp: 0, verify: [] };
    await ctx.route('**/auth/v1/**', r => {
      const u = r.request().url();
      if (/\/otp/.test(u)) { calls.otp++; return r.fulfill({ status: 200, contentType: 'application/json', body: '{}' }); }
      if (/\/verify/.test(u)) {
        const body = JSON.parse(r.request().postData() || '{}'); calls.verify.push(body);
        if (body.token !== '123456') return r.fulfill({ status: 403, contentType: 'application/json', body: JSON.stringify({ code: 403, error_code: 'otp_expired', msg: 'Token has expired or is invalid' }) });
        return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(session) });
      }
      return r.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
    });
    await ctx.route('**/rest/v1/**', r => r.fulfill({ status: 200, contentType: 'application/json', body: '[]' }));
    const p = await ctx.newPage();
    await p.goto(BASE); await p.waitForSelector('#authGate:not([hidden])');
    assert(await p.isHidden('#authCodeForm'), 'code field hidden before email is sent');
    await p.fill('#authEmail', 'scott@example.com'); await p.click('#authForm button[type=submit]');
    await p.waitForSelector('#authCodeForm:not([hidden])');
    assert(await p.isHidden('#authForm'), 'email form swaps out for the code form');
    const attrs = await p.$eval('#authCode', e => [e.inputMode, e.autocomplete, e.maxLength]);
    assert(attrs[0] === 'numeric' && attrs[1] === 'one-time-code' && attrs[2] === 8, 'numeric keypad + one-time-code autofill, accepts up to 8 digits');
    await p.waitForTimeout(400);
    await p.screenshot({ path: `${SHOTS}/otp_code_entry_${dark ? 'dark' : 'light'}_390.png` });
    await p.fill('#authCode', '12'); await p.click('#authCodeBtn');
    assert(/full 8-digit code/.test(await p.textContent('#authCodeErr')) && calls.verify.length === 0, 'short code: clear error, no request');
    await p.type('#authCode', 'ab'); assert(/^\d*$/.test(await p.inputValue('#authCode')), 'non-digits stripped');
    await p.fill('#authCode', '111111'); await p.click('#authCodeBtn');
    await p.waitForFunction(() => /wrong or has expired/.test(document.getElementById('authCodeErr').textContent));
    assert(await p.isVisible('#authGate'), 'wrong code: stays on sign-in with a clear message');
    if (!dark) await p.screenshot({ path: `${SHOTS}/otp_code_error_390.png` });
    await p.click('#authResend'); await p.waitForFunction(() => true); await p.waitForTimeout(300);
    assert(calls.otp === 2, 'Resend code sends again');
    await p.fill('#authCode', '123456'); await p.click('#authCodeBtn');
    await p.waitForSelector('#authGate', { state: 'hidden', timeout: 8000 });
    const v = calls.verify[calls.verify.length - 1];
    assert(v.type === 'email' && v.email === 'scott@example.com', 'verifyOtp called with type email + the same email');
    assert(true, 'right code: signed in inside the app (gate closed)' + (dark ? ' [dark]' : ''));
    await ctx.close();
  }
  await b.close(); console.log('ALL OTP CODE SIGN-IN TESTS PASSED');
})().catch(e => { console.error(e.message); process.exit(1); });
