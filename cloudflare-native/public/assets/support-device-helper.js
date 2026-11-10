'use strict';
// Help may concern another device. Only replace a value this helper supplied;
// never persist Device Codes or infer one from a station's public code.
(()=>{
 const form=$('ticketForm'),field=form?.elements.device_code;if(!field)return;
 let radios=new Map(),autofilledValue='',autofilledRadio='',manuallyEdited=false;
 if(typeof radioCardViews!=='undefined')for(const [id,view] of radioCardViews)radios.set(String(id),view.radio);
 function autofillSupportDeviceCode(){
  if(manuallyEdited||form.dataset.busy==='1'||form.getAttribute('aria-busy')==='true'||field.disabled)return;
  const value=String(field.value||''),owned=!!autofilledRadio&&value===autofilledValue;
  if(value.trim()&&!owned)return;
  const selected=String(readSelectedRadio()||''),radio=radios.get(selected),code=radio?.device_code==null?'':String(radio.device_code).trim();
  if(code&&code.length<=32){field.value=code;autofilledValue=code;autofilledRadio=selected;}
  else if(owned){field.value='';autofilledValue='';autofilledRadio='';}
 }
 field.addEventListener('input',()=>{manuallyEdited=true;autofilledValue='';autofilledRadio='';});
 form.addEventListener('reset',()=>{manuallyEdited=false;autofilledValue='';autofilledRadio='';queueMicrotask(autofillSupportDeviceCode);});
 form.addEventListener('form-busy-changed',autofillSupportDeviceCode);
 window.addEventListener('radio-status-updated',event=>{if(Array.isArray(event.detail?.radios))radios=new Map(event.detail.radios.map(radio=>[String(radio.id),radio]));autofillSupportDeviceCode();});
 window.addEventListener('radio-selection-changed',autofillSupportDeviceCode);
 window.addEventListener('radio-locals-ready',autofillSupportDeviceCode);
 autofillSupportDeviceCode();
})();
