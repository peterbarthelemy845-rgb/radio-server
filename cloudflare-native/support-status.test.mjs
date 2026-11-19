import {test} from 'node:test';
import assert from 'node:assert/strict';
import {operationsFixture} from './operations-fixture.mjs';
import {supportStatusRoutes} from './support-status.mjs';
import {communityRoutes} from './community.mjs';
import {authRoutes} from './owner-auth.mjs';
import {encrypt,decrypt,digest,mac} from './security.mjs';
import {supportRoutes} from './admin-support.mjs';

const human={human:async()=>{}};

async function replyFixture(){const f=await setup();f.env.ADMIN_EMAIL='support-admin@example.com';const reference=await f.insert();f.sqlite.prepare('INSERT INTO support_ticket_grants(session_hash,ticket_id,expires) SELECT token_hash,?,? FROM sessions').run(reference,f.now+1800);return {...f,reference,reply:(message='Here is the detail you requested.',request_id='customer_reply_request_1',at=f.now,request=f.request)=>f.call('/api/support/status/reply',{reference,message,request_id,turnstile_token:'fresh-proof',recipient:'attacker@example.com'},at,request)};}

test('verified customers reply in their existing encrypted thread with one admin notification and safe public attribution',async()=>{
 const f=await replyFixture(),result=await(await f.reply()).json();assert.equal(result.status,'ok');assert.equal(result.duplicate,false);
 const row=f.sqlite.prepare('SELECT * FROM support_replies').get(),payload=JSON.parse(await decrypt(f.env,row.encrypted_payload));assert.equal(payload.author,'customer');assert.equal(payload.body,'Here is the detail you requested.');assert.equal(payload.recipient,f.env.ADMIN_EMAIL);assert.equal(row.encrypted_payload.includes(payload.body),false);
 const jobs=f.sqlite.prepare('SELECT * FROM mail_outbox').all();assert.equal(jobs.length,1);assert.equal(jobs[0].recipient,f.env.ADMIN_EMAIL);assert.match(JSON.parse(await decrypt(f.env,jobs[0].encrypted_payload)).text,/Reference:/);
 const thread=await(await f.call('/api/support/status/ticket?reference='+f.reference)).json();assert.equal(thread.replies[0].author,'customer');assert.equal(thread.replies[0].body,payload.body);assert.equal(JSON.stringify(thread).includes(f.env.ADMIN_EMAIL),false);assert.equal(JSON.stringify(thread).includes(ticketData.email),false);
 f.admin();const admin=await(await supportRoutes(f.request('/api/admin/support?ticket_id='+f.reference),f.env,f.now)).json();assert.equal(admin.messages[0].author,'customer');assert.equal(admin.messages[0].body,payload.body);assert.equal(admin.ticket.state,'new');
 const duplicate=await(await f.reply()).json();assert.equal(duplicate.duplicate,true);assert.equal(f.sqlite.prepare('SELECT count(*) n FROM mail_outbox').get().n,1);await assert.rejects(f.reply('Different text'),e=>e.status===409);
});

test('customer replies require a current scoped ticket grant, browser CSRF and a fresh bot check',async()=>{
 const f=await replyFixture(),other=await f.secondBrowser();await assert.rejects(f.reply(undefined,undefined,f.now,other),e=>e.status===403);await assert.rejects(f.reply(undefined,undefined,f.now+1800),e=>e.status===403);
 const request=f.request('/api/support/status/reply',{reference:f.reference,message:'A reply',request_id:'customer_reply_valid_ref'});request.headers.set('X-CSRF-Token','bad');await assert.rejects(supportStatusRoutes(request,f.env,f.now,human),e=>e.status===403);
 let checks=0;await assert.rejects(supportStatusRoutes(f.request('/api/support/status/reply',{reference:f.reference,message:'A reply',request_id:'customer_reply_valid_ref'}),f.env,f.now,{human:async()=>{checks++;throw Error('Bot check failed');}}),/Bot check failed/);assert.equal(checks,1);assert.equal(f.sqlite.prepare('SELECT count(*) n FROM support_replies').get().n,0);assert.equal(f.sqlite.prepare('SELECT count(*) n FROM mail_outbox').get().n,0);
});

test('reply cooldown, spam and multi-signal abuse blocks protect the existing support inbox',async()=>{
 const f=await replyFixture();await f.reply();await assert.rejects(f.reply('Another reply','customer_reply_request_2',f.now+1),e=>e.status===429&&e.retry_after===29);assert.equal((await(await f.reply('Later reply','customer_reply_request_2',f.now+30)).json()).status,'ok');
 f.sqlite.prepare("INSERT INTO support_ticket_flags(ticket_id,folder,reason,updated_at,actor_hash) VALUES (?,'spam','manual',?,'admin')").run(f.reference,f.now);await assert.rejects(f.reply('Spam reply','customer_reply_request_3',f.now+60),e=>e.status===409);f.sqlite.prepare('DELETE FROM support_ticket_flags').run();
 const hash=await digest(f.request('/api/session').headers.get('Cookie').split('=')[1]);f.sqlite.prepare("INSERT INTO support_abuse_blocks(session_hash,email_hash,expires,reason) VALUES (?,?,?,'failed_email_proof')").run(hash,await mac(f.env,'support-email:'+ticketData.email),f.now+900);await assert.rejects(f.reply('Blocked reply','customer_reply_request_3',f.now+60),e=>e.status===429&&e.retry_after===840);
 assert.equal(f.sqlite.prepare('SELECT count(*) n FROM mail_outbox').get().n,2);
});

test('customer reply transactions roll back if mail cannot queue and closing access during a bot check prevents a send',async()=>{
 const f=await replyFixture();f.sqlite.exec("CREATE TRIGGER reject_customer_mail BEFORE INSERT ON mail_outbox BEGIN SELECT RAISE(ABORT,'mail unavailable'); END");await assert.rejects(f.reply(),/mail unavailable/);assert.equal(f.sqlite.prepare('SELECT count(*) n FROM support_replies').get().n,0);f.sqlite.exec('DROP TRIGGER reject_customer_mail');
 let release,started;const wait=new Promise(resolve=>{started=resolve;}),barrier=new Promise(resolve=>{release=resolve;});const pending=supportStatusRoutes(f.request('/api/support/status/reply',{reference:f.reference,message:'Pending reply',request_id:'customer_reply_race_1'}),f.env,f.now,{human:async()=>{started();await barrier;}});await wait;await f.call('/api/support/status/logout',{reference:f.reference});release();await assert.rejects(pending,e=>e.status===409);assert.equal(f.sqlite.prepare('SELECT count(*) n FROM support_replies').get().n,0);assert.equal(f.sqlite.prepare('SELECT count(*) n FROM mail_outbox').get().n,0);
});

test('a customer cooldown race cannot queue two different replies at the same time',async()=>{
 const f=await replyFixture(),batch=f.env.DB.batch.bind(f.env.DB);let release,reached,hold=true;const waiting=new Promise(resolve=>{reached=resolve;}),barrier=new Promise(resolve=>{release=resolve;});f.env.DB.batch=async statements=>{if(hold){hold=false;reached();await barrier;}return batch(statements);};
 const first=f.reply('First attempt','customer_reply_race_1');await waiting;assert.equal((await(await f.reply('Second attempt','customer_reply_race_2')).json()).status,'ok');release();await assert.rejects(first,e=>e.status===429&&e.retry_after===30);assert.equal(f.sqlite.prepare('SELECT count(*) n FROM support_replies').get().n,1);assert.equal(f.sqlite.prepare('SELECT count(*) n FROM mail_outbox').get().n,1);
});

test('reply message bounds and hourly ticket limit cannot be bypassed, but recorded retries remain safe',async()=>{
 const f=await replyFixture();for(const value of ['', ' '.repeat(20), 'x'.repeat(3001)])await assert.rejects(f.reply(value),e=>e.status===400);assert.equal(f.sqlite.prepare('SELECT count(*) n FROM support_replies').get().n,0);
 for(let i=0;i<6;i++)await f.reply('Bounded reply '+i,'customer_reply_hour_'+i,f.now+i*31);await assert.rejects(f.reply('One too many','customer_reply_hour_6',f.now+186),e=>e.status===429);assert.equal(f.sqlite.prepare('SELECT count(*) n FROM mail_outbox').get().n,6);assert.equal((await(await f.reply('Bounded reply 0','customer_reply_hour_0',f.now+186)).json()).duplicate,true);assert.equal(f.sqlite.prepare('SELECT count(*) n FROM mail_outbox').get().n,6);
});

test('ticket-access errors distinguish incorrect, exhausted and expired codes and report resend cooldown',async()=>{
 const f=await setup(),reference=await f.insert(),challenge=await(await f.call('/api/support/status/request',{reference,email:ticketData.email})).json(),correct=await f.code(challenge.verification_id),wrong=correct==='000000'?'111111':'000000';assert.equal(challenge.resend_after,60);
 for(let i=0;i<5;i++)await assert.rejects(f.call('/api/support/status/verify',{verification_id:challenge.verification_id,code:wrong}),e=>e.code===(i===4?'code_exhausted':'code_incorrect'));
 await assert.rejects(f.call('/api/support/status/verify',{verification_id:challenge.verification_id,code:correct}),e=>e.code==='code_expired');await assert.rejects(f.call('/api/support/status/request',{reference,email:ticketData.email},f.now+5),e=>e.status===429&&e.retry_after===55);
});
test('ticket-access email codes accept only whitespace formatting around six digits and still reject non-digits',async()=>{
 const f=await setup(),reference=await f.insert(),challenge=await(await f.call('/api/support/status/request',{reference,email:ticketData.email})).json(),code=await f.code(challenge.verification_id);await assert.rejects(f.call('/api/support/status/verify',{verification_id:challenge.verification_id,code:code.slice(0,3)+'x'+code.slice(3)}),error=>error.status===400);const result=await(await f.call('/api/support/status/verify',{verification_id:challenge.verification_id,code:code.slice(0,3)+' \n '+code.slice(3)})).json();assert.equal(result.status,'verified');
});
const ticketData={name:'Listener',email:'listener@example.com',subject:'Wi-Fi help',message:'I need help connecting.',device_code:'3961'};
async function setup(){
 const f=await operationsFixture();
 // Status tests start after the submitting browser has proved its contact email.
 const sessionHash=await digest(f.request('/api/session').headers.get('Cookie').split('=')[1]);
 f.sqlite.prepare('INSERT INTO support_sender_grants(session_hash,email_hash,verified_at,expires) VALUES (?,?,?,?)').run(sessionHash,await mac(f.env,'support-email:'+ticketData.email),f.now,f.now+2592000);
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

test('closing a private ticket cancels an in-flight email verification before it can restore access',async()=>{
 const f=await setup(),reference=await f.insert(),challenge=await(await f.call('/api/support/status/request',{reference,email:ticketData.email})).json(),code=await f.code(challenge.verification_id);
 const batch=f.env.DB.batch.bind(f.env.DB);let release,reached;const waiting=new Promise(resolve=>{reached=resolve;}),barrier=new Promise(resolve=>{release=resolve;});let hold=true;
 f.env.DB.batch=async statements=>{if(hold){hold=false;reached();await barrier;}return batch(statements);};
 const verifying=f.call('/api/support/status/verify',{verification_id:challenge.verification_id,code});await waiting;
 await f.call('/api/support/status/logout',{reference});release();
 await assert.rejects(verifying,e=>e.status===400);
 await assert.rejects(f.call('/api/support/status/ticket?reference='+reference),e=>e.status===403);
 assert.equal(f.sqlite.prepare('SELECT consumed_at FROM support_status_verifications WHERE id=?').get(challenge.verification_id).consumed_at,f.now);
 const next=await(await f.call('/api/support/status/request',{reference,email:ticketData.email},f.now+61)).json(),nextCode=await f.code(next.verification_id);
 assert.equal((await(await f.call('/api/support/status/verify',{verification_id:next.verification_id,code:nextCode},f.now+62)).json()).status,'verified');
});

test('private ticket close revokes only its session and ticket, and rolls back on storage failure',async()=>{
 const f=await setup(),reference=await f.insert(),another=await f.insert('c'.repeat(32)),other=await f.secondBrowser(),challenge=await(await f.call('/api/support/status/request',{reference,email:ticketData.email})).json(),otherChallenge=await(await f.call('/api/support/status/request',{reference,email:ticketData.email},f.now,other)).json();
 const sessionHash=f.sqlite.prepare('SELECT session_hash FROM support_status_verifications WHERE id=?').get(challenge.verification_id).session_hash;
 f.sqlite.prepare('INSERT INTO support_ticket_grants VALUES (?,?,?)').run(sessionHash,reference,f.now+1800);
 f.sqlite.prepare('INSERT INTO support_ticket_grants VALUES (?,?,?)').run(sessionHash,another,f.now+1800);
 f.sqlite.prepare('INSERT INTO support_status_verifications(id,session_hash,ticket_id,code_hash,expires,created_at) VALUES (?,?,?,?,?,?)').run('d'.repeat(32),sessionHash,another,'another-proof',f.now+900,f.now);
 f.sqlite.exec("CREATE TRIGGER reject_ticket_close BEFORE DELETE ON support_ticket_grants BEGIN SELECT RAISE(ABORT,'close rejected'); END");
 await assert.rejects(f.call('/api/support/status/logout',{reference}),/close rejected/);
 assert.equal(f.sqlite.prepare('SELECT consumed_at FROM support_status_verifications WHERE id=?').get(challenge.verification_id).consumed_at,null);
 assert.equal((await(await f.call('/api/support/status/ticket?reference='+reference)).json()).ticket.reference,reference);
 f.sqlite.exec('DROP TRIGGER reject_ticket_close');await f.call('/api/support/status/logout',{reference});
 assert.equal(f.sqlite.prepare('SELECT code_hash FROM support_status_verifications WHERE id=?').get(challenge.verification_id).code_hash,'');
 assert.equal(f.sqlite.prepare('SELECT consumed_at FROM support_status_verifications WHERE id=?').get(otherChallenge.verification_id).consumed_at,null);
 assert.equal(f.sqlite.prepare('SELECT consumed_at FROM support_status_verifications WHERE id=?').get('d'.repeat(32)).consumed_at,null);
 assert.equal((await(await f.call('/api/support/status/ticket?reference='+another)).json()).ticket.reference,another);
});
