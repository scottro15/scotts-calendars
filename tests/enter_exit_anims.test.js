// Browser test: consistent enter/exit animations (AI sheet, editor, scope prompt, toast, bottom-nav tabs) + no dead taps.
//   node tests/enter_exit_anims.test.js http://127.0.0.1:8784/ [screenshotDir]
const { chromium } = require(process.env.PW || '/workspace/shot-tools/node_modules/playwright-core');
const BASE = process.argv[2] || 'http://127.0.0.1:8784/'; const SHOTS = process.argv[3];
const assert = (c, m) => { if (!c) { throw new Error('FAIL: ' + m); } console.log('ok -', m); };
(async () => {
  const b = await chromium.launch({ executablePath: '/usr/bin/google-chrome', headless: true, args: ['--no-sandbox'] });
  for (const red of [false, true]) {
    const N = red ? '[reduce]' : '[motion]';
    const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, timezoneId: 'America/Chicago', isMobile: true, hasTouch: true, reducedMotion: red ? 'reduce' : 'no-preference' });
    await ctx.route('**/config.js', r => r.fulfill({ contentType: 'application/javascript', body: 'window.CALENDAR_CONFIG = {};' }));
    const p = await ctx.newPage(); const errs = []; p.on('pageerror', e => errs.push(e.message));
    await p.goto(BASE + '?view=listWeek'); await p.waitForSelector('.fc-list-event');
    const anim = sel => p.$eval(sel, e => getComputedStyle(e).animationName);
    // AI sheet exit
    await p.tap('#aiBtn'); await p.waitForTimeout(500);
    await p.tap('.ai-x');
    const mid = await p.$eval('#aiSheet', e => ({ hidden: e.hidden, closing: e.classList.contains('ai-closing'), a: getComputedStyle(e.querySelector('.ai-panel')).animationName }));
    assert(red ? mid.hidden : (!mid.hidden && mid.closing && mid.a === 'aiDown'), `${N} AI sheet ${red ? 'closes instantly' : 'plays aiDown before hiding'}`);
    if (!red && SHOTS) await p.screenshot({ path: `${SHOTS}/32_ai_sheet_exit_mid_mobile.png` });
    await p.waitForTimeout(350); assert(await p.$eval('#aiSheet', e => e.hidden), `${N} AI sheet hidden after exit`);
    // reopen right during exit: no dead tap
    await p.tap('#aiBtn'); await p.waitForTimeout(30); await p.tap('.ai-x'); await p.waitForTimeout(60); await p.tap('#aiBtn'); await p.waitForTimeout(400);
    assert(!(await p.$eval('#aiSheet', e => e.hidden)), `${N} reopen during exit works (no dead tap)`);
    await p.tap('.ai-x'); await p.waitForTimeout(350);
    // editor exit + reopen during exit
    await p.tap('#addBtn'); await p.waitForTimeout(80);
    assert(red ? (await anim('#eventDialog') === 'none' || (await p.$eval('#eventDialog', d => parseFloat(getComputedStyle(d).animationDuration) * 1000)) <= 1) : await anim('#eventDialog') === 'aiUp' && (await p.$eval('#eventDialog', d => parseFloat(getComputedStyle(d).animationDuration) * 1000)) <= (red ? 1 : 450), `${N} editor enter animation`);
    if (!red && SHOTS) { await p.waitForTimeout(120); await p.screenshot({ path: `${SHOTS}/32_editor_enter_mid_mobile.png` }); }
    await p.waitForTimeout(400); await p.keyboard.press('Escape');
    if (!red) assert(await anim('#eventDialog') === 'aiDown', `${N} editor exit animation`);
    await p.waitForTimeout(40); await p.tap('#addBtn'); await p.waitForTimeout(500);
    assert(await p.$eval('#eventDialog', d => d.open && !d.classList.contains('closing')), `${N} editor reopens mid-exit`);
    await p.keyboard.press('Escape'); await p.waitForTimeout(400); assert(!(await p.$eval('#eventDialog', d => d.open)), `${N} editor closed`);
    // scope prompt enter (generic dialog style)
    const r = p.evaluate(() => { document.getElementById('scopeDialog').showModal(); const cs = getComputedStyle(document.getElementById('scopeDialog')); return cs.animationName + '|' + parseFloat(cs.animationDuration) * 1000; });
    assert(await r === (red ? 'sheet-in|1' : 'sheet-in|280'), `${N} scope prompt enter`);
    await p.evaluate(() => document.getElementById('scopeDialog').close()); await p.waitForTimeout(300);
    assert(!(await p.$eval('#scopeDialog', d => d.open)), `${N} scope prompt closes after exit`);
    // toast exit
    await p.evaluate(() => { const t = document.getElementById('toast'); t.textContent = 'Saved'; t.hidden = false; });
    await p.waitForTimeout(250); await p.evaluate(() => { document.getElementById('toast').hidden = true; });
    const th = await p.$eval('#toast', t => ({ h: t.hidden, out: t.classList.contains('toast-out') }));
    assert(red ? th.h : (!th.h && th.out), `${N} toast ${red ? 'hides instantly' : 'fades out first'}`);
    await p.waitForTimeout(250); assert(await p.$eval('#toast', t => t.hidden), `${N} toast hidden after exit`);
    // drawer
    await p.tap('#bottomNav [data-tab=profile]'); await p.waitForTimeout(350); assert(await p.isVisible('#page-profile') && await p.getAttribute('#bottomNav [data-tab=profile]', 'aria-current') === 'page', `${N} Profile tab opens (replaces the drawer)`);
    await p.tap('#bottomNav [data-tab=home]'); await p.waitForTimeout(350);
    assert(await p.isVisible('#calendar') && !(await p.isVisible('#page-profile')), `${N} back to Home`);
    assert(!errs.length, `${N} no page errors ` + errs.join(';'));
    await ctx.close();
  }
  await b.close(); console.log('PASS enter_exit_anims');
})().catch(e => { console.error(e); process.exit(1); });
