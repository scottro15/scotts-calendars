/* SANDY - Sandy Intelligence feature #7: Grocery nudge (FREE, rule-based, no AI).
   If there is no grocery shopping / grocery-related event or to-do in the next WINDOW_DAYS
   (titles, notes, categories matched against GROCERY_WORDS, case-insensitive word-boundary),
   Today shows a nudge card. Optional Saturday 10 AM push (si_nudge_sends kind grocery),
   once per Sun–Sat week — avoids the Sunday 6 PM weekly-review push.
   Actions: Add grocery run (suggest a free gap via SandyFreeGap, create event, one-tap Undo),
   Not this week (snooze until next Sunday), and a link to the Profile toggle.
   Weekly review gets a one-line grocery status when that card is shown.
   Toggle: Profile → Sandy Intelligence → Grocery nudge (profiles.si_grocery). */
(function () {
  'use strict';

  const WINDOW_DAYS = 7;
  const RUN_MINUTES = 60;           // default grocery-run length for gap fit
  const PUSH_DOW = 6;               // Saturday
  const PUSH_HOUR = 10;             // 10 AM local
  const PUSH_WINDOW_MIN = 15;
  const LS_KEY = 'sandy.si.grocery';
  const LS_SNOOZE = 'sandy.si.grocery.snoozeUntil'; // ymd of next Sunday when snooze ends (exclusive show-until)

  /** Match titles / notes / categories. Keep in sync with send-reminders GROCERY_WORDS. */
  const GROCERY_WORDS = [
    'grocery', 'groceries',
    'costco', 'aldi', 'schnucks', "schnuck's",
    'dierbergs', "dierberg's",
    'walmart', 'target run',
    "trader joe's", 'trader joes', 'trader joe',
    'whole foods', 'instacart',
    'meal prep', 'food shopping'
  ];

  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const t12 = d => (window.SandyTime ? SandyTime.fmt(d) : (() => { let h = d.getUTCHours(); const m = d.getUTCMinutes(); const ap = h < 12 ? 'AM' : 'PM'; h = h % 12 || 12; return m ? `${h}:${String(m).padStart(2, '0')} ${ap}` : `${h} ${ap}`; })());
  const A = () => window.__app;
  const synced = () => !!(A() && A().Store && A().Store.mode === 'supabase');
  const pad = n => String(n).padStart(2, '0');

  function wordsRe() {
    const alt = GROCERY_WORDS.map(w =>
      w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '\\s+')
    ).join('|');
    return new RegExp(`\\b(?:${alt})\\b`, 'i');
  }
  const RE = wordsRe();

  /** True if title/notes/category look grocery-related. */
  function isGroceryText(ev) {
    if (!ev) return false;
    const blob = `${ev.title || ''} ${ev.notes || ''} ${ev.category || ''} ${ev.body || ''}`;
    return RE.test(blob);
  }

  /** Sunday (wall) that starts the week containing `day` (Date wall-as-UTC). */
  function weekStartSunday(day) {
    const a = A();
    const d = a ? a.startOfDay(day) : new Date(Date.UTC(day.getUTCFullYear(), day.getUTCMonth(), day.getUTCDate()));
    const dow = d.getUTCDay(); // 0=Sun
    return a ? a.addDays(d, -dow) : new Date(d.getTime() - dow * 86400000);
  }

  function readSnoozeYmd() {
    try { return localStorage.getItem(LS_SNOOZE) || ''; } catch (_) { return ''; }
  }
  function writeSnoozeYmd(ymd) {
    try {
      if (ymd) localStorage.setItem(LS_SNOOZE, ymd);
      else localStorage.removeItem(LS_SNOOZE);
    } catch (_) {}
  }
  /** Snoozed if today (ymd) is before snoozeUntil ymd (exclusive end = next Sunday). */
  function isSnoozed(now) {
    const until = readSnoozeYmd();
    if (!until) return false;
    const a = A();
    const today = a.ymd(a.startOfDay(now));
    return today < until;
  }
  /** Snooze through end of this week → until next Sunday ymd. */
  function snoozeThisWeek(now) {
    const a = A();
    const ws = weekStartSunday(now);
    const nextSun = a.addDays(ws, 7);
    writeSnoozeYmd(a.ymd(nextSun));
    return a.ymd(nextSun);
  }

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
        if (r && 'si_grocery' in r) p = { enabled: r.si_grocery !== false, available: true };
      } catch (_) {}
    }
    return (prefs = p);
  }
  async function setPrefs(patch) {
    if ('enabled' in patch) writeLocal(!!patch.enabled);
    if (synced() && 'enabled' in patch) {
      try { await A().Store.saveProfile({ si_grocery: !!patch.enabled }); }
      catch (e) {
        if (e && (e.code === 'PGRST204' || e.code === '42703' || /si_grocery|column/i.test(e.message || '')))
          throw new Error('Sandy Intelligence needs a one-time server update first. Try again soon.');
        throw new Error('Could not save: ' + (e.message || e));
      }
    }
    prefs = { ...(await getPrefs()), ...patch, available: synced() ? true : false };
    return prefs;
  }
  function invalidate() { prefs = undefined; }

  /**
   * Collect grocery-related occurrences / open to-dos overlapping [from, to).
   * Includes timed events, all-day, tasks (not done), and inbox items.
   */
  async function findGroceryInWindow(a, now, from, to) {
    const vis = a.settings().visible;
    const all = (await a.Store.list()).filter(e => vis[e.calendar] !== false);
    const hits = [];
    for (const ev of all) {
      if (!isGroceryText(ev)) continue;
      if (ev.kind === 'task' && ev.done) continue;
      if (a.isRecurring && a.isRecurring(ev)) {
        for (const o of a.occurrences(ev, from, to)) {
          if (ev.kind === 'task' && a.isDone && a.isDone(ev, o.key)) continue;
          hits.push({ ev, o, start: o.start, end: o.end || o.start, source: 'cal' });
        }
      } else {
        // one-shot: include if start in window, or undated open task
        let start = null, end = null;
        try {
          if (ev.start) {
            start = typeof ev.start === 'string' ? a.parseLocal(ev.start) : ev.start;
            end = ev.end ? (typeof ev.end === 'string' ? a.parseLocal(ev.end) : ev.end) : start;
          }
        } catch (_) {}
        if (start && start >= from && start < to) {
          hits.push({ ev, o: { start, end, key: a.ymd(start) }, start, end, source: 'cal' });
        } else if (ev.kind === 'task' && !ev.done && !start) {
          // undated open grocery task counts as "have a plan"
          hits.push({ ev, o: null, start: null, end: null, source: 'cal-open' });
        }
      }
    }
    // Inbox
    try {
      const Inbox = window.SandyNav && SandyNav.Inbox;
      if (Inbox) {
        for (const it of await Inbox.list()) {
          if (it.done) continue;
          if (isGroceryText({ title: it.body, notes: '', category: '', body: it.body })) {
            hits.push({ ev: { id: it.id, title: String(it.body || '').split('\n')[0], kind: 'task' }, o: null, start: null, end: null, source: 'inbox' });
          }
        }
      }
    } catch (_) {}
    return hits;
  }

  /** Best free gap (≥ RUN_MINUTES) today or tomorrow via SandyFreeGap helpers. */
  async function suggestGap(a, now) {
    const FG = window.SandyFreeGap;
    if (!FG || !FG.findGaps) return null;
    const today = a.startOfDay(now);
    const days = [today, a.addDays(today, 1), a.addDays(today, 2)];
    for (let i = 0; i < days.length; i++) {
      const day = days[i];
      let busy = [];
      try {
        if (FG._test && FG._test.busyForDay) busy = await FG._test.busyForDay(a, day);
        else {
          // fallback: build busy from timed events
          const vis = a.settings().visible;
          const end = a.addDays(day, 1);
          for (const ev of await a.Store.list()) {
            if (vis[ev.calendar] === false || ev.kind === 'task' || ev.allDay) continue;
            for (const o of a.occurrences(ev, day, end)) {
              if (o.end > o.start) busy.push({ start: o.start, end: o.end, title: ev.title });
            }
          }
        }
      } catch (_) { busy = []; }
      const clipNow = i === 0 ? now : null;
      const gaps = FG.findGaps(day, busy, clipNow).filter(g => g.min >= RUN_MINUTES);
      if (gaps.length) {
        // Prefer late morning / afternoon (10–18)
        const scored = gaps.map(g => {
          const midH = g.start.getUTCHours() + g.start.getUTCMinutes() / 60;
          const pref = midH >= 10 && midH <= 18 ? 0 : 1;
          return { g, pref, midH };
        }).sort((x, y) => x.pref - y.pref || y.g.min - x.g.min);
        return { ...scored[0].g, which: i === 0 ? 'today' : i === 1 ? 'tomorrow' : a.fmtDay(day) };
      }
    }
    return null;
  }

  async function data(a, now) {
    const p = await getPrefs();
    if (!p.enabled) return null;
    if (isSnoozed(now)) return null;
    const today = a.startOfDay(now);
    const end = a.addDays(today, WINDOW_DAYS);
    const hits = await findGroceryInWindow(a, now, today, end);
    if (hits.length) return null; // already covered
    const gap = await suggestGap(a, now);
    return {
      now, today, end, gap,
      windowLabel: `${a.fmtDay(today)} – ${a.fmtDay(a.addDays(end, -1))}`
    };
  }

  /** One-line status for the weekly review card (always when weekly is showing). */
  async function weeklyLine(a, now) {
    const p = await getPrefs();
    if (!p.enabled) return null;
    const today = a.startOfDay(now);
    const end = a.addDays(today, WINDOW_DAYS);
    const hits = await findGroceryInWindow(a, now, today, end);
    if (hits.length) {
      const first = hits[0];
      const when = first.start ? `${a.fmtDay(first.start)}${first.ev && !first.ev.allDay && first.start ? ' ' + t12(first.start) : ''}` : 'on your list';
      return { ok: true, text: `Grocery: covered — ${first.ev.title || 'item'} (${when})` };
    }
    if (isSnoozed(now)) return { ok: true, text: 'Grocery: snoozed until next week' };
    return { ok: false, text: 'Grocery: no run in the next 7 days' };
  }

  function html(d) {
    if (!d) return '';
    let h = `<section class="tc-sec tc-card tc-grocery" id="tcGrocery" aria-labelledby="grH">`;
    h += `<h3 id="grH">🛒 Grocery run?</h3>`;
    h += `<p class="gr-msg">No grocery shopping on your calendar in the next ${WINDOW_DAYS} days (${esc(d.windowLabel)}).</p>`;
    if (d.gap) {
      const when = d.gap.which === 'today' ? 'Today' : d.gap.which === 'tomorrow' ? 'Tomorrow' : esc(d.gap.which);
      h += `<p class="gr-gap muted small">Free slot: <b>${when} ${esc(t12(d.gap.start))}–${esc(t12(d.gap.end))}</b></p>`;
    } else {
      h += `<p class="gr-gap muted small">No ${RUN_MINUTES}+ min free slot in the next couple of days — add a to-do instead.</p>`;
    }
    h += `<div class="gr-actions">`;
    h += `<button type="button" class="gr-add" data-gr="add">${d.gap ? 'Add grocery run' : 'Add grocery to-do'}</button>`;
    h += `<button type="button" class="gr-snooze link-btn" data-gr="snooze">Not this week</button>`;
    h += `<button type="button" class="gr-settings link-btn" data-gr="settings">Settings</button>`;
    h += `</div></section>`;
    return h;
  }

  /** Create grocery event in gap (or all-day to-do). Returns {msg, undo}. */
  async function addRun() {
    const a = A(); if (!a) throw new Error('App not ready');
    const now = a.nowWall();
    const gap = await suggestGap(a, now);
    const cal = a.firstVisibleCal();
    if (gap) {
      const start = gap.start;
      const end = new Date(start.getTime() + RUN_MINUTES * 60000);
      const endClamped = end > gap.end ? gap.end : end;
      const ymd = a.ymd(start), hm0 = a.hm(start), hm1 = a.hm(endClamped);
      const ev = {
        id: (crypto.randomUUID && crypto.randomUUID()) || undefined,
        kind: 'event', title: 'Grocery run',
        notes: '', calendar: cal, category: 'Errand', allDay: false,
        start: `${ymd}T${hm0}`, end: `${ymd}T${hm1}`,
        recurrence: { freq: 'none' }, location: '', reminders: []
      };
      const saved = await a.Store.save(ev);
      return {
        msg: `Added “Grocery run” ${t12(start)}`,
        undo: async () => { try { await a.Store.remove(saved.id); } catch (_) {} }
      };
    }
    // Fallback: all-day to-do tomorrow
    const day = a.addDays(a.startOfDay(now), 1);
    const ymd = a.ymd(day);
    const ev = {
      id: (crypto.randomUUID && crypto.randomUUID()) || undefined,
      kind: 'task', title: 'Grocery run',
      notes: '', calendar: cal, category: 'Task / to-do', allDay: true,
      start: ymd, end: ymd, recurrence: { freq: 'none' },
      location: '', reminders: [], scope: 'day', done: false
    };
    const saved = await a.Store.save(ev);
    return {
      msg: `Added grocery to-do for ${a.fmtDay(day)}`,
      undo: async () => { try { await a.Store.remove(saved.id); } catch (_) {} }
    };
  }

  async function snooze(now) {
    const until = snoozeThisWeek(now || A().nowWall());
    return { msg: `Snoozed until ${until}`, until };
  }

  window.SandyGrocery = {
    WINDOW_DAYS, RUN_MINUTES, PUSH_DOW, PUSH_HOUR, PUSH_WINDOW_MIN, GROCERY_WORDS,
    isGroceryText, weekStartSunday, isSnoozed, snoozeThisWeek,
    findGroceryInWindow, suggestGap, data, html, weeklyLine, addRun, snooze,
    getPrefs, setPrefs, invalidate,
    _test: { wordsRe, RE, readSnoozeYmd, writeSnoozeYmd, readLocal, writeLocal }
  };
})();
