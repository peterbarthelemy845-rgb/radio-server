import {test} from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
const source=readFileSync(new URL('./public/assets/site.js',import.meta.url),'utf8');
function fixture(id='editForm'){
 let locale='en';
 function button(text,{type='submit',disabled=false,i18n,skip}={}){
  const b={tagName:'BUTTON',type,disabled,dataset:{},childNodes:[{textContent:text}],getAttribute(name){return name==='type'?type:null;},replaceChildren(...nodes){this.childNodes=nodes;},get textContent(){return this.childNodes.map(node=>node.textContent).join('');},set textContent(text){this.childNodes=[{textContent:text}];}};
  if(i18n)b.dataset.i18n=i18n;if(skip)b.dataset.i18nSkip=skip;return b;
 }
 const submit=button('Save changes',{i18n:'save'}),secondary=button('Cancel',{type:'button'}),alreadyDisabled=button('Unavailable',{type:'button',disabled:true}),field={tagName:'INPUT',disabled:false};
 const form={id,dataset:{},attrs:{},events:[],querySelectorAll(selector){return selector.includes('input')?[submit,secondary,alreadyDisabled,field]:[submit,secondary,alreadyDisabled];},setAttribute(key,value){this.attrs[key]=value;},removeAttribute(key){delete this.attrs[key];},dispatchEvent(event){this.events.push(event);}};
 const t=key=>key.startsWith('busy.')?(locale==='ht'?{'busy.saving':'N ap anrejistre…','busy.checking':'N ap verifye…','busy.sending':'N ap voye…','busy.deleting':'N ap efase…'}[key]:{'busy.saving':'Saving…','busy.checking':'Checking…','busy.sending':'Sending…','busy.deleting':'Deleting…'}[key])||key:key==='save'?(locale==='ht'?'Anrejistre':'Save changes'):key;
 const context=vm.createContext({window:{appI18n:{t}},Event:class{constructor(type,init){this.type=type;this.bubbles=init?.bubbles;}}});
 vm.runInContext(source.slice(source.indexOf('const formBusyStates='),source.indexOf('function loadHuman')),context);
 return {form,submit,secondary,alreadyDisabled,field,context,setLocale(value){locale=value;},translate(){for(const b of [submit,secondary,alreadyDisabled])if(b.dataset.i18n&&t(b.dataset.i18n)!==b.dataset.i18n)b.textContent=t(b.dataset.i18n);}};
}
test('busy labels identify the primary operation and leave secondary action labels alone',()=>{
 for(const [id,expected] of [['editForm','Saving…'],['registerForm','Saving…'],['loginForm','Sending…'],['verifyForm','Checking…'],['deleteVerifyForm','Deleting…']]){
  const f=fixture(id);f.context.busy(f.form,true);assert.equal(f.submit.textContent,expected);assert.equal(f.secondary.textContent,'Cancel');assert.equal(f.secondary.disabled,true);f.context.busy(f.form,false);assert.equal(f.submit.textContent,'Save changes');
 }
});
test('busy completion restores the original icon nodes, translation attributes and disabled states',()=>{
 const f=fixture(),icon={textContent:''},label={textContent:'Save changes'};f.submit.replaceChildren(icon,label);f.submit.dataset.i18nSkip='true';
 f.context.busy(f.form,true,true);assert.equal(f.field.disabled,true);assert.equal(f.form.attrs['aria-busy'],'true');assert.equal(f.submit.dataset.i18n,'busy.saving');assert.equal(f.submit.dataset.i18nSkip,undefined);
 f.context.busy(f.form,false);assert.equal(f.submit.childNodes[0],icon);assert.equal(f.submit.childNodes[1],label);assert.equal(f.submit.dataset.i18n,'save');assert.equal(f.submit.dataset.i18nSkip,'true');assert.equal(f.secondary.disabled,false);assert.equal(f.field.disabled,false);assert.equal(f.alreadyDisabled.disabled,true);assert.equal(f.form.attrs['aria-busy'],undefined);assert.equal(f.form.events.length,2);assert.deepEqual(f.form.events.map(event=>[event.type,event.bubbles]),[['form-busy-changed',true],['form-busy-changed',true]]);
});
test('repeated starts and completions do not snapshot the busy label or unlock previously disabled controls',()=>{
 const f=fixture();for(let i=0;i<2;i++){f.context.busy(f.form,true);f.context.busy(f.form,true);assert.equal(f.context.formIsBusy(f.form),true);f.context.busy(f.form,false);f.context.busy(f.form,false);assert.equal(f.submit.textContent,'Save changes');assert.equal(f.context.formIsBusy(f.form),false);assert.equal(f.alreadyDisabled.disabled,true);}
});
test('busy and restored labels follow language changes without retaining a translated progress label',()=>{
 const f=fixture();f.context.busy(f.form,true);f.setLocale('ht');f.translate();assert.equal(f.submit.textContent,'N ap anrejistre…');f.context.busy(f.form,false);f.translate();assert.equal(f.submit.textContent,'Anrejistre');assert.equal(f.submit.dataset.i18n,'save');f.context.busy(f.form,true);assert.equal(f.submit.textContent,'N ap anrejistre…');f.context.busy(f.form,false);f.setLocale('en');f.translate();assert.equal(f.submit.textContent,'Save changes');
});
test('standalone deletion request labels can be restored and forms accept an explicit operation label',()=>{
 const f=fixture();delete f.secondary.dataset.i18n;const restore=f.context.setBusyButtonLabel(f.secondary,'sending');assert.equal(f.secondary.textContent,'Sending…');restore();assert.equal(f.secondary.textContent,'Cancel');assert.equal(f.secondary.dataset.i18n,undefined);f.context.busy(f.form,true,true,'deleting');assert.equal(f.submit.textContent,'Deleting…');
});
