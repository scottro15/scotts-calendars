/*
 * titleac.js: title autofill for the event editor (t148u item 2).
 *
 * As you type a title, SANDY suggests titles from YOUR OWN past events and to-dos (Store.list() only
 * returns the signed-in user's rows; Supabase RLS enforces that server-side). Ranked by how well the
 * text matches, then how often you've used the title and how recently. One row per title (no dupes).
 * Picking one copies that event's calendar, category (its colour/style), kind, time of day + duration,
 * location, notes and reminders onto the form; the date you're creating on is kept.
 *
 * Keep typing to ignore the list. ↑/↓ + Enter, or tap. Escape, a tap outside, or Android Back
 * (backnav.js) closes it. A compact index is cached in localStorage per user so suggestions show
 * instantly, then refreshed from the store each time the editor opens.
 */
(function () {
  'use strict';
  const MAX = 6, MIN_CHARS = 2, KEEP = 400, CACHE_V = 1;
  const norm = s => String(s || '').toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g, '').replace(/\s+/g, ' ').trim();
  const reduce = () => window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;

  /** Build the suggestion index from a list of events (newest instance of each title is the template). */
  function buildIndex(events, now = Date.now()) {
    const by = new Map();
    for (const e of events || []) {
      if (!e || e.example || !e.title || !String(e.title).trim()) continue;
      const k = norm(e.title);
      const t = Date.parse(e.updatedAt || e.createdAt || '') || 0;
      const s = Date.parse(String(e.start || '').length === 10 ? e.start + 'T12:00:00Z' : (e.start || '') + 'Z') || 0;
      const seen = Math.max(t, Math.min(s, now)); // a far-future start doesn't count as "recent"
      let g = by.get(k);
      if (!g) { g = { k, n: 0, last: 0, tpl: null, tplAt: -1 }; by.set(k, g); }
      g.n++; if (seen > g.last) g.last = seen;
      if (t > g.tplAt || (t === g.tplAt && s > (g.tplS || 0))) { g.tplAt = t; g.tplS = s; g.tpl = template(e); }
    }
    return [...by.values()].map(g => ({ k: g.k, n: g.n, last: g.last, ...g.tpl }))
      .sort((a, b) => score(b, now) - score(a, now)).slice(0, KEEP);
  }
  function template(e) {
    const t = { title: String(e.title).trim(), kind: e.kind === 'task' ? 'task' : 'event', calendar: e.calendar, category: e.category || null,
      allDay: !!e.allDay, location: e.location || '', notes: e.notes || '', reminders: Array.isArray(e.reminders) ? e.reminders.slice(0, 6) : [] };
    if (e.kind === 'task') t.scope = e.scope || 'day';
    if (!e.allDay && e.start && e.start.length > 10) {
      t.time = e.start.slice(11, 16);
      const a = Date.parse(e.start + 'Z'), b = e.end && e.end.length > 10 ? Date.parse(e.end + 'Z') : NaN;
      t.dur = b > a ? Math.round((b - a) / 60000) : 60;
    } else if (e.allDay && e.start && e.end && e.end.length === 10) {
      t.days = Math.max(0, Math.round((Date.parse(e.end) - Date.parse(e.start)) / 86400000));
    }
    return t;
  }
  // frequency + recency (a title used today counts like ~3 extra uses; that bonus halves every 30 days)
  const score = (it, now) => it.n + 3 * Math.pow(0.5, Math.max(0, now - it.last) / (30 * 864e5));

  /** Suggestions for typed text q from an index. */
  function suggest(index, q, now = Date.now()) {
    const nq = norm(q); if (nq.length < MIN_CHARS) return [];
    const out = [];
    for (const it of index) {
      let r = -1;
      if (it.k.startsWith(nq)) r = 0;
      else {
        // word starts anywhere ("film" → "Team film"); mid-word only once 4+ letters are typed ("me" ≠ "Life Time")
        let i = -1; while ((i = it.k.indexOf(nq, i + 1)) > 0) { if (/[\s\-–—/(&,.:#@]/.test(it.k[i - 1])) { r = 1; break; } }
        if (r < 0 && nq.length >= 4 && it.k.indexOf(nq) > 0) r = 2;
      }
      if (r < 0) continue;
      out.push([r, score(it, now), it]);
    }
    return out.sort((a, b) => a[0] - b[0] || b[1] - a[1]).slice(0, MAX).map(x => x[2]);
  }

  let api = null;
  /**
   * attach(input, { load: async () => events, cacheKey: async () => string, apply(item), describe(item) => {sec, color}, enabled: () => bool })
   */
  function attach(input, opt) {
    const wrap = input.closest('.tac-wrap');
    const pop = wrap.querySelector('.tac-pop'), list = pop.querySelector('.ac-list');
    let index = [], items = [], sel = -1, key = null, hideT = 0, picked = '';

    async function refresh() {
      try {
        const k = await opt.cacheKey();
        if (k !== key) { key = k; index = []; try { const c = JSON.parse(localStorage.getItem(k) || 'null'); if (c && c.v === CACHE_V && Array.isArray(c.items)) index = c.items; } catch (_) {} }
        const fresh = buildIndex(await opt.load());
        index = fresh;
        try { localStorage.setItem(k, JSON.stringify({ v: CACHE_V, at: Date.now(), items: fresh })); } catch (_) {}
        if (!pop.hidden) update();
      } catch (e) { console.warn('title autofill: index refresh failed', e); }
    }
    function isOpen() { return !pop.hidden && !pop.classList.contains('tac-leaving'); }
    function open() {
      clearTimeout(hideT); pop.classList.remove('tac-leaving');
      pop.hidden = false; // CSS plays the enter animation whenever it goes from hidden to shown
      input.setAttribute('aria-expanded', 'true'); place();
    }
    function close() {
      input.setAttribute('aria-expanded', 'false'); input.removeAttribute('aria-activedescendant'); sel = -1;
      if (pop.hidden) return;
      clearTimeout(hideT);
      if (reduce()) { pop.hidden = true; return; }
      pop.classList.add('tac-leaving'); hideT = setTimeout(() => { pop.hidden = true; pop.classList.remove('tac-leaving'); }, 130);
    }
    function place() {
      pop.classList.remove('ac-up'); list.style.maxHeight = '';
      const vv = window.visualViewport; const vTop = vv ? vv.offsetTop : 0; const vBot = vv ? vv.offsetTop + vv.height : innerHeight;
      const dlg = input.closest('dialog'); const foot = dlg && dlg.querySelector('.dialog-actions');
      const ir = input.getBoundingClientRect();
      const bottom = Math.min(vBot, foot ? foot.getBoundingClientRect().top : vBot);
      const top = Math.max(vTop, dlg ? dlg.getBoundingClientRect().top : 0);
      const below = bottom - ir.bottom - 6, above = ir.top - top - 6;
      const want = Math.min(300, list.scrollHeight);
      const up = below < want && above > below + 40;
      if (up) pop.classList.add('ac-up');
      list.style.maxHeight = Math.max(110, Math.min(300, up ? above : below)) + 'px';
    }
    function mark(el, text, q) {
      const i = norm(text).indexOf(norm(q)); // norm keeps length for plain text; fall back to no highlight otherwise
      if (i < 0 || norm(text).length !== text.length) { el.textContent = text; return; }
      const b = document.createElement('b'); b.textContent = text.slice(i, i + q.trim().length);
      el.append(text.slice(0, i), b, text.slice(i + q.trim().length));
    }
    function render(q) {
      list.innerHTML = '';
      items.forEach((it, i) => {
        const li = document.createElement('li'); li.id = 'tac-opt-' + i; li.setAttribute('role', 'option'); li.setAttribute('aria-selected', 'false');
        const d = (opt.describe && opt.describe(it)) || {};
        const dot = document.createElement('span'); dot.className = 'tac-dot'; if (d.color) dot.style.background = d.color;
        const txt = document.createElement('span'); txt.className = 'tac-txt';
        const m = document.createElement('span'); m.className = 'ac-main'; mark(m, it.title, q);
        const sec = document.createElement('span'); sec.className = 'ac-sec'; sec.textContent = d.sec || '';
        txt.append(m, sec); li.append(dot, txt);
        if (it.n > 1) { const c = document.createElement('span'); c.className = 'tac-n'; c.textContent = '×' + it.n; c.title = `Used ${it.n} times`; li.append(c); }
        li.addEventListener('pointerdown', e => e.preventDefault()); // keep focus (and the keyboard) on the title field
        li.addEventListener('click', () => pick(i));
        list.append(li);
      });
    }
    function update() {
      const q = input.value;
      if (!opt.enabled() || norm(q) === picked) { close(); return; }
      items = suggest(index, q);
      if (!items.length) { close(); return; }
      sel = -1; render(q); open();
    }
    function highlight(i) {
      sel = i;
      [...list.children].forEach((li, j) => li.setAttribute('aria-selected', String(j === i)));
      if (i >= 0) { input.setAttribute('aria-activedescendant', 'tac-opt-' + i); list.children[i].scrollIntoView({ block: 'nearest' }); }
      else input.removeAttribute('aria-activedescendant');
    }
    function pick(i) {
      const it = items[i]; if (!it) return;
      picked = norm(it.title); input.value = it.title; close();
      try { opt.apply(it); } catch (e) { console.error(e); }
      input.focus();
      try { input.setSelectionRange(input.value.length, input.value.length); } catch (_) {}
    }
    input.setAttribute('role', 'combobox'); input.setAttribute('aria-autocomplete', 'list'); input.setAttribute('aria-expanded', 'false');
    input.setAttribute('aria-controls', list.id || (list.id = 'titleAcList'));
    input.addEventListener('input', () => { picked = ''; update(); });
    input.addEventListener('keydown', e => {
      if (!isOpen()) return;
      if (e.key === 'ArrowDown') { e.preventDefault(); highlight((sel + 1) % items.length); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); highlight(sel <= 0 ? items.length - 1 : sel - 1); }
      else if (e.key === 'Enter' && sel >= 0) { e.preventDefault(); e.stopPropagation(); pick(sel); }
      else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); escAt = Date.now(); }
      else if (e.key === 'Tab') close();
    });
    let escAt = 0;
    const dlg = input.closest('dialog');
    if (dlg) dlg.addEventListener('cancel', e => { if (isOpen() || Date.now() - escAt < 300) { e.preventDefault(); close(); } }); // Escape closes the list, not the editor
    // iOS doesn't blur on a tap elsewhere: close on any press outside the field + list
    document.addEventListener('pointerdown', e => { if (isOpen() && !wrap.contains(e.target)) close(); }, true);
    input.addEventListener('blur', () => setTimeout(() => { if (document.activeElement !== input) close(); }, 150));
    if (window.visualViewport) visualViewport.addEventListener('resize', () => { if (isOpen()) place(); });
    api = {
      refresh, close, isOpen,
      reset() { picked = ''; items = []; clearTimeout(hideT); pop.hidden = true; pop.classList.remove('tac-leaving'); input.setAttribute('aria-expanded', 'false'); },
      get items() { return items.slice(); }, get index() { return index.slice(); },
    };
    return api;
  }
  if (typeof window !== 'undefined') window.SandyTitleAC = { attach, buildIndex, suggest, norm, close: () => api && api.close(), isOpen: () => !!(api && api.isOpen()) };
  if (typeof module !== 'undefined') module.exports = { buildIndex, suggest, norm };
})();
