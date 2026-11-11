import {test} from 'node:test';
import assert from 'node:assert/strict';
import {operationsFixture} from './operations-fixture.mjs';
import {streamCheckRoutes} from './stream-check.mjs';
import {publicStreamUrl} from './public-stream-url.mjs';
import {HttpError} from './security.mjs';
import {attachStreamCheck} from './stream-verification.mjs';

const origin='https://radiolocals.com',path='/api/owner/stream-check',audioUrl='https://stream.example.com/live';
const mp3=()=>{const data=new Uint8Array(417);data.set([255,251,144,0]);return data;};
async function fixture(){const f=await operationsFixture();f.env.STREAM_CHECK_PUBLIC_FETCH='true';f.env.PUBLIC_ORIGIN=origin;return f;}
const body=stream_url=>({stream_url,turnstile_token:'test-only-token'});
function deferred(){let resolve;const promise=new Promise(yes=>{resolve=yes;});return {promise,resolve};}
async function check(f,url=audioUrl,fetcher=async()=>new Response(mp3(),{headers:{'Content-Type':'audio/mpeg'}}),extras={}){
 return (await streamCheckRoutes(f.request(path,body(url)),f.env,f.now,{human:async()=>{},fetch:fetcher,...extras})).json();
}
const encode=value=>new TextEncoder().encode(value);
function rawResponse(payload=mp3(),headers='Content-Type: audio/mpeg\r\n',status='HTTP/1.1 200 OK'){
 const head=encode(status+'\r\n'+headers+'\r\n'),result=new Uint8Array(head.length+payload.length);result.set(head);result.set(payload,head.length);return result;
}
function sockets(responses){
 const state={addresses:[],sent:[],closes:0};
 state.connect=(address,options)=>{
  state.addresses.push({address,options});const bytes=responses.shift();if(bytes instanceof Error)throw bytes;
  assert.ok(bytes,'Unexpected additional socket');
  return {opened:Promise.resolve({}),closed:Promise.resolve(),readable:new ReadableStream({start(controller){controller.enqueue(bytes);controller.close();}}),
   writable:new WritableStream({write(bytes){state.sent.push(new TextDecoder().decode(bytes));}}),close(){state.closes++;}};
 };
 return state;
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
test('missing strictly-public deployment attestation fails closed and numeric URLs never use global fetch',async()=>{
 const f=await fixture();let calls=0;const fetcher=async()=>{calls++;throw Error('must not fetch');};
 delete f.env.STREAM_CHECK_PUBLIC_FETCH;
 await assert.rejects(check(f,audioUrl,fetcher),e=>e.status===503);
 f.env.STREAM_CHECK_PUBLIC_FETCH='true';
 for(const url of ['http://8.8.8.8:8000/live',origin+'/api/owner/stream-check','https://www.radiolocals.com/']){
  const result=await check(f,url,fetcher);assert.equal(result.result,'not_confirmed');assert.equal(result.audio_response,false);
 }
 assert.equal(calls,0);
});

test('a public IPv4 audio response earns the same exact-URL proof without browser headers or upstream disclosure',async()=>{
 const f=await fixture(),url='http://162.244.81.219:8020/live',state=sockets([rawResponse(mp3(),'Content-Type: audio/mpeg\r\nX-Secret: private-upstream\r\n','ICY 200 OK')]);
 const result=await check(f,url,()=>{throw Error('IP must not use fetch');},{connect:state.connect});
 assert.equal(result.audio_response,true);assert.equal(state.addresses.length,1);assert.equal(state.addresses[0].address.port,8020);assert.equal(state.closes,1);
 assert.ok(!JSON.stringify(result).includes('private-upstream'));assert.doesNotMatch(state.sent[0],/Cookie|Authorization|X-CSRF|test-only-token/);
 const receipt=f.sqlite.prepare('SELECT * FROM stream_check_results').get();assert.equal(receipt.stream_url,url);assert.equal(receipt.checked_at,f.now);assert.equal(receipt.expires,f.now+3600);
 assert.equal(f.sqlite.prepare('SELECT status FROM stations WHERE code=?').get(f.station).status,'published');
});

test('redirect limits and original-URL evidence are shared across hostname and numeric transports',async()=>{
 const f=await fixture(),original='http://stream.example.com/live';let fetches=0;
 const state=sockets([rawResponse(new Uint8Array(),'Location: https://final.example.com/live\r\n','HTTP/1.0 302 Found')]);
 const result=await check(f,original,async(url)=>{
  fetches++;if(fetches===1)return new Response(null,{status:302,headers:{Location:'http://162.244.81.219:8020/live'}});
  assert.equal(url,'https://final.example.com/live');assert.equal(state.closes,1);return new Response(mp3(),{headers:{'Content-Type':'audio/mpeg'}});
 },{connect:state.connect});
 assert.equal(result.audio_response,true);assert.equal(fetches,2);assert.equal(state.addresses.length,1);assert.equal(f.sqlite.prepare('SELECT stream_url FROM stream_check_results').get().stream_url,original);
 const g=await fixture(),loop=sockets(Array.from({length:3},()=>rawResponse(new Uint8Array(),'Location: /again\r\n','HTTP/1.1 302 Found')));
 assert.equal((await check(g,'http://162.244.81.219:8020/live',()=>{throw Error('Unexpected fetch');},{connect:loop.connect})).audio_response,false);
 assert.equal(loop.addresses.length,3);assert.equal(loop.closes,3);
});

test('numeric redirects revalidate every target and never open private, credentialed, own-host or downgraded targets',async()=>{
 for(const location of ['http://127.0.0.1/','http://2130706433/','http://169.254.169.254/','http://192.168.0.1/','http://[::ffff:127.0.0.1]/',
  'https://user:secret@other.example.com/live','https://other.example.com/live?token=secret','https://radiolocals.com/','https://child.radiolocals.com/','http://other.example.com/live']){
  const f=await fixture(),state=sockets([rawResponse(new Uint8Array(),'Location: '+location+'\r\n','HTTP/1.1 302 Found')]);let fetches=0;
  const result=await check(f,'https://162.244.81.219:8443/live',()=>{fetches++;throw Error('Unexpected follow-up');},{connect:state.connect});
  assert.equal(result.audio_response,false,location);assert.equal(fetches,0,location);assert.equal(state.addresses.length,1,location);assert.equal(state.closes,1,location);
 }
});

test('socket failures and misleading numeric responses cannot earn proof or trigger insecure retries',async()=>{
 for(const response of [new Error('certificate mismatch secret'),rawResponse(encode('<html>no audio</html>')),rawResponse(mp3(),'Content-Type: text/html\r\n')]){
  const f=await fixture(),state=sockets([response]);let fetches=0;
  const result=await check(f,'https://162.244.81.219:8443/live',()=>{fetches++;throw Error('Unexpected fallback');},{connect:state.connect});
  assert.equal(result.audio_response,false);assert.equal(fetches,0);assert.equal(state.addresses.length,1);assert.equal(state.addresses[0].options.secureTransport,'on');
  assert.ok(!JSON.stringify(result).includes('secret'));assert.equal(f.sqlite.prepare('SELECT COUNT(*) n FROM stream_check_results').get().n,0);
 }
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
test('passing checks persist a session receipt for the canonical original URL, never a redirect or automatic publication',async()=>{
 const f=await fixture();let calls=0;const original='http://STREAM.example.com/live?sid=2';const result=await check(f,original,async()=>++calls===1?new Response(null,{status:302,headers:{Location:'https://redirected.example.com/audio'}}):new Response(mp3(),{headers:{'Content-Type':'audio/mpeg'}}));assert.equal(result.audio_response,true);const receipt=f.sqlite.prepare('SELECT * FROM stream_check_results').get();assert.equal(receipt.session_hash,f.sqlite.prepare('SELECT token_hash FROM sessions').get().token_hash);assert.equal(receipt.stream_url,'http://stream.example.com/live?sid=2');assert.equal(receipt.checked_at,f.now);assert.equal(receipt.expires,f.now+3600);assert.match(receipt.check_id,/^[a-f0-9]{32}$/);assert.equal(f.sqlite.prepare('SELECT COUNT(*) n FROM station_stream_checks').get().n,0);assert.equal(f.sqlite.prepare('SELECT COUNT(*) n FROM station_edits').get().n,0);
});

test('a later unconfirmed check clears its receipt and associated proof without trusting the browser',async()=>{
 const f=await fixture();f.sqlite.prepare("UPDATE stations SET stream_url=?,status='pending_review',email_verified_at=? WHERE code=?").run(audioUrl,f.now,f.station);await check(f);const hash=f.sqlite.prepare('SELECT token_hash FROM sessions').get().token_hash;assert.equal(await attachStreamCheck(f.env,hash,f.station,audioUrl,'initial',f.now),true);const result=await check(f,audioUrl,async()=>new Response('<html>no audio</html>',{headers:{'Content-Type':'text/html'}}));assert.equal(result.audio_response,false);assert.equal(f.sqlite.prepare('SELECT COUNT(*) n FROM stream_check_results').get().n,0);const proof=f.sqlite.prepare('SELECT checked_at,expires FROM station_stream_checks').get();assert.equal(proof.checked_at,0);assert.equal(proof.expires,0);assert.equal(f.sqlite.prepare('SELECT status FROM stations WHERE code=?').get(f.station).status,'pending_review');
});

test('overlapping server checks keep only the newest attempt outcome for a session and URL',async()=>{
 for(const olderPass of [true,false]){const f=await fixture(),gate=deferred(),entered=deferred();const old=check(f,audioUrl,async()=>{entered.resolve();return gate.promise;});await entered.promise;const latest=await check(f,audioUrl,async()=>new Response(olderPass?'<html>no audio</html>':mp3(),{headers:{'Content-Type':olderPass?'text/html':'audio/mpeg'}}));gate.resolve(new Response(olderPass?mp3():'<html>old failure</html>',{headers:{'Content-Type':olderPass?'audio/mpeg':'text/html'}}));const obsolete=await old;assert.equal(obsolete.audio_response,false);assert.equal(latest.audio_response,!olderPass);assert.equal(f.sqlite.prepare('SELECT COUNT(*) n FROM stream_check_results WHERE checked_at>0').get().n,olderPass?0:1);}
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
