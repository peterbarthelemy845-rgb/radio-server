import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';

function fixture({app=false,standalone=false,path='/',initial='myRadio',ownerLifecycle=false,reducedMotion=false,i18n=null}={}){
 const events=new Map(),frames=[],mediaEvents={},nodes=new Map(),stationOpenings=[],connectionSteps=[];let loads=0,supportLoads=0,sharedGeneration=0;
 function node(id='',tag='DIV'){
  const listeners={};const n={id,tagName:tag,hidden:false,dataset:{},children:[],scrollLeft:0,isConnected:true,textContent:'',attrs:{},classList:{values:new Set(),toggle(name,on){if(on)this.values.add(name);else this.values.delete(name);}},setAttribute(key,value){this.attrs[key]=value;},addEventListener(key,fn){(listeners[key]??=[]).push(fn);},append(...items){this.children.push(...items);},before(...items){(this.beforeNodes??=[]).push(...items);},scrollTo(options){this.lastScroll=options;this.scrollLeft=options.left;this.dispatch('scroll');},focus(){document.activeElement=this;},querySelectorAll(){return [];},showModal(){this.open=true;},close(){this.open=false;queueMicrotask(()=>{for(const fn of listeners.close||[])fn({});});},dispatch(name,event={}){for(const fn of listeners[name]||[])fn(event);}};if(id)nodes.set(id,n);return n;
 }
 const ids=['myRadio','support','wifiSetup','login','register','editor','ownerEntryLoading','shared','admin','legal','advertise','adReview','reports','backups','navAdd','navRadio','navLibrary','openWifiSetup','wifiBackToRadio','wifiContinueConnection','search','listenerAppTitle','stations','savedStations','supportVideos','ticketForm','supportMessage','shareStatus','shareForm','shareName','shareWifiHelp','ticketStationContext','ticketStationName','clearTicketStation','reportStationProblem','verification','message'];ids.forEach(id=>node(id));nodes.get('ticketStationContext').hidden=true;nodes.get('wifiContinueConnection').hidden=true;
 for(const id of ['myRadio','support','wifiSetup','login','register','editor','ownerEntryLoading','shared','admin','legal','advertise','adReview','reports','backups'])nodes.get(id).hidden=id!==initial;
 const supportLink=node('supportLink','A');supportLink.href='https://radio.example/support';const wifiLink=nodes.get('openWifiSetup');wifiLink.tagName='A';wifiLink.href='https://radio.example/wifi-setup';
 const document={body:node(),activeElement:null,querySelector(selector){return selector.startsWith('nav a')?supportLink:null;},createElement:tag=>node('',tag.toUpperCase())};nodes.get('ticketForm').elements=Object.fromEntries(['name','email','device_code','subject','message','station_code'].map(key=>[key,Object.assign(node('ticket-'+key,'INPUT'),{value:''})]));
 const location={origin:'https://radio.example'};
 function update(url){const parsed=new URL(url,location.origin);Object.assign(location,{href:parsed.href,pathname:parsed.pathname,search:parsed.search,hash:parsed.hash});}update(path+(app?'?app=1':'')+(path==='/'?'#radio':''));
 const entries=[{url:location.href,state:null}];let index=0;
 const history={scrollRestoration:'auto',get state(){return entries[index].state;},replaceState(state,unused,url){entries[index]={state,url:new URL(url,location.href).href};update(entries[index].url);},pushState(state,unused,url){entries.splice(index+1);entries.push({state,url:new URL(url,location.href).href});index++;update(entries[index].url);},back(){this.go(-1);},forward(){this.go(1);},go(amount){const next=index+amount;if(next<0||next>=entries.length)return;index=next;update(entries[index].url);for(const fn of events.get('popstate')||[])fn({state:entries[index].state});}};
 const stationPopup=node('stationAddPopup','DIALOG'),stationPopupClose=node('stationPopupClose','BUTTON');
 const window={showRadioCodeEntry(){connectionSteps.push('code');nodes.get('search').focus();},showRadioConnectionChoices(){connectionSteps.push('choices');},scrollX:0,scrollY:0,appI18n:i18n,scrollTo(x,y){this.scrollX=x;this.scrollY=y;},addEventListener(key,fn){const list=events.get(key)||[];list.push(fn);events.set(key,list);}};
 const context=vm.createContext({document,window,history,location,navigator:{standalone:false},matchMedia:query=>({matches:query==='(prefers-reduced-motion: reduce)'?reducedMotion:standalone,addEventListener(name,fn){mediaEvents[name]=fn;}}),URL,URLSearchParams,Object,Map,Promise,queueMicrotask,requestAnimationFrame:fn=>frames.push(fn),$:(id)=>nodes.get(id),stationPopup,stationPopupClose,radioCardViews:new Map(),
  page(id){for(const key of ['myRadio','support','wifiSetup','login','register','editor','ownerEntryLoading','shared','admin','legal','advertise','adReview','reports','backups'])nodes.get(key).hidden=key!==id;},list(){},loadMyRadios(){loads++;return Promise.resolve();},loadSupport(){supportLoads++;nodes.get('supportVideos').children.push(node());return Promise.resolve();},openStationPopup:async(code,options)=>{stationOpenings.push({code,options});stationPopup.open=true;nodes.get('shared').hidden=false;},setSharedStatus(text,kind='progress'){nodes.get('shareStatus').textContent=text;nodes.get('shareStatus').dataset.status=kind;},shareRunning:false,sharedOpenGeneration:0,stopWaitingForSharedStation(){context.shareRunning=false;context.sharedOpenGeneration++;},invalidateSharedView(){context.shareRunning=false;context.sharedOpenGeneration++;}});
 if(ownerLifecycle){
  const site=readFileSync(new URL('./public/assets/site.js',import.meta.url),'utf8');
  vm.runInContext('let sitePageGeneration=0,verificationId=null,verificationGeneration=0,verificationPageGeneration=0,verificationResendDeadline=0,verificationBusy=false;function setVerificationBusy(value){verificationBusy=value;}',context);
  vm.runInContext(site.slice(site.indexOf('function currentVerification('),site.indexOf('function verify(result)')),context);
  vm.runInContext(site.slice(site.indexOf('function page('),site.indexOf('function message(')),context);
 }
 vm.runInContext(readFileSync(new URL('./public/assets/app-navigation.js',import.meta.url),'utf8'),context);
 function flush(){while(frames.length)frames.shift()();}
 async function settle(){await Promise.resolve();await Promise.resolve();flush();}
 function click(target){const event={target:{closest:()=>target},button:0,preventDefault(){this.prevented=true;},stopImmediatePropagation(){this.stopped=true;}};for(const fn of events.get('click')||[])fn(event);flush();return event;}
 return {context,nodes,document,window,history,entries,supportLink,wifiLink,stationPopup,stationPopupClose,stationOpenings,connectionSteps,click,flush,settle,dispatchWindow(name,event={}){for(const fn of events.get(name)||[])fn(event);},loads:()=>loads,supportLoads:()=>supportLoads};
}

function guideControls(f,offsets=[24,324,624]){
 const track=f.nodes.get('supportVideos');track.children=offsets.map(offsetLeft=>({offsetLeft}));f.dispatchWindow('support-guides-ready');
 const navigation=track.beforeNodes.at(-1),[previous,position,next]=navigation.children;return {track,navigation,previous,position,next};
}

test('guide buttons track the closest visible tutorial, announce its position and disable at either end',()=>{
 const f=fixture({path:'/support',initial:'support'}),g=guideControls(f);
 assert.equal(g.navigation.hidden,false);assert.equal(g.previous.disabled,true);assert.equal(g.next.disabled,false);assert.equal(g.position.textContent,'1 of 3');assert.equal(g.position.attrs['aria-live'],'polite');assert.equal(g.position.attrs['aria-atomic'],'true');
 assert.equal(g.previous.attrs['aria-label'],'Previous guide');assert.equal(g.next.attrs['aria-label'],'Next guide');
 g.next.onclick();assert.equal(g.track.lastScroll.left,300);assert.equal(g.track.lastScroll.behavior,'smooth');assert.equal(g.position.textContent,'2 of 3');assert.equal(g.previous.disabled,false);assert.equal(g.next.disabled,false);
 g.next.onclick();assert.equal(g.track.lastScroll.left,600);assert.equal(g.position.textContent,'3 of 3');assert.equal(g.next.disabled,true);
 g.previous.onclick();assert.equal(g.track.scrollLeft,300);assert.equal(g.position.textContent,'2 of 3');
 g.track.scrollLeft=510;g.track.dispatch('scroll');assert.equal(g.position.textContent,'3 of 3');assert.equal(g.next.disabled,true);
 f.dispatchWindow('resize');assert.equal(g.position.textContent,'3 of 3');f.dispatchWindow('support-guides-ready');assert.equal(g.track.beforeNodes.length,1);
});

test('single or empty guide collections hide navigation and still have safe end states',()=>{
 for(const offsets of [[],[40]]){const f=fixture(),g=guideControls(f,offsets);assert.equal(g.navigation.hidden,true);assert.equal(g.previous.disabled,true);assert.equal(g.next.disabled,true);assert.equal(g.position.textContent,offsets.length?'1 of 1':'0 of 0');if(!offsets.length){g.next.onclick();assert.equal(g.track.lastScroll,undefined);}}
});

test('changing guides honors reduced motion and stops existing players without autoplaying their replacements',()=>{
 for(const reducedMotion of [false,true]){
  const f=fixture({reducedMotion,path:'/support',initial:'support'}),g=guideControls(f);let pauses=0;const pauseCalls=[];
  const video={pause(){pauses++;pauseCalls.push(true);}},source='https://www.youtube-nocookie.com/embed/abC1234DEfg',frame={_src:source,get src(){return this._src;},set src(value){pauseCalls.push(value);this._src=value;}},unrelated={src:'https://other.example/embed/example'};
  g.track.querySelectorAll=tag=>tag==='video'?[video]:tag==='iframe'?[frame,unrelated]:[];
  g.next.onclick();assert.equal(g.track.lastScroll.behavior,reducedMotion?'auto':'smooth');assert.equal(pauses,1);assert.deepEqual(pauseCalls,[true,'about:blank',source]);assert.equal(frame.src,source);assert.doesNotMatch(frame.src,/autoplay/);assert.equal(unrelated.src,'https://other.example/embed/example');
 }
});

test('document titles describe the visible listener and owner page and update with the selected language',()=>{
 let translated=false;const messages={'title.myRadio':'Radyo','title.support':'Sipò','title.wifiSetup':'Konfigirasyon Wi-Fi','title.login':'Konekte','title.register':'Kreye estasyon','title.editor':'Modifye estasyon'};
 const i18n={t(key){return translated?messages[key]||key:key;}},f=fixture({i18n});assert.equal(f.document.title,'Radio — Radio Locals');
 for(const [id,label] of [['support','Support'],['wifiSetup','Wi-Fi setup'],['login','Sign in'],['register','Create station'],['editor','Station editor']]){vm.runInContext(`page('${id}')`,f.context);assert.equal(f.document.title,label+' — Radio Locals');}
 translated=true;f.dispatchWindow('app-language-changed');assert.equal(f.document.title,'Modifye estasyon — Radio Locals');
 for(const id of ['myRadio','support','wifiSetup','login','register']){vm.runInContext(`page('${id}')`,f.context);assert.equal(f.document.title,messages['title.'+id]+' — Radio Locals');}
 vm.runInContext("page('reports')",f.context);assert.equal(f.document.title,'Reports — Radio Locals');
});

test('guide controls and their live position change language without losing the current tutorial',()=>{
 let translated=false;const i18n={t(key,values){if(!translated)return key.startsWith('title.')?key:({ 'guide.previous':'Previous guide','guide.next':'Next guide','guide.previousShort':'Previous','guide.nextShort':'Next'}[key]||(key==='guide.position'?`${values.current} of ${values.total}`:key));return {'guide.previous':'Gid anvan','guide.next':'Pwochen gid','guide.previousShort':'Anvan','guide.nextShort':'Apre'}[key]||(key==='guide.position'?`${values.current} sou ${values.total}`:key);}};
 const f=fixture({i18n}),g=guideControls(f);g.next.onclick();translated=true;f.dispatchWindow('app-language-changed');
 assert.equal(g.position.textContent,'2 sou 3');assert.equal(g.previous.attrs['aria-label'],'Gid anvan');assert.equal(g.next.attrs['aria-label'],'Pwochen gid');assert.equal(g.previous.textContent,'Anvan');assert.equal(g.next.textContent,'Apre');assert.equal(g.track.scrollLeft,300);assert.equal(g.previous.disabled,false);assert.equal(g.next.disabled,false);
});

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

test('a standalone owner loading or retry card keeps account navigation available and its own title',()=>{
 for(const options of [{app:true},{standalone:true}]){
  const f=fixture({...options,path:'/add-station',initial:'ownerEntryLoading'});
  assert.equal(f.nodes.get('ownerEntryLoading').hidden,false);
  assert.equal(f.nodes.get('navAdd').hidden,false);
  assert.equal(f.document.body.classList.values.has('app-listener-page'),false);
  assert.equal(f.document.title,'Station account — Radio Locals');
  // A failed owner read leaves the loading card as the retry screen. Startup
  // reconciliation must not reinterpret it as Radio and hide its retry tab.
  f.nodes.get('ownerEntryLoading').textContent='Could not load your station. Tap Station account to try again.';
  f.dispatchWindow('radio-locals-ready');
  assert.equal(f.nodes.get('navAdd').hidden,false);
  assert.equal(f.document.title,'Station account — Radio Locals');
  assert.equal(f.nodes.get('myRadio').hidden,true);
 }
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

test('pending station adds can stop waiting with Close, Escape or browser Back without claiming cancellation',async()=>{
 for(const method of ['close','escape','back']){const f=fixture();await vm.runInContext("openStationPopup('13'); shareRunning=true",f.context);const generation=f.context.sharedOpenGeneration;
  if(method==='close')f.stationPopupClose.onclick();else if(method==='escape'){let prevented=false;f.stationPopup.dispatch('cancel',{preventDefault(){prevented=true;}});assert.equal(prevented,true);}else f.history.back();
  await f.settle();assert.equal(f.stationPopup.open,false);assert.equal(f.context.shareRunning,false);assert.ok(f.context.sharedOpenGeneration>generation);assert.equal(f.history.state.radioLocalsApp.panel,null);assert.doesNotMatch(f.nodes.get('shareStatus').textContent,/success|cancelled|canceled/i);
 }
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


test('browser Back leaves owner verification through the real core page lifecycle',async()=>{
 const f=fixture({ownerLifecycle:true});f.click(f.supportLink);vm.runInContext("page('login');verificationId='owner-challenge';verificationPageGeneration=sitePageGeneration;verificationBusy=true;verificationResendDeadline=Date.now()+60000;",f.context);f.nodes.get('verification').showModal();const generation=vm.runInContext('verificationGeneration',f.context);assert.equal(vm.runInContext("currentVerification(verificationGeneration,'owner-challenge')",f.context),true);
 f.history.back();await f.settle();assert.equal(f.nodes.get('verification').open,false);assert.equal(f.nodes.get('myRadio').hidden,false);assert.equal(f.nodes.get('login').hidden,true);assert.equal(vm.runInContext('verificationId',f.context),null);assert.equal(vm.runInContext('verificationBusy',f.context),false);assert.equal(vm.runInContext('verificationResendDeadline',f.context),0);assert.ok(vm.runInContext('verificationGeneration',f.context)>generation);assert.equal(vm.runInContext("currentVerification("+generation+",'owner-challenge')",f.context),false);
});


test('Back with no app state still dismisses a pending station popup',async()=>{
 const f=fixture();f.history.replaceState(null,'',f.context.location.href);await vm.runInContext("openStationPopup('13'); shareRunning=true",f.context);f.entries[0].state=null;f.history.back();await f.settle();assert.equal(f.stationPopup.open,false);assert.equal(f.context.shareRunning,false);
});

test('station Wi-Fi help replaces the sheet and browser Back returns to Radio without reopening an add',async()=>{
 const f=fixture({app:true});f.window.scrollY=240;f.nodes.get('stations').scrollLeft=110;await vm.runInContext("openStationPopup('13',{autoAdd:true})",f.context);assert.equal(f.stationPopup.open,true);assert.equal(f.entries.length,2);
 f.nodes.get('shareWifiHelp').onclick();await f.settle();assert.equal(f.stationPopup.open,false);assert.equal(f.nodes.get('wifiSetup').hidden,false);assert.equal(f.nodes.get('shared').hidden,true);assert.equal(f.history.state.radioLocalsApp.page,'wifiSetup');assert.equal(f.history.state.radioLocalsApp.panel,null);assert.equal(f.entries.at(-1).url,'https://radio.example/wifi-setup?app=1');assert.equal(f.entries.length,2);
 f.history.back();await f.settle();assert.equal(f.nodes.get('myRadio').hidden,false);assert.equal(f.window.scrollY,240);assert.equal(f.nodes.get('stations').scrollLeft,110);assert.equal(f.stationOpenings.length,1);assert.equal(f.stationPopup.open,false);f.history.forward();await f.settle();assert.equal(f.nodes.get('wifiSetup').hidden,false);assert.equal(f.stationOpenings.length,1);assert.equal(f.stationPopup.open,false);
});

test('Wi-Fi help cannot abandon a still-running station request',async()=>{
 const f=fixture();await vm.runInContext("openStationPopup('13');shareRunning=true",f.context);f.nodes.get('shareWifiHelp').onclick();await f.settle();assert.equal(f.stationPopup.open,true);assert.equal(f.nodes.get('wifiSetup').hidden,true);assert.equal(f.history.state.radioLocalsApp.panel,'station');
});


test('guided Wi-Fi setup returns to the Device Code step without storing connection data in history',async()=>{
 const f=fixture({app:true});f.window.scrollY=180;f.nodes.get('stations').scrollLeft=120;
 assert.equal(f.window.openGuidedRadioWifi(),true);f.flush();assert.equal(f.nodes.get('wifiSetup').hidden,false);assert.equal(f.nodes.get('wifiContinueConnection').hidden,false);assert.equal(f.entries.at(-1).url,'https://radio.example/wifi-setup?app=1');assert.equal(f.entries.length,2);
 const event=f.click(f.nodes.get('wifiContinueConnection'));await f.settle();assert.equal(event.prevented,true);assert.equal(f.nodes.get('myRadio').hidden,false);assert.equal(f.nodes.get('wifiContinueConnection').hidden,true);assert.deepEqual(f.connectionSteps,['code']);assert.equal(f.document.activeElement,f.nodes.get('search'));assert.equal(f.window.scrollY,180);assert.equal(f.nodes.get('stations').scrollLeft,120);assert.equal(f.entries.at(-1).url,'https://radio.example/?app=1#radio');assert.equal(f.loads(),1);
 assert.equal(JSON.stringify(f.entries).includes('guided'),false);f.history.back();await f.settle();f.history.forward();await f.settle();assert.deepEqual(f.connectionSteps,['code']);
});

test('guided Wi-Fi Back and Radio tab return to the chooser without automatically entering a code',async()=>{
 for(const method of ['back','button','radio']){const f=fixture();f.window.openGuidedRadioWifi();f.flush();if(method==='back')f.history.back();else f.click(f.nodes.get(method==='button'?'wifiBackToRadio':'navRadio'));await f.settle();assert.equal(f.nodes.get('myRadio').hidden,false);assert.equal(f.nodes.get('wifiContinueConnection').hidden,true);assert.deepEqual(f.connectionSteps,['choices']);
  f.history.forward();await f.settle();assert.deepEqual(f.connectionSteps,['choices']);if(!f.nodes.get('wifiSetup').hidden)assert.equal(f.nodes.get('wifiContinueConnection').hidden,true);
 }
});

test('normal and directly opened Wi-Fi help never show guided continuation',async()=>{
 for(const options of [{},{path:'/wifi-setup',initial:'wifiSetup'}]){const f=fixture(options);if(options.initial!=='wifiSetup')f.click(f.wifiLink);assert.equal(f.nodes.get('wifiContinueConnection').hidden,true);f.click(f.nodes.get('wifiContinueConnection'));assert.equal(f.nodes.get('wifiSetup').hidden,false);assert.deepEqual(f.connectionSteps,[]);f.click(f.nodes.get('wifiBackToRadio'));await f.settle();assert.deepEqual(f.connectionSteps,[]);}
});

test('leaving guided setup clears its intent so browser Back cannot resume a stale link flow',async()=>{
 for(const destination of ['support','owner']){const f=fixture();f.window.openGuidedRadioWifi();f.flush();if(destination==='support')f.click(f.supportLink);else vm.runInContext("page('login')",f.context);assert.equal(f.nodes.get('wifiContinueConnection').hidden,true);if(destination==='support'){f.history.back();await f.settle();assert.equal(f.nodes.get('wifiSetup').hidden,false);assert.equal(f.nodes.get('wifiContinueConnection').hidden,true);f.click(f.nodes.get('wifiBackToRadio'));}else vm.runInContext("page('myRadio')",f.context);assert.deepEqual(f.connectionSteps,[]);}
});

test('a known linked radio skips code entry when returning from guided Wi-Fi setup',async()=>{
 for(const method of ['continue','back']){const f=fixture();f.window.openGuidedRadioWifi();f.context.radioCardViews.set('known',{radio:{id:'known',online:true}});if(method==='continue')f.click(f.nodes.get('wifiContinueConnection'));else f.history.back();await f.settle();assert.equal(f.nodes.get('myRadio').hidden,false);assert.deepEqual(f.connectionSteps,[]);assert.equal(f.nodes.get('wifiContinueConnection').hidden,true);assert.equal(f.loads(),1);}
});

test('guided Wi-Fi setup cannot abandon pending station, control or pairing requests',()=>{
 for(const mode of ['station','controls','pairing','wrong-page']){const f=fixture();if(mode==='station')f.context.shareRunning=true;if(mode==='controls')f.window.radioControlsBusy=true;if(mode==='pairing')f.context.radioPairingBusy=true;if(mode==='wrong-page')vm.runInContext("page('support')",f.context);assert.equal(f.window.openGuidedRadioWifi(),false);assert.equal(f.nodes.get('wifiSetup').hidden,true);assert.equal(f.nodes.get('wifiContinueConnection').hidden,true);assert.equal(f.entries.length,1);}
});


test('history entries without application state clear a guided Wi-Fi continuation',()=>{
 const f=fixture();f.window.openGuidedRadioWifi();assert.equal(f.nodes.get('wifiContinueConnection').hidden,false);f.dispatchWindow('popstate',{state:null});assert.equal(f.nodes.get('wifiContinueConnection').hidden,true);f.click(f.nodes.get('wifiContinueConnection'));assert.equal(f.nodes.get('wifiSetup').hidden,false);assert.deepEqual(f.connectionSteps,[]);
});
