import {test} from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import {fetchHandler,digest,handle,cleanup} from './worker.mjs';
const schema=readFileSync(new URL('./migrations/0001_core.sql',import.meta.url),'utf8');
function database(){
  const sqlite=new DatabaseSync(':memory:');sqlite.exec(schema);sqlite.exec(readFileSync(new URL('./migrations/0008_reports_backups.sql',import.meta.url),'utf8'));sqlite.exec(readFileSync(new URL('./migrations/0007_local_ads.sql',import.meta.url),'utf8'));
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
test('command leases suppress repeated delivery and ack is device-scoped',async()=>{
  const env=await fixture();
  env.DB.sqlite.prepare('INSERT INTO radio_commands VALUES (?,?,?,?,?,?,?)').run(command,id,10,'pending',now,now+300,0);
  assert.equal((await (await poll(env)).json()).command_id,command);
  assert.equal((await (await poll(env)).json()).command_id,'');
  await poll(env,{ack_id:command,ack_status:'added'});
  assert.equal(env.DB.sqlite.prepare('SELECT state FROM radio_commands').get().state,'added');
});
test('suspended station is never delivered to device',async()=>{
  const env=await fixture();
  env.DB.sqlite.prepare('INSERT INTO radio_commands VALUES (?,?,?,?,?,?,?)').run(command,id,10,'pending',now,now+300,0);
  env.DB.sqlite.exec("UPDATE stations SET status='suspended'");
  assert.equal((await (await poll(env)).json()).command_id,'');
});
test('reset revokes phone grants, pairing codes, claims, and pending commands',async()=>{
  const env=await fixture();
  env.DB.sqlite.prepare('INSERT INTO phone_radios VALUES (?,?,?)').run('session',id,now+300);
  env.DB.sqlite.prepare('INSERT INTO radio_pairs VALUES (?,?,?)').run(id,'hash',0);
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
