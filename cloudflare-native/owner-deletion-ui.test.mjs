import {test} from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';

function deferred(){let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return {promise,resolve,reject};}
function fixture(){
 const nodes=new Map(),answers=[],calls=[],pages=[],busyCalls=[],snapshots=new WeakMap();let refreshes=0;
 const document={hidden:false,activeElement:null};
 function node(id,tagName='DIV'){
  const listeners={};const value={id,tagName,type:tagName==='BUTTON'?'button':'text',children:[],elements:{},dataset:{},attrs:{},disabled:false,hidden:false,open:false,textContent:'',value:'',
   addEventListener(type,fn){(listeners[type]??=[]).push(fn);},dispatchEvent(event){for(const fn of listeners[event.type]||[])fn(event);return !event.defaultPrevented;},setAttribute(k,v){this.attrs[k]=v;},removeAttribute(k){delete this.attrs[k];},focus(){document.activeElement=this;},
   querySelectorAll(selector){const tags=selector.split(',').map(tag=>tag.trim().toUpperCase());return this.children.flatMap(child=>[...(tags.includes(child.tagName)?[child]:[]),...child.querySelectorAll(selector)]);},querySelector(selector){if(selector.includes('button'))return this.querySelectorAll('button')[0]||null;return null;},
   reset(){this.resetCalled=true;for(const field of Object.values(this.elements))field.value='';},showModal(){this.open=true;},close(){this.open=false;this.dispatchEvent({type:'close'});}
  };nodes.set(id,value);return value;
 }
 for(const id of ['editor','login','support','deleteVerifyMessage','message','ownerStatus'])node(id);
 for(const id of ['deleteStation','cancelDelete'])node(id,'BUTTON');const dialog=node('deleteVerification','DIALOG'),form=node('deleteVerifyForm','FORM'),code=node('deleteCode','INPUT'),submit=node('deleteSubmit','BUTTON');submit.type='submit';submit.textContent='Verify & delete station';form.elements.code=code;form.children.push(code,submit);dialog.children.push(form,nodes.get('cancelDelete'));
 nodes.get('login').hidden=true;nodes.get('support').hidden=true;
 const context=vm.createContext({document,window:{appI18n:{t:key=>key}},$:id=>nodes.get(id)||node(id),state:{owner_station:'13'},sitePageGeneration:1,ownerSessionGeneration:0,Event:class{constructor(type){this.type=type;}},
  message:text=>{nodes.get('message').textContent=text;},ownerText:(key,fallback)=>fallback,
  setBusyButtonLabel:(button,key)=>{const label=button.textContent;button.textContent=key;return ()=>{button.textContent=label;};},
  api:async(path,body)=>{calls.push({path,body});const result=answers.shift();if(result instanceof Error)throw result;return result===undefined?{verification_id:'delete-challenge'}:await result;},
  refreshStationDirectory:()=>{refreshes++;return Promise.resolve();},
  page:id=>{pages.push(id);context.sitePageGeneration++;for(const name of ['editor','login','support'])nodes.get(name).hidden=name!==id;},
  formIsBusy:form=>snapshots.has(form),busy(form,on,freeze=false,label){busyCalls.push({form,on,freeze,label});if(on){if(snapshots.has(form))return;const controls=form.querySelectorAll(freeze?'button,input,select,textarea':'button');snapshots.set(form,controls.map(control=>[control,control.disabled]));form.dataset.busy='1';for(const control of controls)control.disabled=true;}else{for(const [control,disabled] of snapshots.get(form)||[])control.disabled=disabled;snapshots.delete(form);delete form.dataset.busy;}},
 });
 const source=readFileSync(new URL('./public/assets/site.js',import.meta.url),'utf8'),start=source.indexOf('let deleteVerificationId'),end=source.indexOf('let sharedOpenGeneration=0;');assert.ok(start>=0&&end>start,'Deletion lifecycle remains independently testable');vm.runInContext(source.slice(start,end),context);
 const submitForm=()=>form.onsubmit({preventDefault(){},target:form});
 function escape(){const event={type:'cancel',defaultPrevented:false,preventDefault(){this.defaultPrevented=true;}};dialog.dispatchEvent(event);if(!event.defaultPrevented)dialog.close();return event;}
 async function open(){answers.push({verification_id:'delete-challenge'});await nodes.get('deleteStation').onclick();code.value='123456';}
 return {nodes,answers,calls,pages,busyCalls,context,document,form,code,submit,dialog,open,submitForm,escape,refreshes:()=>refreshes,leave(id='support'){context.page(id);}};
}
async function until(check){for(let i=0;i<50&&!check();i++)await new Promise(resolve=>setImmediate(resolve));assert.ok(check(),'Expected async checkpoint');}

test('requesting a deletion code suppresses double taps and a late response never opens over another page',async()=>{
 const f=fixture(),pending=deferred();f.answers.push(pending.promise);const first=f.nodes.get('deleteStation').onclick();await until(()=>f.calls.length===1);await f.nodes.get('deleteStation').onclick();assert.equal(f.calls.length,1);f.leave();pending.resolve({verification_id:'late-challenge'});await first;assert.equal(f.dialog.open,false);assert.equal(f.nodes.get('support').hidden,false);assert.equal(f.nodes.get('deleteStation').disabled,false);
});
test('final deletion freezes the captured code, suppresses duplicates, and locks Cancel and Escape only during commit',async()=>{
 const f=fixture();await f.open();const pending=deferred();f.answers.push(pending.promise);const deleting=f.submitForm();await until(()=>f.calls.length===2);
 assert.equal(f.calls[1].body.confirm,true);assert.equal(f.calls[1].body.code,'123456');assert.equal(f.calls[1].body.verification_id,'delete-challenge');assert.equal(f.code.disabled,true);assert.equal(f.nodes.get('cancelDelete').disabled,true);assert.equal(f.escape().defaultPrevented,true);assert.equal(f.dialog.open,true);
 await f.nodes.get('cancelDelete').onclick();assert.equal(f.dialog.open,true);await f.submitForm();assert.equal(f.calls.length,2);
 pending.resolve({status:'deleted'});await deleting;assert.equal(f.dialog.open,false);assert.equal(f.context.state.owner_station,null);assert.equal(f.pages.at(-1),'login');assert.equal(f.refreshes(),1);assert.match(f.nodes.get('message').textContent,/removed|deleted/i);
});
test('a rejected confirmation unlocks dismissal and preserves the owner station and entered code',async()=>{
 const f=fixture();await f.open();f.answers.push(Object.assign(Error('Incorrect email code.'),{status:400}));await f.submitForm();assert.equal(f.dialog.open,true);assert.equal(f.nodes.get('cancelDelete').disabled,false);assert.equal(f.code.disabled,false);assert.equal(f.code.value,'123456');assert.equal(f.context.state.owner_station,'13');assert.equal(f.refreshes(),0);assert.match(f.nodes.get('deleteVerifyMessage').textContent,/Incorrect/);assert.equal(f.escape().defaultPrevented,false);assert.equal(f.dialog.open,false);
});
test('a timed-out deletion does not claim that the station was preserved or removed',async()=>{
 const f=fixture();await f.open();f.answers.push(Error('Request timed out. Please try again.'));await f.submitForm();assert.equal(f.dialog.open,true);assert.equal(f.nodes.get('cancelDelete').disabled,false);assert.match(f.nodes.get('deleteVerifyMessage').textContent,/confirm|check.*station/i);assert.equal(f.context.state.owner_station,'13');assert.equal(f.pages.length,0);
});
test('a deletion finishing after navigation refreshes the directory without redirecting or replacing another page message',async()=>{
 const f=fixture();await f.open();const pending=deferred();f.answers.push(pending.promise);const deleting=f.submitForm();await until(()=>f.calls.length===2);f.leave();f.nodes.get('message').textContent='Keep support context';pending.resolve({status:'deleted'});await deleting;assert.equal(f.nodes.get('support').hidden,false);assert.notEqual(f.pages.at(-1),'login');assert.equal(f.nodes.get('message').textContent,'Keep support context');assert.equal(f.refreshes(),1);
});
