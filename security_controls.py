"""Central request protection and persistent, session-independent throttling."""
import hashlib
import os
from contextlib import closing
import sqlite3
import time
import secrets
from pathlib import Path
from flask import request, abort, session, g, redirect, jsonify, render_template
from persistent_storage import data_directory

DEVICE_ENDPOINTS = {'play_stream','stop_stream','set_volume','wifi_status','wifi_saved','bluetooth_status','bluetooth_power','bluetooth_scan','bluetooth_connect','wifi_connect','wifi_scan','network_status'}

def register_security(app):
    app.config['MAX_CONTENT_LENGTH'] = 16 * 1024 * 1024
    app.config['SESSION_COOKIE_HTTPONLY'] = True
    app.config['SESSION_COOKIE_SAMESITE'] = 'Lax'
    database = Path(data_directory('owner_data')) / 'security.sqlite3'

    def nonce():
        if not hasattr(g,'script_nonce'):g.script_nonce=secrets.token_urlsafe(24)
        return g.script_nonce
    app.jinja_env.globals['csp_nonce']=nonce

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
    app.extensions['security_limit']=limit

    @app.before_request
    def protect_requests():
        from station_owners import check_token
        from admin_security import valid_session
        if session.get('admin_logged_in') and not valid_session(session):
            for key in ('admin_logged_in','admin_role','admin_session'):session.pop(key,None)
            if request.path.startswith(('/admin/','/api/admin/')) and request.endpoint not in ('admin_login','admin_logout'):
                return redirect('/admin/login?expired=1')
        if request.endpoint in DEVICE_ENDPOINTS:
            abort(403, 'Device controls are not available on the public website.')
        if request.method == 'POST' and request.path.startswith('/admin/'):
            check_token()
        identity = request.remote_addr or 'unknown'
        if request.endpoint in ('station_share_qr','station_availability'):
            limit('station-public-tools',120,60,identity)
        if request.method == 'POST' and request.endpoint == 'admin_login':
            limit('admin-login', 20, 900, identity)
            limit('admin-login-total', 200, 900, 'all')
            if request.form.get('action')=='verify':
                limit('admin-authenticator',5,900,session.get('admin_challenge','none'))
                limit('admin-authenticator-total',100,900,'all')
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
        response.headers['Content-Security-Policy'] = "script-src 'self' 'nonce-"+nonce()+"'"+(" https://challenges.cloudflare.com" if os.environ.get("TURNSTILE_SITE_KEY") else "")+"; script-src-attr 'none'; frame-ancestors 'none'; object-src 'none'; base-uri 'self'; form-action 'self'"
        response.headers['Permissions-Policy']='camera=(), microphone=(), geolocation=()'
        response.headers['Strict-Transport-Security']='max-age=31536000'
        if response.mimetype=='text/html':response.headers.setdefault('Cache-Control','no-store')
        return response

    @app.errorhandler(429)
    @app.errorhandler(413)
    @app.errorhandler(400)
    def readable_request_error(error):
        messages={429:'Too many attempts. Please wait a few minutes before trying again.',413:'That upload is too large. Choose a smaller image (under 16 MB).',400:'This form or verification session may have expired. Refresh the page and try again.'}
        message=messages.get(error.code,'Please try again.')
        if error.code==400 and error.description and error.description!='The browser (or proxy) sent a request that this server could not understand.':message=error.description
        if request.path.startswith('/api/') or request.headers.get('X-Requested-With')=='fetch' or request.path in ('/station-access/verify-code','/station-access/resend-code'):
            response=jsonify(status='error',message=message)
        else:
            response=app.make_response(render_template('request_error.html',message=message))
        response.status_code=error.code
        if error.code==429:response.headers['Retry-After']='900'
        return response
