import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
const source=readFileSync(new URL('./public/assets/my-radio.js',import.meta.url),'utf8');
function fixture(){
 const ids=new Map(),windowEvents={},documentEvents={},observers=[],answers=[],calls=[],dialogs=[],dialogAnswers=[],reports=[],selections=[],statusEvents=[];let clock=Date.UTC(2026,10,7,12,30),selectedRadio='one';
 function node(tag='div'){
  return {tag,children:[],hidden:false,textContent:'',className:'',attributes:{},replacements:0,disabled:false,
   setAttribute(key,value){this.attributes[key]=value;},append(...children){this.children.push(...children);},replaceChildren(...children){this.replacements++;this.children=children;},before(other){this.beforeNode=other;},focus(){},
   querySelector(selector){if(selector==='button')return this.button;return null;},reset(){}};
 }
 for(const id of ['myRadio','linkedRadios','connectRadio','connectRadioForm','cancelRadioConnection','radioConnectStatus','refreshRadios','navRadio','openWifiSetup'])ids.set(id,node());ids.get('openWifiSetup').hidden=true;ids.get('cancelRadioConnection').hidden=true;
 ids.get('connectRadioForm').button=node('button');ids.get('connectRadioForm').elements={device_code:{value:'3961',focus(){}}};
 const navigator={onLine:true},document={hidden:false,createElement:node,addEventListener(name,fn){documentEvents[name]=fn;}};
 class FakeDate extends Date{constructor(...args){super(...(args.length?args:[clock]));}static now(){return clock;}}
 const context={document,navigator,Date:FakeDate,URLSearchParams,location:{search:'',hash:'#radio'},history:{replaceState(){}},
  CustomEvent:class{constructor(type,options){this.type=type;this.detail=options?.detail;}},window:{openStationProblemReport:station=>reports.push(station),dispatchEvent(event){statusEvents.push(event);},addEventListener(name,fn){windowEvents[name]=fn;}},MutationObserver:class{constructor(fn){this.fn=fn;observers.push(this);}observe(){}},
  $:id=>ids.get(id),api:async path=>{calls.push(path);const next=answers.shift();if(next instanceof Error)throw next;if(typeof next==='function')return next();if(!next)throw Error('No fixture response');return next;},
  reconcileSelectedRadio:radios=>selectedRadio=radios[0]?.id||'',loadRadioInventory(){},readSelectedRadio(){return selectedRadio;},rememberSelectedRadio(id){selectedRadio=id;selections.push(id);},radioInventories:new Map(),listenerActionDialog:async(title)=>{dialogs.push(title);return dialogAnswers.length?await dialogAnswers.shift():true;},page(){ids.get('myRadio').hidden=false;},busy(){},human:async()=>'',delay:async()=>{},setTimeout(){return 1;},clearTimeout(){}};
 runInNewContext(source,context);
 const load=runInNewContext('loadMyRadios',context),freshness=ids.get('radioConnectStatus').beforeNode;
 return {ids,load,answers,calls,dialogs,dialogAnswers,reports,selections,statusEvents,inventories:context.radioInventories,windowEvents,documentEvents,navigator,document,freshness,views:()=>ids.get('linkedRadios').children,
  advance(ms){clock+=ms;},visibility(){observers[0].fn();},async flush(){await new Promise(resolve=>setImmediate(resolve));}};
}
const radio={id:'one',device_code:'3961',online:true,current_station:'Community Radio'};
const response=(overrides={})=>({radios:[{...radio,...overrides}]});

test('healthy radio checks hide timestamps and unchanged polls preserve card nodes without flashing',async()=>{
 const f=fixture();f.answers.push(response());await f.load();const card=f.views()[0],status=card.children[0],station=card.children[1],count=f.ids.get('linkedRadios').replacements;
 assert.equal(status.textContent,'Online');assert.equal(status.className,'radio-online');assert.equal(station.textContent,'Current station: Community Radio');assert.equal(f.freshness.textContent,'');assert.equal(f.freshness.hidden,true);assert.equal(f.ids.get('linkedRadios').attributes['aria-busy'],'false');
 f.advance(60000);f.answers.push(response());await f.load(true);assert.equal(f.views()[0],card);assert.equal(f.ids.get('linkedRadios').replacements,count);assert.equal(f.freshness.textContent,'');assert.equal(f.freshness.hidden,true);assert.equal(f.ids.get('radioConnectStatus').textContent,'');
});

test('returning to stale radio data shows a neutral update until the fresh response arrives',async()=>{
 const f=fixture();f.answers.push(response({current_station_code:'10'}));await f.load();const card=f.views()[0],status=card.children[0],station=card.children[1],report=card.children[4],events=f.statusEvents.length;
 f.ids.get('myRadio').hidden=true;f.visibility();f.advance(60000);const check=deferred();f.answers.push(check.promise);f.ids.get('myRadio').hidden=false;f.visibility();
 assert.equal(f.views()[0],card);assert.equal(status.textContent,'Updating status…');assert.equal(status.className,'radio-unknown');assert.equal(station.textContent,'Current station: Community Radio');assert.equal(report.hidden,true);assert.match(f.freshness.textContent,/^Last checked /);assert.equal(f.ids.get('radioConnectStatus').textContent,'');assert.equal(f.ids.get('refreshRadios').hidden,true);assert.equal(f.ids.get('linkedRadios').attributes['aria-busy'],'true');assert.equal(f.statusEvents.length,events);
 check.resolve(response({online:false}));await f.flush();assert.equal(f.views()[0].children[0].textContent,'Radio offline. Check power and Wi-Fi.');assert.equal(f.freshness.textContent,'');assert.equal(f.freshness.hidden,true);assert.equal(f.ids.get('refreshRadios').hidden,true);
});

test('a regular silent poll keeps healthy cards and hidden timestamps steady while in flight',async()=>{
 const f=fixture();f.answers.push(response());await f.load();const card=f.views()[0],status=card.children[0],check=deferred(),replacements=f.ids.get('linkedRadios').replacements;f.advance(10000);f.answers.push(check.promise);const pending=f.load(true);
 assert.equal(status.textContent,'Online');assert.equal(status.className,'radio-online');assert.equal(f.freshness.hidden,true);assert.equal(f.freshness.textContent,'');assert.equal(f.ids.get('refreshRadios').hidden,true);check.resolve(response());await pending;assert.equal(f.views()[0],card);assert.equal(f.ids.get('linkedRadios').replacements,replacements);assert.equal(f.freshness.hidden,true);
});

test('a refresh only reveals retry after failure and explicit retry clears old error feedback',async()=>{
 const f=fixture();f.answers.push(response());await f.load();const card=f.views()[0],check=deferred();f.advance(60000);f.answers.push(check.promise);const request=f.load(true);
 assert.equal(card.children[0].textContent,'Updating status…');assert.equal(f.ids.get('refreshRadios').hidden,true);check.reject(Error('Service unavailable'));await request;
 assert.equal(card.children[0].textContent,'Status unavailable');assert.match(f.ids.get('radioConnectStatus').textContent,/Service unavailable.*Try again/);assert.equal(f.ids.get('refreshRadios').hidden,false);
 const retry=deferred();f.answers.push(retry.promise);const retrying=f.load();assert.equal(card.children[0].textContent,'Updating status…');assert.equal(f.ids.get('radioConnectStatus').textContent,'');assert.equal(f.ids.get('refreshRadios').hidden,true);retry.resolve(response());await retrying;assert.equal(card.children[0].textContent,'Online');
});

test('an unlinked radio page does not claim a device status was checked',async()=>{
 const f=fixture();f.answers.push({radios:[]});await f.load();assert.equal(f.freshness.hidden,true);assert.equal(f.freshness.textContent,'');assert.equal(f.ids.get('connectRadioForm').hidden,false);
 f.answers.push(response());await f.load(true);assert.equal(f.freshness.hidden,true);assert.equal(f.freshness.textContent,'');
 f.answers.push({radios:[]});await f.load(true);assert.equal(f.freshness.hidden,true);assert.equal(f.freshness.textContent,'');
 f.answers.push(Error('Status unavailable'));await f.load(true);assert.equal(f.freshness.hidden,false);assert.equal(f.ids.get('refreshRadios').hidden,false);
});

test('Wi-Fi help is available before linking and for the selected offline radio',async()=>{
 const f=fixture(),help=f.ids.get('openWifiSetup');assert.equal(help.hidden,true);
 for(const [answer,visible] of [[{radios:[]},true],[response(),false],[response({online:false}),true],[response({online:false}),true],[Error('Status failed'),true],[response({online:false}),true],[response(),false],[{radios:[]},true]]){f.answers.push(answer);await f.load(true);assert.equal(!help.hidden,visible);}
 f.answers.push(response({online:false}));await f.load();assert.equal(help.hidden,false);f.navigator.onLine=false;f.windowEvents.offline();assert.equal(help.hidden,false);
});

test('an expired phone session removes stale radio actions and opens reconnect without a reload',async()=>{
 const f=fixture();f.answers.push(response({current_station_code:'10'}));await f.load();const old=f.views()[0],unlink=old.children[3],report=old.children[4];f.inventories.set('one',{known:true,codes:new Set(['10'])});
 f.answers.push(Object.assign(Error('Please reload this page.'),{status:401}));await f.load(true);
 assert.equal(f.views().length,0);assert.equal(f.ids.get('connectRadioForm').hidden,false);assert.equal(f.ids.get('connectRadio').hidden,true);assert.equal(f.ids.get('refreshRadios').hidden,true);assert.equal(f.ids.get('openWifiSetup').hidden,false);assert.equal(f.freshness.hidden,true);assert.match(f.ids.get('radioConnectStatus').textContent,/Enter the Device Code to reconnect/);assert.equal(f.selections.at(-1),'');assert.equal(f.inventories.size,0);assert.equal(f.statusEvents.at(-1).detail.radios.length,0);
 await unlink.onclick();report.onclick();assert.equal(f.dialogs.length,0);assert.equal(f.reports.length,0);assert.equal(f.calls.includes('/api/phone/unlink'),false);
 f.answers.push({radios:[]});await f.load(true);assert.equal(f.ids.get('connectRadioForm').hidden,false);assert.equal(f.ids.get('openWifiSetup').hidden,false);
});

test('a late unauthorized check cannot replace another page with the reconnect form',async()=>{
 const f=fixture();f.answers.push(response());await f.load();const check=deferred();f.answers.push(check.promise);const pending=f.load(true);f.ids.get('myRadio').hidden=true;f.visibility();check.reject(Object.assign(Error('Expired'),{status:401}));await pending;
 assert.equal(f.ids.get('connectRadioForm').hidden,true);assert.equal(f.selections.length,0);assert.equal(f.views().length,1);assert.doesNotMatch(f.ids.get('radioConnectStatus').textContent,/expired/);
});

test('another offline radio cannot show Wi-Fi help for the selected online radio',async()=>{
 const f=fixture();f.answers.push({radios:[radio,{...radio,id:'two',online:false}]});await f.load();assert.equal(f.ids.get('openWifiSetup').hidden,true);
});

test('current station reporting uses the latest radio station and stale card actions cannot report',async()=>{
 const f=fixture();f.answers.push(response({current_station_code:'10'}));await f.load();const first=f.views()[0].children[4];assert.equal(first.hidden,false);first.onclick();assert.equal(f.reports[0].code,'10');assert.equal(f.reports[0].name,'Community Radio');
 f.answers.push(response({current_station:'Next station',current_station_code:'11'}));await f.load(true);const next=f.views()[0].children[4];first.onclick();assert.equal(f.reports.length,1);next.onclick();assert.equal(f.reports[1].code,'11');
 f.answers.push(Error('Status unavailable'));await f.load(true);assert.equal(next.hidden,true);next.onclick();assert.equal(f.reports.length,2);
});

test('failed silent checks replace green Online and successful unchanged data restores it in place',async()=>{
 const f=fixture();f.answers.push(response());await f.load();const card=f.views()[0],count=f.ids.get('linkedRadios').replacements;
 f.answers.push(Error('Service temporarily unavailable.'));await f.load(true);assert.equal(card.children[0].textContent,'Status unavailable');assert.equal(card.children[0].className,'radio-unknown');assert.match(card.children[1].textContent,/Unavailable until status is checked/);assert.match(f.freshness.textContent,/^Last checked /);assert.equal(f.ids.get('refreshRadios').hidden,false);
 f.advance(60000);f.answers.push(response());await f.load(true);assert.equal(f.views()[0],card);assert.equal(f.ids.get('linkedRadios').replacements,count);assert.equal(card.children[0].className,'radio-online');assert.equal(card.children[0].textContent,'Online');assert.equal(f.ids.get('refreshRadios').hidden,true);assert.equal(f.ids.get('radioConnectStatus').textContent,'');
});

test('browser offline event immediately removes online status and labels stale station data unavailable',async()=>{
 const f=fixture();f.answers.push(response());await f.load();const status=f.views()[0].children[0],before=f.calls.length;f.navigator.onLine=false;f.windowEvents.offline();assert.equal(status.className,'radio-unknown');assert.equal(status.textContent,'Status unavailable');assert.match(f.ids.get('radioConnectStatus').textContent,/No internet/);assert.equal(f.calls.length,before);
});

test('a check that completes after leaving Radio cannot change messages on another page',async()=>{
 const f=fixture();f.answers.push(response());await f.load();let reject;f.answers.push(()=>new Promise((resolve,rejected)=>{reject=rejected;}));const pending=f.load(true);f.ids.get('myRadio').hidden=true;f.visibility();const before=f.ids.get('radioConnectStatus').textContent;reject(Error('Old failure'));await pending;assert.equal(f.ids.get('radioConnectStatus').textContent,before);assert.equal(f.ids.get('refreshRadios').hidden,true);
 f.advance(60000);f.answers.push(response({online:false}));f.ids.get('myRadio').hidden=false;f.visibility();await f.flush();assert.equal(f.views()[0].children[0].className,'radio-offline');assert.match(f.views()[0].children[0].textContent,/Check power and Wi-Fi/);assert.equal(f.ids.get('radioConnectStatus').textContent,'');
});

test('stale in-flight response after leaving and returning is discarded in favor of a fresh check',async()=>{
 const f=fixture();f.answers.push(response());await f.load();let resolve;f.answers.push(()=>new Promise(done=>{resolve=done;}));const pending=f.load(true);f.ids.get('myRadio').hidden=true;f.visibility();f.ids.get('myRadio').hidden=false;f.answers.push(response({online:false}));f.visibility();resolve(response());await pending;await f.flush();assert.equal(f.views()[0].children[0].className,'radio-offline');
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
 const f=fixture();f.answers.push(response());await f.load();const unlink=f.views()[0].children[3],pending=deferred();f.answers.push(pending.promise);const action=unlink.onclick();await until(()=>f.calls.includes('/api/phone/unlink'));
 f.ids.get('myRadio').hidden=true;f.visibility();pending.resolve({ok:true});await action;
 assert.equal(f.ids.get('myRadio').hidden,true);assert.deepEqual(f.dialogs,['Unlink radio?']);assert.equal(f.calls.filter(path=>path==='/api/phone/radios').length,1);
});
test('leaving an unlink confirmation cancels its request even if an old prompt resolves later',async()=>{
 const f=fixture();f.answers.push(response());await f.load();const confirmation=deferred();f.dialogAnswers.push(confirmation.promise);const action=f.views()[0].children[3].onclick();
 f.ids.get('myRadio').hidden=true;f.visibility();confirmation.resolve(true);await action;assert.equal(f.calls.includes('/api/phone/unlink'),false);
});
test('an in-flight unlink stays locked when polling replaces the radio card',async()=>{
 const f=fixture();f.answers.push(response());await f.load();const pending=deferred();f.answers.push(pending.promise);const first=f.views()[0].children[3].onclick();await until(()=>f.calls.includes('/api/phone/unlink'));
 f.answers.push(response({current_station:'Another station'}));await f.load(true);const replacement=f.views()[0].children[3];await replacement.onclick();assert.equal(f.calls.filter(path=>path==='/api/phone/unlink').length,1);assert.deepEqual(f.dialogs,['Unlink radio?']);assert.equal(replacement.disabled,true);
 f.answers.push({radios:[]});pending.resolve({ok:true});await first;assert.equal(f.views().length,1);assert.deepEqual(f.dialogs,['Unlink radio?','Radio unlinked']);
});
test('detached radio card handlers cannot unlink a radio removed by a newer status check',async()=>{
 const f=fixture();f.answers.push(response());await f.load();const unlink=f.views()[0].children[3];f.answers.push({radios:[]});await f.load(true);await unlink.onclick();assert.equal(f.calls.includes('/api/phone/unlink'),false);assert.equal(f.dialogs.length,0);
});


test('initial status failures keep Wi-Fi help reachable without falsely reporting an offline radio',async()=>{
 const f=fixture();f.answers.push(Error('Service unavailable'));await f.load();
 assert.equal(f.ids.get('openWifiSetup').hidden,false);assert.equal(f.views().length,0);assert.equal(f.ids.get('refreshRadios').hidden,false);assert.doesNotMatch(f.ids.get('radioConnectStatus').textContent,/Radio offline/);
 f.answers.push(response());await f.load();assert.equal(f.ids.get('openWifiSetup').hidden,true);
});
