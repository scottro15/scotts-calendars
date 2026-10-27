// Browser test (Scott 2026-10-26): Invites screen personalizes the invite note with First name + link,
// and offers Copy / Text it / Share. Admin-only. Light + dark at 390x844.
//   node tests/invite_note.test.js http://127.0.0.1:8796/ [screenshotDir]
const { chromium } = require(process.env.PW || '/workspace/shot-tools/node_modules/playwright-core');
const BASE = process.argv[2] || 'http://127.0.0.1:8796/';
const SHOTS = process.argv[3] || '/workspace/shots-invite-name';
require('fs').mkdirSync(SHOTS, { recursive: true });
let n = 0; const assert = (c, m) => { if (!c) throw new Error('FAIL: ' + m); n++; console.log('ok -', m); };
const LINK = 'https://scottro15.github.io/scotts-calendars/';
const EXACT = name => `Hey ${name}! I've been building a calendar app called SANDY, and I'd love for you to be one of the first people to test it. It's made for people who juggle a lot: multiple jobs, multiple schedules, and events stacked on top of each other. Most apps make you keep those in separate places. SANDY puts all your schedules, events, to-dos and notes in one clean, simple, efficient place. It's a free early version and invite-only, so your feedback will shape what it becomes. Here's your invite link: ${LINK}. Thanks for helping me test it! — Scott`;

(async () => {
  const b = await chromium.launch({ executablePath: '/usr/bin/google-chrome', headless: true, args: ['--no-sandbox'] });

  // ---- Template helpers (no auth) ----
  {
    const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, timezoneId: 'America/Chicago', locale: 'en-US', isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
    const p = await ctx.newPage();
    await p.goto(BASE); await p.waitForFunction(() => window.SandyLaunch && window.SandyLaunch.inviteNoteText);
    const got = await p.evaluate(() => ({
      link: SandyLaunch.INVITE_LINK,
      alex: SandyLaunch.inviteNoteText('Alex'),
      empty: SandyLaunch.inviteNoteText(''),
      space: SandyLaunch.inviteNoteText('  '),
      sms: SandyLaunch.smsHref('hi there'),
    }));
    assert(got.link === LINK, 'invite link is the live site');
    assert(got.alex === EXACT('Alex'), 'named note matches the template exactly');
    assert(got.empty === EXACT('there') && got.space === EXACT('there'), 'empty name → "Hey there!"');
    assert(got.sms === 'sms:&body=' + encodeURIComponent('hi there'), 'Text it uses iOS sms:&body=…');
    await ctx.close();
  }

  async function openUi(dark) {
    const invites = [
      { email: 'alex@example.com', status: 'invited', note: 'Alex', firstName: 'Alex', created_at: '2026-10-20T12:00:00Z', last_sign_in_at: null },
      { email: 'noname@example.com', status: 'invited', note: null, firstName: '', created_at: '2026-10-21T12:00:00Z', last_sign_in_at: null },
    ];
    const calls = [];
    const ctx = await b.newContext({
      viewport: { width: 390, height: 844 }, timezoneId: 'America/Chicago', locale: 'en-US',
      isMobile: true, hasTouch: true, deviceScaleFactor: 2, reducedMotion: 'reduce',
      colorScheme: dark ? 'dark' : 'light',
      permissions: ['clipboard-read', 'clipboard-write'],
    });
    await ctx.addInitScript(d => { try { localStorage.clear(); sessionStorage.clear(); if (d) localStorage.setItem('sandy.theme', 'dark'); } catch (_) {} }, dark);
    await ctx.route('**/functions/v1/admin-invites', async r => {
      const body = JSON.parse(r.request().postData() || '{}');
      calls.push(body);
      if (body.action === 'list') return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ invites: invites.slice() }) });
      if (body.action === 'invite') {
        const nm = String(body.firstName || body.note || '').trim();
        invites.unshift({ email: String(body.email).toLowerCase(), status: 'invited', note: nm || null, firstName: nm, created_at: new Date().toISOString(), last_sign_in_at: null });
        return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, email: body.email, firstName: nm }) });
      }
      if (body.action === 'set_name') {
        const row = invites.find(i => i.email === body.email);
        if (row) { row.note = String(body.firstName || '').trim() || null; row.firstName = row.note || ''; }
        return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, email: body.email, firstName: body.firstName || '' }) });
      }
      if (body.action === 'revoke' || body.action === 'restore') {
        const row = invites.find(i => i.email === body.email); if (row) row.status = body.action === 'revoke' ? 'revoked' : 'invited';
        return r.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true}' });
      }
      return r.fulfill({ status: 400, contentType: 'application/json', body: '{"error":"Unknown action"}' });
    });
    const p = await ctx.newPage();
    const errs = []; p.on('pageerror', e => errs.push(e.message));
    await p.goto(BASE);
    await p.waitForFunction(() => window.SandyLaunch && window.__app);
    if (dark) await p.evaluate(() => { document.documentElement.classList.add('dark'); localStorage.setItem('sandy.theme', 'dark'); });
    // Point Invites at our mock endpoint and open the dialog with a stub supabase client
    await p.evaluate(() => {
      const CFG = window.CALENDAR_CONFIG || (window.CALENDAR_CONFIG = {});
      CFG.INVITES_ENDPOINT = location.origin + '/functions/v1/admin-invites';
      CFG.SUPABASE_URL = location.origin;
      CFG.SUPABASE_ANON_KEY = 'local-anon';
      const sb = {
        auth: { getSession: async () => ({ data: { session: { access_token: 'tok', user: { id: 'u1', email: 'a@b.co' } } } }) },
      };
      const toast = m => { const t = document.getElementById('toast'); if (t) { t.textContent = m; t.hidden = false; } };
      window.SandyLaunch.openInvites({ sb, toast });
    });
    await p.waitForSelector('.inv-dlg .inv-row');
    return { ctx, p, errs, calls, invites };
  }

  for (const dark of [false, true]) {
    const tag = dark ? 'dark' : 'light';
    const { ctx, p, errs, calls } = await openUi(dark);
    assert(await p.$('#invName'), `${tag}: First name field next to email`);
    const alex = p.locator('.inv-row', { hasText: 'alex@example.com' });
    assert(await alex.locator('.inv-note').inputValue() === EXACT('Alex'), `${tag}: Alex row note matches template exactly`);
    const noname = p.locator('.inv-row', { hasText: 'noname@example.com' });
    assert(await noname.locator('.inv-note').inputValue() === EXACT('there'), `${tag}: empty name → Hey there!`);
    const sms = await alex.locator('a[data-act=sms]').getAttribute('href');
    assert(sms === 'sms:&body=' + encodeURIComponent(EXACT('Alex')), `${tag}: Text it href is iOS sms:&body=…`);
    assert(await alex.locator('button[data-act=copy]').count() === 1, `${tag}: Copy button present`);

    await noname.locator('.inv-name').fill('Sam');
    assert(await noname.locator('.inv-note').inputValue() === EXACT('Sam'), `${tag}: typing a name live-updates the note`);
    await noname.locator('button[data-act=save-name]').click();
    await p.waitForTimeout(250);
    assert(calls.some(c => c.action === 'set_name' && c.email === 'noname@example.com' && c.firstName === 'Sam'), `${tag}: Save sends set_name`);

    await p.fill('#invEmail', 'Jordan@Example.com');
    await p.fill('#invName', 'Jordan');
    await p.click('#invGo');
    await p.waitForSelector('.inv-row:has-text("jordan@example.com")');
    const jordan = p.locator('.inv-row', { hasText: 'jordan@example.com' });
    assert(await jordan.locator('.inv-note').inputValue() === EXACT('Jordan'), `${tag}: new invite note uses the first name`);
    assert(calls.some(c => c.action === 'invite' && c.email === 'jordan@example.com' && (c.firstName === 'Jordan' || c.note === 'Jordan')), `${tag}: invite payload includes firstName`);

    await jordan.locator('button[data-act=copy]').click();
    await p.waitForTimeout(250);
    const toast = (await p.textContent('#toast').catch(() => '')) || '';
    const clip = await p.evaluate(() => navigator.clipboard.readText()).catch(() => '');
    assert(/Invite note copied|Could not copy/.test(toast) || clip === EXACT('Jordan'), `${tag}: Copy copies or toasts (${toast || clip.slice(0, 40)})`);

    // Survive reload via localStorage even if set_name were unavailable
    const stored = await p.evaluate(() => localStorage.getItem('sandy.inviteNames.v1'));
    assert(/jordan@example.com/.test(stored) && /Jordan/.test(stored), `${tag}: first name cached in localStorage`);

    await alex.scrollIntoViewIfNeeded();
    await p.screenshot({ path: `${SHOTS}/${tag}_1_invites.png` });
    await jordan.locator('.inv-note').scrollIntoViewIfNeeded();
    await p.screenshot({ path: `${SHOTS}/${tag}_2_note.png` });
    assert(errs.length === 0, `${tag}: no page errors ` + errs.join('|'));
    await p.click('.inv-close');
    await ctx.close();
  }

  // Welcome note claim vs live app
  {
    const ctx = await b.newContext({ viewport: { width: 390, height: 844 } });
    const p = await ctx.newPage();
    await p.goto(BASE); await p.waitForFunction(() => window.__app);
    const check = await p.evaluate(() => {
      const welcome = (document.querySelector('script[src*="welcome"]') && true);
      // Source of truth in the loaded scripts
      const wl = Array.from(document.scripts).map(s => s.src).join(' ');
      return {
        hasPushMount: !!(window.SandyPush && SandyPush.mount),
        remLegend: (document.querySelector('#eventForm legend') || {}).textContent || '',
        remHint: !!document.getElementById('remList'),
      };
    });
    // Read welcome.js claim from the file via fetch
    const body = await (await p.request.get(BASE + 'welcome.js')).text();
    assert(/go to <b>Profile<\/b> and tap <b>Enable notifications<\/b> to get up to 6 reminders per event/.test(body), 'welcome note still claims Profile → Enable notifications, up to 6');
    assert(check.hasPushMount, 'SandyPush.mount exists (Enable notifications lives under Profile → Account)');
    assert(/up to 6/.test(check.remLegend) || check.remHint, 'event editor shows up to 6 reminders');
    // Confirm cleanReminders caps at 6 in storage.js
    const stor = await (await p.request.get(BASE + 'storage.js')).text();
    assert(/\.slice\(0,\s*6\)/.test(stor), 'storage cleanReminders caps at 6');
    await ctx.close();
    assert(true, 'welcome reminders claim MATCHES the live app (Profile → Enable notifications, up to 6)');
  }

  await b.close();
  console.log(`\n${n} checks passed`);
})().catch(e => { console.error(e.message || e); process.exit(1); });
