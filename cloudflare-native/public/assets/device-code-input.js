(()=>{
 'use strict';
 const fields=new Map();let nextId=0;
 const key='deviceCode.invalid',fallback='Enter the complete Device Code shown on your radio.';
 function message(){const translated=window.appI18n?.t(key);return translated&&translated!==key?translated:fallback;}
 function removeDescription(input,id,previous){
  const remaining=(input.getAttribute('aria-describedby')||'').split(/\s+/).filter(token=>token&&token!==id).join(' ');
  if(remaining)input.setAttribute('aria-describedby',remaining);
  else if(previous==='')input.setAttribute('aria-describedby','');
  else input.removeAttribute('aria-describedby');
 }
 function clear(state){
  if(!state.invalid)return;
  state.invalid=false;state.error.hidden=true;state.error.textContent='';
  removeDescription(state.input,state.error.id,state.description);
  if(state.input.getAttribute('aria-invalid')==='true'){
   if(state.previousInvalid===null)state.input.removeAttribute('aria-invalid');
   else state.input.setAttribute('aria-invalid',state.previousInvalid);
  }
 }
 function bind(input){
  if(fields.has(input))return fields.get(input);
  const label=input.closest?.('label'),error=document.createElement('span');error.id=(input.form?.id||'radioConnection')+'DeviceCodeError_'+(++nextId);error.className='device-code-error';error.setAttribute('role','alert');error.dataset.i18n=key;error.hidden=true;(label||input).after(error);
  const state={input,label,error,invalid:false,description:null,previousInvalid:null};fields.set(input,state);
  // Keep validation separate from the accessible label. The shared form hides
  // this whole label when switching back to an already linked radio.
  if(label)new MutationObserver(()=>{error.hidden=!state.invalid||label.hidden;}).observe(label,{attributes:true,attributeFilter:['hidden']});
  input.addEventListener('input',()=>clear(state));
  input.addEventListener('invalid',event=>{event.preventDefault();validate(input);});
  input.form?.addEventListener('reset',()=>clear(state));
  return state;
 }
 function validate(input){
  if(!input)return null;
  const state=bind(input),code=String(input.value||'').trim().replace(/[\s-]/g,'').toUpperCase();
  // Match the server's numeric codes and older eight-character codes exactly.
  // Do not coerce to a number, remove other punctuation, or lose leading zeroes.
  if(/^(?:[0-9]{4,8}|[A-Z0-9]{8})$/.test(code)){input.value=code;clear(state);return code;}
  if(!state.invalid){state.description=input.getAttribute('aria-describedby');state.previousInvalid=input.getAttribute('aria-invalid');}
  state.invalid=true;state.error.textContent=message();state.error.hidden=!!state.label?.hidden;input.setAttribute('aria-invalid','true');
  const described=new Set((input.getAttribute('aria-describedby')||'').split(/\s+/).filter(Boolean));described.add(state.error.id);input.setAttribute('aria-describedby',[...described].join(' '));input.focus();return null;
 }
 window.validateDeviceCodeInput=validate;
 for(const id of ['connectRadioForm','shareForm']){const input=document.getElementById(id)?.elements.device_code;if(input)bind(input);}
 window.addEventListener('app-language-changed',()=>{for(const state of fields.values())if(state.invalid)state.error.textContent=message();});
})();
