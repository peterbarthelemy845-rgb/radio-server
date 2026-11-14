'use strict';
// Load specialist tools only on their own screens. Only these application-owned
// same-origin paths can execute; user content never supplies a script URL.
const appFeatureFiles={
 owner:{css:['registration-form.css','operations.css','station-code-recovery.css','owner-editor-simplicity.css','owner-station-metadata.css'],js:['action-prompts.js','stream-test-feedback.js','registration-form.js','editor-stream-setup.js','editor-stream-test.js','owner-station-metadata.js','owner-editor-simplicity.js','owner-stream-publication.js','station-code-recovery.js','policy-preview.js','ads.js','operations.js','owner-session-warning.js']},
 admin:{css:['operations.css','ai-admin.css','ai-operations.css'],js:['action-prompts.js','ai-admin.js','admin-tools.js','ads.js','operations.js','admin-overview.js','ai-operations.js']},
 advertise:{css:['operations.css'],js:['action-prompts.js','ads.js']},
 support:{css:['support-status.css','support-chat.css'],js:['support-status.js','support-chat.js']}
};
const appFeatureRequests=new Map(),appFileRequests=new Map();
const appOptionalFiles=new Set(['ai-admin.css','ai-operations.css','support-chat.css','ai-admin.js','ai-operations.js','support-chat.js']);
async function appLoadFeatureFile(file,style=false){try{await appLoadFile(file,style);}catch(error){if(!appOptionalFiles.has(file))throw error;}}
function appLoadFile(file,style=false){
 const path='/assets/'+file;if(appFileRequests.has(path))return appFileRequests.get(path);
 const request=new Promise((resolve,reject)=>{
  const element=document.createElement(style?'link':'script');
  if(style){element.rel='stylesheet';element.href=path;}else{element.src=path;element.async=false;}
  element.onload=()=>resolve();element.onerror=()=>{element.remove();appFileRequests.delete(path);reject(new Error('This screen could not load. Please try again.'));};
  document.head.append(element);
 });appFileRequests.set(path,request);return request;
}
window.loadAppFeature=function(name){
 if(!Object.hasOwn(appFeatureFiles,name))return Promise.reject(new Error('Unknown website feature.'));
 if(appFeatureRequests.has(name))return appFeatureRequests.get(name);
 const files=appFeatureFiles[name],request=(async()=>{await Promise.all(files.css.map(file=>appLoadFeatureFile(file,true)));for(const file of files.js)await appLoadFeatureFile(file);window.dispatchEvent(new Event('app-content-changed'));})();
 appFeatureRequests.set(name,request);request.catch(()=>appFeatureRequests.delete(name));return request;
};
