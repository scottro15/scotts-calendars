// Multi-user step 2, end to end against a LOCAL stand-in (Postgres + PostgREST + dev_proxy.py); no real Supabase.
// PRE = DB without the step 2 migration (app must fall back to the built-in calendars),
// POST = DB after it (Scott unchanged; a new test user gets onboarding; isolation; export; delete).
// Run: SECRET=... node tests/step2_multiuser.test.js http://127.0.0.1:8771/ http://127.0.0.1:8772/
const { chromium } = require(process.env.PW || '/workspace/shot-tools/node_modules/playwright-core');
const crypto = require('crypto'); const fs = require('fs');
const [PRE, POST] = [process.argv[2] || 'http://127.0.0.1:8771/', process.argv[3] || 'http://127.0.0.1:8772/'];
const SECRET = process.env.SECRET;
const assert = (c, m) => { if (!c) throw new Error('FAIL: ' + m); console.log('ok -', m); };
const SHOT = __dirname + '/../screenshots/';
const SCOTT = { id: 'f85fb17b-2943-4266-b1b2-dc130ae8b678', email: 'scottro1522@gmail.com' };
const TESTER = { id: '22222222-2222-2222-2222-222222222222', email: 'tester@example.com' };
const b64 = x => Buffer.from(x).toString('base64url');
const jwt = u => { const h = b64(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const p = b64(JSON.stringify({ role: 'authenticated', sub: u.id, email: u.email, aud: 'authenticated', exp: Math.floor(Date.now() / 1000) + 86400 }));
  return `${h}.${p}.${crypto.createHmac('sha256', SECRET).update(`${h}.${p}`).digest('base64url')}`; };

async function open(b, base, u, vp = { width: 390, height: 844 }) {
  const ctx = await b.newContext({ viewport: vp, timezoneId: 'America/New_York', locale: 'en-US', acceptDownloads: true });
  const cfg = `window.CALENDAR_CONFIG = { APP_NAME: 'SANDY', SUPABASE_URL: '${base.replace(/\/$/, '')}', SUPABASE_ANON_KEY: 'local-anon', OWNER_EMAIL: '${SCOTT.email}' };`;
  await ctx.route('**/config.js', r => r.fulfill({ contentType: 'application/javascript', body: cfg }));
  await ctx.route('**/auth/v1/**', r => r.fulfill({ status: 200, contentType: 'application/json', body: '{}' }));
  const key = 'sb-' + new URL(base).hostname.split('.')[0] + '-auth-token';
  if (u) {
    const t = jwt(u);
    const s = JSON.stringify({ access_token: t, refresh_token: 'x', token_type: 'bearer', expires_in: 86400, expires_at: Math.floor(Date.now() / 1000) + 86400,
      user: { id: u.id, email: u.email, aud: 'authenticated', role: 'authenticated' } });
    await ctx.addInitScript(([k, v]) => { if (!sessionStorage.getItem('__i')) { sessionStorage.setItem('__i', 1); localStorage.setItem(k, v); } }, [key, s]);
  }
  const p = await ctx.newPage(); const errs = [];
  p.on('pageerror', e => errs.push(e.message));
  await p.goto(base + '?view=listWeek');
  return { ctx, p, errs };
}
const calNames = p => p.$$eval('#calToggles .cal-toggle', ls => ls.map(l => l.textContent.replace(/\d+$/, '').trim()));
const SCOTT_CALS = ['MSC – Mental Stability Community', 'Minds Above Matters', 'Life Time – Facility Ops'];

(async () => {
  const b = await chromium.launch({ executablePath: '/usr/bin/google-chrome', headless: true, args: ['--no-sandbox'] });
  // 0. sign-in gate links the legal pages
  { const { ctx, p } = await open(b, POST, null); await p.waitForSelector('#authGate:not([hidden])');
    assert(await p.isVisible('#authGate a[href="privacy.html"]') && await p.isVisible('#authGate a[href="terms.html"]'), 'sign-in screen links Privacy + Terms');
    await p.screenshot({ path: SHOT + '22_signin_legal_links_mobile.png' }); await ctx.close(); }
  // 1. before the migration: Scott sees his built-in three, no onboarding
  { const { ctx, p, errs } = await open(b, PRE, SCOTT); await p.waitForSelector('#calendar .fc-view');
    assert(!(await p.$('.onb')), 'pre-migration: no welcome flow');
    assert(JSON.stringify(await calNames(p)) === JSON.stringify(SCOTT_CALS), 'pre-migration: built-in calendars (fallback)');
    assert(errs.length === 0, 'pre-migration: no page errors ' + errs.join('|')); await ctx.close(); }
  // 2. after the migration: Scott identical, events still there, no onboarding, Account section
  { const { ctx, p, errs } = await open(b, POST, SCOTT, { width: 1300, height: 900 }); await p.waitForSelector('#calendar .fc-view');
    assert(!(await p.$('.onb')), 'post-migration: Scott gets no welcome flow');
    assert(JSON.stringify(await calNames(p)) === JSON.stringify(SCOTT_CALS), 'post-migration: Scott\'s calendars identical (from the table)');
    const colors = await p.$$eval('#calToggles .cal-toggle', ls => ls.map(l => l.style.getPropertyValue('--c')));
    assert(JSON.stringify(colors) === JSON.stringify(['#7c3aed', '#ea580c', '#0f766e']), 'same colors');
    const total = await p.$$eval('#calToggles .count', cs => cs.reduce((a, c) => a + +c.textContent, 0));
    assert(total > 0, `Scott's events load (${total} series)`);
    assert(await p.$('#accountSection'), 'Account section in the menu');
    await p.$eval('#accountSection', el => el.scrollIntoView());
    await p.screenshot({ path: SHOT + '22_scott_unchanged_account_desktop.png' });
    // delete dialog: Scott's account protected by exact email
    await p.click('#acctDelete'); await p.waitForSelector('dialog.acct-del[open]');
    assert(await p.isVisible('dialog.acct-del .warn'), 'main-account warning shown');
    await p.fill('#delEmail', 'ScottRo1522@gmail.com'); assert(await p.isDisabled('#delGo'), 'wrong-case email keeps Delete disabled');
    await p.fill('#delEmail', 'scottro1522@gmail.co'); assert(await p.isDisabled('#delGo'), 'partial email keeps Delete disabled');
    await p.waitForTimeout(600); await p.screenshot({ path: SHOT + '22_delete_protected_desktop.png' });
    await p.click('dialog.acct-del button[value=cancel]');
    assert(errs.length === 0, 'no page errors ' + errs.join('|')); await ctx.close(); }
  // 3. new test user: welcome flow -> 2 calendars + time zone
  { const { ctx, p, errs } = await open(b, POST, TESTER); await p.waitForSelector('.onb');
    const tz = await p.inputValue('.onb select[name=tz]'); assert(tz === 'America/New_York', 'time zone defaults to the browser (' + tz + ')');
    await p.screenshot({ path: SHOT + '22_welcome_mobile.png' });
    await p.fill('input[name=displayName]', 'Tess');
    const names = await p.$$('.onb-cal .onb-name'); await names[0].fill('Work'); await names[1].fill('Family');
    await p.click('.onb-add'); await (await p.$$('.onb-cal .onb-name'))[2].fill('Coaching');
    await p.$$eval('.onb-cal input[type=color]', (cs) => { cs[2].value = '#db2777'; });
    for (let i = 0; i < 2; i++) await p.click('.onb-add');
    assert((await p.$$('.onb-cal')).length === 5 && await p.isHidden('.onb-add'), 'max 5 calendars');
    await p.screenshot({ path: SHOT + '22_welcome_filled_mobile.png' });
    await p.click('.onb-go'); await p.waitForSelector('#calendar .fc-view'); await p.waitForSelector('.onb', { state: 'detached' });
    assert(JSON.stringify(await calNames(p)) === JSON.stringify(['Work', 'Family', 'Coaching']), 'tester has only their own 3 calendars (blank rows ignored)');
    const total = await p.$$eval('#calToggles .count', cs => cs.reduce((a, c) => a + +c.textContent, 0));
    assert(total === 0, 'isolation: tester sees none of Scott\'s events');
    assert(/Free plan/.test(await p.textContent('#planBadge')), 'plan shows Free');
    await p.screenshot({ path: SHOT + '22_tester_after_welcome_mobile.png' });
    // export (Profile tab)
    await p.click('#bottomNav [data-tab=profile]'); await p.waitForTimeout(400); await p.$eval('#accountSection', el => el.scrollIntoView());
    await p.screenshot({ path: SHOT + '22_account_menu_mobile.png' });
    const [dl] = await Promise.all([p.waitForEvent('download'), p.click('#acctExport')]);
    const data = JSON.parse(fs.readFileSync(await dl.path(), 'utf8'));
    assert(data.calendars.length === 3 && data.events.length === 0 && data.profiles.length === 1 && data.profiles[0].time_zone === 'America/New_York', 'export has only tester\'s rows');
    assert(errs.length === 0, 'no page errors ' + errs.join('|'));
    // delete account
    await p.click('#acctDelete'); await p.fill('#delEmail', TESTER.email);
    assert(!(await p.isDisabled('#delGo')), 'exact email enables Delete');
    await p.waitForTimeout(600); await p.screenshot({ path: SHOT + '22_delete_tester_mobile.png' });
    await Promise.all([p.waitForNavigation(), p.click('#delGo')]);
    await ctx.close(); }
  // 4. Scott still intact after the tester deleted their account
  { const { ctx, p } = await open(b, POST, SCOTT); await p.waitForSelector('#calendar .fc-view');
    assert(JSON.stringify(await calNames(p)) === JSON.stringify(SCOTT_CALS), 'Scott intact after tester deletion'); await ctx.close(); }
  await b.close(); console.log('ALL STEP 2 TESTS PASSED');
})().catch(e => { console.error(e.message); process.exit(1); });
