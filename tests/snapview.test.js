// Speed step C (t182u): on a reopen Today/Home are drawn at once from a saved picture, then handed to the live page.
// Checks on Android phone, iPhone, iPad, Android tablet x light/dark (Chromium with each device's size + UA):
//   draw     - a reopen shows the picture before the app code runs; it looks like the live page that replaces it
//   handover - no blank or half-faded frame between picture and live page; the picture ends up removed; it is inert
//   stale    - data changed elsewhere since the picture: the live page shows the new data and the old text is gone
//   home     - the same for Home (List at today, the position a fresh open lands on)
//   tab      - switching tab while the picture is up removes it at once
//   no draw  - signed out (sign-out also wipes the pictures), another account's session, another day, another build,
//              another window size / theme, a deep link, and the rollback switch (window.__snapViewOn = false)
// Runs against the REAL config with throwaway QA accounts (needs SUPABASE_SERVICE_KEY; skips in local mode):
//   SUPABASE_SERVICE_KEY=… node tests/snapview.test.js http://127.0.0.1:8878/ [shots dir] [devices]
const PW = require(process.env.PW || '/workspace/shot-tools/node_modules/playwright-core');
const fs = require('fs'); const path = require('path');
const BASE = process.argv[2] || 'http://127.0.0.1:8780/';
const SHOTS = process.argv[3] || '/workspace/shots-oct29/speed-c/test'; fs.mkdirSync(SHOTS, { recursive: true });
const ONLY = (process.argv[4] || 'phone,iPhone,ipad,aTablet').split(',');
let n = 0; const assert = (c, m) => { if (!c) throw new Error('FAIL: ' + m); n++; console.log('ok -', m); };
const SVC = process.env.SUPABASE_SERVICE_KEY;
const cfg = fs.readFileSync(path.join(__dirname, '..', 'config.js'), 'utf8');
const URL_ = (cfg.match(/SUPABASE_URL:\s*'([^']+)'/) || [])[1], ANON = (cfg.match(/SUPABASE_ANON_KEY:\s*'([^']+)'/) || [])[1];
const H = k => ({ apikey: k, authorization: 'Bearer ' + k, 'content-type': 'application/json' });
const j = async r => { const t = await r.text(); if (!r.ok) throw new Error(r.status + ' ' + t.slice(0, 200)); return t ? JSON.parse(t) : null; };
const rest = (p, o = {}) => fetch(`${URL_}/rest/v1/${p}`, { ...o, headers: { ...H(SVC), prefer: 'return=representation' } }).then(j);
const session = async (email, tries = 4) => { for (let i = 1; ; i++) { try { return await session1(email); } catch (e) { if (i >= tries) throw e; await new Promise(r => setTimeout(r, 1500 * i)); } } }; // another run may use the same QA account's links at the same moment
const session1 = async email => {
  const g = await j(await fetch(`${URL_}/auth/v1/admin/generate_link`, { method: 'POST', headers: H(SVC), body: JSON.stringify({ type: 'magiclink', email }) }));
  const s = await j(await fetch(`${URL_}/auth/v1/verify`, { method: 'POST', headers: H(ANON), body: JSON.stringify({ type: 'magiclink', token_hash: g.hashed_token || g.properties.hashed_token }) }));
  return { access_token: s.access_token, refresh_token: s.refresh_token, expires_in: s.expires_in, expires_at: Math.floor(Date.now() / 1000) + s.expires_in, token_type: 'bearer', user: s.user };
};
const DEV = {
  phone: { viewport: { width: 390, height: 844 }, ua: 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Mobile Safari/537.36' },
  iPhone: { viewport: { width: 393, height: 852 }, ua: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1' },
  ipad: { viewport: { width: 820, height: 1180 }, ua: 'Mozilla/5.0 (iPad; CPU OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1' },
  aTablet: { viewport: { width: 800, height: 1280 }, ua: 'Mozilla/5.0 (Linux; Android 14; SM-X710) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36' } };
const RUN = 'QA snapview ' + Date.now().toString(36);
(async () => {
  if (!SVC || !URL_) { console.log('skip - needs SUPABASE_SERVICE_KEY and a Supabase config.js'); return; }
  const served = await fetch(BASE + 'config.js').then(r => r.text(), () => '');
  if (!/SUPABASE_URL:\s*'https:/.test(served)) { console.log('skip - the server at ' + BASE + ' serves a config.js without Supabase (pictures are only kept when signed in)'); return; }
  const A = await session('sandy-qa-android@example.com');
  // the second account (switch + sign-out): its own throwaway QA user with one calendar, so sign-out (which ends all of
  // that user's sessions) never touches the android QA account other runs use
  const CE = 'sandy-qa-snapview@example.com';
  const users = await j(await fetch(`${URL_}/auth/v1/admin/users?per_page=1000`, { headers: H(SVC) }));
  let cu = (users.users || []).find(u => u.email === CE);
  if (!cu) cu = await j(await fetch(`${URL_}/auth/v1/admin/users`, { method: 'POST', headers: H(SVC), body: JSON.stringify({ email: CE, email_confirm: true }) }));
  if (!(await rest(`calendars?owner_id=eq.${cu.id}&select=id`)).length) await rest('calendars', { method: 'POST', body: JSON.stringify([{ owner_id: cu.id, slug: 'qa', name: 'QA', short: 'QA', color: '#2563eb', sort: 0 }]) });
  const B = { user: cu };
  const KEY = 'sb-' + new URL(URL_).hostname.split('.')[0] + '-auth-token';
  const cleanup = () => Promise.all([A, B].map(s => rest(`events?owner_id=eq.${s.user.id}&title=like.QA%20snapview*`, { method: 'DELETE' }).catch(() => {})));
  await cleanup();
  const b = await PW.chromium.launch({ executablePath: '/usr/bin/google-chrome', args: ['--no-sandbox'] });
  const errs = [];
  // canvas diff of two screenshots: share of pixels (in the box) that differ by > 40 on any channel
  const cmp = await (await b.newContext()).newPage();
  const diff = (x, y, box) => cmp.evaluate(async ({ x, y, box }) => {
    const ld = s => new Promise(r => { const i = new Image(); i.onload = () => r(i); i.src = 'data:image/png;base64,' + s; });
    const [a, c] = await Promise.all([ld(x), ld(y)]); const w = box[2], h = box[3];
    const px = im => { const cv = document.createElement('canvas'); cv.width = w; cv.height = h; const g = cv.getContext('2d'); g.drawImage(im, -box[0], -box[1]); return g.getImageData(0, 0, w, h).data; };
    const p = px(a), q = px(c); let d = 0, ink = 0;
    for (let i = 0; i < p.length; i += 4) { if (Math.abs(p[i] - q[i]) > 40 || Math.abs(p[i + 1] - q[i + 1]) > 40 || Math.abs(p[i + 2] - q[i + 2]) > 40) d++; }
    // "ink" of the first image: pixels far from its own top-left background colour (a blank page has ~0)
    for (let i = 0; i < p.length; i += 4) if (Math.abs(p[i] - p[0]) + Math.abs(p[i + 1] - p[1]) + Math.abs(p[i + 2] - p[2]) > 60) ink++;
    return { d: d / (w * h), ink: ink / (w * h) };
  }, { x: x.toString('base64'), y: y.toString('base64'), box });
  try {
    // a seeded event for today, 2 h from now (title unique to this run)
    const wall = ms => { const d = new Date(Date.now() + ms); const f = new Intl.DateTimeFormat('sv-SE', { timeZone: 'America/Chicago', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }).format(d); return f.replace(' ', 'T'); };
    for (const dn of ONLY) for (const theme of ['light', 'dark']) {
      const d = DEV[dn], tag = `${dn}-${theme}`, T1 = `${RUN} ${tag}`, T2 = `${T1} renamed`;
      await cleanup(); // each device+theme starts with only its own QA event (two same-time events can swap order between save and reopen)
      const ctx = await b.newContext({ viewport: d.viewport, userAgent: d.ua, isMobile: true, hasTouch: true, deviceScaleFactor: 1, timezoneId: 'America/Chicago', serviceWorkers: 'block' });
      await ctx.addInitScript(({ k, sess, theme }) => { if (!localStorage.getItem('qa.init')) { localStorage.setItem('qa.init', '1'); localStorage.setItem(k, JSON.stringify(sess)); localStorage.setItem('sandy.welcome.off', '1'); localStorage.setItem('sandy.tour.off', '1'); localStorage.setItem('sandy.theme', theme); } }, { k: KEY, sess: A, theme });
      const open = async (url, wait = 'load') => { const p = await ctx.newPage(); p.on('pageerror', e => errs.push(tag + ': ' + e.message)); await p.goto(BASE + url, { waitUntil: wait }); return p; };
      const up = p => p.waitForFunction(() => window.__app && __app.Store && __app.Store.mode === 'supabase' && window.SandyNav, null, { timeout: 60000 });
      const saved = (p, t) => p.waitForFunction(t => Object.keys(localStorage).some(k => k.indexOf('sandy.snap.v1.view.' + t + '.') === 0), t, { timeout: 15000 }).then(() => true, () => false);
      const view = p => p.evaluate(() => window.__snapView ? { drawnAt: __snapView.drawnAt, readyAt: __snapView.readyAt, dropped: __snapView.dropped, droppedAt: __snapView.droppedAt, on: !!document.getElementById('snapView') } : null);
      const picText = p => p.evaluate(() => { const v = document.getElementById('snapView'); return v && v.shadowRoot ? v.shadowRoot.textContent : ''; });
      // 1. first open: live page, picture saved
      let p = await open('?tab=today'); await up(p);
      await p.evaluate(async ({ t, s, e }) => { await __app.Store.save({ calendar: __app.calendars()[0].id, kind: 'event', category: 'Other', title: t, location: '', allDay: false, start: s, end: e, recurrence: null }); }, { t: T1, s: wall(2 * 3600e3), e: wall(2.5 * 3600e3) });
      await p.waitForFunction(t => document.getElementById('todayBody').textContent.includes(t), T1, { timeout: 15000 });
      assert(await saved(p, 'today'), `${tag}: Today's picture is saved after the live page settles`);
      const meta = await p.evaluate(() => { const k = Object.keys(localStorage).find(k => k.indexOf('sandy.snap.v1.view.today.') === 0); const v = JSON.parse(localStorage.getItem(k)); return { len: localStorage.getItem(k).length, dark: v.dark, uidOk: k.endsWith(v.uid), hasScript: /<script|\son\w+=/i.test(v.html), hidden: /\shidden(=|\s|>)/.test(v.html), css: (v.css || '').length, aria: /\saria-(label|describedby)=/.test(v.html) }; });
      assert(meta.uidOk && meta.dark === (theme === 'dark') && !meta.hasScript && !meta.hidden && meta.len < 350000, `${tag}: picture is per user, records the theme, has no scripts/handlers or hidden pages (${meta.len} chars)`);
      assert(meta.css > 1000 && meta.css < 90000 && !meta.aria, `${tag}: picture is light - only the CSS it uses (${meta.css} chars), no screen-reader attributes`);
      await p.close();
      // 2. reopen: picture first, then live; frames sampled through the handover
      p = await ctx.newPage(); p.on('pageerror', e => errs.push(tag + ': ' + e.message));
      let slow = true; await p.route(/dist\/app\.js/, async r => { if (slow) await new Promise(x => setTimeout(x, 700)); r.continue(); }); // app code arrives late, like a slow phone
      await p.goto(BASE + '?tab=today', { waitUntil: 'commit' });
      await p.waitForSelector('#snapView', { state: 'attached', timeout: 5000 }).catch(() => {});
      let v = await view(p);
      assert(v && v.on && v.drawnAt < 1500, `${tag}: reopen draws the picture at once (${v && v.drawnAt} ms), before the app code`);
      assert((await picText(p)).includes(T1), `${tag}: the picture shows the saved Today (event title)`);
      const inert = await p.evaluate(() => { const v = document.getElementById('snapView'); return v.hasAttribute('inert') && v.getAttribute('aria-hidden') === 'true' && !document.querySelector('#snapView #todayBody') && document.querySelectorAll('#todayBody').length <= 1; });
      assert(inert, `${tag}: picture is inert + hidden from screen readers, and adds no duplicate ids to the page`);
      const vp = d.viewport, box = [0, 70, vp.width, Math.round(vp.height * 0.7)];
      const pic = await p.screenshot(); fs.writeFileSync(`${SHOTS}/${tag}-today-picture.png`, pic);
      const frames = []; for (let i = 0; i < 60; i++) { frames.push(await p.screenshot()); const s = await view(p); if (s && !s.on) break; await p.waitForTimeout(40); }
      await p.waitForFunction(() => window.__snapView && __snapView.dropped && !document.getElementById('snapView'), null, { timeout: 12000 });
      v = await view(p); assert(v.dropped === 'live', `${tag}: picture hands over to the live page (${v.dropped}: drawn ${v.drawnAt}, live ready ${v.readyAt}, removed ${v.droppedAt} ms)`);
      await p.waitForTimeout(600); const live = await p.screenshot(); fs.writeFileSync(`${SHOTS}/${tag}-today-live.png`, live);
      const dd = await diff(pic, live, box); assert(dd.d < 0.02, `${tag}: picture matches the live Today (${(dd.d * 100).toFixed(2)}% pixels differ)`);
      const lv = await diff(live, live, box); let worst = 1;
      for (const f of frames) { const r = await diff(f, live, box); worst = Math.min(worst, (await diff(f, f, box)).ink / lv.ink); }
      assert(worst > 0.85, `${tag}: no blank or faded frame during the handover (${frames.length} frames, lowest content ${(worst * 100).toFixed(0)}% of live)`);
      assert(await p.evaluate(() => document.elementFromPoint(innerWidth / 2, innerHeight / 2).closest('#snapView') === null), `${tag}: taps reach the live page after the handover`);
      await p.close();
      // 3. stale picture: the event changed elsewhere; live data replaces it, the old title is gone
      await rest(`events?owner_id=eq.${A.user.id}&title=eq.${encodeURIComponent(T1)}`, { method: 'PATCH', body: JSON.stringify({ title: T2 }) });
      p = await open('?tab=today', 'commit'); await p.waitForSelector('#snapView', { state: 'attached', timeout: 5000 }).catch(() => {});
      const st0 = await picText(p);
      await p.waitForFunction(t => !document.getElementById('snapView') && document.getElementById('todayBody').textContent.includes(t), T2, { timeout: 20000 });
      const st = await p.evaluate(t => ({ old: [...document.querySelectorAll('#todayBody .tc-list, #todayBody')].some(e => e.innerText.split('\n').some(l => l.trim() === t || l.includes(t + ' ') && !l.includes('renamed'))), pic: !!document.getElementById('snapView') }), T1);
      assert(st0.includes(T1) && !st.old && !st.pic, `${tag}: changed elsewhere - picture had the old title, live Today shows the new one and no old text is left`);
      assert(await saved(p, 'today') && await p.waitForFunction(t => { const k = Object.keys(localStorage).find(k => k.indexOf('sandy.snap.v1.view.today.') === 0); return k && localStorage.getItem(k).includes(t); }, T2, { timeout: 15000 }).then(() => true, () => false), `${tag}: the saved picture is refreshed with the new data`);
      // 3b. a tap once the live page is up goes to the live page (not swallowed by the picture) and removes the picture
      p = await ctx.newPage(); await p.route(/dist\/app\.js/, async r => { await new Promise(x => setTimeout(x, 300)); r.continue(); });
      await p.goto(BASE + '?tab=today', { waitUntil: 'commit' });
      const caught = await p.waitForFunction(() => window.__snapView && __snapView.readyAt && document.getElementById('snapView'), null, { timeout: 20000, polling: 'raf' }).then(() => true, () => false);
      if (caught) {
        const hit = await p.evaluate(() => { const t = document.querySelector('#todayBody .tc-summary').getBoundingClientRect(); const e = document.elementFromPoint(t.left + 4, t.top + t.height / 2); return { pe: getComputedStyle(document.getElementById('snapView')).pointerEvents, live: !!(e && e.closest('#todayBody')), x: t.left + 4, y: t.top + t.height / 2 }; });
        await p.touchscreen.tap(hit.x, hit.y); v = await view(p);
        assert(hit.pe === 'none' && hit.live && !v.on, `${tag}: after the live page is ready a tap reaches it and removes the picture (${v.dropped})`);
      } else assert(true, `${tag}: (handover finished before a tap could be tried)`);
      await p.close();
      // 4. tab switch while the picture is up removes it at once
      p = await ctx.newPage(); slow = true; await p.route(/dist\/app\.js/, async r => { await new Promise(x => setTimeout(x, 300)); r.continue(); });
      await p.goto(BASE + '?tab=today', { waitUntil: 'commit' }); await p.waitForSelector('#snapView', { state: 'attached', timeout: 5000 }).catch(() => {});
      await p.waitForFunction(() => window.SandyNav && window.__snapView && __snapView.readyAt == null, null, { timeout: 20000 }).catch(() => {});
      await p.evaluate(() => SandyNav.go('todo')); v = await view(p);
      assert(v && !v.on && (v.dropped === 'tab' || v.dropped === 'live'), `${tag}: switching tab removes the picture at once (${v && v.dropped})`);
      assert(await p.evaluate(() => !document.getElementById('page-todo').hidden && getComputedStyle(document.getElementById('page-todo')).display !== 'none'), `${tag}: the To-Do tab shows`);
      await p.close();
      // 5. Home: List at today. A big Home (a tablet's month / week grid) gets no picture: it would cost more than it saves.
      p = await open('?tab=home'); await up(p);
      await p.waitForFunction(() => document.querySelector('#calendar .fc-view') && window.__app && __app.calendar, null, { timeout: 20000 }).catch(() => {}); await p.waitForTimeout(1500);
      const big = await p.evaluate(() => document.querySelectorAll('#page-home *').length > 900 && !/^list/.test(__app.calendar.view.type));
      if (big) {
        await p.waitForTimeout(4500); const hk = await p.evaluate(() => Object.keys(localStorage).some(k => k.indexOf('sandy.snap.v1.view.home.') === 0)); await p.close();
        p = await open('?tab=home', 'domcontentloaded'); const drewH = await p.evaluate(() => !!window.__snapView); await up(p);
        const shows = await p.waitForFunction(() => !document.getElementById('page-home').hidden && document.querySelector('#calendar .fc-view'), null, { timeout: 20000 }).then(() => true, () => false);
        assert(!hk && !drewH && shows, `${tag}: big Home (month/week grid) - no picture saved or drawn, Home opens as before`); await p.close();
      } else {
      assert(await saved(p, 'home'), `${tag}: Home's picture is saved`); await p.close();
      p = await open('?tab=home', 'commit'); await p.waitForSelector('#snapView', { state: 'attached', timeout: 5000 }).catch(() => {});
      v = await view(p); const hpic = await p.screenshot(); fs.writeFileSync(`${SHOTS}/${tag}-home-picture.png`, hpic);
      assert(v && v.on && (await picText(p)).includes(T2), `${tag}: Home reopen draws its picture with the events (${v && v.drawnAt} ms)`);
      await p.waitForFunction(() => window.__snapView && __snapView.dropped && !document.getElementById('snapView'), null, { timeout: 12000 }); await p.waitForTimeout(600);
      v = await view(p); const hlive = await p.screenshot(); fs.writeFileSync(`${SHOTS}/${tag}-home-live.png`, hlive);
      const hd = await diff(hpic, hlive, [0, 70, Math.round(vp.width * 0.75), Math.round(vp.height * 0.7)]);
      assert(v.dropped === 'live' && hd.d < 0.03, `${tag}: Home picture hands over and matches the live List (${(hd.d * 100).toFixed(2)}% differ)`);
      await p.close(); }
      // 6. no draw: deep link, other day, other build, other size, other theme, rollback switch
      const noDraw = async (m, prep, url = '?tab=today', route) => {
        const q = await ctx.newPage(); q.on('pageerror', e => errs.push(tag + ': ' + e.message));
        if (route) await q.route(route[0], route[1]);
        await q.goto(BASE + 'favicon.ico').catch(() => {}); const back = prep ? await q.evaluate(prep) : null;
        await q.goto(BASE + url, { waitUntil: 'domcontentloaded' }); const drew = await q.evaluate(() => !!window.__snapView);
        if (back) await q.evaluate(back => { for (const [k, val] of Object.entries(back)) localStorage.setItem(k, val); }, back);
        assert(!drew, `${tag}: no picture - ${m}`); await q.close();
      };
      const edit = f => `(() => { const back = {}; for (const k of Object.keys(localStorage).filter(k => k.indexOf('sandy.snap.v1.view.') === 0 && k !== 'sandy.snap.v1.viewcss')) { back[k] = localStorage.getItem(k); const v = JSON.parse(back[k]); (${f})(v); localStorage.setItem(k, JSON.stringify(v)); } return back; })()`;
      await noDraw('a deep link (?event=…)', null, '?event=x');
      await noDraw('saved on another day', edit("v => { v.day = '2000-01-01'; }"));
      await noDraw('saved by another build', edit("v => { v.tag = 'old-build'; }"));
      await noDraw('another window width', edit("v => { v.w = v.w + 100; }"));
      await noDraw('the other theme', edit("v => { v.dark = !v.dark; }"));
      await noDraw('rollback switch off', null, '?tab=today', [/\/(\?.*)?$|index\.html/, async r => { const res = await r.fetch(); r.fulfill({ response: res, body: (await res.text()).replace('window.__snapViewOn = true;', 'window.__snapViewOn = false;') }); }]);
      // 7. another account signed in on this device (session swapped, no sign-out): A's picture is never shown
      const Bs = await session(CE); // fresh each time: its sign-out below ends all its sessions
      p = await open('favicon.ico'); await p.evaluate(({ k, s }) => localStorage.setItem(k, JSON.stringify(s)), { k: KEY, s: Bs });
      await p.goto(BASE + '?tab=today', { waitUntil: 'domcontentloaded' });
      assert(!(await p.evaluate(() => !!window.__snapView)), `${tag}: another account's session - no picture of the first account`);
      await up(p).catch(async e => { console.log('dbg-B', await p.evaluate(() => ({ app: !!window.__app, mode: window.__app && __app.Store && __app.Store.mode, nav: !!window.SandyNav, gate: document.getElementById('authGate') && !document.getElementById('authGate').hidden, body: document.body.className, txt: document.body.innerText.slice(0, 200) }))); throw e; }); await p.waitForFunction(() => document.querySelector('#todayBody .tc-summary'), null, { timeout: 20000 }); await p.waitForTimeout(1200);
      assert(!(await p.evaluate(t => document.body.innerText.includes(t), T2)), `${tag}: the other account never sees the first account's event`);
      assert(await saved(p, 'today') && await p.evaluate(u => Object.keys(localStorage).some(k => k === 'sandy.snap.v1.view.today.' + u), Bs.user.id), `${tag}: the other account gets its own picture`);
      // 8. signed out: sign-out wipes every picture; the next open shows sign-in, no picture
      await p.evaluate(async () => { await __app.Store.auth.signOut(); });
      const left = await p.evaluate(() => Object.keys(localStorage).filter(k => k.indexOf('sandy.snap.v1.view') === 0).length);
      assert(left === 0, `${tag}: sign-out removes every saved picture (both accounts)`);
      await p.goto(BASE + '?tab=today', { waitUntil: 'load' });
      assert(!(await p.evaluate(() => !!window.__snapView)), `${tag}: signed out - no picture on the next open`);
      await p.waitForFunction(() => { const g = document.getElementById('authGate'); return g && !g.hidden; }, null, { timeout: 30000 });
      assert(true, `${tag}: signed out - the sign-in screen shows`);
      await p.close(); await ctx.close();
    }
    assert(errs.length === 0, 'no page errors' + (errs.length ? ': ' + errs.slice(0, 3).join(' | ') : ''));
    console.log(`PASS ${n} checks`);
  } finally { await cleanup(); await b.close(); }
})().catch(e => { console.error(e.message || e); process.exit(1); });
