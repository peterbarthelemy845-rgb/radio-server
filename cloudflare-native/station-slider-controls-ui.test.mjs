import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
const source=readFileSync(new URL('./public/assets/directory-news.js',import.meta.url),'utf8');
const controls=source.slice(source.indexOf('function updateStationSliderControls('),source.indexOf("window.addEventListener('resize'"));
function fixture({rtl=false,reduced=false}={}){
 const handlers=new Map(),scrolls=[],rows=[],observers=[];
 function node(){return {attributes:{},children:[],hidden:false,disabled:false,setAttribute(key,value){this.attributes[key]=value;},append(...items){this.children.push(...items);}};}
 const track={clientWidth:300,scrollWidth:300,scrollLeft:0,before:row=>rows.push(row),addEventListener:(type,handler)=>handlers.set(type,handler),scrollBy(options){scrolls.push(options);this.scrollLeft+=options.left;handlers.get('scroll')();}};
 const update=runInNewContext(controls+';updateStationSliderControls;',{document:{createElement:node},getComputedStyle:()=>({direction:rtl?'rtl':'ltr'}),matchMedia:()=>({matches:reduced}),ResizeObserver:class{constructor(fn){observers.push(fn);}observe(){}}});
 update(track);return {track,scrolls,rows,observers,update:()=>update(track),view:track.stationSliderControls};
}
test('station arrows appear only for overflow and disable the unavailable direction',()=>{
 const f=fixture();assert.equal(f.view.row.hidden,true);f.track.scrollWidth=600;f.observers[0]();assert.equal(f.view.row.hidden,false);assert.equal(f.view.previous.disabled,true);assert.equal(f.view.next.disabled,false);assert.equal(f.view.previous.attributes['aria-label'],'Previous stations');assert.equal(f.view.next.attributes['aria-label'],'Next stations');
 f.track.scrollLeft=300;f.update();assert.equal(f.view.next.disabled,true);assert.equal(f.view.previous.disabled,false);f.track.clientWidth=600;f.observers[0]();assert.equal(f.view.row.hidden,true);assert.equal(f.rows.length,1,'resize reuses the existing controls');
});
test('station arrows advance the existing track and retain normal swipe scroll handling',()=>{
 const f=fixture();f.track.scrollWidth=700;f.update();f.view.next.onclick();assert.equal(f.scrolls[0].left,240);assert.equal(f.scrolls[0].behavior,'smooth');assert.equal(f.view.previous.disabled,false);f.view.previous.onclick();assert.equal(f.track.scrollLeft,0);assert.equal(f.view.previous.disabled,true);
});
test('RTL direction and reduced motion use matching logical navigation without animation',()=>{
 const f=fixture({rtl:true,reduced:true});f.track.scrollWidth=700;f.update();assert.equal(f.view.next.textContent,'‹');f.view.next.onclick();assert.equal(f.scrolls[0].left,-240);assert.equal(f.scrolls[0].behavior,'auto');assert.equal(f.view.previous.disabled,false);f.view.previous.onclick();assert.equal(f.track.scrollLeft,0);
});
