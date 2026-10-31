"use strict";
const radioMessage=document.getElementById('radioAddMessage'),radioChoice=document.getElementById('radioChoice'),radioCsrf=document.getElementById('radioCsrf').value;
let radioTargets=[],radioPollTimer=null,radioPairTimer=null,radioCheckGeneration=0,radioAddActive=true,radioSending=false,radioClaimBusy=false;
function radioNotice(text,state=''){radioMessage.textContent=text;radioMessage.dataset.state=state;}
function stopRadioChecks(){if(radioPollTimer)clearTimeout(radioPollTimer);if(radioPairTimer)clearTimeout(radioPairTimer);radioPairTimer=null;radioPollTimer=null;++radioCheckGeneration;}
function showRadioPairing(){document.getElementById('radioPairPanel').hidden=false;document.getElementById('radioYes').hidden=true;document.getElementById('radioChoiceRow').hidden=true;document.getElementById('linkAnotherRadio').hidden=true;document.getElementById('radioApprovalCheck').hidden=true;document.querySelector('#radioPairForm button').disabled=false;}
async function radioApi(path,data){
 const response=await fetch(path,data===undefined?{cache:'no-store'}:{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({...data,owner_csrf:radioCsrf})});
 let result;try{result=await response.json();}catch(error){throw new Error('Please refresh and try again.');}
 if(!response.ok){const error=new Error(result.message||'Please try again.');error.status=response.status;throw error;}return result;
}
async function loadLinkedRadios(showControls=true){
 const result=await radioApi('/api/radio/linked');radioTargets=result.radios||[];radioChoice.replaceChildren();
 for(const radio of radioTargets){const option=document.createElement('option');option.value=radio.radio_id;option.textContent=radio.name+(radio.online?' · Online':' · Offline');radioChoice.appendChild(option);}
 document.getElementById('radioChoiceRow').hidden=!showControls||!radioTargets.length;document.getElementById('radioPairPanel').hidden=!showControls||!!radioTargets.length;document.getElementById('radioYes').hidden=!showControls||!radioTargets.length;document.getElementById('linkAnotherRadio').hidden=!showControls||!radioTargets.length;
 return radioTargets;
}
async function openRadioAdd(){
 stopRadioChecks();radioAddActive=true;radioSending=false;radioClaimBusy=false;const generation=radioCheckGeneration;
 document.getElementById('radioYes').disabled=false;document.getElementById('radioYes').textContent='Add station';radioChoice.disabled=false;document.getElementById('radioApprovalCheck').hidden=true;document.getElementById('radioNo').textContent='Back to stations';document.getElementById('stationSponsor').hidden=true;radioNotice('');
 try{
  await loadLinkedRadios();if(!radioAddActive||generation!==radioCheckGeneration)return;
  if(!radioTargets.length){const pending=await radioApi('/api/radio/link/status');if(!radioAddActive||generation!==radioCheckGeneration)return;
   if(pending.status==='approved'){await loadLinkedRadios();radioChoice.value=pending.radio_id;}
   else if(pending.status==='waiting'){watchRadioApproval(pending.confirmation_code,false);}
  }
 }catch(error){if(radioAddActive&&generation===radioCheckGeneration){radioNotice(error.message,'error');showRadioPairing();}}
}
function watchRadioApproval(checkCode,wantAdd){
 const generation=++radioCheckGeneration;let checks=0;const expiresAt=Date.now()+130000;
 document.getElementById('radioPairPanel').hidden=true;document.getElementById('radioYes').hidden=true;document.getElementById('linkAnotherRadio').hidden=true;
 const checkNumber=document.getElementById('radioApprovalCheck');checkNumber.textContent=checkCode;checkNumber.hidden=false;radioNotice('Match this number and tap Allow phone on your radio.');
 const check=async()=>{
  if(!radioAddActive||generation!==radioCheckGeneration)return;
  try{
   const result=await radioApi('/api/radio/link/status');if(!radioAddActive||generation!==radioCheckGeneration)return;
   if(result.status==='approved'){
    await loadLinkedRadios(!wantAdd);if(!radioAddActive||generation!==radioCheckGeneration)return;radioChoice.value=result.radio_id;checkNumber.hidden=true;radioClaimBusy=false;
    if(wantAdd)await sendToRadio();else radioNotice('Radio connected. Tap Add station.');return;
   }
   if(result.status!=='waiting'||++checks>=65){radioClaimBusy=false;showRadioPairing();radioNotice(result.message||'Request expired. Enter your radio code again.','error');return;}
   radioPairTimer=setTimeout(check,2000);
  }catch(error){
   if(!radioAddActive||generation!==radioCheckGeneration)return;
   if(Date.now()<expiresAt){radioNotice('Connection interrupted. Retrying…');radioPairTimer=setTimeout(check,2000);}
   else{radioClaimBusy=false;showRadioPairing();radioNotice(error.message,'error');}
  }
 };radioPairTimer=setTimeout(check,1500);
}
async function sendToRadio(){
 if(radioSending)return;
 if(!radioChoice.value){showRadioPairing();return;}
 radioSending=true;const button=document.getElementById('radioYes'),generation=++radioCheckGeneration;button.disabled=true;button.hidden=true;radioChoice.disabled=true;document.getElementById('radioChoiceRow').hidden=true;document.getElementById('radioPairPanel').hidden=true;document.getElementById('radioApprovalCheck').hidden=true;document.getElementById('linkAnotherRadio').hidden=true;radioNotice('Finishing…');
 try{
  const result=await radioApi('/api/radio/add-station',{code:publicCode,radio_id:radioChoice.value});if(!radioAddActive||generation!==radioCheckGeneration)return;
  let checks=0;if(radioPollTimer)clearTimeout(radioPollTimer);
  const check=async()=>{if(!radioAddActive||generation!==radioCheckGeneration)return;try{
   const state=await radioApi('/api/radio/commands/'+encodeURIComponent(result.command_id));if(!radioAddActive||generation!==radioCheckGeneration)return;
   if(state.status==='added'){radioNotice('Station added successfully!','success');button.hidden=true;document.getElementById('radioChoiceRow').hidden=true;document.getElementById('radioNo').textContent='Done';document.getElementById('stationSponsor').hidden=false;return;}
   if(['failed','expired'].includes(state.status)){radioNotice(state.message||'Could not add the station. Try again.','error');radioSending=false;button.disabled=false;button.hidden=false;radioChoice.disabled=false;document.getElementById('radioChoiceRow').hidden=!radioTargets.length;document.getElementById('linkAnotherRadio').hidden=false;return;}
   if(++checks>=100){radioNotice('Turn on your radio, check Wi-Fi and try again.','error');radioSending=false;button.disabled=false;button.hidden=false;radioChoice.disabled=false;document.getElementById('radioChoiceRow').hidden=!radioTargets.length;return;}
   radioPollTimer=setTimeout(check,3000);
  }catch(error){if(!radioAddActive||generation!==radioCheckGeneration)return;radioNotice(error.message,'error');radioSending=false;button.disabled=false;button.hidden=false;radioChoice.disabled=false;document.getElementById('radioChoiceRow').hidden=!radioTargets.length;}};
  radioPollTimer=setTimeout(check,1500);
 }catch(error){if(!radioAddActive||generation!==radioCheckGeneration)return;radioNotice(error.message,'error');radioSending=false;button.disabled=false;button.hidden=false;radioChoice.disabled=false;document.getElementById('radioChoiceRow').hidden=!radioTargets.length;if(error.status===403)showRadioPairing();else document.getElementById('linkAnotherRadio').hidden=false;}
}
document.getElementById('radioYes').addEventListener('click',sendToRadio);
document.getElementById('linkAnotherRadio').addEventListener('click',()=>{if(radioSending)return;stopRadioChecks();radioClaimBusy=false;showRadioPairing();radioNotice('');document.getElementById('radioPairCode').focus();});
function formatRadioCode(value){const code=String(value).toUpperCase().replace(/[^A-Z0-9]/g,'').slice(0,8);return code.length>=4?code.slice(0,4)+'-'+code.slice(4):code;}
let previousRadioCode='';
document.getElementById('radioPairCode').addEventListener('input',event=>{
 const field=event.target;let value=field.value,caret=field.selectionStart??value.length;
 if(event.inputType==='deleteContentBackward'&&previousRadioCode[4]==='-'&&caret===4&&value[4]!=='-'){value=value.slice(0,3)+value.slice(4);caret=3;}
 const count=value.slice(0,caret).replace(/[^a-z0-9]/gi,'').length;
 field.value=formatRadioCode(value);previousRadioCode=field.value;
 const next=Math.min(field.value.length,count+(count>=4?1:0));field.setSelectionRange(next,next);
});
document.getElementById('radioPairForm').addEventListener('submit',async event=>{
 event.preventDefault();if(radioClaimBusy||radioSending)return;radioClaimBusy=true;const generation=++radioCheckGeneration,button=event.target.querySelector('button');button.disabled=true;radioNotice('Connecting to your radio…');
 try{const result=await radioApi('/api/radio/link/claim',{pair_code:document.getElementById('radioPairCode').value.trim()});if(!radioAddActive||generation!==radioCheckGeneration)return;if(result.status==='waiting')watchRadioApproval(result.confirmation_code,true);else throw new Error('Please enter your radio code again.');}catch(error){if(!radioAddActive||generation!==radioCheckGeneration)return;radioNotice(error.message,'error');radioClaimBusy=false;button.disabled=false;}
});
document.getElementById('radioNo').addEventListener('click',()=>{radioAddActive=false;stopRadioChecks();});
window.addEventListener('pagehide',()=>{radioAddActive=false;stopRadioChecks();});
window.addEventListener('pageshow',event=>{if(event.persisted)openRadioAdd();});
openRadioAdd();
