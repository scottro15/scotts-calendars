// SANDY admin invites: Supabase Edge Function "admin-invites" (invite-only free prototype).
// - Caller must be signed in AND be the admin: checked with the caller's own JWT via rpc sandy_is_admin()
//   (admin = the owner account; there is no flag a user could set on themselves).
// - Only then does it use the service-role key (provided to Edge Functions automatically by Supabase,
//   never sent to the browser) for the Auth admin API: create the invited user so their magic link works.
// - Actions (POST JSON): {action:'list'} | {action:'invite', email, firstName?|note?, sendEmail?} | {action:'set_name', email, firstName?} | {action:'revoke', email} | {action:'restore', email}
//   'invite' creates the auth user WITHOUT sending email by default (Scott sends his own invite text);
//   sendEmail:true uses Supabase's invite email instead (counts against the SMTP rate limit).
//   firstName (or note) is stored on invites.note (max 80 chars) so the Invites screen can fill "Hey [Name]! …".
//   'set_name' updates only that field (does not change status); needs a redeploy of this function.
//   'revoke' bans the sign-in (reversible with 'restore'); it never deletes anyone's data.
// Dependency-free (plain fetch) so tests can import it under Node.

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...CORS, 'content-type': 'application/json' } });
export const normEmail = e => String(e || '').trim().toLowerCase();
export const validEmail = e => e.length <= 254 && /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e);
export const MAX_INVITES = 200;

export async function handle(req, env, f = fetch) {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405);
  const auth = req.headers.get('authorization') || '';
  if (!/^Bearer\s+\S+/.test(auth)) return json({ error: 'Sign in required' }, 401);
  const base = env.SUPABASE_URL, anon = env.SUPABASE_ANON_KEY, svc = env.SUPABASE_SERVICE_ROLE_KEY;
  if (!base || !anon || !svc) return json({ error: 'Server not configured' }, 500);

  const u = await f(`${base}/auth/v1/user`, { headers: { authorization: auth, apikey: anon } });
  if (!u.ok) return json({ error: 'Sign in required' }, 401);
  const me = await u.json(); if (!me || !me.id) return json({ error: 'Sign in required' }, 401);
  const adm = await f(`${base}/rest/v1/rpc/sandy_is_admin`, { method: 'POST', headers: { authorization: auth, apikey: anon, 'content-type': 'application/json' }, body: '{}' });
  if (!adm.ok || (await adm.json()) !== true) return json({ error: 'Admins only' }, 403);

  let body; try { body = await req.json(); } catch { return json({ error: 'Bad JSON' }, 400); }
  const S = { apikey: svc, authorization: `Bearer ${svc}`, 'content-type': 'application/json' };
  const rest = (path, init = {}) => f(`${base}/rest/v1/${path}`, { ...init, headers: { ...S, Prefer: 'return=representation', ...(init.headers || {}) } });
  const users = async () => {
    const r = await f(`${base}/auth/v1/admin/users?page=1&per_page=1000`, { headers: S });
    if (!r.ok) throw new Error('Could not list users');
    const j = await r.json(); return j.users || j || [];
  };
  const findUser = async email => (await users()).find(x => normEmail(x.email) === email) || null;

  try {
    if (body.action === 'list') {
      const [ir, us] = await Promise.all([rest('invites?select=*&order=created_at.desc'), users()]);
      if (!ir.ok) throw new Error('Could not read invites (has the launch migration been run?)');
      const byEmail = new Map(us.map(x => [normEmail(x.email), x]));
      const invites = (await ir.json()).map(i => {
        const au = byEmail.get(i.email);
        const banned = au && au.banned_until && new Date(au.banned_until) > new Date();
        const status = i.status === 'revoked' || banned ? 'revoked' : (au && au.last_sign_in_at) || i.status === 'accepted' ? 'accepted' : 'invited';
        return { email: i.email, status, note: i.note, firstName: i.note || '', created_at: i.created_at, accepted_at: i.accepted_at, last_sign_in_at: au ? au.last_sign_in_at : null };
      });
      return json({ invites });
    }
    const email = normEmail(body.email);
    if (!validEmail(email)) return json({ error: 'Enter a valid email address' }, 400);

    if (body.action === 'invite') {
      const cnt = await rest('invites?select=id', { headers: { Prefer: 'count=exact' }, method: 'HEAD' });
      const total = +((cnt.headers.get('content-range') || '').split('/')[1] || 0);
      if (total >= MAX_INVITES) return json({ error: `Invite limit reached (${MAX_INVITES})` }, 429);
      let au = await findUser(email);
      if (!au) {
        const r = body.sendEmail
          ? await f(`${base}/auth/v1/invite`, { method: 'POST', headers: S, body: JSON.stringify({ email }) })
          : await f(`${base}/auth/v1/admin/users`, { method: 'POST', headers: S, body: JSON.stringify({ email, email_confirm: true }) });
        if (!r.ok) { const t = await r.text(); return json({ error: 'Could not create the invited account: ' + t.slice(0, 200) }, 502); }
        au = await r.json();
      }
      const rawName = body.firstName != null ? body.firstName : body.note;
      const note = rawName != null ? String(rawName).trim().slice(0, 80) || null : undefined;
      const row = { email, user_id: au.id || null, invited_by: me.id, status: 'invited' };
      if (note !== undefined) row.note = note;
      const ins = await rest('invites?on_conflict=email', { method: 'POST', headers: { Prefer: 'resolution=merge-duplicates,return=representation' },
        body: JSON.stringify(row) });
      if (!ins.ok) throw new Error('Could not save the invite');
      return json({ ok: true, email, firstName: note || '', existed: !!au.last_sign_in_at, emailed: !!body.sendEmail });
    }

    if (body.action === 'set_name') {
      const name = String(body.firstName != null ? body.firstName : (body.note || '')).trim().slice(0, 80);
      const up = await rest(`invites?email=eq.${encodeURIComponent(email)}`, { method: 'PATCH', body: JSON.stringify({ note: name || null }) });
      if (!up.ok) throw new Error('Could not save the name');
      const rows = await up.json();
      if (!Array.isArray(rows) || !rows.length) return json({ error: 'Invite not found' }, 404);
      return json({ ok: true, email, firstName: name });
    }
    if (body.action === 'revoke' || body.action === 'restore') {
      if (email === normEmail(me.email)) return json({ error: 'You can\'t revoke your own access' }, 400);
      const au = await findUser(email);
      if (au) {
        const r = await f(`${base}/auth/v1/admin/users/${au.id}`, { method: 'PUT', headers: S,
          body: JSON.stringify({ ban_duration: body.action === 'revoke' ? '876000h' : 'none' }) });
        if (!r.ok) throw new Error('Could not update sign-in access');
      }
      let status = 'revoked';
      if (body.action === 'restore') {
        const cur = await rest(`invites?select=accepted_at&email=eq.${encodeURIComponent(email)}`);
        const row = cur.ok ? (await cur.json())[0] : null;
        status = (au && au.last_sign_in_at) || (row && row.accepted_at) ? 'accepted' : 'invited';
      }
      const up = await rest(`invites?email=eq.${encodeURIComponent(email)}`, { method: 'PATCH', body: JSON.stringify({ status }) });
      if (!up.ok) throw new Error('Could not update the invite');
      return json({ ok: true });
    }
    return json({ error: 'Unknown action' }, 400);
  } catch (e) { return json({ error: String(e && e.message || e) }, 500); }
}

const D = globalThis.Deno;
if (D && D.serve) D.serve((req) => handle(req, D.env.toObject()));
