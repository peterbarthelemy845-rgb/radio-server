(()=>{
 'use strict';
 const dialog=document.getElementById('policyPreview'),title=document.getElementById('policyPreviewTitle'),body=document.getElementById('policyPreviewBody'),notice=document.getElementById('policyPreviewStatus'),close=document.getElementById('closePolicyPreview'),retry=document.getElementById('retryPolicyPreview');
 if(!dialog||!title||!body||!notice||!close||!retry)return;
 const labels={terms:['policy.terms','Station Terms'],privacy:['policy.privacy','Privacy Notice']};
 let generation=0,activeKind='',sourcePanel=null,sourceGeneration=0,controller=null,cached=null,restoring=false;
 const text=(key,fallback)=>{const value=window.appI18n?.t(key);return value&&value!==key?value:fallback;};
 function status(key,fallback){notice.dataset.i18n=key;notice.textContent=text(key,fallback);notice.hidden=!fallback;}
 function current(view){return generation===view&&dialog.open&&sourcePanel&&!sourcePanel.hidden&&sourceGeneration===sitePageGeneration;}
 async function loadPolicy(){
  const view=++generation,kind=activeKind;controller?.abort();controller=new AbortController();
  body.replaceChildren();body.scrollTop=0;retry.hidden=true;status('policy.loading','Loading…');dialog.setAttribute('aria-busy','true');
  let timer;const requestController=controller;
  try{
   if(!cached){timer=setTimeout(()=>requestController.abort(),10000);const response=await fetch('/assets/policies.json',{credentials:'omit',cache:'no-cache',signal:controller.signal});if(!response.ok)throw Error('Policy unavailable');const result=await response.json();if(!current(view))return;cached=result;}
   if(!current(view))return;
   const policy=cached?.[kind];if(!Array.isArray(policy)||typeof policy[1]!=='string'||!policy[1]||policy[1].length>100000){cached=null;throw Error('Policy unavailable');}
   // This is the same bundled, public policy asset used by the legal pages.
   // Uploaded station content is never rendered in this reader.
   body.innerHTML=policy[1];status('','');
  }catch{if(current(view)){status('policy.failed','This page could not load. Please try again.');retry.hidden=false;}}
  finally{clearTimeout(timer);if(generation===view){dialog.removeAttribute('aria-busy');controller=null;}}
 }
 function openPolicy(kind,panel,fromHistory=false){
  if(!labels[kind]||!panel||panel.hidden||document.querySelector('dialog[open]')&&!dialog.open)return;
  sourcePanel=panel;sourceGeneration=sitePageGeneration;activeKind=kind;
  title.dataset.i18n=labels[kind][0];title.textContent=text(...labels[kind]);
  if(!dialog.open)dialog.showModal();close.focus({preventScroll:true});
  if(!fromHistory&&!history.state?.policyPreview)history.pushState({...history.state,policyPreview:{kind,panel:panel.id}},'',location.href);
  void loadPolicy();
 }
 close.onclick=()=>dialog.close();retry.onclick=()=>{void loadPolicy();};
 dialog.addEventListener('close',()=>{if(dialog.open)return;generation++;controller?.abort();controller=null;sourcePanel=null;activeKind='';dialog.removeAttribute('aria-busy');body.replaceChildren();if(!restoring&&history.state?.policyPreview)history.back();});
 document.addEventListener('click',event=>{
  if(event.button>0||event.ctrlKey||event.metaKey||event.shiftKey||event.altKey)return;
  const link=event.target.closest?.('a[href]'),panel=link?.closest('#register,#editor');if(!panel)return;
  let url;try{url=new URL(link.href,location.origin);}catch{return;}
  const kind=url.pathname.slice(1);if(url.origin!==location.origin||url.search||url.hash||!labels[kind])return;
  event.preventDefault();openPolicy(kind,panel);
 });
 window.addEventListener('popstate',event=>{
  restoring=true;
  try{const saved=event.state?.policyPreview;if(saved)openPolicy(saved.kind,document.getElementById(saved.panel),true);else if(dialog.open)dialog.close();}
  finally{restoring=false;}
 });
 new MutationObserver(()=>{if(dialog.open&&sourcePanel?.hidden){restoring=true;try{dialog.close();}finally{restoring=false;}}}).observe(document.querySelector('main'),{subtree:true,attributes:true,attributeFilter:['hidden']});
})();
