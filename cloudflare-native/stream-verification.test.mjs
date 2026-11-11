import {test} from 'node:test';
import assert from 'node:assert/strict';
import {operationsFixture} from './operations-fixture.mjs';
import {attachStreamCheck,beginStreamCheck,completeStreamCheck,requestStreamReview,streamOwnerStatus,streamPublicationAllowed,streamPublicationGuard,STREAM_CHECK_LIFETIME} from './stream-verification.mjs';

const url='http://stream.example.com:8000/;stream.nsv?sid=2&source=a%2Fb',replacement='https://next.example.com/live?sid=3',rev='a'.repeat(32);
async function fixture(){const f=await operationsFixture();f.hash=f.sqlite.prepare('SELECT token_hash FROM sessions').get().token_hash;f.sqlite.prepare("UPDATE stations SET stream_url=?,status='pending_review',email_verified_at=? WHERE code=?").run(url,f.now,f.station);return f;}
const station=f=>f.sqlite.prepare('SELECT * FROM stations WHERE code=?').get(f.station);
function proposal(f,value=replacement,revision=rev){const row=station(f);f.sqlite.prepare('INSERT OR REPLACE INTO station_edits(station_code,revision,base_updated_at,stream_url,bio,artwork_key,created_at,name) VALUES (?,?,?,?,?,?,?,?)').run(row.code,revision,row.updated_at,value,row.bio,row.artwork_key,f.now,row.name);return f.sqlite.prepare('SELECT * FROM station_edits WHERE station_code=?').get(row.code);}
async function pass(f,stream=url,hash=f.hash,now=f.now){const id=await beginStreamCheck(f.env,hash,stream,now);assert.equal(await completeStreamCheck(f.env,hash,stream,id,true,now),true);return id;}
function secondSession(f){const hash='f'.repeat(64);f.sqlite.prepare('INSERT INTO sessions(token_hash,csrf_hash,created_at,expires) VALUES (?,?,?,?)').run(hash,'c'.repeat(64),f.now,f.now+7200);return hash;}
function secondStation(f){return f.sqlite.prepare("INSERT INTO stations(name,stream_url,contact_email,bio,status,email_verified_at,created_at,updated_at) VALUES ('Second',?,'second@example.com','','pending_review',?,?,?) RETURNING code").get(url,f.now,f.now,f.now).code;}

test('only a fresh server receipt attaches evidence for the exact original canonical URL and session',async()=>{
 const f=await fixture();assert.equal(await attachStreamCheck(f.env,f.hash,f.station,url,'initial',f.now),false);await pass(f);assert.equal(await attachStreamCheck(f.env,f.hash,f.station,url.replace('stream.example.com','STREAM.EXAMPLE.COM'),'initial',f.now),true);const evidence=f.sqlite.prepare('SELECT * FROM station_stream_checks').get();assert.equal(evidence.stream_url,url);assert.equal(evidence.revision,'initial');assert.equal(evidence.checked_at,f.now);assert.equal(evidence.expires,f.now+STREAM_CHECK_LIFETIME);assert.equal(evidence.session_hash,f.hash);assert.equal(await streamPublicationAllowed(f.env,station(f),null,f.now),true);
 const other=secondSession(f);assert.equal(await attachStreamCheck(f.env,other,f.station,url,'initial',f.now),false);assert.equal(await attachStreamCheck(f.env,f.hash,f.station,url+'&different=1','initial',f.now),false);assert.equal(await streamPublicationAllowed(f.env,station(f),null,f.now),true,'missing receipts do not clear an already attached proof');
});

test('receipts expire after one hour and uncompleted checks never permit publication',async()=>{
 const f=await fixture();await beginStreamCheck(f.env,f.hash,url,f.now);assert.equal(await attachStreamCheck(f.env,f.hash,f.station,url,'initial',f.now),false);assert.equal((await streamOwnerStatus(f.env,station(f),null,f.now,f.hash)).status,'needs_check');await pass(f);assert.equal(await attachStreamCheck(f.env,f.hash,f.station,url,'initial',f.now+STREAM_CHECK_LIFETIME),false);assert.equal((await streamOwnerStatus(f.env,station(f),null,f.now+STREAM_CHECK_LIFETIME,f.hash)).status,'needs_check');
});

test('private owner status can show a session check before Save without granting publication',async()=>{
 const f=await fixture();await pass(f);const status=await streamOwnerStatus(f.env,station(f),null,f.now,f.hash);assert.equal(status.status,'passed');assert.equal(status.checked_at,f.now);assert.equal(status.expires,f.now+3600);assert.equal(await streamPublicationAllowed(f.env,station(f),null,f.now),false);assert.equal((await streamOwnerStatus(f.env,station(f),null,f.now,secondSession(f))).status,'needs_check');
});

test('an attached initial proof is independent of receipt retention but its own expiry is enforced',async()=>{
 const f=await fixture();await pass(f);await attachStreamCheck(f.env,f.hash,f.station,url,'initial',f.now);f.sqlite.exec('DELETE FROM stream_check_results');assert.equal(await streamPublicationAllowed(f.env,station(f),null,f.now+3599),true);assert.equal(await streamPublicationAllowed(f.env,station(f),null,f.now+3600),false);
});

test('changed stream evidence is bound to the exact pending revision and guards recheck the live proposal',async()=>{
 const f=await fixture();f.sqlite.prepare("UPDATE stations SET status='published' WHERE code=?").run(f.station);const pending=proposal(f);await pass(f,replacement);assert.equal(await attachStreamCheck(f.env,f.hash,f.station,replacement,rev,f.now),true);assert.equal(await streamPublicationAllowed(f.env,station(f),pending,f.now),true);const guard=streamPublicationGuard(station(f),pending,f.now);f.sqlite.prepare('UPDATE station_edits SET revision=? WHERE station_code=?').run('b'.repeat(32),f.station);assert.equal(f.sqlite.prepare('SELECT 1 WHERE '+guard.sql).get(...guard.values),undefined);assert.equal(await attachStreamCheck(f.env,f.hash,f.station,replacement,rev,f.now),false);assert.equal(await streamPublicationAllowed(f.env,station(f),proposal(f,replacement,'b'.repeat(32)),f.now),false);assert.equal((await streamOwnerStatus(f.env,station(f),pending,f.now,f.hash)).status,'needs_check','stale private revisions do not inherit a session result');
});

test('already published unchanged stream remains eligible for bio or artwork edits without a new check',async()=>{
 const f=await fixture();f.sqlite.prepare("UPDATE stations SET status='published' WHERE code=?").run(f.station);const pending=proposal(f,url);assert.equal(await streamPublicationAllowed(f.env,station(f),pending,f.now),true);assert.equal((await streamOwnerStatus(f.env,station(f),pending,f.now)).status,'passed');const guard=streamPublicationGuard(station(f),pending,f.now);f.sqlite.prepare("UPDATE stations SET status='suspended' WHERE code=?").run(f.station);assert.equal(f.sqlite.prepare('SELECT 1 WHERE '+guard.sql).get(...guard.values),undefined);
});

test('fresh publication guard cannot succeed after evidence invalidation or proposal deletion',async()=>{
 const f=await fixture(),pending=proposal(f);await pass(f,replacement);await attachStreamCheck(f.env,f.hash,f.station,replacement,rev,f.now);const guard=streamPublicationGuard(station(f),pending,f.now);assert.ok(f.sqlite.prepare('SELECT 1 WHERE '+guard.sql).get(...guard.values));f.sqlite.exec('UPDATE station_stream_checks SET expires=0');assert.equal(f.sqlite.prepare('SELECT 1 WHERE '+guard.sql).get(...guard.values),undefined);f.sqlite.exec('DELETE FROM station_edits');assert.equal(await streamPublicationAllowed(f.env,station(f),pending,f.now),false);
});

test('negative checks invalidate only evidence attached from their exact source session and URL',async()=>{
 const f=await fixture(),other=secondSession(f),otherStation=secondStation(f);await pass(f);await attachStreamCheck(f.env,f.hash,f.station,url,'initial',f.now);await pass(f,url,other);await attachStreamCheck(f.env,other,otherStation,url,'initial',f.now);const id=await beginStreamCheck(f.env,f.hash,url,f.now);await completeStreamCheck(f.env,f.hash,url,id,false,f.now);assert.equal(f.sqlite.prepare('SELECT 1 FROM stream_check_results WHERE session_hash=?').get(f.hash),undefined);assert.equal(await streamPublicationAllowed(f.env,station(f),null,f.now),false);const unaffected=f.sqlite.prepare('SELECT * FROM stations WHERE code=?').get(otherStation);assert.equal(await streamPublicationAllowed(f.env,unaffected,null,f.now),true);assert.equal(f.sqlite.prepare('SELECT COUNT(*) n FROM stream_check_results WHERE session_hash=?').get(other).n,1);
});

test('beginning a recheck atomically invalidates older derived proof until the new check passes and Save reattaches',async()=>{
 const f=await fixture();await pass(f);await attachStreamCheck(f.env,f.hash,f.station,url,'initial',f.now);assert.equal(await streamPublicationAllowed(f.env,station(f),null,f.now),true);const id=await beginStreamCheck(f.env,f.hash,url,f.now);assert.equal(await streamPublicationAllowed(f.env,station(f),null,f.now),false);assert.equal(await attachStreamCheck(f.env,f.hash,f.station,url,'initial',f.now),false);assert.equal(f.sqlite.prepare('SELECT checked_at FROM stream_check_results').get().checked_at,0);await completeStreamCheck(f.env,f.hash,url,id,true,f.now);assert.equal(await streamPublicationAllowed(f.env,station(f),null,f.now),false,'new receipt is not an automatic publication grant');assert.equal(await attachStreamCheck(f.env,f.hash,f.station,url,'initial',f.now),true);assert.equal(await streamPublicationAllowed(f.env,station(f),null,f.now),true);
});

test('overlapping checks cannot let an older positive restore a newer negative or an older failure erase a newer pass',async()=>{
 const f=await fixture(),old=await beginStreamCheck(f.env,f.hash,url,f.now),fresh=await beginStreamCheck(f.env,f.hash,url,f.now);await completeStreamCheck(f.env,f.hash,url,fresh,false,f.now);assert.equal(await completeStreamCheck(f.env,f.hash,url,old,true,f.now),false);assert.equal(f.sqlite.prepare('SELECT COUNT(*) n FROM stream_check_results').get().n,0);
 const oldFailure=await beginStreamCheck(f.env,f.hash,url,f.now),newPass=await beginStreamCheck(f.env,f.hash,url,f.now);await completeStreamCheck(f.env,f.hash,url,newPass,true,f.now);await attachStreamCheck(f.env,f.hash,f.station,url,'initial',f.now);assert.equal(await completeStreamCheck(f.env,f.hash,url,oldFailure,false,f.now),false);assert.equal(await streamPublicationAllowed(f.env,station(f),null,f.now),true);
});

test('review requests record an exact revision but never approve or overwrite a valid proof',async()=>{
 const f=await fixture(),pending=proposal(f);const requested=await requestStreamReview(f.env,station(f),pending,f.now);assert.equal(requested.status,'review_requested');assert.equal(requested.review_requested_at,f.now);assert.equal(await streamPublicationAllowed(f.env,station(f),pending,f.now),false);await pass(f,replacement);await attachStreamCheck(f.env,f.hash,f.station,replacement,rev,f.now);const before=f.sqlite.prepare('SELECT * FROM station_stream_checks').get();const passed=await requestStreamReview(f.env,station(f),pending,f.now+1),after=f.sqlite.prepare('SELECT * FROM station_stream_checks').get();assert.equal(passed.status,'passed');assert.equal(after.checked_at,before.checked_at);assert.equal(after.expires,before.expires);assert.equal(after.session_hash,before.session_hash);assert.equal(after.review_requested_at,f.now+1);
 const newer=proposal(f,replacement,'c'.repeat(32));await requestStreamReview(f.env,station(f),newer,f.now+2);assert.equal(await streamPublicationAllowed(f.env,station(f),newer,f.now+2),false);assert.equal((await requestStreamReview(f.env,station(f),pending,f.now+3)).status,'needs_check');assert.equal(f.sqlite.prepare('SELECT revision FROM station_stream_checks').get().revision,newer.revision);
});

test('review requests cannot be recorded after email verification or active status is lost',async()=>{
 for(const condition of ['unverified','pending_email','suspended','deleted']){const f=await fixture(),live=station(f);if(condition==='unverified')f.sqlite.prepare('UPDATE stations SET email_verified_at=NULL WHERE code=?').run(f.station);else f.sqlite.prepare('UPDATE stations SET status=? WHERE code=?').run(condition,f.station);await requestStreamReview(f.env,live,null,f.now);assert.equal(f.sqlite.prepare('SELECT COUNT(*) n FROM station_stream_checks').get().n,0,condition);}
});

test('session deletion cleans ephemeral receipts and removes provenance without breaking trusted station proof',async()=>{
 const f=await fixture();await pass(f);await attachStreamCheck(f.env,f.hash,f.station,url,'initial',f.now);f.sqlite.prepare('DELETE FROM sessions WHERE token_hash=?').run(f.hash);assert.equal(f.sqlite.prepare('SELECT COUNT(*) n FROM stream_check_results').get().n,0);assert.equal(f.sqlite.prepare('SELECT session_hash FROM station_stream_checks').get().session_hash,null);assert.equal(await streamPublicationAllowed(f.env,station(f),null,f.now),true);
});

test('future-dated receipts and evidence, expired sessions, blocked stations and malformed URLs fail closed',async()=>{
 const f=await fixture();await pass(f,url,f.hash,f.now+1);assert.equal(await attachStreamCheck(f.env,f.hash,f.station,url,'initial',f.now),false);await pass(f);f.sqlite.prepare('UPDATE sessions SET expires=? WHERE token_hash=?').run(f.now,f.hash);assert.equal(await attachStreamCheck(f.env,f.hash,f.station,url,'initial',f.now),false);f.sqlite.prepare('UPDATE sessions SET expires=? WHERE token_hash=?').run(f.now+7200,f.hash);await attachStreamCheck(f.env,f.hash,f.station,url,'initial',f.now);f.sqlite.prepare('UPDATE station_stream_checks SET checked_at=?').run(f.now+1);assert.equal(await streamPublicationAllowed(f.env,station(f),null,f.now),false);f.sqlite.prepare("UPDATE stations SET status='suspended' WHERE code=?").run(f.station);assert.equal(await attachStreamCheck(f.env,f.hash,f.station,url,'initial',f.now),false);assert.equal(await streamPublicationAllowed(f.env,{...station(f),stream_url:'http://127.0.0.1/live'},null,f.now),false);
});
