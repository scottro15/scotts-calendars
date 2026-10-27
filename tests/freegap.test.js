// Unit tests for SI #4 free-gap coach (freegap.js).
//   node tests/freegap.test.js
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const assert = (c, m) => { if (!c) throw new Error('FAIL: ' + m); console.log('ok -', m); };
const W = (y, m, d, h = 0, mi = 0) => new Date(Date.UTC(y, m, d, h, mi));

const code = readFileSync(new URL('../freegap.js', import.meta.url), 'utf8');
const ldCode = readFileSync(new URL('../longday.js', import.meta.url), 'utf8');
const window = {};
const sandbox = { window, console, localStorage: { _m: {}, getItem(k){return this._m[k]??null;}, setItem(k,v){this._m[k]=String(v);}, removeItem(k){delete this._m[k];} } };
vm.runInNewContext(ldCode, sandbox);
vm.runInNewContext(code, sandbox);
const M = sandbox.window.SandyFreeGap;
const LD = sandbox.window.SandyLongDay;

assert(M.MIN_GAP_MIN === 15 && M.DEFAULT_DURATION === 30 && M.MAX_GAPS === 3, 'constants');

// Duration estimates
assert(M.estimateMinutes({ title: 'Call insurance' }) === 30, 'default 30');
assert(M.estimateMinutes({ title: 'Email Jeff 15 min' }) === 15, 'parse minutes');
assert(M.estimateMinutes({ title: 'Deep work 1h' }) === 60, 'parse hour');
assert(M.estimateMinutes({ title: 'Block', timed: true, start: W(2026,9,26,13), end: W(2026,9,26,14,30) }) === 90, 'timed length');

// Gaps: Scott-like Monday with wake hours; now mid-morning
const day = W(2026, 9, 26);
const busy = [
  { start: W(2026,9,26,6), end: W(2026,9,26,7), title: 'Study' },
  { start: W(2026,9,26,7), end: W(2026,9,26,7,30), title: 'Routine' },
  { start: W(2026,9,26,9,30), end: W(2026,9,26,11), title: 'Recovery' },
  { start: W(2026,9,26,9,30), end: W(2026,9,26,10), title: 'Christian DAKE Workout' }, // ignored by caller
  { start: W(2026,9,26,12), end: W(2026,9,26,15), title: 'Maryville practice' },
  { start: W(2026,9,26,15,30), end: W(2026,9,26,18,30), title: 'Jennings practice' },
  { start: W(2026,9,26,19), end: W(2026,9,26,20), title: 'Jeff' },
  { start: W(2026,9,26,20), end: W(2026,9,26,21), title: 'Study 2' },
].filter(b => !M.isRef({ title: b.title }));
assert(!busy.some(b => /christian/i.test(b.title)), 'ref filtered before findGaps');

const gapsMorning = M.findGaps(day, busy, W(2026,9,26,8,0));
assert(gapsMorning.some(g => g.min >= 60 && g.start.getUTCHours() === 8), 'after 8 AM: remaining of 7:30–9:30 gap: ' + JSON.stringify(gapsMorning.map(g => g.min)));
assert(!gapsMorning.some(g => g.end <= W(2026,9,26,8)), 'no past-only gaps');

// During an event: no gap covering "now" as free
const during = M.findGaps(day, busy, W(2026,9,26,13,0)); // mid Maryville
assert(!during.some(g => g.start < W(2026,9,26,13) && g.end > W(2026,9,26,13)), 'not free while event running');

// Tiny gaps skipped
const tiny = M.findGaps(day, [{ start: W(2026,9,26,10), end: W(2026,9,26,10,50) }, { start: W(2026,9,26,11), end: W(2026,9,26,12) }], null);
assert(!tiny.some(g => g.min < 15), 'gaps under 15 min dropped');

// Protect long-day meal window on tomorrow
const tmrBusy = [
  { start: W(2026,9,27,6), end: W(2026,9,27,7), title: 'Study' },
  { start: W(2026,9,27,7), end: W(2026,9,27,7,30), title: 'Routine' },
  { start: W(2026,9,27,9), end: W(2026,9,27,10,30), title: 'Lift' },
  { start: W(2026,9,27,11), end: W(2026,9,27,19), title: 'Shift' },
  { start: W(2026,9,27,20), end: W(2026,9,27,21), title: 'Study2' },
];
const info = LD.analyze(tmrBusy);
assert(info.isLong && info.gap, 'long day has meal gap');
const protect = [{ start: info.gap.start, end: info.gap.end }];
const tmrGaps = M.findGaps(W(2026,9,27), tmrBusy, null, { protect });
assert(!tmrGaps.some(g => g.start.getUTCHours() === 7 && g.end.getUTCHours() === 9), 'protected lunch/break skipped: ' + JSON.stringify(tmrGaps.map(g => [g.start.getUTCHours(), g.end.getUTCHours(), g.min])));
assert(tmrGaps.some(g => g.min === 30 || g.min === 60), 'other tomorrow gaps remain');

// Assign prefers overdue + P1
const todos = [
  { key: 'a', title: 'Low', priority: null, overdue: false },
  { key: 'b', title: 'Call insurance', priority: 1, overdue: false },
  { key: 'c', title: 'Email Jeff', priority: 2, overdue: true },
  { key: 'd', title: 'Long thing 2h', priority: 1, overdue: false },
];
const ranked = M.rankTodos(todos);
assert(ranked[0].key === 'c' && ranked[1].key === 'b', 'overdue then P1: ' + ranked.map(t => t.key));
const filled = M.assign([{ start: W(2026,9,26,11), end: W(2026,9,26,12), min: 60, which: 'today' }], todos);
assert(filled.length === 1 && filled[0].todos.length === 2, 'two todos fit in 60 min');
assert(filled[0].todos[0].key === 'c' && filled[0].todos[1].key === 'b', 'picks overdue+P1 not 2h task');
assert(!filled[0].todos.some(t => t.key === 'd'), '2h task does not fit');

await M.setPrefs({ enabled: false });
M.invalidate();
assert((await M.getPrefs()).enabled === false, 'prefs off');
await M.setPrefs({ enabled: true });

console.log('All freegap unit tests passed.');
