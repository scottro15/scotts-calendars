/* SANDY tablet / iPad layout (t134u, branch tablet-layout — mockup for approval, not on main yet).
   Phones (< 768px) are untouched: every class below is only set when (min-width: 768px) matches, and
   tablet.css is linked with media="(min-width: 768px)".
     html.lay-tablet  ≥ 768px  (iPad / Android tablet portrait and up)
     html.lay-wide    ≥ 1024px (landscape / large)
     html.lay-rail    left sidebar rail replaces the floating capsule (default on wide; portrait opt-in)
   Nav preference: localStorage 'sandy.tabletNav' = 'auto' | 'rail' | 'capsule' (or ?nav=rail|capsule). */
(function () {
  'use strict';
  const html = document.documentElement;
  const mqT = window.matchMedia('(min-width: 768px)'), mqW = window.matchMedia('(min-width: 1024px)');
  const KEY = 'sandy.tabletNav';
  const LEFT = ['tc-summary', 'tc-heads', 'tc-weekly'];
  const RIGHT = ['tc-on', 'tc-overdue', 'tc-suggestions'];
  const $ = id => document.getElementById(id);

  function navPref() {
    try {
      const q = new URLSearchParams(location.search).get('nav');
      if (q === 'rail' || q === 'capsule' || q === 'auto') return q;
      return localStorage.getItem(KEY) || 'auto';
    } catch (_) { return 'auto'; }
  }

  // ---- "+ New" button that lives at the top of the rail (hidden unless the rail is on)
  function railNew(on) {
    const nav = $('bottomNav'); if (!nav) return;
    let b = $('railNew');
    if (!b && on) {
      b = document.createElement('button'); b.type = 'button'; b.id = 'railNew'; b.className = 'rail-new'; b.setAttribute('aria-label', 'New');
      b.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg><span>New</span>';
      b.addEventListener('click', e => {
        e.stopPropagation();
        if (document.body.classList.contains('tab-todo') && window.SandyQuickSheet) SandyQuickSheet.open();
        else { const add = $('addBtn'); if (add) add.click(); }
      });
      const firstTab = nav.querySelector('button[data-tab]'); nav.insertBefore(b, firstTab);
    }
    if (b) b.hidden = !on;
  }

  // ---- Today: two-column card grid (left: Now/Next + Heads Up + Week ahead; right: On Today, Overdue, Suggestions)
  let todayObs = null, busy = false;
  const has = (el, list) => list.some(c => el.classList && el.classList.contains(c));
  function splitToday() {
    const body = $('todayBody'); if (!body || busy) return;
    busy = true;
    try {
      const on = html.classList.contains('lay-tablet');
      let L = body.querySelector(':scope > .tt-col-l'), R = body.querySelector(':scope > .tt-col-r');
      if (!on) { // unwrap (rotated / resized down to phone width)
        if (L || R) { for (const col of [L, R]) if (col) { while (col.firstChild) body.insertBefore(col.firstChild, col); col.remove(); } }
        body.classList.remove('tt-grid', 'tt-one');
        // re-render so cards come back in the phone's native order
        if ((L || R) && window.SandyNav && SandyNav.renderToday && document.body.classList.contains('tab-today')) setTimeout(() => { try { SandyNav.renderToday(); } catch (_) {} }, 0);
        return;
      }
      const loose = [...body.children].filter(c => c !== L && c !== R);
      if (!loose.length && L) return;
      if (!L) { L = document.createElement('div'); L.className = 'tt-col tt-col-l'; }
      if (!R) { R = document.createElement('div'); R.className = 'tt-col tt-col-r'; }
      for (const c of loose) (has(c, RIGHT) ? R : L).appendChild(c);
      // keep a stable order inside each column regardless of render order
      const order = (col, list) => [...col.children].sort((a, b) => rank(a, list) - rank(b, list)).forEach(c => col.appendChild(c));
      const rank = (el, list) => { const i = list.findIndex(c => el.classList.contains(c)); return i < 0 ? 99 : i; };
      order(L, LEFT); order(R, ['tc-on', 'tc-overdue', 'tc-suggestions']);
      body.append(L, R);
      body.classList.add('tt-grid');
      const rVisible = [...R.children].some(c => !c.hidden);
      body.classList.toggle('tt-one', !rVisible);
    } finally { busy = false; }
  }
  function watchToday() {
    const body = $('todayBody'); if (!body || todayObs) return;
    todayObs = new MutationObserver(() => { if (!busy) splitToday(); });
    todayObs.observe(body, { childList: true });
  }

  // ---- To-Do: the edit sheet becomes a right-hand details pane; needs its own close button + row highlight
  function paneChrome() {
    const sh = $('qsSheet'); if (!sh) return;
    if (!$('qsPaneClose')) {
      const x = document.createElement('button'); x.type = 'button'; x.id = 'qsPaneClose'; x.className = 'qs-pane-close'; x.setAttribute('aria-label', 'Close details');
      x.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18"/></svg>';
      x.addEventListener('click', () => window.SandyQuickSheet && SandyQuickSheet.close());
      const hd = document.createElement('div'); hd.className = 'qs-pane-head'; hd.innerHTML = '<span class="qs-pane-title">Details</span>'; hd.appendChild(x);
      sh.insertBefore(hd, sh.firstChild);
    }
  }
  function markRow(row) {
    document.querySelectorAll('#todoList .todo-row.td-selected').forEach(r => r.classList.remove('td-selected'));
    if (row && html.classList.contains('lay-tablet')) row.classList.add('td-selected');
  }
  function wireTodo() {
    const list = $('todoList');
    if (list && !list.dataset.ttWired) {
      list.dataset.ttWired = '1';
      list.addEventListener('click', e => {
        const row = e.target.closest('.todo-row');
        if (row && e.target.closest('.td-title, .td-desc, .td-main') && !e.target.closest('.td-check, .cat-pick, select')) markRow(row);
      });
    }
    // clear the highlight when the pane closes
    new MutationObserver(() => {
      const open = document.body.classList.contains('qs-open');
      if (!open) markRow(null); else if (html.classList.contains('lay-tablet')) paneChrome();
      html.classList.toggle('qs-pane-open', open && html.classList.contains('lay-tablet') && document.body.classList.contains('tab-todo'));
    }).observe(document.body, { attributes: true, attributeFilter: ['class'] });
  }

  // ---- Profile › Appearance: "Tablet navigation" picker (only rendered on tablet widths)
  function navSetting(on) {
    const sec = $('appearanceSection'); if (!sec) return;
    let row = $('ttNavRow');
    if (!row && on) {
      row = document.createElement('label'); row.id = 'ttNavRow'; row.className = 'pf-row pf-stack tt-nav-row';
      row.innerHTML = '<span><span class="pf-lbl">Tablet navigation</span><small class="pf-note">Sidebar or floating bar on iPad / tablets</small></span>' +
        '<select id="ttNav" aria-label="Tablet navigation"><option value="auto">Auto (sidebar in landscape)</option><option value="rail">Sidebar always</option><option value="capsule">Floating bar always</option></select>';
      sec.appendChild(row);
      row.querySelector('select').addEventListener('change', e => window.SandyTablet.setNav(e.target.value));
    }
    if (row) { row.hidden = !on; const s = row.querySelector('select'); if (s) s.value = navPref(); }
  }

  function apply() {
    const t = mqT.matches, w = mqW.matches, pref = navPref();
    const rail = t && (w ? pref !== 'capsule' : pref === 'rail');
    html.classList.toggle('lay-tablet', t);
    html.classList.toggle('lay-wide', w);
    html.classList.toggle('lay-rail', rail);
    railNew(rail);
    splitToday();
    if (t) paneChrome();
    { const hd = document.querySelector('#qsSheet .qs-pane-head'); if (hd) hd.hidden = !t; }
    navSetting(t);
    if (!t) markRow(null);
    try { window.dispatchEvent(new Event('resize')); } catch (_) {} // let navbar.js re-place its pill / FullCalendar re-measure
  }

  function init() {
    watchToday(); wireTodo(); apply();
    const on = mq => mq.addEventListener ? mq.addEventListener('change', apply) : mq.addListener(apply);
    on(mqT); on(mqW);
  }
  window.SandyTablet = {
    apply,
    get nav() { return navPref(); },
    setNav(v) { try { localStorage.setItem(KEY, v); } catch (_) {} apply(); },
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();
