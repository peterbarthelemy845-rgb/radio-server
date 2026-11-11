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
 const context={document,navigator,Date:Clock,URLSearchParams,AbortController,crypto:{randomUUID},location:{hash:'#radio',search:''},history:{replaceState(){}},
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

test('automatic empty status refreshes preserve the current setup step and input',async()=>{
 const f=fixture();f.answers.push({radios:[]});await f.load();await f.click('connectRadio');f.answers.push({radios:[]});await f.load(true);
 assert.equal(f.get('radioConnectionChoices').hidden,false);assert.equal(f.form.hidden,true);
 await f.click('radioAlreadyOnline');f.form.elements.device_code.value='0012';f.answers.push({radios:[]});await f.load(true);
 assert.equal(f.form.hidden,false);assert.equal(f.form.elements.device_code.value,'0012');assert.equal(f.get('connectRadio').hidden,true);
});

test('an existing linked radio bypasses all setup and comes online without a new claim',async()=>{
 const f=fixture();f.answers.push({radios:[{...radio,online:false}]});await f.load();const card=f.get('linkedRadios').children[0];
 assert.equal(f.form.hidden,true);assert.equal(f.get('connectRadio').hidden,true);assert.equal(f.get('radioConnectionChoices').hidden,true);assert.equal(f.get('openWifiSetup').hidden,false);
 f.advance(10000);f.answers.push({radios:[radio]});await f.load(true);
 assert.equal(f.get('linkedRadios').children[0],card);assert.equal(card.children[0].children[1].textContent,'Online');assert.equal(f.get('openWifiSetup').hidden,true);
 assert.deepEqual(f.calls.map(call=>call.path),['/api/phone/radios','/api/phone/radios']);
});

test('a remembered radio learned during setup closes code entry without creating another pairing',async()=>{
 const f=fixture();f.answers.push({radios:[]});await f.load();await f.click('connectRadio');await f.click('radioAlreadyOnline');f.form.elements.device_code.value='3961';
 f.answers.push({radios:[radio]});await f.load(true);
 assert.equal(f.form.hidden,true);assert.equal(f.get('radioConnectionChoices').hidden,true);assert.equal(f.get('connectRadio').hidden,true);assert.equal(f.get('linkedRadios').children.length,1);
 f.showCode();assert.equal(f.form.hidden,true);assert.equal(f.calls.some(call=>call.path.includes('/claim')),false);
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

test('approval queues a fresh status request when the old initial request is held, even while success feedback is open',async()=>{
 const success=deferred(),f=fixture({dialog:()=>success.promise}),initial=deferred(),decision=deferred();f.answers.push(initial.promise);const initialLoad=f.load();
 await f.click('connectRadio');await f.click('radioAlreadyOnline');f.form.elements.device_code.value='3961';f.answers.push({claim_id:'claim',confirmation_code:'5831'},decision.promise);const pairing=f.submit();
 await until(()=>f.calls.some(call=>call.path==='/api/phone/claim/status'));decision.resolve({state:'approved',radio_id:'one'});
 await until(()=>runInNewContext('radioReloadRequested',f.context));assert.equal(f.form.button.disabled,true);assert.equal(f.calls.filter(call=>call.path==='/api/phone/radios').length,1);
 f.answers.push({radios:[radio]});initial.resolve({radios:[]});await initialLoad;
 await until(()=>f.get('linkedRadios').children.length===1);assert.equal(f.calls.filter(call=>call.path==='/api/phone/radios').length,2);
 assert.equal(f.get('linkedRadios').children[0].children[0].children[1].textContent,'Online');assert.equal(f.form.hidden,true);assert.equal(f.get('connectRadio').hidden,true);assert.equal(f.calls.some(call=>call.path==='/api/phone/claim/cancel'),false);
 success.resolve(true);await pairing;assert.equal(f.form.button.disabled,false);
});
