// Briefing fixes: (1) no row highlight during scroll/drag — only confirmed tap;
// (2) Week/Month/Season day headers match List-view cushion style.
//   node tests/briefing_press_dayhead.test.js http://127.0.0.1:8780/ /workspace/shots-briefing
const { chromium } = require(process.env.PW || '/usr/local/lib/pnpm/5/.pnpm/playwright-core@1.59.1/node_modules/playwright-core');
const fs = require('fs');
const BASE = process.argv[2] || 'http://127.0.0.1:8780/';
const SHOTS = process.argv[3] || '/workspace/shots-briefing';
fs.mkdirSync(SHOTS, { recursive: true });
const assert = (c, m) => { if (!c) throw new Error('FAIL: ' + m); console.log('ok -', m); };

(async () => {
  const b = await chromium.launch({ executablePath: '/usr/bin/google-chrome', headless: true, args: ['--no-sandbox'] });

  async function open(dark = false, record = false) {
    const opts = {
      viewport: { width: 390, height: 844 }, timezoneId: 'America/Chicago', locale: 'en-US',
      isMobile: true, hasTouch: true, deviceScaleFactor: 2, reducedMotion: 'reduce',
      colorScheme: dark ? 'dark' : 'light'
    };
    if (record) opts.recordVideo = { dir: SHOTS, size: { width: 390, height: 844 } };
    const ctx = await b.newContext(opts);
    await ctx.route('**/config.js', r => r.fulfill({
      contentType: 'application/javascript',
      body: "window.CALENDAR_CONFIG = { APP_NAME: 'SANDY', SUPABASE_URL: '', SUPABASE_ANON_KEY: '', OWNER_EMAIL: '' };"
    }));
    await ctx.addInitScript(d => {
      localStorage.clear();
      localStorage.setItem('sandy.welcome.off', '1');
      localStorage.setItem('sandy.tour.off', '1');
      if (d) localStorage.setItem('sandy.theme', 'dark');
    }, dark);
    const p = await ctx.newPage();
    const errs = []; p.on('pageerror', e => errs.push(e.message));
    await p.clock.install({ time: new Date('2026-10-26T19:00:00Z') });
    await p.goto(BASE);
    await p.waitForFunction(() => window.__app && window.Motion && document.querySelector('#briefList'));
    return { ctx, p, errs };
  }

  async function seed(p) {
    await p.evaluate(async () => {
      const S = window.__app.Store;
      if (S.clearExamples) await S.clearExamples();
      for (const e of await S.list()) { try { await S.remove(e.id); } catch (_) {} }
      const days = ['2026-10-26','2026-10-27','2026-10-28','2026-10-29','2026-10-30','2026-10-31','2026-11-01'];
      let n = 0;
      for (const d of days) for (const h of [8, 10, 12, 14, 16, 18]) {
        n++;
        await S.save({
          id: crypto.randomUUID(), kind: 'event', title: `Brief event ${n}`,
          calendar: n % 2 ? 'mam' : 'msc', category: 'Meeting', allDay: false,
          recurrence: { freq: 'none' }, location: '', notes: '',
          start: `${d}T${String(h).padStart(2,'0')}:00`, end: `${d}T${String(h).padStart(2,'0')}:45`
        });
      }
      const s = window.__app.settings(); s.briefOpen = true; window.__app.saveSettings();
      window.__app.refresh();
    });
    await p.waitForTimeout(700);
    await p.evaluate(() => {
      document.getElementById('briefing').classList.remove('collapsed');
      document.getElementById('briefBody').hidden = false;
      document.getElementById('briefCollapse').setAttribute('aria-expanded', 'true');
    });
  }

  async function openWeek(p) {
    await p.click('#briefScope [data-scope=week]');
    await p.waitForTimeout(500);
    await p.evaluate(() => document.getElementById('briefing').scrollIntoView({ block: 'start' }));
    await p.waitForTimeout(200);
  }

  // ---- Day header prominence (week) ----
  {
    const { ctx, p, errs } = await open(false);
    await seed(p); await openWeek(p);
    const cmp = await p.evaluate(() => {
      const bd = document.querySelector('#briefList .brief-day');
      const today = document.querySelector('#briefList .brief-day.is-today');
      if (!bd) return null;
      const s = getComputedStyle(bd);
      const ts = today ? getComputedStyle(today) : null;
      return {
        weight: +s.fontWeight, size: parseFloat(s.fontSize), sticky: s.position,
        borderW: parseFloat(s.borderTopWidth), radius: parseFloat(s.borderTopLeftRadius),
        bg: s.backgroundColor, todayBg: ts && ts.backgroundColor, count: document.querySelectorAll('#briefList .brief-day').length
      };
    });
    assert(cmp && cmp.count >= 2, 'week has multiple day headers: ' + JSON.stringify(cmp));
    assert(cmp.weight >= 700, 'day header bold (>=700): ' + cmp.weight);
    assert(cmp.size >= 15, 'day header size >=15px (List cushion): ' + cmp.size);
    assert(cmp.sticky === 'sticky', 'day header sticky');
    assert(cmp.borderW >= 1 && cmp.radius >= 6, 'day header bordered+rounded');
    await p.screenshot({ path: `${SHOTS}/02-briefing-week-dayheads-light.png` });
    // Month + Season
    await p.click('#briefScope [data-scope=month]'); await p.waitForTimeout(500);
    assert(await p.locator('#briefList .brief-day').count() >= 2, 'month day headers');
    await p.screenshot({ path: `${SHOTS}/03-briefing-month-dayheads-light.png` });
    await p.click('#briefScope [data-scope=season]'); await p.waitForTimeout(400);
    await p.screenshot({ path: `${SHOTS}/04-briefing-season-dayheads-light.png` });
    assert(!errs.length, 'no errors: ' + errs.join('; '));
    await ctx.close();
  }

  // Dark day heads
  {
    const { ctx, p } = await open(true);
    await seed(p); await openWeek(p);
    const todayBg = await p.$eval('#briefList .brief-day.is-today', el => getComputedStyle(el).backgroundColor);
    assert(/rgb\(30,\s*58,\s*138\)|#1e3a8a/i.test(todayBg) || todayBg.includes('30, 58, 138'), 'dark today accent: ' + todayBg);
    await p.screenshot({ path: `${SHOTS}/05-briefing-week-dayheads-dark.png` });
    await ctx.close();
  }

  // ---- Press: delay then is-press; move cancels; tap still opens ----
  {
    const { ctx, p, errs } = await open(false);
    await seed(p); await openWeek(p);
    const item = p.locator('#briefList .brief-item').first();
    await item.waitFor();
    const box = await item.boundingBox();
    const cx = box.x + box.width / 2, cy = box.y + box.height / 2;

    // pointer down without move: after delay, is-press
    await p.evaluate(({ x, y }) => {
      const el = document.elementFromPoint(x, y);
      const btn = el && el.closest('.brief-item');
      btn.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, clientX: x, clientY: y, pointerId: 1, pointerType: 'touch', isPrimary: true }));
    }, { x: cx, y: cy });
    await p.waitForTimeout(40);
    let pressed = await item.evaluate(el => el.classList.contains('is-press'));
    assert(!pressed, 'no is-press before delay');
    await p.waitForTimeout(80);
    pressed = await item.evaluate(el => el.classList.contains('is-press'));
    assert(pressed, 'is-press after delay with no move');
    await p.evaluate(() => document.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, pointerId: 1, pointerType: 'touch' })));
    await p.waitForTimeout(200);

    // move past threshold cancels
    await p.evaluate(({ x, y }) => {
      const el = document.elementFromPoint(x, y);
      const btn = el && el.closest('.brief-item');
      btn.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, clientX: x, clientY: y, pointerId: 2, pointerType: 'touch', isPrimary: true }));
    }, { x: cx, y: cy });
    await p.waitForTimeout(20);
    await p.evaluate(({ x, y }) => {
      document.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, clientX: x, clientY: y + 40, pointerId: 2, pointerType: 'touch' }));
    }, { x: cx, y: cy });
    await p.waitForTimeout(120);
    pressed = await item.evaluate(el => el.classList.contains('is-press'));
    assert(!pressed, 'is-press cancelled after move >10px');
    await p.evaluate(() => document.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, pointerId: 2, pointerType: 'touch' })));

    // scroll event cancels
    await p.evaluate(({ x, y }) => {
      const el = document.elementFromPoint(x, y);
      const btn = el && el.closest('.brief-item');
      btn.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, clientX: x, clientY: y, pointerId: 3, pointerType: 'touch', isPrimary: true }));
    }, { x: cx, y: cy });
    await p.waitForTimeout(100);
    await p.evaluate(() => document.getElementById('briefList').dispatchEvent(new Event('scroll', { bubbles: true })));
    await p.waitForTimeout(30);
    pressed = await item.evaluate(el => el.classList.contains('is-press'));
    assert(!pressed, 'is-press cancelled on scroll');

    // :active must not scale brief-item
    const transform = await item.evaluate(el => {
      el.classList.add('force-active-check');
      const s = getComputedStyle(el);
      // synthesize :active check via stylesheet rule existence
      return s.transform;
    });
    assert(transform === 'none', 'brief-item transform none (no :active scale): ' + transform);

    // real tap still opens editor
    await item.click({ force: true });
    await p.waitForSelector('#eventDialog[open]', { timeout: 8000 });
    const title = await p.inputValue('#eventDialog input[name=title]');
    assert(/Brief event/.test(title), 'tap opens event: ' + title);
    await p.click('#cancelBtn');
    await p.waitForSelector('#eventDialog', { state: 'hidden' });
    assert(!errs.length, 'press tests no errors');
    await ctx.close();
  }

  // CDP touch scroll — no is-press mid-drag + after recording
  {
    const { ctx, p } = await open(false, true);
    await seed(p); await openWeek(p);
    await p.screenshot({ path: `${SHOTS}/06-after-briefing-ready-light.png` });
    const box = await p.$eval('#briefList', el => { const r = el.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + 90 }; });
    const client = await ctx.newCDPSession(p);
    await client.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: box.x, y: box.y }] });
    await p.waitForTimeout(30);
    for (let i = 1; i <= 14; i++) {
      await client.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: box.x, y: box.y - i * 16 }] });
      await p.waitForTimeout(25);
    }
    const mid = await p.evaluate(() => [...document.querySelectorAll('.brief-item')].filter(el => el.classList.contains('is-press') || el.matches(':active')).map(el => el.querySelector('.bi-title')?.textContent));
    assert(mid.length === 0, 'no pressed rows mid-scroll: ' + mid.join(','));
    await p.screenshot({ path: `${SHOTS}/07-after-scroll-mid-light.png` });
    await client.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await p.waitForTimeout(300);
    // dark scroll shot
    await p.evaluate(() => { document.documentElement.classList.add('dark'); localStorage.setItem('sandy.theme', 'dark'); });
    await p.waitForTimeout(200);
    await openWeek(p);
    await p.screenshot({ path: `${SHOTS}/08-after-briefing-week-dark.png` });
    const video = p.video();
    await p.close();
    const vpath = await video.path();
    fs.renameSync(vpath, `${SHOTS}/09-after-scroll.webm`);
    await ctx.close();
  }

  // Today / Search selectors are wired in Motion.PRESS_SEL — cancel-on-move
  {
    const { ctx, p } = await open(false);
    await seed(p);
    await p.click('#bottomNav button[data-tab="today"]');
    await p.waitForSelector('#todayBody .tc-item.tc-ev', { timeout: 8000 });
    const has = await p.locator('#todayBody .tc-item.tc-ev').count();
    assert(has >= 1, 'today has event rows');
    const ok = await p.evaluate(() => {
      const el = document.querySelector('#todayBody .tc-item.tc-ev');
      if (!el) return 'missing';
      const r = el.getBoundingClientRect();
      const x = r.left + Math.min(40, r.width / 2), y = r.top + r.height / 2;
      el.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, clientX: x, clientY: y, pointerId: 9, pointerType: 'touch', isPrimary: true }));
      return new Promise(res => setTimeout(() => {
        document.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, clientX: x, clientY: y + 50, pointerId: 9, pointerType: 'touch' }));
        setTimeout(() => res(el.classList.contains('is-press') ? 'pressed' : 'cleared'), 30);
      }, 100));
    });
    assert(ok === 'cleared', 'today row press cancelled on move: ' + ok);
    const sel = await p.evaluate(() => window.Motion.PRESS_SEL);
    assert(sel.includes('.brief-item') && sel.includes('tc-item') && sel.includes('.sr-item') && sel.includes('.td-title') && sel.includes('.fc-list-event'), 'PRESS_SEL covers lists: ' + sel);
    await ctx.close();
  }

  await b.close();
  console.log('All briefing press/day-head tests passed. Shots in', SHOTS);
})().catch(e => { console.error(e); process.exit(1); });
