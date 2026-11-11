import {test} from 'node:test';
import assert from 'node:assert/strict';
import {operationsFixture} from './operations-fixture.mjs';
import {createBackup,restoreBackup,BACKUP_TABLES} from './backups.mjs';
import {encrypt,decrypt} from './security.mjs';
import {STREAM_CHECK_LIFETIME} from './stream-verification.mjs';

async function fixture(){
 const f=await operationsFixture();f.sqlite.prepare('UPDATE stations SET email_verified_at=? WHERE code=?').run(f.now,f.station);
 const session=f.sqlite.prepare('SELECT token_hash FROM sessions').get().token_hash;
 const evidence=f.sqlite.prepare('INSERT INTO station_stream_checks(station_code,stream_url,revision,checked_at,expires,review_requested_at,session_hash) VALUES (?,?,?,?,?,?,?)');
 evidence.run(f.station,'https://example.com/live','initial',f.now,f.now+STREAM_CHECK_LIFETIME,null,session);
 const backup=await createBackup(f.env,f.now),path='backups/'+backup.id+'/manifest.enc';
 const snapshot=JSON.parse(await decrypt(f.env,await(await f.env.MEDIA.get(path)).text()));
 return {...f,session,evidence,backup,path,snapshot,async replace(snapshot){await f.env.MEDIA.put(path,await encrypt(f.env,JSON.stringify(snapshot)));}};
}

test('backups include current station evidence with no session provenance or ephemeral receipts',async()=>{
 const f=await fixture();
 f.sqlite.prepare('INSERT INTO stream_check_results VALUES (?,?,?,?,?)').run(f.session,'https://ephemeral.example.com/live','a'.repeat(32),f.now,f.now+STREAM_CHECK_LIFETIME);
 f.evidence.run(f.station,'https://old.example.com/live','b'.repeat(32),f.now,f.now+STREAM_CHECK_LIFETIME,null,f.session);
 const revision='c'.repeat(32);
 f.sqlite.prepare('INSERT INTO station_edits VALUES (?,?,?,?,?,?,?,?)').run(f.station,revision,f.now,'https://next.example.com/live','Pending bio',null,f.now,'Pending name');
 f.evidence.run(f.station,'https://next.example.com/live',revision,0,0,f.now,f.session);
 const backup=await createBackup(f.env,f.now),snapshot=JSON.parse(await decrypt(f.env,await(await f.env.MEDIA.get('backups/'+backup.id+'/manifest.enc')).text()));
 assert.ok(BACKUP_TABLES.includes('station_stream_checks'));assert.equal(BACKUP_TABLES.includes('stream_check_results'),false);
 assert.equal(Object.hasOwn(snapshot.tables,'stream_check_results'),false);
 assert.equal(snapshot.tables.station_stream_checks.length,2);
 assert.ok(snapshot.tables.station_stream_checks.every(row=>row.session_hash===null));
 assert.equal(JSON.stringify(snapshot).includes(f.session),false);
 assert.equal(JSON.stringify(snapshot).includes('ephemeral.example.com'),false);
 assert.equal(JSON.stringify(snapshot).includes('old.example.com'),false);
 assert.equal(backup.records,Object.values(snapshot.tables).reduce((total,rows)=>total+rows.length,0));
});

test('trusted current snapshots restore published data and exact proposal evidence while revoking receipts',async()=>{
 const f=await fixture(),revision='c'.repeat(32);
 f.sqlite.prepare('INSERT INTO station_edits VALUES (?,?,?,?,?,?,?,?)').run(f.station,revision,f.now,'https://next.example.com/live','Pending bio',null,f.now,'Pending name');
 f.evidence.run(f.station,'https://next.example.com/live',revision,0,0,f.now,f.session);
 const backup=await createBackup(f.env,f.now);
 f.sqlite.prepare('INSERT INTO stream_check_results VALUES (?,?,?,?,?)').run(f.session,'https://ephemeral.example.com/live','a'.repeat(32),f.now,f.now+STREAM_CHECK_LIFETIME);
 f.sqlite.exec('DELETE FROM station_stream_checks;DELETE FROM station_edits');
 f.evidence.run(f.station,'https://outdated.example.com/live','d'.repeat(32),f.now,f.now+STREAM_CHECK_LIFETIME,null,f.session);
 await restoreBackup(f.env,backup.id,f.now+STREAM_CHECK_LIFETIME+100);
 assert.equal(f.sqlite.prepare('SELECT status FROM stations WHERE code=?').get(f.station).status,'published');
 const rows=f.sqlite.prepare('SELECT stream_url,revision,checked_at,expires,review_requested_at,session_hash FROM station_stream_checks ORDER BY stream_url').all();
 assert.equal(rows.length,2);assert.ok(rows.every(row=>row.session_hash===null));
 assert.equal(rows[1].revision,revision);assert.equal(rows[1].checked_at,0);assert.equal(rows[1].expires,0);assert.equal(rows[1].review_requested_at,f.now);
 assert.equal(f.sqlite.prepare('SELECT count(*) n FROM stream_check_results').get().n,0);
});

test('legacy snapshots restore verified stations privately without rebasing proposals or unrelated evidence',async()=>{
 const f=await fixture(),revision='c'.repeat(32);
 f.snapshot.tables.station_edits.push({station_code:f.station,revision,base_updated_at:f.now,stream_url:'https://next.example.com/live',bio:'Pending bio',artwork_key:null,created_at:f.now,name:'Pending name'});
 delete f.snapshot.tables.station_stream_checks;await f.replace(f.snapshot);
 const later=f.sqlite.prepare("INSERT INTO stations(name,stream_url,contact_email,status,email_verified_at,created_at,updated_at) VALUES ('Later','https://later.example.com/live','later@example.com','published',?,?,?) RETURNING code").get(f.now,f.now,f.now).code;
 f.evidence.run(later,'https://later.example.com/live','initial',f.now,f.now+STREAM_CHECK_LIFETIME,null,f.session);
 await restoreBackup(f.env,f.backup.id,f.now+1);
 assert.equal(f.sqlite.prepare('SELECT status,updated_at FROM stations WHERE code=?').get(f.station).status,'pending_review');
 assert.equal(f.sqlite.prepare('SELECT updated_at FROM stations WHERE code=?').get(f.station).updated_at,f.now);
 assert.equal(f.sqlite.prepare('SELECT base_updated_at FROM station_edits WHERE station_code=?').get(f.station).base_updated_at,f.now);
 assert.equal(f.sqlite.prepare('SELECT count(*) n FROM station_stream_checks WHERE station_code=?').get(f.station).n,0);
 assert.equal(f.sqlite.prepare('SELECT count(*) n FROM station_stream_checks WHERE station_code=?').get(later).n,1);
 assert.equal(f.sqlite.prepare('SELECT status FROM stations WHERE code=?').get(later).status,'published');
});

test('legacy downgrade preserves blocked stations and keeps unverified published rows private',async()=>{
 const f=await fixture();
 for(const [name,status,verified] of [['Blocked','suspended',f.now],['Deleted','deleted',f.now],['Unverified','published',null]])f.sqlite.prepare('INSERT INTO stations(name,stream_url,contact_email,status,email_verified_at,created_at,updated_at) VALUES (?,?,?,?,?,?,?)').run(name,'https://example.com/live','owner@example.com',status,verified,f.now,f.now);
 const backup=await createBackup(f.env,f.now),path='backups/'+backup.id+'/manifest.enc',snapshot=JSON.parse(await decrypt(f.env,await(await f.env.MEDIA.get(path)).text()));delete snapshot.tables.station_stream_checks;await f.env.MEDIA.put(path,await encrypt(f.env,JSON.stringify(snapshot)));
 await restoreBackup(f.env,backup.id,f.now+1);
 assert.equal(f.sqlite.prepare("SELECT status FROM stations WHERE name='Blocked'").get().status,'suspended');
 assert.equal(f.sqlite.prepare("SELECT status FROM stations WHERE name='Deleted'").get().status,'deleted');
 assert.equal(f.sqlite.prepare("SELECT status FROM stations WHERE name='Unverified'").get().status,'pending_email');
});

test('malformed, unnormalized, foreign or unbound stream evidence fails before restoring any records',async()=>{
 const f=await fixture(),original=f.snapshot,before=f.sqlite.prepare('SELECT * FROM station_stream_checks').all();
 const changes=[
  s=>s.tables.station_stream_checks[0].station_code=999,
  s=>s.tables.station_stream_checks[0].stream_url='https://other.example.com/live',
  s=>s.tables.station_stream_checks[0].stream_url='HTTPS://EXAMPLE.COM/live',
  s=>s.tables.station_stream_checks[0].revision='INVALID',
  s=>s.tables.station_stream_checks[0].session_hash=f.session,
  s=>s.tables.station_stream_checks[0].checked_at=-1,
  s=>s.tables.station_stream_checks[0].checked_at=f.now+1,
  s=>s.tables.station_stream_checks[0].expires=f.now+STREAM_CHECK_LIFETIME+1,
  s=>s.tables.station_stream_checks[0].expires=f.now,
  s=>s.tables.station_stream_checks[0].checked_at=0,
  s=>s.tables.station_stream_checks[0].review_requested_at=f.now+1,
  s=>s.tables.station_stream_checks[0].review_requested_at=0,
  s=>s.tables.station_stream_checks.push({...s.tables.station_stream_checks[0]}),
  s=>delete s.tables.station_stream_checks[0].expires,
  s=>s.tables.stream_check_results=[],
 ];
 for(const change of changes){const snapshot=structuredClone(original);change(snapshot);await f.replace(snapshot);await assert.rejects(restoreBackup(f.env,f.backup.id,f.now+1),error=>error.status===400);assert.deepEqual(f.sqlite.prepare('SELECT * FROM station_stream_checks').all(),before);assert.equal(f.sqlite.prepare('SELECT status FROM stations').get().status,'published');}
 const snapshot=structuredClone(original),revision='c'.repeat(32);snapshot.tables.station_edits.push({station_code:f.station,revision,base_updated_at:f.now,stream_url:'https://next.example.com/live',bio:'Pending',artwork_key:null,created_at:f.now,name:'Next station'});snapshot.tables.station_stream_checks[0].stream_url='https://next.example.com/live';snapshot.tables.station_stream_checks[0].revision='d'.repeat(32);await f.replace(snapshot);await assert.rejects(restoreBackup(f.env,f.backup.id,f.now+1),error=>error.status===400);
});

test('historical promoted-revision evidence remains valid for the same approved URL',async()=>{
 const f=await fixture();f.snapshot.tables.station_stream_checks[0].revision='a'.repeat(32);await f.replace(f.snapshot);
 await restoreBackup(f.env,f.backup.id,f.now+1);assert.equal(f.sqlite.prepare('SELECT revision FROM station_stream_checks').get().revision,'a'.repeat(32));
});

test('receipt revocation, evidence replacement and legacy downgrade roll back if restore audit fails',async()=>{
 const f=await fixture();delete f.snapshot.tables.station_stream_checks;await f.replace(f.snapshot);
 f.sqlite.prepare('INSERT INTO stream_check_results VALUES (?,?,?,?,?)').run(f.session,'https://ephemeral.example.com/live','a'.repeat(32),f.now,f.now+STREAM_CHECK_LIFETIME);
 const before=f.sqlite.prepare('SELECT * FROM station_stream_checks').all();f.sqlite.exec("CREATE TRIGGER fail_stream_restore_audit BEFORE INSERT ON admin_audit BEGIN SELECT RAISE(ABORT, 'audit failed'); END");
 await assert.rejects(restoreBackup(f.env,f.backup.id,f.now+1,'test-admin'),/audit failed/);
 assert.deepEqual(f.sqlite.prepare('SELECT * FROM station_stream_checks').all(),before);assert.equal(f.sqlite.prepare('SELECT count(*) n FROM stream_check_results').get().n,1);assert.equal(f.sqlite.prepare('SELECT status FROM stations').get().status,'published');
});
