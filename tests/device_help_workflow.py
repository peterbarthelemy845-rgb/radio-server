import os, sys, time
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
root=Path(os.environ['RADIO_DATA_DIR']);(root/'owner_data').mkdir();(root/'static/wallpapers').mkdir(parents=True)
(root/'config.json').write_text('{}');(root/'stations.json').write_text('{"custom_stations":[],"pending_stations":[]}')
import app as radio, admin_security
from device_help import youtube_id
app=radio.app;app.testing=True;app.config['MAIL_WORKER_DISABLED']=True
public=app.test_client();admin=app.test_client();junior=app.test_client()
with public.session_transaction() as s:s['owner_csrf']='test-csrf'
with app.app_context(),admin.session_transaction() as s:admin_security.new_session(s,'full');s['owner_csrf']='test-csrf'
with app.app_context(),junior.session_transaction() as s:admin_security.new_session(s,'junior');s['owner_csrf']='test-csrf'
assert b'href="/device"' in public.get('/').data
assert public.get('/device').status_code==200
assert b'Enter passcode' in public.get('/device').data
assert public.post('/device',data={'passcode':'1214'}).status_code==400
assert public.post('/device',data={'passcode':'0000','owner_csrf':'test-csrf'}).status_code==400
assert public.get('/admin/device-videos').status_code in (302,403)
assert junior.get('/admin/device-videos').status_code==403
assert admin.post('/admin/device-videos',data=dict(owner_csrf='test-csrf',topic='wifi',title='Private Wi-Fi tutorial',description='Test only',url='https://www.youtube.com/watch?v=AbCdEfGhI_1')).status_code==302
locked=public.get('/device');assert b'Private Wi-Fi tutorial' not in locked.data and b'<iframe' not in locked.data
assert 'no-store' in locked.headers['Cache-Control'] and 'noindex' in locked.headers['X-Robots-Tag']
assert public.post('/device',data={'passcode':'1214','owner_csrf':'test-csrf'}).status_code==302
page=public.get('/device');assert b'Private Wi-Fi tutorial' in page.data and b'www.youtube-nocookie.com/embed/AbCdEfGhI_1' in page.data
assert 'frame-src https://www.youtube-nocookie.com' in page.headers['Content-Security-Policy']
assert b'data-cf-beacon=' not in page.data
assert public.post('/device/lock',data={'owner_csrf':'test-csrf'}).status_code==302
assert b'Private Wi-Fi tutorial' not in public.get('/device').data
with public.session_transaction() as s:s['device_help_until']=int(time.time())-1
assert b'Private Wi-Fi tutorial' not in public.get('/device').data
assert youtube_id('https://youtu.be/AbCdEfGhI_1')=='AbCdEfGhI_1'
for url in ('http://youtube.com/watch?v=AbCdEfGhI_1','https://evil.example/watch?v=AbCdEfGhI_1','https://youtube.com@evil.example/watch?v=AbCdEfGhI_1','javascript:alert(1)'):
 assert youtube_id(url) is None
for _ in range(3):assert public.post('/device',data={'passcode':'0000','owner_csrf':'test-csrf'}).status_code==400
assert public.post('/device',data={'passcode':'1214','owner_csrf':'test-csrf'}).status_code==429
assert public.post('/admin/device-videos/1/delete',data={'owner_csrf':'test-csrf'}).status_code in (302,403)
assert admin.post('/admin/device-videos/1/delete',data={'owner_csrf':'test-csrf'}).status_code==302
print('PASS: passcode, CSRF, server-side content gating, expiry, lock, persistent attempt limits, full-admin-only videos, safe embeds and private headers. No external video or email calls.')
