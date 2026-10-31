const fs=require('fs'),vm=require('vm'),assert=require('assert');
const nodes={};function node(id){return nodes[id]||(nodes[id]={id,value:'',textContent:'',hidden:false,disabled:false,open:false,listeners:{},children:[],dataset:{},selectionStart:null,setSelectionRange(a,b){this.selectionStart=a;this.selectionEnd=b},showModal(){this.open=true},close(){this.open=false;this.listeners.close?.()},focus(){},addEventListener(event,fn){this.listeners[event]=fn},replaceChildren(){this.children=[];this.value=''},appendChild(option){this.children.push(option);if(!this.value)this.value=option.value},querySelector(){return node('pairButton')}})}
node('radioCsrf').value='test-csrf';const calls=[],timers=[];let approved=false,added=false,linked=false,hasClaim=false;
const windowEvents={};const context={window:{addEventListener:(event,fn)=>windowEvents[event]=fn},publicCode:'11',document:{getElementById:node,querySelector:()=>node('pairButton'),createElement:()=>({value:'',textContent:''})},setTimeout:fn=>(timers.push(fn),timers.length),clearTimeout(){},fetch:async(path,options)=>{
 const data=options?.body?JSON.parse(options.body):undefined;calls.push({path,data});
 let result={};
 if(path==='/api/radio/linked')result={radios:linked?[{radio_id:'radio-1',name:'My radio',online:true}]:[]};
 if(path==='/api/radio/link/claim'){hasClaim=true;result={status:'waiting',confirmation_code:'1234'};}
 if(path==='/api/radio/link/status'){result=!hasClaim?{status:'expired'}:approved?{status:'approved',radio_id:'radio-1'}:{status:'waiting',confirmation_code:'1234'};if(approved)linked=true;}
 if(path==='/api/radio/add-station')result={command_id:'command-1'};
 if(path==='/api/radio/commands/command-1')result={status:added?'added':'pending'};
 return {ok:true,json:async()=>result};
}};
vm.createContext(context);vm.runInContext(fs.readFileSync(__dirname+'/../static/radio-add.js','utf8'),context);
const settle=()=>new Promise(resolve=>setImmediate(resolve));
(async()=>{
 await settle();assert(!node('radioAddDialog').open,'the adding form is a page, not a popup');assert(!node('radioPairPanel').hidden);assert(!calls.some(x=>x.path==='/api/radio/add-station'));
 assert.equal(context.formatRadioCode('2j4q tjeg'),'2J4Q-TJEG');assert.equal(context.formatRadioCode('ABCD-EFGH'),'ABCD-EFGH');
 const codeInput=node('radioPairCode');codeInput.value='abcd';codeInput.selectionStart=4;codeInput.listeners.input({target:codeInput,inputType:'insertText'});assert.equal(codeInput.value,'ABCD-');
 codeInput.value='ABCD';codeInput.selectionStart=4;codeInput.listeners.input({target:codeInput,inputType:'deleteContentBackward'});assert.equal(codeInput.value,'ABC','backspace crosses the inserted dash without trapping the caret');
 node('radioPairCode').value='ABCD-2345';await node('radioPairForm').listeners.submit({preventDefault(){},target:node('radioPairForm')});
 assert.equal(node('radioApprovalCheck').textContent,'1234');assert(node('radioAddMessage').textContent.includes('Allow phone'));assert(!calls.some(x=>x.path==='/api/radio/add-station'));
 await timers.shift()();await settle();assert(!calls.some(x=>x.path==='/api/radio/add-station'),'no station command before physical approval');
 approved=true;await timers.shift()();await settle();assert.equal(calls.filter(x=>x.path==='/api/radio/add-station').length,1);
 assert.equal(calls.find(x=>x.path==='/api/radio/add-station').data.owner_csrf,'test-csrf');assert(!node('radioAddMessage').textContent.includes('successfully'));assert(node('stationSponsor').hidden,'no sponsor before device acknowledgement');assert(node('radioYes').hidden&&node('radioChoiceRow').hidden&&node('radioPairPanel').hidden,'approval goes straight to save confirmation without another form');
 added=true;await timers.shift()();await settle();assert(node('radioAddMessage').textContent.includes('added successfully'));
 assert(node('radioYes').hidden,'no redundant Add again after success');assert.equal(node('radioNo').textContent,'Done');assert(!node('stationSponsor').hidden,'demo appears after saved acknowledgement');
 await context.openRadioAdd();await settle();assert(node('stationSponsor').hidden,'restart hides sponsor');const before=calls.filter(x=>x.path==='/api/radio/add-station').length;assert(!node('radioYes').hidden);assert.equal(calls.filter(x=>x.path==='/api/radio/add-station').length,before,'an already linked page never adds on load');
 await node('radioYes').listeners.click();await node('radioYes').listeners.click();assert.equal(calls.filter(x=>x.path==='/api/radio/add-station').length,before+1,'double click queues once');
 windowEvents.pagehide();
 linked=false;hasClaim=true;approved=false;await context.openRadioAdd();await settle();const beforeResume=calls.filter(x=>x.path==='/api/radio/add-station').length;
 approved=true;let budget=10;while(timers.length&&budget--){await timers.shift()();await settle();}
 assert.equal(calls.filter(x=>x.path==='/api/radio/add-station').length,beforeResume,'returning to a pending approval does not imply Add consent');assert(!node('radioYes').hidden);
 linked=false;hasClaim=true;approved=false;await context.openRadioAdd();await settle();windowEvents.pagehide();approved=true;budget=10;while(timers.length&&budget--){await timers.shift()();await settle();}
 assert.equal(calls.filter(x=>x.path==='/api/radio/add-station').length,beforeResume,'leaving the page prevents later approval from auto-adding');

 console.log('PASS: single-page adding, explicit Add consent, physical approval before commands, CSRF, and success only after radio save acknowledgement.');
})().catch(error=>{console.error(error);process.exitCode=1});
