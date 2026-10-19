// Browser test: animations apply (dialogs, picker, briefing collapse, scrim) and prefers-reduced-motion makes them instant.
//   node tests/motion.test.js http://127.0.0.1:8766/
const { chromium } = require(process.env.PW || '/workspace/shot-tools/node_modules/playwright-core');
const BASE = process.argv[2] || 'http://127.0.0.1:8766/';
const assert = (c, m) => { if (!c) { throw new Error('FAIL: ' + m); } console.log('ok -', m); };
(async () => {
  const b = await chromium.launch({ executablePath: '/usr/bin/google-chrome', headless: true, args: ['--no-sandbox'] });
  for (const rm of ['no-preference', 'reduce']) for (const vp of [{ width: 1300, height: 900, name: 'desktop' }, { width: 390, height: 844, name: 'mobile' }]) {
    const N = `[${vp.name}/${rm}]`;
    const ctx = await b.newContext({ viewport: vp, reducedMotion: rm, hasTouch: vp.name === 'mobile', isMobile: vp.name === 'mobile' });
    const p = await ctx.newPage(); const errs = []; p.on('pageerror', e => errs.push(e.message));
    await p.goto(BASE + '?view=dayGridMonth'); await p.evaluate(() => localStorage.clear()); await p.reload(); await p.waitForSelector('.fc-event'); await p.waitForTimeout(300);
    const red = rm === 'reduce';
    assert(await p.evaluate(() => document.documentElement.classList.contains('reduce-motion')) === red, `${N} reduce-motion class matches preference`);
    // event editor open
    await p.click('#addBtn');
    const st = await p.evaluate(() => { const d = document.getElementById('eventDialog'); const cs = getComputedStyle(d); return { cls: d.classList.contains('anim-in'), name: cs.animationName, dur: parseFloat(cs.animationDuration) * 1000 }; });
    assert(st.cls && st.name === 'dlg-in', `${N} editor gets anim-in / dlg-in`);
    assert(red ? st.dur <= 1 : st.dur >= 150 && st.dur <= 300, `${N} editor open duration ${st.dur}ms`);
    // Escape: animated close (still open briefly unless reduced), then closed
    await p.waitForTimeout(300); await p.keyboard.press('Escape');
    const mid = await p.evaluate(() => { const d = document.getElementById('eventDialog'); return { open: d.open, closing: d.classList.contains('closing') }; });
    assert(red ? !mid.open : mid.open && mid.closing, `${N} Escape ${red ? 'closes instantly' : 'plays exit before closing'}`);
    await p.waitForTimeout(300);
    assert(!(await p.evaluate(() => document.getElementById('eventDialog').open)), `${N} editor closed after exit`);
    assert(await p.evaluate(() => document.activeElement && document.activeElement.id === 'addBtn'), `${N} focus returns to + New`);
    // month picker pop
    await p.click('.fc-toolbar-title');
    assert(await p.evaluate(() => getComputedStyle(document.getElementById('monthPicker')).animationName) === 'pop-in', `${N} picker uses pop-in`);
    await p.waitForTimeout(300); await p.click('#monthPicker button[value=cancel]');
    if (!red) assert(await p.evaluate(() => document.getElementById('monthPicker').classList.contains('closing')), `${N} picker Cancel plays pop-out`);
    await p.waitForTimeout(300); assert(!(await p.isVisible('#monthPicker')), `${N} picker closed`);
    // briefing collapse
    await p.click('#briefCollapse');
    const mid2 = await p.evaluate(() => ({ hidden: document.getElementById('briefBody').hidden, anims: document.getElementById('briefBody').getAnimations().length, rot: getComputedStyle(document.getElementById('briefCollapse')).transform }));
    assert(red ? mid2.hidden : !mid2.hidden && mid2.anims > 0, `${N} briefing collapse ${red ? 'instant' : 'animates before hiding'}`);
    await p.waitForTimeout(350); assert(await p.evaluate(() => document.getElementById('briefBody').hidden), `${N} briefing hidden after slide`);
    assert(await p.textContent('#briefCollapse') === '▾', `${N} chevron glyph kept (rotated by CSS)`);
    await p.click('#briefCollapse'); await p.waitForTimeout(350); assert(await p.isVisible('#briefBody'), `${N} briefing expands`);
    if (vp.name === 'mobile') {
      await p.click('#menuBtn'); await p.waitForTimeout(350);
      assert(await p.evaluate(() => getComputedStyle(document.getElementById('scrim')).opacity) === '1', `${N} scrim fades in`);
      await p.click('#scrim', { position: { x: 370, y: 400 } }); await p.waitForTimeout(350);
      assert(await p.evaluate(() => getComputedStyle(document.getElementById('scrim')).visibility) === 'hidden', `${N} scrim hidden after close`);
    }
    assert(errs.length === 0, `${N} no page errors ${errs.join('; ')}`);
    await ctx.close();
  }
  await b.close(); console.log('ALL MOTION TESTS PASSED');
})().catch(e => { console.error(e.message); process.exit(1); });
