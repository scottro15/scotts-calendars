// Tour tab pulse: matching bottom-nav tab highlighted above backdrop; cleared on Skip/Done.
const { chromium } = require(process.env.PW || '/usr/local/lib/pnpm/5/.pnpm/playwright-core@1.59.1/node_modules/playwright-core');
const fs = require('fs');
const BASE = process.argv[2] || 'http://127.0.0.1:8780/';
const SHOTS = process.env.TOUR_TAB_SHOTS || '/workspace/shots-tour-tabpulse';
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
async function boot(b, { dark, w, id, email }) {
  const ctx = await b.newContext({
    viewport: { width: w, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true,
    timezoneId: 'America/Chicago', colorScheme: dark ? 'dark' : 'light', reducedMotion: 'reduce',
  });
  await ctx.route('**/config.js', r => r.fulfill({ contentType: 'application/javascript', body: cfg }));
  if (dark) await ctx.addInitScript(() => localStorage.setItem('sandy.theme', 'dark'));
  await ctx.addInitScript(() => { localStorage.setItem('sandy.welcome.off', '1'); localStorage.setItem('sandy.tour.off', '1'); });
  await ctx.route('**/auth/v1/**', r => {
    const u = r.request().url();
    if (/\/otp/.test(u)) return r.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
    if (/\/verify/.test(u)) return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(mkSession(id, email)) });
    if (/\/user/.test(u)) return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(mkSession(id, email).user) });
    return r.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
  });
  await ctx.route('**/rest/v1/**', r => {
    if (/\/calendars/.test(r.request().url()) && r.request().method() === 'GET')
      return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([{ id: 'c1', slug: 'personal', name: 'Personal', short: 'Personal', color: '#2563eb', sort: 0 }]) });
    if (/\/rpc\//.test(r.request().url())) return r.fulfill({ status: 200, contentType: 'application/json', body: 'null' });
    return r.fulfill({ status: 200, contentType: 'application/json', body: '[]' });
  });
  await ctx.route('**/functions/v1/**', r => r.fulfill({ status: 200, contentType: 'application/json', body: '{}' }));
  await ctx.route('**/realtime/**', r => r.abort());
  const p = await ctx.newPage();
  await p.goto(BASE);
  await p.fill('#authEmail', email);
  await p.click('#authForm button[type=submit]');
  await p.waitForSelector('#authCodeForm:not([hidden])');
  await p.fill('#authCode', '48213907'); await p.click('#authCodeBtn');
  await p.waitForSelector('#authGate', { state: 'hidden', timeout: 8000 });
  await p.waitForFunction(() => window.__app && window.__app.Store, { timeout: 8000 });
  return { ctx, p };
}
(async () => {
  const b = await chromium.launch({ executablePath: '/usr/bin/google-chrome', headless: true, args: ['--no-sandbox'] });

  // Every STEP declares a tab
  {
    const { ctx, p } = await boot(b, { dark: false, w: 390, id: 'tabs', email: 'tabs@ex.com' });
    const tabs = await p.evaluate(() => SandyTour.STEPS.map(s => ({ id: s.id, tab: s.tab, title: s.title })));
    assert(tabs.every(t => t.tab), 'every step has tab');
    const expect = { views: 'home', briefing: 'home', today: 'today', 'today-collapse': 'today', ai: 'home', todo: 'todo', search: 'search', profile: 'profile' };
    for (const t of tabs) assert(t.tab === expect[t.id], `${t.id} → ${t.tab}`);
    await ctx.close();
  }

  for (const dark of [false, true]) {
    for (const w of [320, 390, 430]) {
      const tag = `${dark ? 'dark' : 'light'}_${w}`;
      const { ctx, p } = await boot(b, { dark, w, id: 'p' + tag, email: tag + '@ex.com' });
      await p.evaluate(() => SandyNav.go('profile'));
      await p.waitForTimeout(300);
      await p.click('#tourBtn');
      await p.waitForSelector('.tour-tip');
      await p.waitForTimeout(400);

      const total = await p.evaluate(() => SandyTour.STEPS.length);
      const wanted = new Set(['home', 'today', 'todo', 'search', 'profile']);
      const seen = new Set();

      for (let i = 0; i < total; i++) {
        if (i > 0) { await p.click('#tourNext'); await p.waitForTimeout(450); }
        const info = await p.evaluate(() => {
          const step = SandyTour.STEPS[window.__tourStepIdx ?? 0];
          // read from DOM
          const title = document.querySelector('#tourTitle')?.textContent?.trim() || '';
          const on = [...document.querySelectorAll('#bottomNav button.tour-tab-on')].map(b => b.dataset.tab);
          const navZ = parseInt(getComputedStyle(document.getElementById('bottomNav')).zIndex, 10);
          const tipZ = parseInt(getComputedStyle(document.querySelector('.tour-tip')).zIndex, 10);
          const tip = document.querySelector('.tour-tip').getBoundingClientRect();
          const nav = document.getElementById('bottomNav').getBoundingClientRect();
          const pulseBtn = document.querySelector('#bottomNav button.tour-tab-on');
          const pulse = pulseBtn ? pulseBtn.getBoundingClientRect() : null;
          const afterAnim = pulseBtn ? getComputedStyle(pulseBtn, '::after').animationName : '';
          return {
            title, on, navZ, tipZ,
            tipBottom: tip.bottom, navTop: nav.top,
            pulse, afterAnim,
            tourNavUp: document.body.classList.contains('tour-nav-up'),
            stepTab: SandyTour.STEPS.find(s => s.title === title)?.tab,
          };
        });
        assert(info.on.length === 1, `${tag} step ${i + 1}: exactly one pulsed tab (got ${info.on})`);
        assert(info.on[0] === info.stepTab, `${tag} step ${i + 1}: pulse ${info.on[0]} matches step.tab ${info.stepTab}`);
        assert(info.tourNavUp, `${tag}: body.tour-nav-up`);
        assert(info.navZ >= 163, `${tag}: nav z-index above backdrop (${info.navZ})`);
        assert(info.tipZ > info.navZ, `${tag}: tip above nav for clicks`);
        assert(info.tipBottom <= info.navTop + 1, `${tag} step ${i + 1}: tip clears nav`);
        // reducedMotion → steady glow (animation none or empty for ::after under reduce)
        assert(!info.afterAnim || info.afterAnim === 'none', `${tag}: reduced-motion → no pulse anim (got ${info.afterAnim})`);
        seen.add(info.on[0]);
        const slug = info.title.replace(/\s+/g, '_').toLowerCase();
        if (wanted.has(info.on[0]) || i === 0) {
          await p.screenshot({ path: `${SHOTS}/${tag}_step${String(i + 1).padStart(2, '0')}_${slug}.png` });
        }
      }
      for (const t of wanted) assert(seen.has(t), `${tag}: saw pulse on ${t}`);

      await p.click('#tourNext'); // Done
      await p.waitForSelector('#tourRoot', { state: 'detached', timeout: 4000 });
      await p.waitForTimeout(300);
      const left = await p.evaluate(() => ({
        on: document.querySelectorAll('#bottomNav button.tour-tab-on').length,
        up: document.body.classList.contains('tour-nav-up'),
      }));
      assert(left.on === 0 && !left.up, `${tag}: Done clears pulse`);
      await p.screenshot({ path: `${SHOTS}/${tag}_after_done.png` });
      await ctx.close();
    }
  }

  // Skip clears mid-tour
  {
    const { ctx, p } = await boot(b, { dark: false, w: 390, id: 'skip', email: 'skip2@ex.com' });
    await p.evaluate(() => SandyNav.go('profile'));
    await p.waitForTimeout(250);
    await p.click('#tourBtn');
    await p.waitForSelector('.tour-tip');
    await p.click('#tourNext');
    await p.waitForTimeout(300);
    assert(await p.evaluate(() => document.querySelectorAll('#bottomNav button.tour-tab-on').length === 1), 'pulse on before skip');
    await p.click('#tourSkip');
    await p.waitForSelector('#tourRoot', { state: 'detached', timeout: 4000 });
    await p.waitForTimeout(300);
    assert(await p.evaluate(() => document.querySelectorAll('#bottomNav button.tour-tab-on').length === 0), 'Skip clears pulse');
    assert(!(await p.evaluate(() => document.body.classList.contains('tour-nav-up'))), 'Skip clears tour-nav-up');
    await p.screenshot({ path: `${SHOTS}/light_390_after_skip.png` });
    await ctx.close();
  }

  await b.close();
  console.log(`TOUR TABPULSE PASSED (${n} checks)`);
})().catch(e => { console.error(e); process.exit(1); });
