import {test} from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';

const source=readFileSync(new URL('./public/assets/owner-stream-publication.js',import.meta.url),'utf8');
function deferred(){let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return {promise,resolve,reject};}
async function tick(){for(let i=0;i<3;i++)await new Promise(resolve=>setImmediate(resolve));}
function fixture(){
 const nodes=new Map(),events=new Map(),observers=[],calls=[],feedback=[];let response={status:'ok',stream_check:{status:'review_requested'}},focus=0;
 function node(id){const handlers=new Map();const item={id,hidden:false,disabled:false,textContent:'',value:'',dataset:{},attrs:{},elements:{},files:[],addEventListener(type,fn){const list=handlers.get(type)||[];list.push(fn);handlers.set(type,list);},dispatch(type){for(const fn of handlers.get(type)||[])fn({type,target:item});},getAttribute(key){return item.attrs[key]??null;},focus(){focus++;}};nodes.set(id,item);return item;}
 for(const id of ['editor','editForm','ownerStreamPublication','ownerStreamPublicationTitle','ownerStreamPublicationHelp','requestOwnerStreamReview','ownerStreamPublicationMessage','name','stream_url','bio','artwork'])node(id);
 const form=nodes.get('editForm');for(const key of ['name','stream_url','bio','artwork'])form.elements[key]=nodes.get(key);
 const window={appI18n:{t:key=>key},addEventListener(type,fn){events.set(type,fn);}};
 const context=vm.createContext({window,document:{getElementById:id=>nodes.get(id)},MutationObserver:class{constructor(fn){this.fn=fn;}observe(target,options){observers.push({target,options,fn:this.fn});}},AbortController,queueMicrotask,Date,
  api:async(path,body,options)=>{calls.push({path,body,options});return await response;},ownerEditFeedback:(...args)=>feedback.push(args),
  setBusyButtonLabel:button=>{const previous=button.textContent;button.textContent='Sending…';return()=>{button.textContent=previous;};}
 });vm.runInContext(source,context);
 function notify(target,attribute){for(const item of observers)if(item.target===target&&item.options.attributeFilter.includes(attribute))item.fn();}
 function load(station={}){const value={code:'13',revision:'a'.repeat(32),name:'Test station',stream_url:'https://stream.example.com/live',bio:'A station',status:'pending_review',review_pending:false,stream_check:{status:'needs_check'},...station};form.dataset.stationCode=String(value.code);form.dataset.revision=value.revision;delete form.dataset.dirty;for(const key of ['name','stream_url','bio'])form.elements[key].value=value[key]||'';form.elements.artwork.files=[];window.renderOwnerStreamPublication(value);return value;}
 return {nodes,window,form,calls,feedback,load,focus:()=>focus,start:()=>nodes.get('requestOwnerStreamReview').onclick(),result(value){response=value;},input(key,value){form.elements[key].value=value;form.dispatch('input');},dirty(){form.dataset.dirty='1';notify(form,'data-dirty');},notify,hide(){nodes.get('editor').hidden=true;notify(nodes.get('editor'),'hidden');},busy(value=true){form.dataset.busy=value?'1':'';form.dispatch('form-busy-changed');},event(type,detail){events.get(type)?.({detail});}};
}

test('saved station proof renders a compact honest publication state without focusing or changing drafts',()=>{
 const f=fixture();f.load();assert.equal(f.nodes.get('ownerStreamPublication').hidden,false);assert.match(f.nodes.get('ownerStreamPublicationTitle').textContent,/Check your stream/);assert.match(f.nodes.get('ownerStreamPublicationHelp').textContent,/Saved privately/);assert.equal(f.nodes.get('requestOwnerStreamReview').disabled,false);assert.equal(f.focus(),0);assert.equal(f.form.elements.stream_url.value,'https://stream.example.com/live');
 f.load({stream_check:{status:'passed'}});assert.match(f.nodes.get('ownerStreamPublicationTitle').textContent,/passed/);assert.match(f.nodes.get('ownerStreamPublicationHelp').textContent,/safety review/);assert.equal(f.nodes.get('requestOwnerStreamReview').hidden,true);
 f.load({status:'published',stream_check:{status:'passed'}});assert.equal(f.nodes.get('ownerStreamPublicationHelp').textContent,'Your approved stream is live.');assert.equal(f.nodes.get('requestOwnerStreamReview').hidden,true);
 f.load({stream_check:{status:'review_requested'}});assert.match(f.nodes.get('ownerStreamPublicationHelp').textContent,/private while we review/);assert.equal(f.nodes.get('requestOwnerStreamReview').hidden,true);
});

test('an older or incomplete station response hides the panel instead of claiming a passed check',()=>{
 const f=fixture();for(const stream_check of [undefined,null,{}, {status:'unknown'}]){f.load({stream_check});assert.equal(f.nodes.get('ownerStreamPublication').hidden,true);assert.equal(f.calls.length,0);}
 f.load({status:'published',review_pending:false,stream_check:{status:'needs_check'}});assert.equal(f.nodes.get('ownerStreamPublication').hidden,true);
});

test('a pending replacement stream explains that the last approved stream remains live',()=>{
 const f=fixture();for(const status of ['needs_check','passed','review_requested']){f.load({status:'published',review_pending:true,stream_check:{status}});assert.match(f.nodes.get('ownerStreamPublicationHelp').textContent,/last approved stream stays live/);assert.match(f.nodes.get('ownerStreamPublicationHelp').textContent,/changes stay private/);}
});

test('requesting review sends only the saved exact revision once and updates the server state',async()=>{
 const f=fixture(),saved=f.load(),pending=deferred();f.result(pending.promise);const first=f.start(),duplicate=f.start();await tick();assert.equal(f.calls.length,1);assert.equal(f.calls[0].path,'/api/owner/stream-review');assert.deepEqual(Object.keys(f.calls[0].body),['revision']);assert.equal(f.calls[0].body.revision,saved.revision);assert.ok(f.calls[0].options.signal);assert.equal(f.nodes.get('requestOwnerStreamReview').disabled,true);assert.equal(f.form.elements.stream_url.disabled,false);
 pending.resolve({status:'ok',stream_check:{status:'review_requested'},message:'Review requested.'});await Promise.all([first,duplicate]);assert.equal(f.nodes.get('ownerStreamPublication').dataset.state,'review_requested');assert.equal(f.nodes.get('requestOwnerStreamReview').hidden,true);assert.match(f.nodes.get('ownerStreamPublicationMessage').textContent,/saved stream remains private/);assert.equal(f.form.elements.stream_url.value,saved.stream_url);assert.equal(f.focus(),0);
});

test('any unsaved form content or revision mismatch requires saving before review',async()=>{
 for(const edit of [f=>f.dirty(),f=>f.input('stream_url','https://new.example.com/live'),f=>f.input('name','Changed'),f=>f.input('bio','Changed'),f=>{f.form.elements.artwork.files=[{}];f.form.dispatch('change');},f=>{f.form.dataset.revision='b'.repeat(32);f.notify(f.form,'data-revision');}]){
  const f=fixture();f.load();edit(f);assert.equal(f.nodes.get('requestOwnerStreamReview').disabled,true);assert.match(f.nodes.get('ownerStreamPublicationHelp').textContent,/Save your changes/);await f.start();assert.equal(f.calls.length,0);
 }
});

test('fresh server metadata keeps unsaved drafts and cannot request review of a different revision',async()=>{
 const f=fixture(),station=f.load();f.input('name','My unsaved title');f.window.renderOwnerStreamPublication({...station,revision:'b'.repeat(32)});assert.equal(f.form.elements.name.value,'My unsaved title');assert.equal(f.form.dataset.revision,station.revision);assert.equal(f.nodes.get('requestOwnerStreamReview').disabled,true);await f.start();assert.equal(f.calls.length,0);
});

test('input, navigation, Save, station changes and session expiry invalidate late review responses',async()=>{
 for(const abandon of [f=>f.input('bio','New draft'),f=>f.hide(),f=>f.busy(),f=>f.load({code:'14',revision:'c'.repeat(32)}),f=>f.event('owner-session-updated',{owner_expires:1,server_time:2}),f=>f.event('pagehide')]){
  const f=fixture(),pending=deferred();f.load();f.result(pending.promise);const review=f.start();await tick();abandon(f);assert.equal(f.calls[0].options.signal.aborted,true);pending.resolve({stream_check:{status:'review_requested'}});await review;assert.notEqual(f.nodes.get('ownerStreamPublication').dataset.state,'review_requested');assert.equal(f.nodes.get('ownerStreamPublicationMessage').textContent,'');
 }
});

test('an old station review cannot unlock or replace the newer station request',async()=>{
 const f=fixture(),old=deferred(),fresh=deferred();f.load();f.result(old.promise);const first=f.start();await tick();f.load({code:'14',revision:'d'.repeat(32)});f.result(fresh.promise);const second=f.start();await tick();old.resolve({stream_check:{status:'review_requested'}});await first;assert.equal(f.nodes.get('requestOwnerStreamReview').disabled,true);assert.equal(f.nodes.get('ownerStreamPublication').dataset.state,'needs_check');fresh.resolve({stream_check:{status:'review_requested'}});await second;assert.equal(f.nodes.get('ownerStreamPublication').dataset.state,'review_requested');
});

test('review failures preserve the saved stream and allow retry without pretending review was accepted',async()=>{
 const f=fixture(),saved=f.load();f.result(Promise.reject(Object.assign(Error('Try again later.'),{status:429})));await f.start();assert.equal(f.nodes.get('ownerStreamPublication').dataset.state,'needs_check');assert.match(f.nodes.get('ownerStreamPublicationMessage').textContent,/Try again later/);assert.equal(f.nodes.get('requestOwnerStreamReview').disabled,false);assert.equal(f.form.elements.stream_url.value,saved.stream_url);
 f.result({status:'ok',message:'No confirmation.'});await f.start();assert.equal(f.nodes.get('ownerStreamPublication').dataset.state,'needs_check');assert.match(f.nodes.get('ownerStreamPublicationMessage').textContent,/No confirmation/);
});

test('expired owner access offers sign-in again and a conflict requires editor refresh',async()=>{
 for(const code of [401,409]){const f=fixture();f.load();f.result(Promise.reject(Object.assign(Error('Failure'),{status:code})));await f.start();assert.equal(f.nodes.get('ownerStreamPublication').dataset.state,'needs_check');if(code===401){assert.equal(f.nodes.get('requestOwnerStreamReview').disabled,true);assert.equal(f.feedback.length,1);assert.equal(f.feedback[0][1],true);}else{assert.match(f.nodes.get('ownerStreamPublicationMessage').textContent,/Refresh the editor/);assert.equal(f.nodes.get('requestOwnerStreamReview').disabled,false);}}
});

test('language changes translate the current panel and confirmation without another request or focus',async()=>{
 const f=fixture();f.load();await f.start();f.window.appI18n.t=key=>({'owner.streamReviewRequested':'Revizyon mande','owner.streamReviewPrivate':'Rete prive','owner.streamReviewSent':'Demann nan voye'}[key]||key);f.event('app-language-changed');assert.equal(f.nodes.get('ownerStreamPublicationTitle').textContent,'Revizyon mande');assert.equal(f.nodes.get('ownerStreamPublicationHelp').textContent,'Rete prive');assert.equal(f.nodes.get('ownerStreamPublicationMessage').textContent,'Demann nan voye');assert.equal(f.calls.length,1);assert.equal(f.focus(),0);
});

test('the publication panel sits after owner stream setup and is loaded only with owner tools',()=>{
 const html=readFileSync(new URL('./public/index.html',import.meta.url),'utf8'),loader=readFileSync(new URL('./public/assets/feature-loader.js',import.meta.url),'utf8');assert.match(html,/<aside id="ownerStreamPublication"[^>]*hidden/);assert.ok(html.indexOf('id="ownerStreamPublication"')>html.indexOf('id="ownerStreamTestStatus"'));assert.ok(html.indexOf('id="ownerStreamPublication"')<html.indexOf('<label>Bio<textarea'));assert.match(loader,/owner:\{[^\n]*'owner-stream-publication\.js'/);assert.doesNotMatch(loader,/support:\{[^\n]*'owner-stream-publication\.js'/);
});
