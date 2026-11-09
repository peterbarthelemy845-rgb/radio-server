import {test} from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';

const png=Uint8Array.from([137,80,78,71,13,10,26,10,0,0,0,0]);
const jpg=Uint8Array.from([255,216,255,224,0,0,0,0,0,0,0,0]);
const webp=new TextEncoder().encode('RIFF0000WEBP');
function logoFile({name='logo.png',type='image/png',bytes=png,size=bytes.length}={}){
 let reads=0;return {name,type,size,get reads(){return reads;},slice(start,end){reads++;return {async arrayBuffer(){return bytes.slice(start,end).buffer;}};}};
}
function fixture(){
 const nodes=new Map(),images=[],urls=new Map(),revoked=[],windowEvents={},timers=new Map();let nextUrl=0,nextTimer=0;
 const document={activeElement:null};
 function node(id){const listeners={};let value='';const element={id,files:[],dataset:{},attrs:{},disabled:false,validationMessage:'',src:'',alt:'',textContent:'',setAttribute(key,value){this.attrs[key]=value;},setCustomValidity(value){this.validationMessage=value;},reportValidity(){this.reported=true;return !this.validationMessage;},focus(){document.activeElement=this;},addEventListener(type,fn){(listeners[type]??=[]).push(fn);},dispatchEvent(event){return (listeners[event.type]||[]).map(fn=>fn(event));},get value(){return value;},set value(next){value=next;if(id==='stationLogo'&&next==='')this.files=[];}};nodes.set(id,element);return element;}
 const form=node('registerForm'),input=node('stationLogo'),preview=node('registrationLogoPreview'),hint=node('registrationLogoHint'),remove=node('removeRegistrationLogo');form.elements={artwork:input};
 const window={addEventListener(type,fn){windowEvents[type]=fn;}};
 const context=vm.createContext({window,document,$:id=>nodes.get(id),URL:{createObjectURL(file){const url='blob:test/'+(++nextUrl);urls.set(url,file);return url;},revokeObjectURL(url){revoked.push(url);}},Image:class{set src(url){this.url=url;this.file=urls.get(url);images.push(this);}load(width=512,height=512){this.naturalWidth=width;this.naturalHeight=height;this.onload?.();}fail(){this.onerror?.();}},Uint8Array,Promise,Event,WeakMap,queueMicrotask,setTimeout(fn){const id=++nextTimer;timers.set(id,fn);return id;},clearTimeout(id){timers.delete(id);}});
 const source=readFileSync(new URL('./public/assets/directory-news.js',import.meta.url),'utf8');
 vm.runInContext(source.slice(source.indexOf('const coverInput='),source.indexOf('\nfunction highlightMenu()')),context);
 async function flush(){for(let n=0;n<8;n++)await Promise.resolve();}
 return {nodes,form,input,preview,hint,remove,window,document,images,urls,revoked,timers,flush,choose(file){input.files=file?[file]:[];return Promise.all(input.dispatchEvent(new Event('change')));},validate:file=>window.validateRegistrationLogo(file),removeLogo(){remove.onclick();},async reset(){form.dispatchEvent(new Event('reset'));input.value='';await flush();},busy(on){if(on)form.dataset.busy='1';else delete form.dataset.busy;form.dispatchEvent(new Event('form-busy-changed'));},language(translate){window.appI18n={t:translate};windowEvents['app-language-changed']?.();},pagehide(){windowEvents.pagehide?.();},timeout(){for(const fn of [...timers.values()])fn();}};
}

test('invalid size, filename, MIME and image signatures fail before image decoding',async()=>{
 const f=fixture();
 for(const file of [logoFile({size:0}),logoFile({size:3*1024*1024+1}),logoFile({name:'logo.svg',type:'image/svg+xml'}),logoFile({type:'image/jpeg'}),logoFile({name:'logo.jpg',type:'image/jpeg',bytes:png}),logoFile({bytes:new Uint8Array(12)})]){
  await f.choose(file);assert.equal(await f.validate(file),false);assert.ok(f.input.validationMessage);assert.equal(f.preview.src,'/assets/logo-placeholder.svg');assert.equal(f.hint.dataset.state,'invalid');assert.equal(f.document.activeElement,f.input);
 }
 assert.equal(f.images.length,0);assert.equal(f.urls.size,0);
});

test('valid PNG, JPEG and WebP reuse one inspection and release decode and preview URLs',async()=>{
 for(const options of [{},{name:'logo.JPG',type:'image/jpeg',bytes:jpg},{name:'logo.webp',type:'',bytes:webp}]){
  const f=fixture();assert.equal(f.remove.hidden,true);const file=logoFile(options),changed=f.choose(file);await f.flush();assert.equal(f.remove.hidden,false);assert.equal(f.images.length,1);f.images[0].load(1000,4000);await changed;
  assert.equal(await f.validate(file),true);assert.equal(file.reads,1);assert.equal(f.images.length,1);assert.equal(f.input.validationMessage,'');assert.match(f.preview.src,/^blob:test\//);assert.equal(f.revoked.length,1);assert.equal(f.remove.disabled,false);
  const previewUrl=f.preview.src;f.removeLogo();assert.equal(f.preview.src,'/assets/logo-placeholder.svg');assert.equal(f.remove.disabled,true);assert.equal(f.remove.hidden,true);assert.ok(f.revoked.includes(previewUrl));assert.equal(f.form.dataset.dirty,'1');
 }
});

test('oversized dimensions, decode failure and decode timeout cannot become previews',async()=>{
 for(const outcome of ['dimensions','decode','timeout']){
  const f=fixture(),file=logoFile(),changed=f.choose(file);await f.flush();
  if(outcome==='dimensions')f.images[0].load(2001,2000);else if(outcome==='decode')f.images[0].fail();else f.timeout();
  await changed;assert.equal(await f.validate(file),false);assert.equal(f.preview.src,'/assets/logo-placeholder.svg');assert.ok(f.input.validationMessage);assert.equal(f.revoked.length,1);assert.equal(f.timers.size,0);
 }
});

test('an old asynchronous selection cannot overwrite the newer preview or removal state',async()=>{
 const f=fixture(),old=logoFile(),current=logoFile({name:'current.png'}),first=f.choose(old);await f.flush();const second=f.choose(current);await f.flush();
 f.images[1].load();await second;const currentPreview=f.preview.src;f.images[0].load(9000,9000);await first;
 assert.equal(f.preview.src,currentPreview);assert.equal(f.input.validationMessage,'');assert.equal(await f.validate(old),false);assert.equal(f.preview.src,currentPreview);
 const another=logoFile({name:'another.png'}),pending=f.choose(another);await f.flush();f.removeLogo();f.images[2].load();await pending;assert.equal(f.preview.src,'/assets/logo-placeholder.svg');assert.equal(f.remove.disabled,true);assert.equal(f.input.validationMessage,'');
});

test('busy state protects Remove and reset clears previews and validity',async()=>{
 const f=fixture(),file=logoFile(),changed=f.choose(file);await f.flush();f.images[0].load();await changed;const preview=f.preview.src;
 f.busy(true);assert.equal(f.remove.disabled,true);assert.equal(f.remove.hidden,false);f.removeLogo();assert.equal(f.input.files[0],file);assert.equal(f.preview.src,preview);f.busy(false);assert.equal(f.remove.disabled,false);
 await f.reset();assert.equal(f.preview.src,'/assets/logo-placeholder.svg');assert.equal(f.remove.disabled,true);assert.equal(f.remove.hidden,true);assert.equal(f.input.validationMessage,'');assert.ok(f.revoked.includes(preview));assert.equal(await f.validate(),false);
});

test('error text follows language changes and page exit releases the retained preview',async()=>{
 const f=fixture(),invalid=logoFile({size:0});await f.choose(invalid);f.language(key=>key==='registration.logoRequired'?'Chwazi yon logo estasyon.':key);assert.equal(f.hint.textContent,'Chwazi yon logo estasyon.');assert.equal(f.input.validationMessage,'Chwazi yon logo estasyon.');
 const file=logoFile(),changed=f.choose(file);await f.flush();f.images[0].load();await changed;const url=f.preview.src;f.pagehide();assert.ok(f.revoked.includes(url));
});
