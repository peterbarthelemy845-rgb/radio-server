import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
const adsSource=readFileSync(new URL('./public/assets/ads.js',import.meta.url),'utf8');
const siteSource=readFileSync(new URL('./public/assets/site.js',import.meta.url),'utf8');
const busySource=siteSource.slice(siteSource.indexOf('const formBusyStates='),siteSource.indexOf('function loadHuman('));
function deferred(){let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return {promise,resolve,reject};}
function fixture({serializeFile=async file=>({name:file.name,base64:'data'}),checkHuman=async()=> 'bot-proof'}={}){
 const ids=new Map(),calls=[],answers=[],pages=[],messages=[],events=[],busyEvents=[];
 function node(tag='div'){const element={tag,children:[],style:{},dataset:{},attributes:{},hidden:false,textContent:'',disabled:false,value:'',listeners:{},addEventListener(name,fn){(this.listeners[name]??=[]).push(fn);},emit(name){for(const fn of this.listeners[name]||[])fn({target:this});},setAttribute(name,value){this.attributes[name]=value;},removeAttribute(name){delete this.attributes[name];},append(...children){this.children.push(...children);},prepend(...children){this.children.unshift(...children);},replaceChildren(...children){this.children=children;},querySelectorAll(selector){const controls=Object.values(this.elements||{});return selector==='button'?controls.filter(control=>control.tag==='button'):controls;},dispatchEvent(event){busyEvents.push(event.type);},reset(){this.resetCount=(this.resetCount||0)+1;this.emit('reset');}};Object.defineProperty(element,'innerHTML',{set(){throw Error('Unsafe HTML insertion');}});return element;}
 const get=id=>{if(!ids.has(id))ids.set(id,node());return ids.get(id);};
 const form=get('advertiseForm');form.elements={};for(const [name,value] of Object.entries({business:'Community Shop',message:'Fresh bread',phone:'555-0100',email:'owner@example.com',start_date:'2027-01-15',end_date:'2027-01-20'})){form.elements[name]=Object.assign(node('input'),{name,value});}
 const originalFile={name:'sponsor.png',size:20};form.elements.artwork=Object.assign(node('input'),{name:'artwork',files:[originalFile]});form.elements.rights_confirmed=Object.assign(node('input'),{name:'rights_confirmed',checked:true});form.elements.submit=node('button');
 class FormData{constructor(form){this.fields=Object.entries(form.elements).filter(([,control])=>!control.disabled&&control.tag!=='button').map(([name,control])=>[name,control.value]);}*[Symbol.iterator](){yield* this.fields;}}
 const ctx={$:get,document:{createElement:node},adminTools:node(),FormData,Object,crypto,Uint8Array,appPrompt:async()=>'',appConfirm:async()=>true,Event:class{constructor(type){this.type=type;}},window:{addEventListener(){},dispatchEvent(event){events.push(event.type);}},page(id){pages.push(id);for(const [name,item] of ids)if(['editor','admin','adReview','myRadio','support','login'].includes(name))item.hidden=name!==id;},message(text){messages.push(text);},location:{pathname:'/'},prompt:()=>'',confirm:()=>true,fileData:serializeFile,human:checkHuman,api:async(path,body)=>{calls.push({path,body});if(!answers.length)throw Error('Missing test answer');const answer=answers.shift();if(answer instanceof Error)throw answer;return await answer;}};
 runInNewContext(busySource,ctx);runInNewContext(adsSource,ctx);runInNewContext('advertiseCode="10"',ctx);
 return {ctx,form,originalFile,calls,answers,pages,messages,events,busyEvents,get:expression=>runInNewContext(expression,ctx),id:get,show:runInNewContext('showAds',ctx),navigate:runInNewContext('page',ctx),submit:()=>form.onsubmit({preventDefault(){},target:form})};
}
const ad={id:'a'.repeat(32),business:'Bakery',station_code:10,message:'Bread',phone:'555-0100',status:'pending_review',scanner_passed:1,reported_displays:0};
test('advertiser submission snapshots before freezing fields and blocks repeated submissions',async()=>{
 const file=deferred(),serialized=[],f=fixture({serializeFile:async value=>{serialized.push(value);return await file.promise;}});f.answers.push({message:'Submitted for approval.'});const first=f.submit();await f.submit();
 assert.equal(f.form.dataset.busy,'1');assert.equal(f.form.elements.business.disabled,true);assert.equal(f.form.elements.artwork.disabled,true);assert.equal(serialized.length,1);assert.equal(serialized[0],f.originalFile);
 f.form.elements.business.value='Changed while waiting';f.form.elements.rights_confirmed.checked=false;f.form.elements.artwork.files=[{name:'different.png'}];file.resolve({name:'sponsor.png',base64:'captured'});await first;
 assert.equal(f.calls.length,1);assert.equal(f.calls[0].path,'/api/ads/submit');assert.equal(f.calls[0].body.business,'Community Shop');assert.equal(f.calls[0].body.email,'owner@example.com');assert.equal(f.calls[0].body.start_date,'2027-01-15');assert.equal(f.calls[0].body.rights_confirmed,true);assert.equal(f.calls[0].body.artwork.name,'sponsor.png');assert.equal(f.calls[0].body.turnstile_token,'bot-proof');assert.equal(f.form.hidden,true);assert.equal(f.form.resetCount,1);assert.equal(f.form.elements.business.disabled,false);assert.equal(f.form.dataset.busy,undefined);
});
test('failed advertisement submission preserves the draft and restores controls for a retry',async()=>{
 const f=fixture();f.form.elements.phone.disabled=true;f.answers.push(Error('Temporary upload failure'));await f.submit();assert.equal(f.form.resetCount,undefined);assert.equal(f.form.hidden,false);assert.equal(f.form.elements.business.value,'Community Shop');assert.equal(f.form.elements.business.disabled,false);assert.equal(f.form.elements.phone.disabled,true);assert.match(f.id('advertiseMessage').textContent,/Temporary upload failure/);
 f.answers.push({message:'Submitted.'});await f.submit();assert.equal(f.calls.length,2);assert.equal(f.form.resetCount,1);
});

test('advertiser retries keep the same draft ID until a field edit or successful submission',async()=>{
 const f=fixture();f.answers.push(Error('Response lost'));await f.submit();const first=f.calls[0].body.request_id;assert.match(first,/^[a-f0-9]{32}$/);f.answers.push(Error('Response still unavailable'));await f.submit();assert.equal(f.calls[1].body.request_id,first);
 f.form.elements.message.value='Updated message';f.form.emit('input');f.answers.push({message:'Submitted.'});await f.submit();assert.notEqual(f.calls[2].body.request_id,first);const second=f.calls[2].body.request_id;f.form.hidden=false;f.answers.push({message:'Submitted again intentionally.'});await f.submit();assert.notEqual(f.calls[3].body.request_id,second);
});

test('approval or deletion prompts resolving after navigation cannot mutate the old advertisement',async()=>{
 for(const action of ['Approve ad','Delete ad']){const f=fixture(),decision=deferred();f.answers.push({ads:[ad]});await f.show(false);f.ctx.appConfirm=async()=>decision.promise;f.ctx.appPrompt=async()=>decision.promise;const button=f.id('adsRecords').children[0].children.find(item=>item.textContent===action),pending=button.onclick();assert.equal(button.disabled,true);f.navigate('myRadio');decision.resolve(action==='Delete ad'?'An optional reason':true);await pending;assert.equal(f.calls.length,1);assert.equal(button.disabled,false);}
});
test('a slow ad-review fetch cannot reopen private review after navigating away',async()=>{
 const f=fixture(),pending=deferred();f.answers.push(pending.promise);const opening=f.show(true);f.navigate('myRadio');pending.resolve({ads:[ad]});assert.equal(await opening,false);assert.equal(f.pages.at(-1),'myRadio');assert.equal(f.id('adsRecords').children.length,0);
});
test('the latest owner/admin review request wins without mixing review permissions',async()=>{
 const f=fixture(),old=deferred(),current=deferred();f.answers.push(old.promise,current.promise);const admin=f.show(true),owner=f.show(false);current.resolve({ads:[ad]});assert.equal(await owner,true);const ownerRecords=f.id('adsRecords').children;assert.equal(f.get('adminAdReview'),false);assert.ok(ownerRecords[0].children.some(node=>node.textContent==='Approve ad'));
 old.resolve({ads:[{...ad,business:'Admin-only shop',scanner_passed:0}]});assert.equal(await admin,false);assert.equal(f.id('adsRecords').children,ownerRecords);assert.equal(f.get('adminAdReview'),false);assert.equal(f.id('adsRecords').children[0].children[0].textContent,'Bakery · Station #10');
});
test('leaving and returning before an old response arrives still cancels that review',async()=>{
 const f=fixture(),pending=deferred();f.answers.push(pending.promise);const opening=f.show(false);f.navigate('myRadio');f.navigate('editor');pending.resolve({ads:[ad]});assert.equal(await opening,false);assert.equal(f.pages.at(-1),'editor');
});
test('an old review error cannot overwrite a different page message',async()=>{
 const f=fixture(),pending=deferred();f.answers.push(pending.promise);const opening=f.show(false);f.navigate('support');pending.reject(Error('Old review unavailable'));await opening;assert.deepEqual(f.messages,[]);assert.equal(f.pages.at(-1),'support');
});
test('a pending review action is locked and its response cannot reopen review after leaving',async()=>{
 const f=fixture();f.answers.push({ads:[ad]});await f.show(false);const box=f.id('adsRecords').children[0],approve=box.children.find(node=>node.textContent==='Approve ad'),remove=box.children.find(node=>node.textContent==='Delete ad');const pending=deferred();f.answers.push(pending.promise);const action=approve.onclick();await approve.onclick();await remove.onclick();assert.equal(f.calls.length,2);assert.equal(approve.disabled,true);
 f.navigate('myRadio');pending.resolve({notification_queued:true});await action;assert.equal(f.calls.length,2);assert.equal(f.pages.at(-1),'myRadio');assert.equal(approve.disabled,false);assert.equal(f.events.length,0);
});
test('a failed refresh does not permanently lock the still-visible review actions',async()=>{
 const f=fixture();f.answers.push({ads:[ad]});await f.show(false);const approve=f.id('adsRecords').children[0].children.find(node=>node.textContent==='Approve ad');
 f.answers.push(Error('Temporary refresh failure'));assert.equal(await f.show(false),false);assert.equal(f.get('adReviewLoading'),false);
 f.answers.push({notification_queued:false},{ads:[{...ad,status:'approved'}]});await approve.onclick();assert.equal(f.calls.filter(call=>call.body?.action==='approve').length,1);assert.match(f.id('adsRecords').children[0].children[3].textContent,/approved/);
});
test('actions on the old review are paused while a different review context is loading',async()=>{
 const f=fixture();f.answers.push({ads:[ad]});await f.show(false);const approve=f.id('adsRecords').children[0].children.find(node=>node.textContent==='Approve ad'),pending=deferred();f.answers.push(pending.promise);const admin=f.show(true);await approve.onclick();assert.equal(f.calls.length,2);pending.resolve({ads:[{...ad,scanner_passed:0}]});await admin;assert.equal(f.get('adminAdReview'),true);
});
