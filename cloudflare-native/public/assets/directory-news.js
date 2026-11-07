'use strict';
function shareButton(label,kind,name,url){const button=document.createElement('button');button.className='social '+kind;button.setAttribute('aria-label',label);button.title=label;button.textContent={facebook:'f',whatsapp:'◉',more:'•••'}[kind];if(kind==='whatsapp')button.innerHTML='<svg viewBox="0 0 32 32" aria-hidden="true"><path d="M7 26l1-5a11 11 0 1 1 4 4z" fill="none" stroke="currentColor" stroke-width="2.5"/><path d="M12 10q-2 4 5 9l3-1 2 3q-5 5-12-5-3-5 0-7z" fill="currentColor"/></svg>';if(kind==='more')button.innerHTML='<svg viewBox="0 0 32 32" aria-hidden="true"><path d="M5 7h22v16H14l-6 5v-5H5z" fill="currentColor"/><g fill="#119e47"><circle cx="10" cy="15" r="1.6"/><circle cx="16" cy="15" r="1.6"/><circle cx="22" cy="15" r="1.6"/></g></svg>';button.onclick=async()=>{api('/api/events',{event_id:crypto.randomUUID().replaceAll('-',''),station_code:url.split('/').pop(),channel:kind}).catch(()=>{});if(kind==='facebook'||kind==='whatsapp'){const target=kind==='facebook'?'https://www.facebook.com/sharer/sharer.php?u='+encodeURIComponent(url):'https://wa.me/?text='+encodeURIComponent(name+' '+url);window.open(target,'_blank','noopener,noreferrer');}else try{if(navigator.share)await navigator.share({title:name,url});else{await navigator.clipboard.writeText(url);button.title='Link copied';}}catch{}};return button;}
list=function(){
 const query=$('search').value.trim().toLowerCase(),found=stations.filter(s=>(s.name+' '+s.listener_code).toLowerCase().includes(query));
 $('stations').replaceChildren();$('stationCount').textContent='';
 for(const station of found){
  const tile=document.createElement('button');tile.type='button';tile.className='station-logo-tile';tile.setAttribute('aria-label','Add '+station.name+' to your radio');tile.title=station.name;tile.setAttribute('aria-haspopup','dialog');
  const image=document.createElement('img');image.src=station.logo_url||'/assets/logo-placeholder.svg';image.alt='';image.loading='lazy';image.width=96;image.height=96;
  tile.append(image);tile.onclick=()=>openStationPopup(station.listener_code);const item=document.createElement('div');item.className='station-slider-item';const name=document.createElement('p');name.className='station-tile-name';name.textContent=station.name;item.append(tile,name);$('stations').append(item);
 }
 if(!found.length){const empty=document.createElement('p');empty.className='station-slider-empty';empty.textContent=query?'No matching stations.':'No stations yet.';$('stations').append(empty);}
};
$('search').oninput=list;
const libraryHelp=$('library').querySelector('details');if(libraryHelp)$('search').after(libraryHelp);

window.addEventListener('radio-locals-ready',list);

// Match registration and sign-in to the compact white owner card.
$('register').append($('openLogin'));$('login').append($('openRegister'));
$('login').querySelector('h1').innerHTML='Sign in<small>Edit your station</small>';
const coverInput=$('registerForm').elements.artwork,coverLabel=coverInput.closest('label');
const coverRow=document.createElement('div');coverRow.className='cover-upload';
const coverPreview=document.createElement('img');coverPreview.className='cover-preview';coverPreview.alt='No logo uploaded yet';coverPreview.src='/assets/logo-placeholder.svg';
const coverHint=document.createElement('span');coverHint.className='cover-hint';coverHint.textContent='No logo uploaded yet';coverInput.before(coverHint);coverRow.append(coverPreview,coverLabel);$('registerForm').prepend(coverRow);
let coverPreviewUrl;
coverInput.addEventListener('change',()=>{if(coverPreviewUrl)URL.revokeObjectURL(coverPreviewUrl);const file=coverInput.files[0];if(file){coverPreviewUrl=URL.createObjectURL(file);coverPreview.src=coverPreviewUrl;coverPreview.alt='Station cover preview';coverHint.textContent='Selected logo';}else{coverPreview.src='/assets/logo-placeholder.svg';coverPreview.alt='No logo uploaded yet';coverHint.textContent='No logo uploaded yet';}});

function highlightMenu(){const active=!$('myRadio').hidden?'navRadio':!$('library').hidden?'navLibrary':!$('support').hidden?'support':'navAdd';for(const tab of document.querySelectorAll('nav[aria-label="Main navigation"] > *')){if(tab.id===active||(active==='support'&&tab.getAttribute('href')==='/support'))tab.setAttribute('aria-current','page');else tab.removeAttribute('aria-current');}}
new MutationObserver(highlightMenu).observe(document.querySelector('main'),{attributes:true,attributeFilter:['hidden'],subtree:true});highlightMenu();

// One consistent outline icon family above the persistent menu labels.
const menuIconPaths={navRadio:'<rect x="4" y="7" width="16" height="13" rx="3"/><path d="m7 7 10-4M8 11h8"/><circle cx="9" cy="16" r="2"/><path d="M15 15h2m-2 3h2"/>',navLibrary:'<rect x="4" y="4" width="4" height="16" rx="1"/><rect x="10" y="4" width="4" height="16" rx="1"/><path d="m17 5 4 14-3 1-4-14z"/>',navAdd:'<rect x="4" y="4" width="16" height="16" rx="4"/><path d="M12 8v8m-4-4h8"/>',support:'<path d="M4 13v-1a8 8 0 0 1 16 0v1"/><rect x="3" y="11" width="4" height="7" rx="2"/><rect x="17" y="11" width="4" height="7" rx="2"/><path d="M19 18c0 2-2 3-5 3h-2"/>'};
for(const tab of document.querySelectorAll('nav[aria-label="Main navigation"] > *')){const label=tab.textContent,icon=menuIconPaths[tab.id||'support'];tab.innerHTML='<svg class="nav-icon" viewBox="0 0 24 24" aria-hidden="true">'+icon+'</svg>';const text=document.createElement('span');text.textContent=label;tab.append(text);}

const stationPopup=document.createElement('dialog');stationPopup.id='stationAddPopup';stationPopup.setAttribute('aria-label','Add station to your radio');
const stationPopupClose=document.createElement('button');stationPopupClose.className='station-popup-close';stationPopupClose.textContent='Close';stationPopupClose.onclick=()=>stationPopup.close();stationPopup.append(stationPopupClose);document.body.append(stationPopup);
stationPopup.addEventListener('close',()=>{$('shared').hidden=true;});
async function openStationPopup(code){if(shareRunning)return;stationPopup.append($('shared'));$('shared').hidden=false;$('shareForm').hidden=true;$('otherRadio').hidden=true;$('shareArt').hidden=true;$('shareName').textContent='Loading station…';$('shareStatus').textContent='';stationPopup.querySelector('.station-popup-share')?.remove();const selected=stations.find(s=>String(s.listener_code)===String(code));if(selected){const share=shareButton('Share station','more',selected.name,location.origin+'/station/'+code);share.className='station-popup-share secondary';share.textContent='Share station';stationPopup.append(share);}stationPopup.showModal();try{await openShared(code,true);}catch(e){$('shareStatus').textContent=e.message;}}
