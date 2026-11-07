import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createContext,runInContext} from 'node:vm';

// A small browser-shaped DOM fixture exercises actual translation passes and
// mutation callbacks without a network service or a second DOM dependency.
function fixture({saved='en',blocked=false,locale='en-US'}={}){
 const ids=new Map(),events=new Map(),observers=[],writes=[],dispatched=[];
 class Text{constructor(value){this.nodeValue=value;this.parentElement=null;}get textContent(){return this.nodeValue;}}
 class Element{
  constructor(tag,attributes={}){this.tagName=tag.toUpperCase();this.children=[];this.parentElement=null;this.dataset={};this.attributes={};this._value='';if(tag==='track')this.track={mode:'disabled'};for(const [key,value] of Object.entries(attributes))this.setAttribute(key,value);}
  append(...children){for(let child of children){if(typeof child==='string')child=new Text(child);child.parentElement=this;this.children.push(child);}}
  get textContent(){return this.children.map(child=>child.textContent).join('');}
  set textContent(value){this.children=[];if(value!=='')this.append(new Text(String(value)));}
  setAttribute(key,value){value=String(value);this.attributes[key]=value;if(key==='id'){this.id=value;ids.set(value,this);}if(key.startsWith('data-'))this.dataset[key.slice(5).replace(/-([a-z])/g,(_,c)=>c.toUpperCase())]=value;}
  hasAttribute(key){return this.getAttribute(key)!==null;}
  getAttribute(key){if(key.startsWith('data-')){const name=key.slice(5).replace(/-([a-z])/g,(_,c)=>c.toUpperCase());return Object.hasOwn(this.dataset,name)?this.dataset[name]:null;}return Object.hasOwn(this.attributes,key)?this.attributes[key]:null;}
  get placeholder(){return this.getAttribute('placeholder');}set placeholder(value){this.setAttribute('placeholder',value);}
  get value(){return this.tagName==='OPTION'?this.getAttribute('value')??this.textContent:this._value;}
  set value(value){if(this.tagName==='OPTION')this.setAttribute('value',value);else this._value=String(value);}
  closest(selector){for(let node=this;node;node=node.parentElement)if(selector.split(',').some(part=>matches(node,part.trim())))return node;return null;}
  querySelectorAll(selector){return descendants(this).filter(node=>selector.split(',').some(part=>matches(node,part.trim())));}
  querySelector(selector){return this.querySelectorAll(selector)[0]||null;}
 }
 function descendants(node){return node.children.flatMap(child=>child instanceof Element?[child,...descendants(child)]:[]);}
 function matches(node,selector){
  const parts=selector.split(/\s+/);if(parts.length>1){if(!matches(node,parts.pop()))return false;let parent=node.parentElement;while(parts.length){const part=parts.pop();while(parent&&!matches(parent,part))parent=parent.parentElement;if(!parent)return false;parent=parent.parentElement;}return true;}
  const tag=selector.match(/^[a-z][a-z0-9-]*/i)?.[0];if(tag&&node.tagName!==tag.toUpperCase())return false;
  const id=selector.match(/#([A-Za-z0-9_-]+)/)?.[1];if(id&&node.id!==id)return false;
  const cls=selector.match(/\.([A-Za-z0-9_-]+)/)?.[1];if(cls&&!String(node.getAttribute('class')||'').split(/\s+/).includes(cls))return false;
  for(const match of selector.matchAll(/\[([a-z0-9-]+)(?:="([^"]*)")?\]/gi)){const value=node.getAttribute(match[1]);if(value===null||match[2]!==undefined&&value!==match[2])return false;}
  return true;
 }
 const body=new Element('body'),root=new Element('html');root.append(body);
 const document={body,documentElement:root,createElement:tag=>new Element(tag),querySelectorAll:selector=>root.querySelectorAll(selector),createTreeWalker(start){const nodes=[];function collect(node){for(const child of node.children){if(child instanceof Text)nodes.push(child);else collect(child);}}collect(start);let cursor=0;return {nextNode(){return nodes[cursor++]||null;}};}};
 function add(tag,text='',attributes={},parent=body){const element=new Element(tag,attributes);element.textContent=text;parent.append(element);return element;}
 const picker=add('select','',{'data-language-picker':''});picker.value='en';
 const status=add('p','Online'),current=add('p','Current station: Support'),checked=add('p','Checked 2:15 PM');
 const search=add('input','',{placeholder:'Search stations or codes'});search.value='Online';
 const helpField=add('textarea','Online',{placeholder:'Tell us what happened. Do not include passwords or verification codes.'});helpField.value='Online';
 const title=add('h1','Support',{id:'shareName','data-i18n':'online'}),bio=add('p','Your name',{id:'shareStationBio'}),tile=add('p','Online',{class:'station-tile-name'});
 const privateText=add('p','Online',{'data-i18n-skip':'true','data-i18n':'online'}),admin=add('section','',{id:'admin'}),adminText=add('p','Online',{},admin);
 const privateInput=add('input','',{placeholder:'Your name','data-i18n-placeholder':'name'},privateText);privateInput.value='Support';
 const ticket=add('form','',{id:'ticketForm'}),subject=add('select','',{},ticket),option=add('option','Wi-Fi connection problem',{},subject);
 const explicit=add('p','Open',{'data-i18n':'supportStatus.open'}),unknown=add('p','Keep this fallback',{'data-i18n':'missing.message'});
 const size=add('button','Larger text',{id:'listenerTextSize','aria-pressed':'false'});
 const context=createContext({document,navigator:{language:locale},NodeFilter:{SHOW_TEXT:4},$:id=>ids.get(id),queueMicrotask,localStorage:{getItem(){if(blocked)throw Error('Blocked');return saved;},setItem(...args){if(blocked)throw Error('Blocked');writes.push(args);}},MutationObserver:class{constructor(fn){observers.push(fn);}observe(){}},CustomEvent:class{constructor(type,init){this.type=type;this.detail=init?.detail;}},window:{addEventListener(type,fn){const handlers=events.get(type)||[];handlers.push(fn);events.set(type,handlers);},dispatchEvent(event){dispatched.push(event);for(const fn of events.get(event.type)||[])fn(event);}}});
 runInContext(readFileSync(new URL('./public/assets/app-language.js',import.meta.url),'utf8'),context);
 return {context,api:context.window.appI18n,root,status,current,checked,search,helpField,title,bio,tile,privateText,privateInput,adminText,explicit,unknown,option,size,picker,writes,dispatched,add,async mutate(){for(const notify of observers)notify();await new Promise(resolve=>setImmediate(resolve));}};
}
test('English and Haitian Creole switch reversibly across live status, prefixes and placeholders',async()=>{
 const f=fixture();f.api.setLanguage('ht');
 assert.equal(f.root.lang,'ht');assert.equal(f.status.textContent,'Konekte');assert.equal(f.current.textContent,'Estasyon kounye a: Support');assert.equal(f.checked.textContent,'Verifye 2:15 PM');assert.equal(f.search.placeholder,'Chèche estasyon oswa kòd');assert.equal(f.picker.value,'ht');assert.equal(f.helpField.placeholder,'Di nou sa ki pase. Pa mete modpas ni kòd verifikasyon.');assert.equal(f.helpField.value,'Online');
 f.status.textContent='Status unavailable';f.checked.textContent='Last checked 2:20 PM';await f.mutate();assert.equal(f.status.textContent,'Estati a pa disponib');assert.equal(f.checked.textContent,'Dènye verifikasyon 2:20 PM');
 f.api.setLanguage('en');assert.equal(f.status.textContent,'Status unavailable');assert.equal(f.current.textContent,'Current station: Support');assert.equal(f.checked.textContent,'Last checked 2:20 PM');assert.equal(f.search.placeholder,'Search stations or codes');assert.equal(f.picker.value,'en');assert.equal(f.helpField.placeholder,'Tell us what happened. Do not include passwords or verification codes.');
});
test('station names, bios, admin content, protected placeholders and typed form values are never rewritten',()=>{
 const f=fixture();f.api.setLanguage('ht');
 assert.equal(f.title.textContent,'Support');assert.equal(f.bio.textContent,'Your name');assert.equal(f.tile.textContent,'Online');assert.equal(f.privateText.children[0].textContent,'Online');assert.equal(f.adminText.textContent,'Online');assert.equal(f.privateInput.placeholder,'Your name');assert.equal(f.privateInput.value,'Support');assert.equal(f.search.value,'Online');
 f.api.setLanguage('en');assert.equal(f.title.textContent,'Support');assert.equal(f.search.value,'Online');
});
test('support translation keys fall back safely and runtime substitutions preserve dynamic numbers',()=>{
 const f=fixture();f.api.setLanguage('ht');assert.equal(f.explicit.textContent,'Ouvè');assert.equal(f.unknown.textContent,'Keep this fallback');assert.equal(f.api.t('missing.message'),'missing.message');assert.match(f.api.t('controls.wait',{number:'5831'}),/5831/);
 runInContext("appEnglish['test.englishOnly']='English fallback';",f.context);const extra=f.add('p','Original',{'data-i18n':'test.englishOnly'});f.api.setLanguage('ht');assert.equal(extra.textContent,'English fallback');
 f.api.setLanguage('en');assert.equal(f.explicit.textContent,'Open');
});
test('a new UI status is translated after a DOM mutation while fixed support subject identifiers stay English',async()=>{
 const f=fixture({saved:'ht'});assert.equal(f.option.value,'Wi-Fi connection problem');assert.equal(f.option.textContent,'Pwoblèm koneksyon Wi-Fi');
 const message=f.add('p','Checking radio status…');await f.mutate();assert.equal(message.textContent,'N ap verifye estati radyo a…');assert.equal(f.option.value,'Wi-Fi connection problem');
 f.api.setLanguage('en');assert.equal(message.textContent,'Checking radio status…');assert.equal(f.option.value,'Wi-Fi connection problem');
});
test('language selection works with blocked storage and persists only the preference when available',()=>{
 const blocked=fixture({blocked:true});blocked.api.setLanguage('ht');assert.equal(blocked.status.textContent,'Konekte');assert.equal(blocked.root.lang,'ht');assert.equal(blocked.writes.length,0);
 const f=fixture();f.api.setLanguage('ht');assert.deepEqual(f.writes,[['radioLocalsLanguage','ht']]);assert.equal(f.dispatched.at(-1).type,'app-language-changed');assert.equal(f.dispatched.at(-1).detail.language,'ht');assert.equal(fixture({saved:'invalid'}).api.language,'en');assert.equal(fixture({saved:'',locale:'ht-HT'}).api.language,'ht');
});
