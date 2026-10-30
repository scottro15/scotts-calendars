// Browser test (Scott 2026-10-29, t148u item 3): the SANDY AI text box keeps all its text inside the box, and other
// fields/pickers don't clip their text. iPhone SE / iPhone 15 (WebKit), Android 360 / 412, Galaxy Tab, iPad Pro 11, light + dark.
//  - Empty: the placeholder fits on one line inside the box (no clipped second line).
//  - Typing grows the box line by line up to 5 lines, then it scrolls and the caret line stays visible; no sideways overflow.
//  - Clearing (send / new chat) shrinks it back to one line.
//  - Text fit elsewhere: To-Do quick-add type + category pickers, Search placeholder, Profile → Time format, editor Calendar picker.
//   node tests/ai_text_fit.test.js http://127.0.0.1:8793/ [screenshotDir]
const PW = require(process.env.PW || '/workspace/shot-tools/node_modules/playwright-core');
const BASE = process.argv[2] || 'http://127.0.0.1:8793/'; const SHOTS = process.argv[3] || '/workspace/shots-oct29/ai-text/test';
require('fs').mkdirSync(SHOTS, { recursive: true });
let n = 0; const assert = (c, m) => { if (!c) throw new Error('FAIL: ' + m); n++; console.log('ok -', m); };
const DROID = 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Mobile Safari/537.36';
const SAM = 'Mozilla/5.0 (Linux; Android 14; SM-X710) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/26.0 Chrome/122.0.0.0 Safari/537.36';
const DEV = [['iphone-se', 'webkit', { device: 'iPhone SE' }], ['iphone-15', 'webkit', { device: 'iPhone 15' }],
  ['android-360', 'chromium', { w: 360, h: 780, ua: DROID }], ['android-412', 'chromium', { w: 412, h: 915, ua: DROID }],
  ['galaxy-tab', 'chromium', { w: 800, h: 1280, ua: SAM }], ['ipad-pro11', 'webkit', { device: 'iPad Pro 11' }]];
// width of a field's text vs the room it has (selects: minus the arrow)
const FIT = (sel) => { const el = document.querySelector(sel); if (!el || !el.offsetParent) return null; const cs = getComputedStyle(el);
  const cx = document.createElement('canvas').getContext('2d'); cx.font = `${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`;
  const txt = el.tagName === 'SELECT' ? el.selectedOptions[0].text : (el.value || el.placeholder);
  const room = el.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight) - (el.tagName === 'SELECT' ? 22 : 0);
  return { txt, w: Math.round(cx.measureText(txt).width), room: Math.round(room) }; };
async function run(PWb, [dn, eng, o], dark) {
  const mode = dark ? 'dark' : 'light'; const tag = `${dn} ${mode}`;
  const dev = o.device ? { ...PW.devices[o.device] } : { viewport: { width: o.w, height: o.h }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, userAgent: o.ua };
  delete dev.defaultBrowserType; if (eng === 'webkit') delete dev.isMobile;
  const ctx = await PWb.newContext({ ...dev, serviceWorkers: 'block', timezoneId: 'America/Chicago', reducedMotion: 'reduce' });
  await ctx.addInitScript(dark => { if (!sessionStorage.getItem('__t')) { sessionStorage.setItem('__t', '1'); localStorage.clear(); localStorage.setItem('sandy.tour.off', '1'); localStorage.setItem('sandy.theme', dark ? 'dark' : 'light'); } }, dark);
  const p = await ctx.newPage(); const errs = []; p.on('pageerror', e => errs.push(e.message));
  await p.goto(BASE); await p.waitForFunction(() => window.SandyAI && window.SandyNav && window.__app);
  await p.evaluate(() => window.SandyWelcome && SandyWelcome.close()); await p.waitForTimeout(300);
  assert(await p.evaluate(() => document.documentElement.classList.contains('dark')) === dark, `${tag}: theme`);
  await p.evaluate(() => SandyAI.open()); await p.waitForSelector('.ai-input textarea', { state: 'visible' }); await p.waitForTimeout(700);
  const ta = '.ai-input textarea';
  const m = () => p.evaluate(sel => { const t = document.querySelector(sel); const cs = getComputedStyle(t);
    const cx = document.createElement('canvas').getContext('2d'); cx.font = `${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`;
    return { h: t.clientHeight, sh: t.scrollHeight, sw: t.scrollWidth, cw: t.clientWidth, st: t.scrollTop, oy: cs.overflowY, lh: parseFloat(cs.lineHeight) || parseFloat(cs.fontSize) * 1.35,
      max: parseFloat(cs.maxHeight), ph: t.placeholder, phw: cx.measureText(t.placeholder).width, room: t.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight) }; }, ta);
  let a = await m();
  assert(a.sh <= a.h + 1, `${tag}: empty box holds its placeholder (${a.sh}<=${a.h})`);
  assert(a.phw <= a.room + 1, `${tag}: placeholder "${a.ph}" fits on one line (${Math.round(a.phw)}<=${Math.round(a.room)})`);
  const empty = a.h; await p.screenshot({ path: `${SHOTS}/${dn}-empty-${mode}.png` });
  await p.fill(ta, 'Add film with Nick tomorrow 4pm'); await p.waitForTimeout(150); a = await m();
  assert(a.sh <= a.h + 1 && a.sw <= a.cw + 1, `${tag}: short text fully inside the box (${a.sh}<=${a.h})`);
  const one = a.h;
  await p.fill(ta, 'Add film with Nick tomorrow 4pm at the Moolah, then dinner at 7'); await p.waitForTimeout(150); a = await m();
  assert(a.h >= one && (a.sh <= a.h + 1 || (a.h >= a.max - 1 && a.oy === "auto")), `${tag}: longer text grows the box (${one}→${a.h}, sh ${a.sh}, max ${a.max}, ${a.oy})`);
  assert(a.sw <= a.cw + 1, `${tag}: no sideways overflow`);
  await p.screenshot({ path: `${SHOTS}/${dn}-multi-${mode}.png` });
  await p.click(ta); await p.keyboard.press('End');
  await p.fill(ta, Array.from({ length: 12 }, (_, i) => `Line ${i + 1}: practice, film, lift, recovery and notes for the week`).join('\n')); await p.waitForTimeout(150); a = await m();
  assert(a.h <= a.max + 1 && a.oy === 'auto', `${tag}: very long text caps at max height (${a.h}<=${a.max}) and scrolls`);
  assert(a.st + a.h >= a.sh - 2, `${tag}: the last line (where you type) stays in view`);
  await p.screenshot({ path: `${SHOTS}/${dn}-capped-${mode}.png` });
  await p.fill(ta, ''); await p.waitForTimeout(150); a = await m();
  assert(Math.abs(a.h - empty) <= 1, `${tag}: clearing shrinks back to one line (${a.h}=${empty})`);
  await p.evaluate(() => SandyAI.close()); await p.waitForTimeout(300);
  // text fit elsewhere
  await p.evaluate(() => SandyNav.go('todo')); await p.waitForTimeout(500);
  for (const s of ['#qaKind', '#qaCat']) { const r = await p.evaluate(FIT, s); if (r) assert(r.w <= r.room + 3, `${tag}: To-Do ${s} "${r.txt}" fits (${r.w}<=${r.room})`); }
  await p.evaluate(() => SandyNav.go('search')); await p.waitForTimeout(500);
  { const r = await p.evaluate(FIT, '#searchBox'); if (r) assert(r.w <= r.room + 1, `${tag}: Search placeholder fits (${r.w}<=${r.room})`); }
  await p.evaluate(() => SandyNav.go('profile')); await p.waitForTimeout(500);
  for (const v of ['auto', '12', '24']) { const r = await p.evaluate(([s, v]) => { const el = document.querySelector(s); el.value = v; return null; }, ['#timeFormat', v]); const f = await p.evaluate(FIT, '#timeFormat'); if (f) assert(f.w <= f.room + 3, `${tag}: Time format "${f.txt}" fits (${f.w}<=${f.room})`); }
  await p.evaluate(() => { document.querySelector('#timeFormat').value = 'auto'; });
  await p.evaluate(() => SandyNav.go('today')); await p.waitForTimeout(300);
  await p.evaluate(() => __app.openEditor(null)); await p.waitForTimeout(500);
  const ids = await p.evaluate(() => [...document.querySelectorAll('#fCalendar option')].map(o => o.value));
  for (const id of ids) { await p.evaluate(id => { const s = document.querySelector('#fCalendar'); s.value = id; }, id); const f = await p.evaluate(FIT, '#fCalendar'); assert(f && f.w <= f.room + 3, `${tag}: editor Calendar "${f && f.txt}" fits (${f && f.w}<=${f && f.room})`); }
  await p.evaluate(id => { const s = document.querySelector('#fCalendar'); s.value = 'msc'; }); await p.screenshot({ path: `${SHOTS}/${dn}-editor-${mode}.png` });
  assert(!errs.length, `${tag}: no page errors ${errs.join(' | ')}`);
  await ctx.close();
}
(async () => {
  const jobs = []; for (const d of DEV) for (const dark of [false, true]) jobs.push([d, dark]);
  const br = {}; const get = async eng => br[eng] ||= (eng === 'webkit' ? PW.webkit.launch() : PW.chromium.launch({ executablePath: '/usr/bin/google-chrome', args: ['--no-sandbox'] }));
  let i = 0; const worker = async () => { while (i < jobs.length) { const [d, dark] = jobs[i++]; await run(await get(d[1]), d, dark); } };
  await Promise.all([worker(), worker(), worker()]);
  for (const b of Object.values(br)) await (await b).close();
  console.log(`\nALL ${n} CHECKS PASSED`);
})().catch(e => { console.error(e); process.exit(1); });
