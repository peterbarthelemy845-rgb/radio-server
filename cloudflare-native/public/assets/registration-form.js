(()=>{
 'use strict';
 const registrationForm=document.getElementById('registerForm');
 const registrationIds=['streamManualSetup','streamAddressFields','streamHost','streamPort','streamProtocol','streamPath','streamUrlInput','copyGeneratedStream','testStream','streamTestStatus','streamTestHuman'];
 const registrationNodes=Object.fromEntries(registrationIds.map(id=>[id,document.getElementById(id)]));
 if(!registrationForm||registrationIds.some(id=>!registrationNodes[id]))return;
 const registrationUrl=registrationNodes.streamUrlInput,registrationName=registrationForm.elements?.name,registrationBuilder=[registrationNodes.streamHost,registrationNodes.streamPort,registrationNodes.streamProtocol,registrationNodes.streamPath];
 const registrationProviderFields=[...(registrationForm.querySelectorAll?.('input[name="stream_provider"]')||[])],registrationProviderHelpNode=document.getElementById('streamProviderHelp'),registrationUrlLabel=document.getElementById('streamUrlLabel');
 const registrationPanel=document.getElementById('streamSetupPanel'),registrationUrlRow=document.getElementById('streamUrlRow');
 const registrationHasProviders=registrationProviderFields.length>0;
 let registrationProvider=registrationProviderFields.find(field=>field.checked)?.value||'icecast',registrationSource='url',registrationInternalInput=false,registrationVersion=0,registrationActiveTest=null,registrationValid=false,registrationStatusKey='',registrationStatusFallback='';
 let registrationManualUrl='',registrationManualSource='ip',registrationManualEdited=false,registrationDirectDraft=registrationUrl.value,registrationDirectEdited=Boolean(registrationUrl.value);
 let registrationExpanded=!registrationPanel||registrationProviderFields.some(field=>field.checked);
 function registrationText(key,fallback){const translated=window.appI18n?.t(key);return typeof translated==='string'&&translated!==key?translated:fallback;}
 function registrationManualMode(){return registrationHasProviders&&registrationProvider!=='other';}
 function registrationBusy(){return ['1','true'].includes(registrationForm.dataset.busy)||registrationForm.querySelector('button[type="submit"]')?.disabled===true;}
 function registrationProviderHelp(){
  if(!registrationProviderHelpNode)return;
  const [key,fallback]=registrationProvider==='shoutcast'?['registration.providerShoutcast','Enter your public server, port and listening path.']:registrationProvider==='other'?['registration.providerOther','Paste your complete public listening URL.']:['registration.providerIcecast','Enter your public server, port and mount point.'];
  registrationProviderHelpNode.setAttribute('data-i18n',key);registrationProviderHelpNode.textContent=registrationText(key,fallback);
 }
 function registrationRenderMode(){
  registrationProviderHelp();if(!registrationHasProviders)return;
  const manual=registrationManualMode(),active=registrationExpanded;
  if(registrationPanel)registrationPanel.hidden=!active;
  registrationNodes.streamManualSetup.hidden=!active||!manual;registrationNodes.streamManualSetup.open=active&&manual;registrationNodes.streamAddressFields.hidden=!active||!manual;registrationUrl.readOnly=manual;
  if(registrationUrlRow)registrationUrlRow.hidden=!active||manual;
  if(registrationUrlLabel){const key=manual?'registration.generated':'registration.streamUrl',fallback=manual?'Generated stream URL':'Stream URL';registrationUrlLabel.setAttribute('data-i18n',key);registrationUrlLabel.textContent=registrationText(key,fallback);}
  const placeholderKey=manual?'registration.generatedPlaceholder':'registration.directPlaceholder';registrationUrl.dataset.i18nPlaceholder=placeholderKey;registrationUrl.placeholder=registrationText(placeholderKey,manual?'Your stream URL appears here':'https://example.com/stream.mp3');
  for(const field of registrationBuilder){field.required=false;field.disabled=!active||!manual||registrationBusy();field.setCustomValidity('');}
  if(registrationPanel){registrationUrl.disabled=!active||registrationBusy();registrationUrl.required=active&&!manual;registrationNodes.copyGeneratedStream.hidden=true;}
 }
 // Each entry mode keeps its draft. Only a newly edited, valid direct URL
 // replaces the server details; switching providers never guesses a mount.
 function registrationSelectProvider(value){
  const wasManual=registrationManualMode(),nextManual=value!=='other';
  if(wasManual&&!nextManual){registrationManualUrl=registrationUrl.value;registrationManualSource=registrationSource;if(registrationValid&&registrationManualEdited)registrationDirectDraft=registrationUrl.value;registrationDirectEdited=false;registrationManualEdited=false;registrationUrl.value=registrationDirectDraft;registrationSource='url';}
  else if(!wasManual&&nextManual){registrationDirectDraft=registrationUrl.value;if(registrationDirectEdited){try{registrationSyncBuilder(registrationParse(registrationDirectDraft));registrationManualUrl=registrationDirectDraft;registrationManualSource='url';}catch{}}registrationUrl.value=registrationManualUrl;registrationSource=registrationManualSource;registrationDirectEdited=false;registrationManualEdited=false;}
  registrationProvider=value;registrationExpanded=true;registrationInvalidate();registrationRenderMode();registrationValidate();
 }
 for(const field of registrationProviderFields){
  const select=()=>{if(!field.checked)return;if(registrationBusy()){for(const choice of registrationProviderFields)choice.checked=registrationExpanded&&choice.value===registrationProvider;return;}if(!registrationExpanded||field.value!==registrationProvider)registrationSelectProvider(field.value);};
  field.addEventListener('change',select);if(registrationPanel)field.addEventListener('click',select);
 }
 function registrationStatus(key,fallback,state='',preserveHidden=false){
  const target=registrationNodes.streamTestStatus;if(!preserveHidden)target.hidden=false;target.dataset.state=state;registrationStatusKey=key;registrationStatusFallback=fallback;
  if(key)target.setAttribute('data-i18n',key);else target.removeAttribute('data-i18n');
  target.textContent=key?registrationText(key,fallback):fallback;
 }
 function registrationTerminal(key,fallback,state){
  registrationStatus(key,fallback,state);let displayed=false;
  try{displayed=window.showStreamTestResult?.({source:'registration',key,fallback,state})===true;}catch{}
  registrationNodes.streamTestStatus.hidden=displayed;
 }
 function registrationInvalidate(){registrationVersion++;registrationActiveTest=null;try{window.closeStreamTestResult?.('registration');}catch{}registrationStatus('','');}
 function registrationValidateName(report=false){
  if(!registrationName)return true;
  const name=registrationName.value.trim(),missing=!name,invalid=missing||/[\x00-\x1f\x7f]/.test(name)||new TextEncoder().encode(name).length>96;
  registrationName.setCustomValidity(missing?registrationText('registration.nameRequired','Enter your station name.'):invalid?registrationText('registration.shorterName','Shorten the station name so it fits on the radio.'):'');
  if(report&&!invalid)registrationName.value=name;
  if(invalid&&report){registrationName.focus();registrationName.reportValidity();}return !invalid;
 }
 function registrationPublicIpv4(host){
  if(!/^\d+\.\d+\.\d+\.\d+$/.test(host))return false;
  const parts=host.split('.').map(Number);if(parts.some(part=>part<0||part>255))return false;
  const [a,b,c]=parts;
  return !(a===0||a===10||a===127||a>=224||a===100&&b>=64&&b<=127||a===169&&b===254||a===172&&b>=16&&b<=31||a===192&&(b===168||b===0||b===88&&c===99)||a===198&&(b===18||b===19||b===51&&c===100)||a===203&&b===0&&c===113);
 }
 function registrationIssue(key,fallback,field){return {key,fallback,field,message:registrationText(key,fallback)};}
 function registrationParse(value){
  const raw=String(value||'').trim();
  if(raw.length>1024)throw registrationIssue('registration.urlLength','Stream URLs must be 1,024 characters or fewer.');
  if(!raw||!/^https?:\/\//i.test(raw)||/[\x00-\x20\x7f\\#]/.test(raw))throw registrationIssue('registration.validUrl','Enter a complete public HTTP or HTTPS stream URL without a fragment.');
  let parsed;try{parsed=new URL(raw);}catch{throw registrationIssue('registration.completeUrl','Enter a complete public HTTP or HTTPS stream URL.');}
  if(parsed.href.length>1024)throw registrationIssue('registration.urlLength','Stream URLs must be 1,024 characters or fewer.');
  const host=parsed.hostname.toLowerCase();
  if(parsed.username||parsed.password||parsed.hash||!['http:','https:'].includes(parsed.protocol))throw registrationIssue('registration.noCredentials','Use a public stream URL without a username, password or fragment.');
  if(parsed.port==='0')throw registrationIssue('registration.validPort','Enter a port from 1 to 65535, or leave it blank.');
  if(host.endsWith('.')||host.startsWith('[')||!host.includes('.')||/(?:^|\.)(?:localhost|local|internal|lan|home|home\.arpa|arpa|invalid|test|example|onion)$/.test(host))throw registrationIssue('registration.publicHost','Use a public server hostname or public IPv4 address.');
  if(/^\d+\.\d+\.\d+\.\d+$/.test(host)){if(!registrationPublicIpv4(host))throw registrationIssue('registration.publicIpv4','Use a public IPv4 address, not a local or reserved address.');}
  else if(host.length>253||host.split('.').some(label=>!/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label)))throw registrationIssue('registration.publicHost','Use a public server hostname or public IPv4 address.');
  for(const key of parsed.searchParams.keys())if(/^(?:access[_-]?token|token|auth(?:orization)?|api[_-]?key|key|password|pass|secret|signature|sig)$/i.test(key))throw registrationIssue('registration.noTokens','Use a public stream URL without private access tokens or passwords.');
  return parsed;
 }
 window.parsePublicStreamUrl=registrationParse;
 function registrationSetUrl(value){
  if(registrationUrl.value===value)return;
  registrationUrl.value=value;registrationInternalInput=true;
  try{registrationUrl.dispatchEvent(new Event('input',{bubbles:true}));}finally{registrationInternalInput=false;}
 }
 function registrationSyncBuilder(parsed){
  registrationNodes.streamHost.value=parsed?.hostname||'';registrationNodes.streamPort.value=parsed?.port||'';
  registrationNodes.streamProtocol.value=parsed?parsed.protocol.slice(0,-1):'https';registrationNodes.streamPath.value=parsed?parsed.pathname+parsed.search:'';
 }
 function registrationControls(){
  const submitting=registrationBusy(),inactive=!registrationExpanded;
  if(registrationHasProviders)for(const field of registrationBuilder)field.disabled=inactive||!registrationManualMode()||submitting;
  if(registrationPanel){registrationUrl.disabled=inactive||submitting;registrationUrl.required=!inactive&&!registrationManualMode();}
  registrationNodes.testStream.disabled=Boolean(registrationActiveTest)||!registrationValid||submitting||inactive;
  registrationNodes.copyGeneratedStream.disabled=!registrationValid||submitting||inactive;
 }
 function registrationCompose(){
  const host=registrationNodes.streamHost.value.trim(),port=registrationNodes.streamPort.value.trim(),protocol=registrationNodes.streamProtocol.value,path=registrationNodes.streamPath.value.trim()||'/';
  if(!host||/[\s\/:@?#\[\]\\]/.test(host))throw registrationIssue('registration.hostOnly','Enter only the public server hostname or IPv4 address.',registrationNodes.streamHost);
  if(!['https','http'].includes(protocol))throw registrationIssue('registration.chooseProtocol','Choose HTTP or HTTPS.',registrationNodes.streamProtocol);
  if(registrationNodes.streamPort.validity?.badInput||port&&!/^\d{1,5}$/.test(port)||port&&(Number(port)<1||Number(port)>65535))throw registrationIssue('registration.validPort','Enter a port from 1 to 65535, or leave it blank.',registrationNodes.streamPort);
  if(!path.startsWith('/')||path.startsWith('//')||/[\x00-\x1f\x7f\\#]/.test(path))throw registrationIssue('registration.validPath','Start the stream path with one / and do not include a fragment.',registrationNodes.streamPath);
  try{return registrationParse(protocol+'://'+host+(port?':'+port:'')+path);}catch(error){throw {...error,field:['registration.noTokens','registration.urlLength'].includes(error.key)?registrationNodes.streamPath:registrationNodes.streamHost};}
 }
 function registrationValidate(report=false,canonicalize=false){
  registrationUrl.setCustomValidity('');for(const field of registrationBuilder)field.setCustomValidity('');
  if(!registrationExpanded){registrationValid=false;registrationControls();return false;}
  try{
   const parsed=registrationSource==='ip'?registrationCompose():registrationParse(registrationUrl.value);
   if(registrationSource==='ip'||canonicalize)registrationSetUrl(parsed.href);
   if(registrationSource==='url'&&!registrationHasProviders)registrationSyncBuilder(parsed);
   registrationValid=true;registrationControls();return true;
  }catch(error){
   registrationValid=false;
   const field=error.field||(registrationManualMode()?registrationNodes.streamHost:registrationUrl),safe=error.message||'Check the stream address and try again.';
   field.setCustomValidity(safe);
   if(registrationSource==='ip')registrationSetUrl('');else if(!registrationHasProviders)registrationSyncBuilder(null);
   registrationControls();
   if(report){if(registrationBuilder.includes(field))registrationNodes.streamManualSetup.open=true;registrationStatus(error.key||'',error.fallback||safe,'invalid');field.focus();field.reportValidity();}
   return false;
  }
 }
 registrationUrl.addEventListener('input',()=>{if(registrationInternalInput||registrationBusy()||registrationManualMode()||!registrationExpanded)return;registrationSource='url';registrationDirectDraft=registrationUrl.value;registrationDirectEdited=true;registrationInvalidate();registrationValidate();});
 for(const field of registrationBuilder){
  field.addEventListener('invalid',()=>{registrationNodes.streamManualSetup.open=true;});
  for(const event of ['input','change'])field.addEventListener(event,()=>{if(registrationBusy()||registrationHasProviders&&!registrationManualMode()||!registrationExpanded)return;registrationSource='ip';registrationManualEdited=true;registrationInvalidate();registrationValidate();registrationForm.dispatchEvent(new Event('input',{bubbles:true}));});
 }
 if(registrationName)registrationName.addEventListener('input',()=>registrationValidateName());
 window.prepareRegistrationStream=()=>{
  if(!registrationValidateName(true))return false;
  if(!registrationExpanded){for(const field of registrationProviderFields)field.checked=field.value==='icecast';registrationSelectProvider('icecast');}
  return registrationValidate(true,true);
 };
 registrationForm.addEventListener('form-busy-changed',()=>{if(registrationBusy())registrationInvalidate();registrationControls();});
 registrationNodes.copyGeneratedStream.onclick=async()=>{
  if(registrationBusy()||!registrationExpanded||!registrationValidate(true,true))return;const value=registrationUrl.value,version=registrationVersion,current=()=>registrationVersion===version&&registrationUrl.value===value&&!registrationBusy()&&!document.getElementById('register').hidden&&registrationExpanded;
  try{if(!window.isSecureContext||!navigator.clipboard?.writeText)throw new Error();await navigator.clipboard.writeText(value);if(current())registrationStatus('registration.urlCopied','Stream URL copied.','copy');}
  catch{if(current()){registrationUrl.focus();registrationUrl.select();registrationStatus('registration.copyManually','Select and copy the stream URL shown above.','copy');}}
 };
 registrationNodes.testStream.onclick=async()=>{
  if(registrationBusy()||!registrationExpanded||registrationActiveTest||!registrationValidate(true,true))return;
  const target=new URL(registrationUrl.value);
  if(/^\d+\.\d+\.\d+\.\d+$/.test(target.hostname)){registrationTerminal('registration.ipTestUnavailable','Automatic testing is unavailable for numeric IP addresses. You can still save privately and request review.','unconfirmed');return;}
  if(/\.(?:pls|m3u|m3u8|xspf)$/i.test(target.pathname)){registrationTerminal('registration.playlistTestUnavailable','This playlist link cannot be checked automatically. You can still save privately and request review.','unconfirmed');return;}
  const version=registrationVersion,value=registrationUrl.value,attempt={};registrationActiveTest=attempt;registrationControls();
  registrationStatus('registration.checking','Checking the stream. No audio will play.','checking');
  const current=()=>registrationActiveTest===attempt&&registrationVersion===version&&registrationUrl.value===value&&!registrationBusy()&&!document.getElementById('register').hidden&&registrationExpanded;
  try{
   const turnstile_token=await human(registrationNodes.streamTestHuman,'stream-check');if(!current())return;
   const response=await api('/api/owner/stream-check',{stream_url:value,turnstile_token});if(!current())return;
   if(response.result==='audio_response'&&response.audio_response===true)registrationTerminal('registration.audioResponse','Stream check passed. Save your station to continue. Playback is not verified.','success');
   else if(response.result==='not_confirmed'&&response.audio_response===false)registrationTerminal('registration.notConfirmed','Stream could not be confirmed. You can still save privately and request review.','unconfirmed');
   else registrationTerminal('registration.notConfirmed','Stream could not be confirmed. You can still save privately and request review.','unconfirmed');
  }catch(error){if(current())registrationTerminal('',String(error.message||'The stream check did not complete. You can still save it.').slice(0,400),'error');}
  finally{if(registrationActiveTest===attempt){registrationActiveTest=null;registrationControls();}}
 };
 new MutationObserver(()=>{if(document.getElementById('register').hidden){registrationInvalidate();registrationControls();}}).observe(document.getElementById('register'),{attributes:true,attributeFilter:['hidden']});
 window.addEventListener('app-language-changed',()=>{registrationRenderMode();registrationValidateName();registrationValidate();if(registrationStatusKey)registrationStatus(registrationStatusKey,registrationStatusFallback,registrationNodes.streamTestStatus.dataset.state,true);});
 registrationForm.addEventListener('reset',()=>{registrationInvalidate();queueMicrotask(()=>{registrationProvider=registrationProviderFields.find(field=>field.checked)?.value||'icecast';registrationExpanded=!registrationPanel||registrationProviderFields.some(field=>field.checked);registrationSource=registrationManualMode()?'ip':'url';registrationManualUrl='';registrationManualSource='ip';registrationManualEdited=false;registrationDirectDraft='';registrationDirectEdited=false;registrationUrl.value='';registrationNodes.streamManualSetup.open=false;registrationSyncBuilder(null);registrationRenderMode();registrationValidateName();registrationValidate();});});
 for(const field of registrationBuilder){field.disabled=false;field.required=false;field.setCustomValidity('');}
 registrationNodes.streamAddressFields.hidden=false;registrationUrl.readOnly=false;registrationNodes.streamManualSetup.open=false;

 if(registrationManualMode()){registrationSource='ip';try{registrationSyncBuilder(registrationParse(registrationUrl.value));registrationSource='url';registrationManualUrl=registrationUrl.value;registrationManualSource='url';}catch{}registrationDirectEdited=false;}
 registrationRenderMode();registrationValidate();
})();
