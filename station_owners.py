import os
import secrets
import sqlite3
import time
from pathlib import Path
from contextlib import contextmanager
from flask import request, session, g, abort, redirect, url_for, render_template, jsonify, flash, send_file
from werkzeug.security import generate_password_hash, check_password_hash

DATA = Path(__file__).resolve().parent / 'owner_data'
DATABASE = DATA / 'owners.sqlite3'

def connect():
    DATA.mkdir(parents=True, exist_ok=True)
    db = sqlite3.connect(DATABASE, timeout=15)
    db.row_factory = sqlite3.Row
    db.executescript('''
      CREATE TABLE IF NOT EXISTS accounts(id TEXT PRIMARY KEY,email TEXT UNIQUE NOT NULL,password TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS owner_access(owner_id TEXT PRIMARY KEY,hash TEXT NOT NULL,version TEXT NOT NULL);
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
        row = db.execute('SELECT a.id,a.email,c.version FROM accounts a JOIN owner_access c ON c.owner_id=a.id WHERE a.id=?', (session['owner_id'],)).fetchone()
        return dict(row) if row and session.get('owner_version') == row['version'] else None

def require_owner():
    owner = account()
    if not owner:
        abort(401)
    return owner

def attach_station(station):
    station.update(station_code='ST-' + secrets.token_hex(8).upper(), owner_id='', owner_suspended=False)
    return station

def provision_owner(station, rotate=False):
    email = (station.get('contact_email') or '').strip().casefold()
    if not email or '@' not in email:
        abort(400, 'A contact email is required before approving owner access.')
    with database() as db:
        owner = db.execute('SELECT id,email FROM accounts WHERE email=?', (email,)).fetchone()
        if not owner:
            owner = {'id': secrets.token_hex(16), 'email': email}
            db.execute('INSERT INTO accounts VALUES (?,?,?)', (owner['id'], email, generate_password_hash(secrets.token_hex(32))))
        credential = db.execute('SELECT * FROM owner_access WHERE owner_id=?', (owner['id'],)).fetchone()
        if rotate or not credential:
            access_code = 'OWN-' + secrets.token_hex(12).upper()
            db.execute('INSERT OR REPLACE INTO owner_access VALUES (?,?,?)', (owner['id'], generate_password_hash(access_code), secrets.token_hex(16)))
            flash('Owner login for ' + email + ': ' + access_code + '. Copy this access code and give it privately to the owner. It is shown once.', 'owner-access')
        else:
            flash('Station linked to ' + email + '. Their existing access code still works.', 'owner-access')
        code = station.get('station_code') or 'ST-' + secrets.token_hex(8).upper()
        db.execute('INSERT OR REPLACE INTO station_ownership VALUES (?,?)', (code, owner['id']))
        station.update(station_code=code, owner_id=owner['id'], contact_email=email)
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

def owner_ad_rows(owner):
    import ad_submissions
    import ad_rotation
    with ad_submissions.database() as db:
        rows = [dict(row) for row in db.execute('SELECT * FROM submissions WHERE lower(trim(email))=? ORDER BY created DESC', (owner['email'],))]
    campaigns = {row['id']: row for row in ad_rotation.campaigns()}
    for row in rows:
        campaign = campaigns.get(row['id'], {})
        row.update(plays=campaign.get('plays', 0), active=campaign.get('active', False), start=campaign.get('start', ''), end=campaign.get('end', ''))
    return rows

def owner_viewership(stations, analytics, radio):
    now = int(time.time())
    results = []
    for station in stations:
        url = station.get('url', '')
        events = [e for e in analytics.get('sessions', []) if e.get('url') == url]
        totals = [v for v in analytics.get('totals', {}).values() if v.get('url') == url]
        total = sum(max(0, int(v.get('seconds') or 0)) for v in totals)
        windows = []
        for days, label in [(1, 'Last 24 hours'), (7, 'Last 7 days'), (30, 'Last 30 days')]:
            selected = [e for e in events if now-days*86400 <= int(e.get('listened_at') or 0) <= now]
            duration = sum(max(0, int(e.get('seconds') or 0)) for e in selected)
            sessions = len({e['session_id'] for e in selected if e.get('session_id')})
            windows.append(dict(label=label, duration=radio.format_duration(duration), sessions=sessions))
        days = []
        for offset in range(6, -1, -1):
            start = (now//86400-offset)*86400
            seconds = sum(max(0, int(e.get('seconds') or 0)) for e in events if start <= int(e.get('listened_at') or 0) < start+86400)
            days.append(dict(label=time.strftime('%a', time.gmtime(start)), minutes=round(seconds/60, 1), seconds=seconds))
        peak = max([d['seconds'] for d in days] + [1])
        for day in days:
            day['height'] = round(day['seconds']/peak*100)
        results.append(dict(name=station['name'], total_seconds=total, duration=radio.format_duration(total), windows=windows, days=days))
    return results

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
            check_token()

    @app.after_request
    def commit_owner_write(response):
        db = getattr(g, 'owner_write_db', None)
        if db:
            db.commit() if response.status_code < 400 else db.rollback()
        if request.path.startswith(('/owner', '/admin/')):
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
        return redirect(url_for('owner_login'))

    @app.route('/owner/login', methods=['GET', 'POST'])
    def owner_login():
        error = ''
        if request.method == 'POST':
            check_token()
            email = request.form.get('email', '').strip().casefold()
            password = request.form.get('access_code', '').strip()
            with database() as db:
                key = email + '|' + (request.remote_addr or '')
                attempt = db.execute('SELECT * FROM login_attempts WHERE key=?', (key,)).fetchone()
                now = int(time.time())
                if attempt and attempt['until'] > now and attempt['count'] >= 5:
                    error = 'Too many attempts. Try again in 15 minutes.'
                else:
                    row = db.execute('SELECT a.id,c.hash,c.version FROM accounts a JOIN owner_access c ON c.owner_id=a.id WHERE a.email=?', (email,)).fetchone()
                    if row and len(password) <= 128 and check_password_hash(row['hash'], password):
                        db.execute('DELETE FROM login_attempts WHERE key=?', (key,))
                        session.clear()
                        session['owner_id'] = row['id']
                        session['owner_version'] = row['version']
                        return redirect(url_for('owner_dashboard'))
                    count = attempt['count'] + 1 if attempt and attempt['until'] > now else 1
                    db.execute('INSERT OR REPLACE INTO login_attempts VALUES (?,?,?)', (key, count, now + 900))
                    error = 'Invalid email or access code.'
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
        stats = owner_viewership(rows, radio.load_analytics(), radio)
        uploaded_ads = owner_ad_rows(owner)
        return render_template('owner_dashboard.html', owner=owner, stations=rows, deletion_history=requests, viewership=stats, uploaded_ads=uploaded_ads, total_duration=radio.format_duration(sum(s['total_seconds'] for s in stats)), daily_sessions=sum(s['windows'][0]['sessions'] for s in stats))

    @app.route('/owner/ad/<id>/media')
    def owner_ad_media(id):
        owner = require_owner()
        import ad_submissions
        with ad_submissions.database() as db:
            row = db.execute('SELECT filename FROM submissions WHERE id=? AND lower(trim(email))=?', (id, owner['email'])).fetchone()
        if not row:
            abort(404)
        path = (ad_submissions.PRIVATE / row['filename']).resolve()
        if ad_submissions.PRIVATE.resolve() not in path.parents or not path.is_file():
            abort(404)
        response = send_file(path, conditional=True)
        response.headers['Cache-Control'] = 'private, no-store'
        return response

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
        store = radio.load_station_store()
        if not 0 <= index < len(store.get('custom_stations', [])):
            abort(404)
        provision_owner(store['custom_stations'][index], rotate=True)
        radio.save_station_store(store)
        return redirect(url_for('admin_pending'))
