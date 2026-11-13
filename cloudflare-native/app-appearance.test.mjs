import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';

function fixture({saved='0',blocked=false,tools=false}={}){
 const classes=new Set(),events={},viewportEvents={},documentEvents={},writes=[],nodes=new Map(),observers=[];
 let document;
 function element(id='',tagName='DIV'){
  const handlers={},node={id,tagName,hidden:false,children:[],parentElement:null,isConnected:true,dataset:{},attributes:{},open:false,scrollIntoView(){this.scrolled=true;},setAttribute(key,value){this.attributes[key]=String(value);this[key]=String(value);if(key.startsWith('data-'))this.dataset[key.slice(5).replace(/-([a-z])/g,(_,letter)=>letter.toUpperCase())]=String(value);},getAttribute(key){return this.attributes[key]??null;},append(...children){for(const child of children){if(child.parentElement)child.parentElement.children=child.parentElement.children.filter(node=>node!==child);child.parentElement=this;this.children.push(child);}},prepend(child){this.append(child);this.children.unshift(this.children.pop());},focus(){document.activeElement=this;},closest(selector){for(let item=this;item;item=item.parentElement)if(selector==='[hidden]'&&item.hidden)return item;return null;},querySelector(selector){return descendants(this).find(item=>selector==='label[for="appLanguage"]'&&item.tagName==='LABEL'&&(item.getAttribute('for')==='appLanguage'||item.htmlFor==='appLanguage'))||null;},addEventListener(name,fn){(handlers[name]??=[]).push(fn);},dispatchEvent(event){for(const fn of handlers[event.type]||[])fn(event);if(event.type==='cancel'&&!event.defaultPrevented)this.close();return !event.defaultPrevented;},showModal(){this.open=true;},close(){this.open=false;queueMicrotask(()=>this.dispatchEvent({type:'close'}));},getBoundingClientRect(){return {left:50,right:350,top:100,bottom:440};}};
  Object.defineProperty(node,'textContent',{get(){return this.children.length?this.children.map(child=>child.textContent||'').join(''):this._text||'';},set(value){this.children=[];this._text=String(value);}});
  return node;
 }
 function descendants(node){return node.children.flatMap(child=>[child,...descendants(child)]);}
 const main=element('main'),home=element('displayToolsHome'),toolbar=tools?element('displayTools'):null,button=element('listenerTextSize','BUTTON'),language=element('appLanguage','SELECT'),languageLabel=element('languageLabel','LABEL');languageLabel.setAttribute('for','appLanguage');language.onclick=()=>{language.changes++;};language.onchange=()=>{language.changes++;};language.changes=0;
 nodes.set('listenerTextSize',button);nodes.set('appLanguage',language);
 const body=element('body');body.classList={toggle(name,on){on?classes.add(name):classes.delete(name);},contains(name){return classes.has(name);}};body.append(home,main);
 if(toolbar){toolbar.append(languageLabel,language,button);home.append(toolbar);for(const id of ['ownerEntryLoading','myRadio','support','wifiSetup','login','register','editor','advertise','adReview','reports','backups','admin','legal','shared']){const panel=element(id);panel.hidden=true;nodes.set(id,panel);main.append(panel);}nodes.get('myRadio').hidden=false;}
 const viewport={height:720,addEventListener(name,fn){viewportEvents[name]=fn;}};
 document={body,activeElement:null,documentElement:{style:{setProperty(key,value){this[key]=value;}}},createElement(tag){return element('',tag.toUpperCase());},addEventListener(name,fn){documentEvents[name]=fn;},querySelector(selector){return selector==='main'?main:selector==='.app-header-tools'?toolbar:null;}};
 const window={innerHeight:720,visualViewport:viewport,addEventListener(name,fn){events[name]=fn;}};
 runInNewContext(readFileSync(new URL('./public/assets/app-appearance.js',import.meta.url),'utf8'),{$:id=>nodes.get(id),document,window,MutationObserver:class{constructor(callback){this.callback=callback;observers.push(this);}observe(target,options){this.target=target;this.options=options;}},requestAnimationFrame:fn=>fn(),queueMicrotask,localStorage:{getItem(){if(blocked)throw Error('Storage unavailable');return saved;},setItem(...args){if(blocked)throw Error('Storage unavailable');writes.push(args);}}});
 const find=id=>descendants(body).find(node=>node.id===id),displayButton=find('openDisplayPreferences'),dialog=find('displayPreferences'),closeButton=find('closeDisplayPreferences');
 return {classes,button,writes,viewport,viewportEvents,documentEvents,document,window,nodes,main,home,toolbar,language,languageLabel,displayButton,dialog,closeButton,events,observers,notifyHidden(){for(const observer of observers)observer.callback();},async flush(){await Promise.resolve();await Promise.resolve();}};
}

test('readable text preference is restored, reversible and stores only the preference',()=>{
 const f=fixture({saved:'1'});assert.equal(f.button['aria-pressed'],'true');assert.equal(f.button.textContent,'Standard text');assert.ok(f.classes.has('app-large-text'));
 f.button.onclick();assert.equal(f.button['aria-pressed'],'false');assert.equal(f.button.textContent,'Larger text');assert.deepEqual(f.writes,[['radioLocalsLargerText','0']]);
});
test('blocked local storage never prevents toggling readable text',()=>{const f=fixture({blocked:true});f.button.onclick();assert.ok(f.classes.has('app-large-text'));assert.equal(f.button['aria-pressed'],'true');});
test('keyboard avoids bottom navigation and scrolls the focused field only when needed',()=>{
 const f=fixture();let scrolled=0;f.document.activeElement={tagName:'INPUT',scrollIntoView(){scrolled++;}};
 f.documentEvents.focusin();assert.equal(scrolled,0);assert.ok(!f.classes.has('app-keyboard-open'));
 f.viewport.height=410;f.viewportEvents.resize();assert.ok(f.classes.has('app-keyboard-open'));assert.equal(scrolled,1);assert.equal(f.document.documentElement.style['--app-visible-height'],'410px');
 f.viewport.height=400;f.viewportEvents.resize();assert.equal(scrolled,1);
 f.document.activeElement={tagName:'BUTTON'};f.documentEvents.focusout();assert.ok(!f.classes.has('app-keyboard-open'));
});
test('display controls follow every owner panel and return home as the same live nodes',()=>{
 const f=fixture({tools:true}),textHandler=f.button.onclick,languageHandler=f.language.onclick;
 assert.equal(f.toolbar.parentElement,f.home);assert.equal(f.observers.length,1);assert.equal(f.observers[0].target,f.main);assert.equal(f.observers[0].options.subtree,true);assert.deepEqual([...f.observers[0].options.attributeFilter],['hidden']);
 for(const id of ['login','register','editor','advertise','adReview','reports','backups','admin','legal']){
  for(const [key,panel] of f.nodes)if(panel.parentElement===f.main)panel.hidden=key!==id;f.notifyHidden();
  const panel=f.nodes.get(id);assert.equal(f.toolbar.parentElement,panel,id);assert.equal(panel.children[0],f.toolbar,id);assert.equal(f.classes.has('app-owner-page'),true,id);
  assert.deepEqual(f.toolbar.children,[f.displayButton]);assert.equal(f.language.parentElement.parentElement,f.dialog);assert.equal(f.button.parentElement.parentElement,f.dialog);assert.equal(f.button.onclick,textHandler);assert.equal(f.language.onclick,languageHandler);
 }
 f.language.onclick();f.button.onclick();assert.equal(f.language.changes,1);assert.equal(f.button['aria-pressed'],'true');assert.deepEqual(f.writes,[['radioLocalsLargerText','1']]);
 for(const panel of f.main.children)panel.hidden=true;f.nodes.get('myRadio').hidden=false;f.notifyHidden();
 assert.equal(f.toolbar.parentElement,f.home);assert.equal(f.home.children.filter(node=>node===f.toolbar).length,1);assert.equal(f.classes.has('app-owner-page'),false);assert.equal(f.button['aria-pressed'],'true');
 f.events['radio-locals-ready']();assert.equal(f.toolbar.parentElement,f.home);assert.equal(f.button.onclick,textHandler);assert.equal(f.language.onclick,languageHandler);
});
test('moving display controls never changes a busy owner form or its in-memory draft',()=>{
 const f=fixture({tools:true}),editor=f.nodes.get('editor');f.nodes.get('myRadio').hidden=true;editor.hidden=false;editor.dataset={busy:'1',dirty:'1'};const draft={bio:'Keep my unsaved station bio',file:{name:'new-cover.png'}};editor.draft=draft;
 f.notifyHidden();assert.equal(f.toolbar.parentElement,editor);f.button.onclick();
 editor.hidden=true;f.nodes.get('login').hidden=false;f.notifyHidden();assert.equal(f.toolbar.parentElement,f.nodes.get('login'));
 f.nodes.get('login').hidden=true;editor.hidden=false;f.events['radio-locals-ready']();
 assert.equal(f.toolbar.parentElement,editor);assert.equal(editor.draft,draft);assert.deepEqual(editor.dataset,{busy:'1',dirty:'1'});assert.equal(f.classes.has('app-large-text'),true);
});

test('one Display button opens a labelled native dialog containing the original live controls',()=>{
 const f=fixture({tools:true}),languageHandler=f.language.onchange,textHandler=f.button.onclick;
 assert.deepEqual(f.toolbar.children,[f.displayButton]);assert.equal(f.displayButton.type,'button');assert.equal(f.displayButton.getAttribute('aria-haspopup'),'dialog');assert.equal(f.displayButton.getAttribute('aria-controls'),'displayPreferences');assert.equal(f.displayButton.getAttribute('aria-expanded'),'false');assert.equal(f.dialog.getAttribute('aria-labelledby'),'displayPreferencesTitle');assert.equal(f.dialog.parentElement,f.document.body);assert.equal(f.dialog.open,false);
 f.displayButton.onclick();assert.equal(f.dialog.open,true);assert.equal(f.displayButton.getAttribute('aria-expanded'),'true');assert.equal(f.document.activeElement,f.closeButton);assert.equal(f.closeButton.tagName,'BUTTON');assert.equal(f.language.autofocus,undefined);assert.equal(f.language.onchange,languageHandler);assert.equal(f.button.onclick,textHandler);f.language.onchange();f.button.onclick();assert.equal(f.language.changes,1);assert.deepEqual(f.writes,[['radioLocalsLargerText','1']]);assert.equal(f.button.getAttribute('data-i18n'),'standard');
 f.viewport.height=410;f.viewportEvents.resize();assert.equal(f.classes.has('app-keyboard-open'),false);
});

test('Close, native Escape and a backdrop click close preferences and restore focus to Display',async()=>{
 const f=fixture({tools:true});f.displayButton.onclick();f.closeButton.onclick();await f.flush();assert.equal(f.dialog.open,false);assert.equal(f.document.activeElement,f.displayButton);assert.equal(f.displayButton.getAttribute('aria-expanded'),'false');
 f.displayButton.onclick();const escape=new Event('cancel',{cancelable:true});assert.equal(f.dialog.dispatchEvent(escape),true);assert.equal(escape.defaultPrevented,false);await f.flush();assert.equal(f.dialog.open,false);assert.equal(f.document.activeElement,f.displayButton);
 f.displayButton.onclick();f.dialog.dispatchEvent({type:'click',target:f.dialog,clientX:100,clientY:200});assert.equal(f.dialog.open,true);f.dialog.dispatchEvent({type:'click',target:f.language,clientX:0,clientY:0});assert.equal(f.dialog.open,true);f.dialog.dispatchEvent({type:'click',target:f.dialog,clientX:0,clientY:0});await f.flush();assert.equal(f.dialog.open,false);assert.equal(f.document.activeElement,f.displayButton);
});

test('page changes close preferences without stealing navigation focus or losing saved choices',async()=>{
 const f=fixture({tools:true});f.displayButton.onclick();f.button.onclick();f.nodes.get('myRadio').hidden=true;f.nodes.get('support').hidden=false;f.nodes.get('support').focus();f.notifyHidden();await f.flush();assert.equal(f.dialog.open,false);assert.equal(f.document.activeElement,f.nodes.get('support'));assert.equal(f.classes.has('app-large-text'),true);assert.equal(f.button.getAttribute('aria-pressed'),'true');assert.equal(f.toolbar.parentElement,f.home);
 f.nodes.get('support').hidden=true;f.nodes.get('login').hidden=false;f.notifyHidden();assert.equal(f.toolbar.parentElement,f.nodes.get('login'));f.displayButton.onclick();assert.equal(f.dialog.open,true);assert.deepEqual(f.toolbar.children,[f.displayButton]);
});

test('queued close events from a previous opening cannot reset a newly opened Display dialog',async()=>{
 const f=fixture({tools:true});f.displayButton.onclick();f.closeButton.onclick();f.displayButton.onclick();await f.flush();assert.equal(f.dialog.open,true);assert.equal(f.displayButton.getAttribute('aria-expanded'),'true');assert.equal(f.document.activeElement,f.closeButton);
});

test('Display labels update in place even on owner/admin cards without changing language or text handlers',()=>{
 const f=fixture({tools:true}),languageHandler=f.language.onchange,textHandler=f.button.onclick;f.window.appI18n={t:key=>({'display.open':'Ekspozisyon','display.title':'Preferans ekspozisyon','display.textSize':'Gwosè tèks','language':'Lang','close':'Fèmen'})[key]||key};f.events['app-language-changed']();assert.equal(f.displayButton.textContent,'Ekspozisyon');assert.equal(f.closeButton.textContent,'Fèmen');assert.equal(f.languageLabel.textContent,'Lang');assert.equal(f.language.onchange,languageHandler);assert.equal(f.button.onclick,textHandler);assert.equal(f.writes.length,0);
});
test('app shell keeps zoom enabled, includes complete scripts and readable fallbacks',()=>{
 const html=readFileSync(new URL('./public/index.html',import.meta.url),'utf8'),css=readFileSync(new URL('./public/assets/app-shell.css',import.meta.url),'utf8');
 assert.match(html,/viewport-fit=cover/);assert.doesNotMatch(html,/user-scalable=no|maximum-scale=1/);
 assert.equal([...html.matchAll(/<script\b/g)].length,[...html.matchAll(/<\/script>/g)].length);
 assert.match(html,/id="listenerTextSize"[^>]*aria-pressed="false"/);assert.match(html,/<script src="\/assets\/app-navigation.js" defer><\/script>/);
 assert.match(css,/prefers-reduced-motion/);assert.match(css,/safe-area-inset-bottom/);assert.match(css,/--app-visible-height/);
 const displayCss=readFileSync(new URL('./public/assets/display-preferences.css',import.meta.url),'utf8');assert.match(displayCss,/min-height:48px/);assert.match(displayCss,/calc\(100% - 24px\)/);assert.match(displayCss,/max-height:calc\(var\(--app-visible-height/);assert.match(displayCss,/prefers-reduced-motion/);assert.match(displayCss,/forced-colors/);
 assert.match(displayCss,/#displayPreferences #listenerTextSize::after\{content:none;display:none\}/);
});
