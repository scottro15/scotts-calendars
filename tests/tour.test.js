// Guided tour: sample data never hits network/DB; skip/finish/reload cleanup; Profile replay.
// Run: node tests/tour.test.js [baseUrl]   (env TOUR_SHOTS=dir for screenshots + video)
const { chromium } = require(process.env.PW || '/workspace/shot-tools/node_modules/playwright-core');
const fs = require('fs');
const BASE = process.argv[2] || 'http://127.0.0.1:8765/';
const SHOTS = process.env.TOUR_SHOTS || '/tmp/shots-tour';
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
async function context(b, { dark, id, email, video, welcomeOff, tourOff, preDismissWelcome }) {
  const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, timezoneId: 'America/Chicago',
    colorScheme: dark ? 'dark' : 'light', reducedMotion: 'reduce', ...(video ? { recordVideo: { dir: video, size: { width: 390, height: 844 } } } : {}) });
  await ctx.route('**/config.js', r => r.fulfill({ contentType: 'application/javascript', body: cfg }));
  if (dark) await ctx.addInitScript(() => { localStorage.setItem('sandy.theme', 'dark'); });
  if (welcomeOff) await ctx.addInitScript(() => { localStorage.setItem('sandy.welcome.off', '1'); });
  if (tourOff) await ctx.addInitScript(() => { localStorage.setItem('sandy.tour.off', '1'); });
  if (preDismissWelcome) await ctx.addInitScript((uid) => { localStorage.setItem('sandy.welcome.v1:' + uid, new Date().toISOString()); }, id);
  const writes = [];
  await ctx.route('**/auth/v1/**', r => {
    const u = r.request().url();
    if (/\/otp/.test(u)) return r.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
    if (/\/verify/.test(u)) return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(mkSession(id, email)) });
    if (/\/user/.test(u)) return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(mkSession(id, email).user) });
    return r.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
  });
  await ctx.route('**/rest/v1/**', r => {
    const u = r.request().url(); const m = r.request().method();
    if (['POST', 'PATCH', 'PUT', 'DELETE'].includes(m)) {
      writes.push({ m, u, body: r.request().postData() || '' });
    }
    if (/\/calendars/.test(u) && m === 'GET') return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([{ id: 'c1', slug: 'personal', name: 'Personal', short: 'Personal', color: '#2563eb', sort: 0 }]) });
    if (/\/rpc\//.test(u)) return r.fulfill({ status: 200, contentType: 'application/json', body: 'null' });
    return r.fulfill({ status: 200, contentType: 'application/json', body: '[]' });
  });
  await ctx.route('**/functions/v1/**', r => {
    if (['POST', 'PATCH', 'PUT', 'DELETE'].includes(r.request().method())) writes.push({ m: r.request().method(), u: r.request().url(), body: r.request().postData() || '' });
    return r.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
  });
  await ctx.route('**/realtime/**', r => r.abort());
  return { ctx, writes };
}
async function signIn(p, email) {
  await p.goto(BASE); await p.waitForSelector('#authGate:not([hidden])');
  await p.fill('#authEmail', email);
  await p.click('#authForm button[type=submit]');
  await p.waitForSelector('#authCodeForm:not([hidden])');
  await p.fill('#authCode', '48213907'); await p.click('#authCodeBtn');
  await p.waitForSelector('#authGate', { state: 'hidden', timeout: 8000 });
  await p.waitForFunction(() => window.__app && window.__app.Store, { timeout: 8000 });
}
(async () => {
  const b = await chromium.launch({ executablePath: '/usr/bin/google-chrome', headless: true, args: ['--no-sandbox'] });

  // ---- Exact step copy present in module ----
  {
    const { ctx } = await context(b, { dark: false, id: 't1', email: 't1@example.com', welcomeOff: true, tourOff: true });
    const p = await ctx.newPage();
    await signIn(p, 't1@example.com');
    const steps = await p.evaluate(() => SandyTour.STEPS.map(s => ({ title: s.title, body: s.body })));
    assert(steps.length >= 8 && steps.length <= 10, `8–10 steps (got ${steps.length})`);
    const expect = [
      ['Home views', 'Month, Week, Day, or List'],
      ['Briefing', 'day, week, month, or season'],
      ['Today', 'Heads Up'],
      ['Collapse sections', 'collapse or expand'],
      ['Sandy Intelligence', 'Move my 3pm meeting to Friday'],
      ['To-Do', 'quick-add'],
      ['Search', 'Search finds'],
      ['Profile', 'replay this tour'],
    ];
    for (let i = 0; i < expect.length; i++) {
      assert(steps[i].title === expect[i][0], `step ${i + 1} title: ${steps[i].title}`);
      assert(steps[i].body.includes(expect[i][1]), `step ${i + 1} body mentions "${expect[i][1]}"`);
    }
    assert(await p.$('#tourBtn') !== null, 'Profile has Take the tour row (after mount)');
    await p.evaluate(() => SandyNav.go('profile'));
    await p.waitForTimeout(300);
    assert(await p.isVisible('#tourBtn'), 'tour button visible on Profile');
    await ctx.close();
  }

  // ---- Owner never auto-offered; Profile can start; sample never written ----
  for (const dark of [false, true]) {
    const tag = dark ? 'dark' : 'light';
    const vid = `${SHOTS}/_vid_${tag}`;
    fs.mkdirSync(vid, { recursive: true });
    const { ctx, writes } = await context(b, { dark, id: 'owner-id', email: OWNER, welcomeOff: true, video: vid });
    const p = await ctx.newPage();
    await signIn(p, OWNER);
    await p.waitForTimeout(800);
    assert(await p.$('#tourOffer') === null && await p.$('#tourRoot') === null, `owner: no auto tour [${tag}]`);
    await p.evaluate(() => SandyNav.go('profile'));
    await p.waitForTimeout(400);
    await p.$eval('#tourBtn', e => e.scrollIntoView({ block: 'center' }));
    await p.screenshot({ path: `${SHOTS}/${tag}_0_profile_row.png` });
    await p.click('#tourBtn');
    await p.waitForSelector('#tourRoot.open, #tourRoot', { timeout: 5000 });
    await p.waitForSelector('.tour-tip.open, .tour-tip', { timeout: 3000 });
    assert((await p.$eval('.tour-count', e => e.textContent.trim())).startsWith('1 /'), 'step counter 1 / N');
    // sample calendars visible in memory
    const cals = await p.evaluate(() => __app.calendars().map(c => c.id));
    assert(cals.includes('tour-work') && cals.includes('tour-side') && cals.includes('tour-kids'), 'sample calendars overlaid');
    const listed = await p.evaluate(async () => (await __app.Store.list()).filter(e => e._tourSample || String(e.id).startsWith('tour-')));
    assert(listed.length >= 5, `sample events in list (${listed.length})`);
    await p.screenshot({ path: `${SHOTS}/${tag}_1_views.png` });
    // walk a few steps
    for (const shot of [2, 3, 4, 5]) {
      await p.click('#tourNext');
      await p.waitForTimeout(350);
      await p.screenshot({ path: `${SHOTS}/${tag}_${shot}.png` });
    }
    // try to force a save of a sample event — must not hit network
    const before = writes.length;
    await p.evaluate(async () => {
      const samples = (await __app.Store.list()).filter(e => e._tourSample);
      if (samples[0]) await __app.Store.save({ ...samples[0], title: 'HACKED' });
      await __app.Store.saveMany(samples);
    });
    const tourWrites = writes.slice(before).filter(w => /tour-/.test(w.body || '') || /tour-/.test(w.u));
    assert(tourWrites.length === 0, 'saving sample events does not hit REST/functions with tour payloads');
    // skip cleans up
    await p.click('#tourSkip');
    await p.waitForSelector('#tourRoot', { state: 'detached', timeout: 3000 });
    const after = await p.evaluate(async () => ({
      cals: __app.calendars().map(c => c.id),
      samples: (await __app.Store.list()).filter(e => e._tourSample || String(e.id).startsWith('tour-')).length,
      active: sessionStorage.getItem('sandy.tour.active'),
      done: !!localStorage.getItem('sandy.tour.v1:owner-id'),
    }));
    assert(!after.cals.includes('tour-work') && after.samples === 0 && !after.active, `skip removes samples [${tag}]`);
    assert(after.done, 'skip marks tour done for user');
    // no tour ids in any write bodies
    assert(!writes.some(w => /"id"\s*:\s*"tour-/.test(w.body || '')), 'no tour- id ever posted to network');
    await ctx.close();
    // save video
    const vids = fs.readdirSync(vid).filter(f => f.endsWith('.webm'));
    if (vids.length) {
      // keep first as demo source; convert later if ffmpeg exists
      fs.copyFileSync(`${vid}/${vids[0]}`, `${SHOTS}/tour_demo_${tag}.webm`);
    }
  }

  // ---- Offer after welcome dismiss; finish cleans; reload mid-tour cleans ----
  {
    const { ctx, writes } = await context(b, {
      dark: false, id: '44444444-4444-4444-4444-444444444444', email: 'tester@example.com',
    });
    const p = await ctx.newPage();
    await signIn(p, 'tester@example.com');
    await p.waitForSelector('#welcomeSheet.open', { timeout: 6000 });
    await p.click('#welcomeSheet .wl-go');
    await p.waitForSelector('#welcomeSheet', { state: 'detached', timeout: 3000 });
    await p.waitForSelector('#tourOffer', { timeout: 5000 });
    assert(true, 'after welcome: tour offer appears');
    await p.screenshot({ path: `${SHOTS}/light_offer.png` });
    await p.click('#tourTake');
    await p.waitForSelector('#tourRoot', { timeout: 4000 });
    assert(await p.evaluate(() => sessionStorage.getItem('sandy.tour.active') === '1'), 'active flag set mid-tour');
    // reload mid-tour → cleanup
    await p.reload();
    await p.waitForFunction(() => window.__app && window.__app.Store, { timeout: 8000 });
    await p.waitForTimeout(600);
    const mid = await p.evaluate(async () => ({
      active: sessionStorage.getItem('sandy.tour.active'),
      samples: (await __app.Store.list()).filter(e => e._tourSample || String(e.id).startsWith('tour-')).length,
      cals: __app.calendars().map(c => c.id),
      root: !!document.getElementById('tourRoot'),
    }));
    assert(!mid.active && mid.samples === 0 && !mid.cals.includes('tour-work') && !mid.root, 'reload mid-tour cleans samples');
    // abandoned mid-tour may re-offer (tour not marked done) — dismiss so Profile replay can run
    const offer = await p.$('#tourOffer');
    if (offer) { await p.click('#tourLater'); await p.waitForSelector('#tourOffer', { state: 'detached', timeout: 3000 }); }
    // Profile finish path (replay still works after Maybe later… wait, Later marks done — start() from Profile still OK)
    await p.evaluate(() => SandyNav.go('profile'));
    await p.waitForTimeout(300);
    await p.click('#tourBtn');
    await p.waitForSelector('#tourRoot');
    // jump to last via Next spam then Done
    const total = await p.evaluate(() => SandyTour.STEPS.length);
    for (let i = 0; i < total - 1; i++) { await p.click('#tourNext'); await p.waitForTimeout(120); }
    assert(/Done/.test(await p.textContent('#tourNext')), 'last step Next reads Done');
    await p.click('#tourNext');
    await p.waitForSelector('#tourRoot', { state: 'detached', timeout: 3000 });
    assert(await p.evaluate(() => !!localStorage.getItem('sandy.tour.v1:44444444-4444-4444-4444-444444444444')), 'finish marks done');
    assert(!(await p.evaluate(async () => (await __app.Store.list()).some(e => e._tourSample))), 'finish removes samples');
    assert(!writes.some(w => /tour-/.test(w.body || '')), 'finish path: no tour payloads on network');
    await ctx.close();
  }

  // ---- Maybe later marks done without starting ----
  {
    const { ctx } = await context(b, { dark: false, id: 'later-id', email: 'later@example.com', preDismissWelcome: true });
    const p = await ctx.newPage();
    await signIn(p, 'later@example.com');
    await p.waitForSelector('#tourOffer', { timeout: 5000 });
    await p.click('#tourLater');
    await p.waitForSelector('#tourOffer', { state: 'detached', timeout: 3000 });
    assert(await p.evaluate(() => !!localStorage.getItem('sandy.tour.v1:later-id')), 'Maybe later marks done');
    assert(await p.$('#tourRoot') === null, 'Maybe later does not start tour');
    await p.reload(); await p.waitForTimeout(1000);
    assert(await p.$('#tourOffer') === null, 'offer not shown again after Maybe later');
    await ctx.close();
  }

  await b.close();
  console.log(`TOUR TESTS PASSED (${n} checks)`);
})().catch(e => { console.error(e); process.exit(1); });
