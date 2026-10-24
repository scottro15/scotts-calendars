// SANDY reminders: Supabase Edge Function "send-reminders", called every minute by pg_cron (see
// supabase/migration-2026-10-24-push.sql). Finds reminders that are due (per user time zone, per occurrence
// of repeating events), records each one in reminder_sends (so nothing is sent twice) and delivers a
// Web Push (VAPID, RFC 8291 aes128gcm) to every device the owner enabled.
// - Caller check: header x-cron-secret must match the secret the migration generated inside Supabase Vault
//   (checked by rpc sandy_check_cron_secret with the service role); deployed with --no-verify-jwt.
// - Secrets (function secrets only): VAPID_PRIVATE_KEY, VAPID_PUBLIC_KEY, VAPID_SUBJECT.
//   SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY are injected by Supabase.
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

  const er = await rest('events?select=id,owner_id,title,location,all_day,start_at,recur_freq,recur_interval,recur_until,recur_by_weekday,exdates,is_task,done,completed_dates,reminders&reminders=neq.{}&limit=20000');
  if (!er.ok) return json({ error: 'Could not read events' }, 500);
  const rows = await er.json();
  const owners = [...new Set(rows.map(r => r.owner_id))];
  if (!owners.length) return json({ due: 0, sent: 0 });
  const inList = `(${owners.join(',')})`;
  const [pr, sr] = await Promise.all([rest(`profiles?select=user_id,time_zone&user_id=in.${inList}`), rest(`push_subscriptions?select=id,owner_id,endpoint,p256dh,auth&owner_id=in.${inList}`)]);
  const tz = new Map((pr.ok ? await pr.json() : []).map(p => [p.user_id, p.time_zone]));
  const subs = sr.ok ? await sr.json() : [];
  const due = dueReminders(rows, o => tz.get(o), now);
  let sent = 0, failed = 0, gone = 0;
  for (const d of due) {
    // claim it first (primary key = event + date + minutes): a second run can't send it again
    const c = await rest('reminder_sends', { method: 'POST', headers: { Prefer: 'resolution=ignore-duplicates,return=representation' },
      body: JSON.stringify({ event_id: d.row.id, occurrence_date: d.occ, minutes: d.minutes, owner_id: d.row.owner_id }) });
    if (!c.ok || !(await c.json()).length) continue;
    for (const s of subs.filter(x => x.owner_id === d.row.owner_id)) {
      try {
        const r = await sendPush(s, d.payload, vapid, f);
        if (r.status === 404 || r.status === 410) { gone++; await rest(`push_subscriptions?id=eq.${s.id}`, { method: 'DELETE' }); }
        else if (r.ok) sent++; else failed++;
      } catch (_) { failed++; }
    }
  }
  return json({ due: due.length, sent, failed, gone });
}

const D = globalThis.Deno;
if (D && D.serve) D.serve((req) => handle(req, D.env.toObject()));
