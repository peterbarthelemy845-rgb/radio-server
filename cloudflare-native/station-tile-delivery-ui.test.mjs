import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';

const directory=readFileSync(new URL('./public/assets/directory-news.js',import.meta.url),'utf8');
const site=readFileSync(new URL('./public/assets/site.js',import.meta.url),'utf8');
const tileSource=directory.slice(directory.indexOf("let stationListSnapshot='';"),directory.indexOf('const libraryHelp='));
const listeners=directory.slice(directory.indexOf("window.addEventListener('radio-locals-ready'"),directory.indexOf('// Owner account navigation'));
const deliverySource=site.slice(site.indexOf('const stationDeliveries='),site.indexOf('let sharedOfflineRadios='));
function deferred(){let resolve;const promise=new Promise(yes=>{resolve=yes;});return {promise,resolve};}
async function until(check){for(let i=0;i<40&&!check();i++)await new Promise(setImmediate);assert.ok(check(),'Async checkpoint was not reached');}
function fixture({translation=key=>key}={}){
 const ids=new Map(),handlers=new Map(),calls=[],answers=[],refreshes=[],openings=[];let selected='one',inventory={known:true,codes:new Set()};
 const document={activeElement:null,createElement:node};
 function node(tag='div'){return {tagName:tag.toUpperCase(),children:[],attributes:{},dataset:{},value:'',hidden:false,textContent:'',scrollLeft:0,replaceCount:0,attributeWrites:0,setAttribute(key,value){this.attributes[key]=String(value);this.attributeWrites++;if(key.startsWith('data-'))this.dataset[key.slice(5)]=String(value);},removeAttribute(key){delete this.attributes[key];if(key.startsWith('data-'))delete this.dataset[key.slice(5)];},append(...children){for(const child of children){child.parent=this;this.children.push(child);}},replaceChildren(...children){this.children=children;this.replaceCount++;},focus(){document.activeElement=this;}};}
 const $=id=>{if(!ids.has(id))ids.set(id,node());return ids.get(id);};
 const window={appI18n:{t:translation},addEventListener(name,handler){const events=handlers.get(name)||[];events.push(handler);handlers.set(name,events);},dispatchEvent(event){for(const handler of handlers.get(event.type)||[])handler(event);}};
 const context={document,window,$,setTimeout(){},Event:class{constructor(type){this.type=type;}},stations:[{name:'Local Radio',listener_code:'13'},{name:'Morning News',listener_code:'14'}],readSelectedRadio:()=>selected,readRadioInventory:()=>inventory,loadRadioInventory(){},refreshRadioInventory:radio=>refreshes.push(radio),api:async(path,body)=>{calls.push({path,body});if(!answers.length)throw Error('Missing response');return await answers.shift();},delay:async()=>{},openStationPopup:(code,options)=>{openings.push({code,options});return runInNewContext('requestStationDelivery',context)(selected,code,'Local Radio');}};
 runInNewContext('let list;'+deliverySource+tileSource+listeners,context);
 const emit=(type,detail)=>window.dispatchEvent({type,detail});
 const render=()=>runInNewContext('list()',context);
 render();
 return {$,document,calls,answers,refreshes,openings,render,emit,tiles:id=>$(id).children.filter(item=>item.className==='station-slider-item').map(item=>item.children[0]),deliver(code,state,radio='one'){context.nextDelivery={key:radio+'|'+code,radioId:radio,stationCode:code,state};runInNewContext('stationDeliveries.set(nextDelivery.key,nextDelivery)',context);emit('station-delivery-changed');},clear(code,radio='one'){context.deliveryKey=radio+'|'+code;runInNewContext('stationDeliveries.delete(deliveryKey)',context);emit('station-delivery-changed');},select(radio){selected=radio;emit('radio-selection-changed');},inventory(codes){inventory={known:true,codes:new Set(codes)};emit('radio-inventory-changed',{radioId:selected});}};
}
const feedback=tile=>tile.children[2];

test('only the matching station on the selected radio says Adding during sending and pending',()=>{
 const f=fixture(),[local,news]=f.tiles('stations');
 assert.equal(feedback(local).textContent,'');assert.equal(local.attributes['aria-busy'],'false');
 f.deliver('13','sending','other');assert.equal(feedback(local).textContent,'');
 f.deliver('13','sending');assert.equal(feedback(local).textContent,'Adding…');assert.equal(feedback(local).attributes['data-i18n'],'busy.adding');assert.equal(feedback(local).attributes['aria-hidden'],'true');assert.equal(local.attributes['aria-busy'],'true');assert.equal(feedback(news).textContent,'');
 const writes=local.attributeWrites;f.deliver('13','pending');assert.equal(feedback(local).textContent,'Adding…');assert.equal(local.attributeWrites,writes,'pending poll updates do not mutate an unchanged tile');
 f.deliver('13','unconfirmed');assert.equal(feedback(local).textContent,'');assert.equal(feedback(local).attributes['data-i18n'],undefined);assert.equal(local.attributes['aria-busy'],'false');
});

test('delivery feedback keeps the existing logo/name, focus and horizontal position without rebuilding tracks',()=>{
 const f=fixture(),track=f.$('stations'),[tile]=f.tiles('stations'),[logo,name]=tile.children;track.scrollLeft=72;tile.focus();const replacements=track.replaceCount;
 f.deliver('13','sending');f.deliver('13','pending');f.clear('13');
 assert.equal(track.replaceCount,replacements);assert.equal(track.scrollLeft,72);assert.equal(f.document.activeElement,tile);assert.equal(tile.children[0],logo);assert.equal(tile.children[1],name);assert.equal(logo.width,96);assert.equal(logo.height,96);assert.equal(name.textContent,'Local Radio');assert.equal(feedback(tile).tagName,'SPAN');assert.equal(f.calls.length,0,'rendering feedback never dispatches a command');
});

test('switching selected radios clears an unrelated Adding indicator',()=>{
 const f=fixture();f.deliver('13','pending');assert.equal(feedback(f.tiles('stations')[0]).textContent,'Adding…');f.select('two');assert.equal(feedback(f.tiles('stations')[0]).textContent,'');f.select('one');assert.equal(feedback(f.tiles('stations')[0]).textContent,'Adding…');
});

test('a station moves to On your radio only after the actual inventory report, not while sending or on an acknowledgement alone',async()=>{
 const f=fixture(),added=deferred();f.answers.push({command_id:'command'},added.promise);const [tile]=f.tiles('stations'),pending=tile.onclick();
 await until(()=>f.calls.length===2);assert.equal(feedback(tile).textContent,'Adding…');assert.equal(f.tiles('savedStations').length,0);
 added.resolve({state:'added'});await pending;await new Promise(setImmediate);assert.equal(feedback(tile).textContent,'');assert.equal(f.tiles('savedStations').length,0);assert.equal(f.tiles('stations').length,2);assert.deepEqual(f.refreshes,['one']);
 f.inventory(['13']);assert.equal(f.tiles('savedStations').length,1);assert.equal(f.tiles('savedStations')[0].children[1].textContent,'Local Radio');assert.equal(f.tiles('stations').length,1);assert.equal(f.tiles('stations')[0].children[1].textContent,'Morning News');
});

test('tapping an Adding tile reuses its outstanding delivery instead of sending a duplicate command',async()=>{
 const f=fixture(),command=deferred(),added=deferred();f.answers.push(command.promise,added.promise);const [tile]=f.tiles('stations'),first=tile.onclick(),second=tile.onclick();
 assert.equal(f.openings.length,2);assert.equal(f.calls.filter(call=>call.path==='/api/phone/add').length,1);assert.equal(feedback(tile).textContent,'Adding…');
 command.resolve({command_id:'command'});await until(()=>f.calls.length===2);added.resolve({state:'added'});await Promise.all([first,second]);assert.equal(f.calls.filter(call=>call.path==='/api/phone/add').length,1);assert.equal(feedback(tile).textContent,'');
});

test('Adding feedback uses the current language while station names stay literal',()=>{
 const f=fixture({translation:key=>key==='busy.adding'?'N ap ajoute…':key});f.deliver('13','pending');const [tile]=f.tiles('stations');assert.equal(feedback(tile).textContent,'N ap ajoute…');assert.equal(tile.children[1].textContent,'Local Radio');
});
