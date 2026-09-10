import os
import secrets
import sqlite3
import time
from pathlib import Path
from contextlib import contextmanager
from flask import request, session, g, abort, redirect, url_for, render_template, jsonify
from werkzeug.security import generate_password_hash, check_password_hash

DATA = Path(__file__).resolve().parent / 'owner_data'
DATABASE = DATA / 'owners.sqlite3'

def connect():
    DATA.mkdir(parents=True, exist_ok=True)
    db = sqlite3.connect(DATABASE, timeout=15)
    db.row_factory = sqlite3.Row
    db.executescript('''
      CREATE TABLE IF NOT EXISTS accounts(id TEXT PRIMARY KEY,email TEXT UNIQUE NOT NULL,password TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS station_ownership(code TEXT PRIMARY KEY,owner_id TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS deletion_requests(id TEXT PRIMARY KEY,code TEXT,owner_id TEXT,name TEXT,reason TEXT,status TEXT,created INTEGER);
      CREATE UNIQUE INDEX IF NOT EXISTS one_pending_deletion ON deletion_requests(code) WHERE status='pending';
      CREATE TABLE IF NOT EXISTS login_attempts(key TEXT PRIMARY KEY,count INTEGER,until INTEGER);
    ''')
    return db

@contextmanager
def database():
    existing = getattr(g, 'owner_write_db', None)
    if existing is not None:
        yield existing
    else:
        db = connect()
        try:
            yield db
            db.commit()
        finally:
            db.close()

def token():
    if 'owner_csrf' not in session:
        session['owner_csrf'] = secrets.token_hex(24)
    return session['owner_csrf']

def check_token():
    data = request.get_json(silent=True) if request.is_json else request.form
    value = (data or {}).get('owner_csrf', '')
    if not isinstance(value, str) or not session.get('owner_csrf') or not secrets.compare_digest(session['owner_csrf'], value):
        abort(400, 'The form expired. Refresh the page and try again.')

def account():
    if not session.get('owner_id'):
        return None
    with database() as db:
        row = db.execute('SELECT id,email FROM accounts WHERE id=?', (session['owner_id'],)).fetchone()
        return dict(row) if row else None

def require_owner():
    owner = account()
    if not owner:
        abort(401)
    return owner

def attach_station(station):
    owner = require_owner()
    code = 'ST-' + secrets.token_hex(8).upper()
    with database() as db:
        db.execute('INSERT INTO station_ownership VALUES (?,?)', (code, owner['id']))
    station.update(station_code=code, owner_id=owner['id'], contact_email=owner['email'], owner_suspended=False)
    return station

def all_station_rows(store):
    for group in ('pending_stations', 'custom_stations'):
        for station in store.get(group, []):
            yield group, station

def owned_station(store, code):
    owner = require_owner()
    with database() as db:
        row = db.execute('SELECT owner_id FROM station_ownership WHERE code=?', (code,)).fetchone()
    if not row or row['owner_id'] != owner['id']:
        abort(404)
    for group, station in all_station_rows(store):
        if station.get('station_code') == code and station.get('owner_id') == owner['id']:
            return group, station
    abort(404)

def deletion_requests():
    with database() as db:
        return [dict(row) for row in db.execute("SELECT d.*,a.email FROM deletion_requests d JOIN accounts a ON a.id=d.owner_id WHERE status='pending' ORDER BY created")]

def register_owners(app, radio):
    # Persist a non-public signing key when no explicit deployment secret is set.
    if not os.environ.get('ADMIN_SECRET_KEY'):
        DATA.mkdir(parents=True, exist_ok=True)
        key = DATA / 'session.key'
        try:
            with key.open('x', encoding='utf-8') as output:
                output.write(secrets.token_hex(48))
        except FileExistsError:
            pass
        app.secret_key = key.read_text(encoding='utf-8')
    app.config.update(SESSION_COOKIE_HTTPONLY=True, SESSION_COOKIE_SAMESITE='Lax', SESSION_COOKIE_SECURE=os.environ.get('SESSION_COOKIE_SECURE', 'true').lower() != 'false')
    app.jinja_env.globals.update(owner_csrf=token, station_owner=account, station_deletion_requests=deletion_requests)

    @app.before_request
    def owner_guards():
        mutation = request.method == 'POST' and (request.path.startswith('/owner/') or request.path.startswith('/admin/') or request.path == '/api/add-station')
        if mutation:
            db = connect()
            db.execute('BEGIN IMMEDIATE')
            g.owner_write_db = db
        if request.path == '/api/add-station' and request.method == 'POST':
            if not account():
                if request.is_json or request.headers.get('X-Requested-With') == 'fetch':
                    return jsonify(status='error', message='Please sign in to your station owner account before submitting.', login_url=url_for('owner_login')), 401
                return redirect(url_for('owner_login'))
            check_token()

    @app.after_request
    def commit_owner_write(response):
        db = getattr(g, 'owner_write_db', None)
        if db:
            db.commit() if response.status_code < 400 else db.rollback()
        if request.path.startswith('/owner/'):
            response.headers['Cache-Control'] = 'private, no-store'
        return response

    @app.teardown_request
    def close_owner_write(error):
        db = g.pop('owner_write_db', None)
        if db:
            if error:
                db.rollback()
            db.close()

    @app.route('/owner/register', methods=['GET', 'POST'])
    def owner_register():
        error = ''
        if request.method == 'POST':
            check_token()
            email = request.form.get('email', '').strip().casefold()
            password = request.form.get('password', '')
            if not radio.is_valid_email(email) or len(email) > 254 or not 12 <= len(password) <= 128:
                error = 'Enter a valid email and a password between 12 and 128 characters.'
            else:
                try:
                    with database() as db:
                        id = secrets.token_hex(16)
                        db.execute('INSERT INTO accounts VALUES (?,?,?)', (id, email, generate_password_hash(password)))
                    session.clear()
                    session['owner_id'] = id
                    return redirect(url_for('owner_dashboard'))
                except sqlite3.IntegrityError:
                    error = 'An account already exists for this email. Sign in instead.'
        return render_template('owner_auth.html', register=True, error=error)

    @app.route('/owner/login', methods=['GET', 'POST'])
    def owner_login():
        error = ''
        if request.method == 'POST':
            check_token()
            email = request.form.get('email', '').strip().casefold()
            password = request.form.get('password', '')
            with database() as db:
                key = email + '|' + (request.remote_addr or '')
                attempt = db.execute('SELECT * FROM login_attempts WHERE key=?', (key,)).fetchone()
                now = int(time.time())
                if attempt and attempt['until'] > now and attempt['count'] >= 5:
                    error = 'Too many attempts. Try again in 15 minutes.'
                else:
                    row = db.execute('SELECT * FROM accounts WHERE email=?', (email,)).fetchone()
                    if row and len(password) <= 128 and check_password_hash(row['password'], password):
                        db.execute('DELETE FROM login_attempts WHERE key=?', (key,))
                        session.clear()
                        session['owner_id'] = row['id']
                        return redirect(url_for('owner_dashboard'))
                    count = attempt['count'] + 1 if attempt and attempt['until'] > now else 1
                    db.execute('INSERT OR REPLACE INTO login_attempts VALUES (?,?,?)', (key, count, now + 900))
                    error = 'Invalid email or password.'
        return render_template('owner_auth.html', register=False, error=error)

    @app.route('/owner/logout', methods=['POST'])
    def owner_logout():
        check_token()
        session.pop('owner_id', None)
        return redirect(url_for('owner_login'))

    @app.route('/owner')
    def owner_dashboard():
        if not account():
            return redirect(url_for('owner_login'))
        owner = require_owner()
        store = radio.load_station_store()
        with database() as db:
            codes = {r['code'] for r in db.execute('SELECT code FROM station_ownership WHERE owner_id=?', (owner['id'],))}
            requests = [dict(r) for r in db.execute('SELECT * FROM deletion_requests WHERE owner_id=? ORDER BY created DESC', (owner['id'],))]
        rows = [dict(s, approval='Pending review' if group == 'pending_stations' else 'Approved') for group, s in all_station_rows(store) if s.get('owner_id') == owner['id'] and s.get('station_code') in codes]
        return render_template('owner_dashboard.html', owner=owner, stations=rows, deletion_history=requests)

    @app.route('/owner/station/<code>', methods=['GET', 'POST'])
    def owner_station(code):
        store = radio.load_station_store()
        group, station = owned_station(store, code)
        error = ''
        if request.method == 'POST':
            check_token()
            name = request.form.get('name', '').strip()
            url = request.form.get('url', '').strip()
            language = request.form.get('language', 'ht')
            if not name or len(name) > 120 or len(url) > 2000 or radio.urlparse(url).scheme not in ('http', 'https') or not radio.urlparse(url).hostname or language not in ('en', 'es', 'fr', 'ht'):
                error = 'Enter a station name, a valid HTTP/HTTPS stream URL and a supported language.'
            elif any(s.get('url') == url and s.get('station_code') != code for _, s in all_station_rows(store)):
                error = 'This stream URL is already assigned to another station.'
            else:
                logo, logo_error = radio.save_uploaded_image('logo_image')
                if logo_error:
                    return render_template('owner_edit.html', station=station, error=logo_error), 400
                if logo:
                    station['logo_url'] = logo
                station.update(name=name, url=url, subtitle=request.form.get('subtitle', '')[:300], website=request.form.get('subtitle', '')[:300], bio=request.form.get('bio', '')[:250], language=language,
                               flag={'en':'🇺🇸','es':'🇪🇸','fr':'🇫🇷','ht':'🇭🇹'}[language])
                radio.save_station_store(store)
                return redirect(url_for('owner_dashboard'))
        return render_template('owner_edit.html', station=station, error=error)

    @app.route('/owner/station/<code>/<action>', methods=['POST'])
    def owner_station_action(code, action):
        check_token()
        store = radio.load_station_store()
        group, station = owned_station(store, code)
        if action in ('suspend', 'reactivate'):
            station['owner_suspended'] = action == 'suspend'
            radio.save_station_store(store)
        elif action == 'request-deletion':
            with database() as db:
                db.execute('INSERT OR IGNORE INTO deletion_requests VALUES (?,?,?,?,?,?,?)',
                    (secrets.token_hex(16), code, require_owner()['id'], station['name'], request.form.get('reason', '').strip()[:500], 'pending', int(time.time())))
        else:
            abort(404)
        return redirect(url_for('owner_dashboard'))

    @app.route('/admin/station-deletion/<id>/<decision>', methods=['POST'])
    def admin_station_deletion(id, decision):
        if not session.get('admin_logged_in'):
            abort(403)
        check_token()
        if decision not in ('approve', 'deny'):
            abort(404)
        with database() as db:
            row = db.execute("SELECT * FROM deletion_requests WHERE id=? AND status='pending'", (id,)).fetchone()
            if not row:
                abort(404)
            if decision == 'approve':
                store = radio.load_station_store()
                for group in ('pending_stations', 'custom_stations'):
                    store[group] = [s for s in store.get(group, []) if not (s.get('station_code') == row['code'] and s.get('owner_id') == row['owner_id'])]
                radio.save_station_store(store)
            db.execute('UPDATE deletion_requests SET status=? WHERE id=?', ('approved' if decision == 'approve' else 'denied', id))
        return redirect(url_for('admin_pending'))

    @app.route('/admin/assign-station/<int:index>', methods=['POST'])
    def assign_station_owner(index):
        if not session.get('admin_logged_in'):
            abort(403)
        check_token()
        email = request.form.get('email', '').strip().casefold()
        with database() as db:
            owner = db.execute('SELECT id,email FROM accounts WHERE email=?', (email,)).fetchone()
            if not owner:
                abort(400, 'The owner must register an account first.')
            store = radio.load_station_store()
            if not 0 <= index < len(store.get('custom_stations', [])):
                abort(404)
            station = store['custom_stations'][index]
            code = station.get('station_code') or 'ST-' + secrets.token_hex(8).upper()
            db.execute('INSERT OR REPLACE INTO station_ownership VALUES (?,?)', (code, owner['id']))
            station.update(station_code=code, owner_id=owner['id'], contact_email=owner['email'])
            radio.save_station_store(store)
        return redirect(url_for('admin_pending'))
