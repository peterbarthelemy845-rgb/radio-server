import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';

const source=readFileSync(new URL('./public/assets/stream-test-feedback.js',import.meta.url),'utf8');
function fixture(){
 const ids=new Map(),nodes=[],events={};let document,failOpen=false;
 function node(tag){
  const listeners={},item={tag,dataset:{},attributes:{},children:[],hidden:false,disabled:false,open:false,isConnected:true,textContent:'',focusCount:0,opens:0,
   setAttribute(key,value){this.attributes[key]=value;},append(...children){this.children.push(...children);},addEventListener(name,fn){(listeners[name]??=[]).push(fn);},
   emit(name){for(const fn of listeners[name]||[])fn();},focus(){this.focusCount++;document.activeElement=this;},
   showModal(){if(failOpen)throw Error('Dialog unavailable');this.opens++;this.open=true;},close(){this.open=false;queueMicrotask(()=>this.emit('close'));}};
  Object.defineProperty(item,'id',{set(value){ids.set(value,item);},get(){return [...ids].find(([,value])=>value===item)?.[0];}});
  Object.defineProperty(item,'innerHTML',{set(){throw Error('Unsafe HTML insertion');}});nodes.push(item);return item;
 }
 document={createElement:node,getElementById:id=>ids.get(id),querySelector:()=>nodes.find(item=>item.tag==='dialog'&&item.open)||null,body:node('body'),hidden:false};
 for(const id of ['register','editor','testStream','testOwnerStream']){const item=node(id.startsWith('test')?'button':'section');item.id=id;}
 ids.get('editor').hidden=true;
 const window={appI18n:{t:key=>key},addEventListener(name,fn){events[name]=fn;}};
 runInNewContext(source,{window,document,Object,String,Error});
 return {window,document,node,$:id=>ids.get(id),show:options=>window.showStreamTestResult({source:'registration',key:'registration.audioResponse',fallback:'Audio data responded.',state:'success',...options}),
  flush:()=>new Promise(resolve=>queueMicrotask(resolve)),language(){events['app-language-changed']();},failOpen(value){failOpen=value;}};
}

test('completed results open an accessible modal, render plain text and return focus to Test stream',async()=>{
 const f=fixture();assert.equal(f.show({key:'',fallback:'<img src=x onerror=alert(1)>'}),true);
 const dialog=f.$('streamTestResult');assert.equal(dialog.open,true);assert.equal(dialog.attributes['aria-labelledby'],'streamTestResultTitle');assert.equal(dialog.attributes['aria-describedby'],'streamTestResultText');
 assert.equal(f.$('streamTestResultTitle').textContent,'Stream test');assert.equal(f.$('streamTestResultText').textContent,'<img src=x onerror=alert(1)>');assert.equal(f.$('closeStreamTestResult').textContent,'Done');assert.equal(f.document.activeElement,f.$('closeStreamTestResult'));
 f.$('closeStreamTestResult').onclick();await f.flush();assert.equal(dialog.open,false);assert.equal(f.document.activeElement,f.$('testStream'));assert.equal(dialog.opens,1);
});

test('checking, validation, hidden pages, background tabs and unknown sources cannot open a result',()=>{
 const f=fixture();for(const state of ['checking','invalid','copy',''])assert.equal(f.show({state}),false);
 assert.equal(f.show({source:'other'}),false);assert.equal(f.show({source:'owner'}),false);
 f.$('register').hidden=true;assert.equal(f.show(),false);f.$('register').hidden=false;f.document.hidden=true;assert.equal(f.show(),false);assert.equal(f.$('streamTestResult').opens,0);
});

test('a second result never replaces an outstanding result or another approval',async()=>{
 const f=fixture(),external=f.node('dialog');external.showModal();assert.equal(f.show(),false);external.close();await f.flush();
 assert.equal(f.show(),true);assert.equal(f.show({fallback:'A different result'}),false);assert.equal(f.$('streamTestResultText').textContent,'Audio data responded.');
});

test('invalidation only closes its own source and never focuses a hidden page',async()=>{
 const f=fixture();f.show();f.window.closeStreamTestResult('owner');assert.equal(f.$('streamTestResult').open,true);
 f.$('register').hidden=true;f.window.closeStreamTestResult('registration');await f.flush();assert.equal(f.$('streamTestResult').open,false);assert.equal(f.$('testStream').focusCount,0);
 f.$('editor').hidden=false;assert.equal(f.show({source:'owner',state:'unconfirmed'}),true);f.window.closeStreamTestResult('registration');assert.equal(f.$('streamTestResult').open,true);
 f.window.closeStreamTestResult('owner');await f.flush();assert.equal(f.document.activeElement,f.$('testOwnerStream'));
});

test('language changes translate an open result and never reopen a dismissed result',async()=>{
 const f=fixture();f.show();f.window.appI18n.t=key=>({'registration.testResult':'Tès difizyon','registration.audioResponse':'Done odyo rive.','done':'Fini'}[key]||key);f.language();
 assert.equal(f.$('streamTestResultTitle').textContent,'Tès difizyon');assert.equal(f.$('streamTestResultText').textContent,'Done odyo rive.');assert.equal(f.$('closeStreamTestResult').textContent,'Fini');
 f.$('streamTestResult').close();await f.flush();f.language();assert.equal(f.$('streamTestResult').open,false);assert.equal(f.$('streamTestResult').opens,1);
});

test('unavailable native dialogs fail back safely and allow later results',()=>{
 const f=fixture();f.failOpen(true);assert.equal(f.show(),false);f.failOpen(false);assert.equal(f.show({state:'error',key:'',fallback:'Network check failed.'}),true);assert.equal(f.$('streamTestResult').dataset.state,'error');
});

test('a queued close cannot be overwritten by a newer source or steal focus from another dialog',async()=>{
 const f=fixture();f.show();f.$('streamTestResult').close();f.$('editor').hidden=false;
 assert.equal(f.show({source:'owner'}),false);const other=f.node('dialog');other.showModal();await f.flush();assert.equal(f.$('testStream').focusCount,0);
 other.close();await f.flush();assert.equal(f.show({source:'owner'}),true);assert.equal(f.$('streamTestResult').opens,2);
});
