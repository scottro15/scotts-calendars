// Todoist-style To-Do rows (title > desc > meta) + quick-sheet hierarchy.
const { chromium } = require(process.env.PW || '/usr/local/lib/pnpm/5/.pnpm/playwright-core@1.59.1/node_modules/playwright-core');
const fs = require('fs');
const { execSync } = require('child_process');
const BASE = process.argv[2] || 'http://127.0.0.1:8780/';
const SHOTS = process.env.TODOIST_SHOTS || '/workspace/shots-todo-todoist';
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
    await p.waitForFunction(() => window.__app && window.SandyQuickSheet && window.SandyNav);
    await p.click('#bottomNav [data-tab=todo]');
    await p.waitForSelector('#todoFab');
    return { ctx, p };
  }

  async function seed(p) {
    return p.evaluate(async () => {
      const a = __app;
      const ymd = a.ymd(a.nowWall());
      const ids = [];
      for (const s of [
        { raw: 'Buy groceries', description: 'Milk, eggs, and the good bread from the corner bakery if they still have it.', priority: 1, date: ymd },
        { raw: 'Send weekly report', description: 'Include Q3 numbers', priority: 2, date: ymd },
        { raw: 'Water plants', description: '', priority: 3, date: ymd },
        { raw: 'Call dentist', description: 'Ask about cleaning next month', priority: null, date: ymd },
      ]) {
        const r = await SandyNav.saveQuick({ kind: 'todo', ...s });
        ids.push(r.ev && r.ev.id);
      }
      await SandyNav.saveQuick({ raw: 'Pack snacks', kind: 'todo', description: 'Fruit leather + water bottles', priority: 1 });
      await SandyNav.renderTodo();
      return ids;
    });
  }

  {
    const { ctx, p } = await open(false, 390);
    await seed(p);
    await p.waitForSelector('.todo-row .td-desc', { timeout: 5000 });
    const styles = await p.evaluate(() => {
      const title = document.querySelector('.td-title');
      const desc = document.querySelector('.td-desc');
      const check = document.querySelector('.td-check');
      const ts = getComputedStyle(title); const ds = getComputedStyle(desc); const cs = getComputedStyle(check);
      return {
        titleFs: parseFloat(ts.fontSize), titleFw: ts.fontWeight,
        descFs: parseFloat(ds.fontSize),
        descClamp: ds.webkitLineClamp || ds.lineClamp,
        checkRadius: cs.borderRadius,
        titles: [...document.querySelectorAll('.td-title')].map(e => e.textContent.trim()),
        descs: [...document.querySelectorAll('.td-desc')].map(e => e.textContent.trim()),
      };
    });
    assert(styles.titleFs >= 15 && styles.titleFs <= 16.5, `title ~15–16px (got ${styles.titleFs})`);
    assert(+styles.titleFw <= 500, `title normal weight (got ${styles.titleFw})`);
    assert(styles.descFs >= 12 && styles.descFs <= 14, `desc ~13px (got ${styles.descFs})`);
    assert(String(styles.descClamp) === '2', `desc clamped to 2 (got ${styles.descClamp})`);
    assert(styles.checkRadius.includes('50%') || parseFloat(styles.checkRadius) >= 10, 'round checkbox');
    assert(styles.titles.includes('Buy groceries'), 'task title is name');
    assert(styles.titles.includes('Pack snacks'), 'inbox title is first line');
    assert(styles.descs.some(d => /Milk/.test(d)), 'description shown under title');
    assert(styles.descs.some(d => /Fruit leather/.test(d)), 'inbox description is rest of body');
    const p1 = await p.evaluate(() => {
      const row = [...document.querySelectorAll('.todo-row')].find(r => r.querySelector('.td-title')?.textContent.includes('Buy groceries'));
      return getComputedStyle(row.querySelector('.td-check')).borderTopColor;
    });
    assert(/209|d1453b/i.test(p1), `P1 check red (got ${p1})`);
    // Meta sits below desc in DOM order
    const order = await p.evaluate(() => {
      const main = document.querySelector('.todo-row .td-main');
      return [...main.children].map(c => c.className);
    });
    assert(order[0].includes('td-title') && order.includes('td-desc') && order[order.length - 1].includes('td-meta'), `DOM order title>desc>meta (${order})`);
    await ctx.close();
  }

  for (const dark of [false, true]) {
    for (const w of [320, 390, 430]) {
      const tag = `${dark ? 'dark' : 'light'}_${w}`;
      const { ctx, p } = await open(dark, w);
      await seed(p);
      await p.waitForSelector('.todo-row .td-desc');
      await p.waitForTimeout(250);
      await p.screenshot({ path: `${SHOTS}/${tag}_list.png` });

      await p.click('#todoFab');
      await p.waitForSelector('#qsText');
      await p.waitForTimeout(200);
      const sheet = await p.evaluate(() => {
        const t = getComputedStyle(document.querySelector('#qsText'));
        const d = getComputedStyle(document.querySelector('#qsDesc'));
        return {
          titleFs: parseFloat(t.fontSize), titleFw: t.fontWeight,
          descFs: parseFloat(d.fontSize),
          tPh: document.querySelector('#qsText').placeholder,
          dPh: document.querySelector('#qsDesc').placeholder,
          jot: !!document.querySelector('#qaText'),
        };
      });
      assert(sheet.titleFs >= 19, `${tag}: qs title >= 19px (got ${sheet.titleFs})`);
      assert(+sheet.titleFw >= 600, `${tag}: qs title boldish`);
      assert(sheet.descFs >= 16, `${tag}: qs desc >= 16px (got ${sheet.descFs})`);
      assert(sheet.titleFs > sheet.descFs, `${tag}: title > desc`);
      assert(sheet.tPh === 'Task name' && sheet.dPh === 'Description', `${tag}: placeholders`);
      assert(sheet.jot, `${tag}: jot present`);
      await p.screenshot({ path: `${SHOTS}/${tag}_sheet.png` });

      await p.evaluate(() => { const b = document.querySelector('.qs-backdrop'); if (b) b.click(); });
      await p.waitForTimeout(150);
      await p.fill('#qaText', 'meeting next Friday at 3pm');
      const parsed = await p.evaluate(() => SandyParse.parse(document.querySelector('#qaText').value));
      assert(parsed && (parsed.date || parsed.title), `${tag}: NL jot parse`);
      await ctx.close();
    }
  }

  const ref = `${SHOTS}/todoist-ref-crop.png`;
  if (fs.existsSync(ref)) {
    const { ctx, p } = await open(false, 390);
    await seed(p);
    await p.waitForSelector('.todo-row .td-desc');
    await p.screenshot({ path: `${SHOTS}/light_390_list_for_side.png` });
    await ctx.close();
    execSync(`python3 - <<'PY'
from PIL import Image, ImageDraw
ref = Image.open('${ref}').convert('RGB')
ours = Image.open('${SHOTS}/light_390_list_for_side.png').convert('RGB')
h = ours.height
rw = max(1, int(ref.width * h / ref.height))
ref = ref.resize((rw, h), Image.LANCZOS)
gap = 24
out = Image.new('RGB', (ref.width + gap + ours.width, h + 48), (248, 250, 252))
d = ImageDraw.Draw(out)
d.text((12, 12), 'Todoist reference', fill=(55,65,81))
d.text((ref.width + gap + 12, 12), 'SANDY To-Do', fill=(55,65,81))
out.paste(ref, (0, 40))
out.paste(ours, (ref.width + gap, 40))
out.save('${SHOTS}/side_by_side_todoist.png')
print('side-by-side', out.size)
PY`)
    assert(fs.existsSync(`${SHOTS}/side_by_side_todoist.png`), 'side-by-side exists');
  }

  await b.close();
  console.log(`TODOIST LOOK PASSED (${n} checks)`);
})().catch(e => { console.error(e); process.exit(1); });
