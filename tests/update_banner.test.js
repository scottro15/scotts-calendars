// Update banner: detect newer deploy → pill above nav → tap reloads once (no loop).
//   node tests/update_banner.test.js http://127.0.0.1:8780/ /workspace/shots-update
const { chromium } = require(process.env.PW || '/usr/local/lib/pnpm/5/.pnpm/playwright-core@1.59.1/node_modules/playwright-core');
const fs = require('fs');
const BASE = process.argv[2] || 'http://127.0.0.1:8780/';
const SHOTS = process.argv[3] || '/workspace/shots-update';
fs.mkdirSync(SHOTS, { recursive: true });
const assert = (c, m) => { if (!c) throw new Error('FAIL: ' + m); console.log('ok -', m); };
let n = 0; const ok = (c, m) => { assert(c, m); n++; };

(async () => {
  const b = await chromium.launch({ executablePath: '/usr/bin/google-chrome', headless: true, args: ['--no-sandbox'] });

  async function open(dark = false) {
    const ctx = await b.newContext({
      viewport: { width: 390, height: 844 }, timezoneId: 'America/Chicago', locale: 'en-US',
      isMobile: true, hasTouch: true, deviceScaleFactor: 2, reducedMotion: 'reduce',
      colorScheme: dark ? 'dark' : 'light',
    });
    await ctx.route('**/config.js', r => r.fulfill({
      contentType: 'application/javascript',
      body: "window.CALENDAR_CONFIG = { APP_NAME: 'SANDY', SUPABASE_URL: '', SUPABASE_ANON_KEY: '', OWNER_EMAIL: '' };",
    }));
    await ctx.addInitScript(d => {
      localStorage.clear();
      localStorage.setItem('sandy.welcome.off', '1');
      localStorage.setItem('sandy.tour.off', '1');
      if (d) { localStorage.setItem('sandy.theme', 'dark'); document.documentElement.classList.add('dark'); }
    }, dark);
    const p = await ctx.newPage();
    const errs = []; p.on('pageerror', e => errs.push(String(e)));
    await p.goto(BASE);
    await p.waitForFunction(() => window.SandyUpdate && window.__app);
    await p.evaluate(() => { window.__SANDY_UPDATE_TEST = 1; });
    return { ctx, p, errs };
  }

  // --- 1. Tag helpers ---
  {
    const { ctx, p, errs } = await open(false);
    const running = await p.evaluate(() => SandyUpdate.running);
    ok(!!running && /^\d{8}-/.test(running), `running tag from page stylesheet (${running})`);
    ok(await p.evaluate(() => SandyUpdate.tagOf('styles.css?v=20991231-x') === '20991231-x'), 'tagOf parses ?v=');
    ok(errs.length === 0, 'no page errors on boot: ' + errs.join('; '));
    await ctx.close();
  }

  // --- 2. version.json newer → banner; dismiss; re-check stays dismissed ---
  {
    const { ctx, p } = await open(false);
    await ctx.route(/version\.json/, r => r.fulfill({
      status: 200, contentType: 'application/json', body: JSON.stringify({ v: '20991231-banner' }),
    }));
    await p.evaluate(() => SandyUpdate.check());
    await p.waitForFunction(() => SandyUpdate.visible && !document.getElementById('updateBanner').hidden);
    const txt = await p.locator('#updateBannerTap').innerText();
    ok(/Update ready/.test(txt) && /Tap to refresh/.test(txt), `banner copy: ${JSON.stringify(txt)}`);
    ok(await p.evaluate(() => SandyUpdate.pending === '20991231-banner'), 'pending = live tag');
    await p.screenshot({ path: `${SHOTS}/01-banner-light.png` });
    await p.locator('#updateBannerDismiss').click();
    await p.waitForFunction(() => document.getElementById('updateBanner').hidden || !SandyUpdate.visible);
    ok(await p.evaluate(() => sessionStorage.getItem('sandy.updateDismissed') === '20991231-banner'), 'dismiss remembers tag');
    await p.evaluate(() => SandyUpdate.check());
    await p.waitForTimeout(400);
    ok(await p.evaluate(() => document.getElementById('updateBanner').hidden), 'dismissed tag does not reappear this session');
    await ctx.close();
  }

  // --- 3. Dark mode shot ---
  {
    const { ctx, p } = await open(true);
    await ctx.route(/version\.json/, r => r.fulfill({
      status: 200, contentType: 'application/json', body: JSON.stringify({ v: '20991231-banner' }),
    }));
    await p.evaluate(() => SandyUpdate.check());
    await p.waitForFunction(() => SandyUpdate.visible);
    await p.waitForTimeout(350); // enter animation
    await p.screenshot({ path: `${SHOTS}/02-banner-dark.png` });
    ok(await p.locator('#updateBanner').isVisible(), 'dark: banner visible');
    await ctx.close();
  }

  // --- 4. Tap → clean reload once; second check does not loop ---
  {
    const { ctx, p } = await open(false);
    await ctx.route(/version\.json/, r => r.fulfill({
      status: 200, contentType: 'application/json', body: JSON.stringify({ v: '20991231-tap' }),
    }));
    // After reload the page still has the old running tag; keep serving "newer" so the tried-guard is what stops the loop
    await p.evaluate(() => SandyUpdate.check());
    await p.waitForFunction(() => SandyUpdate.visible);
    const nav = p.waitForURL(/build=20991231-tap/, { timeout: 6000 }).then(() => true).catch(() => false);
    await p.locator('#updateBannerTap').click();
    ok(await nav, 'tap reloads with ?build=<new tag>');
    await p.waitForFunction(() => window.SandyUpdate);
    await p.evaluate(() => { window.__SANDY_UPDATE_TEST = 1; });
    // tried guard: check again must NOT navigate
    const url0 = p.url();
    await p.evaluate(() => SandyUpdate.check());
    await p.waitForTimeout(700);
    // Banner may show again (dismissed cleared by navigation) but must not auto-reload
    ok(p.url() === url0, 'no reload loop after tap (tried-tag session guard)');
    // Explicit second tap on same tag also blocked by tried
    const pending = await p.evaluate(() => SandyUpdate.pending);
    if (pending === '20991231-tap') {
      await p.evaluate(() => SandyUpdate.reload());
      await p.waitForTimeout(500);
      ok(p.url() === url0, 'second reload of same tried tag is a no-op');
    } else {
      ok(true, 'pending cleared or different after landing (ok)');
    }
    await ctx.close();
  }

  // --- 5. Editor open → banner waits; after close it appears; confirm on tap if re-opened ---
  {
    const { ctx, p } = await open(false);
    await ctx.route(/version\.json/, r => r.fulfill({
      status: 200, contentType: 'application/json', body: JSON.stringify({ v: '20991231-edit' }),
    }));
    // Open editor FIRST, then detect update — banner must wait
    await p.evaluate(() => {
      const d = document.getElementById('eventDialog');
      if (d && d.showModal) d.showModal();
      else if (d) d.setAttribute('open', '');
    });
    ok(await p.evaluate(() => !!document.querySelector('dialog[open]')), 'editor dialog open');
    await p.evaluate(() => SandyUpdate.check());
    await p.waitForTimeout(500);
    ok(await p.evaluate(() => SandyUpdate.pending === '20991231-edit' && !SandyUpdate.visible),
      'update detected while editor open → pending, banner not yet shown');
    // Close editor → banner paints
    await p.evaluate(() => { const d = document.getElementById('eventDialog'); d.close ? d.close() : d.removeAttribute('open'); });
    await p.waitForFunction(() => SandyUpdate.visible, null, { timeout: 5000 });
    ok(await p.locator('#updateBanner').isVisible(), 'banner appears after editor closes');
    // Re-open editor, tap via JS (top-layer would block Playwright click), cancel confirm
    await p.evaluate(() => { const d = document.getElementById('eventDialog'); d.showModal ? d.showModal() : d.setAttribute('open', ''); });
    p.once('dialog', async d => { await d.dismiss(); });
    const urlBefore = p.url();
    await p.evaluate(() => document.getElementById('updateBannerTap').click());
    await p.waitForTimeout(400);
    ok(p.url() === urlBefore, 'editor open + cancel confirm → no reload');
    p.once('dialog', async d => { await d.accept(); });
    const nav = p.waitForURL(/build=20991231-edit/, { timeout: 6000 }).then(() => true).catch(() => false);
    await p.evaluate(() => document.getElementById('updateBannerTap').click());
    ok(await nav, 'editor open + accept confirm → reload');
    await ctx.close();
  }

  // --- 6. Fallback: no version.json → scrape index.html ?fresh= ---
  {
    const { ctx, p } = await open(false);
    const html = await (await p.request.get(BASE)).text();
    await ctx.route(/version\.json/, r => r.fulfill({ status: 404, body: 'missing' }));
    await ctx.route(/\?fresh=/, r => r.fulfill({
      status: 200, contentType: 'text/html',
      body: html.replace(/20\d{6}-[\w]+/g, '20991231-html'),
    }));
    await p.evaluate(() => SandyUpdate.check());
    await p.waitForFunction(() => SandyUpdate.pending === '20991231-html', null, { timeout: 5000 });
    ok(await p.evaluate(() => SandyUpdate.visible), 'fallback: index.html cache-tag scrape shows banner');
    await p.screenshot({ path: `${SHOTS}/03-banner-fallback-light.png` });
    await ctx.close();
  }

  // --- 7. Same version → no banner ---
  {
    const { ctx, p } = await open(false);
    const running = await p.evaluate(() => SandyUpdate.running);
    await ctx.route(/version\.json/, r => r.fulfill({
      status: 200, contentType: 'application/json', body: JSON.stringify({ v: running }),
    }));
    await p.evaluate(() => SandyUpdate.check());
    await p.waitForTimeout(500);
    ok(await p.evaluate(() => !SandyUpdate.visible && document.getElementById('updateBanner').hidden), 'same version → no banner');
    await ctx.close();
  }

  console.log(`\n${n} checks passed`);
  await b.close();
})().catch(e => { console.error(e); process.exit(1); });
