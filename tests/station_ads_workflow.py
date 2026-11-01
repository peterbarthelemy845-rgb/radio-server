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
assert public.get('/station/ads').status_code==401
assert public.get('/local-ads-demo').status_code==200
assert b'$0' in client.get('/station/ads').data
def picture():
    out=io.BytesIO();Image.new('RGB',(120,60),'blue').save(out,format='PNG');out.seek(0);return out
def upload(**changes):
    data=dict(owner_csrf='test-csrf',brand='Community Bakery',message='Fresh bread every morning',phone='555-0100',rights='on',image=(picture(),'image.png'))
    data.update(changes)
    return client.post('/station/ads',data=data)
def rows():
    with app.app_context(),owners.database() as db:return [dict(r) for r in db.execute('SELECT * FROM local_ads ORDER BY rowid')]
with patch('automatic_screening.assess',return_value={'status':'passed','reasons':['Passed']}):
    result=upload(owner_csrf='bad');assert result.status_code==400
    result=upload();assert result.status_code==302,(result.status_code,result.data[:200])
row=rows()[0];identifier=row['id'];assert row['review']=='approved' and not row['enabled']
image='/station/ads/'+identifier+'/image'
assert client.get(image).status_code==200 and stranger.get(image).status_code==404 and public.get(image).status_code==401
assert public.get('/static/wallpapers/'+row['image']).status_code==404
assert 'no-store' in client.get(image).headers['Cache-Control']
action='/station/ads/'+identifier+'/start'
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
row=rows()[0]
assert client.post('/station/ads/'+identifier+'/pause',data={'owner_csrf':'test-csrf','revision':station_ads.revision(row)}).status_code==302
assert device.get(ad['pixels_path'],headers=headers).status_code==404
row=rows()[0]
assert client.post('/station/ads/'+identifier+'/schedule',data={'owner_csrf':'test-csrf','revision':station_ads.revision(row),'start_date':row['start_date'],'end_date':row['end_date']}).status_code==302
assert rows()[0]['revision']==row['revision']+1

with patch('automatic_screening.assess',return_value={'status':'review','reasons':['Needs artwork review']}):assert upload().status_code==302
flagged=rows()[1]
assert client.post('/station/ads/'+flagged['id']+'/start',data={'owner_csrf':'test-csrf','revision':station_ads.revision(flagged)}).status_code==400
admin=app.test_client()
with app.app_context(),admin.session_transaction() as s:admin_security.new_session(s,'full');s['owner_csrf']='admin-csrf'
assert admin.get('/admin/local-ads').status_code==200
junior=app.test_client()
with app.app_context(),junior.session_transaction() as s:admin_security.new_session(s,'junior');s['owner_csrf']='admin-csrf'
assert junior.get('/admin/local-ads').status_code==403
assert admin.post('/admin/local-ads/'+flagged['id']+'/approve',data={'owner_csrf':'admin-csrf','revision':'stale'}).status_code==409
result=admin.post('/admin/local-ads/'+flagged['id']+'/approve',data={'owner_csrf':'admin-csrf','revision':station_ads.revision(flagged)})
assert result.status_code==302,result.data
assert rows()[1]['review']=='approved' and rows()[1]['enabled']==0
assert admin.post('/admin/local-ads',data={'owner_csrf':'admin-csrf'}).status_code==302
row=rows()[0]
assert client.post('/station/ads/'+identifier+'/delete',data={'owner_csrf':'test-csrf','revision':station_ads.revision(row)}).status_code==302
assert client.get(image).status_code==404
assert upload(image=(io.BytesIO(b'<svg/>'),'fake.png')).status_code==400
with client.session_transaction() as s:s['station_edit_id']=-1
assert client.get('/station/ads').status_code==401
assert client.post(action,data={'owner_csrf':'test-csrf'}).status_code==401
start,end,first,last=station_ads.schedule('2026-11-01','2026-11-01');assert end-start==25*3600
assert not public.get('/local-ads-demo').data.count(b'data-cf-beacon=')
print('PASS: free plan, mailbox-scoped uploads, CSRF, private artwork, approval before start, device authentication, bounded pixels, idempotent displays, cooldown, pause/delete, full-admin review, stale-action rejection, expired grants and DST schedules. No real mail, devices or AI calls.')
