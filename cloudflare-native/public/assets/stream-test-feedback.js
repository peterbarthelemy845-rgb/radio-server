(()=>{
 'use strict';
 const sources={registration:{page:'register',button:'testStream'},owner:{page:'editor',button:'testOwnerStream'}};
 const dialog=document.createElement('dialog');dialog.id='streamTestResult';dialog.setAttribute('aria-labelledby','streamTestResultTitle');dialog.setAttribute('aria-describedby','streamTestResultText');
 const icon=document.createElement('span');icon.id='streamTestResultIcon';icon.setAttribute('aria-hidden','true');icon.textContent='✓';icon.hidden=true;
 const title=document.createElement('h2');title.id='streamTestResultTitle';
 const message=document.createElement('p');message.id='streamTestResultText';
 const done=document.createElement('button');done.type='button';done.id='closeStreamTestResult';dialog.append(icon,title,message,done);document.body.append(dialog);
 let pending=null;
 const text=(key,fallback)=>{const value=window.appI18n?.t(key);return typeof value==='string'&&value!==key?value:fallback;};
 function render(){if(!pending)return;icon.hidden=dialog.dataset.state!=='success';title.textContent=text('registration.testResult','Stream test');message.textContent=pending.key?text(pending.key,pending.fallback):pending.fallback;done.textContent=text('done','Done');}
 done.onclick=()=>dialog.close();
 dialog.addEventListener('close',()=>{
  const previous=pending;pending=null;if(!previous)return;
  const page=document.getElementById(sources[previous.source].page),opener=previous.opener;
  if(!document.hidden&&page&&!page.hidden&&!document.querySelector('dialog[open]')&&opener?.isConnected&&!opener.disabled)opener.focus({preventScroll:true});
 });
 // The caller keeps ownership of its request; this helper only presents a
 // completed result. Never interrupt another decision or open in a hidden tab.
 window.showStreamTestResult=({source,key='',fallback='',state}={})=>{
  if(!Object.hasOwn(sources,source)||!['success','unconfirmed','error'].includes(state)||pending||document.hidden||document.querySelector('dialog[open]'))return false;
  const page=document.getElementById(sources[source].page);if(!page||page.hidden)return false;
  pending={source,key,fallback:String(fallback).slice(0,400),opener:document.getElementById(sources[source].button)};dialog.dataset.state=state;render();
  try{dialog.showModal();done.focus();return true;}catch{pending=null;return false;}
 };
 window.closeStreamTestResult=source=>{if(pending?.source===source&&dialog.open)dialog.close();};
 window.addEventListener('app-language-changed',render);
})();
