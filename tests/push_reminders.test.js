// Reminders + notifications end to end against the LOCAL stand-in (Postgres with schema.sql incl. the push
// migration + PostgREST + dev_proxy.py). Covers: editor reminder rows (add/remove/max 6/units), saving to the DB,
// reopening, service worker registration + subscription saved via save_push_subscription, the SW showing a push,
// the post-save nudge, and the iPhone "Add to Home Screen" explainer. No real Supabase.
// Run: SECRET=<local postgrest jwt-secret> node tests/push_reminders.test.js http://127.0.0.1:8786/
const { chromium } = require(process.env.PW || '/workspace/shot-tools/node_modules/playwright-core');
const crypto = require('crypto'); const fs = require('fs');
const BASE = process.argv[2] || 'http://127.0.0.1:8786/';
const REST = process.env.REST || 'http://127.0.0.1:3010';
const SECRET = process.env.SECRET;
const assert = (c, m) => { if (!c) throw new Error('FAIL: ' + m); console.log('ok -', m); };
const SHOT = process.env.SHOTS || '/workspace/shots-push/'; fs.mkdirSync(SHOT, { recursive: true });
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
    // headless Chrome has no push service to talk to: stand in for the browser's PushManager (the real
    // encryption/VAPID path is covered by tests/send_reminders_function.test.mjs)
    await ctx.addInitScript(() => {
      if (!window.PushManager) return; let sub = null;
      const mk = key => ({ endpoint: 'https://fcm.googleapis.com/fcm/send/test-' + Math.random().toString(36).slice(2), options: { applicationServerKey: key },
        toJSON() { return { endpoint: this.endpoint, keys: { p256dh: 'B' + 'x'.repeat(86), auth: 'y'.repeat(22) } }; },
        async unsubscribe() { sub = null; return true; } });
      PushManager.prototype.getSubscription = async () => sub;
      PushManager.prototype.subscribe = async o => (sub = mk(o.applicationServerKey.buffer || o.applicationServerKey));
    });
    const p = await ctx.newPage(); const errs = []; p.on('pageerror', e => errs.push(e.message));
    await p.goto(BASE + '?view=listWeek');
    await p.waitForSelector('.onb, #calendar .fc-view', { timeout: 15000 });
    if (await p.$('.onb')) await p.click('.onb-go'); // first sign-in: accept the default calendars
    await p.waitForSelector('#calendar .fc-view'); await p.waitForFunction(() => window.__app && window.__app.Store);
    return { ctx, p, errs };
  }

  // ---------- desktop Chrome: editor + subscribe
  const { ctx, p, errs } = await open(ALICE, { vp: { width: 1280, height: 860 } });
  await p.waitForTimeout(1200);
  await p.evaluate(() => window.__app.openEditor(null, null, { title: 'Dentist', start: '2026-11-03T15:30', end: '2026-11-03T16:30' }));
  await p.waitForSelector('#eventDialog[open]');
  assert(await p.locator('#remList li').count() === 0 && await p.isVisible('#remAdd'), 'new item: no reminders, "+ Add reminder" shown');
  await p.fill('#eventDialog [name=title]', 'Dentist');
  for (let i = 0; i < 6; i++) await p.click('#remAdd');
  assert(await p.locator('#remList li').count() === 6 && await p.isHidden('#remAdd'), 'max 6 reminders: add button hides');
  await p.locator('#remList li .rem-del').nth(5).click(); await p.locator('#remList li .rem-del').nth(4).click(); await p.locator('#remList li .rem-del').nth(3).click();
  assert(await p.locator('#remList li').count() === 3 && await p.isVisible('#remAdd'), 'remove brings the add button back');
  // set: 30 minutes, 2 hours, 6 months
  const row = i => p.locator('#remList li').nth(i);
  await row(0).locator('input').fill('30'); await row(0).locator('select').selectOption('minutes');
  await row(1).locator('input').fill('2'); await row(1).locator('select').selectOption('hours');
  await row(2).locator('input').fill('6'); await row(2).locator('select').selectOption('months');
  await p.screenshot({ path: SHOT + 'editor-reminders.png' });
  await p.click('#eventDialog button[type=submit], #eventDialog #saveBtn');
  await p.waitForSelector('#eventDialog', { state: 'hidden' });
  await p.waitForTimeout(800);
  let rows = await rest('/events?title=eq.Dentist&select=id,reminders,owner_id');
  assert(rows.length === 1 && JSON.stringify(rows[0].reminders) === '[30,120,267840]' && rows[0].owner_id === ALICE.id, 'saved to DB as minutes: ' + JSON.stringify(rows[0] && rows[0].reminders));
  // nudge dialog offered once
  await p.waitForSelector('dialog.push-nudge[open]', { timeout: 4000 });
  assert(true, 'after saving with reminders: "Get a heads-up?" offer');
  await p.screenshot({ path: SHOT + 'nudge.png' });
  await p.click('dialog.push-nudge #nudgeGo');
  await p.waitForSelector('dialog.push-nudge', { state: 'detached', timeout: 10000 });
  let subs = await rest('/push_subscriptions?select=owner_id,endpoint,p256dh,auth');
  assert(subs.length === 1 && subs[0].owner_id === ALICE.id && /^https:\/\//.test(subs[0].endpoint) && subs[0].p256dh.length > 40, 'device subscribed and saved for the signed-in user');
  // reopen: rows come back with the right units
  await p.evaluate(id => window.__app.openEditor(id), rows[0].id); await p.waitForSelector('#eventDialog[open]');
  const back = await p.$$eval('#remList li', ls => ls.map(l => l.querySelector('input').value + ' ' + l.querySelector('select').value));
  assert(JSON.stringify(back) === '["30 minutes","2 hours","6 months"]', 'reopen shows reminders in friendly units: ' + back);
  // edit without change does not rewrite; change one
  await row(1).locator('.rem-del').click();
  await p.click('#eventDialog button[type=submit], #eventDialog #saveBtn'); await p.waitForSelector('#eventDialog', { state: 'hidden' }); await p.waitForTimeout(600);
  rows = await rest('/events?title=eq.Dentist&select=reminders');
  assert(JSON.stringify(rows[0].reminders) === '[30,267840]', 'removing a reminder saves');
  assert(await p.locator('dialog.push-nudge').count() === 0, 'nudge not shown again');
  // Account panel status + SW shows a push
  const st = await p.evaluate(() => window.SandyPush.state());
  assert(st === 'on', 'state: on');
  const statusText = await p.textContent('#pushBox .push-status');
  assert(/On for this device/.test(statusText), 'Account → Notifications shows "On for this device"');
  const shown = await p.evaluate(async () => {
    const reg = await navigator.serviceWorker.ready; await reg.showNotification('t', { tag: 'x' });
    return (await reg.getNotifications()).length;
  });
  assert(shown >= 1, 'service worker can show notifications');
  assert(errs.length === 0, 'no page errors: ' + errs.join(' | '));
  // turn off removes the server row
  await p.evaluate(() => window.SandyPush.disable());
  subs = await rest('/push_subscriptions?select=id');
  assert(subs.length === 0, 'turn off: subscription removed from the server');
  await ctx.close();

  // ---------- iPhone Safari (not on Home Screen): friendly explainer
  const IOS = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';
  const m = await open(ALICE, { ua: IOS, perms: false });
  await m.p.waitForTimeout(1000);
  assert(await m.p.evaluate(() => window.SandyPush.state()) === 'ios-install', 'iPhone Safari: needs Add to Home Screen');
  await m.p.evaluate(() => document.getElementById('pushEnable').click());
  await m.p.waitForSelector('dialog.push-install[open]');
  const txt = await m.p.textContent('dialog.push-install');
  assert(/Add to Home Screen/.test(txt) && /Enable notifications/.test(txt) && /iOS 16\.4/.test(txt), 'explainer lists the steps');
  await m.p.waitForTimeout(2500); await m.p.screenshot({ path: SHOT + 'ios-explainer.png' });
  assert(await m.p.textContent('#pushEnable') === 'How to enable on iPhone', 'iPhone button label');
  assert(m.errs.length === 0, 'no page errors (iPhone)');
  await m.ctx.close();
  await b.close();
  console.log('PUSH REMINDERS UI TESTS PASSED');
})().catch(e => { console.error(e); process.exit(1); });
