"""Offline test of cal.py note-get/note-set/note-list with an in-memory fake Supabase. python3 tests/cal_notes_test.py"""
import json, sys, os, io, contextlib, re
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', 'tools'))
import cal
SER = '11111111-1111-4111-8111-111111111111'; EXC = '22222222-2222-4222-8222-222222222222'; ONE = '33333333-3333-4333-8333-333333333333'
EV = [dict(id=SER, calendar='mam', title='Maryville practice', category='x', all_day=False, start_at='2026-10-06T12:00:00', end_at='2026-10-06T15:00:00',
           recur_freq='weekly', recur_interval=1, recur_until=None, recur_by_weekday=[1, 2, 3, 4, 5], exdates=['2026-10-21'], series_id=None, original_date=None),
      dict(id=EXC, calendar='mam', title='Maryville practice (late)', category='x', all_day=False, start_at='2026-10-21T16:00:00', end_at='2026-10-21T18:00:00',
           recur_freq='none', recur_interval=1, exdates=[], series_id=SER, original_date='2026-10-21'),
      dict(id=ONE, calendar='msc', title='Talk', category='x', all_day=False, start_at='2026-10-22T09:00:00', end_at='2026-10-22T10:00:00',
           recur_freq='none', recur_interval=1, exdates=[], series_id=None, original_date=None)]
NOTES = []
class Fake(cal.Client):
    def __init__(self): super().__init__(); self.url = 'x'; self.key = 'x'
    def request(self, method, path, params=None, body=None, prefer=None, write=False):
        params = params or {}
        def eq(k): v = params.get(k); return v[3:] if v and v.startswith('eq.') else None
        if path == 'events':
            rows = EV
            if eq('id'): rows = [r for r in rows if r['id'] == eq('id')]
            if params.get('id', '').startswith('in.('): ids = params['id'][4:-1].split(','); rows = [r for r in rows if r['id'] in ids]
            if params.get('series_id', '').startswith('in.('): ids = params['series_id'][4:-1].split(','); rows = [r for r in rows if r['series_id'] in ids]
            return rows if params.get('offset', '0') == '0' else []
        if method == 'GET':
            rows = NOTES
            if eq('event_id'): rows = [n for n in rows if n['event_id'] == eq('event_id') and n['occurrence_date'] == eq('occurrence_date')]
            m = re.match(r'\(occurrence_date\.gte\.(.+),occurrence_date\.lte\.(.+)\)', params.get('and', ''))
            if m: rows = [n for n in rows if m.group(1) <= n['occurrence_date'] <= m.group(2)]
            return rows if params.get('offset', '0') == '0' else []
        if method == 'POST':
            for b in body:
                NOTES[:] = [n for n in NOTES if not (n['event_id'] == b['event_id'] and n['occurrence_date'] == b['occurrence_date'])]
                NOTES.append(dict(b, id='n', updated_at='t'))
            return body
        if method == 'DELETE':
            before = len(NOTES); NOTES[:] = [n for n in NOTES if not (n['event_id'] == eq('event_id') and n['occurrence_date'] == eq('occurrence_date'))]
            return [1] * (before - len(NOTES))
cal.Client = lambda dry_run=False: Fake()
def run(*a):
    buf = io.StringIO()
    with contextlib.redirect_stdout(buf): cal.main(list(a))
    return json.loads(buf.getvalue())
def ok(c, m):
    if not c: raise SystemExit('FAIL: ' + m)
    print('ok -', m)
before = json.dumps(EV)
r = run('note-set', SER, '--date', '2026-10-20', '--text', 'Tue: closeouts'); ok(r['ok'] and r['date'] == '2026-10-20' and r['time'].startswith('Tue Oct 20'), 'set on series occurrence')
ok(run('note-get', SER, '--date', '2026-10-22')['note'] is None, 'other occurrence has no note')
ok(not run('note-set', SER, '--date', '2026-10-25', '--text', 'x')['ok'], 'rejects a date the series does not occur on (Sunday)')
r = run('note-set', EXC, '--text', 'Late start'); ok(r['ok'] and NOTES[-1]['event_id'] == SER and NOTES[-1]['occurrence_date'] == '2026-10-21', 'changed occurrence keyed to series + original date')
run('note-set', ONE, '--text', 'Talk went well')
L = run('note-list', '--from', '2026-10-19', '--to', '2026-10-25'); ok(L['count'] == 3 and [n['date'] for n in L['notes']] == ['2026-10-20', '2026-10-21', '2026-10-22'], 'note-list range')
ok(L['notes'][1]['title'] == 'Maryville practice (late)' and '4:00 PM' in L['notes'][1]['time'], 'note-list shows changed occurrence title/time')
ok(set(L['notes'][0]) >= {'date', 'title', 'calendar', 'time', 'note'}, 'note-list fields')
ok(run('note-list', '--from', '2026-10-19', '--to', '2026-10-25', '--calendar', 'msc')['count'] == 1, 'note-list calendar filter')
r = run('note-set', SER, '--date', '2026-10-20', '--text', ''); ok(r['deleted'] and len(NOTES) == 2, 'empty text deletes')
ok(json.dumps(EV) == before, 'events never modified')
print('ALL CAL NOTE TESTS PASSED')
