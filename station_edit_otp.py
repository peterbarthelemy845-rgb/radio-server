"""Session-bound private email codes for the existing-station editor."""
import secrets,time
from contextlib import closing
from flask import request,session,jsonify,render_template
from mail_delivery import cipher
from registration_verification import otp_hash,mask,limit,verification_transaction


def schema(db):
    db.execute("CREATE TABLE IF NOT EXISTS station_edit_otps(id TEXT PRIMARY KEY,station_key TEXT,email TEXT,otp_hash TEXT,payload BLOB,expires INTEGER,attempts INTEGER DEFAULT 0,resends INTEGER DEFAULT 0,created INTEGER,last_sent INTEGER,state TEXT,mail_attempts INTEGER DEFAULT 0,due INTEGER,consumed_at INTEGER,grant_id INTEGER)")


def process_edit_otp_mail(app):
    from station_owners import connect
    from station_editing import find_station
    from access_email import send_station_message
    now=int(time.time())
    with closing(connect()) as db,db:
        db.execute('BEGIN IMMEDIATE')
        db.execute("UPDATE station_edit_otps SET state='expired',payload=NULL,otp_hash='' WHERE consumed_at IS NULL AND expires<=? AND payload IS NOT NULL",(now,))
        row=db.execute("SELECT * FROM station_edit_otps WHERE consumed_at IS NULL AND state IN ('pending','sending') AND due<=? AND expires>? ORDER BY created LIMIT 1",(now,now)).fetchone()
        if not row:return False
        db.execute("UPDATE station_edit_otps SET state='sending',due=? WHERE id=?",(now+120,row['id']))
    ok=False
    try:
        with app.app_context():
            _,station=find_station(app.extensions['station_directory_radio'],row['station_key'],row['email'])
            if station:
                code=cipher(app).decrypt(row['payload']).decode()
                ok=send_station_message(row['email'],'Your station editing verification code','Your private verification code is: '+code+'\n\nEnter it in the verification pop-up to edit your station cover art, stream URL/IP address, and bio. It expires in 15 minutes and works once. This is not your public radio station code. Do not share it. If you did not request it, ignore this email.')
    except Exception as error:app.logger.warning('Station edit code email failed: %s',type(error).__name__)
    attempts=row['mail_attempts']+1
    with closing(connect()) as db,db:
        db.execute('UPDATE station_edit_otps SET state=?,mail_attempts=?,due=? WHERE id=? AND otp_hash=? AND consumed_at IS NULL',('sent' if ok else 'failed' if attempts>=5 else 'pending',attempts,now+min(120,15*attempts),row['id'],row['otp_hash']))
    return True


def register_edit_otp(app,radio):
    from station_owners import database,check_token
    from station_directory import key_for
    from station_editing import find_station,digest

    def info():
        pending=session.get('pending_edit_code')
        if not pending:return None
        return dict(mode='edit',verification_email=mask(pending['email']),resend_after=max(0,60-(int(time.time())-pending['requested_at'])))
    app.jinja_env.globals['pending_station_edit_info']=info

    def queue(db,pending,station):
        now=int(time.time());code=str(100000+secrets.randbelow(900000))
        old=db.execute('SELECT * FROM station_edit_otps WHERE id=?',(pending['id'],)).fetchone()
        while old and otp_hash('edit:'+pending['id'],code)==old['otp_hash']:code=str(100000+secrets.randbelow(900000))
        if old:
            db.execute("UPDATE station_edit_otps SET otp_hash=?,payload=?,expires=?,last_sent=?,attempts=?,state='pending',mail_attempts=0,due=?,resends=resends+1 WHERE id=?",(otp_hash('edit:'+pending['id'],code),cipher(app).encrypt(code.encode()),now+900,now,0 if old['expires']<=now else old['attempts'],now,pending['id']))
        else:
            db.execute("INSERT INTO station_edit_otps(id,station_key,email,otp_hash,payload,expires,created,last_sent,state,due) VALUES (?,?,?,?,?,?,?,?,'pending',?)",(pending['id'],key_for(station),pending['email'],otp_hash('edit:'+pending['id'],code),cipher(app).encrypt(code.encode()),now+900,now,now,now))

    def matching(pending):
        store=radio.load_station_store()
        return next((s for group in ('custom_stations','pending_stations') for s in store.get(group,[]) if s.get('listener_code')==pending['code'] and s.get('contact_email','').casefold()==pending['email']),None)

    def start_edit_code():
        check_token();email=request.form.get('email','').strip().casefold()[:254];code=request.form.get('code','').strip();now=int(time.time())
        previous=session.get('pending_edit_code')
        reuse=previous and previous['email']==email and previous['code']==code and now-previous['requested_at']<900
        pending=previous if reuse else dict(id=secrets.token_urlsafe(24),email=email,code=code,requested_at=now,resends=0)
        session['pending_edit_code']=pending
        if not reuse:
            with verification_transaction() as db:
                allowed=limit(db,'edit-code-request',5,600) and limit(db,'edit-code-email',3,600,email)
                station=matching(pending) if allowed else None
                if station:
                    recent=db.execute('SELECT last_sent FROM station_edit_otps WHERE station_key=? ORDER BY last_sent DESC LIMIT 1',(key_for(station),)).fetchone()
                    if not recent or now-recent['last_sent']>=60:queue(db,pending,station)
        result=info()
        if request.headers.get('X-Requested-With')=='fetch':return jsonify(status='ok',**result)
        return render_template('station_access_code.html',edit_verification_info=result)
    app.view_functions['request_station_edit']=start_edit_code

    @app.post('/station-access/verify-code')
    def verify_edit_code():
        check_token();pending=session.get('pending_edit_code') or {};code=request.form.get('code','').strip();now=int(time.time())
        invalid=lambda:(jsonify(status='error',message='Code incorrect or expired. Check your latest email or request a new code.'),400)
        with verification_transaction() as db:
            if not limit(db,'edit-code-attempt',30,900):return jsonify(status='error',message='Too many attempts. Please try again later.'),429
            row=db.execute('SELECT * FROM station_edit_otps WHERE id=?',(pending.get('id',''),)).fetchone()
            if not row or row['expires']<=now:return invalid()
            if row['consumed_at']:
                if session.get('station_edit_id')==row['grant_id']:return jsonify(status='ok',edit_verified=True)
                return invalid()
            if row['attempts']>=5:return invalid()
            import hmac
            if len(code)!=6 or not code.isascii() or not code.isdigit() or not hmac.compare_digest(otp_hash('edit:'+row['id'],code),row['otp_hash']):
                db.execute('UPDATE station_edit_otps SET attempts=attempts+1 WHERE id=?',(row['id'],));return invalid()
            _,station=find_station(radio,row['station_key'],row['email'])
            if not station:return invalid()
            # The editor uses a separate verified grant; the public challenge is never a magic link.
            grant=db.execute("INSERT INTO station_edit_links(station_key,email,token_hash,payload,expires,used,state,due,created) VALUES (?,?,?,NULL,?,1,'verified',?,?)",(row['station_key'],row['email'],digest(secrets.token_urlsafe(32)),now+1800,now,now)).lastrowid
            db.execute("UPDATE station_edit_otps SET consumed_at=?,grant_id=?,state='verified',payload=NULL,otp_hash='' WHERE id=?",(now,grant,row['id']))
            session['station_edit_id']=grant
            session.pop('pending_edit_code',None)
            return jsonify(status='ok',edit_verified=True)

    @app.post('/station-access/resend-code')
    def resend_edit_code():
        check_token();pending=session.get('pending_edit_code');now=int(time.time())
        if not pending:return jsonify(status='error',message='Enter your registered email and station code first.'),400
        if now-pending['requested_at']<60:return jsonify(status='error',message='Please wait a minute before resending.'),429
        if pending.get('resends',0)>=3:return jsonify(status='error',message='Please wait before requesting another sign-in code.'),429
        with verification_transaction() as db:
            allowed=limit(db,'edit-code-resend',10,3600) and limit(db,'edit-code-resend-email',5,3600,pending['email'])
            station=matching(pending) if allowed else None
            row=db.execute('SELECT * FROM station_edit_otps WHERE id=?',(pending['id'],)).fetchone()
            if station and not (row and (now-row['last_sent']<60 or row['consumed_at'] or (row['attempts']>=5 and row['expires']>now))):queue(db,pending,station)
        pending.update(requested_at=now,resends=pending.get('resends',0)+1);session['pending_edit_code']=pending
        return jsonify(status='ok',message='If the details match, a new email is queued. Use the latest code.')
