import {test} from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';

const source=readFileSync(new URL('./public/assets/site.js',import.meta.url),'utf8');
const between=(start,end)=>source.slice(source.indexOf(start),source.indexOf(end));
function deferred(){let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return {promise,resolve,reject};}
async function settle(){for(let i=0;i<8;i++)await new Promise(resolve=>setImmediate(resolve));}
function fixture({sdkReady=true}={}){
 const nodes=new Map(),widgets=[],removed=[],scripts=[],calls=[],verified=[],answers=[],timers=new Map();let clock=0,focused;
 function node(id,tagName='DIV'){
  const value={id,tagName,dataset:{},attrs:{},disabled:false,hidden:true,open:false,textContent:'',value:'',type:tagName==='BUTTON'?'submit':'text',elements:{},fields:[],buttons:[],
   focus(){focused=this;},getAttribute(key){return Object.hasOwn(this.attrs,key)?this.attrs[key]:null;},setAttribute(key,val){this.attrs[key]=val;},removeAttribute(key){delete this.attrs[key];},
   querySelectorAll(selector){return selector.includes('input')?[...this.fields,...this.buttons]:this.buttons;},querySelector(selector){return selector==='.human'?this.area:this.buttons[0];},
   replaceChildren(){this.emptied=true;},dispatchEvent(){},remove(){this.removed=true;},
  };nodes.set(id,value);return value;
 }
 const get=id=>nodes.get(id)||node(id);
 for(const id of ['message','registerMessage','loginMessage','login','register','verification','deleteVerification'])get(id);get('login').hidden=false;
 for(const id of ['loginForm','registerForm']){const form=node(id,'FORM');form.hidden=false;form.area=node(id+'Human');const submit=node(id+'Submit','BUTTON');submit.textContent=id==='loginForm'?'Log in to edit station':'Save Station';form.buttons=[submit];for(const [name,value] of Object.entries(id==='loginForm'?{email:'owner@example.com',code:'13'}:{name:'Test station',email:'owner@example.com',stream_url:'https://example.com/live',bio:'My programme'})){const field=node(id+name,'INPUT');field.value=value;form.elements[name]=field;form.fields.push(field);}form.elements.rights_confirmed={checked:true};form.elements.artwork={files:[{name:'logo.png',size:10}],validationMessage:''};}
 const registrationHuman=get('registrationHuman');registrationHuman.area=node('registrationHumanArea');
 const sdk={render(area,options){const widget={id:'widget-'+(widgets.length+1),area,options};widgets.push(widget);return widget.id;},remove(id){removed.push(id);}};
 const document={hidden:false,getElementById:get,createElement(tag){return node('element-'+nodes.size,tag.toUpperCase());},head:{append(script){scripts.push(script);}}};
 const window={appI18n:{t:key=>key}};if(sdkReady)window.turnstile=sdk;
 const context=vm.createContext({document,window,$:get,state:{csrf:'fixture-csrf',agreement_version:'fixture-terms',turnstile_site_key:'fixture-site-key'},verificationId:null,humanLoading:undefined,sitePageGeneration:1,AbortController,Promise,Event:class{},TextEncoder,Uint8Array,
  setTimeout(fn,ms){const id=++clock;timers.set(id,{fn,ms});return id;},clearTimeout(id){timers.delete(id);},
  FormData:class{constructor(form){this.entries=Object.entries(form.elements).filter(([,field])=>typeof field.value==='string'&&!field.disabled).map(([key,field])=>[key,field.value]);}*[Symbol.iterator](){yield* this.entries;}},
  ensureOwnerSession:async()=>{},fileData:async file=>({name:file.name,base64:'fixture'}),registrationRequest:async(data,current)=>current()?'fixture-request':'',
  api:async(path,body)=>{calls.push({path,body});const answer=answers.shift();if(answer instanceof Error)throw answer;return answer===undefined?{verification_id:'fixture-verification'}:await answer;},verify:result=>verified.push(result),
 });
 vm.runInContext(between('const formBusyStates=','function loadHuman()'),context);
 vm.runInContext(between('function loadHuman()','async function fileData('),context);
 vm.runInContext(between('let verificationGeneration=','function renderVerificationResend('),context);
 vm.runInContext(between('function registrationMessage(','function loadOwnerSession('),context);
 vm.runInContext(between('function page(','async function api('),context);
 vm.runInContext(between("$('registerForm').onsubmit=async event=>", "$('verifyForm').onsubmit=async event=>"),context);
 const submit=id=>get(id).onsubmit({target:get(id),preventDefault(){}});
 return {get,nodes,widgets,removed,scripts,calls,verified,answers,context,sdk,timers,focused:()=>focused,submit,page:id=>context.page(id),busy:id=>context.formIsBusy(get(id)),loadSdk(){window.turnstile=sdk;scripts[0].onload();}};
}

test('leaving sign-in promptly unlocks its fields and removes only its security widget',async()=>{
 const f=fixture(),pending=f.submit('loginForm');await settle();assert.equal(f.widgets.length,1);assert.equal(f.busy('loginForm'),true);
 f.page('support');assert.equal(f.busy('loginForm'),false);assert.equal(f.get('loginForm').elements.email.disabled,false);assert.deepEqual(f.removed,['widget-1']);
 f.widgets[0].options.callback('late-token');await pending;assert.equal(f.calls.length,0);assert.equal(f.verified.length,0);assert.equal(f.timers.size,0);
});
test('an abandoned attempt cannot unlock a new attempt on the same form',async()=>{
 const f=fixture(),old=f.submit('loginForm');await settle();f.page('support');f.page('login');const fresh=f.submit('loginForm');await settle();await old;
 assert.equal(f.widgets.length,2);assert.equal(f.busy('loginForm'),true);assert.equal(f.get('loginForm').buttons[0].disabled,true);f.widgets[0].options.callback('stale-token');await settle();assert.equal(f.calls.length,0);
 f.widgets[1].options.callback('fresh-token');await fresh;assert.equal(f.calls.length,1);assert.equal(f.calls[0].body.turnstile_token,'fresh-token');assert.equal(f.verified.length,1);assert.equal(f.busy('loginForm'),false);
});
test('leaving registration during shared SDK loading keeps that load usable by a fresh sign-in',async()=>{
 const f=fixture({sdkReady:false}),old=f.submit('registerForm');await settle();assert.equal(f.scripts.length,1);assert.equal(f.busy('registerForm'),true);
 f.page('login');const fresh=f.submit('loginForm');await settle();assert.equal(f.busy('registerForm'),false);assert.equal(f.busy('loginForm'),true);assert.equal(f.scripts.length,1);await old;
 f.loadSdk();await settle();assert.equal(f.widgets.length,1);assert.equal(f.widgets[0].area.id,'loginFormHuman');f.widgets[0].options.callback('new-token');await fresh;
 assert.equal(f.calls.length,1);assert.equal(f.calls[0].path,'/api/owner/login');assert.equal(f.get('registerForm').elements.name.value,'Test station');
});
test('an already-sent request may finish after navigation without opening verification or clearing a newer busy state',async()=>{
 const f=fixture(),response=deferred();f.answers.push(response.promise);const old=f.submit('loginForm');await settle();f.widgets[0].options.callback('first-token');await settle();assert.equal(f.calls.length,1);
 f.page('support');f.page('login');const fresh=f.submit('loginForm');await settle();assert.equal(f.busy('loginForm'),true);response.resolve({verification_id:'stale-response'});await old;
 assert.equal(f.verified.length,0);assert.equal(f.busy('loginForm'),true);f.widgets[1].options.callback('second-token');await fresh;assert.equal(f.verified.length,1);assert.notEqual(f.verified[0].verification_id,'stale-response');
});
test('sign-in errors appear in and focus the inline login notice, then clear for a fresh attempt',async()=>{
 const f=fixture(),old=f.submit('loginForm');await settle();f.widgets[0].options['error-callback']('600010');await old;
 assert.match(f.get('loginMessage').textContent,/Security check could not complete/);assert.equal(f.focused(),f.get('loginMessage'));assert.equal(f.get('message').textContent,'');assert.equal(f.busy('loginForm'),false);
 const fresh=f.submit('loginForm');assert.equal(f.get('loginMessage').textContent,'');await settle();f.widgets[1].options.callback('fresh-token');await fresh;
});
test('returning to registration does not let an older artwork check unlock the new form submission',async()=>{
 const f=fixture(),artwork=deferred();let checks=0;f.context.window.validateRegistrationLogo=()=>++checks===1?artwork.promise:Promise.resolve(true);
 f.page('register');const old=f.submit('registerForm');await settle();f.page('login');assert.equal(f.busy('registerForm'),false);f.page('register');const fresh=f.submit('registerForm');await settle();assert.equal(f.widgets.length,1);assert.equal(f.busy('registerForm'),true);
 artwork.resolve(true);await old;assert.equal(f.busy('registerForm'),true);assert.equal(f.calls.length,0);f.widgets[0].options.callback('registered-token');await fresh;
 assert.equal(f.calls.length,1);assert.equal(f.calls[0].path,'/api/owner/register');assert.equal(f.verified.length,1);
});
test('ordinary verification success still requires a completed security token and suppresses duplicate submits',async()=>{
 const f=fixture(),pending=f.submit('loginForm');await settle();await f.submit('loginForm');assert.equal(f.widgets.length,1);assert.equal(f.calls.length,0);f.widgets[0].options.callback('valid-token');await pending;
 assert.equal(f.calls.length,1);assert.equal(f.calls[0].body.turnstile_token,'valid-token');assert.equal(f.verified.length,1);assert.equal(f.busy('loginForm'),false);
});
