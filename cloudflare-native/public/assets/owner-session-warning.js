(()=>{
 'use strict';
 const form=$('editForm'),editorPanel=$('editor');if(!form||!editorPanel)return;
 const notice=document.createElement('aside');notice.id='ownerSessionNotice';notice.className='owner-session-notice';notice.hidden=true;
 const text=document.createElement('p');text.id='ownerSessionNoticeText';text.setAttribute('role','status');text.setAttribute('aria-live','polite');
 const signIn=document.createElement('button');signIn.type='button';signIn.className='secondary';signIn.dataset.i18n='owner.signInAgain';signIn.textContent='Sign in again';
 notice.append(text,signIn);form.before(notice);let deadline=0,timer,mode='';
 function wording(key,fallback){const value=window.appI18n?.t(key);return value&&value!==key?value:fallback;}
 function dirty(){return !!form.dataset.dirty||!!form.elements.artwork.files[0];}
 function render(){
  clearTimeout(timer);timer=undefined;
  const usable=!editorPanel.hidden&&!document.hidden&&dirty()&&deadline>0&&!formIsBusy(form)&&$('ownerSignInAgain')?.hidden!==false;
  const remaining=deadline-Date.now(),next=usable&&remaining<=120000?(remaining<=0?'expired':'soon'):'';
  notice.hidden=!next;if(next!==mode){mode=next;notice.dataset.state=next;}
  if(next){const key=next==='expired'?'owner.sessionEnded':'owner.sessionEnding',fallback=next==='expired'?'Your sign-in ended. Sign in again to save. Your edits stay in this tab.':'Your sign-in ends soon. Save your changes or sign in again. Your edits stay in this tab.',value=wording(key,fallback);if(text.textContent!==value)text.textContent=value;signIn.textContent=wording('owner.signInAgain','Sign in again');}
  else if(text.textContent)text.textContent='';
  if(usable&&remaining>0)timer=setTimeout(render,Math.max(1,remaining>120000?remaining-120000:remaining));
 }
 function acceptSession(detail){
  if(!detail||!Object.hasOwn(detail,'owner_expires'))return;
  if(Number.isFinite(detail.owner_expires)&&detail.owner_expires>0){const serverNow=Number.isFinite(detail.server_time)?detail.server_time:Date.now()/1000;deadline=Date.now()+Math.max(0,detail.owner_expires-serverNow)*1000;}
  else if(deadline)deadline=Math.min(deadline,Date.now());
  render();
 }
 signIn.onclick=()=>{if(!notice.hidden&&!formIsBusy(form)&&!editorPanel.hidden)$('ownerSignInAgain')?.click();};
 for(const event of ['input','change','form-busy-changed'])form.addEventListener(event,()=>queueMicrotask(render));
 form.addEventListener('reset',()=>queueMicrotask(render));
 new MutationObserver(render).observe(editorPanel,{attributes:true,attributeFilter:['hidden']});
 new MutationObserver(render).observe(form,{attributes:true,attributeFilter:['data-dirty','data-busy']});
 document.addEventListener('visibilitychange',render);
 window.addEventListener('owner-session-updated',event=>acceptSession(event.detail));window.addEventListener('app-language-changed',render);
 window.addEventListener('radio-locals-ready',()=>acceptSession(typeof state==='undefined'?null:state));
 acceptSession(typeof state==='undefined'?null:state);
})();
