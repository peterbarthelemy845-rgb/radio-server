"""Mailbox-verified, station-scoped editing; public listener codes are never passwords."""
import hashlib
import secrets
import time
from contextlib import closing
from flask import request,session,render_template,redirect,abort,g


def schema(db):
    db.execute("CREATE TABLE IF NOT EXISTS station_edit_links(id INTEGER PRIMARY KEY,station_key TEXT,email TEXT,token_hash TEXT UNIQUE,payload BLOB,expires INTEGER,used INTEGER DEFAULT 0,state TEXT,attempts INTEGER DEFAULT 0,due INTEGER,created INTEGER)")
    from station_edit_otp import schema as otp_schema
    otp_schema(db)


def digest(value):return hashlib.sha256(value.encode()).hexdigest()


def find_station(radio,key,email):
    from station_directory import key_for
    store=radio.load_station_store()
    for group in ('custom_stations','pending_stations'):
        for station in store.get(group,[]):
            if key_for(station)==key and station.get('contact_email','').strip().casefold()==email:return store,station
    return store,None


def process_edit_mail(app):
    from station_owners import connect
    from mail_delivery import cipher
    from access_email import send_station_message
    now=int(time.time())
    with closing(connect()) as db,db:
        db.execute('BEGIN IMMEDIATE')
        db.execute("UPDATE station_edit_links SET state='expired' WHERE expires<=? AND state IN ('pending','sending')",(now,))
        row=db.execute("SELECT * FROM station_edit_links WHERE state IN ('pending','sending') AND due<=? AND expires>? ORDER BY id LIMIT 1",(now,now)).fetchone()
        if not row:return False
        db.execute("UPDATE station_edit_links SET state='sending',due=? WHERE id=?",(now+120,row['id']))
    ok=False
    try:
        with app.app_context():
            _,station=find_station(app.extensions['station_directory_radio'],row['station_key'],row['email'])
            if station:
                link=cipher(app).decrypt(row['payload']).decode()
                ok=send_station_message(row['email'],'Your private station edit link','Open this private link to edit your station cover art, stream URL/IP address, and bio:\n\n'+link+'\n\nThis link expires in 30 minutes and can be used once. Do not share it. If you did not request it, ignore this email.')
    except Exception as error:app.logger.warning('Station edit email failed: %s',type(error).__name__)
    attempts=row['attempts']+1
    with closing(connect()) as db,db:
        db.execute('UPDATE station_edit_links SET state=?,attempts=?,due=? WHERE id=?',('sent' if ok else 'failed' if attempts>=5 else 'pending',attempts,now+min(300,60*attempts),row['id']))
    return True


def register_editing(app,radio):
    from station_owners import database,check_token
    from station_directory import key_for
    from mail_delivery import cipher

    @app.after_request
    def private_edit_pages(response):
        if request.path.startswith(('/station-access/','/station/edit')):
            response.headers['Cache-Control']='private, no-store'
            response.headers['Referrer-Policy']='no-referrer'
        return response
    # Apply after the common security headers so private links never become referrers.
    app.after_request_funcs[None].remove(private_edit_pages)
    app.after_request_funcs[None].insert(0,private_edit_pages)

    @app.post('/station-access/request')
    def request_station_edit():
        check_token()
        email=request.form.get('email','').strip().casefold()[:254]
        code=request.form.get('code','').strip()
        now=int(time.time());allowed=True
        with database() as db:
            db.execute('BEGIN IMMEDIATE')
            keys=['station-edit:'+digest(value) for value in (email,request.remote_addr or 'unknown')]
            for key in keys:
                row=db.execute('SELECT count,until FROM login_attempts WHERE key=?',(key,)).fetchone()
                if row and row['until']>now and row['count']>=3:allowed=False
            if allowed:
                for key in keys:
                    row=db.execute('SELECT count,until FROM login_attempts WHERE key=?',(key,)).fetchone()
                    count=row['count']+1 if row and row['until']>now else 1
                    until=row['until'] if row and row['until']>now else now+600
                    db.execute('INSERT OR REPLACE INTO login_attempts VALUES (?,?,?)',(key,count,until))
        if allowed:
            store=radio.load_station_store()
            for group in ('custom_stations','pending_stations'):
                for station in store.get(group,[]):
                    if station.get('listener_code')==code and station.get('contact_email','').strip().casefold()==email:
                        with database() as db:
                            previous=db.execute('SELECT created FROM station_edit_links WHERE station_key=? ORDER BY id DESC LIMIT 1',(key_for(station),)).fetchone()
                            if previous and now-previous['created']<60:continue
                            token=secrets.token_urlsafe(32)
                            link='https://www.radiolavoixdivine.com/station-access/confirm?token='+token
                            db.execute("INSERT INTO station_edit_links(station_key,email,token_hash,payload,expires,state,due,created) VALUES (?,?,?,?,?,'pending',?,?)",(key_for(station),email,digest(token),cipher(app).encrypt(link.encode()),now+1800,now,now))
        return render_template('station_access_sent.html')

    @app.route('/station-access/confirm',methods=['GET','POST'])
    def confirm_station_edit():
        token=(request.form if request.method=='POST' else request.args).get('token','')[:200]
        if request.method=='POST':check_token()
        with database() as db:
            row=db.execute('SELECT * FROM station_edit_links WHERE token_hash=? AND expires>? AND used=0',(digest(token),int(time.time()))).fetchone()
            valid=bool(row)
            if row:
                _,station=find_station(radio,row['station_key'],row['email']);valid=station is not None
            if valid and request.method=='POST':
                changed=db.execute('UPDATE station_edit_links SET used=1 WHERE id=? AND used=0',(row['id'],)).rowcount
                if changed:
                    session['station_edit_id']=row['id']
                    return redirect('/station/edit')
                valid=False
        return render_template('station_access_confirm.html',token=token,valid=valid),200 if valid else 400

    @app.route('/station/edit',methods=['GET','POST'])
    def edit_registered_station():
        with database() as db:
            row=db.execute('SELECT * FROM station_edit_links WHERE id=? AND used=1 AND expires>?',(session.get('station_edit_id',-1),int(time.time()))).fetchone()
        if not row:return redirect('/#add-station')
        store,station=find_station(radio,row['station_key'],row['email'])
        if not station:session.pop('station_edit_id',None);abort(403)
        error=''
        if request.method=='POST':
            check_token()
            url=request.form.get('url','').strip()
            try:
                parsed=radio.urlparse(url);port=parsed.port
                valid=len(url.encode())<=1024 and parsed.scheme in ('http','https') and bool(parsed.hostname) and not parsed.username and not parsed.password and (port is None or 1<=port<=65535)
            except ValueError:valid=False
            if not valid:
                error='Enter a valid HTTP/HTTPS stream URL, including the port and stream path.'
            elif any(s.get('url')==url and key_for(s)!=key_for(station) for group in ('custom_stations','pending_stations') for s in store.get(group,[])):
                error='This stream URL is already registered to another station.'
            else:
                logo,error=radio.save_uploaded_image('logo_image')
                if not error:
                    station.update(url=url,bio=request.form.get('bio','').strip()[:250])
                    if logo:station['logo_url']=logo
                    radio.save_station_store(store)
                    return redirect('/station/edit?saved=1')
        return render_template('station_edit.html',station=station,error=error,saved=request.args.get('saved')=='1'),400 if error else 200

    @app.post('/station-access/logout')
    def logout_station_edit():
        check_token()
        with database() as db:db.execute('UPDATE station_edit_links SET expires=0 WHERE id=?',(session.get('station_edit_id',-1),))
        session.pop('station_edit_id',None);session.pop('pending_edit_code',None)
        return redirect('/#add-station')
