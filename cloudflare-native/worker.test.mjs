import {test} from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync,readdirSync} from 'node:fs';
import {fetchHandler,digest,handle,cleanup} from './worker.mjs';
const schema=readFileSync(new URL('./migrations/0001_core.sql',import.meta.url),'utf8');
function database(){
  const sqlite=new DatabaseSync(':memory:');for(const file of readdirSync(new URL('./migrations/',import.meta.url)).filter(name=>name.endsWith('.sql')).sort())sqlite.exec(readFileSync(new URL('./migrations/'+file,import.meta.url),'utf8'));
  return {sqlite,prepare(sql){
    let args=[];
    const query={bind(...values){args=values;return query;},
      async first(){return sqlite.prepare(sql).get(...args)||null;},
      async all(){return {results:sqlite.prepare(sql).all(...args)};},
      async run(){return sqlite.prepare(sql).run(...args);}};
    return query;
  },async batch(queries){sqlite.exec('BEGIN');try{const rows=[];for(const q of queries)rows.push(await q.run());sqlite.exec('COMMIT');return rows;}catch(e){sqlite.exec('ROLLBACK');throw e;}}};
}
const id='a'.repeat(32),secret='b'.repeat(64),claim='c'.repeat(32),command='d'.repeat(32),now=1800000000;
async function fixture(){
  const DB=database();
  DB.sqlite.prepare('INSERT INTO radios VALUES (?,?,?,?,?)').run(id,await digest(secret),'Test radio',now,now);
  DB.sqlite.prepare('INSERT INTO sessions VALUES (?,?,?,?,?,?)').run('session','csrf',now,now+9999,null,null);
  DB.sqlite.prepare('INSERT INTO stations(name,stream_url,contact_email,status,created_at,updated_at) VALUES (?,?,?,?,?,?)')
    .run('Test station','https://example.com/live','private@example.com','published',now,now);
  return {DB};
}
function request(path,body={},token=secret){return new Request('https://native.example'+path,{method:'POST',headers:{'Content-Type':'application/json','Authorization':'Bearer '+token},body:JSON.stringify({radio_id:id,...body})});}
async function poll(env,body={}){return handle(request('/api/radio/poll',body),env,now);}
test('schema reapplies safely and starts station identifiers at 10',async()=>{
  const env=await fixture();env.DB.sqlite.exec(schema);env.DB.sqlite.exec(readFileSync(new URL('./migrations/0008_reports_backups.sql',import.meta.url),'utf8'));env.DB.sqlite.exec(readFileSync(new URL('./migrations/0007_local_ads.sql',import.meta.url),'utf8'));
  assert.equal(env.DB.sqlite.prepare('SELECT code FROM stations').get().code,10);
  assert.equal(env.DB.sqlite.prepare("SELECT count(*) n FROM sqlite_sequence WHERE name='stations'").get().n,1);
});
test('directory excludes private fields and suspended stations',async()=>{
  const env=await fixture();let res=await handle(new Request('https://native.example/api/stations'),env,now);
  assert.equal((await res.json()).stations.length,1);
  res=await handle(new Request('https://native.example/api/stations/10'),env,now);
  assert.equal((await res.json()).contact_email,undefined);
  env.DB.sqlite.exec("UPDATE stations SET status='suspended'");
  assert.equal((await handle(new Request('https://native.example/api/stations/10'),env,now)).status,404);
});

test('HTTPS pages and APIs receive host-only transport security without changing their content or security headers',async()=>{
 const env=await fixture(),html='<html><body>Support page</body></html>';env.MIGRATION_PREVIEW='false';env.ASSETS={fetch:async()=>new Response(html,{headers:{'Content-Type':'text/html'}})};
 const page=await fetchHandler(new Request('https://native.example/support'),env);assert.equal(page.status,200);assert.equal(page.headers.get('Strict-Transport-Security'),'max-age=15552000');assert.doesNotMatch(page.headers.get('Strict-Transport-Security'),/includeSubDomains|preload/i);assert.match(page.headers.get('Content-Security-Policy'),/frame-ancestors 'none'/);assert.equal(page.headers.get('Cache-Control'),'no-store');assert.equal(await page.text(),html);
 const api=await fetchHandler(new Request('https://native.example/api/stations'),env);assert.equal(api.status,200);assert.equal(api.headers.get('Strict-Transport-Security'),'max-age=15552000');assert.equal(api.headers.get('Content-Type'),'application/json; charset=utf-8');assert.equal((await api.json()).stations[0].listener_code,'10');
});

test('HTTPS transport security also covers errors while keeping status and private error handling intact',async()=>{
 const env=await fixture(),denied=await fetchHandler(request('/api/radio/poll',{},'e'.repeat(64)),env);assert.equal(denied.status,401);assert.equal(denied.headers.get('Strict-Transport-Security'),'max-age=15552000');assert.deepEqual(await denied.json(),{message:'Radio authentication required.'});
 const failure=await fetchHandler(new Request('https://native.example/health'),{DB:{prepare(){throw Error('Private database detail');}}});assert.equal(failure.status,503);assert.equal(failure.headers.get('Strict-Transport-Security'),'max-age=15552000');assert.deepEqual(await failure.json(),{message:'Service temporarily unavailable.'});
});

test('transport security preserves session cookies and redirect status without mutating immutable responses',async()=>{
 const env=await fixture();env.DATA_ENCRYPTION_KEY='a'.repeat(64);const session=await fetchHandler(new Request('https://native.example/api/session'),env);assert.equal(session.status,200);assert.match(session.headers.get('Set-Cookie'),/^__Host-rl_session=[a-f0-9]{64}; Path=\/; Secure; HttpOnly; SameSite=Lax; Max-Age=2592000$/);assert.equal(session.headers.get('Strict-Transport-Security'),'max-age=15552000');assert.match((await session.json()).csrf,/^[a-f0-9]{64}$/);
 const immutable=Response.redirect('https://native.example/assets/new.js',302);env.ASSETS={fetch:async()=>immutable};const redirect=await fetchHandler(new Request('https://native.example/assets/old.js'),env);assert.equal(redirect.status,302);assert.equal(redirect.headers.get('Location'),'https://native.example/assets/new.js');assert.equal(redirect.headers.get('Strict-Transport-Security'),'max-age=15552000');assert.equal(immutable.headers.get('Strict-Transport-Security'),null);
});

test('local HTTP requests are not redirected or assigned an HTTPS-only policy',async()=>{
 const env=await fixture(),api=await fetchHandler(new Request('http://localhost:8787/api/stations'),env);assert.equal(api.status,200);assert.equal(api.headers.get('Strict-Transport-Security'),null);assert.equal((await api.json()).stations.length,1);
 const missing=await fetchHandler(new Request('http://localhost:8787/not-found'),env);assert.equal(missing.status,404);assert.equal(missing.headers.get('Strict-Transport-Security'),null);
});

test('saved-station revision scans expose only requested published revisions and reflect approved changes',async()=>{
 const env=await fixture(),scan=()=>handle(new Request('https://native.example/api/device/station-revisions?codes=10,11,10'),env,now);
 env.DB.sqlite.prepare('INSERT INTO stations(name,stream_url,contact_email,status,created_at,updated_at) VALUES (?,?,?,?,?,?)').run('Unrequested','https://example.com/other','secret@example.com','published',now,now);
 env.DB.sqlite.prepare('INSERT INTO stations(name,stream_url,contact_email,status,created_at,updated_at) VALUES (?,?,?,?,?,?)').run('Private','https://example.com/private','secret@example.com','pending_review',now,now);
 let response=await scan();assert.equal(response.headers.get('Cache-Control'),'no-store');assert.deepEqual((await response.json()).stations,[{listener_code:'10',revision:String(now)},{listener_code:'11',revision:String(now)}]);
 env.DB.sqlite.prepare("UPDATE stations SET stream_url=?,artwork_key=?,updated_at=? WHERE code=10").run('https://example.com/new','a'.repeat(64)+'.png',now+1);
 const station=await(await handle(new Request('https://native.example/api/device/stations/10'),env,now)).json();assert.equal(station.revision,String(now+1));assert.equal(station.url,'https://example.com/new');assert.equal(station.logo_url,'/artwork/'+'a'.repeat(64)+'.png');assert.equal(station.contact_email,undefined);
 assert.equal((await(await scan()).json()).stations[0].revision,station.revision);
 for(const state of ['pending_review','suspended','deleted']){env.DB.sqlite.prepare('UPDATE stations SET status=? WHERE code=10').run(state);assert.equal((await(await scan()).json()).stations.some(s=>s.listener_code==='10'),false);}
 const privateScan=await(await handle(new Request('https://native.example/api/device/station-revisions?codes=12'),env,now)).json();assert.deepEqual(privateScan.stations,[]);
});

test('revision scans bound query size and do not accept malformed station code lists',async()=>{
 const env=await fixture();for(const query of ['', '?codes=', '?codes=1', '?codes=0010', '?codes=10,,11', '?codes=10&codes=11', '?codes=10%27%20OR%201=1', '?codes='+Array(101).fill('10').join(',')])await assert.rejects(handle(new Request('https://native.example/api/device/station-revisions'+query),env,now),error=>error.status===400);
 env.DB.sqlite.prepare('INSERT INTO stations(code,name,stream_url,contact_email,status,created_at,updated_at) VALUES (?,?,?,?,?,?,?)').run(999999,'Last','https://example.com/last','secret@example.com','published',now,now);
 const result=await(await handle(new Request('https://native.example/api/device/station-revisions?codes='+Array(100).fill('999999').join(',')),env,now)).json();assert.deepEqual(result.stations,[{listener_code:'999999',revision:String(now)}]);
 const codes=Array.from({length:100},(_,index)=>String(100000+index));for(const code of codes)env.DB.sqlite.prepare('INSERT INTO stations(code,name,stream_url,contact_email,status,created_at,updated_at) VALUES (?,?,?,?,?,?,?)').run(Number(code),'Saved','https://example.com/live','secret@example.com','published',now,now);
 const text=await(await handle(new Request('https://native.example/api/device/station-revisions?codes='+codes.join(',')),env,now)).text();assert.equal(JSON.parse(text).stations.length,100);assert.ok(Buffer.byteLength(text,'utf8')<8192,'full saved list must fit the radio manifest decoder');
});
test('invalid device secret cannot poll or approve',async()=>{
  const env=await fixture();const res=await fetchHandler(request('/api/radio/poll',{},'e'.repeat(64)),env);
  assert.equal(res.status,401);
});
test('phone approval requires matching device and unexpired claim',async()=>{
  const env=await fixture();
  env.DB.sqlite.prepare('INSERT INTO pair_claims VALUES (?,?,?,?,?,?,?)').run(claim,id,'session','1234','waiting',now+120,now);
  const result=await (await poll(env,{pair_claim_id:claim,pair_decision:'approve'})).json();
  assert.equal(result.claim_result,'approved');assert.equal(result.linked,true);
  const count=env.DB.sqlite.prepare('SELECT count(*) n FROM phone_radios').get().n;
  await poll(env,{pair_claim_id:claim,pair_decision:'approve'});
  assert.equal(env.DB.sqlite.prepare('SELECT count(*) n FROM phone_radios').get().n,count);
});
test('expired claim never creates a phone grant',async()=>{
  const env=await fixture();
  env.DB.sqlite.prepare('INSERT INTO pair_claims VALUES (?,?,?,?,?,?,?)').run(claim,id,'session','1234','waiting',now-1,now-120);
  const result=await (await poll(env,{pair_claim_id:claim,pair_decision:'approve'})).json();
  assert.equal(result.claim_result,'expired');assert.equal(result.linked,false);
});

test('poll removes expired-session approval prompts before any radio decision',async()=>{
 const env=await fixture();env.DB.sqlite.prepare('INSERT INTO pair_claims VALUES (?,?,?,?,?,?,?)').run(claim,id,'session','1234','waiting',now+120,now);
 env.DB.sqlite.prepare('UPDATE sessions SET expires=? WHERE token_hash=?').run(now,'session');
 const result=await (await poll(env)).json();assert.equal(result.pair_claim_id,'');assert.equal(result.pair_check,'');assert.equal(result.linked,false);assert.equal(env.DB.sqlite.prepare('SELECT state FROM pair_claims WHERE id=?').get(claim).state,'expired');
});
test('command leases suppress repeated delivery and ack is device-scoped',async()=>{
  const env=await fixture();
  env.DB.sqlite.prepare('INSERT INTO phone_radios VALUES (?,?,?)').run('session',id,now+300);
  env.DB.sqlite.prepare('INSERT INTO radio_commands VALUES (?,?,?,?,?,?,?,?)').run(command,id,10,'pending',now,now+300,0,'session');
  assert.equal((await (await poll(env)).json()).command_id,command);
  assert.equal((await (await poll(env)).json()).command_id,'');
  await poll(env,{ack_id:command,ack_status:'added'});
  assert.equal(env.DB.sqlite.prepare('SELECT state FROM radio_commands').get().state,'added');
});
test('suspended station is never delivered to device',async()=>{
  const env=await fixture();
  env.DB.sqlite.prepare('INSERT INTO phone_radios VALUES (?,?,?)').run('session',id,now+300);
  env.DB.sqlite.prepare('INSERT INTO radio_commands VALUES (?,?,?,?,?,?,?,?)').run(command,id,10,'pending',now,now+300,0,'session');
  env.DB.sqlite.exec("UPDATE stations SET status='suspended'");
  assert.equal((await (await poll(env)).json()).command_id,'');
});
test('reset revokes phone grants, pairing codes, claims, and pending commands',async()=>{
  const env=await fixture();
  env.DB.sqlite.prepare('INSERT INTO phone_radios VALUES (?,?,?)').run('session',id,now+300);
  env.DB.sqlite.prepare('INSERT INTO radio_pairs(radio_id,code_hash,expires) VALUES (?,?,?)').run(id,'hash',0);
  env.DB.sqlite.prepare('INSERT INTO pair_claims VALUES (?,?,?,?,?,?,?)').run(claim,id,'session','1234','approved',now+120,now);
  await handle(request('/api/radio/link/reset'),env,now);
  assert.equal(env.DB.sqlite.prepare('SELECT count(*) n FROM phone_radios').get().n,0);
  assert.equal(env.DB.sqlite.prepare('SELECT count(*) n FROM radio_pairs').get().n,0);
  assert.equal(env.DB.sqlite.prepare('SELECT state FROM pair_claims').get().state,'cancelled');
});
test('rate limits persist across Worker requests and expire',async()=>{
  const env=await fixture();for(let i=0;i<12;i++)await poll(env);
  await assert.rejects(poll(env),e=>e.status===429);
  assert.equal((await handle(request('/api/radio/poll'),env,now+61)).status,200);
  await cleanup(env,now+200);
  assert.equal(env.DB.sqlite.prepare('SELECT count(*) n FROM rate_limits').get().n,0);
});
test('invalid/oversized payloads and unimplemented routes fail closed',async()=>{
  const env=await fixture();
  assert.equal((await fetchHandler(request('/api/radio/poll',{padding:'x'.repeat(5000)}),env)).status,413);
  assert.equal((await fetchHandler(new Request('https://native.example/api/add-station',{method:'POST'}),env)).status,404);
  assert.equal((await fetchHandler(new Request('https://native.example/health'),env)).status,200);
});
test('private artwork requires published reference and trusted sanitizer metadata',async()=>{
  const env=await fixture(),key='f'.repeat(64)+'.png';let reads=0;
  env.MEDIA={async get(){reads++;return {size:8,body:'safe png',customMetadata:{sanitizer_version:'1'}};}};
  const req=()=>new Request('https://native.example/artwork/'+key);
  assert.equal((await handle(req(),env,now)).status,404);assert.equal(reads,0);
  env.DB.sqlite.prepare('UPDATE stations SET artwork_key=?').run(key);
  assert.equal((await handle(req(),env,now)).headers.get('content-type'),'image/png');
  env.MEDIA.get=async()=>({size:8,body:'raw untrusted',customMetadata:{}});
  assert.equal((await handle(req(),env,now)).status,404);
  env.DB.sqlite.exec("UPDATE stations SET status='pending_review'");
  assert.equal((await handle(req(),env,now)).status,404);
  assert.equal((await handle(new Request('https://native.example/artwork/../../private'),env,now)).status,404);
});
