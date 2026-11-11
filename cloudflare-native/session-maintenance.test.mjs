import {test} from 'node:test';
import assert from 'node:assert/strict';
import {operationsFixture} from './operations-fixture.mjs';
import {authRoutes} from './owner-auth.mjs';
import {mobileRoutes} from './mobile.mjs';
import {cleanup} from './worker.mjs';
import {digest} from './security.mjs';

test('new browser and native sessions share a global creation cap; existing sessions keep working',async()=>{
 const f=await operationsFixture(),key='session-create-global:'+await digest('all');
 f.sqlite.prepare('UPDATE rate_limits SET count=599 WHERE key=?').run(key);
 const fresh=await authRoutes(new Request('https://radiolocals.com/api/session',{headers:{'CF-Connecting-IP':'192.0.2.1'}}),f.env,f.now);
 assert.ok(fresh.headers.get('set-cookie'));
 await assert.rejects(authRoutes(new Request('https://radiolocals.com/api/session',{headers:{'CF-Connecting-IP':'192.0.2.2'}}),f.env,f.now),e=>e.status===429);
 const before=f.sqlite.prepare('SELECT count(*) n FROM sessions').get().n;
 assert.equal((await authRoutes(f.request('/api/session'),f.env,f.now)).status,200);
 assert.equal(f.sqlite.prepare('SELECT count(*) n FROM sessions').get().n,before);
 let checked=false;
 await assert.rejects(mobileRoutes(new Request('https://radiolocals.com/api/mobile/session',{method:'POST',headers:{'Content-Type':'application/json','CF-Connecting-IP':'192.0.2.3'},body:JSON.stringify({turnstile_token:'test'})}),f.env,f.now,{human:async()=>{checked=true;}}),e=>e.status===429);
 assert.equal(checked,true);assert.equal(f.sqlite.prepare('SELECT count(*) n FROM sessions').get().n,before);
 assert.equal((await authRoutes(new Request('https://radiolocals.com/api/session'),f.env,f.now+61)).status,200);
});

test('failed native bot checks never consume the shared new-session allowance',async()=>{
 const f=await operationsFixture(),key='session-create-global:'+await digest('all'),count=f.sqlite.prepare('SELECT count FROM rate_limits WHERE key=?').get(key).count;
 await assert.rejects(mobileRoutes(new Request('https://radiolocals.com/api/mobile/session',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'}),f.env,f.now,{human:async()=>{throw Error('invalid bot check');}}),/invalid bot check/);
 assert.equal(f.sqlite.prepare('SELECT count FROM rate_limits WHERE key=?').get(key).count,count);
});

test('expired credentials and FK children are retired while active grants, station history and audit records survive',async()=>{
 const f=await operationsFixture(),old=f.now-8*86400,hash='retired',active='active-grant',recent='recently-expired';
 const session=f.sqlite.prepare('INSERT INTO sessions(token_hash,csrf_hash,created_at,expires) VALUES (?,?,?,?)');
 session.run(hash,'hash',old-30*86400,old);session.run(active,'hash',old-30*86400,old);session.run(recent,'hash',old, f.now-86400);
 f.sqlite.prepare('INSERT INTO email_verifications(id,session_hash,station_code,purpose,code_hash,expires,created_at) VALUES (?,?,?,?,?,?,?)').run('verification',hash,f.station,'edit','hash',old,old);
 f.sqlite.prepare('INSERT INTO registration_requests(session_hash,request_id,payload_hash,lease_token,lease_until,station_code,verification_id,created_at,expires) VALUES (?,?,?,?,?,?,?,?,?)').run(hash,'a'.repeat(32),'hash','lease',old,f.station,'verification',old,old);
 f.sqlite.prepare('INSERT INTO admin_verifications(id,session_hash,code_hash,expires,created_at) VALUES (?,?,?,?,?)').run('admin-verification',hash,'hash',old,old);
 f.sqlite.prepare('INSERT INTO admin_email_proofs(id,session_hash,expires) VALUES (?,?,?)').run('admin-proof',hash,old);
 for(const table of ['admin_sessions','admin_mfa_sessions','support_grants'])f.sqlite.prepare('INSERT INTO '+table+' VALUES (?,?)').run(hash,old);
 f.sqlite.prepare('INSERT INTO legal_requests VALUES (?,?,?,?,?)').run('ticket','support','encrypted','new',old);
 f.sqlite.prepare('INSERT INTO support_ticket_grants VALUES (?,?,?)').run(hash,'ticket',old);
 f.sqlite.prepare('INSERT INTO support_status_verifications(id,session_hash,ticket_id,code_hash,expires,created_at) VALUES (?,?,?,?,?,?)').run('support-proof',hash,'ticket','hash',old,old);
 f.sqlite.prepare('INSERT INTO pair_claims VALUES (?,?,?,?,?,?,?)').run('claim','radio-one',hash,'1234','approved',old,old);
 f.sqlite.prepare('INSERT INTO radio_control_claims VALUES (?)').run('claim');
 for(const [value,expiry] of [[hash,old],[active,f.now+1000]])f.sqlite.prepare('INSERT INTO phone_radios VALUES (?,?,?)').run(value,'radio-one',expiry);
 f.sqlite.prepare('INSERT INTO radio_control_grants VALUES (?,?,?,?)').run(hash,'radio-one',old,old);
 f.sqlite.prepare("INSERT INTO radio_control_commands(id,session_hash,radio_id,request_id,request_hash,action,value_json,state,created_at,expires) VALUES (?,?,?,?,?,'set_mute','true','applied',?,?)").run('control-command',hash,'radio-one','request','hash',old,old);
 f.sqlite.prepare("INSERT INTO radio_commands(id,radio_id,station_code,state,created_at,expires,session_hash) VALUES ('added','radio-one',?,'added',?,?,?)").run(f.station,old,old,hash);
 f.sqlite.prepare("INSERT INTO radio_commands(id,radio_id,station_code,state,created_at,expires,session_hash) VALUES ('active-history','radio-one',?,'added',?,?,?)").run(f.station,old,old,active);
 f.sqlite.prepare('INSERT INTO agreement_acceptances(station_code,agreement_version,agreement_hash,accepted_at) VALUES (?,?,?,?)').run(f.station,'v1','hash',old);
 f.sqlite.prepare('INSERT INTO admin_audit(id,actor_hash,action,created_at) VALUES (?,?,?,?)').run('audit',hash,'review',old);
 f.sqlite.prepare('INSERT INTO support_replies(id,ticket_id,request_id,request_hash,operation_token,actor_hash,encrypted_payload,state,created_at) VALUES (?,?,?,?,?,?,?,?,?)').run('reply','ticket','request','hash','op',hash,'encrypted','new',old);
 const current=f.sqlite.prepare("SELECT token_hash FROM sessions WHERE token_hash NOT IN ('retired','active-grant','recently-expired')").get().token_hash;
 for(const table of ['admin_sessions','admin_mfa_sessions','support_grants'])f.sqlite.prepare('INSERT INTO '+table+' VALUES (?,?)').run(current,f.now+1000);
 await cleanup(f.env,f.now);
 assert.equal(f.sqlite.prepare('SELECT 1 FROM sessions WHERE token_hash=?').get(hash),undefined);
 assert.ok(f.sqlite.prepare('SELECT 1 FROM sessions WHERE token_hash=?').get(active),'an unexpired phone grant keeps its parent session');
 assert.ok(f.sqlite.prepare('SELECT 1 FROM sessions WHERE token_hash=?').get(recent),'recently expired sessions retain a seven-day grace period');
 assert.ok(f.sqlite.prepare('SELECT 1 FROM phone_radios WHERE session_hash=?').get(active));
 for(const table of ['registration_requests','email_verifications','admin_verifications','admin_email_proofs','support_ticket_grants','support_status_verifications','pair_claims','radio_control_claims','radio_control_commands','radio_control_grants'])assert.equal(f.sqlite.prepare('SELECT count(*) n FROM '+table).get().n,0,table);
 for(const table of ['admin_sessions','admin_mfa_sessions','support_grants'])assert.equal(f.sqlite.prepare('SELECT session_hash FROM '+table).get().session_hash,current,table);
 assert.deepEqual({...f.sqlite.prepare("SELECT state,session_hash FROM radio_commands WHERE id='added'").get()},{state:'added',session_hash:null});
 assert.equal(f.sqlite.prepare("SELECT session_hash FROM radio_commands WHERE id='active-history'").get().session_hash,active);
 for(const table of ['stations','agreement_acceptances','admin_audit','legal_requests','support_replies'])assert.equal(f.sqlite.prepare('SELECT count(*) n FROM '+table).get().n,1,table);
 assert.deepEqual(f.sqlite.prepare('PRAGMA foreign_key_check').all(),[]);
});

test('expired session backlogs drain in bounded batches across repeated cron runs',async()=>{
 const f=await operationsFixture(),old=f.now-8*86400;
 const insert=f.sqlite.prepare('INSERT INTO sessions(token_hash,csrf_hash,created_at,expires) VALUES (?,?,?,?)');
 for(let i=0;i<451;i++)insert.run('old-'+i,'hash',old-1,old);
 for(const expected of [251,51,0]){
  await cleanup(f.env,f.now);
  assert.equal(f.sqlite.prepare('SELECT count(*) n FROM sessions WHERE expires<=?').get(old).n,expected);
 }
 assert.equal(f.sqlite.prepare('SELECT count(*) n FROM sessions').get().n,1,'the active browser is never purged');
});

test('expired proof backlogs do not break parent FK cleanup and retain a bounded per-run delete budget',async()=>{
 const f=await operationsFixture(),old=f.now-8*86400,hash='proof-backlog';
 f.sqlite.prepare('INSERT INTO sessions(token_hash,csrf_hash,created_at,expires) VALUES (?,?,?,?)').run(hash,'hash',old-1,old);
 const insert=f.sqlite.prepare("INSERT INTO email_verifications(id,session_hash,station_code,purpose,code_hash,expires,created_at) VALUES (?,?,?,'edit','hash',?,?)");
 for(let i=0;i<451;i++)insert.run('proof-'+i,hash,f.station,old,old);
 await cleanup(f.env,f.now);
 assert.equal(f.sqlite.prepare('SELECT count(*) n FROM email_verifications').get().n,251);
 assert.ok(f.sqlite.prepare('SELECT 1 FROM sessions WHERE token_hash=?').get(hash),'parent remains until all referencing proofs have drained');
 await cleanup(f.env,f.now);await cleanup(f.env,f.now);
 assert.equal(f.sqlite.prepare('SELECT 1 FROM sessions WHERE token_hash=?').get(hash),undefined);
});

test('pairing tombstones and expired or unlinked grant sources drain without removing active grants',async()=>{
 const f=await operationsFixture(),current=f.sqlite.prepare('SELECT token_hash FROM sessions').get().token_hash,old=f.now-8*86400,retired='retired-pairing-session';f.sqlite.prepare('INSERT INTO sessions(token_hash,csrf_hash,created_at,expires) VALUES (?,?,?,?)').run(retired,'hash',old-100,old);
 f.sqlite.prepare("INSERT INTO phone_pair_requests(session_hash,request_id,state,created_at,expires) VALUES (?,?,'cancelled',?,?)").run(retired,'1'.repeat(32),old-100,old);
 f.sqlite.prepare("INSERT INTO phone_pair_grant_sources VALUES (?,?,'old','base','token',?)").run(retired,'radio-one',old);
 f.sqlite.prepare('INSERT INTO phone_radios VALUES (?,?,?)').run(current,'radio-one',f.now+1000);f.sqlite.prepare("INSERT INTO phone_pair_grant_sources VALUES (?,?,'active','base','token',?)").run(current,'radio-one',f.now+1000);
 await cleanup(f.env,f.now);assert.equal(f.sqlite.prepare('SELECT 1 FROM sessions WHERE token_hash=?').get(retired),undefined);assert.equal(f.sqlite.prepare('SELECT count(*) n FROM phone_pair_requests').get().n,0);assert.equal(f.sqlite.prepare('SELECT count(*) n FROM phone_pair_grant_sources').get().n,1);assert.equal(f.sqlite.prepare('SELECT claim_id FROM phone_pair_grant_sources').get().claim_id,'active');assert.ok(f.sqlite.prepare('SELECT 1 FROM phone_radios WHERE session_hash=?').get(current));
 f.sqlite.prepare('DELETE FROM phone_radios WHERE session_hash=?').run(current);await cleanup(f.env,f.now);assert.equal(f.sqlite.prepare('SELECT count(*) n FROM phone_pair_grant_sources').get().n,0);assert.deepEqual(f.sqlite.prepare('PRAGMA foreign_key_check').all(),[]);
});

test('pairing request backlogs retain the bounded cleanup budget before retiring their session',async()=>{
 const f=await operationsFixture(),old=f.now-8*86400,hash='pairing-backlog';f.sqlite.prepare('INSERT INTO sessions(token_hash,csrf_hash,created_at,expires) VALUES (?,?,?,?)').run(hash,'hash',old-10,old);const insert=f.sqlite.prepare("INSERT INTO phone_pair_requests(session_hash,request_id,state,created_at,expires) VALUES (?,?,'cancelled',?,?)");for(let i=0;i<451;i++)insert.run(hash,i.toString(16).padStart(32,'0'),old-10,old);
 for(const expected of [251,51,0]){await cleanup(f.env,f.now);assert.equal(f.sqlite.prepare('SELECT count(*) n FROM phone_pair_requests WHERE session_hash=?').get(hash).n,expected);assert.equal(!!f.sqlite.prepare('SELECT 1 FROM sessions WHERE token_hash=?').get(hash),expected>0);}
});

test('support retry backlogs drain in bounded batches before retiring the parent session or affecting ticket history',async()=>{
 const f=await operationsFixture(),old=f.now-8*86400,hash='support-backlog';f.sqlite.exec('PRAGMA foreign_keys=ON');f.sqlite.prepare('INSERT INTO sessions(token_hash,csrf_hash,created_at,expires) VALUES (?,?,?,?)').run(hash,'hash',old-10,old);
 f.sqlite.prepare("INSERT INTO legal_requests(id,kind,encrypted_payload,created_at) VALUES ('history','support','encrypted history',?)").run(old);
 const insert=f.sqlite.prepare('INSERT INTO support_ticket_requests VALUES (?,?,?,?,?,?,?)');for(let i=0;i<451;i++)insert.run(hash,i.toString(16).padStart(32,'0'),'payload-hash','ticket-'+i,'operation',old-10,old);
 for(const expected of [251,51,0]){await cleanup(f.env,f.now);assert.equal(f.sqlite.prepare('SELECT count(*) n FROM support_ticket_requests WHERE session_hash=?').get(hash).n,expected);assert.equal(!!f.sqlite.prepare('SELECT 1 FROM sessions WHERE token_hash=?').get(hash),expected>0);assert.equal(f.sqlite.prepare("SELECT kind FROM legal_requests WHERE id='history'").get().kind,'support');}
 assert.deepEqual(f.sqlite.prepare('PRAGMA foreign_key_check').all(),[]);
});

test('advertisement retry ledgers drain in bounded batches without cascading their session or deleting campaigns',async()=>{
 const f=await operationsFixture(),old=f.now-8*86400,hash='ad-request-backlog';f.sqlite.exec('PRAGMA foreign_keys=ON');f.sqlite.prepare('INSERT INTO sessions(token_hash,csrf_hash,created_at,expires) VALUES (?,?,?,?)').run(hash,'hash',old-10,old);
 f.sqlite.prepare("INSERT INTO local_ads(id,station_code,business,contact_email,message,created_at) VALUES ('campaign',?,'Business','owner@example.com','Message',?)").run(f.station,old);
 const insert=f.sqlite.prepare('INSERT INTO ad_requests(session_hash,request_id,payload_hash,lease_token,lease_until,ad_id,created_at,expires) VALUES (?,?,?,?,?,?,?,?)');for(let i=0;i<451;i++)insert.run(hash,i.toString(16).padStart(32,'0'),'hash','lease',0,'ad-'+i,old-10,old);
 for(const expected of [251,51,0]){await cleanup(f.env,f.now);assert.equal(f.sqlite.prepare('SELECT count(*) n FROM ad_requests WHERE session_hash=?').get(hash).n,expected);assert.equal(!!f.sqlite.prepare('SELECT 1 FROM sessions WHERE token_hash=?').get(hash),expected>0);assert.equal(f.sqlite.prepare("SELECT business FROM local_ads WHERE id='campaign'").get().business,'Business');}
 assert.deepEqual(f.sqlite.prepare('PRAGMA foreign_key_check').all(),[]);
});
