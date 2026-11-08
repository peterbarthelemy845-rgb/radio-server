import {test} from 'node:test';import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';import {runInNewContext} from 'node:vm';
function fixture(){const ids=new Map(),answers=[],calls=[];
 function forget(node){if(node.id&&ids.get(node.id)===node)ids.delete(node.id);for(const child of node.children||[])forget(child);}
 function element(tag='div'){const node={tag,children:[],hidden:false,textContent:'',disabled:false,append(...children){for(const child of children){child.parent=this;this.children.push(child);}},replaceChildren(...children){for(const child of this.children)forget(child);this.children=[];this.append(...children);},remove(){if(this.parent)this.parent.children=this.parent.children.filter(child=>child!==this);forget(this);}};let id='';Object.defineProperty(node,'id',{get(){return id;},set(value){id=value;ids.set(value,node);}});Object.defineProperty(node,'innerHTML',{set(html){for(const match of html.matchAll(/id="([^"]+)"/g)){const child=element();child.id=match[1];node.append(child);}}});return node;}
 for(const name of ['admin','adminStations']){const node=element();node.id=name;}
 const context={document:{createElement:element,getElementById:id=>ids.get(id)},$:id=>ids.get(id),window:{dispatchEvent(){}},MutationObserver:class{observe(){}},CustomEvent:class{},Map,Date,crypto:{randomUUID:()=> 'test-request-000001'},encodeURIComponent,busy(){},api:async(path,body)=>{calls.push({path,body});const answer=answers.shift();if(answer instanceof Error)throw answer;if(answer===undefined)throw Error('Missing fixture response');return answer;}};
 runInNewContext(readFileSync(new URL('./public/assets/admin-tools.js',import.meta.url),'utf8'),context);
 return {answers,calls,load:runInNewContext('loadAdminRequests',context),get:id=>ids.get(id)};
}
const row=(i,kind='support')=>({id:i.toString(16).padStart(32,'0'),kind,state:'new',created_at:1800000000,payload:{name:'Listener',email:'listener@example.com',subject:'Ticket '+i,message:'Help'}});
const text=node=>(node.textContent||'')+(node.children||[]).map(text).join('');
function deferred(){let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return {promise,resolve,reject};}
test('admin queue buttons request server-side kinds and append older pages without replacing existing tickets',async()=>{const f=fixture(),cursor='1800000000:'+row(2).id;
 f.answers.push({requests:[row(2)],has_more:true,next_cursor:cursor});await f.load(true);assert.equal(f.calls[0].path,'/api/admin/legal?kind=support');assert.match(text(f.get('toolRecords')),/Ticket 2/);
 f.answers.push({requests:[row(1)],has_more:false,next_cursor:null});await f.get('adminRequestsMore').onclick();assert.equal(f.calls[1].path,'/api/admin/legal?kind=support&cursor='+encodeURIComponent(cursor));assert.match(text(f.get('toolRecords')),/Ticket 2/);assert.match(text(f.get('toolRecords')),/Ticket 1/);assert.equal(f.get('adminRequestsMore'),undefined);
 f.answers.push({requests:[row(3,'privacy')],has_more:false,next_cursor:null});await f.load(false);assert.equal(f.calls[2].path,'/api/admin/legal?kind=legal');assert.match(text(f.get('toolRecords')),/Legal & other requests/);assert.equal(text(f.get('toolRecords')).includes('Ticket 2'),false);
});
test('double Load more clicks send one request and a failed page can retry without losing existing rows',async()=>{const f=fixture(),cursor='1800000000:'+row(2).id;
 f.answers.push({requests:[row(2)],has_more:true,next_cursor:cursor});await f.load(true);const pending=deferred(),button=f.get('adminRequestsMore');f.answers.push(pending.promise);const first=button.onclick();await button.onclick();assert.equal(f.calls.length,2);pending.reject(Error('Temporary connection failure'));await first;
 assert.equal(button.disabled,false);assert.match(text(f.get('toolRecords')),/Ticket 2/);assert.match(text(f.get('toolsMessage')),/Temporary connection failure/);
 f.answers.push({requests:[row(1)],has_more:false,next_cursor:null});await button.onclick();assert.equal(f.calls.length,3);assert.match(text(f.get('toolRecords')),/Ticket 2/);assert.match(text(f.get('toolRecords')),/Ticket 1/);
});
test('a delayed support result cannot replace the legal queue after changing sections',async()=>{const f=fixture(),pending=deferred();f.answers.push(pending.promise);const old=f.load(true);
 f.answers.push({requests:[row(3,'privacy')],has_more:false,next_cursor:null});await f.load(false);pending.resolve({requests:[row(2)],has_more:true,next_cursor:'1800000000:'+row(2).id});await old;
 assert.match(text(f.get('toolRecords')),/Legal & other requests/);assert.equal(text(f.get('toolRecords')).includes('Ticket 2'),false);assert.equal(f.get('adminRequestsMore'),undefined);
});
