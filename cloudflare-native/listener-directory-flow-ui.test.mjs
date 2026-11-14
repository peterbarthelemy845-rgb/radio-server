import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
const directory=readFileSync(new URL('./public/assets/directory-news.js',import.meta.url),'utf8');
const radio=readFileSync(new URL('./public/assets/my-radio.js',import.meta.url),'utf8');

test('pagination announces results without moving focus, and Skip to stations is an explicit keyboard action',()=>{
 const nodes=new Map(),handlers=new Map(),focus=[],observers=[];
 const node=()=>({children:[],hidden:false,dataset:{},attributes:{},setAttribute(key,value){this.attributes[key]=value;},append(...items){this.children.push(...items);},before(item){this.beforeNode=item;},focus(){focus.push(this);},scrollIntoView(){this.scrolled=true;}});
 const $=id=>{if(!nodes.has(id))nodes.set(id,node());return nodes.get(id);};$('myRadio').hidden=false;$('savedStationsSection').hidden=true;
 const context={$,document:{hidden:false,createElement:node},window:{addEventListener(type,handler){handlers.set(type,handler);}},MutationObserver:class{constructor(fn){observers.push(fn);}observe(){}}};
 runInNewContext(directory.slice(directory.indexOf('// Results are announced once'),directory.indexOf("window.addEventListener('radio-locals-ready'")),context);
 context.window.onStationDirectoryComplete({query:'voix',hasMore:true,append:true});assert.equal(focus.length,0);assert.match($('library').children[0].textContent,/More available/);
 const skip=$('library').beforeNode;assert.equal(skip.textContent,'Skip to stations');skip.onclick({preventDefault(){}});assert.equal(focus.at(-1),$('availableStationsTitle'));assert.equal($('availableStationsTitle').attributes.tabindex,'-1');
 $('savedStationsSection').hidden=false;skip.onclick({preventDefault(){}});assert.equal(focus.at(-1),$('savedStationsTitle'));assert.equal($('savedStationsTitle').scrolled,true);
 $('library').hidden=true;observers[0]();assert.equal(skip.hidden,true);
});

test('online artwork recovery waits for the visible Radio page and retries the existing images once',()=>{
 const nodes=new Map(),handlers=new Map();let retries=0;const node=()=>({children:[],hidden:false,dataset:{},setAttribute(){},append(...items){this.children.push(...items);},before(){}}),$=id=>{if(!nodes.has(id))nodes.set(id,node());return nodes.get(id);};
 $('stations').children=[{children:[{children:[{retryArtwork(){retries++;}}]}]}];$('myRadio').hidden=true;
 const context={$,document:{hidden:false,createElement:node},window:{addEventListener(type,fn){handlers.set(type,fn);}},MutationObserver:class{observe(){}}};
 runInNewContext(directory.slice(directory.indexOf('// Results are announced once'),directory.indexOf("window.addEventListener('radio-locals-ready'")),context);
 handlers.get('online')();assert.equal(retries,0);$('myRadio').hidden=false;runInNewContext('retryStationArtwork()',context);assert.equal(retries,1);runInNewContext('retryStationArtwork()',context);assert.equal(retries,1);
});

test('station destination beside the tiles follows the selected linked radio without a second chooser',()=>{
 const handlers=new Map(),nodes=new Map(),views=new Map();let selected='one';
 const $=id=>{if(!nodes.has(id))nodes.set(id,{hidden:false,before(item){this.beforeNode=item;}});return nodes.get(id);};
 const context={$,document:{createElement(){return {hidden:false,setAttribute(){}};}},window:{addEventListener(type,fn){handlers.set(type,fn);}},radioCardViews:views,readSelectedRadio:()=>selected};
 runInNewContext(radio.slice(radio.indexOf('let stationDestination;'),radio.indexOf('function markRadioStatusUnavailable(')),context);
 views.set('one',{radio:{id:'one',device_code:'3961'}});views.set('two',{radio:{id:'two',device_code:'2847'}});handlers.get('radio-status-updated')();const destination=$('stationSearchControls').beforeNode;assert.equal(destination.textContent,'Adding to Device Code 3961');assert.equal(destination.hidden,false);
 selected='two';handlers.get('radio-selection-changed')();assert.equal(destination.textContent,'Adding to Device Code 2847');assert.equal($('stationSearchControls').beforeNode,destination);
 selected='';handlers.get('radio-selection-changed')();assert.equal(destination.textContent,'Choose a Device Code above.');views.clear();handlers.get('radio-status-updated')();assert.equal(destination.hidden,true);
});
