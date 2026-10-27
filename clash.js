/* SANDY - Sandy Intelligence feature #5: Clash check (FREE, rule-based, no AI).
   Flag timed events that overlap a work shift or practice/game (Life Time shift, MSC/MAM
   client session, Maryville / HSSU / Jennings practice or game) over the next 7 calendar
   days (today through a week out). Heads Up offers one-tap Add "Who's covering?" to-do (dated the day before, notes
   link the event, deduped). Ignore Christian Dake (reference). Ignore all-day (incl.
   multi-day tournaments). Skip intentional nested Life Time items (office study during
   shift, Bill & Sherita, doughnuts/preview) and same-team practice vs practice/boot camp.
   Soft personal blocks (Study time, Personal Time / routine) do not count as the "other"
   side — avoids Study vs evening game noise. Toggle: Profile → Sandy Intelligence → Clash check.
   In-app only (push later; migration widens si_nudge_sends.kind). */
(function () {
  'use strict';
  const LOOKAHEAD_DAYS = 7; // today through today+7 inclusive (8 calendar days: a week out)
  const MIN_OVERLAP_MIN = 15;
  const MAX_CLASHES = 5;
  const LS_KEY = 'sandy.si.clash';
  const REF_RE = /christian\s+dake/i;
  const COVER_RE = /^who'?s\s+covering\b/i;
  const DURING_SHIFT_RE = /during\s+shift|office\s+study/i;
  const NESTED_LT_RE = /weekly\s+meeting|bill\s*&\s*sherita|doughnut|pizza|\bpreview\b|walkthrough/i;
  const SOFT_CAT_RE = /^(study\s*time|personal\s*time)$/i;
  const SOFT_TITLE_RE = /^study:|^morning\/?evening\s+routine|routine\s*[☀️🌞🌙]/i;

  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const t12 = d => (window.SandyTime ? SandyTime.fmt(d) : (() => { let h = d.getUTCHours(); const m = d.getUTCMinutes(); const ap = h < 12 ? 'AM' : 'PM'; h = h % 12 || 12; return m ? `${h}:${String(m).padStart(2, '0')} ${ap}` : `${h} ${ap}`; })());
  const A = () => window.__app;
  const synced = () => !!(A() && A().Store && A().Store.mode === 'supabase');
  const minsBetween = (a, b) => Math.round((b - a) / 60000);
  const overlapMin = (a0, a1, b0, b1) => {
    const lo = a0 > b0 ? a0 : b0, hi = a1 < b1 ? a1 : b1;
    return hi > lo ? minsBetween(lo, hi) : 0;
  };
  const isRef = e => REF_RE.test(`${(e && e.title) || ''} ${(e && e.category) || ''}`);

  /** Life Time work shift (not nested tasks on that calendar). */
  function isShift(ev) {
    if (!ev || ev.kind === 'task' || ev.allDay) return false;
    const cal = ev.calendar || '';
    const cat = ev.category || '';
    const title = ev.title || '';
    if (cal === 'lifetime' && /work\s*shift/i.test(cat)) return true;
    if (/life\s*time\s*shift/i.test(title)) return true;
    return false;
  }

  /** Maryville / HSSU / Jennings practice or game (category-driven; title fallback). */
  function isPracticeOrGame(ev) {
    if (!ev || ev.kind === 'task' || ev.allDay) return false;
    const cat = ev.category || '';
    const title = ev.title || '';
    if (/^Team\s+practice\b/i.test(cat)) return true;
    if (/^Game\s*[–—-]/i.test(cat)) return true;
    // title fallback when category missing (local tests / imports)
    if (/\b(practice|boot\s*camp)\b/i.test(title) && /\b(maryville|jennings|hssu|harris[\s-]*stowe)\b/i.test(title)) return true;
    if (/\b(maryville|jennings|hssu|harris[\s-]*stowe)\b/i.test(title) && /\b(vs\.?|@|HOME|AWAY|NEUTRAL)\b/i.test(title)) return true;
    return false;
  }

  /** MSC / MAM client session or client workout (not Christian Dake). */
  function isClientDuty(ev) {
    if (!ev || ev.kind === 'task' || ev.allDay || isRef(ev)) return false;
    return /Client\s+(session|workout)/i.test(ev.category || '');
  }

  function isAnchor(ev) { return isShift(ev) || isPracticeOrGame(ev) || isClientDuty(ev); }

  /** Team label from "Team practice – X" / "Game – X" for same-team suppression. */
  function teamOf(ev) {
    const cat = (ev && ev.category) || '';
    let m = cat.match(/^(?:Team\s+practice|Game)\s*[–—-]\s*(.+)$/i);
    if (m) return m[1].trim().toLowerCase();
    const title = (ev && ev.title) || '';
    if (/\bjennings\b/i.test(title)) return 'jennings high school';
    if (/\bhssu\b|harris[\s-]*stowe/i.test(title)) return 'harris-stowe state university';
    if (/\bmaryville\b/i.test(title)) return 'maryville university';
    return '';
  }

  /** Soft personal blocks that should not trigger "Who's covering?" against a duty. */
  function isSoftPersonal(ev) {
    if (!ev) return false;
    const cat = ev.category || '';
    const title = ev.title || '';
    if (SOFT_CAT_RE.test(cat.trim())) return true;
    if (SOFT_TITLE_RE.test(title.trim())) return true;
    return false;
  }

  /** Intentional items nested inside a Life Time shift — not clashes. */
  function isNestedInShift(ev) {
    if (!ev) return false;
    const text = `${ev.title || ''} ${ev.category || ''}`;
    if (DURING_SHIFT_RE.test(text)) return true;
    if (NESTED_LT_RE.test(text)) return true;
    if (ev.calendar === 'lifetime' && !isShift(ev)) return true; // doughnuts, Bill meeting, etc. on LT cal
    return false;
  }

  /**
   * Should (anchor, other) be reported? Both are timed occurrence wrappers {ev,o}.
   * Returns false for ref, soft, nested, same-team practice pairs, tiny overlaps.
   */
  function isClash(anchor, other) {
    if (!anchor || !other) return false;
    if (anchor.ev === other.ev && anchor.o.key === other.o.key) return false;
    if (anchor.ev.id && other.ev.id && anchor.ev.id === other.ev.id && anchor.o.key === other.o.key) return false;
    if (isRef(anchor.ev) || isRef(other.ev)) return false;
    if (anchor.ev.allDay || other.ev.allDay) return false;
    if (anchor.ev.kind === 'task' || other.ev.kind === 'task') return false;
    const ov = overlapMin(anchor.o.start, anchor.o.end || anchor.o.start, other.o.start, other.o.end || other.o.start);
    if (ov < MIN_OVERLAP_MIN) return false;
    if (!isAnchor(anchor.ev)) return false;
    // nested Life Time stuff against a shift
    if (isShift(anchor.ev) && isNestedInShift(other.ev)) return false;
    if (isShift(other.ev) && isNestedInShift(anchor.ev)) return false;
    // same-team practice/game/boot camp vs each other (Jennings practice ∩ Boot Camp)
    if (isPracticeOrGame(anchor.ev) && isPracticeOrGame(other.ev)) {
      const ta = teamOf(anchor.ev), tb = teamOf(other.ev);
      if (ta && tb && ta === tb) return false;
    }
    // soft personal as the "other" side only (still flag soft ∩ soft? no — need a real other)
    if (isSoftPersonal(other.ev) && !isAnchor(other.ev)) return false;
    // two softs never; if other is also only soft we're done. If other is another anchor, OK.
    return true;
  }

  /** Pick which side is the duty needing coverage (prefer shift > practice/game > client). */
  function rankAnchor(ev) {
    if (isShift(ev)) return 3;
    if (isPracticeOrGame(ev)) return 2;
    if (isClientDuty(ev)) return 1;
    return 0;
  }

  function dayLabel(a, start, today) {
    const d0 = a.startOfDay(start);
    const diff = Math.round((d0 - today) / 86400000);
    if (diff === 0) return 'Today';
    if (diff === 1) return 'Tomorrow';
    return a.fmtDay(start);
  }

  function coverTitle(duty) {
    const t = String(duty.ev.title || 'event').trim();
    const short = t.length > 42 ? t.slice(0, 40) + '…' : t;
    return `Who's covering? — ${short}`;
  }

  function coverNotes(duty, other) {
    const a = A();
    const ymd = a && a.ymd ? a.ymd(duty.o.start) : duty.o.start.toISOString().slice(0, 10);
    const hm = d => a && a.hm ? a.hm(d) : `${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}`;
    const when = `${ymd} ${hm(duty.o.start)}–${hm(duty.o.end || duty.o.start)}`;
    const lines = [
      `Clash: overlaps “${other.ev.title}”`,
      `Duty: ${duty.ev.title}`,
      `When: ${when}`,
      `Event id: ${duty.ev.id || ''}`,
      `Occurrence: ${duty.o.key}`,
    ];
    return lines.join('\n');
  }

  function coverKey(duty) {
    return `clash:${duty.ev.id}:${duty.o.key}`;
  }

  // ---- prefs ----
  let prefs;
  function readLocal() {
    try { const v = localStorage.getItem(LS_KEY); if (v === '0') return false; if (v === '1') return true; } catch (_) {}
    return true;
  }
  function writeLocal(on) { try { localStorage.setItem(LS_KEY, on ? '1' : '0'); } catch (_) {} }
  async function getPrefs() {
    if (prefs !== undefined) return prefs;
    let p = { enabled: readLocal(), available: false };
    if (synced()) {
      try {
        const r = await A().Store.profile();
        if (r && 'si_clash' in r) p = { enabled: r.si_clash !== false, available: true };
      } catch (_) {}
    }
    return (prefs = p);
  }
  async function setPrefs(patch) {
    if ('enabled' in patch) writeLocal(!!patch.enabled);
    if (synced() && 'enabled' in patch) {
      try { await A().Store.saveProfile({ si_clash: !!patch.enabled }); }
      catch (e) {
        if (e && (e.code === 'PGRST204' || e.code === '42703' || /si_clash|column/i.test(e.message || '')))
          throw new Error('Sandy Intelligence needs a one-time server update first. Try again soon.');
        throw new Error('Could not save: ' + (e.message || e));
      }
    }
    prefs = { ...(await getPrefs()), ...patch, available: synced() ? true : false };
    return prefs;
  }
  function invalidate() { prefs = undefined; }

  /** Collect timed occurrences in [today, today+LOOKAHEAD_DAYS). */
  async function windowOccs(a, now) {
    const today = a.startOfDay(now);
    const end = a.addDays(today, LOOKAHEAD_DAYS + 1); // exclusive end → includes today+LOOKAHEAD
    const vis = a.settings().visible;
    const all = (await a.Store.list()).filter(e => vis[e.calendar] !== false);
    const out = [];
    for (const ev of all) {
      if (ev.kind === 'task' || ev.allDay || isRef(ev)) continue;
      for (const o of a.occurrences(ev, today, end)) {
        if (!o.end || o.end <= o.start) continue;
        out.push({ ev, o, day: a.startOfDay(o.start) });
      }
    }
    return { today, end, items: out };
  }

  /** Find clash pairs; normalize so `duty` is the higher-ranked anchor. */
  function findClashes(items) {
    const anchors = items.filter(x => isAnchor(x.ev));
    const out = [];
    const seen = new Set();
    for (const dutyCand of anchors) {
      for (const other of items) {
        if (!isClash(dutyCand, other)) continue;
        // choose duty = higher rank; if other is also anchor and ranks higher, swap
        let duty = dutyCand, oth = other;
        if (isAnchor(other.ev) && rankAnchor(other.ev) > rankAnchor(dutyCand.ev)) {
          // only swap if the swapped pair would still pass isClash
          if (isClash(other, dutyCand)) { duty = other; oth = dutyCand; }
        }
        const sid = x => `${x.ev.id || x.ev.title}\0${x.o.start.toISOString()}\0${(x.o.end || x.o.start).toISOString()}`;
        const key = [sid(duty), sid(oth)].sort().join('|');
        if (seen.has(key)) continue;
        seen.add(key);
        const ov = overlapMin(duty.o.start, duty.o.end, oth.o.start, oth.o.end);
        out.push({ duty, other: oth, overlapMin: ov, key: coverKey(duty) });
      }
    }
    // soonest first
    out.sort((x, y) => x.duty.o.start - y.duty.o.start || y.overlapMin - x.overlapMin);
    return out.slice(0, MAX_CLASHES);
  }

  /** Whether a "Who's covering?" to-do already exists for this duty occurrence. */
  async function alreadyCovered(a, clash) {
    const idMark = `Event id: ${clash.duty.ev.id}`;
    const occMark = `Occurrence: ${clash.duty.o.key}`;
    const title = coverTitle(clash.duty).toLowerCase();
    for (const ev of await a.Store.list()) {
      if (ev.kind !== 'task') continue;
      if (a.isDone && a.isDone(ev, a.ymd(a.parseLocal(String(ev.start).slice(0, 10))))) continue;
      const notes = ev.notes || '';
      if (notes.includes(idMark) && notes.includes(occMark)) return true;
      if (COVER_RE.test(ev.title || '') && (ev.title || '').toLowerCase() === title) {
        // same title + due around the duty day
        const due = String(ev.start || '').slice(0, 10);
        const before = a.ymd(a.addDays(a.startOfDay(clash.duty.o.start), -1));
        if (due === before || due === a.ymd(clash.duty.o.start)) return true;
      }
    }
    try {
      const Inbox = window.SandyNav && SandyNav.Inbox;
      if (Inbox) {
        for (const it of await Inbox.list()) {
          if (it.done) continue;
          const body = String(it.body || '');
          if (body.includes(idMark) && body.includes(occMark)) return true;
        }
      }
    } catch (_) {}
    return false;
  }

  async function data(a, now) {
    const p = await getPrefs();
    if (!p.enabled) return null;
    const { today, items } = await windowOccs(a, now);
    const raw = findClashes(items);
    if (!raw.length) return null;
    const clashes = [];
    for (const c of raw) {
      const has = await alreadyCovered(a, c);
      clashes.push({ ...c, hasCover: has });
    }
    return { now, today, clashes };
  }

  function htmlItems(d) {
    if (!d || !d.clashes.length) return '';
    const a = A();
    return d.clashes.map(c => {
      const duty = c.duty, oth = c.other;
      const when = `${dayLabel(a, duty.o.start, d.today)} ${esc(t12(duty.o.start))}–${esc(t12(duty.o.end))}`;
      const btn = c.hasCover
        ? `<span class="cl-done">Covering to-do added</span>`
        : `<button type="button" class="cl-add" data-cl-key="${esc(c.key)}" data-duty-id="${esc(duty.ev.id)}" data-duty-key="${esc(duty.o.key)}" data-other-id="${esc(oth.ev.id)}" data-other-key="${esc(oth.o.key)}">Add “Who's covering?”</button>`;
      return `<li class="cl-row">⚠️ <b>${esc(duty.ev.title)}</b> overlaps <b>${esc(oth.ev.title)}</b> <span class="cl-when">(${when})</span> ${btn}</li>`;
    }).join('');
  }

  /** Full Heads Up fragment (ul) — nav injects into #tcClash. */
  function html(d) {
    const items = htmlItems(d);
    if (!items) return '';
    return `<ul class="tc-warn tc-clash" id="tcClash">${items}</ul>`;
  }

  /** Add covering to-do for clash identified by duty id/key. Returns {msg, undo}. */
  async function addCover(dutyId, dutyKey, otherId, otherKey) {
    const a = A(); if (!a) throw new Error('App not ready');
    const all = await a.Store.list();
    const dutyEv = all.find(e => e.id === dutyId);
    if (!dutyEv) throw new Error('Event not found');
    // rebuild occurrence from key
    const day = a.parseLocal(dutyKey);
    const occs = a.occurrences(dutyEv, a.startOfDay(day), a.addDays(a.startOfDay(day), 1));
    const o = occs.find(x => x.key === dutyKey) || occs[0];
    if (!o) throw new Error('Occurrence not found');
    const duty = { ev: dutyEv, o };
    let other = { ev: { title: 'another event' }, o: o };
    if (otherId) {
      const oe = all.find(e => e.id === otherId);
      if (oe) {
        const od = a.parseLocal(otherKey || dutyKey);
        const oo = a.occurrences(oe, a.startOfDay(od), a.addDays(a.startOfDay(od), 1)).find(x => x.key === (otherKey || dutyKey))
          || a.occurrences(oe, a.startOfDay(od), a.addDays(a.startOfDay(od), 1))[0];
        if (oo) other = { ev: oe, o: oo };
      }
    }
    const clash = { duty, other, key: coverKey(duty) };
    if (await alreadyCovered(a, clash)) throw new Error('Already added');

    const dueDay = a.addDays(a.startOfDay(duty.o.start), -1);
    // if duty is tomorrow-or-today early, due today is fine (don't date in the past relative to "now" beyond today)
    const today = a.startOfDay(a.nowWall());
    const startYmd = a.ymd(dueDay < today ? today : dueDay);
    const cal = dutyEv.calendar && a.calendars().some(c => c.id === dutyEv.calendar) ? dutyEv.calendar : a.firstVisibleCal();
    const ev = {
      id: (crypto.randomUUID && crypto.randomUUID()) || undefined,
      kind: 'task', title: coverTitle(duty),
      notes: coverNotes(duty, other),
      calendar: cal, category: 'Task / to-do', allDay: true,
      start: startYmd, end: startYmd, recurrence: { freq: 'none' },
      location: '', reminders: [], priority: 1, scope: 'day', done: false
    };
    const saved = await a.Store.save(ev);
    return {
      msg: `Added “Who's covering?” for ${dutyEv.title.slice(0, 36)}`,
      undo: async () => { try { await a.Store.remove(saved.id); } catch (_) {} }
    };
  }

  window.SandyClash = {
    LOOKAHEAD_DAYS, MIN_OVERLAP_MIN, MAX_CLASHES,
    isRef, isShift, isPracticeOrGame, isClientDuty, isAnchor, isSoftPersonal, isNestedInShift,
    teamOf, isClash, findClashes, data, html, htmlItems, addCover, coverTitle, coverNotes,
    getPrefs, setPrefs, invalidate,
    _test: { overlapMin, rankAnchor, alreadyCovered, windowOccs, coverKey, dayLabel }
  };
})();
