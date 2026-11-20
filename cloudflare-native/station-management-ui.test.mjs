import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';

const source=readFileSync(new URL('./public/assets/station-management.js',import.meta.url),'utf8');
const radioId='a'.repeat(32),commandId='c'.repeat(32),claimId='d'.repeat(32);
const radio={id:radioId,device_code:'3961',online:true,station_removal_version:1,removal_ready:true,controls_allowed:true};
function deferred(){let resolve;const promise=new Promise(yes=>{resolve=yes;});return {promise,resolve};}
async function until(check){for(let i=0;i<40&&!check();i++)await new Promise(setImmediate);assert.ok(check(),'Async checkpoint not reached');}
function fixture({currentRadio={...radio},storage=new Map(),translation=key=>key}={}){
 const ids=new Map(),events=new Map(),calls=[],confirmations=[],statuses=[],handlers=new Map(),refreshes=[];let clock=1800000000000,sequence=0,inventory={known:true,stale:false,codes:new Set(['15'])},confirmation=true,pollResult={state:'approved'},refreshHook;
 const node=(tag='div')=>{const result={tag,children:[],attributes:{},dataset:{},hidden:false,disabled:false,textContent:'',value:'',before(child){child.parentElement=this.parentElement;},append(...children){this.children.push(...children);for(const child of children)child.parentElement=this;},setAttribute(key,value){this.attributes[key]=String(value);},addEventListener(){}};Object.defineProperty(result,'id',{get(){return this.nodeId;},set(value){this.nodeId=value;ids.set(value,this);}});return result;};
 const $=id=>{if(!ids.has(id))ids.set(id,node());return ids.get(id);};
 $('shareForm').elements={radio_id:{value:radioId}};$('shareForm').dataset.saved='1';$('deviceLabel').hidden=true;$('shareName').textContent='TEST STATION';
 const window={appI18n:{t:translation},addEventListener(type,fn){if(!events.has(type))events.set(type,[]);events.get(type).push(fn);},dispatchEvent(event){for(const fn of events.get(event.type)||[])fn(event);}};
 const document={hidden:false,createElement:node};class FakeDate extends Date{static now(){return clock;}}
 const context={window,document,navigator:{onLine:true},Date:FakeDate,AbortController,Promise,Set,Map,Event:class{constructor(type){this.type=type;}},$,sharedCode:'15',sharedOpenGeneration:1,sharedLinkedRadios:[currentRadio],shareRunning:false,stationDeliveries:new Map(),stationDeliveryNotices:new Map(),sessionStorage:{getItem:key=>storage.get(key)||null,setItem:(key,value)=>storage.set(key,value)},crypto:{randomUUID:()=> (++sequence).toString(16).padStart(32,'0')},readRadioInventory:()=>inventory,refreshRadioInventory:async id=>{refreshes.push(id);return refreshHook?await refreshHook():inventory;},renderStationDeliveryStatus(){},setSharedSavedState(saved){$('shareForm').dataset.saved=saved?'1':'';window.updateStationManagement(saved);},setSharedStatus(text,kind){statuses.push({text,kind});$('shareStatus').textContent=text;},listenerActionDialog:async(...args)=>{confirmations.push(args);return typeof confirmation==='function'?await confirmation():confirmation;},pollPhoneApproval:async(...args)=>typeof pollResult==='function'?await pollResult(...args):pollResult,phoneApprovalMessage:state=>'Approval '+state,api:async(path,body)=>{calls.push({path,body});const handler=handlers.get(path);if(!handler)throw Error('Missing handler: '+path);return await handler(body);},setTimeout(fn,ms){if(ms===2500||ms===1000||ms===60000){clock+=ms;queueMicrotask(fn);}return 1;},stationPopup:{open:true,close(){this.open=false;$('shared').hidden=true;context.sharedOpenGeneration++;window.cancelStationRemovalAuthorization();}}};
 handlers.set('/api/phone/radios',()=>({radios:context.sharedLinkedRadios}));handlers.set('/api/phone/control/authorize/cancel',()=>({state:'cancelled'}));
 runInNewContext(source,context);window.updateStationManagement(true);
 return {$,window,document,calls,confirmations,statuses,handlers,refreshes,storage,context,get:expr=>runInNewContext(expr,context),remove:()=>$('removeSavedStation').onclick(),update:()=>window.updateStationManagement(true),inventory(codes,stale=false){inventory={known:true,stale,codes:new Set(codes)};},confirmation(value){confirmation=value;},poll(value){pollResult=value;},refresh(fn){refreshHook=fn;},emit(type,detail){window.dispatchEvent({type,detail});},close(){context.stationPopup.close();},select(id){$('shareForm').elements.radio_id.value=id;},advance(ms){clock+=ms;}};
}

test('legacy, offline and stale radios cannot remove; saved state offers software help',async()=>{
 const legacy=fixture({currentRadio:{...radio,station_removal_version:0,removal_ready:false}});assert.equal(legacy.$('stationManagement').hidden,false);assert.equal(legacy.$('removeSavedStation').disabled,true);assert.equal(legacy.$('shareAddAgain').disabled,false,'addition-only radios retain Add again');assert.match(legacy.get('stationRemovalHelp').textContent,/Update your radio software/);assert.equal(legacy.get('stationRemovalDownload').hidden,false);assert.equal(legacy.get('stationRemovalDownload').href,'/assets/waveshare-radio.zip');assert.equal(legacy.$('shareSavedNotice').textContent,'On your radio');await legacy.remove();assert.equal(legacy.calls.length,0);
 const offline=fixture({currentRadio:{...radio,online:false}});assert.equal(offline.$('removeSavedStation').disabled,true);assert.match(offline.get('stationRemovalHelp').textContent,/connected to Wi-Fi/);
 const stale=fixture();stale.inventory(['15'],true);stale.update();assert.equal(stale.$('removeSavedStation').disabled,true);assert.match(stale.get('stationRemovalHelp').textContent,/Refresh the saved list/);
});

test('canceling the single confirmation sends no writes and unlocks Add again',async()=>{
 const f=fixture();f.confirmation(false);await f.remove();assert.equal(f.confirmations.length,1);assert.equal(f.calls.length,0);assert.equal(f.window.stationManagementBusy,false);assert.equal(f.$('shareAddAgain').disabled,false);assert.equal(f.$('removeSavedStation').disabled,false);
});

test('management refresh after destination loading enables removal, and unlisted saved items never offer Add again',()=>{
 const f=fixture();f.$('shareForm').dataset.destinationLoading='1';f.update();assert.equal(f.$('removeSavedStation').disabled,true);delete f.$('shareForm').dataset.destinationLoading;f.update();assert.equal(f.$('removeSavedStation').disabled,false);f.$('shareForm').dataset.unlisted='1';f.update();assert.equal(f.$('shareAddAgain').hidden,true);assert.equal(f.$('removeSavedStation').disabled,false);
});

test('removal waits for physical acknowledgement and a fresh saved list before success',async()=>{
 const f=fixture(),ack=deferred();let stateChanges=0;f.window.addEventListener('station-removal-changed',()=>stateChanges++);f.handlers.set('/api/phone/control',()=>({command_id:commandId,state:'pending'}));f.handlers.set('/api/phone/control/status',()=>ack.promise);
 const pending=f.remove();await until(()=>f.calls.some(c=>c.path==='/api/phone/control/status'));
 assert.equal(f.confirmations.length,1);assert.equal(f.calls.find(c=>c.path==='/api/phone/control').body.action,'remove_station');assert.equal(f.calls.find(c=>c.path==='/api/phone/control').body.value,15);assert.equal(f.$('shareSavedNotice').textContent,'On your radio');assert.equal(f.window.stationRemovalPending(radioId,'15'),true);assert.equal(f.$('shareAddAgain').disabled,true);assert.equal(f.$('shared').dataset.removing,'1');assert.equal(f.get('stationRemovalHelp').hidden,true,'shareStatus owns progress instead of duplicating helper text');assert.equal(f.context.stationPopup.open,true);assert.ok(!f.statuses.some(s=>/✓ Removed/.test(s.text)));
 f.inventory([]);ack.resolve({state:'applied'});await pending;
 assert.equal(f.window.stationRemovalPending(radioId,'15'),false);assert.equal(f.context.stationPopup.open,false);assert.ok(f.statuses.some(s=>s.text==='✓ Removed from Device Code 3961'));assert.equal(f.refreshes.length,2);assert.equal(f.calls.filter(c=>c.path==='/api/phone/control').length,1);assert.ok(stateChanges>=3,'update deferral observes confirmation, command and completion state changes');
});

test('an applied acknowledgement with unavailable or stale inventory asks to refresh, without a false removed state',async()=>{
 const f=fixture();f.handlers.set('/api/phone/control',()=>({command_id:commandId,state:'applied'}));let refreshed=0;f.refresh(()=>{refreshed++;return refreshed===1?{known:true,stale:false,codes:new Set(['15'])}:{known:true,stale:true,codes:new Set([])};});await f.remove();
 assert.equal(f.context.stationPopup.open,true);assert.equal(f.$('removeSavedStation').textContent,'Refresh saved list');assert.equal(f.window.stationRemovalPending(radioId,'15'),true);assert.ok(!f.statuses.some(s=>/✓ Removed/.test(s.text)));
 f.refresh(()=>({known:true,stale:false,codes:new Set([])}));await f.remove();assert.equal(f.context.stationPopup.open,false);assert.equal(f.calls.filter(c=>c.path==='/api/phone/control').length,1);assert.equal(f.confirmations.length,1);
});

test('a newer saved list containing the station does not leave the owner stuck after a completed removal receipt',async()=>{
 const f=fixture();f.handlers.set('/api/phone/control',()=>({command_id:commandId,state:'applied'}));await f.remove();assert.match(f.$('shareStatus').textContent,/latest saved list/);assert.equal(f.context.stationPopup.open,true);assert.equal(f.window.stationRemovalPending(radioId,'15'),false);assert.equal(f.$('removeSavedStation').textContent,'Remove from this radio');assert.ok(!f.statuses.some(s=>/✓ Removed/.test(s.text)));
});

test('lost write responses preserve a request reference and Check removal retries the same operation',async()=>{
 const f=fixture();let writes=0;f.handlers.set('/api/phone/control',()=>{writes++;if(writes===1)throw Error('Connection dropped after write');f.inventory([]);return {command_id:commandId,state:'applied'};});await f.remove();
 assert.equal(f.$('removeSavedStation').textContent,'Check removal');assert.match(f.$('shareStatus').textContent,/not been confirmed/);assert.equal(f.context.stationPopup.open,true);assert.equal(f.window.stationRemovalPending(radioId,'15'),true);await f.remove();
 const requests=f.calls.filter(c=>c.path==='/api/phone/control');assert.equal(requests.length,2);assert.equal(requests[0].body.request_id,requests[1].body.request_id);assert.equal(f.confirmations.length,1);assert.equal(f.context.stationPopup.open,false);
});

test('reloading restores only a receipt and checking a known command never repeats the write',async()=>{
 const storage=new Map(),first=fixture({storage});first.handlers.set('/api/phone/control',()=>({command_id:commandId,state:'pending'}));first.handlers.set('/api/phone/control/status',()=>{throw Error('Offline');});await first.remove();
 assert.equal(first.$('removeSavedStation').textContent,'Check removal');const restored=fixture({storage});assert.equal(restored.calls.length,0,'restoring a receipt is read-only');assert.equal(restored.$('removeSavedStation').textContent,'Check removal');restored.inventory([]);restored.handlers.set('/api/phone/control/status',()=>({state:'applied'}));await restored.remove();assert.deepEqual(restored.calls.map(c=>c.path),['/api/phone/control/status']);assert.equal(restored.context.stationPopup.open,false);assert.equal(restored.confirmations.length,0);
});

test('failed and expired device commands stay saved and allow a new explicitly confirmed attempt',async()=>{
 for(const state of ['failed','expired']){const f=fixture();f.handlers.set('/api/phone/control',()=>({command_id:commandId,state}));await f.remove();assert.equal(f.window.stationRemovalPending(radioId,'15'),false);assert.equal(f.context.stationPopup.open,true);assert.match(f.$('shareStatus').textContent,/could not be removed/);assert.equal(f.$('removeSavedStation').textContent,'Remove from this radio');assert.equal(f.$('shareAddAgain').disabled,false);}
});

test('an inaccessible old receipt offers saved-list guidance instead of locking Add again forever',async()=>{
 const f=fixture();f.handlers.set('/api/phone/control',()=>({command_id:commandId,state:'pending'}));f.handlers.set('/api/phone/control/status',()=>{const error=Error('Command not found');error.status=404;throw error;});await f.remove();assert.match(f.$('shareStatus').textContent,/could not be checked/);assert.equal(f.window.stationRemovalPending(radioId,'15'),false);assert.equal(f.$('shareAddAgain').disabled,false);assert.ok(!f.statuses.some(s=>/✓ Removed/.test(s.text)));
});

test('changing destination during confirmation cannot remove from the old or new radio',async()=>{
 const f=fixture(),answer=deferred();f.confirmation(()=>answer.promise);const pending=f.remove();await until(()=>f.confirmations.length===1);f.select('b'.repeat(32));f.emit('radio-selection-changed');answer.resolve(true);await pending;assert.equal(f.calls.filter(c=>c.path==='/api/phone/control').length,0);assert.equal(f.calls.filter(c=>c.path==='/api/phone/control/authorize').length,0);
});

test('phone-control permission is approved once before removal, with no duplicate confirmation',async()=>{
 const f=fixture({currentRadio:{...radio,controls_allowed:false}});f.handlers.set('/api/phone/control/authorize',body=>{assert.match(body.request_id,/^[a-f0-9]{32}$/);return {claim_id:claimId,confirmation_code:'1234'};});f.poll(()=>{f.context.sharedLinkedRadios=[{...radio}];return {state:'approved'};});f.handlers.set('/api/phone/control',()=>{f.inventory([]);return {command_id:commandId,state:'applied'};});await f.remove();assert.equal(f.confirmations.length,1);assert.equal(f.calls.filter(c=>c.path==='/api/phone/control/authorize').length,1);assert.equal(f.calls.filter(c=>c.path==='/api/phone/control').length,1);assert.ok(f.statuses.some(s=>/Match 1234/.test(s.text)));assert.equal(f.calls.filter(c=>c.path.endsWith('/cancel')).length,0);assert.equal(f.window.stationManagementBusy,false);
});

test('closing while authorization response is delayed cancels its reference and never dispatches removal',async()=>{
 const f=fixture({currentRadio:{...radio,controls_allowed:false}}),response=deferred();f.handlers.set('/api/phone/control/authorize',()=>response.promise);const pending=f.remove();await until(()=>f.calls.some(c=>c.path==='/api/phone/control/authorize'));f.close();response.resolve({claim_id:claimId,confirmation_code:'1234'});await pending;
 const request=f.calls.find(c=>c.path==='/api/phone/control/authorize'),cancel=f.calls.find(c=>c.path==='/api/phone/control/authorize/cancel');assert.equal(cancel.body.radio_id,radioId);assert.equal(cancel.body.request_id,request.body.request_id);assert.equal(f.calls.filter(c=>c.path==='/api/phone/control').length,0);assert.equal(f.window.stationManagementBusy,false);
});

test('changing radio during authorization cancels the original reference once, including its late response',async()=>{
 const f=fixture({currentRadio:{...radio,controls_allowed:false}}),response=deferred();f.handlers.set('/api/phone/control/authorize',()=>response.promise);const pending=f.remove();await until(()=>f.calls.some(c=>c.path==='/api/phone/control/authorize'));f.select('b'.repeat(32));f.emit('radio-selection-changed');response.resolve({claim_id:claimId,confirmation_code:'1234'});await pending;const request=f.calls.find(c=>c.path==='/api/phone/control/authorize'),cancellations=f.calls.filter(c=>c.path==='/api/phone/control/authorize/cancel');assert.equal(cancellations.length,1);assert.equal(cancellations[0].body.radio_id,radioId);assert.equal(cancellations[0].body.request_id,request.body.request_id);assert.deepEqual(Object.keys(cancellations[0].body).sort(),['radio_id','request_id']);assert.equal(f.calls.filter(c=>c.path==='/api/phone/control').length,0);assert.equal(f.window.stationManagementBusy,false);
});

test('closing after dispatch retains monitoring without closing a different station sheet',async()=>{
 const f=fixture(),ack=deferred();f.handlers.set('/api/phone/control',()=>({command_id:commandId,state:'pending'}));f.handlers.set('/api/phone/control/status',()=>ack.promise);const pending=f.remove();await until(()=>f.calls.some(c=>c.path==='/api/phone/control/status'));f.close();f.$('shared').hidden=false;f.context.sharedCode='17';f.context.stationPopup.open=true;f.$('shareName').textContent='OTHER STATION';f.inventory([]);ack.resolve({state:'applied'});await pending;assert.equal(f.context.stationPopup.open,true);assert.equal(f.context.sharedCode,'17');assert.equal(f.window.stationRemovalPending(radioId,'15'),false);assert.equal(f.context.stationDeliveryNotices.get(radioId).name,'TEST STATION');
});

test('station names remain literal text and translated labels do not alter request identity',async()=>{
 const f=fixture({translation:key=>key==='management.remove'?'Retire sou radyo sa a':key});f.$('shareName').textContent='<img src=x onerror=alert(1)>';f.confirmation(false);f.update();assert.equal(f.$('removeSavedStation').textContent,'Retire sou radyo sa a');await f.remove();assert.match(f.confirmations[0][1],/<img src=x onerror=alert\(1\)>/);assert.equal(f.calls.length,0);
});
