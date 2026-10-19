// Browser test: List View rows tinted with a faded version of their calendar color (msc/mam/lifetime),
// hover stronger, ongoing stronger + accent, text keeps WCAG AA contrast.
//   node tests/list_tint.test.js http://127.0.0.1:8766/ [screenshotDir]
const { chromium } = require(process.env.PW || '/workspace/shot-tools/node_modules/playwright-core');
const BASE = process.argv[2] || 'http://127.0.0.1:8766/'; const SHOTS = process.argv[3];
const assert = (c, m) => { if (!c) { throw new Error('FAIL: ' + m); } console.log('ok -', m); };
const T0 = new Date('2026-10-21T23:15:00Z');
const rgb = s => { const n = (s.match(/[\d.]+/g) || []).slice(0, 3).map(Number); return s.startsWith('color(') ? n.map(v => v * 255) : n; };
const lum = c => { const f = v => { v /= 255; return v <= .03928 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4; }; const [r, g, b] = c.map(f); return .2126 * r + .7152 * g + .0722 * b; };
const contrast = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + .05) / (y + .05); };
const mix = (hex, pct) => { const c = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16)); return c.map(v => v * pct + 255 * (1 - pct)); };
const near = (a, b) => a.every((v, i) => Math.abs(v - b[i]) <= 2);
(async () => {
  const b = await chromium.launch({ executablePath: '/usr/bin/google-chrome', headless: true, args: ['--no-sandbox'] });
  for (const vp of [{ width: 1300, height: 700, name: 'desktop' }, { width: 390, height: 700, name: 'mobile' }]) {
    const ctx = await b.newContext({ viewport: vp, timezoneId: 'America/Chicago', locale: 'en-US', isMobile: vp.name === 'mobile', hasTouch: vp.name === 'mobile' });
    const p = await ctx.newPage(); const errs = []; const N = `[${vp.name}]`; p.on('pageerror', e => errs.push(e.message));
    await p.clock.install({ time: T0 });
    await p.goto(BASE + '?view=dayGridMonth'); await p.waitForSelector('.fc-event');
    await p.evaluate(() => localStorage.clear()); await p.reload(); await p.waitForSelector('.fc-event');
    await p.click('.fc-listWeek-button'); await p.waitForSelector('tr.fc-list-event'); await p.waitForTimeout(500);
    const cals = await p.evaluate(() => Object.fromEntries([].map(c => [c.id, c.color])));
    const colors = Object.keys(cals).length ? cals : { msc: '#7c3aed', mam: '#ea580c', lifetime: '#0f766e' };
    for (const id of ['msc', 'mam', 'lifetime']) {
      const info = await p.evaluate(id => {
        const rows = [...document.querySelectorAll('tr.fc-list-event.sandy-tint:not(.sandy-ongoing)')];
        const r = rows.find(r => r.dataset.cal === id);
        if (!r) return null; const td = r.querySelector('td.fc-list-event-title') || r.lastElementChild;
        return { cal: r.style.getPropertyValue('--cal').trim(), bg: getComputedStyle(td).backgroundColor, fg: getComputedStyle(td.querySelector('a') || td).color, all: [...r.children].map(c => getComputedStyle(c).backgroundColor) };
      }, id);
      assert(info, `${N} ${id} row present`);
      assert(info.cal.toLowerCase() === colors[id].toLowerCase(), `${N} ${id} row uses calendar color ${info.cal}`);
      assert(near(rgb(info.bg), mix(colors[id], .12)), `${N} ${id} tint = 12% of calendar color (${info.bg})`);
      assert(info.all.every(c => c === info.bg), `${N} ${id} whole row tinted`);
      const cr = contrast(rgb(info.fg), rgb(info.bg)); assert(cr >= 4.5, `${N} ${id} text contrast AA (${cr.toFixed(2)})`);
    }
    // follows color changes
    await p.evaluate(() => { const r = document.querySelector('tr.sandy-tint'); r.style.setProperty('--cal', '#ff0000'); }); await p.waitForTimeout(400);
    const red = await p.evaluate(() => getComputedStyle(document.querySelector('tr.sandy-tint > td')).backgroundColor);
    assert(near(rgb(red), mix('#ff0000', .12)), `${N} tint derived from --cal dynamically (${red})`);
    await p.reload(); await p.waitForSelector('.fc-event'); await p.click('.fc-listWeek-button'); await p.waitForTimeout(500);
    if (vp.name === 'desktop') {
      const sel = 'tr.sandy-tint:not(.sandy-ongoing) td.fc-list-event-title';
      const before = await p.locator(sel).first().evaluate(e => getComputedStyle(e).backgroundColor);
      await p.locator(sel).first().hover(); await p.waitForTimeout(400);
      const after = await p.locator(sel).first().evaluate(e => getComputedStyle(e).backgroundColor);
      assert(lum(rgb(after)) < lum(rgb(before)), `${N} hover slightly stronger (${before} -> ${after})`);
      await p.mouse.move(0, 0);
    }
    await p.clock.setSystemTime(new Date('2026-10-21T21:00:00Z')); await p.evaluate(() => __app.decorateList());
    const og = await p.evaluate(() => { const r = document.querySelector('tr.sandy-ongoing.sandy-tint'); if (!r) return null; const o = document.querySelector('tr.sandy-tint:not(.sandy-ongoing)'); return { a: getComputedStyle(r.lastElementChild).backgroundColor, b: getComputedStyle(r.firstElementChild).boxShadow, cal: r.style.getPropertyValue('--cal') }; });
    assert(og && lum(rgb(og.a)) < lum(mix(og.cal.trim(), .13)), `${N} ongoing tint stronger (${og && og.a})`);
    assert(og.b.split('inset').length - 1 >= 2, `${N} ongoing has calendar accent (${og.b})`);
    assert(await p.locator('tr.sandy-today-first').count() === 1 && await p.locator('.sandy-now-line').count() === 1, `${N} today border + now-line still present`);
    if (SHOTS) { await p.clock.setSystemTime(T0); await p.evaluate(() => __app.decorateList()); await p.evaluate(() => { const h = document.querySelector('tr.sandy-today-first') || document.querySelector('tr.fc-list-day'); window.scrollTo(0, h.getBoundingClientRect().top + scrollY - 260); }); await p.waitForTimeout(300); await p.screenshot({ path: `${SHOTS}/15-list-tint-${vp.name}.png` }); }
    assert(errs.length === 0, `${N} no page errors ${errs.join('; ')}`);
    await ctx.close();
  }
  await b.close(); console.log('ALL PASSED');
})().catch(e => { console.error(e); process.exit(1); });
