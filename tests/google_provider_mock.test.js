// Checks the Google Places code path with a MOCKED Maps JS API (no real key or network).
// Verifies: lazy load only when the form opens, location bias, session token reuse + renewal,
// formattedAddress-only details fetch, Google attribution, and fallback to OSM on key rejection.
const { chromium } = require(process.env.PW || '/workspace/shot-tools/node_modules/playwright-core');
const BASE = process.argv[2] || 'http://127.0.0.1:8766/';
const assert = (c, m) => { if (!c) throw new Error('FAIL: ' + m); console.log('ok -', m); };
const MOCK = `(() => {
  const log = window.__gmLog = { requests: [], tokens: new Set(), fetchFields: [] };
  let n = 0;
  class AutocompleteSessionToken { constructor() { this.id = ++n; } }
  const txt = s => ({ toString: () => s });
  const AutocompleteSuggestion = { async fetchAutocompleteSuggestions(req) {
    if (window.__gmReject) throw new Error('ApiNotActivatedMapError');
    log.requests.push(req); log.tokens.add(req.sessionToken.id);
    return { suggestions: [{ placePrediction: { text: txt('Maryville University, Maryville University Drive, St. Louis, MO, USA'),
      mainText: txt('Maryville University'), secondaryText: txt('Maryville University Drive, St. Louis, MO, USA'),
      toPlace: () => ({ async fetchFields(o) { log.fetchFields.push(o.fields); this.formattedAddress = '650 Maryville University Dr, St. Louis, MO 63141, USA'; } }) } }] };
  } };
  window.google = { maps: { importLibrary: async lib => lib === 'places' ? { AutocompleteSessionToken, AutocompleteSuggestion } : {} } };
  const cb = new URL(document.currentScript.src).searchParams.get('callback'); setTimeout(() => window[cb](), 0);
})();`;
(async () => {
  const b = await chromium.launch({ executablePath: '/usr/bin/google-chrome', headless: true, args: ['--no-sandbox'] });
  const ctx = await b.newContext({ viewport: { width: 1300, height: 900 }, timezoneId: 'America/Chicago' });
  const scriptUrls = [];
  await ctx.route('**/config.js', r => r.fulfill({ contentType: 'application/javascript', body: "window.CALENDAR_CONFIG = { GOOGLE_MAPS_API_KEY: 'TEST_KEY' };" }));
  await ctx.route('https://maps.googleapis.com/**', r => { scriptUrls.push(r.request().url()); r.fulfill({ contentType: 'application/javascript', body: MOCK }); });
  let photon = 0; await ctx.route('https://photon.komoot.io/**', r => { photon++; r.fulfill({ contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: '{"features":[{"properties":{"name":"OSM Place","city":"Augusta","state":"Missouri","countrycode":"US"}}]}' }); });
  const p = await ctx.newPage(); const errs = []; p.on('pageerror', e => errs.push(e.message));
  await p.goto(BASE + '?view=timeGridWeek'); await p.waitForSelector('.fc-event'); await p.waitForTimeout(300);
  assert(scriptUrls.length === 0, 'Google script NOT loaded on page load');
  await p.click('#addBtn:visible, #railNew:visible'); await p.waitForTimeout(300);
  assert(scriptUrls.length === 1 && /key=TEST_KEY/.test(scriptUrls[0]) && /libraries=places/.test(scriptUrls[0]), 'Google script loaded lazily when the form opens');
  const loc = p.locator('#fLocation');
  await loc.click(); await loc.pressSequentially('Maryville University gym', { delay: 30 });
  await p.waitForSelector('#fLocationList li');
  assert(/Google Maps/.test(await p.textContent('.loc-field .ac-attrib')), 'Google attribution shown');
  const log1 = await p.evaluate(() => ({ req: __gmLog.requests[0], tokens: [...__gmLog.tokens] }));
  assert(log1.req.locationBias.center.lat === 38.6 && log1.req.locationBias.center.lng === -90.4 && log1.req.locationBias.radius === 50000, 'location bias 50 km around 38.6,-90.4');
  await loc.pressSequentially(' 2', { delay: 400 }); await p.waitForTimeout(500);
  const log2 = await p.evaluate(() => ({ n: __gmLog.requests.length, tokens: [...__gmLog.tokens] }));
  assert(log2.n >= 2 && log2.tokens.length === 1, `same session token reused across ${log2.n} requests`);
  await p.locator('#fLocationList li').first().click(); await p.waitForTimeout(200);
  assert(await loc.inputValue() === 'Maryville University, 650 Maryville University Dr, St. Louis, MO 63141', 'pick fills "Maryville University, 650 Maryville University Dr, St. Louis, MO 63141"');
  assert(JSON.stringify(await p.evaluate(() => __gmLog.fetchFields)) === '[["formattedAddress"]]', 'details fetch asks only for formattedAddress');
  await loc.fill(''); await loc.pressSequentially('Jennings', { delay: 30 }); await p.waitForSelector('#fLocationList li');
  assert((await p.evaluate(() => __gmLog.tokens.size)) === 2, 'new session token after a pick');
  await p.evaluate(() => { window.__gmReject = true; });
  await loc.fill(''); await loc.pressSequentially('Augusta', { delay: 30 }); await p.waitForSelector('#fLocationList li:has-text("OSM Place")');
  assert(photon >= 1 && /OpenStreetMap/.test(await p.textContent('.loc-field .ac-attrib')), 'falls back to OpenStreetMap if Google errors');
  assert(errs.length === 0, 'no page errors ' + errs.join(' | '));
  await b.close(); console.log('ALL GOOGLE-MOCK TESTS PASSED');
})().catch(e => { console.error(e); process.exit(1); });
