// Invite-only sign-in: magic links are requested with create_user:false, and an email with no account
// (Supabase answers 422 "Signups not allowed for otp") gets a clear "not invited" message.
// Auth endpoints are mocked; no real Supabase project is touched. Run: node tests/invite_only_signin.test.js [baseUrl]
const { chromium } = require(process.env.PW || '/workspace/shot-tools/node_modules/playwright-core');
const BASE = process.argv[2] || 'http://127.0.0.1:8765/';
const assert = (c, m) => { if (!c) throw new Error('FAIL: ' + m); console.log('ok -', m); };
const cfg = `window.CALENDAR_CONFIG = { SUPABASE_URL: '${new URL(BASE).origin}', SUPABASE_ANON_KEY: 'local-anon' };`;
const INVITED = 'invited@example.com';
(async () => {
  const b = await chromium.launch({ executablePath: '/usr/bin/google-chrome', headless: true, args: ['--no-sandbox'] });
  const ctx = await b.newContext({ viewport: { width: 390, height: 844 } });
  await ctx.route('**/config.js', r => r.fulfill({ contentType: 'application/javascript', body: cfg }));
  const otp = [];
  await ctx.route('**/auth/v1/**', r => {
    const u = r.request().url();
    if (/\/otp/.test(u)) {
      const body = JSON.parse(r.request().postData() || '{}'); otp.push(body);
      if (body.email === INVITED) return r.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
      return r.fulfill({ status: 422, contentType: 'application/json', body: JSON.stringify({ code: 422, error_code: 'otp_disabled', msg: 'Signups not allowed for otp' }) });
    }
    return r.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
  });
  const p = await ctx.newPage();
  await p.goto(BASE); await p.waitForSelector('#authGate:not([hidden])');
  assert(await p.inputValue('#authEmail') === '', 'no email prefilled');
  await p.fill('#authEmail', 'stranger@example.com'); await p.click('#authForm button[type=submit]');
  await p.waitForFunction(() => /invited/.test(document.getElementById('authMsg').textContent));
  assert(/hasn't been invited/.test(await p.textContent('#authMsg')), 'stranger told they are not invited');
  assert(otp[0] && otp[0].create_user === false, 'magic link requested with create_user:false (no account creation)');
  assert(await p.isVisible('#authGate'), 'stranger stays at the sign-in gate');
  await p.screenshot({ path: __dirname + '/../screenshots/20_signin_not_invited_mobile.png' });
  await p.fill('#authEmail', INVITED); await p.click('#authForm button[type=submit]');
  await p.waitForFunction(() => /Check /.test(document.getElementById('authMsg').textContent));
  assert(otp[1].create_user === false, 'invited email: link sent, still create_user:false');
  await b.close(); console.log('ALL INVITE-ONLY TESTS PASSED');
})().catch(e => { console.error(e.message); process.exit(1); });
