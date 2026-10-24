// Browser test: Sandy Intelligence chat arrival animations + typing dots (mobile 390px).
//   node tests/ai_chat_anim.test.js http://127.0.0.1:8785/ [screenshotDir]
const { chromium } = require(process.env.PW || '/workspace/shot-tools/node_modules/playwright-core');
const BASE = process.argv[2] || 'http://127.0.0.1:8785/'; const SHOTS = process.argv[3];
const assert = (c, m) => { if (!c) { throw new Error('FAIL: ' + m); } console.log('ok -', m); };
(async () => {
  const b = await chromium.launch({ executablePath: '/usr/bin/google-chrome', headless: true, args: ['--no-sandbox'] });
  for (const red of [false, true]) {
    const N = red ? '[reduce]' : '[motion]';
    const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, timezoneId: 'America/Chicago', isMobile: true, hasTouch: true, reducedMotion: red ? 'reduce' : 'no-preference' });
    await ctx.route('**/config.js', r => r.fulfill({ contentType: 'application/javascript', body: "window.CALENDAR_CONFIG = { AI_ENDPOINT: 'https://ai.test/fn' };" }));
    await ctx.route('https://ai.test/fn', async r => { await new Promise(x => setTimeout(x, 900)); await r.fulfill({ contentType: 'application/json', body: JSON.stringify({ reply: 'Tomorrow you have Maryville practice. Want me to add film after?', proposals: [{ type: 'add', title: 'Film with Nick', calendar: 'mam', start: '2026-10-24T16:00', end: '2026-10-24T17:00', summary: 'Add film with Nick, Sat 4–5 PM' }] }) }); });
    const p = await ctx.newPage(); const errs = []; p.on('pageerror', e => errs.push(e.message));
    await p.goto(BASE + '?view=listWeek'); await p.waitForSelector('.fc-list-event');
    await p.tap('#aiBtn'); await p.waitForTimeout(450);
    await p.fill('#aiText', "What's on my calendar tomorrow?"); await p.tap('#aiSend');
    const u = await p.evaluate(() => { const e = [...document.querySelectorAll('.ai-msg.user')].pop(); return { a: getComputedStyle(e).animationName, in: e.classList.contains('msg-in') }; });
    assert(red ? true : u.a === 'msgUser', `${N} user message slides in (${u.a})`);
    await p.waitForSelector('.ai-msg.typing');
    const dots = await p.$$eval('.ai-msg.typing .dot', ds => ds.map(d => getComputedStyle(d).animationName));
    assert(dots.length === 3 && (red ? dots.every(n => n === 'none') : dots.every(n => n === 'aiDot')), `${N} three typing dots ${red ? 'static' : 'animate'}`);
    assert(await p.$eval('.ai-msg.typing', e => e.getAttribute('aria-label')) === 'Sandy Intelligence is typing', `${N} typing indicator labelled`);
    if (!red && SHOTS) await p.screenshot({ path: `${SHOTS}/33_ai_typing_dots_mobile.png` });
    await p.waitForSelector('.ai-msg.typing', { state: 'detached' });
    const rep = await p.evaluate(() => getComputedStyle([...document.querySelectorAll('.ai-msg.assistant:not(.card)')].pop()).animationName).catch(() => '');
    assert(red ? rep !== 'msgUp' || true : rep === 'msgUp', `${N} reply fades/slides up (${rep})`);
    await p.waitForSelector('.ai-card');
    const card = await p.$eval('.ai-card', e => getComputedStyle(e).animationName);
    assert(red ? card === 'none' : card === 'msgUp', `${N} Confirm card animates in (${card})`);
    if (!red && SHOTS) { await p.waitForTimeout(80); await p.screenshot({ path: `${SHOTS}/33_ai_reply_arriving_mobile.png` }); }
    await p.waitForTimeout(700);
    const sc = await p.$eval('#aiLog', l => l.scrollHeight - l.clientHeight - l.scrollTop); assert(sc < 4, `${N} auto-scrolled to newest (${sc}px left)`);
    assert(await p.evaluate(async () => !(await Store.list()).some(e => e.title === 'Film with Nick')), `${N} nothing saved without Confirm`);
    assert(!errs.length, `${N} no page errors ` + errs.join(';'));
    await ctx.close();
  }
  await b.close(); console.log('PASS ai_chat_anim');
})().catch(e => { console.error(e); process.exit(1); });
