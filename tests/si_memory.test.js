// t179u item 3: Sandy Intelligence remembers what you confirmed in this chat, "every other week" really saves interval 2,
// and a separate follow-up ("actually continue until July 2027") extends the series it just made. The model is mocked
// (no AI calls, $0); the mock only answers from what the app SENDS, so the checks prove the memory travels with the
// request. iPhone, iPad, Android phone + tablet, light + dark.   node tests/si_memory.test.js BASE [SHOTS] [device]
const PW = require(process.env.PW || '/usr/local/lib/pnpm/5/.pnpm/playwright-core@1.59.1/node_modules/playwright-core');
const fs = require('fs');
const BASE = process.argv[2] || 'http://127.0.0.1:8850/';
const SHOTS = process.argv[3] || '/workspace/shots-oct29/si-memory'; fs.mkdirSync(SHOTS, { recursive: true });
const only = process.argv[4] || '';
let n = 0; const ok = (c, m) => { if (!c) throw new Error('FAIL: ' + m); n++; console.log('ok -', m); };
const DEV = [['iphone', 'webkit', 393, 852], ['ipad', 'webkit', 820, 1180], ['android-phone', 'chromium', 412, 915], ['android-tablet', 'chromium', 800, 1280]];
const NOW = '2026-11-02T21:00:00Z'; // Mon Nov 2, 3 PM CT
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
      await p.goto(BASE + '?view=listWeek'); await p.waitForFunction(() => window.__app && window.Store && window.SandySeries && window.SandyAI);
      await p.evaluate(() => Store.removeWhere(() => true)); await p.reload(); await p.waitForFunction(() => window.SandyAI && window.__app);
      const cards = () => p.$$eval('#aiLog .ai-card', e => e.length);
      const ask = async (text, mk, wantCard = true) => {
        reply = mk; const before = await cards(); const nb = sent.length;
        await p.fill('#aiText', text); await p.click('#aiSend');
        await p.waitForFunction(k => !document.querySelector('#aiLog .thinking'), null, { timeout: 8000 });
        if (wantCard) await p.waitForFunction(k => document.querySelectorAll('#aiLog .ai-card').length > k, before, { timeout: 8000 });
        else await p.waitForFunction(k => k, sent.length > nb);
        await p.waitForTimeout(450); return wantCard ? p.$$('#aiLog .ai-card').then(a => a[a.length - 1]) : null;
      };
      const dl = card => card.$$eval('dt', ds => ds.map(d => `${d.textContent}: ${d.nextElementSibling.textContent}`));
      const prac = () => p.evaluate(() => Store.list().then(l => l.find(e => e.title === 'QA practice') || null));
      const occs = (a, b) => p.evaluate(([a, b]) => Store.list().then(l => { const ev = l.find(e => e.title === 'QA practice'); return ev ? __app.occurrences(ev, __app.parseLocal(a), __app.parseLocal(b)).map(o => o.key) : []; }), [a, b]);
      await p.click('#aiBtn'); await p.waitForSelector('#aiSheet:not([hidden])'); await p.waitForTimeout(400);

      // 1. "every other Tuesday" -> card shows the real rule; Confirm saves interval 2 (was always 1)
      let card = await ask('add QA practice every other Tuesday 6-7pm until Dec 15', b => {
        ok(!b.context.saved || b.context.saved.length === 0, `${tag}: nothing remembered in a new chat`);
        return { reply: 'Here it is. Tap Confirm to save.', proposals: [{ type: 'add', title: 'QA practice', calendar: 'msc', start: '2026-11-03T18:00', end: '2026-11-03T19:00', repeat: { freq: 'weekly', byWeekday: [2], interval: 2, until: '2026-12-15' }, summary: 'Add QA practice every other Tuesday 6–7 PM until Dec 15' }] };
      });
      let rows = await dl(card);
      ok(rows.includes('Repeats: every 2 weeks on Tuesdays'), `${tag}: add card says every 2 weeks on Tuesdays (${rows})`);
      ok(rows.includes('Until: Tue, Dec 15, 2026'), `${tag}: add card shows the end date with the year`);
      await p.waitForTimeout(150); await p.screenshot({ path: `${SHOTS}/${tag}-1-every-other-card.png` });
      await card.$eval('[data-ok]', b => b.click()); await p.waitForFunction(() => /Saved/.test([...document.querySelectorAll('#aiLog .ai-card')].pop().textContent));
      let ev = await prac();
      ok(ev && ev.recurrence.freq === 'weekly' && +ev.recurrence.interval === 2 && ev.recurrence.until === '2026-12-15', `${tag}: saved weekly, interval 2, until Dec 15 (${ev && JSON.stringify(ev.recurrence)})`);
      ok(JSON.stringify(await occs('2026-11-01', '2026-12-31')) === JSON.stringify(['2026-11-03', '2026-11-17', '2026-12-01', '2026-12-15']), `${tag}: dates really alternate (Nov 3, 17, Dec 1, 15)`);
      const id = ev.id;

      // 2. separate follow-up: the app sends the memory (id, rule, end date); the series it just made is extended
      card = await ask('actually continue until July 2027', b => {
        const s = (b.context.saved || []).slice(-1)[0] || {};
        ok(s.id === id && s.rule === 'every 2 weeks on Tuesdays' && s.until === '2026-12-15' && s.start === '2026-11-03' && /6 PM/.test(s.time || ''), `${tag}: request carries the saved series: id, rule, time, end date (${JSON.stringify(s)})`);
        ok(b.messages.some(m => m.role === 'user' && m.content.includes(`[id ${id}]`) && /until 2026-12-15/.test(m.content)), `${tag}: the confirm note in the chat has the id + end date`);
        return { reply: 'Extending it. Tap Confirm to save.', proposals: [{ type: 'series', id: s.id, action: 'until', until: '2027-07-31', summary: 'Continue QA practice until July 31, 2027' }] };
      });
      rows = await dl(card);
      ok(rows.includes('Ends now: Tue, Dec 15, 2026') && rows.includes('New end: Sat, Jul 31, 2027') && rows.includes('Last date: Tue, Jul 27, 2027'), `${tag}: extend card: ends now / new end / last date (${rows})`);
      ok(rows.some(r => /^Adds: \d+ more dates$/.test(r)) && rows.some(r => /Series: QA practice · every 2 weeks on Tuesdays/.test(r)), `${tag}: extend card: how many dates it adds + the rule`);
      await p.waitForTimeout(150); await p.screenshot({ path: `${SHOTS}/${tag}-2-extend-card.png` });
      await card.$eval('[data-ok]', b => b.click()); await p.waitForFunction(() => /Saved/.test([...document.querySelectorAll('#aiLog .ai-card')].pop().textContent));
      ev = await prac();
      ok(ev.id === id && ev.recurrence.until === '2027-07-31' && +ev.recurrence.interval === 2, `${tag}: same series now ends Jul 31, 2027, still every other week`);
      const later = await occs('2027-07-01', '2027-08-31');
      ok(JSON.stringify(later) === JSON.stringify(['2027-07-13', '2027-07-27']), `${tag}: Jul 2027 dates (${later})`);

      // 3. memory outlives the 12-message window and a reopen from history
      for (let i = 0; i < 7; i++) await ask('thanks ' + i, () => ({ reply: 'You’re welcome!', proposals: [] }), false);
      await ask('when does it end now?', b => {
        const s = (b.context.saved || []).slice(-1)[0] || {};
        ok(s.id === id && s.until === '2027-07-31', `${tag}: after 9 more turns the memory is still sent, refreshed (until ${s.until})`);
        return { reply: 'It ends Jul 31, 2027.', proposals: [] };
      }, false);
      const chat = await p.evaluate(() => SandyAI.current());
      await p.evaluate(() => SandyAI.newChat()); await p.waitForTimeout(300);
      await ask('hi', b => { ok(!(b.context.saved || []).length, `${tag}: a new chat starts with no memory`); return { reply: 'Hi!', proposals: [] }; }, false);
      await p.evaluate(id => SandyAI.openChat(id), chat.id); await p.waitForTimeout(400);
      await ask('and the time?', b => { const s = (b.context.saved || []).slice(-1)[0] || {}; ok(s.id === id, `${tag}: reopened chat remembers the series`); return { reply: '6–7 PM.', proposals: [] }; }, false);

      // 4. end-date guard rails: before the first date is refused; "none" removes the end
      card = await ask('end it Oct 1', b => ({ reply: 'Tap Confirm.', proposals: [{ type: 'series', id, action: 'until', until: '2026-10-01', summary: 'End QA practice Oct 1' }] }));
      ok(await card.$eval('[data-ok]', b => b.disabled) && /can’t end before that/.test(await card.innerText()), `${tag}: an end before the first date is refused`);
      card = await ask('keep it going forever', b => ({ reply: 'Tap Confirm.', proposals: [{ type: 'series', id, action: 'until', until: 'none', summary: 'Keep QA practice going with no end' }] }));
      rows = await dl(card); ok(rows.includes('New end: Repeats with no end date'), `${tag}: "none" card (${rows})`);
      await card.$eval('[data-ok]', b => b.click()); await p.waitForFunction(() => /Saved/.test([...document.querySelectorAll('#aiLog .ai-card')].pop().textContent));
      ev = await prac(); ok(!ev.recurrence.until && +ev.recurrence.interval === 2, `${tag}: end date removed, interval kept`);
      // Undo puts it back to Jul 31, 2027
      await p.$$eval('#aiLog .ai-card', a => a[a.length - 1].querySelector('[data-undo]').click()); await p.waitForTimeout(600);
      ev = await prac(); ok(ev.recurrence.until === '2027-07-31', `${tag}: Undo restores the Jul 31, 2027 end`);
      await p.screenshot({ path: `${SHOTS}/${tag}-3-chat.png` });
      await ctx.close();
    }
  } finally { for (const b of Object.values(B)) await b.close(); }
  if (errs.length) { console.log('FAIL page errors\n' + errs.join('\n')); process.exit(1); }
  console.log(`PASS ${n} checks`);
})().catch(e => { console.error(e); process.exit(1); });
