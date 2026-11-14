import {test} from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import {randomUUID} from 'node:crypto';

const site=readFileSync(new URL('./public/assets/site.js',import.meta.url),'utf8');
const busySource=site.slice(site.indexOf('const formBusyStates='),site.indexOf('function loadHuman()'));
const submitSource=site.slice(site.indexOf('const supportFieldErrors='),site.indexOf("$('closeTicketSuccess').onclick="));
function deferred(){let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return {promise,resolve,reject};}
function fixture(){
 const nodes=new Map(),calls=[],humans=[],events=[],timers=new Map(),observers=[];let humanResult='checked-token',apiResult={reference:'a'.repeat(32)},clock=1800000000000,nextTimer=0;
 function node(id,tagName='DIV'){
  const listeners={};const element={id,tagName,children:[],elements:{},dataset:{},attrs:{},disabled:false,value:'',defaultValue:'',textContent:'',hidden:false,open:false,
   setAttribute(key,value){this.attrs[key]=value;},getAttribute(key){return this.attrs[key]??null;},removeAttribute(key){delete this.attrs[key];},
   after(other){this.afterNode=other;},focus(){this.focused=(this.focused||0)+1;},append(...items){this.children.push(...items);},
   addEventListener(type,fn){(listeners[type]??=[]).push(fn);},dispatchEvent(event){for(const fn of listeners[event.type]||[])fn(event);},
   querySelectorAll(selector){const tags=selector.split(',').map(value=>value.toUpperCase());return this.children.filter(child=>tags.includes(child.tagName));},
   querySelector(selector){return this.children.find(child=>child.tagName===selector.toUpperCase());},
   reset(){this.resetCount=(this.resetCount||0)+1;for(const field of Object.values(this.elements))field.value=field.defaultValue;delete this.dataset.dirty;this.dispatchEvent(new Event('reset'));},
   showModal(){this.open=true;this.shown=(this.shown||0)+1;},close(){this.open=false;this.dispatchEvent(new Event('close'));}
  };nodes.set(id,element);return element;
 }
 const form=node('ticketForm','FORM');
 for(const [name,value] of Object.entries({name:'A listener',email:'listener@example.com',device_code:'3961',subject:'Station problem',message:'The selected station has no sound.',station_code:'13'})){
  const field=node('ticket-'+name,name==='message'?'TEXTAREA':name==='subject'?'SELECT':'INPUT');field.name=name;field.form=form;field.value=value;form.elements[name]=field;form.children.push(field);
 }
 const submit=node('ticket-submit','BUTTON'),clear=node('clearTicketStation','BUTTON');form.children.push(submit,clear);form.dataset.dirty='1';
 node('support');node('ticketMessage');node('ticketReference');const success=node('ticketSuccess','DIALOG');success.children.push(node('ticketSuccessTitle','H2'),node('ticketSuccessDescription','P'));node('otherDialog','DIALOG');
 const document={hidden:false,body:node('body'),addEventListener(){},createElement(tag){return node('generated-'+nodes.size,tag.toUpperCase());},querySelector(selector){return selector==='dialog[open]'?[...nodes.values()].find(element=>element.tagName==='DIALOG'&&element.open):null;}};
 class BrowserFormData{constructor(target){this.entries=Object.values(target.elements).filter(field=>!field.disabled).map(field=>[field.name,field.value]);}[Symbol.iterator](){return this.entries[Symbol.iterator]();}}
 const context=vm.createContext({crypto:{randomUUID},Event,Date:class extends Date{static now(){return clock;}},setTimeout(fn,delay){const id=++nextTimer;timers.set(id,{fn,delay});return id;},clearTimeout:id=>timers.delete(id),MutationObserver:class{constructor(fn){observers.push(fn);}observe(){}},CustomEvent:class{constructor(type,{detail}){this.type=type;this.detail=detail;}},FormData:BrowserFormData,document,$:id=>nodes.get(id),window:{dispatchEvent:event=>events.push(event)},human:async(container,action)=>{humans.push({container,action});return await humanResult;},api:async(path,body)=>{calls.push({path,body:{...body}});return await apiResult;}});
 vm.runInContext(busySource+'\n'+submitSource,context);
 return {nodes,document,form,submit,clear,calls,humans,events,timers,get:expression=>vm.runInContext(expression,context),advance(ms){clock+=ms;vm.runInContext('renderSupportTicketCooldown();renderSupportProof();',context);},leave(){nodes.get('support').hidden=true;for(const fn of observers)fn();},setHuman(value){humanResult=value;},setApi(value){apiResult=value;},send(){return form.onsubmit({target:form,preventDefault(){}});},type(name,value){const field=form.elements[name];if(!field.disabled)field.value=value;}};
}
async function until(check){for(let i=0;i<100&&!check();i++)await new Promise(setImmediate);assert.ok(check(),'Expected async checkpoint');}

test('a pending support security check freezes the captured draft and suppresses repeated submissions',async()=>{
 const f=fixture(),bot=deferred(),request=deferred();f.setHuman(bot.promise);f.setApi(request.promise);const first=f.send();
 assert.equal(f.humans.length,1);assert.equal(f.form.dataset.busy,'1');assert.equal(f.submit.disabled,true);assert.equal(f.clear.disabled,true);
 for(const field of Object.values(f.form.elements))assert.equal(field.disabled,true);
 f.type('message','An unsent replacement');await f.send();assert.equal(f.humans.length,1);assert.equal(f.calls.length,0);
 bot.resolve('checked-token');await until(()=>f.calls.length===1);await f.send();assert.equal(f.calls.length,1);
 assert.match(f.calls[0].body.request_id,/^[a-f0-9]{32}$/);
 assert.deepEqual(f.calls[0],{path:'/api/support/ticket',body:{name:'A listener',email:'listener@example.com',device_code:'3961',subject:'Station problem',message:'The selected station has no sound.',station_code:'13',request_id:f.calls[0].body.request_id,turnstile_token:'checked-token'}});
 request.resolve({reference:'a'.repeat(32)});await first;assert.equal(f.form.resetCount,1);assert.equal(f.events.length,1);assert.equal(f.nodes.get('ticketSuccess').shown,1);assert.equal(f.form.dataset.busy,undefined);assert.equal(f.submit.disabled,false);assert.equal(f.clear.disabled,false);
 for(const field of Object.values(f.form.elements))assert.equal(field.disabled,false);
});

test('security-check failure keeps every support field and selected station ready for retry',async()=>{
 const f=fixture(),bot=deferred();f.setHuman(bot.promise);const first=f.send();bot.reject(Error('Security check could not complete.'));await first;
 assert.equal(f.calls.length,0);assert.equal(f.form.resetCount,undefined);assert.equal(f.form.elements.message.value,'The selected station has no sound.');assert.equal(f.form.elements.email.value,'listener@example.com');assert.equal(f.form.elements.station_code.value,'13');assert.equal(f.form.dataset.dirty,'1');assert.equal(f.form.dataset.busy,undefined);assert.equal(f.nodes.get('ticketMessage').textContent,'Security check could not complete.');assert.equal(f.nodes.get('ticketSuccess').open,false);
 f.setHuman('retry-token');await f.send();assert.equal(f.calls.length,1);assert.equal(f.calls[0].body.turnstile_token,'retry-token');assert.equal(f.nodes.get('ticketSuccess').shown,1);
});

test('a failed ticket send preserves its draft and previous disabled controls',async()=>{
 const f=fixture(),request=deferred();f.clear.disabled=true;f.setApi(request.promise);const first=f.send();await until(()=>f.calls.length===1);request.reject(Error('Connection interrupted.'));await first;
 assert.equal(f.form.resetCount,undefined);assert.equal(f.form.elements.message.value,'The selected station has no sound.');assert.equal(f.form.elements.station_code.value,'13');assert.equal(f.form.dataset.dirty,'1');assert.equal(f.form.elements.message.disabled,false);assert.equal(f.clear.disabled,true);assert.equal(f.submit.disabled,false);assert.equal(f.nodes.get('ticketMessage').textContent,'Connection interrupted.');assert.equal(f.events.length,0);assert.equal(f.nodes.get('ticketSuccess').open,false);
});

test('a ticket completing after leaving Support keeps its receipt without opening a modal on the new page',async()=>{
 const f=fixture(),request=deferred();f.setApi(request.promise);const first=f.send();await until(()=>f.calls.length===1);f.nodes.get('support').hidden=true;request.resolve({reference:'b'.repeat(32)});await first;
 assert.equal(f.nodes.get('ticketSuccess').open,false);assert.equal(f.form.resetCount,1);assert.equal(f.events.length,1);assert.equal(f.events[0].detail.reference,'b'.repeat(32));assert.match(f.nodes.get('ticketMessage').textContent,new RegExp('Ticket sent.*'+'b'.repeat(32)));assert.equal(f.nodes.get('ticketReference').textContent,'Ticket reference: '+'b'.repeat(32));assert.equal(f.nodes.get('support').hidden,true);
 f.nodes.get('support').hidden=false;assert.equal(f.nodes.get('ticketSuccess').open,false);assert.match(f.nodes.get('ticketMessage').textContent,/Ticket sent/);
});

test('a ticket completing in a background browser tab records success without opening or deferring a modal',async()=>{
 const f=fixture(),request=deferred();f.setApi(request.promise);const first=f.send();await until(()=>f.calls.length===1);f.document.hidden=true;request.resolve({reference:'c'.repeat(32)});await first;
 assert.equal(f.nodes.get('ticketSuccess').open,false);assert.equal(f.form.resetCount,1);assert.equal(f.events[0].detail.reference,'c'.repeat(32));assert.match(f.nodes.get('ticketMessage').textContent,new RegExp('c'.repeat(32)));assert.equal(f.submit.disabled,false);f.document.hidden=false;assert.equal(f.nodes.get('ticketSuccess').open,false);
});

test('a completed ticket never covers an active verification dialog',async()=>{
 const f=fixture(),request=deferred();f.setApi(request.promise);const first=f.send();await until(()=>f.calls.length===1);f.nodes.get('otherDialog').open=true;request.resolve({reference:'d'.repeat(32)});await first;
 assert.equal(f.nodes.get('otherDialog').open,true);assert.equal(f.nodes.get('ticketSuccess').open,false);assert.match(f.nodes.get('ticketMessage').textContent,/Ticket sent/);assert.equal(f.events[0].detail.reference,'d'.repeat(32));
});

test('blank required support fields fail beside the field before any security check',async()=>{
 for(const name of ['name','email','subject','message']){
  const f=fixture(),field=f.form.elements[name];field.value=' \n\t ';
  field.setAttribute('aria-describedby','existing-help');await f.send();
  assert.equal(f.humans.length,0);assert.equal(f.calls.length,0);assert.equal(field.focused,1);
  assert.equal(field.getAttribute('aria-invalid'),'true');assert.equal(field.afterNode.hidden,false);
  assert.match(field.getAttribute('aria-describedby'),/existing-help supportFieldError-/);
  field.value='A correction';field.dispatchEvent(new Event('input'));
  assert.equal(field.afterNode.hidden,true);assert.equal(field.getAttribute('aria-invalid'),null);
  assert.equal(field.getAttribute('aria-describedby'),'existing-help');
 }
});

test('lost-response retry reuses the same request with a fresh security check and keeps the draft',async()=>{
 const f=fixture();f.setApi({then(resolve,reject){reject(Error('Connection interrupted.'));}});await f.send();
 const first=f.calls[0].body.request_id;assert.match(first,/^[a-f0-9]{32}$/);assert.equal(f.form.resetCount,undefined);
 f.setHuman('fresh-token');f.setApi({reference:'e'.repeat(32)});await f.send();
 assert.equal(f.calls[1].body.request_id,first);assert.equal(f.calls[1].body.turnstile_token,'fresh-token');
 assert.equal(f.form.resetCount,1);assert.equal(f.form.supportTicketRequest,null);
});

test('request identity follows normalized draft content and changes when the message changes',async()=>{
 const f=fixture();f.form.elements.email.value=' Listener@EXAMPLE.com ';f.form.elements.message.value=' A message ';
 f.setApi({then(resolve,reject){reject(Error('Connection interrupted.'));}});await f.send();
 const first=f.calls[0].body.request_id;assert.equal(f.calls[0].body.email,'listener@example.com');assert.equal(f.calls[0].body.message,'A message');
 f.form.elements.email.value='listener@example.com';f.form.elements.message.value='A message';await f.send();assert.equal(f.calls[1].body.request_id,first);
 f.form.elements.message.value='A different message';await f.send();assert.notEqual(f.calls[2].body.request_id,first);
});

test('missing ticket confirmation keeps the request and draft so retry can recover the receipt',async()=>{
 const f=fixture();f.setApi({status:'ok'});await f.send();const id=f.calls[0].body.request_id;
 assert.equal(f.form.resetCount,undefined);assert.equal(f.events.length,0);assert.match(f.nodes.get('ticketMessage').textContent,/confirmation was unavailable/);
 f.setApi({reference:'f'.repeat(32)});await f.send();assert.equal(f.calls[1].body.request_id,id);assert.equal(f.form.resetCount,1);
});

test('a successful ticket ends its request identity even if the visitor sends the same content later',async()=>{
 const f=fixture(),values=Object.fromEntries(Object.entries(f.form.elements).map(([key,field])=>[key,field.value]));
 await f.send();const id=f.calls[0].body.request_id;for(const [key,value] of Object.entries(values))f.form.elements[key].value=value;
 await f.send();assert.notEqual(f.calls[1].body.request_id,id);assert.equal(f.form.resetCount,2);
});

const pendingProof={status:'verification_required',verification_id:'1'.repeat(32),expires_in:900,resend_after:60};
async function beginProof(f){f.setApi(pendingProof);await f.send();return {dialog:f.get('supportProofDialog'),form:f.get('supportProofForm'),code:f.get('supportProofCode'),verify:f.get('supportProofVerify'),resend:f.get('supportProofResend'),notice:f.get('supportProofNotice'),resume:f.get('supportProofResume')};}
function verifyProof(proof){return proof.form.onsubmit({preventDefault(){}});}

test('a first-contact email challenge preserves the entire draft and opens its private code dialog',async()=>{
 const f=fixture(),values=Object.fromEntries(Object.entries(f.form.elements).map(([name,field])=>[name,field.value])),proof=await beginProof(f);
 assert.equal(proof.dialog.open,true);assert.equal(proof.dialog.getAttribute('aria-labelledby'),'supportContactVerifyTitle');assert.equal(proof.code.autocomplete,'one-time-code');assert.equal(proof.code.inputMode,'numeric');assert.equal(proof.code.pattern,'[0-9]{6}');assert.equal(proof.resume.hidden,false);
 assert.equal(f.form.resetCount,undefined);assert.equal(f.events.length,0);assert.equal(f.nodes.get('ticketSuccess').open,false);assert.match(f.nodes.get('ticketMessage').textContent,/Verify your email.*draft is kept/);
 assert.deepEqual(Object.fromEntries(Object.entries(f.form.elements).map(([name,field])=>[name,field.value])),values);
 assert.equal(f.submit.disabled,false);assert.equal(f.form.dataset.dirty,'1');assert.equal(f.calls.length,1);assert.equal(proof.resend.disabled,true);assert.equal(proof.resend.textContent,'Resend in 60s');
});

test('a correct private email code submits once, clears proof and then shows the ticket receipt',async()=>{
 const f=fixture(),proof=await beginProof(f),reference='2'.repeat(32);proof.code.value='123456';f.setApi({status:'ok',reference});await verifyProof(proof);
 assert.deepEqual(f.calls[1],{path:'/api/support/ticket/verify',body:{verification_id:pendingProof.verification_id,code:'123456'}});assert.equal(f.humans.length,1);
 assert.equal(proof.dialog.open,false);assert.equal(f.get('supportContactProof'),null);assert.equal(proof.resume.hidden,true);assert.equal(proof.code.value,'');assert.equal(f.form.resetCount,1);assert.equal(f.form.supportTicketRequest,null);
 assert.equal(f.events.length,1);assert.equal(f.events[0].detail.reference,reference);assert.equal(f.nodes.get('ticketSuccess').open,true);
});

test('pasted private codes accept whitespace but never silently remove letters',async()=>{
 const f=fixture(),proof=await beginProof(f);proof.code.value='12x 3456';proof.code.dispatchEvent(new Event('input'));assert.equal(proof.code.value,'12x3456');await verifyProof(proof);
 assert.equal(f.calls.length,1);assert.match(proof.notice.textContent,/6-digit email code/);assert.equal(f.form.resetCount,undefined);
 proof.code.value=' 12 34\n56\t';proof.code.dispatchEvent(new Event('input'));assert.equal(proof.code.value,'123456');f.setApi({reference:'3'.repeat(32)});await verifyProof(proof);assert.equal(f.calls[1].body.code,'123456');assert.equal(f.form.resetCount,1);
});

test('closing and resuming the email proof keeps the draft without resending an email',async()=>{
 const f=fixture(),proof=await beginProof(f),request=f.calls[0].body.request_id;proof.code.value='123';proof.dialog.dispatchEvent(new Event('cancel',{cancelable:true}));
 assert.equal(proof.dialog.open,false);assert.equal(proof.code.value,'');assert.equal(proof.resume.hidden,false);assert.equal(f.form.elements.message.value,'The selected station has no sound.');assert.equal(f.form.supportTicketRequest.id,request);
 proof.resume.onclick();assert.equal(proof.dialog.open,true);assert.equal(f.calls.length,1);assert.equal(f.humans.length,1);assert.equal(f.form.resetCount,undefined);
});

test('a delayed verification after Close cannot erase a newer draft or open success',async()=>{
 const f=fixture(),proof=await beginProof(f),response=deferred();f.setApi(response.promise);proof.code.value='123456';const sending=verifyProof(proof);await until(()=>f.calls.length===2);
 proof.dialog.dispatchEvent(new Event('cancel',{cancelable:true}));f.type('message','A new unsent problem');response.resolve({reference:'4'.repeat(32)});await sending;
 assert.equal(proof.dialog.open,false);assert.equal(f.form.elements.message.value,'A new unsent problem');assert.equal(f.form.resetCount,undefined);assert.equal(f.events.length,0);assert.equal(f.nodes.get('ticketSuccess').open,false);
});

test('leaving Support invalidates pending verification and preserves the saved draft',async()=>{
 const f=fixture(),proof=await beginProof(f),response=deferred();f.setApi(response.promise);proof.code.value='123456';const sending=verifyProof(proof);await until(()=>f.calls.length===2);f.leave();response.resolve({reference:'5'.repeat(32)});await sending;
 assert.equal(proof.dialog.open,false);assert.equal(f.form.resetCount,undefined);assert.equal(f.form.elements.email.value,'listener@example.com');assert.equal(f.form.elements.station_code.value,'13');assert.equal(f.events.length,0);assert.equal(f.nodes.get('ticketSuccess').open,false);
 f.nodes.get('support').hidden=false;assert.equal(proof.dialog.open,false);assert.equal(proof.resume.hidden,false);
});

test('changing email abandons the old private proof and keeps the rest of the ticket draft',async()=>{
 const f=fixture(),proof=await beginProof(f),change=proof.dialog.children.find(node=>node.tagName==='BUTTON'&&node.textContent==='Change email');proof.code.value='123456';change.onclick();
 assert.equal(proof.dialog.open,false);assert.equal(proof.resume.hidden,true);assert.equal(f.get('supportContactProof'),null);assert.equal(proof.code.value,'');assert.equal(f.form.elements.email.focused,1);assert.equal(f.form.resetCount,undefined);assert.equal(f.form.elements.message.value,'The selected station has no sound.');assert.equal(f.calls.length,1);
});

test('a changed draft cannot resume or submit a private proof for the original problem',async()=>{
 const f=fixture(),proof=await beginProof(f);proof.dialog.dispatchEvent(new Event('cancel',{cancelable:true}));f.type('message','A different unsent problem');proof.resume.onclick();
 proof.code.value='123456';f.setApi({reference:'6'.repeat(32)});await verifyProof(proof);
 assert.equal(f.calls.length,1);assert.equal(f.form.resetCount,undefined);assert.equal(f.form.elements.message.value,'A different unsent problem');assert.equal(f.events.length,0);assert.equal(f.nodes.get('ticketSuccess').open,false);
});

test('a support retry cooldown disables submission, counts down and recovers the original enabled state',async()=>{
 const f=fixture(),error=Object.assign(Error('Please wait before sending another problem.'),{retry_after:60});f.setApi({then(resolve,reject){reject(error);}});await f.send();
 assert.equal(f.form.resetCount,undefined);assert.equal(f.submit.disabled,true);assert.equal(f.submit.textContent,'Try again in 60s');assert.equal(f.form.elements.message.value,'The selected station has no sound.');await f.send();assert.equal(f.calls.length,1);assert.equal(f.humans.length,1);
 f.advance(59000);assert.equal(f.submit.disabled,true);assert.equal(f.submit.textContent,'Try again in 1s');f.advance(1000);assert.equal(f.submit.disabled,false);assert.equal(f.submit.textContent,'Submit ticket');
 f.setApi({reference:'7'.repeat(32)});await f.send();assert.equal(f.calls.length,2);assert.equal(f.form.resetCount,1);
});

test('resending a private code after its cooldown requires a fresh bot check inside the proof dialog',async()=>{
 const f=fixture(),proof=await beginProof(f);f.advance(60000);assert.equal(proof.resend.disabled,false);assert.equal(proof.resend.textContent,'Resend email');proof.code.value='111111';
 f.setHuman('fresh-proof-check');f.setApi({expires_in:900,resend_after:60});await proof.resend.onclick();
 assert.equal(f.humans.length,2);assert.equal(f.humans[1].container,proof.form);assert.equal(f.humans[1].action,'support-ticket');assert.deepEqual(f.calls[1],{path:'/api/support/ticket/resend',body:{verification_id:pendingProof.verification_id,turnstile_token:'fresh-proof-check'}});
 assert.equal(proof.code.value,'');assert.equal(proof.resend.disabled,true);assert.equal(proof.resend.textContent,'Resend in 60s');assert.match(proof.notice.textContent,/newest email code/);assert.equal(f.form.resetCount,undefined);assert.equal(proof.dialog.open,true);
});
