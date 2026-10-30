"""Server-side admin sessions and replay-resistant authenticator verification."""
import hashlib,secrets,sqlite3,time
from contextlib import contextmanager,closing
from pathlib import Path
from flask import current_app
from persistent_storage import data_directory


@contextmanager
def database():
    path=Path(data_directory('owner_data'))/'security.sqlite3'
    with closing(sqlite3.connect(path,timeout=5)) as db,db:
        db.execute('CREATE TABLE IF NOT EXISTS admin_sessions(id TEXT PRIMARY KEY,role TEXT,created INTEGER,last_seen INTEGER,revoked INTEGER DEFAULT 0)')
        db.execute('CREATE TABLE IF NOT EXISTS admin_totp_used(secret TEXT,counter INTEGER,PRIMARY KEY(secret,counter))')
        yield db


def new_session(target,role):
    now=int(time.time());token=secrets.token_urlsafe(32)
    with database() as db:
        db.execute('DELETE FROM admin_sessions WHERE created<? OR last_seen<? OR revoked=1',(now-28800,now-1800))
        db.execute('INSERT INTO admin_sessions(id,role,created,last_seen) VALUES (?,?,?,?)',(hashlib.sha256(token.encode()).hexdigest(),role,now,now))
    target.update(admin_logged_in=True,admin_role=role,admin_session=token)


def valid_session(target):
    token=target.get('admin_session','');now=int(time.time())
    if not token:return False
    with database() as db:
        row=db.execute('SELECT role,created,last_seen,revoked FROM admin_sessions WHERE id=?',(hashlib.sha256(token.encode()).hexdigest(),)).fetchone()
        if not row or row[3] or now-row[1]>=28800 or now-row[2]>=1800:return False
        db.execute('UPDATE admin_sessions SET last_seen=? WHERE id=?',(now,hashlib.sha256(token.encode()).hexdigest()))
    target['admin_role']=row[0];return True


def revoke(target):
    with database() as db:db.execute('UPDATE admin_sessions SET revoked=1 WHERE id=?',(hashlib.sha256(target.get('admin_session','').encode()).hexdigest(),))


def consume_totp(secret,code):
    import pyotp
    code=(code or '').strip().replace(' ','')
    if len(code)!=6 or not code.isascii() or not code.isdigit():return False
    now=int(time.time());totp=pyotp.TOTP(secret);key=hashlib.sha256(secret.encode()).hexdigest()
    for offset in (-1,0,1):
        counter=now//30+offset
        if secrets.compare_digest(totp.at(counter*30),code):
            with database() as db:
                db.execute('DELETE FROM admin_totp_used WHERE counter<?',(now//30-2,))
                try:db.execute('INSERT INTO admin_totp_used VALUES (?,?)',(key,counter))
                except sqlite3.IntegrityError:return False
            return True
    return False
