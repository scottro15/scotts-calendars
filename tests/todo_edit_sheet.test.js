// To-Do edit: tapping a row opens the quick-add sheet in edit mode with create options.
//   node tests/todo_edit_sheet.test.js http://127.0.0.1:8780/ /workspace/shots-fix-todo-edit
const { chromium } = require(process.env.PW || '/usr/local/lib/pnpm/5/.pnpm/playwright-core@1.59.1/node_modules/playwright-core');
const fs = require('fs');
const BASE = process.argv[2] || 'http://127.0.0.1:8780/';
const SHOTS = process.argv[3] || '/workspace/shots-fix-todo-edit';
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
    await p.goto(BASE);
    await p.waitForFunction(() => window.__app && window.SandyQuickSheet && window.SandyNav);
    await p.click('#bottomNav [data-tab=todo]');
    await p.waitForSelector('#todoList .todo-row, #todoFab');
    return { ctx, p };
  }

  // Seed a dated to-do via saveQuick
  async function seed(p) {
    return p.evaluate(async () => {
      const r = await SandyNav.saveQuick({
        raw: 'Edit-me grocery run tomorrow 5pm p2',
        kind: 'todo',
        priority: 2,
        reminders: [30],
        description: 'Milk and eggs',
        date: (() => { const a = __app; const t = a.ymd(a.nowWall()); const d = new Date(t + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + 1); return d.toISOString().slice(0, 10); })(),
        time: '17:00',
      });
      await SandyNav.renderTodo();
      return r.ev.id;
    });
  }

  // --- 1. Tap opens edit sheet with create options (light) ---
  {
    const { ctx, p } = await open(false);
    const id = await seed(p);
    await p.waitForSelector(`[data-ev="${id}"] .td-title`);
    await p.click(`[data-ev="${id}"] .td-title`);
    await p.waitForFunction(() => SandyQuickSheet.isOpen && SandyQuickSheet.editing);
    ok(await p.locator('#qsSheet').isVisible(), 'edit sheet open');
    ok(await p.locator('#qsSheet').evaluate(el => el.classList.contains('qs-editing')), 'qs-editing class');
    const title = await p.locator('#qsText').inputValue();
    ok(/Edit-me grocery/i.test(title), `title prefilled: ${title}`);
    ok((await p.locator('#qsDesc').inputValue()).includes('Milk'), 'description prefilled');
    ok(await p.locator('#qsDateChip').isVisible(), 'date chip');
    ok(await p.locator('#qsPriChip').isVisible(), 'priority chip');
    ok(await p.locator('#qsCatChip').isVisible(), 'category chip');
    ok(await p.locator('#qsRemChip').isVisible(), 'reminders chip');
    ok(await p.locator('#qsDelete').isVisible(), 'Delete button');
    ok(await p.locator('#qsSend').innerText().then(t => /Save/i.test(t)), 'Save button');
    // New category option present
    const hasNew = await p.locator('#qsCat option[value="__new__"]').count();
    ok(hasNew === 1, '+ New category option');
    await p.waitForTimeout(200);
    await p.screenshot({ path: `${SHOTS}/01-edit-sheet-light.png` });
    await ctx.close();
  }

  // --- 2. Dark mode shot ---
  {
    const { ctx, p } = await open(true);
    const id = await seed(p);
    await p.click(`[data-ev="${id}"] .td-title`);
    await p.waitForFunction(() => SandyQuickSheet.editing);
    await p.waitForTimeout(200);
    await p.screenshot({ path: `${SHOTS}/02-edit-sheet-dark.png` });
    ok(await p.locator('#qsSheet.qs-editing').isVisible(), 'dark: edit sheet');
    await ctx.close();
  }

  // --- 3. Save persists title/priority/reminder changes ---
  {
    const { ctx, p } = await open(false);
    const id = await seed(p);
    await p.click(`[data-ev="${id}"] .td-title`);
    await p.waitForFunction(() => SandyQuickSheet.editing);
    await p.fill('#qsText', 'Edited grocery run');
    await p.fill('#qsDesc', 'Bread too');
    await p.selectOption('#qsPri', '1');
    await p.selectOption('#qsRem', '60');
    await p.click('#qsSend');
    await p.waitForFunction(() => !SandyQuickSheet.isOpen);
    const saved = await p.evaluate(async id => {
      const ev = await __app.Store.get(id);
      return { title: ev.title, notes: ev.notes, priority: ev.priority, reminders: ev.reminders };
    }, id);
    ok(saved.title === 'Edited grocery run', `saved title: ${saved.title}`);
    ok(saved.notes === 'Bread too', `saved notes: ${saved.notes}`);
    ok(saved.priority === 1, `saved priority: ${saved.priority}`);
    ok(Array.isArray(saved.reminders) && saved.reminders.includes(60), `saved reminders: ${JSON.stringify(saved.reminders)}`);
    await p.screenshot({ path: `${SHOTS}/03-after-save-light.png` });
    await ctx.close();
  }

  // --- 4. Inbox jot opens edit sheet; schedule with date ---
  {
    const { ctx, p } = await open(false);
    const iid = await p.evaluate(async () => {
      const r = await SandyNav.saveQuick({ raw: 'Inbox jot edit', kind: 'todo', description: 'from inbox' });
      await SandyNav.renderTodo();
      return r.item.id;
    });
    await p.click(`[data-inbox="${iid}"] .td-title`);
    await p.waitForFunction(() => SandyQuickSheet.editing);
    ok((await p.locator('#qsText').inputValue()) === 'Inbox jot edit', 'inbox title');
    // Set today via date select
    await p.selectOption('#qsDate', { index: 1 }); // Today
    await p.click('#qsSend');
    await p.waitForFunction(() => !SandyQuickSheet.isOpen);
    const gone = await p.evaluate(id => !(SandyNav.Inbox.cache || []).some(x => x.id === id), iid);
    ok(gone, 'inbox item removed after scheduling');
    await p.screenshot({ path: `${SHOTS}/04-inbox-scheduled-light.png` });
    await ctx.close();
  }

  // --- 5. Delete ---
  {
    const { ctx, p } = await open(false);
    const id = await seed(p);
    await p.click(`[data-ev="${id}"] .td-title`);
    await p.waitForFunction(() => SandyQuickSheet.editing);
    p.once('dialog', d => d.accept());
    await p.click('#qsDelete');
    await p.waitForFunction(() => !SandyQuickSheet.isOpen);
    const missing = await p.evaluate(async id => !(await __app.Store.get(id)), id);
    ok(missing, 'deleted from store');
    await ctx.close();
  }

  // --- 6. Create path still works (regression) ---
  {
    const { ctx, p } = await open(false);
    await p.click('#todoFab');
    await p.waitForFunction(() => SandyQuickSheet.isOpen && !SandyQuickSheet.editing);
    ok(await p.locator('#qsDelete').isHidden(), 'create: no Delete');
    await p.fill('#qsText', 'Brand new task today');
    await p.selectOption('#qsDate', { index: 1 });
    await p.click('#qsSend');
    await p.waitForTimeout(500);
    ok(await p.evaluate(() => SandyQuickSheet.isOpen), 'create keeps sheet open');
    await p.screenshot({ path: `${SHOTS}/05-create-still-works-light.png` });
    await ctx.close();
  }

  console.log(`\n${n} checks passed`);
  await b.close();
})().catch(e => { console.error(e); process.exit(1); });
