import {test} from 'node:test';import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';import vm from 'node:vm';
const source=readFileSync(new URL('./public/assets/pwa-offline.js',import.meta.url),'utf8');
function fixture({saved,blocked=false,path='/wifi-setup',language='en-US'}={}){
 const writes=[],nodes=new Map(),labels=['language','title','connect','radio','wifi','step1','step2','step3','step4','local','localHint','retry'].map(key=>({dataset:{offline:key},textContent:''}));let reloads=0;
 for(const id of ['offlineLanguage','offlineRetry','offlineWifi'])nodes.set(id,{value:'',events:{},addEventListener(name,fn){this.events[name]=fn;}});
 const document={documentElement:{lang:'en'},getElementById:id=>nodes.get(id),querySelectorAll:()=>labels,title:''};
 vm.runInNewContext(source,{document,navigator:{language},location:{pathname:path,reload(){reloads++;}},localStorage:{getItem(key){assert.equal(key,'radioLocalsLanguage');if(blocked)throw Error('blocked');return saved;},setItem(key,value){if(blocked)throw Error('blocked');writes.push([key,value]);}}});
 return {document,nodes,labels,writes,reloads:()=>reloads};
}
test('offline Wi-Fi help remains available in saved Haitian Creole without API, credentials or private content',()=>{
 const f=fixture({saved:'ht'});assert.equal(f.document.documentElement.lang,'ht');assert.equal(f.document.title,'Pa konekte — Radio Locals');assert.equal(f.nodes.get('offlineWifi').open,true);assert.match(f.labels.find(n=>n.dataset.offline==='step3').textContent,/modpas Wi-Fi/);assert.match(f.labels.find(n=>n.dataset.offline==='localHint').textContent,/sèlman/);assert.equal(f.writes.length,0);
 f.nodes.get('offlineRetry').events.click();assert.equal(f.reloads(),1);
});
test('offline language switch is reversible and stores only its language preference',()=>{
 const f=fixture({path:'/admin'}),picker=f.nodes.get('offlineLanguage');assert.equal(f.document.documentElement.lang,'en');assert.equal(f.nodes.get('offlineWifi').open,undefined);picker.value='ht';picker.events.change();assert.equal(f.document.documentElement.lang,'ht');picker.value='en';picker.events.change();assert.equal(f.labels.find(n=>n.dataset.offline==='title').textContent,'You’re offline');assert.deepEqual(f.writes,[['radioLocalsLanguage','ht'],['radioLocalsLanguage','en']]);
});
test('offline help still works when preference storage is blocked or contains an invalid value',()=>{
 const f=fixture({blocked:true,language:'ht-HT'});assert.equal(f.document.documentElement.lang,'ht');const picker=f.nodes.get('offlineLanguage');picker.value='en';assert.doesNotThrow(()=>picker.events.change());assert.equal(f.document.documentElement.lang,'en');assert.equal(fixture({saved:'private-data',language:'en'}).document.documentElement.lang,'en');
});
