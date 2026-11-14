import {test} from 'node:test';
import assert from 'node:assert/strict';
import {operationsFixture} from './operations-fixture.mjs';
import {createBackup,restoreBackup} from './backups.mjs';
import {supportRoutes} from './admin-support.mjs';
import {reportsRoutes} from './reports.mjs';
import {encrypt,decrypt} from './security.mjs';

const rows=(f,table)=>f.sqlite.prepare('SELECT * FROM '+table+' ORDER BY 1').all().map(row=>({...row}));
async function fixture(){
 const f=await operationsFixture(),ticket='a'.repeat(32),key='b'.repeat(64)+'.png';f.admin();
 f.sqlite.prepare('INSERT INTO legal_requests(id,kind,encrypted_payload,created_at) VALUES (?,?,?,?)').run(ticket,'support',await encrypt(f.env,JSON.stringify({name:'Listener',email:'listener@example.com',subject:'Help',message:'Original question'})),f.now);
 await supportRoutes(f.request('/api/admin/support/folder',{ticket_id:ticket,folder:'spam',request_id:'folder_request_0001'}),f.env,f.now);
 for(const [id,outcome] of [['c','share_sheet_completed'],['d','cancelled']]){
  const event={event_id:id.repeat(32),station_code:String(f.station),channel:'more'};await reportsRoutes(f.request('/api/events',{...event,phase:'attempt'}),f.env,f.now);await reportsRoutes(f.request('/api/events',{...event,phase:'outcome',outcome}),f.env,f.now);
 }
 f.sqlite.prepare('UPDATE stations SET artwork_key=? WHERE code=?').run(key,f.station);await f.env.MEDIA.put('sanitized/'+key,new Uint8Array([1,2,3]),{customMetadata:{sanitizer_version:'1'}});
 const backup=await createBackup(f.env,f.now),manifest='backups/'+backup.id+'/manifest.enc',snapshot=JSON.parse(await decrypt(f.env,await(await f.env.MEDIA.get(manifest)).text()));
 return {...f,ticket,key,backup,manifest,snapshot,async writeSnapshot(value){await f.env.MEDIA.put(manifest,await encrypt(f.env,JSON.stringify(value)));}};
}

test('backup restores durable support folders, folder audit actions and separate share outcomes without reviving session provenance',async()=>{
 const f=await fixture(),flags=rows(f,'support_ticket_flags'),actions=rows(f,'support_folder_actions'),outcomes=rows(f,'share_event_states');
 assert.equal(f.snapshot.tables.support_ticket_flags.length,1);assert.equal(f.snapshot.tables.support_folder_actions.length,1);assert.ok(f.snapshot.tables.share_event_states.every(row=>row.session_hash===''));assert.ok(outcomes.every(row=>row.session_hash.length===64));
 f.sqlite.exec('DELETE FROM support_folder_actions;DELETE FROM support_ticket_flags;DELETE FROM share_event_states;DELETE FROM share_events;');await f.env.MEDIA.put('sanitized/'+f.key,new Uint8Array([9]));const mailCount=rows(f,'mail_outbox').length;
 await restoreBackup(f.env,f.backup.id,f.now+10);
 assert.deepEqual(rows(f,'support_ticket_flags'),flags);assert.deepEqual(rows(f,'support_folder_actions'),actions);assert.deepEqual(rows(f,'share_event_states'),outcomes.map(row=>({...row,session_hash:''})));assert.equal(rows(f,'mail_outbox').length,mailCount,'restore must not queue support mail');assert.deepEqual([...new Uint8Array(await(await f.env.MEDIA.get('sanitized/'+f.key)).arrayBuffer())],[1,2,3]);
 f.owner();const report=await(await reportsRoutes(f.request('/api/owner/reports'),f.env,f.now+10)).json();assert.equal(report.stations[0].share_clicks,2);assert.deepEqual(report.share_outcomes.map(row=>[row.outcome,row.count]).sort(),[['cancelled',1],['share_sheet_completed',1]]);
 await assert.rejects(reportsRoutes(f.request('/api/events',{event_id:'c'.repeat(32),station_code:String(f.station),channel:'more',phase:'outcome',outcome:'cancelled'}),f.env,f.now+11),error=>error.status===404);
});

test('legacy backups keep newer folder decisions, audit actions and share outcomes while withdrawing old browser provenance',async()=>{
 const f=await fixture();for(const table of ['support_ticket_flags','support_folder_actions','share_event_states'])delete f.snapshot.tables[table];await f.writeSnapshot(f.snapshot);
 await supportRoutes(f.request('/api/admin/support/folder',{ticket_id:f.ticket,folder:'inbox',request_id:'folder_request_0002'}),f.env,f.now+1);
 f.sqlite.prepare("UPDATE share_event_states SET outcome='link_copied' WHERE event_id=?").run('c'.repeat(32));const flags=rows(f,'support_ticket_flags'),actions=rows(f,'support_folder_actions'),outcomes=rows(f,'share_event_states');
 await restoreBackup(f.env,f.backup.id,f.now+10);
 assert.deepEqual(rows(f,'support_ticket_flags'),flags);assert.deepEqual(rows(f,'support_folder_actions'),actions);assert.deepEqual(rows(f,'share_event_states'),outcomes.map(row=>({...row,session_hash:''})));assert.equal(rows(f,'support_folder_actions').length,2);
 const retry=await(await supportRoutes(f.request('/api/admin/support/folder',{ticket_id:f.ticket,folder:'spam',request_id:'folder_request_0001'}),f.env,f.now+11)).json();assert.equal(retry.duplicate,true);assert.equal(retry.folder,'inbox','an old idempotent action cannot reapply its obsolete Spam decision');
});

test('restore revokes temporary support and owner email proofs and drafts without recreating them from a snapshot',async()=>{
 const f=await fixture(),session=f.sqlite.prepare('SELECT token_hash FROM sessions').get().token_hash,emailHash='e'.repeat(64),verification='f'.repeat(32);f.owner();
 f.sqlite.prepare('INSERT INTO support_ticket_grants(session_hash,ticket_id,expires) VALUES (?,?,?)').run(session,f.ticket,f.now+900);
 f.sqlite.prepare('INSERT INTO support_status_verifications(id,session_hash,ticket_id,code_hash,expires,created_at) VALUES (?,?,?,?,?,?)').run(verification,session,f.ticket,'1'.repeat(64),f.now+900,f.now);
 f.sqlite.prepare('INSERT INTO support_sender_grants(session_hash,email_hash,verified_at,expires) VALUES (?,?,?,?)').run(session,emailHash,f.now,f.now+900);
 f.sqlite.prepare('INSERT INTO support_pending_tickets(id,session_hash,request_id,email_hash,payload_hash,encrypted_payload,code_hash,expires,created_at,sent_at) VALUES (?,?,?,?,?,?,?,?,?,?)').run('1'.repeat(32),session,'pending_ticket_0001',emailHash,'2'.repeat(64),await encrypt(f.env,'private draft'),'3'.repeat(64),f.now+900,f.now,f.now);
 f.sqlite.prepare('INSERT INTO support_problem_keys(problem_hash,ticket_id,created_at,expires) VALUES (?,?,?,?)').run('4'.repeat(64),f.ticket,f.now,f.now+900);
 f.sqlite.prepare('INSERT INTO email_verifications(id,session_hash,station_code,purpose,code_hash,expires,created_at) VALUES (?,?,?,?,?,?,?)').run(verification,session,f.station,'edit','5'.repeat(64),f.now+900,f.now);
 f.sqlite.prepare('INSERT INTO registration_requests(session_hash,request_id,payload_hash,state,lease_token,lease_until,station_code,verification_id,created_at,expires) VALUES (?,?,?,?,?,?,?,?,?,?)').run(session,'6'.repeat(32),'7'.repeat(64),'pending','8'.repeat(32),f.now+30,f.station,verification,f.now,f.now+900);
 const transient=['support_ticket_grants','support_status_verifications','support_sender_grants','support_pending_tickets','support_problem_keys','registration_requests'];assert.ok(transient.every(table=>rows(f,table).length===1));assert.ok(transient.every(table=>f.snapshot.tables[table]===undefined));
 await restoreBackup(f.env,f.backup.id,f.now+10);for(const table of transient)assert.equal(rows(f,table).length,0,table);const proof=f.sqlite.prepare('SELECT code_hash,consumed_at FROM email_verifications WHERE id=?').get(verification);assert.equal(proof.code_hash,'');assert.equal(proof.consumed_at,f.now+10);assert.equal(f.sqlite.prepare('SELECT owner_station FROM sessions').get().owner_station,null);assert.equal(rows(f,'support_ticket_flags').length,1);
});

test('malformed new support and share records are rejected before any media copy or live database mutation',async()=>{
 const f=await fixture();f.sqlite.prepare("UPDATE stations SET bio='Keep this live value'").run();await f.env.MEDIA.put('sanitized/'+f.key,new Uint8Array([9]));const liveFlags=rows(f,'support_ticket_flags'),liveActions=rows(f,'support_folder_actions'),liveOutcomes=rows(f,'share_event_states');
 const corruptions=[
  snapshot=>snapshot.tables.support_ticket_flags[0].folder='deleted',
  snapshot=>snapshot.tables.support_ticket_flags[0].reason='injected new reason',
  snapshot=>snapshot.tables.support_ticket_flags[0].actor_hash='not-a-hash',
  snapshot=>snapshot.tables.support_ticket_flags[0].ticket_id='e'.repeat(32),
  snapshot=>snapshot.tables.support_ticket_flags[0].updated_at=-1,
  snapshot=>snapshot.tables.support_ticket_flags[0].updated_at=f.now+1,
  snapshot=>snapshot.tables.support_ticket_flags.push({...snapshot.tables.support_ticket_flags[0]}),
  snapshot=>snapshot.tables.support_folder_actions[0].id='not-an-action-id',
  snapshot=>snapshot.tables.support_folder_actions[0].ticket_id='e'.repeat(32),
  snapshot=>snapshot.tables.support_folder_actions[0].request_id='short',
  snapshot=>snapshot.tables.support_folder_actions[0].request_hash='not-a-hash',
  snapshot=>snapshot.tables.support_folder_actions[0].operation_token='not-an-operation',
  snapshot=>snapshot.tables.support_folder_actions[0].actor_hash=null,
  snapshot=>snapshot.tables.support_folder_actions[0].folder='archive',
  snapshot=>snapshot.tables.support_folder_actions[0].created_at=1.5,
  snapshot=>snapshot.tables.support_folder_actions.push({...snapshot.tables.support_folder_actions[0]}),
  snapshot=>snapshot.tables.support_folder_actions.push({...snapshot.tables.support_folder_actions[0],id:'e'.repeat(32)}),
  snapshot=>snapshot.tables.share_event_states[0].event_id='not-an-event',
  snapshot=>snapshot.tables.share_event_states[0].event_id='e'.repeat(32),
  snapshot=>snapshot.tables.share_event_states[0].session_hash='e'.repeat(64),
  snapshot=>snapshot.tables.share_event_states[0].outcome='delivered_to_recipient',
  snapshot=>snapshot.tables.share_event_states[0].reported_at=f.now-1,
  snapshot=>snapshot.tables.share_event_states[0].reported_at=f.now+1,
  snapshot=>snapshot.tables.share_event_states.push({...snapshot.tables.share_event_states[0]}),
  snapshot=>snapshot.tables.legal_requests[0].kind='copyright',
  snapshot=>snapshot.tables.legal_requests.push({...snapshot.tables.legal_requests[0]}),
  snapshot=>snapshot.tables.share_events[0].channel='private_email',
  snapshot=>snapshot.tables.share_events[0].station_code=999999,
  snapshot=>snapshot.tables.share_events.push({...snapshot.tables.share_events[0]})
 ];
 const originalPut=f.env.MEDIA.put,originalBatch=f.env.DB.batch;let copies=0,mutations=0;f.env.MEDIA.put=async(key,...args)=>{if(!key.startsWith('backups/'))copies++;return originalPut(key,...args);};f.env.DB.batch=async queries=>{mutations++;return originalBatch(queries);};
 for(let i=0;i<corruptions.length;i++){
  const snapshot=structuredClone(f.snapshot);corruptions[i](snapshot);await f.writeSnapshot(snapshot);copies=0;mutations=0;
  await assert.rejects(restoreBackup(f.env,f.backup.id,f.now+10),error=>error.status===400,'corruption '+i);assert.equal(copies,0,'media copy '+i);assert.equal(mutations,0,'database batch '+i);assert.equal(f.sqlite.prepare('SELECT bio FROM stations').get().bio,'Keep this live value');assert.deepEqual(rows(f,'support_ticket_flags'),liveFlags);assert.deepEqual(rows(f,'support_folder_actions'),liveActions);assert.deepEqual(rows(f,'share_event_states'),liveOutcomes);
 }
 assert.deepEqual([...new Uint8Array(await(await f.env.MEDIA.get('sanitized/'+f.key)).arrayBuffer())],[9]);
});

test('malformed manifest roots and row collections fail cleanly before media changes',async()=>{
 const f=await fixture();for(const invalid of [null,[],{...f.snapshot,tables:[]},{...f.snapshot,tables:{...f.snapshot.tables,support_ticket_flags:null}},{...f.snapshot,tables:{...f.snapshot.tables,share_event_states:{}}}]){await f.writeSnapshot(invalid);await assert.rejects(restoreBackup(f.env,f.backup.id,f.now+10),error=>error.status===400);}
 assert.equal(rows(f,'support_ticket_flags').length,1);assert.equal(rows(f,'share_event_states').length,2);
});
