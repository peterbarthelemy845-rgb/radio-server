import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
const source=readFileSync(new URL('./public/assets/directory-news.js',import.meta.url),'utf8');

test('failed station images fall back once without making broken-image retry loops',()=>{
 function node(){let src;return {children:[],srcWrites:[],setAttribute(){},append(...children){this.children.push(...children);},replaceChildren(){this.children=[];},get src(){return src;},set src(value){src=value;this.srcWrites.push(value);}};}
 const render=runInNewContext(source.slice(source.indexOf('function renderStationSlider('),source.indexOf('list=function()'))+';renderStationSlider;',{document:{createElement:node}}),track=node();
 render(track,[{name:'Station',listener_code:'13',logo_url:'/artwork/missing.png'}],'No stations');const image=track.children[0].children[0].children[0];
 image.onerror?.();assert.equal(image.src,'/assets/logo-placeholder.svg');assert.equal(image.onerror,null);image.onerror?.();assert.deepEqual(image.srcWrites,['/artwork/missing.png','/assets/logo-placeholder.svg']);
});

test('artwork and its visible name form one button and either tap starts one automatic add',()=>{
 const openings=[];
 function node(tagName='div'){return {tagName:tagName.toUpperCase(),children:[],attrs:{},setAttribute(key,value){this.attrs[key]=value;},append(...children){for(const child of children){child.parent=this;this.children.push(child);}},replaceChildren(){this.children=[];}};}
 const render=runInNewContext(source.slice(source.indexOf('function renderStationSlider('),source.indexOf('list=function()'))+';renderStationSlider;',{document:{createElement:node},openStationPopup:(code,options)=>openings.push({code,autoAdd:options.autoAdd})}),track=node();
 render(track,[{name:'Community Radio',listener_code:'13',logo_url:'/artwork/logo.png'}],'No stations');
 const item=track.children[0],button=item.children[0],[image,name]=button.children;
 assert.equal(item.children.length,1);assert.equal(button.tagName,'BUTTON');assert.equal(button.type,'button');assert.equal(button.attrs['aria-haspopup'],'dialog');assert.equal(button.attrs['aria-label'],'Community Radio — add to your radio');assert.equal(image.alt,'');assert.equal(name.textContent,'Community Radio');assert.equal(name.parent,button);
 function tap(target){for(let element=target;element;element=element.parent)element.onclick?.({target});}
 tap(name);assert.deepEqual(openings,[{code:'13',autoAdd:true}]);
 tap(image);assert.deepEqual(openings,[{code:'13',autoAdd:true},{code:'13',autoAdd:true}]);
});

test('saved tiles keep their add-again label and station names remain literal text',()=>{
 function node(tagName='div'){return {tagName:tagName.toUpperCase(),children:[],attrs:{},setAttribute(key,value){this.attrs[key]=value;},append(...children){this.children.push(...children);},replaceChildren(){this.children=[];}};}
 const render=runInNewContext(source.slice(source.indexOf('function renderStationSlider('),source.indexOf('list=function()'))+';renderStationSlider;',{document:{createElement:node}}),track=node(),station={name:'<b>Local Radio</b>',listener_code:'14'};
 render(track,[station],'No stations',true);const button=track.children[0].children[0];
 assert.equal(button.attrs['aria-label'],'<b>Local Radio</b> — add again to your radio');assert.equal(button.children[1].textContent,station.name);assert.equal(button.children[1].innerHTML,undefined);
});

test('unlinked station lists omit repeated connection instructions but retain useful linked-radio hints',()=>{
 for(const {radio,inventory,expected} of [{radio:'',inventory:null,expected:''},{radio:'one',inventory:{known:false,unavailable:true},expected:'Saved stations could not be checked. Try refreshing your radio status.'},{radio:'one',inventory:{known:false},expected:'Saved list updates after a radio software update.'}]){
  const nodes=new Map(),$=id=>{if(!nodes.has(id))nodes.set(id,{value:'',hidden:false,textContent:''});return nodes.get(id);};
  const context={$,stations:[],readSelectedRadio:()=>radio,readRadioInventory:()=>inventory,loadRadioInventory(){},renderStationSlider(){}};
  const list=runInNewContext('let stationListSnapshot="",list;'+source.slice(source.indexOf('list=function()'),source.indexOf("$('search').oninput=list;"))+';list;',context);list();assert.equal($('stationInventoryHelp').textContent,expected);assert.equal($('stationInventoryHelp').hidden,!expected);
 }
});
