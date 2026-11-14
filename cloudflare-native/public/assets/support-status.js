'use strict';
// Ticket contents remain in this page's memory, never local/session storage or URLs.
const supportStatusHost=$('supportTicketStatus');
function supportStatusNode(tag,key,text,className){const node=document.createElement(tag);if(key)node.dataset.i18n=key;if(text)node.textContent=text;if(className)node.className=className;return node;}
function supportReferenceText(key,fallback){const translated=window.appI18n?.t?.(key);return translated&&translated!==key?translated:fallback;}
function supportReferenceCopy(reference,current){
 const host=document.createElement('div');host.className='support-reference-actions';const copy=supportStatusNode('button','supportStatus.copyReference','Copy reference','secondary'),feedback=document.createElement('div');copy.type='button';feedback.className='support-reference-feedback';feedback.setAttribute('role','status');host.append(copy,feedback);
 copy.onclick=async()=>{
  if(copy.disabled||!current())return;copy.disabled=true;feedback.replaceChildren();
  try{
   if(typeof navigator==='undefined'||typeof navigator.clipboard?.writeText!=='function')throw Error('Clipboard unavailable');
   await navigator.clipboard.writeText(reference);if(!current())return;
   const text=supportStatusNode('p','supportStatus.referenceCopied',supportReferenceText('supportStatus.referenceCopied','Reference copied'));feedback.replaceChildren(text);
  }catch{
   if(!current())return;
   const label=document.createElement('label'),help=supportStatusNode('span','supportStatus.copyReferenceHelp',supportReferenceText('supportStatus.copyReferenceHelp','Select and copy your ticket reference.')),field=document.createElement('input');field.type='text';field.readOnly=true;field.value=reference;field.dataset.i18nSkip='true';field.onclick=()=>field.select();field.onfocus=()=>field.select();label.append(help,field);feedback.replaceChildren(label);field.focus();field.select();
  }finally{copy.disabled=false;}
 };
 return host;
}
const receiptReference=$('ticketReference'),receiptReferenceCopy=receiptReference?document.createElement('div'):null;
if(receiptReferenceCopy){receiptReferenceCopy.hidden=true;receiptReference.after(receiptReferenceCopy);}
function supportReceiptReference(reference){
 if(!receiptReferenceCopy||!/^[a-f0-9]{32}$/.test(reference))return;
 const actions=supportReferenceCopy(reference,()=>!!$('ticketSuccess')?.open&&receiptReferenceCopy.contains(actions));receiptReferenceCopy.replaceChildren(actions);receiptReferenceCopy.hidden=false;
}
function supportStatusChanged(){window.dispatchEvent(new Event('app-content-changed'));}
const statusDetails=document.createElement('details');statusDetails.className='support-ticket-tracker';
statusDetails.append(supportStatusNode('summary','supportStatus.title','My support ticket'));
const statusIntro=supportStatusNode('p','supportStatus.intro','View your ticket status and replies. Verify your email when using another browser.');
const statusRecent=document.createElement('div');statusRecent.className='support-ticket-recent';
const statusLookup=document.createElement('form');statusLookup.id='supportStatusLookup';
function supportStatusField(name,key,text,type='text'){const label=document.createElement('label');label.append(supportStatusNode('span',key,text));const input=document.createElement('input');input.name=name;input.type=type;input.required=true;label.append(input);statusLookup.append(label);return input;}
const statusReference=supportStatusField('reference','supportStatus.reference','Ticket reference');statusReference.maxLength=32;statusReference.pattern='[a-fA-F0-9]{32}';statusReference.autocomplete='off';statusReference.spellcheck=false;
const statusEmail=supportStatusField('email','supportStatus.email','Email used for this ticket','email');statusEmail.maxLength=254;statusEmail.autocomplete='email';
const statusHuman=document.createElement('div');statusHuman.className='human';statusLookup.append(statusHuman);
const statusRequest=supportStatusNode('button','supportStatus.sendCode','Email me a private code');statusRequest.type='submit';statusLookup.append(statusRequest);
const statusNotice=supportStatusNode('p',null,'','support-ticket-notice');statusNotice.setAttribute('role','status');
const statusPrivate=document.createElement('section');statusPrivate.className='support-ticket-private';statusPrivate.hidden=true;statusPrivate.setAttribute('aria-label','Your private support ticket');
statusDetails.append(statusIntro,statusRecent,statusLookup,statusNotice,statusPrivate);supportStatusHost.append(statusDetails);
const statusVerify=document.createElement('dialog');statusVerify.className='support-ticket-verification';statusVerify.setAttribute('aria-labelledby','supportStatusVerifyTitle');
const statusVerifyTitle=supportStatusNode('h2','supportStatus.verifyTitle','Verify your email');statusVerifyTitle.id='supportStatusVerifyTitle';
const statusVerifyHelp=supportStatusNode('p','supportStatus.verifyHelp','If the email and ticket reference match, a private code will arrive shortly. Enter the 6-digit code here. It expires in 15 minutes.');
const statusVerifyForm=document.createElement('form'),statusCodeLabel=document.createElement('label');statusCodeLabel.append(supportStatusNode('span','supportStatus.emailCode','6-digit email code'));
const statusCode=document.createElement('input');statusCode.name='code';statusCode.inputMode='numeric';statusCode.autocomplete='one-time-code';statusCode.pattern='[0-9]{6}';statusCode.maxLength=6;statusCode.required=true;statusCodeLabel.append(statusCode);statusVerifyForm.append(statusCodeLabel);
const statusVerifyButton=supportStatusNode('button','supportStatus.verifyButton','Verify and open ticket');statusVerifyButton.type='submit';statusVerifyForm.append(statusVerifyButton);
const statusVerifyNotice=document.createElement('p');statusVerifyNotice.setAttribute('role','status');
const statusCancel=supportStatusNode('button','supportStatus.cancel','Cancel','secondary');statusCancel.type='button';statusCancel.onclick=()=>{invalidateSupportStatusChallenge();statusVerify.close();};
statusVerify.append(statusVerifyTitle,statusVerifyHelp,statusVerifyForm,statusVerifyNotice,statusCancel);document.body.append(statusVerify);
let supportStatusVerification='',supportStatusReference='',supportStatusTimer,supportStatusGeneration=0,supportStatusChallengeGeneration=0,supportStatusLookupBusy=false,supportStatusVerifyBusy=false;
function invalidateSupportStatusChallenge(){supportStatusChallengeGeneration++;supportStatusVerification='';supportStatusLookupBusy=false;supportStatusVerifyBusy=false;busy(statusLookup,false);busy(statusVerifyForm,false);statusCode.value='';statusVerifyNotice.textContent='';}
function currentSupportStatusChallenge(generation,id){return generation===supportStatusChallengeGeneration&&supportStatusVerification===id&&statusVerify.open&&!$('support').hidden;}
function supportStatusVisibilityChanged(){
 if($('support').hidden&&(supportStatusLookupBusy||supportStatusVerifyBusy||supportStatusVerification||statusVerify.open)){invalidateSupportStatusChallenge();if(statusVerify.open)statusVerify.close();}
 scheduleSupportTicketRefresh();
}
const supportStatusLabels={new:['supportStatus.open','Open'],review:['supportStatus.review','In review'],closed:['supportStatus.closed','Closed']};
function supportTicketStateNode(state){const [key,label]=supportStatusLabels[state]||['supportStatus.open','Open'];return supportStatusNode('span',key,label,'support-ticket-state');}
function supportPrivateText(tag,text,className){const node=supportStatusNode(tag,null,text,className);node.dataset.i18nSkip='true';return node;}
function supportStatusDate(value){return new Date(value*1000).toLocaleString(window.appI18n?.language==='ht'?'fr-HT':'en-US',{dateStyle:'medium',timeStyle:'short'});}
async function loadSupportTicketRecent(){
 try{const result=await api('/api/support/status/recent');statusRecent.replaceChildren();for(const ticket of result.tickets||[]){const button=document.createElement('button');button.type='button';button.className='secondary';button.append(supportPrivateText('span',ticket.subject),supportTicketStateNode(ticket.state));button.onclick=()=>openSupportTicket(ticket.reference);statusRecent.append(button);}supportStatusChanged();}catch{}
}
function scheduleSupportTicketRefresh(){clearTimeout(supportStatusTimer);if(!supportStatusReference||document.hidden||$('support').hidden||!statusDetails.open)return;supportStatusTimer=setTimeout(()=>openSupportTicket(supportStatusReference,true),30000);}
let supportTicketView;
function supportTicketText(node,value){const text=String(value??'');if(node.textContent!==text)node.textContent=text;}
function supportTicketReadingPosition(){
 const selection=document.getSelection?.(),inside=node=>!!node&&statusPrivate.contains(node),selected=selection?.rangeCount&&!selection.isCollapsed&&(inside(selection.anchorNode)||inside(selection.focusNode));
 const saved=selected?{selection,anchor:selection.anchorNode,anchorOffset:selection.anchorOffset,focus:selection.focusNode,focusOffset:selection.focusOffset}:null;
 const selectedElement=selected?(selection.focusNode.nodeType===1?selection.focusNode:selection.focusNode.parentElement):null;
 const candidates=[selectedElement,document.activeElement,...statusPrivate.querySelectorAll('h3,p,h4,button')];
 const anchor=candidates.find(node=>{if(!inside(node)||!node.getBoundingClientRect)return false;const box=node.getBoundingClientRect();return box.height>0&&box.bottom>0&&box.top<(window.innerHeight||0);});
 return {saved,anchor,top:anchor?.getBoundingClientRect().top};
}
function restoreSupportTicketReadingPosition(position){
 const saved=position?.saved;
 if(saved?.anchor?.isConnected&&saved.focus?.isConnected)try{saved.selection.setBaseAndExtent(saved.anchor,saved.anchorOffset,saved.focus,saved.focusOffset);}catch{}
 if(position?.anchor?.isConnected){const shift=position.anchor.getBoundingClientRect().top-position.top;if(shift&&typeof window.scrollTo==='function')window.scrollTo(window.scrollX||0,(window.scrollY||0)+shift);}
}
function createSupportTicketView(reference){
 const title=supportPrivateText('h3',''),state=supportTicketStateNode('new'),created=supportPrivateText('p','','small');
 const referenceLine=document.createElement('p');referenceLine.className='support-ticket-reference';referenceLine.append(supportStatusNode('span','supportStatus.reference','Ticket reference'),document.createTextNode(': '),supportPrivateText('span',reference));
 const station=supportPrivateText('span','');station.hidden=true;referenceLine.append(station);
 const original=supportStatusNode('h4','supportStatus.original','Your message'),message=supportPrivateText('p','','support-ticket-body'),repliesTitle=supportStatusNode('h4','supportStatus.replies','Support replies'),replies=document.createElement('div');
 const noReplies=supportStatusNode('p','supportStatus.noReplies','No reply yet. Your ticket status will update here.');replies.append(noReplies);
 const checked=document.createElement('p');checked.className='small';const checkedTime=document.createTextNode('');checked.append(supportStatusNode('span','supportStatus.checked','Checked'),checkedTime);
 const actions=document.createElement('div');actions.className='support-ticket-actions';const refresh=supportStatusNode('button','supportStatus.refresh','Refresh status','secondary');refresh.type='button';refresh.onclick=()=>openSupportTicket(reference);
 const close=supportStatusNode('button','supportStatus.hidePrivate','Hide ticket','secondary');close.type='button';close.onclick=async()=>{close.disabled=true;try{await api('/api/support/status/logout',{reference});clearSupportTicket();loadSupportTicketRecent();}catch(e){statusNotice.textContent=e.message;}finally{close.disabled=false;}};
 const copy=supportReferenceCopy(reference,()=>supportTicketView?.reference===reference&&!$('support').hidden&&statusPrivate.contains(copy));
 actions.append(refresh,close);statusPrivate.replaceChildren(title,state,created,referenceLine,copy,original,message,repliesTitle,replies,checked,actions);
 return {reference,title,state,created,station,message,replies,noReplies,checkedTime,refresh,close,replyViews:new Map(),stateValue:null,snapshot:''};
}
function renderSupportTicket(reference,result,silent,previousReading=null){
 const sameTicket=supportTicketView?.reference===reference,view=sameTicket?supportTicketView:(supportTicketView=createSupportTicketView(reference)),ticket=result.ticket,replies=result.replies||[],language=window.appI18n?.language||'en';
 const snapshot=JSON.stringify([ticket.subject,ticket.state,ticket.created_at,ticket.message,ticket.station_code,ticket.station_name,replies,language]);
 const checkedText=' '+new Date().toLocaleTimeString([],{hour:'numeric',minute:'2-digit'}),reading=previousReading||(sameTicket&&silent&&(snapshot!==view.snapshot||view.checkedTime.textContent!==checkedText)?supportTicketReadingPosition():null);
 if(snapshot!==view.snapshot){
  supportTicketText(view.title,ticket.subject);supportTicketText(view.created,supportStatusDate(ticket.created_at));supportTicketText(view.message,ticket.message);
  view.station.hidden=!ticket.station_code;supportTicketText(view.station,ticket.station_code?' · '+String(ticket.station_name||'Station').toLocaleUpperCase()+' #'+ticket.station_code:'');
  if(view.stateValue!==ticket.state){const [key,label]=supportStatusLabels[ticket.state]||supportStatusLabels.new;view.state.dataset.i18n=key;view.state.textContent=window.appI18n?.t?.(key)||label;view.stateValue=ticket.state;}
  const occurrences=new Map(),next=replies.map(reply=>{const value=JSON.stringify([reply.created_at,reply.body]),count=occurrences.get(value)||0;occurrences.set(value,count+1);return {key:value+':'+count,reply};}),keys=new Set(next.map(item=>item.key));
  // Remove expired entries before reconciling order, so the usual append-only
  // response never detaches a reply the visitor is selecting or reading.
  for(const [key,item] of view.replyViews)if(!keys.has(key)){item.card.remove();view.replyViews.delete(key);}
  view.noReplies.hidden=!!next.length;
  for(let index=0;index<next.length;index++){
   const {key,reply}=next[index];let item=view.replyViews.get(key);
   if(!item){const card=document.createElement('article');card.className='support-ticket-reply';const created=supportPrivateText('p','','small'),body=supportPrivateText('p',reply.body,'support-ticket-body');card.append(created,body);item={card,created,body};view.replyViews.set(key,item);}
   supportTicketText(item.created,supportStatusDate(reply.created_at));const existing=view.replies.children[index+1];if(existing!==item.card)view.replies.insertBefore(item.card,existing||null);
  }
  view.snapshot=snapshot;
 }
 supportTicketText(view.checkedTime,checkedText);restoreSupportTicketReadingPosition(reading);
}
async function openSupportTicket(reference,silent=false){
 const generation=++supportStatusGeneration;
 if(!silent){statusDetails.open=true;statusNotice.dataset.i18n='supportStatus.loading';statusNotice.textContent='Checking ticket status…';}
 try{
  const result=await api('/api/support/status/ticket?reference='+encodeURIComponent(reference));if(generation!==supportStatusGeneration)return;
  const reading=silent&&supportTicketView?.reference===reference&&statusNotice.textContent?supportTicketReadingPosition():null;
  supportStatusReference=reference;statusLookup.hidden=true;statusIntro.hidden=true;statusRecent.hidden=true;statusPrivate.hidden=false;statusNotice.textContent='';delete statusNotice.dataset.i18n;renderSupportTicket(reference,result,silent,reading);
  supportStatusChanged();scheduleSupportTicketRefresh();
 }catch(e){if(generation!==supportStatusGeneration)return;const expired=e.status===401||e.status===403,reading=!expired&&silent&&supportTicketView?.reference===reference?supportTicketReadingPosition():null;if(expired)clearSupportTicket();delete statusNotice.dataset.i18n;statusNotice.textContent=e.message;restoreSupportTicketReadingPosition(reading);scheduleSupportTicketRefresh();}
}
function clearSupportTicket(){++supportStatusGeneration;supportStatusReference='';supportTicketView=null;clearTimeout(supportStatusTimer);statusPrivate.replaceChildren();statusPrivate.hidden=true;statusLookup.hidden=false;statusIntro.hidden=false;statusRecent.hidden=false;statusNotice.textContent='';}
statusLookup.onsubmit=async event=>{
 event.preventDefault();if(supportStatusLookupBusy||statusVerify.open||$('support').hidden)return;
 const generation=++supportStatusChallengeGeneration,reference=statusReference.value.trim().toLowerCase(),email=statusEmail.value;
 supportStatusVerification='';supportStatusLookupBusy=true;busy(statusLookup,true,true);statusNotice.textContent='';
 try{const turnstile_token=await human(statusLookup,'support-status');if(generation!==supportStatusChallengeGeneration||$('support').hidden)return;const result=await api('/api/support/status/request',{reference,email,turnstile_token});if(generation!==supportStatusChallengeGeneration||$('support').hidden)return;supportStatusVerification=result.verification_id;statusCode.value='';statusVerifyNotice.textContent='';if(!statusVerify.open)statusVerify.showModal();statusCode.focus();}
 catch(e){if(generation===supportStatusChallengeGeneration){delete statusNotice.dataset.i18n;statusNotice.textContent=e.message;}}
 finally{if(generation===supportStatusChallengeGeneration){supportStatusLookupBusy=false;busy(statusLookup,false);}supportStatusChanged();}
};
statusVerifyForm.onsubmit=async event=>{
 event.preventDefault();if(supportStatusVerifyBusy||!supportStatusVerification||!statusVerify.open)return;
 const generation=supportStatusChallengeGeneration,id=supportStatusVerification,code=statusCode.value;supportStatusVerifyBusy=true;busy(statusVerifyForm,true,true);
 try{const result=await api('/api/support/status/verify',{verification_id:id,code});if(!currentSupportStatusChallenge(generation,id))return;invalidateSupportStatusChallenge();statusVerify.close();statusLookup.reset();await openSupportTicket(result.reference);}
 catch(e){if(currentSupportStatusChallenge(generation,id))statusVerifyNotice.textContent=e.message;}
 finally{if(generation===supportStatusChallengeGeneration){supportStatusVerifyBusy=false;busy(statusVerifyForm,false);}supportStatusChanged();}
};
statusVerify.addEventListener('cancel',invalidateSupportStatusChallenge);
statusVerify.addEventListener('close',()=>{if(!statusVerify.open&&supportStatusVerification)invalidateSupportStatusChallenge();});
statusDetails.addEventListener('toggle',()=>{if(statusDetails.open&&!supportStatusReference)loadSupportTicketRecent();scheduleSupportTicketRefresh();});document.addEventListener('visibilitychange',scheduleSupportTicketRefresh);new MutationObserver(supportStatusVisibilityChanged).observe($('support'),{attributes:true,attributeFilter:['hidden']});
window.addEventListener('radio-locals-ready',loadSupportTicketRecent);if(typeof state!=='undefined'&&state)loadSupportTicketRecent();
window.addEventListener('support-ticket-created',event=>{if(/^[a-f0-9]{32}$/.test(event.detail?.reference||'')){supportReceiptReference(event.detail.reference);loadSupportTicketRecent();openSupportTicket(event.detail.reference);}});
window.addEventListener('app-language-changed',()=>{if(supportStatusReference)openSupportTicket(supportStatusReference,true);});
supportStatusChanged();
