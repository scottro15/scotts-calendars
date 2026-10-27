// Browser test: SI #8 Weather Heads Up. Local mode, 390px. Open-Meteo + NWS + Photon mocked.
//   node tests/weather_ui.test.js http://127.0.0.1:8780/ /workspace/shots-si8
const { chromium } = require(process.env.PW || '/usr/local/lib/pnpm/5/.pnpm/playwright-core@1.59.1/node_modules/playwright-core');
const fs = require('fs');
const BASE = process.argv[2] || 'http://127.0.0.1:8780/';
const SHOTS = process.argv[3] || '/workspace/shots-si8';
fs.mkdirSync(SHOTS, { recursive: true });
const assert = (c, m) => { if (!c) throw new Error('FAIL: ' + m); console.log('ok -', m); };

(async () => {
  const b = await chromium.launch({ executablePath: '/usr/bin/google-chrome', headless: true, args: ['--no-sandbox'] });
  async function open({ at, dark = false, rain = true, cold = false }) {
    const ctx = await b.newContext({
      viewport: { width: 390, height: 844 }, timezoneId: 'America/Chicago', locale: 'en-US',
      isMobile: true, hasTouch: true, deviceScaleFactor: 2, reducedMotion: 'reduce',
      colorScheme: dark ? 'dark' : 'light'
    });
    await ctx.route('**/config.js', r => r.fulfill({
      contentType: 'application/javascript',
      body: "window.CALENDAR_CONFIG = { APP_NAME: 'SANDY', SUPABASE_URL: '', SUPABASE_ANON_KEY: '', OWNER_EMAIL: '' };"
    }));
    await ctx.route('https://api.open-meteo.com/**', r => {
      const date = new URL(r.request().url()).searchParams.get('start_date');
      const time = Array.from({ length: 24 }, (_, h) => `${date}T${String(h).padStart(2, '0')}:00`);
      const temp = time.map(() => cold ? 28 : 55);
      const pop = time.map(() => rain ? 70 : 10);
      const code = time.map(() => rain ? 63 : 1);
      const wind = time.map(() => 8);
      r.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' },
        body: JSON.stringify({ hourly: { time, temperature_2m: temp, precipitation_probability: pop, weather_code: code, wind_speed_10m: wind } }) });
    });
    await ctx.route('https://api.weather.gov/**', r => r.fulfill({
      status: 200, contentType: 'application/geo+json', headers: { 'access-control-allow-origin': '*' },
      body: JSON.stringify({ features: [] })
    }));
    await ctx.route('https://photon.komoot.io/**', r => r.fulfill({
      status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' },
      body: JSON.stringify({ features: [{ geometry: { coordinates: [-90.3, 38.6] }, properties: { name: 'Banterra Center' } }] })
    }));
    await ctx.addInitScript(d => {
      localStorage.clear();
      localStorage.setItem('sandy.welcome.off', '1');
      localStorage.setItem('sandy.tour.off', '1');
      // Fake home coords only (no address string required for weather via home)
      localStorage.setItem('sandy.home.v1', JSON.stringify({ address: 'Home', lat: 38.6, lon: -90.3 }));
      if (d) localStorage.setItem('sandy.theme', 'dark');
    }, dark);
    const p = await ctx.newPage();
    const errs = []; p.on('pageerror', e => errs.push(e.message));
    await p.clock.install({ time: new Date(at) });
    await p.goto(BASE);
    await p.waitForFunction(() => window.__app && window.SandyWeather && document.querySelector('#bottomNav'), null, { timeout: 20000 });
    return { ctx, p, errs };
  }
  const clear = async p => p.evaluate(async () => {
    const S = window.__app.Store;
    if (S.clearExamples) await S.clearExamples();
    for (const e of await S.list()) { try { await S.remove(e.id); } catch (_) {} }
  });
  const goToday = async p => { await p.click('#bottomNav button[data-tab="today"]'); await p.waitForSelector('#todayBody'); await p.waitForTimeout(900); };
  const shot = async (p, name, sel = '.tc-heads') => {
    await p.evaluate(sel => {
      const t = document.getElementById('toast'); if (t) t.hidden = true;
      const el = document.querySelector(sel); if (el) { el.hidden = false; el.scrollIntoView({ block: 'start' }); }
    }, sel);
    await p.waitForTimeout(250);
    await p.screenshot({ path: `${SHOTS}/${name}.png`, fullPage: false });
  };

  // Rain for evening game with location
  {
    const { ctx, p, errs } = await open({ at: '2026-10-26T19:00:00Z', rain: true });
    await clear(p);
    await p.evaluate(async () => {
      await window.__app.Store.save({
        id: crypto.randomUUID(), kind: 'event', title: 'Maryville University @ SIU - AWAY',
        calendar: 'mam', category: 'Game – Maryville University', allDay: false, recurrence: { freq: 'none' },
        location: 'Banterra Center, Carbondale, IL', notes: '', start: '2026-10-26T17:00', end: '2026-10-26T19:00'
      });
      await window.__app.Store.save({
        id: crypto.randomUUID(), kind: 'event', title: 'Christian DAKE Workout',
        calendar: 'mam', category: 'Client workout', allDay: false, recurrence: { freq: 'none' },
        location: 'Gym', notes: '', start: '2026-10-26T16:00', end: '2026-10-26T16:30'
      });
    });
    await goToday(p);
    await p.waitForSelector('#tcWeather', { timeout: 15000 });
    const text = await p.$eval('#tcWeather', el => el.innerText);
    assert(/Rain likely \(70%\)/i.test(text), 'rain line: ' + text);
    assert(/Maryville|SIU/i.test(text), 'event named');
    assert(!/DAKE|Dake/.test(text), 'dake ignored');
    assert(/leave/i.test(text), 'leave buffer hint');
    await shot(p, '01-weather-rain-heads-light');
    assert(!errs.length, 'no errors: ' + errs.join('; '));
    await ctx.close();
  }

  // Dark
  {
    const { ctx, p } = await open({ at: '2026-10-26T19:00:00Z', dark: true, rain: true });
    await clear(p);
    await p.evaluate(async () => {
      await window.__app.Store.save({
        id: crypto.randomUUID(), kind: 'event', title: 'Maryville University @ SIU - AWAY',
        calendar: 'mam', category: 'Game – Maryville University', allDay: false, recurrence: { freq: 'none' },
        location: 'Banterra Center', notes: '', start: '2026-10-26T17:00', end: '2026-10-26T19:00'
      });
    });
    await goToday(p);
    await p.waitForSelector('#tcWeather', { timeout: 12000 });
    await shot(p, '02-weather-rain-heads-dark');
    await p.click('#bottomNav button[data-tab="profile"]');
    await p.waitForSelector('#siWeather');
    await p.evaluate(() => document.querySelector('#siSection')?.scrollIntoView({ block: 'center' }));
    await p.waitForTimeout(200);
    assert(await p.$eval('#siWeather', el => el.checked) === true, 'toggle on');
    await shot(p, '03-profile-si-weather-dark', '#siSection');
    await ctx.close();
  }

  // Cold morning study (home coords, no event location)
  {
    const { ctx, p } = await open({ at: '2026-10-27T01:00:00Z', rain: false, cold: true });
    await clear(p);
    await p.evaluate(async () => {
      window.SandyLeave && window.SandyLeave.invalidate && window.SandyLeave.invalidate();
      window.SandyWeather && window.SandyWeather.invalidate && window.SandyWeather.invalidate();
      await window.__app.Store.save({
        id: crypto.randomUUID(), kind: 'event', title: 'Study: Covenant Code',
        calendar: 'msc', category: 'Study time', allDay: false, recurrence: { freq: 'none' },
        location: '', notes: '', start: '2026-10-27T06:00', end: '2026-10-27T07:00'
      });
      // Ensure home is readable
      const h = await window.SandyLeave.getHome();
      if (!h || !h.lat) throw new Error('home missing: ' + JSON.stringify(h));
    });
    await goToday(p);
    await p.waitForSelector('#tcWeather', { timeout: 12000 });
    const text = await p.$eval('#tcWeather', el => el.innerText);
    assert(/28°F/i.test(text) && /coat|Covenant/i.test(text), 'cold: ' + text);
    await shot(p, '04-weather-cold-heads-light');
    await ctx.close();
  }

  // Profile light + toggle off
  {
    const { ctx, p } = await open({ at: '2026-10-26T19:00:00Z', rain: true });
    await clear(p);
    await p.evaluate(async () => {
      await window.__app.Store.save({
        id: crypto.randomUUID(), kind: 'event', title: 'Maryville @ SIU',
        calendar: 'mam', category: 'Game – Maryville University', allDay: false, recurrence: { freq: 'none' },
        location: 'Banterra Center', notes: '', start: '2026-10-26T17:00', end: '2026-10-26T19:00'
      });
    });
    await p.click('#bottomNav button[data-tab="profile"]');
    await p.waitForSelector('#siWeather');
    await p.evaluate(() => document.querySelector('#siSection')?.scrollIntoView({ block: 'center' }));
    await shot(p, '05-profile-si-weather-light', '#siSection');
    await p.click('#siWeather');
    await p.waitForTimeout(300);
    await goToday(p);
    await p.waitForTimeout(800);
    assert(await p.$('#tcWeather') === null, 'hidden when toggle off');
    await ctx.close();
  }

  // Mild weather → no line
  {
    const { ctx, p } = await open({ at: '2026-10-26T19:00:00Z', rain: false, cold: false });
    await clear(p);
    await p.evaluate(async () => {
      await window.__app.Store.save({
        id: crypto.randomUUID(), kind: 'event', title: 'Office block',
        calendar: 'personal', category: 'Personal', allDay: false, recurrence: { freq: 'none' },
        location: 'Banterra Center', notes: '', start: '2026-10-26T17:00', end: '2026-10-26T18:00'
      });
    });
    await goToday(p);
    await p.waitForTimeout(1000);
    assert(await p.$('#tcWeather') === null, 'no line when mild');
    await ctx.close();
  }

  await b.close();
  console.log('All weather UI tests passed. Shots in', SHOTS);
})().catch(e => { console.error(e); process.exit(1); });
