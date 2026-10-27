/*
 * smartparse.js: Todoist-style quick-add parsing for the To-Do tab (2026-10-24).
 * SandyParse.parse(text, { now, categories, disabled, h24 }) → { tokens, date, time, category, title }
 *  - h24: the user's clock is 24-hour (SandyTime.is24()): a bare "5:15" / "10:00" means 05:15 / 10:00 instead of staying text.
 *  Military / 24-hour times (2026-10-26): "1430", "0900", "2330", "0000", "14:30", "09:00", "1430 hrs" (rules at TIME_RULES).
 *  - now: a "wall clock" Date (Chicago time stored in the UTC fields, like app.js nowWall()).
 *  - categories: [{ id, name }] — only existing category names become chips (case-insensitive, whole word).
 *  - disabled: Set of token keys ("kind:lowercased text") the user tapped off; those stay plain text.
 * tokens: [{ kind: 'date'|'time'|'category'|'priority', start, end, text, key }] (start/end are indexes into text).
 * date: 'YYYY-MM-DD' | null, time: 'HH:MM' | null, category: { id, name } | null, priority: 1-4 | null (Todoist-style "p1"…"p4", 2026-10-25 fab).
 */
(function (root) {
  'use strict';
  const DAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
  const DAY_RE = '(sunday|monday|tue(?:s|sday)?|wednesday|thu(?:rs?|rsday)?|fri(?:day)?|saturday)';
  const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
  const MON_RE = '(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sept?(?:ember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)';
  const NUMW = { a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10 };
  const pad = n => String(n).padStart(2, '0');
  const ymd = d => `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
  const day0 = now => new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const addD = (d, n) => new Date(d.getTime() + n * 864e5);
  const dayIdx = s => DAYS.findIndex(d => d.startsWith(s.slice(0, 3)));
  const reEsc = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  // word boundary that works for any text: not preceded / followed by a letter or digit
  const B0 = '(?<![\\p{L}\\p{N}])', B1 = '(?![\\p{L}\\p{N}])';

  function monthDay(m, d, y, today) {
    if (m < 0 || m > 11 || d < 1 || d > 31) return null;
    let yr = y != null ? (y < 100 ? 2000 + y : y) : today.getUTCFullYear();
    let dt = new Date(Date.UTC(yr, m, d));
    if (dt.getUTCMonth() !== m) return null; // Feb 30 etc.
    if (y == null && dt < addD(today, -1)) dt = new Date(Date.UTC(yr + 1, m, d)); // "Jan 5" in late Oct → next year
    return dt;
  }
  // Date rules: [regex, fn(match, today, now) → Date | null]. Longer phrases first.
  // "Nov 3, 2000" → year 2000; "Nov 3 2027" → year (last year … +5); "Nov 3 2000" / "Nov 3 1430" → Nov 3 at 20:00 / 14:30
  const NEAR_YEARS = (() => { const y = new Date().getUTCFullYear(); return Array.from({ length: 7 }, (_, i) => y - 1 + i).join('|'); })();
  const DATE_RULES = [
    [`next\\s+week`, (m, t) => addD(t, ((8 - t.getUTCDay()) % 7) || 7)],
    [`next\\s+month`, (m, t) => new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth() + 1, 1))],
    [`next\\s+${DAY_RE}`, (m, t) => { const w = dayIdx(m[1].toLowerCase()); const n = (w - t.getUTCDay() + 7) % 7 || 7; return addD(t, n); }],
    [`(?:this\\s+)?weekend`, (m, t) => addD(t, t.getUTCDay() === 6 || t.getUTCDay() === 0 ? 0 : 6 - t.getUTCDay())],
    [`in\\s+(\\d{1,3}|a|an|one|two|three|four|five|six|seven|eight|nine|ten)\\s+(days?|weeks?)`, (m, t) => { const n = /\d/.test(m[1]) ? +m[1] : NUMW[m[1].toLowerCase()]; return addD(t, n * (/week/i.test(m[2]) ? 7 : 1)); }],
    [`day\\s+after\\s+tomorrow`, (m, t) => addD(t, 2)],
    [`today|tonight`, (m, t) => t],
    [`tomorrow|tmrw|tmr`, (m, t) => addD(t, 1)],
    [`(?:on\\s+)?(?:this\\s+)?${DAY_RE}`, (m, t) => { const w = dayIdx(m[1].toLowerCase()); return addD(t, (w - t.getUTCDay() + 7) % 7 || 7); }],
    [`(?:on\\s+)?${MON_RE}\\.?\\s+(\\d{1,2})(?:st|nd|rd|th)?(?:,\\s*((?:19|20)\\d{2})|\\s+(${NEAR_YEARS}))?`, (m, t) => monthDay(MONTHS.indexOf(m[1].slice(0, 3).toLowerCase()), +m[2], m[3] || m[4] ? +(m[3] || m[4]) : null, t)],
    [`(?:on\\s+)?(\\d{1,2})(?:st|nd|rd|th)?\\s+(?:of\\s+)?${MON_RE}`, (m, t) => monthDay(MONTHS.indexOf(m[2].slice(0, 3).toLowerCase()), +m[1], null, t)],
    [`(?:on\\s+)?(\\d{1,2})\\/(\\d{1,2})(?:\\/(\\d{2}|\\d{4}))?`, (m, t) => monthDay(+m[1] - 1, +m[2], m[3] ? +m[3] : null, t)],
  ];
  // Time rules → minutes after midnight, or null.
  const h12 = (h, mi, ap) => { h = +h; mi = +(mi || 0); if (h < 1 || h > 12 || mi > 59) return null; ap = ap.toLowerCase()[0]; return ((h % 12) + (ap === 'p' ? 12 : 0)) * 60 + mi; };
  // 24-hour / military times (Scott 2026-10-26): "1430", "0900", "2330", "0000", "14:30", "09:00", "1430 hrs".
  // A bare 4-digit number is a time only when it is 0000-2359, a standalone token, and nothing around it says it's
  // something else (see notMilitary). Year-looking numbers need an "at" / "@" / "hrs" cue (see YEARISH).
  const CUE_BEFORE = /(?:^|[\s(])(?:at|@)\s*$/i;
  const NOT_BEFORE = /(?:[#№$£€]|[\d][-\/.,:]|\d\s*[x×*]|\b(?:room|rm|suite|ste|apt|apartment|unit|no|nos|num|number|ext|extension|bldg|building|box|order|invoice|inv|ticket|flight|flt|route|rte|hwy|highway|exit|mile|page|pg|pp|zip|code|pin|id|model|version|ver|v|lot|gate|door|seat|row|section|sec|account|acct|po|year|yr|fy|in|since|of|circa|ca|class|vol|chapter|ch|step|item|part|isbn|sku|ref|case|ticket)\.?)\s*$/i;
  const NOT_AFTER = /^(?:\s*(?:%|[x×](?![\p{L}])|[.,]\d|[-–\/]\s*\d{2}(?!\d))|\s+(?:lbs?|pounds?|kgs?|g|grams?|cals?|calories|kcal|reps?|sets?|yds?|yards?|mi|miles?|km|kms|ft|feet|foot|meters?|metres?|m|dollars?|bucks|usd|cents|people|ppl|persons?|guests?|words?|pages?|items?|units?|points?|pts|steps?|sq|square|copies|pcs|pieces|tickets?|members?|students?|kids|players?|views|followers|likes|times|sqft|acres?|ml|oz|ounces?|liters?|litres?|gallons?|bpm|rpm|mg|mph|kph|degrees?|°)(?![\p{L}]))/iu;
  const STREET = new Set(['st', 'street', 'ave', 'av', 'avenue', 'rd', 'road', 'blvd', 'boulevard', 'dr', 'drive', 'ln', 'lane', 'ct', 'court', 'way', 'pkwy', 'parkway', 'hwy', 'highway', 'cir', 'circle', 'pl', 'place', 'ter', 'terrace', 'trl', 'trail', 'sq', 'plaza', 'pike', 'loop', 'row']);
  // "1430 Main St", "2330 S Grand Blvd": up to 3 capitalised words (or N/S/E/W, numbers) then a street suffix
  function streetAfter(after) {
    const w = after.trim().split(/\s+/).slice(0, 4);
    for (let k = 0; k < w.length; k++) {
      const x = w[k].replace(/[.,]+$/, '');
      if (k > 0 && STREET.has(x.toLowerCase())) return true;
      if (!/^[A-Z0-9]/.test(x)) return false;
    }
    return false;
  }
  function notMilitary(m) {
    const before = m.input.slice(0, m.index), after = m.input.slice(m.index + m[0].length);
    if (NOT_BEFORE.test(before)) return true;
    if (NOT_AFTER.test(after) || streetAfter(after)) return true;
    return false;
  }
  const YEARISH = (n, y) => n >= 1900 && n <= 2099 && (n >= y - 1 && n <= y + 5); // 2025-2031 in 2026: a year unless cued
  const TIME_RULES = [
    [`(?:at\\s+|@\\s*)?(\\d{1,2})(?::(\\d{2}))?\\s*(a\\.?m\\.?|p\\.?m\\.?|a|p)(?![\\p{L}\\p{N}])`, m => h12(m[1], m[2], m[3])],
    [`(?:at\\s+|@\\s*)?(noon|midday)`, () => 12 * 60],
    [`(?:at\\s+|@\\s*)?midnight`, () => 0],
    // military: "1430", "at 0900", "2330 hrs", "1430h"
    [`(at\\s+|@\\s*)?([01]\\d|2[0-3])([0-5]\\d)(\\s*(?:hrs|hr|hours|h))?`, (m, o) => {
      const cued = !!(m[1] || m[4]) || CUE_BEFORE.test(m.input.slice(0, m.index));
      if (!cued) {
        if (notMilitary(m)) return null;
        if (YEARISH(+(m[2] + m[3]), o.year)) return null;
      }
      return +m[2] * 60 + +m[3];
    }],
    // "14:30", "09:00", "0:30", "at 5:15", "10:00": zero-padded / 13+ / 0 / "hrs" / 24-hour mode → literal 24-hour;
    // otherwise (12-hour mode, "5:15") the usual guess: 7-11 → AM, 12 → noon, 1-6 → PM.
    [`(at\\s+|@\\s*)?(\\d{1,2}):(\\d{2})(\\s*(?:hrs|hr|h))?`, (m, o) => {
      const h = +m[2], mi = +m[3]; if (h > 23 || mi > 59) return null;
      if (!m[1] && notMilitary(m)) return null;
      const literal = h >= 13 || h === 0 || m[2][0] === '0' || !!m[4] || o.h24;
      return literal ? h * 60 + mi : guess(h, mi);
    }],
    [`(?:at\\s+|@\\s*)(\\d{1,2})`, m => guess(+m[1], 0)],
  ];
  // "at 3" with no am/pm: 7–11 → morning, 12 → noon, 1–6 → afternoon (how people write to-dos).
  function guess(h, mi) { if (h < 1 || h > 12 || mi > 59) return null; return ((h >= 7 && h <= 11) ? h : (h === 12 ? 12 : h + 12)) * 60 + mi; }

  function parse(text, opts = {}) {
    text = String(text || '');
    const now = opts.now || new Date();
    const today = day0(now);
    const disabled = opts.disabled || new Set();
    const cats = (opts.categories || []).filter(c => c && c.name && c.name.trim());
    const taken = new Array(text.length).fill(false);
    const free = (s, e) => { for (let i = s; i < e; i++) if (taken[i]) return false; return true; };
    const take = (s, e) => { for (let i = s; i < e; i++) taken[i] = true; };
    const tokens = []; let date = null, minutes = null, category = null, dateTok = null;
    const scan = (src, kind, fn) => {
      const re = new RegExp(B0 + '(?:' + src + ')' + B1, 'giu'); let m;
      while ((m = re.exec(text))) {
        if (!m[0]) { re.lastIndex++; continue; }
        const s = m.index, e = s + m[0].length, raw = m[0];
        const key = kind + ':' + raw.toLowerCase().replace(/\s+/g, ' ');
        if (!free(s, e) || disabled.has(key)) continue;
        const v = fn(m);
        if (v == null) continue;
        return { s, e, raw, key, v };
      }
      return null;
    };
    // categories first (longest name first) so "Home" the category isn't eaten by anything else
    for (const c of [...cats].sort((x, y) => y.name.length - x.name.length)) {
      if (category) break;
      const hit = scan(reEsc(c.name.trim()).replace(/\s+/g, '\\s+'), 'category', () => c);
      if (hit) { take(hit.s, hit.e); category = { id: c.id, name: c.name }; tokens.push({ kind: 'category', start: hit.s, end: hit.e, text: hit.raw, key: hit.key }); }
    }
    for (const [src, fn] of DATE_RULES) {
      const hit = scan(src, 'date', m => fn(m, today, now));
      if (hit) { take(hit.s, hit.e); date = hit.v; dateTok = hit; tokens.push({ kind: 'date', start: hit.s, end: hit.e, text: hit.raw, key: hit.key }); break; }
    }
    const topts = { h24: !!opts.h24, year: now.getUTCFullYear() };
    for (const [src, fn] of TIME_RULES) {
      const hit = scan(src, 'time', m => fn(m, topts));
      if (hit) { take(hit.s, hit.e); minutes = hit.v; tokens.push({ kind: 'time', start: hit.s, end: hit.e, text: hit.raw, key: hit.key }); break; }
    }
    let priority = null;
    { const hit = scan('p([1-4])', 'priority', m => +m[1]); if (hit) { take(hit.s, hit.e); priority = hit.v; tokens.push({ kind: 'priority', start: hit.s, end: hit.e, text: hit.raw, key: hit.key }); } }
    // "tonight" with no time → no time; a time with no date → today, or tomorrow if that time already passed
    let dateStr = date ? ymd(date) : null;
    if (!dateStr && minutes != null) {
      const nowMin = now.getUTCHours() * 60 + now.getUTCMinutes();
      dateStr = ymd(minutes > nowMin ? today : addD(today, 1));
    }
    tokens.sort((a, b) => a.start - b.start);
    // title = text minus tokens, with dangling connector words tidied up
    let title = '', last = 0;
    for (const t of tokens) { title += text.slice(last, t.start) + ' '; last = t.end; }
    title += text.slice(last);
    title = title.replace(/\s+/g, ' ').trim()
      .replace(/(?:^|\s)(?:at|on|by|for|@)$/i, '').replace(/^(?:at|on|by|@)\s+/i, '')
      .replace(/\s+([,.;!?])/g, '$1').replace(/^[,.;\-–\s]+|[,;\-–\s]+$/g, '').trim();
    if (!title && category) title = category.name.charAt(0).toUpperCase() + category.name.slice(1);
    if (!title) title = text.trim();
    return { tokens, date: dateStr, time: minutes == null ? null : `${pad(Math.floor(minutes / 60))}:${pad(minutes % 60)}`, category, priority, title };
  }
  const api = { parse, ymd };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.SandyParse = api;
})(typeof window !== 'undefined' ? window : globalThis);
