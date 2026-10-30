// Unit tests for titleac.js ranking (node tests/titleac.test.mjs)
import { createRequire } from 'module'; const require = createRequire(import.meta.url);
const T = require('../titleac.js');
let fails = 0; const ok = (c, m) => { if (!c) { fails++; console.log('FAIL -', m); } else console.log('ok -', m); };
const now = Date.parse('2026-10-29T12:00:00Z'); const day = n => new Date(now + n * 864e5).toISOString();
const ev = (title, n, extra = {}) => ({ title, calendar: 'mam', start: day(n).slice(0, 10) + 'T15:30', end: day(n).slice(0, 10) + 'T17:00', updatedAt: day(n), ...extra });
const idx = T.buildIndex([
  ev('Film study – Maryville', -30), ev('film study – maryville', -2, { location: 'Gym' }), ev('Film study – Maryville', -60),
  ev('Film night', -1), ev('Team film', -1), ev('Life Time shift', -1), ev('Meeting', -300), ev('Film demo', -1, { example: true }),
  ev('Fitness', 400), ev('', -1), ev('Café run', -1),
], now);
ok(idx.filter(i => i.k === 'film study – maryville').length === 1 && idx.find(i => i.k === 'film study – maryville').n === 3, 'one row per title, case-insensitive, counted');
ok(idx.find(i => i.k === 'film study – maryville').location === 'Gym', 'newest instance is the template');
ok(!idx.some(i => i.k === 'film demo') && !idx.some(i => i.k === ''), 'example + blank titles skipped');
const s = q => T.suggest(idx, q, now).map(i => i.title);
ok(s('f').length === 0, 'needs 2+ characters');
ok(s('fil')[0] === 'film study – maryville' && s('fil').indexOf('Film night') < s('fil').indexOf('Team film'), 'frequency first, prefix before word match');
ok(!s('me').includes('Life Time shift') && s('me').includes('Meeting'), 'no mid-word match for short queries');
ok(s('cafe')[0] === 'Café run', 'accent-insensitive');
ok(s('FILM S').length === 1, 'case-insensitive narrowing');
const tpl = idx.find(i => i.k === 'team film'); ok(tpl.time === '15:30' && tpl.dur === 90, 'time of day + duration captured');
ok(T.suggest(idx, 'fi', now).length <= 6, 'at most 6 suggestions');
console.log(fails ? `${fails} FAILED` : 'TITLEAC UNIT TESTS PASSED'); process.exit(fails ? 1 : 0);
