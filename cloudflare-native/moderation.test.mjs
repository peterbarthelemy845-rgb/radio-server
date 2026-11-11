import {test} from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';import {readFileSync} from 'node:fs';
import {screenStation,needsTextReview} from './moderation.mjs';import {decrypt} from './security.mjs';
const now=1800000000;
function fixture(){const sqlite=new DatabaseSync(':memory:');for(const name of ['0001_core.sql','0005_community.sql','0018_notification_operations.sql','0021_station_edits.sql','0023_station_edit_names.sql','0024_stream_verification.sql'])sqlite.exec(readFileSync(new URL('./migrations/'+name,import.meta.url),'utf8'));
 const DB={prepare(sql){let args=[];const q={bind(...v){args=v;return q;},async first(){return sqlite.prepare(sql).get(...args)||null;},async run(){return sqlite.prepare(sql).run(...args);}};return q;},async batch(qs){sqlite.exec('BEGIN');try{const rows=[];for(const q of qs)rows.push(await q.run());sqlite.exec('COMMIT');return rows;}catch(e){sqlite.exec('ROLLBACK');throw e;}}};
 sqlite.prepare("INSERT INTO stations(name,bio,stream_url,contact_email,artwork_key,status,email_verified_at,created_at,updated_at) VALUES ('Community Radio','Local music and news','https://private.example.com/stream?private=1','owner@example.com','safe.png','pending_review',?,?,?)").run(now,now,now);
 sqlite.prepare("INSERT INTO station_stream_checks(station_code,stream_url,revision,checked_at,expires) VALUES (10,'https://private.example.com/stream?private=1','initial',?,?)").run(now,now+3600);
 const env={OPENAI_API_KEY:'private-test',DATA_ENCRYPTION_KEY:'a'.repeat(64),DB,MEDIA:{async get(){return {size:12,customMetadata:{sanitizer_version:'1'},async arrayBuffer(){return new Uint8Array(12).buffer;}};}}};
 const categories=Object.fromEntries(['sexual','sexual/minors','violence','violence/graphic','hate','harassment','self-harm'].map(k=>[k,false]));
 const result={flagged:false,categories,category_scores:Object.fromEntries(Object.keys(categories).map(k=>[k,0.001]))};
 return {env,result,sqlite,published:()=>sqlite.prepare('SELECT status FROM stations').get().status==='published'};}
test('safe complete scan publishes atomically and queues one private owner notification',async()=>{const f=fixture();let calls=0;
 const fetcher=async(url,init)=>{calls++;assert.equal(url,'https://api.openai.com/v1/moderations');assert.equal(init.redirect,'manual');assert.equal(init.body.includes('owner@example.com'),false);assert.equal(init.body.includes('private.example'),false);return Response.json({results:[f.result]});};
 assert.equal(await screenStation(f.env,10,fetcher,now),true);assert.equal(await screenStation(f.env,10,fetcher,now),false);
 assert.equal(calls,1);assert.equal(f.published(),true);const jobs=f.sqlite.prepare('SELECT * FROM mail_outbox').all();assert.equal(jobs.length,1);assert.equal(jobs[0].recipient,'owner@example.com');
 const text=JSON.parse(await decrypt(f.env,jobs[0].encrypted_payload)).text;assert.match(text,/approved and published/);assert.equal(text.includes('private.example'),false);assert.equal(text.includes('private-test'),false);
});
test('flagged, borderline, malformed, failed and missing scanner responses never publish',async()=>{
 for(const kind of ['flagged','borderline','malformed','failure','missing']){const f=fixture();if(kind==='flagged')f.result.flagged=true;if(kind==='borderline')f.result.category_scores.sexual=.3;if(kind==='missing')delete f.env.OPENAI_API_KEY;
 const output=await screenStation(f.env,10,async()=>kind==='failure'?new Response('',{status:503}):Response.json(kind==='malformed'?{results:[{flagged:false}]}:{results:[f.result]}),now);
 assert.equal(output,false,kind);assert.equal(f.published(),false,kind);assert.equal(f.sqlite.prepare('SELECT count(*) n FROM mail_outbox').get().n,0,kind);}});
test('content or recipient edits during the scan prevent publication and notification',async()=>{
 for(const change of ["bio='Updated'","contact_email='changed@example.com'","email_verified_at=NULL","stream_url='https://changed.example.com/live'"]){const f=fixture();assert.equal(await screenStation(f.env,10,async()=>{f.sqlite.exec('UPDATE stations SET '+change);return Response.json({results:[f.result]});},now),false);assert.equal(f.published(),false);assert.equal(f.sqlite.prepare('SELECT count(*) n FROM mail_outbox').get().n,0);}
});
test('outbox insertion failure rolls automatic approval back',async()=>{const f=fixture();f.sqlite.exec("CREATE TRIGGER fail_notice BEFORE INSERT ON mail_outbox BEGIN SELECT RAISE(ABORT, 'test failure'); END;");assert.equal(await screenStation(f.env,10,async()=>Response.json({results:[f.result]}),now),false);assert.equal(f.published(),false);});
test('profanity screening flags obfuscation while normal names pass',async()=>{assert.equal(needsTextReview('Community Radio'),false);assert.equal(needsTextReview('f.u.c.k radio'),true);assert.equal(needsTextReview('sh1t radio'),true);const f=fixture();f.sqlite.exec("UPDATE stations SET name='porn radio'");assert.equal(await screenStation(f.env,10,()=>{throw Error('must not call');},now),false);});

function proposal(f){f.sqlite.exec("UPDATE stations SET status='published'");f.sqlite.prepare('INSERT INTO station_edits VALUES (?,?,?,?,?,?,?,?)').run(10,'a'.repeat(32),now,'https://new.example.com/live','Proposed bio','new.png',now,'Community Radio');f.sqlite.prepare("INSERT INTO station_stream_checks(station_code,stream_url,revision,checked_at,expires) VALUES (10,'https://new.example.com/live',?,?,?)").run('a'.repeat(32),now,now+3600);}
test('a safe proposal publishes only its exact reviewed content and removes that proposal atomically',async()=>{
 const f=fixture();proposal(f);assert.equal(await screenStation(f.env,10,async()=>Response.json({results:[f.result]}),now),true);const station=f.sqlite.prepare('SELECT * FROM stations').get();assert.equal(station.status,'published');assert.equal(station.bio,'Proposed bio');assert.equal(station.stream_url,'https://new.example.com/live');assert.equal(station.artwork_key,'new.png');assert.equal(f.sqlite.prepare('SELECT count(*) n FROM station_edits').get().n,0);
});
test('proposed names are scanned exactly and safe approval replaces the live name atomically',async()=>{
 const f=fixture();proposal(f);f.sqlite.prepare("UPDATE station_edits SET name='New Community Name'").run();let scanned;
 assert.equal(await screenStation(f.env,10,async(_url,init)=>{scanned=JSON.parse(init.body).input[0].text;assert.equal(f.sqlite.prepare('SELECT name FROM stations').get().name,'Community Radio');return Response.json({results:[f.result]});},now),true);
 assert.equal(scanned,'New Community Name\nProposed bio');assert.equal(f.sqlite.prepare('SELECT name FROM stations').get().name,'New Community Name');assert.equal(f.sqlite.prepare('SELECT count(*) n FROM station_edits').get().n,0);
});
test('profane or malformed proposed names never publish or call the moderation service',async()=>{
 for(const name of ['porn radio','','   ','a'.repeat(97),'Bad\nName']){const f=fixture();proposal(f);f.sqlite.prepare('UPDATE station_edits SET name=?').run(name);let scans=0;assert.equal(await screenStation(f.env,10,async()=>{scans++;return Response.json({results:[f.result]});},now),false);assert.equal(scans,0);assert.equal(f.sqlite.prepare('SELECT name FROM stations').get().name,'Community Radio');assert.equal(f.sqlite.prepare('SELECT count(*) n FROM station_edits').get().n,1);assert.equal(f.sqlite.prepare('SELECT count(*) n FROM mail_outbox').get().n,0);}
});
test('a proposal name changed during its scan cannot be published under the old approval',async()=>{
 const f=fixture();proposal(f);const before=f.sqlite.prepare('SELECT * FROM stations').get();assert.equal(await screenStation(f.env,10,async()=>{f.sqlite.prepare("UPDATE station_edits SET name='Changed after scan started'").run();return Response.json({results:[f.result]});},now),false);assert.deepEqual(f.sqlite.prepare('SELECT * FROM stations').get(),before);assert.equal(f.sqlite.prepare('SELECT count(*) n FROM mail_outbox').get().n,0);
});
test('flagged or superseded proposals never remove or overwrite the last approved station',async()=>{
 for(const change of [null,"UPDATE station_edits SET revision='"+'b'.repeat(32)+"',bio='Newer proposal'","UPDATE stations SET status='suspended'","UPDATE stations SET status='deleted'"]){const f=fixture();proposal(f);const original=f.sqlite.prepare('SELECT bio,stream_url,artwork_key FROM stations').get();if(!change)f.result.flagged=true;assert.equal(await screenStation(f.env,10,async()=>{if(change)f.sqlite.exec(change);return Response.json({results:[f.result]});},now),false);assert.deepEqual(f.sqlite.prepare('SELECT bio,stream_url,artwork_key FROM stations').get(),original);assert.equal(f.sqlite.prepare('SELECT count(*) n FROM mail_outbox').get().n,0);}
});

test('an unexpected proposal revision or changed approved base cannot be scanned or promoted',async()=>{
 const f=fixture();proposal(f);let calls=0;const scan=async()=>{calls++;return Response.json({results:[f.result]});};assert.equal(await screenStation(f.env,10,scan,now,'b'.repeat(32)),false);assert.equal(calls,0);f.sqlite.prepare('UPDATE stations SET updated_at=?').run(now+1);assert.equal(await screenStation(f.env,10,scan,now,'a'.repeat(32)),false);assert.equal(calls,0);assert.equal(f.sqlite.prepare('SELECT bio FROM stations').get().bio,'Local music and news');
});

test('a failed proposal notification transaction preserves both live content and the pending proposal',async()=>{
 const f=fixture();proposal(f);const approved=f.sqlite.prepare('SELECT * FROM stations').get(),edit=f.sqlite.prepare('SELECT * FROM station_edits').get();f.sqlite.exec("CREATE TRIGGER fail_proposal_notice BEFORE INSERT ON mail_outbox BEGIN SELECT RAISE(ABORT, 'queue unavailable'); END");assert.equal(await screenStation(f.env,10,async()=>Response.json({results:[f.result]}),now),false);assert.deepEqual(f.sqlite.prepare('SELECT * FROM stations').get(),approved);assert.deepEqual(f.sqlite.prepare('SELECT * FROM station_edits').get(),edit);
});
