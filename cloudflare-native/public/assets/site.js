'use strict';
const $=id=>document.getElementById(id);let state,verificationId,stations=[],humanLoading,sitePageGeneration=0;
function page(id){sitePageGeneration++;if(typeof cancelOwnerAccess==='function')cancelOwnerAccess();if(id==='library')id='myRadio';if(['login','register'].includes(id)&&window.ownerAccountNavigation?.active())id='editor';if(id!=='editor'&&$('deleteVerification')?.open)invalidateStationDeletion();if(!['login','register'].includes(id)&&($('verification')?.open||verificationId))invalidateOwnerVerification();if(id!=='shared'&&typeof invalidateSharedView==='function')invalidateSharedView();for(const name of ['myRadio','library','wifiSetup','register','login','editor','ownerEntryLoading','shared','admin','support','legal','advertise','adReview','reports','backups']){if($(name))$(name).hidden=name!==id&&!(name==='library'&&id==='myRadio');}$('message').textContent='';if(id==='myRadio'&&typeof refreshStationDirectory==='function')void refreshStationDirectory();}
function message(text){$('message').textContent=text;}
async function api(path,body,options={}){
 const failure=(text,status,reference,details)=>{const safeReference=typeof reference==='string'&&/^[a-f0-9]{16,32}$/.test(reference)?reference:'';const error=new Error(text+(safeReference?' Reference: '+safeReference+'.':''));if(status!==undefined)error.status=status;if(safeReference)error.errorReference=safeReference;if(Number.isInteger(details?.retry_after)&&details.retry_after>0&&details.retry_after<=86400)error.retry_after=details.retry_after;if(typeof details?.field==='string'&&/^[a-zA-Z][a-zA-Z0-9_]{0,49}$/.test(details.field))error.field=details.field;if(typeof details?.code==='string'&&/^[a-z][a-z_]{1,39}$/.test(details.code))error.code=details.code;return error;};
 const cancelled=()=>{const error=new Error('Request cancelled.');error.name='AbortError';return error;};
 const caller=options.signal;if(caller?.aborted)throw cancelled();
 if(caller&&(typeof caller.addEventListener!=='function'||typeof caller.removeEventListener!=='function'))throw new TypeError('Invalid request signal.');
 if(!navigator.onLine)throw new Error('No internet. Check your connection and try again.');
 const controller=new AbortController(),deadline=AbortSignal.timeout(20000);let abortKind;
 const abort=kind=>{if(controller.signal.aborted)return;abortKind=kind;controller.abort();},onTimeout=()=>abort('timeout'),onCaller=()=>abort('caller');
 const abortFailure=status=>abortKind==='caller'?cancelled():failure('Request timed out. Please try again.',status);
 // The caller stops obsolete reads; the independent deadline still bounds all
 // requests. Aborting a sent write does not undo it or automatically replay it.
 deadline.addEventListener('abort',onTimeout,{once:true});if(caller)caller.addEventListener('abort',onCaller,{once:true});
 if(caller?.aborted)onCaller();else if(deadline.aborted)onTimeout();
 const waitFor=(operation,status)=>new Promise((resolve,reject)=>{
  let settled=false;const finish=(ok,value)=>{if(settled)return;settled=true;controller.signal.removeEventListener('abort',onAbort);if(ok)resolve(value);else reject(value);},onAbort=()=>finish(false,abortFailure(status));
  controller.signal.addEventListener('abort',onAbort,{once:true});if(controller.signal.aborted){onAbort();return;}
  try{Promise.resolve(operation()).then(value=>finish(true,value),error=>finish(false,error));}catch(error){finish(false,error);}
 });
 const timedOut=error=>error?.name==='TimeoutError'||error?.name==='AbortError';
 try{
  const request={method:body?'POST':'GET',credentials:'same-origin',signal:controller.signal,headers:body?{'Content-Type':'application/json','X-CSRF-Token':state?.csrf||''}:{},body:body?JSON.stringify(body):undefined,...(options.cache?{cache:options.cache}:{})};
  let response;
  try{response=await waitFor(()=>fetch(path,request));}
  catch(error){if(controller.signal.aborted)throw abortFailure();if(timedOut(error))throw failure('Request timed out. Please try again.');if(error?.name==='TypeError')throw failure('Could not connect. Check your internet connection and try again.');throw error;}
  if(controller.signal.aborted)throw abortFailure();let result;
  try{result=await waitFor(()=>response.json(),response.status);}
  catch(error){if(controller.signal.aborted)throw abortFailure(response.status);if(timedOut(error))throw failure('Request timed out. Please try again.',response.status);if(error?.name==='SyntaxError')throw failure('The website is temporarily unavailable. Please try again.',response.status);throw error;}
  if(controller.signal.aborted)throw abortFailure(response.status);
  if(result===null||typeof result!=='object')throw failure('The website is temporarily unavailable. Please try again.',response.status);
  if(!response.ok)throw failure(typeof result.message==='string'&&result.message?result.message:'Please try again.',response.status,result.error_reference,result);
  return result;
 }finally{deadline.removeEventListener('abort',onTimeout);if(caller)caller.removeEventListener('abort',onCaller);}
}
const formBusyStates=new WeakMap();
let pairingCleanupPending=0;
function trackPairingCleanup(promise){
 pairingCleanupPending++;window.dispatchEvent(new Event('pairing-cleanup-changed'));
 return Promise.resolve(promise).finally(()=>{pairingCleanupPending--;window.dispatchEvent(new Event('pairing-cleanup-changed'));});
}
const busyWords={checking:'Checking…',sending:'Sending…',saving:'Saving…',deleting:'Deleting…',connecting:'Connecting…',adding:'Adding…',working:'Working…'};
function setBusyButtonLabel(button,key){
 const previous={text:button.textContent,nodes:button.childNodes?[...button.childNodes]:null,i18n:button.dataset.i18n,skip:button.dataset.i18nSkip};
 const translation='busy.'+key,value=window.appI18n?.t(translation);button.dataset.i18n=translation;delete button.dataset.i18nSkip;button.textContent=value&&value!==translation?value:busyWords[key]||busyWords.working;
 return ()=>{if(previous.nodes&&button.replaceChildren)button.replaceChildren(...previous.nodes);else button.textContent=previous.text;if(previous.i18n===undefined)delete button.dataset.i18n;else button.dataset.i18n=previous.i18n;if(previous.skip===undefined)delete button.dataset.i18nSkip;else button.dataset.i18nSkip=previous.skip;};
}
function busy(form,on,freezeFields=false,label){
 if(on){
  if(formBusyStates.has(form))return;
  const controls=[...form.querySelectorAll(freezeFields?'button,input,select,textarea':'button')],submit=controls.find(control=>control.tagName==='BUTTON'&&(control.type==='submit'||control.getAttribute?.('type')===null));
  const labels={registerForm:'saving',editForm:'saving',loginForm:'sending',verification:'checking',verifyForm:'checking',deleteVerifyForm:'deleting',ticketForm:'sending',advertiseForm:'sending',legalForm:'sending',stationCodeRecoveryForm:'sending',supportStatusLookup:'sending',adminLogin:'sending',adminVerify:'checking',adminMfa:'checking',connectRadioForm:'connecting',shareForm:'adding'};
  const snapshot={controls:controls.map(control=>[control,control.disabled]),restoreLabel:submit?setBusyButtonLabel(submit,label||labels[form.id]||'checking'):null};
  formBusyStates.set(form,snapshot);form.dataset.busy='1';form.setAttribute('aria-busy','true');for(const control of controls)control.disabled=true;form.dispatchEvent(new Event('form-busy-changed',{bubbles:true}));
 }else{
  const previous=formBusyStates.get(form);if(!previous)return;formBusyStates.delete(form);delete form.dataset.busy;form.removeAttribute('aria-busy');for(const [control,disabled] of previous.controls)control.disabled=disabled;previous.restoreLabel?.();form.dispatchEvent(new Event('form-busy-changed',{bubbles:true}));
 }
}
function formIsBusy(form){return formBusyStates.has(form);}

function loadHuman(){if(window.turnstile)return Promise.resolve();if(!humanLoading)humanLoading=new Promise((resolve,reject)=>{const script=document.createElement('script');script.src='https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';let timer;const failed=()=>{clearTimeout(timer);script.remove();humanLoading=null;reject(new Error('Security check could not load. Refresh and try again.'));};script.onload=()=>{clearTimeout(timer);resolve();};script.onerror=failed;document.head.append(script);timer=setTimeout(failed,15000);});return humanLoading;}
window.supportChatTransport={api,human};
function humanCancelled(){const error=new Error('Security check cancelled.');error.name='AbortError';return error;}
function humanStep(promise,signal){
 if(!signal)return promise;
 return new Promise((resolve,reject)=>{let settled=false;const finish=(error,value)=>{if(settled)return;settled=true;signal.removeEventListener('abort',cancel);if(error)reject(error);else resolve(value);},cancel=()=>finish(humanCancelled());signal.addEventListener('abort',cancel,{once:true});if(signal.aborted)cancel();Promise.resolve(promise).then(value=>finish(null,value),error=>finish(error));});
}
async function human(container,action,signal){
 if(signal?.aborted)throw humanCancelled();await humanStep(ensureOwnerSession(),signal);if(signal?.aborted)throw humanCancelled();await humanStep(loadHuman(),signal);if(signal?.aborted)throw humanCancelled();
 return new Promise((resolve,reject)=>{
  let widget,timer,settled=false;const area=container.querySelector('.human'),removeWidget=()=>{if(widget!==undefined){try{window.turnstile.remove(widget);}catch{}widget=undefined;}};
  function finish(error,token){if(settled)return;settled=true;clearTimeout(timer);signal?.removeEventListener('abort',cancel);removeWidget();if(error)reject(error);else resolve(token);}
  const cancel=()=>finish(humanCancelled());signal?.addEventListener('abort',cancel,{once:true});if(signal?.aborted){cancel();return;}
  area.replaceChildren();timer=setTimeout(()=>finish(new Error('Security check timed out. Please try again.')),90000);
  try{widget=window.turnstile.render(area,{sitekey:state.turnstile_site_key,action,theme:'light',size:'flexible',retry:'never',callback:token=>finish(null,token),'error-callback':code=>{finish(new Error('Security check could not complete ('+String(code).replace(/[^0-9]/g,'').slice(0,8)+'). Refresh and try again. If it continues, open this page in your regular browser.'));return true;},'expired-callback':()=>finish(new Error('Security check expired. Please try again.'))});if(settled)removeWidget();}catch(error){finish(error);}
 });
}
async function fileData(file){if(!file?.size)return undefined;if(file.size>3*1024*1024)throw new Error('Choose an image under 3 MB.');const bytes=new Uint8Array(await file.arrayBuffer());let binary='';for(let i=0;i<bytes.length;i+=8192)binary+=String.fromCharCode(...bytes.subarray(i,i+8192));return {name:file.name,base64:btoa(binary)};}
let verificationGeneration=0,verificationPageGeneration=0,verificationBusy=false,verificationResendDeadline=0,verificationResendTimer,ownerAccessGeneration=0,ownerAccessAttempt=null,registrationRequestFingerprint='',registrationRequestId='',ownerSessionPromise,ownerSessionGeneration=0;
let ownerPendingVerification=null;
function renderPendingOwnerVerification(){for(const id of ['continueRegistrationVerification','continueLoginVerification']){const button=$(id);if(button)button.hidden=!ownerPendingVerification||!!state?.owner_station;}}
function rememberOwnerVerification(result){if(!result?.verification_id)return;const lifetime=Math.min(900,Math.max(0,Number(result.expires_in??900)||0)),purpose=result.verification_purpose||'edit',stationCode=normalizeOwnerStationCode(result.station_code||(purpose==='edit'?$('loginForm')?.elements?.code?.value:''));ownerPendingVerification={verification_id:result.verification_id,verification_email:result.verification_email,verification_purpose:purpose,station_code:/^[0-9]{2,6}$/.test(stationCode)?stationCode:'',expires_in:lifetime,expires_at:Number.isFinite(result.expires_at)?result.expires_at:Date.now()+lifetime*1000,resend_at:Number.isFinite(result.resend_at)?result.resend_at:Date.now()+(lifetime<=840?0:60000)};renderPendingOwnerVerification();}
function clearPendingOwnerVerification(){ownerPendingVerification=null;renderPendingOwnerVerification();}
function normalizeOwnerStationCode(value){return String(value||'').trim().replace(/^#\s*/,'').replace(/\s/g,'');}
let changeEmailButton,changeEmailForm,changeEmailInput;
function initializeOwnerFlowUI(){
for(const [formId,id] of [['registerForm','continueRegistrationVerification'],['loginForm','continueLoginVerification']]){const button=document.createElement('button');button.id=id;button.type='button';button.className='secondary owner-continue-verification';button.textContent='Continue email verification';button.hidden=true;button.onclick=()=>{if(ownerPendingVerification)verify(ownerPendingVerification,true);};$(formId).before(button);}
const verificationExplanation=document.createElement('p');verificationExplanation.id='ownerVerificationExplanation';verificationExplanation.className='owner-code-help';verificationExplanation.textContent='This private email code is different from your station code and the Device Code on your radio.';$('verifyText').after(verificationExplanation);
changeEmailButton=document.createElement('button');changeEmailButton.id='changeVerificationEmail';changeEmailButton.type='button';changeEmailButton.className='secondary';changeEmailButton.textContent='Change email';changeEmailButton.hidden=true;$('closeVerify').before(changeEmailButton);
changeEmailForm=document.createElement('form');changeEmailForm.id='changeVerificationEmailForm';changeEmailForm.hidden=true;
const changeEmailLabel=document.createElement('label'),changeEmailCaption=document.createElement('span');changeEmailCaption.id='ownerChangeEmailLabel';changeEmailCaption.textContent='Contact email';changeEmailInput=document.createElement('input');changeEmailInput.name='email';changeEmailInput.type='email';changeEmailInput.autocomplete='email';changeEmailInput.maxLength=254;changeEmailInput.required=true;changeEmailLabel.append(changeEmailCaption,changeEmailInput);
const changeEmailSubmit=document.createElement('button');changeEmailSubmit.id='sendChangedEmailCode';changeEmailSubmit.type='submit';changeEmailSubmit.textContent='Send new code';const cancelEmailChange=document.createElement('button');cancelEmailChange.id='cancelChangedEmail';cancelEmailChange.type='button';cancelEmailChange.className='secondary';cancelEmailChange.textContent='Cancel';changeEmailForm.append(changeEmailLabel,changeEmailSubmit,cancelEmailChange);changeEmailButton.after(changeEmailForm);
changeEmailButton.onclick=()=>{if(verificationBusy||ownerPendingVerification?.verification_purpose!=='registration')return;changeEmailForm.hidden=false;changeEmailButton.hidden=true;changeEmailInput.focus();};cancelEmailChange.onclick=()=>{if(verificationBusy)return;changeEmailForm.hidden=true;changeEmailButton.hidden=false;changeEmailButton.focus();};
changeEmailForm.onsubmit=async event=>{event.preventDefault();if(verificationBusy||!verificationId||ownerPendingVerification?.verification_purpose!=='registration')return;const generation=verificationGeneration,id=verificationId,email=changeEmailInput.value;setVerificationBusy(true);try{const token=await human($('verification'),'verification-resend');if(!currentVerification(generation,id))return;const result=await api('/api/owner/change-email',{verification_id:id,email,turnstile_token:token});if(!currentVerification(generation,id))return;verify(result);$('verifyMessage').textContent=ownerText('owner.emailChanged','Use the new code sent to your updated email. The previous code no longer works.');}catch(error){if(currentVerification(generation,id))$('verifyMessage').textContent=error.message;}finally{if(verificationGeneration===generation)setVerificationBusy(false);}};
const stationCodeInput=$('loginForm').elements.code;if(stationCodeInput?.addEventListener){stationCodeInput.maxLength=32;stationCodeInput.addEventListener('input',()=>{stationCodeInput.value=normalizeOwnerStationCode(stationCodeInput.value);});stationCodeInput.addEventListener('paste',event=>{const value=event.clipboardData?.getData('text');if(typeof value==='string'&&/^\s*#?\s*\d(?:\s*\d){1,5}\s*$/.test(value)){event.preventDefault();stationCodeInput.value=normalizeOwnerStationCode(value);stationCodeInput.dispatchEvent(new Event('input',{bubbles:true}));}});}
const verificationCodeInput=$('verifyForm').elements.code;verificationCodeInput.removeAttribute('maxlength');verificationCodeInput.addEventListener('input',()=>{verificationCodeInput.value=verificationCodeInput.value.replace(/\s/g,'');});verificationCodeInput.addEventListener('paste',event=>{const value=event.clipboardData?.getData('text');if(typeof value==='string'&&/^\s*\d(?:\s*\d){5}\s*$/.test(value)){event.preventDefault();verificationCodeInput.value=value.replace(/\s/g,'');verificationCodeInput.dispatchEvent(new Event('input',{bubbles:true}));}});
window.addEventListener('owner-session-updated',event=>{const pending=event.detail?.pending_verification;if(pending&&ownerPendingVerification?.verification_id!==pending.verification_id)rememberOwnerVerification(pending);else if(event.detail?.owner_station)clearPendingOwnerVerification();});
if(state?.pending_verification)rememberOwnerVerification(state.pending_verification);
const renderFlowWords=()=>{for(const [id,key,fallback] of [['continueRegistrationVerification','owner.continueVerification','Continue email verification'],['continueLoginVerification','owner.continueVerification','Continue email verification'],['ownerVerificationExplanation','owner.codeDifference','This private email code is different from your station code and the Device Code on your radio.'],['changeVerificationEmail','owner.changeEmail','Change email'],['ownerChangeEmailLabel','owner.contactEmail','Contact email'],['sendChangedEmailCode','owner.sendNewCode','Send new code'],['cancelChangedEmail','cancel','Cancel'],['keepOwnerCover','owner.keepCurrentLogo','Keep current logo']]){const node=$(id);if(node){node.dataset.i18n=key;node.textContent=ownerText(key,fallback);}}};renderFlowWords();window.addEventListener('app-language-changed',renderFlowWords);
}
function cancelOwnerAccess(){const attempt=ownerAccessAttempt;if(!attempt)return;ownerAccessAttempt=null;ownerAccessGeneration++;attempt.controller.abort();busy(attempt.form,false);}
function beginOwnerAccess(form){cancelOwnerAccess();const attempt={form,controller:new AbortController(),generation:++ownerAccessGeneration,view:sitePageGeneration};ownerAccessAttempt=attempt;busy(form,true,true);return attempt;}
function currentOwnerAccess(attempt){return ownerAccessAttempt===attempt&&attempt.generation===ownerAccessGeneration&&attempt.view===sitePageGeneration&&!attempt.controller.signal.aborted;}
function finishOwnerAccess(attempt){if(ownerAccessAttempt===attempt){ownerAccessAttempt=null;busy(attempt.form,false);}}
function renderVerificationResend(){
 clearTimeout(verificationResendTimer);verificationResendTimer=undefined;
 const button=$('resend'),remaining=Math.max(0,Math.ceil((verificationResendDeadline-Date.now())/1000));
 button.disabled=verificationBusy||remaining>0;button.dataset.i18nSkip='1';
 button.textContent=remaining?(window.appI18n?.t('verification.resendCountdown',{seconds:remaining})||'Resend in '+remaining+' seconds'):(window.appI18n?.t('resend')||'Resend email');
 const pending=ownerPendingVerification,expires=pending?.expires_at,seconds=Number.isFinite(expires)?Math.max(0,Math.ceil((expires-Date.now())/1000)):null;
 if(pending&&$('verification').open){const email=String(pending.verification_email||''),fallback=seconds?('Enter the private code emailed to '+email+'. Time left: '+Math.ceil(seconds/60)+' minute'+(Math.ceil(seconds/60)===1?'':'s')+'.'):'This code expired. Resend email for a new code.';let value=ownerText(seconds?'owner.codeTimeLeft':'owner.codeExpired',fallback);for(const [key,text] of Object.entries({email,minutes:Math.ceil((seconds||0)/60)}))value=value.replaceAll('{'+key+'}',String(text));$('verifyText').textContent=value;const submit=$('verifyForm').querySelector?.('button[type="submit"]');if(submit)submit.disabled=verificationBusy||seconds===0;if(seconds===0)$('verifyMessage').textContent=ownerText('owner.codeExpired','This code expired. Resend email for a new code.');}
 if((remaining||seconds>0)&&$('verification').open){const generation=verificationGeneration;verificationResendTimer=setTimeout(()=>{if(generation===verificationGeneration&&$('verification').open)renderVerificationResend();},1000);}
}
function setVerificationBusy(on){verificationBusy=on;busy($('verification'),on,true);renderVerificationResend();}
function currentVerification(generation,id){return verificationGeneration===generation&&verificationPageGeneration===sitePageGeneration&&verificationId===id&&$('verification').open;}
function invalidateOwnerVerification(){verificationGeneration++;verificationId=null;verificationResendDeadline=0;setVerificationBusy(false);if($('verification').open)$('verification').close();renderPendingOwnerVerification();}
function verify(result,resume=false){if(!resume)rememberOwnerVerification(result);verificationGeneration++;verificationPageGeneration=sitePageGeneration;verificationResendDeadline=ownerPendingVerification?.resend_at??Date.now()+60000;setVerificationBusy(false);verificationId=result.verification_id;$('verifyMessage').textContent='';$('verifyForm').reset();changeEmailForm.reset();changeEmailForm.hidden=true;changeEmailButton.hidden=result.verification_purpose!=='registration';if(!$('verification').open)$('verification').showModal();renderVerificationResend();}
window.addEventListener?.('app-language-changed',renderVerificationResend);
function registrationMessage(text){const target=$('registerMessage');if(!target){message(text);return;}target.textContent=text;let signin=$('duplicateStreamSignin');if(!signin){signin=document.createElement('button');signin.id='duplicateStreamSignin';signin.type='button';signin.className='secondary';signin.dataset.i18n='owner.signInStation';signin.textContent=ownerText('owner.signInStation','Sign in to your station');signin.onclick=()=>{$('openLogin').onclick();};target.after(signin);}signin.hidden=!text.includes('This stream already has a station.');if(text)target.focus();}
function loginMessage(text){const target=$('loginMessage');if(!target){message(text);return;}target.textContent=text;if(text)target.focus();}
function loadOwnerSession(){if(!ownerSessionPromise){const generation=ownerSessionGeneration;ownerSessionPromise=api('/api/session').then(result=>{if(generation===ownerSessionGeneration){state=result;if(result.pending_verification){if(ownerPendingVerification?.verification_id!==result.pending_verification.verification_id)rememberOwnerVerification(result.pending_verification);}else if(result.owner_station)clearPendingOwnerVerification();renderPendingOwnerVerification();window.dispatchEvent(new CustomEvent('owner-session-updated',{detail:result}));}return result;}).finally(()=>{ownerSessionPromise=null;});}return ownerSessionPromise;}
function clearOwnerSession(){ownerSessionGeneration++;if(state){state.owner_station=null;state.owner_expires=null;}window.dispatchEvent(new CustomEvent('owner-session-updated',{detail:{owner_station:null,owner_expires:null}}));}
function ownerAccountUnavailable(){page('ownerEntryLoading');const text=$('ownerEntryText');text.dataset.i18n='owner.accountUnavailable';text.textContent=ownerText('owner.accountUnavailable','Could not load your station. Tap Station account to try again.');$('ownerEntryLogout').hidden=false;}
async function ensureOwnerSession(){if(!state?.csrf||!state?.agreement_version||!state?.turnstile_site_key)await loadOwnerSession();if(!state?.csrf||!state?.agreement_version||!state?.turnstile_site_key)throw new Error('Website setup is not ready. Please refresh and try again.');}
async function registrationRequest(data,current=()=>true){const fingerprint=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify(data))))).map(byte=>byte.toString(16).padStart(2,'0')).join('');if(!current())return '';if(fingerprint!==registrationRequestFingerprint){registrationRequestFingerprint=fingerprint;registrationRequestId=crypto.randomUUID().replaceAll('-','');}return registrationRequestId;}
function ownerAccessSuccess(result){$('stationSuccessTitle').textContent=result.registration_completed?(result.stream_check_required?'Stream test required':result.review_required?'Waiting for review':'Station added'):'Signed in';$('stationSuccessText').textContent=result.registration_completed?'Station code #'+result.station_code+'.'+(result.stream_check_required?' Test your stream before saving changes.':''):'You can edit your station.';if($('stationSuccessMessage'))$('stationSuccessMessage').textContent='';if($('retryOwnerEditor'))$('retryOwnerEditor').hidden=true;if(!$('stationSuccess').open)$('stationSuccess').showModal();}
function ownerEditorUnavailable(result,error){ownerAccessSuccess(result);if($('stationSuccessMessage'))$('stationSuccessMessage').textContent='The station editor could not load. Your verification succeeded. Please try opening the editor again.';else message(error.message);if($('retryOwnerEditor'))$('retryOwnerEditor').hidden=false;}
function applyOwnerStation(station,preserveDraft=false,metadataOptions){
 state.owner_station=station.code;page('editor');const form=$('editForm'),sameStation=form.dataset.stationCode===String(station.code),keepDraft=preserveDraft&&sameStation&&!!(form.dataset.dirty||form.elements.artwork.files[0]),stale=keepDraft&&station.revision&&form.dataset.revision&&station.revision!==form.dataset.revision;
 ownerEditFeedback(stale?ownerText('owner.conflict','This station changed elsewhere. Your edits are kept. Review the latest saved version before saving again.'):'',false,stale);
 $('ownerName').textContent=station.name;if(!keepDraft||!form.elements.artwork.files[0])showOwnerCover(station.artwork_url);
 $('ownerStatus').textContent='Station code #'+station.code+' · '+station.status.replaceAll('_',' ')+(station.review_pending?' · '+(station.status==='published'?ownerText('owner.pendingEdit','Changes waiting for review. Your last approved station stays live.'):ownerText('owner.pendingEditPrivate','Changes waiting for review. Your station is not published yet.')):'');
 const account=$('ownerAccountOptions');if(account){let email=$('ownerAccountEmail');if(!email){email=document.createElement('p');email.id='ownerAccountEmail';email.className='owner-private-email';account.querySelector('summary')?.after(email);}email.textContent=ownerText('owner.privateRegisteredEmail','Registered email (private):')+' '+String(station.contact_email||'');email.hidden=!station.contact_email;}
 if(!keepDraft){form.elements.name.value=station.name;form.elements.stream_url.value=station.stream_url;form.elements.bio.value=station.bio;form.elements.artwork.value='';delete form.dataset.dirty;form.dataset.revision=station.revision||'';}
 form.dataset.stationCode=String(station.code);window.syncOwnerStationMetadata?.(station,{preserveDraft:keepDraft,metadataOptions});if(!keepDraft)window.syncOwnerStreamSetup?.({accepted:true});window.syncOwnerStreamSaveGate?.(station);window.renderOwnerStreamPublication?.(station);window.syncOwnerEditorState?.(station,{preserveDraft:keepDraft});
}
function applyOwnerExpiry(result){if(!Number.isInteger(result.owner_expires))return;if(state){state.owner_expires=result.owner_expires;if(Number.isInteger(result.server_time))state.server_time=result.server_time;}const event=new Event('owner-session-updated');event.detail={...result,...(state?{owner_station:state.owner_station}:{})};window.dispatchEvent(event);}
async function editor(preserveDraft=false,generation=sitePageGeneration){const ownerGeneration=ownerSessionGeneration;try{const result=await api('/api/owner/station');if(generation!==sitePageGeneration||ownerGeneration!==ownerSessionGeneration)return false;applyOwnerExpiry(result);applyOwnerStation(result.station,preserveDraft,result.metadata_options);return true;}catch(error){if(error.status===401&&generation===sitePageGeneration&&ownerGeneration===ownerSessionGeneration)clearOwnerSession();throw error;}}
function ownerEntryHistory(id,replace=false){const url=id==='register'?'/create-station':'/station-edit',canPush=typeof history.pushState==='function';if(canPush&&!replace&&!history.state?.radioLocalsApp){const current=['login','register','editor','ownerEntryLoading'].find(key=>$(key)&&!$(key).hidden);if(current)history.replaceState({...history.state,radioLocalsApp:{page:current}},'');}const snapshot={...history.state,radioLocalsApp:{page:id}};(replace||history.state?.radioLocalsApp?.page===id||!canPush?history.replaceState:history.pushState).call(history,snapshot,'',url);}
$('openLogin').onclick=()=>{if(window.ownerAccountNavigation?.active())return $('navAdd').onclick();ownerEntryHistory('login');page('login');$('signInTab').focus({preventScroll:true});};$('openRegister').onclick=()=>{if(window.ownerAccountNavigation?.active())return $('navAdd').onclick();ownerEntryHistory('register');page('register');$('createStationTab').focus({preventScroll:true});};$('navAdd').onclick=async()=>{const generation=++sitePageGeneration;ownerEntryHistory(window.ownerAccountNavigation?.active()?'editor':'register');try{await window.loadAppFeature?.('owner');if(generation!==sitePageGeneration)return;await loadOwnerSession();if(generation!==sitePageGeneration)return;if(window.ownerAccountNavigation?.active()){ownerEntryHistory('editor',true);await editor(true,generation);}else page('register');}catch(e){if(generation===sitePageGeneration){if(e.status===401){ownerEntryHistory('login',true);page('login');}else if(window.ownerAccountNavigation?.active())ownerAccountUnavailable();message(e.message);}}};$('navLibrary').onclick=()=>{page('library');history.replaceState(null,'','/'+location.search+'#radio');};$('closeVerify').onclick=()=>{if(!verificationBusy)$('verification').close();};
$('verification').addEventListener('cancel',event=>{if(verificationBusy)event.preventDefault();});
$('verification').addEventListener('close',()=>{if(!$('verification').open)invalidateOwnerVerification();});
$('registerForm').addEventListener('reset',()=>{registrationRequestFingerprint='';registrationRequestId='';registrationMessage('');});
$('registerForm').onsubmit=async event=>{
 event.preventDefault();const form=event.target;if(formIsBusy(form))return;if(window.prepareRegistrationStationMetadata&&!window.prepareRegistrationStationMetadata())return;if(typeof window.prepareRegistrationStream!=='function'||typeof window.registrationStreamSaveAllowed!=='function'){registrationMessage('Stream checking is not ready. Refresh and try again.');return;}if(!window.prepareRegistrationStream()||!window.registrationStreamSaveAllowed(true))return;registrationMessage('');const data=Object.fromEntries(new FormData(form)),artworkFile=form.elements.artwork.files[0];delete data.stream_provider;data.rights_confirmed=form.elements.rights_confirmed.checked;const attempt=beginOwnerAccess(form),current=()=>currentOwnerAccess(attempt);
 try{if(window.validateRegistrationLogo&&!await window.validateRegistrationLogo(artworkFile))throw new Error(form.elements.artwork.validationMessage||'Choose a valid station logo.');if(!current())return;await ensureOwnerSession();if(!current())return;data.agreement_version=state.agreement_version;data.artwork=await fileData(artworkFile);if(!current())return;data.request_id=await registrationRequest(data,current);if(!current())return;data.turnstile_token=await human($('registrationHuman'),'station-submit',attempt.controller.signal);if(!current())return;const result=await api('/api/owner/register',data);if(current())verify({...result,verification_purpose:'registration'});}
 catch(e){if(current()){if(e.status===428)window.invalidateRegistrationStreamSaveGate?.();registrationMessage(e.message);}}finally{finishOwnerAccess(attempt);}
};
$('loginForm').onsubmit=async event=>{event.preventDefault();const form=event.target;if(formIsBusy(form))return;loginMessage('');const data=Object.fromEntries(new FormData(form));data.code=normalizeOwnerStationCode(data.code);const attempt=beginOwnerAccess(form),current=()=>currentOwnerAccess(attempt);try{await ensureOwnerSession();if(!current())return;data.turnstile_token=await human(form,'station-access',attempt.controller.signal);if(!current())return;const result=await api('/api/owner/login',data);if(current())verify(result);}catch(e){if(current())loginMessage(e.message);}finally{finishOwnerAccess(attempt);}};
$('verifyForm').onsubmit=async event=>{
 event.preventDefault();if(verificationBusy||!verificationId||!$('verification').open)return;if(ownerPendingVerification?.expires_at<=Date.now()){renderVerificationResend();return;}const form=event.target,generation=verificationGeneration,id=verificationId,code=form.elements.code.value;setVerificationBusy(true);
 try{const result=await api('/api/owner/verify',{verification_id:id,code});if(!currentVerification(generation,id))return;const view=sitePageGeneration;setVerificationBusy(false);clearPendingOwnerVerification();$('verification').close();ownerSessionGeneration++;if(state)state.owner_station=result.station_code;applyOwnerExpiry(result);if(result.registration_completed){$('registerForm').reset();delete $('registerForm').dataset.dirty;ownerAccessSuccess(result);if(typeof refreshStationDirectory==='function')void refreshStationDirectory(true);}try{if(await editor(!result.registration_completed,view)!==false&&!result.registration_completed)message(result.message);}catch(e){if(view===sitePageGeneration)ownerEditorUnavailable(result,e);}}
 catch(e){if(currentVerification(generation,id)){let recovered=false;if(e.status===undefined||e.status>=500||e.status===400){try{const pending=ownerPendingVerification,snapshot=await api('/api/session');if(!currentVerification(generation,id))return;if(snapshot.owner_station&&(!pending?.station_code||String(snapshot.owner_station)===pending.station_code)&&Number(snapshot.owner_expires)>Number(snapshot.server_time||Date.now()/1000)&&!snapshot.pending_verification){const view=sitePageGeneration;state=snapshot;ownerSessionGeneration++;setVerificationBusy(false);clearPendingOwnerVerification();$('verification').close();window.dispatchEvent(new CustomEvent('owner-session-updated',{detail:snapshot}));if(pending?.verification_purpose==='registration'){$('registerForm').reset();delete $('registerForm').dataset.dirty;if(typeof refreshStationDirectory==='function')void refreshStationDirectory(true);}try{await editor(pending?.verification_purpose!=='registration',view);recovered=true;}catch(error){if(view===sitePageGeneration)ownerEditorUnavailable({station_code:snapshot.owner_station,registration_completed:pending?.verification_purpose==='registration'},error);recovered=true;}}}catch{}}if(!recovered&&currentVerification(generation,id))$('verifyMessage').textContent=e.message;}}finally{if(verificationGeneration===generation)setVerificationBusy(false);}
};
$('resend').onclick=async()=>{if(verificationBusy||!verificationId||!$('verification').open||Date.now()<verificationResendDeadline)return;const generation=verificationGeneration,id=verificationId;setVerificationBusy(true);try{const token=await human($('verification'),'verification-resend');if(!currentVerification(generation,id))return;const result=await api('/api/owner/resend',{verification_id:id,turnstile_token:token});if(!currentVerification(generation,id))return;rememberOwnerVerification({...result,verification_purpose:result.verification_purpose||ownerPendingVerification?.verification_purpose});verificationId=result.verification_id;verificationResendDeadline=Date.now()+60000;$('verifyForm').reset();$('verifyMessage').textContent=ownerText('owner.codeResent','A new code has been requested. Use only the newest email code.');}catch(e){if(currentVerification(generation,id))$('verifyMessage').textContent=e.message;}finally{if(verificationGeneration===generation)setVerificationBusy(false);}};
if($('retryOwnerEditor'))$('retryOwnerEditor').onclick=async()=>{const button=$('retryOwnerEditor');if(button.disabled)return;button.disabled=true;try{await editor(true);$('stationSuccess').close();}catch(e){if($('stationSuccessMessage'))$('stationSuccessMessage').textContent='The station editor could not load. Check your connection and try again.';else message(e.message);}finally{button.disabled=false;}};
function ownerText(key,fallback){const text=window.appI18n?.t(key);return typeof text==='string'&&text!==key?text:fallback;}
let ownerLogoutBusy=false;
function ownerEditFeedback(text='',reauth=false,conflict=false){
 if(reauth)clearOwnerSession();
 const notice=$('ownerEditMessage'),action=$('ownerSignInAgain'),review=$('ownerReviewLatest');if(action)action.hidden=!reauth;if(review)review.hidden=!conflict;
 if(!notice){if(text)message(text);return;}notice.textContent=text;notice.hidden=!text;if(text)notice.focus();
}
if($('ownerSignInAgain'))$('ownerSignInAgain').onclick=()=>{
 const form=$('editForm');if(ownerLogoutBusy||formIsBusy(form)||$('editor').hidden)return;
 const code=String(form.dataset.stationCode||'');clearOwnerSession();ownerEntryHistory('login');page('login');if(/^[0-9]{2,6}$/.test(code))$('loginForm').elements.code.value=code;
 loginMessage(ownerText('owner.signInContinue','Sign in again to keep editing. Your unsaved changes are kept in this tab.'));
};
if($('ownerReviewLatest'))$('ownerReviewLatest').onclick=async()=>{
 const form=$('editForm'),button=$('ownerReviewLatest');if(formIsBusy(form)||ownerLogoutBusy||button.disabled||$('editor').hidden)return;const generation=sitePageGeneration;button.disabled=true;busy(form,true,true);
 try{
  const result=await api('/api/owner/station');if(generation!==sitePageGeneration)return;
  const station=result.station,categoryLabel=result.metadata_options?.categories?.find(option=>option.value===station.category)?.label||station.category||'—',summary=ownerText('owner.latestName','Latest station name:')+'\n'+String(station.name).toLocaleUpperCase()+'\n\n'+ownerText('owner.latestStream','Latest stream URL:')+'\n'+station.stream_url+'\n\n'+ownerText('owner.latestBio','Latest bio:')+'\n'+(station.bio||'—')+'\n\n'+ownerText('owner.latestZip','Latest ZIP code:')+'\n'+(station.zip_code||'—')+'\n\n'+ownerText('owner.latestCategory','Latest category:')+'\n'+ownerText('metadata.category.'+station.category,categoryLabel)+'\n\n'+ownerText('owner.latestLogo','Latest station logo:')+' '+(station.artwork_url?ownerText('owner.logoBelow','Preview below.'):ownerText('owner.noLogo','No logo.'))+'\n\n'+ownerText('owner.replaceDraft','Using this version replaces your unsaved edits and selected cover art.');
  let preview;const dialog=$('listenerActionDialog');if(station.artwork_url&&dialog?.append){preview=document.createElement('img');preview.src=station.artwork_url;preview.alt=ownerText('owner.latestLogo','Latest station logo:');preview.width=96;preview.height=96;preview.style.cssText='display:block;object-fit:contain;max-width:100%;margin:12px auto';const actions=dialog.querySelector?.('.listener-dialog-actions');if(actions?.before)actions.before(preview);else dialog.append(preview);}
  try{if(await listenerActionDialog(ownerText('owner.reviewLatest','Review latest version'),summary,ownerText('owner.useLatest','Use latest version'),true)&&generation===sitePageGeneration)applyOwnerStation(station,false,result.metadata_options);}finally{preview?.remove();}
 }catch(error){if(generation===sitePageGeneration)ownerEditFeedback(error.message,false,true);}
 finally{button.disabled=false;busy(form,false);}
};
function ownerRefreshFeedback(failed,text=''){
 const notice=$('ownerSaveRefreshStatus'),retry=$('ownerSaveRefreshRetry');
 if(notice){notice.hidden=!failed;notice.textContent=failed?text||ownerText('owner.savedRefreshFailed','Your changes were saved. The editor could not refresh. Try Refresh editor.'):'';}
 if(retry)retry.hidden=!failed;
}
function ownerChangesSaved(text,refreshFailed=false){
 if(text==='No changes to save.'){window.renderOwnerEditorState?.();message('');return;}
 const saved=text==='Changes saved for safety review.'?ownerText('owner.review',text):text==='Changes saved successfully.'?ownerText('owner.saved',text):text||ownerText('owner.saved','Changes saved successfully.'),feedback=refreshFailed?ownerText('owner.savedRefreshFailed','Your changes were saved. The editor could not refresh. Try Refresh editor.'):'',dialog=$('ownerSaveSuccess');
 if(!dialog||document.hidden||$('editor').hidden||document.querySelector?.('dialog[open]')){message(saved+(feedback?' '+feedback:''));return;}
 if($('ownerSaveSuccessTitle')){$('ownerSaveSuccessTitle').dataset.i18n='owner.savedTitle';$('ownerSaveSuccessTitle').textContent=ownerText('owner.savedTitle','Changes saved');}
 $('ownerSaveSuccessText').textContent=saved+(feedback?' '+feedback:'');message('');dialog.showModal();$('ownerSaveSuccessDone').focus({preventScroll:true});
}
if($('ownerSaveSuccessDone'))$('ownerSaveSuccessDone').onclick=()=>$('ownerSaveSuccess').close();
if($('ownerSaveRefreshRetry'))$('ownerSaveRefreshRetry').onclick=async()=>{
 const form=$('editForm'),retry=$('ownerSaveRefreshRetry');if(formIsBusy(form)||retry.disabled||$('editor').hidden)return;
 const generation=sitePageGeneration;retry.disabled=true;busy(form,true,true);
 try{if(await editor(true,generation)!==false){ownerRefreshFeedback(false);message('');}}
 catch(e){if(generation===sitePageGeneration)ownerRefreshFeedback(true,ownerText('owner.refreshFailed','The editor could not refresh. Please try again.'));}
 finally{retry.disabled=false;busy(form,false);}
};
let ownerCoverObjectUrl,ownerCoverGeneration=0,ownerSavedCoverUrl='',ownerCoverPreviewFile;
function ownerCoverRetryState(failed=false){const retry=$('retryOwnerCover');if(retry){retry.disabled=false;retry.hidden=!failed||!(ownerCoverObjectUrl||ownerSavedCoverUrl);}}
function clearOwnerCoverUrl(){if(ownerCoverObjectUrl){URL.revokeObjectURL(ownerCoverObjectUrl);ownerCoverObjectUrl=null;}ownerCoverPreviewFile=null;}
function renderOwnerSavedCover(){const image=$('ownerCover'),empty=$('ownerCoverEmpty');ownerCoverRetryState();empty.textContent='No cover art uploaded yet';image.hidden=!ownerSavedCoverUrl;empty.hidden=!!ownerSavedCoverUrl;if(ownerSavedCoverUrl)image.src=ownerSavedCoverUrl;else image.removeAttribute('src');}
function ownerArtworkNotice(text='',key=''){const notice=$('ownerArtworkMessage');if(!notice)return;notice.hidden=!text;notice.textContent=text;notice.dataset.state=text?(key==='owner.checkingArtwork'?'checking':'invalid'):'';if(key)notice.dataset.i18n=key;else delete notice.dataset.i18n;}
function showOwnerCover(url){ownerCoverGeneration++;ownerSavedCoverUrl=url||'';clearOwnerCoverUrl();renderOwnerSavedCover();$('editForm').elements.artwork.setCustomValidity?.('');ownerArtworkNotice();}
async function validateOwnerArtwork(file,{preview=false,focus=false}={}){
 if(!file)return true;const input=$('editForm').elements.artwork,generation=ownerCoverGeneration;
 ownerArtworkNotice(ownerText('owner.checkingArtwork','Checking cover art…'),'owner.checkingArtwork');
 let result;try{if(typeof window.inspectStationLogo!=='function')throw Error('Artwork inspection unavailable');result=await window.inspectStationLogo(file);}
 catch{result={valid:false,key:'owner.artworkCheckUnavailable',message:'Cover art could not be checked. Please refresh and try again.'};}
 if(generation!==ownerCoverGeneration||input.files[0]!==file)return false;
 if(!result.valid){input.value='';input.setCustomValidity?.('');clearOwnerCoverUrl();renderOwnerSavedCover();const text=ownerText(result.key,result.message);ownerArtworkNotice(text,result.key);window.renderOwnerEditorState?.();if(focus)$('ownerArtworkMessage')?.focus();return false;}
 input.setCustomValidity?.('');ownerArtworkNotice();
 if(preview&&ownerCoverPreviewFile!==file){clearOwnerCoverUrl();ownerCoverObjectUrl=URL.createObjectURL(file);ownerCoverPreviewFile=file;$('ownerCover').src=ownerCoverObjectUrl;$('ownerCover').hidden=false;$('ownerCoverEmpty').hidden=true;}
 return true;
}
$('ownerCover').onerror=()=>{$('ownerCover').hidden=true;$('ownerCoverEmpty').hidden=false;$('ownerCoverEmpty').textContent=ownerText('owner.imageLoadFailed','Cover art could not load. Try Retry image.');ownerCoverRetryState(true);};
$('ownerCover').onload=()=>{$('ownerCover').hidden=false;$('ownerCoverEmpty').hidden=true;ownerCoverRetryState();};
if($('retryOwnerCover'))$('retryOwnerCover').onclick=()=>{const button=$('retryOwnerCover'),source=ownerCoverObjectUrl||ownerSavedCoverUrl;if(button.disabled||!source||$('editor').hidden)return;button.disabled=true;$('ownerCover').src=source;};
$('editForm').elements.artwork.onchange=async event=>{ownerCoverGeneration++;clearOwnerCoverUrl();renderOwnerSavedCover();ownerArtworkNotice();const file=event.target.files[0];if(file)await validateOwnerArtwork(file,{preview:true});};
const keepOwnerCover=document.createElement('button');keepOwnerCover.id='keepOwnerCover';keepOwnerCover.type='button';keepOwnerCover.className='secondary owner-keep-cover';keepOwnerCover.textContent='Keep current logo';keepOwnerCover.hidden=true;$('editForm').elements.artwork.after(keepOwnerCover);function renderKeepOwnerCover(){keepOwnerCover.hidden=!$('editForm').elements.artwork.files[0];}keepOwnerCover.onclick=()=>{const input=$('editForm').elements.artwork;if(formIsBusy($('editForm')))return;ownerCoverGeneration++;input.value='';input.setCustomValidity('');clearOwnerCoverUrl();renderOwnerSavedCover();ownerArtworkNotice();renderKeepOwnerCover();input.dispatchEvent(new Event('input',{bubbles:true}));input.dispatchEvent(new Event('change',{bubbles:true}));window.renderOwnerEditorState?.();};$('editForm').elements.artwork.addEventListener('change',renderKeepOwnerCover);$('editForm').addEventListener('reset',()=>queueMicrotask(renderKeepOwnerCover));
window.addEventListener?.('pagehide',()=>{ownerCoverGeneration++;clearOwnerCoverUrl();});
$('editForm').onsubmit=async event=>{
 event.preventDefault();const form=event.target;if(formIsBusy(form)||ownerLogoutBusy)return;
 if(window.prepareOwnerStreamSetup&&!window.prepareOwnerStreamSetup())return;
 if(window.prepareOwnerStationMetadata&&!window.prepareOwnerStationMetadata())return;
 if(typeof window.ownerStreamSaveAllowed!=='function'){ownerEditFeedback('Stream checking is not ready. Refresh and try again.');return;}if(!window.ownerStreamSaveAllowed(true))return;
 if(window.ownerEditorSaveAllowed&&!window.ownerEditorSaveAllowed())return;
 const name=form.elements.name.value.trim();if(!name||/[\x00-\x1f\x7f]/.test(name)||new TextEncoder().encode(name).length>96){ownerEditFeedback(!name?ownerText('owner.nameRequired','Enter a station name.'):ownerText('owner.nameTooLong','Shorten the station name so it fits on the radio.'));form.elements.name.focus();return;}form.elements.name.value=name;
 const generation=sitePageGeneration,data={revision:form.dataset.revision,name,stream_url:form.elements.stream_url.value,bio:form.elements.bio.value,...window.metadataSaveValues?.()},artwork=form.elements.artwork.files[0];ownerEditFeedback('');busy(form,true,true);const retry=$('ownerSaveRefreshRetry');if(retry)retry.disabled=true;
 try{
  if(artwork&&!await validateOwnerArtwork(artwork,{focus:true}))return;
  if(generation!==sitePageGeneration)return;
  data.artwork=await fileData(artwork);if(generation!==sitePageGeneration)return;const result=await api('/api/owner/station',data);if(typeof refreshStationDirectory==='function')void refreshStationDirectory(true);if(generation!==sitePageGeneration)return;
  delete form.dataset.dirty;form.elements.artwork.value='';window.ownerEditorSaved?.({...data,code:form.dataset.stationCode},result);ownerRefreshFeedback(false);
  // The write has completed. A failed read afterwards must not turn it into a
  // failed save or make the owner repeat a committed update.
  try{if(await editor(false,generation)!==false)ownerChangesSaved(result.message);}
  catch{if(generation===sitePageGeneration){ownerRefreshFeedback(true);ownerChangesSaved(result.message,true);}}
 }catch(e){if(generation===sitePageGeneration){if(e.status===428)window.invalidateOwnerStreamSaveGate?.();ownerEditFeedback(e.status===401?ownerText('owner.signInExpired','Your sign-in expired. Sign in again to save your changes. Your edits are kept in this tab.'):e.status===409?ownerText('owner.conflict','This station changed elsewhere. Your edits are kept. Review the latest saved version before saving again.'):e.message,e.status===401,e.status===409);}}
 finally{if(retry)retry.disabled=false;busy(form,false);}
};
$('logout').onclick=async()=>{
 const form=$('editForm'),button=$('logout');if(ownerLogoutBusy||formIsBusy(form))return;ownerLogoutBusy=true;button.disabled=true;
 const view=sitePageGeneration,current=()=>view===sitePageGeneration;
 try{
  if((form.dataset.ownerChanged===undefined?form.dataset.dirty:form.dataset.ownerChanged==='true')||form.elements.artwork.files[0]){if(!await listenerActionDialog(ownerText('owner.discardTitle','Discard unsaved changes?'),ownerText('owner.discardText','Your unsaved station changes will be lost.'),ownerText('owner.discardLogout','Discard and log out'),true)||!current())return;}
  busy(form,true,true);await api('/api/owner/logout',{});clearPendingOwnerVerification();clearOwnerSession();form.reset();delete form.dataset.dirty;delete form.dataset.stationCode;delete form.dataset.revision;showOwnerCover('');ownerEditFeedback('');ownerRefreshFeedback(false);if(current()){ownerEntryHistory('register',true);page('register');}
 }catch(e){if(current()){if($('ownerEntryLoading')&&!$('ownerEntryLoading').hidden)message(e.message);else ownerEditFeedback(e.message);}}
 finally{ownerLogoutBusy=false;button.disabled=false;busy(form,false);}
};
if($('ownerEntryLogout'))$('ownerEntryLogout').onclick=()=>$('logout').onclick();
initializeOwnerFlowUI();
function list(){}

// Refresh the public directory without discarding usable cards during a failed request.
let stationDirectoryRequest=null,stationDirectoryGeneration=0,stationDirectoryLastAttempt=0,stationDirectoryStarted=false,stationDirectoryTimer=null;
const stationDirectoryMetadata=new Map(),stationDirectoryState={query:'',zip_code:'',category:'',loadedQuery:'',loadedZipCode:'',loadedCategory:'',loading:false,hasMore:false,cursor:null,expanded:false,failed:false};
let stationDirectoryCatalog=null;
function normalizeStationDirectoryQuery(value){return String(value||'').slice(0,96).trim().replace(/^#\s*(?=\d)/,'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/\s+/g,' ');}
function readStationDirectoryState(){return {...stationDirectoryState};}
function readStationDirectoryCatalog(){return stationDirectoryCatalog;}
function stationDirectorySelectionLoaded(){return stationDirectoryState.loadedQuery===stationDirectoryState.query&&stationDirectoryState.loadedZipCode===stationDirectoryState.zip_code&&stationDirectoryState.loadedCategory===stationDirectoryState.category;}
function getStationDirectoryStation(code){return stationDirectoryMetadata.get(String(code));}
function stationDirectoryControls(){
 window.stationDirectoryFilters?.syncStatus?.();
 const button=$('loadMoreStations');if(!button)return;
 button.hidden=!stationDirectoryState.hasMore;button.disabled=stationDirectoryState.loading;
 const key=stationDirectoryState.loading?'directory.loading':'directory.more',fallback=stationDirectoryState.loading?'Loading stations…':'More stations',translated=window.appI18n?.t(key);
 button.textContent=translated&&translated!==key?translated:fallback;button.setAttribute?.('data-i18n',key);
}
function stationDirectoryNotice(text){const host=$('stationDirectoryStatus'),notice=$('stationDirectoryMessage');if(host&&notice){host.hidden=!text;notice.textContent=text;}else if(text)message(text);}
function requestStationDirectory(append=false,preserveLoaded=false){
 if(stationDirectoryTimer!==null){clearTimeout(stationDirectoryTimer);stationDirectoryTimer=null;}
 stationDirectoryRequest?.controller.abort();
 const generation=++stationDirectoryGeneration,query=stationDirectoryState.query,zip_code=stationDirectoryState.zip_code,category=stationDirectoryState.category,controller=new AbortController(),previous=stations,wasExpanded=preserveLoaded&&stationDirectoryState.expanded,targetCount=wasExpanded?Math.max(1,previous.length):1,moreFocused=append&&document.activeElement===$('loadMoreStations');let receivedCodes=[],catalog=null;
 stationDirectoryStarted=true;stationDirectoryLastAttempt=Date.now();stationDirectoryState.loading=true;stationDirectoryState.failed=false;stationDirectoryControls();
 if(append||!stationDirectorySelectionLoaded())list();
 const promise=(async()=>{
  try{
   const collected=[],seenCursors=new Set();let cursor=append?stationDirectoryState.cursor:null,hasMore=false;
   // Sparse searches can scan several bounded server pages without asking the
   // visitor to repeatedly press More. Never scan an unbounded directory.
   for(let page=0;page<(wasExpanded?Math.max(5,Math.ceil(targetCount/50)+5):5);page++){
    if(cursor)seenCursors.add(cursor);
    const path='/api/stations?limit=50&q='+encodeURIComponent(query)+(zip_code?'&zip_code='+encodeURIComponent(zip_code):'')+(category?'&category='+encodeURIComponent(category):'')+(cursor?'&cursor='+encodeURIComponent(cursor):''),result=await api(path,undefined,{cache:'no-store',signal:controller.signal});
    if(generation!==stationDirectoryGeneration||controller.signal.aborted)return stations;
    if(!Array.isArray(result.stations)||result.stations.length>50)throw new Error('Station list unavailable.');
    collected.push(...result.stations);hasMore=result.has_more===true;if(result.metadata_options&&result.facets)catalog={metadata_options:result.metadata_options,facets:result.facets,zip_code:result.zip_code,zip_location_known:result.zip_location_known,zip_radius_miles:result.zip_radius_miles};
    const next=hasMore?result.next_cursor:null;
    if(hasMore&&(typeof next!=='string'||!next||next.length>4096||seenCursors.has(next)))throw new Error('Station list unavailable.');
    cursor=next;if(!hasMore||collected.length>=targetCount)break;
   }
   const unique=new Map();for(const station of [...(append?previous:[]),...collected]){const code=String(station.listener_code??station.code??'');if(!code)continue;unique.set(code,station);stationDirectoryMetadata.set(code,station);}
   receivedCodes=collected.map(station=>String(station.listener_code??station.code??'')).filter(code=>!previous.some(station=>String(station.listener_code??station.code??'')===code));
   stations=[...unique.values()];stationDirectoryState.loadedQuery=query;stationDirectoryState.loadedZipCode=zip_code;stationDirectoryState.loadedCategory=category;stationDirectoryState.cursor=cursor;stationDirectoryState.hasMore=hasMore;stationDirectoryState.expanded=append||wasExpanded;
   if(catalog){stationDirectoryCatalog=catalog;window.stationDirectoryFilters?.updateCatalog(catalog);}
   stationDirectoryNotice('');return stations;
  }
  catch(e){if(generation===stationDirectoryGeneration&&!controller.signal.aborted){stationDirectoryState.failed=true;stationDirectoryNotice(previous.length&&stationDirectorySelectionLoaded()?'Could not update stations. Showing the last loaded list. Check your connection and try again.':'Stations could not load. Check your connection and try again.');}return stations;}
  finally{if(generation===stationDirectoryGeneration){stationDirectoryState.loading=false;stationDirectoryControls();list();window.onStationDirectoryComplete?.({query,zip_code,category,append,moreFocused,receivedCodes,failed:stationDirectoryState.failed,hasMore:stationDirectoryState.hasMore});}if(stationDirectoryRequest?.generation===generation)stationDirectoryRequest=null;}
 })();
 stationDirectoryRequest={generation,promise,controller};return promise;
}
function refreshStationDirectory(force=false){
 if(!force&&stationDirectoryRequest)return stationDirectoryRequest.promise;
 if(!force&&stationDirectoryTimer!==null)return Promise.resolve(stations);
 if(!force&&stationDirectoryStarted&&Date.now()-stationDirectoryLastAttempt<30000)return Promise.resolve(stations);
 return requestStationDirectory(false,true);
}
function searchStationDirectory(value){
 const query=normalizeStationDirectoryQuery(value);if(query===stationDirectoryState.query){list();return;}
 if(stationDirectoryTimer!==null)clearTimeout(stationDirectoryTimer);
 stationDirectoryGeneration++;stationDirectoryRequest?.controller.abort();stationDirectoryRequest=null;
 stationDirectoryState.query=query;stationDirectoryState.loading=true;stationDirectoryState.hasMore=false;stationDirectoryState.cursor=null;stationDirectoryState.expanded=false;stationDirectoryState.failed=false;
 stationDirectoryNotice('');stationDirectoryControls();list();
 stationDirectoryTimer=setTimeout(()=>{stationDirectoryTimer=null;void requestStationDirectory();},250);
}
function applyStationDirectoryFilters(filters={}){
 if(filters.zip_code!=null&&typeof filters.zip_code!=='string')return Promise.resolve(stations);
 const zip_code=typeof filters.zip_code==='string'?filters.zip_code.trim():'',category=['christian','news_talk','music','culture','other'].includes(filters.category)?filters.category:'';
 if(zip_code&&!/^[0-9]{5}$/.test(zip_code))return Promise.resolve(stations);
 if(zip_code===stationDirectoryState.zip_code&&category===stationDirectoryState.category)return Promise.resolve(stations);
 // A filter change supersedes any pending search/page and never reuses its cursor.
 if(stationDirectoryTimer!==null){clearTimeout(stationDirectoryTimer);stationDirectoryTimer=null;}
 stationDirectoryState.zip_code=zip_code;stationDirectoryState.category=category;stationDirectoryState.hasMore=false;stationDirectoryState.cursor=null;stationDirectoryState.expanded=false;stationDirectoryState.failed=false;
 stationDirectoryNotice('');return requestStationDirectory();
}
function loadMoreStationDirectory(){
 if(stationDirectoryRequest)return stationDirectoryRequest.promise;
 if(!stationDirectoryState.hasMore||!stationDirectoryState.cursor)return Promise.resolve(stations);
 return requestStationDirectory(true);
}
if($('retryStationDirectory'))$('retryStationDirectory').onclick=()=>refreshStationDirectory(true);
if($('loadMoreStations'))$('loadMoreStations').onclick=loadMoreStationDirectory;
window.addEventListener('app-language-changed',stationDirectoryControls);
window.addEventListener('radio-status-updated',()=>{if($('myRadio')&&!$('myRadio').hidden)void refreshStationDirectory();});
window.addEventListener('online',()=>{if($('myRadio')&&!$('myRadio').hidden)void refreshStationDirectory(true);});

async function loadSupport(){
 await window.loadAppFeature?.('support');
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
 track.hidden=!track.children.length;window.dispatchEvent(new Event('support-guides-ready'));
}

async function showLegal(kind){
 const generation=++sitePageGeneration;
 try{
  const response=await fetch('/assets/policies.json');if(!response.ok)throw new Error('Policy page is unavailable.');const policies=await response.json();if(generation!==sitePageGeneration||!policies[kind])return false;
  page('legal');$('legalMessage').textContent='';$('legalTitle').textContent=policies[kind][0];$('legalBody').innerHTML=policies[kind][1];const form=$('legalForm');form.hidden=kind==='terms';form.elements.kind.value=kind;const privacy=kind==='privacy';$('privacyMessage').hidden=!privacy;$('copyrightFields').hidden=privacy;form.elements.message.required=privacy;for(const name of ['address','phone','work','location','signature','good_faith','authority'])form.elements[name].required=!privacy;const counter=kind==='counter-notice';$('goodFaithText').textContent=counter?'Under penalty of perjury, I have a good-faith belief that removal or disabling resulted from a mistake or misidentification.':'I have a good-faith belief that the use is not authorized by the copyright owner, its agent, or the law.';$('authorityText').textContent=counter?'I consent to the jurisdiction of the federal district court for my address, or if outside the United States, any judicial district where the service provider may be found, and will accept service of process from the original claimant or its agent.':'The information is accurate, and under penalty of perjury I am authorized to act for the owner of the exclusive right allegedly infringed.';return true;
 }catch(error){if(generation!==sitePageGeneration)return false;throw error;}
}
$('legalForm').onsubmit=async event=>{
 event.preventDefault();const form=event.target;if(formIsBusy(form))return;const generation=sitePageGeneration,body=Object.fromEntries(new FormData(form));body.good_faith=form.elements.good_faith.checked;body.authority=form.elements.authority.checked;busy(form,true,true);
 try{body.turnstile_token=await human(form,'legal-request');if(generation!==sitePageGeneration)return;const result=await api('/api/legal/request',body);if(generation!==sitePageGeneration)return;$('legalMessage').textContent=result.message+' Reference: '+result.reference;form.hidden=true;}catch(e){if(generation===sitePageGeneration)$('legalMessage').textContent=e.message;}finally{busy(form,false);}
};
async function initCommunity(){const path=location.pathname;if(path==='/'&&!location.hash){page('library');}if(['/device','/support'].includes(path)){page('support');await loadSupport();}if(['/terms','/privacy','/copyright','/counter-notice'].includes(path))await showLegal(path.slice(1));}
let sharedCode,shareRunning=false;
let adminVerification,adminMfaId;
async function adminList(){
 const result=await api('/api/admin/stations');$('adminLogin').hidden=true;$('adminVerify').hidden=true;$('adminStations').hidden=false;$('adminLogout').hidden=false;$('adminStations').replaceChildren();
 for(const station of result.stations){
  const card=document.createElement('article');card.style.borderTop='1px solid #bbc';card.style.padding='12px 0';const title=document.createElement('h2');title.textContent=station.name+' · #'+station.code;card.append(title);
  const details=document.createElement('p');details.textContent=station.status.replaceAll('_',' ')+' · '+station.contact_email;card.append(details);
  function content(value,label){const heading=document.createElement('h3');heading.textContent=label;const name=document.createElement('p');name.textContent=value.name;const bio=document.createElement('p');bio.textContent=value.bio;const stream=document.createElement('p');stream.textContent=value.stream_url;stream.style.overflowWrap='anywhere';card.append(heading,name,bio,stream);if(value.artwork_key){const image=document.createElement('img');image.src='/api/admin/artwork/'+value.artwork_key;image.alt=label+' cover art';image.width=120;image.height=120;image.style.objectFit='contain';card.append(image);}}
  content(station,station.status==='published'?'Currently published':'Current station');if(station.pending_edit)content(station.pending_edit,'Proposed changes — awaiting review');
  const streamStatus=document.createElement('p');streamStatus.textContent=station.stream_check?.status==='passed'?'Stream check passed.':station.stream_check?.status==='review_requested'?'Stream check not confirmed. Owner requested review.':'Stream check not confirmed. Manual review is required to approve.';card.append(streamStatus);
  for(const action of ['approve','reject_edit','reject','delete']){
   if(action==='approve'&&(!station.email_verified_at||station.status==='suspended'||(!station.pending_edit&&station.status!=='pending_review')))continue;if(action==='reject_edit'&&!station.pending_edit)continue;
   const button=document.createElement('button');button.textContent={approve:station.pending_edit?'Approve changes':'Approve',reject_edit:'Reject changes',reject:'Suspend station',delete:'Delete station'}[action];button.style.margin='6px';
   button.onclick=async()=>{
    if(button.disabled)return;const view=sitePageGeneration;button.disabled=true;let reason='',streamOverride=false;
    try{
     if(['reject_edit','reject','delete'].includes(action)){const entered=await appPrompt(button.textContent+' '+String(station.name).toLocaleUpperCase(),'Short reason for the owner (no links or private information):',{required:action!=='delete',maxLength:300,confirmText:button.textContent,danger:action!=='reject_edit'});if(entered===null)return;reason=entered.trim();if(action!=='delete'&&!reason){$('adminMessage').textContent='Enter a short reason for the owner.';return;}}
     else if(station.stream_check?.status!=='passed'){const entered=await appPrompt('Review stream before publishing','The automatic stream check has not passed. Manually verify this exact stream, then enter your review reason to approve it.',{required:true,maxLength:300,confirmText:'Approve reviewed stream'});if(entered===null||!entered.trim())return;reason=entered.trim();streamOverride=true;}
     else if(!await appConfirm(button.textContent+' '+String(station.name).toLocaleUpperCase(),station.pending_edit?'Publish these reviewed changes?':'Publish this reviewed station?',{confirmText:button.textContent}))return;
     if(view!==sitePageGeneration||$('admin').hidden)return;
     const changed=await api('/api/admin/station',{code:station.code,revision:station.revision,action,reason,stream_override:streamOverride});void refreshStationDirectory(true);if(view!==sitePageGeneration||$('admin').hidden)return;await adminList();$('adminMessage').textContent=changed.notification_queued?'Station updated. Owner notification queued.':'Station updated.';window.dispatchEvent(new Event('admin-data-changed'));
    }catch(e){if(view===sitePageGeneration&&!$('admin').hidden)$('adminMessage').textContent=e.message;}finally{button.disabled=false;}
   };card.append(button);
  }
  window.aiAdmin?.mountReview({host:card,type:'station',id:station.code,isActive:()=>!$('admin').hidden&&card.isConnected});
  $('adminStations').append(card);
 }
 if(!result.stations.length)$('adminStations').textContent='No stations yet.';
}
for(const input of [$('adminVerify').elements.code,$('adminMfa').elements.authenticator_code,$('deleteVerifyForm').elements.code]){input.removeAttribute('maxlength');input.addEventListener('input',()=>{input.value=input.value.replace(/\s/g,'');});input.addEventListener('paste',event=>{const value=event.clipboardData?.getData('text');if(typeof value==='string'&&/^\s*\d(?:\s*\d){5}\s*$/.test(value)){event.preventDefault();input.value=value.replace(/\s/g,'');input.dispatchEvent(new Event('input',{bubbles:true}));}});}
$('adminLogin').onsubmit=async event=>{event.preventDefault();const form=event.target;busy(form,true);try{const turnstile_token=await human(form,'admin-login');const result=await api('/api/admin/login',{email:form.elements.email.value,turnstile_token});adminVerification=result.verification_id;$('adminMessage').textContent=result.message;form.hidden=true;$('adminVerify').hidden=false;}catch(e){$('adminMessage').textContent=e.message;}finally{busy(form,false);}};
$('adminVerify').onsubmit=async event=>{event.preventDefault();const form=event.target;busy(form,true);try{const result=await api('/api/admin/verify',{verification_id:adminVerification,code:form.elements.code.value});adminMfaId=result.mfa_id;form.reset();form.hidden=true;$('adminMfa').hidden=false;$('adminMfa').elements.authenticator_code.focus();$('adminMessage').textContent='Email verified. Enter your authenticator code.';}catch(e){$('adminMessage').textContent=e.message;}finally{busy(form,false);}};
$('adminMfa').onsubmit=async event=>{event.preventDefault();const form=event.target;busy(form,true);try{await api('/api/admin/mfa',{mfa_id:adminMfaId,authenticator_code:form.elements.authenticator_code.value});$('adminMessage').textContent='';form.reset();form.hidden=true;await adminList();}catch(e){$('adminMessage').textContent=e.message;}finally{busy(form,false);}};
$('adminLogout').onclick=async()=>{try{await api('/api/admin/logout',{});$('adminStations').replaceChildren();$('adminStations').hidden=true;$('adminLogout').hidden=true;$('adminLogin').hidden=false;$('adminMessage').textContent='Signed out.';}catch(e){$('adminMessage').textContent=e.message;}};
let deleteVerificationId,deleteGeneration=0,deleteCodeBusy=false,deleteCommitBusy=false;
function invalidateStationDeletion(){deleteGeneration++;deleteVerificationId=null;if($('deleteVerification').open)$('deleteVerification').close();}
function currentStationDeletion(generation,id,view){return generation===deleteGeneration&&id===deleteVerificationId&&view===sitePageGeneration&&!$('editor').hidden&&$('deleteVerification').open;}
$('deleteStation').onclick=async()=>{
 const button=$('deleteStation');if(deleteCodeBusy||deleteCommitBusy||button.disabled||$('editor').hidden||$('deleteVerification').open||formIsBusy($('editForm')))return;
 const view=sitePageGeneration,generation=++deleteGeneration;deleteCodeBusy=true;button.disabled=true;const restore=setBusyButtonLabel(button,'sending');
 try{const result=await api('/api/owner/delete',{});if(view!==sitePageGeneration||generation!==deleteGeneration||$('editor').hidden)return;deleteVerificationId=result.verification_id;$('deleteVerifyForm').reset();delete $('deleteVerifyMessage').dataset.i18n;$('deleteVerifyMessage').textContent='';$('deleteVerification').showModal();$('deleteVerifyForm').elements.code.focus();}
 catch(e){if(view===sitePageGeneration&&generation===deleteGeneration&&!$('editor').hidden)message(e.message);}
 finally{deleteCodeBusy=false;button.disabled=false;restore();}
};
$('cancelDelete').onclick=()=>{if(!deleteCommitBusy)$('deleteVerification').close();};
$('deleteVerification').addEventListener('cancel',event=>{if(deleteCommitBusy)event.preventDefault();});
$('deleteVerification').addEventListener('close',()=>{if(!$('deleteVerification').open){deleteGeneration++;deleteVerificationId=null;}});
$('deleteVerifyForm').onsubmit=async event=>{
 event.preventDefault();const form=event.target;if(deleteCommitBusy||formIsBusy(form)||!deleteVerificationId||!$('deleteVerification').open||$('editor').hidden)return;
 const id=deleteVerificationId,generation=deleteGeneration,view=sitePageGeneration,code=form.elements.code.value,targetStation=String(state?.owner_station||$('editForm').dataset.stationCode||'');
 deleteCommitBusy=true;busy(form,true,true,'deleting');$('cancelDelete').disabled=true;$('deleteVerifyMessage').dataset.i18n='delete.deleting';$('deleteVerifyMessage').textContent=ownerText('delete.deleting','Deleting station…');
 try{
  await api('/api/owner/delete',{confirm:true,verification_id:id,code});void refreshStationDirectory(true);
  if(String(state?.owner_station||'')===targetStation)clearOwnerSession();
  if(currentStationDeletion(generation,id,view)){$('deleteVerification').close();page('register');message('Station removed from the directory.');}
 }catch(e){if(currentStationDeletion(generation,id,view)){delete $('deleteVerifyMessage').dataset.i18n;$('deleteVerifyMessage').textContent=e.status>=400&&e.status<500?e.message:ownerText('delete.uncertain','Could not confirm deletion. Check your station before trying again.');}}
 finally{deleteCommitBusy=false;$('cancelDelete').disabled=false;busy(form,false);}
};

let sharedOpenGeneration=0;
let sharedPairingAttempt=null,sharedPairingCancellation=Promise.resolve();
function cancelSharedPairingRequest(attempt,generation){
 if(!attempt?.dispatched||attempt.approved||attempt.cancellationStarted)return;attempt.cancellationStarted=true;
 const previous=sharedPairingCancellation;
 sharedPairingCancellation=Promise.all([previous,trackPairingCleanup(api('/api/phone/claim/cancel',{request_id:attempt.requestId}).then(result=>{if(result.state!=='cancelled')throw Error('Cancellation not confirmed');}).catch(()=>{
  if(generation===sharedOpenGeneration&&!shareRunning&&!$('shared').hidden&&!$('shareForm').hidden)setSharedStatus('Could not confirm cancellation. Tap Deny on your radio if the request is still showing.','error');
 }))]).then(()=>undefined);
}
function abandonSharedPairing(generation){const attempt=sharedPairingAttempt;sharedPairingAttempt=null;attempt?.controller.abort();cancelSharedPairingRequest(attempt,generation);}
function waitForSharedPairingCleanup(){return Promise.all([sharedPairingCancellation,typeof radioPairingCancellation==='undefined'?Promise.resolve():radioPairingCancellation]);}
function setSharedSavedState(saved){$('shareSavedNotice').hidden=!saved;$('shareSubmit').textContent=saved?'Add again':'Add station';}
function renderSharedRadioAvailability(offline){
 $('shareForm').dataset.radioOffline=offline?'1':'';$('shareSubmit').hidden=offline;$('shareWifiHelp').hidden=!offline;
 if(offline)setSharedStatus('Radio offline. Check power and Wi-Fi.','error');return offline;
}
function renderSharedWaitButton(){const close=$('stationAddPopup')?.querySelector?.('.station-popup-close');if(close)close.textContent=shareRunning?'Stop waiting':'Close';}
function setSharedStatus(text,kind='progress'){const target=$('shareStatus');target.dataset.status=kind;target.textContent=text;renderSharedWaitButton();}
const stationDeliveries=new Map(),stationDeliveryNotices=new Map();
function renderStationDeliveryStatus(){
 window.dispatchEvent(new Event('station-delivery-changed'));
 const host=$('stationDeliveryStatus');if(!host)return;
 const selected=typeof readSelectedRadio==='function'?String(readSelectedRadio()):null,active=[...stationDeliveries.values()].filter(record=>selected===null||record.radioId===selected),latest=active[active.length-1],completed=selected===null?[...stationDeliveryNotices.values()].at(-1):stationDeliveryNotices.get(selected),notice=latest?{name:latest.name,message:latest.state==='sending'?'Sending station request…':latest.state==='pending'?'Adding station…':'Your radio has not confirmed yet. Check it before trying again.',kind:latest.state==='unconfirmed'?'error':'progress'}:completed&&completed.expires>Date.now()?completed:null;
 host.hidden=!notice;host.dataset.status=notice?.kind||'progress';
 if(!notice){host.replaceChildren();return;}
 const name=document.createElement('span');name.dataset.i18nSkip='1';name.textContent=notice.name+' — ';
 const message=document.createElement('span');message.textContent=notice.message;host.replaceChildren(name,message);
}
function finishStationDelivery(record,state,message){
 record.state=state;record.message=message;
 if(state!=='unconfirmed'){
  stationDeliveries.delete(record.key);const notice={radioId:record.radioId,name:record.name,message,kind:state==='added'?'success':'error',expires:Date.now()+8000};stationDeliveryNotices.set(record.radioId,notice);
  setTimeout(()=>{if(stationDeliveryNotices.get(record.radioId)===notice&&Date.now()>=notice.expires){stationDeliveryNotices.delete(record.radioId);renderStationDeliveryStatus();}},8000);
 }
 if(state==='added')void Promise.resolve().then(()=>refreshRadioInventory(record.radioId)).catch(()=>{});
 renderStationDeliveryStatus();return {state,message};
}
// All pending additions share one paced status lane (at most 24 reads/minute),
// rather than each radio consuming the session's 40-read allowance independently.
let stationCommandStatusQueue=Promise.resolve();
function readStationDeliveryStatus(record){
 const request=stationCommandStatusQueue.catch(()=>{}).then(async()=>{
  let throttles=0;
  for(;;){
   await delay();
   try{return await api('/api/phone/command/status',{command_id:record.commandId});}
   catch(error){if(error?.status!==429||++throttles>3||Date.now()>=record.deadline)throw error;await new Promise(resolve=>setTimeout(resolve,Math.max(1000,Math.min(60000,(error.retry_after||60)*1000))));}
  }
 });
 stationCommandStatusQueue=request.catch(()=>{});return request;
}
async function monitorStationDelivery(record){
 record.state='pending';renderStationDeliveryStatus();
 try{
  do{const result=await readStationDeliveryStatus(record);
   if(result.state==='added')return finishStationDelivery(record,'added','Station added');
   if(['failed','expired'].includes(result.state))return finishStationDelivery(record,'failed','Station could not be added. Check your radio and try again.');
  }while(Date.now()<record.deadline);
 }catch{}
 return finishStationDelivery(record,'unconfirmed','Your radio has not confirmed yet. Check it before trying again.');
}
function requestStationDelivery(radioId,stationCode,name){
 const key=String(radioId)+'|'+String(stationCode),previous=stationDeliveries.get(key);
 if(previous){if(previous.state==='unconfirmed'){previous.deadline=Date.now()+300000;previous.promise=previous.commandId?monitorStationDelivery(previous):sendStationDelivery(previous);}return previous.promise;}
 const record={key,radioId:String(radioId),stationCode:String(stationCode),name:String(name||'Station').slice(0,120),state:'sending',requestId:crypto.randomUUID().replaceAll('-',''),commandId:'',deadline:0,promise:null};stationDeliveries.set(key,record);renderStationDeliveryStatus();
 record.promise=sendStationDelivery(record);return record.promise;
}
function sendStationDelivery(record){
 record.state='sending';renderStationDeliveryStatus();
 return (async()=>{
  try{const command=await api('/api/phone/add',{radio_id:record.radioId,station_code:record.stationCode,request_id:record.requestId});if(!command.command_id)throw Error('Missing command');record.commandId=command.command_id;record.deadline=Date.now()+300000;if(command.state==='added')return finishStationDelivery(record,'added','Station added');if(['failed','expired'].includes(command.state))return finishStationDelivery(record,'failed','Station could not be added. Check your radio and try again.');return await monitorStationDelivery(record);}
  catch(error){const rejected=error.status>=400&&error.status<500;return finishStationDelivery(record,rejected?'failed':'unconfirmed',rejected?error.message:'Your radio has not confirmed yet. Check it before trying again.');}
 })();
}
window.addEventListener('radio-selection-changed',renderStationDeliveryStatus);
let sharedOfflineRadios=new Set(),sharedLinkedRadios=[];
function setSharedAdvertising(station){const link=$('shareAdvertise');if(!link)return;const code=String(station?.listener_code||''),valid=/^[1-9][0-9]{1,5}$/.test(code);link.hidden=!valid;if(valid)link.setAttribute('href','/advertise/'+code);else link.removeAttribute('href');}
if($('shareAdvertise'))$('shareAdvertise').onclick=event=>{if(shareRunning||$('shared').dataset.adding==='1'||$('shared').hidden||$('shareAdvertise').hidden)event.preventDefault();};
function renderSharedRadioDestination(){
 const enteringCode=!$('deviceLabel').hidden,single=!enteringCode&&sharedLinkedRadios.length===1;
 $('radioLabel').hidden=enteringCode||sharedLinkedRadios.length<2;
 $('shareSingleRadio').hidden=!single;
 $('shareSingleRadioCode').textContent=single?String(sharedLinkedRadios[0].device_code||'—'):'';
}
function invalidateSharedView(){sharedOpenGeneration++;abandonSharedPairing(sharedOpenGeneration);delete $('shared').dataset.adding;delete $('shareForm').dataset.destinationLoading;if(shareRunning){shareRunning=false;busy($('shareForm'),false);}$('shareSubmit').disabled=false;renderSharedRadioAvailability(false);setSharedSavedState(false);setSharedStatus('');}
function stopWaitingForSharedStation(){invalidateSharedView();renderStationDeliveryStatus();}
async function openShared(code,inPopup=false,autoAdd=false,onStationLoaded){
 const generation=++sharedOpenGeneration;
 setSharedAdvertising(null);
 $('reportStationProblem').hidden=true;
 // A new station must never inherit an earlier popup's destination while the
 // current phone grants and inventory are still being checked.
 $('shareForm').hidden=true;$('otherRadio').hidden=true;$('shareForm').dataset.destinationLoading='1';$('shareSubmit').disabled=true;
 $('shareForm').elements.radio_id.value='';$('shareForm').elements.radio_id.replaceChildren();sharedLinkedRadios=[];sharedOfflineRadios=new Set();$('shareSingleRadio').hidden=true;$('radioLabel').hidden=true;
 abandonSharedPairing(generation);
 try{
 const station=await api('/api/stations/'+code);if(generation!==sharedOpenGeneration)return;sharedCode=code;
 if(!inPopup)page('shared');$('shared').hidden=false;renderSharedRadioAvailability(false);setSharedSavedState(false);setSharedStatus('Checking radio destination…');$('shareArt').hidden=true;$('shareName').textContent=station.name;$('shareStationCode').textContent='Station code #'+station.listener_code;$('shareStationBio').textContent=(station.bio||'').slice(0,250);$('shareStationBio').hidden=!station.bio;
 setSharedAdvertising(station);
 $('reportStationProblem').hidden=false;
 if(station.logo_url){$('shareArt').src=station.logo_url;$('shareArt').hidden=false;}
 if(typeof onStationLoaded==='function')onStationLoaded(station);
 const result=await api('/api/phone/radios');if(generation!==sharedOpenGeneration)return;
 const select=$('shareForm').elements.radio_id,selected=reconcileSelectedRadio(result.radios);sharedLinkedRadios=result.radios;sharedOfflineRadios=new Set(result.radios.filter(r=>r.online===false).map(r=>String(r.id)));select.replaceChildren();
 if(result.radios.length>1){const placeholder=document.createElement('option');placeholder.value='';placeholder.textContent='Choose a radio';placeholder.disabled=true;select.append(placeholder);}
 for(const radio of result.radios){const option=document.createElement('option');option.value=String(radio.id);option.textContent='Device code '+(radio.device_code||'—')+(radio.online?' · Online':' · Offline');select.append(option);}
 select.value=selected;select.required=!!result.radios.length;$('shareForm').elements.device_code.required=!result.radios.length;$('deviceLabel').hidden=!!result.radios.length;$('otherRadio').hidden=!result.radios.length;renderSharedRadioDestination();
 $('shareForm').hidden=false;
 // Only an intentional tile tap can start an addition. Restored history and
 // incoming shared URLs must wait for the visitor to press Add station.
 const canAutoAdd=autoAdd&&selected&&!sharedOfflineRadios.has(String(selected));renderSharedRadioAvailability(!!selected&&sharedOfflineRadios.has(String(selected)));
 const alreadySaved=await updateStationConfirmation();if(generation!==sharedOpenGeneration)return;
 delete $('shareForm').dataset.destinationLoading;$('shareForm').hidden=false;$('shareSubmit').disabled=false;
 if(canAutoAdd&&selected===select.value&&alreadySaved===false&&!sharedOfflineRadios.has(String(selected)))await submitSharedStation($('shareForm'));
 }catch(error){if(generation===sharedOpenGeneration)throw error;}
}
$('otherRadio').onclick=()=>{invalidateSharedView();$('deviceLabel').hidden=false;renderSharedRadioDestination();$('otherRadio').hidden=true;$('shareForm').elements.radio_id.required=false;$('shareForm').elements.device_code.required=true;$('shareForm').elements.device_code.focus();};
window.addEventListener('radio-status-updated',event=>{
 if($('shared').hidden||$('shareForm').hidden||shareRunning||!$('deviceLabel').hidden||!Array.isArray(event.detail?.radios))return;
 const id=String($('shareForm').elements.radio_id.value),radio=event.detail.radios.find(item=>String(item.id)===id);if(!radio)return;
 const wasOffline=sharedOfflineRadios.has(id);if(radio.online)sharedOfflineRadios.delete(id);else sharedOfflineRadios.add(id);
 if(!radio.online)renderSharedRadioAvailability(true);else if(wasOffline){renderSharedRadioAvailability(false);void updateStationConfirmation();}
});
const delay=()=>new Promise(resolve=>setTimeout(resolve,2500));
async function submitSharedStation(form){
 if(shareRunning||form.dataset.destinationLoading==='1')return;const enteringCode=!$('deviceLabel').hidden,deviceCode=enteringCode?window.validateDeviceCodeInput(form.elements.device_code):'';if(enteringCode&&deviceCode===null)return;
 const attempt=enteringCode?{requestId:crypto.randomUUID().replaceAll('-',''),controller:new AbortController(),dispatched:false,approved:false,cancellationStarted:false}:null;if(attempt)sharedPairingAttempt=attempt;
 shareRunning=true;const stationCode=sharedCode,generation=sharedOpenGeneration,current=()=>generation===sharedOpenGeneration&&!$('shared').hidden;busy(form,true,true);$('shared').dataset.adding='1';$('shareWifiHelp').hidden=true;setSharedStatus('Adding station…');
 try{
  let radioId=form.elements.radio_id.value,radioLabel=form.elements.radio_id.selectedOptions[0]?.textContent.split(' · ')[0]||'your linked radio';
  if(enteringCode){
   await waitForSharedPairingCleanup();if(!current())return;
   const turnstile_token=await human(form,'radio-link',attempt.controller.signal);if(!current())return;await waitForSharedPairingCleanup();if(!current())return;attempt.dispatched=true;const claim=await api('/api/phone/claim',{device_code:deviceCode,turnstile_token,request_id:attempt.requestId});if(!current())return;
   showRadioApproval($('shareStatus'),claim.confirmation_code);
   const result=await pollPhoneApproval(claim.claim_id,{current,deadline:Date.now()+180000,signal:attempt.controller.signal});if(!result||!current())return;
   if(result.state!=='approved')throw Error(phoneApprovalMessage(result.state));radioId=result.radio_id;attempt.approved=true;
   radioLabel='Device code '+deviceCode;sharedOfflineRadios.delete(String(radioId));rememberSelectedRadio(radioId);setSharedStatus('Adding station…');
   const select=form.elements.radio_id;if(![...select.options].some(option=>option.value===String(radioId))){const option=document.createElement('option');option.value=String(radioId);option.textContent=radioLabel;select.append(option);}select.value=String(radioId);select.required=true;form.elements.device_code.required=false;$('deviceLabel').hidden=true;if(!sharedLinkedRadios.some(r=>String(r.id)===String(radioId)))sharedLinkedRadios.push({id:String(radioId),device_code:deviceCode});renderSharedRadioDestination();$('otherRadio').hidden=false;
   if(!$('myRadio').hidden)loadMyRadios(true);
  }
  if(!radioId)throw new Error('Choose a radio to add this station.');rememberSelectedRadio(radioId);
  if(sharedOfflineRadios.has(String(radioId))){const radios=await api('/api/phone/radios');if(!current())return;const radio=radios.radios.find(r=>String(r.id)===String(radioId));if(!radio)throw new Error('Connect your radio again.');if(!radio.online){renderSharedRadioAvailability(true);return;}sharedOfflineRadios.delete(String(radioId));renderSharedRadioAvailability(false);}
  if(!current())return;
  // Delivery belongs to the dispatched command, not to this popup's lifetime.
  // Reopening the same station attaches to its existing request instead of sending twice.
  const delivery=await requestStationDelivery(radioId,stationCode,$('shareName').textContent);if(!current())return;
  if(delivery.state!=='added')throw Error(delivery.message);
  form.hidden=true;$('otherRadio').hidden=true;setSharedStatus('Station added','success');
  if(!document.hidden&&(!document.querySelector?.('dialog[open]')||$('stationAddPopup')?.open)){
   await listenerActionDialog('Station added','');
   if(current()&&typeof stationPopup!=='undefined'&&stationPopup.open)stationPopup.close();
  }
 }catch(e){if(current())setSharedStatus(e.message,'error');}
 finally{if(attempt){if(sharedPairingAttempt===attempt)sharedPairingAttempt=null;attempt.controller.abort();cancelSharedPairingRequest(attempt,generation);}if(generation===sharedOpenGeneration){shareRunning=false;delete $('shared').dataset.adding;busy(form,false);renderSharedWaitButton();}}
}
$('shareForm').onsubmit=event=>{event.preventDefault();return submitSharedStation(event.target);};
async function initializeSite(){
 const initialShared=location.pathname.match(/^\/station\/([0-9]{2,6})$/);
 const ownerEntry=['/create-station','/add-station','/station-edit'].includes(location.pathname)||location.hash==='#add-station';
 page(initialShared?'shared':ownerEntry?'ownerEntryLoading':location.pathname==='/wifi-setup'?'wifiSetup':location.hash==='#radio'?'myRadio':['/support','/device'].includes(location.pathname)?'support':location.pathname==='/admin'?'admin':'library');
 const entryGeneration=sitePageGeneration;
 if(initialShared){$('shareForm').hidden=true;$('otherRadio').hidden=true;$('shareArt').hidden=true;$('shareName').textContent='Loading station…';$('shareStationCode').textContent='';$('shareStationBio').textContent='';setSharedStatus('');}
  // The public catalogue owns its loading/error state. A slow catalogue must
  // not delay connecting a radio or opening another page's help form.
  void refreshStationDirectory().catch(()=>{});
  const bootstrapOwnerGeneration=ownerSessionGeneration,initial=await Promise.allSettled([loadOwnerSession()]);
 if(initial[0].status==='rejected'&&bootstrapOwnerGeneration===ownerSessionGeneration){state=undefined;if(entryGeneration===sitePageGeneration)message(initial[0].reason.message);}
 // Shared entry routes use helpers installed by later deferred scripts too.
 // Bootstrap requests and the correct loading page are already in progress.
 await siteOrderedScriptsReady;
 try{
  const route=location.pathname,feature=route==='/admin'?'admin':/^\/advertise\//.test(route)?'advertise':['/add-station','/create-station','/station-edit'].includes(route)||location.hash==='#add-station'?'owner':null;if(feature)await window.loadAppFeature?.(feature);
  const shared=location.pathname.match(/^\/station\/([0-9]{2,6})$/);if(shared)await openShared(shared[1]);
  if(initial[0].status==='fulfilled'){
   if(ownerEntry&&entryGeneration===sitePageGeneration){if(window.ownerAccountNavigation?.active())await editor(true,entryGeneration);else page(location.pathname==='/station-edit'?'login':'register');}
   if(location.pathname==='/admin'){page('admin');try{await adminList();}catch{}}
  }
 }catch(e){if(!ownerEntry||entryGeneration===sitePageGeneration){if(ownerEntry){if(e.status===401)page('login');else if(window.ownerAccountNavigation?.active())ownerAccountUnavailable();else page(location.pathname==='/station-edit'?'login':'register');}message(e.message);}}
 if(ownerEntry&&entryGeneration===sitePageGeneration&&initial[0].status==='rejected'){page(location.pathname==='/station-edit'?'login':'register');message(initial[0].reason.message);}
 try{await initCommunity();}catch(e){message(e.message);}
 finally{await siteOrderedScriptsReady;window.dispatchEvent(new Event('radio-locals-ready'));}
}
// This is the first deferred script. Fast network responses can otherwise
// announce readiness before the remaining deferred scripts install listeners.
// A single latch also handles network completion after DOMContentLoaded.
const siteOrderedScriptsReady=new Promise(resolve=>{
 const navigation=typeof performance!=='undefined'?performance.getEntriesByType?.('navigation')?.[0]:null;
 if(document.readyState==='complete'||navigation?.domContentLoadedEventStart>0){resolve();return;}
 document.addEventListener('DOMContentLoaded',resolve,{once:true});
 // Older browsers without navigation timing may already be interactive after
 // DOMContentLoaded. The final load event is a safe fallback without a timer.
 window.addEventListener?.('load',resolve,{once:true});
});
void initializeSite();

$('stationSuccessDone').onclick=()=>$('stationSuccess').close();

const supportFieldErrors=new WeakMap();
let supportContactProof=null,supportProofGeneration=0,supportProofDialog,supportProofCode,supportProofNotice,supportProofVerify,supportProofResend,supportProofForm,supportProofTimer,supportTicketCooldown=0,supportTicketCooldownEmail='',supportTicketCooldownTimer,supportProofResume;
function supportContactText(english,creole){return window.appI18n?.language==='ht'?creole:english;}
function supportProofNode(tag,text){const node=document.createElement(tag);if(text!==undefined)node.textContent=text;return node;}
function supportCurrentDraft(){const form=$('ticketForm');return JSON.stringify(['name','email','subject','message','device_code','station_code'].map(name=>{const value=String(form.elements[name]?.value||'').trim();return name==='email'?value.toLowerCase():value;}));}
function supportTicketSubmitButton(){return $('ticketForm').querySelector('button[type="submit"]')||[...$('ticketForm').querySelectorAll('button')].find(button=>button.type==='submit'||button.id==='ticket-submit');}
function renderSupportTicketCooldown(){
 clearTimeout(supportTicketCooldownTimer);const form=$('ticketForm'),button=supportTicketSubmitButton();if(supportTicketCooldownEmail&&String(form.elements.email.value||'').trim().toLowerCase()!==supportTicketCooldownEmail)supportTicketCooldown=0;
 const remaining=Math.max(0,Math.ceil((supportTicketCooldown-Date.now())/1000));if(remaining){if(button){if(button.dataset.supportCooldown!=='1'){button.supportCooldownDisabled=formBusyStates.get(form)?.controls.find(([control])=>control===button)?.[1]??button.disabled;button.dataset.supportCooldown='1';}button.disabled=true;button.textContent=supportContactText('Try again in ','Eseye ankò nan ')+remaining+supportContactText('s','s');}if(!document.hidden)supportTicketCooldownTimer=setTimeout(renderSupportTicketCooldown,1000);}
 else if(button?.dataset.supportCooldown==='1'){delete button.dataset.supportCooldown;button.disabled=!!button.supportCooldownDisabled||formIsBusy(form);button.textContent=supportContactText('Submit ticket','Voye demann');}
}
function supportTicketRetry(error,email){if(Number.isInteger(error.retry_after)&&error.retry_after>0&&error.retry_after<=86400){supportTicketCooldown=Date.now()+error.retry_after*1000;supportTicketCooldownEmail=email;renderSupportTicketCooldown();}}
function renderSupportProof(){
 clearTimeout(supportProofTimer);if(!supportContactProof||!supportProofDialog)return;
 const resend=Math.max(0,Math.ceil((supportContactProof.resendAt-Date.now())/1000)),wait=Math.max(0,Math.ceil((supportTicketCooldown-Date.now())/1000)),expired=Date.now()>=supportContactProof.expiresAt,busyProof=supportContactProof.busy;
 supportProofVerify.disabled=busyProof||expired||wait>0;supportProofResend.disabled=busyProof||expired||resend>0;supportProofCode.disabled=busyProof;
 supportProofVerify.textContent=wait?supportContactText('Try again in ','Eseye ankò nan ')+wait+'s':supportContactText('Verify and submit ticket','Verifye epi voye demann');supportProofResend.textContent=resend?supportContactText('Resend in ','Voye ankò nan ')+resend+'s':supportContactText('Resend email','Voye imèl ankò');
 if(expired)supportProofNotice.textContent=supportContactText('This code expired. Close and submit your saved draft again.','Kòd sa a ekspire. Fèmen epi voye bouyon ki anrejistre a ankò.');
 if(supportProofDialog.open&&!document.hidden&&(resend||wait)&&!expired)supportProofTimer=setTimeout(renderSupportProof,1000);
}
function closeSupportProof(clear=false){supportProofGeneration++;if(supportContactProof)supportContactProof.busy=false;if(supportProofCode)supportProofCode.value='';if(supportProofDialog?.open)supportProofDialog.close();clearTimeout(supportProofTimer);if(clear){supportContactProof=null;if(supportProofResume)supportProofResume.hidden=true;}renderSupportProof();}
function currentSupportProofDraft(){if(!supportContactProof)return false;if(supportContactProof.snapshot===supportCurrentDraft())return true;closeSupportProof(true);$('ticketMessage').textContent=supportContactText('Your draft changed. Submit it again to verify and send these details.','Bouyon ou chanje. Voye li ankò pou verifye epi voye enfòmasyon sa yo.');return false;}
function showSupportProof(){if(!currentSupportProofDraft()||$('support').hidden||document.hidden||document.querySelector('dialog[open]'))return;supportProofDialog.showModal();supportProofCode.focus();renderSupportProof();}
function ensureSupportProofUi(){
 if(supportProofDialog)return;supportProofDialog=supportProofNode('dialog');supportProofDialog.id='supportContactVerification';supportProofDialog.className='support-ticket-verification';supportProofDialog.setAttribute('aria-labelledby','supportContactVerifyTitle');const title=supportProofNode('h2',supportContactText('Verify your email','Verifye imèl ou'));title.id='supportContactVerifyTitle';
 const intro=supportProofNode('p',supportContactText('Enter the private email code. We verify this email once in this browser before your first ticket reaches support.','Antre kòd prive imèl la. Nou verifye imèl sa a yon fwa nan navigatè sa a anvan premye demann lan rive jwenn sipò.'));
 supportProofForm=supportProofNode('form');const label=supportProofNode('label',supportContactText('6-digit email code','Kòd imèl 6 chif'));supportProofCode=supportProofNode('input');supportProofCode.name='code';supportProofCode.inputMode='numeric';supportProofCode.autocomplete='one-time-code';supportProofCode.maxLength=32;supportProofCode.pattern='[0-9]{6}';supportProofCode.required=true;supportProofCode.addEventListener('input',()=>{supportProofCode.value=supportProofCode.value.replace(/\s/g,'');});label.append(supportProofCode);supportProofVerify=supportProofNode('button');supportProofVerify.type='submit';supportProofForm.append(label,supportProofVerify);
 const proofHuman=supportProofNode('div');proofHuman.className='human';supportProofForm.append(proofHuman);supportProofNotice=supportProofNode('p');supportProofNotice.setAttribute('role','status');supportProofResend=supportProofNode('button');supportProofResend.type='button';supportProofResend.className='secondary';const cancel=supportProofNode('button',supportContactText('Close','Fèmen'));cancel.type='button';cancel.className='secondary';cancel.onclick=()=>closeSupportProof();const change=supportProofNode('button',supportContactText('Change email','Chanje imèl'));change.type='button';change.className='link';change.onclick=()=>{closeSupportProof(true);$('ticketForm').elements.email.focus();};
 supportProofDialog.append(title,intro,supportProofForm,supportProofNotice,supportProofResend,change,cancel);document.body.append(supportProofDialog);
 supportProofResume=supportProofNode('button',supportContactText('Enter email code','Antre kòd imèl la'));supportProofResume.type='button';supportProofResume.className='secondary';supportProofResume.hidden=true;supportProofResume.onclick=showSupportProof;$('ticketMessage').after(supportProofResume);
 supportProofDialog.addEventListener('cancel',event=>{event.preventDefault();closeSupportProof();});supportProofDialog.addEventListener('close',()=>{if(supportContactProof?.busy)closeSupportProof();});
 new MutationObserver(()=>{if($('support').hidden&&supportProofDialog.open)closeSupportProof();}).observe($('support'),{attributes:true,attributeFilter:['hidden']});
 supportProofForm.onsubmit=async event=>{
  event.preventDefault();const proof=supportContactProof;if(!proof||proof.busy||!currentSupportProofDraft())return;if(Date.now()>=proof.expiresAt||supportTicketCooldown>Date.now()){renderSupportProof();return;}const code=supportProofCode.value.replace(/\s/g,'');if(!/^\d{6}$/.test(code)){supportProofNotice.textContent=supportContactText('Enter the 6-digit email code.','Antre kòd imèl 6 chif la.');return;}const generation=++supportProofGeneration;proof.busy=true;renderSupportProof();supportProofNotice.textContent='';
  try{const result=await api('/api/support/ticket/verify',{verification_id:proof.id,code});if(generation!==supportProofGeneration||supportContactProof!==proof||!supportProofDialog.open||$('support').hidden||!currentSupportProofDraft())return;if(!/^[a-f0-9]{32}$/.test(String(result.reference||'')))throw Error('Ticket confirmation was unavailable. Try again.');closeSupportProof(true);supportTicketAccepted(result,$('ticketForm'));}catch(error){if(generation===supportProofGeneration){supportProofNotice.textContent=error.message;supportTicketRetry(error,proof.email);}}finally{if(generation===supportProofGeneration){proof.busy=false;renderSupportProof();}}
 };
 supportProofResend.onclick=async()=>{
  const proof=supportContactProof;if(!proof||proof.busy||!currentSupportProofDraft())return;if(Date.now()<proof.resendAt||Date.now()>=proof.expiresAt){renderSupportProof();return;}const generation=++supportProofGeneration;proof.busy=true;renderSupportProof();supportProofNotice.textContent='';
  try{const turnstile_token=await human(supportProofForm,'support-ticket');if(generation!==supportProofGeneration||!supportProofDialog.open)return;const result=await api('/api/support/ticket/resend',{verification_id:proof.id,turnstile_token});if(generation!==supportProofGeneration||!supportProofDialog.open)return;proof.resendAt=Date.now()+Math.max(0,result.resend_after||60)*1000;proof.expiresAt=Date.now()+Math.max(0,result.expires_in||900)*1000;supportProofCode.value='';supportProofNotice.textContent=supportContactText('Use the newest email code.','Sèvi ak dènye kòd imèl la.');}catch(error){if(generation===supportProofGeneration){supportProofNotice.textContent=error.message;if(error.retry_after)proof.resendAt=Date.now()+error.retry_after*1000;}}finally{if(generation===supportProofGeneration){proof.busy=false;renderSupportProof();}}
 };
}
function supportTicketAccepted(result,form){
 if(!/^[a-f0-9]{32}$/.test(String(result.reference||'')))throw Error('Ticket confirmation was unavailable. Try again.');form.supportTicketRequest=null;form.reset();window.dispatchEvent(new CustomEvent('support-ticket-created',{detail:{reference:result.reference}}));$('ticketReference').textContent='Ticket reference: '+result.reference;$('ticketMessage').textContent=(result.duplicate?'Existing ticket. Reference: ':'Ticket sent. Reference: ')+result.reference;
 if(!$('support').hidden&&!document.hidden&&!document.querySelector('dialog[open]')){$('ticketSuccess').querySelector('h2').textContent=result.duplicate?'Existing support ticket':'Ticket sent';$('ticketSuccess').querySelector('p').hidden=true;$('ticketSuccess').showModal();}
}
$('ticketForm').elements.email.addEventListener('input',renderSupportTicketCooldown);document.addEventListener?.('visibilitychange',()=>{renderSupportTicketCooldown();renderSupportProof();});
function clearSupportFieldError(field){
 const state=supportFieldErrors.get(field);if(!state?.invalid)return;state.invalid=false;state.error.hidden=true;state.error.textContent='';
 const ids=(field.getAttribute('aria-describedby')||'').split(/\s+/).filter(id=>id&&id!==state.error.id);if(ids.length)field.setAttribute('aria-describedby',ids.join(' '));else if(state.description===null)field.removeAttribute('aria-describedby');else field.setAttribute('aria-describedby',state.description);
 if(field.getAttribute('aria-invalid')==='true'){if(state.previousInvalid===null)field.removeAttribute('aria-invalid');else field.setAttribute('aria-invalid',state.previousInvalid);}
}
function showSupportFieldError(field,key,fallback){
 let state=supportFieldErrors.get(field);
 if(!state){const error=document.createElement('span');error.id='supportFieldError-'+field.name;error.className='support-field-error';error.setAttribute('role','alert');error.hidden=true;(field.closest?.('label')||field).after(error);state={error,invalid:false};supportFieldErrors.set(field,state);field.addEventListener('input',()=>clearSupportFieldError(field));field.addEventListener('change',()=>clearSupportFieldError(field));field.form?.addEventListener('reset',()=>clearSupportFieldError(field));}
 if(!state.invalid){state.description=field.getAttribute('aria-describedby');state.previousInvalid=field.getAttribute('aria-invalid');}state.invalid=true;const text=window.appI18n?.t(key);state.error.dataset.i18n=key;state.error.textContent=text&&text!==key?text:fallback;state.error.hidden=false;field.setAttribute('aria-invalid','true');field.setAttribute('aria-describedby',[...new Set((field.getAttribute('aria-describedby')||'').split(/\s+/).filter(Boolean).concat(state.error.id))].join(' '));field.focus();
}
$('ticketForm').onsubmit=async event=>{
 event.preventDefault();const form=event.target;if(formIsBusy(form))return;if(supportTicketCooldown>Date.now()&&String(form.elements.email.value||'').trim().toLowerCase()===supportTicketCooldownEmail){renderSupportTicketCooldown();return;}
 // Capture every field before disabling it. A pending security check or send
 // must not accept a second submission or erase a newer, editable draft.
 const data=Object.fromEntries(new FormData(form));
 for(const [name,key,fallback] of [['name','support.enterName','Enter your name.'],['email','support.enterEmail','Enter your email.'],['subject','chooseSubject','Choose a subject'],['message','support.enterMessage','Enter a message.']]){if(typeof data[name]!=='string'||!data[name].trim()){showSupportFieldError(form.elements[name],key,fallback);return;}data[name]=data[name].trim();clearSupportFieldError(form.elements[name]);}
 data.email=data.email.toLowerCase();data.device_code=String(data.device_code||'').trim();data.station_code=String(data.station_code||'').trim();
 // Keep one private, in-memory request reference for the unchanged draft. A
 // lost response can be retried without creating another ticket or receipt.
 const snapshot=JSON.stringify(['name','email','subject','message','device_code','station_code'].map(name=>data[name]));
 if(form.supportTicketRequest?.snapshot!==snapshot)form.supportTicketRequest={snapshot,id:crypto.randomUUID().replaceAll('-','')};
 data.request_id=form.supportTicketRequest.id;busy(form,true,true);$('ticketMessage').textContent='';
 try{
  data.turnstile_token=await human(form,'support-ticket');const result=await api('/api/support/ticket',data);
  if(result.status==='verification_required'){if(!/^[a-f0-9]{32}$/.test(String(result.verification_id||'')))throw Error('Email verification was unavailable. Try again.');ensureSupportProofUi();supportContactProof={id:result.verification_id,email:data.email,snapshot,busy:false,resendAt:Date.now()+Math.max(0,result.resend_after||0)*1000,expiresAt:Date.now()+Math.min(900,Math.max(0,result.expires_in||900))*1000};supportProofResume.hidden=false;supportProofNotice.textContent='';$('ticketMessage').textContent=supportContactText('Verify your email to send this ticket. Your draft is kept.','Verifye imèl ou pou voye demann sa a. Bouyon ou rete la.');showSupportProof();}
  else{closeSupportProof(true);supportTicketAccepted(result,form);}
 }
 catch(e){$('ticketMessage').textContent=e.message;supportTicketRetry(e,data.email);}finally{busy(form,false);renderSupportTicketCooldown();}
};
$('closeTicketSuccess').onclick=()=>$('ticketSuccess').close();
