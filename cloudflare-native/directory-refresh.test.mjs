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
 const ids=new Map(),calls=[],answers=[],events={},rendered=[],ready=[],messages=[],community=[];let now=100000;
 function node(id){if(!ids.has(id))ids.set(id,{hidden:false,textContent:'',onclick:null});return ids.get(id);}
 const ctx={Date:{now:()=>now},Promise,Array,Event:class{constructor(type){this.type=type;}},location:{pathname,hash},window:{addEventListener(type,handler){events[type]=handler;},dispatchEvent(event){ready.push(event.type);}},$:node,message(text){messages.push(text);},list(){rendered.push(runInNewContext('stations',ctx));},api:async(path,body,options)=>{calls.push({path,body,options});if(!answers.length)throw Error('Missing directory fixture response');return await answers.shift();},loadOwnerSession:async()=>{runInNewContext('state={csrf:"csrf",owner_station:null}',ctx);return {csrf:'csrf',owner_station:null};},editor:async()=>{throw Error('Unexpected editor access');},adminList:async()=>{throw Error('Unexpected admin access');},openShared:async()=>{},initCommunity:async()=>{community.push(pathname);}};
 runInNewContext('let stations=[],state,sitePageGeneration=0;',ctx);runInNewContext(directorySource,ctx);runInNewContext(pageSource,ctx);runInNewContext(startupSource,ctx);
 return {ctx,ids,calls,answers,events,rendered,ready,messages,community,advance(ms){now+=ms;},get:expression=>runInNewContext(expression,ctx),refresh:runInNewContext('refreshStationDirectory',ctx),page:runInNewContext('page',ctx),start:runInNewContext('initializeSite',ctx)};
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
