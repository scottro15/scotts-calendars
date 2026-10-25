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
    send: '<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><path d="M12 19V6M6 11.5 12 5.5l6 6" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" fill="none"/></svg>',
  };
  const PRI = { 1: '#d1453b', 2: '#eb8909', 3: '#246fe0', 4: '' };
  const REM = [['', 'No reminder'], ['0', 'At time of task'], ['10', '10 minutes before'], ['30', '30 minutes before'], ['60', '1 hour before'], ['1440', '1 day before']];
  const st = { open: false, disabled: new Set(), prev: new Set(), date: undefined, priority: 4, cat: '', rem: '', kind: 'todo', cal: '', busy: false };

  function build() {
    const fab = document.createElement('button');
    fab.type = 'button'; fab.id = 'todoFab'; fab.className = 'todo-fab'; fab.setAttribute('aria-label', 'Add task'); fab.innerHTML = ICON.plus;
    const bd = document.createElement('div'); bd.id = 'qsBackdrop'; bd.className = 'qs-backdrop'; bd.hidden = true;
    const sh = document.createElement('div'); sh.id = 'qsSheet'; sh.className = 'qs-sheet'; sh.hidden = true;
    sh.setAttribute('role', 'dialog'); sh.setAttribute('aria-modal', 'true'); sh.setAttribute('aria-label', 'Quick add');
    sh.innerHTML = `<div class="qs-grab" aria-hidden="true"></div>
      <form id="qsForm" autocomplete="off" novalidate>
        <div class="qa-field qs-field"><div id="qsHl" class="qa-hl qs-hl" aria-hidden="true"></div><textarea id="qsText" class="qs-title" rows="1" maxlength="2000" placeholder="Task name" aria-label="Task name" autocapitalize="sentences" spellcheck="false" enterkeyhint="send"></textarea></div>
        <input id="qsDesc" class="qs-desc" maxlength="2000" placeholder="Description" aria-label="Description" autocapitalize="sentences" enterkeyhint="send">
        <div class="qs-chips" role="group" aria-label="Task options">
          <label class="qs-chip" id="qsDateChip">${ICON.cal}<span id="qsDateLbl">Date</span><select id="qsDate" aria-label="Date"></select></label>
          <input type="date" id="qsDatePick" class="qs-pick" tabindex="-1" aria-label="Pick a date">
          <label class="qs-chip" id="qsPriChip">${ICON.flag}<span id="qsPriLbl">Priority</span><select id="qsPri" aria-label="Priority">${[1, 2, 3, 4].map(n => `<option value="${n}">Priority ${n}</option>`).join('')}</select></label>
          <label class="qs-chip" id="qsCatChip">${ICON.tag}<span id="qsCatLbl">Category</span><select id="qsCat" aria-label="Category"></select></label>
          <label class="qs-chip" id="qsRemChip">${ICON.alarm}<span id="qsRemLbl">Reminders</span><select id="qsRem" aria-label="Reminders">${REM.map(([v, l]) => `<option value="${v}">${l}</option>`).join('')}</select></label>
          <label class="qs-chip qs-more" id="qsMoreChip"><span aria-hidden="true">•••</span><select id="qsMore" aria-label="More options"><option value="">More…</option><option value="todo">To-do</option><option value="note">Quick note (no date)</option><option value="full">Open the full editor…</option></select></label>
        </div>
        <div class="qs-foot">
          <label class="qs-proj" id="qsCalChip">${ICON.inbox}<span id="qsCalLbl">Inbox</span><span class="qs-caret" aria-hidden="true">▾</span><select id="qsCal" aria-label="Add to"></select></label>
          <span id="qsKindLbl" class="qs-kind" hidden>Note</span>
          <button id="qsSend" class="qs-send" type="submit" aria-label="Add task" disabled>${ICON.send}</button>
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
    const time = date && st.date === undefined ? p.time : null;
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
    st.prev = new Set(p.tokens.map(t => t.key));
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
    $('qsSend').disabled = !text.trim() || st.busy;
    $('qsSend').setAttribute('aria-label', st.kind === 'note' ? 'Add note' : 'Add task');
  }
  function fillSelects() {
    const a = A(); const t = today();
    const wk = (() => { const d = new Date(t + 'T00:00:00Z').getUTCDay(); return addDays(t, d === 6 || d === 0 ? 0 : 6 - d); })();
    const nw = (() => { const d = new Date(t + 'T00:00:00Z').getUTCDay(); return addDays(t, ((8 - d) % 7) || 7); })();
    $('qsDate').innerHTML = `<option value="~">Date…</option><option value="${t}">Today</option><option value="${addDays(t, 1)}">Tomorrow</option><option value="${wk}">This weekend</option><option value="${nw}">Next week</option><option value="pick">Pick a date…</option><option value="none">No date</option>`;
    $('qsDate').value = '~';
    const cats = N().Cats.cache || [];
    $('qsCat').innerHTML = `<option value="">No category</option>` + cats.map(c => `<option value="${esc(c.id)}">${esc(c.name)}</option>`).join('');
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
  function open() {
    if (st.open) { $('qsText').focus(); return; }
    st.open = true; const sh = $('qsSheet'), bd = $('qsBackdrop');
    const f = N().todoUI && N().todoUI.filter; st.cal = f && f !== 'all' && f !== 'inbox' && A().cal(f) ? f : '';
    fillSelects();
    sh.hidden = false; bd.hidden = false; sh.style.transform = '';
    document.body.classList.add('qs-open');
    $('qsText').focus({ preventScroll: true }); // synchronous, inside the tap: iOS Safari only shows the keyboard this way
    paint(); kb();
    if (reduce()) { sh.classList.add('open'); bd.classList.add('open'); }
    else { void sh.offsetWidth; sh.classList.add('open'); bd.classList.add('open'); }
    clearTimeout(st.hideT);
  }
  function close() {
    if (!st.open) return; st.open = false; const sh = $('qsSheet'), bd = $('qsBackdrop');
    const ae = document.activeElement; if (ae && sh.contains(ae)) ae.blur();
    sh.classList.remove('open'); bd.classList.remove('open'); document.body.classList.remove('qs-open');
    const done = () => { if (!st.open) { sh.hidden = true; bd.hidden = true; sh.style.transform = ''; } };
    clearTimeout(st.hideT); if (reduce()) done(); else st.hideT = setTimeout(done, 280);
    $('todoFab').focus({ preventScroll: true });
  }
  function reset() {
    $('qsText').value = ''; $('qsDesc').value = ''; st.disabled.clear(); st.date = undefined; st.priority = 4; st.cat = ''; st.rem = ''; $('qsDate').value = '~';
  }

  // ---------- submit (Enter or the send arrow); the sheet stays open for the next one
  async function submit(e) {
    if (e) e.preventDefault();
    const raw = $('qsText').value.trim(); if (!raw || st.busy) return;
    const p = parsed(); const ef = effective(p);
    st.busy = true; $('qsSend').disabled = true;
    try {
      const r = await N().saveQuick({ raw, parsed: p, kind: st.kind, categoryId: ef.catId, calendar: st.cal || null, priority: ef.priority,
        reminders: ef.date && st.rem !== '' ? [+st.rem] : [], description: $('qsDesc').value, date: ef.date, time: ef.time });
      reset(); st.busy = false; paint(); $('qsText').focus({ preventScroll: true });
      A().toast(r.msg);
      await N().renderTodo();
      const row = document.querySelector(r.sel);
      if (row) { row.classList.add('just-added'); const rb = row.getBoundingClientRect(), sb = $('qsSheet').getBoundingClientRect(); if (rb.bottom > sb.top || rb.top < 60) row.scrollIntoView({ block: 'center', behavior: reduce() ? 'auto' : 'smooth' }); }
      document.dispatchEvent(new CustomEvent('sandy:quickadded', { detail: r }));
    } catch (err) { st.busy = false; paint(); A().toast('Could not save: ' + err.message); }
  }

  // ---------- swipe the sheet down to dismiss
  function swipe() {
    const sh = $('qsSheet'); let y0 = null, dy = 0, t0 = 0;
    sh.addEventListener('touchstart', e => {
      if (e.touches.length !== 1 || e.target.closest('input, select, .qs-send')) { y0 = null; return; }
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
    $('qsForm').addEventListener('submit', submit);
    inp.addEventListener('input', paint);
    inp.addEventListener('scroll', () => { $('qsHl').scrollTop = inp.scrollTop; });
    // Enter = add (no newlines in the title); Shift+Enter too, like Todoist
    inp.addEventListener('keydown', e => { if (e.key === 'Enter' && !e.isComposing) { e.preventDefault(); submit(); } });
    inp.addEventListener('click', () => { // tap inside an inline chip -> keep those words as plain text (same as the inline quick add)
      const p = st.p; if (!p || inp.selectionStart !== inp.selectionEnd) return;
      const t = p.tokens.find(x => inp.selectionStart > x.start && inp.selectionStart < x.end); if (t) { st.disabled.add(t.key); paint(); }
    });
    $('qsDesc').addEventListener('keydown', e => { if (e.key === 'Enter' && !e.isComposing) { e.preventDefault(); submit(); } });
    // the send arrow must not steal focus (keeps the keyboard up for the next task)
    $('qsSend').addEventListener('pointerdown', e => e.preventDefault());
    document.addEventListener('keydown', e => { if (e.key === 'Escape' && st.open) { e.preventDefault(); close(); } });
    $('qsDate').addEventListener('change', e => {
      const v = e.target.value;
      if (v === 'pick') { const pk = $('qsDatePick'); pk.value = effective(st.p || parsed()).date || today(); try { pk.showPicker(); } catch (_) { pk.focus(); pk.click(); } }
      else if (v === 'none') st.date = null; else if (v !== '~') st.date = v;
      e.target.value = '~'; paint();
    });
    $('qsDatePick').addEventListener('change', e => { if (e.target.value) { st.date = e.target.value; paint(); } });
    $('qsPri').addEventListener('change', e => { st.priority = +e.target.value; const p = st.p; if (p && p.priority) { const t = p.tokens.find(x => x.kind === 'priority'); if (t) st.disabled.add(t.key); } paint(); });
    $('qsCat').addEventListener('change', e => { st.cat = e.target.value; const p = st.p; if (p && p.category) { const t = p.tokens.find(x => x.kind === 'category'); if (t) st.disabled.add(t.key); } paint(); });
    $('qsRem').addEventListener('change', e => { st.rem = e.target.value; if (st.rem !== '' && !effective(st.p || parsed()).date) st.date = today(); paint(); });
    $('qsCal').addEventListener('change', e => { st.cal = e.target.value; paint(); });
    $('qsMore').addEventListener('change', async e => {
      const v = e.target.value; e.target.value = '';
      if (v === 'todo' || v === 'note') { st.kind = v; paint(); inp.focus(); return; }
      if (v === 'full') {
        const p = parsed(), ef = effective(p), a = A(); const d = ef.date || today(); const raw = inp.value.trim();
        close();
        await a.openEditor(null, null, { kind: 'task', title: (p.title || raw).slice(0, 200), notes: $('qsDesc').value, calendar: st.cal && a.cal(st.cal) ? st.cal : a.firstVisibleCal(), allDay: !ef.time, start: ef.time ? `${d}T${ef.time}` : d, end: ef.time ? `${d}T${ef.time}` : d, todoCategoryId: ef.catId, reminders: st.rem !== '' ? [+st.rem] : [] });
        reset();
      }
    });
    swipe();
    if (window.visualViewport) { visualViewport.addEventListener('resize', kb); visualViewport.addEventListener('scroll', kb); }
    window.SandyQuickSheet = { open, close, get isOpen() { return st.open; }, state: st };
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();
