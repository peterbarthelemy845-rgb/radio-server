(()=>{
 'use strict';
 const open=document.getElementById('openStationCodeRecovery'),dialog=document.getElementById('stationCodeRecovery'),form=document.getElementById('stationCodeRecoveryForm'),notice=document.getElementById('stationCodeRecoveryStatus'),close=document.getElementById('closeStationCodeRecovery');
 if(!open||!dialog||!form||!notice||!close)return;
 let generation=0,pending=false;
 const fallback={sending:'Requesting your station code…',sent:'If this email has a registered station, its station code will arrive shortly.'};
 function status(key,text=''){
  if(key){notice.dataset.i18n='recovery.'+key;const value=window.appI18n?.t('recovery.'+key);notice.textContent=value&&value!=='recovery.'+key?value:fallback[key];}
  else{delete notice.dataset.i18n;notice.textContent=text;}
 }
 function current(view,pageView){return dialog.open&&generation===view&&sitePageGeneration===pageView;}
 open.onclick=()=>{
  if(pending||dialog.open)return;
  generation++;form.elements.email.value=document.getElementById('loginForm')?.elements.email.value.trim()||'';status('');
  dialog.showModal();form.elements.email.focus();
 };
 close.onclick=()=>dialog.close();
 dialog.addEventListener('close',()=>{generation++;});
 // A background request may finish after a page change. Keep it from opening
 // an email notice over a different task, without persisting the email draft.
 const visibility=new MutationObserver(()=>{if(document.getElementById('login').hidden&&dialog.open)dialog.close();});
 visibility.observe(document.getElementById('login'),{attributes:true,attributeFilter:['hidden']});
 form.onsubmit=async event=>{
  event.preventDefault();if(pending)return;
  const view=generation,pageView=sitePageGeneration,email=form.elements.email.value.trim();
  pending=true;open.disabled=true;busy(form,true,true);status('sending');
  try{
   const token=await human(form,'station-code-recovery');if(!current(view,pageView))return;
   await api('/api/owner/recover-code',{email,turnstile_token:token});if(!current(view,pageView))return;
   // Do not disclose whether the address owns a station, or grant access here.
   status('sent');notice.focus();
  }catch(error){if(current(view,pageView)){status('',error.message);notice.focus();}}
  finally{pending=false;open.disabled=false;busy(form,false);}
 };
})();
