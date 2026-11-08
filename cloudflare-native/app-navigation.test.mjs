import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';

function fixture({app=false,standalone=false,path='/',initial='myRadio'}={}){
 const events=new Map(),frames=[],mediaEvents={},nodes=new Map();let loads=0,supportLoads=0,sharedGeneration=0;
 function node(id='',tag='DIV'){
  const listeners={};const n={id,tagName:tag,hidden:false,dataset:{},children:[],scrollLeft:0,isConnected:true,textContent:'',attrs:{},classList:{values:new Set(),toggle(name,on){if(on)this.values.add(name);else this.values.delete(name);}},setAttribute(key,value){this.attrs[key]=value;},addEventListener(key,fn){(listeners[key]??=[]).push(fn);},append(...items){this.children.push(...items);},before(){},focus(){document.activeElement=this;},querySelectorAll(){return [];},showModal(){this.open=true;},close(){this.open=false;queueMicrotask(()=>{for(const fn of listeners.close||[])fn({});});},dispatch(name,event={}){for(const fn of listeners[name]||[])fn(event);}};if(id)nodes.set(id,n);return n;
 }
 const ids=['myRadio','support','wifiSetup','login','register','editor','shared','admin','legal','advertise','adReview','reports','backups','navAdd','navRadio','navLibrary','openWifiSetup','wifiBackToRadio','search','listenerAppTitle','stations','savedStations','supportVideos','ticketForm','supportMessage','shareStatus'];ids.forEach(id=>node(id));
 for(const id of ['myRadio','support','wifiSetup','login','register','editor','shared','admin','legal','advertise','adReview','reports','backups'])nodes.get(id).hidden=id!==initial;
 const supportLink=node('supportLink','A');supportLink.href='https://radio.example/support';const wifiLink=nodes.get('openWifiSetup');wifiLink.tagName='A';wifiLink.href='https://radio.example/wifi-setup';
 const document={body:node(),activeElement:null,querySelector(selector){return selector.startsWith('nav a')?supportLink:null;},createElement:tag=>node('',tag.toUpperCase())};nodes.get('ticketForm').elements={name:node('ticketName','INPUT')};
 const location={origin:'https://radio.example'};
 function update(url){const parsed=new URL(url,location.origin);Object.assign(location,{href:parsed.href,pathname:parsed.pathname,search:parsed.search,hash:parsed.hash});}update(path+(app?'?app=1':'')+(path==='/'?'#radio':''));
 const entries=[{url:location.href,state:null}];let index=0;
 const history={scrollRestoration:'auto',get state(){return entries[index].state;},replaceState(state,unused,url){entries[index]={state,url:new URL(url,location.href).href};update(entries[index].url);},pushState(state,unused,url){entries.splice(index+1);entries.push({state,url:new URL(url,location.href).href});index++;update(entries[index].url);},back(){this.go(-1);},forward(){this.go(1);},go(amount){const next=index+amount;if(next<0||next>=entries.length)return;index=next;update(entries[index].url);for(const fn of events.get('popstate')||[])fn({state:entries[index].state});}};
 const stationPopup=node('stationAddPopup','DIALOG'),stationPopupClose=node('stationPopupClose','BUTTON');
 const window={scrollX:0,scrollY:0,scrollTo(x,y){this.scrollX=x;this.scrollY=y;},addEventListener(key,fn){const list=events.get(key)||[];list.push(fn);events.set(key,list);}};
 const context=vm.createContext({document,window,history,location,navigator:{standalone:false},matchMedia:()=>({matches:standalone,addEventListener(name,fn){mediaEvents[name]=fn;}}),URL,URLSearchParams,Object,Map,Promise,queueMicrotask,requestAnimationFrame:fn=>frames.push(fn),$:(id)=>nodes.get(id),stationPopup,stationPopupClose,
  page(id){for(const key of ['myRadio','support','wifiSetup','login','register','editor','shared','admin','legal','advertise','adReview','reports','backups'])nodes.get(key).hidden=key!==id;},list(){},loadMyRadios(){loads++;return Promise.resolve();},loadSupport(){supportLoads++;nodes.get('supportVideos').children.push(node());return Promise.resolve();},openStationPopup:async()=>{stationPopup.open=true;nodes.get('shared').hidden=false;},shareRunning:false,sharedOpenGeneration:0});
 vm.runInContext(readFileSync(new URL('./public/assets/app-navigation.js',import.meta.url),'utf8'),context);
 function flush(){while(frames.length)frames.shift()();}
 async function settle(){await Promise.resolve();await Promise.resolve();flush();}
 function click(target){const event={target:{closest:()=>target},button:0,preventDefault(){this.prevented=true;},stopImmediatePropagation(){this.stopped=true;}};for(const fn of events.get('click')||[])fn(event);flush();return event;}
 return {context,nodes,document,window,history,entries,supportLink,wifiLink,stationPopup,stationPopupClose,click,flush,settle,loads:()=>loads,supportLoads:()=>supportLoads};
}

test('listener installation uses Radio/Support while direct owner screens keep their navigation',()=>{
 for(const options of [{app:true},{standalone:true}]){const f=fixture(options);assert.equal(f.nodes.get('navAdd').hidden,true);assert.equal(f.document.body.classList.values.has('listener-app'),true);vm.runInContext("page('editor')",f.context);assert.equal(f.nodes.get('navAdd').hidden,false);assert.equal(f.document.body.classList.values.has('app-listener-page'),false);}
 const browser=fixture();assert.equal(browser.nodes.get('navAdd').hidden,false);assert.equal(browser.document.body.classList.values.has('app-listener-page'),true);
});

test('Radio/Support switching retains a ticket draft, station search and horizontal/document scroll with browser Back',async()=>{
 const f=fixture({app:true});f.nodes.get('search').value='community';
 const ticket=f.nodes.get('ticketForm');ticket.dataset.dirty='1';ticket.elements.name.value='Unsaved listener name';f.nodes.get('stations').scrollLeft=160;f.window.scrollY=320;
 const event=f.click(f.supportLink);assert.equal(event.prevented,true);assert.equal(event.stopped,true);assert.equal(f.nodes.get('support').hidden,false);assert.equal(f.window.scrollY,0);assert.equal(f.supportLoads(),1);assert.equal(f.nodes.get('listenerAppTitle').textContent,'Support');
 f.window.scrollY=210;f.history.back();await f.settle();assert.equal(f.nodes.get('myRadio').hidden,false);assert.equal(f.window.scrollY,320);assert.equal(f.nodes.get('stations').scrollLeft,160);assert.equal(ticket.elements.name.value,'Unsaved listener name');assert.equal(ticket.dataset.dirty,'1');assert.equal(f.nodes.get('search').value,'community');
 f.history.forward();await f.settle();assert.equal(f.nodes.get('support').hidden,false);assert.equal(f.window.scrollY,210);assert.equal(f.supportLoads(),1);assert.equal(ticket.elements.name.value,'Unsaved listener name');
});

test('station Close and browser Back dismiss the panel, preserve the Radio position, and restore its trigger focus',async()=>{
 const f=fixture();const trigger=f.nodes.get('navRadio');trigger.focus();f.window.scrollY=280;f.nodes.get('savedStations').scrollLeft=95;
 await vm.runInContext("openStationPopup('13')",f.context);assert.equal(f.stationPopup.open,true);assert.equal(f.entries.length,2);assert.equal(f.history.state.radioLocalsApp.code,'13');
 f.history.back();await f.settle();assert.equal(f.stationPopup.open,false);assert.equal(f.window.scrollY,280);assert.equal(f.document.activeElement,trigger);assert.equal(f.nodes.get('savedStations').scrollLeft,95);
 f.history.forward();await f.settle();assert.equal(f.stationPopup.open,true);assert.equal(f.entries.length,2);f.stationPopupClose.onclick();await f.settle();assert.equal(f.stationPopup.open,false);assert.equal(f.history.state.radioLocalsApp.panel,null);
});

test('pending radio actions cannot be dismissed with Close or hardware Back and do not claim success',async()=>{
 const f=fixture();await vm.runInContext("openStationPopup('13'); shareRunning=true",f.context);f.stationPopupClose.onclick();assert.equal(f.stationPopup.open,true);assert.match(f.nodes.get('shareStatus').textContent,/wait/i);f.history.back();await f.settle();assert.equal(f.stationPopup.open,true);assert.equal(f.history.state.radioLocalsApp.panel,'station');assert.doesNotMatch(f.nodes.get('shareStatus').textContent,/success/i);
});

test('owner, legal and modified-click navigation are left to their existing behavior',()=>{
 const f=fixture();for(const target of [f.nodes.get('navAdd'),{tagName:'A',href:'https://radio.example/copyright',id:''}]){const event=f.click(target);assert.equal(event.prevented,undefined);}assert.equal(f.entries.length,1);
});


test('Wi-Fi setup is a same-document listener route with its own title, no tutorial request and a true Back to Radio',async()=>{
 const f=fixture({app:true});f.nodes.get('search').value='local';f.window.scrollY=260;f.nodes.get('stations').scrollLeft=140;f.wifiLink.focus();
 const event=f.click(f.wifiLink);assert.equal(event.prevented,true);assert.equal(f.nodes.get('wifiSetup').hidden,false);assert.equal(f.nodes.get('myRadio').hidden,true);assert.equal(f.nodes.get('listenerAppTitle').textContent,'Wi-Fi setup');assert.equal(f.history.state.radioLocalsApp.page,'wifiSetup');assert.equal(f.entries.at(-1).url,'https://radio.example/wifi-setup?app=1');assert.equal(f.nodes.get('navRadio').attrs['aria-current'],'page');assert.equal(f.nodes.get('navAdd').hidden,true);assert.equal(f.supportLoads(),0);assert.equal(f.loads(),0);
 f.window.scrollY=85;f.click(f.nodes.get('wifiBackToRadio'));await f.settle();assert.equal(f.nodes.get('myRadio').hidden,false);assert.equal(f.window.scrollY,260);assert.equal(f.nodes.get('stations').scrollLeft,140);assert.equal(f.nodes.get('search').value,'local');assert.equal(f.document.activeElement,f.wifiLink);assert.equal(f.entries.length,2);assert.equal(f.history.state.radioLocalsApp.page,'myRadio');
 f.history.forward();await f.settle();assert.equal(f.nodes.get('wifiSetup').hidden,false);assert.equal(f.window.scrollY,85);assert.equal(f.supportLoads(),0);
});

test('direct Wi-Fi setup keeps its route and header without a Radio fallback or support fetch',()=>{
 const f=fixture({standalone:true,path:'/wifi-setup',initial:'wifiSetup'});assert.equal(f.nodes.get('listenerAppTitle').textContent,'Wi-Fi setup');assert.equal(f.nodes.get('myRadio').hidden,true);assert.equal(f.history.state.radioLocalsApp.page,'wifiSetup');assert.equal(f.nodes.get('navAdd').hidden,true);assert.equal(f.supportLoads(),0);
 f.click(f.nodes.get('wifiBackToRadio'));f.flush();assert.equal(f.nodes.get('myRadio').hidden,false);assert.equal(f.entries.length,1);assert.equal(f.entries[0].url,'https://radio.example/#radio');
 const awaitingRoute=fixture({path:'/wifi-setup',initial:'none'});assert.equal(awaitingRoute.nodes.get('listenerAppTitle').textContent,'Wi-Fi setup');assert.equal(awaitingRoute.nodes.get('myRadio').hidden,true);assert.equal(awaitingRoute.history.state.radioLocalsApp.page,'wifiSetup');
});

test('support drafts and Wi-Fi return history survive switching among listener pages',async()=>{
 const f=fixture({app:true});f.nodes.get('ticketForm').elements.name.value='Draft owner';f.nodes.get('ticketForm').dataset.dirty='1';f.click(f.wifiLink);f.click(f.supportLink);assert.equal(f.nodes.get('support').hidden,false);assert.equal(f.supportLoads(),1);f.history.back();await f.settle();assert.equal(f.nodes.get('wifiSetup').hidden,false);assert.equal(f.history.state.radioLocalsApp.from,'myRadio');assert.equal(f.nodes.get('ticketForm').elements.name.value,'Draft owner');f.click(f.nodes.get('wifiBackToRadio'));await f.settle();assert.equal(f.nodes.get('myRadio').hidden,false);assert.equal(f.entries.length,3);assert.equal(f.history.state.radioLocalsApp.page,'myRadio');
});
test('a same-page Radio click cancels pending owner routing and restores the Radio URL',()=>{
 const f=fixture();vm.runInContext("let navigationCalls=0;const trackedPage=page;page=function(id){navigationCalls++;return trackedPage(id);};history.replaceState(history.state,'','/#add-station');",f.context);f.window.scrollY=140;f.click(f.nodes.get('navRadio'));assert.equal(vm.runInContext('navigationCalls',f.context),1);assert.equal(f.entries.at(-1).url,'https://radio.example/#radio');assert.equal(f.nodes.get('myRadio').hidden,false);assert.equal(f.window.scrollY,140);
});
test('opening a station waits until an active radio pairing is finished',async()=>{
 const f=fixture();f.nodes.set('radioConnectStatus',{textContent:''});f.context.radioPairingBusy=true;await vm.runInContext("openStationPopup('13')",f.context);assert.equal(!!f.stationPopup.open,false);assert.equal(f.entries.length,1);assert.match(f.nodes.get('radioConnectStatus').textContent,/Finish connecting/);
});
