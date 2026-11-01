// Early data fetch (t177u #1, 2026-11-01): early.js starts the start-up Supabase reads before the app code has run;
// supabase-js uses each one once (same URL + token), so nothing is fetched twice. Fully mocked Supabase (no real
// project, no real data). Checks on 4 devices x light/dark:
//  A. signed in: the reads start before app.js has even loaded; each start-up URL is requested exactly once; the app
//     shows the data (Home event, Today); skeleton → content as before; no errors
//  B. a failed early read (401) falls back to a normal request and the app still shows the data
//  C. signed out / token about to expire / offline: no early reads at all (the normal path runs)
//  D. saved copy (snapshot) still shows instantly while the network is slow
//   node tests/early_fetch.test.js http://127.0.0.1:8822/ /tmp/shots [device]
const PW = process.env.PW || '/usr/local/lib/pnpm/5/.pnpm/playwright-core@1.59.1/node_modules/playwright-core';
const { chromium, webkit } = require(PW);
const fs = require('fs');
const BASE = process.argv[2] || 'http://127.0.0.1:8822/';
const OUT = process.argv[3] || '/tmp/earlyfetch';
const only = process.argv[4] || '';
fs.mkdirSync(OUT, { recursive: true });
const DEV = [['iphone', 'webkit', 393, 852], ['ipad', 'webkit', 820, 1180], ['android-phone', 'chromium', 412, 915], ['android-tablet', 'chromium', 800, 1280]];
const SB = 'https://qaearly.supabase.co';
const KEY = 'sb-qaearly-auth-token';
const UID = '44444444-4444-4444-4444-444444444444';
const cfg = `window.CALENDAR_CONFIG={APP_NAME:'SANDY',SUPABASE_URL:'${SB}',SUPABASE_ANON_KEY:'qa-anon',OWNER_EMAIL:''};`;
const pad = n => String(n).padStart(2, '0');
const now = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/Chicago' }));
const D = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
const EV = [{ id: '55555555-5555-5555-5555-555555555555', owner_id: UID, calendar: 'msc', category: 'Other', title: 'QA early event', all_day: false,
  start_at: `${D}T23:00:00`, end_at: `${D}T23:30:00`, recur_freq: 'none', is_task: false, exdates: [], notes: '', location: '', reminders: [], created_at: `${D}T00:00:00Z`, updated_at: `${D}T00:00:00Z` }];
const CALS = [{ id: '66666666-6666-6666-6666-666666666666', slug: 'msc', name: 'QA Calendar', short: 'QA', color: '#7c3aed', sort: 0 }];
const START = ['events', 'calendars', 'profiles', 'categories', 'occurrence_notes', 'occurrence_links', 'inbox_items'];
const sess = expSec => JSON.stringify({ access_token: 'qa-token-' + expSec, refresh_token: 'qa-refresh', token_type: 'bearer', expires_in: expSec, expires_at: Math.floor(Date.now() / 1000) + expSec,
  user: { id: UID, email: 'sandy-qa-early@example.com', aud: 'authenticated', role: 'authenticated' } });
let n = 0;
(async () => {
  const errs = [];
  const ok = (c, m, tag) => { if (!c) errs.push(tag + ': ' + m); else n++; };
  for (const [name, eng, w, h] of DEV) {
    if (only && name !== only) continue;
    const br = eng === 'webkit' ? await webkit.launch() : await chromium.launch({ executablePath: '/usr/bin/google-chrome', args: ['--no-sandbox'] });
    for (const dark of [false, true]) {
      const tag = `${name}-${dark ? 'dark' : 'light'}`;
      const run = async ({ session = sess(3600), fail401 = false, offline = false, snap = false, slowApp = 0, slowData = 0, shot, wait = 20000 } = {}) => {
        const ctx = await br.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 1, isMobile: eng === 'chromium', hasTouch: true, serviceWorkers: 'block', timezoneId: 'America/Chicago', colorScheme: dark ? 'dark' : 'light' });
        const log = []; const t0 = Date.now(); let appDone = 0; let failed = false;
        await ctx.route('**/config.js', r => r.fulfill({ contentType: 'application/javascript', body: cfg }));
        if (slowApp) await ctx.route('**/app.js*', async r => { await new Promise(z => setTimeout(z, slowApp)); const res = await r.fetch(); appDone = Date.now() - t0; await r.fulfill({ response: res }); });
        await ctx.route(SB + '/**', async r => {
          const u = new URL(r.request().url()); const m = r.request().method();
          if (u.pathname.startsWith('/auth/')) return r.fulfill({ status: 200, contentType: 'application/json', body: session || '{}' });
          if (u.pathname.startsWith('/storage/')) return r.fulfill({ status: 404, contentType: 'application/json', body: '{}' });
          if (u.pathname.startsWith('/realtime/')) return r.abort();
          const t = u.pathname.replace('/rest/v1/', '');
          if (m === 'GET') log.push({ t, at: Date.now() - t0, early: !(r.request().headers()['x-client-info'] || '').includes('supabase-js') });
          if (slowData && /^(events|calendars|profiles)$/.test(t)) await new Promise(z => setTimeout(z, slowData)); // the reads the saved copy covers
          if (m !== 'GET') return r.fulfill({ status: 200, contentType: 'application/json', body: t.startsWith('rpc/') ? 'false' : '[]' });
          if (fail401 && t === 'events' && !failed) { failed = true; return r.fulfill({ status: 401, contentType: 'application/json', body: '{"message":"JWT expired"}' }); }
          const body = t === 'events' ? EV : t === 'calendars' ? CALS : [];
          return r.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*', 'content-range': `0-${body.length - 1}/*` }, body: JSON.stringify(body) });
        });
        await ctx.addInitScript(([k, s, d, off, snap, ev, uid]) => {
          if (sessionStorage.getItem('__i')) return; sessionStorage.setItem('__i', '1'); localStorage.clear();
          localStorage.setItem('sandy.welcome.off', '1'); localStorage.setItem('sandy.tour.off', '1'); if (d) localStorage.setItem('sandy.theme', 'dark');
          if (s) localStorage.setItem(k, s);
          if (snap) localStorage.setItem('sandy.snap.v1.profile.' + uid, JSON.stringify({ at: Date.now(), rows: [{ user_id: uid }] }));
          if (snap) localStorage.setItem('sandy.snap.v1.calendars.' + uid, JSON.stringify({ at: Date.now(), rows: snap }));
          if (snap) localStorage.setItem('sandy.snap.v1.events.' + uid, JSON.stringify({ at: Date.now(), rows: [{ id: ev[0].id, kind: 'event', calendar: 'msc', category: 'Other', title: 'QA early event', allDay: false, start: ev[0].start_at.slice(0, 16), end: ev[0].end_at.slice(0, 16), recurrence: { freq: 'none' }, exdates: [], notes: '', location: '', reminders: [] }] }));
          if (off) Object.defineProperty(Navigator.prototype, 'onLine', { get: () => false, configurable: true });
        }, [KEY, session, dark, offline, snap ? CALS : null, EV, UID]);
        const p = await ctx.newPage(); const perr = [];
        p.on('pageerror', e => { if (!/ResizeObserver loop/.test(e.message)) perr.push(e.message); });
        await p.goto(BASE + '?tab=home');
        let shown = false;
        if (session && !offline) { try { await p.waitForSelector('#calendar .fc-event:has-text("QA early event")', { timeout: wait }); shown = true; } catch (_) {} }
        else await p.waitForTimeout(3500);
        await p.waitForTimeout(800);
        const early = await p.evaluate(() => window.__sandyEarly ? { hits: window.__sandyEarly.hits, left: Object.keys(window.__sandyEarly.map).length } : null);
        if (shot) await p.screenshot({ path: `${OUT}/${tag}-${shot}.png` });
        await ctx.close();
        return { log, appDone, shown, early, perr };
      };
      // A. signed in, app.js held back 1.5 s: data reads already done by then; each start-up read once
      const A = await run({ slowApp: 1500, shot: 'home-signed-in' });
      ok(A.shown, 'signed in: Home shows the event', tag);
      ok(A.early && START.every(t => A.early.hits.includes(t)), `early reads used for all start-up tables (${A.early && A.early.hits})`, tag);
      for (const t of START) { const c = A.log.filter(x => x.t === t).length; ok(c === 1, `${t} requested once (${c})`, tag); }
      const ev = A.log.find(x => x.t === 'events');
      ok(ev && ev.early && A.appDone && ev.at < A.appDone, `events read started before app.js arrived (${ev && ev.at} ms < ${A.appDone} ms)`, tag);
      ok(!A.perr.length, 'no page errors ' + A.perr.join('|'), tag);
      // B. early read fails -> normal read, app fine
      const B = await run({ fail401: true });
      ok(B.shown, 'failed early read: app still shows the event', tag);
      ok(B.log.filter(x => x.t === 'events').length === 2, `failed early read retried once normally (${B.log.filter(x => x.t === 'events').length})`, tag);
      ok(!B.perr.length, 'no page errors (B) ' + B.perr.join('|'), tag);
      // C. no early reads when signed out, about to expire, or offline
      const C1 = await run({ session: null, shot: 'signed-out' });
      ok(!C1.early && !C1.log.length, `signed out: no reads (${C1.log.map(x => x.t)})`, tag);
      const C2 = await run({ session: sess(60) });
      ok(!C2.early, 'token about to expire: no early reads (supabase-js refreshes first)', tag);
      const C3 = await run({ offline: true });
      ok(!C3.early, 'offline: no early reads', tag);
      // D. saved copy shows straight away while the network is slow
      const Dd = await run({ snap: true, slowData: 8000, wait: 6500, shot: 'snapshot-instant' });
      ok(Dd.shown, 'saved copy: event shows within 6.5 s (2.5 s slow-read switch) while events / calendars / profile take 8 s', tag);
      ok(!Dd.perr.length, 'no page errors (D) ' + Dd.perr.join('|'), tag);
    }
    await br.close();
  }
  if (errs.length) { console.log('FAIL\n' + errs.join('\n')); process.exit(1); }
  console.log(`PASS ${n} checks`);
})().catch(e => { console.error(e); process.exit(1); });
