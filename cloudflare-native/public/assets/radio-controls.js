'use strict';
// Controls use browser-scoped grants approved on the physical radio. No device
// secrets, arbitrary stream URLs, or commands are saved in browser storage.
const radioControlRadios=new Map(),radioControlLaunchers=new Map();
let radioControlsCurrent='',radioControlsChecked=0,radioControlsAvailable=false,radioControlsStaleTimer,radioControlsEditingVolume=false,radioControlsMessageKey='',radioControlsMessageParams={},radioControlsRelease=null;
window.radioControlsBusy=false;
const radioControlFallback={
 'device':'Device Code','controls.open':'Radio controls','controls.title':'Control your radio','controls.enable':'Enable phone controls','controls.permission':'Approve phone controls on your physical radio first.','controls.wait':'Match {number} and tap Allow on your radio.','controls.enabled':'Phone controls enabled.','controls.volume':'Volume','controls.mute':'Mute','controls.unmute':'Unmute','controls.station':'Saved station','controls.play':'Play on radio','controls.software':'Radio software','controls.version':'Installed version','controls.unknown':'Not reported yet','controls.updateNeeded':'Update the radio software to use phone controls.','controls.offline':'Controls are unavailable. Keep the radio on and connected to Wi-Fi.','controls.waiting':'Waiting for the radio…','controls.applied':'The radio confirmed the change.','controls.failed':'The radio did not confirm. Check its power and Wi-Fi, then try again.','controls.download':'Download Arduino sketch','controls.instructions':'Connect the radio by USB, open the sketch in Arduino IDE, select the ESP32-S3 board and port, then upload. Keep your existing private provisioning file.','controls.noSaved':'No saved stations reported yet. Add a station first.','controls.latest':'Latest version','controls.checking':'Checking radio controls…','controls.cancelled':'Phone controls were not approved.','controls.refresh':'Refresh radio status','close':'Close'
};
function radioControlText(key,params={}){let text=window.appI18n?.t(key,params)||radioControlFallback[key]||key;if(text===key)text=radioControlFallback[key]||key;for(const [name,value] of Object.entries(params))text=text.replaceAll('{'+name+'}',String(value));return text;}
function radioControlNode(tag,key,className){const node=document.createElement(tag);if(key){node.dataset.i18n=key;node.textContent=radioControlText(key);}if(className)node.className=className;return node;}
const radioControlsDialog=radioControlNode('dialog',null,'radio-controls-panel');radioControlsDialog.id='radioControlsDialog';radioControlsDialog.setAttribute('aria-labelledby','radioControlsTitle');window.radioControlsDialog=radioControlsDialog;
const radioControlsClose=radioControlNode('button','close','secondary radio-controls-close');radioControlsClose.type='button';
const radioControlsTitle=radioControlNode('h2','controls.title');radioControlsTitle.id='radioControlsTitle';
const radioControlsDevice=document.createElement('p');radioControlsDevice.className='radio-controls-device';
const radioControlsHelp=document.createElement('p');radioControlsHelp.className='radio-controls-help';
const radioControlsEnable=radioControlNode('button','controls.enable');radioControlsEnable.type='button';
const radioControlsFields=document.createElement('div');radioControlsFields.className='radio-controls-fields';
const radioControlsStationLabel=radioControlNode('label');radioControlsStationLabel.append(radioControlNode('span','controls.station'));
const radioControlsStation=document.createElement('select');radioControlsStationLabel.append(radioControlsStation);
const radioControlsPlay=radioControlNode('button','controls.play');radioControlsPlay.type='button';
const radioControlsVolumeLabel=radioControlNode('label');radioControlsVolumeLabel.append(radioControlNode('span','controls.volume'));
const radioControlsVolume=document.createElement('input');radioControlsVolume.type='range';radioControlsVolume.min='0';radioControlsVolume.max='100';radioControlsVolume.step='1';radioControlsVolume.value='0';
const radioControlsVolumeValue=document.createElement('output');radioControlsVolumeValue.textContent='—';radioControlsVolumeLabel.append(radioControlsVolume,radioControlsVolumeValue);
const radioControlsMute=radioControlNode('button','controls.mute','secondary');radioControlsMute.type='button';radioControlsMute.setAttribute('aria-pressed','false');
radioControlsFields.append(radioControlsStationLabel,radioControlsPlay,radioControlsVolumeLabel,radioControlsMute);
const radioControlsNotice=document.createElement('p');radioControlsNotice.className='radio-controls-notice';radioControlsNotice.setAttribute('role','status');
const radioControlsRefresh=radioControlNode('button','controls.refresh','secondary');radioControlsRefresh.type='button';
const radioSoftware=document.createElement('details');radioSoftware.className='radio-software';radioSoftware.append(radioControlNode('summary','controls.software'));
const radioSoftwareInstalled=document.createElement('p'),radioSoftwareLatest=document.createElement('p');
const radioSoftwareDownload=radioControlNode('a','controls.download');radioSoftwareDownload.href='/assets/waveshare-radio.zip';radioSoftwareDownload.setAttribute('download','waveshare-radio.zip');
radioSoftware.append(radioSoftwareInstalled,radioSoftwareLatest,radioSoftwareDownload,radioControlNode('p','controls.instructions'));
radioControlsDialog.append(radioControlsClose,radioControlsTitle,radioControlsDevice,radioControlsHelp,radioControlsEnable,radioControlsFields,radioControlsNotice,radioControlsRefresh,radioSoftware);document.body.append(radioControlsDialog);
function radioControlsMessage(key,params={}){radioControlsMessageKey=key;radioControlsMessageParams=params;radioControlsNotice.textContent=key?radioControlText(key,params):'';}
function radioControlsFresh(radio){return !!radio&&radioControlsAvailable&&Date.now()-radioControlsChecked<30000&&radio.online===true&&radio.remote_control_version===1&&radio.controls_ready===true;}
function radioControlsSoftware(){
 const radio=radioControlRadios.get(radioControlsCurrent);radioSoftwareInstalled.replaceChildren(radioControlNode('span','controls.version'),document.createTextNode(': '+(radio?.firmware_version||radioControlText('controls.unknown'))));
 radioSoftwareLatest.replaceChildren(radioControlNode('span','controls.latest'),document.createTextNode(': '+(radioControlsRelease?.version||radioControlText('controls.unknown'))));
}
function radioControlsSavedStations(){
 const inventory=typeof readRadioInventory==='function'?readRadioInventory(radioControlsCurrent):null;
 const saved=inventory?.known?stations.filter(station=>inventory.codes.has(String(station.listener_code))):[];
 const previous=radioControlsStation.value,current=radioControlRadios.get(radioControlsCurrent)?.current_station_code;
 const signature=JSON.stringify(saved.map(station=>[station.listener_code,station.name]));
 if(signature!==radioControlsStation.dataset.snapshot){radioControlsStation.dataset.snapshot=signature;radioControlsStation.replaceChildren();
  if(!saved.length){const empty=radioControlNode('option','controls.noSaved');empty.value='';radioControlsStation.append(empty);}
  for(const station of saved){const option=document.createElement('option');option.value=String(station.listener_code);option.textContent=station.name;option.dataset.i18nSkip='true';radioControlsStation.append(option);}
  radioControlsStation.value=saved.some(s=>String(s.listener_code)===previous)?previous:saved.some(s=>String(s.listener_code)===current)?current:saved[0]?String(saved[0].listener_code):'';
 }
 return saved.length>0;
}
function renderRadioControls(){
 if(!radioControlsCurrent)return;
 const radio=radioControlRadios.get(radioControlsCurrent),fresh=radioControlsFresh(radio),allowed=radio?.controls_allowed===true,busy=window.radioControlsBusy;
 radioControlsDevice.replaceChildren(radioControlNode('span','device'),document.createTextNode(' '+(radio?.device_code||'—')));
 const helpKey=radio?.remote_control_version!==1?'controls.updateNeeded':!fresh?'controls.offline':!allowed?'controls.permission':'controls.enabled';radioControlsHelp.dataset.i18n=helpKey;radioControlsHelp.textContent=radioControlText(helpKey);
 radioControlsEnable.hidden=allowed||radio?.remote_control_version!==1;radioControlsEnable.disabled=busy||!fresh;
 const saved=radioControlsSavedStations();radioControlsStation.disabled=busy||!fresh||!allowed||!saved;radioControlsPlay.disabled=radioControlsStation.disabled;
 const volumeKnown=Number.isInteger(radio?.volume_percent)&&radio.volume_percent>=0&&radio.volume_percent<=100;
 radioControlsVolume.disabled=busy||!fresh||!allowed||!volumeKnown;
 if(!radioControlsEditingVolume){if(volumeKnown){radioControlsVolume.value=String(radio.volume_percent);radioControlsVolumeValue.textContent=radio.volume_percent+'%';}else radioControlsVolumeValue.textContent='—';}
 radioControlsMute.disabled=busy||!fresh||!allowed||typeof radio?.muted!=='boolean';const muteKey=radio?.muted?'controls.unmute':'controls.mute';radioControlsMute.dataset.i18n=muteKey;radioControlsMute.textContent=radioControlText(muteKey);radioControlsMute.setAttribute('aria-pressed',String(radio?.muted===true));
 radioControlsClose.disabled=busy;radioControlsRefresh.disabled=busy;radioControlsDialog.setAttribute('aria-busy',String(busy));
 for(const button of radioControlLaunchers.values())button.disabled=busy;
 radioControlsSoftware();if(radioControlsMessageKey)radioControlsNotice.textContent=radioControlText(radioControlsMessageKey,radioControlsMessageParams);
 window.dispatchEvent(new Event('app-content-changed'));
}
function radioControlsSetBusy(value){window.radioControlsBusy=value;renderRadioControls();}
function radioControlsStatus(event){
 const detail=event.detail||{};
 if(detail.unavailable){radioControlsAvailable=false;renderRadioControls();return;}
 if(!Array.isArray(detail.radios))return;
 radioControlsAvailable=true;radioControlsChecked=Date.now();radioControlRadios.clear();for(const radio of detail.radios)radioControlRadios.set(String(radio.id),radio);
 for(const [id,view] of radioCardViews){const card=view.status.parentElement;if(!card)continue;let button=radioControlLaunchers.get(id);if(!button){button=radioControlNode('button','controls.open','secondary radio-controls-launch');button.type='button';button.onclick=()=>openRadioControls(id);radioControlLaunchers.set(id,button);}if(button.parentElement!==card)card.append(button);}
 for(const id of radioControlLaunchers.keys())if(!radioControlRadios.has(id))radioControlLaunchers.delete(id);
 clearTimeout(radioControlsStaleTimer);radioControlsStaleTimer=setTimeout(()=>{radioControlsAvailable=false;renderRadioControls();},30000);renderRadioControls();
}
async function loadRadioRelease(){if(radioControlsRelease)return;try{const response=await fetch('/assets/radio-release.json');if(!response.ok)return;const release=await response.json();if(/^[A-Za-z0-9][A-Za-z0-9._+-]{0,31}$/.test(release.version||'')&&release.sketch_url==='/assets/waveshare-radio.zip'){radioControlsRelease={version:release.version};radioControlsSoftware();}}catch{}}
async function openRadioControls(id){
 if(window.radioControlsBusy||!radioControlRadios.has(id))return;
 radioControlsCurrent=id;radioControlsEditingVolume=false;radioControlsMessage('');delete radioControlsStation.dataset.snapshot;renderRadioControls();const trigger=document.activeElement;radioControlsDialog.showModal();window.dispatchEvent(new CustomEvent('radio-controls-opened',{detail:{radioId:id,trigger}}));
 if(typeof loadRadioInventory==='function')await loadRadioInventory(id,true);renderRadioControls();loadRadioRelease();
}
window.closeRadioControls=()=>{if(window.radioControlsBusy){if(radioControlsMessageKey!=='controls.wait')radioControlsMessage('controls.waiting');return false;}if(radioControlsDialog.open)radioControlsDialog.close();return true;};
radioControlsClose.onclick=()=>window.closeRadioControls();radioControlsDialog.addEventListener('cancel',event=>{event.preventDefault();window.closeRadioControls();});
radioControlsDialog.addEventListener('close',()=>{radioControlsEditingVolume=false;window.dispatchEvent(new Event('radio-controls-closed'));});
async function refreshRadioControls(){const result=await api('/api/phone/radios');radioControlsStatus({detail:{radios:result.radios}});if(typeof loadMyRadios==='function')loadMyRadios(true);}
radioControlsRefresh.onclick=async()=>{radioControlsRefresh.disabled=true;try{await refreshRadioControls();radioControlsMessage('');}catch{radioControlsAvailable=false;radioControlsMessage('controls.offline');}finally{renderRadioControls();}};
const radioControlWait=()=>new Promise(resolve=>setTimeout(resolve,2000));
radioControlsEnable.onclick=async()=>{
 const radio=radioControlRadios.get(radioControlsCurrent);if(window.radioControlsBusy||!radioControlsFresh(radio)||radio?.controls_allowed)return;
 radioControlsSetBusy(true);
 try{
  const claim=await api('/api/phone/control/authorize',{radio_id:radioControlsCurrent});radioControlsMessage('controls.wait',{number:claim.confirmation_code});
  const deadline=Date.now()+180000;let approved=false;
  while(Date.now()<deadline){await radioControlWait();const result=await api('/api/phone/claim/status',{claim_id:claim.claim_id});if(result.state==='approved'){approved=true;break;}if(result.state!=='waiting')throw Error('Not approved');}
  if(!approved)throw Error('Not approved');await refreshRadioControls();radioControlsMessage('controls.enabled');
 }catch{radioControlsMessage('controls.cancelled');}
 finally{radioControlsSetBusy(false);}
};
async function sendRadioControl(action,value){
 const radio=radioControlRadios.get(radioControlsCurrent);if(window.radioControlsBusy||!radioControlsFresh(radio)||!radio?.controls_allowed)return;
 radioControlsSetBusy(true);radioControlsMessage('controls.waiting');
 try{
  const command=await api('/api/phone/control',{radio_id:radioControlsCurrent,action,value,request_id:crypto.randomUUID()});
  let applied=command.state==='applied';if(['failed','expired'].includes(command.state))throw Error('Command failed');
  const deadline=Date.now()+65000;
  while(!applied&&Date.now()<deadline){await radioControlWait();const result=await api('/api/phone/control/status',{command_id:command.command_id});if(result.state==='applied'){applied=true;break;}if(['failed','expired'].includes(result.state))throw Error('Command failed');}
  if(!applied)throw Error('Not confirmed');
  radioControlsMessage('controls.applied');try{await refreshRadioControls();}catch{radioControlsAvailable=false;}
 }catch(error){if(error.status===403&&radio)radio.controls_allowed=false;radioControlsMessage('controls.failed');}
 finally{radioControlsEditingVolume=false;radioControlsSetBusy(false);}
}
radioControlsPlay.onclick=()=>{if(radioControlsStation.value)sendRadioControl('select_station',radioControlsStation.value);};
radioControlsVolume.oninput=()=>{radioControlsEditingVolume=true;radioControlsVolumeValue.textContent=radioControlsVolume.value+'%';};radioControlsVolume.onpointerdown=()=>{radioControlsEditingVolume=true;};radioControlsVolume.onfocus=()=>{radioControlsEditingVolume=true;};
radioControlsVolume.onchange=()=>{const value=Number(radioControlsVolume.value);if(Number.isInteger(value)&&value>=0&&value<=100)sendRadioControl('set_volume',value);};radioControlsVolume.onblur=()=>{if(!window.radioControlsBusy){radioControlsEditingVolume=false;renderRadioControls();}};
radioControlsMute.onclick=()=>{const radio=radioControlRadios.get(radioControlsCurrent);if(typeof radio?.muted==='boolean')sendRadioControl('set_mute',!radio.muted);};
window.addEventListener('radio-status-updated',radioControlsStatus);
window.addEventListener('radio-inventory-changed',event=>{if(event.detail?.radioId===radioControlsCurrent)renderRadioControls();});
window.addEventListener('app-language-changed',renderRadioControls);
window.addEventListener('offline',()=>{radioControlsAvailable=false;renderRadioControls();});
if(typeof radioLastChecked==='number'&&radioLastChecked&&typeof radioCardViews!=='undefined')radioControlsStatus({detail:{radios:[...radioCardViews.values()].map(view=>view.radio)}});
