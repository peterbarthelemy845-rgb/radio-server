import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
function fixture({human}={}){
 const events={},calls=[],answers=[],ids=new Map(),observers=[];
 function element(tag='div'){const node={tag,children:[],dataset:{},hidden:false,attributes:{},textContent:'',value:'',setAttribute(k,v){this.attributes[k]=v;},append(...children){this.children.push(...children);},replaceChildren(...children){this.children=children;},addEventListener(name,fn){this[name+'Listener']=fn;},showModal(){this.open=true;},close(){this.open=false;this.closeListener?.();},focus(){this.focused=true;},reset(){this.resetCalled=true;}};Object.defineProperty(node,'innerHTML',{set(){throw Error('Untrusted HTML insertion');}});return node;}
 const document={hidden:false,createElement:element,createTextNode:text=>({textContent:text}),body:element('body'),addEventListener(){}};ids.set('supportTicketStatus',element());ids.set('support',element());
 const ctx={document,window:{addEventListener(name,fn){events[name]=fn;},dispatchEvent(){},appI18n:{language:'en'}},$:id=>ids.get(id),Event:class{constructor(name){this.type=name;}},MutationObserver:class{constructor(fn){observers.push(fn);}observe(){}},setTimeout(){return 1;},clearTimeout(){},encodeURIComponent,Date,busy(){},human:human||(async()=> 'bot-proof'),api:async(path,body)=>{calls.push({path,body});const answer=answers.shift();if(answer instanceof Error)throw answer;if(!answer)throw Error('Missing fixture answer');return answer;}};
 runInNewContext(readFileSync(new URL('./public/assets/support-status.js',import.meta.url),'utf8'),ctx);
 return {events,calls,answers,get:name=>runInNewContext(name,ctx),open:runInNewContext('openSupportTicket',ctx),leave(){ids.get('support').hidden=true;observers[0]();},returnToSupport(){ids.get('support').hidden=false;observers[0]();}};
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
