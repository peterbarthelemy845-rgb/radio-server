'use strict';
// Only a display preference is persisted. Form drafts and device data stay out of storage.
const largerTextButton=$('listenerTextSize');
function applyLargerText(enabled){document.body.classList.toggle('app-large-text',enabled);largerTextButton.setAttribute('aria-pressed',String(enabled));largerTextButton.textContent=enabled?'Standard text':'Larger text';}
let largerText=false;try{largerText=localStorage.getItem('radioLocalsLargerText')==='1';}catch{}
applyLargerText(largerText);
largerTextButton.onclick=()=>{largerText=!document.body.classList.contains('app-large-text');applyLargerText(largerText);try{localStorage.setItem('radioLocalsLargerText',largerText?'1':'0');}catch{}};
let keyboardWasOpen=false;
function measureAppViewport(){
 const viewport=window.visualViewport,height=viewport?.height||window.innerHeight;
 document.documentElement.style.setProperty('--app-visible-height',Math.round(height)+'px');
 document.documentElement.style.setProperty('--app-visible-bottom',Math.max(0,Math.round(window.innerHeight-height-(viewport?.offsetTop||0)))+'px');
 const focused=document.activeElement,editing=focused&&/^(INPUT|TEXTAREA|SELECT)$/.test(focused.tagName),keyboardOpen=!!editing&&window.innerHeight-height>150;
 document.body.classList.toggle('app-keyboard-open',keyboardOpen);
 if(keyboardOpen&&!keyboardWasOpen)focused.scrollIntoView({block:'nearest',behavior:'auto'});
 keyboardWasOpen=keyboardOpen;
}
window.visualViewport?.addEventListener('resize',measureAppViewport);
window.addEventListener('resize',measureAppViewport);
document.addEventListener('focusin',measureAppViewport);
document.addEventListener('focusout',()=>requestAnimationFrame(measureAppViewport));
measureAppViewport();
