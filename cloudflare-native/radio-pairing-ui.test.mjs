import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
const source=readFileSync(new URL('./public/assets/my-radio.js',import.meta.url),'utf8');
const site=readFileSync(new URL('./public/assets/site.js',import.meta.url),'utf8'),busySource=site.slice(site.indexOf('const formBusyStates='),site.indexOf('function loadHuman('));
function deferred(){let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return {promise,resolve,reject};}
async function until(check){for(let i=0;i<50&&!check();i++)await new Promise(setImmediate);assert.ok(check(),'Async checkpoint was not reached');}
function fixture({human=async()=> 'bot-proof'}={}){
 const ids=new Map(),calls=[],answers=[],dialogs=[],selections=[],observers=[];
 function node(tag='div'){return {tag,children:[],hidden:false,disabled:false,textContent:'',className:'',dataset:{},attributes:{},elements:{},setAttribute(k,v){this.attributes[k]=v;},removeAttribute(k){delete this.attributes[k];},dispatchEvent(){},append(...items){this.children.push(...items);},replaceChildren(...items){this.children=items;},before(){},focus(){},querySelector(){return this.button;},querySelectorAll(selector){return selector==='button'?[this.button]:[...Object.values(this.elements),this.button];},reset(){this.resetCount=(this.resetCount||0)+1;}};}
 for(const id of ['myRadio','linkedRadios','connectRadio','connectRadioForm','radioConnectStatus','refreshRadios','navRadio','openWifiSetup'])ids.set(id,node());
 const form=ids.get('connectRadioForm');form.button=node('button');form.elements.device_code=Object.assign(node('input'),{value:'3961'});
 const document={hidden:false,createElement:node,addEventListener(){}},ctx={document,navigator:{onLine:true},Date,location:{hash:'#radio',search:''},history:{replaceState(){}},window:{addEventListener(){},dispatchEvent(){}},Event:class{constructor(type){this.type=type;}},CustomEvent:class{constructor(type,options){this.type=type;this.detail=options?.detail;}},MutationObserver:class{constructor(fn){observers.push(fn);}observe(){}},$:id=>ids.get(id),api:async(path,body)=>{calls.push({path,body});const next=answers.shift();if(next instanceof Error)throw next;if(next===undefined)throw Error('No fixture response');return await next;},human,delay:async()=>{},reconcileSelectedRadio:radios=>radios[0]?.id||'',loadRadioInventory(){},rememberSelectedRadio:id=>selections.push(id),readSelectedRadio:()=>'',radioInventories:new Map(),listenerActionDialog:async(title,text)=>{dialogs.push({title,text});return true;},page(){ids.get('myRadio').hidden=false;},setTimeout(){return 1;},clearTimeout(){}};
 runInNewContext(busySource,ctx);runInNewContext(source,ctx);
 return {ctx,ids,form,calls,answers,dialogs,selections,document,get:expression=>runInNewContext(expression,ctx),submit:()=>form.onsubmit({preventDefault(){},target:form}),leave(){ids.get('myRadio').hidden=true;observers[0]();},returnToRadio(){ids.get('myRadio').hidden=false;},observe(){observers[0]();}};
}
test('radio pairing captures the code, freezes fields, and allows only one in-flight claim',async()=>{
 const bot=deferred(),f=fixture({human:()=>bot.promise});f.answers.push({claim_id:'claim',confirmation_code:'5831'},{state:'approved',radio_id:'one'},{radios:[]});const first=f.submit();await f.submit();assert.equal(f.form.elements.device_code.disabled,true);assert.equal(f.form.button.disabled,true);f.form.elements.device_code.value='9999';bot.resolve('checked');await first;
 assert.equal(f.calls.filter(call=>call.path==='/api/phone/claim').length,1);assert.equal(f.calls[0].body.device_code,'3961');assert.equal(f.calls[0].body.turnstile_token,'checked');assert.deepEqual(f.selections,['one']);assert.equal(f.dialogs.length,1);assert.equal(f.dialogs[0].title,'Radio connected');assert.equal(f.dialogs[0].text,'');assert.equal(f.ids.get('radioConnectStatus').textContent,'');assert.equal(f.form.button.disabled,false);assert.equal(f.form.elements.device_code.disabled,false);assert.equal(f.get('radioPairingBusy'),false);
});
test('leaving during a bot check stops the abandoned pairing before any claim is created',async()=>{
 const bot=deferred(),f=fixture({human:()=>bot.promise});const pairing=f.submit();f.leave();assert.equal(f.form.button.disabled,false);bot.resolve('checked');await pairing;assert.equal(f.calls.length,0);assert.equal(f.ids.get('myRadio').hidden,true);assert.equal(f.dialogs.length,0);assert.equal(f.form.resetCount,undefined);
});
test('a late physical approval cannot reopen Radio or show success after navigation away',async()=>{
 const check=deferred(),f=fixture();f.answers.push({claim_id:'claim',confirmation_code:'5831'},check.promise);const pairing=f.submit();await until(()=>f.calls.length===2);f.leave();const status=f.ids.get('radioConnectStatus').textContent;check.resolve({state:'approved',radio_id:'one'});await pairing;
 assert.equal(f.calls.filter(call=>call.path==='/api/phone/radios').length,0);assert.equal(f.ids.get('myRadio').hidden,true);assert.equal(f.ids.get('radioConnectStatus').textContent,status);assert.equal(f.selections.length,0);assert.equal(f.dialogs.length,0);assert.equal(f.form.resetCount,undefined);
});
test('an old pairing response cannot unlock or report errors on a newer pairing',async()=>{
 const old=deferred(),current=deferred(),f=fixture();f.answers.push(old.promise);const first=f.submit();await until(()=>f.calls.length===1);f.leave();f.returnToRadio();f.form.elements.device_code.value='7777';f.answers.push(current.promise);const second=f.submit();f.observe();await until(()=>f.calls.length===2);old.reject(Error('Old claim failed'));await first;
 assert.equal(f.form.button.disabled,true);assert.equal(f.form.elements.device_code.disabled,true);assert.equal(f.get('radioPairingBusy'),true);assert.doesNotMatch(f.ids.get('radioConnectStatus').textContent,/Old claim failed/);f.answers.push({state:'denied'});current.resolve({claim_id:'new-claim',confirmation_code:'2222'});await second;assert.equal(f.form.button.disabled,false);assert.equal(f.get('radioPairingBusy'),false);assert.match(f.ids.get('radioConnectStatus').textContent,/not approved/);
});
test('a pairing request failure preserves the code and restores controls for a retry',async()=>{
 const f=fixture();f.answers.push(Error('Temporary failure'));await f.submit();assert.equal(f.form.elements.device_code.value,'3961');assert.equal(f.form.resetCount,undefined);assert.equal(f.form.button.disabled,false);assert.match(f.ids.get('radioConnectStatus').textContent,/Temporary failure/);f.answers.push({claim_id:'retry',confirmation_code:'1234'},{state:'denied'});await f.submit();assert.equal(f.calls.filter(call=>call.path==='/api/phone/claim').length,2);
});
