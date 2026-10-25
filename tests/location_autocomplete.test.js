// Browser test of Location autocomplete (OpenStreetMap/Photon fallback; no Google key).
// Run against a copy served with an EMPTY config.js (local mode), e.g.:
//   node tests/location_autocomplete.test.js http://127.0.0.1:8766/
// Set MOCK_PHOTON=1 to stub photon.komoot.io instead of hitting the live service.
const { chromium } = require(process.env.PW || '/workspace/shot-tools/node_modules/playwright-core');
const BASE = process.argv[2] || 'http://127.0.0.1:8766/';
const SHOTS = process.env.SHOTS || '';
const assert = (c, m) => { if (!c) throw new Error('FAIL: ' + m); console.log('ok -', m); };
(async () => {
  const b = await chromium.launch({ executablePath: '/usr/bin/google-chrome', headless: true, args: ['--no-sandbox'] });
  for (const vp of [{ width: 1300, height: 900, name: 'desktop' }, { width: 390, height: 844, name: 'mobile', isMobile: true, hasTouch: true }]) {
    const ctx = await b.newContext({ viewport: { width: vp.width, height: vp.height }, isMobile: !!vp.isMobile, hasTouch: !!vp.hasTouch, timezoneId: 'America/Chicago', locale: 'en-US' });
    const p = await ctx.newPage(); const errs = []; let photonCalls = 0, googleCalls = 0;
    p.on('pageerror', e => errs.push(e.message)); p.on('console', m => { if (m.type() === 'error') errs.push(m.text()); });
    p.on('request', r => { if (r.url().includes('photon.komoot.io')) photonCalls++; if (r.url().includes('googleapis.com')) googleCalls++; });
    if (process.env.MOCK_PHOTON) await ctx.route('https://photon.komoot.io/**', r => r.fulfill({ contentType: 'application/json', headers: { 'access-control-allow-origin': '*' },
      body: JSON.stringify({ features: [{ properties: { osm_key: 'amenity', type: 'house', housenumber: '650', name: 'Maryville University', street: 'Maryville University Drive', city: 'Town and Country', state: 'Missouri', postcode: '63141', countrycode: 'US' } }] }) }));
    await p.goto(BASE + '?view=timeGridWeek'); await p.waitForSelector('.fc-event');
    const tag = `[${vp.name}]`;
    assert(googleCalls === 0, `${tag} no Google script loaded without a key`);

    // ---- new event: type, see suggestions, pick with mouse/tap
    await p.click('#addBtn'); await p.waitForSelector('#eventDialog[open]');
    await p.fill('#eventForm input[name=title]', 'AC test event');
    const loc = p.locator('#fLocation');
    assert(await loc.getAttribute('role') === 'combobox' && await loc.getAttribute('aria-expanded') === 'false', `${tag} location input is an ARIA combobox`);
    await loc.click(); await loc.pressSequentially('Maryville University', { delay: 40 });
    await p.waitForSelector('#fLocationList li', { timeout: 10000 });
    assert(photonCalls >= 1 && photonCalls <= 3, `${tag} debounced: ${photonCalls} Photon request(s) for 20 keystrokes`);
    const opts = await p.locator('#fLocationList li').allTextContents();
    assert(opts.some(t => /Maryville University/.test(t)), `${tag} suggestions shown: ${opts.slice(0, 3).join(' | ')}`);
    assert(/OpenStreetMap/.test(await p.textContent('.loc-field .ac-attrib')), `${tag} OpenStreetMap attribution shown`);
    assert(await loc.getAttribute('aria-expanded') === 'true', `${tag} aria-expanded=true while open`);
    if (SHOTS) await p.screenshot({ path: `${SHOTS}/09-location-autocomplete-${vp.name}.png` });
    const first = p.locator('#fLocationList li').first();
    if (vp.hasTouch) await first.tap(); else await first.click();
    await p.waitForTimeout(200);
    const val = await loc.inputValue();
    assert(/^Maryville University, 650 Maryville University Dr, .+, MO 631\d\d$/.test(val), `${tag} picking fills name + full address: "${val}"`);
    assert(await p.isHidden('.ac-pop'), `${tag} dropdown closes after pick`);
    await p.click('#eventForm button[type=submit]'); await p.waitForTimeout(400);
    let saved = await p.evaluate(async () => (await Store.list()).find(e => e.title === 'AC test event'));
    assert(saved && saved.location === val, `${tag} saved event has the picked location`);

    // ---- edit: keyboard selection, Escape doesn't close dialog, free text still works
    await p.locator('.fc-event:has-text("AC test event")').first().click(); await p.waitForSelector('#eventDialog[open]');
    assert(await loc.inputValue() === val, `${tag} edit form shows saved location`);
    await loc.fill(''); await loc.pressSequentially('Maryville Univ', { delay: 30 });
    await p.waitForSelector('#fLocationList li', { timeout: 10000 });
    await p.keyboard.press('Escape');
    assert(await p.isHidden('.ac-pop') && await p.isVisible('#eventDialog'), `${tag} Escape closes the dropdown, not the dialog`);
    await loc.pressSequentially('ersity', { delay: 30 });
    await p.waitForSelector('#fLocationList li', { timeout: 10000 });
    await p.keyboard.press('ArrowDown');
    assert(await p.locator('#fLocationList li[aria-selected=true]').count() === 1 && !!(await loc.getAttribute('aria-activedescendant')), `${tag} ArrowDown highlights an option`);
    await p.keyboard.press('Enter'); await p.waitForTimeout(200);
    assert(await p.isVisible('#eventDialog') && /^Maryville University, /.test(await loc.inputValue()), `${tag} Enter picks the option without submitting the form`);
    await loc.fill('Coach Dake\'s driveway (free text)');
    await p.waitForTimeout(150);
    await loc.press('Enter'); // no option active -> submits the form as before
    await p.waitForTimeout(500);
    saved = await p.evaluate(async () => (await Store.list()).find(e => e.title === 'AC test event'));
    assert(!(await p.isVisible('#eventDialog')) && saved.location === "Coach Dake's driveway (free text)", `${tag} free text saves (Enter submits when no suggestion is highlighted)`);
    assert(errs.length === 0, `${tag} no page errors ${errs.join(' | ')}`);
    await ctx.close();
  }
  await b.close(); console.log('ALL AUTOCOMPLETE TESTS PASSED');
})().catch(e => { console.error(e); process.exit(1); });
