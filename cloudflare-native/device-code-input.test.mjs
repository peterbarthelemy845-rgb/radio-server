import {test} from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';

const source=readFileSync(new URL('./public/assets/device-code-input.js',import.meta.url),'utf8');
const radioSource=readFileSync(new URL('./public/assets/my-radio.js',import.meta.url),'utf8');
function fixture({description=null,invalid=null,language='en'}={}){
 const nodes=new Map(),events=new Map(),observers=[];let focused=null,securityCalls=0,networkCalls=0;
 function element(id){const attrs=new Map(),listeners=new Map();return {id,value:'',dataset:{},textContent:'',hidden:false,attrs,listeners,
  setAttribute(name,value){attrs.set(name,String(value));},getAttribute(name){return attrs.get(name)??null;},removeAttribute(name){attrs.delete(name);},
  addEventListener(type,handler){const list=listeners.get(type)||[];list.push(handler);listeners.set(type,list);},
  dispatch(type){const event={type,prevented:false,preventDefault(){this.prevented=true;}};for(const fn of listeners.get(type)||[])fn(event);return event;},
  after(node){this.error=node;node.afterAnchor=this;},focus(){focused=this;}};}
 for(const id of ['connectRadioForm','shareForm']){const form=element(id),input=element(id+'Code'),label=element(id+'Label');label.textContent='Device Code';input.label=label;input.closest=selector=>selector==='label'?label:null;Object.defineProperty(input,'error',{get:()=>label.error});form.elements={device_code:input};input.form=form;if(description!==null)input.setAttribute('aria-describedby',description);if(invalid!==null)input.setAttribute('aria-invalid',invalid);nodes.set(id,form);}
 const window={appI18n:{t:key=>language==='ht'?'Antre tout Kòd Aparèy ki parèt sou radyo ou a.':key},addEventListener(type,fn){events.set(type,fn);}};
 const context=vm.createContext({window,document:{getElementById:id=>nodes.get(id),createElement:tag=>element(tag)},MutationObserver:class{constructor(callback){this.callback=callback;}observe(target,options){observers.push({target,options,callback:this.callback});}},human(){securityCalls++;throw Error('Unexpected security check');},api(){networkCalls++;throw Error('Unexpected request');}});vm.runInContext(source,context);
 return {window,nodes,context,main:nodes.get('connectRadioForm').elements.device_code,shared:nodes.get('shareForm').elements.device_code,validate:window.validateDeviceCodeInput,focused:()=>focused,calls:()=>[securityCalls,networkCalls],language(value){language=value;events.get('app-language-changed')();},labelHidden(field,hidden){field.label.hidden=hidden;for(const observer of observers)if(observer.target===field.label)observer.callback([{target:field.label,attributeName:'hidden'}]);}};
}

test('main and shared fields normalize pasted separators and case while preserving numeric leading zeroes',()=>{
 const f=fixture();
 for(const field of [f.main,f.shared])for(const [raw,expected] of [[' 0039 ','0039'],['00 12-34 56','00123456'],[' abcd- ef12 ','ABCDEF12'],['7r8b-vc6y','7R8BVC6Y'],['12345','12345'],['1234567','1234567']]){field.value=raw;assert.equal(f.validate(field),expected,raw);assert.equal(field.value,expected);assert.equal(field.error.hidden,true);}
 assert.deepEqual(f.calls(),[0,0]);
});

test('invalid code formats stop locally, retain the typed text and focus accessible inline feedback',()=>{
 const f=fixture();
 for(const field of [f.main,f.shared])for(const raw of ['', ' ', '123', '123456789', 'ABC123', 'ABCDEF123', '12.34', '12_34', '1234!', '<3961>', '３９６１', '7R8B–VC6Y']){
  field.value=raw;assert.equal(f.validate(field),null,raw);assert.equal(field.value,raw);assert.equal(field.getAttribute('aria-invalid'),'true');assert.equal(field.error.hidden,false);assert.equal(field.error.getAttribute('role'),'alert');assert.match(field.error.textContent,/complete Device Code/);assert.ok(field.getAttribute('aria-describedby').split(/\s+/).includes(field.error.id));assert.equal(f.focused(),field);field.dispatch('input');
 }
 assert.deepEqual(f.calls(),[0,0]);
});

test('editing clears only this helper error and preserves existing and newly added descriptions',()=>{
 const f=fixture({description:'codeHelp originalDescription',invalid:'false'});f.main.value='123';f.validate(f.main);const id=f.main.error.id;
 f.main.setAttribute('aria-describedby',f.main.getAttribute('aria-describedby')+' serverDescription');f.main.dispatch('input');
 assert.equal(f.main.error.hidden,true);assert.equal(f.main.error.textContent,'');assert.equal(f.main.getAttribute('aria-invalid'),'false');assert.equal(f.main.getAttribute('aria-describedby'),'codeHelp originalDescription serverDescription');assert.doesNotMatch(f.main.getAttribute('aria-describedby'),new RegExp(id));
 f.shared.value='bad';f.validate(f.shared);assert.equal(f.main.error.hidden,true);assert.equal(f.shared.error.hidden,false);
});

test('valid retries and form reset remove helper attributes without erasing another validator state',()=>{
 const f=fixture();f.main.value='bad';f.validate(f.main);f.main.value='0123';assert.equal(f.validate(f.main),'0123');assert.equal(f.main.getAttribute('aria-invalid'),null);assert.equal(f.main.getAttribute('aria-describedby'),null);
 f.main.value='no';f.validate(f.main);f.main.setAttribute('aria-invalid','grammar');f.nodes.get('connectRadioForm').dispatch('reset');assert.equal(f.main.getAttribute('aria-invalid'),'grammar');assert.equal(f.main.error.hidden,true);assert.equal(f.main.getAttribute('aria-describedby'),null);
 const g=fixture({description:'',invalid:'true'});g.main.value='no';g.validate(g.main);g.main.dispatch('input');assert.equal(g.main.getAttribute('aria-describedby'),'');assert.equal(g.main.getAttribute('aria-invalid'),'true');
});

test('native required-field errors use the same inline feedback and repeated checks never duplicate description IDs',()=>{
 const f=fixture();f.main.value='';assert.equal(f.main.dispatch('invalid').prevented,true);const error=f.main.error,id=error.id;f.validate(f.main);f.validate(f.main);
 assert.equal(f.main.error,error);assert.equal(f.main.getAttribute('aria-describedby'),id);assert.notEqual(f.main.error.id,f.shared.error.id);assert.deepEqual(f.calls(),[0,0]);
});

test('active field errors translate in place without rewriting codes or revealing hidden server feedback',()=>{
 const f=fixture();f.main.value='12_34';f.validate(f.main);f.language('ht');assert.match(f.main.error.textContent,/Kòd Aparèy/);assert.equal(f.main.value,'12_34');assert.equal(f.shared.error.hidden,true);assert.equal(f.shared.error.textContent,'');f.main.dispatch('input');f.language('en');assert.equal(f.main.error.textContent,'');assert.equal(f.main.error.hidden,true);
});

test('inline feedback stays outside the accessible label and follows the manual field visibility',()=>{
 const f=fixture({description:'codeHelp'});f.shared.value='bad';f.validate(f.shared);const error=f.shared.error;
 assert.equal(error.afterAnchor,f.shared.label);assert.equal(f.shared.label.textContent,'Device Code');assert.equal(error.hidden,false);assert.equal(error.getAttribute('role'),'alert');
 f.labelHidden(f.shared,true);assert.equal(error.hidden,true);assert.equal(f.shared.getAttribute('aria-invalid'),'true');assert.ok(f.shared.getAttribute('aria-describedby').includes(error.id));
 f.language('ht');assert.match(error.textContent,/Kòd Aparèy/);assert.equal(error.hidden,true);assert.equal(f.shared.label.textContent,'Device Code');f.labelHidden(f.shared,false);assert.equal(error.hidden,false);
 f.labelHidden(f.shared,true);f.shared.dispatch('input');assert.equal(f.shared.getAttribute('aria-describedby'),'codeHelp');assert.equal(f.shared.getAttribute('aria-invalid'),null);f.labelHidden(f.shared,false);assert.equal(error.hidden,true);assert.equal(error.textContent,'');
});

test('the real Radio submit hook stops invalid codes before session, busy, security and network work',async()=>{
 const f=fixture(),calls=[];
 Object.assign(f.context,{$:id=>f.nodes.get(id),AbortController,crypto:{randomUUID:()=>{calls.push('uuid');return 'test-request';}},busy:()=>calls.push('busy'),loadOwnerSession:async()=>calls.push('session'),human:async()=>calls.push('security'),api:async()=>calls.push('request'),currentRadioPairing:()=>true,cancelRadioPairingRequest:()=>calls.push('cancel')});
 vm.runInContext("let radioPairingBusy=false,radioPairingGeneration=0,radioPairingAttempt=null,radioSessionExpired=true,radioPairingCancellation=Promise.resolve();",f.context);
 vm.runInContext(radioSource.slice(radioSource.indexOf("$('connectRadioForm').onsubmit="),radioSource.indexOf("window.addEventListener('radio-locals-ready'")),f.context);
 for(const value of ['123','123456789','1234!','１２３４']){f.main.value=value;await f.nodes.get('connectRadioForm').onsubmit({preventDefault(){},target:f.nodes.get('connectRadioForm')});assert.deepEqual(calls,[]);assert.equal(vm.runInContext('radioPairingBusy',f.context),false);assert.equal(f.main.error.hidden,false);}
});

test('the real Radio submit hook sends a normalized zero-prefixed code without numeric coercion',async()=>{
 const f=fixture(),requests=[];let checks=0;f.main.value=' 00-39 ';
 f.nodes.set('cancelRadioConnection',{hidden:true});f.nodes.set('radioConnectStatus',{textContent:''});
 Object.assign(f.context,{$:id=>f.nodes.get(id),AbortController,crypto:{randomUUID:()=> 'local-request'},busy(){},human:async()=>{checks++;return 'checked-token';},api:async(path,body)=>{requests.push({path,body});throw Error('Test response');},currentRadioPairing:()=>true,cancelRadioPairingRequest(){}});
 vm.runInContext("let radioPairingBusy=false,radioPairingGeneration=0,radioPairingAttempt=null,radioSessionExpired=false,radioPairingCancellation=Promise.resolve();",f.context);
 vm.runInContext(radioSource.slice(radioSource.indexOf("$('connectRadioForm').onsubmit="),radioSource.indexOf("window.addEventListener('radio-locals-ready'")),f.context);
 await f.nodes.get('connectRadioForm').onsubmit({preventDefault(){},target:f.nodes.get('connectRadioForm')});
 assert.equal(checks,1);assert.equal(requests.length,1);assert.equal(requests[0].path,'/api/phone/claim');assert.equal(requests[0].body.device_code,'0039');assert.equal(requests[0].body.turnstile_token,'checked-token');assert.equal(f.main.value,'0039');assert.equal(f.main.error.hidden,true);
});
