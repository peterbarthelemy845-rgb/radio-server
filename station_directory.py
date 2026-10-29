"""Public listener codes are identifiers, never owner login credentials."""
import hashlib
import json
import os
import re
import secrets
import threading
import time
from contextlib import closing
from flask import jsonify, request, render_template, current_app, abort, redirect, flash


def schema(db):
    db.executescript('''
    CREATE TABLE IF NOT EXISTS listener_codes(code TEXT PRIMARY KEY,station_key TEXT UNIQUE NOT NULL);
    CREATE TABLE IF NOT EXISTS listener_mail(id INTEGER PRIMARY KEY,code TEXT,email TEXT,name TEXT,
      state TEXT,attempts INTEGER,due INTEGER,created INTEGER,UNIQUE(code,email));
    CREATE TABLE IF NOT EXISTS directory_limits(peer TEXT PRIMARY KEY,window INTEGER,count INTEGER);
    ''')
    from station_editing import schema as edit_schema
    edit_schema(db)
    from legal_policies import schema as legal_schema
    legal_schema(db)


def key_for(station):
    return station.get('station_code') or 'url:' + hashlib.sha256(station['url'].encode()).hexdigest()


def ensure_code(db, station):
    key = key_for(station)
    row = db.execute('SELECT code FROM listener_codes WHERE station_key=?', (key,)).fetchone()
    if row:
        station['listener_code'] = row['code']
        return row['code']
    candidate = station.get('listener_code', '')
    # Old records may gain owner accounts or edited URLs. Preserve their code
    # when moving from a legacy URL identity to the permanent station identity.
    if re.fullmatch(r'[0-9]{6}',candidate):
        legacy=db.execute('SELECT station_key FROM listener_codes WHERE code=?',(candidate,)).fetchone()
        if legacy and legacy['station_key'].startswith('url:'):
            db.execute('UPDATE listener_codes SET station_key=? WHERE code=?',(key,candidate))
            return candidate
    for _ in range(100):
        if not re.fullmatch(r'[0-9]{6}', candidate):
            candidate = str(100000 + secrets.randbelow(900000))
        inserted = db.execute('INSERT OR IGNORE INTO listener_codes VALUES (?,?)', (candidate,key)).rowcount
        if inserted:
            station['listener_code'] = candidate
            return candidate
        row = db.execute('SELECT code FROM listener_codes WHERE station_key=?', (key,)).fetchone()
        if row:
            station['listener_code'] = row['code']
            return row['code']
        candidate = ''
    raise RuntimeError('Unable to reserve a station code')


def prepare_store(store):
    from station_owners import database
    with database() as db:
        for group in ('pending_stations','custom_stations'):
            for station in store.get(group,[]):
                if station.get('url'):
                    ensure_code(db,station)


def enqueue_approved(store, previous):
    from station_owners import database
    # Backfill codes silently. Send for new approvals/contact changes only.
    old={(key_for(s),s.get('contact_email','').casefold()) for s in previous.get('custom_stations',[])}
    with database() as db:
        for s in store.get('custom_stations',[]):
            email=s.get('contact_email','').strip().casefold()
            if not email or (key_for(s),email) in old or s.get('suspended') or s.get('owner_suspended'):
                continue
            now=int(time.time())
            db.execute("INSERT OR IGNORE INTO listener_mail(code,email,name,state,attempts,due,created) VALUES (?,?,?,'pending',0,?,?)",
                       (s['listener_code'],email,s['name'],now,now))


def process_mail(app):
    from station_owners import connect
    from access_email import send_listener_code
    now=int(time.time())
    with closing(connect()) as db, db:
        db.execute('BEGIN IMMEDIATE')
        row=db.execute("SELECT * FROM listener_mail WHERE state IN ('pending','sending') AND due<=? ORDER BY id LIMIT 1",(now,)).fetchone()
        if not row:return False
        db.execute("UPDATE listener_mail SET state='sending',due=? WHERE id=?",(now+120,row['id']))
    try:
        with app.app_context():
            radio=app.extensions['station_directory_radio']
            active=any(s.get('listener_code')==row['code'] and s.get('contact_email','').casefold()==row['email']
                       and not s.get('suspended') and not s.get('owner_suspended')
                       for s in radio.load_station_store().get('custom_stations',[]))
            ok=send_listener_code(row['email'],row['code'],row['name']) if active else False
    except Exception as error:
        app.logger.warning('Station code email failed: %s',type(error).__name__)
        active=True;ok=False
    attempts=row['attempts']+1
    state='canceled' if not active else 'sent' if ok else 'failed' if attempts>=8 else 'pending'
    with closing(connect()) as db, db:
        db.execute('UPDATE listener_mail SET state=?,attempts=?,due=? WHERE id=?',
                   (state,attempts,now+min(3600,60*2**min(attempts,6)),row['id']))
    return True


def public_station(s, code):
    name=str(s.get('name') or '').encode('utf-8')[:96].decode('utf-8',errors='ignore')
    return {k:v for k,v in dict(listener_code=code,name=name,url=s.get('url',''),
            logo_url=s.get('logo_url',''),subtitle=s.get('subtitle','Internet Radio')).items()}


def register_directory(app, radio):
    app.extensions['station_directory_radio']=radio
    radio.get_wifi_status_data=lambda:{'ssid':''}
    radio.get_add_station_url=lambda:'https://www.radiolavoixdivine.com/add-station'
    radio.get_remote_streams=lambda:[]
    original_load=radio.load_station_store
    original_save=radio.save_station_store
    def load():
        store=original_load();prepare_store(store);return store
    def save(store):
        previous={'custom_stations':[]}
        if os.path.exists(radio.STATIONS_FILE):
            with open(radio.STATIONS_FILE,encoding='utf-8') as f:
                previous=json.load(f)
            if isinstance(previous,list):previous={'custom_stations':previous}
        prepare_store(store)
        original_save(store);enqueue_approved(store,previous)
    radio.load_station_store=load
    radio.save_station_store=save
    def listener_mail_status(s):
        from station_owners import database
        with database() as db:
            row=db.execute('SELECT state FROM listener_mail WHERE code=? AND email=?',
                           (s.get('listener_code',''),s.get('contact_email','').casefold())).fetchone()
        return row['state'] if row else 'not queued'
    app.jinja_env.globals.update(listener_station_code=lambda s:s.get('listener_code',''),listener_mail_status=listener_mail_status)
    # Keep the original player UI; only the protected main station plays here.
    app.view_functions['index']=lambda:render_template('index.html',public_web=True)
    radio.get_all_streams=lambda:[dict(radio.TEST_STREAMS[0],name='La Voix Divine',url=radio.MAIN_STREAM_URL)]
    original_state=radio.build_state
    def library_state():
        state=original_state()
        from station_owners import database
        main=dict(radio.TEST_STREAMS[0],name='La Voix Divine',url=radio.MAIN_STREAM_URL)
        with database() as db:ensure_code(db,main)
        rows=[public_station(main,main['listener_code'])]
        for station in load().get('custom_stations',[]):
            if not station.get('suspended') and not station.get('owner_suspended') and station.get('url')!=radio.MAIN_STREAM_URL:
                rows.append(dict(public_station(station,station['listener_code']),location=station.get('location',''),bio=station.get('bio','')))
        state['custom_stations']=[]  # Legacy configuration records must not expose contact details.
        state['library_stations']=rows
        return state
    radio.build_state=library_state
    @app.before_request
    def main_station_playback_only():
        if request.path in ('/api/play-stream','/api/resolve-stream','/api/listen-heartbeat'):
            data=request.get_json(silent=True) or {}
            if data.get('url') and data['url']!=radio.MAIN_STREAM_URL:
                return jsonify(error='Only La Voix Divine plays on this website. Add other stations to your radio using their station code.'),403
        if request.path=='/api/play-stream':
            return jsonify(status='browser',url=radio.MAIN_STREAM_URL)
        if request.path=='/api/volume':
            return jsonify(status='ok')

    @app.before_request
    def retire_owner_logins():
        if request.path=='/owner' or request.path.startswith('/owner/') or request.endpoint=='assign_station_owner':
            abort(404)

    def queue_resend(station):
        from station_owners import database
        email=station.get('contact_email','').strip().casefold()
        if not email or station.get('suspended') or station.get('owner_suspended'):return False
        with database() as db:
            now=int(time.time())
            row=db.execute('SELECT created,state FROM listener_mail WHERE code=? AND email=?',(station['listener_code'],email)).fetchone()
            if row and (now-row['created']<60 or row['state'] in ('pending','sending')):return False
            db.execute("INSERT INTO listener_mail(code,email,name,state,attempts,due,created) VALUES (?,?,?,'pending',0,?,?) ON CONFLICT(code,email) DO UPDATE SET state='pending',attempts=0,due=excluded.due,created=excluded.created,name=excluded.name",(station['listener_code'],email,station['name'],now,now))
        return True

    @app.post('/station-code/resend')
    def public_resend_station_code():
        from station_owners import check_token,database
        check_token()
        email=request.form.get('email','').strip().casefold()[:254]
        now=int(time.time())
        keys=['code-resend:'+hashlib.sha256(value.encode()).hexdigest() for value in (email,request.remote_addr or 'unknown')]
        allowed=True
        with database() as db:
            db.execute('BEGIN IMMEDIATE')
            for key in keys:
                row=db.execute('SELECT until FROM login_attempts WHERE key=?',(key,)).fetchone()
                if row and row['until']>now:allowed=False
            if allowed:
                for key in keys:db.execute('INSERT OR REPLACE INTO login_attempts VALUES (?,1,?)',(key,now+60))
        if allowed and '@' in email:
            for station in load().get('custom_stations',[]):
                if station.get('contact_email','').strip().casefold()==email:queue_resend(station)
        return render_template('station_code_resent.html')

    def code_management_rows():
        from station_owners import database
        main=dict(radio.TEST_STREAMS[0],name='La Voix Divine',url=radio.MAIN_STREAM_URL,approval='Approved')
        with database() as db:ensure_code(db,main)
        rows=[main]
        store=load()
        for group,label in [('pending_stations','Pending approval'),('custom_stations','Approved')]:
            for station in store.get(group,[]):
                rows.append(dict(station,approval='Suspended' if station.get('suspended') or station.get('owner_suspended') else label))
        return rows

    @app.get('/admin/station-codes')
    def admin_station_codes():
        return render_template('admin_station_codes.html',stations=code_management_rows())

    @app.post('/admin/station-codes/<code>/resend')
    def admin_resend_station_code(code):
        from station_owners import check_token
        check_token()
        for station in code_management_rows():
            if station['listener_code']==code and station['approval']=='Approved':
                queued=queue_resend(station)
                flash('Station code email queued.' if queued else 'Not queued: check contact email or wait for the current email attempt.','station-code')
                return redirect('/admin/station-codes')
        abort(404)

    @app.get('/api/device/stations/<code>')
    def device_station(code):
        if not re.fullmatch(r'[0-9]{6}',code):return jsonify(error='Enter a six-digit station code.'),400
        from station_owners import database
        with database() as db:
            now=int(time.time());peer=request.remote_addr or 'unknown'
            db.execute('DELETE FROM directory_limits WHERE window<?',(now-120,))
            row=db.execute('SELECT * FROM directory_limits WHERE peer=?',(peer,)).fetchone()
            count=row['count']+1 if row and now-row['window']<60 else 1
            window=row['window'] if row and now-row['window']<60 else now
            db.execute('INSERT OR REPLACE INTO directory_limits VALUES (?,?,?)',(peer,window,count))
            if count>app.config.get('DIRECTORY_LOOKUPS_PER_MINUTE',6000):
                response=jsonify(error='Please wait and try again.');response.headers['Retry-After']='60'
                return response,429
        store=load()
        main=dict(radio.TEST_STREAMS[0],name='La Voix Divine',url=radio.MAIN_STREAM_URL)
        with database() as db:ensure_code(db,main)
        if main['listener_code']==code:
            response=jsonify(public_station(main,code));response.headers['Cache-Control']='no-store'
            return response
        for s in store.get('custom_stations',[]):
            if s.get('listener_code')==code and not s.get('suspended') and not s.get('owner_suspended'):
                response=jsonify(public_station(s,code));response.headers['Cache-Control']='no-store'
                return response
        return jsonify(error='Station code not found or not available.'),404

    @app.get('/api/device/default-station')
    def device_default():
        return jsonify(listener_code='',name='La Voix Divine',url=radio.MAIN_STREAM_URL,
                       logo_url=radio.RADIO_LA_VOIX_LOGO_URL,subtitle='Internet Radio')

    @app.post('/owner/station/<code>/email-listener-code')
    def email_listener_code(code):
        from station_owners import owned_station,check_token,database
        check_token();store=load();group,s=owned_station(store,code)
        if group!='custom_stations' or s.get('suspended') or s.get('owner_suspended'):
            return jsonify(error='Station must be approved and active.'),409
        with database() as db:
            now=int(time.time())
            row=db.execute('SELECT created FROM listener_mail WHERE code=? AND email=?',(s['listener_code'],s['contact_email'])).fetchone()
            if row and now-row['created']<60:return jsonify(error='Please wait one minute before resending.'),429
            db.execute("INSERT INTO listener_mail(code,email,name,state,attempts,due,created) VALUES (?,?,?,'pending',0,?,?) ON CONFLICT(code,email) DO UPDATE SET state='pending',attempts=0,due=excluded.due,created=excluded.created,name=excluded.name",
                       (s['listener_code'],s['contact_email'],s['name'],now,now))
        from flask import redirect,url_for
        return redirect(url_for('owner_dashboard'))

    from station_editing import register_editing,process_edit_mail
    register_editing(app,radio)
    from legal_policies import register_legal
    register_legal(app,radio)
    lock=threading.Lock();started=False
    @app.before_request
    def start_listener_mail_worker():
        nonlocal started
        if app.testing or app.config.get('MAIL_WORKER_DISABLED'):return
        with lock:
            if started:return
            started=True
        def worker():
            while True:
                try:
                    busy=process_mail(app)
                    busy=process_edit_mail(app) or busy
                except Exception as error:
                    app.logger.warning('Station mail worker: %s',type(error).__name__);busy=False
                time.sleep(2 if busy else 30)
        threading.Thread(target=worker,daemon=True,name='station-code-mail').start()
