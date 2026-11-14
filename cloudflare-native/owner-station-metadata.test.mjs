import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';

const source=readFileSync(new URL('./public/assets/owner-station-metadata.js',import.meta.url),'utf8');
const css=readFileSync(new URL('./public/assets/owner-station-metadata.css',import.meta.url),'utf8');
const site=readFileSync(new URL('./public/assets/site.js',import.meta.url),'utf8');
const simplicity=readFileSync(new URL('./public/assets/owner-editor-simplicity.js',import.meta.url),'utf8');
const siteBetween=(start,end)=>site.slice(site.indexOf(start),site.indexOf(end));
// The server supplies this fixture; the production UI must not duplicate its enum list.
const options={categories:[{value:'news_talk',label:'News & talk'},{value:'christian',label:'Christian'}]};
const station={code:'13',zip_code:'01234',category:'christian'};

function fixture({withSignup=false}={}){
 const nodes=new Map(),windowHandlers=new Map(),observers=[];let focused=null,inputCount=0,networkCalls=0;
 class UiEvent{constructor(type,options={}){this.type=type;this.bubbles=!!options.bubbles;}}
 class Node{
  constructor(tag){this.tagName=tag.toUpperCase();this.children=[];this.parent=null;this.dataset={};this.attrs={};this.hidden=false;this.disabled=false;this.open=false;this.value='';this.textContent='';this.handlers=new Map();this.elements={};this.validityMessage='';this.files=[];}
  set id(value){this._id=value;nodes.set(value,this);}get id(){return this._id||'';}
  append(...children){for(const child of children){this.children.push(child);child.parent=this;}}
  before(child){const index=this.parent.children.indexOf(this);this.parent.children.splice(index,0,child);child.parent=this.parent;}
  closest(selector){for(let current=this;current;current=current.parent)if(selector==='label'&&current.tagName==='LABEL')return current;return null;}
  querySelector(selector){if(selector==='button[type="submit"]')return this.querySelectorAll('button').find(node=>node.type==='submit')||null;return null;}
  querySelectorAll(selector){const tags=selector.split(',').map(tag=>tag.toUpperCase()),result=[];const visit=node=>{for(const child of node.children){if(tags.includes(child.tagName))result.push(child);visit(child);}};visit(this);return result;}
  replaceChildren(...children){this.children=[];this.append(...children);}
  setAttribute(name,value){this.attrs[name]=value;}getAttribute(name){return this.attrs[name]??null;}removeAttribute(name){delete this.attrs[name];}
  addEventListener(type,fn){const group=this.handlers.get(type)||[];group.push(fn);this.handlers.set(type,group);}
  dispatchEvent(event){event.target??=this;for(const fn of this.handlers.get(event.type)||[])fn(event);if(event.bubbles)this.parent?.dispatchEvent(event);}
  setCustomValidity(message){this.validityMessage=message;}reportValidity(){return !this.validityMessage;}focus(){focused=this;}
 }
 const form=new Node('form');form.id='editForm';const bioLabel=new Node('label'),bio=new Node('textarea');bio.name='bio';bioLabel.append(bio);form.append(bioLabel);form.elements.bio=bio;
 // Named controls are a live HTMLFormControlsCollection in a real browser.
 form.elements=new Proxy(form.elements,{get(target,key){if(key in target)return target[key];const visit=node=>node.name===key?node:node.children.map(visit).find(Boolean);return visit(form);}});
 form.addEventListener('input',()=>inputCount++);
 let signupForm,signupZip,signupCategory,signupDetails;
 if(withSignup){signupForm=new Node('form');signupForm.id='registerForm';signupDetails=new Node('details');signupDetails.id='registrationStationDetails';signupDetails.open=true;signupZip=new Node('input');signupZip.id='registrationStationZip';signupZip.name='zip_code';signupZip.form=signupForm;signupCategory=new Node('select');signupCategory.id='registrationStationCategory';signupCategory.name='category';signupCategory.form=signupForm;for(const value of ['','news_talk','christian']){const option=new Node('option');option.value=value;signupCategory.append(option);}signupForm.append(signupDetails);signupDetails.append(signupZip,signupCategory);}
 const window={appI18n:{t:key=>key},addEventListener(type,fn){const group=windowHandlers.get(type)||[];group.push(fn);windowHandlers.set(type,group);},dispatchEvent(event){for(const fn of windowHandlers.get(event.type)||[])fn(event);}};
 const context=vm.createContext({window,document:{createElement:tag=>new Node(tag),getElementById:id=>nodes.get(id)},Event:UiEvent,queueMicrotask,MutationObserver:class{constructor(fn){this.fn=fn;}observe(target){observers.push({target,fn:this.fn});}},fetch(){networkCalls++;throw Error('Unexpected network call');},localStorage:{setItem(){throw Error('Metadata is not a display preference');}}});
 vm.runInContext(source,context);
 return {form,nodes,window,context,Node,bioLabel,signupForm,signupZip,signupCategory,signupDetails,details:nodes.get('ownerStationDetails'),zip:nodes.get('ownerStationZip'),category:nodes.get('ownerStationCategory'),notice:nodes.get('ownerStationMetadataMessage'),
  sync(record=station,configuration={metadataOptions:options}){form.dataset.stationCode=String(record?.code||'');window.syncOwnerStationMetadata(record,configuration);},
  change(control,value){control.value=value;control.dispatchEvent(new UiEvent(control.tagName==='INPUT'?'input':'change',{bubbles:true}));},event(type){window.dispatchEvent(new UiEvent(type));},
  notify(){for(const observer of observers)observer.fn();},reset(){form.dispatchEvent(new UiEvent('reset'));},
  get focused(){return focused;},get inputCount(){return inputCount;},get networkCalls(){return networkCalls;},saveValues(){return {...window.metadataSaveValues()};}
 };
}

test('complete owner details are collapsed before Bio, required, and use the received catalog',()=>{
 const f=fixture();assert.equal(f.form.children[0],f.details);assert.equal(f.form.children[1],f.bioLabel);assert.equal(f.details.open,false);assert.equal(f.zip.disabled,true);
 f.sync();assert.equal(f.details.open,false);assert.equal(f.zip.disabled,false);assert.equal(f.category.disabled,false);assert.equal(f.zip.required,true);assert.equal(f.category.required,true);assert.equal(f.zip.tagName,'INPUT');assert.equal(f.zip.type,'text');assert.equal(f.zip.getAttribute('inputmode'),'numeric');assert.equal(f.zip.getAttribute('maxlength'),'5');assert.equal(f.zip.getAttribute('pattern'),'[0-9]{5}');assert.equal(f.zip.getAttribute('autocomplete'),'postal-code');assert.equal(f.zip.value,'01234');assert.deepEqual(f.category.children.map(node=>node.value),['','news_talk','christian']);assert.equal(f.category.children[0].textContent,'Choose category');assert.equal(f.category.children.find(node=>node.value==='christian').textContent,'Religion');assert.deepEqual(f.saveValues(),{zip_code:'01234',category:'christian'});assert.equal(f.nodes.has('ownerStationLanguage'),false);assert.equal(f.networkCalls,0);
});

test('editing required metadata dirties only the editor and clearing Category cannot produce a save value',()=>{
 const f=fixture();f.sync();f.change(f.zip,'04567');assert.equal(f.form.dataset.dirty,'1');assert.equal(f.inputCount,1);assert.equal(f.saveValues().zip_code,'04567');
 f.change(f.category,'');assert.deepEqual(f.saveValues(),{});assert.equal(f.window.prepareOwnerStationMetadata(),false);assert.equal(f.focused,f.category);assert.match(f.category.validityMessage,/Choose a category/);f.change(f.category,'news_talk');assert.equal(f.window.prepareOwnerStationMetadata(),true);assert.deepEqual(f.saveValues(),{zip_code:'04567',category:'news_talk'});assert.equal(f.networkCalls,0);
});

test('same-station background reads preserve a draft; explicit refresh accepts the latest data',()=>{
 const f=fixture();f.sync();f.details.open=true;f.change(f.zip,'04567');f.sync({...station,zip_code:'01234'},{preserveDraft:true,metadataOptions:options});assert.equal(f.zip.value,'04567');assert.equal(f.details.open,true);
 f.sync({...station,zip_code:'01234'});assert.equal(f.zip.value,'01234');assert.equal(f.details.open,true);
});

test('legacy omitted fields and missing same-station catalog do not clear saved metadata',()=>{
 const f=fixture();f.sync();f.sync({code:'13'},{preserveDraft:false});assert.deepEqual(f.saveValues(),{zip_code:'01234',category:'christian'});
 f.sync({code:'13',zip_code:'',category:''},{preserveDraft:false});assert.deepEqual(f.saveValues(),{});assert.equal(f.details.open,true);assert.equal(f.window.prepareOwnerStationMetadata(),false);assert.equal(f.focused,f.zip);f.change(f.zip,'01234');assert.equal(f.window.prepareOwnerStationMetadata(),false);assert.equal(f.focused,f.category);
});

test('a different station does not inherit the previous values, draft, or catalog',()=>{
 const f=fixture();f.sync();f.change(f.zip,'04567');f.details.open=true;f.sync({code:'14'},{preserveDraft:true});assert.equal(f.zip.value,'');assert.equal(f.category.value,'');assert.equal(f.details.open,true);assert.equal(f.zip.disabled,false);assert.equal(f.category.disabled,true);assert.deepEqual(f.saveValues(),{});
 f.sync({code:'14'},{metadataOptions:options});assert.deepEqual(f.saveValues(),{});assert.equal(f.details.open,true);
});

test('catalog failure preserves edits and saved Category but blocks saving with a clear required-details notice',()=>{
 const f=fixture();f.sync(station,{metadataOptions:{categories:[{value:'bad value',label:'Bad'}]}});assert.equal(f.zip.disabled,false);assert.equal(f.category.disabled,true);assert.equal(f.form.elements.bio.disabled,false);assert.equal(f.category.value,'christian');assert.equal(f.notice.hidden,false);assert.match(f.notice.textContent,/Refresh the editor before saving/);assert.equal(f.window.prepareOwnerStationMetadata(),false);assert.equal(f.focused,f.notice);assert.equal(f.details.open,true);assert.deepEqual(f.saveValues(),{});
 f.change(f.zip,'04567');assert.deepEqual(f.saveValues(),{});assert.equal(f.zip.value,'04567');
 f.sync(station,{metadataOptions:options});assert.equal(f.zip.disabled,false);assert.equal(f.notice.hidden,true);assert.deepEqual(f.saveValues(),{zip_code:'01234',category:'christian'});
});

test('tampered metadata cannot be submitted as a valid enum',()=>{
 const f=fixture();f.sync();f.change(f.category,'untrusted-category');assert.equal(f.window.prepareOwnerStationMetadata(),false);assert.equal(f.details.open,true);assert.equal(f.focused,f.category);assert.match(f.category.validityMessage,/available/);assert.deepEqual(f.saveValues(),{});
 f.change(f.category,'news_talk');assert.equal(f.window.prepareOwnerStationMetadata(),true);assert.equal(f.category.validityMessage,'');assert.equal(f.saveValues().category,'news_talk');
});

test('busy state and logout keep disabled controls from leaking another owner\'s metadata',async()=>{
 const f=fixture();f.sync();f.form.dataset.busy='1';f.notify();assert.equal(f.zip.disabled,true);assert.equal(f.saveValues().zip_code,'01234');delete f.form.dataset.busy;f.notify();assert.equal(f.zip.disabled,false);
 f.reset();await Promise.resolve();assert.equal(f.zip.disabled,true);assert.equal(f.zip.value,'');assert.deepEqual(f.saveValues(),{});assert.equal(f.details.open,false);
});

test('display-language changes relabel the ZIP and Category fields without changing values or creating a draft',()=>{
 const f=fixture();f.sync();f.change(f.zip,'04567');const count=f.inputCount;f.window.appI18n={t:key=>({'metadata.details':'Detay estasyon','metadata.zip':'Kòd ZIP','metadata.category.christian':'Relijyon','metadata.chooseCategory':'Chwazi kategori'}[key]||key)};f.event('app-language-changed');
 assert.equal(f.details.children[0].textContent,'Detay estasyon');assert.equal(f.zip.parent.children[0].textContent,'Kòd ZIP');assert.equal(f.zip.value,'04567');assert.equal(f.category.children.find(node=>node.value==='christian').textContent,'Relijyon');assert.equal(f.inputCount,count);assert.equal(f.saveValues().zip_code,'04567');
});

test('required owner ZIP preserves leading zeroes and rejects empty or non-five-ASCII-digit values',()=>{
 const f=fixture();f.sync();
 for(const value of ['', '1234','123456','12a45',' 12345','12345 ','１２３４５','١٢٣٤٥','12345-6789']){f.change(f.zip,value);assert.equal(f.window.prepareOwnerStationMetadata(),false,value);assert.equal(f.focused,f.zip,value);assert.equal(f.details.open,true);assert.match(f.zip.validityMessage,/5-digit/);assert.deepEqual(f.saveValues(),{});}
 for(const value of ['00001','01234','90210']){f.change(f.zip,value);assert.equal(f.window.prepareOwnerStationMetadata(),true,value);assert.equal(f.zip.validityMessage,'');assert.equal(f.saveValues().zip_code,value);}
});

test('signup requires ZIP and Category, opens/focuses invalid fields, and reset clears validation but not expansion',()=>{
 const f=fixture({withSignup:true});assert.equal(f.window.prepareRegistrationStationMetadata(),false);assert.equal(f.focused,f.signupZip);
 for(const value of ['', '1234','123456','12a45',' 12345','１２３４５']){f.signupDetails.open=false;f.change(f.signupZip,value);assert.equal(f.window.prepareRegistrationStationMetadata(),false,value);assert.equal(f.signupDetails.open,true);assert.equal(f.focused,f.signupZip);assert.match(f.signupZip.validityMessage,/5-digit/);}
 f.change(f.signupZip,'01234');assert.equal(f.window.prepareRegistrationStationMetadata(),false);assert.equal(f.focused,f.signupCategory);assert.match(f.signupCategory.validityMessage,/Choose a category/);f.change(f.signupCategory,'unexpected');assert.equal(f.window.prepareRegistrationStationMetadata(),false);f.change(f.signupCategory,'christian');assert.equal(f.window.prepareRegistrationStationMetadata(),true);assert.equal(f.signupZip.value,'01234');
 f.signupDetails.open=false;f.signupCategory.dispatchEvent({type:'invalid'});assert.equal(f.signupDetails.open,true);f.change(f.signupZip,'bad');f.change(f.signupCategory,'');f.signupForm.dispatchEvent({type:'reset'});assert.equal(f.signupZip.validityMessage,'');assert.equal(f.signupCategory.validityMessage,'');assert.equal(f.signupDetails.open,true);f.signupZip.value='';assert.equal(f.window.prepareRegistrationStationMetadata(),false);
});

test('small-phone controls keep touch targets and a single-column fallback',()=>{
 assert.match(css,/:is\(select,input\)\{[^}]*min-height:46px/);assert.match(css,/>summary\{[^}]*min-height:46px/);assert.match(css,/@media\(max-width:360px\)/);assert.match(css,/prefers-reduced-motion/);
});

test('real owner GET/apply/save integration preserves a metadata draft and captures it before busy disables controls',async()=>{
 const f=fixture(),{context,Node}=f,calls=[],feedback=[],answers=[];
 for(const id of ['editor','ownerName','ownerStatus','ownerSaveState','ownerStreamSettings','ownerAccountOptions','ownerStreamTestStatus']){const node=new Node('div');node.id=id;}
 for(const name of ['name','stream_url','artwork']){const node=new Node('input');node.id=name;node.name=name;f.form.append(node);}
 const save=new Node('button');save.id='ownerSave';save.type='submit';f.form.append(save);
 Object.assign(context,{$:id=>f.nodes.get(id),state:{owner_station:13},ownerSessionGeneration:0,ownerLogoutBusy:false,sitePageGeneration:0,TextEncoder,URL,Event:class{constructor(type,init={}){this.type=type;this.bubbles=!!init.bubbles;}},
  page(id){context.sitePageGeneration++;f.nodes.get('editor').hidden=id!=='editor';},ownerText:(_key,fallback)=>fallback,ownerEditFeedback:(...args)=>feedback.push(args),showOwnerCover(){},ownerRefreshFeedback(){},ownerChangesSaved(){},fileData:async()=>undefined,
  api:async(path,body)=>{calls.push({path,body});const answer=answers.shift();if(answer instanceof Error)throw answer;return answer;}});
 f.window.parsePublicStreamUrl=value=>new URL(value);f.window.syncOwnerStreamSaveGate=()=>{f.form.dataset.streamSaveAllowed='true';};f.window.ownerStreamSaveAllowed=()=>true;
 vm.runInContext(simplicity,context);
 vm.runInContext(siteBetween('const formBusyStates=','function loadHuman()'),context);
 vm.runInContext(siteBetween('function applyOwnerStation(',"$('openLogin').onclick="),context);
 vm.runInContext(siteBetween("$('editForm').onsubmit=async event=>","$('logout').onclick="),context);
 const record={...station,name:'Community Radio',bio:'Local news',stream_url:'https://stream.example/live',revision:'revision-one',status:'published',stream_check:{status:'passed'},approved:{status:'published',stream_url:'https://stream.example/live'}};
 answers.push({station:record,metadata_options:options});await context.editor(false);
 assert.equal(f.zip.disabled,false);assert.equal(save.disabled,true);assert.equal(f.zip.value,'01234');
 f.change(f.zip,'04567');assert.equal(save.disabled,false);f.change(f.zip,'01234');assert.equal(save.disabled,true);f.change(f.zip,'04567');f.change(f.category,'news_talk');assert.equal(save.disabled,false);assert.equal(f.window.ownerEditorNeedsSave(),true);
 answers.push({station:{...record,zip_code:'04567',category:'news_talk',revision:'revision-two'},metadata_options:options});await context.editor(true);
 assert.equal(f.zip.value,'04567');assert.equal(f.category.value,'news_talk');assert.equal(f.form.dataset.revision,'revision-one');assert.equal(save.disabled,false);assert.equal(feedback.at(-1)[2],true);
 // A write commits, then its refresh fails. The saved metadata must remain
 // visible and clean; capture cannot read disabled controls as empty strings.
 answers.push({message:'Changes saved successfully.'},Error('Refresh temporarily unavailable'));
 await f.form.onsubmit({target:f.form,preventDefault(){}});
 const write=calls.find(call=>call.body);assert.equal(write.path,'/api/owner/station');assert.equal(write.body.zip_code,'04567');assert.equal(write.body.category,'news_talk');assert.equal(Object.hasOwn(write.body,'language'),false);assert.equal(write.body.revision,'revision-one');assert.equal(f.category.disabled,false);assert.equal(f.category.value,'news_talk');assert.equal(save.disabled,true);assert.equal(f.window.ownerEditorNeedsSave(),false);
 f.change(f.category,'christian');assert.equal(save.disabled,false);f.change(f.category,'news_talk');assert.equal(save.disabled,true);
});
