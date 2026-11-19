(()=>{
 'use strict';
 const panel=document.getElementById('advertise');if(!panel)return;
 const word=(en,ht)=>window.appI18n?.language==='ht'?ht:en;
 const node=(tag,text)=>{const item=document.createElement(tag);if(text)item.textContent=text;return item;};
 const details=node('details');details.id='advertiserStatus';details.className='advertiser-status';
 const summary=node('summary'),intro=node('p'),lookup=node('form'),referenceLabel=node('label'),reference=node('input'),emailLabel=node('label'),email=node('input'),check=node('button'),emailUpdates=node('button'),humanHost=node('div');
 reference.name='reference';reference.maxLength=32;reference.pattern='[a-f0-9]{32}';reference.required=true;reference.autocomplete='off';referenceLabel.append(reference);
 email.name='email';email.type='email';email.maxLength=254;email.autocomplete='email';emailLabel.append(email);check.type='submit';emailUpdates.type='button';emailUpdates.className='secondary';humanHost.className='human';lookup.append(referenceLabel,emailLabel,check,emailUpdates,humanHost);
 const result=node('section'),description=node('p'),schedule=node('p'),referenceText=node('p'),copy=node('button'),refresh=node('button'),stop=node('button');description.dataset.i18nSkip='1';result.hidden=true;copy.type=refresh.type=stop.type='button';copy.className=refresh.className=stop.className='secondary';referenceText.className='advertiser-reference';result.append(description,schedule,referenceText,copy,refresh,stop);
 const proof=node('form'),codeLabel=node('label'),code=node('input'),verify=node('button'),resend=node('button'),change=node('button');proof.hidden=true;code.name='code';code.inputMode='numeric';code.autocomplete='one-time-code';code.maxLength=32;code.pattern='[0-9]{6}';code.required=true;code.addEventListener('input',()=>{code.value=code.value.replace(/\s/g,'');});codeLabel.append(code);verify.type='submit';resend.type=change.type='button';resend.className=change.className='secondary';proof.append(codeLabel,verify,resend,change);
 const notice=node('p');notice.id='advertiserStatusNotice';notice.setAttribute('role','status');details.append(summary,intro,result,lookup,proof,notice);panel.append(details);
 let activeReference='',record=null,challenge=null,busy=false,generation=0,timer;
 function current(id){return id===generation&&!panel.hidden;}
 function labels(){
  summary.textContent=word('Check an advertisement','Tcheke yon piblisite');intro.textContent=word('Keep your reference. Verify your contact email to receive a receipt and decision updates.','Kenbe referans ou. Verifye imèl kontak ou pou resevwa resi ak nouvèl sou desizyon an.');
  for(const [label,input,text] of [[referenceLabel,reference,word('Advertisement reference','Referans piblisite')],[emailLabel,email,word('Contact email','Imèl kontak')],[codeLabel,code,word('6-digit email code','Kòd imèl 6 chif')]]){if(label.firstChild?.nodeType===3)label.firstChild.textContent=text;else label.prepend(document.createTextNode(text));}
  check.textContent=word('Check status','Tcheke estati');emailUpdates.textContent=word('Email me updates / recover access','Voye nouvèl pa imèl / reprann aksè');copy.textContent=word('Copy reference','Kopye referans');refresh.textContent=word('Refresh status','Rafrechi estati');stop.textContent=word('Stop email updates','Sispann nouvèl pa imèl');change.textContent=word('Change email','Chanje imèl');verify.textContent=word('Verify email','Verifye imèl');
  if(record)renderRecord(record);renderProof();
 }
 function renderRecord(value){
  record=value;activeReference=value.reference;reference.value=value.reference;result.hidden=false;details.open=true;
  const states={waiting_for_owner:word('Waiting for station-owner approval','Ap tann apwobasyon pwopriyetè estasyon an'),waiting_for_safety:word('Waiting for safety review','Ap tann egzamen sekirite'),scheduled:word('Approved · Scheduled','Apwouve · Pwograme'),approved:word('Approved','Apwouve'),removed:word('Removed','Retire'),expired:word('Expired','Ekspire')};
  description.textContent=(value.business?value.business+' · ':'')+(states[value.status]||word('Submitted','Voye'));referenceText.textContent=word('Reference: ','Referans: ')+value.reference;
  const date=stamp=>stamp?new Intl.DateTimeFormat(window.appI18n?.language==='ht'?'fr-HT':'en-US',{year:'numeric',month:'short',day:'numeric',timeZone:'UTC'}).format(new Date(stamp*1000)):'—';
  schedule.textContent=word('Starts ','Kòmanse ')+date(value.start_at)+' · '+word('Ends ','Fini ')+date(value.end_at)+' (UTC)';stop.hidden=!value.email_updates;
 }
 function renderProof(){
  clearTimeout(timer);if(!challenge)return;const left=Math.max(0,Math.ceil((challenge.expires-Date.now())/1000)),wait=Math.max(0,Math.ceil((challenge.resend-Date.now())/1000));
  code.disabled=busy||!left;verify.disabled=busy||!left;resend.disabled=busy||wait>0;resend.textContent=wait?word('Resend in ','Voye ankò nan ')+wait+'s':word('Send new code','Voye yon nouvo kòd');
  if(!left)notice.textContent=word('This code expired. Request a new code.','Kòd sa a ekspire. Mande yon nouvo kòd.');
  if(!proof.hidden&&!document.hidden&&(left||wait))timer=setTimeout(renderProof,1000);
 }
 function controls(){for(const form of [lookup,proof]){if(busy)form.dataset.busy='1';else delete form.dataset.busy;form.setAttribute('aria-busy',String(busy));}reference.disabled=email.disabled=busy;check.disabled=emailUpdates.disabled=refresh.disabled=stop.disabled=busy;renderProof();}
 function clearProof(){challenge=null;proof.hidden=true;code.value='';clearTimeout(timer);}
 async function readStatus(id,token){
  const value=await api('/api/ads/status?reference='+encodeURIComponent(id));if(current(token)){renderRecord(value);delete lookup.dataset.appUpdateDirty;notice.textContent='';}return value;
 }
 lookup.onsubmit=async event=>{
  event.preventDefault();if(busy)return;const id=reference.value.trim().toLowerCase();if(!/^[a-f0-9]{32}$/.test(id)){notice.textContent=word('Enter your 32-character advertisement reference.','Antre referans piblisite ou ki gen 32 karaktè.');return;}const token=++generation;busy=true;controls();
  try{await readStatus(id,token);}catch(error){if(current(token))notice.textContent=error.status===403?word('Enter the contact email and choose Email me updates / recover access.','Antre imèl kontak la epi chwazi Voye nouvèl pa imèl / reprann aksè.'):error.message;}finally{if(token===generation){busy=false;controls();}}
 };
 async function requestCode(){
  if(busy)return;const id=reference.value.trim().toLowerCase(),address=email.value.trim().toLowerCase();if(!/^[a-f0-9]{32}$/.test(id)){reference.reportValidity();return;}if(!address){notice.textContent=word('Enter the contact email used for this advertisement.','Antre imèl kontak ou te itilize pou piblisite sa a.');email.focus({preventScroll:true});return;}if(!email.checkValidity()){email.reportValidity();return;}const token=++generation;busy=true;controls();notice.textContent='';
  try{const turnstile_token=await human(lookup,'advertiser-status');if(!current(token))return;const response=await api('/api/ads/updates/request',{reference:id,email:address,turnstile_token});if(!current(token))return;challenge={id:response.verification_id,reference:id,expires:Date.now()+Math.min(900,response.expires_in||900)*1000,resend:Date.now()+(response.resend_after||60)*1000};proof.hidden=false;code.value='';notice.textContent=word('If the reference and email match, enter the private code sent to your email.','Si referans ak imèl la koresponn, antre kòd prive ou resevwa pa imèl la.');code.focus({preventScroll:true});}
  catch(error){if(current(token)){notice.textContent=error.message;if(challenge&&error.retry_after)challenge.resend=Date.now()+error.retry_after*1000;}}finally{if(token===generation){busy=false;controls();}}
 }
 emailUpdates.onclick=requestCode;resend.onclick=()=>{if(!challenge||Date.now()>=challenge.resend)void requestCode();};
 change.onclick=()=>{if(busy)return;clearProof();email.focus({preventScroll:true});};
 for(const input of [email,reference])input.addEventListener('input',()=>{if(!busy)clearProof();});
 reference.addEventListener('input',()=>{if(busy)return;generation++;activeReference='';record=null;result.hidden=true;notice.textContent='';});
 proof.onsubmit=async event=>{
  event.preventDefault();if(busy||!challenge)return;if(Date.now()>=challenge.expires){renderProof();return;}const value=code.value.replace(/\s/g,'');if(!/^\d{6}$/.test(value)){code.reportValidity();return;}const token=++generation;busy=true;controls();
  try{const response=await api('/api/ads/updates/verify',{verification_id:challenge.id,code:value});if(!current(token))return;clearProof();delete lookup.dataset.appUpdateDirty;delete proof.dataset.appUpdateDirty;renderRecord(response);notice.textContent=word('Email verified. Your receipt and future decisions will be emailed to you.','Imèl verifye. N ap voye resi ak pwochen desizyon yo ba ou pa imèl.');}
  catch(error){if(current(token)){try{const status=await api('/api/ads/status?reference='+encodeURIComponent(challenge.reference));if(status.email_updates){clearProof();renderRecord(status);notice.textContent=word('Email verified. Updates are enabled.','Imèl verifye. Nouvèl yo aktive.');}else notice.textContent=error.message;}catch{notice.textContent=error.message;}}}
  finally{if(token===generation){busy=false;controls();}}
 };
 copy.onclick=async()=>{const value=activeReference,token=generation;if(!value)return;try{await navigator.clipboard.writeText(value);if(current(token)&&activeReference===value)notice.textContent=word('Reference copied','Referans kopye');}catch{if(current(token)&&activeReference===value){reference.focus();reference.select();notice.textContent=word('Copy the selected reference.','Kopye referans ki seleksyone a.');}}};
 refresh.onclick=()=>{reference.value=activeReference;void lookup.onsubmit({preventDefault(){}});};
 stop.onclick=async()=>{if(busy||!activeReference)return;const token=++generation;busy=true;controls();try{await api('/api/ads/updates/stop',{reference:activeReference});if(current(token)){record.email_updates=false;renderRecord(record);notice.textContent=word('Email updates stopped.','Nouvèl pa imèl yo sispann.');}}catch(error){if(current(token))notice.textContent=error.message;}finally{if(token===generation){busy=false;controls();}}};
 window.addEventListener('advertisement-submitted',event=>{const value=event.detail;if(!/^[a-f0-9]{32}$/.test(value?.reference||''))return;activeReference=value.reference;reference.value=value.reference;email.value=value.email||'';details.open=true;void lookup.onsubmit({preventDefault(){}});});
 window.addEventListener('app-language-changed',labels);document.addEventListener('visibilitychange',renderProof);
 new MutationObserver(()=>{if(panel.hidden){generation++;busy=false;clearProof();controls();}}).observe(panel,{attributes:true,attributeFilter:['hidden']});
 window.addEventListener('radio-locals-ready',()=>{const value=new URLSearchParams(location.search).get('reference');if(/^[a-f0-9]{32}$/.test(value||'')){reference.value=value;details.open=true;void lookup.onsubmit({preventDefault(){}});}});
 labels();
})();
