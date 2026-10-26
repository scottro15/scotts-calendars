/* app.js — Scott's three-calendar app (MSC, Minds Above Matters, Life Time). */
(async function () {
  'use strict';

  // ---------- Calendar definitions ----------
  // Built-in calendars: used in local mode, and as the fallback until the step 2 migration
  // creates the per-user `calendars` table. Preset categories stay keyed by slug.
  const BUILTIN_CALENDARS = [
    { id: 'msc', name: 'MSC – Mental Stability Community', short: 'MSC', color: '#7c3aed',
      categories: ['Study time', 'Client session', 'Client reach-out', 'Client check-in', 'Meeting', 'Other'] },
    { id: 'mam', name: 'Minds Above Matters', short: 'MAM', color: '#ea580c',
      categories: ['Client workout', 'Meeting', 'Film study', 'Client reach-out', 'Client check-in',
        'Program building', 'Program improvement', 'Program upload',
        'Team practice – Maryville University', 'Team practice – Jennings High School',
        'Team practice – Brad Beal Elite (EYBL)', 'Team practice – Other team', 'Other'] },
    { id: 'lifetime', name: 'Life Time – Facility Ops', short: 'Life Time', color: '#0f766e',
      categories: ['Work shift', 'Meeting', 'Weekly meeting – Bill & Sherita', 'Task / to-do', 'Event', 'Other'] },
  ];
  const GENERIC_CATEGORIES = ['Meeting', 'Task / to-do', 'Event', 'Other'];
  const PRESETS = Object.fromEntries(BUILTIN_CALENDARS.map(c => [c.id, c.categories]));
  let CALENDARS = BUILTIN_CALENDARS;
  let CAL = Object.fromEntries(CALENDARS.map(c => [c.id, c]));
  function useCalendars(rows) { // rows from the calendars table (per user)
    CALENDARS = rows.map(r => ({ id: r.slug, name: r.name, short: r.short || r.name, color: r.color,
      categories: PRESETS[r.slug] && BUILTIN_CALENDARS.some(b => b.id === r.slug && b.name === r.name) ? PRESETS[r.slug] : GENERIC_CATEGORIES }));
    CAL = Object.fromEntries(CALENDARS.map(c => [c.id, c]));
  }
  const taskCal = () => (CAL.lifetime ? 'lifetime' : CALENDARS[0].id);
  const CUSTOM = '__custom__';
  const DOW = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'];
  const SCOPE_LABEL = { day: 'Day', week: 'Week', month: 'Month', season: 'Season' };

  // ---------- Date helpers: every time is America/Chicago wall clock ----------
  // Wall-clock values are held in Date objects whose *UTC* fields are the Chicago
  // date/time (so there is no DST arithmetic and the device's own zone never matters).
  // FullCalendar runs with timeZone 'UTC' and `now` = current Chicago time.
  // Per-user zone (profiles.time_zone); America/Chicago until the profile loads (and in local mode).
  let TZ = 'America/Chicago';
  const pad = n => String(n).padStart(2, '0');
  const W = (y, m, d, h = 0, mi = 0) => { const x = new Date(Date.UTC(2000, 0, 1, h, mi)); x.setUTCFullYear(y, m, d); return x; }; // any year, incl. < 100
  const ymd = d => `${String(d.getUTCFullYear()).padStart(4, '0')}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
  const hm = d => `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`;
  function parseLocal(s) { // 'YYYY-MM-DD' or 'YYYY-MM-DDTHH:MM'
    const [date, time = '00:00'] = s.split('T');
    const [y, m, d] = date.split('-').map(Number);
    const [h, mi] = time.split(':').map(Number);
    return W(y, m - 1, d, h, mi);
  }
  const mkFmt = z => new Intl.DateTimeFormat('en-US', { timeZone: z, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
  let chicagoFmt = mkFmt(TZ);
  function setTZ(z) { // switch "now"/"today" to another IANA zone; stored wall-clock times are unchanged
    if (!z || z === TZ) return false;
    try { chicagoFmt = mkFmt(z); TZ = z; } catch (e) { console.warn('bad time zone', z); return false; }
    const n = document.getElementById('tzNote'); if (n) n.textContent = `Times are shown in ${TZ.replace(/_/g, ' ')}.`;
    return true;
  }
  function nowWall() { // current time in Chicago, as a wall-clock Date
    const p = Object.fromEntries(chicagoFmt.formatToParts(new Date()).map(x => [x.type, x.value]));
    return W(+p.year, +p.month - 1, +p.day, +p.hour % 24, +p.minute);
  }
  const addDays = (d, n) => W(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + n, d.getUTCHours(), d.getUTCMinutes());
  const startOfDay = d => W(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
  const dayDiff = (a, b) => Math.round((startOfDay(b) - startOfDay(a)) / 86400000);
  const fmtDay = d => d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' });
  function periodFor(scope, ref = nowWall()) {
    const d = startOfDay(ref);
    if (scope === 'day') return [d, addDays(d, 1)];
    if (scope === 'week') { const s = addDays(d, -d.getUTCDay()); return [s, addDays(s, 7)]; }
    if (scope === 'month') return [W(d.getUTCFullYear(), d.getUTCMonth(), 1), W(d.getUTCFullYear(), d.getUTCMonth() + 1, 1)];
    // season (meteorological): Dec–Feb, Mar–May, Jun–Aug, Sep–Nov
    const m = d.getUTCMonth(); const startM = m === 11 ? 11 : m < 2 ? -1 : m - (m - 2) % 3;
    return [W(d.getUTCFullYear(), startM, 1), W(d.getUTCFullYear(), startM + 3, 1)];
  }
  function seasonName(ref = nowWall()) {
    const m = ref.getUTCMonth();
    return m === 11 || m < 2 ? 'Winter' : m < 5 ? 'Spring' : m < 8 ? 'Summer' : 'Autumn';
  }
  // Seasons are meteorological: Spring Mar–May, Summer Jun–Aug, Autumn Sep–Nov,
  // Winter Dec of year Y + Jan–Feb of Y+1. "Winter" seen from a Jan/Feb date is the
  // winter that contains it (i.e. it started the December before).
  const SEASONS = ['spring', 'summer', 'autumn', 'winter'];
  const SEASON_LABEL = { spring: 'Spring', summer: 'Summer', autumn: 'Autumn', winter: 'Winter' };
  const seasonOf = ref => { const m = ref.getUTCMonth(); return m >= 2 && m <= 4 ? 'spring' : m >= 5 && m <= 7 ? 'summer' : m >= 8 && m <= 10 ? 'autumn' : 'winter'; };
  const WY = (y, m, d = 1) => W(y, m, d);
  function seasonPeriod(name, ref) {
    const y = ref.getUTCFullYear();
    if (name === 'spring') return [WY(y, 2), WY(y, 5)];
    if (name === 'summer') return [WY(y, 5), WY(y, 8)];
    if (name === 'autumn') return [WY(y, 8), WY(y, 11)];
    const wy = ref.getUTCMonth() < 2 ? y - 1 : y; // winter
    return [WY(wy, 11), WY(wy + 1, 2)];
  }
  function seasonTitle(name, ref) {
    const [s] = seasonPeriod(name, ref); const y = s.getUTCFullYear();
    const range = { spring: 'Mar–May', summer: 'Jun–Aug', autumn: 'Sep–Nov', winter: 'Dec–Feb' }[name];
    return `${SEASON_LABEL[name]} ${name === 'winter' ? `${y}–${String(y + 1).slice(-2)}` : y} (${range})`;
  }

  // ---------- Recurrence expansion ----------
  function isRecurring(ev) { return ev.recurrence && ev.recurrence.freq && ev.recurrence.freq !== 'none'; }

  /** Returns [{start: Date, end: Date, key: 'YYYY-MM-DD'}] overlapping [rs, re) */
  function occurrences(ev, rs, re) {
    const base = parseLocal(ev.start);
    let baseEnd = ev.end ? parseLocal(ev.end) : null;
    if (ev.allDay) baseEnd = addDays(startOfDay(baseEnd || base), 1); // stored end is inclusive for all-day
    if (!baseEnd || baseEnd <= base) baseEnd = ev.allDay ? addDays(base, 1) : new Date(base.getTime() + 3600000);
    const durDays = dayDiff(base, baseEnd);
    const durMs = baseEnd - base;
    const mk = s => {
      const e = ev.allDay ? addDays(s, durDays) : new Date(s.getTime() + durMs);
      return { start: s, end: e, key: ymd(s) };
    };
    const overlaps = o => o.start < re && o.end > rs;
    if (!isRecurring(ev)) { const o = mk(base); return overlaps(o) ? [o] : []; }

    const r = ev.recurrence; const interval = Math.max(1, +r.interval || 1);
    const until = r.until ? addDays(parseLocal(r.until), 1) : null; // inclusive
    const ex = new Set(ev.exdates || []);
    const out = []; const limit = until && until < re ? until : re;
    const push = s => { if (s < base || s >= limit) return; if (ex.has(ymd(s))) return; const o = mk(s); if (overlaps(o)) out.push(o); };
    const h = base.getUTCHours(), mi = base.getUTCMinutes();
    const lookback = Math.max(durDays + 1, 1);

    if (r.freq === 'daily') {
      let n = Math.max(0, Math.floor((dayDiff(base, rs) - lookback) / interval));
      for (let i = 0; i < 5000; i++, n++) { const s = addDays(base, n * interval); if (s >= limit) break; push(s); }
    } else if (r.freq === 'weekly') {
      const days = (r.byWeekday && r.byWeekday.length ? r.byWeekday : [base.getUTCDay()]).map(Number).sort();
      const week0 = addDays(startOfDay(base), -base.getUTCDay());
      let w = Math.max(0, Math.floor((dayDiff(week0, rs) - lookback) / (7 * interval)));
      for (let i = 0; i < 2000; i++, w++) {
        const ws = addDays(week0, w * 7 * interval); if (ws >= limit) break;
        for (const dw of days) push(W(ws.getUTCFullYear(), ws.getUTCMonth(), ws.getUTCDate() + dw, h, mi));
      }
    } else if (r.freq === 'monthly') {
      for (let n = 0; n < 2400; n += interval) {
        const s = W(base.getUTCFullYear(), base.getUTCMonth() + n, base.getUTCDate(), h, mi);
        if (s.getUTCDate() !== base.getUTCDate()) continue; // e.g. the 31st in a 30-day month: skip
        if (s >= limit) break; push(s);
      }
    } else if (r.freq === 'yearly') {
      for (let n = 0; n < 200; n += interval) {
        const s = W(base.getUTCFullYear() + n, base.getUTCMonth(), base.getUTCDate(), h, mi);
        if (s.getUTCMonth() !== base.getUTCMonth()) continue;
        if (s >= limit) break; push(s);
      }
    }
    return out;
  }

  const isDone = (ev, key) => isRecurring(ev) ? (ev.completedDates || []).includes(key) : !!ev.done;

  // ---------- Sign-in (only when Supabase is configured) ----------
  if (Store.configError) console.warn('Supabase config problem, using localStorage:', Store.configError);
  // Notes Review deep links (?review=day|week|month|season|year&date=YYYY-MM-DD) survive the
  // sign-in round trip (and any reload while the code is typed) via localStorage.
  const DL_KEY = 'sandy.pendingReviewLink.v1';
  {
    const q = new URLSearchParams(location.search);
    if (q.get('review')) localStorage.setItem(DL_KEY, JSON.stringify({ review: q.get('review'), date: q.get('date') || '', cals: q.get('cals') || '', at: Date.now() }));
  }
  const signedInUser = Store.auth ? await requireOwnerSignIn() : null;
  // ---------- Per-user calendars (step 2) ----------
  if (!Store.auth) { // local mode: the device's own list once the user has added or edited a calendar
    try { const rows = await Store.calendars(); if (rows && rows.length) useCalendars(rows); } catch (e) { console.error('calendars:', e); }
  }
  if (Store.auth) {
    let rows = null;
    try { rows = await Store.calendars(); } catch (e) { console.error('calendars:', e); }
    if (rows && rows.length === 0 && window.SandyAccount) { // signed in, no calendars yet: welcome flow
      await window.SandyAccount.onboarding({ store: Store, user: signedInUser });
      try { rows = await Store.calendars(); } catch (e) { console.error(e); rows = null; }
    }
    if (rows && rows.length) useCalendars(rows); // null = table not there yet: keep the built-in three
    try { // per-user time zone (falls back to the browser's when there's no profile yet)
      const prof = await Store.profile();
      setTZ((prof && prof.time_zone) || Intl.DateTimeFormat().resolvedOptions().timeZone);
    } catch (e) { console.warn('profile:', e); }
  }

  async function requireOwnerSignIn() {
    const gate = document.getElementById('authGate');
    const msg = document.getElementById('authMsg');
    const formEl = document.getElementById('authForm');
    const emailEl = document.getElementById('authEmail');
    const outBtn = document.getElementById('authSignOut');
    emailEl.value = localStorage.getItem('sandy.lastEmail') || '';
    const showFor = user => {
      gate.hidden = false;
      formEl.hidden = !!user; outBtn.hidden = !user; document.getElementById('authCodeForm').hidden = true;
      msg.textContent = user ? `Signed in as ${user.email}, which doesn't have access to these calendars.` : 'Sign in with your email. We\'ll email you an 8-digit code. Type it here to sign in.';
    };
    let user = null;
    try { user = await Store.auth.user(); } catch (e) { console.error(e); }
    if (Store.auth.isOwner(user)) return user;
    showFor(user);
    outBtn.onclick = async () => { await Store.auth.signOut(); showFor(null); };
    const codeForm = document.getElementById('authCodeForm');
    const codeEl = document.getElementById('authCode');
    const codeErr = document.getElementById('authCodeErr');
    const codeBtn = document.getElementById('authCodeBtn');
    const setErr = t => { codeErr.textContent = t || ''; codeErr.hidden = !t; codeEl.classList.toggle('invalid', !!t); };
    const showCode = on => {
      formEl.hidden = on; codeForm.hidden = !on; setErr('');
      if (on) { codeEl.value = ''; codeForm.classList.remove('auth-swap'); void codeForm.offsetWidth; codeForm.classList.add('auth-swap'); setTimeout(() => codeEl.focus(), 50); }
      else { formEl.classList.remove('auth-swap'); void formEl.offsetWidth; formEl.classList.add('auth-swap'); }
    };
    let sentTo = '';
    const send = async email => {
      msg.textContent = 'Sending…'; localStorage.setItem('sandy.lastEmail', email);
      try {
        await Store.auth.sendMagicLink(email); sentTo = email;
        msg.textContent = `We emailed ${email} an 8-digit code. Type it here to sign in.`;
        showCode(true);
      } catch (err) { showCode(false); msg.textContent = err && err.notInvited ? 'That email hasn\'t been invited yet. SANDY is invite-only for now.' : (/rate|seconds|429/i.test((err && err.message) || '') ? 'Too many requests. Wait a minute, then try again.' : 'Could not send the email: ' + (err.message || err)); }
    };
    formEl.onsubmit = async e => { e.preventDefault(); await send(emailEl.value.trim()); };
    codeEl.oninput = () => { codeEl.value = codeEl.value.replace(/\D/g, '').slice(0, 8); if (!codeErr.hidden) setErr(''); };
    codeForm.onsubmit = async e => {
      e.preventDefault();
      const code = codeEl.value.replace(/\D/g, '');
      if (code.length < 6) { setErr('Enter the full 8-digit code from your email.'); return; }
      codeBtn.disabled = true; codeBtn.textContent = 'Checking…';
      try { await Store.auth.verifyCode(sentTo, code); msg.textContent = 'Signed in. Loading…'; }
      catch (err) {
        const m = (err && (err.message || err.code)) || '';
        setErr(/expired|invalid|otp/i.test(m) ? 'That code is wrong or has expired. Check the newest email, or tap Resend code.' : /rate|429/i.test(m) ? 'Too many tries. Wait a minute, then try again.' : 'Could not sign in: ' + m);
      } finally { codeBtn.disabled = false; codeBtn.textContent = 'Sign in'; }
    };
    document.getElementById('authResend').onclick = () => send(sentTo || emailEl.value.trim());
    document.getElementById('authChangeEmail').onclick = () => { showCode(false); msg.textContent = 'Sign in with your email. We\'ll email you an 8-digit code. Type it here to sign in.'; emailEl.focus(); };
    return new Promise(resolve => {
      Store.auth.onSignIn(u => { if (Store.auth.isOwner(u)) { gate.hidden = true; resolve(u); } else showFor(u); });
    });
  }

  // ---------- State ----------
  const settings = Object.assign({ visible: {}, taskScope: 'day' }, await Store.loadSettings());
  for (const c of CALENDARS) if (!(c.id in settings.visible)) settings.visible[c.id] = true;
  delete settings.customCategories; // now kept by Store.categories()
  const params = new URLSearchParams(location.search);
  let reviewLink = null;
  try {
    const pend = JSON.parse(localStorage.getItem(DL_KEY) || 'null'); localStorage.removeItem(DL_KEY);
    if (pend && Date.now() - pend.at < 3 * 3600 * 1000) {
      reviewLink = pend;
      if (!params.get('review')) { if (pend.date && !params.get('date')) params.set('date', pend.date); if (pend.cals && !params.get('cals')) params.set('cals', pend.cals); }
    }
  } catch { /* ignore */ }
  if (params.get('cals')) { // deep link, e.g. ?cals=mam or ?cals=msc,lifetime
    const want = params.get('cals').split(',');
    for (const c of CALENDARS) settings.visible[c.id] = want.includes(c.id);
  }
  const saveSettings = () => Store.saveSettings(settings);
  let customCats = {};
  const loadCats = async () => { try { customCats = await Store.categories(); } catch (e) { console.error(e); } };

  if (Store.mode === 'local' && !(await Store.isInitialised())) await Store.replaceAll(seedExamples());
  await loadCats();

  // ---------- Sidebar: calendar toggles ----------
  const togglesEl = document.getElementById('calToggles');
  const toggleAll = document.getElementById('toggleAll');
  function renderToggles(events) {
    togglesEl.innerHTML = '';
    for (const c of CALENDARS) {
      const n = events.filter(e => e.calendar === c.id && !e.seriesId).length;
      const lab = document.createElement('label');
      lab.className = 'cal-toggle'; lab.style.setProperty('--c', c.color);
      lab.innerHTML = `<input type="checkbox" ${settings.visible[c.id] ? 'checked' : ''} data-cal="${c.id}"><span class="swatch"></span><span>${c.name}</span><span class="count">${n}</span>`;
      togglesEl.appendChild(lab);
    }
    const vals = CALENDARS.map(c => settings.visible[c.id]);
    toggleAll.checked = vals.every(Boolean);
    toggleAll.indeterminate = !toggleAll.checked && vals.some(Boolean);
  }
  togglesEl.addEventListener('change', e => {
    const id = e.target.dataset.cal; if (!id) return;
    settings.visible[id] = e.target.checked; saveSettings(); refresh();
  });
  toggleAll.addEventListener('change', () => {
    for (const c of CALENDARS) settings.visible[c.id] = toggleAll.checked; saveSettings(); refresh();
  });

  // ---------- FullCalendar ----------
  let briefReady = false; // set once the briefing panel is wired up (datesSet fires during render)
  // List View now-line state (declared before the calendar: datesSet fires during render)
  let listScrollPending = false, lastViewType = null, listDecoTimer = 0, listDecorating = false;
  const narrow = window.matchMedia('(max-width: 600px)').matches;
  // Remember the last view (not the date): reopen it on today. ?view= / deep links win.
  const VIEW_KEY = 'sandy.lastView', VIEWS = ['dayGridMonth', 'timeGridWeek', 'timeGridDay', 'listWeek'];
  let savedView = null; try { savedView = localStorage.getItem(VIEW_KEY); } catch (_) {}
  // Profile → Default view: a fixed view, or 'last' (the last one used, the default)
  let defaultView = 'last'; try { defaultView = localStorage.getItem('sandy.defaultView') || 'last'; } catch (_) {}
  const initialViewType = params.get('view') || (VIEWS.includes(defaultView) ? defaultView : defaultView === 'season' ? 'dayGridMonth' : VIEWS.includes(savedView) ? savedView : (narrow ? 'listWeek' : 'dayGridMonth'));
  // Cold open in List View: keep re-scrolling to today while events load, until the user scrolls.
  let coldListUntil = initialViewType.startsWith('list') && !params.get('review') ? Date.now() + 4000 : 0;
  const stopCold = () => { coldListUntil = 0; };
  ['wheel', 'touchstart', 'keydown', 'mousedown'].forEach(t => window.addEventListener(t, stopCold, { passive: true, once: true }));
  const calendar = new FullCalendar.Calendar(document.getElementById('calendar'), {
    timeZone: 'UTC',          // see "Date helpers": UTC fields == Chicago wall clock
    now: () => nowWall(),     // so "today" and the now-line are Chicago's, on any device
    initialView: initialViewType,
    initialDate: params.get('date') || undefined, // no date => today, even when restoring the last view
    headerToolbar: { left: 'prev,next today', center: 'title', right: 'dayGridMonth,timeGridWeek,timeGridDay,listWeek' },
    buttonText: { today: 'Today', month: 'Month', week: 'Week', day: 'Day', list: 'List' },
    views: { listWeek: { buttonText: 'List' }, timeGridDay: { dayHeaderFormat: { weekday: 'long' } } },
    height: 'auto',
    firstDay: 0,
    nowIndicator: true,
    navLinks: true,
    dayMaxEvents: true,
    selectable: true,
    scrollTime: '06:00:00',
    slotMinTime: '05:00:00',
    eventTimeFormat: { hour: 'numeric', minute: '2-digit', meridiem: 'short' },
    events: async (info, ok, fail) => {
      try { ok(await buildFcEvents(info.start, info.end)); } catch (err) { console.error(err); fail(err); }
    },
    eventClick: info => { info.jsEvent.preventDefault(); openEditor(info.event.extendedProps.sourceId, info.event.extendedProps.occKey); },
    select: info => {
      const s = info.start;
      const monthish = info.view.type === 'dayGridMonth';
      openEditor(null, null, {
        start: monthish ? `${ymd(s)}T09:00` : (info.allDay ? ymd(s) : `${ymd(s)}T${hm(s)}`),
        end: monthish ? `${ymd(s)}T10:00` : (info.allDay ? ymd(addDays(info.end, -1)) : `${ymd(info.end)}T${hm(info.end)}`),
        allDay: !monthish && info.allDay,
      });
      calendar.unselect();
    },
    eventDrop: info => moveEvent(info), eventResize: info => moveEvent(info),
    datesSet: info => { try { if (!document.body.classList.contains('tab-today')) localStorage.setItem(VIEW_KEY, info.view.type); } catch (_) {} syncStickyOffsets(); markTitle(); if (briefReady) renderBriefing(); listDatesSet(info.view); },
    eventsSet: () => scheduleListDecorate(),
    eventDidMount: info => {
      const p = info.event.extendedProps;
      const bits = [CAL[p.calendar]?.short, p.category, p.location, p.exception ? 'Changed occurrence' : '', p.example ? 'Example' : ''].filter(Boolean);
      if (p.dayNote) bits.push("Has Today's Note");
      info.el.title = `${info.event.title}\n${bits.join(' · ')}`;
      if (p.dayNote) {
        const t = info.el.querySelector('.fc-list-event-title a, .fc-event-title, .fc-list-event-title') || info.el;
        if (!t.querySelector('.day-note-dot')) { const d = document.createElement('span'); d.className = 'day-note-dot'; d.setAttribute('aria-label', "has Today's Note"); d.textContent = '📌'; t.appendChild(d); }
      }
      if (p.notionUrl && (info.view.type.startsWith('list') || info.view.type === 'timeGridDay')) {
        const t = info.el.querySelector('.fc-list-event-title, .fc-event-title-container, .fc-event-main-frame, .fc-event-main') || info.el;
        if (!info.el.querySelector('.notion-link')) t.appendChild(notionLinkEl(p.notionUrl));
      }
      if (p.kind === 'task' && (info.view.type.startsWith('list') || info.view.type === 'timeGridDay') && !info.el.querySelector('.todo-check')) {
        const t = info.el.querySelector('.fc-list-event-title a, .fc-event-title, .fc-list-event-title');
        if (t) { const w = document.createTreeWalker(t, NodeFilter.SHOW_TEXT); const n = w.nextNode(); if (n) n.nodeValue = n.nodeValue.replace(/^(☐|✓) /, ''); }
        const host = info.el.querySelector('.fc-list-event-title') || info.el.querySelector('.fc-event-main-frame, .fc-event-main') || info.el;
        host.insertBefore(todoCheckEl(p.sourceId, p.occKey, info.el.classList.contains('task-done'), CAL[p.calendar]?.color), host.firstChild);
        info.el.classList.add('has-todo-check');
      }
      if (p.game && window.SandyGames) SandyGames.decorate(info.el, p.game, info.view.type);
      if (!info.view.type.startsWith('list')) { const bc = CAL[p.calendar]?.color; if (bc) { info.el.style.setProperty('--cal', bc); const sh = blockShade(bc); if (sh) info.el.style.setProperty('--cal-block', sh); } } // dark mode deepens block colours via .sandy-block; light mode uses --cal-block only when white text would be below AA (styles.css)
      if (info.view.type.startsWith('list')) { // remember times so the now-line can find its spot
        const e = info.event; const cc = CAL[info.event.extendedProps.calendar]?.color;
        if (cc) { info.el.style.setProperty('--cal', cc); info.el.classList.add('sandy-tint'); info.el.dataset.cal = info.event.extendedProps.calendar; }
        info.el.dataset.allDay = e.allDay ? '1' : '';
        info.el.dataset.start = e.start ? `${ymd(e.start)}T${hm(e.start)}` : '';
        info.el.dataset.end = e.end ? `${ymd(e.end)}T${hm(e.end)}` : info.el.dataset.start;
      }
      scheduleListDecorate();
    },
  });
  calendar.render();

  // ---------- Swipe pager (Google Calendar style): left = next period, right = previous ----------
  // The current page moves 1:1 with the finger while the neighbouring period (preloaded in a hidden
  // FullCalendar "ghost" that shares the same event source) slides in beside it with its real dates and
  // events. Release past 30% of the width or with a fast flick commits; otherwise it springs back.
  // The sticky toolbar never moves. Reduced motion: no drag, instant switch.
  const stage = document.createElement('div'); stage.id = 'swipe-stage';
  const swipeCalEl = document.getElementById('calendar');
  swipeCalEl.parentNode.insertBefore(stage, swipeCalEl); stage.appendChild(swipeCalEl);
  const ghostOpts = {
    timeZone: 'UTC', now: () => nowWall(), headerToolbar: false, height: 'auto', firstDay: 0, nowIndicator: true,
    dayMaxEvents: true, editable: false, selectable: false, scrollTime: '06:00:00', slotMinTime: '05:00:00',
    views: { timeGridDay: { dayHeaderFormat: { weekday: 'long' } } },
    eventTimeFormat: { hour: 'numeric', minute: '2-digit', meridiem: 'short' },
    events: async (info, ok, fail) => { try { ok(await buildFcEvents(info.start, info.end)); } catch (err) { fail(err); } },
    eventDidMount: info => { const cc = CAL[info.event.extendedProps.calendar]?.color; if (cc) { info.el.style.setProperty('--cal', cc); info.el.classList.add('sandy-tint'); }
      if (info.event.extendedProps.game && window.SandyGames) SandyGames.decorate(info.el, info.event.extendedProps.game, info.view.type); },
  };
  const ghosts = {};
  for (const d of [1, -1]) {
    const g = document.createElement('div'); g.className = 'swipe-ghost'; g.dataset.dir = d > 0 ? 'next' : 'prev'; g.setAttribute('aria-hidden', 'true');
    stage.appendChild(g); ghosts[d] = { el: g, cal: null, key: '' };
  }
  const neighbourKey = d => `${calendar.view.type}|${ymd(calendar.getDate())}|${d}`;
  function preloadGhost(d) {
    const G = ghosts[d], key = neighbourKey(d);
    if (G.key === key) return; G.key = key;
    if (!G.cal) { G.cal = new FullCalendar.Calendar(G.el, { ...ghostOpts, initialView: calendar.view.type, initialDate: calendar.getDate() }); G.cal.render(); }
    else G.cal.changeView(calendar.view.type, calendar.getDate());
    d > 0 ? G.cal.next() : G.cal.prev();
  }
  let preloadTimer = 0;
  const preloadSoon = () => { clearTimeout(preloadTimer); preloadTimer = setTimeout(() => { const run = () => { preloadGhost(1); preloadGhost(-1); }; window.requestIdleCallback ? requestIdleCallback(run, { timeout: 800 }) : run(); }, 300); };
  calendar.on('datesSet', preloadSoon);
  calendar.on('eventsSet', () => { clearTimeout(preloadTimer); preloadTimer = setTimeout(() => { for (const d of [1, -1]) { const G = ghosts[d]; if (G.cal && G.key === neighbourKey(d)) G.cal.refetchEvents(); else preloadGhost(d); } }, 400); });
  preloadSoon();
  const harness = () => document.querySelector('#calendar .fc-view-harness');
  const reducedM = () => !!(window.Motion && Motion.reduced());
  function placeGhost(d) {
    const G = ghosts[d], h = harness(); if (!h) return null;
    preloadGhost(d);
    // Measure without the drag transform (offset* ignore transforms; #calendar is the offsetParent).
    const sr = stage.getBoundingClientRect(), cr = swipeCalEl.getBoundingClientRect();
    G.el.style.left = (cr.left - sr.left + h.offsetLeft) + 'px'; G.el.style.width = h.offsetWidth + 'px';
    const hr = { top: cr.top + h.offsetTop };
    // Line the ghost up with what's on screen: time grids keep the same hours; List/Month show their top.
    let top = hr.top - sr.top;
    const timegrid = calendar.view.type.startsWith('timeGrid');
    const stickyBottom = (parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--topbar-h')) || 0) + (parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--fc-toolbar-h')) || 0);
    if (!timegrid && hr.top < stickyBottom) top += stickyBottom - hr.top;
    G.el.style.top = top + 'px';
    G.el.classList.add('on');
    return G.el;
  }
  const hideGhosts = () => { for (const d of [1, -1]) { const g = ghosts[d].el; g.classList.remove('on'); g.style.transition = ''; g.style.transform = ''; } };
  function setPos(dx, ms = 0, ease = '') {
    const h = harness(); if (!h) return;
    const W = h.offsetWidth;
    const tr = ms ? `transform ${ms}ms ${ease}` : 'none';
    h.style.transition = tr; h.style.transform = dx ? `translate3d(${dx}px,0,0)` : '';
    const d = dx < 0 ? 1 : -1, other = ghosts[-d].el; other.classList.remove('on');
    if (dx) { const g = placeGhost(d); if (g) { g.style.transition = tr; g.style.transform = `translate3d(${dx + d * W}px,0,0)`; } }
  }
  (function swipeNav() {
    const el = swipeCalEl;
    let s = null;
    const blocked = t => t.closest('input, textarea, select, [contenteditable], dialog, .modal, .menu, .fc-popover, .fc-event-resizer, .fc-event-dragging, .fc-header-toolbar, .todo-check');
    const dragging = () => document.querySelector('.fc-event-dragging, .fc-event-mirror');
    el.addEventListener('touchstart', e => {
      if (e.touches.length !== 1 || blocked(e.target) || document.querySelector('dialog[open]')) { s = null; return; }
      const t = e.touches[0]; s = { x: t.clientX, y: t.clientY, at: Date.now(), multi: false, horiz: false, dx: 0, vx: 0, lt: Date.now(), lx: t.clientX, onEvent: !!e.target.closest('.fc-event') };
      if (!reducedM()) { preloadGhost(1); preloadGhost(-1); }
    }, { passive: true });
    el.addEventListener('touchmove', e => {
      if (!s) return;
      if (e.touches.length > 1) { s.multi = true; if (s.horiz) setPos(0, 220, 'ease-out'); s.horiz = false; return; }
      if (s.multi) return;
      const t = e.touches[0], dx = t.clientX - s.x, dy = t.clientY - s.y, now = Date.now();
      if (now > s.lt) { s.vx = 0.6 * s.vx + 0.4 * (t.clientX - s.lx) / (now - s.lt); s.lt = now; s.lx = t.clientX; }
      s.dx = dx;
      if (!s.horiz && Math.abs(dx) > 12 && Math.abs(dx) > 1.5 * Math.abs(dy) && !dragging()) {
        s.horiz = true;
        // A swipe that began on an event: make sure FullCalendar doesn't treat it as select / long-press.
        if (s.onEvent) { try { calendar.unselect(); } catch (_) {} document.querySelectorAll('#calendar .fc-event-selected').forEach(n => n.classList.remove('fc-event-selected')); }
      }
      if (s.horiz && dragging()) { s.horiz = false; setPos(0, 200, 'ease-out'); s = null; return; } // long-press drag won
      if (s.horiz && !reducedM()) setPos(dx);
    }, { passive: true });
    const end = e => {
      const st = s; s = null; if (!st) return;
      const t = e.changedTouches && e.changedTouches[0]; const dx = t ? t.clientX - st.x : st.dx, dy = t ? t.clientY - st.y : 0;
      const h = harness(); const W = h ? h.getBoundingClientRect().width : 390;
      const bad = st.multi || !st.horiz || dragging() || document.querySelector('dialog[open]') || (window.getSelection && String(window.getSelection()));
      const avg = dx / Math.max(1, Date.now() - st.at); if (Math.abs(avg) > Math.abs(st.vx) && Date.now() - st.at < 300) st.vx = avg;
      const flick = Math.abs(st.vx) > 0.45 && Math.abs(dx) > 40 && Math.sign(st.vx) === Math.sign(dx);
      const commit = !bad && Math.abs(dx) > 1.5 * Math.abs(dy) && (Math.abs(dx) > 0.3 * W || flick);
      window.__swipeLast = { dx, dy, vx: st.vx, horiz: st.horiz, multi: st.multi, bad: !!bad, commit };
      if (st.horiz) { // swallow the synthetic click so a swipe off an event never opens the editor
        const kill = ev => { ev.stopPropagation(); ev.preventDefault(); };
        window.addEventListener('click', kill, true); setTimeout(() => window.removeEventListener('click', kill, true), 350);
      }
      if (!commit) { if (st.horiz && !reducedM()) { setPos(0, 260, 'cubic-bezier(.2,.9,.3,1.15)'); setTimeout(hideGhosts, 280); } return; }
      swipeGo(dx < 0 ? 1 : -1, reducedM() ? 0 : dx, st.vx);
    };
    el.addEventListener('touchend', end, { passive: true });
    el.addEventListener('touchcancel', () => { if (s && s.horiz) { setPos(0, 220, 'ease-out'); setTimeout(hideGhosts, 240); } s = null; }, { passive: true });
  })();
  function swipeGo(dir, from = 0, v = 0) {
    try { if (navigator.vibrate) navigator.vibrate(10); } catch (_) {}
    const h = harness();
    const reduced = reducedM();
    const go = () => {
      const g = ghosts[dir];
      dir > 0 ? calendar.next() : calendar.prev();
      const hh = harness();
      if (hh) { hh.style.transition = 'none'; hh.style.transform = ''; }
      // Keep the ghost (same content) on top for a beat so there's no blank flash while events load.
      if (!reduced && g.el.classList.contains('on')) { g.el.style.transition = 'none'; g.el.style.transform = 'translate3d(0,0,0)';
        let done = false; const off = () => { if (done) return; done = true; calendar.off('eventsSet', off); requestAnimationFrame(() => requestAnimationFrame(hideGhosts)); };
        calendar.on('eventsSet', off); setTimeout(off, 350); }
      else hideGhosts();
      const view = calendar.view;
      if (view.type.startsWith('list')) {
        const today = ymd(nowWall());
        if (ymd(view.activeStart) <= today && today < ymd(view.activeEnd)) { listScrollPending = true; scheduleListDecorate(); }
        else window.scrollTo({ top: 0, behavior: 'auto' });
      }
    };
    if (h && !reduced) {
      const W = h.getBoundingClientRect().width;
      if (!from) setPos(-dir * 1); // button/programmatic: start from rest
      const left = W - Math.abs(from || 0);
      const ms = Math.max(140, Math.min(300, v ? left / Math.max(Math.abs(v), 0.8) : 260));
      requestAnimationFrame(() => { setPos(-dir * W, ms, 'cubic-bezier(.2,.8,.2,1)'); setTimeout(go, ms + 10); });
    } else go();
  }
  window.__sandySwipe = swipeGo;

  // ---------- List View: today's border, now-line, scroll-to-today ----------
  // Today's section gets a border; a line marks the current Chicago time and moves every minute.
  // Scrolls to today only when List View is opened, never on the minute ticks.
  function listDatesSet(view) {
    const isList = view.type.startsWith('list');
    if (isList && lastViewType !== view.type) listScrollPending = true;
    if (lastViewType && lastViewType !== view.type) coldListUntil = 0;
    lastViewType = view.type; scheduleListDecorate();
  }
  // Sticky stack: app top bar, then FullCalendar toolbar, then day headers (offsets via CSS vars).
  function syncStickyOffsets() {
    const top = document.querySelector('.topbar'), tb = document.querySelector('#calendar .fc-header-toolbar');
    const th = top && /sticky|fixed/.test(getComputedStyle(top).position) ? top.getBoundingClientRect().height : 0;
    const r = document.documentElement.style;
    r.setProperty('--topbar-h', th + 'px'); r.setProperty('--fc-toolbar-h', (tb ? tb.getBoundingClientRect().height : 0) + 'px');
  }
  window.addEventListener('resize', () => syncStickyOffsets());
  if (window.ResizeObserver) new ResizeObserver(() => syncStickyOffsets()).observe(document.querySelector('.topbar') || document.body);
  function scheduleListDecorate() { cancelAnimationFrame(listDecoTimer); listDecoTimer = requestAnimationFrame(decorateList); }
  const fmtNow = d => d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: 'UTC' });
  function decorateList() {
    const root = document.getElementById('calendar');
    if (listDecorating) return; listDecorating = true;
    try {
      root.querySelectorAll('.sandy-now-row, .sandy-today-placeholder, .sandy-today-empty-block').forEach(n => n.remove());
      root.querySelectorAll('.sandy-today, .sandy-today-first, .sandy-today-last, .sandy-ongoing').forEach(n => n.classList.remove('sandy-today', 'sandy-today-first', 'sandy-today-last', 'sandy-ongoing'));
      const view = calendar.view; if (!view.type.startsWith('list')) return;
      const now = nowWall(), today = ymd(now), nowKey = `${today}T${hm(now)}`;
      if (!(ymd(view.activeStart) <= today && today < ymd(view.activeEnd))) { listScrollPending = false; return; }
      const dayLabel = startOfDay(now).toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
      const lineRow = () => {
        const tr = document.createElement('tr'); tr.className = 'sandy-now-row sandy-today';
        tr.innerHTML = `<td colspan="3"><div class="sandy-now-line" role="separator" aria-label="Current time ${fmtNow(now)}"><span class="sandy-now-label">${fmtNow(now)}</span></div></td>`;
        return tr;
      };
      let header = root.querySelector(`tr.fc-list-day[data-date="${today}"]`);
      const tbody = root.querySelector('.fc-list-table tbody');
      if (!header) { // FullCalendar leaves out empty days: add a placeholder for today
        const mk = () => {
          const h = document.createElement('tr'); h.className = 'fc-list-day sandy-today-placeholder'; h.dataset.date = today;
          h.innerHTML = `<th colspan="3"><div class="fc-list-day-cushion fc-cell-shaded"><span class="fc-list-day-text">${escapeHtml(dayLabel)}</span></div></th>`;
          const e = document.createElement('tr'); e.className = 'sandy-today-placeholder sandy-today-emptyrow';
          e.innerHTML = '<td colspan="3" class="muted">No events today</td>';
          return [h, e];
        };
        if (tbody) {
          const next = [...tbody.querySelectorAll('tr.fc-list-day')].find(r => r.dataset.date > today);
          for (const r of mk()) tbody.insertBefore(r, next || null);
        } else { // whole range is empty: FullCalendar shows a message instead of a table
          const box = root.querySelector('.fc-list'); if (!box) return;
          const t = document.createElement('table'); t.className = 'fc-list-table sandy-today-empty-block';
          const b = document.createElement('tbody'); mk().forEach(r => b.appendChild(r)); t.appendChild(b);
          box.insertBefore(t, box.firstChild);
        }
        header = root.querySelector(`tr.fc-list-day[data-date="${today}"]`);
      }
      // today's rows = header + rows until the next day header
      const rows = [header];
      for (let r = header.nextElementSibling; r && !r.classList.contains('fc-list-day'); r = r.nextElementSibling) rows.push(r);
      const evRows = rows.filter(r => r.classList.contains('fc-list-event'));
      let before = null;
      for (const r of evRows) {
        if (r.dataset.allDay) continue;
        const st = r.dataset.start || '', en = r.dataset.end || st;
        if (st > nowKey) { before = r; break; }
        if (st <= nowKey && nowKey < en) r.classList.add('sandy-ongoing');
      }
      const line = lineRow();
      if (before) before.parentNode.insertBefore(line, before);
      else { const last = rows[rows.length - 1]; last.parentNode.insertBefore(line, last.nextElementSibling); }
      const all = [header, ...rows.slice(1), line].filter((r, i, a) => a.indexOf(r) === i);
      const ordered = [header]; for (let r = header.nextElementSibling; r && all.includes(r); r = r.nextElementSibling) ordered.push(r);
      ordered.forEach(r => r.classList.add('sandy-today'));
      ordered[0].classList.add('sandy-today-first'); ordered[ordered.length - 1].classList.add('sandy-today-last');
      const cold = coldListUntil && Date.now() < coldListUntil;
      if (listScrollPending || cold) {
        listScrollPending = false; syncStickyOffsets();
        const cs = getComputedStyle(document.documentElement);
        const off = (parseFloat(cs.getPropertyValue('--topbar-h')) || 0) + (parseFloat(cs.getPropertyValue('--fc-toolbar-h')) || 0);
        const y = header.getBoundingClientRect().top + window.scrollY - off;
        if (Math.abs(y - window.scrollY) > 4 && y > 0) setTimeout(() => window.scrollTo({ top: y, behavior: cold ? 'auto' : 'smooth' }), 60);
      }
    } finally { listDecorating = false; }
  }
  (function minuteTick() { // aligned to the minute boundary; also handles midnight (today is recomputed)
    setTimeout(() => { decorateList(); minuteTick(); }, 60000 - (Date.now() % 60000) + 20);
  })();
  document.addEventListener('visibilitychange', () => { if (!document.hidden) decorateList(); });

  /** Which (event/series id, Chicago date) a day note belongs to, for an item + clicked occurrence. */
  function noteKeyFor(ev, occKey) {
    if (ev.seriesId) return { eventId: ev.seriesId, date: ev.originalDate };
    if (isRecurring(ev)) return { eventId: ev.id, date: occKey };
    return { eventId: ev.id, date: ymd(parseLocal(ev.start)) };
  }
  const NOTION_SVG = '<svg viewBox="0 0 100 100" aria-hidden="true" focusable="false"><path fill="#fff" d="M6 4.3 61.3.2c6.8-.6 8.5-.2 12.8 2.9l17.6 12.4c2.9 2.1 3.9 2.7 3.9 5v68.3c0 4.3-1.6 6.8-7 7.2L24.4 99.8c-4.1.2-6-.4-8.2-3.1L3.3 79.9C.9 76.8 0 74.5 0 71.8V11.1c0-3.5 1.6-6.4 6-6.8z"/><path fill="#000" fill-rule="evenodd" d="M61.3.2 6 4.3C1.6 4.7 0 7.6 0 11.1v60.7c0 2.7.9 5 3.3 8.1l12.9 16.8c2.1 2.7 4.1 3.3 8.2 3.1l64.2-3.9c5.4-.4 7-2.9 7-7.2V20.5c0-2.2-.9-2.9-3.4-4.8L74.1 3.1C69.8 0 68.1-.4 61.3.2zM25.9 19.5c-5.3.4-6.5.4-9.5-2L8.8 11.4c-.8-.8-.4-1.8 1.6-2l53.2-3.9c4.5-.4 6.8 1.2 8.5 2.5l9.1 6.6c.4.2 1.4 1.4.2 1.4l-54.9 3.3-.6.2zm-6.1 68.8V30.3c0-2.5.8-3.7 3.1-3.9l63.1-3.7c2.1-.2 3.1 1.2 3.1 3.7v57.6c0 2.5-.4 4.7-3.9 4.9l-60.4 3.5c-3.5.2-5-1-5-4.1zm59.6-54.9c.4 1.8 0 3.5-1.8 3.7l-2.9.6v42.6c-2.5 1.4-4.9 2.2-6.8 2.2-3.1 0-3.9-1-6.2-3.9L42.6 49.7v28.8l6 1.4s0 3.5-4.9 3.5l-13.4.8c-.4-.8 0-2.7 1.4-3.1l3.5-1V41.6l-4.9-.4c-.4-1.8.6-4.5 3.5-4.7l14.4-1 19.9 30.4V39l-5.1-.6c-.4-2.2 1.2-3.9 3.3-4.1l13.4-.8z"/></svg>';
  function notionLinkEl(url) {
    const a = document.createElement('a');
    a.className = 'notion-link'; a.href = url; a.target = '_blank'; a.rel = 'noopener noreferrer';
    a.title = 'Open notes in Notion'; a.setAttribute('aria-label', 'Open notes in Notion'); a.innerHTML = NOTION_SVG;
    // never let the tap reach FullCalendar (which would open the editor)
    for (const t of ['click', 'mousedown', 'mouseup', 'pointerdown', 'pointerup', 'touchstart', 'touchend']) a.addEventListener(t, e => e.stopPropagation());
    return a;
  }
  // Light mode: the calendar colour deepened toward black just enough that white event text (also at the .9 opacity of examples)
  // meets WCAG AA. Returns null when the colour already passes, so those calendars keep their exact colour.
  const _shadeCache = {};
  function blockShade(hex) {
    if (hex in _shadeCache) return _shadeCache[hex];
    const m = /^#?([0-9a-f]{6})$/i.exec(hex || ''); if (!m) return (_shadeCache[hex] = null);
    const c = [0, 2, 4].map(i => parseInt(m[1].slice(i, i + 2), 16));
    const lum = rgb => { const l = rgb.map(v => { v /= 255; return v <= .03928 ? v / 12.92 : Math.pow((v + .055) / 1.055, 2.4); }); return .2126 * l[0] + .7152 * l[1] + .0722 * l[2]; };
    const cr = (a, b) => { const x = lum(a), y = lum(b); return (Math.max(x, y) + .05) / (Math.min(x, y) + .05); };
    for (let k = 0; k <= 60; k++) {
      const bg = c.map(v => Math.round(v * (1 - k / 100)));
      const ok = cr([255, 255, 255], bg) >= 4.6 && cr([255, 255, 255], bg.map(v => .9 * v + 25.5)) >= 4.6 && cr(bg.map(v => .9 * 255 + .1 * v), bg) >= 4.6;
      if (ok) return (_shadeCache[hex] = k ? '#' + bg.map(v => v.toString(16).padStart(2, '0')).join('') : null);
    }
    return (_shadeCache[hex] = null);
  }
  async function noteSet() { return new Set((await Store.notes.all()).map(n => `${n.eventId}|${n.date}`)); }
  async function buildFcEvents(rs, re) {
    const all = await Store.list();
    const noted = await noteSet();
    const links = new Map((await Store.links.all()).map(l => [`${l.eventId}|${l.date}`, l.url]));
    const out = [];
    for (const ev of all) {
      if (!settings.visible[ev.calendar]) continue;
      const c = CAL[ev.calendar] || CALENDARS[0];
      const hasNote = (e, k) => { const nk = noteKeyFor(e, k); return noted.has(`${nk.eventId}|${nk.date}`); };
      const notionOf = (e, k) => { const nk = noteKeyFor(e, k); return links.get(`${nk.eventId}|${nk.date}`) || null; };
      for (const o of occurrences(ev, rs, re)) {
        const done = ev.kind === 'task' && isDone(ev, o.key);
        const prefix = ev.kind === 'task' ? (done ? '✓ ' : '☐ ') : '';
        const scope = ev.kind === 'task' ? ` [${SCOPE_LABEL[ev.scope] || 'Day'}]` : '';
        const game = ev.kind !== 'task' && window.SandyGames ? SandyGames.info(ev) : null;
        out.push({
          id: `${ev.id}::${o.key}`,
          title: prefix + ev.title + scope,
          start: ev.allDay ? ymd(o.start) : o.start,
          end: ev.allDay ? ymd(o.end) : o.end,
          allDay: !!ev.allDay,
          backgroundColor: c.color, borderColor: c.color, textColor: '#fff',
          editable: true, // dragging one occurrence of a series detaches just that occurrence
          classNames: [ev.example ? 'is-example' : '', done ? 'task-done' : '', ev.seriesId ? 'is-exception' : '', hasNote(ev, o.key) ? 'has-day-note' : '', ev.kind === 'task' && ev.allDay ? 'sandy-todo-glow' : '', isClientKey(ev) ? 'sandy-client-key' : '', game ? 'sandy-game' : '', 'sandy-block'].filter(Boolean),
          extendedProps: { kind: ev.kind, dayNote: hasNote(ev, o.key), notionUrl: notionOf(ev, o.key), sourceId: ev.id, occKey: o.key, calendar: ev.calendar, category: ev.category, location: ev.location, example: ev.example, exception: !!ev.seriesId, game },
        });
      }
    }
    return out;
  }

  /** Copy one occurrence of a series into its own one-off event ("exception"). */
  function detachOccurrence(series, occKey, changes) {
    const occStart = occurrenceStart(series, occKey);
    const dur = parseLocal(series.end || series.start) - parseLocal(series.start);
    const occEnd = new Date(occStart.getTime() + Math.max(0, dur));
    const ex = {
      kind: series.kind, calendar: series.calendar, category: series.category, title: series.title,
      allDay: series.allDay, location: series.location || '', notes: series.notes || '', example: series.example,
      start: series.allDay ? ymd(occStart) : `${ymd(occStart)}T${hm(occStart)}`,
      end: series.allDay ? ymd(occEnd) : `${ymd(occEnd)}T${hm(occEnd)}`,
      recurrence: { freq: 'none' }, seriesId: series.id, originalDate: occKey,
      ...(series.kind === 'task' ? { scope: series.scope, done: (series.completedDates || []).includes(occKey) } : {}),
      ...changes,
    };
    const parent = { ...series,
      exdates: [...new Set([...(series.exdates || []), occKey])],
      completedDates: series.completedDates ? series.completedDates.filter(d => d !== occKey) : series.completedDates };
    return [parent, ex];
  }
  function occurrenceStart(series, occKey) {
    const b = parseLocal(series.start); const d = parseLocal(occKey);
    return W(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), b.getUTCHours(), b.getUTCMinutes());
  }

  // ---------- "Apply changes to…" (repeating items: save / delete / drag / resize) ----------
  const scopeDlg = document.getElementById('scopeDialog');
  const fmtOcc = k => parseLocal(k).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' });
  /** Ask whether a change applies to one occurrence or the whole series. Resolves 'one' | 'all' | null (cancel). */
  function askScope({ mode = 'save', occKey, title = '', oneDisabledReason = '' } = {}) {
    const del = mode === 'delete';
    document.getElementById('scopeTitle').textContent = del ? 'Delete…' : mode === 'move' ? 'Move…' : 'Apply changes to…';
    document.getElementById('scopeDesc').textContent = `"${title}" is a repeating event.`;
    document.getElementById('scopeOneSub').textContent = occKey ? `Only ${fmtOcc(occKey)}` : '';
    document.getElementById('scopeAllSub').textContent = del ? 'Every occurrence is deleted' : 'Every occurrence changes';
    scopeDlg.classList.toggle('danger-mode', del);
    const one = document.getElementById('scopeOne'), hint = document.getElementById('scopeHint');
    one.disabled = !!oneDisabledReason; hint.hidden = !oneDisabledReason; hint.textContent = oneDisabledReason;
    scopeDlg.returnValue = '';
    return new Promise(res => {
      scopeDlg.addEventListener('close', () => { const v = scopeDlg.returnValue; res(v === 'one' || v === 'all' ? v : null); }, { once: true });
      scopeDlg.showModal();
      (one.disabled ? document.getElementById('scopeAll') : one).focus();
    });
  }
  // Focus trap: Tab / Shift+Tab cycle inside the dialog (Escape cancels via motion.js's animated close).
  scopeDlg.addEventListener('keydown', e => {
    if (e.key !== 'Tab') return;
    const els = [...scopeDlg.querySelectorAll('button:not(:disabled)')]; if (!els.length) return;
    const i = els.indexOf(document.activeElement);
    const n = e.shiftKey ? (i <= 0 ? els.length - 1 : i - 1) : (i === els.length - 1 ? 0 : i + 1);
    e.preventDefault(); els[n].focus();
  });
  /** Shift a whole series so its occurrence shown at `shownStart` lands at `start`, with the new length. */
  function shiftSeries(series, shownStart, v) {
    const shift = parseLocal(v.start) - shownStart, len = parseLocal(v.end) - parseLocal(v.start);
    const ns = new Date(parseLocal(series.start).getTime() + shift), ne = new Date(ns.getTime() + len);
    return { start: v.allDay ? ymd(ns) : `${ymd(ns)}T${hm(ns)}`, end: v.allDay ? ymd(ne) : `${ymd(ne)}T${hm(ne)}` };
  }

  async function moveEvent(info) {
    const ev = await Store.get(info.event.extendedProps.sourceId);
    if (!ev) { info.revert(); refresh(); return; }
    const s = info.event.start, e = info.event.end;
    const allDay = info.event.allDay;
    const times = allDay
      ? { allDay, start: ymd(s), end: ymd(e ? addDays(e, -1) : s) }
      : (() => { const ee = e || new Date(s.getTime() + 3600000); return { allDay, start: `${ymd(s)}T${hm(s)}`, end: `${ymd(ee)}T${hm(ee)}` }; })();
    try {
      if (isRecurring(ev)) {
        const occKey = info.event.extendedProps.occKey;
        const choice = await askScope({ mode: 'move', occKey, title: ev.title });
        if (!choice) { info.revert(); refresh(); return; }
        if (choice === 'one') { await Store.saveMany(detachOccurrence(ev, occKey, times)); toast('Moved this event only'); }
        else {
          if (ev.allDay !== allDay) { info.revert(); refresh(); toast("Can't switch a whole series between all-day and timed by dragging"); return; }
          Object.assign(ev, shiftSeries(ev, occurrenceStart(ev, occKey), times)); await Store.save(ev); toast('Moved all events in the series');
        }
      } else { Object.assign(ev, times); await Store.save(ev); toast('Moved'); }
    } catch (err) { info.revert(); refresh(); fail(err); return; }
    refresh();
  }

  // ---------- Briefing panel ----------
  // Previews the events (and tasks of the matching scope) for Day / Week / Month / Season,
  // only from the calendars that are toggled on. Week/Month/Season follow the calendar's
  // current view date; Day is today when today is in view, otherwise the view's first day.
  const briefScopeEl = document.getElementById('briefScope');
  const briefSeasonsEl = document.getElementById('briefSeasons');
  const briefListEl = document.getElementById('briefList');
  const briefCollapse = document.getElementById('briefCollapse');
  // Tap anywhere on the Briefing header (not its buttons/links) to open/close it (Scott 2026-10-24)
  document.querySelector('#briefing .brief-head').addEventListener('click', e => {
    if (e.target.closest('button, a, input, select, textarea, label, [role=button]')) return;
    briefCollapse.click();
  });
  const briefBody = document.getElementById('briefBody');
  let briefScope = 'day';
  let briefToken = 0;
  let briefSeason = null; // null = the season containing the view date
  function viewRef() {
    const v = calendar.view; const t = startOfDay(nowWall());
    return t >= v.currentStart && t < v.currentEnd ? t : startOfDay(v.currentStart);
  }
  function briefPeriod(scope = briefScope, ref = viewRef()) {
    if (scope === 'day') return [ref, addDays(ref, 1)];
    if (scope === 'season') return seasonPeriod(briefSeason || seasonOf(ref), ref);
    return periodFor(scope, ref);
  }
  const fmtTime = d => d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: 'UTC' });
  const fmtLong = d => d.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
  const fmtShort = (d, yr) => d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', ...(yr ? { year: 'numeric' } : {}), timeZone: 'UTC' });
  function periodTitle(scope, ps, pe, ref) {
    if (scope === 'day') return fmtLong(ps);
    if (scope === 'week') { const last = addDays(pe, -1); return `Week of ${fmtShort(ps)} – ${fmtShort(last, true)}`; }
    if (scope === 'month') return ps.toLocaleDateString('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' });
    return seasonTitle(briefSeason || seasonOf(ref), ref);
  }
  /** Pure: the briefing rows for [ps, pe) from a list of stored items. */
  function briefingItems(all, ps, pe, scope, visible) {
    const rows = [];
    for (const ev of all) {
      if (!visible[ev.calendar]) continue;
      if (ev.kind === 'task' && (ev.scope || 'day') !== scope) continue;
      for (const o of occurrences(ev, ps, pe)) {
        const day = o.start < ps ? ps : startOfDay(o.start);
        rows.push({ ev, key: o.key, start: o.start, end: o.end, day: ymd(day), carried: o.start < ps });
      }
    }
    rows.sort((a, b) => (a.day < b.day ? -1 : a.day > b.day ? 1 : 0) || (!!b.ev.allDay - !!a.ev.allDay) || (a.ev.kind === 'task') - (b.ev.kind === 'task') || a.start - b.start || a.ev.title.localeCompare(b.ev.title));
    return rows;
  }
  function timeText(r) {
    if (r.ev.allDay) return 'All day';
    if (r.carried) return `until ${fmtTime(r.end)}`;
    return `${fmtTime(r.start)} – ${fmtTime(r.end)}`;
  }
  async function renderBriefing() {
    for (const b of briefScopeEl.querySelectorAll('button')) b.setAttribute('aria-pressed', String(b.dataset.scope === briefScope));
    const ref = viewRef();
    const season = briefSeason || seasonOf(ref);
    briefSeasonsEl.hidden = briefScope !== 'season';
    for (const b of briefSeasonsEl.querySelectorAll('button')) b.setAttribute('aria-pressed', String(b.dataset.season === season));
    const [ps, pe] = briefPeriod(briefScope, ref);
    document.getElementById('briefPeriod').textContent = periodTitle(briefScope, ps, pe, ref);
    const token = ++briefToken; const all = await Store.list(); if (token !== briefToken) return; // a newer render won
    const rows = briefingItems(all, ps, pe, briefScope, settings.visible);
    const anyVisible = CALENDARS.some(c => settings.visible[c.id]);
    const evRows = rows.filter(r => r.ev.kind !== 'task'), taskRows = rows.filter(r => r.ev.kind === 'task');
    const counts = CALENDARS.filter(c => settings.visible[c.id]).map(c => `${c.short} ${evRows.filter(r => r.ev.calendar === c.id).length}`);
    const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;
    document.getElementById('briefSummary').textContent = anyVisible
      ? `${plural(evRows.length, 'event')}${taskRows.length ? ` · ${plural(taskRows.length, 'task')}` : ''}${evRows.length ? ` (${counts.join(' · ')})` : ''}`
      : '';
    briefListEl.innerHTML = '';
    if (!anyVisible) { briefListEl.innerHTML = '<p class="empty">All calendars are hidden. Turn one on under Calendars.</p>'; return; }
    if (!rows.length) { briefListEl.innerHTML = `<p class="empty">Nothing scheduled for this ${briefScope}.</p>`; return; }
    const today = ymd(nowWall());
    let ul = null, lastDay = null;
    for (const r of rows) {
      if (r.day !== lastDay) {
        lastDay = r.day;
        if (briefScope !== 'day') {
          const h = document.createElement('h3'); h.className = 'brief-day' + (r.day === today ? ' is-today' : '');
          h.textContent = fmtDay(parseLocal(r.day)) + (r.day === today ? ' · Today' : '');
          briefListEl.appendChild(h);
        }
        ul = document.createElement('ul'); ul.className = 'brief-items'; briefListEl.appendChild(ul);
      }
      const c = CAL[r.ev.calendar] || CALENDARS[0];
      const isTask = r.ev.kind === 'task'; const done = isTask && isDone(r.ev, r.key);
      const li = document.createElement('li');
      li.innerHTML = `<button type="button" class="brief-item${done ? ' done' : ''}"><span class="bi-time"></span><span class="bi-main"><span class="bi-title"></span><span class="bi-meta"><span class="swatch" aria-hidden="true"></span><span class="bi-cal"></span><span class="bi-loc"></span></span></span></button>`;
      const btn = li.firstChild; btn.style.setProperty('--c', c.color);
      btn.querySelector('.bi-time').textContent = isTask ? (done ? '✓ Done' : '☐ Task') : timeText(r);
      btn.querySelector('.bi-title').textContent = r.ev.title;
      const calEl = btn.querySelector('.bi-cal'); calEl.textContent = c.short; calEl.title = c.name;
      btn.querySelector('.bi-loc').textContent = [isTask ? `${SCOPE_LABEL[r.ev.scope] || 'Day'} task` : '', r.ev.location].filter(Boolean).map(x => ' · ' + x).join('');
      btn.setAttribute('aria-label', `${btn.querySelector('.bi-time').textContent}, ${r.ev.title}, ${c.name}${r.ev.location ? ', ' + r.ev.location : ''}${briefScope !== 'day' ? ', ' + fmtDay(parseLocal(r.day)) : ''}`);
      btn.addEventListener('click', () => openEditor(r.ev.id, r.key));
      ul.appendChild(li);
    }
  }
  briefScopeEl.addEventListener('click', e => {
    const b = e.target.closest('button[data-scope]'); if (!b) return;
    const order = ['day', 'week', 'month', 'season'], dir = Math.sign(order.indexOf(b.dataset.scope) - order.indexOf(briefScope));
    briefScope = b.dataset.scope; renderBriefing().then(() => window.Motion && Motion.swap(briefBody, dir));
  });
  briefSeasonsEl.addEventListener('click', e => {
    const b = e.target.closest('button[data-season]'); if (!b) return;
    briefSeason = b.dataset.season; renderBriefing().then(() => window.Motion && Motion.swap(briefBody, 0));
  });
  const setBriefOpen = (open, animate) => {
    if (animate && window.Motion) Motion.slide(briefBody, open); else briefBody.hidden = !open; briefCollapse.setAttribute('aria-expanded', String(open));
    briefCollapse.setAttribute('aria-label', open ? 'Hide briefing' : 'Show briefing'); briefCollapse.textContent = '▾'; // rotated by CSS when collapsed
    document.getElementById('briefing').classList.toggle('collapsed', !open);
  };
  setBriefOpen(settings.briefOpen !== false);
  briefCollapse.addEventListener('click', () => { settings.briefOpen = briefCollapse.getAttribute('aria-expanded') !== 'true'; saveSettings(); setBriefOpen(settings.briefOpen, true); });
  briefReady = true;

  // ---------- Month + year picker (tap the calendar title) ----------
  const calEl = document.getElementById('calendar');
  const mp = document.getElementById('monthPicker');
  const mpYear = document.getElementById('mpYear');
  const mpMonths = document.getElementById('mpMonths');
  const MONTHS = Array.from({ length: 12 }, (_, i) => new Date(Date.UTC(2000, i, 1)).toLocaleDateString('en-US', { month: 'short', timeZone: 'UTC' }));
  mpMonths.innerHTML = MONTHS.map((m, i) => `<button type="button" data-month="${i}" aria-pressed="false">${m}</button>`).join('');
  function markTitle() {
    const t = document.querySelector('#calendar .fc-toolbar-title'); if (!t) return; // runs during first render too
    t.setAttribute('role', 'button'); t.setAttribute('tabindex', '0'); t.setAttribute('aria-haspopup', 'dialog');
    t.setAttribute('aria-label', `${t.textContent}. Change month and year`); t.title = 'Change month and year';
    t.classList.add('title-picker');
  }
  function syncPicker() {
    const ref = viewRef(); const y = +mpYear.value;
    for (const b of mpMonths.querySelectorAll('button')) b.setAttribute('aria-pressed', String(y === ref.getUTCFullYear() && +b.dataset.month === ref.getUTCMonth()));
  }
  function openPicker() {
    mpYear.value = viewRef().getUTCFullYear(); syncPicker(); mp.showModal();
    (mpMonths.querySelector('[aria-pressed=true]') || mpMonths.firstChild).focus();
  }
  const validYear = () => { const y = Number(mpYear.value); return Number.isInteger(y) && y >= 1 && y <= 9999 ? y : null; };
  function gotoMonth(y, m) { calendar.gotoDate(WY(y, m, 1)); briefSeason = null; renderBriefing(); }
  calEl.addEventListener('click', e => { if (e.target.closest('.fc-toolbar-title')) openPicker(); if (e.target.closest('.fc-today-button')) { briefSeason = null; renderBriefing(); } });
  calEl.addEventListener('keydown', e => { if (e.target.closest('.fc-toolbar-title') && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); openPicker(); } });
  const stepYear = n => { const y = validYear() || viewRef().getUTCFullYear(); mpYear.value = Math.min(9999, Math.max(1, y + n)); syncPicker(); };
  document.getElementById('mpPrevYear').addEventListener('click', () => stepYear(-1));
  document.getElementById('mpNextYear').addEventListener('click', () => stepYear(1));
  mpYear.addEventListener('input', syncPicker);
  mpMonths.addEventListener('click', e => {
    const b = e.target.closest('button[data-month]'); if (!b) return;
    const y = validYear(); if (y === null) { mpYear.reportValidity(); mpYear.focus(); return; }
    mp.close(); gotoMonth(y, +b.dataset.month);
  });
  mpYear.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); const y = validYear(); if (y === null) { mpYear.reportValidity(); return; } mp.close(); gotoMonth(y, viewRef().getUTCMonth()); } });
  document.getElementById('mpToday').addEventListener('click', () => { mp.close(); calendar.today(); briefSeason = null; renderBriefing(); });
  markTitle();

  // ---------- Tasks panel ----------
  const taskListEl = document.getElementById('taskList');
  const scopeTabs = document.getElementById('scopeTabs');
  scopeTabs.addEventListener('click', e => {
    const s = e.target.dataset.scope; if (!s) return;
    settings.taskScope = s; saveSettings(); renderTasks();
  });
  async function renderTasks() {
    const scope = settings.taskScope;
    for (const b of scopeTabs.querySelectorAll('button')) b.classList.toggle('active', b.dataset.scope === scope);
    scopeTabs.querySelector('[data-scope=season]').textContent = seasonName();
    const [ps, pe] = periodFor(scope);
    const tasks = (await Store.list()).filter(e => e.kind === 'task' && settings.visible[e.calendar]);
    const now = nowWall(), today = startOfDay(now);
    // when is an occurrence overdue: all-day = after its day, timed = after its end
    const dueAt = (ev, o) => ev.allDay ? addDays(startOfDay(o.start), 1) : (o.end && o.end > o.start ? o.end : o.start);
    const items = [], seen = new Set();
    const add = (ev, o) => {
      const k = `${ev.id}|${o.key}`; if (seen.has(k)) return; seen.add(k);
      const done = isDone(ev, o.key), due = dueAt(ev, o), overdue = !done && due <= now;
      items.push({ ev, key: o.key, date: o.start, overdue, overdueMs: overdue ? now - (ev.allDay ? startOfDay(o.start) : due) : 0 });
    };
    for (const ev of tasks) {
      if ((ev.scope || 'day') === scope) for (const o of occurrences(ev, ps, pe)) add(ev, o);
      // unfinished to-dos from before now show in every tab; for a repeating to-do only its most recent
      // missed occurrence (last 60 days), so a daily task doesn't flood the list
      const back = isRecurring(ev) ? addDays(today, -60) : W(1970, 0, 1);
      const missed = occurrences(ev, back, addDays(today, 1)).filter(o => !isDone(ev, o.key) && dueAt(ev, o) <= now);
      for (const o of isRecurring(ev) ? missed.slice(-1) : missed) add(ev, o);
    }
    items.sort((a, b) => (a.overdue === b.overdue ? 0 : a.overdue ? -1 : 1) || a.date - b.date);
    const open = items.filter(i => !isDone(i.ev, i.key)).length;
    document.getElementById('taskCount').textContent = items.length ? `(${open} open)` : '';
    taskListEl.innerHTML = items.length ? '' : `<li class="empty">No ${SCOPE_LABEL[scope].toLowerCase()}-scope tasks for this ${scope === 'season' ? 'season' : scope === 'day' ? 'day' : scope}.</li>`;
    for (const it of items) {
      const done = isDone(it.ev, it.key);
      const li = document.createElement('li'); if (done) li.classList.add('done');
      const c = CAL[it.ev.calendar];
      li.innerHTML = `<input type="checkbox" ${done ? 'checked' : ''}><span><span class="t"></span><span class="meta"></span></span>`;
      li.querySelector('.t').textContent = it.ev.title;
      if (it.overdue) { li.classList.add('overdue'); const od = document.createElement('span'); od.className = 'overdue-badge'; od.textContent = `Overdue ${overdueText(it.overdueMs)}`; li.querySelector('.t').after(od); }
      li.querySelector('.meta').textContent = `${c?.short || ''} · ${it.overdue ? 'Due ' : ''}${fmtDay(it.date)}${it.ev.example ? ' · Example' : ''}`;
      li.querySelector('input').style.accentColor = c?.color;
      li.querySelector('input').addEventListener('change', async e => { await setDone(it.ev.id, it.key, e.target.checked); });
      li.querySelector('.t').addEventListener('click', () => openEditor(it.ev.id, it.key));
      taskListEl.appendChild(li);
    }
  }
  /** Tappable to-do box for List / Day view: ~34px hit area, never opens the editor or starts a swipe. */
  function todoCheckEl(id, key, done, color) {
    const b = document.createElement('button');
    b.type = 'button'; b.className = 'todo-check' + (done ? ' checked' : '');
    b.setAttribute('role', 'checkbox'); b.setAttribute('aria-checked', String(done)); b.setAttribute('aria-label', done ? 'Mark not done' : 'Mark done');
    if (color) b.style.setProperty('--cal', color);
    b.innerHTML = '<span class="box" aria-hidden="true"></span>';
    for (const t of ['mousedown', 'mouseup', 'pointerdown', 'pointerup', 'touchstart', 'touchmove', 'touchend']) b.addEventListener(t, e => e.stopPropagation());
    b.addEventListener('click', e => {
      e.preventDefault(); e.stopPropagation();
      const v = b.getAttribute('aria-checked') !== 'true';
      b.classList.toggle('checked', v); b.setAttribute('aria-checked', String(v));
      b.closest('.fc-event')?.classList.toggle('task-done', v);
      setDone(id, key, v);
    });
    return b;
  }
  /** "4 days", "3 hrs", "2 wks", "1 mo" — largest sensible unit. */
  function overdueText(ms) {
    const m = Math.max(1, Math.floor(ms / 60000)), h = Math.floor(m / 60), d = Math.floor(h / 24);
    const u = (n, one, many) => `${n} ${n === 1 ? one : many}`;
    if (h < 1) return u(m, 'min', 'mins');
    if (d < 1) return u(h, 'hr', 'hrs');
    if (d < 14) return u(d, 'day', 'days');
    if (d < 60) return u(Math.floor(d / 7), 'wk', 'wks');
    if (d < 365) return u(Math.floor(d / 30.44), 'mo', 'mos');
    return u(Math.floor(d / 365.25), 'yr', 'yrs');
  }
  async function setDone(id, key, val) {
    const ev = await Store.get(id); if (!ev) return;
    if (isRecurring(ev)) {
      const set = new Set(ev.completedDates || []); val ? set.add(key) : set.delete(key); ev.completedDates = [...set];
    } else ev.done = val;
    try { await Store.save(ev); } catch (err) { fail(err); }
    refresh();
  }

  // ---------- Editor dialog ----------
  const dlg = document.getElementById('eventDialog');
  const form = document.getElementById('eventForm');
  const f = name => form.elements[name];
  const fCal = document.getElementById('fCalendar');
  const fCat = document.getElementById('fCategory');
  const customWrap = document.getElementById('customCatWrap');
  const weekdayWrap = document.getElementById('weekdayWrap');
  const recurFs = document.getElementById('recurFieldset');
  fCal.innerHTML = CALENDARS.map(c => `<option value="${c.id}">${c.name}</option>`).join('');
  weekdayWrap.innerHTML = DOW.map((d, i) => `<label><input type="checkbox" name="wd" value="${i}"><span>${d}</span></label>`).join('');
  let editing = null; // {id, occKey, recurring, exception}
  const locAC = window.Places ? Places.attach(f('location')) : null; // location autocomplete (places.js)
  dlg.addEventListener('close', () => locAC && locAC.reset());

  function fillCategories(calId, selected) {
    const presets = [...CAL[calId].categories, ...((customCats[calId] || []).filter(c => !CAL[calId].categories.includes(c)))];
    if (selected && !presets.includes(selected)) presets.push(selected);
    fCat.innerHTML = presets.map(c => `<option>${escapeHtml(c)}</option>`).join('') + `<option value="${CUSTOM}">+ Custom…</option>`;
    fCat.value = selected && presets.includes(selected) ? selected : presets[0];
    customWrap.hidden = true;
  }
  fCal.addEventListener('change', () => fillCategories(fCal.value, kind() === 'task' ? 'Task / to-do' : null));
  fCat.addEventListener('change', () => { customWrap.hidden = fCat.value !== CUSTOM; if (!customWrap.hidden) f('customCategory').focus(); });
  const kind = () => form.querySelector('input[name=kind]:checked').value;
  // Fields that only make sense for the whole series (changing them disables "This event only").
  const SERIES_FIELDS = ['calendar', 'kind', 'freq', 'interval', 'until', 'wd'];
  const seriesSnap = () => JSON.stringify([...new FormData(form)].filter(([k]) => SERIES_FIELDS.includes(k)).concat([['calendar', fCal.value]]));
  form.querySelectorAll('input[name=kind]').forEach(r => r.addEventListener('change', syncFormUI));
  document.getElementById('fAllDay').addEventListener('change', syncFormUI);
  document.getElementById('fFreq').addEventListener('change', syncFormUI);

  // Start/End linkage: moving Start shifts End by the same duration; End never sits at/before Start.
  const dtOf = (d, t) => d ? new Date(`${d}T${t || '00:00'}:00Z`) : null;
  function readSE() {
    const allDay = f('allDay').checked;
    return { allDay, s: dtOf(f('startDate').value, allDay ? '00:00' : f('startTime').value || '09:00'),
      e: dtOf(f('endDate').value || f('startDate').value, allDay ? '00:00' : f('endTime').value || '10:00') };
  }
  function writeEnd(e, allDay) { f('endDate').value = ymd(e); if (!allDay) f('endTime').value = hm(e); }
  function syncEndMin() {
    const sd = f('startDate').value; f('endDate').min = sd || '';
    f('endTime').min = (!f('allDay').checked && sd && f('endDate').value === sd) ? (f('startTime').value || '') : '';
  }
  function clampEnd() {
    const { allDay, s, e } = readSE(); if (!s) return;
    if (allDay) { if (!e || e < s) writeEnd(s, true); }
    else if (!e || e <= s) writeEnd(new Date(s.getTime() + 3600000), false);
  }
  function onStartChange() {
    const { allDay, s } = readSE(); const prev = editing && editing.prevSE;
    if (s && prev && prev.s && prev.e && prev.allDay === allDay) {
      let dur = prev.e - prev.s; if (allDay ? dur < 0 : dur <= 0) dur = allDay ? 0 : 3600000;
      writeEnd(new Date(s.getTime() + dur), allDay);
    }
    clampEnd(); syncEndMin(); rememberSE();
  }
  function onEndChange() { clampEnd(); syncEndMin(); rememberSE(); }
  function rememberSE() { if (editing) editing.prevSE = readSE(); }
  ['startDate', 'startTime'].forEach(n => f(n).addEventListener('change', onStartChange));
  ['endDate', 'endTime'].forEach(n => f(n).addEventListener('change', onEndChange));
  document.getElementById('fAllDay').addEventListener('change', () => { clampEnd(); syncEndMin(); rememberSE(); });

  function syncFormUI() {
    const isTask = kind() === 'task';
    document.getElementById('taskFields').hidden = !isTask;
    document.getElementById('startLabel').textContent = isTask ? 'Due / date' : 'Start';
    const allDay = f('allDay').checked;
    form.querySelectorAll('.time-field').forEach(el => el.hidden = allDay);
    document.getElementById('endRow').hidden = isTask && allDay;
    recurFs.hidden = !!(editing && editing.exception);
    fCal.disabled = !!(editing && editing.exception);       // a changed occurrence stays on its series' calendar
    const freq = f('freq').value;
    document.getElementById('intervalWrap').hidden = freq === 'none';
    document.getElementById('untilWrap').hidden = freq === 'none';
    weekdayWrap.hidden = freq !== 'weekly';
    document.getElementById('intervalUnit').textContent = { daily: 'day(s)', weekly: 'week(s)', monthly: 'month(s)', yearly: 'year(s)' }[freq] || '';
    const note = document.getElementById('occurrenceNote');
    if (editing && editing.exception) {
      note.hidden = false; note.textContent = `This is one changed occurrence (originally ${editing.originalDate}) of a repeating series. Edits here don't affect the rest of the series.`;
    } else if (editing && editing.recurring) {
      note.hidden = false;
      note.textContent = editing.occKey ? `Repeating event: when you save, you'll choose "This event only" (${editing.occKey}) or "All events in the series".${isTask ? ` "Done" applies only to ${editing.occKey}.` : ''}`
        : `Repeating event: changes apply to every occurrence.`;
    } else note.hidden = true;
  }

  // MSC client sessions / reach-outs / check-ins: bold + underlined titles in List and Day view
  const CLIENT_KEY_CATS = new Set(['clientsession', 'clientreachout', 'clientcheckin']);
  function isClientKey(ev) { return ev.calendar === 'msc' && CLIENT_KEY_CATS.has(String(ev.category || '').toLowerCase().replace(/[^a-z]/g, '')); }

  async function openEditor(id, occKey, prefill = {}) {
    form.reset();
    const ev = id ? await Store.get(id) : null;
    const recurring = !!(ev && isRecurring(ev));
    editing = { id, occKey, recurring, exception: !!(ev && ev.seriesId), originalDate: ev && ev.originalDate };
    const d = ev || Object.assign({
      kind: 'event', calendar: firstVisibleCal(), allDay: false, recurrence: { freq: 'none', interval: 1 },
      start: `${ymd(nowWall())}T09:00`, end: `${ymd(nowWall())}T10:00`,
    }, prefill);
    document.getElementById('dialogTitle').textContent = ev ? (d.kind === 'task' ? 'Edit task' : 'Edit event') : (d.kind === 'task' ? 'New task' : 'New event');
    form.querySelector(`input[name=kind][value=${d.kind || 'event'}]`).checked = true;
    f('title').value = d.title || '';
    fCal.value = d.calendar;
    fillCategories(d.calendar, d.category || (d.kind === 'task' && (d.calendar === 'lifetime' || !PRESETS[d.calendar]) ? 'Task / to-do' : null));
    f('allDay').checked = !!d.allDay;
    // For a repeating event, show the clicked occurrence's date/time.
    let s = parseLocal(d.start), e = d.end ? parseLocal(d.end) : null;
    if (recurring && occKey) {
      const os = occurrenceStart(ev, occKey);
      if (e) e = new Date(os.getTime() + (e - s));
      s = os;
    }
    editing.shownStart = s; editing.shownEnd = e;
    f('startDate').value = ymd(s); f('startTime').value = d.allDay ? '09:00' : hm(s);
    f('endDate').value = e ? ymd(e) : ymd(s); f('endTime').value = e && !d.allDay ? hm(e) : '10:00';
    const r = d.recurrence || { freq: 'none' };
    f('freq').value = r.freq || 'none'; f('interval').value = r.interval || 1; f('until').value = r.until || '';
    const wds = (r.byWeekday && r.byWeekday.length) ? r.byWeekday.map(String) : [String(parseLocal(d.start).getUTCDay())];
    form.querySelectorAll('input[name=wd]').forEach(cb => cb.checked = wds.includes(cb.value));
    f('scope').value = d.scope || 'day';
    f('done').checked = ev ? isDone(ev, occKey) : false;
    f('location').value = d.location || ''; f('notes').value = d.notes || '';
    if (window.SandyGames) SandyGames.editor(document.getElementById('gameDir'), ev ? d : null);
    renderReminders(d.reminders || []);
    document.getElementById('notesLabel').textContent = recurring ? 'Notes (every occurrence)' : 'Notes';
    await setupDayNote(ev, occKey);
    await setupChecklist(ev, occKey);
    document.getElementById('deleteBtn').hidden = !ev;
    document.getElementById('restoreBtn').hidden = !(ev && ev.seriesId);
    syncFormUI();
    clampEnd(); syncEndMin(); rememberSE();
    editing.snap = formSnap(); editing.seriesSnap = seriesSnap();
    if (locAC) { locAC.reset(); Places.warm(); } // lazy-load Google Places only once the form opens
    dlg.showModal();
    if (!ev) f('title').focus();
  }

  // ---------- Checklist: '- [ ] item' lines in Notes become checkboxes, ticked per occurrence date ----------
  const ckBox = document.getElementById('checklistBox'), ckList = document.getElementById('checklistItems'), ckStatus = document.getElementById('checklistStatus');
  let ckCtx = null;
  const ckKey = t => t.toLowerCase().replace(/\s+/g, ' ').trim();
  function parseChecklist(text) {
    const out = [];
    for (const line of String(text || '').split('\n')) {
      const m = line.match(/^\s*[-*]\s*\[( |x|X)?\]\s*(.+?)\s*$/);
      if (m && !out.some(o => o.key === ckKey(m[2]))) out.push({ text: m[2], key: ckKey(m[2]) });
    }
    return out;
  }
  async function setupChecklist(ev, occKey) {
    ckCtx = null; ckStatus.textContent = '';
    if (!ev || (isRecurring(ev) && !occKey)) { ckBox.hidden = true; return; }
    const nk = noteKeyFor(ev, occKey);
    ckCtx = { ...nk, checked: await Store.checks.get(nk.eventId, nk.date) };
    document.getElementById('checklistDate').textContent = fmtNoteDay(nk.date);
    renderChecklist();
  }
  function renderChecklist() {
    const items = ckCtx ? parseChecklist(f('notes').value) : [];
    ckBox.hidden = !items.length; if (!items.length) return;
    const on = new Set(ckCtx.checked), ok = Store.checks.available;
    ckList.innerHTML = '';
    for (const it of items) {
      const li = document.createElement('li'), lb = document.createElement('label'), cb = document.createElement('input'), sp = document.createElement('span');
      cb.type = 'checkbox'; cb.checked = on.has(it.key); cb.disabled = !ok; cb.dataset.key = it.key; sp.textContent = it.text;
      cb.addEventListener('change', () => toggleCheck(it.key, cb.checked));
      lb.append(cb, sp); li.append(lb); ckList.append(li);
    }
    const done = items.filter(i => on.has(i.key)).length;
    if (!ckStatus.textContent || /done$/.test(ckStatus.textContent)) ckStatus.textContent = `${done}/${items.length} done`;
    document.getElementById('checklistHelp').textContent = ok
      ? 'Ticks save right away, for this date only. Add items as "- [ ] item" lines in Notes.'
      : 'Checklist ticks need a one-time database update before they can save (see README → Checklists).';
  }
  async function toggleCheck(key, on) {
    const c = ckCtx; if (!c) return;
    const prev = c.checked;
    c.checked = on ? [...new Set([...prev, key])] : prev.filter(k => k !== key);
    ckStatus.textContent = 'Saving…';
    try { await Store.checks.set(c.eventId, c.date, c.checked); ckStatus.textContent = 'Saved'; setTimeout(() => { if (ckCtx === c) { ckStatus.textContent = ''; renderChecklist(); } }, 900); }
    catch (err) { c.checked = prev; ckStatus.textContent = 'Not saved'; renderChecklist(); fail(err); }
  }
  f('notes').addEventListener('input', () => { if (ckCtx) renderChecklist(); });

  // ---------- Today's Note (day-specific note; separate storage, never edits the event) ----------
  const dayBox = document.getElementById('dayNoteBox'), dayTa = document.getElementById('dayNote'), dayStatus = document.getElementById('dayNoteStatus');
  let dayCtx = null, dayTimer = 0;
  const fmtNoteDay = date => parseLocal(date).toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric', timeZone: 'UTC' });
  function formSnap() { return JSON.stringify([...new FormData(form)].filter(([k]) => k !== 'applyTo')); }
  async function setupDayNote(ev, occKey) {
    clearTimeout(dayTimer); dayCtx = null; dayStatus.textContent = ''; dayTa.value = '';
    if (!ev || (isRecurring(ev) && !occKey)) { dayBox.hidden = true; return; }
    const nk = noteKeyFor(ev, occKey);
    dayBox.hidden = false;
    document.getElementById('dayNoteDate').textContent = `Note for ${fmtNoteDay(nk.date)}`;
    const n = await Store.notes.get(nk.eventId, nk.date);
    dayTa.disabled = !Store.notes.available;
    document.getElementById('dayNoteHelp').textContent = Store.notes.available
      ? "Saves automatically. Other dates of this event won't show it. Clear the text to delete it."
      : "Today's Note needs a one-time database update before it can save (see README → Day notes).";
    dayTa.value = n ? n.body : '';
    const nl = document.getElementById('dayNoteNotion'); const url = await Store.links.get(nk.eventId, nk.date);
    if (nl) { nl.replaceChildren(); nl.hidden = !url; if (url) { const a = notionLinkEl(url); a.append(' Open in Notion'); nl.append(a); } }
    dayCtx = { ...nk, saved: dayTa.value };
    requestAnimationFrame(growDayNote);
  }
  async function flushDayNote() {
    clearTimeout(dayTimer);
    const c = dayCtx; if (!c || !Store.notes.available) return;
    const body = dayTa.value.trim(); if (body === c.saved.trim()) return;
    dayStatus.textContent = 'Saving…';
    try { await Store.notes.set(c.eventId, c.date, body); c.saved = body; dayStatus.textContent = body ? 'Saved' : 'Deleted'; scheduleRefresh(); }
    catch (err) { dayStatus.textContent = 'Not saved'; fail(err); }
  }
  // Auto-grow Today's Note up to its CSS max-height (~14 lines), then scroll. Never shrinks below a manual resize.
  function growDayNote() {
    if (dayBox.hidden) return;
    const manual = dayTa.dataset.userH ? +dayTa.dataset.userH : 0;
    dayTa.style.height = 'auto';
    const max = parseFloat(getComputedStyle(dayTa).maxHeight) || Infinity;
    dayTa.style.height = Math.min(Math.max(dayTa.scrollHeight + 2, manual), max) + 'px';
  }
  dayTa.addEventListener('pointerup', () => { if (dayTa.style.height && dayTa.offsetHeight !== parseFloat(dayTa.style.height)) dayTa.dataset.userH = dayTa.offsetHeight; });
  dayTa.addEventListener('input', growDayNote);
  dlg.addEventListener('close', () => { delete dayTa.dataset.userH; dayTa.style.height = ''; });
  dayTa.addEventListener('input', () => { clearTimeout(dayTimer); dayStatus.textContent = ''; dayTimer = setTimeout(flushDayNote, 700); });
  dayTa.addEventListener('blur', flushDayNote);
  dlg.addEventListener('close', flushDayNote);

  /** Read the form into a plain object of fields (no id / recurrence bookkeeping). */
  async function readForm(calId) {
    const v = { kind: kind(), title: f('title').value.trim(), calendar: calId };
    let cat = fCat.value;
    if (cat === CUSTOM) {
      cat = f('customCategory').value.trim() || 'Other';
      if (!CAL[calId].categories.includes(cat) && !(customCats[calId] || []).includes(cat)) { await Store.addCategory(calId, cat); await loadCats(); }
    }
    v.category = cat;
    v.allDay = f('allDay').checked;
    const sd = f('startDate').value; let ed = f('endDate').value || sd;
    if (v.kind === 'task' && v.allDay) ed = sd;
    if (v.allDay) { v.start = sd; v.end = ed < sd ? sd : ed; }
    else {
      v.start = `${sd}T${f('startTime').value || '09:00'}`;
      v.end = `${ed}T${f('endTime').value || '10:00'}`;
      if (parseLocal(v.end) <= parseLocal(v.start)) { const x = new Date(parseLocal(v.start).getTime() + 3600000); v.end = `${ymd(x)}T${hm(x)}`; }
    }
    v.location = f('location').value.trim();
    v.notes = f('notes').value.trim();
    if (v.kind === 'task') v.scope = f('scope').value;
    v.reminders = readReminders();
    return v;
  }

  // ---------- Reminders: up to 6 per event/to-do, minutes .. 6 months before (like Google Calendar) ----------
  const REM_UNITS = [['minutes', 1], ['hours', 60], ['days', 1440], ['weeks', 10080], ['months', 44640]];
  const REM_MAX = 267840, remList = document.getElementById('remList'), remAdd = document.getElementById('remAdd');
  const remSplit = m => { for (let i = REM_UNITS.length - 1; i > 0; i--) if (m && m % REM_UNITS[i][1] === 0) return [m / REM_UNITS[i][1], REM_UNITS[i][0]]; return [m, 'minutes']; };
  function remRow(m, animate) {
    const [n, u] = remSplit(m);
    const li = document.createElement('li'); li.className = 'rem-row' + (animate ? ' msg-up' : '');
    li.innerHTML = `<input type="number" name="remN" min="0" max="999" step="1" inputmode="numeric" aria-label="How long before" required>
      <select name="remU" aria-label="Unit">${REM_UNITS.map(([k]) => `<option value="${k}">${k}</option>`).join('')}</select>
      <span class="muted">before</span><button type="button" class="rem-del icon-btn" aria-label="Remove reminder">✕</button>`;
    li.querySelector('input').value = n; li.querySelector('select').value = u;
    li.querySelector('.rem-del').addEventListener('click', () => { li.remove(); syncRem(); remAdd.focus(); });
    remList.append(li);
  }
  function syncRem() { remAdd.hidden = remList.children.length >= 6; document.getElementById('remHint').hidden = !(f('allDay').checked && remList.children.length); }
  function renderReminders(list) { remList.innerHTML = ''; [...list].slice(0, 6).forEach(m => remRow(m)); syncRem(); }
  function readReminders() {
    const out = [...remList.children].map(li => {
      const n = Math.max(0, Math.round(+li.querySelector('input').value || 0));
      const u = (REM_UNITS.find(([k]) => k === li.querySelector('select').value) || REM_UNITS[0])[1];
      return Math.min(REM_MAX, n * u);
    });
    return [...new Set(out)].sort((a, b) => a - b).slice(0, 6);
  }
  function afterReminders(list) {
    if (!list || !list.length) return;
    if (Store.adapter && Store.adapter.remindersSupported === false) { setTimeout(() => toast('Saved. Reminders turn on after the database update.'), 1600); return; }
    if (window.SandyPush) window.SandyPush.nudge();
  }
  remAdd.addEventListener('click', () => {
    const used = new Set(readReminders()); const pick = (f('allDay').checked ? [1440, 0, 10080] : [30, 10, 60, 1440]).find(m => !used.has(m)) ?? 0;
    remRow(pick, true); syncRem(); remList.lastElementChild.querySelector('input').focus();
  });
  f('allDay').addEventListener('change', syncRem);

  document.getElementById('cancelBtn').addEventListener('click', () => dlg.close());
  form.addEventListener('submit', async e => {
    e.preventDefault();
    try {
      const existing = editing.id ? await Store.get(editing.id) : null;
      await flushDayNote();
      // Nothing but Today's Note changed: don't rewrite the event (and never detach an occurrence).
      if (existing && formSnap() === editing.snap) { dlg.close(); toast('Saved'); refresh(); return; }
      let scope = 'all';
      if (existing && editing.recurring && editing.occKey) {
        const seriesChanged = seriesSnap() !== editing.seriesSnap;
        scope = await askScope({ mode: 'save', occKey: editing.occKey, title: f('title').value.trim() || existing.title,
          oneDisabledReason: seriesChanged ? 'You changed the calendar, type or repeat rule, which can only apply to the whole series.' : '' });
        if (!scope) return; // Cancel: stay in the editor, nothing saved
      }
      const calId = existing && (existing.seriesId || scope === 'one') ? existing.calendar : fCal.value;
      const v = await readForm(calId);

      // (1) only this occurrence of a repeating item
      if (scope === 'one') {
        const changes = { ...v, kind: existing.kind };
        if (existing.kind === 'task') changes.done = f('done').checked;
        await Store.saveMany(detachOccurrence(existing, editing.occKey, changes));
        dlg.close(); toast('Saved this event only'); refresh(); afterReminders(v.reminders); return;
      }

      const ev = existing ? { ...existing } : {};
      Object.assign(ev, v);
      // (2) whole series, opened from one occurrence: shift the series by the same amount
      if (existing && editing.recurring && editing.occKey) {
        Object.assign(ev, shiftSeries(existing, editing.shownStart, v));
      }
      if (!ev.seriesId) {
        const freq = f('freq').value;
        ev.recurrence = freq === 'none' ? { freq: 'none' } : {
          freq, interval: Math.max(1, +f('interval').value || 1), until: f('until').value || null,
          byWeekday: freq === 'weekly' ? [...form.querySelectorAll('input[name=wd]:checked')].map(cb => +cb.value) : undefined,
        };
      }
      if (ev.kind === 'task') {
        const key = editing.occKey || ymd(parseLocal(ev.start));
        if (isRecurring(ev)) { const set = new Set(ev.completedDates || []); f('done').checked ? set.add(key) : set.delete(key); ev.completedDates = [...set]; delete ev.done; }
        else ev.done = f('done').checked;
      } else { delete ev.scope; delete ev.done; delete ev.completedDates; }
      await Store.save(ev);
      dlg.close(); toast(scope === 'all' && editing.recurring ? 'Saved all events in the series' : 'Saved'); refresh();
      afterReminders(v.reminders);
    } catch (err) { fail(err); }
  });

  document.getElementById('deleteBtn').addEventListener('click', async () => {
    const ev = await Store.get(editing.id); if (!ev) return;
    try {
      if (isRecurring(ev)) {
        const choice = editing.occKey ? await askScope({ mode: 'delete', occKey: editing.occKey, title: ev.title }) : (confirm(`Delete every occurrence of "${ev.title}"?`) ? 'all' : null);
        if (!choice) return;
        if (choice === 'one') { ev.exdates = [...new Set([...(ev.exdates || []), editing.occKey])]; await Store.save(ev); }
        else await Store.remove(ev.id);
        dlg.close(); toast(choice === 'one' ? 'Deleted this event only' : 'Deleted all events in the series'); refresh();
      } else if (confirm(ev.seriesId ? `Delete this occurrence of "${ev.title}"?` : `Delete "${ev.title}"?`)) {
        await Store.remove(ev.id); dlg.close(); toast('Deleted'); refresh();
      }
    } catch (err) { fail(err); }
  });
  document.getElementById('restoreBtn').addEventListener('click', async () => {
    const ev = await Store.get(editing.id); if (!ev || !ev.seriesId) return;
    if (!confirm('Undo the changes to this occurrence and put it back to match the series?')) return;
    try {
      const parent = await Store.get(ev.seriesId);
      await Store.remove(ev.id);
      if (parent) { parent.exdates = (parent.exdates || []).filter(d => d !== ev.originalDate); await Store.save(parent); }
      dlg.close(); toast('Restored'); refresh();
    } catch (err) { fail(err); }
  });

  // ---------- Buttons ----------
  document.getElementById('addBtn').addEventListener('click', () => openEditor(null, null, {}));
  document.getElementById('addTaskBtn').addEventListener('click', () => {
    const scope = settings.taskScope;
    openEditor(null, null, { kind: 'task', calendar: taskCal(), category: 'Task / to-do', allDay: true, start: ymd(nowWall()), end: ymd(nowWall()), scope });
  });
  document.getElementById('exportBtn').addEventListener('click', async () => {
    const blob = new Blob([await Store.exportJSON()], { type: 'application/json' });
    const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(blob), download: `scott-calendars-${ymd(nowWall())}.json` });
    document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  });
  const importFile = document.getElementById('importFile');
  document.getElementById('importBtn').addEventListener('click', () => importFile.click());
  importFile.addEventListener('change', async () => {
    const file = importFile.files[0]; if (!file) return;
    try {
      const replace = confirm('Replace ALL current events with the file?\n\nOK = replace everything\nCancel = merge (keep current events, add/update from file)');
      const n = await Store.importJSON(await file.text(), replace ? 'replace' : 'merge');
      await loadCats(); toast(`Imported ${n} item(s)`); refresh();
    } catch (err) { alert('Import failed: ' + err.message); }
    importFile.value = '';
  });
  document.getElementById('clearExamplesBtn').addEventListener('click', async () => {
    if (!confirm('Remove all events marked "Example"?')) return;
    try { await Store.removeWhere(e => e.example); toast('Examples removed'); } catch (err) { fail(err); }
    refresh();
  });

  // ---------- Sync status, sign-out, one-time migration ----------
  const storageNote = document.getElementById('storageNote');
  if (Store.mode === 'supabase') {
    const user = await Store.auth.user();
    storageNote.textContent = `Synced across your devices and bots. Signed in as ${user ? user.email : '?'}.`;
    document.getElementById('syncBtns').hidden = false;
    document.getElementById('signOutBtn').addEventListener('click', async () => { await Store.auth.signOut(); location.reload(); });
    if (window.SandyAccount) window.SandyAccount.mountAccount({ store: Store, user, mount: document.getElementById('dataSection') });
    if (window.SandyPush) window.SandyPush.mount({ store: Store, user });
    if (window.SandyLaunch) window.SandyLaunch.mount({ store: Store, user, timeZone: () => TZ, setTZ: z => { if (setTZ(z)) { calendar.render(); refresh(); } } });
    if (window.SandyWelcome) { window.SandyWelcome.mountRow({ user }); window.SandyWelcome.maybeShow({ user }); } // one-time beta welcome (welcome.js)
    document.getElementById('syncNowBtn').addEventListener('click', () => reloadFromServer(true));
    const local = await Store.localDataForMigration();
    if (local) {
      const box = document.getElementById('migrateBox');
      box.hidden = false;
      document.getElementById('migrateText').textContent =
        `This device still has ${local.real} event(s)${local.examples ? ` and ${local.examples} example(s)` : ''} saved from before syncing was turned on.`;
      document.getElementById('migrateBtn').addEventListener('click', async () => {
        const withEx = local.examples ? confirm(`Also copy the ${local.examples} example events?\n\nOK = yes, include examples\nCancel = only my real events`) : false;
        try { const n = await Store.migrateLocal({ includeExamples: withEx }); await loadCats(); box.hidden = true; toast(`Copied ${n} item(s) to the shared calendar`); refresh(); }
        catch (err) { fail(err); }
      });
      document.getElementById('migrateSkipBtn').addEventListener('click', () => { Store.skipMigration(); box.hidden = true; });
    }
    // live updates from the bots / other devices
    if (Store.adapter.subscribe) { try { Store.adapter.subscribe((t, p) => Store.applyRemoteChange(t, p)); } catch (e) { console.warn('Realtime unavailable', e); } }
    Store.onChange(async why => { if (why === 'checks') { if (ckCtx && dlg.open) { ckCtx.checked = await Store.checks.get(ckCtx.eventId, ckCtx.date); renderChecklist(); } return; } if (why === 'notes') { scheduleRefresh(); return; } if (why === 'categories' || why === 'reload') await loadCats(); scheduleRefresh(); });
    let lastReload = Date.now();
    async function reloadFromServer(manual) {
      try { await Store.reload(); lastReload = Date.now(); if (manual) toast('Up to date'); } catch (err) { if (manual) fail(err); else console.warn(err); }
    }
    const maybeReload = () => { if (document.visibilityState === 'visible' && Date.now() - lastReload > 10000) reloadFromServer(false); };
    document.addEventListener('visibilitychange', maybeReload);
    window.addEventListener('focus', maybeReload);
    window.addEventListener('online', () => reloadFromServer(false));
    setInterval(() => { if (document.visibilityState === 'visible') reloadFromServer(false); }, 5 * 60 * 1000); // safety net
  } else {
    storageNote.textContent = `Saved on this device only (${Store.adapterName}). Use Export/Import to move data between devices.` +
      (Store.configError ? ` Sync is off: ${Store.configError}` : '');
  }

  // The left menu is retired (bottom navigation, 2026-10-24): Notes Review now lives on the Search tab.
  const drawer = open => { if (open && window.SandyNav) window.SandyNav.go('search'); };
  const sidebar = { classList: { contains: () => false } };

  // ---------- Notes Review (browse Today's Notes by day / week / month / season / year) ----------
  const RV_SCOPES = ['day', 'week', 'month', 'season', 'year'];
  const rv = { scope: 'day', ref: startOfDay(nowWall()), cals: new Set(CALENDARS.filter(c => settings.visible[c.id]).map(c => c.id)), calsTouched: false, event: '', q: '' };
  const $ = id => document.getElementById(id);
  const rvList = $('reviewList'), rvDate = $('reviewDate'), rvEvent = $('reviewEvent');
  function reviewRange(scope = rv.scope, ref = rv.ref) {
    if (scope === 'year') return [W(ref.getUTCFullYear(), 0, 1), W(ref.getUTCFullYear() + 1, 0, 1)];
    if (scope === 'season') return seasonPeriod(seasonOf(ref), ref);
    return periodFor(scope, ref);
  }
  function reviewTitle(ps, pe) {
    const last = addDays(pe, -1);
    if (rv.scope === 'day') return ps.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
    if (rv.scope === 'week') return `${fmtShort(ps)} – ${fmtShort(last, true)}`;
    if (rv.scope === 'month') return ps.toLocaleDateString('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' });
    if (rv.scope === 'season') return seasonTitle(seasonOf(rv.ref), rv.ref);
    return String(ps.getUTCFullYear());
  }
  function shiftReview(dir) {
    const r = rv.ref, y = r.getUTCFullYear(), m = r.getUTCMonth();
    rv.ref = rv.scope === 'day' ? addDays(r, dir) : rv.scope === 'week' ? addDays(r, 7 * dir)
      : rv.scope === 'month' ? W(y, m + dir, 1) : rv.scope === 'season' ? W(y, m + 3 * dir, 1) : W(y + dir, 0, 1);
  }
  /** Resolve every day note to what it's attached to (series occurrence or changed occurrence). */
  async function reviewItems() {
    const evs = await Store.list(); const byId = new Map(evs.map(e => [e.id, e]));
    const excBy = new Map(evs.filter(e => e.seriesId).map(e => [`${e.seriesId}|${e.originalDate}`, e]));
    const out = [];
    for (const n of await Store.notes.all()) {
      const series = byId.get(n.eventId); if (!series) continue;
      const exc = excBy.get(`${n.eventId}|${n.date}`);
      const ev = exc || series;
      const start = exc ? parseLocal(exc.start) : isRecurring(series) ? occurrenceStart(series, n.date) : parseLocal(series.start);
      const end = ev.end ? new Date(start.getTime() + (parseLocal(ev.end) - parseLocal(ev.start))) : null;
      out.push({ note: n, ev, seriesId: n.eventId, date: ymd(start), start, end, open: exc ? [exc.id, null] : [series.id, isRecurring(series) ? n.date : null] });
    }
    return out.sort((a, b) => a.start - b.start);
  }
  function renderReviewChrome() {
    for (const b of $('reviewScope').querySelectorAll('button')) b.setAttribute('aria-pressed', String(b.dataset.scope === rv.scope));
    $('reviewDayPick').hidden = rv.scope !== 'day';
    rvDate.value = ymd(rv.ref);
    const chips = $('reviewChips'); chips.innerHTML = '';
    const sun = addDays(rv.ref, -rv.ref.getUTCDay());
    for (let i = 0; i < 7; i++) {
      const d = addDays(sun, i); const b = document.createElement('button'); b.type = 'button';
      b.textContent = d.toLocaleDateString('en-US', { weekday: 'short', timeZone: 'UTC' }); b.dataset.date = ymd(d);
      b.setAttribute('aria-label', d.toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric', timeZone: 'UTC' }));
      b.setAttribute('aria-pressed', String(ymd(d) === ymd(rv.ref))); if (ymd(d) === ymd(nowWall())) b.classList.add('is-today');
      chips.appendChild(b);
    }
    const box = $('reviewCals'); box.innerHTML = '';
    for (const c of CALENDARS) {
      const l = document.createElement('label'); l.className = 'cal-toggle'; l.style.setProperty('--c', c.color);
      l.innerHTML = `<input type="checkbox" data-cal="${c.id}" ${rv.cals.has(c.id) ? 'checked' : ''}><span class="swatch"></span><span>${c.short}</span>`;
      box.appendChild(l);
    }
  }
  async function renderReview() {
    if (!rvList) return;
    if (!rv.calsTouched) rv.cals = new Set(CALENDARS.filter(c => settings.visible[c.id]).map(c => c.id));
    renderReviewChrome();
    const [ps, pe] = reviewRange();
    $('reviewPeriod').textContent = reviewTitle(ps, pe);
    const all = await reviewItems();
    // event filter options: every event/series that has at least one day note
    const opts = new Map(); for (const it of all) if (!opts.has(it.seriesId)) opts.set(it.seriesId, it.ev.seriesId ? (all.find(x => x.seriesId === it.seriesId && !x.ev.seriesId)?.ev.title || it.ev.title) : it.ev.title);
    if (rv.event && !opts.has(rv.event)) rv.event = '';
    rvEvent.innerHTML = '<option value="">All events</option>' + [...opts].sort((a, b) => a[1].localeCompare(b[1])).map(([id, t]) => `<option value="${id}">${escapeHtml(t)}</option>`).join('');
    rvEvent.value = rv.event;
    const q = rv.q.trim().toLowerCase(); const s0 = ymd(ps), e0 = ymd(pe);
    const items = all.filter(it => it.date >= s0 && it.date < e0 && rv.cals.has(it.ev.calendar) && (!rv.event || it.seriesId === rv.event)
      && (!q || it.note.body.toLowerCase().includes(q) || it.ev.title.toLowerCase().includes(q)));
    const nf = (rv.cals.size < CALENDARS.length ? 1 : 0) + (rv.event ? 1 : 0) + (q ? 1 : 0);
    $('reviewFilterSummary').textContent = nf ? `(${nf} on)` : '';
    $('reviewCount').textContent = items.length ? `(${items.length})` : '';
    rvList.innerHTML = '';
    if (!Store.notes.available) { rvList.innerHTML = `<p class="empty">Today's Notes need a one-time database update first.</p>`; return; }
    if (!items.length) {
      const what = { day: 'this day', week: 'this week', month: 'this month', season: 'this season', year: 'this year' }[rv.scope];
      rvList.innerHTML = `<p class="empty">${nf ? 'No notes match these filters for ' + what + '.' : 'No Today\'s Notes for ' + what + '. Open any event and write one under 📌 Today\'s Note.'}</p>`;
      return;
    }
    let curDate = null, group = null;
    for (const it of items) {
      if (it.date !== curDate) {
        curDate = it.date; group = document.createElement('div'); group.className = 'review-day';
        const h = document.createElement('h3'); h.textContent = fmtNoteDay(it.date); group.appendChild(h); rvList.appendChild(group);
      }
      const c = CAL[it.ev.calendar] || CALENDARS[0];
      const b = document.createElement('button'); b.type = 'button'; b.className = 'review-item'; b.style.setProperty('--c', c.color);
      const tm = it.ev.allDay ? 'All day' : `${fmtNow(it.start)}${it.end ? ' – ' + fmtNow(it.end) : ''}`;
      b.innerHTML = `<span class="ri-head"><span class="swatch"></span><span class="ri-title"></span></span><span class="ri-meta"></span><span class="ri-body"></span>`;
      b.querySelector('.ri-title').textContent = it.ev.title;
      b.querySelector('.ri-meta').textContent = `${tm} · ${c.short}`;
      b.querySelector('.ri-body').textContent = it.note.body;
      b.setAttribute('aria-label', `${it.ev.title}, ${fmtNoteDay(it.date)} ${tm}, ${c.name}. Note: ${it.note.body}`);
      b.addEventListener('click', () => { if (sidebar.classList.contains('open')) drawer(false); openEditor(it.open[0], it.open[1]); });
      group.appendChild(b);
    }
  }
  const rvRender = (dir = 0) => renderReview().then(() => window.Motion && Motion.swap(rvList, dir));
  $('reviewScope').addEventListener('click', e => {
    const b = e.target.closest('button[data-scope]'); if (!b || b.dataset.scope === rv.scope) return;
    const dir = RV_SCOPES.indexOf(b.dataset.scope) > RV_SCOPES.indexOf(rv.scope) ? 1 : -1; rv.scope = b.dataset.scope; rvRender(dir);
  });
  $('reviewPrev').addEventListener('click', () => { shiftReview(-1); rvRender(-1); });
  $('reviewNext').addEventListener('click', () => { shiftReview(1); rvRender(1); });
  rvDate.addEventListener('change', () => { if (rvDate.value) { rv.ref = parseLocal(rvDate.value); rvRender(0); } });
  $('reviewChips').addEventListener('click', e => { const b = e.target.closest('button[data-date]'); if (b) { rv.ref = parseLocal(b.dataset.date); rvRender(0); } });
  $('reviewCals').addEventListener('change', e => { const id = e.target.dataset.cal; if (!id) return; rv.calsTouched = true; e.target.checked ? rv.cals.add(id) : rv.cals.delete(id); renderReview(); });
  rvEvent.addEventListener('change', () => { rv.event = rvEvent.value; renderReview(); });
  let rvQT; $('reviewSearch').addEventListener('input', e => { clearTimeout(rvQT); rvQT = setTimeout(() => { rv.q = e.target.value; renderReview(); }, 200); });
  $('reviewClear').addEventListener('click', () => { rv.calsTouched = false; rv.event = ''; rv.q = ''; $('reviewSearch').value = ''; renderReview(); });
  // deep link: ?review=day|week|month|season|year&date=YYYY-MM-DD (also restored after sign-in)
  {
    const want = params.get('review') || (reviewLink && reviewLink.review);
    const wd = params.get('date') || (reviewLink && reviewLink.date);
    if (want && RV_SCOPES.includes(want)) {
      rv.scope = want;
      if (wd && /^\d{4}-\d{2}-\d{2}$/.test(wd)) rv.ref = parseLocal(wd);
      requestAnimationFrame(() => {
        drawer(true);
        const sec = $('reviewSection'); sec.scrollIntoView({ block: 'start' }); sec.classList.add('flash');
        setTimeout(() => sec.classList.remove('flash'), 1200);
        $('reviewTitle').setAttribute('tabindex', '-1'); $('reviewTitle').focus({ preventScroll: true });
      });
    }
  }
  // ---------- Misc ----------
  function firstVisibleCal() { return (CALENDARS.find(c => settings.visible[c.id]) || CALENDARS[0]).id; }
  function escapeHtml(s) { return s.replace(/[&<>"]/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch])); }
  let toastTimer;
  function toast(msg, ms = 1800) { const t = document.getElementById('toast'); t.textContent = msg; t.hidden = false; clearTimeout(toastTimer); toastTimer = setTimeout(() => t.hidden = true, ms); }
  function fail(err) { console.error(err); toast('Could not save: ' + (err && err.message ? err.message : err), 5000); }
  let refreshTimer;
  function scheduleRefresh() { clearTimeout(refreshTimer); refreshTimer = setTimeout(refresh, 250); }
  async function refresh() { renderToggles(await Store.list()); calendar.refetchEvents(); renderTasks(); renderBriefing(); renderReview(); window.dispatchEvent(new Event('sandy:refresh')); }
  refresh();
  window.__app = { reviewState: () => ({ scope: rv.scope, ref: ymd(rv.ref), cals: [...rv.cals], event: rv.event, q: rv.q }), reviewRange, noteKeyFor, calendar, Store, occurrences, nowWall, parseLocal, ymd, hm, seasonOf, seasonPeriod, seasonTitle, briefPeriod, briefingItems, viewRef, decorateList, openEditor, moveEvent, detachOccurrence, refresh, isRecurring, isDone, toast, calendars: () => CALENDARS, timeZone: () => TZ, setTZ,
    setDone, overdueText, fmtDay, startOfDay, addDays, isClientKey, occurrenceStart, saveSettings, renderTasks, renderBriefing, firstVisibleCal,
    settings: () => settings, cal: id => CAL[id], VIEWS, user: () => signedInUser }; // handy for debugging / tests

  // ---------- Example seed data (relative to the current week) ----------
  function seedExamples() {
    const today = startOfDay(nowWall());
    const sun = addDays(today, -today.getUTCDay());
    const D = n => ymd(addDays(sun, n)); // 0 = this Sunday … 6 = Saturday
    const R = n => ymd(addDays(sun, n - 28)); // repeating series start 4 weeks back so month view is full
    const ev = (o) => Object.assign({ id: Store.uid(), kind: 'event', allDay: false, recurrence: { freq: 'none' }, notes: 'Example event – edit or delete me.', location: '', example: true }, o);
    const wk = (days) => ({ freq: 'weekly', interval: 1, byWeekday: days });
    const firstOfMonth = ymd(W(today.getUTCFullYear(), today.getUTCMonth(), 1));
    return [
      // MSC
      ev({ title: 'Study block (Example)', calendar: 'msc', category: 'Study time', start: `${R(1)}T05:00`, end: `${R(1)}T05:45`, recurrence: wk([1, 3, 5]) }),
      ev({ title: 'MSC client session (Example)', calendar: 'msc', category: 'Client session', start: `${R(2)}T18:30`, end: `${R(2)}T19:30`, recurrence: wk([2]) }),
      ev({ title: 'MSC client reach-outs (Example)', calendar: 'msc', category: 'Client reach-out', start: `${R(5)}T12:00`, end: `${R(5)}T12:30`, recurrence: wk([5]) }),
      ev({ title: 'MSC client check-in (Example)', calendar: 'msc', category: 'Client check-in', start: `${R(4)}T19:30`, end: `${R(4)}T20:00`, recurrence: wk([4]) }),
      // Minds Above Matters
      ev({ title: 'Maryville University practice (Example)', calendar: 'mam', category: 'Team practice – Maryville University', start: `${R(2)}T15:00`, end: `${R(2)}T17:00`, recurrence: wk([2, 4]), location: 'Maryville University' }),
      ev({ title: 'Jennings HS practice (Example)', calendar: 'mam', category: 'Team practice – Jennings High School', start: `${R(3)}T15:30`, end: `${R(3)}T17:30`, recurrence: wk([3]), location: 'Jennings High School' }),
      ev({ title: 'Brad Beal Elite EYBL practice (Example)', calendar: 'mam', category: 'Team practice – Brad Beal Elite (EYBL)', start: `${R(6)}T10:00`, end: `${R(6)}T12:00`, recurrence: wk([6]) }),
      ev({ title: 'Client workout (Example)', calendar: 'mam', category: 'Client workout', start: `${R(1)}T17:30`, end: `${R(1)}T18:30`, recurrence: wk([1, 3]) }),
      ev({ title: 'Film study (Example)', calendar: 'mam', category: 'Film study', start: `${R(1)}T20:00`, end: `${R(1)}T21:00`, recurrence: wk([1]) }),
      ev({ title: 'Program building (Example)', calendar: 'mam', category: 'Program building', start: `${R(0)}T14:00`, end: `${R(0)}T16:00`, recurrence: wk([0]) }),
      ev({ title: 'Client check-in calls (Example)', calendar: 'mam', category: 'Client check-in', start: `${R(2)}T19:45`, end: `${R(2)}T20:15`, recurrence: wk([2]) }),
      ev({ title: 'Monthly program upload (Example)', calendar: 'mam', category: 'Program upload', allDay: true, start: firstOfMonth, end: firstOfMonth, recurrence: { freq: 'monthly', interval: 1 } }),
      // Life Time
      ev({ title: 'Life Time shift (Example)', calendar: 'lifetime', category: 'Work shift', start: `${R(1)}T06:00`, end: `${R(1)}T14:30`, recurrence: wk([1, 2, 3, 4, 5]), location: 'Life Time' }),
      ev({ title: 'Weekly meeting – Bill & Sherita (Example)', calendar: 'lifetime', category: 'Weekly meeting – Bill & Sherita', start: `${R(3)}T10:00`, end: `${R(3)}T11:00`, recurrence: wk([3]), location: 'Life Time' }),
      ev({ kind: 'task', scope: 'day', title: 'Facility walk-through (Example)', calendar: 'lifetime', category: 'Task / to-do', allDay: true, start: R(1), end: R(1), recurrence: wk([1, 2, 3, 4, 5]), completedDates: [] }),
      ev({ kind: 'task', scope: 'week', title: 'Review maintenance work orders (Example)', calendar: 'lifetime', category: 'Task / to-do', allDay: true, start: R(5), end: R(5), recurrence: wk([5]), completedDates: [] }),
      ev({ kind: 'task', scope: 'month', title: 'Monthly supply inventory (Example)', calendar: 'lifetime', category: 'Task / to-do', allDay: true, start: ymd(addDays(W(today.getUTCFullYear(), today.getUTCMonth() + 1, 1), -3)), end: ymd(addDays(W(today.getUTCFullYear(), today.getUTCMonth() + 1, 1), -3)), done: false }),
      ev({ kind: 'task', scope: 'season', title: 'Seasonal HVAC / pool equipment check (Example)', calendar: 'lifetime', category: 'Task / to-do', allDay: true, start: D(4), end: D(4), done: false }),
    ];
  }
})();
