import {test} from 'node:test';import assert from 'node:assert/strict';
import {operationsFixture} from './operations-fixture.mjs';import {communityRoutes} from './community.mjs';import {authRoutes} from './owner-auth.mjs';import {digest} from './security.mjs';
const draft={request_id:'a'.repeat(32),name:'Listener',email:'listener@example.com',subject:'Wi-Fi help',message:'My radio cannot connect.',device_code:'3961'};
async function setup(){const f=await operationsFixture(),checks=[];let lock=Promise.resolve();const batch=f.env.DB.batch.bind(f.env.DB);f.env.DB.batch=queries=>{const result=lock.then(()=>batch(queries));lock=result.catch(()=>{});return result;};
 const send=(data=draft,request=f.request)=>communityRoutes(request('/api/support/ticket',data),f.env,f.now,{human:async()=>{checks.push('checked');}});
 return {...f,checks,send};}
test('uncertain-response retry returns the same support reference without another ticket, receipt, grant or new-ticket quota',async()=>{
 const f=await setup(),first=await(await f.send()).json();
 for(let i=0;i<5;i++)assert.deepEqual(await(await f.send({...draft,name:' Listener ',email:' LISTENER@EXAMPLE.COM ',device_code:' 3961 ',turnstile_token:'new-check'})).json(),first);
 for(const table of ['legal_requests','mail_outbox','support_ticket_grants','support_ticket_requests'])assert.equal(f.sqlite.prepare('SELECT count(*) n FROM '+table).get().n,1,table);
 const quota='ticket-recipient:'+await digest(draft.email);assert.equal(f.sqlite.prepare('SELECT count FROM rate_limits WHERE key=?').get(quota).count,1);assert.equal(f.checks.length,6);
 assert.equal(f.sqlite.prepare('SELECT count FROM rate_limits WHERE key=?').get('ticket-attempt-global:'+await digest('all')).count,6);
});
test('concurrent identical support submissions commit one reference and one receipt',async()=>{
 const f=await setup(),results=await Promise.all([f.send(),f.send()]);const bodies=await Promise.all(results.map(result=>result.json()));assert.equal(bodies[0].reference,bodies[1].reference);
 for(const table of ['legal_requests','mail_outbox','support_ticket_grants','support_ticket_requests'])assert.equal(f.sqlite.prepare('SELECT count(*) n FROM '+table).get().n,1,table);
});
test('reusing a support request ID with changed fields is rejected, including a concurrent changed draft',async()=>{
 const f=await setup();await f.send();for(const change of [{message:'Changed draft'},{device_code:'4000'},{email:'other@example.com'},{station_code:String(f.station)}])await assert.rejects(f.send({...draft,...change}),e=>e.status===409);
 const g=await setup(),results=await Promise.allSettled([g.send(),g.send({...draft,message:'A competing changed draft'})]);assert.equal(results.filter(r=>r.status==='fulfilled').length,1);assert.equal(results.find(r=>r.status==='rejected').reason.status,409);
 assert.equal(g.sqlite.prepare('SELECT count(*) n FROM legal_requests').get().n,1);assert.equal(g.sqlite.prepare('SELECT count(*) n FROM mail_outbox').get().n,1);
});
test('same browser can retry its submitted station ticket after the station is renamed or removed',async()=>{
 const f=await setup(),data={...draft,station_code:String(f.station)},first=await(await f.send(data)).json();f.sqlite.prepare("UPDATE stations SET name='Renamed',status='deleted' WHERE code=?").run(f.station);assert.equal((await(await f.send(data)).json()).reference,first.reference);
});
test('support operation IDs are session-scoped and malformed supplied IDs fail without side effects',async()=>{
 const f=await setup();await f.send();const response=await authRoutes(new Request('https://radiolocals.com/api/session'),f.env,f.now),state=await response.json(),cookie=response.headers.get('set-cookie').split(';')[0];
 const request=(path,body)=>new Request('https://radiolocals.com'+path,{method:'POST',headers:{Cookie:cookie,Origin:'https://radiolocals.com','X-CSRF-Token':state.csrf,'Content-Type':'application/json'},body:JSON.stringify(body)});
 const other=await(await f.send({...draft,message:'Other browser'},request)).json();assert.notEqual(other.reference,f.sqlite.prepare('SELECT ticket_id FROM support_ticket_requests ORDER BY rowid').get().ticket_id);
 for(const request_id of ['',null,{},'A'.repeat(32),'a'.repeat(31)])await assert.rejects(f.send({...draft,request_id}),e=>e.status===400);
 assert.equal(f.sqlite.prepare('SELECT count(*) n FROM legal_requests').get().n,2);assert.equal(f.sqlite.prepare('SELECT count(*) n FROM mail_outbox').get().n,2);
});
test('failure creating the ticket, grant or receipt rolls back the retry ledger and permits one successful retry',async()=>{
 for(const table of ['legal_requests','support_ticket_grants','mail_outbox']){const f=await setup();f.sqlite.exec(`CREATE TRIGGER reject_insert BEFORE INSERT ON ${table} BEGIN SELECT RAISE(ABORT,'simulated write failure'); END`);await assert.rejects(f.send(),/simulated write failure/);
  for(const target of ['legal_requests','support_ticket_grants','mail_outbox','support_ticket_requests'])assert.equal(f.sqlite.prepare('SELECT count(*) n FROM '+target).get().n,0,target);
  f.sqlite.exec('DROP TRIGGER reject_insert');await f.send();assert.equal(f.sqlite.prepare('SELECT count(*) n FROM legal_requests').get().n,1);assert.equal(f.sqlite.prepare('SELECT count(*) n FROM mail_outbox').get().n,1);}
});

test('replaying a support request still requires current CSRF and a passing bot check',async()=>{
 const f=await setup();await f.send();let checked=false;
 await assert.rejects(communityRoutes(f.request('/api/support/ticket',draft),f.env,f.now,{human:async()=>{checked=true;throw Error('fresh security check failed');}}),/fresh security check failed/);assert.equal(checked,true);
 const wrong=new Request(f.request('/api/support/ticket',draft));wrong.headers.set('X-CSRF-Token','0'.repeat(64));checked=false;await assert.rejects(communityRoutes(wrong,f.env,f.now,{human:async()=>{checked=true;}}),e=>e.status===403);assert.equal(checked,false);
 assert.equal(f.sqlite.prepare('SELECT count(*) n FROM legal_requests').get().n,1);assert.equal(f.sqlite.prepare('SELECT count(*) n FROM mail_outbox').get().n,1);
});
