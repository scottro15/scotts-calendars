// Speed step A (t182u): the minified/combined build (dist/) must behave and look exactly like the plain files.
// Every page and main flow, on iPhone, iPad, Android phone + tablet, light + dark, twice: once with index.html
// switched back to the plain files (the rollback, same as `node scripts/build-dist.mjs --off`) and once as shipped
// (dist/). Checks: no page errors in either, the same visible text + layout signature, the screenshots match
// (< 0.6% of pixels differ), and the shipped run really loaded dist/ (one app script).
//   node tests/dist_parity.test.js BASE [SHOTS] [device]
const PW = require(process.env.PW || '/usr/local/lib/pnpm/5/.pnpm/playwright-core@1.59.1/node_modules/playwright-core');
const fs = require('fs'); const { execFileSync } = require('child_process');
const BASE = process.argv[2] || 'http://127.0.0.1:8873/';
const SHOTS = process.argv[3] || '/workspace/shots-oct29/speed-a'; fs.mkdirSync(SHOTS, { recursive: true });
const only = process.argv[4] || '';
const DEV = [['iphone', 'webkit', 393, 852], ['ipad', 'webkit', 820, 1180], ['android-phone', 'chromium', 412, 915], ['android-tablet', 'chromium', 800, 1280]];
const NOW = '2026-11-03T15:00:00Z';
let n = 0; const fails = []; const ok = (c, m) => { if (c) { n++; console.log('ok -', m); } else { fails.push(m); console.log('FAIL -', m); } };
const plain = h => h.replace(/href="dist\/(styles|tablet)\.css/g, 'href="$1.css').replace(/(<!-- app-scripts:start[^>]*-->)[\s\S]*?(<!-- app-scripts:end -->)/, (m, a, b) => {
  const tag = (h.match(/styles\.css\?v=([\w.-]+)/) || [])[1];
  const files = fs.readFileSync(__dirname + '/../scripts/app-files.txt', 'utf8').split('\n').filter(Boolean);
  return a + `\n<script src="early.js?v=${tag}"></script><script src="vendor/fullcalendar.min.js"></script><script src="vendor/supabase.min.js"></script>` + files.map(f => `<script src="${f}?v=${tag}"></script>`).join('') + '\n' + b; });
const diff = (a, b) => Number(execFileSync('python3', ['-c', `
from PIL import Image, ImageChops
a=Image.open('${a}').convert('RGB'); b=Image.open('${b}').convert('RGB')
if a.size!=b.size: print(1.0)
else:
  d=ImageChops.difference(a,b).convert('L').point(lambda v:255 if v>24 else 0); print(d.histogram()[255]/(a.size[0]*a.size[1]))`]).toString());

async function run(B, name, eng, w, h, dark, variant, cfg) {
  const ctx = await B.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 1, isMobile: eng === 'chromium', hasTouch: true, serviceWorkers: cfg.sw ? 'allow' : 'block', timezoneId: 'America/Chicago', colorScheme: dark ? 'dark' : 'light', reducedMotion: 'reduce' });
  await ctx.route('**/config.js', r => r.fulfill({ contentType: 'application/javascript', body: cfg.config || "window.CALENDAR_CONFIG={APP_NAME:'SANDY',SUPABASE_URL:'',SUPABASE_ANON_KEY:'',OWNER_EMAIL:''};" }));
  if (variant === 'src') await ctx.route(u => /\/(index\.html)?(\?.*)?$/.test(new URL(u).pathname + new URL(u).search) && !/\.\w+$/.test(new URL(u).pathname.replace(/index\.html$/, '')), async r => {
    if (r.request().resourceType() !== 'document') return r.continue();
    const res = await r.fetch(); r.fulfill({ response: res, body: plain(await res.text()) }); });
  await ctx.route(u => !/^(127\.0\.0\.1|localhost)$/.test(new URL(u).hostname), r => r.abort()); // outside APIs (weather, maps, drive times) answer at random speeds: off in both runs
  if (cfg.version) await ctx.route(/version\.json/, r => r.fulfill({ contentType: 'application/json', body: JSON.stringify({ v: cfg.version }) }));
  await ctx.addInitScript(({ dark, tour }) => { if (sessionStorage.getItem('__i')) return; sessionStorage.setItem('__i', '1'); localStorage.clear(); localStorage.setItem('sandy.welcome.off', '1'); if (!tour) localStorage.setItem('sandy.tour.off', '1'); if (dark) localStorage.setItem('sandy.theme', 'dark'); }, { dark, tour: !!cfg.tour });
  const p = await ctx.newPage(); const errs = []; p.on('pageerror', e => { if (!/ResizeObserver loop/.test(e.message)) errs.push(e.message); });
  if (!cfg.sw) await p.clock.install({ time: new Date(NOW) });
  return { ctx, p, errs };
}
const sig = p => p.evaluate(() => { // visible text + a layout signature of what is on screen
  const vis = e => { const r = e.getBoundingClientRect(); const s = getComputedStyle(e); return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && r.bottom > 0 && r.top < innerHeight; };
  const els = [...document.querySelectorAll('body *')].filter(vis);
  const text = (document.body.innerText || '').replace(/\s+/g, ' ').replace(/\(in (\d+ hrs? )?\d+ min\)/g, '(in …)').trim(); // the countdown ticks on the real clock in the SW flow
  const lay = els.filter(e => e.id || e.matches('button, h1, h2, h3, input, textarea, dialog, nav')).slice(0, 400).map(e => { const r = e.getBoundingClientRect(); return `${e.tagName}#${e.id.replace(/\d+$/, '#')}@${Math.round(r.left)},${Math.round(r.top)},${Math.round(r.width)}x${r.height > innerHeight ? 'tall' : Math.round(r.height)}`; }).join('|');
  const scripts = [...document.scripts].filter(s => s.src).map(s => new URL(s.src).pathname.split('/').slice(-2).join('/'));
  return { text, lay, scripts, dist: scripts.some(s => s === 'dist/app.js'), appScripts: scripts.filter(s => !/vendor|config/.test(s)).length };
});
const ready = async p => { await p.waitForFunction(() => window.__app && window.SandyNav && window.SandyAI && window.SandyUpdate && document.querySelector('#todayBody .tc-summary'), null, { timeout: 30000 }); await p.waitForTimeout(900); };
const open = async (p, q = '?tab=today') => { await p.goto(BASE + q); await ready(p); };
const settle = p => p.waitForTimeout(800);
const FLOWS = [
  ['today', {}, async p => { await open(p); }],
  ['home-calendar', {}, async p => { await open(p); await p.evaluate(() => SandyNav.go('home')); await p.waitForSelector('#calendar .fc-view'); await settle(p); }],
  ['calendar-month', {}, async p => { await open(p, '?tab=today&view=dayGridMonth'); await p.evaluate(() => SandyNav.go('home')); await p.waitForSelector('#calendar .fc-view'); await settle(p); }],
  ['todo', {}, async p => { await open(p); await p.evaluate(() => SandyNav.go('todo')); await settle(p); }],
  ['notes-search', {}, async p => { await open(p); await p.click('#bottomNav [data-tab=search]'); await settle(p); }],
  ['profile-settings', {}, async p => { await open(p); await p.evaluate(() => SandyNav.go('profile')); await settle(p); }],
  ['si', {}, async p => { await open(p); await p.click('#aiBtn'); await p.waitForSelector('#aiSheet:not([hidden])'); await settle(p); }],
  ['editor', {}, async p => { await open(p);
    const id = await p.evaluate(async () => (await Store.save({ calendar: __app.calendars()[0].id, kind: 'event', category: 'Other', title: 'Parity practice', allDay: false, start: '2026-11-03T15:00', end: '2026-11-03T16:00', reminders: [30], notes: 'Bring water', recurrence: { freq: 'none' } })).id);
    await p.evaluate(id => __app.openEditor(id), id); await p.waitForSelector('#eventDialog[open]'); await settle(p); }],
  ['quick-add', {}, async p => { await open(p); await p.evaluate(() => SandyNav.go('todo')); await settle(p); await p.click('#railNew:visible, #todoFab:visible'); await settle(p); }],
  ['tour', { tour: true }, async p => { await open(p); await p.evaluate(() => SandyNav.go('profile')); await settle(p);
    const b = await p.$('#tourBtn'); if (b) { await b.scrollIntoViewIfNeeded(); await b.click(); await p.waitForSelector('#tourRoot', { timeout: 5000 }).catch(() => {}); await p.waitForTimeout(500); } }],
  ['update-banner', { version: '20991231-parity' }, async p => { await open(p); await p.evaluate(() => { window.__SANDY_UPDATE_TEST = 1; return SandyUpdate.check(); }); await p.waitForFunction(() => SandyUpdate.visible && !document.getElementById('updateBanner').hidden, null, { timeout: 8000 }); await settle(p); }],
  ['sign-in', { config: "window.CALENDAR_CONFIG={APP_NAME:'SANDY',SUPABASE_URL:'http://127.0.0.1:9/',SUPABASE_ANON_KEY:'local-anon',OWNER_EMAIL:''};" }, async p => { await p.goto(BASE); await p.waitForSelector('#authGate:not([hidden])', { timeout: 20000 }); await p.waitForTimeout(400); }],
  ['offline-sw', { sw: true }, async (p, ctx) => { await p.goto(BASE + '?tab=today'); await p.waitForFunction(() => window.SandyNav && navigator.serviceWorker && navigator.serviceWorker.controller || (navigator.serviceWorker && navigator.serviceWorker.ready.then(() => false)), null, { timeout: 15000 }).catch(() => {});
    await p.evaluate(() => navigator.serviceWorker.ready); await p.reload(); await p.waitForFunction(() => navigator.serviceWorker.controller && window.SandyNav, null, { timeout: 15000 });
    await p.waitForTimeout(1500); await ctx.setOffline(true); await p.reload(); await p.waitForTimeout(2500); }],
];
(async () => {
  const B = {};
  try {
    for (const [name, eng, w, h] of DEV) for (const dark of [false, true]) {
      if (only && name !== only) continue;
      B[eng] = B[eng] || (eng === 'webkit' ? await PW.webkit.launch() : await PW.chromium.launch({ executablePath: '/usr/bin/google-chrome', args: ['--no-sandbox'] }));
      const tag = `${name}-${dark ? 'dark' : 'light'}`; console.log('#', tag);
      for (const [flow, cfg, fn] of FLOWS) {
        if (flow === 'offline-sw' && eng === 'webkit') { console.log(`# ${tag} offline-sw: skipped on WebKit (Playwright WebKit on this box never lets a service worker control the page; the plain files fail the same way). Covered on Android Chrome + the suite's sw tests.`); continue; }
        const res = {};
        for (const variant of ['src', 'dist']) {
          const { ctx, p, errs } = await run(B[eng], name, eng, w, h, dark, variant, cfg);
          try { await fn(p, ctx); } catch (e) { errs.push('flow: ' + e.message.split('\n')[0]); }
          const s = await sig(p).catch(e => ({ text: 'ERR ' + e.message, lay: '', scripts: [] }));
          const shot = `${SHOTS}/${tag}-${flow}-${variant}.png`; await p.screenshot({ path: shot }).catch(() => {});
          res[variant] = { ...s, errs, shot }; await ctx.close();
        }
        const a = res.src, b = res.dist;
        ok(!a.errs.length && !b.errs.length, `${tag} ${flow}: no errors (src ${a.errs.join(' | ') || '-'}; dist ${b.errs.join(' | ') || '-'})`);
        if (flow !== 'offline-sw') ok(b.dist && b.appScripts === 2 && !a.dist && a.appScripts === 37, `${tag} ${flow}: dist run loaded dist/early.js + dist/app.js, src run the 37 plain files (${b.appScripts} / ${a.appScripts})`);
        ok(a.text === b.text, `${tag} ${flow}: same visible text${a.text === b.text ? '' : `\n   src:  ${a.text.slice(0, 300)}\n   dist: ${b.text.slice(0, 300)}`}`);
        const la = a.lay.split('|'), lb = b.lay.split('|'); const oa = la.filter(x => !lb.includes(x)), ob = lb.filter(x => !la.includes(x)); ok(a.lay === b.lay, `${tag} ${flow}: same layout of buttons/headings/fields${a.lay === b.lay ? '' : ` (only src: ${oa.slice(0, 4).join(' ')} | only dist: ${ob.slice(0, 4).join(' ')})`}`);
        const d = diff(a.shot, b.shot); ok(d < 0.006, `${tag} ${flow}: screenshots match (${(d * 100).toFixed(2)}% of pixels differ)`);
        if (d < 0.006) fs.unlinkSync(a.shot); // keep the dist shot (and both when they differ)
      }
    }
  } catch (e) { fails.push('crash: ' + e.message); console.log(e); }
  for (const b of Object.values(B)) await b.close();
  console.log(fails.length ? `FAIL ${fails.length} of ${n + fails.length}` : `DIST PARITY PASSED (${n} checks)`); process.exit(fails.length ? 1 : 0);
})();
