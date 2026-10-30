/*
 * nav.js: bottom navigation (Home · Today · To-Do · Search · Profile), replacing the left menu (2026-10-24).
 *  - Home: the calendar (Profile → Default view picks a view or "Last used").
 *  - Today: Day view for today + a "Today" card (events, up next, tight gaps/overlaps, overdue to-dos) and a
 *    placeholder for Sandy Intelligence prep nudges.
 *  - To-Do: every to-do in one place (Todoist-inbox style): scheduled date or "Overdue N days", filter by calendar,
 *    group by calendar / category / date, user categories, quick "jot a to-do or note" (undated inbox items).
 *  - Search: events, to-dos, Today's Notes, inbox, settings. Notes Review lives below the results.
 *  - Profile: picture, email, dark mode, default view, calendars, notifications, time zone, data, account.
 * Data: inbox_items + todo_categories tables and the private "avatars" bucket (migration-2026-10-24-nav.sql);
 * localStorage in local (no-sync) mode.
 */
(function () {
  'use strict';
  const CFG = window.CALENDAR_CONFIG || {};
  const A = () => window.__app;
  const $ = id => document.getElementById(id);
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const DAY = 864e5;
  const TABS = ['home', 'today', 'todo', 'search', 'profile'];
  const reduceMotion = () => document.documentElement.classList.contains('reduce-motion') || (window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches);
  const t12 = d => (window.SandyTime ? SandyTime.fmt(d) : d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: 'UTC' }));
  const toast = m => A() && A().toast(m);
  let tab = 'home', homeState = null, ready = false;
  // Every tab opens at its top. The browser must not restore an old window scroll on reload / back-forward
  // (it put Today halfway down on a cold start); List View's own "scroll to today" on Home is done by app.js.
  try { if ('scrollRestoration' in history) history.scrollRestoration = 'manual'; } catch (_) {}
  const toTop = () => { window.scrollTo(0, 0); const se = document.scrollingElement; if (se) se.scrollTop = 0; };

  // ------------------------------------------------------------------ theme (set early by the inline <head> script)
  function setDark(on) {
    document.documentElement.classList.toggle('dark', on);
    try { localStorage.setItem('sandy.theme', on ? 'dark' : 'light'); } catch (_) {}
    document.querySelectorAll('meta[name=theme-color]').forEach(m => { m.content = on ? '#0b1220' : '#111827'; }); // in-app theme wins over the system media defaults
    const t = $('darkToggle'); if (t) t.checked = on;
  }

  // ------------------------------------------------------------------ data: inbox items + to-do categories
  const LS = { inbox: 'sandy.inbox.v1', cats: 'sandy.todoCats.v1', avatar: 'sandy.avatar.v1' };
  const readLS = (k, d) => { try { return JSON.parse(localStorage.getItem(k)) || d; } catch (_) { return d; } };
  const uid = () => (crypto.randomUUID ? crypto.randomUUID() : 'x' + Date.now() + Math.random().toString(16).slice(2));
  const sbc = () => { const a = A(); return a && a.Store.mode !== 'local' && a.Store.adapter && a.Store.adapter.client || null; };
  const missing = e => e && (e.code === 'PGRST205' || e.code === '42P01' || /could not find the table|does not exist|schema cache/i.test(e.message || ''));
  function table(name, key, map) {
    const api = {
      available: true, cache: null, missingCols: new Set(),
      // Today's cards (clash, free gap, grocery) and the To-Do badge all list at once: share one request
      // and reuse it for 3 s; any save/remove forgets it (t148u speed)
      memo: null,
      forget() { api.memo = null; },
      async list() {
        const sb = sbc();
        if (!sb) return (api.cache = readLS(key, []));
        if (!api.memo || Date.now() - api.memo.at > 3000) {
          const p = (async () => {
            const { data, error } = await sb.from(name).select('*').order('created_at');
            if (error) { if (missing(error)) { api.available = false; return (api.cache = []); } throw new Error(error.message); }
            api.available = true; return (api.cache = data.map(map.from));
          })();
          const m = { at: Date.now(), p };
          api.memo = m;
          p.catch(() => { if (api.memo === m) api.memo = null; });
        }
        return (await api.memo.p).slice();
      },
      async save(item) {
        api.memo = null;
        const sb = sbc();
        if (!sb) { const all = readLS(key, []).filter(x => x.id !== item.id); all.push(item); localStorage.setItem(key, JSON.stringify(all)); return item; }
        // optional columns from later migrations (e.g. priority): until they run, save without them
        let row = map.to(item); for (const c of api.missingCols) delete row[c];
        let { data, error } = await sb.from(name).upsert(row).select();
        const opt = (map.opt || []).find(c => error && c in row && (error.message || '').includes(c));
        if (opt) { api.missingCols.add(opt); delete row[opt]; ({ data, error } = await sb.from(name).upsert(row).select()); }
        if (error) throw new Error(missing(error) ? 'This needs a quick database update first.' : error.message);
        api.memo = null; return map.from(data[0]);
      },
      async remove(id) {
        api.memo = null;
        const sb = sbc();
        if (!sb) { localStorage.setItem(key, JSON.stringify(readLS(key, []).filter(x => x.id !== id))); return; }
        const { error } = await sb.from(name).delete().eq('id', id); api.memo = null; if (error) throw new Error(error.message);
      },
    };
    return api;
  }
  const Inbox = table('inbox_items', LS.inbox, {
    from: r => ({ id: r.id, body: r.body, kind: r.kind, calendar: r.calendar || null, categoryId: r.category_id || null, done: !!r.done, createdAt: r.created_at, priority: r.priority || null }),
    to: i => { const o = { id: i.id, body: i.body, kind: i.kind || 'todo', calendar: i.calendar || null, category_id: i.categoryId || null, done: !!i.done }; if (i.priority >= 1 && i.priority <= 3) o.priority = i.priority; return o; },
    opt: ['priority'],
  });
  const Cats = table('todo_categories', LS.cats, {
    from: r => ({ id: r.id, name: r.name, color: r.color, sort: r.sort, createdAt: r.created_at }),
    to: c => ({ id: c.id, name: c.name, color: c.color || '#6b7280', sort: c.sort || 0 }),
  });

  // ------------------------------------------------------------------ tabs
  function pageOf(t) { return t === 'home' || t === 'today' ? $('page-home') : $('page-' + t); }
  function go(t, opts = {}) {
    if (!TABS.includes(t)) return;
    const prev = tab;
    if (t === prev) { if (t !== 'home') window.scrollTo({ top: 0, behavior: reduceMotion() ? 'auto' : 'smooth' }); if (t === 'today') enterToday(); return; }
    if (prev === 'today') exitToday();
    tab = t;
    for (const x of TABS) document.body.classList.toggle('tab-' + x, x === t);
    const page = pageOf(t);
    for (const el of document.querySelectorAll('#page-home, .tab-page')) el.hidden = el !== page;
    for (const b of document.querySelectorAll('#bottomNav button')) {
      const on = b.dataset.tab === t; if (on) b.setAttribute('aria-current', 'page'); else b.removeAttribute('aria-current');
      if (on && !reduceMotion()) { b.classList.remove('pop'); void b.offsetWidth; b.classList.add('pop'); }
    }
    if (!reduceMotion() && !(pageOf(prev) === page)) {
      page.classList.remove('tab-in', 'from-left', 'from-right'); void page.offsetWidth;
      page.classList.add('tab-in', TABS.indexOf(t) < TABS.indexOf(prev) ? 'from-left' : 'from-right');
    }
    // Home and Today share #page-home, so "same page element" must not keep the scroll: opening any tab
    // (Today especially: Up next / Heads up / Suggestions live at its top) starts at the top.
    toTop();
    try { sessionStorage.setItem('sandy.tab', t); } catch (_) {}
    if (t === 'today') enterToday();
    if (t === 'home' || t === 'today') { const c = A() && A().calendar; if (c) requestAnimationFrame(() => c.updateSize()); }
    if (t === 'todo') renderTodo();
    if (t === 'search') { renderSearch(); if (opts.focus) $('searchBox').focus(); }
    if (t === 'profile') renderProfile();
  }

  // ------------------------------------------------------------------ Today
  function enterToday() {
    const a = A(); if (!a) return;
    const c = a.calendar;
    if (!homeState) homeState = { view: c.view.type, date: a.ymd(c.getDate()) };
    const today = a.ymd(a.nowWall());
    if (c.view.type !== 'timeGridDay' || a.ymd(c.getDate()) !== today) c.changeView('timeGridDay', today);
    renderToday();
  }
  function exitToday() {
    const a = A(); if (!a || !homeState) return;
    a.calendar.changeView(homeState.view, homeState.date); homeState = null;
  }
  async function todayData() {
    const a = A(); const now = a.nowWall(); const today = a.startOfDay(now); const vis = a.settings().visible;
    const all = (await a.Store.list()).filter(e => vis[e.calendar] !== false);
    const items = [];
    for (const ev of all) for (const o of a.occurrences(ev, today, new Date(today.getTime() + DAY))) items.push({ ev, o });
    items.sort((x, y) => (y.ev.allDay - x.ev.allDay) || (x.o.start - y.o.start));
    const timed = items.filter(x => !x.ev.allDay && x.ev.kind !== 'task');
    const gaps = [];
    for (let i = 1; i < timed.length; i++) {
      const p = timed[i - 1], n = timed[i];
      const gap = (n.o.start - (p.o.end || p.o.start)) / 60000;
      if (gap < 0) gaps.push({ kind: 'overlap', p, n });
      else if (gap <= 15) gaps.push({ kind: 'tight', p, n, min: Math.round(gap) });
    }
    const next = timed.find(x => (x.o.end || x.o.start) > now && x.o.start >= now) || null;
    const nowOn = timed.find(x => x.o.start <= now && (x.o.end || x.o.start) > now) || null;
    const overdue = [];
    const tk = a.ymd(today);
    for (const ev of all) {
      if (ev.kind !== 'task') continue;
      const occ = a.occurrences(ev, new Date(today.getTime() - 90 * DAY), today).filter(o => o.key < tk && !a.isDone(ev, o.key));
      if (occ.length) overdue.push({ ev, o: occ[occ.length - 1] });
    }
    overdue.sort((x, y) => x.o.start - y.o.start);
    return { now, today, items, gaps, next, nowOn, overdue };
  }
  const PART_MS = 2500;
  let todayTok = 0;
  const todayLast = { day: null, simple: null, parts: {} };
  async function renderToday(opts) {
    const late = !!(opts && opts.late === true);
    const a = A(); if (!a) return;
    const tok = ++todayTok;
    const d = await todayData();
    if (tok !== todayTok) return;
    { const td = new Date(d.today.getTime()); const wd = td.toLocaleDateString('en-US', { weekday: 'long', timeZone: 'UTC' }); const md = td.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
      $('todayDate').textContent = `${wd}, ${md}`; const sub = $('todaySub'); if (sub) sub.textContent = `Today · ${td.toLocaleDateString('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' })}`; }
    const dot = ev => `<span class="dot" style="background:${esc((a.cal(ev.calendar) || {}).color || '#666')}"></span>`;
    const when = x => x.ev.allDay ? 'All day' : `${t12(x.o.start)}–${t12(x.o.end || x.o.start)}`;
    const calColor = ev => esc((a.cal(ev.calendar) || {}).color || '#9ca3af');
    const row = (x, extra = '') => `<li><button type="button" class="tc-item tc-ev${x.ev.kind === 'task' ? ' is-task' : ''}${a.isDone(x.ev, x.o.key) ? ' is-done' : ''}" style="--cal:${calColor(x.ev)}" data-id="${esc(x.ev.id)}" data-key="${esc(x.o.key)}"><span class="tc-when">${esc(when(x))}</span><span class="tc-title${a.isClientKey(x.ev) ? ' client-key' : ''}">${x.ev.kind === 'task' ? (a.isDone(x.ev, x.o.key) ? '☑︎ ' : '☐ ') : ''}${esc(x.ev.title)}</span>${extra}</button></li>`;
    const mins = m => m < 60 ? `${m} min` : `${Math.floor(m / 60)} hr${m >= 120 ? 's' : ''}${m % 60 ? ` ${m % 60} min` : ''}`;
    let h = '';
    const nTasks = d.items.filter(x => x.ev.kind === 'task').length, nEv = d.items.length - nTasks;
    const od = d.overdue.length;
    const statsLine = `<p class="tc-stats-line" role="status"><button type="button" class="tc-stat-link" data-stat="events"><b>${nEv}</b> event${nEv === 1 ? '' : 's'}</button>` +
      `<span class="tc-stat-sep" aria-hidden="true"> · </span>` +
      `<button type="button" class="tc-stat-link" data-stat="todos"><b>${nTasks}</b> to-do${nTasks === 1 ? '' : 's'}</button>` +
      (od ? `<span class="tc-stat-sep" aria-hidden="true"> · </span><button type="button" class="tc-stat-link tc-stat-od" data-stat="overdue"><b>${od}</b> overdue</button>` : '') +
      `</p>`;
    const simpleBar = window.SandySimple ? SandySimple.toolbarHtml() : '';
    h += `<div class="tc-summary">${simpleBar}${statsLine}`;
    if (d.nowOn || d.next) {
      h += '<div class="tc-upnext">';
      if (d.nowOn) h += `<p class="tc-next"><span class="tc-next-k">Now</span><span class="tc-next-v"><button type="button" class="tc-link tc-item" data-id="${esc(d.nowOn.ev.id)}" data-key="${esc(d.nowOn.o.key)}">${esc(d.nowOn.ev.title)}</button> until ${esc(t12(d.nowOn.o.end))}</span></p>`;
      if (d.next) h += `<p class="tc-next"><span class="tc-next-k">Up next</span><span class="tc-next-v"><button type="button" class="tc-link tc-item" data-id="${esc(d.next.ev.id)}" data-key="${esc(d.next.o.key)}">${esc(d.next.ev.title)}</button> at ${esc(t12(d.next.o.start))} <span class="muted">(in ${mins(Math.max(1, Math.round((d.next.o.start - d.now) / 60000)))})</span></span></p>`;
      h += '</div>';
    }
    h += '</div>';
    // Speed (t148u, Design's 1-4): Now/Up next, On Today and Overdue come from local data and paint right away.
    // Heads Up (clash, weather) and the Suggestions/Weekly cards are gathered in parallel, each capped at
    // PART_MS; anything still out paints with a thin shimmer (or the last result from today) and fades in.
    const simpleOn = !!(window.SandySimple && SandySimple.isOn());
    const sug = window.SandySuggestions;
    const tk = a.ymd(d.today);
    const wkForce = !!(window.__wkForceOpen); window.__wkForceOpen = false;
    const jobs = {};
    const job = (k, fn) => { jobs[k] = Promise.resolve().then(fn).catch(e => { console.warn(k + ':', e); return null; }); };
    if (window.SandyClash) job('clash', async () => { const cd = await SandyClash.data(a, d.now); return cd ? SandyClash.html(cd) : ''; });
    if (window.SandyWeather) job('wx', async () => { const wd = await SandyWeather.data(a, d.now); return wd ? SandyWeather.html(wd) : ''; });
    if (!simpleOn) {
      if (window.SandyTravel) job('travel', () => SandyTravel.render(null, a, d.now));
      if (window.SandyPractice) job('practice', async () => SandyPractice.html(await SandyPractice.data(a, d.now), d.now, d.today) || '');
      if (window.SandyLongDay) job('longday', async () => { const ld = await SandyLongDay.data(a, d.now); return ld ? SandyLongDay.html(ld) : ''; });
      if (window.SandyFreeGap) job('freegap', async () => { const fg = await SandyFreeGap.data(a, d.now); return fg ? (SandyFreeGap.html(fg) || '') : ''; });
      if (window.SandyGrocery) job('grocery', async () => { const gr = await SandyGrocery.data(a, d.now); return gr ? (SandyGrocery.html(gr) || '') : ''; });
      if (window.SandyTomorrow && SandyTomorrow.isEvening(d.now)) job('tomorrow', () => SandyTomorrow.data(a, d.now));
      if (window.SandyWeekly) job('weekly', () => SandyWeekly.data(a, d.now, { force: wkForce }));
    }
    const keys = Object.keys(jobs);
    const got = {}; const pending = new Set(keys);
    keys.forEach(k => jobs[k].then(v => { got[k] = v; pending.delete(k); }));
    const allDone = Promise.all(keys.map(k => jobs[k]));
    const wait = ms => new Promise(r => setTimeout(r, ms));
    const last = (todayLast.day === tk && todayLast.simple === simpleOn) ? todayLast.parts : {};
    const SUG_ORDER = ['travel', 'practice', 'longday', 'freegap', 'grocery', 'tomorrow'];
    const body = (partial) => {
      const part = k => (k in got) ? got[k] : (partial ? last[k] : null);
      const clashHtml = part('clash') || '', wxHtml = part('wx') || '';
      const headsWaiting = partial && (pending.has('clash') || pending.has('wx')) && !('clash' in last || 'wx' in last) && d.items.length > 0;
      const showHeads = !!(d.gaps.length || clashHtml || wxHtml || headsWaiting);
      let b = `<section class="tc-sec tc-card tc-heads"${showHeads ? '' : ' hidden'}><h3>Heads Up</h3><ul class="tc-warn tc-leave" id="tcLeave" aria-live="polite" hidden></ul>${clashHtml}${wxHtml}${d.gaps.length ? `<ul class="tc-warn">${d.gaps.map(g => g.kind === 'overlap'
        ? `<li>⚠️ <b>${esc(g.p.ev.title)}</b> overlaps <b>${esc(g.n.ev.title)}</b> (${esc(t12(g.n.o.start))})</li>`
        : `<li>⏱️ Tight: <b>${esc(g.p.ev.title)}</b> ends ${esc(t12(g.p.o.end))}, <b>${esc(g.n.ev.title)}</b> starts ${g.min ? `${g.min} min later` : 'right after'}</li>`).join('')}</ul>` : ''}${headsWaiting ? '<ul class="tc-pending" aria-hidden="true"><li><span class="tc-shimmer"></span></li></ul>' : ''}</section>`;
      // Sandy Intelligence nudges → one Suggestions card (dismissible tiles). Weekly stays its own card.
      // Simple mode: skip Suggestions + Week ahead entirely (Now/Next, Heads Up, On Today, Overdue only).
      let sugTiles = '';
      if (!simpleOn) for (const k of SUG_ORDER) {
        const v = part(k); if (!v) continue;
        const th = k === 'travel' ? v.html : k === 'tomorrow' ? SandyTomorrow.html(v) : v;
        if (th) sugTiles += sug ? sug.wrap(th, k) : th;
      }
      if (!simpleOn && sugTiles) b += sug ? sug.shell(sugTiles) : sugTiles;
      const wk = !simpleOn && part('weekly');
      if (wk) { try { b += SandyWeekly.html(wk); } catch (e) { console.warn('weekly:', e); } }
      return b;
    };
    const tail = (d.items.length ? `<section class="tc-sec tc-card tc-on"><h3>On Today</h3><ul class="tc-list">${d.items.map(x => row(x)).join('')}</ul></section>` : '') +
      (d.overdue.length ? `<section class="tc-sec tc-card tc-overdue"><h3>Overdue To-Dos</h3><ul class="tc-list">${d.overdue.map(x => row(x, `<span class="overdue-badge">Overdue ${esc(a.overdueText(d.now - (x.ev.allDay ? a.startOfDay(x.o.start) : (x.o.end || x.o.start))))}</span>`)).join('')}</ul></section>` : '');
    const paint = (partial, fade) => {
      const el = $('todayBody');
      el.innerHTML = h + body(partial) + tail;
      if (fade) el.querySelectorAll('.tc-clash, .tc-weather, .tc-suggestions, .tc-weekly').forEach(x => x.classList.add('tc-fadein'));
      if (window.SandySimple) { try { SandySimple.bind(el); } catch (e) { console.warn('simple:', e); } }
      if (window.SandyCollapse) { try { SandyCollapse.apply(el); } catch (e) { console.warn('collapse:', e); } }
      if (window.SandyLeave) SandyLeave.render($('tcLeave'), d.items, d.now).catch(e => console.warn('leave-by:', e));
    };
    // cached parts land within a few ms: then it's one paint, as before
    if (keys.length) await Promise.race([allDone, wait(60)]);
    if (tok !== todayTok) return;
    let partial = false;
    if (pending.size) {
      partial = true; paint(true, false);
      await Promise.race([allDone, wait(PART_MS)]);
      if (tok !== todayTok) return;
    }
    const lateKeys = [...pending];
    paint(false, partial);
    todayLast.day = tk; todayLast.simple = simpleOn; todayLast.parts = Object.assign({}, last, got);
    for (const k of ['travel', 'tomorrow']) if (!(k in got)) delete todayLast.parts[k]; // objects with live hooks: only fresh ones
    const wkFocus = !!got.weekly && (wkForce || new URLSearchParams(location.search).get('si') === 'weekly');
    if (wkFocus && window.SandyWeekly) { try { SandyWeekly.focusCard(); } catch (_) {} }
    const tv = got.travel, tm = got.tomorrow;
    if (tv && tv.run) tv.run();
    if (tm) SandyTomorrow.fillLeave($('tmLeave'), tm).catch(e => console.warn('tomorrow leave-by:', e));
    // a slow lookup that finishes later: one quiet repaint with it (its result is cached by then)
    if (lateKeys.length && !late) allDone.then(() => { if (tok === todayTok) renderToday({ late: true }); });
  }

  // ------------------------------------------------------------------ To-Do
  const todoUI = { filter: 'all', group: 'calendar', showDone: false };
  try { Object.assign(todoUI, JSON.parse(localStorage.getItem('sandy.todoUI') || '{}')); } catch (_) {}
  const saveTodoUI = () => { try { localStorage.setItem('sandy.todoUI', JSON.stringify(todoUI)); } catch (_) {} };
  async function todoItems() {
    const a = A(); const now = a.nowWall(); const today = a.startOfDay(now);
    const dueAt = (ev, o) => ev.allDay ? a.addDays(a.startOfDay(o.start), 1) : (o.end && o.end > o.start ? o.end : o.start);
    const out = [];
    for (const ev of await a.Store.list()) {
      if (ev.kind !== 'task') continue;
      let occs;
      if (a.isRecurring(ev)) {
        const back = a.occurrences(ev, a.addDays(today, -60), a.addDays(today, 1)).filter(o => !a.isDone(ev, o.key) && dueAt(ev, o) <= now).slice(-1);
        const fwd = a.occurrences(ev, today, a.addDays(today, 400)).filter(o => todoUI.showDone || !a.isDone(ev, o.key)).filter(o => !back.length || o.key !== back[0].key).slice(0, 1);
        occs = [...back, ...fwd];
      } else occs = a.occurrences(ev, new Date(Date.UTC(1970, 0, 1)), new Date(Date.UTC(2100, 0, 1))).slice(0, 1);
      for (const o of occs) {
        const done = a.isDone(ev, o.key); if (done && !todoUI.showDone) continue;
        const overdue = !done && dueAt(ev, o) <= now;
        out.push({ type: 'task', ev, key: o.key, date: o.start, done, overdue, overdueMs: overdue ? now - (ev.allDay ? a.startOfDay(o.start) : dueAt(ev, o)) : 0, calendar: ev.calendar, categoryId: ev.todoCategoryId || null, title: ev.title, desc: String(ev.notes || '').trim() });
      }
    }
    let inbox = []; try { inbox = await Inbox.list(); } catch (e) { console.warn('inbox:', e); }
    for (const i of inbox) {
      if (i.done && !todoUI.showDone) continue;
      const raw = String(i.body || '');
      const nl = raw.indexOf('\n');
      const title = (nl < 0 ? raw : raw.slice(0, nl)).trim() || raw.trim();
      const desc = nl < 0 ? '' : raw.slice(nl + 1).trim();
      out.push({ type: 'inbox', item: i, done: i.done, date: null, overdue: false, calendar: i.calendar, categoryId: i.categoryId, title, desc, note: i.kind === 'note', priority: i.priority || null });
    }
    return { items: out, now, today };
  }
  function dateLabel(a, it, today) {
    if (!it.date) return it.note ? 'Note' : 'No date';
    const d = a.startOfDay(it.date), diff = Math.round((d - today) / DAY);
    const day = diff === 0 ? 'Today' : diff === 1 ? 'Tomorrow' : diff === -1 ? 'Yesterday' : a.fmtDay(it.date);
    return it.ev.allDay ? day : `${day} ${t12(it.date)}`;
  }
  async function renderTodo() {
    const a = A(); if (!a) return;
    let cats = []; try { cats = (await Cats.list()).sort((x, y) => (x.sort - y.sort) || x.name.localeCompare(y.name)); } catch (e) { console.warn(e); }
    const catOf = id => cats.find(c => c.id === id);
    const { items, today } = await todoItems();
    const calendars = a.calendars();
    // filter chips
    const chips = [['all', 'All', null], ['inbox', 'Inbox', null], ...calendars.map(c => [c.id, c.short || c.name, c.color])];
    $('todoFilter').innerHTML = chips.map(([id, label, color]) => `<button type="button" data-f="${esc(id)}" aria-pressed="${todoUI.filter === id}" title="${esc(label)}"${color ? ` style="--c:${esc(color)}"` : ''}>${color ? '<span class="dot"></span>' : ''}<span class="chip-lbl">${esc(label)}</span></button>`).join('');
    $('todoGroup').value = todoUI.group; $('todoShowDone').checked = todoUI.showDone;
    $('qaCat').innerHTML = '<option value="">Category</option>' + cats.map(c => `<option value="${esc(c.id)}">${esc(c.name)}</option>`).join('');
    const avail = Inbox.available && Cats.available;
    if ($('qaText').value) qaPaint();
    $('qaText').disabled = $('qaAdd').disabled = !Inbox.available;
    $('qaText').placeholder = Inbox.available ? 'Jot a to-do or note…' : 'Quick jots turn on after the database update';
    const vis = items.filter(it => todoUI.filter === 'all' || (todoUI.filter === 'inbox' ? !it.calendar : it.calendar === todoUI.filter));
    const open = items.filter(it => !it.done && !it.note).length, od = items.filter(it => it.overdue).length;
    $('todoCount').textContent = `${open} open${od ? ` · ${od} overdue` : ''}`;
    setBadge(od);
    // groups
    const groups = new Map(); const add = (k, label, it, color) => { if (!groups.has(k)) groups.set(k, { label, color, items: [] }); groups.get(k).items.push(it); };
    for (const it of vis) {
      if (todoUI.group === 'calendar') { const c = it.calendar && a.cal(it.calendar); add(c ? c.id : '~inbox', c ? c.name : 'Inbox', it, c && c.color); }
      else if (todoUI.group === 'category') { const c = catOf(it.categoryId); add(c ? c.id : '~none', c ? c.name : 'No category', it, c && c.color); }
      else {
        let k, l;
        if (!it.date) { k = '5'; l = 'No date'; }
        else if (it.overdue) { k = '0'; l = 'Overdue'; }
        else { const diff = Math.round((a.startOfDay(it.date) - today) / DAY); if (diff <= 0) { k = '1'; l = 'Today'; } else if (diff === 1) { k = '2'; l = 'Tomorrow'; } else if (diff < 7) { k = '3'; l = 'Next 7 days'; } else { k = '4'; l = 'Later'; } }
        add(k, l, it);
      }
    }
    let keys = [...groups.keys()];
    if (todoUI.group === 'calendar') keys.sort((x, y) => (x === '~inbox' ? -1 : y === '~inbox' ? 1 : calendars.findIndex(c => c.id === x) - calendars.findIndex(c => c.id === y)));
    else if (todoUI.group === 'category') keys.sort((x, y) => (x === '~none' ? 1 : y === '~none' ? -1 : cats.findIndex(c => c.id === x) - cats.findIndex(c => c.id === y)));
    else keys.sort();
    const sortItems = l => l.sort((x, y) => (x.done - y.done) || (y.overdue - x.overdue) || ((x.date ? 0 : 1) - (y.date ? 0 : 1)) || ((x.date || 0) - (y.date || 0)) || String(x.title).localeCompare(y.title));
    const catSel = it => cats.length || it.categoryId ? `<select class="cat-pick" aria-label="Category for ${esc(it.title)}"><option value="">＋ Category</option>${cats.map(c => `<option value="${esc(c.id)}"${c.id === it.categoryId ? ' selected' : ''}>${esc(c.name)}</option>`).join('')}</select>` : '';
    const listEl = $('todoList');
    if (!vis.length) { listEl.innerHTML = `<p class="todo-empty">${items.length ? 'Nothing here with this filter.' : '🎉 All clear. Jot something above or add a to-do with a date.'}</p>`; return; }
    listEl.innerHTML = keys.map(k => {
      const g = groups.get(k);
      return `<section class="todo-group"><h3>${g.color ? `<span class="dot" style="background:${esc(g.color)}"></span>` : ''}${esc(g.label)} <span class="muted small">${g.items.filter(i => !i.done && !i.note).length || ''}</span></h3><ul>${sortItems(g.items).map(it => {
        const c = it.calendar && a.cal(it.calendar);
        const cat = catOf(it.categoryId);
        const meta = [];
        if (it.overdue) meta.push(`<span class="overdue-badge">Overdue ${esc(a.overdueText(it.overdueMs))}</span>`);
        meta.push(`<span class="td-date${it.overdue ? ' bad' : ''}">${it.overdue ? 'Due ' : ''}${esc(dateLabel(a, it, today))}</span>`);
        if (c && todoUI.group !== 'calendar') meta.push(`<span class="td-cal"><span class="dot" style="background:${esc(c.color)}"></span>${esc(c.short || c.name)}</span>`);
        if (cat && todoUI.group !== 'category') meta.push(`<span class="td-cat" style="--c:${esc(cat.color)}">${esc(cat.name)}</span>`);
        const pr = it.type === 'task' ? it.ev.priority : (it.priority || (it.item && it.item.priority));
        if (pr >= 1 && pr <= 3) meta.push(`<span class="td-pri td-p${pr}" title="Priority ${pr}"><svg viewBox="0 0 24 24" width="12" height="12" aria-hidden="true"><path d="M5 21V4h11l-1.5 4L16 12H5" fill="currentColor"/></svg>P${pr}</span>`);
        const id = it.type === 'task' ? `data-ev="${esc(it.ev.id)}" data-key="${esc(it.key)}"` : `data-inbox="${esc(it.item.id)}"`;
        const checkC = pr === 1 ? '#d1453b' : pr === 2 ? '#eb8909' : pr === 3 ? '#246fe0' : '#b0b0b0';
        const descHtml = it.desc ? `<p class="td-desc">${esc(it.desc)}</p>` : '';
        return `<li class="todo-row${it.done ? ' done' : ''}${it.overdue ? ' overdue' : ''}${it.note ? ' note' : ''}${pr >= 1 && pr <= 3 ? ' td-has-p' + pr : ''}" ${id} style="--c:${esc(c ? c.color : '#9ca3af')};--check:${checkC}">
          ${it.note ? '<span class="td-note" aria-hidden="true">📝</span>' : `<button type="button" class="td-check" role="checkbox" aria-checked="${it.done}" aria-label="${it.done ? 'Mark not done' : 'Mark done'}: ${esc(it.title)}"><span></span></button>`}
          <div class="td-main"><button type="button" class="td-title">${esc(it.title)}</button>${descHtml}<div class="td-meta">${meta.join('')}</div></div>
          ${catSel(it)}</li>`;
      }).join('')}</ul></section>`;
    }).join('');
    if (!avail && sbc()) listEl.insertAdjacentHTML('afterbegin', '<p class="todo-note muted small">Quick jots and categories turn on after the database update.</p>');
  }
  async function todoClick(e) {
    const a = A(); const row = e.target.closest('.todo-row'); if (!row) return;
    if (e.target.closest('.td-check')) {
      const btn = e.target.closest('.td-check'); const v = btn.getAttribute('aria-checked') !== 'true';
      btn.setAttribute('aria-checked', String(v)); row.classList.toggle('checking', v); row.classList.toggle('done', v);
      try {
        if (row.dataset.ev) await a.setDone(row.dataset.ev, row.dataset.key, v);
        else { const it = (Inbox.cache || []).find(x => x.id === row.dataset.inbox); if (it) await Inbox.save({ ...it, done: v }); }
      } catch (err) { toast('Could not save: ' + err.message); }
      setTimeout(renderTodo, reduceMotion() ? 0 : 380); return;
    }
    if (e.target.closest('.td-title, .td-desc, .td-main') && !e.target.closest('.td-check, .cat-pick, select')) {
      // Prefer the quick-add sheet in edit mode (same options as create). Fall back to the full editor/inbox dialog.
      if (window.SandyQuickSheet && SandyQuickSheet.openEdit) {
        if (row.dataset.ev) SandyQuickSheet.openEdit({ type: 'task', id: row.dataset.ev, key: row.dataset.key });
        else SandyQuickSheet.openEdit({ type: 'inbox', id: row.dataset.inbox });
      } else if (row.dataset.ev) a.openEditor(row.dataset.ev, row.dataset.key);
      else editInbox((Inbox.cache || []).find(x => x.id === row.dataset.inbox));
    }
  }
  async function todoCatChange(e) {
    const sel = e.target.closest('.cat-pick'); if (!sel) return;
    const a = A(); const row = sel.closest('.todo-row'); const v = sel.value || null;
    try {
      if (row.dataset.ev) {
        const ev = await a.Store.get(row.dataset.ev); if (!ev) return;
        await a.Store.save({ ...ev, todoCategoryId: v });
        const ad = a.Store.adapter; if (ad && ad.missingCols && ad.missingCols.has('todo_category_id')) toast('Categories on scheduled to-dos turn on after the database update.');
      } else { const it = (Inbox.cache || []).find(x => x.id === row.dataset.inbox); if (it) await Inbox.save({ ...it, categoryId: v }); }
      renderTodo();
    } catch (err) { toast('Could not save: ' + err.message); }
  }
  function dialog(cls, html) {
    const d = document.createElement('dialog'); d.className = 'nav-dlg ' + cls; d.innerHTML = html;
    document.body.appendChild(d); d.addEventListener('close', () => d.remove());
    d.showModal ? d.showModal() : d.setAttribute('open', ''); return d;
  }
  async function editInbox(it) {
    if (!it) return;
    const cats = Cats.cache || [];
    const d = dialog('inbox-dlg', `<form method="dialog"><h2>${it.kind === 'note' ? 'Note' : 'To-do'}</h2>
      <label>Text<textarea id="ibBody" name="task-body" rows="4" maxlength="2000" autocomplete="off" autocapitalize="sentences" spellcheck="true">${esc(it.body)}</textarea></label>
      <div class="row2"><label>Type<select id="ibKind"><option value="todo">To-do</option><option value="note">Note</option></select></label>
      <label>Calendar<select id="ibCal"><option value="">Inbox (none)</option>${A().calendars().map(c => `<option value="${esc(c.id)}">${esc(c.name)}</option>`).join('')}</select></label></div>
      <label>Category<select id="ibCat"><option value="">No category</option>${cats.map(c => `<option value="${esc(c.id)}">${esc(c.name)}</option>`).join('')}</select></label>
      <p class="onb-err" role="alert"></p>
      <div class="dialog-actions"><button type="button" id="ibDel" class="danger">Delete</button><button type="button" id="ibSched">📅 Schedule…</button><span class="spacer"></span><button value="cancel" formnovalidate>Cancel</button><button id="ibSave" class="primary">Save</button></div></form>`);
    d.querySelector('#ibKind').value = it.kind || 'todo'; d.querySelector('#ibCal').value = it.calendar || ''; d.querySelector('#ibCat').value = it.categoryId || '';
    const val = () => ({ ...it, body: d.querySelector('#ibBody').value.trim(), kind: d.querySelector('#ibKind').value, calendar: d.querySelector('#ibCal').value || null, categoryId: d.querySelector('#ibCat').value || null });
    d.querySelector('#ibSave').onclick = async e => { e.preventDefault(); const v = val(); if (!v.body) return; try { await Inbox.save(v); d.close(); renderTodo(); } catch (err) { d.querySelector('.onb-err').textContent = err.message; } };
    d.querySelector('#ibDel').onclick = async () => { try { await Inbox.remove(it.id); d.close(); toast('Deleted'); renderTodo(); } catch (err) { d.querySelector('.onb-err').textContent = err.message; } };
    d.querySelector('#ibSched').onclick = () => { const v = val(); d.close(); schedule(v); };
  }
  // Turn an inbox jot into a dated to-do: open the editor prefilled; when it's saved, the jot is removed.
  async function schedule(it) {
    const a = A(); const before = new Set((await a.Store.list()).map(e => e.id)); const today = a.ymd(a.nowWall());
    await a.openEditor(null, null, { kind: 'task', title: it.body.split('\n')[0].slice(0, 200), notes: it.body.includes('\n') ? it.body : '', calendar: it.calendar && a.cal(it.calendar) ? it.calendar : a.firstVisibleCal(), allDay: true, start: today, end: today, todoCategoryId: it.categoryId });
    const dlg = $('eventDialog');
    dlg.addEventListener('close', async () => {
      setTimeout(async () => {
        const added = (await a.Store.list()).find(e => !before.has(e.id) && e.kind === 'task');
        if (added) { if (it.categoryId && !added.todoCategoryId) { try { await a.Store.save({ ...added, todoCategoryId: it.categoryId }); } catch (_) {} } await Inbox.remove(it.id).catch(() => {}); toast('Scheduled'); }
        renderTodo();
      }, 700);
    }, { once: true });
  }
  // ---- Smart quick add (Todoist-style): recognized dates, times and categories show as blue chips while typing.
  const qa = { disabled: new Set(), parsed: null, prev: new Set() };
  const fmtTime = hm => { if (window.SandyTime) return SandyTime.fmtHM(hm, { compact: true }); const [h, m] = hm.split(':').map(Number); return `${(h % 12) || 12}${m ? ':' + String(m).padStart(2, '0') : ''} ${h < 12 ? 'AM' : 'PM'}`; };
  // shared by the inline quick add and the To-Do "+" sheet (quicksheet.js)
  function parseQuick(text, kind = 'todo', disabled = new Set()) {
    const a = A();
    if (!window.SandyParse || !a) return { tokens: [], date: null, time: null, category: null, priority: null, title: text.trim() };
    const p = window.SandyParse.parse(text, { now: a.nowWall(), categories: Cats.available ? (Cats.cache || []) : [], disabled, h24: !!(window.SandyTime && SandyTime.is24()) });
    if (kind === 'note') { p.tokens = p.tokens.filter(t => t.kind === 'category'); p.date = p.time = null; p.priority = null; p.title = text.trim(); }
    return p;
  }
  const qaParse = () => parseQuick($('qaText').value, $('qaKind').value, qa.disabled);
  function qaPaint() {
    const inp = $('qaText'), hl = $('qaHl'), text = inp.value;
    // forget tapped-off chips once their words are gone
    if (qa.disabled.size) for (const k of [...qa.disabled]) if (!text.toLowerCase().replace(/\s+/g, ' ').includes(k.slice(k.indexOf(':') + 1))) qa.disabled.delete(k);
    const p = qa.parsed = qaParse();
    let h = '', last = 0;
    for (const t of p.tokens) { h += esc(text.slice(last, t.start)) + `<span class="qa-chip qa-${t.kind}${qa.prev.has(t.key) ? '' : ' qa-new'}" data-key="${esc(t.key)}">${esc(text.slice(t.start, t.end))}</span>`; last = t.end; }
    h += esc(text.slice(last));
    qa.prev = new Set(p.tokens.map(t => t.key));
    hl.innerHTML = h + '\u200b';
    $('quickAdd').classList.toggle('has-text', !!text);
    hl.scrollLeft = inp.scrollLeft;
    const pv = $('qaPreview'); const a = A();
    if (!p.tokens.length || !a) { pv.hidden = true; pv.innerHTML = ''; return; }
    const parts = [];
    if (p.date) parts.push(['date', '📅 ' + a.fmtDay(a.parseLocal(p.date)) + (p.time ? ' · ' + fmtTime(p.time) : '')]);
    if (p.category) parts.push(['category', '# ' + p.category.name]);
    pv.innerHTML = `<span class="muted small">${p.date ? 'Adds a to-do' : 'Adds to Inbox'}${p.title ? ` “${esc(p.title)}”` : ''}:</span> ` + parts.map(([k, l]) => `<button type="button" class="qa-pv qa-${k}" data-kind="${k}" title="Tap to keep as plain text">${esc(l)} <span aria-hidden="true">✕</span><span class="sr-only"> (remove)</span></button>`).join('');
    pv.hidden = false;
  }
  function qaUnrecognize(keys) { for (const k of keys) qa.disabled.add(k); qaPaint(); }
  function qaTapInput() {
    // Tap on an inline chip (caret lands inside it, nothing selected) → keep those words as plain text.
    const inp = $('qaText'); const p = qa.parsed; if (!p || inp.selectionStart !== inp.selectionEnd) return;
    const pos = inp.selectionStart; const t = p.tokens.find(x => pos > x.start && pos < x.end);
    if (t) qaUnrecognize([t.key]);
  }
  // One save path for quick adds. Dated → a scheduled to-do (event kind 'task'); undated → an Inbox jot (to-do or note).
  // opts: { raw, parsed, kind, categoryId, calendar, priority (1-4), reminders [min], description, date, time }
  async function saveQuick(o) {
    const a = A(); const p = o.parsed || parseQuick(o.raw, o.kind);
    const date = o.date !== undefined ? o.date : p.date, time = o.time !== undefined ? o.time : p.time;
    const categoryId = (p.category && p.category.id) || o.categoryId || null;
    const priority = o.priority || p.priority || 4;
    const desc = (o.description || '').trim();
    if (date && o.kind !== 'note') {
      const start = time ? `${date}T${time}` : date;
      const ev = { id: uid(), kind: 'task', title: (p.title || o.raw.trim()).slice(0, 200), calendar: o.calendar && a.cal(o.calendar) ? o.calendar : a.firstVisibleCal(), allDay: !time, start, end: start, recurrence: { freq: 'none', interval: 1 }, location: '', notes: desc, todoCategoryId: categoryId, reminders: o.reminders || [] };
      if (priority !== 4) ev.priority = priority;
      await a.Store.save(ev); if (a.refresh) a.refresh();
      return { sel: `[data-ev="${CSS.escape(ev.id)}"]`, msg: `Added “${ev.title}” · ${a.fmtDay(a.parseLocal(date))}${time ? ' ' + fmtTime(time) : ''}`, ev };
    }
    const body = (o.kind === 'note' ? o.raw.trim() : (p.title || o.raw.trim())) + (desc ? '\n' + desc : '');
    const item = { id: uid(), body, kind: o.kind || 'todo', calendar: o.calendar || null, categoryId, done: false, createdAt: new Date().toISOString() };
    if (priority !== 4) item.priority = priority;
    const saved = await Inbox.save(item);
    return { sel: `[data-inbox="${CSS.escape(item.id)}"]`, msg: `Added “${body.split('\n')[0].slice(0, 60)}” to ${o.calendar && a.cal(o.calendar) ? a.cal(o.calendar).name : 'Inbox'}`, item: saved || item };
  }

  // Update an existing scheduled to-do or Inbox jot from the quick-sheet edit mode.
  // opts: same as saveQuick + { edit: { type:'task'|'inbox', id, key?, ev?, item? } }
  async function saveEdit(o) {
    const a = A(); const ed = o.edit; if (!ed || !ed.id) throw new Error('Nothing to edit');
    const p = o.parsed || parseQuick(o.raw, o.kind);
    const date = o.date !== undefined ? o.date : p.date, time = o.time !== undefined ? o.time : p.time;
    const categoryId = (p.category && p.category.id) || o.categoryId || null;
    const priority = o.priority || p.priority || 4;
    const desc = (o.description || '').trim();
    const title = (p.title || o.raw.trim()).slice(0, 200);
    const wantDated = !!(date && o.kind !== 'note');

    if (ed.type === 'task') {
      const ev = ed.ev || await a.Store.get(ed.id); if (!ev) throw new Error('To-do not found');
      if (!wantDated) {
        // Cleared the date → move back to Inbox
        const body = (o.kind === 'note' ? o.raw.trim() : title) + (desc ? '\n' + desc : '');
        const item = { id: uid(), body, kind: o.kind || 'todo', calendar: o.calendar || null, categoryId, done: false, createdAt: new Date().toISOString() };
        if (priority !== 4) item.priority = priority;
        await Inbox.save(item);
        await a.Store.remove(ev.id);
        if (a.refresh) a.refresh();
        return { sel: `[data-inbox="${CSS.escape(item.id)}"]`, msg: 'Moved to Inbox', item, reminders: [] };
      }
      const start = time ? `${date}T${time}` : date;
      const next = {
        ...ev, kind: 'task', title, calendar: o.calendar && a.cal(o.calendar) ? o.calendar : (a.cal(ev.calendar) ? ev.calendar : a.firstVisibleCal()),
        allDay: !time, start, end: start, notes: desc, todoCategoryId: categoryId,
        reminders: o.reminders || [], priority: priority !== 4 ? priority : null,
      };
      await a.Store.save(next); if (a.refresh) a.refresh();
      if (window.__app && typeof window.__app.afterReminders === 'function') window.__app.afterReminders(next.reminders);
      else if (next.reminders && next.reminders.length && window.SandyPush) SandyPush.nudge();
      return { sel: `[data-ev="${CSS.escape(next.id)}"]`, msg: 'Saved', ev: next, reminders: next.reminders };
    }

    // inbox jot
    const it = ed.item || (Inbox.cache || []).find(x => x.id === ed.id);
    if (!it) throw new Error('To-do not found');
    if (wantDated) {
      const start = time ? `${date}T${time}` : date;
      const ev = {
        id: uid(), kind: 'task', title, calendar: o.calendar && a.cal(o.calendar) ? o.calendar : a.firstVisibleCal(),
        allDay: !time, start, end: start, recurrence: { freq: 'none', interval: 1 }, location: '', notes: desc,
        todoCategoryId: categoryId, reminders: o.reminders || [],
      };
      if (priority !== 4) ev.priority = priority;
      await a.Store.save(ev);
      await Inbox.remove(it.id).catch(() => {});
      if (a.refresh) a.refresh();
      if (ev.reminders && ev.reminders.length && window.SandyPush) SandyPush.nudge();
      return { sel: `[data-ev="${CSS.escape(ev.id)}"]`, msg: 'Scheduled', ev, reminders: ev.reminders };
    }
    const body = (o.kind === 'note' ? o.raw.trim() : title) + (desc ? '\n' + desc : '');
    const next = { ...it, body, kind: o.kind || 'todo', calendar: o.calendar || null, categoryId, priority: priority !== 4 ? priority : null };
    const saved = await Inbox.save(next);
    return { sel: `[data-inbox="${CSS.escape(it.id)}"]`, msg: 'Saved', item: saved || next, reminders: [] };
  }

  async function deleteTodoTarget(ed) {
    const a = A(); if (!ed || !ed.id) return;
    if (ed.type === 'task') { await a.Store.remove(ed.id); if (a.refresh) a.refresh(); }
    else await Inbox.remove(ed.id);
  }

  async function quickAdd(e) {
    e.preventDefault();
    const raw = $('qaText').value.trim(); if (!raw) { $('qaText').focus(); return; }
    const calFilter = todoUI.filter !== 'all' && todoUI.filter !== 'inbox' ? todoUI.filter : null;
    $('qaAdd').disabled = true;
    try {
      const r = await saveQuick({ raw, parsed: qaParse(), kind: $('qaKind').value, categoryId: $('qaCat').value || null, calendar: calFilter });
      if (r.ev) toast(r.msg);
      $('qaText').value = ''; qa.disabled.clear(); qaPaint();
      await renderTodo(); const row = document.querySelector(r.sel); if (row) row.classList.add('just-added');
    } catch (err) { toast('Could not save: ' + err.message); }
    $('qaAdd').disabled = false; $('qaText').focus();
  }
  async function manageCats() {
    let cats = []; try { cats = await Cats.list(); } catch (e) { toast(e.message); return; }
    if (!Cats.available) { toast('Categories turn on after the database update.'); return; }
    const COLORS = ['#ef4444', '#f59e0b', '#10b981', '#3b82f6', '#8b5cf6', '#ec4899', '#6b7280'];
    const d = dialog('cats-dlg', `<form method="dialog"><h2>To-do categories</h2>
      <ul id="catRows" class="cat-rows"></ul>
      <div class="cat-new"><input id="catName" name="category-name" maxlength="40" placeholder="New category, e.g. Errands" autocomplete="off" autocapitalize="sentences" spellcheck="true"><input type="color" id="catColor" value="${COLORS[cats.length % COLORS.length]}" aria-label="Color"><button id="catAdd" type="button" class="primary">Add</button></div>
      <p class="onb-err" role="alert"></p>
      <div class="dialog-actions"><span class="spacer"></span><button value="done">Done</button></div></form>`);
    const err = d.querySelector('.onb-err');
    const paint = () => { d.querySelector('#catRows').innerHTML = cats.length ? cats.map(c => `<li class="msg-up" data-id="${esc(c.id)}"><input type="color" value="${esc(c.color)}" aria-label="Color"><input class="cn" name="category-name" value="${esc(c.name)}" maxlength="40" aria-label="Category name" autocomplete="off" autocapitalize="sentences" spellcheck="true"><button type="button" class="icon-btn del" aria-label="Delete ${esc(c.name)}">✕</button></li>`).join('') : '<li class="muted small">No categories yet.</li>'; };
    paint();
    d.querySelector('#catAdd').onclick = async () => {
      const name = d.querySelector('#catName').value.trim(); if (!name) return;
      if (cats.some(c => c.name.toLowerCase() === name.toLowerCase())) { err.textContent = 'You already have that category.'; return; }
      try { const c = await Cats.save({ id: uid(), name, color: d.querySelector('#catColor').value, sort: cats.length, createdAt: new Date().toISOString() }); cats.push(c); d.querySelector('#catName').value = ''; err.textContent = ''; paint(); }
      catch (e) { err.textContent = e.message; }
    };
    d.querySelector('#catRows').addEventListener('change', async e => {
      const li = e.target.closest('li[data-id]'); if (!li) return; const c = cats.find(x => x.id === li.dataset.id);
      const v = { ...c, color: li.querySelector('input[type=color]').value, name: li.querySelector('.cn').value.trim() || c.name };
      try { Object.assign(c, await Cats.save(v)); } catch (e2) { err.textContent = e2.message; }
    });
    d.querySelector('#catRows').addEventListener('click', async e => {
      const b = e.target.closest('.del'); if (!b) return; const li = b.closest('li');
      try { await Cats.remove(li.dataset.id); cats = cats.filter(c => c.id !== li.dataset.id); paint(); } catch (e2) { err.textContent = e2.message; }
    });
    d.addEventListener('close', () => renderTodo());
  }
  function setBadge(n) { const b = $('navTodoBadge'); if (!b) return; b.hidden = !n; b.textContent = n > 99 ? '99+' : String(n || ''); }
  async function refreshBadge() { try { const { items } = await todoItems(); setBadge(items.filter(i => i.overdue).length); } catch (_) {} }

  // ------------------------------------------------------------------ Search
  const SETTINGS = [
    ['Dark mode', 'dark theme night appearance colors', 'appearanceSection', 'darkToggle'],
    ['Default view', 'home start view last used day week month season list', 'appearanceSection', 'defaultView'],
    ['Time format', 'time format 12 hour 24 hour military clock am pm', 'appearanceSection', 'timeFormat'],
    ['Profile picture', 'avatar photo picture image', 'page-profile', 'avatarBtn'],
    ['Change email', 'email address account login', 'page-profile', 'pfEmailBtn'],
    ['Calendars: show / hide / add', 'calendars toggle visible add new color rename manage', 'calSection', 'toggleAll'],
    ['Notifications', 'push notifications reminders alerts enable iphone', 'pushBox', 'pushEnable'],
    ['Home address (leave-by times)', 'home address leave by drive travel commute directions location', 'homeSection', 'homeAddr'],
    ['Time zone', 'time zone timezone tz clock', 'accountSection', null],
    ['Export my data', 'export download backup json data', 'accountSection', 'acctExport'],
    ['Import JSON', 'import restore upload json data', 'dataSection', 'importBtn'],
    ['Delete my account', 'delete remove account close', 'accountSection', 'acctDelete'],
    ['Send feedback', 'feedback bug idea help contact', 'accountSection', null],
    ['Welcome guide', 'welcome guide getting started intro beta tips help', 'accountSection', 'welcomeBtn'],
    ['Take the tour', 'tour tutorial walkthrough guide help onboarding', 'accountSection', 'tourBtn'],
    ['Invites (admin)', 'invite invites admin users', 'accountSection', null],
    ['Sign out', 'sign out log out logout', 'dataSection', 'signOutBtn'],
    ['Remove example events', 'examples sample demo remove', 'dataSection', 'clearExamplesBtn'],
    ['Refresh now', 'sync refresh reload', 'dataSection', 'syncNowBtn'],
    ['To-do categories', 'todo to-do categories labels tags', 'page-todo', 'todoCatsBtn'],
    ['Notes Review', 'notes review today\'s notes browse', 'reviewSection', null],
  ];
  let searchSeq = 0;
  const words = q => q.toLowerCase().split(/\s+/).filter(Boolean);
  const hit = (ws, ...fields) => { const hay = fields.filter(Boolean).join(' ').toLowerCase(); return ws.every(w => hay.includes(w)); };
  const mark = (s, ws) => { let h = esc(s); for (const w of ws) { if (w.length < 2) continue; h = h.replace(new RegExp('(' + esc(w).replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + ')(?![^<]*>)', 'ig'), '<mark>$1</mark>'); } return h; };
  const snippet = (s, ws) => { const t = String(s || '').replace(/\s+/g, ' '); const i = Math.max(0, ...ws.map(w => t.toLowerCase().indexOf(w))); const st = Math.max(0, i - 30); return (st ? '…' : '') + t.slice(st, st + 110) + (t.length > st + 110 ? '…' : ''); };
  async function renderSearch() {
    const a = A(); if (!a) return; const seq = ++searchSeq;
    const q = $('searchBox').value.trim(); const ws = words(q); const out = $('searchResults');
    if (!ws.length) { out.innerHTML = '<p class="muted small search-hint">Find events, to-dos, Today\'s Notes, quick jots and settings.</p>'; return; }
    const now = a.nowWall(), today = a.startOfDay(now);
    const all = await a.Store.list(); let notes = []; try { notes = await a.Store.notes.all(); } catch (_) {}
    let inbox = []; try { inbox = await Inbox.list(); } catch (_) {}
    if (seq !== searchSeq) return;
    const byId = new Map(all.map(e => [e.id, e]));
    const nextOcc = ev => { const f = a.occurrences(ev, today, a.addDays(today, 400))[0]; if (f) return f; const p = a.occurrences(ev, a.addDays(today, -3650), today); return p[p.length - 1] || null; };
    const evs = [], tds = [];
    for (const ev of all) {
      if (ev.seriesId) continue;
      const c = a.cal(ev.calendar) || {};
      if (!hit(ws, ev.title, ev.location, ev.notes, ev.category, c.name, c.short)) continue;
      const o = nextOcc(ev); (ev.kind === 'task' ? tds : evs).push({ ev, o, c });
    }
    const sortO = l => l.sort((x, y) => (x.o ? (x.o.start < today ? 1 : 0) : 2) - (y.o ? (y.o.start < today ? 1 : 0) : 2) || ((x.o && x.o.start) - (y.o && y.o.start)));
    sortO(evs); sortO(tds);
    const nts = notes.filter(n => byId.has(n.eventId) && hit(ws, n.body, byId.get(n.eventId).title)).sort((x, y) => y.date.localeCompare(x.date));
    const ibx = inbox.filter(i => hit(ws, i.body));
    const sets = SETTINGS.filter(s => hit(ws, s[0], s[1]) && document.getElementById(s[2]));
    const when = (x) => x.o ? (x.ev.allDay ? a.fmtDay(x.o.start) : `${a.fmtDay(x.o.start)} · ${t12(x.o.start)}`) + (a.isRecurring(x.ev) ? ' · repeats' : '') : '';
    const group = (title, list, fn) => list.length ? `<section class="sr-group msg-up"><h3>${title} <span class="muted small">${list.length}</span></h3><ul>${list.slice(0, 25).map(fn).join('')}</ul>${list.length > 25 ? `<p class="muted small">+ ${list.length - 25} more. Add a word to narrow it down.</p>` : ''}</section>` : '';
    const dot = c => `<span class="dot" style="background:${esc(c.color || '#999')}"></span>`;
    let h = '';
    h += group('Events', evs, x => `<li><button type="button" class="sr-item" data-ev="${esc(x.ev.id)}" data-key="${esc(x.o ? x.o.key : '')}">${dot(x.c)}<span class="sr-t">${mark(x.ev.title, ws)}</span><span class="sr-m">${esc(when(x))}${x.ev.location ? ' · ' + mark(x.ev.location, ws) : ''}</span></button></li>`);
    h += group('To-dos', tds, x => `<li><button type="button" class="sr-item" data-ev="${esc(x.ev.id)}" data-key="${esc(x.o ? x.o.key : '')}">${dot(x.c)}<span class="sr-t">${x.o && a.isDone(x.ev, x.o.key) ? '☑︎ ' : '☐ '}${mark(x.ev.title, ws)}</span><span class="sr-m">${esc(when(x))}</span></button></li>`);
    h += group('Quick jots', ibx, i => `<li><button type="button" class="sr-item" data-inbox="${esc(i.id)}"><span class="dot" style="background:#9ca3af"></span><span class="sr-t">${i.kind === 'note' ? '📝 ' : i.done ? '☑︎ ' : '☐ '}${mark(i.body, ws)}</span><span class="sr-m">To-Do inbox</span></button></li>`);
    h += group('Today\'s Notes', nts, n => { const ev = byId.get(n.eventId); return `<li><button type="button" class="sr-item" data-ev="${esc(n.eventId)}" data-key="${esc(n.date)}">${dot(a.cal(ev.calendar) || {})}<span class="sr-t">${esc(ev.title)} · ${esc(a.fmtDay(a.parseLocal(n.date)))}</span><span class="sr-m">${mark(snippet(n.body, ws), ws)}</span></button></li>`; });
    h += group('Settings', sets, s => `<li><button type="button" class="sr-item" data-set="${esc(s[2])}" data-focus="${esc(s[3] || '')}"><span class="sr-ico" aria-hidden="true">⚙︎</span><span class="sr-t">${mark(s[0], ws)}</span></button></li>`);
    out.innerHTML = h || `<p class="muted search-empty">No matches for “${esc(q)}”.</p>`;
  }
  function jumpTo(id, focusId) {
    const target = $(id); if (!target) return;
    const t = target.closest('#page-todo') ? 'todo' : target.closest('#page-search') ? 'search' : 'profile';
    go(t);
    requestAnimationFrame(() => {
      const el = (target.id === 'page-' + t && focusId && $(focusId)) || target;
      el.scrollIntoView({ block: 'center', behavior: reduceMotion() ? 'auto' : 'smooth' });
      const fl = el.closest('section') || el; fl.classList.remove('flash'); void fl.offsetWidth; fl.classList.add('flash'); setTimeout(() => fl.classList.remove('flash'), 1300);
      const f = focusId && $(focusId); if (f && !f.hidden) f.focus({ preventScroll: true });
    });
  }
  function searchClick(e) {
    const b = e.target.closest('.sr-item'); if (!b) return;
    if (b.dataset.ev) A().openEditor(b.dataset.ev, b.dataset.key || undefined);
    else if (b.dataset.inbox) { go('todo'); setTimeout(() => editInbox((Inbox.cache || []).find(x => x.id === b.dataset.inbox)), 50); }
    else if (b.dataset.set) jumpTo(b.dataset.set, b.dataset.focus);
  }

  // ------------------------------------------------------------------ Profile
  const AV_PATH = u => `${u.id}/avatar.jpg`;
  async function avatarUrl() {
    const a = A(); const sb = sbc(); const u = a.user && a.user();
    if (!sb || !u) return readLS(LS.avatar, null);
    try { const { data, error } = await sb.storage.from('avatars').createSignedUrl(AV_PATH(u), 3600); return error ? null : data.signedUrl; } catch (_) { return null; }
  }
  function showAvatar(url) {
    const a = A(); const u = a && a.user && a.user();
    const img = $('avatarImg'), ini = $('avatarInit');
    const name = (u && u.email) || 'You';
    ini.textContent = name.replace(/[^a-z0-9]/ig, '').slice(0, 1).toUpperCase() || '🙂';
    img.hidden = !url; ini.hidden = !!url; if (url) img.src = url;
    const navBtn = document.querySelector('#bottomNav [data-tab=profile]');
    let mini = navBtn.querySelector('img.nav-av');
    if (url) { if (!mini) { mini = document.createElement('img'); mini.className = 'nav-av'; mini.alt = ''; navBtn.querySelector('svg').after(mini); } mini.src = url; navBtn.classList.add('has-av'); }
    else { if (mini) mini.remove(); navBtn.classList.remove('has-av'); }
  }
  function squareJpeg(file, size = 256) {
    return new Promise((res, rej) => {
      const img = new Image(); const url = URL.createObjectURL(file);
      img.onload = () => {
        const s = Math.min(img.naturalWidth, img.naturalHeight); const cv = document.createElement('canvas'); cv.width = cv.height = size;
        const ctx = cv.getContext('2d'); ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, size, size);
        ctx.drawImage(img, (img.naturalWidth - s) / 2, (img.naturalHeight - s) / 2, s, s, 0, 0, size, size);
        URL.revokeObjectURL(url); cv.toBlob(b => b ? res(b) : rej(new Error('Could not read that image')), 'image/jpeg', 0.86);
      };
      img.onerror = () => { URL.revokeObjectURL(url); rej(new Error('That file is not an image')); };
      img.src = url;
    });
  }
  async function uploadAvatar(file) {
    if (!file) return;
    if (file.size > 15 * 1024 * 1024) { toast('That picture is too big (max 15 MB)'); return; }
    const a = A(); const sb = sbc(); const u = a.user && a.user();
    try {
      const blob = await squareJpeg(file);
      if (!sb || !u) { const r = new FileReader(); r.onload = () => { localStorage.setItem(LS.avatar, JSON.stringify(r.result)); showAvatar(r.result); toast('Profile picture updated'); }; r.readAsDataURL(blob); return; }
      const { error } = await sb.storage.from('avatars').upload(AV_PATH(u), blob, { upsert: true, contentType: 'image/jpeg', cacheControl: '60' });
      if (error) throw new Error(/bucket not found|not found/i.test(error.message) ? 'Profile pictures turn on after the database update.' : error.message);
      showAvatar(await avatarUrl()); toast('Profile picture updated');
    } catch (e) { toast(e.message || String(e)); }
  }
  function changeEmail() {
    const a = A(); const sb = sbc(); const u = a.user && a.user(); if (!sb || !u) return;
    const d = dialog('email-dlg', `<form method="dialog"><h2>Change email</h2>
      <p class="small">Now: <b>${esc(u.email)}</b></p>
      <label>New email<input id="neEmail" type="email" autocomplete="email" autocapitalize="off" spellcheck="false" required></label>
      <p class="muted small">We'll email a confirmation link to the new address (and a notice to the current one). The change happens after you open it.</p>
      <p class="onb-err" role="alert"></p>
      <div class="dialog-actions"><span class="spacer"></span><button value="cancel" formnovalidate>Cancel</button><button id="neGo" class="primary">Send link</button></div></form>`);
    d.querySelector('#neGo').onclick = async e => {
      e.preventDefault(); const em = d.querySelector('#neEmail').value.trim(); const err = d.querySelector('.onb-err');
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(em)) { err.textContent = 'Enter a valid email.'; return; }
      if (em.toLowerCase() === (u.email || '').toLowerCase()) { err.textContent = 'That is already your email.'; return; }
      e.target.disabled = true;
      const { error } = await sb.auth.updateUser({ email: em }, { emailRedirectTo: CFG.SITE_URL || location.href.split('?')[0] });
      if (error) { err.textContent = error.message; e.target.disabled = false; return; }
      d.querySelector('form').innerHTML = `<h2>Check your inbox</h2><p>We sent a confirmation link to <b>${esc(em)}</b>. Open it to finish the change.</p><div class="dialog-actions"><span class="spacer"></span><button class="primary" value="ok">OK</button></div>`;
    };
  }
  // Calendars screen: opens on a plain list; tapping a calendar opens its editor (name, short name, colour).
  // Works signed in (calendars table, per user) and in local mode (the list is kept on this device).
  async function manageCalendars() {
    const a = A(); const sb = sbc(); const S = a.Store;
    const cals = a.calendars();
    const sw = c => `<span class="cal-sw" style="background:${esc(c.color)}" aria-hidden="true"></span>`;
    const d = dialog('cal-dlg', `<form method="dialog" novalidate><h2 tabindex="-1" autofocus>Calendars</h2>
      <p class="muted small">Tap a calendar to rename it or change its color.</p>
      <ul class="cal-list">${cals.map(c => `<li data-slug="${esc(c.id)}">
        <button type="button" class="cal-item" aria-expanded="false">${sw(c)}<span class="cal-nm">${esc(c.name)}</span><span class="cal-edit-lbl">Edit</span></button>
        <div class="cal-edit" hidden>
          <label>Name<input class="cn" value="${esc(c.name)}" maxlength="80"></label>
          <div class="cal-edit-row"><label>Short name<input class="cs" value="${esc(c.short || '')}" maxlength="20" placeholder="Short"></label>
          <label class="cal-color">Color<input type="color" value="${esc(c.color)}"></label></div>
        </div></li>`).join('')}</ul>
      <button type="button" id="calAddBtn" class="link-btn cal-add-btn" aria-expanded="false">+ Add a calendar</button>
      <div class="cal-new" hidden>
        <label>New calendar name<input id="ncName" maxlength="80" placeholder="e.g. Personal" autocapitalize="words"></label>
        <label class="cal-color">Color<input type="color" id="ncColor" value="#2563eb"></label>
      </div>
      <p class="onb-err" role="alert"></p>
      <div class="dialog-actions"><span class="spacer"></span><button value="cancel" formnovalidate>Cancel</button><button id="calSave" class="primary">Save</button></div></form>`);
    const open = (li, on) => { const ed = li.querySelector('.cal-edit'), b = li.querySelector('.cal-item'); ed.hidden = !on; b.setAttribute('aria-expanded', String(on)); li.classList.toggle('open', on); if (on) ed.classList.add('msg-up'); };
    d.querySelectorAll('.cal-list li').forEach(li => li.querySelector('.cal-item').addEventListener('click', () => {
      const on = li.querySelector('.cal-edit').hidden; d.querySelectorAll('.cal-list li').forEach(x => open(x, false)); open(li, on);
      if (on) li.querySelector('.cn').focus();
    }));
    d.querySelectorAll('.cal-list li input[type=color]').forEach(inp => inp.addEventListener('input', () => { inp.closest('li').querySelector('.cal-sw').style.background = inp.value; }));
    d.querySelector('#calAddBtn').addEventListener('click', e => { const nw = d.querySelector('.cal-new'); nw.hidden = false; nw.classList.add('msg-up'); e.currentTarget.setAttribute('aria-expanded', 'true'); e.currentTarget.hidden = true; d.querySelector('#ncName').focus(); });
    d.querySelector('#calSave').onclick = async e => {
      e.preventDefault(); const err = d.querySelector('.onb-err'); err.textContent = ''; e.target.disabled = true;
      try {
        const edits = [];
        for (const li of d.querySelectorAll('.cal-list li')) {
          const c = cals.find(x => x.id === li.dataset.slug); const name = li.querySelector('.cn').value.trim(), short = li.querySelector('.cs').value.trim(), color = li.querySelector('input[type=color]').value;
          if (!name) { open(li, true); throw new Error('Calendar names cannot be empty.'); }
          if (name !== c.name || short !== (c.short || '') || color.toLowerCase() !== String(c.color).toLowerCase()) edits.push({ c, name, short: short || null, color });
        }
        const nn = d.querySelector('#ncName').value.trim();
        if (nn && cals.some(c => c.name.trim().toLowerCase() === nn.toLowerCase())) throw new Error(`You already have a calendar called "${nn}".`);
        let added = null;
        if (nn) {
          const slugify = (window.SandyAccount && window.SandyAccount.slugify) || (s => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 30) || 'calendar');
          const taken = new Set(cals.map(c => c.id)); // existing slugs, so the new one never collides
          let slug = slugify(nn, taken); for (let i = 2; taken.has(slug) && !window.SandyAccount; i++) slug = slugify(nn).slice(0, 26) + '-' + i;
          added = { slug, name: nn, short: nn.slice(0, 12), color: d.querySelector('#ncColor').value, sort: cals.length };
        }
        if (!edits.length && !added) { d.close(); return; }
        if (sb) {
          for (const x of edits) await S.updateCalendar(x.c.id, { name: x.name, short: x.short, color: x.color });
          if (added) await S.createCalendars([added]);
        } else { // local mode: keep the whole list on this device
          const rows = cals.map((c, i) => { const x = edits.find(y => y.c.id === c.id); return { slug: c.id, name: x ? x.name : c.name, short: x ? x.short : (c.short || null), color: x ? x.color : c.color, sort: i }; });
          if (added) rows.push(added);
          await S.saveCalendars(rows);
        }
        d.close(); toast(added ? `Added “${added.name}”` : 'Calendars saved'); setTimeout(() => { try { sessionStorage.setItem('sandy.tab', 'profile'); } catch (_) {} location.reload(); }, 500);
      } catch (ex) { err.textContent = ex.message || String(ex); e.target.disabled = false; }
    };
  }
  let profileOnce = false;
  async function renderProfile() {
    const a = A(); if (!a) return;
    const u = a.user && a.user();
    $('pfEmail').textContent = u ? u.email : 'Not signed in · this device only';
    $('pfName').textContent = u ? (u.email || '').split('@')[0] : 'You';
    $('pfEmailBtn').hidden = !(u && sbc());
    $('darkToggle').checked = document.documentElement.classList.contains('dark');
    let dv = 'last'; try { dv = localStorage.getItem('sandy.defaultView') || 'last'; } catch (_) {} $('defaultView').value = dv;
    if (window.SandyTime && $('timeFormat')) { $('timeFormat').value = SandyTime.pref(); $('timeFmtNote').textContent = `Auto follows your phone (now ${SandyTime.label()})`; }
    if (!profileOnce) { profileOnce = true; showAvatar(await avatarUrl()); }
    if (window.SandyLeave) SandyLeave.getHome().then(h => { const i = $('homeAddr'); if (i && document.activeElement !== i) i.value = h ? h.address : ''; }).catch(() => {});
    paintLeaveAlerts();
    paintSiPrefs();
  }
  // Leave-by alerts switches (Profile → Home). Alerts are per account; "use my location" is per device.
  async function paintLeaveAlerts() {
    if (!window.SandyLeave || !$('leaveAlerts')) return;
    const signedIn = !!sbc(); const p = await SandyLeave.getAlertPrefs();
    const al = $('leaveAlerts'), ea = $('leaveEarly'), ul = $('leaveUseLoc'), msg = $('leaveMsg');
    al.checked = signedIn && p.alerts; al.disabled = !signedIn;
    ea.checked = p.early; ea.disabled = !al.checked;
    ul.checked = SandyLeave.useLoc();
    if (!msg.dataset.keep) { msg.className = 'small home-msg'; msg.textContent = !signedIn ? 'Sign in to get leave-by alerts on your phone.' : ''; }
    if (signedIn && al.checked && window.SandyPush) { const st = await SandyPush.state(); if (st !== 'on' && !msg.dataset.keep) msg.textContent = st === 'ios-install' ? `Add SANDY to your Home Screen to get these alerts on ${SandyPush.platform() === 'ipad' ? 'iPad' : 'iPhone'}.` : 'Turn on notifications for this device to get these alerts.'; }
  }
  async function leaveSwitch(e) {
    const t = e.target, msg = $('leaveMsg'); msg.className = 'small home-msg'; delete msg.dataset.keep;
    try {
      if (t.id === 'leaveUseLoc') { SandyLeave.setUseLoc(t.checked); toast(t.checked ? 'Will use your location near leave time' : 'Leave-by times use home only'); }
      else if (t.id === 'leaveAlerts') {
        t.disabled = true;
        if (t.checked && window.SandyPush && (await SandyPush.state()) !== 'on') await SandyPush.enable();
        await SandyLeave.setAlertPrefs({ alerts: t.checked });
        toast(t.checked ? 'Leave-by alerts on' : 'Leave-by alerts off');
        if (t.checked && tab !== 'today') { msg.textContent = '✓ On. Open Today once a day so drive times stay fresh — SANDY also plans from home if you don’t.'; msg.classList.add('ok'); msg.dataset.keep = '1'; }
      } else if (t.id === 'leaveEarly') { await SandyLeave.setAlertPrefs({ early: t.checked }); toast(t.checked ? '10-minute heads-up on' : '10-minute heads-up off'); }
    } catch (ex) { t.checked = !t.checked; msg.textContent = ex && ex.code && window.SandyPush ? SandyPush.reason(ex).text : (ex.message || String(ex)); msg.classList.add('bad'); msg.dataset.keep = '1'; }
    finally { t.disabled = false; await paintLeaveAlerts(); }
  }

  // Sandy Intelligence toggles (Profile → Sandy Intelligence). Long-day first; later features add here.
  async function paintSiPrefs() {
    const msg = $('siMsg');
    if ($('siLongDay') && window.SandyLongDay) {
      const p = await SandyLongDay.getPrefs();
      $('siLongDay').checked = p.enabled;
    }
    if ($('siFreeGap') && window.SandyFreeGap) {
      const p = await SandyFreeGap.getPrefs();
      $('siFreeGap').checked = p.enabled;
    }
    if ($('siClash') && window.SandyClash) {
      const p = await SandyClash.getPrefs();
      $('siClash').checked = p.enabled;
    }
    if ($('siWeeklyReview') && window.SandyWeekly) {
      const p = await SandyWeekly.getPrefs();
      $('siWeeklyReview').checked = p.enabled;
    }
    if ($('siGrocery') && window.SandyGrocery) {
      const p = await SandyGrocery.getPrefs();
      $('siGrocery').checked = p.enabled;
    }
    if ($('siWeather') && window.SandyWeather) {
      const p = await SandyWeather.getPrefs();
      $('siWeather').checked = p.enabled;
    }
    if ($('siSimpleMode') && window.SandySimple) {
      $('siSimpleMode').checked = SandySimple.isOn();
    }
    if (msg && !msg.dataset.keep) { msg.className = 'small home-msg'; msg.textContent = ''; }
  }
  async function siSwitch(e) {
    const t = e.target, msg = $('siMsg'); if (msg) { msg.className = 'small home-msg'; delete msg.dataset.keep; }
    try {
      t.disabled = true;
      if (t.id === 'siLongDay' && window.SandyLongDay) {
        await SandyLongDay.setPrefs({ enabled: t.checked });
        toast(t.checked ? 'Long-day nudge on' : 'Long-day nudge off');
      } else if (t.id === 'siFreeGap' && window.SandyFreeGap) {
        await SandyFreeGap.setPrefs({ enabled: t.checked });
        toast(t.checked ? 'Free-gap coach on' : 'Free-gap coach off');
      } else if (t.id === 'siClash' && window.SandyClash) {
        await SandyClash.setPrefs({ enabled: t.checked });
        toast(t.checked ? 'Clash check on' : 'Clash check off');
      } else if (t.id === 'siWeeklyReview' && window.SandyWeekly) {
        await SandyWeekly.setPrefs({ enabled: t.checked });
        toast(t.checked ? 'Weekly review on' : 'Weekly review off');
      } else if (t.id === 'siGrocery' && window.SandyGrocery) {
        await SandyGrocery.setPrefs({ enabled: t.checked });
        toast(t.checked ? 'Grocery nudge on' : 'Grocery nudge off');
      } else if (t.id === 'siWeather' && window.SandyWeather) {
        await SandyWeather.setPrefs({ enabled: t.checked });
        toast(t.checked ? 'Weather Heads Up on' : 'Weather Heads Up off');
      } else if (t.id === 'siSimpleMode' && window.SandySimple) {
        SandySimple.set(t.checked);
        toast(t.checked ? 'Simple Today on' : 'Simple Today off');
      } else return;
      if (tab === 'today') renderToday();
    } catch (ex) { t.checked = !t.checked; if (msg) { msg.textContent = ex.message || String(ex); msg.classList.add('bad'); msg.dataset.keep = '1'; } }
    finally { t.disabled = false; await paintSiPrefs(); }
  }


  // ------------------------------------------------------------------ wiring
  function wire() {
    $('bottomNav').addEventListener('click', e => { const b = e.target.closest('button[data-tab]'); if (b) go(b.dataset.tab); });
    // Today icon shows today's date
    // To-Do
    $('quickAdd').addEventListener('submit', quickAdd);
    $('qaText').addEventListener('input', qaPaint);
    $('qaText').addEventListener('scroll', () => { $('qaHl').scrollLeft = $('qaText').scrollLeft; });
    $('qaText').addEventListener('keyup', () => { $('qaHl').scrollLeft = $('qaText').scrollLeft; });
    $('qaText').addEventListener('click', () => setTimeout(qaTapInput, 0));
    $('qaKind').addEventListener('change', qaPaint);
    $('qaPreview').addEventListener('pointerdown', e => { if (e.target.closest('.qa-pv')) e.preventDefault(); }); // keep the iPhone keyboard up
    $('qaPreview').addEventListener('click', e => { const b = e.target.closest('.qa-pv'); if (!b || !qa.parsed) return; const k = b.dataset.kind; qaUnrecognize(qa.parsed.tokens.filter(t => k === 'date' ? t.kind !== 'category' : t.kind === k).map(t => t.key)); const i = $('qaText'); i.focus(); i.setSelectionRange(i.value.length, i.value.length); });
    $('todoList').addEventListener('click', todoClick);
    $('todoList').addEventListener('change', todoCatChange);
    $('todoFilter').addEventListener('click', e => { const b = e.target.closest('[data-f]'); if (!b) return; todoUI.filter = b.dataset.f; saveTodoUI(); renderTodo(); });
    $('todoGroup').addEventListener('change', e => { todoUI.group = e.target.value; saveTodoUI(); renderTodo(); });
    $('todoShowDone').addEventListener('change', e => { todoUI.showDone = e.target.checked; saveTodoUI(); renderTodo(); });
    $('todoCatsBtn').addEventListener('click', manageCats);
    $('todoNewDated').addEventListener('click', () => { const a = A(); const t = a.ymd(a.nowWall()); a.openEditor(null, null, { kind: 'task', allDay: true, start: t, end: t, calendar: todoUI.filter !== 'all' && todoUI.filter !== 'inbox' && a.cal(todoUI.filter) ? todoUI.filter : a.firstVisibleCal() }); });
    // Today card taps
    $('todayCard').addEventListener('click', e => {
      if (window.SandySuggestions && SandySuggestions.onClick(e)) return;
      const stat = e.target.closest('[data-stat]');
      if (stat) {
        const k = stat.dataset.stat;
        if (k === 'overdue') {
          const el = document.querySelector('.tc-overdue');
          if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
        } else if (k === 'todos') { go('todo'); }
        else if (k === 'events') {
          const el = document.querySelector('.tc-on');
          if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }
        return;
      }
      if (e.target.closest('.lb-loc-yes, .lb-loc-no')) { SandyLeave.answerAsk(!!e.target.closest('.lb-loc-yes')).catch(() => {}); return; }
      if (e.target.closest('.lb-sethome')) { go('profile'); const s = $('homeSection'); if (s) { s.scrollIntoView({ block: 'center' }); setTimeout(() => $('homeAddr').focus(), 300); } return; }
      const cl = e.target.closest('.cl-add');
      if (cl && window.SandyClash) {
        e.preventDefault();
        cl.disabled = true;
        SandyClash.addCover(cl.dataset.dutyId, cl.dataset.dutyKey, cl.dataset.otherId, cl.dataset.otherKey).then(r => {
          const t = $('toast');
          const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
          t.innerHTML = `${esc(r.msg)} <button type="button" class="toast-undo">Undo</button>`;
          t.hidden = false;
          clearTimeout(window.__clToast);
          const undoBtn = t.querySelector('.toast-undo');
          const hide = () => { t.hidden = true; t.textContent = ''; };
          undoBtn.addEventListener('click', async () => {
            undoBtn.disabled = true;
            try { await r.undo(); toast('Undone'); if (tab === 'today') renderToday(); if (tab === 'todo') renderTodo(); }
            catch (err) { toast(err.message || 'Could not undo'); }
          }, { once: true });
          window.__clToast = setTimeout(hide, 6000);
          if (tab === 'today') renderToday();
          if (tab === 'todo') renderTodo();
          window.dispatchEvent(new Event('sandy:refresh'));
        }).catch(err => { toast(err.message || String(err)); cl.disabled = false; });
        return;
      }
      const fg = e.target.closest('.fg-todo');
      if (fg && window.SandyFreeGap) {
        e.preventDefault();
        const key = fg.dataset.fgKey, gs = fg.dataset.gapStart, mins = +fg.dataset.minutes;
        fg.disabled = true;
        SandyFreeGap.schedule(key, gs, mins).then(r => {
          const t = $('toast');
          const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
          t.innerHTML = `${esc(r.msg)} <button type="button" class="toast-undo">Undo</button>`;
          t.hidden = false;
          clearTimeout(window.__fgToast);
          const undoBtn = t.querySelector('.toast-undo');
          const hide = () => { t.hidden = true; t.textContent = ''; };
          const onUndo = async () => {
            undoBtn.disabled = true;
            try { await r.undo(); toast('Undone'); if (tab === 'today') renderToday(); if (tab === 'todo') renderTodo(); }
            catch (err) { toast(err.message || 'Could not undo'); }
          };
          undoBtn.addEventListener('click', onUndo, { once: true });
          window.__fgToast = setTimeout(hide, 6000);
          if (tab === 'today') renderToday();
          if (tab === 'todo') renderTodo();
          window.dispatchEvent(new Event('sandy:refresh'));
        }).catch(err => { toast(err.message || String(err)); fg.disabled = false; });
        return;
      }
      const gr = e.target.closest('[data-gr]');
      if (gr && window.SandyGrocery) {
        e.preventDefault();
        const act = gr.dataset.gr;
        if (act === 'settings') {
          go('profile');
          const s = $('siSection'); if (s) s.scrollIntoView({ block: 'center' });
          return;
        }
        if (act === 'snooze') {
          gr.disabled = true;
          SandyGrocery.snooze(A().nowWall()).then(r => {
            toast(r.msg);
            if (tab === 'today') renderToday();
          }).catch(err => { toast(err.message || String(err)); gr.disabled = false; });
          return;
        }
        if (act === 'add') {
          gr.disabled = true;
          SandyGrocery.addRun().then(r => {
            const t = $('toast');
            const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
            t.innerHTML = `${esc(r.msg)} <button type="button" class="toast-undo">Undo</button>`;
            t.hidden = false;
            clearTimeout(window.__grToast);
            const undoBtn = t.querySelector('.toast-undo');
            const hide = () => { t.hidden = true; t.textContent = ''; };
            undoBtn.addEventListener('click', async () => {
              undoBtn.disabled = true;
              try { await r.undo(); toast('Undone'); if (tab === 'today') renderToday(); if (tab === 'todo') renderTodo(); }
              catch (err) { toast(err.message || 'Could not undo'); }
            }, { once: true });
            window.__grToast = setTimeout(hide, 6000);
            if (tab === 'today') renderToday();
            if (tab === 'todo') renderTodo();
            window.dispatchEvent(new Event('sandy:refresh'));
          }).catch(err => { toast(err.message || String(err)); gr.disabled = false; });
          return;
        }
      }
      const b = e.target.closest('.tc-item'); if (b) A().openEditor(b.dataset.id, b.dataset.key); });
    // Search
    let st = 0; $('searchBox').addEventListener('input', () => { clearTimeout(st); st = setTimeout(renderSearch, 120); });
    $('searchResults').addEventListener('click', searchClick);
    // Profile
    $('darkToggle').addEventListener('change', e => setDark(e.target.checked));
    // Home address (leave-by times, leaveby.js)
    const homeAC = window.Places && $('homeAddr') ? Places.attach($('homeAddr')) : null;
    const saveHome = async addr => {
      const msg = $('homeMsg'), btns = [$('homeSave'), $('homeClear')];
      btns.forEach(b => { b.disabled = true; }); msg.className = 'small home-msg'; msg.textContent = addr ? 'Finding it on the map…' : 'Clearing…';
      try {
        const r = await SandyLeave.setHome(addr);
        $('homeAddr').value = r.home ? r.home.address : '';
        msg.textContent = r.home ? `✓ Saved${r.where === 'device' && sbc() ? ' on this device' : ''}. Leave-by times will use it.` : 'Home cleared.';
        msg.classList.add('ok'); toast(r.home ? 'Home saved' : 'Home cleared');
      } catch (e) { msg.textContent = e.message || String(e); msg.classList.add('bad'); }
      finally { btns.forEach(b => { b.disabled = false; }); if (homeAC) homeAC.close(); }
    };
    $('homeForm').addEventListener('submit', e => { e.preventDefault(); saveHome($('homeAddr').value); });
    $('homeClear').addEventListener('click', () => saveHome(''));
    ['leaveAlerts', 'leaveEarly', 'leaveUseLoc'].forEach(id => { const el = $(id); if (el) el.addEventListener('change', leaveSwitch); });
    ['siLongDay', 'siFreeGap', 'siClash', 'siWeeklyReview', 'siGrocery', 'siWeather'].forEach(id => { const el = $(id); if (el) el.addEventListener('change', siSwitch); });
    const wkOpen = $('siWeeklyOpen');
    if (wkOpen) wkOpen.addEventListener('click', () => {
      if (!window.SandyWeekly || !A()) return;
      const a = A(); const ws = SandyWeekly.weekStartSunday(a.startOfDay(a.nowWall()));
      SandyWeekly.forceOpen(a.ymd(ws));
      window.__wkForceOpen = true;
      go('today');
      toast('Week review');
    });
    if ($('timeFormat')) $('timeFormat').addEventListener('change', e => {
      if (!window.SandyTime) return; SandyTime.set(e.target.value);
      toast(e.target.value === 'auto' ? `Times follow your phone (${SandyTime.label()})` : `Times show as ${e.target.value}-hour`);
    });
    $('defaultView').addEventListener('change', e => { try { localStorage.setItem('sandy.defaultView', e.target.value); } catch (_) {} toast(e.target.value === 'last' ? 'Home opens the view you used last' : 'Home view saved'); });
    $('avatarBtn').addEventListener('click', () => $('avatarFile').click());
    $('avatarFile').addEventListener('change', e => { uploadAvatar(e.target.files[0]); e.target.value = ''; });
    $('pfEmailBtn').addEventListener('click', changeEmail);
    const cs = $('calSection'); if (cs && !$('manageCalsBtn')) { const b = document.createElement('button'); b.type = 'button'; b.id = 'manageCalsBtn'; b.className = 'link-btn'; b.textContent = '+ Add or edit calendars'; cs.appendChild(b); b.addEventListener('click', manageCalendars); }
    // keep pages fresh after any change
    window.addEventListener('sandy:refresh', () => { if (tab === 'today') renderToday(); else if (tab === 'todo') renderTodo(); else if (tab === 'search' && $('searchBox').value.trim()) renderSearch(); else refreshBadge(); });
    setInterval(() => { if (tab === 'today' && !document.hidden) renderToday(); }, 60000);
    // keyboard: Cmd/Ctrl+K opens Search
    document.addEventListener('keydown', e => { if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); go('search', { focus: true }); } });
    const day = document.querySelector('#bottomNav .nav-day'); if (day) day.textContent = String(new Date().getDate());
  }
  // Called once the app is ready (window.__app exists)
  // Coming back to the app (background → foreground, bfcache restore) on Today: show its top again.
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && tab === 'today') toTop(); });
  window.addEventListener('pageshow', e => { if (e.persisted && tab === 'today') toTop(); });
  function start() {
    if (ready) return; ready = true;
    const a = A();
    const day = document.querySelector('#bottomNav .nav-day'); if (day && a) day.textContent = String(a.nowWall().getUTCDate());
    // Account section (mounted later by account.js) belongs on Profile, before Data
    const place = () => { const acct = $('accountSection'), data = $('dataSection'); if (acct && data && acct.previousElementSibling !== data) data.after(acct); if (acct) acct.classList.add('pf-card'); };
    place(); new MutationObserver(place).observe($('page-profile'), { childList: true });
    let dv = 'last'; try { dv = localStorage.getItem('sandy.defaultView') || 'last'; } catch (_) {}
    if (dv === 'season' && !new URLSearchParams(location.search).get('view')) { const b = document.querySelector('#briefScope [data-scope=season]'); if (b) b.click(); }
    // wrap delete-account so the profile picture goes too (Storage objects don't cascade)
    const S = a.Store; const sb = sbc(); const u = a.user && a.user();
    if (sb && u && S.deleteAccount && !S.__avWrapped) { const orig = S.deleteAccount.bind(S); S.deleteAccount = async em => { try { await sb.storage.from('avatars').remove([AV_PATH(u)]); } catch (_) {} return orig(em); }; S.__avWrapped = true; }
    let t0 = null; try { t0 = sessionStorage.getItem('sandy.tab'); } catch (_) {}
    const qt = new URLSearchParams(location.search).get('tab');
    if (new URLSearchParams(location.search).get('locate') === '1' && window.SandyLeave) SandyLeave.locateSoon(); // opened from "Check your drive"
    if (new URLSearchParams(location.search).get('si') === 'weekly' && window.SandyWeekly) {
      try {
        const a = A(); const ws = SandyWeekly.weekStartSunday(a.startOfDay(a.nowWall()));
        SandyWeekly.forceOpen(a.ymd(ws)); window.__wkForceOpen = true;
      } catch (_) {}
    }
    const first = TABS.includes(qt) ? qt : (t0 && t0 !== 'home' && TABS.includes(t0) ? t0 : null);
    if (first && !new URLSearchParams(location.search).get('review')) go(first);
    if (new URLSearchParams(location.search).get('new') === 'event') { // home-screen shortcut "New event"
      try { const u = new URL(location.href); u.searchParams.delete('new'); history.replaceState(history.state, '', u.pathname + u.search + u.hash); } catch (_) {}
      setTimeout(() => { const b = $('addBtn'); if (b) b.click(); }, 300);
    }
    refreshBadge(); avatarUrl().then(showAvatar).catch(() => {});
  }
  document.addEventListener('DOMContentLoaded', () => {
    wire(); setDark(document.documentElement.classList.contains('dark'));
    const poll = setInterval(() => { const a = A(); if (a && a.calendar && a.Store) { clearInterval(poll); start(); } }, 50);
  });
  window.SandyNav = { go, get tab() { return tab; }, renderTodo, parseQuick, saveQuick, saveEdit, deleteTodoTarget, fmtTime, todoUI, renderToday, renderSearch, setDark, Inbox, Cats };
})();
