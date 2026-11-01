import os,sys,time,secrets
from pathlib import Path
from unittest.mock import patch
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
root=Path(os.environ['RADIO_DATA_DIR']);(root/'owner_data').mkdir();(root/'static/wallpapers').mkdir(parents=True)
(root/'config.json').write_text('{}');(root/'stations.json').write_text('{"custom_stations":[],"pending_stations":[]}')
import app as radio,station_owners as owners,radio_link
from station_directory import key_for
app=radio.app;app.testing=True;app.config['MAIL_WORKER_DISABLED']=True;app.app_context().push()
one=dict(station_code='one',listener_code='55',name='First station',url='https://first.example/live',contact_email='first@example.invalid')
two=dict(station_code='two',listener_code='56',name='Second station',url='https://second.example/live',contact_email='second@example.invalid')
radio.save_station_store(dict(custom_stations=[one,two],pending_stations=[]))
client=app.test_client();identifier='a'*32;secret='b'*64;headers={'Authorization':'Bearer '+secret}
assert client.post('/api/radio/link/start',json={'radio_id':identifier,'stable_pair_code':'1234'},headers=headers).status_code==200
def poll(code='55',confirmed=True,auth=headers):
 return client.post('/api/radio/poll',json=dict(radio_id=identifier,playing_station_code=code,playing_confirmed=confirmed),headers=auth)
def rows():
 with radio_link.database() as db:return db.execute('SELECT month,station_key,device_hash FROM station_monthly_radios').fetchall()
with patch('station_plans.month_key',return_value='2026-11'):
 assert poll(auth={}).status_code==401
 assert poll().status_code==200
 assert poll().status_code==200
 assert len(rows())==1
 assert poll('56').status_code==200
 assert len(rows())==2
 assert poll('99').status_code==200
 assert len(rows())==2
with patch('station_plans.month_key',return_value='2026-12'):
 assert poll(confirmed='true').status_code==200
 assert len(rows())==2
 assert poll().status_code==200
 assert len(rows())==3
assert all(row[2]!=identifier and len(row[2])==64 for row in rows())
assert rows()[0][2]!=rows()[-1][2]
owner=app.test_client()
with owners.database() as db:
 grant=db.execute('INSERT INTO station_edit_links(station_key,email,token_hash,expires,used,state,created) VALUES (?,?,?,?,1,?,?)',(key_for(one),one['contact_email'],secrets.token_hex(32),int(time.time())+1800,'verified',int(time.time()))).lastrowid
with owner.session_transaction() as s:s['station_edit_id']=grant
with patch('station_plans.month_key',return_value='2026-11'):
 page=owner.get('/station/edit')
 assert page.status_code==200,page.data
 assert b'Billing is not active' in page.data and b'$30' in page.data and b'$50' in page.data
 assert b'<strong>1</strong> distinct radios' in page.data
 assert b'device reports' in page.data
assert client.get('/station/edit').status_code!=200
print('PASS: private monthly usage, deduplication across repeated polls, independent station/month counts, credential checks, strict report type, unknown stations, monthly pseudonyms and preview-only plans. No payments, emails or stream requests.')
