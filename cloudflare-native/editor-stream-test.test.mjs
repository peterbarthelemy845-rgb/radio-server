import {test} from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';

const moduleSource=readFileSync(new URL('./public/assets/editor-stream-test.js',import.meta.url),'utf8');
const registrationSource=readFileSync(new URL('./public/assets/registration-form.js',import.meta.url),'utf8');
const siteSource=readFileSync(new URL('./public/assets/site.js',import.meta.url),'utf8');
function deferred(){let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return {promise,resolve,reject};}
async function settle(){for(let i=0;i<4;i++)await new Promise(resolve=>setImmediate(resolve));}
function fixture(value='https://stream.example.com/live'){
 const nodes=new Map(),observers=[],events=new Map(),humanCalls=[],apiCalls=[];let humanResult='checked-token',apiResult={result:'not_confirmed',audio_response:false},focused,media=0;
 function node(id){const handlers=new Map(),element={id,value:'',dataset:{},attrs:{},disabled:false,hidden:false,elements:{},textContent:'',listeners:handlers,
  addEventListener(type,fn){const list=handlers.get(type)||[];list.push(fn);handlers.set(type,list);},dispatch(type){for(const fn of handlers.get(type)||[])fn({type,target:this});},getAttribute(name){return this.attrs[name]??null;},focus(){focused=this;}};nodes.set(id,element);return element;}
 for(const id of ['editor','editForm','streamUrl','testOwnerStream','ownerStreamTestHuman','ownerStreamTestStatus','ownerSave'])node(id);
 const form=nodes.get('editForm'),field=nodes.get('streamUrl'),button=nodes.get('testOwnerStream'),save=nodes.get('ownerSave');form.elements.stream_url=field;field.value=value;button.textContent='Test stream';save.textContent='Save changes';
 const window={addEventListener(type,fn){events.set(type,fn);},appI18n:{t:key=>key}};
 const context=vm.createContext({window,document:{getElementById:id=>nodes.get(id),createElement(tag){if(['audio','video'].includes(tag)){media++;throw Error('No playback in stream checks');}return node(tag);}},AbortController,URL,queueMicrotask,
  Audio:class{constructor(){media++;throw Error('No audio playback');}},MutationObserver:class{constructor(fn){this.fn=fn;}observe(target,options){observers.push({target,options,fn:this.fn});}},
  human:async(container,action,signal)=>{humanCalls.push({container,action,signal});return new Promise((resolve,reject)=>{const abort=()=>reject(Object.assign(Error('Cancelled'),{name:'AbortError'}));signal.addEventListener('abort',abort,{once:true});if(signal.aborted)abort();Promise.resolve(humanResult).then(token=>{signal.removeEventListener('abort',abort);resolve(token);},error=>{signal.removeEventListener('abort',abort);reject(error);});});},
  api:async(path,body)=>{apiCalls.push({path,body});return await apiResult;},registrationText:(key,fallback)=>fallback,
 });
 vm.runInContext(siteSource.slice(siteSource.indexOf('const formBusyStates='),siteSource.indexOf('function loadHuman()')),context);
 window.parsePublicStreamUrl=vm.runInContext(registrationSource.slice(registrationSource.indexOf(' function registrationPublicIpv4('),registrationSource.indexOf(' function registrationSetUrl('))+';registrationParse;',context);
 vm.runInContext(moduleSource,context);
 function notify(target,attribute){for(const observer of observers)if(observer.target===target&&observer.options.attributeFilter.includes(attribute))observer.fn([{target,attributeName:attribute}]);}
 return {nodes,form,field,button,save,window,context,humanCalls,apiCalls,media:()=>media,focused:()=>focused,start:()=>button.onclick(),human(value){humanResult=value;},result(value){apiResult=value;},input(value){field.value=value;field.dispatch('input');},event(type){events.get(type)?.();},
  hide(){nodes.get('editor').hidden=true;notify(nodes.get('editor'),'hidden');},show(){nodes.get('editor').hidden=false;notify(nodes.get('editor'),'hidden');},reset(){form.dispatch('reset');field.value='';},stationChanged(){form.dataset.stationCode='14';notify(form,'data-station-code');},
  saveStart(){form.dataset.busy='1';form.attrs['aria-busy']='true';field.disabled=true;save.disabled=true;button.disabled=true;notify(form,'data-busy');},saveEnd(){delete form.dataset.busy;delete form.attrs['aria-busy'];field.disabled=false;save.disabled=false;button.disabled=true;form.dispatch('form-busy-changed');notify(form,'data-busy');},
 };
}

test('owner setup validation runs before a stream check and a mode change cancels stale work',async()=>{
 const blocked=fixture();let prepared=0;blocked.window.prepareOwnerStreamSetup=()=>{prepared++;return false;};await blocked.start();assert.equal(prepared,1);assert.equal(blocked.humanCalls.length,0);assert.equal(blocked.apiCalls.length,0);
 const f=fixture(),bot=deferred();f.human(bot.promise);const pending=f.start();await settle();f.form.dispatch('owner-stream-mode-changed');assert.equal(f.humanCalls[0].signal.aborted,true);bot.resolve('stale-token');await pending;assert.equal(f.apiCalls.length,0);assert.equal(f.nodes.get('ownerStreamTestStatus').textContent,'');
});

test('owner stream checking is optional, uses the protected endpoint once and never plays audio',async()=>{
 const f=fixture(),pending=deferred();f.result(pending.promise);const first=f.start(),duplicate=f.start();await settle();
 assert.equal(f.humanCalls.length,1);assert.equal(f.humanCalls[0].container,f.nodes.get('ownerStreamTestHuman'));assert.equal(f.humanCalls[0].action,'stream-check');assert.ok(f.humanCalls[0].signal);assert.equal(f.apiCalls.length,1);assert.equal(f.apiCalls[0].path,'/api/owner/stream-check');assert.equal(f.apiCalls[0].body.stream_url,'https://stream.example.com/live');assert.equal(f.apiCalls[0].body.turnstile_token,'checked-token');assert.equal(f.save.disabled,false);assert.equal(f.field.disabled,false);assert.equal(f.button.textContent,'Checking…');
 pending.resolve({result:'audio_response',audio_response:true,message:'Anything'});await Promise.all([first,duplicate]);assert.equal(f.nodes.get('ownerStreamTestStatus').dataset.state,'success');assert.match(f.nodes.get('ownerStreamTestStatus').textContent,/Playback is not verified/);assert.equal(f.button.disabled,false);assert.equal(f.button.textContent,'Test stream');assert.equal(f.media(),0);
});
test('unsafe and malformed addresses are rejected locally without a security check or request and do not block Save',async()=>{
 for(const value of ['https://','not a url','http://127.0.0.1/live','http://10.0.0.1/live','http://stream.local/live','http://[2001:db8::1]/live','https://user:supersecret123@stream.example.com/live','https://stream.example.com/live?token=supersecret123','https://stream.example.com/live#supersecret123']){
  const f=fixture(value);await f.start();assert.equal(f.humanCalls.length,0,value);assert.equal(f.apiCalls.length,0,value);assert.equal(f.nodes.get('ownerStreamTestStatus').dataset.state,'invalid');assert.doesNotMatch(f.nodes.get('ownerStreamTestStatus').textContent,/supersecret123/);assert.equal(f.focused(),f.field);assert.equal(f.save.disabled,false);
 }
});
test('numeric public IPs and playlist links remain unconfirmed without fetching or preventing Save',async()=>{
 for(const value of ['http://8.8.8.8:8000/live','https://stream.example.com/listen.pls','https://stream.example.com/live.m3u8?sid=1']){
  const f=fixture(value);await f.start();assert.equal(f.humanCalls.length,0);assert.equal(f.apiCalls.length,0);assert.equal(f.nodes.get('ownerStreamTestStatus').dataset.state,'unconfirmed');assert.match(f.nodes.get('ownerStreamTestStatus').textContent,/still save/);assert.equal(f.save.disabled,false);
 }
});
test('editing the address aborts its security check and a late token cannot send the old URL',async()=>{
 const f=fixture(),bot=deferred();f.human(bot.promise);const pending=f.start();await settle();f.input('https://new.example.com/live');assert.equal(f.humanCalls[0].signal.aborted,true);assert.equal(f.button.disabled,false);assert.equal(f.nodes.get('ownerStreamTestStatus').textContent,'');bot.resolve('late-token');await pending;assert.equal(f.apiCalls.length,0);
});
test('late results cannot replace a newer address check or unlock its pending button',async()=>{
 const f=fixture(),old=deferred(),fresh=deferred();f.result(old.promise);const first=f.start();await settle();f.input('https://new.example.com/live');f.result(fresh.promise);const second=f.start();await settle();
 old.resolve({result:'audio_response',audio_response:true});await first;assert.equal(f.button.disabled,true);assert.equal(f.button.textContent,'Checking…');assert.equal(f.nodes.get('ownerStreamTestStatus').dataset.state,'checking');fresh.resolve({result:'not_confirmed',audio_response:false});await second;assert.equal(f.apiCalls.length,2);assert.equal(f.apiCalls[1].body.stream_url,'https://new.example.com/live');assert.equal(f.nodes.get('ownerStreamTestStatus').dataset.state,'unconfirmed');assert.equal(f.button.disabled,false);
});
test('starting Save abandons the optional check while keeping Save ownership and restores Test when Save finishes',async()=>{
 const f=fixture(),bot=deferred();f.human(bot.promise);const pending=f.start();await settle();f.saveStart();assert.equal(f.humanCalls[0].signal.aborted,true);assert.equal(f.save.disabled,true);assert.equal(f.field.disabled,true);assert.equal(f.button.disabled,true);assert.equal(f.button.textContent,'Test stream');assert.equal(f.nodes.get('ownerStreamTestStatus').textContent,'');
 bot.resolve('late-token');await pending;assert.equal(f.apiCalls.length,0);await f.start();assert.equal(f.humanCalls.length,1);f.saveEnd();assert.equal(f.save.disabled,false);assert.equal(f.button.disabled,false);assert.equal(f.button.textContent,'Test stream');
});
test('a sent check finishing during Save cannot replace Save feedback or re-enable controls',async()=>{
 const f=fixture(),response=deferred();f.result(response.promise);const pending=f.start();await settle();assert.equal(f.apiCalls.length,1);f.saveStart();response.resolve({result:'audio_response',audio_response:true});await pending;assert.equal(f.nodes.get('ownerStreamTestStatus').textContent,'');assert.equal(f.button.disabled,true);assert.equal(f.save.disabled,true);f.saveEnd();assert.equal(f.button.disabled,false);
});
test('navigation, form reset and a new station all invalidate old results',async()=>{
 for(const action of ['hide','reset','stationChanged']){
  const f=fixture(),response=deferred();f.result(response.promise);const pending=f.start();await settle();f[action]();await settle();response.resolve({result:'audio_response',audio_response:true});await pending;assert.equal(f.nodes.get('ownerStreamTestStatus').textContent,'',action);assert.equal(f.button.textContent,'Test stream');if(action==='hide'){assert.equal(f.button.disabled,true);f.show();assert.equal(f.button.disabled,false);}if(action==='reset')assert.equal(f.button.disabled,true);
 }
});
test('unconfirmed, malformed and failed checks stay neutral about playback and permit retry',async()=>{
 for(const response of [{result:'not_confirmed',audio_response:false},{result:'audio_response',audio_response:false},{unexpected:true}]){const f=fixture();f.result(response);await f.start();assert.equal(f.nodes.get('ownerStreamTestStatus').dataset.state,'unconfirmed');assert.equal(f.save.disabled,false);assert.equal(f.button.disabled,false);}
 const f=fixture();f.human(Promise.reject(Error('Security check expired. Please try again.')));await f.start();assert.equal(f.apiCalls.length,0);assert.equal(f.nodes.get('ownerStreamTestStatus').dataset.state,'error');assert.equal(f.save.disabled,false);assert.equal(f.button.disabled,false);
});
test('missing URL policy fails closed without network calls',async()=>{
 const f=fixture();delete f.window.parsePublicStreamUrl;await f.start();assert.equal(f.apiCalls.length,0);assert.equal(f.humanCalls.length,0);assert.match(f.nodes.get('ownerStreamTestStatus').textContent,/could not be confirmed/);assert.equal(f.save.disabled,false);
});

test('a current terminal owner result opens one result popup while checking and validation stay inline',async()=>{
 const f=fixture(),pending=deferred(),shown=[];f.window.showStreamTestResult=value=>{shown.push(value);return true;};f.result(pending.promise);const check=f.start();await settle();
 const notice=f.nodes.get('ownerStreamTestStatus');assert.equal(shown.length,0);assert.equal(notice.dataset.state,'checking');assert.equal(notice.hidden,false);
 pending.resolve({result:'audio_response',audio_response:true});await check;assert.equal(shown.length,1);assert.equal(shown[0].source,'owner');assert.equal(shown[0].key,'registration.audioResponse');assert.equal(shown[0].state,'success');assert.match(shown[0].fallback,/Playback is not verified/);assert.equal(notice.hidden,true);assert.equal(f.save.disabled,false);assert.equal(f.button.disabled,false);
 f.input('https://');await f.start();assert.equal(shown.length,1);assert.equal(notice.dataset.state,'invalid');assert.equal(notice.hidden,false);
});

test('immediate numeric IP and playlist results use the owner popup without a network request',async()=>{
 for(const [url,key] of [['http://8.8.8.8:8000/live','registration.ipTestUnavailable'],['https://stream.example.com/live.m3u8','registration.playlistTestUnavailable']]){
  const f=fixture(url),shown=[];f.window.showStreamTestResult=value=>{shown.push(value);return true;};await f.start();assert.equal(shown.length,1);assert.equal(shown[0].source,'owner');assert.equal(shown[0].key,key);assert.equal(shown[0].state,'unconfirmed');assert.equal(f.nodes.get('ownerStreamTestStatus').hidden,true);assert.equal(f.apiCalls.length,0);assert.equal(f.humanCalls.length,0);assert.equal(f.save.disabled,false);
 }
});

test('unconfirmed and failed checks show terminal popups with the existing safe result text',async()=>{
 const neutral=fixture(),shown=[];neutral.window.showStreamTestResult=value=>{shown.push(value);return true;};await neutral.start();assert.equal(shown.length,1);assert.equal(shown[0].key,'registration.notConfirmed');assert.equal(shown[0].state,'unconfirmed');
 const failed=fixture(),errors=[];failed.window.showStreamTestResult=value=>{errors.push(value);return true;};failed.human(Promise.reject(Error('Security check expired. Please try again.')));await failed.start();assert.equal(errors.length,1);assert.equal(errors[0].source,'owner');assert.equal(errors[0].key,'');assert.equal(errors[0].state,'error');assert.match(errors[0].fallback,/Security check expired/);assert.equal(failed.nodes.get('ownerStreamTestStatus').hidden,true);assert.equal(failed.button.disabled,false);
});

test('missing, unavailable or failed popup helper leaves the owner result visible inline',async()=>{
 for(const helper of [undefined,()=>false,()=>{throw Error('Dialog unavailable');}]){
  const f=fixture();f.window.showStreamTestResult=helper;await f.start();const notice=f.nodes.get('ownerStreamTestStatus');assert.equal(notice.hidden,false);assert.equal(notice.dataset.state,'unconfirmed');assert.match(notice.textContent,/still save/);assert.equal(f.button.disabled,false);
 }
});

test('abandoning an owner check closes only its result and a late result cannot open a popup',async()=>{
 for(const action of [f=>f.input('https://new.example.com/live'),f=>f.hide(),f=>f.stationChanged(),f=>f.saveStart(),f=>f.form.dispatch('owner-stream-mode-changed'),f=>f.event('pagehide')]){
  const f=fixture(),pending=deferred(),shown=[],closed=[];f.window.showStreamTestResult=value=>{shown.push(value);return true;};f.window.closeStreamTestResult=source=>closed.push(source);f.result(pending.promise);const check=f.start();await settle();action(f);pending.resolve({result:'audio_response',audio_response:true});await check;assert.equal(shown.length,0);assert.ok(closed.length>=1);assert.ok(closed.every(source=>source==='owner'));assert.equal(f.nodes.get('ownerStreamTestStatus').hidden,false);assert.equal(f.nodes.get('ownerStreamTestStatus').textContent,'');
 }
 const f=fixture(),closed=[];f.window.showStreamTestResult=()=>true;f.window.closeStreamTestResult=source=>closed.push(source);await f.start();assert.equal(f.nodes.get('ownerStreamTestStatus').hidden,true);f.input('https://new.example.com/live');assert.deepEqual(closed,['owner']);assert.equal(f.nodes.get('ownerStreamTestStatus').hidden,false);
});

test('late superseded results cannot open a popup for the new address',async()=>{
 const f=fixture(),old=deferred(),fresh=deferred(),shown=[];f.window.showStreamTestResult=value=>{shown.push(value);return true;};f.result(old.promise);const first=f.start();await settle();f.input('https://new.example.com/live');f.result(fresh.promise);const second=f.start();await settle();old.resolve({result:'audio_response',audio_response:true});await first;assert.equal(shown.length,0);assert.equal(f.nodes.get('ownerStreamTestStatus').dataset.state,'checking');assert.equal(f.button.disabled,true);fresh.resolve({result:'not_confirmed',audio_response:false});await second;assert.equal(shown.length,1);assert.equal(shown[0].state,'unconfirmed');
});

test('language changes update existing inline text without reopening a popup or changing visibility',async()=>{
 for(const displayed of [true,false]){
  const f=fixture(),shown=[];f.window.showStreamTestResult=value=>{shown.push(value);return displayed;};await f.start();f.window.appI18n.t=key=>key==='registration.notConfirmed'?'Translated result':key;f.event('app-language-changed');const notice=f.nodes.get('ownerStreamTestStatus');assert.equal(shown.length,1);assert.equal(notice.textContent,'Translated result');assert.equal(notice.hidden,displayed);
 }
});
