/*
 * early.js: start the first Supabase reads while the app code is still downloading (t177u #1, 2026-11-01).
 * Before: no data request left until every script had run (~1 MB of JS on a phone), then 2 waves of reads.
 * Now: if this device has a saved sign-in that isn't about to expire and we're online, fire the same GET requests the
 * app makes at start-up (same URLs, same token) right away. storage.js hands them to supabase-js once, through its
 * fetch hook, when the URL + token match exactly and they're < 30 s old; anything else (signed out, offline, token
 * refreshed, error, other user) falls back to the normal request. Reads only: nothing here writes or changes state.
 * The saved copy (snapshot), skeleton and update banner work as before: this only makes the network part start sooner.
 *
 * Inline step (t179u item 2, 2026-11-02): index.html has a copy of this in <head>, before the stylesheets, so the reads
 * start ~2 s sooner on a cold open. That copy can't see config.js yet, so this file saves {url, key} from config.js to
 * localStorage ('sandy.earlyCfg') for the next open, and removes it when config.js has no Supabase (local mode). If the
 * inline copy already fired, this file only refreshes that saved config. config.js stays the only source of truth:
 * storage.js uses an early read only when its URL, token AND apikey match what supabase-js sends.
 */
(function () {
  try {
    var C = window.CALENDAR_CONFIG || {}, url = C.SUPABASE_URL, key = C.SUPABASE_ANON_KEY;
    try {
      var want = url && key ? JSON.stringify({ url: url, key: key }) : null;
      if (!want) localStorage.removeItem('sandy.earlyCfg'); else if (localStorage.getItem('sandy.earlyCfg') !== want) localStorage.setItem('sandy.earlyCfg', want);
    } catch (_) {}
    if (window.__sandyEarly) return; // the inline copy in <head> already started them
    if (!url || !key || !window.fetch || navigator.onLine === false) return;
    var ref = (/^https:\/\/([^.]+)\./.exec(url) || [])[1]; if (!ref) return;
    var raw = localStorage.getItem('sb-' + ref + '-auth-token'); if (!raw) return;
    var s = JSON.parse(raw); if (s && s.currentSession) s = s.currentSession;
    if (!s || !s.access_token || !s.expires_at || s.expires_at * 1000 - Date.now() < 120000) return; // near expiry: supabase-js refreshes first
    var base = url.replace(/\/+$/, '') + '/rest/v1/';
    var Q = [
      'events?select=*&order=start_at.asc&offset=0&limit=1000',
      'calendars?select=id%2Cslug%2Cname%2Cshort%2Ccolor%2Csort&order=sort.asc%2Ccreated_at.asc',
      'profiles?select=*',
      'categories?select=calendar%2Cname&order=name.asc',
      'occurrence_notes?select=*&order=occurrence_date.asc&offset=0&limit=1000',
      'occurrence_links?select=event_id%2Coccurrence_date%2Cnotion_url',
      'inbox_items?select=*&order=created_at.asc',
    ];
    var map = {}, h = { apikey: key, authorization: 'Bearer ' + s.access_token, 'accept-profile': 'public' };
    for (var i = 0; i < Q.length; i++) map[base + Q[i]] = fetch(base + Q[i], { headers: h, credentials: 'omit' }).catch(function () { return null; });
    window.__sandyEarly = { token: s.access_token, key: key, t0: Date.now(), map: map, hits: [], via: 'early.js' };
  } catch (_) { /* never block start-up */ }
})();
