#!/usr/bin/env python3
"""
SpeedPulse - High Precision Network Speed Test Server (Python 3)
Zero-dependency, multi-threaded high-throughput server.
"""

import os
import sys
import time
import json
import secrets
import urllib.parse
from http.server import HTTPServer, SimpleHTTPRequestHandler
from socketserver import ThreadingMixIn

import socket

PORT = int(os.environ.get('PORT', 3000))
PUBLIC_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'public')

# Pre-generate 1MB incompressible pseudo-random buffer once in memory for maximum streaming throughput
CHUNK_SIZE = 1024 * 1024  # 1 MB
RANDOM_CHUNK = secrets.token_bytes(CHUNK_SIZE)


class ThreadedHTTPServer(ThreadingMixIn, HTTPServer):
    daemon_threads = True
    allow_reuse_address = True

    def server_bind(self):
        super().server_bind()
        try:
            self.socket.setsockopt(socket.IPPROTO_TCP, socket.TCP_NODELAY, 1)
        except Exception:
            pass


class SpeedTestHandler(SimpleHTTPRequestHandler):
    def setup(self):
        super().setup()
        try:
            self.request.setsockopt(socket.IPPROTO_TCP, socket.TCP_NODELAY, 1)
        except Exception:
            pass

    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=PUBLIC_DIR, **kwargs)

    def do_OPTIONS(self):
        self.send_response(200)
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
        self.send_header('Access-Control-Allow-Headers', '*')
        self.end_headers()

    def send_cors_headers(self):
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0')
        self.send_header('Pragma', 'no-cache')
        self.send_header('Expires', '0')

    def do_GET(self):
        parsed_url = urllib.parse.urlparse(self.path)
        path = parsed_url.path
        query = urllib.parse.parse_qs(parsed_url.query)

        # 1. PING ENDPOINT
        if path == '/api/ping':
            self.send_response(200)
            self.send_header('Content-Type', 'application/json')
            self.send_cors_headers()
            self.end_headers()
            response_data = json.dumps({'status': 'ok', 'serverTime': int(time.time() * 1000)}).encode('utf-8')
            self.wfile.write(response_data)
            return

        # 2. DOWNLOAD SPEED ENDPOINT
        elif path == '/api/download':
            size_mb = 25.0
            if 'size' in query:
                try:
                    size_mb = float(query['size'][0])
                except ValueError:
                    size_mb = 25.0
            
            size_mb = max(0.1, min(size_mb, 200.0))
            total_bytes = int(size_mb * 1024 * 1024)

            self.send_response(200)
            self.send_header('Content-Type', 'application/octet-stream')
            self.send_header('Content-Length', str(total_bytes))
            self.send_header('Content-Disposition', 'attachment; filename="speedtest.bin"')
            self.send_cors_headers()
            self.end_headers()

            sent_bytes = 0
            stream_chunk_size = 64 * 1024  # 64 KB chunks for low latency streaming
            try:
                while sent_bytes < total_bytes:
                    remaining = total_bytes - sent_bytes
                    current_size = min(remaining, stream_chunk_size)
                    chunk = RANDOM_CHUNK[:current_size]
                    self.wfile.write(chunk)
                    sent_bytes += current_size
            except (BrokenPipeError, ConnectionResetError, ConnectionAbortedError):
                pass
            return

        # 3. IP & NETWORK INFO ENDPOINT
        elif path == '/api/ip-info':
            client_ip = self.headers.get('X-Forwarded-For', self.client_address[0])
            if ',' in client_ip:
                client_ip = client_ip.split(',')[0].strip()

            if client_ip in ('127.0.0.1', '::1', 'localhost'):
                client_ip = '127.0.0.1 (Localhost)'

            info = {
                'ip': client_ip,
                'isp': 'Local Machine / Network',
                'city': 'Localhost',
                'country': 'Local',
                'userAgent': self.headers.get('User-Agent', 'Unknown')
            }

            self.send_response(200)
            self.send_header('Content-Type', 'application/json')
            self.send_cors_headers()
            self.end_headers()
            self.wfile.write(json.dumps(info).encode('utf-8'))
            return

        # Fallback to static files
        return super().do_GET()

    def do_POST(self):
        parsed_url = urllib.parse.urlparse(self.path)
        path = parsed_url.path

        # 4. UPLOAD SPEED ENDPOINT
        if path == '/api/upload':
            start_time = time.perf_counter()
            content_length = int(self.headers.get('Content-Length', 0))
            
            read_bytes = 0
            chunk_size = 64 * 1024
            
            try:
                while read_bytes < content_length:
                    to_read = min(chunk_size, content_length - read_bytes)
                    chunk = self.rfile.read(to_read)
                    if not chunk:
                        break
                    read_bytes += len(chunk)
            except Exception:
                pass

            duration_ms = (time.perf_counter() - start_time) * 1000.0

            self.send_response(200)
            self.send_header('Content-Type', 'application/json')
            self.send_cors_headers()
            self.end_headers()
            
            res = {
                'status': 'ok',
                'bytesReceived': read_bytes,
                'durationMs': duration_ms
            }
            self.wfile.write(json.dumps(res).encode('utf-8'))
            return

        self.send_error(404, "Endpoint not found")

    def log_message(self, format, *args):
        # Suppress repetitive streaming log spam for clean terminal output
        if '/api/download' in args[0] or '/api/upload' in args[0] or '/api/ping' in args[0]:
            return
        super().log_message(format, *args)


def run():
    server = ThreadedHTTPServer(('0.0.0.0', PORT), SpeedTestHandler)
    print("=" * 55)
    print(">> SpeedPulse Network Speed Test Server is Running!")
    print(f">> Local Access:    http://localhost:{PORT}")
    print(f">> LAN Access:      http://<YOUR-IP>:{PORT}")
    print("=" * 55)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nStopping SpeedPulse server...")
        server.server_close()


if __name__ == '__main__':
    run()
