"""Passcode-gated radio tutorials; editing requires the existing full admin login."""
import os
import re
import time
from urllib.parse import urlsplit, parse_qs
from flask import abort, request, session, render_template, redirect
from werkzeug.security import check_password_hash

DEFAULT_PASSCODE_HASH = 'scrypt:32768:8:1$QeLrYpZtAwi2YxQT$a64594528a4d5c2c804b6b346c42f61caa0f1d8b0d517ed9dfdd2e15d50d266e148486ba05598d4bd07cb0f1c35fa71f06f7fcac0e9b7d0fb124cd3e4d722ddd'
TOPICS = [('setup', 'Getting started'), ('wifi', 'Connect to Wi-Fi'),
          ('stations', 'Add a station'), ('troubleshooting', 'Troubleshooting')]

def schema(db):
    db.execute('''CREATE TABLE IF NOT EXISTS device_help_videos (
      id INTEGER PRIMARY KEY, topic TEXT NOT NULL, title TEXT NOT NULL,
      description TEXT NOT NULL, video_id TEXT NOT NULL, created INTEGER NOT NULL)''')
    db.commit()

def youtube_id(url):
    try:
        parsed = urlsplit(url)
        if parsed.scheme != 'https' or parsed.username or parsed.password or parsed.port:
            return None
        host = parsed.hostname
        if host == 'youtu.be':
            identifier = parsed.path.removeprefix('/')
        elif host in ('youtube.com', 'www.youtube.com') and parsed.path == '/watch':
            identifier = parse_qs(parsed.query).get('v', [''])[0]
        else:
            return None
        return identifier if re.fullmatch(r'[A-Za-z0-9_-]{11}', identifier) else None
    except (ValueError, TypeError):
        return None

def register_device_help(app):
    from station_owners import database, check_token
    from admin_security import valid_session

    def admin():
        if not valid_session(session) or session.get('admin_role') != 'full':
            abort(403)

    def rows():
        with database() as db:
            return [dict(row) for row in db.execute('SELECT * FROM device_help_videos ORDER BY id')]

    @app.after_request
    def private_help(response):
        if request.path.startswith(('/device', '/admin/device-videos')):
            response.headers['Cache-Control'] = 'private, no-store'
            response.headers['X-Robots-Tag'] = 'noindex, nofollow'
            response.headers['Referrer-Policy'] = 'no-referrer'
            response.headers['Content-Security-Policy'] = response.headers.get('Content-Security-Policy', '') + "; frame-src https://www.youtube-nocookie.com"
        return response
    # Run after the central security headers, which are installed earlier.
    app.after_request_funcs[None].remove(private_help)
    app.after_request_funcs[None].insert(0, private_help)

    @app.route('/device', methods=['GET', 'POST'])
    def device_help():
        now = int(time.time())
        error = ''
        if request.method == 'POST':
            check_token()
            app.extensions['security_limit']('device-passcode', 5, 900, request.remote_addr or 'unknown')
            app.extensions['security_limit']('device-passcode-total', 100, 3600, 'all')
            code = request.form.get('passcode', '')
            if len(code) <= 64 and check_password_hash(os.environ.get('DEVICE_HELP_PASSCODE_HASH') or DEFAULT_PASSCODE_HASH, code):
                session['device_help_until'] = now + 28800
                return redirect('/device')
            error = 'Incorrect passcode. Please try again.'
        unlocked = session.get('device_help_until', 0) > now
        if not unlocked:
            session.pop('device_help_until', None)
        return render_template('device_help.html', unlocked=unlocked, error=error,
                               videos=rows() if unlocked else [], topics=TOPICS), 400 if error else 200

    @app.post('/device/lock')
    def lock_device_help():
        check_token()
        session.pop('device_help_until', None)
        return redirect('/device')

    @app.route('/admin/device-videos', methods=['GET', 'POST'])
    def device_videos_admin():
        admin()
        error = ''
        if request.method == 'POST':
            check_token()
            title = request.form.get('title', '').strip()
            description = request.form.get('description', '').strip()
            topic = request.form.get('topic', '')
            identifier = youtube_id(request.form.get('url', '').strip())
            if not 1 <= len(title) <= 100 or len(description) > 500 or topic not in dict(TOPICS) or not identifier:
                error = 'Enter a title, topic and valid HTTPS YouTube video link.'
            else:
                with database() as db:
                    if db.execute('SELECT COUNT(*) FROM device_help_videos').fetchone()[0] >= 50:
                        abort(400, 'The video limit is 50.')
                    db.execute('INSERT INTO device_help_videos(topic,title,description,video_id,created) VALUES (?,?,?,?,?)',
                               (topic, title, description, identifier, int(time.time())))
                return redirect('/admin/device-videos')
        return render_template('device_videos_admin.html', videos=rows(), topics=TOPICS, error=error), 400 if error else 200

    @app.post('/admin/device-videos/<int:identifier>/delete')
    def delete_device_video(identifier):
        admin()
        check_token()
        with database() as db:
            db.execute('DELETE FROM device_help_videos WHERE id=?', (identifier,))
        return redirect('/admin/device-videos')
