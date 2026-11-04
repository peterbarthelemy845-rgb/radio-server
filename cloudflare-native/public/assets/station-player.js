'use strict';
const audio=document.getElementById('audio'),play=document.getElementById('play'),status=document.getElementById('status'),caption=play.querySelector('span'),shape=play.querySelector('path');
play.onclick=async()=>{if(!audio.paused){audio.pause();return;}play.disabled=true;try{if(!audio.src){const response=await fetch('/api/player');if(!response.ok)throw Error();const config=await response.json();audio.src=config.stream_url;}status.textContent='Connecting…';await audio.play();}catch{status.textContent='Unable to connect. Tap Play to try again.';}finally{play.disabled=false;}};
function updatePlayer(){const paused=audio.paused;caption.textContent=paused?'Play live':'Pause';play.setAttribute('aria-label',paused?'Play La Voix Divine':'Pause La Voix Divine');shape.setAttribute('d',paused?'m8 4 12 8-12 8z':'M6 4h4v16H6zM14 4h4v16h-4z');}
audio.addEventListener('playing',()=>{status.textContent='Live on the air';updatePlayer();});audio.addEventListener('pause',()=>{status.textContent='Paused';updatePlayer();});audio.addEventListener('waiting',()=>{status.textContent='Reconnecting…';});audio.addEventListener('error',()=>{status.textContent='Stream unavailable. Tap Play to try again.';updatePlayer();});

const bioDialog=document.getElementById('stationBio');
document.getElementById('bioTab').onclick=()=>bioDialog.showModal();
document.getElementById('closeBio').onclick=()=>bioDialog.close();
document.getElementById('radioTab').onclick=()=>{if(bioDialog.open)bioDialog.close();window.scrollTo({top:0,behavior:'smooth'});};
