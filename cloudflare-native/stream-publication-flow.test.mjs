import {test} from 'node:test';
import assert from 'node:assert/strict';
import {operationsFixture} from './operations-fixture.mjs';
import {authRoutes} from './owner-auth.mjs';
import {adminRoutes} from './admin.mjs';
import {beginStreamCheck,completeStreamCheck} from './stream-verification.mjs';

const original='https://stream.example.com/live',changed='http://new.example.com:8000/;stream.nsv?sid=2';
const categories=['sexual','sexual/minors','violence','violence/graphic','hate','harassment','self-harm'];
const creative=passed=>new Response(JSON.stringify({results:[{flagged:!passed,categories:Object.fromEntries(categories.map(key=>[key,false])),category_scores:Object.fromEntries(categories.map(key=>[key,0.001]))}]}),{headers:{'Content-Type':'application/json'}});
async function fixture({published=false,owner=true}={}){
 const f=await operationsFixture();f.hash=f.sqlite.prepare('SELECT token_hash FROM sessions').get().token_hash;f.env.OPENAI_API_KEY='test-only-never-sent-to-a-real-service';f.env.ADMIN_EMAIL='admin@example.com';const artwork='a'.repeat(64)+'.png';await f.env.MEDIA.put('sanitized/'+artwork,new Uint8Array([137,80,78,71,13,10,26,10]),{customMetadata:{sanitizer_version:'1'},httpMetadata:{contentType:'image/png'}});
 f.sqlite.prepare('UPDATE stations SET stream_url=?,status=?,email_verified_at=?,artwork_key=? WHERE code=?').run(original,published?'published':'pending_review',f.now,artwork,f.station);if(owner)f.owner();return f;
}
const row=f=>f.sqlite.prepare('SELECT * FROM stations WHERE code=?').get(f.station);
const pending=f=>f.sqlite.prepare('SELECT * FROM station_edits WHERE station_code=?').get(f.station);
async function ownerState(f){return (await (await authRoutes(f.request('/api/owner/station'),f.env,f.now)).json()).station;}
async function save(f,changes={}){const station=await ownerState(f);return (await authRoutes(f.request('/api/owner/station',{name:station.name,stream_url:station.stream_url,bio:station.bio,revision:station.revision,...changes}),f.env,f.now)).json();}
async function receipt(f,url=original,{hash=f.hash,now=f.now}={}){const id=await beginStreamCheck(f.env,hash,url,now);assert.equal(await completeStreamCheck(f.env,hash,url,id,true,now),true);}
async function mockedCreative(run,respond=async()=>creative(true)){
 const previous=globalThis.fetch,calls=[];globalThis.fetch=async(url,init)=>{assert.equal(url,'https://api.openai.com/v1/moderations','all external requests must be the mocked creative scanner');calls.push({url,init});return respond(url,init);};
 try{return await run(calls);}finally{globalThis.fetch=previous;}
}
async function adminState(f){return (await (await adminRoutes(f.request('/api/admin/stations'),f.env,f.now)).json()).stations.find(station=>station.code===f.station);}

test('private Save without a server check stays private even with forged browser pass flags',async()=>{
 const f=await fixture();await mockedCreative(async calls=>{const result=await save(f,{audio_response:true,stream_checked:true,stream_check:{status:'passed'},verified:true});assert.equal(result.review_required,true);assert.equal(result.stream_check_required,true);assert.equal(row(f).status,'pending_review');assert.equal(calls.length,0,'creative review cannot bypass the stream gate');assert.equal(f.sqlite.prepare('SELECT COUNT(*) n FROM station_stream_checks').get().n,0);assert.equal(f.sqlite.prepare('SELECT COUNT(*) n FROM mail_outbox').get().n,0);});
});

test('a successful receipt lets same-data private Save publish only after creative review also passes',async()=>{
 const f=await fixture();await receipt(f);await mockedCreative(async calls=>{const result=await save(f);assert.equal(result.review_required,true);assert.equal(result.stream_check_required,false);assert.equal(row(f).status,'pending_review');assert.equal(calls.length,1);},async()=>creative(false));
 await mockedCreative(async calls=>{const result=await save(f);assert.equal(result.review_required,false);assert.equal(result.stream_check_required,false);assert.equal(row(f).status,'published');assert.equal(row(f).stream_url,original);assert.equal(calls.length,1);assert.equal(f.sqlite.prepare('SELECT COUNT(*) n FROM mail_outbox').get().n,1);});
});

test('expired, different-URL and different-session receipts never publish a private station',async()=>{
 for(const kind of ['expired','url','session']){const f=await fixture();if(kind==='expired')await receipt(f,original,{now:f.now-3600});else if(kind==='url')await receipt(f,changed);else{const hash='f'.repeat(64);f.sqlite.prepare('INSERT INTO sessions(token_hash,csrf_hash,created_at,expires) VALUES (?,?,?,?)').run(hash,'e'.repeat(64),f.now,f.now+7200);await receipt(f,original,{hash});}await mockedCreative(async calls=>{const result=await save(f);assert.equal(result.stream_check_required,true,kind);assert.equal(row(f).status,'pending_review',kind);assert.equal(calls.length,0,kind);});}
});

test('changing an approved station to an unchecked URL retains its old public stream and saves a private proposal',async()=>{
 const f=await fixture({published:true});await mockedCreative(async calls=>{const result=await save(f,{stream_url:changed});assert.equal(result.review_required,true);assert.equal(result.stream_check_required,true);assert.equal(row(f).status,'published');assert.equal(row(f).stream_url,original);assert.equal(pending(f).stream_url,changed);assert.equal(calls.length,0);});
});

test('review request records the owner exact current revision without publishing and rejects stale or non-owner requests',async()=>{
 const f=await fixture();const initial=await ownerState(f);const response=await authRoutes(f.request('/api/owner/stream-review',{revision:initial.revision}),f.env,f.now),result=await response.json();assert.equal(result.stream_check.status,'review_requested');assert.equal(row(f).status,'pending_review');let proof=f.sqlite.prepare('SELECT * FROM station_stream_checks').get();assert.equal(proof.revision,'initial');assert.equal(proof.checked_at,0);assert.equal(proof.review_requested_at,f.now);
 await mockedCreative(()=>save(f,{stream_url:changed}));await assert.rejects(authRoutes(f.request('/api/owner/stream-review',{revision:initial.revision}),f.env,f.now),error=>error.status===409);const latest=await ownerState(f);await authRoutes(f.request('/api/owner/stream-review',{revision:latest.revision}),f.env,f.now);proof=f.sqlite.prepare('SELECT * FROM station_stream_checks WHERE stream_url=?').get(changed);assert.equal(proof.revision,pending(f).revision);assert.equal(proof.checked_at,0);assert.equal(row(f).stream_url,original);assert.equal(row(f).status,'pending_review');
 const outsider=await fixture({owner:false});await assert.rejects(authRoutes(outsider.request('/api/owner/stream-review',{revision:latest.revision}),outsider.env,outsider.now),error=>error.status===401);assert.equal(outsider.sqlite.prepare('SELECT COUNT(*) n FROM station_stream_checks').get().n,0);
});

test('a proof invalidated while creative review is awaiting response cannot publish at commit',async()=>{
 for(const wasPublished of [false,true]){const f=await fixture({published:wasPublished}),target=wasPublished?changed:original;await receipt(f,target);await mockedCreative(async calls=>{const result=await save(f,wasPublished?{stream_url:changed}:{});assert.equal(calls.length,1);assert.equal(result.review_required,true);assert.equal(result.stream_check_required,true);assert.equal(row(f).status,wasPublished?'published':'pending_review');assert.equal(row(f).stream_url,original);assert.equal(f.sqlite.prepare('SELECT COUNT(*) n FROM mail_outbox').get().n,0);if(wasPublished)assert.equal(pending(f).stream_url,changed);},async()=>{const id=await beginStreamCheck(f.env,f.hash,target,f.now);await completeStreamCheck(f.env,f.hash,target,id,false,f.now);return creative(true);});}
});

test('Save during a fresh pending recheck cannot use an earlier private station pass',async()=>{
 const f=await fixture();await receipt(f);await mockedCreative(()=>save(f),async()=>creative(false));assert.equal(f.sqlite.prepare('SELECT checked_at FROM station_stream_checks').get().checked_at,f.now);await beginStreamCheck(f.env,f.hash,original,f.now);await mockedCreative(async calls=>{const result=await save(f);assert.equal(result.stream_check_required,true);assert.equal(result.review_required,true);assert.equal(row(f).status,'pending_review');assert.equal(calls.length,0);});
});

test('administrator cannot approve an unchecked stream without an explicit override and a required reason',async()=>{
 const f=await fixture();f.admin();const reviewed=await adminState(f);for(const extra of [{},{stream_override:'true',reason:'I reviewed the stream.'},{stream_override:true},{stream_override:true,reason:'   '}])await assert.rejects(adminRoutes(f.request('/api/admin/station',{code:f.station,action:'approve',revision:reviewed.revision,...extra}),f.env,f.now),error=>error.status===400);assert.equal(row(f).status,'pending_review');assert.equal(f.sqlite.prepare('SELECT COUNT(*) n FROM admin_audit').get().n,0);
 const reason='I manually verified the public listening stream.';const result=await (await adminRoutes(f.request('/api/admin/station',{code:f.station,action:'approve',revision:reviewed.revision,stream_override:true,reason}),f.env,f.now)).json();assert.equal(result.status,'ok');assert.equal(row(f).status,'published');const audit=f.sqlite.prepare('SELECT action FROM admin_audit').get();assert.equal(audit.action,'approve-stream-override:'+reviewed.revision+':'+reason);assert.equal(f.sqlite.prepare('SELECT COUNT(*) n FROM mail_outbox').get().n,1);
});

test('administrator override still requires the exact reviewed row and cannot bypass the commit CAS',async()=>{
 for(const race of ['before-request','at-commit']){const f=await fixture();f.admin();const reviewed=await adminState(f);if(race==='before-request')f.sqlite.prepare("UPDATE stations SET bio='Changed after review' WHERE code=?").run(f.station);else{const batch=f.env.DB.batch;let changed=false;f.env.DB.batch=async queries=>{if(!changed){changed=true;f.sqlite.prepare("UPDATE stations SET bio='Changed at commit' WHERE code=?").run(f.station);}return batch(queries);};}await assert.rejects(adminRoutes(f.request('/api/admin/station',{code:f.station,action:'approve',revision:reviewed.revision,stream_override:true,reason:'I manually reviewed this listening stream.'}),f.env,f.now),error=>error.status===409);assert.equal(row(f).status,'pending_review',race);assert.equal(f.sqlite.prepare('SELECT COUNT(*) n FROM admin_audit').get().n,0,race);assert.equal(f.sqlite.prepare('SELECT COUNT(*) n FROM mail_outbox').get().n,0,race);}
});
