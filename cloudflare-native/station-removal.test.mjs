import {test} from 'node:test';
import assert from 'node:assert/strict';
import {operationsFixture} from './operations-fixture.mjs';
import {handle,cleanup} from './worker.mjs';
import {controlRoutes} from './radio-controls.mjs';
import {phoneRoutes} from './phone-link.mjs';
import {createBackup,restoreBackup} from './backups.mjs';
import {digest} from './security.mjs';
import {authRoutes} from './owner-auth.mjs';
import {DatabaseSync} from 'node:sqlite';
import {readdirSync,readFileSync} from 'node:fs';
import {encrypt,decrypt} from './security.mjs';

const radio='a'.repeat(32),other='c'.repeat(32),secret='b'.repeat(64),origin='https://radiolocals.com';
async function fixture(){
 const f=await operationsFixture(),hash=f.sqlite.prepare('SELECT token_hash FROM sessions').get().token_hash;
 f.sqlite.prepare('INSERT INTO radios(id,secret_hash,created_at,last_seen) VALUES (?,?,?,?)').run(radio,await digest(secret),f.now,f.now);
 f.sqlite.prepare('INSERT INTO phone_radios VALUES (?,?,?)').run(hash,radio,f.now+1800);
 const telemetry={firmware_version:'2026.11.19.1',remote_control_version:1,station_removal_version:1,volume_percent:40,muted:false,current_station_code:f.station,saved_station_codes:[String(f.station)]};
 const poll=async(body={},at=f.now,id=radio)=>(await handle(new Request(origin+'/api/radio/poll',{method:'POST',headers:{Authorization:'Bearer '+secret,'Content-Type':'application/json'},body:JSON.stringify({radio_id:id,...body})}),f.env,at)).json();
 const post=async(path,body,at=f.now)=>(await controlRoutes(f.request('/api/phone/control'+path,body),f.env,at)).json();
 async function approve(body=telemetry){await poll(body);const claim=await post('/authorize',{radio_id:radio});await poll({...body,pair_claim_id:claim.claim_id,pair_decision:'approve',pair_scope:'control'});return claim;}
 const remove=(request_id='d'.repeat(32),value=f.station)=>({radio_id:radio,action:'remove_station',value,request_id});
 return {...f,hash,telemetry,poll,post,approve,remove};
}

test('removal needs explicit physical control approval and separately advertised software support',async()=>{
 const f=await fixture();await f.poll(f.telemetry);
 await assert.rejects(f.post('',f.remove()),e=>e.status===403);
 await f.approve({...f.telemetry,station_removal_version:0});
 await assert.rejects(f.post('',f.remove()),e=>e.status===409&&e.message.includes('Update your radio software'));
 assert.equal(f.sqlite.prepare('SELECT count(*) n FROM radio_control_commands').get().n,0);
 const listed=await(await phoneRoutes(f.request('/api/phone/radios'),f.env,f.now)).json();
 assert.equal(listed.radios[0].station_removal_version,0);assert.equal(listed.radios[0].removal_ready,false);
 await f.poll(f.telemetry);
 const current=await(await phoneRoutes(f.request('/api/phone/radios'),f.env,f.now)).json();
 assert.equal(current.radios[0].station_removal_version,1);assert.equal(current.radios[0].removal_ready,true);
 await assert.rejects(f.poll({...f.telemetry,station_removal_version:'1'}),e=>e.status===400);
});

test('removal is acknowledged only with a fresh complete list omitting its station, including the last saved item',async()=>{
 const f=await fixture();await f.approve();const accepted=await f.post('',f.remove());
 assert.equal(accepted.state,'pending');const delivered=await f.poll(f.telemetry,f.now+1);
 assert.equal(delivered.control_command_id,accepted.command_id);assert.equal(delivered.control_action,'remove_station');assert.equal(delivered.control_value,f.station);
 for(const [offset,body] of [[2,{...f.telemetry}],[3,{...f.telemetry,saved_station_codes:undefined}],[4,{...f.telemetry,station_removal_version:0,saved_station_codes:[]}]]){
  const result=await f.poll({...body,control_ack_id:accepted.command_id,control_ack_status:'applied'},f.now+offset);
  assert.equal(result.control_acknowledged_id,'');assert.notEqual((await f.post('/status',{command_id:accepted.command_id},f.now+offset)).state,'applied');
 }
 const applied=await f.poll({...f.telemetry,current_station_code:null,saved_station_codes:[],control_ack_id:accepted.command_id,control_ack_status:'applied'},f.now+5);
 assert.equal(applied.control_acknowledged_id,accepted.command_id);assert.equal((await f.post('/status',{command_id:accepted.command_id},f.now+5)).state,'applied');
 const inventory=await(await phoneRoutes(f.request('/api/phone/stations?radio_id='+radio),f.env,f.now+5)).json();
 assert.deepEqual(inventory.saved_station_codes,[]);assert.deepEqual(inventory.removable_station_codes,[]);
 const retry=await f.post('',f.remove(),f.now+100);
 assert.equal(retry.command_id,accepted.command_id);assert.equal(retry.state,'applied');assert.equal(retry.duplicate,true,'lost responses reconcile before fresh capability/membership checks');
 assert.equal(f.sqlite.prepare('SELECT count(*) n FROM radio_control_commands').get().n,1);
});

test('a failed or expired removal never fabricates success and command status is browser scoped',async()=>{
 const f=await fixture();await f.approve();const accepted=await f.post('',f.remove());await f.poll(f.telemetry);
 await f.poll({...f.telemetry,control_ack_id:accepted.command_id,control_ack_status:'failed'},f.now+1);
 assert.equal((await f.post('/status',{command_id:accepted.command_id},f.now+1)).state,'failed');
 const second=await f.post('',f.remove('e'.repeat(32)),f.now+1);
 const stranger=await operationsFixture();await assert.rejects(controlRoutes(stranger.request('/api/phone/control/status',{command_id:second.command_id}),f.env,f.now+2),e=>[401,403,404].includes(e.status));
 await f.poll({...f.telemetry,saved_station_codes:[],control_ack_id:second.command_id,control_ack_status:'applied'},f.now+62);
 assert.equal((await f.post('/status',{command_id:second.command_id},f.now+62)).state,'expired');
});

test('saved obsolete station codes can be removed privately without republishing or revealing their metadata',async()=>{
 const f=await fixture();const telemetry={...f.telemetry,saved_station_codes:[String(f.station),'999999']};await f.approve(telemetry);
 f.sqlite.prepare("UPDATE stations SET status='suspended' WHERE code=?").run(f.station);
 const inventory=await(await phoneRoutes(f.request('/api/phone/stations?radio_id='+radio),f.env,f.now)).json();
 assert.deepEqual(inventory.saved_station_codes,[]);assert.deepEqual(inventory.removable_station_codes,[String(f.station),'999999']);
 const first=await f.post('',f.remove());assert.equal((await f.poll(telemetry)).control_command_id,first.command_id);
 await f.poll({...telemetry,saved_station_codes:['999999'],control_ack_id:first.command_id,control_ack_status:'applied'},f.now+1);
 assert.equal((await f.post('/status',{command_id:first.command_id},f.now+1)).state,'applied');
 const unknown=await f.post('',f.remove('f'.repeat(32),999999),f.now+1);assert.equal(unknown.state,'pending');
 assert.equal(f.sqlite.prepare('SELECT status FROM stations WHERE code=?').get(f.station).status,'suspended');
});

test('legacy polls cannot receive a queued removal and stale or absent inventory cannot queue a new one',async()=>{
 const f=await fixture();await f.approve();const accepted=await f.post('',f.remove());
 const legacy=await f.poll({...f.telemetry,station_removal_version:undefined},f.now+1);
 assert.equal(legacy.control_command_id,'');assert.equal(legacy.control_valid_id,'');
 assert.equal((await f.poll(f.telemetry,f.now+2)).control_command_id,accepted.command_id);
 f.sqlite.prepare('UPDATE radio_station_inventory SET reported_at=? WHERE radio_id=?').run(f.now-121,radio);
 await assert.rejects(f.post('',f.remove('e'.repeat(32)),f.now+2),e=>e.status===409&&e.message.includes('latest saved list'));
 assert.equal((await f.poll(f.telemetry,f.now+3)).control_valid_id,accepted.command_id);
});

test('removal eligibility and permission are rechecked inside its atomic insert',async()=>{
 for(const change of ['capability','inventory','grant']){
  const f=await fixture();await f.approve();const batch=f.env.DB.batch.bind(f.env.DB);let raced=false;
  f.env.DB.batch=async statements=>{if(!raced){raced=true;if(change==='capability')f.sqlite.prepare('UPDATE radio_telemetry SET station_removal_version=0 WHERE radio_id=?').run(radio);
   else if(change==='inventory')f.sqlite.prepare("UPDATE radio_station_inventory SET station_codes_json='[]',all_station_codes_json='[]' WHERE radio_id=?").run(radio);
   else f.sqlite.prepare('DELETE FROM radio_control_grants WHERE session_hash=? AND radio_id=?').run(f.hash,radio);}return batch(statements);};
  await assert.rejects(f.post('',f.remove()),e=>e.status===409);assert(raced);assert.equal(f.sqlite.prepare('SELECT count(*) n FROM radio_control_commands').get().n,0,change);
 }
});

test('referenced physical authorization is idempotent and can be cancelled before its response exists',async()=>{
 const f=await fixture();await f.poll(f.telemetry);const request_id='d'.repeat(32),body={radio_id:radio,request_id};
 const first=await f.post('/authorize',body),retry=await f.post('/authorize',body);assert.equal(first.claim_id,retry.claim_id);
 assert.equal(f.sqlite.prepare('SELECT count(*) n FROM pair_claims').get().n,1);
 await f.post('/authorize/cancel',body);assert.equal(f.sqlite.prepare('SELECT state FROM pair_claims WHERE id=?').get(first.claim_id).state,'cancelled');
 await assert.rejects(f.post('/authorize',body),e=>e.status===409&&e.message.includes('cancelled'));
 const late={radio_id:radio,request_id:'e'.repeat(32)};await f.post('/authorize/cancel',late);
 await assert.rejects(f.post('/authorize',late),e=>e.status===409&&e.message.includes('cancelled'));
 assert.equal(f.sqlite.prepare('SELECT count(*) n FROM pair_claims').get().n,1,'cancel tombstone prevents the late request creating a physical prompt');
 const ack=await f.poll({...f.telemetry,pair_claim_id:first.claim_id,pair_decision:'approve',pair_scope:'control'});
 assert.equal(ack.claim_result,'cancelled');assert.equal(f.sqlite.prepare('SELECT count(*) n FROM radio_control_grants').get().n,0);
});

test('cancelling an approval never revokes a previously approved control grant or another browser prompt',async()=>{
 const f=await fixture();await f.approve();const body={radio_id:radio,request_id:'e'.repeat(32)},claim=await f.post('/authorize',body);
 await f.poll({...f.telemetry,pair_claim_id:claim.claim_id,pair_decision:'approve',pair_scope:'control'});
 await f.post('/authorize/cancel',body);assert.equal(f.sqlite.prepare('SELECT count(*) n FROM radio_control_grants').get().n,1);
 assert.equal(f.sqlite.prepare('SELECT state FROM pair_claims WHERE id=?').get(claim.claim_id).state,'approved');
 const waiting=await f.post('/authorize',{radio_id:radio,request_id:'f'.repeat(32)});
 const stranger=await authRoutes(new Request(origin+'/api/session'),f.env,f.now),state=await stranger.json();
 await controlRoutes(new Request(origin+'/api/phone/control/authorize/cancel',{method:'POST',headers:{Origin:origin,Cookie:stranger.headers.get('set-cookie').split(';')[0],'Content-Type':'application/json','X-CSRF-Token':state.csrf},body:JSON.stringify({radio_id:radio,request_id:'f'.repeat(32)})}),f.env,f.now);
 assert.equal(f.sqlite.prepare('SELECT state FROM pair_claims WHERE id=?').get(waiting.claim_id).state,'waiting');
});

test('transient control request receipts are cleaned and never restored as permissions',async()=>{
 const f=await fixture();await f.poll(f.telemetry);await f.post('/authorize/cancel',{radio_id:radio,request_id:'d'.repeat(32)});
 const snapshot=await createBackup(f.env,f.now);await restoreBackup(f.env,snapshot.id,f.now+1);
 assert.equal(f.sqlite.prepare('SELECT count(*) n FROM radio_control_requests').get().n,0);
 assert.equal(f.sqlite.prepare('SELECT count(*) n FROM radio_control_grants').get().n,0);
 f.sqlite.prepare('INSERT INTO radio_control_requests(session_hash,request_id,radio_id,state,created_at,expires) VALUES (?,?,?,\'cancelled\',?,?)').run(f.hash,'e'.repeat(32),radio,f.now,f.now+900);
 await cleanup(f.env,f.now+901);assert.equal(f.sqlite.prepare('SELECT count(*) n FROM radio_control_requests').get().n,0);
});

test('the removal migration preserves existing command receipts, foreign keys and old inventory',()=>{
 const sqlite=new DatabaseSync(':memory:');
 for(const name of readdirSync(new URL('./migrations/',import.meta.url)).filter(name=>name.endsWith('.sql')&&name<'0037').sort())sqlite.exec(readFileSync(new URL('./migrations/'+name,import.meta.url),'utf8'));
 const hash='d'.repeat(64);sqlite.prepare('INSERT INTO sessions(token_hash,csrf_hash,created_at,expires) VALUES (?,?,?,?)').run(hash,'e'.repeat(64),100,1000);
 sqlite.prepare('INSERT INTO radios(id,secret_hash,created_at,last_seen) VALUES (?,?,?,?)').run(radio,'f'.repeat(64),100,100);
 sqlite.prepare('INSERT INTO phone_radios VALUES (?,?,?)').run(hash,radio,1000);
 sqlite.prepare('INSERT INTO radio_telemetry(radio_id,remote_control_version,reported_at) VALUES (?,1,100)').run(radio);
 sqlite.prepare('INSERT INTO radio_station_inventory VALUES (?,\'["10"]\',100)').run(radio);
 sqlite.prepare("INSERT INTO radio_control_commands(id,session_hash,radio_id,request_id,request_hash,action,value_json,state,created_at,expires) VALUES (?,?,?,?,?,'set_volume','30','applied',100,160)").run('a'.repeat(32),hash,radio,'old-request','a'.repeat(64));
 const before=sqlite.prepare('SELECT * FROM radio_control_commands').get();
 sqlite.exec('BEGIN');sqlite.exec(readFileSync(new URL('./migrations/0037_station_removal.sql',import.meta.url),'utf8'));sqlite.exec('COMMIT');
 assert.deepEqual(sqlite.prepare('SELECT * FROM radio_control_commands').get(),before);
 assert.equal(sqlite.prepare('SELECT station_removal_version FROM radio_telemetry').get().station_removal_version,0);
 assert.equal(sqlite.prepare('SELECT all_station_codes_json FROM radio_station_inventory').get().all_station_codes_json,null);
 assert.deepEqual(sqlite.prepare('PRAGMA foreign_key_check').all(),[]);
 sqlite.prepare("INSERT INTO radio_control_commands(id,session_hash,radio_id,request_id,request_hash,action,value_json,state,created_at,expires) VALUES (?,?,?,?,?,'remove_station','10','pending',100,160)").run('b'.repeat(32),hash,radio,'new-request','b'.repeat(64));
 assert.throws(()=>sqlite.prepare("INSERT INTO radio_control_commands(id,session_hash,radio_id,request_id,request_hash,action,value_json,state,created_at,expires) VALUES (?,?,?,?,?,'remove_station','11','pending',100,160)").run('c'.repeat(32),hash,radio,'busy-request','c'.repeat(64)),/UNIQUE/);
 sqlite.close();
});

test('old inventory backups restore with unknown complete codes and malformed complete lists cannot alter data',async()=>{
 const f=await fixture();await f.poll(f.telemetry);const backup=await createBackup(f.env,f.now),path='backups/'+backup.id+'/manifest.enc';
 const original=JSON.parse(await decrypt(f.env,await(await f.env.MEDIA.get(path)).text()));
 for(const invalid of ['not-json','null','{}',JSON.stringify([10]),JSON.stringify(['1']),JSON.stringify(Array(101).fill('10'))]){
  const snapshot=structuredClone(original);snapshot.tables.radio_station_inventory[0].all_station_codes_json=invalid;
  await f.env.MEDIA.put(path,await encrypt(f.env,JSON.stringify(snapshot)));
  await assert.rejects(restoreBackup(f.env,backup.id,f.now+1),e=>e.status===400);
  assert.equal(f.sqlite.prepare('SELECT count(*) n FROM phone_radios').get().n,1,'validation precedes permission revocation');
 }
 const legacy=structuredClone(original);delete legacy.tables.radio_station_inventory[0].all_station_codes_json;
 await f.env.MEDIA.put(path,await encrypt(f.env,JSON.stringify(legacy)));await restoreBackup(f.env,backup.id,f.now+1);
 const restored=f.sqlite.prepare('SELECT * FROM radio_station_inventory WHERE radio_id=?').get(radio);
 assert.equal(restored.all_station_codes_json,null);assert.equal(restored.station_codes_json,JSON.stringify([String(f.station)]));
});
