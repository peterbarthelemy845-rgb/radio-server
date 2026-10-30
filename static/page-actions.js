'use strict';
const pageActions={
h1:function(event){document.getElementById('bioCount').innerText=this.value.length+'/250'},
h2:function(event){return confirm('Delete this station?')},
h3:function(event){setLanguage(this.value)},
h4:function(event){showStationBio(currentPreset())},
h5:function(event){togglePlayback()},
h6:function(event){resetLibrary()},
h7:function(event){setVolume(this.value)},
h8:function(event){closeStationBio(event)},
h9:function(event){hideStationBio()},
h10:function(event){showPage('radioPage',this)},
h11:function(event){showPage('libraryPage',this);renderLibrary()},
h12:function(event){showPage('addPage',this)},
h13:function(event){showPage('shopPage',this)},
h14:function(event){return confirm('Delete all reports?')},
h15:function(event){return confirm('Suspend this station? It will disappear from the public Radio and Library pages.')},
h16:function(event){return confirm('Delete this report?')},
h17:function(event){document.getElementById('submissionSuccess').close()},
h18:function(event){return confirm('Clear all viewership data?')}
};
for(const kind of ['click','change','input','submit'])document.addEventListener(kind,event=>{
 const target=event.target.closest('[data-action-'+kind+']');if(target){const fn=pageActions[target.getAttribute('data-action-'+kind)];if(fn&&fn.call(target,event)===false)event.preventDefault();}
 if(kind==='click'){const news=event.target.closest('[data-news-index]');if(news&&typeof openNewsAt==='function')openNewsAt(Number(news.dataset.newsIndex));}
});
