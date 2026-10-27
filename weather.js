/* SANDY - Sandy Intelligence feature #8: Weather on Heads Up (FREE, rule-based, no AI).
   For today's and tomorrow's timed events (ignore Christian Dake), check the Open-Meteo forecast
   at the event time at the event location (else Profile home coords — never logged/committed).
   Show a Heads Up line ONLY when it matters:
     - rain/snow chance ≥ POP_MIN (50%)
     - thunderstorms (WMO 95+)
     - temp ≤ COLD_F (32) or ≥ HOT_F (90)
     - wind ≥ WIND_MIN (25 mph)
     - active NWS winter/severe alert near the point (free api.weather.gov), when available
   Tie-in: if leave-by applies and weather is bad for the drive, suggest leaving BUFFER_EXTRA early
   (suggestion only — no auto-change). Forecast cached 1 hour (shares sandy.wx.v1 with travel.js).
   °F; times via SandyTime (12h/24h). Toggle: profiles.si_weather. In-app only (no push). */
(function () {
  'use strict';
  const MIN = 60000, HOUR = 60 * MIN, DAY = 24 * HOUR;
  const AHEAD_DAYS = 2;           // today + tomorrow
  const POP_MIN = 50;
  const COLD_F = 32;
  const HOT_F = 90;
  const WIND_MIN = 25;
  const BUFFER_EXTRA = 10;        // suggested leave-early minutes in bad weather
  const MAX_LINES = 6;
  const WX_URL = 'https://api.open-meteo.com/v1/forecast';
  const WX_KEY = 'sandy.wx.v1';    // shared with travel.js
  const WX_TTL = HOUR;
  const ALERT_KEY = 'sandy.wx.alerts.v1';
  const ALERT_TTL = HOUR;
  const LS_KEY = 'sandy.si.weather';
  const REF_RE = /christian\s+dake/i;

  // WMO weather interpretation (subset; thunderstorms / precip matter for thresholds)
  const THUNDER = new Set([95, 96, 99]);
  const SNOW = new Set([71, 73, 75, 77, 85, 86]);
  const RAIN = new Set([51, 53, 55, 56, 57, 61, 63, 65, 66, 67, 80, 81, 82]);
  const WX_LABEL = {
    0: 'Clear', 1: 'Mostly clear', 2: 'Partly cloudy', 3: 'Cloudy',
    45: 'Fog', 48: 'Freezing fog',
    51: 'Light drizzle', 53: 'Drizzle', 55: 'Heavy drizzle', 56: 'Freezing drizzle', 57: 'Freezing drizzle',
    61: 'Light rain', 63: 'Rain', 65: 'Heavy rain', 66: 'Freezing rain', 67: 'Freezing rain',
    71: 'Light snow', 73: 'Snow', 75: 'Heavy snow', 77: 'Snow grains',
    80: 'Showers', 81: 'Showers', 82: 'Heavy showers', 85: 'Snow showers', 86: 'Heavy snow showers',
    95: 'Thunderstorms', 96: 'Thunderstorms with hail', 99: 'Thunderstorms with hail'
  };

  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const t12 = d => (window.SandyTime ? SandyTime.fmt(d) : (() => { let h = d.getUTCHours(); const m = d.getUTCMinutes(); const ap = h < 12 ? 'AM' : 'PM'; h = h % 12 || 12; return m ? `${h}:${String(m).padStart(2, '0')} ${ap}` : `${h} ${ap}`; })());
  const A = () => window.__app;
  const synced = () => !!(A() && A().Store && A().Store.mode === 'supabase');
  const isRef = e => REF_RE.test(`${(e && e.title) || ''}`);
  const ymd = d => `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;

  let prefs;
  function readLocal() {
    try { const v = localStorage.getItem(LS_KEY); if (v === '0') return false; if (v === '1') return true; } catch (_) {}
    return true;
  }
  function writeLocal(on) { try { localStorage.setItem(LS_KEY, on ? '1' : '0'); } catch (_) {} }
  async function getPrefs() {
    if (prefs !== undefined) return prefs;
    let p = { enabled: readLocal(), available: false };
    if (synced()) {
      try {
        const r = await A().Store.profile();
        if (r && 'si_weather' in r) p = { enabled: r.si_weather !== false, available: true };
      } catch (_) {}
    }
    return (prefs = p);
  }
  async function setPrefs(patch) {
    if ('enabled' in patch) writeLocal(!!patch.enabled);
    if (synced() && 'enabled' in patch) {
      try { await A().Store.saveProfile({ si_weather: !!patch.enabled }); }
      catch (e) {
        if (e && (e.code === 'PGRST204' || e.code === '42703' || /si_weather|column/i.test(e.message || '')))
          throw new Error('Sandy Intelligence needs a one-time server update first. Try again soon.');
        throw new Error('Could not save: ' + (e.message || e));
      }
    }
    prefs = { ...(await getPrefs()), ...patch, available: synced() ? true : false };
    return prefs;
  }
  function invalidate() { prefs = undefined; }

  // ---------- forecast cache (aligned with travel.js)
  const wxMem = new Map();
  function readWx() { try { return JSON.parse(localStorage.getItem(WX_KEY) || '{}'); } catch (_) { return {}; } }
  function putWx(k, v) {
    try {
      const c = readWx(); c[k] = v;
      for (const x of Object.keys(c)) if (Date.now() - c[x].t > DAY) delete c[x];
      localStorage.setItem(WX_KEY, JSON.stringify(c));
    } catch (_) {}
  }

  /** Hourly forecast point. Prefer SandyTravel.weather when present (shared cache). */
  async function forecastAt(lat, lon, at, now) {
    if (window.SandyTravel && typeof SandyTravel.weather === 'function') {
      try { return await SandyTravel.weather(lat, lon, at, now); } catch (_) {}
    }
    if (at.getTime() - now.getTime() > 15 * DAY) return { ok: false, why: 'far' };
    const date = ymd(at), k = `${(+lat).toFixed(2)},${(+lon).toFixed(2)},${date}`;
    let hit = wxMem.get(k) || readWx()[k];
    if (!hit || Date.now() - hit.t > WX_TTL) {
      if (!hit && Date.now() - (wxMem.get('f:' + k) || 0) < 10 * MIN) return { ok: false, why: 'fail' };
      if (!wxMem.has('p:' + k)) wxMem.set('p:' + k, (async () => {
        try {
          const q = new URLSearchParams({
            latitude: (+lat).toFixed(3), longitude: (+lon).toFixed(3),
            hourly: 'temperature_2m,precipitation_probability,weather_code,wind_speed_10m',
            temperature_unit: 'fahrenheit', wind_speed_unit: 'mph',
            timezone: 'America/Chicago', start_date: date, end_date: date
          });
          const r = await fetch(WX_URL + '?' + q); if (!r.ok) return null;
          const j = await r.json(); const h = j && j.hourly; if (!h || !Array.isArray(h.time)) return null;
          const v = { t: Date.now(), time: h.time, temp: h.temperature_2m, pop: h.precipitation_probability, code: h.weather_code, wind: h.wind_speed_10m };
          wxMem.set(k, v); putWx(k, v); return v;
        } catch (_) { return null; }
        finally { wxMem.delete('p:' + k); }
      })());
      const fresh = await wxMem.get('p:' + k) || null;
      if (fresh) hit = fresh;
      else { wxMem.set('f:' + k, Date.now()); if (!hit) return { ok: false, why: 'fail' }; }
    }
    const want = `${date}T${String(at.getUTCHours()).padStart(2, '0')}:00`;
    const i = hit.time.indexOf(want); if (i < 0 || hit.temp[i] == null) return { ok: false, why: 'fail' };
    return {
      ok: true,
      temp: Math.round(hit.temp[i]),
      pop: hit.pop && hit.pop[i] != null ? Math.round(hit.pop[i]) : null,
      code: hit.code ? hit.code[i] : null,
      wind: hit.wind && hit.wind[i] != null ? Math.round(hit.wind[i]) : null
    };
  }

  /** NWS active alerts near a point (US). Returns short titles for winter/severe only. */
  async function nwsAlerts(lat, lon) {
    const k = `${(+lat).toFixed(2)},${(+lon).toFixed(2)}`;
    try {
      const cache = JSON.parse(localStorage.getItem(ALERT_KEY) || '{}');
      const hit = cache[k];
      if (hit && Date.now() - hit.t < ALERT_TTL) return hit.list || [];
    } catch (_) {}
    let list = [];
    try {
      const r = await fetch(`https://api.weather.gov/alerts/active?point=${(+lat).toFixed(4)},${(+lon).toFixed(4)}`, {
        headers: { Accept: 'application/geo+json', 'User-Agent': 'SANDY-calendar (weather heads-up)' }
      });
      if (r.ok) {
        const j = await r.json();
        const feats = (j && j.features) || [];
        list = feats.map(f => {
          const p = f.properties || {};
          return { event: p.event || '', severity: p.severity || '', headline: p.headline || '' };
        }).filter(a => {
          const e = `${a.event} ${a.headline}`.toLowerCase();
          return /winter|snow|ice|blizzard|freeze|frost|wind|thunder|tornado|severe|storm|heat|flood|warning|watch|advisory/.test(e);
        }).slice(0, 3);
      }
    } catch (_) {}
    try {
      const cache = JSON.parse(localStorage.getItem(ALERT_KEY) || '{}');
      cache[k] = { t: Date.now(), list };
      for (const x of Object.keys(cache)) if (Date.now() - cache[x].t > DAY) delete cache[x];
      localStorage.setItem(ALERT_KEY, JSON.stringify(cache));
    } catch (_) {}
    return list;
  }

  /**
   * Decide if forecast matters. Returns {reasons:[], leaveBuffer:boolean} or null.
   * Pure — easy to unit test.
   */
  function evaluate(w, alerts) {
    if (!w || !w.ok) return null;
    const reasons = [];
    const code = w.code;
    const label = WX_LABEL[code] || 'Weather';
    if (THUNDER.has(code)) reasons.push({ kind: 'thunder', text: 'Thunderstorms', detail: label });
    if (w.pop != null && w.pop >= POP_MIN) {
      const snowy = SNOW.has(code);
      reasons.push({ kind: snowy ? 'snow' : 'rain', text: snowy ? `Snow likely (${w.pop}%)` : `Rain likely (${w.pop}%)`, detail: label, pop: w.pop });
    } else if (SNOW.has(code) && (w.pop == null || w.pop >= 30)) {
      reasons.push({ kind: 'snow', text: label, detail: label });
    }
    if (w.temp != null && w.temp <= COLD_F) reasons.push({ kind: 'cold', text: `${w.temp}°F`, detail: 'cold' });
    if (w.temp != null && w.temp >= HOT_F) reasons.push({ kind: 'hot', text: `${w.temp}°F`, detail: 'hot' });
    if (w.wind != null && w.wind >= WIND_MIN) reasons.push({ kind: 'wind', text: `Wind ${w.wind} mph`, detail: 'wind' });
    for (const a of alerts || []) {
      reasons.push({ kind: 'alert', text: a.event || 'Weather alert', detail: a.headline || a.event });
    }
    if (!reasons.length) return null;
    const leaveBuffer = reasons.some(r => r.kind === 'rain' || r.kind === 'snow' || r.kind === 'thunder' || r.kind === 'wind' || r.kind === 'alert');
    return { reasons, leaveBuffer, temp: w.temp, pop: w.pop, code, wind: w.wind };
  }

  function message(ev, when, evl, dayLbl) {
    const primary = evl.reasons[0];
    const shortTitle = String(ev.title || 'event').slice(0, 48);
    const timeBit = t12(when);
    const dayBit = dayLbl === 'Today' ? '' : `${dayLbl} `;
    let tip = '';
    if (primary.kind === 'cold') tip = ' Grab a coat.';
    else if (primary.kind === 'hot') tip = ' Bring water and stay cool.';
    else if (primary.kind === 'rain' || primary.kind === 'snow') tip = evl.leaveBuffer ? ` Leave ${BUFFER_EXTRA} min early.` : '';
    else if (primary.kind === 'thunder') tip = ` Leave ${BUFFER_EXTRA} min early if you can.`;
    else if (primary.kind === 'wind') tip = ` Leave ${BUFFER_EXTRA} min early.`;
    else if (primary.kind === 'alert') tip = '';
    // Compose like the examples
    if (primary.kind === 'rain' || primary.kind === 'snow') {
      return `${primary.text} around ${dayBit}${timeBit}, during ${shortTitle}.${tip}`;
    }
    if (primary.kind === 'cold' || primary.kind === 'hot') {
      return `${primary.text} at ${dayBit}${timeBit} for ${shortTitle}.${tip}`;
    }
    if (primary.kind === 'thunder') {
      return `${primary.text} around ${dayBit}${timeBit} for ${shortTitle}.${tip}`;
    }
    if (primary.kind === 'wind') {
      return `${primary.text} around ${dayBit}${timeBit} for ${shortTitle}.${tip}`;
    }
    return `${primary.text} near ${dayBit}${timeBit} (${shortTitle}).`;
  }

  async function resolvePoint(ev) {
    const L = window.SandyLeave;
    const loc = String(ev.location || '').trim();
    if (loc && L && L.geocode) {
      const g = await L.geocode(loc);
      if (g && g.ok) return { lat: g.lat, lon: g.lon, via: 'event' };
    }
    if (L && L.getHome) {
      const h = await L.getHome();
      if (h && Number.isFinite(h.lat) && Number.isFinite(h.lon)) return { lat: h.lat, lon: h.lon, via: 'home' };
    }
    return null;
  }

  /** Collect today+tomorrow timed non-ref occurrences still ahead (or later today). */
  async function upcoming(a, now) {
    const today = a.startOfDay(now);
    const until = a.addDays(today, AHEAD_DAYS);
    const vis = a.settings().visible;
    const out = [];
    for (const ev of await a.Store.list()) {
      if (vis[ev.calendar] === false) continue;
      if (ev.kind === 'task' || ev.allDay) continue;
      if (isRef(ev)) continue;
      for (const o of a.occurrences(ev, today, until)) {
        if (o.end && o.end <= now) continue;
        if (!o.end && o.start < now) continue;
        out.push({ ev, o });
      }
    }
    return out.sort((x, y) => x.o.start - y.o.start);
  }

  async function data(a, now) {
    const p = await getPrefs();
    if (!p.enabled) return null;
    const today = a.startOfDay(now);
    const items = await upcoming(a, now);
    if (!items.length) return null;

    const lines = [];
    const seenAlert = new Set();
    for (const x of items) {
      if (lines.length >= MAX_LINES) break;
      const pt = await resolvePoint(x.ev);
      if (!pt) continue;
      const w = await forecastAt(pt.lat, pt.lon, x.o.start, now);
      let alerts = [];
      // One NWS lookup per distinct point per run
      const ak = `${pt.lat.toFixed(2)},${pt.lon.toFixed(2)}`;
      if (!seenAlert.has(ak)) {
        seenAlert.add(ak);
        try { alerts = await nwsAlerts(pt.lat, pt.lon); } catch (_) { alerts = []; }
      }
      const evl = evaluate(w, alerts);
      if (!evl) continue;
      const dayN = Math.round((a.startOfDay(x.o.start) - today) / DAY);
      const dayLbl = dayN <= 0 ? 'Today' : dayN === 1 ? 'Tomorrow' : a.fmtDay(x.o.start);
      const hasLeave = !!(String(x.ev.location || '').trim() && window.SandyLeave);
      lines.push({
        ev: x.ev, o: x.o, w, evl, dayLbl, via: pt.via,
        text: message(x.ev, x.o.start, evl, dayLbl),
        suggestBuffer: evl.leaveBuffer && hasLeave
      });
    }
    if (!lines.length) return null;
    return { now, today, lines };
  }

  function html(d) {
    if (!d || !d.lines.length) return '';
    const items = d.lines.map(L => {
      const buf = L.suggestBuffer
        ? ` <span class="wx-buf">Add ${BUFFER_EXTRA} min to leave-by if you’re driving.</span>`
        : '';
      return `<li class="wx-line" data-wx-kind="${esc(L.evl.reasons[0].kind)}">🌦️ ${esc(L.text)}${buf}</li>`;
    }).join('');
    return `<ul class="tc-warn tc-weather" id="tcWeather">${items}</ul>`;
  }

  window.SandyWeather = {
    POP_MIN, COLD_F, HOT_F, WIND_MIN, BUFFER_EXTRA, AHEAD_DAYS,
    isRef, evaluate, message, forecastAt, nwsAlerts, data, html,
    getPrefs, setPrefs, invalidate,
    _test: { upcoming, resolvePoint, THUNDER, SNOW, RAIN, WX_LABEL, readLocal, writeLocal }
  };
})();
