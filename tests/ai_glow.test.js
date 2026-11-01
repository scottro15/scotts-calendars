// AI button glow (Scott 2026-11-01): a subtle pulsing border (soft periwinkle #C7D2FE light, white dark),
// distinct from the update pill (pulse only, no travelling ring), steady under reduced motion. 4 devices x light/dark.
//   node tests/ai_glow.test.js http://127.0.0.1:8814/ /tmp/shots [device]
const PW = process.env.PW || '/usr/local/lib/pnpm/5/.pnpm/playwright-core@1.59.1/node_modules/playwright-core';
const { chromium, webkit } = require(PW);
const fs = require('fs');
const BASE = process.argv[2] || 'http://127.0.0.1:8793/';
const OUT = process.argv[3] || '/tmp/aiglow';
const only = process.argv[4] || '';
fs.mkdirSync(OUT, { recursive: true });
const DEV = [['iphone', 'webkit', 393, 852], ['ipad', 'webkit', 820, 1180], ['android-phone', 'chromium', 412, 915], ['android-tablet', 'chromium', 800, 1280]];
let n = 0;
(async () => {
  const errs = [];
  const ok = (c, m, tag) => { if (!c) errs.push(tag + ': ' + m); else n++; };
  for (const [name, eng, w, h] of DEV) {
    if (only && name !== only) continue;
    const br = eng === 'webkit' ? await webkit.launch() : await chromium.launch({ executablePath: '/usr/bin/google-chrome', args: ['--no-sandbox'] });
    for (const dark of [false, true]) {
      const tag = `${name}-${dark ? 'dark' : 'light'}`;
      const ctx = await br.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 2, isMobile: eng === 'chromium', hasTouch: true, serviceWorkers: 'block', timezoneId: 'America/Chicago', colorScheme: dark ? 'dark' : 'light' });
      await ctx.route('**/config.js', r => r.fulfill({ contentType: 'application/javascript', body: "window.CALENDAR_CONFIG={APP_NAME:'SANDY',SUPABASE_URL:'',SUPABASE_ANON_KEY:'',OWNER_EMAIL:''};" }));
      await ctx.addInitScript(d => { if (sessionStorage.getItem('__i')) return; sessionStorage.setItem('__i', '1'); localStorage.clear(); localStorage.setItem('sandy.welcome.off', '1'); localStorage.setItem('sandy.tour.off', '1'); if (d) localStorage.setItem('sandy.theme', 'dark'); }, dark);
      const p = await ctx.newPage();
      p.on('pageerror', e => { if (!/ResizeObserver loop/.test(e.message)) errs.push(tag + ': page error ' + e.message); });
      await p.goto(BASE); await p.waitForFunction(() => window.__app && window.SandyNav); await p.waitForTimeout(500);
      const want = dark ? 'rgb(255, 255, 255)' : 'rgb(199, 210, 254)';
      const st = await p.evaluate(() => { const b = document.getElementById('aiBtn'), cs = getComputedStyle(b), bf = getComputedStyle(b, '::before'); return { name: cs.animationName, dur: parseFloat(cs.animationDuration), iter: cs.animationIterationCount, ring: bf.content !== 'none' && bf.content !== '' && bf.animationName !== 'none' }; });
      ok(st.name === 'aiGlow' && st.iter === 'infinite', `AI button pulses (${st.name})`, tag);
      ok(st.dur >= 2.5 && st.dur <= 5, `slow, subtle pulse (${st.dur}s)`, tag);
      ok(!st.ring, 'no travelling ring (the update pill has one)', tag);
      ok(st.name !== 'ubPulse' && st.name !== 'ubSpin', 'different animation from the update pill', tag);
      // freeze at the peak and read the colour
      const peak = await p.evaluate(() => { const b = document.getElementById('aiBtn'); const a = b.getAnimations()[0]; a.pause(); a.currentTime = 1700; return getComputedStyle(b).boxShadow; });
      const ww = want.replace(')', '').replace('rgb(', '');
      ok(peak.includes(ww) || peak.includes("rgba(" + ww), `peak glow uses ${want}: ${peak}`, tag);
      const b = await (await p.$('#aiBtn')).boundingBox();
      await p.screenshot({ path: `${OUT}/${tag}-ai-glow-peak.png`, clip: { x: Math.max(0, b.x - 60), y: 0, width: Math.min(w - Math.max(0, b.x - 60), b.width + 80), height: b.y + b.height + 20 } });
      await p.screenshot({ path: `${OUT}/${tag}-ai-glow-page.png` });
      await p.evaluate(() => { const b = document.getElementById('aiBtn'); b.getAnimations()[0].play(); });
      ok(await p.evaluate(() => document.getElementById('aiBtn').getBoundingClientRect().width > 0), 'AI button still shown', tag);
      await p.click('#aiBtn'); await p.waitForTimeout(500);
      ok(await p.evaluate(() => !!document.querySelector('dialog[open], .ai-panel:not([hidden]), #aiDialog[open], [class*=ai-][class*=open]')), 'AI button still opens the assistant', tag);
      await p.keyboard.press('Escape'); await p.waitForTimeout(300);
      await p.emulateMedia({ reducedMotion: 'reduce' }); await p.waitForTimeout(100);
      const rm = await p.evaluate(() => { const cs = getComputedStyle(document.getElementById('aiBtn')); return [cs.animationName, cs.boxShadow]; });
      ok(rm[0] === 'none' && rm[1] !== 'none', `reduced motion: steady ring, no pulse (${rm[0]})`, tag);
      await ctx.close();
    }
    await br.close();
  }
  console.log(`${n} checks passed`);
  if (errs.length) { console.log('FAIL\n' + errs.join('\n')); process.exit(1); }
  console.log('PASS');
})().catch(e => { console.error(e); process.exit(1); });
