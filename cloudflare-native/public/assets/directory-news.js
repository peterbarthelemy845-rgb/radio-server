'use strict';
function shareButton(label,name,url){const button=document.createElement('button');button.type='button';button.setAttribute('aria-label',label);button.title=label;button.textContent=label;button.onclick=async()=>{api('/api/events',{event_id:crypto.randomUUID().replaceAll('-',''),station_code:url.split('/').pop(),channel:'more'}).catch(()=>{});try{if(navigator.share)await navigator.share({title:name,url});else{await navigator.clipboard.writeText(url);button.textContent='Link copied';}}catch{}};return button;}
let stationListSnapshot='';
function renderStationSlider(track,found,emptyText,saved=false){
 track.replaceChildren();
 for(const station of found){
  const tile=document.createElement('button');tile.type='button';tile.className='station-logo-tile';tile.setAttribute('aria-label',station.name+(saved?' — on your radio. View station options.':' — add to your radio'));tile.title=station.name;tile.setAttribute('aria-haspopup','dialog');
  const image=document.createElement('img');image.src=station.logo_url||'/assets/logo-placeholder.svg';image.alt='';image.loading='lazy';image.width=96;image.height=96;
  tile.append(image);tile.onclick=()=>openStationPopup(station.listener_code);const item=document.createElement('div');item.className='station-slider-item';const name=document.createElement('p');name.className='station-tile-name';name.textContent=station.name;item.append(tile,name);track.append(item);
 }
 if(!found.length){const empty=document.createElement('p');empty.className='station-slider-empty';empty.textContent=emptyText;track.append(empty);}
}
list=function(){
 const query=$('search').value.trim().toLowerCase(),radioId=typeof readSelectedRadio==='function'?readSelectedRadio():'',inventory=typeof readRadioInventory==='function'?readRadioInventory(radioId):null,known=!!inventory?.known;
 if(radioId&&typeof loadRadioInventory==='function')loadRadioInventory(radioId);
 const savedCodes=known?inventory.codes:new Set(),matches=s=>(s.name+' '+s.listener_code).toLowerCase().includes(query);
 const saved=known?[...savedCodes].map(code=>stations.find(s=>String(s.listener_code)===code)||{listener_code:code,name:'Station '+code,logo_url:''}).filter(matches):[];
 const available=stations.filter(s=>!savedCodes.has(String(s.listener_code))&&matches(s));
 const hint=!radioId?'Connect or select a radio above to see its saved stations.':inventory?.unavailable?'Saved stations could not be checked. Try refreshing your radio status.':inventory&&!known?'Saved list updates after a radio software update.':'';
 const snapshot=JSON.stringify([radioId,known,query,hint,saved,available]);if(snapshot===stationListSnapshot)return;stationListSnapshot=snapshot;
 $('stationCount').textContent='';$('savedStationsSection').hidden=!known;$('stationInventoryHelp').textContent=hint;$('stationInventoryHelp').hidden=!hint;
 renderStationSlider($('savedStations'),saved,query?'No matching saved stations.':'No saved stations reported.',true);
 renderStationSlider($('stations'),available,query?'No matching available stations.':known?'No more stations available.':'No stations yet.');
};
$('search').oninput=list;
const libraryHelp=$('library').querySelector('details');if(libraryHelp)$('search').after(libraryHelp);

window.addEventListener('radio-locals-ready',list);
window.addEventListener('radio-selection-changed',list);
window.addEventListener('radio-inventory-changed',event=>{if(event.detail.radioId===readSelectedRadio())list();});

// Owner account navigation stays beside Sign in, above both forms.
const coverInput=$('registerForm').elements.artwork,coverPreview=$('registrationLogoPreview'),coverHint=$('registrationLogoHint'),coverRemove=$('removeRegistrationLogo');
let coverPreviewUrl,coverGeneration=0,coverCurrentResult;
const coverInspections=new WeakMap();
function registrationLogoText(key,fallback){const translated=window.appI18n?.t(key);return typeof translated==='string'&&translated!==key?translated:fallback;}
function registrationLogoResult(key,message){return {valid:false,key,message};}
function clearRegistrationLogoUrl(){if(coverPreviewUrl){URL.revokeObjectURL(coverPreviewUrl);coverPreviewUrl=null;}}
function registrationLogoControls(){coverRemove.disabled=!coverInput.files[0]||$('registerForm').dataset.busy==='1';}
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

function highlightMenu(){const active=(!$('myRadio').hidden||!$('wifiSetup').hidden)?'navRadio':!$('library').hidden?'navLibrary':!$('support').hidden?'support':'navAdd';for(const tab of document.querySelectorAll('nav[aria-label="Main navigation"] > *')){if(tab.id===active||(active==='support'&&tab.getAttribute('href')==='/support'))tab.setAttribute('aria-current','page');else tab.removeAttribute('aria-current');}}
new MutationObserver(highlightMenu).observe(document.querySelector('main'),{attributes:true,attributeFilter:['hidden'],subtree:true});highlightMenu();

// One consistent outline icon family above the persistent menu labels.
const menuIconPaths={navRadio:'<rect x="4" y="7" width="16" height="13" rx="3"/><path d="m7 7 10-4M8 11h8"/><circle cx="9" cy="16" r="2"/><path d="M15 15h2m-2 3h2"/>',navLibrary:'<rect x="4" y="4" width="4" height="16" rx="1"/><rect x="10" y="4" width="4" height="16" rx="1"/><path d="m17 5 4 14-3 1-4-14z"/>',navAdd:'<rect x="4" y="4" width="16" height="16" rx="4"/><path d="M12 8v8m-4-4h8"/>',support:'<path d="M4 13v-1a8 8 0 0 1 16 0v1"/><rect x="3" y="11" width="4" height="7" rx="2"/><rect x="17" y="11" width="4" height="7" rx="2"/><path d="M19 18c0 2-2 3-5 3h-2"/>'};
for(const tab of document.querySelectorAll('nav[aria-label="Main navigation"] > *')){const label=tab.textContent,icon=menuIconPaths[tab.id||'support'];tab.innerHTML='<svg class="nav-icon" viewBox="0 0 24 24" aria-hidden="true">'+icon+'</svg>';const text=document.createElement('span');text.textContent=label;tab.append(text);}

const stationPopup=document.createElement('dialog');stationPopup.id='stationAddPopup';stationPopup.setAttribute('aria-label','Add station to your radio');
const stationPopupClose=document.createElement('button');stationPopupClose.className='station-popup-close';stationPopupClose.textContent='Close';stationPopupClose.onclick=()=>stationPopup.close();stationPopup.append(stationPopupClose);document.body.append(stationPopup);
stationPopup.addEventListener('close',()=>{$('shared').hidden=true;});
async function openStationPopup(code){if(shareRunning)return;stationPopup.append($('shared'));$('shared').hidden=false;$('shareForm').hidden=true;$('otherRadio').hidden=true;$('shareArt').hidden=true;$('shareName').textContent='Loading station…';$('shareStationCode').textContent='';$('shareStationBio').textContent='';$('shareStationBio').hidden=true;$('shareStatus').textContent='';stationPopup.querySelector('.station-popup-share')?.remove();const selected=stations.find(s=>String(s.listener_code)===String(code));if(selected){const share=shareButton('Share station',selected.name,location.origin+'/station/'+code);share.className='station-popup-share secondary';share.textContent='Share station';stationPopup.append(share);}stationPopup.showModal();try{await openShared(code,true);}catch(e){$('shareStatus').textContent=e.message;}}
