(()=>{
 'use strict';
 const library=document.getElementById('library'),search=document.getElementById('search');
 if(!library||!search||typeof applyStationDirectoryFilters!=='function')return;
 const dimensions=[{key:'category',plural:'categories',title:'Category'}],catalogDimensions=[{key:'language',plural:'languages'},...dimensions];
 const allowed={language:new Set(['en','ht','fr','es','pt','other']),category:new Set(['christian','news_talk','music','culture','other'])};
 const fallbackLabels={en:'English',ht:'Haitian Creole',fr:'French',es:'Spanish',pt:'Portuguese',other:'Other',christian:'Religion',news_talk:'News & talk',music:'Music',culture:'Culture'};
 const options={languages:[],categories:[]},facets={languages:[],categories:[]};let catalogReady=false,zipSearchResult=null;
 function text(key,fallback,values){const value=window.appI18n?.t(key,values);return typeof value==='string'&&value!==key?value:fallback;}
 function labelled(element,key,fallback){element.dataset.i18n=key;element.textContent=text(key,fallback);return element;}
 function element(tag,id,className){const node=document.createElement(tag);if(id)node.id=id;if(className)node.className=className;return node;}
 function button(id,key,label,className='secondary'){const node=element('button',id,className);node.type='button';return labelled(node,key,label);}
 function applied(){const state=readStationDirectoryState();return {zip_code:state.zip_code||'',category:state.category||''};}
 function labelFor(dimension,value){return dimension.key==='category'&&value==='christian'?fallbackLabels.christian:options[dimension.plural].find(option=>option.value===value)?.label||fallbackLabels[value]||value;}
 function valueLabel(dimension,value){return text('metadata.'+dimension.key+'.'+value,labelFor(dimension,value));}
 const controls=element('div','stationSearchControls','station-search-controls');search.before(controls);controls.append(search);
 const open=button('openStationFilters','filters.open','Filters','station-filters-open secondary');open.setAttribute('aria-haspopup','dialog');open.setAttribute('aria-controls','stationFiltersDialog');controls.append(open);
 const chips=element('div','stationAppliedFilters','station-applied-filters');chips.hidden=true;chips.setAttribute('role','group');chips.dataset.i18nAria='filters.applied';chips.setAttribute('aria-label',text('filters.applied','Applied station filters')); controls.after(chips);
 const zipNotice=element('p','stationZipNotice','station-zip-notice');zipNotice.hidden=true;zipNotice.setAttribute('role','status');chips.after(zipNotice);
 const dialog=element('dialog','stationFiltersDialog');dialog.setAttribute('aria-labelledby','stationFiltersTitle');dialog.setAttribute('aria-describedby','stationFiltersHelp');
 const title=labelled(element('h2','stationFiltersTitle'),'filters.title','Filters'),help=labelled(element('p','stationFiltersHelp'),'filters.help','Filter available stations. Stations on your radio stay visible.');
 const empty=element('p','stationFiltersEmpty','station-filters-empty');empty.setAttribute('role','status');const groups=new Map();
 dialog.append(title,help);
 const zipGroup=element('div',null,'station-filter-field'),zipLabel=labelled(element('label'),'filters.zip','ZIP code'),zipInput=element('input','stationFilterZip');zipLabel.htmlFor=zipInput.id;
 zipInput.type='text';zipInput.inputMode='numeric';zipInput.maxLength=5;zipInput.pattern='[0-9]{5}';zipInput.autocomplete='postal-code';zipInput.placeholder='10960';
 const zipHelp=labelled(element('p','stationFilterZipHelp'),'filters.zipHelp','Stations within about 25 miles.'),zipError=element('p','stationFilterZipError','station-filter-error');zipError.hidden=true;zipError.setAttribute('role','alert');zipInput.setAttribute('aria-describedby',zipHelp.id);zipGroup.append(zipLabel,zipInput,zipHelp,zipError);dialog.append(zipGroup,empty);
 const attribution=element('p',null,'station-filter-attribution'),sourceLabel=labelled(element('span'),'filters.zipSource','ZIP locations:'),sourceLink=element('a');sourceLink.href='https://www.geonames.org/';sourceLink.target='_blank';sourceLink.rel='noopener noreferrer';sourceLink.textContent='GeoNames';attribution.append(sourceLabel,sourceLink);zipGroup.append(attribution);
 for(const dimension of dimensions){
  const group=element('div',null,'station-filter-field'),label=labelled(element('label'),'filters.'+dimension.key,dimension.title),select=element('select','stationFilter'+dimension.title);label.htmlFor=select.id;group.append(label,select);groups.set(dimension.key,{group,select});dialog.append(group);
 }
 const actions=element('div',null,'station-filter-actions'),apply=button('applyStationFilters','filters.apply','Apply filters','station-filter-apply'),reset=button('resetStationFilterDraft','filters.reset','Reset'),close=button('closeStationFilters','close','Close');actions.append(apply,reset,close);dialog.append(actions);document.body.append(dialog);
 function renderChips(){
  const selection=applied();chips.replaceChildren();let count=0;
  if(selection.zip_code){count++;const chip=element('button',null,'station-filter-chip'),label=text('filters.nearZip','Near ZIP '+selection.zip_code,{zip:selection.zip_code});chip.type='button';chip.dataset.i18nSkip='1';chip.textContent=label+' ×';chip.setAttribute('aria-label',text('filters.remove','Remove filter')+': '+label);chip.onclick=()=>{commit({...applied(),zip_code:''});open.focus({preventScroll:true});};chips.append(chip);}
  for(const dimension of dimensions){const value=selection[dimension.key];if(!value)continue;count++;
   const chip=element('button',null,'station-filter-chip');chip.type='button';chip.dataset.i18nSkip='1';chip.textContent=valueLabel(dimension,value)+' ×';chip.setAttribute('aria-label',text('filters.remove','Remove filter')+': '+valueLabel(dimension,value));
   chip.onclick=()=>{commit({...applied(),[dimension.key]:''});open.focus({preventScroll:true});};chips.append(chip);
  }
  if(count){const clear=button('clearStationFilters','filters.clear','Clear filters','station-filter-clear secondary');clear.onclick=()=>{commit({zip_code:'',category:''});open.focus({preventScroll:true});};chips.append(clear);}
  chips.hidden=!count;open.setAttribute('aria-label',text('filters.open','Filters')+(count?' ('+count+')':''));open.setAttribute('data-active',count?'1':'0');renderZipNotice();
 }
 function renderZipNotice(){const state=readStationDirectoryState(),zip=applied().zip_code,current=!state.loading&&!state.failed&&state.loadedQuery===state.query&&state.loadedZipCode===zip&&state.loadedCategory===state.category,unknown=current&&!!zip&&zipSearchResult?.zip_code===zip&&zipSearchResult.zip_location_known===false;zipNotice.hidden=!unknown;if(unknown)labelled(zipNotice,'filters.zipUnknown','Nearby search is unavailable for this ZIP. Showing exact ZIP matches.');else zipNotice.textContent='';}
 function validateZip(showError=false){
  const valid=!zipInput.value.trim()||/^[0-9]{5}$/.test(zipInput.value.trim()),show=!valid&&(showError||!zipError.hidden),message=text('filters.zipInvalid','Enter a 5-digit ZIP code or leave it blank.');
  zipError.hidden=!show;if(show){labelled(zipError,'filters.zipInvalid',message);zipInput.setAttribute('aria-invalid','true');zipInput.setAttribute('aria-describedby',zipHelp.id+' '+zipError.id);}else{zipInput.removeAttribute('aria-invalid');zipInput.setAttribute('aria-describedby',zipHelp.id);}
  zipInput.setCustomValidity?.(valid?'':message);return valid;
 }
 function renderDraft(selection,clearError=false){
  zipInput.value=selection.zip_code||'';if(clearError)zipError.hidden=true;validateZip();
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
  labelled(empty,!catalogReady?'filters.categoryUnavailable':useful?'filters.moreCategories':'filters.noCategories',!catalogReady?'Category filters are not available yet. You can still search by ZIP code.':useful?'More categories will appear as station owners add them.':'Station owners haven’t added categories yet.');
 }
 function readDraft(){return {zip_code:zipInput.value.trim(),...Object.fromEntries(dimensions.map(dimension=>[dimension.key,groups.get(dimension.key).select.value]))};}
 function commit(selection){void applyStationDirectoryFilters(selection);renderChips();}
 function openDialog(){
  if(dialog.open||document.querySelector('dialog[open]'))return;renderDraft(applied(),true);dialog.showModal();zipInput.focus({preventScroll:true});
 }
 open.onclick=openDialog;
 apply.onclick=()=>{if(!validateZip(true)){zipInput.focus({preventScroll:true});return;}const selection=readDraft();dialog.close('applied');commit(selection);};
 zipInput.oninput=()=>validateZip();zipInput.onkeydown=event=>{if(event.key==='Enter'){event.preventDefault();apply.onclick();}};
 reset.onclick=()=>{renderDraft({zip_code:'',category:''},true);apply.focus({preventScroll:true});};
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
  zipSearchResult=result;
  for(const dimension of catalogDimensions){options[dimension.plural]=cleanEntries(result.metadata_options[dimension.plural],dimension,false);facets[dimension.plural]=cleanEntries(result.facets[dimension.plural],dimension,true);}
  catalogReady=true;renderChips();if(dialog.open)renderDraft(readDraft());window.dispatchEvent(new Event('station-filter-catalog-updated'));
 }
 window.stationDirectoryFilters={readApplied:applied,updateCatalog,syncStatus:renderZipNotice,readMetadataOptions:()=>Object.fromEntries(Object.entries(options).map(([key,values])=>[key,values.map(option=>({...option}))]))};
 const cached=typeof readStationDirectoryCatalog==='function'?readStationDirectoryCatalog():null;if(cached)updateCatalog(cached);else renderChips();
 window.addEventListener('app-language-changed',()=>{renderChips();if(dialog.open)renderDraft(readDraft());});
})();
