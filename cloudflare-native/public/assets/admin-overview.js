'use strict';
const overviewCard=document.createElement('section');overviewCard.id='adminOverview';overviewCard.hidden=true;overviewCard.className='admin-overview';
const overviewHeading=document.createElement('h2');overviewHeading.textContent='Overview';
const overviewGrid=document.createElement('div');overviewGrid.className='admin-overview-grid';
const overviewStatus=document.createElement('p');overviewStatus.className='small';overviewStatus.setAttribute('role','status');
const overviewRefresh=document.createElement('button');overviewRefresh.type='button';overviewRefresh.className='secondary';overviewRefresh.textContent='Refresh overview';
overviewCard.append(overviewHeading,overviewGrid,overviewStatus,overviewRefresh);$('adminStations').before(overviewCard);
let overviewLoading=false;
async function loadAdminOverview(){if(overviewLoading||$('adminStations').hidden)return;overviewLoading=true;overviewRefresh.disabled=true;try{const data=await api('/api/admin/overview');if($('adminStations').hidden)return;overviewGrid.replaceChildren();for(const [label,key] of [['Stations awaiting review','pending_stations'],['Ads awaiting approval','pending_ads'],['Open support tickets','open_tickets'],['Radios online','online_radios'],['Failed emails · 7 days','failed_emails_7_days'],['Emails queued','queued_emails']]){const tile=document.createElement('div'),value=document.createElement('strong'),name=document.createElement('span');value.textContent=String(data[key]);name.textContent=label;tile.append(value,name);overviewGrid.append(tile);}overviewStatus.textContent='Updated '+new Date(data.checked_at*1000).toLocaleTimeString([], {hour:'numeric',minute:'2-digit'})+'. Radio status is based on reports within two minutes.';}catch(e){overviewStatus.textContent=e.message;}finally{overviewLoading=false;overviewRefresh.disabled=false;}}
overviewRefresh.onclick=loadAdminOverview;
new MutationObserver(()=>{overviewCard.hidden=$('adminStations').hidden;if(overviewCard.hidden){overviewGrid.replaceChildren();overviewStatus.textContent='';}else loadAdminOverview();}).observe($('adminStations'),{attributes:true,attributeFilter:['hidden']});
window.addEventListener('admin-data-changed',()=>{if(!overviewCard.hidden)loadAdminOverview();});
if(!$('adminStations').hidden){overviewCard.hidden=false;loadAdminOverview();}
