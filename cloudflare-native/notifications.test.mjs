import {test} from 'node:test';import assert from 'node:assert/strict';
import {ownerNotification,decisionReason,commitOwnerNotification} from './notifications.mjs';import {decrypt} from './security.mjs';
import {operationsFixture} from './operations-fixture.mjs';import {createBackup,restoreBackup} from './backups.mjs';import {adsRoutes} from './local-ads.mjs';
const env={DATA_ENCRYPTION_KEY:'a'.repeat(64)},adId='b'.repeat(32);
test('owner notifications use fixed subjects, encrypted plain text and revision decision keys',async()=>{
 const options={kind:'station-needs-changes',stationCode:10,recipient:'owner@example.com',event:{revision:1,stream_url:'https://private.example/?token=private-token'},reason:'Please replace the station artwork.'};
 const notice=await ownerNotification(env,options),again=await ownerNotification(env,options),updated=await ownerNotification(env,{...options,event:{revision:2}}),differentDecision=await ownerNotification(env,{...options,kind:'station-approved'});
 assert.equal(notice.id,again.id);assert.notEqual(notice.encrypted_payload,again.encrypted_payload);assert.notEqual(notice.id,updated.id);assert.notEqual(notice.id,differentDecision.id);
 assert.equal(notice.subject,'Your Radio Locals station needs changes');assert.equal(notice.encrypted_payload.includes(options.reason),false);
 const payload=JSON.parse(await decrypt(env,notice.encrypted_payload));assert.deepEqual(Object.keys(payload),['text']);assert.match(payload.text,/Station code: 10/);assert.match(payload.text,/Please replace the station artwork/);assert.equal(payload.text.includes('private.example'),false);assert.equal(payload.text.includes('private-token'),false);
 const ad=await ownerNotification(env,{kind:'ad-removed',stationCode:10,recipient:'owner@example.com',event:adId,adId});assert.match(JSON.parse(await decrypt(env,ad.encrypted_payload)).text,/Advertisement reference: b+/);
});
test('notification explanations are bounded and exclude links, email addresses and credentials',()=>{
 assert.equal(decisionReason(undefined,'Default explanation.'),'Default explanation.');assert.equal(decisionReason('  Please update the artwork.  '),'Please update the artwork.');
 for(const reason of ['x'.repeat(301),'Header\r\nBcc: other@example.com','See https://private.example/?token=abc','Visit example.com/private','Email owner@example.com','Use /api/private?token=abc','Password is hunter2','Bearer abc','verification code 123456','sk-proj-private','a'.repeat(64)])assert.throws(()=>decisionReason(reason),e=>e.status===400,reason);
});
test('invalid recipient, header injection and private artwork paths cannot form notifications',async()=>{
 const options={kind:'ad-approved',stationCode:10,recipient:'owner@example.com',event:1,adId};
 for(const invalid of [{recipient:'owner@example.com\r\nBcc: other@example.com'},{adId:'/api/private'},{kind:'Injected subject\n'},{stationCode:'10'}])await assert.rejects(ownerNotification(env,{...options,...invalid}));
});
test('reapproving an ad after restore applies its policy even when its pending or sent notice already exists',async()=>{
 for(const state of ['pending','sent','failed']){const f=await operationsFixture(),id='a'.repeat(32),art='b'.repeat(64)+'.png',pixels='c'.repeat(64)+'.bin';
  f.sqlite.prepare('UPDATE stations SET email_verified_at=?').run(f.now);f.sqlite.prepare('INSERT INTO local_ads(id,station_code,business,contact_email,message,artwork_key,created_at) VALUES (?,?,?,?,?,?,?)').run(id,f.station,'Test Shop','business@example.com','Welcome',art,f.now);f.sqlite.prepare('INSERT INTO ad_policy VALUES (?,?,?,?,?,?,?,?,?)').run(id,'555-0100',1,0,pixels,f.now,f.now+86400,'test-rights','hash');
  await f.env.MEDIA.put('sanitized/'+art,new Uint8Array([1]),{customMetadata:{sanitizer_version:'1'}});await f.env.MEDIA.put('ad-pixels/'+pixels,new Uint8Array(38912),{customMetadata:{pixel_version:'1'}});
  const backup=await createBackup(f.env,f.now);f.owner();const approve=async()=>(await adsRoutes(f.request('/api/owner/ads',{id,action:'approve'}),f.env,f.now+1)).json();assert.equal((await approve()).notification_queued,true);
  f.sqlite.prepare("UPDATE mail_outbox SET state=?,encrypted_payload=CASE WHEN ?='pending' THEN encrypted_payload ELSE '' END").run(state,state);const original=f.sqlite.prepare('SELECT * FROM mail_outbox').get();await restoreBackup(f.env,backup.id,f.now+2);f.owner();
  assert.equal((await approve()).notification_queued,false);assert.equal(f.sqlite.prepare('SELECT status FROM local_ads').get().status,'approved');assert.equal(f.sqlite.prepare('SELECT owner_approved FROM ad_policy').get().owner_approved,1);assert.deepEqual(f.sqlite.prepare('SELECT * FROM mail_outbox').get(),original);assert.equal(f.sqlite.prepare('SELECT count(*) n FROM notification_operations').get().n,0);
 }
});
test('deduplicated notices do not suppress later audit writes after a zero-change followup',async()=>{const f=await operationsFixture(),options={kind:'station-approved',stationCode:f.station,recipient:'owner@example.com',event:'same-restored-revision'};
 const apply=async()=>commitOwnerNotification(f.env,f.now,f.env.DB.prepare("UPDATE stations SET bio='Approved' WHERE code=? AND bio='Original bio'").bind(f.station),await ownerNotification(f.env,options),[
  {sql:"UPDATE local_ads SET status='deleted' WHERE id='not-found' AND OWNER_NOTIFICATION_APPLIED"},
  {sql:'INSERT INTO admin_audit(id,actor_hash,station_code,action,created_at) SELECT ?,?,?,?,? WHERE OWNER_NOTIFICATION_APPLIED',values:[crypto.randomUUID(),'administrator',f.station,'approve',f.now]}
 ]);
 assert.equal(await apply(),true);f.sqlite.exec("UPDATE stations SET bio='Original bio'");assert.equal(await apply(),true);assert.equal(f.sqlite.prepare('SELECT count(*) n FROM mail_outbox').get().n,1);assert.equal(f.sqlite.prepare('SELECT count(*) n FROM admin_audit').get().n,2);assert.equal(f.sqlite.prepare('SELECT count(*) n FROM notification_operations').get().n,0);
});
test('a stale mutation cannot gain side effects through another operation or an existing notice',async()=>{const f=await operationsFixture(),options={kind:'station-approved',stationCode:f.station,recipient:'owner@example.com',event:1};
 for(let i=0;i<2;i++)assert.equal(await commitOwnerNotification(f.env,f.now,f.env.DB.prepare("UPDATE stations SET bio='Changed' WHERE bio='No match'"),await ownerNotification(f.env,options),[{sql:'INSERT INTO admin_audit(id,actor_hash,action,created_at) SELECT ?,?,?,? WHERE OWNER_NOTIFICATION_APPLIED',values:[crypto.randomUUID(),'administrator','approve',f.now]}]),false);
 for(const table of ['mail_outbox','admin_audit','notification_operations'])assert.equal(f.sqlite.prepare('SELECT count(*) n FROM '+table).get().n,0);
});
test('failure to create or remove the private operation marker rolls back every decision side effect',async()=>{
 for(const phase of ['INSERT','DELETE']){const f=await operationsFixture();f.sqlite.exec(`CREATE TRIGGER fail_operation BEFORE ${phase} ON notification_operations BEGIN SELECT RAISE(ABORT, 'test marker failure'); END`);
  await assert.rejects(commitOwnerNotification(f.env,f.now,f.env.DB.prepare("UPDATE stations SET bio='Changed'"),await ownerNotification(f.env,{kind:'station-approved',stationCode:f.station,recipient:'owner@example.com',event:1}),[{sql:'INSERT INTO admin_audit(id,actor_hash,action,created_at) SELECT ?,?,?,? WHERE OWNER_NOTIFICATION_APPLIED',values:[crypto.randomUUID(),'administrator','approve',f.now]}]));
  assert.equal(f.sqlite.prepare('SELECT bio FROM stations').get().bio,'Original bio');for(const table of ['mail_outbox','admin_audit','notification_operations'])assert.equal(f.sqlite.prepare('SELECT count(*) n FROM '+table).get().n,0);
 }
});
test('concurrent decisions have one mutation winner and cannot borrow its notification operation',async()=>{const f=await operationsFixture(),batch=f.env.DB.batch;let tail=Promise.resolve();f.env.DB.batch=queries=>{const result=tail.then(()=>batch(queries));tail=result.catch(()=>{});return result;};
 const apply=async()=>commitOwnerNotification(f.env,f.now,f.env.DB.prepare("UPDATE stations SET bio='Approved' WHERE bio='Original bio'"),await ownerNotification(f.env,{kind:'station-approved',stationCode:f.station,recipient:'owner@example.com',event:1}),[{sql:'INSERT INTO admin_audit(id,actor_hash,action,created_at) SELECT ?,?,?,? WHERE OWNER_NOTIFICATION_APPLIED',values:[crypto.randomUUID(),'administrator','approve',f.now]}]);
 const results=await Promise.all([apply(),apply()]);assert.equal(results.filter(Boolean).length,1);for(const table of ['mail_outbox','admin_audit'])assert.equal(f.sqlite.prepare('SELECT count(*) n FROM '+table).get().n,1);assert.equal(f.sqlite.prepare('SELECT count(*) n FROM notification_operations').get().n,0);
});
