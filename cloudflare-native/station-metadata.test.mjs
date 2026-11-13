import {test} from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import {operationsFixture} from './operations-fixture.mjs';
import {metadataOptions,stationMetadata} from './station-metadata.mjs';
import {authRoutes} from './owner-auth.mjs';
import {adminRoutes} from './admin.mjs';
import {stationState,publishStationEdit} from './station-edits.mjs';
import {directoryResponse,publicStation} from './public-directory.mjs';
import {createBackup,restoreBackup} from './backups.mjs';
import {decrypt,encrypt} from './security.mjs';

const page=async(f,params='')=>(await directoryResponse(new Request('https://radiolocals.com/api/stations'+params),f.env)).json();
const owner=async f=>(await authRoutes(f.request('/api/owner/station'),f.env,f.now)).json();
const save=(f,body)=>authRoutes(f.request('/api/owner/station',body),f.env,f.now);
const update=(station,extra={})=>({revision:station.revision,name:station.name,stream_url:station.stream_url,bio:station.bio,...extra});

test('metadata catalog validates exact optional values and legacy payloads preserve classifications',()=>{
 assert.deepEqual(metadataOptions.languages.map(item=>item.value),['en','ht','fr','es','pt','other']);assert.deepEqual(metadataOptions.categories.map(item=>item.value),['christian','news_talk','music','culture','other']);
 assert.deepEqual(stationMetadata({}),{language:'',category:''});assert.deepEqual(stationMetadata({}, {language:'ht',category:'christian'}),{language:'ht',category:'christian'});assert.deepEqual(stationMetadata({language:''},{language:'ht',category:'culture'}),{language:'',category:'culture'});
 for(const body of [{language:'HT'},{language:null},{language:[]},{language:'ht\u0000'},{category:'news'},{category:123},{category:'music OR 1=1'}])assert.throws(()=>stationMetadata(body),error=>error.status===400);
});

test('additive migration leaves old approved and proposed stations unclassified and constrains stored labels',()=>{
 const db=new DatabaseSync(':memory:');for(const file of ['0001_core.sql','0021_station_edits.sql','0023_station_edit_names.sql'])db.exec(readFileSync(new URL('./migrations/'+file,import.meta.url),'utf8'));
 db.prepare("INSERT INTO stations(name,stream_url,contact_email,created_at,updated_at) VALUES ('French-sounding name','https://example.com/live','owner@example.com',1,1)").run();db.prepare('INSERT INTO station_edits VALUES (?,?,?,?,?,?,?,?)').run(10,'a'.repeat(32),1,'https://example.com/new','Existing proposal',null,1,'Name');
 db.exec(readFileSync(new URL('./migrations/0025_station_metadata.sql',import.meta.url),'utf8'));for(const table of ['stations','station_edits']){assert.deepEqual({...db.prepare('SELECT language,category FROM '+table).get()},{language:'',category:''});assert.throws(()=>db.exec("UPDATE "+table+" SET language='unknown'"),/CHECK/);assert.throws(()=>db.exec("UPDATE "+table+" SET category=NULL"),/NOT NULL/);}
});

test('filtered SQL pagination reaches every matching published station beyond the first fifty',async()=>{
 const f=await operationsFixture(),insert=f.sqlite.prepare("INSERT INTO stations(name,stream_url,contact_email,status,created_at,updated_at,language,category) VALUES (?,'https://example.net/live','private@example.net',?,?,?,'ht',?)");
 f.sqlite.exec('BEGIN');for(let i=0;i<137;i++)insert.run('Community '+i,i<131?'published':'pending_review',f.now,f.now,i<124?'christian':'music');f.sqlite.exec('COMMIT');
 const first=await page(f,'?limit=50&language=ht&category=christian');assert.equal(first.stations.length,50);assert.equal(first.has_more,true);assert.equal(first.scanned_count,50);const all=[...first.stations];let cursor=first.next_cursor;
 while(cursor){const next=await page(f,'?limit=50&language=ht&category=christian&cursor='+encodeURIComponent(cursor));all.push(...next.stations);cursor=next.next_cursor;}
 assert.equal(all.length,124);assert.equal(new Set(all.map(item=>item.listener_code)).size,124);assert.ok(all.every(item=>item.language==='ht'&&item.category==='christian'));assert.equal(all.some(item=>Object.hasOwn(item,'contact_email')),false);
 assert.deepEqual(first.metadata_options,metadataOptions);assert.deepEqual(first.facets.languages,[{value:'ht',label:'Haitian Creole',count:131}]);assert.deepEqual(first.facets.categories,[{value:'christian',label:'Christian',count:124},{value:'music',label:'Music',count:7}]);
});

test('directory filters combine with accent-insensitive name/code search and cannot reuse another filter cursor',async()=>{
 const f=await operationsFixture(),insert=f.sqlite.prepare("INSERT INTO stations(name,stream_url,contact_email,status,created_at,updated_at,language,category) VALUES (?,'https://example.net/live','private@example.net','published',?,?,'fr','news_talk')");for(let i=0;i<5;i++)insert.run('Radio Éspérance '+i,f.now,f.now);
 const first=await page(f,'?limit=2&q=esperance&language=fr&category=news_talk');assert.equal(first.stations.length,2);const cursor=encodeURIComponent(first.next_cursor);
 for(const query of ['?limit=2&q=esperance&language=ht&category=news_talk','?limit=2&q=esperance&language=fr&category=music','?limit=2&q=esperance&language=fr','?limit=2&q=other&language=fr&category=news_talk'])await assert.rejects(page(f,query+'&cursor='+cursor),error=>error.status===400);
 const next=await page(f,'?limit=2&q=esp%C3%A9rance&language=fr&category=news_talk&cursor='+cursor);assert.equal(next.stations.length,2);assert.equal(next.stations[0].name,'Radio Éspérance 2');
 const code=first.stations[0].listener_code,byCode=await page(f,'?language=fr&q='+encodeURIComponent('#'+code));assert.equal(byCode.stations[0].listener_code,code);
 for(const query of ['?language=xx','?category=unknown','?language=ht&language=fr','?category=&category=music','?language=HT','?language=ht%00'])await assert.rejects(page(f,query),error=>error.status===400);
});

test('empty facets and unset metadata remain honest instead of guessing a station language',async()=>{
 const f=await operationsFixture(),result=await page(f);assert.deepEqual(result.facets,{languages:[],categories:[]});assert.equal(result.stations[0].language,'');assert.equal(result.stations[0].category,'');const none=await page(f,'?language=ht');assert.deepEqual(none.stations,[]);assert.equal(none.has_more,false);assert.deepEqual(none.metadata_options,metadataOptions);
});

test('owner metadata changes remain a private proposal with separate approved values and exact revision checks',async()=>{
 const f=await operationsFixture();f.owner();f.sqlite.prepare("UPDATE stations SET language='en',category='music',email_verified_at=? WHERE code=?").run(f.now,f.station);const loaded=await owner(f);assert.deepEqual(loaded.metadata_options,metadataOptions);
 const before=f.sqlite.prepare('SELECT * FROM stations').get(),response=await(await save(f,update(loaded.station,{language:'ht',category:'christian'}))).json();assert.equal(response.review_required,true);assert.deepEqual(f.sqlite.prepare('SELECT * FROM stations').get(),before);
 const draft=(await owner(f)).station;assert.equal(draft.language,'ht');assert.equal(draft.category,'christian');assert.equal(draft.approved.language,'en');assert.equal(draft.approved.category,'music');assert.notEqual(draft.revision,loaded.station.revision);const publicRow=await publicStation(f.env.DB,f.station);assert.equal(publicRow.language,'en');assert.equal(publicRow.category,'music');
 const pending=f.sqlite.prepare('SELECT * FROM station_edits').get();const noop=await(await save(f,update(draft))).json();assert.equal(noop.unchanged,true);assert.deepEqual(f.sqlite.prepare('SELECT * FROM station_edits').get(),pending);
 await assert.rejects(save(f,update(loaded.station,{language:'fr'})),error=>error.status===409);assert.equal((await owner(f)).station.language,'ht');
});

test('optional metadata enforces owner auth, enum validation and existing stream proof without uploading artwork',async()=>{
 const f=await operationsFixture();await assert.rejects(owner(f),error=>error.status===401);f.owner();const loaded=(await owner(f)).station;
 for(const metadata of [{language:'bad'},{category:'news'},{language:null},{category:['music']}])await assert.rejects(save(f,update(loaded,metadata)),error=>error.status===400);
 assert.equal(f.sqlite.prepare('SELECT count(*) AS n FROM station_edits').get().n,0);
 await assert.rejects(save(f,update(loaded,{language:'ht',stream_url:'https://different.example.com/live'})),error=>error.status===428);assert.equal((await owner(f)).station.language,'');
});

test('legacy owner writes preserve live metadata and explicit blanks clear it only in the proposal',async()=>{
 const f=await operationsFixture();f.owner();f.sqlite.prepare("UPDATE stations SET language='fr',category='culture' WHERE code=?").run(f.station);let loaded=(await owner(f)).station;
 await save(f,update(loaded,{bio:'Updated bio'}));loaded=(await owner(f)).station;assert.equal(loaded.language,'fr');assert.equal(loaded.category,'culture');
 await save(f,update(loaded,{language:'',category:''}));loaded=(await owner(f)).station;assert.equal(loaded.language,'');assert.equal(loaded.category,'');assert.equal(loaded.approved.language,'fr');assert.equal(loaded.approved.category,'culture');
});

test('administrator approval publishes reviewed metadata atomically and stale metadata cannot reuse an old review',async()=>{
 const f=await operationsFixture();f.owner();f.sqlite.prepare('UPDATE stations SET email_verified_at=?').run(f.now);const loaded=(await owner(f)).station;await save(f,update(loaded,{language:'ht',category:'news_talk'}));f.env.ADMIN_EMAIL='admin@example.com';f.admin();
 const reviewed=(await(await adminRoutes(f.request('/api/admin/stations'),f.env,f.now)).json()).stations[0];assert.equal(reviewed.pending_edit.language,'ht');assert.equal(reviewed.pending_edit.category,'news_talk');
 f.sqlite.prepare("UPDATE station_edits SET category='culture'").run();await assert.rejects(adminRoutes(f.request('/api/admin/station',{code:f.station,revision:reviewed.revision,action:'approve'}),f.env,f.now),error=>error.status===409);
 const latest=(await(await adminRoutes(f.request('/api/admin/stations'),f.env,f.now)).json()).stations[0];await adminRoutes(f.request('/api/admin/station',{code:f.station,revision:latest.revision,action:'approve'}),f.env,f.now);assert.equal(f.sqlite.prepare('SELECT count(*) AS n FROM station_edits').get().n,0);const published=await publicStation(f.env.DB,f.station);assert.equal(published.language,'ht');assert.equal(published.category,'culture');
});

test('publication SQL rejects metadata replaced after review even if proposal revision was not changed',async()=>{
 const f=await operationsFixture();f.owner();const loaded=(await owner(f)).station;await save(f,update(loaded,{language:'ht',category:'christian'}));const snapshot=await stationState(f.env,f.station),statement=publishStationEdit(f.env,snapshot.station,snapshot.pending,f.now);f.sqlite.prepare("UPDATE station_edits SET category='music'").run();const result=await statement.run();assert.equal(result.changes,0);assert.equal((await publicStation(f.env.DB,f.station)).category,'');
});

test('owner save SQL rejects approved metadata changed after its revision was read',async()=>{
 const f=await operationsFixture();f.owner();const loaded=(await owner(f)).station,prepare=f.env.DB.prepare;let raced=false;
 f.env.DB.prepare=sql=>{const statement=prepare(sql);if(sql.startsWith('INSERT INTO station_edits')){const first=statement.first;statement.first=async()=>{if(!raced){raced=true;f.sqlite.prepare("UPDATE stations SET category='culture'").run();}return first();};}return statement;};
 await assert.rejects(save(f,update(loaded,{language:'ht'})),error=>error.status===409);assert.equal(raced,true);assert.equal(f.sqlite.prepare('SELECT count(*) AS n FROM station_edits').get().n,0);assert.equal(f.sqlite.prepare('SELECT category FROM stations').get().category,'culture');
});

test('encrypted backups preserve approved/proposed metadata and old snapshots restore blank labels',async()=>{
 const f=await operationsFixture();f.owner();f.sqlite.prepare("UPDATE stations SET language='en',category='music',email_verified_at=?").run(f.now);const loaded=(await owner(f)).station;await save(f,update(loaded,{language:'ht',category:'christian'}));const backup=await createBackup(f.env,f.now),path='backups/'+backup.id+'/manifest.enc',snapshot=JSON.parse(await decrypt(f.env,await(await f.env.MEDIA.get(path)).text()));
 assert.equal(snapshot.tables.stations[0].language,'en');assert.equal(snapshot.tables.station_edits[0].category,'christian');f.sqlite.exec("UPDATE stations SET language='pt',category='other';UPDATE station_edits SET language='es',category='culture'");await restoreBackup(f.env,backup.id,f.now+1);assert.equal(f.sqlite.prepare('SELECT language FROM stations').get().language,'en');assert.equal(f.sqlite.prepare('SELECT language FROM station_edits').get().language,'ht');
 for(const table of ['stations','station_edits'])for(const row of snapshot.tables[table]){delete row.language;delete row.category;}await f.env.MEDIA.put(path,await encrypt(f.env,JSON.stringify(snapshot)));await restoreBackup(f.env,backup.id,f.now+2);for(const table of ['stations','station_edits'])assert.deepEqual({...f.sqlite.prepare('SELECT language,category FROM '+table).get()},{language:'',category:''});
});

test('invalid backup metadata fails before modifying live station data or proposal fields',async()=>{
 const f=await operationsFixture(),backup=await createBackup(f.env,f.now),path='backups/'+backup.id+'/manifest.enc',snapshot=JSON.parse(await decrypt(f.env,await(await f.env.MEDIA.get(path)).text()));f.sqlite.exec("UPDATE stations SET bio='Keep live data',language='ht'");
 for(const value of ['invalid',null,17]){snapshot.tables.stations[0].language=value;await f.env.MEDIA.put(path,await encrypt(f.env,JSON.stringify(snapshot)));await assert.rejects(restoreBackup(f.env,backup.id,f.now+1),error=>error.status===400);assert.equal(f.sqlite.prepare('SELECT bio FROM stations').get().bio,'Keep live data');assert.equal(f.sqlite.prepare('SELECT language FROM stations').get().language,'ht');}
});

test('invalid proposed metadata in a backup cannot replace its valid live proposal',async()=>{
 const f=await operationsFixture();f.owner();f.sqlite.prepare('UPDATE stations SET email_verified_at=?').run(f.now);const loaded=(await owner(f)).station;await save(f,update(loaded,{language:'ht',category:'christian'}));const backup=await createBackup(f.env,f.now),path='backups/'+backup.id+'/manifest.enc',snapshot=JSON.parse(await decrypt(f.env,await(await f.env.MEDIA.get(path)).text())),before=f.sqlite.prepare('SELECT * FROM station_edits').get();
 snapshot.tables.station_edits[0].category='adult-content';await f.env.MEDIA.put(path,await encrypt(f.env,JSON.stringify(snapshot)));await assert.rejects(restoreBackup(f.env,backup.id,f.now+1),error=>error.status===400);assert.deepEqual(f.sqlite.prepare('SELECT * FROM station_edits').get(),before);assert.equal(f.sqlite.prepare('SELECT language FROM stations').get().language,'');
});
