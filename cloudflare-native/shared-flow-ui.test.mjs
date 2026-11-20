import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
import {runInNewContext} from 'node:vm';
const source=readFileSync(new URL('./public/assets/site.js',import.meta.url),'utf8');
const listener=readFileSync(new URL('./public/assets/listener-usability.js',import.meta.url),'utf8');
const radio=readFileSync(new URL('./public/assets/my-radio.js',import.meta.url),'utf8');
const navigation=readFileSync(new URL('./public/assets/app-navigation.js',import.meta.url),'utf8');
const directory=readFileSync(new URL('./public/assets/directory-news.js',import.meta.url),'utf8');
const pollingSource=radio.slice(radio.indexOf('function phoneApprovalMessage('),radio.indexOf('let radioPairingCancellation='));
const confirmationSource=listener.slice(listener.indexOf('function showRadioApproval('),listener.indexOf("$('shareForm').elements.radio_id.addEventListener"));
const sharedSource=source.slice(source.indexOf('let sharedOpenGeneration=0;'),source.indexOf('async function initializeSite()'));
const pageSource=source.slice(source.indexOf('function page('),source.indexOf('function message('));
const busySource=source.slice(source.indexOf('const formBusyStates='),source.indexOf('function loadHuman('));
function deferred(){let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return {promise,resolve,reject};}
async function until(check){for(let i=0;i<50&&!check();i++)await new Promise(setImmediate);assert.ok(check(),'Async checkpoint was not reached');}
function fixture({human=async()=> 'checked',dialog=async()=>true,useDeviceCode=false,selectedId='one',inventory=async()=>({known:true,codes:new Set()}),now=()=>Date.now(),cancelRequest=async()=>({state:'cancelled'}),validate=input=>String(input.value).replace(/[-\s]/g,'').toUpperCase()}={}){
 const ids=new Map(),calls=[],answers=[],dialogs=[],selected=[],refreshes=[],inventoryCalls=[],windowEvents=new Map(),cancellations=[],humanSignals=[],validations=[];
 function node(tag='div'){const events=new Map();return {tag,children:[],dataset:{},attributes:{},hidden:false,disabled:false,textContent:'',value:'',elements:{},setAttribute(k,v){this.attributes[k]=v;},removeAttribute(k){delete this.attributes[k];},dispatchEvent(event){for(const fn of events.get(event.type)||[])fn(event);},addEventListener(type,fn){const handlers=events.get(type)||[];handlers.push(fn);events.set(type,handlers);},querySelector(selector){const className=selector.startsWith('.')?selector.slice(1):null;for(const child of this.children){if(className&&String(child.className||'').split(/\s+/).includes(className))return child;const nested=child.querySelector?.(selector);if(nested)return nested;}return null;},querySelectorAll(selector){return selector==='button'?[this.button]:[...Object.values(this.elements),this.button];},append(...children){for(const child of children){if(child.parentElement)child.remove();child.parentElement=this;this.children.push(child);}},replaceChildren(...children){this.children=[];this.append(...children);this.textContent=children.map(child=>child.textContent||'').join('');},remove(){if(this.parentElement){this.parentElement.children=this.parentElement.children.filter(child=>child!==this);this.parentElement=null;}},focus(){},reset(){},showModal(){this.open=true;},close(){if(!this.open)return;this.open=false;this.dispatchEvent({type:'close'});}};}
 const $=id=>{if(!ids.has(id))ids.set(id,node());return ids.get(id);},form=$('shareForm');form.button=node('button');const select=node('select');select.value='one';select.children=[{value:'one',textContent:'Device code 3961 · Online'}];Object.defineProperties(select,{options:{get(){return this.children;}},selectedOptions:{get(){return this.children.filter(option=>option.value===this.value);}}});form.elements.radio_id=select;form.elements.device_code=Object.assign(node('input'),{value:'3961'});$('deviceLabel').hidden=!useDeviceCode;$('radioLabel').hidden=useDeviceCode;$('shared').hidden=false;$('shareName').textContent='First station';$('stationPopupClose').textContent='Close';$('stationAddPopup').querySelector=selector=>selector==='.station-popup-close'?$('stationPopupClose'):null;
 const ctx={AbortController,crypto:{randomUUID},window:{validateDeviceCodeInput(input){validations.push({value:input.value,disabled:input.disabled});return validate(input);},addEventListener(name,fn){const handlers=windowEvents.get(name)||[];handlers.push(fn);windowEvents.set(name,handlers);},dispatchEvent(event){for(const handler of windowEvents.get(event.type)||[])handler(event);}},document:{createElement:node,hidden:false},navigator:{onLine:true},$: $,Event:class{constructor(type){this.type=type;}},Promise,Date:class extends Date{static now(){return now();}},queueMicrotask,setTimeout(fn,ms){if(ms!==8000)queueMicrotask(fn);},api:async(path,body)=>{calls.push({path,body});if(path==='/api/phone/claim/cancel'){cancellations.push(body);return await cancelRequest(body);}if(!answers.length)throw Error('No fixture response');const result=answers.shift();if(result instanceof Error)throw result;return await result;},human:(...args)=>{humanSignals.push(args[2]);return human(...args);},listenerActionDialog:async(...args)=>{dialogs.push(args);return await dialog(...args);},reconcileSelectedRadio:radios=>radios.length===1?String(radios[0].id):radios.some(r=>String(r.id)===selectedId)?selectedId:'',rememberSelectedRadio:id=>{selected.push(id);selectedId=String(id);},readSelectedRadio:()=>selectedId,loadRadioInventory:async id=>{inventoryCalls.push(id);return inventory(id);},loadMyRadios:async()=>{},refreshRadioInventory:id=>refreshes.push(id)};
 runInNewContext('let sharedCode="10",shareRunning=false,sitePageGeneration=0,verificationId=null;function invalidateOwnerVerification(){throw Error(\"Owner verification is outside this shared-flow fixture\");}',ctx);runInNewContext(busySource,ctx);runInNewContext(pageSource,ctx);runInNewContext(pollingSource,ctx);runInNewContext(sharedSource,ctx);runInNewContext(confirmationSource,ctx);
 return {ctx,ids,form,calls,answers,dialogs,selected,refreshes,inventoryCalls,cancellations,humanSignals,validations,status(radios){ctx.window.dispatchEvent({type:'radio-status-updated',detail:{radios}});},id:$,get:expression=>runInNewContext(expression,ctx),open:runInNewContext('openShared',ctx),page:runInNewContext('page',ctx),submit:()=>form.onsubmit({preventDefault(){},target:form}),cancel(){runInNewContext('stopWaitingForSharedStation()',ctx);$('shared').hidden=true;},next(code='11'){runInNewContext('sharedCode='+JSON.stringify(code),ctx);$('shared').hidden=false;form.hidden=false;}};
}

function installStationConnectionFlow(f){
 const {ctx}=f,navigationCalls=[],historyCalls=[];let choices=0;
 ctx.document.body=ctx.document.createElement('body');ctx.document.querySelector=selector=>selector==='dialog[open]'?ctx.document.body.children.find(child=>child.open)||null:null;
 ctx.location={origin:'https://radiolocals.com',href:'https://radiolocals.com/#radio',pathname:'/',hash:'#radio',search:''};
 ctx.history={state:{radioLocalsApp:{page:'myRadio'}},back(){historyCalls.push('back');this.state={radioLocalsApp:{page:'myRadio'}};},pushState(state){historyCalls.push('push');this.state=state;},replaceState(state){historyCalls.push('replace');this.state=state;}};
 ctx.appRestoring=false;ctx.appCurrentPage='myRadio';ctx.appPanelOrigin=null;ctx.appRememberPosition=()=>{};ctx.appRestorePosition=()=>{};ctx.appClearGuidedRadioWifi=()=>{};
 ctx.appHistoryValue=(page='myRadio',panel=null,code=null)=>({page,panel,code});ctx.appReplaceHistory=value=>{ctx.history.state={radioLocalsApp:value};};
 ctx.appShowPage=(page,options={})=>{navigationCalls.push({page,options});ctx.appCurrentPage=page;ctx.history.state={radioLocalsApp:{page}};f.page(page);};
 ctx.window.showRadioConnectionChoices=()=>{choices++;};f.id('shared').append(f.id('shareMoreActions'));f.id('shareMoreActions').append(f.id('shareAddAgain'),f.id('shareAdvertise'),f.id('reportStationProblem'));
 runInNewContext(directory.slice(directory.indexOf('function shareButton('),directory.indexOf('let stationListSnapshot=')),ctx);
 runInNewContext(directory.slice(directory.indexOf('const stationPopup=document.createElement')),ctx);
 f.ids.set('stationAddPopup',f.get('stationPopup'));f.ids.set('stationPopupClose',f.get('stationPopupClose'));
 runInNewContext(navigation.slice(navigation.indexOf('window.openStationConnectionFlow=function'),navigation.indexOf("$('shareWifiHelp').onclick=")),ctx);
 runInNewContext(navigation.slice(navigation.indexOf('const appOriginalOpenStation=openStationPopup;'),navigation.indexOf('stationPopupClose.onclick=')),ctx);
 runInNewContext(navigation.slice(navigation.indexOf("stationPopup.addEventListener('close',()=>{"),navigation.indexOf("window.addEventListener('radio-controls-opened'")),ctx);
 const main=f.id('connectRadioForm');main.button=ctx.document.createElement('button');main.elements.device_code=Object.assign(ctx.document.createElement('input'),{value:'3961'});main.reset=()=>{main.elements.device_code.value='';};
 runInNewContext('let radioPairingBusy=false,radioPairingGeneration=0,radioPairingAttempt=null,radioViewGeneration=0,radioSessionExpired=false,radioConnectionStep="idle",radioPairingCancellation=Promise.resolve(),deferredStationConnection=null,radioLoading=false;',ctx);
 runInNewContext(radio.slice(radio.indexOf('function cancelRadioPairingRequest('),radio.indexOf('function cancelRadioPairing(showStatus=')),ctx);
 runInNewContext(radio.slice(radio.indexOf('function currentRadioPairing('),radio.indexOf('async function resumeDeferredStationConnection(')),ctx);
 runInNewContext(radio.slice(radio.indexOf('async function resumeDeferredStationConnection('),radio.indexOf('async function unlinkMyRadio(')),ctx);
 runInNewContext(radio.slice(radio.indexOf("$('connectRadioForm').onsubmit="),radio.indexOf("window.addEventListener('radio-locals-ready'")),ctx);
 return {navigationCalls,historyCalls,choices:()=>choices,popup:()=>f.get('stationPopup'),open:(code,options)=>f.get('openStationPopup')(code,options),submitMain:()=>main.onsubmit({preventDefault(){},target:main})};
}

test('the common connection flow retains the chosen station and adds exactly once after physical approval and acknowledgment',async()=>{
 const approval=deferred(),ack=deferred(),f=fixture({selectedId:''}),flow=installStationConnectionFlow(f);
 f.answers.push({name:'Chosen station',listener_code:'23'},{radios:[]});await flow.open('23',{autoAdd:true});
 assert.equal(flow.popup().open,true);assert.equal(f.form.hidden,true);assert.equal(f.id('deviceLabel').hidden,true);assert.equal(f.id('shareConnectRadio').hidden,false);assert.equal(f.calls.length,2);assert.equal(f.humanSignals.length,0);
 assert.equal(f.id('shareConnectRadio').onclick(),true);assert.equal(flow.popup().open,false);assert.equal(f.id('myRadio').hidden,false);assert.equal(flow.choices(),1);assert.equal(f.get('pendingStationConnection.code'),'23');assert.equal(flow.navigationCalls.at(-1).options.replace,true);
 f.answers.push({claim_id:'claim',confirmation_code:'5831'},approval.promise);const connecting=flow.submitMain();await until(()=>f.calls.some(call=>call.path==='/api/phone/claim/status'));
 assert.equal(f.calls.some(call=>call.path==='/api/phone/add'),false);assert.equal(f.id('radioConnectStatus').textContent.includes('5831'),true);
 f.answers.push({name:'Chosen station',listener_code:'23'},{radios:[{id:'new-radio',device_code:'3961',online:true}]},{command_id:'one-add'},ack.promise);approval.resolve({state:'approved',radio_id:'new-radio'});
 await until(()=>f.calls.some(call=>call.path==='/api/phone/command/status'));const adds=f.calls.filter(call=>call.path==='/api/phone/add');assert.equal(adds.length,1);assert.equal(adds[0].body.station_code,'23');assert.equal(adds[0].body.radio_id,'new-radio');assert.equal(flow.popup().open,true);assert.equal(f.dialogs.length,0);
 ack.resolve({state:'added'});await connecting;assert.equal(flow.popup().open,false);assert.equal(f.get('pendingStationConnection'),null);assert.equal(f.dialogs.length,0);assert.equal(f.id('stationDeliveryStatus').dataset.status,'success');assert.deepEqual(f.refreshes,['new-radio']);
 const previous=f.calls.length;assert.equal(await f.ctx.window.resumePendingStationConnection('new-radio'),false);assert.equal(f.calls.length,previous);assert.equal(f.calls.filter(call=>call.path==='/api/phone/claim').length,1);assert.doesNotMatch(JSON.stringify(f.ctx.history.state),/3961/);
});

test('choosing another radio while inventory is loading invalidates the original auto-add before the common setup opens',async()=>{
 const inventory=deferred(),f=fixture({inventory:()=>inventory.promise}),flow=installStationConnectionFlow(f);
 f.answers.push({name:'Chosen station',listener_code:'10'},{radios:[{id:'one',device_code:'1111',online:true}]});const opening=flow.open('10',{autoAdd:true});await until(()=>f.inventoryCalls.length===1);
 assert.equal(f.id('otherRadio').hidden,false);assert.equal(f.id('otherRadio').onclick(),true);assert.equal(flow.popup().open,false);assert.equal(f.id('myRadio').hidden,false);assert.equal(f.get('pendingStationConnection.code'),'10');assert.equal(flow.choices(),1);
 inventory.resolve({known:true,codes:new Set()});await opening;assert.equal(f.calls.length,2);assert.equal(f.calls.some(call=>call.path==='/api/phone/add'),false);
 f.answers.push({claim_id:'claim',confirmation_code:'5831'},{state:'approved',radio_id:'two'},{name:'Chosen station',listener_code:'10'},{radios:[{id:'one',online:true},{id:'two',device_code:'3961',online:true}]},{command_id:'new-destination'},{state:'added'});await flow.submitMain();
 const adds=f.calls.filter(call=>call.path==='/api/phone/add');assert.equal(adds.length,1);assert.equal(adds[0].body.radio_id,'two');assert.equal(adds[0].body.station_code,'10');
});

test('a newly approved radio disappearing before the station lookup cannot redirect immediate addition to an older radio',async()=>{
 const oldRadio={id:'old-radio',device_code:'1111',online:true},f=fixture({selectedId:'old-radio'}),flow=installStationConnectionFlow(f);
 f.answers.push({name:'Chosen station',listener_code:'10'},{radios:[oldRadio]});await flow.open('10');f.id('otherRadio').onclick();
 f.answers.push({claim_id:'claim',confirmation_code:'5831'},{state:'approved',radio_id:'new-radio'},{name:'Chosen station',listener_code:'10'},{radios:[oldRadio]});await flow.submitMain();
 assert.equal(f.calls.filter(call=>call.path==='/api/phone/add').length,0);assert.equal(f.form.hidden,true);assert.equal(f.form.elements.radio_id.value,'');assert.equal(f.id('shareConnectRadio').hidden,false);assert.equal(f.id('shareStatus').dataset.status,'error');assert.match(f.id('shareStatus').textContent,/no longer connected/);assert.equal(flow.popup().open,true);
 assert.equal(f.get('pendingStationConnection'),null);const requests=f.calls.length;assert.equal(await f.ctx.window.resumePendingStationConnection('new-radio'),false);assert.equal(f.calls.length,requests);
});

test('a guarded background continuation cannot redirect to another radio if the approved radio disappears during the final lookup',async()=>{
 const oldRadio={id:'old-radio',device_code:'1111',online:true},approval=deferred(),f=fixture({selectedId:'old-radio'}),flow=installStationConnectionFlow(f);
 f.answers.push({name:'Chosen station',listener_code:'10'},{radios:[oldRadio]});await flow.open('10');f.id('otherRadio').onclick();
 f.answers.push({claim_id:'claim',confirmation_code:'5831'},approval.promise);const pairing=flow.submitMain();await until(()=>f.calls.some(call=>call.path==='/api/phone/claim/status'));f.ctx.document.hidden=true;approval.resolve({state:'approved',radio_id:'new-radio'});await pairing;
 assert.equal(f.get('deferredStationConnection.radioId'),'new-radio');assert.equal(f.get('pendingStationConnection.code'),'10');assert.equal(f.calls.some(call=>call.path==='/api/phone/add'),false);
 // The Radio loader's fresh-link gate is covered in guided-radio-connection.
 // Even after that gate confirms the approved ID, openShared performs its own
 // current lookup and must not substitute another link if the ID disappears.
 f.ctx.document.hidden=false;f.answers.push({name:'Chosen station',listener_code:'10'},{radios:[oldRadio]});await f.get('resumeDeferredStationConnection(deferredStationConnection)');
 assert.equal(f.calls.filter(call=>call.path==='/api/phone/add').length,0);assert.equal(f.form.hidden,true);assert.equal(f.form.elements.radio_id.value,'');assert.equal(f.id('shareConnectRadio').hidden,false);assert.match(f.id('shareStatus').textContent,/no longer connected/);assert.equal(f.get('deferredStationConnection'),null);assert.equal(f.get('pendingStationConnection'),null);
});

test('continuation pins the newly approved radio even when the default chooser would select an older radio',async()=>{
 const oldRadio={id:'old-radio',device_code:'1111',online:true},newRadio={id:'new-radio',device_code:'3961',online:true},f=fixture({selectedId:'old-radio'}),flow=installStationConnectionFlow(f);let reconciliations=0;
 f.ctx.reconcileSelectedRadio=()=>{reconciliations++;return 'old-radio';};
 f.answers.push({name:'Chosen station',listener_code:'10'},{radios:[oldRadio]});await flow.open('10');f.id('otherRadio').onclick();const before=reconciliations;
 f.answers.push({claim_id:'claim',confirmation_code:'5831'},{state:'approved',radio_id:'new-radio'},{name:'Chosen station',listener_code:'10'},{radios:[oldRadio,newRadio]},{command_id:'pinned-add'},{state:'added'});await flow.submitMain();
 const adds=f.calls.filter(call=>call.path==='/api/phone/add');assert.equal(adds.length,1);assert.equal(adds[0].body.radio_id,'new-radio');assert.equal(adds[0].body.station_code,'10');assert.equal(reconciliations,before);assert.deepEqual(f.refreshes,['new-radio']);assert.equal(flow.popup().open,false);
});

test('cancelled, unrelated-page, expired and offline connection intent cannot replay an automatic addition',async()=>{
 for(const reason of ['cancel','navigation','expired','offline']){
  let clock=1000;const f=fixture({now:()=>clock,selectedId:''}),flow=installStationConnectionFlow(f);f.answers.push({name:'Chosen station',listener_code:'10'},{radios:[]});await flow.open('10',{autoAdd:true});f.id('shareConnectRadio').onclick();
  if(reason==='cancel')f.ctx.window.cancelPendingStationConnection();if(reason==='navigation')f.page('support');if(reason==='expired')clock+=900001;if(reason==='offline')f.ctx.navigator.onLine=false;
  const requests=f.calls.length;assert.equal(await f.ctx.window.resumePendingStationConnection('new-radio'),false,reason);assert.equal(f.calls.length,requests,reason);assert.equal(f.get('pendingStationConnection'),null,reason);
  f.ctx.navigator.onLine=true;f.page('myRadio');assert.equal(await f.ctx.window.resumePendingStationConnection('new-radio'),false,reason);assert.equal(f.calls.length,requests,reason);assert.equal(f.calls.some(call=>call.path==='/api/phone/add'),false,reason);
 }
});

test('a denied common-flow approval retains the selected station for retry without adding or opening success',async()=>{
 const f=fixture({selectedId:''}),flow=installStationConnectionFlow(f);f.answers.push({name:'Chosen station',listener_code:'10'},{radios:[]});await flow.open('10',{autoAdd:true});f.id('shareConnectRadio').onclick();
 f.answers.push({claim_id:'claim',confirmation_code:'5831'},{state:'denied'});await flow.submitMain();assert.equal(f.calls.some(call=>call.path==='/api/phone/add'),false);assert.equal(f.get('pendingStationConnection.code'),'10');assert.equal(flow.popup().open,false);assert.equal(f.dialogs.length,0);assert.match(f.id('radioConnectStatus').textContent,/not approved/);
});

test('saved-station recovery and sharing are secondary actions inside a collapsed More section',async()=>{
 const f=fixture({inventory:async()=>({known:true,codes:new Set(['10'])})}),flow=installStationConnectionFlow(f);f.answers.push({name:'Saved station',listener_code:'10'},{radios:[{id:'one',online:true}]});await flow.open('10',{autoAdd:true});
 assert.equal(f.id('shareSavedNotice').hidden,false);assert.equal(f.id('shareSubmit').hidden,true);assert.equal(f.id('shareAddAgain').hidden,false);assert.equal(f.id('shareMoreActions').open,false);assert.equal(f.id('shareAddAgain').parentElement,f.id('shareMoreActions'));
 const share=flow.popup().querySelector('.station-popup-share');assert.ok(share);assert.equal(share.parentElement,f.id('shareMoreActions'));assert.equal(f.calls.some(call=>call.path==='/api/phone/add'),false);
 f.id('shareMoreActions').open=true;f.answers.push({command_id:'explicit-recovery'},{state:'added'});await f.id('shareAddAgain').onclick();assert.equal(f.calls.filter(call=>call.path==='/api/phone/add').length,1);assert.equal(flow.popup().open,false);assert.equal(f.dialogs.length,0);
});

test('an unlisted station can be managed from its own fresh inventory but cannot be re-added or advertised',async()=>{
 for(const cached of [null,{name:'Previously saved station'}]){
  const inventory={known:true,codes:new Set(['10'])},updates=[],f=fixture({inventory:async()=>inventory});f.ctx.readRadioInventory=id=>id==='one'?inventory:null;f.ctx.getSavedStationMetadata=()=>cached;f.ctx.window.updateStationManagement=saved=>updates.push(saved);
  f.answers.push(Object.assign(Error('Station not found'),{status:404}),{radios:[{id:'one',online:true}]});await f.open('10',true,true);
  assert.equal(f.id('shareName').textContent,cached?.name||'Station 10');assert.equal(f.form.dataset.unlisted,'1');assert.equal(f.id('shareSavedNotice').hidden,false);assert.equal(f.id('shareSubmit').hidden,true);assert.equal(f.id('shareAddAgain').hidden,true);assert.equal(f.id('shareAdvertise').hidden,true);assert.ok(updates.includes(true));
  const requests=f.calls.length;await f.submit();await f.id('shareAddAgain').onclick();assert.equal(f.calls.length,requests);assert.equal(f.calls.some(call=>call.path==='/api/phone/add'),false);
 }
});

test('a missing station cannot borrow unknown, stale or another radio inventory for fallback management',async()=>{
 for(const inventory of [null,{known:false,codes:new Set(['10'])},{known:true,stale:true,codes:new Set(['10'])},{known:true,codes:new Set(['11'])}]){
  const f=fixture();f.ctx.readRadioInventory=()=>inventory;f.answers.push(Object.assign(Error('Station not found'),{status:404}));await assert.rejects(f.open('10',true,true),/Station not found/);assert.equal(f.calls.length,1);assert.equal(f.id('shareAdvertise').hidden,true);assert.equal(f.calls.some(call=>call.path==='/api/phone/add'),false);
 }
 const f=fixture();f.ctx.readRadioInventory=id=>id==='other'?{known:true,codes:new Set(['10'])}:null;f.answers.push(Object.assign(Error('Station not found'),{status:404}));await assert.rejects(f.open('10',true,true),/Station not found/);assert.equal(f.calls.length,1);
});

test('advertising uses the loaded public station and stays available without a linked radio',async()=>{const f=fixture();f.answers.push({name:'First station',listener_code:'13'},new Error('Radio status unavailable'));await assert.rejects(f.open('13',true),/Radio status unavailable/);const link=f.id('shareAdvertise');assert.equal(link.hidden,false);assert.equal(link.attributes.href,'/advertise/13');assert.deepEqual(f.calls.map(call=>call.path),['/api/stations/13','/api/phone/radios']);let prevented=false;link.onclick({preventDefault(){prevented=true;}});assert.equal(prevented,false);const next=deferred();f.answers.push(next.promise,{radios:[]});const loading=f.open('14',true);assert.equal(link.hidden,true);assert.equal(link.attributes.href,undefined);next.resolve({name:'Second station',listener_code:'14'});await loading;assert.equal(link.attributes.href,'/advertise/14');assert.equal(link.hidden,false);});
test('failed or malformed station metadata cannot leave an advertising link to the previous station',async()=>{const f=fixture();f.get("setSharedAdvertising({listener_code:'13'})");assert.equal(f.id('shareAdvertise').hidden,false);f.answers.push(new Error('Station unavailable'));await assert.rejects(f.open('14',true),/Station unavailable/);assert.equal(f.id('shareAdvertise').hidden,true);assert.equal(f.id('shareAdvertise').attributes.href,undefined);for(const code of ['https://bad.example','13/other','01','1','1234567']){f.get('setSharedAdvertising('+JSON.stringify({listener_code:code})+')');assert.equal(f.id('shareAdvertise').hidden,true);assert.equal(f.id('shareAdvertise').attributes.href,undefined);}});
test('advertising cannot abandon an active station request or pairing flow',()=>{const f=fixture();f.get("setSharedAdvertising({listener_code:'13'})");const link=f.id('shareAdvertise'),click=()=>{let prevented=false;link.onclick({preventDefault(){prevented=true;}});return prevented;};assert.equal(click(),false);f.get('shareRunning=true');assert.equal(click(),true);f.get('shareRunning=false');f.id('shared').dataset.adding='1';assert.equal(click(),true);delete f.id('shared').dataset.adding;f.id('shared').hidden=true;assert.equal(click(),true);});
test('station rendering is read-only and only a tile tap passes automatic add intent',()=>{
 const directory=readFileSync(new URL('./public/assets/directory-news.js',import.meta.url),'utf8'),calls=[];
 function node(){return {children:[],setAttribute(){},removeAttribute(){},append(...items){this.children.push(...items);},replaceChildren(){this.children=[];}};}
 const context={document:{createElement:node},openStationPopup:(...args)=>calls.push(args)},render=runInNewContext(directory.slice(directory.indexOf('function renderStationSlider('),directory.indexOf('list=function()'))+';renderStationSlider;',context),track=node();
 render(track,[{name:'First station',listener_code:'10'}],'No stations');assert.equal(calls.length,0);track.children[0].children[0].onclick();assert.equal(calls.length,1);assert.equal(calls[0][0],'10');assert.equal(calls[0][1].autoAdd,true);
});
test('a direct shared-link response cannot reopen Shared after the user selects another page',async()=>{
 const f=fixture(),pending=deferred();f.answers.push(pending.promise);const opening=f.open('10');f.page('myRadio');pending.resolve({name:'Old station',listener_code:'10'});await opening;assert.equal(f.id('shared').hidden,true);assert.equal(f.id('myRadio').hidden,false);assert.equal(f.id('shareName').textContent,'First station');assert.equal(f.calls.length,1);
});
test('an abandoned shared-link error is ignored instead of reaching another page',async()=>{
 for(const stage of ['station','radios']){const f=fixture(),pending=deferred();if(stage==='radios')f.answers.push({name:'First station',listener_code:'10'});f.answers.push(pending.promise);const opening=f.open('10');await until(()=>f.calls.length===(stage==='station'?1:2));f.page('myRadio');pending.reject(Error('Old shared-link error'));await opening;assert.equal(f.id('myRadio').hidden,false);assert.equal(f.id('message').textContent,'');}
});

test('public station metadata becomes available once before a private radio status failure without adding extra requests',async()=>{
 const f=fixture(),loaded=[];f.answers.push({name:'Public station',listener_code:'10'},Error('Radio status unavailable'));await assert.rejects(f.open('10',true,false,station=>loaded.push(station)),/Radio status unavailable/);assert.equal(loaded.length,1);assert.equal(loaded[0].name,'Public station');assert.deepEqual(f.calls.map(call=>call.path),['/api/stations/10','/api/phone/radios']);assert.equal(f.calls.some(call=>call.path==='/api/phone/add'),false);
});

test('failed or abandoned public metadata never invokes a popup metadata callback',async()=>{
 const failed=fixture(),callbacks=[];failed.answers.push(Error('Station not found'));await assert.rejects(failed.open('10',true,false,station=>callbacks.push(station)),/Station not found/);assert.equal(callbacks.length,0);
 const f=fixture(),pending=deferred();f.answers.push(pending.promise);const opening=f.open('10',true,false,station=>callbacks.push(station));f.page('myRadio');pending.resolve({name:'Old public station',listener_code:'10'});await opening;assert.equal(callbacks.length,0);assert.equal(f.calls.length,1);
});
test('cancelling while a shared-link bot check runs prevents a new pairing request',async()=>{
 const bot=deferred(),f=fixture({human:()=>bot.promise,useDeviceCode:true});const adding=f.submit();f.cancel();bot.resolve('checked');await adding;assert.equal(f.calls.length,0);assert.equal(f.get('shareRunning'),false);assert.equal(f.form.button.disabled,false);assert.equal(f.dialogs.length,0);
});
test('cancelling a shared pairing stops polling and never adds after a late approval',async()=>{
 const pending=deferred(),f=fixture({useDeviceCode:true});f.answers.push({claim_id:'claim',confirmation_code:'5831'},pending.promise);const adding=f.submit();await until(()=>f.calls.length===2);f.cancel();pending.resolve({state:'approved',radio_id:'one'});await adding;
 assert.equal(f.calls.filter(call=>call.path==='/api/phone/add').length,0);assert.equal(f.calls.filter(call=>call.path==='/api/phone/claim/status').length,1);assert.equal(f.selected.length,0);assert.equal(f.dialogs.length,0);assert.equal(f.get('shareRunning'),false);
});
test('closing a tapped station while its linked radios load cannot send an add command',async()=>{
 const radios=deferred(),f=fixture();f.answers.push({name:'First station',listener_code:'10'},radios.promise);const opening=f.open('10',true,true);await until(()=>f.calls.length===2);f.cancel();radios.resolve({radios:[{id:'one',device_code:'3961',online:true}]});await opening;assert.equal(f.calls.length,2);assert.equal(f.get('shareRunning'),false);
});
test('closing after dispatch keeps delivery running and refreshes inventory only after its acknowledgment',async()=>{
 const acknowledgment=deferred(),f=fixture();f.answers.push({command_id:'command'},acknowledgment.promise);const adding=f.submit();await until(()=>f.calls.length===2);assert.equal(f.id('stationPopupClose').textContent,'Stop waiting');f.cancel();assert.equal(f.refreshes.length,0);assert.match(f.id('stationDeliveryStatus').textContent,/Adding station/);assert.equal(f.id('stationDeliveryStatus').dataset.status,'progress');acknowledgment.resolve({state:'added'});await adding;assert.deepEqual(f.refreshes,['one']);assert.equal(f.dialogs.length,0);assert.equal(f.id('stationDeliveryStatus').textContent,'First station — ✓ Station added');assert.equal(f.id('stationDeliveryStatus').dataset.status,'success');assert.equal(f.id('shareStatus').textContent,'');assert.equal(f.id('stationPopupClose').textContent,'Close');assert.equal(f.get('shareRunning'),false);
});

test('a station tap adds to the selected radio without extra prompts and waits for its acknowledgment',async()=>{
 const ack=deferred(),f=fixture();f.answers.push({name:'First station',listener_code:'10'},{radios:[{id:'one',device_code:'3961',online:true}]},{command_id:'command'},ack.promise);
 const opening=f.open('10',true,true);await until(()=>f.calls.length===4);assert.equal(f.dialogs.length,0);assert.equal(f.id('shared').dataset.adding,'1');assert.equal(f.calls[2].path,'/api/phone/add');assert.equal(f.calls[2].body.radio_id,'one');assert.equal(f.calls[2].body.station_code,'10');
 ack.resolve({state:'added'});await opening;assert.equal(f.dialogs.length,0);assert.equal(f.id('shareStatus').textContent,'✓ Station added');assert.deepEqual(f.refreshes,['one']);assert.equal(f.id('shared').dataset.adding,undefined);assert.equal(f.form.hidden,true);
});

test('opening a shared URL or a restored station panel never adds automatically',async()=>{
 for(const inPopup of [false,true]){const f=fixture();f.answers.push({name:'First station',listener_code:'10'},{radios:[{id:'one',online:true}]});await f.open('10',inPopup);assert.equal(f.calls.length,2);assert.equal(f.dialogs.length,0);assert.equal(f.form.hidden,false);}
});

test('fast shared-link startup waits for deferred helpers and still requires one explicit add',async()=>{
 const f=fixture(),startupSource=source.slice(source.indexOf('async function initializeSite()'),source.indexOf('void initializeSite();')),reconcile=f.ctx.reconcileSelectedRadio;let domReady;
 f.ctx.ownerSessionGeneration=0;f.ctx.document.readyState='interactive';f.ctx.document.addEventListener=(type,handler)=>{if(type==='DOMContentLoaded')domReady=handler;};f.ctx.window={dispatchEvent(){}};f.ctx.location={pathname:'/station/10',hash:''};f.ctx.refreshStationDirectory=()=>Promise.resolve([]);f.ctx.loadOwnerSession=async()=>{f.ctx.state={owner_station:null};return f.ctx.state;};f.ctx.initCommunity=async()=>{};f.ctx.reconcileSelectedRadio=undefined;
 runInNewContext(startupSource,f.ctx);f.answers.push({name:'First station',listener_code:'10'},{radios:[{id:'one',online:true}]});const startup=runInNewContext('initializeSite()',f.ctx);await new Promise(setImmediate);assert.equal(f.id('shared').hidden,false);assert.equal(f.form.hidden,true);assert.equal(f.id('shareName').textContent,'Loading station…');assert.equal(f.calls.length,0);
 f.ctx.reconcileSelectedRadio=reconcile;domReady(new Event('DOMContentLoaded'));await startup;assert.equal(f.calls.length,2);assert.equal(f.form.hidden,false);assert.equal(f.dialogs.length,0);assert.equal(f.calls.some(call=>call.path==='/api/phone/add'),false);
 f.answers.push({command_id:'one-command'},{state:'added'});await f.submit();assert.equal(f.calls.filter(call=>call.path==='/api/phone/add').length,1);assert.equal(f.dialogs.length,0);assert.equal(f.id('shareStatus').dataset.status,'success');
});

test('a first-time station addition waits for physical approval then adds without another confirmation',async()=>{
 const approval=deferred(),f=fixture({useDeviceCode:true});f.answers.push({claim_id:'claim',confirmation_code:'5831'},approval.promise,{command_id:'command'},{state:'added'});const adding=f.submit();await until(()=>f.calls.length===2);assert.equal(f.calls.some(c=>c.path==='/api/phone/add'),false);assert.match(f.id('shareStatus').textContent,/5831/);approval.resolve({state:'approved',radio_id:'new-radio'});await adding;
 assert.equal(f.dialogs.length,0);assert.equal(f.calls.find(c=>c.path==='/api/phone/add').body.radio_id,'new-radio');assert.equal(f.id('shareStatus').dataset.status,'success');
});

test('a rejected radio approval never sends a station or shows Done',async()=>{
 const f=fixture({useDeviceCode:true});f.answers.push({claim_id:'claim',confirmation_code:'5831'},{state:'denied'});await f.submit();assert.equal(f.calls.some(c=>c.path==='/api/phone/add'),false);assert.equal(f.dialogs.length,0);assert.match(f.id('shareStatus').textContent,/not approved/i);
});

test('shared addition resumes the existing approval poll after brief network loss without repeating its claim',async()=>{
 const f=fixture({useDeviceCode:true});f.answers.push({claim_id:'claim',confirmation_code:'5831'},Error('Network unavailable'),{state:'waiting'},{state:'approved',radio_id:'one'},{command_id:'command'},{state:'added'});await f.submit();
 assert.equal(f.calls.filter(c=>c.path==='/api/phone/claim').length,1);assert.equal(f.calls.filter(c=>c.path==='/api/phone/claim/status').length,3);assert.ok(f.calls.filter(c=>c.path==='/api/phone/claim/status').every(c=>c.body.claim_id==='claim'));assert.equal(f.calls.filter(c=>c.path==='/api/phone/add').length,1);assert.equal(f.dialogs.length,0);
});

test('rapid repeated submits create only one add request',async()=>{
 const pending=deferred(),f=fixture();f.answers.push(pending.promise,{state:'added'});const first=f.submit();await f.submit();await f.submit();assert.equal(f.calls.length,1);pending.resolve({command_id:'command'});await first;assert.equal(f.calls.filter(c=>c.path==='/api/phone/add').length,1);assert.equal(f.dialogs.length,0);assert.equal(f.id('stationDeliveryStatus').dataset.status,'success');
});

test('an offline tapped radio waits for a successful online retry before sending a station',async()=>{
 const offline={radios:[{id:'one',online:false}]},f=fixture();f.answers.push({name:'First station',listener_code:'10'},offline);await f.open('10',true,true);assert.equal(f.calls.length,2);assert.match(f.id('shareStatus').textContent,/offline/i);assert.equal(f.form.hidden,false);
 f.answers.push(offline);await f.submit();assert.equal(f.calls.some(c=>c.path==='/api/phone/add'),false);assert.equal(f.dialogs.length,0);
 f.answers.push({radios:[{id:'one',online:true}]},{command_id:'command'},{state:'added'});await f.submit();assert.equal(f.calls.filter(c=>c.path==='/api/phone/add').length,1);assert.equal(f.dialogs.length,0);assert.equal(f.id('stationDeliveryStatus').dataset.status,'success');
});

test('unlinked phones and multiple radios without a selection still need a destination',async()=>{
 for(const radios of [[],[{id:'one',online:true},{id:'two',online:true}]]){const f=fixture({selectedId:''});f.answers.push({name:'First station',listener_code:'10'},{radios});await f.open('10',true,true);assert.equal(f.calls.length,2);assert.equal(f.dialogs.length,0);assert.equal(f.form.hidden,!radios.length);assert.equal(f.id('deviceLabel').hidden,true);assert.equal(f.id('shareConnectRadio').hidden,radios.length>0);assert.equal(f.calls.some(call=>call.path==='/api/phone/add'||call.path==='/api/phone/claim'),false);}
});

test('a failed device acknowledgment never reports station added',async()=>{
 const f=fixture();f.answers.push({command_id:'command'},{state:'failed'});await f.submit();assert.equal(f.dialogs.length,0);assert.equal(f.refreshes.length,0);assert.match(f.id('shareStatus').textContent,/could not be added/i);assert.equal(f.id('shareStatus').dataset.status,'error');assert.equal(f.form.hidden,false);
});

test('pairing and delivery remain neutral until the physical radio confirms station addition',async()=>{
 const approval=deferred(),ack=deferred(),f=fixture({useDeviceCode:true});f.answers.push({claim_id:'claim',confirmation_code:'5831'},approval.promise,{command_id:'command'},ack.promise);const adding=f.submit();await until(()=>f.calls.length===2);assert.match(f.id('shareStatus').textContent,/5831/);assert.equal(f.id('shareStatus').dataset.status,'progress');approval.resolve({state:'approved',radio_id:'new-radio'});await until(()=>f.calls.length===4);assert.equal(f.id('shareStatus').textContent,'Adding station…');assert.equal(f.id('shareStatus').dataset.status,'progress');ack.resolve({state:'added'});await adding;assert.equal(f.id('shareStatus').dataset.status,'success');
});

test('wrong codes and offline destinations have error styling that clears on another opening',async()=>{
 const f=fixture({useDeviceCode:true});f.answers.push(Error('That Device Code is incorrect.'));await f.submit();assert.equal(f.id('shareStatus').dataset.status,'error');assert.match(f.id('shareStatus').textContent,/incorrect/);f.answers.push({name:'Another station',listener_code:'11'},{radios:[]});await f.open('11',true);assert.equal(f.id('shareStatus').dataset.status,'progress');assert.equal(f.id('shareStatus').textContent,'Connect your radio once to add this station.');assert.equal(f.id('shareConnectRadio').hidden,false);
 const offline=fixture();offline.answers.push({name:'Station',listener_code:'10'},{radios:[{id:'one',online:false}]});await offline.open('10',true,true);assert.equal(offline.id('shareStatus').dataset.status,'error');offline.cancel();assert.equal(offline.id('shareStatus').dataset.status,'progress');assert.equal(offline.id('shareStatus').textContent,'');
});
test('an old add request cannot unlock a new station request or replace its message',async()=>{
 const old=deferred(),fresh=deferred(),f=fixture();f.answers.push(old.promise);const first=f.submit();await until(()=>f.calls.length===1);f.cancel();f.next();f.answers.push(fresh.promise);const second=f.submit();await until(()=>f.calls.length===2);old.reject(Error('Old request failed'));await first;
 assert.equal(f.get('shareRunning'),true);assert.equal(f.form.button.disabled,true);assert.equal(f.form.elements.radio_id.disabled,true);assert.doesNotMatch(f.id('shareStatus').textContent,/Old request failed/);f.cancel();fresh.resolve({command_id:'new-command'});await second;assert.equal(f.form.button.disabled,false);assert.equal(f.calls.filter(call=>call.path==='/api/phone/command/status').length,1);assert.equal(f.id('stationDeliveryStatus').dataset.status,'error');assert.equal(f.dialogs.length,0);
});


test('closing while an add POST is in flight still tracks its response without forcing a popup',async()=>{
 const sent=deferred(),ack=deferred(),f=fixture();f.answers.push(sent.promise,ack.promise);const adding=f.submit();await until(()=>f.calls.length===1);f.cancel();f.page('support');assert.equal(f.form.button.disabled,false);assert.equal(f.id('stationDeliveryStatus').dataset.status,'progress');sent.resolve({command_id:'command'});await until(()=>f.calls.length===2);assert.equal(f.refreshes.length,0);ack.resolve({state:'added'});await adding;assert.deepEqual(f.refreshes,['one']);assert.equal(f.id('support').hidden,false);assert.equal(f.dialogs.length,0);assert.equal(f.id('shareStatus').textContent,'');
});

test('reopening the same dispatched station attaches without a second command',async()=>{
 const sent=deferred(),ack=deferred(),f=fixture();f.answers.push(sent.promise,ack.promise);const first=f.submit();await until(()=>f.calls.length===1);f.cancel();f.next('10');const reopened=f.submit();assert.equal(f.get('shareRunning'),true);assert.equal(f.calls.length,1);sent.resolve({command_id:'command'});await until(()=>f.calls.length===2);assert.equal(f.calls.filter(c=>c.path==='/api/phone/add').length,1);assert.equal(f.dialogs.length,0);ack.resolve({state:'added'});await Promise.all([first,reopened]);assert.equal(f.calls.filter(c=>c.path==='/api/phone/add').length,1);assert.deepEqual(f.refreshes,['one']);assert.equal(f.dialogs.length,0);assert.equal(f.id('stationDeliveryStatus').dataset.status,'success');
});

test('an uncertain add retries the same request reference and reconciles an already acknowledged command',async()=>{
 const f=fixture();f.answers.push(Error('Connection lost'));await f.submit();assert.match(f.id('shareStatus').textContent,/not confirmed/);assert.equal(f.refreshes.length,0);assert.equal(f.dialogs.length,0);const reference=f.calls[0].body.request_id;assert.match(reference,/^[a-f0-9]{32}$/);f.cancel();f.next('10');f.answers.push({command_id:'committed',state:'added'});await f.submit();const adds=f.calls.filter(call=>call.path==='/api/phone/add');assert.equal(adds.length,2);assert.equal(adds[1].body.request_id,reference);assert.equal(f.calls.filter(call=>call.path==='/api/phone/command/status').length,0);assert.equal(f.id('stationDeliveryStatus').dataset.status,'success');
});

test('retrying an uncertain tracked command checks its status without sending another add',async()=>{
 const f=fixture();f.answers.push({command_id:'command'},Error('Status unavailable'));await f.submit();assert.match(f.id('shareStatus').textContent,/not confirmed/);assert.equal(f.dialogs.length,0);f.cancel();f.next('10');f.answers.push({state:'added'});await f.submit();assert.equal(f.calls.filter(c=>c.path==='/api/phone/add').length,1);assert.equal(f.calls.filter(c=>c.path==='/api/phone/command/status').length,2);assert.deepEqual(f.refreshes,['one']);assert.equal(f.id('stationDeliveryStatus').dataset.status,'success');
});

test('a background-tab acknowledgment updates compact status without opening a success dialog',async()=>{
 const ack=deferred(),f=fixture();f.answers.push({command_id:'command'},ack.promise);const adding=f.submit();await until(()=>f.calls.length===2);f.ctx.document.hidden=true;ack.resolve({state:'added'});await adding;assert.deepEqual(f.refreshes,['one']);assert.equal(f.dialogs.length,0);assert.equal(f.id('stationDeliveryStatus').dataset.status,'success');
});

test('confirmed failure permits an explicit retry but an unconfirmed command never reports success',async()=>{
 for(const failedState of ['failed','expired']){const f=fixture();f.answers.push({command_id:'first'},{state:failedState});await f.submit();assert.equal(f.dialogs.length,0);assert.equal(f.refreshes.length,0);assert.equal(f.id('stationDeliveryStatus').dataset.status,'error');f.answers.push({command_id:'second'},{state:'added'});await f.submit();assert.equal(f.calls.filter(c=>c.path==='/api/phone/add').length,2);assert.deepEqual(f.refreshes,['one']);}
});


test('reattaching after the local monitoring deadline waits on the existing command and coalesces multiple retaps',async()=>{
 let clock=1000;const ack=deferred(),f=fixture({now:()=>clock});f.answers.push({command_id:'command'},Error('Temporary status failure'));await f.submit();assert.equal(f.id('stationDeliveryStatus').dataset.status,'error');clock+=300001;
 f.cancel();f.next('10');f.answers.push({state:'waiting'},ack.promise);const resumed=f.submit();await until(()=>f.calls.length===4);assert.equal(f.calls.filter(c=>c.path==='/api/phone/add').length,1);assert.equal(f.id('stationDeliveryStatus').dataset.status,'progress');await f.submit();assert.equal(f.calls.length,4);
 f.cancel();f.next('10');const reattached=f.submit();await Promise.resolve();assert.equal(f.calls.length,4);ack.resolve({state:'added'});await Promise.all([resumed,reattached]);assert.equal(f.calls.filter(c=>c.path==='/api/phone/add').length,1);assert.equal(f.calls.filter(c=>c.path==='/api/phone/command/status').length,3);assert.deepEqual(f.refreshes,['one']);assert.equal(f.dialogs.length,0);assert.equal(f.id('stationDeliveryStatus').dataset.status,'success');
});

test('compact delivery feedback protects the station name and leaves the message independently translatable',async()=>{
 const f=fixture();f.id('shareName').textContent='Station added';f.answers.push({command_id:'command'},{state:'added'});await f.submit();const children=f.id('stationDeliveryStatus').children;assert.equal(children.length,2);assert.equal(children[0].textContent,'Station added — ');assert.equal(children[0].dataset.i18nSkip,'1');assert.equal(children[1].textContent,'✓ Station added');assert.equal(children[1].dataset.i18nSkip,undefined);
});

test('tapping a station already reported on the radio does not add it again without explicit intent',async()=>{
 const f=fixture({inventory:async()=>({known:true,codes:new Set(['10'])})});f.answers.push({name:'Saved station',listener_code:'10'},{radios:[{id:'one',online:true}]});await f.open('10',true,true);
 assert.equal(f.calls.filter(call=>call.path==='/api/phone/add').length,0);assert.equal(f.id('shareSavedNotice').hidden,false);assert.equal(f.id('shareSubmit').hidden,true);assert.equal(f.id('shareAddAgain').hidden,false);assert.equal(f.id('shareWifiHelp').hidden,true);assert.equal(f.dialogs.length,0);
 f.answers.push({command_id:'explicit-add-again'},{state:'added'});await f.id('shareAddAgain').onclick();assert.equal(f.calls.filter(call=>call.path==='/api/phone/add').length,1);assert.equal(f.dialogs.length,0);assert.equal(f.id('stationDeliveryStatus').dataset.status,'success');
});

test('a stale saved snapshot never authorizes automatic addition whether or not its last checked list includes the station',async()=>{
 for(const codes of [[],['10']]){const f=fixture({inventory:async()=>({known:true,codes:new Set(codes),stale:true,unavailable:true})});f.answers.push({name:'Station',listener_code:'10'},{radios:[{id:'one',online:true}]});await f.open('10',true,true);assert.equal(f.calls.filter(call=>call.path==='/api/phone/add').length,0);assert.match(f.id('shareStatus').textContent,/not checked.*last known list/);assert.equal(f.id('shareSavedNotice').hidden,codes.length===0);if(codes.length)assert.equal(f.id('shareSavedNotice').textContent,'Previously on your radio');}
});

test('closing during the saved inventory check prevents a later automatic station addition',async()=>{
 const inventory=deferred(),f=fixture({inventory:()=>inventory.promise});f.answers.push({name:'Station',listener_code:'10'},{radios:[{id:'one',online:true}]});const opening=f.open('10',true,true);await until(()=>f.inventoryCalls.length===1);f.cancel();inventory.resolve({known:true,codes:new Set()});await opening;
 assert.equal(f.calls.length,2);assert.equal(f.calls.some(call=>call.path==='/api/phone/add'),false);assert.equal(f.id('shared').hidden,true);assert.equal(f.get('shareRunning'),false);assert.equal(f.dialogs.length,0);
});

test('an offline station sheet exposes Wi-Fi help and an online event restores Add without sending it',async()=>{
 const f=fixture();f.answers.push({name:'Station',listener_code:'10'},{radios:[{id:'one',online:false}]});await f.open('10',true,true);
 assert.equal(f.id('shareSubmit').hidden,true);assert.equal(f.id('shareWifiHelp').hidden,false);assert.equal(f.form.dataset.radioOffline,'1');assert.match(f.id('shareStatus').textContent,/Radio offline/);assert.equal(f.calls.some(call=>call.path==='/api/phone/add'),false);
 f.status([{id:'one',online:true}]);await until(()=>f.id('shareStatus').textContent==='');assert.equal(f.id('shareSubmit').hidden,false);assert.equal(f.id('shareWifiHelp').hidden,true);assert.equal(f.form.dataset.radioOffline,'');assert.equal(f.calls.length,2);
 f.answers.push({command_id:'online-add'},{state:'added'});await f.submit();assert.equal(f.calls.filter(call=>call.path==='/api/phone/add').length,1);
});

test('offline status events hide Add again without dropping the saved notice or adding a duplicate',async()=>{
 const f=fixture({inventory:async()=>({known:true,codes:new Set(['10'])})});f.answers.push({name:'Saved station',listener_code:'10'},{radios:[{id:'one',online:true}]});await f.open('10',true,true);f.status([{id:'one',online:false}]);assert.equal(f.id('shareSavedNotice').hidden,false);assert.equal(f.id('shareSubmit').hidden,true);assert.equal(f.id('shareWifiHelp').hidden,false);
 f.status([{id:'one',online:true}]);await until(()=>!f.id('shareAddAgain').hidden&&f.form.dataset.saved==='1');assert.equal(f.id('shareSubmit').hidden,true);assert.equal(f.id('shareSavedNotice').hidden,false);assert.equal(f.calls.length,2);
});

test('offline Wi-Fi help is available before a slow inventory check completes',async()=>{
 const inventory=deferred(),f=fixture({inventory:()=>inventory.promise});f.answers.push({name:'Station',listener_code:'10'},{radios:[{id:'one',online:false}]});const opening=f.open('10',true,true);await until(()=>f.inventoryCalls.length===1);
 assert.equal(f.id('shareSubmit').hidden,true);assert.equal(f.id('shareWifiHelp').hidden,false);assert.match(f.id('shareStatus').textContent,/offline/);f.status([{id:'one',online:true}]);inventory.resolve({known:true,codes:new Set()});await opening;await until(()=>!f.id('shareSubmit').hidden);assert.equal(f.calls.length,2);assert.equal(f.id('shareSubmit').disabled,false);
});

test('choosing another radio connection abandons the initial automatic inventory continuation',async()=>{
 const inventory=deferred(),f=fixture({inventory:()=>inventory.promise});f.answers.push({name:'Station',listener_code:'10'},{radios:[{id:'one',online:true}]});const opening=f.open('10',true,true);await until(()=>f.inventoryCalls.length===1);assert.equal(f.id('shareSubmit').disabled,true);f.id('otherRadio').onclick();inventory.resolve({known:true,codes:new Set()});await opening;
 assert.equal(f.calls.length,2);assert.equal(f.id('shared').hidden,true);assert.equal(f.id('myRadio').hidden,false);assert.equal(f.get('pendingStationConnection.code'),'10');assert.equal(f.id('deviceLabel').hidden,true);assert.equal(f.id('shareSubmit').disabled,false);assert.equal(f.get('shareRunning'),false);
});

test('a superseded inventory check cannot automatically resend a saved station after radio status recovers',async()=>{
 const inventory=deferred(),f=fixture({inventory:()=>inventory.promise});f.answers.push({name:'Saved station',listener_code:'10'},{radios:[{id:'one',online:true}]});const opening=f.open('10',true,true);await until(()=>f.inventoryCalls.length===1);f.status([{id:'one',online:false}]);f.status([{id:'one',online:true}]);assert.equal(f.inventoryCalls.length,2);inventory.resolve({known:true,codes:new Set(['10'])});await opening;
 assert.equal(f.calls.filter(call=>call.path==='/api/phone/add').length,0);assert.equal(f.id('shareSavedNotice').hidden,false);assert.equal(f.id('shareSubmit').textContent,'Add again');assert.equal(f.id('shareSubmit').disabled,false);
});

test('changing the selected radio during an inventory check never transfers the original tap intent',async()=>{
 const initial=deferred(),f=fixture({inventory:id=>id==='one'?initial.promise:Promise.resolve({known:true,codes:new Set()})});f.answers.push({name:'Station',listener_code:'10'},{radios:[{id:'one',online:true},{id:'two',online:true}]});const opening=f.open('10',true,true);await until(()=>f.inventoryCalls.length===1);f.form.elements.radio_id.value='two';await f.get('updateStationConfirmation()');initial.resolve({known:true,codes:new Set()});await opening;
 assert.equal(f.calls.filter(call=>call.path==='/api/phone/add').length,0);assert.equal(f.form.elements.radio_id.value,'two');assert.equal(f.id('shareSubmit').disabled,false);assert.equal(f.dialogs.length,0);
});


test('one linked radio uses compact Device Code text while keeping the hidden destination',async()=>{
 const f=fixture();f.answers.push({name:'Station',listener_code:'10'},{radios:[{id:'one',device_code:'3961',online:true}]});await f.open('10',true);
 assert.equal(f.id('radioLabel').hidden,true);assert.equal(f.id('shareSingleRadio').hidden,false);assert.equal(f.id('shareSingleRadioCode').textContent,'3961');assert.equal(f.form.elements.radio_id.value,'one');assert.equal(f.id('deviceLabel').hidden,true);
 f.answers.push({command_id:'one-command'},{state:'added'});await f.submit();assert.equal(f.calls.find(call=>call.path==='/api/phone/add').body.radio_id,'one');
});

test('multiple linked radios keep the chooser and hide the single destination text',async()=>{
 const f=fixture({selectedId:'two'});f.answers.push({name:'Station',listener_code:'10'},{radios:[{id:'one',device_code:'1234',online:true},{id:'two',device_code:'3961',online:true}]});await f.open('10',true);
 assert.equal(f.id('radioLabel').hidden,false);assert.equal(f.id('shareSingleRadio').hidden,true);assert.equal(f.id('shareSingleRadioCode').textContent,'');assert.equal(f.form.elements.radio_id.value,'two');
});

test('connecting another radio leaves the compact sheet for the common connection flow',async()=>{
 const f=fixture();f.answers.push({name:'Station',listener_code:'10'},{radios:[{id:'one',device_code:'3961',online:true}]});await f.open('10',true);f.id('otherRadio').onclick();
 assert.equal(f.id('shared').hidden,true);assert.equal(f.id('myRadio').hidden,false);assert.equal(f.id('deviceLabel').hidden,true);assert.equal(f.form.elements.device_code.required,false);assert.equal(f.get('pendingStationConnection.code'),'10');assert.equal(f.calls.length,2);
});

test('a first physical approval keeps one radio compact without asking for a redundant selection',async()=>{
 const f=fixture({useDeviceCode:true});f.answers.push({claim_id:'claim',confirmation_code:'0583'},{state:'approved',radio_id:'one'},{command_id:'added'},{state:'failed'});await f.submit();
 assert.equal(f.id('deviceLabel').hidden,true);assert.equal(f.id('radioLabel').hidden,true);assert.equal(f.id('shareSingleRadio').hidden,false);assert.equal(f.id('shareSingleRadioCode').textContent,'3961');assert.equal(f.form.elements.radio_id.value,'one');
});

test('an invalid manual Device Code returns before busy state, security check or network requests',async()=>{
 const f=fixture({useDeviceCode:true,validate:()=>null});f.form.elements.device_code.value='bad code';await f.submit();assert.equal(f.validations.length,1);assert.equal(f.validations[0].disabled,false);assert.equal(f.get('shareRunning'),false);assert.equal(f.form.button.disabled,false);assert.equal(f.humanSignals.length,0);assert.equal(f.calls.length,0);assert.equal(f.dialogs.length,0);
});

test('shared pairing uses the normalized captured Device Code and a random attempt reference',async()=>{
 const bot=deferred(),f=fixture({useDeviceCode:true,human:()=>bot.promise});f.form.elements.device_code.value='00 12-34';f.answers.push({claim_id:'claim',confirmation_code:'5831'},{state:'denied'});const adding=f.submit();await until(()=>f.humanSignals.length===1);f.form.elements.device_code.value='9999';bot.resolve('checked');await adding;const claim=f.calls.find(call=>call.path==='/api/phone/claim');assert.equal(claim.body.device_code,'001234');assert.match(claim.body.request_id,/^[a-f0-9]{32}$/);assert.equal(f.validations[0].disabled,false);assert.equal(f.cancellations.length,1);assert.equal(f.cancellations[0].request_id,claim.body.request_id);
});

test('Stop waiting aborts the shared security check and never creates a server claim',async()=>{
 const f=fixture({useDeviceCode:true,human:(_form,_action,signal)=>new Promise((_resolve,reject)=>signal.addEventListener('abort',()=>reject(Object.assign(Error('Stopped'),{name:'AbortError'})),{once:true}))});const adding=f.submit();await until(()=>f.humanSignals.length===1);f.cancel();await adding;assert.equal(f.humanSignals[0].aborted,true);assert.equal(f.calls.length,0);assert.equal(f.cancellations.length,0);assert.equal(f.form.button.disabled,false);assert.equal(f.id('shareStatus').textContent,'');
});

test('closing with the claim POST in flight sends its cancellation reference before a late response',async()=>{
 const claim=deferred(),f=fixture({useDeviceCode:true});f.answers.push(claim.promise);const adding=f.submit();await until(()=>f.calls.some(call=>call.path==='/api/phone/claim'));const requestId=f.calls[0].body.request_id;f.cancel();assert.equal(f.cancellations.length,1);assert.equal(f.cancellations[0].request_id,requestId);claim.resolve({claim_id:'late',confirmation_code:'5831'});await adding;assert.equal(f.calls.filter(call=>call.path==='/api/phone/claim/status').length,0);assert.equal(f.calls.some(call=>call.path==='/api/phone/add'),false);assert.equal(f.selected.length,0);assert.equal(f.dialogs.length,0);assert.equal(f.id('shareStatus').textContent,'');
});

test('navigation cancels a pending shared physical approval and ignores its late approved status',async()=>{
 const approval=deferred(),f=fixture({useDeviceCode:true});f.answers.push({claim_id:'claim',confirmation_code:'5831'},approval.promise);const adding=f.submit();await until(()=>f.calls.filter(call=>call.path==='/api/phone/claim/status').length===1);f.page('support');assert.equal(f.cancellations.length,1);approval.resolve({state:'approved',radio_id:'one'});await adding;assert.equal(f.id('support').hidden,false);assert.equal(f.id('shared').hidden,true);assert.equal(f.selected.length,0);assert.equal(f.calls.some(call=>call.path==='/api/phone/add'),false);assert.equal(f.dialogs.length,0);assert.equal(f.cancellations.length,1);
});

test('a new shared attempt waits for cancellation cleanup and uses a distinct request reference',async()=>{
 const old=deferred(),next=deferred(),cleanup=deferred();let cancelCount=0;const f=fixture({useDeviceCode:true,cancelRequest:()=>++cancelCount===1?cleanup.promise:Promise.resolve({state:'cancelled'})});f.answers.push(old.promise);const first=f.submit();await until(()=>f.calls.some(call=>call.path==='/api/phone/claim'));const firstId=f.calls[0].body.request_id;f.cancel();f.next('11');f.answers.push(next.promise);const second=f.submit();old.resolve({claim_id:'old',confirmation_code:'1111'});await first;await new Promise(setImmediate);assert.equal(f.calls.filter(call=>call.path==='/api/phone/claim').length,1);assert.equal(f.humanSignals.length,1);cleanup.resolve({state:'cancelled'});await until(()=>f.calls.filter(call=>call.path==='/api/phone/claim').length===2);const claims=f.calls.filter(call=>call.path==='/api/phone/claim');assert.notEqual(claims[1].body.request_id,firstId);f.answers.push({state:'denied'});next.resolve({claim_id:'new',confirmation_code:'2222'});await second;assert.equal(f.selected.length,0);assert.equal(f.calls.some(call=>call.path==='/api/phone/add'),false);
});

test('uncertain shared pairing cleanup gives Deny guidance only to the still-visible idle form',async()=>{
 const f=fixture({useDeviceCode:true,cancelRequest:async()=>{throw Error('Cancellation unavailable');}});f.answers.push(Error('Claim response unavailable'));await f.submit();await f.get('sharedPairingCancellation');assert.match(f.id('shareStatus').textContent,/Could not confirm cancellation.*Tap Deny/);assert.equal(f.id('shareStatus').dataset.status,'error');assert.equal(f.get('shareRunning'),false);assert.equal(f.cancellations.length,1);
});

test('late shared cleanup failure cannot overwrite a newer attempt or send the old station',async()=>{
 const cleanup=deferred(),claim=deferred();let cancelCount=0;const f=fixture({useDeviceCode:true,cancelRequest:()=>++cancelCount===1?cleanup.promise:Promise.resolve({state:'cancelled'})});f.answers.push(Error('Old claim response failed'));await f.submit();f.next('11');f.answers.push(claim.promise);const second=f.submit();cleanup.reject(Error('Old cleanup failed'));await until(()=>f.calls.filter(call=>call.path==='/api/phone/claim').length===2);assert.equal(f.id('shareStatus').textContent,'Adding station…');assert.equal(f.get('shareRunning'),true);assert.equal(f.form.button.disabled,true);f.cancel();claim.reject(Error('New late response'));await second;assert.equal(f.id('shareStatus').textContent,'');assert.equal(f.calls.some(call=>call.path==='/api/phone/add'),false);
});

test('Stop waiting after physical approval preserves the phone grant and continues dispatched station delivery',async()=>{
 const sent=deferred(),ack=deferred(),f=fixture({useDeviceCode:true});f.answers.push({claim_id:'claim',confirmation_code:'5831'},{state:'approved',radio_id:'one'},sent.promise,ack.promise);const adding=f.submit();await until(()=>f.calls.some(call=>call.path==='/api/phone/add'));f.cancel();assert.equal(f.cancellations.length,0);sent.resolve({command_id:'command'});await until(()=>f.calls.some(call=>call.path==='/api/phone/command/status'));ack.resolve({state:'added'});await adding;assert.equal(f.cancellations.length,0);assert.deepEqual(f.refreshes,['one']);assert.equal(f.dialogs.length,0);assert.equal(f.id('stationDeliveryStatus').dataset.status,'success');
});

test('a late shared claim error triggers only one cancellation and cannot modify the closed view',async()=>{
 const claim=deferred(),f=fixture({useDeviceCode:true});f.answers.push(claim.promise);const adding=f.submit();await until(()=>f.calls.some(call=>call.path==='/api/phone/claim'));f.cancel();claim.reject(Error('Late claim failure'));await adding;await f.get('sharedPairingCancellation');assert.equal(f.cancellations.length,1);assert.equal(f.id('shareStatus').textContent,'');assert.equal(f.form.button.disabled,false);assert.equal(f.dialogs.length,0);
});

test('shared pairing waits for a pending main Radio cancellation before starting a security check',async()=>{
 const mainCleanup=deferred(),claim=deferred(),f=fixture({useDeviceCode:true});f.ctx.radioPairingCancellation=mainCleanup.promise;f.answers.push(claim.promise);const adding=f.submit();await new Promise(setImmediate);assert.equal(f.humanSignals.length,0);assert.equal(f.calls.length,0);mainCleanup.resolve();await until(()=>f.calls.some(call=>call.path==='/api/phone/claim'));f.cancel();claim.resolve({claim_id:'late',confirmation_code:'1111'});await adding;assert.equal(f.cancellations.length,1);
});

test('shared pairing rechecks main Radio cleanup immediately before dispatch after a security check',async()=>{
 const mainCleanup=deferred(),bot=deferred(),claim=deferred(),f=fixture({useDeviceCode:true,human:()=>bot.promise});f.answers.push(claim.promise);const adding=f.submit();await until(()=>f.humanSignals.length===1);f.ctx.radioPairingCancellation=mainCleanup.promise;bot.resolve('checked');await new Promise(setImmediate);assert.equal(f.calls.length,0);mainCleanup.resolve();await until(()=>f.calls.some(call=>call.path==='/api/phone/claim'));f.cancel();claim.resolve({claim_id:'late',confirmation_code:'1111'});await adding;assert.equal(f.cancellations.length,1);
});

test('a newly opened station clears the previous destination and cannot submit while current grants are loading',async()=>{
 const pending=deferred(),f=fixture({selectedId:'two'});f.answers.push({name:'Fresh station',listener_code:'14'},pending.promise);const opening=f.open('14',true);await until(()=>f.calls.length===2);assert.equal(f.form.hidden,true);assert.equal(f.form.elements.radio_id.value,'');assert.equal(f.id('shareSubmit').disabled,true);await f.submit();assert.equal(f.calls.length,2);pending.resolve({radios:[{id:'one',online:true},{id:'two',online:true}]});await opening;assert.equal(f.form.hidden,false);assert.equal(f.form.elements.radio_id.value,'two');assert.equal(f.id('shareSubmit').disabled,false);
});

test('station reporting becomes available with public metadata even when the private radio lookup fails',async()=>{
 const f=fixture(),station=deferred();f.answers.push(station.promise,Error('Radio status unavailable'));const opening=f.open('13',true);assert.equal(f.id('reportStationProblem').hidden,true);station.resolve({name:'Public station',listener_code:'13'});await assert.rejects(opening,/Radio status unavailable/);assert.equal(f.id('reportStationProblem').hidden,false);assert.equal(f.form.hidden,true);assert.equal(f.calls.some(call=>call.path==='/api/phone/add'),false);
});
