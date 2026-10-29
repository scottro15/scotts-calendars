// SANDY "Send test notification": Supabase Edge Function "send-test-push" (t147u).
// The signed-in user taps "Send test notification" in Profile → Notifications. This sends a real Web Push
// (VAPID, RFC 8291 aes128gcm — same code as send-reminders) to the caller's OWN device(s), so the test proves
// the whole path: browser subscription → push service (FCM / Apple / Mozilla) → the device.
// - Caller: must be signed in (JWT verified by Supabase and re-checked here via /auth/v1/user).
// - Body: { endpoint?: string } — only that device (it must belong to the caller); else all the caller's devices (max 10).
// - Expired devices: a 404/410 from the push service deletes that subscription and returns gone: true —
//   except in the first 2 minutes after the device subscribed: FCM can answer 404/410 for a brand-new
//   registration until it has propagated, so then it answers pending: true and keeps the device.
// - Light rate limit: one test per device per 5 seconds (per warm instance).
// - Secrets (function secrets only, shared with send-reminders): VAPID_PRIVATE_KEY, VAPID_PUBLIC_KEY, VAPID_SUBJECT.
//   SUPABASE_URL / SUPABASE_ANON_KEY / SUPABASE_SERVICE_ROLE_KEY are injected by Supabase.
// Deploy: npx -y supabase@latest functions deploy send-test-push --project-ref <ref> --use-api  (JWT verification on)
// Dependency-free (WebCrypto + fetch) so tests import it under Node.

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
    'content-type': 'application/octet-stream', ttl: '600', urgency: 'high' } });
}


const CORS = { 'access-control-allow-origin': '*', 'access-control-allow-headers': 'authorization, x-client-info, apikey, content-type', 'access-control-allow-methods': 'POST, OPTIONS' };
const json = (b, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { 'content-type': 'application/json', ...CORS } });
const recent = new Map();
export const FRESH_MS = 120000; // a device that subscribed < 2 min ago is never treated as expired

export async function handle(req, env, f = fetch, now = Date.now()) {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405);
  const base = env.SUPABASE_URL, svc = env.SUPABASE_SERVICE_ROLE_KEY, anon = env.SUPABASE_ANON_KEY || svc;
  const vapid = { publicKey: env.VAPID_PUBLIC_KEY, privateKey: env.VAPID_PRIVATE_KEY, subject: env.VAPID_SUBJECT || 'mailto:admin@example.com' };
  if (!base || !svc || !vapid.publicKey || !vapid.privateKey) return json({ error: 'Server not configured' }, 500);
  const authz = req.headers.get('authorization') || '';
  if (!/^Bearer\s+\S+/.test(authz)) return json({ error: 'Sign in first' }, 401);
  const ur = await f(`${base}/auth/v1/user`, { headers: { apikey: anon, authorization: authz } });
  if (!ur.ok) return json({ error: 'Sign in first' }, 401);
  const user = await ur.json(); if (!user || !user.id) return json({ error: 'Sign in first' }, 401);
  let body = {}; try { body = await req.json(); } catch (_) {}
  const endpoint = typeof body.endpoint === 'string' ? body.endpoint : '';
  if (endpoint && (!/^https:\/\//.test(endpoint) || endpoint.length > 1000)) return json({ error: 'Bad endpoint' }, 400);
  const S = { apikey: svc, authorization: `Bearer ${svc}`, 'content-type': 'application/json' };
  const rest = (p, init = {}) => f(`${base}/rest/v1/${p}`, { ...init, headers: { ...S, ...(init.headers || {}) } });
  let q = `push_subscriptions?select=id,owner_id,endpoint,p256dh,auth,created_at&owner_id=eq.${encodeURIComponent(user.id)}&limit=10`;
  if (endpoint) q += `&endpoint=eq.${encodeURIComponent(endpoint)}`;
  const sr = await rest(q); if (!sr.ok) return json({ error: 'Could not read devices' }, 500);
  const subs = await sr.json();
  if (!subs.length) return json({ sent: 0, gone: false, devices: 0, error: 'No device with notifications on' }, 200);
  const key = `${user.id}|${endpoint}`;
  if (now - (recent.get(key) || 0) < 5000) return json({ error: 'Slow down: one test every few seconds' }, 429);
  recent.set(key, now);
  const payload = { title: 'SANDY', body: 'Test notification: notifications work on this device 🎉', tag: 'sandy-test', url: './?tab=profile' };
  let sent = 0, gone = 0, failed = 0, pending = 0, status = 0;
  for (const s of subs) {
    try {
      const r = await sendPush(s, payload, vapid, f); status = r.status;
      if (r.status === 404 || r.status === 410) {
        if (now - Date.parse(s.created_at || 0) < FRESH_MS) pending++;
        else { gone++; await rest(`push_subscriptions?id=eq.${s.id}`, { method: 'DELETE' }); }
      } else if (r.ok) sent++; else failed++;
    } catch (_) { failed++; }
  }
  return json({ sent, failed, pending, gone: endpoint ? gone > 0 : gone, devices: subs.length, status });
}

const D = globalThis.Deno;
if (D && D.serve) D.serve((req) => handle(req, D.env.toObject()));
