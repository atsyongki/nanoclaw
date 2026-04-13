#!/usr/bin/env python3
"""
HTTP proxy that relays Telegram Bot API calls.
grammy sends plain HTTP to this proxy; Python makes HTTPS to Telegram.
"""
import http.server
import urllib.request
import ssl
import json

TARGET = "https://api.telegram.org"
PORT = 8889

class ProxyHandler(http.server.BaseHTTPRequestHandler):
    def log_message(self, *args):
        pass  # suppress logs

    def do_POST(self):
        self._relay('POST')

    def do_GET(self):
        self._relay('GET')

    def _relay(self, method):
        length = int(self.headers.get('Content-Length', 0))
        body = self.rfile.read(length) if length else None
        url = TARGET + self.path
        ctx = ssl.create_default_context()
        req = urllib.request.Request(url, data=body, method=method)
        for h in ('Content-Type', 'Accept', 'User-Agent'):
            v = self.headers.get(h)
            if v:
                req.add_header(h, v)
        try:
            with urllib.request.urlopen(req, context=ctx, timeout=30) as resp:
                data = resp.read()
                self.send_response(resp.status)
                self.send_header('Content-Type', resp.headers.get('Content-Type', 'application/json'))
                self.send_header('Content-Length', len(data))
                self.end_headers()
                self.wfile.write(data)
        except urllib.error.HTTPError as e:
            data = e.read()
            self.send_response(e.code)
            self.send_header('Content-Type', 'application/json')
            self.send_header('Content-Length', len(data))
            self.end_headers()
            self.wfile.write(data)
        except Exception as e:
            self.send_response(502)
            self.end_headers()
            self.wfile.write(str(e).encode())

import socketserver
class ThreadedServer(socketserver.ThreadingMixIn, http.server.HTTPServer):
    daemon_threads = True

server = ThreadedServer(('127.0.0.1', PORT), ProxyHandler)
print(f'Telegram HTTP proxy on 127.0.0.1:{PORT}', flush=True)
server.serve_forever()
