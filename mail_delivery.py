"""Durable encrypted mail queue; retries never block website requests."""
import base64
import hashlib
import json
import sqlite3
import threading
import time
from contextlib import closing
from flask import current_app
from cryptography.fernet import Fernet


def schema(db):
    db.executescript("""
    CREATE TABLE IF NOT EXISTS mail_outbox (id INTEGER PRIMARY KEY, email TEXT, payload BLOB, state TEXT, attempts INTEGER, due INTEGER, created INTEGER);
    CREATE TABLE IF NOT EXISTS owner_recovery (owner_id TEXT PRIMARY KEY, hash TEXT, version TEXT, expires INTEGER);
    """)


def cipher(app):
    return Fernet(base64.urlsafe_b64encode(hashlib.sha256((str(app.secret_key) + ':owner-mail-v1').encode()).digest()))


def enqueue(db, email, code, name):
    payload = cipher(current_app).encrypt(json.dumps({'code':code,'name':name}).encode())
    db.execute('DELETE FROM mail_outbox WHERE email=?', (email,))
    db.execute('INSERT INTO mail_outbox(email,payload,state,attempts,due,created) VALUES (?,?,?,?,?,?)', (email,payload,'pending',0,int(time.time()),int(time.time())))


def process_one(app):
    from station_owners import connect
    from access_email import send_access_code
    now = int(time.time())
    with closing(connect()) as db, db:
        db.execute('BEGIN IMMEDIATE')
        db.execute('DELETE FROM mail_outbox WHERE created < ?', (now-7*86400,))
        db.execute('DELETE FROM owner_recovery WHERE expires < ?', (now,))
        row = db.execute("SELECT * FROM mail_outbox WHERE state IN ('pending','sending') AND due<=? ORDER BY id LIMIT 1", (now,)).fetchone()
        if not row:
            return False
        db.execute("UPDATE mail_outbox SET state='sending',due=? WHERE id=?", (now+120,row['id']))
    try:
        payload = json.loads(cipher(app).decrypt(row['payload']))
        ok = send_access_code(row['email'], payload['code'], payload['name'])
    except Exception as error:
        app.logger.warning('Queued owner email failed: %s',type(error).__name__)
        ok = False
    attempts = row['attempts']+1
    with closing(connect()) as db, db:
        db.execute('UPDATE mail_outbox SET state=?,attempts=?,due=? WHERE id=?', ('sent' if ok else 'failed' if attempts>=8 else 'pending',attempts,now+min(3600,60*2**min(attempts,6)),row['id']))
    return True


def register_delivery(app):
    started = False
    lock = threading.Lock()
    @app.before_request
    def start_mail_worker():
        nonlocal started
        if app.testing or app.config.get('MAIL_WORKER_DISABLED'):
            return
        with lock:
            if started:
                return
            started = True
        def worker():
            while True:
                try:
                    with app.app_context():
                        busy = process_one(app)
                except Exception as error:
                    app.logger.warning('Mail queue worker error: %s',type(error).__name__)
                    busy = False
                time.sleep(2 if busy else 30)
        threading.Thread(target=worker,daemon=True,name='owner-mail').start()
