import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';

const source=readFileSync(new URL('./public/assets/owner-stream-publication.js',import.meta.url),'utf8');
function fixture(){
 const nodes=new Map(),events=new Map(),observers=[];let focus=0;
 function node(id){const handlers=new Map(),item={id,hidden:false,disabled:false,textContent:'',value:'',dataset:{},elements:{},addEventListener(type,fn){const list=handlers.get(type)||[];list.push(fn);handlers.set(type,list);},dispatch(type){for(const fn of handlers.get(type)||[])fn();},focus(){focus++;}};nodes.set(id,item);return item;}
 for(const id of ['editor','editForm','ownerStreamPublication','ownerStreamPublicationTitle','ownerStreamPublicationHelp','requestOwnerStreamReview','ownerStreamPublicationMessage'])node(id);
 const form=nodes.get('editForm');form.elements.stream_url={value:'https://stream.example.com/live'};
 const window={appI18n:{t:key=>key},addEventListener(type,fn){events.set(type,fn);}};
 runInNewContext(source,{window,document:{getElementById:id=>nodes.get(id)},MutationObserver:class{constructor(fn){this.fn=fn;}observe(target){observers.push({target,fn:this.fn});}},api(){throw Error('A failed stream test must not have a review bypass.');}});
 return {nodes,form,window,load(value={code:13}){window.renderOwnerStreamPublication(value);},allowed(value){form.dataset.streamSaveAllowed=value?'true':'false';events.get('owner-stream-save-state-changed')?.();},event(type){events.get(type)?.();},hide(value){nodes.get('editor').hidden=value;for(const observer of observers)if(observer.target===nodes.get('editor'))observer.fn();},focus:()=>focus};
}

test('an unverified stream explains the required check without a save-private or review action',()=>{
 const f=fixture();f.load();assert.equal(f.nodes.get('ownerStreamPublication').hidden,false);assert.equal(f.nodes.get('ownerStreamPublicationTitle').textContent,'Check your stream');assert.equal(f.nodes.get('ownerStreamPublicationHelp').textContent,'Test your stream before saving.');assert.equal(f.nodes.get('requestOwnerStreamReview').hidden,true);assert.equal(f.nodes.get('requestOwnerStreamReview').disabled,true);assert.equal(f.nodes.get('requestOwnerStreamReview').onclick,null);assert.equal(f.nodes.get('ownerStreamPublicationMessage').hidden,true);assert.equal(f.focus(),0);
});

test('only the Save gate controls the help panel; a pending draft status cannot claim approval',()=>{
 const f=fixture();f.load({code:13,status:'published',stream_check:{status:'passed'},review_pending:true});assert.equal(f.nodes.get('ownerStreamPublication').hidden,false);f.allowed(true);assert.equal(f.nodes.get('ownerStreamPublication').hidden,true);f.allowed(false);assert.equal(f.nodes.get('ownerStreamPublication').hidden,false);assert.equal(f.nodes.get('ownerStreamPublication').dataset.state,'needs_check');
});

test('guidance preserves typed stream data and stays hidden when the editor is closed or reset',()=>{
 const f=fixture();f.load();f.form.elements.stream_url.value='http://162.244.81.219:8020/live';f.form.dispatch('input');f.form.dispatch('form-busy-changed');assert.equal(f.form.elements.stream_url.value,'http://162.244.81.219:8020/live');assert.equal(f.focus(),0);f.hide(true);assert.equal(f.nodes.get('ownerStreamPublication').hidden,true);f.hide(false);assert.equal(f.nodes.get('ownerStreamPublication').hidden,false);f.form.dispatch('reset');assert.equal(f.nodes.get('ownerStreamPublication').hidden,true);f.load(null);assert.equal(f.nodes.get('ownerStreamPublication').hidden,true);
});

test('required-check guidance translates without reviving the retired review button',()=>{
 const f=fixture();f.load();f.window.appI18n.t=key=>({'owner.streamNeedsCheck':'Verifye difizyon ou','owner.streamCheckRequired':'Teste difizyon ou anvan ou anrejistre.'}[key]||key);f.event('app-language-changed');assert.equal(f.nodes.get('ownerStreamPublicationTitle').textContent,'Verifye difizyon ou');assert.equal(f.nodes.get('ownerStreamPublicationHelp').textContent,'Teste difizyon ou anvan ou anrejistre.');assert.equal(f.nodes.get('requestOwnerStreamReview').hidden,true);
});

test('the publication guidance remains next to the owner stream setup and loads only with owner tools',()=>{
 const html=readFileSync(new URL('./public/index.html',import.meta.url),'utf8'),loader=readFileSync(new URL('./public/assets/feature-loader.js',import.meta.url),'utf8');assert.match(html,/<aside id="ownerStreamPublication"[^>]*hidden/);assert.ok(html.indexOf('id="ownerStreamPublication"')>html.indexOf('id="ownerStreamTestStatus"'));assert.ok(html.indexOf('id="ownerStreamPublication"')<html.indexOf('<label>Bio<textarea'));assert.match(loader,/owner:\{[^\n]*'owner-stream-publication\.js'/);assert.doesNotMatch(loader,/support:\{[^\n]*'owner-stream-publication\.js'/);
});
