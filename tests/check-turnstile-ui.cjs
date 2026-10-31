const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const template=fs.readFileSync(path.join(__dirname,'../templates/turnstile.html'),'utf8');
const script=template.match(/<script[^>]*>([\s\S]*?)<\/script>/)[1].replace('{{ turnstile_site_key()|tojson }}','"test-site"');
let submitHandler,checks=0,mode='success';
const actions=[];
function element(tag){return {tag,dataset:{},setAttribute(){},remove(){},appendChild(){}};}
const document={createElement:element,head:{appendChild(){throw Error('Unexpected network script');}},addEventListener(type,handler){assert.equal(type,'submit');submitHandler=handler;}};
const window={turnstile:{render(area,options){checks++;actions.push(options.action);const token='fresh-token-'+checks;queueMicrotask(()=>mode==='success'?options.callback(token):options['error-callback']());return checks;},remove(){}}};
vm.runInNewContext(script,{window,document,WeakSet,Promise,Error,setTimeout,clearTimeout});
function form(id,action){
 const children=[];
 const result={id,dataset:{},submissions:[],getAttribute(name){return name==='action'?action:null;},
 appendChild(child){children.push(child);},querySelector(selector){return children.find(c=>selector.includes('security-notice')?Object.hasOwn(c.dataset,'securityNotice'):c.name==='cf-turnstile-response');},
 requestSubmit(button){const event=eventFor(result,button);submitHandler(event);if(!event.blocked)result.submissions.push(result.querySelector('input[name="cf-turnstile-response"]')?.value);}};
 return result;
}
function eventFor(target,button={disabled:false}){return {target,submitter:button,blocked:false,preventDefault(){this.blocked=true;},stopImmediatePropagation(){}};}
(async()=>{
 const station=form('addStationForm');const first=eventFor(station);
 await submitHandler(first);
 assert.equal(first.blocked,true);assert.deepEqual(station.submissions,['fresh-token-1']);assert.equal(first.submitter.disabled,false);
 await submitHandler(eventFor(station));
 assert.deepEqual(station.submissions,['fresh-token-1','fresh-token-2']);assert.deepEqual(actions,['station-submit','station-submit']);
 const login=form('stationEditLoginForm');await submitHandler(eventFor(login));assert.equal(actions.at(-1),'station-access');assert.equal(login.submissions.length,1);
 const native=form('', '/api/add-station');await submitHandler(eventFor(native));assert.equal(native.submissions.length,1);
 const unrelated=form('volume');const unrelatedEvent=eventFor(unrelated);await submitHandler(unrelatedEvent);assert.equal(unrelatedEvent.blocked,false);
 mode='error';const retry=eventFor(station);await submitHandler(retry);assert.equal(station.submissions.length,2);assert.equal(retry.submitter.disabled,false);assert.match(station.querySelector('[data-security-notice]').textContent,/try again/);
 mode='success';await submitHandler(eventFor(station));assert.equal(station.submissions.length,3);
 console.log('PASS: fresh single-use token per submission; one submit per pass; native and AJAX forms; email action binding; error unlocks retry; unrelated controls unaffected. No Cloudflare or mail requests.');
})().catch(error=>{console.error(error);process.exitCode=1;});
