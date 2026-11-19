import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';

const source=readFileSync(new URL('./public/assets/advertiser-status.js',import.meta.url),'utf8');
const first='a'.repeat(32),second='b'.repeat(32);
const ad=(reference=first)=>({reference,station_code:'15',business:'Share <b>Local Shop</b>',status:'waiting_for_owner',start_at:1800000000,end_at:1800086400,email_updates:true});
function deferred(){let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return {promise,resolve,reject};}
const settle=()=>new Promise(setImmediate);

function fixture({human,clipboard,search=''}={}){
 const ids=new Map(),events=new Map(),documentEvents=new Map(),observers=[],calls=[],checks=[],answers=[],copied=[],timers=new Map();let document,timer=0,language='en';
 class Element{
  constructor(tag){this.tagName=tag.toUpperCase();this.nodeType=1;this.children=[];this.dataset={};this.attributes={};this.handlers=new Map();this.hidden=false;this.disabled=false;this.required=false;this.value='';this._text='';}
  set id(value){this._id=value;if(value)ids.set(value,this);}get id(){return this._id;}
  get firstChild(){return this.children[0]||null;}
  get textContent(){return this.children.length?this.children.map(child=>child.textContent||'').join(''):this._text;}
  set textContent(value){for(const child of this.children)child.parentElement=null;this.children=[];this._text=String(value);}
  set innerHTML(value){throw Error('Unsafe HTML insertion: '+value);}
  remove(){if(this.parentElement){const parent=this.parentElement;parent.children.splice(parent.children.indexOf(this),1);this.parentElement=null;}}
  append(...children){for(const child of children){child.remove?.();child.parentElement=this;this.children.push(child);}}
  prepend(...children){for(const child of [...children].reverse()){child.remove?.();child.parentElement=this;this.children.unshift(child);}}
  setAttribute(name,value){this.attributes[name]=String(value);}getAttribute(name){return this.attributes[name]??null;}
  addEventListener(name,fn){const handlers=this.handlers.get(name)||[];handlers.push(fn);this.handlers.set(name,handlers);}
  emit(name){for(const fn of this.handlers.get(name)||[])fn({target:this});}
  focus(){document.activeElement=this;}select(){this.selected=true;}
  checkValidity(){if(this.disabled)return true;if(this.tagName==='FORM')return descendants(this).every(child=>!['INPUT','TEXTAREA','SELECT'].includes(child.tagName)||child.checkValidity());if(!this.value)return !this.required;if(this.pattern&&!new RegExp('^(?:'+this.pattern+')$').test(this.value))return false;if(this.type==='email')return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(this.value);return true;}
  reportValidity(){this.reported=true;return this.checkValidity();}
 }
 const descendants=node=>node.children.flatMap(child=>[child,...descendants(child)]);
 const text=value=>({nodeType:3,textContent:value,children:[]});
 const panel=new Element('section');panel.id='advertise';
 document={hidden:false,activeElement:null,getElementById:id=>ids.get(id)||null,createElement:tag=>new Element(tag),createTextNode:text,addEventListener(name,fn){documentEvents.set(name,fn);}};
 const window={appI18n:{get language(){return language;}},addEventListener(name,fn){const handlers=events.get(name)||[];handlers.push(fn);events.set(name,handlers);}};
 vm.runInNewContext(source,{document,window,location:{search},URLSearchParams,Intl,Date,navigator:{clipboard:{async writeText(value){copied.push(value);if(clipboard)return clipboard(value);}}},MutationObserver:class{constructor(fn){observers.push(fn);}observe(){}},setTimeout(fn,delay){const id=++timer;timers.set(id,{fn,delay});return id;},clearTimeout(id){timers.delete(id);},human:async(form,action)=>{checks.push({form,action});return human?human(form,action):'fresh-proof';},api:async(path,body)=>{calls.push({path,body});if(!answers.length)throw Error('Missing fixture response');const value=answers.shift();if(value instanceof Error)throw value;return await value;}});
 const details=ids.get('advertiserStatus'),[summary,intro,result,lookup,proof,notice]=details.children;
 const [referenceLabel,emailLabel,check,emailUpdates]=lookup.children,reference=referenceLabel.children.find(child=>child.tagName==='INPUT'),email=emailLabel.children.find(child=>child.tagName==='INPUT');
 const [description,schedule,referenceText,copy,refresh,stop]=result.children,[codeLabel,verify,resend,change]=proof.children,code=codeLabel.children.find(child=>child.tagName==='INPUT');
 const emit=(name,detail)=>{for(const fn of events.get(name)||[])fn({detail});};
 return {panel,window,document,details,summary,intro,result,lookup,proof,notice,reference,email,check,emailUpdates,description,schedule,referenceText,copy,refresh,stop,code,verify,resend,change,calls,checks,answers,copied,timers,
  submit:()=>lookup.onsubmit({preventDefault(){}}),request:()=>emailUpdates.onclick(),verifyCode:()=>proof.onsubmit({preventDefault(){}}),type(field,value){field.value=value;field.emit('input');},leave(){panel.hidden=true;for(const fn of observers)fn();},return(){panel.hidden=false;for(const fn of observers)fn();},emit,language(value){language=value;emit('app-language-changed');}};
}

test('an empty email update request does not poison ordinary status lookup or send an email',async()=>{
 const f=fixture();f.reference.value=first;await f.request();assert.equal(f.calls.length+f.checks.length,0);assert.match(f.notice.textContent,/Enter the contact email/);assert.equal(f.document.activeElement,f.email);assert.equal(f.email.required,false);assert.equal(f.lookup.checkValidity(),true);
 f.answers.push(ad());await f.submit();assert.equal(f.calls.length,1);assert.equal(f.calls[0].path,'/api/ads/status?reference='+first);assert.equal(f.calls[0].body,undefined);assert.equal(f.checks.length,0);assert.equal(f.result.hidden,false);assert.match(f.description.textContent,/<b>Local Shop<\/b>/);assert.equal(f.description.dataset.i18nSkip,'1');assert.match(f.schedule.textContent,/UTC/);
});

test('editing the reference hides stale status and prevents copying or stopping the previous advertisement',async()=>{
 const f=fixture();f.reference.value=first;f.answers.push(ad());await f.submit();assert.equal(f.stop.hidden,false);f.type(f.reference,second);assert.equal(f.result.hidden,true);const before=f.calls.length;await f.copy.onclick();await f.stop.onclick();assert.equal(f.calls.length,before);assert.deepEqual(f.copied,[]);
 f.answers.push(ad(second));await f.submit();assert.equal(f.reference.value,second);assert.match(f.referenceText.textContent,new RegExp(second));assert.equal(f.result.hidden,false);
});

test('status requests expose busy forms, reject duplicate submits and cannot repopulate a page after leaving and returning',async()=>{
 const f=fixture(),pending=deferred();f.reference.value=first;f.answers.push(pending.promise);const reading=f.submit();assert.equal(f.lookup.dataset.busy,'1');assert.equal(f.proof.dataset.busy,'1');assert.equal(f.lookup.getAttribute('aria-busy'),'true');assert.equal(f.reference.disabled,true);await f.submit();assert.equal(f.calls.length,1);
 f.leave();assert.equal(f.lookup.dataset.busy,undefined);assert.equal(f.proof.getAttribute('aria-busy'),'false');f.return();pending.resolve(ad());await reading;assert.equal(f.result.hidden,true);assert.equal(f.notice.textContent,'');assert.equal(f.reference.disabled,false);
 f.type(f.reference,second);f.answers.push(ad(second));await f.submit();assert.equal(f.result.hidden,false);assert.match(f.referenceText.textContent,new RegExp(second));
});

test('leaving during the security check prevents email submission and clears its busy state',async()=>{
 const check=deferred(),f=fixture({human:()=>check.promise});f.reference.value=first;f.email.value='owner@example.com';const requesting=f.request();assert.equal(f.lookup.dataset.busy,'1');assert.equal(f.checks[0].action,'advertiser-status');assert.equal(f.calls.length,0);f.leave();check.resolve('fresh-proof');await requesting;assert.equal(f.calls.length,0);assert.equal(f.proof.hidden,true);assert.equal(f.lookup.dataset.busy,undefined);assert.equal(f.email.disabled,false);
});

test('late verification responses do not reopen proof or overwrite a later visit',async()=>{
 const f=fixture();f.reference.value=first;f.email.value='owner@example.com';f.answers.push({verification_id:'c'.repeat(32),expires_in:900,resend_after:60});await f.request();assert.equal(f.proof.hidden,false);f.type(f.code,'123 456');assert.equal(f.code.value,'123456');const post=deferred();f.answers.push(post.promise);const verifying=f.verifyCode();assert.equal(f.proof.dataset.busy,'1');assert.equal(f.calls.at(-1).body.code,'123456');f.leave();f.return();post.resolve({...ad(),email_updates:true});await verifying;assert.equal(f.proof.hidden,true);assert.equal(f.result.hidden,true);assert.equal(f.notice.textContent.includes('Email verified'),false);assert.equal(f.proof.dataset.busy,undefined);
});

test('a delayed clipboard completion cannot report success or focus a stale reference after it changes',async()=>{
 for(const fail of [false,true]){const write=deferred(),f=fixture({clipboard:()=>write.promise});f.reference.value=first;f.answers.push(ad());await f.submit();const copying=f.copy.onclick();assert.deepEqual(f.copied,[first]);f.type(f.reference,second);f.notice.textContent='Current reference draft';const focused=f.document.activeElement;if(fail)write.reject(Error('Clipboard denied'));else write.resolve();await copying;assert.equal(f.notice.textContent,'Current reference draft');assert.equal(f.document.activeElement,focused);assert.notEqual(f.reference.selected,true);}
});

test('stopping email updates exposes a pending write and updates only the current advertisement',async()=>{
 const f=fixture();f.reference.value=first;f.answers.push(ad());await f.submit();const post=deferred();f.answers.push(post.promise);const stopping=f.stop.onclick();assert.equal(f.lookup.dataset.busy,'1');assert.equal(f.stop.disabled,true);assert.equal(f.calls.at(-1).path,'/api/ads/updates/stop');assert.equal(f.calls.at(-1).body.reference,first);await f.stop.onclick();assert.equal(f.calls.filter(call=>call.path==='/api/ads/updates/stop').length,1);post.resolve({status:'ok'});await stopping;assert.equal(f.stop.hidden,true);assert.match(f.notice.textContent,/Email updates stopped/);assert.equal(f.lookup.dataset.busy,undefined);
});
