"""Private daily data backups, started lazily inside each serving process."""
import os
import sqlite3
import tempfile
import threading
import time
from pathlib import Path
from contextlib import closing
from zipfile import ZipFile, ZIP_DEFLATED
from flask import render_template, redirect, url_for, send_file, abort

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

    def scheduler():
        while True:
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
