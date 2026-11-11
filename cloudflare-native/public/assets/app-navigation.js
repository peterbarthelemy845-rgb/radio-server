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
 appUpdatePageTitle();
}
function appUpdatePageTitle(){
 const names={myRadio:'Radio',support:'Support',wifiSetup:'Wi-Fi setup',login:'Sign in',register:'Create station',editor:'Station editor',shared:'Add station to radio',admin:'Administrator',legal:'Legal and contact',advertise:'Advertise',adReview:'Review ads',reports:'Reports',backups:'Backups'};
 const name=window.appI18n?.t('title.'+appCurrentPage),fallback=names[appCurrentPage]||'Radio';
 document.title=(name&&name!=='title.'+appCurrentPage?name:fallback)+' — Radio Locals';
}
const appSupportPausedFrames=new WeakMap();
function appPauseSupportMedia(){
 for(const video of $('supportVideos').querySelectorAll('video'))video.pause();
 for(const frame of $('supportVideos').querySelectorAll('iframe')){
  // Hiding an iframe leaves its player running. Unload only our approved
  // tutorial embeds, then restore their original non-autoplay URL on return.
  if(/^https:\/\/www\.youtube-nocookie\.com\/embed\/[A-Za-z0-9_-]{11}$/.test(frame.src)){
   appSupportPausedFrames.set(frame,frame.src);frame.src='about:blank';
  }
 }
}
function appRestoreSupportMedia(){
 for(const frame of $('supportVideos').querySelectorAll('iframe')){
  const source=appSupportPausedFrames.get(frame);if(!source)continue;
  appSupportPausedFrames.delete(frame);frame.src=source;
 }
}
let appGuideNavigation,appGuidePrevious,appGuideNext,appGuidePosition;
function appGuideIndex(){
 const track=$('supportVideos'),cards=[...track.children];if(!cards.length)return 0;
 const left=track.scrollLeft||0,first=cards[0].offsetLeft||0;
 return cards.reduce((best,card,index)=>Math.abs((card.offsetLeft||0)-first-left)<Math.abs((cards[best].offsetLeft||0)-first-left)?index:best,0);
}
function appUpdateGuideNavigation(){
 if(!appGuideNavigation)return;const total=$('supportVideos').children.length,index=appGuideIndex();
 appGuideNavigation.hidden=total<=1;appGuidePrevious.disabled=index<=0;appGuideNext.disabled=index>=total-1;
 appGuidePrevious.textContent=window.appI18n?.t('guide.previousShort')||'Previous';appGuideNext.textContent=window.appI18n?.t('guide.nextShort')||'Next';
 appGuidePrevious.setAttribute('aria-label',window.appI18n?.t('guide.previous')||'Previous guide');appGuideNext.setAttribute('aria-label',window.appI18n?.t('guide.next')||'Next guide');
 appGuidePosition.textContent=window.appI18n?.t('guide.position',{current:total?index+1:0,total})||((total?index+1:0)+' of '+total);
}
function appMoveGuide(direction){
 const track=$('supportVideos'),cards=[...track.children],index=Math.max(0,Math.min(cards.length-1,appGuideIndex()+direction));if(!cards[index])return;
 appPauseSupportMedia();appRestoreSupportMedia();
 track.scrollTo({left:(cards[index].offsetLeft||0)-(cards[0].offsetLeft||0),behavior:matchMedia('(prefers-reduced-motion: reduce)').matches?'auto':'smooth'});
}
function appInstallGuideNavigation(){
 const track=$('supportVideos');if(!appGuideNavigation){
  appGuideNavigation=document.createElement('div');appGuideNavigation.className='support-guide-navigation';
  appGuidePrevious=document.createElement('button');appGuidePrevious.type='button';appGuidePrevious.className='secondary';appGuidePrevious.onclick=()=>appMoveGuide(-1);
  appGuideNext=document.createElement('button');appGuideNext.type='button';appGuideNext.className='secondary';appGuideNext.onclick=()=>appMoveGuide(1);
  appGuidePosition=document.createElement('span');appGuidePosition.setAttribute('aria-live','polite');appGuidePosition.setAttribute('aria-atomic','true');
  appGuideNavigation.append(appGuidePrevious,appGuidePosition,appGuideNext);track.before(appGuideNavigation);track.addEventListener('scroll',appUpdateGuideNavigation,{passive:true});
 }appUpdateGuideNavigation();
}
window.addEventListener('support-guides-ready',appInstallGuideNavigation);window.addEventListener('resize',appUpdateGuideNavigation);
window.addEventListener('app-language-changed',()=>{appUpdatePageTitle();appUpdateGuideNavigation();});
const appOriginalPage=page;
page=function(id){
 const next=id==='library'?'myRadio':id;
 if(next!==appCurrentPage){appRememberPosition();if(appCurrentPage==='support')appPauseSupportMedia();}
 appOriginalPage(id);appCurrentPage=next;appApplyMode();if(next==='support')appRestoreSupportMedia();
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
 if(shareRunning&&typeof stopWaitingForSharedStation==='function')stopWaitingForSharedStation();
 if(history.state?.radioLocalsApp?.panel==='station')history.back();else stationPopup.close();
}
function appOpenStationWifiHelp(){
 if(shareRunning||$('shared').hidden)return;
 const panel=history.state?.radioLocalsApp?.panel==='station';
 if(stationPopup.open){appPanelOrigin=null;stationPopup.close();}
 appShowPage('wifiSetup',{replace:panel,push:!panel,focus:$('listenerAppTitle')});
}
$('shareWifiHelp').onclick=appOpenStationWifiHelp;
// Station reports stay in the existing Help form. Context is submitted as a
// separate field so an existing message draft is never replaced or shortened.
function appClearStationProblemContext(){
 const form=$('ticketForm');form.elements.station_code.value='';$('ticketStationContext').hidden=true;$('ticketStationName').textContent='';
}
function appReportStationProblem({code,name}={}){
 code=String(code||'');const form=$('ticketForm');
 if(!/^[1-9][0-9]{1,5}$/.test(code)||shareRunning||window.radioControlsBusy||(typeof radioPairingBusy!=='undefined'&&radioPairingBusy)||form.dataset.busy==='1')return false;
 const stationName=String(name||'').trim().slice(0,120)||'Station '+code;
 form.elements.station_code.value=code;$('ticketStationName').textContent=stationName+' · #'+code;$('ticketStationContext').hidden=false;
 if(!form.elements.subject.value)form.elements.subject.value='Station problem';form.dataset.dirty='1';
 // Replacing the station-panel history entry makes Back return to Radio,
 // without reopening the add popup or starting another addition.
 const panel=history.state?.radioLocalsApp?.panel==='station';
 if(stationPopup.open){appPanelOrigin=null;stationPopup.close();}
 appHelp.dataset.expanded='1';appHelp.setAttribute('aria-expanded','true');
 appShowPage('support',{replace:panel,push:!panel});form.hidden=false;
 const generation=appNavigationGeneration;requestAnimationFrame(()=>{if(generation!==appNavigationGeneration||appCurrentPage!=='support')return;form.scrollIntoView?.({block:'start'});form.elements.message.focus({preventScroll:true});});
 return true;
}
window.openStationProblemReport=appReportStationProblem;
$('reportStationProblem')?.addEventListener('click',()=>{if(!$('shareForm').hidden)appReportStationProblem({code:sharedCode,name:$('shareName').textContent});});
$('clearTicketStation')?.addEventListener('click',()=>{if($('ticketForm').dataset.busy==='1')return;appClearStationProblemContext();$('ticketForm').dataset.dirty='1';});
$('ticketForm').addEventListener('reset',appClearStationProblemContext);
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
 if(!next){if(stationPopup.open){if(typeof stopWaitingForSharedStation==='function')stopWaitingForSharedStation();stationPopup.close();}return;}
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
 // The visible Back button always returns to Radio, even when a browser has
 // no usable previous history entry. Keep in-memory drafts and positions.
 if(backToRadio){appShowPage('myRadio',{replace:true,focus:$('openWifiSetup').hidden?$('navRadio'):$('openWifiSetup')});return;}
 appShowPage(next,{push:!backToRadio,replace:backToRadio,focus:next==='myRadio'?$('navRadio'):$('listenerAppTitle')});
},true);
const appHelp=document.createElement('button');appHelp.id='listenerSupportHelp';appHelp.type='button';appHelp.className='support-help';appHelp.textContent='Get help';appHelp.setAttribute('aria-expanded','false');
appHelp.onclick=()=>{const expanded=!appHelp.dataset.expanded;if(expanded)appHelp.dataset.expanded='1';else delete appHelp.dataset.expanded;$('ticketForm').hidden=!expanded;appHelp.setAttribute('aria-expanded',String(expanded));if(expanded)$('ticketForm').elements.name.focus();};$('ticketForm').before(appHelp);
if('scrollRestoration' in history)history.scrollRestoration='manual';
if(appIsListenerPage(appCurrentPage))appReplaceHistory(appHistoryValue());
appApplyMode();appDisplayMode.addEventListener?.('change',appApplyMode);
window.addEventListener('radio-locals-ready',()=>{appCurrentPage=appVisiblePage();appApplyMode();appInstallGuideNavigation();if(appIsListenerPage(appCurrentPage))appReplaceHistory(appHistoryValue());});
