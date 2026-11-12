(()=>{
 'use strict';
 const editor=document.getElementById('editor'),form=document.getElementById('editForm'),field=form?.elements.stream_url,button=document.getElementById('testOwnerStream'),area=document.getElementById('ownerStreamTestHuman'),notice=document.getElementById('ownerStreamTestStatus');
 if(!editor||!form||!field||!button||!area||!notice)return;
 const save=form.querySelector?.('button[type="submit"]')||document.getElementById('ownerSave');
 const PASS_LIFETIME=55*60*1000;
 let active=null,generation=0,statusKey='',statusFallback='',station='',loaded=false,approvedUrl='',passedUrl='',passedUntil=0,expiryTimer;
 function text(key,fallback){const value=window.appI18n?.t(key);return value&&value!==key?value:fallback;}
 function status(key,fallback='',state=''){
  statusKey=key;statusFallback=fallback;notice.dataset.state=state;notice.hidden=false;
  if(key)notice.dataset.i18n=key;else delete notice.dataset.i18n;
  notice.textContent=key?text(key,fallback):fallback;
 }
 function result(key,fallback,state){
  status(key,fallback,state);
  try{notice.hidden=window.showStreamTestResult?.({source:'owner',key,fallback,state})===true;}catch{notice.hidden=false;}
 }
 function saving(){return form.dataset.busy==='1'||form.getAttribute('aria-busy')==='true'||field.disabled;}
 function canonical(value){try{return typeof window.parsePublicStreamUrl==='function'?window.parsePublicStreamUrl(value).href:'';}catch{return '';}}
 function clearPass(){passedUrl='';passedUntil=0;if(expiryTimer!==undefined){clearTimeout(expiryTimer);expiryTimer=undefined;}}
 function allowed(){
  const value=canonical(field.value);if(!loaded||!station||String(form.dataset.stationCode||'')!==station||!value||active)return false;
  return value===approvedUrl||value===passedUrl&&Date.now()<passedUntil;
 }
 function controls(){
  button.disabled=!!active||saving()||editor.hidden||!field.value.trim();
  const permit=allowed();if(save){save.disabled=saving()||editor.hidden||!permit;if(permit)save.removeAttribute?.('aria-describedby');else save.setAttribute?.('aria-describedby','ownerStreamPublicationHelp');}
  const next=permit?'true':'false',changed=form.dataset.streamSaveAllowed!==next;form.dataset.streamSaveAllowed=next;
  if(changed&&typeof Event==='function')window.dispatchEvent?.(new Event('owner-stream-save-state-changed'));
 }
 function armExpiry(){
  if(expiryTimer!==undefined){clearTimeout(expiryTimer);expiryTimer=undefined;}
  if(!passedUrl||passedUntil<=Date.now())return;
  expiryTimer=setTimeout(()=>{expiryTimer=undefined;const expired=passedUrl&&Date.now()>=passedUntil;if(expired){clearPass();if(!editor.hidden&&!allowed())status('owner.streamCheckExpired','Your stream check expired. Test your stream again before saving.','unconfirmed');}controls();},Math.max(1,passedUntil-Date.now()));
  expiryTimer?.unref?.();
 }
 function abandon(invalidate=false){const previous=active;active=null;generation++;if(previous){previous.controller.abort();previous.restoreLabel();}if(invalidate)clearPass();window.closeStreamTestResult?.('owner');status('');controls();}
 window.ownerStreamSaveAllowed=(report=false)=>{
  const permit=allowed();controls();
  if(!permit&&report&&!active){status('owner.streamCheckRequired','Test your stream before saving.','unconfirmed');if(!button.disabled)button.focus();}
  return permit;
 };
 window.invalidateOwnerStreamSaveGate=()=>{approvedUrl='';abandon(true);status('owner.streamCheckRequired','Test your stream before saving.','unconfirmed');};
 window.syncOwnerStreamSaveGate=record=>{
  const next=record&&typeof record==='object'?String(record.code||''):'';
  if(!next||next!==station){loaded=false;approvedUrl='';abandon(true);}
  station=next;loaded=!!next;
  // The editor URL may be an unapproved replacement. Only the server's live
  // approved row grants the unchanged-stream exception; a draft never does.
  approvedUrl=record?.approved?.status==='published'?canonical(record.approved.stream_url):'';
  if(passedUrl&&canonical(field.value)!==passedUrl)clearPass();armExpiry();controls();
 };
 button.onclick=async()=>{
  if(active||saving()||editor.hidden)return;
  if(window.prepareOwnerStreamSetup&&!window.prepareOwnerStreamSetup())return;
  clearPass();controls();const raw=field.value;let target;
  try{if(typeof window.parsePublicStreamUrl!=='function')throw new Error(text('registration.setupUnavailable','Stream address validation is unavailable. Refresh and try again.'));target=window.parsePublicStreamUrl(raw);}
  catch(error){status(error.key||'',String(error.message||'Check the stream address and try again.').slice(0,400),'invalid');field.focus();controls();return;}
  if(/\.(?:pls|m3u|m3u8|xspf)$/i.test(target.pathname)){result('registration.playlistTestUnavailable','Use a direct listening link, then test your stream again before saving.','unconfirmed');return;}
  const attempt={raw,value:target.href,generation,controller:new AbortController(),restoreLabel:setBusyButtonLabel(button,'checking')};active=attempt;controls();status('registration.checking','Checking the stream. No audio will play.','checking');
  const current=()=>active===attempt&&generation===attempt.generation&&field.value===attempt.raw&&!editor.hidden&&!saving()&&!attempt.controller.signal.aborted;
  try{
   const turnstile_token=await human(area,'stream-check',attempt.controller.signal);if(!current())return;
   const response=await api('/api/owner/stream-check',{stream_url:attempt.value,turnstile_token});if(!current())return;
   if(response.result==='audio_response'&&response.audio_response===true){passedUrl=attempt.value;passedUntil=Date.now()+PASS_LIFETIME;armExpiry();result('registration.audioResponse','Stream check passed','success');}
   else result('registration.notConfirmed','Stream could not be confirmed. Check the details and test again before saving.','unconfirmed');
  }catch(error){if(current())result('',String(error.message||'The stream check did not complete. Test again before saving.').slice(0,400),'error');}
  finally{if(active===attempt){active=null;attempt.restoreLabel();controls();}}
 };
 field.addEventListener('input',()=>abandon(true));field.addEventListener('change',()=>abandon(true));
 form.addEventListener('owner-stream-mode-changed',event=>abandon(event.detail?.source!=='sync'));
 form.addEventListener('reset',()=>{loaded=false;station='';approvedUrl='';abandon(true);queueMicrotask(controls);});
 form.addEventListener('form-busy-changed',()=>{if(saving())abandon();else controls();});
 new MutationObserver(()=>{if(saving())abandon();else controls();}).observe(form,{attributes:true,attributeFilter:['data-busy','aria-busy']});
 new MutationObserver(()=>{if(String(form.dataset.stationCode||'')!==station){loaded=false;approvedUrl='';abandon(true);}else controls();}).observe(form,{attributes:true,attributeFilter:['data-station-code']});
 new MutationObserver(()=>{abandon();}).observe(editor,{attributes:true,attributeFilter:['hidden']});
 window.addEventListener('app-language-changed',()=>{if(statusKey){const hidden=notice.hidden;status(statusKey,statusFallback,notice.dataset.state);notice.hidden=hidden;}});
 window.addEventListener('pagehide',()=>abandon());controls();
})();
