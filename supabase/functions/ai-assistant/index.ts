// SANDY AI assistant (Phase 1) — Supabase Edge Function "ai-assistant".
// - Verifies the caller's Supabase JWT (auth/v1/user) and rate-limits per user per day (rpc ai_bump_usage, RLS-scoped).
// - Calls the Anthropic Messages API with tool use. The model can READ the caller's events (sent by the
//   signed-in app, which only ever loads that user's rows under RLS) and PROPOSE changes. It never writes:
//   proposals go back to the app, which shows a confirm card and saves under the user's own session.
// - Secrets: ANTHROPIC_API_KEY (function secret). SUPABASE_URL / SUPABASE_ANON_KEY are provided by Supabase.
// Dependency-free on purpose (plain fetch), so the same file runs under Node for local tests.

export const MODEL = 'claude-haiku-5-5';
export const DAILY_LIMIT = 50;
const MAX_TURNS = 5;
const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const evProps = {
  title: { type: 'string' }, calendar: { type: 'string', description: 'calendar id, e.g. msc, mam, lifetime' },
  category: { type: 'string' }, allDay: { type: 'boolean' },
  start: { type: 'string', description: "the user's local wall clock: 'YYYY-MM-DDTHH:MM' (timed) or 'YYYY-MM-DD' (all-day)" },
  end: { type: 'string', description: "same format as start; all-day end is the inclusive last day" },
  location: { type: 'string' }, notes: { type: 'string' },
};
export const TOOLS = [
  { name: 'list_events', description: 'List the user\'s event occurrences overlapping a date range (inclusive, the user\'s local dates). Optional text filter on title/category/location.',
    input_schema: { type: 'object', properties: { from: { type: 'string', description: 'YYYY-MM-DD' }, to: { type: 'string', description: 'YYYY-MM-DD' }, query: { type: 'string' } }, required: ['from', 'to'] } },
  { name: 'propose_add', description: 'Propose a NEW event or to-do. Not saved until the user confirms. For a to-do set kind="task" and allDay=true unless a time is given.',
    input_schema: { type: 'object', properties: { ...evProps, kind: { type: 'string', enum: ['event', 'task'] },
      repeat: { type: 'object', properties: { freq: { type: 'string', enum: ['none', 'daily', 'weekly', 'monthly', 'yearly'] }, byWeekday: { type: 'array', items: { type: 'integer' }, description: '0=Sun..6=Sat' }, until: { type: 'string' } } },
      summary: { type: 'string', description: 'one short human sentence describing the change' } }, required: ['title', 'calendar', 'start', 'summary'] } },
  { name: 'propose_edit', description: 'Propose changing an existing event. Use id and occurrence (the date key) from list_events. scope "one" changes only that occurrence of a repeating event, "all" changes the series. Only include fields that change.',
    input_schema: { type: 'object', properties: { id: { type: 'string' }, occurrence: { type: 'string' }, scope: { type: 'string', enum: ['one', 'all'] }, changes: { type: 'object', properties: evProps }, summary: { type: 'string' } }, required: ['id', 'occurrence', 'changes', 'summary'] } },
  { name: 'propose_delete', description: 'Propose deleting an event (scope "one" = just that occurrence of a repeating event).',
    input_schema: { type: 'object', properties: { id: { type: 'string' }, occurrence: { type: 'string' }, scope: { type: 'string', enum: ['one', 'all'] }, summary: { type: 'string' } }, required: ['id', 'occurrence', 'summary'] } },
  { name: 'propose_check', description: 'Propose checking off (done=true) or un-checking a to-do occurrence.',
    input_schema: { type: 'object', properties: { id: { type: 'string' }, occurrence: { type: 'string' }, done: { type: 'boolean' }, summary: { type: 'string' } }, required: ['id', 'occurrence', 'done', 'summary'] } },
];

/** The user's IANA time zone from the app context; anything odd falls back to America/Chicago. */
export function safeTZ(z) {
  if (typeof z !== 'string' || !/^[A-Za-z_]+(\/[A-Za-z0-9_+\-]+){0,2}$/.test(z) || z.length > 64) return 'America/Chicago';
  try { new Intl.DateTimeFormat('en-US', { timeZone: z }); return z; } catch { return 'America/Chicago'; }
}

export function systemPrompt(ctx) {
  const cals = (ctx.calendars || []).map(c => `${c.id} = ${c.name}`).join('; ');
  const tz = safeTZ(ctx.timeZone);
  return [
    `You are Sandy Intelligence, the assistant inside SANDY, a calendar and planning app. If asked your name, say Sandy Intelligence. Today is ${ctx.today} and it is now ${ctx.now} (${tz}). All times are ${tz} wall-clock times.`,
    `Calendars: ${cals}.`,
    'Use list_events to look things up before answering or editing. To change anything, call the propose_* tools — they do NOT save; the user sees a confirm card for each and taps Confirm. Never claim something is saved; say "tap Confirm to save".',
    'Ask one short question if the request is ambiguous (e.g. which calendar). Pick the most likely calendar from context when reasonable.',
    'Events whose title mentions Christian Dake are reference only (another person\'s schedule): never call them conflicts.',
    'Be brief and warm. Plain text, no markdown tables. Use 12-hour times like 3:30 PM.',
  ].join('\n');
}

function listEvents(ctx, { from, to, query }) {
  const q = (query || '').toLowerCase();
  const rows = (ctx.events || []).filter(e => e.occ <= (to || '9999') && (e.endDay || e.occ) >= (from || '0000'))
    .filter(e => !q || `${e.title} ${e.category || ''} ${e.location || ''} ${e.calendar}`.toLowerCase().includes(q));
  return rows.slice(0, 120);
}

const PROPOSAL_TOOLS = { propose_add: 'add', propose_edit: 'edit', propose_delete: 'delete', propose_check: 'check' };

/** Core loop. fetchImpl lets tests inject a mock Anthropic. Returns {reply, proposals, usage}. */
export async function runAssistant({ messages, context }, { apiKey, fetchImpl = fetch, model = MODEL }) {
  const msgs = (messages || []).filter(m => m && (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string' && m.content.trim())
    .slice(-12).map(m => ({ role: m.role, content: m.content.slice(0, 4000) }));
  if (!msgs.length || msgs[msgs.length - 1].role !== 'user') throw new Error('last message must be from the user');
  const proposals = []; const usage = { input_tokens: 0, output_tokens: 0 }; let reply = '';
  for (let turn = 0; turn < MAX_TURNS; turn++) {
    const r = await fetchImpl('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({ model, max_tokens: 1024, system: systemPrompt(context || {}), tools: TOOLS, messages: msgs }),
    });
    const data = await r.json();
    if (!r.ok) throw new Error('AI provider error: ' + ((data && data.error && data.error.message) || r.status));
    usage.input_tokens += data.usage?.input_tokens || 0; usage.output_tokens += data.usage?.output_tokens || 0;
    const text = (data.content || []).filter(b => b.type === 'text').map(b => b.text).join('\n').trim();
    if (text) reply = text;
    const uses = (data.content || []).filter(b => b.type === 'tool_use');
    if (data.stop_reason !== 'tool_use' || !uses.length) break;
    msgs.push({ role: 'assistant', content: data.content });
    msgs.push({ role: 'user', content: uses.map(u => {
      let out;
      if (u.name === 'list_events') out = listEvents(context || {}, u.input || {});
      else if (PROPOSAL_TOOLS[u.name]) { proposals.push({ type: PROPOSAL_TOOLS[u.name], ...(u.input || {}) }); out = { ok: true, status: 'shown to the user for confirmation (not saved yet)' }; }
      else out = { error: 'unknown tool' };
      return { type: 'tool_result', tool_use_id: u.id, content: JSON.stringify(out) };
    }) });
  }
  return { reply: reply || (proposals.length ? 'Tap Confirm to save.' : 'Sorry, I could not do that.'), proposals, usage };
}

const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...CORS, 'content-type': 'application/json' } });

export async function handle(req, env) {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405);
  const auth = req.headers.get('authorization') || '';
  if (!/^Bearer\s+\S+/.test(auth)) return json({ error: 'Sign in required' }, 401);
  const base = env.SUPABASE_URL; const anon = env.SUPABASE_ANON_KEY;
  const u = await fetch(`${base}/auth/v1/user`, { headers: { authorization: auth, apikey: anon } });
  if (!u.ok) return json({ error: 'Sign in required' }, 401);
  const user = await u.json(); if (!user || !user.id) return json({ error: 'Sign in required' }, 401);
  const rl = await fetch(`${base}/rest/v1/rpc/ai_bump_usage`, { method: 'POST', headers: { authorization: auth, apikey: anon, 'content-type': 'application/json' }, body: JSON.stringify({ daily_limit: DAILY_LIMIT }) });
  if (!rl.ok) return json({ error: 'Usage check failed' }, 500);
  const n = await rl.json();
  if (n === -1) return json({ error: `Daily AI limit reached (${DAILY_LIMIT} requests). It resets at midnight in your time zone.` }, 429);
  let body; try { body = await req.json(); } catch { return json({ error: 'Bad JSON' }, 400); }
  if (JSON.stringify(body).length > 200000) return json({ error: 'Request too large' }, 413);
  try {
    const out = await runAssistant(body, { apiKey: env.ANTHROPIC_API_KEY });
    return json({ ...out, used: n, limit: DAILY_LIMIT });
  } catch (e) { return json({ error: String(e && e.message || e) }, 502); }
}

const D = globalThis.Deno;
if (D && D.serve) D.serve((req) => handle(req, D.env.toObject()));
