// Update-safe (Scott t156u): a new version ships while SANDY is open and the user hasn't refreshed.
// Events, day notes and To-Do jots must stay visible and editable through: the update check, tab switches,
// coming back from the background, the periodic refresh, a flaky network (Supabase errors) with a realtime
// "notes changed", the session going away under the page, and a cold open that can't reach Supabase.
// Also: the update pill says an update is ready and has its clockwise glow + pulse (static with reduced motion).
// Runs against the REAL config with a throwaway QA account (needs SUPABASE_SERVICE_KEY in the env; skips otherwise):
//   SUPABASE_SERVICE_KEY=… node tests/update_safe.test.js http://127.0.0.1:8780/ [shots dir]
const PW = require(process.env.PW || '/workspace/shot-tools/node_modules/playwright-core');
const fs = require('fs'); const path = require('path');
const BASE = process.argv[2] || 'http://127.0.0.1:8780/';
const SHOTS = process.argv[3] || '/workspace/shots-oct29/update-safe/test'; fs.mkdirSync(SHOTS, { recursive: true });
const assert = (c, m) => { if (!c) throw new Error('FAIL: ' + m); console.log('ok -', m); };
const SVC = process.env.SUPABASE_SERVICE_KEY;
const cfg = fs.readFileSync(path.join(__dirname, '..', 'config.js'), 'utf8');
const URL_ = (cfg.match(/SUPABASE_URL:\s*'([^']+)'/) || [])[1], ANON = (cfg.match(/SUPABASE_ANON_KEY:\s*'([^']+)'/) || [])[1];
const EMAIL = 'sandy-qa-android@example.com';
const H = k => ({ apikey: k, authorization: 'Bearer ' + k, 'content-type': 'application/json' });
const j = async r => { const t = await r.text(); if (!r.ok) throw new Error(r.status + ' ' + t.slice(0, 200)); return t ? JSON.parse(t) : null; };
const rest = (p, o = {}) => fetch(`${URL_}/rest/v1/${p}`, { ...o, headers: { ...H(SVC), prefer: 'return=representation' } }).then(j);
(async () => {
  if (!SVC || !URL_) { console.log('skip - needs SUPABASE_SERVICE_KEY and a Supabase config.js'); return; }
  const g = await j(await fetch(`${URL_}/auth/v1/admin/generate_link`, { method: 'POST', headers: H(SVC), body: JSON.stringify({ type: 'magiclink', email: EMAIL }) }));
  const s = await j(await fetch(`${URL_}/auth/v1/verify`, { method: 'POST', headers: H(ANON), body: JSON.stringify({ type: 'magiclink', token_hash: g.hashed_token || g.properties.hashed_token }) }));
  const KEY = 'sb-' + new URL(URL_).hostname.split('.')[0] + '-auth-token';
  const sess = { access_token: s.access_token, refresh_token: s.refresh_token, expires_in: s.expires_in, expires_at: Math.floor(Date.now() / 1000) + s.expires_in, token_type: 'bearer', user: s.user };
  const uid = s.user.id;
  const cleanup = async () => {
    await rest(`events?owner_id=eq.${uid}&title=like.QA%20update-safe*`, { method: 'DELETE' }).catch(() => {});
    await rest(`inbox_items?owner_id=eq.${uid}&body=like.QA%20update-safe*`, { method: 'DELETE' }).catch(() => {});
    await rest(`occurrence_notes?owner_id=eq.${uid}&body=like.QA%20update-safe*`, { method: 'DELETE' }).catch(() => {});
  };
  await cleanup();
  const b = await PW.chromium.launch({ executablePath: '/usr/bin/google-chrome', args: ['--no-sandbox'] });
  const errs = [];
  const open = async (ctx, url) => { const p = await ctx.newPage(); p.on('pageerror', e => errs.push(e.message)); await p.goto(url); return p; };
  try {
    const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, timezoneId: 'America/Chicago', isMobile: true, hasTouch: true });
    await ctx.addInitScript(({ k, sess }) => { if (!localStorage.getItem(k)) { localStorage.setItem(k, JSON.stringify(sess)); } localStorage.setItem('sandy.welcome.off', '1'); localStorage.setItem('sandy.tour.off', '1'); window.__SANDY_UPDATE_TEST = true; }, { k: KEY, sess });
    const p = await open(ctx, BASE + '?tab=today');
    await p.waitForFunction(() => window.__app && __app.Store && window.SandyNav && __app.calendars, null, { timeout: 60000 });
    if (await p.evaluate(() => __app.Store.mode === 'local')) { console.log('skip - page is in local mode'); return; }
    // seed: an event in 30 min, a day note on it, a To-Do jot
    await p.evaluate(async () => {
      const W = ms => new Date(__app.nowWall().getTime() + ms).toISOString().slice(0, 16);
      const ev = await __app.Store.save({ calendar: __app.calendars()[0].id, kind: 'event', category: 'Other', title: 'QA update-safe event', location: '', allDay: false, start: W(30 * 60e3), end: W(90 * 60e3), recurrence: { freq: 'none' } });
      await __app.Store.notes.set(ev.id, ev.start.slice(0, 10), 'QA update-safe note');
      await SandyNav.Inbox.save({ id: crypto.randomUUID(), body: 'QA update-safe jot', kind: 'todo', done: false });
    });
    const state = async () => {
      await p.evaluate(() => SandyNav.go('todo')); await p.waitForTimeout(900);
      const jot = await p.evaluate(() => /QA update-safe jot/.test(document.getElementById('page-todo').textContent));
      await p.evaluate(() => SandyNav.go('today')); await p.waitForTimeout(900);
      return p.evaluate(async ({ jot }) => ({
        jot, today: /QA update-safe event/.test(document.getElementById('todayBody').textContent),
        ev: (await __app.Store.list()).some(e => /^QA update-safe event/.test(e.title)),
        note: (await __app.Store.notes.all()).some(n => n.body === 'QA update-safe note'),
      }), { jot });
    };
    const all = (st, m) => assert(st.jot && st.today && st.ev && st.note, `${m}: event on Today, note and To-Do jot all still there ${JSON.stringify(st)}`);
    all(await state(), 'before the deploy');
    // A) a new version ships: version.json moves on, the update check runs, the user keeps working
    await p.route('**/version.json*', r => r.fulfill({ status: 200, contentType: 'application/json', body: '{"v":"20991231-update-safe"}' }));
    await p.evaluate(() => SandyUpdate.check()); await p.waitForTimeout(1200);
    await p.waitForFunction(() => !document.getElementById("updateBanner").hidden, null, { timeout: 8000 }).catch(() => {});
    const pill = await p.evaluate(() => ({ hidden: document.getElementById("updateBanner").hidden, txt: document.getElementById("updateBannerTap").textContent, pending: SandyUpdate.pending, dlg: !!document.querySelector("dialog[open]"), qs: document.body.classList.contains("qs-open") }));
    assert(!pill.hidden && /Update ready/.test(pill.txt), "update pill shows Update ready · Tap to refresh " + JSON.stringify(pill));
    for (const t of ['todo', 'home', 'search', 'profile', 'today']) { await p.evaluate(t => SandyNav.go(t), t); await p.waitForTimeout(400); }
    await p.evaluate(() => { Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'visible' }); document.dispatchEvent(new Event('visibilitychange')); window.dispatchEvent(new Event('focus')); window.dispatchEvent(new Event('online')); });
    await p.waitForTimeout(2500);
    all(await state(), 'A: after the deploy, tab switches, return from background and refresh');
    // edit while the update is pending
    await p.evaluate(async () => { const ev = (await __app.Store.list()).find(e => e.title === 'QA update-safe event'); await __app.Store.save({ ...ev, title: 'QA update-safe event (edited)' }); });
    await p.evaluate(() => SandyNav.go('home')); await p.evaluate(() => SandyNav.go('today')); await p.waitForTimeout(1200);
    assert(await p.evaluate(() => /QA update-safe event \(edited\)/.test(document.getElementById('todayBody').textContent)), 'A: editing still works with the update pending');
    // C) the network flakes (Supabase errors) while realtime says notes changed + the periodic refresh fires
    await p.route(/supabase\.co\/rest\//, r => r.abort('failed'));
    await p.evaluate(() => { __app.Store.applyRemoteChange('notes', {}); SandyNav.Inbox.forget && SandyNav.Inbox.forget(); window.dispatchEvent(new Event('online')); });
    await p.waitForTimeout(2500);
    all(await state(), 'C: Supabase unreachable');
    await p.screenshot({ path: `${SHOTS}/C-network-down.png` });
    await p.unroute(/supabase\.co\/rest\//);
    // B) the session disappears under the page (expired + refresh refused, or signed out elsewhere)
    await p.evaluate(async k => { localStorage.removeItem(k); try { await __app.Store.adapter.client.auth.signOut({ scope: 'local' }); } catch (_) {} __app.Store.applyRemoteChange('notes', {}); SandyNav.Inbox.forget && SandyNav.Inbox.forget(); window.dispatchEvent(new Event('online')); }, KEY);
    await p.waitForTimeout(2500);
    all(await state(), 'B: session gone');
    await p.close();
    // D) cold open on the old build while Supabase can't be reached: the saved copy from this device shows
    const ctx2 = await b.newContext({ viewport: { width: 390, height: 844 }, timezoneId: 'America/Chicago', isMobile: true, hasTouch: true });
    await ctx2.addInitScript(({ k, sess }) => { if (!localStorage.getItem(k)) localStorage.setItem(k, JSON.stringify(sess)); localStorage.setItem('sandy.welcome.off', '1'); localStorage.setItem('sandy.tour.off', '1'); }, { k: KEY, sess });
    const p2 = await open(ctx2, BASE + '?tab=today');
    await p2.waitForFunction(() => window.__app && __app.Store && window.SandyNav, null, { timeout: 60000 });
    await p2.evaluate(() => SandyNav.go('todo')); await p2.waitForTimeout(3000); await p2.evaluate(() => SandyNav.go('today')); // snapshots written after the first good load
    await p2.route(/supabase\.co\/rest\//, r => r.abort('failed'));
    p2.on('pageerror', e => console.log('PAGEERR', e.message));
    await p2.reload(); await p2.waitForFunction(() => window.__app && __app.Store && window.SandyNav, null, { timeout: 60000 });
    await p2.waitForTimeout(2000);
    const d = await p2.evaluate(async () => ({ ev: (await __app.Store.list()).some(e => /QA update-safe event/.test(e.title)), today: /QA update-safe event/.test(document.getElementById('todayBody').textContent), offline: __app.Store.offline }));
    assert(d.ev && d.today && d.offline, `D: cold open without Supabase shows the saved copy ${JSON.stringify(d)}`);
    await p2.evaluate(() => SandyNav.go('todo')); await p2.waitForTimeout(3000);
    const dj = await p2.evaluate(async () => { const t0 = Date.now(); await SandyNav.renderTodo(); return { ms: Date.now() - t0, jot: /QA update-safe jot/.test(document.getElementById('todoList').textContent) }; });
    assert(dj.jot && dj.ms < 6000, 'D: To-Do jots from the saved copy, in under 6 s (supabase-js would retry for ~7 s) ' + JSON.stringify(dj));
    await p2.unroute(/supabase\.co\/rest\//);
    // sign-out removes the saved copies
    await p2.evaluate(async () => { await __app.Store.auth.signOut(); });
    assert(await p2.evaluate(() => !Object.keys(localStorage).some(k => k.startsWith('sandy.snap.v1.'))), 'sign-out clears the saved copies');
    await ctx2.close(); await ctx.close();
    // E) the pill: light navy glow, dark white glow, moving + pulsing; reduced motion = static glow
    for (const dark of [false, true]) for (const rm of [false, true]) {
      const c3 = await b.newContext({ viewport: { width: 390, height: 844 }, reducedMotion: rm ? 'reduce' : 'no-preference', colorScheme: dark ? 'dark' : 'light' });
      await c3.addInitScript(({ dark }) => { localStorage.setItem('sandy.theme', dark ? 'dark' : 'light'); localStorage.setItem('sandy.welcome.off', '1'); localStorage.setItem('sandy.tour.off', '1'); }, { dark });
      const p3 = await c3.newPage(); await p3.goto(BASE + '?tab=today'); await p3.waitForFunction(() => window.SandyUpdate, null, { timeout: 60000 });
      await p3.evaluate(() => { SandyUpdate.show('20991231-update-safe'); }); await p3.waitForTimeout(800);
      const g = await p3.evaluate(() => { const b = document.getElementById('updateBanner'); const be = getComputedStyle(b, '::before'), af = getComputedStyle(b, '::after');
        return { glow: getComputedStyle(b).getPropertyValue('--update-glow').trim(), spin: be.animationName, pulse: af.animationName, shown: !b.hidden }; });
      const tag = `${dark ? 'dark' : 'light'}${rm ? '-reduced' : ''}`;
      assert(g.shown && g.glow.toLowerCase() === (dark ? '#ffffff' : '#1e2a4a'), `${tag}: glow color ${g.glow}`);
      assert(rm ? (g.spin === 'none' && g.pulse === 'none') : (g.spin === 'ubSpin' && g.pulse === 'ubPulse'), `${tag}: ${rm ? 'static glow' : 'clockwise glow + pulse'} (${g.spin}/${g.pulse})`);
      await p3.locator('#updateBanner').screenshot({ path: `${SHOTS}/pill-${tag}.png` }).catch(() => {});
      await c3.close();
    }
    assert(!errs.length, 'no page errors ' + JSON.stringify(errs.slice(0, 3)));
    console.log('\nALL UPDATE-SAFE CHECKS PASSED');
  } finally { await cleanup(); await b.close(); }
})().catch(e => { console.error(e); process.exit(1); });
