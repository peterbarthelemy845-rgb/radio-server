import {test} from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import {publicStreamUrl} from './public-stream-url.mjs';

function deferred(){let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return {promise,resolve,reject};}
function registrationFixture({url='',secure=true,clipboard=true,providerControls=false,provider='icecast',popup=false,canonical=''}={}){
 const nodes=new Map(),observers=[],windowEvents={},humanCalls=[],apiCalls=[],copied=[];let dirty=0,clipboardResult=Promise.resolve(),humanResult=Promise.resolve('checked-token'),apiResult=Promise.resolve({result:'not_confirmed',audio_response:false,message:'Not confirmed. You can still save.'});
 const ids=['register','registerForm','stationName','streamManualSetup','streamAddressFields','streamHost','streamPort','streamProtocol','streamPath','streamUrlInput','copyGeneratedStream','testStream','streamTestStatus','streamTestHuman','saveRegistration'];
 function element(id){const listeners={};const node={id,value:'',hidden:false,open:false,disabled:false,readOnly:false,required:false,dataset:{},attrs:{},validity:{badInput:false},validationMessage:'',textContent:'',setAttribute(key,value){this.attrs[key]=value;},removeAttribute(key){delete this.attrs[key];},querySelector(){return id==='registerForm'?nodes.get('saveRegistration'):null;},setCustomValidity(value){this.validationMessage=value;},reportValidity(){this.reported=true;return !this.validationMessage;},focus(){document.activeElement=this;},select(){this.selected=true;},addEventListener(type,fn){(listeners[type]??=[]).push(fn);},dispatchEvent(event){for(const fn of listeners[event.type]||[])fn(event);if(event.bubbles&&id!=='registerForm'&&(!popup||id==='stationName'||id==='registrationStreamValue'||id.startsWith('provider-')))nodes.get('registerForm').dispatchEvent(event);return true;},showModal(){assert.equal(this.open,false,'dialog must not be shown twice');this.open=true;this.showCount=(this.showCount||0)+1;},close(value){this.open=false;this.returnValue=value;this.dispatchEvent(new Event('close'));}};nodes.set(id,node);return node;}
 ids.forEach(element);const document={activeElement:null,getElementById:id=>nodes.get(id)};nodes.get('registerForm').elements={name:nodes.get('stationName')};nodes.get('stationName').value='Test station';nodes.get('streamProtocol').value='https';nodes.get('streamUrlInput').value=url;nodes.get('registerForm').addEventListener('input',()=>{dirty++;});
 const providers=providerControls?['icecast','shoutcast','other'].map(value=>{const field=element('provider-'+value);field.name='stream_provider';field.type='radio';field.value=value;field.checked=value===provider;return field;}):[];if(providerControls){element('streamProviderHelp');element('streamUrlLabel');}nodes.get('registerForm').querySelectorAll=selector=>selector==='input[name="stream_provider"]'?providers:[];
 if(popup){for(const id of ['streamSetupDialog','streamSetupSave','streamSetupCancel','streamSetupSummary','streamSetupSummaryText','streamSetupEdit','streamSetupTitle','registrationStreamValue'])element(id);nodes.get('registrationStreamValue').value=canonical;nodes.get('registrationStreamValue').type='hidden';nodes.get('registrationStreamValue').name='stream_url';}
 const window={isSecureContext:secure,addEventListener(type,fn){windowEvents[type]=fn;}};
 const navigator={clipboard:clipboard?{async writeText(value){copied.push(value);return clipboardResult;}}:undefined};
 const context=vm.createContext({window,document,navigator,URL,Event,Promise,TextEncoder,queueMicrotask,MutationObserver:class{constructor(fn){this.fn=fn;observers.push(this);}observe(target){this.target=target;}},human:async(container,action)=>{humanCalls.push({container,action});return humanResult;},api:async(path,body)=>{apiCalls.push({path,body});return apiResult;},Audio:class{constructor(){throw Error('Registration must never play audio.');}},fetch(){throw Error('Registration may use only the authenticated stream-check API.');}});
 vm.runInContext(readFileSync(new URL('./public/assets/registration-form.js',import.meta.url),'utf8'),context);
 function input(id,value){nodes.get(id).value=value;nodes.get(id).dispatchEvent(new Event('input',{bubbles:true}));}
 function address(value){input('streamUrlInput',value);}
 async function flush(){await Promise.resolve();await Promise.resolve();await Promise.resolve();}
 return {nodes,window,document,input,address,flush,humanCalls,apiCalls,copied,providers,provider(value){for(const field of providers)field.checked=field.value===value;providers.find(field=>field.checked)?.dispatchEvent(new Event('change',{bubbles:true}));},providerClick(value){const field=providers.find(field=>field.value===value),changed=!field.checked;for(const choice of providers)choice.checked=choice===field;if(changed)field.dispatchEvent(new Event('change',{bubbles:true}));field.dispatchEvent(new Event('click',{bubbles:true}));},escape(){const dialog=nodes.get('streamSetupDialog');dialog.dispatchEvent(new Event('cancel',{cancelable:true}));dialog.close('cancelled');},dirty:()=>dirty,prepare:()=>window.prepareRegistrationStream(),copyResult(result){clipboardResult=result;},human(result){humanResult=result;},result(result){apiResult=result;},async reset(){nodes.get('registerForm').dispatchEvent(new Event('reset'));for(const id of ['streamHost','streamPort','streamPath','streamUrlInput'])nodes.get(id).value='';nodes.get('streamProtocol').value='https';for(const field of providers)field.checked=!popup&&field.value==='icecast';await flush();},hide(){nodes.get('register').hidden=true;for(const observer of observers)if(observer.target===nodes.get('register'))observer.fn([]);},language(){windowEvents['app-language-changed']?.();}};
}

function popupFixture(options={}){return registrationFixture({providerControls:true,provider:'',popup:true,...options});}

test('compact signup starts without a selected stream or native-validation blockers',()=>{
 const f=popupFixture(),n=f.nodes;assert.equal(f.providers.some(field=>field.checked),false);assert.equal(n.get('streamSetupDialog').open,false);assert.equal(n.get('streamSetupSummary').hidden,true);assert.equal(n.get('registrationStreamValue').value,'');assert.equal(n.get('registrationStreamValue').disabled,false);for(const id of ['streamHost','streamPort','streamProtocol','streamPath','streamUrlInput']){assert.equal(n.get(id).disabled,true,id);assert.equal(n.get(id).validationMessage,'',id);}assert.equal(f.dirty(),0);
 assert.equal(f.prepare(),false);assert.equal(n.get('streamSetupDialog').open,true);assert.equal(n.get('streamSetupTitle').textContent,'Icecast setup');assert.equal(f.document.activeElement,n.get('streamHost'));assert.equal(n.get('registrationStreamValue').value,'');
});

test('provider click and keyboard change open the right popup, including repeated selected clicks',()=>{
 const f=popupFixture(),n=f.nodes,dialog=n.get('streamSetupDialog');f.providerClick('icecast');assert.equal(dialog.showCount,1);assert.equal(n.get('streamManualSetup').hidden,false);assert.equal(n.get('streamUrlInput').readOnly,true);n.get('streamSetupCancel').onclick();assert.equal(f.providers.some(field=>field.checked),false);f.provider('shoutcast');assert.equal(dialog.open,true);assert.equal(n.get('streamSetupTitle').textContent,'SHOUTcast setup');n.get('streamSetupCancel').onclick();f.providerClick('other');assert.equal(n.get('streamSetupTitle').textContent,'Stream URL setup');assert.equal(n.get('streamManualSetup').hidden,true);assert.equal(n.get('streamUrlInput').readOnly,false);f.address('http://stream.example.com:8000/live');assert.equal(n.get('streamSetupSave').onclick(),true);assert.equal(dialog.open,false);assert.equal(f.providers.find(field=>field.checked).value,'other');const count=dialog.showCount;f.providerClick('other');assert.equal(dialog.showCount,count+1);assert.equal(dialog.returnValue,'');
});

test('Use stream alone commits canonical URL and summary and main signup uses the saved value',()=>{
 const f=popupFixture(),n=f.nodes;f.providerClick('shoutcast');f.input('streamHost','STREAM.EXAMPLE.COM');f.input('streamProtocol','http');f.input('streamPort','8000');f.input('streamPath','/;stream.nsv?sid=1&foo=a%2Fb');assert.equal(n.get('registrationStreamValue').value,'');assert.equal(n.get('streamSetupSummary').hidden,true);assert.equal(f.dirty(),0,'uncommitted popup drafts stay out of the main signup form');assert.equal(n.get('streamSetupSave').onclick(),true);const expected='http://stream.example.com:8000/;stream.nsv?sid=1&foo=a%2Fb';assert.equal(n.get('registrationStreamValue').value,expected);assert.equal(n.get('registrationStreamValue').disabled,false);assert.equal(n.get('streamSetupSummaryText').textContent,expected);assert.equal(n.get('streamSetupSummary').hidden,false);assert.equal(f.dirty(),1);assert.equal(f.prepare(),true);assert.equal(n.get('streamSetupDialog').open,false);for(const id of ['streamHost','streamPort','streamProtocol','streamPath','streamUrlInput']){assert.equal(n.get(id).disabled,true);assert.equal(n.get(id).validationMessage,'');}
});

test('Cancel, Escape and Back-style close do not replace committed URL or discard drafts',()=>{
 const f=popupFixture({canonical:'http://saved.example.com:8000/live?sid=2'}),n=f.nodes;assert.equal(f.prepare(),true);const summary=n.get('streamSetupSummaryText').textContent;
 n.get('streamSetupEdit').onclick();f.address('https://draft.example.com/not-saved');n.get('streamSetupCancel').onclick();assert.equal(n.get('registrationStreamValue').value,summary);assert.equal(n.get('streamSetupSummaryText').textContent,summary);assert.equal(f.dirty(),0);n.get('streamSetupEdit').onclick();assert.equal(n.get('streamUrlInput').value,'https://draft.example.com/not-saved');assert.equal(n.get('streamSetupDialog').returnValue,'');f.escape();assert.equal(n.get('registrationStreamValue').value,summary);n.get('streamSetupEdit').onclick();f.address('https://back.example.com/not-saved');n.get('streamSetupDialog').close('cancelled');assert.equal(n.get('registrationStreamValue').value,summary);assert.equal(n.get('streamSetupSummaryText').textContent,summary);assert.equal(f.prepare(),true);
});

test('invalid popup drafts never commit and validation focuses an editable visible field',()=>{
 const f=popupFixture(),n=f.nodes;f.providerClick('icecast');f.input('streamHost','stream.example.com');f.input('streamPort','99999');assert.equal(n.get('streamSetupSave').onclick(),false);assert.equal(f.document.activeElement,n.get('streamPort'));assert.equal(n.get('streamSetupDialog').open,true);assert.equal(n.get('registrationStreamValue').value,'');n.get('streamSetupCancel').onclick();assert.equal(n.get('streamPort').validationMessage,'');f.providerClick('icecast');assert.equal(n.get('streamPort').value,'99999');n.get('streamSetupCancel').onclick();f.providerClick('other');f.address('https://stream.example.com/live?token=private-secret');assert.equal(n.get('streamSetupSave').onclick(),false);assert.equal(f.document.activeElement,n.get('streamUrlInput'));assert.doesNotMatch(n.get('streamTestStatus').textContent,/private-secret/);assert.equal(n.get('streamSetupSummary').hidden,true);
});

test('Enter saves text and number fields while native select keys and composition remain untouched',()=>{
 const f=popupFixture(),n=f.nodes,dialog=n.get('streamSetupDialog');f.providerClick('icecast');f.input('streamHost','stream.example.com');f.input('streamPath','/live');let prevented=0;dialog.dispatchEvent({type:'keydown',key:'Enter',target:n.get('streamProtocol'),preventDefault(){prevented++;}});assert.equal(dialog.open,true);dialog.dispatchEvent({type:'keydown',key:'Enter',isComposing:true,target:n.get('streamHost'),preventDefault(){prevented++;}});assert.equal(dialog.open,true);dialog.dispatchEvent({type:'keydown',key:'Enter',target:n.get('streamHost'),preventDefault(){prevented++;}});assert.equal(dialog.open,false);assert.equal(n.get('registrationStreamValue').value,'https://stream.example.com/live');assert.equal(prevented,1);
});

test('closing or leaving signup during a stream check prevents late results and requests',async()=>{
 const f=popupFixture(),n=f.nodes,bot=deferred();f.providerClick('other');f.address('https://stream.example.com/live');f.human(bot.promise);const first=n.get('testStream').onclick();await f.flush();n.get('streamSetupCancel').onclick();bot.resolve('old-token');await first;assert.equal(f.apiCalls.length,0);assert.equal(n.get('streamTestStatus').textContent,'');assert.equal(n.get('registrationStreamValue').value,'');
 const pending=deferred();f.human(Promise.resolve('checked-token'));f.result(pending.promise);f.providerClick('other');const second=n.get('testStream').onclick();await f.flush();f.hide();assert.equal(n.get('streamSetupDialog').open,false);pending.resolve({result:'audio_response',audio_response:true});await second;assert.notEqual(n.get('streamTestStatus').dataset.state,'success');assert.equal(n.get('registrationStreamValue').value,'');
});

test('an old queued close event and late clipboard completion cannot disturb a reopened setup',async()=>{
 const f=popupFixture(),n=f.nodes,pending=deferred();f.providerClick('other');f.address('https://stream.example.com/live');f.copyResult(pending.promise);const copying=n.get('copyGeneratedStream').onclick();n.get('streamSetupCancel').onclick();f.providerClick('icecast');f.input('streamPort','99999');n.get('streamSetupSave').onclick();const focused=f.document.activeElement,status=n.get('streamTestStatus').textContent;n.get('streamSetupDialog').dispatchEvent(new Event('close'));assert.equal(n.get('streamSetupDialog').open,true);assert.equal(f.providers.find(field=>field.checked).value,'icecast');assert.notEqual(n.get('streamPort').validationMessage,'');pending.resolve();await copying;assert.equal(n.get('streamTestStatus').textContent,status);assert.equal(f.document.activeElement,focused);assert.equal(n.get('registrationStreamValue').value,'');
});

test('popup drafts reset separately from signup and no selection or canonical value survives form reset',async()=>{
 const f=popupFixture(),n=f.nodes;f.providerClick('other');f.address('https://stream.example.com/live');n.get('streamSetupSave').onclick();n.get('streamSetupEdit').onclick();f.address('https://draft.example.com/live');await f.reset();assert.equal(n.get('streamSetupDialog').open,false);assert.equal(n.get('registrationStreamValue').value,'');assert.equal(n.get('streamSetupSummary').hidden,true);assert.equal(n.get('streamSetupSummaryText').textContent,'');assert.equal(f.providers.some(field=>field.checked),false);f.providerClick('other');assert.equal(n.get('streamUrlInput').value,'');n.get('streamSetupCancel').onclick();f.providerClick('icecast');assert.equal(n.get('streamHost').value,'');
});

test('busy or hidden signup does not open or commit stream setup',()=>{
 const f=popupFixture(),n=f.nodes;n.get('saveRegistration').disabled=true;f.providerClick('other');assert.equal(n.get('streamSetupDialog').open,false);assert.equal(f.providers.some(field=>field.checked),false);n.get('saveRegistration').disabled=false;f.providerClick('other');f.address('https://stream.example.com/live');n.get('saveRegistration').disabled=true;assert.equal(n.get('streamSetupSave').onclick(),false);assert.equal(n.get('registrationStreamValue').value,'');f.language();assert.equal(n.get('streamUrlInput').disabled,true);n.get('streamSetupCancel').onclick();n.get('saveRegistration').disabled=false;f.hide();f.providerClick('icecast');assert.equal(n.get('streamSetupDialog').open,false);
});

test('Icecast and SHOUTcast show server setup, while Stream URL shows direct entry',()=>{
 const f=registrationFixture({providerControls:true}),n=f.nodes;
 for(const provider of ['icecast','shoutcast']){f.provider(provider);assert.equal(n.get('streamManualSetup').hidden,false);assert.equal(n.get('streamManualSetup').open,true);assert.equal(n.get('streamAddressFields').hidden,false);assert.equal(n.get('streamUrlInput').readOnly,true);assert.equal(n.get('streamUrlInput').disabled,false);assert.equal(n.get('streamUrlLabel').textContent,'Generated stream URL');for(const id of ['streamHost','streamPort','streamProtocol','streamPath'])assert.equal(n.get(id).disabled,false);assert.equal(n.get('streamPath').value,'');assert.equal(f.prepare(),false);assert.equal(f.document.activeElement,n.get('streamHost'));}
 f.provider('other');assert.equal(n.get('streamManualSetup').hidden,true);assert.equal(n.get('streamManualSetup').open,false);assert.equal(n.get('streamAddressFields').hidden,true);assert.equal(n.get('streamUrlInput').readOnly,false);assert.equal(n.get('streamUrlLabel').textContent,'Stream URL');for(const id of ['streamHost','streamPort','streamProtocol','streamPath']){assert.equal(n.get(id).disabled,true);assert.equal(n.get(id).validationMessage,'');}assert.equal(f.prepare(),false);assert.equal(f.document.activeElement,n.get('streamUrlInput'));assert.equal(f.apiCalls.length,0);assert.equal(f.humanCalls.length,0);
});

test('a pasted direct URL moves to server setup without rewriting exact HTTP, path, query or spelling',()=>{
 const url='http://STREAM.EXAMPLE.COM:8000/ExactPath.mp3?sid=2&source=a%2Fb',f=registrationFixture({providerControls:true,provider:'other'}),n=f.nodes;f.address(url);const dirty=f.dirty();
 for(const provider of ['shoutcast','icecast','other','icecast']){f.provider(provider);assert.equal(n.get('streamUrlInput').value,url);assert.equal(n.get('streamHost').value,'stream.example.com');assert.equal(n.get('streamPort').value,'8000');assert.equal(n.get('streamProtocol').value,'http');assert.equal(n.get('streamPath').value,'/ExactPath.mp3?sid=2&source=a%2Fb');assert.equal(f.dirty(),dirty,'mode switches must not dispatch synthetic address edits');}
 assert.equal(f.prepare(),true);assert.equal(n.get('streamUrlInput').value,'http://stream.example.com:8000/ExactPath.mp3?sid=2&source=a%2Fb');
});

test('server editing generates its URL, and switching modes preserves valid manual details',()=>{
 const f=registrationFixture({providerControls:true}),n=f.nodes;f.input('streamHost','stream.example.com');f.input('streamPort','8443');f.input('streamProtocol','http');f.input('streamPath','/provider-mount?sid=3&source=community');const expected=n.get('streamUrlInput').value;
 for(const provider of ['shoutcast','other','icecast']){f.provider(provider);assert.equal(n.get('streamUrlInput').value,expected);assert.equal(n.get('streamPath').value,'/provider-mount?sid=3&source=community');assert.equal(n.get('streamPort').value,'8443');assert.equal(f.prepare(),true);}
 f.input('streamPath','/next-mount?sid=4');assert.equal(n.get('streamUrlInput').value,'http://stream.example.com:8443/next-mount?sid=4');
});

test('an invalid manual draft survives a direct-mode visit and hidden validation never blocks direct save',()=>{
 const f=registrationFixture({providerControls:true,url:'http://first.example.com:8000/live?sid=2'}),n=f.nodes;f.input('streamPort','99999');f.input('streamPath','//unfinished');assert.equal(f.prepare(),false);assert.equal(n.get('streamUrlInput').value,'');
 f.provider('other');assert.equal(n.get('streamUrlInput').value,'http://first.example.com:8000/live?sid=2');assert.equal(n.get('streamPort').value,'99999');assert.equal(n.get('streamPath').value,'//unfinished');assert.equal(n.get('streamPort').disabled,true);assert.equal(n.get('streamPort').validationMessage,'');assert.equal(f.prepare(),true);
 f.provider('shoutcast');assert.equal(n.get('streamPort').value,'99999');assert.equal(n.get('streamPath').value,'//unfinished');assert.equal(n.get('streamUrlInput').value,'');assert.equal(f.prepare(),false);assert.equal(f.document.activeElement,n.get('streamPort'));f.input('streamPort','9000');assert.equal(f.prepare(),false);assert.equal(f.document.activeElement,n.get('streamPath'));
});

test('an incomplete direct draft is preserved separately and a later valid URL replaces manual details',()=>{
 const f=registrationFixture({providerControls:true,url:'http://first.example.com:8000/original'}),n=f.nodes;f.provider('other');f.address('https://');f.provider('icecast');assert.equal(n.get('streamUrlInput').value,'http://first.example.com:8000/original');assert.equal(n.get('streamHost').value,'first.example.com');f.provider('other');assert.equal(n.get('streamUrlInput').value,'https://');assert.equal(f.prepare(),false);assert.equal(f.document.activeElement,n.get('streamUrlInput'));
 f.address('http://next.example.com:9000/;?sid=7');f.provider('shoutcast');assert.equal(n.get('streamUrlInput').value,'http://next.example.com:9000/;?sid=7');assert.equal(n.get('streamHost').value,'next.example.com');assert.equal(n.get('streamPort').value,'9000');assert.equal(n.get('streamPath').value,'/;?sid=7');assert.equal(f.prepare(),true);
});

test('provider modes retain public-address, credential and private-query validation',()=>{
 for(const provider of ['icecast','shoutcast','other']){const f=registrationFixture({providerControls:true,provider}),n=f.nodes;
  if(provider==='other')f.address('http://192.168.1.2/live');else{f.input('streamHost','192.168.1.2');f.input('streamPath','/live');}assert.equal(f.prepare(),false);assert.equal(n.get('testStream').disabled,true);assert.equal(f.document.activeElement,n.get(provider==='other'?'streamUrlInput':'streamHost'));
  if(provider==='other')f.address('https://owner:private-password@stream.example.com/live?token=private-token');else{f.input('streamHost','stream.example.com');f.input('streamPath','/live?token=private-token');}assert.equal(f.prepare(),false);assert.equal(n.get('testStream').disabled,true);assert.doesNotMatch(n.get('streamTestStatus').textContent,/private-password|private-token/);assert.equal(f.apiCalls.length,0);
 }
});

test('provider switching invalidates an old stream check without extra requests or false success',async()=>{
 const f=registrationFixture({providerControls:true,url:'https://stream.example.com/live?sid=2'}),pending=deferred();f.result(pending.promise);const checking=f.nodes.get('testStream').onclick();await f.flush();f.provider('other');assert.equal(f.nodes.get('streamTestStatus').textContent,'');assert.equal(f.apiCalls.length,1);assert.deepEqual(Object.keys(f.apiCalls[0].body).sort(),['stream_url','turnstile_token']);pending.resolve({result:'audio_response',audio_response:true});await checking;assert.notEqual(f.nodes.get('streamTestStatus').dataset.state,'success');assert.equal(f.apiCalls.length,1);assert.equal(f.nodes.get('testStream').disabled,false);
});

test('both server and direct modes support copy and optional testing through the same safe endpoint',async()=>{
 const f=registrationFixture({providerControls:true,url:'http://stream.example.com:8000/;?sid=2'});for(const provider of ['icecast','shoutcast','other']){f.provider(provider);await f.nodes.get('copyGeneratedStream').onclick();assert.equal(f.copied.at(-1),'http://stream.example.com:8000/;?sid=2');await f.nodes.get('testStream').onclick();assert.equal(f.apiCalls.at(-1).body.stream_url,'http://stream.example.com:8000/;?sid=2');assert.equal(f.prepare(),true);}assert.equal(f.apiCalls.length,3);
});

test('mode labels and guidance translate, and reset returns to empty Icecast setup',async()=>{
 const f=registrationFixture({providerControls:true,url:'https://stream.example.com/live'}),n=f.nodes;f.provider('shoutcast');f.window.appI18n={t:key=>({'registration.providerShoutcast':'Antre sèvè piblik la.','registration.generated':'Adrès ki kreye a','registration.streamUrl':'Adrès estasyon an'}[key]||key)};f.language();assert.equal(n.get('streamProviderHelp').textContent,'Antre sèvè piblik la.');assert.equal(n.get('streamUrlLabel').textContent,'Adrès ki kreye a');f.provider('other');assert.equal(n.get('streamUrlLabel').textContent,'Adrès estasyon an');await f.reset();assert.equal(f.providers.find(field=>field.checked).value,'icecast');assert.equal(n.get('streamManualSetup').hidden,false);assert.equal(n.get('streamManualSetup').open,true);assert.equal(n.get('streamUrlInput').readOnly,true);assert.equal(n.get('streamUrlInput').value,'');assert.equal(n.get('streamHost').value,'');assert.equal(n.get('testStream').disabled,true);assert.equal(f.prepare(),false);assert.equal(f.document.activeElement,n.get('streamHost'));
});

test('mode placeholder translation keys remain aligned after provider and language changes',()=>{
 const f=registrationFixture({providerControls:true}),url=f.nodes.get('streamUrlInput');assert.equal(url.dataset.i18nPlaceholder,'registration.generatedPlaceholder');assert.equal(url.placeholder,'Your stream URL appears here');
 f.provider('other');assert.equal(url.dataset.i18nPlaceholder,'registration.directPlaceholder');assert.equal(url.placeholder,'https://example.com/stream.mp3');f.window.appI18n={t:key=>({'registration.generatedPlaceholder':'Adrès la ap parèt isit la','registration.directPlaceholder':'https://example.com/stream.mp3'}[key]||key)};f.language();assert.equal(url.dataset.i18nPlaceholder,'registration.directPlaceholder');assert.equal(url.placeholder,'https://example.com/stream.mp3');
 f.provider('shoutcast');assert.equal(url.dataset.i18nPlaceholder,'registration.generatedPlaceholder');assert.equal(url.placeholder,'Adrès la ap parèt isit la');f.language();assert.equal(url.dataset.i18nPlaceholder,'registration.generatedPlaceholder');assert.equal(url.placeholder,'Adrès la ap parèt isit la');f.provider('other');assert.equal(url.dataset.i18nPlaceholder,'registration.directPlaceholder');assert.equal(url.placeholder,'https://example.com/stream.mp3');
});

test('busy signup cannot change modes, re-enable builder fields, copy or start stream tests',async()=>{
 const f=registrationFixture({providerControls:true,url:'https://stream.example.com/live'}),n=f.nodes;n.get('saveRegistration').disabled=true;n.get('registerForm').dispatchEvent(new Event('form-busy-changed'));f.provider('other');f.language();assert.equal(f.providers.find(field=>field.checked).value,'icecast');assert.equal(n.get('streamManualSetup').hidden,false);assert.equal(n.get('streamUrlInput').readOnly,true);for(const id of ['streamHost','streamPort','streamProtocol','streamPath'])assert.equal(n.get(id).disabled,true);await n.get('copyGeneratedStream').onclick();await n.get('testStream').onclick();assert.equal(f.copied.length,0);assert.equal(f.humanCalls.length,0);assert.equal(f.apiCalls.length,0);
 n.get('saveRegistration').disabled=false;n.get('registerForm').dispatchEvent(new Event('form-busy-changed'));for(const id of ['streamHost','streamPort','streamProtocol','streamPath'])assert.equal(n.get(id).disabled,false);f.provider('other');n.get('saveRegistration').disabled=true;f.language();n.get('saveRegistration').disabled=false;n.get('registerForm').dispatchEvent(new Event('form-busy-changed'));for(const id of ['streamHost','streamPort','streamProtocol','streamPath'])assert.equal(n.get(id).disabled,true);
 n.get('registerForm').dataset.busy='1';f.provider('icecast');assert.equal(f.providers.find(field=>field.checked).value,'other');assert.equal(n.get('streamUrlInput').readOnly,false);
});

test('an older signup form without provider controls keeps its original URL validation and optional builder',()=>{
 const f=registrationFixture({url:'https://stream.example.com/live',providerControls:false});assert.equal(f.prepare(),true);assert.equal(f.nodes.has('streamProviderHelp'),false);f.input('streamPort','8000');assert.equal(f.nodes.get('streamUrlInput').value,'https://stream.example.com:8000/live');
});

test('station names fit the radio UTF-8 capacity and reject embedded control characters',()=>{
 const f=registrationFixture({url:'https://stream.example.com/live'});
 for(const name of ['a'.repeat(96),'é'.repeat(48)]){f.input('stationName',name);assert.equal(f.prepare(),true);}
 for(const name of ['é'.repeat(49),'Station\u0000Name']){f.input('stationName',name);assert.equal(f.prepare(),false);assert.equal(f.document.activeElement,f.nodes.get('stationName'));}
 f.input('stationName','Radio Espwa');assert.equal(f.prepare(),true);assert.equal(f.nodes.get('stationName').validationMessage,'');
});

test('station names reject whitespace-only input before submission and trim a valid name without changing a typing draft',()=>{
 const f=registrationFixture({url:'https://stream.example.com/live'}),field=f.nodes.get('stationName');
 for(const value of ['', '   ', '\t\n']){f.input('stationName',value);assert.equal(f.prepare(),false);assert.match(field.validationMessage,/Enter your station name/);assert.equal(f.document.activeElement,field);assert.deepEqual(f.humanCalls,[]);assert.deepEqual(f.apiCalls,[]);}
 f.input('stationName','  Radio Espwa  ');assert.equal(field.value,'  Radio Espwa  ');assert.equal(field.validationMessage,'');assert.equal(f.prepare(),true);assert.equal(field.value,'Radio Espwa');
});

test('a complete stream URL populates manual details without changing HTTP, port, path or query',()=>{
 const f=registrationFixture({url:'http://stream.example.com:8000/live?sid=1'}),n=f.nodes;
 assert.equal(n.get('streamHost').value,'stream.example.com');assert.equal(n.get('streamPort').value,'8000');assert.equal(n.get('streamProtocol').value,'http');assert.equal(n.get('streamPath').value,'/live?sid=1');assert.equal(n.get('streamUrlInput').readOnly,false);assert.equal(n.get('streamManualSetup').open,false);assert.equal(f.dirty(),0);assert.equal(f.prepare(),true);
 for(const path of ['/live','/stream','/;','/stream/1/','/?sid=1']){const url='http://stream.example.com:8000'+path;f.address(url);assert.equal(f.prepare(),true,url);assert.equal(n.get('streamUrlInput').value,url);assert.equal(n.get('streamPath').value,path);}
 f.address('https://other.example.com/radio.mp3?sid=2');assert.equal(n.get('streamHost').value,'other.example.com');assert.equal(n.get('streamPort').value,'');assert.equal(n.get('streamProtocol').value,'https');assert.equal(n.get('streamPath').value,'/radio.mp3?sid=2');
});

test('manual fields compose the same editable URL and a blank path uses the server root',()=>{
 const f=registrationFixture(),n=f.nodes;f.input('streamHost','stream.example.com');assert.equal(n.get('streamUrlInput').value,'https://stream.example.com/');f.input('streamProtocol','http');f.input('streamPort','8000');f.input('streamPath','/broadcast.mp3');assert.equal(n.get('streamUrlInput').value,'http://stream.example.com:8000/broadcast.mp3');assert.ok(f.dirty()>0);assert.equal(f.prepare(),true);
 f.input('streamProtocol','https');assert.equal(n.get('streamUrlInput').value,'https://stream.example.com:8000/broadcast.mp3');f.input('streamPort','443');assert.equal(n.get('streamUrlInput').value,'https://stream.example.com/broadcast.mp3');
 f.address('http://new.example.com:9000/;');assert.equal(n.get('streamUrlInput').readOnly,false);assert.equal(f.prepare(),true);assert.equal(n.get('streamProtocol').value,'http');assert.equal(n.get('streamPort').value,'9000');assert.equal(n.get('streamPath').value,'/;');
});

test('an empty or reset form shows a blank editable URL with manual setup collapsed',async()=>{
 const f=registrationFixture(),n=f.nodes;assert.equal(n.get('streamUrlInput').value,'');assert.equal(n.get('streamUrlInput').readOnly,false);assert.equal(n.get('streamHost').required,false);assert.equal(n.get('streamManualSetup').open,false);assert.equal(n.get('testStream').disabled,true);assert.equal(n.get('copyGeneratedStream').disabled,true);assert.equal(f.dirty(),0);
 f.address('http://stream.example.com:8000/broadcast.mp3');n.get('streamManualSetup').open=true;assert.equal(f.prepare(),true);await f.reset();assert.equal(n.get('streamUrlInput').value,'');assert.equal(n.get('streamManualSetup').open,false);assert.equal(n.get('streamUrlInput').readOnly,false);assert.equal(n.get('streamHost').required,false);for(const id of ['streamHost','streamPort','streamProtocol','streamPath'])assert.equal(n.get(id).disabled,false);assert.equal(n.get('testStream').disabled,true);assert.equal(n.get('copyGeneratedStream').disabled,true);f.input('streamHost','other.example.com');assert.equal(n.get('streamUrlInput').value,'https://other.example.com/');
});

test('URL typing remains untouched until save preparation and incomplete input never retains a stale address',()=>{
 const f=registrationFixture(),n=f.nodes;f.address('HTTPS://STREAM.EXAMPLE.COM');assert.equal(n.get('streamUrlInput').value,'HTTPS://STREAM.EXAMPLE.COM');assert.equal(f.prepare(),true);assert.equal(n.get('streamUrlInput').value,'https://stream.example.com/');
 f.address('https://');assert.equal(n.get('streamUrlInput').value,'https://');assert.equal(n.get('testStream').disabled,true);assert.equal(f.prepare(),false);assert.equal(f.document.activeElement,n.get('streamUrlInput'));assert.equal(n.get('streamHost').value,'');
});

test('direct and generated URLs fit the same 1024-character radio limit',()=>{
 const f=registrationFixture(),base='https://stream.example.com/',valid=base+'a'.repeat(1024-base.length),tooLong=valid+'a';f.address(valid);assert.equal(f.prepare(),true);assert.equal(f.nodes.get('streamUrlInput').value.length,1024);f.address(tooLong);assert.equal(f.prepare(),false);assert.equal(f.nodes.get('testStream').disabled,true);
 f.input('streamHost','stream.example.com');f.input('streamPath','/'+ 'a'.repeat(1024-base.length));assert.equal(f.prepare(),true);f.input('streamPath','/'+'a'.repeat(1025-base.length));assert.equal(f.prepare(),false);assert.equal(f.nodes.get('streamUrlInput').value,'');
 const count=Math.floor((1024-base.length)/6),unicode=base+'é'.repeat(count)+'a'.repeat(1024-base.length-count*6);assert.ok(unicode.length<1024);assert.equal(new URL(unicode).href.length,1024);f.address(unicode);assert.equal(f.prepare(),true);assert.equal(f.nodes.get('streamUrlInput').value.length,1024);f.address(unicode+'a');assert.equal(f.prepare(),false);assert.equal(f.nodes.get('testStream').disabled,true);
 f.input('streamHost','stream.example.com');f.input('streamPath',new URL(unicode+'a').pathname);assert.equal(f.prepare(),false);assert.equal(f.nodes.get('streamUrlInput').value,'');
});

test('invalid builder details clear a stale URL and focus the field that needs correcting',()=>{
 const f=registrationFixture();f.input('streamHost','STREAM.EXAMPLE.COM');assert.equal(f.nodes.get('streamUrlInput').value,'https://stream.example.com/');assert.equal(f.prepare(),true);
 f.input('streamPort','0');assert.equal(f.nodes.get('streamUrlInput').value,'');assert.equal(f.prepare(),false);assert.equal(f.document.activeElement,f.nodes.get('streamPort'));f.input('streamPort','65535');assert.equal(f.prepare(),true);f.input('streamPort','65536');assert.equal(f.prepare(),false);f.input('streamPort','');assert.equal(f.prepare(),true);
 f.input('streamPath','//elsewhere.example/live');assert.equal(f.prepare(),false);assert.equal(f.nodes.get('streamUrlInput').value,'');assert.equal(f.nodes.get('saveRegistration').disabled,false);
});

test('public IPv4 can be saved while private, credential, fragment, token and IPv6 URLs or details are rejected safely',()=>{
 const f=registrationFixture();for(const value of ['https://8.8.8.8:8000/live','https://stream.example.com/live?sid=2']){f.address(value);assert.equal(f.prepare(),true,value);}
 for(const host of ['127.0.0.1','192.168.1.2','10.0.0.1','169.254.2.3','224.0.0.1','stream.local','[2001:db8::1]','owner:veryprivate@stream.example.com','https://stream.example.com']){f.input('streamHost',host);assert.equal(f.prepare(),false,host);assert.equal(f.nodes.get('streamUrlInput').value,'');assert.doesNotMatch(f.nodes.get('streamTestStatus').textContent,/veryprivate/);}
 f.input('streamHost','stream.example.com');for(const path of ['/live#veryprivate','/live?token=veryprivate']){f.input('streamPath',path);assert.equal(f.prepare(),false,path);assert.equal(f.nodes.get('streamUrlInput').value,'');assert.doesNotMatch(f.nodes.get('streamTestStatus').textContent,/veryprivate/);}
 for(const value of ['http://127.0.0.1/live','http://192.168.1.2/live','http://10.0.0.1/live','http://169.254.2.3/live','http://224.0.0.1/live','http://stream.local/live','http://[2001:db8::1]/live','https://owner:veryprivate@stream.example.com/live','https://stream.example.com/live#veryprivate','https://stream.example.com/live?token=veryprivate']){f.address(value);assert.equal(f.prepare(),false,value);assert.equal(f.nodes.get('testStream').disabled,true);assert.doesNotMatch(f.nodes.get('streamTestStatus').textContent,/veryprivate/);}
});

test('generated URLs match server rejection of zero ports, trailing-dot hostnames and special-use domain suffixes',()=>{
 const f=registrationFixture();
 for(const value of ['https://stream.example.com:0/live','http://stream.example.com./live','https://device.home.arpa/live','http://stream.arpa/live','http://stream.example/live','https://stream.onion/live']){assert.throws(()=>publicStreamUrl(value));f.address(value);assert.equal(f.prepare(),false,value);assert.equal(f.nodes.get('testStream').disabled,true);}
 for(const value of ['https://stream.example.com:65535/live','http://8.8.8.8:8000/live']){assert.equal(publicStreamUrl(value),value);f.address(value);assert.equal(f.prepare(),true,value);}
});

test('stream checking is optional, guarded against duplicate clicks, and uses a dedicated bot check without playing audio',async()=>{
 const f=registrationFixture({url:'https://stream.example.com/live'}),pending=deferred();f.result(pending.promise);
 const first=f.nodes.get('testStream').onclick(),second=f.nodes.get('testStream').onclick();await f.flush();assert.equal(f.humanCalls.length,1);assert.equal(f.humanCalls[0].container,f.nodes.get('streamTestHuman'));assert.equal(f.humanCalls[0].action,'stream-check');assert.equal(f.apiCalls.length,1);assert.equal(f.apiCalls[0].path,'/api/owner/stream-check');assert.equal(f.apiCalls[0].body.stream_url,'https://stream.example.com/live');assert.equal(f.nodes.get('saveRegistration').disabled,false);assert.equal(f.prepare(),true);
 pending.resolve({result:'audio_response',audio_response:true,message:'Anything'});await Promise.all([first,second]);assert.equal(f.nodes.get('streamTestStatus').dataset.state,'success');assert.match(f.nodes.get('streamTestStatus').textContent,/Playback is not verified/);assert.equal(f.nodes.get('testStream').disabled,false);
});

test('old test acknowledgements are ignored after editing the address or leaving registration',async()=>{
 const f=registrationFixture({url:'https://stream.example.com/live'}),pending=deferred();f.result(pending.promise);const first=f.nodes.get('testStream').onclick();await f.flush();f.address('https://other.example.com/live');pending.resolve({result:'audio_response',audio_response:true,message:'Old success'});await first;assert.notEqual(f.nodes.get('streamTestStatus').dataset.state,'success');assert.doesNotMatch(f.nodes.get('streamTestStatus').textContent,/Old success/);
 const bot=deferred();f.human(bot.promise);const second=f.nodes.get('testStream').onclick();await f.flush();f.hide();bot.resolve('old-token');await second;assert.equal(f.apiCalls.length,1);assert.equal(f.nodes.get('streamTestStatus').textContent,'');
});

test('not-confirmed and malformed acknowledgements do not become playback success or prevent saving',async()=>{
 const f=registrationFixture({url:'https://stream.example.com/live'});await f.nodes.get('testStream').onclick();assert.equal(f.nodes.get('streamTestStatus').dataset.state,'unconfirmed');assert.equal(f.prepare(),true);assert.equal(f.nodes.get('saveRegistration').disabled,false);
 f.result(Promise.resolve({result:'audio_response',audio_response:false,message:'Verified success'}));await f.nodes.get('testStream').onclick();assert.equal(f.nodes.get('streamTestStatus').dataset.state,'unconfirmed');assert.doesNotMatch(f.nodes.get('streamTestStatus').textContent,/Verified success/);
 assert.equal(f.apiCalls.length,2);
});

test('numeric IP and playlist checks explain their limits without bot checks or API calls and remain saveable',async()=>{
 for(const [url,explanation] of [['http://8.8.8.8:8000/live',/numeric IP addresses/],['https://stream.example.com/listen.pls?sid=1',/playlist link/],['https://stream.example.com/live.m3u',/playlist link/],['https://stream.example.com/live.m3u8',/playlist link/],['https://stream.example.com/live.xspf',/playlist link/]]){
  const f=registrationFixture({url});await f.nodes.get('testStream').onclick();assert.equal(f.nodes.get('streamTestStatus').dataset.state,'unconfirmed',url);assert.match(f.nodes.get('streamTestStatus').textContent,explanation,url);assert.equal(f.humanCalls.length,0);assert.equal(f.apiCalls.length,0);assert.equal(f.prepare(),true);assert.equal(f.nodes.get('saveRegistration').disabled,false);assert.equal(f.nodes.get('testStream').disabled,false);
 }
});

test('a stale completed check cannot unlock a newer pending check or overwrite its status',async()=>{
 const f=registrationFixture({url:'https://first.example.com/live'}),older=deferred(),newer=deferred();f.result(older.promise);const first=f.nodes.get('testStream').onclick();await f.flush();f.address('https://second.example.com/live');f.result(newer.promise);const second=f.nodes.get('testStream').onclick();await f.flush();older.resolve({result:'audio_response',audio_response:true});await first;assert.equal(f.nodes.get('testStream').disabled,true);assert.equal(f.nodes.get('streamTestStatus').dataset.state,'checking');newer.resolve({result:'not_confirmed',audio_response:false,message:'Second check did not confirm audio.'});await second;assert.equal(f.nodes.get('streamTestStatus').textContent,'Stream could not be confirmed. You can still save it.');assert.equal(f.nodes.get('testStream').disabled,false);assert.equal(f.apiCalls.length,2);
});

test('copy supports secure clipboard and a manual selection fallback, and status follows language changes',async()=>{
 const f=registrationFixture({url:'https://stream.example.com/live'});await f.nodes.get('copyGeneratedStream').onclick();assert.deepEqual(f.copied,['https://stream.example.com/live']);f.window.appI18n={t:key=>key==='registration.urlCopied'?'Adrès la kopye.':key};f.language();assert.equal(f.nodes.get('streamTestStatus').textContent,'Adrès la kopye.');
 const manual=registrationFixture({url:'https://stream.example.com/live',secure:false,clipboard:false});await manual.nodes.get('copyGeneratedStream').onclick();assert.equal(manual.nodes.get('streamUrlInput').selected,true);assert.match(manual.nodes.get('streamTestStatus').textContent,/Select and copy/);
});
