"""Station-scoped local sponsors. Free pilot; no payments or browser ad networks."""
import hashlib
import io
import json
import re
import secrets
import sqlite3
import struct
import time
import warnings
import unicodedata
from datetime import date, datetime, time as day_time, timedelta
from pathlib import Path
from zoneinfo import ZoneInfo
from flask import abort, current_app, g, jsonify, redirect, render_template, request, send_file, session
from itsdangerous import URLSafeTimedSerializer, BadSignature, SignatureExpired
from PIL import Image, ImageOps

AD_WIDTH, AD_HEIGHT = 256, 76
AD_POLICY = 'local-business-submissions-2026-11-01'


def schema(db):
    db.executescript('''
    CREATE TABLE IF NOT EXISTS local_ads (
      id TEXT PRIMARY KEY, station_key TEXT NOT NULL, brand TEXT NOT NULL,
      message TEXT NOT NULL, phone TEXT NOT NULL, image TEXT NOT NULL,
      start_at INTEGER NOT NULL, end_at INTEGER NOT NULL, start_date TEXT, end_date TEXT,
      review TEXT NOT NULL, reasons TEXT NOT NULL, enabled INTEGER DEFAULT 0,
      deleted INTEGER DEFAULT 0, revision INTEGER DEFAULT 1, displays INTEGER DEFAULT 0,
      created INTEGER NOT NULL, reviewed_at INTEGER DEFAULT 0, rights_version TEXT, rights_grant INTEGER);
    CREATE INDEX IF NOT EXISTS local_ads_station ON local_ads(station_key,created);
    CREATE TABLE IF NOT EXISTS local_ad_settings (id INTEGER PRIMARY KEY CHECK(id=1),enabled INTEGER NOT NULL);
    INSERT OR IGNORE INTO local_ad_settings VALUES (1,1);
    CREATE TABLE IF NOT EXISTS local_ad_devices (radio_id TEXT PRIMARY KEY,next_at INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS local_ad_receipts (
      id TEXT PRIMARY KEY,radio_id TEXT NOT NULL,ad_id TEXT NOT NULL,
      revision INTEGER NOT NULL,created INTEGER NOT NULL,expires INTEGER NOT NULL,
      displayed INTEGER DEFAULT 0);
    CREATE INDEX IF NOT EXISTS local_ad_receipt_device ON local_ad_receipts(radio_id,expires);
    ''')
    columns = {row[1] for row in db.execute('PRAGMA table_info(local_ads)')}
    for name in ('contact_name', 'contact_email'):
        if name not in columns:
            try:
                db.execute('ALTER TABLE local_ads ADD COLUMN '+name+" TEXT NOT NULL DEFAULT ''")
            except sqlite3.OperationalError:
                if name not in {row[1] for row in db.execute('PRAGMA table_info(local_ads)')}:
                    raise
    db.commit()


def schedule(start, end):
    zone = ZoneInfo('America/New_York')
    today = datetime.now(zone).date()
    try:
        first = date.fromisoformat(start) if start else today
        last = date.fromisoformat(end) if end else first + timedelta(days=29)
        if not first <= last <= first + timedelta(days=365):
            raise ValueError()
    except (ValueError, TypeError):
        raise ValueError('Choose valid start/end dates, no more than one year apart.')
    return (int(datetime.combine(first, day_time(), zone).timestamp()),
            int(datetime.combine(last + timedelta(days=1), day_time(), zone).timestamp()),
            first.isoformat(), last.isoformat())


def revision(row):
    return hashlib.sha256((row['id'] + ':' + str(row['revision'])).encode()).hexdigest()


def pixels(path):
    with Image.open(path) as source:
        image = source.convert('RGB').resize((AD_WIDTH, AD_HEIGHT), Image.Resampling.LANCZOS)
    return b''.join(struct.pack('<H', ((r >> 3) << 11) | ((g >> 2) << 5) | (b >> 3))
                    for r, g, b in image.getdata())


def normalized_ad(raw, filename):
    """Only decoded pixels survive; original files and metadata are never served."""
    extensions = {'PNG': {'.png'}, 'JPEG': {'.jpg', '.jpeg'}, 'WEBP': {'.webp'}}
    if not raw or len(raw) > 3*1024*1024:
        raise ValueError('Choose an image under 3 MB.')
    try:
        with warnings.catch_warnings():
            warnings.simplefilter('error', Image.DecompressionBombWarning)
            with Image.open(io.BytesIO(raw)) as probe:
                if (probe.format not in extensions or Path(filename).suffix.lower() not in extensions[probe.format]
                        or probe.width*probe.height > 4_000_000 or getattr(probe, 'n_frames', 1) != 1):
                    raise ValueError()
                probe.verify()
            with Image.open(io.BytesIO(raw)) as source:
                source.load()
                scaled = ImageOps.pad(ImageOps.exif_transpose(source).convert('RGB'), (768, 228),
                                      color=(8, 12, 40), method=Image.Resampling.LANCZOS)
                clean = Image.new('RGB', scaled.size)
                clean.paste(scaled)
                return clean
    except Exception:
        raise ValueError('Use a valid, still JPG, PNG or WebP with a matching file extension, up to 4 megapixels.')


def register_station_ads(app, radio):
    from station_owners import database, check_token
    from station_directory import key_for
    from station_editing import find_station
    from admin_security import valid_session

    def primary(with_code=True):
        station = dict(radio.TEST_STREAMS[0], name='La Voix Divine', url=radio.MAIN_STREAM_URL)
        if with_code:
            from station_directory import ensure_code
            with database() as db:
                ensure_code(db, station)
        return station

    def ad_base():
        return '/admin/local-ads/main' if request.path.startswith('/admin/local-ads/main') else '/station/ads'

    def db_rows(key=None):
        with database() as db:
            rows = db.execute('SELECT * FROM local_ads WHERE deleted=0' +
                              (' AND station_key=?' if key else '') + ' ORDER BY created DESC LIMIT 100',
                              (key,) if key else ()).fetchall()
            enabled = bool(db.execute('SELECT enabled FROM local_ad_settings WHERE id=1').fetchone()[0])
        return [dict(row) for row in rows], enabled

    def owner():
        if request.path.startswith('/advertise/'):
            code = request.view_args.get('code', '')
            if not re.fullmatch(r'[0-9]{2,6}', code):
                abort(404)
            station = next((s for s in radio.load_station_store().get('custom_stations', [])
                            if s.get('listener_code') == code and published(key_for(s))), None)
            if not station:
                main = primary()
                station = main if main['listener_code'] == code else None
            if not station:
                abort(404)
            return station, True
        if request.path.startswith('/admin/local-ads/main'):
            administrator()
            return primary(), True
        with database() as db:
            row = db.execute('SELECT * FROM station_edit_links WHERE id=? AND used=1 AND expires>?',
                             (session.get('station_edit_id', -1), int(time.time()))).fetchone()
        if not row:
            abort(401, 'Sign in to your station again to manage ads.')
        store, station = find_station(radio, row['station_key'], row['email'])
        if not station:
            abort(403)
        return station, station in store.get('custom_stations', [])

    def published(key):
        main = primary(False)
        if key_for(main) == key:
            return main
        return next((s for s in app.extensions['station_store_read_only']().get('custom_stations', [])
                     if key_for(s) == key and not s.get('suspended') and not s.get('owner_suspended')), None)

    def eligible(row):
        now = int(time.time())
        return (not row['deleted'] and row['enabled'] and row['review'] == 'approved'
                and row['start_at'] <= now < row['end_at'] and published(row['station_key']))

    def administrator():
        if not valid_session(session) or session.get('admin_role') != 'full':
            abort(403)

    def limit(scope, count, seconds, identity):
        app.extensions['security_limit'](scope, count, seconds, identity)

    def asset(row):
        if not re.fullmatch(r'ad_[0-9a-f]{32}\.png', row['image']):
            abort(404)
        return Path(radio.UPLOAD_FOLDER) / row['image']

    def owned_ad(identifier, key):
        with database() as db:
            row = db.execute('SELECT * FROM local_ads WHERE id=? AND station_key=? AND deleted=0',
                             (identifier, key)).fetchone()
        if not row:
            abort(404)
        return dict(row)

    def device():
        if request.content_length and request.content_length > 2048:
            abort(413)
        data = request.get_json(silent=True)
        if not isinstance(data, dict):
            abort(400)
        import radio_link
        with radio_link.database() as db:
            identifier = app.extensions['radio_authenticate'](db, data)
        return data, identifier

    def lcd_text(text):
        return unicodedata.normalize('NFKD', text).encode('ascii', 'ignore').decode()

    def signer():
        return URLSafeTimedSerializer(app.secret_key, salt='radio-local-ad-v1')

    @app.after_request
    def local_ad_privacy(response):
        cleanup = g.pop('local_ad_cleanup', None)
        if cleanup and response.status_code < 400:
            try:
                cleanup.unlink(missing_ok=True)
            except OSError:
                app.logger.warning('Deleted ad artwork cleanup failed; private file retained.')
        if request.path.startswith(('/station/ads', '/admin/local-ads', '/api/radio/ad', '/advertise/')):
            response.headers['Cache-Control'] = 'private, no-store'
            response.headers['Referrer-Policy'] = 'no-referrer'
        return response
    app.after_request_funcs[None].remove(local_ad_privacy)
    app.after_request_funcs[None].insert(0, local_ad_privacy)

    @app.route('/station/ads', methods=['GET'])
    @app.route('/admin/local-ads/main', methods=['GET'])
    @app.route('/advertise/<code>', methods=['GET', 'POST'])
    def station_ad_dashboard(code=None):
        station, is_published = owner()
        submitting = code is not None
        error = ''
        if request.method == 'POST':
            check_token()
            limit('local-ad-public-ip', 5, 3600, request.remote_addr or 'unknown')
            limit('local-ad-create', 10, 3600, key_for(station))
            limit('local-ad-create-total', 100, 3600, 'all')
            path = None
            try:
                brand = request.form.get('brand', '').strip()
                message = request.form.get('message', '').strip()
                phone = request.form.get('phone', '').strip()
                contact_name = request.form.get('contact_name', '').strip()
                contact_email = request.form.get('contact_email', '').strip().casefold()
                if not 1 <= len(contact_name) <= 80 or len(contact_email) > 254 or not re.fullmatch(r'[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+', contact_email):
                    raise ValueError('Enter your contact name and a valid business email.')
                if any(ord(c) < 32 for c in contact_name+contact_email):
                    raise ValueError('Use plain text for contact details.')
                if not 1 <= len(brand) <= 32 or not 1 <= len(message) <= 42 or len(phone) > 32:
                    raise ValueError('Use a business name up to 32 characters, a message up to 42, and a phone up to 32.')
                if any(ord(c) < 32 for c in brand + message + phone):
                    raise ValueError('Use plain text without line breaks.')
                if request.form.get('rights') != 'on':
                    raise ValueError('Confirm you have permission to run this advertisement.')
                start_at, end_at, first, last = schedule(request.form.get('start_date'), request.form.get('end_date'))
                rows, _ = db_rows(key_for(station))
                with database() as db:
                    global_count = db.execute('SELECT COUNT(*) FROM local_ads WHERE deleted=0').fetchone()[0]
                if len(rows) >= 20 or global_count >= 4000:
                    raise ValueError('Ad storage limit reached. Contact the administrator.')
                if sum(p.stat().st_size for p in Path(radio.UPLOAD_FOLDER).glob('*') if p.is_file()) > 768*1024*1024:
                    raise ValueError('Upload storage is full. Contact the administrator.')
                upload = request.files.get('image')
                if not upload or not upload.filename:
                    raise ValueError('Choose a JPG, PNG or WebP sponsor image.')
                raw = upload.stream.read(3*1024*1024 + 1)
                image = normalized_ad(raw, upload.filename)
                filename = 'ad_' + secrets.token_hex(16) + '.png'
                path = Path(radio.UPLOAD_FOLDER) / filename
                image.save(path, format='PNG', optimize=True)
                from automatic_screening import assess
                result = assess(dict(name=brand, subtitle=message, bio=phone, url='',
                                     logo_url='/static/wallpapers/' + filename), radio.UPLOAD_FOLDER)
                # Revalidate the mailbox-scoped grant after an external screening request.
                latest, _ = owner()
                if key_for(latest) != key_for(station):
                    abort(409)
                with database() as db:
                    if not db.in_transaction:
                        db.execute('BEGIN IMMEDIATE')
                    if db.execute('SELECT COUNT(*) FROM local_ads WHERE station_key=? AND deleted=0',
                                  (key_for(station),)).fetchone()[0] >= 20:
                        raise ValueError('Your station already has twenty ads.')
                    if db.execute('SELECT COUNT(*) FROM local_ads WHERE deleted=0').fetchone()[0] >= 4000:
                        raise ValueError('Ad storage limit reached. Contact the administrator.')
                    db.execute('INSERT INTO local_ads (id,station_key,brand,message,phone,image,start_at,end_at,start_date,end_date,review,reasons,created,rights_version,rights_grant,contact_name,contact_email) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
                               (secrets.token_hex(16), key_for(station), brand, message, phone, filename,
                                start_at, end_at, first, last, 'approved' if result['status'] == 'passed' else 'review',
                                json.dumps(result['reasons']), int(time.time()), AD_POLICY, None, contact_name, contact_email))
                return redirect('/advertise/'+code+'?saved=1')
            except ValueError as exc:
                error = str(exc)
                if path:
                    path.unlink(missing_ok=True)
            except Exception:
                if path:
                    path.unlink(missing_ok=True)
                raise
        if submitting:
            return render_template('station_ad_submit.html', station=station, error=error,
                                   saved=request.args.get('saved') == '1'), 400 if error else 200
        rows, enabled = db_rows(key_for(station))
        return render_template('station_ads.html', station=station, ads=rows, enabled=enabled,
                               published=is_published and bool(published(key_for(station))), error=error,
                               saved=request.args.get('saved') == '1', demo=False, now=int(time.time()),
                               campaign_base=ad_base(), admin_main=ad_base().startswith('/admin/')), 400 if error else 200

    @app.post('/station/ads/<identifier>/<action>')
    @app.post('/admin/local-ads/main/<identifier>/<action>')
    def station_ad_action(identifier, action):
        station, _ = owner()
        check_token()
        limit('local-ad-action', 60, 3600, key_for(station))
        row = owned_ad(identifier, key_for(station))
        if action not in ('approve', 'delete'):
            abort(404)
        if not secrets.compare_digest(request.form.get('revision', ''), revision(row)):
            abort(409, 'This ad changed. Reload and try again.')
        if action == 'approve' and (row['review'] != 'approved' or row['end_at'] <= int(time.time()) or not published(key_for(station))):
            abort(400, 'Your station and this ad must be approved before starting.')
        with database() as db:
            changed = db.execute('UPDATE local_ads SET enabled=?,deleted=?,revision=revision+1 WHERE id=? AND station_key=? AND revision=? AND deleted=0',
                                (int(action == 'approve'), int(action == 'delete'), identifier,
                                 key_for(station), row['revision'])).rowcount
            if not changed:
                abort(409)
        if action == 'delete':
            # Privacy hook runs after the owner's write transaction commits.
            g.local_ad_cleanup = asset(row)
        return redirect(ad_base())

    @app.get('/station/ads/<identifier>/image')
    @app.get('/admin/local-ads/main/<identifier>/image')
    def station_ad_image(identifier):
        station, _ = owner()
        return send_file(asset(owned_ad(identifier, key_for(station))), mimetype='image/png')

    @app.route('/admin/local-ads', methods=['GET', 'POST'])
    def admin_local_ads():
        administrator()
        if request.method == 'POST':
            check_token()
            with database() as db:
                db.execute('UPDATE local_ad_settings SET enabled=? WHERE id=1', (int(request.form.get('enabled') == 'on'),))
            return redirect('/admin/local-ads')
        rows, enabled = db_rows()
        names = {key_for(s):s.get('name', 'Station') for group in ('custom_stations', 'pending_stations')
                 for s in radio.load_station_store().get(group, [])}
        names[key_for(primary(False))] = 'La Voix Divine'
        for row in rows:
            row['station_name'] = names.get(row['station_key'], 'Removed station')
        return render_template('admin_local_ads.html', ads=rows, enabled=enabled)

    @app.get('/admin/local-ads/<identifier>/image')
    def admin_local_ad_image(identifier):
        administrator()
        with database() as db:
            row = db.execute('SELECT * FROM local_ads WHERE id=? AND deleted=0', (identifier,)).fetchone()
        if not row:
            abort(404)
        return send_file(asset(row), mimetype='image/png')

    @app.post('/admin/local-ads/<identifier>/<decision>')
    def review_local_ad(identifier, decision):
        administrator()
        check_token()
        if decision not in ('approve', 'reject', 'pause'):
            abort(404)
        with database() as db:
            row = db.execute('SELECT * FROM local_ads WHERE id=? AND deleted=0', (identifier,)).fetchone()
            if not row:
                abort(404)
            if not secrets.compare_digest(request.form.get('revision', ''), revision(row)):
                abort(409, 'This ad changed. Review it again.')
            db.execute('UPDATE local_ads SET review=?,enabled=0,revision=revision+1,reviewed_at=? WHERE id=?',
                       (row['review'] if decision == 'pause' else 'approved' if decision == 'approve' else 'rejected',
                        int(time.time()), identifier))
        return redirect('/admin/local-ads')

    @app.post('/api/radio/ad')
    def next_radio_ad():
        data, identifier = device()
        limit('local-ad-poll', 4, 60, identifier)
        code = data.get('station_code', '')
        station = next((s for s in radio.load_station_store().get('custom_stations', [])
                        if s.get('listener_code') == code and not s.get('suspended') and not s.get('owner_suspended')), None)
        if not station:
            main = primary()
            if main['listener_code'] == code:
                station = main
        if not station:
            return jsonify(ad=None)
        now = int(time.time())
        with database() as db:
            db.execute('BEGIN IMMEDIATE')
            db.execute('DELETE FROM local_ad_receipts WHERE created<?', (now-604800,))
            enabled = db.execute('SELECT enabled FROM local_ad_settings WHERE id=1').fetchone()[0]
            cooldown = db.execute('SELECT next_at FROM local_ad_devices WHERE radio_id=?', (identifier,)).fetchone()
            if not enabled or (cooldown and cooldown[0] > now):
                return jsonify(ad=None)
            row = db.execute("SELECT * FROM local_ads WHERE station_key=? AND review='approved' AND enabled=1 AND deleted=0 AND start_at<=? AND end_at>? ORDER BY displays,created LIMIT 1",
                             (key_for(station), now, now)).fetchone()
            if not row:
                return jsonify(ad=None)
            receipt = secrets.token_hex(16)
            db.execute('INSERT INTO local_ad_receipts VALUES (?,?,?,?,?,?,0)',
                       (receipt, identifier, row['id'], row['revision'], now, now+120))
            # A failed download may retry later, but cannot flood requests/receipts.
            db.execute('INSERT OR REPLACE INTO local_ad_devices VALUES (?,?)', (identifier, now+60))
        token = signer().dumps(dict(receipt=receipt, radio=identifier))
        return jsonify(ad=dict(id=row['id'], brand=lcd_text(row['brand']), message=lcd_text(row['message']), phone=lcd_text(row['phone']),
                               receipt=receipt, pixels_path='/api/radio/ad/pixels?token='+token,
                               width=AD_WIDTH, height=AD_HEIGHT, expires_in=60))

    @app.get('/api/radio/ad/pixels')
    def radio_ad_pixels():
        # GET still requires the private per-device credential; tokens alone are insufficient.
        import radio_link
        token = request.args.get('token', '')
        if len(token) > 600:
            abort(400)
        try:
            payload = signer().loads(token, max_age=120)
            identifier = payload['radio']
        except (BadSignature, SignatureExpired, KeyError, TypeError):
            abort(403)
        with radio_link.database() as db:
            app.extensions['radio_authenticate'](db, {'radio_id': identifier})
        limit('local-ad-pixels', 4, 60, identifier)
        with database() as db:
            row = db.execute('SELECT a.* FROM local_ads a JOIN local_ad_receipts r ON r.ad_id=a.id AND r.revision=a.revision WHERE r.id=? AND r.radio_id=? AND r.expires>? AND r.displayed=0',
                             (payload['receipt'], identifier, int(time.time()))).fetchone()
            enabled = db.execute('SELECT enabled FROM local_ad_settings WHERE id=1').fetchone()[0]
        if not enabled or not row or not eligible(row):
            abort(404)
        return current_app.response_class(pixels(asset(row)), mimetype='application/octet-stream')

    @app.post('/api/radio/ad/displayed')
    def radio_ad_displayed():
        data, identifier = device()
        limit('local-ad-displayed', 6, 60, identifier)
        receipt = data.get('receipt', '')
        if not isinstance(receipt, str) or not re.fullmatch('[0-9a-f]{32}', receipt):
            abort(400)
        with database() as db:
            db.execute('BEGIN IMMEDIATE')
            row = db.execute('SELECT a.*,r.displayed FROM local_ads a JOIN local_ad_receipts r ON r.ad_id=a.id AND r.revision=a.revision WHERE r.id=? AND r.radio_id=? AND r.expires>?',
                             (receipt, identifier, int(time.time()))).fetchone()
            if not row:
                abort(404)
            if not row['displayed']:
                if not eligible(row) or not db.execute('SELECT enabled FROM local_ad_settings WHERE id=1').fetchone()[0]:
                    abort(404)
                db.execute('UPDATE local_ad_receipts SET displayed=1 WHERE id=?', (receipt,))
                db.execute('UPDATE local_ads SET displays=displays+1 WHERE id=?', (row['id'],))
                db.execute('INSERT OR REPLACE INTO local_ad_devices VALUES (?,?)', (identifier, int(time.time())+1800))
        return jsonify(status='ok')

    @app.get('/local-ads-demo')
    def local_ads_demo():
        return render_template('station_ads.html', station=dict(name='Demo station', listener_code='Example'),
                               ads=[dict(id='demo', brand='Community Bakery', message='Fresh bread every morning',
                                         phone='Your business phone', review='approved', enabled=0,
                                         start_date='Example start', end_date='Example end', displays=0)],
                               enabled=True, published=True, error='', saved=False, demo=True, now=int(time.time()))

    app.jinja_env.globals['local_ad_revision'] = revision
