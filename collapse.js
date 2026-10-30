/* collapse.js: every Today card (Heads Up incl. leave-by, On Today, Overdue To-Dos, Tomorrow, Practice prep,
 * Travel plan, and any future .tc-card) can be collapsed by tapping its header. The header becomes a real <button>
 * (aria-expanded / aria-controls; Enter and Space work natively). Collapsed headers show a short summary
 * ("On Today · 4"). State is remembered per section on this device, per signed-in user (localStorage).
 * Pure DOM: Today re-renders every minute, so apply() runs after each render without animating. */
(function () {
  'use strict';
  const LS = 'sandy.todayCollapsed.v1';
  const A = () => window.__app;
  const userKey = () => { try { const u = A() && A().user && A().user(); return u && u.id ? LS + '.' + u.id : LS; } catch (e) { return LS; } };
  const read = () => { try { const v = JSON.parse(localStorage.getItem(userKey())); return v && typeof v === 'object' ? v : {}; } catch (e) { return {}; } };
  const write = s => { try { localStorage.setItem(userKey(), JSON.stringify(s)); } catch (e) { } };
  const TYPES = [ // [class, key(section), summary(section) -> short text or '']
    ['tc-heads', () => 'heads', s => n(s.querySelectorAll('.tc-warn li').length, 'alert')],
    ['tc-on', () => 'on', s => String(s.querySelectorAll('.tc-list > li').length)],
    ['tc-overdue', () => 'overdue', s => String(s.querySelectorAll('.tc-list > li').length)],
    ['tc-tomorrow', () => 'tomorrow', s => { const b = [...s.querySelectorAll('.tm-stats b')].map(x => +x.textContent || 0); return b.length ? n(b.reduce((x, y) => x + y, 0), 'item') : ''; }],
    ['tc-practice', s => 'practice:' + (s.dataset.team || ''), s => { const q = s.querySelector('.pp-next'); const t = q && (q.querySelector('.tc-next-v') || q).textContent.match(/\b(Today|Tomorrow|\w{3}, \w{3} \d+)?\s*\d{1,2}(:\d\d)? ?[AP]M\b/); return t ? t[0].trim() : ''; }],
    ['tc-travel', () => 'travel', s => { const l = s.querySelector('.tv-leave'); return l && l.dataset.leave ? 'leave ' + l.dataset.leave : ''; }],
    ['tc-freegap', () => 'freegap', s => String(s.querySelectorAll('.fg-row').length || '')],
    ['tc-longday', () => 'longday', () => ''],
    ['tc-weekly', () => 'weekly', s => { const r = s.querySelector('.wk-range'); return r ? r.textContent.trim() : ''; }],
    ['tc-grocery', () => 'grocery', () => ''],
    ['tc-suggestions', () => 'suggestions', s => { const n = s.querySelectorAll('.sug-tile').length; return n ? n + ' tip' + (n === 1 ? '' : 's') : ''; }],
  ];
  const n = (k, w) => `${k} ${w}${k === 1 ? '' : 's'}`;
  const typeOf = s => TYPES.find(t => s.classList.contains(t[0])) || [null, x => 'card:' + (x.id || x.className.split(/\s+/).filter(c => c.startsWith('tc-') && c !== 'tc-sec' && c !== 'tc-card').join('.')), () => ''];
  let seq = 0, focusKey = null;
  document.addEventListener('focusin', e => { const b = e.target.closest && e.target.closest('.tc-tog'); focusKey = b ? b.dataset.ckey : null; });

  function summary(sec) { const t = typeOf(sec); try { return t[2](sec) || ''; } catch (e) { return ''; } }
  function setCount(sec) { const c = sec.querySelector(':scope > .tc-collapse-h .tc-count'); if (!c) return; const s = sec.classList.contains('is-collapsed') ? summary(sec) : ''; const v = s ? ' · ' + s : ''; if (c.textContent !== v) c.textContent = v; } // only on change: the observer below would loop

  function enhance(sec, state) {
    if (sec.dataset.collapsible) { setCount(sec); return; }
    const h3 = sec.querySelector(':scope > h3, :scope > .tc-nudge-head'); if (!h3) return; h3.classList.add('tc-collapse-h');
    const key = typeOf(sec)[1](sec); const id = 'tcb' + (++seq);
    sec.dataset.collapsible = key;
    const body = document.createElement('div'); body.className = 'tc-body'; body.id = id;
    const inner = document.createElement('div'); inner.className = 'tc-body-in'; body.appendChild(inner);
    while (h3.nextSibling) inner.appendChild(h3.nextSibling);
    sec.appendChild(body);
    const btn = document.createElement('button'); btn.type = 'button'; btn.className = 'tc-tog'; btn.dataset.ckey = key; btn.setAttribute('aria-controls', id);
    const label = document.createElement('span'); label.className = 'tc-tog-t'; while (h3.firstChild) label.appendChild(h3.firstChild);
    const count = document.createElement('span'); count.className = 'tc-count';
    const chev = document.createElement('span'); chev.className = 'tc-chev'; chev.setAttribute('aria-hidden', 'true');
    label.appendChild(count); btn.append(label, chev); h3.appendChild(btn);
    // Weekly / Sunday review starts collapsed; other cards default open. state[key]=1 closed, 0 open (weekly), absent = default.
    const defaultClosed = key === 'weekly';
    const startClosed = state[key] === undefined ? defaultClosed : !!state[key];
    set(sec, startClosed, false);
    btn.addEventListener('click', () => {
      const closed = !sec.classList.contains('is-collapsed');
      set(sec, closed, true);
      const s = read();
      if (defaultClosed) s[key] = closed ? 1 : 0;
      else if (closed) s[key] = 1; else delete s[key];
      write(s);
    });
    if (focusKey === key && (document.activeElement === document.body || !document.activeElement)) btn.focus({ preventScroll: true });
  }
  function set(sec, closed, animate) {
    const btn = sec.querySelector(':scope > .tc-collapse-h .tc-tog'); const body = sec.querySelector(':scope > .tc-body'); if (!btn || !body) return;
    if (!animate) { sec.classList.add('tc-noanim'); requestAnimationFrame(() => requestAnimationFrame(() => sec.classList.remove('tc-noanim'))); }
    sec.classList.toggle('is-collapsed', closed); btn.setAttribute('aria-expanded', String(!closed));
    body.inert = closed; // nothing inside is focusable / read while collapsed
    setCount(sec);
  }
  /** Run after Today renders: turns each .tc-card header into a toggle and re-applies the saved state. */
  function applyCollapse(root) {
    root = root || document.getElementById('todayBody'); if (!root) return;
    const state = read();
    root.querySelectorAll('section.tc-card').forEach(sec => enhance(sec, state));
    if (!root.__tcObs) { // async fills (leave-by, travel times, Tomorrow's drive) change summaries: keep counts fresh
      root.__tcObs = new MutationObserver(() => root.querySelectorAll('section.tc-card.is-collapsed').forEach(setCount));
      root.__tcObs.observe(root, { childList: true, subtree: true, attributes: true, attributeFilter: ['data-leave', 'hidden'] });
    }
  }

  /* Heads Up: show top 3 alerts; "Show N more" / "Show less" with smooth expand. */
  const HU_LS = 'sandy.headsExpanded.v1';
  const huKey = () => { try { const u = A() && A().user && A().user(); return u && u.id ? HU_LS + '.' + u.id : HU_LS; } catch (e) { return HU_LS; } };
  const huRead = () => { try { return localStorage.getItem(huKey()) === '1'; } catch (e) { return false; } };
  const huWrite = v => { try { if (v) localStorage.setItem(huKey(), '1'); else localStorage.removeItem(huKey()); } catch (e) {} };

  function headsItems(sec) {
    return [...sec.querySelectorAll('.tc-leave li, .tc-clash li, .tc-weather li, .tc-warn:not(.tc-leave):not(.tc-clash):not(.tc-weather) li')];
  }
  function applyHeadsMore(sec) {
    if (!sec || !sec.classList.contains('tc-heads')) return;
    const items = headsItems(sec);
    let btn = sec.querySelector('.hu-more-btn');
    items.forEach(li => { li.classList.remove('hu-extra', 'hu-extra-in'); if (li.dataset.huHide === '1') { li.hidden = false; delete li.dataset.huHide; } });
    if (items.length <= 3) {
      if (btn) btn.remove();
      sec.classList.remove('hu-expanded');
      return;
    }
    const expanded = huRead();
    sec.classList.toggle('hu-expanded', expanded);
    items.forEach((li, i) => {
      if (i < 3) return;
      li.classList.add('hu-extra');
      if (!expanded) { li.hidden = true; li.dataset.huHide = '1'; }
      else { li.hidden = false; li.classList.add('hu-extra-in'); }
    });
    const n = items.length - 3;
    const body = sec.querySelector('.tc-body-in') || sec.querySelector('.tc-body') || sec;
    if (!btn) {
      btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'hu-more-btn';
      body.appendChild(btn);
      btn.addEventListener('click', () => {
        const open = !sec.classList.contains('hu-expanded');
        sec.classList.toggle('hu-expanded', open);
        huWrite(open);
        const list = headsItems(sec);
        list.forEach((li, i) => {
          if (i < 3) return;
          li.classList.add('hu-extra');
          if (open) {
            li.hidden = false; delete li.dataset.huHide;
            li.classList.remove('hu-extra-in'); void li.offsetWidth; li.classList.add('hu-extra-in');
          } else {
            li.hidden = true; li.dataset.huHide = '1'; li.classList.remove('hu-extra-in');
          }
        });
        const left = Math.max(0, list.length - 3);
        btn.textContent = open ? 'Show less' : ('Show ' + left + ' more');
        btn.setAttribute('aria-expanded', String(open));
      });
    } else if (btn.parentElement !== body) {
      body.appendChild(btn);
    }
    btn.textContent = expanded ? 'Show less' : ('Show ' + n + ' more');
    btn.setAttribute('aria-expanded', String(expanded));
  }

  function apply(root) {
    applyCollapse(root);
    root = root || document.getElementById('todayBody'); if (!root) return;
    const heads = root.querySelector('.tc-heads');
    if (heads) applyHeadsMore(heads);
    if (!root.__huObs) {
      let tmr = null, busy = false;
      root.__huObs = new MutationObserver(() => {
        if (busy) return;
        clearTimeout(tmr);
        tmr = setTimeout(() => {
          const h = root.querySelector('.tc-heads');
          if (!h) return;
          busy = true;
          try { applyHeadsMore(h); } finally { busy = false; }
        }, 120);
      });
      root.__huObs.observe(root, { childList: true, subtree: true });
    }
  }

  window.SandyCollapse = { apply, read, key: userKey, summary, applyHeadsMore };
})();
