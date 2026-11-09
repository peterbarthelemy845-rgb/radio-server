import {test} from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';

const source=readFileSync(new URL('./public/assets/policy-preview.js',import.meta.url),'utf8');
function deferred(){let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return {promise,resolve,reject};}
function fixture(){
 const nodes=new Map(),events={},observers=[],calls=[],answers=[],entries=[null];let index=0;
 const document={activeElement:null,addEventListener(type,fn){events['document:'+type]=fn;},getElementById:id=>nodes.get(id),querySelector(selector){return selector==='main'?nodes.get('main'):[...nodes.values()].find(n=>n.open)||null;}};
 function node(id){const listeners={};const n={id,hidden:false,open:false,dataset:{},attrs:{},textContent:'',innerHTML:'',scrollTop:0,addEventListener(type,fn){listeners[type]=fn;},setAttribute(k,v){this.attrs[k]=v;},removeAttribute(k){delete this.attrs[k];},replaceChildren(){this.innerHTML='';},focus(){document.activeElement=this;},showModal(){this.returnFocus=document.activeElement;this.open=true;},close(){this.open=false;document.activeElement=this.returnFocus;listeners.close?.();}};nodes.set(id,n);return n;}
 for(const id of ['policyPreview','policyPreviewTitle','policyPreviewBody','policyPreviewStatus','closePolicyPreview','retryPolicyPreview','main','register','editor'])node(id);
 nodes.get('editor').hidden=true;nodes.get('register').draft={name:'My unsaved station',artwork:'chosen-logo.png'};
 const history={get state(){return entries[index];},pushState(value){entries.splice(++index);entries.push(value);},back(){if(index){index--;events.popstate?.({state:this.state});}},forward(){if(index+1<entries.length){index++;events.popstate?.({state:this.state});}}};
 const context=vm.createContext({document,history,location:{origin:'https://radio.example',href:'https://radio.example/#add-station'},sitePageGeneration:1,URL,AbortController,setTimeout,clearTimeout,window:{addEventListener(type,fn){events[type]=fn;}},MutationObserver:class{constructor(fn){observers.push(fn);}observe(){}},fetch:async(path,options)=>{calls.push({path,options});const value=answers.length?answers.shift():{terms:['Terms','<h2>Rights</h2><p>Keep your rights.</p>'],privacy:['Privacy','<p>Private data stays private.</p>']};if(value instanceof Error)throw value;const result=await value;return {ok:true,json:async()=>result};}});
 vm.runInContext(source,context);
 function click(kind='terms',options={}){const link={href:options.href||'https://radio.example/'+kind,closest:()=>nodes.get('register')};document.activeElement=link;const event={button:0,target:{closest:()=>link},preventDefault(){this.prevented=true;},...options};events['document:click'](event);return {event,link};}
 return {nodes,calls,answers,history,context,click,leave(){nodes.get('register').hidden=true;context.sitePageGeneration++;observers[0]();}};
}
async function settle(){for(let i=0;i<4;i++)await new Promise(resolve=>setImmediate(resolve));}

test('policy reader preserves the signup draft and browser Back/Forward restores its popup',async()=>{
 const f=fixture(),draft=f.nodes.get('register').draft,{event,link}=f.click();await settle();
 assert.equal(event.prevented,true);assert.equal(f.nodes.get('policyPreview').open,true);assert.match(f.nodes.get('policyPreviewBody').innerHTML,/Keep your rights/);
 assert.equal(f.nodes.get('register').draft,draft);assert.equal(f.calls[0].path,'/assets/policies.json');assert.equal(f.calls[0].options.credentials,'omit');
 f.history.back();assert.equal(f.nodes.get('policyPreview').open,false);assert.equal(f.nodes.get('register').draft,draft);assert.equal(f.nodes.get('policyPreviewBody').innerHTML,'');assert.equal(f.nodes.get('policyPreview').returnFocus,link);
 f.history.forward();await settle();assert.equal(f.nodes.get('policyPreview').open,true);assert.equal(f.calls.length,1);
 f.nodes.get('closePolicyPreview').onclick();assert.equal(f.nodes.get('policyPreview').open,false);assert.equal(f.history.state,null);
});
test('late policy responses after closing or leaving the form never reopen or replace another view',async()=>{
 for(const action of ['close','leave']){const f=fixture(),pending=deferred();f.answers.push(pending.promise);f.click();if(action==='close')f.nodes.get('closePolicyPreview').onclick();else f.leave();pending.resolve({terms:['Terms','<p>Late policy</p>']});await settle();assert.equal(f.nodes.get('policyPreview').open,false);assert.equal(f.nodes.get('policyPreviewBody').innerHTML,'');}
});
test('policy failures can retry while keeping Close available and the draft untouched',async()=>{
 const f=fixture();f.answers.push(Error('Network down'));f.click('privacy');await settle();assert.equal(f.nodes.get('retryPolicyPreview').hidden,false);assert.match(f.nodes.get('policyPreviewStatus').textContent,/could not load/);assert.equal(f.nodes.get('policyPreview').open,true);
 f.nodes.get('retryPolicyPreview').onclick();await settle();assert.match(f.nodes.get('policyPreviewBody').innerHTML,/Private data/);assert.equal(f.nodes.get('policyPreviewStatus').hidden,true);assert.equal(f.nodes.get('retryPolicyPreview').hidden,true);assert.equal(f.nodes.get('register').draft.name,'My unsaved station');
});
test('modified clicks and unrelated or external links retain normal browser behavior',()=>{
 const f=fixture();for(const options of [{ctrlKey:true},{metaKey:true},{button:1}])assert.equal(f.click('terms',options).event.prevented,undefined);
 assert.equal(f.click('terms',{href:'https://other.example/terms'}).event.prevented,undefined);assert.equal(f.click('copyright').event.prevented,undefined);assert.equal(f.click('terms?secret=no').event.prevented,undefined);assert.equal(f.calls.length,0);
});
