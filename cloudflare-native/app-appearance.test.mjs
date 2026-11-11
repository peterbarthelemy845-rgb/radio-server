import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';

function fixture({saved='0',blocked=false,tools=false}={}){
 const classes=new Set(),events={},viewportEvents={},documentEvents={},writes=[],button={setAttribute(key,value){this[key]=value;}};
 const nodes=new Map(),observers=[];
 function element(id=''){
  return {id,hidden:true,children:[],parentElement:null,append(...children){for(const child of children){if(child.parentElement)child.parentElement.children=child.parentElement.children.filter(node=>node!==child);child.parentElement=this;this.children.push(child);}},prepend(child){this.append(child);this.children.unshift(this.children.pop());}};
 }
 const main=element('main'),home=element('displayToolsHome'),toolbar=tools?element('displayTools'):null,language={id:'appLanguage',onclick(){language.changes++;},changes:0};
 if(toolbar){toolbar.append(language,button);home.append(toolbar);for(const id of ['login','register','editor','advertise','adReview','reports','backups','admin','legal']){const panel=element(id);nodes.set(id,panel);main.append(panel);}}
 const body={classList:{toggle(name,on){on?classes.add(name):classes.delete(name);},contains(name){return classes.has(name);}}};
 const viewport={height:720,addEventListener(name,fn){viewportEvents[name]=fn;}};
 const document={body,activeElement:null,documentElement:{style:{setProperty(key,value){this[key]=value;}}},addEventListener(name,fn){documentEvents[name]=fn;},querySelector(selector){return selector==='main'?main:selector==='.app-header-tools'?toolbar:null;}};
 const window={innerHeight:720,visualViewport:viewport,addEventListener(name,fn){events[name]=fn;}};
 runInNewContext(readFileSync(new URL('./public/assets/app-appearance.js',import.meta.url),'utf8'),{$:id=>id==='listenerTextSize'?button:nodes.get(id),document,window,MutationObserver:class{constructor(callback){this.callback=callback;observers.push(this);}observe(target,options){this.target=target;this.options=options;}},requestAnimationFrame:fn=>fn(),localStorage:{getItem(){if(blocked)throw Error('Storage unavailable');return saved;},setItem(...args){if(blocked)throw Error('Storage unavailable');writes.push(args);}}});
 return {classes,button,writes,viewport,viewportEvents,documentEvents,document,window,nodes,main,home,toolbar,language,events,observers,notifyHidden(){for(const observer of observers)observer.callback();}};
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
  for(const [key,panel] of f.nodes)panel.hidden=key!==id;f.notifyHidden();
  const panel=f.nodes.get(id);assert.equal(f.toolbar.parentElement,panel,id);assert.equal(panel.children[0],f.toolbar,id);assert.equal(f.classes.has('app-owner-page'),true,id);
  assert.deepEqual(f.toolbar.children,[f.language,f.button]);assert.equal(f.button.onclick,textHandler);assert.equal(f.language.onclick,languageHandler);
 }
 f.language.onclick();f.button.onclick();assert.equal(f.language.changes,1);assert.equal(f.button['aria-pressed'],'true');assert.deepEqual(f.writes,[['radioLocalsLargerText','1']]);
 for(const panel of f.nodes.values())panel.hidden=true;f.notifyHidden();
 assert.equal(f.toolbar.parentElement,f.home);assert.equal(f.home.children.filter(node=>node===f.toolbar).length,1);assert.equal(f.classes.has('app-owner-page'),false);assert.equal(f.button['aria-pressed'],'true');
 f.events['radio-locals-ready']();assert.equal(f.toolbar.parentElement,f.home);assert.equal(f.button.onclick,textHandler);assert.equal(f.language.onclick,languageHandler);
});
test('moving display controls never changes a busy owner form or its in-memory draft',()=>{
 const f=fixture({tools:true}),editor=f.nodes.get('editor');editor.hidden=false;editor.dataset={busy:'1',dirty:'1'};const draft={bio:'Keep my unsaved station bio',file:{name:'new-cover.png'}};editor.draft=draft;
 f.notifyHidden();assert.equal(f.toolbar.parentElement,editor);f.button.onclick();
 editor.hidden=true;f.nodes.get('login').hidden=false;f.notifyHidden();assert.equal(f.toolbar.parentElement,f.nodes.get('login'));
 f.nodes.get('login').hidden=true;editor.hidden=false;f.events['radio-locals-ready']();
 assert.equal(f.toolbar.parentElement,editor);assert.equal(editor.draft,draft);assert.deepEqual(editor.dataset,{busy:'1',dirty:'1'});assert.equal(f.classes.has('app-large-text'),true);
});
test('app shell keeps zoom enabled, includes complete scripts and readable fallbacks',()=>{
 const html=readFileSync(new URL('./public/index.html',import.meta.url),'utf8'),css=readFileSync(new URL('./public/assets/app-shell.css',import.meta.url),'utf8');
 assert.match(html,/viewport-fit=cover/);assert.doesNotMatch(html,/user-scalable=no|maximum-scale=1/);
 assert.equal([...html.matchAll(/<script\b/g)].length,[...html.matchAll(/<\/script>/g)].length);
 assert.match(html,/id="listenerTextSize"[^>]*aria-pressed="false"/);assert.match(html,/<script src="\/assets\/app-navigation.js" defer><\/script><\/head>/);
 assert.match(css,/prefers-reduced-motion/);assert.match(css,/safe-area-inset-bottom/);assert.match(css,/--app-visible-height/);
});
