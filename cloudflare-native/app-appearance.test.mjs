import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';

function fixture({saved='0',blocked=false}={}){
 const classes=new Set(),events={},viewportEvents={},documentEvents={},writes=[],button={setAttribute(key,value){this[key]=value;}};
 const body={classList:{toggle(name,on){on?classes.add(name):classes.delete(name);},contains(name){return classes.has(name);}}};
 const viewport={height:720,addEventListener(name,fn){viewportEvents[name]=fn;}};
 const document={body,activeElement:null,documentElement:{style:{setProperty(key,value){this[key]=value;}}},addEventListener(name,fn){documentEvents[name]=fn;}};
 const window={innerHeight:720,visualViewport:viewport,addEventListener(name,fn){events[name]=fn;}};
 runInNewContext(readFileSync(new URL('./public/assets/app-appearance.js',import.meta.url),'utf8'),{$:()=>button,document,window,requestAnimationFrame:fn=>fn(),localStorage:{getItem(){if(blocked)throw Error('Storage unavailable');return saved;},setItem(...args){if(blocked)throw Error('Storage unavailable');writes.push(args);}}});
 return {classes,button,writes,viewport,viewportEvents,documentEvents,document,window};
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
test('app shell keeps zoom enabled, includes complete scripts and readable fallbacks',()=>{
 const html=readFileSync(new URL('./public/index.html',import.meta.url),'utf8'),css=readFileSync(new URL('./public/assets/app-shell.css',import.meta.url),'utf8');
 assert.match(html,/viewport-fit=cover/);assert.doesNotMatch(html,/user-scalable=no|maximum-scale=1/);
 assert.equal([...html.matchAll(/<script\b/g)].length,[...html.matchAll(/<\/script>/g)].length);
 assert.match(html,/id="listenerTextSize"[^>]*aria-pressed="false"/);assert.match(html,/<script src="\/assets\/app-navigation.js" defer><\/script><\/head>/);
 assert.match(css,/prefers-reduced-motion/);assert.match(css,/safe-area-inset-bottom/);assert.match(css,/--app-visible-height/);
});
