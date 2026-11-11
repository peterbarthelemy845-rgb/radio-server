import {test} from 'node:test';import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';import {runInNewContext} from 'node:vm';
const source=readFileSync(new URL('./public/assets/popup-history.js',import.meta.url),'utf8');
function fixture(initial={screen:'radio'}){const entries=[{state:initial,url:'https://radiolocals.com/#radio'}],queue=[],listeners=[];let index=0,unhandled=0,failPush=false;
 class Event{constructor(type,options={}){this.type=type;this.cancelable=!!options.cancelable;this.defaultPrevented=false;this.stopped=false;}preventDefault(){if(this.cancelable)this.defaultPrevented=true;}stopImmediatePropagation(){this.stopped=true;}}
 const window={addEventListener(name,fn,capture){if(name==='popstate')listeners.push({fn,capture});}},location={href:entries[0].url};
 function move(offset){const next=index+offset;if(next<0||next>=entries.length)return;index=next;location.href=entries[index].url;const event=new Event('popstate');event.state=entries[index].state;for(const {fn} of listeners.filter(item=>item.capture)){fn(event);if(event.stopped)return;}for(const {fn} of listeners.filter(item=>!item.capture)){fn(event);if(event.stopped)return;}unhandled++;}
 const history={get state(){return entries[index].state;},pushState(state,_,url){if(failPush)throw Error('History unavailable');entries.splice(index+1);entries.push({state:structuredClone(state),url});index++;},replaceState(state,_,url){entries[index]={state:structuredClone(state),url};},back(){queue.push(()=>move(-1));},forward(){queue.push(()=>move(1));},go(offset){queue.push(()=>move(offset));}};
 class Dialog{constructor(id=''){this.id=id;this.open=false;this.listeners={};this.returnValue='';}showModal(){if(this.open)throw Error('Already open');this.open=true;}addEventListener(name,fn,options={}){(this.listeners[name]??=[]).push({fn,once:options.once});}dispatchEvent(event){for(const item of [...(this.listeners[event.type]||[])]){item.fn(event);if(item.once)this.listeners[event.type]=this.listeners[event.type].filter(value=>value!==item);}return !event.defaultPrevented;}close(value=''){this.open=false;this.returnValue=value;queue.push(()=>this.dispatchEvent(new Event('close')));}}
 const ctx={window,HTMLDialogElement:Dialog,history,location,Event,Map};runInNewContext(source,ctx);
 function flush(){for(let n=0;queue.length;n++){if(n>30)throw Error('History loop');queue.shift()();}}
 return {ctx,window,history,entries,Dialog,flush,failPush(){failPush=true;},index:()=>index,unhandled:()=>unhandled};}
test('Back closes the current popup without leaving the page or overwriting application history state',()=>{
 const f=fixture(),dialog=new f.Dialog('verify');dialog.showModal();assert.equal(f.index(),1);assert.equal(f.history.state.screen,'radio');f.history.back();f.flush();assert.equal(dialog.open,false);assert.equal(dialog.returnValue,'cancelled');assert.equal(f.index(),0);assert.equal(f.unhandled(),0);assert.equal(f.history.state.screen,'radio');
});
test('a popup Close consumes its own history entry and never closes a later popup',()=>{
 const f=fixture(),first=new f.Dialog('first');first.showModal();first.close();f.flush();assert.equal(f.index(),0);assert.equal(f.unhandled(),0);const next=new f.Dialog('next');next.showModal();assert.equal(next.open,true);assert.equal(f.index(),1);f.history.back();f.flush();assert.equal(next.open,false);assert.equal(f.index(),0);
});
test('a protected busy cancellation restores its history position without extra popup entries',()=>{
 const f=fixture(),dialog=new f.Dialog('delete');let busy=true,cancels=0;dialog.addEventListener('cancel',event=>{cancels++;if(busy)event.preventDefault();});dialog.showModal();const token=f.history.state.appDialog.token;f.history.back();f.flush();assert.equal(dialog.open,true);assert.equal(f.index(),1);assert.equal(f.history.state.appDialog.token,token);assert.equal(f.entries.length,2);assert.equal(f.unhandled(),0);busy=false;f.history.back();f.flush();assert.equal(dialog.open,false);assert.equal(f.index(),0);assert.equal(cancels,2);
});
test('Forward after dismissal never reopens or replays an approval action',()=>{
 const f=fixture(),dialog=new f.Dialog('approve');let approvals=0;dialog.addEventListener('submit',()=>approvals++);dialog.showModal();f.history.back();f.flush();f.history.forward();f.flush();assert.equal(dialog.open,false);assert.equal(approvals,0);assert.equal(f.history.state.appDialog,undefined);assert.equal(f.history.state.screen,'radio');assert.equal(f.unhandled(),0);
});
test('nested popups close from the top and preserve the still-open parent entry',()=>{
 const f=fixture(),parent=new f.Dialog('parent'),child=new f.Dialog('child');parent.showModal();const parentToken=f.history.state.appDialog.token;child.showModal();assert.equal(f.index(),2);f.history.back();f.flush();assert.equal(child.open,false);assert.equal(parent.open,true);assert.equal(f.index(),1);assert.equal(f.history.state.appDialog.token,parentToken);parent.close();f.flush();assert.equal(f.index(),0);assert.equal(f.unhandled(),0);
});
test('explicitly closing a nested child consumes only the child entry',()=>{
 const f=fixture(),parent=new f.Dialog('parent'),child=new f.Dialog('child');parent.showModal();child.showModal();child.close();f.flush();assert.equal(f.index(),1);assert.equal(parent.open,true);f.history.back();f.flush();assert.equal(parent.open,false);assert.equal(f.index(),0);assert.equal(f.unhandled(),0);
});

test('verification-to-success replacement before the asynchronous close event leaves no ghost history entry',()=>{
 const f=fixture(),verification=new f.Dialog('verification'),success=new f.Dialog('success');verification.showModal();verification.close();success.showModal();f.flush();assert.equal(success.open,true);assert.equal(f.index(),1);assert.equal(f.entries.length,2);assert.equal(f.history.state.appDialog.id,'success');success.close();f.flush();assert.equal(f.index(),0);assert.equal(f.unhandled(),0);
});

test('reopening the same stream dialog before its old close event preserves the new popup and its Back entry',()=>{
 const f=fixture({screen:'register',radioLocalsApp:{page:'register'}}),dialog=new f.Dialog('streamSetupDialog');dialog.showModal();const oldToken=f.history.state.appDialog.token;dialog.close('saved');dialog.showModal();const currentToken=f.history.state.appDialog.token;assert.notEqual(currentToken,oldToken);assert.equal(f.entries.length,2,'The obsolete popup marker is replaced, not stacked');f.flush();
 assert.equal(dialog.open,true);assert.equal(f.index(),1);assert.equal(f.history.state.appDialog.token,currentToken);assert.equal(f.unhandled(),0);f.history.back();f.flush();assert.equal(dialog.open,false);assert.equal(dialog.returnValue,'cancelled');assert.equal(f.index(),0);assert.equal(f.history.state.radioLocalsApp.page,'register');assert.equal(f.unhandled(),0);
 dialog.showModal();dialog.close('cancelled');f.flush();assert.equal(f.index(),0,'The current opening still has a working close listener');assert.equal(f.unhandled(),0);
});

test('same-dialog close, reopen and close before queued events consumes one marker without replaying anything',()=>{
 const f=fixture(),dialog=new f.Dialog('streamSetupDialog');dialog.showModal();dialog.close('saved');dialog.showModal();dialog.close('cancelled');f.flush();assert.equal(dialog.open,false);assert.equal(f.index(),0);assert.equal(f.unhandled(),0);assert.equal(f.entries.length,2);f.history.forward();f.flush();assert.equal(dialog.open,false);assert.equal(f.history.state.appDialog,undefined);assert.equal(f.unhandled(),0);
});

test('reopening a nested child before its queued close preserves the parent and uses only one child marker',()=>{
 const f=fixture(),parent=new f.Dialog('parent'),child=new f.Dialog('streamSetupDialog');parent.showModal();const parentToken=f.history.state.appDialog.token;child.showModal();child.close();child.showModal();f.flush();assert.equal(parent.open,true);assert.equal(child.open,true);assert.equal(f.index(),2);assert.equal(f.entries.length,3);f.history.back();f.flush();assert.equal(child.open,false);assert.equal(parent.open,true);assert.equal(f.history.state.appDialog.token,parentToken);f.history.back();f.flush();assert.equal(parent.open,false);assert.equal(f.index(),0);assert.equal(f.unhandled(),0);
});

test('reopening a closed parent above a still-open child makes the latest opening the active popup',()=>{
 const f=fixture(),parent=new f.Dialog('parent'),child=new f.Dialog('child');parent.showModal();child.showModal();const childToken=f.history.state.appDialog.token;parent.close();parent.showModal();f.flush();assert.equal(parent.open,true);assert.equal(child.open,true);assert.equal(f.index(),3);f.history.back();f.flush();assert.equal(parent.open,false);assert.equal(child.open,true);assert.equal(f.history.state.appDialog.token,childToken);child.close();f.flush();assert.equal(f.index(),0);assert.equal(f.unhandled(),0);
});

test('a native error from repeated showModal on an already open dialog leaves its history tracking intact',()=>{
 const f=fixture(),dialog=new f.Dialog('streamSetupDialog');dialog.showModal();const token=f.history.state.appDialog.token;assert.throws(()=>dialog.showModal(),/Already open/);assert.equal(f.index(),1);assert.equal(f.entries.length,2);assert.equal(f.history.state.appDialog.token,token);f.history.back();f.flush();assert.equal(dialog.open,false);assert.equal(f.index(),0);assert.equal(f.unhandled(),0);
});

test('a closed nested parent is skipped when the last child closes or receives Back',()=>{
 for(const back of [false,true]){const f=fixture(),parent=new f.Dialog('parent'),child=new f.Dialog('child');parent.showModal();child.showModal();parent.close();f.flush();assert.equal(f.index(),2);assert.equal(child.open,true);if(back)f.history.back();else child.close();f.flush();assert.equal(child.open,false);assert.equal(f.index(),0);assert.equal(f.unhandled(),0);}
});

test('immediate close-and-replace-and-close consumes only one history entry',()=>{
 const f=fixture(),first=new f.Dialog('first'),second=new f.Dialog('second');first.showModal();first.close();second.showModal();second.close();f.flush();assert.equal(f.index(),0);assert.equal(f.unhandled(),0);
});
test('existing popup owners are excluded and reload strips only stale popup markers',()=>{
 const f=fixture({screen:'support',appDialog:{token:42,id:'old'}});assert.equal(f.history.state.appDialog,undefined);assert.equal(f.history.state.screen,'support');for(const id of ['stationAddPopup','policyPreview']){const dialog=new f.Dialog(id);dialog.showModal();assert.equal(f.index(),0);dialog.close();f.flush();}const controls=new f.Dialog('controls');f.window.radioControlsDialog=controls;controls.showModal();assert.equal(f.index(),0);controls.close();f.flush();
});
test('history push failure keeps an opened dialog usable without half-created tracking',()=>{
 const f=fixture(),dialog=new f.Dialog('working');f.failPush();assert.doesNotThrow(()=>dialog.showModal());assert.equal(dialog.open,true);assert.equal(f.index(),0);dialog.close();f.flush();assert.equal(dialog.open,false);assert.equal(f.index(),0);assert.equal(f.unhandled(),0);
});
