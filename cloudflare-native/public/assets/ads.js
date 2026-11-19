'use strict';
let advertiseCode,adminAdReview=false,adReviewGeneration=0,adReviewViewGeneration=0,adReviewLoading=false;
function adsText(english,creole){return window.appI18n?.language==='ht'?creole:english;}
function adDate(value){if(!Number.isFinite(Number(value))||!value)return '—';return new Intl.DateTimeFormat(window.appI18n?.language==='ht'?'fr-HT':'en-US',{year:'numeric',month:'short',day:'numeric',timeZone:'UTC'}).format(new Date(Number(value)*1000));}
const adsPage=page;
page=function(id){if(id!=='adReview'){adReviewGeneration++;adReviewViewGeneration=0;adReviewLoading=false;}return adsPage(id);};
const ownerAdsButton=document.createElement('button');ownerAdsButton.textContent='Review radio ads';ownerAdsButton.className='secondary';ownerAdsButton.onclick=()=>showAds(false);$('editor').append(ownerAdsButton);
const adminAdsButton=document.createElement('button');adminAdsButton.textContent='Review radio ads';adminAdsButton.className='secondary';adminAdsButton.onclick=()=>showAds(true);$('admin').append(adminAdsButton);
async function showAds(administrator){
 const generation=++adReviewGeneration;adReviewLoading=true;
 try{
  const result=await api(administrator?'/api/admin/ads':'/api/owner/ads');if(generation!==adReviewGeneration)return false;
  adminAdReview=administrator;adReviewViewGeneration=generation;page('adReview');$('adsReviewMessage').textContent='Free pilot · Display reports are device reports, not verified people or sales.';$('adsRecords').replaceChildren();
  for(const ad of result.ads){
   const box=document.createElement('article'),heading=document.createElement('h2'),image=document.createElement('img'),message=document.createElement('p'),status=document.createElement('p'),schedule=document.createElement('p');
   heading.textContent=ad.business+' · Station #'+ad.station_code;image.src='/api/ad-artwork/'+ad.id;image.alt='Sponsor artwork';image.style.width='100%';image.style.maxHeight='160px';image.style.objectFit='contain';message.textContent=ad.message+' · '+ad.phone;status.textContent=ad.status.replaceAll('_',' ')+' · '+(ad.scanner_passed?'Safety cleared':'Administrator safety review needed')+' · Reported displays: '+ad.reported_displays;box.append(heading,image,message,status);
   schedule.className='ad-schedule';schedule.textContent=adsText('Starts ','Kòmanse ')+adDate(ad.start_at)+' · '+adsText('Ends ','Fini ')+adDate(ad.end_at)+' (UTC)'+(ad.end_at&&ad.end_at*1000<=Date.now()?adsText(' · Expired',' · Ekspire'):'');box.append(schedule);
   const actions=administrator?(ad.scanner_passed?['delete']:['clear','delete']):(ad.scanner_passed?['approve','delete']:['delete']);let actionPending=false;
   for(const action of actions){
    const button=document.createElement('button');button.className='secondary';button.textContent={clear:'Clear safety review',approve:'Approve ad',delete:'Delete ad'}[action];
    button.onclick=async()=>{
     if(actionPending||adReviewLoading||generation!==adReviewViewGeneration)return;const actionGeneration=adReviewGeneration;let reason='';actionPending=true;button.disabled=true;
     try{
      if(action==='delete'){const entered=await appPrompt('Delete '+ad.business+'?','Optional short reason for the station owner (no links or private information):',{maxLength:300,confirmText:'Delete ad',danger:true});if(entered===null)return;reason=entered.trim();}
      else if(!await appConfirm(button.textContent,button.textContent+' for '+ad.business+'?',{confirmText:button.textContent}))return;
      if(actionGeneration!==adReviewGeneration||generation!==adReviewViewGeneration)return;
      const changed=await api(administrator?'/api/admin/ads':'/api/owner/ads',{id:ad.id,action,reason});if(actionGeneration!==adReviewGeneration||generation!==adReviewViewGeneration)return;if(!await showAds(administrator))return;if(changed.notification_queued)$('adsReviewMessage').textContent='Advertisement updated. Owner notification queued.';window.dispatchEvent(new Event('admin-data-changed'));}
     catch(e){if(actionGeneration===adReviewGeneration&&generation===adReviewViewGeneration)$('adsReviewMessage').textContent=e.message;}
     finally{actionPending=false;button.disabled=false;}
    };box.append(button);
   }if(administrator)window.aiAdmin?.mountReview({host:box,type:'ad',id:ad.id,isActive:()=>generation===adReviewViewGeneration&&!$('adReview').hidden});$('adsRecords').append(box);
  }if(!result.ads.length)$('adsRecords').textContent='No advertisements yet.';return true;
 }catch(e){if(generation===adReviewGeneration)message(e.message);return false;}
 finally{if(generation===adReviewGeneration)adReviewLoading=false;}
}
$('adsBack').onclick=()=>page(adminAdReview?'admin':'editor');
let adDraftRequest=null;
$('advertiseForm').addEventListener('input',()=>{adDraftRequest=null;});$('advertiseForm').addEventListener('change',()=>{adDraftRequest=null;});$('advertiseForm').addEventListener('reset',()=>{adDraftRequest=null;});
$('advertiseForm').onsubmit=async event=>{
 event.preventDefault();const form=event.target;if(formIsBusy(form))return;
 const body=Object.fromEntries(new FormData(form)),artworkFile=form.elements.artwork.files[0];body.station_code=advertiseCode;body.rights_confirmed=form.elements.rights_confirmed.checked;busy(form,true,true);
 try{body.artwork=await fileData(artworkFile);const snapshot=JSON.stringify([body.station_code,body.business?.trim(),body.message?.trim(),body.phone?.trim(),body.email?.trim().toLowerCase(),body.start_date||'',body.end_date||'',body.rights_confirmed,body.artwork]);if(!adDraftRequest||adDraftRequest.snapshot!==snapshot)adDraftRequest={snapshot,id:Array.from(crypto.getRandomValues(new Uint8Array(16)),value=>value.toString(16).padStart(2,'0')).join('')};body.request_id=adDraftRequest.id;body.turnstile_token=await human(form,'advertise-submit');const result=await api('/api/ads/submit',body);form.reset();form.hidden=true;$('advertiseMessage').textContent=result.message+(/^[a-f0-9]{32}$/.test(result.reference||'')?adsText(' Reference: ',' Referans: ')+result.reference:'');if(/^[a-f0-9]{32}$/.test(result.reference||''))window.dispatchEvent(new CustomEvent('advertisement-submitted',{detail:{reference:result.reference,email:body.email,stationCode:advertiseCode}}));}
 catch(e){$('advertiseMessage').textContent=e.message;}finally{busy(form,false);}
};
let advertiseLookupGeneration=0;
async function initAdsPage(){const route=location.pathname.match(/^\/advertise\/(\d{2,6})$/);if(route){const generation=++advertiseLookupGeneration;page('advertise');$('advertiseForm').hidden=true;advertiseCode=undefined;$('advertiseMessage').textContent='';$('advertiseRetry')?.remove();$('advertiseRadioLink')?.remove();try{const station=await api('/api/stations/'+route[1]);if(generation!==advertiseLookupGeneration||$('advertise').hidden)return;advertiseCode=route[1];$('advertiseTitle').textContent='Advertise on '+String(station.name).toLocaleUpperCase();$('advertiseForm').hidden=false;}catch(e){if(generation!==advertiseLookupGeneration||$('advertise').hidden)return;const missing=e.status===404;$('advertiseTitle').textContent=missing?adsText('Station unavailable','Estasyon an pa disponib'):adsText('Could not load station','Nou pa ka chaje estasyon an');$('advertiseMessage').textContent=missing?adsText('This station is not published. Choose an available station on Radio.','Estasyon sa a pa pibliye. Chwazi yon estasyon ki disponib nan Radyo.'):adsText('Check your connection and try again. Your form is kept.','Tcheke koneksyon ou epi eseye ankò. Fòm ou rete la.');if(!missing){const retry=document.createElement('button');retry.id='advertiseRetry';retry.type='button';retry.className='secondary';retry.textContent=adsText('Try again','Eseye ankò');retry.onclick=()=>initAdsPage();$('advertiseMessage').after(retry);}const radio=document.createElement('a');radio.id='advertiseRadioLink';radio.href='/#radio';radio.textContent=adsText('Back to Radio','Retounen nan Radyo');$('advertiseMessage').after(radio);}}}
window.addEventListener('radio-locals-ready',()=>initAdsPage().catch(e=>message(e.message)));

