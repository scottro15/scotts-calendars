// Browser test (390px): Sandy Intelligence chat history + New chat (SI feature E), local (device) storage.
// History list, open an old chat (messages + confirm notes restored, follow-ups carry its history), New chat,
// delete (two taps), titles, buttons disabled while waiting, and that NOTHING here calls the AI (only Send does).
//   node tests/ai_chat_history.test.js http://127.0.0.1:8796/ [shotsDir]
const { chromium } = require(process.env.PW || '/workspace/shot-tools/node_modules/playwright-core');
const BASE = process.argv[2] || 'http://127.0.0.1:8796/'; const SHOTS = process.argv[3] || '/workspace/shots-si-e';
const assert = (c, m) => { if (!c) throw new Error('FAIL: ' + m); console.log('ok -', m); };
(async () => {
  const b = await chromium.launch({ executablePath: '/usr/bin/google-chrome', headless: true, args: ['--no-sandbox'] });
  const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, timezoneId: 'America/Chicago', locale: 'en-US', isMobile: true, hasTouch: true, reducedMotion: 'reduce' });
  await ctx.route('**/config.js', r => r.fulfill({ contentType: 'application/javascript', body: "window.CALENDAR_CONFIG = { AI_ENDPOINT: 'https://ai.test/fn' };" }));
  let next = null, hold = null; const sent = []; const ext = [];
  await ctx.route('https://ai.test/fn', async r => { sent.push(JSON.parse(r.request().postData())); if (hold) await hold; await r.fulfill({ contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify(next(sent.at(-1))) }); });
  const p = await ctx.newPage(); const errs = []; p.on('pageerror', e => errs.push(e.message));
  p.on('request', q => { const u = new URL(q.url()); if (!/^(127\.0\.0\.1|localhost)$/.test(u.hostname) && u.hostname !== 'ai.test' && !u.protocol.startsWith('data')) ext.push(q.url()); });
  await p.clock.install({ time: new Date('2026-11-16T15:00:00Z') }); // Mon Nov 16, 9 AM CT
  await p.goto(BASE + '?tab=today'); await p.waitForFunction(() => window.__app && window.SandyNav);
  await p.evaluate(() => localStorage.clear()); await p.reload(); await p.waitForFunction(() => window.__app && window.SandyAI);
  const openSheet = async () => { await p.tap('#aiBtn'); await p.waitForSelector('#aiSheet:not([hidden])'); };
  const ask = async (text, reply) => { next = () => reply; const n = sent.length; await p.fill('#aiText', text); await p.tap('#aiSend'); await p.waitForFunction(n => window.SandyAI && document.querySelectorAll('.ai-msg.typing').length === 0 && n, n + 1); await p.waitForTimeout(400); };
  const saved = () => p.evaluate(() => JSON.parse(localStorage.getItem('sandy.aiChats.v1') || '[]'));
  const shot = n => p.screenshot({ path: `${SHOTS}/${n}.png` });

  await openSheet();
  assert(await p.$('#aiHist') && await p.$('#aiNew'), 'History and New chat buttons in the sheet');
  const fit = await p.evaluate(() => { const q = document.querySelector('.ai-quick'); return [...q.querySelectorAll('button')].every(x => x.getBoundingClientRect().top === q.querySelector('button').getBoundingClientRect().top && x.getBoundingClientRect().right <= 390); });
  assert(fit, 'Brief me / History / New chat fit on one row at 390px');
  await p.tap('#aiHist'); await p.waitForSelector('.ai-hist-msg:not(.ai-hist-loading)');
  assert(/No saved chats yet/.test(await p.$eval('#aiHistPanel', e => e.innerText)) && /Saved on this device/.test(await p.$eval('#aiHistPanel', e => e.innerText)), 'empty history: friendly message, says where chats are kept');
  await p.tap('#aiHist'); assert(await p.$eval('#aiHistPanel', e => e.hidden), 'History toggles closed');
  await p.tap('#aiBrief'); await p.waitForTimeout(300);
  assert((await saved()).length === 0, 'Brief me alone (on-device) is not saved as a chat');

  // chat 1: a question + a proposal that gets confirmed
  await p.clock.setSystemTime(new Date('2026-11-14T22:30:00Z')); // Sat 4:30 PM (shows as an older chat)
  await ask('What do I have Saturday afternoon?', { reply: 'Just film with Nick at 4 PM.', proposals: [] });
  await ask('Add lift with Nick Saturday 6pm', { reply: 'Tap Confirm to save.', proposals: [{ type: 'add', title: 'Lift with Nick', calendar: 'mam', start: '2026-11-14T18:00', end: '2026-11-14T19:00', summary: 'Add lift with Nick, Sat 6–7 PM' }] });
  await p.tap('.ai-card [data-ok]'); await p.waitForSelector('.ai-card-status'); await p.waitForTimeout(400);
  let s = await saved();
  assert(s.length === 1 && s[0].title === 'What do I have Saturday afternoon?', 'chat saved after the first message, titled from it');
  assert(s[0].messages.length === 5 && s[0].messages[4].note === 1 && /I confirmed: Add lift with Nick/.test(s[0].messages[4].content), 'messages + confirm note saved: ' + s[0].messages.map(m => m.role[0]).join(''));
  const id1 = s[0].id;

  // New chat
  await p.clock.setSystemTime(new Date('2026-11-16T15:05:00Z'));
  const calls0 = sent.length; await p.tap('#aiNew');
  assert(await p.$$eval('#aiLog .ai-msg', m => m.length === 1 && /Hi, I’m Sandy Intelligence/.test(m[0].textContent)), 'New chat: empty log with the greeting');
  assert(await p.evaluate(() => window.SandyAI.current().id === null && window.SandyAI.current().history.length === 0), 'New chat: fresh history');
  const long = 'Can you move my Tuesday meeting with Bill to Wednesday at 3pm, and also remind me to bring the resistance bands to practice';
  await ask(long, { reply: 'Which meeting with Bill?', proposals: [] });
  assert(sent.at(-1).messages.length === 1, 'New chat: the AI gets only the new conversation');
  assert(Object.keys(sent.at(-1).messages[0]).join() === 'role,content', 'only role/content sent to the AI');
  s = await saved(); const c2 = s.find(c => c.id !== id1);
  assert(s.length === 2 && c2.title.length <= 60 && c2.title.endsWith('…') && long.startsWith(c2.title.slice(0, -1)), 'long first message -> 60-char title: ' + c2.title);

  // history list
  await p.tap('#aiHist'); await p.waitForSelector('.ai-hist-row');
  const rows = await p.$$eval('.ai-hist-row', r => r.map(x => ({ t: x.querySelector('.ai-hist-title').textContent, w: x.querySelector('.ai-hist-when').textContent, cur: x.classList.contains('current') })));
  assert(rows.length === 2 && rows[0].cur && rows[0].w === 'Today 9:05 AM · open now' && rows[1].t === 'What do I have Saturday afternoon?' && rows[1].w === 'Sat, Nov 14', 'history: newest first, open chat marked, dates: ' + JSON.stringify(rows));
  await p.waitForTimeout(200); await shot('history_light');

  // open the older chat
  await p.tap(`[data-open="${id1}"]`); await p.waitForFunction(() => document.getElementById('aiHistPanel').hidden);
  const log = await p.$$eval('#aiLog .ai-msg', m => m.map(x => x.className.replace('ai-msg ', '') + ':' + x.textContent));
  assert(/ai-resumed:What do I have Saturday afternoon\? · Sat, Nov 14/.test(log[0]), 'reopened chat: header with title + date');
  assert(log[1] === 'user:What do I have Saturday afternoon?' && log[2] === 'assistant:Just film with Nick at 4 PM.' && log[5] === 'note:I confirmed: Add lift with Nick, Sat 6–7 PM', 'reopened chat: messages and confirm note restored');
  assert(sent.length === calls0 + 1, 'History, New chat and opening a chat made no AI calls');
  await shot('reopened_light');
  await ask('Thanks! Anything else Saturday?', { reply: 'Nope, that’s it.', proposals: [] });
  assert(sent.at(-1).messages.length === 6 && sent.at(-1).messages[0].content === 'What do I have Saturday afternoon?', 'follow-up in a reopened chat carries its history');
  s = await saved(); assert(s.length === 2 && s.find(c => c.id === id1).messages.length === 7 && s[0].id === id1, 'reopened chat updated in place and moves to the top');

  // waiting for a reply: can't switch chats
  let rel; hold = new Promise(r => (rel = r));
  next = () => ({ reply: 'ok', proposals: [] }); await p.fill('#aiText', 'One more'); await p.tap('#aiSend'); await p.waitForSelector('.ai-msg.typing');
  assert(await p.$eval('#aiNew', e => e.disabled) && await p.$eval('#aiHist', e => e.disabled), 'New chat / History disabled while waiting for a reply');
  rel(); hold = null; await p.waitForFunction(() => !document.querySelector('.ai-msg.typing')); await p.waitForTimeout(300);
  assert(!(await p.$eval('#aiNew', e => e.disabled)), 'buttons back after the reply');

  // failed send is not kept
  next = () => { throw new Error('x'); };
  await ctx.unroute('https://ai.test/fn'); await ctx.route('https://ai.test/fn', r => { sent.push(JSON.parse(r.request().postData())); r.fulfill({ status: 429, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify({ error: 'Daily AI limit reached (50 requests).' }) }); });
  await p.fill('#aiText', 'This will fail'); await p.tap('#aiSend'); await p.waitForSelector('.ai-msg.error'); await p.waitForTimeout(500);
  assert(!(await saved()).find(c => c.id === id1).messages.some(m => m.content === 'This will fail'), 'a message that failed to send is not kept in history');

  await p.tap('#aiNew'); await p.fill('#aiText', 'First message fails'); await p.tap('#aiSend'); await p.waitForSelector('#aiLog .ai-msg.error'); await p.waitForTimeout(600);
  assert((await saved()).length === 2 && !(await saved()).some(c => c.title === 'First message fails'), 'a new chat whose only message failed is not kept');
  await p.tap('#aiHist'); await p.waitForSelector('.ai-hist-row'); await p.tap(`[data-open="${id1}"]`); await p.waitForFunction(() => document.getElementById('aiHistPanel').hidden);
  // delete: two taps
  await p.tap('#aiHist'); await p.waitForSelector('.ai-hist-row');
  const other = (await saved()).find(c => c.id !== id1).id;
  await p.tap(`[data-del="${other}"]`);
  assert(await p.$eval(`[data-del="${other}"]`, e => e.textContent === 'Delete?') && (await saved()).length === 2, 'first tap asks "Delete?"');
  await p.waitForTimeout(150); await shot('history_delete_confirm_light');
  await p.tap(`[data-del="${other}"]`); await p.waitForFunction(() => document.querySelectorAll('.ai-hist-row').length === 1);
  assert((await saved()).length === 1, 'second tap deletes the chat');
  await p.tap(`[data-del="${id1}"]`); await p.tap(`[data-del="${id1}"]`); await p.waitForSelector('.ai-hist-msg:not(.ai-hist-loading)');
  assert((await saved()).length === 0 && await p.evaluate(() => window.SandyAI.current().id === null), 'deleting the open chat starts a fresh one');
  await p.tap('#aiHist');
  assert(await p.$$eval('#aiLog .ai-msg', m => m.length === 1), '...with just the greeting');

  // persists across reloads; dark mode
  await ctx.unroute('https://ai.test/fn'); await ctx.route('https://ai.test/fn', async r => { sent.push(JSON.parse(r.request().postData())); await r.fulfill({ contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify(next(sent.at(-1))) }); });
  await ask('Plan my week', { reply: 'Sure.', proposals: [] });
  assert((await saved()).length === 1, 'chat saved once the AI answers');
  await p.reload(); await p.waitForFunction(() => window.SandyAI); await p.evaluate(() => window.SandyNav.setDark(true));
  await openSheet(); assert(await p.$$eval('#aiLog .ai-msg', m => m.length === 1), 'after reload the sheet starts a new chat');
  await p.tap('#aiHist'); await p.waitForSelector('.ai-hist-row');
  assert((await p.$$eval('.ai-hist-title', t => t.map(x => x.textContent))).join() === 'Plan my week', 'saved chats survive a reload');
  await p.waitForTimeout(200); await shot('history_dark');
  await p.tap('.ai-hist-open'); await p.waitForTimeout(200); await shot('reopened_dark');
  assert(!errs.length, 'no page errors: ' + errs.join(' | '));
  assert(!ext.length, 'no outside network calls: ' + ext.join(' '));
  await b.close(); console.log('AI CHAT HISTORY TESTS PASSED');
})().catch(e => { console.error(e); process.exit(1); });
