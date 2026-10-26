/* SANDY - Sandy Intelligence: Away-game travel plan on the Today tab.
   For Maryville University and Harris-Stowe (HSSU) AWAY and NEUTRAL games in the next 3 days (games.js decides
   the team and home/away/neutral):
     - departure: leave home (Profile → Home) in time to arrive ARRIVE_EARLY_MIN before tip-off, using the same free
       OSM drive time as leave-by. With no Profile home, Maryville trips start from Maryville University and HSSU
       trips use the "Drive from home" line in the game's notes (HSSU events carry it); if routing fails, the
       game's notes "Drive from …" line is used;
     - estimated return: game end (or tip-off + 2 h) + POST_GAME_MIN + the drive back;
     - weather at the venue at tip-off from Open-Meteo (free, no key; forecasts up to 16 days), cached 1 hour.
   Times are Central (event wall clock); Open-Meteo is asked for America/Chicago times so they line up. */
(function () {
  'use strict';
  const MIN = 60000, HOUR = 60 * MIN, DAY = 24 * HOUR;
  const AHEAD_DAYS = 3, ARRIVE_EARLY_MIN = 60, POST_GAME_MIN = 30, DEFAULT_GAME_MIN = 120, FORECAST_DAYS = 16, MAX_GAMES = 2;
  const WX_URL = 'https://api.open-meteo.com/v1/forecast', WX_KEY = 'sandy.wx.v1', WX_TTL = HOUR;
  const MARYVILLE = { address: 'Maryville University, 650 Maryville University Dr, St. Louis, MO 63141', label: 'Maryville University' };
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const t12 = d => { let h = d.getUTCHours(); const m = d.getUTCMinutes(); const ap = h < 12 ? 'AM' : 'PM'; h = h % 12 || 12; return `${h}:${String(m).padStart(2, '0')} ${ap}`; };
  const dayLbl = (d, today) => { const n = Math.round((Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()) - today.getTime()) / DAY);
    return n === 0 ? 'Today' : n === 1 ? 'Tomorrow' : new Date(d.getTime()).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' }); };
  const ymd = d => d.toISOString().slice(0, 10);
  const dur = m => m < 60 ? `${m} min` : `${Math.floor(m / 60)} hr${m % 60 ? ` ${m % 60} min` : ''}`;
  const floor5 = d => new Date(Math.floor(d.getTime() / (5 * MIN)) * 5 * MIN);
  const ceil5 = d => new Date(Math.ceil(d.getTime() / (5 * MIN)) * 5 * MIN);

  const TEAMS = new Set(['maryville', 'hssu', 'jennings']);
  const TEAM_TAG = { hssu: 'HSSU', jennings: 'Jennings' }; // small coloured tag in the card header (Maryville: none)
  /** Maryville, HSSU or Jennings away / neutral game? (games.js info: team from the category or title) */
  function isTrip(ev) {
    if (!ev || ev.kind === 'task' || !window.SandyGames) return null;
    const g = SandyGames.info(ev); if (!g || (g.ha !== 'A' && g.ha !== 'N')) return null;
    // the team must be named on the event (games.js falls back to Maryville's look for unnamed teams)
    const names = String(ev.category || '') + ' ' + String(ev.title || '');
    if (!TEAMS.has(g.team) || !(window.SandyGames.TEAMS || []).some(t => t.id === g.team && t.re.test(names))) return null;
    return g;
  }
  /** "about 5 hr 59 min" / "5 h 59 m" / "45 min" -> minutes */
  function parseDur(s) {
    s = String(s || ''); const h = s.match(/(\d+)\s*(?:hr|hour|h)\b/i), m = s.match(/(\d+)\s*(?:min|m)\b/i);
    const v = (h ? +h[1] * 60 : 0) + (m ? +m[1] : 0); return v > 0 ? v : null;
  }
  async function games(a, now) {
    const today = a.startOfDay(now), until = a.addDays(today, AHEAD_DAYS + 1);
    const vis = a.settings().visible;
    const out = [];
    for (const ev of await a.Store.list()) {
      if (vis[ev.calendar] === false || ev.allDay) continue;
      const g = isTrip(ev); if (!g) continue;
      for (const o of a.occurrences(ev, today, until)) {
        const end = o.end && o.end > o.start ? o.end : new Date(o.start.getTime() + DEFAULT_GAME_MIN * MIN);
        if (end <= now) continue;
        out.push({ ev, o, g, end });
      }
    }
    return out.sort((x, y) => x.o.start - y.o.start).slice(0, MAX_GAMES);
  }
  /** Departure / return times. drive = { mins, from: label, source: 'route' | 'notes' } */
  function plan(x, drive) {
    const leave = floor5(new Date(x.o.start.getTime() - (drive.mins + ARRIVE_EARLY_MIN) * MIN));
    const back = ceil5(new Date(x.end.getTime() + (POST_GAME_MIN + drive.mins) * MIN));
    return { leave, back, overnight: back.getUTCDate() !== x.o.start.getUTCDate() || back.getTime() - x.o.start.getTime() >= DAY };
  }
  async function driveFor(x) {
    const L = window.SandyLeave; let from = null;
    if (L) { const h = await L.getHome(); if (h && h.address) from = { kind: 'home', label: 'home', address: h.address, lat: h.lat, lon: h.lon }; }
    if (!from && x.g.team === 'maryville') from = { kind: 'campus', label: MARYVILLE.label, address: MARYVILLE.address };
    if (from && L && x.g.location) { const r = await L.drive(from, x.g.location); if (r && r.ok) return { mins: r.mins, miles: r.miles, from: from.label, source: 'route' }; }
    const n = parseDur(x.g.drive); // the game's notes: "Drive from Maryville University: …" / "Drive from home: …" (HSSU)
    if (n) { const f = String(x.g.from || (x.g.team === 'maryville' ? MARYVILLE.label : 'home')); return { mins: n, miles: x.g.miles, from: /^home$/i.test(f) ? 'home' : f, source: 'notes' }; }
    return null;
  }

  // ---------- weather (Open-Meteo, free, no key)
  const WX = { 0: ['☀️', 'Clear'], 1: ['🌤️', 'Mostly clear'], 2: ['⛅', 'Partly cloudy'], 3: ['☁️', 'Cloudy'], 45: ['🌫️', 'Fog'], 48: ['🌫️', 'Freezing fog'],
    51: ['🌦️', 'Light drizzle'], 53: ['🌦️', 'Drizzle'], 55: ['🌧️', 'Heavy drizzle'], 56: ['🌧️', 'Freezing drizzle'], 57: ['🌧️', 'Freezing drizzle'],
    61: ['🌦️', 'Light rain'], 63: ['🌧️', 'Rain'], 65: ['🌧️', 'Heavy rain'], 66: ['🌧️', 'Freezing rain'], 67: ['🌧️', 'Freezing rain'],
    71: ['🌨️', 'Light snow'], 73: ['🌨️', 'Snow'], 75: ['❄️', 'Heavy snow'], 77: ['🌨️', 'Snow grains'], 80: ['🌦️', 'Showers'], 81: ['🌧️', 'Showers'], 82: ['⛈️', 'Heavy showers'],
    85: ['🌨️', 'Snow showers'], 86: ['❄️', 'Heavy snow showers'], 95: ['⛈️', 'Thunderstorms'], 96: ['⛈️', 'Thunderstorms, hail'], 99: ['⛈️', 'Thunderstorms, hail'] };
  const wxMem = new Map();
  function readWx() { try { return JSON.parse(localStorage.getItem(WX_KEY) || '{}'); } catch (_) { return {}; } }
  function putWx(k, v) { try { const c = readWx(); c[k] = v; for (const x of Object.keys(c)) if (Date.now() - c[x].t > DAY) delete c[x]; localStorage.setItem(WX_KEY, JSON.stringify(c)); } catch (_) {} }
  /** Forecast at a place for a wall-clock hour (Central). {ok, temp, pop, code, wind} | {ok:false, why:'far'|'fail'} */
  async function weather(lat, lon, at, now) {
    if (at.getTime() - now.getTime() > (FORECAST_DAYS - 1) * DAY) return { ok: false, why: 'far' };
    const date = ymd(at), k = `${(+lat).toFixed(2)},${(+lon).toFixed(2)},${date}`;
    let hit = wxMem.get(k) || readWx()[k];
    if (!hit || Date.now() - hit.t > WX_TTL) {
      if (!hit && Date.now() - (wxMem.get('f:' + k) || 0) < 10 * MIN) return { ok: false, why: 'fail' }; // failed recently: don't hammer the service
      if (!wxMem.has('p:' + k)) wxMem.set('p:' + k, (async () => {
        try {
          const q = new URLSearchParams({ latitude: (+lat).toFixed(3), longitude: (+lon).toFixed(3), hourly: 'temperature_2m,precipitation_probability,weather_code,wind_speed_10m',
            temperature_unit: 'fahrenheit', wind_speed_unit: 'mph', timezone: 'America/Chicago', start_date: date, end_date: date });
          const r = await fetch(WX_URL + '?' + q); if (!r.ok) return null;
          const j = await r.json(); const h = j && j.hourly; if (!h || !Array.isArray(h.time)) return null;
          const v = { t: Date.now(), time: h.time, temp: h.temperature_2m, pop: h.precipitation_probability, code: h.weather_code, wind: h.wind_speed_10m };
          wxMem.set(k, v); putWx(k, v); return v;
        } catch (_) { return null; } finally { wxMem.delete('p:' + k); }
      })());
      const fresh = await wxMem.get('p:' + k) || null; if (fresh) hit = fresh;
      else { wxMem.set('f:' + k, Date.now()); if (!hit) return { ok: false, why: 'fail' }; }
    }
    const want = `${date}T${String(at.getUTCHours()).padStart(2, '0')}:00`;
    const i = hit.time.indexOf(want); if (i < 0 || hit.temp[i] == null) return { ok: false, why: 'fail' };
    return { ok: true, temp: Math.round(hit.temp[i]), pop: hit.pop && hit.pop[i] != null ? Math.round(hit.pop[i]) : null, code: hit.code ? hit.code[i] : null, wind: hit.wind && hit.wind[i] != null ? Math.round(hit.wind[i]) : null };
  }
  function wxText(w) {
    if (!w || !w.ok) return w && w.why === 'far' ? 'Forecast shows up about 2 weeks out.' : 'Weather unavailable right now.';
    const [ic, txt] = WX[w.code] || ['🌡️', 'Forecast'];
    return `${ic} ${w.temp}°F, ${txt.toLowerCase()}${w.pop != null ? ` · ${w.pop}% chance of rain/snow` : ''}${w.wind != null && w.wind >= 15 ? ` · wind ${w.wind} mph` : ''}`;
  }

  // ---------- rendering
  function shell(list, today) {
    return list.map((x, i) => `<section class="tc-sec tc-card tc-travel tv-team-${esc(x.g.team)}" id="tcTravel${i}" data-id="${esc(x.ev.id)}" data-key="${esc(x.o.key)}" aria-label="Travel plan">
      <h3>🚌 Travel plan <span class="tv-kind">· ${TEAM_TAG[x.g.team] ? `<span class="tv-team">${TEAM_TAG[x.g.team]}</span> · ` : ''}${x.g.ha === 'A' ? 'Away' : 'Neutral site'}</span></h3>
      <p class="tc-next tv-game"><span class="tc-next-k">Game</span><span class="tc-next-v"><button type="button" class="tc-link tc-item" data-id="${esc(x.ev.id)}" data-key="${esc(x.o.key)}">${esc(x.ev.title)}</button> <span class="tv-when">${esc(dayLbl(x.o.start, today))} ${esc(t12(x.o.start))}</span></span></p>
      ${x.g.location ? `<p class="tv-venue">📍 <a href="${esc(SandyGames.mapsUrl(x.g.location))}" target="_blank" rel="noopener noreferrer">${esc(x.g.location)}</a></p>` : ''}
      ${(x.g.team === 'hssu' || x.g.team === 'jennings') && x.g.url && x.g.dirFrom ? `<p class="tv-venue tv-dir"><a href="${esc(x.g.url)}" target="_blank" rel="noopener noreferrer">🧭 Directions from ${esc(x.g.dirFrom)}</a></p>` : ''}
      <ul class="tv-rows" aria-live="polite"><li class="tv-pending" data-state="pending">Working out the trip…</li></ul></section>`).join('');
  }
  async function fill(sec, x, now) {
    const rows = sec.querySelector('.tv-rows');
    const dr = await driveFor(x);
    let h = '';
    if (dr) {
      const p = plan(x, dr);
      h += `<li class="tv-leave" data-state="ok" data-leave="${esc(t12(p.leave))}" data-back="${esc(t12(p.back))}"><span class="tv-k">Leave</span><span class="tv-v"><b>${esc(dayLbl(p.leave, x.today))} ${esc(t12(p.leave))}</b> from ${esc(dr.from)} <span class="tv-sub">${esc(dur(dr.mins))} drive${dr.miles ? `, ${esc(dr.miles)} mi` : ''} · there ${ARRIVE_EARLY_MIN} min before tip-off</span></span></li>`;
      h += `<li class="tv-back"><span class="tv-k">Back</span><span class="tv-v"><b>about ${esc(p.overnight ? dayLbl(p.back, x.today) + ' ' : '')}${esc(t12(p.back))}</b> <span class="tv-sub">${x.o.end && x.o.end > x.o.start ? `game ends ${esc(t12(x.end))}` : 'if the game runs 2 hr'} + ${POST_GAME_MIN} min + drive</span></span></li>`;
      if (dr.source === 'notes') h += `<li class="tv-note"><span class="tv-k"></span><span class="tv-v tv-sub">Drive time from the game's notes (from ${esc(dr.from)}).</span></li>`;
    } else h += `<li class="tv-leave" data-state="fail"><span class="tv-k">Leave</span><span class="tv-v">Couldn't work out the drive${x.g.location ? '' : ' (no venue on the event)'}.</span></li>`;
    h += `<li class="tv-wx" data-state="pending"><span class="tv-k">Weather</span><span class="tv-v tv-wxv">Checking the forecast…</span></li>`;
    if (!sec.isConnected) return;
    rows.innerHTML = h;
    let w = { ok: false, why: 'fail' };
    if (x.g.location && window.SandyLeave) { const g = await SandyLeave.geocode(x.g.location); if (g && g.ok) w = await weather(g.lat, g.lon, x.o.start, now); }
    const li = rows.querySelector('.tv-wx'); if (!li || !sec.isConnected) return;
    li.dataset.state = w.ok ? 'ok' : w.why; li.querySelector('.tv-wxv').innerHTML = `${esc(wxText(w))}${w.ok ? ' <span class="tv-sub">at tip-off · Open-Meteo</span>' : ''}`;
  }
  async function render(container, a, now) {
    const list = await games(a, now);
    if (!list.length) return null;
    const today = a.startOfDay(now); list.forEach(x => { x.today = today; });
    return { html: shell(list, today), list, run: () => Promise.all(list.map((x, i) => { const s = document.getElementById('tcTravel' + i); return s ? fill(s, x, now).catch(e => console.warn('travel:', e)) : null; })) };
  }
  window.SandyTravel = { isTrip, games, plan, parseDur, weather, wxText, render, ARRIVE_EARLY_MIN, POST_GAME_MIN, AHEAD_DAYS };
})();
