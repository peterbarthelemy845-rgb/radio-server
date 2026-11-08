import {test} from 'node:test';
import assert from 'node:assert/strict';
import {operationsFixture} from './operations-fixture.mjs';
import {streamCheckRoutes} from './stream-check.mjs';
import {publicStreamUrl} from './public-stream-url.mjs';
import {HttpError} from './security.mjs';

const origin='https://radiolocals.com',path='/api/owner/stream-check',audioUrl='https://stream.example.com/live';
const mp3=()=>{const data=new Uint8Array(417);data.set([255,251,144,0]);return data;};
async function fixture(){const f=await operationsFixture();f.env.STREAM_CHECK_PUBLIC_FETCH='true';f.env.PUBLIC_ORIGIN=origin;return f;}
const body=stream_url=>({stream_url,turnstile_token:'test-only-token'});
async function check(f,url=audioUrl,fetcher=async()=>new Response(mp3(),{headers:{'Content-Type':'audio/mpeg'}})){
 return (await streamCheckRoutes(f.request(path,body(url)),f.env,f.now,{human:async()=>{},fetch:fetcher})).json();
}
test('saved URL validation allows public hostnames and public IPv4 with ports while blocking special/private addresses',()=>{
 assert.equal(publicStreamUrl('https://STREAM.example.com/live?x=1'),'https://stream.example.com/live?x=1');
 assert.equal(publicStreamUrl('http://8.8.8.8:8000/live'),'http://8.8.8.8:8000/live');
 for(const address of ['0.1.2.3','10.0.0.1','100.64.0.1','127.0.0.1','169.254.169.254','172.16.0.1','172.31.255.255','192.0.0.9','192.0.2.1','192.88.99.1','192.168.0.1','198.18.0.1','198.51.100.3','203.0.113.4','224.0.0.1','240.0.0.1','255.255.255.255','0x7f000001','2130706433','127.1','0177.0.0.1'])
  assert.throws(()=>publicStreamUrl('http://'+address+'/live'),e=>e.status===400,address);
 for(const url of ['file:///etc/passwd','ftp://stream.example.com/live','https://owner:secret@stream.example.com/live','https://stream.example.com/#secret','http://localhost/live','http://[::1]/live','http://[::ffff:8.8.8.8]/live','http://station.local/live','http://station.internal/live','http://metadata.google.internal/','http://host.home.arpa/','http://station.test/live','http://station.example/live','http://stream.example.com./live','http://stream.example.com:0/live','https://stream.example.com/\nlive','https://stream.example.com\\@localhost/live'])
  assert.throws(()=>publicStreamUrl(url),e=>e.status===400,url);
});

test('stored stream URLs fit the radio 1024-byte limit after URL normalization',()=>{
 const prefix='https://stream.example.com/';
 const maximum=prefix+'a'.repeat(1024-prefix.length);
 assert.equal(publicStreamUrl(maximum),maximum);
 assert.throws(()=>publicStreamUrl(maximum+'a'),e=>e.status===400);
 // Short Unicode input expands into a longer percent-encoded address.
 const encodedBoundary=prefix+'a'.repeat(1024-prefix.length-6)+'é';
 assert.equal(publicStreamUrl(encodedBoundary).length,1024);
 assert.throws(()=>publicStreamUrl(encodedBoundary+'a'),e=>e.status===400);
});
test('route and browser CSRF are checked before any human verifier or stream request',async()=>{
 const f=await fixture();let external=0;const deps={human:async()=>{external++;},fetch:async()=>{external++;}};
 assert.equal(await streamCheckRoutes(new Request(origin+'/api/owner/other'),f.env,f.now,deps),null);
 await assert.rejects(streamCheckRoutes(new Request(origin+path),f.env,f.now,deps),e=>e.status===405);
 const noCsrf=new Request(origin+path,{method:'POST',headers:{'Content-Type':'application/json',Origin:origin},body:JSON.stringify(body(audioUrl))});
 await assert.rejects(streamCheckRoutes(noCsrf,f.env,f.now,deps),e=>e.status===401||e.status===403);assert.equal(external,0);
 const foreign=f.request(path,body(audioUrl));foreign.headers.set('Origin','https://attacker.example');
 await assert.rejects(streamCheckRoutes(foreign,f.env,f.now,deps),e=>e.status===403);assert.equal(external,0);
});
test('failed bot checks are limited before the provider and no stream is requested',async()=>{
 const f=await fixture();let calls=0,streams=0;
 const deps={human:async(_request,_env,_token,action)=>{assert.equal(action,'stream-check');calls++;throw new HttpError(400,'Complete the security check.');},fetch:async()=>{streams++;}};
 for(let n=0;n<6;n++)await assert.rejects(streamCheckRoutes(f.request(path,body(audioUrl)),f.env,f.now,deps),e=>e.status===400);
 await assert.rejects(streamCheckRoutes(f.request(path,body(audioUrl)),f.env,f.now,deps),e=>e.status===429);
 assert.equal(calls,6);assert.equal(streams,0);
});
test('missing strictly-public deployment attestation fails closed and numeric URLs are not fetched',async()=>{
 const f=await fixture();let calls=0;const fetcher=async()=>{calls++;throw Error('must not fetch');};
 delete f.env.STREAM_CHECK_PUBLIC_FETCH;
 await assert.rejects(check(f,audioUrl,fetcher),e=>e.status===503);
 f.env.STREAM_CHECK_PUBLIC_FETCH='true';
 for(const url of ['http://8.8.8.8:8000/live',origin+'/api/owner/stream-check','https://www.radiolocals.com/']){
  const result=await check(f,url,fetcher);assert.equal(result.result,'not_confirmed');assert.equal(result.audio_response,false);
 }
 assert.equal(calls,0);
});
test('a bounded audio sample is reported without claiming playback or forwarding browser credentials',async()=>{
 const f=await fixture();let cancelled=false,read=0;
 const result=await check(f,audioUrl,async(url,init)=>{
  assert.equal(url,audioUrl);assert.equal(init.method,'GET');assert.equal(init.redirect,'manual');assert.equal(init.cache,'no-store');
  assert.equal(init.headers.Range,'bytes=0-8191');assert.equal(init.headers.Cookie,undefined);assert.equal(init.headers.Authorization,undefined);assert.equal(init.headers['X-CSRF-Token'],undefined);
  return new Response(new ReadableStream({pull(controller){read++;controller.enqueue(mp3());},cancel(){cancelled=true;}}),{headers:{'Content-Type':'audio/mpeg; charset=binary'}});
 });
 assert.deepEqual(result,{result:'audio_response',audio_response:true,message:'Stream responded with audio data. Playback is not verified.'});
 await new Promise(resolve=>setTimeout(resolve,0));assert.equal(cancelled,true);assert.ok(read<=2);
});
test('HTML, MIME-only, ID3-only, empty and oversized unrelated responses never count as audio',async()=>{
 const f=await fixture();let count=0;
 for(const [data,type] of [[new TextEncoder().encode('<html>not an audio stream</html>'),'audio/mpeg'],[mp3(),'text/html'],[new Uint8Array(0),'audio/mpeg'],[new TextEncoder().encode('ID3'+String.fromCharCode(4,0,0,0,0,0,0)+'metadata only'),'audio/mpeg'],[new Uint8Array(32768),'application/octet-stream']]){
  assert.equal((await check(f,audioUrl,async()=>new Response(data,{headers:{'Content-Type':type}}))).audio_response,false);count++;
 }
 assert.equal(count,5);
});
test('redirects are manual, bounded and revalidated, with no private or insecure follow-up request',async()=>{
 for(const location of ['http://127.0.0.1/private','https://user:secret@other.example.com/live','http://other.example.com/live','https://radiolocals.com/','http://[::1]/','https://8.8.8.8/']){
  const f=await fixture();let calls=0,cancelled=false;
  const result=await check(f,audioUrl,async()=>{calls++;return new Response(new ReadableStream({cancel(){cancelled=true;}}),{status:302,headers:{Location:location}});});
  assert.equal(result.audio_response,false,location);assert.equal(calls,1,location);assert.equal(cancelled,true,location);
 }
 const f=await fixture();let calls=0;
 const result=await check(f,audioUrl,async()=>{calls++;return new Response(null,{status:302,headers:{Location:'/live-again'}});});
 assert.equal(result.audio_response,false);assert.equal(calls,3);
});
test('public redirects can reach an audio response and failures disclose no upstream response details',async()=>{
 const f=await fixture();let calls=0;
 const result=await check(f,'http://stream.example.com/live',async()=>++calls===1?new Response(null,{status:301,headers:{Location:'https://other.example.com/audio'}}):new Response(mp3(),{headers:{'Content-Type':'audio/mpeg','X-Secret':'must not leak'}}));
 assert.equal(result.audio_response,true);assert.equal(calls,2);assert.ok(!JSON.stringify(result).includes('must not leak'));
 const failed=await check(f,audioUrl,async()=>{throw Error('10.0.0.7 upstream private credential');});
 assert.equal(failed.audio_response,false);assert.ok(!JSON.stringify(failed).includes('10.0.0.7'));
});
test('fetch headers or body stalls end within the overall deadline without waiting for cancellation', {timeout:16000},async()=>{
 for(const stall of ['headers','body']){
  const f=await fixture(),start=Date.now();let cancelled=false;
  const result=await check(f,audioUrl,async()=>stall==='headers'?new Promise(()=>{}):new Response(new ReadableStream({pull(){return new Promise(()=>{});},cancel(){cancelled=true;return new Promise(()=>{});}}),{headers:{'Content-Type':'audio/mpeg'}}));
  assert.equal(result.audio_response,false);assert.ok(Date.now()-start>=5800);assert.ok(Date.now()-start<7600);
  if(stall==='body')assert.equal(cancelled,true);
 }
});
