/* SANDY - Sandy Intelligence: Practice prep card on the Today tab.
   Before a Maryville University or Jennings High School practice (today until it ends; tomorrow's too after 6 PM),
   show what you wrote about that team's LAST practice: its Today's Note (day note), the practice's own notes when it
   was a one-off, and its Notion page link if the sync routine recorded one (cal.py note-link). Only SANDY data is
   read; the app never calls Notion (the link just opens the page). Plus this practice's own note if already started. */
(function () {
  'use strict';
  const DAY = 864e5, LOOKBACK_DAYS = 120, MAX_LINES = 8, EVENING_HOUR = 18;
  const TEAMS = [
    { id: 'maryville', name: 'Maryville University', re: /maryville/i },
    { id: 'jennings', name: 'Jennings High School', re: /jennings/i },
  ];
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const t12 = d => (window.SandyTime ? SandyTime.fmt(d) : (() => { let h = d.getUTCHours(); const m = d.getUTCMinutes(); const ap = h < 12 ? 'AM' : 'PM'; h = h % 12 || 12; return `${h}:${String(m).padStart(2, '0')} ${ap}`; })());
  const day = d => new Date(d.getTime()).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' });

  /** Which team's practice is this event? Category "Team practice – Maryville University" (or a title like
   *  "Jennings HS practice"). Games, client workouts, other teams: null. */
  function teamOf(ev) {
    if (!ev || ev.kind === 'task' || ev.allDay) return null;
    const cat = String(ev.category || ''), title = String(ev.title || '');
    const isPractice = /^team practice/i.test(cat) || (/practice/i.test(title) && !/^game/i.test(cat));
    if (!isPractice) return null;
    const src = /^team practice/i.test(cat) ? cat : title;
    return TEAMS.find(t => t.re.test(src)) || null;
  }
  const noteText = (s) => String(s || '').split('\n').map(x => x.trimEnd()).filter(x => x.trim()).join('\n');

  /** Upcoming practices to prep for + the last practice with notes for each team. */
  async function data(a, now) {
    const today = a.startOfDay(now);
    const until = now.getUTCHours() >= EVENING_HOUR ? a.addDays(today, 2) : a.addDays(today, 1);
    const vis = a.settings().visible;
    const all = (await a.Store.list()).filter(e => vis[e.calendar] !== false && teamOf(e));
    if (!all.length) return [];
    const notes = a.Store.notes, links = a.Store.links;
    const noteMap = new Map(), linkMap = new Map();
    try { for (const n of await notes.all()) noteMap.set(`${n.eventId}|${n.date}`, n); } catch (_) {}
    try { if (links) for (const l of await links.all()) linkMap.set(`${l.eventId}|${l.date}`, l.url); } catch (_) {}
    const occ = [];
    for (const ev of all) for (const o of a.occurrences(ev, a.addDays(today, -LOOKBACK_DAYS), until)) occ.push({ ev, o, team: teamOf(ev) });
    occ.sort((x, y) => x.o.start - y.o.start);
    const info = x => {
      const nk = a.noteKeyFor(x.ev, x.o.key), k = `${nk.eventId}|${nk.date}`;
      const n = noteMap.get(k);
      const own = !a.isRecurring(x.ev) && !x.ev.seriesId ? noteText(x.ev.notes) : ''; // a one-off's notes are that practice's notes
      return { note: noteText(n && n.body), own, link: linkMap.get(k) || null };
    };
    const out = [];
    for (const team of TEAMS) {
      const mine = occ.filter(x => x.team === team);
      const next = mine.find(x => (x.o.end || x.o.start) > now);
      if (!next) continue;
      let last = null;
      for (let i = mine.length - 1; i >= 0; i--) {
        const x = mine[i];
        if (x.o.start >= next.o.start || x === next) continue;
        const inf = info(x);
        if (inf.note || inf.own || inf.link) { last = { x, ...inf }; break; }
      }
      const prevAny = mine.filter(x => x.o.start < next.o.start).pop() || null;
      out.push({ team, next, nextInfo: info(next), last, prevAny, started: next.o.start <= now });
    }
    return out.sort((p, q) => p.next.o.start - q.next.o.start);
  }

  const evBtn = (x, text) => `<button type="button" class="tc-link tc-item" data-id="${esc(x.ev.id)}" data-key="${esc(x.o.key)}">${esc(text || x.ev.title)}</button>`;
  const notion = url => `<a class="pp-notion" href="${esc(url)}" target="_blank" rel="noopener noreferrer">Open notes in Notion ↗</a>`;
  function body(text) {
    const lines = text.split('\n');
    const head = lines.slice(0, MAX_LINES).map(l => `<li>${esc(l.replace(/^\s*[-*•]\s*/, ''))}</li>`).join('');
    const rest = lines.slice(MAX_LINES);
    return `<ul class="pp-notes">${head}</ul>` + (rest.length ? `<details class="pp-more"><summary>Show ${rest.length} more line${rest.length === 1 ? '' : 's'}</summary><ul class="pp-notes">${rest.map(l => `<li>${esc(l.replace(/^\s*[-*•]\s*/, ''))}</li>`).join('')}</ul></details>` : '');
  }
  function html(list, now, today) {
    return list.map(p => {
      const when = Math.round((Date.UTC(p.next.o.start.getUTCFullYear(), p.next.o.start.getUTCMonth(), p.next.o.start.getUTCDate()) - today.getTime()) / DAY);
      const whenTxt = p.started ? `now, until ${t12(p.next.o.end || p.next.o.start)}` : `${when === 0 ? 'Today' : 'Tomorrow'} ${t12(p.next.o.start)}`;
      let h = `<section class="tc-sec tc-card tc-practice" data-team="${p.team.id}" aria-label="Practice prep: ${esc(p.team.name)}">`;
      h += `<h3>🏀 Practice prep <span class="pp-team">· ${esc(p.team.name)}</span></h3>`;
      h += `<p class="tc-next pp-next"><span class="tc-next-k">Next</span><span class="tc-next-v">${evBtn(p.next)} <span class="pp-when">${esc(whenTxt)}</span></span></p>`;
      if (p.last) {
        h += `<h4 class="pp-h4">Last practice · ${evBtn(p.last.x, day(p.last.x.o.start))}</h4>`;
        const text = [p.last.note, p.last.own].filter(Boolean).join('\n');
        if (text) h += body(text);
        if (p.last.link) h += `<p class="pp-link">${notion(p.last.link)}</p>`;
        if (p.prevAny && p.prevAny !== p.last.x) h += `<p class="muted small pp-gap">No notes from ${esc(day(p.prevAny.o.start))}; these are the most recent.</p>`;
      } else h += `<p class="muted small pp-none">No notes from an earlier ${esc(p.team.name)} practice yet. Add a Today’s Note to a practice and it’ll show here before the next one.</p>`;
      const mine = [p.nextInfo.note, p.nextInfo.own].filter(Boolean).join('\n');
      if (mine || p.nextInfo.link) h += `<h4 class="pp-h4">This practice</h4>${mine ? body(mine) : ''}${p.nextInfo.link ? `<p class="pp-link">${notion(p.nextInfo.link)}</p>` : ''}`;
      return h + '</section>';
    }).join('');
  }
  window.SandyPractice = { teamOf, data, html, TEAMS, LOOKBACK_DAYS };
})();
