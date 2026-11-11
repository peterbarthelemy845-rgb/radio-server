import {test} from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import {publicStreamUrl} from './public-stream-url.mjs';

function deferred(){let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return {promise,resolve,reject};}
function registrationFixture({url='',secure=true,clipboard=true,providerControls=true}={}){
 const nodes=new Map(),observers=[],windowEvents={},humanCalls=[],apiCalls=[],copied=[];let dirty=0,humanResult=Promise.resolve('checked-token'),apiResult=Promise.resolve({result:'not_confirmed',audio_response:false,message:'Not confirmed. You can still save.'});
 const ids=['register','registerForm','stationName','streamManualSetup','streamAddressFields','streamHost','streamPort','streamProtocol','streamPath','streamUrlInput','copyGeneratedStream','testStream','streamTestStatus','streamTestHuman','saveRegistration'];
 function element(id){const listeners={};const node={id,value:'',hidden:false,open:false,disabled:false,readOnly:false,required:false,dataset:{},attrs:{},validity:{badInput:false},validationMessage:'',textContent:'',setAttribute(key,value){this.attrs[key]=value;},removeAttribute(key){delete this.attrs[key];},querySelector(){return id==='registerForm'?nodes.get('saveRegistration'):null;},setCustomValidity(value){this.validationMessage=value;},reportValidity(){this.reported=true;return !this.validationMessage;},focus(){document.activeElement=this;},select(){this.selected=true;},addEventListener(type,fn){(listeners[type]??=[]).push(fn);},dispatchEvent(event){for(const fn of listeners[event.type]||[])fn(event);if(event.bubbles&&id!=='registerForm')nodes.get('registerForm').dispatchEvent(event);return true;}};nodes.set(id,node);return node;}
 ids.forEach(element);const document={activeElement:null,getElementById:id=>nodes.get(id)};nodes.get('registerForm').elements={name:nodes.get('stationName')};nodes.get('stationName').value='Test station';nodes.get('streamProtocol').value='https';nodes.get('streamUrlInput').value=url;nodes.get('registerForm').addEventListener('input',()=>{dirty++;});
 const providers=providerControls?['icecast','shoutcast','other'].map((value,index)=>{const field=element('provider-'+value);field.name='stream_provider';field.type='radio';field.value=value;field.checked=index===0;return field;}):[];if(providerControls)element('streamProviderHelp');nodes.get('registerForm').querySelectorAll=selector=>selector==='input[name="stream_provider"]'?providers:[];
 const window={isSecureContext:secure,addEventListener(type,fn){windowEvents[type]=fn;}};
 const navigator={clipboard:clipboard?{async writeText(value){copied.push(value);}}:undefined};
 const context=vm.createContext({window,document,navigator,URL,Event,Promise,TextEncoder,queueMicrotask,MutationObserver:class{constructor(fn){this.fn=fn;observers.push(this);}observe(target){this.target=target;}},human:async(container,action)=>{humanCalls.push({container,action});return humanResult;},api:async(path,body)=>{apiCalls.push({path,body});return apiResult;},Audio:class{constructor(){throw Error('Registration must never play audio.');}},fetch(){throw Error('Registration may use only the authenticated stream-check API.');}});
 vm.runInContext(readFileSync(new URL('./public/assets/registration-form.js',import.meta.url),'utf8'),context);
 function input(id,value){nodes.get(id).value=value;nodes.get(id).dispatchEvent(new Event('input',{bubbles:true}));}
 function address(value){input('streamUrlInput',value);}
 async function flush(){await Promise.resolve();await Promise.resolve();await Promise.resolve();}
 return {nodes,window,document,input,address,flush,humanCalls,apiCalls,copied,providers,provider(value){for(const field of providers)field.checked=field.value===value;providers.find(field=>field.checked)?.dispatchEvent(new Event('change',{bubbles:true}));},dirty:()=>dirty,prepare:()=>window.prepareRegistrationStream(),human(result){humanResult=result;},result(result){apiResult=result;},async reset(){nodes.get('registerForm').dispatchEvent(new Event('reset'));for(const id of ['streamHost','streamPort','streamPath','streamUrlInput'])nodes.get(id).value='';nodes.get('streamProtocol').value='https';for(const field of providers)field.checked=field.value==='icecast';await flush();},hide(){nodes.get('register').hidden=true;for(const observer of observers)if(observer.target===nodes.get('register'))observer.fn([]);},language(){windowEvents['app-language-changed']?.();}};
}

test('Icecast guidance is the default and provider choices never guess a listening path',()=>{
 const f=registrationFixture(),help=f.nodes.get('streamProviderHelp');assert.equal(f.providers.find(field=>field.checked).value,'icecast');assert.equal(help.attrs['data-i18n'],'registration.providerIcecast');assert.match(help.textContent,/public Icecast listening link/);assert.match(help.textContent,/mount point/);
 for(const provider of ['shoutcast','other','icecast']){f.provider(provider);assert.equal(f.nodes.get('streamUrlInput').value,'');assert.equal(f.nodes.get('streamPath').value,'');assert.equal(f.nodes.get('streamHost').value,'');assert.equal(f.nodes.get('streamPort').value,'');assert.equal(f.nodes.get('testStream').disabled,true);assert.equal(f.prepare(),false);}
 f.provider('shoutcast');assert.match(help.textContent,/supplied by your provider/);assert.doesNotMatch(help.textContent,/\/;stream/);assert.equal(f.apiCalls.length,0);assert.equal(f.humanCalls.length,0);
});

test('provider changes preserve an exact pasted URL, its path/query and optional manual details',()=>{
 const url='http://STREAM.EXAMPLE.COM:8000/ExactPath.mp3?sid=2&source=a%2Fb',f=registrationFixture({url}),ids=['streamUrlInput','streamHost','streamPort','streamProtocol','streamPath'],before=ids.map(id=>f.nodes.get(id).value),dirty=f.dirty();
 for(const provider of ['shoutcast','other','icecast']){f.provider(provider);assert.deepEqual(ids.map(id=>f.nodes.get(id).value),before);assert.equal(f.dirty(),dirty,'help changes must not dispatch synthetic draft edits');for(const id of ['streamHost','streamPort','streamProtocol','streamPath'])assert.equal(f.nodes.get(id).required,false);assert.equal(f.nodes.get('streamUrlInput').readOnly,false);}
 assert.equal(f.nodes.get('streamUrlInput').value,url);assert.equal(f.prepare(),true);assert.equal(f.nodes.get('streamUrlInput').value,'http://stream.example.com:8000/ExactPath.mp3?sid=2&source=a%2Fb');
});

test('switching providers keeps a manually composed address and query without changing the active source',()=>{
 const f=registrationFixture();f.input('streamHost','stream.example.com');f.input('streamPort','8443');f.input('streamProtocol','http');f.input('streamPath','/provider-mount?sid=3&source=community');const expected=f.nodes.get('streamUrlInput').value,dirty=f.dirty();
 for(const provider of ['shoutcast','other','icecast']){f.provider(provider);assert.equal(f.nodes.get('streamUrlInput').value,expected);assert.equal(f.nodes.get('streamPath').value,'/provider-mount?sid=3&source=community');assert.equal(f.nodes.get('streamPort').value,'8443');assert.equal(f.dirty(),dirty);assert.equal(f.prepare(),true);}
 f.input('streamPath','/next-mount?sid=4');assert.equal(f.nodes.get('streamUrlInput').value,'http://stream.example.com:8443/next-mount?sid=4');
});

test('provider guidance never bypasses public-address, credential or private-query validation',()=>{
 for(const provider of ['icecast','shoutcast','other'])for(const url of ['http://192.168.1.2/live','https://owner:private-password@stream.example.com/live','https://stream.example.com/live?token=private-token']){const f=registrationFixture({url});f.provider(provider);assert.equal(f.nodes.get('streamUrlInput').value,url);assert.equal(f.prepare(),false);assert.equal(f.nodes.get('testStream').disabled,true);assert.doesNotMatch(f.nodes.get('streamProviderHelp').textContent,/private-password|private-token/);assert.equal(f.apiCalls.length,0);}
});

test('provider help can change during a stream check without invalidating or expanding its request',async()=>{
 const f=registrationFixture({url:'https://stream.example.com/live?sid=2'}),pending=deferred();f.result(pending.promise);const checking=f.nodes.get('testStream').onclick();await f.flush();f.provider('shoutcast');assert.equal(f.nodes.get('streamTestStatus').dataset.state,'checking');assert.equal(f.apiCalls.length,1);assert.deepEqual(Object.keys(f.apiCalls[0].body).sort(),['stream_url','turnstile_token']);assert.equal(f.apiCalls[0].body.stream_url,'https://stream.example.com/live?sid=2');
 pending.resolve({result:'audio_response',audio_response:true});await checking;assert.equal(f.nodes.get('streamTestStatus').dataset.state,'success');f.provider('other');assert.equal(f.nodes.get('streamTestStatus').dataset.state,'success');assert.equal(f.apiCalls.length,1);assert.equal(f.humanCalls.length,1);
});

test('provider guidance translates in place and resets to the browser default after form reset',async()=>{
 const f=registrationFixture({url:'https://stream.example.com/live'}),help=f.nodes.get('streamProviderHelp');f.provider('shoutcast');f.window.appI18n={t:key=>key==='registration.providerShoutcast'?'Sèvi ak lyen piblik founisè SHOUTcast la.':key==='registration.providerIcecast'?'Sèvi ak lyen piblik Icecast la.':key};f.language();assert.equal(help.textContent,'Sèvi ak lyen piblik founisè SHOUTcast la.');assert.equal(help.attrs['data-i18n'],'registration.providerShoutcast');assert.equal(f.providers.find(field=>field.checked).value,'shoutcast');await f.reset();assert.equal(help.attrs['data-i18n'],'registration.providerIcecast');assert.equal(help.textContent,'Sèvi ak lyen piblik Icecast la.');assert.equal(f.nodes.get('streamUrlInput').value,'');
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
