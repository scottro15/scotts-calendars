// Tour tip/hole never cover bottom nav or the spotlighted target; dismiss clears leftovers.
// Run: node tests/tour_placement.test.js [baseUrl]
const { chromium } = require(process.env.PW || '/workspace/shot-tools/node_modules/playwright-core');
const fs = require('fs');
const BASE = process.argv[2] || 'http://127.0.0.1:8780/';
const SHOTS = process.env.TOUR_PLACE_SHOTS || '/workspace/shots-fix-tour';
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
async function context(b, { dark, id, email }) {
  const ctx = await b.newContext({
    viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true,
    timezoneId: 'America/Chicago', colorScheme: dark ? 'dark' : 'light', reducedMotion: 'reduce',
  });
  await ctx.route('**/config.js', r => r.fulfill({ contentType: 'application/javascript', body: cfg }));
  if (dark) await ctx.addInitScript(() => { localStorage.setItem('sandy.theme', 'dark'); });
  await ctx.addInitScript(() => {
    localStorage.setItem('sandy.welcome.off', '1');
    localStorage.setItem('sandy.tour.off', '1');
  });
  await ctx.route('**/auth/v1/**', r => {
    const u = r.request().url();
    if (/\/otp/.test(u)) return r.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
    if (/\/verify/.test(u)) return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(mkSession(id, email)) });
    if (/\/user/.test(u)) return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(mkSession(id, email).user) });
    return r.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
  });
  await ctx.route('**/rest/v1/**', r => {
    const u = r.request().url(); const m = r.request().method();
    if (/\/calendars/.test(u) && m === 'GET') return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([{ id: 'c1', slug: 'personal', name: 'Personal', short: 'Personal', color: '#2563eb', sort: 0 }]) });
    if (/\/rpc\//.test(u)) return r.fulfill({ status: 200, contentType: 'application/json', body: 'null' });
    return r.fulfill({ status: 200, contentType: 'application/json', body: '[]' });
  });
  await ctx.route('**/functions/v1/**', r => r.fulfill({ status: 200, contentType: 'application/json', body: '{}' }));
  await ctx.route('**/realtime/**', r => r.abort());
  return ctx;
}
async function signIn(p, email) {
  await p.goto(BASE);
  await p.waitForSelector('#authGate:not([hidden])');
  await p.fill('#authEmail', email);
  await p.click('#authForm button[type=submit]');
  await p.waitForSelector('#authCodeForm:not([hidden])');
  await p.fill('#authCode', '48213907'); await p.click('#authCodeBtn');
  await p.waitForSelector('#authGate', { state: 'hidden', timeout: 8000 });
  await p.waitForFunction(() => window.__app && window.__app.Store, { timeout: 8000 });
}
function overlaps(a, b, pad = 2) {
  return !(a.right <= b.left + pad || a.left >= b.right - pad || a.bottom <= b.top + pad || a.top >= b.bottom - pad);
}
(async () => {
  const b = await chromium.launch({ executablePath: '/usr/bin/google-chrome', headless: true, args: ['--no-sandbox'] });

  // CSS: root must be transparent so the hole spotlight reveals the target
  {
    const { ctx } = { ctx: await context(b, { dark: false, id: 'css-id', email: 'css@example.com' }) };
    const p = await ctx.newPage();
    await signIn(p, 'css@example.com');
    await p.evaluate(() => SandyNav.go('profile'));
    await p.waitForTimeout(300);
    await p.click('#tourBtn');
    await p.waitForSelector('#tourRoot');
    const bg = await p.$eval('#tourRoot', el => getComputedStyle(el).backgroundColor);
    assert(/rgba?\(0,\s*0,\s*0,\s*0\)|transparent/.test(bg), `tour-root background transparent (got ${bg})`);
    await ctx.close();
  }

  for (const dark of [false, true]) {
    const tag = dark ? 'dark' : 'light';
    const ctx = await context(b, { dark, id: 'place-' + tag, email: tag + '@example.com' });
    const p = await ctx.newPage();
    await signIn(p, tag + '@example.com');
    await p.evaluate(() => SandyNav.go('profile'));
    await p.waitForTimeout(400);
    await p.click('#tourBtn');
    await p.waitForSelector('.tour-tip.open, .tour-tip', { timeout: 5000 });
    await p.waitForTimeout(400);

    const total = await p.evaluate(() => SandyTour.STEPS.length);
    assert(total >= 8, `${tag}: ${total} steps`);

    for (let i = 0; i < total; i++) {
      if (i > 0) {
        await p.click('#tourNext');
        await p.waitForTimeout(450);
      }
      const title = await p.$eval('#tourTitle', e => e.textContent.trim());
      const geo = await p.evaluate(() => {
        const tip = document.querySelector('.tour-tip');
        const hole = document.querySelector('.tour-hole');
        const nav = document.getElementById('bottomNav');
        const tr = tip.getBoundingClientRect();
        const hr = hole && hole.style.display !== 'none' ? hole.getBoundingClientRect() : null;
        const nr = nav.getBoundingClientRect();
        return {
          tip: { top: tr.top, bottom: tr.bottom, left: tr.left, right: tr.right, height: tr.height },
          hole: hr ? { top: hr.top, bottom: hr.bottom, left: hr.left, right: hr.right, height: hr.height } : null,
          nav: { top: nr.top, bottom: nr.bottom, left: nr.left, right: nr.right },
          vh: window.innerHeight,
          place: tip.dataset.place || '',
          tipBottomCss: tip.style.bottom,
        };
      });
      // Tip must sit entirely above the bottom nav
      assert(geo.tip.bottom <= geo.nav.top + 1, `${tag} step ${i + 1} (${title}): tip.bottom ${geo.tip.bottom.toFixed(1)} <= nav.top ${geo.nav.top.toFixed(1)}`);
      // Tip must not overlap the hole/spotlight
      if (geo.hole && geo.hole.height > 0) {
        assert(!overlaps(geo.tip, geo.hole, 0), `${tag} step ${i + 1} (${title}): tip does not overlap hole`);
      }
      // Tip fully on screen
      assert(geo.tip.top >= -1 && geo.tip.bottom <= geo.vh + 1, `${tag} step ${i + 1}: tip on screen`);
      await p.screenshot({ path: `${SHOTS}/${tag}_step${String(i + 1).padStart(2, '0')}_${title.replace(/\s+/g, '_').toLowerCase()}.png` });
    }

    // Done clears everything
    await p.click('#tourNext'); // Done on last
    await p.waitForSelector('#tourRoot', { state: 'detached', timeout: 4000 });
    await p.waitForTimeout(350);
    const left = await p.evaluate(() => ({
      root: !!document.getElementById('tourRoot'),
      tip: !!document.querySelector('.tour-tip'),
      hole: !!document.querySelector('.tour-hole'),
      offer: !!document.querySelector('.tour-offer, .tour-offer-back'),
      open: document.body.classList.contains('tour-open'),
    }));
    assert(!left.root && !left.tip && !left.hole && !left.offer && !left.open, `${tag}: dismiss clears all tour DOM`);
    await p.screenshot({ path: `${SHOTS}/${tag}_after_done.png` });
    await ctx.close();
  }

  // Skip mid-tour also clears
  {
    const ctx = await context(b, { dark: false, id: 'skip-id', email: 'skip@example.com' });
    const p = await ctx.newPage();
    await signIn(p, 'skip@example.com');
    await p.evaluate(() => SandyNav.go('profile'));
    await p.waitForTimeout(300);
    await p.click('#tourBtn');
    await p.waitForSelector('.tour-tip');
    await p.click('#tourNext');
    await p.waitForTimeout(300);
    await p.click('#tourSkip');
    await p.waitForSelector('#tourRoot', { state: 'detached', timeout: 4000 });
    await p.waitForTimeout(350);
    const left = await p.evaluate(() => document.querySelectorAll('#tourRoot, .tour-tip, .tour-hole, .tour-offer, .tour-offer-back').length);
    assert(left === 0, 'skip clears leftover tour nodes');
    assert(!(await p.evaluate(() => document.body.classList.contains('tour-open'))), 'skip clears tour-open');
    await p.screenshot({ path: `${SHOTS}/light_after_skip.png` });
    await ctx.close();
  }

  await b.close();
  console.log(`TOUR PLACEMENT PASSED (${n} checks)`);
})().catch(e => { console.error(e); process.exit(1); });
