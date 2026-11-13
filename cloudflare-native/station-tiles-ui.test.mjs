import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
const source=readFileSync(new URL('./public/assets/directory-news.js',import.meta.url),'utf8');

test('failed station images fall back once without making broken-image retry loops',()=>{
 function node(){let src;return {children:[],srcWrites:[],setAttribute(){},removeAttribute(){},append(...children){this.children.push(...children);},replaceChildren(){this.children=[];},get src(){return src;},set src(value){src=value;this.srcWrites.push(value);}};}
 const render=runInNewContext(source.slice(source.indexOf('function renderStationSlider('),source.indexOf('list=function()'))+';renderStationSlider;',{document:{createElement:node}}),track=node();
 render(track,[{name:'Station',listener_code:'13',logo_url:'/artwork/missing.png'}],'No stations');const image=track.children[0].children[0].children[0];
 image.onerror?.();assert.equal(image.src,'/assets/logo-placeholder.svg');assert.equal(image.onerror,null);image.onerror?.();assert.deepEqual(image.srcWrites,['/artwork/missing.png','/assets/logo-placeholder.svg']);
});

test('compact tiles request a small thumbnail and fall back to the full logo before the placeholder',()=>{
 function node(){let src;return {children:[],srcWrites:[],setAttribute(){},removeAttribute(){},append(...children){this.children.push(...children);},replaceChildren(){this.children=[];},get src(){return src;},set src(value){src=value;this.srcWrites.push(value);}};}
 const render=runInNewContext(source.slice(source.indexOf('function renderStationSlider('),source.indexOf('list=function()'))+';renderStationSlider;',{document:{createElement:node}}),track=node();
 render(track,[{name:'Station',listener_code:'13',logo_url:'/artwork/logo.png',logo_thumb_url:'/artwork/logo.png?size=192'}],'No stations');const image=track.children[0].children[0].children[0];
 assert.equal(image.src,'/artwork/logo.png?size=192');image.onerror();assert.equal(image.src,'/artwork/logo.png');assert.equal(typeof image.onerror,'function');image.onerror();assert.equal(image.onerror,null);assert.deepEqual(image.srcWrites,['/artwork/logo.png?size=192','/artwork/logo.png','/assets/logo-placeholder.svg']);
});

test('artwork and its visible name form one button and either tap starts one automatic add',()=>{
 const openings=[];
 function node(tagName='div'){return {tagName:tagName.toUpperCase(),children:[],attrs:{},setAttribute(key,value){this.attrs[key]=value;},removeAttribute(key){delete this.attrs[key];},append(...children){for(const child of children){child.parent=this;this.children.push(child);}},replaceChildren(){this.children=[];}};}
 const render=runInNewContext(source.slice(source.indexOf('function renderStationSlider('),source.indexOf('list=function()'))+';renderStationSlider;',{document:{createElement:node},openStationPopup:(code,options)=>openings.push({code,autoAdd:options.autoAdd})}),track=node();
 render(track,[{name:'Community Radio',listener_code:'13',logo_url:'/artwork/logo.png'}],'No stations');
 const item=track.children[0],button=item.children[0],[image,name]=button.children;
 assert.equal(item.children.length,1);assert.equal(button.tagName,'BUTTON');assert.equal(button.type,'button');assert.equal(button.attrs['aria-haspopup'],'dialog');assert.equal(button.attrs['aria-label'],'Community Radio — add to your radio');assert.equal(image.alt,'');assert.equal(name.textContent,'Community Radio');assert.equal(name.parent,button);
 function tap(target){for(let element=target;element;element=element.parent)element.onclick?.({target});}
 tap(name);assert.deepEqual(openings,[{code:'13',autoAdd:true}]);
 tap(image);assert.deepEqual(openings,[{code:'13',autoAdd:true},{code:'13',autoAdd:true}]);
});

test('saved tiles open their station without automatic addition and names remain literal text',()=>{
 const openings=[];
 function node(tagName='div'){return {tagName:tagName.toUpperCase(),children:[],attrs:{},setAttribute(key,value){this.attrs[key]=value;},removeAttribute(key){delete this.attrs[key];},append(...children){this.children.push(...children);},replaceChildren(){this.children=[];}};}
 const render=runInNewContext(source.slice(source.indexOf('function renderStationSlider('),source.indexOf('list=function()'))+';renderStationSlider;',{document:{createElement:node},openStationPopup:(code,options)=>openings.push({code,autoAdd:options.autoAdd})}),track=node(),station={name:'<b>Local Radio</b>',listener_code:'14'};
 render(track,[station],'No stations',true);const button=track.children[0].children[0];
 assert.equal(button.attrs['aria-label'],'<b>Local Radio</b> — on your radio');assert.equal(button.children[1].textContent,station.name);assert.equal(button.children[1].innerHTML,undefined);
 button.onclick();assert.deepEqual(openings,[{code:'14',autoAdd:false}]);
});

test('unlinked station lists omit repeated connection instructions but retain useful linked-radio hints',()=>{
 for(const {radio,inventory,expected} of [{radio:'',inventory:null,expected:''},{radio:'one',inventory:{known:false,unavailable:true},expected:'Saved stations could not be checked. Try refreshing your radio status.'},{radio:'one',inventory:{known:false},expected:'Saved list updates after a radio software update.'}]){
  const nodes=new Map(),$=id=>{if(!nodes.has(id))nodes.set(id,{value:'',hidden:false,textContent:''});return nodes.get(id);};
  const context={$,stations:[],readSelectedRadio:()=>radio,readRadioInventory:()=>inventory,loadRadioInventory(){},renderStationSlider(){}};
  const list=runInNewContext('let stationListSnapshot="",list;'+source.slice(source.indexOf('list=function()'),source.indexOf("$('search').oninput=list;"))+';list;',context);list();assert.equal($('stationInventoryHelp').textContent,expected);assert.equal($('stationInventoryHelp').hidden,!expected);
 }
});

test('an unchecked saved snapshot stays in its saved section instead of silently becoming an automatic-add tile',()=>{
 const nodes=new Map(),rendered=[],$=id=>{if(!nodes.has(id))nodes.set(id,{value:'',hidden:false,textContent:''});return nodes.get(id);};
 const context={$,stations:[{listener_code:'13',name:'Saved Radio'},{listener_code:'14',name:'Available Radio'}],readSelectedRadio:()=>'one',readRadioInventory:()=>({known:true,stale:true,unavailable:true,codes:new Set(['13'])}),loadRadioInventory(){},renderStationSlider(track,found,empty,saved){rendered.push({track,found,saved});}};
 const list=runInNewContext('let stationListSnapshot="",list;'+source.slice(source.indexOf('list=function()'),source.indexOf("$('search').oninput=list;"))+';list;',context);list();assert.equal($('savedStationsSection').hidden,false);assert.equal($('stationInventoryHelp').textContent,'Saved stations not checked. Showing the last known list.');assert.deepEqual(Array.from(rendered[0].found,s=>s.listener_code),['13']);assert.equal(rendered[0].saved,true);assert.deepEqual(Array.from(rendered[1].found,s=>s.listener_code),['14']);
});

function searchFixture({known=true,codes=['13'],stations=[{name:'Local Radio',listener_code:'13'},{name:'Morning News',listener_code:'14'}],directory=null,metadata=new Map()}={}){
 const nodes=new Map(),openings=[],focusCalls=[];
 function node(tagName='div'){return {tagName:tagName.toUpperCase(),children:[],attrs:{},value:'',hidden:false,textContent:'',setAttribute(key,value){this.attrs[key]=value;},removeAttribute(key){delete this.attrs[key];},append(...children){this.children.push(...children);},replaceChildren(){this.children=[];},focus(options){focusCalls.push({id:this.id,options});}};}
 const $=id=>{if(!nodes.has(id)){const element=node();element.id=id;nodes.set(id,element);}return nodes.get(id);};
 const context={$,document:{createElement:node},stations,readSelectedRadio:()=>known?'radio':'',readRadioInventory:()=>known?{known:true,codes:new Set(codes)}:null,loadRadioInventory(){},openStationPopup:(code,options)=>openings.push({code,options})};
 if(directory){context.readStationDirectoryState=()=>directory;context.getStationDirectoryStation=code=>metadata.get(code);}
 runInNewContext('let stationListSnapshot="",list;'+source.slice(source.indexOf('function renderStationSlider('),source.indexOf('const libraryHelp=')),context);
 return {$,openings,focusCalls,search(query){$('search').value=query;$('search').oninput();},names(id){return $(id).children.filter(item=>item.className==='station-slider-item').map(item=>item.children[0].children[1].textContent);}};
}

test('Clear search appears only when a real query matches neither saved nor available stations',()=>{
 const f=searchFixture();
 for(const query of ['', '   ', 'LOCAL', 'News', '13', '14']){f.search(query);assert.equal(f.$('clearStationSearch').hidden,true,query);}
 f.search('missing station');assert.equal(f.$('clearStationSearch').hidden,false);assert.deepEqual(f.names('savedStations'),[]);assert.deepEqual(f.names('stations'),[]);
 f.search('news');assert.equal(f.$('clearStationSearch').hidden,true);assert.deepEqual(f.names('stations'),['Morning News']);
 assert.deepEqual(f.openings,[],'searching never issues a station action');
});

test('Clear search restores both lists and returns focus without scrolling or adding a station',()=>{
 const f=searchFixture();f.search('no match');f.$('clearStationSearch').onclick();
 assert.equal(f.$('search').value,'');assert.equal(f.$('clearStationSearch').hidden,true);assert.deepEqual(f.names('savedStations'),['Local Radio']);assert.deepEqual(f.names('stations'),['Morning News']);
 assert.equal(f.focusCalls.length,1);assert.equal(f.focusCalls[0].id,'search');assert.equal(f.focusCalls[0].options.preventScroll,true);assert.deepEqual(f.openings,[]);
});

test('Clear search works before a radio has been linked',()=>{
 const f=searchFixture({known:false});f.search('not found');assert.equal(f.$('clearStationSearch').hidden,false);f.$('clearStationSearch').onclick();
 assert.deepEqual(f.names('stations'),['Local Radio','Morning News']);assert.equal(f.$('savedStationsSection').hidden,true);assert.equal(f.$('clearStationSearch').hidden,true);assert.deepEqual(f.openings,[]);
});

test('station search accepts pasted # codes and matches accents without changing visible names',()=>{
 const f=searchFixture({stations:[{name:'Radio Étoile',listener_code:'13'},{name:'Espérance FM',listener_code:'14'}]});
 for(const code of ['13','#13',' # 13 ']){f.search(code);assert.deepEqual(f.names('savedStations'),['Radio Étoile']);assert.equal(f.$('clearStationSearch').hidden,true);}
 f.search('etoile');assert.deepEqual(f.names('savedStations'),['Radio Étoile']);f.search('ESPERANCE');assert.deepEqual(f.names('stations'),['Espérance FM']);f.search('espérance');assert.deepEqual(f.names('stations'),['Espérance FM']);assert.deepEqual(f.openings,[]);
});

test('known-empty saved stations do not consume a section and no-result searches still offer Clear search',()=>{
 const f=searchFixture({codes:[]});f.search('');assert.equal(f.$('savedStationsSection').hidden,true);assert.deepEqual(f.names('stations'),['Local Radio','Morning News']);f.search('no match');assert.equal(f.$('savedStationsSection').hidden,true);assert.equal(f.$('clearStationSearch').hidden,false);f.$('clearStationSearch').onclick();assert.equal(f.$('savedStationsSection').hidden,true);assert.deepEqual(f.names('stations'),['Local Radio','Morning News']);
});

test('incomplete server searches never claim that no stations match or offer a misleading Clear search',()=>{
 const directory={query:'rare',loadedQuery:'rare',loading:true,hasMore:true},f=searchFixture({known:false,stations:[],directory});f.search('rare');
 assert.equal(f.$('clearStationSearch').hidden,true);assert.equal(f.$('stations').children[0].textContent,'Loading stations…');
 directory.loading=false;f.search('rare');assert.equal(f.$('clearStationSearch').hidden,true);assert.equal(f.$('stations').children[0].textContent,'More stations may match. Load more to continue.');
 directory.hasMore=false;f.search('rare');assert.equal(f.$('clearStationSearch').hidden,false);assert.equal(f.$('stations').children[0].textContent,'No matching available stations.');
});

test('saved rows keep cached station names and thumbnails after the available search changes',()=>{
 const directory={query:'local',loadedQuery:'local',loading:false,hasMore:false},metadata=new Map([['13',{name:'Local Radio',listener_code:'13',logo_url:'/artwork/local.png',logo_thumb_url:'/artwork/local.png?size=192'}]]),f=searchFixture({stations:[{name:'Morning News',listener_code:'14'}],directory,metadata});f.search('local');
 assert.deepEqual(f.names('savedStations'),['Local Radio']);const image=f.$('savedStations').children[0].children[0].children[0];assert.equal(image.src,'/artwork/local.png?size=192');assert.equal(f.$('savedStationsSection').hidden,false);
});

test('ZIP and category filter only available stations while unclassified saved stations remain accessible',()=>{
 const directory={query:'',loadedQuery:'',zip_code:'10960',loadedZipCode:'10960',category:'music',loadedCategory:'music',loading:false,hasMore:false},f=searchFixture({directory,stations:[{name:'Saved Radio',listener_code:'13'},{name:'Nyack Music',listener_code:'14',zip_code:'10960',category:'music'},{name:'Nearby Music',listener_code:'15',zip_code:'10989',category:'music'},{name:'Local News',listener_code:'16',zip_code:'10960',category:'news_talk'},{name:'Unclassified',listener_code:'17'}]});
 f.search('');assert.deepEqual(f.names('savedStations'),['Saved Radio']);assert.deepEqual(f.names('stations'),['Nyack Music','Nearby Music'],'server-returned nearby ZIP results stay visible');
 f.search('saved');assert.deepEqual(f.names('savedStations'),['Saved Radio']);assert.deepEqual(f.names('stations'),[]);assert.equal(f.$('savedStationsSection').hidden,false);
});

test('changing filters hides stale available results while keeping saved items and accurate loading feedback',()=>{
 const directory={query:'',loadedQuery:'',zip_code:'00501',loadedZipCode:'10960',category:'',loadedCategory:'',loading:true,hasMore:false},f=searchFixture({directory,stations:[{name:'Saved Radio',listener_code:'13'},{name:'Old filtered radio',listener_code:'14',zip_code:'10960'}]});
 f.search('');assert.deepEqual(f.names('savedStations'),['Saved Radio']);assert.deepEqual(f.names('stations'),[]);assert.equal(f.$('stations').children[0].textContent,'Loading stations…');
 directory.loading=false;directory.loadedZipCode='00501';f.search('');assert.deepEqual(f.names('stations'),['Old filtered radio'],'a response bound to the new ZIP is trusted even when result postal codes differ');assert.deepEqual(f.openings,[]);
});

function popupShareFixture({load=async()=>{},afterMetadata=async()=>{}}={}){
 const ids=new Map(),shares=[],opened=[],statuses=[],popup={children:[],open:false,append(node){this.children.push(node);},querySelector(selector){return this.children.find(node=>selector==='.station-popup-share'&&node.className?.includes('station-popup-share'))||null;},showModal(){this.open=true;}};
 const $=id=>{if(!ids.has(id))ids.set(id,{dataset:{},hidden:false,textContent:''});return ids.get(id);};
 const context={shareRunning:false,stationPopup:popup,$,stations:[],location:{origin:'https://radiolocals.com'},shareButton:(...args)=>{shares.push(args);const button={remove(){popup.children.splice(popup.children.indexOf(button),1);}};return button;},setSharedStatus:(...args)=>statuses.push(args),openShared:async(...args)=>{opened.push(args.slice(0,3));await load(...args);const station={name:'Saved Local Radio '+args[0],listener_code:args[0]};$('shareName').textContent=station.name;args[3]?.(station);await afterMetadata(...args);}};
 const open=runInNewContext('let stationPopupGeneration=0;'+source.slice(source.indexOf('async function openStationPopup('))+';openStationPopup;',context);
 return {open,$,popup,shares,opened,statuses,shareButtons:()=>popup.children.filter(node=>node.className?.includes('station-popup-share'))};
}

test('a valid station receives one popup Share action even without any loaded catalog or saved metadata',async()=>{
 const f=popupShareFixture();await f.open('13');assert.equal(f.popup.open,true);assert.equal(f.shares.length,1);assert.equal(f.shares[0][1],'Saved Local Radio 13');assert.equal(f.shares[0][2],'https://radiolocals.com/station/13');assert.deepEqual(f.opened,[['13',true,false]]);assert.equal(f.shareButtons().length,1);assert.equal(f.shareButtons()[0].textContent,'Share station');
 await f.open('14');assert.equal(f.shareButtons().length,1,'Opening another station replaces the previous popup Share');assert.equal(f.shares[1][2],'https://radiolocals.com/station/14');
});

test('late station loads cannot append Share to a closed popup or replace a newer station action',async()=>{
 let resolve;const pending=new Promise(done=>{resolve=done;}),closed=popupShareFixture({load:()=>pending});const opening=closed.open('13');closed.popup.open=false;closed.$('shared').hidden=true;resolve();await opening;assert.equal(closed.shareButtons().length,0);
 let oldResolve;const old=new Promise(done=>{oldResolve=done;}),current=popupShareFixture({load:code=>code==='13'?old:Promise.resolve()});const first=current.open('13');await current.open('14');oldResolve();await first;assert.equal(current.shareButtons().length,1);assert.equal(current.shares.length,1);assert.equal(current.shares[0][2],'https://radiolocals.com/station/14');
});

test('a station that fails validation never receives a popup Share action',async()=>{
 const f=popupShareFixture({load:async()=>{throw Error('Station not found.');}});await f.open('13');assert.equal(f.shareButtons().length,0);assert.equal(f.shares.length,0);assert.deepEqual(f.statuses.at(-1),['Station not found.','error']);
});

test('public popup sharing remains available when private radio status fails after metadata loaded',async()=>{
 const f=popupShareFixture({afterMetadata:async()=>{throw Error('Radio status could not load.');}});await f.open('13');assert.equal(f.shareButtons().length,1);assert.equal(f.shares[0][2],'https://radiolocals.com/station/13');assert.deepEqual(f.statuses.at(-1),['Radio status could not load.','error']);
});
