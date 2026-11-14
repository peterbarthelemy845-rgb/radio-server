import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
function fixture({human,clipboard,receipt=false}={}){
 const events={},calls=[],answers=[],ids=new Map(),observers=[];
 function element(tag='div'){
  const node={tag,nodeType:1,children:[],dataset:{},hidden:false,attributes:{},textContent:'',value:'',isConnected:true,replacements:0,
   setAttribute(k,v){this.attributes[k]=v;},
   append(...children){for(const child of children){child.remove?.();child.parent=this;this.children.push(child);}},
   insertBefore(child,before){child.remove?.();child.parent=this;const index=this.children.indexOf(before);this.children.splice(index<0?this.children.length:index,0,child);},
   remove(){if(this.parent){const index=this.parent.children.indexOf(this);if(index>=0)this.parent.children.splice(index,1);this.parent=null;}},
   replaceChildren(...children){this.replacements++;for(const child of this.children)child.parent=null;this.children=[];this.append(...children);},
   contains(child){return child===this||this.children.some(node=>node.contains?.(child));},
   querySelectorAll(selector){const tags=selector.split(',');return this.children.flatMap(child=>[...(tags.includes(child.tag)?[child]:[]),...(child.querySelectorAll?.(selector)||[])]);},
   getBoundingClientRect(){return {top:0,bottom:0,height:0};},
   after(...siblings){this.afterNodes=siblings;},select(){this.selected=true;},addEventListener(name,fn){this[name+'Listener']=fn;},showModal(){this.open=true;},close(){this.open=false;this.closeListener?.();},focus(){this.focused=true;document.activeElement=this;},reset(){this.resetCalled=true;}};
  Object.defineProperty(node,'innerHTML',{set(){throw Error('Untrusted HTML insertion');}});return node;
 }
 const document={hidden:false,activeElement:null,selection:null,getSelection(){return this.selection;},createElement:element,createTextNode:text=>({textContent:text}),body:element('body'),addEventListener(){}};ids.set('supportTicketStatus',element());ids.set('support',element());if(receipt){ids.set('ticketReference',element());ids.set('ticketSuccess',element('dialog'));}
 const window={innerHeight:720,scrollX:0,scrollY:0,scrolls:[],scrollTo(x,y){this.scrolls.push({x,y});this.scrollX=x;this.scrollY=y;},addEventListener(name,fn){events[name]=fn;},dispatchEvent(){},appI18n:{language:'en'}};
 const ctx={document,window,navigator:{clipboard},$:id=>ids.get(id),Event:class{constructor(name){this.type=name;}},MutationObserver:class{constructor(fn){observers.push(fn);}observe(){}},setTimeout(){return 1;},clearTimeout(){},encodeURIComponent,Date,busy(){},human:human||(async()=> 'bot-proof'),api:async(path,body)=>{calls.push({path,body});const answer=answers.shift();if(answer instanceof Error)throw answer;if(!answer)throw Error('Missing fixture answer');return answer;}};
 runInNewContext(readFileSync(new URL('./public/assets/support-status.js',import.meta.url),'utf8'),ctx);
 return {events,calls,answers,document,window,ids,get:name=>runInNewContext(name,ctx),open:runInNewContext('openSupportTicket',ctx),leave(){ids.get('support').hidden=true;observers[0]();},returnToSupport(){ids.get('support').hidden=false;observers[0]();}};
}
function text(node){return node.textContent+(node.children||[]).map(text).join('');}
const reference='b'.repeat(32);
const result={ticket:{reference,state:'review',subject:'Wi-Fi help',message:'<img src=x onerror=alert(1)>'},replies:[{created_at:1800000000,body:'<script>secret()</script>'}],history:[]};
function deferred(){let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return {promise,resolve,reject};}
async function beginVerification(f,id='c'.repeat(32)){f.get('statusReference').value=reference;f.get('statusEmail').value='listener@example.com';f.answers.push({verification_id:id});await f.get('statusLookup').onsubmit({preventDefault(){}});f.get('statusCode').value='123456';}
test('private ticket content is rendered as untranslated text, never executable markup',async()=>{
 const f=fixture();f.answers.push(result);await f.open(reference);const panel=f.get('statusPrivate');assert.equal(panel.hidden,false);assert.equal(f.get('statusLookup').hidden,true);assert.match(text(panel),/<img src=x onerror=alert\(1\)>/);assert.match(text(panel),/<script>secret\(\)<\/script>/);
 const protectedNodes=[];function walk(node){if(node.dataset?.i18nSkip)protectedNodes.push(node);for(const child of node.children||[])walk(child);}walk(panel);assert.ok(protectedNodes.some(node=>node.textContent===result.ticket.message));assert.ok(protectedNodes.some(node=>node.textContent===result.replies[0].body));assert.equal(f.calls[0].path,'/api/support/status/ticket?reference='+reference);
});

test('a station problem ticket keeps its selected station visible as literal text',async()=>{
 const f=fixture(),ticket={...result.ticket,station_code:'13',station_name:'<b>Test station</b>'};f.answers.push({...result,ticket});await f.open(reference);assert.match(text(f.get('statusPrivate')),/<B>TEST STATION<\/B> #13/);assert.equal(ticket.station_name,'<b>Test station</b>');assert.equal(ticket.message,result.ticket.message);
});

test('unchanged automatic ticket checks preserve content and focused controls without rebuilding the panel',async()=>{
 const f=fixture();f.answers.push(result);await f.open(reference);const view=f.get('supportTicketView'),panel=f.get('statusPrivate'),children=[...panel.children],reply=[...view.replyViews.values()][0],replacements=panel.replacements;
 view.refresh.focus();f.window.scrollY=340;f.answers.push(structuredClone(result));await f.open(reference,true);
 assert.equal(f.get('supportTicketView'),view);assert.deepEqual(panel.children,children);assert.equal(panel.replacements,replacements);assert.equal([...view.replyViews.values()][0],reply);assert.equal(f.document.activeElement,view.refresh);assert.equal(f.window.scrollY,340);assert.equal(f.window.scrolls.length,0);
});

test('new ticket replies and status patch in place while preserving focused actions, selected text and the reading position',async()=>{
 const f=fixture();f.answers.push(result);await f.open(reference);const view=f.get('supportTicketView'),oldReply=[...view.replyViews.values()][0];view.close.focus();f.window.scrollY=200;
 const selection={rangeCount:1,isCollapsed:false,anchorNode:oldReply.body,anchorOffset:0,focusNode:oldReply.body,focusOffset:0,restored:[],setBaseAndExtent(...values){this.restored.push(values);}};f.document.selection=selection;
 oldReply.body.getBoundingClientRect=()=>{const top=300+(view.state.dataset.i18n==='supportStatus.closed'?24:0)-f.window.scrollY;return {top,bottom:top+80,height:80};};
 const next={...result,ticket:{...result.ticket,state:'closed'},replies:[...result.replies,{created_at:1800000030,body:'Try the updated radio software.'}]};f.answers.push(next);await f.open(reference,true);
 assert.equal(f.get('supportTicketView'),view);assert.equal(view.state.textContent,'Closed');assert.equal(view.replyViews.size,2);assert.equal([...view.replyViews.values()][0],oldReply);assert.equal(f.document.activeElement,view.close);assert.equal(selection.restored.length,1);assert.deepEqual(selection.restored[0],[oldReply.body,0,oldReply.body,0]);assert.equal(oldReply.body.getBoundingClientRect().top,100);assert.equal(f.window.scrollY,224);assert.match(text(view.replies),/Try the updated radio software/);
});

test('a rolling reply list removes old entries without detaching surviving replies or replacing its buttons',async()=>{
 const f=fixture(),first={...result,replies:[{created_at:1800000000,body:'First reply'},{created_at:1800000030,body:'Keep reading this reply'}]};f.answers.push(first);await f.open(reference);const view=f.get('supportTicketView'),old=[...view.replyViews.values()],refresh=view.refresh;
 f.answers.push({...first,replies:[first.replies[1],{created_at:1800000060,body:'Newest reply'}]});await f.open(reference,true);
 assert.equal(view.replyViews.size,2);assert.equal(view.replies.children[1],old[1].card);assert.equal(old[0].card.parent,null);assert.equal(view.refresh,refresh);assert.doesNotMatch(text(view.replies),/First reply/);assert.match(text(view.replies),/Newest reply/);
});

test('language refresh updates ticket dates while retaining the same private content and controls',async()=>{
 const f=fixture(),dated={...result,ticket:{...result.ticket,created_at:1800000000}};f.answers.push(dated);await f.open(reference);const view=f.get('supportTicketView'),body=view.message,reply=[...view.replyViews.values()][0];f.window.appI18n.language='ht';f.answers.push(dated);await f.open(reference,true);
 assert.equal(view.created.textContent,new Date(1800000000*1000).toLocaleString('fr-HT',{dateStyle:'medium',timeStyle:'short'}));assert.equal(view.message,body);assert.equal([...view.replyViews.values()][0],reply);assert.equal(body.textContent,result.ticket.message);
});

test('temporary automatic-check errors and recovery keep the focused ticket at its reading position',async()=>{
 const f=fixture();f.answers.push(result);await f.open(reference);const view=f.get('supportTicketView'),notice=f.get('statusNotice');f.window.scrollY=200;view.refresh.focus();
 view.refresh.getBoundingClientRect=()=>{const top=300+(notice.textContent?48:0)-f.window.scrollY;return {top,bottom:top+48,height:48};};
 f.answers.push(Error('Connection interrupted'));await f.open(reference,true);assert.equal(view.refresh.getBoundingClientRect().top,100);assert.equal(f.document.activeElement,view.refresh);assert.match(notice.textContent,/Connection interrupted/);
 f.answers.push(result);await f.open(reference,true);assert.equal(view.refresh.getBoundingClientRect().top,100);assert.equal(f.document.activeElement,view.refresh);assert.equal(notice.textContent,'');assert.equal(f.window.scrollY,200);
});
test('email lookup requires its private challenge and verification before displaying a ticket',async()=>{
 const f=fixture();f.get('statusReference').value=reference;f.get('statusEmail').value='listener@example.com';f.answers.push({verification_id:'c'.repeat(32)});await f.get('statusLookup').onsubmit({preventDefault(){}});assert.equal(f.get('statusVerify').open,true);assert.equal(f.get('statusPrivate').hidden,true);assert.equal(f.calls[0].body.turnstile_token,'bot-proof');
 f.get('statusCode').value='123456';f.answers.push({reference},result);await f.get('statusVerifyForm').onsubmit({preventDefault(){}});assert.equal(f.calls[1].path,'/api/support/status/verify');assert.equal(f.calls[1].body.code,'123456');assert.equal(f.get('statusVerify').open,false);assert.equal(f.get('statusCode').value,'');assert.equal(f.get('statusPrivate').hidden,false);
});
test('expired ticket access removes private content and returns to email verification',async()=>{
 const f=fixture();f.answers.push(result);await f.open(reference);const error=Object.assign(Error('Verify your email to open this support ticket.'),{status:403});f.answers.push(error);await f.open(reference,true);assert.equal(f.get('statusPrivate').hidden,true);assert.equal(f.get('statusPrivate').children.length,0);assert.equal(f.get('statusLookup').hidden,false);assert.equal(f.get('supportStatusReference'),'');assert.match(f.get('statusNotice').textContent,/Verify your email/);
});
test('cancelling an in-flight verification cannot open a private ticket afterward',async()=>{
 const f=fixture();await beginVerification(f);const pending=deferred();f.answers.push(pending.promise);const verification=f.get('statusVerifyForm').onsubmit({preventDefault(){}});
 f.get('statusCancel').onclick();assert.equal(f.get('statusVerify').open,false);pending.resolve({reference});await verification;
 assert.equal(f.get('statusPrivate').hidden,true);assert.equal(f.get('supportStatusReference'),'');assert.equal(f.calls.filter(call=>call.path.startsWith('/api/support/status/ticket')).length,0);assert.equal(f.get('supportStatusVerification'),'');
});
test('an old verification response cannot close or unlock a newer challenge',async()=>{
 const f=fixture();await beginVerification(f);const old=deferred();f.answers.push(old.promise);const oldVerify=f.get('statusVerifyForm').onsubmit({preventDefault(){}});f.get('statusCancel').onclick();
 const nextId='d'.repeat(32);await beginVerification(f,nextId);const next=deferred();f.answers.push(next.promise);const nextVerify=f.get('statusVerifyForm').onsubmit({preventDefault(){}});
 old.resolve({reference});await oldVerify;assert.equal(f.get('statusVerify').open,true);assert.equal(f.get('supportStatusVerification'),nextId);assert.equal(f.get('supportStatusVerifyBusy'),true);assert.equal(f.get('statusPrivate').hidden,true);
 f.answers.push(result);next.resolve({reference});await nextVerify;assert.equal(f.get('statusVerify').open,false);assert.equal(f.get('statusPrivate').hidden,false);
});
test('repeated submits send only one lookup and one verification request',async()=>{
 const f=fixture(),pending=deferred();f.get('statusReference').value=reference;f.get('statusEmail').value='listener@example.com';f.answers.push(pending.promise);
 const first=f.get('statusLookup').onsubmit({preventDefault(){}});await f.get('statusLookup').onsubmit({preventDefault(){}});await Promise.resolve();assert.equal(f.calls.length,1);
 pending.resolve({verification_id:'c'.repeat(32)});await first;const checked=deferred();f.answers.push(checked.promise);f.get('statusCode').value='123456';const verifying=f.get('statusVerifyForm').onsubmit({preventDefault(){}});await f.get('statusVerifyForm').onsubmit({preventDefault(){}});assert.equal(f.calls.filter(call=>call.path==='/api/support/status/verify').length,1);
 f.get('statusCancel').onclick();checked.resolve({reference});await verifying;
});
test('lookup retains the ticket and email captured before a delayed bot check',async()=>{
 const bot=deferred(),f=fixture({human:()=>bot.promise}),pending=deferred();f.get('statusReference').value=reference;f.get('statusEmail').value='listener@example.com';f.answers.push(pending.promise);const lookup=f.get('statusLookup').onsubmit({preventDefault(){}});
 f.get('statusReference').value='a'.repeat(32);f.get('statusEmail').value='other@example.com';bot.resolve('bot-proof');await new Promise(setImmediate);assert.equal(f.calls[0].body.reference,reference);assert.equal(f.calls[0].body.email,'listener@example.com');pending.resolve({verification_id:'c'.repeat(32)});await lookup;
});
test('leaving Support during a bot check abandons the request before sending email',async()=>{
 const bot=deferred(),f=fixture({human:()=>bot.promise});f.get('statusReference').value=reference;f.get('statusEmail').value='listener@example.com';const lookup=f.get('statusLookup').onsubmit({preventDefault(){}});
 f.leave();bot.resolve('bot-proof');await lookup;assert.equal(f.calls.length,0);assert.notEqual(f.get('statusVerify').open,true);assert.equal(f.get('supportStatusLookupBusy'),false);
});
test('late lookup responses cannot open the verification dialog over another page',async()=>{
 const f=fixture(),pending=deferred();f.get('statusReference').value=reference;f.get('statusEmail').value='listener@example.com';f.answers.push(pending.promise);const lookup=f.get('statusLookup').onsubmit({preventDefault(){}});await new Promise(setImmediate);
 f.leave();pending.resolve({verification_id:'c'.repeat(32)});await lookup;assert.notEqual(f.get('statusVerify').open,true);assert.equal(f.get('supportStatusVerification'),'');
});
test('a navigation-cancelled lookup cannot unlock a new request after returning to Support',async()=>{
 const f=fixture(),old=deferred(),next=deferred();f.get('statusReference').value=reference;f.get('statusEmail').value='listener@example.com';f.answers.push(old.promise);const first=f.get('statusLookup').onsubmit({preventDefault(){}});await new Promise(setImmediate);f.leave();f.returnToSupport();f.answers.push(next.promise);const second=f.get('statusLookup').onsubmit({preventDefault(){}});await new Promise(setImmediate);
 assert.equal(f.calls.length,2);old.resolve({verification_id:'c'.repeat(32)});await first;assert.equal(f.get('supportStatusLookupBusy'),true);assert.notEqual(f.get('statusVerify').open,true);next.resolve({verification_id:'d'.repeat(32)});await second;assert.equal(f.get('statusVerify').open,true);assert.equal(f.get('supportStatusVerification'),'d'.repeat(32));
});
test('leaving Support dismisses its challenge and ignores a late verification result',async()=>{
 const f=fixture();await beginVerification(f);const pending=deferred();f.answers.push(pending.promise);const verification=f.get('statusVerifyForm').onsubmit({preventDefault(){}});f.leave();assert.equal(f.get('statusVerify').open,false);pending.resolve({reference});await verification;assert.equal(f.get('statusPrivate').hidden,true);assert.equal(f.calls.filter(call=>call.path.startsWith('/api/support/status/ticket')).length,0);
});

test('a private ticket copies only its reference and Hide ticket only signs out of that private view',async()=>{
 const copied=[],f=fixture({clipboard:{async writeText(value){copied.push(value);}}});f.answers.push(result);await f.open(reference);
 const copy=f.get('statusPrivate').querySelectorAll('button').find(node=>node.dataset.i18n==='supportStatus.copyReference');await copy.onclick();assert.deepEqual(copied,[reference]);assert.match(text(f.get('statusPrivate')),/Reference copied/);assert.equal(f.get('supportTicketView').close.textContent,'Hide ticket');
 f.answers.push({}, {tickets:[]});await f.get('supportTicketView').close.onclick();assert.equal(f.calls.at(-2).path,'/api/support/status/logout');assert.equal(f.calls.at(-2).body.reference,reference);assert.equal(f.get('statusPrivate').hidden,true);
});

test('ticket-reference clipboard failures provide a selectable manual fallback without exposing message content',async()=>{
 const f=fixture({clipboard:{async writeText(){throw Error('Clipboard denied');}}});f.answers.push(result);await f.open(reference);
 const copy=f.get('statusPrivate').querySelectorAll('button').find(node=>node.dataset.i18n==='supportStatus.copyReference');await copy.onclick();const field=f.document.activeElement;
 assert.equal(field.tag,'input');assert.equal(field.readOnly,true);assert.equal(field.selected,true);assert.equal(field.value,reference);assert.equal(field.dataset.i18nSkip,'true');assert.match(text(f.get('statusPrivate')),/Select and copy your ticket reference/);assert.equal(f.calls.length,1);
});

test('a late reference-copy completion cannot write feedback into a different ticket',async()=>{
 const pending=deferred(),f=fixture({clipboard:{writeText:()=>pending.promise}});f.answers.push(result);await f.open(reference);
 const old=f.get('statusPrivate').querySelectorAll('button').find(node=>node.dataset.i18n==='supportStatus.copyReference'),copying=old.onclick();f.answers.push(result);await f.open('d'.repeat(32));pending.resolve();await copying;
 assert.doesNotMatch(text(f.get('statusPrivate')),/Reference copied/);assert.equal(f.get('supportTicketView').reference,'d'.repeat(32));
});

test('the receipt copies its event reference rather than reading translated receipt text',async()=>{
 const copied=[],f=fixture({receipt:true,clipboard:{async writeText(value){copied.push(value);}}});f.ids.get('ticketReference').textContent='Translated private receipt text';f.answers.push({tickets:[]},result);
 f.events['support-ticket-created']({detail:{reference}});await new Promise(setImmediate);f.ids.get('ticketSuccess').open=true;
 const host=f.get('receiptReferenceCopy'),copy=host.querySelectorAll('button')[0];assert.equal(host.hidden,false);await copy.onclick();assert.deepEqual(copied,[reference]);assert.match(text(host),/Reference copied/);
});
