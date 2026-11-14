import {test} from 'node:test';import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';import vm from 'node:vm';
const source=readFileSync(new URL('./public/assets/pwa-offline.js',import.meta.url),'utf8');
const settle=()=>new Promise(setImmediate);
function fixture({online=true,answer={ok:true,json:async()=>({version:'2026.11.14.5'})}}={}){
 const nodes=new Map(),events=new Map(),timers=new Map(),calls=[];let nextTimer=1,reloads=0;
 for(const id of ['offlineLanguage','offlineRetry','offlineWifi','offlineBackOnline','offlineConnectionStatus'])nodes.set(id,{value:'',hidden:false,textContent:'',events:new Map(),addEventListener(name,fn){const handlers=this.events.get(name)||[];handlers.push(fn);this.events.set(name,handlers);},fire(name){for(const fn of this.events.get(name)||[])fn();}});
 const document={hidden:false,documentElement:{},title:'',getElementById:id=>nodes.get(id),querySelectorAll:()=>[],addEventListener:(name,fn)=>events.set('document:'+name,fn)},navigator={language:'en',onLine:online};
 const context={document,navigator,window:{addEventListener:(name,fn)=>events.set(name,fn)},location:{pathname:'/support',reload(){reloads++;}},localStorage:{getItem(){},setItem(){}},AbortController,setTimeout(fn,delay){const id=nextTimer++;timers.set(id,{fn,delay});return id;},clearTimeout:id=>timers.delete(id),fetch:async(url,options)=>{calls.push({url,options});return typeof answer==='function'?answer():answer;}};
 vm.runInNewContext(source,context);return {nodes,calls,events,timers,navigator,document,reloads:()=>reloads};
}
test('Back online requires a successful uncached public probe and never redirects by itself',async()=>{
 const f=fixture({online:false});assert.equal(f.calls.length,0);assert.equal(f.nodes.get('offlineBackOnline').hidden,true);f.navigator.onLine=true;f.events.get('online')();await settle();assert.equal(f.calls.length,1);const call=f.calls[0];assert.equal(call.url,'/assets/app-release.json');assert.equal(call.options.credentials,'omit');assert.equal(call.options.cache,'no-store');assert.equal(f.nodes.get('offlineBackOnline').hidden,false);assert.equal(f.reloads(),0);f.nodes.get('offlineBackOnline').fire('click');assert.equal(f.reloads(),1);
});
test('a network outage or an HTML challenge cannot produce a false Back online state and retries are bounded',async()=>{
 for(const answer of [{ok:false},{ok:true,json:async()=>{throw new SyntaxError('html challenge');}},{ok:true,json:async()=>({version:'not-an-app-release'})}]){const f=fixture({answer});await settle();assert.equal(f.nodes.get('offlineBackOnline').hidden,true);assert.ok([...f.timers.values()].every(timer=>timer.delay>=15000&&timer.delay<=60000));f.document.hidden=true;f.events.get('document:visibilitychange')();assert.equal(f.timers.size,0);}
});
test('a late response after going offline cannot show a stale recovery and the button follows the chosen language',async()=>{
 let finish;const f=fixture({answer:()=>new Promise(resolve=>{finish=resolve;})});assert.equal(f.calls.length,1);f.navigator.onLine=false;f.events.get('offline')();finish({ok:true,json:async()=>({version:'2026.11.14.5'})});await settle();assert.equal(f.nodes.get('offlineBackOnline').hidden,true);assert.equal(f.calls[0].options.signal.aborted,true);
 const ready=fixture();await settle();ready.nodes.get('offlineLanguage').value='ht';ready.nodes.get('offlineLanguage').fire('change');assert.match(ready.nodes.get('offlineBackOnline').textContent,/Koneksyon retounen/);ready.events.get('pagehide')();assert.equal(ready.timers.size,0);
});
