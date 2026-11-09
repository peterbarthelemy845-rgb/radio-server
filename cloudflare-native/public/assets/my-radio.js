'use strict';
let radioLoading=false,radioViewSnapshot='',radioReloadRequested=false,radioViewGeneration=0,radioLastChecked=0,radioPairingBusy=false,radioPairingGeneration=0;
const radioUnlinkPending=new Set();
function cancelRadioPairing(){radioPairingGeneration++;if(radioPairingBusy){radioPairingBusy=false;busy($('connectRadioForm'),false);}}
function currentRadioPairing(generation){return generation===radioPairingGeneration&&!$('myRadio').hidden;}
async function unlinkMyRadio(radioId,deviceLabel,unlink){
 const generation=radioViewGeneration,current=()=>generation===radioViewGeneration&&!$('myRadio').hidden&&!document.hidden;
 if(!current()||radioUnlinkPending.has(radioId)||radioCardViews.get(radioId)?.unlink!==unlink)return;
 radioUnlinkPending.add(radioId);unlink.disabled=true;
 try{
  if(!await listenerActionDialog('Unlink radio?',deviceLabel,'Unlink radio',true)||!current()||!radioCardViews.has(radioId))return;
  await api('/api/phone/unlink',{radio_id:radioId});
  if(readSelectedRadio()===radioId)rememberSelectedRadio('');radioInventories.delete(radioId);
  const showFeedback=current(),updatedGeneration=++radioViewGeneration;radioViewSnapshot='';
  if(showFeedback){await loadMyRadios(true);if(updatedGeneration===radioViewGeneration&&!$('myRadio').hidden&&!document.hidden)await listenerActionDialog('Radio unlinked','');}
 }catch(e){if(current())$('radioConnectStatus').textContent=e.message;}
 finally{radioUnlinkPending.delete(radioId);unlink.disabled=false;const replacement=radioCardViews.get(radioId)?.unlink;if(replacement)replacement.disabled=false;}
}
const radioCardViews=new Map(),radioFreshness=document.createElement('p');radioFreshness.id='radioFreshness';radioFreshness.className='radio-freshness';radioFreshness.hidden=true;radioFreshness.setAttribute('aria-live','off');$('radioConnectStatus').before(radioFreshness);
function checkedRadioTime(){return radioLastChecked?new Date(radioLastChecked).toLocaleTimeString([], {hour:'numeric',minute:'2-digit'}):'';}
function showRadioFreshness(available){radioFreshness.hidden=false;radioFreshness.textContent=radioLastChecked?(available?'Checked ':'Last checked ')+checkedRadioTime():available?'Status checked.':'Status has not been checked.';}
function updateRadioCardStatus(available){for(const view of radioCardViews.values()){const {status,station,radio}=view;status.textContent=available?(radio.online?'Online':'Radio offline. Check power and Wi-Fi.'):'Status unavailable';status.className=available?(radio.online?'radio-online':'radio-offline'):'radio-unknown';station.textContent='Current station: '+(available?(radio.online?(radio.current_station||'Not reported yet'):'Unavailable while offline'):'Unavailable until status is checked');}const selected=radioCardViews.get(String(readSelectedRadio()))?.radio;$('openWifiSetup').hidden=!available||selected?.online!==false;}
function publishRadioStatus(radios){window.dispatchEvent(new CustomEvent('radio-status-updated',{detail:{radios,checked_at:Date.now()}}));}
function markRadioStatusUnavailable(text){window.dispatchEvent(new CustomEvent('radio-status-updated',{detail:{unavailable:true}}));updateRadioCardStatus(false);showRadioFreshness(false);$('refreshRadios').hidden=false;if(text)$('radioConnectStatus').textContent=text;}
async function loadMyRadios(silent=false){
 if(silent&&$('connectRadioForm').querySelector('button').disabled)return;
 if(radioLoading){if(!silent)radioReloadRequested=true;return;}radioLoading=true;
 if(!silent&&$('myRadio').hidden)page('myRadio');
 const generation=radioViewGeneration;
 $('linkedRadios').setAttribute('aria-busy','true');
 if(!silent){$('refreshRadios').hidden=true;if(!radioViewSnapshot){radioFreshness.hidden=false;radioFreshness.textContent='Checking radio status…';}$('radioConnectStatus').textContent=navigator.onLine?'':'No internet. Check your connection and try again.';}
 try{
  const result=await api('/api/phone/radios');
  if($('myRadio').hidden||document.hidden||generation!==radioViewGeneration)return;
  if(!navigator.onLine)throw Error('No internet.');
  const selected=reconcileSelectedRadio(result.radios);
  if(selected)loadRadioInventory(selected,true);
  const selectionHint=result.radios.length>1&&!selected?'Choose a Device code for station additions.':'';
  const snapshot=JSON.stringify([result.radios.map(r=>[r.id,r.device_code,r.online,r.current_station]),selected]);
  radioLastChecked=Date.now();showRadioFreshness(true);$('refreshRadios').hidden=true;$('radioConnectStatus').textContent=selectionHint;
  if(snapshot===radioViewSnapshot){for(const radio of result.radios){const view=radioCardViews.get(String(radio.id));if(view)view.radio=radio;}updateRadioCardStatus(true);publishRadioStatus(result.radios);return;}
  radioViewSnapshot=snapshot;$('linkedRadios').replaceChildren();radioCardViews.clear();$('connectRadio').hidden=true;$('connectRadioForm').hidden=result.radios.length>0;
  if(!result.radios.length){const empty=document.createElement('div');empty.className='radio-empty';empty.innerHTML='<p>Enter your Device Code, then approve on the radio.</p>';$('linkedRadios').append(empty);}
  for(const radio of result.radios){
   const radioId=String(radio.id),deviceLabel='Device code '+(radio.device_code||'—'),card=document.createElement('article'),status=document.createElement('p'),station=document.createElement('p');
   card.className='linked-radio-card';radioCardViews.set(radioId,{status,station,radio});
   const unlink=document.createElement('button');unlink.type='button';unlink.className='secondary radio-unlink';unlink.textContent='Unlink radio';unlink.disabled=radioUnlinkPending.has(radioId);radioCardViews.get(radioId).unlink=unlink;
   unlink.onclick=()=>unlinkMyRadio(radioId,deviceLabel,unlink);
   const choose=document.createElement('button');choose.type='button';choose.className='secondary device-code-select';choose.textContent=deviceLabel;choose.setAttribute('aria-pressed',String(selected===radioId));choose.setAttribute('aria-label',deviceLabel+(selected===radioId?', selected':', select radio'));choose.title=selected===radioId?'Selected radio':'Select this radio';choose.onclick=()=>{rememberSelectedRadio(radioId);loadMyRadios();};
   card.append(status,station,choose,unlink);$('linkedRadios').append(card);
  }
  updateRadioCardStatus(true);publishRadioStatus(result.radios);
 }catch(e){if(!$('myRadio').hidden&&!document.hidden&&generation===radioViewGeneration)markRadioStatusUnavailable(e.status===401?'Your phone connection expired. Refresh this page, then choose Connect my radio.':navigator.onLine?e.message+' Tap Try again.':'No internet. Check your connection and tap Try again.');}
 finally{$('linkedRadios').setAttribute('aria-busy','false');radioLoading=false;if(radioReloadRequested||generation!==radioViewGeneration){radioReloadRequested=false;if(!$('myRadio').hidden&&!document.hidden)loadMyRadios(true);}}
}
$('navRadio').onclick=()=>{history.replaceState(null,'','/'+location.search+'#radio');loadMyRadios();};$('refreshRadios').onclick=()=>loadMyRadios();
$('connectRadio').onclick=()=>{$('connectRadioForm').hidden=false;$('radioConnectStatus').textContent='Use the current Device Code. If it was reset, the old code will not work. Approve the request on your radio.';$('connectRadioForm').elements.device_code.focus();};
$('connectRadioForm').onsubmit=async event=>{
 event.preventDefault();const form=event.target;if(radioPairingBusy)return;const generation=++radioPairingGeneration,deviceCode=form.elements.device_code.value;radioPairingBusy=true;busy(form,true,true);
 try{
  const turnstile_token=await human(form,'radio-link');if(!currentRadioPairing(generation))return;
  const claim=await api('/api/phone/claim',{device_code:deviceCode,turnstile_token});if(!currentRadioPairing(generation))return;
  $('radioConnectStatus').textContent=claim.confirmation_code+' — Match this number and tap Allow on your radio.';const deadline=Date.now()+180000;let approved=false;
  while(Date.now()<deadline){await delay();if(!currentRadioPairing(generation))return;const result=await api('/api/phone/claim/status',{claim_id:claim.claim_id});if(!currentRadioPairing(generation))return;if(result.state==='approved'){if(result.radio_id)rememberSelectedRadio(result.radio_id);approved=true;break;}if(result.state!=='waiting')throw Error('Connection was not approved. Please try again.');}
  if(!approved)throw Error('Connection timed out. Please try again.');form.reset();form.hidden=true;await loadMyRadios();if(!currentRadioPairing(generation))return;$('radioConnectStatus').textContent='';if(!document.hidden)await listenerActionDialog('Radio connected','');
 }catch(e){if(currentRadioPairing(generation))$('radioConnectStatus').textContent=e.message;}
 finally{if(generation===radioPairingGeneration){radioPairingBusy=false;busy(form,false);}}
};
window.addEventListener('radio-locals-ready',()=>{if(!$('myRadio').hidden){if(location.hash==='#library')history.replaceState(null,'','/'+location.search+'#radio');loadMyRadios();scheduleRadioRefresh();}});

let radioRefreshTimer;function scheduleRadioRefresh(){clearTimeout(radioRefreshTimer);if(document.hidden||$('myRadio').hidden)return;radioRefreshTimer=setTimeout(async()=>{if(!document.hidden&&!$('myRadio').hidden&&!$('connectRadioForm').querySelector('button').disabled)await loadMyRadios(true);scheduleRadioRefresh();},10000);}
function radioVisibilityChanged(){
 if($('myRadio').hidden)cancelRadioPairing();
 if(document.hidden||$('myRadio').hidden)radioViewGeneration++;
 else{if(radioLastChecked&&Date.now()-radioLastChecked>30000)markRadioStatusUnavailable('Checking radio status…');loadMyRadios(true);}
 scheduleRadioRefresh();
}
new MutationObserver(radioVisibilityChanged).observe($('myRadio'),{attributes:true,attributeFilter:['hidden']});document.addEventListener('visibilitychange',radioVisibilityChanged);window.addEventListener('online',()=>{if(!$('myRadio').hidden)loadMyRadios(true);});window.addEventListener('offline',()=>{radioViewGeneration++;markRadioStatusUnavailable('No internet. Check your connection and tap Try again.');});
