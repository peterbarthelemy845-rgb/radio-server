(()=>{
 'use strict';
 const editor=document.getElementById('editor'),form=document.getElementById('editForm'),panel=document.getElementById('ownerStreamPublication'),title=document.getElementById('ownerStreamPublicationTitle'),help=document.getElementById('ownerStreamPublicationHelp'),button=document.getElementById('requestOwnerStreamReview'),notice=document.getElementById('ownerStreamPublicationMessage');
 if(!editor||!form||!panel||!title||!help)return;
 let loaded=false;
 const text=(key,fallback)=>{const value=window.appI18n?.t(key);return typeof value==='string'&&value!==key?value:fallback;};
 function render(){
  // Failed stream checks no longer have a save-private/review bypass. Artwork
  // moderation remains separate from this required listening-stream check.
  if(button){button.hidden=true;button.disabled=true;button.onclick=null;}
  if(notice){notice.hidden=true;notice.textContent='';}
  const permitted=form.dataset.streamSaveAllowed==='true';
  panel.hidden=!loaded||editor.hidden||permitted;panel.dataset.state=permitted?'passed':'needs_check';
  title.textContent=text('owner.streamNeedsCheck','Check your stream');
  help.textContent=text('owner.streamCheckRequired','Test your stream before saving.');
 }
 window.renderOwnerStreamPublication=station=>{loaded=!!station&&typeof station==='object'&&!!station.code;render();};
 for(const event of ['input','change','owner-stream-mode-changed','form-busy-changed'])form.addEventListener(event,render);
 form.addEventListener('reset',()=>{loaded=false;render();});
 new MutationObserver(render).observe(editor,{attributes:true,attributeFilter:['hidden']});
 window.addEventListener('owner-stream-save-state-changed',render);
 window.addEventListener('app-language-changed',render);render();
})();
