// Browser test: tablet layout (t137u choices 1A/2A/3A) + phone unchanged.
//   node tests/tablet_layout.test.js http://127.0.0.1:8766/
const { chromium } = require(process.env.PW || '/workspace/shot-tools/node_modules/playwright-core');
const BASE = process.argv[2] || 'http://127.0.0.1:8766/';
const assert = (c, m) => { if (!c) throw new Error('FAIL: ' + m); console.log('ok -', m); };
const DROID = 'Mozilla/5.0 (Linux; Android 14; SM-X710) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36';
(async () => {
  const b = await chromium.launch({ executablePath: '/usr/bin/google-chrome', headless: true, args: ['--no-sandbox'] });
  const errs = [];
  const open = async (w, h, nav) => {
    const ctx = await b.newContext({ viewport: { width: w, height: h }, isMobile: true, hasTouch: true, userAgent: DROID, timezoneId: 'America/Chicago' });
    const p = await ctx.newPage(); p.on('pageerror', e => errs.push(e.message));
    await p.goto(BASE); await p.evaluate(nav => { localStorage.clear(); localStorage.setItem('sandy.welcome.off', '1'); localStorage.setItem('sandy.tour.off', '1'); if (nav) localStorage.setItem('sandy.tabletNav', nav); }, nav); await p.reload(); await p.waitForSelector('.fc');
    return { ctx, p };
  };
  const cls = p => p.evaluate(() => document.documentElement.className);
  const go = async (p, t) => { await p.click(`.bottom-nav button[data-tab="${t}"]`); await p.waitForTimeout(500); };
  // 1A: sidebar rail by default from 768px, portrait included; floating-bar setting kept
  for (const [w, h] of [[768, 1024], [800, 1280], [1180, 820]]) {
    const { ctx, p } = await open(w, h);
    const c = await cls(p); assert(/lay-tablet/.test(c) && /lay-rail/.test(c), `[${w}x${h}] default = sidebar rail`);
    assert(await p.isVisible('#railNew'), `[${w}x${h}] rail New visible`);
    // 3A: Today calendar hidden; 2 columns only from 810px
    await go(p, 'today');
    const grid = await p.evaluate(() => document.getElementById('todayBody').classList.contains('tt-grid'));
    assert(grid === (w >= 810), `[${w}x${h}] Today two-column = ${w >= 810}`);
    // 2A: To-Do details pane only on tap
    await go(p, 'todo'); await p.evaluate(() => SandyNav.renderTodo && SandyNav.renderTodo()); await p.waitForSelector('#todoList .todo-row .td-title');
    assert(!(await p.evaluate(() => SandyQuickSheet.isOpen)), `[${w}x${h}] To-Do opens with no pane`);
    await p.click('#todoList .todo-row .td-title'); await p.waitForTimeout(600);
    assert(await p.evaluate(() => SandyQuickSheet.isOpen && document.documentElement.classList.contains('qs-pane-open')), `[${w}x${h}] tap opens details pane`);
    // keyboard over the pane: footer stays above it
    await p.evaluate(() => { const s = document.getElementById('qsSheet'); s.style.setProperty('--kb', '360px'); s.classList.add('kb'); }); await p.waitForTimeout(300);
    const fb = await p.evaluate(() => document.querySelector('#qsSheet .qs-foot').getBoundingClientRect().bottom);
    assert(fb <= h - 360 + 1, `[${w}x${h}] pane footer above keyboard (${Math.round(fb)} <= ${h - 360})`);
    await p.evaluate(() => { const s = document.getElementById('qsSheet'); s.style.removeProperty('--kb'); s.classList.remove('kb'); });
    // Android back closes the pane and stays on To-Do
    await p.evaluate(() => history.back()); await p.waitForTimeout(700);
    assert(await p.evaluate(() => !SandyQuickSheet.isOpen && document.body.classList.contains('tab-todo')), `[${w}x${h}] back closes pane`);
    await ctx.close();
  }
  { const { ctx, p } = await open(820, 1180, 'capsule');
    const c = await cls(p); assert(/lay-tablet/.test(c) && !/lay-rail/.test(c), '[820] Floating bar setting = no rail');
    await ctx.close(); }
  // rotation to a phone-width split screen drops the tablet layout
  { const { ctx, p } = await open(1180, 820);
    await p.setViewportSize({ width: 507, height: 820 }); await p.waitForTimeout(500);
    const c = await cls(p); assert(!/lay-tablet|lay-rail/.test(c), '[507] phone layout after resize');
    assert(!(await p.evaluate(() => document.documentElement.classList.contains('qs-pane-open'))), '[507] no stale qs-pane-open');
    await ctx.close(); }
  // phones untouched
  for (const w of [320, 390, 430]) { const { ctx, p } = await open(w, 800);
    assert(!/lay-tablet|lay-rail/.test(await cls(p)), `[${w}] phone: no tablet classes`); await ctx.close(); }
  assert(errs.length === 0, 'no page errors ' + errs.join(' | '));
  await b.close();
})().catch(e => { console.error(e.message || e); process.exit(1); });
