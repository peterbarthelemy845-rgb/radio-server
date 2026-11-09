import {test} from 'node:test';import assert from 'node:assert/strict';import {DatabaseSync} from 'node:sqlite';import {readFileSync} from 'node:fs';
import {communityRoutes} from './community.mjs';import {authRoutes,processMail} from './owner-auth.mjs';import {decrypt} from './security.mjs';import {handle} from './worker.mjs';
const now=1800000000,host='https://native.example';
const ticket={name:'Test owner',email:'test@example.com',subject:'Wi-Fi help',message:'Cannot connect',device_code:'1234'};
async function fixture({humanCheck=async()=>{}}={}){const sqlite=new DatabaseSync(':memory:');for(const file of ['0001_core.sql','0005_community.sql','0013_support_ticket_access.sql'])sqlite.exec(readFileSync(new URL('./migrations/'+file,import.meta.url),'utf8'));
 const DB={prepare(sql){let args=[];const q={bind(...v){args=v;return q;},async first(){return sqlite.prepare(sql).get(...args)||null;},async all(){return {results:sqlite.prepare(sql).all(...args)};},async run(){return sqlite.prepare(sql).run(...args);}};return q;},async batch(queries){sqlite.exec('BEGIN');try{for(const q of queries)await q.run();sqlite.exec('COMMIT');}catch(error){sqlite.exec('ROLLBACK');throw error;}}};
 const mail=[],humanCalls=[],env={DB,DATA_ENCRYPTION_KEY:'a'.repeat(64),EMAIL:{async send(message){mail.push(message);return {messageId:'test'};}}};
 async function browser(ip='unknown'){const response=await authRoutes(new Request(host+'/api/session'),env,now);const state=await response.json(),cookie=response.headers.get('set-cookie').split(';')[0];return {post(path,body,at=now,headers={}){return communityRoutes(new Request(host+path,{method:'POST',headers:{Origin:host,Cookie:cookie,'X-CSRF-Token':state.csrf,'Content-Type':'application/json','CF-Connecting-IP':ip,...headers},body:JSON.stringify(body)}),env,at,{human:async(...args)=>{humanCalls.push(args[3]);await humanCheck(...args);}});},get(path,at=now){return communityRoutes(new Request(host+path,{headers:{Cookie:cookie}}),env,at);}};}
 return {env,sqlite,browser,mail,humanCalls};}
test('support tutorials are public without a session or passcode',async()=>{const f=await fixture();f.sqlite.prepare('INSERT INTO help_videos VALUES (1,?,?,?,?,?)').run('wifi','Wi-Fi setup','Help','abcdefghijk',now);const result=await(await communityRoutes(new Request(host+'/api/support'),f.env,now)).json();assert.equal(result.unlocked,true);assert.equal(result.public,true);assert.equal(result.videos.length,1);});
test('retired support passcode routes return 404 without creating or changing historical grants or mailing',async()=>{
 const f=await fixture(),b=await f.browser();
 assert.equal(await b.post('/api/support/unlock',{passcode:'1214'}),null);assert.equal(f.sqlite.prepare('SELECT count(*) n FROM support_grants').get().n,0);
 const token=f.sqlite.prepare('SELECT token_hash FROM sessions').get().token_hash;f.sqlite.prepare('INSERT INTO support_grants VALUES (?,?)').run(token,now+100);
 for(const path of ['/api/support/unlock','/api/support/lock'])for(const method of ['GET','POST']){
  const response=await handle(new Request(host+path,{method,...(method==='POST'?{headers:{'Content-Type':'application/json'},body:JSON.stringify({passcode:'1214'})}:{})}),f.env,now);assert.equal(response.status,404);
 }
 await assert.rejects(b.post('/api/support',{}),error=>error.status===405);
 assert.equal(f.sqlite.prepare('SELECT count(*) n FROM support_grants').get().n,1);assert.equal(f.sqlite.prepare('SELECT expires FROM support_grants').get().expires,now+100);assert.equal(f.sqlite.prepare('SELECT count(*) n FROM mail_outbox').get().n,0);assert.equal(f.humanCalls.length,0);
 await processMail(f.env,now);assert.equal(f.mail.length,0);
});
test('legal requests validate statements and keep private contact details encrypted',async()=>{const f=await fixture(),b=await f.browser();const data={kind:'copyright',name:'Owner',email:'owner@example.com',address:'Address',phone:'Telephone',work:'Work',location:'Station 10',signature:'Owner',good_faith:true,authority:true};await assert.rejects(b.post('/api/legal/request',{...data,authority:false}),e=>e.status===400);const response=await(await b.post('/api/legal/request',data)).json();assert.match(response.reference,/^[a-f0-9]{32}$/);const row=f.sqlite.prepare('SELECT * FROM legal_requests').get();assert.equal(row.encrypted_payload.includes(data.email),false);assert.equal(JSON.parse(await decrypt(f.env,row.encrypted_payload)).email,data.email);});
test('player exposes only the selected public stream and trusted local artwork',async()=>{const f=await fixture();const result=await(await communityRoutes(new Request(host+'/api/player'),f.env,now)).json();assert.equal(result.name,'La Voix Divine');assert.ok(result.stream_url.startsWith('https://'));assert.equal(result.logo_url,'/assets/radiolavoixdivine.png');});


test('support ticket validates fields, checks bot protection and encrypts contact details',async()=>{const f=await fixture(),b=await f.browser();await assert.rejects(b.post('/api/support/ticket',{name:'Test'}),e=>e.status===400);const result=await(await b.post('/api/support/ticket',ticket)).json();assert.match(result.reference,/^[a-f0-9]{32}$/);const row=f.sqlite.prepare('SELECT * FROM legal_requests WHERE id=?').get(result.reference);assert.equal(row.kind,'support');assert.equal(row.encrypted_payload.includes('test@example.com'),false);assert.equal(JSON.parse(await decrypt(f.env,row.encrypted_payload)).message,'Cannot connect');assert.deepEqual(f.humanCalls,['support-ticket','support-ticket']);});

test('station problem tickets use the server station identity without changing the message or email receipt',async()=>{
 const f=await fixture(),b=await f.browser();f.sqlite.prepare('INSERT INTO stations(name,stream_url,contact_email,status,created_at,updated_at) VALUES (?,?,?,?,?,?)').run('Real station','https://example.com/live','owner@example.com','published',now,now);
 const message='Existing draft '+'.'.repeat(2980),result=await(await b.post('/api/support/ticket',{...ticket,message,station_code:'10',station_name:'Forged name'})).json();
 const row=f.sqlite.prepare('SELECT encrypted_payload FROM legal_requests WHERE id=?').get(result.reference),payload=JSON.parse(await decrypt(f.env,row.encrypted_payload));assert.equal(payload.station_code,'10');assert.equal(payload.station_name,'Real station');assert.equal(payload.message,message);assert.equal(row.encrypted_payload.includes('Real station'),false);
 const mail=JSON.parse(await decrypt(f.env,f.sqlite.prepare('SELECT encrypted_payload FROM mail_outbox').get().encrypted_payload));assert.equal(mail.text.includes('Real station'),false);assert.equal(mail.text.includes(message),false);
});

test('invalid or removed station context cannot create a ticket while ordinary support still works',async()=>{
 for(const station_code of ['0010','1','9999999','10,11',10,{},null,'10']){const f=await fixture(),b=await f.browser();await assert.rejects(b.post('/api/support/ticket',{...ticket,station_code}),error=>error.status===400);assert.equal(f.sqlite.prepare('SELECT count(*) n FROM legal_requests').get().n,0);assert.equal(f.sqlite.prepare('SELECT count(*) n FROM mail_outbox').get().n,0);}
 const f=await fixture(),b=await f.browser();const result=await(await b.post('/api/support/ticket',{...ticket,station_code:''})).json();const payload=JSON.parse(await decrypt(f.env,f.sqlite.prepare('SELECT encrypted_payload FROM legal_requests WHERE id=?').get(result.reference).encrypted_payload));assert.equal(payload.station_code,undefined);
});

test('support receipt is queued once with its reference and sends fixed plain text from the verified sender',async()=>{
 const f=await fixture(),b=await f.browser(),data={...ticket,name:'<img src=x onerror=alert(1)>',subject:'Injected\r\nBcc: victim@example.org',message:'Private <script>alert(1)</script> message',device_code:'987654'};
 const result=await(await b.post('/api/support/ticket',data)).json();
 assert.equal(result.receipt_queued,true);assert.match(result.message,/queued/);assert.doesNotMatch(result.message,/email (?:was |has been )?(?:sent|delivered)/i);assert.equal(f.mail.length,0);
 const jobs=f.sqlite.prepare('SELECT * FROM mail_outbox').all();assert.equal(jobs.length,1);const job=jobs[0];
 assert.equal(job.id,'support-receipt:'+result.reference);assert.equal(job.recipient,data.email);assert.equal(job.subject,'Radio Locals support ticket received - '+result.reference);
 assert.equal(job.encrypted_payload.includes(result.reference),false);assert.equal(job.expires,now+86400);
 const payload=JSON.parse(await decrypt(f.env,job.encrypted_payload));assert.deepEqual(Object.keys(payload),['text']);assert.ok(payload.text.includes(result.reference));
 for(const input of [data.name,data.subject,data.message,data.device_code])assert.equal(payload.text.includes(input),false);
 await Promise.all([processMail(f.env,now),processMail(f.env,now)]);await processMail(f.env,now+60);
 assert.equal(f.mail.length,1);assert.deepEqual(f.mail[0],{from:'info@radiolocals.com',to:data.email,subject:job.subject,text:payload.text});
 const sent=f.sqlite.prepare('SELECT * FROM mail_outbox').get();assert.equal(sent.state,'sent');assert.equal(sent.attempts,1);assert.equal(sent.encrypted_payload,'');
});

test('invalid submissions, invalid mailboxes and failed security checks never queue a receipt',async()=>{
 const f=await fixture(),b=await f.browser();
 for(const data of [{...ticket,message:''},{...ticket,email:'a@example.com,b@example.com'},{...ticket,email:'Name <a@example.com>'},{...ticket,email:'a@example.com\r\nBcc:b@example.com'}])await assert.rejects(b.post('/api/support/ticket',data),e=>e.status===400);
 await assert.rejects(b.post('/api/support/ticket',ticket,now,{'X-CSRF-Token':'0'.repeat(64)}),e=>e.status===403);
 assert.equal(f.sqlite.prepare('SELECT count(*) n FROM legal_requests').get().n,0);assert.equal(f.sqlite.prepare('SELECT count(*) n FROM mail_outbox').get().n,0);
 const blocked=await fixture({humanCheck:async()=>{throw new Error('security rejected');}}),other=await blocked.browser();
 await assert.rejects(other.post('/api/support/ticket',ticket),/security rejected/);
 assert.equal(blocked.sqlite.prepare('SELECT count(*) n FROM legal_requests').get().n,0);assert.equal(blocked.sqlite.prepare('SELECT count(*) n FROM mail_outbox').get().n,0);
 assert.equal(f.mail.length+blocked.mail.length,0);
});

test('ticket and receipt roll back together if either insert fails',async()=>{
 for(const table of ['legal_requests','mail_outbox']){
  const f=await fixture(),b=await f.browser();f.sqlite.exec(`CREATE TRIGGER reject_insert BEFORE INSERT ON ${table} BEGIN SELECT RAISE(ABORT,'submission rejected'); END`);
  await assert.rejects(b.post('/api/support/ticket',ticket),/submission rejected/);
  assert.equal(f.sqlite.prepare('SELECT count(*) n FROM legal_requests').get().n,0);assert.equal(f.sqlite.prepare('SELECT count(*) n FROM mail_outbox').get().n,0);
  await processMail(f.env,now);assert.equal(f.mail.length,0);
 }
});

test('receipt recipient limit is shared across browsers, IPs and email case',async()=>{
 const f=await fixture();for(let n=0;n<3;n++){const b=await f.browser('192.0.2.'+n);await b.post('/api/support/ticket',{...ticket,email:n%2?'TEST@EXAMPLE.COM':ticket.email});}
 const b=await f.browser('192.0.2.100');await assert.rejects(b.post('/api/support/ticket',ticket),e=>e.status===429);
 assert.equal(f.sqlite.prepare('SELECT count(*) n FROM legal_requests').get().n,3);assert.equal(f.sqlite.prepare('SELECT count(*) n FROM mail_outbox').get().n,3);
 const result=await(await b.post('/api/support/ticket',ticket,now+3600)).json();assert.equal(result.receipt_queued,true);
});

test('receipt delivery failures have five bounded retries without claiming delivery or exposing provider errors',async()=>{
 const f=await fixture(),b=await f.browser();let calls=0;f.env.EMAIL.send=async()=>{calls++;throw new Error('private provider failure');};
 const result=await(await b.post('/api/support/ticket',ticket)).json();assert.equal(result.receipt_queued,true);assert.match(result.message,/queued/);
 for(let attempt=1;attempt<=5;attempt++){const due=f.sqlite.prepare('SELECT due FROM mail_outbox').get().due;await processMail(f.env,due);const row=f.sqlite.prepare('SELECT * FROM mail_outbox').get();assert.equal(row.attempts,attempt);assert.equal(row.state,attempt===5?'failed':'pending');assert.equal(row.lease,0);assert.equal(JSON.stringify(row).includes('private provider failure'),false);}
 await processMail(f.env,now+3600);assert.equal(calls,5);assert.equal(f.sqlite.prepare('SELECT attempts FROM mail_outbox').get().attempts,5);assert.equal(f.sqlite.prepare('SELECT count(*) n FROM legal_requests').get().n,1);
});
