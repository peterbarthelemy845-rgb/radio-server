import {test} from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';

const source=readFileSync(new URL('./public/assets/site.js',import.meta.url),'utf8');
const initializeSource=source.slice(source.indexOf('async function initializeSite()'),source.indexOf('void initializeSite();'));
function deferred(){let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return {promise,resolve,reject};}
function fixture({path='/',hash='#radio',session={},directory=Promise.resolve([]),readyState='complete',domContentLoadedStart=0}={}){
 const pages=[],messages=[],events=[],order=[],domListeners=new Map(),windowListeners=new Map(),nodes=new Map();let sessionResult=session,communityResult=Promise.resolve(),directoryCalls=0;
 const $=id=>{if(!nodes.has(id))nodes.set(id,{hidden:false,textContent:''});return nodes.get(id);};
 function listen(store,type,fn,options={}){const handlers=store.get(type)||[];handlers.push({fn,once:options.once});store.set(type,handlers);}
 function dispatch(store,type){for(const handler of [...(store.get(type)||[])]){if(handler.once)store.set(type,store.get(type).filter(item=>item!==handler));handler.fn(new Event(type));}}
 const navigation={domContentLoadedEventStart:domContentLoadedStart},document={readyState,addEventListener(type,fn,options){listen(domListeners,type,fn,options);}};
 const context=vm.createContext({Promise,Event,document,$,performance:{getEntriesByType:()=>[navigation]},location:{pathname:path,hash},state:undefined,page:id=>pages.push(id),message:text=>messages.push(text),refreshStationDirectory(){directoryCalls++;return directory;},async loadOwnerSession(){const result=await sessionResult;context.state=result;return result;},async editor(){order.push('editor');},async openShared(){order.push('shared');},async adminList(){order.push('admin');},async initCommunity(){order.push('community');return await communityResult;},window:{addEventListener(type,fn,options){listen(windowListeners,type,fn,options);},dispatchEvent(event){events.push(event.type);order.push(event.type);dispatch(windowListeners,event.type);}}});
 vm.runInContext(initializeSource,context);
 return {pages,messages,events,order,context,document,nodes,start:()=>vm.runInContext('initializeSite()',context),directoryCalls:()=>directoryCalls,setSession(value){sessionResult=value;},setCommunity(value){communityResult=value;},onReady(fn){listen(windowListeners,'radio-locals-ready',fn);},domReady(){document.readyState='interactive';navigation.domContentLoadedEventStart=42;dispatch(domListeners,'DOMContentLoaded');},load(){document.readyState='complete';dispatch(windowListeners,'load');}};
}

test('Radio readiness does not wait for an independent slow public directory',async()=>{
 const directory=deferred(),f=fixture({directory:directory.promise});await f.start();assert.equal(f.directoryCalls(),1);assert.deepEqual(f.pages,['myRadio']);assert.deepEqual(f.events,['radio-locals-ready']);directory.resolve([]);await Promise.resolve();assert.equal(f.events.length,1);
});

test('a failed directory request cannot prevent readiness or become an unhandled rejection',async()=>{
 const directory=deferred(),session=deferred(),f=fixture({directory:directory.promise,session:session.promise});const initialization=f.start();directory.reject(Error('Catalogue unavailable'));await new Promise(setImmediate);assert.equal(f.events.length,0);session.resolve({csrf:'ready'});await initialization;assert.deepEqual(f.events,['radio-locals-ready']);assert.deepEqual(f.messages,[]);
});

test('an initial session failure still exposes the radio page and completes startup',async()=>{
 const session=deferred(),f=fixture({session:session.promise}),initialization=f.start();session.reject(Error('Session connection interrupted'));await initialization;assert.deepEqual(f.pages,['myRadio']);assert.deepEqual(f.events,['radio-locals-ready']);assert.deepEqual(f.messages,['Session connection interrupted']);assert.equal(f.context.state,undefined);
});

test('owner startup still resolves its session and editor before announcing readiness',async()=>{
 const directory=deferred(),f=fixture({path:'/add-station',hash:'',session:{owner_station:'13'},directory:directory.promise});await f.start();assert.deepEqual(f.pages,['login']);assert.deepEqual(f.order,['editor','community','radio-locals-ready']);directory.resolve([]);
});

test('fast startup waits for later deferred scripts to install their ready handlers',async()=>{
 const f=fixture({readyState:'interactive'}),initialization=f.start();assert.deepEqual(f.pages,['myRadio']);assert.equal(f.directoryCalls(),1);await new Promise(setImmediate);assert.equal(f.order.includes('community'),false);assert.equal(f.events.length,0);
 let downstreamStarts=0;f.onReady(()=>{downstreamStarts++;});f.domReady();await initialization;assert.equal(downstreamStarts,1);assert.deepEqual(f.events,['radio-locals-ready']);f.load();assert.equal(downstreamStarts,1);
});

test('slow network finishing after DOMContentLoaded uses the existing ready latch without waiting for full load',async()=>{
 const session=deferred(),f=fixture({readyState:'interactive',session:session.promise}),initialization=f.start();let downstreamStarts=0;f.onReady(()=>{downstreamStarts++;});f.domReady();await new Promise(setImmediate);assert.equal(f.events.length,0);session.resolve({csrf:'ready'});await initialization;assert.equal(f.document.readyState,'interactive');assert.equal(downstreamStarts,1);assert.deepEqual(f.events,['radio-locals-ready']);
});

test('already-loaded and interactive-after-DOM documents do not hang on an event that already fired',async()=>{
 for(const options of [{readyState:'complete'},{readyState:'interactive',domContentLoadedStart:42}]){const f=fixture(options);let downstreamStarts=0;f.onReady(()=>{downstreamStarts++;});await f.start();assert.equal(downstreamStarts,1);assert.deepEqual(f.events,['radio-locals-ready']);}
 const before=fixture({readyState:'interactive'});before.domReady();await before.start();assert.deepEqual(before.events,['radio-locals-ready']);
});

test('a shared entry shows its own loading page immediately and waits for later script helpers',async()=>{
 const f=fixture({path:'/station/13',hash:'',readyState:'interactive'}),calls=[];let helpersInstalled=false;f.context.openShared=async(...args)=>{assert.equal(helpersInstalled,true);calls.push(args);};const initialization=f.start();
 assert.deepEqual(f.pages,['shared']);assert.equal(f.nodes.get('shareForm').hidden,true);assert.equal(f.nodes.get('shareName').textContent,'Loading station…');assert.equal(f.nodes.get('shareArt').hidden,true);assert.equal(f.directoryCalls(),1);await new Promise(setImmediate);assert.equal(calls.length,0);
 helpersInstalled=true;f.domReady();await initialization;assert.deepEqual(calls,[['13']]);assert.deepEqual(f.events,['radio-locals-ready']);assert.equal(f.pages.includes('library'),false);assert.equal(f.pages.includes('myRadio'),false);
});
