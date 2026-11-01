// Load-time quick wins (t174u): the two vendor libraries load at the end of <body> (not in <head>), right before
// config.js and the app scripts, so the top bar / skeleton paint first; the app still boots normally on all 4 devices.
//   node tests/loadorder.test.js http://127.0.0.1:8817/ /tmp/out
const PW = process.env.PW || '/usr/local/lib/pnpm/5/.pnpm/playwright-core@1.59.1/node_modules/playwright-core';
const { chromium, webkit } = require(PW);
const BASE = process.argv[2] || 'http://127.0.0.1:8817/';
const DEV = [['iphone', 'webkit', 393, 852], ['ipad', 'webkit', 820, 1180], ['android-phone', 'chromium', 412, 915], ['android-tablet', 'chromium', 800, 1280]];
let n = 0; const errs = []; const ok = (c, m) => { if (c) n++; else errs.push(m); };
(async () => {
  for (const [name, eng, w, h] of DEV) {
    const br = eng === 'webkit' ? await webkit.launch() : await chromium.launch({ executablePath: '/usr/bin/google-chrome', args: ['--no-sandbox'] });
    const ctx = await br.newContext({ viewport: { width: w, height: h }, isMobile: eng === 'chromium', hasTouch: true, serviceWorkers: 'block', timezoneId: 'America/Chicago' });
    await ctx.route('**/config.js', r => r.fulfill({ contentType: 'application/javascript', body: "window.CALENDAR_CONFIG={APP_NAME:'SANDY',SUPABASE_URL:'',SUPABASE_ANON_KEY:'',OWNER_EMAIL:''};" }));
    // hold FullCalendar: the top bar + skeleton must already be on screen (they no longer wait for it)
    let release; const gate = new Promise(r => { release = r; });
    await ctx.route('**/vendor/fullcalendar.min.js', async r => { await gate; r.continue(); });
    await ctx.addInitScript(() => { localStorage.setItem('sandy.welcome.off', '1'); localStorage.setItem('sandy.tour.off', '1'); });
    const p = await ctx.newPage(); const pe = []; p.on('pageerror', e => pe.push(e.message));
    p.goto(BASE + '?tab=today').catch(() => {});
    await p.waitForSelector('#skel', { timeout: 15000 }).catch(() => {});
    const early = await p.evaluate(() => ({ skel: !!document.getElementById('skel'), bar: !!document.querySelector('.topbar') && document.querySelector('.topbar').getBoundingClientRect().height > 0, nav: !!document.getElementById('bottomNav'), fc: !!window.FullCalendar }));
    ok(early.skel && early.bar && early.nav && !early.fc, `${name}: page + skeleton are there before FullCalendar has loaded ${JSON.stringify(early)}`);
    release();
    await p.waitForSelector('#todayBody .tc-summary', { timeout: 20000 }).catch(() => {});
    const st = await p.evaluate(() => {
      const head = [...document.head.querySelectorAll('script[src]')].map(s => s.getAttribute('src'));
      const body = [...document.body.querySelectorAll('script[src]')].map(s => s.getAttribute('src').split('?')[0]);
      return { head, i: [body.indexOf('config.js'), body.indexOf('early.js'), body.indexOf('vendor/fullcalendar.min.js'), body.indexOf('vendor/supabase.min.js'), body.indexOf('storage.js'), body.indexOf('app.js')], fc: !!window.FullCalendar, sb: !!(window.supabase && supabase.createClient), today: !!document.querySelector('#todayBody .tc-summary') };
    });
    ok(st.head.length === 0, `${name}: no external scripts left in <head> (${st.head})`);
    ok(st.i[0] >= 0 && st.i[0] < st.i[1] && st.i[1] < st.i[2] && st.i[2] < st.i[3] && st.i[3] < st.i[4] && st.i[4] < st.i[5], `${name}: config, early (data reads start), FullCalendar, supabase, storage, app in that order ${st.i}`);
    ok(st.fc && st.sb && st.today, `${name}: libraries loaded and Today shows`);
    await p.click('#bottomNav [data-tab="home"]').catch(() => {}); await p.waitForSelector('#calendar .fc-event', { timeout: 15000 }).catch(() => {});
    ok(await p.evaluate(() => !!document.querySelector('#calendar .fc-event')), `${name}: Home calendar renders events`);
    ok(!pe.length, `${name}: no page errors ${pe}`);
    await br.close();
  }
  console.log(`${n} checks passed`);
  if (errs.length) { console.log('FAIL\n' + errs.join('\n')); process.exit(1); }
  console.log('PASS');
})().catch(e => { console.error(e); process.exit(1); });
