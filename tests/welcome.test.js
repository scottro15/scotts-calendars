// Code-only sign-in wording + one-time beta welcome sheet (welcome.js). Auth/REST are mocked.
// Run: node tests/welcome.test.js [baseUrl]   (env WELCOME_SHOTS=dir for screenshots + video)
const { chromium } = require(process.env.PW || '/workspace/shot-tools/node_modules/playwright-core');
const fs = require('fs');
const BASE = process.argv[2] || 'http://127.0.0.1:8765/';
const SHOTS = process.env.WELCOME_SHOTS || '/tmp/shots-welcome';
fs.mkdirSync(SHOTS, { recursive: true });
let n = 0; const assert = (c, m) => { if (!c) throw new Error('FAIL: ' + m); n++; console.log('ok -', m); };
const OWNER = 'owner@example.com';
const cfg = `window.CALENDAR_CONFIG = { SUPABASE_URL: '${new URL(BASE).origin}', SUPABASE_ANON_KEY: 'local-anon', APP_NAME: 'SANDY', OWNER_EMAIL: '${OWNER}' };`;
const b64 = o => Buffer.from(JSON.stringify(o)).toString('base64url');
const mkSession = (id, email) => {
  const jwt = [b64({ alg: 'HS256', typ: 'JWT' }), b64({ sub: id, email, role: 'authenticated', aud: 'authenticated', exp: Math.floor(Date.now() / 1000) + 86400 }), 'sig'].join('.');
  return { access_token: jwt, refresh_token: 'r', token_type: 'bearer', expires_in: 86400, expires_at: Math.floor(Date.now() / 1000) + 86400,
    user: { id, email, aud: 'authenticated', role: 'authenticated', created_at: '2026-10-26T16:00:00Z' } };
};
const VERBATIM = [
  'Welcome to SANDY, and thank you for taking the time to test it.',
  'This is a beta, so there will be bugs. Please report any issues you run into, and send me your feedback and suggestions too.',
  'Getting Started (this part is key)',
  'Open SANDY in Safari and tap Share, then Add to Home Screen.',
  'Open SANDY from your Home Screen icon, not from Safari.',
  'Enter your email, then type the 8-digit code we send you into SANDY.',
  'Add your calendars and a few events, then swipe left and right to move through your days.',
  'Features',
  'Sandy Intelligence (SI): your built-in AI assistant. Tap AI to ask about your schedule, plan your day, or have it add things for you. It also keeps your past chats, and more AI features are coming soon.',
  'Leave-by alerts: add a location to an event, and SANDY tells you when to leave and sends you a heads-up.',
  "Today: see what's next, what's on today, anything overdue, and a preview of tomorrow. Tap any section to open or close it.",
  'Smart to-dos: tap the + button and type naturally, like "meeting next Friday at 3pm." SANDY fills in the date and time, and you can set a priority.',
  'Reminders: go to Profile and tap Enable notifications to get up to 6 reminders per event.',
  'If something feels off or you have an idea, tap Send feedback and tell me. I read every one.',
  '— Scott, Minds Above Matters',
];
async function context(b, { dark, id, email, video, reduced }) {
  const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, timezoneId: 'America/Chicago',
    colorScheme: dark ? 'dark' : 'light', reducedMotion: reduced ? 'reduce' : 'no-preference', ...(video ? { recordVideo: { dir: video, size: { width: 390, height: 844 } } } : {}) });
  await ctx.route('**/config.js', r => r.fulfill({ contentType: 'application/javascript', body: cfg }));
  if (dark) await ctx.addInitScript(() => { localStorage.setItem('sandy.theme', 'dark'); }); // read by the inline <head> theme script
  await ctx.addInitScript(() => { try { localStorage.setItem('sandy.tour.off', '1'); } catch (e) {} }); // guided tour: covered by tests/tour.test.js
  const calls = { otp: 0 };
  await ctx.route('**/auth/v1/**', r => {
    const u = r.request().url();
    if (/\/otp/.test(u)) { calls.otp++; return r.fulfill({ status: 200, contentType: 'application/json', body: '{}' }); }
    if (/\/verify/.test(u)) return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(mkSession(id, email)) });
    if (/\/user/.test(u)) return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(mkSession(id, email).user) });
    return r.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
  });
  await ctx.route('**/rest/v1/**', r => {
    const u = r.request().url();
    if (/\/calendars/.test(u) && r.request().method() === 'GET') return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([{ id: 'c1', slug: 'personal', name: 'Personal', short: 'Personal', color: '#2563eb', sort: 0 }]) });
    if (/\/rpc\//.test(u)) return r.fulfill({ status: 200, contentType: 'application/json', body: 'null' });
    return r.fulfill({ status: 200, contentType: 'application/json', body: '[]' });
  });
  await ctx.route('**/realtime/**', r => r.abort());
  return { ctx, calls };
}
async function signIn(p, email, shots, tag) {
  await p.goto(BASE); await p.waitForSelector('#authGate:not([hidden])');
  const msg = await p.textContent('#authMsg'); const btn = await p.textContent('#authForm button[type=submit]');
  const gateText = await p.textContent('#authGate');
  assert(/8-digit code/.test(msg) && /Type it here to sign in/.test(msg), `sign-in intro talks about an 8-digit code: "${msg}"`);
  assert(btn.trim() === 'Email me a code', 'send button reads "Email me a code"');
  assert(!/\blink\b/i.test(gateText.replace(/Terms|Privacy Policy/g, '')), 'no "link" wording anywhere on the sign-in screen');
  await p.fill('#authEmail', email);
  if (shots) { await p.waitForTimeout(300); await p.screenshot({ path: `${SHOTS}/signin_email_${tag}_390.png` }); }
  await p.click('#authForm button[type=submit]');
  await p.waitForSelector('#authCodeForm:not([hidden])');
  const msg2 = await p.textContent('#authMsg');
  assert(msg2 === `We emailed ${email} an 8-digit code. Type it here to sign in.`, 'after sending: code-only message');
  assert(/8-digit code/.test(await p.textContent('#authCodeForm label')), 'code label says 8-digit');
  assert((await p.textContent('#authResend')).trim() === 'Resend code', 'resend reads "Resend code"');
  assert(await p.$eval('#authCode', e => e.placeholder === '12345678' && e.maxLength === 8 && e.autocomplete === 'one-time-code'), '8-digit placeholder, one-time-code autofill');
  assert(!/\blink\b/i.test((await p.textContent('#authGate')).replace(/Terms|Privacy Policy/g, '')), 'code step: no "link" wording');
  await p.fill('#authCode', '1234'); await p.click('#authCodeBtn');
  assert(/full 8-digit code/.test(await p.textContent('#authCodeErr')), 'short code: "Enter the full 8-digit code" error');
  if (shots) { await p.fill('#authCode', '4821'); await p.focus('#authCode'); await p.waitForTimeout(300); await p.screenshot({ path: `${SHOTS}/signin_code_${tag}_390.png` }); }
  await p.fill('#authCode', '48213907'); await p.click('#authCodeBtn');
  await p.waitForSelector('#authGate', { state: 'hidden', timeout: 8000 });
}
(async () => {
  const b = await chromium.launch({ executablePath: '/usr/bin/google-chrome', headless: true, args: ['--no-sandbox'] });
  for (const dark of [false, true]) {
    const tag = dark ? 'dark' : 'light';
    // ---- new tester: sees the welcome once ----
    const { ctx } = await context(b, { dark, id: '44444444-4444-4444-4444-444444444444', email: 'tester@example.com' });
    const p = await ctx.newPage(); const errs = []; p.on('pageerror', e => errs.push(e.message));
    await signIn(p, 'tester@example.com', true, tag);
    await p.waitForSelector('#welcomeSheet.open', { timeout: 6000 });
    assert(true, `tester: welcome sheet opens after first sign-in [${tag}]`);
    assert(await p.evaluate(() => document.documentElement.classList.contains('dark')) === dark, `theme is ${tag}`);
    const txt = (await p.textContent('#welcomeSheet')).replace(/\s+/g, ' ');
    for (const line of VERBATIM) assert(txt.includes(line), 'verbatim: ' + line.slice(0, 50));
    assert(await p.$eval('#welcomeSheet', e => e.getAttribute('role') === 'dialog' && e.getAttribute('aria-modal') === 'true' && !!document.getElementById(e.getAttribute('aria-labelledby'))), 'dialog semantics');
    assert((await p.$$('#welcomeSheet .wl-h')).length === 2 && (await p.$$('#welcomeSheet .wl-feats li > b:first-child')).length === 5 && (await p.$$('#welcomeSheet .wl-steps li')).length === 4, 'two styled headings, 4 numbered steps, 5 bold feature labels');
    assert((await p.textContent('#welcomeSheet .wl-go')).trim() === "Let's go", 'button reads "Let\'s go"');
    await p.waitForTimeout(500); // let the slide-up finish
    const box = await p.$eval('#welcomeSheet', e => { const r = e.getBoundingClientRect(); return { top: r.top, bottom: r.bottom, h: r.height }; });
    assert(box.bottom <= 845 && box.top >= 844 * 0.1, `bottom sheet within viewport (top ${Math.round(box.top)}, bottom ${Math.round(box.bottom)})`);
    const go = await p.$eval('#welcomeSheet .wl-go', e => { const r = e.getBoundingClientRect(); return r.bottom <= innerHeight && r.height >= 44; });
    assert(go, '"Let\'s go" visible without scrolling, ≥44px tall');
    assert(await p.$eval('#welcomeSheet .wl-body', e => e.scrollHeight > e.clientHeight && getComputedStyle(e).overflowY === 'auto'), 'long note scrolls inside the sheet');
    assert(await p.evaluate(() => document.activeElement && document.activeElement.classList.contains('wl-go')), 'focus moves to "Let\'s go"');
    await p.waitForTimeout(1400);
    await p.screenshot({ path: `${SHOTS}/welcome_top_${tag}_390.png` });
    await p.$eval('#welcomeSheet .wl-body', e => { e.scrollTop = e.scrollHeight; }); await p.waitForTimeout(250);
    await p.screenshot({ path: `${SHOTS}/welcome_bottom_${tag}_390.png` });
    await p.click('#welcomeSheet .wl-go');
    await p.waitForSelector('#welcomeSheet', { state: 'detached', timeout: 3000 });
    assert(await p.$('.wl-backdrop') === null && !(await p.evaluate(() => document.body.classList.contains('wl-open'))), '"Let\'s go" closes it (sheet + backdrop removed, scroll unlocked)');
    assert(await p.evaluate(() => !!localStorage.getItem('sandy.welcome.v1:44444444-4444-4444-4444-444444444444')), 'dismissal saved per user id');
    await p.reload(); await p.waitForSelector('#welcomeBtn', { state: 'attached', timeout: 8000 }); await p.waitForTimeout(1200);
    assert(await p.$('#welcomeSheet') === null, 'after reload: not shown again');
    // Profile → Welcome guide row reopens it
    await p.evaluate(() => window.SandyNav && SandyNav.go ? SandyNav.go('profile') : null).catch(() => {});
    await p.click('.bottom-nav [data-tab=profile], .bottom-nav button:has-text("Profile")').catch(() => {});
    await p.waitForTimeout(500);
    await p.$eval('#welcomeBtn', e => e.scrollIntoView({ block: 'center' }));
    await p.waitForTimeout(300);
    assert(await p.isVisible('#welcomeBtn') && /Welcome guide/.test(await p.textContent('#welcomeBtn')), 'Profile has a "Welcome guide" row');
    await p.screenshot({ path: `${SHOTS}/profile_welcome_row_${tag}_390.png` });
    await p.click('#welcomeBtn'); await p.waitForSelector('#welcomeSheet.open');
    assert(true, 'Welcome guide reopens the sheet');
    await p.keyboard.press('Escape'); await p.waitForSelector('#welcomeSheet', { state: 'detached', timeout: 3000 });
    assert(true, 'Escape closes it');
    await p.click('#welcomeBtn'); await p.waitForSelector('#welcomeSheet.open'); await p.waitForTimeout(450);
    await p.mouse.click(195, 40); await p.waitForSelector('#welcomeSheet', { state: 'detached', timeout: 3000 });
    assert(true, 'tapping the backdrop closes it');
    await p.click('#welcomeBtn'); await p.waitForSelector('#welcomeSheet.open'); await p.waitForTimeout(450);
    await p.click('#welcomeSheet .wl-x'); await p.waitForSelector('#welcomeSheet', { state: 'detached', timeout: 3000 });
    assert(true, '✕ closes it');
    // real labels the note refers to
    const labels = await p.evaluate(() => ({ ai: (document.getElementById('aiBtn') || {}).textContent || '', push: !!document.getElementById('pushEnable') || /Enable notifications|How to enable on iPhone/.test(document.body.textContent), fb: (document.getElementById('feedbackBtn') || {}).textContent || '' }));
    console.log('  labels:', JSON.stringify(labels));
    assert(errs.length === 0, 'no page errors: ' + errs.join(' | '));
    await ctx.close();

    // ---- owner account: never forced ----
    const o = await context(b, { dark, id: '55555555-5555-5555-5555-555555555555', email: OWNER });
    const p2 = await o.ctx.newPage();
    await p2.goto(BASE); await p2.waitForSelector('#authGate:not([hidden])');
    await p2.fill('#authEmail', OWNER); await p2.click('#authForm button[type=submit]'); await p2.waitForSelector('#authCodeForm:not([hidden])');
    await p2.fill('#authCode', '48213907'); await p2.click('#authCodeBtn');
    await p2.waitForSelector('#authGate', { state: 'hidden', timeout: 8000 });
    await p2.waitForSelector('#welcomeBtn', { state: 'attached', timeout: 8000 }); await p2.waitForTimeout(1500);
    assert(await p2.$('#welcomeSheet') === null, `owner (${OWNER}) does not get the welcome automatically [${tag}]`);
    assert(await p2.evaluate(() => !SandyWelcome.shouldShow({ id: 'x', email: 'OWNER@example.com' }) && SandyWelcome.shouldShow({ id: 'y', email: 'a@b.c' }) && !SandyWelcome.shouldShow(null)), 'rule: owner (case-insensitive) excluded, others shown, signed-out never');
    await o.ctx.close();
  }
  // ---- reduced motion: opens/closes instantly ----
  {
    const { ctx } = await context(b, { dark: false, reduced: true, id: '66666666-6666-6666-6666-666666666666', email: 'rm@example.com' });
    const p = await ctx.newPage();
    await p.goto(BASE); await p.waitForSelector('#authGate:not([hidden])');
    await p.fill('#authEmail', 'rm@example.com'); await p.click('#authForm button[type=submit]'); await p.waitForSelector('#authCodeForm:not([hidden])');
    await p.fill('#authCode', '48213907'); await p.click('#authCodeBtn');
    await p.waitForSelector('#welcomeSheet.open.no-anim', { timeout: 6000 });
    await p.click('#welcomeSheet .wl-go');
    assert(await p.$('#welcomeSheet') === null, 'reduced motion: no slide, closes instantly');
    await ctx.close();
  }
  // ---- video: open + close ----
  if (process.env.WELCOME_VIDEO) {
    const vd = process.env.WELCOME_VIDEO; fs.mkdirSync(vd, { recursive: true });
    const { ctx } = await context(b, { dark: false, video: vd, id: '77777777-7777-7777-7777-777777777777', email: 'video@example.com' });
    const p = await ctx.newPage();
    await p.goto(BASE); await p.waitForSelector('#authGate:not([hidden])'); await p.waitForTimeout(500);
    await p.type('#authEmail', 'video@example.com', { delay: 40 }); await p.waitForTimeout(300);
    await p.click('#authForm button[type=submit]'); await p.waitForSelector('#authCodeForm:not([hidden])'); await p.waitForTimeout(500);
    await p.type('#authCode', '48213907', { delay: 90 }); await p.waitForTimeout(300); await p.click('#authCodeBtn');
    await p.waitForSelector('#welcomeSheet.open'); await p.waitForTimeout(1800);
    for (let i = 0; i < 6; i++) { await p.$eval('#welcomeSheet .wl-body', e => e.scrollBy({ top: 160, behavior: 'smooth' })); await p.waitForTimeout(450); }
    await p.waitForTimeout(600); await p.click('#welcomeSheet .wl-go'); await p.waitForTimeout(1200);
    await ctx.close(); console.log('video saved in', vd);
  }
  await b.close(); console.log(`ALL WELCOME TESTS PASSED (${n} checks)`);
})().catch(e => { console.error(e.message); process.exit(1); });
