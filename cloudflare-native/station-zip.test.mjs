import {test} from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import {operationsFixture} from './operations-fixture.mjs';
import {metadataValue,stationMetadata} from './station-metadata.mjs';
import {directoryResponse,publicStation,publicStationBatch} from './public-directory.mjs';
import {nearbyZipCodes,zipLocationKnown} from './zip-locations.mjs';
import {authRoutes} from './owner-auth.mjs';
import {adminRoutes} from './admin.mjs';
import {stationState,publishStationEdit} from './station-edits.mjs';
import {createBackup,restoreBackup} from './backups.mjs';
import {encrypt,decrypt,mac} from './security.mjs';

const page=async(f,params='')=>(await directoryResponse(new Request('https://radiolocals.com/api/stations'+params),f.env)).json();
const owner=async f=>(await authRoutes(f.request('/api/owner/station'),f.env,f.now)).json();
const save=(f,station,extra={})=>authRoutes(f.request('/api/owner/station',{revision:station.revision,name:station.name,stream_url:station.stream_url,bio:station.bio,zip_code:station.zip_code||'00501',category:station.category||'other',...extra}),f.env,f.now);

test('ZIP values stay optional text and reject non-ASCII, partial, extended, numeric and oversized input',()=>{
 for(const value of ['', '00501','00000','10001','99999'])assert.equal(metadataValue('zip_code',value),value);
 for(const value of [501,10001,null,[],{},'0050','005010','00501-1234',' 00501','00501 ','００５０１','٠٠٥٠١','005\n1','005\u00001','00501\n','00501\r','00501\u0000ignored','x'.repeat(10000)])assert.throws(()=>metadataValue('zip_code',value),error=>error.status===400);
 assert.equal(stationMetadata({}, {language:'ht',category:'culture',zip_code:'00501'}).zip_code,'00501');assert.equal(stationMetadata({zip_code:''},{zip_code:'00501'}).zip_code,'');
});

test('migration leaves old approved and proposed ZIPs blank while retaining prior language and category',()=>{
 const db=new DatabaseSync(':memory:');for(const file of ['0001_core.sql','0021_station_edits.sql','0023_station_edit_names.sql','0025_station_metadata.sql'])db.exec(readFileSync(new URL('./migrations/'+file,import.meta.url),'utf8'));
 db.exec("INSERT INTO stations(name,stream_url,contact_email,created_at,updated_at,language,category) VALUES ('Station','https://example.com/live','owner@example.com',1,1,'ht','culture');INSERT INTO station_edits(station_code,revision,base_updated_at,stream_url,bio,created_at,name,language,category) VALUES (10,'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',1,'https://example.com/new','Bio',1,'Proposed','en','music');");
 db.exec(readFileSync(new URL('./migrations/0026_station_zip.sql',import.meta.url),'utf8'));
 assert.deepEqual({...db.prepare('SELECT language,category,zip_code FROM stations').get()},{language:'ht',category:'culture',zip_code:''});assert.deepEqual({...db.prepare('SELECT language,category,zip_code FROM station_edits').get()},{language:'en',category:'music',zip_code:''});
 for(const table of ['stations','station_edits']){db.exec("UPDATE "+table+" SET zip_code='00501'");assert.equal(db.prepare('SELECT zip_code,typeof(zip_code) AS kind FROM '+table).get().zip_code,'00501');for(const value of ['1234','123456','00501-0001','１２３４５','00501\n','00501\u0000ignored'])assert.throws(()=>db.prepare('UPDATE '+table+' SET zip_code=?').run(value),/CHECK/);}
});

test('ZIP plus category and search filters page through all matching public stations beyond fifty',async()=>{
 const f=await operationsFixture(),insert=f.sqlite.prepare("INSERT INTO stations(name,stream_url,contact_email,status,created_at,updated_at,zip_code,category) VALUES (?,'https://example.net/live','private@example.net',?,?,?, ?,?)");
 for(let i=0;i<137;i++)insert.run('Radio Éspérance '+i,i<133?'published':'pending_review',f.now,f.now,i<129?'99999':'90210',i<125?'christian':'music');
 assert.equal(zipLocationKnown('99999'),false);const first=await page(f,'?limit=50&q=esperance&category=christian&zip_code=99999');assert.equal(first.stations.length,50);assert.equal(first.zip_radius_miles,25);assert.equal(first.zip_location_known,false);const rows=[...first.stations];let cursor=first.next_cursor;
 while(cursor){const next=await page(f,'?limit=50&q=esperance&category=christian&zip_code=99999&cursor='+encodeURIComponent(cursor));rows.push(...next.stations);cursor=next.next_cursor;}
 assert.equal(rows.length,125);assert.equal(new Set(rows.map(item=>item.listener_code)).size,125);assert.ok(rows.every(item=>item.zip_code==='99999'&&item.category==='christian'));assert.equal(Object.hasOwn(first.facets,'zip_codes'),false);
 const byCode=await page(f,'?zip_code=99999&q='+encodeURIComponent('#'+rows.at(-1).listener_code));assert.equal(byCode.stations.length,1);assert.equal(byCode.stations[0].listener_code,rows.at(-1).listener_code);
});

test('known ZIP search includes nearby ZIPs while excluding far-away and unclassified stations',async()=>{
 const f=await operationsFixture(),insert=f.sqlite.prepare("INSERT INTO stations(name,stream_url,contact_email,status,created_at,updated_at,zip_code) VALUES (?,'https://example.net/live','private@example.net','published',?,?,?)");
 insert.run('Exact',f.now,f.now,'10001');insert.run('Nearby',f.now,f.now,'10002');insert.run('Far away',f.now,f.now,'90210');assert.equal(zipLocationKnown('10001'),true);assert.ok(nearbyZipCodes('10001').includes('10002'));assert.equal(nearbyZipCodes('10001').includes('90210'),false);
 const result=await page(f,'?zip_code=10001');assert.deepEqual(result.stations.map(item=>item.name),['Exact','Nearby']);assert.equal(result.zip_location_known,true);assert.equal(result.zip_radius_miles,25);assert.equal(result.stations[1].zip_code,'10002');
 const all=await page(f,'?zip_code=');assert.equal(all.stations.length,4);assert.equal(all.zip_location_known,null);assert.equal(all.zip_radius_miles,null);
});

test('ZIP cursors bind the requested origin and fixed radius rather than only the nearby membership set',async()=>{
 const f=await operationsFixture();for(let i=0;i<4;i++)f.sqlite.prepare("INSERT INTO stations(name,stream_url,contact_email,status,created_at,updated_at,zip_code) VALUES (?,'https://example.com/live','owner@example.com','published',?,?,'10001')").run('Station '+i,f.now,f.now);
 const first=await page(f,'?limit=2&zip_code=10001'),cursor=encodeURIComponent(first.next_cursor);for(const query of ['?limit=2&zip_code=10002','?limit=2&zip_code=00501','?limit=2','?limit=3&zip_code=10001'])await assert.rejects(page(f,query+'&cursor='+cursor),error=>error.status===400);
 const data=JSON.parse(Buffer.from(first.next_cursor.split('.')[0],'base64url').toString());assert.equal(data.v,3);assert.equal(data.zip_radius_miles,25);data.zip_radius_miles=50;const encoded=Buffer.from(JSON.stringify(data)).toString('base64url'),modified=encoded+'.'+await mac(f.env,'public-directory:'+encoded);await assert.rejects(page(f,'?limit=2&zip_code=10001&cursor='+encodeURIComponent(modified)),error=>error.status===400);
 for(const query of ['?zip_code=0050','?zip_code=005010','?zip_code=00501-1234','?zip_code=%EF%BC%90%EF%BC%90%EF%BC%95%EF%BC%90%EF%BC%91','?zip_code=00501&zip_code=10001','?zip_code='+('9'.repeat(10000))])await assert.rejects(page(f,query),error=>error.status===400);
});

test('ZIP-only owner changes preserve approved values and legacy language/category in a private proposal',async()=>{
 const f=await operationsFixture();f.owner();f.sqlite.prepare("UPDATE stations SET language='ht',category='culture',zip_code='00501' WHERE code=?").run(f.station);const loaded=(await owner(f)).station;assert.equal(loaded.zip_code,'00501');
 await save(f,loaded,{zip_code:'10001'});let draft=(await owner(f)).station;assert.equal(draft.zip_code,'10001');assert.equal(draft.approved.zip_code,'00501');assert.equal(draft.language,'ht');assert.equal(draft.category,'culture');assert.notEqual(draft.revision,loaded.revision);assert.equal((await publicStation(f.env.DB,f.station)).zip_code,'00501');
 const unchanged=await(await save(f,draft)).json();assert.equal(unchanged.unchanged,true);assert.equal((await owner(f)).station.zip_code,'10001');await assert.rejects(save(f,loaded,{zip_code:'90210'}),error=>error.status===409);
 draft=(await owner(f)).station;await assert.rejects(save(f,draft,{zip_code:''}),error=>error.status===400&&error.message==='Enter a 5-digit ZIP code.');draft=(await owner(f)).station;assert.equal(draft.zip_code,'10001');assert.equal(draft.approved.zip_code,'00501');
});

test('invalid ZIP edits do not upload artwork or bypass stream-test requirements',async()=>{
 const f=await operationsFixture();f.owner();const loaded=(await owner(f)).station;
 for(const zip_code of ['1234','123456',null,10001,'00501-1234'])await assert.rejects(save(f,loaded,{zip_code,artwork:{name:'not-an-image.png'}}),error=>error.status===400);assert.equal(f.sqlite.prepare('SELECT count(*) AS n FROM station_edits').get().n,0);
 await assert.rejects(save(f,loaded,{zip_code:'00501',stream_url:'https://different.example.com/live'}),error=>error.status===428);assert.equal((await owner(f)).station.zip_code,'');
});

test('reviewed ZIP publication is atomic and stale owner/admin ZIP revisions cannot approve a different proposal',async()=>{
 const f=await operationsFixture();f.owner();f.sqlite.prepare('UPDATE stations SET email_verified_at=?').run(f.now);const loaded=(await owner(f)).station;await save(f,loaded,{zip_code:'00501'});const snapshot=await stationState(f.env,f.station),guarded=publishStationEdit(f.env,snapshot.station,snapshot.pending,f.now);f.sqlite.exec("UPDATE station_edits SET zip_code='10001'");assert.equal((await guarded.run()).changes,0);
 f.env.ADMIN_EMAIL='admin@example.com';f.admin();const reviewed=(await(await adminRoutes(f.request('/api/admin/stations'),f.env,f.now)).json()).stations[0];assert.equal(reviewed.pending_edit.zip_code,'10001');f.sqlite.exec("UPDATE station_edits SET zip_code='00501'");await assert.rejects(adminRoutes(f.request('/api/admin/station',{code:f.station,revision:reviewed.revision,action:'approve'}),f.env,f.now),error=>error.status===409);
 const fresh=(await(await adminRoutes(f.request('/api/admin/stations'),f.env,f.now)).json()).stations[0];await adminRoutes(f.request('/api/admin/station',{code:f.station,revision:fresh.revision,action:'approve'}),f.env,f.now);assert.equal((await publicStation(f.env.DB,f.station)).zip_code,'00501');const batch=await(await publicStationBatch(new Request('https://radiolocals.com/api/stations/batch?codes='+f.station),f.env)).json();assert.equal(batch.stations[0].zip_code,'00501');
});

test('owner SQL CAS includes approved ZIP even when another change did not update its timestamp',async()=>{
 const f=await operationsFixture();f.owner();const loaded=(await owner(f)).station,prepare=f.env.DB.prepare;let raced=false;f.env.DB.prepare=sql=>{const statement=prepare(sql);if(sql.startsWith('INSERT INTO station_edits')){const first=statement.first;statement.first=async()=>{if(!raced){raced=true;f.sqlite.exec("UPDATE stations SET zip_code='10001'");}return first();};}return statement;};await assert.rejects(save(f,loaded,{zip_code:'00501'}),error=>error.status===409);assert.equal(f.sqlite.prepare('SELECT count(*) AS n FROM station_edits').get().n,0);assert.equal((await publicStation(f.env.DB,f.station)).zip_code,'10001');
});

test('backups restore ZIP text including leading zeros and legacy snapshots retain other metadata with blank ZIP',async()=>{
 const f=await operationsFixture();f.owner();f.sqlite.prepare("UPDATE stations SET zip_code='00501',language='ht',category='culture',email_verified_at=?").run(f.now);const loaded=(await owner(f)).station;await save(f,loaded,{zip_code:'10001'});const backup=await createBackup(f.env,f.now),path='backups/'+backup.id+'/manifest.enc',snapshot=JSON.parse(await decrypt(f.env,await(await f.env.MEDIA.get(path)).text()));assert.equal(snapshot.tables.stations[0].zip_code,'00501');assert.equal(snapshot.tables.station_edits[0].zip_code,'10001');
 f.sqlite.exec("UPDATE stations SET zip_code='90210';UPDATE station_edits SET zip_code='90210'");await restoreBackup(f.env,backup.id,f.now+1);assert.equal(f.sqlite.prepare('SELECT zip_code FROM stations').get().zip_code,'00501');assert.equal(f.sqlite.prepare('SELECT zip_code FROM station_edits').get().zip_code,'10001');
 for(const table of ['stations','station_edits'])for(const row of snapshot.tables[table])delete row.zip_code;await f.env.MEDIA.put(path,await encrypt(f.env,JSON.stringify(snapshot)));await restoreBackup(f.env,backup.id,f.now+2);for(const table of ['stations','station_edits']){const row=f.sqlite.prepare('SELECT language,category,zip_code FROM '+table).get();assert.equal(row.zip_code,'');assert.equal(row.language,'ht');assert.equal(row.category,'culture');}
});

test('malformed backup ZIP values fail before replacing live records or proposals',async()=>{
 const f=await operationsFixture();f.owner();f.sqlite.prepare('UPDATE stations SET email_verified_at=?').run(f.now);await save(f,(await owner(f)).station,{zip_code:'00501'});const backup=await createBackup(f.env,f.now),path='backups/'+backup.id+'/manifest.enc',original=JSON.parse(await decrypt(f.env,await(await f.env.MEDIA.get(path)).text())),before=f.sqlite.prepare('SELECT * FROM station_edits').get();
 for(const [table,value] of [['stations',501],['stations','12345-6789'],['station_edits','１２３４５'],['station_edits',null]]){const snapshot=structuredClone(original);snapshot.tables[table][0].zip_code=value;await f.env.MEDIA.put(path,await encrypt(f.env,JSON.stringify(snapshot)));await assert.rejects(restoreBackup(f.env,backup.id,f.now+1),error=>error.status===400);assert.deepEqual(f.sqlite.prepare('SELECT * FROM station_edits').get(),before);assert.equal(f.sqlite.prepare('SELECT zip_code FROM stations').get().zip_code,'');}
});
