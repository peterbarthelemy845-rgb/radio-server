import secrets
import time
from datetime import date, datetime, timezone
from flask import request, jsonify, redirect, url_for, abort, current_app
from itsdangerous import URLSafeTimedSerializer, BadSignature
import ads
import ad_submissions as submissions

def today():
    return datetime.now(timezone.utc).date().isoformat()

def prepare(db):
    db.execute('CREATE TABLE IF NOT EXISTS campaigns (id TEXT PRIMARY KEY, title TEXT, src TEXT UNIQUE, kind TEXT, duration INTEGER, enabled INTEGER, start TEXT DEFAULT "", end TEXT DEFAULT "", plays INTEGER DEFAULT 0, last_served INTEGER DEFAULT 0)')
    db.execute('CREATE TABLE IF NOT EXISTS ad_receipts (id TEXT PRIMARY KEY, created INTEGER)')
    db.execute('CREATE TABLE IF NOT EXISTS ad_migrations (name TEXT PRIMARY KEY)')
    if not db.execute("SELECT 1 FROM ad_migrations WHERE name='rotation'").fetchone():
        current = ads.load_ad()
        for row in db.execute("SELECT * FROM submissions WHERE status='approved'").fetchall():
            src = '/static/ads/' + row['filename']
            insert(db, row['id'], row['title'], src, row['kind'], row['duration'], current.get('src') == src)
        if current.get('src'):
            insert(db, 'legacy', current.get('title') or 'Admin-uploaded ad', current['src'], current.get('kind', 'image'), current.get('duration', 10), True)
        db.execute("INSERT INTO ad_migrations VALUES ('rotation')")

def insert(db, id, title, src, kind, duration, enabled=True):
    db.execute('INSERT OR IGNORE INTO campaigns (id,title,src,kind,duration,enabled) VALUES (?,?,?,?,?,?)',
               (id, title, src, kind, duration, int(enabled)))

def campaigns():
    with submissions.database() as db:
        prepare(db)
        rows = [dict(row) for row in db.execute('SELECT c.*, s.email FROM campaigns c LEFT JOIN submissions s ON s.id=c.id ORDER BY c.rowid DESC')]
    global_enabled = ads.load_ad().get('enabled', False)
    for row in rows:
        row['active'] = bool(global_enabled and row['enabled'] and (not row['start'] or row['start'] <= today()) and (not row['end'] or row['end'] >= today()))
    return rows

def signer():
    return URLSafeTimedSerializer(current_app.secret_key, salt='ad-play')

def register_rotation(app):
    @app.route('/api/ad-next', methods=['POST'])
    def next_ad():
        settings = ads.load_ad()
        if not settings.get('enabled'):
            return jsonify(ad=None)
        with submissions.database() as db:
            db.execute('BEGIN IMMEDIATE')
            prepare(db)
            row = db.execute('SELECT * FROM campaigns WHERE enabled=1 AND (start="" OR start<=?) AND (end="" OR end>=?) ORDER BY last_served, rowid LIMIT 1', (today(), today())).fetchone()
            if row is None:
                return jsonify(ad=None)
            db.execute('UPDATE campaigns SET last_served=? WHERE id=?', (time.time_ns(), row['id']))
            ad = {key: row[key] for key in ('title', 'src', 'kind', 'duration')}
            ad.update(skip=settings.get('skip', True), frequency=settings.get('frequency', 'visit'), token=signer().dumps({'id': row['id'], 'nonce': secrets.token_hex(16)}))
        response = jsonify(ad=ad)
        response.headers['Cache-Control'] = 'no-store'
        return response

    @app.route('/api/ad-play', methods=['POST'])
    def ad_play():
        try:
            payload = signer().loads((request.get_json(silent=True) or {}).get('token', ''), max_age=600)
        except (BadSignature, TypeError):
            abort(400)
        with submissions.database() as db:
            prepare(db)
            db.execute('DELETE FROM ad_receipts WHERE created<?', (int(time.time())-1200,))
            inserted = db.execute('INSERT OR IGNORE INTO ad_receipts VALUES (?,?)', (payload['nonce'], int(time.time()))).rowcount
            if inserted:
                db.execute('UPDATE campaigns SET plays=plays+1 WHERE id=?', (payload['id'],))
        return jsonify(ok=True)

    @app.route('/admin/ads/campaign/<campaign_id>', methods=['POST'])
    def update_campaign(campaign_id):
        submissions.check_csrf()
        start, end = request.form.get('start', ''), request.form.get('end', '')
        try:
            for value in (start, end):
                if value and date.fromisoformat(value).isoformat() != value:
                    raise ValueError()
            if start and end and start > end:
                raise ValueError()
        except ValueError:
            return redirect(url_for('admin_pending', ad_error='dates', _anchor='approved-ads'))
        with submissions.database() as db:
            prepare(db)
            changed = db.execute('UPDATE campaigns SET enabled=?, start=?, end=? WHERE id=?',
                (int(request.form.get('enabled') == 'on'), start, end, campaign_id)).rowcount
            if not changed:
                abort(404)
        return redirect(url_for('admin_pending', _anchor='approved-ads'))
