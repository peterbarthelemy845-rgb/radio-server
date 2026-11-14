import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
const source=readFileSync(new URL('./public/assets/my-radio.js',import.meta.url),'utf8');
function fixture(){
 const ids=new Map(),windowEvents={},documentEvents={},observers=[],answers=[],calls=[],dialogs=[],dialogAnswers=[],reports=[],selections=[],statusEvents=[],timers=new Map();let clock=Date.UTC(2026,10,7,12,30),selectedRadio='one',timerId=0;
 function node(tag='div'){
  return {tag,children:[],hidden:false,textContent:'',className:'',attributes:{},replacements:0,disabled:false,
   setAttribute(key,value){this.attributes[key]=value;},append(...children){this.children.push(...children);},replaceChildren(...children){this.replacements++;this.children=children;},before(other){this.beforeNode=other;},focus(){document.activeElement=this;},
   querySelector(selector){if(selector==='button')return this.button;return null;},reset(){}};
 }
 for(const id of ['myRadio','linkedRadios','connectRadio','connectRadioForm','cancelRadioConnection','radioConnectStatus','refreshRadios','navRadio','openWifiSetup','radioConnectionChoices','setupRadioWifi','radioAlreadyOnline','radioCodeBack','radioConnectionExit'])ids.set(id,node());ids.get('openWifiSetup').hidden=true;ids.get('cancelRadioConnection').hidden=true;
 ids.get('connectRadioForm').button=node('button');ids.get('connectRadioForm').elements={device_code:{value:'3961',focus(){}}};
 const navigator={onLine:true},document={hidden:false,activeElement:null,createElement:node,addEventListener(name,fn){documentEvents[name]=fn;}};
 class FakeDate extends Date{constructor(...args){super(...(args.length?args:[clock]));}static now(){return clock;}}
 const context={document,navigator,Date:FakeDate,URLSearchParams,location:{search:'',hash:'#radio'},history:{replaceState(){}},
  CustomEvent:class{constructor(type,options){this.type=type;this.detail=options?.detail;}},window:{openStationProblemReport:station=>reports.push(station),dispatchEvent(event){statusEvents.push(event);},addEventListener(name,fn){windowEvents[name]=fn;}},MutationObserver:class{constructor(fn){this.fn=fn;observers.push(this);}observe(){}},
  $:id=>ids.get(id),api:async path=>{calls.push(path);const next=answers.shift();if(next instanceof Error)throw next;if(typeof next==='function')return next();if(!next)throw Error('No fixture response');return next;},
  reconcileSelectedRadio:radios=>selectedRadio=radios.length===1?radios[0].id:radios.some(r=>r.id===selectedRadio)?selectedRadio:'',loadRadioInventory(){},readRadioInventory:id=>context.radioInventories.get(id),readSelectedRadio(){return selectedRadio;},rememberSelectedRadio(id){selectedRadio=id;selections.push(id);},radioInventories:new Map(),listenerActionDialog:async(title)=>{dialogs.push(title);return dialogAnswers.length?await dialogAnswers.shift():true;},page(){ids.get('myRadio').hidden=false;},busy(){},human:async()=>'',delay:async()=>{},setTimeout(fn,delay){const id=++timerId;timers.set(id,{fn,delay});return id;},clearTimeout(id){timers.delete(id);}};
 runInNewContext(source,context);
 const load=runInNewContext('loadMyRadios',context),freshness=ids.get('radioConnectStatus').beforeNode;
 return {ids,load,answers,calls,dialogs,dialogAnswers,reports,selections,statusEvents,timers,inventories:context.radioInventories,windowEvents,documentEvents,navigator,document,freshness,views:()=>ids.get('linkedRadios').children,schedule:runInNewContext('scheduleRadioRefresh',context),refreshDelay:runInNewContext('radioRefreshDelay',context),scheduled:()=>[...timers.values()].at(-1),async poll(){const [id,timer]=[...timers].at(-1)||[];assert.ok(timer,'Expected one scheduled status poll');timers.delete(id);await timer.fn();},
  advance(ms){clock+=ms;},visibility(){observers[0].fn();},async flush(){await new Promise(resolve=>setImmediate(resolve));}};
}
const radio={id:'one',device_code:'3961',online:true,current_station:'Community Radio'};
const response=(overrides={})=>({radios:[{...radio,...overrides}]});

test('healthy radio checks hide timestamps and unchanged polls preserve card nodes without flashing',async()=>{
 const f=fixture();f.answers.push(response());await f.load();const card=f.views()[0],status=card.children[0].children[1],station=card.children[1],count=f.ids.get('linkedRadios').replacements;
 assert.equal(status.textContent,'Online');assert.equal(status.className,'radio-online');assert.equal(station.textContent,'Current station: COMMUNITY RADIO');assert.equal(f.freshness.textContent,'');assert.equal(f.freshness.hidden,true);assert.equal(f.ids.get('linkedRadios').attributes['aria-busy'],'false');
 f.advance(60000);f.answers.push(response());await f.load(true);assert.equal(f.views()[0],card);assert.equal(f.ids.get('linkedRadios').replacements,count);assert.equal(f.freshness.textContent,'');assert.equal(f.freshness.hidden,true);assert.equal(f.ids.get('radioConnectStatus').textContent,'');
});

test('returning to stale radio data shows a neutral update until the fresh response arrives',async()=>{
 const f=fixture();f.answers.push(response({current_station_code:'10'}));await f.load();const card=f.views()[0],status=card.children[0].children[1],station=card.children[1],report=card.children[3],events=f.statusEvents.length;
 f.ids.get('myRadio').hidden=true;f.visibility();f.advance(60000);const check=deferred();f.answers.push(check.promise);f.ids.get('myRadio').hidden=false;f.visibility();
 assert.equal(f.views()[0],card);assert.equal(status.textContent,'Updating status…');assert.equal(status.className,'radio-unknown');assert.equal(station.textContent,'Current station: COMMUNITY RADIO');assert.equal(report.hidden,true);assert.match(f.freshness.textContent,/^Last checked /);assert.equal(f.ids.get('radioConnectStatus').textContent,'');assert.equal(f.ids.get('refreshRadios').hidden,true);assert.equal(f.ids.get('linkedRadios').attributes['aria-busy'],'true');assert.equal(f.statusEvents.length,events);
 check.resolve(response({online:false}));await f.flush();assert.equal(f.views()[0].children[0].children[1].textContent,'Radio offline. Check power and Wi-Fi.');assert.equal(f.freshness.textContent,'');assert.equal(f.freshness.hidden,true);assert.equal(f.ids.get('refreshRadios').hidden,true);
});

test('a regular silent poll keeps healthy cards and hidden timestamps steady while in flight',async()=>{
 const f=fixture();f.answers.push(response());await f.load();const card=f.views()[0],status=card.children[0].children[1],check=deferred(),replacements=f.ids.get('linkedRadios').replacements;f.advance(10000);f.answers.push(check.promise);const pending=f.load(true);
 assert.equal(status.textContent,'Online');assert.equal(status.className,'radio-online');assert.equal(f.freshness.hidden,true);assert.equal(f.freshness.textContent,'');assert.equal(f.ids.get('refreshRadios').hidden,true);check.resolve(response());await pending;assert.equal(f.views()[0],card);assert.equal(f.ids.get('linkedRadios').replacements,replacements);assert.equal(f.freshness.hidden,true);
});

test('a refresh only reveals retry after failure and explicit retry clears old error feedback',async()=>{
 const f=fixture();f.answers.push(response());await f.load();const card=f.views()[0],check=deferred();f.advance(60000);f.answers.push(check.promise);const request=f.load(true);
 assert.equal(card.children[0].children[1].textContent,'Updating status…');assert.equal(f.ids.get('refreshRadios').hidden,true);check.reject(Error('Service unavailable'));await request;
 assert.equal(card.children[0].children[1].textContent,'Status unavailable');assert.match(f.ids.get('radioConnectStatus').textContent,/Service unavailable.*Try again/);assert.equal(f.ids.get('refreshRadios').hidden,false);
 const retry=deferred();f.answers.push(retry.promise);const retrying=f.load();assert.equal(card.children[0].children[1].textContent,'Updating status…');assert.equal(f.ids.get('radioConnectStatus').textContent,'');assert.equal(f.ids.get('refreshRadios').hidden,true);retry.resolve(response());await retrying;assert.equal(card.children[0].children[1].textContent,'Online');
});

test('an unlinked radio page does not claim a device status was checked',async()=>{
 const f=fixture();f.answers.push({radios:[]});await f.load();assert.equal(f.freshness.hidden,true);assert.equal(f.freshness.textContent,'');assert.equal(f.ids.get('connectRadioForm').hidden,true);assert.equal(f.ids.get('connectRadio').hidden,false);assert.equal(f.ids.get('radioConnectionChoices').hidden,true);assert.equal(f.views().length,0);
 f.answers.push(response());await f.load(true);assert.equal(f.freshness.hidden,true);assert.equal(f.freshness.textContent,'');
 f.answers.push({radios:[]});await f.load(true);assert.equal(f.freshness.hidden,true);assert.equal(f.freshness.textContent,'');
 f.answers.push(Error('Status unavailable'));await f.load(true);assert.equal(f.freshness.hidden,false);assert.equal(f.ids.get('refreshRadios').hidden,false);
});

test('Wi-Fi help is available for an offline linked radio while first setup uses Connect',async()=>{
 const f=fixture(),help=f.ids.get('openWifiSetup');assert.equal(help.hidden,true);
 for(const [answer,visible] of [[{radios:[]},false],[response(),false],[response({online:false}),true],[response({online:false}),true],[Error('Status failed'),true],[response({online:false}),true],[response(),false],[{radios:[]},false]]){f.answers.push(answer);await f.load(true);assert.equal(!help.hidden,visible);}
 f.answers.push(response({online:false}));await f.load();assert.equal(help.hidden,false);f.navigator.onLine=false;f.windowEvents.offline();assert.equal(help.hidden,false);
});

test('an expired phone session removes stale radio actions and opens reconnect without a reload',async()=>{
 const f=fixture();f.answers.push(response({current_station_code:'10'}));await f.load();const old=f.views()[0],unlink=old.children[2],report=old.children[3];f.inventories.set('one',{known:true,codes:new Set(['10'])});
 f.answers.push(Object.assign(Error('Please reload this page.'),{status:401}));await f.load(true);
 assert.equal(f.views().length,0);assert.equal(f.ids.get('connectRadioForm').hidden,true);assert.equal(f.ids.get('connectRadio').hidden,false);assert.equal(f.ids.get('refreshRadios').hidden,true);assert.equal(f.ids.get('openWifiSetup').hidden,true);assert.equal(f.freshness.hidden,true);assert.match(f.ids.get('radioConnectStatus').textContent,/Connect your radio again/);assert.equal(f.selections.at(-1),'');assert.equal(f.inventories.size,0);assert.equal(f.statusEvents.at(-1).detail.radios.length,0);
 await unlink.onclick();report.onclick();assert.equal(f.dialogs.length,0);assert.equal(f.reports.length,0);assert.equal(f.calls.includes('/api/phone/unlink'),false);
 f.answers.push({radios:[]});await f.load(true);assert.equal(f.ids.get('connectRadioForm').hidden,true);assert.equal(f.ids.get('openWifiSetup').hidden,true);
});

test('a late unauthorized check cannot replace another page with the reconnect form',async()=>{
 const f=fixture();f.answers.push(response());await f.load();const check=deferred();f.answers.push(check.promise);const pending=f.load(true);f.ids.get('myRadio').hidden=true;f.visibility();check.reject(Object.assign(Error('Expired'),{status:401}));await pending;
 assert.equal(f.ids.get('connectRadioForm').hidden,true);assert.equal(f.selections.length,0);assert.equal(f.views().length,1);assert.doesNotMatch(f.ids.get('radioConnectStatus').textContent,/expired/);
});

test('another offline radio cannot show Wi-Fi help for the selected online radio',async()=>{
 const f=fixture();f.answers.push({radios:[radio,{...radio,id:'two',online:false}]});await f.load();assert.equal(f.ids.get('openWifiSetup').hidden,true);
});

test('an offline linked radio shows Wi-Fi help without stale station actions and returns online automatically',async()=>{
 const f=fixture();f.answers.push(response({online:false,current_station_code:'10'}));await f.load();
 const card=f.views()[0],[row,station,unlink,report]=card.children,[code,status]=row.children,replacements=f.ids.get('linkedRadios').replacements;
 assert.equal(status.textContent,'Radio offline. Check power and Wi-Fi.');assert.equal(status.className,'radio-offline');
 assert.equal(station.hidden,true);assert.equal(report.hidden,true);report.onclick();assert.equal(f.reports.length,0);
 assert.equal(code.textContent,'Device code 3961');assert.equal(unlink.hidden,false);assert.equal(f.ids.get('openWifiSetup').hidden,false);
 for(const id of ['connectRadio','radioConnectionChoices','connectRadioForm','radioCodeBack'])assert.equal(f.ids.get(id).hidden,true);
 f.schedule();f.answers.push(response({current_station:'Fresh station',current_station_code:'11'}));await f.poll();
 assert.equal(f.views()[0],card);assert.equal(f.ids.get('linkedRadios').replacements,replacements);assert.equal(status.textContent,'Online');assert.equal(status.className,'radio-online');
 assert.equal(station.hidden,false);assert.equal(station.textContent,'Current station: FRESH STATION');assert.equal(report.hidden,false);report.onclick();assert.equal(f.reports.at(-1).code,'11');
 assert.equal(f.ids.get('openWifiSetup').hidden,true);assert.equal(f.ids.get('radioConnectStatus').textContent,'');
 for(const id of ['connectRadio','radioConnectionChoices','connectRadioForm','radioCodeBack'])assert.equal(f.ids.get(id).hidden,true);
 assert.deepEqual(f.calls,['/api/phone/radios','/api/phone/radios']);assert.equal(f.dialogs.length,0);
});

test('the current station report action stays in place and uses the latest station',async()=>{
 const f=fixture();f.answers.push(response({current_station_code:'10'}));await f.load();const first=f.views()[0].children[3];assert.equal(first.hidden,false);first.onclick();assert.equal(f.reports[0].code,'10');assert.equal(f.reports[0].name,'Community Radio');
 f.answers.push(response({current_station:'Next station',current_station_code:'11'}));await f.load(true);const next=f.views()[0].children[3];assert.equal(next,first);next.onclick();assert.equal(f.reports.length,2);assert.equal(f.reports[1].code,'11');
 f.answers.push(Error('Status unavailable'));await f.load(true);assert.equal(next.hidden,true);next.onclick();assert.equal(f.reports.length,2);
});

test('failed silent checks replace green Online and successful unchanged data restores it in place',async()=>{
 const f=fixture();f.answers.push(response());await f.load();const card=f.views()[0],count=f.ids.get('linkedRadios').replacements;
 f.answers.push(Error('Service temporarily unavailable.'));await f.load(true);assert.equal(card.children[0].children[1].textContent,'Status unavailable');assert.equal(card.children[0].children[1].className,'radio-unknown');assert.match(card.children[1].textContent,/Unavailable until status is checked/);assert.match(f.freshness.textContent,/^Last checked /);assert.equal(f.ids.get('refreshRadios').hidden,false);
 f.advance(60000);f.answers.push(response());await f.load(true);assert.equal(f.views()[0],card);assert.equal(f.ids.get('linkedRadios').replacements,count);assert.equal(card.children[0].children[1].className,'radio-online');assert.equal(card.children[0].children[1].textContent,'Online');assert.equal(f.ids.get('refreshRadios').hidden,true);assert.equal(f.ids.get('radioConnectStatus').textContent,'');
});

test('browser offline event immediately removes online status and labels stale station data unavailable',async()=>{
 const f=fixture();f.answers.push(response());await f.load();const status=f.views()[0].children[0].children[1],before=f.calls.length;f.navigator.onLine=false;f.windowEvents.offline();assert.equal(status.className,'radio-unknown');assert.equal(status.textContent,'Status unavailable');assert.match(f.ids.get('radioConnectStatus').textContent,/No internet/);assert.equal(f.calls.length,before);
});

test('a check that completes after leaving Radio cannot change messages on another page',async()=>{
 const f=fixture();f.answers.push(response());await f.load();let reject;f.answers.push(()=>new Promise((resolve,rejected)=>{reject=rejected;}));const pending=f.load(true);f.ids.get('myRadio').hidden=true;f.visibility();const before=f.ids.get('radioConnectStatus').textContent;reject(Error('Old failure'));await pending;assert.equal(f.ids.get('radioConnectStatus').textContent,before);assert.equal(f.ids.get('refreshRadios').hidden,true);
 f.advance(60000);f.answers.push(response({online:false}));f.ids.get('myRadio').hidden=false;f.visibility();await f.flush();assert.equal(f.views()[0].children[0].children[1].className,'radio-offline');assert.match(f.views()[0].children[0].children[1].textContent,/Check power and Wi-Fi/);assert.equal(f.ids.get('radioConnectStatus').textContent,'');
});

test('stale in-flight response after leaving and returning is discarded in favor of a fresh check',async()=>{
 const f=fixture();f.answers.push(response());await f.load();let resolve;f.answers.push(()=>new Promise(done=>{resolve=done;}));const pending=f.load(true);f.ids.get('myRadio').hidden=true;f.visibility();f.ids.get('myRadio').hidden=false;f.answers.push(response({online:false}));f.visibility();resolve(response());await pending;await f.flush();assert.equal(f.views()[0].children[0].children[1].className,'radio-offline');
});

test('silent status polling pauses while physical pairing is in progress',async()=>{
 const f=fixture();f.ids.get('connectRadioForm').button.disabled=true;await f.load(true);assert.equal(f.calls.length,0);assert.equal(f.freshness.hidden,true);
});

test('stale radio refresh does not replace an active physical pairing prompt',async()=>{
 const f=fixture();f.answers.push({radios:[]});await f.load();f.advance(60000);f.ids.get('connectRadioForm').button.disabled=true;f.ids.get('radioConnectStatus').textContent='1234 — Match this number and tap Allow on your radio.';const before=f.calls.length;f.visibility();await f.flush();assert.equal(f.calls.length,before);assert.match(f.ids.get('radioConnectStatus').textContent,/1234/);assert.equal(f.freshness.hidden,true);
});

function deferred(){let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return {promise,resolve,reject};}
async function until(check){for(let i=0;i<30&&!check();i++)await new Promise(setImmediate);assert.ok(check(),'Async checkpoint was not reached');}
test('unlink completion cannot reopen Radio or show a dialog after navigating away',async()=>{
 const f=fixture();f.answers.push(response());await f.load();const unlink=f.views()[0].children[2],pending=deferred();f.answers.push(pending.promise);const action=unlink.onclick();await until(()=>f.calls.includes('/api/phone/unlink'));
 f.ids.get('myRadio').hidden=true;f.visibility();pending.resolve({ok:true});await action;
 assert.equal(f.ids.get('myRadio').hidden,true);assert.deepEqual(f.dialogs,['Unlink radio?']);assert.equal(f.calls.filter(path=>path==='/api/phone/radios').length,1);
});
test('leaving an unlink confirmation cancels its request even if an old prompt resolves later',async()=>{
 const f=fixture();f.answers.push(response());await f.load();const confirmation=deferred();f.dialogAnswers.push(confirmation.promise);const action=f.views()[0].children[2].onclick();
 f.ids.get('myRadio').hidden=true;f.visibility();confirmation.resolve(true);await action;assert.equal(f.calls.includes('/api/phone/unlink'),false);
});
test('an in-flight unlink stays locked when polling replaces the radio card',async()=>{
 const f=fixture();f.answers.push(response());await f.load();const pending=deferred();f.answers.push(pending.promise);const first=f.views()[0].children[2].onclick();await until(()=>f.calls.includes('/api/phone/unlink'));
 f.answers.push(response({current_station:'Another station'}));await f.load(true);const replacement=f.views()[0].children[2];await replacement.onclick();assert.equal(f.calls.filter(path=>path==='/api/phone/unlink').length,1);assert.deepEqual(f.dialogs,['Unlink radio?']);assert.equal(replacement.disabled,true);
 f.answers.push({radios:[]});pending.resolve({ok:true});await first;assert.equal(f.views().length,0);assert.equal(f.ids.get('connectRadio').hidden,false);assert.deepEqual(f.dialogs,['Unlink radio?','Radio unlinked']);
});
test('detached radio card handlers cannot unlink a radio removed by a newer status check',async()=>{
 const f=fixture();f.answers.push(response());await f.load();const unlink=f.views()[0].children[2];f.answers.push({radios:[]});await f.load(true);await unlink.onclick();assert.equal(f.calls.includes('/api/phone/unlink'),false);assert.equal(f.dialogs.length,0);
});


test('initial status failures keep Connect and its Wi-Fi choice reachable without claiming a radio is offline',async()=>{
 const f=fixture();f.answers.push(Error('Service unavailable'));await f.load();
 assert.equal(f.ids.get('openWifiSetup').hidden,true);assert.equal(f.views().length,0);assert.equal(f.ids.get('connectRadio').hidden,false);assert.equal(f.ids.get('connectRadioForm').hidden,true);assert.equal(f.ids.get('refreshRadios').hidden,false);assert.doesNotMatch(f.ids.get('radioConnectStatus').textContent,/Radio offline/);f.ids.get('connectRadio').onclick();assert.equal(f.ids.get('radioConnectionChoices').hidden,false);
 f.answers.push(response());await f.load();assert.equal(f.ids.get('openWifiSetup').hidden,true);
});

test('station, online and Device Code changes update compact details without losing action focus',async()=>{
 const f=fixture();f.answers.push(response({current_station_code:'10'}));await f.load();const card=f.views()[0],code=card.children[0].children[0],unlink=card.children[2],report=card.children[3],replacements=f.ids.get('linkedRadios').replacements;unlink.focus();f.ids.get('linkedRadios').scrollTop=63;
 f.answers.push(response({device_code:'7777',current_station:'Next station',current_station_code:'11'}));await f.load(true);assert.equal(f.views()[0],card);assert.equal(card.children[0].children[0],code);assert.equal(card.children[2],unlink);assert.equal(card.children[3],report);assert.equal(f.document.activeElement,unlink);assert.equal(f.ids.get('linkedRadios').scrollTop,63);assert.equal(code.textContent,'Device code 7777');assert.equal(code.attributes['aria-pressed'],undefined);assert.match(card.children[1].textContent,/NEXT STATION/);report.onclick();assert.equal(f.reports.at(-1).code,'11');assert.equal(f.reports.at(-1).name,'Next station');
 f.answers.push(response({device_code:'7777',online:false}));await f.load(true);assert.equal(f.views()[0],card);assert.equal(f.document.activeElement,unlink);assert.equal(f.ids.get('linkedRadios').replacements,replacements);assert.equal(card.children[0].children[1].className,'radio-offline');
});

test('a single linked radio groups plain Device Code and status with the current station underneath',async()=>{
 const f=fixture();f.answers.push(response());await f.load();const card=f.views()[0],[row,current,unlink,report]=card.children,[code,status]=row.children;
 assert.equal(card.className,'linked-radio-card');assert.equal(row.className,'radio-device-row');assert.equal(code.tag,'p');assert.equal(code.className,'device-code-label');assert.equal(code.textContent,'Device code 3961');assert.equal(code.onclick,undefined);assert.equal(code.attributes.role,undefined);assert.equal(code.attributes.tabindex,undefined);assert.equal(code.attributes['aria-pressed'],undefined);assert.equal(status.textContent,'Online');assert.equal(current.className,'radio-current-station');assert.equal(current.textContent,'Current station: COMMUNITY RADIO');assert.match(unlink.className,/radio-unlink/);assert.equal(report.className,'radio-station-report');assert.equal(f.selections.length,0);
});

test('multiple linked radios retain real accessible selection buttons and compact status rows',async()=>{
 const f=fixture(),second={...radio,id:'two',device_code:'7777',online:false};f.answers.push({radios:[radio,second]});await f.load();const [one,two]=f.views(),choose=two.children[0].children[0];assert.equal(one.children[0].className,'radio-device-row');assert.equal(choose.tag,'button');assert.equal(choose.type,'button');assert.match(choose.className,/device-code-select/);assert.equal(choose.attributes['aria-pressed'],'false');assert.match(choose.attributes['aria-label'],/Device code 7777, select radio/);assert.equal(two.children[0].children[1].className,'radio-offline');
 f.answers.push({radios:[radio,second]});await choose.onclick();assert.equal(f.selections.at(-1),'two');assert.equal(choose.attributes['aria-pressed'],'true');assert.equal(one.children[0].children[0].attributes['aria-pressed'],'false');assert.equal(f.ids.get('openWifiSetup').hidden,false);
});

test('radio-count transitions rebuild the appropriate code control and retire detached selection actions',async()=>{
 const f=fixture(),second={...radio,id:'two',device_code:'7777'};f.answers.push(response());await f.load();assert.equal(f.views()[0].children[0].children[0].tag,'p');f.answers.push({radios:[radio,second]});await f.load(true);const oldOne=f.views()[0].children[0].children[0],oldTwo=f.views()[1].children[0].children[0];assert.equal(oldOne.tag,'button');f.answers.push(response());await f.load(true);assert.equal(f.views().length,1);assert.equal(f.views()[0].children[0].children[0].tag,'p');const before=f.calls.length,selections=f.selections.length;await oldOne.onclick();await oldTwo.onclick();assert.equal(f.calls.length,before);assert.equal(f.selections.length,selections);
});

test('a confirmed empty online radio gets a useful next step while unknown, offline or stale data does not',async()=>{
 const f=fixture();f.answers.push(response({current_station:null}));await f.load();const station=f.views()[0].children[1];assert.equal(station.textContent,'Current station: Not reported yet');
 f.inventories.set('one',{known:false,codes:new Set()});f.windowEvents['radio-inventory-changed']();assert.equal(station.textContent,'Current station: Not reported yet');
 f.inventories.set('one',{known:true,codes:new Set()});f.windowEvents['radio-inventory-changed']();assert.equal(station.textContent,'Choose a station below');
 f.answers.push(response({current_station:null,online:false}));await f.load(true);assert.equal(station.textContent,'Current station: Unavailable while offline');
 f.answers.push(Error('Status failed'));await f.load(true);f.windowEvents['radio-inventory-changed']();assert.equal(station.textContent,'Current station: Unavailable until status is checked');
});

test('changing the selected radio and response order updates selection without rebuilding either card',async()=>{
 const f=fixture(),second={...radio,id:'two',device_code:'7777'};f.answers.push({radios:[radio,second]});await f.load();const [one,two]=f.views(),chooseTwo=two.children[0].children[0],replacements=f.ids.get('linkedRadios').replacements;chooseTwo.focus();f.answers.push({radios:[second,radio]});chooseTwo.onclick();await f.flush();
 assert.equal(f.views()[0],one);assert.equal(f.views()[1],two);assert.equal(one.children[0].children[0].attributes['aria-pressed'],'false');assert.equal(chooseTwo.attributes['aria-pressed'],'true');assert.equal(f.document.activeElement,chooseTwo);assert.equal(f.ids.get('linkedRadios').replacements,replacements);
});

test('failed automatic status checks back off to 20, 40, 80 and at most 120 seconds',async()=>{
 const f=fixture();f.answers.push(response());await f.load();f.schedule();assert.equal(f.scheduled().delay,10000);
 for(const delay of [20000,40000,80000,120000,120000]){f.answers.push(Error('Temporary status failure'));await f.poll();assert.equal(f.scheduled().delay,delay);assert.equal(f.timers.size,1,'Only one next poll may remain scheduled');}
 assert.equal(f.calls.filter(path=>path==='/api/phone/radios').length,6);
 f.answers.push(response());await f.poll();assert.equal(f.scheduled().delay,10000,'A successful response restores the regular interval');assert.equal(f.views()[0].children[0].children[1].textContent,'Online');
});

test('an explicit status retry resets the accumulated automatic backoff',async()=>{
 const f=fixture();f.answers.push(response());await f.load();f.schedule();for(let n=0;n<4;n++){f.answers.push(Error('Temporary failure'));await f.poll();}assert.equal(f.scheduled().delay,120000);
 const retry=deferred();f.answers.push(retry.promise);const request=f.ids.get('refreshRadios').onclick();assert.equal(f.refreshDelay(),10000,'The user-requested retry starts a fresh backoff cycle');retry.resolve(response());await request;assert.equal(f.scheduled().delay,10000);
 f.answers.push(Error('Another failure'));await f.poll();assert.equal(f.scheduled().delay,20000,'A new failure begins at the first retry interval');
});

test('network recovery checks immediately and resets status polling after its successful response',async()=>{
 const f=fixture();f.answers.push(response());await f.load();f.schedule();for(let n=0;n<3;n++){f.answers.push(Error('Temporary failure'));await f.poll();}assert.equal(f.scheduled().delay,80000);
 f.navigator.onLine=false;f.windowEvents.offline();assert.equal(f.scheduled().delay,120000);const before=f.calls.length,recovered=deferred();f.answers.push(recovered.promise);f.navigator.onLine=true;f.windowEvents.online();
 assert.equal(f.calls.length,before+1,'Recovery does not wait for the old timer');assert.equal(f.refreshDelay(),10000);recovered.resolve(response());await f.flush();assert.equal(f.scheduled().delay,10000);assert.equal(f.timers.size,1);
});

test('hidden pages cancel scheduled status checks and queued callbacks cannot poll in the background',async()=>{
 for(const documentHidden of [true,false]){
  const f=fixture();f.answers.push(response());await f.load();f.schedule();const queued=f.scheduled().fn,before=f.calls.length;
  if(documentHidden){f.document.hidden=true;f.documentEvents.visibilitychange();}else{f.ids.get('myRadio').hidden=true;f.visibility();}
  assert.equal(f.timers.size,0);await queued();assert.equal(f.calls.length,before);assert.equal(f.timers.size,0,'A hidden callback cannot reschedule polling');
  f.answers.push(response());if(documentHidden){f.document.hidden=false;f.documentEvents.visibilitychange();}else{f.ids.get('myRadio').hidden=false;f.visibility();}await f.flush();assert.equal(f.calls.length,before+1);assert.equal(f.scheduled().delay,10000);
 }
});

test('offline timer callbacks and manual refreshes do not issue network requests',async()=>{
 const f=fixture();f.answers.push(response());await f.load();f.schedule();const before=f.calls.length;f.navigator.onLine=false;f.windowEvents.offline();assert.equal(f.scheduled().delay,120000);
 await f.poll();await f.ids.get('refreshRadios').onclick();assert.equal(f.calls.length,before);assert.equal(f.scheduled().delay,120000);assert.equal(f.timers.size,1);assert.match(f.ids.get('radioConnectStatus').textContent,/No internet/);
});
