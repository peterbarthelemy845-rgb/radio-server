import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';

function fixture({app=false,standalone=false,path='/',initial='myRadio'}={}){
 const events=new Map(),frames=[],mediaEvents={},nodes=new Map(),stationOpenings=[];let loads=0,supportLoads=0,sharedGeneration=0;
 function node(id='',tag='DIV'){
  const listeners={};const n={id,tagName:tag,hidden:false,dataset:{},children:[],scrollLeft:0,isConnected:true,textContent:'',attrs:{},classList:{values:new Set(),toggle(name,on){if(on)this.values.add(name);else this.values.delete(name);}},setAttribute(key,value){this.attrs[key]=value;},addEventListener(key,fn){(listeners[key]??=[]).push(fn);},append(...items){this.children.push(...items);},before(){},focus(){document.activeElement=this;},querySelectorAll(){return [];},showModal(){this.open=true;},close(){this.open=false;queueMicrotask(()=>{for(const fn of listeners.close||[])fn({});});},dispatch(name,event={}){for(const fn of listeners[name]||[])fn(event);}};if(id)nodes.set(id,n);return n;
 }
 const ids=['myRadio','support','wifiSetup','login','register','editor','shared','admin','legal','advertise','adReview','reports','backups','navAdd','navRadio','navLibrary','openWifiSetup','wifiBackToRadio','search','listenerAppTitle','stations','savedStations','supportVideos','ticketForm','supportMessage','shareStatus','shareForm','shareName','ticketStationContext','ticketStationName','clearTicketStation','reportStationProblem'];ids.forEach(id=>node(id));nodes.get('ticketStationContext').hidden=true;
 for(const id of ['myRadio','support','wifiSetup','login','register','editor','shared','admin','legal','advertise','adReview','reports','backups'])nodes.get(id).hidden=id!==initial;
 const supportLink=node('supportLink','A');supportLink.href='https://radio.example/support';const wifiLink=nodes.get('openWifiSetup');wifiLink.tagName='A';wifiLink.href='https://radio.example/wifi-setup';
 const document={body:node(),activeElement:null,querySelector(selector){return selector.startsWith('nav a')?supportLink:null;},createElement:tag=>node('',tag.toUpperCase())};nodes.get('ticketForm').elements=Object.fromEntries(['name','email','device_code','subject','message','station_code'].map(key=>[key,Object.assign(node('ticket-'+key,'INPUT'),{value:''})]));
 const location={origin:'https://radio.example'};
 function update(url){const parsed=new URL(url,location.origin);Object.assign(location,{href:parsed.href,pathname:parsed.pathname,search:parsed.search,hash:parsed.hash});}update(path+(app?'?app=1':'')+(path==='/'?'#radio':''));
 const entries=[{url:location.href,state:null}];let index=0;
 const history={scrollRestoration:'auto',get state(){return entries[index].state;},replaceState(state,unused,url){entries[index]={state,url:new URL(url,location.href).href};update(entries[index].url);},pushState(state,unused,url){entries.splice(index+1);entries.push({state,url:new URL(url,location.href).href});index++;update(entries[index].url);},back(){this.go(-1);},forward(){this.go(1);},go(amount){const next=index+amount;if(next<0||next>=entries.length)return;index=next;update(entries[index].url);for(const fn of events.get('popstate')||[])fn({state:entries[index].state});}};
 const stationPopup=node('stationAddPopup','DIALOG'),stationPopupClose=node('stationPopupClose','BUTTON');
 const window={scrollX:0,scrollY:0,scrollTo(x,y){this.scrollX=x;this.scrollY=y;},addEventListener(key,fn){const list=events.get(key)||[];list.push(fn);events.set(key,list);}};
 const context=vm.createContext({document,window,history,location,navigator:{standalone:false},matchMedia:()=>({matches:standalone,addEventListener(name,fn){mediaEvents[name]=fn;}}),URL,URLSearchParams,Object,Map,Promise,queueMicrotask,requestAnimationFrame:fn=>frames.push(fn),$:(id)=>nodes.get(id),stationPopup,stationPopupClose,
  page(id){for(const key of ['myRadio','support','wifiSetup','login','register','editor','shared','admin','legal','advertise','adReview','reports','backups'])nodes.get(key).hidden=key!==id;},list(){},loadMyRadios(){loads++;return Promise.resolve();},loadSupport(){supportLoads++;nodes.get('supportVideos').children.push(node());return Promise.resolve();},openStationPopup:async(code,options)=>{stationOpenings.push({code,options});stationPopup.open=true;nodes.get('shared').hidden=false;},shareRunning:false,sharedOpenGeneration:0});
 vm.runInContext(readFileSync(new URL('./public/assets/app-navigation.js',import.meta.url),'utf8'),context);
 function flush(){while(frames.length)frames.shift()();}
 async function settle(){await Promise.resolve();await Promise.resolve();flush();}
 function click(target){const event={target:{closest:()=>target},button:0,preventDefault(){this.prevented=true;},stopImmediatePropagation(){this.stopped=true;}};for(const fn of events.get('click')||[])fn(event);flush();return event;}
 return {context,nodes,document,window,history,entries,supportLink,wifiLink,stationPopup,stationPopupClose,stationOpenings,click,flush,settle,loads:()=>loads,supportLoads:()=>supportLoads};
}

test('leaving Support stops local and approved embedded tutorials, and Back restores a paused player',async()=>{
 const f=fixture({path:'/support',initial:'support'}),track=f.nodes.get('supportVideos'),source='https://www.youtube-nocookie.com/embed/abC1234DEfg';let pauses=0;
 const video={tagName:'VIDEO',pause(){pauses++;}},youtube={tagName:'IFRAME',src:source},unrelated={tagName:'IFRAME',src:'https://other.example/embed/example'};track.children.push(video,youtube,unrelated);track.querySelectorAll=tag=>track.children.filter(child=>child.tagName===tag.toUpperCase());
 f.click(f.nodes.get('navRadio'));assert.equal(pauses,1);assert.equal(youtube.src,'about:blank');assert.equal(unrelated.src,'https://other.example/embed/example');assert.equal(f.nodes.get('myRadio').hidden,false);
 f.history.back();await f.settle();assert.equal(f.nodes.get('support').hidden,false);assert.equal(youtube.src,source);assert.doesNotMatch(youtube.src,/autoplay/);assert.equal(f.supportLoads(),0);
 f.click(f.nodes.get('navRadio'));assert.equal(pauses,2);assert.equal(youtube.src,'about:blank');
});

test('owner-page navigation also unloads a playing tutorial without touching the support draft',()=>{
 const f=fixture({path:'/support',initial:'support'}),track=f.nodes.get('supportVideos'),frame={src:'https://www.youtube-nocookie.com/embed/abC1234DEfg'},form=f.nodes.get('ticketForm');track.querySelectorAll=tag=>tag==='iframe'?[frame]:[];form.elements.message.value='Keep this draft';form.dataset.dirty='1';
 vm.runInContext("page('login')",f.context);assert.equal(frame.src,'about:blank');vm.runInContext("page('editor');page('support')",f.context);assert.equal(frame.src,'https://www.youtube-nocookie.com/embed/abC1234DEfg');assert.equal(form.elements.message.value,'Keep this draft');assert.equal(form.dataset.dirty,'1');
});

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

test('a station tap passes automatic add intent but browser Forward only restores its panel',async()=>{
 const f=fixture();await vm.runInContext("openStationPopup('13',{autoAdd:true})",f.context);
 assert.equal(f.stationOpenings.length,1);assert.equal(f.stationOpenings[0].code,'13');assert.equal(f.stationOpenings[0].options?.autoAdd,true);assert.equal(f.history.state.radioLocalsApp.code,'13');assert.equal(f.history.state.radioLocalsApp.autoAdd,undefined);
 f.history.back();await f.settle();assert.equal(f.stationPopup.open,false);
 f.history.forward();await f.settle();assert.equal(f.stationPopup.open,true);assert.equal(f.stationOpenings.length,2);assert.equal(f.stationOpenings[1].code,'13');assert.equal(!!f.stationOpenings[1].options?.autoAdd,false);
});

test('rapid repeated station taps open only one automatic add flow',async()=>{
 const f=fixture();await vm.runInContext("Promise.all([openStationPopup('13',{autoAdd:true}),openStationPopup('13',{autoAdd:true}),openStationPopup('14',{autoAdd:true})])",f.context);
 assert.equal(f.stationOpenings.length,1);assert.equal(f.stationOpenings[0].code,'13');assert.equal(f.stationOpenings[0].options?.autoAdd,true);assert.equal(f.entries.length,2);assert.equal(f.history.state.radioLocalsApp.code,'13');
});

test('owner, legal and modified-click navigation are left to their existing behavior',()=>{
 const f=fixture();for(const target of [f.nodes.get('navAdd'),{tagName:'A',href:'https://radio.example/copyright',id:''}]){const event=f.click(target);assert.equal(event.prevented,undefined);}assert.equal(f.entries.length,1);
});


test('Wi-Fi setup is a same-document listener route with its own title and deterministic return to Radio',async()=>{
 const f=fixture({app:true});f.nodes.get('search').value='local';f.window.scrollY=260;f.nodes.get('stations').scrollLeft=140;f.wifiLink.focus();
 const event=f.click(f.wifiLink);assert.equal(event.prevented,true);assert.equal(f.nodes.get('wifiSetup').hidden,false);assert.equal(f.nodes.get('myRadio').hidden,true);assert.equal(f.nodes.get('listenerAppTitle').textContent,'Wi-Fi setup');assert.equal(f.history.state.radioLocalsApp.page,'wifiSetup');assert.equal(f.entries.at(-1).url,'https://radio.example/wifi-setup?app=1');assert.equal(f.nodes.get('navRadio').attrs['aria-current'],'page');assert.equal(f.nodes.get('navAdd').hidden,true);assert.equal(f.supportLoads(),0);assert.equal(f.loads(),0);
 f.window.scrollY=85;f.click(f.nodes.get('wifiBackToRadio'));await f.settle();assert.equal(f.nodes.get('myRadio').hidden,false);assert.equal(f.window.scrollY,260);assert.equal(f.nodes.get('stations').scrollLeft,140);assert.equal(f.nodes.get('search').value,'local');assert.equal(f.document.activeElement,f.wifiLink);assert.equal(f.entries.length,2);assert.equal(f.history.state.radioLocalsApp.page,'myRadio');
 assert.equal(f.entries.at(-1).url,'https://radio.example/?app=1#radio');f.history.forward();await f.settle();assert.equal(f.nodes.get('myRadio').hidden,false);assert.equal(f.window.scrollY,260);assert.equal(f.supportLoads(),0);
});

test('Back to radio works when browser history.back is a no-op and keeps drafts and slider position',async()=>{
 const f=fixture(),form=f.nodes.get('ticketForm');let backwards=0;f.history.back=()=>{backwards++;};form.elements.message.value='Keep this support draft';form.dataset.dirty='1';f.nodes.get('search').value='community';f.nodes.get('stations').scrollLeft=135;f.window.scrollY=220;
 f.click(f.wifiLink);assert.equal(f.nodes.get('wifiSetup').hidden,false);f.window.scrollY=80;const event=f.click(f.nodes.get('wifiBackToRadio'));await f.settle();
 assert.equal(event.prevented,true);assert.equal(backwards,0);assert.equal(f.nodes.get('myRadio').hidden,false);assert.equal(f.nodes.get('wifiSetup').hidden,true);assert.equal(f.history.state.radioLocalsApp.page,'myRadio');assert.equal(f.entries.at(-1).url,'https://radio.example/#radio');assert.equal(f.nodes.get('listenerAppTitle').textContent,'Radio');assert.equal(f.nodes.get('navRadio').attrs['aria-current'],'page');assert.equal(f.window.scrollY,220);assert.equal(f.nodes.get('stations').scrollLeft,135);assert.equal(f.nodes.get('search').value,'community');assert.equal(form.elements.message.value,'Keep this support draft');assert.equal(form.dataset.dirty,'1');
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

test('a station report opens Help with station context and preserves a complete support draft',async()=>{
 const f=fixture({app:true}),form=f.nodes.get('ticketForm');form.elements.name.value='Listener';form.elements.email.value='listener@example.com';form.elements.device_code.value='3961';form.elements.message.value='x'.repeat(3000);form.elements.subject.value='No sound or playback problem';form.dataset.dirty='1';
 assert.equal(f.window.openStationProblemReport({code:'13',name:'A <tag> station'}),true);await f.settle();assert.equal(f.nodes.get('support').hidden,false);assert.equal(form.hidden,false);assert.equal(form.elements.station_code.value,'13');assert.equal(f.nodes.get('ticketStationName').textContent,'A <tag> station · #13');assert.equal(f.nodes.get('ticketStationContext').hidden,false);assert.equal(form.elements.name.value,'Listener');assert.equal(form.elements.email.value,'listener@example.com');assert.equal(form.elements.device_code.value,'3961');assert.equal(form.elements.message.value,'x'.repeat(3000));assert.equal(form.elements.subject.value,'No sound or playback problem');assert.equal(f.document.activeElement,form.elements.message);assert.equal(f.entries.at(-1).url,'https://radio.example/support?app=1');assert.equal(JSON.stringify(f.entries).includes('listener@example.com'),false);assert.equal(JSON.stringify(f.entries).includes('A <tag> station'),false);
});

test('reporting from a station popup replaces its panel so Back never repeats a station add',async()=>{
 const f=fixture();await vm.runInContext("openStationPopup('13')",f.context);assert.equal(f.stationOpenings.length,1);assert.equal(f.window.openStationProblemReport({code:'13',name:'Community Radio'}),true);await f.settle();assert.equal(f.stationPopup.open,false);assert.equal(f.history.state.radioLocalsApp.page,'support');assert.equal(f.history.state.radioLocalsApp.panel,null);assert.equal(f.nodes.get('ticketForm').elements.subject.value,'Station problem');f.history.back();await f.settle();assert.equal(f.nodes.get('myRadio').hidden,false);f.history.forward();await f.settle();assert.equal(f.nodes.get('support').hidden,false);assert.equal(f.stationOpenings.length,1);assert.equal(f.nodes.get('ticketForm').elements.station_code.value,'13');
});

test('reporting cannot change routes or a draft during an add, pairing, control or ticket request',()=>{
 for(const mode of ['add','pairing','controls','ticket','invalid']){const f=fixture(),form=f.nodes.get('ticketForm');form.elements.message.value='Keep draft';if(mode==='add')f.context.shareRunning=true;if(mode==='pairing')f.context.radioPairingBusy=true;if(mode==='controls')f.window.radioControlsBusy=true;if(mode==='ticket')form.dataset.busy='1';assert.equal(f.window.openStationProblemReport({code:mode==='invalid'?'../13':'13',name:'Station'}),false);assert.equal(f.nodes.get('myRadio').hidden,false);assert.equal(form.elements.message.value,'Keep draft');assert.equal(form.elements.station_code.value,'');assert.equal(f.entries.length,1);}
});

test('Clear station and form reset remove the association without replacing the message draft',async()=>{
 const f=fixture(),form=f.nodes.get('ticketForm');form.elements.message.value='Keep this message';f.window.openStationProblemReport({code:'13',name:'Station One'});await f.settle();f.nodes.get('clearTicketStation').dispatch('click');assert.equal(form.elements.station_code.value,'');assert.equal(f.nodes.get('ticketStationContext').hidden,true);assert.equal(form.elements.message.value,'Keep this message');f.window.openStationProblemReport({code:'14',name:'Station Two'});form.dispatch('reset');assert.equal(form.elements.station_code.value,'');assert.equal(f.nodes.get('ticketStationContext').hidden,true);assert.equal(f.nodes.get('ticketStationName').textContent,'');
});
