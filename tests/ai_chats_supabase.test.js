// Sandy Intelligence chat history (SI feature E) against the LOCAL stand-in (Postgres with schema.sql incl.
// migration-2026-10-25-ai-chats.sql + PostgREST + dev_proxy.py). The ai-assistant function is mocked.
// Covers: chats saved to ai_chats (title, messages, owner = signed-in user), history list/open from the server,
// RLS (Bob can't read, change, delete or plant Alice's chats; anon sees nothing), deletes, and the device fallback
// (per account) with a clear note while the migration hasn't been applied.
// Run: SECRET=<local postgrest jwt-secret> node tests/ai_chats_supabase.test.js http://127.0.0.1:8786/
const { chromium } = require(process.env.PW || '/workspace/shot-tools/node_modules/playwright-core');
const crypto = require('crypto'); const fs = require('fs');
const BASE = process.argv[2] || 'http://127.0.0.1:8786/';
const REST = process.env.REST || 'http://127.0.0.1:3010';
const SECRET = process.env.SECRET;
const SHOTS = process.env.SHOTS || '/workspace/shots-si-e/'; fs.mkdirSync(SHOTS, { recursive: true });
const assert = (c, m) => { if (!c) throw new Error('FAIL: ' + m); console.log('ok -', m); };
const ALICE = { id: 'aaaaaaaa-0000-0000-0000-00000000000a', email: 'alice@example.com' };
const BOB = { id: 'bbbbbbbb-0000-0000-0000-00000000000b', email: 'bob@example.com' };
const b64 = x => Buffer.from(x).toString('base64url');
const sign = p => { const h = b64(JSON.stringify({ alg: 'HS256', typ: 'JWT' })); const q = b64(JSON.stringify(p));
  return `${h}.${q}.${crypto.createHmac('sha256', SECRET).update(`${h}.${q}`).digest('base64url')}`; };
const jwt = u => sign({ role: 'authenticated', sub: u.id, email: u.email, aud: 'authenticated', exp: Math.floor(Date.now() / 1000) + 86400 * 60 });
const SVC = sign({ role: 'service_role', exp: Math.floor(Date.now() / 1000) + 86400 * 60 });
const ANON = sign({ role: 'anon', exp: Math.floor(Date.now() / 1000) + 86400 * 60 });
const rest = (p, init = {}, tok = SVC) => fetch(REST + p, { ...init, headers: { authorization: `Bearer ${tok}`, 'content-type': 'application/json', prefer: 'return=representation', ...(init.headers || {}) } });

(async () => {
  assert(SECRET, 'SECRET set');
  await rest('/ai_chats?owner_id=in.(' + ALICE.id + ',' + BOB.id + ')', { method: 'DELETE' }); // clean start
  const b = await chromium.launch({ executablePath: '/usr/bin/google-chrome', headless: true, args: ['--no-sandbox'] });
  async function open(u, { extra } = {}) {
    const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, timezoneId: 'America/Chicago', locale: 'en-US', reducedMotion: 'reduce' });
    const cfg = `window.CALENDAR_CONFIG = { APP_NAME: 'SANDY', SUPABASE_URL: '${BASE.replace(/\/$/, '')}', SUPABASE_ANON_KEY: 'local-anon', OWNER_EMAIL: 'scottro1522@gmail.com' };`;
    await ctx.route('**/config.js', r => r.fulfill({ contentType: 'application/javascript', body: cfg }));
    await ctx.route('**/auth/v1/**', r => r.fulfill({ status: 200, contentType: 'application/json', body: '{}' }));
    const sent = [];
    await ctx.route('**/functions/v1/ai-assistant', r => { const m = JSON.parse(r.request().postData()).messages; sent.push(m);
      r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ reply: 'Reply to: ' + m.at(-1).content, proposals: [] }) }); });
    const key = 'sb-' + new URL(BASE).hostname.split('.')[0] + '-auth-token';
    const s = JSON.stringify({ access_token: jwt(u), refresh_token: 'x', token_type: 'bearer', expires_in: 86400, expires_at: Math.floor(Date.now() / 1000) + 86400 * 60, user: { id: u.id, email: u.email, aud: 'authenticated', role: 'authenticated' } });
    await ctx.addInitScript(([k, v]) => { if (!sessionStorage.getItem('__i')) { sessionStorage.setItem('__i', 1); localStorage.setItem(k, v); } }, [key, s]);
    if (extra) await extra(ctx);
    const p = await ctx.newPage(); const errs = []; p.on('pageerror', e => errs.push(e.message));
    await p.goto(BASE);
    await p.waitForSelector('.onb, #calendar .fc-view', { timeout: 15000 });
    if (await p.$('.onb')) await p.click('.onb-go');
    await p.waitForFunction(() => window.__app && window.__app.user && window.__app.user() && window.SandyAI, null, { timeout: 15000 });
    await p.click('#aiBtn'); await p.waitForSelector('#aiSheet:not([hidden])');
    return { ctx, p, errs, sent };
  }
  const ask = async (p, text) => { await p.fill('#aiText', text); await p.click('#aiSend'); await p.waitForFunction(t => [...document.querySelectorAll('.ai-msg.assistant')].some(x => x.textContent === 'Reply to: ' + t), text); await p.waitForTimeout(700); };
  const rows = async (tok, q = '') => (await rest('/ai_chats?select=*&order=updated_at.desc' + q, {}, tok)).json();

  // Alice: two chats saved to her account
  const A = await open(ALICE);
  await ask(A.p, 'What is on Thursday?'); await ask(A.p, 'And Friday?');
  let r = await rows(SVC, '&owner_id=eq.' + ALICE.id);
  assert(r.length === 1 && r[0].title === 'What is on Thursday?' && r[0].messages.length === 4 && r[0].messages[3].content === 'Reply to: And Friday?', 'chat saved to ai_chats with title + messages');
  const id1 = r[0].id;
  await A.p.click('#aiNew'); await ask(A.p, 'Plan my week');
  r = await rows(SVC, '&owner_id=eq.' + ALICE.id); assert(r.length === 2 && r[0].title === 'Plan my week' && r.every(x => x.owner_id === ALICE.id), 'New chat -> a second row, owned by Alice');
  assert(!(await A.p.evaluate(() => Object.keys(localStorage).some(k => k.startsWith('sandy.aiChats')))), 'nothing kept on the device when the table exists');
  await A.p.click('#aiHist'); await A.p.waitForSelector('.ai-hist-row');
  assert(/Saved to your account, only you can see them/.test(await A.p.$eval('#aiHistPanel', e => e.innerText)), 'history says chats are saved to the account');
  assert((await A.p.$$eval('.ai-hist-title', t => t.map(x => x.textContent))).join('|') === 'Plan my week|What is on Thursday?', 'history lists Alice’s chats from the server, newest first');
  await A.p.screenshot({ path: SHOTS + 'history_account_light.png' });
  const n0 = A.sent.length;
  await A.p.click(`[data-open="${id1}"]`); await A.p.waitForFunction(() => document.querySelectorAll('#aiLog .ai-msg.user').length === 2);
  assert(A.sent.length === n0, 'opening a chat from the server makes no AI call');
  await ask(A.p, 'Saturday too?');
  assert(A.sent.at(-1).length === 5 && A.sent.at(-1)[0].content === 'What is on Thursday?', 'follow-up carries the reopened chat’s history');
  r = await rows(SVC, '&id=eq.' + id1); assert(r[0].messages.length === 6, 'reopened chat updated in place');

  // RLS
  const bobSees = await rows(jwt(BOB)); assert(Array.isArray(bobSees) && bobSees.length === 0, 'RLS: Bob reads none of Alice’s chats');
  const anonSees = await rest('/ai_chats?select=id', {}, ANON); const anonBody = await anonSees.json().catch(() => null);
  assert(!anonSees.ok || (Array.isArray(anonBody) && anonBody.length === 0), 'RLS: anon reads nothing (' + anonSees.status + ')');
  const upd = await (await rest('/ai_chats?id=eq.' + id1, { method: 'PATCH', body: JSON.stringify({ title: 'hacked' }) }, jwt(BOB))).json();
  const del = await (await rest('/ai_chats?id=eq.' + id1, { method: 'DELETE' }, jwt(BOB))).json();
  assert(Array.isArray(upd) && upd.length === 0 && Array.isArray(del) && del.length === 0 && (await rows(SVC, '&id=eq.' + id1))[0].title === 'What is on Thursday?', 'RLS: Bob can’t change or delete Alice’s chat');
  const plant = await rest('/ai_chats', { method: 'POST', body: JSON.stringify({ owner_id: ALICE.id, title: 'planted', messages: [] }) }, jwt(BOB));
  assert(plant.status >= 400, 'RLS: Bob can’t create a chat owned by Alice (' + plant.status + ')');
  const steal = await rest('/ai_chats', { method: 'POST', headers: { prefer: 'resolution=merge-duplicates,return=representation' }, body: JSON.stringify({ id: id1, title: 'mine now', messages: [] }) }, jwt(BOB));
  assert(steal.status >= 400 && (await rows(SVC, '&id=eq.' + id1))[0].title === 'What is on Thursday?', 'RLS: Bob can’t take over Alice’s chat id via upsert (' + steal.status + ')');
  const big = await rest('/ai_chats', { method: 'POST', body: JSON.stringify({ title: 'x'.repeat(200), messages: [] }) }, jwt(BOB));
  assert(big.status >= 400, 'title length is checked (' + big.status + ')');

  // Bob's own history is separate
  const B = await open(BOB);
  await B.p.click('#aiHist'); await B.p.waitForSelector('.ai-hist-msg:not(.ai-hist-loading)');
  const bt = await B.p.$eval('#aiHistPanel', e => e.innerText); assert(/No saved chats yet/.test(bt), 'Bob’s history is empty (never shows Alice’s chats): ' + bt.replace(/\s+/g, ' '));
  assert(!B.errs.length, 'no page errors (Bob)'); await B.ctx.close();

  // Alice deletes a chat
  await A.p.click('#aiHist'); await A.p.waitForSelector('.ai-hist-row');
  await A.p.click(`[data-del="${id1}"]`); await A.p.click(`[data-del="${id1}"]`); await A.p.waitForFunction(() => document.querySelectorAll('.ai-hist-row').length === 1);
  assert((await rows(SVC, '&owner_id=eq.' + ALICE.id)).length === 1, 'delete removes the row');
  assert(!A.errs.length, 'no page errors (Alice)'); await A.ctx.close();

  // before the migration: table missing -> device fallback, per account, with a note
  const missing = ctx => ctx.route('**/rest/v1/ai_chats**', r => r.fulfill({ status: 404, contentType: 'application/json', body: JSON.stringify({ code: 'PGRST205', message: "Could not find the table 'public.ai_chats' in the schema cache" }) }));
  const M = await open(ALICE, { extra: missing });
  await ask(M.p, 'Offline-ish question');
  const ls = await M.p.evaluate(id => JSON.parse(localStorage.getItem('sandy.aiChats.v1.' + id) || '[]'), ALICE.id);
  assert(ls.length === 1 && ls[0].title === 'Offline-ish question', 'no table yet: chat kept on the device under Alice’s account key');
  await M.p.click('#aiHist'); await M.p.waitForSelector('.ai-hist-row');
  assert(/Saved on this device for now/.test(await M.p.$eval('#aiHistPanel', e => e.innerText)), 'history explains chats are on this device until the update');
  await M.p.screenshot({ path: SHOTS + 'history_device_fallback_light.png' });
  assert((await rows(SVC, '&owner_id=eq.' + ALICE.id)).length === 1, 'nothing written to the server while the table is "missing"');
  assert(!M.errs.length, 'no page errors (fallback)'); await M.ctx.close();
  await rest('/ai_chats?owner_id=in.(' + ALICE.id + ',' + BOB.id + ')', { method: 'DELETE' });
  await b.close();
  console.log('AI CHATS SUPABASE TESTS PASSED');
})().catch(e => { console.error(e); process.exit(1); });
