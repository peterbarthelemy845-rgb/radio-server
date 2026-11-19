import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import {operationsFixture} from './operations-fixture.mjs';
import {phoneRoutes} from './phone-link.mjs';

async function fixture(){
 const f=await operationsFixture(),hash=f.sqlite.prepare('SELECT token_hash FROM sessions').get().token_hash;
 f.sqlite.prepare('INSERT INTO phone_radios VALUES (?,?,?)').run(hash,'radio-one',f.now+1000);
 return {...f,hash,async add(requestId,overrides={}){return (await phoneRoutes(f.request('/api/phone/add',{radio_id:'radio-one',station_code:String(f.station),request_id:requestId,...overrides}),f.env,f.now)).json();}};
}
test('a lost add response reuses its durable receipt even after the radio acknowledges it',async()=>{
 const f=await fixture(),requestId='a'.repeat(32),first=await f.add(requestId);
 f.sqlite.prepare("UPDATE radio_commands SET state='added' WHERE id=?").run(first.command_id);
 const replay=await f.add(requestId);assert.equal(replay.command_id,first.command_id);assert.equal(replay.state,'added');
 assert.equal(f.sqlite.prepare('SELECT count(*) n FROM radio_commands').get().n,1);
 const explicit=await f.add('b'.repeat(32));assert.notEqual(explicit.command_id,first.command_id,'A new explicit Add again remains possible');
});
test('separate retries that share a pending command each retain a receipt after acknowledgement',async()=>{
 const f=await fixture(),first=await f.add('a'.repeat(32)),other=await f.add('b'.repeat(32));assert.equal(other.command_id,first.command_id);
 f.sqlite.prepare("UPDATE radio_commands SET state='added' WHERE id=?").run(first.command_id);
 assert.equal((await f.add('b'.repeat(32))).command_id,first.command_id);assert.equal(f.sqlite.prepare('SELECT count(*) n FROM radio_commands').get().n,1);
});
test('a receipt cannot be reused for another destination or after its phone grant is revoked',async()=>{
 const f=await fixture(),id='a'.repeat(32);await f.add(id);
 f.sqlite.prepare("INSERT INTO radios(id,secret_hash,created_at,last_seen) VALUES ('radio-two','other',?,?)").run(f.now,f.now);
 f.sqlite.prepare('INSERT INTO phone_radios VALUES (?,?,?)').run(f.hash,'radio-two',f.now+1000);
 await assert.rejects(f.add(id,{radio_id:'radio-two'}),error=>error.status===409);assert.equal(f.sqlite.prepare('SELECT count(*) n FROM radio_commands').get().n,1);
 f.sqlite.prepare('DELETE FROM phone_radios WHERE radio_id=?').run('radio-one');await assert.rejects(f.add(id),error=>error.status===403);
});
test('a grant revoked immediately before the atomic batch cannot enqueue or create a receipt',async()=>{
 const f=await fixture(),batch=f.env.DB.batch.bind(f.env.DB);f.env.DB.batch=async queries=>{f.sqlite.prepare('DELETE FROM phone_radios').run();return batch(queries);};
 await assert.rejects(f.add('a'.repeat(32)),error=>error.status===409);assert.equal(f.sqlite.prepare('SELECT count(*) n FROM radio_commands').get().n,0);assert.equal(f.sqlite.prepare('SELECT count(*) n FROM phone_station_requests').get().n,0);
});
test('all concurrent command monitors share one paced status lane and stay below the session allowance',async()=>{
 const site=readFileSync(new URL('./public/assets/site.js',import.meta.url),'utf8'),source=site.slice(site.indexOf('let stationCommandStatusQueue='),site.indexOf('async function monitorStationDelivery('));
 let now=0,active=0,maximum=0;const calls=[];
 const context={Promise,Date:{now:()=>now},delay:async()=>{now+=2500;},setTimeout(fn,ms){now+=ms;queueMicrotask(fn);},api:async(path,body)=>{active++;maximum=Math.max(maximum,active);calls.push({at:now,id:body.command_id});await Promise.resolve();active--;return {state:'pending'};}};
 runInNewContext(source,context);const read=runInNewContext('readStationDeliveryStatus',context);
 await Promise.all(Array.from({length:80},(_,index)=>read({commandId:'command-'+index,deadline:1e9})));assert.equal(maximum,1);assert.equal(calls.length,80);
 for(const call of calls)assert.ok(calls.filter(candidate=>candidate.at>=call.at&&candidate.at<call.at+60000).length<=24);
});
test('a status throttle waits its retry interval and retains the same command rather than ending monitoring',async()=>{
 const site=readFileSync(new URL('./public/assets/site.js',import.meta.url),'utf8'),source=site.slice(site.indexOf('let stationCommandStatusQueue='),site.indexOf('async function monitorStationDelivery('));
 const waits=[],ids=[];let now=0;const context={Promise,Date:{now:()=>now},delay:async()=>{now+=2500;},setTimeout(fn,ms){waits.push(ms);now+=ms;queueMicrotask(fn);},api:async(path,body)=>{ids.push(body.command_id);if(ids.length===1)throw Object.assign(Error('Slow down'),{status:429,retry_after:7});return {state:'added'};}};
 runInNewContext(source,context);const result=await runInNewContext('readStationDeliveryStatus',context)({commandId:'same-command',deadline:1e9});assert.equal(result.state,'added');assert.deepEqual(waits,[7000]);assert.deepEqual(ids,['same-command','same-command']);
});
