'use strict';
function stationShareUrl(code){return 'https://www.radiolavoixdivine.com/station/'+encodeURIComponent(code);}
function stationSocialMarkup(code,name){
 const url=stationShareUrl(code),text=name+' — Station code #'+code+'\n'+url;
 return `<div class="station-socials"><a class="social-icon facebook" href="https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(url)}" target="_blank" rel="noopener noreferrer" aria-label="Share on Facebook" title="Share on Facebook">f</a><a class="social-icon whatsapp" href="https://wa.me/?text=${encodeURIComponent(text)}" target="_blank" rel="noopener noreferrer" aria-label="Share on WhatsApp" title="Share on WhatsApp"><svg viewBox="0 0 32 32" aria-hidden="true"><path d="M7 26l1-5a11 11 0 1 1 4 4z" fill="none" stroke="currentColor" stroke-width="2.5"/><path d="M12 10q-2 4 5 9l3-1 2 3q-5 5-12-5-3-5 0-7z" fill="currentColor"/></svg></a><button class="social-icon messages native-share" type="button" aria-label="Share in Messages or other apps" title="Messages and other apps"><svg viewBox="0 0 32 32" aria-hidden="true"><path d="M5 7h22v16H14l-6 5v-5H5z" fill="currentColor"/><g fill="#16a34a"><circle cx="10" cy="15" r="1.6"/><circle cx="16" cy="15" r="1.6"/><circle cx="22" cy="15" r="1.6"/></g></svg></button></div><span class="station-social-message" role="status" aria-live="polite"></span>`;
}
function wireStationSharing(container,code,name){
 container.querySelectorAll('.station-socials a').forEach(link=>link.addEventListener('click',event=>event.stopPropagation()));
 container.querySelectorAll('.native-share').forEach(button=>button.addEventListener('click',async event=>{
  event.stopPropagation();const url=stationShareUrl(code),message=container.querySelector('.station-social-message');
  if(navigator.share){try{await navigator.share({title:name,text:'Station code #'+code,url});return;}catch(error){if(error.name==='AbortError')return;}}
  try{await navigator.clipboard.writeText(url);if(message)message.textContent='Station link copied. Paste it into your message or social app.';}catch(error){window.prompt('Copy this station link to share:',url);}
 }));
}
