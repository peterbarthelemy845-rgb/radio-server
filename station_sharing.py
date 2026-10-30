"""Public station landing pages and leased background checks."""
import hashlib,os,sqlite3,threading,time
from contextlib import contextmanager,closing
from pathlib import Path
from urllib.parse import quote,urljoin,urlsplit
from flask import abort,render_template,jsonify
from persistent_storage import data_directory
from safe_http import fetch_public

PUBLIC_ORIGIN='https://www.radiolavoixdivine.com'


def identity(url):return hashlib.sha256(url.encode()).hexdigest()




@contextmanager
def database():
    with closing(sqlite3.connect(Path(data_directory('owner_data'))/'availability.sqlite3',timeout=5)) as db,db:
        db.row_factory=sqlite3.Row
        db.execute('CREATE TABLE IF NOT EXISTS availability(url_hash TEXT PRIMARY KEY,state TEXT,checked INTEGER,due INTEGER,lease INTEGER DEFAULT 0,failures INTEGER DEFAULT 0)')
        yield db


def status_for(url):
    with database() as db:row=db.execute('SELECT state,checked FROM availability WHERE url_hash=?',(identity(url),)).fetchone()
    if not row:return dict(state='unchecked',checked_at=None)
    return dict(state=row['state'] if int(time.time())-row['checked']<3600 else 'stale',checked_at=row['checked'])


def probe(url):
    from stream_playlists import parse_playlist,is_playlist
    for _ in range(3):
        status,kind,body,final=fetch_public(url,probe=True)
        if status in (401,403,429):return 'unknown'
        if status<200 or status>=300:return 'unreachable'
        if not body:return 'unknown'
        if kind.startswith('audio/') and kind not in ('audio/x-scpls','audio/x-mpegurl','audio/mpegurl'):return 'reachable'
        if kind=='application/ogg':return 'reachable'
        if is_playlist(final) or kind in ('audio/x-scpls','audio/x-mpegurl','application/vnd.apple.mpegurl','application/x-mpegurl'):
            if b'#EXT-X-' in body:return 'unknown'  # Playlist reachable, audio not checked.
            url=parse_playlist(body.decode('utf-8-sig',errors='replace'),final);continue
        if body[:3]==b'ID3' or body[:4] in (b'OggS',b'fLaC') or body[0]==255:return 'reachable'
        return 'unknown'
    return 'unknown'


def check_one(radio):
    rows=radio.build_state().get('library_stations',[]);now=int(time.time())
    chosen=None
    with database() as db:
        db.execute('BEGIN IMMEDIATE')
        for station in rows:
            key=identity(station['url'])
            db.execute("INSERT OR IGNORE INTO availability VALUES (?,'unchecked',0,0,0,0)",(key,))
            row=db.execute('SELECT * FROM availability WHERE url_hash=?',(key,)).fetchone()
            if row['due']<=now and row['lease']<=now:
                db.execute('UPDATE availability SET lease=? WHERE url_hash=?',(now+120,key));chosen=station;break
    if chosen is None:return False
    try:state=probe(chosen['url'])
    except Exception:state='unreachable'
    with database() as db:
        db.execute('UPDATE availability SET state=?,checked=?,due=?,lease=0,failures=CASE WHEN ?=\'reachable\' THEN 0 ELSE failures+1 END WHERE url_hash=?',(state,int(time.time()),int(time.time())+900,state,identity(chosen['url'])))
    return True


def register_sharing(app,radio):
    previous_state=radio.build_state
    def state_with_availability():
        state=previous_state()
        with database() as db:
            for station in state.get('library_stations',[]):
                row=db.execute('SELECT state,checked FROM availability WHERE url_hash=?',(identity(station['url']),)).fetchone()
                station['availability']=dict(state=(row['state'] if int(time.time())-row['checked']<3600 else 'stale'),checked_at=row['checked']) if row else dict(state='unchecked',checked_at=None)
        return state
    radio.build_state=state_with_availability
    def find(code):
        if not code.isascii() or not code.isdigit() or not 2<=len(code)<=6:abort(404)
        station=next((s for s in radio.build_state().get('library_stations',[]) if s.get('listener_code')==code),None)
        if station is None:abort(404)
        return station

    @app.get('/station/<code>')
    def station_share(code):
        station=find(code);link=PUBLIC_ORIGIN+'/station/'+code
        image=urljoin(PUBLIC_ORIGIN,station.get('logo_url') or '/static/pwa/icon-512.png')
        if urlsplit(image).scheme not in ('http','https'):image=PUBLIC_ORIGIN+'/static/pwa/icon-512.png'
        return render_template('station_share.html',station=station,share_url=link,share_image=image,whatsapp='https://wa.me/?text='+quote(station['name']+' — Radio station code #'+code+'\n'+link),availability=status_for(station['url']))


    @app.get('/api/station-availability/<code>')
    def station_availability(code):return jsonify(status_for(find(code)['url']))

    started=False;lock=threading.Lock()
    @app.before_request
    def start_availability_worker():
        nonlocal started
        if app.testing or app.config.get('MAIL_WORKER_DISABLED') or os.environ.get('STATION_CHECKS_DISABLED')=='1':return
        with lock:
            if started:return
            started=True
        def worker():
            with app.app_context():
                while True:
                    try:busy=check_one(radio)
                    except Exception as error:app.logger.warning('Availability worker: %s',type(error).__name__);busy=False
                    time.sleep(2 if busy else 60)
        threading.Thread(target=worker,daemon=True,name='station-availability').start()
