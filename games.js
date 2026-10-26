/* games.js: game events (Scott 2026-10-24; Harris-Stowe added 2026-10-25; Jennings High School added 2026-10-26).
 * A game is an event whose category starts with "Game" (e.g. "Game – Maryville University") or whose
 * title ends in " - HOME" / " - AWAY" / " - NEUTRAL". Nothing extra is stored in the database:
 *   - Home / Away / Neutral comes from the title suffix (fallback: " @ " in the title = away).
 *   - Team (and so the colour) comes from the category / title: Maryville = red, Harris-Stowe (HSSU) = yellow,
 *     Jennings High School (boys varsity) = orange.
 *   - Venue = the event's Location.
 *   - Distance = a "Drive from <place>: 314 mi, about 5 hr 59 min" line in Notes
 *     (Maryville: "from Maryville University"; Harris-Stowe and Jennings: "from home").
 *   - Directions: a "Directions from <place>: https://www.google.com/maps/dir/..." line in Notes wins
 *     (personal addresses live only in the event data, never in this file); otherwise Google Maps
 *     directions from the team's origin (Maryville University) or from the phone's current location.
 * Game blocks get a glowing border in the team colour (List, Day, Week) and a big H / A / N badge.
 * Away and neutral games (and Harris-Stowe / Jennings home games, which carry a drive from home) show the venue
 * (tap = Google Maps directions) and the drive.
 */
(function () {
  const ORIGIN = 'Maryville University, 650 Maryville University Dr, St. Louis, MO 63141';
  const TEAMS = [
    { id: 'hssu', name: 'Harris-Stowe State University', re: /harris[\s-]*stowe|\bHSSU\b/i, origin: '', homeMeta: true },
    { id: 'jennings', name: 'Jennings High School', re: /\bjennings\b/i, origin: '', homeMeta: true },
    { id: 'maryville', name: 'Maryville University', re: /maryville/i, origin: ORIGIN, homeMeta: false },
  ];
  const DEFAULT_TEAM = TEAMS.find(t => t.id === 'maryville'); // older / unnamed games keep the original red Maryville look
  const SUFFIX = /\s[-–—]\s*(HOME|AWAY|NEUTRAL)\s*$/i;
  const DRIVE = /Drive from ([^:\n]{1,60}):\s*([\d,.]+)\s*mi(?:\s*[,·]\s*(?:about\s+)?([^\n]+?))?\s*(?:\n|$)/i;
  const DIRS = /Directions from ([^:\n]{1,60}):\s*(https:\/\/(?:www\.)?google\.com\/maps\/dir\/\S+)/i;
  const LABEL = { H: 'Home game', A: 'Away game', N: 'Neutral-site game' };

  function mapsUrl(dest, origin) {
    const o = origin === undefined ? ORIGIN : origin;
    return 'https://www.google.com/maps/dir/?api=1&travelmode=driving' + (o ? '&origin=' + encodeURIComponent(o) : '') +
      '&destination=' + encodeURIComponent(dest);
  }
  function teamOf(title, cat) {
    return TEAMS.find(t => t.re.test(cat)) || TEAMS.find(t => t.re.test(title)) || DEFAULT_TEAM;
  }
  /** Short "from" label for the distance line: "Maryville University" -> "Maryville", "home" stays "home". */
  const shortFrom = f => /^maryville/i.test(f) ? 'Maryville' : f;
  /** Game info for an event-like object ({title, category, location, notes}) or null. */
  function info(ev) {
    if (!ev) return null;
    const title = String(ev.title || ''), cat = String(ev.category || '');
    const m = title.match(SUFFIX);
    if (!m && !/^game\b/i.test(cat)) return null;
    const ha = m ? { HOME: 'H', AWAY: 'A', NEUTRAL: 'N' }[m[1].toUpperCase()] : (/\s@\s/.test(title) ? 'A' : 'H');
    const team = teamOf(title, cat);
    const location = String(ev.location || '').trim();
    const notes = String(ev.notes || '');
    const d = notes.match(DRIVE), dir = notes.match(DIRS);
    const miles = d ? Math.round(parseFloat(d[2].replace(/,/g, ''))) : null;
    const drive = d && d[3] ? d[3].trim().replace(/[.;]+$/, '') : '';
    const from = d ? d[1].trim() : (dir ? dir[1].trim() : (team.origin ? team.name : ''));
    const travel = ha !== 'H' || (team.homeMeta && miles != null);
    const url = !travel || !location ? '' : dir ? dir[2] : mapsUrl(location, team.origin);
    const dirFrom = dir ? dir[1].trim() : (team.origin ? team.name : '');
    return { ha, label: LABEL[ha], team: team.id, teamName: team.name, location, miles, drive, from, dirFrom, travel, url };
  }
  const stop = el => { for (const t of ['click', 'mousedown', 'mouseup', 'pointerdown', 'pointerup', 'touchstart', 'touchend']) el.addEventListener(t, e => e.stopPropagation()); return el; };
  function badge(g) {
    const b = document.createElement('span');
    b.className = 'game-ha game-ha-' + g.ha + ' game-ha-' + (g.team || 'maryville'); b.textContent = g.ha;
    b.setAttribute('role', 'img'); b.setAttribute('aria-label', g.label); b.title = g.label;
    return b;
  }
  function distText(g) { return g.miles == null ? '' : `${g.miles} mi${g.drive ? ' · ~' + g.drive : ''}${g.from ? ' from ' + shortFrom(g.from) : ''}`; }
  const dirLabel = g => g.dirFrom ? 'directions from ' + g.dirFrom : 'directions';
  function meta(g, compact) {
    const box = document.createElement('div'); box.className = 'game-meta' + (compact ? ' compact' : '');
    if (g.location) {
      const a = stop(document.createElement('a'));
      a.className = 'game-loc'; a.href = g.url; a.target = '_blank'; a.rel = 'noopener noreferrer';
      a.title = 'D' + dirLabel(g).slice(1) + ' (Google Maps)';
      a.setAttribute('aria-label', `${g.location}. Open ${dirLabel(g)} in Google Maps`);
      a.innerHTML = '<span class="game-ico" aria-hidden="true">📍</span>';
      // compact (Day view): venue name only; the full address is in the Maps link + tooltip
      a.appendChild(document.createTextNode(compact ? g.location.split(',')[0] : g.location));
      if (compact) a.title = g.location + ' (' + dirLabel(g) + ')';
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
    el.classList.add('sandy-game', 'game-' + g.ha, 'game-team-' + (g.team || 'maryville'));
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
    a.textContent = '📍 ' + (g.dirFrom ? 'Directions from ' + g.dirFrom : 'Directions (Google Maps)'); box.appendChild(a);
    const t = distText(g); if (t) { const s = document.createElement('span'); s.className = 'game-dist'; s.textContent = '🚗 ' + t; box.appendChild(s); }
  }
  window.SandyGames = { info, decorate, editor, mapsUrl, ORIGIN, TEAMS };
})();
