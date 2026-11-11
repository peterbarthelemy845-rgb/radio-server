import {test} from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';

const source=readFileSync(new URL('./public/assets/editor-stream-setup.js',import.meta.url),'utf8');
const registration=readFileSync(new URL('./public/assets/registration-form.js',import.meta.url),'utf8');
const policy=registration.slice(registration.indexOf(' function registrationPublicIpv4('),registration.indexOf(' function registrationSetUrl('));
function fixture(value='http://STREAM.EXAMPLE.COM:8000/;stream.nsv?sid=1&foo=a%2Fb'){
 const nodes=new Map(),events={},observers=[];let canonicalInputs=0,modeEvents=0;
 function element(id){const listeners={};const node={id,value:'',dataset:{},attrs:{},hidden:false,disabled:false,required:false,readOnly:false,validity:{badInput:false},validationMessage:'',textContent:'',
  setCustomValidity(value){this.validationMessage=value;},reportValidity(){this.reported=true;return !this.validationMessage;},focus(){document.activeElement=this;},getAttribute(name){return this.attrs[name]??null;},
  addEventListener(type,fn){(listeners[type]??=[]).push(fn);},dispatchEvent(event){const delivered={type:event.type,bubbles:event.bubbles,target:event.target||this};for(const fn of listeners[event.type]||[])fn(delivered);if(event.bubbles&&id!=='editForm')nodes.get('editForm').dispatchEvent(delivered);return true;}};nodes.set(id,node);return node;}
 for(const id of ['editor','editForm','ownerSave','ownerStreamSetupPanel','ownerStreamProviderHelp','ownerStreamAddressFields','ownerStreamHost','ownerStreamPort','ownerStreamProtocol','ownerStreamPath','ownerStreamUrlRow','ownerStreamUrlInput'])element(id);
 const form=nodes.get('editForm'),url=nodes.get('ownerStreamUrlInput'),choices=['icecast','shoutcast','other'].map(value=>{const field=element('provider-'+value);field.value=value;field.name='owner_stream_provider';field.checked=value==='other';return field;});
 form.dataset.stationCode='13';form.elements={stream_url:url};url.value=value;url.name='stream_url';nodes.get('ownerStreamProtocol').value='https';
 form.querySelectorAll=selector=>selector==='input[name="owner_stream_provider"]'?choices:[];form.querySelector=()=>nodes.get('ownerSave');
 form.addEventListener('input',event=>{if(event.target===url)canonicalInputs++;if(event.target.name!=='owner_stream_provider')form.dataset.dirty='1';});form.addEventListener('owner-stream-mode-changed',()=>{modeEvents++;});
 const document={activeElement:null,getElementById:id=>nodes.get(id)},window={appI18n:{t:key=>key},addEventListener(type,fn){events[type]=fn;}};
 const context=vm.createContext({window,document,URL,Event,queueMicrotask,registrationText:(key,fallback)=>fallback,MutationObserver:class{constructor(fn){this.fn=fn;}observe(target,options){observers.push({target,options,fn:this.fn});}},fetch(){throw Error('Stream setup must not fetch or play audio.');},Audio:class{constructor(){throw Error('No playback in stream setup.');}}});
 vm.runInContext(policy,context);vm.runInContext(source,context);
 function input(id,value){nodes.get(id).value=value;nodes.get(id).dispatchEvent(new Event('input',{bubbles:true}));}
 function select(value){for(const choice of choices)choice.checked=choice.value===value;choices.find(choice=>choice.checked).dispatchEvent(new Event('change',{bubbles:true}));}
 return {nodes,form,url,choices,window,document,input,select,canonicalInputs:()=>canonicalInputs,modeEvents:()=>modeEvents,prepare:()=>window.prepareOwnerStreamSetup(),sync:options=>window.syncOwnerStreamSetup(options),
  language(){events['app-language-changed']?.();},busy(on){if(on){form.dataset.busy='1';nodes.get('ownerSave').disabled=true;}else{delete form.dataset.busy;nodes.get('ownerSave').disabled=false;}form.dispatchEvent(new Event('form-busy-changed'));},
  async reset(){form.dispatchEvent(new Event('reset'));url.value='';delete form.dataset.stationCode;delete form.dataset.dirty;await Promise.resolve();},
 };
}

test('saved owner URL initializes direct mode without dirty events or rewriting its exact address',()=>{
 const f=fixture(),n=f.nodes;assert.equal(f.choices.find(choice=>choice.checked).value,'other');assert.equal(n.get('ownerStreamUrlRow').hidden,false);assert.equal(n.get('ownerStreamAddressFields').hidden,true);assert.equal(f.url.value,'http://STREAM.EXAMPLE.COM:8000/;stream.nsv?sid=1&foo=a%2Fb');assert.equal(f.url.required,true);assert.equal(f.url.readOnly,false);assert.equal(f.url.disabled,false);for(const id of ['ownerStreamHost','ownerStreamPort','ownerStreamProtocol','ownerStreamPath'])assert.equal(n.get(id).disabled,true);assert.equal(f.form.dataset.dirty,undefined);assert.equal(f.canonicalInputs(),0);
});

test('Icecast and SHOUTcast expose editable server fields while hiding the enabled canonical URL',()=>{
 const f=fixture(),n=f.nodes;for(const provider of ['icecast','shoutcast']){f.select(provider);assert.equal(n.get('ownerStreamAddressFields').hidden,false);assert.equal(n.get('ownerStreamUrlRow').hidden,true);assert.equal(f.url.readOnly,true);assert.equal(f.url.required,false);assert.equal(f.url.disabled,false);for(const id of ['ownerStreamHost','ownerStreamPort','ownerStreamProtocol','ownerStreamPath'])assert.equal(n.get(id).disabled,false);assert.equal(n.get('ownerStreamHost').value,'stream.example.com');assert.equal(n.get('ownerStreamPort').value,'8000');assert.equal(n.get('ownerStreamProtocol').value,'http');assert.equal(n.get('ownerStreamPath').value,'/;stream.nsv?sid=1&foo=a%2Fb');}assert.equal(f.form.dataset.dirty,undefined);assert.equal(f.canonicalInputs(),0);assert.equal(f.modeEvents(),3);
});

test('real manual edits update the sole canonical URL, mark a draft and notify existing test cancellation',()=>{
 const f=fixture(),n=f.nodes;f.select('shoutcast');f.input('ownerStreamPath','/NewMount?sid=3&source=a%2Fb');assert.equal(f.url.value,'http://stream.example.com:8000/NewMount?sid=3&source=a%2Fb');assert.equal(f.form.dataset.dirty,'1');assert.equal(f.canonicalInputs(),1);assert.equal(f.prepare(),true);assert.equal(f.canonicalInputs(),1,'validation and canonicalization are not synthetic user edits');assert.equal(f.url.disabled,false);assert.equal(n.get('ownerStreamUrlRow').hidden,true);
});

test('invalid manual edits remain dirty and block Save at a visible field even when URL is hidden',()=>{
 const f=fixture(),n=f.nodes;f.select('icecast');f.input('ownerStreamPort','99999');assert.equal(f.url.value,'');assert.equal(f.form.dataset.dirty,'1');assert.equal(f.prepare(),false);assert.equal(f.document.activeElement,n.get('ownerStreamPort'));assert.equal(f.url.validationMessage,'');assert.equal(f.canonicalInputs(),1);f.input('ownerStreamPort','8000');f.input('ownerStreamPath','//unfinished');assert.equal(f.prepare(),false);assert.equal(f.document.activeElement,n.get('ownerStreamPath'));assert.equal(f.url.value,'');
});

test('direct mode clears hidden builder validity and can save independently of a partial server draft',()=>{
 const f=fixture(),n=f.nodes;f.select('icecast');f.input('ownerStreamPort','99999');f.prepare();f.select('other');for(const id of ['ownerStreamHost','ownerStreamPort','ownerStreamProtocol','ownerStreamPath']){assert.equal(n.get(id).disabled,true);assert.equal(n.get(id).validationMessage,'');}assert.equal(f.url.required,true);assert.equal(f.url.readOnly,false);assert.equal(f.prepare(),true);f.select('shoutcast');assert.equal(n.get('ownerStreamPort').value,'99999');assert.equal(f.prepare(),false);assert.equal(f.document.activeElement,n.get('ownerStreamPort'));
});

test('separate direct and manual drafts retain incomplete input and valid HTTP path/query across choices',()=>{
 const f=fixture(),n=f.nodes;f.input('ownerStreamUrlInput','https://');f.select('icecast');assert.equal(n.get('ownerStreamHost').value,'');f.input('ownerStreamHost','stream.example.com');f.input('ownerStreamPort','99999');f.select('other');assert.equal(f.url.value,'https://');f.input('ownerStreamUrlInput','http://next.example.com:9000/Exact?sid=8');f.select('shoutcast');assert.equal(n.get('ownerStreamHost').value,'next.example.com');assert.equal(n.get('ownerStreamPort').value,'9000');assert.equal(n.get('ownerStreamProtocol').value,'http');assert.equal(n.get('ownerStreamPath').value,'/Exact?sid=8');assert.equal(f.prepare(),true);
});

test('same-station refresh restores partial working input and provider without marking another edit',()=>{
 const f=fixture(),n=f.nodes;f.select('icecast');f.input('ownerStreamPort','99999');const count=f.canonicalInputs();f.url.value='https://server-refresh.example.com/live';f.sync();assert.equal(f.choices.find(choice=>choice.checked).value,'icecast');assert.equal(n.get('ownerStreamPort').value,'99999');assert.equal(f.url.value,'');assert.equal(f.canonicalInputs(),count);assert.equal(f.prepare(),false);
});

test('accepted saved data preserves the same station provider and updates fields without dirty input',()=>{
 const f=fixture(),n=f.nodes;f.select('shoutcast');f.input('ownerStreamPort','99999');const count=f.canonicalInputs();f.url.value='http://saved.example.com:9000/Next?sid=4';delete f.form.dataset.dirty;f.sync({accepted:true});assert.equal(f.choices.find(choice=>choice.checked).value,'shoutcast');assert.equal(n.get('ownerStreamHost').value,'saved.example.com');assert.equal(n.get('ownerStreamPort').value,'9000');assert.equal(n.get('ownerStreamPath').value,'/Next?sid=4');assert.equal(f.prepare(),true);assert.equal(f.canonicalInputs(),count);assert.equal(f.form.dataset.dirty,undefined);
});

test('a different station resets provider and discards the old station partial draft safely',()=>{
 const f=fixture(),n=f.nodes;f.select('icecast');f.input('ownerStreamPort','99999');f.form.dataset.stationCode='14';f.url.value='https://different.example.com/live';delete f.form.dataset.dirty;f.sync();assert.equal(f.choices.find(choice=>choice.checked).value,'other');assert.equal(n.get('ownerStreamUrlRow').hidden,false);assert.equal(n.get('ownerStreamPort').value,'');assert.equal(f.url.value,'https://different.example.com/live');assert.equal(f.form.dataset.dirty,undefined);f.select('icecast');assert.equal(n.get('ownerStreamHost').value,'different.example.com');assert.equal(n.get('ownerStreamPort').value,'');assert.equal(f.prepare(),true);
});

test('public URL policy rejects private hosts, credentials and private tokens in both owner modes',()=>{
 for(const provider of ['icecast','shoutcast','other']){const f=fixture(),n=f.nodes;f.select(provider);if(provider==='other')f.input('ownerStreamUrlInput','http://192.168.1.2/live');else f.input('ownerStreamHost','192.168.1.2');assert.equal(f.prepare(),false);assert.equal(f.document.activeElement,n.get(provider==='other'?'ownerStreamUrlInput':'ownerStreamHost'));if(provider==='other')f.input('ownerStreamUrlInput','https://owner:private-secret@stream.example.com/live');else{f.input('ownerStreamHost','stream.example.com');f.input('ownerStreamPath','/live?token=private-secret');}assert.equal(f.prepare(),false);assert.doesNotMatch(f.document.activeElement.validationMessage,/private-secret/);}
});

test('strict port, protocol and path checks match registration and do not invent a SHOUTcast mount',()=>{
 const f=fixture(),n=f.nodes;f.select('shoutcast');for(const value of ['0','65536','1e3']){f.input('ownerStreamPort',value);assert.equal(f.prepare(),false);assert.equal(f.document.activeElement,n.get('ownerStreamPort'));}f.input('ownerStreamPort','8000');f.input('ownerStreamProtocol','ftp');assert.equal(f.prepare(),false);assert.equal(f.document.activeElement,n.get('ownerStreamProtocol'));f.input('ownerStreamProtocol','http');for(const value of ['//elsewhere.example/live','/live#fragment']){f.input('ownerStreamPath',value);assert.equal(f.prepare(),false);assert.equal(f.document.activeElement,n.get('ownerStreamPath'));}f.input('ownerStreamPath','/provider-specified?sid=6');assert.equal(f.prepare(),true);assert.equal(f.url.value,'http://stream.example.com:8000/provider-specified?sid=6');
});

test('busy and language updates preserve draft state and never re-enable captured inputs',()=>{
 const f=fixture(),n=f.nodes;f.select('icecast');f.busy(true);f.select('other');f.window.appI18n={t:key=>key==='registration.providerIcecast'?'Antre sèvè piblik la.':key};f.language();assert.equal(f.choices.find(choice=>choice.checked).value,'icecast');assert.equal(n.get('ownerStreamProviderHelp').textContent,'Antre sèvè piblik la.');for(const id of ['ownerStreamHost','ownerStreamPort','ownerStreamProtocol','ownerStreamPath','ownerStreamUrlInput'])assert.equal(n.get(id).disabled,true);assert.equal(f.prepare(),false);f.busy(false);assert.equal(n.get('ownerStreamHost').disabled,false);assert.equal(f.url.disabled,false);f.select('other');f.busy(true);f.language();f.busy(false);assert.equal(n.get('ownerStreamHost').disabled,true);assert.equal(f.url.disabled,false);
});

test('reset clears owner setup drafts and missing shared URL policy fails closed without network work',async()=>{
 const f=fixture(),n=f.nodes;f.select('icecast');f.input('ownerStreamPort','99999');await f.reset();assert.equal(f.choices.find(choice=>choice.checked).value,'other');assert.equal(n.get('ownerStreamPort').value,'');assert.equal(f.url.value,'');f.input('ownerStreamUrlInput','https://stream.example.com/live');delete f.window.parsePublicStreamUrl;assert.equal(f.prepare(),false);assert.equal(f.document.activeElement,f.url);assert.match(f.url.validationMessage,/validation is unavailable/);
});


test('owner may enter the port first and retain it while completing the remaining server fields',()=>{
 const f=fixture(''),n=f.nodes;f.select('icecast');f.input('ownerStreamPort','8000');assert.equal(n.get('ownerStreamPort').disabled,false);assert.equal(n.get('ownerStreamPort').value,'8000');assert.equal(f.url.value,'');
 f.input('ownerStreamHost','stream.example.com');f.input('ownerStreamProtocol','http');f.input('ownerStreamPath','/live');assert.equal(n.get('ownerStreamPort').value,'8000');assert.equal(f.prepare(),true);assert.equal(f.url.value,'http://stream.example.com:8000/live');
 f.input('ownerStreamPort','');assert.equal(f.prepare(),true);assert.equal(f.url.value,'http://stream.example.com/live');
});
