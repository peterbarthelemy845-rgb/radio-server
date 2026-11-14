(()=>{
 'use strict';
 const admin=document.getElementById('admin'),grant=document.getElementById('adminStations');
 if(!admin||!grant||document.getElementById('aiOperationsPanel'))return;
 const el=(tag,text,className)=>{const node=document.createElement(tag);if(text)node.textContent=text;if(className)node.className=className;return node;};
 const panel=el('details',null,'ai-operations-panel');panel.id='aiOperationsPanel';panel.hidden=grant.hidden;
 const title=el('summary','AI operations'),body=el('div',null,'ai-operations-body');
 const notice=el('p','Summaries are suggestions. Sending replies, approving content and deleting records stay under your control.','small');
 const controls=el('div',null,'ai-operations-controls'),monthLabel=el('label','Month (UTC)'),month=el('input');month.type='month';month.value=new Date().toISOString().slice(0,7);monthLabel.append(month);
 const summarize=el('button','Prepare report'),refresh=el('button','Refresh checks','secondary');summarize.type=refresh.type='button';controls.append(monthLabel,summarize,refresh);
 const status=el('p',null,'small');status.setAttribute('role','status');const result=el('div');body.append(notice,controls,status,result);panel.append(title,body);admin.append(panel);
 let version=0,loading=false,writing=false;
 function active(generation){return version===generation&&!grant.hidden&&!panel.hidden&&panel.open;}
 function timestamp(value){return value?new Date(value*1000).toLocaleString():'Not checked yet';}
 function list(parent,title,items){if(!Array.isArray(items)||!items.length)return;parent.append(el('h4',title));const ul=el('ul');for(const item of items.slice(0,3))if(typeof item==='string')ul.append(el('li',item));parent.append(ul);}
 function report(data){
  const card=el('article',null,'ai-report-summary');card.append(el('h3','Admin report'));
  if(!data){card.append(el('p','Your first daily summary will appear here.'));return card;}
  const summary=data.summary||{};card.append(el('p',summary.summary||'A summary is not available.'),el('p',(summary.source==='ai'?'AI summary':'Measured report')+' · '+timestamp(data.generated_at),'small'));
  list(card,'Needs attention',summary.attention);list(card,'Suggested next steps',summary.next_steps);
  const metrics=data.metrics||{},facts=el('dl',null,'ai-operations-facts');
  for(const [label,value] of [['Distinct active radios',metrics.distinct_active_radios],['Reported listening hours',Number(metrics.reported_listening_seconds||0)/3600],['Share-button clicks',metrics.share_button_clicks],['Open support tickets',metrics.open_support_tickets],['Pending content reviews',Number(metrics.pending_station_reviews||0)+Number(metrics.pending_ad_reviews||0)],['Failed email jobs (7 days)',metrics.failed_email_jobs_7_days]])facts.append(el('dt',label),el('dd',typeof value==='number'?Number.isInteger(value)?String(value):value.toFixed(1):'0'));
  card.append(facts,el('p','Device reports are not verified people or listening. Share-button clicks do not confirm a completed share.','small'));return card;
 }
 function render(data){
  result.replaceChildren(report(data.report));
  const allowance=data.allowance;if(allowance)result.prepend(el('p','AI allowance: '+allowance.day_requests+' / '+allowance.daily_limit+' requests today · '+allowance.month_requests+' / '+allowance.monthly_limit+' this month.','small'));
  const streams=el('details',null,'ai-stream-checks');streams.append(el('summary','Stream checks'));
  if(!data.stream_monitor_enabled)streams.append(el('p','Scheduled stream checks are not enabled.'));
  else if(!data.health?.length)streams.append(el('p','Published stations will be checked automatically. No checks have completed yet.'));
  for(const row of data.health||[]){const card=el('article',null,'ai-stream-observation');card.append(el('h4',row.name+' · #'+row.station_code),el('p',row.stale?'Check is stale':row.result==='audio_response'?'Audio response detected':'Stream needs checking',row.stale||row.result!=='audio_response'?'ai-needs-check':'ai-check-ok'),el('p','Checked '+timestamp(row.checked_at),'small'));
   if(row.explanation?.summary){card.append(el('p',row.explanation.summary));list(card,'Suggested next steps',row.explanation.next_steps);}
   else if(row.result!=='audio_response')card.append(el('p','Ask the owner to confirm the public stream details and whether their broadcaster is running.','small'));
   streams.append(card);
  }
  streams.append(el('p',data.note||'Checks sample audio responses. Playback is not verified.','small'));result.append(streams);
  if(!data.enabled)status.textContent='AI is unavailable. Existing reports and checks remain readable.';
 }
 async function load(){if(loading||writing||!panel.open||grant.hidden)return;loading=true;const generation=++version;refresh.disabled=true;status.textContent='Loading…';
  try{const data=await api('/api/admin/ai/operations');if(active(generation)){status.textContent='';render(data);}}
  catch(error){if(active(generation))status.textContent=error.message;}
  finally{if(version===generation){loading=false;refresh.disabled=false;}}
 }
 panel.addEventListener('toggle',()=>{if(panel.open)void load();else{version++;loading=false;refresh.disabled=false;}});refresh.onclick=()=>void load();
 summarize.onclick=async()=>{if(writing||loading||grant.hidden||!panel.open)return;if(!/^20\d{2}-(0[1-9]|1[0-2])$/.test(month.value)){status.textContent='Choose a valid month.';month.focus();return;}writing=true;summarize.disabled=refresh.disabled=month.disabled=true;const generation=version;status.textContent='Preparing report…';
  try{const data=await api('/api/admin/ai/report',{month:month.value});if(active(generation)){if(data.state==='busy')status.textContent=data.message;else{result.replaceChildren(report(data));status.textContent=data.state==='ready'?'Report ready.':'AI is unavailable. Measured totals are shown.';}}}
  catch(error){if(active(generation))status.textContent=error.message;}
  finally{writing=false;summarize.disabled=refresh.disabled=month.disabled=false;}
 };
 new MutationObserver(()=>{panel.hidden=grant.hidden;if(grant.hidden){version++;panel.open=false;loading=false;status.textContent='';result.replaceChildren();refresh.disabled=false;}}).observe(grant,{attributes:true,attributeFilter:['hidden']});
})();
