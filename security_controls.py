"""Central request protection and persistent, session-independent throttling."""
import hashlib
from contextlib import closing
import sqlite3
import time
from pathlib import Path
from flask import request, abort, session
from persistent_storage import data_directory

DEVICE_ENDPOINTS = {'play_stream','stop_stream','set_volume','wifi_status','wifi_saved','bluetooth_status','bluetooth_power','bluetooth_scan','bluetooth_connect','wifi_connect','wifi_scan','network_status'}

def register_security(app):
    app.config['MAX_CONTENT_LENGTH'] = 16 * 1024 * 1024
    app.config['SESSION_COOKIE_HTTPONLY'] = True
    app.config['SESSION_COOKIE_SAMESITE'] = 'Lax'
    database = Path(data_directory('owner_data')) / 'security.sqlite3'

    def limit(scope, maximum, window, identity):
        key = scope + ':' + hashlib.sha256(identity.encode()).hexdigest()
        now = int(time.time())
        with closing(sqlite3.connect(database, timeout=5)) as db, db:
            db.execute('CREATE TABLE IF NOT EXISTS limits (key TEXT PRIMARY KEY, count INTEGER, expires INTEGER)')
            db.execute('BEGIN IMMEDIATE')
            db.execute('DELETE FROM limits WHERE expires <= ?', (now,))
            row = db.execute('SELECT count, expires FROM limits WHERE key=?', (key,)).fetchone()
            if row and row[0] >= maximum:
                abort(429, 'Too many requests. Please try again later.')
            db.execute('INSERT OR REPLACE INTO limits VALUES (?,?,?)', (key, row[0]+1 if row else 1, row[1] if row else now+window))

    @app.before_request
    def protect_requests():
        from station_owners import check_token
        if request.endpoint in DEVICE_ENDPOINTS:
            abort(403, 'Device controls are not available on the public website.')
        if request.method == 'POST' and request.path.startswith('/admin/'):
            check_token()
        identity = request.remote_addr or 'unknown'
        if request.method == 'POST' and request.endpoint == 'admin_login':
            limit('admin-login', 20, 900, identity)
            limit('admin-login-total', 200, 900, 'all')
        if request.method == 'POST' and request.endpoint == 'owner_login':
            email = request.form.get('email', '').strip().casefold()[:254]
            limit('owner-login', 10, 900, email)
            limit('owner-login-ip', 50, 900, identity)
        if request.endpoint == 'api_add_station' and request.method == 'POST':
            limit('station-submit', 10, 3600, identity)
            limit('station-submit-total', 100, 86400, 'all')
            if sum(p.stat().st_size for p in Path(app.config['RADIO_UPLOAD_FOLDER']).glob('*') if p.is_file()) > 768 * 1024 * 1024:
                abort(503, 'Station uploads are temporarily full. Contact the administrator.')
        if request.endpoint == 'api_report_station' and request.method == 'POST':
            limit('report', 5, 900, identity)
            limit('report-total', 100, 3600, 'all')
        if request.endpoint == 'api_listen_heartbeat' and request.method == 'POST':
            limit('heartbeat', 120, 60, identity)
            limit('heartbeat-total', 10000, 3600, 'all')
        if request.endpoint == 'resolve_browser_stream' and request.method == 'POST':
            limit('resolve', 30, 60, identity)

    @app.after_request
    def security_headers(response):
        response.headers['X-Content-Type-Options'] = 'nosniff'
        response.headers['X-Frame-Options'] = 'DENY'
        response.headers['Referrer-Policy'] = 'strict-origin-when-cross-origin'
        response.headers['Content-Security-Policy'] = "frame-ancestors 'none'; object-src 'none'; base-uri 'self'"
        return response
