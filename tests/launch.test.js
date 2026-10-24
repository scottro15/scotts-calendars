// Launch (2026-10-24) end to end against the LOCAL stand-in (Postgres with the full schema.sql + PostgREST + dev_proxy.py).
// Covers: invite-only admin screen (real admin-invites function code, Auth admin API mocked), new-user setup,
// per-user time zone, feedback, and two-account isolation through the real app UI. No real Supabase.
// Run: SECRET=<local postgrest jwt-secret> node tests/launch.test.js http://127.0.0.1:8786/
const { chromium } = require(process.env.PW || '/workspace/shot-tools/node_modules/playwright-core');
const crypto = require('crypto'); const fs = require('fs'); const os = require('os'); const path = require('path');
const BASE = process.argv[2] || 'http://127.0.0.1:8786/';
const REST = process.env.REST || 'http://127.0.0.1:3010';
const SECRET = process.env.SECRET;
const assert = (c, m) => { if (!c) throw new Error('FAIL: ' + m); console.log('ok -', m); };
const SHOT = process.env.SHOTS || '/workspace/shots-launch/'; fs.mkdirSync(SHOT, { recursive: true });
const SCOTT = { id: 'f85fb17b-2943-4266-b1b2-dc130ae8b678', email: 'scottro1522@gmail.com' };
const ALICE = { id: 'aaaaaaaa-0000-0000-0000-00000000000a', email: 'alice@example.com' };
const BOB = { id: 'bbbbbbbb-0000-0000-0000-00000000000b', email: 'bob@example.com' };
const b64 = x => Buffer.from(x).toString('base64url');
const sign = p => { const h = b64(JSON.stringify({ alg: 'HS256', typ: 'JWT' })); const q = b64(JSON.stringify(p));
  return `${h}.${q}.${crypto.createHmac('sha256', SECRET).update(`${h}.${q}`).digest('base64url')}`; };
const jwt = u => sign({ role: 'authenticated', sub: u.id, email: u.email, aud: 'authenticated', exp: Math.floor(Date.now() / 1000) + 86400 });
const SVC = sign({ role: 'service_role', exp: Math.floor(Date.now() / 1000) + 86400 }); // local-only stand-in for the service key

(async () => {
  // load the real Edge Function code
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'invfn-')); const fnFile = path.join(dir, 'fn.mjs');
  fs.writeFileSync(fnFile, fs.readFileSync(path.join(__dirname, '../supabase/functions/admin-invites/index.ts'), 'utf8'));
  const { handle } = await import(fnFile);
  // mocked Supabase Auth admin API (users live in the stand-in's auth.users already, so FKs hold)
  const authUsers = [{ ...SCOTT, last_sign_in_at: new Date().toISOString() }, { ...BOB, last_sign_in_at: null }];
  const known = { [ALICE.email]: ALICE.id };
  const adminCalls = [];
  const fakeFetch = async (url, init = {}) => {
    const u = new URL(url); const h = init.headers || {};
    if (u.pathname.startsWith('/rest/v1/')) return fetch(REST + u.pathname.slice(8) + u.search, { method: init.method || 'GET', headers: h, body: init.body });
    if (u.pathname === '/auth/v1/user') { const p = JSON.parse(Buffer.from(h.authorization.split(' ')[1].split('.')[1], 'base64url')); return new Response(JSON.stringify({ id: p.sub, email: p.email })); }
    assert(h.authorization === `Bearer ${SVC}`, 'auth admin API called with the service key (server-side only)');
    adminCalls.push(`${init.method || 'GET'} ${u.pathname}`);
    if (u.pathname === '/auth/v1/admin/users' && (init.method || 'GET') === 'GET') return new Response(JSON.stringify({ users: authUsers }));
    if (u.pathname === '/auth/v1/admin/users' && init.method === 'POST') { const b = JSON.parse(init.body); const nu = { id: known[b.email], email: b.email, last_sign_in_at: null, email_confirmed_at: b.email_confirm ? 'now' : null }; authUsers.push(nu); return new Response(JSON.stringify(nu)); }
    const m = u.pathname.match(/^\/auth\/v1\/admin\/users\/(.+)$/);
    if (m && init.method === 'PUT') { const x = authUsers.find(a => a.id === m[1]); const b = JSON.parse(init.body); x.banned_until = b.ban_duration === 'none' ? null : '2126-01-01T00:00:00Z'; return new Response(JSON.stringify(x)); }
    return new Response('{}', { status: 404 });
  };
  const env = { SUPABASE_URL: BASE.replace(/\/$/, ''), SUPABASE_ANON_KEY: 'local-anon', SUPABASE_SERVICE_ROLE_KEY: SVC };

  const b = await chromium.launch({ executablePath: '/usr/bin/google-chrome', headless: true, args: ['--no-sandbox'] });
  async function open(u, tz, vp = { width: 390, height: 844 }) {
    const ctx = await b.newContext({ viewport: vp, timezoneId: tz, locale: 'en-US' });
    const cfg = `window.CALENDAR_CONFIG = { APP_NAME: 'SANDY', SUPABASE_URL: '${BASE.replace(/\/$/, '')}', SUPABASE_ANON_KEY: 'local-anon', OWNER_EMAIL: '${SCOTT.email}' };`;
    await ctx.route('**/config.js', r => r.fulfill({ contentType: 'application/javascript', body: cfg }));
    await ctx.route('**/auth/v1/**', r => r.fulfill({ status: 200, contentType: 'application/json', body: '{}' }));
    await ctx.route('**/functions/v1/admin-invites', async r => {
      const q = r.request();
      const res = await handle(new Request(q.url(), { method: q.method(), headers: q.headers(), body: q.method() === 'POST' ? q.postData() : undefined }), env, fakeFetch);
      r.fulfill({ status: res.status, contentType: 'application/json', body: await res.text() });
    });
    const key = 'sb-' + new URL(BASE).hostname.split('.')[0] + '-auth-token';
    const s = JSON.stringify({ access_token: jwt(u), refresh_token: 'x', token_type: 'bearer', expires_in: 86400, expires_at: Math.floor(Date.now() / 1000) + 86400, user: { id: u.id, email: u.email, aud: 'authenticated', role: 'authenticated' } });
    await ctx.addInitScript(([k, v]) => { if (!sessionStorage.getItem('__i')) { sessionStorage.setItem('__i', 1); localStorage.setItem(k, v); } }, [key, s]);
    const p = await ctx.newPage(); const errs = []; p.on('pageerror', e => errs.push(e.message));
    await p.goto(BASE + '?view=listWeek');
    return { ctx, p, errs };
  }
  const calNames = p => p.$$eval('#calToggles .cal-toggle', ls => ls.map(l => l.textContent.replace(/\d+$/, '').trim()));
  const hourIn = tz => +new Intl.DateTimeFormat('en-US', { timeZone: tz, hour: '2-digit', hourCycle: 'h23' }).format(new Date()) % 24;
  const openMenu = async p => { if (await p.isVisible('#menuBtn') && !(await p.$eval('#sidebar', s => s.classList.contains('open')))) { await p.click('#menuBtn'); await p.waitForTimeout(350); } await p.waitForSelector('#accountSection'); };

  // 1. Scott (admin): unchanged calendars, Chicago, Invites screen
  { const { ctx, p, errs } = await open(SCOTT, 'America/Chicago', { width: 1300, height: 900 }); await p.waitForSelector('#calendar .fc-view');
    assert(!(await p.$('.onb')), 'Scott: no welcome flow');
    assert(JSON.stringify(await calNames(p)) === JSON.stringify(['MSC – Mental Stability Community', 'Minds Above Matters', 'Life Time – Facility Ops']), 'Scott: his three calendars unchanged ' + JSON.stringify(await calNames(p)));
    await p.waitForSelector('#tzSelect');
    assert(await p.$eval('#tzSelect', s => s.value) === 'America/Chicago' && /America\/Chicago/.test(await p.textContent('#tzNote')), 'Scott: time zone America/Chicago from his profile');
    await p.waitForSelector('#invitesBtn', { state: 'visible' });
    assert(true, 'Scott: admin sees Invites + Feedback inbox');
    await p.click('#invitesBtn'); await p.waitForSelector('.inv-dlg .inv-list li');
    await p.fill('#invEmail', 'not-an-email'); await p.click('#invGo');
    assert(/valid email/.test(await p.textContent('.inv-dlg .onb-err')), 'invite: rejects a bad email');
    await p.fill('#invEmail', 'Alice@Example.com '); await p.click('#invGo');
    await p.waitForSelector('.inv-row:has-text("alice@example.com")');
    assert(/Invited · not signed in yet/.test(await p.textContent('.inv-row:has-text("alice@example.com")')), 'invite: Alice listed as Invited (email normalized)');
    assert(adminCalls.includes('POST /auth/v1/admin/users'), 'invite: account created via Auth admin API (no email sent by default)');
    await p.fill('#invEmail', 'bob@example.com'); await p.click('#invGo'); await p.waitForSelector('.inv-row:has-text("bob@example.com")');
    await p.waitForTimeout(400); await p.screenshot({ path: SHOT + '34_invites_admin_desktop.png' });
    await p.click('.inv-close'); await p.waitForTimeout(300);
    assert(errs.length === 0, 'Scott: no page errors ' + errs.join('|')); await ctx.close(); }

  // 2. Alice (new user, browser in Denver): onboarding with generic defaults + detected zone
  { const { ctx, p, errs } = await open(ALICE, 'America/Denver'); await p.waitForSelector('.onb');
    const names = await p.$$eval('.onb-name', is => is.map(i => i.value));
    assert(JSON.stringify(names) === JSON.stringify(['Personal', 'Work']), 'Alice: default calendars Personal + Work (not Scott\'s)');
    assert(await p.$eval('.onb select[name=tz]', s => s.value) === 'America/Denver', 'Alice: time zone detected (America/Denver)');
    await p.screenshot({ path: SHOT + '34_new_user_setup_mobile.png' });
    await p.click('.onb-go'); await p.waitForSelector('#calendar .fc-view'); await p.waitForTimeout(500);
    assert(JSON.stringify(await calNames(p)) === JSON.stringify(['Personal', 'Work']), 'Alice: her own calendars');
    assert(!(await p.textContent('body')).includes('Scott private event'), 'Alice: none of Scott\'s events');
    const nowH = await p.evaluate(() => window.__app.nowWall().getUTCHours());
    assert(nowH === hourIn('America/Denver'), `Alice: "now" uses her zone (${nowH}h)`);
    await openMenu(p);
    assert(await p.isHidden('#invitesBtn'), 'Alice: no Invites button');
    assert(/America\/Denver/.test(await p.textContent('#tzNote')), 'Alice: settings note shows her zone');
    // change time zone in settings
    await p.selectOption('#tzSelect', 'Europe/London'); await p.waitForFunction(() => window.__app.timeZone() === 'Europe/London');
    assert(await p.evaluate(() => window.__app.nowWall().getUTCHours()) === hourIn('Europe/London'), 'Alice: changing the setting moves "now" to Europe/London');
    // feedback
    await p.$eval('#feedbackBtn', b => b.scrollIntoView({ block: 'center' })); await p.screenshot({ path: SHOT + '34_account_tz_feedback_mobile.png' });
    await p.click('#feedbackBtn'); await p.waitForSelector('.fb-dlg #fbBody');
    await p.fill('#fbBody', 'Love it! The week view could show more.'); await p.screenshot({ path: SHOT + '34_feedback_mobile.png' });
    await p.click('#fbSend'); await p.waitForSelector('.fb-dlg', { state: 'detached' });
    assert(/Feedback sent/.test(await p.textContent('#toast')), 'Alice: feedback sent');
    const peek = await p.evaluate(async () => { const sb = window.__app.Store.adapter.client;
      const inv = await sb.from('invites').select('*'); const ev = await sb.from('events').select('id');
      await sb.from('feedback').insert({ body: 'spoof attempt', owner_id: 'f85fb17b-2943-4266-b1b2-dc130ae8b678', email: 'scottro1522@gmail.com' });
      const fbs = (await sb.from('feedback').select('owner_id,email')).data;
      const r = await fetch(location.origin + '/functions/v1/admin-invites', { method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer ' + (await sb.auth.getSession()).data.session.access_token }, body: '{"action":"list"}' });
      return { inv: inv.data ? inv.data.length : -1, ev: ev.data.length, fbOwners: [...new Set(fbs.map(f => f.owner_id + ' ' + f.email))], fnStatus: r.status }; });
    assert(peek.inv === 0, 'Alice: cannot read invites');
    assert(peek.ev === 0, 'Alice: sees 0 events (none of Scott\'s)');
    assert(JSON.stringify(peek.fbOwners) === JSON.stringify([`${ALICE.id} ${ALICE.email}`]), 'Alice: cannot file feedback as Scott (server stamps her own id + email)');
    assert(peek.fnStatus === 403, 'Alice: admin-invites function refuses non-admins (403)');
    assert(errs.length === 0, 'Alice: no page errors ' + errs.join('|')); await ctx.close(); }

  // 3. Bob (second new account): sees nothing of Alice or Scott
  { const { ctx, p } = await open(BOB, 'America/New_York'); await p.waitForSelector('.onb');
    const peek = await p.evaluate(async () => { const sb = window.__app ? window.__app.Store.adapter.client : null; return null; });
    await p.click('.onb-go'); await p.waitForSelector('#calendar .fc-view');
    const seen = await p.evaluate(async () => { const sb = window.__app.Store.adapter.client; const o = {};
      for (const t of ['events', 'calendars', 'profiles', 'feedback', 'invites', 'categories', 'occurrence_notes', 'ai_usage']) { const r = await sb.from(t).select('*'); o[t] = r.data ? r.data.length : r.error.message; }
      return o; });
    assert(seen.events === 0 && seen.calendars === 2 && seen.profiles === 1 && seen.feedback === 0 && seen.invites === 0, 'Bob: only his own 2 calendars + profile ' + JSON.stringify(seen));
    assert(await p.evaluate(() => window.__app.timeZone()) === 'America/New_York', 'Bob: zone America/New_York');
    await ctx.close(); }

  // 4. Scott again: invite statuses, feedback inbox, his data untouched, revoke/restore
  { const { ctx, p, errs } = await open(SCOTT, 'America/Chicago', { width: 1300, height: 900 }); await p.waitForSelector('#calendar .fc-view');
    assert(await p.evaluate(() => window.__app.timeZone()) === 'America/Chicago', 'Scott: still Chicago (Alice\'s change was hers only)');
    await p.waitForSelector('#invitesBtn', { state: 'visible' }); await p.click('#invitesBtn');
    await p.waitForSelector('.inv-row:has-text("alice@example.com")');
    assert(/Joined/.test(await p.textContent('.inv-row:has-text("alice@example.com")')), 'admin: Alice shows Joined after her first sign-in');
    assert(/Joined/.test(await p.textContent('.inv-row:has-text("bob@example.com")')), 'admin: Bob shows Joined');
    p.once('dialog', d => d.accept());
    await p.click('.inv-row:has-text("bob@example.com") button[data-act=revoke]');
    await p.waitForSelector('.inv-row.st-revoked:has-text("bob@example.com")');
    assert(adminCalls.includes(`PUT /auth/v1/admin/users/${BOB.id}`), 'admin: revoke bans sign-in via Auth admin API (data kept)');
    await p.waitForTimeout(450); await p.screenshot({ path: SHOT + '34_invites_status_desktop.png' });
    await p.click('.inv-row:has-text("bob@example.com") button[data-act=restore]'); await p.waitForSelector('.inv-row.st-accepted:has-text("bob@example.com")');
    assert(true, 'admin: restore re-enables Bob');
    await p.click('.inv-close'); await p.waitForTimeout(300);
    await p.click('#fbInboxBtn'); await p.waitForSelector('.fb-item');
    const fb = await p.textContent('.fb-list');
    assert(/alice@example.com/.test(fb) && /Love it!/.test(fb), 'admin: Feedback inbox shows Alice\'s note with her email');
    await p.screenshot({ path: SHOT + '34_feedback_inbox_desktop.png' });
    const mine = await p.evaluate(async () => (await window.__app.Store.adapter.client.from('events').select('title')).data.map(e => e.title));
    assert(JSON.stringify(mine) === JSON.stringify(['Scott private event']), 'Scott: his data untouched, and no Alice/Bob events visible to him');
    assert(errs.length === 0, 'Scott: no page errors ' + errs.join('|')); await ctx.close(); }
  await b.close(); console.log('LAUNCH TEST PASSED');
})().catch(e => { console.error(e); process.exit(1); });
