import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {operationsFixture} from './operations-fixture.mjs';
import {checkScheduledStreams,createOperationsSummary,operationsMetrics,scheduledAI,aiOperationsRoutes} from './ai-operations.mjs';
import {probePublicStream} from './stream-check.mjs';
import {digest} from './security.mjs';

const good={audio_response:true,reason:'audio_response'},bad={audio_response:false,reason:'connection_failed'};
const reportData={summary:'The measured totals are ready.',attention:[],next_steps:['Review open support tickets.']};
const healthData={summary:'The public audio check could not be confirmed.',next_steps:['Ask the owner to confirm their broadcaster is running.']};
const monthAt=now=>new Date(now*1000).toISOString().slice(0,7);
async function fixture(){const f=await operationsFixture();Object.assign(f.env,{AI_ASSISTANTS_ENABLED:'true',OPENAI_API_KEY:'test-only-not-a-real-key',STREAM_CHECK_PUBLIC_FETCH:'true',PUBLIC_ORIGIN:'https://radiolocals.com'});return f;}
function station(f,status='published',name='Extra station'){return f.sqlite.prepare('INSERT INTO stations(name,stream_url,contact_email,status,created_at,updated_at) VALUES (?,?,?,?,?,?) RETURNING code').get(name,'https://stream.example.com/'+Math.random(),'private-owner@example.com',status,f.now,f.now).code;}
function deferred(){let resolve;const promise=new Promise(r=>{resolve=r;});return {promise,resolve};}
function runner(calls,data=healthData){return async(_env,request)=>{calls.push(request);return {data,generated_at:request.now,cache_hit:false};};}

test('the shared public probe rejects unsafe destinations without requests or proof writes',async()=>{
 const f=await fixture();let calls=0;
 for(const value of ['http://127.0.0.1/live','http://169.254.169.254/live','https://owner:secret@stream.example.com/live','https://radiolocals.com/api/session']){
  assert.equal((await probePublicStream(f.env,value,{fetch:async()=>{calls++;}})).audio_response,false);
 }
 assert.equal(calls,0);assert.equal(f.sqlite.prepare('SELECT count(*) n FROM stream_check_results').get().n,0);
 const result=await probePublicStream(f.env,'https://stream.example.com/live',{fetch:async()=>{calls++;return new Response(null,{status:302,headers:{Location:'http://10.0.0.1/secret'}});}});
 assert.equal(result.audio_response,false);assert.equal(calls,1);assert.equal(f.sqlite.prepare('SELECT count(*) n FROM station_stream_checks').get().n,0);
});

test('hourly probes rotate in bounded batches over published stations only',async()=>{
 const f=await fixture(),seen=[];for(let i=0;i<6;i++)station(f);station(f,'pending_review');station(f,'suspended');
 const deps={probe:async(_env,url)=>{seen.push(url);return good;}};
 assert.deepEqual(await checkScheduledStreams(f.env,f.now,deps),{checked:3,explained:0});
 assert.deepEqual(await checkScheduledStreams(f.env,f.now+60,deps),{checked:3,explained:0});
 assert.deepEqual(await checkScheduledStreams(f.env,f.now+120,deps),{checked:1,explained:0});
 assert.deepEqual(await checkScheduledStreams(f.env,f.now+180,deps),{checked:0,explained:0});
 assert.equal(new Set(seen).size,7);assert.equal(f.sqlite.prepare('SELECT count(*) n FROM ai_stream_health').get().n,7);
 assert.equal(f.sqlite.prepare("SELECT count(*) n FROM stations WHERE status='published'").get().n,7);
 assert.equal(f.sqlite.prepare('SELECT count(*) n FROM station_stream_checks').get().n,0);
});

test('one persistent lease prevents overlapping cron stream probes',async()=>{
 const f=await fixture(),started=deferred(),finish=deferred();let calls=0;
 const first=checkScheduledStreams(f.env,f.now,{probe:async()=>{calls++;started.resolve();await finish.promise;return good;}});await started.promise;
 assert.deepEqual(await checkScheduledStreams(f.env,f.now,{probe:async()=>{calls++;return good;}}),{checked:0,explained:0});
 finish.resolve();await first;assert.equal(calls,1);
 assert.equal(f.sqlite.prepare("SELECT lease_until FROM ai_operation_leases WHERE job_key='stream-health'").get().lease_until,0);
});

test('failed probes receive one explanation per changed incident, with no publication side effects',async()=>{
 const f=await fixture(),calls=[],deps={probe:async()=>bad,runAI:runner(calls)};
 await checkScheduledStreams(f.env,f.now,deps);await checkScheduledStreams(f.env,f.now+3601,deps);assert.equal(calls.length,1);
 assert.equal(f.sqlite.prepare('SELECT consecutive_failures FROM ai_stream_health').get().consecutive_failures,2);
 await checkScheduledStreams(f.env,f.now+7202,{probe:async()=>good,runAI:runner(calls)});
 await checkScheduledStreams(f.env,f.now+10803,deps);assert.equal(calls.length,2);
 assert.equal(f.sqlite.prepare('SELECT status FROM stations WHERE code=?').get(f.station).status,'published');
 assert.equal(f.sqlite.prepare('SELECT count(*) n FROM mail_outbox').get().n,0);
 assert.equal(f.sqlite.prepare('SELECT count(*) n FROM radio_commands').get().n,0);
 assert.doesNotMatch(JSON.stringify(calls),/contact_email|owner@example|secret_hash|radio-one|https:\/\/example/);
 assert.match(calls[0].instructions,/does not prove a station is offline/);
});

test('at most two changed failures use AI in one invocation; pending explanations continue next run',async()=>{
 const f=await fixture(),calls=[];station(f);station(f);
 assert.deepEqual(await checkScheduledStreams(f.env,f.now,{probe:async()=>bad,runAI:runner(calls)}),{checked:3,explained:2});
 assert.deepEqual(await checkScheduledStreams(f.env,f.now+60,{probe:async()=>bad,runAI:runner(calls)}),{checked:0,explained:1});
 assert.equal(calls.length,3);assert.equal(f.sqlite.prepare("SELECT count(*) n FROM ai_stream_health WHERE explanation_state='pending'").get().n,0);
});

test('a changed or unpublished station cannot receive a stale health result or explanation',async()=>{
 for(const change of ["UPDATE stations SET status='suspended'","UPDATE stations SET stream_url='https://new.example.com/live'"]){
  const f=await fixture();await checkScheduledStreams(f.env,f.now,{probe:async()=>{f.sqlite.exec(change);return bad;},runAI:async()=>{throw new Error('Must not call AI');}});
  assert.equal(f.sqlite.prepare('SELECT count(*) n FROM ai_stream_health').get().n,0);
 }
 const f=await fixture();await checkScheduledStreams(f.env,f.now,{probe:async()=>bad,runAI:async()=>{f.sqlite.exec("UPDATE stations SET stream_url='https://new.example.com/live'");return {data:healthData};}});
 assert.equal(f.sqlite.prepare('SELECT explanation FROM ai_stream_health').get().explanation,'');
 f.admin();const state=await(await aiOperationsRoutes(f.request('/api/admin/ai/operations'),f.env,f.now)).json();assert.equal(state.health.length,0);
});

test('unavailable AI does not repeat requests for the same failure or hide measured checks',async()=>{
 const f=await fixture();let calls=0;const deps={probe:async()=>bad,runAI:async()=>{calls++;throw new Error('Budget unavailable');}};
 await checkScheduledStreams(f.env,f.now,deps);await checkScheduledStreams(f.env,f.now+3601,deps);assert.equal(calls,1);
 const row=f.sqlite.prepare('SELECT result,explanation_state FROM ai_stream_health').get();assert.deepEqual({...row},{result:'not_confirmed',explanation_state:'unavailable'});
});

test('reports expose aggregate metrics, distinct radios and public top-station names only',async()=>{
 const f=await fixture(),month=monthAt(f.now),day=new Date(f.now*1000).toISOString().slice(0,10),second=station(f);
 f.sqlite.prepare('INSERT INTO monthly_activity(month,station_code,radio_id,first_seen,last_seen) VALUES (?,?,?,?,?)').run(month,f.station,'radio-one',f.now-60,f.now);
 f.sqlite.prepare('INSERT INTO monthly_activity(month,station_code,radio_id,first_seen,last_seen) VALUES (?,?,?,?,?)').run(month,second,'radio-one',f.now-60,f.now);
 f.sqlite.prepare('INSERT INTO listening_daily(day,station_code,reported_seconds) VALUES (?,?,?)').run(day,f.station,1800);
 f.sqlite.prepare("INSERT INTO share_events(id,station_code,channel,created_at) VALUES ('share-id',?,'whatsapp',?)").run(f.station,f.now);
 f.sqlite.prepare("INSERT INTO legal_requests(id,kind,state,created_at,encrypted_payload) VALUES ('support-one','support','new',?,'private secret ticket')").run(f.now);
 const metrics=await operationsMetrics(f.env,month,f.now);assert.equal(metrics.distinct_active_radios,1);assert.equal(metrics.reported_listening_seconds,1800);assert.equal(metrics.share_button_clicks,1);assert.equal(metrics.open_support_tickets,1);
 const calls=[];const report=await createOperationsSummary(f.env,month,f.now,{runAI:runner(calls,reportData)});assert.equal(report.state,'ready');assert.equal(calls.length,1);
 assert.doesNotMatch(JSON.stringify(calls),/radio-one|owner@example|private-owner|private secret ticket|encrypted_payload|stream_url|secret_hash/);
 assert.equal(f.sqlite.prepare('SELECT count(*) n FROM mail_outbox').get().n,0);
});

test('zero-data summaries use no model and overlapping report generation is leased',async()=>{
 const f=await fixture();let calls=0;const report=await createOperationsSummary(f.env,monthAt(f.now),f.now,{runAI:async()=>{calls++;throw new Error('Should not run');}});
 assert.equal(report.summary.source,'basic');assert.equal(calls,0);
 f.sqlite.prepare("INSERT INTO legal_requests(id,kind,state,created_at,encrypted_payload) VALUES ('support-one','support','new',?,'ignored')").run(f.now);
 const started=deferred(),finish=deferred(),first=createOperationsSummary(f.env,monthAt(f.now),f.now,{runAI:async()=>{calls++;started.resolve();await finish.promise;return {data:reportData};}});await started.promise;
 assert.equal((await createOperationsSummary(f.env,monthAt(f.now),f.now,{runAI:async()=>{calls++;}})).state,'busy');finish.resolve();await first;assert.equal(calls,1);
});

test('admin operations require MFA session and same-origin CSRF for report generation',async()=>{
 const f=await fixture();await assert.rejects(aiOperationsRoutes(f.request('/api/admin/ai/operations'),f.env,f.now),e=>e.status===401);
 f.owner();await assert.rejects(aiOperationsRoutes(f.request('/api/admin/ai/operations'),f.env,f.now),e=>e.status===401);f.admin();
 const foreign=f.request('/api/admin/ai/report',{});foreign.headers.set('Origin','https://attacker.example');await assert.rejects(aiOperationsRoutes(foreign,f.env,f.now),e=>e.status===403);
 const noCsrf=f.request('/api/admin/ai/report',{});noCsrf.headers.delete('X-CSRF-Token');await assert.rejects(aiOperationsRoutes(noCsrf,f.env,f.now),e=>e.status===403);
 await assert.rejects(aiOperationsRoutes(f.request('/api/admin/ai/report',{month:'2026-13'}),f.env,f.now),e=>e.status===400);
 assert.equal((await(await aiOperationsRoutes(f.request('/api/admin/ai/operations'),f.env,f.now)).json()).health.length,0);
});

test('health details mark old checks stale and never return upstream addresses or hashes',async()=>{
 const f=await fixture();f.admin();f.sqlite.prepare(`INSERT INTO ai_stream_health(station_code,stream_hash,result,reason,checked_at,next_check_at,last_change_at) VALUES (?,?,'audio_response','audio_response',?,?,?)`).run(f.station,await digest('https://example.com/live'),f.now-7201,f.now-3601,f.now-7201);
 const response=await(await aiOperationsRoutes(f.request('/api/admin/ai/operations'),f.env,f.now)).json();assert.equal(response.health[0].stale,true);assert.doesNotMatch(JSON.stringify(response),/example\.com|stream_hash|contact_email/);
});

test('daily scheduled summaries run once, respect disabled state and bound failed retries',async()=>{
 const f=await fixture();f.env.AI_ASSISTANTS_ENABLED='false';await scheduledAI(f.env,f.now,{probe:async()=>{throw new Error('Disabled');}});assert.equal(f.sqlite.prepare('SELECT count(*) n FROM ai_report_summaries').get().n,0);
 f.env.AI_ASSISTANTS_ENABLED='true';let calls=0;f.sqlite.prepare("INSERT INTO legal_requests(id,kind,state,created_at,encrypted_payload) VALUES ('support-one','support','new',?,'ignored')").run(f.now);
 const deps={probe:async()=>good,runAI:async()=>{calls++;throw new Error('Budget stopped');}};
 await scheduledAI(f.env,f.now,deps);await scheduledAI(f.env,f.now+60,deps);assert.equal(calls,1);await scheduledAI(f.env,f.now+3601,deps);assert.equal(calls,2);
 assert.equal(f.sqlite.prepare('SELECT state FROM ai_report_summaries ORDER BY generated_at DESC LIMIT 1').get().state,'unavailable');
});

test('admin operations UI uses text nodes, loads measured data on demand and needs explicit report action',()=>{
 const source=readFileSync(new URL('./public/assets/ai-operations.js',import.meta.url),'utf8');
 assert.match(source,/node\.textContent=text/);assert.doesNotMatch(source,/innerHTML|eval\(|setInterval|localStorage|sessionStorage/);
 assert.match(source,/summarize\.onclick=async/);assert.match(source,/api\('\/api\/admin\/ai\/report',\{month:month\.value\}\)/);
 assert.match(source,/if\(active\(generation\)\)/);assert.match(source,/result\.replaceChildren\(\)/);assert.match(source,/row\.stale\?'Check is stale'/);
});

test('operations panel loads on demand, cancels stale rendering on logout and never sends a report twice',async()=>{
 const nodes=new Map(),observers=[];
 class Element{
  constructor(tag){this.tag=tag;this.children=[];this.hidden=false;this.open=false;this.handlers=new Map();this.textContent='';this.disabled=false;}
  set id(value){this._id=value;nodes.set(value,this);}get id(){return this._id;}
  append(...items){this.children.push(...items);}replaceChildren(...items){this.children=[...items];}
  setAttribute(){}focus(){}addEventListener(name,callback){this.handlers.set(name,callback);}
 }
 const admin=new Element('section');admin.id='admin';const grant=new Element('div');grant.id='adminStations';grant.hidden=true;
 const calls=[],requests=[];
 const context={document:{getElementById:id=>nodes.get(id),createElement:tag=>new Element(tag)},window:{},MutationObserver:class{constructor(callback){this.callback=callback;observers.push(this);}observe(){}},api:async(path,body)=>{calls.push({path,body});const pending=deferred();requests.push(pending);return pending.promise;},Date,Number,String,Object,Array};
 vm.runInNewContext(readFileSync(new URL('./public/assets/ai-operations.js',import.meta.url),'utf8'),context);
 const panel=nodes.get('aiOperationsPanel'),body=panel.children[1],controls=body.children[1],status=body.children[2],result=body.children[3],month=controls.children[0].children[0],summarize=controls.children[1],refresh=controls.children[2],toggle=()=>panel.handlers.get('toggle')();
 assert.equal(calls.length,0);assert.equal(panel.hidden,true);
 grant.hidden=false;observers[0].callback();panel.open=true;toggle();await new Promise(resolve=>setTimeout(resolve,0));assert.equal(calls[0].path,'/api/admin/ai/operations');
 grant.hidden=true;observers[0].callback();requests.shift().resolve({enabled:true,health:[],report:{summary:{summary:'private stale result'}}});await new Promise(resolve=>setTimeout(resolve,0));assert.equal(result.children.length,0);assert.equal(status.textContent,'');
 grant.hidden=false;observers[0].callback();panel.open=true;toggle();await new Promise(resolve=>setTimeout(resolve,0));requests.shift().resolve({enabled:true,stream_monitor_enabled:true,health:[],report:null});await new Promise(resolve=>setTimeout(resolve,0));assert.equal(calls.length,2);assert.equal(result.children.length,2);
 month.value='2026-11';const first=summarize.onclick();await new Promise(resolve=>setTimeout(resolve,0));assert.equal(calls.length,3);assert.equal(calls[2].path,'/api/admin/ai/report');assert.equal(month.disabled,true);
 await summarize.onclick();refresh.onclick();assert.equal(calls.length,3);
 panel.open=false;toggle();grant.hidden=true;observers[0].callback();requests.shift().resolve({state:'ready',summary:{summary:'stale private report'},metrics:{}});await first;assert.equal(result.children.length,0);assert.equal(status.textContent,'');assert.equal(summarize.disabled,false);
});
