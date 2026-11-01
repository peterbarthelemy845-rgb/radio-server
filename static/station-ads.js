"use strict";
(()=>{
 const form=document.getElementById('localAdForm');if(!form)return;
 for(const [field,preview,fallback] of [['adBrand','previewBrand','Business name'],['adMessage','previewMessage','Your sponsor message'],['adPhone','previewPhone','']]){
  const input=document.getElementById(field);input?.addEventListener('input',()=>{document.getElementById(preview).textContent=input.value.normalize('NFKD').replace(/[^\x20-\x7e]/g,'')||fallback;});
 }
 let localImage='';const image=document.getElementById('adImage');
 image?.addEventListener('change',()=>{
  const file=image.files[0],error=document.getElementById('adPreviewError');error.hidden=true;
  if(!file)return;
  if(!['image/png','image/jpeg','image/webp'].includes(file.type)||file.size>3*1024*1024){error.textContent='Choose a JPG, PNG or WebP image under 3 MB.';error.hidden=false;image.value='';return;}
  if(localImage)URL.revokeObjectURL(localImage);localImage=URL.createObjectURL(file);document.getElementById('previewImage').src=localImage;
 });
 for(const deletion of document.querySelectorAll('.delete-ad-form'))deletion.addEventListener('submit',event=>{if(!confirm('Delete this ad? It will stop showing on radios.'))event.preventDefault();});
})();
