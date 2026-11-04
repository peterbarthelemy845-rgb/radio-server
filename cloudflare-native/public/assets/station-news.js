'use strict';
let headlines=[];const narrowNews=matchMedia('(max-width:700px)');const newsPerPage=()=>narrowNews.matches?1:3;narrowNews.addEventListener('change',()=>{libraryNewsPage=0;renderLibraryNews();});
const libraryNews=document.createElement('section');libraryNews.className='library-news';libraryNews.setAttribute('aria-label','Latest news');
const newsRow=document.createElement('div');newsRow.className='library-news-row';
const previousNews=document.createElement('button');previousNews.textContent='‹';previousNews.className='news-arrow';previousNews.setAttribute('aria-label','Previous headlines');
const newsTrack=document.createElement('div');newsTrack.className='library-news-track';
const nextNews=document.createElement('button');nextNews.textContent='›';nextNews.className='news-arrow';nextNews.setAttribute('aria-label','Next headlines');
const newsDots=document.createElement('div');newsDots.className='library-news-dots';let libraryNewsPage=0;
previousNews.onclick=()=>{if(!headlines.length)return;libraryNewsPage=(libraryNewsPage-1+Math.ceil(headlines.length/newsPerPage()))%Math.ceil(headlines.length/newsPerPage());renderLibraryNews();};nextNews.onclick=()=>{if(!headlines.length)return;libraryNewsPage=(libraryNewsPage+1)%Math.ceil(headlines.length/newsPerPage());renderLibraryNews();};
newsRow.append(previousNews,newsTrack,nextNews);libraryNews.append(newsRow,newsDots);document.getElementById('stationNews').append(libraryNews);
function renderLibraryNews(){
 newsTrack.replaceChildren();newsDots.replaceChildren();previousNews.disabled=nextNews.disabled=headlines.length<=newsPerPage();
 if(!headlines.length){const empty=document.createElement('p');empty.className='news-empty';empty.textContent='Headlines are temporarily unavailable.';newsTrack.append(empty);return;}
 const pages=Math.ceil(headlines.length/newsPerPage());libraryNewsPage%=pages;
 for(const item of headlines.slice(libraryNewsPage*newsPerPage(),libraryNewsPage*newsPerPage()+newsPerPage())){
  const card=document.createElement('a');card.className='library-news-card';card.href=item.url;card.target='_blank';card.rel='noopener noreferrer';
  if(item.image){const image=document.createElement('img');image.src=item.image;image.alt='';image.loading='lazy';image.referrerPolicy='no-referrer';card.append(image);}
  const text=document.createElement('div'),source=document.createElement('small'),title=document.createElement('strong');source.textContent=item.source;title.textContent=item.title;text.append(source,title);
  if(item.published_at){const time=document.createElement('time');time.dateTime=item.published_at;time.textContent=new Intl.DateTimeFormat(undefined,{month:'short',day:'numeric'}).format(new Date(item.published_at));text.append(time);}
  card.append(text);newsTrack.append(card);
 }
 for(let i=0;i<pages;i++){const dot=document.createElement('button');dot.className='news-page-dot';dot.setAttribute('aria-label','Headlines page '+(i+1));dot.setAttribute('aria-pressed',String(i===libraryNewsPage));dot.onclick=()=>{libraryNewsPage=i;renderLibraryNews();};newsDots.append(dot);}
}

(async()=>{try{const response=await fetch('/api/haitian-times');if(!response.ok)throw Error();headlines=(await response.json()).items||[];}catch{}renderLibraryNews();})();
