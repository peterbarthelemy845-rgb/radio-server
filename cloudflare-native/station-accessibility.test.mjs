import {test} from 'node:test';import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';import {runInNewContext} from 'node:vm';
const source=readFileSync(new URL('./public/assets/directory-news.js',import.meta.url),'utf8');
const renderSource=source.slice(source.indexOf('function renderStationSlider('),source.indexOf('list=function()'));
const completionSource=source.slice(source.indexOf('const stationResultAnnouncement='),source.indexOf("window.addEventListener('radio-locals-ready',list)"));
const station=code=>({listener_code:String(code),name:'Station '+code,logo_url:'/artwork/'+code+'.png'});
function fixture(){const ids=new Map(),focuses=[];let document;
 function node(tag='div'){let text='';const item={tagName:tag.toUpperCase(),children:[],parentElement:null,attributes:{},dataset:{},className:'',hidden:false,writes:0,scrolls:0,setAttribute(key,value){this.attributes[key]=String(value);},getAttribute(key){return this.attributes[key]??null;},removeAttribute(key){delete this.attributes[key];},append(...children){for(const child of children){child.parentElement=this;this.children.push(child);}},contains(target){return !!target&&(target===this||this.children.some(child=>child.contains(target)));},closest(selector){for(let current=this;current;current=current.parentElement)if(selector==='.'+current.className)return current;return null;},replaceChildren(...children){if(this.contains(document.activeElement)&&document.activeElement!==this)document.activeElement=document.body;for(const child of this.children)child.parentElement=null;this.children=[];this.append(...children);},focus(options){focuses.push({node:this,options});document.activeElement=this;},scrollIntoView(){this.scrolls++;}};
  item.classList={contains(value){return item.className.split(/\s+/).includes(value);}};Object.defineProperty(item,'textContent',{get:()=>text,set(value){text=String(value);item.writes++;}});Object.defineProperty(item,'id',{get(){return [...ids].find(([,value])=>value===item)?.[0]||'';},set(value){ids.set(value,item);}});return item;}
 document={createElement:node,body:node('body'),activeElement:null,hidden:false,dialogOpen:false,querySelector(selector){return selector==='dialog[open]'&&this.dialogOpen?{}:null;}};document.activeElement=document.body;
 const $=id=>{if(!ids.has(id)){const item=node(id==='search'?'input':id==='loadMoreStations'?'button':'div');item.id=id;document.body.append(item);}return ids.get(id);};for(const id of ['myRadio','library','search','loadMoreStations','savedStations','stations'])$(id);
 const ctx={document,$,location:{origin:'https://radiolocals.com'},window:{},openStationPopup(){},shareButton(){const item=node('button');return item;}};runInNewContext(renderSource+'\n'+completionSource,ctx);
 const render=runInNewContext('renderStationSlider',ctx),complete=ctx.window.onStationDirectoryComplete;
 function find(code,track='stations',share=false){const item=$(track).children.find(item=>item.getAttribute('data-station-code')===String(code));return item?.children[share?1:0];}
 function paint(codes,track='stations'){render($(track),codes.map(station),'No stations',track==='savedStations');}
 function focusCode(code,track='stations',share=false){find(code,track,share).focus({preventScroll:true});focuses.length=0;}
 return {ctx,document,$,paint,find,focusCode,focuses,complete,announcement:()=>$('stationResultAnnouncement')};
}
test('station and share focus follow station identity when results reorder',()=>{
 for(const share of [false,true]){const f=fixture();f.paint([10,11,12]);f.focusCode(11,'stations',share);f.paint([12,10,11]);assert.equal(f.document.activeElement,f.find(11,'stations',share));assert.equal(f.focuses.length,1);assert.equal(f.focuses[0].options.preventScroll,true);}
});
test('removing a focused station keeps its former position where possible, then falls back to search',()=>{
 const f=fixture();f.paint([10,11,12]);f.focusCode(11);f.paint([10,12]);assert.equal(f.document.activeElement,f.find(12));f.focusCode(12);f.paint([10]);assert.equal(f.document.activeElement,f.find(10));f.focusCode(10);f.paint([]);assert.equal(f.document.activeElement,f.$('search'));
});
test('saved station share focus survives its own refresh and never moves during another track refresh',()=>{
 const f=fixture();f.paint([13,14],'savedStations');f.paint([10,11]);f.focusCode(13,'savedStations',true);f.paint([14,13],'savedStations');assert.equal(f.document.activeElement,f.find(13,'savedStations',true));f.focuses.length=0;f.paint([11,10]);assert.equal(f.document.activeElement,f.find(13,'savedStations',true));assert.equal(f.focuses.length,0);
});
test('ordinary station refreshes never steal focus from another control',()=>{
 const f=fixture();f.paint([10,11]);f.$('search').focus();f.focuses.length=0;f.paint([11,10]);assert.equal(f.document.activeElement,f.$('search'));assert.equal(f.focuses.length,0);
});
test('hidden documents, hidden radio pages and open dialogs suppress station focus restoration',()=>{
 for(const mode of ['document','page','dialog']){const f=fixture();f.paint([10]);f.focusCode(10);if(mode==='document')f.document.hidden=true;if(mode==='page')f.$('myRadio').hidden=true;if(mode==='dialog')f.document.dialogOpen=true;f.paint([10]);assert.equal(f.focuses.length,0,mode);}
});
test('completed station results use a polite atomic announcement and identical polls stay quiet',()=>{
 const f=fixture();f.paint([10,11]);f.complete({query:'',hasMore:true});const text=f.announcement();assert.equal(text.getAttribute('role'),'status');assert.equal(text.getAttribute('aria-live'),'polite');assert.equal(text.getAttribute('aria-atomic'),'true');assert.equal(text.textContent,'2 stations shown. More available.');const writes=text.writes;f.complete({query:'',hasMore:true});assert.equal(text.writes,writes);assert.equal(f.focuses.length,0);
 f.paint([10,11,12]);f.complete({query:'',hasMore:false});assert.equal(text.textContent,'3 stations shown.');assert.equal(text.writes,writes+1);
});
test('failed or hidden results do not announce or advance the visible-result signature',()=>{
 for(const mode of ['failed','document','page']){const f=fixture();f.paint([10]);f.complete({query:'old',hasMore:false});const writes=f.announcement().writes;f.paint([11,12]);if(mode==='document')f.document.hidden=true;if(mode==='page')f.$('myRadio').hidden=true;f.complete({query:'new',hasMore:false,failed:mode==='failed'});assert.equal(f.announcement().writes,writes,mode);f.document.hidden=false;f.$('myRadio').hidden=false;f.complete({query:'new',hasMore:false});assert.equal(f.announcement().writes,writes+1,mode);}
});
test('station announcements use the translated result count without exposing station names as live text',()=>{
 const f=fixture(),calls=[];f.ctx.window.appI18n={t(key,values){calls.push({key,count:values.count});return values.count+' stations disponibles.';}};f.paint([10,11]);f.complete({query:'community',hasMore:false});assert.equal(f.announcement().textContent,'2 stations disponibles.');assert.deepEqual(calls,[{key:'directory.results',count:2}]);assert.doesNotMatch(f.announcement().textContent,/Station 10|Station 11/);
});
test('a focused final More action moves to the first new available tile, even if a received code was already saved',()=>{
 const f=fixture();f.paint([13],'savedStations');f.paint([10,14]);f.$('loadMoreStations').hidden=true;f.document.activeElement=f.document.body;f.complete({append:true,moreFocused:true,receivedCodes:['13','14'],hasMore:false});assert.equal(f.document.activeElement,f.find(14));assert.equal(f.find(14).scrolls,1);
});

test('a final page with only previously saved codes falls back through available, saved, then search',()=>{
 const f=fixture();f.paint([13],'savedStations');f.paint([10]);f.document.activeElement=f.document.body;f.complete({append:true,moreFocused:true,receivedCodes:['13'],hasMore:false});assert.equal(f.document.activeElement,f.find(10));f.paint([]);f.document.activeElement=f.document.body;f.complete({append:true,moreFocused:true,receivedCodes:['13'],hasMore:false});assert.equal(f.document.activeElement,f.find(13,'savedStations'));f.paint([],'savedStations');f.document.activeElement=f.document.body;f.complete({append:true,moreFocused:true,receivedCodes:[],hasMore:false});assert.equal(f.document.activeElement,f.$('search'));
});
test('More retains its focus while another page exists and empty final pages fall back to search',()=>{
 const f=fixture();f.paint([10,11]);f.document.activeElement=f.$('loadMoreStations');f.complete({append:true,moreFocused:true,receivedCodes:['11'],hasMore:true});assert.equal(f.document.activeElement,f.$('loadMoreStations'));assert.equal(f.focuses.length,1);f.paint([]);f.document.activeElement=f.document.body;f.complete({append:true,moreFocused:true,receivedCodes:[],hasMore:false});assert.equal(f.document.activeElement,f.$('search'));
});
test('More completion never steals focus after the visitor moved elsewhere, opened a dialog or hid the page',()=>{
 for(const mode of ['control','dialog','page','document','unfocused','failed']){const f=fixture();f.paint([10,11]);f.document.activeElement=mode==='control'?f.$('search'):f.$('loadMoreStations');if(mode==='dialog')f.document.dialogOpen=true;if(mode==='page')f.$('myRadio').hidden=true;if(mode==='document')f.document.hidden=true;f.complete({append:true,moreFocused:mode!=='unfocused',receivedCodes:['11'],hasMore:false,failed:mode==='failed'});assert.equal(f.focuses.length,0,mode);}
});
