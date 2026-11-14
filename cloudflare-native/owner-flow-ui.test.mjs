import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';

const site=readFileSync(new URL('./public/assets/site.js',import.meta.url),'utf8');
const slice=(start,end)=>site.slice(site.indexOf(start),site.indexOf(end));
function fixture(){
 const nodes=new Map(),windowEvents=new Map(),calls=[],responses=[];let focused,created=0;
 class UiEvent{constructor(type,options={}){this.type=type;Object.assign(this,options);}preventDefault(){this.prevented=true;}}
 class Node{
  constructor(tag='div'){this.tagName=tag.toUpperCase();this.children=[];this.dataset={};this.attrs={};this.handlers=new Map();this.hidden=false;this.disabled=false;this.open=false;this.elements={};this.files=[];this.textContent='';this._value='';}
  set id(value){this._id=value;nodes.set(value,this);}get id(){return this._id;}
  set value(value){this._value=value;if(this.type==='file'&&value==='')this.files=[];}get value(){return this._value;}
  append(...children){for(const child of children){this.children.push(child);child.parent=this;if(child.name)this.elements[child.name]=child;}}
  after(child){this.afterNode=child;}before(child){this.beforeNode=child;}
  addEventListener(type,fn){const entries=this.handlers.get(type)||[];entries.push(fn);this.handlers.set(type,entries);}
  dispatchEvent(event){event.target??=this;for(const fn of this.handlers.get(event.type)||[])fn(event);if(event.bubbles)this.parent?.dispatchEvent(event);return !event.prevented;}
  setAttribute(key,value){this.attrs[key]=value;}getAttribute(key){return this.attrs[key]??null;}removeAttribute(key){delete this.attrs[key];}
  querySelector(){return null;}focus(){focused=this;}setCustomValidity(value){this.validationMessage=value;}
  reset(){for(const node of this.children)node.reset?.();if(['INPUT','TEXTAREA'].includes(this.tagName))this.value='';for(const field of Object.values(this.elements))field.value='';}
  showModal(){this.open=true;}close(){this.open=false;this.dispatchEvent(new UiEvent('close'));}
 }
 const make=(id,tag)=>{const node=new Node(tag);node.id=id;return node;};
 for(const id of ['registerForm','loginForm','verifyForm','verification','closeVerify','verifyText','verifyMessage','resend','editForm','ownerCover','ownerCoverEmpty','ownerArtworkMessage'])make(id,id.endsWith('Form')?'form':'div');
 const code=make('code','input');code.attrs.maxlength='6';nodes.get('verifyForm').append(code);code.name='code';nodes.get('verifyForm').elements.code=code;
 const art=make('artwork','input');art.type='file';art.name='artwork';nodes.get('editForm').append(art);nodes.get('editForm').elements.artwork=art;
 const window={appI18n:{t:key=>key},addEventListener(type,fn){const entries=windowEvents.get(type)||[];entries.push(fn);windowEvents.set(type,entries);},dispatchEvent(event){for(const fn of windowEvents.get(event.type)||[])fn(event);},inspectStationLogo:async()=>({valid:true}),renderOwnerEditorState(){}};
 const context=vm.createContext({window,document:{getElementById:id=>nodes.get(id)||null,createElement:tag=>{const node=new Node(tag);node.id='created-'+created++;return node;}},$:id=>nodes.get(id),state:{owner_station:null},sitePageGeneration:1,verificationId:null,Event:UiEvent,Date,setTimeout:()=>1,clearTimeout(){},busy(){},formIsBusy:()=>false,ownerText:(_key,fallback)=>fallback,URL:{createObjectURL:()=> 'blob:replacement',revokeObjectURL(){}},queueMicrotask,
  human:async()=> 'bot-token',api:async(path,body)=>{calls.push({path,body});return await responses.shift();}});
 vm.runInContext(slice('let verificationGeneration=','function registrationMessage('),context);
 vm.runInContext(slice("$('verification').addEventListener('cancel'", "$('registerForm').addEventListener('reset'"),context);
 vm.runInContext('initializeOwnerFlowUI();',context);
 return {nodes,window,context,calls,responses,UiEvent,focused:()=>focused,
  verify(result={verification_id:'a'.repeat(32),verification_email:'o***@example.com',verification_purpose:'registration',expires_in:900}){context.verify(result);},close(){nodes.get('verification').close();},invalidate(){context.invalidateOwnerVerification();},pending:()=>vm.runInContext('ownerPendingVerification',context)};
}

test('Close for now keeps a private in-memory Continue action without automatically reopening after navigation',()=>{
 const f=fixture(),button=f.nodes.get('continueRegistrationVerification');assert.equal(button.hidden,true);assert.equal(f.nodes.get('verification').open,false);
 f.verify();assert.equal(f.nodes.get('verification').open,true);f.close();assert.equal(f.nodes.get('verification').open,false);assert.equal(button.hidden,false);assert.equal(f.pending().verification_id,'a'.repeat(32));
 f.context.sitePageGeneration++;f.invalidate();assert.equal(f.nodes.get('verification').open,false);button.onclick();assert.equal(f.nodes.get('verification').open,true);assert.equal(f.nodes.get('changeVerificationEmail').hidden,false);
 assert.doesNotMatch(site.slice(site.indexOf('let verificationGeneration='),site.indexOf('function list()')),/localStorage|sessionStorage/);
});

test('masked session resume offers Continue without opening a dialog or sending email',()=>{
 const f=fixture();f.window.dispatchEvent({type:'owner-session-updated',detail:{pending_verification:{verification_id:'b'.repeat(32),verification_email:'n***@example.com',verification_purpose:'registration',expires_in:0}}});
 assert.equal(f.nodes.get('verification').open,false);assert.equal(f.nodes.get('continueRegistrationVerification').hidden,false);assert.equal(f.calls.length,0);
 f.nodes.get('continueRegistrationVerification').onclick();assert.match(f.nodes.get('verifyMessage').textContent,/expired.*new code/);assert.equal(f.nodes.get('resend').disabled,false);
});

test('six-digit email codes pasted with spaces are normalized before native length and pattern validation',()=>{
 const f=fixture(),input=f.nodes.get('code'),event=new f.UiEvent('paste',{clipboardData:{getData:()=> ' 123 456\n'}});input.dispatchEvent(event);assert.equal(event.prevented,true);assert.equal(input.value,'123456');assert.equal(input.attrs.maxlength,undefined);
 input.value='12 34 56';input.dispatchEvent(new f.UiEvent('input'));assert.equal(input.value,'123456');
});

test('Change email stays inside the verification dialog and uses the bound pending challenge',async()=>{
 const f=fixture();f.verify();f.nodes.get('changeVerificationEmail').onclick();const form=f.nodes.get('changeVerificationEmailForm');assert.equal(form.hidden,false);const input=form.children[0].children.find(node=>node.name==='email');input.value='new@example.com';
 f.responses.push({verification_id:'c'.repeat(32),verification_email:'n***@example.com',verification_purpose:'registration',expires_in:900});await form.onsubmit({preventDefault(){}});
 assert.deepEqual({...f.calls[0].body},{verification_id:'a'.repeat(32),email:'new@example.com',turnstile_token:'bot-token'});assert.equal(f.calls[0].path,'/api/owner/change-email');assert.equal(f.pending().verification_id,'c'.repeat(32));assert.match(f.nodes.get('verifyMessage').textContent,/previous code no longer/);assert.equal(form.hidden,true);
 f.verify({verification_id:'d'.repeat(32),verification_email:'o***@example.com',verification_purpose:'edit'});assert.equal(f.nodes.get('changeVerificationEmail').hidden,true);
});

test('a late Change email response cannot reopen an abandoned verification dialog',async()=>{
 const f=fixture();f.verify();let finish;f.responses.push(new Promise(resolve=>{finish=resolve;}));const form=f.nodes.get('changeVerificationEmailForm');form.children[0].children.find(node=>node.name==='email').value='new@example.com';const request=form.onsubmit({preventDefault(){}});await Promise.resolve();await Promise.resolve();f.context.sitePageGeneration++;f.invalidate();finish({verification_id:'e'.repeat(32),verification_email:'n***@example.com',verification_purpose:'registration'});await request;assert.equal(f.nodes.get('verification').open,false);assert.equal(f.pending().verification_id,'a'.repeat(32));
});

test('Keep current logo cancels only the replacement and preserves station text edits',async()=>{
 const f=fixture(),form=f.nodes.get('editForm');form.elements.bio={value:'My unsaved bio'};form.elements.name={value:'Unsaved station title'};
 vm.runInContext(slice('let ownerCoverObjectUrl,',"window.addEventListener?.('pagehide'"),f.context);f.context.showOwnerCover('/api/owner/artwork');const input=form.elements.artwork;input.files=[{name:'new.png'}];await input.onchange({target:input});input.dispatchEvent(new f.UiEvent('change'));assert.equal(f.nodes.get('keepOwnerCover').hidden,false);
 f.nodes.get('keepOwnerCover').onclick();assert.equal(input.files.length,0);assert.equal(f.nodes.get('ownerCover').src,'/api/owner/artwork');assert.equal(form.elements.bio.value,'My unsaved bio');assert.equal(form.elements.name.value,'Unsaved station title');assert.equal(f.nodes.get('keepOwnerCover').hidden,true);
});
