'use strict';
let selectedRadioFallback='',selectedRadioLoaded=false;
function readSelectedRadio(){
 // The active destination belongs to this tab. Other tabs may update the
 // default for a new tab, but must never redirect an existing tab's next tap.
 if(!selectedRadioLoaded){selectedRadioLoaded=true;let stored=null;try{stored=sessionStorage.getItem('selectedRadio');}catch{}if(stored===null)try{stored=localStorage.getItem('selectedRadio');}catch{}selectedRadioFallback=String(stored||'');try{sessionStorage.setItem('selectedRadio',selectedRadioFallback);}catch{}}
 return selectedRadioFallback;
}
function rememberSelectedRadio(id){const previous=readSelectedRadio(),next=String(id||'');selectedRadioFallback=next;try{sessionStorage.setItem('selectedRadio',next);}catch{}if(next!==previous){try{localStorage.setItem('selectedRadio',next);}catch{}window.dispatchEvent(new Event('radio-selection-changed'));}}
function reconcileSelectedRadio(radios){const current=readSelectedRadio(),next=radios.length===1?String(radios[0].id):radios.some(r=>String(r.id)===current)?current:'';rememberSelectedRadio(next);return next;}

// A radio report is the source of truth; command history cannot reveal removals.
const radioInventories=new Map(),radioInventoryRequests=new Map();
const savedStationMetadata=new Map(),savedStationMetadataChecks=new Map(),savedStationMetadataRequests=new Map();
function getSavedStationMetadata(code){
 const saved=savedStationMetadata.get(String(code)),current=typeof getStationDirectoryStation==='function'?getStationDirectoryStation(code):null;
 return !saved||current&&Number(current.revision||0)>=Number(saved.revision||0)?current||saved:saved;
}
function loadSavedStationMetadata(codes){
 const requested=[...new Set([...codes].map(String))].filter(code=>/^[1-9][0-9]{1,5}$/.test(code)).slice(0,100),now=Date.now();
 const missing=requested.filter(code=>{if(savedStationMetadataRequests.has(code))return false;if(!savedStationMetadataChecks.has(code)&&getSavedStationMetadata(code)){savedStationMetadataChecks.set(code,now);return false;}return !savedStationMetadataChecks.has(code)||now-savedStationMetadataChecks.get(code)>=60000;});
 if(missing.length){
  const allowed=new Set(missing),request=api('/api/stations/batch?codes='+encodeURIComponent(missing.join(','))).then(result=>{
   if(!Array.isArray(result.stations))throw Error('Station details unavailable');let changed=false;
   for(const station of result.stations){const code=String(station.listener_code||'');if(!allowed.has(code)||typeof station.name!=='string')continue;if(JSON.stringify(savedStationMetadata.get(code))!==JSON.stringify(station)){savedStationMetadata.set(code,station);changed=true;}}
   if(changed)window.dispatchEvent(new Event('saved-station-metadata-changed'));
  }).catch(()=>{}).finally(()=>{for(const code of missing){savedStationMetadataChecks.set(code,Date.now());if(savedStationMetadataRequests.get(code)===request)savedStationMetadataRequests.delete(code);}});
  for(const code of missing)savedStationMetadataRequests.set(code,request);
 }
 return Promise.all([...new Set(requested.map(code=>savedStationMetadataRequests.get(code)).filter(Boolean))]);
}
function readRadioInventory(id){return radioInventories.get(String(id))||null;}
function loadRadioInventory(id,force=false){
 id=String(id||'');if(!id)return Promise.resolve(null);
 if(radioInventoryRequests.has(id))return radioInventoryRequests.get(id);
 if(!force&&radioInventories.has(id))return Promise.resolve(radioInventories.get(id));
 const request=api('/api/phone/stations?radio_id='+encodeURIComponent(id)).then(result=>{
  const known=Array.isArray(result.saved_station_codes)&&result.inventory_reported_at!=null;
  const inventory={known,codes:new Set(known?result.saved_station_codes.map(String):[]),reportedAt:known?result.inventory_reported_at:null};
  const previous=radioInventories.get(id),changed=!previous||previous.known!==known||previous.unavailable||[...previous.codes].sort().join(',')!==[...inventory.codes].sort().join(',');radioInventories.set(id,inventory);if(changed)window.dispatchEvent(new CustomEvent('radio-inventory-changed',{detail:{radioId:id}}));if(known)void loadSavedStationMetadata(inventory.codes);return inventory;
 }).catch(error=>{const previous=radioInventories.get(id),retain=previous?.known&&error?.status!==401&&error?.status!==403,inventory=retain?{...previous,codes:new Set(previous.codes),unavailable:true,stale:true}:{known:false,codes:new Set(),reportedAt:null,unavailable:true};radioInventories.set(id,inventory);window.dispatchEvent(new CustomEvent('radio-inventory-changed',{detail:{radioId:id}}));return inventory;}).finally(()=>radioInventoryRequests.delete(id));
 radioInventoryRequests.set(id,request);return request;
}
function refreshRadioInventory(id){const pending=radioInventoryRequests.get(String(id));return (pending||Promise.resolve()).then(()=>loadRadioInventory(id,true));}
function showRadioApproval(target,number){
 const digits=document.createElement('strong');digits.className='radio-approval-number';digits.dataset.i18nSkip='1';digits.textContent=String(number);
 const instruction=document.createElement('span');instruction.className='radio-approval-instruction';instruction.dataset.i18n='pairing.approve';const translated=window.appI18n?.t('pairing.approve');instruction.textContent=translated&&translated!=='pairing.approve'?translated:'Match this number and tap Allow on your radio.';
 target.replaceChildren(digits,instruction);
}
let sharedConfirmationGeneration=0;
async function updateStationConfirmation(){
 const select=$('shareForm').elements.radio_id,id=select.value,code=String(sharedCode),generation=sharedOpenGeneration,check=++sharedConfirmationGeneration,submit=$('shareSubmit');
 setSharedSavedState(false);
 if(!id){renderSharedRadioAvailability(false);setSharedStatus(!$('deviceLabel').hidden?'':'Choose a radio to add this station.');return false;}
 submit.disabled=true;const checking=window.appI18n?.t('busy.checking');submit.textContent=checking&&checking!=='busy.checking'?checking:'Checking…';
 try{
  rememberSelectedRadio(id);const inventory=await loadRadioInventory(id);
  if(select.value!==id||String(sharedCode)!==code||generation!==sharedOpenGeneration||check!==sharedConfirmationGeneration||shareRunning||!$('deviceLabel').hidden)return;
  const retained=!!(inventory?.known&&inventory.codes.has(code)),previouslySaved=retained&&!!inventory?.stale,saved=retained&&!inventory?.stale;setSharedSavedState(saved);
  const notice=$('shareSavedNotice'),noticeKey=previouslySaved?'station.previouslySaved':'station.alreadySaved',translated=window.appI18n?.t(noticeKey);notice.dataset.i18n=noticeKey;notice.textContent=translated&&translated!==noticeKey?translated:previouslySaved?'Previously on your radio':'Already on your radio';if(previouslySaved){notice.hidden=false;submit.textContent='Add again';}
  // An unchecked snapshot is useful history, never a fresh yes/no decision.
  // Returning unknown also prevents a tile tap from automatically dispatching.
  if(renderSharedRadioAvailability(sharedOfflineRadios.has(String(id))))return inventory?.stale?undefined:saved;
  setSharedStatus(inventory?.stale?'Saved stations not checked. Showing the last known list.':saved?'':inventory?.known?'':inventory?.unavailable?'Saved stations could not be checked. You can still add this station.':'Check your radio for its saved stations. The saved list updates after a radio software update.');return inventory?.stale?undefined:saved;
 }finally{if(generation===sharedOpenGeneration&&check===sharedConfirmationGeneration&&!shareRunning)submit.disabled=false;}
}
$('shareForm').elements.radio_id.addEventListener('change',updateStationConfirmation);

const listenerDialog=document.createElement('dialog');listenerDialog.id='listenerActionDialog';listenerDialog.setAttribute('aria-labelledby','listenerActionTitle');listenerDialog.setAttribute('aria-describedby','listenerActionText');
const listenerDialogTitle=document.createElement('h2');listenerDialogTitle.id='listenerActionTitle';
const listenerDialogText=document.createElement('p');listenerDialogText.id='listenerActionText';
const listenerDialogActions=document.createElement('div');listenerDialogActions.className='listener-dialog-actions';
const listenerDialogCancel=document.createElement('button');listenerDialogCancel.type='button';listenerDialogCancel.className='secondary';listenerDialogCancel.textContent='Cancel';listenerDialogCancel.onclick=()=>listenerDialog.close('cancelled');
const listenerDialogConfirm=document.createElement('button');listenerDialogConfirm.type='button';listenerDialogConfirm.onclick=()=>listenerDialog.close('confirmed');
listenerDialogActions.append(listenerDialogCancel,listenerDialogConfirm);listenerDialog.append(listenerDialogTitle,listenerDialogText,listenerDialogActions);document.body.append(listenerDialog);
let listenerDialogPending=false;
function listenerActionDialog(title,text,confirmLabel='Done',allowCancel=false){
 // A background completion must never replace an active approval prompt or
 // inherit its answer. Keep ownership until the browser delivers close.
 if(listenerDialogPending)return Promise.resolve(false);listenerDialogPending=true;
 return new Promise((resolve,reject)=>{
  const closed=()=>{listenerDialogPending=false;resolve(listenerDialog.returnValue==='confirmed');};
  listenerDialogTitle.textContent=title;listenerDialogText.textContent=text;listenerDialogText.hidden=!text;if(text)listenerDialog.setAttribute('aria-describedby','listenerActionText');else listenerDialog.removeAttribute('aria-describedby');listenerDialogCancel.hidden=!allowCancel;listenerDialogConfirm.textContent=confirmLabel;listenerDialogConfirm.className=allowCancel?'listener-dialog-confirm':'listener-dialog-done';listenerDialog.returnValue='';listenerDialog.addEventListener('close',closed,{once:true});
  try{listenerDialog.showModal();(allowCancel?listenerDialogCancel:listenerDialogConfirm).focus();}catch(error){listenerDialog.removeEventListener('close',closed);listenerDialogPending=false;reject(error);}
 });
}
const draftForms=['registerForm','editForm','ticketForm','advertiseForm'];for(const id of draftForms){const form=$(id);form.addEventListener('input',event=>{if(id==='registerForm'&&event?.target?.name==='stream_provider')return;form.dataset.dirty='1';});form.addEventListener('reset',()=>delete form.dataset.dirty);}
// Internal tabs retain their hidden forms. A real reload or departure discards
// all in-memory drafts, including those on a page that is no longer visible.
window.addEventListener('beforeunload',event=>{if(draftForms.some(id=>$(id).dataset.dirty)){event.preventDefault();event.returnValue='';}});
