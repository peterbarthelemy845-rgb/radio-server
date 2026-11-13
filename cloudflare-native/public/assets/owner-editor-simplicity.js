(()=>{
 'use strict';
 const form=document.getElementById('editForm'),editor=document.getElementById('editor'),stream=document.getElementById('ownerStreamSettings'),options=document.getElementById('ownerAccountOptions'),notice=document.getElementById('ownerSaveState');
 const save=form?.querySelector('button[type="submit"]')||document.getElementById('ownerSave');
 if(!form||!editor||!save||!notice)return;
 let baseline=null,approvedUrl='',repair=false;
 const text=(key,fallback)=>{const value=window.appI18n?.t(key);return value&&value!==key?value:fallback;};
 const canonical=value=>{try{return window.parsePublicStreamUrl(value).href;}catch{return String(value||'').trim();}};
 const optionalKeys=['language','category'];
 const values=record=>{const result={name:String(record.name||'').trim(),stream_url:canonical(record.stream_url),bio:String(record.bio||'').trim()};for(const key of optionalKeys)if(Object.hasOwn(record,key))result[key]=String(record[key]||'');return result;};
 const optionalValues=record=>Object.fromEntries(optionalKeys.filter(key=>Object.hasOwn(record||{},key)).map(key=>[key,record[key]]));
 function current(){const record={name:form.elements.name.value,stream_url:form.elements.stream_url.value,bio:form.elements.bio.value};if(form.dataset.ownerMetadataReady!=='false')for(const key of optionalKeys)if(form.elements[key])record[key]=form.elements[key].value;return values(record);}
 function bound(){return !!baseline&&String(form.dataset.stationCode||'')===baseline.code&&String(form.dataset.revision||'')===baseline.revision;}
 function changed(){
  if(!bound())return false;
  if(form.elements.artwork.files[0])return true;
  const next=current();return ['name','stream_url','bio'].some(key=>next[key]!==baseline[key])||optionalKeys.some(key=>Object.hasOwn(next,key)&&next[key]!==String(baseline[key]||''));
 }
 function needsSave(){return bound()&&(changed()||repair);}
 const busy=()=>form.dataset.busy==='1'||form.getAttribute?.('aria-busy')==='true';
 function render(){
  const ready=bound(),modified=changed(),required=ready&&repair,permit=form.dataset.streamSaveAllowed==='true',locked=busy();
  save.disabled=!ready||editor.hidden||locked||!permit||!needsSave();
  notice.hidden=!ready;
  if(ready){
   const key=locked?'saving':!modified&&!required?'owner.upToDate':permit?'owner.readyToSave':'owner.streamCheckRequired';
   const fallback=locked?'Saving…':!modified&&!required?'Up to date':permit?'Ready to save':'Test your stream before saving.';
   notice.dataset.i18n=key;notice.dataset.state=locked?'saving':!modified&&!required?'clean':permit?'ready':'needs-check';
   const label=text(key,fallback);if(notice.textContent!==label)notice.textContent=label;
  }
  // Never make someone hunt for a failed or missing stream check. Once the
  // saved, approved URL is unchanged, leave their manual disclosure choice.
  const check=document.getElementById('ownerStreamTestStatus'),failed=['error','invalid','unconfirmed'].includes(check?.dataset.state);
  if(stream&&ready&&(!approvedUrl||canonical(form.elements.stream_url.value)!==approvedUrl||!permit||failed))stream.open=true;
  form.dataset.ownerChanged=modified?'true':'false';
 }
 window.ownerEditorNeedsSave=needsSave;
 window.ownerEditorSaveAllowed=()=>{render();return needsSave()&&form.dataset.streamSaveAllowed==='true';};
 window.renderOwnerEditorState=render;
 window.syncOwnerEditorState=(record,{preserveDraft=false}={})=>{
  const code=String(record?.code||''),same=baseline?.code===code;
  if(!code){baseline=null;approvedUrl='';repair=false;render();return;}
  // A preserved draft remains compared with the version it was based on.
  // In particular a newer background read must not make that draft look saved.
  if(!same||!preserveDraft){
   baseline={...(same?optionalValues(baseline):{}),...values(record),code,revision:String(record.revision||'')};
   const approved=record.approved?.status==='published'&&canonical(record.approved.stream_url)===canonical(record.stream_url);
   repair=!approved&&(record.stream_check?.status!=='passed'||form.dataset.streamSaveAllowed!=='true');
  }
  approvedUrl=record.approved?.status==='published'?canonical(record.approved.stream_url):'';
  if(stream&&(!same||!preserveDraft))stream.open=!approvedUrl||canonical(form.elements.stream_url.value)!==approvedUrl||form.dataset.streamSaveAllowed!=='true';
  if(options&&!same)options.open=false;
  render();
 };
 window.ownerEditorSaved=(captured,result={})=>{
  if(!bound()||String(captured?.code||'')!==baseline.code)return;
  baseline={...optionalValues(baseline),...values(captured),code:baseline.code,revision:String(captured.revision||baseline.revision)};
  repair=result.stream_check_required===true;render();
 };
 for(const type of ['input','change','owner-stream-mode-changed','owner-metadata-state-changed','form-busy-changed'])form.addEventListener(type,render);
 form.addEventListener('reset',()=>{baseline=null;approvedUrl='';repair=false;if(stream)stream.open=false;if(options)options.open=false;queueMicrotask(render);});
 window.addEventListener('owner-stream-save-state-changed',render);
 window.addEventListener('app-language-changed',render);
 new MutationObserver(render).observe(editor,{attributes:true,attributeFilter:['hidden']});
 new MutationObserver(render).observe(form,{attributes:true,attributeFilter:['data-busy','aria-busy','data-station-code']});
 const check=document.getElementById('ownerStreamTestStatus');if(check)new MutationObserver(render).observe(check,{attributes:true,attributeFilter:['data-state']});
 render();
})();
