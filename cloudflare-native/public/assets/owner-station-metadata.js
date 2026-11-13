(()=>{
 'use strict';
 const form=document.getElementById('editForm'),bio=form?.elements.bio;
 if(!form||!bio)return;
 const definitions=[{name:'language',catalog:'languages',id:'ownerStationLanguage',key:'metadata.language',label:'Language'},{name:'category',catalog:'categories',id:'ownerStationCategory',key:'metadata.category',label:'Category'}];
 const text=(key,fallback)=>{const value=window.appI18n?.t(key);return typeof value==='string'&&value!==key?value:fallback;};
 const details=document.createElement('details');details.id='ownerStationDetails';
 const summary=document.createElement('summary');summary.dataset.i18n='metadata.details';summary.textContent='Station details (optional)';
 const grid=document.createElement('div');grid.className='owner-metadata-fields';
 const controls=new Map(),captions=new Map();
 for(const definition of definitions){const label=document.createElement('label'),caption=document.createElement('span'),select=document.createElement('select');caption.dataset.i18n=definition.key;caption.textContent=definition.label;select.id=definition.id;select.name=definition.name;select.disabled=true;label.htmlFor=select.id;label.append(caption,select);grid.append(label);controls.set(definition.name,select);captions.set(definition.name,caption);}
 const notice=document.createElement('p');notice.id='ownerStationMetadataMessage';notice.setAttribute('role','status');notice.hidden=true;
 details.append(summary,grid,notice);const anchor=bio.closest('label')||bio;anchor.before(details);
 let stationCode='',catalog=null,accepted={language:'',category:''};
 const busy=()=>form.dataset.busy==='1'||form.getAttribute('aria-busy')==='true';
 const bound=()=>!!stationCode&&String(form.dataset.stationCode||'')===stationCode;
 const ready=()=>bound()&&catalog!==null;
 function catalogFrom(value){
  if(!value||typeof value!=='object')return null;
  const result={};
  for(const definition of definitions){const entries=value[definition.catalog];if(!Array.isArray(entries)||!entries.length||entries.length>30)return null;const seen=new Set();result[definition.name]=[];for(const entry of entries){if(!entry||typeof entry.value!=='string'||!/^[a-z][a-z0-9_]{0,31}$/.test(entry.value)||seen.has(entry.value)||typeof entry.label!=='string'||!entry.label.trim()||entry.label.length>100)return null;seen.add(entry.value);result[definition.name].push({value:entry.value,label:entry.label.trim()});}}
  return result;
 }
 function allowed(name,value){return value===''||catalog?.[name].some(option=>option.value===value);}
 function valuesFrom(record,previous){const next={...previous};for(const definition of definitions)if(Object.hasOwn(record||{},definition.name)&&typeof record[definition.name]==='string')next[definition.name]=record[definition.name];return next;}
 function populate(values){
  for(const definition of definitions){const control=controls.get(definition.name);control.replaceChildren();const empty=document.createElement('option');empty.value='';empty.dataset.i18n='metadata.notSet';empty.textContent=text('metadata.notSet','Not set');control.append(empty);for(const entry of catalog?.[definition.name]||[]){const option=document.createElement('option');option.value=entry.value;option.dataset.i18n=definition.key+'.'+entry.value;option.textContent=text(option.dataset.i18n,entry.label);control.append(option);}const current=String(values[definition.name]||'');if(current&&!(catalog?.[definition.name]||[]).some(entry=>entry.value===current)){const retained=document.createElement('option');retained.value=current;retained.textContent=text('metadata.savedValue','Saved value');control.append(retained);}control.value=current;control.setCustomValidity('');}
 }
 function render(){
  const available=ready();form.dataset.ownerMetadataReady=available?'true':'false';
  summary.textContent=text('metadata.details','Station details (optional)');
  for(const definition of definitions)captions.get(definition.name).textContent=text(definition.key,definition.label);
  for(const control of controls.values())control.disabled=!available||busy();
  notice.hidden=available||!stationCode;notice.dataset.i18n='metadata.unavailable';notice.textContent=notice.hidden?'':text('metadata.unavailable','Station details are unavailable. You can still edit your other details.');
 }
 window.syncOwnerStationMetadata=(record,{preserveDraft=false,metadataOptions}={})=>{
  const code=record&&typeof record==='object'?String(record.code||''):'',same=!!code&&code===stationCode;
  if(!code){stationCode='';catalog=null;accepted={language:'',category:''};details.open=false;populate(accepted);render();return;}
  const previousValues=Object.fromEntries(definitions.map(definition=>[definition.name,controls.get(definition.name).value]));
  if(!same){accepted={language:'',category:''};catalog=null;details.open=false;}
  accepted=valuesFrom(record,accepted);stationCode=code;
  if(metadataOptions!==undefined)catalog=catalogFrom(metadataOptions);
  populate(preserveDraft&&same?previousValues:accepted);render();form.dispatchEvent(new Event('owner-metadata-state-changed',{bubbles:true}));
 };
 window.metadataSaveValues=()=>{
  if(!ready())return {};
  const result={};for(const definition of definitions){const value=controls.get(definition.name).value;if(!allowed(definition.name,value))return {};result[definition.name]=value;}return result;
 };
 window.prepareOwnerStationMetadata=()=>{
  if(!ready())return true;
  for(const definition of definitions){const control=controls.get(definition.name);control.setCustomValidity('');if(!allowed(definition.name,control.value)){details.open=true;control.setCustomValidity(text('metadata.chooseValid','Choose an available station detail.'));control.focus();control.reportValidity();return false;}}
  return true;
 };
 for(const control of controls.values())control.addEventListener('change',()=>{control.setCustomValidity('');form.dataset.dirty='1';form.dispatchEvent(new Event('input',{bubbles:true}));});
 form.addEventListener('form-busy-changed',render);
 form.addEventListener('reset',()=>{stationCode='';catalog=null;accepted={language:'',category:''};details.open=false;queueMicrotask(()=>{populate(accepted);render();});});
 window.addEventListener('app-language-changed',()=>{const values=Object.fromEntries(definitions.map(definition=>[definition.name,controls.get(definition.name).value]));populate(values);render();});
 new MutationObserver(render).observe(form,{attributes:true,attributeFilter:['data-station-code','data-busy','aria-busy']});
 populate(accepted);render();
})();
