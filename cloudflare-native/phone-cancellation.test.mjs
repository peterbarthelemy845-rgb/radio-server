import {test} from 'node:test';
import assert from 'node:assert/strict';
import {operationsFixture} from './operations-fixture.mjs';
import {phoneRoutes} from './phone-link.mjs';
import {approvalStatements} from './radio-controls.mjs';
import {authRoutes} from './owner-auth.mjs';
import {handle} from './worker.mjs';
import {digest,mac} from './security.mjs';
const radio='a'.repeat(32),secret='b'.repeat(64),origin='https://radiolocals.com',firstId='1'.repeat(32),secondId='2'.repeat(32);
function deferred(){let resolve;const promise=new Promise(done=>resolve=done);return {promise,resolve};}
async function until(check){for(let i=0;i<40&&!check();i++)await new Promise(setImmediate);assert.ok(check(),'Async checkpoint not reached');}
async function fixture(){
 const f=await operationsFixture(),hash=f.sqlite.prepare('SELECT token_hash FROM sessions').get().token_hash;
 f.sqlite.prepare('INSERT INTO radios(id,secret_hash,created_at,last_seen) VALUES (?,?,?,?)').run(radio,await digest(secret),f.now,f.now);
 f.sqlite.prepare('INSERT INTO radio_pairs(radio_id,code_hash,expires) VALUES (?,?,0)').run(radio,await mac(f.env,'device-code:1234'));
 async function post(path,body,at=f.now,deps={human:async()=>{}}){return phoneRoutes(f.request('/api/phone/'+path,body),f.env,at,deps);}
 async function claim(requestId=firstId,at=f.now){return(await post('claim',{device_code:'1234',request_id:requestId},at)).json();}
 async function cancel(requestId=firstId,at=f.now){return(await post('claim/cancel',{request_id:requestId},at)).json();}
 async function approve(claim,at=f.now){await f.env.DB.batch(approvalStatements(f.env,radio,claim.claim_id,'approve',{},at));}
 async function poll(body={},at=f.now){return(await handle(new Request(origin+'/api/radio/poll',{method:'POST',headers:{Authorization:'Bearer '+secret,'Content-Type':'application/json'},body:JSON.stringify({radio_id:radio,...body})}),f.env,at)).json();}
 return {...f,hash,post,claim,cancel,approve,poll,grant:()=>f.sqlite.prepare('SELECT expires FROM phone_radios WHERE session_hash=? AND radio_id=?').get(hash,radio)};
}

test('cancel before the claim POST leaves a session-bound tombstone and performs no bot check or physical request',async()=>{
 const f=await fixture();assert.deepEqual(await f.cancel(),{state:'cancelled'});let checked=false;
 await assert.rejects(f.post('claim',{device_code:'1234',request_id:firstId},f.now,{human:async()=>{checked=true;}}),error=>error.status===409);assert.equal(checked,false);assert.equal(f.sqlite.prepare('SELECT count(*) n FROM pair_claims').get().n,0);assert.equal(f.grant(),undefined);assert.equal((await f.poll()).pair_claim_id,'');
});

test('cancel while bot verification is in flight prevents a late claim write',async()=>{
 const f=await fixture(),check=deferred();let started=false;const creating=f.post('claim',{device_code:'1234',request_id:firstId},f.now,{human:async()=>{started=true;await check.promise;}});await until(()=>started);await f.cancel();check.resolve();await assert.rejects(creating,error=>error.status===409);assert.equal(f.sqlite.prepare('SELECT count(*) n FROM pair_claims').get().n,0);assert.equal(f.grant(),undefined);
});

test('cancel between validation and the atomic claim insertion prevents a waiting prompt',async()=>{
 const f=await fixture(),prepare=f.env.DB.prepare.bind(f.env.DB),batch=f.env.DB.batch.bind(f.env.DB);let inserting=false,raced=false;
 f.env.DB.prepare=sql=>{if(sql.startsWith('INSERT INTO pair_claims('))inserting=true;return prepare(sql);};f.env.DB.batch=async statements=>{if(inserting&&!raced){inserting=false;raced=true;await f.cancel();}return batch(statements);};await assert.rejects(f.claim(),error=>error.status===409);assert.equal(raced,true);assert.equal(f.sqlite.prepare('SELECT count(*) n FROM pair_claims').get().n,0);assert.equal(f.grant(),undefined);
});

test('cancelling a waiting claim removes its radio prompt and a late physical approval cannot grant access',async()=>{
 const f=await fixture(),claim=await f.claim();assert.equal((await f.poll()).pair_claim_id,claim.claim_id);await f.cancel();const polled=await f.poll({pair_claim_id:claim.claim_id,pair_decision:'approve'});assert.equal(polled.claim_result,'cancelled');assert.equal(polled.pair_claim_id,'');assert.equal(polled.linked,false);assert.equal(f.grant(),undefined);
 assert.deepEqual(await f.cancel(),{state:'cancelled'});assert.equal(f.sqlite.prepare('SELECT count(*) n FROM phone_pair_requests').get().n,1);
});

test('cancellation after approval revokes only its newly created base grant and invalidates its pending station command',async()=>{
 const f=await fixture(),claim=await f.claim();await f.approve(claim);assert.ok(f.grant());const command=await(await f.post('add',{radio_id:radio,station_code:String(f.station)})).json();await f.cancel();assert.equal(f.grant(),undefined);assert.equal(f.sqlite.prepare('SELECT state FROM radio_commands WHERE id=?').get(command.command_id).state,'failed');
 const late=await f.poll({pair_claim_id:claim.claim_id,pair_decision:'approve'});assert.equal(late.claim_result,'cancelled');assert.equal(late.linked,false);assert.equal(late.command_id,'');assert.equal(f.grant(),undefined);
});

test('cancellation preserves a valid pre-existing grant, its controls and already queued work at the original expiry',async()=>{
 const f=await fixture(),expires=f.now+1000;f.sqlite.prepare('INSERT INTO phone_radios VALUES (?,?,?)').run(f.hash,radio,expires);f.sqlite.prepare('INSERT INTO radio_control_grants VALUES (?,?,?,?)').run(f.hash,radio,f.now-1,f.now+900);const command=await(await f.post('add',{radio_id:radio,station_code:String(f.station)})).json();const claim=await f.claim();await f.approve(claim);assert.equal(f.grant().expires,f.now+2592000);await f.cancel();assert.equal(f.grant().expires,expires);assert.equal(f.sqlite.prepare('SELECT expires FROM radio_control_grants').get().expires,f.now+900);assert.equal(f.sqlite.prepare('SELECT state FROM radio_commands WHERE id=?').get(command.command_id).state,'pending');
});

test('separately approved attempts remain independent regardless of cancellation order',async()=>{
 for(const order of [[firstId,secondId],[secondId,firstId]]){const f=await fixture(),first=await f.claim(firstId);await f.approve(first);const second=await f.claim(secondId,f.now+1);await f.approve(second,f.now+1);await f.cancel(order[0],f.now+2);assert.ok(f.grant());const remaining=order[0]===firstId?f.now+1+2592000:f.now+2592000;assert.equal(f.grant().expires,remaining);await f.cancel(order[1],f.now+3);assert.equal(f.grant(),undefined);}
});

test('another session cancelling the same request reference cannot inspect or revoke the owner’s claim or grant',async()=>{
 const f=await fixture(),claim=await f.claim();await f.approve(claim);const response=await authRoutes(new Request(origin+'/api/session'),f.env,f.now),state=await response.json(),cookie=response.headers.get('Set-Cookie').split(';')[0];
 const request=new Request(origin+'/api/phone/claim/cancel',{method:'POST',headers:{Cookie:cookie,Origin:origin,'X-CSRF-Token':state.csrf,'Content-Type':'application/json'},body:JSON.stringify({request_id:firstId})});assert.deepEqual(await(await phoneRoutes(request,f.env,f.now)).json(),{state:'cancelled'});assert.ok(f.grant());assert.equal(f.sqlite.prepare('SELECT state FROM pair_claims WHERE id=?').get(claim.claim_id).state,'approved');assert.equal(f.sqlite.prepare('SELECT count(*) n FROM phone_pair_requests').get().n,2);
});

test('same request retries refer to the same claim and cannot silently adopt a different pending attempt',async()=>{
 const f=await fixture(),claim=await f.claim();assert.equal((await f.claim()).claim_id,claim.claim_id);await assert.rejects(f.claim(secondId),error=>error.status===409);assert.equal(f.sqlite.prepare('SELECT count(*) n FROM pair_claims').get().n,1);assert.equal(f.sqlite.prepare('SELECT claim_id FROM phone_pair_requests WHERE request_id=?').get(secondId).claim_id,null);await f.cancel(secondId);assert.equal(f.sqlite.prepare('SELECT state FROM pair_claims').get().state,'waiting');
});

test('invalid request references and unauthenticated cancellation fail before mutating attempts',async()=>{
 const f=await fixture();for(const requestId of ['',null,'bad','A'.repeat(32),'1'.repeat(33)]){await assert.rejects(f.post('claim/cancel',{request_id:requestId}),error=>error.status===400);await assert.rejects(f.post('claim',{device_code:'1234',request_id:requestId}),error=>error.status===400);}await assert.rejects(phoneRoutes(new Request(origin+'/api/phone/claim/cancel',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({request_id:firstId})}),f.env,f.now),error=>error.status===403||error.status===401);assert.equal(f.sqlite.prepare('SELECT count(*) n FROM phone_pair_requests').get().n,0);
});

test('cancellation is atomic if a write fails after a grant would have been removed',async()=>{
 const f=await fixture(),claim=await f.claim();await f.approve(claim);const prepare=f.env.DB.prepare.bind(f.env.DB);f.env.DB.prepare=sql=>{const statement=prepare(sql);if(sql.startsWith('DELETE FROM phone_pair_grant_sources WHERE session_hash=? AND claim_id='))statement.execute=async()=>{throw Error('simulated cancellation write failure');};return statement;};await assert.rejects(f.cancel(),/simulated/);assert.ok(f.grant());assert.equal(f.sqlite.prepare('SELECT state FROM pair_claims').get().state,'approved');assert.equal(f.sqlite.prepare('SELECT state FROM phone_pair_requests').get().state,'active');f.env.DB.prepare=prepare;await f.cancel();assert.equal(f.grant(),undefined);
});

test('a new approval after unlink cannot restore an older grant source cancelled later',async()=>{
 const f=await fixture(),first=await f.claim();await f.approve(first);await f.post('unlink',{radio_id:radio});const second=await f.claim(secondId,f.now+1);await f.approve(second,f.now+1);await f.cancel(firstId,f.now+2);assert.ok(f.grant());await f.cancel(secondId,f.now+3);assert.equal(f.grant(),undefined);
});

test('a tracked request cannot adopt or cancel a pre-existing legacy shared-flow prompt',async()=>{
 const f=await fixture(),legacy=await(await f.post('claim',{device_code:'1234'})).json();await assert.rejects(f.claim(),error=>error.status===409);await f.cancel();assert.equal(f.sqlite.prepare('SELECT state FROM pair_claims WHERE id=?').get(legacy.claim_id).state,'waiting');await f.approve(legacy);assert.ok(f.grant());
});

test('cancellation after insertion but before the claim response clears the unreturned prompt',async()=>{
 const f=await fixture(),prepare=f.env.DB.prepare.bind(f.env.DB);let raced=false;f.env.DB.prepare=sql=>{const query=prepare(sql);if(sql.startsWith('SELECT c.id,c.confirmation_code,c.session_hash FROM pair_claims c JOIN phone_pair_requests')){const first=query.first.bind(query);query.first=async()=>{if(!raced){raced=true;await f.cancel();}return first();};}return query;};await assert.rejects(f.claim(),error=>error.status===409);assert.equal(raced,true);assert.equal(f.sqlite.prepare('SELECT state FROM pair_claims').get().state,'cancelled');assert.equal((await f.poll()).pair_claim_id,'');assert.equal(f.grant(),undefined);
});

test('a radio reset retires old sources before a fresh physical approval is granted',async()=>{
 const f=await fixture(),first=await f.claim();await f.approve(first);await handle(new Request(origin+'/api/radio/link/reset',{method:'POST',headers:{Authorization:'Bearer '+secret,'Content-Type':'application/json'},body:JSON.stringify({radio_id:radio})}),f.env,f.now);f.sqlite.prepare('INSERT INTO radio_pairs(radio_id,code_hash,expires) VALUES (?,?,0)').run(radio,await mac(f.env,'device-code:1234'));const second=await f.claim(secondId,f.now+1);await f.approve(second,f.now+1);await f.cancel(firstId,f.now+2);assert.ok(f.grant());await f.cancel(secondId,f.now+3);assert.equal(f.grant(),undefined);assert.equal(f.sqlite.prepare('SELECT count(*) n FROM phone_pair_grant_sources WHERE radio_id=?').get(radio).n,0);
});

test('an untracked renewal newer than an existing source is preserved as its own baseline',async()=>{
 const f=await fixture(),first=await f.claim();await f.approve(first);const renewed=f.now+2592000+600;f.sqlite.prepare('UPDATE phone_radios SET expires=? WHERE session_hash=? AND radio_id=?').run(renewed,f.hash,radio);const second=await f.claim(secondId,f.now+1);await f.approve(second,f.now+1);await f.cancel(secondId,f.now+2);await f.cancel(firstId,f.now+3);assert.equal(f.grant().expires,renewed);
});
