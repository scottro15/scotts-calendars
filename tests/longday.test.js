// Node unit test for Sandy Intelligence #2 long-day analyze (client longday.js pure helpers via jsdom-free extract).
// Runs the IIFE under a minimal window stub, then checks thresholds, reference-only skip, meal gap, message.
//   node tests/longday.test.js
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';
import vm from 'node:vm';

const assert = (c, m) => { if (!c) throw new Error('FAIL: ' + m); console.log('ok -', m); };
const W = (y, m, d, h = 0, mi = 0) => new Date(Date.UTC(y, m, d, h, mi));
const ev = (h0, m0, h1, m1, title = 'X') => ({ start: W(2026, 9, 27, h0, m0), end: W(2026, 9, 27, h1, m1), title });

const code = readFileSync(new URL('../longday.js', import.meta.url), 'utf8');
const window = { SandyTime: null };
const sandbox = { window, console, localStorage: { _m: {}, getItem(k){return this._m[k]??null;}, setItem(k,v){this._m[k]=String(v);}, removeItem(k){delete this._m[k];} } };
vm.runInNewContext(code, sandbox);
const M = sandbox.window.SandyLongDay;

assert(M.SPAN_HOURS === 10 && M.SCHEDULED_HOURS === 8 && M.MEAL_GAP_MIN === 30 && M.CARD_HOUR === 17 && M.PUSH_HOUR === 20, 'constants');

// Scott-like Tuesday: 6 AM study → 9 PM study, Christian Dake ignored
const scott = [
  ev(6, 0, 7, 0, 'Study: The Covenant Code'),
  ev(7, 0, 7, 30, 'Morning/Evening Routine'),
  ev(9, 0, 10, 30, 'Upper Body Lift and Shower'),
  ev(9, 30, 10, 0, 'Christian DAKE Workout 🏀'), // reference — ignore
  ev(11, 0, 19, 0, 'Life Time shift'),
  ev(20, 0, 21, 0, 'Study: The Teachings'),
];
let info = M.analyze(scott);
assert(info.isLong && info.reason === 'span', 'Scott Tuesday is long by span: ' + JSON.stringify({ reason: info.reason, span: info.spanMin, sched: info.scheduledMin }));
assert(info.spanMin === 15 * 60, 'span 6 AM–9 PM = 15h: ' + info.spanMin);
assert(info.scheduledMin === 12 * 60, 'scheduled 12h ignoring overlap+ref: ' + info.scheduledMin); // 1+0.5+1.5+8+1 = 12
assert(info.count === 5, 'Christian Dake dropped: count=' + info.count);
assert(info.gap && info.gap.min === 90, 'longest/preferred gap 7:30–9:00 = 90: ' + (info.gap && info.gap.min));
const msg = M.message(info);
assert(/Long day tomorrow:/.test(msg) && /Pack lunch and snacks tonight/.test(msg), 'message core: ' + msg);
assert(/longest open window is/.test(msg) || /best lunch window is/.test(msg), 'mentions gap: ' + msg);

// All-day + task ignored
info = M.analyze([{ start: W(2026,9,27), end: W(2026,9,27), title: 'Picture day', allDay: true },
  { start: W(2026,9,27,9), end: W(2026,9,27,10), title: 'Todo', kind: 'task' }]);
assert(!info.isLong && info.count === undefined || info.count === 0 || !info.isLong, 'all-day/task alone not long');

// Span exactly 10h
info = M.analyze([ev(8,0,9,0,'A'), ev(17,0,18,0,'B')]);
assert(info.isLong && info.reason === 'span' && info.spanMin === 10*60, 'exactly 10h span qualifies');

// Span 9h59 — not by span; scheduled only 2h — not long
info = M.analyze([ev(8,0,9,0,'A'), ev(16,59,17,59,'B')]);
assert(!info.isLong, 'under 10h span and under 8h scheduled: not long');

// Scheduled ≥ 8h with short span (dense morning) — e.g. 8–4 continuous-ish
info = M.analyze([ev(8,0,12,0,'Block1'), ev(12,0,16,0,'Block2')]); // span 8h, scheduled 8h
assert(info.isLong && (info.reason === 'scheduled' || info.reason === 'span'), '8h block qualifies: ' + info.reason);

// Overlap counted once
info = M.analyze([ev(9,0,12,0,'A'), ev(10,0,13,0,'B'), ev(14,0,18,0,'C')]); // merged 9–13 + 14–18 = 8h
assert(info.scheduledMin === 8*60, 'overlaps merged: ' + info.scheduledMin);
assert(info.isLong, '8h scheduled qualifies');

// Meal gap prefers lunch window
info = M.analyze([ev(8,0,9,0,'A'), ev(9,30,10,0,'B'), ev(12,0,12,45,'Lunchish free before'), ev(13,0,17,0,'C'), ev(20,0,21,0,'D')]);
// gaps: 9-9:30=30, 10-12=120 (lunch-ish mid 11), 12:45-13=15 skip, 17-20=180
// lunch-preferring: 10-12 mid=11 qualifies
assert(info.gap && info.gap.min === 120, 'prefers lunch-hour gap over longer evening: ' + (info.gap && info.gap.min));
assert(/best lunch window/.test(M.message(info)), 'labels lunch: ' + M.message(info));

// Card time
assert(!M.isCardTime(W(2026,9,26,16,59)), 'before 5 PM: no card');
assert(M.isCardTime(W(2026,9,26,17,0)), 'at 5 PM: card time');

// Prefs default on + localStorage
assert((await M.getPrefs()).enabled === true, 'default enabled');
await M.setPrefs({ enabled: false });
M.invalidate();
assert((await M.getPrefs()).enabled === false, 'disabled persists locally');
await M.setPrefs({ enabled: true });

console.log('All longday unit tests passed.');
