#!/usr/bin/env python3
"""
cal.py: command-line access to SANDY (Supabase) for the bots.

Python 3.9+, standard library only. Talks to Supabase's REST API (PostgREST)
with the service-role key, which bypasses Row Level Security. Keep that key
out of chats, logs and git.

Environment:
  SUPABASE_URL          https://<project-ref>.supabase.co
  SUPABASE_SERVICE_KEY  service_role key (Project Settings -> API)
  CAL_SOURCE            optional tag saved on rows you write (default "bot")

All times are America/Chicago wall-clock times. Input like "2026-10-20 6:30pm",
"2026-10-20T18:30", "today 9am" or "tomorrow". ISO strings with an offset/Z
are converted to Chicago. Output is always JSON.

Calendars: msc | mam | lifetime | all (= all three; comma lists work too)

Examples
  cal.py list --from today --days 7 --calendar mam
  cal.py add --calendar mam --title "Film study" --category "Film study" \\
      --start "2026-10-20 20:00" --end "2026-10-20 21:00" --repeat weekly --days mon,wed
  cal.py add --calendar all --title "Thanksgiving" --all-day --start 2026-11-26
  cal.py add --calendar lifetime --task --scope week --title "Review work orders" --all-day --start 2026-10-23
  cal.py edit <id> --title "New title" --start-time 18:00 --end-time 19:00      # whole series
  cal.py edit <id> --occurrence 2026-10-22 --start "2026-10-22 19:00"           # just that day
  cal.py edit <id> --done --occurrence 2026-10-21                               # check off one task occurrence
  cal.py delete <id> --occurrence 2026-10-22      # skip one occurrence
  cal.py delete <id> --series                     # whole series
  cal.py find "Maryville" --from 2026-10-01 --to 2026-12-31
  cal.py --dry-run add ...                        # print what would change, write nothing
"""
import argparse
import datetime as dt
import json
import os
import re
import sys
import urllib.error
import urllib.parse
import urllib.request
import uuid
from zoneinfo import ZoneInfo

TZ_NAME = 'America/Chicago'
TZ = ZoneInfo(TZ_NAME)

CALENDARS = {
    'msc': {'name': 'MSC – Mental Stability Community',
            'categories': ['Study time', 'Client session', 'Client reach-out', 'Client check-in', 'Meeting', 'Other']},
    'mam': {'name': 'Minds Above Matters',
            'categories': ['Client workout', 'Meeting', 'Film study', 'Client reach-out', 'Client check-in',
                           'Program building', 'Program improvement', 'Program upload',
                           'Team practice – Maryville University', 'Team practice – Jennings High School',
                           'Team practice – Brad Beal Elite (EYBL)', 'Team practice – Other team', 'Other']},
    'lifetime': {'name': 'Life Time – Facility Ops',
                 'categories': ['Work shift', 'Meeting', 'Weekly meeting – Bill & Sherita', 'Task / to-do', 'Event', 'Other']},
}
FREQS = ('none', 'daily', 'weekly', 'monthly', 'yearly')
SCOPES = ('day', 'week', 'month', 'season')
WEEKDAYS = {'su': 0, 'sun': 0, 'sunday': 0, 'mo': 1, 'mon': 1, 'monday': 1, 'tu': 2, 'tue': 2, 'tues': 2, 'tuesday': 2,
            'we': 3, 'wed': 3, 'wednesday': 3, 'th': 4, 'thu': 4, 'thur': 4, 'thurs': 4, 'thursday': 4,
            'fr': 5, 'fri': 5, 'friday': 5, 'sa': 6, 'sat': 6, 'saturday': 6}
WD_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']


class CalError(Exception):
    pass


# ---------------------------------------------------------------- time helpers
def now_chicago():
    return dt.datetime.now(TZ).replace(tzinfo=None, second=0, microsecond=0)


def parse_time(s):
    s = s.strip().lower().replace(' ', '').replace('.', '')
    if s in ('noon',):
        return dt.time(12, 0)
    if s in ('midnight',):
        return dt.time(0, 0)
    m = re.fullmatch(r'(\d{1,2})(?::(\d{2}))?(?::\d{2})?(am|pm|a|p)?', s)
    if not m:
        raise CalError(f'Could not read time "{s}". Use e.g. 18:30, 6:30pm, 9am.')
    h, mi, ap = int(m.group(1)), int(m.group(2) or 0), m.group(3)
    if ap:
        if not 1 <= h <= 12:
            raise CalError(f'Bad hour in "{s}"')
        h = (h % 12) + (12 if ap.startswith('p') else 0)
    if not (0 <= h <= 23 and 0 <= mi <= 59):
        raise CalError(f'Bad time "{s}"')
    return dt.time(h, mi)


def parse_date(s):
    s = s.strip().lower()
    today = now_chicago().date()
    if s == 'today':
        return today
    if s == 'tomorrow':
        return today + dt.timedelta(days=1)
    if s == 'yesterday':
        return today - dt.timedelta(days=1)
    if s in WEEKDAYS:  # next occurrence of that weekday (today counts)
        want = WEEKDAYS[s]
        cur = (today.weekday() + 1) % 7
        return today + dt.timedelta(days=(want - cur) % 7)
    try:
        return dt.date.fromisoformat(s)
    except ValueError:
        raise CalError(f'Could not read date "{s}". Use YYYY-MM-DD, today, tomorrow or a weekday name.')


def parse_when(s):
    """-> (date, time or None). Accepts 'YYYY-MM-DD', 'YYYY-MM-DD HH:MM', 'YYYY-MM-DDTHH:MM[:SS][Z|±HH:MM]',
    'today 9am', 'tomorrow 18:30', 'fri 6pm'."""
    s = s.strip()
    iso = re.fullmatch(r'(\d{4}-\d{2}-\d{2})[T ](\d{1,2}:\d{2}(?::\d{2}(?:\.\d+)?)?)(Z|[+-]\d{2}:?\d{2})', s)
    if iso:  # has an explicit offset -> convert to Chicago wall clock
        d = dt.datetime.fromisoformat(s.replace(' ', 'T').replace('Z', '+00:00'))
        local = d.astimezone(TZ)
        return local.date(), local.time().replace(second=0, microsecond=0)
    m = re.fullmatch(r'(\S+?)(?:[T ]+(.+))?', s)
    if not m:
        raise CalError(f'Could not read "{s}"')
    date_part, time_part = m.group(1), m.group(2)
    return parse_date(date_part), (parse_time(time_part) if time_part else None)


def parse_duration(s):
    s = s.strip().lower().replace(' ', '')
    if re.fullmatch(r'\d+', s):
        return dt.timedelta(minutes=int(s))
    m = re.fullmatch(r'(?:(\d+(?:\.\d+)?)h)?(?:(\d+)m(?:in)?)?', s)
    if not m or not (m.group(1) or m.group(2)):
        raise CalError(f'Could not read duration "{s}". Use minutes (90) or 1h30m.')
    return dt.timedelta(hours=float(m.group(1) or 0), minutes=int(m.group(2) or 0))


def db_ts(d, t=None):
    return f'{d.isoformat()}T{(t or dt.time(0, 0)).strftime("%H:%M")}:00'


def from_db_ts(s):
    if s is None:
        return None
    return dt.datetime.fromisoformat(s[:19])


def iso_offset(naive):
    return naive.replace(tzinfo=TZ).isoformat()


def parse_weekdays(s):
    s = s.strip().lower()
    if s in ('weekdays', 'weekday'):
        return [1, 2, 3, 4, 5]
    if s in ('weekends', 'weekend'):
        return [0, 6]
    if s in ('everyday', 'all', 'daily'):
        return list(range(7))
    out = set()
    for part in re.split(r'[,\s]+', s):
        if not part:
            continue
        if part.isdigit() and 0 <= int(part) <= 6:
            out.add(int(part))
        elif part in WEEKDAYS:
            out.add(WEEKDAYS[part])
        else:
            raise CalError(f'Unknown weekday "{part}". Use mon,tue,wed,thu,fri,sat,sun or weekdays.')
    return sorted(out)


def parse_calendars(s):
    s = s.strip().lower()
    if s == 'all':
        return list(CALENDARS)
    aliases = {'mental stability community': 'msc', 'minds above matters': 'mam', 'life time': 'lifetime',
               'life-time': 'lifetime', 'lt': 'lifetime'}
    out = []
    for part in [p.strip() for p in s.split(',') if p.strip()]:
        part = aliases.get(part, part)
        if part not in CALENDARS:
            raise CalError(f'Unknown calendar "{part}". Use msc, mam, lifetime or all.')
        if part not in out:
            out.append(part)
    if not out:
        raise CalError('No calendar given')
    return out


# ---------------------------------------------------------------- recurrence (mirrors app.js)
def occurrences(row, rs, re_):
    """Occurrences of a row overlapping [rs, re_) as list of (start, end, key_date). Naive Chicago datetimes."""
    base = from_db_ts(row['start_at'])
    end = from_db_ts(row.get('end_at'))
    all_day = row.get('all_day')
    if all_day:
        base = base.replace(hour=0, minute=0)
        end = dt.datetime.combine((end or base).date() + dt.timedelta(days=1), dt.time())  # inclusive -> exclusive
    if not end or end <= base:
        end = base + (dt.timedelta(days=1) if all_day else dt.timedelta(hours=1))
    dur = end - base
    dur_days = (end.date() - base.date()).days

    def mk(s):
        e = dt.datetime.combine(s.date() + dt.timedelta(days=dur_days), dt.time()) if all_day else s + dur
        return (s, e, s.date())

    def overlaps(o):
        return o[0] < re_ and o[1] > rs

    freq = row.get('recur_freq') or 'none'
    if freq == 'none':
        o = mk(base)
        return [o] if overlaps(o) else []
    interval = max(1, int(row.get('recur_interval') or 1))
    until = row.get('recur_until')
    until = dt.datetime.combine(dt.date.fromisoformat(until) + dt.timedelta(days=1), dt.time()) if until else None
    limit = until if until and until < re_ else re_
    ex = set(row.get('exdates') or [])
    out = []
    lookback = max(dur_days + 1, 1)

    def push(s):
        if s < base or s >= limit or s.date().isoformat() in ex:
            return
        o = mk(s)
        if overlaps(o):
            out.append(o)

    if freq == 'daily':
        n = max(0, ((rs.date() - base.date()).days - lookback) // interval)
        for _ in range(5000):
            s = base + dt.timedelta(days=n * interval)
            if s >= limit:
                break
            push(s)
            n += 1
    elif freq == 'weekly':
        days = sorted(set(row.get('recur_by_weekday') or [(base.weekday() + 1) % 7]))
        week0 = dt.datetime.combine(base.date() - dt.timedelta(days=(base.weekday() + 1) % 7), dt.time())
        w = max(0, ((rs.date() - week0.date()).days - lookback) // (7 * interval))
        for _ in range(2000):
            ws = week0 + dt.timedelta(days=w * 7 * interval)
            if ws >= limit:
                break
            for d in days:
                push(dt.datetime.combine(ws.date() + dt.timedelta(days=d), base.time()))
            w += 1
    elif freq in ('monthly', 'yearly'):
        step = interval if freq == 'monthly' else 12 * interval
        n = 0
        for _ in range(2400):
            mo = base.month - 1 + n
            y, m = base.year + mo // 12, mo % 12 + 1
            n += step
            try:
                s = base.replace(year=y, month=m)
            except ValueError:  # e.g. 31st in a 30-day month: skipped, like the app
                continue
            if s >= limit:
                break
            push(s)
    return out


# ---------------------------------------------------------------- REST client
class Client:
    def __init__(self, dry_run=False):
        self.url = (os.environ.get('SUPABASE_URL') or '').rstrip('/')
        self.key = os.environ.get('SUPABASE_SERVICE_KEY') or ''
        self.dry_run = dry_run
        self.planned = []

    @property
    def configured(self):
        return bool(self.url and self.key)

    def _need(self):
        if not self.configured:
            raise CalError('SUPABASE_URL and SUPABASE_SERVICE_KEY must be set.')

    def request(self, method, path, params=None, body=None, prefer=None, write=False):
        if write and self.dry_run:
            self.planned.append({'method': method, 'path': path, 'params': params, 'body': body})
            return body if isinstance(body, list) else ([body] if body else [])
        self._need()
        q = ('?' + urllib.parse.urlencode(params, safe='*,().:"')) if params else ''
        req = urllib.request.Request(f'{self.url}/rest/v1/{path}{q}', method=method,
                                     data=json.dumps(body).encode() if body is not None else None)
        req.add_header('apikey', self.key)
        req.add_header('Authorization', f'Bearer {self.key}')
        req.add_header('Content-Type', 'application/json')
        req.add_header('Accept', 'application/json')
        if prefer:
            req.add_header('Prefer', prefer)
        try:
            with urllib.request.urlopen(req, timeout=30) as r:
                raw = r.read()
        except urllib.error.HTTPError as e:
            detail = e.read().decode(errors='replace')
            raise CalError(f'Supabase {method} {path} failed: HTTP {e.code} {detail}')
        except urllib.error.URLError as e:
            raise CalError(f'Could not reach Supabase: {e.reason}')
        return json.loads(raw) if raw.strip() else []

    def select(self, table, params):
        out, offset, page = [], 0, 1000
        while True:
            p = dict(params, limit=str(page), offset=str(offset))
            rows = self.request('GET', table, p)
            out.extend(rows)
            if len(rows) < page:
                return out
            offset += page

    def get_event(self, ev_id):
        try:
            uuid.UUID(ev_id)
        except ValueError:
            raise CalError(f'"{ev_id}" is not an event id (expected a UUID; use find or list to get ids).')
        rows = self.request('GET', 'events', {'id': f'eq.{ev_id}', 'select': '*'})
        if not rows:
            raise CalError(f'No event with id {ev_id}')
        return rows[0]

    def insert(self, table, rows, on_conflict=None):
        params = {'on_conflict': on_conflict} if on_conflict else None
        prefer = 'return=representation' + (',resolution=ignore-duplicates' if on_conflict else '')
        return self.request('POST', table, params, rows, prefer=prefer, write=True)

    def patch(self, ev_id, changes):
        rows = self.request('PATCH', 'events', {'id': f'eq.{ev_id}'}, changes, prefer='return=representation', write=True)
        return rows[0] if rows else None

    def delete(self, table, params):
        return self.request('DELETE', table, params, prefer='return=representation', write=True)


# ---------------------------------------------------------------- output shaping
def present(row, occ=None):
    cal = row['calendar']
    s0 = from_db_ts(row['start_at'])
    e0 = from_db_ts(row.get('end_at'))
    start, end = (occ[0], occ[1]) if occ else (s0, e0)
    all_day = bool(row.get('all_day'))
    if all_day and occ:
        end = end - dt.timedelta(days=1)  # back to inclusive for display
    rec = row.get('recur_freq') or 'none'
    key = occ[2].isoformat() if occ else None
    out = {
        'id': row['id'],
        'calendar': cal,
        'calendar_name': CALENDARS.get(cal, {}).get('name', cal),
        'title': row['title'],
        'category': row.get('category'),
        'all_day': all_day,
        'start': start.date().isoformat() if all_day else start.strftime('%Y-%m-%dT%H:%M'),
        'end': (end.date().isoformat() if all_day else end.strftime('%Y-%m-%dT%H:%M')) if end else None,
        'time_zone': TZ_NAME,
    }
    if not all_day:
        out['start_iso'] = iso_offset(start)
        out['end_iso'] = iso_offset(end) if end else None
        out['display'] = f"{WD_NAMES[(start.weekday() + 1) % 7]} {start:%b} {start.day}, {start:%I:%M %p}".replace(' 0', ' ') + \
            (f" – {end:%I:%M %p}".replace('– 0', '– ') if end else '') + ' CT'
    else:
        out['display'] = f"{WD_NAMES[(start.weekday() + 1) % 7]} {start:%b} {start.day} (all day)"
    if occ:
        out['occurrence_date'] = key
    out['repeat'] = None if rec == 'none' else {
        'freq': rec, 'interval': row.get('recur_interval') or 1, 'until': row.get('recur_until'),
        'days': [WD_NAMES[d] for d in (row.get('recur_by_weekday') or [])] if rec == 'weekly' else None,
        'series_start': row['start_at'][:10], 'skipped_dates': row.get('exdates') or []}
    if row.get('series_id'):
        out['exception_of'] = row['series_id']
        out['replaces_occurrence'] = row.get('original_date')
    if row.get('is_task'):
        out['task'] = {'scope': row.get('task_scope') or 'day',
                       'done': (key in (row.get('completed_dates') or [])) if (rec != 'none' and key) else bool(row.get('done')),
                       'completed_dates': row.get('completed_dates') or [] if rec != 'none' else None}
    for k in ('location', 'notes'):
        if row.get(k):
            out[k] = row[k]
    if row.get('example'):
        out['example'] = True
    for k in ('source', 'created_at', 'updated_at'):
        if row.get(k):
            out[k] = row[k]
    return out


# ---------------------------------------------------------------- field building
def resolve_times(args, base_row=None):
    """Return dict of start_at/end_at/all_day changes from args (may be empty)."""
    ch = {}
    all_day = base_row.get('all_day') if base_row else False
    if getattr(args, 'all_day', None):
        all_day = True
    if getattr(args, 'timed', None):
        all_day = False
    if base_row is None or args.all_day or getattr(args, 'timed', None):
        ch['all_day'] = all_day

    old_s = from_db_ts(base_row['start_at']) if base_row else None
    old_e = from_db_ts(base_row.get('end_at')) if base_row else None
    s_date = s_time = e_date = e_time = None
    if args.start:
        s_date, s_time = parse_when(args.start)
    if args.end:
        # --end "7pm" / "19:00" (time only) -> same day as the start
        if not all_day and re.fullmatch(r'\d{1,2}(:\d{2})?\s*(am|pm|a|p)?|noon|midnight', args.end.strip().lower()):
            e_time = parse_time(args.end)
        else:
            e_date, e_time = parse_when(args.end)
    if getattr(args, 'start_time', None):
        s_time = parse_time(args.start_time)
    if getattr(args, 'end_time', None):
        e_time = parse_time(args.end_time)

    if base_row is None and not s_date:
        raise CalError('--start is required (e.g. "2026-10-20 18:00", or a date with --all-day)')
    if not any([s_date, s_time, e_date, e_time, args.duration, 'all_day' in ch]):
        return ch

    sd = s_date or (old_s.date() if old_s else None)
    if all_day:
        new_s = dt.datetime.combine(sd, dt.time())
        if e_date:
            ed = e_date
        elif args.start and old_s is not None and old_e is not None:  # keep length when moving
            ed = sd + (old_e.date() - old_s.date())
        elif old_e is not None and not args.start:
            ed = old_e.date()
        else:
            ed = sd
        if args.duration:
            ed = sd + dt.timedelta(days=max(0, parse_duration(args.duration).days - 1))
        new_e = dt.datetime.combine(max(ed, sd), dt.time())
    else:
        if s_time is None:
            if old_s is not None and not (base_row and base_row.get('all_day')):
                s_time = old_s.time()
            else:
                raise CalError('Give a start time (e.g. --start "2026-10-20 6pm"), or use --all-day.')
        new_s = dt.datetime.combine(sd, s_time)
        old_dur = (old_e - old_s) if (old_s and old_e and not base_row.get('all_day') and old_e > old_s) else dt.timedelta(hours=1)
        if args.duration:
            new_e = new_s + parse_duration(args.duration)
        elif e_time is not None or e_date is not None:
            ed = e_date or sd
            et = e_time or (old_e.time() if old_e else (new_s + old_dur).time())
            new_e = dt.datetime.combine(ed, et)
            if new_e <= new_s and e_date is None:
                new_e += dt.timedelta(days=1)  # e.g. 10pm-1am
        else:
            new_e = new_s + old_dur
        if new_e <= new_s:
            raise CalError('End must be after start.')
    ch['start_at'] = db_ts(new_s.date(), new_s.time())
    ch['end_at'] = db_ts(new_e.date(), new_e.time())
    return ch


def resolve_recurrence(args, base_row=None):
    ch = {}
    if getattr(args, 'no_repeat', None):
        return {'recur_freq': 'none', 'recur_interval': 1, 'recur_until': None, 'recur_by_weekday': None}
    if args.repeat:
        if args.repeat not in FREQS:
            raise CalError(f'--repeat must be one of {", ".join(FREQS)}')
        ch['recur_freq'] = args.repeat
    freq = ch.get('recur_freq', base_row.get('recur_freq') if base_row else 'none')
    if args.every is not None:
        if args.every < 1:
            raise CalError('--every must be 1 or more')
        ch['recur_interval'] = args.every
    if args.until:
        ch['recur_until'] = parse_date(args.until).isoformat()
    if getattr(args, 'no_until', None):
        ch['recur_until'] = None
    if args.days:
        if freq != 'weekly':
            if args.repeat is None and freq == 'none':
                ch['recur_freq'] = freq = 'weekly'  # "--days mon,wed" implies weekly
            elif freq != 'weekly':
                raise CalError('--days only applies to weekly repeats')
        ch['recur_by_weekday'] = parse_weekdays(args.days)
    if freq == 'none' and base_row is None:
        ch.update(recur_freq='none', recur_interval=1, recur_until=None, recur_by_weekday=None)
    if freq != 'weekly' and 'recur_freq' in ch:
        ch['recur_by_weekday'] = None
    return ch


def ensure_weekly_days(row):
    if row.get('recur_freq') == 'weekly' and not row.get('recur_by_weekday'):
        row['recur_by_weekday'] = [(from_db_ts(row['start_at']).weekday() + 1) % 7]


def default_category(cal, is_task):
    return 'Task / to-do' if (is_task and cal == 'lifetime') else 'Other'


def category_rows_needed(client, pairs):
    """pairs: [(calendar, category)] -> rows to insert into categories (custom ones not yet known)."""
    need = [(c, n) for c, n in pairs if n and n not in CALENDARS[c]['categories']]
    if not need:
        return [], None
    if not client.configured:
        return [{'calendar': c, 'name': n} for c, n in dict.fromkeys(need)], 'not checked (no credentials); upsert ignores duplicates'
    existing = {(r['calendar'], r['name']) for r in client.select('categories', {'select': 'calendar,name'})}
    return [{'calendar': c, 'name': n} for c, n in dict.fromkeys(need) if (c, n) not in existing], None


# ---------------------------------------------------------------- commands
def cmd_list(client, args):
    rs, re_ = date_range(args)
    cals = parse_calendars(args.calendar) if args.calendar else list(CALENDARS)
    rows = fetch_range(client, rs, re_, cals)
    occ = []
    for r in rows:
        if args.tasks_only and not r.get('is_task'):
            continue
        for o in occurrences(r, rs, re_):
            occ.append(present(r, o))
    occ.sort(key=lambda x: (x['start'], not x['all_day'], x['calendar'], x['title']))
    return {'range': {'from': rs.date().isoformat(), 'to': (re_ - dt.timedelta(days=1)).date().isoformat(), 'time_zone': TZ_NAME},
            'calendars': cals, 'count': len(occ), 'occurrences': occ}


def date_range(args):
    start = parse_date(args.from_) if args.from_ else now_chicago().date()
    if args.to:
        end = parse_date(args.to)
    else:
        end = start + dt.timedelta(days=(args.days or 7) - 1)
    if end < start:
        raise CalError('--to is before --from')
    return dt.datetime.combine(start, dt.time()), dt.datetime.combine(end + dt.timedelta(days=1), dt.time())


def fetch_range(client, rs, re_, cals, extra=None):
    a, b = rs.strftime('%Y-%m-%dT%H:%M:%S'), re_.strftime('%Y-%m-%dT%H:%M:%S')
    prev_day = (rs - dt.timedelta(days=1)).strftime('%Y-%m-%dT%H:%M:%S')
    params = {
        'select': '*',
        'calendar': f'in.({",".join(cals)})',
        'or': f'(recur_freq.neq.none,and(start_at.lt.{b},end_at.gte.{prev_day}),and(start_at.gte.{prev_day},start_at.lt.{b}))',
        'order': 'start_at.asc',
    }
    if extra:
        params.update(extra)
    return client.select('events', params)


def cmd_find(client, args):
    text = args.text.replace('"', '').strip()
    if not text:
        raise CalError('Give some text to search for')
    pat = f'"*{text}*"'
    params = {'select': '*', 'or': f'(title.ilike.{pat},notes.ilike.{pat},location.ilike.{pat},category.ilike.{pat})',
              'order': 'start_at.asc'}
    if args.calendar:
        params['calendar'] = f'in.({",".join(parse_calendars(args.calendar))})'
    rows = client.select('events', params)
    if args.from_ or args.to:
        rs, re_ = date_range(args)
        hits = []
        for r in rows:
            occ = occurrences(r, rs, re_)
            if occ:
                hits.append(dict(present(r), next_occurrences=[present(r, o)['start'] for o in occ[:10]]))
        return {'query': args.text, 'count': len(hits), 'events': hits}
    nowc = now_chicago()
    out = []
    for r in rows:
        p = present(r)
        nxt = occurrences(r, nowc.replace(hour=0, minute=0), nowc + dt.timedelta(days=400))
        p['next_occurrence'] = present(r, nxt[0])['start'] if nxt else None
        out.append(p)
    return {'query': args.text, 'count': len(out), 'events': out}


def cmd_get(client, args):
    row = client.get_event(args.id)
    out = present(row)
    if (row.get('recur_freq') or 'none') != 'none':
        out['exceptions'] = [present(r) for r in client.select('events', {'select': '*', 'series_id': f'eq.{row["id"]}'})]
    return out


def cmd_categories(client, args):
    cals = parse_calendars(args.calendar) if args.calendar else list(CALENDARS)
    custom = client.select('categories', {'select': 'calendar,name', 'order': 'name.asc'}) if client.configured else []
    return {c: {'name': CALENDARS[c]['name'], 'preset': CALENDARS[c]['categories'],
                'custom': [r['name'] for r in custom if r['calendar'] == c]} for c in cals}


def cmd_add(client, args):
    cals = parse_calendars(args.calendar)
    if args.scope and not args.task:
        raise CalError('--scope only applies with --task')
    times = resolve_times(args)
    rec = resolve_recurrence(args)
    rows = []
    for cal in cals:
        row = {'id': str(uuid.uuid4()), 'calendar': cal, 'title': args.title.strip(),
               'category': args.category or default_category(cal, args.task),
               'location': args.location or '', 'notes': args.notes or '',
               'is_task': bool(args.task), 'task_scope': (args.scope or 'day') if args.task else None,
               'done': False, 'completed_dates': [], 'exdates': [], 'source': args.source}
        row.update(times)
        row.update(rec)
        ensure_weekly_days(row)
        rows.append(row)
    if not rows[0]['title']:
        raise CalError('--title is required')
    cat_rows, cat_note = category_rows_needed(client, [(r['calendar'], r['category']) for r in rows])
    if cat_rows:
        client.insert('categories', cat_rows, on_conflict='calendar,name')
    created = client.insert('events', rows)
    res = {'action': 'add', 'created': [present(r) for r in created]}
    if cat_rows:
        res['new_categories'] = cat_rows
        if cat_note:
            res['category_check'] = cat_note
    return res


def build_field_changes(args, row):
    ch = {}
    if args.title is not None:
        if not args.title.strip():
            raise CalError('Title cannot be empty')
        ch['title'] = args.title.strip()
    if args.calendar is not None:
        cals = parse_calendars(args.calendar)
        if len(cals) != 1:
            raise CalError('edit moves an event to ONE calendar; use add --calendar all to copy it')
        ch['calendar'] = cals[0]
    if args.category is not None:
        ch['category'] = args.category
    for k in ('location', 'notes'):
        v = getattr(args, k)
        if v is not None:
            ch[k] = v
    if args.task:
        ch['is_task'] = True
        ch['task_scope'] = args.scope or row.get('task_scope') or 'day'
    elif args.not_task:
        ch['is_task'] = False
        ch['task_scope'] = None
    elif args.scope:
        if not row.get('is_task'):
            raise CalError('--scope only applies to tasks (add --task)')
        ch['task_scope'] = args.scope
    ch.update(resolve_times(args, row))
    return ch


def cmd_edit(client, args):
    row = client.get_event(args.id)
    recurring = (row.get('recur_freq') or 'none') != 'none'
    occ_date = parse_date(args.occurrence).isoformat() if args.occurrence else None

    # --- check off / un-check a task
    if args.done or args.not_done:
        if not row.get('is_task'):
            raise CalError('That item is not a task')
        val = bool(args.done)
        if recurring:
            if not occ_date:
                raise CalError('This task repeats: give --occurrence YYYY-MM-DD to check off one day')
            if not occurs_on(row, occ_date):
                raise CalError(f'The task does not occur on {occ_date}')
            cd = set(row.get('completed_dates') or [])
            cd.add(occ_date) if val else cd.discard(occ_date)
            upd = client.patch(row['id'], {'completed_dates': sorted(cd), 'source': args.source})
        else:
            upd = client.patch(row['id'], {'done': val, 'source': args.source})
        return {'action': 'mark_done' if val else 'mark_not_done', 'occurrence_date': occ_date,
                'before': present(row), 'after': present(merge(row, upd))}

    # --- change ONE occurrence of a series -> detached exception row
    if occ_date:
        if not recurring:
            raise CalError('--occurrence only applies to repeating events (this one does not repeat)')
        if not occurs_on(row, occ_date, include_skipped=True):
            raise CalError(f'The series has no occurrence on {occ_date}')
        if args.repeat or args.days or args.every or args.until or args.no_repeat:
            raise CalError('A single occurrence cannot have its own repeat rule')
        if args.calendar is not None:
            raise CalError('Move the whole series to another calendar, not one occurrence')
        # occurrence as a one-off row, then apply edits on top of it
        o_start = dt.datetime.combine(dt.date.fromisoformat(occ_date), from_db_ts(row['start_at']).time())
        s0, e0 = from_db_ts(row['start_at']), from_db_ts(row.get('end_at')) or from_db_ts(row['start_at'])
        o_end = o_start + (e0 - s0)
        base = {k: row.get(k) for k in ('calendar', 'category', 'title', 'all_day', 'location', 'notes', 'is_task', 'task_scope', 'example')}
        base.update(start_at=db_ts(o_start.date(), o_start.time()), end_at=db_ts(o_end.date(), o_end.time()),
                    recur_freq='none', recur_interval=1, recur_until=None, recur_by_weekday=None, exdates=[],
                    completed_dates=[], done=occ_date in (row.get('completed_dates') or []),
                    series_id=row['id'], original_date=occ_date, source=args.source, id=str(uuid.uuid4()))
        base.update(build_field_changes(args, base))
        existing = client.select('events', {'select': '*', 'series_id': f'eq.{row["id"]}', 'original_date': f'eq.{occ_date}'})
        if not existing and occ_date in (row.get('exdates') or []):
            raise CalError(f'The {occ_date} occurrence was deleted. Add a new one-off event instead.')
        if existing:  # already detached earlier -> edit that row instead
            ex = existing[0]
            ch = build_field_changes(args, ex)
            ch['source'] = args.source
            upd = client.patch(ex['id'], ch)
            return {'action': 'edit_occurrence', 'note': 'occurrence was already detached; edited it',
                    'changes': ch, 'before': present(ex), 'after': present(merge(ex, upd))}
        exd = sorted(set(row.get('exdates') or []) | {occ_date})
        cd = sorted(set(row.get('completed_dates') or []) - {occ_date})
        created = client.insert('events', [base])
        client.patch(row['id'], {'exdates': exd, 'completed_dates': cd})
        return {'action': 'edit_occurrence', 'series_id': row['id'], 'occurrence_date': occ_date,
                'series_change': {'exdates': exd}, 'created_exception': present(created[0] if created else base)}

    # --- whole event / whole series
    ch = build_field_changes(args, row)
    if row.get('series_id') and (args.repeat or args.days or args.every or args.until):
        raise CalError('This row is a single changed occurrence of a series; edit the series id instead to change the repeat rule')
    ch.update(resolve_recurrence(args, row))
    if not ch:
        raise CalError('Nothing to change. Pass at least one field, e.g. --title, --start, --repeat.')
    preview = merge(row, ch)
    ensure_weekly_days(preview)
    if preview.get('recur_by_weekday') != row.get('recur_by_weekday'):
        ch['recur_by_weekday'] = preview.get('recur_by_weekday')
    if preview.get('end_at') and preview['end_at'] < preview['start_at']:
        raise CalError('End would be before start')
    ch['source'] = args.source
    upd = client.patch(row['id'], ch)
    res = {'action': 'edit_series' if recurring else 'edit', 'id': row['id'], 'changes': ch,
           'before': present(row), 'after': present(merge(row, upd if not client.dry_run else ch))}
    if recurring:
        n = client.select('events', {'select': 'id', 'series_id': f'eq.{row["id"]}'})
        if n:
            res['note'] = f'{len(n)} individually changed occurrence(s) keep their own details.'
    return res


def cmd_delete(client, args):
    row = client.get_event(args.id)
    recurring = (row.get('recur_freq') or 'none') != 'none'
    if args.occurrence:
        occ_date = parse_date(args.occurrence).isoformat()
        if not recurring:
            raise CalError('--occurrence only applies to repeating events; delete without it to remove this event')
        if not occurs_on(row, occ_date, include_skipped=True):
            raise CalError(f'The series has no occurrence on {occ_date}')
        exd = sorted(set(row.get('exdates') or []) | {occ_date})
        cd = sorted(set(row.get('completed_dates') or []) - {occ_date})
        client.patch(row['id'], {'exdates': exd, 'completed_dates': cd, 'source': args.source})
        removed = client.delete('events', {'series_id': f'eq.{row["id"]}', 'original_date': f'eq.{occ_date}'})
        removed = [r['id'] for r in removed if isinstance(r, dict) and r.get('id')]
        return {'action': 'delete_occurrence', 'series_id': row['id'], 'occurrence_date': occ_date,
                'title': row['title'], 'removed_exception_rows': removed}
    if recurring and not args.series:
        raise CalError('This event repeats. Use --occurrence YYYY-MM-DD for one day, or --series to delete them all.')
    exc = client.select('events', {'select': 'id', 'series_id': f'eq.{row["id"]}'}) if recurring else []
    client.delete('events', {'id': f'eq.{row["id"]}'})
    res = {'action': 'delete_series' if recurring else 'delete', 'deleted': present(row)}
    if exc:
        res['also_deleted_exceptions'] = [r['id'] for r in exc]
    if row.get('series_id'):
        res['note'] = 'This was a changed occurrence; that date stays removed from the series.'
    return res


def occurs_on(row, date_iso, include_skipped=False):
    d = dt.date.fromisoformat(date_iso)
    r = dict(row)
    if include_skipped:
        r['exdates'] = []
    a = dt.datetime.combine(d, dt.time())
    return any(o[2] == d for o in occurrences(r, a, a + dt.timedelta(days=1)))


def merge(row, ch):
    out = dict(row)
    out.update(ch or {})
    return out


# ---------------------------------------------------------------- CLI
def add_time_args(p, editing=False):
    p.add_argument('--start', help='start, e.g. "2026-10-20 6:30pm" (Chicago). All-day: just the date')
    p.add_argument('--end', help='end, e.g. "2026-10-20 7:30pm" or "7:30pm". All-day: last day (inclusive)')
    p.add_argument('--duration', help='instead of --end: minutes (90) or 1h30m')
    p.add_argument('--all-day', action='store_true', help='all-day item')
    if editing:
        p.add_argument('--timed', action='store_true', help='turn an all-day item into a timed one (give --start-time)')
        p.add_argument('--start-time', help='change only the time of day (e.g. 18:00), keeps the date(s)')
        p.add_argument('--end-time', help='change only the end time of day')


def add_repeat_args(p, editing=False):
    p.add_argument('--repeat', choices=FREQS, help='daily | weekly | monthly | yearly | none')
    p.add_argument('--every', type=int, help='interval, e.g. 2 = every other week')
    p.add_argument('--days', help='weekly days: mon,wed,fri | weekdays | weekends')
    p.add_argument('--until', help='last date (inclusive) the series runs')
    if editing:
        p.add_argument('--no-until', action='store_true', help='remove the end date of a series')
        p.add_argument('--no-repeat', action='store_true', help='stop repeating (keep only the first date)')


def add_common_fields(p):
    p.add_argument('--title')
    p.add_argument('--category', help='e.g. "Film study". New names are added as custom categories')
    p.add_argument('--location')
    p.add_argument('--notes')
    p.add_argument('--task', action='store_true', help='make it a task / to-do')
    p.add_argument('--scope', choices=SCOPES, help='task scope: day | week | month | season')


def build_parser():
    ap = argparse.ArgumentParser(prog='cal.py', description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = ap.add_subparsers(dest='cmd', required=True)

    p = sub.add_parser('list', help='occurrences in a date range')
    p.add_argument('--from', dest='from_', help='first day (default today, Chicago)')
    p.add_argument('--to', help='last day, inclusive')
    p.add_argument('--days', type=int, help='number of days if --to is omitted (default 7)')
    p.add_argument('--calendar', help='msc | mam | lifetime | all | comma list (default all)')
    p.add_argument('--tasks-only', action='store_true')

    p = sub.add_parser('find', help='search title/notes/location/category')
    p.add_argument('text')
    p.add_argument('--calendar')
    p.add_argument('--from', dest='from_')
    p.add_argument('--to')
    p.add_argument('--days', type=int)

    p = sub.add_parser('get', help='one event by id (with its changed occurrences)')
    p.add_argument('id')

    p = sub.add_parser('categories', help='preset + custom categories')
    p.add_argument('--calendar')

    p = sub.add_parser('add', help='add an event/task to one calendar or all')
    p.add_argument('--calendar', required=True, help='msc | mam | lifetime | all | comma list')
    add_common_fields(p)
    add_time_args(p)
    add_repeat_args(p)

    p = sub.add_parser('edit', help='edit an event (whole series by default)')
    p.add_argument('id')
    p.add_argument('--occurrence', help='YYYY-MM-DD: change only that occurrence of a repeating event')
    p.add_argument('--calendar', help='move to another calendar')
    add_common_fields(p)
    p.add_argument('--not-task', action='store_true', help='turn a task back into a normal event')
    add_time_args(p, editing=True)
    add_repeat_args(p, editing=True)
    p.add_argument('--done', action='store_true', help='check off a task (repeating: with --occurrence)')
    p.add_argument('--not-done', action='store_true', help='un-check a task')

    p = sub.add_parser('delete', help='delete an event, one occurrence, or a whole series')
    p.add_argument('id')
    g = p.add_mutually_exclusive_group()
    g.add_argument('--occurrence', help='YYYY-MM-DD: skip just that occurrence')
    g.add_argument('--series', action='store_true', help='delete the whole repeating series')
    return ap


def main(argv=None):
    argv = list(sys.argv[1:] if argv is None else argv)
    dry = '--dry-run' in argv
    argv = [a for a in argv if a != '--dry-run']
    source = os.environ.get('CAL_SOURCE') or 'bot'
    if '--source' in argv:
        i = argv.index('--source')
        if i + 1 >= len(argv):
            print(json.dumps({'ok': False, 'error': '--source needs a value'}))
            return 2
        source = argv[i + 1]
        del argv[i:i + 2]
    args = build_parser().parse_args(argv)
    args.source = source
    client = Client(dry_run=dry)
    try:
        fn = {'list': cmd_list, 'find': cmd_find, 'get': cmd_get, 'categories': cmd_categories,
              'add': cmd_add, 'edit': cmd_edit, 'delete': cmd_delete}[args.cmd]
        result = fn(client, args)
        out = {'ok': True, 'dry_run': dry}
        out.update(result if isinstance(result, dict) else {'result': result})
        if dry and args.cmd in ('add', 'edit', 'delete'):
            for a, b in (('created', 'would_create'), ('after', 'would_be'), ('deleted', 'would_delete'),
                         ('created_exception', 'would_create_exception'), ('also_deleted_exceptions', 'would_also_delete_exceptions')):
                if a in out:
                    out[b] = out.pop(a)
            out['would_send'] = client.planned
            out['note'] = 'DRY RUN: nothing was written.'
        print(json.dumps(out, indent=2, ensure_ascii=False, default=str))
        return 0
    except CalError as e:
        print(json.dumps({'ok': False, 'dry_run': dry, 'error': str(e)}, indent=2, ensure_ascii=False))
        return 1


if __name__ == '__main__':
    sys.exit(main())
