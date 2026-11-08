import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
const source=readFileSync(new URL('./public/assets/site.js',import.meta.url),'utf8');
const sharedSource=source.slice(source.indexOf('let sharedOpenGeneration=0;'),source.indexOf('async function initializeSite()'));
const pageSource=source.slice(source.indexOf('function page('),source.indexOf('function message('));
const busySource=source.slice(source.indexOf('const formBusyStates='),source.indexOf('function loadHuman('));
function deferred(){let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return {promise,resolve,reject};}
async function until(check){for(let i=0;i<50&&!check();i++)await new Promise(setImmediate);assert.ok(check(),'Async checkpoint was not reached');}
function fixture({human=async()=> 'checked',dialog=async()=>true,useDeviceCode=false}={}){
 const ids=new Map(),calls=[],answers=[],dialogs=[],selected=[],refreshes=[];
 function node(tag='div'){return {tag,children:[],dataset:{},attributes:{},hidden:false,disabled:false,textContent:'',value:'',elements:{},setAttribute(k,v){this.attributes[k]=v;},removeAttribute(k){delete this.attributes[k];},dispatchEvent(){},querySelectorAll(selector){return selector==='button'?[this.button]:[...Object.values(this.elements),this.button];},append(...children){this.children.push(...children);},replaceChildren(...children){this.children=children;},focus(){},reset(){}};}
 const $=id=>{if(!ids.has(id))ids.set(id,node());return ids.get(id);},form=$('shareForm');form.button=node('button');const select=node('select');select.value='one';select.selectedOptions=[{textContent:'Device code 3961 · Online'}];select.options=[{value:'one'}];form.elements.radio_id=select;form.elements.device_code=Object.assign(node('input'),{value:'3961'});$('deviceLabel').hidden=!useDeviceCode;$('radioLabel').hidden=useDeviceCode;$('shared').hidden=false;$('shareName').textContent='First station';
 const ctx={document:{createElement:node},$: $,Event:class{constructor(type){this.type=type;}},Promise,Date,queueMicrotask,setTimeout(fn){queueMicrotask(fn);},api:async(path,body)=>{calls.push({path,body});if(!answers.length)throw Error('No fixture response');const result=answers.shift();if(result instanceof Error)throw result;return await result;},human,listenerActionDialog:async(...args)=>{dialogs.push(args);return await dialog(...args);},reconcileSelectedRadio:radios=>radios[0]?.id||'',rememberSelectedRadio:id=>selected.push(id),updateStationConfirmation:async()=>{},loadMyRadios:async()=>{},refreshRadioInventory:id=>refreshes.push(id)};
 runInNewContext('let sharedCode="10",shareRunning=false,sitePageGeneration=0;',ctx);runInNewContext(busySource,ctx);runInNewContext(pageSource,ctx);runInNewContext(sharedSource,ctx);
 return {ctx,ids,form,calls,answers,dialogs,selected,refreshes,id:$,get:expression=>runInNewContext(expression,ctx),open:runInNewContext('openShared',ctx),page:runInNewContext('page',ctx),submit:()=>form.onsubmit({preventDefault(){},target:form}),cancel(){runInNewContext('invalidateSharedView()',ctx);$('shared').hidden=true;},next(code='11'){runInNewContext('sharedCode='+JSON.stringify(code),ctx);$('shared').hidden=false;form.hidden=false;}};
}
test('a direct shared-link response cannot reopen Shared after the user selects another page',async()=>{
 const f=fixture(),pending=deferred();f.answers.push(pending.promise);const opening=f.open('10');f.page('myRadio');pending.resolve({name:'Old station',listener_code:'10'});await opening;assert.equal(f.id('shared').hidden,true);assert.equal(f.id('myRadio').hidden,false);assert.equal(f.id('shareName').textContent,'First station');assert.equal(f.calls.length,1);
});
test('an abandoned shared-link error is ignored instead of reaching another page',async()=>{
 for(const stage of ['station','radios']){const f=fixture(),pending=deferred();if(stage==='radios')f.answers.push({name:'First station',listener_code:'10'});f.answers.push(pending.promise);const opening=f.open('10');await until(()=>f.calls.length===(stage==='station'?1:2));f.page('myRadio');pending.reject(Error('Old shared-link error'));await opening;assert.equal(f.id('myRadio').hidden,false);assert.equal(f.id('message').textContent,'');}
});
test('cancelling while a shared-link bot check runs prevents a new pairing request',async()=>{
 const bot=deferred(),f=fixture({human:()=>bot.promise,useDeviceCode:true});const adding=f.submit();f.cancel();bot.resolve('checked');await adding;assert.equal(f.calls.length,0);assert.equal(f.get('shareRunning'),false);assert.equal(f.form.button.disabled,false);assert.equal(f.dialogs.length,0);
});
test('cancelling a shared pairing stops polling and never adds after a late approval',async()=>{
 const pending=deferred(),f=fixture({useDeviceCode:true});f.answers.push({claim_id:'claim',confirmation_code:'5831'},pending.promise);const adding=f.submit();await until(()=>f.calls.length===2);f.cancel();pending.resolve({state:'approved',radio_id:'one'});await adding;
 assert.equal(f.calls.filter(call=>call.path==='/api/phone/add').length,0);assert.equal(f.calls.filter(call=>call.path==='/api/phone/claim/status').length,1);assert.equal(f.selected.length,0);assert.equal(f.dialogs.length,0);assert.equal(f.get('shareRunning'),false);
});
test('a confirmation belonging to a closed station cannot send an add command',async()=>{
 const confirmation=deferred(),f=fixture({dialog:()=>confirmation.promise});const adding=f.submit();await until(()=>f.dialogs.length===1);f.cancel();confirmation.resolve(true);await adding;assert.equal(f.calls.length,0);assert.equal(f.get('shareRunning'),false);
});
test('a cancelled add acknowledgment cannot display success or refresh radio inventory',async()=>{
 const acknowledgment=deferred(),f=fixture();f.answers.push({command_id:'command'},acknowledgment.promise);const adding=f.submit();await until(()=>f.calls.length===2);f.cancel();acknowledgment.resolve({state:'added'});await adding;assert.equal(f.refreshes.length,0);assert.equal(f.dialogs.length,1);assert.doesNotMatch(f.id('shareStatus').textContent,/success/i);assert.equal(f.get('shareRunning'),false);
});
test('an old add request cannot unlock a new station request or replace its message',async()=>{
 const old=deferred(),fresh=deferred(),f=fixture();f.answers.push(old.promise);const first=f.submit();await until(()=>f.calls.length===1);f.cancel();f.next();f.answers.push(fresh.promise);const second=f.submit();await until(()=>f.calls.length===2);old.reject(Error('Old request failed'));await first;
 assert.equal(f.get('shareRunning'),true);assert.equal(f.form.button.disabled,true);assert.equal(f.form.elements.radio_id.disabled,true);assert.doesNotMatch(f.id('shareStatus').textContent,/Old request failed/);f.cancel();fresh.resolve({command_id:'new-command'});await second;assert.equal(f.form.button.disabled,false);assert.equal(f.calls.filter(call=>call.path==='/api/phone/command/status').length,0);
});
