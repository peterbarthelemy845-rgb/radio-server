'use strict';
let radioLoading=false,radioViewSnapshot='',radioReloadRequested=false;
async function loadMyRadios(silent=false){
 if(radioLoading){if(!silent)radioReloadRequested=true;return;}radioLoading=true;
 if(!silent&&$('myRadio').hidden)page('myRadio');
 if(!silent){$('refreshRadios').hidden=true;$('radioConnectStatus').textContent=navigator.onLine?'Loading radio status…':'No internet. Check your connection and try again.';}
 try{
  const result=await api('/api/phone/radios'),selected=reconcileSelectedRadio(result.radios);
  if(selected)loadRadioInventory(selected,true);
  if($('myRadio').hidden)return;
  const selectionHint=result.radios.length>1&&!selected?'Choose a Device code for station additions.':'';
  const snapshot=JSON.stringify([result.radios.map(r=>[r.id,r.device_code,r.online,r.current_station]),selected]);
  if(snapshot===radioViewSnapshot){if(!silent)$('radioConnectStatus').textContent=selectionHint;return;}
  radioViewSnapshot=snapshot;$('linkedRadios').replaceChildren();$('connectRadio').hidden=true;$('connectRadioForm').hidden=result.radios.length>0;$('refreshRadios').hidden=true;
  if(!result.radios.length){const empty=document.createElement('div');empty.className='radio-empty';empty.innerHTML='<p>Enter your Device Code, then approve on the radio.</p>';$('linkedRadios').append(empty);}
  for(const radio of result.radios){
   const radioId=String(radio.id),deviceLabel='Device code '+(radio.device_code||'—'),card=document.createElement('article'),status=document.createElement('p'),station=document.createElement('p');
   card.className='linked-radio-card';status.textContent=radio.online?'Online':'Radio offline. Check power and Wi-Fi.';status.className=radio.online?'radio-online':'radio-offline';station.textContent='Current station: '+(radio.online?(radio.current_station||'Not reported yet'):'Unavailable while offline');
   const unlink=document.createElement('button');unlink.type='button';unlink.className='secondary radio-unlink';unlink.textContent='Unlink radio';
   unlink.onclick=async()=>{if(!await listenerActionDialog('Unlink radio?',deviceLabel+' will be disconnected from this phone. You can connect it again with approval on the radio.','Unlink radio',true))return;unlink.disabled=true;try{await api('/api/phone/unlink',{radio_id:radioId});if(readSelectedRadio()===radioId)rememberSelectedRadio('');radioInventories.delete(radioId);await loadMyRadios();await listenerActionDialog('Radio unlinked',deviceLabel+' is no longer linked to this phone.');}catch(e){$('radioConnectStatus').textContent=e.message;}finally{unlink.disabled=false;}};
   const choose=document.createElement('button');choose.type='button';choose.className='secondary device-code-select';choose.textContent=deviceLabel;choose.setAttribute('aria-pressed',String(selected===radioId));choose.setAttribute('aria-label',deviceLabel+(selected===radioId?', selected':', select radio'));choose.title=selected===radioId?'Selected radio':'Select this radio';choose.onclick=()=>{rememberSelectedRadio(radioId);loadMyRadios();};
   card.append(status,station,choose,unlink);$('linkedRadios').append(card);
  }
  $('radioConnectStatus').textContent=selectionHint;
 }catch(e){$('refreshRadios').hidden=false;$('radioConnectStatus').textContent=e.status===401?'Your phone connection expired. Refresh this page, then choose Connect my radio.':navigator.onLine?e.message+' Tap Try again.':'No internet. Check your connection and tap Try again.';}
 finally{radioLoading=false;if(radioReloadRequested){radioReloadRequested=false;loadMyRadios();}}
}
$('navRadio').onclick=()=>{history.replaceState(null,'','/'+location.search+'#radio');loadMyRadios();};$('refreshRadios').onclick=()=>loadMyRadios();
$('connectRadio').onclick=()=>{$('connectRadioForm').hidden=false;$('radioConnectStatus').textContent='Use the current Device Code. If it was reset, the old code will not work. Approve the request on your radio.';$('connectRadioForm').elements.device_code.focus();};
$('connectRadioForm').onsubmit=async event=>{event.preventDefault();const form=event.target;busy(form,true);try{const deviceCode=form.elements.device_code.value;const turnstile_token=await human(form,'radio-link');const claim=await api('/api/phone/claim',{device_code:deviceCode,turnstile_token});$('radioConnectStatus').textContent=claim.confirmation_code+' — Match this number and tap Allow on your radio.';const deadline=Date.now()+180000;let approved=false;while(Date.now()<deadline){await delay();const result=await api('/api/phone/claim/status',{claim_id:claim.claim_id});if(result.state==='approved'){if(result.radio_id)rememberSelectedRadio(result.radio_id);approved=true;break;}if(result.state!=='waiting')throw Error('Connection was not approved. Please try again.');}if(!approved)throw Error('Connection timed out. Please try again.');form.reset();form.hidden=true;await loadMyRadios();$('radioConnectStatus').textContent='Radio connected successfully.';await listenerActionDialog('Radio connected','Device code '+deviceCode+' is now linked to this phone.');}catch(e){$('radioConnectStatus').textContent=e.message;}finally{busy(form,false);}};
window.addEventListener('radio-locals-ready',()=>{if(!$('myRadio').hidden){if(location.hash==='#library')history.replaceState(null,'','/'+location.search+'#radio');loadMyRadios();scheduleRadioRefresh();}});

let radioRefreshTimer;function scheduleRadioRefresh(){clearTimeout(radioRefreshTimer);if(document.hidden||$('myRadio').hidden)return;radioRefreshTimer=setTimeout(async()=>{if(!document.hidden&&!$('myRadio').hidden&&!$('connectRadioForm').querySelector('button').disabled)await loadMyRadios(true);scheduleRadioRefresh();},10000);}
new MutationObserver(scheduleRadioRefresh).observe($('myRadio'),{attributes:true,attributeFilter:['hidden']});document.addEventListener('visibilitychange',scheduleRadioRefresh);window.addEventListener('online',()=>{if(!$('myRadio').hidden)loadMyRadios();});

if(new URLSearchParams(location.search).get('app')==='1'){$('navAdd').hidden=true;$('navLibrary').querySelector('span').textContent='Stations';document.body.classList.add('listener-app');$('library').querySelector('h1').textContent='Stations';const help=document.createElement('button');help.className='support-help';help.textContent='Get help';help.setAttribute('aria-expanded','false');$('ticketForm').hidden=true;help.onclick=()=>{$('ticketForm').hidden=!$('ticketForm').hidden;help.setAttribute('aria-expanded',String(!$('ticketForm').hidden));if(!$('ticketForm').hidden)$('ticketForm').elements.name.focus();};$('ticketForm').before(help);document.querySelector('nav a[href="/support"]').href='/support?app=1';}
