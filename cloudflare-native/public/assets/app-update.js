'use strict';
const APP_RELEASE='2026.11.09.5';
let appAvailableRelease='',appDismissedRelease='',appReleaseChecking=false;
const appUpdateBanner=document.createElement('aside');appUpdateBanner.id='appUpdateBanner';appUpdateBanner.className='app-update-banner';appUpdateBanner.hidden=true;appUpdateBanner.setAttribute('aria-label','Website update');
const appUpdateTitle=document.createElement('strong'),appUpdateNote=document.createElement('p'),appUpdateActions=document.createElement('div'),appUpdateRefresh=document.createElement('button'),appUpdateLater=document.createElement('button');
appUpdateNote.setAttribute('role','status');appUpdateRefresh.type=appUpdateLater.type='button';appUpdateLater.className='secondary';appUpdateActions.append(appUpdateRefresh,appUpdateLater);appUpdateBanner.append(appUpdateTitle,appUpdateNote,appUpdateActions);document.querySelector('main').prepend(appUpdateBanner);
const updateWords={ready:'A website update is ready.',refresh:'Refresh to update',later:'Later',wait:'Finish your form or request before updating. Your current work stays open.',waitButton:'Finish current task first'};
function updateText(key){return window.appI18n?.t('update.'+key)||updateWords[key];}
function appHasUnfinishedWork(){
 if(typeof shareRunning!=='undefined'&&shareRunning||window.radioControlsBusy)return true;
 if(document.querySelector('dialog[open]'))return true;
 for(const form of document.querySelectorAll('form')){
  if(form.dataset.dirty)return true;
  if(form.getClientRects().length&&form.dataset.appUpdateDirty)return true;
  if(form.getClientRects().length&&form.querySelector('button[type="submit"]:disabled,button:not([type]):disabled'))return true;
 }
 return false;
}
function renderAppUpdate(){
 const visible=!!appAvailableRelease&&appAvailableRelease!==appDismissedRelease;if(appUpdateBanner.hidden!==!visible)appUpdateBanner.hidden=!visible;if(!visible)return;
 const blocked=appHasUnfinishedWork();appUpdateTitle.textContent=updateText('ready');appUpdateNote.textContent=blocked?updateText('wait'):'';if(appUpdateNote.hidden!==!blocked)appUpdateNote.hidden=!blocked;if(appUpdateRefresh.disabled!==blocked)appUpdateRefresh.disabled=blocked;appUpdateRefresh.textContent=updateText(blocked?'waitButton':'refresh');appUpdateLater.textContent=updateText('later');
}
appUpdateLater.onclick=()=>{appDismissedRelease=appAvailableRelease;renderAppUpdate();};
appUpdateRefresh.onclick=()=>{
 if(appHasUnfinishedWork()){renderAppUpdate();return;}
 // Only public browsing state crosses a deliberate reload. Form data, files,
 // device codes and sign-in codes are never serialized into browser storage.
 try{sessionStorage.setItem('radioLocalsUpdateView',JSON.stringify({query:($('search')?.value||'').slice(0,250),x:window.scrollX||0,y:window.scrollY||0,expires:Date.now()+60000}));}catch{}
 window.location.reload();
};
async function checkAppRelease(){
 if(appReleaseChecking||document.hidden||!navigator.onLine)return;appReleaseChecking=true;
 try{const response=await fetch('/assets/app-release.json',{cache:'no-store',credentials:'omit',signal:AbortSignal.timeout(6000)});if(!response.ok)return;const data=await response.json();if(typeof data.version!=='string'||!/^\d{4}\.\d{2}\.\d{2}\.\d{1,6}$/.test(data.version))return;if(data.version!==APP_RELEASE)appAvailableRelease=data.version;else appAvailableRelease='';renderAppUpdate();}catch{}finally{appReleaseChecking=false;}
}
document.addEventListener('input',event=>{const form=event.target.closest?.('form');if(form&&!['registerForm','editForm','ticketForm','advertiseForm'].includes(form.id))form.dataset.appUpdateDirty='1';renderAppUpdate();});
document.addEventListener('reset',event=>{if(event.target.tagName==='FORM')delete event.target.dataset.appUpdateDirty;queueMicrotask(renderAppUpdate);},true);
new MutationObserver(renderAppUpdate).observe(document.querySelector('main'),{subtree:true,attributes:true,attributeFilter:['disabled','hidden','data-dirty','open']});
new MutationObserver(renderAppUpdate).observe(document.body,{subtree:true,attributes:true,attributeFilter:['open']});
window.addEventListener('radio-controls-opened',renderAppUpdate);window.addEventListener('radio-controls-closed',renderAppUpdate);window.addEventListener('app-language-changed',renderAppUpdate);window.addEventListener('focus',checkAppRelease);window.addEventListener('online',checkAppRelease);document.addEventListener('visibilitychange',()=>{if(!document.hidden)checkAppRelease();});window.addEventListener('load',checkAppRelease);
setInterval(()=>{if(appAvailableRelease)renderAppUpdate();checkAppRelease();},300000);
window.addEventListener('radio-locals-ready',()=>{
 try{const raw=sessionStorage.getItem('radioLocalsUpdateView');sessionStorage.removeItem('radioLocalsUpdateView');if(!raw)return;const data=JSON.parse(raw);if(data.expires<Date.now()||typeof data.query!=='string')return;if($('search')){$('search').value=data.query.slice(0,250);list();}requestAnimationFrame(()=>window.scrollTo(Number(data.x)||0,Number(data.y)||0));}catch{}
});
