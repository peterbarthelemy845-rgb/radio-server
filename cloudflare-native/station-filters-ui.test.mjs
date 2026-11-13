import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
const source=readFileSync(new URL('./public/assets/station-filters.js',import.meta.url),'utf8');
const metadata={languages:[{value:'en',label:'English'},{value:'ht',label:'Haitian Creole'},{value:'fr',label:'French'}],categories:[{value:'music',label:'Music'},{value:'news_talk',label:'News & talk'}]};
function catalog({languages=[['en',3],['ht',2]],categories=[['music',4],['news_talk',1]]}={}){return {metadata_options:metadata,facets:{languages:languages.map(([value,count])=>({value,label:metadata.languages.find(option=>option.value===value)?.label,count})),categories:categories.map(([value,count])=>({value,label:metadata.categories.find(option=>option.value===value)?.label,count}))}};}
function fixture({initial={language:'',category:''},cached=null,missing=false}={}){
 const nodes=new Map(),events=new Map(),commits=[];let state={...initial},document;
 class Element{
  constructor(tag='div'){this.tagName=tag.toUpperCase();this.children=[];this.dataset={};this.attributes={};this.handlers=new Map();this.value='';this.hidden=false;this.open=false;this.textContent='';}
  set id(value){this._id=value;if(value)nodes.set(value,this);}get id(){return this._id;}
  setAttribute(key,value){this.attributes[key]=value;}getAttribute(key){return this.attributes[key];}
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
 const body=new Element('body'),library=new Element('section'),search=new Element('input');library.id='library';search.id='search';library.append(search);body.append(library);
 document={body,activeElement:null,createElement:tag=>new Element(tag),getElementById:id=>missing?null:nodes.get(id),querySelector:selector=>selector==='dialog[open]'?[...nodes.values()].find(node=>node.tagName==='DIALOG'&&node.open)||null:null};
 const window={addEventListener(name,fn){const listeners=events.get(name)||[];listeners.push(fn);events.set(name,listeners);},dispatchEvent(event){for(const fn of events.get(event.type)||[])fn(event);}};
 class UiEvent{constructor(type){this.type=type;}}
 const context=vm.createContext({document,window,Event:UiEvent,Set,Map,Object,Number,String,readStationDirectoryState:()=>({...state}),readStationDirectoryCatalog:()=>cached,applyStationDirectoryFilters(selection){commits.push({...selection});state={...state,...selection};return Promise.resolve();}});
 vm.runInContext(source,context);
 const $=id=>nodes.get(id),dialog=$('stationFiltersDialog');
 return {$,window,document,commits,library,search,dialog,get state(){return state;},update:result=>window.stationDirectoryFilters.updateCatalog(result),open:()=>$('openStationFilters').onclick(),apply:()=>$('applyStationFilters').onclick(),reset:()=>$('resetStationFilterDraft').onclick(),close:()=>$('closeStationFilters').onclick(),emit:type=>window.dispatchEvent(new UiEvent(type))};
}

test('search keeps a visible Filters entry even when no station has metadata',()=>{
 const f=fixture();f.update(catalog({languages:[['en',0],['ht',0]],categories:[['music',0],['news_talk',0]]}));f.open();
 assert.equal(f.$('openStationFilters').hidden,false);assert.equal(f.search.parentElement.id,'stationSearchControls');assert.equal(f.$('openStationFilters').getAttribute('aria-haspopup'),'dialog');
 assert.equal(f.dialog.getAttribute('aria-labelledby'),'stationFiltersTitle');assert.equal(f.dialog.getAttribute('aria-describedby'),'stationFiltersHelp');
 assert.equal(f.$('stationFiltersEmpty').textContent,'Station owners haven’t added language or category yet.');assert.equal(f.$('stationFilterLanguage').parentElement.hidden,true);assert.equal(f.$('stationFilterCategory').parentElement.hidden,true);
 assert.equal(f.$('resetStationFilterDraft').disabled,undefined);f.reset();assert.equal(f.document.activeElement,f.$('applyStationFilters'));assert.equal(f.commits.length,0);f.apply();assert.deepEqual(f.commits,[{language:'',category:''}]);
});

test('only dimensions with multiple populated values appear, without invented options',()=>{
 const f=fixture();f.update(catalog({languages:[['en',3],['ht',0]],categories:[['music',4],['news_talk',1]]}));f.open();
 assert.equal(f.$('stationFilterLanguage').parentElement.hidden,true);assert.equal(f.$('stationFilterCategory').parentElement.hidden,false);assert.equal(f.$('stationFiltersEmpty').hidden,true);
 assert.deepEqual(f.$('stationFilterCategory').children.map(option=>[option.value,option.textContent]),[['','All'],['music','Music'],['news_talk','News & talk']]);
 assert.equal(f.document.activeElement,f.$('stationFilterCategory'));assert.equal(f.commits.length,0);
});

test('draft changes, Close, Escape and backdrop cancellation never change applied filters',()=>{
 const f=fixture();f.update(catalog());
 for(const cancel of [()=>f.close(),()=>f.dialog.dispatch('cancel'),()=>f.dialog.dispatch('click',{clientX:1,clientY:1})]){
  f.open();f.$('stationFilterLanguage').value='ht';f.$('stationFilterCategory').value='music';cancel();assert.equal(f.dialog.open,false);assert.equal(f.document.activeElement,f.$('openStationFilters'));assert.equal(f.commits.length,0);
  f.open();assert.equal(f.$('stationFilterLanguage').value,'');assert.equal(f.$('stationFilterCategory').value,'');f.close();
 }
 f.open();f.dialog.dispatch('click',{clientX:100,clientY:100});assert.equal(f.dialog.open,true,'clicking sheet padding does not dismiss it');
});

test('Apply commits both choices once, while Reset changes only the draft until Apply',()=>{
 const f=fixture();f.update(catalog());f.open();f.$('stationFilterLanguage').value='ht';f.$('stationFilterCategory').value='news_talk';f.apply();
 assert.deepEqual(f.commits,[{language:'ht',category:'news_talk'}]);assert.equal(f.dialog.open,false);assert.equal(f.$('stationAppliedFilters').hidden,false);assert.equal(f.$('openStationFilters').getAttribute('aria-label'),'Filters (2)');
 f.open();assert.equal(f.$('stationFilterLanguage').value,'ht');f.reset();assert.equal(f.$('stationFilterLanguage').value,'');assert.equal(f.commits.length,1);f.close();assert.equal(f.state.language,'ht');
 f.open();f.reset();f.apply();assert.deepEqual(f.commits.at(-1),{language:'',category:''});assert.equal(f.$('stationAppliedFilters').hidden,true);
});

test('removable chips preserve the other applied choice and Clear filters removes both',()=>{
 const f=fixture({initial:{language:'ht',category:'music'},cached:catalog()});const chips=f.$('stationAppliedFilters');
 assert.equal(chips.children[0].textContent,'Haitian Creole ×');assert.equal(chips.children[0].getAttribute('aria-label'),'Remove filter: Haitian Creole');chips.children[0].onclick();
 assert.deepEqual(f.commits.at(-1),{language:'',category:'music'});assert.equal(f.document.activeElement,f.$('openStationFilters'));assert.equal(chips.children[0].textContent,'Music ×');f.$('clearStationFilters').onclick();assert.deepEqual(f.commits.at(-1),{language:'',category:''});assert.equal(chips.hidden,true);
});

test('active zero-count filters stay visible and clearable even after metadata disappears',()=>{
 const f=fixture({initial:{language:'fr',category:''}});f.update(catalog({languages:[],categories:[]}));f.open();
 assert.equal(f.$('stationFilterLanguage').parentElement.hidden,false);assert.equal(f.$('stationFilterLanguage').value,'fr');assert.deepEqual(f.$('stationFilterLanguage').children.map(option=>option.value),['','fr']);
 f.reset();f.apply();assert.equal(f.state.language,'');f.open();assert.equal(f.$('stationFilterLanguage').parentElement.hidden,true);assert.equal(f.$('stationFiltersEmpty').hidden,false);
});

test('catalog updates preserve in-progress selections and expose copied metadata for owner forms',()=>{
 const f=fixture();f.update(catalog());f.open();f.$('stationFilterLanguage').value='ht';f.update(catalog({languages:[['en',9],['ht',1]]}));assert.equal(f.$('stationFilterLanguage').value,'ht');assert.equal(f.commits.length,0);
 const options=f.window.stationDirectoryFilters.readMetadataOptions();options.languages[0].label='Changed outside';assert.equal(f.window.stationDirectoryFilters.readMetadataOptions().languages[0].label,'English');assert.deepEqual({...f.window.stationDirectoryFilters.readApplied()},{language:'',category:''});
});

test('shared metadata translation keys translate chips and labels without changing filter values',()=>{
 const f=fixture({initial:{language:'ht',category:'music'},cached:catalog()});f.window.appI18n={t:key=>({'metadata.language.ht':'Kreyòl ayisyen','metadata.category.music':'Mizik','filters.open':'Filtè','filters.remove':'Retire filtè'}[key]||key)};f.emit('app-language-changed');
 assert.equal(f.$('stationAppliedFilters').children[0].textContent,'Kreyòl ayisyen ×');f.open();assert.equal(f.$('stationFilterLanguage').value,'ht');assert.equal(f.$('stationFilterLanguage').children.find(option=>option.value==='ht').textContent,'Kreyòl ayisyen');assert.equal(f.commits.length,0);
});

test('unavailable catalog keeps a working dialog and invalid remote metadata cannot create filters',()=>{
 const f=fixture();f.open();assert.equal(f.$('stationFiltersEmpty').textContent,'Filters are not available yet. Try again shortly.');f.close();
 f.update({metadata_options:{languages:[{value:'bad',label:'<script>'}],categories:[]},facets:{languages:[{value:'bad',label:'<script>',count:99}],categories:[]}});f.open();assert.equal(f.$('stationFilterLanguage').parentElement.hidden,true);assert.equal(f.$('stationFilterLanguage').children.length,1);
 const absent=fixture({missing:true});assert.equal(absent.window.stationDirectoryFilters,undefined);
});
