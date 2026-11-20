import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import {randomUUID} from 'node:crypto';

const source=readFileSync(new URL('./public/assets/my-radio.js',import.meta.url),'utf8');

function deferred(){let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return {promise,resolve,reject};}
async function until(check){for(let i=0;i<30&&!check();i++)await new Promise(setImmediate);assert.ok(check(),'Expected asynchronous checkpoint');}

function fixture({dialog=async()=>true}={}){
 const ids=new Map(),answers=[],calls=[],events=new Map(),documentEvents=new Map(),observers=[],timers=new Map();
 let selected='',timerId=0,clock=Date.UTC(2026,10,11,12),wifiOpens=0;
 function node(tag='div'){
  return {tag,tagName:tag.toUpperCase(),hidden:false,disabled:false,textContent:'',className:'',dataset:{},attributes:{},children:[],elements:{},isConnected:true,
   setAttribute(key,value){this.attributes[key]=value;},removeAttribute(key){delete this.attributes[key];},
   append(...children){this.children.push(...children);},replaceChildren(...children){this.children=children;},before(other){this.beforeNode=other;},
   focus(){document.activeElement=this;},querySelector(selector){return selector==='button'?this.button:null;},querySelectorAll(){return [];},
   addEventListener(){},dispatchEvent(){},reset(){if(this.elements.device_code)this.elements.device_code.value='';}};
 }
 const get=id=>{if(!ids.has(id))ids.set(id,node());return ids.get(id);};
 for(const id of ['myRadio','linkedRadios','connectRadio','connectRadioForm','radioConnectionChoices','setupRadioWifi','radioAlreadyOnline','radioCodeBack','cancelRadioConnection','radioConnectStatus','refreshRadios','navRadio','openWifiSetup'])get(id);
 for(const id of ['connectRadio','connectRadioForm','radioConnectionChoices','cancelRadioConnection','refreshRadios','openWifiSetup'])get(id).hidden=true;
 const form=get('connectRadioForm');form.button=node('button');form.elements.device_code=Object.assign(node('input'),{value:''});
 const document={hidden:false,activeElement:null,createElement:node,getElementById:get,addEventListener(type,handler){documentEvents.set(type,handler);}};
 const navigator={onLine:true};
 class Clock extends Date{constructor(...args){super(...(args.length?args:[clock]));}static now(){return clock;}}
 const context={document,navigator,Date:Clock,URLSearchParams,AbortController,Event:class{constructor(type){this.type=type;}},crypto:{randomUUID},location:{hash:'#radio',search:''},history:{replaceState(){}},
  CustomEvent:class{constructor(type,options){this.type=type;this.detail=options?.detail;}},
  MutationObserver:class{constructor(fn){observers.push(fn);}observe(){}},
  window:{addEventListener(type,handler){events.set(type,handler);},dispatchEvent(){},openGuidedRadioWifi(){wifiOpens++;},validateDeviceCodeInput:input=>input.value},
  $:get,api:async(path,body)=>{calls.push({path,body});const next=answers.shift();if(next instanceof Error)throw next;if(next===undefined)throw Error('Unexpected request '+path);return await next;},
  reconcileSelectedRadio(radios){selected=radios.length===1?String(radios[0].id):radios.some(r=>String(r.id)===selected)?selected:'';return selected;},
  rememberSelectedRadio(value){selected=String(value);},readSelectedRadio:()=>selected,loadRadioInventory(){},radioInventories:new Map(),
  busy(form,on){form.button.disabled=on;form.elements.device_code.disabled=on;},human:async()=> 'human-proof',loadOwnerSession:async()=>{},delay:async()=>{},
  showRadioApproval(target,code){target.textContent='Match '+code+' and tap Allow on your radio.';},listenerActionDialog:dialog,
  page(){get('myRadio').hidden=false;},trackPairingCleanup:operation=>operation,
  setTimeout(fn,delay){const id=++timerId;timers.set(id,{fn,delay});return id;},clearTimeout(id){timers.delete(id);}};
 runInNewContext(source,context);
 return {ids,answers,calls,document,navigator,events,documentEvents,form,get,context,load:runInNewContext('loadMyRadios',context),
  step:()=>runInNewContext('radioConnectionStep',context),wifiOpens:()=>wifiOpens,
  async flush(){await new Promise(setImmediate);},advance(ms){clock+=ms;},
  async click(id){return await get(id).onclick?.();},showCode:()=>context.window.showRadioCodeEntry(),showChoices:()=>context.window.showRadioConnectionChoices(),close:()=>context.window.closeRadioConnectionFlow(),
  submit:()=>form.onsubmit({preventDefault(){},target:form})};
}
const radio={id:'one',device_code:'3961',online:true,current_station:'Community Radio'};
async function approveInBackground(f){
 const decision=deferred();f.answers.push({radios:[]});await f.load();await f.click('connectRadio');await f.click('radioAlreadyOnline');f.form.elements.device_code.value='3961';
 f.answers.push({claim_id:'claim',confirmation_code:'5831'},decision.promise);const pairing=f.submit();await until(()=>f.calls.some(call=>call.path==='/api/phone/claim/status'));
 f.document.hidden=true;f.documentEvents.get('visibilitychange')();f.answers.push({radios:[radio]});decision.resolve({state:'approved',radio_id:'one'});await pairing;
}

test('first visit has one Connect action and keeps code entry and setup choices out of the way',async()=>{
 const f=fixture();f.answers.push({radios:[]});await f.load();
 assert.equal(f.get('connectRadio').hidden,false);assert.equal(f.form.hidden,true);assert.equal(f.get('radioConnectionChoices').hidden,true);assert.equal(f.get('openWifiSetup').hidden,true);
 assert.deepEqual(f.calls.map(call=>call.path),['/api/phone/radios']);
});

test('Connect asks about Wi-Fi before exposing the one-time code form',async()=>{
 const f=fixture();f.answers.push({radios:[]});await f.load();await f.click('connectRadio');
 assert.equal(f.get('connectRadio').hidden,true);assert.equal(f.get('radioConnectionChoices').hidden,false);assert.equal(f.form.hidden,true);
 await f.click('radioAlreadyOnline');assert.equal(f.form.hidden,false);assert.equal(f.get('radioConnectionChoices').hidden,true);
 assert.equal(f.document.activeElement,f.form.elements.device_code);assert.equal(f.calls.length,1);
});

test('Wi-Fi setup opens only on explicit choice and never claims a radio by network address',async()=>{
 const f=fixture();f.answers.push({radios:[]});await f.load();await f.click('connectRadio');await f.click('setupRadioWifi');
 assert.equal(f.wifiOpens(),1);assert.equal(f.form.hidden,true);assert.equal(f.calls.some(call=>call.path.includes('/claim')),false);
});

test('Back preserves the typed code without submitting or reopening pairing',async()=>{
 const f=fixture();f.answers.push({radios:[]});await f.load();await f.click('connectRadio');await f.click('radioAlreadyOnline');f.form.elements.device_code.value='0012';
 await f.click('radioCodeBack');assert.equal(f.form.hidden,true);assert.equal(f.get('radioConnectionChoices').hidden,false);assert.equal(f.form.elements.device_code.value,'0012');
 await f.click('radioAlreadyOnline');assert.equal(f.form.elements.device_code.value,'0012');assert.equal(f.calls.length,1);
});

test('restarting code setup clears old inline validation without erasing the draft or validating again',async()=>{
 const f=fixture();let checks=0,clears=0;const field=f.form.elements.device_code;
 f.context.window.validateDeviceCodeInput=()=>{checks++;field.oldError=true;return null;};
 f.context.window.clearDeviceCodeInputError=input=>{assert.equal(input,field);clears++;input.oldError=false;};
 f.answers.push({radios:[]});await f.load();await f.click('connectRadio');await f.click('radioAlreadyOnline');field.value='123';await f.submit();assert.equal(field.oldError,true);assert.equal(checks,1);
 await f.click('radioCodeBack');assert.equal(field.oldError,false);await f.click('setupRadioWifi');field.oldError=true;f.showCode();
 assert.equal(field.oldError,false);assert.equal(field.value,'123');assert.equal(checks,1);assert.ok(clears>=4);assert.equal(f.calls.length,1);
});

test('automatic empty status refreshes preserve the current setup step and input',async()=>{
 const f=fixture();f.answers.push({radios:[]});await f.load();await f.click('connectRadio');f.answers.push({radios:[]});await f.load(true);
 assert.equal(f.get('radioConnectionChoices').hidden,false);assert.equal(f.form.hidden,true);
 await f.click('radioAlreadyOnline');f.form.elements.device_code.value='0012';f.answers.push({radios:[]});await f.load(true);
 assert.equal(f.form.hidden,false);assert.equal(f.form.elements.device_code.value,'0012');assert.equal(f.get('connectRadio').hidden,true);
});

test('an existing linked radio bypasses all setup and comes online without a new claim',async()=>{
 const f=fixture();f.answers.push({radios:[{...radio,online:false}]});await f.load();const card=f.get('linkedRadios').children[0];
 assert.equal(f.form.hidden,true);assert.equal(f.get('connectRadio').hidden,false);assert.equal(f.get('connectRadio').textContent,'Connect another radio');assert.equal(f.get('radioConnectionChoices').hidden,true);assert.equal(f.get('openWifiSetup').hidden,false);
 f.advance(10000);f.answers.push({radios:[radio]});await f.load(true);
 assert.equal(f.get('linkedRadios').children[0],card);assert.equal(card.children[0].children[1].textContent,'Online');assert.equal(f.get('openWifiSetup').hidden,true);
 assert.deepEqual(f.calls.map(call=>call.path),['/api/phone/radios','/api/phone/radios']);
});

test('a remembered radio learned during setup closes code entry without creating another pairing',async()=>{
 const f=fixture();f.answers.push({radios:[]});await f.load();await f.click('connectRadio');await f.click('radioAlreadyOnline');f.form.elements.device_code.value='3961';
 f.answers.push({radios:[radio]});await f.load(true);
 assert.equal(f.form.hidden,true);assert.equal(f.get('radioConnectionChoices').hidden,true);assert.equal(f.get('connectRadio').hidden,false);assert.equal(f.get('linkedRadios').children.length,1);
 f.showCode();assert.equal(f.form.hidden,false);assert.equal(f.calls.some(call=>call.path.includes('/claim')),false);
});

test('a failed status check does not discard the code or force the user through Wi-Fi again',async()=>{
 const f=fixture();f.answers.push({radios:[]});await f.load();await f.click('connectRadio');await f.click('radioAlreadyOnline');f.form.elements.device_code.value='0012';
 f.answers.push(Error('Temporarily unavailable'));await f.load(true);
 assert.equal(f.form.hidden,false);assert.equal(f.form.elements.device_code.value,'0012');assert.equal(f.get('refreshRadios').hidden,false);
 f.answers.push({radios:[]});await f.load(true);assert.equal(f.form.hidden,false);assert.equal(f.form.elements.device_code.value,'0012');assert.equal(f.get('refreshRadios').hidden,true);
});

test('the guided form still requires physical Allow and keeps a denied request retryable',async()=>{
 const f=fixture();f.answers.push({radios:[]});await f.load();await f.click('connectRadio');await f.click('radioAlreadyOnline');f.form.elements.device_code.value='0012';
 f.answers.push({claim_id:'claim',confirmation_code:'5831'},{state:'denied'},{state:'cancelled'});await f.submit();await f.flush();
 const claim=f.calls.find(call=>call.path==='/api/phone/claim');assert.equal(claim.body.device_code,'0012');assert.equal(claim.body.turnstile_token,'human-proof');
 assert.equal(f.calls.filter(call=>call.path==='/api/phone/claim/status').length,1);assert.match(f.get('radioConnectStatus').textContent,/not approved/);
 assert.equal(f.form.hidden,false);assert.equal(f.form.button.disabled,false);assert.equal(f.form.elements.device_code.value,'0012');assert.equal(f.get('linkedRadios').children.length,0);
});

test('Back during claim creation cancels the pending request and ignores its late approval',async()=>{
 const f=fixture();f.answers.push({radios:[]});await f.load();await f.click('connectRadio');await f.click('radioAlreadyOnline');f.form.elements.device_code.value='3961';
 let resolve;f.answers.push(new Promise(done=>{resolve=done;}));const pending=f.submit();
 for(let i=0;i<20&&!f.calls.some(call=>call.path==='/api/phone/claim');i++)await f.flush();
 const claim=f.calls.find(call=>call.path==='/api/phone/claim');assert.ok(claim);
 f.answers.push({state:'cancelled'});await f.click('radioCodeBack');assert.equal(f.form.hidden,true);assert.equal(f.get('radioConnectionChoices').hidden,false);
 resolve({claim_id:'late',confirmation_code:'5831'});await pending;await f.flush();
 assert.equal(f.calls.filter(call=>call.path==='/api/phone/claim/cancel').length,1);assert.equal(f.calls.find(call=>call.path==='/api/phone/claim/cancel').body.request_id,claim.body.request_id);
 assert.equal(f.calls.some(call=>call.path==='/api/phone/claim/status'),false);assert.equal(f.get('linkedRadios').children.length,0);assert.equal(f.form.elements.device_code.value,'3961');
});

test('closing the setup chooser returns to one action without erasing the draft or sending a request',async()=>{
 const f=fixture();f.answers.push({radios:[]});await f.load();await f.click('connectRadio');await f.click('radioAlreadyOnline');f.form.elements.device_code.value='0012';await f.click('radioCodeBack');
 await f.click('radioConnectionExit');assert.equal(f.get('connectRadio').hidden,false);assert.equal(f.get('radioConnectionChoices').hidden,true);assert.equal(f.form.hidden,true);assert.equal(f.document.activeElement,f.get('connectRadio'));
 assert.equal(f.form.elements.device_code.value,'0012');assert.equal(f.calls.length,1);
});

for(const result of ['empty','known','unauthorized'])test('a slow initial '+result+' status response cannot replace physical approval instructions',async()=>{
 const f=fixture(),initial=deferred(),decision=deferred();f.answers.push(initial.promise);const initialLoad=f.load();
 await f.click('connectRadio');await f.click('radioAlreadyOnline');f.form.elements.device_code.value='3961';f.answers.push({claim_id:'claim',confirmation_code:'5831'},decision.promise);const pairing=f.submit();
 await until(()=>f.calls.some(call=>call.path==='/api/phone/claim/status'));const instructions=f.get('radioConnectStatus').textContent;
 assert.match(instructions,/5831/);assert.match(instructions,/Allow/);
 if(result==='unauthorized')initial.reject(Object.assign(Error('Old session expired'),{status:401}));else initial.resolve({radios:result==='known'?[radio]:[]});await initialLoad;
 assert.equal(f.get('radioConnectStatus').textContent,instructions);assert.equal(f.form.hidden,false);assert.equal(f.form.button.disabled,true);assert.equal(f.get('linkedRadios').children.length,0);
 assert.equal(f.calls.some(call=>call.path==='/api/phone/claim/cancel'),false);assert.equal(f.calls.filter(call=>call.path==='/api/phone/radios').length,1);
 f.answers.push({state:'cancelled'});decision.resolve({state:'denied'});await pairing;await f.flush();assert.match(f.get('radioConnectStatus').textContent,/not approved/);assert.equal(f.form.elements.device_code.value,'3961');
});

test('approval queues a fresh status request when the old initial request is held and releases pairing before success feedback',async()=>{
 const success=deferred(),f=fixture({dialog:()=>success.promise}),initial=deferred(),decision=deferred();f.answers.push(initial.promise);const initialLoad=f.load();
 await f.click('connectRadio');await f.click('radioAlreadyOnline');f.form.elements.device_code.value='3961';f.answers.push({claim_id:'claim',confirmation_code:'5831'},decision.promise);const pairing=f.submit();
 await until(()=>f.calls.some(call=>call.path==='/api/phone/claim/status'));decision.resolve({state:'approved',radio_id:'one'});
 await until(()=>runInNewContext('radioReloadRequested',f.context));await until(()=>!f.form.button.disabled);assert.equal(f.calls.filter(call=>call.path==='/api/phone/radios').length,1);
 f.answers.push({radios:[radio]});initial.resolve({radios:[]});await initialLoad;
 await until(()=>f.get('linkedRadios').children.length===1);assert.equal(f.calls.filter(call=>call.path==='/api/phone/radios').length,2);
 assert.equal(f.get('linkedRadios').children[0].children[0].children[1].textContent,'Online');assert.equal(f.form.hidden,true);assert.equal(f.get('connectRadio').hidden,false);assert.equal(f.calls.some(call=>call.path==='/api/phone/claim/cancel'),false);
 success.resolve(true);await pairing;assert.equal(f.form.button.disabled,false);
});

test('approved linking resumes the selected station after pairing cleanup and suppresses extra connection feedback',async()=>{
 const dialogs=[],resumed=[],f=fixture({dialog:async(...args)=>{dialogs.push(args);return true;}});
 f.answers.push({radios:[]});await f.load();await f.click('connectRadio');await f.click('radioAlreadyOnline');f.form.elements.device_code.value='3961';
 f.context.window.resumePendingStationConnection=async radioId=>{
  resumed.push(radioId);assert.equal(runInNewContext('radioPairingBusy',f.context),false);assert.equal(runInNewContext('radioPairingAttempt',f.context),null);assert.equal(f.form.button.disabled,false);assert.equal(f.form.elements.device_code.disabled,false);assert.equal(f.get('cancelRadioConnection').hidden,true);assert.equal(f.context.readSelectedRadio(),'one');
  f.get('myRadio').hidden=true;return true;
 };
 f.answers.push({claim_id:'claim',confirmation_code:'5831'},{state:'approved',radio_id:'one'},{radios:[radio]});await f.submit();
 assert.deepEqual(resumed,['one'],f.get('radioConnectStatus').textContent);assert.deepEqual(dialogs,[]);assert.equal(f.calls.some(call=>call.path==='/api/phone/add'),false);assert.equal(f.calls.some(call=>call.path==='/api/phone/claim/cancel'),false);
});

test('a pairing without a pending station retains its normal connection confirmation',async()=>{
 const dialogs=[],f=fixture({dialog:async(...args)=>{dialogs.push(args);return true;}});let resumed=0;
 f.context.window.resumePendingStationConnection=async()=>{resumed++;return false;};
 f.answers.push({radios:[]});await f.load();await f.click('connectRadio');await f.click('radioAlreadyOnline');f.form.elements.device_code.value='3961';
 f.answers.push({claim_id:'claim',confirmation_code:'5831'},{state:'approved',radio_id:'one'},{radios:[radio]});await f.submit();
 assert.equal(resumed,1,f.get('radioConnectStatus').textContent);assert.deepEqual(dialogs,[['Radio connected','']]);assert.equal(f.get('linkedRadios').children.length,1);
});

test('explicit connection Close and Cancel clear station intent while Back and Wi-Fi retain it',async()=>{
 const f=fixture();let cancellations=0;f.context.window.cancelPendingStationConnection=()=>{cancellations++;};
 f.answers.push({radios:[]});await f.load();await f.click('connectRadio');await f.click('radioAlreadyOnline');await f.click('radioCodeBack');await f.click('setupRadioWifi');assert.equal(cancellations,0);
 await f.click('radioConnectionExit');assert.equal(cancellations,1);await f.click('connectRadio');await f.click('radioAlreadyOnline');await f.click('cancelRadioConnection');assert.equal(cancellations,2);assert.equal(f.calls.length,1);
});

test('denied linking never resumes a selected station or shows success',async()=>{
 const dialogs=[],f=fixture({dialog:async(...args)=>{dialogs.push(args);return true;}});let resumed=0;f.context.window.resumePendingStationConnection=async()=>{resumed++;return true;};
 f.answers.push({radios:[]});await f.load();await f.click('connectRadio');await f.click('radioAlreadyOnline');f.form.elements.device_code.value='3961';
 f.answers.push({claim_id:'claim',confirmation_code:'5831'},{state:'denied'},{state:'cancelled'});await f.submit();await f.flush();
 assert.equal(resumed,0);assert.deepEqual(dialogs,[]);assert.match(f.get('radioConnectStatus').textContent,/not approved/);assert.equal(f.form.button.disabled,false);
});

test('a failed station continuation keeps the approved link and offers retry without creating another claim',async()=>{
 const dialogs=[],f=fixture({dialog:async(...args)=>{dialogs.push(args);return true;}});f.context.window.resumePendingStationConnection=async()=>{throw Error('Adding failed');};
 f.answers.push({radios:[]});await f.load();await f.click('connectRadio');await f.click('radioAlreadyOnline');f.form.elements.device_code.value='3961';
 f.answers.push({claim_id:'claim',confirmation_code:'5831'},{state:'approved',radio_id:'one'},{radios:[radio]});await f.submit();
 assert.equal(f.get('linkedRadios').children.length,1);assert.equal(f.context.readSelectedRadio(),'one');assert.equal(f.form.button.disabled,false);assert.match(f.get('radioConnectStatus').textContent,/Radio connected.*Choose your station/);assert.deepEqual(dialogs,[]);
 assert.equal(f.calls.filter(call=>call.path==='/api/phone/claim').length,1);assert.equal(f.calls.some(call=>call.path==='/api/phone/claim/cancel'),false);
});

test('a late station-continuation failure cannot replace feedback after leaving Radio',async()=>{
 const continuation=deferred(),f=fixture();let resumed=false;f.context.window.resumePendingStationConnection=()=>{resumed=true;return continuation.promise;};
 f.answers.push({radios:[]});await f.load();await f.click('connectRadio');await f.click('radioAlreadyOnline');f.form.elements.device_code.value='3961';
 f.answers.push({claim_id:'claim',confirmation_code:'5831'},{state:'approved',radio_id:'one'},{radios:[radio]});const pairing=f.submit();await until(()=>resumed);
 f.get('myRadio').hidden=true;f.get('radioConnectStatus').textContent='Another page owns feedback';continuation.reject(Error('Late error'));await pairing;
 assert.equal(f.get('radioConnectStatus').textContent,'Another page owns feedback');assert.equal(f.form.button.disabled,false);
});

test('background approval resumes its selected station only after a fresh visible response confirms that radio',async()=>{
 const dialogs=[],resumed=[],fresh=deferred(),f=fixture({dialog:async(...args)=>{dialogs.push(args);return true;}});
 f.context.window.resumePendingStationConnection=async id=>{resumed.push(id);assert.equal(f.form.button.disabled,false);assert.equal(runInNewContext('radioPairingBusy||radioLoading',f.context),false);return true;};
 await approveInBackground(f);assert.deepEqual(resumed,[]);assert.deepEqual(dialogs,[]);assert.equal(runInNewContext('deferredStationConnection.radioId',f.context),'one');
 f.answers.push(fresh.promise);f.document.hidden=false;f.documentEvents.get('visibilitychange')();await until(()=>f.calls.filter(call=>call.path==='/api/phone/radios').length===3);assert.deepEqual(resumed,[]);
 fresh.resolve({radios:[radio]});await until(()=>resumed.length===1);assert.deepEqual(resumed,['one']);assert.equal(runInNewContext('deferredStationConnection',f.context),null);assert.deepEqual(dialogs,[]);
 f.answers.push({radios:[radio]});await f.load(true);assert.deepEqual(resumed,['one']);
});

test('background approval cannot resume against a different linked radio or a later reappearing radio',async()=>{
 const f=fixture();let resumed=0;f.context.window.resumePendingStationConnection=async()=>{resumed++;return true;};await approveInBackground(f);
 f.document.hidden=false;f.answers.push({radios:[{...radio,id:'two',device_code:'8821'}]});await f.load(true);assert.equal(resumed,0);assert.equal(runInNewContext('deferredStationConnection',f.context),null);
 f.answers.push({radios:[radio]});await f.load(true);assert.equal(resumed,0);
});

test('a failed visible status check retains background intent without adding until a successful retry',async()=>{
 const f=fixture(),resumed=[];f.context.window.resumePendingStationConnection=async id=>{resumed.push(id);return true;};await approveInBackground(f);
 f.document.hidden=false;f.answers.push(Error('Temporary connection problem'));await f.load(true);assert.deepEqual(resumed,[]);assert.equal(runInNewContext('deferredStationConnection.radioId',f.context),'one');
 f.answers.push({radios:[radio]});await f.load(true);assert.deepEqual(resumed,['one']);
});

test('explicit cancellation while a fresh status check is pending prevents deferred station continuation',async()=>{
 const f=fixture(),fresh=deferred();let resumed=0,cancelled=0;f.context.window.resumePendingStationConnection=async()=>{resumed++;return true;};f.context.window.cancelPendingStationConnection=()=>cancelled++;await approveInBackground(f);
 f.document.hidden=false;f.answers.push(fresh.promise);const loading=f.load(true);await until(()=>f.calls.filter(call=>call.path==='/api/phone/radios').length===3);await f.click('cancelRadioConnection');
 fresh.resolve({radios:[radio]});await loading;assert.equal(resumed,0);assert.equal(cancelled,1);assert.equal(runInNewContext('deferredStationConnection',f.context),null);
});

test('leaving Radio after a background approval discards deferred station continuation',async()=>{
 const f=fixture();let resumed=0;f.context.window.resumePendingStationConnection=async()=>{resumed++;return true;};await approveInBackground(f);
 f.get('myRadio').hidden=true;runInNewContext('radioVisibilityChanged()',f.context);assert.equal(runInNewContext('deferredStationConnection',f.context),null);
 f.document.hidden=false;f.get('myRadio').hidden=false;f.answers.push({radios:[radio]});await f.load(true);assert.equal(resumed,0);
});

test('beginning another pairing discards a previous background approval continuation',async()=>{
 const f=fixture();let resumed=0;f.context.window.resumePendingStationConnection=async()=>{resumed++;return true;};await approveInBackground(f);
 f.document.hidden=false;await f.click('connectRadio');await f.click('radioAlreadyOnline');assert.equal(runInNewContext('deferredStationConnection',f.context),null);
 f.form.elements.device_code.value='8821';f.answers.push({claim_id:'next',confirmation_code:'1152'},{state:'denied'},{state:'cancelled'});await f.submit();await f.flush();f.answers.push({radios:[radio]});await f.load(true);assert.equal(resumed,0);
});

test('Connect another radio opens an independent pairing flow without adding a station or losing the existing radio',async()=>{
 const f=fixture();f.answers.push({radios:[radio]});await f.load();assert.equal(f.get('connectRadio').hidden,false);assert.equal(f.get('connectRadio').textContent,'Connect another radio');await f.click('connectRadio');assert.equal(f.get('radioConnectionChoices').hidden,false);await f.click('radioAlreadyOnline');assert.equal(f.form.hidden,false);assert.equal(f.get('linkedRadios').children.length,1);assert.equal(f.calls.some(call=>call.path==='/api/phone/add'),false);await f.click('radioConnectionExit');assert.equal(f.form.hidden,true);assert.equal(f.get('connectRadio').hidden,false);
});
