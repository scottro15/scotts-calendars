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

  const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const t12fixed = d => { let h = d.getUTCHours(); const m = d.getUTCMinutes(); const ap = h >= 12 ? 'PM' : 'AM'; h = h % 12 || 12; return m ? `${h}:${String(m).padStart(2, '0')} ${ap}` : `${h} ${ap}`; };
  const t12 = d => (window.SandyTime ? SandyTime.fmt(d, { compact: true }) : t12fixed(d)); // follows Profile → Time format
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
        <div class="ai-quick"><button type="button" id="aiBrief">☀️ Brief me</button><span class="ai-quick-gap"></span><button type="button" id="aiHist" aria-expanded="false" aria-controls="aiHistPanel">🕘 History</button><button type="button" id="aiNew">＋ New chat</button></div>
        <div class="ai-body">
          <div class="ai-log" id="aiLog" aria-live="polite"></div>
          <div class="ai-hist" id="aiHistPanel" hidden role="region" aria-label="Chat history"></div>
        </div>
        <form class="ai-input" id="aiForm" autocomplete="off">
          <textarea id="aiText" name="ai-prompt" rows="1" placeholder="Ask or tell me… e.g. “Add film with Nick tomorrow 4pm”" autocomplete="off" autocapitalize="sentences" spellcheck="true" enterkeyhint="send"></textarea>
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
    ta.addEventListener('input', fitAiText);
    window.addEventListener('resize', () => { if (!sheet.hidden) fitAiText(); });
    // refit when the box's width settles (sheet layout, mic button, web font) — width changes only, so no loop
    if (window.ResizeObserver) { let lastW = 0; new ResizeObserver(([e]) => { const w = Math.round(e.contentRect.width); if (w && w !== lastW) { lastW = w; fitAiText(); } }).observe(ta); }
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(() => { if (!sheet.hidden) fitAiText(); });
    ta.addEventListener('keydown', e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } });
    document.getElementById('aiForm').addEventListener('submit', e => { e.preventDefault(); send(); });
    setupMic(ta);
    document.getElementById('aiNew').addEventListener('click', newChat);
    document.getElementById('aiHist').addEventListener('click', () => (document.getElementById('aiHistPanel').hidden ? showHistory() : hideHistory()));
    window.SandyAI = { open, close, briefHtml, buildContext, applyProposal, renderProposal, seriesPlan, briefData, Chats, newChat, openChat, showHistory, hideHistory, current: () => ({ id: chatId, title: chatTitle, history: history.slice() }) };
  }
  // The message box (t148u item 3): text and placeholder always sit fully inside it. Grows with the text
  // (border included: the old code set height = scrollHeight under border-box, clipping 2px and the last
  // line's padding) up to its CSS max-height (5 lines), then scrolls. The example placeholder is only used
  // when it fits on one line; narrower phones get a shorter one instead of a clipped second line.
  const AI_PH = ['Ask or tell me… e.g. “Add film with Nick tomorrow 4pm”', 'Ask or tell me anything…', 'Ask or tell me…'];
  function fitAiText() {
    const ta = document.getElementById('aiText'); if (!ta || !ta.offsetParent) return;
    ta.style.height = 'auto'; ta.style.overflowY = 'hidden';
    if (!ta.value) {
      // measure by width: WebKit leaves placeholder overflow out of scrollHeight
      const cs = getComputedStyle(ta), cx = (fitAiText.cx ||= document.createElement('canvas').getContext('2d'));
      cx.font = `${cs.fontStyle} ${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`;
      const room = ta.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight) - 2;
      ta.placeholder = AI_PH.find(ph => cx.measureText(ph).width <= room) || AI_PH[AI_PH.length - 1];
    }
    const max = parseFloat(getComputedStyle(ta).maxHeight) || 140;
    const want = ta.scrollHeight + (ta.offsetHeight - ta.clientHeight);
    ta.style.height = Math.min(want, max) + 'px';
    ta.style.overflowY = want > max + 1 ? 'auto' : 'hidden';
    ta.classList.toggle('ai-multi', want > parseFloat(getComputedStyle(ta).minHeight) + 4);
    if (want > max && document.activeElement === ta && ta.selectionEnd === ta.value.length) ta.scrollTop = ta.scrollHeight;
  }
  function open() {
    const s = document.getElementById('aiSheet'); closeTok++; s.classList.remove('ai-closing', 'ai-anim'); s.hidden = false; void s.offsetWidth; s.classList.add('ai-anim'); document.body.classList.add('ai-open');
    if (!document.getElementById('aiLog').children.length) greet(); requestAnimationFrame(fitAiText); setTimeout(fitAiText, 420); // again once the open animation has settled
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

  const greet = () => addMsg('assistant', 'Hi, I’m Sandy Intelligence! Tell me what to add, move or check off, or tap “Brief me”. I’ll show each change for you to confirm first.');
  function addMsg(role, text, html, still) {
    const log = document.getElementById('aiLog');
    const d = document.createElement('div'); d.className = 'ai-msg ' + role;
    if (html != null) d.innerHTML = html; else d.textContent = text;
    if (still) { log.appendChild(d); return d; }
    d.classList.add('msg-in'); d.addEventListener('animationend', () => d.classList.remove('msg-in'), { once: true });
    log.appendChild(d); scrollLog(); return d;
  }
  function scrollLog() {
    const log = document.getElementById('aiLog'); const reduce = window.Motion && Motion.reduced();
    requestAnimationFrame(() => log.scrollTo({ top: log.scrollHeight, behavior: reduce ? 'auto' : 'smooth' }));
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
        if (ev.seriesId) { r.changedOccurrenceOf = ev.seriesId; r.originalDate = ev.originalDate; }
        events.push(r);
      }
    }
    events.sort((a, b) => a.start < b.start ? -1 : 1);
    // repeating series (t166u): the model edits these with propose_series_change
    const all = await A.Store.list(); const tk = A.ymd(today);
    const series = all.filter(ev => A.isRecurring(ev) && !(ev.recurrence.until && ev.recurrence.until < A.ymd(rs))).slice(0, 80).map(ev => {
      const r = ev.recurrence, b = A.parseLocal(ev.start);
      const o = { id: ev.id, title: ev.title, calendar: ev.calendar, category: ev.category, rule: ruleText(ev), firstDate: String(ev.start).slice(0, 10) };
      if (!ev.allDay) { const e = new Date(b.getTime() + seriesLen(ev)); o.time = `${t12fixed(b)}–${t12fixed(e)}`; } else o.allDay = true;
      if (r.until) o.until = r.until;
      if (ev.location) o.location = ev.location;
      const sk = (ev.exdates || []).filter(d => d >= A.ymd(rs)); if (sk.length) o.skippedOrChanged = sk.slice(0, 20);
      const nx = A.occurrences(ev, today, new Date(today.getTime() + 120 * DAY)).slice(0, 6).map(x => x.key); if (nx.length) o.nextDates = nx;
      return o;
    });
    return { timeZone: A.timeZone ? A.timeZone() : 'America/Chicago', today: tk, now: `${A.ymd(now)} ${t12fixed(now)}`, calendars: A.calendars().map(c => ({ id: c.id, name: c.name })), events, series };
  }

  const WD = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'], WDL = ['Sundays', 'Mondays', 'Tuesdays', 'Wednesdays', 'Thursdays', 'Fridays', 'Saturdays'];
  const seriesLen = ev => { const d = A.parseLocal(ev.end || ev.start) - A.parseLocal(ev.start); return d > 0 ? d : 3600000; };
  function ruleText(ev) {
    const r = ev.recurrence || {}; const n = +r.interval || 1; const b = A.parseLocal(ev.start);
    if (r.freq === 'weekly') { const ds = (r.byWeekday && r.byWeekday.length ? r.byWeekday : [b.getUTCDay()]).map(Number).sort(); const names = ds.length === 1 ? WDL[ds[0]] : ds.map(d => WD[d]).join(', '); return n > 1 ? `every ${n} weeks on ${names}` : names.replace(/^./, c => c.toUpperCase()); }
    if (r.freq === 'daily') return n > 1 ? `every ${n} days` : 'Every day';
    if (r.freq === 'monthly') return `${n > 1 ? `Every ${n} months` : 'Monthly'} on day ${b.getUTCDate()}`;
    if (r.freq === 'yearly') return 'Every year';
    return 'One time';
  }
  const whenText = ev => { const b = A.parseLocal(ev.start); if (ev.allDay) return ruleText(ev) + ', all day'; return `${ruleText(ev)}, ${t12(b)}–${t12(new Date(b.getTime() + seriesLen(ev)))}`; };

  async function token() {
    try { const c = A.Store.adapter && A.Store.adapter.client; if (!c) return ''; const { data } = await c.auth.getSession(); return data.session ? data.session.access_token : ''; } catch (e) { return ''; }
  }

  async function send() {
    const ta = document.getElementById('aiText'); const text = ta.value.trim();
    if (!text || busy) return;
    stopMic(); ta.value = ''; fitAiText();
    hideHistory(); addMsg('user', text); history.push({ role: 'user', content: text }); persist();
    if (!ENDPOINT) { addMsg('assistant', 'The assistant needs the online (signed-in) version of SANDY.'); return; }
    busy = true; setChatBtns(); const wait = addMsg('assistant thinking typing', null, '<span class="dot"></span><span class="dot"></span><span class="dot"></span>'); wait.setAttribute('aria-label', 'Sandy Intelligence is typing'); document.getElementById('aiSend').disabled = true;
    try {
      const tok = await token();
      const res = await fetch(ENDPOINT, { method: 'POST', headers: { 'content-type': 'application/json', ...(tok ? { authorization: 'Bearer ' + tok } : {}), ...(cfg.SUPABASE_ANON_KEY ? { apikey: cfg.SUPABASE_ANON_KEY } : {}) },
        body: JSON.stringify({ messages: history.map(m => ({ role: m.role, content: m.content })), context: await buildContext() }) });
      const data = await res.json().catch(() => ({}));
      wait.remove();
      if (!res.ok) { addMsg('assistant error', data.error || (res.status === 404 ? 'The assistant isn’t switched on yet. “Brief me” works now.' : `Something went wrong (${res.status}).`)); history.pop(); persist(); return; }
      addMsg('assistant', data.reply); history.push({ role: 'assistant', content: data.reply }); persist();
      (data.proposals || []).forEach((p, i) => setTimeout(() => renderProposal(p), (window.Motion && Motion.reduced()) ? 0 : 120 * (i + 1)));
    } catch (e) { console.error(e); wait.remove(); addMsg('assistant error', 'Could not reach the assistant. Check your connection and try again.'); history.pop(); persist(); }
    finally { busy = false; document.getElementById('aiSend').disabled = false; setChatBtns(); }
  }


  // ---------- chat history (SI E): saved conversations + New chat. Pure storage: never calls the AI. ----------
  // Signed in: Supabase table ai_chats (owner-only RLS, migration-2026-10-25-ai-chats.sql). Until that migration is
  // applied, or in the local (not signed-in) version, chats are kept on this device (localStorage, per account).
  let chatId = null, chatTitle = '', chatCreated = null, saveTimer = null, saveChain = Promise.resolve();
  const CHAT_LS = 'sandy.aiChats.v1', MAX_CHATS = 50, MAX_MSGS = 400;
  const newId = () => (crypto.randomUUID ? crypto.randomUUID() : 'c' + Date.now() + Math.random().toString(16).slice(2));
  const missingTable = e => e && (e.code === 'PGRST205' || e.code === '42P01' || /could not find the table|does not exist|schema cache/i.test(e.message || ''));
  const titleOf = msgs => { const m = msgs.find(x => x.role === 'user' && !x.note && x.content.trim()); if (!m) return 'New chat'; const t = m.content.replace(/\s+/g, ' ').trim(); return t.length > 60 ? t.slice(0, 59).trimEnd() + '…' : t; };
  const clean = msgs => (Array.isArray(msgs) ? msgs : []).filter(m => m && (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string')
    .slice(-MAX_MSGS).map(m => ({ role: m.role, content: m.content.slice(0, 8000), ...(m.note ? { note: 1 } : {}) }));
  const Chats = {
    remote: true, // false once we learn the ai_chats table isn't there yet
    sb() { const S = A.Store; return S.mode !== 'local' && S.adapter && S.adapter.client || null; },
    async lsKey() { // one list per signed-in account, so a shared phone never mixes people's chats
      const sb = this.sb(); if (!sb) return CHAT_LS;
      try { const { data } = await sb.auth.getSession(); const u = data && data.session && data.session.user; return u ? CHAT_LS + '.' + u.id : CHAT_LS; } catch (e) { return CHAT_LS; }
    },
    async readLocal() { try { const v = JSON.parse(localStorage.getItem(await this.lsKey())); return Array.isArray(v) ? v : []; } catch (e) { return []; } },
    async writeLocal(all) { all.sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1)); localStorage.setItem(await this.lsKey(), JSON.stringify(all.slice(0, MAX_CHATS))); },
    where() { return this.sb() && this.remote ? 'account' : 'device'; },
    async useRemote(fn) { // run fn(sb) against ai_chats; null = fall back to the device
      const sb = this.sb(); if (!sb || !this.remote) return null;
      const r = await fn(sb.from('ai_chats'));
      if (r.error) { if (missingTable(r.error)) { this.remote = false; return null; } throw new Error(r.error.message || 'Could not reach your chat history'); }
      return r;
    },
    async list() {
      const r = await this.useRemote(t => t.select('id,title,created_at,updated_at').order('updated_at', { ascending: false }).limit(MAX_CHATS));
      if (r) return r.data.map(x => ({ id: x.id, title: x.title, createdAt: x.created_at, updatedAt: x.updated_at }));
      return (await this.readLocal()).map(({ id, title, createdAt, updatedAt, messages }) => ({ id, title, createdAt, updatedAt, count: (messages || []).length }));
    },
    async get(id) {
      const r = await this.useRemote(t => t.select('id,title,messages,created_at,updated_at').eq('id', id).maybeSingle());
      if (r) return r.data ? { id: r.data.id, title: r.data.title, messages: clean(r.data.messages), createdAt: r.data.created_at, updatedAt: r.data.updated_at } : null;
      const c = (await this.readLocal()).find(x => x.id === id); return c ? { ...c, messages: clean(c.messages) } : null;
    },
    async save(c) {
      const now = new Date().toISOString(); const row = { id: c.id, title: c.title, messages: clean(c.messages), updated_at: now };
      const r = await this.useRemote(t => t.upsert(row).select('id'));
      if (r) return;
      const all = (await this.readLocal()).filter(x => x.id !== c.id);
      all.push({ id: c.id, title: row.title, messages: row.messages, createdAt: c.createdAt || now, updatedAt: now }); await this.writeLocal(all);
    },
    async remove(id) {
      const r = await this.useRemote(t => t.delete().eq('id', id));
      if (r) return;
      await this.writeLocal((await this.readLocal()).filter(x => x.id !== id));
    },
  };
  // Save the open conversation (debounced; saves run one at a time, in order).
  function persist(now) {
    if (!history.some(m => m.role === 'user' && !m.note)) { // nothing worth keeping (e.g. the first message failed to send)
      if (chatId) { const id = chatId; clearTimeout(saveTimer); saveTimer = null; chatId = null; chatCreated = null; saveChain = saveChain.then(() => Chats.remove(id)).catch(() => {}); }
      return saveChain;
    }
    if (!chatId) { chatId = newId(); chatCreated = new Date().toISOString(); }
    chatTitle = titleOf(history);
    const snap = { id: chatId, title: chatTitle, messages: history.slice(), createdAt: chatCreated };
    clearTimeout(saveTimer);
    const run = () => (saveTimer = null, saveChain = saveChain.then(() => Chats.save(snap)).catch(e => { console.warn('chat history', e); A.toast && A.toast('Couldn’t save this chat: ' + (e.message || e), 3500); }));
    if (now) return run();
    saveTimer = setTimeout(run, 250); return saveChain;
  }
  function setChatBtns() { for (const id of ['aiNew', 'aiHist']) { const b = document.getElementById(id); if (b) b.disabled = busy; } document.querySelectorAll('#aiHistPanel button').forEach(b => { b.disabled = busy; }); }
  async function newChat() {
    if (busy) return;
    if (saveTimer) { clearTimeout(saveTimer); saveTimer = null; await persist(true); }
    stopMic(); hideHistory(); chatId = null; chatTitle = ''; chatCreated = null; history = [];
    document.getElementById('aiLog').innerHTML = ''; greet();
    const ta = document.getElementById('aiText'); ta.value = ''; fitAiText(); ta.focus({ preventScroll: true });
  }
  async function openChat(id) {
    if (busy) return;
    if (saveTimer) { clearTimeout(saveTimer); saveTimer = null; await persist(true); }
    let c; try { c = await Chats.get(id); } catch (e) { A.toast && A.toast(e.message || String(e), 3500); return; }
    if (!c) { A.toast && A.toast('That chat was deleted.', 3000); showHistory(); return; }
    stopMic(); chatId = c.id; chatTitle = c.title; chatCreated = c.createdAt || null; history = c.messages.slice();
    const log = document.getElementById('aiLog'); log.innerHTML = '';
    addMsg('ai-resumed', null, `<span>${esc(c.title)}</span> · ${esc(whenLabel(c.updatedAt))}`, true);
    for (const m of history) addMsg(m.note ? 'note' : m.role, m.note ? m.content.replace(/^\(|\)$/g, '') : m.content, null, true);
    hideHistory(); log.scrollTop = log.scrollHeight;
  }
  const whenLabel = iso => {
    const d = new Date(iso); if (isNaN(d)) return '';
    const tz = (A.timeZone && A.timeZone()) || undefined; const day = x => x.toLocaleDateString('en-CA', { timeZone: tz });
    const now = new Date(); const t = window.SandyTime ? SandyTime.fmtIn(d, tz || 'America/Chicago') : d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: tz });
    if (day(d) === day(now)) return 'Today ' + t;
    if (day(d) === day(new Date(now.getTime() - DAY))) return 'Yesterday ' + t;
    return d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', ...(d.getFullYear() !== now.getFullYear() ? { year: 'numeric' } : {}), timeZone: tz });
  };
  let histTok = 0;
  async function showHistory() {
    if (busy) return;
    const panel = document.getElementById('aiHistPanel'); const tok = ++histTok;
    panel.hidden = false; document.getElementById('aiHist').setAttribute('aria-expanded', 'true'); document.getElementById('aiHist').classList.add('on');
    panel.innerHTML = '<p class="ai-hist-msg ai-hist-loading">Loading your chats…</p>';
    if (saveTimer) { clearTimeout(saveTimer); saveTimer = null; await persist(true); } else await saveChain;
    let list;
    try { list = await Chats.list(); } catch (e) { if (tok === histTok) panel.innerHTML = `<p class="ai-hist-msg">Couldn’t load your chats: ${esc(e.message || e)}</p>`; return; }
    if (tok !== histTok || panel.hidden) return;
    const where = Chats.where() === 'account' ? 'Saved to your account, only you can see them.' : (Chats.sb() ? 'Saved on this device for now (the history update isn’t switched on yet).' : 'Saved on this device.');
    panel.innerHTML = `<div class="ai-hist-head"><strong>Your chats</strong></div><p class="ai-hist-where">${esc(where)}</p>` +
      (list.length ? `<ul class="ai-hist-list">${list.map(c => `<li class="ai-hist-row${c.id === chatId ? ' current' : ''}" data-id="${esc(c.id)}"><button type="button" class="ai-hist-open" data-open="${esc(c.id)}"><span class="ai-hist-title">${esc(c.title)}</span><span class="ai-hist-when">${esc(whenLabel(c.updatedAt))}${c.id === chatId ? ' · open now' : ''}</span></button><button type="button" class="ai-hist-del" data-del="${esc(c.id)}" aria-label="Delete chat: ${esc(c.title)}">Delete</button></li>`).join('')}</ul>`
        : '<p class="ai-hist-msg">No saved chats yet. Your conversations show up here after you send a message.</p>');
    panel.querySelectorAll('[data-open]').forEach(b => b.addEventListener('click', () => openChat(b.dataset.open)));
    panel.querySelectorAll('[data-del]').forEach(b => b.addEventListener('click', async () => {
      if (!b.classList.contains('confirm')) { b.classList.add('confirm'); b.textContent = 'Delete?'; setTimeout(() => { if (b.isConnected) { b.classList.remove('confirm'); b.textContent = 'Delete'; } }, 4000); return; }
      b.disabled = true;
      try { await Chats.remove(b.dataset.del); } catch (e) { b.disabled = false; A.toast && A.toast('Couldn’t delete: ' + (e.message || e), 3500); return; }
      if (b.dataset.del === chatId) { chatId = null; chatTitle = ''; chatCreated = null; history = []; document.getElementById('aiLog').innerHTML = ''; greet(); }
      showHistory();
    }));
    setChatBtns();
  }
  function hideHistory() {
    const panel = document.getElementById('aiHistPanel'); if (!panel) return; histTok++;
    panel.hidden = true; const b = document.getElementById('aiHist'); b.setAttribute('aria-expanded', 'false'); b.classList.remove('on');
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
  /** Series changes (t166u): build the exact plan up front so the card shows what will change. */
  const keyDay = k => fmtDay(k);
  const listDays = ks => ks.length > 4 ? `${ks.slice(0, 3).map(keyDay).join(', ')} +${ks.length - 3} more` : ks.map(keyDay).join(', ');
  async function seriesPlan(p) {
    const S = window.SandySeries; const all = await A.Store.list();
    let ev = all.find(e => e.id === p.id) || null;
    if (ev && ev.seriesId) ev = all.find(e => e.id === ev.seriesId) || null; // a changed occurrence -> its series
    if (!ev) throw new Error('I couldn’t find that repeating event');
    if (!A.isRecurring(ev)) throw new Error(`“${ev.title}” doesn’t repeat`);
    const isOcc = k => S.occKeys(ev, k, k).length > 0 || S.exceptionsOf(all, ev.id).some(e => e.originalDate === k);
    const near = k => { const ks = S.occKeys(ev, S.addDays(k, -10), S.addDays(k, 10)); return ks.length ? ` Nearest dates: ${ks.slice(0, 3).map(keyDay).join(', ')}.` : ''; };
    const rows = [['Series', `${ev.title} · ${whenText(ev)}`]];
    let plan;
    if (p.action === 'split') {
      const from = String(p.from || '').slice(0, 10); if (!/^\d{4}-\d{2}-\d{2}$/.test(from)) throw new Error('Which date should the change start from?');
      const c = p.changes || {};
      plan = S.split(ev, from, { start: c.start, end: c.end, minutes: c.minutes, weekdays: c.weekdays, freq: c.freq, interval: c.interval, until: c.until, title: c.title, location: c.location, category: c.category, notes: c.notes }, all);
      const before = S.occKeys(ev, String(ev.start).slice(0, 10), S.addDays(from, -1));
      if (before.length) rows.push(['Stays the same', `through ${keyDay(before[before.length - 1])}`]);
      const nx = A.occurrences(plan.next, A.parseLocal(from), A.parseLocal(S.addDays(from, 120))).slice(0, 3).map(o => o.key);
      rows.push([plan.inPlace ? 'Changes to' : `From ${keyDay(nx[0] || from)}`, whenText(plan.next) + (plan.next.title !== ev.title ? ` · “${plan.next.title}”` : '') + (plan.next.location !== ev.location && plan.next.location ? ` · ${plan.next.location}` : '')]);
      if (nx.length) rows.push(['Next dates', listDays(nx)]);
      if (plan.next.recurrence.until) rows.push(['Until', keyDay(plan.next.recurrence.until)]);
      rows.push(['Kept', 'calendar, category, location, notes and reminders']);
    } else if (p.action === 'exceptions') {
      const items = (p.items || []).filter(x => x && x.date).map(x => ({ ...x, date: String(x.date).slice(0, 10) }));
      if (!items.length) throw new Error('Which dates should change?');
      const bad = items.filter(x => !isOcc(x.date)); if (bad.length) throw new Error(`${listDays(bad.map(x => x.date))} ${bad.length > 1 ? 'aren’t dates' : 'isn’t a date'} for “${ev.title}”.${near(bad[0].date)}`);
      const skips = items.filter(x => x.skip), moves = items.filter(x => !x.skip);
      const a = skips.length ? S.skip(ev, skips.map(x => x.date), all) : { save: [ev], remove: [], created: [] };
      const b = moves.length ? S.move(a.save[0], moves, all) : { save: [a.save[0]], remove: [], created: [] };
      plan = { save: b.save, remove: a.remove, created: b.created };
      for (const x of skips) rows.push(['Skip', keyDay(x.date)]);
      for (const row of b.save.slice(1)) { const d = row.originalDate || row.start.slice(0, 10); rows.push([keyDay(d), row.allDay ? 'all day' : `${t12(A.parseLocal(row.start))}–${t12(A.parseLocal(row.end))}${row.start.slice(0, 10) !== d ? ` on ${keyDay(row.start.slice(0, 10))}` : ''}${row.title !== ev.title ? ` · “${row.title}”` : ''}`]); }
      rows.push(['Everything else', 'unchanged']);
    } else if (p.action === 'replace') {
      const d = String(p.date || '').slice(0, 10);
      if (!isOcc(d)) throw new Error(`${d ? keyDay(d) : 'That date'} isn’t a date for “${ev.title}”.${d ? near(d) : ''}`);
      plan = S.replace(ev, d, p.replacement || {}, all);
      const n = plan.added;
      rows.push(['Cancel', `${keyDay(d)}${ev.allDay ? '' : `, ${t12(A.parseLocal(`${d}T${A.hm(A.parseLocal(ev.start))}`))}`}`]);
      rows.push(['Add instead', `${n.title} · ${keyDay(n.start.slice(0, 10))}${n.allDay ? '' : `, ${t12(A.parseLocal(n.start))}–${t12(A.parseLocal(n.end))}`}`]);
      if (n.location) rows.push(['Where', n.location]);
      rows.push(['Rest of the series', 'unchanged']);
    } else throw new Error('Unknown series change');
    return { ev, rows, plan };
  }
  function undoBtn(card, undo, label) {
    const box = card.querySelector('.ai-card-btns');
    box.innerHTML = `<span class="ai-card-status">${esc(label)}</span><button type="button" class="ai-undo" data-undo>Undo</button>`;
    const u = box.querySelector('[data-undo]');
    u.addEventListener('click', async () => {
      u.disabled = true;
      try { await undo(); box.innerHTML = '<span class="ai-card-status ai-undone">↩ Undone</span>'; history.push({ role: 'user', content: '(I undid that change)', note: 1 }); persist(); A.refresh(); }
      catch (e) { console.error(e); u.disabled = false; A.toast('Could not undo: ' + (e.message || e), 4000); }
    });
  }
  async function renderSeries(p) {
    let info, err = null;
    try { info = await seriesPlan(p); } catch (e) { err = e.message || String(e); }
    const rows = info ? info.rows : [];
    const card = addMsg('assistant card', null, `<div class="ai-card-from">✨ Sandy Intelligence suggests</div><div class="ai-card-title">${esc(p.summary || 'Change a repeating event')}</div>
      ${rows.length ? `<dl class="ai-series-dl">${rows.map(([k, v]) => `<dt>${esc(k)}</dt><dd>${esc(v)}</dd>`).join('')}</dl>` : ''}
      ${err ? `<p class="ai-card-warn" role="alert">${esc(err)}</p>` : ''}
      <div class="ai-card-btns"><button type="button" class="primary" data-ok>Confirm</button><button type="button" data-no>Cancel</button></div>`);
    card.classList.add('ai-card', 'ai-series-card'); card.dataset.action = p.action || '';
    const ok = card.querySelector('[data-ok]'), no = card.querySelector('[data-no]');
    if (err) ok.disabled = true;
    no.addEventListener('click', () => { card.querySelector('.ai-card-btns').innerHTML = '<span class="ai-card-status">Cancelled</span>'; history.push({ role: 'user', content: `(I cancelled: ${p.summary || 'series change'})`, note: 1 }); persist(); });
    ok.addEventListener('click', async () => {
      ok.disabled = no.disabled = true;
      try {
        const fresh = await seriesPlan(p); // rebuilt from the latest data
        const undo = await window.SandySeries.apply(fresh.plan);
        undoBtn(card, undo, '✓ Saved'); history.push({ role: 'user', content: `(I confirmed: ${p.summary || 'series change'})`, note: 1 }); persist(); A.refresh();
      } catch (e) { console.error(e); ok.disabled = no.disabled = false; A.toast('Could not save: ' + (e.message || e), 4000); }
    });
    return card;
  }
  async function renderProposal(p) {
    if (p.type === 'series') return renderSeries(p);
    const { ev, rows } = await describe(p);
    const card = addMsg('assistant card', null, `<div class="ai-card-from">✨ Sandy Intelligence suggests</div><div class="ai-card-title">${esc(p.summary || VERB[p.type] || p.type)}</div>
      <dl>${rows.map(([k, v]) => `<dt>${esc(k)}</dt><dd>${esc(v)}</dd>`).join('')}</dl>
      <div class="ai-card-btns"><button type="button" class="primary" data-ok>Confirm</button><button type="button" data-no>Cancel</button></div>`);
    card.classList.add('ai-card');
    const ok = card.querySelector('[data-ok]'), no = card.querySelector('[data-no]');
    if (p.type !== 'add' && !ev) { ok.disabled = true; }
    const done = msg => { card.querySelector('.ai-card-btns').innerHTML = `<span class="ai-card-status">${esc(msg)}</span>`; };
    no.addEventListener('click', () => { done('Cancelled'); history.push({ role: 'user', content: `(I cancelled: ${p.summary || p.type})`, note: 1 }); persist(); });
    ok.addEventListener('click', async () => {
      ok.disabled = no.disabled = true;
      try { const snap = window.SandySeries ? await SandySeries.snapshot() : null; await applyProposal(p); if (snap) undoBtn(card, SandySeries.snapshotUndo(snap), '✓ Saved'); else done('✓ Saved'); history.push({ role: 'user', content: `(I confirmed: ${p.summary || p.type})`, note: 1 }); persist(); A.refresh(); }
      catch (e) { console.error(e); ok.disabled = no.disabled = false; A.toast('Could not save: ' + (e.message || e), 4000); }
    });
  }

  const pick = (o, keys) => Object.fromEntries(keys.filter(k => o[k] !== undefined).map(k => [k, o[k]]));
  const FIELDS = ['title', 'calendar', 'category', 'allDay', 'start', 'end', 'location', 'notes'];
  async function applyProposal(p) {
    const S = A.Store;
    if (p.type === 'series') return applySeries(p);
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
  async function applySeries(p) { const { plan } = await seriesPlan(p); return window.SandySeries.apply(plan); }

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
    bubble.innerHTML = h + '</div>'; scrollLog();
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
  whenReady(init); // last, so every const above exists before init() runs
})();
