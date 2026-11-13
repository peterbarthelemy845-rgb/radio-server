import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';

const simplicity=readFileSync(new URL('./public/assets/owner-editor-simplicity.js',import.meta.url),'utf8');
const streamGate=readFileSync(new URL('./public/assets/editor-stream-test.js',import.meta.url),'utf8');
const original={code:'13',name:'Community Radio',bio:'Local news',stream_url:'https://stream.example/live',revision:'revision-one',status:'published',stream_check:{status:'passed'},approved:{status:'published',stream_url:'https://stream.example/live'}};

function fixture(record=original){
 const nodes=new Map(),events=new Map(),observers=[],timers=new Map(),calls=[];let clock=100000,timerId=0,result={result:'audio_response',audio_response:true};
 class UiEvent{constructor(type,options={}){this.type=type;this.bubbles=!!options.bubbles;this.detail=options.detail;}}
 function node(id){const handlers=new Map(),element={id,hidden:false,open:false,disabled:false,textContent:'',value:'',dataset:{},attrs:{},files:[],elements:{},parent:null,
  addEventListener(type,fn){const group=handlers.get(type)||[];group.push(fn);handlers.set(type,group);},dispatchEvent(event){event.target??=this;for(const fn of handlers.get(event.type)||[])fn(event);if(event.bubbles)this.parent?.dispatchEvent(event);},
  getAttribute(name){return this.attrs[name]??null;},setAttribute(name,value){this.attrs[name]=value;},removeAttribute(name){delete this.attrs[name];},focus(){},querySelector(selector){return selector==='button[type="submit"]'?nodes.get('ownerSave'):null;}
 };nodes.set(id,element);return element;}
 for(const id of ['editor','editForm','ownerSave','ownerSaveState','ownerStreamSettings','ownerAccountOptions','testOwnerStream','ownerStreamTestHuman','ownerStreamTestStatus','name','stream_url','bio','artwork','zip_code','category'])node(id);
 const form=nodes.get('editForm');for(const key of ['name','stream_url','bio','artwork','zip_code','category']){form.elements[key]=nodes.get(key);nodes.get(key).parent=form;}
 const window={appI18n:{t:key=>key},parsePublicStreamUrl:value=>new URL(value),addEventListener(type,fn){const group=events.get(type)||[];group.push(fn);events.set(type,group);},dispatchEvent(event){for(const fn of events.get(event.type)||[])fn(event);}};
 const context=vm.createContext({window,document:{getElementById:id=>nodes.get(id)},Event:UiEvent,URL,AbortController,Date:{now:()=>clock},queueMicrotask,
  setTimeout(fn,delay){const id=++timerId;timers.set(id,{fn,at:clock+delay});return id;},clearTimeout:id=>timers.delete(id),MutationObserver:class{constructor(fn){this.fn=fn;}observe(target,options){observers.push({target,options,fn:this.fn});}},
  human:async()=> 'checked-token',api:async(path,body)=>{calls.push({path,body});if(result instanceof Error)throw result;return result;},setBusyButtonLabel:button=>{const old=button.textContent;return ()=>{button.textContent=old;};}
 });
 vm.runInContext(streamGate,context);vm.runInContext(simplicity,context);
 function sync(next,options={}){if(!options.preserveDraft){const same=form.dataset.stationCode===String(next.code);form.dataset.stationCode=String(next.code);form.dataset.revision=next.revision||'';for(const key of ['name','stream_url','bio'])form.elements[key].value=next[key]||'';for(const key of ['zip_code','category'])if(!same||Object.hasOwn(next,key))form.elements[key].value=next[key]||'';form.elements.artwork.files=[];}window.syncOwnerStreamSaveGate(next);window.syncOwnerEditorState(next,options);}
 sync(record);
 return {nodes,form,window,calls,sync,save:nodes.get('ownerSave'),status:nodes.get('ownerSaveState'),stream:nodes.get('ownerStreamSettings'),options:nodes.get('ownerAccountOptions'),
  input(key,value){form.elements[key].value=value;form.elements[key].dispatchEvent(new UiEvent('input',{bubbles:true}));},
  file(file){form.elements.artwork.files=file?[file]:[];form.elements.artwork.dispatchEvent(new UiEvent('change',{bubbles:true}));},
  testStream:()=>nodes.get('testOwnerStream').onclick(),result(value){result=value;},
  saved(outcome={}){form.elements.artwork.files=[];window.ownerEditorSaved({...Object.fromEntries(['name','stream_url','bio','zip_code','category'].map(key=>[key,form.elements[key].value])),code:form.dataset.stationCode,revision:form.dataset.revision},outcome);},
  busy(on){if(on)form.dataset.busy='1';else delete form.dataset.busy;form.dispatchEvent(new UiEvent('form-busy-changed'));},
  advance(ms){clock+=ms;for(const [id,timer] of [...timers])if(timer.at<=clock){timers.delete(id);timer.fn();}},
  notify(target,attribute){for(const observer of observers)if(observer.target===target&&observer.options.attributeFilter.includes(attribute))observer.fn();},
  event(type){window.dispatchEvent(new UiEvent(type));}
 };
}

test('a clean approved station shows essentials with collapsed optional settings and Up to date',()=>{
 const f=fixture();assert.equal(f.save.disabled,true);assert.equal(f.window.ownerEditorNeedsSave(),false);assert.equal(f.window.ownerEditorSaveAllowed(),false);assert.equal(f.status.textContent,'Up to date');assert.equal(f.stream.open,false);assert.equal(f.options.open,false);
 for(const key of ['name','bio','artwork'])assert.equal(f.form.elements[key].disabled,false);
 f.form.dataset.dirty='1';f.window.renderOwnerEditorState();assert.equal(f.save.disabled,true);
});

test('Save follows actual normalized values or selected artwork, and disables when changes are reverted',()=>{
 const f=fixture();f.input('name','  Community Radio  ');assert.equal(f.save.disabled,true);
 f.input('name','New station');assert.equal(f.save.disabled,false);assert.equal(f.status.textContent,'Ready to save');f.input('name',original.name);assert.equal(f.save.disabled,true);
 f.input('bio','New bio');assert.equal(f.save.disabled,false);f.input('bio',' Local news ');assert.equal(f.save.disabled,true);
 f.file({name:'new-logo.png'});assert.equal(f.save.disabled,false);f.file(null);assert.equal(f.save.disabled,true);assert.equal(f.status.textContent,'Up to date');
});

test('changed streams expand their controls and still require the real stream-pass gate',async()=>{
 const f=fixture();f.input('stream_url','https://new.example/live');assert.equal(f.stream.open,true);assert.equal(f.save.disabled,true);assert.equal(f.window.ownerEditorSaveAllowed(),false);assert.match(f.status.textContent,/Test your stream/);
 await f.testStream();assert.equal(f.calls.length,1);assert.equal(f.save.disabled,false);assert.equal(f.window.ownerEditorSaveAllowed(),true);assert.equal(f.status.textContent,'Ready to save');
});

test('a clean unapproved stream can be repaired by Test then Save without inventing a metadata change',async()=>{
 const f=fixture({...original,status:'pending_review',approved:{status:'pending_review'},stream_check:{status:'needs_check'}});
 assert.equal(f.stream.open,true);assert.equal(f.window.ownerEditorNeedsSave(),true);assert.equal(f.save.disabled,true);assert.equal(f.nodes.get('testOwnerStream').disabled,false);
 await f.testStream();assert.equal(f.save.disabled,false);assert.equal(f.form.dataset.ownerChanged,'false');f.saved({stream_check_required:false});assert.equal(f.save.disabled,true);assert.equal(f.status.textContent,'Up to date');
 f.sync({...original,status:'pending_review',approved:{status:'pending_review'},stream_check:{status:'passed'}});assert.equal(f.save.disabled,true);assert.equal(f.status.textContent,'Up to date');
});

test('server status alone cannot skip the current-session check needed to repair an unapproved stream',async()=>{
 const f=fixture({...original,status:'pending_review',approved:{status:'pending_review'},stream_check:{status:'passed'}});
 assert.equal(f.window.ownerEditorNeedsSave(),true);assert.equal(f.save.disabled,true);await f.testStream();assert.equal(f.save.disabled,false);
});

test('metadata editing on the unchanged approved URL needs no extra stream test',()=>{
 const f=fixture();f.input('bio','Updated programme');assert.equal(f.save.disabled,false);assert.equal(f.stream.open,false);assert.equal(f.calls.length,0);assert.equal(f.window.ownerEditorSaveAllowed(),true);
});

test('optional station ZIP and category edits enable Save without retesting the approved stream',()=>{
 const f=fixture({...original,zip_code:'01234',category:'christian'});assert.equal(f.save.disabled,true);
 f.input('zip_code','04567');assert.equal(f.save.disabled,false);assert.equal(f.window.ownerEditorNeedsSave(),true);assert.equal(f.stream.open,false);assert.equal(f.calls.length,0);
 f.input('zip_code','01234');assert.equal(f.save.disabled,true);f.input('category','news_talk');assert.equal(f.save.disabled,false);f.input('category','christian');assert.equal(f.save.disabled,true);
});

test('optional saved metadata is retained when a legacy read or ordinary edit omits its fields',()=>{
 const f=fixture({...original,zip_code:'01234',category:'christian'});f.sync(original);assert.equal(f.save.disabled,true);
 f.input('bio','Updated bio');f.window.ownerEditorSaved({...original,bio:'Updated bio'});assert.equal(f.save.disabled,true);
 f.input('zip_code','04567');assert.equal(f.save.disabled,false);f.input('zip_code','01234');assert.equal(f.save.disabled,true);
});

test('an accepted metadata write is clean and a preserved conflicting refresh does not erase a draft',()=>{
 const f=fixture({...original,zip_code:'01234',category:''});f.input('category','news_talk');f.sync({...original,zip_code:'01234',category:'news_talk',revision:'new-revision'},{preserveDraft:true});assert.equal(f.save.disabled,false);assert.equal(f.form.dataset.revision,'revision-one');
 f.saved();assert.equal(f.save.disabled,true);f.input('category','');assert.equal(f.save.disabled,false);f.input('category','news_talk');assert.equal(f.save.disabled,true);
});

test('an unavailable Category catalog does not block ZIP or Bio edits and ignores disabled Category changes',()=>{
 const f=fixture({...original,zip_code:'01234',category:'christian'});f.form.dataset.ownerMetadataReady='false';f.form.dataset.ownerZipReady='true';f.input('category','');assert.equal(f.save.disabled,true);
 f.input('zip_code','04567');assert.equal(f.save.disabled,false);f.input('zip_code','01234');assert.equal(f.save.disabled,true);f.input('bio','Still editable');assert.equal(f.save.disabled,false);assert.equal(f.window.ownerEditorSaveAllowed(),true);assert.equal(f.calls.length,0);
});

test('a preserved draft stays compared with its original accepted revision, including conflicting refreshes',()=>{
 const f=fixture();f.input('bio','My draft');f.form.dataset.dirty='1';
 const newer={...original,bio:'My draft',revision:'revision-two'};f.sync(newer,{preserveDraft:true});
 assert.equal(f.form.dataset.revision,'revision-one');assert.equal(f.form.elements.bio.value,'My draft');assert.equal(f.window.ownerEditorNeedsSave(),true);assert.equal(f.save.disabled,false);
 f.sync(newer);assert.equal(f.form.dataset.revision,'revision-two');assert.equal(f.save.disabled,true);assert.equal(f.status.textContent,'Up to date');
});

test('a station or revision switch cannot reuse the previous station content baseline',()=>{
 const f=fixture();f.input('name','Unsaved');f.form.dataset.revision='unaccepted-version';f.window.renderOwnerEditorState();assert.equal(f.save.disabled,true);assert.equal(f.window.ownerEditorNeedsSave(),false);
 f.sync({...original,code:'14',name:'Other station',revision:'other-revision'});assert.equal(f.save.disabled,true);assert.equal(f.status.textContent,'Up to date');f.input('name','Edited other station');assert.equal(f.save.disabled,false);
});

test('an accepted write becomes clean even if the subsequent editor refresh is unavailable',()=>{
 const f=fixture();f.input('bio','Saved bio');f.form.dataset.dirty='1';f.saved();assert.equal(f.save.disabled,true);assert.equal(f.status.textContent,'Up to date');assert.equal(f.window.ownerEditorNeedsSave(),false);
 f.input('bio','Another draft');assert.equal(f.save.disabled,false);f.input('bio','Saved bio');assert.equal(f.save.disabled,true);
});

test('busy cycles do not re-enable a clean Save and do not discard actual edits',()=>{
 const f=fixture();f.busy(true);assert.equal(f.save.disabled,true);f.busy(false);assert.equal(f.save.disabled,true);
 f.input('name','Edited station');f.busy(true);assert.equal(f.save.disabled,true);f.busy(false);assert.equal(f.save.disabled,false);assert.equal(f.form.elements.name.value,'Edited station');
});

test('failed checks and expired receipts reopen stream settings and keep changed-stream Save blocked',async()=>{
 const f=fixture();f.input('stream_url','https://new.example/live');f.result(Error('Stream did not respond'));await f.testStream();assert.equal(f.stream.open,true);assert.equal(f.save.disabled,true);
 f.result({result:'audio_response',audio_response:true});await f.testStream();assert.equal(f.save.disabled,false);f.stream.open=false;f.advance(55*60*1000);assert.equal(f.save.disabled,true);assert.equal(f.stream.open,true);
});

test('language changes preserve content state and manual details choices',()=>{
 const f=fixture();f.stream.open=true;f.window.appI18n={t:key=>key==='owner.upToDate'?'Ajou':key};f.event('app-language-changed');assert.equal(f.status.textContent,'Ajou');assert.equal(f.stream.open,true);assert.equal(f.save.disabled,true);
});
