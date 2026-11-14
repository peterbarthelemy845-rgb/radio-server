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
test('Spam folder lists only support tickets and binds pagination to the selected folder',async()=>{
 const f=await fixture();f.admin();const encrypted=f.sqlite.prepare('SELECT encrypted_payload FROM legal_requests WHERE id=?').get(id).encrypted_payload;
 for(let i=1;i<=205;i++)f.sqlite.prepare('INSERT INTO legal_requests(id,kind,encrypted_payload,created_at) VALUES (?,?,?,?)').run(i.toString(16).padStart(32,'0'),'support',encrypted,f.now-i);
 const spamId=(204).toString(16).padStart(32,'0');f.sqlite.prepare('INSERT INTO support_ticket_flags(ticket_id,folder,reason,updated_at) VALUES (?,?,?,?)').run(spamId,'spam','many_links',f.now);
 f.sqlite.prepare('INSERT INTO legal_requests(id,kind,encrypted_payload,created_at) VALUES (?,?,?,?)').run('c'.repeat(32),'copyright',encrypted,f.now);
 const list=async query=>(await supportRoutes(f.request('/api/admin/support/list?'+query),f.env,f.now)).json();
 const first=await list('folder=inbox');assert.equal(first.requests.length,200);assert.equal(first.has_more,true);assert.ok(first.next_cursor.startsWith('inbox:'));assert.equal(first.requests.some(row=>row.id===spamId),false);assert.equal(first.requests.some(row=>row.kind!=='support'),false);
 const next=await list('folder=inbox&cursor='+encodeURIComponent(first.next_cursor));assert.equal(next.requests.length,5);assert.equal(next.has_more,false);assert.equal(new Set([...first.requests,...next.requests].map(row=>row.id)).size,205);
 const spam=await list('folder=spam');assert.equal(spam.requests.length,1);assert.equal(spam.requests[0].id,spamId);assert.equal(spam.requests[0].spam_reason,'many_links');assert.equal(JSON.stringify(spam).includes('encrypted_payload'),false);
 await assert.rejects(list('folder=spam&cursor='+encodeURIComponent(first.next_cursor)),e=>e.status===400);await assert.rejects(list('folder=deleted'),e=>e.status===400);
});
test('folder changes require current MFA, CSRF and a support ticket; they never email or delete',async()=>{
 const f=await fixture(),change=body=>supportRoutes(f.request('/api/admin/support/folder',{ticket_id:id,folder:'spam',request_id:'folder_request_0001',...body}),f.env,f.now);
 await assert.rejects(change({}),e=>e.status===401);f.admin();
 const request=f.request('/api/admin/support/folder',{ticket_id:id,folder:'spam',request_id:'folder_request_0001'});request.headers.set('X-CSRF-Token','0'.repeat(64));await assert.rejects(supportRoutes(request,f.env,f.now),e=>e.status===403);
 for(const body of [{folder:'delete'},{request_id:'short'},{ticket_id:'invalid'}])await assert.rejects(change(body),e=>e.status===400);
 const moved=await(await change({})).json();assert.equal(moved.folder,'spam');assert.equal((await(await f.get()).json()).ticket.folder,'spam');assert.equal(f.sqlite.prepare('SELECT count(*) n FROM legal_requests').get().n,1);assert.equal(f.sqlite.prepare('SELECT count(*) n FROM mail_outbox').get().n,0);assert.equal(f.sqlite.prepare('SELECT action FROM legal_actions').get().action,'support_spam');
 const legal=await fixture('copyright');legal.admin();await assert.rejects(supportRoutes(legal.request('/api/admin/support/folder',{ticket_id:id,folder:'spam',request_id:'folder_request_0001'}),legal.env,legal.now),e=>e.status===404);
});
test('restore is idempotent and old folder retries cannot reapply an obsolete Spam decision',async()=>{
 const f=await fixture();f.admin();const change=(folder,requestId)=>supportRoutes(f.request('/api/admin/support/folder',{ticket_id:id,folder,request_id:requestId}),f.env,f.now);
 await change('spam','folder_request_0001');await change('inbox','folder_request_0002');const duplicate=await(await change('spam','folder_request_0001')).json();assert.equal(duplicate.duplicate,true);assert.equal(duplicate.folder,'inbox');assert.equal(f.sqlite.prepare('SELECT folder FROM support_ticket_flags WHERE ticket_id=?').get(id).folder,'inbox');assert.equal(f.sqlite.prepare('SELECT count(*) n FROM legal_actions').get().n,2);
 await assert.rejects(change('inbox','folder_request_0001'),e=>e.status===409);
 const prepare=f.env.DB.prepare.bind(f.env.DB);let hide=true;f.env.DB.prepare=sql=>{const q=prepare(sql);if(sql.startsWith('SELECT id,request_hash FROM support_folder_actions')&&hide){hide=false;q.first=async()=>null;}return q;};
 const raced=await(await change('spam','folder_request_0001')).json();assert.equal(raced.duplicate,true);assert.equal(raced.folder,'inbox');assert.equal(f.sqlite.prepare('SELECT count(*) n FROM support_folder_actions').get().n,2);assert.equal(f.sqlite.prepare('SELECT count(*) n FROM mail_outbox').get().n,0);
});
test('Spam must be restored before sending a new reply, including a race during the reply transaction',async()=>{
 const f=await fixture();f.admin();f.sqlite.prepare('INSERT INTO support_ticket_flags(ticket_id,folder,reason,updated_at) VALUES (?,?,?,?)').run(id,'spam','manual',f.now);await assert.rejects(f.post({reply:'Do not send yet.'}),e=>e.status===409);assert.equal(f.sqlite.prepare('SELECT count(*) n FROM mail_outbox').get().n,0);
 await supportRoutes(f.request('/api/admin/support/folder',{ticket_id:id,folder:'inbox',request_id:'folder_restore_0001'}),f.env,f.now);await f.post({reply:'Restored reply.'});assert.equal(f.sqlite.prepare('SELECT count(*) n FROM mail_outbox').get().n,1);
 f.sqlite.prepare("UPDATE support_ticket_flags SET folder='spam' WHERE ticket_id=?").run(id);assert.equal((await(await f.post({reply:'Restored reply.'})).json()).duplicate,true);
 const race=await fixture();race.admin();const batch=race.env.DB.batch;race.env.DB.batch=async queries=>{race.sqlite.prepare('INSERT INTO support_ticket_flags(ticket_id,folder,reason,updated_at) VALUES (?,?,?,?)').run(id,'spam','manual',race.now);return batch(queries);};await assert.rejects(race.post({reply:'Concurrent reply.'}),e=>e.status===409);assert.equal(race.sqlite.prepare('SELECT count(*) n FROM mail_outbox').get().n,0);assert.equal(race.sqlite.prepare('SELECT count(*) n FROM support_replies').get().n,0);
});
test('folder action, Spam flag and audit history roll back together on storage failure',async()=>{
 for(const table of ['support_folder_actions','support_ticket_flags','legal_actions']){const f=await fixture();f.admin();f.sqlite.exec(`CREATE TRIGGER reject_folder BEFORE INSERT ON ${table} BEGIN SELECT RAISE(ABORT,'test failure'); END;`);await assert.rejects(supportRoutes(f.request('/api/admin/support/folder',{ticket_id:id,folder:'spam',request_id:'folder_request_0001'}),f.env,f.now));assert.equal(f.sqlite.prepare('SELECT count(*) n FROM support_folder_actions').get().n,0);assert.equal(f.sqlite.prepare('SELECT count(*) n FROM support_ticket_flags').get().n,0);assert.equal(f.sqlite.prepare('SELECT count(*) n FROM legal_actions').get().n,0);assert.equal(f.sqlite.prepare('SELECT count(*) n FROM mail_outbox').get().n,0);}
});
