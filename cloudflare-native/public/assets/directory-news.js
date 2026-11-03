'use strict';
function shareButton(label,kind,name,url){const button=document.createElement('button');button.className='social '+kind;button.setAttribute('aria-label',label);button.title=label;button.textContent={facebook:'f',whatsapp:'◉',more:'•••'}[kind];if(kind==='whatsapp')button.innerHTML='<svg viewBox="0 0 32 32" aria-hidden="true"><path d="M7 26l1-5a11 11 0 1 1 4 4z" fill="none" stroke="currentColor" stroke-width="2.5"/><path d="M12 10q-2 4 5 9l3-1 2 3q-5 5-12-5-3-5 0-7z" fill="currentColor"/></svg>';if(kind==='more')button.innerHTML='<svg viewBox="0 0 32 32" aria-hidden="true"><path d="M5 7h22v16H14l-6 5v-5H5z" fill="currentColor"/><g fill="#119e47"><circle cx="10" cy="15" r="1.6"/><circle cx="16" cy="15" r="1.6"/><circle cx="22" cy="15" r="1.6"/></g></svg>';button.onclick=async()=>{if(kind==='facebook'||kind==='whatsapp'){const target=kind==='facebook'?'https://www.facebook.com/sharer/sharer.php?u='+encodeURIComponent(url):'https://wa.me/?text='+encodeURIComponent(name+' '+url);window.open(target,'_blank','noopener,noreferrer');}else try{if(navigator.share)await navigator.share({title:name,url});else{await navigator.clipboard.writeText(url);button.title='Link copied';}}catch{}};return button;}
list=function(){
 const query=$('search').value.trim().toLowerCase(),found=stations.filter(s=>(s.name+' '+s.listener_code).toLowerCase().includes(query));
 $('stations').replaceChildren();$('stationCount').textContent=found.length+' stations found · showing '+found.length;
 for(const station of found){
  const card=document.createElement('article');card.className='station restored editorial';card.dataset.actions='1';
  const image=document.createElement('img');image.src=station.logo_url||'/assets/radiolavoixdivine.png';image.alt=station.name;image.loading='lazy';
  const body=document.createElement('div');body.className='station-body';
  const eyebrow=document.createElement('p');eyebrow.className='station-eyebrow';eyebrow.textContent='INTERNET RADIO';
  const title=document.createElement('h2');title.textContent=station.name;
  const code=document.createElement('p');code.className='code';code.textContent='Station code #'+station.listener_code;
  const shares=document.createElement('div');shares.className='socials';const url=location.origin+'/station/'+station.listener_code;
  for(const [label,kind] of [['Share on Facebook','facebook'],['Share on WhatsApp','whatsapp'],['More sharing options','more']])shares.append(shareButton(label,kind,station.name,url));
  const ownStation=station.name.toLowerCase().replace(/[^a-z]/g,'')==='lavoixdivine';
  const action=document.createElement(ownStation?'button':'a');action.className='station-primary';
  if(ownStation){action.textContent=$('playerAudio').paused?'▶ Play Live':'Ⅱ Pause';action.onclick=()=>{$('playerPlay').click();};action.dataset.stationPlay='1';}
  else{action.href='/station/'+station.listener_code;action.textContent='+ Add to your radio';}
  body.append(eyebrow,title,code,shares,action);
  const about=document.createElement('details');about.className='station-about';about.open=true;
  const summary=document.createElement('summary');summary.textContent='About '+station.name;
  const bio=document.createElement('p');bio.textContent=station.bio||'The station owner has not added a bio yet.';about.append(summary,bio);
  const advertise=document.createElement('a');advertise.className='station-advertise';advertise.href='/advertise/'+station.listener_code;
  advertise.innerHTML='<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 10v5h4l10 5V5L7 10zm4 5 2 6h3m8-12v7"/></svg><span>Advertise on this station</span>';
  card.append(image,body,about,advertise);$('stations').append(card);
 }
 if(!found.length)$('stationCount').textContent=query?'No matching stations.':'No published stations yet.';
};
for(const event of ['playing','pause','waiting','error'])$('playerAudio').addEventListener(event,()=>{for(const button of document.querySelectorAll('[data-station-play]')){button.textContent=event==='waiting'?'Connecting…':$('playerAudio').paused?'▶ Play Live':'Ⅱ Pause';}});
$('search').oninput=list;
const libraryHelp=$('library').querySelector('details');if(libraryHelp)$('search').after(libraryHelp);

const bioDialog=document.createElement('dialog');bioDialog.id='stationBio';const bioTitle=document.createElement('h2');bioTitle.id='stationBioTitle';const bioText=document.createElement('p');bioText.id='stationBioText';const closeBio=document.createElement('button');closeBio.textContent='Close';closeBio.onclick=()=>bioDialog.close();bioDialog.append(bioTitle,bioText,closeBio);document.body.append(bioDialog);
const carousel=document.createElement('div');carousel.className='news-carousel';carousel.setAttribute('aria-label','Haitian Times headlines');$('playerPlay').after(carousel);let headlines=[],headlineIndex=0;
function renderHeadlines(){carousel.replaceChildren();if(!headlines.length){carousel.textContent='Headlines are temporarily unavailable.';return;}const indices=headlines.length>2?[(headlineIndex+headlines.length-1)%headlines.length,headlineIndex,(headlineIndex+1)%headlines.length]:headlines.map((_,i)=>i);for(const index of indices){const item=headlines[index],card=document.createElement('a');card.className='news-card'+(index===headlineIndex?' active':'');card.href=item.url;card.target='_blank';card.rel='noopener noreferrer';if(item.image){const image=document.createElement('img');image.src=item.image;image.alt='';image.loading='lazy';image.referrerPolicy='no-referrer';card.append(image);}const content=document.createElement('span'),source=document.createElement('small'),title=document.createElement('strong');source.textContent=item.source;title.textContent=item.title;content.append(source,title);card.append(content);carousel.append(card);}}
async function loadHeadlines(){try{const result=await api('/api/haitian-times');headlines=result.items||[];}catch{}renderHeadlines();}
window.addEventListener('radio-locals-ready',()=>{list();loadHeadlines();});if(state){list();loadHeadlines();}
setInterval(()=>{if(!document.hidden&&!$('radio').hidden&&headlines.length){headlineIndex=(headlineIndex+1)%headlines.length;renderHeadlines();}},6500);
const directoryReady=setInterval(()=>{if(state){clearInterval(directoryReady);list();loadHeadlines();}},250);

// Match registration and sign-in to the compact white owner card.
$('register').append($('openLogin'));$('login').append($('openRegister'));
$('login').querySelector('h1').innerHTML='Sign in<small>Edit your station</small>';
const coverInput=$('registerForm').elements.artwork,coverLabel=coverInput.closest('label');
const coverRow=document.createElement('div');coverRow.className='cover-upload';
const coverPreview=document.createElement('img');coverPreview.className='cover-preview';coverPreview.alt='Station cover preview';coverPreview.hidden=true;
coverRow.append(coverPreview,coverLabel);$('registerForm').prepend(coverRow);
let coverPreviewUrl;
coverInput.addEventListener('change',()=>{if(coverPreviewUrl)URL.revokeObjectURL(coverPreviewUrl);const file=coverInput.files[0];coverPreview.hidden=!file;if(file){coverPreviewUrl=URL.createObjectURL(file);coverPreview.src=coverPreviewUrl;}});

function highlightMenu(){const active=!$('radio').hidden?'navRadio':!$('library').hidden?'navLibrary':!$('support').hidden?'support':'navAdd';for(const tab of document.querySelectorAll('nav[aria-label="Main navigation"] > *')){if(tab.id===active||(active==='support'&&tab.getAttribute('href')==='/device'))tab.setAttribute('aria-current','page');else tab.removeAttribute('aria-current');}}
new MutationObserver(highlightMenu).observe(document.querySelector('main'),{attributes:true,attributeFilter:['hidden'],subtree:true});highlightMenu();

// One consistent outline icon family above the persistent menu labels.
const menuIconPaths={navRadio:'<rect x="4" y="7" width="16" height="13" rx="3"/><path d="m7 7 10-4M8 11h8"/><circle cx="9" cy="16" r="2"/><path d="M15 15h2m-2 3h2"/>',navLibrary:'<rect x="4" y="4" width="4" height="16" rx="1"/><rect x="10" y="4" width="4" height="16" rx="1"/><path d="m17 5 4 14-3 1-4-14z"/>',navAdd:'<rect x="4" y="4" width="16" height="16" rx="4"/><path d="M12 8v8m-4-4h8"/>',support:'<path d="M4 13v-1a8 8 0 0 1 16 0v1"/><rect x="3" y="11" width="4" height="7" rx="2"/><rect x="17" y="11" width="4" height="7" rx="2"/><path d="M19 18c0 2-2 3-5 3h-2"/>'};
for(const tab of document.querySelectorAll('nav[aria-label="Main navigation"] > *')){const label=tab.textContent,icon=menuIconPaths[tab.id||'support'];tab.innerHTML='<svg class="nav-icon" viewBox="0 0 24 24" aria-hidden="true">'+icon+'</svg>';const text=document.createElement('span');text.textContent=label;tab.append(text);}
