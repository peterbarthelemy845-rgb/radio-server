'use strict';
const adminTools=document.createElement('section');adminTools.hidden=true;adminTools.className='admin-support-tools';
adminTools.innerHTML='<hr><h2>Support and requests</h2><div class="support-tool-buttons"><button id="loadLegal" class="secondary">Support tickets</button><button id="loadRequests" class="secondary">Legal & other requests</button><button id="loadVideos" class="secondary">Manage support videos</button></div><div id="toolRecords"></div><form id="videoForm" hidden><h3>Add support video</h3><label>Topic<select name="topic"><option value="setup">Getting started</option><option value="wifi">Wi-Fi</option><option value="stations">Stations</option><option value="troubleshooting">Troubleshooting</option></select></label><label>Title<input name="title" maxlength="100" required></label><label>Description<textarea name="description" maxlength="500"></textarea></label><label>YouTube video ID<input name="video_id" pattern="[-A-Za-z0-9_]{11}" maxlength="11" required placeholder="11-character video ID"></label><button>Add video</button></form><p id="toolsMessage" role="status"></p>';
document.getElementById('admin').append(adminTools);
let adminToolView=0,adminRequestCursor='',adminRequestSupport=null,adminRequestsLoading=false;const supportSubmissions=new Map();
adminTools.hidden=$('adminStations').hidden;
new MutationObserver(()=>{adminTools.hidden=$('adminStations').hidden;if(adminTools.hidden){adminToolView++;adminRequestCursor='';adminRequestSupport=null;adminRequestsLoading=false;supportSubmissions.clear();$('toolRecords').replaceChildren();$('videoForm').hidden=true;$('toolsMessage').textContent='';}}).observe($('adminStations'),{attributes:true,attributeFilter:['hidden']});
const supportStateLabel=value=>({new:'Open',review:'In review',closed:'Closed'}[value]||value);
const supportTime=value=>new Date(value*1000).toLocaleString();
function supportText(tag,value,className){const element=document.createElement(tag);element.textContent=value;if(className)element.className=className;return element;}
function supportViewActive(view){return view===adminToolView&&!adminTools.hidden;}
function supportChanged(){window.dispatchEvent(new CustomEvent('admin-data-changed'));}
async function showSupportTicket(id,draft=''){
 const view=++adminToolView;$('videoForm').hidden=true;$('toolsMessage').textContent='Loading ticket…';
 try{const thread=await api('/api/admin/support?ticket_id='+encodeURIComponent(id));if(!supportViewActive(view))return;renderSupportTicket(thread,view,draft);$('toolsMessage').textContent='';}catch(error){if(supportViewActive(view))$('toolsMessage').textContent=error.message;}
}
function renderSupportTicket(thread,view,draft='',notice=''){
 const record=thread.ticket,box=document.createElement('article');box.className='support-ticket-detail';
 const back=supportText('button','Back to support tickets','secondary');back.type='button';back.onclick=()=>loadAdminRequests(true);
 const refresh=supportText('button','Refresh replies','secondary');refresh.type='button';refresh.onclick=()=>showSupportTicket(record.id,textarea.value);box.append(back,refresh,supportText('h3',record.payload.subject||'Support ticket'));
 box.append(supportText('p','Reference: '+record.id+' · '+supportStateLabel(record.state),'support-meta'),supportText('p','Received '+supportTime(record.created_at),'support-meta'));
 const sender=[record.payload.name,record.payload.email].filter(Boolean).join(' · ');box.append(supportText('p',sender,'support-meta'));
 if(record.payload.device_code)box.append(supportText('p','Device code: '+record.payload.device_code,'support-meta'));
 if(record.payload.station_code)box.append(supportText('p','Station: '+(record.payload.station_name||'Station')+' · #'+record.payload.station_code,'support-meta'));
 box.append(supportText('h4','Original message'),supportText('p',record.payload.message||'','support-message'));
 box.append(supportText('h4','Replies'));
 if(!thread.messages.length)box.append(supportText('p','No replies yet.','support-meta'));
 for(const message of thread.messages){
  const item=document.createElement('article');item.className='support-reply';
  const delivery={pending:'Queued for email',sending:'Email delivery in progress',sent:'Email accepted by the mail service',failed:'Email delivery failed',unavailable:'Email delivery status unavailable'}[message.delivery.state]||'Email delivery status unavailable';
  item.append(supportText('p',supportTime(message.created_at)+' · '+delivery,'support-meta'),supportText('p','To: '+message.recipient,'support-meta'),supportText('p',message.body,'support-message'));box.append(item);
 }
 const form=document.createElement('form');form.className='support-compose';
 const statusLabel=supportText('label','Ticket status'),select=document.createElement('select');select.name='state';
 for(const value of ['new','review','closed']){const option=supportText('option',supportStateLabel(value));option.value=value;select.append(option);}select.value=record.state;statusLabel.append(select);
 const save=supportText('button','Save status','secondary');save.type='button';
 const replyLabel=supportText('label','Reply to '+record.payload.email),textarea=document.createElement('textarea');textarea.name='reply';textarea.maxLength=4000;textarea.rows=7;textarea.required=true;textarea.value=draft;replyLabel.append(textarea);
 const counter=supportText('p',textarea.value.length+' / 4,000 characters','support-meta');textarea.addEventListener('input',()=>{counter.textContent=textarea.value.length+' / 4,000 characters';});
 const send=supportText('button','Send reply');send.type='submit';
 const feedback=supportText('p',notice,'support-feedback');feedback.setAttribute('role','status');
 form.append(statusLabel,save,replyLabel,counter,supportText('p','Replies go to the email address submitted with this ticket. Sending queues an email; delivery status appears above.','support-meta'),send,feedback);box.append(form);
 let writing=false;
 async function update(withReply){
  if(writing)return;
  const reply=withReply?textarea.value.trim():'';
  if(withReply&&!reply){feedback.textContent='Enter a reply before sending.';textarea.focus();return;}
  const values={ticket_id:record.id,state:select.value,reply},signature=JSON.stringify(values);
  if(!supportSubmissions.has(signature))supportSubmissions.set(signature,crypto.randomUUID());
  const requestId=supportSubmissions.get(signature);writing=true;
  const keptDraft=withReply?'':textarea.value;busy(form,true);textarea.disabled=true;select.disabled=true;back.disabled=true;refresh.disabled=true;feedback.textContent=withReply?'Saving reply and queuing email…':'Saving status…';
  let accepted=false;
  try{
   const result=await api('/api/admin/support',{...values,request_id:requestId});accepted=true;supportSubmissions.delete(signature);supportChanged();
   if(!supportViewActive(view))return;feedback.textContent=result.message;
   if(withReply)textarea.value='';
   try{const updated=await api('/api/admin/support?ticket_id='+encodeURIComponent(record.id));if(supportViewActive(view))renderSupportTicket(updated,view,keptDraft,result.message);}catch(error){if(supportViewActive(view))feedback.textContent=result.message+' Reload this ticket to update its history.';}
  }catch(error){if(supportViewActive(view))feedback.textContent=error.message+(!accepted&&!error.status&&withReply?' The reply may already be queued. Retry with the same text to avoid a duplicate.':'');}
  finally{writing=false;busy(form,false);textarea.disabled=false;select.disabled=false;back.disabled=false;refresh.disabled=false;}
 }
 form.onsubmit=event=>{event.preventDefault();update(true);};save.onclick=()=>update(false);
 if(thread.history.length){const details=document.createElement('details');details.append(supportText('summary','Status history'));for(const action of thread.history)details.append(supportText('p',supportTime(action.created_at)+' · '+supportStateLabel(action.action)+(action.notes?' · '+action.notes:''),'support-meta'));box.append(details);}
 $('toolRecords').replaceChildren(box);
}
async function loadAdminRequests(supportOnly,more=false){
 if(more&&(adminRequestsLoading||!adminRequestCursor||adminRequestSupport!==supportOnly))return;
 const view=more?adminToolView:++adminToolView,cursor=more?adminRequestCursor:'';
 if(!more){adminRequestCursor='';adminRequestSupport=supportOnly;}
 const previousMore=$('adminRequestsMore');if(previousMore)previousMore.disabled=true;
 adminRequestsLoading=true;$('videoForm').hidden=true;$('toolsMessage').textContent='Loading requests…';
 try{
  const result=await api('/api/admin/legal?kind='+(supportOnly?'support':'legal')+(cursor?'&cursor='+encodeURIComponent(cursor):''));if(!supportViewActive(view))return;
  if(!more){$('toolRecords').replaceChildren();$('toolRecords').append(supportText('h3',supportOnly?'Support tickets':'Legal & other requests'));}else previousMore?.remove();
  const records=result.requests;
  for(const record of records){
   const box=document.createElement('article');box.className='support-ticket-summary';
   box.append(supportText('h4',(supportOnly?(record.payload.subject||'Support ticket'):record.kind)+' · '+supportStateLabel(record.state)),supportText('p','Reference: '+record.id+' · '+supportTime(record.created_at),'support-meta'));
   if(supportOnly){
    box.append(supportText('p',[record.payload.name,record.payload.email].filter(Boolean).join(' · '),'support-meta'));
    const open=supportText('button','View / reply','secondary');open.type='button';open.onclick=()=>showSupportTicket(record.id);box.append(open);
   }else{
    box.append(supportText('pre',Object.entries(record.payload).map(([key,value])=>key+': '+String(value)).join('\n'),'support-message'));
    for(const state of ['review','closed']){const button=supportText('button',state==='review'?'Mark in review':'Close request','secondary');button.type='button';button.onclick=async()=>{const notes=await appPrompt(state==='review'?'Mark request in review':'Close request','Private review notes (optional):',{maxLength:4000,confirmText:state==='review'?'Save status':'Close request'});if(notes===null||!supportViewActive(view))return;button.disabled=true;try{await api('/api/admin/legal',{id:record.id,state,notes});supportChanged();if(supportViewActive(view)){await loadAdminRequests(false);$('toolsMessage').textContent='Request updated.';}}catch(error){if(supportViewActive(view))$('toolsMessage').textContent=error.message;}finally{button.disabled=false;}};box.append(button);}
   }
   $('toolRecords').append(box);
  }
  if(!records.length&&!more)$('toolRecords').append(supportText('p',supportOnly?'No support tickets.':'No legal or other requests.'));
  adminRequestCursor=result.has_more?result.next_cursor||'':'';
  if(adminRequestCursor){const button=supportText('button',supportOnly?'Load more tickets':'Load more requests','secondary');button.id='adminRequestsMore';button.type='button';button.onclick=()=>loadAdminRequests(supportOnly,true);$('toolRecords').append(button);}
  $('toolsMessage').textContent='';
 }catch(error){if(supportViewActive(view))$('toolsMessage').textContent=error.message;}
 finally{if(supportViewActive(view))adminRequestsLoading=false;if(previousMore)previousMore.disabled=false;}
}
$('loadLegal').onclick=()=>loadAdminRequests(true);
$('loadRequests').onclick=()=>loadAdminRequests(false);
$('loadVideos').onclick=async()=>{const view=++adminToolView;try{const result=await api('/api/admin/videos');if(!supportViewActive(view))return;$('toolsMessage').textContent='';$('toolRecords').replaceChildren();$('videoForm').hidden=false;for(const video of result.videos){const box=supportText('p',video.topic+' · '+video.title+' '),remove=supportText('button','Remove video','secondary');remove.type='button';remove.onclick=async()=>{if(!await appConfirm('Remove support video','Remove this support video?',{confirmText:'Remove video',danger:true})||!supportViewActive(view))return;remove.disabled=true;try{await api('/api/admin/videos',{action:'delete',id:video.id});if(supportViewActive(view))await $('loadVideos').onclick();}catch(error){if(supportViewActive(view))$('toolsMessage').textContent=error.message;}finally{remove.disabled=false;}};box.append(remove);$('toolRecords').append(box);}}catch(error){if(supportViewActive(view))$('toolsMessage').textContent=error.message;}};
$('videoForm').onsubmit=async event=>{event.preventDefault();const form=event.target,view=adminToolView;busy(form,true);try{await api('/api/admin/videos',Object.fromEntries(new FormData(form)));if(supportViewActive(view)){form.reset();await $('loadVideos').onclick();$('toolsMessage').textContent='Video added.';}}catch(error){if(supportViewActive(view))$('toolsMessage').textContent=error.message;}finally{busy(form,false);}};
