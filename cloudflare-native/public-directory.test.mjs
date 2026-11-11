import {test} from 'node:test';
import assert from 'node:assert/strict';
import {operationsFixture} from './operations-fixture.mjs';
import {handle,fetchHandler} from './worker.mjs';
async function fixture(count=0){
 const f=await operationsFixture(),insert=f.sqlite.prepare("INSERT INTO stations(name,stream_url,contact_email,status,created_at,updated_at) VALUES (?,'https://example.net/live','private@example.net','published',?,?)");
 f.sqlite.exec('BEGIN');for(let i=0;i<count;i++)insert.run('Community '+i,f.now,f.now);f.sqlite.exec('COMMIT');
 return {...f,async page(params=''){return(await handle(new Request('https://radiolocals.com/api/stations'+params),f.env,f.now)).json();}};
}
test('legacy directory retains its first1000 and every later published station is reachable with its signed cursor',async()=>{
 const f=await fixture(1100),first=await f.page();assert.equal(first.stations.length,1000);assert.equal(first.limit,1000);assert.equal(first.has_more,true);assert.ok(first.next_cursor);const next=await f.page('?cursor='+encodeURIComponent(first.next_cursor));assert.equal(next.stations.length,101);assert.equal(next.has_more,false);assert.equal(next.next_cursor,null);
 const codes=[...first.stations,...next.stations].map(station=>Number(station.listener_code));assert.equal(new Set(codes).size,1101);assert.deepEqual(codes,[...codes].sort((a,b)=>a-b));assert.equal(first.stations[0].contact_email,undefined);
});
test('keyset pages do not skip on deletion and exclude stations beyond the initial cursor ceiling',async()=>{
 const f=await fixture(6),first=await f.page('?limit=2');f.sqlite.prepare('DELETE FROM stations WHERE code=?').run(Number(first.stations[0].listener_code));f.sqlite.prepare("INSERT INTO stations(name,stream_url,contact_email,status,created_at,updated_at) VALUES ('Late','https://example.net/live','private@example.net','published',?,?)").run(f.now,f.now);
 const all=[...first.stations];let cursor=first.next_cursor;while(cursor){const result=await f.page('?limit=2&cursor='+encodeURIComponent(cursor));all.push(...result.stations);cursor=result.next_cursor;}
 assert.equal(all.length,7);assert.equal(new Set(all.map(s=>s.listener_code)).size,7);assert.equal(all.some(s=>s.name==='Late'),false);
});
test('bounded server search reaches accented station names beyond1000 rows and accepts pasted #codes',async()=>{
 const f=await fixture(1100),code=f.sqlite.prepare('SELECT MAX(code) code FROM stations').get().code;f.sqlite.prepare('UPDATE stations SET name=? WHERE code=?').run('Radio Éspérance',code);
 const first=await f.page('?limit=50&q=esperance');assert.deepEqual(first.stations,[]);assert.equal(first.has_more,true);assert.equal(first.scanned_count,1000);const next=await f.page('?limit=50&q=esp%C3%A9rance&cursor='+encodeURIComponent(first.next_cursor));assert.equal(next.stations.length,1);assert.equal(next.stations[0].name,'Radio Éspérance');assert.equal(next.has_more,false);
 const byCode=await f.page('?limit=50&q='+encodeURIComponent('#'+code));let found=byCode;while(found.has_more&&!found.stations.length)found=await f.page('?limit=50&q='+encodeURIComponent('#'+code)+'&cursor='+encodeURIComponent(found.next_cursor));assert.equal(found.stations[0].listener_code,String(code));
});
test('cursor tampering, query/limit changes and oversized parameters fail before expanding a search budget',async()=>{
 const f=await fixture(4),first=await f.page('?limit=2&q=community'),cursor=encodeURIComponent(first.next_cursor);
 for(const query of ['?limit=0','?limit=101','?limit=1e2','?limit=01','?limit=2&limit=3','?q='+('x'.repeat(97)),'?q=a&q=b','?cursor=bad','?limit=3&q=community&cursor='+cursor,'?limit=2&q=other&cursor='+cursor,'?limit=2&q=community&cursor='+encodeURIComponent(first.next_cursor.slice(0,-1)+(first.next_cursor.endsWith('a')?'b':'a'))])assert.equal((await fetchHandler(new Request('https://radiolocals.com/api/stations'+query),f.env)).status,400,query);
});
test('all directory pages and thumbnail URLs are restricted to currently published records',async()=>{
 const f=await fixture(3),key='a'.repeat(64)+'.png';f.sqlite.prepare('UPDATE stations SET artwork_key=? WHERE code=?').run(key,f.station);const first=await f.page('?limit=1');assert.equal(first.stations[0].logo_thumb_url,'/artwork/'+key+'?size=192');assert.equal(first.stations[0].logo_url,'/artwork/'+key);
 const hidden=f.sqlite.prepare('SELECT code FROM stations WHERE code>? ORDER BY code LIMIT 1').get(f.station).code;f.sqlite.prepare("UPDATE stations SET status='suspended' WHERE code=?").run(hidden);const next=await f.page('?limit=1&cursor='+encodeURIComponent(first.next_cursor));assert.equal(next.stations.some(station=>station.listener_code===String(hidden)),false);
 const lookup=await(await handle(new Request('https://radiolocals.com/api/stations/'+f.station),f.env,f.now)).json();assert.equal(lookup.logo_thumb_url,first.stations[0].logo_thumb_url);assert.equal(lookup.contact_email,undefined);
});
