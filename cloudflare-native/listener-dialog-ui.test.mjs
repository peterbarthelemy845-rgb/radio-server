import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
const source=readFileSync(new URL('./public/assets/listener-usability.js',import.meta.url),'utf8');
const dialogSource=source.slice(source.indexOf('const listenerDialog='),source.indexOf('const draftForms='));
function fixture(){
 const nodes=[],events=[];let showCount=0;
 function createElement(tag){const handlers=new Map(),node={tag,children:[],open:false,hidden:false,textContent:'',attributes:{},setAttribute(name,value){this.attributes[name]=value;},removeAttribute(name){delete this.attributes[name];},append(...items){this.children.push(...items);},addEventListener(name,fn,options){const list=handlers.get(name)||[];list.push({fn,once:options?.once});handlers.set(name,list);},removeEventListener(name,fn){handlers.set(name,(handlers.get(name)||[]).filter(item=>item.fn!==fn));},showModal(){if(this.failShow)throw Error('Cannot open dialog');if(!this.open){showCount++;this.open=true;}},close(value){if(!this.open)return;this.open=false;this.returnValue=value;events.push(()=>{for(const handler of [...(handlers.get('close')||[])]){if(handler.once)this.removeEventListener('close',handler.fn);handler.fn();}});},focus(){}};nodes.push(node);return node;}
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

test('short notices have one Done button and no empty description while confirmations retain their choice',async()=>{
 const f=fixture(),notice=f.open('Radio connected','');assert.equal(f.get('listenerDialogText').hidden,true);assert.equal(f.dialog.attributes['aria-describedby'],undefined);assert.equal(f.get('listenerDialogCancel').hidden,true);assert.equal(f.get('listenerDialogConfirm').textContent,'Done');f.close('confirmed');f.flush();await notice;
 const confirmation=f.open('Unlink radio?','Device code 3961 will be disconnected from this phone.','Unlink radio',true);assert.equal(f.get('listenerDialogText').hidden,false);assert.equal(f.dialog.attributes['aria-describedby'],'listenerActionText');assert.equal(f.get('listenerDialogCancel').hidden,false);assert.equal(f.get('listenerDialogConfirm').textContent,'Unlink radio');f.close('cancelled');f.flush();assert.equal(await confirmation,false);
});

const draftSource=source.slice(source.indexOf('const draftForms='));
function draftFixture(){
 const forms=new Map(),events=new Map();let confirms=0;
 for(const id of ['registerForm','editForm','ticketForm','advertiseForm']){
  const handlers=new Map(),form={dataset:{},visible:false,value:'Private unsaved text',addEventListener(type,fn){handlers.set(type,fn);},getClientRects(){return this.visible?[{}]:[];},dispatch(type){handlers.get(type)?.();}};forms.set(id,form);
 }
 const context={$:id=>forms.get(id),window:{addEventListener(type,fn){events.set(type,fn);}},document:{addEventListener(type,fn){events.set(type,fn);}},confirm(){confirms++;return false;}};runInNewContext(draftSource,context);
 function event(){return {preventDefault(){this.prevented=true;},stopImmediatePropagation(){this.stopped=true;}};}
 return {forms,confirms:()=>confirms,unload(){const attempt=event();events.get('beforeunload')(attempt);return attempt;},navigate(target={tagName:'BUTTON'}){const attempt=event();attempt.target={closest:()=>target};events.get('click')?.(attempt);return attempt;}};
}

test('real reload or departure protects hidden drafts on every editable page until reset',()=>{
 for(const id of ['registerForm','editForm','ticketForm','advertiseForm']){
  const f=draftFixture(),form=f.forms.get(id);form.dispatch('input');assert.equal(form.visible,false);
  const departure=f.unload();assert.equal(departure.prevented,true,id);assert.equal(departure.returnValue,'');assert.equal(form.value,'Private unsaved text');assert.equal(form.dataset.dirty,'1');
  form.dispatch('reset');assert.equal(f.unload().prevented,undefined,id);
 }
});

test('visible and hidden drafts survive internal tabs without misleading discard prompts',()=>{
 const f=draftFixture(),form=f.forms.get('registerForm');form.dispatch('input');
 const navigation=f.navigate();assert.equal(navigation.prevented,undefined);assert.equal(f.confirms(),0);assert.equal(form.dataset.dirty,'1');assert.equal(f.unload().prevented,true);
 form.visible=true;const leavingVisible=f.navigate();assert.equal(f.confirms(),0);assert.equal(leavingVisible.prevented,undefined);assert.equal(leavingVisible.stopped,undefined);assert.equal(form.dataset.dirty,'1');assert.equal(f.unload().prevented,true);
 const newTab=f.navigate({target:'_blank'});assert.equal(newTab.prevented,undefined);assert.equal(f.confirms(),0);assert.equal(form.value,'Private unsaved text');
});
