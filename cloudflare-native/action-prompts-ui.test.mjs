import {test} from 'node:test';import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';import {runInNewContext} from 'node:vm';
const source=readFileSync(new URL('./public/assets/action-prompts.js',import.meta.url),'utf8');
function fixture(){const ids=new Map(),nodes=[],events={};let document;
 function node(tag){const listeners={},item={tag,dataset:{},attributes:{},children:[],hidden:false,value:'',open:false,isConnected:true,textContent:'',focusCount:0,setAttribute(key,value){this.attributes[key]=value;},removeAttribute(key){delete this.attributes[key];},append(...children){this.children.push(...children);},addEventListener(name,fn){(listeners[name]??=[]).push(fn);},emit(name,event={}){for(const listener of listeners[name]||[])listener(event);},focus(){this.focusCount++;document.activeElement=this;},showModal(){this.open=true;},close(){this.open=false;queueMicrotask(()=>this.emit('close'));}};
  Object.defineProperty(item,'id',{set(value){ids.set(value,item);},get(){return [...ids].find(([,value])=>value===item)?.[0];}});Object.defineProperty(item,'innerHTML',{set(){throw Error('Unsafe HTML');}});nodes.push(item);return item;}
 document={createElement:node,querySelector(){return nodes.find(item=>item.tag==='dialog'&&item.open)||null;},body:node('body'),activeElement:null};const opener=node('button');document.activeElement=opener;
 const window={addEventListener(name,fn){(events[name]??=[]).push(fn);},appI18n:{t:key=>key}},ctx={window,document,Promise,Number,String};runInNewContext(source,ctx);
 return {ctx,window,events,opener,node,$:id=>ids.get(id),flush:()=>new Promise(resolve=>queueMicrotask(resolve)),submit(){ids.get('appActionForm').emit('submit',{preventDefault(){}});},cancel(){ids.get('appActionPrompt').emit('cancel');ids.get('appActionPrompt').close();}};
}
test('action sheets expose labelled accessible content, focus Cancel and never insert submitted text as HTML',async()=>{
 const f=fixture(),promise=f.window.appConfirm('Delete <station>','<img src=x onerror=alert(1)>',{confirmText:'Delete',danger:true});const dialog=f.$('appActionPrompt');assert.equal(dialog.open,true);assert.equal(dialog.attributes['aria-labelledby'],'appActionTitle');assert.equal(dialog.attributes['aria-describedby'],'appActionText');assert.equal(f.$('appActionCancel').focusCount,1);assert.equal(f.$('appActionInput').hidden,true);assert.equal(f.$('appActionText').textContent,'<img src=x onerror=alert(1)>');assert.equal(f.$('appActionAccept').className,'app-action-danger');f.$('appActionCancel').onclick();assert.equal(await promise,false);assert.equal(f.opener.focusCount,1);
});
test('only one pending decision can exist and an overlapping caller never inherits approval',async()=>{
 const f=fixture(),first=f.window.appConfirm('Approve','Confirm?');assert.equal(await f.window.appConfirm('Different','Other decision'),false);assert.equal(await f.window.appPrompt('Other','Notes'),null);assert.equal(f.$('appActionTitle').textContent,'Approve');f.submit();assert.equal(await first,true);
 const external=f.node('dialog');external.showModal();assert.equal(await f.window.appConfirm('Hidden behind another dialog','Do not open'),false);external.close();await f.flush();
});
test('required text and exact RESTORE validation keep the prompt open with a focused inline error',async()=>{
 const f=fixture(),promise=f.window.appPrompt('Restore backup','Owners and phones will be signed out. Type RESTORE.',{required:true,maxLength:7,match:'RESTORE',label:'Type RESTORE',confirmText:'Restore',danger:true}),input=f.$('appActionInput'),error=f.$('appActionError');
 f.submit();assert.equal(f.$('appActionPrompt').open,true);assert.equal(error.attributes.role,'alert');assert.equal(input.attributes['aria-invalid'],'true');assert.match(error.textContent,/Enter a value/);assert.equal(input.focusCount,1);
 input.value='WRONG';f.window.appI18n.t=key=>key==='action.match'?'Type {value} to confirm.':key;f.submit();assert.equal(error.textContent,'Type RESTORE to confirm.');assert.equal(f.$('appActionPrompt').open,true);
 input.value='TOO LONG';f.submit();assert.match(error.textContent,/Shorten/);input.value='RESTORE';input.emit('input');assert.equal(error.hidden,true);f.submit();assert.equal(await promise,'RESTORE');assert.equal(input.value,'');assert.equal(f.$('appActionForm').dataset.dirty,undefined);
});
test('Escape, browser Back and Cancel resolve no action, while dirty prompt reloads are protected',async()=>{
 const f=fixture(),promise=f.window.appPrompt('Reason','Optional notes',{maxLength:300});f.$('appActionInput').value='An unsent reason';f.$('appActionInput').emit('input');let prevented=false;const event={preventDefault(){prevented=true;}};for(const fn of f.events.beforeunload)fn(event);assert.equal(prevented,true);assert.equal(event.returnValue,'');f.cancel();assert.equal(await promise,null);
 prevented=false;for(const fn of f.events.beforeunload)fn({preventDefault(){prevented=true;}});assert.equal(prevented,false);
 const back=f.window.appPrompt('Another','Reason');f.$('appActionPrompt').close();assert.equal(await back,null);const optional=f.window.appPrompt('Optional','Reason');f.submit();assert.equal(await optional,'');
});
