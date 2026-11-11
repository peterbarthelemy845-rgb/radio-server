(()=>{
 'use strict';
 const dialog=document.createElement('dialog');dialog.id='appActionPrompt';dialog.setAttribute('aria-labelledby','appActionTitle');dialog.setAttribute('aria-describedby','appActionText');
 const title=document.createElement('h2');title.id='appActionTitle';const text=document.createElement('p');text.id='appActionText';
 const form=document.createElement('form');form.id='appActionForm';form.noValidate=true;
 const label=document.createElement('label');label.htmlFor='appActionInput';const input=document.createElement('input');input.id='appActionInput';input.type='text';input.autocomplete='off';
 const error=document.createElement('p');error.id='appActionError';error.setAttribute('role','alert');error.hidden=true;input.setAttribute('aria-describedby','appActionError');
 const actions=document.createElement('div');actions.className='app-action-buttons';const cancel=document.createElement('button');cancel.id='appActionCancel';cancel.type='button';cancel.className='secondary';cancel.dataset.i18n='action.cancel';
 const accept=document.createElement('button');accept.id='appActionAccept';accept.type='submit';actions.append(cancel,accept);form.append(label,input,error,actions);dialog.append(title,text,form);document.body.append(dialog);
 let pending=null;
 function translated(key,fallback){const value=window.appI18n?.t(key);return typeof value==='string'&&value!==key?value:fallback;}
 function resetError(){error.hidden=true;error.textContent='';input.removeAttribute('aria-invalid');}
 function fail(key,fallback){error.textContent=translated(key,fallback).replace('{value}',String(pending?.options.match??''));error.hidden=false;input.setAttribute('aria-invalid','true');input.focus();}
 function finish(value){if(!pending)return;pending.result=value;dialog.close();}
 cancel.onclick=()=>finish(pending?.prompt?null:false);
 input.addEventListener('input',()=>{form.dataset.dirty='1';resetError();});
 form.addEventListener('submit',event=>{
  event.preventDefault();if(!pending)return;const {options,prompt}=pending,value=input.value.trim();
  if(prompt&&options.required&&!value){fail('action.required','Enter a value.');return;}
  if(prompt&&value.length>input.maxLength){fail('action.tooLong','Shorten this text.');return;}
  if(prompt&&options.match!==undefined&&value!==String(options.match)){fail('action.match', 'Type '+options.match+' to confirm.');return;}
  finish(prompt?value:true);
 });
 dialog.addEventListener('close',()=>{
  if(!pending)return;const previous=pending;pending=null;input.value='';delete form.dataset.dirty;resetError();previous.resolve(previous.result);
  if(previous.opener?.isConnected)previous.opener.focus({preventScroll:true});
 });
 // Escape and browser Back resolve as cancellation. They never submit a form.
 dialog.addEventListener('cancel',()=>{if(pending)pending.result=pending.prompt?null:false;});
 window.addEventListener('beforeunload',event=>{if(pending&&form.dataset.dirty){event.preventDefault();event.returnValue='';}});
 function open(prompt,heading,message,options={}){
  // Never replace an outstanding decision or inherit its eventual answer.
  if(pending||document.querySelector('dialog[open]'))return Promise.resolve(prompt?null:false);
  return new Promise(resolve=>{
   pending={prompt,options,resolve,result:prompt?null:false,opener:document.activeElement};title.textContent=heading;text.textContent=message||'';text.hidden=!message;
   label.textContent=options.label||translated('action.notes','Notes');label.hidden=!prompt;input.hidden=!prompt;input.value=options.value||'';input.maxLength=Number.isInteger(options.maxLength)&&options.maxLength>0?options.maxLength:1000;
   cancel.textContent=translated('action.cancel','Cancel');accept.textContent=options.confirmText||translated('action.confirm','Confirm');accept.className=options.danger?'app-action-danger':'';resetError();delete form.dataset.dirty;
   try{dialog.showModal();cancel.focus();}catch{const previous=pending;pending=null;previous.resolve(prompt?null:false);}
  });
 }
 window.appConfirm=(heading,message,options)=>open(false,heading,message,options);
 window.appPrompt=(heading,message,options)=>open(true,heading,message,options);
})();
