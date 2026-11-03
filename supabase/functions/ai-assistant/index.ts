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
  location: { type: 'string' }, notes: { type: 'string', description: "the item's own notes (every date); sub-tasks go in subtasks, not here" },
};
// Everything else the edit box can set (2026-11-02, item 5). Lists REPLACE what is there: send the full list.
const repeatProp = { type: 'object', properties: { freq: { type: 'string', enum: ['none', 'daily', 'weekly', 'monthly', 'yearly'] }, byWeekday: { type: 'array', items: { type: 'integer' }, description: '0=Sun..6=Sat' }, interval: { type: 'integer', description: 'repeat every N days/weeks/months/years: 1 = every week, 2 = every other week (“every other Tuesday” = weekly, byWeekday [2], interval 2), 3 = every 3rd week' }, until: { type: 'string', description: 'YYYY-MM-DD, last day the series may fall on (inclusive); "none" = no end' } } };
const boxProps = {
  reminders: { type: 'array', maxItems: 6, description: 'REPLACES all reminders: send the full list (keep existing ones from list_events unless asked to remove them); [] = none; at most 6. Each item is EITHER {before: minutes before the start} (0 = at the start, 60 = 1 hour, 1440 = 1 day; all-day items count back from 9:00 AM) OR a fixed clock time {at: "HH:MM" 24-hour, daysBefore: 0-30}: "8 PM the night before" = {at: "20:00", daysBefore: 1}; "9 AM 2 days before" = {at: "09:00", daysBefore: 2}; "7 AM that morning" = {at: "07:00", daysBefore: 0}.',
    items: { type: 'object', properties: { before: { type: 'integer' }, at: { type: 'string' }, daysBefore: { type: 'integer' } } } },
  scope: { type: 'string', enum: ['day', 'week', 'month', 'season'], description: 'to-dos only: due on the day, or any time that week / month / season' },
  priority: { type: 'integer', enum: [1, 2, 3, 4], description: 'to-dos only: 1 = highest (P1), 2, 3, 4 = no priority' },
  todoCategory: { type: 'string', description: 'to-dos only: a to-do category id or name from the To-do categories list; "" = none' },
  subtasks: { type: 'array', items: { type: 'string' }, description: 'sub-task checklist, REPLACES the list: send the full list in order (keep existing ones unless asked to remove them); [] = none' },
  dayNote: { type: 'string', description: "this date's own note (the Today's Note for that one date, not the item's notes); REPLACES it; '' deletes it" },
  notionUrl: { type: 'string', description: "this date's Notion page link (https://www.notion.so/...); '' removes it" },
};
export const TOOLS = [
  { name: 'list_events', description: 'List the user\'s event occurrences overlapping a date range (inclusive, the user\'s local dates). Optional text filter on title/category/location. REQUIRED (for every date involved, in this request) before saying any time is free, open or available, or suggesting a time. Rows with referenceOnly=true (Christian Dake) never count as conflicts.',
    input_schema: { type: 'object', properties: { from: { type: 'string', description: 'YYYY-MM-DD' }, to: { type: 'string', description: 'YYYY-MM-DD' }, query: { type: 'string' } }, required: ['from', 'to'] } },
  { name: 'propose_add', description: 'Propose a NEW event or to-do. Not saved until the user confirms. For a to-do set kind="task" and allDay=true unless a time is given.',
    input_schema: { type: 'object', properties: { ...evProps, ...boxProps, kind: { type: 'string', enum: ['event', 'task'] },
      repeat: repeatProp,
      summary: { type: 'string', description: 'one short human sentence describing the change' } }, required: ['title', 'calendar', 'start', 'summary'] } },
  { name: 'propose_edit', description: 'Propose changing an existing event or to-do: anything the edit box can set. Use id and occurrence (the date key) from list_events. scope "one" changes only that occurrence of a repeating item, "all" changes the series. Only include fields that change. kind switches it between event and to-do; calendar, kind and repeat on a repeating item need scope "all" (a whole series moves to another calendar with its changed dates). dayNote and notionUrl belong to the occurrence date whatever the scope.',
    input_schema: { type: 'object', properties: { id: { type: 'string' }, occurrence: { type: 'string' }, scope: { type: 'string', enum: ['one', 'all'] }, changes: { type: 'object', properties: { ...evProps, ...boxProps, kind: { type: 'string', enum: ['event', 'task'] }, repeat: repeatProp } }, summary: { type: 'string' } }, required: ['id', 'occurrence', 'changes', 'summary'] } },
  { name: 'propose_delete', description: 'Propose deleting an event (scope "one" = just that occurrence of a repeating event).',
    input_schema: { type: 'object', properties: { id: { type: 'string' }, occurrence: { type: 'string' }, scope: { type: 'string', enum: ['one', 'all'] }, summary: { type: 'string' } }, required: ['id', 'occurrence', 'summary'] } },
  { name: 'list_series', description: 'List the user\'s REPEATING event series (id, title, rule such as "Tuesdays", time, location, next dates, skipped/changed dates). Optional text filter.',
    input_schema: { type: 'object', properties: { query: { type: 'string' } } } },
  { name: 'propose_series_change', description: [
    'Propose a change to a REPEATING series in one confirm card (the app shows exactly what changes; nothing is saved until the user confirms). id = the series id from list_series (or list_events).',
    'action "split": from date `from` on, the series follows `changes`; earlier dates stay exactly as they are. Use for "starting in 2 weeks / from Dec 1 on / going forward, move X to Thursday 7 PM". `from` is the date the change starts (e.g. today + 14 days for "in 2 weeks"); give only what changes: start/end as HH:MM (24h), weekdays (0=Sun..6=Sat) to change the day, freq/interval, until, title, location.',
    'action "exceptions": change only specific dates, rest of the series unchanged. items: [{date, skip: true}] cancels that date; [{date, start, end?, title?, location?}] moves/retimes it (start/end HH:MM on the same day, or YYYY-MM-DDTHH:MM to move it to another day). Several dates go in ONE call.',
    'action "replace": cancel the occurrence on `date` and add a one-off event `replacement` {title, start, end?, minutes?, location?, category?, calendar?, notes?} (start/end HH:MM on that day). It keeps the series\' calendar, category, location and reminders unless given. Use for "remove/cancel X on <date> and replace it with Y at 2pm".',
    'action "until": set, extend, shorten or remove the series\' end date; `until` = YYYY-MM-DD (inclusive) or "none" to repeat with no end. Use for "continue until July 2027" (until = the last day of that month, 2027-07-31), "end it after Dec 15", "keep it going forever". Days, time and everything else stay the same.',
    'Every date must be one of the series\' dates (not needed for "until"). If the date is not one, or more than one series could match, ask the user instead of guessing.'].join(' '),
    input_schema: { type: 'object', properties: {
      id: { type: 'string' }, action: { type: 'string', enum: ['split', 'exceptions', 'replace', 'until'] },
      until: { type: 'string', description: 'until: YYYY-MM-DD or "none"' },
      from: { type: 'string', description: 'split: YYYY-MM-DD' },
      changes: { type: 'object', properties: { start: { type: 'string' }, end: { type: 'string' }, minutes: { type: 'integer' }, weekdays: { type: 'array', items: { type: 'integer' } }, freq: { type: 'string', enum: ['daily', 'weekly', 'monthly', 'yearly'] }, interval: { type: 'integer' }, until: { type: 'string' }, title: { type: 'string' }, location: { type: 'string' }, category: { type: 'string' }, notes: { type: 'string' } } },
      items: { type: 'array', items: { type: 'object', properties: { date: { type: 'string' }, skip: { type: 'boolean' }, start: { type: 'string' }, end: { type: 'string' }, title: { type: 'string' }, location: { type: 'string' } }, required: ['date'] } },
      date: { type: 'string', description: 'replace: YYYY-MM-DD of the occurrence to cancel' },
      replacement: { type: 'object', properties: { title: { type: 'string' }, start: { type: 'string' }, end: { type: 'string' }, minutes: { type: 'integer' }, location: { type: 'string' }, category: { type: 'string' }, calendar: { type: 'string' }, notes: { type: 'string' } } },
      summary: { type: 'string' } }, required: ['id', 'action', 'summary'] } },
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
    ...todoCatLines(ctx),
    'Edit box: propose_add and propose_edit can set everything the edit box can: title, calendar, category, time, location, notes, repeat, reminders (up to 6: "X before" or a fixed clock time such as 8 PM the night before), event vs to-do, and for to-dos the scope (day/week/month/season), priority, to-do category and sub-tasks, plus a date\'s own note and Notion link. list_events shows the current reminders, sub-tasks, notes and links; lists you send replace the old ones.',
    'Use list_events to look things up before answering or editing. To change anything, call the propose_* tools — they do NOT save; the user sees a confirm card for each and taps Confirm. Never claim something is saved; say "tap Confirm to save".',
    'Ask one short question if the request is ambiguous (e.g. which calendar). Pick the most likely calendar from context when reasonable.',
    'Repeating events: use list_series to find the series. For changes to a series from a date on, to several specific dates, or replacing one date with a different event, use propose_series_change (one card per request). Resolve relative dates yourself from today (e.g. "in 2 weeks" = today + 14 days; "Nov. 2nd" = the next Nov 2). If two or more series could match (e.g. two "practice" series), or the date is not one of the series\' dates, ask one short question (list the options with day and time) before proposing.',
    'Repeat intervals: "every other week/Tuesday" = weekly with interval 2; "every 3 weeks" = interval 3; "every other month" = monthly interval 2. Always set interval when it is not 1.',
    'Replies: a user message may start with `Replying to: “…”` and a blank line. That quote is an earlier message of yours the user picked to answer; read their words as a reply to it ("yes", "the second one", "move it" refer to what that quoted message is about), even if newer messages came after it.',
    ...savedLines(ctx),
    'Events whose title mentions Christian Dake are reference only (another person\'s schedule): never call them conflicts.',
    'Availability: before you say any day or time is free, open, clear or available, or suggest a time (e.g. "how about 3 PM"), call list_events for every date involved in THIS request, even if you looked earlier in the chat. Only events from list_events count; referenceOnly rows (Christian Dake) are never conflicts. If list_events says a date is not loaded, say you cannot see that date instead of calling it free.',
    'Be brief and warm. Plain text, no markdown tables. Use 12-hour times like 3:30 PM.',
  ].join('\n');
}

/** To-do categories (id = name) for propose_* todoCategory. */
export function todoCatLines(ctx) {
  const clip = (v, n = 40) => String(v == null ? '' : v).replace(/[\r\n\u2028\u2029]+/g, ' ').slice(0, n);
  const c = (Array.isArray(ctx.todoCategories) ? ctx.todoCategories : []).filter(x => x && typeof x.id === 'string' && /^[\w-]{1,64}$/.test(x.id)).slice(0, 40);
  return c.length ? [`To-do categories: ${c.map(x => `${clip(x.id, 64)} = ${clip(x.name)}`).join('; ')}.`] : [];
}

/** SI memory (t179u item 3): items the user confirmed earlier in this chat (sent by the app, refreshed from their data). */
export function savedLines(ctx) {
  const clip = (v, n = 80) => String(v == null ? '' : v).replace(/[\r\n\u2028\u2029]+/g, ' ').slice(0, n);
  const rows = (Array.isArray(ctx.saved) ? ctx.saved : []).filter(x => x && typeof x.id === 'string' && /^[\w-]{1,64}$/.test(x.id)).slice(-10);
  if (!rows.length) return [];
  return ['Saved earlier in this chat (oldest first; the LAST one is what "it", "that" or "the series" most likely means in a follow-up such as "actually continue until July 2027" or "make it 7 PM"). Use these ids directly; for a series use propose_series_change with this id:',
    ...rows.map(x => `- [id ${clip(x.id, 64)}] "${clip(x.title)}" (${clip(x.kind || 'event', 10)}): ${clip(x.rule)}${x.time ? ', ' + clip(x.time, 30) : ''}, from ${clip(x.start, 10)}${x.until ? (x.until === 'none' ? ', no end date' : ', until ' + clip(x.until, 10)) : ''}${x.removed ? ' (since deleted or undone)' : ''}`)];
}

function listEvents(ctx, { from, to, query }) {
  const rows = listRows(ctx, { from, to, query });
  const r = ctx.eventsRange;
  if (r && ISO.test(r.from) && ISO.test(r.to) && ((from || '0000') < r.from || (to || '9999') > r.to))
    return { events: rows, notLoaded: `Only ${r.from} to ${r.to} is loaded. Dates outside that are unknown (NOT free); say you cannot see them.` };
  return rows;
}

function listRows(ctx, { from, to, query }) {
  const q = (query || '').toLowerCase();
  const rows = (ctx.events || []).filter(e => e.occ <= (to || '9999') && (e.endDay || e.occ) >= (from || '0000'))
    .filter(e => !q || `${e.title} ${e.category || ''} ${e.location || ''} ${e.calendar}`.toLowerCase().includes(q));
  return rows.slice(0, 120);
}

export function listSeries(ctx, { query }) {
  const q = (query || '').toLowerCase().trim();
  const words = q.split(/\s+/).filter(w => w.length > 2);
  return (ctx.series || []).filter(e => !q || words.every(w => `${e.title} ${e.category || ''} ${e.location || ''}`.toLowerCase().includes(w)) || `${e.title}`.toLowerCase().includes(q)).slice(0, 40);
}

const ISO = /^\d{4}-\d{2}-\d{2}$/;
const DAYMS = 86400000;
const isoOf = (t) => new Date(t).toISOString().slice(0, 10);
const WD = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
const MON = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];

/** Does a reply say a time is free/open/available, or suggest a time? (server-side availability guard) */
export function claimsAvailability(text) {
  const t = String(text || '').replace(/feel free|free of charge|free to ask/gi, ' ');
  return /\b(?:is|are|'s|looks?|seems?|stays?|be|you're|you are|you'd be|you’re)\s+(?:still\s+|completely\s+|totally\s+|wide\s+|pretty\s+|mostly\s+|all\s+|fully\s+)?(?:free|open|clear|available)\b/i.test(t)
    || /\b(?:free|open|available)\s+(?:on|at|from|between|after|before|until|all\s+day|that|this|today|tomorrow|tonight|then|slot|slots|time|window|block|spot|morning|afternoon|evening)\b/i.test(t)
    || /\b(?:free|open)\s+(?:slot|time|window|block|spot)s?\b/i.test(t)
    || /\bnothing\s+(?:else\s+)?(?:is\s+)?(?:scheduled|planned|booked|on your)\b/i.test(t)
    || /\bno\s+(?:other\s+)?(?:conflicts?|clashes|events|plans)\b/i.test(t)
    || /\b(?:how about|what about|i(?:'d| would)? suggest|you could|good time|best time|works? well)\b[^.?!\n]{0,50}\b\d{1,2}(?::\d{2})?\s*(?:am|pm|a\.m\.|p\.m\.)/i.test(t);
}

/** Dates a reply talks about (ISO, today/tomorrow/tonight, weekday names, "Nov 8", "11/8"). Each item is a list of acceptable YYYY-MM-DD keys. */
export function mentionedDates(text, today) {
  if (!ISO.test(String(today || ''))) return [];
  const t0 = Date.parse(today + 'T00:00:00Z'); const t = String(text || '').toLowerCase(); const out = [];
  for (const m of t.matchAll(/\b(\d{4}-\d{2}-\d{2})\b/g)) out.push([m[1]]);
  if (/\b(today|tonight|this (?:morning|afternoon|evening))\b/.test(t)) out.push([today]);
  if (/\btomorrow\b/.test(t)) out.push([isoOf(t0 + DAYMS)]);
  const dow = new Date(t0).getUTCDay();
  for (const m of t.matchAll(/\b(next\s+)?(sunday|monday|tuesday|wednesday|thursday|friday|saturday)s?\b/g)) {
    const d = (WD.indexOf(m[2]) - dow + 7) % 7; const a = isoOf(t0 + d * DAYMS), b = isoOf(t0 + (d + 7) * DAYMS);
    out.push(m[1] ? [b, a] : [a, b]);
  }
  const yr = +today.slice(0, 4);
  const md = (mo, d) => { if (mo < 0 || mo > 11 || d < 1 || d > 31) return; let k = Date.UTC(yr, mo, d); if (k < t0 - 60 * DAYMS) k = Date.UTC(yr + 1, mo, d); out.push([isoOf(k)]); };
  for (const m of t.matchAll(/\b(jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\.?\s+(\d{1,2})(?:st|nd|rd|th)?\b/g)) md(MON.indexOf(m[1].slice(0, 3)), +m[2]);
  for (const m of t.matchAll(/(?<![\d:])(\d{1,2})\/(\d{1,2})(?![\d\/])/g)) md(+m[1] - 1, +m[2]);
  return out;
}

/** Which mentioned dates no list_events call covered in this request. covered = [[from, to], ...]. */
export function uncheckedDates(text, today, covered) {
  if (!covered.length) return ['(any)'];
  const inside = (k) => covered.some(([f, to]) => k >= f && k <= to);
  return mentionedDates(text, today).filter(alts => !alts.some(inside)).map(alts => alts[0]);
}

const PROPOSAL_TOOLS = { propose_add: 'add', propose_edit: 'edit', propose_delete: 'delete', propose_check: 'check' };

/** Core loop. fetchImpl lets tests inject a mock Anthropic. Returns {reply, proposals, usage}. */
export async function runAssistant({ messages, context }, { apiKey, fetchImpl = fetch, model = MODEL }) {
  const msgs = (messages || []).filter(m => m && (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string' && m.content.trim())
    .slice(-12).map(m => ({ role: m.role, content: m.content.slice(0, 4000) }));
  if (!msgs.length || msgs[msgs.length - 1].role !== 'user') throw new Error('last message must be from the user');
  const proposals = []; const usage = { input_tokens: 0, output_tokens: 0 }; let reply = '';
  const covered = []; let nudged = false; let unverified = false; const today = (context && context.today) || '';
  for (let turn = 0; turn < MAX_TURNS + (nudged ? 1 : 0); turn++) {
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
    if (data.stop_reason !== 'tool_use' || !uses.length) {
      // Availability guard: no "free/open/available" (or a suggested time) unless list_events covered those dates in THIS request.
      const miss = text && claimsAvailability(text) ? uncheckedDates(text, today, covered) : [];
      unverified = miss.length > 0;
      if (!unverified || nudged || turn >= MAX_TURNS) break;
      nudged = true;
      msgs.push({ role: 'assistant', content: data.content });
      msgs.push({ role: 'user', content: `[App check, not from the user] Your reply says a time is free, open or available, or suggests a time, but list_events was not called in this request for ${miss[0] === '(any)' ? 'the dates involved' : miss.join(', ')}. Call list_events for those dates now (referenceOnly / Christian Dake rows never count as conflicts), then give your full answer again. Do not mention this check.` });
      continue;
    }
    msgs.push({ role: 'assistant', content: data.content });
    msgs.push({ role: 'user', content: uses.map(u => {
      let out;
      if (u.name === 'list_events') { const i = u.input || {}; covered.push([ISO.test(i.from) ? i.from : '0000', ISO.test(i.to) ? i.to : '9999']); out = listEvents(context || {}, i); }
      else if (u.name === 'list_series') out = listSeries(context || {}, u.input || {});
      else if (u.name === 'propose_series_change') { proposals.push({ type: 'series', ...(u.input || {}) }); out = { ok: true, status: 'shown to the user with a preview of every date that changes (not saved yet)' }; }
      else if (PROPOSAL_TOOLS[u.name]) { proposals.push({ type: PROPOSAL_TOOLS[u.name], ...(u.input || {}) }); out = { ok: true, status: 'shown to the user for confirmation (not saved yet)' }; }
      else out = { error: 'unknown tool' };
      return { type: 'tool_result', tool_use_id: u.id, content: JSON.stringify(out) };
    }) });
  }
  if (unverified && reply) reply += '\n\n(I could not double-check your calendar for that, so please take a quick look before you rely on it.)';
  return { reply: reply || (proposals.length ? 'Tap Confirm to save.' : 'Sorry, I could not do that.'), proposals, usage, lookups: covered.length, ...(nudged ? { availabilityCheck: unverified ? 'unverified' : 'rechecked' } : {}) };
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
