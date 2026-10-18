/*
 * storage.js: the only code that touches storage.
 *
 * The app talks to `window.Store` (async API, in-memory cache + adapter).
 *   - LocalStorageAdapter: this device/browser only (used when config.js is empty).
 *   - SupabaseAdapter: shared Postgres via Supabase (used when config.js has
 *     SUPABASE_URL + SUPABASE_ANON_KEY). Requires Scott to sign in (magic link).
 *
 * Event model used by the app (times are America/Chicago wall clock, no offset):
 *   { id, kind:'event'|'task', calendar:'msc'|'mam'|'lifetime', category, title,
 *     allDay, start:'YYYY-MM-DD[THH:MM]', end (all-day: inclusive date),
 *     recurrence:{freq:'none'|'daily'|'weekly'|'monthly'|'yearly', interval, until, byWeekday:[0-6]},
 *     exdates:[date], seriesId, originalDate,  // single-occurrence exceptions
 *     scope, done, completedDates:[date], location, notes, example, createdAt, updatedAt }
 */
(function () {
  'use strict';
  const KEY = 'scottcal.events.v1';
  const SETTINGS_KEY = 'scottcal.settings.v1';
  const CATS_KEY = 'scottcal.categories.v1';
  const MIGRATED_KEY = 'scottcal.migratedToSupabase.v1';
  const CFG = window.CALENDAR_CONFIG || {};

  const uid = () => (crypto.randomUUID ? crypto.randomUUID()
    : 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => { const r = Math.random() * 16 | 0; return (c === 'x' ? r : (r & 3 | 8)).toString(16); }));
  const isUuid = s => typeof s === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s);
  const readJSON = (k, dflt) => { try { const r = localStorage.getItem(k); return r ? JSON.parse(r) : dflt; } catch { return dflt; } };

  // Per-device UI settings (visible calendars, task tab) always stay in localStorage.
  const deviceSettings = {
    async loadSettings() { return readJSON(SETTINGS_KEY, {}); },
    async saveSettings(s) { localStorage.setItem(SETTINGS_KEY, JSON.stringify(s)); },
  };

  // ------------------------------------------------------------------ localStorage
  const LocalStorageAdapter = {
    name: 'local',
    label: 'localStorage',
    async loadAll() { return readJSON(KEY, null); }, // null = never initialised
    async writeAll(events) { localStorage.setItem(KEY, JSON.stringify(events)); },
    async loadCategories() {
      let cats = readJSON(CATS_KEY, null);
      if (!cats) { // older versions kept custom categories inside settings
        cats = (readJSON(SETTINGS_KEY, {}).customCategories) || {};
        localStorage.setItem(CATS_KEY, JSON.stringify(cats));
      }
      return cats;
    },
    async addCategory(cal, name) {
      const cats = await this.loadCategories();
      (cats[cal] ||= []).includes(name) || cats[cal].push(name);
      localStorage.setItem(CATS_KEY, JSON.stringify(cats));
    },
    ...deviceSettings,
  };

  // ------------------------------------------------------------------ Supabase
  const toDbTs = (s, allDay) => (allDay ? s.slice(0, 10) + 'T00:00:00' : (s.length === 16 ? s + ':00' : s));
  const fromDbTs = (s, allDay) => (s == null ? null : allDay ? s.slice(0, 10) : s.slice(0, 16));

  function toRow(ev) {
    const r = ev.recurrence || { freq: 'none' };
    const freq = r.freq || 'none';
    const isTask = ev.kind === 'task';
    return {
      id: ev.id, calendar: ev.calendar, category: ev.category || 'Other', title: ev.title,
      all_day: !!ev.allDay, start_at: toDbTs(ev.start, ev.allDay), end_at: ev.end ? toDbTs(ev.end, ev.allDay) : null,
      recur_freq: freq, recur_interval: Math.max(1, +r.interval || 1), recur_until: freq === 'none' ? null : (r.until || null),
      recur_by_weekday: freq === 'weekly' && r.byWeekday && r.byWeekday.length ? r.byWeekday.map(Number) : null,
      exdates: ev.exdates || [],
      series_id: ev.seriesId || null, original_date: ev.seriesId ? ev.originalDate : null,
      location: ev.location || '', notes: ev.notes || '',
      is_task: isTask, task_scope: isTask ? (ev.scope || 'day') : null,
      done: !!ev.done, completed_dates: ev.completedDates || [],
      example: !!ev.example, source: 'app',
    };
  }
  function fromRow(row) {
    const ev = {
      id: row.id, kind: row.is_task ? 'task' : 'event', calendar: row.calendar, category: row.category, title: row.title,
      allDay: row.all_day, start: fromDbTs(row.start_at, row.all_day), end: fromDbTs(row.end_at, row.all_day),
      recurrence: row.recur_freq === 'none' ? { freq: 'none' } : {
        freq: row.recur_freq, interval: row.recur_interval || 1, until: row.recur_until || null,
        byWeekday: row.recur_freq === 'weekly' ? (row.recur_by_weekday || undefined) : undefined,
      },
      exdates: row.exdates || [], location: row.location || '', notes: row.notes || '',
      example: !!row.example, source: row.source, createdAt: row.created_at, updatedAt: row.updated_at,
    };
    if (row.series_id) { ev.seriesId = row.series_id; ev.originalDate = row.original_date; }
    if (row.is_task) {
      ev.scope = row.task_scope || 'day';
      if (row.recur_freq === 'none') ev.done = !!row.done; else ev.completedDates = row.completed_dates || [];
    }
    return ev;
  }

  function SupabaseAdapter(url, anonKey) {
    if (!window.supabase || !window.supabase.createClient) throw new Error('vendor/supabase.min.js did not load');
    const sb = window.supabase.createClient(url, anonKey, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
    });
    const must = ({ data, error }) => { if (error) throw new Error(error.message || String(error)); return data; };
    return {
      name: 'supabase',
      label: 'Supabase (shared: phone, laptop and bots)',
      client: sb,
      async loadAll() {
        const out = []; const page = 1000;
        for (let from = 0; ; from += page) {
          const rows = must(await sb.from('events').select('*').order('start_at').range(from, from + page - 1));
          out.push(...rows.map(fromRow));
          if (rows.length < page) return out;
        }
      },
      async upsertMany(events) {
        if (!events.length) return [];
        // parents before exceptions so the series_id foreign key is satisfied
        const sorted = [...events].sort((a, b) => (a.seriesId ? 1 : 0) - (b.seriesId ? 1 : 0));
        const saved = [];
        for (let i = 0; i < sorted.length; i += 500) {
          const rows = must(await sb.from('events').upsert(sorted.slice(i, i + 500).map(toRow)).select());
          saved.push(...rows.map(fromRow));
        }
        return saved;
      },
      async removeMany(ids) {
        for (let i = 0; i < ids.length; i += 200) must(await sb.from('events').delete().in('id', ids.slice(i, i + 200)));
      },
      async loadCategories() {
        const rows = must(await sb.from('categories').select('calendar,name').order('name'));
        const cats = {};
        for (const r of rows) (cats[r.calendar] ||= []).push(r.name);
        return cats;
      },
      async addCategory(cal, name) {
        must(await sb.from('categories').upsert({ calendar: cal, name }, { onConflict: 'calendar,name', ignoreDuplicates: true }));
      },
      subscribe(onChange) {
        const ch = sb.channel('calendar-changes')
          .on('postgres_changes', { event: '*', schema: 'public', table: 'events' }, p => onChange('events', p))
          .on('postgres_changes', { event: '*', schema: 'public', table: 'categories' }, p => onChange('categories', p))
          .subscribe();
        return () => sb.removeChannel(ch);
      },
      fromRow,
      ...deviceSettings,
    };
  }

  // ------------------------------------------------------------------ Store
  function createStore(adapter) {
    let cache = null;
    let cats = null;
    const listeners = new Set();
    const remote = adapter.name !== 'local';
    const emit = (why) => listeners.forEach(fn => { try { fn(why); } catch (e) { console.error(e); } });
    async function ensure() { if (cache === null) cache = (await adapter.loadAll()) || []; return cache; }
    function put(ev) { const i = cache.findIndex(e => e.id === ev.id); if (i >= 0) cache[i] = ev; else cache.push(ev); }
    async function writeLocal() { if (!remote) await adapter.writeAll(cache); }
    const stamp = ev => { const now = new Date().toISOString(); if (!ev.id) { ev.id = uid(); ev.createdAt = now; } ev.updatedAt = now; return ev; };

    async function upsertMany(evs) {
      await ensure();
      evs.forEach(stamp);
      if (remote) { const saved = await adapter.upsertMany(evs); saved.forEach(put); return saved; }
      evs.forEach(put); await writeLocal(); return evs;
    }
    async function removeIds(ids) {
      await ensure();
      const set = new Set(ids);
      cache.filter(e => e.seriesId && set.has(e.seriesId)).forEach(e => set.add(e.id)); // exceptions go with their series
      if (remote) await adapter.removeMany([...set]);
      cache = cache.filter(e => !set.has(e.id));
      await writeLocal();
    }

    const store = {
      mode: adapter.name,
      adapterName: adapter.label,
      adapter,
      async isInitialised() { return remote ? true : (await adapter.loadAll()) !== null; },
      async list() { return [...(await ensure())]; },
      async get(id) { return (await ensure()).find(e => e.id === id) || null; },
      async save(ev) { return (await upsertMany([ev]))[0]; },
      saveMany: upsertMany,
      async remove(id) { await removeIds([id]); },
      async removeWhere(pred) { const ids = (await ensure()).filter(pred).map(e => e.id); if (ids.length) await removeIds(ids); return ids.length; },
      async replaceAll(events) {
        await ensure();
        if (remote) {
          const keep = new Set(events.map(e => e.id));
          const gone = cache.filter(e => !keep.has(e.id)).map(e => e.id);
          if (gone.length) await adapter.removeMany(gone);
          cache = cache.filter(e => keep.has(e.id));
          await upsertMany(events);
        } else { cache = [...events]; await writeLocal(); }
      },
      /** Re-read everything from the backend (realtime / tab focus). */
      async reload() { cache = (await adapter.loadAll()) || []; cats = null; emit('reload'); return cache; },
      /** Apply a realtime row change without a full reload. */
      applyRemoteChange(table, p) {
        if (table !== 'events' || !cache) { cats = null; emit('categories'); return; }
        if (p.eventType === 'DELETE') { const id = p.old && p.old.id; if (id) cache = cache.filter(e => e.id !== id && e.seriesId !== id); }
        else if (p.new && p.new.id) put(adapter.fromRow(p.new));
        emit('remote');
      },
      onChange(fn) { listeners.add(fn); return () => listeners.delete(fn); },

      async categories() { if (!cats) cats = (await adapter.loadCategories()) || {}; return cats; },
      async addCategory(cal, name) { await adapter.addCategory(cal, name); cats = null; },

      async exportJSON() {
        return JSON.stringify({ app: 'scott-calendar', version: 2, timeZone: 'America/Chicago', exportedAt: new Date().toISOString(),
          events: await ensure(), customCategories: await store.categories() }, null, 2);
      },
      /** mode: 'merge' (by id, imported wins) or 'replace' */
      async importJSON(text, mode = 'merge') {
        const data = JSON.parse(text);
        const incoming = Array.isArray(data) ? data : data.events;
        if (!Array.isArray(incoming)) throw new Error('No events array found in file');
        const evs = normaliseIds(incoming.map(e => ({ ...e })));
        if (mode === 'replace') await store.replaceAll(evs); else await upsertMany(evs);
        if (data.customCategories) for (const [c, names] of Object.entries(data.customCategories)) for (const n of names) await store.addCategory(c, n);
        return evs.length;
      },

      // ---- one-time migration: this device's localStorage -> Supabase
      async localDataForMigration() {
        if (!remote || localStorage.getItem(MIGRATED_KEY)) return null;
        const evs = readJSON(KEY, null);
        if (!evs || !evs.length) return null;
        return { events: evs, real: evs.filter(e => !e.example).length, examples: evs.filter(e => e.example).length };
      },
      async migrateLocal({ includeExamples = false } = {}) {
        const local = readJSON(KEY, []) || [];
        const chosen = normaliseIds(local.filter(e => includeExamples || !e.example).map(e => ({ ...e })));
        // drop exceptions whose series was filtered out
        const ids = new Set(chosen.map(e => e.id));
        const evs = chosen.filter(e => !e.seriesId || ids.has(e.seriesId));
        await upsertMany(evs);
        const lc = await LocalStorageAdapter.loadCategories();
        for (const [c, names] of Object.entries(lc || {})) for (const n of names) await store.addCategory(c, n);
        localStorage.setItem(MIGRATED_KEY, new Date().toISOString());
        return evs.length;
      },
      skipMigration() { localStorage.setItem(MIGRATED_KEY, 'skipped ' + new Date().toISOString()); },

      loadSettings: () => adapter.loadSettings(),
      saveSettings: (s) => adapter.saveSettings(s),
      uid,
    };
    return store;
  }

  /** Supabase ids are UUIDs; remap anything else (old imports) and keep series links intact. */
  function normaliseIds(evs) {
    const map = new Map();
    for (const e of evs) if (!isUuid(e.id)) { const n = uid(); map.set(e.id, n); e.id = n; }
    for (const e of evs) if (e.seriesId && map.has(e.seriesId)) e.seriesId = map.get(e.seriesId);
    return evs;
  }

  // ------------------------------------------------------------------ auth (Supabase only)
  function makeAuth(adapter) {
    if (adapter.name !== 'supabase') return null;
    const sb = adapter.client;
    const owner = (CFG.OWNER_EMAIL || '').toLowerCase();
    return {
      ownerEmail: owner,
      async user() { const { data } = await sb.auth.getSession(); return data.session ? data.session.user : null; },
      async sendMagicLink(email) {
        // Hosted: always come back to the canonical site URL (must match Supabase's allowed redirect URLs).
        // Elsewhere (local dev/tests): come back to wherever the app is running.
        const redirect = CFG.SITE_URL && location.hostname === new URL(CFG.SITE_URL).hostname
          ? CFG.SITE_URL
          : location.origin + location.pathname.replace(/index\.html$/, '');
        const { error } = await sb.auth.signInWithOtp({ email: email.trim(), options: { emailRedirectTo: redirect } });
        if (error) throw error;
      },
      async signOut() { await sb.auth.signOut(); },
      onSignIn(fn) { return sb.auth.onAuthStateChange((evt, session) => { if (session && (evt === 'SIGNED_IN' || evt === 'INITIAL_SESSION')) fn(session.user); }); },
      isOwner(user) { return !!user && (!owner || (user.email || '').toLowerCase() === owner); },
    };
  }

  // ------------------------------------------------------------------ pick the adapter
  let adapter = LocalStorageAdapter;
  let configError = null;
  if (CFG.SUPABASE_URL && CFG.SUPABASE_ANON_KEY) {
    try { adapter = SupabaseAdapter(CFG.SUPABASE_URL, CFG.SUPABASE_ANON_KEY); }
    catch (e) { configError = e.message; console.error('Supabase disabled:', e); }
  }
  window.Store = createStore(adapter);
  window.Store.auth = makeAuth(adapter);
  window.Store.configError = configError;
  window.Store.LocalStorageAdapter = LocalStorageAdapter; // for tests / manual recovery
})();
