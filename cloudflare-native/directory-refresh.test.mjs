import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
const source=readFileSync(new URL('./public/assets/site.js',import.meta.url),'utf8');
const directorySource=source.slice(source.indexOf('// Refresh the public directory'),source.indexOf('async function loadSupport()'));
const pageSource=source.slice(source.indexOf('function page('),source.indexOf('function message('));
const startupSource=source.slice(source.indexOf('async function initializeSite()'),source.indexOf('void initializeSite();'));
function deferred(){let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return {promise,resolve,reject};}
function fixture({pathname='/',hash='#radio'}={}){
 const ids=new Map(),calls=[],answers=[],events={},rendered=[],ready=[],messages=[],community=[],timers=new Map();let now=100000,timerId=0;
 function node(id){if(!ids.has(id))ids.set(id,{hidden:false,textContent:'',onclick:null});return ids.get(id);}
 const ctx={Date:{now:()=>now},Promise,Array,AbortController,setTimeout(fn,delay){const id=++timerId;timers.set(id,{fn,delay});return id;},clearTimeout(id){timers.delete(id);},document:{readyState:'complete'},Event:class{constructor(type){this.type=type;}},location:{pathname,hash},window:{addEventListener(type,handler){events[type]=handler;},dispatchEvent(event){ready.push(event.type);}},$:node,message(text){messages.push(text);},list(){const items=runInNewContext('stations',ctx);if(JSON.stringify(rendered.at(-1))!==JSON.stringify(items))rendered.push(items);},api:async(path,body,options)=>{calls.push({path,body,options});if(!answers.length)throw Error('Missing directory fixture response');return await answers.shift();},loadOwnerSession:async()=>{runInNewContext('state={csrf:"csrf",owner_station:null}',ctx);return {csrf:'csrf',owner_station:null};},editor:async()=>{throw Error('Unexpected editor access');},adminList:async()=>{throw Error('Unexpected admin access');},openShared:async()=>{},initCommunity:async()=>{community.push(pathname);}};
 runInNewContext('let stations=[],state,sitePageGeneration=0,verificationId=null;function invalidateOwnerVerification(){throw Error("Owner verification is outside this directory fixture");}',ctx);runInNewContext(directorySource,ctx);runInNewContext(pageSource,ctx);runInNewContext(startupSource,ctx);
 return {ctx,ids,calls,answers,events,rendered,ready,messages,community,timers,advance(ms){now+=ms;},get:expression=>runInNewContext(expression,ctx),refresh:runInNewContext('refreshStationDirectory',ctx),search:runInNewContext('searchStationDirectory',ctx),more:runInNewContext('loadMoreStationDirectory',ctx),async flushSearch(){for(const [id,timer] of [...timers]){timers.delete(id);timer.fn();}return await runInNewContext('stationDirectoryRequest?.promise',ctx);},page:runInNewContext('page',ctx),start:runInNewContext('initializeSite',ctx)};
}
test('directory requests share one in-flight refresh and bypass the browser cache',async()=>{
 const f=fixture(),pending=deferred();f.answers.push(pending.promise);
 const first=f.refresh(),second=f.refresh();assert.equal(first,second);assert.equal(f.calls.length,1);assert.equal(f.calls[0].options.cache,'no-store');
 pending.resolve({stations:[{code:'10',name:'First'}]});await first;assert.equal(f.get('stations[0].name'),'First');assert.equal(f.rendered.length,1);assert.equal(f.ids.get('stationDirectoryStatus').hidden,true);
});
test('forced mutation refresh wins even when an older request finishes last',async()=>{
 const f=fixture(),old=deferred(),fresh=deferred();f.answers.push(old.promise,fresh.promise);
 const initial=f.refresh(),forced=f.refresh(true);assert.equal(f.calls.length,2);assert.equal(f.refresh(),forced);
 fresh.resolve({stations:[{code:'11',name:'Published station'}]});await forced;
 old.resolve({stations:[{code:'10',name:'Removed station'}]});await initial;
 assert.equal(f.get('stations[0].name'),'Published station');assert.equal(f.rendered.length,1);
});
test('a superseded failure cannot replace the current directory with an error',async()=>{
 const f=fixture(),old=deferred(),fresh=deferred();f.answers.push(old.promise,fresh.promise);const first=f.refresh(),latest=f.refresh(true);
 fresh.resolve({stations:[{code:'11'}]});await latest;old.reject(Error('Old network error'));await first;
 assert.equal(f.ids.get('stationDirectoryStatus').hidden,true);assert.equal(f.get('stations[0].code'),'11');
});
test('failure keeps existing cards and offers an immediate retry despite the refresh TTL',async()=>{
 const f=fixture();f.answers.push({stations:[{code:'10'}]});await f.refresh();f.advance(31000);const failed=deferred();f.answers.push(failed.promise);const request=f.refresh();failed.reject(Error('Temporary failure'));await request;
 assert.equal(f.get('stations[0].code'),'10');assert.equal(f.rendered.length,1);assert.equal(f.ids.get('stationDirectoryStatus').hidden,false);assert.match(f.ids.get('stationDirectoryMessage').textContent,/Showing the last loaded list/);
 await f.refresh();assert.equal(f.calls.length,2);
 f.answers.push({stations:[{code:'12'}]});await f.ids.get('retryStationDirectory').onclick();assert.equal(f.calls.length,3);assert.equal(f.get('stations[0].code'),'12');assert.equal(f.ids.get('stationDirectoryStatus').hidden,true);
});
test('returning to Radio refreshes stale stations without fetching on every navigation',async()=>{
 const f=fixture();f.answers.push({stations:[{code:'10'}]});f.page('library');await f.refresh();f.page('login');f.advance(10000);f.page('myRadio');assert.equal(f.calls.length,1);
 f.advance(21000);f.answers.push({stations:[{code:'11'}]});f.page('login');f.page('myRadio');await f.refresh();assert.equal(f.calls.length,2);assert.equal(f.get('stations[0].code'),'11');
});
test('directory failure cannot prevent support initialization or the radio-ready event',async()=>{
 const f=fixture({pathname:'/support',hash:''});const failed=deferred();f.answers.push(failed.promise);const startup=f.start();failed.reject(Error('Directory unavailable'));await startup;
 assert.equal(f.community.length,1);assert.deepEqual(f.ready,['radio-locals-ready']);assert.match(f.ids.get('stationDirectoryMessage').textContent,/Stations could not load/);assert.equal(f.get('state.csrf'),'csrf');
});
test('session failure closes authenticated initialization but still starts independent features',async()=>{
 const f=fixture({pathname:'/station-edit',hash:''});runInNewContext('state={owner_station:"10"}',f.ctx);f.ctx.loadOwnerSession=async()=>{throw Error('Session unavailable');};f.answers.push({stations:[]});await f.start();
 assert.equal(f.get('state'),undefined);assert.equal(f.community.length,1);assert.deepEqual(f.ready,['radio-locals-ready']);assert.match(f.messages.join(' '),/Session unavailable/);
});

test('directory starts with a bounded page and appends unique stations using its cursor',async()=>{
 const f=fixture();f.answers.push({stations:[{listener_code:'13',name:'First'}],has_more:true,next_cursor:'page-two'});await f.refresh();
 assert.equal(f.calls[0].path,'/api/stations?limit=50&q=');assert.equal(f.ids.get('loadMoreStations').hidden,false);
 const pending=deferred();f.answers.push(pending.promise);const first=f.more(),duplicate=f.more();assert.equal(first,duplicate);assert.equal(f.calls.length,2);assert.equal(f.ids.get('loadMoreStations').disabled,true);
 pending.resolve({stations:[{listener_code:'13',name:'Updated first'},{listener_code:'14',name:'Second'}],has_more:false,next_cursor:null});await first;
 assert.equal(f.calls[1].path,'/api/stations?limit=50&q=&cursor=page-two');assert.deepEqual(Array.from(f.get('stations'),s=>s.listener_code),['13','14']);assert.equal(f.get('stations[0].name'),'Updated first');assert.equal(f.ids.get('loadMoreStations').hidden,true);
 f.advance(31000);await f.refresh();assert.equal(f.calls.length,2,'background polling does not reset an expanded list');
});

test('server searches debounce rapid typing, fold accents and accept a pasted # station code',async()=>{
 const f=fixture();f.search('Morning');f.search(' ÉTOILE ');assert.equal(f.calls.length,0);assert.equal(f.timers.size,1);assert.equal([...f.timers.values()][0].delay,250);
 f.answers.push({stations:[{listener_code:'13',name:'Radio Étoile'}],has_more:false});await f.flushSearch();assert.equal(f.calls[0].path,'/api/stations?limit=50&q=etoile');assert.equal(f.get('stationDirectoryState.loadedQuery'),'etoile');
 f.search(' # 13 ');f.answers.push({stations:[{listener_code:'13',name:'Radio Étoile'}]});await f.flushSearch();assert.equal(f.calls[1].path,'/api/stations?limit=50&q=13');
 f.search('13');assert.equal(f.timers.size,0,'equivalent normalized searches do not refetch');
});

test('changing search invalidates an older response before the debounce expires',async()=>{
 const f=fixture(),old=deferred();f.answers.push(old.promise);const first=f.refresh();f.search('News');assert.equal(f.calls[0].options.signal.aborted,true);
 old.resolve({stations:[{listener_code:'10',name:'Old result'}],has_more:true,next_cursor:'old'});await first;assert.equal(f.get('stations.length'),0);assert.equal(f.get('stationDirectoryState.loading'),true);
 f.answers.push({stations:[{listener_code:'14',name:'News'}],has_more:false});await f.flushSearch();assert.equal(f.get('stations[0].name'),'News');assert.equal(f.get('stationDirectoryState.hasMore'),false);
});

test('sparse searches stop after five bounded pages and More continues from the preserved cursor',async()=>{
 const f=fixture();f.search('rare');for(let n=1;n<=5;n++)f.answers.push({stations:[],has_more:true,next_cursor:'scan-'+n});await f.flushSearch();
 assert.equal(f.calls.length,5);assert.equal(f.get('stationDirectoryState.hasMore'),true);assert.equal(f.get('stationDirectoryState.cursor'),'scan-5');assert.equal(f.ids.get('loadMoreStations').hidden,false);assert.equal(f.get('stationDirectoryState.failed'),false);
 f.answers.push({stations:[{listener_code:'99',name:'Rare radio'}],has_more:false});await f.more();assert.match(f.calls[5].path,/cursor=scan-5$/);assert.equal(f.get('stations[0].name'),'Rare radio');assert.equal(f.ids.get('loadMoreStations').hidden,true);
});

test('station metadata survives a different search while a stale response cannot pollute the cache',async()=>{
 const f=fixture();f.answers.push({stations:[{listener_code:'13',name:'Local Radio',logo_thumb_url:'/artwork/local.png?size=192'}]});await f.refresh();
 const old=deferred();f.answers.push(old.promise);const stale=f.refresh(true);f.search('News');f.answers.push({stations:[{listener_code:'14',name:'News'}]});await f.flushSearch();old.resolve({stations:[{listener_code:'15',name:'Stale'}]});await stale;
 assert.equal(f.get('stations.length'),1);assert.equal(f.get('getStationDirectoryStation("13").name'),'Local Radio');assert.equal(f.get('getStationDirectoryStation("15")'),undefined);assert.equal(f.get('getStationDirectoryStation("13").logo_thumb_url'),'/artwork/local.png?size=192');
});

test('a repeated cursor stops scanning safely and keeps the last usable page',async()=>{
 const f=fixture();f.answers.push({stations:[{listener_code:'13',name:'Local'}],has_more:true,next_cursor:'repeat'});await f.refresh();f.answers.push({stations:[],has_more:true,next_cursor:'repeat'});await f.more();
 assert.equal(f.calls.length,2);assert.equal(f.get('stations[0].name'),'Local');assert.equal(f.get('stationDirectoryState.cursor'),'repeat');assert.equal(f.get('stationDirectoryState.failed'),true);assert.equal(f.ids.get('loadMoreStations').disabled,false);
});
