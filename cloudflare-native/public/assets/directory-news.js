'use strict';
function shareButton(label,name,url,{standalone=false}={}){
 const button=document.createElement('button');button.type='button';button.setAttribute('aria-label',label);button.title=label;button.textContent=label;let running=false;
 button.onclick=async()=>{
  const popup=button.closest('dialog'),host=standalone?button.parentElement:popup,current=()=>button.isConnected&&(!standalone?popup?.open&&button.closest('dialog')===popup:button.parentElement===host&&!$('myRadio').hidden)&&!shareRunning;
  if(running||!current())return;
  // Only public station links belong in either the system share sheet or the
  // manual fallback. Pairing codes and query parameters never enter sharing.
  let publicUrl;try{publicUrl=new URL(url,location.origin);if(publicUrl.origin!==location.origin||!/^\/station\/[1-9][0-9]{1,5}$/.test(publicUrl.pathname)||publicUrl.search||publicUrl.hash)return;}catch{return;}
  running=true;button.disabled=true;host.querySelector('.station-share-feedback')?.remove();
  api('/api/events',{event_id:crypto.randomUUID().replaceAll('-',''),station_code:publicUrl.pathname.split('/').pop(),channel:'more'}).catch(()=>{});
  try{
   if(typeof navigator.share==='function')try{await navigator.share({title:name,url:publicUrl.href});return;}catch(error){if(error?.name==='AbortError'||!current())return;}
   if(!current())return;
   try{
    if(typeof navigator.clipboard?.writeText!=='function')throw Error('Clipboard unavailable');
    await navigator.clipboard.writeText(publicUrl.href);if(!current())return;
    const status=document.createElement('p');status.className='station-share-feedback';status.setAttribute('role','status');status.setAttribute('data-i18n','sharing.copied');status.textContent='Link copied';button.after(status);
   }catch{
    if(!current())return;
    const feedback=document.createElement('div');feedback.className='station-share-feedback';const label=document.createElement('label'),help=document.createElement('span');help.setAttribute('role','status');help.setAttribute('data-i18n','sharing.copyHelp');help.textContent='Copy this link to share the station.';
    const link=document.createElement('input');link.type='text';link.readOnly=true;link.value=publicUrl.href;link.setAttribute('data-i18n-skip','');link.onclick=()=>link.select();link.onfocus=()=>link.select();label.append(help,link);feedback.append(label);button.after(feedback);link.focus();
   }
  }finally{running=false;button.disabled=false;}
 };
 return button;
}
let stationListSnapshot='';
function renderStationSlider(track,found,emptyText,saved=false){
 const active=document.activeElement,focusedItem=track.contains?.(active)?active.closest?.('.station-slider-item'):null;
 const focusedCode=focusedItem?.getAttribute?.('data-station-code'),focusedIndex=focusedItem?[...track.children].indexOf(focusedItem):-1;
 track.replaceChildren();
 for(const station of found){
  const tile=document.createElement('button');tile.type='button';tile.className='station-logo-tile';tile.setAttribute('aria-label',station.name+(saved?' — on your radio':' — add to your radio'));tile.title=station.name;tile.setAttribute('aria-haspopup','dialog');
  const image=document.createElement('img');let triedOriginal=!station.logo_thumb_url||!station.logo_url||station.logo_thumb_url===station.logo_url;
  image.onerror=()=>{if(!triedOriginal){triedOriginal=true;image.src=station.logo_url;}else{image.onerror=null;image.src='/assets/logo-placeholder.svg';}};image.src=station.logo_thumb_url||station.logo_url||'/assets/logo-placeholder.svg';image.alt='';image.loading='lazy';image.width=96;image.height=96;
  const name=document.createElement('span');name.className='station-tile-name';name.textContent=station.name;
  const feedback=document.createElement('span');feedback.className='station-tile-delivery';feedback.setAttribute('aria-hidden','true');
  let adding;
  tile.updateDeliveryStatus=()=>{
   const radioId=typeof readSelectedRadio==='function'?readSelectedRadio():'',delivery=radioId&&typeof stationDeliveries!=='undefined'?stationDeliveries.get(String(radioId)+'|'+String(station.listener_code)):null,pending=delivery?.state==='sending'||delivery?.state==='pending';
   if(adding===pending)return;adding=pending;
   tile.setAttribute('aria-busy',String(pending));
   if(pending){feedback.setAttribute('data-i18n','busy.adding');const text=typeof window!=='undefined'?window.appI18n?.t('busy.adding'):null;feedback.textContent=text&&text!=='busy.adding'?text:'Adding…';}
   else{feedback.removeAttribute('data-i18n');feedback.textContent='';}
  };
  tile.append(image,name,feedback);tile.onclick=()=>openStationPopup(station.listener_code,{autoAdd:!saved});const item=document.createElement('div');item.className='station-slider-item';item.setAttribute('data-station-code',String(station.listener_code));item.append(tile);
  track.append(item);tile.updateDeliveryStatus();
 }
 if(!found.length){const empty=document.createElement('p');empty.className='station-slider-empty';empty.textContent=emptyText;track.append(empty);}
 if(typeof updateStationSliderControls==='function')updateStationSliderControls(track);
 if(focusedIndex>=0&&!document.hidden&&(typeof $!=='function'||!$('myRadio')?.hidden)&&!document.querySelector?.('dialog[open]')){const items=[...track.children].filter(item=>item.className==='station-slider-item'),item=items.find(item=>item.getAttribute?.('data-station-code')===focusedCode)||items[Math.min(focusedIndex,items.length-1)],target=item?.children[0]||(typeof $==='function'?$('search'):null);target?.focus?.({preventScroll:true});}
}
list=function(){
 const fold=value=>String(value).normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase(),query=fold($('search').value.slice(0,96).trim().replace(/^#\s*(?=\d)/,'')),radioId=typeof readSelectedRadio==='function'?readSelectedRadio():'',inventory=typeof readRadioInventory==='function'?readRadioInventory(radioId):null,known=!!inventory?.known;
 if(radioId&&typeof loadRadioInventory==='function')loadRadioInventory(radioId);
 const directory=typeof readStationDirectoryState==='function'?readStationDirectoryState():null,savedCodes=known?inventory.codes:new Set(),matches=s=>fold(s.name+' '+s.listener_code).includes(query);
 const saved=known?[...savedCodes].map(code=>(typeof getSavedStationMetadata==='function'?getSavedStationMetadata(code):null)||stations.find(s=>String(s.listener_code)===code)||(typeof getStationDirectoryStation==='function'?getStationDirectoryStation(code):null)||{listener_code:code,name:'Station '+code,logo_url:''}).filter(matches):[];
 // The server expands the entered ZIP to nearby stations; do not discard a
 // nearby result merely because its own postal code differs from the search.
 const zip_code=directory?.zip_code||'',category=directory?.category||'',filtered=!!(zip_code||category),current=!directory||directory.loadedQuery===query&&(directory.loadedZipCode||'')===zip_code&&(directory.loadedCategory||'')===category,available=current?stations.filter(s=>!savedCodes.has(String(s.listener_code))&&matches(s)&&(!category||s.category===category)):[];
 const hint=!radioId?'':inventory?.stale?'Saved stations not checked. Showing the last known list.':inventory?.unavailable?'Saved stations could not be checked. Try refreshing your radio status.':inventory&&!known?'Saved list updates after a radio software update.':'';
 const waiting=directory?.loading?'Loading stations…':directory?.hasMore?'More stations may match. Load more to continue.':directory?.failed?'Stations could not load. Try again.':'';
 const snapshot=JSON.stringify([radioId,known,query,zip_code,category,hint,saved,available,available.length?'':waiting]);if(snapshot===stationListSnapshot)return;stationListSnapshot=snapshot;
 $('stationCount').textContent='';$('savedStationsSection').hidden=!known||saved.length===0;$('stationInventoryHelp').textContent=hint;$('stationInventoryHelp').hidden=!hint;
 $('clearStationSearch').hidden=!query||saved.length+available.length>0||!!directory?.loading||!!directory?.hasMore;
 renderStationSlider($('savedStations'),saved,query?'No matching saved stations.':'No saved stations reported.',true);
 renderStationSlider($('stations'),available,waiting||(filtered?'No stations match these filters.':query?'No matching available stations.':known?'No more stations available.':'No stations yet.'));
};
$('search').oninput=list;
if(typeof searchStationDirectory==='function')$('search').oninput=()=>searchStationDirectory($('search').value);
$('clearStationSearch').onclick=()=>{$('search').value='';if(typeof searchStationDirectory==='function')searchStationDirectory('');else list();$('search').focus({preventScroll:true});};
const libraryHelp=$('library').querySelector('details');if(libraryHelp)$('search').after(libraryHelp);

// Results are announced once after a completed search or explicit pagination.
// No visible count is added, and background polls with the same result stay quiet.
const stationResultAnnouncement=document.createElement('p');stationResultAnnouncement.id='stationResultAnnouncement';stationResultAnnouncement.className='station-screen-reader-only';stationResultAnnouncement.dataset.i18nSkip='1';stationResultAnnouncement.setAttribute('role','status');stationResultAnnouncement.setAttribute('aria-live','polite');stationResultAnnouncement.setAttribute('aria-atomic','true');$('library').append(stationResultAnnouncement);
let stationResultAnnouncementSignature='';
window.onStationDirectoryComplete=function(detail={}){
 if(detail.failed||document.hidden||$('myRadio').hidden)return;
 const tracks=[$('savedStations'),$('stations')],items=tracks.flatMap(track=>[...track.children].filter(item=>item.className==='station-slider-item'));
 const signature=JSON.stringify([detail.query||'',detail.zip_code||'',detail.category||'',items.map(item=>item.getAttribute('data-station-code')),!!detail.hasMore]);
 if(signature!==stationResultAnnouncementSignature){stationResultAnnouncementSignature=signature;const key=detail.hasMore?'directory.resultsMore':'directory.results',fallback=items.length+' stations shown.'+(detail.hasMore?' More available.':''),translated=window.appI18n?.t(key,{count:items.length});stationResultAnnouncement.textContent=translated&&translated!==key?translated:fallback;}
 if(!detail.append||!detail.moreFocused||document.querySelector('dialog[open]'))return;
 const more=$('loadMoreStations'),active=document.activeElement;if(active!==more&&active!==document.body)return;
 if(detail.hasMore){more.focus({preventScroll:true});return;}
 const added=new Set(detail.receivedCodes||[]),available=[...$('stations').children].filter(item=>item.className==='station-slider-item'),saved=[...$('savedStations').children].filter(item=>item.className==='station-slider-item'),target=available.find(item=>added.has(item.getAttribute('data-station-code')))?.children[0]||available.at(-1)?.children[0]||saved.at(-1)?.children[0]||$('search');
 target.focus({preventScroll:true});target.scrollIntoView?.({block:'nearest',inline:'nearest',behavior:'auto'});
};

window.addEventListener('radio-locals-ready',list);
window.addEventListener('radio-selection-changed',list);
window.addEventListener('radio-inventory-changed',event=>{if(event.detail.radioId===readSelectedRadio())list();});
window.addEventListener('saved-station-metadata-changed',list);
window.addEventListener('station-delivery-changed',()=>{
 for(const id of ['savedStations','stations'])for(const item of $(id).children)item.children[0]?.updateDeliveryStatus?.();
});
function updateStationSliderControls(track){
 if(!track?.addEventListener||!track.before)return;
 let controls=track.stationSliderControls;
 if(!controls){
  const row=document.createElement('div'),previous=document.createElement('button'),next=document.createElement('button');row.className='station-slider-controls';row.hidden=true;
  for(const [button,label,step] of [[previous,'Previous stations',-1],[next,'Next stations',1]]){
   button.type='button';button.setAttribute('aria-label',label);if(track.id)button.setAttribute('aria-controls',track.id);button.title=label;
   button.onclick=()=>{const rtl=typeof getComputedStyle==='function'&&getComputedStyle(track).direction==='rtl',reduced=typeof matchMedia==='function'&&matchMedia('(prefers-reduced-motion: reduce)').matches;track.scrollBy({left:step*(rtl?-1:1)*Math.max(106,track.clientWidth*.8),behavior:reduced?'auto':'smooth'});};
  }
  row.append(previous,next);track.before(row);controls=track.stationSliderControls={row,previous,next};track.addEventListener('scroll',()=>updateStationSliderControls(track),{passive:true});
  if(typeof ResizeObserver==='function')new ResizeObserver(()=>updateStationSliderControls(track)).observe(track);
 }
 const rtl=typeof getComputedStyle==='function'&&getComputedStyle(track).direction==='rtl',overflow=track.scrollWidth>track.clientWidth+2,offset=Math.abs(track.scrollLeft),limit=track.scrollWidth-track.clientWidth;
 controls.row.hidden=!overflow;controls.previous.disabled=!overflow||offset<=1;controls.next.disabled=!overflow||offset>=limit-1;controls.previous.textContent=rtl?'›':'‹';controls.next.textContent=rtl?'‹':'›';
}
window.addEventListener('resize',()=>{for(const id of ['savedStations','stations'])updateStationSliderControls($(id));});
window.addEventListener('radio-status-updated',()=>{for(const id of ['savedStations','stations'])updateStationSliderControls($(id));});

// Owner account navigation stays beside Sign in, above both forms.
const coverInput=$('registerForm').elements.artwork,coverPreview=$('registrationLogoPreview'),coverHint=$('registrationLogoHint'),coverRemove=$('removeRegistrationLogo');
let coverPreviewUrl,coverGeneration=0,coverCurrentResult;
const coverInspections=new WeakMap();
function registrationLogoText(key,fallback){const translated=window.appI18n?.t(key);return typeof translated==='string'&&translated!==key?translated:fallback;}
function registrationLogoResult(key,message){return {valid:false,key,message};}
function clearRegistrationLogoUrl(){if(coverPreviewUrl){URL.revokeObjectURL(coverPreviewUrl);coverPreviewUrl=null;}}
function registrationLogoControls(){coverRemove.hidden=!coverInput.files[0];coverRemove.disabled=coverRemove.hidden||$('registerForm').dataset.busy==='1';}
function registrationLogoStatus(result){
 coverCurrentResult=result;const key=result?.key||'registration.logoHelp',fallback=result?.message||'PNG, JPG or WebP, up to 3 MB.';
 coverHint.setAttribute('data-i18n',key);coverHint.textContent=registrationLogoText(key,fallback);coverHint.dataset.state=result&&!result.valid?'invalid':'';
 coverInput.setCustomValidity(result&&!result.valid?registrationLogoText(key,fallback):'');
}
async function inspectRegistrationLogo(file){
 if(!file||!file.size)return registrationLogoResult('registration.logoRequired','Choose a station logo.');
 if(file.size>3*1024*1024)return registrationLogoResult('registration.logoSize','Choose an image no larger than 3 MB.');
 const extension=file.name?.toLowerCase().match(/\.(png|jpe?g|webp)$/)?.[1],type=String(file.type||'').toLowerCase().split(';',1)[0];
 const format=extension==='png'?'png':extension==='webp'?'webp':extension?'jpg':'';
 const expected={png:['image/png'],jpg:['image/jpeg','image/jpg'],webp:['image/webp']};
 if(!format||(type&&!expected[format].includes(type)))return registrationLogoResult('registration.logoFormat','Choose a PNG, JPG or WebP image with a matching filename.');
 let bytes;try{bytes=new Uint8Array(await file.slice(0,12).arrayBuffer());}catch{return registrationLogoResult('registration.logoDecode','This image could not be opened. Choose another image.');}
 const png=bytes.length>=8&&bytes[0]===137&&bytes[1]===80&&bytes[2]===78&&bytes[3]===71&&bytes[4]===13&&bytes[5]===10&&bytes[6]===26&&bytes[7]===10;
 const jpg=bytes.length>=3&&bytes[0]===255&&bytes[1]===216&&bytes[2]===255;
 const webp=bytes.length>=12&&String.fromCharCode(...bytes.slice(0,4))==='RIFF'&&String.fromCharCode(...bytes.slice(8,12))==='WEBP';
 if(!(format==='png'&&png||format==='jpg'&&jpg||format==='webp'&&webp))return registrationLogoResult('registration.logoFormat','Choose a PNG, JPG or WebP image with a matching filename.');
 let url;
 try{
  url=URL.createObjectURL(file);
  return await new Promise(resolve=>{
   const image=new Image();let finished=false,timer;
   const finish=result=>{if(finished)return;finished=true;clearTimeout(timer);image.onload=image.onerror=null;resolve(result);};
   image.onload=()=>{const width=image.naturalWidth,height=image.naturalHeight;finish(!width||!height?registrationLogoResult('registration.logoDecode','This image could not be opened. Choose another image.'):width*height>4000000?registrationLogoResult('registration.logoDimensions','Choose an image no larger than 4 megapixels.'):{valid:true});};
   image.onerror=()=>finish(registrationLogoResult('registration.logoDecode','This image could not be opened. Choose another image.'));
   timer=setTimeout(()=>finish(registrationLogoResult('registration.logoDecode','This image could not be opened. Choose another image.')),10000);image.src=url;
  });
 }catch{return registrationLogoResult('registration.logoDecode','This image could not be opened. Choose another image.');}
 finally{if(url)URL.revokeObjectURL(url);}
}
function registrationLogoInspection(file){if(!file)return Promise.resolve(registrationLogoResult('registration.logoRequired','Choose a station logo.'));if(!coverInspections.has(file))coverInspections.set(file,inspectRegistrationLogo(file));return coverInspections.get(file);}
// Shared inspection has no form-specific effects; owner replacement uses the same limits.
window.inspectStationLogo=registrationLogoInspection;
async function updateRegistrationLogo(){
 const generation=++coverGeneration,file=coverInput.files[0];clearRegistrationLogoUrl();coverPreview.src='/assets/logo-placeholder.svg';coverPreview.alt='No logo uploaded yet';registrationLogoStatus(null);registrationLogoControls();
 if(!file)return;
 const result=await registrationLogoInspection(file);if(generation!==coverGeneration||coverInput.files[0]!==file)return;
 registrationLogoStatus(result);
 if(result.valid){coverPreviewUrl=URL.createObjectURL(file);coverPreview.src=coverPreviewUrl;coverPreview.alt='Station cover preview';}
 registrationLogoControls();
}
window.validateRegistrationLogo=async(file=coverInput.files[0])=>{
 const generation=coverGeneration,result=await registrationLogoInspection(file);
 if(generation!==coverGeneration||coverInput.files[0]!==file)return false;
 registrationLogoStatus(result);registrationLogoControls();
 if(!result.valid){coverInput.focus();coverInput.reportValidity();}return result.valid;
};
coverInput.addEventListener('change',updateRegistrationLogo);
coverRemove.onclick=()=>{if($('registerForm').dataset.busy==='1')return;coverInput.value='';updateRegistrationLogo();$('registerForm').dataset.dirty='1';coverInput.dispatchEvent(new Event('input',{bubbles:true}));};
$('registerForm').addEventListener('reset',()=>queueMicrotask(updateRegistrationLogo));
$('registerForm').addEventListener('form-busy-changed',registrationLogoControls);
window.addEventListener('app-language-changed',()=>registrationLogoStatus(coverCurrentResult));
window.addEventListener('pagehide',clearRegistrationLogoUrl);
registrationLogoControls();

function highlightMenu(){const active=(!$('myRadio').hidden||!$('wifiSetup').hidden)?'navRadio':!$('library').hidden?'navLibrary':!$('support').hidden?'support':'navAdd';for(const tab of document.querySelectorAll('nav[aria-label="Main navigation"] > *')){if(tab.id===active||(active==='support'&&tab.getAttribute('href')==='/support'))tab.setAttribute('aria-current','page');else tab.removeAttribute('aria-current');}}
new MutationObserver(highlightMenu).observe(document.querySelector('main'),{attributes:true,attributeFilter:['hidden'],subtree:true});highlightMenu();

// One consistent outline icon family above the persistent menu labels.
const menuIconPaths={navRadio:'<rect x="4" y="7" width="16" height="13" rx="3"/><path d="m7 7 10-4M8 11h8"/><circle cx="9" cy="16" r="2"/><path d="M15 15h2m-2 3h2"/>',navLibrary:'<rect x="4" y="4" width="4" height="16" rx="1"/><rect x="10" y="4" width="4" height="16" rx="1"/><path d="m17 5 4 14-3 1-4-14z"/>',navAdd:'<rect x="4" y="4" width="16" height="16" rx="4"/><path d="M12 8v8m-4-4h8"/>',support:'<path d="M4 13v-1a8 8 0 0 1 16 0v1"/><rect x="3" y="11" width="4" height="7" rx="2"/><rect x="17" y="11" width="4" height="7" rx="2"/><path d="M19 18c0 2-2 3-5 3h-2"/>'};
for(const tab of document.querySelectorAll('nav[aria-label="Main navigation"] > *')){const label=tab.textContent,icon=menuIconPaths[tab.id||'support'];tab.innerHTML='<svg class="nav-icon" viewBox="0 0 24 24" aria-hidden="true">'+icon+'</svg>';const text=document.createElement('span');text.textContent=label;tab.append(text);}

const stationPopup=document.createElement('dialog');stationPopup.id='stationAddPopup';stationPopup.setAttribute('aria-label','Add station to your radio');
const stationPopupClose=document.createElement('button');stationPopupClose.className='station-popup-close';stationPopupClose.textContent='Close';stationPopupClose.onclick=()=>stationPopup.close();stationPopup.append(stationPopupClose);document.body.append(stationPopup);
let stationPopupGeneration=0;
stationPopup.addEventListener('close',()=>{stationPopupGeneration++;$('shared').hidden=true;});
async function openStationPopup(code,{autoAdd=false}={}){
 if(shareRunning)return;const generation=++stationPopupGeneration,current=()=>generation===stationPopupGeneration&&stationPopup.open&&!$('shared').hidden;
 stationPopup.append($('shared'));$('shared').dataset.quickAdd='1';$('shared').hidden=false;$('shareForm').hidden=true;$('otherRadio').hidden=true;$('shareArt').hidden=true;$('shareName').textContent='Loading station…';$('shareStationCode').textContent='';$('shareStationBio').textContent='';$('shareStationBio').hidden=true;setSharedStatus('');stationPopup.querySelector('.station-popup-share')?.remove();stationPopup.querySelector('.station-share-feedback')?.remove();stationPopup.showModal();
 try{
  await openShared(code,true,autoAdd,station=>{
   if(!current()||stationPopup.querySelector('.station-popup-share'))return;
   // Public sharing is ready after station metadata, independently of private
   // radio status, inventory checks or any ongoing station addition.
   const share=shareButton('Share '+station.name,station.name,location.origin+'/station/'+station.listener_code);share.className='station-popup-share secondary';share.textContent='Share station';stationPopup.append(share);
  });
 }catch(e){if(current())setSharedStatus(e.message,'error');}
}
