import tempfile,unittest,os,re,time,hashlib
from pathlib import Path
from unittest.mock import patch

class SecuritySharingTests(unittest.TestCase):
 def test_security_sharing_workflow(self):
  with tempfile.TemporaryDirectory(prefix='radio-security-',dir=os.environ.get('RADIO_TEST_TMP')) as temp,patch.dict(os.environ,{'RADIO_DATA_DIR':temp,'ADMIN_SECRET_KEY':'isolated-security-tests-not-production','RADIO_AUTO_BACKUP':'0','SESSION_COOKIE_SECURE':'false'}):
   runtime=Path(temp);(runtime/'owner_data').mkdir();(runtime/'static/wallpapers').mkdir(parents=True)
   (runtime/'config.json').write_text('{}',encoding='utf-8');(runtime/'stations.json').write_text('{"pending_stations":[],"custom_stations":[]}',encoding='utf-8')
   import app as radio
   import station_owners as owners, safe_http,station_sharing as sharing,admin_security,pyotp
   app=radio.app;app.testing=True;app.config['MAIL_WORKER_DISABLED']=True;client=app.test_client()
   # Public landing pages expose active metadata and offer secure phone linking.
   state=client.get('/api/state').get_json();code=state['library_stations'][0]['listener_code']
   page=client.get('/station/'+code);assert page.status_code==200
   assert b'og:image' in page.data and b'radio-add.js' in page.data and ('/station/'+code).encode() in page.data
   assert b'owner@example.com' not in page.data and b'<audio' not in page.data
   assert client.get('/station/999999').status_code==404
   with patch.object(radio,'build_state',return_value={'library_stations':[]}):
    assert client.get('/station/'+code).status_code==404
    assert client.get('/station/'+code+'/qr.png').status_code==404
   assert client.get('/station/'+code+'/qr.png?download=1').status_code==404
   assert b'radioAddDialog' in page.data and b'Download QR' not in page.data
   assert b'<dialog' not in page.data and b'Choose Yes' not in page.data and b'Connect your phone once' not in page.data
   assert b'Find it at the top of your radio screen.' in page.data
   assert client.get('/api/station-availability/'+code).get_json()['state']=='unchecked'
   with app.app_context(),patch.object(sharing,'probe',return_value='reachable') as probe:
    assert sharing.check_one(radio);probe.assert_called_once()
   assert client.get('/api/station-availability/'+code).get_json()['state']=='reachable'
   assert client.get('/api/state').get_json()['library_stations'][0]['availability']['checked_at']
   with app.app_context(),patch.object(sharing,'probe') as probe:
    assert not sharing.check_one(radio);probe.assert_not_called()
   assert sharing.status_for('https://changed.example/live')['state']=='unchecked'
   with sharing.database() as db:db.execute('UPDATE availability SET checked=?',(int(time.time())-3700,))
   assert client.get('/api/station-availability/'+code).get_json()['state']=='stale'
   with patch.object(sharing,'fetch_public',return_value=(403,'text/html',b'blocked','https://public.example')):assert sharing.probe('https://public.example')=='unknown'
   with patch.object(sharing,'fetch_public',return_value=(200,'text/html',b'<html>','https://public.example')):assert sharing.probe('https://public.example')=='unknown'
   with patch.object(sharing,'fetch_public',return_value=(200,'audio/mpeg',b'ID3abc','https://public.example')):assert sharing.probe('https://public.example')=='reachable'
   
   # Every request uses the validated IP and original TLS hostname; redirected private targets fail closed.
   public=[(2,1,6,'',('93.184.216.34',443))];private=[(2,1,6,'',('127.0.0.1',443))]
   for ip in ('127.0.0.1','10.1.1.1','169.254.169.254','::1','::ffff:127.0.0.1'):
    with patch.object(safe_http.socket,'getaddrinfo',return_value=[(2,1,6,'',(ip,443))]):
     try:safe_http.destination('https://blocked.example');raise AssertionError('private address allowed')
     except safe_http.UnsafeAddress:pass
   class Response:
    status=200;headers={'Content-Type':'audio/mpeg'}
    def read(self,n,**kw):return b'A'*n
    def close(self):pass
   class Pool:
    def __init__(self,**options):self.options=options;calls.append(self)
    def urlopen(self,method,path,**options):self.path=path;self.request_options=options;return response
    def close(self):pass
   calls=[];response=Response()
   with patch.object(safe_http.socket,'getaddrinfo',return_value=public),patch.object(safe_http.urllib3,'HTTPSConnectionPool',Pool):
    status,kind,body,url=safe_http.fetch_public('https://stream.example/live',probe=True)
    assert len(body)==256 and calls[0].options['host']=='93.184.216.34'
    assert calls[0].options['server_hostname']=='stream.example' and calls[0].options['assert_hostname']=='stream.example'
    assert calls[0].request_options['headers']['Host']=='stream.example'
   response.status=302;response.headers={'Location':'http://private.example/'};calls=[]
   with patch.object(safe_http.socket,'getaddrinfo',side_effect=[public,private]),patch.object(safe_http.urllib3,'HTTPSConnectionPool',Pool):
    try:safe_http.fetch_public('https://public.example');raise AssertionError('private redirect allowed')
    except safe_http.UnsafeAddress:pass
    assert len(calls)==1
   
   # Nonces are fresh, no inline handler execution, upload/rate errors are readable JSON.
   first=client.get('/');second=client.get('/')
   nonces=re.findall(rb'<script[^>]+nonce="([^"]+)"',first.data)
   assert nonces and len(set(nonces))==1 and nonces[0] not in second.data
   policy=first.headers['Content-Security-Policy'];assert "script-src-attr 'none'" in policy and "'unsafe-inline'" not in policy and "'unsafe-eval'" not in policy
   assert not re.search(rb'\son(?:click|input|submit|change)=',first.data)
   for path in ('/add-station','/admin/login','/terms','/station/'+code):
    page=client.get(path);assert page.status_code==200
    for nonce in re.findall(rb'<script[^>]+nonce="([^"]+)"',page.data):assert nonce.decode() in page.headers['Content-Security-Policy']
   assert client.post('/api/registration/verify',data={'code':'123456'}).get_json()['message']
   
   # Login, DB-authoritative role, idle/absolute expiry, revocation, TOTP replay and cookie replay throttling.
   radio.ADMIN_PASSWORD='test-strong-password';radio.ADMIN_TOTP_SECRET=pyotp.random_base32();radio.JUNIOR_ADMIN_CODE=''
   login=app.test_client();login.get('/admin/login')
   with login.session_transaction() as target:csrf=target['owner_csrf']
   r=login.post('/admin/login',data={'owner_csrf':csrf,'password':radio.ADMIN_PASSWORD});assert r.status_code==200
   with login.session_transaction() as target:csrf=target['owner_csrf']
   otp=pyotp.TOTP(radio.ADMIN_TOTP_SECRET).now()
   r=login.post('/admin/login',data={'owner_csrf':csrf,'action':'verify','code':otp});assert r.status_code==302
   assert login.get('/admin/pending').status_code==200
   assert not admin_security.consume_totp(radio.ADMIN_TOTP_SECRET,otp)
   with login.session_transaction() as target:
    cookie_session=dict(target);target['admin_role']='junior'
   assert login.get('/admin/legal').status_code==200 # role is loaded from server, not cookie.
   with login.session_transaction() as target:key=hashlib.sha256(target['admin_session'].encode()).hexdigest()
   with admin_security.database() as db:db.execute('UPDATE admin_sessions SET last_seen=? WHERE id=?',(int(time.time())-1801,key))
   assert 'expired=1' in login.get('/admin/pending').headers['Location']
   with admin_security.database() as db:db.execute('UPDATE admin_sessions SET created=?,last_seen=? WHERE id=?',(int(time.time())-28801,int(time.time()),key))
   assert not admin_security.valid_session(cookie_session)
   with login.session_transaction() as target:admin_security.new_session(target,'full');snapshot=dict(target)
   login.get('/admin/logout');assert not admin_security.valid_session(snapshot)
   attacker=app.test_client();attacker.get('/admin/login')
   with attacker.session_transaction() as target:
    target.update(admin_password_ok=True,admin_challenge='test-fixed-challenge',admin_challenge_at=int(time.time()));saved=dict(target)
   for i in range(6):
    with attacker.session_transaction() as target:target.clear();target.update(saved)
    r=attacker.post('/admin/login',data={'owner_csrf':saved['owner_csrf'],'action':'verify','code':'000000'},environ_base={'REMOTE_ADDR':'192.0.2.222'})
    assert r.status_code==(429 if i==5 else 200)
   assert b'Too many attempts' in r.data
   print('PASS: share pages, secure link prompt, no QR, unknown/stale/healthy checks and leases; private-address/redirect blocking and pinned TLS; CSP nonces and handler blocking; server-side admin role, expiry, logout, TOTP reuse and persistent cookie-replay limits. No real email or stream requests sent.')
