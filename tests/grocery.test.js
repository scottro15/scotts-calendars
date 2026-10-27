// Node unit test for SI #7 grocery nudge helpers.
//   node tests/grocery.test.js
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const assert = (c, m) => { if (!c) throw new Error('FAIL: ' + m); console.log('ok -', m); };
const W = (y, m, d, h = 0, mi = 0) => new Date(Date.UTC(y, m, d, h, mi));

const ls = { _m: {}, getItem(k){return this._m[k]??null;}, setItem(k,v){this._m[k]=String(v);}, removeItem(k){delete this._m[k];} };
const window = { SandyTime: null, __app: null, SandyFreeGap: null, SandyNav: null };
const sandbox = { window, console, localStorage: ls };
vm.runInNewContext(readFileSync(new URL('../grocery.js', import.meta.url), 'utf8'), sandbox);
const M = sandbox.window.SandyGrocery;

assert(M.WINDOW_DAYS === 7 && M.PUSH_DOW === 6 && M.PUSH_HOUR === 10, 'constants');
assert(M.GROCERY_WORDS.includes('costco') && M.GROCERY_WORDS.includes('food shopping'), 'words list');

assert(M.isGroceryText({ title: 'Costco' }), 'Costco');
assert(M.isGroceryText({ title: 'Aldi run' }), 'Aldi');
assert(M.isGroceryText({ notes: 'pick up groceries' }), 'groceries in notes');
assert(M.isGroceryText({ category: 'Food shopping' }), 'food shopping category');
assert(M.isGroceryText({ title: "Trader Joe's" }), "Trader Joe's");
assert(M.isGroceryText({ title: 'Target run' }), 'Target run');
assert(!M.isGroceryText({ title: 'targeting campaign' }), 'no false target');
assert(!M.isGroceryText({ title: 'Life Time shift' }), 'shift not grocery');

const pad = n => String(n).padStart(2, '0');
const app = {
  startOfDay: d => new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate())),
  addDays: (d, n) => new Date(d.getTime() + n * 86400000),
  ymd: d => `${d.getUTCFullYear()}-${pad(d.getUTCMonth()+1)}-${pad(d.getUTCDate())}`,
  fmtDay: d => d.toISOString().slice(0, 10),
  hm: d => `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`,
  parseLocal: s => { const [Y,M,D,h=0,m=0] = s.replace('T','-').split(/[-:]/).map(Number); return W(Y, M-1, D, h, m); },
  settings: () => ({ visible: {} }),
  Store: { list: async () => [], mode: 'local', profile: async () => ({}) },
  calendars: () => [{ id: 'personal' }],
  firstVisibleCal: () => 'personal',
  occurrences: (ev, from, to) => {
    const s = app.parseLocal(ev.start), e = app.parseLocal(ev.end || ev.start);
    if (s >= from && s < to) return [{ start: s, end: e, key: app.ymd(s) }];
    return [];
  },
  isRecurring: () => false,
  isDone: () => false,
  nowWall: () => W(2026, 9, 26, 12)
};
window.__app = app;

const sun = M.weekStartSunday(W(2026, 9, 29)); // Thu Oct 29 -> Sun Oct 25
assert(app.ymd(sun) === '2026-10-25', 'week start Sun: ' + app.ymd(sun));

assert(M.isSnoozed(W(2026, 9, 26, 12)) === false, 'not snoozed');
const until = M.snoozeThisWeek(W(2026, 9, 26, 12)); // Mon Oct 26 week -> next Sun Nov 1
assert(until === '2026-11-01', 'snooze until next Sun: ' + until);
assert(M.isSnoozed(W(2026, 9, 26, 12)) === true, 'snoozed after');
assert(M.isSnoozed(W(2026, 10, 1, 12)) === false, 'unsnoozed on next Sun');

// findGroceryInWindow
app.Store.list = async () => ([
  { id: '1', kind: 'event', title: 'Costco', calendar: 'personal', category: 'Errand', allDay: false, start: '2026-10-28T10:00', end: '2026-10-28T11:00', done: false },
  { id: '2', kind: 'event', title: 'Life Time shift', calendar: 'lifetime', category: 'Work shift', allDay: false, start: '2026-10-27T11:00', end: '2026-10-27T19:00', done: false },
]);
let hits = await M.findGroceryInWindow(app, W(2026,9,26,12), W(2026,9,26), W(2026,10,2));
assert(hits.length === 1 && /Costco/.test(hits[0].ev.title), 'find costco in window');

app.Store.list = async () => ([
  { id: '2', kind: 'event', title: 'Life Time shift', calendar: 'lifetime', category: 'Work shift', allDay: false, start: '2026-10-27T11:00', end: '2026-10-27T19:00', done: false },
]);
hits = await M.findGroceryInWindow(app, W(2026,9,26,12), W(2026,9,26), W(2026,10,2));
assert(hits.length === 0, 'no grocery → empty');

const d = await M.data(app, W(2026,9,26,12));
// still snoozed from earlier
assert(d === null, 'data null while snoozed');
M._test.writeSnoozeYmd('');
const d2 = await M.data(app, W(2026,9,26,12));
assert(d2 && d2.windowLabel, 'data shows when no grocery: ' + (d2 && d2.windowLabel));
const h = M.html(d2);
assert(/Grocery run/i.test(h) && /data-gr="add"/.test(h) && /data-gr="snooze"/.test(h), 'html actions');

console.log('All grocery unit tests passed.');
