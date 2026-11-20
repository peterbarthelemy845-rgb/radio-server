'use strict';
let radioLoading=false,radioViewSnapshot='',radioReloadRequested=false,radioViewGeneration=0,radioLastChecked=0,radioPairingBusy=false,radioPairingGeneration=0,radioSessionExpired=false,radioRefreshFailures=0;
let radioPairingAttempt=null;
let deferredStationConnection=null;
function phoneApprovalMessage(state){return ({denied:'Connection not approved: denied on your radio. Start again and tap Allow only for your own request.',expired:'Connection expired. Enter the current Device Code and start again.',cancelled:'Connection cancelled. Start again when you are ready.'})[state]||'Connection could not be checked. Start again when you are ready.';}
async function pollPhoneApproval(claimId,{current,deadline,signal}={}){
 let failures=0;
 while(Date.now()<deadline){
  await delay();if(!current())return null;
  let result;
  try{result=await api('/api/phone/claim/status',{claim_id:claimId},{signal});failures=0;}
  catch(error){
   if(!current()||error?.name==='AbortError')return null;
   // Retry only the same read-only status request. Never create a new claim,
   // repeat a bot check, or retry an authorization/terminal rejection.
   if(error?.status>=400&&error.status<500||++failures>3)throw error;
   continue;
  }
  if(!current())return null;
  if(!['waiting','approved','denied','expired','cancelled'].includes(result?.state))throw Error('Connection status could not be checked. Start again.');
  if(result.state!=='waiting')return result;
 }
 return {state:'expired'};
}
let radioPairingCancellation=Promise.resolve();
// Connection steps stay in this tab. Wi-Fi credentials are entered only on the
// radio's local setup page; finding a radio never grants this phone access.
let radioConnectionStep='idle',radioConnectingAnother=false;
function syncRadioConnectionControls(){
 const linked=radioCardViews.size>0;
 if(linked&&!radioConnectingAnother)radioConnectionStep='idle';
 const connect=$('connectRadio'),key=linked?'pairing.connectAnother':'connect',fallback=linked?'Connect another radio':'Connect my radio',translated=window.appI18n?.t(key);connect.textContent=translated&&translated!==key?translated:fallback;connect.setAttribute('data-i18n',key);
 connect.hidden=radioConnectionStep!=='idle';
 $('radioConnectionChoices').hidden=radioConnectionStep!=='choose';
 $('connectRadioForm').hidden=radioConnectionStep!=='code';
 $('radioCodeBack').hidden=radioConnectionStep!=='code';
}
function showRadioConnectionChoices(){
 if(radioPairingBusy||$('myRadio').hidden||document.hidden)return false;
 deferredStationConnection=null;
 window.clearDeviceCodeInputError?.($('connectRadioForm').elements.device_code);
 radioConnectingAnother=radioCardViews.size>0;radioConnectionStep='choose';syncRadioConnectionControls();
 $('radioConnectStatus').textContent='';$('setupRadioWifi').focus({preventScroll:true});return true;
}
function showRadioCodeEntry(){
 if(radioPairingBusy||$('myRadio').hidden||document.hidden)return false;
 window.clearDeviceCodeInputError?.($('connectRadioForm').elements.device_code);
 radioConnectingAnother=radioCardViews.size>0;radioConnectionStep='code';syncRadioConnectionControls();
 $('radioConnectStatus').textContent='';$('connectRadioForm').elements.device_code.focus({preventScroll:true});return true;
}
function closeRadioConnectionFlow(){radioConnectionStep='idle';radioConnectingAnother=false;syncRadioConnectionControls();}
window.showRadioConnectionChoices=showRadioConnectionChoices;
window.showRadioCodeEntry=showRadioCodeEntry;
window.closeRadioConnectionFlow=closeRadioConnectionFlow;
const radioUnlinkPending=new Set();
function cancelRadioPairingRequest(attempt,showStatus,generation){
 if(!attempt?.dispatched||attempt.approved||attempt.cancellationStarted)return;attempt.cancellationStarted=true;
 const previous=radioPairingCancellation;
 radioPairingCancellation=Promise.all([previous,trackPairingCleanup(api('/api/phone/claim/cancel',{request_id:attempt.requestId}).then(result=>{if(result.state!=='cancelled')throw Error('Cancellation not confirmed');}).catch(()=>{
  if(showStatus&&generation===radioPairingGeneration&&!radioPairingBusy&&!$('myRadio').hidden)$('radioConnectStatus').textContent='Could not confirm cancellation. Tap Deny on your radio if the request is still showing.';
 }))]).then(()=>undefined);
}
function cancelRadioPairing(showStatus=false){
 const attempt=radioPairingAttempt;radioPairingGeneration++;radioPairingAttempt=null;deferredStationConnection=null;attempt?.controller.abort();
 if(radioPairingBusy){radioPairingBusy=false;busy($('connectRadioForm'),false);}
 $('cancelRadioConnection').hidden=true;
 if(showStatus){$('radioConnectStatus').textContent='Connection cancelled.';$('connectRadioForm').elements.device_code.focus({preventScroll:true});}
 cancelRadioPairingRequest(attempt,showStatus,radioPairingGeneration);
}
function currentRadioPairing(generation){return generation===radioPairingGeneration&&!$('myRadio').hidden;}
async function resumeDeferredStationConnection(continuation){
 if(!continuation||continuation!==deferredStationConnection||!currentRadioPairing(continuation.generation)||radioPairingBusy||radioLoading||document.hidden)return;
 deferredStationConnection=null;
 try{await window.resumePendingStationConnection?.(continuation.radioId);}
 catch{if(currentRadioPairing(continuation.generation)&&!document.hidden)$('radioConnectStatus').textContent='Radio connected. Choose your station below to try adding it again.';}
}
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
let radioStatusAvailable=false;
const radioCardViews=new Map(),radioFreshness=document.createElement('p');radioFreshness.id='radioFreshness';radioFreshness.className='radio-freshness';radioFreshness.hidden=true;radioFreshness.setAttribute('aria-live','off');$('radioConnectStatus').before(radioFreshness);
function checkedRadioTime(){return radioLastChecked?new Date(radioLastChecked).toLocaleTimeString([], {hour:'numeric',minute:'2-digit'}):'';}
function showRadioFreshness(available){radioFreshness.hidden=available;radioFreshness.textContent=available?'':radioLastChecked?'Last checked '+checkedRadioTime():'Status has not been checked.';}
function updateRadioCardStatus(available){
 radioStatusAvailable=available;
 for(const view of radioCardViews.values()){
  const {status,station,radio,report,choose,code}=view,selected=String(readSelectedRadio())===String(radio.id),deviceLabel='Device code '+(radio.device_code||'—'),inventory=typeof readRadioInventory==='function'?readRadioInventory(radio.id):null;
  status.textContent=available?(radio.online?'Online':'Radio offline. Check power and Wi-Fi.'):'Status unavailable';status.className=available?(radio.online?'radio-online':'radio-offline'):'radio-unknown';
  station.textContent=available&&radio.online&&!radio.current_station&&inventory?.known&&!inventory.stale&&inventory.codes.size===0?'Choose a station below':'Current station: '+(available?(radio.online?(radio.current_station?String(radio.current_station).toLocaleUpperCase():'Not reported yet'):'Unavailable while offline'):'Unavailable until status is checked');
  station.hidden=!available||!radio.online;
  if(code)code.textContent=deviceLabel;
  if(choose){choose.setAttribute('aria-pressed',String(selected));choose.setAttribute('aria-label',deviceLabel+(selected?', selected':', select radio'));choose.title=selected?'Selected radio':'Select this radio';}
  if(report)report.hidden=!available||!radio.online||!radio.current_station||!(/^[1-9][0-9]{1,5}$/).test(String(radio.current_station_code||''));
 }
 const selected=radioCardViews.get(String(readSelectedRadio()))?.radio;
 $('openWifiSetup').hidden=radioCardViews.size===0||(available&&selected?.online!==false);
}
window.addEventListener('radio-inventory-changed',()=>{if(radioStatusAvailable&&!radioLoading&&!$('myRadio').hidden)updateRadioCardStatus(true);});
function publishRadioStatus(radios){window.dispatchEvent(new CustomEvent('radio-status-updated',{detail:{radios,checked_at:Date.now()}}));}
window.currentStationTileCode=()=>{
 const radio=radioCardViews.get(String(readSelectedRadio()))?.radio,now=Date.now();
 return radioStatusAvailable&&radioLastChecked>0&&now>=radioLastChecked&&now-radioLastChecked<=30000&&radio?.online&&Number(radio.telemetry_reported_at)*1000<=now&&Number(radio.telemetry_reported_at)*1000>now-90000&&/^[1-9][0-9]{1,5}$/.test(String(radio.current_station_code||''))?String(radio.current_station_code):null;
};
let stationDestination;
function renderStationDestination(){
 if(!$('library'))return;
 if(!stationDestination){stationDestination=document.createElement('p');stationDestination.id='stationDestination';stationDestination.setAttribute('data-i18n-skip','');const anchor=$('stationSearchControls')||$('search');anchor?.before(stationDestination);}
 const selected=radioCardViews.get(String(readSelectedRadio()))?.radio;
 stationDestination.hidden=!radioCardViews.size;
 const key=selected?.device_code?'pairing.addingTo':'pairing.chooseDevice',fallback=selected?.device_code?'Adding to Device Code '+selected.device_code:'Choose a Device Code above.',translated=window.appI18n?.t(key,{code:selected?.device_code});stationDestination.textContent=translated&&translated!==key?translated:fallback;
}
window.addEventListener('radio-status-updated',renderStationDestination);window.addEventListener('radio-selection-changed',renderStationDestination);window.addEventListener('app-language-changed',renderStationDestination);
function markRadioStatusUnavailable(text){syncRadioConnectionControls();updateRadioCardStatus(false);window.dispatchEvent(new CustomEvent('radio-status-updated',{detail:{unavailable:true}}));showRadioFreshness(false);$('refreshRadios').hidden=false;if(text)$('radioConnectStatus').textContent=text;}
function markRadioStatusUpdating(){
 // A refresh is not a failure. Retain the last reported station while making
 // its freshness clear, and reserve retry controls for a failed request.
 radioStatusAvailable=false;for(const {status,report} of radioCardViews.values()){status.textContent='Updating status…';status.className='radio-unknown';if(report)report.hidden=true;}
 window.dispatchEvent(new Event('radio-current-station-invalidated'));
 if(radioCardViews.size)showRadioFreshness(false);
 else{radioFreshness.hidden=false;radioFreshness.textContent='Updating status…';}
 $('refreshRadios').hidden=true;$('radioConnectStatus').textContent='';
}
function showRadioReconnect(){
 radioSessionExpired=true;cancelRadioPairing();radioViewSnapshot='';radioLastChecked=0;radioCardViews.clear();$('linkedRadios').replaceChildren();rememberSelectedRadio('');radioInventories.clear();publishRadioStatus([]);
 closeRadioConnectionFlow();$('refreshRadios').hidden=true;radioFreshness.hidden=true;radioFreshness.textContent='';updateRadioCardStatus(true);
 $('radioConnectStatus').textContent='Your phone connection expired. Connect your radio again.';
}
async function loadMyRadios(silent=false){
 if(silent&&$('connectRadioForm').querySelector('button').disabled&&!radioPairingAttempt?.approved)return;
 if(!navigator.onLine){if(!$('myRadio').hidden&&!document.hidden)markRadioStatusUnavailable('No internet. Check your connection and tap Try again.');return;}
 if(!silent)radioRefreshFailures=0;
 if(radioLastChecked&&(!silent||Date.now()-radioLastChecked>30000)&&!$('myRadio').hidden&&!document.hidden&&navigator.onLine)markRadioStatusUpdating();
 if(radioLoading){if(!silent)radioReloadRequested=true;return;}radioLoading=true;
 if(!silent&&$('myRadio').hidden)page('myRadio');
 const generation=radioViewGeneration;let stationContinuation=null;
 $('linkedRadios').setAttribute('aria-busy','true');
 if(!silent){$('refreshRadios').hidden=true;if(!radioViewSnapshot){radioFreshness.hidden=false;radioFreshness.textContent='Checking radio status…';}$('radioConnectStatus').textContent=navigator.onLine?'':'No internet. Check your connection and try again.';}
 try{
  const result=await api('/api/phone/radios');
  if($('myRadio').hidden||document.hidden||generation!==radioViewGeneration)return;
  if(!navigator.onLine)throw Error('No internet.');
  radioSessionExpired=false;radioRefreshFailures=0;
  // A background approval must wait for a new successful status response in
  // this visible page. Existing links alone never create station-add intent.
  const deferred=deferredStationConnection;
  if(deferred&&deferred.generation===radioPairingGeneration){if(result.radios.some(r=>String(r.id)===deferred.radioId))stationContinuation=deferred;else deferredStationConnection=null;}
  const selected=reconcileSelectedRadio(result.radios);
  if(selected)loadRadioInventory(selected,true);
  const selectionHint=result.radios.length>1&&!selected?'Choose a Device code for station additions.':'';
  const snapshot=JSON.stringify(result.radios.map(r=>String(r.id)).sort());
  radioLastChecked=Date.now();showRadioFreshness(true,result.radios.length>0);$('refreshRadios').hidden=true;$('radioConnectStatus').textContent=selectionHint;
  if(snapshot===radioViewSnapshot){for(const radio of result.radios){const view=radioCardViews.get(String(radio.id));if(view)view.radio=radio;}syncRadioConnectionControls();updateRadioCardStatus(true);publishRadioStatus(result.radios);return;}
  radioViewSnapshot=snapshot;$('linkedRadios').replaceChildren();radioCardViews.clear();
  for(const radio of result.radios){
   const radioId=String(radio.id),deviceLabel='Device code '+(radio.device_code||'—'),card=document.createElement('article'),row=document.createElement('div'),status=document.createElement('p'),station=document.createElement('p');
   card.className='linked-radio-card';radioCardViews.set(radioId,{status,station,radio});
   row.className='radio-device-row';station.className='radio-current-station';
   const unlink=document.createElement('button');unlink.type='button';unlink.className='secondary radio-unlink';unlink.textContent='Unlink radio';unlink.disabled=radioUnlinkPending.has(radioId);radioCardViews.get(radioId).unlink=unlink;
   unlink.onclick=()=>unlinkMyRadio(radioId,'Device code '+(radioCardViews.get(radioId)?.radio.device_code||'—'),unlink);
   const code=document.createElement(result.radios.length>1?'button':'p');code.className=result.radios.length>1?'secondary device-code-select':'device-code-label';code.textContent=deviceLabel;radioCardViews.get(radioId).code=code;
   if(result.radios.length>1){const choose=code;choose.type='button';radioCardViews.get(radioId).choose=choose;choose.onclick=()=>{if(radioCardViews.get(radioId)?.choose!==choose||$('myRadio').hidden||document.hidden)return;rememberSelectedRadio(radioId);return loadMyRadios();};}
   const report=document.createElement('button');report.type='button';report.className='radio-station-report';report.textContent='Report a station problem';report.hidden=true;radioCardViews.get(radioId).report=report;
   report.onclick=()=>{const view=radioCardViews.get(radioId);if(view?.report!==report||report.hidden||$('myRadio').hidden||document.hidden)return;window.openStationProblemReport?.({code:view.radio.current_station_code,name:view.radio.current_station});};
   row.append(code,status);card.append(row,station,unlink,report);$('linkedRadios').append(card);
  }
  syncRadioConnectionControls();updateRadioCardStatus(true);publishRadioStatus(result.radios);
 }catch(e){if(!$('myRadio').hidden&&!document.hidden&&generation===radioViewGeneration){radioRefreshFailures=Math.min(4,radioRefreshFailures+1);if(e.status===401)showRadioReconnect();else markRadioStatusUnavailable(navigator.onLine?e.message+' Tap Try again.':'No internet. Check your connection and tap Try again.');}}
 finally{$('linkedRadios').setAttribute('aria-busy','false');radioLoading=false;if(radioReloadRequested||generation!==radioViewGeneration){radioReloadRequested=false;if(!$('myRadio').hidden&&!document.hidden)loadMyRadios(true);}else if(stationContinuation)await resumeDeferredStationConnection(stationContinuation);}
}
$('navRadio').onclick=()=>{history.replaceState(null,'','/'+location.search+'#radio');loadMyRadios();};$('refreshRadios').onclick=()=>loadMyRadios().finally(scheduleRadioRefresh);
$('connectRadio').onclick=showRadioConnectionChoices;
$('radioAlreadyOnline').onclick=showRadioCodeEntry;
$('setupRadioWifi').onclick=()=>{if(!radioPairingBusy)window.openGuidedRadioWifi?.();};
$('radioCodeBack').onclick=()=>{cancelRadioPairing();showRadioConnectionChoices();};
$('radioConnectionExit').onclick=()=>{deferredStationConnection=null;window.cancelPendingStationConnection?.();closeRadioConnectionFlow();$('connectRadio').focus({preventScroll:true});};
$('cancelRadioConnection').onclick=()=>{window.cancelPendingStationConnection?.();cancelRadioPairing(true);};
$('connectRadioForm').onsubmit=async event=>{
 event.preventDefault();const form=event.target;if(radioPairingBusy)return;const deviceCode=window.validateDeviceCodeInput(form.elements.device_code);if(deviceCode===null)return;
 // An older status read must not erase the approval number, hide the form or
 // expire the session after this explicit linking attempt has started.
 ++radioViewGeneration;
 const generation=++radioPairingGeneration,attempt={generation,controller:new AbortController(),requestId:crypto.randomUUID().replaceAll('-',''),dispatched:false};let connectedRadioId=null;deferredStationConnection=null;radioPairingAttempt=attempt;radioPairingBusy=true;busy(form,true,true);$('cancelRadioConnection').hidden=false;$('radioConnectStatus').textContent='';
 try{
  // Expired browser sessions need a fresh CSRF token before a new physical
  // approval request. Refresh only on an explicit reconnect attempt.
  if(radioSessionExpired){await loadOwnerSession();if(!currentRadioPairing(generation))return;radioSessionExpired=false;}
  const turnstile_token=await human(form,'radio-link',attempt.controller.signal);if(!currentRadioPairing(generation))return;
  await Promise.all([radioPairingCancellation,typeof sharedPairingCancellation==='undefined'?Promise.resolve():sharedPairingCancellation]);if(!currentRadioPairing(generation))return;
  attempt.dispatched=true;const claim=await api('/api/phone/claim',{device_code:deviceCode,turnstile_token,request_id:attempt.requestId});if(!currentRadioPairing(generation))return;
  showRadioApproval($('radioConnectStatus'),claim.confirmation_code);const result=await pollPhoneApproval(claim.claim_id,{current:()=>currentRadioPairing(generation),deadline:Date.now()+180000,signal:attempt.controller.signal});if(!result||!currentRadioPairing(generation))return;
  if(result.state!=='approved')throw Error(phoneApprovalMessage(result.state));attempt.approved=true;if(result.radio_id)rememberSelectedRadio(result.radio_id);
  $('cancelRadioConnection').hidden=true;form.reset();form.hidden=true;radioConnectionStep='idle';await loadMyRadios();if(!currentRadioPairing(generation))return;$('radioConnectStatus').textContent='';connectedRadioId=String(result.radio_id||readSelectedRadio()||'');
 }catch(e){if(currentRadioPairing(generation))$('radioConnectStatus').textContent=e.message;}
 finally{cancelRadioPairingRequest(attempt,false,generation);if(generation===radioPairingGeneration){radioPairingBusy=false;radioPairingAttempt=null;attempt.controller.abort();$('cancelRadioConnection').hidden=true;busy(form,false);}}
 // A selected station resumes only after pairing has released the form and
 // its request controller. Its addition owns its own pending/error feedback.
 if(connectedRadioId===null||!currentRadioPairing(generation))return;
 if(document.hidden){if(connectedRadioId)deferredStationConnection={radioId:connectedRadioId,generation};return;}
 try{
  const resumed=await window.resumePendingStationConnection?.(connectedRadioId);
  if(!resumed&&currentRadioPairing(generation)&&!document.hidden)await listenerActionDialog('Radio connected','');
 }catch{
  if(currentRadioPairing(generation)&&!document.hidden)$('radioConnectStatus').textContent='Radio connected. Choose your station below to try adding it again.';
 }
};
window.addEventListener('radio-locals-ready',()=>{if(!$('myRadio').hidden){if(location.hash==='#library')history.replaceState(null,'','/'+location.search+'#radio');loadMyRadios();scheduleRadioRefresh();}});

function radioRefreshDelay(){return !navigator.onLine?120000:Math.min(120000,10000*2**radioRefreshFailures);}
let radioRefreshTimer;function scheduleRadioRefresh(){clearTimeout(radioRefreshTimer);if(document.hidden||$('myRadio').hidden)return;radioRefreshTimer=setTimeout(async()=>{if(!document.hidden&&!$('myRadio').hidden&&!$('connectRadioForm').querySelector('button').disabled)await loadMyRadios(true);scheduleRadioRefresh();},radioRefreshDelay());}
function radioVisibilityChanged(){
 if($('myRadio').hidden){cancelRadioPairing();closeRadioConnectionFlow();}
 if(document.hidden||$('myRadio').hidden)radioViewGeneration++;
 else loadMyRadios(true);
 scheduleRadioRefresh();
}
new MutationObserver(radioVisibilityChanged).observe($('myRadio'),{attributes:true,attributeFilter:['hidden']});document.addEventListener('visibilitychange',radioVisibilityChanged);window.addEventListener('online',()=>{radioRefreshFailures=0;if(!$('myRadio').hidden&&!document.hidden)void loadMyRadios(true).finally(scheduleRadioRefresh);});window.addEventListener('offline',()=>{radioViewGeneration++;markRadioStatusUnavailable('No internet. Check your connection and tap Try again.');scheduleRadioRefresh();});
