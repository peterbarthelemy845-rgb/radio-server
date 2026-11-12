(()=>{
 'use strict';
 const form=document.getElementById('editForm'),editor=document.getElementById('editor');
 const ids=['ownerStreamSetupPanel','ownerStreamProviderHelp','ownerStreamAddressFields','ownerStreamHost','ownerStreamPort','ownerStreamProtocol','ownerStreamPath','ownerStreamUrlRow','ownerStreamUrlInput'];
 const nodes=Object.fromEntries(ids.map(id=>[id,document.getElementById(id)]));
 const choices=[...(form?.querySelectorAll('input[name="owner_stream_provider"]')||[])];
 if(!form||!editor||!choices.length||ids.some(id=>!nodes[id]))return;
 const url=nodes.ownerStreamUrlInput,builder=[nodes.ownerStreamHost,nodes.ownerStreamPort,nodes.ownerStreamProtocol,nodes.ownerStreamPath];
 let initialized=false,station='',provider='other',source='url',internal=false,draft=false,workingUrl='';
 let manualUrl='',manualSource='ip',manualEdited=false,directDraft='',directEdited=false;
 const text=(key,fallback)=>{const value=window.appI18n?.t(key);return typeof value==='string'&&value!==key?value:fallback;};
 const isManual=value=>['icecast','shoutcast'].includes(value);
 const manual=()=>isManual(provider);
 const busy=()=>['1','true'].includes(form.dataset.busy)||form.getAttribute?.('aria-busy')==='true';
 const issue=(key,fallback,field)=>({key,message:text(key,fallback),field});
 function parse(value){
  if(typeof window.parsePublicStreamUrl!=='function')throw issue('registration.setupUnavailable','Stream address validation is unavailable. Refresh and try again.');
  return window.parsePublicStreamUrl(value);
 }
 function write(value,notify=false){
  url.value=value;workingUrl=value;
  if(notify){internal=true;try{url.dispatchEvent(new Event('input',{bubbles:true}));}finally{internal=false;}}
 }
 function syncBuilder(parsed){
  nodes.ownerStreamHost.value=parsed?.hostname||'';nodes.ownerStreamPort.value=parsed?.port||'';
  nodes.ownerStreamProtocol.value=parsed?parsed.protocol.slice(0,-1):'https';nodes.ownerStreamPath.value=parsed?parsed.pathname+parsed.search:'';
 }
 function controls(){
  const locked=busy();for(const field of builder){field.required=false;field.disabled=!manual()||locked;}
  url.disabled=locked;url.required=!manual();url.readOnly=manual();
 }
 function render(){
  nodes.ownerStreamSetupPanel.hidden=false;nodes.ownerStreamAddressFields.hidden=!manual();nodes.ownerStreamUrlRow.hidden=manual();
  const [key,fallback]=provider==='shoutcast'?['registration.providerShoutcast','Enter your public server, port and listening path.']:provider==='icecast'?['registration.providerIcecast','Enter your public server, port and mount point. Choose HTTPS for SSL.']:['registration.providerOther','Paste your complete public listening URL.'];
  nodes.ownerStreamProviderHelp.dataset.i18n=key;nodes.ownerStreamProviderHelp.textContent=text(key,fallback);
  for(const choice of choices)choice.checked=choice.value===provider;controls();
 }
 function compose(){
  const host=nodes.ownerStreamHost.value.trim(),port=nodes.ownerStreamPort.value.trim(),protocol=nodes.ownerStreamProtocol.value,path=nodes.ownerStreamPath.value.trim()||'/';
  if(!host||/[\s\/:@?#\[\]\\]/.test(host))throw issue('registration.hostOnly','Enter only the public server hostname or IPv4 address.',nodes.ownerStreamHost);
  if(!['https','http'].includes(protocol))throw issue('registration.chooseProtocol','Choose HTTP or HTTPS.',nodes.ownerStreamProtocol);
  if(nodes.ownerStreamPort.validity?.badInput||port&&!/^\d{1,5}$/.test(port)||port&&(Number(port)<1||Number(port)>65535))throw issue('registration.validPort','Enter a port from 1 to 65535, or leave it blank.',nodes.ownerStreamPort);
  if(!path.startsWith('/')||path.startsWith('//')||/[\x00-\x1f\x7f\\#]/.test(path))throw issue('registration.validPath','Start the stream path with one / and do not include a fragment.',nodes.ownerStreamPath);
  try{return parse(protocol+'://'+host+(port?':'+port:'')+path);}catch(error){throw {...error,field:['registration.noTokens','registration.urlLength'].includes(error.key)?nodes.ownerStreamPath:nodes.ownerStreamHost};}
 }
 function validate(report=false,canonicalize=false,notify=false){
  url.setCustomValidity('');for(const field of builder)field.setCustomValidity('');
  try{const parsed=source==='ip'?compose():parse(url.value);if(source==='ip'||canonicalize)write(parsed.href,notify);else workingUrl=url.value;return true;}
  catch(error){const field=error.field||(manual()?nodes.ownerStreamHost:url);field.setCustomValidity(error.message||text('registration.validUrl','Enter a complete public HTTP or HTTPS stream URL without a fragment.'));if(source==='ip')write('',notify);else workingUrl=url.value;if(report){field.focus();field.reportValidity();}return false;}
 }
 function changeProvider(value){
  if(busy()||editor.hidden){for(const choice of choices)choice.checked=choice.value===provider;return;}
  if(value===provider)return;
  const wasManual=manual(),nextManual=isManual(value);
  if(wasManual&&!nextManual){manualUrl=url.value;manualSource=source;if(manualEdited){try{parse(url.value);directDraft=url.value;}catch{}}manualEdited=false;directEdited=false;write(directDraft);source='url';}
  else if(!wasManual&&nextManual){directDraft=url.value;if(directEdited){try{syncBuilder(parse(directDraft));manualUrl=directDraft;manualSource='url';}catch{}}write(manualUrl);source=manualSource;directEdited=false;manualEdited=false;}
  provider=value;render();validate();form.dispatchEvent(new Event('owner-stream-mode-changed'));
 }
 for(const choice of choices)choice.addEventListener('change',()=>{if(choice.checked)changeProvider(choice.value);});
 url.addEventListener('input',()=>{if(internal||busy()||manual()||editor.hidden)return;draft=true;source='url';directDraft=url.value;directEdited=true;workingUrl=url.value;validate();});
 for(const field of builder){for(const event of ['input','change'])field.addEventListener(event,()=>{if(busy()||!manual()||editor.hidden)return;draft=true;source='ip';manualEdited=true;validate(false,false,true);});}
 window.prepareOwnerStreamSetup=()=>{if(busy())return false;return validate(true,true);};
 window.syncOwnerStreamSetup=(options={})=>{
  const nextStation=String(form.dataset.stationCode||''),different=!initialized||nextStation!==station;
  if(!different&&!options?.accepted&&draft){write(workingUrl);render();validate();return;}
  if(different)provider='other';
  const value=url.value;initialized=true;station=nextStation;draft=false;source='url';manualSource='ip';manualUrl='';manualEdited=false;directDraft=value;directEdited=Boolean(value);workingUrl=value;syncBuilder(null);
  if(manual()){try{syncBuilder(parse(value));manualUrl=value;manualSource='url';directEdited=false;}catch{source='ip';}}
  render();validate();const event=new Event('owner-stream-mode-changed');event.detail={source:'sync'};form.dispatchEvent(event);
 };
 form.addEventListener('form-busy-changed',controls);
 form.addEventListener('reset',()=>queueMicrotask(()=>{initialized=false;provider='other';window.syncOwnerStreamSetup({accepted:true});}));
 new MutationObserver(controls).observe(form,{attributes:true,attributeFilter:['data-busy','aria-busy']});
 window.addEventListener('app-language-changed',()=>{render();validate();});
 window.syncOwnerStreamSetup();
})();
