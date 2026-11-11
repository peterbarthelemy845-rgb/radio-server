import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';

const source=readFileSync(new URL('./public/assets/listener-usability.js',import.meta.url),'utf8');
const inventorySource=source.slice(0,source.indexOf('function showRadioApproval('));
function pending(){let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return {promise,resolve,reject};}
function storage(values){return {getItem:key=>values.has(key)?values.get(key):null,setItem:(key,value)=>values.set(key,String(value))};}
function fixture({local=new Map(),session=new Map(),catalog=new Map(),blockedStorage=false}={}){
 const events=[],calls=[],answers=[];let now=0;
 const unavailable={getItem(){throw Error('Storage unavailable');},setItem(){throw Error('Storage unavailable');}};
 const context={localStorage:blockedStorage?unavailable:storage(local),sessionStorage:blockedStorage?unavailable:storage(session),Date:{now:()=>now},window:{dispatchEvent:event=>events.push(event)},Event:class{constructor(type){this.type=type;}},CustomEvent:class{constructor(type,options){this.type=type;this.detail=options.detail;}},getStationDirectoryStation:code=>catalog.get(String(code)),api:async path=>{calls.push(path);if(!answers.length)throw Error('No fixture response');const next=answers.shift();if(next instanceof Error)throw next;return await next;}};
 runInNewContext(inventorySource,context);
 return {events,calls,answers,catalog,local,session,advance(ms){now+=ms;},read:runInNewContext('readSelectedRadio',context),remember:runInNewContext('rememberSelectedRadio',context),reconcile:runInNewContext('reconcileSelectedRadio',context),load:runInNewContext('loadRadioInventory',context),inventory:runInNewContext('readRadioInventory',context),metadata:runInNewContext('getSavedStationMetadata',context),loadMetadata:runInNewContext('loadSavedStationMetadata',context)};
}
const station=(code,name='Saved station',revision='1')=>({listener_code:String(code),name,revision,logo_url:'/artwork/logo.png',logo_thumb_url:'/artwork/logo.png?size=192'});

test('changing the default in another tab cannot redirect the existing tab or its next auto-add selection',()=>{
 const local=new Map([['selectedRadio','one']]),a=fixture({local}),b=fixture({local});assert.equal(a.read(),'one');assert.equal(b.read(),'one');
 b.remember('two');assert.equal(local.get('selectedRadio'),'two');assert.equal(a.read(),'one');assert.equal(a.reconcile([{id:'one'},{id:'two'}]),'one');assert.equal(a.events.length,0,'Another tab cannot silently dispatch a local selection change');
 const next=fixture({local});assert.equal(next.read(),'two','Only a new tab inherits the updated default');a.remember('three');assert.equal(b.read(),'two');assert.equal(a.events.at(-1).type,'radio-selection-changed');
 const reload=fixture({local,session:b.session});assert.equal(reload.read(),'two','Reloading retains this tab’s own destination');
});

test('an explicitly cleared tab selection stays cleared on reload and blocked storage still permits a stable local choice',()=>{
 const local=new Map([['selectedRadio','one']]),session=new Map(),a=fixture({local,session});a.remember('');local.set('selectedRadio','two');assert.equal(fixture({local,session}).read(),'');
 const blocked=fixture({blockedStorage:true});assert.equal(blocked.read(),'');blocked.remember('one');assert.equal(blocked.read(),'one');assert.equal(blocked.reconcile([{id:'one'},{id:'two'}]),'one');
});

test('a transient saved-inventory failure retains the known station codes and marks them unchecked until recovery',async()=>{
 const f=fixture({catalog:new Map([['13',station('13')],['14',station('14')]])});f.answers.push({saved_station_codes:['13'],inventory_reported_at:10});const first=await f.load('one');assert.equal(first.known,true);
 f.answers.push(Error('Temporary network failure'));const stale=await f.load('one',true);assert.equal(stale.known,true);assert.equal(stale.stale,true);assert.equal(stale.unavailable,true);assert.deepEqual([...stale.codes],['13']);assert.equal(stale.reportedAt,10);
 f.answers.push({saved_station_codes:['14'],inventory_reported_at:20});const restored=await f.load('one',true);assert.deepEqual([...restored.codes],['14']);assert.equal(restored.stale,undefined);assert.equal(restored.unavailable,undefined);assert.equal(restored.reportedAt,20);
});

test('authorization loss clears private saved inventory instead of retaining it as a network error',async()=>{
 for(const status of [401,403]){const f=fixture({catalog:new Map([['13',station('13')]])});f.answers.push({saved_station_codes:['13'],inventory_reported_at:10});await f.load('one');f.answers.push(Object.assign(Error('Grant unavailable'),{status}));const result=await f.load('one',true);assert.equal(result.known,false);assert.equal(result.stale,undefined);assert.deepEqual([...result.codes],[]);}
 const first=fixture();first.answers.push(Error('No connection'));const unknown=await first.load('one');assert.equal(unknown.known,false);assert.equal(unknown.stale,undefined);
});

test('all100 saved stations outside the first catalog page load in one deduplicated bounded metadata batch',async()=>{
 const f=fixture(),codes=Array.from({length:100},(_,i)=>String(900000+i)),batch=pending();f.answers.push({saved_station_codes:codes,inventory_reported_at:10},batch.promise);await f.load('one');assert.equal(f.calls.length,2);
 const url=new URL('https://radiolocals.com'+f.calls[1]);assert.equal(url.pathname,'/api/stations/batch');assert.equal(url.searchParams.get('codes').split(',').length,100);assert.equal(url.searchParams.get('codes').length,699);
 const again=f.loadMetadata(codes);assert.equal(f.calls.length,2,'Repeated renders share the in-flight batch');batch.resolve({stations:[...codes.map(code=>station(code)),station('14','Not requested')]});await again;
 assert.equal(f.metadata('900099').name,'Saved station');assert.equal(f.metadata('900099').logo_thumb_url,'/artwork/logo.png?size=192');assert.equal(f.metadata('14'),undefined);assert.equal(f.events.filter(event=>event.type==='saved-station-metadata-changed').length,1);
});

test('cached catalog metadata avoids a duplicate request and later saved metadata keeps the newest revision',async()=>{
 const f=fixture({catalog:new Map([['13',station('13','Catalog name','3')]])});await f.loadMetadata(['13']);assert.equal(f.calls.length,0);assert.equal(f.metadata('13').name,'Catalog name');
 f.advance(60000);f.answers.push({stations:[station('13','Renamed station','5')]});await f.loadMetadata(['13']);assert.equal(f.metadata('13').name,'Renamed station');f.catalog.set('13',station('13','Even newer name','6'));assert.equal(f.metadata('13').name,'Even newer name');
});

test('metadata failure has a retry cooldown and cannot erase a usable name or trigger a request loop',async()=>{
 const f=fixture();f.answers.push({stations:[station('13','Saved name')]});await f.loadMetadata(['13']);f.advance(60000);f.answers.push(Error('Network unavailable'));await f.loadMetadata(['13']);await f.loadMetadata(['13']);assert.equal(f.calls.length,2);assert.equal(f.metadata('13').name,'Saved name');
 f.advance(60000);f.answers.push({stations:[station('13','Recovered name','2')]});await f.loadMetadata(['13']);assert.equal(f.calls.length,3);assert.equal(f.metadata('13').name,'Recovered name');
});
