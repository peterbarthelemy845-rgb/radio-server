import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';

const source=readFileSync(new URL('./public/assets/owner-navigation-state.js',import.meta.url),'utf8');

// Run the real eager navigation controller with a clock deliberately unrelated
// to the server clock. No owner page or lazy-loaded editor feature is needed.
function fixture({initial,clock=90000000,language='en',missingButton=false,withGlobalClear=false,translations=true}={}){
 const windowEvents=new Map(),documentEvents=new Map(),timers=new Map(),observers=[];
 let nextTimer=0,clearCalls=0;
 const words={en:{navCreate:'Create station',navAccount:'Station account'},ht:{navCreate:'Kreye estasyon',navAccount:'Kont estasyon'}};
 const element=tag=>({tagName:tag.toUpperCase(),dataset:{},children:[],textContent:'',hidden:false,
  append(child){this.children.push(child);},querySelector(selector){return selector==='span'?this.children.find(child=>child.tagName==='SPAN')||null:null;}});
 const button=element('button'),icon=element('svg'),label=element('span');
 label.textContent='Add Station';button.append(icon);button.append(label);
 const listen=(events,type,fn)=>{const callbacks=events.get(type)||[];callbacks.push(fn);events.set(type,callbacks);};
 const emit=(events,type,event={})=>{for(const fn of events.get(type)||[])fn(event);};
 const document={hidden:false,getElementById:id=>id==='navAdd'&&!missingButton?button:null,createElement:element,addEventListener:(type,fn)=>listen(documentEvents,type,fn)};
 const window={addEventListener:(type,fn)=>listen(windowEvents,type,fn),dispatchEvent(event){emit(windowEvents,event.type,event);}};
 if(translations)window.appI18n={t:key=>words[language]?.[key]||key};
 class FakeDate extends Date{static now(){return clock;}}
 const globals={document,window,Date:FakeDate,Object,Number,MutationObserver:class{constructor(callback){this.callback=callback;observers.push(this);}observe(target,options){this.target=target;this.options=options;}},
  setTimeout(fn,delay){const id=++nextTimer;timers.set(id,{fn,delay,at:clock+delay});return id;},clearTimeout:id=>timers.delete(id)};
 if(initial!==undefined)globals.state=initial;
 if(withGlobalClear)globals.clearOwnerSession=()=>{clearCalls++;window.dispatchEvent({type:'owner-session-updated',detail:{owner_station:null,owner_expires:null}});};
 vm.runInNewContext(source,globals);
 const api=window.ownerAccountNavigation;
 return {api,button,icon,document,timers,observers,windowEvents,documentEvents,clearCalls:()=>clearCalls,
  label:()=>button.querySelector('span'),text:()=>button.querySelector('span')?.textContent,
  session(detail){window.dispatchEvent({type:'owner-session-updated',detail});},
  language(value){language=value;window.dispatchEvent({type:'app-language-changed'});},
  visibility(hidden){document.hidden=hidden;emit(documentEvents,'visibilitychange');},
  pageshow(){window.dispatchEvent({type:'pageshow'});},
  rebuildMenu(){const nextIcon=element('svg'),nextLabel=element('span');nextLabel.textContent='Add Station';button.children=[nextIcon,nextLabel];for(const observer of observers)observer.callback([{type:'childList',target:button}]);return nextIcon;},
  removeLabel(){button.children=button.children.filter(child=>child.tagName!=='SPAN');for(const observer of observers)observer.callback([{type:'childList',target:button}]);},
  elapse(ms,{runTimers=true}={}){clock+=ms;if(runTimers){let pending=true;while(pending){pending=false;for(const [id,timer] of [...timers])if(timer.at<=clock){timers.delete(id);timer.fn();pending=true;}}}}
 };
}

test('signed-out navigation starts as Create station without replacing its icon or visibility',()=>{
 const f=fixture();
 assert.equal(f.api.active(),false);assert.equal(f.text(),'Create station');
 assert.equal(f.label().dataset.i18n,'navCreate');assert.equal(f.button.dataset.ownerState,'signed-out');
 assert.equal(f.button.children[0],f.icon);assert.equal(f.timers.size,0);
 f.button.hidden=true;f.api.render();assert.equal(f.button.hidden,true);
});

test('an existing owner session initializes the eager menu and expires using server-relative time',()=>{
 const f=fixture({initial:{owner_station:13,owner_expires:1010,server_time:1000}});
 assert.equal(f.api.active(),true);assert.equal(f.text(),'Station account');assert.equal(f.label().dataset.i18n,'navAccount');
 assert.equal(f.button.dataset.ownerState,'signed-in');assert.equal(f.button.children[0],f.icon);
 assert.equal([...f.timers.values()][0].delay,10000);
 f.elapse(9999);assert.equal(f.api.active(),true);
 f.elapse(1);assert.equal(f.api.active(),false);assert.equal(f.text(),'Create station');assert.equal(f.timers.size,0);
});

test('session events switch the label, and a full signed-out snapshot cancels pending expiry',()=>{
 const f=fixture();
 f.session({owner_station:13,owner_expires:1060,server_time:1000});
 assert.equal(f.api.active(),true);assert.equal(f.text(),'Station account');assert.equal(f.timers.size,1);
 f.session({owner_station:null,owner_expires:null});
 assert.equal(f.api.active(),false);assert.equal(f.text(),'Create station');assert.equal(f.timers.size,0);
 f.elapse(60000);assert.equal(f.text(),'Create station');
});

test('partial session updates preserve identity and do not silently renew an existing deadline',()=>{
 const f=fixture({initial:{owner_station:13,owner_expires:1010,server_time:1000}});
 f.elapse(3000);f.session({owner_station:13});f.session({});f.session(null);
 assert.equal(f.api.active(),true);assert.equal([...f.timers.values()][0].delay,7000);
 f.elapse(6999);assert.equal(f.api.active(),true);
 f.elapse(1);assert.equal(f.api.active(),false);assert.equal(f.text(),'Create station');
});

test('a partial server expiry update keeps the current owner and supersedes the old timer',()=>{
 const f=fixture({initial:{owner_station:13,owner_expires:1010,server_time:1000}});
 const obsolete=[...f.timers.values()][0].fn;
 f.elapse(2000);f.session({owner_expires:1060,server_time:1002});
 assert.equal(f.api.active(),true);assert.equal(f.timers.size,1);assert.equal([...f.timers.values()][0].delay,58000);
 // Even a previously queued callback must use the newer server deadline.
 f.elapse(8000);obsolete();assert.equal(f.api.active(),true);assert.equal(f.timers.size,1);
 f.elapse(50000);assert.equal(f.api.active(),false);assert.equal(f.text(),'Create station');
});

test('unknown expiry never grants an owner menu, while a server-confirmed expiry can complete it',()=>{
 const f=fixture();
 f.session({owner_station:13});assert.equal(f.api.active(),false);assert.equal(f.text(),'Create station');
 f.session({owner_expires:1010,server_time:1000});assert.equal(f.api.active(),true);assert.equal(f.text(),'Station account');
 f.session({owner_expires:null});assert.equal(f.api.active(),false);assert.equal(f.text(),'Create station');
});

test('a different owner cannot inherit the previous station deadline from a partial update',()=>{
 const f=fixture({initial:{owner_station:13,owner_expires:1060,server_time:1000}});
 f.session({owner_station:14});
 assert.equal(f.api.active(),false);assert.equal(f.text(),'Create station');assert.equal(f.timers.size,0);
 f.session({owner_expires:1030,server_time:1000});assert.equal(f.api.active(),true);assert.equal(f.text(),'Station account');
 f.elapse(30000);assert.equal(f.api.active(),false);
});

test('language changes translate the current auth label and preserve the navigation icon',()=>{
 const f=fixture();
 f.language('ht');assert.equal(f.text(),'Kreye estasyon');assert.equal(f.label().dataset.i18n,'navCreate');
 f.session({owner_station:13,owner_expires:1010,server_time:1000});assert.equal(f.text(),'Kont estasyon');
 f.elapse(3000);f.language('en');assert.equal(f.text(),'Station account');assert.equal(f.label().dataset.i18n,'navAccount');assert.equal(f.api.active(),true);
 f.language('ht');f.elapse(3000);f.language('en');assert.equal(f.api.active(),true);assert.equal(f.text(),'Station account');
 assert.equal([...f.timers.values()][0].at,90010000);
 assert.equal(f.button.children[0],f.icon);
 f.api.clear();f.language('ht');assert.equal(f.text(),'Kreye estasyon');
});

test('late menu decoration and missing label recovery keep the account label and fresh SVG',()=>{
 const f=fixture({initial:{owner_station:13,owner_expires:1010,server_time:1000}});
 const replacementIcon=f.rebuildMenu();
 assert.equal(f.text(),'Station account');assert.equal(f.label().dataset.i18n,'navAccount');assert.equal(f.button.children[0],replacementIcon);
 f.removeLabel();assert.equal(f.text(),'Station account');assert.equal(f.button.children[0],replacementIcon);
 assert.equal(f.observers[0].target,f.button);assert.equal(f.observers[0].options.childList,true);
 f.api.clear();f.rebuildMenu();assert.equal(f.text(),'Create station');assert.equal(f.label().dataset.i18n,'navCreate');
});

test('visibility and page restoration preserve valid sessions and reconcile throttled expiry',()=>{
 const f=fixture({initial:{owner_station:13,owner_expires:1010,server_time:1000},withGlobalClear:true});
 f.visibility(true);f.elapse(2000);f.visibility(false);f.pageshow();
 assert.equal(f.api.active(),true);assert.equal(f.clearCalls(),0);assert.equal(f.timers.size,1);
 f.elapse(9000,{runTimers:false});assert.equal(f.api.active(),false);
 f.pageshow();assert.equal(f.clearCalls(),1);assert.equal(f.text(),'Create station');assert.equal(f.timers.size,0);
 f.visibility(false);assert.equal(f.clearCalls(),1);
});

test('natural expiry invokes central session clearing once and public clear prevents stale callbacks reviving it',()=>{
 const f=fixture({initial:{owner_station:13,owner_expires:1010,server_time:1000},withGlobalClear:true});
 f.elapse(10000);assert.equal(f.clearCalls(),1);assert.equal(f.text(),'Create station');
 f.session({owner_station:14,owner_expires:1020,server_time:1010});const obsolete=[...f.timers.values()][0].fn;
 f.api.clear();obsolete();assert.equal(f.api.active(),false);assert.equal(f.text(),'Create station');assert.equal(f.timers.size,0);
});

test('fallback text works before translations load and absent navigation is harmless',()=>{
 const f=fixture({translations:false});assert.equal(f.text(),'Create station');
 f.session({owner_station:13,owner_expires:1010,server_time:1000});assert.equal(f.text(),'Station account');
 const absent=fixture({missingButton:true});assert.equal(absent.api,undefined);assert.equal(absent.timers.size,0);assert.equal(absent.observers.length,0);
});
