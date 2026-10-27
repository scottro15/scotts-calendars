/* SANDY - Sandy Intelligence feature #2: Long-day nudge (FREE, rule-based, no AI).
   The evening before a long day, Today shows a card (from 5 PM local) so you can pack lunch/snacks.
   A long day = tomorrow's timed events across visible calendars, ignoring all-day events and
   reference-only titles (Christian Dake practices), where either:
     - span (first start → last end) ≥ SPAN_HOURS, OR
     - merged scheduled duration ≥ SCHEDULED_HOURS.
   Mentions the best meal-sized gap when there is one. Optional evening push (8 PM) via send-reminders
   when profiles.si_long_day is on. Toggle: Profile → Sandy Intelligence → Long-day nudge. */
(function () {
  'use strict';
  const SPAN_HOURS = 10;
  const SCHEDULED_HOURS = 8;
  const MEAL_GAP_MIN = 30;
  const CARD_HOUR = 17;   // in-app card from 5 PM
  const PUSH_HOUR = 20;   // server push around 8 PM
  const LS_KEY = 'sandy.si.longDay';
  const REF_RE = /christian\s+dake/i;

  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const t12 = d => (window.SandyTime ? SandyTime.fmt(d) : (() => { let h = d.getUTCHours(); const m = d.getUTCMinutes(); const ap = h < 12 ? 'AM' : 'PM'; h = h % 12 || 12; return m ? `${h}:${String(m).padStart(2, '0')} ${ap}` : `${h} ${ap}`; })());
  const isRef = e => REF_RE.test(`${(e && e.title) || ''}`);
  const A = () => window.__app;
  const synced = () => !!(A() && A().Store && A().Store.mode === 'supabase');

  /** Wall-clock minutes between two Dates. */
  const minsBetween = (a, b) => Math.round((b - a) / 60000);

  /** Merge overlapping [start,end] intervals; return total minutes covered. */
  function mergedMinutes(intervals) {
    if (!intervals.length) return 0;
    const xs = intervals.slice().sort((a, b) => a[0] - b[0]);
    let total = 0, cur0 = xs[0][0], cur1 = xs[0][1];
    for (let i = 1; i < xs.length; i++) {
      const [s, e] = xs[i];
      if (s <= cur1) { if (e > cur1) cur1 = e; }
      else { total += minsBetween(cur0, cur1); cur0 = s; cur1 = e; }
    }
    return total + minsBetween(cur0, cur1);
  }

  /** Pick the best meal-sized gap: prefer a gap whose midpoint falls in lunch hours (11–14:30), else the longest. */
  function bestMealGap(sorted) {
    const gaps = [];
    for (let i = 0; i < sorted.length - 1; i++) {
      const a = sorted[i].end, b = sorted[i + 1].start;
      const m = minsBetween(a, b);
      if (m >= MEAL_GAP_MIN) gaps.push({ start: a, end: b, min: m });
    }
    if (!gaps.length) return null;
    const lunch = gaps.filter(g => {
      const midH = (g.start.getUTCHours() * 60 + g.start.getUTCMinutes() + g.min / 2) / 60;
      return midH >= 11 && midH <= 14.5;
    });
    const pool = lunch.length ? lunch : gaps;
    return pool.reduce((a, b) => (b.min >= a.min ? b : a));
  }

  /**
   * Analyze a day's timed events.
   * @param {Array<{start:Date,end:Date,title?:string,allDay?:boolean,kind?:string}>} items
   *   Wall-clock starts/ends. All-day, tasks, and Christian Dake (reference) are ignored.
   * @returns {{isLong:boolean, spanMin:number, scheduledMin:number, first:object|null, last:object|null, gap:object|null, reason:string|null}}
   */
  function analyze(items) {
    const timed = (items || []).filter(x => {
      if (!x || !x.start || !x.end) return false;
      if (x.allDay || x.kind === 'task') return false;
      if (isRef(x) || isRef({ title: x.title })) return false;
      if (!(x.end > x.start)) return false;
      return true;
    }).map(x => ({ start: x.start, end: x.end, title: x.title || '' }))
      .sort((a, b) => a.start - b.start || a.end - b.end);
    if (timed.length < 1) return { isLong: false, spanMin: 0, scheduledMin: 0, first: null, last: null, gap: null, reason: null };
    const first = timed[0], last = timed.reduce((a, b) => (b.end >= a.end ? b : a));
    const spanMin = Math.max(0, minsBetween(first.start, last.end));
    const scheduledMin = mergedMinutes(timed.map(t => [t.start, t.end]));
    const gap = bestMealGap(timed);
    let reason = null;
    if (spanMin >= SPAN_HOURS * 60) reason = 'span';
    else if (scheduledMin >= SCHEDULED_HOURS * 60) reason = 'scheduled';
    return { isLong: !!reason, spanMin, scheduledMin, first, last, gap, reason, count: timed.length };
  }

  /** Human message for the card / push body. */
  function message(info, { forTomorrow = true } = {}) {
    if (!info || !info.isLong) return '';
    const whenWord = forTomorrow ? 'tomorrow' : 'today';
    const shortBreak = !info.gap || info.gap.min < 60;
    let s = `Long day ${whenWord}: ${t12(info.first.start)} to ${t12(info.last.end)}`;
    if (shortBreak) s += ', with only a short break';
    s += '. Pack lunch and snacks tonight.';
    if (info.gap) {
      const midH = (info.gap.start.getUTCHours() * 60 + info.gap.start.getUTCMinutes() + info.gap.min / 2) / 60;
      const label = midH >= 11 && midH <= 14.5 ? 'best lunch window' : 'longest open window';
      s += ` Your ${label} is ${t12(info.gap.start)}–${t12(info.gap.end)}.`;
    }
    return s;
  }

  function isCardTime(now) { return now.getUTCHours() >= CARD_HOUR; }

  /** Load SI long-day preference (server when signed in; else this device). Default on. */
  let prefs; // { enabled, available } | undefined
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
        if (r && 'si_long_day' in r) p = { enabled: r.si_long_day !== false, available: true };
      } catch (_) {}
    }
    return (prefs = p);
  }
  async function setPrefs(patch) {
    if ('enabled' in patch) writeLocal(!!patch.enabled);
    if (synced() && 'enabled' in patch) {
      try { await A().Store.saveProfile({ si_long_day: !!patch.enabled }); }
      catch (e) {
        if (e && (e.code === 'PGRST204' || e.code === '42703' || /si_long_day|column/i.test(e.message || '')))
          throw new Error('Sandy Intelligence needs a one-time server update first. Try again soon.');
        throw new Error('Could not save: ' + (e.message || e));
      }
    }
    prefs = { ...(await getPrefs()), ...patch, available: synced() ? true : false };
    return prefs;
  }
  function invalidate() { prefs = undefined; }

  /** Tomorrow's timed items for the current user (visible calendars). */
  async function tomorrowTimed(a, now) {
    const today = a.startOfDay(now), day = a.addDays(today, 1), end = a.addDays(today, 2);
    const vis = a.settings().visible;
    const all = (await a.Store.list()).filter(e => vis[e.calendar] !== false);
    const out = [];
    for (const ev of all) {
      if (ev.kind === 'task' || ev.allDay) continue;
      if (isRef(ev)) continue;
      for (const o of a.occurrences(ev, day, end)) out.push({ start: o.start, end: o.end, title: ev.title, allDay: false, kind: ev.kind, ev, o });
    }
    return out;
  }

  /** Build card data for tonight's preview of tomorrow. Null when off / not evening / not long. */
  async function data(a, now) {
    if (!isCardTime(now)) return null;
    const p = await getPrefs();
    if (!p.enabled) return null;
    const timed = await tomorrowTimed(a, now);
    const info = analyze(timed);
    if (!info.isLong) return null;
    const day = a.addDays(a.startOfDay(now), 1);
    return { now, day, info, text: message(info, { forTomorrow: true }), timed };
  }

  function html(d) {
    if (!d) return '';
    const label = d.day.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' });
    const hrs = Math.round(d.info.spanMin / 60);
    const sched = Math.round(d.info.scheduledMin / 60 * 10) / 10;
    let body = esc(d.text);
    // Soften the packed sentence into structured bits for the card
    let h = `<section class="tc-sec tc-card tc-longday" id="tcLongDay" aria-labelledby="ldH">`;
    h += `<h3 id="ldH">🥪 Long day <span class="ld-date">· ${esc(label)}</span></h3>`;
    h += `<p class="ld-msg">${body}</p>`;
    h += `<p class="ld-meta muted small">${hrs} hr span · ${sched} hr scheduled · ${d.info.count} timed event${d.info.count === 1 ? '' : 's'}</p>`;
    h += `</section>`;
    return h;
  }

  window.SandyLongDay = {
    SPAN_HOURS, SCHEDULED_HOURS, MEAL_GAP_MIN, CARD_HOUR, PUSH_HOUR,
    isRef, analyze, message, isCardTime, data, html, getPrefs, setPrefs, invalidate,
    _test: { mergedMinutes, bestMealGap, readLocal, writeLocal }
  };
})();
