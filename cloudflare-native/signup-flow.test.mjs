import {test} from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import {webcrypto} from 'node:crypto';

const source=readFileSync(new URL('./public/assets/site.js',import.meta.url),'utf8').split('function list(){}')[0];
function deferred(){let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return {promise,resolve,reject};}
function fixture(){
 const nodes=new Map(),calls=[],humans=[],files=[],logoFiles=[],answers=[],ownerLogoFiles=[],ownerInspections=[],revoked=[],windowEvents={};let nextOwnerUrl=0;let humanResult='checked-token',editorResult,editorCalls=0,logoResult=true,clock=1700000000000,nextTimer=0;const timers=new Map();class ClockDate extends Date{static now(){return clock;}}
 function advance(milliseconds){clock+=milliseconds;for(let count=0;count<100;count++){const due=[...timers].find(([,timer])=>timer.at<=clock);if(!due)return;timers.delete(due[0]);due[1].fn();}throw Error('Timer loop');}
 class UiEvent{constructor(type,options={}){this.type=type;this.bubbles=!!options.bubbles;this.defaultPrevented=false;}preventDefault(){this.defaultPrevented=true;}}
 function node(id,tagName='DIV'){
  const listeners={};const element={id,tagName,children:[],elements:{},dataset:{},attrs:{},disabled:false,hidden:false,open:false,textContent:'',value:'',defaultValue:'',files:[],checked:false,type:'text',
   setAttribute(key,value){this.attrs[key]=value;},removeAttribute(key){delete this.attrs[key];if(key==='src')delete this.src;},focus(){document.activeElement=this;},
   addEventListener(type,fn){(listeners[type]??=[]).push(fn);},dispatchEvent(event){for(const fn of listeners[event.type]||[])fn(event);if(event.bubbles&&this.parent)this.parent.dispatchEvent(event);return !event.defaultPrevented;},
   querySelectorAll(selector){const tags=selector.split(',').map(tag=>tag.toUpperCase());return this.children.flatMap(child=>[...(tags.includes(child.tagName)?[child]:[]),...child.querySelectorAll(selector)]);},
   reset(){this.dispatchEvent(new UiEvent('reset'));this.resetCalled=true;for(const field of Object.values(this.elements)){field.value=field.defaultValue;field.checked=false;field.files=[];}},
   showModal(){this.open=true;this.shown=true;},close(){this.open=false;this.closed=true;this.dispatchEvent(new UiEvent('close'));}
  };nodes.set(id,element);return element;
 }
 const document={activeElement:null,hidden:false,getElementById(id){return nodes.get(id)||node(id);},querySelector(selector){if(selector==='dialog[open]')return [...nodes.values()].find(item=>item.tagName==='DIALOG'&&item.open)||null;return null;}};
 function append(parent,child){parent.children.push(child);child.parent=parent;return child;}
 function form(id,fields){const target=node(id,'FORM');for(const [name,value] of Object.entries(fields)){const field=append(target,node(id+'-'+name,'INPUT'));field.name=name;field.value=value;target.elements[name]=field;}target.submit=append(target,node(id+'-submit','BUTTON'));return target;}
 const registration=form('registerForm',{name:'Sample Radio',stream_url:'http://stream.example.com:8000/live',bio:'Sample bio',email:'owner@example.com',artwork:'',rights_confirmed:'on'});registration.elements.artwork.type='file';registration.elements.artwork.files=[{name:'logo.png',size:5}];registration.elements.rights_confirmed.type='checkbox';registration.elements.rights_confirmed.checked=true;
 registration.copy=append(registration,node('copyGeneratedStream','BUTTON'));registration.copy.disabled=true;
 const login=form('loginForm',{email:'owner@example.com',code:'13'}),verification=node('verification','DIALOG'),verifyForm=form('verifyForm',{code:'123456'});append(verification,verifyForm);append(verification,node('resend','BUTTON'));append(verification,node('closeVerify','BUTTON'));
 const edit=form('editForm',{stream_url:'',bio:'',artwork:''});edit.elements.artwork.type='file';Object.defineProperty(edit.elements.artwork,'value',{get(){return this.files[0]?.name||'';},set(value){if(value==='')this.files=[];}});for(const id of ['openLogin','openRegister','navAdd','navLibrary','registerMessage','message','verifyText','verifyMessage','registrationHuman','stationSuccessTitle','stationSuccessText','stationSuccessMessage','retryOwnerEditor'])document.getElementById(id);node('stationSuccess','DIALOG');node('ownerSaveSuccess','DIALOG');for(const id of ['ownerSaveSuccessTitle','ownerSaveSuccessText','ownerSaveSuccessDone','ownerSaveRefreshStatus','ownerSaveRefreshRetry','ownerArtworkMessage'])document.getElementById(id);nodes.get('retryOwnerEditor').hidden=true;
 class FormDataFixture{constructor(target){this.entries=Object.values(target.elements).filter(field=>!field.disabled&&(field.type!=='checkbox'||field.checked)).map(field=>[field.name,field.type==='file'?field.files[0]:field.value]);}[Symbol.iterator](){return this.entries[Symbol.iterator]();}}
 const context=vm.createContext({document,window:{addEventListener(type,fn){windowEvents[type]=fn;}},URL:{createObjectURL(){return 'blob:owner/'+(++nextOwnerUrl);},revokeObjectURL(url){revoked.push(url);}},AbortController,Event:UiEvent,FormData:FormDataFixture,TextEncoder,crypto:webcrypto,Date:ClockDate,setTimeout:(fn,delay)=>{const id=++nextTimer;timers.set(id,{fn,at:clock+delay});return id;},clearTimeout:id=>timers.delete(id),navigator:{onLine:true},history:{replaceState(){}},location:{search:''},
  __api:async(path,body)=>{calls.push({path,body});const answer=answers.shift();if(answer instanceof Error)throw answer;if(answer!==undefined)return await answer;return {verification_id:'new-challenge',verification_email:'o***@example.com'};},
  __human:async(container,action)=>{humans.push({container,action});return await humanResult;},__fileData:async file=>{files.push(file);return file?{name:file.name,base64:'c2FtcGxl'}:undefined;},
  __editor:async()=>{editorCalls++;if(editorResult instanceof Error)throw editorResult;return await editorResult;},__logo:async file=>{logoFiles.push(file);return await logoResult;},__inspectOwner:async file=>{ownerLogoFiles.push(file);return await (ownerInspections.length?ownerInspections.shift():{valid:true});}
 });
 vm.runInContext(source,context);vm.runInContext("const actualEditor=editor,actualHuman=human;state={csrf:'test-csrf',agreement_version:'test-terms',turnstile_site_key:'test-site-key'};api=__api;human=__human;fileData=__fileData;editor=__editor;window.validateRegistrationLogo=__logo;window.inspectStationLogo=__inspectOwner;",context);
 async function submit(target){return target.onsubmit({preventDefault(){},target});}
 return {advance,timers,nodes,document,registration,login,verifyForm,calls,humans,files,logoFiles,ownerLogoFiles,ownerInspections,revoked,pagehide:()=>windowEvents.pagehide?.(),context,submit,answers,verify(result={}){context.result={verification_id:'challenge-a',verification_email:'o***@example.com',...result};vm.runInContext('verify(result)',context);},id(){return vm.runInContext('verificationId',context);},human(value){humanResult=value;},editor(value){editorResult=value;},editorCalls:()=>editorCalls,logo(value){logoResult=value;},event:type=>new UiEvent(type),busy(target,on,fields=false){context.target=target;context.on=on;context.fields=fields;vm.runInContext('busy(target,on,fields)',context);}};
}
async function until(check){for(let i=0;i<100&&!check();i++)await new Promise(resolve=>setImmediate(resolve));assert.ok(check(),'Expected async checkpoint');}

test('busy cycles restore earlier disabled states and optionally freeze fields without losing them',()=>{
 const f=fixture(),form=f.registration;form.elements.email.disabled=true;f.busy(form,true,true);assert.equal(form.dataset.busy,'1');assert.equal(form.submit.disabled,true);assert.equal(form.elements.name.disabled,true);f.busy(form,false);assert.equal(form.copy.disabled,true);assert.equal(form.submit.disabled,false);assert.equal(form.elements.name.disabled,false);assert.equal(form.elements.email.disabled,true);assert.equal(form.dataset.busy,undefined);
});

test('signup snapshots before disabling fields, validates the captured logo, and suppresses duplicate submits',async()=>{
 const f=fixture(),pending=deferred(),original=f.registration.elements.artwork.files[0];f.logo(pending.promise);const first=f.submit(f.registration);await until(()=>f.logoFiles.length===1);assert.equal(f.registration.elements.name.disabled,true);await f.submit(f.registration);assert.equal(f.logoFiles.length,1);pending.resolve(true);await first;assert.equal(f.calls.length,1);assert.equal(f.calls[0].body.name,'Sample Radio');assert.equal(f.calls[0].body.email,'owner@example.com');assert.equal(f.calls[0].body.rights_confirmed,true);assert.equal(f.logoFiles[0],original);assert.equal(f.files[0],original);assert.match(f.calls[0].body.request_id,/^[a-f0-9]{32}$/);assert.equal(f.registration.elements.name.disabled,false);assert.equal(f.nodes.get('verification').open,true);
});

test('unchanged signup retries keep their request id after uncertain failure and changed data gets a new id',async()=>{
 const f=fixture();f.answers.push(new Error('Connection interrupted'));await f.submit(f.registration);assert.equal(f.document.activeElement,f.nodes.get('registerMessage'));assert.equal(f.nodes.get('registerMessage').textContent,'Connection interrupted');const first=f.calls[0].body.request_id;await f.submit(f.registration);assert.equal(f.calls[1].body.request_id,first);f.nodes.get('closeVerify').onclick();f.registration.elements.name.value='Changed Radio';await f.submit(f.registration);assert.notEqual(f.calls[2].body.request_id,first);
});

test('logo validation failure focuses a visible signup error without bot or registration requests',async()=>{
 const f=fixture();f.logo(false);f.registration.elements.artwork.validationMessage='Choose an image under 3 MB.';await f.submit(f.registration);assert.equal(f.calls.length,0);assert.equal(f.humans.length,0);assert.equal(f.registration.submit.disabled,false);assert.equal(f.registration.copy.disabled,true);assert.equal(f.registration.dataset.busy,undefined);assert.equal(f.nodes.get('registerMessage').textContent,'Choose an image under 3 MB.');assert.equal(f.document.activeElement,f.nodes.get('registerMessage'));
});

test('signup waits for a complete session when initial page loading has not finished',async()=>{
 const f=fixture(),pending=deferred();vm.runInContext('state=undefined',f.context);f.answers.push(pending.promise,{verification_id:'ready-challenge',verification_email:'o***@example.com'});const first=f.submit(f.registration);await until(()=>f.calls.length===1);assert.equal(f.calls[0].path,'/api/session');assert.equal(f.humans.length,0);assert.equal(f.registration.elements.name.disabled,true);pending.resolve({csrf:'fresh-csrf',agreement_version:'fresh-terms',turnstile_site_key:'fresh-key'});await first;assert.equal(f.calls[1].path,'/api/owner/register');assert.equal(f.calls[1].body.agreement_version,'fresh-terms');assert.equal(f.calls[1].body.email,'owner@example.com');assert.equal(f.id(),'ready-challenge');
});

test('signup shares an in-flight initial session request instead of racing a second cookie',async()=>{
 const f=fixture(),pending=deferred();vm.runInContext('state=undefined',f.context);f.answers.push(pending.promise,{verification_id:'shared-challenge',verification_email:'o***@example.com'});const initial=vm.runInContext('loadOwnerSession()',f.context),submission=f.submit(f.registration);await until(()=>f.logoFiles.length===1);assert.equal(f.calls.length,1);assert.equal(f.calls[0].path,'/api/session');pending.resolve({csrf:'shared-csrf',agreement_version:'shared-terms',turnstile_site_key:'shared-key'});await Promise.all([initial,submission]);assert.equal(f.calls.filter(call=>call.path==='/api/session').length,1);assert.equal(f.calls[1].body.agreement_version,'shared-terms');assert.equal(f.id(),'shared-challenge');
});

test('a failed session bootstrap can be retried without a stuck form or cached rejection',async()=>{
 const f=fixture();vm.runInContext('state=undefined',f.context);f.answers.push(new Error('Session connection interrupted'));await f.submit(f.registration);assert.equal(f.humans.length,0);assert.equal(f.registration.submit.disabled,false);assert.equal(f.nodes.get('registerMessage').textContent,'Session connection interrupted');f.answers.push({csrf:'retry-csrf',agreement_version:'retry-terms',turnstile_site_key:'retry-key'},{verification_id:'retry-challenge',verification_email:'o***@example.com'});await f.submit(f.registration);assert.equal(f.calls.filter(call=>call.path==='/api/session').length,2);assert.equal(f.calls.at(-1).path,'/api/owner/register');assert.equal(f.id(),'retry-challenge');
});

test('login initializes a missing session and incomplete setup fails before a bot challenge',async()=>{
 const f=fixture();vm.runInContext('state=undefined',f.context);f.answers.push({csrf:'fresh-csrf',agreement_version:'fresh-terms',turnstile_site_key:'fresh-key'},{verification_id:'login-challenge',verification_email:'o***@example.com'});await f.submit(f.login);assert.equal(f.calls[0].path,'/api/session');assert.equal(f.calls[1].path,'/api/owner/login');assert.equal(f.id(),'login-challenge');const incomplete=fixture();vm.runInContext('state=undefined',incomplete.context);incomplete.answers.push({csrf:'only-csrf'});await incomplete.submit(incomplete.registration);assert.equal(incomplete.calls.length,1);assert.equal(incomplete.humans.length,0);assert.match(incomplete.nodes.get('registerMessage').textContent,/setup is not ready/);assert.equal(incomplete.registration.submit.disabled,false);
});

test('shared security checks wait for the same in-flight session before creating widgets',async()=>{
 const f=fixture(),pending=deferred(),renders=[];vm.runInContext('state=undefined',f.context);f.answers.push(pending.promise);
 f.context.humanArea={querySelector:()=>({replaceChildren(){}})};f.context.window.turnstile={render(area,options){renders.push(options);queueMicrotask(()=>options.callback('checked-'+options.action));return options.action;},remove(){}};
 const initial=vm.runInContext('loadOwnerSession()',f.context),support=vm.runInContext("actualHuman(humanArea,'support-ticket')",f.context),radio=vm.runInContext("actualHuman(humanArea,'radio-link')",f.context);
 await until(()=>f.calls.length===1);assert.equal(f.calls[0].path,'/api/session');assert.equal(renders.length,0);
 pending.resolve({csrf:'fresh-csrf',agreement_version:'fresh-terms',turnstile_site_key:'fresh-key'});const results=await Promise.all([initial,support,radio]);assert.equal(results[1],'checked-support-ticket');assert.equal(results[2],'checked-radio-link');assert.equal(f.calls.length,1);assert.equal(renders.length,2);assert.ok(renders.every(options=>options.sitekey==='fresh-key'));
});

test('shared security checks recover after session failure and incomplete setup stays blocked',async()=>{
 const f=fixture(),renders=[];vm.runInContext('state=undefined',f.context);f.context.humanArea={querySelector:()=>({replaceChildren(){}})};f.context.window.turnstile={render(area,options){renders.push(options);queueMicrotask(()=>options.callback('checked-token'));return 'widget';},remove(){}};
 f.answers.push(Error('Session connection interrupted'));await assert.rejects(vm.runInContext("actualHuman(humanArea,'support-ticket')",f.context),/Session connection interrupted/);assert.equal(renders.length,0);
 f.answers.push({csrf:'only-csrf'});await assert.rejects(vm.runInContext("actualHuman(humanArea,'radio-link')",f.context),/Website setup is not ready/);assert.equal(renders.length,0);
 f.answers.push({csrf:'retry-csrf',agreement_version:'fresh-terms',turnstile_site_key:'retry-key'});assert.equal(await vm.runInContext("actualHuman(humanArea,'support-ticket')",f.context),'checked-token');assert.equal(renders.length,1);assert.equal(renders[0].sitekey,'retry-key');assert.equal(f.calls.length,3);
});

test('login suppresses duplicate in-flight requests',async()=>{
 const f=fixture(),pending=deferred();f.human(pending.promise);const first=f.submit(f.login);await until(()=>f.humans.length===1);await f.submit(f.login);assert.equal(f.humans.length,1);pending.resolve('checked-token');await first;assert.equal(f.calls.length,1);assert.equal(f.calls[0].path,'/api/owner/login');
});

test('leaving signup or sign-in during the security check does not send a request or reopen verification',async()=>{
 for(const target of ['registration','login']){const f=fixture(),pending=deferred();f.human(pending.promise);const submitting=f.submit(f[target]);await until(()=>f.humans.length===1);vm.runInContext("page('myRadio')",f.context);pending.resolve('checked-token');await submitting;assert.equal(f.calls.length,0);assert.equal(f.nodes.get('verification').open,false);assert.equal(f[target].submit.disabled,false);assert.equal(f.nodes.get('myRadio').hidden,false);}
});

test('late signup and sign-in acknowledgements do not open a code dialog over another page',async()=>{
 for(const target of ['registration','login']){const f=fixture(),pending=deferred();f.answers.push(pending.promise);const submitting=f.submit(f[target]);await until(()=>f.calls.length===1);vm.runInContext("page('support')",f.context);pending.resolve({verification_id:'late-challenge',verification_email:'o***@example.com'});await submitting;assert.equal(f.nodes.get('verification').open,false);assert.equal(f.nodes.get('support').hidden,false);assert.equal(f.nodes.get('message').textContent,'');}
});

test('successful verification remains visibly successful when the editor fails, with a working retry',async()=>{
 const f=fixture();f.verify();f.editor(new Error('Editor network timeout'));f.answers.push({registration_completed:true,review_required:false,station_code:'13'});await f.submit(f.verifyForm);assert.equal(f.nodes.get('verification').open,false);assert.equal(f.registration.resetCalled,true);assert.equal(f.nodes.get('stationSuccess').open,true);assert.equal(f.nodes.get('stationSuccessTitle').textContent,'Station added');assert.equal(f.nodes.get('stationSuccessText').textContent,'Station code #13.');assert.equal(f.nodes.get('verifyMessage').textContent,'');assert.equal(f.nodes.get('retryOwnerEditor').hidden,false);assert.match(f.nodes.get('stationSuccessMessage').textContent,/verification succeeded/);f.editor(undefined);await f.nodes.get('retryOwnerEditor').onclick();assert.equal(f.editorCalls(),2);assert.equal(f.nodes.get('stationSuccess').open,false);
});

test('signing back into the same station preserves unsaved text, artwork and its preview',async()=>{
 const f=fixture(),form=f.nodes.get('editForm'),cover={name:'draft-cover.png',size:5},previews=[];form.dataset.stationCode='13';form.dataset.dirty='1';form.elements.stream_url.value='https://unsaved.example/live';form.elements.bio.value='Unsaved station bio';form.elements.artwork.files=[cover];f.context.showOwnerCover=url=>previews.push(url);vm.runInContext('editor=actualEditor',f.context);f.verify();
 f.answers.push({registration_completed:false,station_code:'13',message:'Signed in.'},{station:{code:'13',name:'Saved station',status:'published',stream_url:'https://saved.example/live',bio:'Saved bio',artwork_url:'/api/owner/artwork'}});await f.submit(f.verifyForm);
 assert.equal(form.elements.stream_url.value,'https://unsaved.example/live');assert.equal(form.elements.bio.value,'Unsaved station bio');assert.equal(form.elements.artwork.files[0],cover);assert.equal(form.dataset.dirty,'1');assert.equal(previews.length,0);assert.equal(f.nodes.get('editor').hidden,false);
});

test('a different station login or a new registration cannot inherit an old station draft',async()=>{
 for(const registration of [false,true]){const f=fixture(),form=f.nodes.get('editForm'),previews=[];form.dataset.stationCode='13';form.dataset.dirty='1';form.elements.stream_url.value='https://unsaved.example/live';form.elements.bio.value='Private old draft';form.elements.artwork.files=[{name:'old-cover.png',size:5}];f.context.showOwnerCover=url=>previews.push(url);vm.runInContext('editor=actualEditor',f.context);f.verify();const code=registration?'13':'14';
  f.answers.push({registration_completed:registration,station_code:code,review_required:false,message:'Signed in.'},{station:{code,name:'Fresh station',status:'published',stream_url:'https://new.example/live',bio:'New bio',artwork_url:'/api/owner/artwork'}});await f.submit(f.verifyForm);
  assert.equal(form.elements.stream_url.value,'https://new.example/live');assert.equal(form.elements.bio.value,'New bio');assert.equal(form.elements.artwork.files.length,0);assert.equal(form.dataset.dirty,undefined);assert.equal(form.dataset.stationCode,code);assert.deepEqual(previews,['/api/owner/artwork']);
 }
});

test('retrying an unavailable editor after re-sign-in still preserves the same station draft',async()=>{
 const f=fixture(),form=f.nodes.get('editForm'),cover={name:'draft-cover.png',size:5};form.dataset.stationCode='13';form.dataset.dirty='1';form.elements.stream_url.value='https://draft.example/live';form.elements.bio.value='Keep this text';form.elements.artwork.files=[cover];f.context.showOwnerCover=()=>assert.fail('A saved cover must not replace the draft preview');vm.runInContext('editor=actualEditor',f.context);f.verify();
 f.answers.push({registration_completed:false,station_code:'13',message:'Signed in.'},Error('Editor unavailable'));await f.submit(f.verifyForm);assert.equal(f.nodes.get('retryOwnerEditor').hidden,false);
 f.answers.push({station:{code:'13',name:'Saved station',status:'published',stream_url:'https://saved.example/live',bio:'Saved bio',artwork_url:'/api/owner/artwork'}});await f.nodes.get('retryOwnerEditor').onclick();assert.equal(form.elements.stream_url.value,'https://draft.example/live');assert.equal(form.elements.bio.value,'Keep this text');assert.equal(form.elements.artwork.files[0],cover);assert.equal(form.dataset.dirty,'1');
});

test('signing back into an unchanged editor refreshes saved details rather than retaining stale values',async()=>{
 const f=fixture(),form=f.nodes.get('editForm');form.dataset.stationCode='13';form.elements.stream_url.value='https://old.example/live';form.elements.bio.value='Previously saved bio';f.context.showOwnerCover=()=>{};vm.runInContext('editor=actualEditor',f.context);f.verify();
 f.answers.push({registration_completed:false,station_code:'13',message:'Signed in.'},{station:{code:'13',name:'Saved station',status:'published',stream_url:'https://latest.example/live',bio:'Latest saved bio',artwork_url:'/api/owner/artwork'}});await f.submit(f.verifyForm);assert.equal(form.elements.stream_url.value,'https://latest.example/live');assert.equal(form.elements.bio.value,'Latest saved bio');assert.equal(form.dataset.dirty,undefined);
});

test('verification and resend share one lock, preventing double requests and accidental close',async()=>{
 const f=fixture(),pending=deferred();f.verify();f.answers.push(pending.promise);const first=f.submit(f.verifyForm);await until(()=>f.calls.length===1);await f.submit(f.verifyForm);await f.nodes.get('resend').onclick();f.nodes.get('closeVerify').onclick();const cancel=f.event('cancel');f.nodes.get('verification').dispatchEvent(cancel);assert.equal(cancel.defaultPrevented,true);assert.equal(f.nodes.get('verification').open,true);assert.equal(f.nodes.get('resend').disabled,true);assert.equal(f.calls.length,1);pending.reject(new Error('Incorrect code'));await first;assert.equal(f.nodes.get('verifyMessage').textContent,'Incorrect code');assert.equal(f.nodes.get('resend').disabled,true);assert.equal(f.verifyForm.submit.disabled,false);
});

test('an older resend response cannot replace a newer challenge or its controls',async()=>{
 const f=fixture(),pending=deferred();f.verify();f.advance(60000);f.answers.push(pending.promise);const first=f.nodes.get('resend').onclick();await until(()=>f.calls.length===1);assert.equal(f.calls[0].body.verification_id,'challenge-a');f.verify({verification_id:'challenge-b'});pending.resolve({verification_id:'stale-resend'});await first;assert.equal(f.id(),'challenge-b');assert.equal(f.nodes.get('verifyMessage').textContent,'');assert.equal(f.nodes.get('resend').disabled,true);assert.equal(f.nodes.get('verification').open,true);
});
test('a late Add Station session response cannot reopen its route after leaving',async()=>{
 const f=fixture(),pending=deferred();f.answers.push(pending.promise);const opening=f.nodes.get('navAdd').onclick();await until(()=>f.calls.length===1);vm.runInContext("page('myRadio')",f.context);pending.resolve({csrf:'fresh',owner_station:'13'});await opening;assert.equal(f.nodes.get('myRadio').hidden,false);assert.equal(f.nodes.get('login').hidden,true);assert.equal(f.editorCalls(),0);
});
test('an editor response cannot overwrite another page or its draft after navigation',async()=>{
 const f=fixture(),pending=deferred();f.context.showOwnerCover=()=>{};vm.runInContext('editor=actualEditor',f.context);f.answers.push({csrf:'fresh',owner_station:'13'},pending.promise);const opening=f.nodes.get('navAdd').onclick();await until(()=>f.calls.length===2);vm.runInContext("page('myRadio')",f.context);pending.resolve({station:{code:'13',name:'Old owner station',status:'published',bio:'Old bio',stream_url:'https://old.example/live'}});await opening;assert.equal(f.nodes.get('myRadio').hidden,false);assert.equal(f.nodes.get('editor').hidden,true);assert.equal(f.document.getElementById('ownerName').textContent,'');assert.equal(f.nodes.get('editForm').elements.bio.value,'');
});
test('a late owner session read cannot restore ownership after logout',async()=>{
 const f=fixture(),pending=deferred();f.answers.push(pending.promise,{});const opening=f.nodes.get('navAdd').onclick();await until(()=>f.calls.length===1);await f.document.getElementById('logout').onclick();pending.resolve({csrf:'old',owner_station:'13'});await opening;assert.equal(vm.runInContext('state.owner_station',f.context),null);assert.equal(f.nodes.get('login').hidden,false);assert.equal(f.editorCalls(),0);
});
test('a stale owner-route error cannot overwrite a different page message',async()=>{
 const f=fixture(),pending=deferred();f.answers.push(pending.promise);const opening=f.nodes.get('navAdd').onclick();await until(()=>f.calls.length===1);vm.runInContext("page('myRadio')",f.context);pending.reject(Error('Old sign-in error'));await opening;assert.equal(f.nodes.get('message').textContent,'');
});
test('an old session read cannot replace a newly verified station owner',async()=>{
 const f=fixture(),pending=deferred();f.answers.push(pending.promise);const opening=f.nodes.get('navAdd').onclick();await until(()=>f.calls.length===1);vm.runInContext("page('login')",f.context);f.verify();f.answers.push({registration_completed:false,station_code:'14',message:'Signed in.'});await f.submit(f.verifyForm);pending.resolve({csrf:'old',owner_station:'13'});await opening;assert.equal(vm.runInContext('state.owner_station',f.context),'14');
});
test('a station save finishing after navigation does not open an editor or change that page message',async()=>{
 const f=fixture(),pending=deferred(),form=f.nodes.get('editForm');f.answers.push(pending.promise);vm.runInContext("page('editor')",f.context);const saving=f.submit(form);await until(()=>f.calls.length===1);vm.runInContext("page('myRadio')",f.context);pending.resolve({message:'Saved.'});await saving;assert.equal(f.editorCalls(),0);assert.equal(f.nodes.get('myRadio').hidden,false);assert.equal(f.nodes.get('message').textContent,'');
});

test('a station save freezes its captured fields and ignores a second submission until it finishes',async()=>{
 const f=fixture(),pending=deferred(),form=f.nodes.get('editForm');form.elements.stream_url.value='https://saved.example/live';form.elements.bio.value='Captured bio';form.elements.artwork.files=[{name:'new-cover.png',size:5}];f.answers.push(pending.promise);vm.runInContext("page('editor')",f.context);
 const saving=f.submit(form);await until(()=>f.calls.length===1);assert.equal(form.elements.stream_url.disabled,true);assert.equal(form.elements.bio.disabled,true);assert.equal(form.elements.artwork.disabled,true);await f.submit(form);assert.equal(f.calls.length,1);assert.equal(f.calls[0].body.stream_url,'https://saved.example/live');assert.equal(f.calls[0].body.bio,'Captured bio');assert.equal(f.files[0].name,'new-cover.png');pending.resolve({message:'Saved.'});await saving;assert.equal(f.editorCalls(),1);assert.equal(form.elements.stream_url.disabled,false);assert.equal(form.submit.disabled,false);
});

test('a failed station save keeps its draft and chosen cover available for retry',async()=>{
 const f=fixture(),form=f.nodes.get('editForm'),cover={name:'retry.png',size:5};form.elements.stream_url.value='https://retry.example/live';form.elements.bio.value='Keep this draft';form.elements.artwork.files=[cover];f.answers.push(Error('Save connection interrupted'));vm.runInContext("page('editor')",f.context);await f.submit(form);assert.equal(f.editorCalls(),0);assert.equal(form.elements.stream_url.value,'https://retry.example/live');assert.equal(form.elements.bio.value,'Keep this draft');assert.equal(form.elements.artwork.files[0],cover);assert.equal(form.elements.bio.disabled,false);assert.equal(form.submit.disabled,false);assert.equal(f.nodes.get('message').textContent,'Save connection interrupted');
});


test('email resend countdown blocks repeated requests, starts again for a new code and clears on close',async()=>{
 const f=fixture();f.verify();const button=f.nodes.get('resend');assert.equal(button.disabled,true);assert.equal(button.textContent,'Resend in 60 seconds');await button.onclick();assert.equal(f.humans.length,0);assert.equal(f.calls.length,0);
 f.advance(1000);assert.equal(button.textContent,'Resend in 59 seconds');f.advance(59000);assert.equal(button.disabled,false);assert.equal(button.textContent,'Resend email');assert.equal(f.timers.size,0);
 f.answers.push({verification_id:'challenge-new'});await button.onclick();assert.equal(f.id(),'challenge-new');assert.equal(f.calls[0].path,'/api/owner/resend');assert.equal(button.disabled,true);assert.equal(button.textContent,'Resend in 60 seconds');assert.match(f.nodes.get('verifyMessage').textContent,/newest email code/);assert.equal(f.verifyForm.elements.code.value,'');
 f.nodes.get('closeVerify').onclick();assert.equal(f.timers.size,0);assert.equal(button.textContent,'Resend email');f.advance(60000);assert.equal(f.timers.size,0);assert.equal(f.nodes.get('verification').open,false);
});

test('failed resend leaves verification available and can be retried without replacing the challenge',async()=>{
 const f=fixture();f.verify();f.advance(60000);f.answers.push(Error('Could not connect. Please try again.'));await f.nodes.get('resend').onclick();assert.equal(f.id(),'challenge-a');assert.equal(f.nodes.get('resend').disabled,false);assert.match(f.nodes.get('verifyMessage').textContent,/Could not connect/);assert.equal(f.verifyForm.submit.disabled,false);
});

test('resend countdown rerenders through the selected language and ignores an older timer',()=>{
 const f=fixture();f.verify();const oldTimer=[...f.timers.values()][0].fn;f.context.window.appI18n={t:(key,params)=>key==='verification.resendCountdown'?'Voye ankò nan '+params.seconds+' segonn':'Voye imèl la ankò'};vm.runInContext('renderVerificationResend()',f.context);assert.equal(f.nodes.get('resend').textContent,'Voye ankò nan 60 segonn');f.verify({verification_id:'challenge-next'});assert.equal(f.timers.size,1);oldTimer();assert.equal(f.timers.size,1);f.advance(60000);assert.equal(f.nodes.get('resend').textContent,'Voye imèl la ankò');
});


test('a saved station opens a focused confirmation and preserves safety-review wording',async()=>{
 for(const text of ['Changes saved successfully.','Changes saved for safety review.']){const f=fixture(),form=f.nodes.get('editForm');vm.runInContext("page('editor')",f.context);f.answers.push({message:text});await f.submit(form);assert.equal(f.nodes.get('ownerSaveSuccess').open,true);assert.equal(f.nodes.get('ownerSaveSuccessText').textContent,text);assert.equal(f.document.activeElement,f.nodes.get('ownerSaveSuccessDone'));assert.equal(f.nodes.get('message').textContent,'');f.nodes.get('ownerSaveSuccessDone').onclick();assert.equal(f.nodes.get('ownerSaveSuccess').open,false);}
});

test('save confirmation does not interrupt a background tab or another active dialog',async()=>{
 for(const condition of ['background','dialog']){const f=fixture(),form=f.nodes.get('editForm');vm.runInContext("page('editor')",f.context);if(condition==='background')f.document.hidden=true;else f.nodes.get('verification').showModal();f.answers.push({message:'Changes saved for safety review.'});await f.submit(form);assert.equal(f.nodes.get('ownerSaveSuccess').open,false);assert.equal(f.nodes.get('message').textContent,'Changes saved for safety review.');if(condition==='dialog')assert.equal(f.nodes.get('verification').open,true);}
});

test('a station save whose editor refresh is superseded does not show a confirmation',async()=>{
 const f=fixture(),form=f.nodes.get('editForm');vm.runInContext("page('editor')",f.context);f.editor(false);f.answers.push({message:'Changes saved successfully.'});await f.submit(form);assert.equal(f.nodes.get('ownerSaveSuccess').open,false);assert.equal(f.nodes.get('message').textContent,'');
});


test('leaving email verification during a pending request closes and invalidates the challenge',async()=>{
 const f=fixture(),pending=deferred();vm.runInContext("page('login')",f.context);f.verify();f.answers.push(pending.promise);const verifying=f.submit(f.verifyForm);await until(()=>f.calls.length===1);vm.runInContext("page('myRadio')",f.context);assert.equal(f.nodes.get('verification').open,false);assert.equal(f.id(),null);assert.equal(f.verifyForm.submit.disabled,false);pending.resolve({registration_completed:true,station_code:'13',message:'Verified.'});await verifying;assert.equal(f.editorCalls(),0);assert.equal(f.nodes.get('stationSuccess').open,false);assert.equal(f.nodes.get('myRadio').hidden,false);assert.equal(f.registration.resetCalled,undefined);assert.equal(f.nodes.get('message').textContent,'');
});

test('verification editor refresh cannot reopen another page or show a late failure popup',async()=>{
 for(const failed of [false,true]){const f=fixture(),pending=deferred();vm.runInContext("page('login');editor=actualEditor",f.context);f.verify();f.answers.push({registration_completed:false,station_code:'13',message:'Signed in.'},pending.promise);const verifying=f.submit(f.verifyForm);await until(()=>f.calls.length===2);vm.runInContext("page('support')",f.context);if(failed)pending.reject(Error('Late editor timeout'));else pending.resolve({station:{code:'13',name:'Saved station',status:'published',stream_url:'https://stream.example/live',bio:'Saved bio',artwork_url:''}});await verifying;assert.equal(f.nodes.get('support').hidden,false);assert.equal(f.nodes.get('editor').hidden,true);assert.equal(f.nodes.get('stationSuccess').open,false);assert.equal(f.nodes.get('message').textContent,'');}
});

test('a confirmed save stays successful when its editor refresh fails and retry never repeats the write',async()=>{
 const f=fixture(),form=f.nodes.get('editForm');vm.runInContext("page('editor')",f.context);form.dataset.dirty='1';form.elements.artwork.files=[{name:'cover.png',size:5}];f.answers.push({message:'Changes saved for safety review.'});f.editor(Error('Editor refresh timed out'));await f.submit(form);assert.equal(f.nodes.get('ownerSaveSuccess').open,true);assert.match(f.nodes.get('ownerSaveSuccessText').textContent,/Changes saved for safety review/);assert.match(f.nodes.get('ownerSaveSuccessText').textContent,/could not refresh/);assert.equal(f.nodes.get('ownerSaveRefreshRetry').hidden,false);assert.equal(f.nodes.get('ownerSaveRefreshStatus').hidden,false);assert.equal(f.nodes.get('message').textContent,'');assert.equal(form.dataset.dirty,undefined);assert.equal(form.elements.artwork.files.length,0);f.nodes.get('ownerSaveSuccessDone').onclick();f.editor(undefined);await f.nodes.get('ownerSaveRefreshRetry').onclick();assert.equal(f.nodes.get('ownerSaveRefreshRetry').hidden,true);assert.equal(f.calls.length,1);assert.equal(f.editorCalls(),2);assert.equal(form.submit.disabled,false);
});

test('an accepted save refresh that fails after navigation cannot alter the new page',async()=>{
 const f=fixture(),form=f.nodes.get('editForm'),pending=deferred();vm.runInContext("page('editor');editor=actualEditor",f.context);f.answers.push({message:'Changes saved successfully.'},pending.promise);const saving=f.submit(form);await until(()=>f.calls.length===2);vm.runInContext("page('support')",f.context);pending.reject(Error('Late refresh failure'));await saving;assert.equal(f.nodes.get('support').hidden,false);assert.equal(f.nodes.get('ownerSaveSuccess').open,false);assert.equal(f.nodes.get('message').textContent,'');assert.equal(form.submit.disabled,false);
});

test('owner artwork is inspected before uploading and invalid replacement keeps saved cover',async()=>{
 const f=fixture(),form=f.nodes.get('editForm'),input=form.elements.artwork;vm.runInContext("page('editor');showOwnerCover('/artwork/saved.png')",f.context);const invalid={name:'wrong.png',size:4};input.files=[invalid];f.ownerInspections.push({valid:false,key:'registration.logoDecode',message:'This image could not be opened. Choose another image.'});await input.onchange({target:input});assert.equal(input.files.length,0);assert.equal(f.nodes.get('ownerCover').src,'/artwork/saved.png');assert.equal(f.nodes.get('ownerArtworkMessage').hidden,false);assert.match(f.nodes.get('ownerArtworkMessage').textContent,/could not be opened/);assert.equal(f.calls.length,0);input.files=[invalid];f.ownerInspections.push({valid:false,key:'registration.logoFormat',message:'Choose a PNG, JPG or WebP image with a matching filename.'});await f.submit(form);assert.equal(f.calls.length,0);assert.equal(f.files.length,0);assert.equal(f.document.activeElement,f.nodes.get('ownerArtworkMessage'));assert.equal(form.submit.disabled,false);
});

test('owner replacement inspection ignores stale selections and releases preview URLs',async()=>{
 const f=fixture(),form=f.nodes.get('editForm'),input=form.elements.artwork,first=deferred(),second=deferred(),oldFile={name:'old.png',size:5},newFile={name:'new.png',size:5};vm.runInContext("showOwnerCover('/artwork/saved.png')",f.context);f.ownerInspections.push(first.promise,second.promise);input.files=[oldFile];const oldPreview=input.onchange({target:input});input.files=[newFile];const newPreview=input.onchange({target:input});second.resolve({valid:true});await newPreview;const preview=f.nodes.get('ownerCover').src;assert.match(preview,/^blob:owner/);first.resolve({valid:false,key:'registration.logoDecode',message:'Old image failed'});await oldPreview;assert.equal(input.files[0],newFile);assert.equal(f.nodes.get('ownerCover').src,preview);assert.equal(f.nodes.get('ownerArtworkMessage').hidden,true);vm.runInContext("showOwnerCover('/artwork/latest.png')",f.context);assert.ok(f.revoked.includes(preview));assert.equal(f.nodes.get('ownerCover').src,'/artwork/latest.png');
});

test('leaving the document releases owner preview and invalidates pending image callbacks',async()=>{
 const f=fixture(),input=f.nodes.get('editForm').elements.artwork;input.files=[{name:'preview.png',size:5}];await input.onchange({target:input});const preview=f.nodes.get('ownerCover').src;f.pagehide();assert.ok(f.revoked.includes(preview));const pending=deferred();f.ownerInspections.push(pending.promise);input.files=[{name:'pending.png',size:5}];const inspecting=input.onchange({target:input});f.pagehide();pending.resolve({valid:true});await inspecting;assert.notEqual(f.nodes.get('ownerCover').src,'blob:owner/2');
});


test('leaving while replacement bytes are prepared prevents a stale owner write',async()=>{
 const f=fixture(),form=f.nodes.get('editForm'),pending=deferred();vm.runInContext("page('editor')",f.context);form.elements.artwork.files=[{name:'cover.png',size:5}];f.context.fileData=async()=>pending.promise;const saving=f.submit(form);await until(()=>f.ownerLogoFiles.length===1);vm.runInContext("page('support')",f.context);pending.resolve({name:'cover.png',base64:'sample'});await saving;assert.equal(f.calls.length,0);assert.equal(f.nodes.get('support').hidden,false);assert.equal(form.submit.disabled,false);
});
