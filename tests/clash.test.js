// Node unit test for SI #5 Clash check pure helpers.
//   node tests/clash.test.js
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const assert = (c, m) => { if (!c) throw new Error('FAIL: ' + m); console.log('ok -', m); };
const W = (y, m, d, h = 0, mi = 0) => new Date(Date.UTC(y, m, d, h, mi));
const wrap = (ev, start, end) => ({ ev, o: { start, end, key: start.toISOString().slice(0, 10) } });

const code = readFileSync(new URL('../clash.js', import.meta.url), 'utf8');
const sandbox = {
  window: { SandyTime: null },
  console,
  localStorage: { _m: {}, getItem(k){return this._m[k]??null;}, setItem(k,v){this._m[k]=String(v);}, removeItem(k){delete this._m[k];} }
};
vm.runInNewContext(code, sandbox);
const M = sandbox.window.SandyClash;

assert(M.LOOKAHEAD_DAYS === 7 && M.MIN_OVERLAP_MIN === 15, 'constants');

const shift = { title: 'Life Time shift', calendar: 'lifetime', category: 'Work shift', kind: 'event', allDay: false };
const jPrac = { title: 'Jennings High School basketball practice', calendar: 'mam', category: 'Team practice – Jennings High School', kind: 'event', allDay: false };
const jBoot = { title: 'Jennings High School Boot Camp 🏀', calendar: 'mam', category: 'Team practice – Jennings High School', kind: 'event', allDay: false };
const mvGame = { title: 'Maryville University @ SIU - AWAY', calendar: 'mam', category: 'Game – Maryville University', kind: 'event', allDay: false };
const jeff = { title: 'Jeff - Mental Healing', calendar: 'msc', category: 'Client session', kind: 'event', allDay: false };
const dake = { title: 'Christian DAKE Workout 🏀', calendar: 'mam', category: 'Client workout', kind: 'event', allDay: false };
const study = { title: 'Study: The Teachings', calendar: 'msc', category: 'Study time', kind: 'event', allDay: false };
const office = { title: 'Office study: The Teachings (30 min, during shift)', calendar: 'msc', category: 'Study time', kind: 'event', allDay: false };
const bill = { title: 'Weekly meeting with Bill & Sherita', calendar: 'lifetime', category: 'Weekly meeting – Bill & Sherita', kind: 'event', allDay: false };
const kid = { title: 'Kid dentist', calendar: 'personal', category: 'Personal', kind: 'event', allDay: false };
const tourney = { title: 'Fall Classic Tournament', calendar: 'mam', category: 'Tournament', kind: 'event', allDay: true };

assert(M.isShift(shift) && !M.isShift(jeff), 'isShift');
assert(M.isPracticeOrGame(jPrac) && M.isPracticeOrGame(mvGame) && !M.isPracticeOrGame(jeff), 'isPracticeOrGame');
assert(M.isClientDuty(jeff) && !M.isClientDuty(dake), 'isClientDuty skips Dake');
assert(M.isRef(dake) && !M.isRef(jeff), 'isRef');
assert(M.isSoftPersonal(study) && !M.isSoftPersonal(kid), 'soft study');
assert(M.isNestedInShift(office) && M.isNestedInShift(bill), 'nested LT');

const day = W(2026, 10, 3); // Nov 3
const aShift = wrap(shift, W(2026, 10, 3, 11, 0), W(2026, 10, 3, 19, 0));
const aBoot = wrap(jBoot, W(2026, 10, 3, 16, 0), W(2026, 10, 3, 18, 0));
const aKid = wrap(kid, W(2026, 10, 3, 16, 30), W(2026, 10, 3, 17, 30));
const aOffice = wrap(office, W(2026, 10, 3, 20, 0), W(2026, 10, 3, 20, 30));
const aStudy = wrap(study, W(2026, 10, 3, 20, 0), W(2026, 10, 3, 21, 0));
const aDake = wrap(dake, W(2026, 10, 3, 12, 0), W(2026, 10, 3, 12, 30));
const aJeff = wrap(jeff, W(2026, 10, 2, 19, 0), W(2026, 10, 2, 20, 0));
const aGame = wrap(mvGame, W(2026, 10, 2, 19, 0), W(2026, 10, 2, 21, 0));
const aPrac = wrap(jPrac, W(2026, 10, 2, 15, 30), W(2026, 10, 2, 18, 30));
const aBoot2 = wrap(jBoot, W(2026, 10, 2, 16, 0), W(2026, 10, 2, 18, 0));

assert(M.isClash(aShift, aBoot), 'shift ∩ Jennings boot camp');
assert(M.isClash(aShift, aKid), 'shift ∩ kid dentist');
assert(!M.isClash(aShift, aOffice), 'shift ∩ office study skipped');
assert(!M.isClash(aShift, aDake), 'Dake never clashes');
assert(!M.isClash(aGame, aStudy), 'game ∩ soft study skipped');
assert(M.isClash(aGame, aJeff), 'Maryville game ∩ Jeff session');
assert(!M.isClash(aPrac, aBoot2), 'same-team practice ∩ boot camp skipped');

const found = M.findClashes([aShift, aBoot, aKid, aOffice, aDake, aStudy, aJeff, aGame, aPrac, aBoot2]);
assert(found.some(c => /Life Time/.test(c.duty.ev.title) && /Boot Camp/.test(c.other.ev.title)), 'finds shift vs boot');
assert(found.some(c => /Life Time/.test(c.duty.ev.title) && /dentist/.test(c.other.ev.title)), 'finds shift vs kid');
assert(found.some(c => /Maryville/.test(c.duty.ev.title) && /Jeff/.test(c.other.ev.title)), 'finds game vs Jeff');
assert(!found.some(c => /DAKE|Dake/.test(c.duty.ev.title + c.other.ev.title)), 'no Dake in results');
assert(!found.some(c => /Boot Camp/.test(c.duty.ev.title) && /practice/.test(c.other.ev.title) && M.teamOf(c.duty.ev) === M.teamOf(c.other.ev)), 'no same-team pair');
assert(!found.some(c => /Study: The Teachings/.test(c.other.ev.title) && !M.isAnchor(c.other.ev)), 'no soft study as other');

assert(/Who's covering\?/.test(M.coverTitle(aShift)), 'cover title');
assert(/Event id:/.test(M.coverNotes(aShift, aKid)), 'cover notes link');

console.log('All clash unit tests passed.');
