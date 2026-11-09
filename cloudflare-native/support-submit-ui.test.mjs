import {test} from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';

const site=readFileSync(new URL('./public/assets/site.js',import.meta.url),'utf8');
const busySource=site.slice(site.indexOf('const formBusyStates='),site.indexOf('function loadHuman()'));
const submitSource=site.slice(site.indexOf("$('ticketForm').onsubmit="),site.indexOf("$('closeTicketSuccess').onclick="));
function deferred(){let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return {promise,resolve,reject};}
function fixture(){
 const nodes=new Map(),calls=[],humans=[],events=[];let humanResult='checked-token',apiResult={reference:'a'.repeat(32)};
 function node(id,tagName='DIV'){
  const listeners={};const element={id,tagName,children:[],elements:{},dataset:{},attrs:{},disabled:false,value:'',defaultValue:'',textContent:'',hidden:false,open:false,
   setAttribute(key,value){this.attrs[key]=value;},removeAttribute(key){delete this.attrs[key];},
   addEventListener(type,fn){(listeners[type]??=[]).push(fn);},dispatchEvent(event){for(const fn of listeners[event.type]||[])fn(event);},
   querySelectorAll(selector){const tags=selector.split(',').map(value=>value.toUpperCase());return this.children.filter(child=>tags.includes(child.tagName));},
   querySelector(selector){return this.children.find(child=>child.tagName===selector.toUpperCase());},
   reset(){this.resetCount=(this.resetCount||0)+1;for(const field of Object.values(this.elements))field.value=field.defaultValue;delete this.dataset.dirty;this.dispatchEvent(new Event('reset'));},
   showModal(){this.open=true;this.shown=(this.shown||0)+1;}
  };nodes.set(id,element);return element;
 }
 const form=node('ticketForm','FORM');
 for(const [name,value] of Object.entries({name:'A listener',email:'listener@example.com',device_code:'3961',subject:'Station problem',message:'The selected station has no sound.',station_code:'13'})){
  const field=node('ticket-'+name,name==='message'?'TEXTAREA':name==='subject'?'SELECT':'INPUT');field.name=name;field.value=value;form.elements[name]=field;form.children.push(field);
 }
 const submit=node('ticket-submit','BUTTON'),clear=node('clearTicketStation','BUTTON');form.children.push(submit,clear);form.dataset.dirty='1';
 node('support');node('ticketMessage');node('ticketReference');const success=node('ticketSuccess','DIALOG');success.children.push(node('ticketSuccessTitle','H2'),node('ticketSuccessDescription','P'));node('otherDialog','DIALOG');
 const document={hidden:false,querySelector(selector){return selector==='dialog[open]'?[...nodes.values()].find(element=>element.tagName==='DIALOG'&&element.open):null;}};
 class BrowserFormData{constructor(target){this.entries=Object.values(target.elements).filter(field=>!field.disabled).map(field=>[field.name,field.value]);}[Symbol.iterator](){return this.entries[Symbol.iterator]();}}
 const context=vm.createContext({Event,CustomEvent:class{constructor(type,{detail}){this.type=type;this.detail=detail;}},FormData:BrowserFormData,document,$:id=>nodes.get(id),window:{dispatchEvent:event=>events.push(event)},human:async(container,action)=>{humans.push({container,action});return await humanResult;},api:async(path,body)=>{calls.push({path,body:{...body}});return await apiResult;}});
 vm.runInContext(busySource+'\n'+submitSource,context);
 return {nodes,document,form,submit,clear,calls,humans,events,setHuman(value){humanResult=value;},setApi(value){apiResult=value;},send(){return form.onsubmit({target:form,preventDefault(){}});},type(name,value){const field=form.elements[name];if(!field.disabled)field.value=value;}};
}
async function until(check){for(let i=0;i<100&&!check();i++)await new Promise(setImmediate);assert.ok(check(),'Expected async checkpoint');}

test('a pending support security check freezes the captured draft and suppresses repeated submissions',async()=>{
 const f=fixture(),bot=deferred(),request=deferred();f.setHuman(bot.promise);f.setApi(request.promise);const first=f.send();
 assert.equal(f.humans.length,1);assert.equal(f.form.dataset.busy,'1');assert.equal(f.submit.disabled,true);assert.equal(f.clear.disabled,true);
 for(const field of Object.values(f.form.elements))assert.equal(field.disabled,true);
 f.type('message','An unsent replacement');await f.send();assert.equal(f.humans.length,1);assert.equal(f.calls.length,0);
 bot.resolve('checked-token');await until(()=>f.calls.length===1);await f.send();assert.equal(f.calls.length,1);
 assert.deepEqual(f.calls[0],{path:'/api/support/ticket',body:{name:'A listener',email:'listener@example.com',device_code:'3961',subject:'Station problem',message:'The selected station has no sound.',station_code:'13',turnstile_token:'checked-token'}});
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
