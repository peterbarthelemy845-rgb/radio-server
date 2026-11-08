'use strict';
const $=id=>document.getElementById(id);let state,verificationId,stations=[],humanLoading;
function page(id){if(id==='library')id='myRadio';for(const name of ['myRadio','library','wifiSetup','register','login','editor','shared','admin','support','legal','advertise','adReview','reports','backups']){if($(name))$(name).hidden=name!==id&&!(name==='library'&&id==='myRadio');}$('message').textContent='';if(id==='myRadio'&&typeof refreshStationDirectory==='function')void refreshStationDirectory();}
function message(text){$('message').textContent=text;}
async function api(path,body,options={}){if(!navigator.onLine)throw new Error('No internet. Check your connection and try again.');const response=await fetch(path,{method:body?'POST':'GET',credentials:'same-origin',signal:AbortSignal.timeout(20000),headers:body?{'Content-Type':'application/json','X-CSRF-Token':state?.csrf||''}:{},body:body?JSON.stringify(body):undefined,...(options.cache?{cache:options.cache}:{})});const result=await response.json();if(!response.ok){const error=new Error(result.message||'Please try again.');error.status=response.status;throw error;}return result;}
const formBusyStates=new WeakMap();
function busy(form,on,freezeFields=false){
 if(on){if(formBusyStates.has(form))return;const controls=[...form.querySelectorAll(freezeFields?'button,input,select,textarea':'button')];formBusyStates.set(form,controls.map(control=>[control,control.disabled]));form.dataset.busy='1';form.setAttribute('aria-busy','true');for(const control of controls)control.disabled=true;}
 else{const previous=formBusyStates.get(form);if(!previous)return;formBusyStates.delete(form);delete form.dataset.busy;form.removeAttribute('aria-busy');for(const [control,disabled] of previous)control.disabled=disabled;form.dispatchEvent(new Event('form-busy-changed',{bubbles:true}));}
}
function formIsBusy(form){return formBusyStates.has(form);}
function loadHuman(){if(window.turnstile)return Promise.resolve();if(!humanLoading)humanLoading=new Promise((resolve,reject)=>{const script=document.createElement('script');script.src='https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';let timer;const failed=()=>{clearTimeout(timer);script.remove();humanLoading=null;reject(new Error('Security check could not load. Refresh and try again.'));};script.onload=()=>{clearTimeout(timer);resolve();};script.onerror=failed;document.head.append(script);timer=setTimeout(failed,15000);});return humanLoading;}
async function human(container,action){if(!state?.turnstile_site_key)throw new Error('Security check is not configured yet.');await loadHuman();return new Promise((resolve,reject)=>{let widget,settled=false;const area=container.querySelector('.human');area.replaceChildren();function finish(error,token){if(settled)return;settled=true;clearTimeout(timer);if(widget!==undefined)window.turnstile.remove(widget);if(error)reject(error);else resolve(token);}const timer=setTimeout(()=>finish(new Error('Security check timed out. Please try again.')),90000);widget=window.turnstile.render(area,{sitekey:state.turnstile_site_key,action,theme:'light',size:'flexible',retry:'never',callback:token=>finish(null,token),'error-callback':code=>{finish(new Error('Security check could not complete ('+String(code).replace(/[^0-9]/g,'').slice(0,8)+'). Refresh and try again. If it continues, open this page in your regular browser.'));return true;},'expired-callback':()=>finish(new Error('Security check expired. Please try again.'))});});}
async function fileData(file){if(!file?.size)return undefined;if(file.size>3*1024*1024)throw new Error('Choose an image under 3 MB.');const bytes=new Uint8Array(await file.arrayBuffer());let binary='';for(let i=0;i<bytes.length;i+=8192)binary+=String.fromCharCode(...bytes.subarray(i,i+8192));return {name:file.name,base64:btoa(binary)};}
let verificationGeneration=0,verificationBusy=false,ownerAccessGeneration=0,registrationRequestFingerprint='',registrationRequestId='',ownerSessionPromise;
function setVerificationBusy(on){verificationBusy=on;busy($('verification'),on,true);}
function currentVerification(generation,id){return verificationGeneration===generation&&verificationId===id&&$('verification').open;}
function verify(result){verificationGeneration++;setVerificationBusy(false);verificationId=result.verification_id;$('verifyText').textContent='Enter the private code sent to '+result.verification_email+'. It expires in 15 minutes.';$('verifyMessage').textContent='';$('verifyForm').reset();if(!$('verification').open)$('verification').showModal();}
function registrationMessage(text){const target=$('registerMessage');if(!target){message(text);return;}target.textContent=text;if(text)target.focus();}
function loadOwnerSession(){if(!ownerSessionPromise)ownerSessionPromise=api('/api/session').then(result=>{state=result;return result;}).finally(()=>{ownerSessionPromise=null;});return ownerSessionPromise;}
async function ensureOwnerSession(){if(!state?.csrf||!state?.agreement_version||!state?.turnstile_site_key)await loadOwnerSession();if(!state?.csrf||!state?.agreement_version||!state?.turnstile_site_key)throw new Error('Sign-in setup is not ready. Please refresh and try again.');}
async function registrationRequest(data){const fingerprint=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify(data))))).map(byte=>byte.toString(16).padStart(2,'0')).join('');if(fingerprint!==registrationRequestFingerprint){registrationRequestFingerprint=fingerprint;registrationRequestId=crypto.randomUUID().replaceAll('-','');}return registrationRequestId;}
function ownerAccessSuccess(result){$('stationSuccessTitle').textContent=result.registration_completed?(result.review_required?'Station submitted successfully!':'Station added successfully!'):'Signed in successfully!';$('stationSuccessText').textContent=result.registration_completed?(result.review_required?'Your email is verified. Your station is waiting for safety review.':'Your station is ready. Station code #'+result.station_code+'.'):'Your email is verified. You can edit your station.';if($('stationSuccessMessage'))$('stationSuccessMessage').textContent='';if($('retryOwnerEditor'))$('retryOwnerEditor').hidden=true;if(!$('stationSuccess').open)$('stationSuccess').showModal();}
function ownerEditorUnavailable(result,error){ownerAccessSuccess(result);if($('stationSuccessMessage'))$('stationSuccessMessage').textContent='The station editor could not load. Your verification succeeded. Please try opening the editor again.';else message(error.message);if($('retryOwnerEditor'))$('retryOwnerEditor').hidden=false;}
async function editor(preserveDraft=false){const result=await api('/api/owner/station');state.owner_station=result.station.code;page('editor');$('ownerName').textContent=result.station.name;showOwnerCover(result.station.artwork_url);$('ownerStatus').textContent='Station code #'+result.station.code+' · '+result.station.status.replaceAll('_',' ');const form=$('editForm');if(!preserveDraft||form.dataset.stationCode!==String(result.station.code)){form.elements.stream_url.value=result.station.stream_url;form.elements.bio.value=result.station.bio;}form.dataset.stationCode=String(result.station.code);}
$('openLogin').onclick=()=>page('login');$('openRegister').onclick=()=>page('register');$('navAdd').onclick=async()=>{history.replaceState(null,'','/#add-station');try{await loadOwnerSession();if(state.owner_station)await editor(true);else page('login');}catch(e){message(e.message);}};$('navLibrary').onclick=()=>{page('library');history.replaceState(null,'','/'+location.search+'#radio');};$('closeVerify').onclick=()=>{if(!verificationBusy)$('verification').close();};
$('verification').addEventListener('cancel',event=>{if(verificationBusy)event.preventDefault();});
$('verification').addEventListener('close',()=>{verificationGeneration++;verificationId=null;setVerificationBusy(false);});
$('registerForm').addEventListener('reset',()=>{registrationRequestFingerprint='';registrationRequestId='';registrationMessage('');});
$('registerForm').onsubmit=async event=>{
 event.preventDefault();const form=event.target;if(formIsBusy(form))return;if(window.prepareRegistrationStream&&!window.prepareRegistrationStream())return;registrationMessage('');const generation=++ownerAccessGeneration;
 try{const data=Object.fromEntries(new FormData(form)),artworkFile=form.elements.artwork.files[0];data.rights_confirmed=form.elements.rights_confirmed.checked;busy(form,true,true);if(window.validateRegistrationLogo&&!await window.validateRegistrationLogo(artworkFile))throw new Error(form.elements.artwork.validationMessage||'Choose a valid station logo.');await ensureOwnerSession();data.agreement_version=state.agreement_version;data.artwork=await fileData(artworkFile);data.request_id=await registrationRequest(data);data.turnstile_token=await human($('registrationHuman'),'station-submit');const result=await api('/api/owner/register',data);if(generation===ownerAccessGeneration)verify(result);}
 catch(e){if(generation===ownerAccessGeneration)registrationMessage(e.message);}finally{busy(form,false);}
};
$('loginForm').onsubmit=async event=>{event.preventDefault();const form=event.target;if(formIsBusy(form))return;const generation=++ownerAccessGeneration;busy(form,true);try{const data=Object.fromEntries(new FormData(form));await ensureOwnerSession();data.turnstile_token=await human(form,'station-access');const result=await api('/api/owner/login',data);if(generation===ownerAccessGeneration)verify(result);}catch(e){if(generation===ownerAccessGeneration)message(e.message);}finally{busy(form,false);}};
$('verifyForm').onsubmit=async event=>{
 event.preventDefault();if(verificationBusy||!verificationId||!$('verification').open)return;const form=event.target,generation=verificationGeneration,id=verificationId,code=form.elements.code.value;setVerificationBusy(true);
 try{const result=await api('/api/owner/verify',{verification_id:id,code});if(!currentVerification(generation,id))return;setVerificationBusy(false);$('verification').close();if(state)state.owner_station=result.station_code;if(result.registration_completed){$('registerForm').reset();delete $('registerForm').dataset.dirty;ownerAccessSuccess(result);if(typeof refreshStationDirectory==='function')void refreshStationDirectory(true);}try{await editor();if(!result.registration_completed)message(result.message);}catch(e){ownerEditorUnavailable(result,e);}}
 catch(e){if(currentVerification(generation,id))$('verifyMessage').textContent=e.message;}finally{if(verificationGeneration===generation)setVerificationBusy(false);}
};
$('resend').onclick=async()=>{if(verificationBusy||!verificationId||!$('verification').open)return;const generation=verificationGeneration,id=verificationId;setVerificationBusy(true);try{const token=await human($('verification'),'verification-resend');if(!currentVerification(generation,id))return;const result=await api('/api/owner/resend',{verification_id:id,turnstile_token:token});if(!currentVerification(generation,id))return;verificationId=result.verification_id;$('verifyForm').reset();$('verifyMessage').textContent='A new code has been requested.';}catch(e){if(currentVerification(generation,id))$('verifyMessage').textContent=e.message;}finally{if(verificationGeneration===generation)setVerificationBusy(false);}};
if($('retryOwnerEditor'))$('retryOwnerEditor').onclick=async()=>{const button=$('retryOwnerEditor');if(button.disabled)return;button.disabled=true;try{await editor();$('stationSuccess').close();}catch(e){if($('stationSuccessMessage'))$('stationSuccessMessage').textContent='The station editor could not load. Check your connection and try again.';else message(e.message);}finally{button.disabled=false;}};
$('editForm').onsubmit=async event=>{event.preventDefault();const form=event.target;busy(form,true);try{const result=await api('/api/owner/station',{stream_url:form.elements.stream_url.value,bio:form.elements.bio.value,artwork:await fileData(form.elements.artwork.files[0])});delete form.dataset.dirty;form.elements.artwork.value='';if(typeof refreshStationDirectory==='function')void refreshStationDirectory(true);await editor();message(result.message);}catch(e){message(e.message);}finally{busy(form,false);}};
$('logout').onclick=async()=>{try{await api('/api/owner/logout',{});state.owner_station=null;delete $('editForm').dataset.stationCode;page('login');}catch(e){message(e.message);}};
function list(){}

// Refresh the public directory without discarding usable cards during a failed request.
let stationDirectoryRequest=null,stationDirectoryGeneration=0,stationDirectoryLastAttempt=0,stationDirectoryStarted=false;
function stationDirectoryNotice(text){const host=$('stationDirectoryStatus'),notice=$('stationDirectoryMessage');if(host&&notice){host.hidden=!text;notice.textContent=text;}else if(text)message(text);}
function refreshStationDirectory(force=false){
 const now=Date.now();
 if(!force&&stationDirectoryRequest)return stationDirectoryRequest.promise;
 if(!force&&stationDirectoryStarted&&now-stationDirectoryLastAttempt<30000)return Promise.resolve(stations);
 const generation=++stationDirectoryGeneration;stationDirectoryStarted=true;stationDirectoryLastAttempt=now;
 const promise=(async()=>{
  try{const result=await api('/api/stations',undefined,{cache:'no-store'});if(generation!==stationDirectoryGeneration)return stations;if(!Array.isArray(result.stations))throw new Error('Station list unavailable.');stations=result.stations;list();stationDirectoryNotice('');return stations;}
  catch(e){if(generation===stationDirectoryGeneration)stationDirectoryNotice(stations.length?'Could not update stations. Showing the last loaded list. Check your connection and try again.':'Stations could not load. Check your connection and try again.');return stations;}
  finally{if(stationDirectoryRequest?.generation===generation)stationDirectoryRequest=null;}
 })();
 stationDirectoryRequest={generation,promise};return promise;
}
if($('retryStationDirectory'))$('retryStationDirectory').onclick=()=>refreshStationDirectory(true);
window.addEventListener('radio-status-updated',()=>{if($('myRadio')&&!$('myRadio').hidden)void refreshStationDirectory();});
window.addEventListener('online',()=>{if($('myRadio')&&!$('myRadio').hidden)void refreshStationDirectory(true);});

async function loadSupport(){
 const [remote,guides]=await Promise.allSettled([api('/api/support'),fetch('/assets/help-guides.json').then(r=>{if(!r.ok)throw new Error('Guides unavailable');return r.json();})]);
 const track=$('supportVideos');track.replaceChildren();track.className='support-slider';track.setAttribute('aria-label','How-to videos');
 const originals=guides.status==='fulfilled'&&Array.isArray(guides.value)?guides.value:[];
 for(const guide of originals){
  if(!['wifi','station','reset'].includes(guide.id)||guide.src!=='/assets/help-'+guide.id+'.mp4')continue;
  const card=document.createElement('article');card.className='support-slide';const label=document.createElement('span');label.className='guide-kind';label.textContent='Illustrated guide';const heading=document.createElement('h3');heading.textContent=guide.title;
  const video=document.createElement('video');video.controls=true;video.playsInline=true;video.preload='none';video.width=960;video.height=540;video.setAttribute('aria-label',guide.title);video.poster='/assets/help-'+guide.id+'-poster.webp';
  const source=document.createElement('source');source.src=guide.src;source.type='video/mp4';const captions=document.createElement('track');captions.kind='captions';captions.src='/assets/help-'+guide.id+'.vtt';captions.srclang='en';captions.label='English';video.append(source,captions);video.append(document.createTextNode('Your browser cannot play this video. Read the steps below.'));
  const details=document.createElement('details'),summary=document.createElement('summary'),steps=document.createElement('ol');summary.textContent='Read steps';for(const text of (Array.isArray(guide.steps)?guide.steps:[]).slice(0,8)){const step=document.createElement('li');step.textContent=String(text);steps.append(step);}details.append(summary,steps);card.append(label,heading,video,details);track.append(card);
 }
 const videos=remote.status==='fulfilled'&&Array.isArray(remote.value.videos)?remote.value.videos:[];
 for(const video of videos){if(!/^[A-Za-z0-9_-]{11}$/.test(video.video_id||''))continue;const card=document.createElement('article');card.className='support-slide';const heading=document.createElement('h3');heading.textContent=video.title;const frame=document.createElement('iframe');frame.src='https://www.youtube-nocookie.com/embed/'+video.video_id;frame.title=video.title;frame.loading='lazy';frame.referrerPolicy='no-referrer';frame.allow='encrypted-media; picture-in-picture; fullscreen';frame.className='tutorial-video';card.append(heading,frame);if(video.description){const description=document.createElement('p');description.textContent=video.description;card.append(description);}track.append(card);}
 track.hidden=!track.children.length;
}

async function showLegal(kind){const response=await fetch('/assets/policies.json');if(!response.ok)throw new Error('Policy page is unavailable.');const policies=await response.json();if(!policies[kind])return;page('legal');$('legalTitle').textContent=policies[kind][0];$('legalBody').innerHTML=policies[kind][1];const form=$('legalForm');form.hidden=kind==='terms';form.elements.kind.value=kind;const privacy=kind==='privacy';$('privacyMessage').hidden=!privacy;$('copyrightFields').hidden=privacy;form.elements.message.required=privacy;for(const name of ['address','phone','work','location','signature','good_faith','authority'])form.elements[name].required=!privacy;const counter=kind==='counter-notice';$('goodFaithText').textContent=counter?'Under penalty of perjury, I have a good-faith belief that removal or disabling resulted from a mistake or misidentification.':'I have a good-faith belief that the use is not authorized by the copyright owner, its agent, or the law.';$('authorityText').textContent=counter?'I consent to the jurisdiction of the federal district court for my address, or if outside the United States, any judicial district where the service provider may be found, and will accept service of process from the original claimant or its agent.':'The information is accurate, and under penalty of perjury I am authorized to act for the owner of the exclusive right allegedly infringed.';}
$('legalForm').onsubmit=async event=>{event.preventDefault();const form=event.target;busy(form,true);try{const body=Object.fromEntries(new FormData(form));body.good_faith=form.elements.good_faith.checked;body.authority=form.elements.authority.checked;body.turnstile_token=await human(form,'legal-request');const result=await api('/api/legal/request',body);$('legalMessage').textContent=result.message+' Reference: '+result.reference;form.hidden=true;}catch(e){$('legalMessage').textContent=e.message;}finally{busy(form,false);}};
async function initCommunity(){const path=location.pathname;if(path==='/'&&!location.hash){page('library');}if(['/device','/support'].includes(path)){page('support');await loadSupport();}if(['/terms','/privacy','/copyright','/counter-notice'].includes(path))await showLegal(path.slice(1));}
let sharedCode,shareRunning=false;
let adminVerification,adminMfaId;
async function adminList(){const result=await api('/api/admin/stations');$('adminLogin').hidden=true;$('adminVerify').hidden=true;$('adminStations').hidden=false;$('adminLogout').hidden=false;$('adminStations').replaceChildren();for(const station of result.stations){const card=document.createElement('article');card.style.borderTop='1px solid #bbc';card.style.padding='12px 0';const title=document.createElement('h2');title.textContent=station.name+' · #'+station.code;card.append(title);const details=document.createElement('p');details.textContent=station.status.replaceAll('_',' ')+' · '+station.contact_email;card.append(details);const bio=document.createElement('p');bio.textContent=station.bio;card.append(bio);const stream=document.createElement('p');stream.textContent=station.stream_url;stream.style.overflowWrap='anywhere';card.append(stream);if(station.artwork_key){const image=document.createElement('img');image.src='/api/admin/artwork/'+station.artwork_key;image.alt='Station cover art';image.width=120;image.height=120;image.style.objectFit='contain';card.append(image);}for(const action of ['approve','reject','delete']){if(action==='approve'&&(station.status!=='pending_review'||!station.email_verified_at))continue;const button=document.createElement('button');button.textContent={approve:'Approve',reject:'Suspend',delete:'Delete'}[action];button.style.margin='6px';button.onclick=async()=>{let reason='';if(action==='reject'||action==='delete'){const entered=prompt('Short reason for the owner (no links or private information):','');if(entered===null)return;reason=entered.trim();if(action==='reject'&&!reason){$('adminMessage').textContent='Enter a short reason before suspending a station.';return;}}if(!confirm(button.textContent+' '+station.name+'?'))return;button.disabled=true;try{const changed=await api('/api/admin/station',{code:station.code,revision:station.revision,action,reason});void refreshStationDirectory(true);await adminList();$('adminMessage').textContent=changed.notification_queued?'Station updated. Owner notification queued.':'Station updated.';window.dispatchEvent(new Event('admin-data-changed'));}catch(e){$('adminMessage').textContent=e.message;button.disabled=false;}};card.append(button);}$('adminStations').append(card);}if(!result.stations.length)$('adminStations').textContent='No stations yet.';}
$('adminLogin').onsubmit=async event=>{event.preventDefault();const form=event.target;busy(form,true);try{const turnstile_token=await human(form,'admin-login');const result=await api('/api/admin/login',{email:form.elements.email.value,turnstile_token});adminVerification=result.verification_id;$('adminMessage').textContent=result.message;form.hidden=true;$('adminVerify').hidden=false;}catch(e){$('adminMessage').textContent=e.message;}finally{busy(form,false);}};
$('adminVerify').onsubmit=async event=>{event.preventDefault();const form=event.target;busy(form,true);try{const result=await api('/api/admin/verify',{verification_id:adminVerification,code:form.elements.code.value});adminMfaId=result.mfa_id;form.reset();form.hidden=true;$('adminMfa').hidden=false;$('adminMfa').elements.authenticator_code.focus();$('adminMessage').textContent='Email verified. Enter your authenticator code.';}catch(e){$('adminMessage').textContent=e.message;}finally{busy(form,false);}};
$('adminMfa').onsubmit=async event=>{event.preventDefault();const form=event.target;busy(form,true);try{await api('/api/admin/mfa',{mfa_id:adminMfaId,authenticator_code:form.elements.authenticator_code.value});$('adminMessage').textContent='';form.reset();form.hidden=true;await adminList();}catch(e){$('adminMessage').textContent=e.message;}finally{busy(form,false);}};
$('adminLogout').onclick=async()=>{try{await api('/api/admin/logout',{});$('adminStations').replaceChildren();$('adminStations').hidden=true;$('adminLogout').hidden=true;$('adminLogin').hidden=false;$('adminMessage').textContent='Signed out.';}catch(e){$('adminMessage').textContent=e.message;}};
let deleteVerificationId;
$('deleteStation').onclick=async()=>{const button=$('deleteStation');button.disabled=true;try{const result=await api('/api/owner/delete',{});deleteVerificationId=result.verification_id;$('deleteVerifyForm').reset();$('deleteVerifyMessage').textContent='';$('deleteVerification').showModal();}catch(e){message(e.message);}finally{button.disabled=false;}};
$('cancelDelete').onclick=()=>$('deleteVerification').close();
$('deleteVerifyForm').onsubmit=async event=>{event.preventDefault();const form=event.target;busy(form,true);try{await api('/api/owner/delete',{confirm:true,verification_id:deleteVerificationId,code:form.elements.code.value});void refreshStationDirectory(true);$('deleteVerification').close();state.owner_station=null;page('login');message('Station removed from the directory.');}catch(e){$('deleteVerifyMessage').textContent=e.message;}finally{busy(form,false);}};

let sharedOpenGeneration=0;
async function openShared(code,inPopup=false){
 const generation=++sharedOpenGeneration,station=await api('/api/stations/'+code);if(generation!==sharedOpenGeneration)return;sharedCode=code;
 if(!inPopup)page('shared');$('shared').hidden=false;$('shareForm').hidden=false;$('shareStatus').textContent='';$('shareArt').hidden=true;$('shareName').textContent=station.name;$('shareStationCode').textContent='Station code #'+station.listener_code;$('shareStationBio').textContent=(station.bio||'').slice(0,250);$('shareStationBio').hidden=!station.bio;
 if(station.logo_url){$('shareArt').src=station.logo_url;$('shareArt').hidden=false;}
 const result=await api('/api/phone/radios');if(generation!==sharedOpenGeneration)return;
 const select=$('shareForm').elements.radio_id,selected=reconcileSelectedRadio(result.radios);select.replaceChildren();
 if(result.radios.length>1){const placeholder=document.createElement('option');placeholder.value='';placeholder.textContent='Choose a radio';placeholder.disabled=true;select.append(placeholder);}
 for(const radio of result.radios){const option=document.createElement('option');option.value=String(radio.id);option.textContent='Device code '+(radio.device_code||'—')+(radio.online?' · Online':' · Offline');select.append(option);}
 select.value=selected;select.required=!!result.radios.length;$('shareForm').elements.device_code.required=!result.radios.length;$('radioLabel').hidden=!result.radios.length;$('deviceLabel').hidden=!!result.radios.length;$('otherRadio').hidden=!result.radios.length;
 await updateStationConfirmation();
}
$('otherRadio').onclick=()=>{$('radioLabel').hidden=true;$('deviceLabel').hidden=false;$('otherRadio').hidden=true;$('shareForm').elements.radio_id.required=false;$('shareForm').elements.device_code.required=true;$('shareForm').elements.device_code.focus();};
const delay=()=>new Promise(resolve=>setTimeout(resolve,2500));
$('shareForm').onsubmit=async event=>{
 event.preventDefault();if(shareRunning)return;shareRunning=true;const form=event.target,stationCode=sharedCode,stationName=$('shareName').textContent;busy(form,true);
 try{
  let radioId=form.elements.radio_id.value,radioLabel=form.elements.radio_id.selectedOptions[0]?.textContent.split(' · ')[0]||'your linked radio',linkedNow=false;
  if(!$('deviceLabel').hidden){
   const deviceCode=form.elements.device_code.value,turnstile_token=await human(form,'radio-link');const claim=await api('/api/phone/claim',{device_code:deviceCode,turnstile_token});
   $('shareStatus').textContent=claim.confirmation_code+' — Match this number and tap Allow on your radio.';
   const deadline=Date.now()+180000;let approved=false;
   while(Date.now()<deadline){await delay();const result=await api('/api/phone/claim/status',{claim_id:claim.claim_id});if(result.state==='approved'){radioId=result.radio_id;approved=true;break;}if(result.state!=='waiting')throw new Error('Connection was not approved. Please try again.');}
   if(!approved)throw new Error('Connection timed out. Please try again.');
   radioLabel='Device code '+deviceCode;linkedNow=true;rememberSelectedRadio(radioId);$('shareStatus').textContent='Radio connected. Ready to add this station.';
   const select=form.elements.radio_id;if(![...select.options].some(option=>option.value===String(radioId))){const option=document.createElement('option');option.value=String(radioId);option.textContent=radioLabel;select.append(option);}select.value=String(radioId);select.required=true;form.elements.device_code.required=false;$('deviceLabel').hidden=true;$('radioLabel').hidden=false;$('otherRadio').hidden=false;
   if(!$('myRadio').hidden)loadMyRadios(true);
   await listenerActionDialog('Radio connected',radioLabel+' is now linked to this phone.');
  }
  if(!radioId)throw new Error('Choose a radio to add this station.');rememberSelectedRadio(radioId);
  if(!await listenerActionDialog('Add station?', 'Add '+stationName+' to '+radioLabel+'?','Add station',true)){$('shareStatus').textContent=linkedNow?'Radio connected. Station was not added.':'Station was not added.';return;}
  const command=await api('/api/phone/add',{radio_id:radioId,station_code:stationCode});$('shareStatus').textContent='Adding station…';
  const deadline=Date.now()+300000;let added=false;
  while(Date.now()<deadline){await delay();const result=await api('/api/phone/command/status',{command_id:command.command_id});if(result.state==='added'){added=true;break;}if(['failed','expired'].includes(result.state))throw new Error('Station could not be added. Check your radio and try again.');}
  if(!added)throw new Error('Your radio has not confirmed yet. Check it before trying again.');
  form.hidden=true;$('otherRadio').hidden=true;$('shareStatus').textContent='✓ Station added successfully!';refreshRadioInventory(radioId);
  await listenerActionDialog('Station added',stationName+' was added to '+radioLabel+'.');
  if(typeof stationPopup!=='undefined'&&stationPopup.open)stationPopup.close();
 }catch(e){$('shareStatus').textContent=e.message;}
 finally{shareRunning=false;busy(form,false);}
};
async function initializeSite(){
 page(location.pathname==='/wifi-setup'?'wifiSetup':location.hash==='#radio'?'myRadio':['/support','/device'].includes(location.pathname)?'support':location.pathname==='/add-station'||location.hash==='#add-station'?'login':location.pathname==='/admin'?'admin':location.pathname==='/station-edit'?'login':'library');
 const initial=await Promise.allSettled([loadOwnerSession(),refreshStationDirectory()]);
 if(initial[0].status==='rejected'){state=undefined;message(initial[0].reason.message);}
 try{
  const shared=location.pathname.match(/^\/station\/([0-9]{2,6})$/);if(shared)await openShared(shared[1]);
  if(initial[0].status==='fulfilled'){
   if(location.pathname==='/station-edit'&&!state.owner_station)page('login');
   if(state.owner_station&&(location.pathname==='/station-edit'||location.pathname==='/add-station'||location.hash==='#add-station'))await editor();
   if(location.pathname==='/admin'){page('admin');try{await adminList();}catch{}}
  }
 }catch(e){message(e.message);}
 try{await initCommunity();}catch(e){message(e.message);}
 finally{window.dispatchEvent(new Event('radio-locals-ready'));}
}
void initializeSite();

let ownerCoverObjectUrl;
function showOwnerCover(url){if(ownerCoverObjectUrl){URL.revokeObjectURL(ownerCoverObjectUrl);ownerCoverObjectUrl=null;}$('ownerCoverEmpty').textContent='No cover art uploaded yet';$('ownerCover').hidden=!url;$('ownerCoverEmpty').hidden=!!url;if(url)$('ownerCover').src=url;else $('ownerCover').removeAttribute('src');}
$('ownerCover').onerror=()=>{$('ownerCover').hidden=true;$('ownerCoverEmpty').hidden=false;$('ownerCoverEmpty').textContent='Cover art could not load. Please try refreshing.';};
$('editForm').elements.artwork.onchange=event=>{const file=event.target.files[0];if(!file)return;showOwnerCover('');ownerCoverObjectUrl=URL.createObjectURL(file);$('ownerCover').src=ownerCoverObjectUrl;$('ownerCover').hidden=false;$('ownerCoverEmpty').hidden=true;};
$('stationSuccessDone').onclick=()=>$('stationSuccess').close();

$('ticketForm').onsubmit=async event=>{event.preventDefault();const form=event.target;busy(form,true);$('ticketMessage').textContent='';try{const data=Object.fromEntries(new FormData(form));data.turnstile_token=await human(form,'support-ticket');const result=await api('/api/support/ticket',data);form.reset();window.dispatchEvent(new CustomEvent('support-ticket-created',{detail:{reference:result.reference}}));$('ticketReference').textContent='Ticket reference: '+result.reference;$('ticketSuccess').querySelector('p').textContent=result.receipt_queued?'We received your support request. A receipt will be emailed to you.':'We received your support request.';$('ticketSuccess').showModal();}catch(e){$('ticketMessage').textContent=e.message;}finally{busy(form,false);}};
$('closeTicketSuccess').onclick=()=>$('ticketSuccess').close();
