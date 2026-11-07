import {test} from 'node:test';
import assert from 'node:assert/strict';
import {operationsFixture} from './operations-fixture.mjs';
import {handle} from './worker.mjs';
import {controlRoutes,pollControls} from './radio-controls.mjs';
import {phoneRoutes} from './phone-link.mjs';
import {digest} from './security.mjs';
import {createBackup,restoreBackup} from './backups.mjs';

const radio='a'.repeat(32),other='c'.repeat(32),secret='b'.repeat(64),origin='https://radiolocals.com';
async function fixture(){
 const f=await operationsFixture(),hash=f.sqlite.prepare('SELECT token_hash FROM sessions').get().token_hash;
 f.sqlite.prepare('INSERT INTO radios(id,secret_hash,created_at,last_seen) VALUES (?,?,?,?)').run(radio,await digest(secret),f.now,f.now);
 f.sqlite.prepare('INSERT INTO phone_radios VALUES (?,?,?)').run(hash,radio,f.now+1800);
 const telemetry={firmware_version:'2026.11.07.1',remote_control_version:1,volume_percent:40,muted:false,current_station_code:f.station,saved_station_codes:[String(f.station)]};
 async function poll(body={},at=f.now,id=radio,key=secret){return (await handle(new Request(origin+'/api/radio/poll',{method:'POST',headers:{Authorization:'Bearer '+key,'Content-Type':'application/json'},body:JSON.stringify({radio_id:id,...body})}),f.env,at)).json();}
 async function post(path,body,at=f.now){return (await controlRoutes(f.request('/api/phone/control'+path,body),f.env,at)).json();}
 async function approve(){await poll(telemetry);const claim=await post('/authorize',{radio_id:radio});await poll({...telemetry,pair_claim_id:claim.claim_id,pair_decision:'approve',pair_scope:'control'});return claim;}
 return {...f,hash,telemetry,poll,post,approve};
}
test('legacy add-only grants require capable software and fresh explicit physical control approval',async()=>{
 const f=await fixture();
 await assert.rejects(f.post('',{radio_id:radio,action:'set_volume',value:30,request_id:'r'.repeat(32)}),e=>e.status===403);
 await assert.rejects(f.post('/authorize',{radio_id:radio}),e=>e.status===409);
 await f.poll(f.telemetry);const claim=await f.post('/authorize',{radio_id:radio});
 assert.equal((await f.poll(f.telemetry)).pair_scope,'control');
 const ignored=await f.poll({...f.telemetry,pair_claim_id:claim.claim_id,pair_decision:'approve'});
 assert.equal(ignored.claim_result,'waiting');assert.equal(f.sqlite.prepare('SELECT count(*) n FROM radio_control_grants').get().n,0);
 const old=await f.poll({pair_claim_id:claim.claim_id,pair_decision:'approve',pair_scope:'control'});assert.equal(old.claim_result,'waiting');
 await f.poll({...f.telemetry,pair_claim_id:claim.claim_id,pair_decision:'approve',pair_scope:'control'});
 assert.equal(f.sqlite.prepare('SELECT count(*) n FROM radio_control_grants').get().n,1);
 const state=await(await phoneRoutes(f.request('/api/phone/radios'),f.env,f.now)).json(),item=state.radios.find(r=>r.id===radio);
 assert.equal(item.controls_allowed,true);assert.equal(item.controls_ready,true);assert.equal(item.firmware_version,f.telemetry.firmware_version);assert.equal(item.current_station,'Test station');assert.equal(item.volume_percent,40);assert.equal(item.muted,false);
 assert.ok(!JSON.stringify(item).includes(secret));assert.ok(!JSON.stringify(item).includes(f.hash));
});
test('control writes enforce browser CSRF, grant scope and own command status',async()=>{
 const f=await fixture();await f.approve();
 const payload={radio_id:radio,action:'set_mute',value:true,request_id:'request-'+ 'a'.repeat(20)};
 const bad=new Request(origin+'/api/phone/control',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)});
 await assert.rejects(controlRoutes(bad,f.env,f.now),e=>e.status===403||e.status===401);
 const command=await f.post('',payload);
 const another=await operationsFixture();await assert.rejects(controlRoutes(another.request('/api/phone/control/status',{command_id:command.command_id}),f.env,f.now),e=>e.status===401||e.status===403||e.status===404);
 await assert.rejects(f.post('',{...payload,radio_id:other}),e=>e.status===403);
});
test('commands are absolute, bounded, deduplicated, leased and acknowledged only by their radio',async()=>{
 const f=await fixture();await f.approve();const body={radio_id:radio,action:'set_volume',value:65,request_id:'request-'+ 'b'.repeat(20)};
 const first=await f.post('',body),retry=await f.post('',body);assert.equal(first.command_id,retry.command_id);assert.equal(retry.duplicate,true);
 await assert.rejects(f.post('',{...body,value:66}),e=>e.status===409);
 await assert.rejects(f.post('',{...body,request_id:'request-'+ 'c'.repeat(20)}),e=>e.status===409);
 let delivered=await f.poll(f.telemetry);assert.equal(delivered.control_command_id,first.command_id);assert.equal(delivered.control_valid_id,first.command_id);assert.equal(delivered.control_value,65);assert.equal(delivered.control_expires_in,60);
 const leased=await f.poll(f.telemetry);assert.equal(leased.control_command_id,'');assert.equal(leased.control_valid_id,first.command_id);
 delivered=await f.poll(f.telemetry,f.now+11);assert.equal(delivered.control_command_id,first.command_id);assert.equal(delivered.control_expires_in,49);
 const accepted=await f.poll({...f.telemetry,control_ack_id:first.command_id,control_ack_status:'applied'},f.now+12);assert.equal(accepted.control_acknowledged_id,first.command_id);assert.equal(accepted.control_valid_id,'');
 assert.equal((await f.post('/status',{command_id:first.command_id},f.now+12)).state,'applied');
 assert.equal((await f.post('',body,f.now+12)).state,'applied');assert.equal(f.sqlite.prepare('SELECT count(*) n FROM radio_control_commands').get().n,1);
 const duplicateAck=await f.poll({...f.telemetry,control_ack_id:first.command_id,control_ack_status:'failed'},f.now+13);assert.equal(duplicateAck.control_acknowledged_id,first.command_id);assert.equal((await f.post('/status',{command_id:first.command_id},f.now+13)).state,'applied');
});
test('station selection uses only fresh saved published codes and pauses behind a station addition',async()=>{
 const f=await fixture();await f.approve();
 await assert.rejects(f.post('',{radio_id:radio,action:'select_station',value:'99',request_id:'s'.repeat(32)}),e=>e.status===409);
 const body={radio_id:radio,action:'select_station',value:String(f.station),request_id:'t'.repeat(32)},command=await f.post('',body);
 f.sqlite.prepare("INSERT INTO radio_commands(id,radio_id,station_code,state,created_at,expires) VALUES ('old-add',?,?,'pending',?,?)").run(radio,f.station,f.now,f.now+300);
 const waiting=await f.poll(f.telemetry);assert.equal(waiting.control_command_id,'');assert.equal(waiting.control_valid_id,command.command_id);
 f.sqlite.prepare("UPDATE radio_commands SET state='added'").run();
 const delivered=await f.poll(f.telemetry);assert.equal(delivered.control_command_id,command.command_id);assert.equal(delivered.control_value,f.station);
 f.sqlite.prepare("UPDATE stations SET status='suspended' WHERE code=?").run(f.station);
 const suspended=await f.poll(f.telemetry,f.now+11);assert.equal(suspended.control_command_id,'');assert.equal(suspended.control_valid_id,'');
});
test('validity is scoped to the authenticated radio and ends on expiry or capability downgrade',async()=>{
 const f=await fixture();await f.approve();const command=await f.post('',{radio_id:radio,action:'set_volume',value:25,request_id:'validity-request-0001'});
 assert.equal((await pollControls(f.env,radio,f.telemetry,f.now)).control_valid_id,command.command_id);
 assert.equal((await pollControls(f.env,other,f.telemetry,f.now)).control_valid_id,'');
 assert.equal((await pollControls(f.env,radio,{},f.now+1)).control_valid_id,'');
 assert.equal((await pollControls(f.env,radio,f.telemetry,f.now+59)).control_valid_id,command.command_id);
 const expired=await pollControls(f.env,radio,f.telemetry,f.now+60);assert.equal(expired.control_valid_id,'');assert.equal(expired.control_command_id,'');
});
test('deferred control validity ends when its phone or control grant expires or is revoked despite another linked phone',async()=>{
 for(const change of ['control-revoked','control-expired','phone-expired','phone-unlinked','command-cancelled']){
  const f=await fixture();await f.approve();const command=await f.post('',{radio_id:radio,action:'set_mute',value:true,request_id:'deferred-control-0001'});
  f.sqlite.prepare('INSERT INTO sessions(token_hash,csrf_hash,created_at,expires) VALUES (?,?,?,?)').run('d'.repeat(64),'e'.repeat(64),f.now,f.now+1800);
  f.sqlite.prepare('INSERT INTO phone_radios VALUES (?,?,?)').run('d'.repeat(64),radio,f.now+1800);
  assert.equal((await pollControls(f.env,radio,f.telemetry,f.now)).control_valid_id,command.command_id);
  if(change==='control-revoked')f.sqlite.prepare('DELETE FROM radio_control_grants WHERE radio_id=? AND session_hash=?').run(radio,f.hash);
  else if(change==='control-expired')f.sqlite.prepare('UPDATE radio_control_grants SET expires=? WHERE radio_id=? AND session_hash=?').run(f.now+1,radio,f.hash);
  else if(change==='phone-expired')f.sqlite.prepare('UPDATE phone_radios SET expires=? WHERE radio_id=? AND session_hash=?').run(f.now+1,radio,f.hash);
  else if(change==='phone-unlinked')f.sqlite.prepare('DELETE FROM phone_radios WHERE radio_id=? AND session_hash=?').run(radio,f.hash);
  else f.sqlite.prepare("UPDATE radio_control_commands SET state='failed' WHERE id=?").run(command.command_id);
  const cancelled=await pollControls(f.env,radio,f.telemetry,f.now+1);assert.equal(cancelled.control_valid_id,'',change);assert.equal(cancelled.control_command_id,'',change);
  assert.ok(f.sqlite.prepare('SELECT 1 FROM phone_radios WHERE radio_id=? AND expires>?').get(radio,f.now+1),'another phone remains linked');
 }
});
test('deferred station selection validity ends when saved inventory is removed or becomes stale',async()=>{
 for(const change of ['removed','stale']){
  const f=await fixture();await f.approve();const command=await f.post('',{radio_id:radio,action:'select_station',value:f.station,request_id:'station-validity-0001'});
  assert.equal((await pollControls(f.env,radio,f.telemetry,f.now)).control_valid_id,command.command_id);
  if(change==='removed')f.sqlite.prepare("UPDATE radio_station_inventory SET station_codes_json='[]' WHERE radio_id=?").run(radio);
  else f.sqlite.prepare('UPDATE radio_station_inventory SET reported_at=? WHERE radio_id=?').run(f.now-120,radio);
  const invalid=await pollControls(f.env,radio,f.telemetry,f.now+1);assert.equal(invalid.control_valid_id,'',change);assert.equal(invalid.control_command_id,'',change);
 }
});
test('offline, old-firmware and stale inventory reports cannot dispatch new controls',async()=>{
 const f=await fixture();await f.approve();
 await assert.rejects(f.post('',{radio_id:radio,action:'set_volume',value:10,request_id:'u'.repeat(32)},f.now+31),e=>e.status===409);
 await f.poll(f.telemetry,f.now+31);f.sqlite.prepare('UPDATE radio_station_inventory SET reported_at=? WHERE radio_id=?').run(f.now-121,radio);
 await assert.rejects(f.post('',{radio_id:radio,action:'select_station',value:f.station,request_id:'v'.repeat(32)},f.now+31),e=>e.status===409);
 const command=await f.post('',{radio_id:radio,action:'set_mute',value:true,request_id:'w'.repeat(32)},f.now+31);
 assert.equal((await f.poll({},f.now+32)).control_command_id,'');
 await assert.rejects(f.post('',{radio_id:radio,action:'set_mute',value:false,request_id:'x'.repeat(32)},f.now+32),e=>e.status===409);
 const late=await f.poll({...f.telemetry,control_ack_id:command.command_id,control_ack_status:'applied'},f.now+100);
 assert.equal(late.control_command_id,'');assert.equal(late.control_acknowledged_id,command.command_id);assert.equal((await f.post('/status',{command_id:command.command_id},f.now+100)).state,'expired');
});
test('unlinked phones and reset codes revoke controls and cannot replay historical approval',async()=>{
 const f=await fixture(),claim=await f.approve();
 await f.post('',{radio_id:radio,action:'set_volume',value:20,request_id:'y'.repeat(32)});
 await phoneRoutes(f.request('/api/phone/unlink',{radio_id:radio}),f.env,f.now);
 assert.equal(f.sqlite.prepare('SELECT count(*) n FROM radio_control_grants').get().n,0);assert.equal(f.sqlite.prepare('SELECT count(*) n FROM radio_control_commands').get().n,0);
 f.sqlite.prepare('INSERT INTO phone_radios VALUES (?,?,?)').run(f.hash,radio,f.now+1800);
 await f.poll({...f.telemetry,pair_claim_id:claim.claim_id,pair_decision:'approve',pair_scope:'control'});
 assert.equal(f.sqlite.prepare('SELECT count(*) n FROM radio_control_grants').get().n,0);
 await f.approve();await handle(new Request(origin+'/api/radio/link/reset',{method:'POST',headers:{Authorization:'Bearer '+secret,'Content-Type':'application/json'},body:JSON.stringify({radio_id:radio})}),f.env,f.now);
 assert.equal(f.sqlite.prepare('SELECT count(*) n FROM radio_control_grants').get().n,0);assert.equal(f.sqlite.prepare('SELECT count(*) n FROM phone_radios').get().n,0);
});
test('invalid values and unsupported actions do not queue work or overwrite accepted telemetry',async()=>{
 const f=await fixture();await f.approve();let n=0;
 for(const [action,value] of [['set_volume',-1],['set_volume',101],['set_volume',1.5],['set_volume','40'],['set_mute',1],['wifi_password','x'],['select_station','https://example.com']])await assert.rejects(f.post('',{radio_id:radio,action,value,request_id:'invalid-request-'+String(++n).padStart(8,'0')}),e=>e.status===400);
 for(const payload of [{volume_percent:101},{muted:'yes'},{firmware_version:'secret with spaces'},{remote_control_version:999},{current_station_code:'https://example.com'}])await assert.rejects(f.poll({...f.telemetry,...payload}),e=>e.status===400);
 assert.equal(f.sqlite.prepare('SELECT count(*) n FROM radio_control_commands').get().n,0);assert.equal(f.sqlite.prepare('SELECT volume_percent FROM radio_telemetry WHERE radio_id=?').get(radio).volume_percent,40);
});
test('restore does not preserve control permissions, telemetry or transient ticket access',async()=>{
 const f=await fixture();await f.approve();await f.post('',{radio_id:radio,action:'set_volume',value:20,request_id:'z'.repeat(32)});
 const snapshot=await createBackup(f.env,f.now);await restoreBackup(f.env,snapshot.id,f.now+5);
 for(const name of ['radio_control_grants','radio_control_commands','radio_telemetry','support_ticket_grants','support_status_verifications'])assert.equal(f.sqlite.prepare('SELECT count(*) n FROM '+name).get().n,0);
});
