(()=>{
 'use strict';
 const editor=document.getElementById('editor'),form=document.getElementById('editForm'),panel=document.getElementById('ownerStreamPublication'),title=document.getElementById('ownerStreamPublicationTitle'),help=document.getElementById('ownerStreamPublicationHelp'),button=document.getElementById('requestOwnerStreamReview'),notice=document.getElementById('ownerStreamPublicationMessage');
 if(!editor||!form||!panel||!title||!help||!button||!notice)return;
 let saved=null,active=null,generation=0,noticeKey='',noticeFallback='',expired=false;
 const text=(key,fallback)=>{const value=window.appI18n?.t(key);return typeof value==='string'&&value!==key?value:fallback;};
 const busy=()=>form.dataset.busy==='1'||form.getAttribute('aria-busy')==='true'||!!form.elements.stream_url?.disabled;
 function dirty(){return !!form.dataset.dirty||!!form.elements.artwork?.files?.[0]||!!saved&&(form.dataset.revision!==saved.revision||form.elements.stream_url?.value!==saved.stream||form.elements.name?.value!==saved.name||form.elements.bio?.value!==saved.bio);}
 function message(key='',fallback=''){noticeKey=key;noticeFallback=fallback;notice.textContent=key?text(key,fallback):fallback;notice.hidden=!notice.textContent;}
 function cancel(clear=true){generation++;const previous=active;active=null;if(previous){previous.controller.abort();previous.restore?.();}if(clear)message();}
 function render(){
  const known=saved&&['passed','needs_check','review_requested'].includes(saved.check?.status)&&!(saved.status==='published'&&!saved.reviewPending&&saved.check.status!=='passed');panel.hidden=!known||editor.hidden;if(!known)return;
  const draft=dirty(),status=saved.check.status;panel.dataset.state=status;
  const pendingLive=saved.status==='published'&&saved.reviewPending;
  const key=status==='passed'?'owner.streamPassed':status==='review_requested'?'owner.streamReviewRequested':'owner.streamNeedsCheck';
  title.textContent=text(key,status==='passed'?'Stream check passed':status==='review_requested'?'Stream review requested':'Check your stream');
  if(draft)help.textContent=text('owner.streamSaveFirst','Save your changes before requesting a stream review.');
  else if(pendingLive)help.textContent=text('owner.streamOriginalLive','Your last approved stream stays live. These saved changes stay private until approved.');
  else if(saved.status==='published')help.textContent=text('owner.streamApprovedLive','Your approved stream is live.');
  else if(status==='passed')help.textContent=text('owner.streamReady','The stream check passed. Publication still depends on safety review.');
  else if(status==='review_requested')help.textContent=text('owner.streamReviewPrivate','Your saved stream stays private while we review it.');
  else help.textContent=text('owner.streamPrivate','Saved privately. Test your stream again, or request a review.');
  button.hidden=status!=='needs_check';button.disabled=!!active||draft||busy()||expired||editor.hidden||!saved.revision||form.dataset.stationCode!==saved.code;
  if(!active)button.textContent=text('owner.requestStreamReview','Request stream review');
  if(noticeKey)notice.textContent=text(noticeKey,noticeFallback);
 }
 window.renderOwnerStreamPublication=station=>{
  cancel();expired=false;
  saved=station&&typeof station==='object'?{code:String(station.code||''),revision:String(station.revision||''),stream:String(station.stream_url||''),name:String(station.name||''),bio:String(station.bio||''),status:station.status,reviewPending:station.review_pending===true,check:station.stream_check&&typeof station.stream_check==='object'?{...station.stream_check}:null}:null;
  render();
 };
 button.onclick=async()=>{
  if(!saved||saved.check?.status!=='needs_check'||active||button.disabled||dirty()||busy()||expired||editor.hidden||form.dataset.stationCode!==saved.code||form.dataset.revision!==saved.revision)return;
  const attempt={generation,code:saved.code,revision:saved.revision,controller:new AbortController(),restore:typeof setBusyButtonLabel==='function'?setBusyButtonLabel(button,'sending'):null};active=attempt;message();render();
  const current=()=>active===attempt&&generation===attempt.generation&&!attempt.controller.signal.aborted&&!editor.hidden&&!expired&&!busy()&&!dirty()&&saved?.code===attempt.code&&saved.revision===attempt.revision&&form.dataset.stationCode===attempt.code&&form.dataset.revision===attempt.revision;
  try{
   const response=await api('/api/owner/stream-review',{revision:attempt.revision},{signal:attempt.controller.signal});if(!current())return;
   const check=response.stream_check||response.station?.stream_check;
   if(check&&['passed','needs_check','review_requested'].includes(check.status))saved.check={...check};
   if(check?.status==='review_requested')message('owner.streamReviewSent','Review requested. Your saved stream remains private until approved.');
   else message('',String(response.message||text('owner.streamReviewFailed','Review could not be confirmed. Please try again.')).slice(0,400));
  }catch(error){
   if(!current())return;
   if(error.status===401){expired=true;message('owner.signInExpired','Your sign-in expired. Sign in again to save your changes. Your edits are kept in this tab.');if(typeof ownerEditFeedback==='function')ownerEditFeedback(notice.textContent,true);}
   else if(error.status===409)message('owner.streamReviewChanged','Your saved station changed. Refresh the editor before requesting review.');
   else message('',String(error.message||text('owner.streamReviewFailed','Review could not be confirmed. Please try again.')).slice(0,400));
  }finally{if(active===attempt){active=null;attempt.restore?.();render();}}
 };
 for(const event of ['input','change','owner-stream-mode-changed'])form.addEventListener(event,()=>{cancel();render();});
 form.addEventListener('reset',()=>{cancel();queueMicrotask(render);});
 form.addEventListener('form-busy-changed',()=>{if(busy())cancel();render();});
 new MutationObserver(()=>{if(busy())cancel();render();}).observe(form,{attributes:true,attributeFilter:['data-busy','aria-busy']});
 new MutationObserver(()=>{cancel();render();}).observe(form,{attributes:true,attributeFilter:['data-dirty','data-station-code','data-revision']});
 new MutationObserver(()=>{if(editor.hidden)cancel();render();}).observe(editor,{attributes:true,attributeFilter:['hidden']});
 window.addEventListener('owner-session-updated',event=>{const value=event.detail;if(value&&Object.hasOwn(value,'owner_expires')){expired=!Number.isFinite(value.owner_expires)||value.owner_expires<=(value.server_time||Date.now()/1000);if(expired)cancel();render();}});
 window.addEventListener('app-language-changed',render);window.addEventListener('pagehide',()=>{cancel();render();});
})();
