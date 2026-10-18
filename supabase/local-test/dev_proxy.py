#!/usr/bin/env python3
"""LOCAL TESTING ONLY: serve the app and proxy /rest/v1/* to a local PostgREST,
so the app's Supabase adapter can be exercised without a real Supabase project.
usage: dev_proxy.py [port] [postgrest_url]"""
import http.server, sys, urllib.request, urllib.error, os
PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 8766
UP = sys.argv[2] if len(sys.argv) > 2 else 'http://127.0.0.1:3000'
ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
class H(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *a, **k): super().__init__(*a, directory=ROOT, **k)
    def _proxy(self):
        if not self.path.startswith('/rest/v1/'):
            if self.command == 'GET': return super().do_GET()
            self.send_error(404); return
        n = int(self.headers.get('Content-Length') or 0)
        body = self.rfile.read(n) if n else None
        req = urllib.request.Request(UP + self.path[len('/rest/v1'):], data=body, method=self.command)
        for k in ('Authorization', 'Content-Type', 'Prefer', 'Accept', 'Range', 'Content-Profile', 'Accept-Profile'):
            if self.headers.get(k): req.add_header(k, self.headers[k])
        try: r = urllib.request.urlopen(req)
        except urllib.error.HTTPError as e: r = e
        data = r.read(); self.send_response(r.status)
        for k, v in r.headers.items():
            if k.lower() not in ('transfer-encoding', 'connection', 'content-length'): self.send_header(k, v)
        self.send_header('Content-Length', str(len(data))); self.end_headers(); self.wfile.write(data)
    do_GET = do_POST = do_PATCH = do_DELETE = do_PUT = _proxy
    def do_HEAD(self): self._proxy()
    def log_message(self, *a): pass
http.server.ThreadingHTTPServer(('127.0.0.1', PORT), H).serve_forever()
