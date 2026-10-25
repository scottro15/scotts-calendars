/* games.js: Maryville University game events (Scott 2026-10-24).
 * A game is an event whose category starts with "Game" (e.g. "Game – Maryville University") or whose
 * title ends in " - HOME" / " - AWAY" / " - NEUTRAL". Nothing extra is stored in the database:
 *   - Home / Away / Neutral comes from the title suffix (fallback: " @ " in the title = away).
 *   - Venue = the event's Location.
 *   - Distance = a "Drive from Maryville University: 314 mi, about 5 hr 59 min" line in Notes.
 * Game blocks get a red glowing border (List, Day, Week) and a big red H / A / N badge. Away and
 * neutral games show the venue (tap = Google Maps directions from Maryville University) and the drive.
 */
(function () {
  const ORIGIN = 'Maryville University, 650 Maryville University Dr, St. Louis, MO 63141';
  const SUFFIX = /\s[-–—]\s*(HOME|AWAY|NEUTRAL)\s*$/i;
  const DRIVE = /Drive from Maryville University:\s*([\d,.]+)\s*mi(?:\s*[,·]\s*(?:about\s+)?([^\n]+?))?\s*(?:\n|$)/i;
  const LABEL = { H: 'Home game', A: 'Away game', N: 'Neutral-site game' };

  function mapsUrl(dest) {
    return 'https://www.google.com/maps/dir/?api=1&travelmode=driving&origin=' + encodeURIComponent(ORIGIN) +
      '&destination=' + encodeURIComponent(dest);
  }
  /** Game info for an event-like object ({title, category, location, notes}) or null. */
  function info(ev) {
    if (!ev) return null;
    const title = String(ev.title || ''), cat = String(ev.category || '');
    const m = title.match(SUFFIX);
    if (!m && !/^game\b/i.test(cat)) return null;
    const ha = m ? { HOME: 'H', AWAY: 'A', NEUTRAL: 'N' }[m[1].toUpperCase()] : (/\s@\s/.test(title) ? 'A' : 'H');
    const location = String(ev.location || '').trim();
    const d = String(ev.notes || '').match(DRIVE);
    const miles = d ? Math.round(parseFloat(d[1].replace(/,/g, ''))) : null;
    const drive = d && d[2] ? d[2].trim().replace(/[.;]+$/, '') : '';
    const travel = ha !== 'H';
    return { ha, label: LABEL[ha], location, miles, drive, travel, url: travel && location ? mapsUrl(location) : '' };
  }
  const stop = el => { for (const t of ['click', 'mousedown', 'mouseup', 'pointerdown', 'pointerup', 'touchstart', 'touchend']) el.addEventListener(t, e => e.stopPropagation()); return el; };
  function badge(g) {
    const b = document.createElement('span');
    b.className = 'game-ha game-ha-' + g.ha; b.textContent = g.ha;
    b.setAttribute('role', 'img'); b.setAttribute('aria-label', g.label); b.title = g.label;
    return b;
  }
  function distText(g) { return g.miles == null ? '' : `${g.miles} mi${g.drive ? ' · ~' + g.drive : ''} from Maryville`; }
  function meta(g, compact) {
    const box = document.createElement('div'); box.className = 'game-meta' + (compact ? ' compact' : '');
    if (g.location) {
      const a = stop(document.createElement('a'));
      a.className = 'game-loc'; a.href = g.url; a.target = '_blank'; a.rel = 'noopener noreferrer';
      a.title = 'Directions from Maryville University (Google Maps)';
      a.setAttribute('aria-label', `${g.location}. Open directions from Maryville University in Google Maps`);
      a.innerHTML = '<span class="game-ico" aria-hidden="true">📍</span>';
      // compact (Day view): venue name only; the full address is in the Maps link + tooltip
      a.appendChild(document.createTextNode(compact ? g.location.split(',')[0] : g.location));
      if (compact) a.title = g.location + ' (directions from Maryville University)';
      box.appendChild(a);
    }
    const t = distText(g);
    if (t) { const s = document.createElement('span'); s.className = 'game-dist'; s.innerHTML = '<span class="game-ico" aria-hidden="true">🚗</span>'; s.appendChild(document.createTextNode(t)); box.appendChild(s); }
    return box.childNodes.length ? box : null;
  }
  /** FullCalendar eventDidMount hook: style + badge + (away) venue/distance.
   * FullCalendar can reuse a time-grid block when switching Day <-> Week without calling eventDidMount
   * again, so Day and Week get the same DOM and CSS decides what each view shows. */
  function decorate(el, g, viewType) {
    if (!g || !el || el.querySelector('.game-ha')) return;
    el.classList.add('sandy-game', 'game-' + g.ha);
    if (viewType.startsWith('list')) {
      const cell = el.querySelector('.fc-list-event-title'); if (!cell) return;
      const line = document.createElement('div'); line.className = 'game-line';
      line.appendChild(badge(g)); while (cell.firstChild) line.appendChild(cell.firstChild);
      cell.appendChild(line);
      const mt = g.travel && meta(g); if (mt) cell.appendChild(mt);
    } else if (viewType.startsWith('timeGrid')) {
      const frame = el.querySelector('.fc-event-main-frame'); if (!frame) return;
      frame.classList.add('game-frame');
      frame.insertBefore(badge(g), frame.firstChild);
      const mt = g.travel && meta(g, true); if (mt) frame.appendChild(mt); // hidden in Week (too narrow)
    } else {
      const t = el.querySelector('.fc-event-title'); if (t) t.insertBefore(badge(g), t.firstChild);
    }
  }
  /** Editor: directions link + distance under Location for game events. */
  function editor(box, ev) {
    if (!box) return;
    const g = info(ev); box.innerHTML = '';
    if (!g || !g.travel || !g.location) { box.hidden = true; return; }
    box.hidden = false;
    const a = document.createElement('a'); a.href = g.url; a.target = '_blank'; a.rel = 'noopener noreferrer'; a.className = 'game-dir-link';
    a.textContent = '📍 Directions from Maryville University'; box.appendChild(a);
    const t = distText(g); if (t) { const s = document.createElement('span'); s.className = 'game-dist'; s.textContent = '🚗 ' + t; box.appendChild(s); }
  }
  window.SandyGames = { info, decorate, editor, mapsUrl, ORIGIN };
})();
