import json
import os
import re
import secrets
import shutil
import sqlite3
import time
from contextlib import contextmanager
from pathlib import Path
from flask import abort, redirect, render_template, request, send_file, session, url_for
import ads

PRIVATE = Path(__file__).resolve().parent / 'ad_submissions'
DATABASE = PRIVATE / 'submissions.sqlite3'

@contextmanager
def database():
    PRIVATE.mkdir(parents=True, exist_ok=True)
    connection = sqlite3.connect(DATABASE)
    connection.row_factory = sqlite3.Row
    try:
        connection.execute('CREATE TABLE IF NOT EXISTS submissions (id TEXT PRIMARY KEY, title TEXT, contact_name TEXT, email TEXT, phone TEXT, notes TEXT, filename TEXT, kind TEXT, duration INTEGER, created INTEGER, status TEXT)')
        yield connection
        connection.commit()
    finally:
        connection.close()

def pending_ads():
    with database() as connection:
        return [dict(row) for row in connection.execute("SELECT * FROM submissions WHERE status='pending' ORDER BY created")]

def csrf_token():
    if 'ad_csrf' not in session:
        session['ad_csrf'] = secrets.token_hex(24)
    return session['ad_csrf']

def check_csrf():
    token = session.get('ad_csrf', '')
    if not token or not secrets.compare_digest(token, request.form.get('csrf_token', '')):
        abort(400, 'This form expired. Reload the page and try again.')

def register_submissions(app):
    app.jinja_env.globals['ad_csrf_token'] = csrf_token

    @app.route('/account')
    def account_options():
        return render_template('account_options.html')

    @app.route('/ads/submit', methods=['GET', 'POST'])
    def submit_ad():
        error = ''
        form = request.form if request.method == 'POST' else {}
        if request.method == 'POST':
            check_csrf()
            filename = None
            try:
                title = form.get('title', '').strip()
                name = form.get('contact_name', '').strip()
                email = form.get('email', '').strip()
                phone = form.get('phone', '').strip()
                notes = form.get('notes', '').strip()
                if not title or len(title) > 100 or not name or len(name) > 100:
                    raise ValueError('Enter a business/ad title and your name (up to 100 characters each).')
                if len(email) > 254 or not re.fullmatch(r'[^\s@]+@[^\s@]+\.[^\s@]+', email):
                    raise ValueError('Enter a valid contact email.')
                if len(phone) > 40 or len(notes) > 1000:
                    raise ValueError('Phone must be under 40 characters and notes under 1,000 characters.')
                if form.get('consent') != 'on':
                    raise ValueError('Confirm that you have permission to use the uploaded content.')
                try:
                    duration = int(form.get('duration', '10'))
                except ValueError:
                    raise ValueError('Enter a display time between 5 and 120 seconds.')
                if not 5 <= duration <= 120:
                    raise ValueError('Enter a display time between 5 and 120 seconds.')
                upload = request.files.get('media')
                if not upload or not upload.filename:
                    raise ValueError('Choose a video or flyer to submit.')
                filename, kind = ads.save_ad_upload(upload, PRIVATE)
                with database() as connection:
                    connection.execute('INSERT INTO submissions VALUES (?,?,?,?,?,?,?,?,?,?,?)',
                        (secrets.token_hex(16), title, name, email, phone, notes, filename, kind, duration, int(time.time()), 'pending'))
                session['ad_submitted'] = True
                return redirect(url_for('submit_ad', embedded='1') if request.args.get('embedded') == '1' else url_for('submit_ad'))
            except (ValueError, OSError, sqlite3.Error) as exc:
                if filename:
                    (PRIVATE / filename).unlink(missing_ok=True)
                error = str(exc) if isinstance(exc, ValueError) else 'Your ad could not be saved. Please try again.'
        return render_template('submit_ad.html', form=form, error=error, submitted=session.pop('ad_submitted', False))

    @app.route('/admin/ads/submissions/<submission_id>/media')
    def submitted_ad_media(submission_id):
        with database() as connection:
            row = connection.execute('SELECT * FROM submissions WHERE id=?', (submission_id,)).fetchone()
        if not row:
            abort(404)
        response = send_file(PRIVATE / row['filename'], conditional=True)
        response.headers['Cache-Control'] = 'private, no-store'
        return response

    @app.route('/admin/ads/submissions/<submission_id>/<action>', methods=['POST'])
    def moderate_ad(submission_id, action):
        check_csrf()
        if action not in ('approve', 'reject'):
            abort(404)
        with database() as connection:
            connection.execute('BEGIN IMMEDIATE')
            row = connection.execute("SELECT * FROM submissions WHERE id=? AND status='pending'", (submission_id,)).fetchone()
            if not row:
                abort(404)
            if action == 'approve':
                ads.MEDIA.mkdir(parents=True, exist_ok=True)
                shutil.copyfile(PRIVATE / row['filename'], ads.MEDIA / row['filename'])
                ad = ads.load_ad()
                ad.update(title=row['title'], src='/static/ads/' + row['filename'], kind=row['kind'],
                          duration=row['duration'], enabled=True, frequency=ad.get('frequency', 'visit'), skip=ad.get('skip', True))
                temporary = ads.SETTINGS.with_suffix('.tmp')
                temporary.write_text(json.dumps(ad), encoding='utf-8')
                os.replace(temporary, ads.SETTINGS)
            connection.execute('UPDATE submissions SET status=? WHERE id=?', ('approved' if action == 'approve' else 'rejected', submission_id))
        return redirect(url_for('admin_ads', reviewed=action))
