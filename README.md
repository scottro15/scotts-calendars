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
  - asks for **email magic-link sign-in**. Only `OWNER_EMAIL` (scottro1522@gmail.com) is let in, and the database enforces that with Row Level Security.
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
