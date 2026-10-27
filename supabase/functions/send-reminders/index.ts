// SANDY reminders: Supabase Edge Function "send-reminders", called every minute by pg_cron (see
// supabase/migration-2026-10-24-push.sql). Finds reminders that are due (per user time zone, per occurrence
// of repeating events), records each one in reminder_sends (so nothing is sent twice) and delivers a
// Web Push (VAPID, RFC 8291 aes128gcm) to every device the owner enabled.
// - Caller check: header x-cron-secret must match the secret the migration generated inside Supabase Vault
//   (checked by rpc sandy_check_cron_secret with the service role); deployed with --no-verify-jwt.
// - Secrets (function secrets only): VAPID_PRIVATE_KEY, VAPID_PUBLIC_KEY, VAPID_SUBJECT.
//   SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY are injected by Supabase.
// Also sends Sandy Intelligence leave-by alerts (leave_plans; see "leave-by alerts" below).
// Dependency-free (WebCrypto + fetch) so tests import it under Node.

export const WINDOW_MIN = 15;          // catch-up window: a reminder up to 15 min late is still sent
export const MAX_MINUTES = 267840;     // 6 months (186 days)
export const ALLDAY_HOUR = 9;          // all-day items/to-dos count back from 9:00 AM local

// ------------------------------------------------------------------ base64url / bytes
const enc = new TextEncoder();
export const b64u = (buf) => { let s = ''; const b = new Uint8Array(buf); for (let i = 0; i < b.length; i++) s += String.fromCharCode(b[i]); return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); };
export const unb64u = (s) => { s = String(s).replace(/-/g, '+').replace(/_/g, '/'); while (s.length % 4) s += '='; const bin = atob(s); const out = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i); return out; };
const concat = (...a) => { const out = new Uint8Array(a.reduce((n, x) => n + x.length, 0)); let o = 0; for (const x of a) { out.set(x, o); o += x.length; } return out; };
const subtle = () => globalThis.crypto.subtle;
async function hmac(key, data) { const k = await subtle().importKey('raw', key, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']); return new Uint8Array(await subtle().sign('HMAC', k, data)); }

// ------------------------------------------------------------------ VAPID (RFC 8292)
export async function vapidAuth(endpoint, { publicKey, privateKey, subject }, nowSec = Math.floor(Date.now() / 1000)) {
  const pub = unb64u(publicKey);
  const jwk = { kty: 'EC', crv: 'P-256', x: b64u(pub.slice(1, 33)), y: b64u(pub.slice(33, 65)), d: privateKey, ext: true };
  const key = await subtle().importKey('jwk', jwk, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);
  const h = b64u(enc.encode(JSON.stringify({ typ: 'JWT', alg: 'ES256' })));
  const p = b64u(enc.encode(JSON.stringify({ aud: new URL(endpoint).origin, exp: nowSec + 12 * 3600, sub: subject })));
  const sig = new Uint8Array(await subtle().sign({ name: 'ECDSA', hash: 'SHA-256' }, key, enc.encode(`${h}.${p}`)));
  return `vapid t=${h}.${p}.${b64u(sig)}, k=${publicKey}`;
}

// ------------------------------------------------------------------ payload encryption (RFC 8291, aes128gcm)
export async function encryptPayload(payload, p256dh, authSecret, salt = crypto.getRandomValues(new Uint8Array(16))) {
  const uaPub = unb64u(p256dh), auth = unb64u(authSecret);
  const eph = await subtle().generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
  const asPub = new Uint8Array(await subtle().exportKey('raw', eph.publicKey));
  const uaKey = await subtle().importKey('raw', uaPub, { name: 'ECDH', namedCurve: 'P-256' }, false, []);
  const shared = new Uint8Array(await subtle().deriveBits({ name: 'ECDH', public: uaKey }, eph.privateKey, 256));
  const prkKey = await hmac(auth, shared);
  const ikm = await hmac(prkKey, concat(enc.encode('WebPush: info\0'), uaPub, asPub, new Uint8Array([1])));
  const prk = await hmac(salt, ikm);
  const cek = (await hmac(prk, concat(enc.encode('Content-Encoding: aes128gcm\0'), new Uint8Array([1])))).slice(0, 16);
  const nonce = (await hmac(prk, concat(enc.encode('Content-Encoding: nonce\0'), new Uint8Array([1])))).slice(0, 12);
  const k = await subtle().importKey('raw', cek, { name: 'AES-GCM' }, false, ['encrypt']);
  const ct = new Uint8Array(await subtle().encrypt({ name: 'AES-GCM', iv: nonce }, k, concat(enc.encode(payload), new Uint8Array([2]))));
  const rs = new Uint8Array([0, 0, 16, 0]); // 4096
  return concat(salt, rs, new Uint8Array([asPub.length]), asPub, ct);
}

export async function sendPush(sub, payloadObj, vapid, f = fetch) {
  const body = await encryptPayload(JSON.stringify(payloadObj), sub.p256dh, sub.auth);
  return f(sub.endpoint, { method: 'POST', body, headers: {
    authorization: await vapidAuth(sub.endpoint, vapid), 'content-encoding': 'aes128gcm',
    'content-type': 'application/octet-stream', ttl: '3600', urgency: 'high' } });
}

// ------------------------------------------------------------------ time zones (wall clock <-> UTC)
// Wall-clock values are Dates whose UTC fields are the local time (same model as the app).
const W = (y, m, d, h = 0, mi = 0) => new Date(Date.UTC(y, m, d, h, mi));
const fmts = new Map();
function partsIn(tz, t) {
  if (!fmts.has(tz)) fmts.set(tz, new Intl.DateTimeFormat('en-US', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' }));
  const p = Object.fromEntries(fmts.get(tz).formatToParts(new Date(t)).map(x => [x.type, x.value]));
  return Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour % 24, +p.minute, +p.second);
}
export const utcToWall = (t, tz) => new Date(partsIn(tz, t));
export function wallToUtc(wall, tz) {
  const g = wall.getTime(); let t = g - (partsIn(tz, g) - g); t = g - (partsIn(tz, t) - t); return t;
}

// ------------------------------------------------------------------ recurrence (port of app.js occurrences)
const parseLocal = (s) => { const [date, time = '00:00'] = s.split('T'); const [y, m, d] = date.split('-').map(Number); const [h, mi] = time.split(':').map(Number); return W(y, m - 1, d, h, mi); };
const pad = (n) => String(n).padStart(2, '0');
export const ymd = (d) => `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
const addDays = (d, n) => W(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + n, d.getUTCHours(), d.getUTCMinutes());
const startOfDay = (d) => W(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
const dayDiff = (a, b) => Math.round((startOfDay(b) - startOfDay(a)) / 86400000);
/** Occurrence START wall times of a DB event row in [rs, re). */
export function occurrenceStarts(row, rs, re) {
  const base = parseLocal(String(row.start_at).replace(' ', 'T').slice(0, 16));
  const inR = (s) => s >= rs && s < re;
  if (!row.recur_freq || row.recur_freq === 'none') return inR(base) ? [base] : [];
  const interval = Math.max(1, +row.recur_interval || 1);
  const until = row.recur_until ? addDays(parseLocal(row.recur_until), 1) : null;
  const ex = new Set(row.exdates || []); const limit = until && until < re ? until : re;
  const out = []; const push = (s) => { if (s < base || s >= limit || ex.has(ymd(s))) return; if (inR(s)) out.push(s); };
  const h = base.getUTCHours(), mi = base.getUTCMinutes();
  if (row.recur_freq === 'daily') {
    let n = Math.max(0, Math.floor((dayDiff(base, rs) - 1) / interval));
    for (let i = 0; i < 5000; i++, n++) { const s = addDays(base, n * interval); if (s >= limit) break; push(s); }
  } else if (row.recur_freq === 'weekly') {
    const days = (row.recur_by_weekday && row.recur_by_weekday.length ? row.recur_by_weekday : [base.getUTCDay()]).map(Number).sort();
    const week0 = addDays(startOfDay(base), -base.getUTCDay());
    let w = Math.max(0, Math.floor((dayDiff(week0, rs) - 1) / (7 * interval)));
    for (let i = 0; i < 2000; i++, w++) { const ws = addDays(week0, w * 7 * interval); if (ws >= limit) break;
      for (const dw of days) push(W(ws.getUTCFullYear(), ws.getUTCMonth(), ws.getUTCDate() + dw, h, mi)); }
  } else if (row.recur_freq === 'monthly') {
    for (let n = 0; n < 2400; n += interval) { const s = W(base.getUTCFullYear(), base.getUTCMonth() + n, base.getUTCDate(), h, mi);
      if (s.getUTCDate() !== base.getUTCDate()) continue; if (s >= limit) break; push(s); }
  } else if (row.recur_freq === 'yearly') {
    for (let n = 0; n < 200; n += interval) { const s = W(base.getUTCFullYear() + n, base.getUTCMonth(), base.getUTCDate(), h, mi);
      if (s.getUTCMonth() !== base.getUTCMonth()) continue; if (s >= limit) break; push(s); }
  }
  return out;
}

// ------------------------------------------------------------------ what's due
const t12 = (d) => { const h = d.getUTCHours(), m = d.getUTCMinutes(); return `${h % 12 || 12}:${pad(m)} ${h < 12 ? 'AM' : 'PM'}`; };
export function leadText(min) {
  if (min === 0) return 'Now';
  const u = [[43200, 'month'], [10080, 'week'], [1440, 'day'], [60, 'hour'], [1, 'minute']].find(([n]) => min % n === 0 && min >= n) || [1, 'minute'];
  const n = min / u[0]; return `In ${n} ${u[1]}${n === 1 ? '' : 's'}`;
}
/** rows: events with reminders; tzOf(owner) -> IANA zone; returns [{row, occ, minutes, fireAt, payload}] due in (now-WINDOW, now]. */
export function dueReminders(rows, tzOf, now = Date.now()) {
  const out = [];
  for (const row of rows) {
    const mins = [...new Set((row.reminders || []).map(Number).filter(m => Number.isFinite(m) && m >= 0 && m <= MAX_MINUTES))].slice(0, 6);
    if (!mins.length) continue;
    const tz = tzOf(row.owner_id) || 'America/Chicago';
    for (const m of mins) {
      // occurrences whose (anchor) start falls in (now - window + m, now + m]
      const lo = now - WINDOW_MIN * 60000 + m * 60000, hi = now + m * 60000;
      const rs = addDays(startOfDay(utcToWall(lo, tz)), -1), re = addDays(startOfDay(utcToWall(hi, tz)), 2);
      for (const s of occurrenceStarts(row, rs, re)) {
        const anchor = row.all_day ? W(s.getUTCFullYear(), s.getUTCMonth(), s.getUTCDate(), ALLDAY_HOUR) : s;
        const fireAt = wallToUtc(anchor, tz) - m * 60000;
        if (!(fireAt > now - WINDOW_MIN * 60000 && fireAt <= now)) continue;
        const key = ymd(s);
        if (row.is_task && (row.recur_freq === 'none' ? row.done : (row.completed_dates || []).includes(key))) continue;
        const when = row.all_day ? (row.is_task ? 'due ' : '') + s.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' })
          : `${s.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' })} · ${t12(s)}`;
        out.push({ row, occ: key, minutes: m, fireAt, payload: {
          title: `${row.is_task ? '☑️ ' : ''}${row.title}`.slice(0, 120),
          body: `${leadText(m)} · ${when}${row.location ? ` · ${row.location}` : ''}`.slice(0, 200),
          tag: `${row.id}:${key}:${m}`, url: `./?date=${key}`, ts: fireAt } });
      }
    }
  }
  return out;
}


// ------------------------------------------------------------------ leave-by alerts (Sandy Intelligence feature A)
// The app works out "leave by" (drive from home / a back-to-back event / the user's current location, via free
// OpenStreetMap routing) and saves one leave_plans row per event occurrence -- a time and a label, never GPS
// coordinates. Each minute we push, per plan:
//   -60  "Check your drive to X"  1 hour before the from-home leave time (opens Today, which re-checks from
//        where the phone is; iPhone web apps can't read location in the background)
//   -10  "Leave in 10 min"        (if the user keeps the early heads-up on)
//    -1  "Time to leave"          at the leave time
// Codes are stored in reminder_sends.minutes (negative = leave alerts) so each is sent once.
// Before sending we check the event still exists, still starts at the planned time and still has that location.
// If the app hasn't been opened, we plan events starting in the next 3 hours ourselves (from home, same free
// services, at most LEAVE_MAX_LOOKUPS lookups per run).
export const LEAVE = { CHECK: -60, EARLY: -10, NOW: -1 };
export const LEAVE_WINDOW_MIN = 10;     // a leave alert up to 10 min late is still useful; later is not
export const LEAVE_BUFFER_MIN = 10;     // parking / walking in (same as the app)
export const LEAVE_PLAN_AHEAD_MIN = 180;
export const LEAVE_MAX_LOOKUPS = 4;
const fmtDrive = (m) => m < 60 ? `${m} min` : `${Math.floor(m / 60)} hr${m % 60 ? ` ${m % 60} min` : ''}`;
const wallKey = (v) => String(v || '').replace(' ', 'T').slice(0, 16);
export const leaveAtUtc = (startUtc, mins) => Math.floor((startUtc - (mins + LEAVE_BUFFER_MIN) * 60000) / 300000) * 300000;
/** Does this event row still have an occurrence starting at the plan's wall time, at the plan's location? */
export function planStillValid(plan, row) {
  if (!row || row.all_day || row.is_task || row.owner_id !== plan.owner_id) return false;
  if (String(row.location || '').trim() !== String(plan.location || '').trim()) return false;
  const s = parseLocal(wallKey(plan.event_start));
  if (ymd(s) !== String(plan.occurrence_date).slice(0, 10)) return false;
  return occurrenceStarts(row, startOfDay(s), addDays(startOfDay(s), 1)).some(o => o.getTime() === s.getTime());
}
/** plans: leave_plans rows; rows: Map event id -> event row; prefOf(owner) -> {early, tz}. Returns due alerts. */
export function dueLeaveAlerts(plans, rows, prefOf, now = Date.now()) {
  const out = [];
  for (const p of plans) {
    if (p.status !== 'ok') continue;
    const pref = prefOf(p.owner_id); if (!pref) continue;      // alerts off (or no profile)
    const row = rows.get(p.event_id);
    if (!planStillValid(p, row)) continue;
    const tz = pref.tz || 'America/Chicago';
    const s = parseLocal(wallKey(p.event_start)); const startUtc = wallToUtc(s, tz);
    if (now >= startUtc) continue;
    const leave = Date.parse(p.leave_at), homeLeave = Date.parse(p.home_leave_at || p.leave_at);
    const kinds = [];
    // [code, when, how late it may still go out (min)] -- a "10 min" heads-up more than 4 min late would mislead
    if (p.origin !== 'current') kinds.push([LEAVE.CHECK, homeLeave - 60 * 60000, LEAVE_WINDOW_MIN]);
    if (pref.early) kinds.push([LEAVE.EARLY, leave - 10 * 60000, 4]);
    kinds.push([LEAVE.NOW, leave, LEAVE_WINDOW_MIN]);
    const due = kinds.filter(([, at, late]) => at > now - late * 60000 && at <= now);
    if (!due.length) continue;
    const [code, fireAt] = due.reduce((a, b) => (b[1] >= a[1] ? b : a));   // several due at once: only the latest is sent
    const title = String(row.title || 'your event');
    const from = p.origin === 'current' ? 'from your current location' : p.origin === 'event' ? `from ${p.origin_label}` : 'from home';
    const where = `starts ${t12(s)}${row.location ? ` · ${row.location}` : ''}`;
    const leaveWall = t12(utcToWall(leave, tz)), homeWall = t12(utcToWall(homeLeave, tz));
    const payload = code === LEAVE.CHECK
      ? { title: `🚗 Check your drive to ${title}`, body: `Leave by ${homeWall} from home (${fmtDrive(+p.drive_min)} drive) · ${where}. Open SANDY to check from where you are.` }
      : code === LEAVE.EARLY
        ? { title: `🚗 Leave in 10 min for ${title}`, body: `Leave by ${leaveWall} · ${fmtDrive(+p.drive_min)} drive ${from} · ${where}` }
        : { title: `🚗 Time to leave for ${title}`, body: `${fmtDrive(+p.drive_min)} drive ${from} · ${where}` };
    out.push({ plan: p, row, occ: String(p.occurrence_date).slice(0, 10), codes: due.map(d => d[0]), code, fireAt, payload: {
      title: payload.title.slice(0, 120), body: payload.body.slice(0, 200), tag: `${row.id}:${ymd(s)}:leave`,
      url: './?tab=today&locate=1', ts: fireAt } });
  }
  return out;
}
/** Events (rows) of opted-in owners starting in (now, now + ahead] with no usable plan: what the server should plan. */
export function needsServerPlan(rows, plans, prefOf, now = Date.now(), ahead = LEAVE_PLAN_AHEAD_MIN) {
  const have = new Map(plans.map(p => [`${p.event_id}|${String(p.occurrence_date).slice(0, 10)}`, p]));
  const out = [];
  for (const row of rows) {
    const pref = prefOf(row.owner_id);
    if (!pref || !pref.home || row.all_day || row.is_task || !String(row.location || '').trim()) continue;
    const tz = pref.tz || 'America/Chicago';
    const lo = utcToWall(now, tz), hi = utcToWall(now + ahead * 60000, tz);
    for (const s of occurrenceStarts(row, startOfDay(lo), addDays(startOfDay(hi), 1))) {
      if (s <= lo || s > hi) continue;
      const p = have.get(`${row.id}|${ymd(s)}`);
      if (p && wallKey(p.event_start) === wallKey(ymd(s) + 'T' + `${pad(s.getUTCHours())}:${pad(s.getUTCMinutes())}`)
        && String(p.location || '').trim() === String(row.location).trim()
        && (p.status === 'ok' || now - Date.parse(p.updated_at || 0) < 3600000)) continue;  // planned (or failed < 1 hr ago)
      out.push({ row, s, startUtc: wallToUtc(s, tz), home: pref.home });
    }
  }
  return out.sort((a, b) => a.startUtc - b.startUtc);
}
/** Free OpenStreetMap lookups (Photon geocoding + Valhalla routing). Returns {ok, mins} or {ok:false}. */
export async function serverDrive(home, address, f = fetch, env = {}) {
  try {
    const g = await f((env.GEOCODE_URL || 'https://photon.komoot.io/api/') + '?' + new URLSearchParams({ q: address, limit: '1', lang: 'en', lat: String(home.lat), lon: String(home.lon) }),
      { headers: { 'user-agent': 'SANDY-calendar (send-reminders)' } });
    if (!g.ok) return { ok: false };
    const c = (((await g.json()).features || [])[0] || {}).geometry?.coordinates;
    if (!c) return { ok: false };
    const body = { locations: [{ lat: +home.lat, lon: +home.lon }, { lat: +c[1], lon: +c[0] }], costing: 'auto', units: 'miles', directions_type: 'none' };
    const r = await f((env.ROUTE_URL || 'https://valhalla1.openstreetmap.de/route') + '?json=' + encodeURIComponent(JSON.stringify(body)),
      { headers: { 'user-agent': 'SANDY-calendar (send-reminders)' } });
    const j = r.ok ? await r.json() : {};
    const t = j.trip && j.trip.summary && j.trip.summary.time;
    return Number.isFinite(t) ? { ok: true, mins: Math.max(1, Math.round(t / 60)) } : { ok: false };
  } catch (_) { return { ok: false }; }
}

// ------------------------------------------------------------------ long-day nudge (Sandy Intelligence feature #2)
// FREE, rule-based. Evening before a long day (PUSH_HOUR local), push once (si_nudge_sends dedupe).
// Long day = timed events tomorrow (ignore all-day, tasks, Christian Dake reference titles) where
// first→last span ≥ SPAN_HOURS OR merged scheduled duration ≥ SCHEDULED_HOURS.
export const LONG_DAY_SPAN_HOURS = 10;
export const LONG_DAY_SCHEDULED_HOURS = 8;
export const LONG_DAY_MEAL_GAP_MIN = 30;
export const LONG_DAY_PUSH_HOUR = 20;
export const LONG_DAY_WINDOW_MIN = 15; // catch-up: still send up to 15 min after 8:00
const REF_RE = /christian\s+dake/i;
const isRefTitle = (t) => REF_RE.test(String(t || ''));
const minsBetween = (a, b) => Math.round((b - a) / 60000);
function mergedMinutes(intervals) {
  if (!intervals.length) return 0;
  const xs = intervals.slice().sort((a, b) => a[0] - b[0]);
  let total = 0, cur0 = xs[0][0], cur1 = xs[0][1];
  for (let i = 1; i < xs.length; i++) {
    const [s, e] = xs[i];
    if (s <= cur1) { if (e > cur1) cur1 = e; }
    else { total += minsBetween(cur0, cur1); cur0 = s; cur1 = e; }
  }
  return total + minsBetween(cur0, cur1);
}
function bestMealGap(sorted) {
  const gaps = [];
  for (let i = 0; i < sorted.length - 1; i++) {
    const a = sorted[i].end, b = sorted[i + 1].start, m = minsBetween(a, b);
    if (m >= LONG_DAY_MEAL_GAP_MIN) gaps.push({ start: a, end: b, min: m });
  }
  if (!gaps.length) return null;
  const lunch = gaps.filter(g => {
    const midH = (g.start.getUTCHours() * 60 + g.start.getUTCMinutes() + g.min / 2) / 60;
    return midH >= 11 && midH <= 14.5;
  });
  const pool = lunch.length ? lunch : gaps;
  return pool.reduce((a, b) => (b.min >= a.min ? b : a));
}
/** timed: [{start,end,title}] wall-clock. Returns {isLong, spanMin, scheduledMin, first, last, gap, reason}. */
export function analyzeLongDay(timed) {
  const xs = (timed || []).filter(x => x && x.start && x.end && x.end > x.start && !isRefTitle(x.title))
    .slice().sort((a, b) => a.start - b.start || a.end - b.end);
  if (!xs.length) return { isLong: false, spanMin: 0, scheduledMin: 0, first: null, last: null, gap: null, reason: null, count: 0 };
  const first = xs[0], last = xs.reduce((a, b) => (b.end >= a.end ? b : a));
  const spanMin = Math.max(0, minsBetween(first.start, last.end));
  const scheduledMin = mergedMinutes(xs.map(t => [t.start, t.end]));
  const gap = bestMealGap(xs);
  let reason = null;
  if (spanMin >= LONG_DAY_SPAN_HOURS * 60) reason = 'span';
  else if (scheduledMin >= LONG_DAY_SCHEDULED_HOURS * 60) reason = 'scheduled';
  return { isLong: !!reason, spanMin, scheduledMin, first, last, gap, reason, count: xs.length };
}
export function longDayMessage(info) {
  if (!info || !info.isLong) return '';
  const shortBreak = !info.gap || info.gap.min < 60;
  let s = `Long day tomorrow: ${t12(info.first.start)} to ${t12(info.last.end)}`;
  if (shortBreak) s += ', with only a short break';
  s += '. Pack lunch and snacks tonight.';
  if (info.gap) {
    const midH = (info.gap.start.getUTCHours() * 60 + info.gap.start.getUTCMinutes() + info.gap.min / 2) / 60;
    const label = midH >= 11 && midH <= 14.5 ? 'best lunch window' : 'longest open window';
    s += ` Your ${label} is ${t12(info.gap.start)}–${t12(info.gap.end)}.`;
  }
  return s;
}
/** Duration of a DB event row in ms (end_at − start_at). Fallback 60 min. */
function rowDurationMs(row) {
  try {
    const s = parseLocal(String(row.start_at).replace(' ', 'T').slice(0, 16));
    const e = row.end_at ? parseLocal(String(row.end_at).replace(' ', 'T').slice(0, 16)) : null;
    if (e && e > s) return e - s;
  } catch (_) {}
  return 60 * 60000;
}
/** Build timed occurrences for owner on targetYmd (wall date string). */
export function timedOnDay(rows, ownerId, targetYmd) {
  const day = parseLocal(targetYmd);
  const end = addDays(day, 1);
  const out = [];
  for (const row of rows) {
    if (row.owner_id !== ownerId || row.all_day || row.is_task || isRefTitle(row.title)) continue;
    const dur = rowDurationMs(row);
    for (const s of occurrenceStarts(row, day, end)) out.push({ start: s, end: new Date(s.getTime() + dur), title: row.title || '' });
  }
  return out;
}
/** profiles: [{user_id,time_zone}]; events: rows with end_at; sent: Set of `${owner}|${targetYmd}`; now ms.
 *  Returns [{owner_id, target, info, fireAt, payload}] due in the PUSH_HOUR window. */
export function dueLongDayNudges(profiles, events, sent, now = Date.now()) {
  const out = [];
  for (const p of profiles) {
    const tz = p.time_zone || 'America/Chicago';
    const wall = utcToWall(now, tz);
    const h = wall.getUTCHours(), mi = wall.getUTCMinutes();
    const minutesPast = h * 60 + mi;
    const pushAt = LONG_DAY_PUSH_HOUR * 60;
    if (minutesPast < pushAt || minutesPast > pushAt + LONG_DAY_WINDOW_MIN) continue;
    const today = startOfDay(wall);
    const target = ymd(addDays(today, 1));
    if (sent.has(`${p.user_id}|${target}`)) continue;
    const info = analyzeLongDay(timedOnDay(events, p.user_id, target));
    if (!info.isLong) continue;
    const body = longDayMessage(info);
    const fireAt = wallToUtc(W(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate(), LONG_DAY_PUSH_HOUR, 0), tz);
    out.push({ owner_id: p.user_id, target, info, fireAt, payload: {
      title: '🥪 Long day tomorrow',
      body: body.slice(0, 200),
      tag: `longday:${target}`,
      url: './?tab=today',
      ts: fireAt
    }});
  }
  return out;
}

// ------------------------------------------------------------------ weekly review nudge (Sandy Intelligence feature #6)
// FREE. Sunday PUSH_HOUR local: "Your week ahead is ready" once (si_nudge_sends kind weekly_review).
export const WEEKLY_REVIEW_PUSH_HOUR = 18;
export const WEEKLY_REVIEW_WINDOW_MIN = 15;
/** profiles: [{user_id,time_zone}]; sent: Set of `${owner}|${sundayYmd}`; now ms.
 *  Returns [{owner_id, target, fireAt, payload}] due in the Sunday 6 PM window. */
export function dueWeeklyReviewNudges(profiles, sent, now = Date.now()) {
  const out = [];
  for (const p of profiles) {
    const tz = p.time_zone || 'America/Chicago';
    const wall = utcToWall(now, tz);
    if (wall.getUTCDay() !== 0) continue; // Sunday only
    const h = wall.getUTCHours(), mi = wall.getUTCMinutes();
    const minutesPast = h * 60 + mi;
    const pushAt = WEEKLY_REVIEW_PUSH_HOUR * 60;
    if (minutesPast < pushAt || minutesPast > pushAt + WEEKLY_REVIEW_WINDOW_MIN) continue;
    const today = startOfDay(wall);
    const target = ymd(today); // that Sunday
    if (sent.has(`${p.user_id}|${target}`)) continue;
    const fireAt = wallToUtc(W(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate(), WEEKLY_REVIEW_PUSH_HOUR, 0), tz);
    out.push({ owner_id: p.user_id, target, fireAt, payload: {
      title: '📋 Your week ahead is ready',
      body: 'Open Today for busiest day, games, long days, clashes, and to-dos.',
      tag: `weekly:${target}`,
      url: './?tab=today&si=weekly',
      ts: fireAt
    }});
  }
  return out;
}

// ------------------------------------------------------------------ HTTP handler
const json = (b, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { 'content-type': 'application/json' } });
export async function handle(req, env, f = fetch, now = Date.now()) {
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405);
  const base = env.SUPABASE_URL, svc = env.SUPABASE_SERVICE_ROLE_KEY;
  const vapid = { publicKey: env.VAPID_PUBLIC_KEY, privateKey: env.VAPID_PRIVATE_KEY, subject: env.VAPID_SUBJECT || 'mailto:admin@example.com' };
  if (!base || !svc || !vapid.publicKey || !vapid.privateKey) return json({ error: 'Server not configured' }, 500);
  const S = { apikey: svc, authorization: `Bearer ${svc}`, 'content-type': 'application/json' };
  const rest = (p, init = {}) => f(`${base}/rest/v1/${p}`, { ...init, headers: { ...S, ...(init.headers || {}) } });
  const secret = req.headers.get('x-cron-secret') || '';
  const ok = secret && await rest('rpc/sandy_check_cron_secret', { method: 'POST', body: JSON.stringify({ s: secret }) });
  if (!ok || !ok.ok || (await ok.json()) !== true) return json({ error: 'Forbidden' }, 403);

  const COLS = 'id,owner_id,title,location,all_day,start_at,recur_freq,recur_interval,recur_until,recur_by_weekday,exdates,is_task,done,completed_dates';
  const er = await rest(`events?select=${COLS},reminders&reminders=neq.{}&limit=20000`);
  if (!er.ok) return json({ error: 'Could not read events' }, 500);
  const rows = await er.json();
  // leave-by alerts: who has them on (columns/table may not exist yet -> skipped)
  const lr = await rest('profiles?select=user_id,time_zone,leave_alerts_early,home_lat,home_lon&leave_alerts=is.true');
  const leaveProfiles = lr.ok ? await lr.json() : [];
  // long-day nudge: who has it on (column may not exist yet -> skipped)
  const ldr = await rest('profiles?select=user_id,time_zone&si_long_day=is.true');
  const longDayProfiles = ldr.ok ? await ldr.json() : [];
  // weekly review: who has it on (column may not exist yet -> skipped)
  const wrr = await rest('profiles?select=user_id,time_zone&si_weekly_review=is.true');
  const weeklyProfiles = wrr.ok ? await wrr.json() : [];
  const owners = [...new Set([...rows.map(r => r.owner_id), ...leaveProfiles.map(p => p.user_id), ...longDayProfiles.map(p => p.user_id), ...weeklyProfiles.map(p => p.user_id)])];
  if (!owners.length) return json({ due: 0, sent: 0 });
  const inList = `(${owners.join(',')})`;
  const [pr, sr] = await Promise.all([rest(`profiles?select=user_id,time_zone&user_id=in.${inList}`), rest(`push_subscriptions?select=id,owner_id,endpoint,p256dh,auth&owner_id=in.${inList}`)]);
  const tz = new Map((pr.ok ? await pr.json() : []).map(p => [p.user_id, p.time_zone]));
  const subs = sr.ok ? await sr.json() : [];
  let sent = 0, failed = 0, gone = 0;
  const claim = async (event_id, occ, minutes, owner_id) => {
    const c = await rest('reminder_sends', { method: 'POST', headers: { Prefer: 'resolution=ignore-duplicates,return=representation' },
      body: JSON.stringify({ event_id, occurrence_date: occ, minutes, owner_id }) });
    return c.ok && (await c.json()).length > 0;
  };
  const deliver = async (owner, payload) => {
    for (const s of subs.filter(x => x.owner_id === owner)) {
      if (s.dead) continue;
      try {
        const r = await sendPush(s, payload, vapid, f);
        if (r.status === 404 || r.status === 410) { gone++; s.dead = true; await rest(`push_subscriptions?id=eq.${s.id}`, { method: 'DELETE' }); }
        else if (r.ok) sent++; else failed++;
      } catch (_) { failed++; }
    }
  };
  const due = dueReminders(rows, o => tz.get(o), now);
  for (const d of due) {
    // claim it first (primary key = event + date + minutes): a second run can't send it again
    if (await claim(d.row.id, d.occ, d.minutes, d.row.owner_id)) await deliver(d.row.owner_id, d.payload);
  }

  let leaveDue = 0, planned = 0;
  if (leaveProfiles.length) {
    const prefs = new Map(leaveProfiles.map(p => [p.user_id, { early: p.leave_alerts_early !== false, tz: p.time_zone || tz.get(p.user_id),
      home: Number.isFinite(p.home_lat) && Number.isFinite(p.home_lon) ? { lat: p.home_lat, lon: p.home_lon } : null }]));
    const prefOf = (o) => prefs.get(o);
    const lIn = `(${leaveProfiles.map(p => p.user_id).join(',')})`;
    const today = ymd(utcToWall(now, 'UTC'));
    const yday = ymd(addDays(parseLocal(today), -1)), tmrw = ymd(addDays(parseLocal(today), 1));
    const [plr, evr] = await Promise.all([
      rest(`leave_plans?select=*&owner_id=in.${lIn}&occurrence_date=gte.${yday}&occurrence_date=lte.${tmrw}`),
      rest(`events?select=${COLS}&owner_id=in.${lIn}&location=neq.&all_day=is.false&is_task=is.false&limit=20000`)]);
    if (plr.ok && evr.ok) {
      const plans = await plr.json(); const evs = await evr.json();
      // 1. plan events in the next 3 hours the app hasn't planned (the app wasn't opened today)
      for (const n of needsServerPlan(evs, plans, prefOf, now).slice(0, LEAVE_MAX_LOOKUPS)) {
        const d = await serverDrive(n.home, String(n.row.location).trim(), f, env);
        const at = d.ok ? new Date(leaveAtUtc(n.startUtc, d.mins)).toISOString() : new Date(n.startUtc).toISOString();
        const plan = { event_id: n.row.id, occurrence_date: ymd(n.s), owner_id: n.row.owner_id,
          event_start: `${ymd(n.s)}T${pad(n.s.getUTCHours())}:${pad(n.s.getUTCMinutes())}:00`, location: String(n.row.location).trim(),
          leave_at: at, home_leave_at: at, drive_min: d.ok ? d.mins : 0, origin: 'home', origin_label: 'home',
          status: d.ok ? 'ok' : 'failed', source: 'server', updated_at: new Date(now).toISOString() };
        const w = await rest('leave_plans?on_conflict=event_id,occurrence_date', { method: 'POST', headers: { Prefer: 'resolution=merge-duplicates,return=minimal' }, body: JSON.stringify(plan) });
        if (w.ok) { planned++; const i = plans.findIndex(p => p.event_id === plan.event_id && String(p.occurrence_date).slice(0, 10) === plan.occurrence_date); if (i >= 0) plans[i] = plan; else plans.push(plan); }
      }
      // 2. send what's due
      const byId = new Map(evs.map(r => [r.id, r]));
      const ld = dueLeaveAlerts(plans, byId, prefOf, now); leaveDue = ld.length;
      for (const a of ld) {
        let mine = false;
        for (const code of a.codes) { const won = await claim(a.row.id, a.occ, code, a.row.owner_id); if (code === a.code) mine = won; }
        if (mine) await deliver(a.row.owner_id, a.payload);
      }
      // 3. once an hour: forget plans from 2+ days ago
      if (new Date(now).getUTCMinutes() === 7) await rest(`leave_plans?occurrence_date=lt.${yday}`, { method: 'DELETE' });
    }
  }
  let longDayDue = 0;
  if (longDayProfiles.length) {
    const lIn = `(${longDayProfiles.map(p => p.user_id).join(',')})`;
    // tomorrow in each zone may differ near midnight; fetch a 3-day window of timed events
    const evr2 = await rest(`events?select=${COLS},end_at&owner_id=in.${lIn}&all_day=is.false&is_task=is.false&limit=20000`);
    const sentR = await rest(`si_nudge_sends?select=owner_id,target_date&kind=eq.long_day&owner_id=in.${lIn}&target_date=gte.${ymd(addDays(utcToWall(now, 'UTC'), -1))}`);
    if (evr2.ok) {
      const evs2 = await evr2.json();
      const already = new Set((sentR.ok ? await sentR.json() : []).map(r => `${r.owner_id}|${String(r.target_date).slice(0, 10)}`));
      const ld = dueLongDayNudges(longDayProfiles, evs2, already, now); longDayDue = ld.length;
      for (const a of ld) {
        const c = await rest('si_nudge_sends', { method: 'POST', headers: { Prefer: 'resolution=ignore-duplicates,return=representation' },
          body: JSON.stringify({ owner_id: a.owner_id, kind: 'long_day', target_date: a.target }) });
        if (c.ok && (await c.json()).length > 0) await deliver(a.owner_id, a.payload);
      }
    }
  }
  let weeklyDue = 0;
  if (weeklyProfiles.length) {
    const wIn = `(${weeklyProfiles.map(p => p.user_id).join(',')})`;
    const sentW = await rest(`si_nudge_sends?select=owner_id,target_date&kind=eq.weekly_review&owner_id=in.${wIn}&target_date=gte.${ymd(addDays(utcToWall(now, 'UTC'), -8))}`);
    const alreadyW = new Set((sentW.ok ? await sentW.json() : []).map(r => `${r.owner_id}|${String(r.target_date).slice(0, 10)}`));
    const wd = dueWeeklyReviewNudges(weeklyProfiles, alreadyW, now); weeklyDue = wd.length;
    for (const a of wd) {
      const c = await rest('si_nudge_sends', { method: 'POST', headers: { Prefer: 'resolution=ignore-duplicates,return=representation' },
        body: JSON.stringify({ owner_id: a.owner_id, kind: 'weekly_review', target_date: a.target }) });
      if (c.ok && (await c.json()).length > 0) await deliver(a.owner_id, a.payload);
    }
  }
  return json({ due: due.length, sent, failed, gone, leave_due: leaveDue, planned, long_day_due: longDayDue, weekly_review_due: weeklyDue });
}

const D = globalThis.Deno;
if (D && D.serve) D.serve((req) => handle(req, D.env.toObject()));
