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
  const LS = { home: 'sandy.home.v1', geo: 'sandy.geo.v1', route: 'sandy.route.v1' };
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
  function route(o, d) {
    const key = [o.lat, o.lon, d.lat, d.lon].map(x => (+x).toFixed(4)).join(',');
    const hit = readLS(LS.route, {})[key];
    if (hit && Date.now() - hit.t < (hit.ok ? 7 : 1) * DAY) return Promise.resolve(hit);
    return once('r:' + key, async () => {
      const body = { locations: [{ lat: +o.lat, lon: +o.lon }, { lat: +d.lat, lon: +d.lon }], costing: 'auto', units: 'miles', directions_type: 'none' };
      try {
        const r = await fetch(ROUTE_URL + '?json=' + encodeURIComponent(JSON.stringify(body)));
        if (r.status >= 500 || r.status === 429) return { ok: false, temp: true };
        const j = await r.json().catch(() => ({}));
        const s = r.ok && j.trip && j.trip.summary;
        const v = s && isFinite(s.time) ? { ok: true, mins: Math.max(1, Math.round(s.time / 60)), miles: Math.round(s.length * 10) / 10, t: Date.now() } : { ok: false, t: Date.now() };
        put(LS.route, key, v); return v;
      } catch (_) { return { ok: false, temp: true }; }
    });
  }
  async function drive(from, to) {
    const [g1, g2] = await Promise.all([isFinite(from.lat) ? { ok: true, lat: from.lat, lon: from.lon } : geocode(from.address), geocode(to)]);
    if (!g1.ok || !g2.ok) return { ok: false, temp: g1.temp || g2.temp, why: !g2.ok ? 'dest' : 'origin' };
    return route(g1, g2);
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
  const mapsA = (c, text = 'Directions') => `<a class="lb-maps" href="${esc(mapsUrl(c.from && c.from.address, c.loc))}" target="_blank" rel="noopener noreferrer" aria-label="${esc(`${text} to ${c.loc} in Google Maps`)}">${esc(text)} ↗</a>`;
  function rowHtml(c, r, now) {
    const at = `${evBtn(c.x)} at ${esc(t12(c.x.o.start))}`;
    if (!c.from) return '';
    const fromTxt = c.from.kind === 'home' ? 'from home' : `from ${esc(c.from.label)}`;
    if (!r) return `<li class="lb-row lb-pending" data-state="pending">🚗 <span class="lb-main">Working out the drive…</span><span class="lb-sub">${at} · ${fromTxt}</span></li>`;
    if (!r.ok) return `<li class="lb-row lb-fail" data-state="${r.temp ? 'offline' : 'noroute'}">📍 <span class="lb-main">${r.temp ? 'Drive time unavailable right now' : 'Couldn’t work out the drive'}</span><span class="lb-sub">${at} · ${esc(c.loc)} · ${mapsA(c, 'Open in Maps')}</span></li>`;
    const leave = leaveAt(c.x.o.start, r.mins);
    const lateBy = Math.round((now.getTime() + r.mins * MIN - c.x.o.start.getTime()) / MIN);
    const main = leave <= now ? `<b>Leave now</b> · ${fmtDrive(r.mins)} drive${lateBy > 0 ? ` <span class="lb-late">(about ${fmtDrive(lateBy)} late)</span>` : ''}` : `<b>Leave by ${esc(t12(leave))}</b> · ${fmtDrive(r.mins)} drive`;
    return `<li class="lb-row lb-ok${leave <= now ? ' lb-now' : ''}" data-state="${leave <= now ? 'now' : 'ok'}" data-leave="${esc(t12(leave))}" data-mins="${r.mins}">🚗 <span class="lb-main">${main}</span><span class="lb-sub">${at} · ${fromTxt}${r.miles != null ? ` · ${r.miles} mi` : ''} · ${mapsA(c)}</span></li>`;
  }
  let seq = 0;
  /** Today card hook: returns the initial HTML (sync) for the rows, then fills them in as drive times arrive. */
  async function render(ul, items, now) {
    const my = ++seq;
    const h = await getHome();
    const cs = candidates(items, now, h);
    const needHome = cs.some(c => !c.from);
    const live = cs.filter(c => c.from).slice(0, MAX_LOOKUPS);
    const results = new Map();
    const paint = () => {
      if (my !== seq || !ul.isConnected) return;
      let html = live.map(c => rowHtml(c, results.get(c), now)).join('');
      if (needHome) html += `<li class="lb-row lb-home" data-state="nohome">🏠 <span class="lb-main">Add your home address to get leave-by times</span><span class="lb-sub"><button type="button" class="tc-link lb-sethome">Set home in Profile</button></span></li>`;
      ul.innerHTML = html; ul.hidden = !html;
      const sec = ul.closest('.tc-heads'); if (sec) sec.hidden = !sec.querySelector('li');
    };
    paint();
    await Promise.all(live.map(async c => { results.set(c, await drive(c.from, c.loc)); paint(); }));
    return { candidates: cs, results };
  }
  function invalidate() { home = undefined; }
  window.SandyLeave = { render, getHome, setHome, invalidate, candidates, leaveAt, mapsUrl, BUFFER_MIN, B2B_MIN, _test: { geocode, route, drive, norm } };
})();
