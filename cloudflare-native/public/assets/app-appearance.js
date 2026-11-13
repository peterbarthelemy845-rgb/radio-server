'use strict';
// Only a display preference is persisted. Form drafts and device data stay out of storage.
const largerTextButton=$('listenerTextSize');
function applyLargerText(enabled){document.body.classList.toggle('app-large-text',enabled);largerTextButton.setAttribute('aria-pressed',String(enabled));largerTextButton.setAttribute('data-i18n',enabled?'standard':'larger');largerTextButton.textContent=enabled?'Standard text':'Larger text';}
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

// The same controls stay with the visible card on owner and help screens.
// Move their existing nodes so language preferences and event handlers remain
// single-owned, including when a form is busy or has unsaved edits.
const appDisplayTools=document.querySelector?.('.app-header-tools'),appToolsHome=appDisplayTools?.parentElement;
let displayPreferencesDialog=null,displayPreferencesButton=null,displayPreferencesRestoreFocus=true,displayPreferencesPage=null;
function closeDisplayPreferences(restoreFocus=true){if(!displayPreferencesDialog?.open)return;displayPreferencesRestoreFocus=restoreFocus;displayPreferencesDialog.close();}
if(appDisplayTools&&$('appLanguage')){
 const languagePicker=$('appLanguage'),languageLabel=appDisplayTools.querySelector('label[for="appLanguage"]')||document.createElement('label');
 languageLabel.htmlFor='appLanguage';languageLabel.className='display-preferences-language-label';languageLabel.setAttribute('data-i18n','language');languageLabel.textContent='Language';
 displayPreferencesDialog=document.createElement('dialog');displayPreferencesDialog.id='displayPreferences';displayPreferencesDialog.className='display-preferences-dialog';displayPreferencesDialog.setAttribute('aria-labelledby','displayPreferencesTitle');
 const headingRow=document.createElement('div');headingRow.className='display-preferences-heading';
 const title=document.createElement('h2');title.id='displayPreferencesTitle';title.setAttribute('data-i18n','display.title');title.textContent='Display preferences';
 const close=document.createElement('button');close.id='closeDisplayPreferences';close.type='button';close.className='secondary';close.setAttribute('data-i18n','close');close.textContent='Close';close.onclick=()=>closeDisplayPreferences();headingRow.append(title,close);
 const languageRow=document.createElement('div');languageRow.className='display-preferences-field';languageRow.append(languageLabel,languagePicker);
 const textRow=document.createElement('div');textRow.className='display-preferences-field';textRow.setAttribute('role','group');textRow.setAttribute('aria-labelledby','displayTextSizeLabel');
 const textLabel=document.createElement('span');textLabel.id='displayTextSizeLabel';textLabel.setAttribute('data-i18n','display.textSize');textLabel.textContent='Text size';textRow.append(textLabel,largerTextButton);
 displayPreferencesDialog.append(headingRow,languageRow,textRow);document.body.append(displayPreferencesDialog);
 displayPreferencesButton=document.createElement('button');displayPreferencesButton.id='openDisplayPreferences';displayPreferencesButton.type='button';displayPreferencesButton.className='display-preferences-button secondary';displayPreferencesButton.setAttribute('aria-haspopup','dialog');displayPreferencesButton.setAttribute('aria-controls','displayPreferences');displayPreferencesButton.setAttribute('aria-expanded','false');
 const icon=document.createElement('span');icon.className='display-preferences-icon';icon.setAttribute('aria-hidden','true');icon.innerHTML='<svg viewBox="0 0 24 24" focusable="false"><path d="m9 3-.5 2.2-1.8 1L4.5 6l-2 3.5L4 11v2l-1.5 1.5 2 3.5 2.2-.2 1.8 1L9 21h4l.5-2.2 1.8-1 2.2.2 2-3.5L18 13v-2l1.5-1.5-2-3.5-2.2.2-1.8-1L13 3z"/><circle cx="11" cy="12" r="3"/></svg>';
 const label=document.createElement('span');label.setAttribute('data-i18n','display.open');label.textContent='Display';displayPreferencesButton.append(icon,label);appDisplayTools.append(displayPreferencesButton);
 const renderDisplayPreferencesLabels=()=>{const translate=(key,fallback)=>{const value=window.appI18n?.t(key);return value&&value!==key?value:fallback;};label.textContent=translate('display.open','Display');title.textContent=translate('display.title','Display preferences');textLabel.textContent=translate('display.textSize','Text size');languageLabel.textContent=translate('language','Language');close.textContent=translate('close','Close');};
 window.addEventListener('app-language-changed',renderDisplayPreferencesLabels);window.addEventListener('radio-locals-ready',renderDisplayPreferencesLabels);document.addEventListener('DOMContentLoaded',renderDisplayPreferencesLabels);
 displayPreferencesButton.onclick=()=>{if(displayPreferencesDialog.open)return;displayPreferencesRestoreFocus=true;displayPreferencesButton.setAttribute('aria-expanded','true');displayPreferencesDialog.showModal();close.focus({preventScroll:true});};
 // Keep native cancellation enabled so Escape and the shared popup-history
 // controller can close this harmless preference dialog normally.
 displayPreferencesDialog.addEventListener('cancel',()=>{displayPreferencesRestoreFocus=true;});
 displayPreferencesDialog.addEventListener('click',event=>{if(event.target!==displayPreferencesDialog)return;const box=displayPreferencesDialog.getBoundingClientRect();if(event.clientX<box.left||event.clientX>box.right||event.clientY<box.top||event.clientY>box.bottom)closeDisplayPreferences();});
 displayPreferencesDialog.addEventListener('close',()=>{if(displayPreferencesDialog.open)return;displayPreferencesButton.setAttribute('aria-expanded','false');if(displayPreferencesRestoreFocus&&displayPreferencesButton.isConnected&&!displayPreferencesButton.closest('[hidden]'))displayPreferencesButton.focus({preventScroll:true});displayPreferencesRestoreFocus=true;});
}
function placeAppDisplayTools(){
 if(!appDisplayTools)return;
 const visiblePage=['ownerEntryLoading','myRadio','support','wifiSetup','login','register','editor','advertise','adReview','reports','backups','admin','legal','shared'].find(id=>$(id)&&!$(id).hidden)||null;
 if(displayPreferencesPage!==null&&visiblePage!==displayPreferencesPage)closeDisplayPreferences(false);displayPreferencesPage=visiblePage;
 const panel=['login','register','editor','advertise','adReview','reports','backups','admin','legal'].map(id=>$(id)).find(node=>node&&!node.hidden);
 const target=panel||appToolsHome;if(appDisplayTools.parentElement!==target){if(panel)target.prepend(appDisplayTools);else target.append(appDisplayTools);}
 document.body.classList.toggle('app-owner-page',!!panel);
}
if(appDisplayTools){new MutationObserver(placeAppDisplayTools).observe(document.querySelector('main'),{subtree:true,attributes:true,attributeFilter:['hidden']});window.addEventListener('radio-locals-ready',placeAppDisplayTools);placeAppDisplayTools();}
