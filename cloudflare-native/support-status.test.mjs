import {test} from 'node:test';
import assert from 'node:assert/strict';
import {operationsFixture} from './operations-fixture.mjs';
import {supportStatusRoutes} from './support-status.mjs';
import {communityRoutes} from './community.mjs';
import {authRoutes} from './owner-auth.mjs';
import {encrypt,decrypt} from './security.mjs';

const human={human:async()=>{}};
const ticketData={name:'Listener',email:'listener@example.com',subject:'Wi-Fi help',message:'I need help connecting.',device_code:'3961'};
async function setup(){
 const f=await operationsFixture();
 async function insert(id='b'.repeat(32),kind='support',payload=ticketData){f.sqlite.prepare('INSERT INTO legal_requests(id,kind,encrypted_payload,state,created_at) VALUES (?,?,?,?,?)').run(id,kind,await encrypt(f.env,JSON.stringify(payload)),'new',f.now);return id;}
 async function code(id){const row=f.sqlite.prepare('SELECT encrypted_payload FROM mail_outbox WHERE id=?').get('support-access:'+id);return JSON.parse(await decrypt(f.env,row.encrypted_payload)).text.match(/code is (\d{6})/)[1];}
 async function secondBrowser(){const response=await authRoutes(new Request('https://radiolocals.com/api/session'),f.env,f.now),data=await response.json(),cookie=response.headers.get('set-cookie').split(';')[0];return (path,body)=>new Request('https://radiolocals.com'+path,{method:body?'POST':'GET',headers:{Cookie:cookie,Origin:'https://radiolocals.com','Content-Type':'application/json','X-CSRF-Token':data.csrf},body:body?JSON.stringify(body):undefined});}
 const call=(path,body,at=f.now,request=f.request)=>supportStatusRoutes(request(path,body),f.env,at,human);
 return {...f,insert,code,call,secondBrowser};
}
test('new support submission grants its browser temporary access and returns only safe ticket fields',async()=>{
 const f=await setup(),result=await(await communityRoutes(f.request('/api/support/ticket',ticketData),f.env,f.now,human)).json();
 const recent=await(await f.call('/api/support/status/recent')).json();assert.equal(recent.tickets[0].reference,result.reference);
 const response=await f.call('/api/support/status/ticket?reference='+result.reference),body=await response.json();assert.equal(body.ticket.message,ticketData.message);assert.equal(body.ticket.state,'new');assert.equal(response.headers.get('cache-control'),'no-store');
 for(const value of [ticketData.email,ticketData.device_code,ticketData.name])assert.equal(JSON.stringify(body).includes(value),false);
 const grant=f.sqlite.prepare('SELECT expires FROM support_ticket_grants').get();assert.equal(grant.expires,f.now+1800);
 const other=await f.secondBrowser();await assert.rejects(f.call('/api/support/status/ticket?reference='+result.reference,undefined,f.now,other),e=>e.status===403);
 await assert.rejects(f.call('/api/support/status/ticket?reference='+result.reference,undefined,f.now+1800),e=>e.status===403);
});
test('email access is browser-bound, one-use and scoped to one support ticket with private encrypted codes',async()=>{
 const f=await setup(),id=await f.insert(),second=await f.insert('c'.repeat(32)),requested=await(await f.call('/api/support/status/request',{reference:id,email:ticketData.email})).json(),code=await f.code(requested.verification_id);
 const row=f.sqlite.prepare('SELECT * FROM support_status_verifications').get();assert.equal(row.code_hash.includes(code),false);assert.equal(JSON.stringify(row).includes(ticketData.email),false);
 const job=f.sqlite.prepare('SELECT * FROM mail_outbox').get();assert.equal(job.encrypted_payload.includes(code),false);assert.equal(job.subject,'Your private Radio Locals support code');assert.equal(job.recipient,ticketData.email);
 const other=await f.secondBrowser();await assert.rejects(f.call('/api/support/status/verify',{verification_id:requested.verification_id,code},f.now,other),e=>e.status===400);
 const verified=await(await f.call('/api/support/status/verify',{verification_id:requested.verification_id,code})).json();assert.equal(verified.reference,id);assert.equal(verified.expires_in,1800);
 await assert.rejects(f.call('/api/support/status/verify',{verification_id:requested.verification_id,code}),e=>e.status===400);
 await assert.rejects(f.call('/api/support/status/ticket?reference='+second),e=>e.status===403);
 assert.equal((await(await f.call('/api/support/status/ticket?reference='+id)).json()).ticket.reference,id);
 await f.call('/api/support/status/logout',{reference:id});await assert.rejects(f.call('/api/support/status/ticket?reference='+id),e=>e.status===403);
});
test('unknown, mismatched and legal references use generic verification responses without email or access',async()=>{
 const f=await setup(),support=await f.insert(),legal=await f.insert('d'.repeat(32),'privacy');const shapes=[];
 for(const [reference,email] of [[support,'wrong@example.com'],['e'.repeat(32),ticketData.email],[legal,ticketData.email]]){const request=await f.secondBrowser(),body=await(await f.call('/api/support/status/request',{reference,email},f.now,request)).json();shapes.push(body);assert.match(body.verification_id,/^[a-f0-9]{32}$/);assert.equal(f.sqlite.prepare('SELECT ticket_id FROM support_status_verifications WHERE id=?').get(body.verification_id).ticket_id,null);await assert.rejects(f.call('/api/support/status/verify',{verification_id:body.verification_id,code:'123456'},f.now,request),e=>e.status===400);}
 assert.equal(f.sqlite.prepare('SELECT count(*) n FROM mail_outbox').get().n,0);assert.equal(new Set(shapes.map(x=>x.message)).size,1);assert.equal(shapes[0].expires_in,900);
});
test('expired and exhausted email codes cannot unlock tickets; requesting again invalidates the prior challenge',async()=>{
 const f=await setup(),reference=await f.insert(),first=await(await f.call('/api/support/status/request',{reference,email:ticketData.email})).json(),correct=await f.code(first.verification_id),wrong=correct==='000000'?'111111':'000000';
 for(let i=0;i<5;i++)await assert.rejects(f.call('/api/support/status/verify',{verification_id:first.verification_id,code:wrong}),e=>e.status===400);
 await assert.rejects(f.call('/api/support/status/verify',{verification_id:first.verification_id,code:correct}),e=>e.status===400);
 await assert.rejects(f.call('/api/support/status/request',{reference,email:ticketData.email},f.now+1),e=>e.status===429);
 const second=await(await f.call('/api/support/status/request',{reference,email:ticketData.email},f.now+61)).json(),code=await f.code(second.verification_id);
 await assert.rejects(f.call('/api/support/status/verify',{verification_id:second.verification_id,code},f.now+61+900),e=>e.status===400);
 assert.equal(f.sqlite.prepare('SELECT count(*) n FROM support_ticket_grants').get().n,0);
});
test('support status writes require CSRF and read access is never granted by a public ticket reference',async()=>{
 const f=await setup(),id=await f.insert();
 await assert.rejects(supportStatusRoutes(new Request('https://radiolocals.com/api/support/status/recent'),f.env,f.now),e=>e.status===401);
 const request=f.request('/api/support/status/request',{reference:id,email:ticketData.email});request.headers.set('X-CSRF-Token','0'.repeat(64));await assert.rejects(supportStatusRoutes(request,f.env,f.now,human),e=>e.status===403);
 await assert.rejects(f.call('/api/support/status/ticket?reference='+id),e=>e.status===403);
 assert.equal(f.sqlite.prepare('SELECT count(*) n FROM mail_outbox').get().n,0);
});
test('failed bot checks are bounded before provider calls and cannot create email jobs',async()=>{
 const f=await setup(),id=await f.insert();let checks=0;
 for(let i=0;i<3;i++)await assert.rejects(supportStatusRoutes(f.request('/api/support/status/request',{reference:id,email:ticketData.email}),f.env,f.now,{human:async()=>{checks++;throw Error('Failed bot check');}}),/Failed bot check/);
 await assert.rejects(supportStatusRoutes(f.request('/api/support/status/request',{reference:id,email:ticketData.email}),f.env,f.now,{human:async()=>{checks++;}}),e=>e.status===429);assert.equal(checks,3);assert.equal(f.sqlite.prepare('SELECT count(*) n FROM mail_outbox').get().n,0);
});
test('private ticket view includes only its administrator replies and safe status history',async()=>{
 const f=await setup(),created=await(await communityRoutes(f.request('/api/support/ticket',ticketData),f.env,f.now,human)).json(),id=created.reference;
 f.sqlite.prepare('INSERT INTO support_replies(id,ticket_id,request_id,request_hash,operation_token,actor_hash,encrypted_payload,state,outbox_id,created_at) VALUES (?,?,?,?,?,?,?,?,?,?)').run('r',id,'request-123456789','hash','op','actor',await encrypt(f.env,JSON.stringify({recipient:ticketData.email,body:'Open Settings, then Wi-Fi.'})),'review','outbox',f.now+1);
 f.sqlite.prepare('INSERT INTO legal_actions VALUES (?,?,?,?,?)').run('action',id,'review','Internal private audit note',f.now+1);
 const result=await(await f.call('/api/support/status/ticket?reference='+id)).json();assert.equal(result.replies[0].body,'Open Settings, then Wi-Fi.');assert.equal(result.history[0].state,'review');assert.equal(JSON.stringify(result).includes('Internal private audit note'),false);assert.equal(JSON.stringify(result).includes(ticketData.email),false);
});
test('challenge mail and private access updates roll back atomically on storage failures',async()=>{
 const f=await setup(),reference=await f.insert();f.sqlite.exec("CREATE TRIGGER reject_access_mail BEFORE INSERT ON mail_outbox BEGIN SELECT RAISE(ABORT,'mail rejected'); END");
 await assert.rejects(f.call('/api/support/status/request',{reference,email:ticketData.email}),/mail rejected/);assert.equal(f.sqlite.prepare('SELECT count(*) n FROM support_status_verifications').get().n,0);
 f.sqlite.exec('DROP TRIGGER reject_access_mail');const challenge=await(await f.call('/api/support/status/request',{reference,email:ticketData.email},f.now+61)).json(),code=await f.code(challenge.verification_id);
 f.sqlite.exec("CREATE TRIGGER reject_ticket_grant BEFORE INSERT ON support_ticket_grants BEGIN SELECT RAISE(ABORT,'grant rejected'); END");
 await assert.rejects(f.call('/api/support/status/verify',{verification_id:challenge.verification_id,code},f.now+62),/grant rejected/);assert.equal(f.sqlite.prepare('SELECT consumed_at FROM support_status_verifications WHERE id=?').get(challenge.verification_id).consumed_at,null);
});
