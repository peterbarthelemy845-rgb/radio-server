import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
function fixture(){
 const events={},calls=[],answers=[],ids=new Map();
 function element(tag='div'){const node={tag,children:[],dataset:{},hidden:false,attributes:{},textContent:'',value:'',setAttribute(k,v){this.attributes[k]=v;},append(...children){this.children.push(...children);},replaceChildren(...children){this.children=children;},addEventListener(name,fn){this[name+'Listener']=fn;},showModal(){this.open=true;},close(){this.open=false;this.closeListener?.();},focus(){this.focused=true;},reset(){this.resetCalled=true;}};Object.defineProperty(node,'innerHTML',{set(){throw Error('Untrusted HTML insertion');}});return node;}
 const document={hidden:false,createElement:element,createTextNode:text=>({textContent:text}),body:element('body'),addEventListener(){}};ids.set('supportTicketStatus',element());ids.set('support',element());
 const ctx={document,window:{addEventListener(name,fn){events[name]=fn;},dispatchEvent(){},appI18n:{language:'en'}},$:id=>ids.get(id),Event:class{constructor(name){this.type=name;}},MutationObserver:class{observe(){}},setTimeout(){return 1;},clearTimeout(){},encodeURIComponent,Date,busy(){},human:async()=> 'bot-proof',api:async(path,body)=>{calls.push({path,body});const answer=answers.shift();if(answer instanceof Error)throw answer;if(!answer)throw Error('Missing fixture answer');return answer;}};
 runInNewContext(readFileSync(new URL('./public/assets/support-status.js',import.meta.url),'utf8'),ctx);
 return {events,calls,answers,get:name=>runInNewContext(name,ctx),open:runInNewContext('openSupportTicket',ctx)};
}
function text(node){return node.textContent+(node.children||[]).map(text).join('');}
const reference='b'.repeat(32);
const result={ticket:{reference,state:'review',subject:'Wi-Fi help',message:'<img src=x onerror=alert(1)>'},replies:[{created_at:1800000000,body:'<script>secret()</script>'}],history:[]};
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
