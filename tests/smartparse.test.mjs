// Unit tests for smartparse.js (To-Do quick add parsing). node tests/smartparse.test.mjs
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const P = require('../smartparse.js');
const now = new Date(Date.UTC(2026, 9, 24, 16, 7)); // Sat Oct 24 2026 4:07 PM (Chicago wall clock)
const cats = [{ id: 'm', name: 'Meeting' }, { id: 'e', name: 'Errands' }, { id: 'h', name: 'Home' }, { id: 'w', name: 'Work stuff' }];
let n = 0, fail = 0;
function t(text, exp, opts = {}) {
  const r = P.parse(text, { now: opts.now || now, categories: cats, disabled: opts.disabled });
  const got = { date: r.date, time: r.time, cat: r.category && r.category.name, title: r.title, chips: r.tokens.map(x => x.text), pri: r.priority };
  for (const k of Object.keys(exp)) {
    n++;
    if (JSON.stringify(got[k]) !== JSON.stringify(exp[k])) { fail++; console.log(`FAIL "${text}" ${k}: got ${JSON.stringify(got[k])} want ${JSON.stringify(exp[k])}`); }
  }
}
t('meeting next Friday at 3pm', { date: '2026-10-30', time: '15:00', cat: 'Meeting', title: 'Meeting', chips: ['meeting', 'next Friday', 'at 3pm'] });
t('Meeting', { date: null, time: null, cat: 'Meeting', title: 'Meeting' });
t('Call mom today', { date: '2026-10-24', time: null, title: 'Call mom', chips: ['today'] });
t('movie tonight', { date: '2026-10-24', title: 'movie' });
t('tomorrow pick up dry cleaning', { date: '2026-10-25', title: 'pick up dry cleaning' });
t('dentist Thursday', { date: '2026-10-29', title: 'dentist' });
t('dentist on Thursday', { date: '2026-10-29', title: 'dentist', chips: ['on Thursday'] });
t('saturday yard work', { date: '2026-10-31' }); // today is Saturday → next Saturday
t('friday', { date: '2026-10-30', title: 'friday' });
t('next Monday review', { date: '2026-10-26' });
t('pay rent next week', { date: '2026-10-26', title: 'pay rent' });
t('in 3 days review', { date: '2026-10-27', title: 'review' });
t('follow up in two weeks', { date: '2026-11-07', title: 'follow up' });
t('Oct 30 lunch', { date: '2026-10-30', title: 'lunch' });
t('lunch on October 30th', { date: '2026-10-30', title: 'lunch' });
t('10/30 lunch', { date: '2026-10-30' });
t('jan 5 taxes', { date: '2027-01-05' });
t('12/31/2026 party', { date: '2026-12-31' });
t('2/30 nope', { date: null, title: '2/30 nope' });
t('gym at 3', { date: '2026-10-25', time: '15:00', title: 'gym' }); // 3 PM passed today → tomorrow
t('gym at 5', { date: '2026-10-24', time: '17:00' });
t('call at 9', { time: '09:00' });
t('call 3:30 pm tomorrow', { date: '2026-10-25', time: '15:30', title: 'call' });
t('noon walk', { time: '12:00', title: 'walk' });
t('lunch at noon Monday', { date: '2026-10-26', time: '12:00', title: 'lunch' });
t('flight 6:45am Nov 2', { date: '2026-11-02', time: '06:45', title: 'flight' });
t('meet at 14:30 tomorrow', { date: '2026-10-25', time: '14:30' });
t('errands tomorrow 3:30 pm', { cat: 'Errands', date: '2026-10-25', time: '15:30', title: 'Errands' });
t('buy milk errands', { cat: 'Errands', title: 'buy milk' });
t('HOME clean garage', { cat: 'Home', title: 'clean garage' });
t('homework for school', { cat: null, title: 'homework for school', chips: [] }); // whole words only
t('work stuff Monday', { cat: 'Work stuff', date: '2026-10-26' });
t('buy fried chicken', { chips: [], date: null, title: 'buy fried chicken' });
t('sat down with Jon', { chips: [], date: null });
t('call 5 people', { chips: [], time: null });
t('meeting next Friday at 3pm', { cat: null, chips: ['next Friday', 'at 3pm'], title: 'meeting' }, { disabled: new Set(['category:meeting']) });
t('read today', { date: null, chips: [] }, { disabled: new Set(['date:today']) });
t('Thursday', { date: '2026-10-22' }, { now: new Date(Date.UTC(2026, 9, 21, 9)) }); // Wed → Thu next day
t('next Friday', { date: '2026-10-23' }, { now: new Date(Date.UTC(2026, 9, 21, 9)) });
// Todoist-style priority (2026-10-25 fab)
t('call vet p1', { pri: 1, title: 'call vet', chips: ['p1'] });
t('Pay rent tomorrow P3', { pri: 3, date: '2026-10-25', title: 'Pay rent' });
t('p2 errands tonight', { pri: 2, cat: 'Errands', date: '2026-10-24' });
t('fix bug p5 and mp3 player', { pri: null, chips: [], title: 'fix bug p5 and mp3 player' }); // only p1-p4, whole word
t('call vet p1', { pri: null, chips: [] }, { disabled: new Set(['priority:p1']) });
console.log(`${n - fail}/${n} checks passed`);
process.exit(fail ? 1 : 0);
