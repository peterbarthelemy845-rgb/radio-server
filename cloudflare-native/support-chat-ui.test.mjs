import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
const source=readFileSync(new URL('./public/assets/support-chat.js',import.meta.url),'utf8');
const answer={status:'ok',answer:'Turn up the volume on your radio.',sources:[{id:'no-sound',title:'No sound',steps:['Turn up the volume on your radio.','Try another station.']}],needs_support:false};
function fixture({missing=false,transport=true,flow=true,humanError=null,reply=answer}={}){
 const nodes=new Map(),events=new Map(),calls=[],checks=[],contacts=[],draft={name:'Listener',email:'private@example.com',message:'Existing ticket draft',station_code:'13'};let document,language='en';
 class Element{
  constructor(tag){this.tagName=tag.toUpperCase();this.children=[];this.attrs={};this.dataset={};this.hidden=false;this.textContent='';this.disabled=false;this.value='';this.handlers=new Map();}
  set id(value){this._id=value;nodes.set(value,this);}get id(){return this._id;}
  set innerHTML(value){throw Error('Unsafe HTML rendering: '+value);}get innerHTML(){return '';}
  append(...items){for(const item of items){item.remove();item.parentElement=this;this.children.push(item);}}
  remove(){if(this.parentElement){const list=this.parentElement.children;list.splice(list.indexOf(this),1);this.parentElement=null;}}
  before(item){const parent=this.parentElement;item.remove();item.parentElement=parent;parent.children.splice(parent.children.indexOf(this),0,item);}
  replaceChildren(...items){for(const item of [...this.children])item.remove();this.append(...items);}
  setAttribute(key,value){this.attrs[key]=value;}getAttribute(key){return this.attrs[key]??null;}
  addEventListener(name,handler){this.handlers.set(name,handler);}emit(name){this.handlers.get(name)?.({target:this});}
  focus(){document.activeElement=this;}scrollIntoView(options){this.lastScroll=options;}
  querySelector(){return this.children.find(child=>child.tagName==='INPUT')||null;}
 }
 const support=new Element('section');support.id='support';const guided=new Element('section');guided.id='supportGuidedFlow';const ticket=new Element('form');ticket.id='ticketForm';ticket.hidden=true;ticket.elements={};for(const [key,value] of Object.entries(draft)){const input=new Element('input');input.value=value;ticket.elements[key]=input;ticket.append(input);}support.append(guided,ticket);
 document={hidden:false,activeElement:null,getElementById:id=>missing&&id==='support'?null:nodes.get(id)||null,createElement:tag=>new Element(tag)};
 const window={appI18n:{get language(){return language;},t:key=>key},addEventListener(name,fn){events.set(name,fn);}};
 if(flow)window.supportGuidedFlow={openContact(){contacts.push(true);ticket.hidden=false;ticket.elements.name.focus();}};
 if(transport)window.supportChatTransport={async human(form,action,signal){checks.push({form,action,signal});if(humanError)throw humanError;return 'fresh-token-'+checks.length;},async api(path,body,options){calls.push({path,body,options});if(typeof reply==='function')return reply(path,body,options);if(reply instanceof Error)throw reply;return structuredClone(reply);}};
 vm.runInNewContext(source,{document,window,AbortController});
 const get=id=>nodes.get(id),input=get('supportChatQuestion'),form=get('supportChatForm');
 return {nodes,window,document,support,ticket,draft,calls,checks,contacts,get,toggle:()=>get('supportChatToggle').onclick(),type(value){input.value=value;input.emit('input');},submit(){return form.onsubmit({preventDefault(){}});},buttons(){return get('supportChat').children[1].children.find(child=>child.className==='support-chat-actions').children;},changeLanguage(value){language=value;events.get('app-language-changed')?.();},hide(){events.get('pagehide')?.();}};
}
const settle=()=>new Promise(setImmediate);
test('chat is Support-only, expanded by default, and makes no request just by opening or selecting a suggestion',()=>{
 const missing=fixture({missing:true});assert.equal(missing.get('supportChat'),undefined);
 const f=fixture();assert.equal(f.get('supportChatPanel').hidden,false);assert.equal(f.get('supportChatToggle').getAttribute('aria-expanded'),'true');f.toggle();assert.equal(f.get('supportChatPanel').hidden,true);f.toggle();assert.equal(f.get('supportChatPanel').hidden,false);assert.equal(f.document.activeElement,f.get('supportChatQuestion'));
 const suggestions=f.get('supportChatForm').children.find(child=>child.className==='support-chat-suggestions');suggestions.children[1].onclick();assert.equal(f.get('supportChatQuestion').value,'No sound');assert.equal(f.calls.length+f.checks.length,0);assert.match(f.get('supportChatDisclosure').textContent,/Do not send passwords or private codes/);
});
test('sending verifies every question, passes only bounded in-memory conversation, and renders approved sources using text nodes',async()=>{
 const f=fixture();f.toggle();for(let index=0;index<4;index++){f.type('Question '+index);await f.submit();}
 assert.equal(f.checks.length,4);assert.ok(f.checks.every(check=>check.action==='support_chat'));assert.equal(f.calls[3].path,'/api/support/chat');assert.equal(f.calls[3].body.conversation.length,4);assert.equal(f.calls[3].body.conversation[0].content,'Question 1');assert.equal(f.calls[3].body.turnstile_token,'fresh-token-4');assert.equal(f.get('supportChatThread').children.length,6);
 const bubble=f.get('supportChatThread').children.at(-1);assert.equal(bubble.children[1].textContent,answer.answer);assert.equal(bubble.children[2].children[0].textContent,'Approved guide: No sound');assert.equal(bubble.dataset.i18nSkip,'1');assert.equal(f.get('supportChatQuestion').value,'');assert.equal(f.get('supportChatForm').getAttribute('aria-busy'),'false');
});
test('untrusted text cannot inject HTML or executable links into an answer or source',async()=>{
 const payload={...answer,answer:'<img src=x onerror=alert(1)>',sources:[{id:'no-sound',title:'<script>bad</script>',steps:['<svg onload=alert(1)>']}]};const f=fixture({reply:payload});f.type('<script>question</script>');await f.submit();
 const messages=f.get('supportChatThread').children;assert.equal(messages[0].children[1].textContent,'<script>question</script>');assert.equal(messages[1].children[1].textContent,payload.answer);assert.equal(messages[1].children[2].children[1].children[0].textContent,payload.sources[0].steps[0]);assert.equal(messages[1].children.some(node=>node.tagName==='A'),false);
});
test('double submit cannot start duplicate bot/model requests and failures preserve the question with a safe fallback',async()=>{
 let finish;const f=fixture({reply:()=>new Promise(resolve=>{finish=resolve;})});f.type('My radio is quiet');const first=f.submit();await settle();await f.submit();assert.equal(f.calls.length,1);assert.equal(f.get('supportChatQuestion').disabled,true);finish(answer);await first;assert.equal(f.get('supportChatQuestion').disabled,false);
 const error=new Error('private provider body sk-secret');error.status=429;const failed=fixture({reply:error});failed.type('Keep my question');await failed.submit();assert.equal(failed.get('supportChatQuestion').value,'Keep my question');assert.match(failed.get('supportChatStatus').textContent,/Too many questions/);assert.doesNotMatch(failed.get('supportChatStatus').textContent,/sk-secret|provider body/);assert.equal(failed.get('supportChatThread').children.length,0);
});
test('security failures and missing transport leave manual support accessible without sending model requests',async()=>{
 const f=fixture({humanError:new Error('Secret provider details')});f.type('Help');await f.submit();assert.equal(f.calls.length,0);assert.match(f.get('supportChatStatus').textContent,/security check did not complete/);
 const fallback=fixture({transport:false,flow:false});fallback.type('Help');await fallback.submit();assert.match(fallback.get('supportChatStatus').textContent,/could not answer/);fallback.buttons()[0].onclick();assert.equal(fallback.ticket.hidden,false);assert.equal(fallback.document.activeElement,fallback.ticket.elements.name);
});
test('contact support does not copy chat or overwrite an existing ticket draft; late cancelled results are ignored',async()=>{
 let finish;const f=fixture({reply:()=>new Promise(resolve=>{finish=resolve;})});f.type('Private chat question');const sending=f.submit();await settle();f.buttons()[0].onclick();assert.equal(f.checks[0].signal.aborted,true);assert.equal(f.contacts.length,1);assert.equal(f.get('supportChatPanel').hidden,false);for(const [key,value] of Object.entries(f.draft))assert.equal(f.ticket.elements[key].value,value);finish(answer);await sending;assert.equal(f.get('supportChatThread').children.length,0);
});
test('a response completed after leaving Support stays in memory without scrolling or focusing another page',async()=>{
 let finish;const f=fixture({reply:()=>new Promise(resolve=>{finish=resolve;})});f.toggle();f.type('No sound');const sending=f.submit();await settle();f.support.hidden=true;const previousFocus=f.document.activeElement;finish(answer);await sending;const bubble=f.get('supportChatThread').children.at(-1);assert.equal(bubble.lastScroll,undefined);assert.equal(f.document.activeElement,previousFocus);assert.equal(f.get('supportChatQuestion').disabled,false);f.support.hidden=false;assert.equal(bubble.children[1].textContent,answer.answer);assert.equal(f.calls.length,1);
});
test('language changes update controls without altering user text or prior answers, and subsequent requests use Creole',async()=>{
 const f=fixture();f.type('No sound');await f.submit();f.type('Keep this draft');const firstAnswer=f.get('supportChatThread').children[1].children[1].textContent;f.changeLanguage('ht');assert.equal(f.get('supportChatQuestion').value,'Keep this draft');assert.equal(f.get('supportChatThread').children[1].children[1].textContent,firstAnswer);assert.equal(f.get('supportChatToggle').textContent,'Poze asistan èd la yon kesyon');assert.equal(f.get('supportChatQuestion').placeholder,'Egzanp: Radyo mwen pa gen son');assert.equal(f.get('supportChat').dataset.i18nSkip,'1');assert.equal(f.get('supportChatForm').children.find(child=>child.type==='submit').textContent,'Mande');await f.submit();assert.equal(f.calls.at(-1).body.language,'ht');
});
test('clearing chat removes conversation context and pagehide cancels work without losing the unsent question',async()=>{
 const f=fixture();f.type('First question');await f.submit();f.buttons()[1].onclick();assert.equal(f.get('supportChatThread').children.length,0);f.type('Second question');await f.submit();assert.equal(f.calls[1].body.conversation.length,0);
 let finish;const pending=fixture({reply:()=>new Promise(resolve=>{finish=resolve;})});pending.type('Keep this question');const sending=pending.submit();await settle();pending.hide();assert.equal(pending.get('supportChatQuestion').value,'Keep this question');assert.equal(pending.checks[0].signal.aborted,true);finish(answer);await sending;assert.equal(pending.get('supportChatThread').children.length,0);
});
test('invalid questions and malformed responses never erase the draft or create false success',async()=>{
 const f=fixture();f.type('');await f.submit();assert.match(f.get('supportChatStatus').textContent,/Enter a question/);f.type('x'.repeat(1001));await f.submit();assert.equal(f.calls.length+f.checks.length,0);
 const malformed=fixture({reply:{answer:'A result',sources:[{id:'javascript:alert(1)',title:'Bad',steps:[]}]}});malformed.type('My question');await malformed.submit();assert.equal(malformed.get('supportChatQuestion').value,'My question');assert.equal(malformed.get('supportChatThread').children.length,0);assert.match(malformed.get('supportChatStatus').textContent,/could not answer/);
});
