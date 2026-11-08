import {test} from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';

const source=readFileSync(new URL('./public/assets/site.js',import.meta.url),'utf8');
function deferred(){let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return {promise,resolve,reject};}
function fixture(){
 const nodes=new Map(),fetches=[],posts=[],answers=[];let humanValue='checked';
 const node=id=>{if(nodes.has(id))return nodes.get(id);const item={id,hidden:false,textContent:'',innerHTML:'',value:'',checked:false,disabled:false,dataset:{},setAttribute(){},removeAttribute(){},dispatchEvent(){},querySelectorAll(){return Object.values(this.elements||{}).concat(this.button||[]);}};nodes.set(id,item);return item;};
 const form=node('legalForm');form.elements={};for(const name of ['kind','name','email','message','address','phone','work','location','signature','good_faith','authority'])form.elements[name]={name,value:name==='kind'?'privacy':name==='email'?'owner@example.com':'Original '+name,checked:true,disabled:false};form.button={disabled:false};
 class FormDataFixture{constructor(target){this.entries=Object.values(target.elements).filter(field=>!field.disabled).map(field=>[field.name,field.value]);}[Symbol.iterator](){return this.entries[Symbol.iterator]();}}
 const context=vm.createContext({$:node,FormData:FormDataFixture,Event:class{},fetch(){const next=deferred();fetches.push(next);return next.promise;},human:async()=>humanValue,api:async(path,body)=>{posts.push({path,body});const answer=answers.shift();if(answer instanceof Error)throw answer;return await answer;},__node:node});
 vm.runInContext("let sitePageGeneration=0,currentPage='myRadio';function page(id){sitePageGeneration++;currentPage=id;}",context);
 vm.runInContext(source.slice(source.indexOf('const formBusyStates='),source.indexOf('function loadHuman()')),context);
 vm.runInContext(source.slice(source.indexOf('async function showLegal('),source.indexOf('async function initCommunity(')),context);
 return {context,nodes,node,form,posts,answers,fetches,open(kind){context.kind=kind;return vm.runInContext('showLegal(kind)',context);},page(id){context.nextPage=id;vm.runInContext('page(nextPage)',context);},current(){return vm.runInContext('currentPage',context);},submit(){return form.onsubmit({preventDefault(){},target:form});},human(value){humanValue=value;}};
}
const policies={privacy:['Privacy','<p>Privacy policy</p>'],terms:['Terms','<p>Station terms</p>'],'counter-notice':['Counter notice','<p>Counter policy</p>']};
const response=()=>({ok:true,async json(){return policies;}});
async function flush(){for(let i=0;i<10;i++)await Promise.resolve();}

test('a policy fetch cannot reopen its page after navigation or replace a newer policy',async()=>{
 const f=fixture(),old=f.open('privacy');f.page('myRadio');f.fetches[0].resolve(response());await old;assert.equal(f.current(),'myRadio');assert.equal(f.node('legalTitle').textContent,'');
 const first=f.open('privacy'),last=f.open('terms');f.fetches[2].resolve(response());await last;f.fetches[1].resolve(response());await first;assert.equal(f.current(),'legal');assert.equal(f.node('legalTitle').textContent,'Terms');assert.equal(f.form.hidden,true);
});

test('an old policy failure is ignored after leaving but a current failure remains visible to its caller',async()=>{
 const f=fixture(),old=f.open('privacy');f.page('support');f.fetches[0].reject(Error('Old connection error'));await old;assert.equal(f.current(),'support');const current=f.open('terms');f.fetches[1].resolve({ok:false});await assert.rejects(current,/Policy page is unavailable/);
});

test('legal submission snapshots and freezes fields, suppresses duplicates and preserves a failed draft',async()=>{
 const f=fixture(),pending=deferred();f.page('legal');f.answers.push(pending.promise);const first=f.submit();await flush();assert.equal(f.form.elements.email.disabled,true);assert.equal(f.form.button.disabled,true);await f.submit();assert.equal(f.posts.length,1);assert.equal(f.posts[0].body.email,'owner@example.com');assert.equal(f.posts[0].body.kind,'privacy');pending.reject(Error('Request interrupted'));await first;assert.equal(f.form.elements.message.value,'Original message');assert.equal(f.form.elements.message.disabled,false);assert.equal(f.form.button.disabled,false);assert.equal(f.node('legalMessage').textContent,'Request interrupted');
});

test('leaving during the bot check prevents an unsent legal request and late receipts cannot change another view',async()=>{
 const f=fixture(),check=deferred();f.page('legal');f.human(check.promise);const waiting=f.submit();await flush();f.page('myRadio');check.resolve('checked');await waiting;assert.equal(f.posts.length,0);assert.equal(f.node('legalMessage').textContent,'');
 f.human('checked');f.page('legal');const answer=deferred();f.answers.push(answer.promise);const sent=f.submit();await flush();assert.equal(f.posts.length,1);f.page('support');answer.resolve({message:'Request received.',reference:'private-reference'});await sent;assert.equal(f.current(),'support');assert.equal(f.form.hidden,false);assert.equal(f.node('legalMessage').textContent,'');
});
