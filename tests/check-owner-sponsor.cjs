const fs=require('fs'),vm=require('vm'),assert=require('assert');
const html=fs.readFileSync(__dirname+'/../templates/submission_success.html','utf8');
const source=html.split('<script nonce="{{ csp_nonce() }}">')[1].split('{% if edit_verification_info')[0];
const nodes={};const get=id=>nodes[id]??=( {hidden:false,textContent:'',value:'',disabled:false,open:false,listeners:{},addEventListener(e,f){this.listeners[e]=f},querySelector(){return get('submitButton')},focus(){},showModal(){this.open=true}} );
let response={};const context={document:{getElementById:get,querySelector:()=>get('submitButton')},window:{location:{assign(){}}},setInterval:()=>1,clearInterval(){},FormData:class{},fetch:async()=>({ok:response.ok!==false,json:async()=>response})};
vm.createContext(context);vm.runInContext(source,context);
(async()=>{
 async function verify(data,mode='registration'){response=data;context.showSubmissionSuccess({mode,resend_after:0});assert(get('registrationSponsor').hidden);await get('verifyRegistrationForm').listeners.submit({preventDefault(){},target:get('verifyRegistrationForm')});}
 await verify({status:'ok',published:true,listener_code:'12'});assert(!get('registrationSponsor').hidden,'published new station shows sponsor');
 await verify({status:'ok',published:false,message:'Pending review'});assert(get('registrationSponsor').hidden,'moderation pending has no sponsor');
 await verify({status:'error',ok:false});assert(get('registrationSponsor').hidden,'invalid verification has no sponsor');
 await verify({status:'ok',edit_verified:true},'edit');assert(get('registrationSponsor').hidden,'editor login has no sponsor');
 console.log('PASS: owner sponsor only after verified publication; no sponsor for invalid codes, pending review or editor login.');
})().catch(e=>{console.error(e);process.exitCode=1});
