(()=>{
 'use strict';
 const registrationForm=document.getElementById('registerForm');
 const registrationIds=['connectionUrlMode','connectionIpMode','streamAddressFields','streamHost','streamPort','streamProtocol','streamPath','streamUrlInput','generatedStreamUrl','copyGeneratedStream','testStream','streamTestStatus','streamTestHuman'];
 const registrationNodes=Object.fromEntries(registrationIds.map(id=>[id,document.getElementById(id)]));
 if(!registrationForm||registrationIds.some(id=>!registrationNodes[id]))return;
 const registrationUrl=registrationNodes.streamUrlInput,registrationBuilder=[registrationNodes.streamHost,registrationNodes.streamPort,registrationNodes.streamProtocol,registrationNodes.streamPath];
 let registrationMode='url',registrationUrlDraft=registrationUrl.value,registrationInternalInput=false,registrationVersion=0,registrationActiveTest=null,registrationValid=false,registrationStatusKey='',registrationStatusFallback='';
 function registrationText(key,fallback){const translated=window.appI18n?.t(key);return typeof translated==='string'&&translated!==key?translated:fallback;}
 function registrationStatus(key,fallback,state=''){
  const target=registrationNodes.streamTestStatus;target.dataset.state=state;registrationStatusKey=key;registrationStatusFallback=fallback;
  if(key)target.setAttribute('data-i18n',key);else target.removeAttribute('data-i18n');
  target.textContent=key?registrationText(key,fallback):fallback;
 }
 function registrationInvalidate(){registrationVersion++;registrationActiveTest=null;registrationStatus('','');}
 function registrationPublicIpv4(host){
  if(!/^\d+\.\d+\.\d+\.\d+$/.test(host))return false;
  const parts=host.split('.').map(Number);if(parts.some(part=>part<0||part>255))return false;
  const [a,b,c]=parts;
  return !(a===0||a===10||a===127||a>=224||a===100&&b>=64&&b<=127||a===169&&b===254||a===172&&b>=16&&b<=31||a===192&&(b===168||b===0||b===88&&c===99)||a===198&&(b===18||b===19||b===51&&c===100)||a===203&&b===0&&c===113);
 }
 function registrationIssue(key,fallback,field){return {key,fallback,field,message:registrationText(key,fallback)};}
 function registrationParse(value){
  const raw=String(value||'').trim();
  if(!raw||raw.length>2048||!/^https?:\/\//i.test(raw)||/[\x00-\x1f\x7f\\#]/.test(raw))throw registrationIssue('registration.validUrl','Enter a complete public HTTP or HTTPS stream URL without a fragment.');
  let parsed;try{parsed=new URL(raw);}catch{throw registrationIssue('registration.completeUrl','Enter a complete public HTTP or HTTPS stream URL.');}
  const host=parsed.hostname.toLowerCase();
  if(parsed.username||parsed.password||parsed.hash||!['http:','https:'].includes(parsed.protocol))throw registrationIssue('registration.noCredentials','Use a public stream URL without a username, password or fragment.');
  if(parsed.port==='0')throw registrationIssue('registration.validPort','Enter a port from 1 to 65535, or leave it blank.');
  if(host.endsWith('.')||host.startsWith('[')||!host.includes('.')||/(?:^|\.)(?:localhost|local|internal|lan|home|home\.arpa|arpa|invalid|test|example|onion)$/.test(host))throw registrationIssue('registration.publicHost','Use a public server hostname or public IPv4 address.');
  if(/^\d+\.\d+\.\d+\.\d+$/.test(host)){if(!registrationPublicIpv4(host))throw registrationIssue('registration.publicIpv4','Use a public IPv4 address, not a local or reserved address.');}
  else if(host.length>253||host.split('.').some(label=>!/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label)))throw registrationIssue('registration.publicHost','Use a public server hostname or public IPv4 address.');
  for(const key of parsed.searchParams.keys())if(/^(?:access[_-]?token|token|auth(?:orization)?|api[_-]?key|key|password|pass|secret|signature|sig)$/i.test(key))throw registrationIssue('registration.noTokens','Use a public stream URL without private access tokens or passwords.');
  return parsed;
 }
 function registrationSetUrl(value){
  if(registrationUrl.value===value)return;
  registrationUrl.value=value;registrationInternalInput=true;
  try{registrationUrl.dispatchEvent(new Event('input',{bubbles:true}));}finally{registrationInternalInput=false;}
 }
 function registrationControls(){
  const submitting=registrationForm.querySelector('button[type="submit"]')?.disabled===true;
  registrationNodes.testStream.disabled=Boolean(registrationActiveTest)||!registrationValid||submitting;
  registrationNodes.copyGeneratedStream.disabled=!registrationValid||submitting;
 }
 function registrationCompose(){
  const host=registrationNodes.streamHost.value.trim(),port=registrationNodes.streamPort.value.trim(),protocol=registrationNodes.streamProtocol.value,path=registrationNodes.streamPath.value.trim()||'/live';
  if(!host||/[\s\/:@?#\[\]\\]/.test(host))throw registrationIssue('registration.hostOnly','Enter only the public server hostname or IPv4 address.',registrationNodes.streamHost);
  if(!['https','http'].includes(protocol))throw registrationIssue('registration.chooseProtocol','Choose HTTP or HTTPS.',registrationNodes.streamProtocol);
  if(registrationNodes.streamPort.validity?.badInput||port&&!/^\d{1,5}$/.test(port)||port&&(Number(port)<1||Number(port)>65535))throw registrationIssue('registration.validPort','Enter a port from 1 to 65535, or leave it blank.',registrationNodes.streamPort);
  if(!path.startsWith('/')||path.startsWith('//')||/[\x00-\x1f\x7f\\#]/.test(path))throw registrationIssue('registration.validPath','Start the stream path with one / and do not include a fragment.',registrationNodes.streamPath);
  try{return registrationParse(protocol+'://'+host+(port?':'+port:'')+path);}catch(error){throw {...error,field:error.key==='registration.noTokens'?registrationNodes.streamPath:registrationNodes.streamHost};}
 }
 function registrationValidate(report=false,canonicalize=false){
  registrationUrl.setCustomValidity('');for(const field of registrationBuilder)field.setCustomValidity('');
  try{
   const parsed=registrationMode==='ip'?registrationCompose():registrationParse(registrationUrl.value);
   if(registrationMode==='ip'||canonicalize)registrationSetUrl(parsed.href);registrationNodes.generatedStreamUrl.textContent=parsed.href;registrationValid=true;registrationControls();return true;
  }catch(error){
   registrationValid=false;registrationNodes.generatedStreamUrl.textContent='';
   const field=error.field||(registrationMode==='ip'?registrationNodes.streamHost:registrationUrl),safe=error.message||'Check the stream address and try again.';
   field.setCustomValidity(safe);if(registrationMode==='ip')registrationSetUrl('');registrationControls();
   if(report){registrationStatus(error.key||'',error.fallback||safe,'invalid');field.focus();field.reportValidity();}
   return false;
  }
 }
 function registrationSetMode(next){
  if(next===registrationMode)return;
  registrationInvalidate();
  if(next==='ip'){
   registrationUrlDraft=registrationUrl.value;
   try{const parsed=registrationParse(registrationUrl.value);registrationNodes.streamHost.value=parsed.hostname;registrationNodes.streamPort.value=parsed.port;registrationNodes.streamProtocol.value=parsed.protocol.slice(0,-1);registrationNodes.streamPath.value=parsed.pathname+parsed.search;}catch{}
  }
  registrationMode=next;registrationNodes.streamAddressFields.hidden=next!=='ip';registrationUrl.readOnly=next==='ip';
  for(const field of registrationBuilder){field.disabled=next!=='ip';field.required=next==='ip'&&field===registrationNodes.streamHost;field.setCustomValidity('');}
  registrationNodes.connectionUrlMode.setAttribute('aria-pressed',String(next==='url'));registrationNodes.connectionIpMode.setAttribute('aria-pressed',String(next==='ip'));
  if(next==='url'&&!registrationUrl.value&&registrationUrlDraft)registrationSetUrl(registrationUrlDraft);
  registrationValidate();registrationForm.dispatchEvent(new Event('input',{bubbles:true}));
 }
 registrationNodes.connectionUrlMode.onclick=()=>registrationSetMode('url');registrationNodes.connectionIpMode.onclick=()=>registrationSetMode('ip');
 registrationUrl.addEventListener('input',()=>{if(registrationInternalInput)return;registrationInvalidate();registrationUrlDraft=registrationUrl.value;registrationValidate();});
 for(const field of registrationBuilder)for(const event of ['input','change'])field.addEventListener(event,()=>{if(registrationMode!=='ip')return;registrationInvalidate();registrationValidate();registrationForm.dispatchEvent(new Event('input',{bubbles:true}));});
 window.prepareRegistrationStream=()=>registrationValidate(true,true);
 registrationNodes.copyGeneratedStream.onclick=async()=>{
  if(!registrationValidate(true,true))return;const value=registrationUrl.value;
  try{if(!window.isSecureContext||!navigator.clipboard?.writeText)throw new Error();await navigator.clipboard.writeText(value);registrationStatus('registration.urlCopied','Stream URL copied.','copy');}
  catch{registrationUrl.focus();registrationUrl.select();registrationStatus('registration.copyManually','Select and copy the stream URL shown above.','copy');}
 };
 registrationNodes.testStream.onclick=async()=>{
  if(registrationActiveTest||!registrationValidate(true,true))return;
  const version=registrationVersion,value=registrationUrl.value,attempt={};registrationActiveTest=attempt;registrationControls();
  registrationStatus('registration.checking','Checking the stream. No audio will play.','checking');
  const current=()=>registrationActiveTest===attempt&&registrationVersion===version&&registrationUrl.value===value&&!document.getElementById('register').hidden;
  try{
   const turnstile_token=await human(registrationNodes.streamTestHuman,'stream-check');if(!current())return;
   const response=await api('/api/owner/stream-check',{stream_url:value,turnstile_token});if(!current())return;
   if(response.result==='audio_response'&&response.audio_response===true)registrationStatus('registration.audioResponse','Stream responded with audio data. Playback is not verified.','success');
   else if(response.result==='not_confirmed'&&response.audio_response===false)registrationStatus('registration.notConfirmed','Stream could not be confirmed. You can still save it.','unconfirmed');
   else registrationStatus('registration.notConfirmed','Stream could not be confirmed. You can still save it.','unconfirmed');
  }catch(error){if(current())registrationStatus('',String(error.message||'The stream check did not complete. You can still save it.').slice(0,400),'error');}
  finally{if(registrationActiveTest===attempt){registrationActiveTest=null;registrationControls();}}
 };
 new MutationObserver(()=>{if(document.getElementById('register').hidden){registrationInvalidate();registrationControls();}}).observe(document.getElementById('register'),{attributes:true,attributeFilter:['hidden']});
 window.addEventListener('app-language-changed',()=>{registrationValidate();if(registrationStatusKey)registrationStatus(registrationStatusKey,registrationStatusFallback,registrationNodes.streamTestStatus.dataset.state);});
 registrationForm.addEventListener('reset',()=>{registrationInvalidate();queueMicrotask(()=>{registrationMode='url';registrationNodes.streamAddressFields.hidden=true;registrationUrl.readOnly=false;for(const field of registrationBuilder){field.disabled=true;field.required=false;field.setCustomValidity('');}registrationNodes.connectionUrlMode.setAttribute('aria-pressed','true');registrationNodes.connectionIpMode.setAttribute('aria-pressed','false');registrationUrlDraft=registrationUrl.value;registrationValidate();});});
 for(const field of registrationBuilder){field.disabled=true;field.required=false;field.setCustomValidity('');}
 registrationNodes.streamAddressFields.hidden=true;registrationUrl.readOnly=false;registrationNodes.connectionUrlMode.setAttribute('aria-pressed','true');registrationNodes.connectionIpMode.setAttribute('aria-pressed','false');registrationValidate();
})();
