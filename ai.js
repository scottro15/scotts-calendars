/* ai.js — SANDY AI assistant (Phase 1): chat sheet, mic, "Brief me", confirm cards.
 * The model runs server-side in the Supabase Edge Function "ai-assistant" (the API key never reaches the browser).
 * The function only PROPOSES changes; this file applies a change only after the user taps Confirm,
 * through Store (the user's own session, under RLS). "Brief me" is computed on-device (free, instant). */
(function () {
  'use strict';
  const cfg = window.CALENDAR_CONFIG || {};
  const ENDPOINT = cfg.AI_ENDPOINT || (cfg.SUPABASE_URL ? cfg.SUPABASE_URL.replace(/\/$/, '') + '/functions/v1/ai-assistant' : '');
  const isRef = e => /christian\s+dake/i.test(`${e.title || ''}`); // reference only: never a conflict
  const DAY = 86400000;
  let A, history = [], busy = false;

  function whenReady(fn) { if (window.__app) fn(); else setTimeout(() => whenReady(fn), 50); }
  whenReady(init);

  const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const t12 = d => { let h = d.getUTCHours(); const m = d.getUTCMinutes(); const ap = h >= 12 ? 'PM' : 'AM'; h = h % 12 || 12; return m ? `${h}:${String(m).padStart(2, '0')} ${ap}` : `${h} ${ap}`; };
  const fmtDay = k => A.parseLocal(k).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' });
  const fmtWhen = s => { if (!s) return ''; const d = A.parseLocal(s); return s.length > 10 ? `${fmtDay(s.slice(0, 10))}, ${t12(d)}` : fmtDay(s); };
  const calName = id => { const c = A.calendars().find(x => x.id === id); return c ? (c.short || c.name) : id; };
  const startOfDay = d => new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));

  function init() {
    A = window.__app;
    const sheet = document.createElement('div');
    sheet.id = 'aiSheet'; sheet.className = 'ai-sheet'; sheet.hidden = true;
    sheet.setAttribute('role', 'dialog'); sheet.setAttribute('aria-label', 'Sandy Intelligence');
    sheet.innerHTML = `
      <div class="ai-backdrop" data-close></div>
      <div class="ai-panel">
        <div class="ai-head"><strong><span class="ai-spark" aria-hidden="true">✨</span> <span class="ai-title">Sandy Intelligence</span></strong><button type="button" class="ai-x" data-close aria-label="Close">✕</button></div>
        <div class="ai-quick"><button type="button" id="aiBrief">☀️ Brief me</button></div>
        <div class="ai-log" id="aiLog" aria-live="polite"></div>
        <form class="ai-input" id="aiForm" autocomplete="off">
          <textarea id="aiText" rows="1" placeholder="Ask or tell me… e.g. “Add film with Nick tomorrow 4pm”" enterkeyhint="send"></textarea>
          <button type="button" id="aiMic" class="ai-mic" aria-label="Speak" hidden>🎤</button>
          <button type="submit" id="aiSend" class="primary">Send</button>
        </form>
      </div>`;
    document.body.appendChild(sheet);
    const btn = document.getElementById('aiBtn');
    if (btn) btn.addEventListener('click', open);
    sheet.querySelectorAll('[data-close]').forEach(el => el.addEventListener('click', close));
    document.addEventListener('keydown', e => { if (e.key === 'Escape' && !sheet.hidden) close(); });
    document.getElementById('aiBrief').addEventListener('click', () => { addMsg('user', 'Brief me'); addMsg('assistant', null, briefHtml()); });
    const ta = document.getElementById('aiText');
    ta.addEventListener('input', () => { ta.style.height = 'auto'; ta.style.height = Math.min(ta.scrollHeight, 120) + 'px'; });
    ta.addEventListener('keydown', e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } });
    document.getElementById('aiForm').addEventListener('submit', e => { e.preventDefault(); send(); });
    setupMic(ta);
    window.SandyAI = { open, close, briefHtml, buildContext, applyProposal, briefData };
  }
  function open() {
    const s = document.getElementById('aiSheet'); closeTok++; s.classList.remove('ai-closing', 'ai-anim'); s.hidden = false; void s.offsetWidth; s.classList.add('ai-anim'); document.body.classList.add('ai-open');
    if (!document.getElementById('aiLog').children.length) addMsg('assistant', 'Hi, I’m Sandy Intelligence! Tell me what to add, move or check off, or tap “Brief me”. I’ll show each change for you to confirm first.');
  }
  let closeTok = 0;
  function close() {
    const s = document.getElementById('aiSheet'); if (s.hidden || s.classList.contains('ai-closing')) return;
    stopMic(); const tok = ++closeTok;
    const fin = () => { if (tok !== closeTok) return; s.hidden = true; s.classList.remove('ai-closing'); document.body.classList.remove('ai-open'); };
    s.classList.remove('ai-anim');
    if (window.Motion && Motion.reduced()) { fin(); return; }
    s.classList.add('ai-closing'); setTimeout(fin, 280); // exit animation is 260ms
  }

  function addMsg(role, text, html) {
    const log = document.getElementById('aiLog');
    const d = document.createElement('div'); d.className = 'ai-msg ' + role;
    if (html != null) d.innerHTML = html; else d.textContent = text;
    log.appendChild(d); log.scrollTop = log.scrollHeight; return d;
  }

  // ---------- context for the model: the user's own expanded occurrences (today −14 … +45 days) ----------
  async function buildContext() {
    const now = A.nowWall(); const today = startOfDay(now);
    const rs = new Date(today.getTime() - 14 * DAY), re = new Date(today.getTime() + 46 * DAY);
    const events = [];
    for (const ev of await A.Store.list()) {
      for (const o of A.occurrences(ev, rs, re)) {
        const r = { id: ev.id, occ: o.key, title: ev.title, calendar: ev.calendar, category: ev.category, kind: ev.kind || 'event',
          start: ev.allDay ? o.key : `${o.key}T${A.hm(o.start)}`, end: ev.allDay ? A.ymd(new Date(o.end.getTime() - DAY)) : `${A.ymd(o.end)}T${A.hm(o.end)}`, allDay: !!ev.allDay };
        if (A.isRecurring(ev)) r.recurring = true;
        if (ev.kind === 'task') r.done = A.isDone(ev, o.key);
        if (ev.location) r.location = ev.location;
        if (isRef(ev)) r.referenceOnly = true;
        if (ev.allDay && r.end !== o.key) r.endDay = r.end;
        events.push(r);
      }
    }
    events.sort((a, b) => a.start < b.start ? -1 : 1);
    return { today: A.ymd(today), now: `${A.ymd(now)} ${t12(now)}`, calendars: A.calendars().map(c => ({ id: c.id, name: c.name })), events };
  }

  async function token() {
    try { const c = A.Store.adapter && A.Store.adapter.client; if (!c) return ''; const { data } = await c.auth.getSession(); return data.session ? data.session.access_token : ''; } catch (e) { return ''; }
  }

  async function send() {
    const ta = document.getElementById('aiText'); const text = ta.value.trim();
    if (!text || busy) return;
    stopMic(); ta.value = ''; ta.style.height = 'auto';
    addMsg('user', text); history.push({ role: 'user', content: text });
    if (!ENDPOINT) { addMsg('assistant', 'The assistant needs the online (signed-in) version of SANDY.'); return; }
    busy = true; const wait = addMsg('assistant thinking', 'Thinking…'); document.getElementById('aiSend').disabled = true;
    try {
      const tok = await token();
      const res = await fetch(ENDPOINT, { method: 'POST', headers: { 'content-type': 'application/json', ...(tok ? { authorization: 'Bearer ' + tok } : {}), ...(cfg.SUPABASE_ANON_KEY ? { apikey: cfg.SUPABASE_ANON_KEY } : {}) },
        body: JSON.stringify({ messages: history, context: await buildContext() }) });
      const data = await res.json().catch(() => ({}));
      wait.remove();
      if (!res.ok) { addMsg('assistant error', data.error || (res.status === 404 ? 'The assistant isn’t switched on yet. “Brief me” works now.' : `Something went wrong (${res.status}).`)); history.pop(); return; }
      addMsg('assistant', data.reply); history.push({ role: 'assistant', content: data.reply });
      for (const p of data.proposals || []) renderProposal(p);
    } catch (e) { wait.remove(); addMsg('assistant error', 'Could not reach the assistant. Check your connection and try again.'); history.pop(); }
    finally { busy = false; document.getElementById('aiSend').disabled = false; }
  }

  // ---------- confirm cards ----------
  const VERB = { add: 'Add', edit: 'Change', delete: 'Delete', check: 'Check off' };
  async function describe(p) {
    const ev = p.id ? await A.Store.get(p.id) : null;
    const rows = [];
    if (p.type === 'add') { rows.push(['What', p.title], ['Calendar', calName(p.calendar)], ['When', fmtWhen(p.start) + (p.end && !p.allDay && p.end.length > 10 ? ` – ${t12(A.parseLocal(p.end))}` : '')]); if (p.repeat && p.repeat.freq && p.repeat.freq !== 'none') rows.push(['Repeats', p.repeat.freq]); if (p.location) rows.push(['Where', p.location]); }
    else {
      rows.push(['Item', ev ? ev.title : '(not found)'], ['Date', p.occurrence ? fmtDay(p.occurrence) : '']);
      if (p.type === 'edit') for (const [k, v] of Object.entries(p.changes || {})) rows.push([k === 'start' ? 'New start' : k === 'end' ? 'New end' : k, (k === 'start' || k === 'end') ? fmtWhen(v) : (k === 'calendar' ? calName(v) : String(v))]);
      if (p.type === 'check' && p.done === false) rows[0][0] = 'Un-check';
      if (ev && A.isRecurring(ev) && p.type !== 'check') rows.push(['Applies to', p.scope === 'all' ? 'All repeats' : 'Just this day']);
    }
    return { ev, rows };
  }
  async function renderProposal(p) {
    const { ev, rows } = await describe(p);
    const card = addMsg('assistant card', null, `<div class="ai-card-from">✨ Sandy Intelligence suggests</div><div class="ai-card-title">${esc(p.summary || VERB[p.type] || p.type)}</div>
      <dl>${rows.map(([k, v]) => `<dt>${esc(k)}</dt><dd>${esc(v)}</dd>`).join('')}</dl>
      <div class="ai-card-btns"><button type="button" class="primary" data-ok>Confirm</button><button type="button" data-no>Cancel</button></div>`);
    card.classList.add('ai-card');
    const ok = card.querySelector('[data-ok]'), no = card.querySelector('[data-no]');
    if (p.type !== 'add' && !ev) { ok.disabled = true; }
    const done = msg => { card.querySelector('.ai-card-btns').innerHTML = `<span class="ai-card-status">${esc(msg)}</span>`; };
    no.addEventListener('click', () => { done('Cancelled'); history.push({ role: 'user', content: `(I cancelled: ${p.summary || p.type})` }); });
    ok.addEventListener('click', async () => {
      ok.disabled = no.disabled = true;
      try { await applyProposal(p); done('✓ Saved'); history.push({ role: 'user', content: `(I confirmed: ${p.summary || p.type})` }); A.refresh(); }
      catch (e) { console.error(e); ok.disabled = no.disabled = false; A.toast('Could not save: ' + (e.message || e), 4000); }
    });
  }

  const pick = (o, keys) => Object.fromEntries(keys.filter(k => o[k] !== undefined).map(k => [k, o[k]]));
  const FIELDS = ['title', 'calendar', 'category', 'allDay', 'start', 'end', 'location', 'notes'];
  async function applyProposal(p) {
    const S = A.Store;
    if (p.type === 'add') {
      const task = p.kind === 'task'; const allDay = p.allDay != null ? !!p.allDay : (task || String(p.start).length <= 10);
      const start = allDay ? String(p.start).slice(0, 10) : p.start;
      let end = p.end || (allDay ? start : null);
      if (!allDay && !end) { const d = new Date(A.parseLocal(start).getTime() + 3600000); end = `${A.ymd(d)}T${A.hm(d)}`; }
      if (allDay) end = String(end).slice(0, 10);
      const cal = A.calendars().some(c => c.id === p.calendar) ? p.calendar : A.calendars()[0].id;
      const rp = p.repeat && p.repeat.freq && p.repeat.freq !== 'none' ? { freq: p.repeat.freq, interval: 1, ...(p.repeat.byWeekday ? { byWeekday: p.repeat.byWeekday } : {}), ...(p.repeat.until ? { until: p.repeat.until } : {}) } : { freq: 'none' };
      const ev = { kind: task ? 'task' : 'event', calendar: cal, category: p.category || (task ? 'Task / to-do' : 'Other'), title: p.title, allDay, start, end,
        location: p.location || '', notes: p.notes || '', recurrence: rp };
      if (task) Object.assign(ev, { scope: 'day', done: false, completedDates: [] });
      return S.save(ev);
    }
    const ev = await S.get(p.id); if (!ev) throw new Error('That item no longer exists');
    const rec = A.isRecurring(ev); const occ = p.occurrence || String(ev.start).slice(0, 10);
    if (p.type === 'check') {
      if (rec) { const set = new Set(ev.completedDates || []); p.done !== false ? set.add(occ) : set.delete(occ); ev.completedDates = [...set]; }
      else ev.done = p.done !== false;
      return S.save(ev);
    }
    if (p.type === 'delete') {
      if (rec && p.scope !== 'all') { ev.exdates = [...new Set([...(ev.exdates || []), occ])]; return S.save(ev); }
      return S.remove(ev.id);
    }
    if (p.type === 'edit') {
      const ch = pick(p.changes || {}, FIELDS);
      if (rec && p.scope !== 'all') { const [parent, ex] = A.detachOccurrence(ev, occ, ch); return S.saveMany([parent, ex]); }
      if (rec) { // whole series: keep the series' start date, take the new times
        for (const k of ['start', 'end']) if (ch[k] && ch[k].length > 10 && ev[k]) ch[k] = String(ev[k]).slice(0, 10) + ch[k].slice(10);
      }
      return S.save({ ...ev, ...ch });
    }
    throw new Error('Unknown change');
  }

  // ---------- Brief me (on-device) ----------
  async function briefData() {
    const now = A.nowWall(); const today = startOfDay(now); const tk = A.ymd(today);
    const all = await A.Store.list();
    const todays = [];
    for (const ev of all) for (const o of A.occurrences(ev, today, new Date(today.getTime() + DAY))) todays.push({ ev, o });
    todays.sort((a, b) => (b.ev.allDay - a.ev.allDay) || (a.o.start - b.o.start));
    const overdue = [];
    for (const ev of all) {
      if (ev.kind !== 'task') continue;
      const occ = A.occurrences(ev, new Date(today.getTime() - 90 * DAY), today).filter(o => o.key < tk && !A.isDone(ev, o.key));
      if (occ.length) overdue.push({ ev, o: occ[occ.length - 1] }); // repeating: only the latest miss
    }
    overdue.sort((a, b) => a.o.start - b.o.start);
    const timed = todays.filter(x => !x.ev.allDay && x.ev.kind !== 'task' && !isRef(x.ev));
    const overlaps = [];
    for (let i = 0; i < timed.length; i++) for (let j = i + 1; j < timed.length; j++) {
      const a = timed[i], b = timed[j]; if (a.o.start < b.o.end && b.o.start < a.o.end) overlaps.push([a, b]);
    }
    return { today: tk, todays, overdue, overlaps };
  }
  // "Brief me" renders asynchronously into its bubble.
  function briefHtml() { setTimeout(renderBrief, 0); return '<em>Putting your brief together…</em>'; }
  async function renderBrief() {
    const log = document.getElementById('aiLog'); const bubble = log.lastElementChild;
    const { todays, overdue, overlaps } = await briefData();
    const when = x => x.ev.allDay ? 'All day' : `${t12(x.o.start)}–${t12(x.o.end)}`;
    const li = x => `<li><span class="ai-dot" style="background:${esc((A.calendars().find(c => c.id === x.ev.calendar) || {}).color || '#666')}"></span>${esc(when(x))}: ${esc(x.ev.title)}${isRef(x.ev) ? ' <small>(reference)</small>' : ''}${x.ev.kind === 'task' && A.isDone(x.ev, x.o.key) ? ' ✓' : ''}</li>`;
    let h = `<div class="ai-brief"><strong>Today, ${esc(fmtDay(A.ymd(A.nowWall())))}</strong>`;
    h += todays.length ? `<ul>${todays.map(li).join('')}</ul>` : '<p>Nothing on the calendar today.</p>';
    h += `<strong>Overdue to-dos</strong>` + (overdue.length ? `<ul>${overdue.map(x => `<li>${esc(x.ev.title)} <small>· due ${esc(fmtDay(x.o.key))}</small></li>`).join('')}</ul>` : '<p>None. Nice!</p>');
    h += `<strong>Overlaps</strong>` + (overlaps.length ? `<ul>${overlaps.map(([a, b]) => `<li>${esc(a.ev.title)} (${esc(when(a))}) overlaps ${esc(b.ev.title)} (${esc(when(b))})</li>`).join('')}</ul>` : '<p>No overlaps today.</p>');
    bubble.innerHTML = h + '</div>'; log.scrollTop = log.scrollHeight;
  }

  // ---------- mic (Web Speech API where available; otherwise the keyboard's dictation key works) ----------
  let rec = null;
  function setupMic(ta) {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition; const mic = document.getElementById('aiMic');
    if (!SR) return; mic.hidden = false;
    mic.addEventListener('click', () => {
      if (rec) { stopMic(); return; }
      rec = new SR(); rec.lang = 'en-US'; rec.interimResults = true; rec.continuous = false;
      const base = ta.value ? ta.value.trim() + ' ' : '';
      rec.onresult = e => { ta.value = base + [...e.results].map(r => r[0].transcript).join(''); ta.dispatchEvent(new Event('input')); };
      rec.onend = () => { rec = null; mic.classList.remove('on'); };
      rec.onerror = () => { rec = null; mic.classList.remove('on'); };
      mic.classList.add('on'); try { rec.start(); } catch (e) { rec = null; mic.classList.remove('on'); }
    });
  }
  function stopMic() { if (rec) { try { rec.stop(); } catch (e) { } rec = null; } const m = document.getElementById('aiMic'); if (m) m.classList.remove('on'); }
})();
