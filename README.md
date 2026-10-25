# SANDY — the scheduling app

Static single-page calendar app with three calendars. It runs on GitHub Pages and can sync through Supabase, so Scott's phone, his laptop and the bots (Chief of Staff, Scheduler) all see the same events.

| Calendar | id | Color | Preset categories |
|---|---|---|---|
| MSC – Mental Stability Community | `msc` | purple | Study time, Client session, Client reach-out, Client check-in, Meeting, Other |
| Minds Above Matters | `mam` | orange | Client workout, Meeting, Film study, Client reach-out, Client check-in, Program building / improvement / upload, Team practice – Maryville University / Jennings High School / Brad Beal Elite (EYBL) / Other team, Other |
| Life Time – Facility Ops | `lifetime` | teal | Work shift, Meeting, Weekly meeting – Bill & Sherita, Task / to-do, Event, Other |

"+ Custom…" adds your own category. It's saved per calendar and shared when sync is on.

## Features
- Combined view. Checkboxes show any one, two or all three calendars (remembered per device).
- Month, Week, Day and List views. Phones open in List view, and the sidebar becomes a ☰ drawer.
- Add, edit, delete, and drag and drop. Each event has a title, calendar, category, all-day or start/end, location and notes.
- Repeating events: daily, weekly (pick weekdays), monthly or yearly, every N, with an optional end date.
  - **Edit one occurrence or the whole series.** When you open a repeating event you pick "Only this occurrence" or "Whole series". A changed occurrence (dashed border) keeps its own details, and "Restore to series" undoes it. Dragging one occurrence moves only that one.
  - Delete one occurrence or the whole series.
- Tasks / to-dos with a Day, Week, Month or Season scope. Check them off in the sidebar. Repeating tasks are checked off per occurrence.
- **All times are Central (America/Chicago).** Times are stored as Chicago wall-clock times, and the app shows Chicago time and Chicago's "today" on every device, even while traveling or on a phone set to another zone. A weekly 6:00 AM shift stays at 6:00 AM across daylight saving changes.
- Export and Import a JSON backup (merge or replace).
- Deep links: `?cals=mam`, `?cals=msc,lifetime`, `?view=timeGridWeek`, `&date=2026-10-20`.

- **Location autocomplete.** Start typing in an event's Location field (e.g. "Maryville University gym") and pick a suggestion to fill in the place name plus full address. Typing anything you like still works. See [Location autocomplete](#location-autocomplete).

- **Briefing.** A panel above the calendar previews what's coming up, for the calendars that are switched on. It shows each item's time, title, calendar (color + name) and location, and you tap one to open it. A Day / Week / Month / Season switch changes the period. Day is the default: today when today is in view, otherwise the first day in view. Week, Month and Season follow the date the calendar is showing. Tasks are listed in the period that matches their scope (Day-scope tasks in Day, Week-scope in Week, and so on). The ▾ button hides or shows the panel, and the choice is remembered per device. See [Briefing seasons](#briefing-seasons).
- **Leave-by times (Sandy Intelligence).** Today → Heads Up shows "🚗 Leave by 6:15 PM · 32 min drive" for today's upcoming events that have a location, with a Directions ↗ link to Google Maps. The drive starts from the previous event's place when it ends 60 minutes or less before (back to back), otherwise from your home. Leave time = start − drive − 10 min buffer, rounded down to 5 minutes; if that has passed it says "Leave now … (about N min late)". Events with no location, all-day events, to-dos and events that have started get no line; an address the map can't find or route shows "Couldn't work out the drive" with an Open in Maps link. Drive times come from **free** OpenStreetMap services (Photon geocoding + the public Valhalla router), no API key and no cost, and are cached on the device (places for good, drives for 7 days, failures for 1 day; outages are not cached). Set your home in **Profile → Home** (each user sets their own; nothing is hard-coded). Signed in, it's saved to your account (`profiles.home_address/home_lat/home_lon`, run `supabase/migration-2026-10-25-home.sql` once); until that migration runs it's kept on this device for your user. Code: `leaveby.js`.
- **Leave from where you are + leave-by push alerts (Sandy Intelligence).** From 1 hour before the from-home leave time, Today asks where you are (first time: an in-app "Not leaving from home? Use my location / No thanks" row, then the browser asks once; a refusal is remembered). If you're more than ~0.3 mi from home, the drive is worked out from there and labelled "from your current location" (📍, Directions start there). Your position stays in memory on the phone (reused 5 min); routes from it are never stored; denied/unavailable keeps the home plan. Profile → Home → **Leave-by alerts**: "Push when it's time to leave" (per account; also turns on notifications for the device), "Also 10 minutes before", and "Use my current location" (per device). With alerts on, each computed leave time is saved to `leave_plans` (time, drive minutes, a label; never coordinates) and the every-minute `send-reminders` Edge Function pushes **"Check your drive to X"** 1 hour before the from-home time (tapping opens Today and re-checks from where you are, since iPhone web apps can't read location in the background), **"Leave in 10 min"** (optional) and **"Time to leave"**. It re-checks the event still starts then at that place, sends each once (`reminder_sends`, negative codes), and if the app wasn't opened plans events in the next 3 hours from home itself (same free OSM services, ≤ 4 lookups a minute). Needs `supabase/migration-2026-10-25-leave-alerts.sql` + a redeploy of `send-reminders`; until then the switch says it needs a server update.
- **Tomorrow preview (Sandy Intelligence).** From 6 PM until midnight, Today shows a **🌙 Tomorrow** card: how many events and to-dos tomorrow, the first event (timed before all-day) and **when to leave** for the first drive (from home or a back-to-back event, same free OSM routing), and **To prep tonight**: an early start (before 8 AM), unticked `- [ ] item` checklist lines in tomorrow's event notes (ticks for that date hide them), lines starting with Bring / Pack / Wear / Remember / Need / Don't forget in the event notes or that date's Today's Note, and open to-dos due tomorrow (6 shown, then "+N more"). Built only from your own calendar data, no AI call and no cost. Code: `tomorrow.js`.
- **Practice prep (Sandy Intelligence).** Before a **Maryville University** or **Jennings High School** practice (category "Team practice – …", or a title like "Jennings HS practice"), Today shows a **🏀 Practice prep** card from the morning of the practice until it ends (and the evening before): your notes from that team's **last practice that has notes** (its Today's Note, or a one-off practice's own notes; 8 lines, then "Show N more lines"), its **Notion page** link when the sync routine recorded one (`cal.py note-link`), and this practice's own note if you've started one. If the most recent practice had no notes it says so. Reads only SANDY data; the app never calls Notion. Code: `practice.js`.
- **Away-game travel plan (Sandy Intelligence).** For **Maryville University away and neutral-site games** in the next 3 days (up to 2, soonest first), Today shows a **🚌 Travel plan** card: **leave** time (game start − drive − 60 min to be there before tip-off, rounded down to 5 min) from your home address (or Maryville University if none is saved), estimated **back** time (game end, or start + 2 hr, + 30 min + drive; labelled with the day if it's after midnight), and the **weather at tip-off** at the venue from **Open-Meteo** (free, no key; cached 1 hr, failures retried after 10 min, no forecast more than ~2 weeks out). Drive times come from the same free OSM routing as Heads Up; if the venue can't be found, it uses the "Drive from Maryville University: … about X hr Y min" line in the game's notes. Note: Heads Up's leave-by line uses a 10-min buffer; the travel card deliberately says "there 60 min before tip-off". Code: `travel.js`.
- **Sandy Intelligence chat history + New chat.** The AI sheet has **🕘 History** and **＋ New chat**. Every conversation is saved after its first message (titled from that message, max 60 characters) with its confirm/cancel notes; History lists them newest first ("Today 9:05 AM", "Sat, Nov 14"), tap one to reopen and keep going, or Delete (tap twice). New chat starts fresh, so the AI only gets that conversation. None of this calls the AI; only Send does. Signed in, chats live in the Supabase table `ai_chats` (owner-only RLS, `supabase/migration-2026-10-25-ai-chats.sql`); until that migration is applied, and in the local version, they're kept on the device (per account) and History says so. A chat whose only message failed to send isn't kept. Code: `ai.js`.
- **Add or edit calendars.** Profile → "+ Add or edit calendars" opens a plain list of your calendars. Tap one to rename it, change its short name or pick a color (one at a time); "+ Add a calendar" adds a new one (e.g. "Personal"). Signed in, calendars are per user (`calendars` table); in local mode the list is kept on this device. Duplicate names are refused, and names that would share an id get `-2`, `-3`.
- **Jump to any month and year.** Tap the title at the top of the calendar (e.g. "October 2026 ▾"), or focus it and press Enter. Pick a month, change the year with ‹ › or type any year from 1 to 9999. "This month" goes back to today.

### Briefing seasons
Seasons are **meteorological**, by whole months:

| Season | Months |
|---|---|
| Spring | March – May |
| Summer | June – August |
| Autumn | September – November |
| Winter | December of the year + January – February of the next year |

In Season mode the panel shows Spring, Summer, Autumn and Winter as buttons. It starts on the season that contains the calendar's date. Tapping another season shows that season **in the year the calendar is showing**. If the calendar is on January or February, "Winter" means the winter that started the December before (e.g. viewing Jan 2027 shows Winter 2026–27). Your season pick sticks when you change the year with the title picker. "Today" and "This month" reset it to the current season. The sidebar's task tab for the season scope uses the same definition, so it now says "Autumn" instead of "Fall".

## Storage modes
- **Local (default):** if `config.js` has no Supabase keys, data stays in this browser's localStorage and example events are seeded.
- **Shared (Supabase):** if `config.js` has `SUPABASE_URL` and `SUPABASE_ANON_KEY`, the app:
  - asks for **email magic-link sign-in**. Invite-only: sign-ups are off in Supabase Auth and the app asks for magic links with `shouldCreateUser: false`, so an email without an invited account is refused ("hasn't been invited yet"). Row Level Security (`owner_id = auth.uid()`) limits each account to its own calendars.
  - reads and writes the shared `events` and `categories` tables.
  - shows bot changes **live** (Supabase Realtime) and also re-loads when the tab regains focus, when the device comes back online, every 5 minutes, and when you tap "Refresh now".
  - offers a one-time **"Import my local events"** on any device that still has pre-sync localStorage events (examples are optional).

## Run locally
    cd /workspace/calendar-app && python3 -m http.server 8765
    # open http://127.0.0.1:8765/

No build step is needed. FullCalendar 6.1.15 and supabase-js 2.118.0 are vendored in `vendor/`, with no CDN.

---

## Setup: turning on sync (one time)

### 1. Create the Supabase project
1. Sign in at https://supabase.com and create a project on the free plan. Pick a region near St. Louis, e.g. *East US (Ohio)* or *Central US*.
2. Open **Project Settings → API** and note:
   - **Project URL**: `https://<ref>.supabase.co`
   - **anon public** key: goes in `config.js`, safe to publish
   - **service_role** key: **secret**, bots only, never in the repo or the browser

### 2. Create the tables
**SQL Editor → New query →** paste all of `supabase/schema.sql` **→ Run**. It's safe to re-run. It creates:
- `events` (one row per event, task, series or changed occurrence) and `categories` (custom categories)
- RLS policies so only an authenticated user whose email is scottro1522@gmail.com can read or write. Anonymous users get nothing. The service_role key bypasses RLS, which is how the bots get in.
- an `updated_at` trigger, and adds both tables to the `supabase_realtime` publication for live updates

To change the owner email, edit it in `is_calendar_owner()` and in `config.js`, then re-run.

### 3. Auth settings
**Authentication → URL Configuration**
- **Site URL**: the Pages URL, e.g. `https://<github-user>.github.io/<repo>/`
- **Redirect URLs**: add the same URL, plus `http://127.0.0.1:8765/` if you also test locally.

**Authentication → Users → Add user**: create `scottro1522@gmail.com` (or let Scott sign in once from the app).
Then **Authentication → Sign In / Providers → Email**: turn off **"Allow new users to sign up"**. Strangers can't create accounts after that (RLS already hides the data from them either way).

Note: Supabase's built-in email sender is rate-limited to a few emails per hour. That's fine for one person. A session lasts until sign-out, so links are rarely needed.

### 4. Fill in `config.js`
```js
window.CALENDAR_CONFIG = {
  SUPABASE_URL: 'https://<ref>.supabase.co',
  SUPABASE_ANON_KEY: '<anon public key>',
  OWNER_EMAIL: 'scottro1522@gmail.com',
};
```

### 5. Deploy to GitHub Pages
1. Create a GitHub repo, e.g. `scott-calendars`, and push this folder's contents to `main`. The repo can be public because the anon key is designed to be public. A private repo with Pages needs a paid plan.
2. **Settings → Pages → Build and deployment → Source: Deploy from a branch → `main` / root.**
3. Open `https://<github-user>.github.io/scott-calendars/` and sign in with the emailed link.
4. On each device that has old local events, tap **Import my local events** once.
5. On the phone, use Share → **Add to Home Screen** to get an app icon.

### 6. Set up the bots (`tools/cal.py`)
On the machine the bots run on, set:
```
export SUPABASE_URL=https://<ref>.supabase.co
export SUPABASE_SERVICE_KEY=<service_role key>     # secret
export CAL_SOURCE=scheduler                        # or chief-of-staff; tags rows they write
```
Keep the key in a secrets store or env file that's readable only by the bot user, never in git.
Free-tier projects pause after about a week with no activity. Daily bot reads keep the project active.

---

## Bot CLI: `tools/cal.py`
Python 3.9+, standard library only, uses the Supabase REST API. All input and output times are America/Chicago. Output is always JSON (`"ok": true/false`). Add `--dry-run` anywhere to see exactly what would be written without writing it. Reads still happen, so edit and delete previews are accurate.

```
cal.py list [--from today] [--to DATE | --days 7] [--calendar msc|mam|lifetime|all|a,b] [--tasks-only]
cal.py find TEXT [--calendar ...] [--from DATE --to DATE]
cal.py get ID                      # one item, plus its changed occurrences
cal.py categories [--calendar ...]
cal.py add --calendar mam|...|all --title T [--category C] --start "2026-10-20 6:30pm"
           [--end "7:30pm" | --duration 90 | --all-day [--end DATE]]
           [--repeat daily|weekly|monthly|yearly] [--every N] [--days mon,wed|weekdays] [--until DATE]
           [--location L] [--notes N] [--task --scope day|week|month|season]
cal.py edit ID [any add field] [--start-time 18:00 --end-time 19:00] [--timed] [--no-repeat] [--no-until]
           [--calendar X] [--not-task]                       # whole event / whole series
cal.py edit ID --occurrence 2026-10-22 [fields]              # just that occurrence (creates an exception)
cal.py edit ID --done|--not-done [--occurrence DATE]         # check off a task
cal.py delete ID                                             # one-off event
cal.py delete ID --occurrence 2026-10-22                     # skip one occurrence
cal.py delete ID --series                                    # whole series (+ its changed occurrences)
```
Dates accept `YYYY-MM-DD`, `today`, `tomorrow` or a weekday name (`fri`). Times accept `18:30`, `6:30pm`, `9am` or `noon`. ISO with `Z` or an offset is converted to Chicago. `--calendar all` creates one copy in each of the three calendars. A category that isn't a preset is added as a custom category. Each `list` occurrence includes `id`, `occurrence_date`, `start`/`end` (Chicago wall time), `start_iso`/`end_iso` (with offset), `display` ("Tue Oct 20, 6:30 PM – 7:30 PM CT"), `repeat`, `task`, `exception_of`.

## Data model (`events` table)
| column | meaning |
|---|---|
| `calendar` | `msc` / `mam` / `lifetime` |
| `start_at`, `end_at` | `timestamp` **without** zone = America/Chicago wall clock. All-day: midnight, inclusive end date |
| `all_day`, `title`, `category`, `location`, `notes` | |
| `recur_freq` (`none` daily weekly monthly yearly), `recur_interval`, `recur_until` (inclusive), `recur_by_weekday` (0 = Sun) | repeat rule |
| `exdates` | dates skipped in a series (deleted or detached occurrences) |
| `series_id`, `original_date` | set on a **changed single occurrence**: a one-off row that replaces `original_date` of series `series_id` (cascade-deleted with the series) |
| `is_task`, `task_scope`, `done`, `completed_dates` | tasks. `done` for one-offs, `completed_dates` per occurrence for repeating tasks |
| `example`, `source`, `created_at`, `updated_at` | `source` = `app` / bot name |

## Location autocomplete

As you type 3+ letters in **Location**, a dropdown of matching places appears (arrow keys + Enter, or tap). Picking one fills in the name and full address, e.g. `Maryville University, 650 Maryville University Dr, St. Louis, MO 63141`. You can always ignore the suggestions and type whatever you want. Suggestions favor the St. Louis / Augusta, MO area.

Two sources, chosen automatically (`places.js`):

| `GOOGLE_MAPS_API_KEY` in `config.js` | Suggestions come from | Cost |
|---|---|---|
| empty (today) | **OpenStreetMap** via [Photon](https://photon.komoot.io) | free, no account. Photon asks for fair use; one person's typing is fine. OSM sometimes uses the official city name (e.g. "Town and Country" instead of "St. Louis") and has fewer business names than Google. |
| a key | **Google Maps** (Places API (New)) | free up to Google's monthly allowance, see below. If the key is wrong or blocked, the app quietly falls back to OpenStreetMap. |

How it keeps Google cost low: the Google script loads only when you open the event form; it waits until you pause typing (0.3 s) and have typed 3 letters; each search uses a **session token**, so all the typing plus your pick count as one session; and the pick only asks Google for the address (a cheaper "Essentials" field).

### Turning on Google suggestions (Scott, one time, ~15 minutes)

1. Go to <https://console.cloud.google.com/> and sign in with your Google account. At the top, click the project picker → **New project**, name it `SANDY`, click **Create**, and make sure it's selected.
2. **Billing:** left menu → **Billing** → link or create a billing account (Google requires a card on file even for the free allowance).
3. **Turn on the two APIs:** left menu → **APIs & Services → Library**. Search **Maps JavaScript API** → **Enable**. Search **Places API (New)** → **Enable**. (Not "Places API" without "(New)".)
4. **Make the key:** **APIs & Services → Credentials → + Create credentials → API key**. Copy it.
5. **Lock the key down** (click the key's name to edit it):
   - **Application restrictions:** choose **Websites**, and add `https://scottro15.github.io/scotts-calendars/*`
   - **API restrictions:** choose **Restrict key**, tick **Maps JavaScript API** and **Places API (New)** only.
   - Click **Save**. (Changes can take a few minutes to take effect.)
6. **Spending guardrails:**
   - **Billing → Budgets & alerts → Create budget**, e.g. $5/month, with email alerts at 50%, 90% and 100%. (A budget only *emails* you; it doesn't stop usage.)
   - **Hard cap:** **APIs & Services → Places API (New) → Quotas & system limits**, and lower the per-day request limits (e.g. Autocomplete requests to 300/day). Do the same for Maps JavaScript API if you like.
7. **Give the key to the app:** paste it into `config.js` as `GOOGLE_MAPS_API_KEY: 'AIza…'` and push (or just send it to Grok Bot / Chief of Staff and it'll do this).

**Is it safe to put the key in `config.js`?** Yes. Browser map keys are public by design (anyone can see them in the page). The website restriction in step 5 means the key only works on your SANDY site, and the API restriction means it can only do these two things.

**Price check (verified 2026-10-19 on [Google Maps Platform pricing](https://developers.google.com/maps/billing-and-pricing/pricing)):** Places API (New) "Autocomplete Requests" includes 10,000 free per month; "Autocomplete Session Usage" is unlimited/free; "Place Details Essentials" (the address lookup on a pick) includes 10,000 free per month. With session tokens, a typical search + pick is billed as one address lookup, so personal use should stay at $0. Google changes prices from time to time, so check that page if you add many users.

To test without a key: `node tests/location_autocomplete.test.js http://127.0.0.1:8766/` (OpenStreetMap path) and `node tests/google_provider_mock.test.js http://127.0.0.1:8766/` (Google path with a mocked Google script), against a copy served with an empty `config.js`.

## Files
- `index.html`, `styles.css`: layout and UI
- `app.js`: calendars, Chicago time handling, repeat logic, views, editor (occurrence vs series), tasks, Briefing panel, month/year picker, sync UI, seed data
- `storage.js`: the only code that touches storage. `LocalStorageAdapter`, `SupabaseAdapter`, the `Store` cache, the magic-link auth helpers and the local → Supabase migration.
- `config.js`: Supabase URL and anon key (empty = local mode), and the optional `GOOGLE_MAPS_API_KEY`
- `places.js`: Location autocomplete (Google Places API (New) when a key is set, otherwise OpenStreetMap/Photon), accessible combobox UI
- `tests/location_autocomplete.test.js`, `tests/google_provider_mock.test.js`: browser tests for Location autocomplete
- `supabase/schema.sql`: tables, RLS, trigger, realtime
- `tools/cal.py`: bot CLI
- `tests/briefing_and_picker.test.js`: browser test of the Briefing panel (Day/Week/Month/Season, season buttons, calendar toggles, tasks by scope, collapse) and the month/year picker (tap and keyboard, prev/next year, any year, invalid year), on desktop and phone sizes. Run it like the other local tests, against a copy served with an empty `config.js`: `node tests/briefing_and_picker.test.js http://127.0.0.1:8766/`
- `tests/dark_contrast_audit.test.js`: 390px WCAG AA audit of every screen in **dark and light mode** (Home/List/Day/Week/Month, Briefing, Today, To-Do + inbox/categories, Search incl. Notes Review, Profile, signed-in dialogs, onboarding, sign-in, editor, AI panel, toasts). Fails if any visible text is below 4.5:1 (3:1 large) in either theme, and checks the List day-box border. `node tests/dark_contrast_audit.test.js http://127.0.0.1:8766/ [shotsDir]`; `THEME=dark` or `THEME=light` audits one theme.
- `leaveby.js`: Sandy Intelligence leave-by lines (geocode + route via free OSM services, cache, Heads Up rendering, home address per user)
- `tests/leave_by.test.js`: 390px browser test of leave-by with geocoding/routing **mocked**: no-home hint, Profile → Home save/bad address/clear, leave-by maths, back-to-back start point, skips (past, started, all-day, to-do, no location, already there), unroutable + unknown addresses, "Leave now", service down (not cached, recovers), caching across re-render and reload, Maps links, light + dark screenshots. `node tests/leave_by.test.js http://127.0.0.1:8766/ [shotsDir]`
- `tests/leave_location.test.js`: leave-by from the current location with geolocation **mocked**: no ask outside the 1-hour window, in-app explanation before the browser prompt, far → re-worked + labelled, near home → home plan, 5-min reuse, "No thanks" / denial / unavailable, `?tab=today&locate=1` from the push, Profile switch off, nothing written to storage. `node tests/leave_location.test.js http://127.0.0.1:8766/ [shotsDir]`
- `tomorrow.js`: Sandy Intelligence evening Tomorrow card (counts, first event, leave-by, prep list)
- `tests/tomorrow_preview.test.js`: 390px test of the Tomorrow card with routing **mocked**: hidden before 6 PM / after midnight, counts, first event, leave-by, prep (early start, checklist ticks per date, Bring lines from notes and Today's Notes incl. a recurring date, to-dos, done to-dos skipped, "+N more"), no home, nothing to prep, empty day, minute refresh, editor tap, no outside calls, light + dark. `node tests/tomorrow_preview.test.js http://127.0.0.1:8766/ [shotsDir]`
- `practice.js`: Sandy Intelligence Practice prep card (last practice's notes / Notion link per team)
- `tests/practice_prep.test.js`: 390px test of Practice prep: last practice with notes (folded long notes), Notion link, this practice's note, during/after practice, evening-before, one-off and title matches, gap message, no-notes hint, other teams / games / client workouts excluded, hidden calendar, editor tap, no outside calls, light + dark. `node tests/practice_prep.test.js http://127.0.0.1:8766/ [shotsDir]`
- `travel.js`: Sandy Intelligence away-game Travel plan (leave/back times, Open-Meteo weather)
- `tests/travel_plan.test.js`: 390px test of the Travel plan (mocked Photon/Valhalla/Open-Meteo): which games get a card, leave/back maths incl. after-midnight return, weather text and caching (1 hr; failures 10 min), far-off games, game-over removal, no-home and notes-drive fallbacks, weather down, no other network calls, light + dark. `node tests/travel_plan.test.js http://127.0.0.1:8766/ [shotsDir]`
- `tests/ai_chat_history.test.js`: 390px test of AI chat history (device storage): save/title, New chat, history list, reopen + follow-up carries history, no AI calls, buttons disabled while waiting, failed sends not kept, two-tap delete, reload, light + dark. `node tests/ai_chat_history.test.js http://127.0.0.1:8766/ [shotsDir]`
- `tests/ai_chats_supabase.test.js`: AI chat history against the local stand-in: rows in `ai_chats`, server history/reopen, RLS (other users and anon can't read/change/delete/plant/take over), delete, and the on-device fallback before the migration. `SECRET=… node tests/ai_chats_supabase.test.js http://127.0.0.1:8786/`
- `tests/leave_alerts_supabase.test.js`: leave-by alerts against the local stand-in: Profile switch → `profiles.leave_alerts` + device subscription, plans saved (no coordinates) and not re-sent, current location updates the plan, RLS, the Edge Function run against the stand-in sends "Time to leave" once and skips a moved event, friendly message before the migration. `SECRET=… node tests/leave_alerts_supabase.test.js http://127.0.0.1:8786/`
- `tests/leave_alerts_function.test.mjs`: Node test of the Edge Function's leave alerts (timing, late limits, validation, server fallback planning with mocked Photon/Valhalla, dedupe, cleanup, missing-migration path). `node tests/leave_alerts_function.test.mjs`
- `tests/leave_by_supabase.test.js`: leave-by home against the local stand-in: saved to `profiles` per user, follows you to another device, other users don't see it, falls back to the device when the columns are missing, clear. `SECRET=… node tests/leave_by_supabase.test.js http://127.0.0.1:8786/`
- `tests/calendars_manage.test.js`: calendars screen in local mode (opens to a list, one editor at a time, add "Personal", duplicate/empty refused, rename + recolor, light + dark screenshots). `tests/calendars_supabase.test.js`: the same signed in against the local stand-in (per-user rows, slug collisions, a second user).
- `tests/dark_list_todo_today_header.test.js`: 390px light + dark: List text contrast (WCAG ≥ 4.5 on tinted rows), to-do text inside its colored bar in List, Day and Today, and the Today header (big bold date, count pills, space before Up Next).
- `tests/local_mode.test.js`: browser test of local mode (device time zones Chicago, Tokyo and LA, occurrence edits, restore, categories)
- `tests/supabase_mode.test.js` + `supabase/local-test/`: end-to-end test against a **local stand-in** (Postgres 17 + PostgREST + `dev_proxy.py`, with stub `auth.*` functions and locally-minted test tokens). It covers sign-in gating, migration, app→bot and bot→app sync, and exceptions. It never talks to a real Supabase project, and none of its files are used in production.

## Limitations
- No reminders or notifications, and no Google Calendar sync yet.
- Realtime is untested against real Supabase because no project exists yet. Refresh-on-focus, the 5-minute poll and "Refresh now" are tested and cover it either way.
- Offline edits aren't queued. In sync mode a save made with no connection shows "Could not save" and has to be redone.
- Two people editing the same event at the same moment: the last save wins.

## List View: today highlight and current-time line

- In List View, today's section has a blue border, and its date header is tinted.
- When you open or switch to List View, the page starts at the top and then smoothly scrolls so today's header is at the top of the screen. It only scrolls if it needs to, and only when the week on screen includes today.
- A red line with the exact time (for example "6:15 PM", Chicago time) runs across today's section at the current time. It sits between events by start time. Events happening right now are tinted, and the line sits right after them. All-day items always stay above the line.
- If today has no events, or your calendar toggles hide all of them, today still shows with "No events today" and the line.
- The line updates on every minute boundary, and again when you return to the tab. After midnight it moves to the new day. The minute updates never scroll the page, so your own scrolling isn't interrupted.
- This is display only. Calendar data is never changed.
- Test, run against a copy served with an empty `config.js` and a mocked clock: `node tests/list_today_nowline.test.js http://127.0.0.1:8766/ [screenshotDir]`

## Animations

`motion.js` + the "motion" section of `styles.css` add small animations (150–300 ms, ease-out in, ease-in out): dialogs (event editor, delete choice) scale up from where you tapped with a fading backdrop and reverse on close; the month/year picker drops from the title; the Briefing panel slides/fades open and closed with a rotating ▾; Day/Week/Month/Season and season switches crossfade; location suggestions and toasts drop in; the phone sidebar slides with a fading scrim; buttons press in slightly. Exit animations finish before a dialog actually closes or a panel is hidden; Escape and focus return still work. With the OS "reduce motion" setting on, everything is instant.
Test: `node tests/motion.test.js http://127.0.0.1:8766/` (also checks reduced motion).

### List View calendar tint
Each List View row is tinted with its calendar's color mixed 12% into white (hover 20%; an event happening now gets 24%, bold text, and a calendar-colored left accent next to today's blue border). The tint comes from the calendar color in `CALENDARS`, so it follows color changes. Test: `node tests/list_tint.test.js http://127.0.0.1:8766/ [screenshotDir]` (checks msc/mam/lifetime colors, whole row, AA contrast, hover, ongoing).

## Day notes ("Today's Note") and Notes Review
**Today's Note — this date only.** Every event's editor has a second, amber 📌 section under the regular notes, headed "Note for Tuesday, Oct 20" (the date you clicked). Whatever you write there shows only on that date: Monday's practice note doesn't appear on Tuesday's practice. It saves automatically (and on Save / Cancel); clearing the text deletes it. On repeating events the regular field is labelled **Notes (every occurrence)**. Writing a day note never changes the event and never turns the occurrence into a "changed occurrence". Occurrences that have one get a 📌 in Month/Week/Day/List views.

Storage: table `occurrence_notes` (`event_id` → `events.id` on delete cascade, `occurrence_date` Chicago date, `body`, unique per event+date, same owner-only RLS). A changed occurrence's note is keyed by its series id + original date. Local mode stores them in localStorage (`scottcal.occurrenceNotes.v1`). **One-time DB step:** run `supabase/migration-2026-10-19-occurrence-notes.sql` (also at the end of `supabase/schema.sql`) in Supabase **SQL Editor → Run**. Until then the app shows the section as disabled and everything else works.

**Notes Review** (sidebar / ☰ menu, under Tasks): Day / Week / Month / Season / Year tabs with ‹ › to move by period. Day has a date picker plus Sun–Sat chips for that week. Notes are grouped by date with event title, calendar color + name, time and text; tap one to open that occurrence. **Filters:** calendars (multi-select; follows the main calendar toggles until you change it), one event (lists each event/series that has notes, once), and a text search. Seasons are the meteorological ones above.

Deep links (also restored after the magic-link sign-in): `?review=day&date=2026-10-19`, `?review=week&date=2026-10-19`, `?review=month&date=2026-10-19` (also `season`, `year`). On a phone it opens the menu at Notes Review.

Bots: `cal.py note-get <id> --date YYYY-MM-DD`, `cal.py note-set <id> --date YYYY-MM-DD --text "..."` (empty text deletes; a changed-occurrence id needs no date), `cal.py note-list --from YYYY-MM-DD --to YYYY-MM-DD [--calendar mam]` → JSON `notes[]` with `date, title, calendar, calendar_name, time, start, end, note`.

Tests: `node tests/day_notes_review.test.js http://127.0.0.1:8766/ [screenshotDir]` (empty `config.js` copy) and `python3 tests/cal_notes_test.py` (offline fake Supabase).

## Repeating events: "Apply changes to…"
Saving an edited occurrence of a repeating event, deleting one, or dragging/resizing one opens a small dialog: **This event only** (detaches that date as a changed occurrence) or **All events in the series** (shifts/edits the series), plus Cancel (Escape also cancels; focus stays inside the dialog). It isn't shown for one-time events, changed occurrences, or when only Today's Note changed. Changing the calendar, type or repeat rule disables "This event only". "This and following" is not offered (it would need series splitting). Test: `node tests/scope_dialog.test.js http://127.0.0.1:8766/`

## Checklists
Any line in an event's Notes written as `- [ ] item` shows as a checkbox in the event form. Ticks are saved per
date (table `occurrence_checks`), so every Life Time shift starts unticked. One-time database update:
run `supabase/migration-2026-10-21-checklists-and-owner.sql` in the Supabase SQL Editor (it also adds the
multi-user `owner_id` columns and per-user security rules). Until then the boxes show but are greyed out.
