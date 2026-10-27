/* SANDY - Sandy Intelligence feature #6: Sunday weekly review (FREE, rule-based, no AI).
   From Sunday ~4 PM local through the rest of that week (Mon–Sat), Today shows a compact
   "Your week ahead" card: busiest day, hours per calendar, games/away travel, early starts
   & late nights, long days (reuses SandyLongDay.analyze), clashes (reuses SandyClash),
   free evenings, overdue to-dos, to-dos due this week, plus a look-back at last week
   (timed events + completed to-dos). Christian Dake ignored in counts. Week = Sun–Sat.
   Profile toggle + "Open week review". Sunday 6 PM Web Push via send-reminders
   (si_nudge_sends kind weekly_review). Deep link: ?tab=today&si=weekly */
(function () {
  'use strict';
  const CARD_HOUR = 16;       // Sunday reveal from 4 PM
  const PUSH_HOUR = 18;       // server push ~6 PM Sunday
  const EARLY_HOUR = 7;       // starts before 7 AM
  const LATE_END_HOUR = 22;   // ends at/after 10 PM (or past midnight)
  const EVENING_START = 18;
  const EVENING_END = 22;
  const LS_KEY = 'sandy.si.weeklyReview';
  const LS_FORCE = 'sandy.si.weeklyForce'; // Profile "Open" pin for this weekStart ymd
  const REF_RE = /christian\s+dake/i;
  const CAL_ORDER = ['msc', 'mam', 'lifetime', 'personal'];
  const CAL_LABEL = { msc: 'MSC', mam: 'MAM', lifetime: 'Life Time', personal: 'Personal' };

  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const t12 = d => (window.SandyTime ? SandyTime.fmt(d) : (() => { let h = d.getUTCHours(); const m = d.getUTCMinutes(); const ap = h < 12 ? 'AM' : 'PM'; h = h % 12 || 12; return m ? `${h}:${String(m).padStart(2, '0')} ${ap}` : `${h} ${ap}`; })());
  const A = () => window.__app;
  const synced = () => !!(A() && A().Store && A().Store.mode === 'supabase');
  const isRef = e => REF_RE.test(`${(e && e.title) || ''} ${(e && e.category) || ''}`);
  const minsBetween = (a, b) => Math.round((b - a) / 60000);
  const hoursLbl2 = min => {
    const h = min / 60;
    const s = (Math.round(h * 10) / 10).toFixed(1).replace(/\.0$/, '');
    return `${s}h`;
  };

  /** Most recent Sunday 00:00 wall (today if Sunday). */
  function weekStartSunday(day) {
    const a = A();
    const d = a.startOfDay(day);
    const dow = d.getUTCDay(); // 0=Sun
    return a.addDays(d, -dow);
  }
  function weekEndExclusive(ws) { return A().addDays(ws, 7); }

  /** Visible on Today: from Sunday CARD_HOUR through Saturday end of that week, or forced. */
  function isVisible(now) {
    const a = A();
    const today = a.startOfDay(now);
    const ws = weekStartSunday(today);
    const we = weekEndExclusive(ws);
    if (now < ws || now >= we) return false;
    if (today.getTime() === ws.getTime() && now.getUTCHours() < CARD_HOUR) return false;
    return true;
  }
  function isForced(wsYmd) {
    try { return localStorage.getItem(LS_FORCE) === wsYmd; } catch (_) { return false; }
  }
  function forceOpen(wsYmd) {
    try { localStorage.setItem(LS_FORCE, wsYmd); } catch (_) {}
  }
  function clearForce() { try { localStorage.removeItem(LS_FORCE); } catch (_) {} }

  // ---- prefs ----
  let prefs;
  function readLocal() {
    try { const v = localStorage.getItem(LS_KEY); if (v === '0') return false; if (v === '1') return true; } catch (_) {}
    return true;
  }
  function writeLocal(on) { try { localStorage.setItem(LS_KEY, on ? '1' : '0'); } catch (_) {} }
  async function getPrefs() {
    if (prefs !== undefined) return prefs;
    let p = { enabled: readLocal(), available: false };
    if (synced()) {
      try {
        const r = await A().Store.profile();
        if (r && 'si_weekly_review' in r) p = { enabled: r.si_weekly_review !== false, available: true };
      } catch (_) {}
    }
    return (prefs = p);
  }
  async function setPrefs(patch) {
    if ('enabled' in patch) writeLocal(!!patch.enabled);
    if (synced() && 'enabled' in patch) {
      try { await A().Store.saveProfile({ si_weekly_review: !!patch.enabled }); }
      catch (e) {
        if (e && (e.code === 'PGRST204' || e.code === '42703' || /si_weekly_review|column/i.test(e.message || '')))
          throw new Error('Sandy Intelligence needs a one-time server update first. Try again soon.');
        throw new Error('Could not save: ' + (e.message || e));
      }
    }
    prefs = { ...(await getPrefs()), ...patch, available: synced() ? true : false };
    return prefs;
  }
  function invalidate() { prefs = undefined; }

  function isGame(ev) {
    const cat = ev.category || '', title = ev.title || '';
    if (/^Game\s*[–—-]/i.test(cat)) return true;
    if (/\b(vs\.?|@)\b/i.test(title) && /\b(HOME|AWAY|NEUTRAL)\b/i.test(title)) return true;
    return false;
  }
  function gameHa(ev) {
    const t = ev.title || '';
    if (/\bAWAY\b/i.test(t) || /\s@\s/.test(t)) return 'A';
    if (/\bNEUTRAL\b/i.test(t)) return 'N';
    if (/\bHOME\b/i.test(t) || /\bvs\.?\b/i.test(t)) return 'H';
    return '';
  }

  async function collectOccs(a, start, end) {
    const vis = a.settings().visible;
    const all = (await a.Store.list()).filter(e => vis[e.calendar] !== false);
    const timed = [], tasks = [];
    for (const ev of all) {
      if (isRef(ev)) continue;
      for (const o of a.occurrences(ev, start, end)) {
        if (ev.kind === 'task') tasks.push({ ev, o });
        else if (!ev.allDay && o.end && o.end > o.start) timed.push({ ev, o });
      }
    }
    return { timed, tasks };
  }

  function dayBuckets(a, timed, ws, we) {
    const days = [];
    for (let i = 0; i < 7; i++) {
      const day = a.addDays(ws, i);
      const next = a.addDays(day, 1);
      const items = timed.filter(x => x.o.start >= day && x.o.start < next);
      const intervals = items.map(x => [x.o.start, x.o.end]);
      let scheduled = 0;
      if (intervals.length) {
        const xs = intervals.slice().sort((p, q) => p[0] - q[0]);
        let c0 = xs[0][0], c1 = xs[0][1];
        for (let j = 1; j < xs.length; j++) {
          const [s, e] = xs[j];
          if (s <= c1) { if (e > c1) c1 = e; }
          else { scheduled += minsBetween(c0, c1); c0 = s; c1 = e; }
        }
        scheduled += minsBetween(c0, c1);
      }
      days.push({ day, ymd: a.ymd(day), items, scheduledMin: scheduled, label: a.fmtDay(day) });
    }
    return days;
  }

  function hoursByCalendar(timed) {
    const map = {};
    for (const x of timed) {
      const id = x.ev.calendar || 'other';
      map[id] = (map[id] || 0) + minsBetween(x.o.start, x.o.end);
    }
    return map;
  }

  function freeEvenings(days) {
    const free = [];
    for (const d of days) {
      const eve0 = new Date(Date.UTC(d.day.getUTCFullYear(), d.day.getUTCMonth(), d.day.getUTCDate(), EVENING_START, 0));
      const eve1 = new Date(Date.UTC(d.day.getUTCFullYear(), d.day.getUTCMonth(), d.day.getUTCDate(), EVENING_END, 0));
      const busy = d.items.some(x => {
        const lo = x.o.start > eve0 ? x.o.start : eve0;
        const hi = x.o.end < eve1 ? x.o.end : eve1;
        return hi > lo;
      });
      if (!busy) free.push(d);
    }
    return free;
  }

  function earlyAndLate(timed) {
    const early = [], late = [];
    for (const x of timed) {
      if (x.o.start.getUTCHours() < EARLY_HOUR) early.push(x);
      const crosses = x.o.end.getUTCFullYear() !== x.o.start.getUTCFullYear()
        || x.o.end.getUTCMonth() !== x.o.start.getUTCMonth()
        || x.o.end.getUTCDate() !== x.o.start.getUTCDate();
      const lateEnd = x.o.end.getUTCHours() > LATE_END_HOUR
        || (x.o.end.getUTCHours() === LATE_END_HOUR && x.o.end.getUTCMinutes() > 0);
      if (crosses || lateEnd || x.o.end.getUTCHours() >= LATE_END_HOUR) late.push(x);
    }
    return { early, late };
  }

  function longDaysForWeek(days) {
    if (!window.SandyLongDay || !window.SandyLongDay.analyze) return [];
    const out = [];
    for (const d of days) {
      const info = window.SandyLongDay.analyze(d.items.map(x => ({ start: x.o.start, end: x.o.end, title: x.ev.title, kind: x.ev.kind, allDay: x.ev.allDay })));
      if (info && info.isLong) out.push({ day: d, info });
    }
    return out;
  }

  function clashesForWeek(timed) {
    if (!window.SandyClash || !window.SandyClash.findClashes) return [];
    try {
      return window.SandyClash.findClashes(timed).slice(0, 8);
    } catch (_) { return []; }
  }

  async function todoStats(a, now, ws, we, prevWs, prevWe) {
    const today = a.startOfDay(now);
    const vis = a.settings().visible;
    let overdue = 0, dueThisWeek = 0, completedLastWeek = 0;
    const dueList = [];
    for (const ev of await a.Store.list()) {
      if (ev.kind !== 'task' || isRef(ev)) continue;
      if (vis[ev.calendar] === false) continue;

      if (a.isRecurring(ev)) {
        for (const key of (ev.completedDates || [])) {
          const kd = a.parseLocal(key);
          if (kd >= prevWs && kd < prevWe) completedLastWeek++;
        }
      } else if (ev.done) {
        const when = ev.updatedAt ? new Date(ev.updatedAt) : a.parseLocal(String(ev.start).slice(0, 10));
        const day = a.startOfDay(when);
        if (day >= prevWs && day < prevWe) completedLastWeek++;
      }

      const rangeStart = a.addDays(today, -120);
      const occs = a.occurrences(ev, rangeStart, we);
      let countedOverdue = false, countedDue = false;
      for (const o of occs) {
        if (a.isDone(ev, o.key)) continue;
        const dueAt = ev.allDay ? a.startOfDay(o.start) : (o.end && o.end > o.start ? o.end : o.start);
        const past = ev.allDay ? dueAt < today : dueAt <= now;
        if (past && !countedOverdue) { overdue++; countedOverdue = true; }
        if (!past && o.start >= ws && o.start < we && !countedDue) {
          dueThisWeek++;
          countedDue = true;
          if (dueList.length < 6) dueList.push({ ev, o });
        }
      }
    }
    return { overdue, dueThisWeek, dueList, completedLastWeek };
  }

  async function build(a, now) {
    const today = a.startOfDay(now);
    const ws = weekStartSunday(today);
    // If Sunday before CARD_HOUR, still allow force for "this" week; otherwise after Sat we roll
    const we = weekEndExclusive(ws);
    const prevWs = a.addDays(ws, -7);
    const prevWe = ws;

    const ahead = await collectOccs(a, ws, we);
    const back = await collectOccs(a, prevWs, prevWe);
    const days = dayBuckets(a, ahead.timed, ws, we);
    const busiest = days.slice().sort((x, y) => y.scheduledMin - x.scheduledMin || y.items.length - x.items.length)[0] || null;
    const byCal = hoursByCalendar(ahead.timed);
    const games = ahead.timed.filter(x => isGame(x.ev));
    const { early, late } = earlyAndLate(ahead.timed);
    const longs = longDaysForWeek(days);
    const clashes = clashesForWeek(ahead.timed);
    const freeEve = freeEvenings(days);
    const todos = await todoStats(a, now, ws, we, prevWs, prevWe);

    return {
      now, today, ws, we, prevWs, prevWe,
      days, busiest, byCal, games, early, late, longs, clashes, freeEve, todos,
      aheadCount: ahead.timed.length,
      lastWeekCount: back.timed.length,
      totalScheduledMin: days.reduce((s, d) => s + d.scheduledMin, 0)
    };
  }

  async function data(a, now, { force = false } = {}) {
    const p = await getPrefs();
    if (!p.enabled) return null;
    const ws = weekStartSunday(a.startOfDay(now));
    const wsYmd = a.ymd(ws);
    const show = force || isForced(wsYmd) || isVisible(now);
    if (!show) return null;
    return build(a, now);
  }

  function calRow(byCal) {
    const keys = [...CAL_ORDER.filter(k => byCal[k]), ...Object.keys(byCal).filter(k => !CAL_ORDER.includes(k)).sort()];
    if (!keys.length) return '<li class="wk-muted">No timed hours this week.</li>';
    return keys.map(k => {
      const label = CAL_LABEL[k] || k;
      return `<li><span class="wk-k">${esc(label)}</span> <span class="wk-v">${esc(hoursLbl2(byCal[k]))}</span></li>`;
    }).join('');
  }

  function html(d) {
    if (!d) return '';
    const a = A();
    const range = `${a.fmtDay(d.ws)} – ${a.fmtDay(a.addDays(d.we, -1))}`;
    let h = `<section class="tc-sec tc-card tc-weekly" id="tcWeekly" data-ws="${esc(a.ymd(d.ws))}" aria-labelledby="wkH">`;
    h += `<h3 id="wkH">📋 Your week ahead</h3>`;
    h += `<p class="wk-range muted small">${esc(range)}</p>`;

    // Snapshot
    h += `<div class="wk-block" data-wk="snap"><h4 class="wk-h4">Snapshot</h4><ul class="wk-list">`;
    if (d.busiest && d.busiest.scheduledMin) {
      h += `<li>Busiest day: <b>${esc(d.busiest.label)}</b> · ${esc(hoursLbl2(d.busiest.scheduledMin))} scheduled</li>`;
    }
    h += `<li>Timed events: <b>${d.aheadCount}</b> · ${esc(hoursLbl2(d.totalScheduledMin))} merged</li>`;
    h += `<li>Overdue to-dos: <b class="${d.todos.overdue ? 'wk-bad' : ''}">${d.todos.overdue}</b>`;
    h += ` · Due this week: <b>${d.todos.dueThisWeek}</b></li>`;
    h += `</ul></div>`;

    // Hours by calendar
    h += `<div class="wk-block" data-wk="hours"><h4 class="wk-h4">Hours by calendar</h4><ul class="wk-list wk-hours">${calRow(d.byCal)}</ul></div>`;

    // Games
    h += `<div class="wk-block" data-wk="games"><h4 class="wk-h4">Games & travel</h4>`;
    if (!d.games.length) h += `<p class="wk-muted small">No games this week.</p>`;
    else {
      h += `<ul class="wk-list">`;
      for (const g of d.games) {
        const ha = gameHa(g.ev);
        const badge = ha ? ` <span class="wk-ha">${ha}</span>` : '';
        h += `<li><button type="button" class="tc-link tc-item" data-id="${esc(g.ev.id)}" data-key="${esc(g.o.key)}">${esc(g.ev.title)}</button>${badge}`;
        h += ` <span class="wk-when">${esc(a.fmtDay(g.o.start))} ${esc(t12(g.o.start))}</span></li>`;
      }
      h += `</ul>`;
    }
    h += `</div>`;

    // Early / late
    h += `<div class="wk-block" data-wk="edges"><h4 class="wk-h4">Early starts & late nights</h4>`;
    if (!d.early.length && !d.late.length) h += `<p class="wk-muted small">None — no starts before 7 AM or ends after 10 PM.</p>`;
    else {
      h += `<ul class="wk-list">`;
      for (const x of d.early.slice(0, 5)) {
        h += `<li>🌅 ${esc(t12(x.o.start))} · ${esc(x.ev.title)} <span class="wk-when">${esc(a.fmtDay(x.o.start))}</span></li>`;
      }
      if (d.early.length > 5) h += `<li class="wk-muted">+${d.early.length - 5} more early</li>`;
      for (const x of d.late.slice(0, 5)) {
        h += `<li>🌙 ends ${esc(t12(x.o.end))} · ${esc(x.ev.title)} <span class="wk-when">${esc(a.fmtDay(x.o.start))}</span></li>`;
      }
      if (d.late.length > 5) h += `<li class="wk-muted">+${d.late.length - 5} more late</li>`;
      h += `</ul>`;
    }
    h += `</div>`;

    // Long days
    h += `<div class="wk-block" data-wk="long"><h4 class="wk-h4">Long days</h4>`;
    if (!d.longs.length) h += `<p class="wk-muted small">No 10+ hour spans or 8+ scheduled hours.</p>`;
    else {
      h += `<ul class="wk-list">`;
      for (const L of d.longs) {
        h += `<li><b>${esc(L.day.label)}</b> · ${esc(t12(L.info.first.start))}–${esc(t12(L.info.last.end))}`;
        h += ` <span class="wk-muted">(${esc(hoursLbl2(L.info.spanMin))} span · ${esc(hoursLbl2(L.info.scheduledMin))} scheduled)</span></li>`;
      }
      h += `</ul>`;
    }
    h += `</div>`;

    // Clashes
    h += `<div class="wk-block" data-wk="clash"><h4 class="wk-h4">Clashes</h4>`;
    if (!d.clashes.length) h += `<p class="wk-muted small">No shift/practice overlaps flagged.</p>`;
    else {
      h += `<ul class="wk-list">`;
      for (const c of d.clashes) {
        h += `<li>⚠️ ${esc(c.duty.ev.title)} ∩ ${esc(c.other.ev.title)}`;
        h += ` <span class="wk-when">${esc(a.fmtDay(c.duty.o.start))} ${esc(t12(c.duty.o.start))}</span></li>`;
      }
      h += `</ul>`;
    }
    h += `</div>`;

    // Free evenings
    h += `<div class="wk-block" data-wk="free"><h4 class="wk-h4">Free evenings</h4>`;
    if (!d.freeEve.length) h += `<p class="wk-muted small">No clear 6–10 PM windows.</p>`;
    else h += `<p class="small">${d.freeEve.map(x => esc(x.label)).join(' · ')}</p>`;
    h += `</div>`;

    // To-dos due
    h += `<div class="wk-block" data-wk="todos"><h4 class="wk-h4">To-dos due this week</h4>`;
    if (!d.todos.dueList.length) h += `<p class="wk-muted small">${d.todos.dueThisWeek ? `${d.todos.dueThisWeek} due (open To-Do to see them).` : 'None dated this week.'}</p>`;
    else {
      h += `<ul class="wk-list">`;
      for (const t of d.todos.dueList) {
        h += `<li><button type="button" class="tc-link tc-item" data-id="${esc(t.ev.id)}" data-key="${esc(t.o.key)}">${esc(t.ev.title)}</button>`;
        h += ` <span class="wk-when">${esc(a.fmtDay(t.o.start))}</span></li>`;
      }
      if (d.todos.dueThisWeek > d.todos.dueList.length) h += `<li class="wk-muted">+${d.todos.dueThisWeek - d.todos.dueList.length} more</li>`;
      h += `</ul>`;
    }
    h += `</div>`;

    // Last week
    h += `<div class="wk-block" data-wk="back"><h4 class="wk-h4">Last week</h4><ul class="wk-list">`;
    h += `<li>Timed events: <b>${d.lastWeekCount}</b></li>`;
    h += `<li>To-dos completed: <b>${d.todos.completedLastWeek}</b></li>`;
    h += `</ul></div>`;

    h += `</section>`;
    return h;
  }

  /** After render: scroll/expand when deep-linked. */
  function focusCard() {
    const el = document.getElementById('tcWeekly');
    if (!el) return;
    el.scrollIntoView({ block: 'start', behavior: 'smooth' });
    el.classList.add('wk-flash');
    setTimeout(() => el.classList.remove('wk-flash'), 1600);
    // ensure not collapsed
    if (el.classList.contains('is-collapsed')) {
      const btn = el.querySelector('.tc-tog');
      if (btn) btn.click();
    }
  }

  window.SandyWeekly = {
    CARD_HOUR, PUSH_HOUR, EARLY_HOUR, LATE_END_HOUR,
    weekStartSunday, weekEndExclusive, isVisible, isForced, forceOpen, clearForce,
    isRef, isGame, gameHa, dayBuckets, hoursByCalendar, freeEvenings, earlyAndLate,
    longDaysForWeek, clashesForWeek, build, data, html, focusCard,
    getPrefs, setPrefs, invalidate,
    _test: { collectOccs, todoStats, calRow, hoursLbl2, CAL_ORDER }
  };
})();
