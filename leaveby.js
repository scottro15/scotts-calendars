/* leaveby.js: Sandy Intelligence "Leave by" nudges on the Today screen (Scott 2026-10-25, SI feature 1).
 * For each of today's upcoming timed events with a Location, works out the drive from where you'll be (the location of
 * a back-to-back previous event, otherwise your Home from Profile) and shows "Leave by 6:15 PM · 32 min drive" in Heads Up,
 * with a Google Maps directions link.
 *  - Free services only: Photon (photon.komoot.io, OpenStreetMap geocoding) and Valhalla (valhalla1.openstreetmap.de,
 *    OpenStreetMap routing). No API keys, no AI calls.
 *  - Results are cached in localStorage (addresses forever, failed addresses 1 day, routes 7 days, failed routes 1 day),
 *    and lookups in flight are shared, so re-rendering Today doesn't call the services again.
 *  - Home is per user: profiles.home_address/home_lat/home_lon (migration-2026-10-25-home.sql) when signed in,
 *    falling back to this device (localStorage, keyed by user id) when that column doesn't exist yet or in local mode.
 *  - Leave by = start − drive − 10 min buffer, rounded down to 5 minutes.
 *  - Current location (SI feature A, 2026-10-25): from 1 hour before the from-home leave time (or when opened from a
 *    "Check your drive" push, ?locate=1) it asks the browser where you are -- permission is asked once, with an
 *    in-app explanation first. More than ~0.3 mi from home → the drive is worked out from there and labelled
 *    "from your current location". Your position stays in memory on this device (reused for 5 min, routes from it never stored);
 *    denied / unavailable → the home plan stands.
 *  - Leave-by push alerts (SI feature A): when signed in with alerts on (Profile), each computed leave time is saved
 *    to leave_plans (a time, drive minutes and a label -- never coordinates) and the send-reminders Edge Function
 *    pushes "Check your drive" (1 hr before), "Leave in 10 min" (optional) and "Time to leave".
 */
(function () {
  'use strict';
  const CFG = window.CALENDAR_CONFIG || {};
  const GEO_URL = CFG.GEOCODE_URL || 'https://photon.komoot.io/api/';
  const ROUTE_URL = CFG.ROUTE_URL || 'https://valhalla1.openstreetmap.de/route';
  const BUFFER_MIN = 10;          // parking / walking in
  const B2B_MIN = 60;             // a previous event ending up to this long before counts as "where you'll be"
  const MAX_LOOKUPS = 10;         // per render, so a packed day can't hammer the free services
  const DAY = 864e5, MIN = 6e4;
  const NEAR_M = 480;             // ~0.3 mi: closer than this to home counts as "at home"
  const CHECK_AHEAD_MIN = 60;     // start checking your location this long before the from-home leave time
  const POS_TTL = 5 * 6e4;        // reuse a position for 5 minutes
  const LS = { home: 'sandy.home.v1', geo: 'sandy.geo.v1', route: 'sandy.route.v1', useLoc: 'sandy.useLoc.v1', locAsked: 'sandy.locAsked.v1' };
  const A = () => window.__app;
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const t12 = d => d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: 'UTC' });
  const norm = s => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  const readLS = (k, d) => { try { const v = JSON.parse(localStorage.getItem(k)); return v == null ? d : v; } catch (_) { return d; } };
  const writeLS = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch (_) {} };
  const fmtDrive = m => m < 60 ? `${m} min` : `${Math.floor(m / 60)} hr${m % 60 ? ` ${m % 60} min` : ''}`;
  const mapsUrl = (from, to) => 'https://www.google.com/maps/dir/?api=1&travelmode=driving' +
    (from ? '&origin=' + encodeURIComponent(from) : '') + '&destination=' + encodeURIComponent(to);

  // ------------------------------------------------------------------ home (per user)
  let home; // undefined = not loaded; null = none
  const homeKey = () => { const a = A(); const u = a && a.user && a.user(); return LS.home + (u && u.id ? '.' + u.id : ''); };
  const synced = () => { const a = A(); return !!(a && a.Store && a.Store.mode !== 'local' && a.Store.auth); };
  const missingColumn = e => e && (e.code === 'PGRST204' || e.code === '42703' || /home_(address|lat|lon)|column/i.test(e.message || ''));
  async function getHome() {
    if (home !== undefined) return home;
    let h = null;
    if (synced()) { try { const p = await A().Store.profile(); if (p && p.home_address) h = { address: p.home_address, lat: p.home_lat, lon: p.home_lon }; } catch (_) {} }
    if (!h) h = readLS(homeKey(), null);
    if (h && !(isFinite(h.lat) && isFinite(h.lon))) { const g = await geocode(h.address); h = g.ok ? { ...h, lat: g.lat, lon: g.lon } : h; }
    return (home = h && h.address ? h : null);
  }
  /** Save (or clear, with '') the home address. Resolves { home, where: 'account' | 'device' }; throws a friendly Error. */
  async function setHome(address) {
    address = String(address || '').trim().slice(0, 300);
    let h = null;
    if (address) {
      const g = await geocode(address, true);
      if (!g.ok) throw new Error(g.temp ? 'Could not reach the map service. Check your connection and try again.' : 'Couldn’t find that address on the map. Try adding the city and ZIP.');
      h = { address, lat: g.lat, lon: g.lon };
    }
    let where = 'device';
    if (synced()) {
      try { await A().Store.saveProfile({ home_address: h ? h.address : null, home_lat: h ? h.lat : null, home_lon: h ? h.lon : null }); where = 'account'; }
      catch (e) { if (!missingColumn(e)) throw new Error('Could not save: ' + (e.message || e)); }
    }
    if (where === 'device' && h) writeLS(homeKey(), h); else localStorage.removeItem(homeKey());
    home = h;
    return { home: h, where };
  }

  // ------------------------------------------------------------------ geocode + route (free OSM services, cached)
  const inflight = new Map();
  function once(key, fn) { if (!inflight.has(key)) inflight.set(key, fn().finally(() => inflight.delete(key))); return inflight.get(key); }
  function put(k, key, v) { const c = readLS(k, {}); c[key] = v; const ks = Object.keys(c); if (ks.length > 300) ks.sort((x, y) => c[x].t - c[y].t).slice(0, ks.length - 300).forEach(x => delete c[x]); writeLS(k, c); }
  function geocode(q, fresh) {
    const key = norm(q); if (!key) return Promise.resolve({ ok: false });
    const hit = readLS(LS.geo, {})[key];
    if (hit && !fresh && (hit.ok || Date.now() - hit.t < DAY)) return Promise.resolve(hit);
    return once('g:' + key, async () => {
      const bias = home && isFinite(home.lat) ? home : { lat: 38.63, lon: -90.4 };
      try {
        const r = await fetch(GEO_URL + '?' + new URLSearchParams({ q, limit: 1, lang: 'en', lat: bias.lat, lon: bias.lon }));
        if (!r.ok) return { ok: false, temp: r.status >= 500 || r.status === 429 };
        const f = ((await r.json()).features || [])[0];
        const c = f && f.geometry && f.geometry.coordinates;
        const v = c ? { ok: true, lat: +c[1], lon: +c[0], t: Date.now() } : { ok: false, t: Date.now() };
        put(LS.geo, key, v); return v;
      } catch (_) { return { ok: false, temp: true }; }
    });
  }
  const memRoutes = new Map(); // routes from your current location: memory only (never written to storage)
  function route(o, d, mem) {
    const key = [o.lat, o.lon, d.lat, d.lon].map(x => (+x).toFixed(4)).join(',');
    const hit = mem ? memRoutes.get(key) : readLS(LS.route, {})[key];
    if (hit && Date.now() - hit.t < (hit.ok ? 7 : 1) * DAY) return Promise.resolve(hit);
    return once('r:' + key, async () => {
      const body = { locations: [{ lat: +o.lat, lon: +o.lon }, { lat: +d.lat, lon: +d.lon }], costing: 'auto', units: 'miles', directions_type: 'none' };
      try {
        const r = await fetch(ROUTE_URL + '?json=' + encodeURIComponent(JSON.stringify(body)));
        if (r.status >= 500 || r.status === 429) return { ok: false, temp: true };
        const j = await r.json().catch(() => ({}));
        const s = r.ok && j.trip && j.trip.summary;
        const v = s && isFinite(s.time) ? { ok: true, mins: Math.max(1, Math.round(s.time / 60)), miles: Math.round(s.length * 10) / 10, t: Date.now() } : { ok: false, t: Date.now() };
        if (mem) memRoutes.set(key, v); else put(LS.route, key, v); return v;
      } catch (_) { return { ok: false, temp: true }; }
    });
  }
  async function drive(from, to) {
    const [g1, g2] = await Promise.all([isFinite(from.lat) ? { ok: true, lat: from.lat, lon: from.lon } : geocode(from.address), geocode(to)]);
    if (!g1.ok || !g2.ok) return { ok: false, temp: g1.temp || g2.temp, why: !g2.ok ? 'dest' : 'origin' };
    return route(g1, g2);
  }


  // ------------------------------------------------------------------ current location (client only)
  // useLoc: device setting (Profile), default on. locAsked: 'yes' once the browser prompt was shown, 'no' if the user
  // said "No thanks" to our explanation, 'denied' if the browser said no. Position: memory only, reused for 5 min.
  let pos = null, posP = null, forceLocate = false;
  const useLoc = () => readLS(LS.useLoc, true) !== false;
  function setUseLoc(on) { writeLS(LS.useLoc, !!on); if (on && /^(no|denied)$/.test(readLS(LS.locAsked, ''))) localStorage.removeItem(LS.locAsked); if (!on) clearPos(); }
  function clearPos() { pos = null; memRoutes.clear(); }
  async function permState() {
    if (!navigator.geolocation) return 'unavailable';
    try { if (navigator.permissions && navigator.permissions.query) return (await navigator.permissions.query({ name: 'geolocation' })).state; } catch (_) {}
    return 'unknown';
  }
  /** 'off' | 'unavailable' | 'denied' | 'declined' | 'ask' (show our explanation first) | 'ok' (may call the browser) */
  async function locState() {
    if (!useLoc()) return 'off';
    const st = await permState(); const asked = readLS(LS.locAsked, '');
    if (st === 'unavailable') return 'unavailable';
    if (st === 'denied' || asked === 'denied') return 'denied';
    if (st === 'granted') return 'ok';
    if (asked === 'no') return 'declined';
    return asked === 'yes' || forceLocate ? 'ok' : 'ask';
  }
  function getPos() { // our own 5-min cache; otherwise ask the phone for a fresh fix (maximumAge 0)
    if (pos && Date.now() - pos.t < POS_TTL) return Promise.resolve(pos);
    if (posP) return posP;
    writeLS(LS.locAsked, readLS(LS.locAsked, '') || 'yes');
    posP = new Promise(res => navigator.geolocation.getCurrentPosition(
      p => { pos = { lat: p.coords.latitude, lon: p.coords.longitude, t: Date.now() }; res(pos); },
      e => { if (e && e.code === 1) writeLS(LS.locAsked, 'denied'); res(null); },
      { enableHighAccuracy: false, timeout: 10000, maximumAge: 0 })).finally(() => { posP = null; });
    return posP;
  }
  const meters = (a, b) => { const R = 6371e3, r = x => x * Math.PI / 180; const dLa = r(b.lat - a.lat), dLo = r(b.lon - a.lon);
    const h = Math.sin(dLa / 2) ** 2 + Math.cos(r(a.lat)) * Math.cos(r(b.lat)) * Math.sin(dLo / 2) ** 2; return 2 * R * Math.asin(Math.min(1, Math.sqrt(h))); };
  // for routing/caching, round to ~100 m (enough for drive time; nothing leaves the device except to the routing service)
  const roundPos = p => ({ lat: Math.round(p.lat * 1000) / 1000, lon: Math.round(p.lon * 1000) / 1000 });

  // ------------------------------------------------------------------ leave-by alerts: plans saved for the push server
  const tzName = () => { const a = A(); try { return (a && a.timeZone && a.timeZone()) || 'America/Chicago'; } catch (_) { return 'America/Chicago'; } };
  function wallToUtc(wall, tz) { // wall-clock Date (UTC fields = local time) -> real epoch ms in tz
    const f = new Intl.DateTimeFormat('en-US', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' });
    const at = t => { const p = Object.fromEntries(f.formatToParts(new Date(t)).map(x => [x.type, x.value])); return Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour % 24, +p.minute, +p.second); };
    const g = wall.getTime(); let t = g - (at(g) - g); t = g - (at(t) - t); return t;
  }
  let prefs; // { alerts, early } from the profile (undefined = not loaded)
  const sbc = () => { const a = A(); return synced() && a.Store.adapter && a.Store.adapter.client || null; };
  async function getAlertPrefs() {
    if (prefs !== undefined) return prefs;
    let p = { alerts: false, early: true, available: false };
    if (synced()) { try { const r = await A().Store.profile(); if (r && 'leave_alerts' in r) p = { alerts: !!r.leave_alerts, early: r.leave_alerts_early !== false, available: true }; } catch (_) {} }
    return (prefs = p);
  }
  /** Save the Profile switches. Throws a friendly Error (e.g. before the server update). */
  async function setAlertPrefs(patch) {
    if (!synced()) throw new Error('Sign in to get leave-by alerts.');
    const row = {}; if ('alerts' in patch) row.leave_alerts = !!patch.alerts; if ('early' in patch) row.leave_alerts_early = !!patch.early;
    try { await A().Store.saveProfile(row); }
    catch (e) { if (e && (e.code === 'PGRST204' || e.code === '42703' || /leave_alerts|column/i.test(e.message || ''))) throw new Error('Leave-by alerts need a one-time server update first. Try again soon.'); throw new Error('Could not save: ' + (e.message || e)); }
    prefs = { ...(await getAlertPrefs()), ...patch, available: true }; sentSig.clear();
    return prefs;
  }
  const isUuid = s => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(s));
  const sentSig = new Map();
  /** Upsert leave_plans rows for these computed plans (only what changed). */
  async function savePlans(list) {
    const sb = sbc(); if (!sb || !list.length) return 0;
    const p = await getAlertPrefs(); if (!p.alerts) return 0;
    const tz = tzName();
    const rows = list.filter(x => isUuid(x.c.x.ev.id)).map(x => {
      const st = x.c.x.o.start;
      return { event_id: x.c.x.ev.id, occurrence_date: st.toISOString().slice(0, 10), event_start: st.toISOString().slice(0, 19), location: x.c.loc.slice(0, 500),
        leave_at: new Date(wallToUtc(x.leave, tz)).toISOString(), home_leave_at: x.homeLeave ? new Date(wallToUtc(x.homeLeave, tz)).toISOString() : null,
        drive_min: Math.min(1440, x.mins), origin: x.origin, origin_label: String(x.label).slice(0, 200), status: 'ok', source: 'client' };
    }).filter(r => { const k = r.event_id + '|' + r.occurrence_date, sig = JSON.stringify(r); if (sentSig.get(k) === sig) return false; sentSig.set(k, sig); return true; });
    if (!rows.length) return 0;
    const now = new Date().toISOString();
    const { error } = await sb.from('leave_plans').upsert(rows.map(r => ({ ...r, updated_at: now })), { onConflict: 'event_id,occurrence_date' });
    if (error) { rows.forEach(r => sentSig.delete(r.event_id + '|' + r.occurrence_date)); if (!/leave_plans|schema cache|does not exist/i.test(error.message || '')) console.warn('leave plans:', error.message); return 0; }
    return rows.length;
  }

  // ------------------------------------------------------------------ planning
  /** Which of today's events need a leave-by line, and where you'll be coming from. Pure (no network). */
  function candidates(items, now, h) {
    const timed = items.filter(x => !x.ev.allDay && x.ev.kind !== 'task').sort((x, y) => x.o.start - y.o.start);
    const out = [];
    for (const x of timed) {
      const loc = String(x.ev.location || '').trim();
      if (!loc || x.o.start <= now) continue; // no location / started or past
      let prev = null;
      for (const p of timed) {
        if (p === x || !String(p.ev.location || '').trim()) continue;
        const end = p.o.end || p.o.start;
        if (p.o.start < x.o.start && end <= x.o.start && x.o.start - end <= B2B_MIN * MIN && (!prev || end >= (prev.o.end || prev.o.start))) prev = p;
      }
      const from = prev ? { kind: 'event', label: prev.ev.title, address: String(prev.ev.location).trim() } : h ? { kind: 'home', label: 'home', address: h.address, lat: h.lat, lon: h.lon } : null;
      if (from && norm(from.address) === norm(loc)) continue; // already there
      out.push({ x, loc, from });
    }
    return out;
  }
  function leaveAt(start, mins) { return new Date(Math.floor((start.getTime() - (mins + BUFFER_MIN) * MIN) / (5 * MIN)) * 5 * MIN); }

  // ------------------------------------------------------------------ rendering (into the Today "Heads Up" card)
  const evBtn = x => `<button type="button" class="tc-link tc-item" data-id="${esc(x.ev.id)}" data-key="${esc(x.o.key)}">${esc(x.ev.title)}</button>`;
  const origin = c => c.cur ? `${c.cur.lat},${c.cur.lon}` : c.from && c.from.address;
  const mapsA = (c, text = 'Directions') => `<a class="lb-maps" href="${esc(mapsUrl(origin(c), c.loc))}" target="_blank" rel="noopener noreferrer" aria-label="${esc(`${text} to ${c.loc} in Google Maps`)}">${esc(text)} ↗</a>`;
  function rowHtml(c, r, now) {
    const at = `${evBtn(c.x)} at ${esc(t12(c.x.o.start))}`;
    if (!c.from) return '';
    if (c.curR && c.curR.ok) r = c.curR; // re-worked from where you are
    const fromTxt = c.cur && c.curR && c.curR.ok ? 'from your current location' : c.from.kind === 'home' ? 'from home' : `from ${esc(c.from.label)}`;
    if (!r) return `<li class="lb-row lb-pending" data-state="pending">🚗 <span class="lb-main">Working out the drive…</span><span class="lb-sub">${at} · ${fromTxt}</span></li>`;
    if (!r.ok) return `<li class="lb-row lb-fail" data-state="${r.temp ? 'offline' : 'noroute'}">📍 <span class="lb-main">${r.temp ? 'Drive time unavailable right now' : 'Couldn’t work out the drive'}</span><span class="lb-sub">${at} · ${esc(c.loc)} · ${mapsA(c, 'Open in Maps')}</span></li>`;
    const leave = leaveAt(c.x.o.start, r.mins);
    const lateBy = Math.round((now.getTime() + r.mins * MIN - c.x.o.start.getTime()) / MIN);
    const main = leave <= now ? `<b>Leave now</b> · ${fmtDrive(r.mins)} drive${lateBy > 0 ? ` <span class="lb-late">(about ${fmtDrive(lateBy)} late)</span>` : ''}` : `<b>Leave by ${esc(t12(leave))}</b> · ${fmtDrive(r.mins)} drive`;
    const org = c.cur && c.curR && c.curR.ok ? 'current' : c.from.kind;
    return `<li class="lb-row lb-ok${leave <= now ? ' lb-now' : ''}" data-state="${leave <= now ? 'now' : 'ok'}" data-origin="${org}" data-leave="${esc(t12(leave))}" data-mins="${r.mins}">${org === 'current' ? '📍' : '🚗'} <span class="lb-main">${main}</span><span class="lb-sub">${at} · ${fromTxt}${r.miles != null ? ` · ${r.miles} mi` : ''} · ${mapsA(c)}</span></li>`;
  }
  const askRow = () => `<li class="lb-row lb-ask" data-state="askloc">📍 <span class="lb-main">Not leaving from home?</span><span class="lb-sub">SANDY can work out the drive from where you are. Your location stays on this phone. <span class="lb-ask-btns"><button type="button" class="tc-link lb-loc-yes">Use my location</button> <button type="button" class="tc-link lb-loc-no">No thanks</button></span></span></li>`;
  let seq = 0, lastArgs = null;
  /** Today card hook: returns the initial HTML (sync) for the rows, then fills them in as drive times arrive. */
  async function render(ul, items, now) {
    const my = ++seq; lastArgs = [ul, items, now];
    const h = await getHome();
    const cs = candidates(items, now, h);
    const needHome = cs.some(c => !c.from);
    const live = cs.filter(c => c.from).slice(0, MAX_LOOKUPS);
    const results = new Map();
    let ask = false;
    const paint = () => {
      if (my !== seq || !ul.isConnected) return;
      let html = live.map(c => rowHtml(c, results.get(c), now)).join('');
      if (ask) html += askRow();
      if (needHome) html += `<li class="lb-row lb-home" data-state="nohome">🏠 <span class="lb-main">Add your home address to get leave-by times</span><span class="lb-sub"><button type="button" class="tc-link lb-sethome">Set home in Profile</button></span></li>`;
      ul.innerHTML = html; ul.hidden = !html;
      const sec = ul.closest('.tc-heads'); if (sec) sec.hidden = !sec.querySelector('li');
    };
    paint();
    await Promise.all(live.map(async c => { results.set(c, await drive(c.from, c.loc)); paint(); }));
    if (my !== seq) return { candidates: cs, results };
    // current location: from 1 hour before the from-home leave time (or when opened from a "check your drive" push)
    const near = live.filter(c => c.from.kind === 'home' && results.get(c) && results.get(c).ok
      && (forceLocate || now.getTime() >= leaveAt(c.x.o.start, results.get(c).mins).getTime() - CHECK_AHEAD_MIN * MIN));
    if (near.length && h && isFinite(h.lat)) {
      const st = await locState();
      if (st === 'ask') { ask = true; paint(); }
      else if (st === 'ok') {
        const p = await getPos();
        if (p && meters(p, h) > NEAR_M) {
          const o = roundPos(p);
          await Promise.all(near.map(async c => { const g = await geocode(c.loc); if (!g.ok) return; const r = await route(o, g, true); if (r.ok) { c.cur = o; c.curR = r; } }));
        }
        forceLocate = false;
        if (my === seq) paint();
      }
    }
    // leave-by alerts: hand the computed times to the push server
    const plans = live.filter(c => results.get(c) && results.get(c).ok).map(c => {
      const home = results.get(c), r = c.curR && c.curR.ok ? c.curR : home;
      return { c, mins: r.mins, leave: leaveAt(c.x.o.start, r.mins), homeLeave: c.from.kind === 'home' ? leaveAt(c.x.o.start, home.mins) : null,
        origin: c.curR && c.curR.ok ? 'current' : c.from.kind, label: c.curR && c.curR.ok ? 'your current location' : c.from.kind === 'home' ? 'home' : c.from.label };
    });
    savePlans(plans).catch(e => console.warn('leave plans:', e));
    return { candidates: cs, results, plans };
  }
  /** "Use my location" / "No thanks" on the in-app explanation row. */
  async function answerAsk(yes) {
    writeLS(LS.locAsked, yes ? 'yes' : 'no');
    if (yes) { forceLocate = true; await getPos(); }
    if (lastArgs && lastArgs[0].isConnected) return render(...lastArgs);
  }
  /** Tomorrow preview: the first drive of the day starting at dayStart (from home or a back-to-back event). */
  async function firstLeave(items, dayStart) {
    const h = await getHome();
    const c = candidates(items, new Date(dayStart.getTime() - 1), h)[0];
    if (!c) return null;
    if (!c.from) return { c, needHome: true };
    const r = await drive(c.from, c.loc);
    return { c, r, leave: r.ok ? leaveAt(c.x.o.start, r.mins) : null };
  }
  /** Opened from a "Check your drive" push (?locate=1): check location even before the 1-hour window. */
  function locateSoon() { forceLocate = true; }
  function invalidate() { home = undefined; prefs = undefined; }
  window.SandyLeave = { render, firstLeave, getHome, setHome, invalidate, candidates, leaveAt, mapsUrl, BUFFER_MIN, B2B_MIN, NEAR_M, CHECK_AHEAD_MIN,
    answerAsk, locateSoon, useLoc, setUseLoc, locState, clearPos, getAlertPrefs, setAlertPrefs, savePlans,
    _test: { geocode, route, drive, norm, meters, wallToUtc, sentSig } };
})();
