/*
 * storage.js: the only code that touches storage.
 *
 * The app talks to `window.Store` (async API, in-memory cache + adapter).
 *   - LocalStorageAdapter: this device/browser only (used when config.js is empty).
 *   - SupabaseAdapter: shared Postgres via Supabase (used when config.js has
 *     SUPABASE_URL + SUPABASE_ANON_KEY). Requires sign-in (emailed 8-digit code).
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
  const CALS_KEY = 'scottcal.calendars.v1'; // local mode: the user's own calendar list (absent = built-in three)
  const NOTES_KEY = 'scottcal.occurrenceNotes.v1'; const LINKS_KEY = 'scott-calendar-links-v1'; const CHECKS_KEY = 'scott-calendar-checks-v1';
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
    // Day notes ("Today's Note"): one note per (event_id, occurrence_date). Never touches events.
    // Calendars: null = the app's built-in three; once the user adds or edits one, the full list lives on the device.
    async loadCalendars() { const r = readJSON(CALS_KEY, null); return Array.isArray(r) && r.length ? r : null; },
    async saveCalendars(rows) { localStorage.setItem(CALS_KEY, JSON.stringify(rows)); return rows; },
    async loadProfile() { return null; },
    async loadNotes() { return readJSON(NOTES_KEY, []); },
    async upsertNote(n) { const all = readJSON(NOTES_KEY, []); const i = all.findIndex(x => x.eventId === n.eventId && x.date === n.date); if (i >= 0) all[i] = n; else all.push(n); localStorage.setItem(NOTES_KEY, JSON.stringify(all)); return n; },
    // Checklist ticks ('- [ ]' lines in notes), one row per (event_id, occurrence_date).
    async loadChecks() { return readJSON(CHECKS_KEY, []); },
    async loadLinks() { return readJSON(LINKS_KEY, []); },
    async upsertChecks(c) { const all = readJSON(CHECKS_KEY, []).filter(x => !(x.eventId === c.eventId && x.date === c.date)); all.push(c); localStorage.setItem(CHECKS_KEY, JSON.stringify(all)); return c; },
    async deleteNote(eventId, date) { localStorage.setItem(NOTES_KEY, JSON.stringify(readJSON(NOTES_KEY, []).filter(x => !(x.eventId === eventId && x.date === date)))); },
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
      reminders: cleanReminders(ev.reminders),
      todo_category_id: isTask ? (ev.todoCategoryId || null) : null,
      priority: isTask && ev.priority >= 1 && ev.priority <= 3 ? ev.priority : null, // 2026-10-25 fab (migration-2026-10-25-priority.sql)
    };
  }
  // minutes before start; max 6, 0..267840 (186 days), no duplicates (matches the DB check)
  const cleanReminders = a => [...new Set((Array.isArray(a) ? a : []).map(Number).filter(n => Number.isInteger(n) && n >= 0 && n <= 267840))].sort((x, y) => x - y).slice(0, 6);
  function fromRow(row) {
    const ev = {
      id: row.id, kind: row.is_task ? 'task' : 'event', calendar: row.calendar, category: row.category, title: row.title,
      allDay: row.all_day, start: fromDbTs(row.start_at, row.all_day), end: fromDbTs(row.end_at, row.all_day),
      recurrence: row.recur_freq === 'none' ? { freq: 'none' } : {
        freq: row.recur_freq, interval: row.recur_interval || 1, until: row.recur_until || null,
        byWeekday: row.recur_freq === 'weekly' ? (row.recur_by_weekday || undefined) : undefined,
      },
      exdates: row.exdates || [], location: row.location || '', notes: row.notes || '', reminders: row.reminders || [], todoCategoryId: row.todo_category_id || null, priority: row.priority || null,
      example: !!row.example, source: row.source, createdAt: row.created_at, updatedAt: row.updated_at,
    };
    if (row.series_id) { ev.seriesId = row.series_id; ev.originalDate = row.original_date; }
    if (row.is_task) {
      ev.scope = row.task_scope || 'day';
      if (row.recur_freq === 'none') ev.done = !!row.done; else ev.completedDates = row.completed_dates || [];
    }
    return ev;
  }

  const noteFromRow = r => ({ id: r.id, eventId: r.event_id, date: r.occurrence_date, body: r.body || '', createdAt: r.created_at, updatedAt: r.updated_at });

  const isMissingTable = e => e && (e.code === 'PGRST205' || e.code === '42P01' || /could not find the table|does not exist/i.test(e.message || ''));
  // categories are unique per (owner, calendar, name) after the step 2 migration; plain insert + ignore duplicates works for both
  const CAT_CONFLICT = 'owner_id,calendar,name';
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
          // columns added by later migrations: until they run, save everything else
          const OPT = ['reminders', 'todo_category_id', 'priority'];
          this.missingCols = this.missingCols || new Set();
          const strip = rs => rs.map(r => { const o = { ...r }; for (const c of this.missingCols) delete o[c]; return o; });
          const raw = sorted.slice(i, i + 500).map(toRow);
          let res = await sb.from('events').upsert(strip(raw)).select();
          for (let tries = 0; res.error && tries < OPT.length; tries++) {
            const c = OPT.find(c => !this.missingCols.has(c) && (res.error.message || '').includes(c));
            if (!c) break;
            this.missingCols.add(c); if (c === 'reminders') this.remindersSupported = false;
            res = await sb.from('events').upsert(strip(raw)).select();
          }
          const rows = must(res);
          if (rows[0] && 'reminders' in rows[0]) this.remindersSupported = true;
          if (rows[0] && 'todo_category_id' in rows[0]) this.todoCategoriesSupported = true;
          saved.push(...rows.map(fromRow));
        }
        return saved;
      },
      async removeMany(ids) {
        for (let i = 0; i < ids.length; i += 200) must(await sb.from('events').delete().in('id', ids.slice(i, i + 200)));
      },
      // Per-user calendars (step 2). null = table not created yet -> app keeps its built-in three.
      async loadCalendars() {
        const { data, error } = await sb.from('calendars').select('id,slug,name,short,color,sort').order('sort').order('created_at');
        if (error) { if (isMissingTable(error)) return null; throw new Error(error.message); }
        return data;
      },
      async createCalendars(list) { return must(await sb.from('calendars').insert(list).select()); },
      async updateCalendar(slug, patch) { return must(await sb.from('calendars').update(patch).eq('slug', slug).select()); },
      async loadProfile() {
        const { data, error } = await sb.from('profiles').select('*').maybeSingle();
        if (error) { if (isMissingTable(error)) return null; throw new Error(error.message); }
        return data;
      },
      async saveProfile(p) { return must(await sb.from('profiles').upsert(p).select().single()); },
      async exportAccount() {
        const out = {};
        for (const t of ['profiles', 'calendars', 'events', 'categories', 'occurrence_notes', 'occurrence_checks', 'occurrence_links', 'todo_categories', 'inbox_items']) {
          const rows = []; const page = 1000;
          for (let from = 0; ; from += page) {
            const { data, error } = await sb.from(t).select('*').range(from, from + page - 1);
            if (error) { if (isMissingTable(error)) break; throw new Error(error.message); }
            rows.push(...data); if (data.length < page) break;
          }
          out[t] = rows;
        }
        return out;
      },
      async deleteAccount(email) { return must(await sb.rpc('delete_my_account', { confirm_email: email })); },
      async loadCategories() {
        const rows = must(await sb.from('categories').select('calendar,name').order('name'));
        const cats = {};
        for (const r of rows) (cats[r.calendar] ||= []).push(r.name);
        return cats;
      },
      async addCategory(cal, name) {
        let r = await sb.from('categories').upsert({ calendar: cal, name }, { onConflict: CAT_CONFLICT, ignoreDuplicates: true });
        if (r.error && r.error.code === '42P10') // before the step 2 migration: old global (calendar, name) key
          r = await sb.from('categories').upsert({ calendar: cal, name }, { onConflict: 'calendar,name', ignoreDuplicates: true });
        must(r);
      },
      async loadNotes() {
        const out = []; const page = 1000;
        for (let from = 0; ; from += page) {
          const rows = must(await sb.from('occurrence_notes').select('*').order('occurrence_date').range(from, from + page - 1));
          out.push(...rows.map(noteFromRow));
          if (rows.length < page) return out;
        }
      },
      async upsertNote(n) {
        const rows = must(await sb.from('occurrence_notes').upsert({ event_id: n.eventId, occurrence_date: n.date, body: n.body }, { onConflict: 'event_id,occurrence_date' }).select());
        return noteFromRow(rows[0]);
      },
      async loadChecks() {
        const out = []; const page = 1000;
        for (let from = 0; ; from += page) {
          const rows = must(await sb.from('occurrence_checks').select('event_id,occurrence_date,checked').order('occurrence_date').range(from, from + page - 1));
          out.push(...rows.map(r => ({ eventId: r.event_id, date: r.occurrence_date, checked: r.checked || [] })));
          if (rows.length < page) return out;
        }
      },
      async loadLinks() {
        const rows = must(await sb.from('occurrence_links').select('event_id,occurrence_date,notion_url'));
        return rows.map(r => ({ eventId: r.event_id, date: r.occurrence_date, url: r.notion_url }));
      },
      async upsertChecks(c) {
        must(await sb.from('occurrence_checks').upsert({ event_id: c.eventId, occurrence_date: c.date, checked: c.checked }, { onConflict: 'event_id,occurrence_date' }));
        return c;
      },
      async deleteNote(eventId, date) { must(await sb.from('occurrence_notes').delete().eq('event_id', eventId).eq('occurrence_date', date)); },
      subscribe(onChange) {
        const ch = sb.channel('calendar-changes')
          .on('postgres_changes', { event: '*', schema: 'public', table: 'events' }, p => onChange('events', p))
          .on('postgres_changes', { event: '*', schema: 'public', table: 'categories' }, p => onChange('categories', p))
          .subscribe();
        // separate channel so a missing occurrence_notes table can never break event updates
        const ch2 = sb.channel('day-notes-changes')
          .on('postgres_changes', { event: '*', schema: 'public', table: 'occurrence_notes' }, p => onChange('notes', p))
          .subscribe();
        // own channel too: until the 2026-10-21 migration runs, occurrence_checks doesn't exist
        const ch3 = sb.channel('checklist-changes')
          .on('postgres_changes', { event: '*', schema: 'public', table: 'occurrence_checks' }, p => onChange('checks', p))
          .subscribe();
        // own channel: occurrence_links exists only after the notion-links migration
        const ch4 = sb.channel('link-changes')
          .on('postgres_changes', { event: '*', schema: 'public', table: 'occurrence_links' }, p => onChange('links', p))
          .subscribe();
        return () => { sb.removeChannel(ch); sb.removeChannel(ch2); sb.removeChannel(ch3); sb.removeChannel(ch4); };
      },
      fromRow,
      ...deviceSettings,
    };
  }

  // ------------------------------------------------------------------ Store
  function createStore(adapter) {
    let cache = null;
    let cats = null;
    let notesCache = null;
    let checksCache = null;
    let linksCache = null;
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
      async reload() { cache = (await adapter.loadAll()) || []; cats = null; notesCache = null; checksCache = null; linksCache = null; emit('reload'); return cache; },
      /** Apply a realtime row change without a full reload. */
      applyRemoteChange(table, p) {
        if (table === 'notes') { notesCache = null; emit('notes'); return; }
        if (table === 'checks') { checksCache = null; emit('checks'); return; }
        if (table === 'links') { linksCache = null; emit('notes'); return; }
        if (table !== 'events' || !cache) { cats = null; emit('categories'); return; }
        if (p.eventType === 'DELETE') { const id = p.old && p.old.id; if (id) cache = cache.filter(e => e.id !== id && e.seriesId !== id); }
        else if (p.new && p.new.id) put(adapter.fromRow(p.new));
        emit('remote');
      },
      /** Day notes ("Today's Note"), keyed by series/event id + Chicago date. Separate from events. */
      notes: {
        available: true, error: null,
        async all() {
          if (notesCache) return notesCache;
          try { notesCache = (await adapter.loadNotes()) || []; this.available = true; this.error = null; }
          catch (e) { console.warn('Day notes unavailable:', e); this.available = false; this.error = e.message || String(e); notesCache = []; }
          return notesCache;
        },
        async get(eventId, date) { return (await this.all()).find(n => n.eventId === eventId && n.date === date) || null; },
        /** Empty body deletes the note. */
        async set(eventId, date, body) {
          await this.all(); body = (body || '').trim();
          const i = notesCache.findIndex(n => n.eventId === eventId && n.date === date);
          if (!body) { if (i >= 0) { await adapter.deleteNote(eventId, date); notesCache.splice(i, 1); } return null; }
          const now = new Date().toISOString();
          const n = await adapter.upsertNote({ ...(i >= 0 ? notesCache[i] : { id: uid(), createdAt: now }), eventId, date, body, updatedAt: now });
          if (i >= 0) notesCache[i] = n; else notesCache.push(n);
          return n;
        },
        invalidate() { notesCache = null; },
      },
      /** Checklist ticks per occurrence: keys of the '- [ ]' note lines ticked on that date. */
      checks: {
        available: true, error: null,
        async all() {
          if (checksCache) return checksCache;
          try { checksCache = (await adapter.loadChecks()) || []; this.available = true; this.error = null; }
          catch (e) { console.warn('Checklists unavailable:', e); this.available = false; this.error = e.message || String(e); checksCache = []; }
          return checksCache;
        },
        async get(eventId, date) { const c = (await this.all()).find(x => x.eventId === eventId && x.date === date); return c ? [...c.checked] : []; },
        async set(eventId, date, checked) {
          await this.all();
          const c = await adapter.upsertChecks({ eventId, date, checked: [...new Set(checked)] });
          const i = checksCache.findIndex(x => x.eventId === eventId && x.date === date);
          if (i >= 0) checksCache[i] = c; else checksCache.push(c);
          return c;
        },
        invalidate() { checksCache = null; },
      },
      /** Notion links per occurrence (read-only in the app; written by the sync routine via cal.py note-link). */
      links: {
        available: true,
        async all() {
          if (linksCache) return linksCache;
          try { linksCache = ((await adapter.loadLinks?.()) || []).filter(l => /^https:\/\/([a-z0-9-]+\.)*notion\.(so|com|site)\//i.test(l.url || '')); this.available = true; }
          catch (e) { console.warn('Notion links unavailable:', e); this.available = false; linksCache = []; }
          return linksCache;
        },
        async get(eventId, date) { const l = (await this.all()).find(x => x.eventId === eventId && x.date === date); return l ? l.url : null; },
        invalidate() { linksCache = null; },
      },
      onChange(fn) { listeners.add(fn); return () => listeners.delete(fn); },

      async calendars() { return adapter.loadCalendars ? adapter.loadCalendars() : null; },
      async createCalendars(list) { return adapter.createCalendars(list); },
      async updateCalendar(slug, patch) { return adapter.updateCalendar(slug, patch); },
      async saveCalendars(rows) { return adapter.saveCalendars(rows); }, // local mode only: replace the whole list
      async profile() { return adapter.loadProfile ? adapter.loadProfile() : null; },
      async saveProfile(p) { return adapter.saveProfile(p); },
      async exportAccount() { return adapter.exportAccount ? adapter.exportAccount() : JSON.parse(await store.exportJSON()); },
      async deleteAccount(email) { return adapter.deleteAccount(email); },
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
        const { error } = await sb.auth.signInWithOtp({ email: email.trim(), options: { emailRedirectTo: redirect, shouldCreateUser: false } });
        if (error) {
          // Invite-only: Supabase refuses emails without an account (sign-ups are off).
          if (error.status === 422 || /signups? not allowed|otp_disabled|user not found/i.test(error.message || '') || error.code === 'otp_disabled') {
            const e = new Error('not_invited'); e.notInvited = true; throw e;
          }
          throw error;
        }
      },
      // Code sign-in. The Supabase email templates are code-only (subject "Your SANDY sign-in code",
      // just the 8-digit {{ .Token }}, no link), so this is the only way in, which also suits the
      // iPhone Home Screen app (its own storage; links would open in Safari).
      async verifyCode(email, token) {
        const { data, error } = await sb.auth.verifyOtp({ email: email.trim(), token: String(token).trim(), type: 'email' });
        if (error) throw error;
        return data && data.session ? data.session.user : null;
      },
      async signOut() { await sb.auth.signOut(); },
      onSignIn(fn) { return sb.auth.onAuthStateChange((evt, session) => { if (session && (evt === 'SIGNED_IN' || evt === 'INITIAL_SESSION')) fn(session.user); }); },
      // Invite-only: any account that exists in Supabase Auth was invited (sign-ups are off),
      // and Row Level Security limits each account to its own calendars.
      isOwner(user) { return !!user; },
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
