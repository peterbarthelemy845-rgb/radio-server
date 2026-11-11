'use strict';
const reportsPage=document.createElement('section');reportsPage.id='reports';reportsPage.className='card operations';reportsPage.hidden=true;reportsPage.innerHTML='<button class="secondary" id="reportsBack">Back</button><h1>Station reports</h1><label>Month (UTC)<input type="month" id="reportMonth"></label><div id="reportResults"></div><p id="reportMessage" role="status"></p>';
const backupsPage=document.createElement('section');backupsPage.id='backups';backupsPage.className='card operations';backupsPage.hidden=true;backupsPage.innerHTML='<button class="secondary" id="backupsBack">Back</button><h1>Backup & recovery</h1><p>Daily encrypted snapshots at 05:00 UTC, kept for 14 days. Includes station records and referenced artwork/ad images. Cloudflare secrets are not included.</p><button id="createBackup">Create backup now</button><p id="backupMessage" role="status"></p><div id="backupRecords"></div>';
document.querySelector('main').append(reportsPage,backupsPage);let adminReport=false,reportRequestGeneration=0,backupRequestGeneration=0,operationsViewGeneration=0,backupActionPending=false;
const operationsPage=page;
page=function(id){
 operationsViewGeneration++;
 if(id!=='reports'){reportRequestGeneration++;$('reportResults').replaceChildren();$('reportMessage').textContent='';}
 if(id!=='backups'){backupRequestGeneration++;$('backupRecords').replaceChildren();$('backupMessage').textContent='';}
 return operationsPage(id);
};
function currentReportRequest(generation,view){return generation===reportRequestGeneration&&view===operationsViewGeneration&&!$('reports').hidden;}
function currentBackupRequest(generation,view){return generation===backupRequestGeneration&&view===operationsViewGeneration&&!$('backups').hidden;}
const ownerReportButton=document.createElement('button');ownerReportButton.className='secondary';ownerReportButton.textContent='Listening & sharing reports';ownerReportButton.onclick=()=>showReports(false);$('editor').append(ownerReportButton);
for(const [label,action] of [['Station reports',()=>showReports(true)],['Backup & recovery',showBackups]]){const button=document.createElement('button');button.className='secondary';button.textContent=label;button.onclick=action;$('admin').append(button);}
$('reportsBack').onclick=()=>page(adminReport?'admin':'editor');$('backupsBack').onclick=()=>page('admin');$('reportMonth').value=new Date().toISOString().slice(0,7);$('reportMonth').onchange=()=>showReports(adminReport);
function reportCell(tag,text){const cell=document.createElement(tag);cell.textContent=text;return cell;}
async function showReports(administrator){
 const generation=++reportRequestGeneration,month=$('reportMonth').value;adminReport=administrator;page('reports');const view=operationsViewGeneration;
 $('reportResults').replaceChildren();$('reportMessage').textContent='Loading reports…';
 try{
  const result=await api((administrator?'/api/admin/reports':'/api/owner/reports')+'?month='+encodeURIComponent(month));if(!currentReportRequest(generation,view))return false;
  for(const station of result.stations){const box=document.createElement('article'),title=document.createElement('h2');title.textContent=station.name+' · #'+station.code;const stats=document.createElement('div');stats.className='report-stats';for(const [label,value] of [['Active radios this month',station.active_radios],['Reported listening hours',(station.reported_seconds/3600).toFixed(1)],['Reporting listening now',station.listening_now],['Share-button clicks',station.share_clicks]]){const item=document.createElement('div'),n=document.createElement('strong'),text=document.createElement('span');n.textContent=value;text.textContent=label;item.append(n,text);stats.append(item);}const breakdown=document.createElement('p');breakdown.className='small';breakdown.textContent=result.shares.filter(s=>s.station_code===station.code).map(s=>s.channel+': '+s.clicks).join(' · ')||'No share clicks recorded.';box.append(title,stats,breakdown);$('reportResults').append(box);}
  if(!result.stations.length)$('reportResults').textContent='No station activity yet.';const plan=document.createElement('p');plan.className='plan-note';plan.textContent='Proposed monthly plans: 0–10 active radios Free · 11–100 $30 · 101–300 $50 · Above 300 Contact us. Billing is not active.';$('reportResults').append(plan);$('reportMessage').textContent=result.note+' An active radio requires at least 60 seconds of continuous reports; counts are distinct per station per calendar month (UTC).';return true;
 }catch(e){if(currentReportRequest(generation,view))$('reportMessage').textContent=e.message;return false;}
}
async function showBackups(){
 const generation=++backupRequestGeneration;page('backups');const view=operationsViewGeneration;$('backupRecords').replaceChildren();$('backupMessage').textContent='Loading backups…';
 try{
  const result=await api('/api/admin/backups');if(!currentBackupRequest(generation,view))return false;
  for(const backup of result.backups){
   const row=document.createElement('article'),title=document.createElement('h3'),details=document.createElement('p');title.textContent=new Date(backup.created_at*1000).toLocaleString()+' · '+backup.state;details.textContent=backup.kind+' · '+(backup.record_count||0)+' records · '+(backup.media_count||0)+' media files';row.append(title,details);
   if(backup.state==='ready'){
    const restore=document.createElement('button');restore.className='secondary';restore.textContent='Restore saved records';restore.disabled=backupActionPending;
    restore.onclick=async()=>{
     if(backupActionPending||!currentBackupRequest(generation,view))return;backupActionPending=true;restore.disabled=true;
     try{const confirmation=await appPrompt('Restore backup','Restore this snapshot? Matching record IDs will be replaced; newer records are kept. Owners and phones will be signed out. Type RESTORE to confirm.',{required:true,maxLength:7,match:'RESTORE',label:'Type RESTORE',confirmText:'Restore',danger:true});if(confirmation!=='RESTORE'||!currentBackupRequest(generation,view))return;
      $('createBackup').disabled=true;for(const button of $('backupRecords').querySelectorAll('button'))button.disabled=true;
      const response=await api('/api/admin/backups',{action:'restore',id:backup.id,confirm:confirmation});if(currentBackupRequest(generation,view))$('backupMessage').textContent=response.message;}
     catch(e){if(currentBackupRequest(generation,view))$('backupMessage').textContent=e.message;}
     finally{backupActionPending=false;$('createBackup').disabled=false;for(const button of $('backupRecords').querySelectorAll('button'))button.disabled=false;}
    };row.append(restore);
   }
   if(backup.error){const error=document.createElement('p');error.textContent=backup.error;row.append(error);}$('backupRecords').append(row);
  }
  $('backupMessage').textContent=result.note;if(!result.backups.length)$('backupRecords').textContent='No snapshots yet. Create your first backup.';return true;
 }catch(e){if(currentBackupRequest(generation,view))$('backupMessage').textContent=e.message;return false;}
}
$('createBackup').onclick=async()=>{
 const button=$('createBackup'),generation=backupRequestGeneration,view=operationsViewGeneration;if(backupActionPending||button.disabled||!currentBackupRequest(generation,view))return;
 backupActionPending=true;button.disabled=true;$('backupRecords').replaceChildren();$('backupMessage').textContent='Creating encrypted backup…';
 try{await api('/api/admin/backups',{action:'create'});if(currentBackupRequest(generation,view))await showBackups();}
 catch(e){if(currentBackupRequest(generation,view))$('backupMessage').textContent=e.message;}
 finally{backupActionPending=false;button.disabled=false;for(const restore of $('backupRecords').querySelectorAll('button'))restore.disabled=false;}
};
let adPreviewUrl;$('advertiseForm').elements.artwork.addEventListener('change',event=>{if(adPreviewUrl)URL.revokeObjectURL(adPreviewUrl);const file=event.target.files[0],preview=$('adUploadPreview');preview.hidden=!file;if(file){adPreviewUrl=URL.createObjectURL(file);preview.src=adPreviewUrl;}});

let requestedViewOpened=false;
function openRequestedView(){if(requestedViewOpened)return;const view=new URLSearchParams(location.search).get('view');if(!view)return;if(location.pathname==='/admin'&&!$('adminStations').hidden){requestedViewOpened=true;if(view==='ads')showAds(true);if(view==='reports')showReports(true);if(view==='backups')showBackups();}else if(location.pathname==='/station-edit'&&state?.owner_station){requestedViewOpened=true;if(view==='ads')showAds(false);if(view==='reports')showReports(false);}}
window.addEventListener('radio-locals-ready',openRequestedView);new MutationObserver(openRequestedView).observe($('adminStations'),{attributes:true,attributeFilter:['hidden']});
