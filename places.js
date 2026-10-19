/*
 * places.js: location autocomplete for the event editor's Location field.
 *
 * Providers (picked automatically):
 *   1. Google Places API (New), via the Maps JavaScript API "Place Autocomplete Data API".
 *      Used when config.js has a non-empty GOOGLE_MAPS_API_KEY. The Google script is loaded
 *      lazily (only the first time the event form opens). Each search uses a session token so
 *      the typing + the pick are billed as one session, and the pick only asks for
 *      `formattedAddress` (an Essentials-tier field) to keep cost low.
 *   2. Photon (photon.komoot.io), a free OpenStreetMap search-as-you-type geocoder. Used when no
 *      Google key is set, or if Google fails to load / rejects the key. (Nominatim is NOT used:
 *      its usage policy forbids as-you-type autocomplete.)
 *
 * Results are biased toward the St. Louis / Augusta, MO area. Free text always works: the field
 * is a normal text input and suggestions are optional.
 */
(function () {
  const CFG = window.CALENDAR_CONFIG || {};
  const KEY = (CFG.GOOGLE_MAPS_API_KEY || '').trim();
  const BIAS = { lat: 38.6, lng: -90.4 };          // between St. Louis and Augusta, MO
  const BIAS_RADIUS_M = 50000;
  const MIN_CHARS = 3, DEBOUNCE_MS = 300, MAX_RESULTS = 6;

  // ---------- Google (lazy) ----------
  let googleState = KEY ? 'idle' : 'off';   // off | idle | loading | ready | failed
  let googleLoad = null, placesLib = null, sessionToken = null;
  window.gm_authFailure = function () {     // Google calls this if the key is invalid / not allowed here
    console.warn('Google Maps key was rejected; using OpenStreetMap suggestions instead.');
    googleState = 'failed';
  };
  function loadGoogle() {
    if (googleState === 'off' || googleState === 'failed') return Promise.resolve(null);
    if (googleLoad) return googleLoad;
    googleState = 'loading';
    googleLoad = new Promise((resolve) => {
      window.__sandyMapsReady = async () => {
        try { placesLib = await google.maps.importLibrary('places'); googleState = 'ready'; resolve(placesLib); }
        catch (e) { console.warn('Google Places failed to load:', e); googleState = 'failed'; resolve(null); }
      };
      const s = document.createElement('script');
      s.src = 'https://maps.googleapis.com/maps/api/js?' + new URLSearchParams({
        key: KEY, v: 'weekly', loading: 'async', libraries: 'places', callback: '__sandyMapsReady', language: 'en', region: 'US',
      });
      s.async = true;
      s.onerror = () => { console.warn('Google Maps script could not load.'); googleState = 'failed'; resolve(null); };
      document.head.appendChild(s);
    });
    return googleLoad;
  }
  const usingGoogle = () => googleState === 'ready';

  async function googleSuggest(q) {
    if (!sessionToken) sessionToken = new placesLib.AutocompleteSessionToken();
    const { suggestions } = await placesLib.AutocompleteSuggestion.fetchAutocompleteSuggestions({
      input: q, sessionToken,
      locationBias: { center: BIAS, radius: BIAS_RADIUS_M },
      origin: BIAS, includedRegionCodes: ['us'], language: 'en-US', region: 'us',
    });
    return suggestions.filter(s => s.placePrediction).slice(0, MAX_RESULTS).map(s => {
      const p = s.placePrediction;
      const main = p.mainText ? p.mainText.toString() : p.text.toString();
      const secondary = p.secondaryText ? p.secondaryText.toString() : '';
      return {
        main, secondary, provider: 'google',
        quick: stripCountry(p.text.toString()),
        resolve: async () => {
          const place = p.toPlace();
          await place.fetchFields({ fields: ['formattedAddress'] }); // ends the billing session
          return joinNameAddress(main, stripCountry(place.formattedAddress || ''));
        },
      };
    });
  }

  // ---------- Photon / OpenStreetMap ----------
  const STATES = { Alabama: 'AL', Alaska: 'AK', Arizona: 'AZ', Arkansas: 'AR', California: 'CA', Colorado: 'CO', Connecticut: 'CT', Delaware: 'DE', 'District of Columbia': 'DC', Florida: 'FL', Georgia: 'GA', Hawaii: 'HI', Idaho: 'ID', Illinois: 'IL', Indiana: 'IN', Iowa: 'IA', Kansas: 'KS', Kentucky: 'KY', Louisiana: 'LA', Maine: 'ME', Maryland: 'MD', Massachusetts: 'MA', Michigan: 'MI', Minnesota: 'MN', Mississippi: 'MS', Missouri: 'MO', Montana: 'MT', Nebraska: 'NE', Nevada: 'NV', 'New Hampshire': 'NH', 'New Jersey': 'NJ', 'New Mexico': 'NM', 'New York': 'NY', 'North Carolina': 'NC', 'North Dakota': 'ND', Ohio: 'OH', Oklahoma: 'OK', Oregon: 'OR', Pennsylvania: 'PA', 'Rhode Island': 'RI', 'South Carolina': 'SC', 'South Dakota': 'SD', Tennessee: 'TN', Texas: 'TX', Utah: 'UT', Vermont: 'VT', Virginia: 'VA', Washington: 'WA', 'West Virginia': 'WV', Wisconsin: 'WI', Wyoming: 'WY' };
  const SUFFIX = { Drive: 'Dr', Boulevard: 'Blvd', Street: 'St', Avenue: 'Ave', Road: 'Rd', Lane: 'Ln', Court: 'Ct', Parkway: 'Pkwy', Highway: 'Hwy', Place: 'Pl', Circle: 'Cir', Terrace: 'Ter', Trail: 'Trl' };
  const DIR = { North: 'N', South: 'S', East: 'E', West: 'W' };
  function shortStreet(st) {
    if (!st) return '';
    const w = st.split(' ');
    if (w.length > 1 && DIR[w[0]]) w[0] = DIR[w[0]];
    const last = w.length - 1;
    if (last > 0 && SUFFIX[w[last]]) w[last] = SUFFIX[w[last]];
    return w.join(' ');
  }
  function photonFormat(pr) {
    const us = pr.countrycode === 'US';
    const street = [pr.housenumber, us ? shortStreet(pr.street) : pr.street].filter(Boolean).join(' ');
    const region = [us ? (STATES[pr.state] || pr.state) : pr.state, pr.postcode].filter(Boolean).join(' ');
    const isStreet = pr.osm_key === 'highway' || pr.type === 'street';
    const name = isStreet ? (us ? shortStreet(pr.name) : pr.name) : pr.name;
    const parts = [street && street !== name ? street : '', pr.city || pr.district || pr.county, region, us ? '' : pr.country].filter(Boolean);
    const secondary = parts.join(', ');
    return { main: name || street || pr.city || '', secondary };
  }
  let photonAbort = null;
  async function photonSuggest(q) {
    if (photonAbort) photonAbort.abort();
    photonAbort = new AbortController();
    const url = 'https://photon.komoot.io/api/?' + new URLSearchParams({ q, lat: BIAS.lat, lon: BIAS.lng, limit: MAX_RESULTS + 2, lang: 'en' });
    const r = await fetch(url, { signal: photonAbort.signal });
    if (!r.ok) throw new Error('Photon ' + r.status);
    const j = await r.json();
    const seen = new Set();
    return (j.features || []).map(ft => {
      const { main, secondary } = photonFormat(ft.properties || {});
      const full = joinNameAddress(main, secondary);
      return { main, secondary, provider: 'osm', quick: full, resolve: async () => full };
    }).filter(s => s.main && !seen.has(s.quick) && seen.add(s.quick)).slice(0, MAX_RESULTS);
  }

  // ---------- helpers ----------
  function stripCountry(s) { return (s || '').replace(/,\s*(USA|United States)$/i, ''); }
  function joinNameAddress(name, addr) {
    if (!addr) return name;
    if (!name || addr.toLowerCase().startsWith(name.toLowerCase())) return addr;
    return `${name}, ${addr}`;
  }

  // ---------- UI: accessible combobox ----------
  function attach(input, { onWarm } = {}) {
    const wrap = input.closest('.ac-wrap');
    const list = wrap.querySelector('.ac-list');
    const attrib = wrap.querySelector('.ac-attrib');
    const status = wrap.querySelector('.ac-status');
    const pop = wrap.querySelector('.ac-pop');
    input.setAttribute('role', 'combobox');
    input.setAttribute('aria-autocomplete', 'list');
    input.setAttribute('aria-expanded', 'false');
    input.setAttribute('aria-controls', list.id);
    input.setAttribute('autocomplete', 'off');
    let items = [], active = -1, timer = null, seq = 0, lastQ = '';

    function close() {
      pop.hidden = true; list.innerHTML = ''; items = []; active = -1;
      input.setAttribute('aria-expanded', 'false'); input.removeAttribute('aria-activedescendant');
    }
    function setActive(i) {
      active = i;
      [...list.children].forEach((li, k) => li.setAttribute('aria-selected', String(k === i)));
      if (i >= 0) { input.setAttribute('aria-activedescendant', list.children[i].id); list.children[i].scrollIntoView({ block: 'nearest' }); }
      else input.removeAttribute('aria-activedescendant');
    }
    function render(res, provider) {
      items = res; active = -1;
      if (!res.length) { close(); status.textContent = 'No suggestions'; return; }
      list.innerHTML = '';
      res.forEach((s, i) => {
        const li = document.createElement('li');
        li.id = `${list.id}-opt-${i}`; li.setAttribute('role', 'option'); li.setAttribute('aria-selected', 'false');
        const m = document.createElement('span'); m.className = 'ac-main'; m.textContent = s.main;
        const sec = document.createElement('span'); sec.className = 'ac-sec'; sec.textContent = s.secondary;
        li.append(m, sec);
        li.addEventListener('pointerdown', e => e.preventDefault()); // keep focus in the input
        li.addEventListener('click', () => pick(i));
        list.appendChild(li);
      });
      attrib.innerHTML = provider === 'google'
        ? 'Suggestions from Google Maps'
        : 'Suggestions from <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">© OpenStreetMap</a> contributors via <a href="https://photon.komoot.io" target="_blank" rel="noopener">Photon</a>';
      pop.hidden = false; input.setAttribute('aria-expanded', 'true');
      status.textContent = `${res.length} suggestion${res.length === 1 ? '' : 's'}. Use up and down arrows to choose.`;
      pop.scrollIntoView({ block: 'nearest' });
    }
    async function search(q) {
      const my = ++seq;
      let res = [], provider = 'osm';
      try {
        if (googleState === 'loading' || googleState === 'idle') await loadGoogle();
        if (usingGoogle()) {
          try { res = await googleSuggest(q); provider = 'google'; }
          catch (e) { console.warn('Google autocomplete failed, using OpenStreetMap:', e); googleState = 'failed'; }
        }
        if (provider !== 'google') res = await photonSuggest(q);
      } catch (e) { if (e.name !== 'AbortError') console.warn('Location suggestions unavailable:', e); return; }
      if (my !== seq || input.value.trim() !== q || document.activeElement !== input) return;
      render(res, provider);
    }
    async function pick(i) {
      const s = items[i]; if (!s) return;
      seq++; clearTimeout(timer); close();
      input.value = s.quick; lastQ = s.quick;
      input.dispatchEvent(new CustomEvent('place-picked', { detail: { provider: s.provider } }));
      try { const full = await s.resolve(); if (input.value === s.quick && full) { input.value = full; lastQ = full; } }
      catch (e) { console.warn('Could not get the full address:', e); }
      finally { if (s.provider === 'google') sessionToken = null; } // next search starts a new session
      input.dispatchEvent(new CustomEvent('place-resolved', { detail: { value: input.value } }));
    }

    input.addEventListener('focus', () => { loadGoogle(); if (onWarm) onWarm(); });
    input.addEventListener('input', () => {
      clearTimeout(timer);
      const q = input.value.trim();
      if (q.length < MIN_CHARS) { seq++; close(); return; }
      if (q === lastQ) return;
      timer = setTimeout(() => { lastQ = q; search(q); }, DEBOUNCE_MS);
    });
    input.addEventListener('keydown', e => {
      const open = !pop.hidden && items.length;
      if (e.key === 'ArrowDown' && open) { e.preventDefault(); setActive((active + 1) % items.length); }
      else if (e.key === 'ArrowUp' && open) { e.preventDefault(); setActive(active <= 0 ? items.length - 1 : active - 1); }
      else if (e.key === 'Enter' && open && active >= 0) { e.preventDefault(); pick(active); }
      else if (e.key === 'Escape' && open) { e.preventDefault(); e.stopPropagation(); seq++; close(); }
      else if (e.key === 'Tab') close();
    });
    input.addEventListener('blur', () => setTimeout(close, 150));
    return { close, reset() { seq++; clearTimeout(timer); lastQ = ''; close(); status.textContent = ''; } };
  }

  window.Places = {
    attach,
    warm: loadGoogle,                     // call when the event form opens (lazy Google load)
    provider: () => (usingGoogle() ? 'google' : (googleState === 'loading' || googleState === 'idle') ? 'google-pending' : 'osm'),
    _test: { photonFormat, joinNameAddress, stripCountry },
  };
})();
