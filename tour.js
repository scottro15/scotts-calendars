/* tour.js: short optional guided tour for new / invited users (Scott 2026-10-26).
 * Sample calendars/events/to-dos are DISPLAY-ONLY in memory — never written to Supabase.
 * Removed on finish, skip, or reload mid-tour. Auto-offer once per user after welcome;
 * owner (OWNER_EMAIL) never auto-sees it but can replay from Profile. */
(function () {
  'use strict';
  const CFG = window.CALENDAR_CONFIG || {};
  const KEY = id => 'sandy.tour.v1:' + id;
  const ACTIVE = 'sandy.tour.active'; // session: mid-tour (cleared on finish/skip; cleaned on reload)
  const reduce = () => window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;
  const optedOut = () => { try { return localStorage.getItem('sandy.tour.off') === '1'; } catch (e) { return false; } };
  const done = user => { try { return !!localStorage.getItem(KEY(user.id)); } catch (e) { return false; } };
  const markDone = user => { try { if (user && user.id) localStorage.setItem(KEY(user.id), new Date().toISOString()); } catch (e) {} };
  const isOwner = user => !!(user && user.email && CFG.OWNER_EMAIL && user.email.toLowerCase() === String(CFG.OWNER_EMAIL).toLowerCase());
  const welcomeDismissed = user => {
    try {
      if (localStorage.getItem('sandy.welcome.off') === '1') return true;
      return !!(user && user.id && localStorage.getItem('sandy.welcome.v1:' + user.id));
    } catch (e) { return true; }
  };
  function shouldOffer(user) {
    // sandy.welcome.off also silences auto-offer so existing Playwright suites stay quiet
    let welcomeOff = false; try { welcomeOff = localStorage.getItem('sandy.welcome.off') === '1'; } catch (e) {}
    return !!(user && user.id) && !isOwner(user) && !done(user) && !optedOut() && !welcomeOff && welcomeDismissed(user);
  }

  const SAMPLE_CALS = [
    { slug: 'tour-work', name: 'Work', short: 'Work', color: '#2563eb' },
    { slug: 'tour-side', name: 'Side job', short: 'Side', color: '#ea580c' },
    { slug: 'tour-kids', name: 'Kids', short: 'Kids', color: '#16a34a' },
  ];
  function ymdOffset(days, h, mi) {
    const a = window.__app; if (!a) return null;
    const d = a.addDays ? a.addDays(a.startOfDay(a.nowWall()), days) : null;
    if (!d) return null;
    const y = d.getUTCFullYear(), m = d.getUTCMonth() + 1, day = d.getUTCDate();
    const pad = n => String(n).padStart(2, '0');
    const date = `${y}-${pad(m)}-${pad(day)}`;
    if (h == null) return date;
    return `${date}T${pad(h)}:${pad(mi || 0)}`;
  }
  function sampleEvents() {
    const a = window.__app; if (!a) return [];
    const today = ymdOffset(0), tomorrow = ymdOffset(1), yest = ymdOffset(-1);
    const mk = (o) => Object.assign({
      id: o.id, kind: o.kind || 'event', calendar: o.calendar, category: o.category || 'Other',
      title: o.title, allDay: !!o.allDay, start: o.start, end: o.end || null,
      rrule: null, exdates: [], location: o.location || '', notes: '', reminders: [],
      example: true, _tourSample: true, createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z',
    }, o.kind === 'task' ? { scope: o.scope || 'day', priority: o.priority || null, done: false, completedDates: [] } : {});
    return [
      mk({ id: 'tour-e1', calendar: 'tour-work', title: 'Team standup', start: ymdOffset(0, 9, 0), end: ymdOffset(0, 9, 30), category: 'Meeting' }),
      mk({ id: 'tour-e2', calendar: 'tour-work', title: 'Client call', start: ymdOffset(0, 15, 0), end: ymdOffset(0, 16, 0), category: 'Meeting', location: 'Zoom' }),
      mk({ id: 'tour-e3', calendar: 'tour-side', title: 'Side project block', start: ymdOffset(0, 18, 0), end: ymdOffset(0, 19, 30), category: 'Event' }),
      mk({ id: 'tour-e4', calendar: 'tour-kids', title: 'Soccer practice', start: ymdOffset(1, 17, 0), end: ymdOffset(1, 18, 0), category: 'Event' }),
      mk({ id: 'tour-e5', calendar: 'tour-kids', title: 'School pickup', start: ymdOffset(0, 15, 30), end: ymdOffset(0, 16, 0), category: 'Event' }),
      mk({ id: 'tour-t1', kind: 'task', calendar: 'tour-work', title: 'Send weekly report', start: today, allDay: true, priority: 1, category: 'Task / to-do' }),
      mk({ id: 'tour-t2', kind: 'task', calendar: 'tour-side', title: 'Invoice last job', start: yest, allDay: true, priority: 2, category: 'Task / to-do' }),
      mk({ id: 'tour-t3', kind: 'task', calendar: 'tour-kids', title: 'Pack snacks for practice', start: tomorrow, allDay: true, priority: 3, category: 'Task / to-do' }),
    ].filter(e => e.start);
  }

  // ---- exact step copy (1–2 sentences each) ----
  const STEPS = [
    {
      id: 'views',
      title: 'Home views',
      body: 'This is Home. Use Month, Week, Day, or List at the top of the calendar to see the same schedules in different layouts.',
      tab: 'home',
      target: () => document.querySelector('.fc-dayGridMonth-button') || document.querySelector('.fc-toolbar-chunk:last-child') || document.querySelector('#calendar'),
      prepare: async () => { if (window.SandyNav) SandyNav.go('home'); const a = window.__app; if (a && a.calendar) try { a.calendar.changeView('dayGridMonth'); } catch (e) {} },
    },
    {
      id: 'briefing',
      title: 'Briefing',
      body: 'Briefing sits above the calendar and summarizes the day, week, month, or season you are looking at — a quick rundown without hunting through every cell.',
      tab: 'home',
      target: () => document.querySelector('#briefing .brief-head') || document.getElementById('briefing'),
      prepare: async () => {
        if (window.SandyNav) SandyNav.go('home');
        const b = document.getElementById('briefing');
        if (b && b.classList.contains('collapsed')) {
          const btn = document.getElementById('briefCollapse'); if (btn) btn.click();
        }
      },
    },
    {
      id: 'today',
      title: 'Today',
      body: 'Today pulls everything together: Heads Up for conflicts and leave times, On Today, Overdue to-dos, and an evening Tomorrow preview.',
      tab: 'today',
      target: () => document.getElementById('todayCard') || document.getElementById('todayBody'),
      prepare: async () => { if (window.SandyNav) SandyNav.go('today'); await new Promise(r => setTimeout(r, 200)); },
    },
    {
      id: 'today-collapse',
      title: 'Collapse sections',
      body: 'Tap any Today section heading to collapse or expand it so you can focus on what matters right now.',
      tab: 'today',
      target: () => document.querySelector('#todayBody .tc-sec h3') || document.getElementById('todayBody'),
      prepare: async () => { if (window.SandyNav) SandyNav.go('today'); },
    },
    {
      id: 'ai',
      title: 'Sandy Intelligence',
      body: 'Tap AI anytime to add, move, or adjust things on your schedule. Try something like “Move my 3pm meeting to Friday.”',
      tab: 'home',
      target: () => document.getElementById('aiBtn'),
      prepare: async () => { if (window.SandyNav) SandyNav.go('home'); },
      sampleHint: 'Move my 3pm meeting to Friday',
    },
    {
      id: 'todo',
      title: 'To-Do',
      body: 'On To-Do, tap + to quick-add. Type naturally — “meeting next Friday at 3pm” — and set a priority when it matters.',
      tab: 'todo',
      target: () => document.getElementById('todoFab') || document.getElementById('quickAdd') || document.getElementById('page-todo'),
      prepare: async () => { if (window.SandyNav) SandyNav.go('todo'); await new Promise(r => setTimeout(r, 150)); },
    },
    {
      id: 'search',
      title: 'Search',
      body: 'Search finds events, to-dos, and notes across your calendars when you need something fast.',
      tab: 'search',
      target: () => document.querySelector('#page-search .page-head') || document.getElementById('searchBox') || document.getElementById('page-search'),
      prepare: async () => { if (window.SandyNav) SandyNav.go('search'); },
    },
    {
      id: 'profile',
      title: 'Profile',
      body: 'Profile holds your calendars, notifications, time settings, and Send feedback. You can also replay this tour or the Welcome guide anytime from here.',
      tab: 'profile',
      target: () => document.getElementById('tourBtn') || document.getElementById('accountSection') || document.getElementById('page-profile'),
      prepare: async () => {
        if (window.SandyNav) SandyNav.go('profile');
        await new Promise(r => setTimeout(r, 100));
        const btn = document.getElementById('tourBtn');
        if (btn) try { btn.scrollIntoView({ block: 'center' }); } catch (e) {}
      },
    },
  ];

  let state = null; // { user, step, root, hole, tip, patches }

  function isTourId(id) { return typeof id === 'string' && id.indexOf('tour-') === 0; }

  function installSample(user) {
    const a = window.__app; if (!a || !a.Store) return null;
    const patches = { user };
    // calendars overlay
    const prevCals = a.calendars().map(c => ({ slug: c.id, name: c.name, short: c.short, color: c.color }));
    patches.prevCals = prevCals;
    const merged = [...prevCals];
    for (const sc of SAMPLE_CALS) if (!merged.some(c => c.slug === sc.slug)) merged.push(sc);
    if (a.useCalendars) a.useCalendars(merged);
    // force sample calendars visible in the live settings object (local only; restored on end)
    const settings = a.settings && a.settings();
    if (settings) {
      settings.visible = settings.visible || {};
      patches.prevVisibleMem = { ...settings.visible };
      for (const sc of SAMPLE_CALS) settings.visible[sc.slug] = true;
      if (a.saveSettings) try { a.saveSettings(); } catch (e) {}
    }
    // Store.list merge + write guards
    const Store = a.Store;
    const samples = sampleEvents();
    patches.samples = samples;
    patches.origList = Store.list.bind(Store);
    patches.origSave = Store.save.bind(Store);
    patches.origSaveMany = Store.saveMany.bind(Store);
    patches.origRemove = Store.remove.bind(Store);
    Store.list = async () => {
      const real = await patches.origList();
      const ids = new Set(real.map(e => e.id));
      return real.concat(samples.filter(e => !ids.has(e.id)));
    };
    Store.save = async (ev) => {
      if (ev && (ev._tourSample || isTourId(ev.id))) return ev; // never persist
      return patches.origSave(ev);
    };
    Store.saveMany = async (evs) => {
      const real = (evs || []).filter(e => !(e && (e._tourSample || isTourId(e.id))));
      if (!real.length) return evs || [];
      return patches.origSaveMany(real);
    };
    Store.remove = async (id) => {
      if (isTourId(id)) return;
      return patches.origRemove(id);
    };
    // also guard adapter if present
    if (Store.adapter && Store.adapter.upsertMany) {
      patches.origUpsert = Store.adapter.upsertMany.bind(Store.adapter);
      Store.adapter.upsertMany = async (evs) => {
        const real = (evs || []).filter(e => !(e && (e._tourSample || isTourId(e.id))));
        if (!real.length) return [];
        return patches.origUpsert(real);
      };
    }
    try { sessionStorage.setItem(ACTIVE, '1'); } catch (e) {}
    return patches;
  }

  function uninstallSample(patches) {
    if (!patches) return;
    const a = window.__app;
    if (a && a.Store) {
      if (patches.origList) a.Store.list = patches.origList;
      if (patches.origSave) a.Store.save = patches.origSave;
      if (patches.origSaveMany) a.Store.saveMany = patches.origSaveMany;
      if (patches.origRemove) a.Store.remove = patches.origRemove;
      if (patches.origUpsert && a.Store.adapter) a.Store.adapter.upsertMany = patches.origUpsert;
    }
    if (a && a.useCalendars && patches.prevCals) a.useCalendars(patches.prevCals);
    if (a && a.settings && patches.prevVisibleMem) {
      const settings = a.settings();
      if (settings) {
        settings.visible = { ...patches.prevVisibleMem };
        for (const sc of SAMPLE_CALS) delete settings.visible[sc.slug];
        if (a.saveSettings) try { a.saveSettings(); } catch (e) {}
      }
    }
    try { sessionStorage.removeItem(ACTIVE); } catch (e) {}
    if (a && a.refresh) try { a.refresh(); } catch (e) {}
  }

  function cleanupIfStale() {
    try {
      if (sessionStorage.getItem(ACTIVE) === '1') {
        sessionStorage.removeItem(ACTIVE);
        // mid-tour reload: drop sample calendar visibility keys from device settings
        const raw = localStorage.getItem('scottcal.settings.v1');
        if (raw) {
          const s = JSON.parse(raw);
          if (s && s.visible) {
            let ch = false;
            for (const sc of SAMPLE_CALS) if (sc.slug in s.visible) { delete s.visible[sc.slug]; ch = true; }
            if (ch) localStorage.setItem('scottcal.settings.v1', JSON.stringify(s));
          }
        }
      }
    } catch (e) {}
  }

  function navClearance() {
    const nav = document.getElementById('bottomNav');
    const fab = document.getElementById('todoFab');
    const cs = getComputedStyle(document.documentElement);
    const navH = parseFloat(cs.getPropertyValue('--nav-h')) || 60;
    const lift = parseFloat(cs.getPropertyValue('--nav-lift')) || 10;
    // Prefer measuring the floating nav; fall back to CSS vars + cushion for FAB / update banner.
    let clear = navH + lift + 24;
    if (nav) {
      const nr = nav.getBoundingClientRect();
      if (nr.height) clear = Math.max(clear, window.innerHeight - nr.top + 12);
    }
    // Only reserve FAB space when the tour is NOT currently spotlighting the FAB itself.
    const targetingFab = !!(state && state.hole && state.hole.dataset && state.hole.dataset.target === 'fab');
    if (!targetingFab && fab && !fab.hidden && getComputedStyle(fab).display !== 'none') {
      const fr = fab.getBoundingClientRect();
      if (fr.height > 0 && fr.bottom > 0) clear = Math.max(clear, window.innerHeight - fr.top + 10);
    }
    const banner = document.getElementById('updateBanner');
    if (banner && !banner.hidden && (banner.classList.contains('is-in') || banner.classList.contains('show'))) {
      const br = banner.getBoundingClientRect();
      if (br.height) clear = Math.max(clear, window.innerHeight - br.top + 8);
    }
    return clear;
  }

  function placeTip(targetRect) {
    const tip = state.tip;
    const pad = 10;
    const safeTop = 10;
    const safeBottom = navClearance();
    const tipH = tip.offsetHeight || 180;
    const vh = window.innerHeight;
    tip.style.left = '12px';
    tip.style.right = '12px';
    tip.style.marginLeft = 'auto';
    tip.style.marginRight = 'auto';

    if (!targetRect) {
      tip.style.top = 'auto';
      tip.style.bottom = safeBottom + 'px';
      tip.dataset.place = 'bottom';
      return;
    }
    const spaceBelow = vh - targetRect.bottom - safeBottom;
    const spaceAbove = targetRect.top - safeTop;
    const need = tipH + pad;
    let place = 'below';
    if (spaceBelow < need && spaceAbove > spaceBelow) place = 'above';
    if (spaceBelow < need && spaceAbove < need) {
      // Neither fits cleanly — pin above the nav so the tip never covers it or the FAB.
      tip.style.top = 'auto';
      tip.style.bottom = safeBottom + 'px';
      tip.dataset.place = 'bottom';
      return;
    }
    if (place === 'below') {
      const top = Math.min(targetRect.bottom + pad, vh - tipH - safeBottom);
      tip.style.top = Math.max(safeTop, top) + 'px';
      tip.style.bottom = 'auto';
      tip.dataset.place = 'below';
    } else {
      const bottom = Math.max(safeBottom, vh - (targetRect.top - pad));
      tip.style.top = 'auto';
      tip.style.bottom = bottom + 'px';
      tip.dataset.place = 'above';
    }
  }


  function clearTourTab() {
    document.querySelectorAll('#bottomNav button.tour-tab-on').forEach(b => b.classList.remove('tour-tab-on'));
    document.body.classList.remove('tour-nav-up');
  }

  function setTourTab(tab) {
    clearTourTab();
    if (!tab) return;
    document.body.classList.add('tour-nav-up');
    const btn = document.querySelector('#bottomNav button[data-tab="' + tab + '"]');
    if (btn) btn.classList.add('tour-tab-on');
  }

  function placeSpotlight(el) {
    const hole = state.hole;
    if (!el) {
      hole.style.display = 'none';
      placeTip(null);
      return;
    }
    try { el.scrollIntoView({ block: 'nearest', inline: 'nearest' }); } catch (e) {}
    const r = el.getBoundingClientRect();
    const pad = 8;
    // Cap hole height so a huge target (e.g. #todayCard) does not swallow the tip / nav.
    const maxH = Math.max(120, window.innerHeight - navClearance() - 200);
    const h = Math.min(maxH, r.height + pad * 2, window.innerHeight - 16);
    hole.style.display = 'block';
    hole.dataset.target = (el.id === 'todoFab' || el.classList.contains('todo-fab')) ? 'fab' : '';
    hole.style.top = Math.max(4, r.top - pad) + 'px';
    hole.style.left = Math.max(4, r.left - pad) + 'px';
    hole.style.width = Math.min(window.innerWidth - 8, r.width + pad * 2) + 'px';
    hole.style.height = h + 'px';
    const holeRect = {
      top: Math.max(4, r.top - pad),
      bottom: Math.max(4, r.top - pad) + h,
      left: Math.max(4, r.left - pad),
      right: Math.max(4, r.left - pad) + Math.min(window.innerWidth - 8, r.width + pad * 2),
    };
    placeTip(holeRect);
  }

  function renderTip() {
    const step = STEPS[state.i];
    const tip = state.tip;
    const n = STEPS.length;
    tip.innerHTML = `
      <div class="tour-tip-top"><span class="tour-count" id="tourCount">${state.i + 1} / ${n}</span>
        <button type="button" class="tour-skip" id="tourSkip">Skip</button></div>
      <h2 id="tourTitle" class="tour-title">${step.title}</h2>
      <p class="tour-body">${step.body}</p>
      ${step.sampleHint ? `<p class="tour-hint muted small">Example: “${step.sampleHint}”</p>` : ''}
      <div class="tour-actions">
        <button type="button" class="tour-back" id="tourBack" ${state.i === 0 ? 'disabled' : ''}>Back</button>
        <button type="button" class="primary tour-next" id="tourNext">${state.i === n - 1 ? 'Done' : 'Next'}</button>
      </div>`;
    tip.querySelector('#tourSkip').onclick = () => end(true);
    tip.querySelector('#tourBack').onclick = () => go(state.i - 1);
    tip.querySelector('#tourNext').onclick = () => { if (state.i >= n - 1) end(false); else go(state.i + 1); };
  }

  async function go(i) {
    if (!state) return;
    state.i = Math.max(0, Math.min(STEPS.length - 1, i));
    const step = STEPS[state.i];
    if (step.prepare) await step.prepare();
    setTourTab(step.tab || null);
    renderTip();
    await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
    placeSpotlight(step.target && step.target());
    try { state.tip.querySelector('#tourNext').focus({ preventScroll: true }); } catch (e) {}
  }

  function end(skipped) {
    if (!state) return;
    const { user, patches, root, hole, tip, onResize } = state;
    state = null;
    markDone(user);
    document.removeEventListener('keydown', onKey, true);
    window.removeEventListener('resize', onResize);
    if (onResize && onResize._scroll) window.removeEventListener('scroll', onResize, true);
    clearTourTab();
    root.classList.remove('open'); tip.classList.add('leaving'); hole.classList.add('leaving');
    const doneFn = () => {
      try { root.remove(); } catch (e) {}
      try { tip.remove(); } catch (e) {}
      try { hole.remove(); } catch (e) {}
      document.querySelectorAll('.tour-offer-back, .tour-offer, #tourRoot, .tour-hole, .tour-tip').forEach(n => { try { n.remove(); } catch (e) {} });
      clearTourTab();
      document.body.classList.remove('tour-open');
      uninstallSample(patches);
      if (window.SandyNav) try { SandyNav.go('home'); } catch (e) {}
    };
    if (reduce()) doneFn(); else setTimeout(doneFn, 280);
  }

  function onKey(e) {
    if (!state) return;
    if (e.key === 'Escape') { e.preventDefault(); end(true); }
    else if (e.key === 'ArrowRight' || e.key === 'Enter') { e.preventDefault(); if (state.i >= STEPS.length - 1) end(false); else go(state.i + 1); }
    else if (e.key === 'ArrowLeft') { e.preventDefault(); go(state.i - 1); }
  }

  function start({ user } = {}) {
    if (state) return;
    if (!window.__app) return;
    cleanupIfStale();
    const patches = installSample(user);
    if (window.__app.refresh) try { window.__app.refresh(); } catch (e) {}
    const root = document.createElement('div'); root.className = 'tour-root'; root.id = 'tourRoot';
    root.setAttribute('role', 'dialog'); root.setAttribute('aria-modal', 'true'); root.setAttribute('aria-labelledby', 'tourTitle');
    const hole = document.createElement('div'); hole.className = 'tour-hole'; hole.setAttribute('aria-hidden', 'true');
    const tip = document.createElement('div'); tip.className = 'tour-tip';
    document.body.append(root, hole, tip);
    document.body.classList.add('tour-open');
    const onResize = () => { if (state) placeSpotlight(STEPS[state.i].target && STEPS[state.i].target()); };
    onResize._scroll = true;
    state = { user, i: 0, root, hole, tip, patches, onResize };
    document.addEventListener('keydown', onKey, true);
    window.addEventListener('resize', onResize);
    window.addEventListener('scroll', onResize, true);
    if (reduce()) { root.classList.add('open', 'no-anim'); tip.classList.add('open', 'no-anim'); }
    else { void tip.offsetWidth; requestAnimationFrame(() => { root.classList.add('open'); tip.classList.add('open'); }); }
    go(0);
  }

  function offer({ user } = {}) {
    if (document.getElementById('tourOffer')) return;
    const back = document.createElement('div'); back.className = 'tour-offer-back';
    const card = document.createElement('div'); card.className = 'tour-offer'; card.id = 'tourOffer';
    card.setAttribute('role', 'dialog'); card.setAttribute('aria-modal', 'true'); card.setAttribute('aria-labelledby', 'tourOfferTitle');
    card.innerHTML = `<h2 id="tourOfferTitle">Want a quick 1-minute tour?</h2>
      <p>We’ll walk through Home, Today, AI, To-Do, Search, and Profile — with a few sample calendars so an empty account still makes sense. Nothing is saved to your real data.</p>
      <div class="tour-offer-actions">
        <button type="button" class="tour-offer-later" id="tourLater">Maybe later</button>
        <button type="button" class="primary" id="tourTake">Take the tour</button>
      </div>`;
    document.body.append(back, card);
    const close = (take) => {
      card.classList.add('leaving'); back.classList.add('leaving');
      const fin = () => { card.remove(); back.remove(); if (take) start({ user }); else markDone(user); };
      if (reduce()) fin(); else setTimeout(fin, 220);
    };
    card.querySelector('#tourLater').onclick = () => close(false);
    card.querySelector('#tourTake').onclick = () => close(true);
    back.onclick = () => close(false);
    requestAnimationFrame(() => { back.classList.add('open'); card.classList.add('open'); });
    setTimeout(() => { try { card.querySelector('#tourTake').focus({ preventScroll: true }); } catch (e) {} }, 40);
  }

  function maybeOffer({ user, delay = 400 } = {}) {
    if (!shouldOffer(user)) return false;
    setTimeout(() => {
      if (!shouldOffer(user)) return;
      if (document.getElementById('welcomeSheet') || document.querySelector('.onb') || document.getElementById('tourRoot')) return;
      offer({ user });
    }, delay);
    return true;
  }

  function mountRow({ user } = {}) {
    const sec = document.getElementById('accountSection'); if (!sec || document.getElementById('tourBtn')) return;
    const row = document.createElement('div'); row.className = 'data-btns tour-row';
    row.innerHTML = '<button id="tourBtn" type="button">🗺️ Take the tour</button>';
    const wl = document.getElementById('welcomeBtn');
    if (wl && wl.parentElement) wl.parentElement.after(row);
    else {
      const fb = document.getElementById('feedbackBtn');
      if (fb && fb.parentElement && fb.parentElement.parentElement) fb.parentElement.after(row);
      else sec.insertBefore(row, sec.querySelector('#acctDelete'));
    }
    row.querySelector('#tourBtn').onclick = () => start({ user });
  }

  window.SandyTour = {
    STEPS, SAMPLE_CALS, sampleEvents, KEY, ACTIVE,
    start, offer, maybeOffer, shouldOffer, mountRow, cleanupIfStale,
    end: () => state && end(true),
    isActive: () => !!state,
    _test: { installSample, uninstallSample, isTourId },
  };
})();
