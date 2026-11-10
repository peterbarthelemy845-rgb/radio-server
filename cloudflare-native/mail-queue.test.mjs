import {test} from 'node:test';import assert from 'node:assert/strict';
import {operationsFixture} from './operations-fixture.mjs';import {processMail} from './owner-auth.mjs';import {encrypt,digest} from './security.mjs';
async function setup(){const f=await operationsFixture(),sent=[];f.env.EMAIL={async send(mail){sent.push(mail);}};const payload=await encrypt(f.env,JSON.stringify({text:'Private message'}));
 function insert(id,expires=f.now+86400,due=f.now){f.sqlite.prepare('INSERT INTO mail_outbox(id,recipient,subject,encrypted_payload,due,expires) VALUES (?,?,?,?,?,?)').run(id,'listener@example.com',id,payload,due,expires);}
 return {...f,sent,insert};}
test('a cron invocation drains at most ten ready emails and prioritizes expiring verification over old receipts',async()=>{
 const f=await setup();for(let i=0;i<12;i++)f.insert('receipt-'+i,f.now+86400,f.now-300);f.insert('verification-code',f.now+900);await processMail(f.env,f.now);
 assert.equal(f.sent.length,10);assert.equal(f.sent[0].subject,'verification-code');assert.equal(f.sqlite.prepare("SELECT count(*) n FROM mail_outbox WHERE state='pending'").get().n,3);assert.equal(f.sqlite.prepare("SELECT count(*) n FROM mail_outbox WHERE state='sent' AND encrypted_payload=''").get().n,10);
 await processMail(f.env,f.now);assert.equal(f.sent.length,13);
});
test('parallel mail drainers preserve the persisted send budget and resume without burning deferred retries',async()=>{
 const f=await setup();for(let i=0;i<12;i++)f.insert('job-'+i);f.sqlite.prepare('INSERT INTO rate_limits VALUES (?,?,?)').run('mail-send-global:'+await digest('all'),58,f.now+60);
 await Promise.all([processMail(f.env,f.now),processMail(f.env,f.now)]);assert.equal(f.sent.length,2);assert.equal(f.sqlite.prepare("SELECT count(*) n FROM mail_outbox WHERE state='pending' AND attempts=0 AND lease=0").get().n,10);
 await processMail(f.env,f.now+60);assert.equal(f.sent.length,12);assert.equal(new Set(f.sent.map(mail=>mail.subject)).size,12);
});
test('outage recovery skips expired codes, respects active leases and does not retry failed sends within the same batch',async()=>{
 const f=await setup();f.insert('expired',f.now);f.insert('leased');f.sqlite.prepare("UPDATE mail_outbox SET state='sending',lease=? WHERE id='leased'").run(f.now+30);f.insert('provider-fails');f.env.EMAIL.send=async mail=>{f.sent.push(mail);throw Error('private provider detail');};await processMail(f.env,f.now);
 assert.deepEqual(f.sent.map(mail=>mail.subject),['provider-fails']);const row=f.sqlite.prepare("SELECT * FROM mail_outbox WHERE id='provider-fails'").get();assert.equal(row.attempts,1);assert.equal(row.state,'pending');assert.equal(row.lease,0);assert.equal(row.due,f.now+15);assert.doesNotMatch(JSON.stringify(row),/private provider detail/);
});

test('a slow send stops the batch before another job is claimed, without cancelling the in-flight delivery',async()=>{
 const f=await setup();f.insert('job-one');f.insert('job-two');const original=Date.now;let clock=0;Date.now=()=>clock;f.env.EMAIL.send=async mail=>{f.sent.push(mail);clock=9000;};
 try{await processMail(f.env,f.now);}finally{Date.now=original;}
 assert.equal(f.sent.length,1);assert.equal(f.sqlite.prepare("SELECT count(*) n FROM mail_outbox WHERE state='sent'").get().n,1);const pending=f.sqlite.prepare("SELECT attempts,lease FROM mail_outbox WHERE state='pending'").get();assert.equal(pending.attempts,0);assert.equal(pending.lease,0);
});
