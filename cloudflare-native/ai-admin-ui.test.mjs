import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';

function fixture({grant=null}={}){
 const calls=[],answers=[],admin={hidden:false};
 function element(tag='div'){
  const node={tag,children:[],textContent:'',className:'',value:'',dataset:{},disabled:false,isConnected:true,events:[],attributes:{},
   append(...nodes){for(const child of nodes){if(child.parent)child.parent.children=child.parent.children.filter(old=>old!==child);child.parent=this;this.children.push(child);}},replaceChildren(...nodes){this.children=[];this.append(...nodes);},
   insertBefore(child,anchor){if(child.parent)child.parent.children=child.parent.children.filter(old=>old!==child);child.parent=this;const at=this.children.indexOf(anchor);if(at<0)this.children.push(child);else this.children.splice(at,0,child);},
   before(child){const at=this.parent.children.indexOf(this);child.parent=this.parent;this.parent.children.splice(at,0,child);},
   setAttribute(key,value){this.attributes[key]=value;},dispatchEvent(event){this.events.push(event);},focus(){this.focused=true;},
   querySelectorAll(selector){const all=[];const visit=n=>{for(const child of n.children){all.push(child);visit(child);}};visit(this);return all.filter(child=>selector==='[data-ai-ticket-id]'?!!child.dataset.aiTicketId:selector.startsWith('.')?child.className.split(' ').includes(selector.slice(1)):child.tag===selector);},
   querySelector(selector){return this.querySelectorAll(selector)[0]||null;}
  };
  Object.defineProperty(node,'parentElement',{get(){return node.parent;}});Object.defineProperty(node,'nextSibling',{get(){if(!node.parent)return null;return node.parent.children[node.parent.children.indexOf(node)+1]||null;}});
  node.classList={add(value){node.className+=' '+value;}};return node;
 }
 const window={},confirmations=[];let confirmed=true;
 const context={document:{createElement:element,getElementById:id=>id==='admin'?admin:id==='adminStations'?grant:null},window,Object,Event:class{constructor(type,options){this.type=type;this.bubbles=options?.bubbles;}},api:async(path,body)=>{calls.push({path,body});const answer=answers.shift();if(answer instanceof Error)throw answer;if(answer===undefined)throw Error('Missing response');return answer;},appConfirm:async(...args)=>{confirmations.push(args);return confirmed;}};
 runInNewContext(readFileSync(new URL('./public/assets/ai-admin.js',import.meta.url),'utf8'),context);
 const host=element('article'),replyInput=element('textarea');
 return {window,host,replyInput,answers,calls,admin,confirmations,confirm(value){confirmed=value;},element};
}
const all=node=>[node,...node.children.flatMap(all)],text=node=>node.textContent+node.children.map(text).join('');
const button=(f,label)=>all(f.host).find(node=>node.tag==='button'&&node.textContent===label);
const suggestion={data:{category:'wifi',priority:'normal',summary:'Wi-Fi help needed',draft:'Open Settings, then Wi-Fi.',needs_human:true},cache_hit:false};
function deferred(){let resolve;const promise=new Promise(yes=>resolve=yes);return {promise,resolve};}

test('organizing a ticket only generates a private suggestion; using a draft never submits or sends it',async()=>{
 const f=fixture();f.window.aiAdmin.mountTicket({host:f.host,ticketId:'b'.repeat(32),replyInput:f.replyInput});
 f.answers.push(suggestion);await button(f,'Organize ticket & draft reply').onclick();
 assert.equal(f.calls.length,1);assert.equal(f.calls[0].path,'/api/admin/ai/ticket');assert.equal(f.calls[0].body.ticket_id,'b'.repeat(32));assert.equal(f.replyInput.value,'');
 assert.match(text(f.host),/Nothing is sent/);await button(f,'Use this draft').onclick();
 assert.equal(f.replyInput.value,suggestion.data.draft);assert.equal(f.replyInput.events.at(-1).type,'input');assert.equal(f.calls.length,1);assert.equal(f.replyInput.focused,true);
});

test('the AI draft cannot overwrite an existing manual draft without confirmation',async()=>{
 const f=fixture();f.replyInput.value='My manual reply';f.window.aiAdmin.mountTicket({host:f.host,ticketId:'b'.repeat(32),replyInput:f.replyInput});f.answers.push(suggestion);
 await button(f,'Organize ticket & draft reply').onclick();f.confirm(false);await button(f,'Use this draft').onclick();assert.equal(f.replyInput.value,'My manual reply');assert.equal(f.confirmations.length,1);
 f.confirm(true);await button(f,'Use this draft').onclick();assert.equal(f.replyInput.value,suggestion.data.draft);assert.equal(f.calls.length,1);
});

test('late ticket suggestions are discarded after leaving the administrator view',async()=>{
 const f=fixture(),pending=deferred();f.window.aiAdmin.mountTicket({host:f.host,ticketId:'b'.repeat(32),replyInput:f.replyInput});f.answers.push(pending.promise);
 const action=button(f,'Organize ticket & draft reply').onclick();f.admin.hidden=true;pending.resolve(suggestion);await action;
 assert.equal(button(f,'Use this draft'),undefined);assert.equal(text(f.host).includes(suggestion.data.draft),false);
});

test('duplicate generate clicks make one request and plain-text rendering never evaluates model markup',async()=>{
 const f=fixture(),pending=deferred();f.window.aiAdmin.mountTicket({host:f.host,ticketId:'b'.repeat(32),replyInput:f.replyInput});f.answers.push(pending.promise);
 const generate=button(f,'Organize ticket & draft reply'),action=generate.onclick();await generate.onclick();assert.equal(f.calls.length,1);
 pending.resolve({...suggestion,data:{...suggestion.data,summary:'<img src=x onerror=steal()>',draft:'<script>steal()</script>'}});await action;
 assert.match(text(f.host),/<img src=x/);assert.equal(all(f.host).some(node=>['img','script'].includes(node.tag)),false);
 assert.equal(all(f.host).find(node=>node.tag==='textarea').value,'<script>steal()</script>');
});

test('review explanations render evidence with no approve, clear, delete or email action',async()=>{
 const f=fixture();f.window.aiAdmin.mountReview({host:f.host,type:'ad',id:'c'.repeat(32)});
 f.answers.push({data:{summary:'A safety check is not cleared.',checks:['Inspect the image manually.'],needs_human:true},reasons:['The stored scanner flag has no detailed reason.']});
 await button(f,'Explain review checks').onclick();assert.equal(f.calls.length,1);assert.equal(f.calls[0].path,'/api/admin/ai/review');assert.equal(f.calls[0].body.type,'ad');
 assert.match(text(f.host),/No new image scan or approval/);assert.match(text(f.host),/stored scanner flag/);assert.deepEqual(all(f.host).filter(node=>node.tag==='button').map(node=>node.textContent),['Explain review checks']);
});

test('assistant failure preserves the manual reply and permits an explicit retry',async()=>{
 const f=fixture();f.replyInput.value='Keep this';f.window.aiAdmin.mountTicket({host:f.host,ticketId:'b'.repeat(32),replyInput:f.replyInput});f.answers.push(Error('AI allowance reached.'));
 const generate=button(f,'Organize ticket & draft reply');await generate.onclick();assert.equal(generate.disabled,false);assert.equal(f.replyInput.value,'Keep this');assert.match(text(f.host),/allowance reached/);
});
test('an authenticated admin can explain an advertisement on its separate review page, but logout stops it',async()=>{
 const grant={hidden:false},f=fixture({grant});f.admin.hidden=true;
 f.window.aiAdmin.mountReview({host:f.host,type:'ad',id:'c'.repeat(32),isActive:()=>true});
 f.answers.push({data:{summary:'Check the recorded evidence.',checks:['Review artwork.'],needs_human:true},reasons:[]});
 const generate=button(f,'Explain review checks');await generate.onclick();assert.equal(f.calls.length,1);assert.match(text(f.host),/Check the recorded evidence/);
 grant.hidden=true;await generate.onclick();assert.equal(f.calls.length,1);
});

test('cached ticket categories prioritize unanswered urgent tickets within their loaded page without mutating status',async()=>{
 const f=fixture(),ids=['1','2','3'].map(value=>value.repeat(32)),records=ids.map(id=>({id,kind:'support',state:'new'})),heading=f.element('h3'),more=f.element('button');
 heading.textContent='Support tickets';more.textContent='Load more';f.host.append(heading);
 const rows=ids.map(id=>{const row=f.element('article');row.dataset.aiTicketId=id;row.textContent=id;f.host.append(row);return row;});f.host.append(more);
 f.answers.push({tickets:[{ticket_id:ids[0],category:'wifi',priority:'normal',unanswered:true},{ticket_id:ids[1],category:'device',priority:'high',unanswered:true},{ticket_id:ids[2],category:'artwork',priority:'high',unanswered:false}]});
 await f.window.aiAdmin.decorateTickets({records,host:f.host});
 assert.equal(f.calls.length,1);assert.match(f.calls[0].path,/^\/api\/admin\/ai\/tickets\?ids=/);assert.equal(f.calls[0].body,undefined);
 assert.deepEqual(f.host.children,[heading,rows[1],rows[0],rows[2],more]);assert.match(text(rows[1]),/Device · Priority review/);assert.match(text(rows[0]),/Wi-Fi/);assert.equal(text(rows[2]).includes('Priority review'),false);
 assert.ok(records.every(record=>record.state==='new'));
});

test('delayed cached labels cannot decorate a different queue after navigation',async()=>{
 const f=fixture(),pending=deferred(),id='1'.repeat(32),row=f.element('article');row.dataset.aiTicketId=id;f.host.append(row);let viewing=true;f.answers.push(pending.promise);
 const action=f.window.aiAdmin.decorateTickets({records:[{id,kind:'support'}],host:f.host,isActive:()=>viewing});viewing=false;
 pending.resolve({tickets:[{ticket_id:id,category:'wifi',priority:'high',unanswered:true}]});await action;assert.equal(row.querySelector('.ai-ticket-label'),null);
});

test('ticket label reads use batches of at most fifty IDs and never generate provider requests',async()=>{
 const f=fixture(),records=Array.from({length:51},(_,index)=>({id:(index+1).toString(16).padStart(32,'0'),kind:'support'}));
 for(const record of records){const row=f.element('article');row.dataset.aiTicketId=record.id;f.host.append(row);}f.answers.push({tickets:[]},{tickets:[]});
 await f.window.aiAdmin.decorateTickets({records,host:f.host});assert.equal(f.calls.length,2);
 assert.equal(new URL(f.calls[0].path,'https://radiolocals.com').searchParams.get('ids').split(',').length,50);assert.ok(f.calls.every(call=>call.body===undefined));
});
