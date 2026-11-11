(()=>{
 'use strict';
 const editor=document.getElementById('editor'),form=document.getElementById('editForm'),field=form?.elements.stream_url,button=document.getElementById('testOwnerStream'),area=document.getElementById('ownerStreamTestHuman'),notice=document.getElementById('ownerStreamTestStatus');
 if(!editor||!form||!field||!button||!area||!notice)return;
 let active=null,generation=0,statusKey='',statusFallback='';
 function text(key,fallback){const value=window.appI18n?.t(key);return value&&value!==key?value:fallback;}
 function status(key,fallback='',state=''){
  statusKey=key;statusFallback=fallback;notice.dataset.state=state;
  if(key)notice.dataset.i18n=key;else delete notice.dataset.i18n;
  notice.textContent=key?text(key,fallback):fallback;
 }
 function saving(){return form.dataset.busy==='1'||form.getAttribute('aria-busy')==='true'||field.disabled;}
 function controls(){button.disabled=!!active||saving()||editor.hidden||!field.value.trim();}
 function abandon(){const previous=active;active=null;generation++;if(previous){previous.controller.abort();previous.restoreLabel();}status('');controls();}
 button.onclick=async()=>{
  if(active||saving()||editor.hidden)return;
  if(window.prepareOwnerStreamSetup&&!window.prepareOwnerStreamSetup())return;
  const raw=field.value;let target;
  try{if(typeof window.parsePublicStreamUrl!=='function')throw new Error(text('registration.notConfirmed','Stream could not be confirmed. You can still save it.'));target=window.parsePublicStreamUrl(raw);}
  catch(error){status(error.key||'',String(error.message||'Check the stream address and try again.').slice(0,400),'invalid');field.focus();controls();return;}
  if(/^\d+\.\d+\.\d+\.\d+$/.test(target.hostname)){status('registration.ipTestUnavailable','Automatic testing is unavailable for numeric IP addresses. You can still save and check it on your radio.','unconfirmed');return;}
  if(/\.(?:pls|m3u|m3u8|xspf)$/i.test(target.pathname)){status('registration.playlistTestUnavailable','This is a playlist link. Automatic testing cannot confirm it; use a direct listening link when available. You can still save.','unconfirmed');return;}
  const attempt={raw,value:target.href,generation,controller:new AbortController(),restoreLabel:setBusyButtonLabel(button,'checking')};active=attempt;controls();status('registration.checking','Checking the stream. No audio will play.','checking');
  const current=()=>active===attempt&&generation===attempt.generation&&field.value===attempt.raw&&!editor.hidden&&!saving()&&!attempt.controller.signal.aborted;
  try{
   const turnstile_token=await human(area,'stream-check',attempt.controller.signal);if(!current())return;
   const response=await api('/api/owner/stream-check',{stream_url:attempt.value,turnstile_token});if(!current())return;
   if(response.result==='audio_response'&&response.audio_response===true)status('registration.audioResponse','Stream responded with audio data. Playback is not verified.','success');
   else status('registration.notConfirmed','Stream could not be confirmed. You can still save it.','unconfirmed');
  }catch(error){if(current())status('',String(error.message||'The stream check did not complete. You can still save it.').slice(0,400),'error');}
  finally{if(active===attempt){active=null;attempt.restoreLabel();controls();}}
 };
 field.addEventListener('input',abandon);field.addEventListener('change',abandon);
 form.addEventListener('owner-stream-mode-changed',abandon);
 form.addEventListener('reset',()=>{abandon();queueMicrotask(controls);});
 form.addEventListener('form-busy-changed',()=>{if(saving())abandon();else controls();});
 new MutationObserver(()=>{if(saving())abandon();else controls();}).observe(form,{attributes:true,attributeFilter:['data-busy','aria-busy']});
 new MutationObserver(abandon).observe(form,{attributes:true,attributeFilter:['data-station-code']});
 new MutationObserver(()=>{abandon();}).observe(editor,{attributes:true,attributeFilter:['hidden']});
 window.addEventListener('app-language-changed',()=>{if(statusKey)status(statusKey,statusFallback,notice.dataset.state);});
 window.addEventListener('pagehide',abandon);controls();
})();
