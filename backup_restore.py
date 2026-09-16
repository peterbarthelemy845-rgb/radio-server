"""Validate data-only backup ZIPs and restore with rollback on write errors."""
import json
import os
import shutil
import sqlite3
from contextlib import closing
from pathlib import Path, PurePosixPath
from zipfile import ZipFile, BadZipFile

JSON_FILES = {'stations.json', 'config.json', 'reports.json', 'analytics.json', 'ads.json'}
DB_FILES = {'owner_data/owners.sqlite3', 'ad_submissions/submissions.sqlite3'}
MEDIA = {'.jpg','.jpeg','.png','.gif','.webp','.mp4','.webm','.svg','.ico'}

def validate_backup(upload, stage):
    accepted = []
    seen = set()
    try:
        with ZipFile(upload) as archive:
            if len(archive.infolist()) > 10000 or sum(e.file_size for e in archive.infolist()) > 512 * 1024 * 1024:
                raise ValueError('Backup exceeds the 512 MB expanded size limit.')
            for entry in archive.infolist():
                name = entry.filename
                path = PurePosixPath(name)
                if path.is_absolute() or '..' in path.parts or '\\' in name or ':' in name or name.casefold() in seen or (not entry.is_dir() and str(path) != name):
                    raise ValueError('Backup contains an unsafe or duplicate path.')
                seen.add(name.casefold())
                if entry.is_dir():
                    continue
                # Keep the current server signing key and environment configuration.
                if name in ('RESTORE.txt','available-stations.json','owner_data/session.key'):
                    continue
                allowed = name in JSON_FILES or name in DB_FILES or (path.parts[0] in ('static','ad_submissions') and path.suffix.lower() in MEDIA)
                if not allowed:
                    raise ValueError('This is not a supported data backup. Upload a ZIP downloaded from Backups or Export stations.')
                if (entry.external_attr >> 16) & 0o170000 == 0o120000:
                    raise ValueError('Symbolic links are not allowed.')
                destination = stage / name
                if stage.resolve() not in destination.resolve().parents:
                    raise ValueError('Backup path escapes its folder.')
                destination.parent.mkdir(parents=True, exist_ok=True)
                with archive.open(entry) as source, destination.open('wb') as target:
                    shutil.copyfileobj(source, target)
                if name in JSON_FILES:
                    try:
                        data = json.loads(destination.read_text(encoding='utf-8-sig'))
                    except (ValueError, UnicodeError):
                        raise ValueError('Backup contains an invalid JSON file.')
                    if not isinstance(data, (dict, list)) or (name != 'reports.json' and not isinstance(data, dict)):
                        raise ValueError('Backup contains invalid application data.')
                    if name == 'stations.json' and (not isinstance(data, dict) or any(not isinstance(data.get(key, []), list) or any(not isinstance(s, dict) or not isinstance(s.get('url'), str) for s in data.get(key, [])) for key in ('pending_stations','custom_stations'))):
                        raise ValueError('Station data is invalid.')
                if name in DB_FILES:
                    try:
                        with closing(sqlite3.connect(destination)) as db:
                            if db.execute('PRAGMA quick_check').fetchone()[0] != 'ok':
                                raise ValueError('Database integrity check failed.')
                            required = {'accounts','owner_access','station_ownership'} if name.startswith('owner_data') else {'submissions'}
                            tables = {row[0] for row in db.execute("SELECT name FROM sqlite_master WHERE type='table'")}
                            if not required <= tables:
                                raise ValueError('Backup database is missing required account or ad tables.')
                    except sqlite3.DatabaseError:
                        raise ValueError('Backup contains an invalid database.')
                accepted.append(name)
    except (BadZipFile, RuntimeError):
        raise ValueError('The ZIP is corrupt or encrypted.')
    if 'stations.json' not in accepted:
        raise ValueError('Backup must contain stations.json.')
    return accepted

def copy_database(source, destination):
    with closing(sqlite3.connect(source)) as src, closing(sqlite3.connect(destination)) as dst:
        src.backup(dst)

def apply_backup(stage, names, destinations, rollback):
    completed = []
    try:
        for name in names:
            dest = destinations[name]
            dest.parent.mkdir(parents=True, exist_ok=True)
            previous = rollback / name
            existed = dest.exists()
            if existed:
                previous.parent.mkdir(parents=True, exist_ok=True)
                if name in DB_FILES:
                    copy_database(dest, previous)
                else:
                    shutil.copy2(dest, previous)
            completed.append((name, existed))
            if name in DB_FILES:
                copy_database(stage/name, dest)
            else:
                temp = dest.with_name(dest.name + '.restore-tmp')
                shutil.copyfile(stage/name, temp)
                os.replace(temp, dest)
    except Exception:
        for name, existed in reversed(completed):
            dest = destinations[name]
            if existed:
                if name in DB_FILES:
                    copy_database(rollback/name, dest)
                else:
                    shutil.copyfile(rollback/name, dest)
            else:
                dest.unlink(missing_ok=True)
        raise
