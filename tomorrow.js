/* SANDY - Sandy Intelligence: "Tomorrow" preview on the Today tab (evenings).
   From 6 PM, Today shows a card for tomorrow: the first event and when to leave for it, how many events and to-dos,
   and what to prep. Prep comes only from your own data (no AI call, nothing sent anywhere):
     - unticked "- [ ] item" checklist lines in tomorrow's event notes,
     - "Bring … / Pack … / Wear … / Remember … / Need … / Don't forget …" lines in event notes and Today's Notes,
     - to-dos due tomorrow,
     - an early start (first event before 8 AM).
   Leave-by uses leaveby.js (home or the previous event; free OSM routing, cached). */
(function () {
  'use strict';
  const EVENING_HOUR = 18, EARLY_HOUR = 8, MAX_PREP = 6;
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const t12 = d => (window.SandyTime ? SandyTime.fmt(d) : (() => { let h = d.getUTCHours(); const m = d.getUTCMinutes(); const ap = h < 12 ? 'AM' : 'PM'; h = h % 12 || 12; return `${h}:${String(m).padStart(2, '0')} ${ap}`; })());
  const ckKey = t => t.toLowerCase().replace(/\s+/g, ' ').trim();
  const CHECK_RE = /^\s*[-*]\s*\[( |x|X)?\]\s*(.+?)\s*$/;
  const PREP_RE = /^\s*(?:[-*•]\s*)?((?:bring|pack|wear|remember|need|don['’]?t forget)\b.*?)\s*$/i;

  /** Evening = 6 PM or later (wall clock). */
  const isEvening = now => now.getUTCHours() >= EVENING_HOUR;
  /** '- [ ] item' lines (same rule as the editor's checklist). */
  function checklist(text) {
    const out = [];
    for (const line of String(text || '').split('\n')) { const m = line.match(CHECK_RE); if (m && !out.some(o => o.key === ckKey(m[2]))) out.push({ text: m[2], key: ckKey(m[2]) }); }
    return out;
  }
  /** "Bring water", "Pack: cleats", "Don't forget the forms" (checklist lines excluded). */
  function prepLines(text) {
    const out = [];
    for (const line of String(text || '').split('\n')) {
      if (CHECK_RE.test(line)) continue;
      const m = line.match(PREP_RE); if (!m) continue;
      const s = m[1].replace(/\s+/g, ' ').slice(0, 140);
      if (!out.some(o => ckKey(o) === ckKey(s))) out.push(s);
    }
    return out;
  }

  async function data(a, now) {
    const today = a.startOfDay(now), day = a.addDays(today, 1), end = a.addDays(today, 2);
    const vis = a.settings().visible;
    const all = (await a.Store.list()).filter(e => vis[e.calendar] !== false);
    const items = [];
    for (const ev of all) for (const o of a.occurrences(ev, day, end)) items.push({ ev, o });
    items.sort((x, y) => (y.ev.allDay - x.ev.allDay) || (x.o.start - y.o.start));
    const events = items.filter(x => x.ev.kind !== 'task'), tasks = items.filter(x => x.ev.kind === 'task');
    const timed = events.filter(x => !x.ev.allDay).sort((x, y) => x.o.start - y.o.start);
    const first = timed[0] || events[0] || null;
    const prep = [];
    if (timed[0] && timed[0].o.start.getUTCHours() < EARLY_HOUR) prep.push({ kind: 'early', x: timed[0] });
    const notes = a.Store.notes, checks = a.Store.checks;
    for (const x of [...events.filter(x => x.ev.allDay), ...timed]) {
      const nk = a.noteKeyFor(x.ev, x.o.key);
      let ticked = [];
      const list = checklist(x.ev.notes);
      if (list.length && checks) { try { ticked = await checks.get(nk.eventId, nk.date); } catch (_) {} }
      for (const c of list) if (!ticked.includes(c.key)) prep.push({ kind: 'check', text: c.text, x });
      let dayNote = null;
      if (notes) { try { dayNote = await notes.get(nk.eventId, nk.date); } catch (_) {} }
      const seen = new Set();
      for (const s of [...prepLines(x.ev.notes), ...prepLines(dayNote && dayNote.body)]) { if (seen.has(ckKey(s))) continue; seen.add(ckKey(s)); prep.push({ kind: 'bring', text: s, x }); }
    }
    for (const x of tasks) if (!a.isDone(x.ev, x.o.key)) prep.push({ kind: 'todo', text: x.ev.title, x });
    return { now, day, items, events, tasks, timed, first, prep, openTasks: tasks.filter(x => !a.isDone(x.ev, x.o.key)).length };
  }

  const evBtn = x => `<button type="button" class="tc-link tc-item" data-id="${esc(x.ev.id)}" data-key="${esc(x.o.key)}">${esc(x.ev.title)}</button>`;
  const ICON = { early: '⏰', check: '☐', bring: '🎒', todo: '✅' };
  function prepHtml(p) {
    if (p.kind === 'early') return `<li class="tm-prep-early"><span aria-hidden="true">${ICON.early}</span> <span>Early start: ${evBtn(p.x)} at ${esc(t12(p.x.o.start))}</span></li>`;
    const what = p.kind === 'todo' ? 'To-do' : p.kind === 'check' ? 'Checklist' : '';
    return `<li class="tm-prep-${p.kind}"><span aria-hidden="true">${ICON[p.kind]}</span> <span>${what ? `<span class="tm-k">${what}:</span> ` : ''}${p.kind === 'todo' ? evBtn(p.x) : `${esc(p.text)} <span class="tm-for">· ${evBtn(p.x)}</span>`}</span></li>`;
  }
  function html(d) {
    const dt = new Date(d.day.getTime());
    const label = dt.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' });
    const nEv = d.events.length, nT = d.tasks.length;
    const pill = (cls, n, word) => `<span class="tc-pill ${cls}"><b>${n}</b> ${word}</span>`;
    let h = `<section class="tc-sec tc-card tc-tomorrow" id="tcTomorrow" aria-labelledby="tmH"><h3 id="tmH">🌙 Tomorrow <span class="tm-date">· ${esc(label)}</span></h3>`;
    h += `<div class="tc-stats tm-stats">${pill('tc-p-ev', nEv, 'event' + (nEv === 1 ? '' : 's'))}${pill('tc-p-todo', nT, 'to-do' + (nT === 1 ? '' : 's'))}</div>`;
    if (!d.items.length) return h + '<p class="muted small tm-empty">Nothing on the calendar tomorrow.</p></section>';
    if (d.first) h += `<p class="tc-next tm-first"><span class="tc-next-k">First up</span><span class="tc-next-v">${evBtn(d.first)} ${d.first.ev.allDay ? '<span class="muted">(all day)</span>' : `at ${esc(t12(d.first.o.start))}`}</span></p>`;
    h += '<p class="tm-leave" id="tmLeave" hidden></p>';
    h += '<h4 class="tm-h4">To prep tonight</h4>';
    if (d.prep.length) {
      h += `<ul class="tm-prep">${d.prep.slice(0, MAX_PREP).map(prepHtml).join('')}</ul>`;
      if (d.prep.length > MAX_PREP) h += `<p class="muted small tm-more">+${d.prep.length - MAX_PREP} more</p>`;
    } else h += '<p class="muted small tm-none">Nothing flagged. Add “- [ ] item” or “Bring …” lines to an event’s notes and they’ll show here.</p>';
    return h + '</section>';
  }
  /** Fill the leave-by line for tomorrow's first drive (async; leaveby.js caches lookups). */
  async function fillLeave(el, d) {
    if (!el || !window.SandyLeave || !SandyLeave.firstLeave) return null;
    const r = await SandyLeave.firstLeave(d.items, d.day);
    if (!el.isConnected || !r) return r;
    if (r.needHome) el.innerHTML = '🚗 <button type="button" class="tc-link lb-sethome">Add your home</button> to see when to leave';
    else if (r.r && r.r.ok) {
      const who = d.first && r.c.x === d.first ? '' : ` for ${evBtn(r.c.x)}`;
      el.innerHTML = `🚗 Leave by <b>${esc(t12(r.leave))}</b>${who} <span class="muted">· ${r.r.mins} min from ${esc(r.c.from.kind === 'home' ? 'home' : r.c.from.label)}</span>`;
    } else el.innerHTML = `🚗 Couldn't work out the drive to ${esc(r.c.loc)}`;
    el.hidden = false; el.dataset.state = r.needHome ? 'nohome' : r.r && r.r.ok ? 'ok' : 'fail';
    return r;
  }
  window.SandyTomorrow = { isEvening, data, html, fillLeave, checklist, prepLines, EVENING_HOUR };
})();
