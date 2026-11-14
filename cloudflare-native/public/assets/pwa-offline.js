'use strict';
const offlineEnglish={language:'Language',title:'You’re offline',connect:'Reconnect your phone to Wi-Fi or mobile data, then try again.',radio:'Your radio may keep playing if it has its own internet connection.',wifi:'Wi-Fi setup help',step1:'On your radio, open Settings, then Wi-Fi.',step2:'Choose your 2.4 GHz network. Scan refreshes the list; Type name lets you enter a hidden network.',step3:'Enter your Wi-Fi password on the radio, then tap Connect.',step4:'If you use phone setup, join Radio-Setup, then open the local setup page below.',local:'Open local Wi-Fi setup',localHint:'This address works only while your phone is connected to the radio’s setup network.',retry:'Try again',backOnline:'Back online — return to website',online:'The website is reachable again.'};
const offlineCreole={language:'Lang',title:'Ou pa konekte ak entènèt',connect:'Rekonekte telefòn ou ak Wi-Fi oswa done mobil, epi eseye ankò.',radio:'Radyo ou ka kontinye jwe si li gen pwòp koneksyon entènèt li.',wifi:'Èd pou konfigire Wi-Fi',step1:'Sou radyo ou, ouvri Paramèt, apre sa Wi-Fi.',step2:'Chwazi rezo 2.4 GHz ou a. Scan mete lis la ajou; Type name pèmèt ou antre non yon rezo ki kache.',step3:'Antre modpas Wi-Fi ou sou radyo a, epi peze Connect.',step4:'Si w ap sèvi ak telefòn pou konfigirasyon an, konekte ak Radio-Setup, epi ouvri paj lokal ki anba a.',local:'Ouvri konfigirasyon Wi-Fi lokal',localHint:'Adrès sa a mache sèlman pandan telefòn ou konekte ak rezo konfigirasyon radyo a.',retry:'Eseye ankò',backOnline:'Koneksyon retounen — retounen sou sit la',online:'Sit la disponib ankò.'};
const offlineLanguagePicker=document.getElementById('offlineLanguage');let offlineLanguage=(navigator.language||'').toLowerCase().startsWith('ht')?'ht':'en';
try{const saved=localStorage.getItem('radioLocalsLanguage');if(['en','ht'].includes(saved))offlineLanguage=saved;}catch{}
function applyOfflineLanguage(){const words=offlineLanguage==='ht'?offlineCreole:offlineEnglish;document.documentElement.lang=offlineLanguage;offlineLanguagePicker.value=offlineLanguage;document.title=(offlineLanguage==='ht'?'Pa konekte':'Offline')+' — Radio Locals';for(const node of document.querySelectorAll('[data-offline]'))node.textContent=words[node.dataset.offline]||offlineEnglish[node.dataset.offline]||'';}
offlineLanguagePicker.addEventListener('change',()=>{offlineLanguage=offlineLanguagePicker.value==='ht'?'ht':'en';try{localStorage.setItem('radioLocalsLanguage',offlineLanguage);}catch{}applyOfflineLanguage();});
document.getElementById('offlineRetry').addEventListener('click',()=>location.reload());applyOfflineLanguage();
if(location.pathname==='/wifi-setup')document.getElementById('offlineWifi').open=true;
// An online event alone does not prove the website can be reached. Probe only
// a tiny, uncached public asset; never send cookies or fetch private API data.
const offlineBackOnline=document.getElementById('offlineBackOnline'),offlineConnectionStatus=document.getElementById('offlineConnectionStatus');
if(offlineBackOnline&&offlineConnectionStatus){
 let connectionReady=false,probeTimer,probeController,probeGeneration=0,failures=0,stopped=false;
 function showConnection(){const words=offlineLanguage==='ht'?offlineCreole:offlineEnglish;offlineBackOnline.hidden=!connectionReady;offlineConnectionStatus.hidden=!connectionReady;offlineConnectionStatus.textContent=connectionReady?words.online:'';offlineBackOnline.textContent=words.backOnline;}
 function stopProbe(){clearTimeout(probeTimer);probeTimer=undefined;++probeGeneration;probeController?.abort();probeController=null;}
 async function probeConnection(){
  if(stopped||document.hidden||navigator.onLine===false||probeController)return;
  clearTimeout(probeTimer);const generation=++probeGeneration,controller=new AbortController();probeController=controller;const deadline=setTimeout(()=>controller.abort(),4000);
  try{const result=await fetch('/assets/app-release.json',{cache:'no-store',credentials:'omit',redirect:'error',signal:controller.signal});if(!result.ok)throw Error('unavailable');const data=await result.json();if(!/^\d{4}\.\d{2}\.\d{2}\.\d+$/.test(String(data.version||'')))throw Error('unavailable');if(generation!==probeGeneration||stopped)return;connectionReady=true;failures=0;showConnection();}
  catch{if(generation===probeGeneration&&!stopped){connectionReady=false;failures++;showConnection();}}
  finally{clearTimeout(deadline);if(generation===probeGeneration){probeController=null;if(!stopped&&!connectionReady&&!document.hidden&&navigator.onLine!==false)probeTimer=setTimeout(probeConnection,Math.min(60000,15000*2**Math.min(failures,2)));}}
 }
 offlineBackOnline.addEventListener('click',()=>location.reload());
 offlineLanguagePicker.addEventListener('change',showConnection);
 window.addEventListener('online',()=>{connectionReady=false;failures=0;showConnection();void probeConnection();});
 window.addEventListener('offline',()=>{stopProbe();connectionReady=false;showConnection();});
 document.addEventListener('visibilitychange',()=>{if(document.hidden)stopProbe();else void probeConnection();});
 window.addEventListener('pagehide',()=>{stopped=true;stopProbe();});
 showConnection();void probeConnection();
}
