import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';

const directory=readFileSync(new URL('./public/assets/directory-news.js',import.meta.url),'utf8');
const sharing=directory.slice(directory.indexOf('function shareButton('),directory.indexOf("let stationListSnapshot='';"));
function deferred(){let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return {promise,resolve,reject};}
function fixture({native,clipboard,url='https://radiolocals.com/station/13',standalone=false}={}){
 const events=[],copies=[],nativeCalls=[];
 class Node{
  constructor(tag){this.tag=tag;this.children=[];this.parent=null;this.attributes={};this.textContent='';this.disabled=false;}
  get isConnected(){return this===page||this===popup||!!this.parent?.isConnected;}
  get parentElement(){return this.parent;}
  setAttribute(name,value){this.attributes[name]=value;}
  removeAttribute(name){delete this.attributes[name];}
  append(...nodes){for(const node of nodes){node.remove();node.parent=this;this.children.push(node);}}
  replaceChildren(...nodes){for(const child of [...this.children])child.remove();this.append(...nodes);}
  after(node){if(!this.parent)return;node.remove();node.parent=this.parent;this.parent.children.splice(this.parent.children.indexOf(this)+1,0,node);}
  remove(){if(this.parent){this.parent.children.splice(this.parent.children.indexOf(this),1);this.parent=null;}}
  closest(selector){return selector==='dialog'?(this.tag==='dialog'?this:this.parent?.closest(selector)):null;}
  querySelector(selector){for(const child of this.children){if(selector.startsWith('.')&&child.className?.split(' ').includes(selector.slice(1)))return child;const nested=child.querySelector(selector);if(nested)return nested;}return null;}
  focus(){this.focused=true;this.onfocus?.();}
  select(){this.selected=true;}
 }
 const popup=new Node('dialog');popup.open=true;const page=new Node('section');page.hidden=false;
 const navigator={};if(native)navigator.share=async value=>{nativeCalls.push(value);return await native(value);};if(clipboard)navigator.clipboard={writeText:async value=>{copies.push(value);return await clipboard(value);}};
 const ctx={document:{createElement:tag=>new Node(tag)},$:()=>page,navigator,URL,location:{origin:'https://radiolocals.com'},shareRunning:false,crypto:{randomUUID:()=> '12345678-1234-1234-1234-123456789012'},api:async(path,body)=>{events.push({path,body});}};
 const create=runInNewContext(sharing+';shareButton;',ctx),button=create('Share station','Test station',url,{standalone});(standalone?page:popup).append(button);
 return {ctx,popup,page,button,events,copies,nativeCalls,create,feedback:()=>(standalone?page:popup).querySelector('.station-share-feedback'),click:()=>button.onclick()};
}

test('native sharing succeeds without adding fallback controls or invoking the clipboard',async()=>{
 const f=fixture({native:async()=>{},clipboard:async()=>{}});await f.click();
 assert.equal(f.nativeCalls.length,1);assert.equal(f.nativeCalls[0].url,'https://radiolocals.com/station/13');assert.equal(f.copies.length,0);assert.equal(f.feedback(),null);assert.equal(f.button.disabled,false);assert.equal(f.events[0].body.station_code,'13');
});

test('the separate tile Share action shares without opening an add flow, checking a radio or claiming a phone',async()=>{
 const f=fixture({standalone:true,native:async()=>{}});await f.click();assert.equal(f.nativeCalls.length,1);assert.equal(f.nativeCalls[0].url,'https://radiolocals.com/station/13');assert.equal(f.events.length,1);assert.equal(f.events[0].path,'/api/events');assert.equal(f.events.some(event=>event.path.startsWith('/api/phone/')),false);
});

test('standalone sharing retains its copy fallback and ignores a late response after leaving Radio',async()=>{
 const fallback=fixture({standalone:true});await fallback.click();assert.equal(fallback.feedback().children[0].children[1].value,'https://radiolocals.com/station/13');
 const native=deferred(),late=fixture({standalone:true,native:()=>native.promise});const sharing=late.click();late.page.hidden=true;native.reject(Error('Not supported'));await sharing;assert.equal(late.feedback(),null);assert.equal(late.copies.length,0);
});

test('a rendered station places Share beside the tile rather than inside its add button',async()=>{
 const f=fixture({standalone:true,native:async()=>{}}),opens=[];f.ctx.openStationPopup=(...args)=>opens.push(args);
 const render=runInNewContext(directory.slice(directory.indexOf('function renderStationSlider('),directory.indexOf('list=function()'))+';renderStationSlider;',f.ctx),track=f.ctx.document.createElement('div');f.page.append(track);render(track,[{name:'Community Radio',listener_code:'13'}],'No stations');
 const item=track.children[0],[tile,share]=item.children;assert.equal(item.children.length,2);assert.equal(tile.children[0].tag,'img');assert.equal(share.className,'station-tile-share');assert.equal(share.textContent,'Share');assert.equal(share.parentElement,item);
 await share.onclick();assert.equal(opens.length,0);assert.equal(f.events.length,1);assert.equal(f.events[0].path,'/api/events');assert.equal(f.nativeCalls.length,1);tile.onclick();assert.equal(opens.length,1);assert.equal(opens[0][1].autoAdd,true);
});

test('cancelling the native share sheet stays quiet and does not copy without permission',async()=>{
 const f=fixture({native:async()=>{throw Object.assign(Error('Cancelled'),{name:'AbortError'});},clipboard:async()=>{}});await f.click();
 assert.equal(f.copies.length,0);assert.equal(f.feedback(),null);assert.equal(f.button.disabled,false);
});

test('blocked native sharing falls back to clipboard and announces the copy',async()=>{
 const f=fixture({native:async()=>{throw Error('Blocked');},clipboard:async()=>{}});await f.click();
 assert.deepEqual(f.copies,['https://radiolocals.com/station/13']);assert.equal(f.feedback().attributes.role,'status');assert.equal(f.feedback().textContent,'Link copied');assert.equal(f.button.disabled,false);
});

test('missing or blocked sharing methods expose a selectable public station URL',async()=>{
 for(const options of [{},{clipboard:async()=>{throw Error('Denied');}},{native:async()=>{throw Error('Not supported');},clipboard:async()=>{throw Error('Denied');}}]){
  const f=fixture(options);await f.click();const feedback=f.feedback(),label=feedback.children[0],help=label.children[0],input=label.children[1];
  assert.equal(help.attributes.role,'status');assert.equal(help.textContent,'Copy this link to share the station.');assert.equal(input.readOnly,true);assert.equal(input.value,'https://radiolocals.com/station/13');assert.equal(input.focused,true);assert.equal(input.selected,true);assert.equal(f.events.length,1);assert.equal(f.button.disabled,false);
  await f.click();assert.equal(f.popup.children.filter(node=>node.className==='station-share-feedback').length,1,'Retry replaces the previous fallback');
 }
});

test('repeated clicks while sharing is pending cannot issue duplicate share or event requests',async()=>{
 const pending=deferred(),f=fixture({native:()=>pending.promise});const first=f.click();assert.equal(f.button.disabled,true);await f.click();await f.click();assert.equal(f.nativeCalls.length,1);assert.equal(f.events.length,1);pending.resolve();await first;assert.equal(f.button.disabled,false);
});

test('late failures cannot add feedback to a closed or replaced station popup',async()=>{
 for(const replace of [false,true]){
  const pending=deferred(),f=fixture({native:()=>pending.promise,clipboard:async()=>{}}),request=f.click();
  if(replace){f.button.remove();f.popup.append(f.create('Share station','Another station','https://radiolocals.com/station/14'));}else f.popup.open=false;
  pending.reject(Error('Old share failed'));await request;assert.equal(f.copies.length,0);assert.equal(f.feedback(),null);
 }
});

test('sharing cannot run during addition or disclose query parameters, codes, or external links',async()=>{
 const f=fixture();f.ctx.shareRunning=true;await f.click();assert.equal(f.events.length,0);assert.equal(f.feedback(),null);
 for(const url of ['https://other.example/station/13','https://radiolocals.com/station/13?device_code=3961','https://radiolocals.com/station/13#private','https://radiolocals.com/station/013','https://radiolocals.com/api/private']){
  const bad=fixture({url,native:async()=>{},clipboard:async()=>{}});await bad.click();assert.equal(bad.nativeCalls.length,0);assert.equal(bad.copies.length,0);assert.equal(bad.events.length,0);assert.equal(bad.feedback(),null);
 }
});
