(()=>{
 'use strict';
 const categoryLabels={wifi:'Wi-Fi',device:'Device',playback:'Playback',station_account:'Station account',artwork:'Artwork',advertising:'Advertising',other:'Other'};
 function element(tag,text,className){const node=document.createElement(tag);if(text!==undefined)node.textContent=text;if(className)node.className=className;return node;}
 function button(text){const node=element('button',text,'secondary ai-admin-action');node.type='button';return node;}
 function active(host,check){const grant=document.getElementById('adminStations'),authorized=grant?!grant.hidden:!document.getElementById('admin')?.hidden;return host.isConnected&&authorized&&(!check||check());}
 function panel(host,title){const box=element('section',undefined,'ai-admin-assistant'),heading=element('h4',title),status=element('p','','ai-admin-status'),result=element('div',undefined,'ai-admin-result');status.setAttribute('role','status');box.append(heading,status,result);host.append(box);return {box,status,result};}
 function note(host,text){host.append(element('p',text,'ai-admin-note'));}
 function mountTicket({host,ticketId,replyInput,isActive}){
  if(!host||!replyInput||host.querySelector('.ai-ticket-assistant'))return;
  const ui=panel(host,'Support assistant');ui.box.classList.add('ai-ticket-assistant');
  const generate=button('Organize ticket & draft reply');ui.status.before(generate);
  note(ui.box,'Private AI suggestion. Review the draft before sending.');let generation=0,pending=false;
  generate.onclick=async()=>{
   if(pending||!active(host,isActive))return;pending=true;generate.disabled=true;const view=++generation;
   ui.result.replaceChildren();ui.status.textContent='Preparing a suggestion…';
   try{
    const response=await api('/api/admin/ai/ticket',{ticket_id:ticketId});if(view!==generation||!active(host,isActive))return;
    const data=response.data;if(!data||!Object.hasOwn(categoryLabels,data.category)||typeof data.summary!=='string'||typeof data.draft!=='string')throw new Error('This suggestion could not be displayed. Review the ticket manually.');
    ui.result.append(element('p',categoryLabels[data.category]+' · '+(data.priority==='high'?'Priority review':'Normal priority'),'ai-admin-label'),element('p',data.summary));
    const label=element('label','Suggested reply'),draft=element('textarea');draft.value=data.draft;draft.maxLength=3000;draft.rows=5;label.append(draft);
    const use=button('Use this draft');ui.result.append(label,use);note(ui.result,'Nothing is sent until you review the reply and press Send reply.');
    use.onclick=async()=>{
     if(!active(host,isActive)||replyInput.disabled)return;const value=draft.value.trim();if(!value)return;
     if(replyInput.value.trim()&&replyInput.value.trim()!==value){
      if(typeof appConfirm!=='function'||!await appConfirm('Replace your reply draft?','Your current text will be replaced with this suggestion.',{confirmText:'Replace draft'}))return;
      if(!active(host,isActive)||replyInput.disabled)return;
     }
     replyInput.value=value;replyInput.dispatchEvent(new Event('input',{bubbles:true}));replyInput.focus({preventScroll:true});ui.status.textContent='Draft copied. Review it, then use Send reply when ready.';
    };
    ui.status.textContent=response.cache_hit?'Saved suggestion for this ticket revision.':'Suggestion ready.';
   }catch(error){if(view===generation&&active(host,isActive))ui.status.textContent=error.message||'The assistant is unavailable. You can reply manually.';}
   finally{pending=false;if(view===generation&&active(host,isActive))generate.disabled=false;}
  };
 }
 function mountReview({host,type,id,isActive}){
  if(!host||!['station','ad'].includes(type)||host.querySelector('.ai-review-assistant'))return;
  const ui=panel(host,'Review assistant');ui.box.classList.add('ai-review-assistant');
  const generate=button('Explain review checks');ui.status.before(generate);note(ui.box,'Explains recorded evidence. You make the final decision.');let pending=false,generation=0;
  generate.onclick=async()=>{
   if(pending||!active(host,isActive))return;pending=true;generate.disabled=true;const view=++generation;ui.result.replaceChildren();ui.status.textContent='Preparing an explanation…';
   try{
    const response=await api('/api/admin/ai/review',{type,id});if(view!==generation||!active(host,isActive))return;
    const data=response.data;if(!data||typeof data.summary!=='string'||!Array.isArray(data.checks))throw new Error('This explanation could not be displayed. Review the content manually.');
    ui.result.append(element('p',data.summary));const list=element('ul');for(const check of data.checks)if(typeof check==='string')list.append(element('li',check));ui.result.append(list);
    if(Array.isArray(response.reasons)){const details=element('details');details.append(element('summary','Recorded evidence'));for(const reason of response.reasons)details.append(element('p',String(reason)));ui.result.append(details);}
    note(ui.result,'No new image scan or approval was performed.');ui.status.textContent='Explanation ready. Manual review is still required.';
   }catch(error){if(view===generation&&active(host,isActive))ui.status.textContent=error.message||'The assistant is unavailable. Continue manual review.';}
   finally{pending=false;if(view===generation&&active(host,isActive))generate.disabled=false;}
  };
 }
 const labelGenerations=new WeakMap();
 async function decorateTickets({records,host,isActive}){
  if(!host||!Array.isArray(records)||!active(host,isActive))return;
  const generation=(labelGenerations.get(host)||0)+1;labelGenerations.set(host,generation);
  const current=()=>labelGenerations.get(host)===generation&&active(host,isActive);
  // Each row is tagged by its own server record ID by the existing admin view.
  // Only read cached classifications: opening a queue never triggers model work.
  const rows=new Map([...host.querySelectorAll('[data-ai-ticket-id]')].map(row=>[row.dataset.aiTicketId,row]));
  const ids=[...new Set(records.filter(record=>record.kind==='support'&&rows.has(record.id)).map(record=>record.id))].slice(0,200),classifications=new Map();
  try{
   for(let start=0;start<ids.length;start+=50){
    const response=await api('/api/admin/ai/tickets?ids='+ids.slice(start,start+50).map(encodeURIComponent).join(','));if(!current())return;
    for(const item of response.tickets||[])if(ids.includes(item.ticket_id)&&Object.hasOwn(categoryLabels,item.category)&&['normal','high'].includes(item.priority))classifications.set(item.ticket_id,item);
   }
   if(!current())return;const pageRows=ids.map(id=>rows.get(id)).filter(row=>row.parentElement===host);if(!pageRows.length)return;
   for(const [id,item] of classifications){const row=rows.get(id);if(!row||row.parentElement!==host)continue;
    let label=row.querySelector('.ai-ticket-label');if(!label){label=element('p','','ai-ticket-label');row.append(label);}
    label.textContent=categoryLabels[item.category]+(item.priority==='high'&&item.unanswered?' · Priority review':'');
   }
   const anchor=pageRows.at(-1).nextSibling;
   // Stable sort inside this loaded page only; other queues and pages retain
   // their own order. AI labels do not change persistent ticket status.
   const urgent=row=>{const item=classifications.get(row.dataset.aiTicketId);return item?.priority==='high'&&item.unanswered===true?0:1;};
   for(const row of [...pageRows].sort((a,b)=>urgent(a)-urgent(b)))host.insertBefore(row,anchor);
  }catch{/* Cached AI labels are optional. Keep the original usable ticket list. */}
 }
 window.aiAdmin={mountTicket,mountReview,decorateTickets};
})();
