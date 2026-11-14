import {test} from 'node:test';import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';import {runInNewContext} from 'node:vm';
const source=readFileSync(new URL('./public/assets/feature-loader.js',import.meta.url),'utf8');
const tick=async()=>{for(let i=0;i<8;i++)await Promise.resolve();};
function fixture(){const appended=[],events=[],ctx={document:{createElement(tag){return {tag,removed:false,remove(){this.removed=true;}};},head:{append(element){appended.push(element);}}},window:{dispatchEvent(event){events.push(event.type);}},Event:class{constructor(type){this.type=type;}},Promise,Map,Object,Error};runInNewContext(source,ctx);
 async function finish(){for(let turn=0;turn<30;turn++){await tick();const pending=appended.filter(element=>!element.completed&&!element.removed);if(!pending.length){await tick();if(!appended.some(element=>!element.completed&&!element.removed))return;}for(const element of pending){element.completed=true;element.onload();}}throw Error('Feature loader did not settle');}
 return {ctx,appended,events,load:ctx.window.loadAppFeature,finish,tick,path:element=>element.src||element.href};}
test('features load styles first, then execute their scripts in declared order, with one shared promise',async()=>{
 const f=fixture(),request=f.load('owner');assert.equal(f.load('owner'),request);assert.equal(f.appended.length,5);assert.ok(f.appended.every(element=>element.tag==='link'));const css=f.appended.slice();css[0].completed=true;css[0].onload();await f.tick();assert.equal(f.appended.length,css.length);
 for(const element of css.slice(1)){element.completed=true;element.onload();}await f.tick();assert.equal(f.path(f.appended[css.length]),'/assets/action-prompts.js');assert.equal(f.appended[css.length].async,false);assert.equal(f.appended.length,css.length+1);await f.finish();await request;
 assert.deepEqual(f.appended.filter(element=>element.tag==='script').map(f.path),['action-prompts.js','stream-test-feedback.js','registration-form.js','editor-stream-setup.js','editor-stream-test.js','owner-station-metadata.js','owner-editor-simplicity.js','owner-stream-publication.js','station-code-recovery.js','policy-preview.js','ads.js','operations.js','owner-session-warning.js'].map(file=>'/assets/'+file));assert.deepEqual(f.events,['app-content-changed']);
 const count=f.appended.length;await f.load('owner');assert.equal(f.appended.length,count);
});
test('simultaneous overlapping features fetch each application-owned asset only once',async()=>{
 const f=fixture(),requests=[f.load('admin'),f.load('advertise'),f.load('owner')];await f.finish();await Promise.all(requests);const paths=f.appended.map(f.path);for(const path of new Set(paths))assert.equal(paths.filter(value=>value===path).length,1,path);assert.equal(paths.filter(path=>path==='/assets/ads.js').length,1);assert.equal(paths.filter(path=>path==='/assets/operations.css').length,1);assert.equal(f.events.length,3);
});
test('a failed specialized script can retry without rerunning already loaded scripts or stylesheet requests',async()=>{
 const f=fixture(),first=f.load('support');for(const style of f.appended.slice()){style.completed=true;style.onload();}await f.tick();const failed=f.appended.find(element=>element.tag==='script');failed.onerror();await assert.rejects(first,/could not load/);await f.tick();assert.equal(failed.removed,true);const retry=f.load('support');await f.finish();await retry;assert.equal(f.appended.filter(element=>element.tag==='link').length,2);assert.equal(f.appended.filter(element=>element.src==='/assets/support-status.js').length,2);assert.deepEqual(f.events,['app-content-changed']);
});
test('a failed stylesheet retries only that file and blocks specialized script execution until styles recover',async()=>{
 const f=fixture(),first=f.load('owner');f.appended[0].onerror();await assert.rejects(first,/could not load/);await f.tick();const retry=f.load('owner');await f.tick();assert.equal(f.appended.filter(element=>element.tag==='script').length,0);assert.equal(f.appended.filter(element=>element.tag==='link').length,6);await f.finish();await retry;assert.equal(f.events.length,1);
});
test('unknown and prototype feature names cannot inject a URL or trigger network activity',async()=>{
 const f=fixture();for(const name of ['https://attacker.example/script.js','../admin','__proto__','constructor','toString','owner.js',null])await assert.rejects(f.load(name),/Unknown website feature/);assert.equal(f.appended.length,0);assert.equal(f.events.length,0);
});
test('optional AI assets cannot prevent the ordinary support tools from loading',async()=>{
 const f=fixture(),request=f.load('support');
 for(const element of f.appended.slice()){element.completed=true;if(f.path(element).includes('support-chat'))element.onerror();else element.onload();}
 await f.tick();const status=f.appended.find(element=>element.src==='/assets/support-status.js');status.completed=true;status.onload();await f.tick();
 const chat=f.appended.find(element=>element.src==='/assets/support-chat.js');chat.completed=true;chat.onerror();await f.finish();await request;assert.deepEqual(f.events,['app-content-changed']);
});
