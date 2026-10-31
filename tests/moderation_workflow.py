"""Isolated moderation checks; benign image fixtures, no real email/network."""
import io,os,sys,time,secrets
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
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
 result=submit(name=name,contact_email='bad'+str(index)+'@example.com');assert result.status_code==400 and 'language' in result.json['message'],(name,result.get_json())
assert not radio.load_station_store()['pending_stations']
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
assert edit('sh!t on air').status_code==400
assert radio.load_station_store()['custom_stations'][0]['bio']=='Newer community bio'
assert edit('Another safe bio').status_code==302
current=radio.load_station_store()['custom_stations'][0];rejected_logo=current['pending_edit']['logo_url'];version=review_version(dict(current,**current['pending_edit']))
assert admin.post('/admin/content-edit/'+code+'/reject',data={'owner_csrf':'admin-test','review_version':version}).status_code==302
assert visitor.get(rejected_logo).status_code==404
assert radio.load_station_store()['custom_stations'][0]['bio']=='Newer community bio'
print('PASS: normalized profanity rejection, benign-name boundaries, private unreviewed images and static aliases, forged-admin denial, verification does not publish, admin approval, private owner edits, stale-review rejection and safe rejection rollback. No real email or network used.')
