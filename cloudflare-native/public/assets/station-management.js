'use strict';
// A removal is a radio command, never a directory deletion or an optimistic
// change to the saved list. Keep its receipt when the sheet closes or a reply
// is lost so a later check cannot enqueue a second removal.
const stationRemovalRequests=new Map();
let stationRemovalAuthorization=null,stationRemovalAuthorizationCancellation=Promise.resolve(),stationRemovalStatusQueue=Promise.resolve(),stationRemovalStateSignature='';
window.stationManagementBusy=false;
const stationManagementFallback={
 'management.saved':'On your radio',
 'management.remove':'Remove from this radio',
 'management.confirmTitle':'Remove from this radio?',
 'management.confirm':'Remove station',
 'management.confirmText':'{name} will be removed from Device Code {code}. You can add it again later.',
 'management.updateNeeded':'Update your radio software to remove stations here.',
 'management.download':'Download radio software',
 'management.offline':'Keep the radio on and connected to Wi-Fi to remove a station.',
 'management.stale':'Refresh the saved list before removing a station.',
 'management.permission':'The radio will ask you to approve phone controls once.',
 'management.waitApproval':'Match {number} and tap Allow on your radio to approve phone controls.',
 'management.cancelled':'Removal cancelled. Nothing was removed.',
 'management.removing':'Removing station…',
 'management.checking':'Checking removal…',
 'management.check':'Check removal',
 'management.unconfirmed':'Removal has not been confirmed. Check its status before trying again.',
 'management.failed':'The station could not be removed. Check your radio and try again.',
 'management.checkFailed':'Removal could not be checked. Refresh the saved list before starting again.',
 'management.confirmed':'The radio confirmed removal. Refresh the saved list to continue.',
 'management.savedAgain':'This station is on the radio’s latest saved list. Check the radio before removing it again.',
 'management.refresh':'Refresh saved list',
 'management.removed':'✓ Removed from Device Code {code}',
 'management.changed':'The selected radio or station changed. Start again.'
};
function stationManagementText(key,params={}){
 let text=window.appI18n?.t(key,params);if(!text||text===key)text=stationManagementFallback[key]||key;
 for(const [name,value] of Object.entries(params))text=text.replaceAll('{'+name+'}',String(value));return text;
}
const stationManagementPanel=document.createElement('div');stationManagementPanel.id='stationManagement';stationManagementPanel.className='station-management';stationManagementPanel.hidden=true;
const stationRemovalButton=document.createElement('button');stationRemovalButton.type='button';stationRemovalButton.id='removeSavedStation';stationRemovalButton.className='secondary station-remove';
const stationRemovalHelp=document.createElement('p');stationRemovalHelp.className='small station-removal-help';stationRemovalHelp.setAttribute('role','status');
const stationRemovalDownload=document.createElement('a');stationRemovalDownload.className='station-removal-download';stationRemovalDownload.href='/assets/waveshare-radio.zip';stationRemovalDownload.setAttribute('download','waveshare-radio.zip');stationRemovalDownload.hidden=true;
stationManagementPanel.append(stationRemovalButton,stationRemovalHelp,stationRemovalDownload);$('shareStatus').before(stationManagementPanel);
const stationRemovalKey=(id,code)=>String(id)+'|'+String(code);
function stationManagementContext(){
 const radioId=String($('shareForm').elements.radio_id.value||''),code=String(sharedCode||'');
 return {radioId,code,generation:sharedOpenGeneration,name:$('shareName').textContent,deviceCode:String(sharedLinkedRadios.find(r=>String(r.id)===radioId)?.device_code||'—')};
}
function currentStationManagement(context){
 return context.generation===sharedOpenGeneration&&!$('shared').hidden&&!document.hidden&&String(sharedCode)===context.code&&String($('shareForm').elements.radio_id.value)===context.radioId;
}
function saveStationRemovalReferences(){
 try{const references=[...stationRemovalRequests.values()].map(({radioId,code,name,deviceCode,requestId,commandId,deadline,state})=>({radioId,code,name,deviceCode,requestId,commandId,deadline,state})).slice(-20);sessionStorage.setItem('stationRemovalReceipts',JSON.stringify(references));}catch{}
}
try{
 const references=JSON.parse(sessionStorage.getItem('stationRemovalReceipts')||'[]');
 if(Array.isArray(references))for(const entry of references.slice(-20)){
  if(!entry||!/^[a-f0-9]{32}$/.test(entry.radioId||'')||!/^\d{2,6}$/.test(entry.code||'')||!/^[a-f0-9]{32}$/.test(entry.requestId||'')||entry.commandId&&!/^[a-f0-9]{32}$/.test(entry.commandId)||!Number.isFinite(entry.deadline)||entry.deadline<Date.now()-86400000)continue;
  stationRemovalRequests.set(stationRemovalKey(entry.radioId,entry.code),{radioId:entry.radioId,code:entry.code,requestId:entry.requestId,commandId:entry.commandId||'',deadline:entry.deadline,name:String(entry.name||'Station').slice(0,120),deviceCode:String(entry.deviceCode||'—').slice(0,20),state:entry.state==='confirmed'?'confirmed':'unconfirmed',promise:null});
 }
}catch{}
window.stationRemovalPending=(id,code)=>stationRemovalRequests.has(stationRemovalKey(id,code))||!!(stationRemovalAuthorization&&stationRemovalAuthorization.radioId===String(id)&&stationRemovalAuthorization.code===String(code));
function stationManagementLocked(){
 window.stationManagementBusy=!!stationRemovalAuthorization||[...stationRemovalRequests.values()].some(record=>record.state==='sending'||record.state==='pending');
 const context=stationManagementContext(),record=stationRemovalRequests.get(stationRemovalKey(context.radioId,context.code)),auth=stationRemovalAuthorization,active=auth&&currentStationManagement(auth)||record&&currentStationManagement(record)&&['sending','pending'].includes(record.state);
 if(active)$('shared').dataset.removing='1';else delete $('shared').dataset.removing;
 const signature=JSON.stringify([window.stationManagementBusy,auth?.requestId||!!auth,[...stationRemovalRequests.values()].map(item=>[item.radioId,item.code,item.state])]);
 if(signature!==stationRemovalStateSignature){stationRemovalStateSignature=signature;window.dispatchEvent(new Event('station-removal-changed'));}
}
function setStationRemovalNotice(context,key,params={},kind='progress'){
 if(currentStationManagement(context))setSharedStatus(stationManagementText(key,params),kind);
}
function updateStationManagement(saved=$('shareForm').dataset.saved==='1'){
 const context=stationManagementContext(),record=stationRemovalRequests.get(stationRemovalKey(context.radioId,context.code)),auth=stationRemovalAuthorization;
 if(auth&&!currentStationManagement(auth))cancelStationRemovalAuthorization();
 stationManagementLocked();
 const applicable=!!context.radioId&&!$('shared').hidden&&!$('shareForm').hidden&&(!$('deviceLabel')||$('deviceLabel').hidden);
 stationManagementPanel.hidden=!applicable||!saved&&!record;
 if(stationManagementPanel.hidden)return;
 const radio=sharedLinkedRadios.find(r=>String(r.id)===context.radioId),inventory=readRadioInventory(context.radioId),supported=radio?.station_removal_version===1,ready=navigator.onLine!==false&&radio?.online===true&&radio?.removal_ready===true,fresh=inventory?.known&&!inventory.stale,activeAuth=auth&&auth.radioId===context.radioId&&auth.code===context.code;
 const pending=record&&(record.state==='sending'||record.state==='pending'),uncertain=record?.state==='unconfirmed',confirmed=record?.state==='confirmed';
 stationRemovalButton.textContent=stationManagementText(pending?'management.removing':uncertain?'management.check':confirmed?'management.refresh':'management.remove');
 stationRemovalButton.disabled=!!activeAuth||!!pending||!!shareRunning||$('shareForm').dataset.destinationLoading==='1'||!record&&(!supported||!ready||!fresh||!inventory.codes.has(context.code));
 stationRemovalDownload.hidden=supported||!!record||!!activeAuth;stationRemovalDownload.textContent=stationManagementText('management.download');
 const helpKey=activeAuth||pending?'':uncertain?'management.unconfirmed':confirmed?'management.confirmed':!supported?'management.updateNeeded':!ready?'management.offline':!fresh?'management.stale':!radio?.controls_allowed?'management.permission':'';
 stationRemovalHelp.textContent=helpKey?stationManagementText(helpKey):'';stationRemovalHelp.hidden=!helpKey||$('shareStatus').textContent===stationRemovalHelp.textContent;
 if(saved){$('shareSavedNotice').textContent=stationManagementText('management.saved');$('shareSavedNotice').dataset.i18n='management.saved';}
 const addAgain=$('shareAddAgain');if(addAgain){addAgain.hidden=!saved||$('shareForm').dataset.unlisted==='1';addAgain.disabled=!!shareRunning||!!record||!!activeAuth||navigator.onLine===false||radio?.online!==true||!fresh;}
 if(record||activeAuth)$('shareSubmit').disabled=true;
 stationManagementLocked();
}
window.updateStationManagement=updateStationManagement;
function cleanUpStationRemovalAuthorization(attempt){
 if(attempt.dispatched&&!attempt.approved&&!attempt.cancellationStarted){
  attempt.cancellationStarted=true;
  // A request reference also cancels an authorize write whose response has not
  // reached the browser yet; a claim ID alone cannot cover that race.
  stationRemovalAuthorizationCancellation=Promise.all([stationRemovalAuthorizationCancellation,api('/api/phone/control/authorize/cancel',{radio_id:attempt.radioId,request_id:attempt.requestId}).catch(()=>{
   if(!stationRemovalAuthorization&&currentStationManagement(attempt))setSharedStatus('Could not confirm cancellation. Tap Deny on your radio if the request is still showing.','error');
  })]).then(()=>undefined);
 }
}
function cancelStationRemovalAuthorization(){
 const attempt=stationRemovalAuthorization;if(!attempt)return;
 attempt.cancelled=true;stationRemovalAuthorization=null;attempt.controller.abort();cleanUpStationRemovalAuthorization(attempt);
 stationManagementLocked();
}
window.cancelStationRemovalAuthorization=cancelStationRemovalAuthorization;
async function authorizeStationRemoval(context,radio){
 if(radio.controls_allowed===true)return true;
 const attempt={...context,requestId:crypto.randomUUID().replaceAll('-',''),controller:new AbortController(),dispatched:false,approved:false,cancelled:false,claimId:''};stationRemovalAuthorization=attempt;stationManagementLocked();updateStationManagement(true);
 try{
  await stationRemovalAuthorizationCancellation;if(attempt.cancelled||!currentStationManagement(context))return false;
  attempt.dispatched=true;const claim=await api('/api/phone/control/authorize',{radio_id:context.radioId,request_id:attempt.requestId});attempt.claimId=claim.claim_id;
  if(attempt.cancelled||!currentStationManagement(context)){if(stationRemovalAuthorization===attempt)cancelStationRemovalAuthorization();else cleanUpStationRemovalAuthorization(attempt);return false;}
  setStationRemovalNotice(context,'management.waitApproval',{number:claim.confirmation_code});
  const result=await pollPhoneApproval(claim.claim_id,{current:()=>!attempt.cancelled&&currentStationManagement(context),deadline:Date.now()+180000,signal:attempt.controller.signal});
  if(!result||attempt.cancelled||!currentStationManagement(context))return false;
  if(result.state!=='approved')throw Error(phoneApprovalMessage(result.state));
  attempt.approved=true;const resultRadios=await api('/api/phone/radios');
  if(attempt.cancelled||!currentStationManagement(context))return false;
  const approvedRadio=resultRadios.radios.find(item=>String(item.id)===context.radioId);if(!approvedRadio?.controls_allowed)throw Error('Approve phone controls on your radio first.');
  sharedLinkedRadios=resultRadios.radios;return true;
 }finally{if(stationRemovalAuthorization===attempt){stationRemovalAuthorization=null;attempt.controller.abort();if(!attempt.approved){attempt.cancelled=true;cleanUpStationRemovalAuthorization(attempt);}}stationManagementLocked();}
}
function finishStationRemoval(record,state,message){
 record.state=state;record.promise=null;
 if(state==='removed'||state==='failed')stationRemovalRequests.delete(stationRemovalKey(record.radioId,record.code));
 saveStationRemovalReferences();stationManagementLocked();
 if(state==='removed'){
  const notice={radioId:record.radioId,name:record.name,message:stationManagementText('management.removed',{code:record.deviceCode}),kind:'success',expires:Date.now()+8000};
  stationDeliveryNotices.set(record.radioId,notice);renderStationDeliveryStatus();
  setTimeout(()=>{if(stationDeliveryNotices.get(record.radioId)===notice){stationDeliveryNotices.delete(record.radioId);renderStationDeliveryStatus();}},8000);
 }
 if(currentStationManagement(record)){
  if(state==='removed'){setSharedSavedState(false);setSharedStatus(message||stationManagementText('management.removed',{code:record.deviceCode}),'success');if(typeof stationPopup!=='undefined'&&stationPopup.open)stationPopup.close();}
  else{setSharedStatus(message||stationManagementText(state==='failed'?'management.failed':state==='confirmed'?'management.confirmed':'management.unconfirmed'),'error');updateStationManagement(true);}
 }
 return {state};
}
async function confirmStationRemovalInventory(record){
 try{const inventory=await refreshRadioInventory(record.radioId);if(inventory?.known&&!inventory.stale){if(!inventory.codes.has(record.code))return finishStationRemoval(record,'removed');return finishStationRemoval(record,'failed',stationManagementText('management.savedAgain'));}}catch{}
 return finishStationRemoval(record,'confirmed');
}
const stationRemovalWait=()=>new Promise(resolve=>setTimeout(resolve,2500));
function readStationRemovalStatus(record){
 const request=stationRemovalStatusQueue.catch(()=>{}).then(async()=>{
  let failures=0;
  for(;;){await stationRemovalWait();try{return await api('/api/phone/control/status',{command_id:record.commandId});}catch(error){if(error?.status===429&&++failures<=3&&Date.now()<record.deadline){await new Promise(resolve=>setTimeout(resolve,Math.max(1000,Math.min(60000,(error.retry_after||60)*1000))));continue;}throw error;}}
 });stationRemovalStatusQueue=request.catch(()=>{});return request;
}
async function monitorStationRemoval(record){
 record.state='pending';saveStationRemovalReferences();stationManagementLocked();updateStationManagement(true);
 try{
  do{const result=await readStationRemovalStatus(record);if(result.state==='applied')return await confirmStationRemovalInventory(record);if(['failed','expired'].includes(result.state))return finishStationRemoval(record,'failed');}while(Date.now()<record.deadline);
 }catch(error){if(error?.status>=400&&error.status<500&&error.status!==429)return finishStationRemoval(record,'failed',stationManagementText('management.checkFailed'));}
 return finishStationRemoval(record,'unconfirmed');
}
function sendStationRemoval(record){
 record.state='sending';saveStationRemovalReferences();stationManagementLocked();updateStationManagement(true);
 return (async()=>{
  try{
   const command=await api('/api/phone/control',{radio_id:record.radioId,action:'remove_station',value:Number(record.code),request_id:record.requestId});
   if(!command.command_id)throw Error('Missing removal receipt');record.commandId=command.command_id;record.deadline=Date.now()+70000;saveStationRemovalReferences();
   if(command.state==='applied')return await confirmStationRemovalInventory(record);if(['failed','expired'].includes(command.state))return finishStationRemoval(record,'failed');return await monitorStationRemoval(record);
  }catch(error){return finishStationRemoval(record,error.status>=400&&error.status<500?'failed':'unconfirmed',error.status>=400&&error.status<500?error.message:undefined);}
 })();
}
stationRemovalButton.onclick=async()=>{
 const context=stationManagementContext();if(!currentStationManagement(context)||stationRemovalButton.disabled)return;
 const key=stationRemovalKey(context.radioId,context.code),previous=stationRemovalRequests.get(key);
 if(previous){
  previous.generation=context.generation;
  if(previous.promise)return previous.promise;
  setStationRemovalNotice(context,'management.checking');
  previous.promise=previous.state==='confirmed'?confirmStationRemovalInventory(previous):previous.commandId?monitorStationRemoval(previous):sendStationRemoval(previous);return previous.promise;
 }
 if(window.stationManagementBusy||shareRunning||stationDeliveries.has(key))return;
 // Lock before asking: two taps must not open two confirmations or races with
 // an Add again action while the confirmation owns the selected station.
 const confirming={...context,controller:new AbortController(),cancelled:false,dispatched:false};stationRemovalAuthorization=confirming;stationManagementLocked();updateStationManagement(true);
 try{
  const allowed=await listenerActionDialog(stationManagementText('management.confirmTitle'),stationManagementText('management.confirmText',{name:context.name,code:context.deviceCode}),stationManagementText('management.confirm'),true);
  if(!allowed||!currentStationManagement(context)||confirming.cancelled)return;
  const result=await api('/api/phone/radios');if(!currentStationManagement(context)||confirming.cancelled)return;
  sharedLinkedRadios=result.radios;const radio=result.radios.find(item=>String(item.id)===context.radioId);
  if(!radio)throw Error('Connect this phone to your radio first.');
  if(radio.station_removal_version!==1)throw Error(stationManagementText('management.updateNeeded'));
  if(radio.online!==true||radio.removal_ready!==true)throw Error(stationManagementText('management.offline'));
  const inventory=await refreshRadioInventory(context.radioId);if(!currentStationManagement(context)||confirming.cancelled)return;
  if(!inventory?.known||inventory.stale||!inventory.codes.has(context.code))throw Error(stationManagementText('management.stale'));
  stationRemovalAuthorization=null;
  if(!await authorizeStationRemoval(context,radio)||!currentStationManagement(context))return;
  const record={...context,requestId:crypto.randomUUID().replaceAll('-',''),commandId:'',deadline:Date.now()+70000,state:'sending',promise:null};
  stationRemovalRequests.set(key,record);setStationRemovalNotice(context,'management.removing');record.promise=sendStationRemoval(record);return await record.promise;
 }catch(error){if(currentStationManagement(context))setSharedStatus(error.message,'error');}
 finally{if(stationRemovalAuthorization===confirming)stationRemovalAuthorization=null;stationManagementLocked();updateStationManagement($('shareForm').dataset.saved==='1');}
};
window.addEventListener('radio-selection-changed',()=>{cancelStationRemovalAuthorization();updateStationManagement();});
window.addEventListener('radio-inventory-changed',event=>{if(String(event.detail?.radioId)===String($('shareForm').elements.radio_id.value))updateStationManagement();});
window.addEventListener('radio-status-updated',event=>{if(Array.isArray(event.detail?.radios)){for(const radio of event.detail.radios){const index=sharedLinkedRadios.findIndex(item=>String(item.id)===String(radio.id));if(index>=0)sharedLinkedRadios[index]=radio;}}updateStationManagement();});
window.addEventListener('app-language-changed',()=>updateStationManagement());
window.addEventListener('offline',()=>{cancelStationRemovalAuthorization();updateStationManagement();});
if(typeof MutationObserver==='function')new MutationObserver(()=>{if($('shared').hidden)cancelStationRemovalAuthorization();}).observe($('shared'),{attributes:true,attributeFilter:['hidden']});
updateStationManagement(false);
