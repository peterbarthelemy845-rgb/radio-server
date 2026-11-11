import {test} from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';

const source=readFileSync(new URL('./public/assets/station-code-recovery.js',import.meta.url),'utf8');
function deferred(){let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return {promise,resolve,reject};}
function fixture(){
 const nodes=new Map(),calls=[],checks=[],observations=[];
 let humanResult='valid-bot-token',apiResult={status:'ok'},focused=null;
 function node(id){const listeners={};const element={id,dataset:{},hidden:false,disabled:false,open:false,textContent:'',value:'',elements:{},addEventListener(type,fn){(listeners[type]??=[]).push(fn);},focus(){focused=this;},showModal(){this.open=true;},close(){this.open=false;for(const fn of listeners.close||[])fn();}};nodes.set(id,element);return element;}
 for(const id of ['openStationCodeRecovery','stationCodeRecovery','stationCodeRecoveryForm','stationCodeRecoveryStatus','closeStationCodeRecovery','login','loginForm'])node(id);
 nodes.get('loginForm').elements.email={value:'  owner@example.com  '};nodes.get('stationCodeRecoveryForm').elements.email={value:'',disabled:false,focus(){focused=this;}};
 const context=vm.createContext({document:{getElementById:id=>nodes.get(id)},window:{appI18n:{t:key=>key}},sitePageGeneration:1,MutationObserver:class{constructor(fn){observations.push(fn);}observe(){}},
  busy(form,on){form.elements.email.disabled=on;form.disabled=on;},human:async(form,action)=>{checks.push({form,action});return await humanResult;},api:async(path,body)=>{calls.push({path,body});if(apiResult instanceof Error)throw apiResult;return await apiResult;}});
 vm.runInContext(source,context);
 const open=()=>nodes.get('openStationCodeRecovery').onclick(),close=()=>nodes.get('closeStationCodeRecovery').onclick(),submit=()=>nodes.get('stationCodeRecoveryForm').onsubmit({preventDefault(){}});
 return {nodes,context,calls,checks,open,close,submit,get focused(){return focused;},human(value){humanResult=value;},answer(value){apiResult=value;},hideLogin(){nodes.get('login').hidden=true;for(const fn of observations)fn();}};
}
async function until(check){for(let i=0;i<50&&!check();i++)await new Promise(resolve=>setImmediate(resolve));assert.ok(check());}

test('recovery prefills the registered address and sends only email and bot proof without granting access',async()=>{
 const f=fixture();f.open();assert.equal(f.nodes.get('stationCodeRecovery').open,true);assert.equal(f.nodes.get('stationCodeRecoveryForm').elements.email.value,'owner@example.com');await f.submit();
 assert.equal(f.checks[0].action,'station-code-recovery');assert.equal(f.calls[0].path,'/api/owner/recover-code');assert.deepEqual({...f.calls[0].body},{email:'owner@example.com',turnstile_token:'valid-bot-token'});assert.match(f.nodes.get('stationCodeRecoveryStatus').textContent,/If this email has a registered station/);assert.equal(f.nodes.get('stationCodeRecoveryStatus').dataset.i18n,'recovery.sent');assert.equal(f.focused,f.nodes.get('stationCodeRecoveryStatus'));
});
test('recovery freezes captured fields, suppresses duplicate submits and restores them after failure',async()=>{
 const f=fixture(),pending=deferred();f.human(pending.promise);f.open();const first=f.submit();assert.equal(f.nodes.get('stationCodeRecoveryForm').elements.email.disabled,true);assert.equal(f.nodes.get('openStationCodeRecovery').disabled,true);await f.submit();assert.equal(f.checks.length,1);pending.reject(new Error('Security check could not complete.'));await first;
 assert.equal(f.calls.length,0);assert.equal(f.nodes.get('stationCodeRecoveryForm').elements.email.value,'owner@example.com');assert.equal(f.nodes.get('stationCodeRecoveryForm').elements.email.disabled,false);assert.equal(f.nodes.get('openStationCodeRecovery').disabled,false);assert.match(f.nodes.get('stationCodeRecoveryStatus').textContent,/could not complete/);
});
test('closing recovery while bot verification runs prevents the later API submission',async()=>{
 const f=fixture(),pending=deferred();f.human(pending.promise);f.open();const request=f.submit();f.close();pending.resolve('valid');await request;assert.equal(f.calls.length,0);assert.equal(f.nodes.get('stationCodeRecovery').open,false);assert.equal(f.nodes.get('openStationCodeRecovery').disabled,false);
});
test('a late recovery response after close cannot overwrite the next view or steal focus',async()=>{
 const f=fixture(),pending=deferred();f.answer(pending.promise);f.open();const request=f.submit();await until(()=>f.calls.length===1);f.close();const focus=f.focused;pending.resolve({status:'ok'});await request;assert.equal(f.nodes.get('stationCodeRecovery').open,false);assert.equal(f.focused,focus);assert.notEqual(f.nodes.get('stationCodeRecoveryStatus').dataset.i18n,'recovery.sent');
});
test('page navigation closes recovery and ignores its stale error',async()=>{
 const f=fixture(),pending=deferred();f.answer(pending.promise);f.open();const request=f.submit();await until(()=>f.calls.length===1);f.context.sitePageGeneration++;f.hideLogin();pending.reject(new Error('Late failure'));await request;assert.equal(f.nodes.get('stationCodeRecovery').open,false);assert.doesNotMatch(f.nodes.get('stationCodeRecoveryStatus').textContent,/Late failure/);
});
test('Device Code entry suggests numeric keyboards without rejecting legacy letter codes',()=>{
 const html=readFileSync(new URL('./public/index.html',import.meta.url),'utf8');const fields=[...html.matchAll(/<input\b[^>]*name="device_code"[^>]*>/g)].map(match=>match[0]);assert.equal(fields.length,3);for(const field of fields){assert.match(field,/inputmode="numeric"/);assert.match(field,/autocapitalize="off"/);assert.doesNotMatch(field,/type="number"|pattern=/);}
 assert.match(html,/<button id="openStationCodeRecovery"[^>]*type="button"/);assert.match(readFileSync(new URL('./public/assets/feature-loader.js',import.meta.url),'utf8'),/station-code-recovery\.js/);
});
