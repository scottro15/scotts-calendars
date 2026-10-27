// To-Do filter chips, row category pills, and category selects fit text inside their shape.
const { chromium } = require(process.env.PW || '/usr/local/lib/pnpm/5/.pnpm/playwright-core@1.59.1/node_modules/playwright-core');
const fs = require('fs');
const BASE = process.argv[2] || 'http://127.0.0.1:8780/';
const SHOTS = process.env.CHIP_SHOTS || '/workspace/shots-todo-chips';
fs.mkdirSync(SHOTS, { recursive: true });
let n = 0; const assert = (c, m) => { if (!c) throw new Error('FAIL: ' + m); n++; console.log('ok -', m); };

(async () => {
  const b = await chromium.launch({ executablePath: '/usr/bin/google-chrome', headless: true, args: ['--no-sandbox'] });

  async function open(dark, w) {
    const ctx = await b.newContext({
      viewport: { width: w, height: 844 }, timezoneId: 'America/Chicago', locale: 'en-US',
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
    await p.goto(BASE);
    await p.waitForFunction(() => window.__app && window.SandyNav);
    // Seed calendars with long short-names like MSC / Life Time
    await p.evaluate(() => {
      const a = __app;
      const cals = [
        { slug: 'msc', name: 'Maryville Soccer Club', short: 'MSC', color: '#2563eb', sort: 1 },
        { slug: 'mam', name: 'Mom and Me', short: 'MAM', color: '#db2777', sort: 2 },
        { slug: 'life', name: 'Life Time Fitness Very Long Name', short: 'Life Time', color: '#059669', sort: 3 },
        { slug: 'long', name: 'Supercalifragilistic Calendar', short: 'Supercalifragilistic', color: '#7c3aed', sort: 4 },
      ];
      // Overlay via local store helpers used by the app
      if (a.setCalendars) a.setCalendars(cals);
      else if (a._setCals) a._setCals(cals);
      else {
        // mutate in-memory calendars list if exposed
        const cur = a.calendars();
        cur.splice(0, cur.length, ...cals.map(c => ({ id: c.slug, name: c.name, short: c.short, color: c.color, sort: c.sort })));
      }
    });
    // Categories with long names
    await p.evaluate(async () => {
      const Cats = SandyNav.Cats || null;
      // save via manage API if available
      try {
        await SandyNav.saveQuick({ raw: 'Chip fit task', kind: 'todo', description: 'desc', date: __app.ymd(__app.nowWall()), priority: 2 });
      } catch (_) {}
      // Put a long category into localStorage mirror
      const key = 'sandy.todoCats.v1';
      const cats = [
        { id: 'cat-long', name: 'Errands And Household Chores Forever', color: '#b45309' },
        { id: 'cat-msc', name: 'MSC Practice', color: '#2563eb' },
      ];
      localStorage.setItem(key, JSON.stringify(cats));
    });
    await p.click('#bottomNav [data-tab=todo]');
    await p.waitForTimeout(400);
    // Force re-render after seeding cats
    await p.evaluate(async () => {
      // Attach category to first task if possible
      const list = await __app.Store.list();
      const t = list.find(e => e.kind === 'task');
      if (t) {
        await __app.Store.save({ ...t, todoCategoryId: 'cat-long' });
      }
      // Reload cats cache
      if (SandyNav.renderTodo) await SandyNav.renderTodo();
    });
    await p.waitForTimeout(400);
    return { ctx, p };
  }

  function fits(box, label) {
    // content must not spill outside padding box (allow 1px subpixel)
    return box.scrollWidth <= box.clientWidth + 1 && box.scrollHeight <= box.clientHeight + 2;
  }

  for (const dark of [false, true]) {
    for (const w of [320, 390, 430]) {
      const tag = `${dark ? 'dark' : 'light'}_${w}`;
      const { ctx, p } = await open(dark, w);
      await p.waitForSelector('#todoFilter button');
      const info = await p.evaluate(() => {
        const chips = [...document.querySelectorAll('#todoFilter button')].map(b => {
          const lbl = b.querySelector('.chip-lbl') || b;
          const br = b.getBoundingClientRect();
          return {
            text: (lbl.textContent || '').trim(),
            scrollW: b.scrollWidth, clientW: b.clientWidth,
            scrollH: b.scrollHeight, clientH: b.clientHeight,
            maxW: getComputedStyle(b).maxWidth,
            overflow: getComputedStyle(lbl).textOverflow,
            h: br.height,
          };
        });
        const cats = [...document.querySelectorAll('.td-cat')].map(el => ({
          text: el.textContent.trim(),
          scrollW: el.scrollWidth, clientW: el.clientWidth,
          scrollH: el.scrollHeight, clientH: el.clientHeight,
          overflow: getComputedStyle(el).textOverflow,
          maxW: getComputedStyle(el).maxWidth,
        }));
        const picks = [...document.querySelectorAll('.cat-pick')].map(el => ({
          scrollW: el.scrollWidth, clientW: el.clientWidth,
          scrollH: el.scrollHeight, clientH: el.clientHeight,
          maxW: getComputedStyle(el).maxWidth,
        }));
        const qa = document.querySelector('#qaCat');
        const qaInfo = qa ? { scrollW: qa.scrollWidth, clientW: qa.clientWidth, maxW: getComputedStyle(qa).maxWidth } : null;
        return { chips, cats, picks, qaInfo, chipLabels: chips.map(c => c.text) };
      });
      assert(info.chipLabels.includes('All') && info.chipLabels.includes('Inbox'), `${tag}: All/Inbox chips`);
      assert(info.chips.length >= 4, `${tag}: several filter chips`);
      for (const c of info.chips) {
        assert(c.scrollW <= c.clientW + 1, `${tag}: chip "${c.text}" width fits (${c.scrollW}/${c.clientW})`);
        assert(c.scrollH <= c.clientH + 2, `${tag}: chip "${c.text}" height fits (${c.scrollH}/${c.clientH})`);
        assert(c.h >= 24 && c.h <= 36, `${tag}: chip height sane (${c.h})`);
      }
      // Long calendar short should truncate
      const longChip = info.chips.find(c => /Supercali|Life Time/.test(c.text));
      if (longChip) assert(longChip.overflow === 'ellipsis' || longChip.scrollW <= longChip.clientW + 1, `${tag}: long chip ellipsis`);
      for (const c of info.cats) {
        // ellipsis means scrollWidth may exceed clientWidth; the visible box must be capped
        assert(c.overflow === 'ellipsis', `${tag}: td-cat ellipsis`);
        assert(c.clientW > 0 && c.clientW <= 140, `${tag}: td-cat "${c.text}" capped (${c.clientW})`);
        assert(c.scrollH <= c.clientH + 2, `${tag}: td-cat "${c.text}" single-line height`);
      }
      for (const c of info.picks) {
        assert(c.clientW > 0 && c.clientW <= 120, `${tag}: cat-pick capped (${c.clientW})`);
        assert(c.scrollH <= c.clientH + 2, `${tag}: cat-pick height fits`);
      }
      if (info.qaInfo) assert(info.qaInfo.clientW <= 200, `${tag}: qaCat capped (${info.qaInfo.clientW})`);
      await p.screenshot({ path: `${SHOTS}/${tag}_filters.png` });
      // Open sheet to show category chip
      await p.click('#todoFab');
      await p.waitForSelector('#qsText');
      await p.waitForTimeout(200);
      await p.screenshot({ path: `${SHOTS}/${tag}_sheet_chips.png` });
      await p.evaluate(() => { const b = document.querySelector('.qs-backdrop'); if (b) b.click(); });
      await ctx.close();
    }
  }

  await b.close();
  console.log(`TODO CHIPS FIT PASSED (${n} checks)`);
})().catch(e => { console.error(e); process.exit(1); });
