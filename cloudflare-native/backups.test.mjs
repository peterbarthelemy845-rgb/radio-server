import {test} from 'node:test';import assert from 'node:assert/strict';import {operationsFixture} from './operations-fixture.mjs';import {createBackup,restoreBackup,backupRoutes} from './backups.mjs';
import {encrypt,decrypt} from './security.mjs';
test('encrypted snapshot restores matching records and independent media copies while retaining newer records',async()=>{const f=await operationsFixture();const key='b'.repeat(64)+'.png';f.sqlite.prepare('UPDATE stations SET artwork_key=? WHERE code=?').run(key,f.station);await f.env.MEDIA.put('sanitized/'+key,new Uint8Array([1,2,3]),{customMetadata:{sanitizer_version:'1'}});const backup=await createBackup(f.env,f.now);assert.equal(backup.media,1);const manifest=await f.env.MEDIA.get('backups/'+backup.id+'/manifest.enc');assert.ok(!(await manifest.text()).includes('owner@example.com'));f.sqlite.prepare("UPDATE stations SET bio='Changed'").run();f.sqlite.prepare("INSERT INTO stations(name,stream_url,contact_email,status,created_at,updated_at) VALUES ('New','https://example.net/live','new@example.net','published',?,?)").run(f.now,f.now);await f.env.MEDIA.put('sanitized/'+key,new Uint8Array([9]));f.owner();await restoreBackup(f.env,backup.id,f.now+10);assert.equal(f.sqlite.prepare('SELECT bio FROM stations WHERE code=?').get(f.station).bio,'Original bio');assert.equal(f.sqlite.prepare('SELECT count(*) n FROM stations').get().n,2);assert.deepEqual([...new Uint8Array(await (await f.env.MEDIA.get('sanitized/'+key)).arrayBuffer())],[1,2,3]);assert.equal(f.sqlite.prepare('SELECT owner_station FROM sessions').get().owner_station,null);});
test('backup admin requires MFA and restore refuses modified encrypted manifests',async()=>{const f=await operationsFixture();await assert.rejects(backupRoutes(f.request('/api/admin/backups'),f.env,f.now),e=>e.status===401);f.admin();const backup=await createBackup(f.env,f.now);const result=await (await backupRoutes(f.request('/api/admin/backups'),f.env,f.now)).json();assert.equal(result.backups.length,1);await assert.rejects(backupRoutes(f.request('/api/admin/backups',{action:'restore',id:backup.id}),f.env,f.now),e=>e.status===400);await f.env.MEDIA.put('backups/'+backup.id+'/manifest.enc','corrupted');await assert.rejects(restoreBackup(f.env,backup.id,f.now),e=>e.status===400);assert.equal(f.sqlite.prepare('SELECT bio FROM stations').get().bio,'Original bio');});

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
