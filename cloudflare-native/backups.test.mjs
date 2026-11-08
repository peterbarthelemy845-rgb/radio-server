import {test} from 'node:test';import assert from 'node:assert/strict';import {operationsFixture} from './operations-fixture.mjs';import {createBackup,restoreBackup,backupRoutes,scheduledBackup} from './backups.mjs';
import {encrypt,decrypt} from './security.mjs';
import {supportRoutes} from './admin-support.mjs';
import {authRoutes} from './owner-auth.mjs';
test('encrypted snapshot restores matching records and independent media copies while retaining newer records',async()=>{const f=await operationsFixture();const key='b'.repeat(64)+'.png';f.sqlite.prepare('UPDATE stations SET artwork_key=? WHERE code=?').run(key,f.station);await f.env.MEDIA.put('sanitized/'+key,new Uint8Array([1,2,3]),{customMetadata:{sanitizer_version:'1'}});const backup=await createBackup(f.env,f.now);assert.equal(backup.media,1);const manifest=await f.env.MEDIA.get('backups/'+backup.id+'/manifest.enc');assert.ok(!(await manifest.text()).includes('owner@example.com'));f.sqlite.prepare("UPDATE stations SET bio='Changed'").run();f.sqlite.prepare("INSERT INTO stations(name,stream_url,contact_email,status,created_at,updated_at) VALUES ('New','https://example.net/live','new@example.net','published',?,?)").run(f.now,f.now);await f.env.MEDIA.put('sanitized/'+key,new Uint8Array([9]));f.owner();await restoreBackup(f.env,backup.id,f.now+10);assert.equal(f.sqlite.prepare('SELECT bio FROM stations WHERE code=?').get(f.station).bio,'Original bio');assert.equal(f.sqlite.prepare('SELECT count(*) n FROM stations').get().n,2);assert.deepEqual([...new Uint8Array(await (await f.env.MEDIA.get('sanitized/'+key)).arrayBuffer())],[1,2,3]);assert.equal(f.sqlite.prepare('SELECT owner_station FROM sessions').get().owner_station,null);});
test('backup admin requires MFA and restore refuses modified encrypted manifests',async()=>{const f=await operationsFixture();await assert.rejects(backupRoutes(f.request('/api/admin/backups'),f.env,f.now),e=>e.status===401);f.admin();const backup=await createBackup(f.env,f.now);const result=await (await backupRoutes(f.request('/api/admin/backups'),f.env,f.now)).json();assert.equal(result.backups.length,1);await assert.rejects(backupRoutes(f.request('/api/admin/backups',{action:'restore',id:backup.id}),f.env,f.now),e=>e.status===400);await f.env.MEDIA.put('backups/'+backup.id+'/manifest.enc','corrupted');await assert.rejects(restoreBackup(f.env,backup.id,f.now),e=>e.status===400);assert.equal(f.sqlite.prepare('SELECT bio FROM stations').get().bio,'Original bio');});
test('restore database changes, grant revocation and audit roll back together if audit insertion fails',async()=>{const f=await operationsFixture();f.admin();const key='b'.repeat(64)+'.png';f.sqlite.prepare('UPDATE stations SET artwork_key=?').run(key);await f.env.MEDIA.put('sanitized/'+key,new Uint8Array([1]),{customMetadata:{sanitizer_version:'1'}});const backup=await createBackup(f.env,f.now);f.sqlite.exec("UPDATE stations SET bio='Keep live database'");f.owner();f.sqlite.prepare('INSERT INTO phone_radios SELECT token_hash,?,? FROM sessions').run('radio-one',f.now+900);await f.env.MEDIA.put('sanitized/'+key,new Uint8Array([9]),{customMetadata:{sanitizer_version:'1'}});
 f.sqlite.exec("CREATE TRIGGER fail_restore_audit BEFORE INSERT ON admin_audit BEGIN SELECT RAISE(ABORT, 'test restore audit failure'); END");await assert.rejects(backupRoutes(f.request('/api/admin/backups',{action:'restore',confirm:'RESTORE',id:backup.id}),f.env,f.now+1),/test restore audit failure/);assert.equal(f.sqlite.prepare('SELECT bio FROM stations').get().bio,'Keep live database');assert.equal(f.sqlite.prepare('SELECT owner_station FROM sessions').get().owner_station,f.station);assert.equal(f.sqlite.prepare('SELECT count(*) n FROM phone_radios').get().n,1);assert.equal(f.sqlite.prepare('SELECT count(*) n FROM admin_audit').get().n,0);
 // R2 copies precede the database transaction and are deliberately documented
 // separately; the database must never claim to roll those copies back.
 assert.deepEqual([...new Uint8Array(await(await f.env.MEDIA.get('sanitized/'+key)).arrayBuffer())],[1]);f.sqlite.exec('DROP TRIGGER fail_restore_audit');const response=await(await backupRoutes(f.request('/api/admin/backups',{action:'restore',confirm:'RESTORE',id:backup.id}),f.env,f.now+2)).json();assert.match(response.message,/restored/);assert.equal(f.sqlite.prepare('SELECT bio FROM stations').get().bio,'Original bio');assert.equal(f.sqlite.prepare('SELECT owner_station FROM sessions').get().owner_station,null);assert.equal(f.sqlite.prepare('SELECT count(*) n FROM phone_radios').get().n,0);const audit=f.sqlite.prepare('SELECT * FROM admin_audit').get();assert.equal(audit.action,'backup-restore:'+backup.id);assert.equal(audit.actor_hash,f.sqlite.prepare('SELECT token_hash FROM sessions').get().token_hash);
});
test('restore revokes pending owner verification so an older in-flight code cannot restore its grant',async()=>{const f=await operationsFixture();f.admin();f.sqlite.prepare('UPDATE stations SET email_verified_at=?').run(f.now);const backup=await createBackup(f.env,f.now);f.owner();const post=(path,body)=>authRoutes(f.request('/api/owner/'+path,body),f.env,f.now,{human:async()=>{}}),challenge=await(await post('login',{email:'owner@example.com',code:String(f.station)})).json(),message=f.sqlite.prepare('SELECT encrypted_payload FROM mail_outbox ORDER BY rowid DESC LIMIT 1').get(),code=JSON.parse(await decrypt(f.env,message.encrypted_payload)).text.match(/code is (\d{6})/)[1];
 const batch=f.env.DB.batch;let release,arrived,paused=false;const reached=new Promise(resolve=>{arrived=resolve;}),waiting=new Promise(resolve=>{release=resolve;});f.env.DB.batch=async queries=>{if(!paused){paused=true;arrived();await waiting;}return batch(queries);};const pending=post('verify',{verification_id:challenge.verification_id,code});await reached;await restoreBackup(f.env,backup.id,f.now+1);release();await assert.rejects(pending,e=>e.status===400);assert.equal(f.sqlite.prepare('SELECT owner_station FROM sessions').get().owner_station,null);assert.equal(f.sqlite.prepare('SELECT count(*) n FROM email_verifications WHERE consumed_at IS NULL').get().n,0);assert.equal(f.sqlite.prepare('SELECT count(*) n FROM admin_sessions').get().n,1);assert.equal(f.sqlite.prepare('SELECT count(*) n FROM admin_mfa_sessions').get().n,1);
});

test('legacy backup restores pairing hashes with an unknown display code',async()=>{
 const f=await operationsFixture();f.sqlite.prepare('INSERT INTO radio_pairs(radio_id,code_hash,expires,code_encrypted) VALUES (?,?,?,?)').run('radio-one','original-hash',0,await encrypt(f.env,'1234'));
 const backup=await createBackup(f.env,f.now),path='backups/'+backup.id+'/manifest.enc';const snapshot=JSON.parse(await decrypt(f.env,await(await f.env.MEDIA.get(path)).text()));
 delete snapshot.tables.radio_pairs[0].code_encrypted;await f.env.MEDIA.put(path,await encrypt(f.env,JSON.stringify(snapshot)));
 f.sqlite.prepare('UPDATE radio_pairs SET code_hash=?,code_encrypted=?').run('newer-hash',await encrypt(f.env,'5678'));
 await restoreBackup(f.env,backup.id,f.now+10);
 const restored=f.sqlite.prepare('SELECT code_hash,expires,code_encrypted FROM radio_pairs').get();assert.equal(restored.code_hash,'original-hash');assert.equal(restored.expires,0);assert.equal(restored.code_encrypted,null);
});

test('legacy pairing compatibility still rejects other missing backup columns',async()=>{
 const f=await operationsFixture();f.sqlite.prepare('INSERT INTO radio_pairs(radio_id,code_hash,expires) VALUES (?,?,?)').run('radio-one','original-hash',0);
 const backup=await createBackup(f.env,f.now),path='backups/'+backup.id+'/manifest.enc';const original=JSON.parse(await decrypt(f.env,await(await f.env.MEDIA.get(path)).text()));
 f.sqlite.prepare("UPDATE stations SET bio='Keep live data'").run();
 for(const [table,column] of [['radio_pairs','code_hash'],['radio_pairs','expires'],['stations','name']]){
  const snapshot=structuredClone(original);delete snapshot.tables.radio_pairs[0].code_encrypted;delete snapshot.tables[table][0][column];
  await f.env.MEDIA.put(path,await encrypt(f.env,JSON.stringify(snapshot)));
  await assert.rejects(restoreBackup(f.env,backup.id,f.now+10),e=>e.status===400&&e.message==='Invalid backup row.');
  assert.equal(f.sqlite.prepare('SELECT bio FROM stations').get().bio,'Keep live data');
 }
});

test('inventory snapshots restore reported-empty state and legacy backups preserve newer reports',async()=>{
 const f=await operationsFixture();
 f.sqlite.prepare('INSERT INTO radio_station_inventory(radio_id,station_codes_json,reported_at) VALUES (?,?,?)').run('radio-one','[]',f.now);
 const backup=await createBackup(f.env,f.now),path='backups/'+backup.id+'/manifest.enc';
 const snapshot=JSON.parse(await decrypt(f.env,await(await f.env.MEDIA.get(path)).text()));
 assert.equal(snapshot.tables.radio_station_inventory[0].station_codes_json,'[]');
 f.sqlite.prepare('UPDATE radio_station_inventory SET station_codes_json=?,reported_at=?').run(JSON.stringify([String(f.station)]),f.now+10);
 await restoreBackup(f.env,backup.id,f.now+20);
 let row=f.sqlite.prepare('SELECT station_codes_json,reported_at FROM radio_station_inventory').get();
 assert.equal(row.station_codes_json,'[]');assert.equal(row.reported_at,f.now);
 delete snapshot.tables.radio_station_inventory;
 await f.env.MEDIA.put(path,await encrypt(f.env,JSON.stringify(snapshot)));
 f.sqlite.prepare('UPDATE radio_station_inventory SET station_codes_json=?,reported_at=?').run(JSON.stringify([String(f.station)]),f.now+30);
 await restoreBackup(f.env,backup.id,f.now+40);
 row=f.sqlite.prepare('SELECT station_codes_json,reported_at FROM radio_station_inventory').get();
 assert.equal(row.station_codes_json,JSON.stringify([String(f.station)]));assert.equal(row.reported_at,f.now+30);
});

test('legacy inventory compatibility rejects a malformed table or missing inventory columns',async()=>{
 const f=await operationsFixture();
 f.sqlite.prepare('INSERT INTO radio_station_inventory(radio_id,station_codes_json,reported_at) VALUES (?,?,?)').run('radio-one','[]',f.now);
 const backup=await createBackup(f.env,f.now),path='backups/'+backup.id+'/manifest.enc';
 const original=JSON.parse(await decrypt(f.env,await(await f.env.MEDIA.get(path)).text()));
 for(const invalid of [null,[{radio_id:'radio-one',station_codes_json:'[]'}]]){
  const snapshot=structuredClone(original);snapshot.tables.radio_station_inventory=invalid;
  await f.env.MEDIA.put(path,await encrypt(f.env,JSON.stringify(snapshot)));
  await assert.rejects(restoreBackup(f.env,backup.id,f.now+10),e=>e.status===400);
  assert.equal(f.sqlite.prepare('SELECT reported_at FROM radio_station_inventory').get().reported_at,f.now);
 }
});

test('support backups restore encrypted correspondence without requeuing email and preserve newer legacy replies',async()=>{
 const f=await operationsFixture();f.admin();const ticketId='e'.repeat(32);
 f.sqlite.prepare('INSERT INTO legal_requests(id,kind,encrypted_payload,created_at) VALUES (?,?,?,?)').run(ticketId,'support',await encrypt(f.env,JSON.stringify({name:'Listener',email:'listener@example.com',subject:'Help',message:'Original question'})),f.now);
 await supportRoutes(f.request('/api/admin/support',{ticket_id:ticketId,request_id:'backup_reply_00001',state:'review',reply:'An encrypted support reply.'}),f.env,f.now);
 const original=f.sqlite.prepare('SELECT * FROM support_replies').get(),backup=await createBackup(f.env,f.now),path='backups/'+backup.id+'/manifest.enc';
 const snapshot=JSON.parse(await decrypt(f.env,await(await f.env.MEDIA.get(path)).text()));
 assert.deepEqual(snapshot.tables.support_replies[0],{...original});assert.equal(JSON.stringify(snapshot.tables.support_replies).includes('listener@example.com'),false);
 f.sqlite.exec("DELETE FROM support_replies;DELETE FROM mail_outbox;");
 await restoreBackup(f.env,backup.id,f.now+10);
 assert.deepEqual({...f.sqlite.prepare('SELECT * FROM support_replies').get()},{...original});assert.equal(f.sqlite.prepare('SELECT count(*) n FROM mail_outbox').get().n,0);
 let thread=await(await supportRoutes(f.request('/api/admin/support?ticket_id='+ticketId),f.env,f.now+10)).json();assert.equal(thread.messages[0].body,'An encrypted support reply.');assert.equal(thread.messages[0].delivery.state,'unavailable');
 const retry=await(await supportRoutes(f.request('/api/admin/support',{ticket_id:ticketId,request_id:'backup_reply_00001',state:'review',reply:'An encrypted support reply.'}),f.env,f.now+10)).json();assert.equal(retry.duplicate,true);assert.equal(f.sqlite.prepare('SELECT count(*) n FROM mail_outbox').get().n,0);
 delete snapshot.tables.support_replies;await f.env.MEDIA.put(path,await encrypt(f.env,JSON.stringify(snapshot)));
 await supportRoutes(f.request('/api/admin/support',{ticket_id:ticketId,request_id:'backup_reply_00002',state:'closed',reply:'Keep this newer reply.'}),f.env,f.now+20);
 await restoreBackup(f.env,backup.id,f.now+30);
 assert.equal(f.sqlite.prepare('SELECT count(*) n FROM support_replies').get().n,2);
 thread=await(await supportRoutes(f.request('/api/admin/support?ticket_id='+ticketId),f.env,f.now+30)).json();assert.equal(thread.messages[1].body,'Keep this newer reply.');
});

test('legacy support compatibility still rejects malformed tables and missing or extra reply columns',async()=>{
 const f=await operationsFixture();f.admin();const ticketId='f'.repeat(32);
 f.sqlite.prepare('INSERT INTO legal_requests(id,kind,encrypted_payload,created_at) VALUES (?,?,?,?)').run(ticketId,'support',await encrypt(f.env,JSON.stringify({email:'listener@example.com'})),f.now);
 await supportRoutes(f.request('/api/admin/support',{ticket_id:ticketId,request_id:'backup_reply_00001',state:'review',reply:'Private reply.'}),f.env,f.now);
 const backup=await createBackup(f.env,f.now),path='backups/'+backup.id+'/manifest.enc',original=JSON.parse(await decrypt(f.env,await(await f.env.MEDIA.get(path)).text()));
 const row=original.tables.support_replies[0];const missing={...row};delete missing.encrypted_payload;
 for(const invalid of [null,{},[missing],[{...row,recipient:'injected@example.com'}]]){
  const snapshot=structuredClone(original);snapshot.tables.support_replies=invalid;await f.env.MEDIA.put(path,await encrypt(f.env,JSON.stringify(snapshot)));
  await assert.rejects(restoreBackup(f.env,backup.id,f.now+10),e=>e.status===400);
  assert.equal(f.sqlite.prepare('SELECT encrypted_payload FROM support_replies').get().encrypted_payload,row.encrypted_payload);
 }
});
test('more than 1000 share events are backed up and restored without losing report totals',async()=>{const f=await operationsFixture(),insert=f.sqlite.prepare('INSERT INTO share_events VALUES (?,?,?,?)');
 for(let i=0;i<1001;i++)insert.run(i.toString(16).padStart(32,'0'),f.station,i%2?'whatsapp':'more',f.now);
 const before=f.sqlite.prepare('SELECT channel,count(*) n FROM share_events GROUP BY channel ORDER BY channel').all(),backup=await createBackup(f.env,f.now);
 assert.equal(backup.records,1003);const snapshot=JSON.parse(await decrypt(f.env,await(await f.env.MEDIA.get('backups/'+backup.id+'/manifest.enc')).text()));assert.equal(snapshot.tables.share_events.length,1001);
 f.sqlite.exec('DELETE FROM share_events');await restoreBackup(f.env,backup.id,f.now+10);assert.deepEqual(f.sqlite.prepare('SELECT channel,count(*) n FROM share_events GROUP BY channel ORDER BY channel').all(),before);
});
test('large encrypted manifests accepted by create remain restorable within the plaintext capacity',async()=>{const f=await operationsFixture(),payload=await encrypt(f.env,JSON.stringify({email:'listener@example.com',message:'M'.repeat(2100)})),insert=f.sqlite.prepare('INSERT INTO legal_requests(id,kind,encrypted_payload,created_at) VALUES (?,?,?,?)');
 for(let i=0;i<1700;i++)insert.run(i.toString(16).padStart(32,'0'),'support',payload,f.now);
 const backup=await createBackup(f.env,f.now),manifest=await f.env.MEDIA.get('backups/'+backup.id+'/manifest.enc');assert.ok(manifest.size>12*1024*1024);
 f.sqlite.exec('DELETE FROM legal_requests');await restoreBackup(f.env,backup.id,f.now+10);assert.equal(f.sqlite.prepare('SELECT count(*) n FROM legal_requests').get().n,1700);assert.equal(f.sqlite.prepare('SELECT encrypted_payload FROM legal_requests LIMIT 1').get().encrypted_payload,payload);
});
test('record and escaped manifest byte ceilings fail explicitly before copying media or saving a partial manifest',async()=>{
 for(const overflow of ['records','bytes']){const f=await operationsFixture();if(overflow==='records'){const insert=f.sqlite.prepare('INSERT INTO share_events VALUES (?,?,?,?)');for(let i=0;i<49999;i++)insert.run(i.toString(16).padStart(32,'0'),f.station,'more',f.now);}
  else f.sqlite.prepare('UPDATE stations SET bio=?').run('\x00'.repeat(1500000));
  let reads=0;const get=f.env.MEDIA.get;f.env.MEDIA.get=async key=>{reads++;return get(key);};
  await assert.rejects(createBackup(f.env,f.now),e=>e.status===503&&e.message.includes(overflow==='records'?'50,000 records':'8 MiB'));
  assert.equal(reads,0);assert.equal(f.objects.size,0);const run=f.sqlite.prepare('SELECT state,error FROM backup_runs').get();assert.equal(run.state,'failed');assert.match(run.error,/Backup capacity reached/);
 }
});
test('more than 100 small media files roundtrip while an excessive file count fails clearly',async()=>{
 for(const count of [101,251]){const f=await operationsFixture(),insert=f.sqlite.prepare('INSERT INTO stations(name,stream_url,contact_email,artwork_key,status,created_at,updated_at) VALUES (?,?,?,?,?,?,?)');
  for(let i=0;i<count;i++){const key=i.toString(16).padStart(64,'0')+'.png';insert.run('Media '+i,'https://example.com/live','owner@example.com',key,'published',f.now,f.now);await f.env.MEDIA.put('sanitized/'+key,new Uint8Array([i%256]),{customMetadata:{sanitizer_version:'1'}});}
  if(count===251){await assert.rejects(createBackup(f.env,f.now),e=>e.status===503&&e.message.includes('250 media files'));continue;}
  const backup=await createBackup(f.env,f.now);assert.equal(backup.media,101);await f.env.MEDIA.delete('sanitized/'+'0'.repeat(64)+'.png');await restoreBackup(f.env,backup.id,f.now+10);assert.deepEqual([...new Uint8Array(await(await f.env.MEDIA.get('sanitized/'+'0'.repeat(64)+'.png')).arrayBuffer())],[0]);
 }
});
test('a transient daily storage failure retries after backoff and only one concurrent retry becomes ready',async()=>{const f=await operationsFixture(),key='b'.repeat(64)+'.png',at=Date.parse('2027-01-15T05:00:00Z')/1000;
 f.sqlite.prepare('UPDATE stations SET artwork_key=?').run(key);await f.env.MEDIA.put('sanitized/'+key,new Uint8Array([1]),{customMetadata:{sanitizer_version:'1'}});
 const get=f.env.MEDIA.get;f.env.MEDIA.get=async()=>{throw Error('temporary storage outage');};await assert.rejects(scheduledBackup(f.env,at),e=>e.status===503);f.env.MEDIA.get=get;
 await scheduledBackup(f.env,at+14*60);assert.equal(f.sqlite.prepare('SELECT count(*) n FROM backup_runs').get().n,1);
 const batch=f.env.DB.batch;let tail=Promise.resolve();f.env.DB.batch=queries=>{const result=tail.then(()=>batch(queries));tail=result.catch(()=>{});return result;};
 await Promise.all([scheduledBackup(f.env,at+15*60),scheduledBackup(f.env,at+15*60)]);
 const runs=f.sqlite.prepare('SELECT kind,state FROM backup_runs ORDER BY created_at').all();assert.deepEqual(runs.map(row=>({...row})),[{kind:'daily-failed',state:'failed'},{kind:'daily',state:'ready'}]);
 await scheduledBackup(f.env,at+2*3600);assert.equal(f.sqlite.prepare('SELECT count(*) n FROM backup_runs').get().n,2);
});
test('a stale daily attempt cannot overwrite the ready state of its replacement',async()=>{const f=await operationsFixture(),key='b'.repeat(64)+'.png',at=Date.parse('2027-01-15T05:00:00Z')/1000;
 f.sqlite.prepare('UPDATE stations SET artwork_key=?').run(key);await f.env.MEDIA.put('sanitized/'+key,new Uint8Array([1]),{customMetadata:{sanitizer_version:'1'}});
 const get=f.env.MEDIA.get;let unblock,started;const blocked=new Promise(resolve=>{unblock=resolve;}),reading=new Promise(resolve=>{started=resolve;});let reads=0;
 f.env.MEDIA.get=async key=>{if(reads++===0){started();await blocked;}return get(key);};
 const old=createBackup(f.env,at,'daily');await reading;const replacement=await createBackup(f.env,at+3601,'daily');unblock();await assert.rejects(old,e=>e.status===503&&e.message.includes('superseded'));
 assert.equal(f.sqlite.prepare('SELECT state FROM backup_runs WHERE id=?').get(replacement.id).state,'ready');assert.equal(f.sqlite.prepare("SELECT count(*) n FROM backup_runs WHERE kind='daily-failed' AND state='failed'").get().n,1);assert.equal(f.sqlite.prepare("SELECT count(*) n FROM backup_runs WHERE state='ready'").get().n,1);
});
