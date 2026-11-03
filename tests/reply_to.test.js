// t179u item 4: reply to one Sandy Intelligence message. Swipe it right, or long-press it → Reply. A quote chip with ×
// sits above the box (works with any of several SI messages), the quote (≤600 chars) goes to the model as
// "Replying to: “…”", shows in the sent bubble and is kept in saved chats. Small enter/leave animations.
// Model mocked ($0). iPhone, iPad, Android phone + tablet, light + dark.   node tests/reply_to.test.js BASE [SHOTS] [device]
const PW = require(process.env.PW || '/usr/local/lib/pnpm/5/.pnpm/playwright-core@1.59.1/node_modules/playwright-core');
const fs = require('fs');
const BASE = process.argv[2] || 'http://127.0.0.1:8860/';
const SHOTS = process.argv[3] || '/workspace/shots-oct29/reply-to'; fs.mkdirSync(SHOTS, { recursive: true });
const only = process.argv[4] || '';
let n = 0; const ok = (c, m) => { if (!c) throw new Error('FAIL: ' + m); n++; console.log('ok -', m); };
const DEV = [['iphone', 'webkit', 393, 852], ['ipad', 'webkit', 820, 1180], ['android-phone', 'chromium', 412, 915], ['android-tablet', 'chromium', 800, 1280]];
const NOW = '2026-11-02T21:00:00Z';
const A1 = 'Option one: Tuesday at 3 PM. Option two: Wednesday at 10 AM.';
const A2 = 'Also, lunch with Sam is at noon tomorrow.';
const LONG = 'Long note. ' + 'This sentence repeats to make the message long. '.repeat(25);
(async () => {
  const B = {}; const errs = [];
  try {
    for (const [name, eng, w, h] of DEV) for (const dark of [false, true]) {
      if (only && name !== only) continue;
      B[eng] = B[eng] || (eng === 'webkit' ? await PW.webkit.launch() : await PW.chromium.launch({ executablePath: '/usr/bin/google-chrome', args: ['--no-sandbox'] }));
      const tag = `${name}-${dark ? 'dark' : 'light'}`; console.log('#', tag);
      const ctx = await B[eng].newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 2, isMobile: eng === 'chromium', hasTouch: true, serviceWorkers: 'block', timezoneId: 'America/Chicago', colorScheme: dark ? 'dark' : 'light' });
      await ctx.route('**/config.js', r => r.fulfill({ contentType: 'application/javascript', body: "window.CALENDAR_CONFIG = { AI_ENDPOINT: '/__ai/fn' };" }));
      let reply = null; const sent = [];
      await ctx.route('**/__ai/fn', async r => { const body = JSON.parse(r.request().postData()); sent.push(body); await r.fulfill({ contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify(reply(body)) }); });
      await ctx.addInitScript(d => { if (sessionStorage.getItem('__i')) return; sessionStorage.setItem('__i', '1'); localStorage.clear(); localStorage.setItem('sandy.welcome.off', '1'); localStorage.setItem('sandy.tour.off', '1'); if (d) localStorage.setItem('sandy.theme', 'dark'); }, dark);
      const p = await ctx.newPage(); p.on('pageerror', e => { if (!/ResizeObserver loop/.test(e.message)) errs.push(`${tag}: ${e.message}`); });
      await p.clock.install({ time: new Date(NOW) });
      await p.goto(BASE + '?view=listWeek'); await p.waitForFunction(() => window.__app && window.Store && window.SandyAI);
      const ask = async (text, r) => {
        reply = () => r; const nb = sent.length;
        await p.fill('#aiText', text); await p.click('#aiSend');
        await p.waitForFunction(() => !document.querySelector('#aiLog .thinking'), null, { timeout: 8000 });
        ok(sent.length === nb + 1, `${tag}: "${text}" sent`); await p.waitForTimeout(450 + (r.proposals || []).length * 200);
        return sent[sent.length - 1];
      };
      const bubble = txt => p.evaluateHandle(t => [...document.querySelectorAll('#aiLog .ai-msg.assistant')].reverse().find(e => e.textContent.includes(t)), txt);
      const swipe = async (el, dx, dy = 0, mid) => {
        await el.evaluate(e => { const l = document.getElementById('aiLog').getBoundingClientRect(), r = e.getBoundingClientRect(); if (r.bottom < l.top + 40 || r.top > l.bottom - 40) e.scrollIntoView({ block: 'nearest' }); }); await p.waitForTimeout(350);
        const b = await el.boundingBox(); const lt = await p.$eval('#aiLog', l => { const r = l.getBoundingClientRect(); return [r.top, r.bottom]; });
        const top = Math.max(b.y, lt[0]), bot = Math.min(b.y + b.height, lt[1]); const x = b.x + 30, y = top + Math.min((bot - top) / 2, 30);
        await p.mouse.move(x, y); await p.mouse.down();
        for (let i = 1; i <= 8; i++) await p.mouse.move(x + dx * i / 8, y + dy * i / 8);
        if (mid) await mid();
        await p.mouse.up(); await p.waitForTimeout(320);
      };
      const press = async el => { await el.evaluate(e => e.scrollIntoView({ block: 'nearest' })); await p.waitForTimeout(350); const b = await el.boundingBox(); await p.mouse.move(b.x + 30, b.y + Math.min(b.height / 2, 30)); await p.mouse.down(); await p.waitForTimeout(650); await p.mouse.up(); await p.waitForTimeout(250); };
      const chip = () => p.evaluate(() => { const c = document.getElementById('aiReply'); const f = document.getElementById('aiForm').getBoundingClientRect(); const r = c.getBoundingClientRect(); return { shown: !c.hidden, q: document.getElementById('aiReplyQ').textContent, cls: c.className, bottom: r.bottom, formTop: f.top, w: innerWidth, right: r.right, qh: document.getElementById('aiReplyQ').getBoundingClientRect().height, lh: parseFloat(getComputedStyle(document.getElementById('aiReplyQ')).lineHeight), bg: getComputedStyle(c).backgroundColor, focus: document.activeElement && document.activeElement.id }; });

      await p.click('#aiBtn'); await p.waitForSelector('#aiSheet:not([hidden])'); await p.waitForTimeout(450);
      await ask('what are my options?', { reply: A1, proposals: [] });
      await ask('anything else?', { reply: A2, proposals: [] });

      // 1. swipe right on the first answer -> chip with its text (enter animation), box focused
      let shot = false;
      await swipe(await bubble('Option one'), 90, 4, async () => {
        const m = await p.evaluate(() => { const e = [...document.querySelectorAll('#aiLog .ai-msg.assistant')].find(x => x.textContent.includes('Option one')); return { t: e.style.transform, rp: +getComputedStyle(e).getPropertyValue('--rp'), sw: e.classList.contains('ai-swiping') }; });
        ok(m.sw && /translateX\((5[6-9]|[6-8]\d)/.test(m.t) && m.rp === 1, `${tag}: bubble follows the finger, ↩ shows (${m.t}, rp ${m.rp})`);
        if (!shot) { shot = true; await p.screenshot({ path: `${SHOTS}/${tag}-1-swipe.png` }); }
      });
      await p.waitForFunction(() => !document.getElementById('aiReply').getAnimations().some(a => a.playState === 'running'), null, { timeout: 3000 }).catch(() => {});
      let c = await chip();
      ok(c.shown && c.q === A1 && /ai-reply-in/.test(c.cls), `${tag}: swipe right → chip quotes that message, slides in`);
      ok(c.bottom <= c.formTop + 1 && c.right <= c.w, `${tag}: chip sits above the box, inside the screen`);
      ok(c.focus === 'aiText', `${tag}: the box is focused to type the reply`);
      ok(await p.evaluate(() => { const e = [...document.querySelectorAll('#aiLog .ai-msg.assistant')].find(x => x.textContent.includes('Option one')); return !e.style.transform; }), `${tag}: bubble springs back`);
      ok(dark ? !/255, 255, 255|245, 243, 255/.test(c.bg) : /245, 243, 255/.test(c.bg), `${tag}: chip colours fit the ${dark ? 'dark' : 'light'} theme (${c.bg})`);
      await p.screenshot({ path: `${SHOTS}/${tag}-2-chip.png` });

      // 2. × removes it with a leave animation
      await p.click('#aiReplyX'); c = await chip();
      ok(c.shown && /ai-reply-out/.test(c.cls), `${tag}: × starts the leave animation`);
      await p.waitForFunction(() => document.getElementById("aiReply").hidden, null, { timeout: 1500 }).catch(() => {}); c = await chip(); const rq0 = await p.evaluate(() => SandyAI.replyQuote()); ok(!c.shown && !rq0, `${tag}: × removes the quote (${c.shown} ${c.cls} ${rq0})`);

      // 3. a short swipe, a vertical drag, a left swipe, and a swipe on my own bubble do nothing
      await swipe(await bubble('Option one'), 30); ok(!(await chip()).shown, `${tag}: short swipe (30px) does nothing`);
      await swipe(await bubble('Option one'), 12, 80); ok(!(await chip()).shown, `${tag}: a mostly vertical drag does nothing`);
      await swipe(await bubble('Option one'), -90); ok(!(await chip()).shown, `${tag}: swipe left does nothing`);
      const mine = await p.$('#aiLog .ai-msg.user'); await swipe(mine, 90); ok(!(await chip()).shown, `${tag}: my own messages aren't repliable`);

      // 4. long-press the second answer -> menu (Reply, Copy) -> Reply
      await press(await bubble('lunch with Sam'));
      await p.waitForFunction(() => { const m = document.querySelector('.ai-menu'); return !m || !m.getAnimations().some(x => x.playState === 'running'); }, null, { timeout: 3000 }).catch(() => {});
      let mu = await p.evaluate(() => { const m = document.querySelector('.ai-menu'); if (!m) return null; const r = m.getBoundingClientRect(); return { items: [...m.querySelectorAll('button')].map(b => b.textContent), anim: m.classList.contains('ai-menu-in') || matchMedia('(prefers-reduced-motion: reduce)').matches, inside: r.left >= 0 && r.right <= innerWidth && r.top >= 0 && r.bottom <= innerHeight, pressed: !!document.querySelector('.ai-msg.ai-pressed'), h: Math.min(...[...m.querySelectorAll('button')].map(b => b.getBoundingClientRect().height)) }; });
      ok(mu && mu.items.join('|') === '↩ Reply|Copy' && mu.anim && mu.inside && mu.pressed && mu.h >= 44, `${tag}: long-press → menu with Reply / Copy, on screen, 44px targets (${JSON.stringify(mu)})`);
      await p.evaluate(() => getSelection().removeAllRanges()); await p.screenshot({ path: `${SHOTS}/${tag}-3-menu.png` });
      await p.keyboard.press('Escape'); await p.waitForFunction(() => !document.querySelector('.ai-menu'), null, { timeout: 1000 }).catch(() => {}); // the menu fades out (120 ms; 200 ms fallback)
      ok(!(await p.$('.ai-menu')) && await p.isVisible('#aiSheet .ai-panel'), `${tag}: Escape closes the menu, not the sheet`);
      await press(await bubble('lunch with Sam')); await p.click('.ai-menu [data-act="reply"]'); await p.waitForFunction(() => !document.querySelector('.ai-menu') && !document.getElementById('aiReply').hidden, null, { timeout: 1000 }).catch(() => {}); await p.waitForTimeout(60);
      c = await chip(); ok(c.shown && c.q === A2 && !(await p.$('.ai-menu')), `${tag}: Reply → chip quotes the second answer`);

      // 5. replying to another message swaps the quote
      await swipe(await bubble('Option one'), 90); c = await chip();
      ok(c.shown && c.q === A1 && /ai-reply-swap/.test(c.cls), `${tag}: swiping another message swaps the quote`);

      // 6. send: the model gets "Replying to: “…”", the bubble shows the quote, the chip goes
      let body = await ask('the second one please', { reply: 'Wednesday at 10 it is.', proposals: [] });
      const last = body.messages[body.messages.length - 1].content;
      ok(last === `Replying to: “${A1}”\n\nthe second one please`, `${tag}: model gets "Replying to: “…”" + my text`);
      ok(body.messages.filter(m => /^Replying to:/.test(m.content)).length === 1, `${tag}: only that message carries the quote`);
      await p.waitForFunction(() => document.getElementById("aiReply").hidden, null, { timeout: 1500 }).catch(() => {}); c = await chip(); ok(!c.shown, `${tag}: chip clears after sending`);
      const ub = await p.evaluate(() => { const u = [...document.querySelectorAll('#aiLog .ai-msg.user')].pop(); const q = u.querySelector('.ai-quote'); return { q: q && q.textContent, rest: u.lastChild.textContent }; });
      ok(ub.q === A1 && ub.rest === 'the second one please', `${tag}: sent bubble shows the quote above my text`);
      const lq = await p.evaluate(() => { const u = [...document.querySelectorAll('#aiLog .ai-msg.user')].pop(); const q = u.querySelector('.ai-quote'); const k = q.cloneNode(true); k.textContent = 'word '.repeat(200); u.appendChild(k); const cs = getComputedStyle(k); const r = { h: k.clientHeight, lh: parseFloat(cs.lineHeight), pt: parseFloat(cs.paddingTop), pb: parseFloat(cs.paddingBottom) }; k.remove(); return r; });
      ok(lq.h - lq.pt - lq.pb <= lq.lh * 3 + 1, `${tag}: a long quote in a bubble shows exactly 3 lines, no 4th-line sliver (${JSON.stringify(lq)})`);
      // the next plain message carries no quote
      body = await ask('thanks', { reply: 'Anytime!', proposals: [] });
      ok(!/^Replying to/.test(body.messages[body.messages.length - 1].content), `${tag}: next message has no quote`);

      // 7. a long message: quote capped at 600 chars, chip clamps to 2 lines
      await ask('tell me more', { reply: LONG, proposals: [] });
      await swipe(await bubble('Long note.'), 90); c = await chip();
      const rq = await p.evaluate(() => SandyAI.replyQuote());
      ok(rq.length <= 600 && rq.endsWith('…') && rq.startsWith('Long note.'), `${tag}: quote capped at 600 chars (${rq.length})`);
      ok(c.qh <= c.lh * 2 + 2, `${tag}: chip shows at most 2 lines (${c.qh}px)`);
      body = await ask('shorter', { reply: 'Sure.', proposals: [] });
      ok(body.messages[body.messages.length - 1].content.length <= 600 + 20 + 'shorter'.length, `${tag}: long quote sent capped`);

      // 8. a suggestion card can be quoted; a press on its buttons doesn't open the menu
      await ask('add gym friday 7am', { reply: 'Here it is.', proposals: [{ type: 'add', title: 'Gym', calendar: 'msc', start: '2026-11-06T07:00', end: '2026-11-06T08:00', summary: 'Add Gym Fri 7–8 AM' }] });
      const card = await p.$('#aiLog .ai-card:last-of-type') || (await p.$$('#aiLog .ai-card')).pop();
      const cb = await (await p.$$('#aiLog .ai-card')).pop().$('[data-no]'); const bb = await cb.boundingBox();
      await p.mouse.move(bb.x + 10, bb.y + 10); await p.mouse.down(); await p.waitForTimeout(650); await p.mouse.up(); await p.waitForTimeout(200);
      ok(!(await p.$('.ai-menu')), `${tag}: holding a card button doesn't open the menu`);
      await swipe((await p.$$('#aiLog .ai-card')).pop(), 90, 0); c = await chip();
      ok(c.shown && c.q === 'Suggestion: Add Gym Fri 7–8 AM', `${tag}: a suggestion card can be quoted (“${c.q}”)`);
      await p.click('#aiReplyX'); await p.waitForTimeout(250);

      // 9. saved chats keep the quote
      await p.waitForTimeout(400);
      const hist = await p.evaluate(() => SandyAI.current());
      ok(hist.history.filter(m => m.replyTo).length === 2 && hist.history.find(m => m.replyTo === A1), `${tag}: chat history keeps replyTo`);
      await p.click('#aiNew'); await p.waitForTimeout(400);
      ok(!(await chip()).shown, `${tag}: New chat starts with no quote`);
      await p.click('#aiHist'); await p.waitForSelector('#aiHistPanel [data-open]');
      await p.click(`#aiHistPanel [data-open="${hist.id}"]`); await p.waitForTimeout(500);
      const re = await p.evaluate(() => [...document.querySelectorAll('#aiLog .ai-msg.user')].map(u => u.querySelector('.ai-quote') && u.querySelector('.ai-quote').textContent).filter(Boolean));
      ok(re.length === 2 && re[0] === (A1), `${tag}: reopened chat shows the quotes`);
      body = await ask('and again', { reply: 'Ok.', proposals: [] });
      ok(body.messages.some(m => m.content === `Replying to: “${A1}”\n\nthe second one please`), `${tag}: reopened chat still sends the quote to the model`);
      // replying still works in a reopened chat
      await swipe(await bubble('Wednesday at 10'), 90); c = await chip(); ok(c.shown && c.q === 'Wednesday at 10 it is.', `${tag}: can reply in a reopened chat`);
      await p.screenshot({ path: `${SHOTS}/${tag}-4-reopened.png` });
      await p.click('#aiReplyX'); await p.waitForTimeout(250);
      await p.evaluate(() => SandyAI.newChat()); await p.waitForTimeout(300);
      // scroll back to show the sent quote bubble for a screenshot
      await p.click('#aiHist'); await p.waitForSelector('#aiHistPanel [data-open]'); await p.click(`#aiHistPanel [data-open="${hist.id}"]`); await p.waitForTimeout(400);
      await p.evaluate(() => { const u = [...document.querySelectorAll('#aiLog .ai-msg.user')].find(x => x.querySelector('.ai-quote')); u.scrollIntoView({ block: 'center' }); });
      await p.waitForTimeout(300); await p.screenshot({ path: `${SHOTS}/${tag}-5-sent-quote.png` });
      await ctx.close();

      // 10. reduced motion: no animations, still works (one context per engine, light only)
      if (!dark) {
        const c2 = await B[eng].newContext({ viewport: { width: w, height: h }, isMobile: eng === 'chromium', hasTouch: true, serviceWorkers: 'block', timezoneId: 'America/Chicago', reducedMotion: 'reduce' });
        await c2.route('**/config.js', r => r.fulfill({ contentType: 'application/javascript', body: "window.CALENDAR_CONFIG = { AI_ENDPOINT: '/__ai/fn' };" }));
        await c2.addInitScript(() => { if (sessionStorage.getItem('__i')) return; sessionStorage.setItem('__i', '1'); localStorage.clear(); localStorage.setItem('sandy.welcome.off', '1'); localStorage.setItem('sandy.tour.off', '1'); });
        const q = await c2.newPage(); q.on('pageerror', e => { if (!/ResizeObserver loop/.test(e.message)) errs.push(`${tag} rm: ${e.message}`); });
        await q.goto(BASE + '?view=listWeek'); await q.waitForFunction(() => window.SandyAI && window.__app);
        await q.click('#aiBtn'); await q.waitForSelector('#aiSheet:not([hidden])');
        const g = await q.$('#aiLog .ai-msg.assistant'); const b = await g.boundingBox();
        await q.mouse.move(b.x + 30, b.y + 15); await q.mouse.down(); for (let i = 1; i <= 8; i++) await q.mouse.move(b.x + 30 + 12 * i, b.y + 15); await q.mouse.up();
        const r = await q.evaluate(() => { const c = document.getElementById('aiReply'); return { shown: !c.hidden, cls: c.className }; });
        ok(r.shown && !/ai-reply-in/.test(r.cls), `${tag}: reduced motion — reply works, no animation`);
        await q.click('#aiReplyX'); ok(await q.evaluate(() => document.getElementById('aiReply').hidden), `${tag}: reduced motion — × hides at once`);
        await c2.close();
      }
    }
  } finally { for (const b of Object.values(B)) await b.close(); }
  if (errs.length) { console.log('FAIL page errors\n' + errs.join('\n')); process.exit(1); }
  console.log(`PASS ${n} checks`);
})().catch(e => { console.error(e); process.exit(1); });
