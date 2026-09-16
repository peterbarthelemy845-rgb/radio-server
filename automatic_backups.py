"""Private daily data backups, started lazily inside each serving process."""
import os
import sqlite3
import tempfile
import threading
import time
from pathlib import Path
from contextlib import closing
from zipfile import ZipFile, ZIP_DEFLATED
from flask import render_template, redirect, url_for, send_file, abort, request, g, session

def register_backups(app, radio):
    directory = Path(os.environ.get('RADIO_BACKUP_DIR', str(Path(app.root_path) / 'private_backups'))).resolve()
    started = False
    start_lock = threading.Lock()

    def archives():
        return sorted(directory.glob('radio-backup-*.zip'), reverse=True) if directory.exists() else []

    def create_backup(force=False):
        directory.mkdir(parents=True, exist_ok=True, mode=0o700)
        # SQLite provides a process-wide lock, including multi-worker deployments.
        with closing(sqlite3.connect(directory / 'backup-lock.sqlite3', timeout=0)) as lock:
            try:
                lock.execute('BEGIN IMMEDIATE')
            except sqlite3.OperationalError:
                return
            current = archives()
            if not force and current and time.time() - current[0].stat().st_mtime < 86400:
                return
            import station_owners, ad_submissions, ads
            base = Path(app.root_path)
            name = 'radio-backup-' + time.strftime('%Y%m%d-%H%M%S', time.gmtime()) + '-' + str(time.time_ns())[-6:] + '.zip'
            with tempfile.TemporaryDirectory(dir=directory) as temp:
                staged = Path(temp) / name
                with ZipFile(staged, 'w', ZIP_DEFLATED) as archive:
                    files = [(Path(radio.STATIONS_FILE), 'stations.json'), (Path(radio.CONFIG_FILE), 'config.json'),
                             (Path(radio.REPORTS_FILE), 'reports.json'), (Path(radio.ANALYTICS_FILE), 'analytics.json'),
                             (ads.SETTINGS, 'ads.json'), (station_owners.DATA / 'session.key', 'owner_data/session.key')]
                    for source, destination in files:
                        if source.is_file():
                            archive.write(source, destination)
                    for source, destination in [(station_owners.DATABASE, 'owner_data/owners.sqlite3'),
                                                (ad_submissions.DATABASE, 'ad_submissions/submissions.sqlite3')]:
                        if source.is_file():
                            snapshot = Path(temp) / (source.parent.name + '.sqlite3')
                            with closing(sqlite3.connect(source)) as live, closing(sqlite3.connect(snapshot)) as copy:
                                live.backup(copy)
                            archive.write(snapshot, destination)
                    for folder, prefix in [(base / 'static', 'static'), (ad_submissions.PRIVATE, 'ad_submissions')]:
                        if folder.exists():
                            for source in folder.rglob('*'):
                                if source.is_file() and not source.is_symlink() and source.suffix.lower() in ('.jpg','.jpeg','.png','.gif','.webp','.mp4','.webm','.svg','.ico'):
                                    archive.write(source, prefix + '/' + source.relative_to(folder).as_posix())
                    archive.writestr('RESTORE.txt', 'Stop the radio app before restoring. Keep a copy of current data. Extract this backup into the app directory, preserving paths, then restart. Keep your deployment environment variables, including ADMIN_TOTP_SECRET, separately; they are not in this archive. This archive contains private account records, signing keys, contact details and media. Store it privately. Each SQLite database uses its backup API; files may reflect slightly different moments during live writes.\n')
                with ZipFile(staged) as archive:
                    if archive.testzip() is not None:
                        raise ValueError('Backup verification failed')
                os.replace(staged, directory / name)
            # Delete old backups only after the new archive is verified.
            for old in archives()[7:]:
                old.unlink()
            (directory / 'last-error.txt').unlink(missing_ok=True)
            return directory / name

    def run(force=False):
        try:
            create_backup(force)
        except Exception:
            app.logger.exception('Automatic backup failed')
            try:
                directory.mkdir(parents=True, exist_ok=True)
                (directory / 'last-error.txt').write_text('The latest backup attempt failed. Check server logs and available disk space.', encoding='utf-8')
            except OSError:
                pass

    maintenance = directory / 'restore-in-progress'
    def gate_db():
        directory.mkdir(parents=True, exist_ok=True)
        db = sqlite3.connect(directory / 'restore-gate.sqlite3', timeout=15)
        db.execute('CREATE TABLE IF NOT EXISTS requests (id TEXT PRIMARY KEY)')
        return db

    def maintenance_gate():
        if request.endpoint == 'restore_backup':
            request.max_content_length = 256 * 1024 * 1024
            return
        if maintenance.exists():
            return 'Restoring a backup. Please try again shortly.', 503, {'Retry-After': '30'}
        if request.method == 'POST':
            import uuid
            with closing(gate_db()) as db:
                db.execute('BEGIN IMMEDIATE')
                if maintenance.exists():
                    return 'Restoring a backup. Please try again shortly.', 503
                key = uuid.uuid4().hex
                db.execute('INSERT INTO requests VALUES (?)', (key,))
                db.commit()
                g.backup_request_key = key

    app.before_request_funcs.setdefault(None, []).insert(0, maintenance_gate)

    @app.teardown_request
    def finish_mutation(error):
        key = g.pop('backup_request_key', None)
        if key:
            with closing(gate_db()) as db:
                db.execute('DELETE FROM requests WHERE id=?', (key,))
                db.commit()

    @app.route('/admin/backups/restore', methods=['POST'])
    def restore_backup():
        from station_owners import check_token, database
        from backup_restore import validate_backup, apply_backup
        import station_owners, ad_submissions, ads
        check_token()
        if not radio.is_totp_configured():
            abort(400, 'Configure Google Authenticator before restoring a backup.')
        with database() as db:
            attempt = db.execute("SELECT * FROM login_attempts WHERE key='backup-restore'").fetchone()
            now = int(time.time())
            if attempt and attempt['until'] > now and attempt['count'] >= 5:
                return 'Too many incorrect codes. Try again in 15 minutes.', 429
            if not radio.verify_admin_totp(request.form.get('totp_code','')):
                count = attempt['count']+1 if attempt and attempt['until'] > now else 1
                db.execute('INSERT OR REPLACE INTO login_attempts VALUES (?,?,?)', ('backup-restore',count,now+900))
                return 'Incorrect authenticator code. No data was restored.', 400
            db.execute("DELETE FROM login_attempts WHERE key='backup-restore'")
        upload = request.files.get('backup')
        if not upload or request.form.get('confirm') != 'yes':
            abort(400, 'Choose a backup ZIP and confirm replacement.')
        directory.mkdir(parents=True, exist_ok=True)
        with tempfile.TemporaryDirectory(dir=directory) as temp:
            stage = Path(temp)/'stage'
            stage.mkdir()
            try:
                names = validate_backup(upload.stream, stage)
            except ValueError as error:
                return str(error), 400
            with closing(gate_db()) as db:
                db.execute('BEGIN IMMEDIATE')
                if maintenance.exists():
                    return 'Another restore is in progress.', 409
                maintenance.mkdir()
                db.commit()
            try:
                deadline = time.monotonic()+30
                while True:
                    with closing(gate_db()) as db:
                        active = db.execute('SELECT count(*) FROM requests').fetchone()[0]
                    if not active:
                        break
                    if time.monotonic() >= deadline:
                        return 'The site is busy. No data was restored. Retry when submissions have finished.', 409
                    time.sleep(0.1)
                safety = create_backup(force=True)
                if not safety:
                    return 'A safety backup could not start. No data was restored. Try again shortly.', 409
                root = Path(app.root_path).resolve()
                mapping = {'stations.json':Path(radio.STATIONS_FILE), 'config.json':Path(radio.CONFIG_FILE),
                           'reports.json':Path(radio.REPORTS_FILE), 'analytics.json':Path(radio.ANALYTICS_FILE),
                           'ads.json':ads.SETTINGS, 'owner_data/owners.sqlite3':station_owners.DATABASE,
                           'ad_submissions/submissions.sqlite3':ad_submissions.DATABASE}
                destinations = {}
                for name in names:
                    dest = mapping.get(name, root/name)
                    if name not in mapping and root not in dest.resolve().parents:
                        abort(400, 'Invalid media destination.')
                    destinations[name] = dest
                apply_backup(stage, names, destinations, Path(temp)/'rollback')
                radio.playlist_cache.clear()
                session.clear()
            finally:
                maintenance.rmdir()
        return redirect(url_for('admin_login', restored='1'))

    def scheduler():
        while True:
            if not maintenance.exists():
                run()
            time.sleep(3600)

    @app.before_request
    def start_backups():
        nonlocal started
        if app.testing or os.environ.get('RADIO_AUTO_BACKUP', '1') == '0':
            return
        with start_lock:
            if not started:
                threading.Thread(target=scheduler, name='radio-backups', daemon=True).start()
                started = True

    @app.route('/admin/backups', methods=['GET'])
    def backup_dashboard():
        rows = [dict(name=p.name, size=round(p.stat().st_size/1048576, 2), date=time.strftime('%Y-%m-%d %H:%M UTC', time.gmtime(p.stat().st_mtime))) for p in archives()]
        return render_template('backups.html', backups=rows, failed=(directory/'last-error.txt').exists(), enabled=os.environ.get('RADIO_AUTO_BACKUP','1')!='0')

    @app.route('/admin/backups/create', methods=['POST'])
    def backup_now():
        from station_owners import check_token
        check_token()
        # Do not hold the owner write transaction while snapshotting its database.
        threading.Thread(target=run, args=(True,), daemon=True).start()
        return redirect(url_for('backup_dashboard', requested='1'))

    @app.route('/admin/backups/download/<name>')
    def download_backup(name):
        if name not in {p.name for p in archives()}:
            abort(404)
        response = send_file(directory / name, as_attachment=True)
        response.headers['Cache-Control'] = 'private, no-store'
        return response

    return create_backup
