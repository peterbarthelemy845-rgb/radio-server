import {test} from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';

const site=readFileSync(new URL('./public/assets/site.js',import.meta.url),'utf8');
const source=site.slice(site.indexOf('async function api('),site.indexOf('const formBusyStates='));
function fixture(reply){
 const calls=[],signals=[];
 const context=vm.createContext({navigator:{onLine:true},state:{csrf:'test-csrf'},AbortSignal:{timeout(milliseconds){signals.push(milliseconds);return {timeout:milliseconds};}},fetch:async(path,options)=>{calls.push({path,options});if(reply instanceof Error)throw reply;return reply;}});
 vm.runInContext(source,context);
 return {calls,signals,context,request(body,options={}){context.body=body;context.options=options;return vm.runInContext("api('/api/test',body,options)",context);}};
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
