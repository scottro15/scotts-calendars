/* SANDY - To-Do "+" FAB + Todoist-style quick-add sheet (Scott 2026-10-25, fab).
   - FAB: round red button with a white "+", bottom-right, ABOVE the floating nav capsule (safe area + lift + nav height
     + 16px). It settles a little lower when the nav shrinks (still clear of it). Only on the To-Do tab.
   - Tap: subtle press scale, then the sheet slides up and the Task name input is focused SYNCHRONOUSLY inside the tap
     handler (the only way iOS Safari raises the keyboard). The sheet rides on top of the keyboard (visualViewport).
   - Sheet (like Todoist's iOS Inbox quick add): big "Task name" input with SANDY's natural-language chips inline
     (dates, times, categories, p1-p4), a smaller "Description", a row of compact pill chips (Date, Priority, Category,
     Reminders, ...), then "Inbox ▾" (where it goes) and a round send arrow that is disabled until there's text.
   - Enter / send: saves through SandyNav.saveQuick (the same save path as the inline quick add: dated -> scheduled to-do,
     undated -> Inbox jot/note), clears and KEEPS the sheet open for rapid entry; toast + the new row flashes in the list.
   - Dismiss: tap the dimmed backdrop, swipe the sheet down, or Escape. Enter/leave animate; reduced motion = instant. */
(function () {
  'use strict';
  const $ = id => document.getElementById(id);
  const A = () => window.__app, N = () => window.SandyNav;
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const reduce = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
  const ICON = {
    plus: '<svg viewBox="0 0 24 24" width="26" height="26" aria-hidden="true"><path d="M12 5v14M5 12h14" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" fill="none"/></svg>',
    cal: '<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><rect x="3.5" y="5" width="17" height="15" rx="3" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M3.5 10h17M8 3v4M16 3v4" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>',
    flag: '<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path d="M5 21V4h11.5l-1.6 4 1.6 4H5" fill="var(--flag, none)" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/></svg>',
    tag: '<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path d="M3.5 12.5V4.5a1 1 0 0 1 1-1h8l8 8-9 9z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/><circle cx="8.5" cy="8.5" r="1.6" fill="currentColor"/></svg>',
    alarm: '<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><circle cx="12" cy="13" r="7.5" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M12 9v4l2.5 2M4 5l3-2.5M20 5l-3-2.5" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" fill="none"/></svg>',
    inbox: '<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path d="M3.5 13.5 6 5h12l2.5 8.5V19a1 1 0 0 1-1 1h-15a1 1 0 0 1-1-1z M3.5 13.5h5l1.5 2.5h4l1.5-2.5h5" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/></svg>',
    x: '<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18" stroke="currentColor" stroke-width="2" stroke-linecap="round" fill="none"/></svg>',
    trash: '<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path d="M4.5 7h15M9.5 7V4.5h5V7M6.5 7l1 12.5h9l1-12.5M10.5 11v5M13.5 11v5" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    sub: '<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path d="M6 4v9a3 3 0 0 0 3 3h9M14.5 12.5 18 16l-3.5 3.5" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    chev: '<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path d="m9 6 6 6-6 6" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    grip: '<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><g fill="currentColor"><circle cx="9" cy="6" r="1.5"/><circle cx="15" cy="6" r="1.5"/><circle cx="9" cy="12" r="1.5"/><circle cx="15" cy="12" r="1.5"/><circle cx="9" cy="18" r="1.5"/><circle cx="15" cy="18" r="1.5"/></g></svg>',
    send: '<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><path d="M12 19V6M6 11.5 12 5.5l6 6" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" fill="none"/></svg>',
  };
  const PRI = { 1: '#d1453b', 2: '#eb8909', 3: '#246fe0', 4: '' };
  const REM = [['', 'No reminder'], ['0', 'At time of task'], ['10', '10 minutes before'], ['30', '30 minutes before'], ['60', '1 hour before'], ['1440', '1 day before']];
  const st = { open: false, edit: null, disabled: new Set(), prev: new Set(), date: undefined, priority: 4, cat: '', rem: '', kind: 'todo', cal: '', subs: [], hideDone: false, saving: Promise.resolve(), sig: '' };
  const SUBS = () => window.SandySubs;

  function build() {
    const fab = document.createElement('button');
    fab.type = 'button'; fab.id = 'todoFab'; fab.className = 'todo-fab'; fab.setAttribute('aria-label', 'Add task'); fab.innerHTML = ICON.plus;
    const bd = document.createElement('div'); bd.id = 'qsBackdrop'; bd.className = 'qs-backdrop'; bd.hidden = true;
    const sh = document.createElement('div'); sh.id = 'qsSheet'; sh.className = 'qs-sheet'; sh.hidden = true;
    sh.setAttribute('role', 'dialog'); sh.setAttribute('aria-modal', 'true'); sh.tabIndex = -1; sh.setAttribute('aria-label', 'Quick add');
    sh.innerHTML = `<div class="qs-grab" aria-hidden="true"></div>
      <form id="qsForm" autocomplete="off" novalidate>
        <div class="qs-title-row"><button type="button" id="qsCheck" class="qs-check" role="checkbox" aria-checked="false" aria-label="Complete" hidden><span></span></button>
        <div class="qa-field qs-field"><div id="qsHl" class="qa-hl qs-hl" aria-hidden="true"></div><textarea id="qsText" name="task-title" class="qs-title" rows="1" maxlength="2000" placeholder="Task name" aria-label="Task name" autocomplete="off" autocapitalize="sentences" autocorrect="off" spellcheck="false" enterkeyhint="send"></textarea></div></div>
        <textarea id="qsDesc" name="task-description" class="qs-desc" rows="1" maxlength="2000" placeholder="Description" aria-label="Description" autocomplete="off" autocapitalize="sentences" autocorrect="on" spellcheck="true" enterkeyhint="enter"></textarea>
        <div class="qs-chips" role="group" aria-label="Task options">
          <label class="qs-chip" id="qsDateChip">${ICON.cal}<span id="qsDateLbl">Date</span><select id="qsDate" aria-label="Date"></select></label>
          <input type="date" id="qsDatePick" class="qs-pick" tabindex="-1" aria-label="Pick a date">
          <label class="qs-chip" id="qsPriChip">${ICON.flag}<span id="qsPriLbl">Priority</span><select id="qsPri" aria-label="Priority">${[1, 2, 3, 4].map(n => `<option value="${n}">Priority ${n}</option>`).join('')}</select></label>
          <label class="qs-chip" id="qsCatChip">${ICON.tag}<span id="qsCatLbl">Category</span><select id="qsCat" aria-label="Category"></select></label>
          <label class="qs-chip" id="qsRemChip">${ICON.alarm}<span id="qsRemLbl">Reminders</span><select id="qsRem" aria-label="Reminders">${REM.map(([v, l]) => `<option value="${v}">${l}</option>`).join('')}</select></label>
          <label class="qs-chip qs-more" id="qsMoreChip"><span aria-hidden="true">•••</span><select id="qsMore" aria-label="More options"><option value="">More…</option><option value="todo">To-do</option><option value="note">Quick note (no date)</option><option value="full">Open the full editor…</option></select></label>
        </div>
        <section id="qsSubs" class="qs-subs" hidden aria-label="Sub-tasks">
          <div class="qs-subs-head"><button type="button" id="qsSubsToggle" class="qs-subs-toggle" aria-expanded="true"><span class="qs-subs-chev">${ICON.chev}</span>Sub-tasks <span id="qsSubsCount" class="qs-subs-count"></span></button>
            <button type="button" id="qsSubsHide" class="qs-subs-hide" hidden>Hide completed</button></div>
          <ul id="qsSubList" class="qs-sublist" role="list"></ul>
          <div class="qs-subadd"><span class="qs-subadd-plus" aria-hidden="true">+</span><input id="qsSubNew" class="qs-subnew" maxlength="200" placeholder="Add sub-task" aria-label="Add sub-task" autocomplete="off" autocapitalize="sentences" enterkeyhint="done"></div>
        </section>
        <div class="qs-foot">
          <label class="qs-proj" id="qsCalChip">${ICON.inbox}<span id="qsCalLbl">Inbox</span><span class="qs-caret" aria-hidden="true">▾</span><select id="qsCal" aria-label="Add to"></select></label>
          <span id="qsKindLbl" class="qs-kind" hidden>Note</span>
          <button id="qsDelete" class="qs-del" type="button" aria-label="Delete to-do" hidden>${ICON.trash}<span>Delete</span></button>
          <button id="qsSend" class="qs-send" type="submit" aria-label="Add task" disabled>${ICON.send}</button>
          <button id="qsClose" class="qs-x" type="button" aria-label="Close" hidden>${ICON.x}</button>
        </div>
      </form>`;
    document.body.append(fab, bd, sh);
  }

  // ---------- state -> UI
  const today = () => { const a = A(); return a.ymd(a.nowWall()); };
  const addDays = (ymd, n) => { const d = new Date(ymd + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
  function dayLabel(ymd) {
    const t = today(); if (ymd === t) return 'Today'; if (ymd === addDays(t, 1)) return 'Tomorrow';
    const d = new Date(ymd + 'T00:00:00Z'), diff = Math.round((d - new Date(t + 'T00:00:00Z')) / 864e5);
    if (diff > 1 && diff < 7) return d.toLocaleDateString('en-US', { weekday: 'long', timeZone: 'UTC' });
    if (diff < 0) return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' }) + ' (past)';
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: d.getUTCFullYear() !== +t.slice(0, 4) ? 'numeric' : undefined, timeZone: 'UTC' });
  }
  const parsed = () => N().parseQuick($('qsText').value, st.kind, st.disabled);
  function effective(p) {
    const date = st.kind === 'note' ? null : (st.date !== undefined ? st.date : p.date);
    // Manual date chip clears parsed time; edit mode may keep the event's existing clock time.
    let time = null;
    if (date) {
      if (st.date === undefined) time = p.time || null;
      else if (st._editTime) time = st._editTime;
    }
    return { date, time, priority: p.priority || st.priority, catId: (p.category && p.category.id) || st.cat || null };
  }
  function paint() {
    const inp = $('qsText'), hl = $('qsHl'), text = inp.value;
    if (st.disabled.size) for (const k of [...st.disabled]) if (!text.toLowerCase().replace(/\s+/g, ' ').includes(k.slice(k.indexOf(':') + 1))) st.disabled.delete(k);
    const p = st.p = parsed();
    let h = '', last = 0;
    for (const t of p.tokens) { h += esc(text.slice(last, t.start)) + `<span class="qa-chip qa-${t.kind}${st.prev.has(t.key) ? '' : ' qa-new'}" data-key="${esc(t.key)}">${esc(text.slice(t.start, t.end))}</span>`; last = t.end; }
    hl.innerHTML = h + esc(text.slice(last)) + '\u200b';
    inp.style.height = 'auto'; inp.style.height = Math.min(inp.scrollHeight, 132) + 'px'; hl.scrollTop = inp.scrollTop; // grows like Todoist's title
    st.prev = new Set(p.tokens.map(t => t.key)); growDesc();
    const e = effective(p), a = A();
    // Date chip (Todoist: "Today" in green, "Tomorrow" in orange, otherwise purple)
    const dl = $('qsDateLbl'), dc = $('qsDateChip');
    dl.textContent = e.date ? dayLabel(e.date) + (e.time ? ' ' + N().fmtTime(e.time) : '') : 'Date';
    dc.dataset.when = !e.date ? '' : e.date === today() ? 'today' : e.date === addDays(today(), 1) ? 'tomorrow' : e.date < today() ? 'past' : 'later';
    dc.classList.toggle('set', !!e.date); dc.hidden = st.kind === 'note';
    // Priority
    $('qsPriLbl').textContent = e.priority < 4 ? 'P' + e.priority : 'Priority';
    $('qsPriChip').classList.toggle('set', e.priority < 4); $('qsPriChip').style.setProperty('--flag', PRI[e.priority] || 'none');
    $('qsPriChip').style.setProperty('--flag-ink', PRI[e.priority] || 'currentColor'); $('qsPri').value = String(e.priority); $('qsPriChip').hidden = st.kind === 'note';
    // Category
    const cats = (N().Cats.cache || []); const cat = cats.find(c => c.id === e.catId);
    $('qsCatLbl').textContent = cat ? cat.name : 'Category'; $('qsCatChip').classList.toggle('set', !!cat);
    $('qsCatChip').style.setProperty('--c', cat ? cat.color : 'transparent'); $('qsCat').value = e.catId || '';
    // Reminders (need a date)
    const rem = REM.find(r => r[0] === st.rem);
    $('qsRemLbl').textContent = st.rem !== '' ? (st.rem === '0' ? 'At time' : rem[1].replace(' before', '')) : 'Reminders';
    $('qsRemChip').classList.toggle('set', st.rem !== ''); $('qsRemChip').hidden = st.kind === 'note'; $('qsRem').value = st.rem;
    // where it goes
    const c = st.cal && a.cal(st.cal); $('qsCalLbl').textContent = c ? c.name : 'Inbox'; $('qsCalChip').style.setProperty('--c', c ? c.color : 'transparent'); $('qsCalChip').classList.toggle('set', !!c);
    $('qsKindLbl').hidden = st.kind !== 'note';
    inp.placeholder = st.kind === 'note' ? 'Note' : 'Task name';
    $('qsSend').disabled = !text.trim();
    $('qsCheck').style.setProperty('--p', PRI[e.priority] || 'var(--qs-ph)'); $('qsCheck').classList.toggle('pri', e.priority < 4);
    if (st.edit) { $('qsSend').setAttribute('aria-label', 'Save'); }
    else $('qsSend').setAttribute('aria-label', st.kind === 'note' ? 'Add note' : 'Add task');
  }
  // the description grows with its text (line breaks allowed, like Todoist); quick add caps it, the task view shows it all
  function growDesc() {
    const d = $('qsDesc'); if (!d) return;
    d.style.height = 'auto'; const cap = st.edit ? Infinity : Math.max(88, Math.round(window.innerHeight * 0.3));
    d.style.height = Math.min(d.scrollHeight + 1, cap) + 'px'; d.style.overflowY = d.scrollHeight > cap ? 'auto' : 'hidden';
  }
  function fillSelects() {
    const a = A(); const t = today();
    const wk = (() => { const d = new Date(t + 'T00:00:00Z').getUTCDay(); return addDays(t, d === 6 || d === 0 ? 0 : 6 - d); })();
    const nw = (() => { const d = new Date(t + 'T00:00:00Z').getUTCDay(); return addDays(t, ((8 - d) % 7) || 7); })();
    $('qsDate').innerHTML = `<option value="~">Date…</option><option value="${t}">Today</option><option value="${addDays(t, 1)}">Tomorrow</option><option value="${wk}">This weekend</option><option value="${nw}">Next week</option><option value="pick">Pick a date…</option><option value="none">No date</option>`;
    $('qsDate').value = '~';
    const cats = N().Cats.cache || [];
    $('qsCat').innerHTML = `<option value="">No category</option>` + cats.map(c => `<option value="${esc(c.id)}">${esc(c.name)}</option>`).join('') + `<option value="__new__">+ New category…</option>`;
    $('qsCal').innerHTML = `<option value="">Inbox</option>` + a.calendars().map(c => `<option value="${esc(c.id)}">${esc(c.name)}</option>`).join('');
    $('qsCal').value = st.cal || '';
  }

  // ---------- keyboard: keep the sheet sitting right on top of the iOS keyboard
  function kb() {
    const vv = window.visualViewport; const sh = $('qsSheet'); if (!vv || !sh) return;
    const k = Math.max(0, Math.round(window.innerHeight - vv.height - vv.offsetTop));
    sh.style.setProperty('--kb', k + 'px'); sh.classList.toggle('kb', k > 0); document.body.style.setProperty('--qs-kb', k + 'px');
    document.body.style.setProperty('--qs-h', sh.offsetHeight + 'px');
  }

  // ---------- open / close
  function syncEditChrome() {
    const editing = !!st.edit;
    const sh = $('qsSheet');
    sh.classList.toggle('qs-editing', editing);
    sh.setAttribute('aria-label', editing ? 'Edit to-do' : 'Quick add');
    const del = $('qsDelete'); if (del) del.hidden = !editing;
    $('qsClose').hidden = !editing; $('qsSubs').hidden = !editing || st.kind === 'note';
    $('qsCheck').hidden = !editing || st.kind === 'note';
    { const o = $('qsMore').querySelector('option[value=full]'); if (o) { o.hidden = o.disabled = !!(editing && st.edit.type === 'inbox'); } }
    const send = $('qsSend'); send.hidden = editing; // the task view saves as you go (Todoist), no Save button
    if (editing) {
      send.innerHTML = 'Save'; send.classList.add('qs-save');
      send.setAttribute('aria-label', 'Save');
      send.disabled = !$('qsText').value.trim();
    } else {
      send.innerHTML = ICON.send; send.classList.remove('qs-save');
      send.setAttribute('aria-label', st.kind === 'note' ? 'Add note' : 'Add task');
    }
  }
  function showSheet(focus) {
    st.open = true; const sh = $('qsSheet'), bd = $('qsBackdrop');
    fillSelects(); syncEditChrome();
    sh.hidden = false; bd.hidden = false; sh.style.transform = '';
    document.body.classList.add('qs-open');
    if (focus) $('qsText').focus({ preventScroll: true }); else if (st.edit) sh.focus({ preventScroll: true });
    sh.scrollTop = 0; { const c = sh.querySelector('.qs-chips'); if (c) c.scrollLeft = 0; }
    paint(); kb(); syncEditChrome(); if (st.edit) renderSubs();
    if (reduce()) { sh.classList.add('open'); bd.classList.add('open'); }
    else { void sh.offsetWidth; sh.classList.add('open'); bd.classList.add('open'); }
    clearTimeout(st.hideT);
  }
  function open() {
    if (st.open && !st.edit) { $('qsText').focus(); return; }
    if (st.open && st.edit) { close(); }
    st.edit = null; reset();
    const f = N().todoUI && N().todoUI.filter; st.cal = f && f !== 'all' && f !== 'inbox' && A().cal(f) ? f : '';
    showSheet(true);
  }
  async function openEdit(target) {
    if (!target || !target.id) return;
    const a = A(), n = N(), S = SUBS();
    if (st.open && st.edit) { await persist(); } // switching rows (tablet pane): keep what was typed
    let edit = { type: target.type, id: target.id, key: target.key || null, ev: null, item: null };
    reset();
    if (target.type === 'task') {
      const ev = await a.Store.get(target.id); if (!ev) { a.toast('To-do not found'); return; }
      edit.ev = ev;
      const start = target.key && a.occurrences
        ? (function () { try { const os = (a.occurrenceStart || (() => null)); return null; } catch (_) { return null; } })()
        : null;
      // Prefer the row's occurrence key date when present; else the event start.
      let ymd = (ev.start || '').slice(0, 10), time = null;
      if (target.key && /^\d{4}-\d{2}-\d{2}/.test(target.key)) ymd = target.key.slice(0, 10);
      if (!ev.allDay && ev.start && ev.start.length >= 16) time = ev.start.slice(11, 16);
      $('qsText').value = ev.title || '';
      const ps = S.parse(ev.notes); $('qsDesc').value = ps.desc; st.subs = ps.subs;
      if (a.Store.checks && a.Store.checks.available) {
        try { const nk = a.noteKeyFor(ev, target.key); const c = await a.Store.checks.get(nk.eventId, nk.date); const ks = new Set((c && c.checked) || c || []); st.subs.forEach(x => { x.done = ks.has(x.key); }); edit.hadTicks = ks.size > 0; } catch (_) {}
      }
      st.origDate = ymd;
      st.kind = 'todo';
      st.date = ymd || null;
      st.priority = (ev.priority >= 1 && ev.priority <= 3) ? ev.priority : 4;
      st.cat = ev.todoCategoryId || '';
      st.cal = ev.calendar || '';
      const rems = Array.isArray(ev.reminders) ? ev.reminders : [];
      st.rem = rems.length ? String(rems[0]) : '';
      if (time) {
        // Keep natural-language time in the title chips by appending a readable time if not already present
        // Actual time is stored via st + parse; force via a hidden hint: put HH:MM into disabled-free parse by setting st and disabling auto time from title
        st._editTime = time;
      } else st._editTime = null;
    } else {
      const it = (n.Inbox.cache || []).find(x => x.id === target.id);
      if (!it) { a.toast('To-do not found'); return; }
      edit.item = it;
      const lines = String(it.body || '').split('\n');
      $('qsText').value = lines[0] || '';
      const ps = S.parse(lines.slice(1).join('\n')); $('qsDesc').value = ps.desc; st.subs = ps.subs; st.origDate = null;
      st.kind = it.kind === 'note' ? 'note' : 'todo';
      st.date = null; // Inbox = no date
      st.priority = (it.priority >= 1 && it.priority <= 3) ? it.priority : 4;
      st.cat = it.categoryId || '';
      st.cal = it.calendar || '';
      st.rem = '';
      st._editTime = null;
    }
    st.edit = edit; st.hideDone = !!(n.SubUI && n.SubUI.hideDone);
    if (st.open) { fillSelects(); syncEditChrome(); paint(); renderSubs(); kb(); st.sig = sig(); $('qsSheet').scrollTop = 0; $('qsSheet').querySelector('.qs-chips').scrollLeft = 0; $('qsSheet').focus({ preventScroll: true }); return; }
    showSheet(false); st.sig = sig();
  }
  function close() {
    if (!st.open) return;
    if (st.edit) { const ed = st.edit; persist(true).then(r => { if (r || ed) N().renderTodo(); }); }
    st.open = false; const sh = $('qsSheet'), bd = $('qsBackdrop');
    const ae = document.activeElement; if (ae && sh.contains(ae)) ae.blur();
    sh.classList.remove('open'); bd.classList.remove('open'); document.body.classList.remove('qs-open');
    const wasEdit = !!st.edit;
    const done = () => { if (!st.open) { sh.hidden = true; bd.hidden = true; sh.style.transform = ''; if (wasEdit) { st.edit = null; reset(); syncEditChrome(); } } };
    clearTimeout(st.hideT); if (reduce()) done(); else st.hideT = setTimeout(done, 280);
    if (!wasEdit) $('todoFab').focus({ preventScroll: true });
  }
  function reset() {
    $('qsText').value = ''; $('qsDesc').value = ''; st.subs = []; st.origDate = null; st.disabled.clear(); st.date = undefined; st.priority = 4; st.cat = ''; st.rem = ''; st.kind = 'todo'; st._editTime = null; $('qsDate').value = '~';
  }

  // ---------- submit (Enter or the send arrow); create keeps the sheet open, edit saves & closes
  async function submit(e) {
    if (e) e.preventDefault();
    const raw = $('qsText').value.trim(); if (!raw) return;
    const p = parsed(); const ef = effective(p);
    // In edit mode, prefer an explicit time captured from the existing event when the title didn't parse one
    let time = ef.time;
    if (st.edit && !time && st._editTime && ef.date) time = st._editTime;
    const opts = { raw, parsed: p, kind: st.kind, categoryId: ef.catId, calendar: st.cal || null, priority: ef.priority,
      reminders: ef.date && st.rem !== '' ? [+st.rem] : [], description: $('qsDesc').value, date: ef.date, time };
    if (st.edit) { // Enter in the task view: save now, put the keyboard away (Todoist)
      const ae = document.activeElement; if (ae && ae.blur) ae.blur();
      await persist(); return;
    }
    const undo = { text: $('qsText').value, desc: $('qsDesc').value, date: st.date, priority: st.priority, cat: st.cat, rem: st.rem };
    // clear at once (before the network) so the next task can be typed straight away - rapid entry never loses text
    reset(); paint(); $('qsText').focus({ preventScroll: true });
    try {
      const r = await N().saveQuick(opts);
      A().toast(r.msg);
      await N().renderTodo();
      const row = document.querySelector(r.sel);
      if (row) { row.classList.add('just-added'); const rb = row.getBoundingClientRect(), sb = $('qsSheet').getBoundingClientRect(); if (rb.bottom > sb.top || rb.top < 60) row.scrollIntoView({ block: 'center', behavior: reduce() ? 'auto' : 'smooth' }); }
      document.dispatchEvent(new CustomEvent('sandy:quickadded', { detail: r }));
    } catch (err) {
      if (!$('qsText').value) { $('qsText').value = undo.text; $('qsDesc').value = undo.desc; Object.assign(st, { date: undo.date, priority: undo.priority, cat: undo.cat, rem: undo.rem }); paint(); }
      A().toast('Could not save: ' + err.message);
    }
  }
  // ---------- task view: autosave (Todoist saves as you go). Serialised; skipped when nothing changed.
  function editOpts() {
    const raw = $('qsText').value.trim(); if (!raw) return null;
    const p = parsed(), ef = effective(p), a = A(), S = SUBS();
    let time = ef.time; if (!time && st._editTime && ef.date) time = st._editTime;
    const toTask = !!(ef.date && st.kind !== 'note');
    const ticksInChecks = toTask && a.Store.checks && a.Store.checks.available;
    const subs = st.kind === 'note' ? [] : st.subs;
    return { raw, parsed: p, kind: st.kind, categoryId: ef.catId, calendar: st.cal || null, priority: ef.priority,
      reminders: ef.date && st.rem !== '' ? [+st.rem] : [], description: S.compose($('qsDesc').value, subs, !ticksInChecks),
      date: ef.date, time, origDate: st.origDate || null, toTask, ticksInChecks, done: subs.filter(x => x.done).map(x => x.key) };
  }
  function sig() { const o = editOpts(); return o ? JSON.stringify([o.raw, o.kind, o.categoryId, o.calendar, o.priority, o.reminders, o.description, o.date, o.time, o.done]) : ''; }
  function persist(closing) {
    const run = async () => {
      const ed = st.edit; if (!ed) return null;
      const o = editOpts(); if (!o) { if (closing) A().toast('A to-do needs a name - kept the old one'); return null; }
      const sg = sig(); if (sg === st.sig) return null;
      const a = A();
      try {
        const r = await N().saveEdit({ ...o, edit: ed });
        st.sig = sg;
        if (r.ev) { ed.type = 'task'; ed.id = r.ev.id; ed.ev = r.ev; ed.item = null; if (!a.isRecurring(r.ev)) ed.key = null; st.origDate = o.date; }
        else if (r.item) { ed.type = 'inbox'; ed.id = r.item.id; ed.item = r.item; ed.ev = null; ed.key = null; st.origDate = null; }
        if (r.ev && o.ticksInChecks && (st.subs.length || ed.hadTicks)) {
          const nk = a.noteKeyFor(r.ev, ed.key); await a.Store.checks.set(nk.eventId, nk.date, o.done); ed.hadTicks = o.done.length > 0;
        }
        if (r.msg && r.msg !== 'Saved') a.toast(r.msg); // moved to / from the Inbox
        if (!closing && st.open) { syncEditChrome(); N().renderTodo().then(() => markSelected(ed)); }
        document.dispatchEvent(new CustomEvent('sandy:quickedited', { detail: r }));
        return r;
      } catch (err) { a.toast('Could not save: ' + err.message); return null; }
    };
    return (st.saving = st.saving.then(run, run));
  }
  function markSelected(ed) {
    if (!ed || !document.documentElement.classList.contains('lay-tablet')) return;
    document.querySelectorAll('.todo-row.td-selected').forEach(r => r.classList.remove('td-selected'));
    const row = document.querySelector(ed.type === 'task' ? `[data-ev="${CSS.escape(ed.id)}"]` : `[data-inbox="${CSS.escape(ed.id)}"]`); if (row) row.classList.add('td-selected');
  }
  // ---------- sub-tasks (add, rename, tick, drag / arrow-key reorder, delete)
  function renderSubs(animKey) {
    const ul = $('qsSubList'); if (!ul) return;
    const done = st.subs.filter(x => x.done).length, total = st.subs.length;
    $('qsSubsCount').textContent = total ? `${done}/${total}` : '';
    $('qsSubsHide').hidden = !done; $('qsSubsHide').textContent = st.hideDone ? `Show completed (${done})` : 'Hide completed';
    ul.innerHTML = st.subs.map((x, i) => `<li class="qs-sub${x.done ? ' done' : ''}${x.key === animKey ? ' qs-sub-in' : ''}" data-i="${i}"${x.done && st.hideDone ? ' hidden' : ''}>
      <button type="button" class="qs-sub-check" role="checkbox" aria-checked="${x.done}" aria-label="${x.done ? 'Mark not done' : 'Mark done'}: ${esc(x.text)}"><span></span></button>
      <textarea class="qs-sub-text" rows="1" maxlength="200" aria-label="Sub-task" enterkeyhint="done">${esc(x.text)}</textarea>
      <button type="button" class="qs-sub-drag" aria-label="Move ${esc(x.text)} (drag, or use the arrow keys)">${ICON.grip}</button>
      <button type="button" class="qs-sub-del" aria-label="Delete sub-task ${esc(x.text)}">${ICON.x}</button></li>`).join('');
    ul.querySelectorAll('.qs-sub-text').forEach(growSub);
  }
  function growSub(t) { t.style.height = 'auto'; t.style.height = t.scrollHeight + 'px'; }
  function subAt(el) { const li = el.closest('.qs-sub'); return li ? { li, i: +li.dataset.i } : null; }
  function addSub() {
    const inp = $('qsSubNew'), text = inp.value.replace(/\s+/g, ' ').trim(); if (!text) return;
    const k = SUBS().key(text);
    if (st.subs.some(x => x.key === k)) { A().toast('That sub-task is already on the list'); return; }
    st.subs.push({ text, key: k, done: false }); inp.value = '';
    renderSubs(k); persist();
  }
  function renameSub(t) {
    const h = subAt(t); if (!h) return; const s = st.subs[h.i]; if (!s) return;
    const text = t.value.replace(/\s+/g, ' ').trim();
    if (!text) { deleteSub(h.i); return; }
    if (text === s.text) return;
    const k = SUBS().key(text);
    if (st.subs.some((x, j) => j !== h.i && x.key === k)) { A().toast('That sub-task is already on the list'); t.value = s.text; return; }
    s.text = text; s.key = k; persist(); // the tick follows the new name (ticks are saved by name)
  }
  function deleteSub(i) {
    const li = $('qsSubList').querySelector(`.qs-sub[data-i="${i}"]`);
    const go = () => { st.subs.splice(i, 1); renderSubs(); persist(); };
    if (li && !reduce()) { li.classList.add('qs-sub-out'); setTimeout(go, 170); } else go();
  }
  function moveSub(from, to) {
    if (to < 0 || to >= st.subs.length || from === to) return;
    const [x] = st.subs.splice(from, 1); st.subs.splice(to, 0, x); renderSubs(); persist();
    const h = $('qsSubList').querySelector(`.qs-sub[data-i="${to}"] .qs-sub-drag`); if (h) h.focus({ preventScroll: true });
  }
  function dragSubs() {
    const ul = $('qsSubList'); let drag = null;
    ul.addEventListener('pointerdown', e => {
      const hd = e.target.closest('.qs-sub-drag'); if (!hd) return;
      const li = hd.closest('.qs-sub'); e.preventDefault();
      try { hd.setPointerCapture(e.pointerId); } catch (_) {}
      drag = { li, from: +li.dataset.i, y0: e.clientY, moved: false }; li.classList.add('dragging');
    });
    ul.addEventListener('pointermove', e => {
      if (!drag) return; const li = drag.li; if (Math.abs(e.clientY - drag.y0) > 4) drag.moved = true;
      const sibs = [...ul.children].filter(x => x !== li && !x.hidden);
      const before = sibs.find(x => { const r = x.getBoundingClientRect(); return e.clientY < r.top + r.height / 2; });
      if (before) { if (li.nextElementSibling !== before) ul.insertBefore(li, before); } else if (ul.lastElementChild !== li) ul.appendChild(li);
    });
    const end = () => {
      if (!drag) return; const d = drag; drag = null; d.li.classList.remove('dragging');
      const order = [...ul.children].map(x => +x.dataset.i);
      if (order.some((v, i) => v !== i)) { st.subs = order.map(i => st.subs[i]); renderSubs(); persist(); }
    };
    ul.addEventListener('pointerup', end); ul.addEventListener('pointercancel', end);
    ul.addEventListener('click', e => {
      const c = e.target.closest('.qs-sub-check');
      if (c) { const h = subAt(c); const s = st.subs[h.i]; s.done = !s.done; c.setAttribute('aria-checked', String(s.done)); h.li.classList.toggle('done', s.done); h.li.classList.add('ticking');
        setTimeout(() => { renderSubs(); }, reduce() ? 0 : 220); persist(); return; }
      const d = e.target.closest('.qs-sub-del'); if (d) { deleteSub(subAt(d).i); return; }
    });
    ul.addEventListener('keydown', e => {
      const t = e.target;
      if (t.classList.contains('qs-sub-text') && e.key === 'Enter' && !e.isComposing) { e.preventDefault(); t.blur(); return; }
      if (t.classList.contains('qs-sub-drag') && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) { e.preventDefault(); const i = subAt(t).i; moveSub(i, i + (e.key === 'ArrowUp' ? -1 : 1)); }
    });
    ul.addEventListener('input', e => { if (e.target.classList.contains('qs-sub-text')) growSub(e.target); });
    ul.addEventListener('focusout', e => { if (e.target.classList.contains('qs-sub-text')) renameSub(e.target); });
  }
  async function completeEdit() {
    const ed = st.edit; if (!ed) return; const a = A();
    $('qsCheck').setAttribute('aria-checked', 'true'); $('qsCheck').classList.add('ticking');
    await persist();
    try {
      if (ed.type === 'task') await a.setDone(ed.id, ed.key, true);
      else { const it = (N().Inbox.cache || []).find(x => x.id === ed.id) || ed.item; if (it) await N().Inbox.save({ ...it, done: true }); }
      st.sig = sig(); // nothing left to save
      a.toast('Completed');
    } catch (err) { a.toast('Could not save: ' + err.message); }
    setTimeout(() => { $('qsCheck').setAttribute('aria-checked', 'false'); $('qsCheck').classList.remove('ticking'); close(); }, reduce() ? 0 : 260);
  }
  async function removeEdit() {
    if (!st.edit) return;
    if (!window.confirm('Delete this to-do?')) return;
    st.sig = sig(); // don't autosave what's being deleted
    try {
      await st.saving;
      await N().deleteTodoTarget(st.edit);
      A().toast('Deleted');
      close();
      await N().renderTodo();
    } catch (err) { A().toast('Could not delete: ' + err.message); }
  }
  async function newCategory() {
    const name = (window.prompt('New category name') || '').trim();
    if (!name) { $('qsCat').value = st.cat || ''; return; }
    try {
      if (!N().Cats.available) { A().toast('Categories turn on after the database update.'); $('qsCat').value = st.cat || ''; return; }
      const COLORS = ['#ef4444', '#f59e0b', '#10b981', '#3b82f6', '#8b5cf6', '#ec4899', '#6b7280'];
      const cats = N().Cats.cache || [];
      const id = (crypto.randomUUID ? crypto.randomUUID() : 'c' + Date.now() + Math.random().toString(16).slice(2));
      const c = await N().Cats.save({ id, name: name.slice(0, 40), color: COLORS[cats.length % COLORS.length], sort: cats.length, createdAt: new Date().toISOString() });
      st.cat = c.id;
      fillSelects(); $('qsCat').value = c.id; paint(); if (st.edit) persist();
      A().toast('Category “' + c.name + '” added');
    } catch (err) { A().toast(err.message || String(err)); $('qsCat').value = st.cat || ''; }
  }

  // ---------- swipe the sheet down to dismiss
  function swipe() {
    const sh = $('qsSheet'); let y0 = null, dy = 0, t0 = 0;
    sh.addEventListener('touchstart', e => {
      if (e.touches.length !== 1 || e.target.closest('input, select, textarea, .qs-send, .qs-subs, .qs-chips') || sh.scrollTop > 0) { y0 = null; return; }
      y0 = e.touches[0].clientY; dy = 0; t0 = performance.now(); sh.classList.add('dragging');
    }, { passive: true });
    sh.addEventListener('touchmove', e => {
      if (y0 == null) return; dy = Math.max(0, e.touches[0].clientY - y0);
      sh.style.transform = `translateY(${dy}px)`; $('qsBackdrop').style.opacity = String(Math.max(0, 1 - dy / 300));
    }, { passive: true });
    const end = () => {
      if (y0 == null) return; y0 = null; sh.classList.remove('dragging'); $('qsBackdrop').style.opacity = '';
      const v = dy / Math.max(1, performance.now() - t0);
      if (dy > 80 || (dy > 24 && v > 0.5)) { sh.style.transform = ''; close(); } else sh.style.transform = '';
    };
    sh.addEventListener('touchend', end, { passive: true }); sh.addEventListener('touchcancel', end, { passive: true });
  }

  function init() {
    build();
    const fab = $('todoFab'), inp = $('qsText');
    // press feedback (CSS :active does the scale; .pressed keeps it for touch until the sheet is up)
    fab.addEventListener('pointerdown', () => fab.classList.add('pressed'));
    ['pointerup', 'pointercancel', 'pointerleave'].forEach(t => fab.addEventListener(t, () => setTimeout(() => fab.classList.remove('pressed'), 120)));
    fab.addEventListener('click', open);
    $('qsBackdrop').addEventListener('click', close);
    $('qsDelete').addEventListener('click', removeEdit);
    $('qsClose').addEventListener('click', close);
    $('qsCheck').addEventListener('click', completeEdit);
    $('qsSubsToggle').addEventListener('click', () => { const ex = $('qsSubsToggle').getAttribute('aria-expanded') !== 'true'; $('qsSubsToggle').setAttribute('aria-expanded', String(ex)); $('qsSubs').classList.toggle('collapsed', !ex); });
    $('qsSubsHide').addEventListener('click', () => { st.hideDone = !st.hideDone; if (N().SubUI) N().SubUI.hideDone = st.hideDone; renderSubs(); N().renderTodo(); }); // one setting for the sheet and the list
    $('qsSubNew').addEventListener('keydown', e => { if (e.key === 'Enter' && !e.isComposing) { e.preventDefault(); addSub(); } });
    $('qsSubNew').addEventListener('blur', () => { if ($('qsSubNew').value.trim()) addSub(); });
    dragSubs();
    $('qsText').addEventListener('blur', () => { if (st.edit) persist(); });
    $('qsDesc').addEventListener('blur', () => { if (st.edit) persist(); });
    $('qsDesc').addEventListener('input', () => { growDesc(); kb(); });
    $('qsForm').addEventListener('submit', submit);
    inp.addEventListener('input', paint);
    inp.addEventListener('scroll', () => { $('qsHl').scrollTop = inp.scrollTop; });
    // Enter = add (no newlines in the title); Shift+Enter too, like Todoist
    inp.addEventListener('keydown', e => { if (e.key === 'Enter' && !e.isComposing) { e.preventDefault(); submit(); } });
    inp.addEventListener('click', () => { // tap inside an inline chip -> keep those words as plain text (same as the inline quick add)
      const p = st.p; if (!p || inp.selectionStart !== inp.selectionEnd) return;
      const t = p.tokens.find(x => inp.selectionStart > x.start && inp.selectionStart < x.end); if (t) { st.disabled.add(t.key); paint(); }
    });
    // Enter = new line in the description (Todoist); Cmd/Ctrl+Enter still adds
    $('qsDesc').addEventListener('keydown', e => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey) && !e.isComposing) { e.preventDefault(); submit(); } });
    // the send arrow must not steal focus (keeps the keyboard up for the next task)
    $('qsSend').addEventListener('pointerdown', e => e.preventDefault());
    document.addEventListener('keydown', e => { if (e.key === 'Escape' && st.open) { e.preventDefault(); close(); } });
    $('qsDate').addEventListener('change', e => {
      const v = e.target.value;
      if (v === 'pick') { const pk = $('qsDatePick'); pk.value = effective(st.p || parsed()).date || today(); try { pk.showPicker(); } catch (_) { pk.focus(); pk.click(); } }
      else if (v === 'none') { st.date = null; st._editTime = null; } else if (v !== '~') { st.date = v; /* keep _editTime if editing same-day clock */ }
      e.target.value = '~'; paint(); if (st.edit && v !== 'pick') persist();
    });
    $('qsDatePick').addEventListener('change', e => { if (e.target.value) { st.date = e.target.value; paint(); if (st.edit) persist(); } });
    $('qsPri').addEventListener('change', e => { st.priority = +e.target.value; const p = st.p; if (p && p.priority) { const t = p.tokens.find(x => x.kind === 'priority'); if (t) st.disabled.add(t.key); } paint(); if (st.edit) persist(); });
    $('qsCat').addEventListener('change', e => { if (e.target.value === '__new__') { newCategory(); return; } st.cat = e.target.value; const p = st.p; if (p && p.category) { const t = p.tokens.find(x => x.kind === 'category'); if (t) st.disabled.add(t.key); } paint(); if (st.edit) persist(); });
    $('qsRem').addEventListener('change', e => { st.rem = e.target.value; if (st.rem !== '' && !effective(st.p || parsed()).date) st.date = today(); paint(); if (st.edit) persist(); });
    $('qsCal').addEventListener('change', e => { st.cal = e.target.value; paint(); if (st.edit) persist(); });
    $('qsMore').addEventListener('change', async e => {
      const v = e.target.value; e.target.value = '';
      if (v === 'todo' || v === 'note') { st.kind = v; paint(); if (st.edit) { syncEditChrome(); persist(); } else inp.focus(); return; }
      if (v === 'full' && st.edit && st.edit.type === 'task') { // the task already exists: open IT in the full editor (no copy)
        const ed = st.edit; close(); await st.saving; await A().openEditor(ed.id, ed.key); return;
      }
      if (v === 'full') {
        const p = parsed(), ef = effective(p), a = A(); const d = ef.date || today(); const raw = inp.value.trim();
        close();
        await a.openEditor(null, null, { kind: 'task', title: (p.title || raw).slice(0, 200), notes: $('qsDesc').value, calendar: st.cal && a.cal(st.cal) ? st.cal : a.firstVisibleCal(), allDay: !ef.time, start: ef.time ? `${d}T${ef.time}` : d, end: ef.time ? `${d}T${ef.time}` : d, todoCategoryId: ef.catId, reminders: st.rem !== '' ? [+st.rem] : [] });
        reset();
      }
    });
    swipe();
    if (window.visualViewport) { visualViewport.addEventListener('resize', kb); visualViewport.addEventListener('scroll', kb); }
    // a sub-task ticked in the list while this to-do is open (tablet pane): follow it without re-saving
    const subToggled = (id, key, done) => { if (!st.edit || st.edit.id !== id) return; const x = st.subs.find(s => s.key === key); if (!x) return; x.done = done; renderSubs(); st.sig = sig(); };
    window.SandyQuickSheet = { subToggled, open, openEdit, close, layout: kb, get isOpen() { return st.open; }, get editing() { return !!st.edit; }, state: st };
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();
