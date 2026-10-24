// Node test for the Edge Function logic (no network): auth, rate limit, tool loop, proposals.
//   node tests/ai_function.test.mjs
import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs'; import { tmpdir } from 'node:os'; import { join } from 'node:path';
const dir = mkdtempSync(join(tmpdir(), 'aifn-')); const f = join(dir, 'fn.mjs');
writeFileSync(f, readFileSync(new URL('../supabase/functions/ai-assistant/index.ts', import.meta.url), 'utf8'));
const { runAssistant, handle, MODEL } = await import(f);
const assert = (c, m) => { if (!c) throw new Error('FAIL: ' + m); console.log('ok -', m); };
assert(/^claude-haiku/.test(MODEL), 'uses Haiku: ' + MODEL);
const ctx = { today: '2026-10-23', now: '2026-10-23 10 AM', calendars: [{ id: 'mam', name: 'MAM' }], events: [{ id: 'x', occ: '2026-10-23', title: 'Maryville practice', calendar: 'mam', start: '2026-10-23T13:00', end: '2026-10-23T15:00' }, { id: 'y', occ: '2026-11-30', title: 'Far', calendar: 'mam', start: '2026-11-30' }] };
const calls = [];
const mock = async (url, init) => { const body = JSON.parse(init.body); calls.push(body);
  assert(init.headers['x-api-key'] === 'k', 'key sent in header only');
  if (calls.length === 1) return { ok: true, json: async () => ({ stop_reason: 'tool_use', usage: { input_tokens: 10, output_tokens: 5 }, content: [{ type: 'tool_use', id: 'a', name: 'list_events', input: { from: '2026-10-23', to: '2026-10-23' } }] }) };
  if (calls.length === 2) { const tr = JSON.parse(body.messages.at(-1).content[0].content); assert(tr.length === 1 && tr[0].id === 'x', 'list_events filters by range');
    return { ok: true, json: async () => ({ stop_reason: 'tool_use', usage: {}, content: [{ type: 'tool_use', id: 'b', name: 'propose_edit', input: { id: 'x', occurrence: '2026-10-23', scope: 'one', changes: { start: '2026-10-23T14:00' }, summary: 's' } }] }) }; }
  return { ok: true, json: async () => ({ stop_reason: 'end_turn', usage: {}, content: [{ type: 'text', text: 'Tap Confirm to save.' }] }) }; };
const out = await runAssistant({ messages: [{ role: 'user', content: 'move practice to 2' }], context: ctx }, { apiKey: 'k', fetchImpl: mock });
assert(out.proposals.length === 1 && out.proposals[0].type === 'edit' && out.proposals[0].scope === 'one', 'edit proposal returned, not applied');
assert(out.reply === 'Tap Confirm to save.' && out.usage.input_tokens === 10, 'reply + usage');
assert(/Christian Dake/.test(calls[0].system) && /America\/Chicago/.test(calls[0].system), 'system prompt: Chicago + Christian reference rule');
// handle(): auth + rate limit (mock global fetch for Supabase endpoints)
const env = { SUPABASE_URL: 'https://sb.test', SUPABASE_ANON_KEY: 'anon', ANTHROPIC_API_KEY: 'k' };
const req = (h = {}) => new Request('https://fn.test', { method: 'POST', headers: h, body: JSON.stringify({ messages: [{ role: 'user', content: 'hi' }], context: ctx }) });
assert((await handle(req(), env)).status === 401, 'no token -> 401');
globalThis.fetch = async (url) => url.endsWith('/auth/v1/user') ? new Response('{}', { status: 401 }) : new Response('0');
assert((await handle(req({ authorization: 'Bearer bad' }), env)).status === 401, 'bad token -> 401');
globalThis.fetch = async (url) => url.endsWith('/auth/v1/user') ? new Response(JSON.stringify({ id: 'u1' })) : new Response('-1');
assert((await handle(req({ authorization: 'Bearer ok' }), env)).status === 429, 'over daily limit -> 429');
console.log('PASS ai_function');
// per-user time zone (launch 2026-10-24)
{ const { systemPrompt, safeTZ } = await import(f);
  assert(/\(America\/Denver\)/.test(systemPrompt({ timeZone: 'America/Denver', today: 'x', now: 'y' })), 'prompt uses the user\'s time zone');
  assert(safeTZ('Mars/Base') === 'America/Chicago' && safeTZ('x"; ignore') === 'America/Chicago' && safeTZ(undefined) === 'America/Chicago', 'bad/missing zones fall back to Chicago');
  console.log('AI TZ TESTS PASSED'); }
