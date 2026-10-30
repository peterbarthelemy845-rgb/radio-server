'use strict';
const radioDialog=document.getElementById('radioAddDialog'),radioMessage=document.getElementById('radioAddMessage'),radioChoice=document.getElementById('radioChoice'),radioCsrf=document.getElementById('radioCsrf').value;
let radioTargets=[],radioPollTimer=null,radioPairTimer=null,radioWantsAdd=false,radioCheckGeneration=0;
async function radioApi(path,data){
 const response=await fetch(path,data===undefined?{cache:'no-store'}:{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({...data,owner_csrf:radioCsrf})});
 let result;try{result=await response.json();}catch(error){throw new Error('Could not complete the request. Refresh the page and try again.');}
 if(!response.ok)throw new Error(result.message||'Connect this phone to your radio and try again.');return result;
}
async function loadLinkedRadios(){
 const result=await radioApi('/api/radio/linked');radioTargets=result.radios||[];radioChoice.replaceChildren();
 for(const radio of radioTargets){const option=document.createElement('option');option.value=radio.radio_id;option.textContent=radio.name+(radio.online?' · Online':' · Offline');radioChoice.appendChild(option);}
 document.getElementById('radioChoiceRow').hidden=!radioTargets.length;
 document.getElementById('radioPairPanel').hidden=!!radioTargets.length;
 document.getElementById('radioYes').hidden=!radioTargets.length;
 return radioTargets;
}
async function openRadioAdd(){
 radioWantsAdd=false;++radioCheckGeneration;document.getElementById('radioNo').textContent='Not now';document.querySelector('#radioPairForm button').disabled=false;document.getElementById('radioYes').disabled=false;document.getElementById('radioYes').textContent='Yes, add station';radioMessage.textContent='';document.getElementById('radioPairPanel').hidden=true;
 if(!radioDialog.open)radioDialog.showModal();
 try{
  await loadLinkedRadios();
  if(!radioTargets.length){const pending=await radioApi('/api/radio/link/status');
   if(pending.status==='approved'){await loadLinkedRadios();radioChoice.value=pending.radio_id;radioMessage.textContent='Phone approved. Choose Yes to add this station.';}
   else if(pending.status==='waiting'){document.querySelector('#radioPairForm button').disabled=true;watchRadioApproval(pending.confirmation_code,false);}
  }
 }catch(error){radioMessage.textContent=error.message;document.getElementById('radioPairPanel').hidden=false;}
}
function watchRadioApproval(checkCode,wantAdd){
 const generation=++radioCheckGeneration;let checks=0;const expiresAt=Date.now()+130000;
 radioMessage.textContent='On your radio, match '+checkCode+' and tap Allow phone. No connection is granted until you approve there.';
 const check=async()=>{
  if(!radioDialog.open||generation!==radioCheckGeneration)return;
  try{
   const result=await radioApi('/api/radio/link/status');
   if(!radioDialog.open||generation!==radioCheckGeneration)return;
   if(result.status==='approved'){
    await loadLinkedRadios();if(!radioDialog.open||generation!==radioCheckGeneration)return;radioChoice.value=result.radio_id;radioMessage.textContent='Phone approved on the radio.';
    if(wantAdd)await sendToRadio();return;
   }
   if(result.status!=='waiting'||++checks>=65){document.querySelector('#radioPairForm button').disabled=false;radioMessage.textContent=result.message||'Approval timed out. Open Link phone on your radio and try again.';return;}
   radioPairTimer=setTimeout(check,2000);
  }catch(error){
   if(!radioDialog.open||generation!==radioCheckGeneration)return;
   if(Date.now()<expiresAt){radioMessage.textContent='Connection interrupted. Still waiting for approval on your radio…';radioPairTimer=setTimeout(check,2000);}
   else{document.querySelector('#radioPairForm button').disabled=false;radioMessage.textContent=error.message;}
  }
 };
 radioPairTimer=setTimeout(check,1500);
}
async function sendToRadio(){
 radioWantsAdd=true;const button=document.getElementById('radioYes');button.disabled=true;
 if(!radioChoice.value){document.getElementById('radioPairPanel').hidden=false;button.disabled=false;return;}
 radioMessage.textContent='Sending to your radio. Keep it on and connected to Wi-Fi…';
 document.getElementById('radioNo').textContent='Close';
 try{
  const result=await radioApi('/api/radio/add-station',{code:publicCode,radio_id:radioChoice.value});
  let checks=0;const generation=++radioCheckGeneration;if(radioPollTimer)clearTimeout(radioPollTimer);
  const check=async()=>{if(!radioDialog.open||generation!==radioCheckGeneration)return;try{const state=await radioApi('/api/radio/commands/'+encodeURIComponent(result.command_id));
   if(state.status==='added'){radioMessage.textContent='Station added successfully to your radio!';button.disabled=false;button.textContent='Add again';return;}
   if(['failed','expired'].includes(state.status)){radioMessage.textContent=state.message;button.disabled=false;return;}
   if(++checks>=100){radioMessage.textContent='Your radio has not confirmed yet. Turn it on and check its Wi-Fi. You can try again.';button.disabled=false;return;}
   radioPollTimer=setTimeout(check,3000);
  }catch(error){radioMessage.textContent=error.message;button.disabled=false;}};
  radioPollTimer=setTimeout(check,1500);
 }catch(error){radioMessage.textContent=error.message;button.disabled=false;}
}
document.getElementById('radioYes').addEventListener('click',sendToRadio);
document.getElementById('openRadioAdd').addEventListener('click',openRadioAdd);
document.getElementById('radioNo').addEventListener('click',()=>radioDialog.close());
document.getElementById('linkAnotherRadio').addEventListener('click',()=>{document.getElementById('radioPairPanel').hidden=false;document.getElementById('radioPairCode').focus();});
document.getElementById('radioPairForm').addEventListener('submit',async event=>{
 event.preventDefault();const button=event.target.querySelector('button');button.disabled=true;radioMessage.textContent='Connecting your phone…';
 try{const result=await radioApi('/api/radio/link/claim',{pair_code:document.getElementById('radioPairCode').value.trim()});if(result.status==='waiting')watchRadioApproval(result.confirmation_code,true);else throw new Error('Could not start approval. Open Link phone on your radio and try again.');}catch(error){radioMessage.textContent=error.message;button.disabled=false;}
});
radioDialog.addEventListener('close',()=>{if(radioPollTimer)clearTimeout(radioPollTimer);if(radioPairTimer)clearTimeout(radioPairTimer);radioPairTimer=null;radioPollTimer=null;++radioCheckGeneration;});
openRadioAdd();
