// Node unit test for SI #6 weekly review helpers.
//   node tests/weekly.test.js
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const assert = (c, m) => { if (!c) throw new Error('FAIL: ' + m); console.log('ok -', m); };
const W = (y, m, d, h = 0, mi = 0) => new Date(Date.UTC(y, m, d, h, mi));

// Load longday + clash + weekly together
const ls = { _m: {}, getItem(k){return this._m[k]??null;}, setItem(k,v){this._m[k]=String(v);}, removeItem(k){delete this._m[k];} };
const window = { SandyTime: null, __app: null };
const sandbox = { window, console, localStorage: ls };
for (const f of ['longday.js', 'clash.js', 'weekly.js']) {
  vm.runInNewContext(readFileSync(new URL('../' + f, import.meta.url), 'utf8'), sandbox);
}
const M = sandbox.window.SandyWeekly;
const LD = sandbox.window.SandyLongDay;
const CL = sandbox.window.SandyClash;

assert(M.CARD_HOUR === 16 && M.PUSH_HOUR === 18, 'constants');

// Stub minimal app for weekStartSunday
const pad = n => String(n).padStart(2, '0');
const app = {
  startOfDay: d => new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate())),
  addDays: (d, n) => new Date(d.getTime() + n * 86400000),
  ymd: d => `${d.getUTCFullYear()}-${pad(d.getUTCMonth()+1)}-${pad(d.getUTCDate())}`,
  fmtDay: d => d.toISOString().slice(0, 10),
  hm: d => `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`,
  parseLocal: s => { const [Y,M,D,h=0,m=0] = s.replace('T','-').split(/[-:]/).map(Number); return W(Y, M-1, D, h, m); },
};
window.__app = app;

const sun = W(2026, 10, 1); // Nov 1 2026 Sunday
assert(M.weekStartSunday(W(2026, 10, 1, 17)).getUTCDay() === 0, 'week starts Sunday');
assert(app.ymd(M.weekStartSunday(W(2026, 10, 4))) === '2026-11-01', 'Wed maps to Nov 1 Sunday');
assert(app.ymd(M.weekEndExclusive(sun)) === '2026-11-08', 'week ends next Sunday');

assert(M.isVisible(W(2026, 10, 1, 15, 59)) === false, 'Sunday before 4 PM hidden');
assert(M.isVisible(W(2026, 10, 1, 16, 0)) === true, 'Sunday 4 PM visible');
assert(M.isVisible(W(2026, 10, 4, 12)) === true, 'Wed visible');
assert(M.isVisible(W(2026, 10, 8, 10)) === false, 'Sunday Nov 8 morning hidden until 4 PM');

// Build synthetic week Nov 1-7
const wrap = (ev, s, e) => ({ ev, o: { start: s, end: e, key: app.ymd(s) } });
const shift = { title: 'Life Time shift', calendar: 'lifetime', category: 'Work shift', kind: 'event', allDay: false };
const game = { title: 'Maryville @ SIU - AWAY', calendar: 'mam', category: 'Game – Maryville University', kind: 'event', allDay: false };
const jeff = { title: 'Jeff - Mental Healing', calendar: 'msc', category: 'Client session', kind: 'event', allDay: false };
const dake = { title: 'Christian DAKE Workout', calendar: 'mam', category: 'Client workout', kind: 'event', allDay: false };
const study = { title: 'Study: Code', calendar: 'msc', category: 'Study time', kind: 'event', allDay: false };

const timed = [
  wrap(study, W(2026,10,2,6,0), W(2026,10,2,7,0)),
  wrap(shift, W(2026,10,3,11,0), W(2026,10,3,19,0)),
  wrap({ title: 'Jennings Boot Camp', calendar: 'mam', category: 'Team practice – Jennings High School', kind: 'event', allDay: false },
    W(2026,10,3,16,0), W(2026,10,3,18,0)),
  wrap(game, W(2026,10,2,19,0), W(2026,10,2,21,0)),
  wrap(jeff, W(2026,10,2,19,0), W(2026,10,2,20,0)),
  wrap(dake, W(2026,10,2,12,0), W(2026,10,2,12,30)),
  wrap(shift, W(2026,10,7,17,0), W(2026,10,8,0,0)), // late Sat
];

assert(M.isGame(game) && M.gameHa(game) === 'A', 'game AWAY');
assert(M.isRef(dake), 'dake ref');

const days = M.dayBuckets(app, timed.filter(x => !M.isRef(x.ev)), sun, M.weekEndExclusive(sun));
assert(days.length === 7, '7 day buckets');
const byCal = M.hoursByCalendar(timed.filter(x => !M.isRef(x.ev)));
assert(byCal.lifetime > 0 && byCal.mam > 0, 'hours by cal: ' + JSON.stringify(byCal));

const { early, late } = M.earlyAndLate(timed.filter(x => !M.isRef(x.ev)));
assert(early.some(x => /Study/.test(x.ev.title)), 'early study');
assert(late.some(x => /Life Time/.test(x.ev.title)), 'late shift');

const longs = M.longDaysForWeek(days);
assert(longs.some(L => L.day.ymd === '2026-11-03'), 'Tue long day from shift: ' + longs.map(L => L.day.ymd));

const clashes = M.clashesForWeek(timed.filter(x => !M.isRef(x.ev)));
assert(clashes.some(c => /Life Time/.test(c.duty.ev.title) && /Boot Camp|Jennings/.test(c.other.ev.title)), 'clash shift∩boot');
assert(clashes.some(c => /Maryville|SIU/.test(c.duty.ev.title + c.other.ev.title) && /Jeff/.test(c.duty.ev.title + c.other.ev.title)), 'clash game∩jeff');
assert(!clashes.some(c => /DAKE|Dake/.test(c.duty.ev.title + c.other.ev.title)), 'no dake clash');

const free = M.freeEvenings(days);
assert(Array.isArray(free), 'free evenings array');

console.log('All weekly unit tests passed.');
