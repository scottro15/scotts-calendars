// Node test for the send-test-push Edge Function (t147u): auth required, only the caller's own device,
// a real decryptable Web Push (RFC 8291) with VAPID, 404/410 -> subscription deleted + gone, rate limit, CORS.
// No network.  node tests/send_test_push_function.test.mjs   (optional: ECE=/path/to/node_modules/http_ece)
import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs'; import { tmpdir } from 'node:os'; import { join } from 'node:path';
import { createRequire } from 'node:module'; import nodeCrypto from 'node:crypto';
const dir = mkdtempSync(join(tmpdir(), 'testpush-')); const fp = join(dir, 'fn.mjs');
writeFileSync(fp, readFileSync(new URL('../supabase/functions/send-test-push/index.ts', import.meta.url), 'utf8'));
const M = await import(fp);
const assert = (c, m) => { if (!c) throw new Error('FAIL: ' + m); console.log('ok -', m); };

const vk = nodeCrypto.generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
const jwk = vk.privateKey.export({ format: 'jwk' });
const pub = Buffer.concat([Buffer.from([4]), Buffer.from(jwk.x, 'base64url'), Buffer.from(jwk.y, 'base64url')]).toString('base64url');
const env = { SUPABASE_URL: 'https://db.test', SUPABASE_SERVICE_ROLE_KEY: 'svc', SUPABASE_ANON_KEY: 'anon', VAPID_PUBLIC_KEY: pub, VAPID_PRIVATE_KEY: jwk.d, VAPID_SUBJECT: 'mailto:t@example.com' };
const ua = nodeCrypto.createECDH('prime256v1'); ua.generateKeys(); const authSecret = nodeCrypto.randomBytes(16);
const mine = { id: 's1', created_at: '2026-01-01T00:00:00Z', owner_id: 'u1', endpoint: 'https://fcm.googleapis.com/fcm/send/abc', p256dh: ua.getPublicKey().toString('base64url'), auth: authSecret.toString('base64url') };

function fake({ pushStatus = 201, user = { id: 'u1' } } = {}) {
  const log = { pushes: [], deletes: [], queries: [] };
  const f = async (url, init = {}) => {
    const u = String(url);
    if (u.endsWith('/auth/v1/user')) return new Response(user ? JSON.stringify(user) : '{}', { status: user ? 200 : 401 });
    if (u.includes('/rest/v1/push_subscriptions?select=')) { log.queries.push(decodeURIComponent(u)); const own = u.includes('owner_id=eq.u1'); const ep = /endpoint=eq\.([^&]+)/.exec(u); return new Response(JSON.stringify(own && (!ep || decodeURIComponent(ep[1]) === mine.endpoint) ? [mine] : []), { status: 200 }); }
    if (u.includes('/rest/v1/push_subscriptions?id=eq.') && init.method === 'DELETE') { log.deletes.push(u); return new Response('[]', { status: 200 }); }
    if (u.startsWith('https://fcm.googleapis.com/')) { log.pushes.push({ url: u, init }); return new Response('', { status: pushStatus }); }
    throw new Error('unexpected fetch ' + u);
  };
  return { f, log };
}
const req = (body, auth = 'Bearer jwt') => new Request('https://fn.test/send-test-push', { method: 'POST', headers: { 'content-type': 'application/json', ...(auth ? { authorization: auth } : {}) }, body: JSON.stringify(body) });
let t = Date.parse('2026-06-01T00:00:00Z');

// CORS preflight
let r = await M.handle(new Request('https://fn.test/x', { method: 'OPTIONS' }), env, fake().f);
assert(r.status === 200 && r.headers.get('access-control-allow-origin') === '*', 'CORS preflight answered');
// no auth
r = await M.handle(req({}, ''), env, fake().f); assert(r.status === 401, 'no sign-in -> 401');
r = await M.handle(req({}), env, fake({ user: null }).f); assert(r.status === 401, 'bad token -> 401');
// sends a real, decryptable push to the caller's own device
let k = fake(); r = await M.handle(req({ endpoint: mine.endpoint }), env, k.f, t += 10000); let j = await r.json();
assert(r.status === 200 && j.sent === 1 && j.gone === false, 'test push sent to my device');
assert(k.log.queries[0].includes('owner_id=eq.u1') && k.log.queries[0].includes('endpoint=eq.' + mine.endpoint), 'query scoped to caller + endpoint');
const h = k.log.pushes[0].init.headers;
assert(h['content-encoding'] === 'aes128gcm' && /^vapid t=.+, k=/.test(h.authorization) && h.urgency === 'high', 'VAPID + aes128gcm headers');
let ece = null; try { ece = createRequire(import.meta.url)(process.env.ECE || '/tmp/wp/node_modules/http_ece'); } catch (_) {}
if (ece) { const out = JSON.parse(ece.decrypt(Buffer.from(k.log.pushes[0].init.body), { version: 'aes128gcm', privateKey: ua, authSecret }).toString()); assert(out.tag === 'sandy-test' && /Test notification/.test(out.body), 'payload decrypts to the test notification'); }
else console.log('skip - http_ece not installed: reference decrypt');
// someone else's endpoint -> nothing sent
k = fake({ user: { id: 'u2' } }); r = await M.handle(req({ endpoint: mine.endpoint }), env, k.f, t += 10000); j = await r.json();
assert(j.sent === 0 && k.log.pushes.length === 0, "never sends to another user's device");
// expired device -> deleted + gone
for (const st of [410, 404]) { k = fake({ pushStatus: st }); r = await M.handle(req({ endpoint: mine.endpoint }), env, k.f, t += 10000); j = await r.json();
  assert(j.gone === true && k.log.deletes.length === 1 && k.log.deletes[0].includes('id=eq.s1'), `${st} -> subscription removed, gone: true`); }
// brand-new device (FCM not propagated yet): 410 -> pending, NOT deleted
{ const fresh = mine.created_at; mine.created_at = new Date(t + 10000 - 30000).toISOString();
  k = fake({ pushStatus: 410 }); r = await M.handle(req({ endpoint: mine.endpoint }), env, k.f, t += 10000); j = await r.json();
  assert(j.pending === 1 && j.gone === false && k.log.deletes.length === 0, 'fresh device answering 410 -> pending, kept');
  mine.created_at = fresh; }
// push service error -> failed, not deleted
k = fake({ pushStatus: 500 }); r = await M.handle(req({ endpoint: mine.endpoint }), env, k.f, t += 10000); j = await r.json();
assert(j.sent === 0 && j.failed === 1 && j.status === 500 && k.log.deletes.length === 0, '5xx -> failed, kept');
// rate limit
k = fake(); await M.handle(req({ endpoint: mine.endpoint }), env, k.f, t += 10000); r = await M.handle(req({ endpoint: mine.endpoint }), env, k.f, t + 1000);
assert(r.status === 429, 'second test within 5 s -> 429');
// bad endpoint
r = await M.handle(req({ endpoint: 'http://evil' }), env, fake().f, t += 10000); assert(r.status === 400, 'non-https endpoint rejected');
console.log('ALL PASS');
