"""Isolated moderation checks; benign image fixtures, no real email/network."""
import io,os,sys,time,secrets
from unittest.mock import patch
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
import automatic_screening as screening
root=Path(os.environ['RADIO_DATA_DIR']);(root/'owner_data').mkdir();(root/'static/wallpapers').mkdir(parents=True)
(root/'config.json').write_text('{}');(root/'stations.json').write_text('{"pending_stations":[],"custom_stations":[]}')
from PIL import Image
import app as radio,station_owners as owners,registration_verification as verification,admin_security
from content_moderation import text_error,review_version
from mail_delivery import cipher
from station_directory import key_for
from legal_policies import TERMS_VERSION
app=radio.app;app.testing=True;app.config['MAIL_WORKER_DISABLED']=True;app.app_context().push()
visitor=app.test_client();visitor.get('/')
with visitor.session_transaction() as s:csrf=s['owner_csrf']
admin=app.test_client()
with app.app_context(),admin.session_transaction() as s:admin_security.new_session(s,'full');s['owner_csrf']='admin-test'
def picture(color='blue'):
 out=io.BytesIO();Image.new('RGB',(24,24),color).save(out,format='PNG');out.seek(0);return out
fields=dict(name='Family Radio',url='https://station.example/live',contact_email='owner@example.com',location='New York',rights_confirmed='1',terms_version=TERMS_VERSION,owner_csrf=csrf,bio='Community broadcasts')
def submit(**changes):
 data=dict(fields,**changes);data['logo_image']=(picture(),'logo.png')
 return visitor.post('/api/add-station',data=data,headers={'X-Requested-With':'fetch'})
for index,name in enumerate(['FUCK Radio','f.u.c.k FM','ＦＵＣＫ FM','f\u200buck FM','sh!t Radio','p0rn Station','f**k Radio']):
 assert text_error({'Name':name}),name
assert not radio.load_station_store()['pending_stations']
os.environ.pop('STATION_IMAGE_MODERATION',None)
os.environ.pop('OPENAI_API_KEY',None)
for name in ['Essex Community FM','Scunthorpe Radio','Classic Hits','Dick Jones Radio']:assert not text_error({'Name':name}),name
result=submit();assert result.status_code==200,(result.status_code,result.get_json(silent=True),result.data[:300])
station=radio.load_station_store()['pending_stations'][0];logo=station['logo_url'];code=station['listener_code']
for path in [logo,logo.replace('/wallpapers/','/wallpapers//'),logo.replace('/wallpapers/','/other/../wallpapers/')]:assert visitor.get(path,follow_redirects=True).status_code==404,path
assert admin.get(logo).status_code==200
assert 'no-store' in admin.get(logo).headers['Cache-Control']
forged=app.test_client()
with forged.session_transaction() as s:s['admin_logged_in']=True;s['admin_role']='full'
assert forged.get(logo).status_code==404
with visitor.session_transaction() as s:identifier=s['pending_registration']
with app.app_context(),owners.database() as db:row=db.execute('SELECT * FROM registration_verifications WHERE id=?',(identifier,)).fetchone();otp=cipher(app).decrypt(row['payload']).decode()
response=visitor.post('/api/registration/verify',data={'owner_csrf':csrf,'code':otp})
assert response.status_code==200 and response.json['published'] is False
assert visitor.get('/api/device/stations/'+code).status_code==404
station=radio.load_station_store()['pending_stations'][0]
assert admin.post('/admin/approve/0',data={'owner_csrf':'admin-test'}).status_code==409
assert admin.post('/admin/approve/0',data={'owner_csrf':'admin-test','review_version':review_version(station)}).status_code==302
assert visitor.get('/api/device/stations/'+code).status_code==200 and visitor.get(logo).status_code==200
station=radio.load_station_store()['custom_stations'][0]
with app.app_context(),owners.database() as db:
 edit_id=db.execute("INSERT INTO station_edit_links(station_key,email,token_hash,expires,used,state,created) VALUES (?,?,?,?,1,'used',?)",(key_for(station),'owner@example.com',secrets.token_hex(32),int(time.time())+1800,int(time.time()))).lastrowid
with visitor.session_transaction() as s:s['station_edit_id']=edit_id
def edit(bio='Updated community bio',with_image=True):
 data=dict(owner_csrf=csrf,url='https://station.example/new',bio=bio,rights_confirmed='1',terms_version=TERMS_VERSION)
 if with_image:data['logo_image']=(picture('green'),'new.png')
 return visitor.post('/station/edit',data=data)
assert edit().status_code==302
current=radio.load_station_store()['custom_stations'][0];draft=current['pending_edit'];pending_logo=draft['logo_url'];old_version=review_version(dict(current,**draft))
assert current['url']==fields['url'] and current['logo_url']==logo
assert visitor.get(pending_logo).status_code==404 and admin.get(pending_logo).status_code==200
assert b'Updated community bio' not in visitor.get('/api/state').data
assert admin.get('/admin/pending').status_code==200
assert edit('Newer community bio',False).status_code==302
assert admin.post('/admin/content-edit/'+code+'/approve',data={'owner_csrf':'admin-test','review_version':old_version}).status_code==409
current=radio.load_station_store()['custom_stations'][0];version=review_version(dict(current,**current['pending_edit']))
assert admin.post('/admin/content-edit/'+code+'/approve',data={'owner_csrf':'admin-test','review_version':version}).status_code==302
current=radio.load_station_store()['custom_stations'][0]
assert current['url']=='https://station.example/new' and current['bio']=='Newer community bio' and not current.get('pending_edit')
assert visitor.get(pending_logo).status_code==200
assert edit('sh!t on air').status_code==302
assert radio.load_station_store()['custom_stations'][0]['bio']=='Newer community bio'
assert edit('Another safe bio').status_code==302
current=radio.load_station_store()['custom_stations'][0];rejected_logo=current['pending_edit']['logo_url'];version=review_version(dict(current,**current['pending_edit']))
assert admin.post('/admin/content-edit/'+code+'/reject',data={'owner_csrf':'admin-test','review_version':version}).status_code==302
assert visitor.get(rejected_logo).status_code==404
assert radio.load_station_store()['custom_stations'][0]['bio']=='Newer community bio'
print('PASS: normalized profanity flags, benign-name boundaries, private unreviewed images and static aliases, forged-admin denial, verification does not publish, admin approval, private owner edits, stale-review rejection and safe rejection rollback. No real email or network used.')

# A clean bio/stream-only edit reuses approved artwork without another scan.
assert edit('Clean text edit',False).status_code==302
current=radio.load_station_store()['custom_stations'][0]
assert current['bio']=='Clean text edit' and not current.get('pending_edit')
# Mock the provider transport: no real API keys, emails or network calls.
def provider(flagged=False,score=0.001):
 return {'results':[{'flagged':flagged,'category_scores':{'sexual':score}}]}
with patch.dict(os.environ,{'STATION_IMAGE_MODERATION':'openai','OPENAI_API_KEY':'fake-test-only'}):
 with patch.object(screening,'moderation_request',return_value=provider()) as transport:
  assert edit('Clean scanned edit').status_code==302
  assert transport.call_count==1
  sent=transport.call_args.args[0]
  assert sent[1]['image_url']['url'].startswith('data:image/png;base64,')
  assert all('owner@example.com' not in str(item) for item in sent)
  current=radio.load_station_store()['custom_stations'][0]
  assert current['bio']=='Clean scanned edit' and not current.get('pending_edit')
 with patch.object(screening,'moderation_request',return_value=provider(True)):
  assert edit('Flagged artwork').status_code==302
  current=radio.load_station_store()['custom_stations'][0]
  assert current['bio']=='Clean scanned edit' and current['pending_edit']['content_moderation']['status']=='review'
 with patch.object(screening,'moderation_request') as transport:
  assert edit('sh!t on air').status_code==302
  transport.assert_not_called()
 # New clean submission automatically publishes only AFTER verified email.
 with patch.object(screening,'moderation_request',return_value=provider()):
  assert submit(name='Automatic Radio',url='https://automatic.example/live').status_code==200
 with visitor.session_transaction() as session_data:identifier=session_data['pending_registration']
 with owners.database() as db:
  row=db.execute('SELECT * FROM registration_verifications WHERE id=?',(identifier,)).fetchone()
  otp=cipher(app).decrypt(row['payload']).decode()
 assert not any(s['name']=='Automatic Radio' for s in radio.load_station_store()['custom_stations'])
 response=visitor.post('/api/registration/verify',data={'owner_csrf':csrf,'code':otp})
 assert response.status_code==200 and response.json['published'] is True,response.get_json()
 assert any(s['name']=='Automatic Radio' for s in radio.load_station_store()['custom_stations'])
 # Flagged submission verifies ownership but stays private for admin approval.
 with patch.object(screening,'moderation_request',return_value=provider(True)):
  assert submit(name='Flagged Radio',url='https://flagged.example/live').status_code==200
 with visitor.session_transaction() as session_data:identifier=session_data['pending_registration']
 with owners.database() as db:
  row=db.execute('SELECT * FROM registration_verifications WHERE id=?',(identifier,)).fetchone()
  otp=cipher(app).decrypt(row['payload']).decode()
 response=visitor.post('/api/registration/verify',data={'owner_csrf':csrf,'code':otp})
 assert response.status_code==200 and response.json['published'] is False
 flagged=next(s for s in radio.load_station_store()['pending_stations'] if s['name']=='Flagged Radio')
 assert visitor.get(flagged['logo_url']).status_code==404
 assert not any(s['name']=='Flagged Radio' for s in radio.load_station_store()['custom_stations'])
 # An already verified pending station can publish after a clean correction.
 with owners.database() as db:
  flagged_edit_id=db.execute("INSERT INTO station_edit_links(station_key,email,token_hash,expires,used,state,created) VALUES (?,?,?,?,1,'used',?)",(key_for(flagged),'owner@example.com',secrets.token_hex(32),int(time.time())+1800,int(time.time()))).lastrowid
 with visitor.session_transaction() as session_data:session_data['station_edit_id']=flagged_edit_id
 with patch.object(screening,'moderation_request',return_value=provider()):
  assert visitor.post('/station/edit',data=dict(owner_csrf=csrf,url=flagged['url'],bio='Corrected safe bio',rights_confirmed='1',terms_version=TERMS_VERSION)).status_code==302
 assert any(s['name']=='Flagged Radio' for s in radio.load_station_store()['custom_stations'])
 # Scores near the conservative threshold and malformed responses fail closed.
 candidate=dict(current,logo_url=pending_logo,bio='Safe sample')
 for reply in [provider(False,0.06),{},provider(False,float('nan')),provider(False,True),{'results':[]}]:
  with patch.object(screening,'moderation_request',return_value=reply):
   assert screening.assess(candidate,radio.UPLOAD_FOLDER)['status']=='review'
 with patch.object(screening,'moderation_request',side_effect=TimeoutError):
  assert screening.assess(candidate,radio.UPLOAD_FOLDER)['status']=='review'
 with patch.object(screening,'moderation_request',return_value=provider()):
  assessed=screening.assess(candidate,radio.UPLOAD_FOLDER)
  assert assessed['status']=='passed'
  candidate['content_moderation']=assessed
  assert screening.can_publish(candidate)
  candidate['bio']='Changed after scan'
  assert not screening.can_publish(candidate)
 with patch.object(screening,'moderation_request') as transport:
  assert screening.assess(dict(candidate,logo_url='https://private.example/image.png'),radio.UPLOAD_FOLDER)['status']=='review'
  transport.assert_not_called()
print('PASS: conditional automatic publication after verification; approved-art reuse; flagged edits held; inline private PNG scanning; no contact-email disclosure; bad/missing scores, timeouts and remote URLs held; content hash prevents stale pass reuse.')

# Fixed HTTPS transport does not follow a redirect or expose response errors.
from unittest.mock import MagicMock
connection=MagicMock();connection.getresponse.return_value.status=302
connection.getresponse.return_value.read.return_value=b'private error body'
with patch.dict(os.environ,{'OPENAI_API_KEY':'fake-test-only'}),patch.object(screening.http.client,'HTTPSConnection',return_value=connection):
 try:
  screening.moderation_request([{'type':'text','text':'Benign fixture'}])
  raise AssertionError('Redirect was accepted')
 except ValueError as error:
  assert 'private error body' not in str(error)
 connection.request.assert_called_once()
 connection.close.assert_called_once()
print('PASS: flagged new station remains private after verification; fixed HTTPS transport rejects redirects without forwarding credentials.')
