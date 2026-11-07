'use strict';
let installPrompt=null;
const installButton=document.createElement('button');installButton.type='button';installButton.className='home-screen-button';installButton.textContent='Add to Home Screen';installButton.hidden=true;
const installDialog=document.createElement('dialog');installDialog.className='install-help';installDialog.setAttribute('aria-labelledby','installTitle');
const installTitle=document.createElement('h2');installTitle.id='installTitle';installTitle.textContent='Open Radio Locals like an app';
const installDescription=document.createElement('p');installDescription.textContent='On iPhone or iPad, open your browser’s Share menu, choose Add to Home Screen, then tap Add. On Android, open the browser menu and choose Install app or Add to Home screen. If you opened this inside WhatsApp, open it in your main browser first.';
const installDone=document.createElement('button');installDone.type='button';installDone.textContent='Done';installDone.onclick=()=>installDialog.close();installDialog.append(installTitle,installDescription,installDone);document.body.append(installDialog);$('myRadio').append(installButton);
function showInstallOption(){installButton.hidden=matchMedia('(display-mode: standalone)').matches||navigator.standalone===true;}
window.addEventListener('beforeinstallprompt',event=>{event.preventDefault();installPrompt=event;showInstallOption();});
window.addEventListener('appinstalled',()=>{installPrompt=null;installButton.hidden=true;});
installButton.onclick=async()=>{if(installPrompt){const prompt=installPrompt;installPrompt=null;try{await prompt.prompt();await prompt.userChoice;}catch{installDialog.showModal();}}else installDialog.showModal();};
showInstallOption();
if('serviceWorker' in navigator&&location.protocol==='https:')window.addEventListener('load',()=>{navigator.serviceWorker.register('/sw.js',{scope:'/',updateViaCache:'none'}).catch(()=>{});});
