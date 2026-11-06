import {test} from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import {authRoutes,processMail,streamUrl} from './owner-auth.mjs';
import {decrypt,human,encrypt} from './security.mjs';
const now=1800000000,host='https://radio-locals-native.example';
const png=Uint8Array.from(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Zl1sAAAAASUVORK5CYII=','base64'));
async function fixture(){
  const sqlite=new DatabaseSync(':memory:');sqlite.exec(readFileSync(new URL('./migrations/0001_core.sql',import.meta.url),'utf8'));
  const DB={sqlite,prepare(sql){let args=[];const q={bind(...values){args=values;return q;},async first(){return sqlite.prepare(sql).get(...args)||null;},async all(){return {results:sqlite.prepare(sql).all(...args)};},async run(){return sqlite.prepare(sql).run(...args);}};return q;},
    async batch(queries){sqlite.exec('BEGIN');try{for(const q of queries)await q.run();sqlite.exec('COMMIT');}catch(e){sqlite.exec('ROLLBACK');throw e;}}};
  const objects=new Map(),mail=[];
  const env={DB,DATA_ENCRYPTION_KEY:'a'.repeat(64),TURNSTILE_SITE_KEY:'test',TURNSTILE_SECRET_KEY:'private-test',
    MEDIA:{async put(key,data,meta){objects.set(key,{data,meta});},async get(key){const o=objects.get(key);return o?{body:o.data,customMetadata:o.meta.customMetadata}:null;}},
    IMAGES:{async info(){return {width:1,height:1};},input(){return {transform(){return {async output(){return {response:()=>new Response(png)};}};}};}},
    EMAIL:{async send(message){mail.push(message);return {messageId:'test'};}}};
  const response=await authRoutes(new Request(host+'/api/session'),env,now);
  const state=await response.json(),cookie=response.headers.get('set-cookie').split(';')[0];
  async function post(path,body,changes={}){return authRoutes(new Request(host+path,{method:'POST',headers:{Origin:host,Cookie:cookie,'Content-Type':'application/json','X-CSRF-Token':state.csrf,...changes},body:JSON.stringify(body)}),env,now,{human:async()=>{}});}
  const registration={name:'Test station',email:'owner@example.com',stream_url:'https://example.com/live',bio:'Test bio',rights_confirmed:true,agreement_version:state.agreement_version,artwork:{name:'logo.png',base64:Buffer.from(png).toString('base64')}};
  return {env,sqlite,state,cookie,post,registration,mail,objects};
}
async function registered(){const f=await fixture();const response=await f.post('/api/owner/register',f.registration);f.result=await response.json();
  const job=f.sqlite.prepare('SELECT * FROM mail_outbox').get();f.code=JSON.parse(await decrypt(f.env,job.encrypted_payload)).text.match(/code is (\d{6})/)[1];return f;}
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
test('email verification grants only the matching station and cannot replay',async()=>{
  const f=await registered();const body={verification_id:f.result.verification_id,code:f.code};
  const result=await (await f.post('/api/owner/verify',body)).json();assert.equal(result.station_code,'10');
  assert.equal(f.sqlite.prepare('SELECT status FROM stations').get().status,'pending_review');
  assert.equal(f.sqlite.prepare('SELECT owner_station FROM sessions').get().owner_station,10);
  await assert.rejects(f.post('/api/owner/verify',body),e=>e.status===400);
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
test('mail failures retry with a lease and never expose plaintext in stored errors',async()=>{
  const f=await registered();f.env.EMAIL.send=async()=>{throw new Error('provider secret body');};
  await processMail(f.env,now);const job=f.sqlite.prepare('SELECT * FROM mail_outbox').get();
  assert.equal(job.state,'pending');assert.equal(job.attempts,1);assert.equal(job.due,now+15);assert.equal(job.lease,0);
  await processMail(f.env,now);assert.equal(f.sqlite.prepare('SELECT attempts FROM mail_outbox').get().attempts,1);
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
