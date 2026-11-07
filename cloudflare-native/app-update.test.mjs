import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
function fixture(){
 const events={},documentEvents={},nodes=[],storage=new Map(),forms=[];let reloads=0,calls=0,version='2026.11.07.3';
 function node(tag){const value={tag,children:[],hidden:false,disabled:false,textContent:'',dataset:{},append(...items){this.children.push(...items);},prepend(...items){this.children.unshift(...items);},setAttribute(){}};nodes.push(value);return value;}
 const main=node('main'),document={hidden:false,dialogOpen:false,createElement:node,querySelector(query){return query==='main'?main:query==='dialog[open]'&&this.dialogOpen?{}:null;},querySelectorAll(){return forms;},addEventListener(name,fn){documentEvents[name]=fn;}};
 const window={scrollX:0,scrollY:180,location:{reload(){reloads++;}},addEventListener(name,fn){events[name]=fn;},scrollTo(x,y){this.scrollX=x;this.scrollY=y;}};
 const context={window,document,navigator:{onLine:true},shareRunning:false,localStorage:{},sessionStorage:{setItem(k,v){storage.set(k,v);},getItem:k=>storage.get(k)||null,removeItem:k=>storage.delete(k)},$:()=>({value:'public station search'}),fetch:async()=>{calls++;return {ok:true,json:async()=>({version})};},AbortSignal,Date,queueMicrotask,requestAnimationFrame:fn=>fn(),MutationObserver:class{observe(){}},setInterval(){},list(){}};
 runInNewContext(readFileSync(new URL('./public/assets/app-update.js',import.meta.url),'utf8'),context);
 return {context,document,window,events,documentEvents,storage,forms,banner:main.children[0],check:()=>runInNewContext('checkAppRelease()',context),render:()=>runInNewContext('renderAppUpdate()',context),setVersion:v=>version=v,reloads:()=>reloads,calls:()=>calls};
}
test('update notice checks the release without forcing a reload and dismisses only this version',async()=>{
 const f=fixture();await f.check();assert.equal(f.banner.hidden,false);assert.equal(f.reloads(),0);const [refresh,later]=f.banner.children[2].children;assert.equal(refresh.disabled,false);later.onclick();assert.equal(f.banner.hidden,true);await f.check();assert.equal(f.banner.hidden,true);f.setVersion('2026.11.07.4');await f.check();assert.equal(f.banner.hidden,false);
});
test('unfinished forms, dialogs and active radio requests prevent refreshing or storing private input',async()=>{
 const f=fixture();const form={dataset:{dirty:'1'},getClientRects:()=>[],querySelector:()=>null};f.forms.push(form);await f.check();const refresh=f.banner.children[2].children[0];assert.equal(refresh.disabled,true);refresh.onclick();assert.equal(f.reloads(),0);assert.equal(f.storage.size,0);
 delete form.dataset.dirty;f.document.dialogOpen=true;f.render();refresh.onclick();assert.equal(f.reloads(),0);f.document.dialogOpen=false;f.window.radioControlsBusy=true;f.render();refresh.onclick();assert.equal(f.reloads(),0);
 f.window.radioControlsBusy=false;f.context.shareRunning=true;refresh.onclick();assert.equal(f.reloads(),0);
});
test('a deliberate safe refresh stores only public search/scroll and restores it once',async()=>{
 const f=fixture();await f.check();f.banner.children[2].children[0].onclick();assert.equal(f.reloads(),1);const saved=JSON.parse(f.storage.get('radioLocalsUpdateView'));assert.deepEqual(Object.keys(saved).sort(),['expires','query','x','y']);assert.equal(saved.query,'public station search');f.events['radio-locals-ready']();assert.equal(f.storage.size,0);assert.equal(f.window.scrollY,180);
});
test('offline, background and current-version checks leave the site usable with no notice',async()=>{
 const f=fixture();f.context.navigator.onLine=false;await f.check();assert.equal(f.calls(),0);f.context.navigator.onLine=true;f.document.hidden=true;await f.check();assert.equal(f.calls(),0);f.document.hidden=false;f.setVersion('2026.11.07.2');await f.check();assert.equal(f.banner.hidden,true);assert.equal(f.reloads(),0);
});
