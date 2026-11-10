import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
import {runInNewContext} from 'node:vm';
const source=readFileSync(new URL('./public/assets/my-radio.js',import.meta.url),'utf8');
const site=readFileSync(new URL('./public/assets/site.js',import.meta.url),'utf8'),busySource=site.slice(site.indexOf('const formBusyStates='),site.indexOf('function loadHuman('));
function deferred(){let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return {promise,resolve,reject};}
async function until(check){for(let i=0;i<50&&!check();i++)await new Promise(setImmediate);assert.ok(check(),'Async checkpoint was not reached');}
function fixture({human=async()=> 'bot-proof',loadSession=async()=>({csrf:'fresh'}),cancel=async()=>({state:'cancelled'})}={}){
 const ids=new Map(),calls=[],answers=[],dialogs=[],selections=[],approvals=[],observers=[],humanSignals=[],cancellations=[];let sessionLoads=0;
 function node(tag='div'){return {tag,children:[],hidden:false,disabled:false,textContent:'',className:'',dataset:{},attributes:{},elements:{},setAttribute(k,v){this.attributes[k]=v;},removeAttribute(k){delete this.attributes[k];},dispatchEvent(){},append(...items){this.children.push(...items);},replaceChildren(...items){this.children=items;},before(){},focus(options){this.focusOptions=options;this.focusCount=(this.focusCount||0)+1;},querySelector(){return this.button;},querySelectorAll(selector){return selector==='button'?[this.button]:[...Object.values(this.elements),this.button];},reset(){this.resetCount=(this.resetCount||0)+1;}};}
 for(const id of ['myRadio','linkedRadios','connectRadio','connectRadioForm','cancelRadioConnection','radioConnectStatus','refreshRadios','navRadio','openWifiSetup'])ids.set(id,node());
 const form=ids.get('connectRadioForm');form.button=node('button');form.elements.device_code=Object.assign(node('input'),{value:'3961'});
 const document={hidden:false,createElement:node,addEventListener(){}},ctx={document,navigator:{onLine:true},Date,AbortController,crypto:{randomUUID},location:{hash:'#radio',search:''},history:{replaceState(){}},window:{addEventListener(){},dispatchEvent(){}},Event:class{constructor(type){this.type=type;}},CustomEvent:class{constructor(type,options){this.type=type;this.detail=options?.detail;}},MutationObserver:class{constructor(fn){observers.push(fn);}observe(){}},$:id=>ids.get(id),api:async(path,body)=>{calls.push({path,body});if(path==='/api/phone/claim/cancel'){cancellations.push(body);return cancel(body);}const next=answers.shift();if(next instanceof Error)throw next;if(next===undefined)throw Error('No fixture response');return await next;},human:(...args)=>{humanSignals.push(args[2]);return human(...args);},showRadioApproval(target,code){approvals.push({target,code});target.textContent=code+' — Match this number and tap Allow on your radio.';},loadOwnerSession:async()=>{sessionLoads++;return loadSession();},delay:async()=>{},reconcileSelectedRadio:radios=>radios[0]?.id||'',loadRadioInventory(){},rememberSelectedRadio:id=>selections.push(id),readSelectedRadio:()=>'',radioInventories:new Map(),listenerActionDialog:async(title,text)=>{dialogs.push({title,text});return true;},page(){ids.get('myRadio').hidden=false;},setTimeout(){return 1;},clearTimeout(){}};
 runInNewContext(busySource,ctx);runInNewContext(source,ctx);
 return {ctx,ids,form,calls,answers,dialogs,selections,approvals,document,humanSignals,cancellations,cancel:()=>ids.get('cancelRadioConnection').onclick(),sessionLoads:()=>sessionLoads,get:expression=>runInNewContext(expression,ctx),submit:()=>form.onsubmit({preventDefault(){},target:form}),leave(){ids.get('myRadio').hidden=true;observers[0]();},returnToRadio(){ids.get('myRadio').hidden=false;},observe(){observers[0]();}};
}
test('radio pairing captures the code, freezes fields, and allows only one in-flight claim',async()=>{
 const bot=deferred(),f=fixture({human:()=>bot.promise});f.answers.push({claim_id:'claim',confirmation_code:'5831'},{state:'approved',radio_id:'one'},{radios:[]});const first=f.submit();await f.submit();assert.equal(f.form.elements.device_code.disabled,true);assert.equal(f.form.button.disabled,true);f.form.elements.device_code.value='9999';bot.resolve('checked');await first;
 assert.equal(f.calls.filter(call=>call.path==='/api/phone/claim').length,1);assert.equal(f.calls[0].body.device_code,'3961');assert.equal(f.calls[0].body.turnstile_token,'checked');assert.deepEqual(f.selections,['one']);assert.equal(f.approvals.length,1);assert.equal(f.approvals[0].target,f.ids.get('radioConnectStatus'));assert.equal(f.approvals[0].code,'5831');assert.equal(f.dialogs.length,1);assert.equal(f.dialogs[0].title,'Radio connected');assert.equal(f.dialogs[0].text,'');assert.equal(f.ids.get('radioConnectStatus').textContent,'');assert.equal(f.form.button.disabled,false);assert.equal(f.form.elements.device_code.disabled,false);assert.equal(f.get('radioPairingBusy'),false);
});
test('leaving during a bot check stops the abandoned pairing before any claim is created',async()=>{
 const bot=deferred(),f=fixture({human:()=>bot.promise});const pairing=f.submit();f.leave();assert.equal(f.form.button.disabled,false);bot.resolve('checked');await pairing;assert.equal(f.calls.length,0);assert.equal(f.ids.get('myRadio').hidden,true);assert.equal(f.dialogs.length,0);assert.equal(f.form.resetCount,undefined);
});
test('a late physical approval cannot reopen Radio or show success after navigation away',async()=>{
 const check=deferred(),f=fixture();f.answers.push({claim_id:'claim',confirmation_code:'5831'},check.promise);const pairing=f.submit();await until(()=>f.calls.length===2);f.leave();const status=f.ids.get('radioConnectStatus').textContent;check.resolve({state:'approved',radio_id:'one'});await pairing;
 assert.equal(f.calls.filter(call=>call.path==='/api/phone/radios').length,0);assert.equal(f.ids.get('myRadio').hidden,true);assert.equal(f.ids.get('radioConnectStatus').textContent,status);assert.equal(f.selections.length,0);assert.equal(f.dialogs.length,0);assert.equal(f.form.resetCount,undefined);
});
test('an old pairing response cannot unlock or report errors on a newer pairing',async()=>{
 const old=deferred(),current=deferred(),f=fixture();f.answers.push(old.promise);const first=f.submit();await until(()=>f.calls.length===1);f.leave();f.returnToRadio();f.form.elements.device_code.value='7777';f.answers.push(current.promise);const second=f.submit();f.observe();await until(()=>f.calls.filter(call=>call.path==='/api/phone/claim').length===2);old.reject(Error('Old claim failed'));await first;
 assert.equal(f.form.button.disabled,true);assert.equal(f.form.elements.device_code.disabled,true);assert.equal(f.get('radioPairingBusy'),true);assert.doesNotMatch(f.ids.get('radioConnectStatus').textContent,/Old claim failed/);f.answers.push({state:'denied'});current.resolve({claim_id:'new-claim',confirmation_code:'2222'});await second;assert.equal(f.form.button.disabled,false);assert.equal(f.get('radioPairingBusy'),false);assert.match(f.ids.get('radioConnectStatus').textContent,/not approved/);
});
test('a pairing request failure preserves the code and restores controls for a retry',async()=>{
 const f=fixture();f.answers.push(Error('Temporary failure'));await f.submit();assert.equal(f.form.elements.device_code.value,'3961');assert.equal(f.form.resetCount,undefined);assert.equal(f.form.button.disabled,false);assert.match(f.ids.get('radioConnectStatus').textContent,/Temporary failure/);f.answers.push({claim_id:'retry',confirmation_code:'1234'},{state:'denied'});await f.submit();assert.equal(f.calls.filter(call=>call.path==='/api/phone/claim').length,2);
});

test('explicit reconnect refreshes the expired session before bot verification and still needs radio approval',async()=>{
 const session=deferred();let botChecks=0;const f=fixture({loadSession:()=>session.promise,human:async()=>{botChecks++;return 'fresh-check';}});f.get('showRadioReconnect()');const pairing=f.submit();
 assert.equal(f.sessionLoads(),1);assert.equal(botChecks,0);assert.equal(f.calls.length,0);assert.equal(f.form.elements.device_code.disabled,true);f.answers.push({claim_id:'reconnect',confirmation_code:'2222'},{state:'denied'});session.resolve({csrf:'fresh'});await pairing;
 assert.equal(botChecks,1);assert.equal(f.calls[0].body.device_code,'3961');assert.equal(f.calls[0].body.turnstile_token,'fresh-check');assert.equal(f.calls.filter(call=>call.path==='/api/phone/claim/status').length,1);assert.match(f.ids.get('radioConnectStatus').textContent,/not approved/);assert.equal(f.dialogs.length,0);
});

test('failed session refresh leaves reconnect retryable without creating a claim',async()=>{
 let fail=true,botChecks=0;const f=fixture({loadSession:async()=>{if(fail)throw Error('Cannot refresh session');return {csrf:'fresh'};},human:async()=>{botChecks++;return 'checked';}});f.get('showRadioReconnect()');await f.submit();
 assert.equal(botChecks,0);assert.equal(f.calls.length,0);assert.equal(f.form.button.disabled,false);assert.equal(f.form.elements.device_code.value,'3961');assert.equal(f.get('radioSessionExpired'),true);
 fail=false;f.answers.push({claim_id:'retry',confirmation_code:'1234'},{state:'denied'});await f.submit();assert.equal(f.sessionLoads(),2);assert.equal(botChecks,1);assert.equal(f.get('radioSessionExpired'),false);
});

test('leaving during session renewal abandons reconnect without a bot check or claim',async()=>{
 const session=deferred();let checks=0;const f=fixture({loadSession:()=>session.promise,human:async()=>{checks++;return 'checked';}});f.get('showRadioReconnect()');const pairing=f.submit();f.leave();session.resolve({csrf:'fresh'});await pairing;
 assert.equal(checks,0);assert.equal(f.calls.length,0);assert.equal(f.form.button.disabled,false);assert.equal(f.get('radioSessionExpired'),true);
});

test('Cancel connection aborts bot verification, immediately restores the same code and returns focus',async()=>{
 const f=fixture({human:(_form,_action,signal)=>new Promise((_resolve,reject)=>signal.addEventListener('abort',()=>reject(Object.assign(Error('Cancelled'),{name:'AbortError'})),{once:true}))});
 const pending=f.submit();assert.equal(f.ids.get('cancelRadioConnection').hidden,false);assert.equal(f.form.button.disabled,true);assert.equal(f.humanSignals[0].aborted,false);
 f.cancel();assert.equal(f.humanSignals[0].aborted,true);assert.equal(f.form.button.disabled,false);assert.equal(f.form.elements.device_code.disabled,false);assert.equal(f.form.elements.device_code.value,'3961');assert.equal(f.form.elements.device_code.focusOptions.preventScroll,true);assert.equal(f.ids.get('cancelRadioConnection').hidden,true);assert.equal(f.get('radioPairingBusy'),false);assert.equal(f.ids.get('radioConnectStatus').textContent,'Connection cancelled.');
 await pending;assert.equal(f.calls.length,0);assert.equal(f.form.resetCount,undefined);assert.equal(f.dialogs.length,0);
});

test('a cancelled bot check that ignores abort cannot create a claim or unlock the next attempt',async()=>{
 const old=deferred(),current=deferred();let count=0;const f=fixture({human:()=>count++?current.promise:old.promise});
 const first=f.submit();f.cancel();f.form.elements.device_code.value='7777';const second=f.submit();old.resolve('old-check');await first;
 assert.equal(f.calls.length,0);assert.equal(f.form.button.disabled,true);assert.equal(f.form.elements.device_code.disabled,true);assert.equal(f.get('radioPairingBusy'),true);assert.equal(f.ids.get('cancelRadioConnection').hidden,false);assert.equal(f.humanSignals[1].aborted,false);
 f.answers.push({claim_id:'current',confirmation_code:'1234'},{state:'denied'});current.resolve('current-check');await second;assert.equal(f.calls[0].body.device_code,'7777');assert.equal(f.form.button.disabled,false);assert.equal(f.ids.get('cancelRadioConnection').hidden,true);
});

test('cancel during claim creation ignores its late response and keeps a newer attempt frozen',async()=>{
 const old=deferred(),current=deferred(),f=fixture();f.answers.push(old.promise);const first=f.submit();await until(()=>f.calls.length===1);f.cancel();f.form.elements.device_code.value='7777';f.answers.push(current.promise);const second=f.submit();await until(()=>f.calls.filter(call=>call.path==='/api/phone/claim').length===2);
 old.resolve({claim_id:'old',confirmation_code:'5831'});await first;assert.equal(f.approvals.length,0);assert.equal(f.selections.length,0);assert.equal(f.dialogs.length,0);assert.equal(f.form.button.disabled,true);assert.equal(f.ids.get('cancelRadioConnection').hidden,false);
 f.answers.push({state:'denied'});current.resolve({claim_id:'current',confirmation_code:'1234'});await second;assert.equal(f.approvals.length,1);assert.equal(f.approvals[0].code,'1234');assert.equal(f.form.button.disabled,false);
});

test('Cancel connection ignores late approval without changing an existing radio selection or grant',async()=>{
 const late=deferred(),f=fixture();f.answers.push({claim_id:'claim',confirmation_code:'5831'},late.promise);const pending=f.submit();await until(()=>f.calls.length===2);f.cancel();const message=f.ids.get('radioConnectStatus').textContent;
 late.resolve({state:'approved',radio_id:'other'});await pending;assert.deepEqual(f.selections,[]);assert.deepEqual(f.dialogs,[]);assert.equal(f.form.resetCount,undefined);assert.equal(f.ids.get('radioConnectStatus').textContent,message);assert.equal(f.calls.some(call=>['/api/phone/unlink','/api/phone/logout'].includes(call.path)),false);assert.equal(f.form.elements.device_code.value,'3961');
});

test('switching browser tabs preserves active pairing and avoids opening success over another page',async()=>{
 const late=deferred(),f=fixture();f.answers.push({claim_id:'claim',confirmation_code:'5831'},late.promise,{radios:[]});const pending=f.submit();await until(()=>f.calls.length===2);
 f.document.hidden=true;f.observe();assert.equal(f.humanSignals[0].aborted,false);assert.equal(f.form.button.disabled,true);assert.equal(f.get('radioPairingBusy'),true);
 late.resolve({state:'approved',radio_id:'one'});await pending;assert.deepEqual(f.selections,['one']);assert.equal(f.dialogs.length,0);assert.equal(f.form.button.disabled,false);
});

test('Cancel sends a session-scoped request reference even before claim creation has returned',async()=>{
 const created=deferred(),f=fixture();f.answers.push(created.promise);const pending=f.submit();await until(()=>f.calls.length===1);const request=f.calls[0].body;
 assert.match(request.request_id,/^[0-9a-f]{32}$/);f.cancel();assert.equal(f.cancellations.length,1);assert.equal(f.cancellations[0].request_id,request.request_id);assert.deepEqual(Object.keys(f.cancellations[0]),['request_id']);
 f.cancel();assert.equal(f.cancellations.length,1);created.resolve({claim_id:'late',confirmation_code:'1234'});await pending;assert.equal(f.cancellations.length,1);assert.equal(f.approvals.length,0);assert.equal(f.selections.length,0);
});

test('the next pairing waits for cancellation cleanup and uses a different request reference',async()=>{
 const old=deferred(),cleanup=deferred(),current=deferred(),f=fixture({cancel:()=>cleanup.promise});f.answers.push(old.promise);const first=f.submit();await until(()=>f.calls.length===1);const oldReference=f.calls[0].body.request_id;
 f.cancel();f.form.elements.device_code.value='7777';f.answers.push(current.promise);const second=f.submit();await until(()=>f.humanSignals.length===2);assert.equal(f.calls.filter(call=>call.path==='/api/phone/claim').length,1);assert.equal(f.form.button.disabled,true);
 cleanup.resolve({state:'cancelled'});await until(()=>f.calls.filter(call=>call.path==='/api/phone/claim').length===2);const request=f.calls.filter(call=>call.path==='/api/phone/claim')[1];assert.notEqual(request.body.request_id,oldReference);assert.equal(request.body.device_code,'7777');
 old.resolve({claim_id:'old',confirmation_code:'1111'});await first;assert.equal(f.form.button.disabled,true);f.answers.push({state:'denied'});current.resolve({claim_id:'new',confirmation_code:'2222'});await second;
});

test('an unconfirmed server cancellation tells the user to deny the still-visible radio prompt',async()=>{
 const late=deferred(),cleanup=deferred(),f=fixture({cancel:()=>cleanup.promise});f.answers.push(late.promise);const pending=f.submit();await until(()=>f.calls.length===1);f.cancel();assert.equal(f.form.button.disabled,false);
 cleanup.reject(Error('No internet'));await until(()=>f.ids.get('radioConnectStatus').textContent.includes('Could not confirm cancellation'));assert.match(f.ids.get('radioConnectStatus').textContent,/Tap Deny/);
 late.resolve({claim_id:'late',confirmation_code:'5831'});await pending;assert.equal(f.selections.length,0);assert.equal(f.dialogs.length,0);assert.match(f.ids.get('radioConnectStatus').textContent,/Could not confirm cancellation/);
});

test('an old cancellation failure cannot replace the instructions for a new pairing',async()=>{
 const old=deferred(),cleanup=deferred(),current=deferred(),f=fixture({cancel:()=>cleanup.promise});f.answers.push(old.promise);const first=f.submit();await until(()=>f.calls.length===1);f.cancel();f.answers.push(current.promise);const second=f.submit();
 cleanup.reject(Error('Old cancellation failed'));await until(()=>f.calls.filter(call=>call.path==='/api/phone/claim').length===2);assert.doesNotMatch(f.ids.get('radioConnectStatus').textContent,/Could not confirm cancellation/);assert.equal(f.form.button.disabled,true);
 old.resolve({claim_id:'old',confirmation_code:'1111'});await first;f.answers.push({state:'denied'});current.resolve({claim_id:'new',confirmation_code:'2222'});await second;
});

test('a successful HTTP response still must confirm the cancellation state',async()=>{
 const created=deferred(),f=fixture({cancel:async()=>({state:'waiting'})});f.answers.push(created.promise);const pending=f.submit();await until(()=>f.calls.length===1);f.cancel();
 await until(()=>f.ids.get('radioConnectStatus').textContent.includes('Could not confirm cancellation'));created.resolve({claim_id:'late',confirmation_code:'1234'});await pending;assert.equal(f.approvals.length,0);assert.equal(f.dialogs.length,0);
});

test('a confirmed connection is retained when the user leaves during the status refresh',async()=>{
 const refresh=deferred(),f=fixture();f.answers.push({claim_id:'claim',confirmation_code:'5831'},{state:'approved',radio_id:'one'},refresh.promise);const pending=f.submit();await until(()=>f.calls.some(call=>call.path==='/api/phone/radios'));
 assert.equal(f.ids.get('cancelRadioConnection').hidden,true);f.leave();refresh.resolve({radios:[]});await pending;assert.equal(f.cancellations.length,0);assert.deepEqual(f.selections,['one']);assert.equal(f.dialogs.length,0);
});
