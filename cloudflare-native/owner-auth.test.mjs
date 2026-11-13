import {test} from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import {authRoutes,processMail,streamUrl} from './owner-auth.mjs';
import {decrypt,human,encrypt} from './security.mjs';
import {beginStreamCheck,completeStreamCheck} from './stream-verification.mjs';
const now=1800000000,host='https://radio-locals-native.example';
const png=Uint8Array.from(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Zl1sAAAAASUVORK5CYII=','base64'));
async function fixture(){
  const sqlite=new DatabaseSync(':memory:');sqlite.exec('PRAGMA foreign_keys = ON');for(const name of ['0001_core.sql','0005_community.sql','0014_registration_requests.sql','0018_notification_operations.sql','0021_station_edits.sql','0023_station_edit_names.sql','0024_stream_verification.sql','0025_station_metadata.sql'])sqlite.exec(readFileSync(new URL('./migrations/'+name,import.meta.url),'utf8'));
  let batchLock=Promise.resolve(),imageReads=0;
  const DB={sqlite,failBatchAfter:null,prepare(sql){let args=[];const statement=sqlite.prepare(sql);const q={bind(...values){args=values;return q;},async first(){return statement.get(...args)||null;},async all(){return {results:statement.all(...args)};},async run(){return statement.run(...args);},async execute(){return statement.columns().length?{results:statement.all(...args)}:statement.run(...args);}};return q;},
    async batch(queries){const task=async()=>{sqlite.exec('BEGIN');try{const results=[];let completed=0;for(const q of queries){results.push(await q.execute());if(++completed===DB.failBatchAfter)throw new Error('Simulated database write failure');}sqlite.exec('COMMIT');return results;}catch(e){sqlite.exec('ROLLBACK');throw e;}};const result=batchLock.then(task);batchLock=result.catch(()=>{});return result;}};
  const objects=new Map(),mail=[];
  const env={DB,DATA_ENCRYPTION_KEY:'a'.repeat(64),TURNSTILE_SITE_KEY:'test',TURNSTILE_SECRET_KEY:'private-test',
    MEDIA:{async put(key,data,meta){objects.set(key,{data,meta});},async get(key){const o=objects.get(key);return o?{body:o.data,customMetadata:o.meta.customMetadata}:null;},async delete(key){objects.delete(key);}},
    IMAGES:{async info(){imageReads++;return {width:1,height:1};},input(){return {transform(){return {async output(){return {response:()=>new Response(png)};}};}};}},
    EMAIL:{async send(message){mail.push(message);return {messageId:'test'};}}};
  const response=await authRoutes(new Request(host+'/api/session'),env,now);
  const state=await response.json(),cookie=response.headers.get('set-cookie').split(';')[0];
  async function post(path,body,changes={},time=now,deps={human:async()=>{}}){return authRoutes(new Request(host+path,{method:'POST',headers:{Origin:host,Cookie:cookie,'Content-Type':'application/json','X-CSRF-Token':state.csrf,...changes},body:JSON.stringify(body)}),env,time,deps);}
  const registration={request_id:'1'.repeat(32),name:'Test station',email:'owner@example.com',stream_url:'https://example.com/live',bio:'Test bio',rights_confirmed:true,agreement_version:state.agreement_version,artwork:{name:'logo.png',base64:Buffer.from(png).toString('base64')}};
  async function owner(){return (await(await authRoutes(new Request(host+'/api/owner/station',{headers:{Cookie:cookie}}),env,now)).json()).station;}
  async function passed(url=registration.stream_url,hash=sqlite.prepare('SELECT token_hash FROM sessions ORDER BY rowid LIMIT 1').get().token_hash){const id=await beginStreamCheck(env,hash,url,now);await completeStreamCheck(env,hash,url,id,true,now);}
  // General auth tests start after the required successful stream test. Tests
  // for missing, expired, wrong-session and raced proof use a separate fixture.
  await passed();
  return {env,sqlite,state,cookie,post,owner,passed,registration,mail,objects,imageReads:()=>imageReads};
}
async function registered(){const f=await fixture();const response=await f.post('/api/owner/register',f.registration);f.result=await response.json();
  const job=f.sqlite.prepare('SELECT * FROM mail_outbox').get();f.code=JSON.parse(await decrypt(f.env,job.encrypted_payload)).text.match(/code is (\d{6})/)[1];return f;}

test('optional signup metadata is validated, bound to registration retries and retained after email verification',async()=>{
 const f=await fixture();for(const metadata of [{language:'unknown'},{category:null}])await assert.rejects(f.post('/api/owner/register',{...f.registration,...metadata}),error=>error.status===400);assert.equal(f.sqlite.prepare('SELECT count(*) AS n FROM stations').get().n,0);
 const body={...f.registration,language:'ht',category:'christian'};await assert.rejects(f.post('/api/owner/register',{...body,rights_confirmed:false}),error=>error.status===400);const result=await(await f.post('/api/owner/register',body)).json();assert.deepEqual({...f.sqlite.prepare('SELECT language,category FROM stations').get()},{language:'ht',category:'christian'});
 await assert.rejects(f.post('/api/owner/register',{...body,category:'culture'}),error=>error.status===409);const job=f.sqlite.prepare('SELECT * FROM mail_outbox').get(),code=JSON.parse(await decrypt(f.env,job.encrypted_payload)).text.match(/code is (\d{6})/)[1];await f.post('/api/owner/verify',{verification_id:result.verification_id,code});const station=await f.owner();assert.equal(station.language,'ht');assert.equal(station.category,'christian');
});
async function ownerLoginChallenge(f,headers={}){const result=await(await f.post('/api/owner/login',{email:f.registration.email,code:'10'},headers)).json(),job=f.sqlite.prepare('SELECT encrypted_payload FROM mail_outbox ORDER BY rowid DESC LIMIT 1').get();return {...result,code:JSON.parse(await decrypt(f.env,job.encrypted_payload)).text.match(/code is (\d{6})/)[1]};}
function pauseOwnerBatch(f){const batch=f.env.DB.batch;let release,arrived,paused=false;const reached=new Promise(resolve=>{arrived=resolve;}),waiting=new Promise(resolve=>{release=resolve;});f.env.DB.batch=async queries=>{if(!paused){paused=true;arrived();await waiting;}return batch(queries);};return {reached,release};}
test('fresh session uses secure host-only cookie; absent server key fails closed',async()=>{
  const f=await fixture();assert.match(f.cookie,/^__Host-rl_session=/);assert.equal(f.state.csrf.length,64);
  assert.equal(f.state.owner_expires,null);assert.equal(f.state.server_time,now);
  await assert.rejects(authRoutes(new Request(host+'/api/session'),{...f.env,DATA_ENCRYPTION_KEY:''},now),e=>e.status===503);
});

test('owner expiry is an exact non-renewing server deadline on verification, session and editor responses',async()=>{
 const f=await registered(),verified=await(await f.post('/api/owner/verify',{verification_id:f.result.verification_id,code:f.code})).json();assert.equal(verified.owner_expires,now+1800);assert.equal(verified.server_time,now);
 for(const path of ['/api/session','/api/owner/station']){const body=await(await authRoutes(new Request(host+path,{headers:{Cookie:f.cookie}}),f.env,now+700)).json();assert.equal(body.owner_expires,now+1800);assert.equal(body.server_time,now+700);}
 assert.equal(f.sqlite.prepare('SELECT owner_expires FROM sessions').get().owner_expires,now+1800);
 const expired=await(await authRoutes(new Request(host+'/api/session',{headers:{Cookie:f.cookie}}),f.env,now+1800)).json();assert.equal(expired.owner_station,null);assert.equal(expired.owner_expires,null);assert.equal(expired.server_time,now+1800);
});

test('a name-only owner change stays private until review and loaded draft names participate in no-op and stale-save protection',async()=>{
 const f=await registered();await f.post('/api/owner/verify',{verification_id:f.result.verification_id,code:f.code});f.sqlite.exec("UPDATE stations SET status='published'");const before=f.sqlite.prepare('SELECT * FROM stations').get(),loaded=await f.owner();
 const changed=await(await f.post('/api/owner/station',{revision:loaded.revision,name:'  New Community Radio  ',stream_url:loaded.stream_url,bio:loaded.bio})).json();assert.equal(changed.review_required,true);assert.deepEqual(f.sqlite.prepare('SELECT * FROM stations').get(),before);
 const draft=await f.owner(),pending=f.sqlite.prepare('SELECT * FROM station_edits').get();assert.equal(draft.name,'New Community Radio');assert.equal(draft.approved.name,before.name);assert.equal(pending.name,'New Community Radio');assert.notEqual(draft.revision,loaded.revision);
 const same=await(await f.post('/api/owner/station',{revision:draft.revision,name:'New Community Radio',stream_url:draft.stream_url,bio:draft.bio})).json();assert.equal(same.unchanged,true);assert.deepEqual(f.sqlite.prepare('SELECT * FROM station_edits').get(),pending);
 const legacy=await(await f.post('/api/owner/station',{revision:draft.revision,stream_url:draft.stream_url,bio:draft.bio})).json();assert.equal(legacy.unchanged,true);assert.equal((await f.owner()).name,'New Community Radio');
 await assert.rejects(f.post('/api/owner/station',{revision:loaded.revision,name:'Stale Name',stream_url:loaded.stream_url,bio:loaded.bio}),error=>error.status===409);assert.equal((await f.owner()).name,'New Community Radio');
});

test('owner name validation matches registration byte limits and rejects invalid names before image processing',async()=>{
 const f=await registered();await f.post('/api/owner/verify',{verification_id:f.result.verification_id,code:f.code});f.sqlite.exec("UPDATE stations SET status='published'");const loaded=await f.owner(),reads=f.imageReads();
 for(const name of ['', '   ', 'a'.repeat(97), '\u00e9'.repeat(49), 'Bad\nName'])await assert.rejects(f.post('/api/owner/station',{revision:loaded.revision,name,stream_url:loaded.stream_url,bio:loaded.bio,artwork:f.registration.artwork}),error=>error.status===400);
 assert.equal(f.imageReads(),reads);assert.equal(f.sqlite.prepare('SELECT count(*) n FROM station_edits').get().n,0);assert.equal((await f.owner()).revision,loaded.revision);
 await f.post('/api/owner/station',{revision:loaded.revision,name:'\u00e9'.repeat(48),stream_url:loaded.stream_url,bio:loaded.bio});assert.equal((await f.owner()).name,'\u00e9'.repeat(48));
});

test('migration preserves the approved name for pre-existing proposed changes',()=>{
 const sqlite=new DatabaseSync(':memory:');for(const name of ['0001_core.sql','0021_station_edits.sql'])sqlite.exec(readFileSync(new URL('./migrations/'+name,import.meta.url),'utf8'));
 sqlite.prepare("INSERT INTO stations(name,stream_url,contact_email,created_at,updated_at) VALUES ('Existing approved name','https://example.com/live','owner@example.com',?,?)").run(now,now);sqlite.prepare('INSERT INTO station_edits VALUES (?,?,?,?,?,?,?)').run(10,'a'.repeat(32),now,'https://example.com/new','Existing pending bio',null,now);
 sqlite.exec(readFileSync(new URL('./migrations/0023_station_edit_names.sql',import.meta.url),'utf8'));assert.equal(sqlite.prepare('SELECT name FROM station_edits').get().name,'Existing approved name');
});

test('station-code recovery emails only the registered verified active owner and does not grant access',async()=>{
  const f=await fixture(),insert=f.sqlite.prepare('INSERT INTO stations(name,stream_url,contact_email,status,email_verified_at,created_at,updated_at) VALUES (?,?,?,?,?,?,?)');
  for(const [name,email,status,verified] of [['First station','owner@example.com','published',now],['Awaiting review','owner@example.com','pending_review',now],['Other owner','other@example.com','published',now],['Unverified','owner@example.com','pending_email',null],['Removed','owner@example.com','deleted',now],['Suspended','owner@example.com','suspended',now]])
    insert.run(name,'https://example.com/live',email,status,verified,now,now);
  const before=f.sqlite.prepare('SELECT * FROM sessions').get();let requestedAction;
  const response=await f.post('/api/owner/recover-code',{email:'  OWNER@EXAMPLE.COM  ',turnstile_token:'test'}, {},now,{human:async(_request,_env,token,action)=>{assert.equal(token,'test');requestedAction=action;}});
  assert.equal(response.status,200);assert.equal(response.headers.get('cache-control'),'no-store');assert.equal(requestedAction,'station-code-recovery');
  assert.deepEqual(await response.json(),{status:'ok',message:'If this email has a registered station, its station code will arrive shortly.'});
  const jobs=f.sqlite.prepare('SELECT * FROM mail_outbox').all();assert.equal(jobs.length,1);const job=jobs[0];
  assert.equal(job.recipient,'owner@example.com');assert.equal(job.subject,'Your Radio Locals station code');assert.equal(job.expires,now+900);assert.ok(!job.encrypted_payload.includes('First station'));
  const payload=JSON.parse(await decrypt(f.env,job.encrypted_payload));assert.match(payload.text,/First station: station code #10/);assert.match(payload.text,/Awaiting review: station code #11/);
  for(const forbidden of ['Other owner','Unverified','Removed','Suspended'])assert.ok(!payload.text.includes(forbidden));
  assert.match(payload.text,/still requires a new private email verification code/);assert.deepEqual(f.sqlite.prepare('SELECT * FROM sessions').get(),before);
  assert.equal(f.sqlite.prepare('SELECT count(*) n FROM email_verifications').get().n,0);assert.equal(f.mail.length,0);
  await processMail(f.env,now);assert.equal(f.mail.length,1);assert.equal(f.mail[0].to,'owner@example.com');assert.equal(f.mail[0].text,payload.text);
});

test('station-code recovery has identical responses for unknown, unverified and active email addresses',async()=>{
  const bodies=[];
  for(const kind of ['unknown','unverified','active']){
    const f=await fixture();if(kind!=='unknown')f.sqlite.prepare('INSERT INTO stations(name,stream_url,contact_email,status,email_verified_at,created_at,updated_at) VALUES (?,?,?,?,?,?,?)')
      .run('Test station','https://example.com/live','owner@example.com',kind==='active'?'published':'pending_email',kind==='active'?now:null,now,now);
    const response=await f.post('/api/owner/recover-code',{email:'owner@example.com'});bodies.push({status:response.status,body:await response.json()});
    assert.equal(f.sqlite.prepare('SELECT count(*) n FROM mail_outbox').get().n,kind==='active'?1:0);
  }
  assert.deepEqual(bodies[0],bodies[1]);assert.deepEqual(bodies[1],bodies[2]);
});

test('station-code recovery requires same-origin session, CSRF and valid email before sending anything',async()=>{
  const f=await fixture();let humanCalls=0;const deps={human:async()=>{humanCalls++;}};
  for(const changes of [{Origin:'https://attacker.example'},{'X-CSRF-Token':''},{Cookie:''}])
    await assert.rejects(f.post('/api/owner/recover-code',{email:'owner@example.com'},changes,now,deps),e=>e.status===401||e.status===403);
  for(const email of ['not-an-email','owner@example.com\r\nBcc: other@example.com','a'.repeat(255)+'@example.com'])
    await assert.rejects(f.post('/api/owner/recover-code',{email},{},now,deps),e=>e.status===400);
  assert.equal(humanCalls,0);assert.equal(f.sqlite.prepare('SELECT count(*) n FROM mail_outbox').get().n,0);
  await assert.rejects(authRoutes(new Request(host+'/api/owner/recover-code'),f.env,now),e=>e.status===405);
});

test('repeated failed recovery bot checks stop before contacting the provider again',async()=>{
  const f=await fixture();let humanCalls=0;const deps={human:async()=>{humanCalls++;throw new Error('Rejected bot check');}};
  for(let attempt=0;attempt<3;attempt++)await assert.rejects(f.post('/api/owner/recover-code',{email:'owner@example.com'},{},now,deps),/Rejected bot check/);
  await assert.rejects(f.post('/api/owner/recover-code',{email:'another@example.com'},{},now,deps),e=>e.status===429);
  assert.equal(humanCalls,3);assert.equal(f.sqlite.prepare('SELECT count(*) n FROM mail_outbox').get().n,0);
});

test('recovery email cooldown is shared across sessions and does not invalidate pending login codes',async()=>{
  const f=await registered();await f.post('/api/owner/verify',{verification_id:f.result.verification_id,code:f.code});
  const challenge=await ownerLoginChallenge(f),session=f.sqlite.prepare('SELECT * FROM sessions').get();
  await f.post('/api/owner/recover-code',{email:f.registration.email});
  const response=await authRoutes(new Request(host+'/api/session'),f.env,now),state=await response.json(),cookie=response.headers.get('set-cookie').split(';')[0];
  await assert.rejects(f.post('/api/owner/recover-code',{email:f.registration.email},{Cookie:cookie,'X-CSRF-Token':state.csrf}),e=>e.status===429);
  assert.deepEqual(f.sqlite.prepare('SELECT * FROM sessions WHERE token_hash=?').get(session.token_hash),session);
  assert.equal(f.sqlite.prepare('SELECT consumed_at FROM email_verifications WHERE id=?').get(challenge.verification_id).consumed_at,null);
  await f.post('/api/owner/verify',{verification_id:challenge.verification_id,code:challenge.code});
  const later=await f.post('/api/owner/recover-code',{email:f.registration.email},{Cookie:cookie,'X-CSRF-Token':state.csrf},now+60);assert.equal(later.status,200);
  assert.equal(f.sqlite.prepare("SELECT count(*) n FROM mail_outbox WHERE subject='Your Radio Locals station code'").get().n,2);
});

test('station-code recovery bounds one email even for an owner with many stations',async()=>{
  const f=await fixture(),insert=f.sqlite.prepare('INSERT INTO stations(name,stream_url,contact_email,status,email_verified_at,created_at,updated_at) VALUES (?,?,?,?,?,?,?)');
  for(let i=0;i<103;i++)insert.run('Station '+i,'https://example.com/live','owner@example.com','published',now,now,now);
  await f.post('/api/owner/recover-code',{email:'owner@example.com'});
  const jobs=f.sqlite.prepare('SELECT * FROM mail_outbox').all();assert.equal(jobs.length,1);const text=JSON.parse(await decrypt(f.env,jobs[0].encrypted_payload)).text;
  assert.equal((text.match(/: station code #/g)||[]).length,100);assert.match(text,/first 100 stations/);assert.ok(!text.includes('Station 100:'));
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
  await f.passed(f.registration.stream_url,f.sqlite.prepare('SELECT token_hash FROM sessions ORDER BY rowid DESC LIMIT 1').get().token_hash);
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
  await f.passed(f.registration.stream_url,f.sqlite.prepare('SELECT token_hash FROM sessions ORDER BY rowid DESC LIMIT 1').get().token_hash);
  const other=await authRoutes(new Request(host+'/api/owner/register',{method:'POST',headers:{Origin:host,Cookie:cookie,'Content-Type':'application/json','X-CSRF-Token':state.csrf},body:JSON.stringify(f.registration)}),f.env,now,{human:async()=>{}});
  assert.notEqual((await other.json()).verification_id,original);assert.equal(f.sqlite.prepare('SELECT count(*) n FROM stations').get().n,2);
});

test('signup database failure rolls back station and email creation and cleans orphan artwork before retry',async()=>{
  const f=await fixture();f.env.DB.failBatchAfter=3;
  await assert.rejects(f.post('/api/owner/register',f.registration),/Simulated database write failure/);
  for(const table of ['stations','agreement_acceptances','email_verifications','mail_outbox'])assert.equal(f.sqlite.prepare('SELECT count(*) n FROM '+table).get().n,0,table);
  assert.equal(f.sqlite.prepare('SELECT lease_until FROM registration_requests').get().lease_until,0);assert.equal(f.objects.size,0);
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
  await f.passed('https://example.org/updated');
  await f.post('/api/owner/station',{revision:(await f.owner()).revision,code:11,stream_url:'https://example.org/updated',bio:'Changed'});
  assert.equal(f.sqlite.prepare('SELECT bio FROM stations WHERE code=11').get().bio,'');
  assert.equal(f.sqlite.prepare('SELECT bio FROM station_edits WHERE station_code=10').get().bio,'Changed');
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
  await f.passed('https://example.com/changed');
  await assert.rejects(f.post('/api/owner/station',{revision:(await f.owner()).revision,stream_url:'https://example.com/changed',bio:'A racing edit',artwork:f.registration.artwork}),e=>e.status===409);
  const saved=f.sqlite.prepare('SELECT status,bio,stream_url,artwork_key FROM stations').get();
  assert.equal(saved.status,status);assert.equal(saved.bio,station.bio);assert.equal(saved.stream_url,station.stream_url);assert.equal(saved.artwork_key,station.artwork_key);
 }
});

test('concurrent owner edits do not overwrite a newer saved revision within the same second',async()=>{
 const f=await registered();await f.post('/api/owner/verify',{verification_id:f.result.verification_id,code:f.code});
 let release,started;const waiting=new Promise(resolve=>{release=resolve;}),processing=new Promise(resolve=>{started=resolve;});
 f.env.IMAGES.info=async()=>{started();await waiting;return {width:1,height:1};};
 await f.passed('https://example.com/older');await f.passed('https://example.com/newer');
 const revision=(await f.owner()).revision,first=f.post('/api/owner/station',{revision,stream_url:'https://example.com/older',bio:'Older artwork request',artwork:f.registration.artwork});await processing;
 const newer=await f.post('/api/owner/station',{revision,stream_url:'https://example.com/newer',bio:'Newest request'});assert.equal(newer.status,200);
 release();await assert.rejects(first,e=>e.status===409);
 const saved=f.sqlite.prepare('SELECT stream_url,bio FROM station_edits').get();assert.equal(saved.stream_url,'https://example.com/newer');assert.equal(saved.bio,'Newest request');
});

test('a loaded editor revision is required and an unchanged save cannot rescan or change public state',async()=>{
 const f=await registered();await f.post('/api/owner/verify',{verification_id:f.result.verification_id,code:f.code});f.sqlite.exec("UPDATE stations SET status='published'");const station=await f.owner(),before=f.sqlite.prepare('SELECT * FROM stations').get();
 await assert.rejects(f.post('/api/owner/station',{stream_url:station.stream_url,bio:station.bio}),e=>e.status===409);
 f.env.OPENAI_API_KEY='must-not-scan';const oldFetch=globalThis.fetch;let scans=0;globalThis.fetch=async()=>{scans++;throw Error('No-op must not scan');};
 try{const response=await(await f.post('/api/owner/station',{revision:station.revision,stream_url:station.stream_url,bio:station.bio})).json();assert.equal(response.unchanged,true);assert.equal(response.message,'No changes to save.');assert.equal(scans,0);}finally{globalThis.fetch=oldFetch;}
 assert.deepEqual(f.sqlite.prepare('SELECT * FROM stations').get(),before);assert.equal(f.sqlite.prepare('SELECT count(*) n FROM station_edits').get().n,0);assert.equal((await f.owner()).revision,station.revision);
});

test('pending changes keep the approved station live and stale editor forms cannot replace the proposal',async()=>{
 const f=await registered();await f.post('/api/owner/verify',{verification_id:f.result.verification_id,code:f.code});f.sqlite.exec("UPDATE stations SET status='published'");const first=await f.owner(),approved=f.sqlite.prepare('SELECT * FROM stations').get();
 await f.passed('https://changed.example.com/live');
 const result=await(await f.post('/api/owner/station',{revision:first.revision,stream_url:'https://changed.example.com/live',bio:'Proposed bio'})).json();assert.equal(result.review_required,true);assert.deepEqual(f.sqlite.prepare('SELECT * FROM stations').get(),approved);
 const draft=await f.owner();assert.equal(draft.review_pending,true);assert.equal(draft.stream_url,'https://changed.example.com/live');assert.equal(draft.approved.stream_url,approved.stream_url);assert.notEqual(draft.revision,first.revision);
 await assert.rejects(f.post('/api/owner/station',{revision:first.revision,stream_url:'https://stale.example.com/live',bio:'Lost update'}),e=>e.status===409);assert.equal(f.sqlite.prepare('SELECT bio FROM station_edits').get().bio,'Proposed bio');
 const pending=f.sqlite.prepare('SELECT * FROM station_edits').get(),noop=await(await f.post('/api/owner/station',{revision:draft.revision,stream_url:draft.stream_url,bio:draft.bio})).json();assert.equal(noop.unchanged,true);assert.deepEqual(f.sqlite.prepare('SELECT * FROM station_edits').get(),pending);
});

test('two authenticated owner sessions cannot save over each other from the same loaded revision',async()=>{
 const f=await registered();await f.post('/api/owner/verify',{verification_id:f.result.verification_id,code:f.code});f.sqlite.exec("UPDATE stations SET status='published'");const first=await f.owner(),response=await authRoutes(new Request(host+'/api/session'),f.env,now),otherState=await response.json(),headers={Cookie:response.headers.get('set-cookie').split(';')[0],'X-CSRF-Token':otherState.csrf},challenge=await ownerLoginChallenge(f,headers);await f.post('/api/owner/verify',{verification_id:challenge.verification_id,code:challenge.code},headers);const other=(await(await authRoutes(new Request(host+'/api/owner/station',{headers}),f.env,now)).json()).station;assert.equal(first.revision,other.revision);
 await f.passed('https://example.com/first');await f.post('/api/owner/station',{revision:first.revision,stream_url:'https://example.com/first',bio:'First session edit'});await assert.rejects(f.post('/api/owner/station',{revision:other.revision,stream_url:'https://example.com/second',bio:'Stale second session'},headers),e=>e.status===409);assert.equal(f.sqlite.prepare('SELECT bio FROM station_edits').get().bio,'First session edit');assert.equal(f.sqlite.prepare('SELECT status FROM stations').get().status,'published');
});


test('email verification keeps an unchecked or expired-check signup private despite safe content',async()=>{
 for(const kind of ['missing','expired']){
  const f=await registered();f.env.OPENAI_API_KEY='test-only';let scans=0;
  if(kind==='missing'){f.sqlite.exec('DELETE FROM stream_check_results; UPDATE station_stream_checks SET checked_at=0,expires=0');}
  if(kind==='expired'){const hash=f.sqlite.prepare('SELECT token_hash FROM sessions').get().token_hash,id=await beginStreamCheck(f.env,hash,f.registration.stream_url,now-3601);await completeStreamCheck(f.env,hash,f.registration.stream_url,id,true,now-3601);}
  const previous=globalThis.fetch;globalThis.fetch=async()=>{scans++;throw Error('Unverified streams must not reach the creative scanner.');};
  try{const result=await(await f.post('/api/owner/verify',{verification_id:f.result.verification_id,code:f.code})).json();assert.equal(result.stream_check_required,true,kind);assert.equal(result.registration_completed,true);assert.equal(result.review_required,true);assert.equal(f.sqlite.prepare('SELECT status FROM stations').get().status,'pending_review');assert.equal(scans,0);assert.equal((await f.owner()).stream_check.status,'needs_check');}finally{globalThis.fetch=previous;}
 }
});

test('signup attaches its session check and publishes after both email verification and a safe creative scan',async()=>{
 const f=await fixture(),hash=f.sqlite.prepare('SELECT token_hash FROM sessions').get().token_hash,id=await beginStreamCheck(f.env,hash,f.registration.stream_url,now);await completeStreamCheck(f.env,hash,f.registration.stream_url,id,true,now);
 const result=await(await f.post('/api/owner/register',f.registration)).json(),job=f.sqlite.prepare('SELECT * FROM mail_outbox').get(),code=JSON.parse(await decrypt(f.env,job.encrypted_payload)).text.match(/code is (\d{6})/)[1];
 assert.equal(f.sqlite.prepare('SELECT revision FROM station_stream_checks').get().revision,'initial');assert.equal(f.sqlite.prepare('SELECT status FROM stations').get().status,'pending_email');
 const get=f.env.MEDIA.get;f.env.MEDIA.get=async key=>{const value=await get(key);return value?{...value,size:12,arrayBuffer:async()=>new Uint8Array(12).buffer}:null;};f.env.OPENAI_API_KEY='test-only';
 const categories=Object.fromEntries(['sexual','sexual/minors','violence','violence/graphic','hate','harassment','self-harm'].map(key=>[key,false])),previous=globalThis.fetch;let scans=0;
 globalThis.fetch=async url=>{assert.equal(url,'https://api.openai.com/v1/moderations');scans++;return Response.json({results:[{flagged:false,categories,category_scores:Object.fromEntries(Object.keys(categories).map(key=>[key,0.001]))}]});};
 try{const verified=await(await f.post('/api/owner/verify',{verification_id:result.verification_id,code})).json();assert.equal(verified.stream_check_required,false);assert.equal(verified.review_required,false);assert.equal(f.sqlite.prepare('SELECT status FROM stations').get().status,'published');assert.equal(scans,1);assert.equal((await f.owner()).stream_check.status,'passed');}finally{globalThis.fetch=previous;}
});
