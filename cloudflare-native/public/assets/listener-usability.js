'use strict';
let selectedRadioFallback='';
function readSelectedRadio(){try{return localStorage.getItem('selectedRadio')||selectedRadioFallback;}catch{return selectedRadioFallback;}}
function rememberSelectedRadio(id){const next=String(id||''),previous=readSelectedRadio();selectedRadioFallback=next;try{localStorage.setItem('selectedRadio',next);}catch{}if(next!==previous)window.dispatchEvent(new Event('radio-selection-changed'));}
function reconcileSelectedRadio(radios){const current=readSelectedRadio(),next=radios.length===1?String(radios[0].id):radios.some(r=>String(r.id)===current)?current:'';rememberSelectedRadio(next);return next;}

// A radio report is the source of truth; command history cannot reveal removals.
const radioInventories=new Map(),radioInventoryRequests=new Map();
function readRadioInventory(id){return radioInventories.get(String(id))||null;}
function loadRadioInventory(id,force=false){
 id=String(id||'');if(!id)return Promise.resolve(null);
 if(radioInventoryRequests.has(id))return radioInventoryRequests.get(id);
 if(!force&&radioInventories.has(id))return Promise.resolve(radioInventories.get(id));
 const request=api('/api/phone/stations?radio_id='+encodeURIComponent(id)).then(result=>{
  const known=Array.isArray(result.saved_station_codes)&&result.inventory_reported_at!=null;
  const inventory={known,codes:new Set(known?result.saved_station_codes.map(String):[]),reportedAt:known?result.inventory_reported_at:null};
  const previous=radioInventories.get(id),changed=!previous||previous.known!==known||previous.unavailable||[...previous.codes].sort().join(',')!==[...inventory.codes].sort().join(',');radioInventories.set(id,inventory);if(changed)window.dispatchEvent(new CustomEvent('radio-inventory-changed',{detail:{radioId:id}}));return inventory;
 }).catch(()=>{const inventory={known:false,codes:new Set(),reportedAt:null,unavailable:true};radioInventories.set(id,inventory);window.dispatchEvent(new CustomEvent('radio-inventory-changed',{detail:{radioId:id}}));return inventory;}).finally(()=>radioInventoryRequests.delete(id));
 radioInventoryRequests.set(id,request);return request;
}
function refreshRadioInventory(id){const pending=radioInventoryRequests.get(String(id));return (pending||Promise.resolve()).then(()=>loadRadioInventory(id,true));}
async function updateStationConfirmation(){
 const select=$('shareForm').elements.radio_id,id=select.value,code=String(sharedCode);
 $('shareSubmit').textContent='Add station';
 if(!id){$('shareStatus').textContent=$('radioLabel').hidden?'':'Choose a radio to add this station.';return;}
 rememberSelectedRadio(id);const inventory=await loadRadioInventory(id);
 if(select.value!==id||String(sharedCode)!==code||shareRunning)return;
 if(inventory?.known&&inventory.codes.has(code)){$('shareStatus').textContent='On your radio. You can add it again if needed.';$('shareSubmit').textContent='Add again';}
 else $('shareStatus').textContent=inventory?.known?'':inventory?.unavailable?'Saved stations could not be checked. You can still add this station.':'Check your radio for its saved stations. The saved list updates after a radio software update.';
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
  listenerDialogTitle.textContent=title;listenerDialogText.textContent=text;listenerDialogCancel.hidden=!allowCancel;listenerDialogConfirm.textContent=confirmLabel;listenerDialogConfirm.className=allowCancel?'listener-dialog-confirm':'listener-dialog-done';listenerDialog.returnValue='';listenerDialog.addEventListener('close',closed,{once:true});
  try{listenerDialog.showModal();(allowCancel?listenerDialogCancel:listenerDialogConfirm).focus();}catch(error){listenerDialog.removeEventListener('close',closed);listenerDialogPending=false;reject(error);}
 });
}
const draftForms=['registerForm','editForm','ticketForm','advertiseForm'];for(const id of draftForms){const form=$(id);form.addEventListener('input',()=>form.dataset.dirty='1');form.addEventListener('reset',()=>delete form.dataset.dirty);}
function visibleDrafts(){return draftForms.map($).filter(form=>form.dataset.dirty&&form.getClientRects().length);}
window.addEventListener('beforeunload',event=>{if(visibleDrafts().length){event.preventDefault();event.returnValue='';}});
document.addEventListener('click',event=>{const navigation=event.target.closest('nav button,nav a,a[href]');if(!navigation||navigation.target==='_blank')return;const drafts=visibleDrafts();if(drafts.length&&!confirm('Leave this form? Your unsaved changes will be lost.')){event.preventDefault();event.stopImmediatePropagation();}},true);
