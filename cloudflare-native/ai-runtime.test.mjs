import {test} from 'node:test';
import assert from 'node:assert/strict';
import {operationsFixture} from './operations-fixture.mjs';
import {runAI,matchesSchema,AI_DAILY_LIMIT,AI_MONTHLY_LIMIT,aiRuntimeRoutes,cleanupAI,providerRequest} from './ai-runtime.mjs';
const schema={type:'object',properties:{answer:{type:'string',maxLength:100}},required:['answer'],additionalProperties:false};
const response=(data={answer:'Approved help'})=>new Response(JSON.stringify({status:'completed',output:[{type:'message',role:'assistant',status:'completed',content:[{type:'output_text',text:JSON.stringify(data)}]}]}));
function setup(){return operationsFixture().then(f=>({...f,env:{...f.env,AI_ASSISTANTS_ENABLED:'true',OPENAI_API_KEY:'test-private-key'}}));}
function options(f,extra={}){return {kind:'test-help',instructions:'Use approved guide.',input:'Question',schema,now:f.now,...extra};}
test('AI request is fixed-model, tool-free, storage-disabled and bounded; cache is private and idempotent',async()=>{
 const f=await setup();let calls=0;
 const fetcher=async(url,request)=>{calls++;assert.equal(url,'https://api.openai.com/v1/responses');assert.equal(request.redirect,'error');const body=JSON.parse(request.body);assert.equal(body.model,'gpt-6-luna');assert.equal(body.store,false);assert.equal(body.reasoning.effort,'none');assert.equal(body.text.format.strict,true);assert.ok(body.max_output_tokens<=1000);assert.equal(body.tools,undefined);return response();};
 assert.equal((await runAI(f.env,options(f,{fetcher,maxOutputTokens:99999}))).data.answer,'Approved help');
 const cached=await runAI(f.env,options(f,{fetcher,maxOutputTokens:99999}));assert.equal(cached.cache_hit,true);assert.equal(calls,1);
 const row=f.sqlite.prepare('SELECT * FROM ai_results').get();assert.ok(!JSON.stringify(row).includes('Approved help'));assert.ok(!JSON.stringify(row).includes('Question'));assert.equal(f.sqlite.prepare('SELECT count(*) n FROM ai_usage').get().n,1);
});
test('changed instructions, schema or input cannot reuse earlier AI output',async()=>{
 const f=await setup();let calls=0;const fetcher=async()=>{calls++;return response();};
 await runAI(f.env,options(f,{fetcher}));await runAI(f.env,options(f,{fetcher,instructions:'Different approved guide.'}));await runAI(f.env,options(f,{fetcher,input:'Changed question'}));assert.equal(calls,3);
});
test('provider deadline covers stalled headers/body and never awaits stalled cancellation',async()=>{
 const never=()=>new Promise(()=>{});
 await assert.rejects(providerRequest('{}','fake',never,15),/provider_timeout/);
 await assert.rejects(providerRequest('{}','fake',async()=>({ok:true,headers:new Headers(),body:{getReader:()=>({read:never,cancel:never})}}),15),/provider_timeout/);
 await assert.rejects(providerRequest('{}','fake',async()=>({ok:false,body:{cancel:never}}),15),/provider_unavailable/);
});
test('a corrupt cached result can be safely regenerated',async()=>{
 const f=await setup();let calls=0;const fetcher=async()=>{calls++;return response();};
 await runAI(f.env,options(f,{fetcher}));f.sqlite.exec("UPDATE ai_results SET encrypted_payload='invalid'");
 const result=await runAI(f.env,options(f,{fetcher}));assert.equal(result.data.answer,'Approved help');assert.equal(result.cache_hit,false);assert.equal(calls,2);
});
test('AI stays unavailable without enabled configuration or key; oversized requests never call provider',async()=>{
 const f=await setup();let calls=0;const fetcher=async()=>{calls++;return response();};
 for(const env of [{...f.env,AI_ASSISTANTS_ENABLED:'false'},{...f.env,OPENAI_API_KEY:''}])await assert.rejects(runAI(env,options(f,{fetcher})),e=>e.status===503);
 await assert.rejects(runAI(f.env,options(f,{fetcher,input:'x'.repeat(24000)})),e=>e.status===413);assert.equal(calls,0);assert.equal(f.sqlite.prepare('SELECT count(*) n FROM ai_usage').get().n,0);
});
test('daily and monthly allowances are reserved before provider execution, including failed calls',async()=>{
 for(const [period,limit] of [['day',AI_DAILY_LIMIT],['month',AI_MONTHLY_LIMIT]]){
  const f=await setup(),day=new Date(f.now*1000).toISOString().slice(0,10),month=day.slice(0,7);
  const insert=f.sqlite.prepare('INSERT INTO ai_usage(id,kind,day,month,reserved_cents,created_at) VALUES (?,?,?,?,1,?)');
  for(let i=0;i<limit;i++)insert.run('used-'+i,'test',period==='day'?day:month+'-01',month,f.now);
  let calls=0;await assert.rejects(runAI(f.env,options(f,{fetcher:async()=>{calls++;return response();}})),e=>e.status===429);assert.equal(calls,0);
 }
 const f=await setup();await assert.rejects(runAI(f.env,options(f,{fetcher:async()=>new Response('private provider detail',{status:401})})),e=>e.status===503&&!e.message.includes('private'));
 assert.equal(f.sqlite.prepare('SELECT state FROM ai_usage').get().state,'failed');
});
test('concurrent identical requests have one upstream owner',async()=>{
 const f=await setup();let resolve,calls=0;const waiting=new Promise(done=>{resolve=done;});const fetcher=async()=>{calls++;await waiting;return response();};
 const first=runAI(f.env,options(f,{fetcher}));
 for(let i=0;i<30&&!calls;i++)await new Promise(done=>setTimeout(done,0));
 await assert.rejects(runAI(f.env,options(f,{fetcher})),e=>e.status===409);resolve();await first;assert.equal(calls,1);
});
test('refusals, incomplete, extra properties, malformed or oversized provider output fail closed',async()=>{
 for(const output of [
  {status:'incomplete',output:[]},
  {status:'completed',output:[{type:'message',role:'assistant',status:'completed',content:[{type:'refusal',refusal:'no'}]}]},
  {status:'completed',output:[{type:'message',role:'assistant',status:'completed',content:[{type:'output_text',text:'{"answer":"x","action":"delete"}'}]}]},
  {status:'completed',output:[{type:'message',role:'assistant',status:'completed',content:[{type:'output_text',text:'not json'}]}]}
 ]){const f=await setup();await assert.rejects(runAI(f.env,options(f,{fetcher:async()=>new Response(JSON.stringify(output))})),e=>e.status===503);assert.equal(f.sqlite.prepare('SELECT state FROM ai_results').get().state,'failed');}
 const f=await setup();await assert.rejects(runAI(f.env,options(f,{fetcher:async()=>new Response('x'.repeat(65537))})),e=>e.status===503);
});
test('local schema checks reject wrong types, missing fields and bad bounds',()=>{
 assert.equal(matchesSchema({answer:'fine'},schema),true);for(const data of [null,[],{answer:2},{},{answer:'x'.repeat(101)},{answer:'ok',extra:true}])assert.equal(matchesSchema(data,schema),false);
 assert.equal(matchesSchema(2,{type:'integer',minimum:0,maximum:1}),false);assert.equal(matchesSchema(['x'],{type:'array',items:{type:'string'},maxItems:0}),false);
});
test('usage status requires MFA admin and cleanup retains current-month allowances',async()=>{
 const f=await setup();await assert.rejects(aiRuntimeRoutes(f.request('/api/admin/ai/status'),f.env,f.now),e=>e.status===401);f.admin();
 await runAI(f.env,options(f,{fetcher:async()=>response()}));const status=await (await aiRuntimeRoutes(f.request('/api/admin/ai/status'),f.env,f.now)).json();assert.equal(status.month_requests,1);assert.equal(status.monthly_limit,500);assert.equal(status.enabled,true);assert.ok(!JSON.stringify(status).includes('test-private-key'));
 await cleanupAI(f.env,f.now+86401);assert.equal(f.sqlite.prepare('SELECT count(*) n FROM ai_results').get().n,0);assert.equal(f.sqlite.prepare('SELECT count(*) n FROM ai_usage').get().n,1);
});
