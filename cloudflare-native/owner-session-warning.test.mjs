import {test} from 'node:test';import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';import vm from 'node:vm';
const source=readFileSync(new URL('./public/assets/owner-session-warning.js',import.meta.url),'utf8');
function fixture({expires=2800,serverTime=1000,clock=100000000,dirty=false,visible=true}={}){
 const events={},documentEvents={},nodes=new Map(),timers=new Map(),microtasks=[],observers=[];let nextTimer=0,busy=false,clicks=0;
 function node(tag='div'){return {tag,hidden:false,dataset:{},children:[],textContent:'',events:{},setAttribute(){},append(...items){this.children.push(...items);},before(other){this.beforeNode=other;},addEventListener(type,fn){(this.events[type]??=[]).push(fn);},click(){clicks++;}};}
 const form=node('form');form.elements={artwork:{files:[]}};if(dirty)form.dataset.dirty='1';nodes.set('editForm',form);const editor=node();editor.hidden=!visible;nodes.set('editor',editor);const reauth=node('button');reauth.hidden=true;nodes.set('ownerSignInAgain',reauth);
 const document={hidden:false,createElement:node,addEventListener(type,fn){documentEvents[type]=fn;}};
 class FakeDate extends Date{static now(){return clock;}}
 const state={owner_expires:expires,server_time:serverTime};
 vm.runInNewContext(source,{$:id=>nodes.get(id),state,document,Date:FakeDate,Number,Object,formIsBusy:()=>busy,MutationObserver:class{constructor(fn){observers.push(fn);}observe(){}},queueMicrotask:fn=>microtasks.push(fn),setTimeout(fn,delay){const id=++nextTimer;timers.set(id,{fn,delay,at:clock+delay});return id;},clearTimeout:id=>timers.delete(id),window:{addEventListener(type,fn){events[type]=fn;},appI18n:{t:key=>key}}});
 const notice=form.beforeNode;
 return {form,editor,reauth,document,timers,notice,events,clicks:()=>clicks,text:()=>notice.children[0].textContent,button:notice.children[1],setBusy(value){busy=value;},notify(){for(const fn of observers)fn();},emit(type){for(const fn of form.events[type]||[])fn();while(microtasks.length)microtasks.shift()();},visibility(value){document.hidden=value;documentEvents.visibilitychange();},session(detail){events['owner-session-updated']({detail});},advance(ms){clock+=ms;for(const [id,timer]of[...timers])if(timer.at<=clock){timers.delete(id);timer.fn();}}};
}
test('clean owner forms never show a session warning or start a timer',()=>{const f=fixture();assert.equal(f.notice.hidden,true);assert.equal(f.timers.size,0);f.advance(1800000);assert.equal(f.notice.hidden,true);});
test('dirty owner forms warn two minutes before the real expiry, despite phone clock skew, without renewing',()=>{
 const f=fixture({dirty:true});assert.equal(f.notice.hidden,true);assert.equal([...f.timers.values()][0].delay,1680000);f.advance(1679999);assert.equal(f.notice.hidden,true);f.advance(1);assert.equal(f.notice.hidden,false);assert.equal(f.notice.dataset.state,'soon');assert.match(f.text(),/Save your changes or sign in again/);assert.equal([...f.timers.values()][0].delay,120000);
 f.advance(120000);assert.equal(f.notice.dataset.state,'expired');assert.match(f.text(),/sign-in ended/);assert.equal(f.timers.size,0);assert.equal(f.clicks(),0);assert.equal(f.form.dataset.dirty,'1');
});
test('warning stays out of hidden pages and rechecks the unchanged deadline on return',()=>{
 const f=fixture({dirty:true});f.visibility(true);assert.equal(f.timers.size,0);f.advance(1801000);assert.equal(f.notice.hidden,true);f.visibility(false);assert.equal(f.notice.dataset.state,'expired');assert.equal(f.notice.hidden,false);
 f.editor.hidden=true;f.notify();assert.equal(f.notice.hidden,true);f.editor.hidden=false;f.notify();assert.equal(f.notice.hidden,false);
});
test('saving/resetting or busy requests hide the warning without clearing a draft or changing expiry',()=>{
 const f=fixture({dirty:true,expires:1100});assert.equal(f.notice.hidden,false);f.setBusy(true);f.emit('form-busy-changed');assert.equal(f.notice.hidden,true);assert.equal(f.form.dataset.dirty,'1');f.setBusy(false);f.emit('form-busy-changed');assert.equal(f.notice.hidden,false);
 delete f.form.dataset.dirty;f.emit('reset');assert.equal(f.notice.hidden,true);f.form.elements.artwork.files=[{name:'cover.png'}];f.emit('change');assert.equal(f.notice.hidden,false);assert.equal(f.form.elements.artwork.files[0].name,'cover.png');
});
test('sign-in action uses the existing draft-preserving flow only on explicit click',()=>{
 const f=fixture({dirty:true,expires:1100});assert.equal(f.clicks(),0);f.button.onclick();assert.equal(f.clicks(),1);assert.equal(f.form.dataset.dirty,'1');f.setBusy(true);f.button.onclick();assert.equal(f.clicks(),1);f.setBusy(false);f.editor.hidden=true;f.button.onclick();assert.equal(f.clicks(),1);
});
test('renewed verified sessions replace the warning deadline; unrelated events and legacy responses cannot extend it',()=>{
 const f=fixture({dirty:true,expires:1100});assert.equal(f.notice.hidden,false);f.session({owner_expires:4600,server_time:2800});assert.equal(f.notice.hidden,true);assert.equal([...f.timers.values()][0].delay,1680000);f.session({});assert.equal([...f.timers.values()][0].delay,1680000);f.session({owner_expires:null});assert.equal(f.notice.dataset.state,'expired');assert.equal(f.timers.size,0);
});
test('an existing reauthentication error remains the sole sign-in notice',()=>{const f=fixture({dirty:true,expires:1100});f.reauth.hidden=false;f.emit('input');assert.equal(f.notice.hidden,true);f.reauth.hidden=true;f.emit('input');assert.equal(f.notice.hidden,false);});
