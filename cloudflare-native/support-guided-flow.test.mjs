import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';

const source=readFileSync(new URL('./public/assets/support-guided-flow.js',import.meta.url),'utf8');
function fixture({draft={},missing=false}={}){
 const nodes=new Map(),windowEvents=new Map(),documentEvents=new Map(),observers=[],frames=[];
 let document;
 class Element{
  constructor(tag='div',id=''){this.tagName=tag.toUpperCase();this.id=id;this.dataset={};this.attrs={};this.children=[];this.hidden=false;this.textContent='';this.scrollLeft=0;this.events=new Map();this.value='';this.disabled=false;}
  set id(value){this._id=value;if(value)nodes.set(value,this);}get id(){return this._id;}
  setAttribute(key,value){this.attrs[key]=value;if(key==='src')this.src=value;}getAttribute(key){return this.attrs[key]??null;}
  remove(){if(this.parentElement){const siblings=this.parentElement.children;siblings.splice(siblings.indexOf(this),1);this.parentElement=null;}}
  append(...items){for(const item of items){item.remove();item.parentElement=this;this.children.push(item);}}
  before(item){const parent=this.parentElement;item.remove();item.parentElement=parent;parent.children.splice(parent.children.indexOf(this),0,item);}
  after(item){const parent=this.parentElement;item.remove();item.parentElement=parent;parent.children.splice(parent.children.indexOf(this)+1,0,item);}
  replaceChildren(...items){for(const item of [...this.children])item.remove();this.append(...items);}
  querySelectorAll(selector){const descendants=[];const visit=node=>{for(const child of node.children){descendants.push(child);visit(child);}};visit(this);if(selector==='video source')return descendants.filter(node=>node.tagName==='SOURCE'&&node.parentElement?.tagName==='VIDEO');return descendants.filter(node=>node.tagName===selector.toUpperCase());}
  querySelector(selector){return this.querySelectorAll(selector)[0]||null;}
  addEventListener(name,fn){const handlers=this.events.get(name)||[];handlers.push(fn);this.events.set(name,handlers);}
  dispatch(name){for(const fn of this.events.get(name)||[])fn({target:this});}
  focus(){document.activeElement=this;}scrollIntoView(options){this.lastScroll=options;}
 }
 const support=new Element('section','support'),videos=new Element('div','supportVideos'),tickets=new Element('section','supportTicketStatus'),form=new Element('form','ticketForm');form.append(new Element('h2'));form.elements={};
 for(const key of ['name','email','subject','message','device_code','station_code']){const input=new Element(key==='subject'?'select':'input');input.value=draft[key]||'';form.elements[key]=input;form.append(input);}
 if(Object.keys(draft).length)form.dataset.dirty='1';support.append(videos,tickets,form);
 const listen=(map,name,fn)=>{const handlers=map.get(name)||[];handlers.push(fn);map.set(name,handlers);};
 document={hidden:false,activeElement:null,getElementById:id=>missing&&id==='support'?null:nodes.get(id),createElement:tag=>new Element(tag),addEventListener:(name,fn)=>listen(documentEvents,name,fn)};
 const window={addEventListener:(name,fn)=>listen(windowEvents,name,fn),dispatchEvent(event){for(const fn of windowEvents.get(event.type)||[])fn(event);}};
 class UiEvent{constructor(type){this.type=type;}}
 const context=vm.createContext({document,window,Event:UiEvent,Map,WeakMap,Object,String,queueMicrotask:fn=>frames.push(fn),MutationObserver:class{constructor(fn){this.fn=fn;}observe(target,options){observers.push({fn:this.fn,target,options});}}});
 vm.runInContext(source,context);
 function emit(name){window.dispatchEvent(new UiEvent(name));}
 function guidesChanged(){emit('support-guides-ready');}
 function guide(id,title=id){const card=new Element('article'),heading=new Element('h3'),video=new Element('video'),src=new Element('source');heading.textContent=title;src.setAttribute('src','/assets/help-'+id+'.mp4');video.pauses=0;video.pause=()=>video.pauses++;video.append(src);card.append(heading,video);videos.append(card);return {card,video};}
 function remote(title,url='https://www.youtube-nocookie.com/embed/abC1234DEfg'){const card=new Element('article'),heading=new Element('h3'),frame=new Element('iframe');heading.textContent=title;frame.src=url;card.append(heading,frame);videos.append(card);return {card,frame};}
 const topic=id=>nodes.get('supportGuidedFlow')?.querySelectorAll('button').find(button=>button.dataset.supportTopic===id);
 return {nodes,support,videos,tickets,form,window,document,observers,topic,guide,remote,guidesChanged,
  choose:id=>topic(id).onclick(),contact:options=>window.supportGuidedFlow.openContact(options),render:()=>window.supportGuidedFlow.render(),
  back:()=>nodes.get('supportGuidedFlow').children[0].onclick(),flush(){while(frames.length)frames.shift()();},
  reset(){form.dispatch('reset');for(const field of Object.values(form.elements))field.value='';delete form.dataset.dirty;},
  visibility(hidden){document.hidden=hidden;for(const fn of documentEvents.get('visibilitychange')||[])fn();},
  emit,
 };
}

test('Support hides the retired problem chooser and keeps private ticket lookup accessible',()=>{
 const f=fixture(),host=f.nodes.get('supportGuidedFlow');
 assert.deepEqual(['wifi','sound','freezing','account'].map(id=>f.topic(id).textContent),['Wi-Fi','No sound','Radio freezing','Station account']);
 assert.equal(f.nodes.get('supportFlowTitle').textContent,'What’s wrong?');assert.equal(host.dataset.view,'choose');assert.equal(f.form.hidden,true);assert.equal(f.tickets.hidden,false);assert.equal(f.videos.hidden,true);
 assert.equal(f.tickets.parentElement,f.support);assert.ok(f.support.children.indexOf(f.tickets)>f.support.children.indexOf(f.form));
 assert.equal(f.form.querySelector('h2').textContent,'Contact support');assert.equal(f.nodes.get('supportFlowTitle').tabIndex,-1);
 assert.equal(f.nodes.get('supportFlowTitle').parentElement.hidden,true);
});

test('Wi-Fi shows relevant existing tutorials, hides unrelated guides, and opens a preselected contact form',()=>{
 const f=fixture(),wifi=f.guide('wifi','Connect to Wi-Fi'),station=f.guide('station','Add a station'),reset=f.guide('reset','Reset the Device Code'),approved=f.remote('Wi-Fi troubleshooting');f.guidesChanged();
 assert.equal(wifi.card.hidden,true);f.choose('wifi');assert.equal(f.nodes.get('supportGuidedFlow').dataset.view,'topic');assert.equal(f.document.activeElement,f.nodes.get('supportTopicTitle'));
 assert.equal(wifi.card.hidden,false);assert.equal(approved.card.hidden,false);assert.equal(station.card.hidden,true);assert.equal(reset.card.hidden,true);assert.equal(f.videos.hidden,false);
 const contact=f.nodes.get('supportGuidedFlow').children.at(-1);contact.onclick();assert.equal(f.form.hidden,false);assert.equal(f.form.elements.subject.value,'Wi-Fi connection problem');assert.equal(f.document.activeElement,f.form.elements.name);assert.equal(f.videos.hidden,true);assert.ok(wifi.video.pauses>0);assert.equal(approved.frame.src,'about:blank');
 f.back();assert.equal(f.form.hidden,true);assert.equal(f.videos.hidden,false);assert.equal(wifi.card.hidden,false);assert.equal(approved.frame.src,'https://www.youtube-nocookie.com/embed/abC1234DEfg');
});

test('each problem maps to an existing subject without inventing media or treating code reset as a freeze fix',()=>{
 const subjects={wifi:'Wi-Fi connection problem',sound:'No sound or playback problem',freezing:'Device keeps freezing',account:'Station login or email code problem'};
 for(const [id,subject] of Object.entries(subjects)){
  const f=fixture(),reset=f.guide('reset','Reset the Device Code'),station=f.guide('station','Add a station from the website');f.choose(id);f.guidesChanged();
  assert.equal(reset.card.hidden,true);assert.equal(station.card.hidden,true);assert.equal(f.videos.hidden,true);f.nodes.get('supportGuidedFlow').children.at(-1).onclick();assert.equal(f.form.elements.subject.value,subject);
 }
});

test('translated tutorial headings do not change the previously classified problem topic',()=>{
 const f=fixture(),approved=f.remote('No sound');f.guidesChanged();approved.card.querySelector('h3').textContent='Pa gen son';f.choose('sound');assert.equal(approved.card.hidden,false);f.choose('wifi');assert.equal(approved.card.hidden,true);
});

test('an existing ticket draft and contextual station association survive help choices and tab changes',()=>{
 const draft={name:'Listener',email:'listener@example.com',subject:'Station problem',message:'Keep my original message',station_code:'13',device_code:'1234'},f=fixture({draft});
 assert.equal(f.form.hidden,false);f.back();f.choose('sound');f.nodes.get('supportGuidedFlow').children.at(-1).onclick();
 assert.equal(f.form.elements.subject.value,draft.subject);for(const [key,value] of Object.entries(draft))assert.equal(f.form.elements[key].value,value);
 f.support.hidden=true;f.render();f.support.hidden=false;f.render();assert.equal(f.form.hidden,false);assert.equal(f.nodes.get('supportGuidedFlow').dataset.view,'contact');assert.equal(f.form.dataset.dirty,'1');
});

test('auto-selected subjects follow a new help topic until the user supplies their own choice',()=>{
 const f=fixture();f.choose('wifi');f.contact({subject:'Wi-Fi connection problem'});f.back();f.choose('sound');f.contact({subject:'No sound or playback problem'});assert.equal(f.form.elements.subject.value,'No sound or playback problem');
 f.form.elements.subject.value='Advertising question';f.form.elements.subject.dispatch('change');f.back();f.choose('freezing');f.contact({subject:'Device keeps freezing'});assert.equal(f.form.elements.subject.value,'Advertising question');
});

test('contextual contact opening retains supplied station context and does not refocus a handled report',()=>{
 const f=fixture();f.choose('wifi');f.form.elements.station_code.value='13';f.form.elements.subject.value='Station problem';f.form.elements.message.value='Station message';const previous=f.document.activeElement;
 f.contact({focus:false});assert.equal(f.form.hidden,false);assert.equal(f.form.elements.subject.value,'Station problem');assert.equal(f.form.elements.station_code.value,'13');assert.equal(f.form.elements.message.value,'Station message');assert.equal(f.document.activeElement,previous);
});

test('busy ticket submission cannot hide the form or change its selected subject through help actions',()=>{
 const f=fixture();f.choose('wifi');f.contact({subject:'Wi-Fi connection problem'});f.form.dataset.busy='1';f.render();f.back();f.choose('sound');
 assert.equal(f.form.hidden,false);assert.equal(f.nodes.get('supportGuidedFlow').children[0].disabled,true);assert.equal(f.contact({subject:'No sound or playback problem'}),false);assert.equal(f.form.elements.subject.value,'Wi-Fi connection problem');
 delete f.form.dataset.busy;f.form.dispatch('form-busy-changed');f.back();assert.equal(f.form.hidden,true);
});

test('successful ticket reset returns to problem choices without hiding ticket status or rewriting a new draft',()=>{
 const f=fixture();f.choose('account');f.contact({subject:'Station login or email code problem'});f.form.elements.message.value='Original message';f.reset();f.flush();
 assert.equal(f.nodes.get('supportGuidedFlow').dataset.view,'choose');assert.equal(f.form.hidden,true);assert.equal(f.tickets.hidden,false);assert.equal(f.form.elements.message.value,'');f.contact();assert.equal(f.form.hidden,false);assert.equal(f.form.elements.subject.value,'');
});

test('hidden tabs pause tutorials and restore only the previously approved embed URL',()=>{
 const f=fixture(),approved=f.remote('Sound troubleshooting'),unrelated=f.remote('Sound guide','https://other.example/guide');f.choose('sound');f.guidesChanged();assert.equal(approved.frame.src,'https://www.youtube-nocookie.com/embed/abC1234DEfg');
 f.visibility(true);assert.equal(approved.frame.src,'about:blank');assert.equal(f.videos.hidden,true);assert.equal(unrelated.frame.src,'https://other.example/guide');f.visibility(false);assert.equal(approved.frame.src,'https://www.youtube-nocookie.com/embed/abC1234DEfg');assert.equal(f.videos.hidden,false);
});

test('without the required host elements the module leaves the fallback form untouched',()=>{
 const f=fixture({missing:true});assert.equal(f.window.supportGuidedFlow,undefined);assert.equal(f.form.hidden,false);assert.equal(f.nodes.has('supportGuidedFlow'),false);
});
