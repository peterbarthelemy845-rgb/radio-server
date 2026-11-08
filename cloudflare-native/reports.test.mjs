import {test} from 'node:test';import assert from 'node:assert/strict';import {operationsFixture} from './operations-fixture.mjs';import {recordListening,reportsRoutes} from './reports.mjs';
test('listening requires a continuous minute, deduplicates polls and resets after a gap',async()=>{const f=await operationsFixture(),{env,station,now,sqlite}=f;for(const seconds of [0,30])await recordListening(env,'radio-one',station,now+seconds);assert.equal(sqlite.prepare('SELECT count(*) n FROM monthly_activity').get().n,0);await recordListening(env,'radio-one',station,now+60);await recordListening(env,'radio-one',station,now+60);await recordListening(env,'radio-one',station,now+90);assert.equal(sqlite.prepare('SELECT reported_seconds FROM listening_daily').get().reported_seconds,90);assert.equal(sqlite.prepare('SELECT count(*) n FROM monthly_activity').get().n,1);await recordListening(env,'radio-one',station,now+250);assert.equal(sqlite.prepare('SELECT qualified FROM listening_sessions').get().qualified,0);await recordListening(env,'radio-one','',now+260);assert.equal(sqlite.prepare('SELECT count(*) n FROM listening_sessions').get().n,0);});
test('share clicks deduplicate, owner reports exclude other stations and anonymous reports are denied',async()=>{const f=await operationsFixture();await assert.rejects(reportsRoutes(f.request('/api/owner/reports'),f.env,f.now),e=>e.status===401);const event={event_id:'b'.repeat(32),station_code:String(f.station),channel:'whatsapp'};await reportsRoutes(f.request('/api/events',event),f.env,f.now);await reportsRoutes(f.request('/api/events',event),f.env,f.now);assert.equal(f.sqlite.prepare('SELECT count(*) n FROM share_events').get().n,1);f.owner();f.sqlite.prepare("INSERT INTO stations(name,stream_url,contact_email,status,created_at,updated_at) VALUES ('Other','https://example.org/stream','other@example.org','published',?,?)").run(f.now,f.now);const result=await (await reportsRoutes(f.request('/api/owner/reports'),f.env,f.now)).json();assert.equal(result.stations.length,1);assert.equal(result.stations[0].share_clicks,1);assert.equal(result.shares[0].channel,'whatsapp');await assert.rejects(reportsRoutes(f.request('/api/admin/reports'),f.env,f.now),e=>e.status===401);f.admin();assert.equal((await (await reportsRoutes(f.request('/api/admin/reports'),f.env,f.now)).json()).stations.length,2);});

const utc=text=>Date.parse(text)/1000;
const days=f=>f.sqlite.prepare('SELECT day,reported_seconds FROM listening_daily ORDER BY day').all().map(row=>({...row}));
const months=f=>f.sqlite.prepare('SELECT month FROM monthly_activity ORDER BY month').all().map(row=>row.month);

test('credited time crossing a UTC month boundary is split between the actual listening dates',async()=>{
 const f=await operationsFixture(),start=utc('2026-11-30T23:59:30Z');
 await recordListening(f.env,'radio-one',f.station,start);
 await recordListening(f.env,'radio-one',f.station,start+60);
 assert.deepEqual(days(f),[{day:'2026-11-30',reported_seconds:30},{day:'2026-12-01',reported_seconds:30}]);
 assert.deepEqual(months(f),['2026-11','2026-12']);
 const activity=f.sqlite.prepare('SELECT month,first_seen,last_seen FROM monthly_activity ORDER BY month').all();
 assert.equal(activity[0].first_seen,start);assert.equal(activity[0].last_seen,start+30);
 assert.equal(activity[1].first_seen,start+30);assert.equal(activity[1].last_seen,start+60);
 await recordListening(f.env,'radio-one',f.station,start+60);
 assert.deepEqual(days(f),[{day:'2026-11-30',reported_seconds:30},{day:'2026-12-01',reported_seconds:30}]);
});

test('a report exactly at midnight credits only the preceding day and month until positive new-month time arrives',async()=>{
 const f=await operationsFixture(),start=utc('2026-11-30T23:59:00Z');
 await recordListening(f.env,'radio-one',f.station,start);
 await recordListening(f.env,'radio-one',f.station,start+60);
 assert.deepEqual(days(f),[{day:'2026-11-30',reported_seconds:60}]);assert.deepEqual(months(f),['2026-11']);
 await recordListening(f.env,'radio-one',f.station,start+61);
 assert.deepEqual(days(f),[{day:'2026-11-30',reported_seconds:60},{day:'2026-12-01',reported_seconds:1}]);
 assert.deepEqual(months(f),['2026-11','2026-12']);
});

test('already-qualified listening splits at a UTC day boundary without counting the same radio twice in its month',async()=>{
 const f=await operationsFixture(),start=utc('2026-11-08T23:58:30Z');
 for(const seconds of [0,60,120])await recordListening(f.env,'radio-one',f.station,start+seconds);
 assert.deepEqual(days(f),[{day:'2026-11-08',reported_seconds:90},{day:'2026-11-09',reported_seconds:30}]);
 assert.deepEqual(months(f),['2026-11']);
});

test('qualification preserves the existing ninety-second continuity bound at rollover',async()=>{
 for(const end of [149,150]){
  const f=await operationsFixture(),start=utc('2026-11-30T23:58:30Z');
  await recordListening(f.env,'radio-one',f.station,start);
  await recordListening(f.env,'radio-one',f.station,start+59);
  await recordListening(f.env,'radio-one',f.station,start+end);
  if(end===149){
   assert.deepEqual(days(f),[{day:'2026-11-30',reported_seconds:90},{day:'2026-12-01',reported_seconds:59}]);
   assert.deepEqual(months(f),['2026-11','2026-12']);
  }else{
   assert.deepEqual(days(f),[]);assert.deepEqual(months(f),[]);
   assert.equal(f.sqlite.prepare('SELECT qualified FROM listening_sessions').get().qualified,0);
  }
 }
});

test('out-of-order and stale stop reports cannot add time or erase a newer session across rollover',async()=>{
 const f=await operationsFixture(),start=utc('2026-11-30T23:59:30Z');
 await recordListening(f.env,'radio-one',f.station,start);
 await recordListening(f.env,'radio-one',f.station,start+60);
 await recordListening(f.env,'radio-one',f.station,start+10);
 await recordListening(f.env,'radio-one','',start+20);
 assert.equal(f.sqlite.prepare('SELECT last_seen FROM listening_sessions').get().last_seen,start+60);
 assert.deepEqual(days(f),[{day:'2026-11-30',reported_seconds:30},{day:'2026-12-01',reported_seconds:30}]);
 await recordListening(f.env,'radio-one',f.station,start+200);
 assert.equal(f.sqlite.prepare('SELECT qualified FROM listening_sessions').get().qualified,0);
 assert.deepEqual(days(f),[{day:'2026-11-30',reported_seconds:30},{day:'2026-12-01',reported_seconds:30}]);
});

test('concurrent replayed qualification reports across midnight commit the credited interval once',async()=>{
 const f=await operationsFixture(),start=utc('2026-12-31T23:59:30Z');
 // D1 serializes batches as transactions; model that ordering in this fixture.
 const batch=f.env.DB.batch.bind(f.env.DB);let pending=Promise.resolve();
 f.env.DB.batch=queries=>{const result=pending.then(()=>batch(queries));pending=result.catch(()=>{});return result;};
 await recordListening(f.env,'radio-one',f.station,start);
 await Promise.all([recordListening(f.env,'radio-one',f.station,start+60),recordListening(f.env,'radio-one',f.station,start+60)]);
 assert.deepEqual(days(f),[{day:'2026-12-31',reported_seconds:30},{day:'2027-01-01',reported_seconds:30}]);
 assert.deepEqual(months(f),['2026-12','2027-01']);
});
