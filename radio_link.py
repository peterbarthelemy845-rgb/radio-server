"""Physically initiated radio pairing and acknowledged, station-code-only commands."""
import hashlib,hmac,re,secrets,sqlite3,time
from contextlib import contextmanager,closing
from pathlib import Path
from flask import request,session,jsonify,abort,current_app
from persistent_storage import data_directory


@contextmanager
def database():
    with closing(sqlite3.connect(Path(data_directory('owner_data'))/'radio-links.sqlite3',timeout=5)) as db,db:
        db.row_factory=sqlite3.Row
        db.executescript('''CREATE TABLE IF NOT EXISTS radios(id TEXT PRIMARY KEY,secret_hash TEXT,name TEXT,last_seen INTEGER);
        CREATE TABLE IF NOT EXISTS radio_pairs(radio_id TEXT PRIMARY KEY,pin_hash TEXT UNIQUE,expires INTEGER);
        CREATE TABLE IF NOT EXISTS phone_radios(token_hash TEXT PRIMARY KEY,radio_id TEXT,expires INTEGER);
        CREATE TABLE IF NOT EXISTS radio_pair_claims(id TEXT PRIMARY KEY,radio_id TEXT,token_hash TEXT,check_code TEXT,expires INTEGER,state TEXT,created INTEGER);
        CREATE TABLE IF NOT EXISTS radio_commands(id TEXT PRIMARY KEY,radio_id TEXT,code TEXT,state TEXT,message TEXT,created INTEGER,expires INTEGER,lease INTEGER DEFAULT 0);
        CREATE INDEX IF NOT EXISTS radio_commands_pending ON radio_commands(radio_id,state,expires);''')
        yield db


def digest(value):return hashlib.sha256(value.encode()).hexdigest()
def pin_hash(value):return hmac.new(str(current_app.secret_key).encode(),('radio-pair:'+value).encode(),hashlib.sha256).hexdigest()


def register_radio_link(app,radio):
    def throttle(scope,maximum,window,identity=None):
        app.extensions['security_limit'](scope,maximum,window,identity or request.remote_addr or 'unknown')

    def body():
        if request.content_length and request.content_length>2048:abort(413)
        data=request.get_json(silent=True)
        if not isinstance(data,dict):abort(400,'Please send a JSON object.')
        return data

    def authenticate(db,data,create=False):
        identifier=data.get('radio_id','');token=request.headers.get('Authorization','')
        if not isinstance(identifier,str) or not re.fullmatch('[0-9a-f]{32}',identifier) or not re.fullmatch('Bearer [0-9a-f]{64}',token):abort(401)
        secret=digest(token[7:]);row=db.execute('SELECT * FROM radios WHERE id=?',(identifier,)).fetchone()
        if row is None and create:
            throttle('radio-register',5,3600);throttle('radio-register-total',200,86400,'all')
            # Retain live credentials; prune abandoned unpaired devices to bound storage.
            db.execute('DELETE FROM radios WHERE last_seen<? AND id NOT IN (SELECT radio_id FROM phone_radios WHERE expires>?)',(int(time.time())-2592000,int(time.time())))
            if db.execute('SELECT COUNT(*) FROM radios').fetchone()[0]>=10000:abort(503)
            db.execute('INSERT INTO radios VALUES (?,?,?,?)',(identifier,secret,'My radio',int(time.time())))
            row=db.execute('SELECT * FROM radios WHERE id=?',(identifier,)).fetchone()
        if row is None or not hmac.compare_digest(row['secret_hash'],secret):abort(401)
        return identifier

    def grants(db):
        now=int(time.time());tokens=session.get('phone_radio_tokens',[])
        if not isinstance(tokens,list):return []
        rows=[]
        for token in tokens[:5]:
            if not isinstance(token,str):continue
            row=db.execute('SELECT r.id,r.name,r.last_seen,p.expires FROM phone_radios p JOIN radios r ON r.id=p.radio_id WHERE p.token_hash=? AND p.expires>?',(digest(token),now)).fetchone()
            if row and not any(x['id']==row['id'] for x in rows):rows.append(dict(row))
        return rows

    def require_phone(db,identifier):
        if not any(x['id']==identifier for x in grants(db)):abort(403,'Connect this phone to your radio first.')

    @app.after_request
    def private_radio_link(response):
        if request.path.startswith('/api/radio/'):
            response.headers['Cache-Control']='private, no-store';response.headers['Referrer-Policy']='no-referrer'
        return response
    app.after_request_funcs[None].remove(private_radio_link)
    app.after_request_funcs[None].insert(0,private_radio_link)

    @app.post('/api/radio/link/start')
    def radio_pair_start():
        data=body();throttle('radio-pair-start-ip',360,3600)
        with database() as db:
            identifier=authenticate(db,data,create=True);throttle('radio-pair-start-device',30,3600,identifier)
            now=int(time.time())
            previous=db.execute('SELECT pin_hash FROM radio_pairs WHERE radio_id=?',(identifier,)).fetchone()
            previous_hash=previous['pin_hash'] if previous else ''
            stable=data.get('stable_pair_code')
            if stable is not None and (not isinstance(stable,str) or not re.fullmatch('[A-HJ-NP-Z2-9]{8}',stable)):abort(400)
            db.execute('DELETE FROM radio_pairs WHERE expires>0 AND expires<?',(now,))
            db.execute('DELETE FROM radio_pair_claims WHERE created<?',(now-604800,))
            if stable is not None:
                pin=stable
                collision=db.execute('SELECT radio_id FROM radio_pairs WHERE pin_hash=?',(pin_hash(pin),)).fetchone()
                if collision and collision['radio_id']!=identifier:abort(409)
            else:
                for _ in range(20):
                    pin=''.join(secrets.choice('ABCDEFGHJKLMNPQRSTUVWXYZ23456789') for _ in range(8))
                    candidate=pin_hash(pin)
                    if candidate!=previous_hash and not db.execute('SELECT 1 FROM radio_pairs WHERE pin_hash=?',(candidate,)).fetchone():break
                else:abort(503)
            if pin_hash(pin)!=previous_hash:
                db.execute("UPDATE radio_pair_claims SET state='cancelled' WHERE radio_id=? AND state='waiting'",(identifier,))
            db.execute('INSERT OR REPLACE INTO radio_pairs VALUES (?,?,?)',(identifier,pin_hash(pin),0 if stable is not None else now+300))
            db.execute('UPDATE radios SET last_seen=? WHERE id=?',(now,identifier))
        return jsonify(pair_code=pin,expires_in=0 if stable is not None else 300,persistent=stable is not None)

    @app.post('/api/radio/link/claim')
    def radio_pair_claim():
        from station_owners import check_token
        data=body();check_token();throttle('radio-pair-claim',5,900);throttle('radio-pair-claim-total',2000,86400,'all')
        pin=data.get('pair_code','')
        if isinstance(pin,str):pin=pin.upper().replace('-','').replace(' ','')
        if not isinstance(pin,str) or not re.fullmatch('[A-HJ-NP-Z2-9]{8}',pin):return jsonify(message='Enter the eight-character Link phone code shown on your radio.'),400
        with database() as db:
            db.execute('BEGIN IMMEDIATE');now=int(time.time())
            row=db.execute('SELECT * FROM radio_pairs WHERE pin_hash=? AND (expires=0 OR expires>?)',(pin_hash(pin),now)).fetchone()
            if not row:return jsonify(message='That link code is incorrect or expired. Open Link phone on the radio for a new code.'),400
            if db.execute("SELECT 1 FROM radio_pair_claims WHERE radio_id=? AND state='waiting' AND expires>?",(row['radio_id'],now)).fetchone():return jsonify(message='A phone request is already waiting. Approve or deny it on the radio.'),409
            token=secrets.token_urlsafe(32)
            db.execute('DELETE FROM phone_radios WHERE expires<=?',(now,))
            if db.execute('SELECT COUNT(*) FROM phone_radios WHERE radio_id=?',(row['radio_id'],)).fetchone()[0]>=10:return jsonify(message='This radio already has ten linked phones. Use Unlink phones on the radio to reset them.'),409
            claim=secrets.token_hex(16);check=str(1000+secrets.randbelow(9000))
            db.execute("INSERT INTO radio_pair_claims VALUES (?,?,?,?,?,'waiting',?)",(claim,row['radio_id'],digest(token),check,now+120 if row['expires']==0 else min(now+120,row['expires']),now))
            if row['expires']!=0:db.execute('DELETE FROM radio_pairs WHERE radio_id=?',(row['radio_id'],))
            session['pending_radio_claim']=dict(id=claim,token=token)
        return jsonify(status='waiting',confirmation_code=check)

    @app.get('/api/radio/link/status')
    def phone_pair_status():
        throttle('radio-pair-status',120,60)
        pending=session.get('pending_radio_claim')
        if not isinstance(pending,dict):return jsonify(status='expired',message='Start linking again from your radio.'),200
        with database() as db:
            row=db.execute('SELECT * FROM radio_pair_claims WHERE id=? AND token_hash=?',(pending.get('id',''),digest(pending.get('token','')))).fetchone()
            if not row:return jsonify(status='expired',message='The link request expired. Please start again.'),200
            state=row['state']
            if state=='waiting' and row['expires']<=int(time.time()):state='expired'
            if state=='approved':
                grant=db.execute('SELECT 1 FROM phone_radios WHERE token_hash=? AND radio_id=? AND expires>?',(row['token_hash'],row['radio_id'],int(time.time()))).fetchone()
                if not grant:return jsonify(status='cancelled',message='This phone was unlinked on the radio.'),200
                tokens=session.get('phone_radio_tokens',[])
                if pending['token'] not in tokens:session['phone_radio_tokens']=(tokens+[pending['token']])[-5:]
                session.permanent=True
                return jsonify(status='approved',radio_id=row['radio_id'])
        messages={'denied':'The link was declined on the radio.','cancelled':'Linking was cancelled. Open Link phone on the radio to try again.','expired':'The approval request expired. Open Link phone on the radio for a new code.'}
        return jsonify(status=state,confirmation_code=row['check_code'],message=messages.get(state,'Confirm this phone on your radio.'))

    @app.get('/api/radio/linked')
    def phone_linked_radios():
        throttle('radio-linked-list',60,60)
        with database() as db:rows=grants(db)
        return jsonify(radios=[dict(radio_id=x['id'],name=x['name']+' · '+x['id'][-4:],online=int(time.time())-x['last_seen']<90) for x in rows])

    @app.post('/api/radio/add-station')
    def phone_add_station():
        from station_owners import check_token
        data=body();check_token();throttle('radio-add-station',30,3600)
        code=data.get('code','');identifier=data.get('radio_id','')
        station=next((s for s in radio.build_state().get('library_stations',[]) if s.get('listener_code')==code),None)
        if station is None:return jsonify(message='This station code is no longer available.'),404
        now=int(time.time())
        with database() as db:
            db.execute('BEGIN IMMEDIATE');require_phone(db,identifier)
            db.execute("UPDATE radio_commands SET state='expired',message='The radio did not confirm in time. Turn it on, connect Wi-Fi and try again.' WHERE expires<=? AND state IN ('pending','delivered')",(now,))
            old=db.execute("SELECT id FROM radio_commands WHERE radio_id=? AND code=? AND state IN ('pending','delivered') AND expires>?",(identifier,code,now)).fetchone()
            if old:return jsonify(command_id=old['id'],status='pending'),202
            if db.execute("SELECT COUNT(*) FROM radio_commands WHERE radio_id=? AND state IN ('pending','delivered')",(identifier,)).fetchone()[0]>=10:return jsonify(message='There are already several requests waiting for this radio. Please wait.'),429
            command=secrets.token_hex(16)
            db.execute("INSERT INTO radio_commands(id,radio_id,code,state,message,created,expires) VALUES (?,?,?,'pending','Waiting for your radio.',?,?)",(command,identifier,code,now,now+300))
        return jsonify(command_id=command,status='pending'),202

    @app.get('/api/radio/commands/<command>')
    def phone_command_status(command):
        throttle('radio-command-status',120,60)
        with database() as db:
            row=db.execute('SELECT * FROM radio_commands WHERE id=?',(command,)).fetchone()
            if not row:abort(404)
            require_phone(db,row['radio_id']);state=row['state'];message=row['message']
            if state in ('pending','delivered') and row['expires']<=int(time.time()):state='expired';message='The radio did not confirm in time. Check its Wi-Fi and try again.'
        return jsonify(status=state,message=message)

    @app.post('/api/radio/poll')
    def radio_poll():
        data=body();throttle('radio-poll-ip',240,60)
        with database() as db:
            db.execute('BEGIN IMMEDIATE');identifier=authenticate(db,data);now=int(time.time())
            throttle('radio-poll',12,60,identifier)
            db.execute('UPDATE radios SET last_seen=? WHERE id=?',(now,identifier))
            claim_id=data.get('pair_claim_id','');decision=data.get('pair_decision','');decision_ack='';claim_result=''
            if isinstance(claim_id,str) and re.fullmatch('[0-9a-f]{32}',claim_id) and decision in ('approve','deny'):
                claim=db.execute('SELECT * FROM radio_pair_claims WHERE id=? AND radio_id=?',(claim_id,identifier)).fetchone()
                if claim:
                    claim_result=claim['state']
                    if claim_result=='waiting':
                        claim_result='expired' if claim['expires']<=now else 'approved' if decision=='approve' else 'denied'
                        if claim_result=='approved':db.execute('INSERT OR IGNORE INTO phone_radios VALUES (?,?,?)',(claim['token_hash'],identifier,now+2592000))
                        db.execute('UPDATE radio_pair_claims SET state=? WHERE id=?',(claim_result,claim_id))
                    decision_ack=claim_id
            ack=data.get('ack_id','');result=data.get('ack_status','')
            if isinstance(ack,str) and re.fullmatch('[0-9a-f]{32}',ack) and result in ('added','failed'):
                db.execute("UPDATE radio_commands SET state=?,message=? WHERE id=? AND radio_id=? AND state IN ('pending','delivered','expired')",(result,'Station added successfully to your radio.' if result=='added' else 'The radio could not save the station. Check available space and Wi-Fi, then try again.',ack,identifier))
            db.execute('DELETE FROM radio_commands WHERE created<?',(now-604800,))
            linked=bool(db.execute('SELECT 1 FROM phone_radios WHERE radio_id=? AND expires>?',(identifier,now)).fetchone())
            pair=db.execute("SELECT id,check_code FROM radio_pair_claims WHERE radio_id=? AND state='waiting' AND expires>? ORDER BY created DESC LIMIT 1",(identifier,now)).fetchone()
            row=db.execute("SELECT id,code,expires FROM radio_commands WHERE radio_id=? AND state IN ('pending','delivered') AND expires>? AND lease<=? ORDER BY created LIMIT 1",(identifier,now,now)).fetchone()
            if row:db.execute("UPDATE radio_commands SET state='delivered',lease=? WHERE id=?",(now+60,row['id']))
        return jsonify(linked=linked,command_id=row['id'] if row else '',station_code=row['code'] if row else '',command_expires_in=max(0,row['expires']-now) if row else 0,pair_claim_id=pair['id'] if pair else '',pair_check=pair['check_code'] if pair else '',claim_decision_ack=decision_ack,claim_result=claim_result)

    @app.post('/api/radio/link/reset')
    def radio_reset_links():
        data=body();throttle('radio-reset-ip',20,3600)
        with database() as db:
            identifier=authenticate(db,data)
            db.execute('DELETE FROM phone_radios WHERE radio_id=?',(identifier,));db.execute('DELETE FROM radio_pairs WHERE radio_id=?',(identifier,))
            db.execute("UPDATE radio_pair_claims SET state='cancelled' WHERE radio_id=? AND state IN ('waiting','approved')",(identifier,))
            db.execute("UPDATE radio_commands SET state='failed',message='Phone links were reset on the radio.' WHERE radio_id=? AND state IN ('pending','delivered')",(identifier,))
        return jsonify(status='ok')
