import {test} from 'node:test';import assert from 'node:assert/strict';
import {operationsFixture} from './operations-fixture.mjs';import {adsRoutes} from './local-ads.mjs';import {authRoutes} from './owner-auth.mjs';import {digest} from './security.mjs';
const draft={request_id:'a'.repeat(32),station_code:'10',business:'Community shop',message:'Fresh bread',phone:'555-0100',email:'shop@example.com',rights_confirmed:true,artwork:{name:'sponsor.png',base64:'test image'}};
function deferred(){let resolve;const promise=new Promise(yes=>{resolve=yes;});return {promise,resolve};}
async function setup(){const f=await operationsFixture(),calls={art:0,scan:0,human:0};let serial=Promise.resolve();const batch=f.env.DB.batch.bind(f.env.DB);f.env.DB.batch=queries=>{const task=serial.then(()=>batch(queries));serial=task.catch(()=>{});return task;};
 f.env.IMAGES={input(){return {transform(){return {async output(){return {response:()=>new Response(new Uint8Array(12))};}};}};}};
 const deps={human:async()=>{calls.human++;},artwork:async(env,file,key)=>{calls.art++;await env.MEDIA.put('sanitized/'+key,new Uint8Array(12),{customMetadata:{sanitizer_version:'1'},httpMetadata:{contentType:'image/png'}});return key;},scanCreative:async()=>{calls.scan++;return true;},adPixels:async()=>new Uint8Array(38912)};
 const send=(body=draft,at=f.now,request=f.request)=>adsRoutes(request('/api/ads/submit',body),f.env,at,deps);
 function seed(id,station=f.station,end=f.now+10000,status='pending_review'){const key=id.toString(16).padStart(32,'0');f.sqlite.prepare('INSERT INTO local_ads(id,station_code,business,contact_email,message,status,created_at) VALUES (?,?,?,?,?,?,?)').run(key,station,'Existing shop','existing@example.com','Hello',status,f.now-200);f.sqlite.prepare('INSERT INTO ad_policy VALUES (?,?,?,?,?,?,?,?,?)').run(key,'',1,0,'pixels',f.now-100,end,'version','hash');return key;}
 return {...f,calls,deps,send,seed};}
test('lost advertisement response retries one ad, image pair, scan and quota reservation',async()=>{
 const f=await setup(),first=await(await f.send()).json();for(let i=0;i<3;i++)assert.deepEqual(await(await f.send({...draft,business:' Community shop ',email:' SHOP@EXAMPLE.COM ',turnstile_token:'fresh token'},f.now+i+1)).json(),first);
 assert.equal(f.sqlite.prepare('SELECT count(*) n FROM local_ads').get().n,1);assert.equal(f.sqlite.prepare('SELECT count(*) n FROM ad_policy').get().n,1);assert.equal(f.objects.size,2);assert.equal(f.calls.art,1);assert.equal(f.calls.scan,1);assert.equal(f.calls.human,4);
 assert.equal(f.sqlite.prepare('SELECT count FROM rate_limits WHERE key=?').get('ad-submit-authorized:'+await digest('all')).count,1);assert.equal(f.sqlite.prepare('SELECT count FROM rate_limits WHERE key=?').get('ad-submit-ip:'+await digest('unknown')).count,1);
});
test('concurrent advertisement retries cannot repeat artwork or moderation while the first lease runs',async()=>{
 const f=await setup(),waiting=deferred(),arrived=deferred(),art=f.deps.artwork;f.deps.artwork=async(...args)=>{arrived.resolve();await waiting.promise;return art(...args);};const first=f.send();await arrived.promise;await assert.rejects(f.send(),e=>e.status===409&&/processing/.test(e.message));waiting.resolve();await first;assert.equal(f.calls.art,1);assert.equal(f.calls.scan,1);assert.equal(f.sqlite.prepare('SELECT count(*) n FROM local_ads').get().n,1);
});
test('changed advertisement drafts cannot reuse an ID and identical IDs remain isolated to another browser',async()=>{
 const f=await setup(),first=await(await f.send()).json();for(const change of [{message:'Changed message'},{artwork:{name:'other.png',base64:'changed'}},{start_date:'2027-01-01'},{email:'different@example.com'}])await assert.rejects(f.send({...draft,...change}),e=>e.status===409);
 const response=await authRoutes(new Request('https://radiolocals.com/api/session'),f.env,f.now),state=await response.json(),cookie=response.headers.get('set-cookie').split(';')[0],request=(path,body)=>new Request('https://radiolocals.com'+path,{method:'POST',headers:{Cookie:cookie,Origin:'https://radiolocals.com','Content-Type':'application/json','X-CSRF-Token':state.csrf},body:JSON.stringify(body)});
 const other=await(await f.send(draft,f.now,request)).json();assert.notEqual(first.reference,other.reference);assert.equal(f.calls.art,2);assert.equal(f.objects.size,4);
});
test('legacy open advertisement forms also retry without creating duplicates; malformed IDs fail',async()=>{
 const f=await setup(),legacy={...draft};delete legacy.request_id;const first=await(await f.send(legacy)).json();assert.deepEqual(await(await f.send(legacy,f.now+1)).json(),first);assert.equal(f.calls.art,1);
 for(const request_id of ['',null,{},'A'.repeat(32),'a'.repeat(31)])await assert.rejects(f.send({...draft,request_id}),e=>e.status===400);assert.equal(f.sqlite.prepare('SELECT count(*) n FROM local_ads').get().n,1);
});
test('ad policy failure rolls back the ad and retry reuses the same private keys and allowance',async()=>{
 const f=await setup();f.sqlite.exec("CREATE TRIGGER reject_policy BEFORE INSERT ON ad_policy BEGIN SELECT RAISE(ABORT,'simulated write failure'); END;");await assert.rejects(f.send(),/simulated write failure/);assert.equal(f.sqlite.prepare('SELECT count(*) n FROM local_ads').get().n,0);assert.equal(f.sqlite.prepare('SELECT state FROM ad_requests').get().state,'pending');assert.equal(f.objects.size,2);f.sqlite.exec('DROP TRIGGER reject_policy');await f.send();assert.equal(f.objects.size,2);assert.equal(f.sqlite.prepare('SELECT count(*) n FROM local_ads').get().n,1);assert.equal(f.sqlite.prepare('SELECT count FROM rate_limits WHERE key=?').get('ad-submit-authorized:'+await digest('all')).count,1);
});
test('expired and deleted campaigns release quota without removing history; current and future campaigns still count',async()=>{
 const f=await setup();for(let i=1;i<=20;i++)f.seed(i,f.station,f.now);await f.send();assert.equal(f.sqlite.prepare('SELECT count(*) n FROM local_ads').get().n,21);assert.equal(f.sqlite.prepare('SELECT count(*) n FROM ad_policy').get().n,21);
 const g=await setup();for(let i=1;i<=20;i++)g.seed(i,g.station,g.now+86400);await assert.rejects(g.send(),e=>e.status===409);assert.equal(g.calls.art,0);g.sqlite.prepare("UPDATE local_ads SET status='deleted' WHERE id=?").run((1).toString(16).padStart(32,'0'));await g.send();assert.equal(g.sqlite.prepare('SELECT count(*) n FROM local_ads').get().n,21);
});
test('transaction-time quota uses the same expiry rule and prevents oversubscription during processing',async()=>{
 const f=await setup();for(let i=1;i<=19;i++)f.seed(i);f.deps.scanCreative=async()=>{f.seed(20);return true;};await assert.rejects(f.send(),e=>e.status===409);assert.equal(f.sqlite.prepare('SELECT count(*) n FROM local_ads').get().n,20);assert.equal(f.sqlite.prepare('SELECT count(*) n FROM ad_policy').get().n,20);f.sqlite.prepare('UPDATE ad_policy SET end_at=? WHERE ad_id=?').run(f.now,(20).toString(16).padStart(32,'0'));f.deps.scanCreative=async()=>true;await f.send();assert.equal(f.sqlite.prepare('SELECT count(*) n FROM local_ads').get().n,21);assert.equal(f.objects.size,2);
});

test('global campaign quota counts only pending/current or future campaigns across stations',async()=>{
 const f=await setup(),insert=f.sqlite.prepare("INSERT INTO stations(name,stream_url,contact_email,status,created_at,updated_at) VALUES ('Other station','https://example.com/live','other@example.com','published',?,?) RETURNING code");let id=1;for(let station=0;station<10;station++){const other=insert.get(f.now,f.now).code;for(let count=0;count<20;count++)f.seed(id++,other);}
 await assert.rejects(f.send(),e=>e.status===409);assert.equal(f.calls.art,0);f.sqlite.prepare('UPDATE ad_policy SET end_at=? WHERE ad_id=?').run(f.now,(1).toString(16).padStart(32,'0'));await f.send();assert.equal(f.sqlite.prepare('SELECT count(*) n FROM local_ads').get().n,201);assert.equal(f.sqlite.prepare('SELECT count(*) n FROM ad_policy').get().n,201);
});
test('a stale processing lease cannot overwrite or remove the newer completed advertisement',async()=>{
 const f=await setup(),waiting=deferred(),arrived=deferred();let scans=0;f.deps.scanCreative=async()=>{if(++scans===1){arrived.resolve();await waiting.promise;}return true;};const old=f.send();await arrived.promise;const newer=await(await f.send(draft,f.now+121)).json();waiting.resolve();assert.equal((await(await old).json()).reference,newer.reference);assert.equal(f.sqlite.prepare('SELECT count(*) n FROM local_ads').get().n,1);assert.equal(f.objects.size,2);
});

test('repeated failed artwork processing is bounded without charging completed retries',async()=>{
 const f=await setup();let attempts=0;f.deps.artwork=async()=>{attempts++;throw Error('image preparation failed');};for(let i=0;i<15;i++)await assert.rejects(f.send(),/image preparation failed/);await assert.rejects(f.send(),e=>e.status===429);assert.equal(attempts,15);assert.equal(f.sqlite.prepare('SELECT allowance_reserved FROM ad_requests').get().allowance_reserved,1);
 const g=await setup();await g.send();g.sqlite.prepare('INSERT INTO rate_limits VALUES (?,?,?) ON CONFLICT(key) DO UPDATE SET count=excluded.count').run('ad-processing-global:'+await digest('all'),120,g.now+86400);await g.send();assert.equal(g.calls.art,1);await assert.rejects(g.send({...draft,request_id:'b'.repeat(32)}),e=>e.status===429);assert.equal(g.calls.art,1);
});
