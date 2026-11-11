(()=>{
 'use strict';
 if(typeof HTMLDialogElement==='undefined'||!HTMLDialogElement.prototype.showModal)return;
 const original=HTMLDialogElement.prototype.showModal,records=new Map(),watched=new WeakSet();let serial=0,restoring=false,closingBack=0;
 const managed=dialog=>dialog.id!=='stationAddPopup'&&dialog.id!=='policyPreview'&&dialog!==window.radioControlsDialog;
 function removeMarker(){if(!history.state?.appDialog)return;const next={...history.state};delete next.appDialog;history.replaceState(next,'',location.href);}
 function consumeClosedMarker(){const marker=history.state?.appDialog;if(marker&&![...records].some(([dialog,record])=>dialog.open&&record.token===marker.token)){closingBack++;history.back();}}
 // Forward/reload must never replay an old approval or verification action.
 removeMarker();
 HTMLDialogElement.prototype.showModal=function(...args){
  const wasOpen=this.open,replaceClosed=!wasOpen&&[...records].some(([dialog,record])=>!dialog.open&&history.state?.appDialog?.token===record.token);
  const result=original.apply(this,args);if(!managed(this)||restoring||wasOpen)return result;
  if(!this.id)this.id='appPopup'+(++serial);
  const record={token:++serial,id:this.id};records.delete(this);records.set(this,record);
  // History can be unavailable or rate-limited. The dialog must still work;
  // never leave an opened approval prompt without its own Cancel handler.
  try{history[replaceClosed?'replaceState':'pushState']({...history.state,appDialog:record},'',location.href);}catch{records.delete(this);return result;}
  if(!watched.has(this)){
   watched.add(this);
   // A queued close can belong to an earlier opening of this same instance.
   // Keep one listener so that stale events cannot consume a new once-listener.
   this.addEventListener('close',()=>{
    if(this.open)return;const current=records.get(this);if(!current)return;
    records.delete(this);if(current.closedByBack){consumeClosedMarker();return;}if(restoring)return;
    if(history.state?.appDialog?.token===current.token){closingBack++;history.back();}
   });
  }
  return result;
 };
 window.addEventListener('popstate',event=>{
  const active=[...records].reverse().find(([dialog])=>dialog.open);
  if(active&&event.state?.appDialog?.token!==active[1].token){
   event.stopImmediatePropagation();const [dialog]=active,cancel=new Event('cancel',{cancelable:true});
   // Honor the dialog's existing protection during a deletion or verification.
   if(!dialog.dispatchEvent(cancel)){history.go(1);return;}
   active[1].closedByBack=true;restoring=true;try{dialog.close('cancelled');}finally{restoring=false;}
   return;
  }
  if(closingBack){closingBack--;event.stopImmediatePropagation();if(!active)consumeClosedMarker();return;}
  if(active&&event.state?.appDialog?.token===active[1].token){event.stopImmediatePropagation();return;}
  if(event.state?.appDialog&&!active){removeMarker();event.stopImmediatePropagation();}
 },true);
})();
