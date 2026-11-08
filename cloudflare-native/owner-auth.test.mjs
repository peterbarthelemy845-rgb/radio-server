import {test} from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import {authRoutes,processMail,streamUrl} from './owner-auth.mjs';
import {decrypt,human,encrypt} from './security.mjs';
const now=1800000000,host='https://radio-locals-native.example';
const png=Uint8Array.from(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Zl1sAAAAASUVORK5CYII=','base64'));
async function fixture(){
  const sqlite=new DatabaseSync(':memory:');sqlite.exec('PRAGMA foreign_keys = ON');for(const name of ['0001_core.sql','0005_community.sql','0014_registration_requests.sql','0018_notification_operations.sql'])sqlite.exec(readFileSync(new URL('./migrations/'+name,import.meta.url),'utf8'));
  let batchLock=Promise.resolve(),imageReads=0;
  const DB={sqlite,failBatchAfter:null,prepare(sql){let args=[];const statement=sqlite.prepare(sql);const q={bind(...values){args=values;return q;},async first(){return statement.get(...args)||null;},async all(){return {results:statement.all(...args)};},async run(){return statement.run(...args);},async execute(){return statement.columns().length?{results:statement.all(...args)}:statement.run(...args);}};return q;},
    async batch(queries){const task=async()=>{sqlite.exec('BEGIN');try{const results=[];let completed=0;for(const q of queries){results.push(await q.execute());if(++completed===DB.failBatchAfter)throw new Error('Simulated database write failure');}sqlite.exec('COMMIT');return results;}catch(e){sqlite.exec('ROLLBACK');throw e;}};const result=batchLock.then(task);batchLock=result.catch(()=>{});return result;}};
  const objects=new Map(),mail=[];
  const env={DB,DATA_ENCRYPTION_KEY:'a'.repeat(64),TURNSTILE_SITE_KEY:'test',TURNSTILE_SECRET_KEY:'private-test',
    MEDIA:{async put(key,data,meta){objects.set(key,{data,meta});},async get(key){const o=objects.get(key);return o?{body:o.data,customMetadata:o.meta.customMetadata}:null;}},
    IMAGES:{async info(){imageReads++;return {width:1,height:1};},input(){return {transform(){return {async output(){return {response:()=>new Response(png)};}};}};}},
    EMAIL:{async send(message){mail.push(message);return {messageId:'test'};}}};
  const response=await authRoutes(new Request(host+'/api/session'),env,now);
  const state=await response.json(),cookie=response.headers.get('set-cookie').split(';')[0];
  async function post(path,body,changes={},time=now){return authRoutes(new Request(host+path,{method:'POST',headers:{Origin:host,Cookie:cookie,'Content-Type':'application/json','X-CSRF-Token':state.csrf,...changes},body:JSON.stringify(body)}),env,time,{human:async()=>{}});}
  const registration={request_id:'1'.repeat(32),name:'Test station',email:'owner@example.com',stream_url:'https://example.com/live',bio:'Test bio',rights_confirmed:true,agreement_version:state.agreement_version,artwork:{name:'logo.png',base64:Buffer.from(png).toString('base64')}};
  return {env,sqlite,state,cookie,post,registration,mail,objects,imageReads:()=>imageReads};
}
async function registered(){const f=await fixture();const response=await f.post('/api/owner/register',f.registration);f.result=await response.json();
  const job=f.sqlite.prepare('SELECT * FROM mail_outbox').get();f.code=JSON.parse(await decrypt(f.env,job.encrypted_payload)).text.match(/code is (\d{6})/)[1];return f;}
async function ownerLoginChallenge(f,headers={}){const result=await(await f.post('/api/owner/login',{email:f.registration.email,code:'10'},headers)).json(),job=f.sqlite.prepare('SELECT encrypted_payload FROM mail_outbox ORDER BY rowid DESC LIMIT 1').get();return {...result,code:JSON.parse(await decrypt(f.env,job.encrypted_payload)).text.match(/code is (\d{6})/)[1]};}
function pauseOwnerBatch(f){const batch=f.env.DB.batch;let release,arrived,paused=false;const reached=new Promise(resolve=>{arrived=resolve;}),waiting=new Promise(resolve=>{release=resolve;});f.env.DB.batch=async queries=>{if(!paused){paused=true;arrived();await waiting;}return batch(queries);};return {reached,release};}
test('fresh session uses secure host-only cookie; absent server key fails closed',async()=>{
  const f=await fixture();assert.match(f.cookie,/^__Host-rl_session=/);assert.equal(f.state.csrf.length,64);
  await assert.rejects(authRoutes(new Request(host+'/api/session'),{...f.env,DATA_ENCRYPTION_KEY:''},now),e=>e.status===503);
});
test('cross-origin and missing CSRF cannot create stations',async()=>{
  const f=await fixture();await assert.rejects(f.post('/api/owner/register',f.registration,{Origin:'https://attacker.example'}),e=>e.status===403);
  await assert.rejects(f.post('/api/owner/register',f.registration,{'X-CSRF-Token':''}),e=>e.status===403);
  assert.equal(f.sqlite.prepare('SELECT count(*) n FROM stations').get().n,0);
});
test('registration sanitizes private artwork, encrypts email and stays unpublished',async()=>{
  const f=await registered();assert.equal(f.result.status,'ok');assert.equal(f.sqlite.prepare('SELECT status FROM stations').get().status,'pending_email');
  const obj=[...f.objects.values()][0];assert.equal(obj.meta.customMetadata.sanitizer_version,'1');
  const job=f.sqlite.prepare('SELECT * FROM mail_outbox').get();assert.ok(!job.encrypted_payload.includes(f.code));
  assert.equal(f.sqlite.prepare('SELECT count(*) n FROM agreement_acceptances').get().n,1);
  await processMail(f.env,now);assert.equal(f.mail.length,1);assert.equal(f.mail[0].from,'info@radiolocals.com');
  assert.equal(f.sqlite.prepare('SELECT encrypted_payload FROM mail_outbox').get().encrypted_payload,'');
});

test('a lost signup response can be retried without another station, image, agreement or email',async()=>{
  const f=await registered(),result=await(await f.post('/api/owner/register',f.registration)).json();
  assert.equal(result.verification_id,f.result.verification_id);assert.equal(f.imageReads(),1);assert.equal(f.objects.size,1);
  for(const table of ['stations','agreement_acceptances','email_verifications','mail_outbox'])assert.equal(f.sqlite.prepare('SELECT count(*) n FROM '+table).get().n,1,table);
  assert.equal(f.sqlite.prepare('SELECT consumed_at FROM email_verifications').get().consumed_at,null);
  await assert.rejects(f.post('/api/owner/register',{...f.registration,bio:'Changed under same retry key'}),e=>e.status===409);
  await assert.rejects(f.post('/api/owner/register',{...f.registration,request_id:'not-a-request-id'}),e=>e.status===400);
  assert.equal(f.imageReads(),1);
});

test('older open forms without a request ID retry safely and remain isolated from another browser',async()=>{
  const f=await fixture(),legacy={...f.registration};delete legacy.request_id;
  const first=await(await f.post('/api/owner/register',legacy)).json(),again=await(await f.post('/api/owner/register',legacy)).json();
  assert.equal(again.verification_id,first.verification_id);assert.equal(f.imageReads(),1);assert.equal(f.objects.size,1);
  for(const table of ['stations','agreement_acceptances','email_verifications','mail_outbox'])assert.equal(f.sqlite.prepare('SELECT count(*) n FROM '+table).get().n,1,table);
  const response=await authRoutes(new Request(host+'/api/session'),f.env,now),state=await response.json(),cookie=response.headers.get('set-cookie').split(';')[0];
  const other=await authRoutes(new Request(host+'/api/owner/register',{method:'POST',headers:{Origin:host,Cookie:cookie,'Content-Type':'application/json','X-CSRF-Token':state.csrf},body:JSON.stringify(legacy)}),f.env,now,{human:async()=>{}});
  assert.notEqual((await other.json()).verification_id,first.verification_id);assert.equal(f.sqlite.prepare('SELECT count(*) n FROM stations').get().n,2);
  for(const request_id of [null,'',1,'not-a-request-id'])await assert.rejects(f.post('/api/owner/register',{...legacy,request_id}),e=>e.status===400);
});

test('signup retry keys are session-bound and concurrent submissions cannot duplicate work',async()=>{
  const f=await fixture(),results=await Promise.allSettled([f.post('/api/owner/register',f.registration),f.post('/api/owner/register',f.registration)]);
  assert.equal(results.filter(result=>result.status==='fulfilled').length,1);assert.equal(results.find(result=>result.status==='rejected').reason.status,409);
  assert.equal(f.imageReads(),1);assert.equal(f.sqlite.prepare('SELECT count(*) n FROM stations').get().n,1);
  const original=(await results.find(result=>result.status==='fulfilled').value.json()).verification_id;
  const response=await authRoutes(new Request(host+'/api/session'),f.env,now),state=await response.json(),cookie=response.headers.get('set-cookie').split(';')[0];
  const other=await authRoutes(new Request(host+'/api/owner/register',{method:'POST',headers:{Origin:host,Cookie:cookie,'Content-Type':'application/json','X-CSRF-Token':state.csrf},body:JSON.stringify(f.registration)}),f.env,now,{human:async()=>{}});
  assert.notEqual((await other.json()).verification_id,original);assert.equal(f.sqlite.prepare('SELECT count(*) n FROM stations').get().n,2);
});

test('signup database failure rolls back station and email creation; retry reuses the same private image object',async()=>{
  const f=await fixture();f.env.DB.failBatchAfter=3;
  await assert.rejects(f.post('/api/owner/register',f.registration),/Simulated database write failure/);
  for(const table of ['stations','agreement_acceptances','email_verifications','mail_outbox'])assert.equal(f.sqlite.prepare('SELECT count(*) n FROM '+table).get().n,0,table);
  assert.equal(f.sqlite.prepare('SELECT lease_until FROM registration_requests').get().lease_until,0);assert.equal(f.objects.size,1);
  f.env.DB.failBatchAfter=null;const result=await(await f.post('/api/owner/register',f.registration)).json();assert.match(result.verification_id,/^[a-f0-9]{32}$/);
  assert.equal(f.objects.size,1);assert.equal(f.sqlite.prepare('SELECT count(*) n FROM stations').get().n,1);
});

test('a newer registration for another station does not invalidate a pending emailed signup code',async()=>{
  const f=await registered();await f.post('/api/owner/register',{...f.registration,request_id:'2'.repeat(32),name:'Other station'});
  assert.equal(f.sqlite.prepare('SELECT consumed_at FROM email_verifications WHERE id=?').get(f.result.verification_id).consumed_at,null);
  assert.equal((await(await f.post('/api/owner/verify',{verification_id:f.result.verification_id,code:f.code})).json()).registration_completed,true);
});

test('signup resend updates its cached retry challenge without creating or rescanning the station',async()=>{
  const f=await registered();const resent=await(await f.post('/api/owner/resend',{verification_id:f.result.verification_id},{},now+61)).json();
  const retried=await(await f.post('/api/owner/register',f.registration,{},now+62)).json();assert.equal(retried.verification_id,resent.verification_id);assert.equal(f.imageReads(),1);
  assert.equal(f.sqlite.prepare('SELECT count(*) n FROM stations').get().n,1);assert.equal(f.sqlite.prepare('SELECT count(*) n FROM mail_outbox').get().n,2);
});

test('station name limits match the radios UTF-8 byte capacity',async()=>{
  const f=await fixture();await assert.rejects(f.post('/api/owner/register',{...f.registration,name:'é'.repeat(49)}),e=>e.status===400);
  for(const name of ['Good\0hidden','Good\nradio','Good\x7fradio'])await assert.rejects(f.post('/api/owner/register',{...f.registration,name}),e=>e.status===400);
  const result=await(await f.post('/api/owner/register',{...f.registration,name:'é'.repeat(48)})).json();assert.equal(result.status,'ok');
});

test('signup retry retention expires without deleting its referenced station or browser session',async()=>{
  const {operationsFixture}=await import('./operations-fixture.mjs'),{cleanup}=await import('./worker.mjs'),f=await operationsFixture();
  assert.equal(f.sqlite.prepare('PRAGMA foreign_keys').get().foreign_keys,1);
  const sessionHash=f.sqlite.prepare('SELECT token_hash FROM sessions').get().token_hash;
  f.sqlite.prepare("INSERT INTO registration_requests(session_hash,request_id,payload_hash,lease_token,lease_until,created_at,expires) VALUES (?,?,?,?,?,?,?)")
    .run(sessionHash,'1'.repeat(32),'payload','lease',0,f.now,f.now+10);
  await cleanup(f.env,f.now);assert.equal(f.sqlite.prepare('SELECT count(*) n FROM registration_requests').get().n,1);
  await cleanup(f.env,f.now+10);assert.equal(f.sqlite.prepare('SELECT count(*) n FROM registration_requests').get().n,0);
  assert.equal(f.sqlite.prepare('SELECT count(*) n FROM sessions WHERE token_hash=?').get(sessionHash).n,1);assert.equal(f.sqlite.prepare('SELECT count(*) n FROM stations WHERE code=?').get(f.station).n,1);
  const own=await registered();await assert.rejects(own.post('/api/owner/register',own.registration,{},now+86400),e=>e.status===409);
});
test('email verification grants only the matching station and cannot replay',async()=>{
  const f=await registered();const body={verification_id:f.result.verification_id,code:f.code};
  const result=await (await f.post('/api/owner/verify',body)).json();assert.equal(result.station_code,'10');
  assert.equal(f.sqlite.prepare('SELECT status FROM stations').get().status,'pending_review');
  assert.equal(f.sqlite.prepare('SELECT owner_station FROM sessions').get().owner_station,10);
  await assert.rejects(f.post('/api/owner/verify',body),e=>e.status===400);
});

test('verification failure rolls back code consumption and ownership so the same correct code can be retried',async()=>{
  const f=await registered(),body={verification_id:f.result.verification_id,code:f.code};f.env.DB.failBatchAfter=2;
  await assert.rejects(f.post('/api/owner/verify',body),/Simulated database write failure/);
  assert.equal(f.sqlite.prepare('SELECT consumed_at FROM email_verifications').get().consumed_at,null);assert.equal(f.sqlite.prepare('SELECT owner_station FROM sessions').get().owner_station,null);
  assert.equal(f.sqlite.prepare('SELECT email_verified_at FROM stations').get().email_verified_at,null);
  f.env.DB.failBatchAfter=null;assert.equal((await(await f.post('/api/owner/verify',body)).json()).registration_completed,true);
});

test('concurrent correct email-code submissions grant ownership once and cannot replay the consumed code',async()=>{
  const f=await registered(),body={verification_id:f.result.verification_id,code:f.code};const results=await Promise.allSettled([f.post('/api/owner/verify',body),f.post('/api/owner/verify',body)]);
  assert.equal(results.filter(result=>result.status==='fulfilled').length,1);assert.equal(results.find(result=>result.status==='rejected').reason.status,400);
  assert.equal(f.sqlite.prepare('SELECT owner_station FROM sessions').get().owner_station,10);assert.ok(f.sqlite.prepare('SELECT consumed_at FROM email_verifications').get().consumed_at);
});

test('a suspended or deleted station cannot be claimed with a previously issued signup code',async()=>{
  for(const status of ['suspended','deleted']){
    const f=await registered();f.sqlite.prepare('UPDATE stations SET status=?').run(status);
    await assert.rejects(f.post('/api/owner/verify',{verification_id:f.result.verification_id,code:f.code}),e=>e.status===400);
    assert.equal(f.sqlite.prepare('SELECT owner_station FROM sessions').get().owner_station,null);
    assert.equal(f.sqlite.prepare('SELECT consumed_at FROM email_verifications').get().consumed_at,null);
  }
});
test('five wrong guesses lock verification even when the next code is correct',async()=>{
  const f=await registered();const wrong=f.code==='000000'?'111111':'000000';
  for(let n=0;n<5;n++)await assert.rejects(f.post('/api/owner/verify',{verification_id:f.result.verification_id,code:wrong}),e=>e.status===400);
  await assert.rejects(f.post('/api/owner/verify',{verification_id:f.result.verification_id,code:f.code}),e=>e.status===400);
  assert.equal(f.sqlite.prepare('SELECT owner_station FROM sessions').get().owner_station,null);
});
test('expired codes and another browser session cannot claim ownership',async()=>{
  const f=await registered();
  await assert.rejects(f.post('/api/owner/verify',{verification_id:f.result.verification_id,code:f.code},{Cookie:'__Host-rl_session='+'f'.repeat(64)}),e=>e.status===401);
  f.sqlite.prepare('UPDATE email_verifications SET expires=?').run(now-1);
  await assert.rejects(f.post('/api/owner/verify',{verification_id:f.result.verification_id,code:f.code}),e=>e.status===400);
});
test('owner cannot edit by supplying another station code and logout removes editing grant',async()=>{
  const f=await registered();await f.post('/api/owner/verify',{verification_id:f.result.verification_id,code:f.code});
  f.sqlite.prepare('INSERT INTO stations(name,stream_url,contact_email,status,created_at,updated_at) VALUES (?,?,?,?,?,?)').run('Other','https://example.net/live','other@example.com','published',now,now);
  await f.post('/api/owner/station',{code:11,stream_url:'https://example.org/updated',bio:'Changed'});
  assert.equal(f.sqlite.prepare('SELECT bio FROM stations WHERE code=11').get().bio,'');
  assert.equal(f.sqlite.prepare('SELECT bio FROM stations WHERE code=10').get().bio,'Changed');
  await f.post('/api/owner/logout',{});
  await assert.rejects(f.post('/api/owner/station',{stream_url:'https://example.com/live'}),e=>e.status===401);
});
test('logout prevents an older correct registration or login verification from restoring owner access',async()=>{
 for(const kind of ['registration','login']){const f=await registered();let challenge={...f.result,code:f.code};if(kind==='login'){await f.post('/api/owner/verify',challenge);challenge=await ownerLoginChallenge(f);}
  const expiry=f.sqlite.prepare('SELECT expires FROM sessions').get().expires,barrier=pauseOwnerBatch(f),pending=f.post('/api/owner/verify',{verification_id:challenge.verification_id,code:challenge.code});await barrier.reached;await f.post('/api/owner/logout',{});barrier.release();await assert.rejects(pending,e=>e.status===400);
  assert.equal(f.sqlite.prepare('SELECT owner_station FROM sessions').get().owner_station,null);assert.equal(f.sqlite.prepare('SELECT expires FROM sessions').get().expires,expiry);assert.equal(f.sqlite.prepare('SELECT count(*) n FROM email_verifications WHERE consumed_at IS NULL').get().n,0);
  if(kind==='registration')await assert.rejects(f.post('/api/owner/register',f.registration),e=>e.status===409&&/cancelled/.test(e.message));
  else{const fresh=await ownerLoginChallenge(f);await f.post('/api/owner/verify',{verification_id:fresh.verification_id,code:fresh.code});assert.equal(f.sqlite.prepare('SELECT owner_station FROM sessions').get().owner_station,10);}
 }
});
test('owner logout revokes only its own pending proofs and rolls back completely on failure',async()=>{const f=await registered();await f.post('/api/owner/verify',{verification_id:f.result.verification_id,code:f.code});const own=await ownerLoginChallenge(f);
 const otherResponse=await authRoutes(new Request(host+'/api/session'),f.env,now),otherState=await otherResponse.json(),otherCookie=otherResponse.headers.get('set-cookie').split(';')[0],other=await ownerLoginChallenge(f,{Cookie:otherCookie,'X-CSRF-Token':otherState.csrf});
 f.env.DB.failBatchAfter=1;await assert.rejects(f.post('/api/owner/logout',{}),/Simulated database/);assert.equal(f.sqlite.prepare('SELECT owner_station FROM sessions WHERE owner_station IS NOT NULL').get().owner_station,10);assert.equal(f.sqlite.prepare('SELECT consumed_at FROM email_verifications WHERE id=?').get(own.verification_id).consumed_at,null);
 f.env.DB.failBatchAfter=null;await f.post('/api/owner/logout',{});assert.notEqual(f.sqlite.prepare('SELECT consumed_at FROM email_verifications WHERE id=?').get(own.verification_id).consumed_at,null);assert.equal(f.sqlite.prepare('SELECT consumed_at FROM email_verifications WHERE id=?').get(other.verification_id).consumed_at,null);
});
test('mail failures retry with a lease and never expose plaintext in stored errors',async()=>{
  const f=await registered();f.env.EMAIL.send=async()=>{throw new Error('provider secret body');};
  await processMail(f.env,now);const job=f.sqlite.prepare('SELECT * FROM mail_outbox').get();
  assert.equal(job.state,'pending');assert.equal(job.attempts,1);assert.equal(job.due,now+15);assert.equal(job.lease,0);
  await processMail(f.env,now);assert.equal(f.sqlite.prepare('SELECT attempts FROM mail_outbox').get().attempts,1);
});
test('an exhausted expired mail lease becomes failed while active leases remain untouched and fresh mail can proceed',async()=>{const f=await fixture(),payload=await encrypt(f.env,JSON.stringify({text:'Private message'})),insert=f.sqlite.prepare('INSERT INTO mail_outbox(id,recipient,subject,encrypted_payload,state,attempts,due,expires,lease) VALUES (?,?,?,?,?,?,?,?,?)');
 insert.run('dead-final-attempt','listener@example.com','Expired final attempt',payload,'sending',5,now-120,now+86400,now-1);insert.run('active-final-attempt','listener@example.com','Still active',payload,'sending',5,now-120,now+86400,now+30);insert.run('fresh','listener@example.com','Fresh mail',payload,'pending',0,now,now+86400,0);
 await processMail(f.env,now);const dead=f.sqlite.prepare('SELECT * FROM mail_outbox WHERE id=?').get('dead-final-attempt'),active=f.sqlite.prepare('SELECT * FROM mail_outbox WHERE id=?').get('active-final-attempt');assert.equal(dead.state,'failed');assert.equal(dead.attempts,5);assert.equal(dead.lease,0);assert.equal(dead.encrypted_payload,'');assert.equal(active.state,'sending');assert.equal(active.encrypted_payload,payload);assert.equal(active.lease,now+30);assert.deepEqual(f.mail.map(message=>message.subject),['Fresh mail']);
 await processMail(f.env,now+31);assert.equal(f.sqlite.prepare('SELECT state FROM mail_outbox WHERE id=?').get('active-final-attempt').state,'failed');assert.equal(f.mail.length,1);
});
test('a fifth provider failure clears private queued content and never sends a sixth attempt',async()=>{const f=await registered();let sends=0;f.env.EMAIL.send=async()=>{sends++;throw Error('temporary provider failure');};f.sqlite.exec('UPDATE mail_outbox SET attempts=4');await processMail(f.env,now);const job=f.sqlite.prepare('SELECT * FROM mail_outbox').get();assert.equal(job.state,'failed');assert.equal(job.attempts,5);assert.equal(job.encrypted_payload,'');assert.equal(job.lease,0);await processMail(f.env,now+600);assert.equal(sends,1);assert.equal(f.sqlite.prepare('SELECT attempts FROM mail_outbox').get().attempts,5);
});
test('artwork extensions, oversized files and local stream addresses are rejected',async()=>{
  const f=await fixture();await assert.rejects(f.post('/api/owner/register',{...f.registration,artwork:{name:'evil.svg',base64:Buffer.from(png).toString('base64')}}),e=>e.status===400);
  for(const url of ['http://127.0.0.1/x','http://[::1]/','http://admin:pass@example.com/','file:///etc/passwd','http://printer.local/x'])assert.throws(()=>streamUrl(url));
  assert.equal(streamUrl('https://radio.example.com/live'),'https://radio.example.com/live');
});
test('encryption detects modification and server-side Turnstile requires exact action and host',async()=>{
  const f=await fixture(),sealed=await encrypt(f.env,'secret');
  await assert.rejects(decrypt(f.env,sealed.slice(0,-2)+(sealed.endsWith('00')?'11':'00')));
  const original=globalThis.fetch;
  try{globalThis.fetch=async()=>Response.json({success:true,action:'station-submit',hostname:'attacker.example'});
    await assert.rejects(human(new Request(host),f.env,'test-token','station-submit',now),e=>e.status===400);
    globalThis.fetch=async()=>Response.json({success:true,action:'station-submit',hostname:'radio-locals-native.example'});
    await human(new Request(host),f.env,'test-token','station-submit',now);
  }finally{globalThis.fetch=original;}
});
test('owner removal requires confirmation and hides only the signed-in station',async()=>{
 const f=await registered();await f.post('/api/owner/verify',{verification_id:f.result.verification_id,code:f.code});
 const own=f.sqlite.prepare('SELECT code FROM stations').get().code;
 f.sqlite.prepare("INSERT INTO stations(name,stream_url,contact_email,status,created_at,updated_at) VALUES ('Other','https://example.com/other','other@example.com','published',?,?)").run(now,now);
 const challenge=await(await f.post('/api/owner/delete',{})).json();
 assert.equal(f.sqlite.prepare('SELECT status FROM stations WHERE code=?').get(own).status!=='deleted',true);
 await assert.rejects(f.post('/api/owner/delete',{confirm:true,verification_id:challenge.verification_id,code:'000000'}),e=>e.status===400);
 const mail=f.sqlite.prepare('SELECT encrypted_payload FROM mail_outbox ORDER BY rowid DESC LIMIT 1').get();
 const deletionCode=JSON.parse(await decrypt(f.env,mail.encrypted_payload)).text.match(/code is (\d{6})/)[1];
 await assert.rejects(f.post('/api/owner/verify',{verification_id:challenge.verification_id,code:deletionCode}),e=>e.status===400);
 await f.post('/api/owner/delete',{confirm:true,verification_id:challenge.verification_id,code:deletionCode});
 assert.equal(f.sqlite.prepare('SELECT status FROM stations WHERE code=?').get(own).status,'deleted');
 assert.equal(f.sqlite.prepare('SELECT status FROM stations WHERE code=?').get(own+1).status,'published');
 await assert.rejects(f.post('/api/owner/delete',{confirm:true}),e=>e.status===401);
});

test('a failed deletion transaction leaves the email code and owner grant usable for retry',async()=>{
 const f=await registered();await f.post('/api/owner/verify',{verification_id:f.result.verification_id,code:f.code});
 const challenge=await(await f.post('/api/owner/delete',{})).json();
 const mail=f.sqlite.prepare('SELECT encrypted_payload FROM mail_outbox ORDER BY rowid DESC LIMIT 1').get();
 const code=JSON.parse(await decrypt(f.env,mail.encrypted_payload)).text.match(/code is (\d{6})/)[1];
 f.env.DB.failBatchAfter=2;await assert.rejects(f.post('/api/owner/delete',{confirm:true,verification_id:challenge.verification_id,code}),/Simulated database/);
 assert.equal(f.sqlite.prepare('SELECT consumed_at FROM email_verifications WHERE id=?').get(challenge.verification_id).consumed_at,null);
 assert.notEqual(f.sqlite.prepare('SELECT status FROM stations WHERE code=10').get().status,'deleted');
 assert.equal(f.sqlite.prepare('SELECT owner_station FROM sessions').get().owner_station,10);
 f.env.DB.failBatchAfter=null;await f.post('/api/owner/delete',{confirm:true,verification_id:challenge.verification_id,code});
 assert.equal(f.sqlite.prepare('SELECT status FROM stations WHERE code=10').get().status,'deleted');
});

test('resending a deletion code preserves its deletion-only purpose and invalidates the old code',async()=>{
 const f=await registered();await f.post('/api/owner/verify',{verification_id:f.result.verification_id,code:f.code});
 const first=await(await f.post('/api/owner/delete',{})).json();
 const second=await(await f.post('/api/owner/resend',{verification_id:first.verification_id,turnstile_token:'test'}, {},now+61)).json();
 assert.notEqual(first.verification_id,second.verification_id);
 const challenge=f.sqlite.prepare('SELECT code_hash FROM email_verifications WHERE id=?').get(second.verification_id);assert.match(challenge.code_hash,/^delete:/);
 assert.notEqual(f.sqlite.prepare('SELECT consumed_at FROM email_verifications WHERE id=?').get(first.verification_id).consumed_at,null);
 const mail=f.sqlite.prepare('SELECT subject,encrypted_payload FROM mail_outbox ORDER BY rowid DESC LIMIT 1').get();assert.match(mail.subject,/deletion/);
 const text=JSON.parse(await decrypt(f.env,mail.encrypted_payload)).text,code=text.match(/code is (\d{6})/)[1];assert.match(text,/confirms removal/);
 await assert.rejects(f.post('/api/owner/verify',{verification_id:second.verification_id,code},{},now+61),e=>e.status===400);
 await f.post('/api/owner/delete',{confirm:true,verification_id:second.verification_id,code},{},now+61);
 assert.equal(f.sqlite.prepare('SELECT status FROM stations WHERE code=10').get().status,'deleted');
});

test('station-owner session survives navigation and expires after thirty minutes',async()=>{
 const f=await registered();await f.post('/api/owner/verify',{verification_id:f.result.verification_id,code:f.code});
 const request=()=>new Request(host+'/api/owner/station',{headers:{Cookie:f.cookie}});
 const navigation=await authRoutes(new Request(host+'/api/session',{headers:{Cookie:f.cookie}}),f.env,now+1200);assert.equal((await navigation.json()).owner_station,10);
 const response=await authRoutes(request(),f.env,now+1200);assert.equal(response.status,200);
 assert.equal(f.sqlite.prepare('SELECT owner_expires FROM sessions').get().owner_expires,now+1800);
 await assert.rejects(authRoutes(request(),f.env,now+1800),e=>e.status===401);
});

test('verified owner sees private current cover art even pending review; other sessions cannot fetch it',async()=>{
 const f=await registered();const verified=await (await f.post('/api/owner/verify',{verification_id:f.result.verification_id,code:f.code})).json();assert.equal(verified.registration_completed,true);
 const ownerRequest=path=>new Request(host+path,{headers:{Cookie:f.cookie}});
 const station=await (await authRoutes(ownerRequest('/api/owner/station'),f.env,now)).json();assert.equal(station.station.artwork_url,'/api/owner/artwork');assert.equal(station.station.artwork_key,undefined);
 const art=await authRoutes(ownerRequest('/api/owner/artwork'),f.env,now);assert.equal(art.headers.get('cache-control'),'private, no-store');assert.deepEqual(new Uint8Array(await art.arrayBuffer()),png);
 const other=await authRoutes(new Request(host+'/api/session'),f.env,now);const cookie=other.headers.get('set-cookie').split(';')[0];await assert.rejects(authRoutes(new Request(host+'/api/owner/artwork',{headers:{Cookie:cookie}}),f.env,now),e=>e.status===401);
 await assert.rejects(authRoutes(ownerRequest('/api/owner/artwork'),f.env,now+1800),e=>e.status===401);
});


test('an artwork edit cannot undo a station suspension or removal while image processing is in flight',async()=>{
 for(const status of ['suspended','deleted']){
  const f=await registered();await f.post('/api/owner/verify',{verification_id:f.result.verification_id,code:f.code});
  const station=f.sqlite.prepare('SELECT code,bio,stream_url,artwork_key FROM stations').get();
  f.env.IMAGES.info=async()=>{f.sqlite.prepare('UPDATE stations SET status=?,updated_at=? WHERE code=?').run(status,now+1,station.code);return {width:1,height:1};};
  await assert.rejects(f.post('/api/owner/station',{stream_url:'https://example.com/changed',bio:'A racing edit',artwork:f.registration.artwork}),e=>e.status===409);
  const saved=f.sqlite.prepare('SELECT status,bio,stream_url,artwork_key FROM stations').get();
  assert.equal(saved.status,status);assert.equal(saved.bio,station.bio);assert.equal(saved.stream_url,station.stream_url);assert.equal(saved.artwork_key,station.artwork_key);
 }
});

test('concurrent owner edits do not overwrite a newer saved revision within the same second',async()=>{
 const f=await registered();await f.post('/api/owner/verify',{verification_id:f.result.verification_id,code:f.code});
 let release,started;const waiting=new Promise(resolve=>{release=resolve;}),processing=new Promise(resolve=>{started=resolve;});
 f.env.IMAGES.info=async()=>{started();await waiting;return {width:1,height:1};};
 const first=f.post('/api/owner/station',{stream_url:'https://example.com/older',bio:'Older artwork request',artwork:f.registration.artwork});await processing;
 const newer=await f.post('/api/owner/station',{stream_url:'https://example.com/newer',bio:'Newest request'});assert.equal(newer.status,200);
 release();await assert.rejects(first,e=>e.status===409);
 const saved=f.sqlite.prepare('SELECT stream_url,bio FROM stations').get();assert.equal(saved.stream_url,'https://example.com/newer');assert.equal(saved.bio,'Newest request');
});
