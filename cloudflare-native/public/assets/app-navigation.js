'use strict';
// Listener navigation stays inside this document. Drafts and scroll positions
// remain in memory; no device codes, ticket text or credentials enter history.
const appPagePositions=new Map(),appDisplayMode=matchMedia('(display-mode: standalone)');
let appCurrentPage=appVisiblePage(),appRestoring=false,appNavigationGeneration=0,appPanelOrigin=null,appSupportPromise=null,appControlOrigin=null,appLastControlId=null;
function appVisiblePage(){return ['myRadio','support','wifiSetup','login','register','editor','shared','admin','legal','advertise','adReview','reports','backups'].find(id=>$(id)&&!$(id).hidden)||(location.pathname==='/wifi-setup'?'wifiSetup':location.pathname==='/support'?'support':'myRadio');}
function appIsListenerPage(id){return ['myRadio','support','wifiSetup'].includes(id);}
function appListenerMode(){return new URLSearchParams(location.search).get('app')==='1'||appDisplayMode.matches||navigator.standalone===true;}
function appRememberPosition(id=appCurrentPage){
 if(!id)return;
 appPagePositions.set(id,{x:window.scrollX||0,y:window.scrollY||0,tracks:Object.fromEntries(['stations','savedStations','supportVideos'].map(key=>[key,$(key)?.scrollLeft||0]))});
}
function appRestorePosition(id,focus){
 const generation=appNavigationGeneration,position=appPagePositions.get(id)||{x:0,y:0,tracks:{}};
 requestAnimationFrame(()=>{if(generation!==appNavigationGeneration||appCurrentPage!==id)return;for(const [key,left] of Object.entries(position.tracks))if($(key))$(key).scrollLeft=left;window.scrollTo(position.x,position.y);if(focus?.isConnected)focus.focus({preventScroll:true});});
}
function appApplyMode(){
 const listenerPage=appIsListenerPage(appCurrentPage),listener=appListenerMode();
 document.body.classList.toggle('app-listener-page',listenerPage);
 document.body.classList.toggle('listener-app',listener&&listenerPage);
 $('navAdd').hidden=listener&&listenerPage;
 if($('listenerAppTitle'))$('listenerAppTitle').textContent=appCurrentPage==='wifiSetup'?'Wi-Fi setup':appCurrentPage==='support'?'Support':'Radio';
 const help=$('listenerSupportHelp');if(help)help.hidden=!listener;
 // A listener can open the complete help form; regular website users always
 // get the complete form. Switching pages never resets its contents.
 if(!listener)$('ticketForm').hidden=false;
 else if(help&&!help.dataset.expanded)$('ticketForm').hidden=true;
 const supportLink=document.querySelector('nav a[href^="/support"]');
 if(supportLink)supportLink.setAttribute('aria-current',appCurrentPage==='support'?'page':'false');
 $('navRadio').setAttribute('aria-current',['myRadio','wifiSetup'].includes(appCurrentPage)?'page':'false');
}
const appOriginalPage=page;
page=function(id){
 const next=id==='library'?'myRadio':id;
 if(next!==appCurrentPage){appRememberPosition();if(appCurrentPage==='support')for(const video of $('supportVideos').querySelectorAll('video'))video.pause();}
 appOriginalPage(id);appCurrentPage=next;appApplyMode();
};
const appOriginalList=list;
list=function(){const positions=['stations','savedStations'].map(id=>[id,$(id)?.scrollLeft||0]);appOriginalList();for(const [id,left] of positions)if($(id))$(id).scrollLeft=left;};
function appHistoryValue(pageId=appCurrentPage,panel=null,code=null){return {page:pageId,panel,code};}
function appReplaceHistory(value){const previous=history.state?.radioLocalsApp;if(previous?.page===value.page&&previous.from)value={...value,from:previous.from};history.replaceState({...history.state,radioLocalsApp:value},'',location.href);}
function appListenerUrl(pageId){const url=new URL(location.href);url.pathname=pageId==='wifiSetup'?'/wifi-setup':pageId==='support'?'/support':'/';url.hash=pageId==='myRadio'?'radio':'';return url.pathname+url.search+url.hash;}
function appEnsureSupport(){
 if($('supportVideos').children.length)return Promise.resolve();
 if(!appSupportPromise)appSupportPromise=loadSupport().catch(error=>{$('supportMessage').textContent=error.message;}).finally(()=>{appSupportPromise=null;});
 return appSupportPromise;
}
function appShowPage(pageId,{push=false,replace=false,focus=null}={}){
 ++appNavigationGeneration;
 if(push){appRememberPosition();appReplaceHistory(appHistoryValue());history.pushState({radioLocalsApp:{...appHistoryValue(pageId),from:appCurrentPage}},'',appListenerUrl(pageId));}
 else if(replace){appRememberPosition();history.replaceState({radioLocalsApp:appHistoryValue(pageId)},'',appListenerUrl(pageId));}
 page(pageId);appRestorePosition(pageId,focus);
 if(pageId==='support')appEnsureSupport();else if(pageId==='myRadio')loadMyRadios(true);
}
function appCloseStationPanel(){
 if(shareRunning){$('shareStatus').textContent='Please wait for the current request to finish before closing.';return;}
 if(history.state?.radioLocalsApp?.panel==='station')history.back();else stationPopup.close();
}
const appOriginalOpenStation=openStationPopup;
openStationPopup=async function(code,options={}){
 if(shareRunning||stationPopup.open)return;
 if(typeof radioPairingBusy!=='undefined'&&radioPairingBusy){$('radioConnectStatus').textContent='Finish connecting your radio before adding a station.';return;}
 appRememberPosition();appPanelOrigin={page:appCurrentPage,focus:document.activeElement};
 const opened=appOriginalOpenStation(code,options);
 if(stationPopup.open&&!appRestoring){appReplaceHistory(appHistoryValue());history.pushState({radioLocalsApp:appHistoryValue(appCurrentPage,'station',String(code))},'',location.href);}
 await opened;
};
stationPopupClose.onclick=appCloseStationPanel;
stationPopup.addEventListener('cancel',event=>{event.preventDefault();appCloseStationPanel();});
stationPopup.addEventListener('close',()=>{
 if(typeof invalidateSharedView==='function')invalidateSharedView();else ++sharedOpenGeneration;
 if(!appRestoring&&history.state?.radioLocalsApp?.panel==='station'){history.back();return;}
 const origin=appPanelOrigin;appPanelOrigin=null;if(origin)appRestorePosition(origin.page,origin.focus);
});
window.addEventListener('radio-controls-opened',event=>{
 appRememberPosition();appLastControlId=event.detail?.radioId;appControlOrigin={page:appCurrentPage,focus:event.detail?.trigger};
 if(!appRestoring){appReplaceHistory(appHistoryValue());history.pushState({radioLocalsApp:appHistoryValue(appCurrentPage,'controls')},'',location.href);}
});
window.addEventListener('radio-controls-closed',()=>{
 if(!appRestoring&&history.state?.radioLocalsApp?.panel==='controls'){history.back();return;}
 const origin=appControlOrigin;appControlOrigin=null;if(origin)appRestorePosition(origin.page,origin.focus);
});
window.addEventListener('popstate',event=>{
 const next=event.state?.radioLocalsApp;
 if(window.radioControlsDialog?.open&&window.radioControlsBusy&&next?.panel!=='controls'){history.go(1);window.closeRadioControls();return;}
 if(stationPopup.open&&shareRunning&&next?.panel!=='station'){history.go(1);$('shareStatus').textContent='Please wait for the current request to finish before closing.';return;}
 if(!next)return;
 appRestoring=true;
 try{
  const origin=appPanelOrigin||appControlOrigin,returningFromWifi=appCurrentPage==='wifiSetup'&&next.page==='myRadio';
  if(window.radioControlsDialog?.open&&next.panel!=='controls')window.closeRadioControls();
  if(stationPopup.open&&next.panel!=='station')stationPopup.close();
  appShowPage(next.page,{focus:origin?.focus||(returningFromWifi?$('openWifiSetup')||$('navRadio'):null)});
  if(next.panel==='station'&&!stationPopup.open)openStationPopup(next.code);
  if(next.panel==='controls'&&!window.radioControlsDialog?.open&&appLastControlId&&typeof openRadioControls==='function')openRadioControls(appLastControlId);
 }finally{appRestoring=false;}
});
// Window capture runs before the legacy form-leaving guard. Listener navigation
// preserves the ticket form in this document, so nothing is discarded.
window.addEventListener('click',event=>{
 const target=event.target.closest?.('nav button,nav a,#openWifiSetup,#wifiBackToRadio');
 if(!target||!appIsListenerPage(appCurrentPage)||event.button>0||event.ctrlKey||event.metaKey||event.shiftKey||event.altKey)return;
 const support=target.tagName==='A'&&new URL(target.href,location.origin).pathname==='/support';
 const wifi=target.id==='openWifiSetup',backToRadio=target.id==='wifiBackToRadio';
 const radio=['navRadio','navLibrary'].includes(target.id)||backToRadio;if(!support&&!radio&&!wifi)return;
 event.preventDefault();event.stopImmediatePropagation();if(shareRunning||window.radioControlsBusy)return;
 const next=wifi?'wifiSetup':support?'support':'myRadio';if(next===appCurrentPage){if(next==='myRadio')appShowPage(next,{replace:true});return;}
 if(backToRadio&&history.state?.radioLocalsApp?.from==='myRadio'){history.back();return;}
 appShowPage(next,{push:!backToRadio,replace:backToRadio,focus:next==='myRadio'?$('navRadio'):$('listenerAppTitle')});
},true);
window.addEventListener('beforeunload',event=>{if($('ticketForm').dataset.dirty){event.preventDefault();event.returnValue='';}});
const appHelp=document.createElement('button');appHelp.id='listenerSupportHelp';appHelp.type='button';appHelp.className='support-help';appHelp.textContent='Get help';appHelp.setAttribute('aria-expanded','false');
appHelp.onclick=()=>{const expanded=!appHelp.dataset.expanded;if(expanded)appHelp.dataset.expanded='1';else delete appHelp.dataset.expanded;$('ticketForm').hidden=!expanded;appHelp.setAttribute('aria-expanded',String(expanded));if(expanded)$('ticketForm').elements.name.focus();};$('ticketForm').before(appHelp);
if('scrollRestoration' in history)history.scrollRestoration='manual';
if(appIsListenerPage(appCurrentPage))appReplaceHistory(appHistoryValue());
appApplyMode();appDisplayMode.addEventListener?.('change',appApplyMode);
window.addEventListener('radio-locals-ready',()=>{appCurrentPage=appVisiblePage();appApplyMode();if(appIsListenerPage(appCurrentPage))appReplaceHistory(appHistoryValue());});
