import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
const id='a'.repeat(32),radio={id,online:true,device_code:'3961',remote_control_version:1,controls_ready:true,controls_allowed:true,volume_percent:40,muted:false,current_station_code:'10',firmware_version:'2026.11.07.1'};
function fixture(initial={...radio},{release={version:'2026.11.07.1',sketch_url:'/assets/waveshare-radio.zip'}}={}){
 const events={},calls=[],answers=[];let clock=1800000000000,refreshes=0,stale;
 function node(tag='div'){const result={tag,children:[],dataset:{},attributes:{},textContent:'',hidden:false,value:'',disabled:false,parentElement:null,setAttribute(key,value){this.attributes[key]=value;},append(...children){for(const child of children){child.parentElement=this;this.children.push(child);}},replaceChildren(...children){this.children=[];this.append(...children);},addEventListener(name,fn){this[name+'Listener']=fn;},showModal(){this.open=true;},close(){this.open=false;this.closeListener?.();}};Object.defineProperty(result,'innerHTML',{set(){throw Error('Unsafe HTML');}});return result;}
 const card=node(),status=node();card.append(status);
 class FakeDate extends Date{static now(){return clock;}}
 const document={body:node('body'),createElement:node,createTextNode:text=>({textContent:text})};
 const window={addEventListener(name,fn){events[name]=fn;},dispatchEvent(){}};
 const ctx={document,window,Date:FakeDate,Event:class{constructor(type){this.type=type;}},CustomEvent:class{constructor(type,init){this.type=type;this.detail=init?.detail;}},crypto:{randomUUID:()=> 'request-reference-123456'},radioLastChecked:0,radioCardViews:new Map([[id,{status,radio:initial}]]),stations:[{listener_code:'10',name:'<img src=x onerror=alert(1)>'}],readRadioInventory:()=>({known:true,codes:new Set(['10'])}),loadRadioInventory:async()=>{},loadMyRadios:()=>{refreshes++;},fetch:async()=>({ok:true,json:async()=>release}),clearTimeout(){},setTimeout(fn,ms){if(ms===2000){clock+=2000;queueMicrotask(fn);}else stale=fn;return 1;},api:async(path,body)=>{calls.push({path,body});const value=answers.shift();if(value instanceof Error)throw value;if(typeof value==='function')return value();if(!value)throw Error('Missing test response');return value;}};
 runInNewContext(readFileSync(new URL('./public/assets/radio-controls.js',import.meta.url),'utf8'),ctx);
 events['radio-status-updated']({detail:{radios:[initial]}});
 return {window,events,calls,answers,card,get:name=>runInNewContext(name,ctx),open:runInNewContext('openRadioControls',ctx),send:runInNewContext('sendRadioControl',ctx),advance(ms){clock+=ms;},expire(){stale?.();},refreshes:()=>refreshes};
}
function text(node){return node.textContent+(node.children||[]).map(text).join('');}
test('legacy and stale radios show software help without enabling phone actions',async()=>{
 const f=fixture({...radio,remote_control_version:0,controls_ready:false,controls_allowed:false,firmware_version:null});await f.open(id);assert.equal(f.get('radioControlsDialog').open,true);assert.equal(f.get('radioControlsVolume').disabled,true);assert.equal(f.get('radioControlsPlay').disabled,true);assert.equal(f.get('radioControlsEnable').hidden,true);assert.match(f.get('radioControlsHelp').textContent,/Update the radio software/);assert.equal(f.get('radioSoftwareDownload').href,'/assets/waveshare-radio.zip');
 const active=fixture();await active.open(id);assert.equal(active.get('radioControlsVolume').disabled,false);active.events['radio-status-updated']({detail:{unavailable:true}});assert.equal(active.get('radioControlsVolume').disabled,true);assert.equal(active.get('radioControlsClose').disabled,false);await active.send('set_volume',50);assert.equal(active.calls.length,0);
});
test('phone-control approval sends no control command and needs an explicit later action',async()=>{
 const f=fixture({...radio,controls_allowed:false});await f.open(id);f.answers.push({claim_id:'c'.repeat(32),confirmation_code:'5831'},{state:'approved'},{radios:[radio]});await f.get('radioControlsEnable').onclick();assert.deepEqual(f.calls.map(call=>call.path),['/api/phone/control/authorize','/api/phone/claim/status','/api/phone/radios']);assert.equal(f.window.radioControlsBusy,false);assert.equal(f.get('radioControlsPlay').disabled,false);assert.match(f.get('radioControlsNotice').textContent,/enabled/);
});
test('a volume command reports success only after radio acknowledgement and prevents repeated writes',async()=>{
 const f=fixture();await f.open(id);let release;f.answers.push(()=>new Promise(resolve=>{release=resolve;}));const pending=f.send('set_volume',65);assert.equal(f.window.radioControlsBusy,true);assert.equal(f.get('radioControlsClose').disabled,true);assert.equal(f.window.closeRadioControls(),false);await f.send('set_volume',70);assert.equal(f.calls.length,1);
 f.answers.push({state:'applied'},{radios:[{...radio,volume_percent:65}]});release({command_id:'d'.repeat(32),state:'pending'});await pending;assert.equal(f.calls.filter(call=>call.path==='/api/phone/control').length,1);assert.equal(f.calls[0].body.value,65);assert.match(f.calls[0].body.request_id,/request-reference/);assert.match(f.get('radioControlsNotice').textContent,/confirmed/);assert.equal(f.get('radioControlsVolume').value,'65');assert.equal(f.window.radioControlsBusy,false);
});
test('failed or uncertain commands never display success and are never automatically reposted',async()=>{
 const f=fixture();await f.open(id);f.answers.push({command_id:'d'.repeat(32),state:'pending'},{state:'expired'});await f.send('set_mute',true);assert.match(f.get('radioControlsNotice').textContent,/did not confirm/);assert.equal(f.calls.filter(call=>call.path==='/api/phone/control').length,1);assert.equal(f.window.radioControlsBusy,false);
 f.answers.push(Error('Network lost after write'));await f.send('set_volume',60);assert.match(f.get('radioControlsNotice').textContent,/did not confirm/);assert.equal(f.calls.filter(call=>call.path==='/api/phone/control').length,2);
});
test('saved station names stay text and status/language refresh does not overwrite a volume edit',async()=>{
 const f=fixture();await f.open(id);assert.equal(f.get('radioControlsStation').children[0].textContent,'<img src=x onerror=alert(1)>');assert.equal(f.get('radioControlsStation').children[0].dataset.i18nSkip,'true');
 f.get('radioControlsVolume').value='75';f.get('radioControlsVolume').oninput();f.events['radio-status-updated']({detail:{radios:[{...radio,volume_percent:25}]}});f.events['app-language-changed']();assert.equal(f.get('radioControlsVolume').value,'75');assert.equal(f.get('radioControlsVolumeValue').textContent,'75%');
 f.expire();assert.equal(f.get('radioControlsPlay').disabled,true);assert.equal(f.get('radioControlsMute').disabled,true);
});
test('download manifest cannot send a user to an external or arbitrary upload URL',async()=>{
 const f=fixture(radio,{release:{version:'2026.11.07.1',sketch_url:'https://evil.example/firmware.zip'}});await f.open(id);await new Promise(resolve=>setImmediate(resolve));assert.equal(f.get('radioControlsRelease'),null);assert.equal(f.get('radioSoftwareDownload').href,'/assets/waveshare-radio.zip');
});
