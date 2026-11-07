import {test} from 'node:test';import assert from 'node:assert/strict';import {DatabaseSync} from 'node:sqlite';import {readFileSync} from 'node:fs';
import {deviceRoutes} from './devices.mjs';import {digest,decrypt,mac} from './security.mjs';
const now=1800000000,id='a'.repeat(32),secret='b'.repeat(64),token='c'.repeat(64);
async function fixture(){const sqlite=new DatabaseSync(':memory:');for(const f of ['0001_core.sql','0006_enrollment.sql','0009_device_code.sql'])sqlite.exec(readFileSync(new URL('./migrations/'+f,import.meta.url),'utf8'));
 const DB={prepare(sql){let args=[];const q={bind(...v){args=v;return q;},async first(){return sqlite.prepare(sql).get(...args)||null;},async all(){return {results:sqlite.prepare(sql).all(...args)};},async run(){return sqlite.prepare(sql).run(...args);}};return q;},async batch(qs){sqlite.exec('BEGIN');try{for(const q of qs)await q.run();sqlite.exec('COMMIT');}catch(e){sqlite.exec('ROLLBACK');throw e;}}};
 sqlite.prepare('INSERT INTO device_enrollments(token_hash,expires) VALUES (?,?)').run(await digest(token),now+600);const env={DB,DATA_ENCRYPTION_KEY:'d'.repeat(64)};
 const post=(path,body={},at=now,device=id,credential=secret)=>deviceRoutes(new Request('https://native.example/api/radio/'+path,{method:'POST',headers:{Authorization:'Bearer '+credential,'Content-Type':'application/json'},body:JSON.stringify({radio_id:device,...body})}),env,at);return {env,sqlite,post};}
test('enrollment requires an unexpired admin token and cannot enroll another device with the same token',async()=>{const f=await fixture();await assert.rejects(f.post('enroll',{}),e=>e.status===403);await f.post('enroll',{enrollment_token:token});assert.equal(f.sqlite.prepare('SELECT count(*) n FROM radios').get().n,1);await f.post('enroll',{enrollment_token:token});await assert.rejects(f.post('enroll',{enrollment_token:token},now,'e'.repeat(32)),e=>e.status===403);const g=await fixture();await assert.rejects(g.post('enroll',{enrollment_token:token},now+601),e=>e.status===403);});
test('device codes remain stable and cannot be overwritten without reset or guessed credentials',async()=>{const f=await fixture();await f.post('enroll',{enrollment_token:token});let result=await(await f.post('link/start',{stable_pair_code:'1234'})).json();assert.equal(result.pair_code,'1234');assert.equal((await(await f.post('link/start',{stable_pair_code:'1234'})).json()).persistent,true);await assert.rejects(f.post('link/start',{stable_pair_code:'5678'}),e=>e.status===409);await assert.rejects(f.post('link/start',{stable_pair_code:'1234'},now,id,'f'.repeat(64)),e=>e.status===401);assert.equal(f.sqlite.prepare('SELECT code_hash FROM radio_pairs').get().code_hash.includes('1234'),false);});

test('new and reused device codes are encrypted and invalid credentials cannot backfill them',async()=>{
 const f=await fixture();await f.post('enroll',{enrollment_token:token});
 const created=await(await f.post('link/start')).json();
 let pair=f.sqlite.prepare('SELECT * FROM radio_pairs').get();
 assert.notEqual(pair.code_encrypted,created.pair_code);
 assert.match(pair.code_encrypted,/^[a-f0-9]{24}:[a-f0-9]+$/);
 assert.equal(await decrypt(f.env,pair.code_encrypted),created.pair_code);
 assert.equal(await mac(f.env,'device-code:'+created.pair_code),pair.code_hash);
 assert.deepEqual(Object.keys(created).sort(),['expires_in','pair_code','persistent']);
 f.sqlite.exec('UPDATE radio_pairs SET code_encrypted=NULL');
 await assert.rejects(f.post('link/start',{stable_pair_code:created.pair_code},now,id,'f'.repeat(64)),e=>e.status===401);
 assert.equal(f.sqlite.prepare('SELECT code_encrypted FROM radio_pairs').get().code_encrypted,null);
 await assert.rejects(f.post('link/start',{stable_pair_code:'98765432'}),e=>e.status===409);
 assert.equal(f.sqlite.prepare('SELECT code_encrypted FROM radio_pairs').get().code_encrypted,null);
 await f.post('link/start',{stable_pair_code:created.pair_code});
 pair=f.sqlite.prepare('SELECT * FROM radio_pairs').get();
 assert.equal(await decrypt(f.env,pair.code_encrypted),created.pair_code);
});
