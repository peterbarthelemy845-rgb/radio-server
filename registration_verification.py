"""Private registration OTPs; publication requires proof of access to the contact mailbox."""
import hashlib,hmac,secrets,time
from contextlib import contextmanager,closing
from flask import request,session,g,jsonify,abort,current_app
from mail_delivery import cipher


def schema(db):
    db.executescript("""
    CREATE TABLE IF NOT EXISTS registration_verifications(id TEXT PRIMARY KEY,station_key TEXT UNIQUE,email TEXT,otp_hash TEXT,payload BLOB,expires INTEGER,attempts INTEGER DEFAULT 0,resends INTEGER DEFAULT 0,created INTEGER,last_sent INTEGER,verified_at INTEGER,state TEXT,mail_attempts INTEGER DEFAULT 0,due INTEGER);
    CREATE TABLE IF NOT EXISTS registration_limits(key TEXT PRIMARY KEY,count INTEGER,until INTEGER);
    """)


def otp_hash(identifier,code):
    from flask import current_app
    return hmac.new(str(current_app.secret_key).encode(),(identifier+':'+code).encode(),hashlib.sha256).hexdigest()


def mask(email):
    local,_,domain=email.partition('@')
    return local[:1]+'***@'+domain


def begin_verification(station):
    from station_owners import database
    from station_directory import key_for
    now=int(time.time())
    with database() as db:
        row=db.execute('SELECT * FROM registration_verifications WHERE station_key=?',(key_for(station),)).fetchone()
        if row is None:
            identifier=secrets.token_urlsafe(24);code=str(100000+secrets.randbelow(900000))
            db.execute("INSERT INTO registration_verifications(id,station_key,email,otp_hash,payload,expires,created,last_sent,state,due) VALUES (?,?,?,?,?,?,?,?,'pending',?)",(identifier,key_for(station),station['contact_email'].casefold(),otp_hash(identifier,code),cipher(current_app).encrypt(code.encode()),now+900,now,now,now))
        else:identifier=row['id']
    session['pending_registration']=identifier
    return {'verification_email':mask(station['contact_email']),'expires_in':max(0,row['expires']-now) if row else 900,'resend_after':max(0,60-(now-row['last_sent'])) if row else 60,'verification_expired':bool(row and row['expires']<=now)}


@contextmanager
def verification_transaction():
    from station_owners import database
    with database() as db:
        db.execute('BEGIN IMMEDIATE')
        g.owner_write_db=db
        try:yield db
        finally:g.pop('owner_write_db',None)


def limit(db,label,maximum,seconds,identity=None):
    now=int(time.time());key=label+':'+hashlib.sha256((identity if identity is not None else request.remote_addr or 'unknown').encode()).hexdigest()
    row=db.execute('SELECT count,until FROM registration_limits WHERE key=?',(key,)).fetchone()
    if row and row['until']>now and row['count']>=maximum:return False
    count=row['count']+1 if row and row['until']>now else 1
    until=row['until'] if row and row['until']>now else now+seconds
    db.execute('INSERT OR REPLACE INTO registration_limits VALUES (?,?,?)',(key,count,until))
    return True


def process_verification_mail(app):
    from station_owners import connect
    from access_email import send_station_message
    now=int(time.time())
    with closing(connect()) as db,db:
        db.execute('BEGIN IMMEDIATE')
        db.execute("UPDATE registration_verifications SET state='expired',payload=NULL,otp_hash='' WHERE verified_at IS NULL AND expires<=? AND payload IS NOT NULL",(now,))
        row=db.execute("SELECT * FROM registration_verifications WHERE verified_at IS NULL AND state IN ('pending','sending') AND due<=? AND expires>? ORDER BY created LIMIT 1",(now,now)).fetchone()
        if not row:return False
        db.execute("UPDATE registration_verifications SET state='sending',due=? WHERE id=?",(now+120,row['id']))
    ok=False
    try:
        with app.app_context():
            code=cipher(app).decrypt(row['payload']).decode()
            ok=send_station_message(row['email'],'Verify your radio station email', 'Your private email verification code is: '+code+'\n\nEnter this code in the verification window on Radio La Voix Divine to verify your email. Your station will publish automatically if it passes screening; flagged content needs administrator review. It expires in 15 minutes. This is not your public radio station code. Do not share it. If you did not submit a station, ignore this email.')
    except Exception as error:app.logger.warning('Registration email failed: %s',type(error).__name__)
    attempts=row['mail_attempts']+1
    with closing(connect()) as db,db:
        db.execute('UPDATE registration_verifications SET state=?,mail_attempts=?,due=? WHERE id=? AND otp_hash=? AND verified_at IS NULL',('sent' if ok else 'failed' if attempts>=5 else 'pending',attempts,now+min(120,15*attempts),row['id'],row['otp_hash']))
    return True


def register_verification(app,radio):
    from station_owners import database,check_token
    from station_directory import key_for

    def pending_info():
        identifier=session.get('pending_registration')
        if not identifier:return None
        with database() as db:row=db.execute('SELECT * FROM registration_verifications WHERE id=? AND verified_at IS NULL',(identifier,)).fetchone()
        return {'verification_required':True,'verification_email':mask(row['email']),'resend_after':max(0,60-(int(time.time())-row['last_sent'])),'verification_expired':row['expires']<=int(time.time())} if row else None
    app.jinja_env.globals['pending_registration_info']=pending_info

    @app.before_request
    def registration_guards():
        if request.method=='POST' and request.path=='/api/add-station':
            with database() as db:
                data=(request.get_json(silent=True) if request.is_json else request.form) or {}
                email=str(data.get('contact_email') or data.get('email') or '').strip().casefold()
                if not limit(db,'new-registration',10,3600) or not limit(db,'registration-mail-target',5,3600,email):return jsonify(status='error',message='Too many submissions. Please try again later.'),429
        if request.endpoint=='admin_approve':
            store=radio.load_station_store();index=(request.view_args or {}).get('index',-1)
            rows=store.get('pending_stations',[])
            if 0<=index<len(rows) and rows[index].get('email_verification_required') and not rows[index].get('email_verified'):
                abort(409,'The station owner must verify their contact email first.')

    @app.post('/api/registration/verify')
    def verify_registration():
        check_token();code=request.form.get('code','').strip()
        with verification_transaction() as db:
            if not limit(db,'verification-attempt',30,900):return jsonify(status='error',message='Too many attempts. Try again later.'),429
            row=db.execute('SELECT * FROM registration_verifications WHERE id=?',(session.get('pending_registration',''),)).fetchone()
            if not row:return jsonify(status='error',message='Submit your station first, or return to the browser used to register it.'),400
            if row['verified_at']:
                store=radio.load_station_store()
                station=next((s for s in store.get('custom_stations',[]) if key_for(s)==row['station_key'] and s.get('contact_email','').casefold()==row['email']),None)
                published=bool(station and not station.get('suspended') and not station.get('owner_suspended'))
                session.pop('pending_registration',None)
                return jsonify(status='ok',published=published,listener_code=station['listener_code'] if published else '',message='This email is already verified.' if published else 'Email verified. The station is awaiting administrator review.')
            if row['expires']<=int(time.time()):return jsonify(status='error',message='This code expired. Request a new email.'),400
            if row['attempts']>=5:return jsonify(status='error',message='Too many incorrect codes. Wait 15 minutes, then request a new email.'),429
            if len(code)!=6 or not code.isascii() or not code.isdigit() or not hmac.compare_digest(otp_hash(row['id'],code),row['otp_hash']):
                db.execute('UPDATE registration_verifications SET attempts=attempts+1 WHERE id=?',(row['id'],))
                return jsonify(status='error',message='Incorrect code. Check the latest verification email.'),400
            store=radio.load_station_store();target=next((s for s in store.get('pending_stations',[]) if key_for(s)==row['station_key'] and s.get('contact_email','').casefold()==row['email']),None)
            if target is None:return jsonify(status='error',message='This submission is no longer pending. Contact the administrator.'),409
            now=int(time.time());target.update(email_verified=True,email_verified_at=now)
            from automatic_screening import can_publish
            published=can_publish(target)
            if published:
                store['pending_stations'].remove(target)
                store.setdefault('custom_stations',[]).append(target)
            radio.save_station_store(store)
            db.execute("UPDATE registration_verifications SET verified_at=?,state='verified',payload=NULL,otp_hash='' WHERE id=?",(now,row['id']))
            session.pop('pending_registration',None)
            return jsonify(status='ok',published=published,listener_code=target['listener_code'] if published else '',message='Your station is now in Library.' if published else 'Email verified. Your station is awaiting administrator review.')

    @app.post('/api/registration/resend')
    def resend_registration_email():
        check_token()
        with verification_transaction() as db:
            if not limit(db,'verification-resend',10,3600):return jsonify(status='error',message='Too many requests. Try again later.'),429
            row=db.execute('SELECT * FROM registration_verifications WHERE id=? AND verified_at IS NULL',(session.get('pending_registration',''),)).fetchone()
            if not row:return jsonify(status='error',message='No pending verification in this browser.'),400
            now=int(time.time())
            if now-row['last_sent']<60:return jsonify(status='error',message='Please wait a minute before resending.'),429
            if row['resends']>=3 and now-row['created']<3600:return jsonify(status='error',message='Email resend limit reached. Please try again in an hour or contact support.'),429
            if row['attempts']>=5 and row['expires']>now:return jsonify(status='error',message='Wait until this code expires before requesting another.'),429
            code=str(100000+secrets.randbelow(900000))
            while hmac.compare_digest(otp_hash(row['id'],code),row['otp_hash']):code=str(100000+secrets.randbelow(900000))
            db.execute("UPDATE registration_verifications SET otp_hash=?,payload=?,expires=?,attempts=?,resends=?,created=?,last_sent=?,state='pending',mail_attempts=0,due=? WHERE id=?",(otp_hash(row['id'],code),cipher(app).encrypt(code.encode()),now+900,0 if row['expires']<=now else row['attempts'],row['resends']+1 if now-row['created']<3600 else 1,row['created'] if now-row['created']<3600 else now,now,now,row['id']))
            return jsonify(status='ok',message='A new verification email is queued. Use the latest code.')
