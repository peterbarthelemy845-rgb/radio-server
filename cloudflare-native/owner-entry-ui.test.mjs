import {test} from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import {webcrypto} from 'node:crypto';
import {metadataOptions} from './station-metadata.mjs';

const source=readFileSync(new URL('./public/assets/site.js',import.meta.url),'utf8');
const between=(start,end)=>source.slice(source.indexOf(start),source.indexOf(end));
function deferred(){let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return {promise,resolve,reject};}
async function settle(){for(let i=0;i<8;i++)await new Promise(resolve=>setImmediate(resolve));}
function fixture({sdkReady=true}={}){
 const nodes=new Map(),widgets=[],removed=[],scripts=[],calls=[],verified=[],answers=[],timers=new Map(),windowEvents=new Map();let clock=0,focused;
 function node(id,tagName='DIV'){
  const handlers=new Map();
  const value={id,tagName,dataset:{},attrs:{},disabled:false,hidden:true,open:false,textContent:'',value:'',type:tagName==='BUTTON'?'submit':'text',elements:{},fields:[],buttons:[],children:[],append(child){this.children.push(child);},
   focus(){focused=this;},getAttribute(key){return Object.hasOwn(this.attrs,key)?this.attrs[key]:null;},setAttribute(key,val){this.attrs[key]=val;},removeAttribute(key){delete this.attrs[key];},
   querySelectorAll(selector){return selector.includes('input')?[...this.fields,...this.buttons]:this.buttons;},querySelector(selector){if(selector==='span')return this.children.find(child=>child.tagName==='SPAN')||null;return selector==='.human'?this.area:this.buttons[0];},
   replaceChildren(){this.emptied=true;},addEventListener(type,fn){const events=handlers.get(type)||[];events.push(fn);handlers.set(type,events);},dispatchEvent(event){for(const fn of handlers.get(event.type)||[])fn(event);},remove(){this.removed=true;},
  };nodes.set(id,value);return value;
 }
 const get=id=>nodes.get(id)||node(id);
 for(const id of ['message','registerMessage','loginMessage','login','register','verification','deleteVerification'])get(id);get('login').hidden=false;
 for(const id of ['loginForm','registerForm']){const form=node(id,'FORM');form.hidden=false;form.area=node(id+'Human');const submit=node(id+'Submit','BUTTON');submit.textContent=id==='loginForm'?'Log in to edit station':'Save Station';form.buttons=[submit];for(const [name,value] of Object.entries(id==='loginForm'?{email:'owner@example.com',code:'13'}:{name:'Test station',email:'owner@example.com',stream_url:'https://example.com/live',bio:'My programme'})){const field=node(id+name,'INPUT');field.value=value;form.elements[name]=field;form.fields.push(field);}form.elements.rights_confirmed={checked:true};form.elements.artwork={files:[{name:'logo.png',size:10}],validationMessage:''};}
 const registrationHuman=get('registrationHuman');registrationHuman.area=node('registrationHumanArea');
 const sdk={render(area,options){const widget={id:'widget-'+(widgets.length+1),area,options};widgets.push(widget);return widget.id;},remove(id){removed.push(id);}};
 const document={hidden:false,getElementById:get,addEventListener(){},createElement(tag){return node('element-'+nodes.size,tag.toUpperCase());},head:{append(script){scripts.push(script);}}};
 const window={addEventListener(type,fn){const events=windowEvents.get(type)||[];events.push(fn);windowEvents.set(type,events);},dispatchEvent(event){for(const fn of windowEvents.get(event.type)||[])fn(event);},appI18n:{t:key=>key},prepareRegistrationStream:()=>true,registrationStreamSaveAllowed:()=>true};if(sdkReady)window.turnstile=sdk;
 const context=vm.createContext({document,window,ownerText:(key,fallback)=>fallback,$:get,state:{csrf:'fixture-csrf',agreement_version:'fixture-terms',turnstile_site_key:'fixture-site-key'},verificationId:null,humanLoading:undefined,sitePageGeneration:1,AbortController,Promise,Event:class{},TextEncoder,Uint8Array,
  MutationObserver:class{observe(){}},setTimeout(fn,ms){const id=++clock;timers.set(id,{fn,ms});return id;},clearTimeout(id){timers.delete(id);},
  FormData:class{constructor(form){this.entries=Object.entries(form.elements).filter(([,field])=>typeof field.value==='string'&&!field.disabled).map(([key,field])=>[key,field.value]);}*[Symbol.iterator](){yield* this.entries;}},
  ensureOwnerSession:async()=>{},fileData:async file=>({name:file.name,base64:'fixture'}),registrationRequest:async(data,current)=>current()?'fixture-request':'',
  api:async(path,body)=>{calls.push({path,body});const answer=answers.shift();if(answer instanceof Error)throw answer;return answer===undefined?{verification_id:'fixture-verification'}:await answer;},verify:result=>verified.push(result),
 });
 vm.runInContext(between('const formBusyStates=','function loadHuman()'),context);
 vm.runInContext(between('function loadHuman()','async function fileData('),context);
 vm.runInContext(between('let verificationGeneration=','function renderVerificationResend('),context);
 vm.runInContext(between('function registrationMessage(','function loadOwnerSession('),context);
 vm.runInContext(between('function page(','async function api('),context);
 vm.runInContext(between("$('registerForm').onsubmit=async event=>", "$('verifyForm').onsubmit=async event=>"),context);
 vm.runInContext(readFileSync(new URL('./public/assets/owner-navigation-state.js',import.meta.url),'utf8'),context);
 const submit=id=>get(id).onsubmit({target:get(id),preventDefault(){}});
 return {get,nodes,widgets,removed,scripts,calls,verified,answers,context,sdk,timers,focused:()=>focused,submit,page:id=>context.page(id),busy:id=>context.formIsBusy(get(id)),loadSdk(){window.turnstile=sdk;scripts[0].onload();}};
}

function ownerNavigationFixture({owner=null,session=Promise.resolve(),feature=Promise.resolve()}={}){
 const f=fixture(),events=[],history=[];f.context.window.loadAppFeature=async name=>{events.push(['feature',name]);await feature;};f.context.history={replaceState(_state,_title,url){history.push(url);}};
 f.context.loadOwnerSession=async()=>{events.push(['session']);await session;const snapshot={owner_station:owner,owner_expires:owner?2000:null,server_time:1000};Object.assign(f.context.state,snapshot);f.context.window.dispatchEvent({type:'owner-session-updated',detail:snapshot});};f.context.editor=async(preserve,generation)=>{events.push(['editor',preserve,generation]);f.page('editor');};
 vm.runInContext(between("$('openLogin').onclick=", ";$('navAdd').onclick="),f.context);
 vm.runInContext(between("$('navAdd').onclick=async()=>", ";$('navLibrary').onclick="),f.context);
 vm.runInContext(between('function ownerAccountUnavailable()','async function ensureOwnerSession()'),f.context);
 return {...f,navigation:events,history,open:()=>f.get('navAdd').onclick()};
}

test('registration submit fails closed without a successful current stream check even when invoked directly',async()=>{
 for(const reason of ['missing check','missing preparation','false']){
  const f=fixture(),guardCalls=[];f.page('register');f.get('registerForm').buttons[0].disabled=true;
  if(reason==='missing check')delete f.context.window.registrationStreamSaveAllowed;
  else f.context.window.registrationStreamSaveAllowed=report=>{guardCalls.push(report);return false;};
  let prepared=0,logos=0,sessions=0;f.context.window.prepareRegistrationStream=()=>{prepared++;return true;};f.context.window.validateRegistrationLogo=async()=>{logos++;return true;};f.context.ensureOwnerSession=async()=>{sessions++;};
  if(reason==='missing preparation')delete f.context.window.prepareRegistrationStream;
  await f.submit('registerForm');await settle();assert.equal(f.calls.length,0,reason);assert.equal(f.widgets.length,0,reason);assert.equal(logos,0,reason);assert.equal(sessions,0,reason);assert.equal(f.busy('registerForm'),false,reason);if(reason==='false'){assert.equal(prepared,1,reason);assert.deepEqual(guardCalls,[true],reason);}
 }
});

test('a passing stream guard allows the ordinary registration security and API flow',async()=>{
 const f=fixture(),guards=[];f.context.window.registrationStreamSaveAllowed=report=>{guards.push(report);return true;};f.page('register');const pending=f.submit('registerForm');await settle();assert.deepEqual(guards,[true]);assert.equal(f.calls.length,0);assert.equal(f.widgets.length,1);f.widgets[0].options.callback('stream-passed-token');await pending;assert.equal(f.calls.length,1);assert.equal(f.calls[0].path,'/api/owner/register');assert.equal(f.calls[0].body.turnstile_token,'stream-passed-token');assert.equal(f.verified.length,1);
});

test('a server rejection of expired stream proof clears the gate and preserves the registration draft',async()=>{
 const f=fixture(),form=f.get('registerForm'),failure=Object.assign(Error('Test your stream before saving.'),{status:428});let invalidated=0,allowed=true;f.context.window.registrationStreamSaveAllowed=()=>allowed;f.context.window.invalidateRegistrationStreamSaveGate=()=>{invalidated++;allowed=false;};f.answers.push(failure);f.page('register');const pending=f.submit('registerForm');await settle();f.widgets[0].options.callback('expired-proof-token');await pending;
 assert.equal(invalidated,1);assert.equal(f.verified.length,0);assert.equal(f.busy('registerForm'),false);assert.equal(form.elements.name.value,'Test station');assert.equal(form.elements.stream_url.value,'https://example.com/live');assert.equal(form.elements.artwork.files[0].name,'logo.png');assert.equal(f.get('registerMessage').textContent,'Test your stream before saving.');await f.submit('registerForm');assert.equal(f.calls.length,1);assert.equal(f.widgets.length,1);
});

test('Add Station opens Create Station for an unowned session and Sign in remains an explicit tab',async()=>{
 const f=ownerNavigationFixture();f.page('myRadio');await f.open();assert.equal(f.get('register').hidden,false);assert.equal(f.get('login').hidden,true);assert.equal(f.get('myRadio').hidden,true);assert.deepEqual(f.history,['/#add-station']);assert.deepEqual(f.navigation,[['feature','owner'],['session']]);
 f.get('openLogin').onclick();assert.equal(f.get('login').hidden,false);assert.equal(f.get('register').hidden,true);assert.equal(f.focused(),f.get('signInTab'));
 f.get('openRegister').onclick();assert.equal(f.get('register').hidden,false);assert.equal(f.get('login').hidden,true);assert.equal(f.focused(),f.get('createStationTab'));assert.equal(f.calls.length,0);assert.equal(f.widgets.length,0);
});

test('Add Station retains the authenticated editor path with its existing draft-preservation contract',async()=>{
 const f=ownerNavigationFixture({owner:'13'});f.page('myRadio');await f.open();assert.equal(f.get('editor').hidden,false);assert.equal(f.get('register').hidden,true);assert.equal(f.get('login').hidden,true);assert.deepEqual(f.navigation.map(event=>event[0]),['feature','session','editor']);assert.equal(f.navigation[2][1],true);assert.equal(typeof f.navigation[2][2],'number');assert.equal(f.context.state.owner_station,'13');
 assert.equal(f.get('navAdd').querySelector('span').textContent,'Station account');
});

test('an authenticated owner cannot reopen sign-in or create tabs through direct routing or old buttons',async()=>{
 const f=ownerNavigationFixture({owner:'13'});await f.open();
 for(const route of ['login','register']){f.page(route);assert.equal(f.get('editor').hidden,false);assert.equal(f.get(route).hidden,true);}
 for(const id of ['openLogin','openRegister']){await f.get(id).onclick();assert.equal(f.get('editor').hidden,false);assert.equal(f.get('login').hidden,true);assert.equal(f.get('register').hidden,true);}
 assert.equal(f.navigation.filter(event=>event[0]==='editor').length,3);assert.equal(f.calls.length,0);assert.equal(f.widgets.length,0);
});

test('expired ownership returns explicit Sign in and Create station entry without treating an old identity as active',async()=>{
 const f=ownerNavigationFixture({owner:'13'});await f.open();
 f.context.window.ownerAccountNavigation.accept({owner_station:'13',owner_expires:999,server_time:1000});
 assert.equal(f.context.window.ownerAccountNavigation.active(),false);assert.equal(f.get('navAdd').querySelector('span').textContent,'Create station');
 f.get('openLogin').onclick();assert.equal(f.get('login').hidden,false);assert.equal(f.focused(),f.get('signInTab'));
 f.get('openRegister').onclick();assert.equal(f.get('register').hidden,false);assert.equal(f.focused(),f.get('createStationTab'));
 assert.equal(f.navigation.filter(event=>event[0]==='editor').length,1);
});

test('account navigation access failures show owner recovery and logout rather than unrelated authentication forms',async()=>{
 for(const status of [undefined,403,404]){
  const f=ownerNavigationFixture({owner:'13'});f.page('myRadio');f.get('ownerEntryLogout').hidden=true;f.context.editor=async()=>{throw Object.assign(Error('Account temporarily unavailable'),{status});};
  await f.open();assert.equal(f.get('ownerEntryLoading').hidden,false);assert.equal(f.get('ownerEntryLogout').hidden,false);assert.equal(f.get('login').hidden,true);assert.equal(f.get('register').hidden,true);assert.equal(f.context.window.ownerAccountNavigation.active(),true);assert.match(f.get('ownerEntryText').textContent,/Tap Station account/);assert.equal(f.get('message').textContent,'Account temporarily unavailable');
 }
});

test('leaving while Add Station loads cannot open Create Station or an owner editor afterwards',async()=>{
 for(const waiting of ['feature','session'])for(const owner of [null,'13']){
  const pause=deferred(),f=ownerNavigationFixture({owner,[waiting]:pause.promise});f.page('myRadio');const opening=f.open();await settle();f.page('support');pause.resolve();await opening;
  assert.equal(f.get('support').hidden,false,waiting);assert.equal(f.get('register').hidden,true,waiting);assert.equal(f.get('editor').hidden,true,waiting);assert.equal(f.navigation.some(event=>event[0]==='editor'),false);
 }
});

test('leaving sign-in promptly unlocks its fields and removes only its security widget',async()=>{
 const f=fixture(),pending=f.submit('loginForm');await settle();assert.equal(f.widgets.length,1);assert.equal(f.busy('loginForm'),true);
 f.page('support');assert.equal(f.busy('loginForm'),false);assert.equal(f.get('loginForm').elements.email.disabled,false);assert.deepEqual(f.removed,['widget-1']);
 f.widgets[0].options.callback('late-token');await pending;assert.equal(f.calls.length,0);assert.equal(f.verified.length,0);assert.equal(f.timers.size,0);
});
test('an abandoned attempt cannot unlock a new attempt on the same form',async()=>{
 const f=fixture(),old=f.submit('loginForm');await settle();f.page('support');f.page('login');const fresh=f.submit('loginForm');await settle();await old;
 assert.equal(f.widgets.length,2);assert.equal(f.busy('loginForm'),true);assert.equal(f.get('loginForm').buttons[0].disabled,true);f.widgets[0].options.callback('stale-token');await settle();assert.equal(f.calls.length,0);
 f.widgets[1].options.callback('fresh-token');await fresh;assert.equal(f.calls.length,1);assert.equal(f.calls[0].body.turnstile_token,'fresh-token');assert.equal(f.verified.length,1);assert.equal(f.busy('loginForm'),false);
});
test('leaving registration during shared SDK loading keeps that load usable by a fresh sign-in',async()=>{
 const f=fixture({sdkReady:false}),old=f.submit('registerForm');await settle();assert.equal(f.scripts.length,1);assert.equal(f.busy('registerForm'),true);
 f.page('login');const fresh=f.submit('loginForm');await settle();assert.equal(f.busy('registerForm'),false);assert.equal(f.busy('loginForm'),true);assert.equal(f.scripts.length,1);await old;
 f.loadSdk();await settle();assert.equal(f.widgets.length,1);assert.equal(f.widgets[0].area.id,'loginFormHuman');f.widgets[0].options.callback('new-token');await fresh;
 assert.equal(f.calls.length,1);assert.equal(f.calls[0].path,'/api/owner/login');assert.equal(f.get('registerForm').elements.name.value,'Test station');
});
test('an already-sent request may finish after navigation without opening verification or clearing a newer busy state',async()=>{
 const f=fixture(),response=deferred();f.answers.push(response.promise);const old=f.submit('loginForm');await settle();f.widgets[0].options.callback('first-token');await settle();assert.equal(f.calls.length,1);
 f.page('support');f.page('login');const fresh=f.submit('loginForm');await settle();assert.equal(f.busy('loginForm'),true);response.resolve({verification_id:'stale-response'});await old;
 assert.equal(f.verified.length,0);assert.equal(f.busy('loginForm'),true);f.widgets[1].options.callback('second-token');await fresh;assert.equal(f.verified.length,1);assert.notEqual(f.verified[0].verification_id,'stale-response');
});
test('sign-in errors appear in and focus the inline login notice, then clear for a fresh attempt',async()=>{
 const f=fixture(),old=f.submit('loginForm');await settle();f.widgets[0].options['error-callback']('600010');await old;
 assert.match(f.get('loginMessage').textContent,/Security check could not complete/);assert.equal(f.focused(),f.get('loginMessage'));assert.equal(f.get('message').textContent,'');assert.equal(f.busy('loginForm'),false);
 const fresh=f.submit('loginForm');assert.equal(f.get('loginMessage').textContent,'');await settle();f.widgets[1].options.callback('fresh-token');await fresh;
});
test('returning to registration does not let an older artwork check unlock the new form submission',async()=>{
 const f=fixture(),artwork=deferred();let checks=0;f.context.window.validateRegistrationLogo=()=>++checks===1?artwork.promise:Promise.resolve(true);
 f.page('register');const old=f.submit('registerForm');await settle();f.page('login');assert.equal(f.busy('registerForm'),false);f.page('register');const fresh=f.submit('registerForm');await settle();assert.equal(f.widgets.length,1);assert.equal(f.busy('registerForm'),true);
 artwork.resolve(true);await old;assert.equal(f.busy('registerForm'),true);assert.equal(f.calls.length,0);f.widgets[0].options.callback('registered-token');await fresh;
 assert.equal(f.calls.length,1);assert.equal(f.calls[0].path,'/api/owner/register');assert.equal(f.verified.length,1);
});
test('ordinary verification success still requires a completed security token and suppresses duplicate submits',async()=>{
 const f=fixture(),pending=f.submit('loginForm');await settle();await f.submit('loginForm');assert.equal(f.widgets.length,1);assert.equal(f.calls.length,0);f.widgets[0].options.callback('valid-token');await pending;
 assert.equal(f.calls.length,1);assert.equal(f.calls[0].body.turnstile_token,'valid-token');assert.equal(f.verified.length,1);assert.equal(f.busy('loginForm'),false);
});
test('provider choices stay out of signup fingerprints and API payloads while exact listening URLs remain unchanged',async()=>{
 const stream='http://stream.example.com:8000/;Stream/2?sid=2&client=radio%2Fone';
 for(const provider of ['icecast','shoutcast','other']){
  const f=fixture(),form=f.get('registerForm'),choice=f.get('selectedProvider');choice.type='radio';choice.name='stream_provider';choice.value=provider;choice.checked=true;form.elements.stream_provider=choice;form.fields.push(choice);form.elements.stream_url.value=stream;let fingerprint;
  f.context.registrationRequest=async(data,current)=>{assert.equal(current(),true);fingerprint={...data};return 'provider-independent-request';};
  f.page('register');const pending=f.submit('registerForm');await settle();assert.ok(fingerprint,provider);assert.equal(Object.hasOwn(fingerprint,'stream_provider'),false,provider);assert.equal(fingerprint.stream_url,stream,provider);assert.equal(f.calls.length,0);
  f.widgets[0].options.callback('provider-token');await pending;
  assert.equal(f.calls.length,1,provider);assert.equal(f.calls[0].path,'/api/owner/register');assert.equal(Object.hasOwn(f.calls[0].body,'stream_provider'),false,provider);assert.equal(f.calls[0].body.stream_url,stream,provider);assert.equal(f.calls[0].body.request_id,'provider-independent-request');assert.equal(f.calls[0].body.turnstile_token,'provider-token');assert.equal(form.elements.stream_url.value,stream);assert.equal(f.verified.length,1);
 }
});

test('signup metadata survives busy and failed attempts, with retry identity tied to the selected metadata',async()=>{
 const f=fixture(),form=f.get('registerForm'),digests=[];
 for(const [name,value] of Object.entries({zip_code:'01234',category:'news_talk'})){const field=f.get('signup-'+name);field.tagName=name==='zip_code'?'INPUT':'SELECT';field.name=name;field.value=value;form.elements[name]=field;form.fields.push(field);}
 f.context.crypto={subtle:{digest(...args){const pending=webcrypto.subtle.digest(...args);digests.push(pending);return pending;}},randomUUID:()=>webcrypto.randomUUID()};
 vm.runInContext(between('async function registrationRequest(','function ownerAccessSuccess('),f.context);
 f.page('register');
 async function attempt(){
  const count=f.calls.length,widgetCount=f.widgets.length;f.answers.push(Error('Please retry this submission.'));
  const pending=f.submit('registerForm');await settle();await Promise.all(digests);await settle();
  assert.equal(f.busy('registerForm'),true);assert.equal(form.elements.zip_code.disabled,true);assert.equal(form.elements.category.disabled,true);
  await f.submit('registerForm');assert.equal(f.widgets.length,widgetCount+1);assert.equal(f.calls.length,count);
  f.widgets.at(-1).options.callback('metadata-token-'+widgetCount);await pending;
  assert.equal(f.busy('registerForm'),false);assert.equal(form.elements.zip_code.disabled,false);assert.equal(form.elements.category.disabled,false);
  assert.equal(f.calls.length,count+1);assert.equal(f.verified.length,0);assert.match(f.get('registerMessage').textContent,/retry/);
  return f.calls.at(-1).body;
 }
 const first=await attempt();assert.equal(first.zip_code,'01234');assert.equal(first.category,'news_talk');assert.equal(Object.hasOwn(first,'language'),false);assert.match(first.request_id,/^[a-f0-9]{32}$/);assert.equal(form.elements.zip_code.value,'01234');assert.equal(form.elements.category.value,'news_talk');
 const unchanged=await attempt();assert.equal(unchanged.request_id,first.request_id);assert.notEqual(unchanged.turnstile_token,first.turnstile_token);
 form.elements.zip_code.value='10001';const changedZip=await attempt();assert.notEqual(changedZip.request_id,first.request_id);assert.equal(changedZip.zip_code,'10001');assert.equal(changedZip.category,'news_talk');
 form.elements.category.value='culture';const changedCategory=await attempt();assert.notEqual(changedCategory.request_id,changedZip.request_id);assert.equal(changedCategory.zip_code,'10001');assert.equal(changedCategory.category,'culture');
 form.elements.zip_code.value='00001';form.elements.category.value='christian';const leadingZero=await attempt();assert.equal(leadingZero.zip_code,'00001');assert.equal(leadingZero.category,'christian');assert.notEqual(leadingZero.request_id,changedCategory.request_id);
});

test('registration reset clears retry identity including metadata, while a cancelled old digest cannot revive it',async()=>{
 const f=fixture(),form=f.get('registerForm');f.context.crypto=webcrypto;
 vm.runInContext(between('async function registrationRequest(','function ownerAccessSuccess('),f.context);
 vm.runInContext(between("$('registerForm').addEventListener('reset'", "$('registerForm').onsubmit=async event=>"),f.context);
 const data={name:'Test station',stream_url:'https://example.com/live',zip_code:'01234',category:'news_talk'};
 const before=await f.context.registrationRequest(data,()=>true);assert.equal(await f.context.registrationRequest(data,()=>true),before);
 form.dispatchEvent({type:'reset'});
 assert.equal(await f.context.registrationRequest({...data,zip_code:'10001'},()=>false),'');
 const after=await f.context.registrationRequest(data,()=>true);assert.notEqual(after,before);assert.equal(await f.context.registrationRequest(data,()=>true),after);
});

test('signup required station details start expanded with empty reset defaults and the server category catalog',()=>{
 const html=readFileSync(new URL('./public/index.html',import.meta.url),'utf8'),registration=html.match(/<form\b[^>]*id="registerForm"[^>]*>([\s\S]*?)<\/form>/)?.[1];assert.ok(registration);
 const details=registration.match(/<details\b([^>]*\bid="registrationStationDetails"[^>]*)>([\s\S]*?)<\/details>/);assert.ok(details);assert.match(details[1],/\bopen(?:\s|=|$)/);
 assert.match(details[2],/>Station details<\/summary>/);assert.doesNotMatch(details[2],/optional/);
 const zip=details[2].match(/<input\b([^>]*\bid="registrationStationZip"[^>]*)>/);assert.ok(zip);for(const attribute of ['name="zip_code"','type="text"','inputmode="numeric"','maxlength="5"','pattern="[0-9]{5}"','autocomplete="postal-code"'])assert.ok(zip[1].includes(attribute),attribute);assert.match(zip[1],/\brequired(?:\s|=|$)/);assert.doesNotMatch(zip[1],/\b(?:disabled|value)(?:\s|=|$)/);assert.doesNotMatch(registration,/\bname="language"/);
 for(const [name,id,catalog] of [['category','registrationStationCategory',metadataOptions.categories]]){
  const select=details[2].match(new RegExp('<select\\b([^>]*\\bid="'+id+'"[^>]*)>([\\s\\S]*?)<\\/select>'));assert.ok(select,name);assert.match(select[1],new RegExp('\\bname="'+name+'"'));assert.match(select[1],/\brequired(?:\s|=|$)/);assert.doesNotMatch(select[1],/\bdisabled(?:\s|=|$)/);
  const choices=[...select[2].matchAll(/<option\b([^>]*\bvalue="([^"]*)"[^>]*)>([\s\S]*?)<\/option>/g)];assert.deepEqual(choices.map(choice=>choice[2]),['',...catalog.map(option=>option.value)]);assert.doesNotMatch(select[2],/\bselected(?:\s|=|>)/);assert.equal(choices[0][2],'');assert.equal(choices[0][3],'Choose category');assert.equal(choices.find(choice=>choice[2]==='christian')[3],'Religion');
 }
 assert.ok(registration.indexOf('name="email"')<registration.indexOf('id="registrationStationDetails"'));
});

test('a failed signup ZIP guard prevents even a direct submit from constructing FormData or starting security work',async()=>{
 const f=fixture();let prepared=0;f.context.window.prepareRegistrationStationMetadata=()=>{prepared++;return false;};f.context.FormData=class{constructor(){throw Error('Invalid ZIP must not construct FormData');}};f.page('register');await f.submit('registerForm');await settle();assert.equal(prepared,1);assert.equal(f.calls.length,0);assert.equal(f.widgets.length,0);assert.equal(f.busy('registerForm'),false);
});
