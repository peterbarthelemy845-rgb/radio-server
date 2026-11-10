import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
const currentVersion=JSON.parse(readFileSync(new URL('./public/assets/app-release.json',import.meta.url),'utf8')).version;
function deferred(){let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return {promise,resolve,reject};}
function fixture({dialog=async()=>true}={}){
 const events={},documentEvents={},nodes=[],storage=new Map(),forms=[],dialogs=[],deliveries=new Map();let reloads=0,calls=0,version='2099.01.01.1';
 function node(tag){const value={tag,children:[],hidden:false,disabled:false,textContent:'',dataset:{},append(...items){this.children.push(...items);},prepend(...items){this.children.unshift(...items);},setAttribute(){}};nodes.push(value);return value;}
 const main=node('main'),document={hidden:false,dialogOpen:false,createElement:node,querySelector(query){return query==='main'?main:query==='dialog[open]'&&this.dialogOpen?{}:null;},querySelectorAll(){return forms;},addEventListener(name,fn){documentEvents[name]=fn;}};
 const window={scrollX:0,scrollY:180,location:{reload(){reloads++;}},addEventListener(name,fn){events[name]=fn;},scrollTo(x,y){this.scrollX=x;this.scrollY=y;}};
 const context={window,document,navigator:{onLine:true},shareRunning:false,stationDeliveries:deliveries,listenerActionDialog:async(...args)=>{dialogs.push(args);document.dialogOpen=true;try{return await dialog(...args);}finally{document.dialogOpen=false;}},localStorage:{},sessionStorage:{setItem(k,v){storage.set(k,v);},getItem:k=>storage.get(k)||null,removeItem:k=>storage.delete(k)},$:()=>({value:'public station search'}),fetch:async()=>{calls++;return {ok:true,json:async()=>({version})};},AbortSignal,Date,queueMicrotask,requestAnimationFrame:fn=>fn(),MutationObserver:class{observe(){}},setInterval(){},list(){}};
 runInNewContext(readFileSync(new URL('./public/assets/app-update.js',import.meta.url),'utf8'),context);
 return {context,document,window,events,documentEvents,storage,forms,dialogs,delivery(id,state){if(state==null)deliveries.delete(id);else deliveries.set(id,{state,device_code:'PRIVATE-DEVICE-CODE'});events['station-delivery-changed']?.();},banner:main.children[0],check:()=>runInNewContext('checkAppRelease()',context),render:()=>runInNewContext('renderAppUpdate()',context),setVersion:v=>version=v,reloads:()=>reloads,calls:()=>calls};
}
test('update notice checks the release without forcing a reload and dismisses only this version',async()=>{
 const f=fixture();await f.check();assert.equal(f.banner.hidden,false);assert.equal(f.reloads(),0);const [refresh,later]=f.banner.children[2].children;assert.equal(refresh.disabled,false);later.onclick();assert.equal(f.banner.hidden,true);await f.check();assert.equal(f.banner.hidden,true);f.setVersion('2099.01.01.2');await f.check();assert.equal(f.banner.hidden,false);
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
 const f=fixture();f.context.navigator.onLine=false;await f.check();assert.equal(f.calls(),0);f.context.navigator.onLine=true;f.document.hidden=true;await f.check();assert.equal(f.calls(),0);f.document.hidden=false;f.setVersion(currentVersion);await f.check();assert.equal(f.banner.hidden,true);assert.equal(f.reloads(),0);
});


test('Stop waiting does not let a website update interrupt sending or pending background station deliveries',async()=>{
 for(const state of ['sending','pending']){const f=fixture();await f.check();const refresh=f.banner.children[2].children[0];f.context.shareRunning=false;f.delivery('station-request',state);assert.equal(refresh.disabled,true);assert.match(f.banner.children[1].textContent,/Finish your form or request/);await refresh.onclick();assert.equal(f.reloads(),0);assert.equal(f.storage.size,0);assert.equal(f.dialogs.length,0);}
});

test('late acknowledgment or definitive failure immediately unlocks update without polling the network',async()=>{
 for(const final of ['added','failed']){const f=fixture();await f.check();const requests=f.calls(),refresh=f.banner.children[2].children[0];f.delivery('request','pending');assert.equal(refresh.disabled,true);f.delivery('request',final);assert.equal(refresh.disabled,false);assert.equal(f.banner.children[1].hidden,true);assert.equal(f.calls(),requests);await refresh.onclick();assert.equal(f.reloads(),1);assert.equal(f.dialogs.length,0);}
});

test('an unconfirmed delivery offers a caution and an explicit choice instead of permanently locking updates',async()=>{
 let approve=false;const f=fixture({dialog:async()=>approve});await f.check();f.delivery('request','unconfirmed');const refresh=f.banner.children[2].children[0];assert.equal(refresh.disabled,false);assert.equal(f.banner.children[1].hidden,false);assert.match(f.banner.children[1].textContent,/unconfirmed.*Check your radio/);await refresh.onclick();assert.equal(f.reloads(),0);assert.equal(f.storage.size,0);assert.equal(f.dialogs[0][0],'Update website?');assert.equal(f.dialogs[0][2],'Update website');assert.equal(f.dialogs[0][3],true);assert.doesNotMatch(f.dialogs[0][1],/cancelled|canceled|PRIVATE/);
 approve=true;await refresh.onclick();assert.equal(f.reloads(),1);const saved=JSON.parse(f.storage.get('radioLocalsUpdateView'));assert.deepEqual(Object.keys(saved).sort(),['expires','query','x','y']);assert.equal(JSON.stringify(saved).includes('PRIVATE'),false);
});

test('an approval to update cannot interrupt a new station command that began while the caution dialog was open',async()=>{
 const decision=deferred(),f=fixture({dialog:()=>decision.promise});await f.check();f.delivery('old','unconfirmed');const refresh=f.banner.children[2].children[0],updating=refresh.onclick();assert.equal(f.dialogs.length,1);await refresh.onclick();assert.equal(f.dialogs.length,1);f.delivery('new','sending');decision.resolve(true);await updating;assert.equal(f.reloads(),0);assert.equal(f.storage.size,0);assert.equal(refresh.disabled,true);
});

test('an update caution re-checks dirty work, visibility and the release after awaiting user approval',async()=>{
 for(const change of ['draft','background','release']){const decision=deferred(),f=fixture({dialog:()=>decision.promise});await f.check();f.delivery('request','unconfirmed');const updating=f.banner.children[2].children[0].onclick();if(change==='draft')f.forms.push({dataset:{dirty:'1'},getClientRects:()=>[],querySelector:()=>null});if(change==='background')f.document.hidden=true;if(change==='release'){f.setVersion('2099.01.01.2');await f.check();}decision.resolve(true);await updating;assert.equal(f.reloads(),0);assert.equal(f.storage.size,0);}
});

test('a background page cannot open an uncertain-delivery update prompt or save refresh state',async()=>{
 const f=fixture();await f.check();f.delivery('request','unconfirmed');f.document.hidden=true;await f.banner.children[2].children[0].onclick();assert.equal(f.dialogs.length,0);assert.equal(f.reloads(),0);assert.equal(f.storage.size,0);
});

test('uncertain-delivery caution falls back to readable text when a translation key is missing',async()=>{
 const f=fixture({dialog:async()=>false});f.window.appI18n={t:key=>key};await f.check();f.delivery('request','unconfirmed');assert.equal(f.banner.children[1].textContent,'A station request is unconfirmed. Check your radio before updating.');await f.banner.children[2].children[0].onclick();assert.equal(f.dialogs[0][0],'Update website?');
});


test('website refresh waits for a dismissed pairing request to finish its cancellation',async()=>{
 const f=fixture();await f.check();const refresh=f.banner.children[2].children[0];f.context.pairingCleanupPending=1;f.events['pairing-cleanup-changed']();assert.equal(refresh.disabled,true);await refresh.onclick();assert.equal(f.reloads(),0);
 f.context.pairingCleanupPending=0;f.events['pairing-cleanup-changed']();assert.equal(refresh.disabled,false);await refresh.onclick();assert.equal(f.reloads(),1);
});
