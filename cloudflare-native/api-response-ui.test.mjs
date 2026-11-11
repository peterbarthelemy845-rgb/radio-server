import {test} from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';

const site=readFileSync(new URL('./public/assets/site.js',import.meta.url),'utf8');
const source=site.slice(site.indexOf('async function api('),site.indexOf('const formBusyStates='));
function fixture(reply){
 const calls=[],signals=[],deadlines=[];
 const context=vm.createContext({navigator:{onLine:true},state:{csrf:'test-csrf'},AbortController,AbortSignal:{timeout(milliseconds){signals.push(milliseconds);const deadline=new AbortController();deadlines.push(deadline);return deadline.signal;}},fetch:async(path,options)=>{calls.push({path,options});if(reply instanceof Error)throw reply;if(typeof reply==='function')return await reply(path,options);return reply;}});
 vm.runInContext(source,context);
 return {calls,signals,deadlines,context,request(body,options={}){context.body=body;context.options=options;return vm.runInContext("api('/api/test',body,options)",context);}};
}
const jsonResponse=(body,status=200)=>new Response(JSON.stringify(body),{status,headers:{'Content-Type':'application/json'}});

test('unexpected server errors show a validated support reference without exposing arbitrary reference text',async()=>{
 for(const reference of ['1234567890abcdef','a'.repeat(32)]){
  const f=fixture(jsonResponse({message:'Please try again.',error_reference:reference},500));
  await assert.rejects(f.request(),error=>error.status===500&&error.errorReference===reference&&error.message==='Please try again. Reference: '+reference+'.');
 }
 for(const reference of ['private-email@example.com','<script>bad</script>','abc',42,{secret:'private'}]){
  const f=fixture(jsonResponse({message:'Please try again.',error_reference:reference},500));
  await assert.rejects(f.request(),error=>error.status===500&&error.errorReference===undefined&&error.message==='Please try again.');
 }
});

test('HTML outages and malformed unauthorized responses show a plain retry error while preserving HTTP status',async()=>{
 for(const status of [503,401]){const f=fixture(new Response('<html>Gateway error: private upstream detail</html>',{status,headers:{'Content-Type':'text/html'}}));await assert.rejects(f.request(),error=>error.status===status&&error.message==='The website is temporarily unavailable. Please try again.'&&!error.message.includes('private upstream'));}
});

test('null or unexpected primitive JSON results fail clearly instead of triggering later property errors',async()=>{
 for(const body of [null,'unexpected',false,15]){const f=fixture(jsonResponse(body));await assert.rejects(f.request(),error=>error.status===200&&error.message==='The website is temporarily unavailable. Please try again.');}
 const f=fixture(jsonResponse(null,403));await assert.rejects(f.request(),error=>error.status===403&&error.message==='The website is temporarily unavailable. Please try again.');
});

test('valid JSON errors keep their server message and status, and valid results stay unchanged',async()=>{
 const denied=fixture(jsonResponse({message:'Please sign in.'},401));await assert.rejects(denied.request(),error=>error.status===401&&error.message==='Please sign in.');
 const success=fixture(jsonResponse({status:'ok',station_code:'13'}));assert.deepEqual(JSON.parse(JSON.stringify(await success.request())),{status:'ok',station_code:'13'});
 const generic=fixture(jsonResponse({message:{internal:'detail'}},502));await assert.rejects(generic.request(),error=>error.status===502&&error.message==='Please try again.');
});

test('fetch timeouts, cancellations and network failures have readable retry guidance',async()=>{
 for(const name of ['TimeoutError','AbortError']){const error=Object.assign(new Error('Private browser timeout detail'),{name}),f=fixture(error);await assert.rejects(f.request(),result=>result.message==='Request timed out. Please try again.'&&result.status===undefined);}
 const f=fixture(new TypeError('Failed to fetch: internal URL detail'));await assert.rejects(f.request(),error=>error.message==='Could not connect. Check your internet connection and try again.');
 const interrupted=fixture({status:200,ok:true,json:async()=>{throw Object.assign(new Error('The operation was aborted'),{name:'AbortError'});}});await assert.rejects(interrupted.request(),error=>error.status===200&&error.message==='Request timed out. Please try again.');
});

test('unexpected errors and invalid caller data remain programming errors rather than network messages',async()=>{
 const error=new RangeError('Unexpected bug'),f=fixture(error);await assert.rejects(f.request(),result=>result===error);
 const parserError=new TypeError('Body already consumed'),bodyFailure=fixture({status:200,ok:true,json:async()=>{throw parserError;}});await assert.rejects(bodyFailure.request(),result=>result===parserError);
 const invalid=fixture(jsonResponse({status:'ok'})),cycle={};cycle.self=cycle;await assert.rejects(invalid.request(cycle),error=>error.name==='TypeError'&&/circular/i.test(error.message));assert.equal(invalid.calls.length,0);
});

test('requests retain their method, CSRF protection, same-origin credentials and bounded deadline',async()=>{
 const f=fixture(jsonResponse({status:'ok'}));await f.request({code:'13'},{cache:'no-store'});assert.equal(f.calls[0].path,'/api/test');assert.equal(f.calls[0].options.method,'POST');assert.equal(f.calls[0].options.credentials,'same-origin');assert.equal(f.calls[0].options.headers['X-CSRF-Token'],'test-csrf');assert.equal(f.calls[0].options.headers['Content-Type'],'application/json');assert.equal(f.calls[0].options.body,'{"code":"13"}');assert.equal(f.calls[0].options.cache,'no-store');assert.deepEqual(f.signals,[20000]);
 const offline=fixture(jsonResponse({status:'ok'}));offline.context.navigator.onLine=false;await assert.rejects(offline.request(),/No internet. Check your connection and try again./);assert.equal(offline.calls.length,0);
});

function deferred(){let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return {promise,resolve,reject};}
async function until(check){for(let i=0;i<30;i++){if(check())return;await Promise.resolve();}throw Error('API test did not reach expected phase');}
const intentional=error=>error.name==='AbortError'&&error.message==='Request cancelled.'&&!/timed out/.test(error.message);

test('pre-aborted obsolete requests dispatch neither fetch nor a new timeout, including writes',async()=>{
 const caller=new AbortController();caller.abort(new Error('Private cancellation reason'));const f=fixture(jsonResponse({status:'ok'}));f.context.navigator.onLine=false;await assert.rejects(f.request({station_code:'13'},{signal:caller.signal}),intentional);assert.equal(f.calls.length,0);assert.equal(f.signals.length,0);
});

test('caller cancellation aborts an in-flight fetch without waiting for its response or treating it as a timeout',async()=>{
 const waiting=deferred(),caller=new AbortController(),f=fixture(()=>waiting.promise),request=f.request(undefined,{signal:caller.signal});await until(()=>f.calls.length===1);assert.notEqual(f.calls[0].options.signal,caller.signal);caller.abort('Private reason');await assert.rejects(request,intentional);assert.equal(f.calls[0].options.signal.aborted,true);waiting.reject(new Error('Late transport failure'));await Promise.resolve();assert.equal(f.calls.length,1);
});

test('obsolete JSON body reads reject promptly and ignore a later successful parse',async()=>{
 const waiting=deferred(),caller=new AbortController();let parsing=false;const f=fixture({status:200,ok:true,json:()=>{parsing=true;return waiting.promise;}}),request=f.request(undefined,{signal:caller.signal});await until(()=>parsing);caller.abort();await assert.rejects(request,intentional);assert.equal(f.calls[0].options.signal.aborted,true);waiting.resolve({status:'ok',private_result:'obsolete'});await Promise.resolve();assert.equal(f.calls.length,1);
});

test('the independent 20-second deadline still ends fetch or JSON reads when a caller signal exists',async()=>{
 for(const phase of ['fetch','body']){const waiting=deferred(),caller=new AbortController();let parsing=false;const f=fixture(phase==='fetch'?()=>waiting.promise:{status:502,ok:false,json:()=>{parsing=true;return waiting.promise;}}),request=f.request(undefined,{signal:caller.signal});await until(()=>phase==='fetch'?f.calls.length===1:parsing);f.deadlines[0].abort();await assert.rejects(request,error=>error.name!=='AbortError'&&error.message==='Request timed out. Please try again.'&&error.status===(phase==='body'?502:undefined));assert.equal(caller.signal.aborted,false);assert.equal(f.calls[0].options.signal.aborted,true);waiting.reject(Error('Late body/network failure'));}
});

test('the first abort source wins when timeout and caller cancellation happen together',async()=>{
 for(const first of ['caller','timeout']){const waiting=deferred(),caller=new AbortController(),f=fixture(()=>waiting.promise),request=f.request(undefined,{signal:caller.signal});await until(()=>f.calls.length);if(first==='caller'){caller.abort();f.deadlines[0].abort();await assert.rejects(request,intentional);}else{f.deadlines[0].abort();caller.abort();await assert.rejects(request,error=>error.name!=='AbortError'&&/timed out/.test(error.message));}waiting.resolve(jsonResponse({status:'ok'}));}
});

test('caller and timeout listeners are removed after success or programming errors',async()=>{
 for(const invalidBody of [false,true]){const caller=new AbortController(),f=fixture(jsonResponse({status:'ok'}));let body,added=0,removed=0;const add=caller.signal.addEventListener.bind(caller.signal),remove=caller.signal.removeEventListener.bind(caller.signal);caller.signal.addEventListener=(...args)=>{added++;add(...args);};caller.signal.removeEventListener=(...args)=>{removed++;remove(...args);};if(invalidBody){body={};body.self=body;await assert.rejects(f.request(body,{signal:caller.signal}),error=>error.name==='TypeError');assert.equal(f.calls.length,0);}else{assert.equal((await f.request(undefined,{signal:caller.signal})).status,'ok');caller.abort();f.deadlines[0].abort();assert.equal(f.calls[0].options.signal.aborted,false);}assert.equal(added,1);assert.equal(removed,1);}
});

test('invalid signals and non-Error rejection values retain their programming-error semantics',async()=>{
 const invalid=fixture(jsonResponse({status:'ok'}));await assert.rejects(invalid.request(undefined,{signal:{aborted:false}}),error=>error.name==='TypeError'&&error.message==='Invalid request signal.');assert.equal(invalid.calls.length,0);assert.equal(invalid.signals.length,0);
 const rejected=fixture(()=>Promise.reject(null));await assert.rejects(rejected.request(),error=>error===null);
});

test('cancelling a dispatched write never replays it or claims its server operation was undone',async()=>{
 const waiting=deferred(),caller=new AbortController(),f=fixture(()=>waiting.promise),request=f.request({station_code:'13'},{signal:caller.signal,cache:'no-store'});await until(()=>f.calls.length===1);caller.abort();await assert.rejects(request,intentional);assert.equal(f.calls[0].options.method,'POST');assert.equal(f.calls[0].options.body,'{"station_code":"13"}');waiting.resolve(jsonResponse({status:'ok'}));await Promise.resolve();assert.equal(f.calls.length,1);
});
