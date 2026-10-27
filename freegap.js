/* SANDY - Sandy Intelligence feature #4: Free-gap to-do coach (FREE, rule-based, no AI).
   On Today, find free gaps between timed events (15+ min, waking hours ~7 AM–10 PM, never during a
   running event) and suggest open to-dos that fit. Duration: timed-task length, title/notes estimate
   ("30 min"), or DEFAULT_DURATION. Prefer overdue, then P1→P3, then older. Evening (≥5 PM) also
   considers tomorrow; skips the long-day card's meal/lunch window so the two features don't clash.
   Tap a suggestion to schedule it into the gap (one-tap undo). Ignore Christian Dake (reference).
   Toggle: Profile → Sandy Intelligence → Free-gap to-do coach. In-app only (no push yet). */
(function () {
  'use strict';
  const MIN_GAP_MIN = 15;
  const WAKE_START_H = 7;
  const WAKE_END_H = 22;
  const DEFAULT_DURATION = 30;
  const MAX_GAPS = 3;
  const MAX_TODOS_PER_GAP = 2;
  const EVENING_HOUR = 17; // also look at tomorrow
  const LS_KEY = 'sandy.si.freeGap';
  const REF_RE = /christian\s+dake/i;

  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const t12 = d => (window.SandyTime ? SandyTime.fmt(d) : (() => { let h = d.getUTCHours(); const m = d.getUTCMinutes(); const ap = h < 12 ? 'AM' : 'PM'; h = h % 12 || 12; return m ? `${h}:${String(m).padStart(2, '0')} ${ap}` : `${h} ${ap}`; })());
  const isRef = e => REF_RE.test(`${(e && e.title) || ''}`);
  const A = () => window.__app;
  const synced = () => !!(A() && A().Store && A().Store.mode === 'supabase');
  const minsBetween = (a, b) => Math.round((b - a) / 60000);
  const pad = n => String(n).padStart(2, '0');
  const wallHM = (day, h, m = 0) => new Date(Date.UTC(day.getUTCFullYear(), day.getUTCMonth(), day.getUTCDate(), h, m));

  /** Estimate minutes for a to-do. Timed task → its length; else parse "45 min" / "1h"; else default. */
  function estimateMinutes(todo) {
    if (todo && todo.timed && todo.start && todo.end && todo.end > todo.start) {
      const m = minsBetween(todo.start, todo.end);
      if (m >= 5 && m <= 8 * 60) return m;
    }
    const text = `${(todo && todo.title) || ''} ${(todo && todo.notes) || ''}`;
    let m = text.match(/\b(\d{1,3})\s*(m|min|mins|minutes)\b/i);
    if (m) return Math.max(5, Math.min(8 * 60, +m[1]));
    m = text.match(/\b(\d{1,2}(?:\.\d)?)\s*(h|hr|hrs|hour|hours)\b/i);
    if (m) return Math.max(5, Math.min(8 * 60, Math.round(parseFloat(m[1]) * 60)));
    return DEFAULT_DURATION;
  }

  /** Merge overlapping busy [start,end] intervals. */
  function mergeBusy(intervals) {
    if (!intervals.length) return [];
    const xs = intervals.slice().sort((a, b) => a[0] - b[0]);
    const out = [[xs[0][0], xs[0][1]]];
    for (let i = 1; i < xs.length; i++) {
      const [s, e] = xs[i], last = out[out.length - 1];
      if (s <= last[1]) { if (e > last[1]) last[1] = e; }
      else out.push([s, e]);
    }
    return out;
  }

  /**
   * Free gaps on a wall day inside waking hours, clipped to after `now` (for today).
   * busy: [{start,end,title}] timed non-ref events. protectedGaps: [{start,end}] to skip (long-day lunch).
   */
  function findGaps(day, busy, now, { protect = [] } = {}) {
    const wake0 = wallHM(day, WAKE_START_H, 0);
    const wake1 = wallHM(day, WAKE_END_H, 0);
    const merged = mergeBusy(busy.map(b => [b.start, b.end]).filter(([s, e]) => e > s));
    // clip busy to wake window for gap finding, but events outside still block via intersection
    const blocks = [];
    for (const [s, e] of merged) {
      const a = s < wake0 ? wake0 : s, b = e > wake1 ? wake1 : e;
      if (b > a) blocks.push([a, b]);
    }
    const gaps = [];
    let cursor = wake0;
    for (const [s, e] of blocks) {
      if (s > cursor) gaps.push({ start: cursor, end: s });
      if (e > cursor) cursor = e;
    }
    if (wake1 > cursor) gaps.push({ start: cursor, end: wake1 });

    const out = [];
    for (const g of gaps) {
      let start = g.start, end = g.end;
      // never while an event is running / past: for today, clip to now
      if (now && now.getTime() >= start.getTime() && now.getTime() < end.getTime()) start = new Date(now.getTime());
      if (now && end <= now) continue;
      if (now && start < now && end > now) start = new Date(now.getTime());
      const min = minsBetween(start, end);
      if (min < MIN_GAP_MIN) continue;
      // skip protected (long-day meal window) — same day overlap ≥ half the protect or ≥ half the gap
      const hit = protect.some(p => {
        const lo = start > p.start ? start : p.start, hi = end < p.end ? end : p.end;
        const ov = hi > lo ? minsBetween(lo, hi) : 0;
        return ov >= Math.min(min, minsBetween(p.start, p.end)) * 0.5;
      });
      if (hit) continue;
      out.push({ start, end, min, day });
    }
    return out;
  }

  /** Sort open to-dos: overdue first, then priority 1..3, then title. */
  function rankTodos(todos) {
    return todos.slice().sort((a, b) => {
      if (!!b.overdue !== !!a.overdue) return a.overdue ? -1 : 1;
      const pa = a.priority >= 1 && a.priority <= 3 ? a.priority : 9;
      const pb = b.priority >= 1 && b.priority <= 3 ? b.priority : 9;
      if (pa !== pb) return pa - pb;
      return String(a.title || '').localeCompare(String(b.title || ''));
    });
  }

  /** Assign to-dos into gaps without reuse. Returns [{gap, todos}]. */
  function assign(gaps, todos) {
    const pool = rankTodos(todos);
    const used = new Set();
    const out = [];
    for (const gap of gaps.slice(0, MAX_GAPS * 2)) { // consider a few extra before capping filled ones
      let left = gap.min;
      const picks = [];
      for (const t of pool) {
        if (used.has(t.key)) continue;
        const need = estimateMinutes(t);
        if (need > left) continue;
        picks.push({ ...t, minutes: need });
        used.add(t.key);
        left -= need;
        if (picks.length >= MAX_TODOS_PER_GAP) break;
      }
      if (picks.length) out.push({ gap, todos: picks });
      if (out.length >= MAX_GAPS) break;
    }
    return out;
  }

  function priLabel(p) { return p >= 1 && p <= 3 ? `P${p}` : ''; }

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
        if (r && 'si_free_gap' in r) p = { enabled: r.si_free_gap !== false, available: true };
      } catch (_) {}
    }
    return (prefs = p);
  }
  async function setPrefs(patch) {
    if ('enabled' in patch) writeLocal(!!patch.enabled);
    if (synced() && 'enabled' in patch) {
      try { await A().Store.saveProfile({ si_free_gap: !!patch.enabled }); }
      catch (e) {
        if (e && (e.code === 'PGRST204' || e.code === '42703' || /si_free_gap|column/i.test(e.message || '')))
          throw new Error('Sandy Intelligence needs a one-time server update first. Try again soon.');
        throw new Error('Could not save: ' + (e.message || e));
      }
    }
    prefs = { ...(await getPrefs()), ...patch, available: synced() ? true : false };
    return prefs;
  }
  function invalidate() { prefs = undefined; }

  /** Collect open to-dos (scheduled tasks + inbox jots). */
  async function openTodos(a, now) {
    const today = a.startOfDay(now);
    const out = [];
    const vis = a.settings().visible;
    for (const ev of await a.Store.list()) {
      if (ev.kind !== 'task' || vis[ev.calendar] === false) continue;
      // all occurrences that are open: undated-style all-day on/before today overdue, or any incomplete
      const rangeStart = a.addDays(today, -120);
      const rangeEnd = a.addDays(today, 60);
      const occs = a.occurrences(ev, rangeStart, rangeEnd);
      if (!occs.length) {
        // non-recurring with start outside? still list if not done
        if (!a.isDone(ev, a.ymd(a.parseLocal(String(ev.start).slice(0, 10))))) {
          const start = a.parseLocal(String(ev.start).slice(0, 16));
          const end = ev.end ? a.parseLocal(String(ev.end).slice(0, 16)) : null;
          const overdue = !ev.allDay ? (end || start) < now : a.startOfDay(start) < today;
          out.push({
            key: `ev:${ev.id}`, source: 'event', id: ev.id, occKey: a.ymd(start),
            title: ev.title, notes: ev.notes || '', priority: ev.priority || null,
            overdue, timed: !ev.allDay, start: !ev.allDay ? start : null, end: !ev.allDay && end ? end : null,
            calendar: ev.calendar, ev
          });
        }
        continue;
      }
      for (const o of occs) {
        if (a.isDone(ev, o.key)) continue;
        // only suggest once per series (soonest open occurrence)
        const overdue = ev.allDay ? o.key < a.ymd(today) : (o.end || o.start) < now;
        const future = !ev.allDay && o.start > a.addDays(today, 1); // skip far-future timed placements
        if (future && !overdue) continue;
        out.push({
          key: `ev:${ev.id}:${o.key}`, source: 'event', id: ev.id, occKey: o.key,
          title: ev.title, notes: ev.notes || '', priority: ev.priority || null,
          overdue, timed: !ev.allDay, start: !ev.allDay ? o.start : null, end: !ev.allDay ? o.end : null,
          calendar: ev.calendar, ev, o
        });
        break; // one entry per event series
      }
    }
    // inbox
    try {
      const Inbox = window.SandyNav && SandyNav.Inbox;
      if (Inbox) {
        const list = await Inbox.list();
        for (const it of list) {
          if (it.done || it.kind === 'note') continue;
          out.push({
            key: `inbox:${it.id}`, source: 'inbox', id: it.id,
            title: String(it.body || '').split('\n')[0].slice(0, 200),
            notes: String(it.body || '').includes('\n') ? it.body : '',
            priority: it.priority || null, overdue: false, timed: false,
            calendar: it.calendar || null, item: it
          });
        }
      }
    } catch (_) {}
    // de-dupe by title+source preference (event over inbox)
    const seen = new Set();
    return out.filter(t => { const k = t.title.toLowerCase().trim(); if (seen.has(k)) return false; seen.add(k); return true; });
  }

  async function busyForDay(a, day) {
    const end = a.addDays(day, 1);
    const vis = a.settings().visible;
    const all = (await a.Store.list()).filter(e => vis[e.calendar] !== false);
    const out = [];
    for (const ev of all) {
      if (ev.kind === 'task' || ev.allDay || isRef(ev)) continue;
      for (const o of a.occurrences(ev, day, end)) out.push({ start: o.start, end: o.end, title: ev.title, ev, o });
    }
    return out;
  }

  /** Long-day meal window to protect on tomorrow (if long-day feature would show it). */
  function protectedTomorrow(a, now, busyTmr) {
    if (!window.SandyLongDay || !SandyLongDay.analyze) return [];
    try {
      const info = SandyLongDay.analyze(busyTmr);
      if (info && info.isLong && info.gap) return [{ start: info.gap.start, end: info.gap.end }];
    } catch (_) {}
    return [];
  }

  async function data(a, now) {
    const p = await getPrefs();
    if (!p.enabled) return null;
    const today = a.startOfDay(now);
    const todos = await openTodos(a, now);
    if (!todos.length) return null;

    const gaps = [];
    const busyToday = await busyForDay(a, today);
    for (const g of findGaps(today, busyToday, now)) gaps.push({ ...g, which: 'today' });

    if (now.getUTCHours() >= EVENING_HOUR) {
      const tmr = a.addDays(today, 1);
      const busyTmr = await busyForDay(a, tmr);
      const protect = protectedTomorrow(a, now, busyTmr);
      for (const g of findGaps(tmr, busyTmr, null, { protect })) gaps.push({ ...g, which: 'tomorrow' });
    }

    const filled = assign(gaps, todos);
    if (!filled.length) return null;
    return { now, today, filled, todos };
  }

  function html(d) {
    if (!d || !d.filled.length) return '';
    let h = `<section class="tc-sec tc-card tc-freegap" id="tcFreeGap" aria-labelledby="fgH">`;
    h += `<h3 id="fgH">✅ Free time</h3>`;
    h += `<ul class="fg-list">`;
    for (const row of d.filled) {
      const g = row.gap;
      const when = g.which === 'tomorrow' ? 'Tomorrow ' : '';
      const range = `${when}${esc(t12(g.start))}–${esc(t12(g.end))}`;
      const chips = row.todos.map(t => {
        const pri = priLabel(t.priority);
        const od = t.overdue ? ' <span class="fg-od">overdue</span>' : '';
        return `<button type="button" class="fg-todo" data-fg-key="${esc(t.key)}" data-gap-start="${esc(g.start.toISOString())}" data-gap-end="${esc(g.end.toISOString())}" data-minutes="${t.minutes}" title="Schedule into this gap">${esc(t.title)}${pri ? ` <span class="fg-pri">(${pri})</span>` : ''}${od}</button>`;
      }).join('<span class="fg-sep">, </span>');
      h += `<li class="fg-row"><span class="fg-when">You're free ${range}.</span> <span class="fg-knock">Knock out:</span> ${chips}</li>`;
    }
    h += `</ul></section>`;
    return h;
  }

  /** Schedule todo into gap starting at gap.start for `minutes`. Returns undo fn. */
  async function schedule(todoKey, gapStartIso, minutes) {
    const a = A(); if (!a) throw new Error('App not ready');
    const gapStart = new Date(gapStartIso);
    const dur = Math.max(5, Math.min(8 * 60, +minutes || DEFAULT_DURATION));
    const gapEnd = new Date(gapStart.getTime() + dur * 60000);
    const ymd = a.ymd(gapStart), hm0 = a.hm(gapStart), hm1 = a.hm(gapEnd);
    const startStr = `${ymd}T${hm0}`, endStr = `${ymd}T${hm1}`;

    if (todoKey.startsWith('inbox:')) {
      const id = todoKey.slice(6);
      const Inbox = window.SandyNav && SandyNav.Inbox;
      if (!Inbox) throw new Error('Inbox unavailable');
      const list = await Inbox.list();
      const it = list.find(x => x.id === id);
      if (!it) throw new Error('To-do not found');
      const cal = it.calendar && a.calendars().some(c => c.id === it.calendar) ? it.calendar : a.firstVisibleCal();
      const ev = {
        id: (crypto.randomUUID && crypto.randomUUID()) || undefined,
        kind: 'task', title: String(it.body || '').split('\n')[0].slice(0, 200),
        notes: String(it.body || '').includes('\n') ? it.body : '',
        calendar: cal, category: 'Task / to-do', allDay: false,
        start: startStr, end: endStr, recurrence: { freq: 'none' },
        location: '', reminders: [], todoCategoryId: it.categoryId || null,
        priority: it.priority || null, scope: 'day', done: false
      };
      const saved = await a.Store.save(ev);
      await Inbox.remove(it.id);
      return {
        msg: `Scheduled “${ev.title.slice(0, 40)}” at ${t12(gapStart)}`,
        undo: async () => {
          try { await a.Store.remove(saved.id); } catch (_) {}
          try { await Inbox.save({ ...it, done: false }); } catch (_) {}
        }
      };
    }

    if (todoKey.startsWith('ev:')) {
      const parts = todoKey.split(':');
      const id = parts[1];
      const ev = (await a.Store.list()).find(e => e.id === id);
      if (!ev) throw new Error('To-do not found');
      const snap = { ...ev, recurrence: ev.recurrence ? { ...ev.recurrence } : { freq: 'none' },
        completedDates: (ev.completedDates || []).slice(), reminders: (ev.reminders || []).slice() };
      const changes = { allDay: false, start: startStr, end: endStr, done: false };
      let createdId = null;
      if (a.isRecurring(ev) && parts[2] && a.detachOccurrence && a.Store.saveMany) {
        const [parent, ex] = a.detachOccurrence(ev, parts[2], changes);
        const saved = await a.Store.saveMany([parent, ex]);
        createdId = (saved && saved.find(x => x.seriesId === ev.id) || ex).id;
      } else {
        await a.Store.save({ ...ev, ...changes });
      }
      return {
        msg: `Scheduled “${ev.title.slice(0, 40)}” at ${t12(gapStart)}`,
        undo: async () => {
          try {
            if (createdId) {
              await a.Store.remove(createdId);
              await a.Store.save(snap);
            } else await a.Store.save(snap);
          } catch (_) {}
        }
      };
    }
    throw new Error('Unknown to-do');
  }

  window.SandyFreeGap = {
    MIN_GAP_MIN, WAKE_START_H, WAKE_END_H, DEFAULT_DURATION, MAX_GAPS, MAX_TODOS_PER_GAP, EVENING_HOUR,
    isRef, estimateMinutes, findGaps, mergeBusy, rankTodos, assign, data, html, schedule,
    getPrefs, setPrefs, invalidate,
    _test: { wallHM, minsBetween, protectedTomorrow, openTodos, busyForDay, priLabel }
  };
})();
