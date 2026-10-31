/* SANDY - sub-tasks inside a to-do (Scott 2026-10-31, Todoist Inbox parity).
   Stored in the to-do's own text, no new database columns:
     - scheduled to-dos: '- [ ] item' lines at the end of Notes (the same checklist lines the event editor already
       understands); ticks live in occurrence_checks per date, so a repeating to-do starts each date unticked and the
       editor checklist, Tomorrow prep and the To-Do sheet all agree.
     - Inbox jots: '- [ ] item' / '- [x] item' lines after the description (ticks inline: a jot has no date).
   Everything that already syncs / saves offline for notes and checks carries sub-tasks too. */
(function () {
  'use strict';
  const LINE = /^\s*[-*]\s*\[( |x|X)?\]\s*(.+?)\s*$/;
  const key = t => String(t || '').toLowerCase().replace(/\s+/g, ' ').trim(); // same key as the editor checklist
  /** text -> { desc, subs:[{text,key,done}] } (done only from inline [x]) */
  function parse(text) {
    const desc = [], subs = [], seen = new Set();
    for (const line of String(text || '').split('\n')) {
      const m = line.match(LINE);
      if (m) { const k = key(m[2]); if (!seen.has(k)) { seen.add(k); subs.push({ text: m[2], key: k, done: !!m[1] && m[1] !== ' ' }); } }
      else desc.push(line);
    }
    return { desc: desc.join('\n').replace(/\s+$/, '').replace(/^\n+/, ''), subs };
  }
  /** desc + subs -> stored text. inline=true writes [x] for done items (Inbox jots). */
  function compose(desc, subs, inline) {
    const d = String(desc || '').replace(/\s+$/, '');
    const lines = (subs || []).filter(s => s && String(s.text || '').trim()).map(s => `- [${inline && s.done ? 'x' : ' '}] ${String(s.text).replace(/\s*\n\s*/g, ' ').trim()}`);
    return lines.length ? (d ? d + '\n' + lines.join('\n') : lines.join('\n')) : d;
  }
  /** the done set for a scheduled to-do occurrence, from occurrence_checks rows */
  function doneKeys(checksAll, nk) {
    const c = (checksAll || []).find(x => x.eventId === nk.eventId && x.date === nk.date);
    return new Set(c ? c.checked : []);
  }
  window.SandySubs = { parse, compose, key, doneKeys, LINE };
})();
