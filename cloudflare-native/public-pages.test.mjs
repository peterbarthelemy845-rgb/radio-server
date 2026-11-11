import {test} from 'node:test';
import assert from 'node:assert/strict';
import {operationsFixture} from './operations-fixture.mjs';
import {fetchHandler} from './worker.mjs';
const shell='<!doctype html><html><head><title>Radio Locals</title></head><body>Public shell</body></html>';
async function fixture(){const f=await operationsFixture(),requests=[];f.env.PUBLIC_ORIGIN='https://radiolocals.com';f.env.ASSETS={async fetch(request){requests.push(request);const path=new URL(request.url).pathname;if(path==='/assets/missing.js')return new Response('Missing',{status:404,headers:{'Content-Type':'text/plain'}});if(path==='/assets/main.js'){const unchanged=request.headers.get('If-None-Match')==='"release"';return new Response(unchanged?null:'public javascript',{status:unchanged?304:200,headers:{'Content-Type':'text/javascript',ETag:'"release"'}});}return new Response(shell,{headers:{'Content-Type':'text/html; charset=utf-8',ETag:'"shell"'}});}};return {...f,requests,fetch:(path,options)=>fetchHandler(new Request('https://radiolocals.com'+path,options),f.env)};}
test('HEAD public pages and assets have GET status/security headers with an empty body',async()=>{
 const f=await fixture();for(const path of ['/','/support','/add-station','/create-station','/wifi-setup','/station/'+f.station,'/station/999999','/assets/main.js','/assets/missing.js']){
  const get=await f.fetch(path),head=await f.fetch(path,{method:'HEAD'});assert.equal(head.status,get.status,path);assert.equal(await head.text(),'');for(const header of ['Content-Type','Cache-Control','Content-Security-Policy','ETag','Strict-Transport-Security'])assert.equal(head.headers.get(header),get.headers.get(header),path+' '+header);
 }
 assert.equal(f.requests.every(request=>request.method==='GET'),true);
 const conditional=await f.fetch('/assets/main.js',{method:'HEAD',headers:{'If-None-Match':'"release"'}});assert.equal(conditional.status,304);assert.equal(conditional.headers.get('ETag'),'"release"');assert.equal(await conditional.text(),'');
});
test('HEAD does not execute private POST routes or expose an error body',async()=>{
 const f=await fixture(),before=f.sqlite.prepare('SELECT count(*) n FROM mail_outbox').get().n;
 for(const path of ['/api/owner/register','/api/owner/login','/api/phone/claim','/not-a-page']){const response=await f.fetch(path,{method:'HEAD'});assert.ok(response.status>=400);assert.equal(await response.text(),'');}
 assert.equal(f.sqlite.prepare('SELECT count(*) n FROM mail_outbox').get().n,before);
});
test('direct public pages receive meaningful server titles',async()=>{
 const f=await fixture();for(const [path,title] of [['/','Radio'],['/support','Support'],['/add-station','Create your station'],['/create-station','Create your station'],['/station-edit','Edit your station'],['/wifi-setup','Wi-Fi setup']])assert.ok((await(await f.fetch(path)).text()).includes('<title>'+title+' · Radio Locals</title>'),path);
});
test('published station links contain escaped WhatsApp/social metadata and canonical public URLs',async()=>{
 const f=await fixture(),key='b'.repeat(64)+'.png',name='News " & <script>alert(1)</script>',bio='Local <b>news</b> & "community"';f.sqlite.prepare('UPDATE stations SET name=?,bio=?,artwork_key=? WHERE code=?').run(name,bio,key,f.station);
 const response=await f.fetch('/station/'+f.station+'?device_code=private&token=secret'),html=await response.text();assert.equal(response.status,200);assert.ok(html.includes('News &quot; &amp; &lt;script&gt;alert(1)&lt;/script&gt;'));assert.ok(html.includes('property="og:url" content="https://radiolocals.com/station/'+f.station+'"'));assert.ok(html.includes('property="og:image" content="https://radiolocals.com/artwork/'+key+'"'));assert.ok(html.includes('name="twitter:description"'));assert.doesNotMatch(html,/<script>alert|device_code|token=secret|private@example/);assert.equal(response.headers.get('Cache-Control'),'no-store');assert.equal(response.headers.get('ETag'),null);
});
test('unknown or unpublished station share pages disclose no station name, biography or artwork',async()=>{
 const f=await fixture();f.sqlite.prepare("UPDATE stations SET status='pending_review',name='Private station',bio='Private biography',artwork_key=? WHERE code=?").run('f'.repeat(64)+'.png',f.station);
 for(const path of ['/station/'+f.station,'/station/999999']){const response=await f.fetch(path),html=await response.text();assert.equal(response.status,404);assert.match(html,/Station not found/);assert.doesNotMatch(html,/Private station|Private biography|og:image|f{64}/);}
});

test('an app-shell conditional request cannot bypass station publication checks or return stale shared metadata',async()=>{
 const f=await fixture();f.sqlite.prepare("UPDATE stations SET status='suspended' WHERE code=?").run(f.station);const response=await f.fetch('/station/'+f.station,{headers:{'If-None-Match':'"shell"','If-Modified-Since':'Wed, 01 Jan 2025 00:00:00 GMT'}});assert.equal(response.status,404);assert.equal(f.requests.at(-1).headers.get('If-None-Match'),null);assert.equal(f.requests.at(-1).headers.get('If-Modified-Since'),null);
});
