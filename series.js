/* series.js — editing repeating events (t166u): split a series from a date ("this and following"), skip or move
 * one or several occurrences, and replace one occurrence with a one-off. Used by Sandy Intelligence (ai.js) and
 * the event editor / drag-to-move (app.js), so both work on the same data model:
 *   - a series row: recurrence {freq, interval, until (inclusive), byWeekday}, exdates [skipped/detached dates]
 *   - a changed occurrence ("exception"): a one-off row with seriesId + originalDate, and its date in the
 *     series' exdates (see detachOccurrence in app.js)
 *   - "this and following": the old row ends the day before (until), a NEW series row continues from that date
 *     with the same details (calendar, category, location, notes, reminders); no schema change.
 * Every function is pure: it returns {save: [rows], remove: [ids], created: [ids]} and never writes. */
(function () {
  'use strict';
  const W = (y, m, d, h = 0, mi = 0) => { const x = new Date(Date.UTC(2000, 0, 1, h, mi)); x.setUTCFullYear(y, m, d); return x; };
  const pad = n => String(n).padStart(2, '0');
  const parse = s => { const [d, t = '00:00'] = String(s).split('T'); const [y, m, dd] = d.split('-').map(Number); const [h, mi] = t.split(':').map(Number); return W(y, m - 1, dd, h || 0, mi || 0); };
  const ymd = d => `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
  const hm = d => `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`;
  const addDays = (k, n) => { const d = parse(k); return ymd(W(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + n)); };
  const DAY = 86400000;
  const uid = () => (crypto.randomUUID ? crypto.randomUUID() : 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => { const r = Math.random() * 16 | 0; return (c === 'x' ? r : (r & 3 | 8)).toString(16); }));
  const app = () => window.__app;
  const isRec = ev => !!(ev && ev.recurrence && ev.recurrence.freq && ev.recurrence.freq !== 'none');
  const clone = v => JSON.parse(JSON.stringify(v));
  const durMs = ev => { if (ev.allDay) return Math.max(0, parse(String(ev.end || ev.start).slice(0, 10)) - parse(String(ev.start).slice(0, 10))); const d = parse(ev.end || ev.start) - parse(ev.start); return d > 0 ? d : 3600000; };
  const at = (key, time) => time ? `${key}T${time}` : key;

  /** Occurrence date keys of a series in [fromKey, toKey] (inclusive), using the app's own expansion. */
  function occKeys(ev, fromKey, toKey) { return app().occurrences(ev, parse(fromKey), parse(addDays(toKey, 1))).map(o => o.key); }
  function firstKey(ev) { const s = String(ev.start).slice(0, 10); return occKeys(ev, s, addDays(s, 800))[0] || null; }
  /** The exception rows (changed single occurrences) of a series. */
  const exceptionsOf = (all, id) => all.filter(e => e.seriesId === id);

  /** End a series before fromKey ("delete this and following"). If nothing would be left, remove it. */
  function endBefore(series, fromKey, all = []) {
    const excs = exceptionsOf(all, series.id).filter(e => e.originalDate >= fromKey);
    const keep = occKeys(series, String(series.start).slice(0, 10), addDays(fromKey, -1));
    const keptExc = exceptionsOf(all, series.id).filter(e => e.originalDate < fromKey);
    if (!keep.length && !keptExc.length) return { save: [], remove: [series.id], created: [] };
    const old = clone(series);
    old.recurrence = { ...old.recurrence, until: addDays(fromKey, -1) };
    old.exdates = (old.exdates || []).filter(d => d < fromKey);
    if (old.completedDates) old.completedDates = old.completedDates.filter(d => d < fromKey);
    return { save: [old], remove: excs.map(e => e.id), created: [] };
  }

  /** Split from fromKey: occurrences before stay; from fromKey on the series follows `p`:
   *  p = { start:'HH:MM', end:'HH:MM', minutes, weekdays:[0..6], freq, interval, until, title, location, category,
   *        calendar, notes, reminders, allDay }. Exceptions on/after fromKey move to the new series. */
  function split(series, fromKey, p = {}, all = []) {
    if (!isRec(series)) throw new Error('That event doesn’t repeat');
    const r0 = series.recurrence;
    const nr = { freq: p.freq || r0.freq, interval: Math.max(1, +(p.interval || (p.freq && p.freq !== r0.freq ? 1 : r0.interval) || 1)), until: p.until !== undefined ? (p.until || null) : (r0.until || null) };
    if (nr.freq === 'weekly') nr.byWeekday = (p.weekdays && p.weekdays.length ? p.weekdays : (r0.freq === 'weekly' && r0.byWeekday && r0.byWeekday.length ? r0.byWeekday : [parse(series.start).getUTCDay()])).map(Number).sort();
    if (nr.until && nr.until < fromKey) throw new Error('The new end date is before the change date');
    const b = parse(series.start);
    const allDay = p.allDay != null ? !!p.allDay : !!series.allDay;
    const st = allDay ? null : (p.start || hm(b));
    let len = durMs(series);
    if (p.minutes) len = p.minutes * 60000;
    else if (!allDay && p.end && st) { const a = parse('2000-01-01T' + st), e = parse('2000-01-01T' + p.end); len = e > a ? e - a : e - a + DAY; }
    // first date of the continuation: unchanged pattern -> the old series' next occurrence (keeps monthly day /
    // every-other-week phase); a new weekday pattern -> the first matching day on/after fromKey
    const samePattern = nr.freq === r0.freq && nr.interval === (+r0.interval || 1) && (nr.freq !== 'weekly' || JSON.stringify(nr.byWeekday) === JSON.stringify(((r0.byWeekday && r0.byWeekday.length ? r0.byWeekday : [b.getUTCDay()]).map(Number).sort())));
    let startKey = null;
    if (samePattern) startKey = occKeys({ ...series, exdates: [] }, fromKey, addDays(fromKey, 800))[0] || null;
    else if (nr.freq === 'weekly') { for (let i = 0; i < 7; i++) { const k = addDays(fromKey, i); if (nr.byWeekday.includes(parse(k).getUTCDay())) { startKey = k; break; } } }
    else startKey = fromKey;
    if (!startKey) throw new Error('No repeats left on or after that date');
    const sDate = parse(at(startKey, st));
    const eDate = new Date(sDate.getTime() + len);
    const next = clone(series);
    delete next.id; delete next.createdAt; delete next.updatedAt; delete next.seriesId; delete next.originalDate;
    for (const k of ['title', 'location', 'category', 'calendar', 'notes']) if (p[k] != null && p[k] !== '') next[k] = p[k];
    if (Array.isArray(p.reminders)) next.reminders = p.reminders;
    next.allDay = allDay;
    next.start = allDay ? startKey : `${startKey}T${hm(sDate)}`;
    next.end = allDay ? ymd(eDate) : `${ymd(eDate)}T${hm(eDate)}`;
    next.recurrence = nr;
    next.exdates = samePattern ? (series.exdates || []).filter(d => d >= fromKey) : []; // skipped dates still apply if the days are the same
    if (series.completedDates) next.completedDates = series.completedDates.filter(d => d >= fromKey);
    return splitRow(series, fromKey, next, all, samePattern);
  }
  /** Shared by SI and the editor ("This and following"): `next` is the full continuation row (no id yet). */
  function splitRow(series, fromKey, next, all = [], samePattern = false) {
    const r0 = series.recurrence;
    next = clone(next); delete next.seriesId; delete next.originalDate; delete next.createdAt; delete next.updatedAt;
    next.id = uid();
    if (!Array.isArray(next.exdates)) next.exdates = samePattern ? (series.exdates || []).filter(d => d >= fromKey) : [];
    const excs = exceptionsOf(all, series.id).filter(e => e.originalDate >= fromKey).map(e => ({ ...clone(e), seriesId: next.id }));
    if (excs.length) next.exdates = [...new Set([...next.exdates, ...excs.map(e => e.originalDate)])];
    // nothing before fromKey: change the series in place (keeps its id, exceptions and notes)
    const before = occKeys(series, String(series.start).slice(0, 10), addDays(fromKey, -1));
    const exBefore = exceptionsOf(all, series.id).filter(e => e.originalDate < fromKey);
    if (!before.length && !exBefore.length) {
      const same = { ...next, id: series.id, createdAt: series.createdAt };
      same.exdates = samePattern ? [...(series.exdates || [])] : (series.exdates || []).filter(d => exceptionsOf(all, series.id).some(e => e.originalDate === d));
      return { save: [same], remove: [], created: [], inPlace: true, next: same };
    }
    const old = clone(series);
    old.recurrence = { ...r0, until: addDays(fromKey, -1) };
    old.exdates = (old.exdates || []).filter(d => d < fromKey);
    if (old.completedDates) old.completedDates = old.completedDates.filter(d => d < fromKey);
    return { save: [old, next, ...excs], remove: [], created: [next.id], next, old, moveNotes: { from: series.id, to: next.id, since: fromKey } };
  }

  /** Skip (cancel) occurrences; a date that was already changed loses its changed copy too. */
  function skip(series, keys, all = []) {
    const s = clone(series); const remove = [];
    for (const k of keys) {
      s.exdates = [...new Set([...(s.exdates || []), k])];
      if (s.completedDates) s.completedDates = s.completedDates.filter(d => d !== k);
      const ex = exceptionsOf(all, series.id).find(e => e.originalDate === k); if (ex) remove.push(ex.id);
    }
    return { save: [s], remove, created: [] };
  }

  /** Change single occurrences: items [{date, start:'HH:MM'|'YYYY-MM-DDTHH:MM', end, minutes, title, location, notes}]. */
  function move(series, items, all = []) {
    let s = clone(series); const save = [], created = [];
    for (const it of items) {
      const key = it.date; const existing = exceptionsOf(all, series.id).find(e => e.originalDate === key);
      const baseRow = existing ? clone(existing) : null;
      const occStart = baseRow ? parse(baseRow.start) : parse(at(key, series.allDay ? null : hm(parse(series.start))));
      const len = baseRow ? durMs(baseRow) : durMs(series);
      let ns = occStart;
      if (it.start) ns = it.start.length > 5 ? parse(it.start) : parse(`${ymd(occStart)}T${it.start}`);
      let ne = new Date(ns.getTime() + (it.minutes ? it.minutes * 60000 : len));
      if (it.end) { ne = it.end.length > 5 ? parse(it.end) : parse(`${ymd(ns)}T${it.end}`); if (ne <= ns) ne = new Date(ne.getTime() + DAY); }
      const ch = { start: series.allDay ? ymd(ns) : `${ymd(ns)}T${hm(ns)}`, end: series.allDay ? ymd(ne) : `${ymd(ne)}T${hm(ne)}` };
      for (const k of ['title', 'location', 'notes', 'category']) if (it[k] != null && it[k] !== '') ch[k] = it[k];
      if (baseRow) { save.push({ ...baseRow, ...ch }); continue; }
      const [parent, ex] = app().detachOccurrence(s, key, ch); s = parent; ex.id = uid(); save.push(ex); created.push(ex.id);
    }
    return { save: [s, ...save], remove: [], created };
  }

  /** Replace one occurrence with a one-off event (cancel it, add the new one). Inherits calendar, category,
   *  location and reminders unless given. r = {title, start:'HH:MM'|full, end, minutes, location, category, calendar, notes, date}. */
  function replace(series, key, r = {}, all = []) {
    const sk = skip(series, [key], all);
    const occStart = parse(at(key, series.allDay ? null : hm(parse(series.start))));
    const dayKey = r.date || key;
    const allDay = r.allDay != null ? !!r.allDay : (!r.start && series.allDay);
    let ns = r.start ? (r.start.length > 5 ? parse(r.start) : parse(`${dayKey}T${r.start}`)) : parse(at(dayKey, allDay ? null : hm(occStart)));
    let ne = new Date(ns.getTime() + (r.minutes ? r.minutes * 60000 : (allDay ? 0 : durMs(series))));
    if (r.end) { ne = r.end.length > 5 ? parse(r.end) : parse(`${ymd(ns)}T${r.end}`); if (ne <= ns) ne = new Date(ne.getTime() + DAY); }
    const one = { id: uid(), kind: 'event', calendar: r.calendar || series.calendar, category: r.category || series.category, title: r.title || series.title,
      allDay, start: allDay ? ymd(ns) : `${ymd(ns)}T${hm(ns)}`, end: allDay ? ymd(ne) : `${ymd(ne)}T${hm(ne)}`,
      location: r.location != null ? r.location : (series.location || ''), notes: r.notes || '', recurrence: { freq: 'none' },
      reminders: Array.isArray(r.reminders) ? r.reminders : (series.reminders || []) };
    if (series.kind === 'task') { one.kind = 'task'; one.scope = series.scope || 'day'; one.done = false; one.completedDates = []; }
    return { save: [...sk.save, one], remove: sk.remove, created: [one.id], added: one };
  }

  /** Apply a plan through Store; returns an undo function that puts every touched row back. */
  async function apply(plan) {
    const S = app().Store; const before = new Map();
    for (const ev of await S.list()) before.set(ev.id, clone(ev));
    if (plan.save.length) await S.saveMany(plan.save.map(clone));
    if (plan.remove.length) for (const id of plan.remove) await S.remove(id);
    const moved = plan.moveNotes ? await moveNotes(plan.moveNotes) : [];
    const undo = snapshotUndo(before);
    return async () => { const r = await undo(); if (moved.length) await moveNotes({ back: moved }); return r; };
  }
  /** Day notes + checklist ticks are keyed by series id + date: carry the future ones over to the continuation. */
  async function moveNotes({ from, to, since, back }) {
    const S = app().Store; const done = [];
    try {
      const notes = back ? back.filter(x => x.t === 'n').map(x => ({ eventId: x.to, date: x.date, body: x.body, dest: x.from })) : (S.notes ? (await S.notes.all()).filter(n => n.eventId === from && n.date >= since).map(n => ({ ...n, dest: to })) : []);
      for (const n of notes) { await S.notes.set(n.dest, n.date, n.body); await S.notes.set(n.eventId, n.date, ''); done.push({ t: 'n', from: n.eventId, to: n.dest, date: n.date, body: n.body }); }
      const checks = back ? back.filter(x => x.t === 'c').map(x => ({ eventId: x.to, date: x.date, checked: x.checked, dest: x.from })) : (S.checks ? (await S.checks.all()).filter(c => c.eventId === from && c.date >= since && (c.checked || []).length).map(c => ({ ...c, dest: to })) : []);
      for (const c of checks) { await S.checks.set(c.dest, c.date, [...c.checked]); await S.checks.set(c.eventId, c.date, []); done.push({ t: 'c', from: c.eventId, to: c.dest, date: c.date, checked: [...c.checked] }); }
    } catch (e) { console.warn('series notes', e); }
    return done;
  }
  /** Undo by diffing against a snapshot taken before a change: re-save changed/removed rows, remove new ones. */
  function snapshotUndo(before) {
    return async () => {
      const S = app().Store; const now = await S.list();
      const created = now.filter(e => !before.has(e.id)).map(e => e.id);
      const restore = [];
      for (const [id, old] of before) { const cur = now.find(e => e.id === id); if (!cur || JSON.stringify({ ...cur, updatedAt: 0 }) !== JSON.stringify({ ...old, updatedAt: 0 })) restore.push(clone(old)); }
      for (const id of created) await S.remove(id);
      if (restore.length) await S.saveMany(restore);
      return { restored: restore.length, removed: created.length };
    };
  }
  async function snapshot() { const m = new Map(); for (const ev of await app().Store.list()) m.set(ev.id, clone(ev)); return m; }

  window.SandySeries = { split, splitRow, endBefore, skip, move, replace, apply, snapshot, snapshotUndo, occKeys, firstKey, exceptionsOf, isRec, addDays, parse, ymd, hm };
})();
