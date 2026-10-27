// Unit tests: military / 24-hour times in the To-Do quick add (Scott 2026-10-26: "instead of 2:30pm I can put 1430").
//   node tests/smartparse_military.test.mjs
// Rules (smartparse.js TIME_RULES):
//  - "HHMM" 0000-2359 as a standalone token is a time ("1430" → 14:30, "0000" → 00:00); "at"/"@" before or
//    "h"/"hr"/"hrs"/"hours" after always makes it a time.
//  - Without that cue it is NOT a time when: preceded by #, $, room/rm/suite/apt/unit/no./ext/flight/route/exit/page/
//    order/invoice/ticket/zip/pin/id/in/of/since/year/class/... ; part of a number (314-555-1430, 1,430, 1430.50,
//    2 x 1430); followed by a unit (calories, lbs, reps, miles, dollars, people, %, ...), a street ("1430 Main St",
//    "2330 S Grand Blvd") or a season/range year ("2026-27"); or it looks like a near year (last year … +5, e.g. 2027).
//  - "HH:MM": zero-padded, 13-23 or 0 → literal 24-hour ("09:00", "14:30", "0:30"); 1:00-12:59 → 12-hour guess
//    (7-11 AM, 12 noon, 1-6 PM), or literal when the user's time format is 24-hour (h24) or "hrs" follows.
//  - "Mon D YYYY": a year after a comma (1900-2099) or a near year without one; otherwise the 4 digits are a time.
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const P = require('../smartparse.js');
const now = new Date(Date.UTC(2026, 9, 26, 9, 0)); // Mon Oct 26 2026 9:00 AM (Chicago wall clock)
let n = 0, fail = 0;
function t(text, exp, opts = {}) {
  const r = P.parse(text, { now, categories: [], h24: opts.h24 });
  const got = { date: r.date, time: r.time, title: r.title, chips: r.tokens.map(x => x.text) };
  for (const k of Object.keys(exp)) {
    n++;
    if (JSON.stringify(got[k]) !== JSON.stringify(exp[k])) { fail++; console.log(`FAIL "${text}"${opts.h24 ? ' (24h)' : ''} ${k}: got ${JSON.stringify(got[k])} want ${JSON.stringify(exp[k])}`); }
  }
}
// --- military times that must work
t('call mom 1430', { time: '14:30', date: '2026-10-26', title: 'call mom', chips: ['1430'] });
t('1430 call mom', { time: '14:30', title: 'call mom' });
t('dentist 0900', { time: '09:00', date: '2026-10-27', title: 'dentist' }); // 9 AM already passed today → tomorrow
t('lift 0730 tomorrow', { time: '07:30', date: '2026-10-27', title: 'lift' });
t('sleep 2330', { time: '23:30', date: '2026-10-26', title: 'sleep' });
t('reset 0000', { time: '00:00', date: '2026-10-27', title: 'reset' });
t('lights out 2359', { time: '23:59', title: 'lights out' });
t('standup 1200', { time: '12:00', title: 'standup' });
t('call at 1430', { time: '14:30', title: 'call', chips: ['at 1430'] });
t('call @1430', { time: '14:30', title: 'call' });
t('drill 1430 hrs', { time: '14:30', title: 'drill', chips: ['1430 hrs'] });
t('run 1430h', { time: '14:30', title: 'run' });
t('Fri 1430 haircut', { time: '14:30', date: '2026-10-30', title: 'haircut' });
t('haircut next Friday 1430', { time: '14:30', date: '2026-10-30', title: 'haircut' });
t('meeting 1430 with Dr Smith', { time: '14:30', title: 'meeting with Dr Smith' });
t('Nov 3 1430 vote', { time: '14:30', date: '2026-11-03', title: 'vote' });
t('Nov 3 2000 party', { time: '20:00', date: '2026-11-03', title: 'party' });
t('at 2027 call', { time: '20:27', title: 'call' }); // year-looking but cued with "at"
t('2030 hrs call', { time: '20:30', title: 'call' });
// --- colon 24-hour
t('lift 14:30', { time: '14:30', title: 'lift', chips: ['14:30'] });
t('meet 09:00', { time: '09:00', title: 'meet' });
t('call at 05:15', { time: '05:15' });
t('feed 0:30', { time: '00:30' });
t('pickup 3:30', { time: '15:30' }); // 12-hour guess
t('standup 10:00', { time: '10:00' });
t('run 5:15', { time: '17:15' });
t('run 5:15', { time: '05:15' }, { h24: true });
t('call 2:30pm', { time: '14:30' }); // unchanged
t('meeting at 3pm', { time: '15:00' });
// --- NOT times
t('plan 2027 budget', { time: null, title: 'plan 2027 budget' });
t('call mom 2026', { time: null });
t('class of 2027 reunion', { time: null });
t('room 1430 meeting', { time: null, title: 'room 1430 meeting' });
t('rm 1430', { time: null });
t('suite 2100 delivery', { time: null });
t('apt 1201 keys', { time: null });
t('#1430 order', { time: null });
t('order 1430 pickup', { time: null });
t('flight 1430 check in', { time: null });
t('exit 1430', { time: null });
t('pay $1430 rent', { time: null });
t('1430.50 bill', { time: null });
t('1,430 steps', { time: null });
t('call 314-555-1430', { time: null });
t('send 2 x 1430', { time: null });
t('1430 Main St pickup', { time: null, title: '1430 Main St pickup' });
t('drop off 2330 S Grand Blvd', { time: null });
t('eat 2000 calories', { time: null });
t('bench 1200 lbs', { time: null });
t('pay 1430 dollars', { time: null });
t('1500 people rsvp', { time: null });
t('100% done 2200 pts', { time: null });
t('2026-27 season', { time: null });
t('room 14:30', { time: null });
t('2400 bad', { time: null });
t('1460 bad', { time: null });
t('14300 bad', { time: null });
t('Jan 5 2027 trip', { date: '2027-01-05', time: null, title: 'trip' });
t('Nov 3, 2000 party', { date: '2000-11-03', time: null });
t('in 1430 Columbus', { time: null });
console.log(fail ? `${fail}/${n} checks FAILED` : `${n}/${n} checks passed`);
process.exit(fail ? 1 : 0);
