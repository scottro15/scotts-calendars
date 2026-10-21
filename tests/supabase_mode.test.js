// End-to-end test of the Supabase path against a LOCAL stand-in (Postgres + PostgREST + dev_proxy.py).
// No real Supabase project is used. Auth is simulated by injecting a locally-minted session token.
// Run: OWNER_JWT=... OTHER_JWT=... node tests/supabase_mode.test.js http://127.0.0.1:8766/
const { chromium } = require(process.env.PW || '/workspace/shot-tools/node_modules/playwright-core');
const { execFileSync } = require('child_process');
const BASE = process.argv[2] || 'http://127.0.0.1:8766/';
const assert = (c, m) => { if (!c) throw new Error('FAIL: ' + m); console.log('ok -', m); };
const CAL = __dirname + '/../tools/cal.py';
const cal = (...a) => JSON.parse(execFileSync('python3', [CAL, ...a], { encoding: 'utf8' }));
const cfg = `window.CALENDAR_CONFIG = { SUPABASE_URL: '${BASE.replace(/\/$/, '')}', SUPABASE_ANON_KEY: 'local-anon', OWNER_EMAIL: 'scottro1522@gmail.com' };`;
const sess = (jwt, email) => JSON.stringify({ access_token: jwt, refresh_token: 'x', token_type: 'bearer', expires_in: 86400 * 30,
  expires_at: Math.floor(Date.now() / 1000) + 86400 * 30, user: { id: '33333333-3333-3333-3333-333333333333', email, aud: 'authenticated', role: 'authenticated' } });
const storageKey = 'sb-' + new URL(BASE).hostname.split('.')[0] + '-auth-token';

async function open(b, { jwt, email, localEvents } = {}) {
  const ctx = await b.newContext({ viewport: { width: 1300, height: 900 }, timezoneId: 'Europe/Lisbon', locale: 'en-US' });
  await ctx.route('**/config.js', r => r.fulfill({ contentType: 'application/javascript', body: cfg }));
  await ctx.route('**/auth/v1/**', r => r.fulfill({ status: 200, contentType: 'application/json', body: '{}' }));
  await ctx.addInitScript(([k, s, le]) => {
    if (sessionStorage.getItem('__init')) return; sessionStorage.setItem('__init', '1');
    if (s) localStorage.setItem(k, s);
    if (le) localStorage.setItem('scottcal.events.v1', le);
  }, [storageKey, jwt ? sess(jwt, email) : null, localEvents ? JSON.stringify(localEvents) : null]);
  const p = await ctx.newPage(); const errs = [];
  p.on('pageerror', e => errs.push(e.message));
  p.on('console', m => { if (m.type() === 'error' && !/websocket|realtime|ERR_CONNECTION|404|Failed to load resource/i.test(m.text())) errs.push(m.text()); });
  return { ctx, p, errs };
}

(async () => {
  const b = await chromium.launch({ executablePath: '/usr/bin/google-chrome', headless: true, args: ['--no-sandbox'] });
  // 1. signed out -> gate
  { const { ctx, p } = await open(b); await p.goto(BASE + '?view=timeGridWeek&date=2026-10-19');
    await p.waitForSelector('#authGate:not([hidden])'); assert(await p.isVisible('#authForm'), 'signed out: sign-in gate shown');
    assert(await p.inputValue('#authEmail') === '', 'gate does not prefill anyone\'s email'); await ctx.close(); }
  // 2. another invited account -> own empty calendars
  { const { ctx, p } = await open(b, { jwt: process.env.OTHER_JWT, email: 'someone@else.com' }); await p.goto(BASE);
    // Invite-only: an account only exists if Scott invited it, so a signed-in account gets in, and RLS shows it only its own (empty) calendars.
    await p.waitForSelector('#calendar .fc-view'); assert(await p.isHidden('#authGate'), 'invited (non-Scott) account opens the app');
    assert(await p.locator('.fc-event').count() === 0, 'invited account sees none of Scott\'s events'); await ctx.close(); }

  // 3. owner, with leftover local events -> migration
  const localEvents = [
    { id: 'old-1', kind: 'event', calendar: 'mam', category: 'Film study', title: 'Old film study', allDay: false, start: '2026-10-20T20:00', end: '2026-10-20T21:00', recurrence: { freq: 'weekly', interval: 1, byWeekday: [2] }, exdates: [], location: '', notes: '' },
    { id: 'old-1x', kind: 'event', calendar: 'mam', category: 'Film study', title: 'Old film study (moved)', allDay: false, start: '2026-10-28T18:00', end: '2026-10-28T19:00', recurrence: { freq: 'none' }, seriesId: 'old-1', originalDate: '2026-10-27' },
    { id: crypto.randomUUID(), kind: 'event', calendar: 'msc', category: 'Other', title: 'Sample (Example)', allDay: false, start: '2026-10-21T09:00', end: '2026-10-21T10:00', recurrence: { freq: 'none' }, example: true },
  ];
  localEvents[0].exdates = ['2026-10-27'];
  const { ctx, p, errs } = await open(b, { jwt: process.env.OWNER_JWT, email: 'scottro1522@gmail.com', localEvents });
  await p.goto(BASE + '?view=timeGridWeek&date=2026-10-19');
  await p.waitForSelector('#migrateBox:not([hidden])');
  assert(await p.isHidden('#authGate'), 'owner session: app opens');
  assert(/1 example/.test(await p.textContent('#migrateText')), 'migration banner counts local events: ' + await p.textContent('#migrateText'));
  p.once('dialog', d => d.dismiss()); // don't include examples
  await p.click('#migrateBtn'); await p.waitForTimeout(800);
  assert(await p.isHidden('#migrateBox'), 'migration done, banner hidden');
  let rows = cal('list', '--from', '2026-10-18', '--to', '2026-11-01', '--calendar', 'mam').occurrences;
  assert(rows.some(o => o.title === 'Old film study' && o.display.includes('8:00 PM')), 'bot sees migrated series at 8:00 PM CT');
  assert(rows.some(o => o.title === 'Old film study (moved)'), 'migrated exception kept its series link');
  assert(!rows.some(o => o.occurrence_date === '2026-10-27' && o.title === 'Old film study'), 'migrated exdate respected');
  assert(cal('find', 'Example').count === 0, 'examples were not migrated');

  // 4. app writes -> bot reads
  await p.click('#addBtn'); await p.fill('#eventForm input[name=title]', 'App-made meeting');
  await p.selectOption('#fCalendar', 'lifetime'); await p.fill('input[name=startDate]', '2026-10-22');
  await p.fill('input[name=startTime]', '10:00'); await p.fill('input[name=endDate]', '2026-10-22'); await p.fill('input[name=endTime]', '11:00');
  await p.click('#eventForm button[type=submit]'); await p.waitForTimeout(600);
  const f1 = cal('find', 'App-made');
  assert(f1.count === 1 && f1.events[0].start === '2026-10-22T10:00' && f1.events[0].source === 'app', 'event saved by app is in Supabase at 10:00 CT (device in Lisbon)');

  // 5. bot writes -> app shows after refresh-on-focus
  const added = cal('add', '--calendar', 'mam', '--title', 'Bot-added workout', '--category', 'Client workout', '--start', '2026-10-23 5:30pm', '--duration', '60', '--source', 'scheduler');
  await p.waitForTimeout(10500);
  await p.evaluate(() => { Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true }); document.dispatchEvent(new Event('visibilitychange')); });
  await p.waitForSelector('.fc-event:has-text("Bot-added workout")', { timeout: 5000 });
  const t = await p.locator('.fc-timegrid-event:has-text("Bot-added workout") .fc-event-time').first().textContent();
  assert(/^5:30/.test(t.trim()), 'bot event appears in app on focus, at 5:30 (' + t.trim() + ')');

  // 6. single-occurrence edit in the app -> exception row in DB
  await p.locator('.fc-event:has-text("Old film study")').first().click();
  await p.fill('#eventForm input[name=title]', 'Film study w/ Jon');
  await p.click('#eventForm button[type=submit]'); await p.waitForTimeout(700);
  const g = cal('get', f1.events[0].id); // sanity: get works
  const series = cal('find', 'Old film study').events.find(e => e.repeat);
  const full = cal('get', series.id);
  assert(full.exceptions.some(e => e.title === 'Film study w/ Jon' && e.replaces_occurrence === '2026-10-20'), 'app single-occurrence edit stored as exception');

  // 7. bot edits/deletes -> "Refresh now"
  cal('edit', added.created[0].id, '--title', 'Bot workout (renamed)');
  cal('delete', f1.events[0].id);
  await p.click('#syncNowBtn'); await p.waitForTimeout(600);
  assert(await p.locator('.fc-event:has-text("Bot workout (renamed)")').count() === 1, 'bot rename visible after Refresh now');
  assert(await p.locator('.fc-event:has-text("App-made meeting")').count() === 0, 'bot delete visible after Refresh now');

  // 8. custom category round trip
  await p.click('#addBtn'); await p.fill('#eventForm input[name=title]', 'SLU');
  await p.selectOption('#fCalendar', 'mam'); await p.selectOption('#fCategory', '__custom__'); await p.fill('input[name=customCategory]', 'Team practice – SLU');
  await p.click('#eventForm button[type=submit]'); await p.waitForTimeout(600);
  assert(cal('categories', '--calendar', 'mam').mam.custom.includes('Team practice – SLU'), 'custom category stored in categories table');
  assert(/Signed in as scottro1522@gmail.com/.test(await p.textContent('#storageNote')), 'status shows synced + signed-in email');
  assert(errs.length === 0, 'no page errors: ' + errs.join(' | '));
  await p.screenshot({ path: '/tmp/supabase-week.png' });
  await ctx.close(); await b.close();
  console.log('ALL SUPABASE-MODE TESTS PASSED');
})().catch(e => { console.error(e.message); process.exit(1); });
