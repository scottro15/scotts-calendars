// Browser test (Scott 2026-10-24): bottom navigation revamp (local mode).
//   Home/Today/To-Do/Search/Profile tabs, Today card (tight gap, overdue), To-Do inbox quick add + categories + check,
//   Search groups + jump to settings, Profile dark mode + default view, no left menu. Mobile screenshots of each tab.
//   node tests/bottom_nav.test.js http://127.0.0.1:8787/ [screenshotDir]
const { chromium } = require(process.env.PW || '/workspace/shot-tools/node_modules/playwright-core');
const BASE = process.argv[2] || 'http://127.0.0.1:8787/'; const SHOTS = process.argv[3] || '/workspace/shots-nav';
require('fs').mkdirSync(SHOTS, { recursive: true });
const assert = (c, m) => { if (!c) throw new Error('FAIL: ' + m); console.log('ok -', m); };
(async () => {
  const b = await chromium.launch({ executablePath: '/usr/bin/google-chrome', headless: true, args: ['--no-sandbox'] });
  for (const vp of [{ width: 390, height: 844, name: 'mobile' }, { width: 1300, height: 820, name: 'desktop' }]) {
    const N = `[${vp.name}]`; const mob = vp.name === 'mobile';
    const ctx = await b.newContext({ viewport: vp, timezoneId: 'America/Chicago', locale: 'en-US', isMobile: mob, hasTouch: mob, deviceScaleFactor: mob ? 2 : 1 });
    const p = await ctx.newPage(); const errs = []; p.on('pageerror', e => errs.push(e.message));
    await p.clock.install({ time: new Date('2026-10-21T15:00:00Z') }); // Wed 10:00 AM CT
    await p.goto(BASE + '?view=timeGridWeek'); await p.waitForFunction(() => window.__app && window.__app.Store);
    await p.evaluate(() => { localStorage.clear(); sessionStorage.clear(); }); await p.goto(BASE); await p.waitForFunction(() => window.__app && window.__app.Store && window.SandyNav);
    await p.evaluate(async () => {
      const S = window.__app.Store; const id = () => crypto.randomUUID(); await S.removeWhere(() => true);
      const ev = (o) => ({ id: id(), kind: 'event', allDay: false, recurrence: { freq: 'none' }, location: '', notes: '', ...o });
      await S.save(ev({ title: 'Team standup', calendar: 'msc', start: '2026-10-21T11:00', end: '2026-10-21T11:30', location: 'Zoom' }));
      await S.save(ev({ title: 'Client session Ana', calendar: 'msc', category: 'Client session', start: '2026-10-21T11:35', end: '2026-10-21T12:30' }));
      await S.save(ev({ title: 'Gym class', calendar: 'lifetime', start: '2026-10-21T12:15', end: '2026-10-21T13:00' }));
      await S.save(ev({ title: 'File taxes', kind: 'task', calendar: 'mam', allDay: true, start: '2026-10-18', end: '2026-10-18' }));
      await S.save(ev({ title: 'Buy birthday gift', kind: 'task', calendar: 'msc', allDay: true, start: '2026-10-23', end: '2026-10-23' }));
      await S.notes.set((await S.list()).find(e => e.title === 'Team standup').id, '2026-10-21', 'Discuss the quarterly roadmap');
      window.__app.refresh();
    });
    await p.waitForTimeout(500);
    // no hamburger / sidebar
    assert(!(await p.$('#menuBtn')) && !(await p.$('#sidebar')), `${N} left menu retired`);
    const nav = await p.$$eval('#bottomNav button', bs => bs.map(b => [b.dataset.tab, b.textContent.trim(), b.getAttribute('aria-current')]));
    assert(nav.map(x => x[0]).join() === 'home,today,todo,search,profile', `${N} 5 tabs in order`);
    assert(nav[0][2] === 'page', `${N} Home active at start`);
    const navBox = await p.$eval('#bottomNav', e => { const r = e.getBoundingClientRect(); return { bottom: r.bottom, pos: getComputedStyle(e).position }; });
    assert(navBox.pos === 'fixed' && vp.height - navBox.bottom >= 8 && vp.height - navBox.bottom <= 12, `${N} nav fixed to the bottom, floating ${(vp.height - navBox.bottom).toFixed(1)}px above it (nav2 capsule)`);
    assert(await p.$eval('#bottomNav .nav-badge', e => !e.hidden && e.textContent === '1'), `${N} To-Do badge shows 1 overdue`);
    if (mob) await p.screenshot({ path: `${SHOTS}/1_home_${vp.name}.png` });
    const viewBefore = await p.evaluate(() => window.__app.calendar.view.type);
    // Today
    await p.click('#bottomNav [data-tab=today]'); await p.waitForTimeout(500);
    assert(await p.evaluate(() => window.__app.calendar.view.type === 'timeGridDay' && window.__app.ymd(window.__app.calendar.getDate()) === '2026-10-21'), `${N} Today shows Day view for today`);
    assert(await p.isVisible('#todayCard') && !(await p.isVisible('#briefing')), `${N} Today card replaces briefing`);
    const tc = await p.textContent('#todayCard');
    assert(/Tight: Team standup ends 11:30 AM, Client session Ana starts 5 min later/.test(tc), `${N} tight gap flagged`);
    assert(/Client session Ana overlaps Gym class/.test(tc), `${N} overlap flagged`);
    assert(/Up next:?\s*Team standup at 11:00 AM/.test(tc), `${N} up next`);
    assert(/Overdue to-dos[\s\S]*File taxes[\s\S]*Overdue 3 days/i.test(tc), `${N} overdue to-do with age`);
    assert(/Sandy Intelligence/.test(tc), `${N} Sandy Intelligence placeholder`);
    if (mob) await p.screenshot({ path: `${SHOTS}/2_today_${vp.name}.png` });
    await p.click('#bottomNav [data-tab=home]'); await p.waitForTimeout(400);
    assert(await p.evaluate(v => window.__app.calendar.view.type === v, viewBefore), `${N} Home restores the previous view`);
    assert(!(await p.isVisible('#todayCard')) && await p.isVisible('#briefing'), `${N} briefing back on Home`);
    // To-Do
    await p.click('#bottomNav [data-tab=todo]'); await p.waitForTimeout(400);
    assert(await p.isVisible('#page-todo') && !(await p.isVisible('#calendar')), `${N} To-Do page shown, calendar hidden`);
    let txt = await p.textContent('#todoList');
    assert(/File taxes[\s\S]*Overdue 3 days/.test(txt) && /Buy birthday gift[\s\S]*Fri, Oct 23/.test(txt), `${N} to-dos with overdue badge / date`);
    await p.fill('#qaText', 'Call the plumber'); await p.press('#qaText', 'Enter'); await p.waitForTimeout(400);
    await p.selectOption('#qaKind', 'note'); await p.fill('#qaText', 'Idea: summer camp list'); await p.click('#qaAdd'); await p.waitForTimeout(400);
    txt = await p.textContent('#todoList');
    assert(/Inbox[\s\S]*Call the plumber/.test(txt) && /summer camp list/.test(txt), `${N} quick add to-do + note into Inbox`);
    // categories
    await p.click('#todoCatsBtn'); await p.fill('#catName', 'Errands'); await p.click('#catAdd'); await p.waitForTimeout(200);
    await p.fill('#catName', 'Home'); await p.click('#catAdd'); await p.waitForTimeout(200);
    await p.click('.cats-dlg button[value=done]'); await p.waitForTimeout(400);
    const row = p.locator('.todo-row', { hasText: 'Call the plumber' });
    await row.locator('.cat-pick').selectOption({ label: 'Errands' }); await p.waitForTimeout(400);
    const giftRow = p.locator('.todo-row', { hasText: 'Buy birthday gift' });
    await giftRow.locator('.cat-pick').selectOption({ label: 'Errands' }); await p.waitForTimeout(400);
    await p.selectOption('#todoGroup', 'category'); await p.waitForTimeout(300);
    txt = await p.textContent('#todoList');
    assert(/Errands[\s\S]*(Call the plumber[\s\S]*Buy birthday gift|Buy birthday gift[\s\S]*Call the plumber)[\s\S]*No category/.test(txt), `${N} group by category`);
    await p.selectOption('#todoGroup', 'date'); await p.waitForTimeout(300);
    txt = await p.textContent('#todoList');
    assert(/^Overdue[\s\S]*File taxes[\s\S]*Next 7 days[\s\S]*Buy birthday gift[\s\S]*No date/.test(txt.trim()), `${N} group by date`);
    await p.click('#todoFilter [data-f=mam]'); await p.waitForTimeout(300);
    txt = await p.textContent('#todoList');
    assert(/File taxes/.test(txt) && !/plumber|gift/.test(txt), `${N} filter by calendar`);
    await p.click('#todoFilter [data-f=all]'); await p.selectOption('#todoGroup', 'calendar'); await p.waitForTimeout(300);
    if (mob) await p.screenshot({ path: `${SHOTS}/3_todo_${vp.name}.png` });
    // tap to check
    await p.locator('.todo-row', { hasText: 'File taxes' }).locator('.td-check').click(); await p.waitForTimeout(700);
    assert(!/File taxes/.test(await p.textContent('#todoList')), `${N} checking removes it from the open list`);
    assert(await p.evaluate(async () => { const e = (await window.__app.Store.list()).find(x => x.title === 'File taxes'); return window.__app.isDone(e, '2026-10-18'); }), `${N} check saved to the event`);
    assert(await p.$eval('#navTodoBadge', e => e.hidden), `${N} badge clears`);
    await p.locator('.todo-row', { hasText: 'Call the plumber' }).locator('.td-check').click(); await p.waitForTimeout(700);
    await p.check('#todoShowDone'); await p.waitForTimeout(300);
    assert(await p.locator('.todo-row.done', { hasText: 'Call the plumber' }).count() === 1, `${N} show done reveals checked inbox item`);
    await p.uncheck('#todoShowDone');
    // tap title opens editor
    await p.locator('.todo-row', { hasText: 'Buy birthday gift' }).locator('.td-title').click(); await p.waitForTimeout(500);
    assert(await p.isVisible('#eventDialog') && await p.inputValue('#eventDialog input[name=title]') === 'Buy birthday gift', `${N} tapping a to-do opens it`);
    await p.click('#cancelBtn'); await p.waitForSelector('#eventDialog', { state: 'hidden' });
    assert(await p.evaluate(async () => (await window.__app.Store.list()).find(x => x.title === 'Buy birthday gift').todoCategoryId), `${N} category kept on scheduled to-do`);
    // Search
    await p.click('#bottomNav [data-tab=search]'); await p.waitForTimeout(300);
    await p.fill('#searchBox', 'roadmap'); await p.waitForTimeout(500);
    assert(/Today's Notes[\s\S]*Team standup[\s\S]*roadmap/.test(await p.textContent('#searchResults')), `${N} search finds notes`);
    await p.fill('#searchBox', 'gift'); await p.waitForTimeout(400);
    assert(/To-dos[\s\S]*Buy birthday gift/.test(await p.textContent('#searchResults')), `${N} search finds to-dos`);
    await p.fill('#searchBox', 'zoom'); await p.waitForTimeout(400);
    assert(/Events[\s\S]*Team standup/.test(await p.textContent('#searchResults')), `${N} search finds events by location`);
    await p.fill('#searchBox', 'plumber'); await p.waitForTimeout(400);
    assert(/Quick jots[\s\S]*plumber/.test(await p.textContent('#searchResults')), `${N} search finds inbox jots`);
    await p.fill('#searchBox', 'standup'); await p.waitForTimeout(400);
    if (mob) await p.screenshot({ path: `${SHOTS}/4_search_${vp.name}.png` });
    await p.click('.sr-item >> text=Team standup'); await p.waitForTimeout(500);
    assert(await p.inputValue('#eventDialog input[name=title]') === 'Team standup', `${N} tapping an event result opens it`);
    await p.click('#cancelBtn'); await p.waitForSelector('#eventDialog', { state: 'hidden' });
    await p.fill('#searchBox', 'dark'); await p.waitForTimeout(400);
    await p.click('.sr-item >> text=Dark mode'); await p.waitForTimeout(600);
    assert(await p.evaluate(() => window.SandyNav.tab === 'profile' && document.activeElement.id === 'darkToggle'), `${N} setting result jumps to Profile`);
    // Profile
    assert(await p.isVisible('#calSection') && await p.isVisible('#dataSection') && await p.isVisible('#exportBtn'), `${N} calendars + data on Profile`);
    if (mob) await p.screenshot({ path: `${SHOTS}/5_profile_${vp.name}.png` });
    await p.click('#appearanceSection .switch'); await p.waitForTimeout(300);
    assert(await p.evaluate(() => document.documentElement.classList.contains('dark') && localStorage.getItem('sandy.theme') === 'dark'), `${N} dark mode on`);
    const bg = await p.evaluate(() => getComputedStyle(document.body).backgroundColor);
    assert(bg === 'rgb(11, 18, 32)', `${N} dark background`);
    if (mob) await p.screenshot({ path: `${SHOTS}/6_profile_dark_${vp.name}.png` });
    await p.selectOption('#defaultView', 'dayGridMonth');
    await p.reload(); await p.waitForFunction(() => window.__app && window.__app.calendar && window.SandyNav);
    await p.waitForTimeout(500);
    assert(await p.evaluate(() => document.documentElement.classList.contains('dark')), `${N} dark mode persists`);
    await p.click('#bottomNav [data-tab=home]'); await p.waitForTimeout(400);
    assert(await p.evaluate(() => window.__app.calendar.view.type) === 'dayGridMonth', `${N} default view (Month) used`);
    if (mob) {
      await p.screenshot({ path: `${SHOTS}/7_home_dark_${vp.name}.png` });
      await p.click('#bottomNav [data-tab=today]'); await p.waitForTimeout(500); await p.screenshot({ path: `${SHOTS}/8_today_dark_${vp.name}.png` });
      await p.click('#bottomNav [data-tab=todo]'); await p.waitForTimeout(500); await p.screenshot({ path: `${SHOTS}/9_todo_dark_${vp.name}.png` });
    }
    await p.evaluate(() => window.SandyNav.setDark(false));
    assert(!errs.length, `${N} no page errors ${errs.join(' | ')}`);
    await ctx.close();
  }
  await b.close(); console.log('BOTTOM NAV TESTS PASSED');
})().catch(e => { console.error(e); process.exit(1); });
