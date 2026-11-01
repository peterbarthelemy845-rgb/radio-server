import io, os, secrets, sys, time
from pathlib import Path
from unittest.mock import patch
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
root=Path(os.environ['RADIO_DATA_DIR']);(root/'owner_data').mkdir();(root/'static/wallpapers').mkdir(parents=True)
(root/'config.json').write_text('{}');(root/'stations.json').write_text('{"custom_stations":[],"pending_stations":[]}')
import app as radio, station_owners as owners, station_ads, admin_security
from station_directory import key_for
from PIL import Image
app=radio.app;app.testing=True;app.config['MAIL_WORKER_DISABLED']=True;app.app_context().push()
station=dict(station_code='test-station-a',listener_code='55',name='Demo Family Radio',url='https://station.example/live',contact_email='owner@example.invalid')
other=dict(station_code='test-station-b',listener_code='56',name='Other Radio',url='https://other.example/live',contact_email='other@example.invalid')
radio.save_station_store(dict(custom_stations=[station,other],pending_stations=[]))

def owner(station):
    client=app.test_client()
    with app.app_context(), owners.database() as db:
        grant=db.execute('INSERT INTO station_edit_links(station_key,email,token_hash,expires,used,state,created) VALUES (?,?,?,?,1,?,?)',
                         (key_for(station),station['contact_email'],secrets.token_hex(32),int(time.time())+1800,'verified',int(time.time()))).lastrowid
    with client.session_transaction() as s:s.update(station_edit_id=grant,owner_csrf='test-csrf')
    return client

client=owner(station);stranger=owner(other);public=app.test_client()
with public.session_transaction() as s:s['owner_csrf']='test-csrf'
assert public.get('/advertise/55').status_code==200
assert public.get('/advertise/99').status_code==404
from turnstile_protection import HOSTS
with patch.dict(os.environ, {'TURNSTILE_SITE_KEY':'test-site','TURNSTILE_SECRET_KEY':'test-secret'}), patch('turnstile_protection.siteverify',return_value={'success':True,'action':'wrong','hostname':'www.radiolavoixdivine.com'}):
 assert public.post('/advertise/55',data={'owner_csrf':'test-csrf','cf-turnstile-response':'fake'}).status_code==400
assert b'/advertise/' in public.get('/').data
assert b'id="localAdForm"' not in client.get('/station/ads').data
assert client.post('/station/ads',data={}).status_code==405
assert public.get('/station/ads').status_code==401
assert public.get('/local-ads-demo').status_code==200
assert b'$0' in client.get('/station/ads').data
def picture():
    out=io.BytesIO();Image.new('RGB',(120,60),'blue').save(out,format='PNG');out.seek(0);return out
def upload(**changes):
    data=dict(owner_csrf='test-csrf',brand='Community Bakery',message='Fresh bread every morning',phone='555-0100',contact_name='Test Business',contact_email='business@example.invalid',rights='on',image=(picture(),'image.png'))
    data.update(changes)
    return public.post('/advertise/55',data=data)
def rows():
    with app.app_context(),owners.database() as db:return [dict(r) for r in db.execute('SELECT * FROM local_ads ORDER BY rowid')]
with patch('automatic_screening.assess',return_value={'status':'passed','reasons':['Passed']}):
    result=upload(owner_csrf='bad');assert result.status_code==400
    result=upload();assert result.status_code==302,(result.status_code,result.data[:200])
row=rows()[0];identifier=row['id'];assert row['review']=='approved' and not row['enabled']
assert row['contact_email']=='business@example.invalid'
assert b'business@example.invalid' not in public.get('/advertise/55').data
assert b'business@example.invalid' in client.get('/station/ads').data
assert public.post('/station/ads/'+identifier+'/approve',data={'owner_csrf':'test-csrf'}).status_code==401
image='/station/ads/'+identifier+'/image'
assert client.get(image).status_code==200 and stranger.get(image).status_code==404 and public.get(image).status_code==401
assert public.get('/static/wallpapers/'+row['image']).status_code==404
assert 'no-store' in client.get(image).headers['Cache-Control']
action='/station/ads/'+identifier+'/approve'
assert stranger.post(action,data={'owner_csrf':'test-csrf','revision':station_ads.revision(row)}).status_code==404
assert client.post(action,data={'owner_csrf':'test-csrf','revision':'stale'}).status_code==409
assert client.post(action,data={'owner_csrf':'test-csrf','revision':station_ads.revision(row)}).status_code==302
device=app.test_client();device_id='a'*32;credential='b'*64;headers={'Authorization':'Bearer '+credential}
assert device.post('/api/radio/link/start',json={'radio_id':device_id,'stable_pair_code':'1234'},headers=headers).status_code==200
assert device.post('/api/radio/ad',json={'radio_id':device_id,'station_code':'55'}).status_code==401
assert device.post('/api/radio/ad',json={'radio_id':device_id,'station_code':'56'},headers=headers).json['ad'] is None
delivery=device.post('/api/radio/ad',json={'radio_id':device_id,'station_code':'55'},headers=headers)
assert delivery.status_code==200,delivery.data
ad=delivery.json['ad'];assert ad['id']==identifier
assert public.get(ad['pixels_path']).status_code==401
pixels=device.get(ad['pixels_path'],headers=headers);assert pixels.status_code==200 and len(pixels.data)==256*76*2
assert b'owner@example' not in delivery.data
ack=dict(radio_id=device_id,receipt=ad['receipt'])
assert public.post('/api/radio/ad/displayed',json=ack).status_code==401
assert device.post('/api/radio/ad/displayed',json=ack,headers=headers).status_code==200
assert device.post('/api/radio/ad/displayed',json=ack,headers=headers).status_code==200
assert rows()[0]['displays']==1
assert device.post('/api/radio/ad',json={'radio_id':device_id,'station_code':'55'},headers=headers).json['ad'] is None
admin=app.test_client()
with app.app_context(),admin.session_transaction() as s:admin_security.new_session(s,'full');s['owner_csrf']='admin-csrf'
row=rows()[0]
assert admin.post('/admin/local-ads/'+identifier+'/pause',data={'owner_csrf':'admin-csrf','revision':station_ads.revision(row)}).status_code==302
assert device.get(ad['pixels_path'],headers=headers).status_code==404
row=rows()[0]
assert client.post('/station/ads/'+identifier+'/schedule',data={'owner_csrf':'test-csrf','revision':station_ads.revision(row),'start_date':row['start_date'],'end_date':row['end_date']}).status_code==404
assert rows()[0]['revision']==row['revision']

with patch('automatic_screening.assess',return_value={'status':'review','reasons':['Needs artwork review']}):assert upload().status_code==302
flagged=rows()[1]
assert client.post('/station/ads/'+flagged['id']+'/approve',data={'owner_csrf':'test-csrf','revision':station_ads.revision(flagged)}).status_code==400

assert admin.get('/admin/local-ads').status_code==200
assert admin.get('/admin/local-ads/main').status_code==200
assert public.get('/admin/local-ads/main').status_code==302
with patch('automatic_screening.assess',return_value={'status':'passed','reasons':['Passed']}):
 with owners.database() as db: main_code=db.execute('SELECT code FROM listener_codes WHERE station_key=?',(key_for(dict(radio.TEST_STREAMS[0],url=radio.MAIN_STREAM_URL)),)).fetchone()[0]
 result=public.post('/advertise/'+main_code,data=dict(owner_csrf='test-csrf',brand='Main station sponsor',message='Community messages',phone='',contact_name='Main Business',contact_email='main@example.invalid',rights='on',image=(picture(),'image.png')))
 assert result.status_code==302,result.data
main=rows()[-1]
assert main['brand']=='Main station sponsor'
assert admin.post('/admin/local-ads/main/'+main['id']+'/approve',data={'owner_csrf':'admin-csrf','revision':station_ads.revision(main)}).status_code==302
assert stranger.get('/station/ads/'+main['id']+'/image').status_code==404

junior=app.test_client()
with app.app_context(),junior.session_transaction() as s:admin_security.new_session(s,'junior');s['owner_csrf']='admin-csrf'
assert junior.get('/admin/local-ads').status_code==403
assert junior.get('/admin/local-ads/main').status_code==403
assert admin.post('/admin/local-ads/'+flagged['id']+'/approve',data={'owner_csrf':'admin-csrf','revision':'stale'}).status_code==409
result=admin.post('/admin/local-ads/'+flagged['id']+'/approve',data={'owner_csrf':'admin-csrf','revision':station_ads.revision(flagged)})
assert result.status_code==302,result.data
assert rows()[1]['review']=='approved' and rows()[1]['enabled']==0
assert admin.post('/admin/local-ads',data={'owner_csrf':'admin-csrf'}).status_code==302
row=rows()[0]
assert client.post('/station/ads/'+identifier+'/delete',data={'owner_csrf':'test-csrf','revision':station_ads.revision(row)}).status_code==302
assert client.get(image).status_code==404
assert not (Path(radio.UPLOAD_FOLDER)/row['image']).exists()
assert upload(image=(io.BytesIO(b'<svg/>'),'fake.png')).status_code==400
with client.session_transaction() as s:s['station_edit_id']=-1
assert client.get('/station/ads').status_code==401
assert client.post(action,data={'owner_csrf':'test-csrf'}).status_code==401
start,end,first,last=station_ads.schedule('2026-11-01','2026-11-01');assert end-start==25*3600
assert not public.get('/local-ads-demo').data.count(b'data-cf-beacon=')
print('PASS: free plan, mailbox-scoped uploads, CSRF, private artwork, approval before start, device authentication, bounded pixels, idempotent displays, cooldown, pause/delete, full-admin review, stale-action rejection, expired grants and DST schedules. No real mail, devices or AI calls.')

# Deleted history must not permanently lock out a station.
with owners.database() as db:
 for number in range(100):
  db.execute("INSERT INTO local_ads(id,station_key,brand,message,phone,image,start_at,end_at,review,reasons,created,deleted) VALUES (?,?,?,?,?,?,?,?,?,?,?,1)",(format(number+1000,'032x'),key_for(other),'Old','Old','','ad_'+format(number+1000,'032x')+'.png',int(time.time()),int(time.time())+300,'approved','[]',int(time.time())))
with patch('automatic_screening.assess',return_value={'status':'passed','reasons':['Passed']}):
 result=public.post('/advertise/56',environ_overrides={'REMOTE_ADDR':'192.0.2.40'},data=dict(owner_csrf='test-csrf',brand='Fresh Business',message='New offer',phone='',contact_name='Business',contact_email='business@example.invalid',rights='on',image=(picture(),'image.png')))
 assert result.status_code==302,result.data
# Failed bot checks are persistently limited before provider work.
with patch.dict(os.environ,{'TURNSTILE_SITE_KEY':'test-site','TURNSTILE_SECRET_KEY':'test-secret'}),patch('turnstile_protection.siteverify',return_value={'success':False}) as verify:
 for _ in range(20):
  assert public.post('/advertise/55',environ_overrides={'REMOTE_ADDR':'192.0.2.41'},data={'owner_csrf':'test-csrf','cf-turnstile-response':'bad'}).status_code==400
 assert public.post('/advertise/55',environ_overrides={'REMOTE_ADDR':'192.0.2.41'},data={'owner_csrf':'test-csrf','cf-turnstile-response':'bad'}).status_code==429
 assert verify.call_count==20
print('PASS: deleted history restores ad capacity, private image cleanup and persistent pre-provider limits. No real scanner or bot-verification calls.')

# Main-station admin cleanup must happen after its request transaction commits.
with owners.database() as db:
 main_latest=dict(db.execute('SELECT * FROM local_ads WHERE id=?',(main['id'],)).fetchone())
assert admin.post('/admin/local-ads/main/'+main['id']+'/delete',data={'owner_csrf':'admin-csrf','revision':station_ads.revision(main_latest)}).status_code==302
with owners.database() as db:
 assert db.execute('SELECT deleted FROM local_ads WHERE id=?',(main['id'],)).fetchone()[0]==1
assert not (Path(radio.UPLOAD_FOLDER)/main['image']).exists()
