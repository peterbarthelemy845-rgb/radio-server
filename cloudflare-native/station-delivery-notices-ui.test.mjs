import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
const source=readFileSync(new URL('./public/assets/site.js',import.meta.url),'utf8');
const delivery=source.slice(source.indexOf('const stationDeliveries='),source.indexOf('let sharedOfflineRadios='));
function fixture(){
 let selected='one',clock=1000;const timers=[],handlers=new Map(),nodes=new Map();
 function node(){return {hidden:false,dataset:{},children:[],textContent:'',replaceChildren(...children){this.children=children;this.textContent=children.map(child=>child.textContent).join('');}};}
 const $=id=>{if(!nodes.has(id))nodes.set(id,node());return nodes.get(id);};
 const context={document:{createElement:node},$,window:{dispatchEvent(){},addEventListener(type,handler){handlers.set(type,handler);}},Event:class{constructor(type){this.type=type;}},Date:class extends Date{static now(){return clock;}},readSelectedRadio:()=>selected,setTimeout(fn,ms){timers.push({fn,at:clock+ms});},refreshRadioInventory(){}};
 runInNewContext(delivery,context);
 return {host:$('stationDeliveryStatus'),timers,get:code=>runInNewContext(code,context),select(id){selected=id;handlers.get('radio-selection-changed')();},add(id,state='pending'){context.record={key:id+'|13',radioId:id,stationCode:'13',name:'Station '+id,state};runInNewContext('stationDeliveries.set(record.key,record);renderStationDeliveryStatus()',context);},finish(id,state='added'){context.radio=id;context.outcome=state;runInNewContext("finishStationDelivery(stationDeliveries.get(radio+'|13'),outcome,outcome==='added'?'Station added':'Could not add')",context);},advance(ms){clock+=ms;for(const timer of [...timers])if(timer.at<=clock){timers.splice(timers.indexOf(timer),1);timer.fn();}}};
}
test('pending and unconfirmed notices only describe the selected radio without deleting background work',()=>{
 const f=fixture();f.add('one');assert.match(f.host.textContent,/Station one/);f.select('two');assert.equal(f.host.hidden,true);assert.equal(f.get('stationDeliveries.size'),1);
 f.add('two','unconfirmed');assert.match(f.host.textContent,/Station two.*not confirmed/);f.select('one');assert.match(f.host.textContent,/Station one.*Adding/);assert.equal(f.get('stationDeliveries.size'),2);
});
test('completed feedback expires quietly and cannot be displayed for another selected radio',()=>{
 const f=fixture();f.add('one');f.finish('one');assert.equal(f.host.dataset.status,'success');f.select('two');assert.equal(f.host.hidden,true);f.select('one');assert.equal(f.host.hidden,false);
 f.advance(8000);assert.equal(f.host.hidden,true);assert.equal(f.get('stationDeliveryNotices.size'),0);
});
test('completed cleanup never removes another radio pending or unconfirmed delivery',()=>{
 const f=fixture();f.add('one');f.finish('one');f.select('two');f.add('two','unconfirmed');f.advance(8000);assert.equal(f.host.hidden,false);assert.equal(f.host.dataset.status,'error');assert.match(f.host.textContent,/Station two/);assert.equal(f.get('stationDeliveries.size'),1);assert.equal(f.get("stationDeliveries.get('two|13').state"),'unconfirmed');
});
test('an older completion timer cannot dismiss a newer notice for the same radio',()=>{
 const f=fixture();f.add('one');f.finish('one');f.advance(4000);f.add('one');f.finish('one','failed');f.advance(4000);assert.equal(f.host.hidden,false);assert.equal(f.host.dataset.status,'error');assert.match(f.host.textContent,/Could not add/);f.advance(4000);f.select('one');assert.equal(f.host.hidden,true);
});
