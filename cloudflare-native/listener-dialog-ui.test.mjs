import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
const source=readFileSync(new URL('./public/assets/listener-usability.js',import.meta.url),'utf8');
const dialogSource=source.slice(source.indexOf('const listenerDialog='),source.indexOf('const draftForms='));
function fixture(){
 const nodes=[],events=[];let showCount=0;
 function createElement(tag){const handlers=new Map(),node={tag,children:[],open:false,hidden:false,textContent:'',setAttribute(){},append(...items){this.children.push(...items);},addEventListener(name,fn,options){const list=handlers.get(name)||[];list.push({fn,once:options?.once});handlers.set(name,list);},removeEventListener(name,fn){handlers.set(name,(handlers.get(name)||[]).filter(item=>item.fn!==fn));},showModal(){if(this.failShow)throw Error('Cannot open dialog');if(!this.open){showCount++;this.open=true;}},close(value){if(!this.open)return;this.open=false;this.returnValue=value;events.push(()=>{for(const handler of [...(handlers.get('close')||[])]){if(handler.once)this.removeEventListener('close',handler.fn);handler.fn();}});},focus(){}};nodes.push(node);return node;}
 const context={document:{createElement,body:{append(){}}}};runInNewContext(dialogSource,context);
 return {open:runInNewContext('listenerActionDialog',context),dialog:nodes[0],get:expression=>runInNewContext(expression,context),close(value){nodes[0].close(value);},flush(){while(events.length)events.shift()();},showCount:()=>showCount};
}
test('a late notice cannot replace or approve an active destructive confirmation',async()=>{
 const f=fixture();let approved;const confirmation=f.open('Unlink radio?','Device B will be disconnected.','Unlink radio',true).then(result=>{approved=result;return result;});
 const notice=f.open('Radio unlinked','Device A was unlinked.');assert.equal(f.get('listenerDialogTitle').textContent,'Unlink radio?');assert.equal(await notice,false);assert.equal(f.showCount(),1);assert.equal(approved,undefined);
 f.close('cancelled');f.flush();assert.equal(await confirmation,false);
});
test('a close event queued by the browser cannot be consumed by a newer prompt',async()=>{
 const f=fixture(),first=f.open('Unlink radio?','Device A','Unlink',true);f.close('confirmed');const overlapping=f.open('Add station?','Station B','Add',true);
 assert.equal(await overlapping,false);f.flush();assert.equal(await first,true);assert.equal(f.showCount(),1);
 const next=f.open('Add station?','Station B','Add',true);assert.equal(f.showCount(),2);f.close('confirmed');f.flush();assert.equal(await next,true);
});
test('failed opening releases the prompt lock and leaves no old close handler',async()=>{
 const f=fixture();f.dialog.failShow=true;await assert.rejects(f.open('Notice','Message'),/Cannot open dialog/);f.dialog.failShow=false;
 const next=f.open('Retry','Message');f.close('confirmed');f.flush();assert.equal(await next,true);
});
