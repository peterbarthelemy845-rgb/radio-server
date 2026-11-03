import {test} from 'node:test';
import assert from 'node:assert/strict';
import {screenStation,needsTextReview} from './moderation.mjs';
function fixture(){let published=false;const station={code:10,name:'Community Radio',bio:'Local music and news',artwork_key:'safe.png',updated_at:1};
 const env={OPENAI_API_KEY:'private-test',DB:{prepare(sql){return {bind(){return this;},async first(){if(sql.startsWith('SELECT'))return station;published=true;return {code:10};}};}},MEDIA:{async get(){return {size:12,customMetadata:{sanitizer_version:'1'},async arrayBuffer(){return new Uint8Array(12).buffer;}};}}};
 const categories=Object.fromEntries(['sexual','sexual/minors','violence','violence/graphic','hate','harassment','self-harm'].map(k=>[k,false]));
 const result={flagged:false,categories,category_scores:Object.fromEntries(Object.keys(categories).map(k=>[k,0.001]))};
 return {env,result,station,published:()=>published};}
test('safe complete scan publishes and sends no owner email or stream URL',async()=>{const f=fixture();let calls=0;
 assert.equal(await screenStation(f.env,10,async(url,init)=>{calls++;assert.equal(url,'https://api.openai.com/v1/moderations');assert.equal(init.redirect,'manual');assert.equal(init.body.includes('contact_email'),false);return Response.json({results:[f.result]});}),true);
 assert.equal(calls,1);assert.equal(f.published(),true);});
test('flagged, borderline, malformed, failed and missing scanner responses never publish',async()=>{
 for(const kind of ['flagged','borderline','malformed','failure','missing']){const f=fixture();if(kind==='flagged')f.result.flagged=true;if(kind==='borderline')f.result.category_scores.sexual=.3;if(kind==='missing')delete f.env.OPENAI_API_KEY;
 const output=await screenStation(f.env,10,async()=>kind==='failure'?new Response('',{status:503}):Response.json(kind==='malformed'?{results:[{flagged:false}]}:{results:[f.result]}));
 assert.equal(output,false,kind);assert.equal(f.published(),false,kind);}});
test('profanity screening flags obfuscation while normal names pass',async()=>{assert.equal(needsTextReview('Community Radio'),false);assert.equal(needsTextReview('f.u.c.k radio'),true);assert.equal(needsTextReview('sh1t radio'),true);const f=fixture();f.station.name='porn radio';assert.equal(await screenStation(f.env,10,()=>{throw Error('must not call');}),false);});
