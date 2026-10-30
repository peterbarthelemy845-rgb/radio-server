import os,sys,time,hashlib,secrets
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
root=Path(os.environ['RADIO_DATA_DIR']);(root/'owner_data').mkdir();(root/'static/wallpapers').mkdir(parents=True)
(root/'config.json').write_text('{}',encoding='utf-8');(root/'stations.json').write_text('{"pending_stations":[],"custom_stations":[]}',encoding='utf-8')
import app as radio
import radio_link
app=radio.app;app.testing=True;app.config['MAIL_WORKER_DISABLED']=True
phone=app.test_client();stranger=app.test_client();device=app.test_client()
phone.get('/');stranger.get('/')
with phone.session_transaction() as session:csrf=session['owner_csrf']
with stranger.session_transaction() as session:other_csrf=session['owner_csrf']
code=phone.get('/api/state').get_json()['library_stations'][0]['listener_code']
identifier=secrets.token_hex(16);secret=secrets.token_hex(32);headers={'Authorization':'Bearer '+secret}
assert phone.get('/api/radio/linked').get_json()=={'radios':[]}
assert device.post('/api/radio/link/start',json={'radio_id':identifier}).status_code==401
start=device.post('/api/radio/link/start',json={'radio_id':identifier},headers=headers)
assert start.status_code==200;pin=start.get_json()['pair_code'];assert len(pin)==8 and start.get_json()['expires_in']==300
with app.app_context(),radio_link.database() as db:
 stored=db.execute('SELECT * FROM radios').fetchone();assert secret not in dict(stored).values()
 stored_pair=db.execute('SELECT * FROM radio_pairs').fetchone();assert pin not in dict(stored_pair).values()
assert secret not in start.get_data(as_text=True)
assert phone.post('/api/radio/link/claim',json={'pair_code':pin}).status_code==400
assert phone.post('/api/radio/link/claim',json=['invalid']).status_code==400
assert phone.post('/api/radio/link/claim',json={'owner_csrf':csrf,'pair_code':'BAD-CODE'}).status_code==400
claim=phone.post('/api/radio/link/claim',json={'owner_csrf':csrf,'pair_code':pin[:4].lower()+'-'+pin[4:].lower()})
assert claim.status_code==200 and claim.get_json()['status']=='waiting'
check_code=claim.get_json()['confirmation_code']
assert phone.get('/api/radio/linked').get_json()['radios']==[]
assert phone.post('/api/radio/add-station',json={'owner_csrf':csrf,'radio_id':identifier,'code':code}).status_code==403
assert phone.get('/api/radio/link/status').get_json()['status']=='waiting'
with radio_link.database() as db:assert db.execute('SELECT COUNT(*) FROM phone_radios').fetchone()[0]==0
approval=device.post('/api/radio/poll',json={'radio_id':identifier},headers=headers).get_json()
claim_id=approval['pair_claim_id'];assert claim_id and approval['pair_check']==check_code
assert device.post('/api/radio/poll',json={'radio_id':identifier,'pair_claim_id':claim_id,'pair_decision':'approve'}).status_code==401
assert phone.get('/api/radio/link/status').get_json()['status']=='waiting'
approved=device.post('/api/radio/poll',json={'radio_id':identifier,'pair_claim_id':claim_id,'pair_decision':'approve'},headers=headers).get_json()
assert approved['claim_result']=='approved'
assert phone.get('/api/radio/link/status').get_json()['status']=='approved'
assert stranger.post('/api/radio/link/claim',json={'owner_csrf':other_csrf,'pair_code':pin}).status_code==400
linked=phone.get('/api/radio/linked');assert linked.get_json()['radios'][0]['radio_id']==identifier
assert linked.headers['Cache-Control']=='private, no-store' and linked.headers['Referrer-Policy']=='no-referrer'
assert stranger.get('/api/radio/linked').get_json()['radios']==[]
assert stranger.post('/api/radio/add-station',json={'owner_csrf':other_csrf,'radio_id':identifier,'code':code}).status_code==403
assert phone.post('/api/radio/add-station',json={'radio_id':identifier,'code':code}).status_code==400
assert phone.post('/api/radio/add-station',json={'owner_csrf':csrf,'radio_id':identifier,'code':'999999'}).status_code==404
with radio_link.database() as db:assert db.execute('SELECT COUNT(*) FROM radio_commands').fetchone()[0]==0
add=phone.post('/api/radio/add-station',json={'owner_csrf':csrf,'radio_id':identifier,'code':code});assert add.status_code==202
command=add.get_json()['command_id']
duplicate=phone.post('/api/radio/add-station',json={'owner_csrf':csrf,'radio_id':identifier,'code':code});assert duplicate.get_json()['command_id']==command
assert phone.get('/api/radio/commands/'+command).get_json()['status']=='pending'
assert stranger.get('/api/radio/commands/'+command).status_code==403
assert device.post('/api/radio/poll',json={'radio_id':identifier},headers={'Authorization':'Bearer '+secrets.token_hex(32)}).status_code==401
poll=device.post('/api/radio/poll',json={'radio_id':identifier},headers=headers).get_json()
assert poll['linked'] and poll['command_id']==command and poll['station_code']==code
assert 0<poll['command_expires_in']<=300
assert phone.get('/api/radio/commands/'+command).get_json()['status']=='delivered'
assert device.post('/api/radio/poll',json={'radio_id':identifier},headers=headers).get_json()['command_id']==''
ack=device.post('/api/radio/poll',json={'radio_id':identifier,'ack_id':command,'ack_status':'added'},headers=headers)
assert ack.status_code==200 and phone.get('/api/radio/commands/'+command).get_json()['status']=='added'
device.post('/api/radio/poll',json={'radio_id':identifier,'ack_id':command,'ack_status':'failed'},headers=headers)
assert phone.get('/api/radio/commands/'+command).get_json()['status']=='added' # replay cannot overwrite completed success.
pending=phone.post('/api/radio/add-station',json={'owner_csrf':csrf,'radio_id':identifier,'code':code}).get_json()['command_id']
with radio_link.database() as db:db.execute('UPDATE radio_commands SET expires=? WHERE id=?',(int(time.time())-1,pending))
assert phone.get('/api/radio/commands/'+pending).get_json()['status']=='expired'
assert device.post('/api/radio/link/reset',json={'radio_id':identifier},headers=headers).status_code==200
assert phone.get('/api/radio/linked').get_json()['radios']==[]
assert phone.post('/api/radio/add-station',json={'owner_csrf':csrf,'radio_id':identifier,'code':code}).status_code==403
new_start=device.post('/api/radio/link/start',json={'radio_id':identifier},headers=headers).get_json()
with radio_link.database() as db:db.execute('UPDATE radio_pairs SET expires=?',(int(time.time())-1,))
assert phone.post('/api/radio/link/claim',json={'owner_csrf':csrf,'pair_code':new_start['pair_code']}).status_code==400
assert b'radioAddDialog' in phone.get('/station/'+code).data
assert phone.get('/station/'+code+'/qr.png').status_code==404
# Expiry after code entry still requires a fresh code; a delayed Allow cannot grant access.
with app.app_context(),radio_link.database() as db:
 token=secrets.token_urlsafe(32);expired=secrets.token_hex(16)
 db.execute("INSERT INTO radio_pair_claims VALUES (?,?,?,?,?,'waiting',?)",(expired,identifier,radio_link.digest(token),'1234',int(time.time())-1,int(time.time())-120))
 # Reset only the isolated poll rate counter for this next test scenario.
with __import__('sqlite3').connect(root/'owner_data/security.sqlite3') as db:db.execute("DELETE FROM limits WHERE key LIKE 'radio-poll:%'")
response=device.post('/api/radio/poll',json={'radio_id':identifier,'pair_claim_id':expired,'pair_decision':'approve'},headers=headers).get_json()
assert response['claim_result']=='expired'
with radio_link.database() as db:assert db.execute('SELECT COUNT(*) FROM phone_radios').fetchone()[0]==0
# Explicit denial never creates a grant, and a different radio cannot approve this claim.
with radio_link.database() as db:
 denied=secrets.token_hex(16);db.execute("INSERT INTO radio_pair_claims VALUES (?,?,?,?,?,'waiting',?)",(denied,identifier,radio_link.digest('test-denied-token'),'5678',int(time.time())+120,int(time.time())))
response=device.post('/api/radio/poll',json={'radio_id':identifier,'pair_claim_id':denied,'pair_decision':'deny'},headers=headers).get_json()
assert response['claim_result']=='denied'
with radio_link.database() as db:assert db.execute('SELECT COUNT(*) FROM phone_radios').fetchone()[0]==0
for i in range(6):
 response=stranger.post('/api/radio/link/claim',json={'owner_csrf':other_csrf,'pair_code':'ZZZZZZZZ'},environ_base={'REMOTE_ADDR':'198.51.100.222'})
 assert response.status_code==(429 if i==5 else 400)
rotated=[]
for i in range(13):
 response=device.post('/api/radio/link/start',json={'radio_id':identifier},headers=headers)
 assert response.status_code==200
 rotated.append(response.get_json()['pair_code'])
 assert response.get_json()['expires_in']==300
assert all(a!=b for a,b in zip(rotated,rotated[1:]))
response=stranger.post('/api/radio/link/claim',json={'owner_csrf':other_csrf,'pair_code':rotated[0]},environ_base={'REMOTE_ADDR':'198.51.100.223'})
assert response.status_code==400,'rotated home codes cannot be reused'
import io,zipfile,sqlite3
from backup_restore import validate_backup
with radio_link.database() as db:
 db.execute('INSERT INTO phone_radios VALUES (?,?,?)',(radio_link.digest('restore-test-token'),identifier,int(time.time())+3600))
archive=io.BytesIO()
with zipfile.ZipFile(archive,'w') as z:
 z.writestr('stations.json','{"pending_stations":[],"custom_stations":[]}')
 z.write(root/'owner_data/radio-links.sqlite3','owner_data/radio-links.sqlite3')
archive.seek(0);stage=root/'restore-stage';stage.mkdir()
names=validate_backup(archive,stage)
with sqlite3.connect(stage/'owner_data/radio-links.sqlite3') as db:
 assert db.execute('SELECT COUNT(*) FROM radios').fetchone()[0]==1
 for table in ('phone_radios','radio_pairs','radio_pair_claims','radio_commands'):assert db.execute('SELECT COUNT(*) FROM '+table).fetchone()[0]==0
with radio_link.database() as db:assert db.execute('SELECT COUNT(*) FROM phone_radios').fetchone()[0]==1
print('PASS: private device credentials, physical one-use expiring pair code, CSRF and stranger blocking, duplicate requests, authenticated polling, confirmation only after save acknowledgement, timeout and unlink revocation. No radio or email contacted.')
