// Node test for the feedback part of send-reminders: Scott's replies push to the feedback sender, new feedback
// alerts Scott, QA (@example.com) senders never alert Scott, each row is claimed once, missing tables are skipped.
//   node tests/feedback_push_function.test.mjs   (no network; push endpoints are faked)
import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs'; import { tmpdir } from 'node:os'; import { join } from 'node:path';
import nodeCrypto from 'node:crypto';
const dir = mkdtempSync(join(tmpdir(), 'fbfn-')); const f = join(dir, 'fn.mjs');
writeFileSync(f, readFileSync(new URL('../supabase/functions/send-reminders/index.ts', import.meta.url), 'utf8'));
const M = await import(f);
const assert = (c, m) => { if (!c) throw new Error('FAIL: ' + m); console.log('ok -', m); };

assert(M.isQaEmail('sandy-qa-android@example.com') && M.isQaEmail(' X@EXAMPLE.COM ') && !M.isQaEmail('friend@gmail.com') && !M.isQaEmail(null), 'QA email detection');
const p1 = M.feedbackReplyPayload({ feedback_id: 'f1', status: 'fixing', body: null });
assert(p1.body === "We're actively fixing it" && p1.tag === 'fbr-f1' && p1.url === './?tab=profile&fb=mine', 'reply payload: preset text, per-feedback tag, opens My feedback');
const p2 = M.feedbackReplyPayload({ feedback_id: 'f1', status: 'fixed', body: 'Shipped in today\'s update' });
assert(/fixed/.test(p2.title) && p2.body === "It's fixed — Shipped in today's update", 'reply payload: fixed title + custom text');
assert(M.feedbackReplyPayload({ feedback_id: 'f', status: 'note', body: 'x'.repeat(400) }).body.length === 180, 'custom note clipped to 180');
const a = M.feedbackAlertPayload({ email: 'amy@gmail.com', body: 'Week view\n is slow' });
assert(a.title === 'New SANDY feedback' && a.body === 'amy@gmail.com: Week view is slow' && a.url === './?tab=profile&fb=inbox', 'alert payload');

const ua = nodeCrypto.createECDH('prime256v1'); ua.generateKeys();
const mkSub = (id, owner) => ({ id, owner_id: owner, endpoint: `https://push.example.net/send/${id}`, p256dh: ua.getPublicKey().toString('base64url'), auth: nodeCrypto.randomBytes(16).toString('base64url'), created_at: '2026-01-01T00:00:00Z' });
const kp = nodeCrypto.generateKeyPairSync('ec', { namedCurve: 'P-256' }); const jwk = kp.privateKey.export({ format: 'jwk' });
const env = { SUPABASE_URL: 'https://x.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 'svc', VAPID_PRIVATE_KEY: jwk.d,
  VAPID_PUBLIC_KEY: Buffer.concat([Buffer.from([4]), Buffer.from(jwk.x, 'base64url'), Buffer.from(jwk.y, 'base64url')]).toString('base64url') };
const SCOTT = 'scott-id';
function world({ tablesExist = true } = {}) {
  const st = {
    replies: [{ id: 'r1', feedback_id: 'f1', owner_id: 'qa-user', status: 'fixing', body: null, pushed_at: null }],
    feedback: [{ id: 'f1', owner_id: 'qa-user', email: 'sandy-qa-android@example.com', body: 'QA note', pushed_at: null },
               { id: 'f2', owner_id: 'real-user', email: 'friend@gmail.com', body: 'Real note', pushed_at: null },
               { id: 'f3', owner_id: SCOTT, email: 'scottro1522@gmail.com', body: 'note to self', pushed_at: null }],
    subs: [mkSub('s-qa', 'qa-user'), mkSub('s-scott', SCOTT), mkSub('s-real', 'real-user')], pushedTo: [], patches: 0 };
  st.fetch = async (url, init = {}) => {
    const u = new URL(url); const m = init.method || 'GET'; const p = u.pathname;
    if (u.host === 'push.example.net') { st.pushedTo.push(p.split('/').pop()); return new Response('', { status: 201 }); }
    if (p.endsWith('/rpc/sandy_check_cron_secret')) return new Response('true');
    if (p.endsWith('/rpc/sandy_default_owner')) return new Response(JSON.stringify(SCOTT));
    if (p.endsWith('/push_subscriptions')) return new Response(JSON.stringify(st.subs.filter(s => u.search.includes(s.owner_id))));
    const tbl = p.endsWith('/feedback_replies') ? st.replies : p.endsWith('/feedback') ? st.feedback : null;
    if (tbl) {
      if (!tablesExist) return new Response('{"message":"missing"}', { status: 404 });
      if (m === 'GET') return new Response(JSON.stringify(tbl.filter(r => !r.pushed_at)));
      if (m === 'PATCH') { st.patches++; const id = u.searchParams.get('id').slice(3); const r = tbl.find(x => x.id === id && !x.pushed_at); if (r) r.pushed_at = JSON.parse(init.body).pushed_at; return new Response(JSON.stringify(r ? [r] : [])); }
    }
    if (m === 'GET') return new Response('[]');
    return new Response('[]');
  };
  return st;
}
const req = () => new Request('https://fn/', { method: 'POST', headers: { 'x-cron-secret': 's' } });
const w = world();
const out = await (await M.handle(req(), env, w.fetch, Date.parse('2026-10-30T12:00:00Z'))).json();
assert(w.pushedTo.includes('s-qa'), 'reply pushed to the feedback sender (QA user)');
assert(w.pushedTo.filter(x => x === 's-scott').length === 1, 'Scott alerted exactly once (the real sender only)');
assert(!w.pushedTo.includes('s-real'), 'other users get nothing');
assert(w.replies[0].pushed_at && w.feedback.every(r => r.pushed_at), 'every queued row claimed (QA + self rows marked, not alerted)');
assert(out.feedback_pushes === 2, 'response counts feedback pushes: ' + JSON.stringify(out));
w.pushedTo.length = 0;
await M.handle(req(), env, w.fetch, Date.parse('2026-10-30T12:01:00Z'));
assert(w.pushedTo.length === 0, 'next run sends nothing again');
// QA-only world: Scott is never pushed
const q = world(); q.feedback = q.feedback.slice(0, 1);
await M.handle(req(), env, q.fetch, Date.parse('2026-10-30T12:00:00Z'));
assert(!q.pushedTo.includes('s-scott') && q.pushedTo.includes('s-qa'), 'QA-only feedback: Scott never notified');
// before the migration: tables missing -> skipped, no crash
const n = world({ tablesExist: false });
const r3 = await M.handle(req(), env, n.fetch, Date.parse('2026-10-30T12:00:00Z'));
assert(r3.status === 200 && n.pushedTo.length === 0, 'missing tables/columns: skipped cleanly');
console.log('ALL OK');
