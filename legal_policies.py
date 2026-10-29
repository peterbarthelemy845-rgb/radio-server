"""Versioned public policies and private rights-request workflow."""
import hashlib
import json
import posixpath
import time
from flask import request,render_template,redirect,abort,flash

TERMS_VERSION='2026-10-29.1'
POLICIES={
 'terms':('Station submission agreement',"""<p>Effective October 29, 2026. Version 2026-10-29.1. These terms govern station submissions to Radio La Voix Divine, including listings and station-code access on compatible radio devices.</p>
<h2>Your authority and required rights</h2><p>You must be an adult authorized to act for the station. You confirm that you have the rights and permissions needed for the submitted stream, music and other programming, cover art, logos, trademarks, and descriptions, including the territories and uses you authorize. Do not submit a stream you are not authorized to distribute. A publicly accessible stream is not proof of permission. You are responsible for maintaining applicable broadcast, performance, recording, and other licenses and for complying with your streaming provider's terms.</p>
<h2>Permission you grant</h2><p>You grant Radio La Voix Divine a nonexclusive permission, for operation of this service, to store, reproduce, resize, cache, display and distribute your submitted name, artwork and descriptions on the website and compatible radios, and to supply your stream URL and updates to radios so listeners can connect directly to the station. You authorize service providers acting for us to perform those functions. You retain your rights. This permission does not give us rights in underlying music or other third-party content you do not control.</p>
<h2>Station codes and editing</h2><p>A six-digit station code is public and can be shared with listeners. It is not a password. Keep the private email sign-in link confidential. You must keep your station information and contact email accurate. Request withdrawal or a contact correction through the privacy/contact form. We may require evidence that you control the station before making sensitive changes.</p>
<h2>Review and prohibited submissions</h2><p>Do not submit unauthorized streams, misleading impersonations, malware, scams, illegal content or unlawful threats. Approval and a station code do not certify that we verified your licenses or endorse your content. We may request evidence of authority and rights, reject a submission, or suspend/remove access while investigating rights, safety or legal concerns.</p>
<h2>Complaints, repeat infringement and withdrawal</h2><p>Use our Copyright &amp; complaints page to report a rights concern. We review notices and may disable listings, artwork and code lookups. We will terminate submission access for repeat infringers in appropriate circumstances and reasonably implement that policy, considering notices, evidence and disputes rather than treating an accusation alone as a final infringement finding. Existing independent streams or cached data on offline or older radios may remain accessible; we do not control a third party's stream server.</p>
<h2>Availability and responsibility</h2><p>Streams and third-party services may change or stop. We do not promise uninterrupted access, a particular audience, earnings or continued placement. To the extent permitted by law, you agree to be responsible for losses and third-party claims caused by your breach of this agreement or unauthorized submissions. Nothing here excludes liability or consumer rights that cannot lawfully be excluded. This agreement does not create a partnership or transfer ownership of your station.</p>
<h2>Privacy and changes</h2><p>Our Privacy notice explains handling of contact information and submission records. We record the agreement version and acceptance time. Materially revised submission terms require renewed acceptance for new submissions or station updates; earlier records are not treated as acceptance of a later version.</p>"""),
 'privacy':('Privacy notice',"""<p>Effective October 29, 2026. This notice covers Radio La Voix Divine's station directory, registration and editing tools.</p>
<h2>What we collect and make public</h2><p>Registration collects station name, stream URL, artwork, bio, location and contact email. Station information, artwork, stream URLs and six-digit listener codes may be publicly displayed or delivered to radios. Contact emails, sign-in secrets, rights-request details and acceptance records are not published in Library or the device API.</p>
<h2>How we use information</h2><p>We use it to operate the directory, deliver requested station codes and sign-in emails, update stations, prevent abuse and investigate rights or privacy requests. We store the agreement version, its text hash, station reference and acceptance time. Requests and administrative decisions are retained privately for follow-up and accountability.</p>
<h2>Browser storage and logs</h2><p>Essential session cookies support forms, admin authentication and private station editing. Your browser may store your language and an identifier used for listening statistics. The site can record listening duration and station/session information. Hosting/security logs can include IP addresses, request times, browser information and requested pages. Limits used to prevent repeated requests may store a hash of an IP address or email. Browser controls let you clear cookies/storage, although forms and sign-in may stop working.</p>
<h2>Service providers and third parties</h2><p>Hosting, email delivery and security providers process data to operate the service. Playing a stream or loading external artwork/news can connect your browser or radio to a third-party provider, which receives connection information and applies its own policies. Requests may be disclosed where reasonably needed to investigate a complaint, comply with law or protect rights; we avoid unnecessarily sharing private contact details.</p>
<h2>Retention and security</h2><p>Station records are kept while operating the listing. Sign-in links expire after 30 minutes. We retain agreement and complaint records as needed for service operation, disputes, security and legal obligations, then review them for deletion. Backups and hosting/email logs may retain earlier copies. We use restricted admin access, HTTPS, session controls and private databases; no system can guarantee absolute security. Do not include unnecessary sensitive information in submissions or requests.</p>
<h2>Your requests</h2><p>Use the Privacy/contact form to request access, correction or deletion, or withdraw a station. We verify identity before releasing private records or changing a listing. Some information may be retained where needed to address a dispute or legal obligation. Do not send passwords, financial information or identification documents through this form.</p>"""),
 'copyright':('Copyright & complaints',"""<p>Use the form below to report suspected infringement or another rights concern involving a station listing, artwork or stream link. We store reports privately for administrator review. A report is not an automatic infringement finding.</p>
<h2>Copyright notices</h2><p>Identify the copyrighted work and the specific material or link you believe infringes it; include the station code or listing location, your contact details, an electronic signature, and the good-faith and authority statements below. Incomplete reports may require follow-up. Misrepresentations can have legal consequences. Relevant notice details may be shared with the affected station where needed to address a claim or as required by law.</p>
<h2>Review and repeat infringement</h2><p>Our administrator reviews requests, may request evidence, and may suspend listings or artwork while investigating. Repeat infringers may have all their listings disabled and future submission access terminated in appropriate circumstances. We record decisions; do not assume a request has been resolved solely because the form was submitted.</p>
<h2>Disputes and counter-notices</h2><p>If material was removed due to a copyright notice and you believe that was a mistake or misidentification, use the Counter-notice page. Applicable DMCA procedures can require forwarding a valid counter-notice and restoring material in 10–14 business days unless the claimant reports a court action. An administrator must review the notice and the applicable procedure; restoration is not automatic.</p>
<h2>Contact channel and designated-agent status</h2><p>This form is an operational complaint channel. It is not a representation that a DMCA designated agent has been registered or that the service qualifies for a statutory safe harbor. A designated agent's registered name, address, telephone and email must be supplied and published separately if that process is used.</p>"""),
 'counter-notice':('Copyright counter-notice',"""<p>Use this only when material was removed following a copyright complaint and you believe the removal resulted from a mistake or misidentification. A counter-notice can have legal consequences. Consider legal advice before submitting. A valid counter-notice includes your signature, identification and previous location of the removed material, your contact details, and the sworn statement and jurisdiction/service-of-process consent below. Relevant information, including your contact details, may need to be forwarded to the original complainant.</p>""")}
TERMS_HASH=hashlib.sha256(POLICIES['terms'][1].encode()).hexdigest()


def schema(db):
    db.executescript("""
      CREATE TABLE IF NOT EXISTS agreement_versions(version TEXT PRIMARY KEY,text_hash TEXT,body TEXT,created INTEGER);
      CREATE TABLE IF NOT EXISTS station_acceptances(id INTEGER PRIMARY KEY,station_key TEXT,email TEXT,version TEXT,text_hash TEXT,accepted_at INTEGER,scope TEXT);
      CREATE TABLE IF NOT EXISTS legal_requests(id INTEGER PRIMARY KEY,kind TEXT,payload TEXT,state TEXT,created INTEGER);
      CREATE TABLE IF NOT EXISTS legal_media_blocks(path TEXT PRIMARY KEY,station_key TEXT,reference INTEGER,created INTEGER);
      CREATE TABLE IF NOT EXISTS terminated_submitters(email TEXT PRIMARY KEY,reference INTEGER,created INTEGER);
      CREATE TABLE IF NOT EXISTS legal_actions(id INTEGER PRIMARY KEY,request_id INTEGER,action TEXT,notes TEXT,created INTEGER);
    """)
    if not db.execute('SELECT 1 FROM agreement_versions WHERE version=?',(TERMS_VERSION,)).fetchone():
        db.execute('INSERT OR IGNORE INTO agreement_versions VALUES (?,?,?,?)',(TERMS_VERSION,TERMS_HASH,POLICIES['terms'][1],int(time.time())))
        db.commit()  # Schema initialization uses a newly opened connection.


def register_legal(app,radio):
    from station_owners import database,check_token
    from station_directory import key_for
    def legal_pending_count():
        with database() as db:return db.execute("SELECT COUNT(*) FROM legal_requests WHERE state IN ('new','review')").fetchone()[0]
    def legal_agreement_status(station):
        with database() as db:
            row=db.execute('SELECT version FROM station_acceptances WHERE station_key=? ORDER BY id DESC LIMIT 1',(key_for(station),)).fetchone()
        return 'Current agreement accepted' if row and row['version']==TERMS_VERSION else 'No current agreement on record'
    app.jinja_env.globals.update(terms_version=TERMS_VERSION,legal_pending_count=legal_pending_count,legal_agreement_status=legal_agreement_status)
    app.view_functions['terms_page']=lambda:render_template('legal_policy.html',title=POLICIES['terms'][0],body=POLICIES['terms'][1],kind='terms')

    @app.get('/privacy')
    def privacy_notice():return render_template('legal_policy.html',title=POLICIES['privacy'][0],body=POLICIES['privacy'][1],kind='privacy')

    @app.get('/copyright')
    def copyright_notice():return render_template('legal_policy.html',title=POLICIES['copyright'][0],body=POLICIES['copyright'][1],kind='copyright')

    @app.get('/counter-notice')
    def copyright_counter_notice():return render_template('legal_policy.html',title=POLICIES['counter-notice'][0],body=POLICIES['counter-notice'][1],kind='counter-notice')

    @app.before_request
    def block_restricted_artwork():
        path=posixpath.normpath(request.path)
        if path.startswith('/static/wallpapers/'):
            with database() as db:
                if db.execute('SELECT 1 FROM legal_media_blocks WHERE path=?',(path,)).fetchone():abort(404)

    @app.before_request
    def require_rights_acceptance():
        if request.method=='POST' and request.path in ('/api/add-station','/station/edit'):
            data=(request.get_json(silent=True) if request.is_json else request.form) or {}
            if data.get('rights_confirmed')!='1' or data.get('terms_version')!=TERMS_VERSION:
                if request.path=='/api/add-station':return {'status':'error','message':'Confirm your station authority and required rights, and accept the current submission agreement.'},400
                abort(400,'Confirm your rights and accept the current submission agreement before saving.')
        if request.method=='POST' and request.path=='/api/add-station':
            data=(request.get_json(silent=True) if request.is_json else request.form) or {}
            email=str(data.get('contact_email') or data.get('email') or '').strip().casefold()
            with database() as db:
                if db.execute("SELECT 1 FROM terminated_submitters WHERE email=?",(email,)).fetchone():
                    abort(403,'Submission access for this contact has been terminated. Contact the administrator to request review.')

    @app.after_request
    def record_agreement(response):
        if request.method=='POST' and ((request.path=='/api/add-station' and response.status_code==200) or (request.path=='/station/edit' and response.status_code==302 and response.headers.get('Location','').startswith('/station/edit?saved=1'))):
            data=(request.get_json(silent=True) if request.is_json else request.form) or {}
            if data.get('rights_confirmed')=='1' and data.get('terms_version')==TERMS_VERSION:
                email=str(data.get('contact_email') or data.get('email') or '').strip().casefold()
                url=data.get('url','').strip()
                for group in ('custom_stations','pending_stations'):
                    for station in radio.load_station_store().get(group,[]):
                        if station.get('url')==url and (request.path=='/station/edit' or station.get('contact_email','').casefold()==email):
                            with database() as db:db.execute('INSERT INTO station_acceptances(station_key,email,version,text_hash,accepted_at,scope) VALUES (?,?,?,?,?,?)',(key_for(station),station.get('contact_email',''),TERMS_VERSION,TERMS_HASH,int(time.time()),'edit' if request.path=='/station/edit' else 'register'))
        if request.path.startswith(('/admin/legal','/legal/request')):response.headers['Cache-Control']='private, no-store'
        return response

    @app.post('/legal/request')
    def legal_request():
        check_token()
        data=request.form
        kind=data.get('kind','')
        if kind not in ('copyright','counter-notice','privacy'):abort(400)
        required=['name','email','message'] if kind=='privacy' else ['name','email','address','phone','work','location','signature','good_faith','authority']
        if any(not data.get(k,'').strip() for k in required) or not radio.is_valid_email(data.get('email','').strip()):abort(400,'Complete the required contact information and statements.')
        if kind!='privacy' and (data.get('good_faith')!='1' or data.get('authority')!='1'):abort(400,'Affirm the required statements before submitting.')
        now=int(time.time());peer=hashlib.sha256((request.remote_addr or 'unknown').encode()).hexdigest()
        with database() as db:
            db.execute('BEGIN IMMEDIATE')
            row=db.execute('SELECT count,until FROM login_attempts WHERE key=?',('legal:'+peer,)).fetchone()
            if row and row['until']>now and row['count']>=5:abort(429,'Too many requests. Please try again later.')
            count=row['count']+1 if row and row['until']>now else 1
            until=row['until'] if row and row['until']>now else now+3600
            db.execute('INSERT OR REPLACE INTO login_attempts VALUES (?,?,?)',('legal:'+peer,count,until))
            payload={key:data.get(key,'').strip()[:8000 if key in ('message','work','location') else 500] for key in required}
            cursor=db.execute("INSERT INTO legal_requests(kind,payload,state,created) VALUES (?,?,'new',?)",(kind,json.dumps(payload),now));reference=cursor.lastrowid
        return render_template('legal_received.html',reference=reference)

    @app.get('/admin/legal')
    def admin_legal():
        with database() as db:
            rows=[dict(r,payload=json.loads(r['payload'])) for r in db.execute('SELECT * FROM legal_requests ORDER BY id DESC LIMIT 200')]
            actions=[dict(r) for r in db.execute('SELECT * FROM legal_actions ORDER BY id DESC LIMIT 100')]
            acceptances=[dict(r) for r in db.execute('SELECT * FROM station_acceptances ORDER BY id DESC LIMIT 100')]
        return render_template('admin_legal.html',requests=rows,actions=actions,acceptances=acceptances)

    @app.post('/admin/legal/<int:reference>')
    def admin_legal_action(reference):
        check_token()
        action=request.form.get('action');notes=request.form.get('notes','').strip()[:4000];code=request.form.get('code','').strip()
        if action not in ('review','close','suspend','terminate','reinstate') or not notes:abort(400,'Add review notes and choose an action.')
        with database() as db:
            row=db.execute('SELECT * FROM legal_requests WHERE id=?',(reference,)).fetchone()
        if not row:abort(404)
        if action in ('suspend','terminate','reinstate'):
            store=radio.load_station_store();target=None
            for group in ('custom_stations','pending_stations'):
                for station in store.get(group,[]):
                    if station.get('listener_code')==code:target=station
            if not target:abort(404,'Select the correct station code after reviewing the report.')
            email=target.get('contact_email','').casefold()
            if action=='reinstate':
                with database() as db:db.execute('DELETE FROM terminated_submitters WHERE email=?',(email,))
            for group in ('custom_stations','pending_stations'):
                for station in store.get(group,[]):
                    if station is target or (action=='terminate' and email and station.get('contact_email','').casefold()==email):
                        station.update(suspended=action!='reinstate',suspended_at=int(time.time()) if action!='reinstate' else None,suspend_reason='Rights review reference '+str(reference) if action!='reinstate' else '')
                        with database() as db:
                            if action=='reinstate':db.execute('DELETE FROM legal_media_blocks WHERE station_key=?',(key_for(station),))
                            else:
                                for image in (station.get('logo_url',''),station.get('wallpaper','')):
                                    path=posixpath.normpath(radio.urlparse(image).path)
                                    if path.startswith('/static/wallpapers/'):
                                        db.execute('INSERT OR REPLACE INTO legal_media_blocks VALUES (?,?,?,?)',(path,key_for(station),reference,int(time.time())))
            radio.save_station_store(store)
            if action=='terminate':
                with database() as db:db.execute('INSERT OR REPLACE INTO terminated_submitters VALUES (?,?,?)',(email,reference,int(time.time())))
        with database() as db:
            db.execute('UPDATE legal_requests SET state=? WHERE id=?',(action,reference))
            db.execute('INSERT INTO legal_actions(request_id,action,notes,created) VALUES (?,?,?,?)',(reference,action,notes,int(time.time())))
        flash('Review action saved. Complete any required owner notification or counter-notice follow-up.','legal')
        return redirect('/admin/legal')
