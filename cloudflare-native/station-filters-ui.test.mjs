import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
const source=readFileSync(new URL('./public/assets/station-filters.js',import.meta.url),'utf8');
const siteSource=readFileSync(new URL('./public/assets/site.js',import.meta.url),'utf8'),directorySource=siteSource.slice(siteSource.indexOf('// Refresh the public directory'),siteSource.indexOf('async function loadSupport()'));
const metadata={languages:[{value:'en',label:'English'},{value:'ht',label:'Haitian Creole'},{value:'fr',label:'French'}],categories:[{value:'music',label:'Music'},{value:'news_talk',label:'News & talk'}]};
function catalog({languages=[['en',3],['ht',2]],categories=[['music',4],['news_talk',1]]}={}){return {metadata_options:metadata,facets:{languages:languages.map(([value,count])=>({value,label:metadata.languages.find(option=>option.value===value)?.label,count})),categories:categories.map(([value,count])=>({value,label:metadata.categories.find(option=>option.value===value)?.label,count}))}};}
function fixture({initial={zip_code:'',category:''},cached=null,missing=false,withDirectory=false}={}){
 const nodes=new Map(),events=new Map(),commits=[],calls=[],answers=[],timers=new Map();let state={query:'',loadedQuery:'',loadedZipCode:initial.zip_code||'',loadedCategory:initial.category||'',loading:false,failed:false,...initial},document,timerId=0;
 class Element{
  constructor(tag='div'){this.tagName=tag.toUpperCase();this.children=[];this.dataset={};this.attributes={};this.handlers=new Map();this.value='';this.hidden=false;this.open=false;this.textContent='';}
  set id(value){this._id=value;if(value)nodes.set(value,this);}get id(){return this._id;}
  setAttribute(key,value){this.attributes[key]=value;}getAttribute(key){return this.attributes[key];}
  removeAttribute(key){delete this.attributes[key];}
  remove(){if(this.parentElement){const siblings=this.parentElement.children;siblings.splice(siblings.indexOf(this),1);this.parentElement=null;}}
  append(...items){for(const item of items){item.remove();item.parentElement=this;this.children.push(item);}}
  before(item){const parent=this.parentElement;item.remove();item.parentElement=parent;parent.children.splice(parent.children.indexOf(this),0,item);}
  after(item){const parent=this.parentElement;item.remove();item.parentElement=parent;parent.children.splice(parent.children.indexOf(this)+1,0,item);}
  replaceChildren(...items){for(const item of [...this.children])item.remove();this.append(...items);}
  addEventListener(name,fn){const handlers=this.handlers.get(name)||[];handlers.push(fn);this.handlers.set(name,handlers);}
  dispatch(name,detail={}){for(const fn of this.handlers.get(name)||[])fn({target:this,...detail});if(name==='cancel')this.close('cancelled');}
  focus(){document.activeElement=this;}
  showModal(){this.open=true;}
  close(result){this.open=false;this.returnValue=result;this.dispatch('close');}
  getBoundingClientRect(){return {left:10,right:400,top:10,bottom:500};}
 }
 const body=new Element('body'),library=new Element('section'),search=new Element('input'),more=new Element('button');library.id='library';search.id='search';more.id='loadMoreStations';library.append(search,more);body.append(library);
 document={body,activeElement:null,createElement:tag=>new Element(tag),getElementById:id=>missing?null:nodes.get(id),querySelector:selector=>selector==='dialog[open]'?[...nodes.values()].find(node=>node.tagName==='DIALOG'&&node.open)||null:null};
 const window={addEventListener(name,fn){const listeners=events.get(name)||[];listeners.push(fn);events.set(name,listeners);},dispatchEvent(event){for(const fn of events.get(event.type)||[])fn(event);}};
 class UiEvent{constructor(type){this.type=type;}}
 const context=vm.createContext({document,window,Event:UiEvent,Set,Map,Object,Number,String,readStationDirectoryState:()=>({...state}),readStationDirectoryCatalog:()=>cached,applyStationDirectoryFilters(selection){commits.push({...selection});state={...state,...selection};return Promise.resolve();}});
 if(withDirectory){
  Object.assign(context,{$:id=>document.getElementById(id),AbortController,list(){},message(){},setTimeout(fn){const id=++timerId;timers.set(id,fn);return id;},clearTimeout(id){timers.delete(id);},api:async(path,body,options)=>{calls.push({path,options});if(!answers.length)throw Error('Missing directory response');return await answers.shift();},initialDirectoryState:initial});
  vm.runInContext('let stations=[];',context);vm.runInContext(directorySource,context);vm.runInContext('Object.assign(stationDirectoryState,initialDirectoryState);',context);
 }
 vm.runInContext(source,context);
 const $=id=>nodes.get(id),dialog=$('stationFiltersDialog');
 return {$,window,document,commits,calls,answers,library,search,dialog,get state(){return state;},update:result=>window.stationDirectoryFilters.updateCatalog(result),open:()=>$('openStationFilters').onclick(),apply:()=>$('applyStationFilters').onclick(),reset:()=>$('resetStationFilterDraft').onclick(),close:()=>$('closeStationFilters').onclick(),emit:type=>window.dispatchEvent(new UiEvent(type)),request:()=>vm.runInContext('refreshStationDirectory(true)',context),searchDirectory:value=>context.searchStationDirectory(value),idle:()=>vm.runInContext('stationDirectoryRequest?.promise',context),async flushSearch(){for(const [id,fn] of [...timers]){timers.delete(id);fn();}await vm.runInContext('stationDirectoryRequest?.promise',context);}};
}

test('search keeps a visible Filters entry and optional ZIP input even when no station has metadata',()=>{
 const f=fixture();f.update(catalog({languages:[['en',0],['ht',0]],categories:[['music',0],['news_talk',0]]}));f.open();
 assert.equal(f.$('openStationFilters').hidden,false);assert.equal(f.search.parentElement.id,'stationSearchControls');assert.equal(f.$('openStationFilters').getAttribute('aria-haspopup'),'dialog');
 assert.equal(f.dialog.getAttribute('aria-labelledby'),'stationFiltersTitle');assert.equal(f.dialog.getAttribute('aria-describedby'),'stationFiltersHelp');
 assert.equal(f.$('stationFiltersEmpty').textContent,'Station owners haven’t added categories yet.');assert.equal(f.$('stationFilterLanguage'),undefined);assert.equal(f.$('stationFilterCategory').parentElement.hidden,true);
 const zip=f.$('stationFilterZip');assert.equal(zip.parentElement.hidden,false);assert.equal(zip.type,'text');assert.equal(zip.inputMode,'numeric');assert.equal(zip.maxLength,5);assert.equal(zip.pattern,'[0-9]{5}');assert.equal(f.$('stationFilterZipHelp').textContent,'Stations within about 25 miles.');
 f.reset();assert.equal(f.document.activeElement,f.$('applyStationFilters'));assert.equal(f.commits.length,0);f.apply();assert.deepEqual(f.commits,[{zip_code:'',category:''}]);
});

test('only dimensions with multiple populated values appear, without invented options',()=>{
 const f=fixture();f.update(catalog({languages:[['en',3],['ht',0]],categories:[['music',4],['news_talk',1]]}));f.open();
 assert.equal(f.$('stationFilterCategory').parentElement.hidden,false);assert.equal(f.$('stationFiltersEmpty').hidden,true);
 assert.deepEqual(f.$('stationFilterCategory').children.map(option=>[option.value,option.textContent]),[['','All'],['music','Music'],['news_talk','News & talk']]);
 assert.equal(f.document.activeElement,f.$('stationFilterZip'));assert.equal(f.commits.length,0);
});

test('the Religion label retains its existing internal category value even with an older catalog label',()=>{
 const f=fixture(),categories=[{value:'christian',label:'Christian'},{value:'music',label:'Music'}];f.update({metadata_options:{languages:[],categories},facets:{languages:[],categories:categories.map(option=>({...option,count:2}))}});f.open();
 const select=f.$('stationFilterCategory'),religion=select.children.find(option=>option.value==='christian');assert.equal(religion.textContent,'Religion');select.value='christian';f.apply();assert.deepEqual(f.commits.at(-1),{zip_code:'',category:'christian'});assert.equal(f.$('stationAppliedFilters').children[0].textContent,'Religion ×');
});

test('draft changes, Close, Escape and backdrop cancellation never change applied filters',()=>{
 const f=fixture();f.update(catalog());
 for(const cancel of [()=>f.close(),()=>f.dialog.dispatch('cancel'),()=>f.dialog.dispatch('click',{clientX:1,clientY:1})]){
  f.open();f.$('stationFilterZip').value='00501';f.$('stationFilterCategory').value='music';cancel();assert.equal(f.dialog.open,false);assert.equal(f.document.activeElement,f.$('openStationFilters'));assert.equal(f.commits.length,0);
  f.open();assert.equal(f.$('stationFilterZip').value,'');assert.equal(f.$('stationFilterCategory').value,'');f.close();
 }
 f.open();f.dialog.dispatch('click',{clientX:100,clientY:100});assert.equal(f.dialog.open,true,'clicking sheet padding does not dismiss it');
});

test('Apply commits both choices once, while Reset changes only the draft until Apply',()=>{
 const f=fixture();f.update(catalog());f.open();f.$('stationFilterZip').value='00501';f.$('stationFilterCategory').value='news_talk';f.apply();
 assert.deepEqual(f.commits,[{zip_code:'00501',category:'news_talk'}]);assert.equal(f.dialog.open,false);assert.equal(f.$('stationAppliedFilters').hidden,false);assert.equal(f.$('openStationFilters').getAttribute('aria-label'),'Filters (2)');
 f.open();assert.equal(f.$('stationFilterZip').value,'00501');f.reset();assert.equal(f.$('stationFilterZip').value,'');assert.equal(f.commits.length,1);f.close();assert.equal(f.state.zip_code,'00501');
 f.open();f.reset();f.apply();assert.deepEqual(f.commits.at(-1),{zip_code:'',category:''});assert.equal(f.$('stationAppliedFilters').hidden,true);
});

test('removable chips preserve the other applied choice and Clear filters removes both',()=>{
 const f=fixture({initial:{zip_code:'00501',category:'music'},cached:catalog()});const chips=f.$('stationAppliedFilters');
 assert.equal(chips.children[0].textContent,'Near ZIP 00501 ×');assert.equal(chips.children[0].getAttribute('aria-label'),'Remove filter: Near ZIP 00501');chips.children[0].onclick();
 assert.deepEqual(f.commits.at(-1),{zip_code:'',category:'music'});assert.equal(f.document.activeElement,f.$('openStationFilters'));assert.equal(chips.children[0].textContent,'Music ×');f.$('clearStationFilters').onclick();assert.deepEqual(f.commits.at(-1),{zip_code:'',category:''});assert.equal(chips.hidden,true);
});

test('active zero-count filters stay visible and clearable even after metadata disappears',()=>{
 const f=fixture({initial:{zip_code:'10960',category:'music'}});f.update(catalog({languages:[],categories:[]}));f.open();
 assert.equal(f.$('stationFilterCategory').parentElement.hidden,false);assert.equal(f.$('stationFilterCategory').value,'music');assert.deepEqual(f.$('stationFilterCategory').children.map(option=>option.value),['','music']);assert.equal(f.$('stationFilterZip').value,'10960');
 f.reset();f.apply();assert.equal(f.state.category,'');f.open();assert.equal(f.$('stationFilterCategory').parentElement.hidden,true);assert.equal(f.$('stationFiltersEmpty').hidden,false);
});

test('catalog updates preserve in-progress selections and expose copied metadata for owner forms',()=>{
 const f=fixture();f.update(catalog());f.open();f.$('stationFilterZip').value='00501';f.$('stationFilterCategory').value='music';f.update(catalog({categories:[['music',9],['news_talk',1]]}));assert.equal(f.$('stationFilterZip').value,'00501');assert.equal(f.$('stationFilterCategory').value,'music');assert.equal(f.commits.length,0);
 const options=f.window.stationDirectoryFilters.readMetadataOptions();options.languages[0].label='Changed outside';assert.equal(f.window.stationDirectoryFilters.readMetadataOptions().languages[0].label,'English');assert.deepEqual({...f.window.stationDirectoryFilters.readApplied()},{zip_code:'',category:''});
});

test('shared metadata translation keys translate chips and labels without changing filter values',()=>{
 const f=fixture({initial:{zip_code:'00501',category:'music'},cached:catalog()});f.window.appI18n={t:(key,values)=>key==='filters.nearZip'?'Toupre ZIP '+values.zip:({'metadata.category.music':'Mizik','filters.open':'Filtè','filters.remove':'Retire filtè'}[key]||key)};f.emit('app-language-changed');
 assert.equal(f.$('stationAppliedFilters').children[0].textContent,'Toupre ZIP 00501 ×');f.open();assert.equal(f.$('stationFilterZip').value,'00501');assert.equal(f.$('stationFilterCategory').children.find(option=>option.value==='music').textContent,'Mizik');assert.equal(f.commits.length,0);
});

test('unavailable catalog keeps a working dialog and invalid remote metadata cannot create filters',()=>{
 const f=fixture();f.open();assert.equal(f.$('stationFiltersEmpty').textContent,'Category filters are not available yet. You can still search by ZIP code.');assert.equal(f.$('stationFilterZip').parentElement.hidden,false);f.close();
 f.update({metadata_options:{languages:[],categories:[{value:'bad',label:'<script>'}]},facets:{languages:[],categories:[{value:'bad',label:'<script>',count:99}]}});f.open();assert.equal(f.$('stationFilterCategory').parentElement.hidden,true);assert.equal(f.$('stationFilterCategory').children.length,1);
 const absent=fixture({missing:true});assert.equal(absent.window.stationDirectoryFilters,undefined);
});

test('invalid ZIP drafts show an accessible error without applying or closing, and leading zero ZIPs stay strings',()=>{
 const f=fixture();f.update(catalog());f.open();const zip=f.$('stationFilterZip'),error=f.$('stationFilterZipError');
 for(const value of ['12','1096a','１２３４５','10960-1234','10960x']){zip.value=value;f.apply();assert.equal(f.dialog.open,true);assert.equal(f.commits.length,0);assert.equal(f.document.activeElement,zip);assert.equal(zip.getAttribute('aria-invalid'),'true');assert.equal(error.hidden,false);assert.equal(error.getAttribute('role'),'alert');assert.match(zip.getAttribute('aria-describedby'),/stationFilterZipError/);}
 zip.value='00501';zip.oninput();assert.equal(error.hidden,true);assert.equal(zip.getAttribute('aria-invalid'),undefined);assert.equal(zip.getAttribute('aria-describedby'),'stationFilterZipHelp');f.apply();assert.deepEqual(f.commits.at(-1),{zip_code:'00501',category:''});
});

test('an invalid ZIP remains editable across catalog updates and can be cancelled or reset without a request',()=>{
 const f=fixture();f.open();const zip=f.$('stationFilterZip');zip.value='ab';f.apply();f.update(catalog());assert.equal(zip.value,'ab');assert.equal(f.$('stationFilterZipError').hidden,false);f.close();assert.equal(f.dialog.open,false);assert.equal(f.commits.length,0);
 f.open();assert.equal(zip.value,'');assert.equal(f.$('stationFilterZipError').hidden,true);zip.value='9';f.apply();f.reset();assert.equal(zip.value,'');assert.equal(f.$('stationFilterZipError').hidden,true);assert.equal(f.commits.length,0);
 zip.value='   ';let prevented=false;zip.onkeydown({key:'Enter',preventDefault(){prevented=true;}});assert.equal(prevented,true);assert.deepEqual(f.commits.at(-1),{zip_code:'',category:''});
});

test('unknown ZIP fallback notice appears only for the current matching applied ZIP and clears after reset or known results',()=>{
 const f=fixture({initial:{zip_code:'00001',category:''}}),notice=f.$('stationZipNotice');assert.equal(notice.hidden,true);
 f.update({...catalog(),zip_code:'00002',zip_location_known:false,zip_radius_miles:null});assert.equal(notice.hidden,true,'another ZIP cannot display a fallback warning');
 f.update({...catalog(),zip_code:'00001',zip_location_known:false,zip_radius_miles:null});assert.equal(notice.hidden,false);assert.equal(notice.getAttribute('role'),'status');assert.match(notice.textContent,/Showing exact ZIP matches/);
 f.update({...catalog(),zip_code:'00001',zip_location_known:true,zip_radius_miles:25});assert.equal(notice.hidden,true);assert.equal(notice.textContent,'');
 f.update({...catalog(),zip_code:'00001',zip_location_known:false});f.open();f.reset();assert.equal(notice.hidden,false,'draft Reset does not change applied results');f.apply();assert.equal(notice.hidden,true);assert.equal(notice.textContent,'');
 f.update({...catalog(),zip_code:'00001',zip_location_known:false});assert.equal(notice.hidden,true,'a result for a removed ZIP cannot restore its notice');
});

test('ZIP fallback notice clears as a new search starts and returns only with its current successful response',async()=>{
 const f=fixture({withDirectory:true}),notice=f.$('stationZipNotice');f.answers.push({...catalog(),stations:[],zip_code:'00001',zip_location_known:false});f.open();f.$('stationFilterZip').value='00001';f.apply();await f.idle();assert.equal(notice.hidden,false);
 f.searchDirectory('News');assert.equal(notice.hidden,true,'an old response must not describe the pending search');assert.equal(notice.textContent,'');
 f.answers.push({...catalog(),stations:[],zip_code:'00001',zip_location_known:false});await f.flushSearch();assert.equal(notice.hidden,false);assert.match(f.calls.at(-1).path,/q=news&zip_code=00001$/);
 f.answers.push({...catalog(),stations:[],zip_code:'00001',zip_location_known:true,zip_radius_miles:25});await f.request();assert.equal(notice.hidden,true);
});

test('superseded ZIP fallback responses cannot revive a notice after the current search or ZIP succeeds',async()=>{
 let finish;const pending=new Promise(resolve=>{finish=resolve;}),f=fixture({initial:{zip_code:'00001',category:''},withDirectory:true}),notice=f.$('stationZipNotice');f.answers.push(pending);const old=f.request();
 f.searchDirectory('News');f.answers.push({...catalog(),stations:[],zip_code:'00001',zip_location_known:true,zip_radius_miles:25});await f.flushSearch();assert.equal(notice.hidden,true);
 finish({...catalog(),stations:[],zip_code:'00001',zip_location_known:false});await old;assert.equal(notice.hidden,true);assert.equal(notice.textContent,'');
 f.open();f.$('stationFilterZip').value='10960';f.answers.push({...catalog(),stations:[],zip_code:'10960',zip_location_known:true,zip_radius_miles:25});f.apply();await f.idle();assert.equal(notice.hidden,true);
});
