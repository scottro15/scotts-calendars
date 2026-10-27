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
  ];
  const n = (k, w) => `${k} ${w}${k === 1 ? '' : 's'}`;
  TYPES.push(['tc-nudges', () => 'si-intro', () => '']);
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
    set(sec, !!state[key], false);
    btn.addEventListener('click', () => { const closed = !sec.classList.contains('is-collapsed'); set(sec, closed, true); const s = read(); if (closed) s[key] = 1; else delete s[key]; write(s); });
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
  function apply(root) {
    root = root || document.getElementById('todayBody'); if (!root) return;
    const state = read();
    root.querySelectorAll('section.tc-card').forEach(sec => enhance(sec, state));
    const nudge = document.getElementById('todayNudges'); if (nudge) enhance(nudge, state); // the Sandy Intelligence intro card
    if (!root.__tcObs) { // async fills (leave-by, travel times, Tomorrow's drive) change summaries: keep counts fresh
      root.__tcObs = new MutationObserver(() => root.querySelectorAll('section.tc-card.is-collapsed').forEach(setCount));
      root.__tcObs.observe(root, { childList: true, subtree: true, attributes: true, attributeFilter: ['data-leave', 'hidden'] });
    }
  }
  window.SandyCollapse = { apply, read, key: userKey, summary };
})();
