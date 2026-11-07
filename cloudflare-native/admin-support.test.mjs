import {test} from 'node:test';
import assert from 'node:assert/strict';
import {operationsFixture} from './operations-fixture.mjs';
import {supportRoutes} from './admin-support.mjs';
import {encrypt,decrypt} from './security.mjs';
import {processMail} from './owner-auth.mjs';

const id='b'.repeat(32),recipient='original@example.com';
async function fixture(kind='support',email=recipient){
 const f=await operationsFixture();
 f.sqlite.prepare('INSERT INTO legal_requests(id,kind,encrypted_payload,created_at) VALUES (?,?,?,?)').run(id,kind,await encrypt(f.env,JSON.stringify({name:'A listener',email,subject:'Connection help',message:'The radio cannot connect.'})),f.now);
 f.post=(body,at=f.now)=>supportRoutes(f.request('/api/admin/support',{ticket_id:id,request_id:'request_0000000001',state:'review',...body}),f.env,at);
 f.get=()=>supportRoutes(f.request('/api/admin/support?ticket_id='+id),f.env,f.now);
 return f;
}

test('support replies require current admin MFA and browser CSRF on every write',async()=>{
 const f=await fixture();await assert.rejects(f.get(),e=>e.status===401);await assert.rejects(f.post({reply:'Hello'}),e=>e.status===401);
 f.admin();f.sqlite.exec('DELETE FROM admin_mfa_sessions');await assert.rejects(f.get(),e=>e.status===401);
 f.sqlite.exec('INSERT INTO admin_mfa_sessions SELECT token_hash,'+(f.now+900)+' FROM sessions');
 for(const change of [{Origin:'https://elsewhere.example'},{'X-CSRF-Token':'0'.repeat(64)}]){
  const request=f.request('/api/admin/support',{ticket_id:id,request_id:'request_0000000001',state:'review',reply:'Hello'});
  for(const [key,value] of Object.entries(change))request.headers.set(key,value);
  await assert.rejects(supportRoutes(request,f.env,f.now),e=>e.status===403);
 }
 await assert.rejects(f.post({reply:'Hello'},f.now+901),e=>e.status===401);
 assert.equal(f.sqlite.prepare('SELECT count(*) n FROM support_replies').get().n,0);
});

test('reply content and original recipient stay encrypted and create one durable email job',async()=>{
 const f=await fixture();f.admin();const reply='Hello, please reconnect the radio.';
 const result=await(await f.post({reply,recipient:'attacker@example.net',to:'attacker@example.net'})).json();
 assert.equal(result.reply_queued,true);assert.equal(result.duplicate,false);assert.match(result.message,/queued/);
 const record=f.sqlite.prepare('SELECT * FROM support_replies').get(),job=f.sqlite.prepare('SELECT * FROM mail_outbox').get();
 assert.equal(JSON.stringify(record).includes(recipient),false);assert.equal(JSON.stringify(record).includes(reply),false);
 assert.deepEqual(JSON.parse(await decrypt(f.env,record.encrypted_payload)),{body:reply,recipient});
 assert.equal(job.recipient,recipient);assert.match(job.subject,new RegExp(id));assert.equal(job.state,'pending');
 assert.equal(JSON.parse(await decrypt(f.env,job.encrypted_payload)).text,'Radio Locals support reply\n\nReference: '+id+'\n\n'+reply);
 const thread=await(await f.get()).json();assert.equal(thread.ticket.state,'review');assert.equal(thread.messages.length,1);assert.equal(thread.messages[0].body,reply);assert.equal(thread.messages[0].delivery.state,'pending');assert.equal(thread.history[0].notes,'Support reply queued.');
 const sent=[];f.env.EMAIL={send:async message=>sent.push(message)};await processMail(f.env,f.now);
 assert.equal(sent.length,1);assert.equal(sent[0].to,recipient);
 assert.equal((await(await f.get()).json()).messages[0].delivery.state,'sent');
 // The encrypted correspondence remains available after the outbox clears its body.
 assert.equal((await(await f.get()).json()).messages[0].body,reply);
});

test('idempotent retries never resend or reapply an older state and reject changed content',async()=>{
 const f=await fixture();f.admin();await f.post({reply:'First reply'});
 await f.post({request_id:'request_0000000002',state:'closed'});
 const duplicate=await(await f.post({reply:'First reply'})).json();assert.equal(duplicate.duplicate,true);assert.equal(duplicate.state,'closed');
 assert.equal(f.sqlite.prepare('SELECT count(*) n FROM mail_outbox').get().n,1);assert.equal(f.sqlite.prepare('SELECT count(*) n FROM legal_actions').get().n,2);
 await assert.rejects(f.post({reply:'Different reply'}),e=>e.status===409);
 await assert.rejects(f.post({reply:'First reply',state:'new'}),e=>e.status===409);
 // Simulate two attempts both missing the initial lookup. The transaction must
 // also guard the losing attempt against creating another email or status change.
 const prepare=f.env.DB.prepare.bind(f.env.DB);let hide=true;
 f.env.DB.prepare=sql=>{const query=prepare(sql);if(sql.startsWith('SELECT id,request_hash,outbox_id')&&hide){hide=false;query.first=async()=>null;}return query;};
 const raced=await(await f.post({reply:'First reply'})).json();assert.equal(raced.duplicate,true);assert.equal(raced.state,'closed');
 assert.equal(f.sqlite.prepare('SELECT count(*) n FROM mail_outbox').get().n,1);assert.equal(f.sqlite.prepare('SELECT count(*) n FROM legal_actions').get().n,2);
});

test('open, in review and closed statuses are recorded without sending an email',async()=>{
 const f=await fixture();f.admin();
 for(const [index,state,stored] of [[1,'open','new'],[2,'in_review','review'],[3,'closed','closed']]){
  const result=await(await f.post({request_id:'status_request_000'+index,state})).json();assert.equal(result.state,stored);assert.equal(result.reply_queued,false);
 }
 assert.equal(f.sqlite.prepare('SELECT count(*) n FROM mail_outbox').get().n,0);
 const result=await(await f.get()).json();assert.equal(result.messages.length,0);assert.equal(result.history.length,3);assert.equal(result.ticket.state,'closed');
});

test('reply length, recipient validation, request references and legal request separation are enforced',async()=>{
 const f=await fixture();f.admin();
 for(const body of [{reply:'x'.repeat(4001)},{reply:123},{state:'deleted'},{request_id:'short'},{ticket_id:[id]}])await assert.rejects(f.post(body),e=>e.status===400);
 await f.post({reply:'é'.repeat(4000)});assert.equal(f.sqlite.prepare('SELECT count(*) n FROM mail_outbox').get().n,1);
 for(const kind of ['privacy','copyright','counter-notice']){const legal=await fixture(kind);legal.admin();await assert.rejects(legal.post({reply:'Never email legal complaints.'}),e=>e.status===404);await assert.rejects(legal.get(),e=>e.status===404);assert.equal(legal.sqlite.prepare('SELECT count(*) n FROM mail_outbox').get().n,0);}
 const legacy=await fixture('support','bad\r\nBcc: injected@example.net');legacy.admin();await assert.rejects(legacy.post({reply:'Hello'}),e=>e.status===400);await legacy.post({state:'closed'});assert.equal(legacy.sqlite.prepare('SELECT count(*) n FROM mail_outbox').get().n,0);
});

test('reply, status and history roll back when any durable write fails',async()=>{
 for(const table of ['support_replies','mail_outbox','legal_actions']){
  const f=await fixture();f.admin();f.sqlite.exec(`CREATE TRIGGER reject_reply BEFORE INSERT ON ${table} BEGIN SELECT RAISE(ABORT,'test failure'); END;`);
  await assert.rejects(f.post({reply:'Must roll back.'}));
  assert.equal(f.sqlite.prepare('SELECT count(*) n FROM support_replies').get().n,0);assert.equal(f.sqlite.prepare('SELECT count(*) n FROM mail_outbox').get().n,0);assert.equal(f.sqlite.prepare('SELECT count(*) n FROM legal_actions').get().n,0);assert.equal(f.sqlite.prepare('SELECT state FROM legal_requests').get().state,'new');
 }
});

test('recipient and administrator limits bound support reply traffic',async()=>{
 const f=await fixture();f.admin();
 for(let i=0;i<10;i++)await f.post({request_id:'recipient_request_'+i,reply:'A bounded reply.'});
 await assert.rejects(f.post({request_id:'recipient_request_10',reply:'One too many.'}),e=>e.status===429);assert.equal(f.sqlite.prepare('SELECT count(*) n FROM mail_outbox').get().n,10);
 // A repeat of an accepted request bypasses the send limits and queues nothing.
 assert.equal((await(await f.post({request_id:'recipient_request_0',reply:'A bounded reply.'})).json()).duplicate,true);
 const admin=await fixture();admin.admin();for(let i=0;i<60;i++)await admin.post({request_id:'admin_status_request_'+i,state:'review'});
 await assert.rejects(admin.post({request_id:'admin_status_request_60',state:'closed'}),e=>e.status===429);assert.equal(admin.sqlite.prepare('SELECT state FROM legal_requests').get().state,'review');
});
