// Item 6 (t151u): Scott replies to feedback with a status preset and/or custom text; the sender sees it in
// "My feedback" with unread dots (Profile tab + button) and the reply push is queued for send-reminders.
// New feedback badges Scott's inbox. Runs against the LOCAL stand-in (Postgres with schema.sql + PostgREST
// + dev_proxy.py), with the real RLS. iPhone / iPad / Android phone / Android tablet, light + dark.
//   node tests/feedback_replies.test.js [ignored] [SHOTS]   (app via dev_proxy.py at FBR_BASE, default :8786; PostgREST at REST, default :3010;
//   SECRET defaults to the throwaway local secret in supabase/local-test/postgrest.conf). Skips if the local stack is not running.
const PW = require(process.env.PW || '/usr/local/lib/pnpm/5/.pnpm/playwright-core@1.59.1/node_modules/playwright-core');
const crypto = require('crypto'); const fs = require('fs'); const os = require('os'); const path = require('path');
const BASE = process.env.FBR_BASE || 'http://127.0.0.1:8786/';
const SHOTS = process.argv[3] || '/workspace/shots-oct29/feedback-replies'; fs.mkdirSync(SHOTS, { recursive: true });
const REST = process.env.REST || 'http://127.0.0.1:3010';
const SECRET = process.env.SECRET || (fs.readFileSync(path.join(__dirname, '../supabase/local-test/postgrest.conf'), 'utf8').match(/^jwt-secret = "(.*)"/m) || [])[1];
let n = 0; const ok = (c, m) => { if (!c) throw new Error('FAIL: ' + m); console.log('ok -', m); n++; };
const SCOTT = { id: 'f85fb17b-2943-4266-b1b2-dc130ae8b678', email: 'scottro1522@gmail.com' };
const ALICE = { id: 'aaaaaaaa-0000-0000-0000-00000000000a', email: 'alice@example.com' };
const BOB = { id: 'bbbbbbbb-0000-0000-0000-00000000000b', email: 'bob@example.com' };
const b64 = x => Buffer.from(x).toString('base64url');
const sign = p => { const h = b64(JSON.stringify({ alg: 'HS256', typ: 'JWT' })); const q = b64(JSON.stringify(p)); return `${h}.${q}.${crypto.createHmac('sha256', SECRET).update(`${h}.${q}`).digest('base64url')}`; };
const jwt = u => sign({ role: 'authenticated', sub: u.id, email: u.email, aud: 'authenticated', exp: Math.floor(Date.now() / 1000) + 86400 });
const SVC = sign({ role: 'service_role', exp: Math.floor(Date.now() / 1000) + 86400 }); // local-only stand-in
const svc = (p, init = {}) => fetch(`${REST}/${p}`, { ...init, headers: { apikey: SVC, authorization: `Bearer ${SVC}`, 'content-type': 'application/json', ...(init.headers || {}) } });
const DEV = [['iphone', 'webkit', 393, 852], ['ipad', 'webkit', 820, 1180], ['android-phone', 'chromium', 412, 915], ['android-tablet', 'chromium', 800, 1280]];

(async () => {
  try { await fetch(REST + '/'); await fetch(BASE); } catch (_) { console.log('SKIP - local stand-in (PostgREST + dev_proxy) not running'); return; }
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fbr-')); const fnFile = path.join(dir, 'fn.mjs');
  fs.writeFileSync(fnFile, fs.readFileSync(path.join(__dirname, '../supabase/functions/send-reminders/index.ts'), 'utf8'));
  const FN = await import(fnFile);
  const B = { webkit: await PW.webkit.launch(), chromium: await PW.chromium.launch({ executablePath: '/usr/bin/google-chrome', args: ['--no-sandbox'] }) };
  const errs = [];
  async function open(eng, w, h, dark, u, q = '') {
    const ctx = await B[eng].newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 2, isMobile: eng === 'chromium', hasTouch: true, colorScheme: dark ? 'dark' : 'light', timezoneId: 'America/Chicago', locale: 'en-US' });
    const cfg = `window.CALENDAR_CONFIG = { APP_NAME: 'SANDY', SUPABASE_URL: '${BASE.replace(/\/$/, '')}', SUPABASE_ANON_KEY: 'local-anon', OWNER_EMAIL: '${SCOTT.email}' };`;
    await ctx.route('**/config.js', r => r.fulfill({ contentType: 'application/javascript', body: cfg }));
    await ctx.route('**/auth/v1/**', r => r.fulfill({ status: 200, contentType: 'application/json', body: '{}' }));
    await ctx.route('**/functions/v1/**', r => r.fulfill({ status: 200, contentType: 'application/json', body: '{"invites":[]}' }));
    await ctx.route(/api\.weather\.gov|open-meteo\.com|photon\.komoot|valhalla/, r => r.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: '{}' }));
    const key = 'sb-' + new URL(BASE).hostname.split('.')[0] + '-auth-token';
    const s = JSON.stringify({ access_token: jwt(u), refresh_token: 'x', token_type: 'bearer', expires_in: 86400, expires_at: Math.floor(Date.now() / 1000) + 86400, user: { id: u.id, email: u.email, aud: 'authenticated', role: 'authenticated' } });
    await ctx.addInitScript(([k, v, d]) => { if (sessionStorage.getItem('__i')) return; sessionStorage.setItem('__i', 1); localStorage.setItem(k, v);
      localStorage.setItem('sandy.welcome.off', '1'); localStorage.setItem('sandy.tour.off', '1'); if (d) localStorage.setItem('sandy.theme', 'dark'); }, [key, s, dark]);
    const p = await ctx.newPage(); p.on('pageerror', e => errs.push(`${u.email}: ${e.message}`));
    await p.goto(BASE + q); await p.waitForFunction(() => window.SandyNav && window.SandyLaunch);
    return { ctx, p };
  }
  const profile = async p => { await p.evaluate(() => window.SandyNav.go('profile')); await p.waitForSelector('#feedbackBtn', { state: 'attached' }); await p.waitForTimeout(400); };
  const dotShown = (p, sel) => p.$eval(sel, d => !d.hidden && getComputedStyle(d).display !== 'none').catch(() => false);
  try {
    for (const [name, eng, w, h] of DEV) for (const dark of [false, true]) {
      const tag = `${name}-${dark ? 'dark' : 'light'}`; console.log('#', tag);
      await svc('feedback?owner_id=in.(' + [ALICE.id, BOB.id].join(',') + ')', { method: 'DELETE' });
      // 1. Alice (a QA account) sends feedback through the app
      let A = await open(eng, w, h, dark, ALICE); await profile(A.p);
      ok(await A.p.$eval('#myFbBtn', b => b.hidden), `${tag}: no "My feedback" before sending any`);
      await A.p.$eval('#feedbackBtn', b => b.scrollIntoView({ block: 'center' })); await A.p.click('#feedbackBtn'); await A.p.waitForSelector('.fb-dlg #fbBody');
      await A.p.fill('#fbBody', 'The week view feels slow when I swipe.'); await A.p.click('#fbSend');
      await A.p.waitForFunction(() => !document.querySelector('.fb-dlg') && !document.getElementById('myFbBtn').hidden);
      ok(true, `${tag}: Alice sent feedback; "My feedback" appears`);
      await A.ctx.close();
      // 2. Scott: inbox badge, reply with a preset + text
      const S = await open(eng, w, h, dark, SCOTT); await profile(S.p);
      await S.p.waitForSelector('#fbInboxBtn .fb-count:not([hidden])');
      ok(await S.p.$eval('#fbInboxBtn .fb-count', b => b.textContent) === '1', `${tag}: Scott's inbox badge shows 1 new`);
      ok(await dotShown(S.p, '#navProfileDot'), `${tag}: Scott's Profile tab shows a dot`);
      await S.p.$eval('#fbInboxBtn', b => b.scrollIntoView({ block: 'center' })); await S.p.click('#fbInboxBtn');
      await S.p.waitForSelector('.fbin-dlg .fb-item.fb-unseen');
      ok(/New/.test(await S.p.textContent('.fbin-dlg .fb-item')), `${tag}: new feedback tagged "New"`);
      await S.p.waitForFunction(() => document.querySelector('#fbInboxBtn .fb-count').hidden);
      ok(true, `${tag}: opening the inbox clears the badge`);
      await S.p.click('.fbin-dlg .fbr-open'); await S.p.waitForSelector('.fbr-compose');
      ok(await S.p.$eval('.fbr-compose', e => getComputedStyle(e).animationName) === 'fbrIn', `${tag}: composer eases in`);
      ok(await S.p.$eval('[data-act="send-reply"]', b => b.disabled), `${tag}: Send disabled until a status or text`);
      ok(JSON.stringify(await S.p.$$eval('.fbr-preset', bs => bs.map(b => b.textContent))) === JSON.stringify(["We're looking into it", "We're actively fixing it", "It's fixed", 'Planned for a future update']), `${tag}: presets listed`);
      await S.p.click('.fbr-preset[data-st="fixing"]'); await S.p.fill('.fbr-text', 'Found it, the fix ships this week.');
      await S.p.waitForTimeout(250); await S.p.screenshot({ path: `${SHOTS}/${tag}-admin-compose.png` });
      await S.p.click('[data-act="send-reply"]'); await S.p.waitForSelector('.fbin-dlg .fbr.fbr-new');
      await S.p.waitForFunction(() => !document.querySelector('.fbr-compose'));
      ok(/We're actively fixing it/.test(await S.p.textContent('.fbr.fbr-new .fbr-chip')) && /Not seen yet/.test(await S.p.textContent('.fbr.fbr-new')), `${tag}: reply appears (status chip, not seen yet)`);
      ok(/notification/.test(await S.p.textContent('#toast')), `${tag}: toast confirms`);
      await S.p.waitForTimeout(300); await S.p.screenshot({ path: `${SHOTS}/${tag}-admin-replied.png` });
      // custom-only text reply, then delete it (leave animation)
      await S.p.click('.fbin-dlg .fbr-open'); await S.p.fill('.fbr-text', 'Thanks for the detail!'); await S.p.click('[data-act="send-reply"]');
      await S.p.waitForFunction(() => document.querySelectorAll('.fbin-dlg .fbr').length === 2);
      ok(/Reply from Scott/.test(await S.p.textContent('.fbin-dlg .fbr:last-child .fbr-chip')), `${tag}: custom text alone sends as a note`);
      await S.p.evaluate(() => { window.__left = false; const li = document.querySelector('.fbin-dlg .fbr:last-child'); new MutationObserver(() => { if (li.classList.contains('fbr-leave')) window.__left = getComputedStyle(li).animationName; }).observe(li, { attributes: true }); });
      S.p.once('dialog', d => d.accept()); await S.p.click('.fbin-dlg .fbr:last-child [data-act="del-reply"]');
      await S.p.waitForFunction(() => document.querySelectorAll('.fbin-dlg .fbr').length === 1);
      ok(await S.p.evaluate(() => window.__left) === 'fbrOut', `${tag}: deleted reply eases out`);
      await S.p.waitForFunction(() => document.querySelectorAll('.fbin-dlg .fbr').length === 1);
      ok(true, `${tag}: deleted reply removed`);
      // 3. the reply push is queued; the real send-reminders code claims it once (push endpoint faked; Scott not alerted: QA sender)
      const sub = (await (await svc('push_subscriptions', { method: 'POST', headers: { Prefer: 'return=representation' }, body: JSON.stringify({ owner_id: ALICE.id, endpoint: 'https://push.example.net/send/alice', p256dh: crypto.createECDH('prime256v1').generateKeys().toString('base64url'), auth: crypto.randomBytes(16).toString('base64url') }) })).json());
      const sch = await svc('push_subscriptions', { method: 'POST', headers: { Prefer: 'return=representation' }, body: JSON.stringify({ owner_id: SCOTT.id, endpoint: 'https://push.example.net/send/scott', p256dh: crypto.createECDH('prime256v1').generateKeys().toString('base64url'), auth: crypto.randomBytes(16).toString('base64url') }) });
      const kp = crypto.generateKeyPairSync('ec', { namedCurve: 'P-256' }); const jwk = kp.privateKey.export({ format: 'jwk' });
      const env = { SUPABASE_URL: 'http://sb.local', SUPABASE_SERVICE_ROLE_KEY: SVC, VAPID_PRIVATE_KEY: jwk.d, VAPID_PUBLIC_KEY: Buffer.concat([Buffer.from([4]), Buffer.from(jwk.x, 'base64url'), Buffer.from(jwk.y, 'base64url')]).toString('base64url') };
      const pushed = [];
      const ff = async (url, init = {}) => { const u = new URL(url);
        if (u.host === 'push.example.net') { pushed.push(u.pathname.split('/').pop()); return new Response('', { status: 201 }); }
        if (u.pathname === '/rest/v1/rpc/sandy_check_cron_secret') return new Response('true');
        return fetch(REST + u.pathname.slice(8) + u.search, { method: init.method || 'GET', headers: init.headers, body: init.body }); };
      const req = () => new Request('http://fn/', { method: 'POST', headers: { 'x-cron-secret': 'local' } });
      const r1 = await (await FN.handle(req(), env, ff)).json();
      ok(pushed.join() === 'alice' && r1.feedback_pushes === 1, `${tag}: reply pushed to Alice only (QA sender never alerts Scott) ${JSON.stringify(pushed)}`);
      pushed.length = 0; await FN.handle(req(), env, ff);
      ok(pushed.length === 0, `${tag}: next cron run sends nothing again`);
      await svc('push_subscriptions?endpoint=like.https://push.example.net/*', { method: 'DELETE' }); void sub; void sch;
      await S.ctx.close();
      // 4. Alice: dots, My feedback with the reply, read clears dots
      A = await open(eng, w, h, dark, ALICE); await A.p.waitForSelector('#navProfileDot:not([hidden])', { state: 'attached' });
      ok(await dotShown(A.p, '#navProfileDot'), `${tag}: Alice's Profile tab shows a dot`);
      await A.p.waitForTimeout(350); await A.p.screenshot({ path: `${SHOTS}/${tag}-user-dot.png` });
      await profile(A.p); ok(await dotShown(A.p, '#myFbBtn .fb-dot'), `${tag}: "My feedback" button shows a dot`);
      await A.p.$eval('#myFbBtn', b => b.scrollIntoView({ block: 'center' })); await A.p.click('#myFbBtn'); await A.p.waitForSelector('.myfb-dlg .fbr.unread');
      ok(/We're actively fixing it/.test(await A.p.textContent('.myfb-dlg .fbr-chip')) && /fix ships this week/.test(await A.p.textContent('.myfb-dlg .fbr-body')) && /New/.test(await A.p.textContent('.myfb-dlg .fbr')), `${tag}: Alice sees the status + message, tagged New`);
      ok(await A.p.$eval('.myfb-dlg .fbr.unread', e => getComputedStyle(e).animationName) === 'fbrIn', `${tag}: new reply eases in`);
      await A.p.waitForTimeout(350); await A.p.screenshot({ path: `${SHOTS}/${tag}-user-myfeedback.png` });
      await A.p.waitForFunction(() => document.getElementById('navProfileDot').hidden && document.querySelector('#myFbBtn .fb-dot').hidden);
      ok(true, `${tag}: reading clears both dots`);
      const rr = await (await svc(`feedback_replies?owner_id=eq.${ALICE.id}&select=read_at`)).json();
      ok(rr.length === 1 && rr[0].read_at, `${tag}: reply marked read in the database`);
      await A.ctx.close();
      // 5. push deep link opens My feedback; Bob sees nothing
      if (name === 'iphone' && !dark) {
        await svc('feedback_replies', { method: 'POST', body: JSON.stringify({ feedback_id: (await (await svc(`feedback?owner_id=eq.${ALICE.id}&select=id`)).json())[0].id, owner_id: ALICE.id, status: 'fixed', body: null }) });
        A = await open(eng, w, h, dark, ALICE, '?tab=profile&fb=mine'); await A.p.waitForSelector('.myfb-dlg .fbr.st-fixed');
        ok(!/fb=/.test(await A.p.evaluate(() => location.search)), 'push link ?fb=mine opens My feedback and is cleared from the URL');
        await A.ctx.close();
        const Bo = await open(eng, w, h, dark, BOB); await profile(Bo.p); await Bo.p.waitForTimeout(500);
        ok(!(await dotShown(Bo.p, '#navProfileDot')) && await Bo.p.$eval('#myFbBtn', b => b.hidden), 'Bob: no dot, no My feedback (other users\' replies hidden)');
        ok(await Bo.p.evaluate(async () => { const sb = window.__app.Store.adapter.client; const r = await sb.from('feedback_replies').select('id'); return r.data.length === 0; }), 'Bob: RLS returns no replies');
        ok(await Bo.p.evaluate(async () => { const sb = window.__app.Store.adapter.client; const f = await sb.from('feedback').select('id').limit(1); return !!(await sb.from('feedback_replies').insert({ feedback_id: '00000000-0000-0000-0000-000000000000', status: 'fixed' })).error; }), 'Bob: cannot post a reply');
        await Bo.ctx.close();
      }
    }
    ok(errs.length === 0, 'no page errors ' + errs.join(' | '));
  } finally {
    await svc('feedback?owner_id=in.(' + [ALICE.id, BOB.id].join(',') + ')', { method: 'DELETE' });
    await B.webkit.close(); await B.chromium.close();
  }
  console.log(`FEEDBACK REPLIES TEST PASSED (${n} checks)`);
})().catch(e => { console.error(e.message || e); process.exit(1); });
