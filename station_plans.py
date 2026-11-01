"""Informational station plans. No checkout, charges or playback enforcement."""
import hashlib, hmac, re, time
from datetime import datetime
from zoneinfo import ZoneInfo

ZONE = ZoneInfo('America/New_York')

def month_key(now=None):
    return datetime.fromtimestamp(time.time() if now is None else now, ZONE).strftime('%Y-%m')

def schema(db):
    db.execute('''CREATE TABLE IF NOT EXISTS station_monthly_radios (
      month TEXT NOT NULL,station_key TEXT NOT NULL,device_hash TEXT NOT NULL,
      first_seen INTEGER NOT NULL,PRIMARY KEY(month,station_key,device_hash))''')

def plan_for(count):
    if count <= 10:return dict(name='Starter',price=0,limit=10)
    if count <= 100:return dict(name='Growth',price=30,limit=100)
    if count <= 300:return dict(name='Community',price=50,limit=300)
    return dict(name='Contact us',price=None,limit=None)

def record_activity(app, radio, data, identifier):
    # Called only after the existing per-radio credential has authenticated.
    code=data.get('playing_station_code')
    if data.get('playing_confirmed') is not True or not isinstance(code,str) or not re.fullmatch(r'[0-9]{2,6}',code):return
    from station_directory import key_for
    from station_owners import DATABASE
    import sqlite3
    from contextlib import closing
    main=key_for(dict(radio.TEST_STREAMS[0],url=radio.MAIN_STREAM_URL))
    allowed={key_for(s) for s in app.extensions['station_store_read_only']().get('custom_stations',[])
             if not s.get('suspended') and not s.get('owner_suspended')}
    allowed.add(main)
    # Read-only lookup avoids schema writes and does not accept arbitrary station keys.
    with closing(sqlite3.connect(DATABASE.as_uri()+'?mode=ro',uri=True,timeout=1)) as db:
        row=db.execute('SELECT station_key FROM listener_codes WHERE code=?',(code,)).fetchone()
    if not row or row[0] not in allowed:return
    key=row[0];month=month_key()
    fingerprint=hmac.new(str(app.secret_key).encode(),('monthly-radio:'+month+':'+key+':'+identifier).encode(),hashlib.sha256).hexdigest()
    from radio_link import database
    with database() as db:
        schema(db)
        # Keep the current and previous twelve calendar months; no raw radio IDs.
        cutoff=f'{int(month[:4])-1:04d}{month[4:]}'
        db.execute('DELETE FROM station_monthly_radios WHERE month<?',(cutoff,))
        db.execute('INSERT OR IGNORE INTO station_monthly_radios VALUES (?,?,?,?)',(month,key,fingerprint,int(time.time())))

def register_station_plans(app):
    def usage(station):
        from station_directory import key_for
        from radio_link import database
        month=month_key()
        with database() as db:
            schema(db)
            count=db.execute('SELECT COUNT(*) FROM station_monthly_radios WHERE month=? AND station_key=?',(month,key_for(station))).fetchone()[0]
        return dict(month=month,count=count,plan=plan_for(count))
    app.jinja_env.globals['station_plan_usage']=usage
