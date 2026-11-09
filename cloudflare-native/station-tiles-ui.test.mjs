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

test('unlinked station lists omit repeated connection instructions but retain useful linked-radio hints',()=>{
 for(const {radio,inventory,expected} of [{radio:'',inventory:null,expected:''},{radio:'one',inventory:{known:false,unavailable:true},expected:'Saved stations could not be checked. Try refreshing your radio status.'},{radio:'one',inventory:{known:false},expected:'Saved list updates after a radio software update.'}]){
  const nodes=new Map(),$=id=>{if(!nodes.has(id))nodes.set(id,{value:'',hidden:false,textContent:''});return nodes.get(id);};
  const context={$,stations:[],readSelectedRadio:()=>radio,readRadioInventory:()=>inventory,loadRadioInventory(){},renderStationSlider(){}};
  const list=runInNewContext('let stationListSnapshot="",list;'+source.slice(source.indexOf('list=function()'),source.indexOf("$('search').oninput=list;"))+';list;',context);list();assert.equal($('stationInventoryHelp').textContent,expected);assert.equal($('stationInventoryHelp').hidden,!expected);
 }
});
