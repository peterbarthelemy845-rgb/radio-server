import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
const source=readFileSync(new URL('./public/assets/operations.js',import.meta.url),'utf8');
function deferred(){let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return {promise,resolve,reject};}
function fixture(){
 const nodes=new Map(),calls=[],answers=[],pages=[],prompts=[];
 function node(tag='div'){
  let identifier='';const value={tag,children:[],style:{},hidden:false,disabled:false,textContent:'',value:'',elements:{},append(...items){this.children.push(...items);},prepend(...items){this.children.unshift(...items);},replaceChildren(...items){this.textContent='';this.children=items;},addEventListener(){},querySelectorAll(tag){return this.children.flatMap(child=>[...(child.tag===tag?[child]:[]),...child.querySelectorAll(tag)]);}};
  Object.defineProperty(value,'id',{get:()=>identifier,set:id=>{identifier=id;nodes.set(id,value);}});return value;
 }
 const $=id=>{if(!nodes.has(id)){const item=node();item.id=id;}return nodes.get(id);};$('advertiseForm').elements.artwork=node('input');const main=node('main');
 const ctx={$ ,document:{createElement:node,querySelector:()=>main},adminTools:node(),page(id){pages.push(id);for(const name of ['reports','backups','admin','editor','login','myRadio'])$(name).hidden=name!==id;},api:async(path,body)=>{calls.push({path,body});if(!answers.length)throw Error('Missing test answer');const answer=answers.shift();if(answer instanceof Error)throw answer;return await answer;},Date,URL,URLSearchParams,location:{pathname:'/',search:''},window:{addEventListener(){}},MutationObserver:class{observe(){}},showAds(){},appPrompt:async(title,text)=>{prompts.push(text);return 'RESTORE';},state:{}};
 runInNewContext(source,ctx);
 return {ctx,nodes,calls,answers,pages,prompts,$,get:expression=>runInNewContext(expression,ctx),reports:runInNewContext('showReports',ctx),backups:runInNewContext('showBackups',ctx),page:runInNewContext('page',ctx)};
}
function report(name,active=1){return {stations:[{name,code:10,active_radios:active,reported_seconds:60,listening_now:1,share_clicks:1}],shares:[],note:'Report note.'};}
function snapshot(id){return {id,state:'ready',kind:'manual',created_at:1800000000,record_count:10,media_count:2};}
const text=node=>node.textContent+node.children.map(text).join('');
test('reports keep the selected month when older responses finish last',async()=>{
 const f=fixture(),november=deferred(),october=deferred();f.answers.push(november.promise,october.promise);f.$('reportMonth').value='2026-11';const first=f.reports(false);f.$('reportMonth').value='2026-10';const latest=f.reports(false);
 assert.equal(f.calls[0].path,'/api/owner/reports?month=2026-11');assert.equal(f.calls[1].path,'/api/owner/reports?month=2026-10');october.resolve(report('October station',10));assert.equal(await latest,true);const current=f.$('reportResults').children;november.resolve(report('November station',99));assert.equal(await first,false);assert.equal(f.$('reportMonth').value,'2026-10');assert.equal(f.$('reportResults').children,current);assert.match(text(f.$('reportResults')),/October station/);assert.doesNotMatch(text(f.$('reportResults')),/November station/);
});
test('late admin reports cannot replace an owner report or change its Back target',async()=>{
 const f=fixture(),admin=deferred(),owner=deferred();f.answers.push(admin.promise,owner.promise);const old=f.reports(true),current=f.reports(false);owner.resolve(report('Owner station'));await current;admin.resolve(report('Private administrator station'));await old;assert.equal(f.get('adminReport'),false);assert.match(text(f.$('reportResults')),/Owner station/);assert.doesNotMatch(text(f.$('reportResults')),/Private administrator/);f.$('reportsBack').onclick();assert.equal(f.pages.at(-1),'editor');
});
test('old private reports are cleared immediately when leaving or starting another request',async()=>{
 const f=fixture();f.answers.push(report('Private admin report'));await f.reports(true);assert.match(text(f.$('reportResults')),/Private admin report/);f.page('admin');assert.equal(f.$('reportResults').children.length,0);assert.equal(f.$('reportMessage').textContent,'');f.page('login');
 const pending=deferred();f.answers.push(pending.promise);const opening=f.reports(false);assert.equal(f.$('reportResults').children.length,0);pending.reject(Error('Owner report unavailable'));await opening;assert.equal(f.$('reportResults').children.length,0);assert.match(f.$('reportMessage').textContent,/Owner report unavailable/);
 f.answers.push(report('Old month'));await f.reports(false);const month=deferred();f.answers.push(month.promise);f.$('reportMonth').value='2026-09';const changing=f.reports(false);assert.equal(f.$('reportResults').children.length,0);month.resolve(report('New month'));await changing;
});
test('an abandoned report response or error cannot refill private content or another page message',async()=>{
 for(const failed of [false,true]){const f=fixture(),pending=deferred();f.answers.push(pending.promise);const request=f.reports(true);f.page('myRadio');if(failed)pending.reject(Error('Old report error'));else pending.resolve(report('Private report'));await request;assert.equal(f.pages.at(-1),'myRadio');assert.equal(f.$('reports').hidden,true);assert.equal(f.$('reportResults').children.length,0);assert.equal(f.$('reportMessage').textContent,'');}
});
test('new backup lists supersede older lists and leaving clears private snapshot details',async()=>{
 const f=fixture(),old=deferred(),fresh=deferred();f.answers.push(old.promise,fresh.promise);const first=f.backups(),latest=f.backups();fresh.resolve({backups:[snapshot('new')],note:'Fresh'});await latest;const current=f.$('backupRecords').children;old.resolve({backups:[snapshot('old')],note:'Old'});assert.equal(await first,false);assert.equal(f.$('backupRecords').children,current);assert.equal(f.$('backupMessage').textContent,'Fresh');f.page('admin');assert.equal(f.$('backupRecords').children.length,0);assert.equal(f.$('backupMessage').textContent,'');
 const pending=deferred();f.answers.push(pending.promise);const opening=f.backups();f.page('myRadio');pending.resolve({backups:[snapshot('late')],note:'Late'});await opening;assert.equal(f.$('backupRecords').children.length,0);assert.equal(f.$('backupMessage').textContent,'');
});
test('a backup creation completing after navigation cannot reopen Backup or start a refresh',async()=>{
 for(const failed of [false,true]){const f=fixture();f.answers.push({backups:[],note:'Ready'});await f.backups();const pending=deferred();f.answers.push(pending.promise);const creating=f.$('createBackup').onclick();assert.equal(f.$('createBackup').disabled,true);f.page('myRadio');if(failed)pending.reject(Error('Old creation error'));else pending.resolve({status:'ok'});await creating;assert.equal(f.pages.at(-1),'myRadio');assert.equal(f.calls.length,2);assert.equal(f.$('backupMessage').textContent,'');assert.equal(f.$('createBackup').disabled,false);assert.equal(f.get('backupActionPending'),false);}
});
test('restore is single-flight and stale completion does not write after navigation',async()=>{
 const f=fixture();f.answers.push({backups:[snapshot('first'),snapshot('second')],note:'Ready'});await f.backups();const [first,second]=f.$('backupRecords').querySelectorAll('button'),pending=deferred();f.answers.push(pending.promise);const restoring=first.onclick();await second.onclick();await f.$('createBackup').onclick();assert.equal(f.calls.length,2);assert.equal(f.prompts.length,1);assert.equal(first.disabled,true);assert.equal(second.disabled,true);assert.equal(f.$('createBackup').disabled,true);f.page('myRadio');pending.resolve({message:'Restored private snapshot'});await restoring;assert.equal(f.pages.at(-1),'myRadio');assert.equal(f.$('backupRecords').children.length,0);assert.equal(f.$('backupMessage').textContent,'');assert.equal(f.$('createBackup').disabled,false);await first.onclick();assert.equal(f.calls.length,2);
});
test('restore failure restores visible controls and allows a deliberate retry',async()=>{
 const f=fixture();f.answers.push({backups:[snapshot('first'),snapshot('second')],note:'Ready'});await f.backups();const buttons=f.$('backupRecords').querySelectorAll('button');f.answers.push(Error('Restore unavailable'));await buttons[0].onclick();assert.match(f.$('backupMessage').textContent,/Restore unavailable/);assert.equal(f.$('createBackup').disabled,false);assert.equal(buttons.every(button=>!button.disabled),true);f.answers.push({message:'Restored.'});await buttons[0].onclick();assert.equal(f.calls.filter(call=>call.body?.action==='restore').length,2);assert.equal(f.$('backupMessage').textContent,'Restored.');
});

test('abandoning an async RESTORE sheet cannot start a backup mutation on another page',async()=>{
 const f=fixture(),decision=deferred();f.answers.push({backups:[snapshot('first')],note:'Ready'});await f.backups();f.ctx.appPrompt=async()=>decision.promise;const pending=f.$('backupRecords').querySelectorAll('button')[0].onclick();assert.equal(f.get('backupActionPending'),true);f.page('myRadio');decision.resolve('RESTORE');await pending;assert.equal(f.calls.length,1);assert.equal(f.get('backupActionPending'),false);assert.equal(f.$('backupMessage').textContent,'');
});
test('a newer backup view stays locked during an existing creation and is not overwritten afterward',async()=>{
 const f=fixture();f.answers.push({backups:[],note:'Ready'});await f.backups();const pending=deferred();f.answers.push(pending.promise);const creating=f.$('createBackup').onclick();f.answers.push({backups:[snapshot('latest')],note:'Latest list'});await f.backups();const restore=f.$('backupRecords').querySelectorAll('button')[0];assert.equal(restore.disabled,true);await restore.onclick();assert.equal(f.calls.length,3);pending.resolve({status:'ok'});await creating;assert.equal(f.calls.length,3);assert.equal(f.$('backupMessage').textContent,'Latest list');assert.equal(restore.disabled,false);
});
