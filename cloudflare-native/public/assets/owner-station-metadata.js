(()=>{
 'use strict';
 const text=(key,fallback)=>{const value=window.appI18n?.t(key);return typeof value==='string'&&value!==key?value:fallback;};
 const zipValid=value=>typeof value==='string'&&value.length===5&&/^[0-9]{5}$/.test(value);
 function validateZip(control,details,report=false){
  if(!control)return true;control.setCustomValidity('');
  if(zipValid(control.value))return true;
  control.setCustomValidity(text('metadata.zipRequired','Enter a 5-digit ZIP code.'));
  if(report){if(details)details.open=true;control.focus();control.reportValidity();}return false;
 }
 function validateCategory(control,details,choices,report=false){
  if(!control)return true;control.setCustomValidity('');
  if(control.value&&choices.includes(control.value))return true;
  control.setCustomValidity(control.value?text('metadata.chooseValid','Choose an available station detail.'):text('metadata.categoryRequired','Choose a category.'));
  if(report){if(details)details.open=true;control.focus();control.reportValidity();}return false;
 }
 const signupZip=document.getElementById('registrationStationZip'),signupCategory=document.getElementById('registrationStationCategory'),signupDetails=document.getElementById('registrationStationDetails');
 const signupCategories=[...(signupCategory?.options||signupCategory?.children||[])].map(option=>option.value).filter(Boolean);
 window.prepareRegistrationStationMetadata=()=>validateZip(signupZip,signupDetails,true)&&validateCategory(signupCategory,signupDetails,signupCategories,true);
 if(signupZip){signupZip.addEventListener('input',()=>validateZip(signupZip,signupDetails));signupZip.addEventListener('invalid',()=>{if(signupDetails)signupDetails.open=true;});signupZip.form?.addEventListener('reset',()=>signupZip.setCustomValidity(''));}
 if(signupCategory){signupCategory.addEventListener('change',()=>validateCategory(signupCategory,signupDetails,signupCategories));signupCategory.addEventListener('invalid',()=>{if(signupDetails)signupDetails.open=true;});signupCategory.form?.addEventListener('reset',()=>signupCategory.setCustomValidity(''));}
 const form=document.getElementById('editForm'),bio=form?.elements.bio;
 if(!form||!bio)return;
 const definitions=[{name:'zip_code',id:'ownerStationZip',key:'metadata.zip',label:'ZIP code'},{name:'category',id:'ownerStationCategory',key:'metadata.category',label:'Category'}];
 const details=document.createElement('details');details.id='ownerStationDetails';
 const summary=document.createElement('summary');summary.dataset.i18n='metadata.details';summary.textContent='Station details';
 const grid=document.createElement('div');grid.className='owner-metadata-fields';
 const controls=new Map(),captions=new Map();
 for(const definition of definitions){const label=document.createElement('label'),caption=document.createElement('span'),control=document.createElement(definition.name==='zip_code'?'input':'select');caption.dataset.i18n=definition.key;caption.textContent=definition.label;control.id=definition.id;control.name=definition.name;control.required=true;control.disabled=true;if(definition.name==='zip_code'){control.type='text';control.setAttribute('inputmode','numeric');control.setAttribute('maxlength','5');control.setAttribute('pattern','[0-9]{5}');control.setAttribute('autocomplete','postal-code');}label.htmlFor=control.id;label.append(caption,control);grid.append(label);controls.set(definition.name,control);captions.set(definition.name,caption);}
 const notice=document.createElement('p');notice.id='ownerStationMetadataMessage';notice.setAttribute('role','status');notice.setAttribute('tabindex','-1');notice.hidden=true;
 details.append(summary,grid,notice);const anchor=bio.closest('label')||bio;anchor.before(details);
 let stationCode='',catalog=null,accepted={zip_code:'',category:''};
 const busy=()=>form.dataset.busy==='1'||form.getAttribute('aria-busy')==='true';
 const bound=()=>!!stationCode&&String(form.dataset.stationCode||'')===stationCode;
 const categoryReady=()=>bound()&&catalog!==null;
 function catalogFrom(value){
  if(!value||typeof value!=='object')return null;
  const result=[],entries=value.categories;if(!Array.isArray(entries)||!entries.length||entries.length>30)return null;const seen=new Set();for(const entry of entries){if(!entry||typeof entry.value!=='string'||!/^[a-z][a-z0-9_]{0,31}$/.test(entry.value)||seen.has(entry.value)||typeof entry.label!=='string'||!entry.label.trim()||entry.label.length>100)return null;seen.add(entry.value);result.push({value:entry.value,label:entry.label.trim()});}
  return result;
 }
 function categoryAllowed(value){return !!value&&catalog?.some(option=>option.value===value);}
 function valuesFrom(record,previous){const next={...previous};for(const definition of definitions)if(Object.hasOwn(record||{},definition.name)&&typeof record[definition.name]==='string')next[definition.name]=record[definition.name];return next;}
 function populate(values){
  controls.get('zip_code').value=String(values.zip_code||'');validateZip(controls.get('zip_code'),details);
  const control=controls.get('category');control.replaceChildren();const empty=document.createElement('option');empty.value='';empty.dataset.i18n='metadata.chooseCategory';empty.textContent=text('metadata.chooseCategory','Choose category');control.append(empty);for(const entry of catalog||[]){const option=document.createElement('option');option.value=entry.value;option.dataset.i18n='metadata.category.'+entry.value;option.textContent=text(option.dataset.i18n,entry.value==='christian'?'Religion':entry.label);control.append(option);}const current=String(values.category||'');if(current&&!(catalog||[]).some(entry=>entry.value===current)){const retained=document.createElement('option');retained.value=current;retained.textContent=text('metadata.savedValue','Saved value');control.append(retained);}control.value=current;control.setCustomValidity('');
 }
 function render(){
  const available=categoryReady();form.dataset.ownerMetadataReady=available?'true':'false';form.dataset.ownerZipReady=bound()?'true':'false';
  summary.textContent=text('metadata.details','Station details');
  for(const definition of definitions)captions.get(definition.name).textContent=text(definition.key,definition.label);
  controls.get('zip_code').disabled=!bound()||busy();controls.get('category').disabled=!available||busy();
  notice.hidden=available||!stationCode;notice.dataset.i18n='metadata.requiredUnavailable';notice.textContent=notice.hidden?'':text('metadata.requiredUnavailable','Required station details could not load. Refresh the editor before saving.');
 }
 window.syncOwnerStationMetadata=(record,{preserveDraft=false,metadataOptions}={})=>{
  const code=record&&typeof record==='object'?String(record.code||''):'',same=!!code&&code===stationCode;
  if(!code){stationCode='';catalog=null;accepted={zip_code:'',category:''};details.open=false;populate(accepted);render();return;}
  const previousValues=Object.fromEntries(definitions.map(definition=>[definition.name,controls.get(definition.name).value]));
  if(!same){accepted={zip_code:'',category:''};catalog=null;details.open=false;}
  accepted=valuesFrom(record,accepted);stationCode=code;
  if(metadataOptions!==undefined)catalog=catalogFrom(metadataOptions);
  populate(preserveDraft&&same?previousValues:accepted);render();if(!zipValid(controls.get('zip_code').value)||!categoryReady()||!categoryAllowed(controls.get('category').value))details.open=true;form.dispatchEvent(new Event('owner-metadata-state-changed',{bubbles:true}));
 };
 window.metadataSaveValues=()=>{
  if(!bound()||!categoryReady())return {};
  const zip=controls.get('zip_code').value;if(!zipValid(zip))return {};
  const category=controls.get('category').value;if(!categoryAllowed(category))return {};return {zip_code:zip,category};
 };
 window.prepareOwnerStationMetadata=()=>{
  if(!bound())return false;
  if(!validateZip(controls.get('zip_code'),details,true))return false;
  if(!categoryReady()){details.open=true;render();notice.focus();return false;}
  return validateCategory(controls.get('category'),details,catalog.map(entry=>entry.value),true);
 };
 for(const definition of definitions){const control=controls.get(definition.name);control.addEventListener(definition.name==='zip_code'?'input':'change',()=>{if(definition.name==='zip_code')validateZip(control,details);else validateCategory(control,details,(catalog||[]).map(entry=>entry.value));form.dataset.dirty='1';if(definition.name!=='zip_code')form.dispatchEvent(new Event('input',{bubbles:true}));});control.addEventListener('invalid',()=>{details.open=true;});}
 form.addEventListener('form-busy-changed',render);
 form.addEventListener('reset',()=>{stationCode='';catalog=null;accepted={zip_code:'',category:''};details.open=false;queueMicrotask(()=>{populate(accepted);render();});});
 window.addEventListener('app-language-changed',()=>{const values=Object.fromEntries(definitions.map(definition=>[definition.name,controls.get(definition.name).value]));populate(values);render();validateZip(signupZip,signupDetails);validateCategory(signupCategory,signupDetails,signupCategories);});
 new MutationObserver(render).observe(form,{attributes:true,attributeFilter:['data-station-code','data-busy','aria-busy']});
 populate(accepted);render();
})();
