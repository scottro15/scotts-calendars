// Bottom-nav To-Do inbox + categories end to end against the LOCAL stand-in (Postgres with schema.sql incl. the push
// migration + PostgREST + dev_proxy.py). Covers quick-add jots saved to inbox_items, categories
// in todo_categories, a category on a dated to-do (events.todo_category_id), persistence after reload, search. No real Supabase.
// Run: SECRET=<local postgrest jwt-secret> node tests/nav_supabase.test.js http://127.0.0.1:8786/
const { chromium } = require(process.env.PW || '/workspace/shot-tools/node_modules/playwright-core');
const crypto = require('crypto'); const fs = require('fs');
const BASE = process.argv[2] || 'http://127.0.0.1:8786/';
const REST = process.env.REST || 'http://127.0.0.1:3010';
const SECRET = process.env.SECRET;
const assert = (c, m) => { if (!c) throw new Error('FAIL: ' + m); console.log('ok -', m); };
const SHOT = process.env.SHOTS || '/workspace/shots-nav/'; fs.mkdirSync(SHOT, { recursive: true });
const ALICE = { id: 'aaaaaaaa-0000-0000-0000-00000000000a', email: 'alice@example.com' };
const b64 = x => Buffer.from(x).toString('base64url');
const sign = p => { const h = b64(JSON.stringify({ alg: 'HS256', typ: 'JWT' })); const q = b64(JSON.stringify(p));
  return `${h}.${q}.${crypto.createHmac('sha256', SECRET).update(`${h}.${q}`).digest('base64url')}`; };
const jwt = u => sign({ role: 'authenticated', sub: u.id, email: u.email, aud: 'authenticated', exp: Math.floor(Date.now() / 1000) + 86400 });
const SVC = sign({ role: 'service_role', exp: Math.floor(Date.now() / 1000) + 86400 });
const rest = async (p) => (await fetch(REST + p, { headers: { authorization: `Bearer ${SVC}` } })).json();
const VAPID = 'BPaeiWhjWtYiwgVHbjz8CNHzP8VzQ3l6jqqq4pkWcOqFAOJk44AbKKXHWoWkBErDF8Q_VOppwI1nIwQO_2sPUIQ';

(async () => {
  const b = await chromium.launch({ executablePath: '/usr/bin/google-chrome', headless: true, args: ['--no-sandbox'] });
  async function open(u, { vp = { width: 390, height: 844 }, ua, perms = true } = {}) {
    const ctx = await b.newContext({ viewport: vp, timezoneId: 'America/Chicago', locale: 'en-US', userAgent: ua, serviceWorkers: 'allow' });
    await ctx.addInitScript(() => { try { localStorage.setItem('sandy.welcome.off', '1'); } catch (e) {} }); // beta welcome sheet: covered by tests/welcome.test.js
    if (perms) await ctx.grantPermissions(['notifications'], { origin: new URL(BASE).origin });
    const cfg = `window.CALENDAR_CONFIG = { APP_NAME: 'SANDY', SUPABASE_URL: '${BASE.replace(/\/$/, '')}', SUPABASE_ANON_KEY: 'local-anon', OWNER_EMAIL: 'scottro1522@gmail.com', VAPID_PUBLIC_KEY: '${VAPID}' };`;
    await ctx.route('**/config.js', r => r.fulfill({ contentType: 'application/javascript', body: cfg }));
    await ctx.route('**/auth/v1/**', r => r.fulfill({ status: 200, contentType: 'application/json', body: '{}' }));
    const key = 'sb-' + new URL(BASE).hostname.split('.')[0] + '-auth-token';
    const s = JSON.stringify({ access_token: jwt(u), refresh_token: 'x', token_type: 'bearer', expires_in: 86400, expires_at: Math.floor(Date.now() / 1000) + 86400, user: { id: u.id, email: u.email, aud: 'authenticated', role: 'authenticated' } });
    await ctx.addInitScript(([k, v]) => { if (!sessionStorage.getItem('__i')) { sessionStorage.setItem('__i', 1); localStorage.setItem(k, v); } }, [key, s]);
    const p = await ctx.newPage(); const errs = []; p.on('pageerror', e => errs.push(e.message));
    await p.goto(BASE);
    await p.waitForSelector('.onb, #calendar .fc-view', { timeout: 15000 });
    if (await p.$('.onb')) await p.click('.onb-go'); // first sign-in: accept the default calendars
    await p.waitForSelector('#calendar .fc-view'); await p.waitForFunction(() => window.__app && window.__app.Store && window.SandyNav);
    await p.goto(BASE + '?tab=todo'); await p.waitForFunction(() => window.__app && window.__app.user && window.__app.user() && window.SandyNav);
    return { ctx, p, errs };
  }
  const { ctx, p, errs } = await open(ALICE);
  await p.waitForTimeout(800);
  assert(await p.evaluate(() => window.SandyNav.tab) === 'todo', '?tab=todo opens the To-Do tab');
  assert(!(await p.isDisabled('#qaText')), 'quick add enabled (tables exist)');
  const body = 'Nav test jot ' + Date.now();
  await p.fill('#qaText', body); await p.press('#qaText', 'Enter'); await p.waitForTimeout(800);
  let rows = await rest(`/inbox_items?body=eq.${encodeURIComponent(body)}&select=*`);
  assert(rows.length === 1 && rows[0].owner_id === ALICE.id && rows[0].kind === 'todo' && !rows[0].calendar, 'jot saved to inbox_items with owner');
  await p.click('#todoCatsBtn'); const cname = 'Errands ' + Date.now() % 1000; await p.fill('#catName', cname); await p.click('#catAdd'); await p.waitForTimeout(600);
  await p.click('.cats-dlg button[value=done]'); await p.waitForTimeout(800);
  const cats = await rest(`/todo_categories?name=eq.${encodeURIComponent(cname)}&select=*`);
  assert(cats.length === 1 && cats[0].owner_id === ALICE.id, 'category saved to todo_categories');
  await p.locator('.todo-row', { hasText: body }).locator('.cat-pick').selectOption({ label: cname }); await p.waitForTimeout(800);
  rows = await rest(`/inbox_items?body=eq.${encodeURIComponent(body)}&select=*`);
  assert(rows[0].category_id === cats[0].id, 'category assigned to the jot');
  // dated to-do with a category
  const id = await p.evaluate(async () => { const a = window.__app; const id = crypto.randomUUID(); const t = a.ymd(a.nowWall());
    await a.Store.save({ id, kind: 'task', title: 'Nav dated todo', calendar: a.firstVisibleCal(), allDay: true, start: t, end: t, recurrence: { freq: 'none' }, location: '', notes: '' }); a.refresh(); return id; });
  await p.waitForTimeout(800);
  await p.locator('.todo-row', { hasText: 'Nav dated todo' }).locator('.cat-pick').selectOption({ label: cname }); await p.waitForTimeout(900);
  const ev = await rest(`/events?id=eq.${id}&select=todo_category_id,owner_id`);
  assert(ev[0].todo_category_id === cats[0].id, 'events.todo_category_id saved');
  await p.locator('.todo-row', { hasText: body }).locator('.td-check').click(); await p.waitForTimeout(800);
  rows = await rest(`/inbox_items?body=eq.${encodeURIComponent(body)}&select=done`);
  assert(rows[0].done === true, 'checking a jot saves done');
  await p.reload(); await p.waitForFunction(() => window.SandyNav && window.__app && window.__app.user()); await p.waitForTimeout(900);
  assert(await p.evaluate(() => window.SandyNav.tab) === 'todo', 'tab survives reload');
  await p.check('#todoShowDone'); await p.waitForTimeout(600);
  assert(await p.locator('.todo-row.done', { hasText: body }).count() === 1, 'done jot persisted');
  await p.uncheck('#todoShowDone');
  await p.click('#bottomNav [data-tab=search]'); await p.fill('#searchBox', 'nav dated'); await p.waitForTimeout(700);
  assert(/To-dos[\s\S]*Nav dated todo/.test(await p.textContent('#searchResults')), 'search finds it');
  await p.click('#bottomNav [data-tab=profile]'); await p.waitForTimeout(500);
  assert(await p.isVisible('#pfEmailBtn') && (await p.textContent('#pfEmail')).includes(ALICE.email), 'profile shows email + change email');
  assert(await p.isVisible('#accountSection') && await p.isVisible('#manageCalsBtn'), 'account + calendars management on Profile');
  await p.screenshot({ path: SHOT + '10_profile_signed_in_mobile.png' });
  assert(!errs.length, 'no page errors ' + errs.join(' | '));
  await ctx.close(); await b.close(); console.log('NAV SUPABASE TESTS PASSED');
})().catch(e => { console.error(e); process.exit(1); });
