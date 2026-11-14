import {test} from 'node:test';
import assert from 'node:assert/strict';
import {operationsFixture} from './operations-fixture.mjs';
import {authRoutes} from './owner-auth.mjs';
import {beginStreamCheck,completeStreamCheck,attachStreamCheck} from './stream-verification.mjs';

const url='https://stream.example.com/live',other='http://162.244.81.219:8020/live';
const png=Uint8Array.from(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Zl1sAAAAASUVORK5CYII=','base64'));
const required=error=>error.status===428&&error.message==='Test your stream and get a pass before saving.';
async function fixture(){
 const f=await operationsFixture();f.hash=f.sqlite.prepare('SELECT token_hash FROM sessions').get().token_hash;f.images=0;f.puts=0;
 // Keep required station details valid so these tests reach the stream-proof
 // checks, including historical/private stations and legacy owner payloads.
 f.sqlite.prepare("UPDATE stations SET zip_code='00501',category='other' WHERE code=?").run(f.station);
 const put=f.env.MEDIA.put;f.env.MEDIA.put=async(...args)=>{f.puts++;return put(...args);};
 f.env.IMAGES={async info(){f.images++;return {width:1,height:1};},input(){return {transform(){return {async output(){return {response:()=>new Response(png)};}};}};}};
 const state=await(await authRoutes(f.request('/api/session'),f.env,f.now)).json();
 f.registration={request_id:'9'.repeat(32),name:'New station',email:'owner@example.com',stream_url:url,zip_code:'00501',category:'other',rights_confirmed:true,agreement_version:state.agreement_version,artwork:{name:'logo.png',base64:Buffer.from(png).toString('base64')}};
 f.register=(body=f.registration)=>authRoutes(f.request('/api/owner/register',body),f.env,f.now,{human:async()=>{}});
 f.pass=async(value=url,hash=f.hash,at=f.now)=>{const id=await beginStreamCheck(f.env,hash,value,at);await completeStreamCheck(f.env,hash,value,id,true,at);return id;};
 f.edit=async(changes={})=>{const station=(await(await authRoutes(f.request('/api/owner/station'),f.env,f.now)).json()).station;return authRoutes(f.request('/api/owner/station',{name:station.name,stream_url:station.stream_url,bio:station.bio,revision:station.revision,...changes}),f.env,f.now);};
 return f;
}
function noRegistration(f){
 assert.equal(f.sqlite.prepare('SELECT COUNT(*) n FROM stations').get().n,1);
 for(const table of ['agreement_acceptances','email_verifications','mail_outbox'])assert.equal(f.sqlite.prepare('SELECT COUNT(*) n FROM '+table).get().n,0,table);
 assert.equal(f.sqlite.prepare('SELECT owner_station FROM sessions WHERE token_hash=?').get(f.hash).owner_station,null);
 assert.equal(f.objects.size,0);
}
function invalidate(f,kind='failed'){
 if(kind==='expired')f.sqlite.prepare('UPDATE stream_check_results SET expires=? WHERE session_hash=?').run(f.now,f.hash);
 else if(kind==='replacement')f.sqlite.prepare("UPDATE stream_check_results SET check_id=? WHERE session_hash=?").run('a'.repeat(32),f.hash);
 else f.sqlite.prepare('DELETE FROM stream_check_results WHERE session_hash=?').run(f.hash);
}

test('new registration needs a fresh exact canonical URL pass from this browser before account, image or email work',async()=>{
 for(const kind of ['missing','failed','pending','expired','future','url','session']){
  const f=await fixture();
  if(kind==='failed'){const id=await f.pass();await completeStreamCheck(f.env,f.hash,url,id,false,f.now);}
  if(kind==='pending'){await f.pass();await beginStreamCheck(f.env,f.hash,url,f.now);}
  if(kind==='expired')await f.pass(url,f.hash,f.now-3600);
  if(kind==='future')await f.pass(url,f.hash,f.now+1);
  if(kind==='url')await f.pass(other);
  if(kind==='session'){const hash='f'.repeat(64);f.sqlite.prepare('INSERT INTO sessions(token_hash,csrf_hash,created_at,expires) VALUES (?,?,?,?)').run(hash,'e'.repeat(64),f.now,f.now+7200);await f.pass(url,hash);}
  await assert.rejects(f.register({...f.registration,stream_checked:true,audio_response:true,verified:true,stream_check:{status:'passed'}}),required,kind);
  noRegistration(f);assert.equal(f.images,0,kind);assert.equal(f.puts,0,kind);assert.equal(f.sqlite.prepare('SELECT COUNT(*) n FROM registration_requests').get().n,0,kind);
 }
});

test('a canonical matching pass permits registration and an exact completed retry never duplicates account or email',async()=>{
 const f=await fixture();await f.pass();const first=await(await f.register({...f.registration,stream_url:'HTTPS://STREAM.example.com/live'})).json();
 assert.match(first.verification_id,/^[a-f0-9]{32}$/);assert.equal(f.sqlite.prepare('SELECT stream_url FROM stations WHERE code!=?').get(f.station).stream_url,url);assert.equal(f.images,1);assert.equal(f.puts,1);
 invalidate(f);const again=await(await f.register({...f.registration,stream_url:'HTTPS://STREAM.example.com/live'})).json();assert.equal(again.verification_id,first.verification_id);
 assert.equal(f.sqlite.prepare('SELECT COUNT(*) n FROM stations').get().n,2);assert.equal(f.sqlite.prepare('SELECT COUNT(*) n FROM mail_outbox').get().n,1);assert.equal(f.images,1);assert.equal(f.puts,1);
});

test('a failed, expired or replaced nonce during image processing cannot upload or create a registration',async()=>{
 for(const kind of ['failed','expired','replacement']){
  const f=await fixture();await f.pass();f.env.IMAGES.info=async()=>{f.images++;invalidate(f,kind);return {width:1,height:1};};
  await assert.rejects(f.register(),required,kind);noRegistration(f);assert.equal(f.images,1);assert.equal(f.puts,0);
 }
});

test('the actual registration transaction rechecks the exact pass nonce and removes any orphan upload on failure',async()=>{
 for(const kind of ['failed','expired','replacement']){
  const f=await fixture();await f.pass();const batch=f.env.DB.batch;f.env.DB.batch=async queries=>{invalidate(f,kind);return batch(queries);};
  await assert.rejects(f.register(),required,kind);noRegistration(f);assert.equal(f.puts,1);assert.equal(f.sqlite.prepare('SELECT state FROM registration_requests').get().state,'pending');
 }
});

test('proof expiry between any registration statements rolls back every account/email mutation and orphan upload',async()=>{
 for(let after=1;after<=7;after++){
  const f=await fixture();let clock=f.now;f.sqlite.function('unixepoch',()=>clock);await f.pass();f.sqlite.prepare('UPDATE stream_check_results SET expires=? WHERE session_hash=?').run(f.now+1,f.hash);
  const batch=f.env.DB.batch;f.env.DB.batch=async queries=>{let index=0;for(const query of queries){const execute=query.execute;query.execute=async()=>{const result=await execute();if(++index===after)clock=f.now+2;return result;};}return batch(queries);};
  await assert.rejects(f.register(),required,'expiry after statement '+after);noRegistration(f);assert.equal(f.puts,1);
  const request=f.sqlite.prepare('SELECT state,station_code,verification_id,lease_until FROM registration_requests').get();assert.deepEqual({...request},{state:'pending',station_code:null,verification_id:null,lease_until:0});
 }
});

test('lease expiry or loss between registration statements rolls back every account/email mutation',async()=>{
 for(const kind of ['expiry','loss'])for(let after=1;after<=7;after++){
  const f=await fixture();let clock=f.now;f.sqlite.function('unixepoch',()=>clock);await f.pass();
  const batch=f.env.DB.batch;f.env.DB.batch=async queries=>{let index=0;for(const query of queries){const execute=query.execute;query.execute=async()=>{const result=await execute();if(++index===after){if(kind==='expiry')clock=f.now+121;else f.sqlite.prepare('UPDATE registration_requests SET lease_token=?').run('c'.repeat(32));}return result;};}return batch(queries);};
  await assert.rejects(f.register(),error=>error.status===409,kind+' after statement '+after);noRegistration(f);assert.equal(f.puts,1);
  assert.equal(f.sqlite.prepare('SELECT station_code FROM registration_requests').get().station_code,null);
 }
});

test('owner new-URL saves require the current browser pass before image processing or private edit creation',async()=>{
 const f=await fixture();f.owner();await assert.rejects(f.edit({stream_url:other,artwork:f.registration.artwork}),required);
 assert.equal(f.images,0);assert.equal(f.puts,0);assert.equal(f.sqlite.prepare('SELECT COUNT(*) n FROM station_edits').get().n,0);
 assert.equal(f.sqlite.prepare('SELECT stream_url FROM stations WHERE code=?').get(f.station).stream_url,'https://example.com/live');
});

test('published unchanged approved URLs allow Bio and logo edits without another pass',async()=>{
 const f=await fixture();f.owner();const result=await(await f.edit({bio:'An updated bio',artwork:f.registration.artwork})).json();
 assert.equal(result.status,'ok');assert.equal(result.stream_check_required,false);assert.equal(f.images,1);
 assert.equal(f.sqlite.prepare('SELECT bio FROM station_edits WHERE station_code=?').get(f.station).bio,'An updated bio');
});

test('historical canonical-equivalent published URL literals allow unchanged stream edits without forcing a new pass',async()=>{
 for(const withReceipt of [false,true]){
  const f=await fixture();f.owner();f.sqlite.prepare('UPDATE stations SET stream_url=? WHERE code=?').run('HTTPS://Example.COM:443/live',f.station);
  if(withReceipt)await f.pass('https://example.com/live');
  const result=await(await f.edit({stream_url:'https://example.com/live',bio:'Updated bio'})).json();assert.equal(result.status,'ok');assert.equal(result.stream_check_required,false);
  assert.equal(f.sqlite.prepare('SELECT stream_url FROM station_edits WHERE station_code=?').get(f.station).stream_url,'https://example.com/live');
 }
});

test('a malformed historical approved URL does not prevent replacing it with a newly checked public stream',async()=>{
 const f=await fixture();f.owner();f.sqlite.prepare('UPDATE stations SET stream_url=? WHERE code=?').run('ftp://legacy.example.com/live',f.station);
 await f.pass(other);assert.equal((await f.edit({stream_url:other})).status,200);assert.equal(f.sqlite.prepare('SELECT stream_url FROM station_edits WHERE station_code=?').get(f.station).stream_url,other);
});

test('legacy private stations need a current-session receipt even when another session has attached passing evidence',async()=>{
 const f=await fixture();f.owner();f.sqlite.prepare("UPDATE stations SET status='pending_review',email_verified_at=?,stream_url=? WHERE code=?").run(f.now,url,f.station);
 const hash='f'.repeat(64);f.sqlite.prepare('INSERT INTO sessions(token_hash,csrf_hash,created_at,expires) VALUES (?,?,?,?)').run(hash,'e'.repeat(64),f.now,f.now+7200);await f.pass(url,hash);assert.equal(await attachStreamCheck(f.env,hash,f.station,url,'initial',f.now),true);
 await assert.rejects(f.edit({bio:'No test in this browser',artwork:f.registration.artwork}),required);assert.equal(f.images,0);assert.equal(f.sqlite.prepare('SELECT COUNT(*) n FROM station_edits').get().n,0);
 await f.pass();assert.equal((await f.edit({bio:'Test passed in this browser'})).status,200);
});

test('an attached private-station proof alone cannot replace the current browser receipt required for Save',async()=>{
 const f=await fixture();f.owner();f.sqlite.prepare("UPDATE stations SET status='pending_review',email_verified_at=?,stream_url=? WHERE code=?").run(f.now,url,f.station);
 await f.pass();assert.equal(await attachStreamCheck(f.env,f.hash,f.station,url,'initial',f.now),true);invalidate(f);
 await assert.rejects(f.edit({bio:'No current receipt'}),required);assert.equal(f.sqlite.prepare('SELECT COUNT(*) n FROM station_edits').get().n,0);
});

test('an unchecked replacement cannot overwrite a previously checked saved proposal',async()=>{
 const f=await fixture();f.owner();await f.pass(other);await f.edit({stream_url:other,bio:'Already saved proposal'});
 const before=f.sqlite.prepare('SELECT * FROM station_edits WHERE station_code=?').get(f.station);
 await assert.rejects(f.edit({stream_url:'https://unchecked.example.com/new',bio:'Must not replace the checked draft',artwork:f.registration.artwork}),required);
 assert.deepEqual(f.sqlite.prepare('SELECT * FROM station_edits WHERE station_code=?').get(f.station),before);assert.equal(f.images,0);
});

test('the actual owner edit INSERT rechecks proof after image upload and preserves the previous station/revision',async()=>{
 for(const kind of ['failed','expired','replacement']){
  const f=await fixture();f.owner();await f.pass(other);const before=f.sqlite.prepare('SELECT * FROM stations WHERE code=?').get(f.station),prepare=f.env.DB.prepare;
  f.env.DB.prepare=sql=>{const statement=prepare(sql);if(sql.startsWith('INSERT INTO station_edits')){const first=statement.first;statement.first=async()=>{invalidate(f,kind);return first();};}return statement;};
  await assert.rejects(f.edit({stream_url:other,artwork:f.registration.artwork}),required,kind);
  assert.deepEqual(f.sqlite.prepare('SELECT * FROM stations WHERE code=?').get(f.station),before);assert.equal(f.sqlite.prepare('SELECT COUNT(*) n FROM station_edits').get().n,0);assert.equal(f.objects.size,0);assert.equal(f.puts,1);
 }
});

test('the owner review endpoint cannot be used instead of passing Test stream',async()=>{
 const f=await fixture();f.owner();f.sqlite.prepare("UPDATE stations SET status='pending_review',email_verified_at=? WHERE code=?").run(f.now,f.station);
 const station=(await(await authRoutes(f.request('/api/owner/station'),f.env,f.now)).json()).station;
 await assert.rejects(authRoutes(f.request('/api/owner/stream-review',{revision:station.revision}),f.env,f.now),required);
 assert.equal(f.sqlite.prepare('SELECT COUNT(*) n FROM station_stream_checks').get().n,0);assert.equal(f.sqlite.prepare('SELECT COUNT(*) n FROM station_edits').get().n,0);
});
