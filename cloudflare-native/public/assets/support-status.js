'use strict';
// Ticket contents remain in this page's memory, never local/session storage or URLs.
const supportStatusHost=$('supportTicketStatus');
function supportStatusNode(tag,key,text,className){const node=document.createElement(tag);if(key)node.dataset.i18n=key;if(text)node.textContent=text;if(className)node.className=className;return node;}
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
async function openSupportTicket(reference,silent=false){
 const generation=++supportStatusGeneration;
 if(!silent){statusDetails.open=true;statusNotice.dataset.i18n='supportStatus.loading';statusNotice.textContent='Checking ticket status…';}
 try{
  const result=await api('/api/support/status/ticket?reference='+encodeURIComponent(reference));if(generation!==supportStatusGeneration)return;
  supportStatusReference=reference;statusPrivate.replaceChildren();statusLookup.hidden=true;statusIntro.hidden=true;statusRecent.hidden=true;statusPrivate.hidden=false;statusNotice.textContent='';delete statusNotice.dataset.i18n;
  const title=supportPrivateText('h3',result.ticket.subject),state=supportTicketStateNode(result.ticket.state),created=supportPrivateText('p',supportStatusDate(result.ticket.created_at),'small');
  const referenceLine=document.createElement('p');referenceLine.className='support-ticket-reference';referenceLine.append(supportStatusNode('span','supportStatus.reference','Ticket reference'),document.createTextNode(': '),supportPrivateText('span',result.ticket.reference));
  const original=supportStatusNode('h4','supportStatus.original','Your message'),message=supportPrivateText('p',result.ticket.message,'support-ticket-body');
  const replies=supportStatusNode('h4','supportStatus.replies','Support replies');statusPrivate.append(title,state,created,referenceLine,original,message,replies);
  if(!(result.replies||[]).length)statusPrivate.append(supportStatusNode('p','supportStatus.noReplies','No reply yet. Your ticket status will update here.'));
  for(const reply of result.replies||[]){const card=document.createElement('article');card.className='support-ticket-reply';card.append(supportPrivateText('p',supportStatusDate(reply.created_at),'small'),supportPrivateText('p',reply.body,'support-ticket-body'));statusPrivate.append(card);}
  const checked=document.createElement('p');checked.className='small';checked.append(supportStatusNode('span','supportStatus.checked','Checked'),document.createTextNode(' '+new Date().toLocaleTimeString([],{hour:'numeric',minute:'2-digit'})));statusPrivate.append(checked);
  const actions=document.createElement('div');actions.className='support-ticket-actions';const refresh=supportStatusNode('button','supportStatus.refresh','Refresh status','secondary');refresh.type='button';refresh.onclick=()=>openSupportTicket(reference);const close=supportStatusNode('button','supportStatus.closePrivate','Close private ticket','secondary');close.type='button';close.onclick=async()=>{close.disabled=true;try{await api('/api/support/status/logout',{reference});clearSupportTicket();loadSupportTicketRecent();}catch(e){statusNotice.textContent=e.message;}finally{close.disabled=false;}};actions.append(refresh,close);statusPrivate.append(actions);
  supportStatusChanged();scheduleSupportTicketRefresh();
 }catch(e){if(generation!==supportStatusGeneration)return;if(e.status===401||e.status===403)clearSupportTicket();delete statusNotice.dataset.i18n;statusNotice.textContent=e.message;scheduleSupportTicketRefresh();}
}
function clearSupportTicket(){++supportStatusGeneration;supportStatusReference='';clearTimeout(supportStatusTimer);statusPrivate.replaceChildren();statusPrivate.hidden=true;statusLookup.hidden=false;statusIntro.hidden=false;statusRecent.hidden=false;statusNotice.textContent='';}
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
window.addEventListener('support-ticket-created',event=>{if(/^[a-f0-9]{32}$/.test(event.detail?.reference||'')){loadSupportTicketRecent();openSupportTicket(event.detail.reference);}});
window.addEventListener('app-language-changed',()=>{if(supportStatusReference)openSupportTicket(supportStatusReference,true);});
supportStatusChanged();
