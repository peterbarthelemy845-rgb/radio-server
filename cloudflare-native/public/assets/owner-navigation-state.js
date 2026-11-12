(()=>{
 'use strict';
 // Authentication stays in the server session. This is only its in-memory
 // navigation view; switching pages or browser tabs never signs an owner out.
 const button=document.getElementById('navAdd');if(!button)return;
 let station=null,deadline=0,timer;
 function active(){return !!station&&deadline>Date.now();}
 function render(){
  const signedIn=active(),key=signedIn?'navAccount':'navCreate',fallback=signedIn?'Station account':'Create station';
  let label=button.querySelector('span');if(!label){label=document.createElement('span');button.append(label);}
  label.dataset.i18n=key;const translated=window.appI18n?.t(key),text=translated&&translated!==key?translated:fallback;
  if(label.textContent!==text)label.textContent=text;
  button.dataset.ownerState=signedIn?'signed-in':'signed-out';
 }
 function clear(){
  station=null;deadline=0;clearTimeout(timer);timer=undefined;render();
 }
 function checkExpiry(){
  clearTimeout(timer);timer=undefined;
  if(station&&deadline&&deadline<=Date.now()){
   // Revoke only the local view. Keep an unsaved editor draft for re-login.
   if(typeof clearOwnerSession==='function')clearOwnerSession();else clear();
   return;
  }
  render();if(station&&deadline)timer=setTimeout(checkExpiry,Math.min(2147483647,Math.max(1,deadline-Date.now())));
 }
 function accept(snapshot){
  if(!snapshot||typeof snapshot!=='object')return;
  if(Object.hasOwn(snapshot,'owner_station')){
   const next=snapshot.owner_station||null;
   if(String(next)!==String(station)&&!Object.hasOwn(snapshot,'owner_expires'))deadline=0;
   station=next;
  }
  if(Object.hasOwn(snapshot,'owner_expires')){
   const now=Number.isFinite(snapshot.server_time)?snapshot.server_time:Date.now()/1000;
   deadline=Number.isFinite(snapshot.owner_expires)&&snapshot.owner_expires>0?Date.now()+Math.max(0,snapshot.owner_expires-now)*1000:0;
  }
  if(!station){deadline=0;clearTimeout(timer);timer=undefined;render();return;}
  checkExpiry();
 }
 window.ownerAccountNavigation={active,accept,clear,render};
 window.addEventListener('owner-session-updated',event=>accept(event.detail));
 window.addEventListener('app-language-changed',render);
 window.addEventListener('pageshow',checkExpiry);
 document.addEventListener('visibilitychange',checkExpiry);
 // The shared menu decorator can rebuild its icon and text span.
 new MutationObserver(render).observe(button,{childList:true});
 if(typeof state!=='undefined'&&state)accept(state);else render();
})();
