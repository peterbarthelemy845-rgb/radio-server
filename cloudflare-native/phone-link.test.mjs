import {test} from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import {phoneRoutes} from './phone-link.mjs';
import {authRoutes} from './owner-auth.mjs';
import {digest} from './security.mjs';
import {handle} from './worker.mjs';
const now=1800000000,host='https://native.example',radio='a'.repeat(32),secret='b'.repeat(64);
async function fixture(){
  const sqlite=new DatabaseSync(':memory:');sqlite.exec(readFileSync(new URL('./migrations/0001_core.sql',import.meta.url),'utf8'));
  const DB={prepare(sql){let args=[];const q={bind(...v){args=v;return q;},async first(){return sqlite.prepare(sql).get(...args)||null;},async all(){return {results:sqlite.prepare(sql).all(...args)};},async run(){return sqlite.prepare(sql).run(...args);}};return q;},async batch(qs){sqlite.exec('BEGIN');try{for(const q of qs)await q.run();sqlite.exec('COMMIT');}catch(e){sqlite.exec('ROLLBACK');throw e;}}};
  const env={DB,DATA_ENCRYPTION_KEY:'e'.repeat(64)};
  sqlite.prepare('INSERT INTO radios VALUES (?,?,?,?,?)').run(radio,await digest(secret),'My radio',now,now);
  sqlite.prepare('INSERT INTO radio_pairs VALUES (?,?,0)').run(radio,await digest('1234'));
  sqlite.prepare("INSERT INTO stations(name,stream_url,contact_email,status,created_at,updated_at) VALUES ('Test','https://example.com/live','owner@example.com','published',?,?)").run(now,now);
  async function browser(){const res=await authRoutes(new Request(host+'/api/session'),env,now);const state=await res.json(),cookie=res.headers.get('set-cookie').split(';')[0];
    return {async post(path,body){return phoneRoutes(new Request(host+'/api/phone/'+path,{method:'POST',headers:{Cookie:cookie,Origin:host,'X-CSRF-Token':state.csrf,'Content-Type':'application/json'},body:JSON.stringify(body)}),env,now,{human:async()=>{}});}};}
  async function poll(body){return handle(new Request(host+'/api/radio/poll',{method:'POST',headers:{Authorization:'Bearer '+secret,'Content-Type':'application/json'},body:JSON.stringify({radio_id:radio,...body})}),env,now);}
  return {sqlite,env,browser,poll};
}
test('phone cannot add until physical approval, then command is deduplicated and acknowledged',async()=>{
  const f=await fixture(),phone=await f.browser();
  await assert.rejects(phone.post('add',{radio_id:radio,station_code:'10'}),e=>e.status===403);
  const claim=await (await phone.post('claim',{device_code:'1234'})).json();
  assert.match(claim.confirmation_code,/^\d{4}$/);
  assert.equal((await (await phone.post('claim/status',{claim_id:claim.claim_id})).json()).state,'waiting');
  await f.poll({pair_claim_id:claim.claim_id,pair_decision:'approve'});
  const command=await (await phone.post('add',{radio_id:radio,station_code:'10'})).json();
  assert.equal((await (await phone.post('add',{radio_id:radio,station_code:'10'})).json()).command_id,command.command_id);
  await f.poll({ack_id:command.command_id,ack_status:'added'});
  assert.equal((await (await phone.post('command/status',{command_id:command.command_id})).json()).state,'added');
});
test('another browser cannot replace a pending pairing request or inspect it',async()=>{
  const f=await fixture(),one=await f.browser(),two=await f.browser();
  const claim=await (await one.post('claim',{device_code:'1234'})).json();
  await assert.rejects(two.post('claim',{device_code:'1234'}),e=>e.status===409);
  await assert.rejects(two.post('claim/status',{claim_id:claim.claim_id}),e=>e.status===404);
  const again=await (await one.post('claim',{device_code:'1234'})).json();
  assert.equal(again.claim_id,claim.claim_id);
});
test('denied and expired claims never grant station control; repeated guesses are limited',async()=>{
  const f=await fixture(),phone=await f.browser();
  const claim=await (await phone.post('claim',{device_code:'1234'})).json();
  await f.poll({pair_claim_id:claim.claim_id,pair_decision:'deny'});
  await assert.rejects(phone.post('add',{radio_id:radio,station_code:'10'}),e=>e.status===403);
  f.sqlite.prepare('UPDATE pair_claims SET expires=? WHERE id=?').run(now-1,claim.claim_id);
  assert.equal((await (await phone.post('claim/status',{claim_id:claim.claim_id})).json()).state,'expired');
  for(let i=0;i<4;i++)await assert.rejects(phone.post('claim',{device_code:'0000'}),e=>e.status===400);
  await assert.rejects(phone.post('claim',{device_code:'1234'}),e=>e.status===429);
});
test('revocation and station suspension block additional commands and status access',async()=>{
  const f=await fixture(),phone=await f.browser();const claim=await (await phone.post('claim',{device_code:'1234'})).json();
  await f.poll({pair_claim_id:claim.claim_id,pair_decision:'approve'});
  f.sqlite.exec("UPDATE stations SET status='suspended'");
  await assert.rejects(phone.post('add',{radio_id:radio,station_code:'10'}),e=>e.status===404);
  f.sqlite.exec("UPDATE stations SET status='published'");
  const command=await (await phone.post('add',{radio_id:radio,station_code:'10'})).json();
  f.sqlite.exec('DELETE FROM phone_radios');
  await assert.rejects(phone.post('command/status',{command_id:command.command_id}),e=>e.status===404);
  await assert.rejects(phone.post('add',{radio_id:radio,station_code:'10'}),e=>e.status===403);
});
