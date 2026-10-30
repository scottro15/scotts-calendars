/* suggestions.js: groups SI nudge cards (practice, long-day, free-gap, grocery, travel,
 * tomorrow, …) into one Today "Suggestions" card. Soft tiles with dismiss × persisted
 * per calendar day per user. Settings toggles still gate each module; action buttons
 * keep working via existing todayCard click handlers. */
(function () {
  'use strict';
  const LS = 'sandy.si.dismissed.v1';
  const A = () => window.__app;
  const userKey = () => {
    try { const u = A() && A().user && A().user(); return u && u.id ? LS + '.' + u.id : LS; }
    catch (e) { return LS; }
  };
  const readAll = () => { try { const v = JSON.parse(localStorage.getItem(userKey())); return v && typeof v === 'object' ? v : {}; } catch (e) { return {}; } };
  const writeAll = o => { try { localStorage.setItem(userKey(), JSON.stringify(o)); } catch (e) {} };
  const todayYmd = () => { try { return A().ymd(A().nowWall()); } catch (e) { return new Date().toISOString().slice(0, 10); } };
  function dismissedSet() {
    const all = readAll();
    const y = todayYmd();
    // drop other days (keep store small)
    if (Object.keys(all).some(k => k !== y)) {
      const next = {}; if (all[y]) next[y] = all[y]; writeAll(next); return new Set(next[y] || []);
    }
    return new Set(all[y] || []);
  }
  function isDismissed(key) { return dismissedSet().has(key); }
  function dismiss(key) {
    const y = todayYmd();
    const all = readAll();
    const set = new Set(all[y] || []);
    set.add(key);
    all[y] = [...set];
    // prune other days
    Object.keys(all).forEach(k => { if (k !== y) delete all[k]; });
    writeAll(all);
  }
  function undismiss(key) {
    const y = todayYmd();
    const all = readAll();
    all[y] = (all[y] || []).filter(k => k !== key);
    writeAll(all);
  }

  /** Turn a full <section class="tc-card …"> into a soft suggestion tile, or '' if dismissed/empty. */
  function wrap(html, key) {
    if (!html || !String(html).trim()) return '';
    if (isDismissed(key)) return '';
    const doc = new DOMParser().parseFromString(String(html), 'text/html');
    const sections = [...doc.querySelectorAll('section.tc-card, section.tc-sec')];
    if (!sections.length) {
      // already a fragment
      return `<div class="sug-tile" data-sug="${esc(key)}"><button type="button" class="sug-x" data-sug-x="${esc(key)}" aria-label="Dismiss">×</button><div class="sug-body">${html}</div></div>`;
    }
    return sections.map((sec, i) => {
      const k = sections.length > 1 ? `${key}:${i}` : key;
      if (isDismissed(k)) return '';
      // keep identifying classes for CSS / click handlers (tc-longday, etc.)
      const cls = [...sec.classList].filter(c => c !== 'tc-sec' && c !== 'tc-card').join(' ');
      const id = sec.id ? ` id="${esc(sec.id)}"` : '';
      const extras = [...sec.attributes].filter(a => a.name.startsWith('data-') || a.name === 'aria-label' || a.name === 'aria-labelledby')
        .map(a => ` ${a.name}="${esc(a.value)}"`).join('');
      // move h3 into tile head; rest is body
      const h3 = sec.querySelector(':scope > h3');
      let title = '';
      if (h3) { title = h3.innerHTML; h3.remove(); }
      const inner = sec.innerHTML;
      return `<div class="sug-tile ${cls}" data-sug="${esc(k)}"${id}${extras}>` +
        `<button type="button" class="sug-x" data-sug-x="${esc(k)}" aria-label="Dismiss suggestion">×</button>` +
        (title ? `<div class="sug-title">${title}</div>` : '') +
        `<div class="sug-body">${inner}</div></div>`;
    }).join('');
  }

  // 5c (t150u): on phones Today shows ONE suggestion; "More ideas" opens the rest (remembered for the day).
  let moreDay = null;
  const moreOpen = () => moreDay === todayYmd();
  const moreLabel = (n, open) => open ? 'Fewer ideas' : `More ideas (${n})`;
  function shell(tilesHtml, opts) {
    if (!tilesHtml || !String(tilesHtml).trim()) return '';
    const n = (String(tilesHtml).match(/<div class="sug-tile[ "]/g) || []).length;
    const one = !!(opts && opts.one) && n > 1, open = one && moreOpen();
    return `<section class="tc-sec tc-card tc-suggestions${one ? ' sug-one' : ''}${open ? ' sug-all' : ''}" id="tcSuggestions" aria-label="Suggestions">` +
      `<h3>Suggestions</h3>` +
      `<div class="sug-list" id="sugList">${tilesHtml}</div>` +
      (one ? `<button type="button" class="sug-more" aria-controls="sugList" aria-expanded="${open}">${moreLabel(n - 1, open)}</button>` : '') +
      `</section>`;
  }
  function syncMore(card) {
    const btn = card && card.querySelector('.sug-more'); if (!btn) return;
    const n = card.querySelectorAll('.sug-list > .sug-tile:not(.sug-leaving)').length;
    if (n <= 1) { btn.remove(); card.classList.remove('sug-one', 'sug-all'); return; }
    const open = card.classList.contains('sug-all');
    btn.textContent = moreLabel(n - 1, open); btn.setAttribute('aria-expanded', String(open));
  }

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  /** Event delegation: dismiss × inside #todayCard. Returns true if handled. */
  function onClick(e) {
    const more = e.target.closest && e.target.closest('.sug-more');
    if (more) {
      e.preventDefault();
      const card = more.closest('.tc-suggestions'); if (!card) return true;
      const open = !card.classList.contains('sug-all');
      moreDay = open ? todayYmd() : null;
      card.classList.toggle('sug-all', open); syncMore(card);
      if (!open) { const r = card.getBoundingClientRect(); if (r.top < 0) card.scrollIntoView({ block: 'start', behavior: 'smooth' }); }
      return true;
    }
    const x = e.target.closest && e.target.closest('[data-sug-x]');
    if (!x) return false;
    e.preventDefault();
    e.stopPropagation();
    const key = x.getAttribute('data-sug-x');
    if (!key) return true;
    dismiss(key);
    const tile = x.closest('.sug-tile');
    if (tile) {
      tile.classList.add('sug-leaving');
      const done = () => {
        tile.remove();
        const list = document.querySelector('#tcSuggestions .sug-list');
        if (list && !list.querySelector('.sug-tile')) {
          const card = document.getElementById('tcSuggestions');
          if (card) card.remove();
        } else syncMore(document.getElementById('tcSuggestions'));
      };
      if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) done();
      else setTimeout(done, 200);
    }
    return true;
  }

  window.SandySuggestions = { wrap, shell, syncMore, dismiss, undismiss, isDismissed, onClick, _test: { readAll, todayYmd } };
})();
