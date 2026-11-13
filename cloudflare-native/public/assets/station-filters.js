(()=>{
 'use strict';
 const library=document.getElementById('library'),search=document.getElementById('search');
 if(!library||!search||typeof applyStationDirectoryFilters!=='function')return;
 const dimensions=[{key:'language',plural:'languages',title:'Language'},{key:'category',plural:'categories',title:'Category'}];
 const allowed={language:new Set(['en','ht','fr','es','pt','other']),category:new Set(['christian','news_talk','music','culture','other'])};
 const fallbackLabels={en:'English',ht:'Haitian Creole',fr:'French',es:'Spanish',pt:'Portuguese',other:'Other',christian:'Christian',news_talk:'News & talk',music:'Music',culture:'Culture'};
 const options={languages:[],categories:[]},facets={languages:[],categories:[]};let catalogReady=false;
 function text(key,fallback){const value=window.appI18n?.t(key);return typeof value==='string'&&value!==key?value:fallback;}
 function labelled(element,key,fallback){element.dataset.i18n=key;element.textContent=text(key,fallback);return element;}
 function element(tag,id,className){const node=document.createElement(tag);if(id)node.id=id;if(className)node.className=className;return node;}
 function button(id,key,label,className='secondary'){const node=element('button',id,className);node.type='button';return labelled(node,key,label);}
 function applied(){const state=readStationDirectoryState();return {language:state.language||'',category:state.category||''};}
 function labelFor(dimension,value){return options[dimension.plural].find(option=>option.value===value)?.label||fallbackLabels[value]||value;}
 function valueLabel(dimension,value){return text('metadata.'+dimension.key+'.'+value,labelFor(dimension,value));}
 const controls=element('div','stationSearchControls','station-search-controls');search.before(controls);controls.append(search);
 const open=button('openStationFilters','filters.open','Filters','station-filters-open secondary');open.setAttribute('aria-haspopup','dialog');open.setAttribute('aria-controls','stationFiltersDialog');controls.append(open);
 const chips=element('div','stationAppliedFilters','station-applied-filters');chips.hidden=true;chips.setAttribute('role','group');chips.dataset.i18nAria='filters.applied';chips.setAttribute('aria-label',text('filters.applied','Applied station filters')); controls.after(chips);
 const dialog=element('dialog','stationFiltersDialog');dialog.setAttribute('aria-labelledby','stationFiltersTitle');dialog.setAttribute('aria-describedby','stationFiltersHelp');
 const title=labelled(element('h2','stationFiltersTitle'),'filters.title','Filters'),help=labelled(element('p','stationFiltersHelp'),'filters.help','Filter available stations. Stations on your radio stay visible.');
 const empty=element('p','stationFiltersEmpty','station-filters-empty');empty.setAttribute('role','status');const groups=new Map();
 dialog.append(title,help,empty);
 for(const dimension of dimensions){
  const group=element('div',null,'station-filter-field'),label=labelled(element('label'),'filters.'+dimension.key,dimension.title),select=element('select','stationFilter'+dimension.title);label.htmlFor=select.id;group.append(label,select);groups.set(dimension.key,{group,select});dialog.append(group);
 }
 const actions=element('div',null,'station-filter-actions'),apply=button('applyStationFilters','filters.apply','Apply filters','station-filter-apply'),reset=button('resetStationFilterDraft','filters.reset','Reset'),close=button('closeStationFilters','close','Close');actions.append(apply,reset,close);dialog.append(actions);document.body.append(dialog);
 function renderChips(){
  const selection=applied();chips.replaceChildren();let count=0;
  for(const dimension of dimensions){const value=selection[dimension.key];if(!value)continue;count++;
   const chip=element('button',null,'station-filter-chip');chip.type='button';chip.dataset.i18nSkip='1';chip.textContent=valueLabel(dimension,value)+' ×';chip.setAttribute('aria-label',text('filters.remove','Remove filter')+': '+valueLabel(dimension,value));
   chip.onclick=()=>{commit({...applied(),[dimension.key]:''});open.focus({preventScroll:true});};chips.append(chip);
  }
  if(count){const clear=button('clearStationFilters','filters.clear','Clear filters','station-filter-clear secondary');clear.onclick=()=>{commit({language:'',category:''});open.focus({preventScroll:true});};chips.append(clear);}
  chips.hidden=!count;open.setAttribute('aria-label',text('filters.open','Filters')+(count?' ('+count+')':''));open.setAttribute('data-active',count?'1':'0');
 }
 function renderDraft(selection){
  let useful=0;
  for(const dimension of dimensions){
   const {group,select}=groups.get(dimension.key),current=selection[dimension.key]||'',populated=facets[dimension.plural].filter(option=>option.count>0),visible=populated.length>=2||!!current||!!applied()[dimension.key];
   useful+=populated.length;group.hidden=!visible;select.replaceChildren();
   const all=labelled(element('option'),'filters.all','All');all.value='';select.append(all);
   // Catalog labels and facet counts come from the published directory, never guesses from names or logos.
   const values=new Set(populated.map(option=>option.value));if(current)values.add(current);if(applied()[dimension.key])values.add(applied()[dimension.key]);
   for(const value of values){const option=element('option');option.value=value;option.dataset.i18nSkip='1';option.textContent=valueLabel(dimension,value);select.append(option);}
   select.value=current;
  }
  empty.hidden=dimensions.some(dimension=>!groups.get(dimension.key).group.hidden);
  labelled(empty,!catalogReady?'filters.unavailable':useful?'filters.moreMetadata':'filters.noMetadata',!catalogReady?'Filters are not available yet. Try again shortly.':useful?'More filters will appear as station owners add language and category.':'Station owners haven’t added language or category yet.');
 }
 function readDraft(){return Object.fromEntries(dimensions.map(dimension=>[dimension.key,groups.get(dimension.key).select.value]));}
 function commit(selection){void applyStationDirectoryFilters(selection);renderChips();}
 function openDialog(){
  if(dialog.open||document.querySelector('dialog[open]'))return;renderDraft(applied());dialog.showModal();
  const first=dimensions.map(dimension=>groups.get(dimension.key)).find(group=>!group.group.hidden)?.select||apply;first.focus({preventScroll:true});
 }
 open.onclick=openDialog;
 apply.onclick=()=>{const selection=readDraft();dialog.close('applied');commit(selection);};
 reset.onclick=()=>{renderDraft({language:'',category:''});apply.focus({preventScroll:true});};
 close.onclick=()=>dialog.close('cancelled');
 dialog.addEventListener('click',event=>{if(event.target!==dialog)return;const rect=dialog.getBoundingClientRect();if(event.clientX<rect.left||event.clientX>rect.right||event.clientY<rect.top||event.clientY>rect.bottom)dialog.close('cancelled');});
 dialog.addEventListener('close',()=>{if(!dialog.open){renderChips();open.focus({preventScroll:true});}});
 // Native Escape and the shared popup-history handler close without applying draft selections.
 function cleanEntries(entries,dimension,counted){
  if(!Array.isArray(entries))return [];const unique=new Map();
  for(const entry of entries.slice(0,32)){if(!entry||!allowed[dimension.key].has(entry.value))continue;const label=typeof entry.label==='string'?entry.label.trim().slice(0,80):fallbackLabels[entry.value];if(!label)continue;
   const count=Number(entry.count);if(counted&&(!Number.isFinite(count)||count<0))continue;unique.set(entry.value,{value:entry.value,label,...(counted?{count:Math.floor(count)}:{})});}
  return [...unique.values()];
 }
 function updateCatalog(result){
  if(!result?.metadata_options||!result?.facets)return;
  for(const dimension of dimensions){options[dimension.plural]=cleanEntries(result.metadata_options[dimension.plural],dimension,false);facets[dimension.plural]=cleanEntries(result.facets[dimension.plural],dimension,true);}
  catalogReady=true;renderChips();if(dialog.open)renderDraft(readDraft());window.dispatchEvent(new Event('station-filter-catalog-updated'));
 }
 window.stationDirectoryFilters={readApplied:applied,updateCatalog,readMetadataOptions:()=>Object.fromEntries(Object.entries(options).map(([key,values])=>[key,values.map(option=>({...option}))]))};
 const cached=typeof readStationDirectoryCatalog==='function'?readStationDirectoryCatalog():null;if(cached)updateCatalog(cached);else renderChips();
 window.addEventListener('app-language-changed',()=>{renderChips();if(dialog.open)renderDraft(readDraft());});
})();
