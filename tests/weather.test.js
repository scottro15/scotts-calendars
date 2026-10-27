// Node unit test for SI #8 weather Heads Up helpers.
//   node tests/weather.test.js
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const assert = (c, m) => { if (!c) throw new Error('FAIL: ' + m); console.log('ok -', m); };
const W = (y, m, d, h = 0, mi = 0) => new Date(Date.UTC(y, m, d, h, mi));

const ls = { _m: {}, getItem(k){return this._m[k]??null;}, setItem(k,v){this._m[k]=String(v);}, removeItem(k){delete this._m[k];} };
const window = { SandyTime: null, __app: null, SandyTravel: null, SandyLeave: null };
const sandbox = { window, console, localStorage: ls, fetch: async () => ({ ok: false }) };
vm.runInNewContext(readFileSync(new URL('../weather.js', import.meta.url), 'utf8'), sandbox);
const M = sandbox.window.SandyWeather;

assert(M.POP_MIN === 50 && M.COLD_F === 32 && M.HOT_F === 90 && M.WIND_MIN === 25 && M.BUFFER_EXTRA === 10, 'thresholds');
assert(M.isRef({ title: 'Christian DAKE Workout' }) && !M.isRef({ title: 'Jeff' }), 'dake ref');

assert(M.evaluate({ ok: true, temp: 70, pop: 20, code: 1, wind: 5 }) === null, 'quiet day null');
let e = M.evaluate({ ok: true, temp: 55, pop: 70, code: 63, wind: 10 });
assert(e && e.reasons.some(r => r.kind === 'rain') && e.leaveBuffer, 'rain 70%');
e = M.evaluate({ ok: true, temp: 28, pop: 10, code: 1, wind: 5 });
assert(e && e.reasons.some(r => r.kind === 'cold') && !e.leaveBuffer, 'cold no buffer');
e = M.evaluate({ ok: true, temp: 92, pop: 0, code: 0, wind: 5 });
assert(e && e.reasons.some(r => r.kind === 'hot'), 'hot');
e = M.evaluate({ ok: true, temp: 60, pop: 10, code: 95, wind: 8 });
assert(e && e.reasons.some(r => r.kind === 'thunder') && e.leaveBuffer, 'thunder');
e = M.evaluate({ ok: true, temp: 50, pop: 10, code: 2, wind: 28 });
assert(e && e.reasons.some(r => r.kind === 'wind'), 'wind');
e = M.evaluate({ ok: true, temp: 40, pop: 55, code: 73, wind: 12 });
assert(e && e.reasons.some(r => r.kind === 'snow'), 'snow pop');
e = M.evaluate({ ok: true, temp: 65, pop: 10, code: 1, wind: 5 }, [{ event: 'Winter Storm Warning', headline: 'Winter Storm Warning' }]);
assert(e && e.reasons.some(r => r.kind === 'alert'), 'nws alert');

const msg = M.message(
  { title: 'Maryville @ SIU - AWAY' },
  W(2026, 10, 2, 17, 0),
  M.evaluate({ ok: true, temp: 58, pop: 70, code: 63, wind: 12 }),
  'Today'
);
assert(/Rain likely \(70%\)/.test(msg) && /5(:00)?\s*PM|17:00/.test(msg) && /Maryville/.test(msg) && /Leave 10 min early/.test(msg), 'rain message: ' + msg);

const cold = M.message(
  { title: 'Covenant Code study' },
  W(2026, 10, 3, 6, 0),
  M.evaluate({ ok: true, temp: 28, pop: 5, code: 1, wind: 3 }),
  'Tomorrow'
);
assert(/28°F/.test(cold) && /coat/i.test(cold) && /Covenant/.test(cold), 'cold message: ' + cold);

const h = M.html({ lines: [{ text: 'Rain likely (70%) around 5 PM, during Game.', suggestBuffer: true, evl: { reasons: [{ kind: 'rain' }] }, ev: {}, o: {} }] });
assert(/tc-weather/.test(h) && /Leave-by|leave-by|10 min/.test(h), 'html buffer: ' + h);

console.log('All weather unit tests passed.');
